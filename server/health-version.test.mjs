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

describe('health — identification du deploiement', () => {
  it('expose le commit deploye', () => {
    const source = readPersistence();
    // 4000 et non 2000 : les commentaires exposent des champs entre les deux ;
    // un span fige au caractere ferait rater RENDER_GIT_COMMIT a la premiere
    // insertion honnete dans getHealthInfo.
    const sante = source.slice(
      source.indexOf('export const getHealthInfo'),
      source.indexOf('export const getHealthInfo') + 4000,
    );
    // Render injecte ces variables automatiquement.
    expect(sante).toContain('RENDER_GIT_COMMIT');
    expect(sante).toContain('RENDER_GIT_BRANCH');
  });

  it('ne divulgue ni cle ni jeton par cette porte', () => {
    const source = readPersistence();
    const sante = source.slice(
      source.indexOf('export const getHealthInfo'),
      source.indexOf('export const getHealthInfo') + 4000,
    );
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
    const source = readPersistence();
    // Le span des tests existants (2000 car.) s'arrete avant l'ajout ; on
    // elargit pour que le test continue de tenir si l'ordre des champs bouge.
    const sante = source.slice(
      source.indexOf('export const getHealthInfo'),
      source.indexOf('export const getHealthInfo') + 4000,
    );
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
    const source = readPersistence();
    // Fenetre large : le bloc dettes est plus loin dans l objet que les
    // identifiants de deploiement testes plus haut.
    const sante = source.slice(
      source.indexOf('export const getHealthInfo'),
      source.indexOf('export const getHealthInfo') + 6000,
    );
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
  const lireRoute = () => readFileSync(resolve('server/routes/public.mjs'), 'utf8');

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
    const source = lireRoute();
    const bloc = source.slice(
      source.indexOf('cronLeaseAvailable'),
      source.indexOf('cronLeaseAvailable') + 2000,
    );
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