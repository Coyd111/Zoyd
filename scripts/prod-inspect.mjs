/**
 * scripts/prod-inspect.mjs - Inspection de la production, en LECTURE SEULE.
 *
 * Pourquoi cet outil existe
 * -------------------------
 * La production n'est observable que par trois canaux : la sonde publique
 * `/api/health`, les logs Render, et le SQL Editor de Supabase. Aucun ne
 * permet de repondre simplement a « les bails de cron sont-ils reellement
 * pris ? » — question qui a mis au jour deux defauts de production (un
 * INSERT refuse pour un BIGINT, et une sonde memorisee definitivement).
 *
 * Cet outil donne la reponse en une commande, sans passer par un navigateur.
 *
 * Securite
 * --------
 * 1. LECTURE SEULE : il n'emet QUE des `select()`. Aucune ecriture, aucun
 *    `insert`, `update` ou `delete` n'existe dans ce fichier.
 * 2. CREDENTIALS A PART : il lit `SUPABASE_URL` et `SUPABASE_SERVICE_KEY`
 *    dans `.env.production.local` (fichier dedie, ignore par git). Il ne
 *    touche JAMAIS `.env.server`, qui reste sur des valeurs de gabarit.
 *
 *    C'est deliberé : `.env.server` est lu par `server/supabase.mjs` au
 *    demarrage du serveur local. Y mettre les identifiants de production
 *    ferait tourner un DEUXIEME serveur contre la base de production — donc
 *    un second instance, des crons en double, des versements en double. Le
 *    fichier dedie rend ce scenario impossible par construction.
 *
 * 3. AUCUN SECRET AFFICHE : les identifiants ne sont jamais imprimes. Seule
 *    l'URL du projet l'est (elle est publique dans le bundle du front).
 *
 * Usage
 * -----
 *   node scripts/prod-inspect.mjs              # vue d'ensemble
 *   node scripts/prod-inspect.mjs leases        # detail des bails de cron
 *   node scripts/prod-inspect.mjs users <pseudo>
 *   node scripts/prod-inspect.mjs matches
 *
 * Configuration (une seule fois) : creer `.env.production.local` a la racine
 * du depot avec :
 *
 *   SUPABASE_URL=https://<projet>.supabase.co
 *   SUPABASE_SERVICE_KEY=<cle service_role>
 *
 * Le fichier est ignore par git (`.env.*`), donc il ne part jamais sur le
 * depot.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FICHIER_CREDENTIALS = '.env.production.local';
const RACINE = resolve(process.cwd());

/**
 * Lit un fichier `cle=valeur` sans toucher a `process.env`.
 *
 * On evite `dotenv` volontairement : cet outil ne doit RIEN modifier
 * l'environnement du processus appelant (un `require` de ce fichier depuis un
 * autre script ne doit pas injecter de variable par surprise).
 */
const lireFichierEnv = (chemin) => {
  const valeurs = {};
  if (!existsSync(chemin)) return valeurs;
  for (const ligne of readFileSync(chemin, 'utf8').split(/\r?\n/)) {
    const texte = ligne.trim();
    if (!texte || texte.startsWith('#')) continue;
    const position = texte.indexOf('=');
    if (position <= 0) continue;
    const cle = texte.slice(0, position).trim();
    let valeur = texte.slice(position + 1).trim();
    // Retire les guillemets eventuels.
    if ((valeur.startsWith('"') && valeur.endsWith('"'))
      || (valeur.startsWith("'") && valeur.endsWith("'"))) {
      valeur = valeur.slice(1, -1);
    }
    valeurs[cle] = valeur;
  }
  return valeurs;
};

const configuration = lireFichierEnv(resolve(RACINE, FICHIER_CREDENTIALS));
const url = configuration.SUPABASE_URL || process.env.SUPABASE_URL || '';
const cle = configuration.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

const echouer = (message) => {
  console.error(`\n  ERREUR : ${message}\n`);
  process.exit(1);
};

if (!url || !cle) {
  echouer(
    `identifiants de production absents.\n`
    + `  Créez ${FICHIER_CREDENTIALS} a la racine du depot :\n\n`
    + `      SUPABASE_URL=https://<projet>.supabase.co\n`
    + `      SUPABASE_SERVICE_KEY=<cle service_role>\n\n`
    + `  Ce fichier est ignore par git.`,
  );
}

if (url.includes('YOUR_PROJECT')) {
  echouer(
    `SUPABASE_URL est encore la valeur de gabarit ("${url}").\n`
    + `  Remplacez-la par l'URL reelle du projet Supabase.`,
  );
}

const { createClient } = await import('@supabase/supabase-js');
const supabase = createClient(url, cle, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const section = (titre) => console.log(`\n=== ${titre} ===`);

/** Les bails de cron : la table qui porte la protection multi-instance. */
const inspecterBails = async () => {
  section('BAILS DE CRON (cron_leases)');
  const { data, error } = await supabase
    .from('cron_leases')
    .select('job_name, holder, acquired_at, expires_at')
    .order('job_name');

  if (error) {
    console.log(`  table inaccessible : ${error.message}`);
    return;
  }

  if (!data || data.length === 0) {
    console.log('  AUCUN bail. La table existe mais aucun job ne l a encore prise.');
    console.log('  (Normal dans les minutes qui suivent un redemarrage : les bails');
    console.log('   sont rendus a la fin de chaque job.)');
    return;
  }

  const maintenant = Date.now();
  for (const bail of data) {
    const typeAcquis = typeof bail.acquired_at === 'number' ? 'entier' : typeof bail.acquired_at;
    const typeExpire = typeof bail.expires_at === 'number' ? 'entier' : typeof bail.expires_at;
    const restant = Math.round((bail.expires_at - maintenant) / 1000);
    console.log(`  ${bail.job_name}`);
    console.log(`      detenu par : ${bail.holder}`);
    console.log(`      expire dans : ${restant} s`);
    console.log(`      types       : acquired_at=${typeAcquis}, expires_at=${typeExpire}`);
    if (typeof bail.expires_at !== 'number' || typeof bail.acquired_at !== 'number') {
      console.log('      !! ATTENTION : type non entier. Postgres refuserait cet INSERT');
      console.log('         (« invalid input syntax for type bigint ») : le bail ne serait');
      console.log('         JAMAIS pris, et la protection multi-instance resterait inactive.');
    }
  }
};

/** Le nombre de joueurs : le registre d'idempotence suit cette population. */
const inspecterJoueurs = async (pseudo) => {
  section(pseudo ? `JOUEUR ${pseudo}` : 'JOUEURS');
  let requete = supabase.from('app_users').select('id, pseudo, role, updated_at');
  if (pseudo) requete = requete.eq('pseudo', pseudo);
  const { data, error } = await requete.limit(pseudo ? 5 : 10).order('updated_at', { ascending: false });
  if (error) {
    console.log(`  lecture impossible : ${error.message}`);
    return;
  }
  for (const joueur of data || []) {
    console.log(`  ${joueur.pseudo} (${joueur.id}) role=${joueur.role}`);
  }
  if (!data || data.length === 0) console.log('  aucun resultat');
};

/** Les matchs : l'etat partage que les crons balayent. */
const inspecterMatchs = async () => {
  section('ETAT DES MATCHS');
  const { data, error } = await supabase
    .from('state_snapshots')
    .select('kind, entity_id, updated_at')
    .eq('kind', 'matches')
    .limit(20);
  if (error) {
    console.log(`  lecture impossible : ${error.message}`);
    return;
  }
  console.log(`  ${(data || []).length} match(s) :`);
  for (const ligne of data || []) {
    console.log(`      ${ligne.entity_id} (maj ${ligne.updated_at})`);
  }
};

/** La sonde publique : ce que voit un operateur sans se connecter. */
const inspecterSante = async () => {
  section('SONDE PUBLIQUE');
  for (const cible of ['https://zoyd.onrender.com/api/health']) {
    try {
      const reponse = await fetch(cible, { signal: AbortSignal.timeout(15_000) });
      const corps = await reponse.json();
      const persistance = corps?.persistence || {};
      console.log(`  ${cible}`);
      console.log(`      commit deployed   : ${persistance.deployedCommitShort || '?'}`);
      console.log(`      instance          : ${persistance.instanceId || '?'}`);
      console.log(`      etat fiable        : ${persistance.stateTrusted}`);
      console.log(`      bail cron actif   : ${persistance.cronLeaseAvailable}`);
      console.log(`      integrite         : ${persistance.integrityOk}`);
    } catch (err) {
      console.log(`  ${cible} : injoignable (${err?.message})`);
    }
  }
};

const commande = process.argv[2] || 'vue';
switch (commande) {
  case 'leases':
    await inspecterBails();
    break;
  case 'users':
    await inspecterJoueurs(process.argv[3]);
    break;
  case 'matches':
    await inspecterMatchs();
    break;
  case 'sante':
    await inspecterSante();
    break;
  default:
    await inspecterSante();
    await inspecterBails();
    break;
}

process.exit(0);
