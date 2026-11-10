/**
 * server/rate-limiter.mjs - Quotas par IP et par groupe, plus la resolution de
 * l'IP client reelle.
 *
 * Fenetre glissante simplifiee : un compteur par couple (IP, groupe), remis a
 * zero quand la fenetre est depassee.
 *
 * INVARIANT : la cle de bucket est `${ip}|${groupe canonique}` - les quotas
 *   sont independants par groupe pour une meme IP (un alias et son groupe
 *   cible partagent le meme compteur, cf. RATE_LIMIT_GROUP_ALIASES).
 * INVARIANT : le `X-Forwarded-For` retenu est le DERNIER saut : le premier
 *   est entierement controle par l'appelant, qui pourrait changer d'en-tete a
 *   chaque requete pour obtenir un bucket neuf.
 * INVARIANT : `X-Forwarded-For` n'est lu que si le pair direct est un proxy
 *   de confiance (`isTrustedProxyPeer`) ou si `TRUST_PROXY=true`.
 * INVARIANT : `rateLimitGuard` renvoie TRUE quand la requete est AUTORISEE -
 *   convention OPPOSEE a `requireAdmin` / `requireAdmin2fa` (qui renvoient
 *   null sur refus).
 * INVARIANT : l'assouplissement des quotas exige les TROIS conditions
 *   (NODE_ENV=test, ALLOW_DEBUG_CODES=true, ZOYD_DISABLE_SUPABASE=true) : un
 *   service connecte a une base reelle ne doit jamais pouvoir se mettre en
 *   mode detendu.
 * INVARIANT : un ALIAS de groupe designe le MEME seau que son groupe cible :
 *   la resolution est faite AVANT la construction de la cle de bucket, donc
 *   `${ip}|${groupe canonique}` - deux alias d'un meme groupe partagent
 *   forcement le meme compteur.
 * PIEGE : un groupe absent de `RATE_LIMIT_CONFIG` retombe sur `default` avec
 *   UN warn par nom de groupe inconnu (pas par appel : les handlers socket
 *   appellent `checkRateLimit` en boucle, un warn/appel serait du spam). Le
 *   groupe `match` utilise par `POST /api/br/lobbies` est desormais
 *   DECLARE (10/min) : avant, il retombait sur `default` (60/min) et
 *   partageait le seau de toutes les lectures publiques. Une faute de frappe
 *   future doit, elle, laisser une trace.
 * PIEGE : le compteur est REINITIALISE, pas glisse : une rafale terminee la
 *   fenetre passe encore.
 * PIEGE : a saturation de MAX_RATE_LIMIT_BUCKETS, le plus ancien bucket est
 *   evince, ce qui libere un quota plus tot que prevu.
 * PIEGE : `checkRateLimit` est aussi appele directement par les handlers
 *   socket (groupes 'chat' et 'default'), sans passer par le garde HTTP.
 * PIEGE : `logout` a son propre groupe (`auth_logout`) : le partager avec
 *   `auth` permettait de verrouiller la connexion de toute une IP partagee.
 * PIEGE : `wallet` est un ALIAS de `wallet_withdraw` : les deux nomment le
 *   meme seau, pas deux quotas. C'est le pont de transition : tant que
 *   `routes/wallet.mjs` demande encore le groupe `wallet`, le comportement
 *   est INCHANGE (un seul seau 20/10 min pour le retrait, la verification de
 *   depot et le depot admin). Des que la route passe a `wallet_withdraw`,
 *   `wallet_deposit` et `wallet_admin`, chaque operation d'argent aura son
 *   propre seau.
 * PIEGE : le seau est PAR IP : en CGNAT (tres courant en Afrique), des
 *   centaines de joueurs partagent une IP publique. Un quota unique pour
 *   toutes les operations d'argent signifiait qu UN SEUL compte suffisait a
 *   paralyser les retraits de tous les autres pendant 10 minutes.
 */

import { respondJson } from './http-utils.mjs';
import { createLogger } from './logger.mjs';

const log = createLogger('rate-limiter');

/** @type {Map<string, { windowStart: number, attempts: number, group: string }>} */
const rateLimitBuckets = new Map();
const MAX_RATE_LIMIT_BUCKETS = 50000;

/** Groupes inconnus deja avertis : un seul log par nom, anti-spam. */
const unknownGroupsWarned = new Set();

/**
 * Config du retrait, PARTAGEE par le groupe canonique `wallet_withdraw` et
 * son alias historique `wallet` (meme objet : meme plafond, meme fenetre).
 */
const WALLET_WITHDRAW_CONFIG = { max: 20, windowMs: 10 * 60 * 1000 };

/** @type {{ auth: { max: number, windowMs: number }, auth_logout: { max: number, windowMs: number }, match: { max: number, windowMs: number }, social: { max: number, windowMs: number }, wallet: { max: number, windowMs: number }, wallet_withdraw: { max: number, windowMs: number }, wallet_deposit: { max: number, windowMs: number }, wallet_admin: { max: number, windowMs: number }, chat: { max: number, windowMs: number }, admin: { max: number, windowMs: number }, default: { max: number, windowMs: number } }} */
const RATE_LIMIT_CONFIG = {
  auth:    { max: 50,  windowMs: 15 * 60 * 1000 },
  // `logout` est appelable sans session et ne prouve rien. Le partager avec
  // `auth` permettait a n'importe qui de verrouiller la connexion de tous les
  // utilisateurs d'une IP partagee pendant 15 minutes.
  auth_logout: { max: 60, windowMs: 60 * 1000 },
  // `POST /api/br/lobbies` (creation de salon BR). Le groupe N'EXISTAIT PAS :
  // la route retombait silencieusement sur `default` (60/min) et partageait
  // le seau de toutes les lectures publiques - le nom du groupe ne
  // protegeait rien. 10/min : creer un salon est une action de joueur, pas
  // un flux, et chaque creation ecrit en base.
  match:   { max: 10,  windowMs: 60 * 1000 },
  social:  { max: 30,  windowMs: 60 * 1000 },
  // Operations d'argent : trois seaux DISTINCTS.
  //
  // AVANT, un seul seau `wallet` (20/10 min) couvrait le retrait, la
  // verification de depot et le depot admin. Le seau est par IP : en CGNAT
  // (tres courant en Afrique), des centaines de joueurs partagent une IP
  // publique, et un SEUL compte suffisait a paralyser les retraits de tous
  // les autres pendant 10 minutes. On ne change AUCUN plafond : on change
  // la granularite des seaux, pour qu'une operation ne puisse plus epuiser
  // le budget d'une autre.
  //
  // `wallet` reste l'alias de `wallet_withdraw` (meme objet de config ET
  // meme seau, cf. RATE_LIMIT_GROUP_ALIASES) : les appelants existants
  // (`routes/wallet.mjs`) gardent exactement le budget d'aujourd'hui.
  wallet:          WALLET_WITHDRAW_CONFIG,
  wallet_withdraw: WALLET_WITHDRAW_CONFIG,
  // Verification de depot : credit d'argent apres un paiement FedaPay.
  wallet_deposit:  { max: 20, windowMs: 10 * 60 * 1000 },
  // Depot admin (credit manuel) : action d'administration, cadence faible.
  wallet_admin:    { max: 20, windowMs: 5 * 60 * 1000 },
  chat:    { max: 60,  windowMs: 60 * 1000 },
  admin:   { max: 20,  windowMs: 5 * 60 * 1000 },
  default: { max: 60,  windowMs: 60 * 1000 },
};

/**
 * Alias de groupes de quota.
 *
 * Un alias designe le MEME seau que son groupe cible : ce n'est pas une
 * simple recopie de configuration, c'est une IDENTITE de compteur. C'est ce
 * qui permet de separer le retrait du depot SANS casser les appelants
 * existants du groupe `wallet` (`routes/wallet.mjs`), qui continuent de
 * consommer exactement le meme budget qu'avant.
 *
 * INVARIANT : la resolution se fait AVANT la construction de la cle de
 *   bucket (`${ip}|${groupe canonique}`) : `wallet` et `wallet_withdraw`
 *   epuisent donc forcement le meme compteur.
 *
 * PIEGE : ajouter un alias ici N'ATTENU EN AUCUN CAS un quota. Le seau
 *   reste unique : c'est le but (une operation ne doit pas epuiser le
 *   budget d'une autre). Le jour ou `wallet.mjs` n'utilise plus `wallet`,
 *   cet alias n'est plus appele et peut etre supprime.
 */
const RATE_LIMIT_GROUP_ALIASES = {
  wallet: 'wallet_withdraw',
};

/**
 * Resout un alias de groupe vers son groupe canonique.
 * @param {string} group
 * @returns {string}
 */
const resolveRateLimitGroup = (group) => {
  const name = String(group || 'default');
  return RATE_LIMIT_GROUP_ALIASES[name] || name;
};

/**
 * Assouplissement EXCLUSIVEMENT pour les tests automatises.
 *
 * L'E2E rejoue des dizaines de scenarios depuis une seule IP (127.0.0.1) :
 * le bucket `default` (60/min) le bloquait, et les echecs 429 faisaient
 * echouer des tests au hasard — au point qu'un test qui passait devait etre
 * relance pour « fonctionner ». On ne teste pas la logique metier ici.
 *
 * Double condition :
 *   - `NODE_ENV=test` : la production tourne en `NODE_ENV=production` (Render),
 *     donc la branche est inatteignable chez nous meme si quelqu'un pose
 *     `ALLOW_DEBUG_CODES` par erreur.
 *   - `ALLOW_DEBUG_CODES=true`, qui n'est pose que par le harness E2E.
 *
 * Sans ces deux variables, la configuration ci-dessus s'applique telle quelle.
 */
const TEST_ONLY_RELAXATION = process.env.NODE_ENV === 'test'
  && process.env.ALLOW_DEBUG_CODES === 'true'
  // Troisieme condition, et SEULE qui compte vraiment : un service connecte a
  // une base reelle ne peut pas se mettre en mode detendu, meme si NODE_ENV et
  // ALLOW_DEBUG_CODES se retrouvaient poses par megarde. Sans cela, une seule
  // variable erronee neutralise TOUS les garde-fous anti-bruteforce — auth,
  // retraits, signalements — sans le moindre signal dans les logs.
  //
  // On teste `ZOYD_DISABLE_SUPABASE` et NON l'absence de SUPABASE_URL : le
  // fichier .env.server local est charge meme en mode memoire, donc l'absence
  // d'URL ne prouve rien, et empechait la suite E2E de tourner.
  && process.env.ZOYD_DISABLE_SUPABASE === 'true';

if (process.env.NODE_ENV === 'test' && process.env.ALLOW_DEBUG_CODES === 'true' && !TEST_ONLY_RELAXATION) {
  log.warn(
    'Relachement du rate limiting DEMANDE mais REFUSE : ce service est configure avec une base reelle.',
    { disableSupabase: process.env.ZOYD_DISABLE_SUPABASE === 'true' },
  );
}

if (TEST_ONLY_RELAXATION) {
  for (const group of Object.keys(RATE_LIMIT_CONFIG)) {
    RATE_LIMIT_CONFIG[group].max = Number(process.env.ZOYD_RATE_LIMIT_MAX || 100000);
    RATE_LIMIT_CONFIG[group].windowMs = 1;
  }
}

/**
 * Check whether the given IP has exceeded the rate limit for a group.
 * @param {string} ip
 * @param {string} [group='default']
 * @returns {{ allowed: boolean, remaining: number, retryAfter: number }}
 */
const checkRateLimit = (ip, group = 'default') => {
  // Alias : `wallet` et `wallet_withdraw` doivent partager le MEME seau.
  // La resolution se fait AVANT la cle de bucket, sinon l'alias aurait son
  // propre compteur et la separation des operations d'argent n'existerait
  // que sur le papier.
  const canonicalGroup = resolveRateLimitGroup(group);
  let config = RATE_LIMIT_CONFIG[canonicalGroup];
  if (!config) {
    // Retombee visible : un groupe inconnu signale probablement une faute de
    // frappe qui affaiblit un quota anti-bruteforce sans crier. Un seul warn
    // par nom (les handlers socket appelent en boucle), plafonne pour borner
    // la memoire meme si un futur appelant passait une valeur controlee par
    // le client.
    config = RATE_LIMIT_CONFIG.default;
    if (!unknownGroupsWarned.has(group) && unknownGroupsWarned.size < 50) {
      unknownGroupsWarned.add(group);
      log.warn(
        `Groupe de rate limit inconnu "${group}" : quota "default" applique.`,
        { group, known: Object.keys(RATE_LIMIT_CONFIG).join(',') },
      );
    }
  }
  const key = `${ip}|${canonicalGroup}`;
  const now = Date.now();
  const record = rateLimitBuckets.get(key);
  if (!record || now - record.windowStart > config.windowMs) {
    // Evict oldest if at capacity
    if (rateLimitBuckets.size >= MAX_RATE_LIMIT_BUCKETS) {
      const oldest = rateLimitBuckets.keys().next().value;
      rateLimitBuckets.delete(oldest);
    }
    rateLimitBuckets.set(key, { windowStart: now, attempts: 1, group: canonicalGroup });
    return { allowed: true, remaining: config.max - 1, retryAfter: 0 };
  }
  record.attempts += 1;
  const allowed = record.attempts <= config.max;
  const retryAfter = allowed ? 0 : Math.ceil((record.windowStart + config.windowMs - now) / 1000);
  return { allowed, remaining: Math.max(0, config.max - record.attempts), retryAfter };
};

/** Remove expired entries from the rate-limit buckets. */
const cleanupRateLimits = () => {
  const now = Date.now();
  for (const [key, record] of rateLimitBuckets) {
    const config = RATE_LIMIT_CONFIG[record.group] || RATE_LIMIT_CONFIG.default;
    if (now - record.windowStart > config.windowMs) rateLimitBuckets.delete(key);
  }
};

setInterval(cleanupRateLimits, 60 * 1000).unref();

/**
 * Validate that a string is a plausible IPv4/IPv6 address.
 *
 * Le motif precedent acceptait `...`, `deadbeef`, `:::::` : n'importe quelle
 * chaîne made-up passait et devenait une CLE DE BUCKET. Ce n'etait pas une
 * faille (un attaquant veut de toute facon des buckets distincts), mais cela
 * consommait des slots du plafond `MAX_RATE_LIMIT_BUCKETS` avec des clefs
 * inutiles. On exige maintenant une vraie adresse.
 * @param {string} ip
 * @returns {boolean}
 */
const isValidIp = (ip) => {
  const value = String(ip || '').trim();
  if (!value || value.length > 45) return false;
  // IPv4 : 4 groupes 0-255.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return value.split('.').every((octet) => Number(octet) <= 255);
  }
  // IPv6 : uniquement des hexets, deux-points, un eventuel IPv4 integre et une
  // zone (`%eth0`). `::1` et `::` doivent passer (loopback), `:::::` non.
  if (!value.includes(':')) return false;
  const [address] = value.split('%');
  if (!/^[0-9a-f:.]+$/i.test(address)) return false;
  if ((address.match(/::/g) || []).length > 1) return false; // compresse unique
  if (address.includes(':::')) return false;
  const groups = address.split(':').filter((g) => g !== '');
  if (groups.length === 0) return true;                       // `::` seul
  // Chaque groupe : 1-4 hexets, ou un IPv4 integre sur le dernier.
  return groups.every((group, index) => {
    if (group.includes('.')) {
      return index === groups.length - 1
        && /^\d{1,3}(\.\d{1,3}){3}$/.test(group)
        && group.split('.').every((o) => Number(o) <= 255);
    }
    return /^[0-9a-f]{1,4}$/i.test(group);
  });
};

/**
 * True if the direct TCP peer is a proxy/private hop (Render proxy, Docker,
 * localhost). X-Forwarded-For is only trusted in that case — sinon un client
 * pourrait forger l'en-tête et contourner le rate limit.
 *
 * TRUST_PROXY=true force la confiance (déployé derrière un LB dont le peer
 * n'est pas dans une plage privée). Le danger symétrique de cette option : si
 * le service est exposé directement, n'importe qui forge son XFF.
 */
const isTrustedProxyPeer = (remoteAddress) => {
  if (String(process.env.TRUST_PROXY || '').toLowerCase() === 'true') return true;
  if (!remoteAddress) return false;
  const ip = String(remoteAddress).replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip)) return true;
  const m172 = /^172\.(\d+)\./.exec(ip);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  if (/^(fc|fd)/i.test(ip)) return true;
  return false;
};

/**
 * Extract the real client IP from a request. X-Forwarded-For is honored
 * only when the direct peer is a trusted proxy (Render).
 *
 * ⚠️ On prend la DERNIÈRE valeur de X-Forwarded-For, pas la première.
 * Un proxy n'efface pas l'en-tête : il APPENDA son IP. Un client peut donc
 * envoyer `X-Forwarded-For: 1.2.3.4` et le proxy produit
 * `1.2.3.4, <IP reelle du client>`. Lire `[0]` rendait cette valeur
 * entièrement contrôlable par l'appelant : il suffisait de changer
 * d'en-tête à chaque requête pour obtenir un bucket neuf et contourner
 * complètement le rate-limit (donc le anti-bruteforce des 50 essais / 15 min).
 * La dernière valeur est celle qu'a posée le proxy de confiance, donc la
 * seule que l'appelant ne contrôle pas.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {string}
 */
const getClientIp = (req) => {
  const peer = req.socket?.remoteAddress || '';
  if (isTrustedProxyPeer(peer)) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const hops = forwarded
        .split(',')
        .map((hop) => hop.trim())
        .filter(Boolean);
      // Le dernier saut est le plus proche du client et donc non falsifiable.
      const lastHop = hops[hops.length - 1];
      if (lastHop && isValidIp(lastHop)) return lastHop;
    }
  }
  return peer || '127.0.0.1';
};

/**
 * Guard an HTTP response against rate limiting.
 * Sends a 429 response and returns false if the limit is exceeded.
 * @param {import('http').ServerResponse} res
 * @param {string} ip
 * @param {string} group
 * @returns {boolean} true if the request is allowed, false if rate-limited
 */
const rateLimitGuard = (res, ip, group) => {
  const { allowed, retryAfter } = checkRateLimit(ip, group);
  if (!allowed) {
    res.setHeader('Retry-After', String(retryAfter));
    respondJson(res, 429, { ok: false, error: 'Trop de requetes. Reessayez plus tard.', code: 'RATE_LIMITED' });
    return false;
  }
  return true;
};

export {
  rateLimitBuckets,
  RATE_LIMIT_CONFIG,
  RATE_LIMIT_GROUP_ALIASES,
  resolveRateLimitGroup,
  checkRateLimit,
  cleanupRateLimits,
  isValidIp,
  getClientIp,
  rateLimitGuard,
};
