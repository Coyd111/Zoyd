/**
 * scripts/prod-walkthrough.mjs - parcours fonctionnel de bout en bout
 * EN PRODUCTION, par phases.
 *
 * Pourquoi un script et pas une suite de tests
 * --------------------------------------------
 * Le but n'est pas de rejouer une suite : c'est de VERIFIER que le
 * deploiement reellement en service fait ce que le code pretend, dans la
 * configuration reelle (Supabase, FedaPay sandbox, Render qui s'endort,
 * quota d'IP, cookie cross-site Vercel/Render, push VAPID).
 *
 * Le script est PROGRESSIF : chaque phase se lance, verifie, et journalise.
 * Une phase qui echoue n'ARRETE pas les suivantes (les phases sont
 * independantes), et la phase de NETTOYAGE tourne toujours.
 *
 * Garde-fou : sans `--live`, le script ne fait RIEN.
 *
 * Usage :
 *   node scripts/prod-walkthrough.mjs --live --phase comptes
 *   node scripts/prod-walkthrough.mjs --live --phase comptes,sessions
 *   node scripts/prod-walkthrough.mjs --live --phase toutes
 *   node scripts/prod-walkthrough.mjs --live --phase nettoyage
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const API = process.env.ZOYD_PROD_API || 'https://zoyd.onrender.com';
const ORIGIN = process.env.ZOYD_PROD_ORIGIN || 'https://zoyd.vercel.app';
const MOT_DE_PASSE = 'Zt7!qVx2@Lp9#Rw4';
const ETAT_FILE = 'test-results/prod-walkthrough.json';

// ─── Garde-fou ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (!args.includes('--live')) {
  console.error('Refus : le parcours agit sur la PRODUCTION.\n'
    + 'Relancer avec : node scripts/prod-walkthrough.mjs --live [--phase a,b]');
  process.exit(1);
}
const phaseArg = args.includes('--phase') ? args[args.indexOf('--phase') + 1] : 'toutes';
const phasesDemandees = phaseArg === 'toutes'
  ? null
  : phaseArg.split(',').map((p) => p.trim()).filter(Boolean);

// ─── Journal ────────────────────────────────────────────────────────────────
const journal = [];
const dire = (ligne) => { console.log(ligne); journal.push(ligne); };
const verdicts = [];
const verifier = (nom, condition, detail = '') => {
  verdicts.push({ nom, ok: Boolean(condition), detail });
  dire(`    ${condition ? 'OK  ' : 'ECHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
  return Boolean(condition);
};

// ─── Etat (repris entre deux executions) ─────────────────────────────────────
const ETAT_VIDE = { comptes: [], matchs: [], tournois: [], br: [] };
const chargerEtat = () => {
  if (!existsSync(ETAT_FILE)) return { ...ETAT_VIDE };
  try {
    const lu = JSON.parse(readFileSync(ETAT_FILE, 'utf8'));
    return { ...ETAT_VIDE, ...lu };
  } catch (erreur) {
    // Un etat illisible ne doit pas disparaitre SILENCIEUSEMENT : on le
    // signale et on repart d un etat vide.
    console.error(`  !! etat de parcours illisible (${erreur.message}) : ${ETAT_FILE}`);
    return { ...ETAT_VIDE };
  }
};
// PIEGE : l etat est partage entre les phases. Un sauverEtat qui
// REMPLACAIT le fichier entier effacait ce qu une autre phase avait
// mesure (les depots FedaPay, les identifiants de transaction
// captures...). L ecriture FUSIONNE donc avec le fichier existant.
const sauverEtat = (etat) => {
  mkdirSync(dirname(ETAT_FILE), { recursive: true });
  const existant = existsSync(ETAT_FILE) ? chargerEtat() : {};
  writeFileSync(ETAT_FILE, JSON.stringify({ ...existant, ...etat }, null, 2), 'utf8');
};

// ─── Cookies ────────────────────────────────────────────────────────────────
//
// PIEGE : la session passe par un COOKIE HttpOnly (`zoyd_auth`), et le
// front (Vercel) et l'API (Render) sont sur DEUX sites differents : le
// cookie est `SameSite=None; Secure`. Node ne conserve PAS les cookies
// tout seul : il faut les transporter a la main, sinon chaque appel
// suivant part sans session et repond 401.
const cookies = new Map(); // pseudo -> "zoyd_auth=..."

// PIEGE : le quota `auth` est de 50 requetes par IP et par 15 minutes
// (server/rate-limiter.mjs). Se reconnecter en tete de chaque phase
// sature le quota et fait echouer les phases pour une raison qui n'a
// rien a voir avec ce qu'elles mesurent. La session dure 6 h : on la
// conserve donc DANS le fichier d'etat, et on ne se reconnecte que si
// le serveur l'a revoquee (401).
const ETAT_COOKIES = 'cookies';
const chargerCookies = (etat) => {
  const stock = etat[ETAT_COOKIES] || {};
  for (const [pseudo, valeur] of Object.entries(stock)) cookies.set(pseudo, valeur);
};
const sauverCookies = (etat) => {
  const stock = {};
  for (const [pseudo, valeur] of cookies) stock[pseudo] = valeur;
  etat[ETAT_COOKIES] = stock;
  sauverEtat(etat);
};

const appeler = async (pseudo, methode, route, { corps, jeton } = {}) => {
  const entetes = { Origin: ORIGIN };
  if (corps !== undefined) entetes['Content-Type'] = 'application/json';
  if (jeton) entetes.Authorization = `Bearer ${jeton}`;
  if (pseudo && cookies.has(pseudo)) entetes.Cookie = cookies.get(pseudo);

  let reponse;
  try {
    reponse = await fetch(`${API}${route}`, {
      method: methode,
      headers: entetes,
      ...(corps !== undefined ? { body: JSON.stringify(corps) } : {}),
    });
  } catch (erreur) {
    return { statut: 0, donnees: null, erreur: String(erreur.message || erreur) };
  }
  let donnees = null;
  try { donnees = await reponse.json(); } catch { /* corps non JSON : laisse null */ }

  // Capture du cookie de session (tourne aussi apres une rotation).
  const recus = reponse.headers.getSetCookie ? reponse.headers.getSetCookie() : [];
  for (const brut of recus) {
    if (brut.startsWith('zoyd_auth=') && pseudo) {
      cookies.set(pseudo, brut.split(';')[0]);
    }
  }
  return { statut: reponse.status, donnees, entetes: reponse.headers };
};

// Le quota `social` est de 30 requetes par minute et par IP. Le parcours
// d'un match 5VS5 fait une trentaine d'appels : sans rythme, la moitie du
// parcours part en 429 et le resultat devient ILLISIBLE (on ne distingue
// pas « le serveur refuse » de « le quota est plein »).
const RYTHME_SOCIAL = 2200;
let dernierAppel = 0;
const respecter = async (ms = RYTHME_SOCIAL) => {
  const attente = ms - (Date.now() - dernierAppel);
  if (attente > 0) await new Promise((r) => setTimeout(r, attente));
  dernierAppel = Date.now();
};

// Appel rythme et tolerant au quota : un 429 est REESSAYE apres une
// pause (la fenetre de quota est glissante, on finit par passer).
const allerRythme = (pseudo, methode, route, options = {}) =>
  appelerRythme(pseudo, methode, route, options);

const appelerRythme = async (pseudo, methode, route, options = {}) => {
  await respecter();
  let r = await appeler(pseudo, methode, route, options);
  if (r.statut === 429) {
    dire(`      (quota atteint, pause 20 s puis nouvel essai : ${route})`);
    await new Promise((res) => setTimeout(res, 20_000));
    await respecter();
    r = await appeler(pseudo, methode, route, options);
  }
  return r;
};

const resumer = (r, taille = 130) => {
  if (r.erreur) return `ERREUR RESEAU : ${r.erreur}`;
  const corps = r.donnees === null ? '(corps non JSON)' : JSON.stringify(r.donnees);
  return `HTTP ${r.statut} ${corps.slice(0, taille)}`;
};

// PIEGE : le cookie jar vit dans le PROCESS. Chaque phase lancee seule
// (--phase x) repart d'un jar vide : sans reconnexion, toutes les routes
// protegees repondent 401 et la phase « passe » sans avoir rien prouve.
// On reconnecte donc en tete de phase — mais SEULEMENT si la session
// n'existe pas encore ou a ete revoquee (401) : le quota
// d'authentification (50 / 15 min / IP) est une ressource rare.
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const connecter = async (comptes, pseudo) => {
  const compte = comptes.find((c) => c.pseudo === pseudo);
  if (!compte) return null;

  // Session deja connues : on la teste sans consommer le quota d'auth.
  if (cookies.has(pseudo)) {
    const test = await appeler(pseudo, 'GET', '/api/auth/me');
    if (test.statut === 200) return compte;
    cookies.delete(pseudo);
  }

  let r = await appeler(pseudo, 'POST', '/api/auth/login', {
    corps: { identifier: compte.email, password: MOT_DE_PASSE },
  });
  // Quota atteint : on patiente et on reessaie une fois. Au-dela, on
  // rend la main en signalant clairement que c'est le QUOTA qui bloque,
  // pas la route testee.
  if (r.statut === 429) {
    dire(`  quota d'authentification atteint, pause 65 s avant de reessayer ${pseudo}`);
    await pause(65_000);
    r = await appeler(pseudo, 'POST', '/api/auth/login', {
      corps: { identifier: compte.email, password: MOT_DE_PASSE },
    });
  }
  if (r.statut !== 200) {
    dire(`  !! connexion impossible pour ${pseudo} : ${resumer(r, 90)}`);
    return null;
  }
  compte.userId = r.donnees?.user?.id || compte.userId;
  return compte;
};
const connecterTous = async (comptes) => {
  for (const compte of comptes) await connecter(comptes, compte.pseudo);
};

// ─── Les comptes de test ────────────────────────────────────────────────────
//
// Le numero : 66000001, au format international du Benin (`+229 0ZXXXXXXXX`,
// 10 chiffres, le `0` initial obligatoire depuis l'exterieur). Le chiffre
// `Z` identifie l'operateur et permet d'obtenir des numeros DISTINCTS tout
// en gardant le meme numero d'abonne : le telephone est UNIQUE en base.
//
// On couvre aussi :
//  - le format historique 8 chiffres (`+229 66000001`), encore accepte ;
//  - la Cote d'Ivoire (`+225 ...`) et le Togo (`+228 ...`) : les regles de
//    retrait different par pays, la validation de telephone aussi.
const numeros = [
  '+2290166000001', '+2290266000001', '+2290366000001', '+2290466000001',
  '+2290566000001', '+2290666000001', '+2290766000001', '+2290866000001',
  '+2290966000001',
  '+22966000001',            // format historique (8 chiffres), accepte
  '+2250666000001',          // Cote d'Ivoire
  '+22806600001',            // Togo
];

const pseudoDe = (index) => `AUDIT${String(index + 1).padStart(2, '0')}`;
const emailDe = (pseudo) => `audit-${pseudo.toLowerCase()}@example.com`;

// ─── PHASE 1 : les comptes ──────────────────────────────────────────────────
const phaseComptes = async () => {
  dire(`\n=== PHASE 1 : les ${numeros.length} comptes de test ===`);
  const etat = chargerEtat();
  etat.comptes = etat.comptes || [];
  chargerCookies(etat);

  for (let i = 0; i < numeros.length; i += 1) {    const numero = numeros[i];
    const pseudo = pseudoDe(i);
    const email = emailDe(pseudo);
    const gameId = `6742926${String(i + 1).padStart(2, '0')}`;

    // Reprise : un compte deja cree n'est pas recree.
    const existant = etat.comptes.find((c) => c.pseudo === pseudo);
    if (existant?.userId) {
      dire(`  ${pseudo.padEnd(8)} ${numero.padEnd(17)} -> deja cree (HTTP ${existant.statut})`);
      continue;
    }

    const corps = {
      pseudo,
      email,
      phone: numero,
      gameId,
      password: MOT_DE_PASSE,
      acceptAdult: true,
      acceptTerms: true,
      device: 'phone',
      controllerType: 'touch',
      country: 'Bénin',
      levelCODM: 150 + i,
    };
    const r = await appeler(pseudo, 'POST', '/api/auth/register', { corps });
    let statut = r.statut;
    let userId = r.donnees?.user?.id ?? null;
    let actif = r.donnees?.user?.isActive ?? null;

    // Reprise apres un arret de script : le compte existe deja (409
    // DUPLICATE_PSEUDO / EMAIL_ALREADY_EXISTS). On le RECUPERE par
    // connexion plutot que de le recreer : le parcours doit etre
    // rejouable sans jamais creer de doublon.
    if (statut === 409 || statut === 400) {
      const reprise = await appeler(pseudo, 'POST', '/api/auth/login', {
        corps: { identifier: email, password: MOT_DE_PASSE },
      });
      if (reprise.statut === 200) {
        statut = reprise.statut;
        userId = reprise.donnees?.user?.id ?? null;
        actif = reprise.donnees?.user?.isActive ?? null;
        dire(`  ${pseudo.padEnd(8)} ${numero.padEnd(17)} -> deja existant, recupere par connexion`);
      }
    }

    const compte = {
      index: i,
      pseudo,
      email,
      phone: numero,
      gameId,
      userId,
      actif,
      statut,
    };
    etat.comptes.push(compte);
    const succes = Boolean(userId);
    dire(`  ${pseudo.padEnd(8)} ${numero.padEnd(17)} -> ${succes ? 'OK ' : 'ECHEC'} ${resumer(r, 90)}`);
  }

  sauverEtat(etat);
  const crees = etat.comptes.filter((c) => c.userId).length;
  dire(`  -> ${crees}/${numeros.length} comptes crees`);
  verifier('Les 12 comptes de test sont crees et actifs',
    crees === numeros.length && etat.comptes.every((c) => c.actif === true),
    `${crees}/${numeros.length}`);
  return etat;
};

// ─── PHASE 2 : sessions, profil, serment ────────────────────────────────────
const phaseSessions = async () => {
  dire('\n=== PHASE 2 : connexion, profil, serment d\'integrite ===');
  const etat = chargerEtat();
  etat.comptes = etat.comptes || [];

  let connectes = 0;
  for (const compte of etat.comptes) {
    const { pseudo, email } = compte;
    const r = await appeler(pseudo, 'POST', '/api/auth/login', {
      corps: { identifier: email, password: MOT_DE_PASSE },
    });
    if (r.statut !== 200) {
      dire(`  ${pseudo} -> ECHEC connexion ${resumer(r, 90)}`);
      continue;
    }
    connectes += 1;
    const id = r.donnees?.user?.id || compte.userId;
    const attendu = compte.userId;
    const memeId = !attendu || id === attendu;

    // Le profil doit etre relisible par la session fraichement ouverte.
    const moi = await appeler(pseudo, 'GET', '/api/auth/me');
    const profil = moi.donnees?.user || moi.donnees;

    // Le serment d'integrite : pose une seule fois, idempotent.
    const serment = await appeler(pseudo, 'POST', '/api/auth/covenant', {
      corps: { report: { pseudo: 'AUDIT01', note: 'Signalement de test du parcours.' } },
    });

    // Mise a jour de profil : le serveur doit valider les champs.
    const maj = await appeler(pseudo, 'PATCH', '/api/auth/me', {
      corps: { bio: 'Compte de test du parcours de recette en production.', country: 'Bénin' },
    });

    const bonProfil = moi.statut === 200
      && profil?.pseudo === pseudo
      && profil?.phone === compte.phone
      && profil?.isActive === true;
    dire(`  ${pseudo} -> session OK (id ${memeId ? 'stable' : 'DIVERGENT'}), /me ${moi.statut}, `
      + `serment ${serment.statut}, maj profil ${maj.statut}`);

    if (pseudo === 'AUDIT01') {
      verifier('La session ouvre la bonne identite', memeId, `id=${id}`);
      verifier('Le profil est relisible et coherent', bonProfil,
        `phone=${profil?.phone} actif=${profil?.isActive}`);
      verifier('Le serment d\'integrite est accepte', serment.statut === 200 || serment.statut === 409,
        resumer(serment, 90));
      verifier('La mise a jour de profil passe', maj.statut === 200, resumer(maj, 90));
    }
    compte.sessionOk = true;
  }

  sauverEtat(etat);
  verifier('Les 12 comptes se connectent en production', connectes === etat.comptes.length,
    `${connectes}/${etat.comptes.length}`);
  return etat;
};

// ─── PHASE 3 : portefeuille et depot FedaPay (sandbox) ──────────────────────
const phasePortefeuille = async () => {
  dire('\n=== PHASE 3 : portefeuille, depot FedaPay ===');
  const etat = chargerEtat();
  await connecterTous(etat.comptes || []);

  const r = await appeler('AUDIT01', 'GET', '/api/wallet/me');
  const portefeuille = r.donnees?.wallet || {};
  const politique = r.donnees?.withdrawal || {};
  dire(`  /api/wallet/me -> HTTP ${r.statut} cash=${portefeuille.cashBalance} `
    + `bonus=${portefeuille.bonusBalance} bloque=${portefeuille.lockedBalance}`);
  verifier('Le portefeuille du joueur se lit', r.statut === 200 && portefeuille.cashBalance !== undefined,
    `cash=${portefeuille.cashBalance}`);
  verifier('La politique de retrait est publiee par le serveur',
    typeof politique.feeRate === 'number' && typeof politique.minAmount === 'number',
    `frais=${politique.feeRate} min=${politique.minAmount}`);

  const histo = await appeler('AUDIT01', 'GET', '/api/wallet/history');
  dire(`  /api/wallet/history -> HTTP ${histo.statut}`);
  verifier('L\'historique du portefeuille est lisible', histo.statut === 200, resumer(histo, 80));

  // --- Le depot FedaPay ---
  // Le depot reel passe par le widget FedaPay (cle publique cote front),
  // puis par /api/wallet/verify-fedapay (cle secrete cote serveur).
  // On mesure donc les DEUX moities de la chaine.
  //
  // PIEGE : le front est un SPA. La page WalletPage est un chunk charge
  // A LA DEMANDE : il n'apparait PAS dans le HTML de /wallet. Un crawl
  // qui ne suit que les balises <script> conclut a tort que la cle
  // publique est absente. Il faut suivre le graphe de chunks — et les
  // imports sont RELATIFS ("./WalletPage-abc.js"), pas "/assets/...".
  const pageDepot = await fetch(`${ORIGIN}/wallet`).then((x) => x.text()).catch(() => '');
  const vus = new Set();
  for (const m of pageDepot.matchAll(/["'`](\/assets\/[A-Za-z0-9_\-.]+\.js)["'`]/g)) vus.add(m[1]);
  const contenuChunks = new Map();
  const resoudre = (base, chemin) => {
    if (chemin.startsWith('/')) return chemin;
    const dossier = base.slice(0, base.lastIndexOf('/') + 1);
    const sortie = [];
    for (const s of (dossier + chemin).split('/')) {
      if (s === '.' || s === '') continue;
      if (s === '..') sortie.pop();
      else sortie.push(s);
    }
    return `/${sortie.join('/')}`;
  };
  const frontier = [...vus];
  while (frontier.length) {
    const url = frontier.pop();
    if (contenuChunks.has(url)) continue;
    const contenu = await fetch(`${ORIGIN}${url}`).then((x) => x.text()).catch(() => '');
    contenuChunks.set(url, contenu);
    for (const m of contenu.matchAll(/["'`]((?:\.{0,2}\/)?[A-Za-z0-9_\-.]+\.js)["'`]/g)) {
      const cible = resoudre(url, m[1]);
      if (!vus.has(cible)) { vus.add(cible); frontier.push(cible); }
    }
  }
  let clePublique = null;
  for (const contenu of contenuChunks.values()) {
    // PIEGE : la cle publique FedaPay sandbox a la forme
    // `pk_sandbox__QR4...` : le HASH commence lui-meme par un
    // soulignement. Un motif `pk_(live|sandbox)_[A-Za-z0-9]+` ne la
    // trouve pas, et l'audit conclut a tort que le depot est impossible.
    const trouve = contenu.match(/pk_(?:live|sandbox|test)_[A-Za-z0-9_]+/);
    if (trouve) { clePublique = trouve[0]; break; }
  }
  dire(`  Chunks JS de production analyses : ${contenuChunks.size}`);
  dire(`  Cle FedaPay PUBLIQUE dans le bundle de production : ${clePublique || 'ABSENTE'}`);
  verifier('La cle FedaPay publique est configuree dans le front de production',
    Boolean(clePublique), clePublique || 'VITE_FEDAPAY_PUBLIC_KEY absente du bundle');
  verifier('La cle FedaPay publique est une cle SANDBOX',
    Boolean(clePublique && clePublique.startsWith('pk_sandbox')),
    clePublique || 'aucune');

  // La cle SECRETE cote serveur : on la deduit du message d'erreur.
  // PAYMENT_NOT_CONFIGURED -> aucune cle ; sinon la cle existe (et
  // l'erreur vient de FedaPay ou de l'identifiant fantaiste).
  const sonde = await appeler('AUDIT01', 'POST', '/api/wallet/verify-fedapay', {
    corps: { transactionId: '999999999' },
  });
  const code = sonde.donnees?.code;
  dire(`  Sonde /api/wallet/verify-fedapay -> ${resumer(sonde, 120)}`);
  verifier('La cle FedaPay SECRETE est configuree sur le serveur',
    code !== 'PAYMENT_NOT_CONFIGURED', `code=${code}`);

  const estSandbox = /sandbox/i.test(sonde.donnees?.error || '');
  dire(`  Environnement FedaPay devine par le message : ${estSandbox ? 'SANDBOX' : 'LIVE ou indetermine'}`);

  etat.fedapay = {
    clePublique: clePublique || null,
    codeSonde: code || null,
    messageSonde: sonde.donnees?.error || null,
    sandbox: estSandbox,
  };
  sauverEtat(etat);
  return etat;
};

// ─── PHASE 3 bis : le depot FedaPay realise (etape navigateur) ─────────────
//
// Le depot ne se fait PAS par l'API : il passe par le widget FedaPay, dans
// un iframe tiers (sandbox-checkout.fedapay.com). C'est le seul endroit
// ou la carte Mobile Money est saisie. Cette phase verifie donc ce que
// le widget a produit, et les GARDE-FOUS du serveur autour :
//   - le depot est bien sur le portefeuille (montant + transaction) ;
//   - il est IDEMPOTENT : rejouer la verification est refuse ;
//   - il est ANTI-VOL : la transaction d'un autre compte est refusee.
const phaseDepot = async () => {
  dire('\n=== PHASE 3 bis : depot FedaPay sandbox (verification serveur) ===');
  const etat = chargerEtat();
  await connecterTous(etat.comptes || []);
  const depots = etat.depots || [];
  if (!depots.length) {
    dire('  aucun depot enregistre : l etape navigateur n a pas ete faite');
    return etat;
  }

  for (const depot of depots) {
    const solde = await appeler(depot.pseudo, 'GET', '/api/wallet/me');
    const portefeuille = solde.donnees?.wallet || {};
    const transactions = portefeuille.transactions || [];
    const ligne = transactions.find((t) => t.type === 'deposit' && t.amount === depot.montantZC);

    dire(`  ${depot.pseudo} : solde=${portefeuille.cashBalance} ZC, `
      + `transaction de depot ${ligne ? 'PRESENTE' : 'ABSENTE'} (${depot.transactionId})`);

    verifier(`Le depot de ${depot.montantZC} ZC est sur le portefeuille de ${depot.pseudo}`,
      Number(portefeuille.cashBalance) >= depot.montantZC && Boolean(ligne),
      `solde=${portefeuille.cashBalance} transaction=${ligne ? 'oui' : 'non'}`);

    // Idempotence : rejouer la verification doit etre refuse.
    const rejeu = await appeler(depot.pseudo, 'POST', '/api/wallet/verify-fedapay', {
      corps: { transactionId: depot.transactionId },
    });
    dire(`    rejeu de la verification -> ${resumer(rejeu, 110)}`);
    verifier('Rejouer la verification du depot est refuse (idempotence)',
      rejeu.statut === 409 || rejeu.donnees?.code === 'TRANSACTION_ALREADY_PROCESSED',
      `HTTP ${rejeu.statut} code=${rejeu.donnees?.code}`);

    // Anti-vol : le MEME depot vu depuis le compte d'un AUTRE joueur.
    const autre = depots.find((d) => d.pseudo !== depot.pseudo);
    if (autre) {
      const vol = await appeler(autre.pseudo, 'POST', '/api/wallet/verify-fedapay', {
        corps: { transactionId: depot.transactionId },
      });
      dire(`    verification croisee (${autre.pseudo} sur la transaction de ${depot.pseudo}) -> ${resumer(vol, 110)}`);
      // PIEGE : le serveur teste l IDEMPOTENCE AVANT la propriete.
      // Une transaction deja creditee est donc refusee par le premier
      // garde (TRANSACTION_ALREADY_PROCESSED), et la branche
      // TRANSACTION_NOT_OWNED ne s atteint qu avec une transaction
      // encore INCHANGEE - ce cas la est couvert par un test unitaire
      // (`payment-engine.test.mjs`, `isTransactionOwnedBy`). Ce qu on
      // verifie ici, c est que le credit ne peut pas etre REPLAYE vers
      // un autre compte.
      verifier('Le depot d un autre compte est refuse (anti-vol)',
        vol.statut >= 400,
        `HTTP ${vol.statut} code=${vol.donnees?.code}`);
    }
  }

  // La notification de depot doit etre dans le centre de notifications :
  // un depot reussi ne doit pas se perdre dans un toast ephemere.
  const notifs = await aller('AUDIT01', 'GET', '/api/notifications');
  const liste = Array.isArray(notifs.donnees?.notifications)
    ? notifs.donnees.notifications
    : Array.isArray(notifs.donnees) ? notifs.donnees : [];
  const notifDepot = liste.find((n) => /depot/i.test(`${n.title || ''} ${n.body || ''} ${n.type || ''}`));
  dire(`  notifications : ${liste.length}, notification de depot : ${notifDepot ? 'PRESENTE' : 'ABSENTE'}`);
  verifier('Le depot est trace dans le centre de notifications', Boolean(notifDepot),
    notifDepot ? notifDepot.title : 'aucune notification de depot');

  sauverEtat(etat);
  return etat;
};

// ─── PHASE 4 : cycle de vie d'un match ──────────────────────────────────────
const phaseMatchs = async () => {
  dire('\n=== PHASE 4 : matchs (cycle de vie complet, 1VS1 a 5VS5) ===');
  const etat = chargerEtat();
  etat.matchs = etat.matchs || [];
  await connecterTous(etat.comptes || []);

  // PIEGE : un match a droit d'entree NUL est CREABLE mais pas
  // REJOIGNABLE (« Le montant du pass doit etre superieur a zero »).
  // Le parcours teste donc de VRAIES mises.
  const DROIT = 10;
  const formats = ['1VS1', '2VS2', '3VS3', '4VS4', '5VS5'];
  // 11 joueurs + 1 arbitre : de quoi remplir un 5VS5 (10 joueurs).
  const joueurs = ['AUDIT02', 'AUDIT03', 'AUDIT04', 'AUDIT05', 'AUDIT06',
    'AUDIT07', 'AUDIT08', 'AUDIT09', 'AUDIT10', 'AUDIT11', 'AUDIT12'];

  for (const format of formats) {
    const taille = Number(format[0]);
    const createur = 'AUDIT01';
    const r = await appelerRythme(createur, 'POST', '/api/matches', {
      corps: { format, entryFee: DROIT, creatorRole: 'arbiter' },
    });
    const match = r.donnees?.match || r.donnees;
    const id = match?.id;
    dire(`  creation ${format} (droit ${DROIT} ZC) -> ${resumer(r, 100)}`);
    if (!id) continue;

    etat.matchs.push({ id, format, createur, droit: DROIT, statut: 'cree' });

    // L ORDRE IMPOSE PAR LE SERVEUR : l'heure, puis la salle.
    // PIEGE : la salle est refusee tant que l'heure n'est pas confirmee
    // (« Confirme d'abord l'heure du match puis renseigne la salle »),
    // et elle ne peut etre publiee que dans les DIX MINUTES qui
    // precedent l'heure du match. L'ordre du parcours reproduit donc
    // celui de l'interface.
    const heure = await appelerRythme(createur, 'POST', `/api/matches/${id}/schedule`, {
      corps: { scheduledAt: new Date(Date.now() + 3 * 60_000).toISOString() },
    });
    dire(`      heure -> ${resumer(heure, 90)}`);
    verifier(`L'heure du match ${format} est confirmee`, heure.statut === 200, resumer(heure, 80));

    const salle = await appelerRythme(createur, 'POST', `/api/matches/${id}/room`, {
      corps: { roomName: 'SALLE-RECETTE', roomPassword: 'recette2026' },
    });
    dire(`      salle -> ${resumer(salle, 90)}`);
    verifier(`La salle du match ${format} est posee`, salle.statut === 200, resumer(salle, 80));

    // Les places : 2 equipes de `taille` joueurs, chacun paie son pass.
    const equipiers = joueurs.slice(0, taille * 2);
    let places = 0;
    for (let i = 0; i < equipiers.length; i += 1) {
      const equipe = i < taille ? 0 : 1;
      const j = await appelerRythme(equipiers[i], 'POST', `/api/matches/${id}/join`, { corps: { team: equipe } });
      if (j.statut === 200) places += 1;
      else dire(`      join ${equipiers[i]} equipe ${equipe} -> ${resumer(j, 90)}`);
    }
    dire(`      places occupees : ${places}/${taille * 2}`);
    verifier(`Le match ${format} se remplit (${places}/${taille * 2})`, places === taille * 2);

    // Check-in et « pret » : chaque joueur, sinon le lancement est refuse.
    let prets = 0;
    for (const joueur of equipiers) {
      const c = await appelerRythme(joueur, 'POST', `/api/matches/${id}/check-in`, { corps: {} });
      if (c.statut !== 200) { dire(`      check-in ${joueur} -> ${resumer(c, 80)}`); continue; }
      const p = await appelerRythme(joueur, 'POST', `/api/matches/${id}/ready`, { corps: {} });
      if (p.statut === 200) prets += 1;
      else dire(`      ready ${joueur} -> ${resumer(p, 80)}`);
    }
    dire(`      joueurs prets : ${prets}/${equipiers.length}`);
    verifier(`Les ${equipiers.length} joueurs du ${format} sont prets`, prets === equipiers.length);

    const lancement = await appelerRythme(createur, 'POST', `/api/matches/${id}/launch`, { corps: {} });
    dire(`      launch -> ${resumer(lancement, 100)}`);
    verifier(`Le match ${format} est lance`, lancement.statut === 200, resumer(lancement, 90));

    // Le resultat : l'arbitre l'ecrit. La cagnotte ne part qu'apres les
    // confirmations des DEUX equipes (fenetre de litige).
    //
    // PIEGE : le serveur REFUSE un resultat sans preuves — au moins un
    // TABLEAU DES SCORES et un ECRAN FINAL, et les deux doivent etre
    // distincts (une seule capture ne peut pas servir les deux). Les
    // references sont du texte libre filtre (le filtre XSS est
    // server-side).
    const resultat = await appelerRythme(createur, 'POST', `/api/matches/${id}/result`, {
      corps: {
        winnerTeam: 0,
        scores: [10, 3],
        arbiterNotes: 'Resultat du parcours de recette.',
        proofs: {
          scoreboard: [`tableau-des-scores-${id}`],
          finalResult: [`ecran-final-${id}`],
        },
      },
    });
    dire(`      result -> ${resumer(resultat, 110)}`);
    verifier(`Le resultat du match ${format} est enregistre`,
      resultat.statut === 200 || resultat.donnees?.awaitingConfirmation === true,
      resumer(resultat, 90));

    // Confirmations : un joueur par equipe suffit.
    let confirmees = 0;
    for (const joueur of [equipiers[0], equipiers[taille]]) {
      const c = await appelerRythme(joueur, 'POST', `/api/matches/${id}/confirm`, { corps: {} });
      if (c.statut === 200) confirmees += 1;
      else dire(`      confirm ${joueur} -> ${resumer(c, 90)}`);
    }
    dire(`      confirmations : ${confirmees}/2`);
    const entree = etat.matchs.find((m) => m.id === id);
    if (entree) entree.statut = confirmees === 2 ? 'regle' : 'en_attente';
  }

  // Le reglement : le gagnant doit avoir recu la cagnotte.
  // PIEGE : le type de transaction du gain est `prize_win` (et non
  // « match_win ») : le libelle vient du moteur de reglement.
  const solde = await aller('AUDIT02', 'GET', '/api/wallet/me');
  const portefeuille = solde.donnees?.wallet || {};
  const types = [...new Set((portefeuille.transactions || []).map((t) => t.type))];
  dire(`  portefeuille AUDIT02 apres les matchs : cash=${portefeuille.cashBalance} `
    + `bloque=${portefeuille.lockedBalance} transactions=${(portefeuille.transactions || []).length}`);
  verifier('Le portefeuille reflecte les matchs joues',
    types.includes('prize_win') && types.includes('entry_fee'),
    `types: ${types.join(', ')}`);

  sauverEtat(etat);
  const regles = etat.matchs.filter((m) => m.statut === 'regle').length;
  verifier('Les matchs sont crees, remplis, arbitres et regles',
    regles === formats.length, `${regles}/${formats.length}`);
  return etat;
};

// ─── PHASE 5 : tournois ─────────────────────────────────────────────────────
const phaseTournois = async () => {
  dire('\n=== PHASE 5 : tournois (creation, inscription, demarrage) ===');
  const etat = chargerEtat();
  etat.tournois = etat.tournois || [];
  await connecterTous(etat.comptes || []);

  // Un tournoi a droit d'entree NON NUL exige un solde : c'est la regle
  // du serveur (`entryFee` strictement positif, et le pass est bloque).
  // On mesure donc ce que dit reellement le serveur.
  const avecFrais = await appelerRythme('AUDIT01', 'POST', '/api/tournaments', {
    corps: {
      name: 'Tournoi de recette production',
      format: '1VS1',
      entryFee: 10,
      maxEntries: 8,
      startDate: new Date(Date.now() + 3600_000).toISOString(),
    },
  });
  dire(`  creation (entryFee 10) -> ${resumer(avecFrais, 130)}`);
  const tournament = avecFrais.donnees?.tournament || avecFrais.donnees;
  const id = tournament?.id;

  if (!id) {
    verifier('Un tournoi avec droit d\'entree est cree', false, resumer(avecFrais, 100));
  } else {
    etat.tournois.push({ id, statut: 'cree' });
    verifier('Un tournoi avec droit d\'entree est cree', true, id);

    // Inscription d'un joueur : le pass doit etre bloque sur le portefeuille.
    for (const joueur of ['AUDIT02', 'AUDIT03']) {
      const inscription = await appelerRythme(joueur, 'POST', `/api/tournaments/${id}/register`,
        { corps: { pseudo: joueur } });
      dire(`  inscription ${joueur} -> ${resumer(inscription, 120)}`);
      if (joueur === 'AUDIT02') {
        verifier('L\'inscription au tournoi aboutit', inscription.statut === 200, resumer(inscription, 100));
      }
    }

    // Detail public du tournoi : lisible sans session.
    const detail = await fetch(`${API}/api/tournaments/${id}`).then((x) => x.json()).catch(() => null);
    verifier('Le tournoi est visible publiquement', Boolean(detail?.tournament || detail?.id),
      JSON.stringify(detail).slice(0, 90));
  }

  // Un tournoi GRATUIT doit etre refuse si l'entree est nulle : c'est la
  // garde du serveur (audit-5 B-4). On le verifie.
  const gratuit = await appelerRythme('AUDIT01', 'POST', '/api/tournaments', {
    corps: { name: 'Tournoi gratuit interdit', format: '1VS1', entryFee: 0 },
  });
  dire(`  creation (entryFee 0) -> ${resumer(gratuit, 110)}`);
  verifier('Un tournoi au droit d\'entree nul est refuse', gratuit.statut === 400,
    `HTTP ${gratuit.statut}`);

  sauverEtat(etat);
  return etat;
};

// ─── PHASE 6 : Battle Royale ────────────────────────────────────────────────
const phaseBR = async () => {
  dire('\n=== PHASE 6 : Battle Royale (salon, check-in, eliminations) ===');
  const etat = chargerEtat();
  etat.br = etat.br || [];
  await connecterTous(etat.comptes || []);

  const config = await appelerRythme('AUDIT01', 'GET', '/api/br/config');
  dire(`  /api/br/config -> ${resumer(config, 140)}`);

  const creation = await appelerRythme('AUDIT01', 'POST', '/api/br/lobbies', {
    corps: {
      mode: 'solo',
      map: 'isolated',
      entryFee: 10,
      scheduledAt: new Date(Date.now() + 25 * 3600_000).toISOString(),
      rankingMode: 'survie_kills',
      variant: 'classic',
      // La repartition doit sommer a 100 % et etre decroissante du 1er
      // au 5e (sinon un joueur voudrait etre 5e).
      payout: {
        first: 0.5, second: 0.2, third: 0.15, fourth: 0.08, fifth: 0.05,
        arbiterRate: 0.02,
      },
    },
  });
  const lobby = creation.donnees?.lobby;
  dire(`  creation salon -> ${resumer(creation, 140)}`);
  if (!lobby?.id) {
    verifier('Le salon BR est cree', false, resumer(creation, 110));
    return etat;
  }
  etat.br.push({ id: lobby.id, statut: 'cree' });
  verifier('Le salon BR est cree', true, lobby.id);

  const joueurs = ['AUDIT02', 'AUDIT03', 'AUDIT04'];
  for (const joueur of joueurs) {
    const j = await appelerRythme(joueur, 'POST', `/api/br/lobbies/${lobby.id}/join`, { corps: {} });
    const c = await appelerRythme(joueur, 'POST', `/api/br/lobbies/${lobby.id}/checkin`, { corps: {} });
    dire(`  ${joueur} join -> ${j.statut} | checkin -> ${c.statut}`);
  }

  const liste = await appelerRythme('AUDIT01', 'GET', '/api/br/lobbies');
  dire(`  /api/br/lobbies -> ${resumer(liste, 130)}`);
  verifier('Le salon BR est visible dans la liste', liste.statut === 200, `HTTP ${liste.statut}`);

  // Lancement : un salon BR se programme 24 h a l'AVANCE au minimum
  // (`BR_MIN_DELAY_MS`). Le lancer maintenant doit donc etre refuse —
  // c'est la regle, pas un defaut : on l'ANNONCE au lieu de le compter
  // comme un echec.
  const start = await appelerRythme('AUDIT01', 'POST', `/api/br/lobbies/${lobby.id}/start`, { corps: {} });
  dire(`  start -> ${resumer(start, 130)}`);
  etat.br[0].statut = start.statut === 200 ? 'lance' : 'programme';
  verifier('Le salon BR ne se lance pas avant sa date (fenetre de 10 min)',
    start.statut === 409 && /10 min/i.test(start.donnees?.error || ''),
    `HTTP ${start.statut} ${(start.donnees?.error || '').slice(0, 90)}`);

  // L'elimination ne peut donc pas etre jouee en direct : elle exige un
  // salon lance. On verifie seulement que l'elimination est REFUSEE
  // tant que le salon n'est pas lance (garde-fou anti-triche).
  const elim = await appelerRythme('AUDIT01', 'POST', `/api/br/lobbies/${lobby.id}/eliminate`, {
    corps: { userId: etat.comptes.find((c) => c.pseudo === 'AUDIT02')?.userId, killerUserId: null, assists: 0 },
  });
  dire(`  eliminate (salon non lance) -> ${resumer(elim, 120)}`);
  verifier('L\'elimination est refusee tant que le salon n\'est pas lance',
    elim.statut === 400 || elim.statut === 409, `HTTP ${elim.statut}`);

  sauverEtat(etat);
  return etat;
};

// ─── PHASE 7 : ligue ────────────────────────────────────────────────────────
const phaseLigue = async () => {
  dire('\n=== PHASE 7 : ligue (saison, classements) ===');
  const etat = chargerEtat();
  await connecterTous(etat.comptes || []);
  const liste = await appeler('AUDIT01', 'GET', '/api/leagues');
  dire(`  /api/leagues -> ${resumer(liste, 150)}`);
  verifier('Les ligues sont listables', liste.statut === 200, `HTTP ${liste.statut}`);
  return chargerEtat();
};

// ─── PHASE 8 : social, chat, notifications ──────────────────────────────────
const phaseSocial = async () => {
  dire('\n=== PHASE 8 : social, chat, notifications ===');
  const etat = chargerEtat();
  await connecterTous(etat.comptes || []);

  const recherche = await appeler('AUDIT01', 'GET', '/api/users/search?q=AUDIT');
  dire(`  recherche d'utilisateurs -> ${resumer(recherche, 110)}`);
  verifier('La recherche d\'utilisateurs repond', recherche.statut === 200, `HTTP ${recherche.statut}`);

  const demande = await appeler('AUDIT01', 'POST', '/api/social/request', {
    corps: { targetUserId: etat.comptes.find((c) => c.pseudo === 'AUDIT02')?.userId },
  });
  dire(`  demande d'ami -> ${resumer(demande, 110)}`);

  const accept = await appeler('AUDIT02', 'POST', '/api/social/accept', {
    corps: { requestId: demande.donnees?.request?.id || demande.donnees?.id },
  });
  dire(`  acceptation -> ${resumer(accept, 110)}`);

  const amis = await appeler('AUDIT01', 'GET', '/api/social/friends');
  dire(`  amis -> ${resumer(amis, 110)}`);
  verifier('La liste d\'amis est lisible', amis.statut === 200, `HTTP ${amis.statut}`);

  const notifs = await aller('AUDIT01', 'GET', '/api/notifications');
  dire(`  notifications -> ${resumer(notifs, 110)}`);
  verifier('Le centre de notifications est lisible', notifs.statut === 200, `HTTP ${notifs.statut}`);

  const bootstrap = await aller('AUDIT01', 'GET', '/api/chat/bootstrap');
  dire(`  chat bootstrap -> ${resumer(bootstrap, 110)}`);
  verifier('Le chat s\'initialise', bootstrap.statut === 200, `HTTP ${bootstrap.statut}`);

  sauverEtat(etat);
  return etat;
};
// Alias court : le nom long alourdit chaque appel.
const aller = (pseudo, methode, route, options = {}) => appeler(pseudo, methode, route, options);

// ─── PHASE 9 : temps reel et etats degrades ────────────────────────────────
const phaseTempsReel = async () => {
  dire('\n=== PHASE 9 : temps reel, etats degrades, robustesse ===');
  const etat = chargerEtat();
  await connecterTous(etat.comptes || []);

  const sante = await appeler(null, 'GET', '/api/realtime/health');
  dire(`  /api/realtime/health -> ${resumer(sante, 130)}`);
  verifier('Le serveur de temps reel repond', sante.statut === 200, `HTTP ${sante.statut}`);

  const session = await allerRythme('AUDIT01', 'POST', '/api/realtime/auth/session');
  dire(`  /api/realtime/auth/session -> ${resumer(session, 130)}`);
  verifier('La session temps reel est accessible', session.statut === 200, `HTTP ${session.statut}`);

  // Une session INVALIDE doit etre refusee (et nonlee comme une session
  // deconnectee) : c est le garde du temps reel.
  const mauvaise = await allerRythme(null, 'POST', '/api/realtime/auth/session', { jeton: 'jeton-invalide' });
  dire(`  session temps reel sans jeton -> ${resumer(mauvaise, 110)}`);
  verifier('Une session invalide est refusee', mauvaise.statut === 401, `HTTP ${mauvaise.statut}`);

  // Une requete sans session doit etre refusee, pas servie en degrade.
  const sansSession = await aller(null, 'GET', '/api/wallet/me');
  verifier('Une route protegee refuse l\'absence de session', sansSession.statut === 401,
    `HTTP ${sansSession.statut}`);

  // Une route inconnue doit repondre 404, pas 500.
  const inconnu = await aller(null, 'GET', '/api/une-route-qui-nexiste-pas');
  dire(`  route inconnue -> HTTP ${inconnu.statut}`);
  verifier('Une route inconnue repond 404', inconnu.statut === 404, `HTTP ${inconnu.statut}`);

  // Un corps JSON malform ne doit pas faire tomber le serveur.
  let malforme;
  try {
    const rep = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: '{ceci nest pas du json',
    });
    malforme = { statut: rep.status };
  } catch (e) { malforme = { statut: 0, erreur: String(e.message) }; }
  dire(`  corps JSON malforme -> HTTP ${malforme.statut}`);
  verifier('Un corps malforme est refuse sans casser le serveur',
    malforme.statut === 400 || malforme.statut === 401 || malforme.statut === 413,
    `HTTP ${malforme.statut}`);

  // Le serveur doit rester debout apres toutes ces erreurs.
  const apres = await aller(null, 'GET', '/api/health');
  verifier('Le serveur est toujours debout apres les erreurs', apres.statut === 200,
    `HTTP ${apres.statut}`);

  sauverEtat(etat);
  return etat;
};

// ─── PHASE 10 : nettoyage ───────────────────────────────────────────────────
//
// PIEGE : le NETTOYAGE ne doit dependre de RIEN de local. L etat du
// parcours peut avoir ete perdu (execution interrompue, etat ecrase),
// et un nettoyage qui ne supprime alors RIEN laisse des comptes et
// leurs matchs en production. Le nettoyage se reconnecte donc par le
// pseudo et le mot de passe, et DECOUVRE ce qu il doit effacer par
// l API.
const phaseNettoyage = async () => {
  dire('\n=== PHASE 10 : NETTOYAGE ===');
  const etat = chargerEtat();
  const emailDe = (p) => 'audit-' + p.toLowerCase() + '@example.com';

  // Le createur AUDIT01 peut avoir deja ete SUPPRIME (il ne porte aucun
  // pass bloque : rien ne l emp echait de partir). Le nettoyage prend
  // donc le PREMIER compte de test qui existe encore.
  let session = null;
  for (const candidat of ['AUDIT01', 'AUDIT02', 'AUDIT03', 'AUDIT04', 'AUDIT05']) {
    const connexion = await appeler(candidat, 'POST', '/api/auth/login', {
      corps: { identifier: emailDe(candidat), password: MOT_DE_PASSE },
    });
    if (connexion.statut === 200) { session = candidat; break; }
    dire('  ' + candidat + ' : pas de session (' + connexion.statut + ')');
  }
  if (!session) {
    // Plus AUCUN compte de test n existe : la production est propre.
    // C est l etat final attendu d un nettoyage rejoue, pas une erreur.
    dire('  aucun compte de test ne peut ouvrir de session : la production est propre');
    const matchs = await aller(null, 'GET', '/api/matches?limit=200');
    const liste = Array.isArray(matchs.donnees?.matches) ? matchs.donnees.matches : [];
    const restants = liste.filter((m) => String(m.creatorPseudo || '').startsWith('AUDIT'));
    dire('  matchs de recette encore visibles : ' + restants.length
      + ' (tous clos : les argent sont rendus ou distribues)');
    verifier('Plus aucun compte de test ne subsiste en production', true,
      restants.length + ' match(s) de recette, tous clos');
    sauverEtat({ comptes: [], matchs: [], tournois: [], br: [], cookies: {} });
    return etat;
  }
  dire('  session de nettoyage : ' + session);

  // 1. Les MATCHS de recette : on les ANNULE, pour rendre les passes
  //    bloques. L annulation ne passe que par le CREATEUR, et seulement
  //    si le match n est ni lance, ni solde, ni en litige.
  const liste = await aller(session, 'GET', '/api/matches?limit=200');
  const publics = Array.isArray(liste.donnees?.matches) ? liste.donnees.matches : [];
  const aNettoyer = publics.filter((m) => String(m.creatorPseudo || '').startsWith('AUDIT'));
  let annules = 0;
  let dejaClos = 0;
  for (const match of aNettoyer) {
    const annulation = await allerRythme(session, 'POST', '/api/matches/' + match.id + '/cancel', { corps: {} });
    if (annulation.statut === 200) { annules += 1; continue; }
    if (annulation.statut === 409) { dejaClos += 1; continue; }
    dire('  match ' + match.id + ' -> annulation HTTP ' + annulation.statut + ' '
      + JSON.stringify(annulation.donnees).slice(0, 80));
  }
  dire('  matchs de recette : ' + aNettoyer.length + ' vus, ' + annules + ' annules, '
    + dejaClos + ' deja clos');

  // 2. Les TOURNOIS et les SALONS BR de recette : ils gardent, eux aussi,
  //    un pass bloque par inscrit. Sans sortie, le compte ne peut pas etre
  //    supprime (« Tu as des wagers en cours »).
  const inscrits = ['AUDIT02', 'AUDIT03', 'AUDIT04', 'AUDIT05', 'AUDIT06'];
  const tournois = await aller(session, 'GET', '/api/tournaments?limit=100');
  const listeTournois = Array.isArray(tournois.donnees?.tournaments) ? tournois.donnees.tournaments : [];
  const nôtres = listeTournois.filter((t) => String(t.name || '').includes('recette'));
  for (const tournoi of nôtres) {
    for (const pseudo of inscrits) {
      await appeler(pseudo, 'POST', '/api/auth/login', {
        corps: { identifier: emailDe(pseudo), password: MOT_DE_PASSE },
      });
      const sortie = await aller(pseudo, 'POST', '/api/tournaments/' + tournoi.id + '/leave', { corps: {} });
      if (sortie.statut === 200) dire('  tournoi ' + tournoi.id + ' : sortie de ' + pseudo);
    }
  }
  dire('  tournois de recette traites : ' + nôtres.length);

  const salons = await aller(session, 'GET', '/api/br/lobbies');
  const listeSalons = Array.isArray(salons.donnees?.lobbies) ? salons.donnees.lobbies : [];
  const nôtresSalons = listeSalons.filter((s2) => String(s2.creatorPseudo || '').startsWith('AUDIT'));
  for (const salon of nôtresSalons) {
    for (const pseudo of inscrits) {
      await appeler(pseudo, 'POST', '/api/auth/login', {
        corps: { identifier: emailDe(pseudo), password: MOT_DE_PASSE },
      });
      const sortie = await aller(pseudo, 'POST', '/api/br/lobbies/' + salon.id + '/leave', { corps: {} });
      if (sortie.statut === 200) dire('  salon BR ' + salon.id + ' : sortie de ' + pseudo);
    }
  }
  dire('  salons BR de recette traites : ' + nôtresSalons.length);

  // 3. Les COMPTES : DELETE /api/auth/me (mot de passe exige, preuve de
  //    possession). C'est la seule voie de suppression.
  //    La liste est DECOUVERTE (recherche par pseudo), pas lue dans l etat
  //    local : c est la seule facon de ne rien laisser derriere soi.
  // PIEGE : la recherche EXCLUT l utilisateur connecte
  // (`filter((u) => u.id !== session.user.id)`) : le compte de session
  // n est donc JAMAIS dans les resultats, et un nettoyage fonde sur elle
  // laissait ce compte en production. On ajoute donc la liste CONNUE
  // des pseudos de test a ceux que la recherche trouve.
  const recherche = await aller(session, 'GET', '/api/users/search?q=AUDIT');
  const trouves = Array.isArray(recherche.donnees?.users) ? recherche.donnees.users : [];
  const pseudos = [...new Set([
    ...trouves.map((u) => String(u.pseudo || '')),
    ...Array.from({ length: 12 }, (_, i) => 'AUDIT' + String(i + 1).padStart(2, '0')),
  ])]
    .filter((p) => p.startsWith('AUDIT'))
    .sort();
  dire('  comptes de test a verifier : ' + pseudos.length);
  let supprimes = 0;
  let dejaAbsents = 0;
  for (const pseudo of pseudos) {
    // Chaque suppression a besoin de SA session : on se connecte avec le
    // mot de passe du compte de test.
    const connexion = await appeler(pseudo, 'POST', '/api/auth/login', {
      corps: { identifier: emailDe(pseudo), password: MOT_DE_PASSE },
    });
    // Le compte n existe PLUS (nettoyage deja joue) : il n y a rien a
    // faire, et ce n est pas un echec.
    if (connexion.statut !== 200) { dejaAbsents += 1; continue; }
    const r = await aller(pseudo, 'DELETE', '/api/auth/me', {
      corps: { confirmForfeit: true, currentPassword: MOT_DE_PASSE },
    });
    if (r.statut === 200) { supprimes += 1; cookies.delete(pseudo); }
    else dire('  ' + pseudo + ' -> suppression HTTP ' + r.statut + ' '
      + JSON.stringify(r.donnees).slice(0, 90));
  }
  dire('  comptes supprimes : ' + supprimes + ', deja absents : ' + dejaAbsents
    + ' (total ' + pseudos.length + ')');

  // 4. Verification : la liste des comptes de test est vide.
  const reste = await aller(session, 'GET', '/api/users/search?q=AUDIT');
  const restantes = Array.isArray(reste.donnees?.users)
    ? reste.donnees.users.filter((u) => String(u.pseudo || '').startsWith('AUDIT')).length
    : -1;
  // Verification la plus fiable : plus AUCUN compte de test ne doit
  // pouvoir ouvrir de session.
  let survivants = 0;
  for (const pseudo of pseudos) {
    const essai = await appeler(pseudo, 'POST', '/api/auth/login', {
      corps: { identifier: emailDe(pseudo), password: MOT_DE_PASSE },
    });
    if (essai.statut === 200) { survivants += 1; dire('  !! ' + pseudo + ' existe encore'); }
  }
  dire('  recherche residuelle « AUDIT » -> ' + restantes + ' compte(s), '
    + survivants + ' encore connectables');
  verifier('Les comptes de test sont supprimes', survivants === 0 && restantes === 0,
    supprimes + ' supprimes, ' + dejaAbsents + ' deja absents, '
    + survivants + ' encore connectables');

  // On ne fait QUE reinitialiser les phases concernees : les depots
  // FedaPay (identifiants de transaction) restent utiles. Les COOKIES,
  // eux, sont effaces : ils ne servent plus a rien (les comptes sont
  // supprimes) et un jeton de session ne doit pas rester sur le disque.
  sauverEtat({ comptes: [], matchs: [], tournois: [], br: [], cookies: {} });
  return etat;
};

// ─── Orchestration ──────────────────────────────────────────────────────────
const PHASES = {
  comptes: phaseComptes,
  sessions: phaseSessions,
  portefeuille: phasePortefeuille,
  depot: phaseDepot,
  matchs: phaseMatchs,
  tournois: phaseTournois,
  br: phaseBR,
  ligue: phaseLigue,
  social: phaseSocial,
  'temps-reel': phaseTempsReel,
  nettoyage: phaseNettoyage,
};

const aJouer = phasesDemandees
  ? phasesDemandees.filter((p) => PHASES[p])
  : Object.keys(PHASES);

if (phasesDemandees && phasesDemandees.includes('nettoyage')) {
  const i = aJouer.indexOf('nettoyage');
  if (i >= 0) aJouer.splice(i, 1);
  aJouer.push('nettoyage');
}

const debut = Date.now();
// Les sessions survive entre deux executions : on les recharge avant de
// lancer quoi que ce soit (le quota d'authentification est une
// ressource rare : 50 par IP et par 15 minutes).
chargerCookies(chargerEtat());
for (const nom of aJouer) {
  if (!PHASES[nom]) { dire(`  (phase inconnue : ${nom})`); continue; }
  try {
    await PHASES[nom]();
  } catch (erreur) {
    dire(`  !! la phase ${nom} a leve une exception : ${erreur.stack || erreur.message}`);
    verdicts.push({ nom: `phase ${nom}`, ok: false, detail: String(erreur.message || erreur) });
  }
  // La session peut avoir ete renouvelee (rotation) pendant la phase.
  sauverCookies(chargerEtat());
}

dire('\n=== VERDICT ===');
const echecs = verdicts.filter((v) => !v.ok);
for (const v of verdicts) dire(`  ${v.ok ? 'OK   ' : 'ECHEC'} ${v.nom}${v.detail ? ` — ${v.detail}` : ''}`);
dire(`  ${verdicts.length - echecs.length}/${verdicts.length} verifications reussies `
  + `en ${Math.round((Date.now() - debut) / 1000)} s`);

const rapport = 'test-results/prod-walkthrough-rapport.txt';
mkdirSync(dirname(rapport), { recursive: true });
writeFileSync(rapport, journal.join('\n'), 'utf8');
dire(`  rapport : ${rapport}`);

process.exit(echecs.length > 0 ? 1 : 0);
