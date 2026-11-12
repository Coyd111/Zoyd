import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Le deploiement en cours doit etre identifiable sans aller lire les logs.
//
// On s'en est apercu parce qu'un log de deploiement d'une version ANCIENNE
// (avec un avertissement deja corrige) a ete lu comme l'etat courant : le
// correctif recusait d'etre en ligne alors qu'il l'etait. Sans identifiant de
// version dans `/api/health`, rien ne distinguait « pas deploye » de « deploye
// ailleurs » — ni moi, ni l'ecran Render.
//
// Ce test lit la SOURCE : `/api/health` est assemble a la main, la seule
// garantie tient donc a ce que getHealthInfo expose reellement.
// ─────────────────────────────────────────────────────────────────────────────

const readPersistence = () => readFileSync(resolve('server/persistence.mjs'), 'utf8');

/**
 * Extrait le CORPS de `getHealthInfo`.
 *
 * PIEGE : une fenetre de caracteres fixe casse des que le corps s allonge.
 * L ajout honnete d un champ de sonde suffisait a faire echouer un test
 * qui ne verifiait rien de faux : le test echouait sur la TAILLE, pas sur
 * le fond. On lit donc la fonction jusqu a sa fermeture reelle.
 */
const lireHealthInfo = () => {
  const source = readPersistence();
  const debut = source.indexOf('export const getHealthInfo');
  return source.slice(debut, source.indexOf('\n});', debut));
};

/** La route publique qui sert la sonde. */
const lireRoute = () => readFileSync(resolve('server/routes/public.mjs'), 'utf8');

/**
 * Extrait la ROUTE `/api/health` de `public.mjs`.
 *
 * Meme raison que `lireHealthInfo` : une fenetre de caracteres fixe est
 * un coupeur trop court (elle laisse passer ce qu elle ne couvre pas) et
 * un coupeur trop fragile (elle casse des que la route s allonge). On lit
 * donc la route entiere, depuis son debut jusqu a la route suivante.
 */
const lireRouteHealth = () => {
  const source = lireRoute();
  const debut = source.indexOf("pathname === '/api/health'");
  const fin = source.indexOf("pathname === '/api/realtime/health'");
  expect(debut, 'la route /api/health doit exister').toBeGreaterThan(-1);
  expect(fin, 'la route /api/health doit etre suivie d une autre route').toBeGreaterThan(debut);
  return source.slice(debut, fin);
};

describe('health — identification du deploiement', () => {
  it('expose le commit deploye', () => {
    const sante = lireHealthInfo();
    // Render injecte ces variables automatiquement.
    expect(sante).toContain('RENDER_GIT_COMMIT');
    expect(sante).toContain('RENDER_GIT_BRANCH');
  });

  it('ne divulgue ni cle ni jeton par cette porte', () => {
    const sante = lireHealthInfo();
    // /api/health est public : il ne doit rien renvoyer qui permette de
    // monter une requete authentifiee.
    expect(sante).not.toContain('METRICS_TOKEN');
    expect(sante).not.toContain('ADMIN_PASSWORD');
    expect(sante).not.toContain('SUPABASE_SERVICE');
    expect(sante).not.toContain('RESEND_API_KEY');
  });
});

describe('health — sonde secret 2FA admin', () => {
  it('expose adminTotpPersisted et sa cause d\'echec', () => {
    const sante = lireHealthInfo();
    expect(sante).toContain('adminTotpPersisted');
    expect(sante).toContain('adminTotpError');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Une alerte doit distinguer « un joueur attend de l'argent » de « l'argent ne
// peut plus revenir ».
//
// Le 17/10, `/api/health` affichait `pendingSettlementDebts.leagues = 7` sans
// dire de quoi il s'agissait. Le chiffre additionnait deux choses opposees :
// des remboursements rejoues toutes les 6 h, et des `uncollectableRefunds`
// (compte supprime) que rien ne soldera jamais. Consequence concrete : le
// indicateur restait a 7 indefiniment, donc on ne pouvait plus l'utiliser comme
// signal — le seul signe fiable aurait ete de leScruter a chaque fois.
// ─────────────────────────────────────────────────────────────────────────────
describe('health — dettes de reglement', () => {
  it('separe les dettes rejouables des dettes definitivement perdues', () => {
    const source = readPersistence();
    const debut = source.indexOf('const splitPendingDebts');
    expect(debut, 'splitPendingDebts doit exister').toBeGreaterThan(-1);

    const corps = source.slice(debut, source.indexOf('};', debut));
    // Les deux categories doivent etre comptees separement...
    expect(corps).toContain('retryable');
    expect(corps).toContain('uncollectable');
    // ...et l'abandon ne doit jamais etre recompte comme une dette a recouvrer.
    expect(corps).toMatch(/retryable \+= payouts \+ refunds;/);
    expect(corps).toMatch(/uncollectable \+= abandoned;/);
  });

  it('publie la decomposition, pas une somme brute', () => {
    const sante = lireHealthInfo();
    expect(sante).toContain('pendingSettlementDebts');
    for (const kind of ['matches', 'leagues', 'tournaments']) {
      expect(sante).toContain(`splitPendingDebts('${kind}')`);
    }
  });

  it('ne reclasse plus les abandons dans le total des dettes', () => {
    const source = readPersistence();
    // L'ancien compteur somma payouts + refunds + uncollectable en un seul
    // entier : c'est exactement la confusion qu'on supprime.
    expect(source).not.toMatch(/total \+= payouts \+ refunds \+ uncollectable;/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Les COMPTEURS du bail de cron, dans la sonde publique.
//
// Pourquoi des compteurs en plus du booleen `cronLeaseAvailable`
// ---------------------------------------------------------------
// En production, la table `cron_leases` etait VISIBLE (`available: true`)
// alors que chaque INSERT echouait sur un BIGINT : le bail n'etait donc
// JAMAIS pris, et la protection multi-instance promise n'existait pas. Un
// operateur qui lisait seulement le booleen croyait l'inverse.
//
// Les compteurs repondent a « la protection FONCTIONNE-t-elle ? » :
// `cronLeaseErrors` et `cronLeaseDegraded` doivent rester a ZERO en regime
// normal. `cronLeaseAcquired` doit monter.
//
// INVARIANT : la sonde est PUBLIQUE. Elle ne peut donc rien divulguer qui
// permette de monter une requete authentifiee. Des compteurs ne le font pas :
// ils ne disent ni qui, ni quoi, ni combien d'argent.
// ─────────────────────────────────────────────────────────────────────────────
describe('health — compteurs du bail de cron', () => {
  it('la sonde publie les quatre compteurs', () => {
    const source = lireRoute();
    for (const champ of [
      'cronLeaseAcquired',
      'cronLeaseRefused',
      'cronLeaseErrors',
      'cronLeaseDegraded',
    ]) {
      expect(source, `${champ} doit etre publie`).toContain(champ);
    }
  });

  it('le booleen de disponibilite reste publie a cote', () => {
    // Le booleen et les compteurs ne se remplacent pas : l un dit si la
    // table est visible, les autres si la protection FONCTIONNE.
    expect(lireRoute()).toContain('cronLeaseAvailable');
  });

  it('les compteurs viennent bien du module du bail', () => {
    const source = lireRoute();
    // Un compteur publie a la main (un `?? 0` pose dans la route) serait
    // toujours a zero : l anomalie ne remonterait jamais.
    expect(source).toMatch(/health\.cronLease \? health\.cronLease\.acquis : null/);
    expect(source).toMatch(/health\.cronLease \? health\.cronLease\.refuses : null/);
    expect(source).toMatch(/health\.cronLease \? health\.cronLease\.erreurs : null/);
    expect(source).toMatch(/health\.cronLease \? health\.cronLease\.degrades : null/);
  });

  it('la sonde ne divulgue ni le detenteur du bail ni un secret', () => {
    // PIEGE : la sonde est PUBLIQUE. Elle ne peut rien divulguer qui
    // permette de monter une requete authentifiee.
    //
    // On verifie la ROUTE ENTIERE, et non une fenetre de caracteres autour
    // d un champ : une fenetre (fixe) laissait passer ce qu elle ne
    // couvrait pas, et cassait des que la route s allongeait.
    const bloc = lireRouteHealth();
    // Le detenteur du bail est l identite de l instance : la publier
    // donnerait la topologie du deploiement. Le bloc des compteurs ne doit
    // donc contenir que des NOMBRES.
    expect(bloc).not.toContain('holder');
    expect(bloc).not.toContain('job_name');
    expect(bloc).not.toContain('METRICS_TOKEN');
    expect(bloc).not.toContain('SUPABASE_SERVICE');
  });

  it('les compteurs sont incrementes a chaque issue du bail', () => {
    const source = readFileSync(resolve('server/cron-lease.mjs'), 'utf8');
    // Un compteur declare mais jamais incremente vaut zero : l anomalie
    // resterait invisible. Les quatre issues doivent etre comptees.
    expect(source).toMatch(/compteurs\.acquis \+= 1;/);
    expect(source).toMatch(/compteurs\.refuses \+= 1;/);
    expect(source).toMatch(/compteurs\.erreurs \+= 1;/);
    expect(source).toMatch(/compteurs\.degrades \+= 1;/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L ETAT de la purge de l historique des bails, dans la sonde publique.
//
// Pourquoi c'est indispensable
// -----------------------------
// La purge echouait EN SILENCE : un `LIMIT` invalide sur le DELETE
// (`DELETE ... RETURNING id LIMIT n` = erreur SQL 42601). La table
// grossissait de ~4 300 lignes par jour sans borne, et AUCUN signal ne le
// disait : ni les logs d operateur, ni la sonde.
//
// Un echec invisible est un echec qui se reproduit. L etat de purge est
// donc publie : `cronLeaseAuditPurgeError` non vide = la purge ECHOUE.
// ─────────────────────────────────────────────────────────────────────────────
describe('health — etat de la purge de l historique des bails', () => {
  it('la sonde publie l erreur et l horodatage de purge', () => {
    const source = lireRoute();
    expect(source, 'cronLeaseAuditPurgeError doit etre publie').toContain('cronLeaseAuditPurgeError');
    expect(source, 'cronLeaseAuditPurgedAt doit etre publie').toContain('cronLeaseAuditPurgedAt');
  });

  it('les valeurs viennent bien du module d historique', () => {
    // Un `null` pose a la main dans la route serait toujours vide : l
    // echec resterait invisible, exactement comme avant le correctif.
    const source = lireRoute();
    expect(source).toMatch(/health\.cronLeaseAuditPurge\s*\?\s*health\.cronLeaseAuditPurge\.derniereErreur\s*:\s*null/);
    expect(source).toMatch(/health\.cronLeaseAuditPurge\s*\?\s*health\.cronLeaseAuditPurge\.dernierSuccesAt\s*:\s*null/);
  });

  it('la persistance publie l etat de purge', () => {
    const source = readPersistence();
    expect(source).toContain('cronLeaseAuditPurge');
    expect(source).toContain('getCronLeaseAuditPurgeHealth');
  });
});