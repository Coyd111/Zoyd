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
    const sante = source.slice(
      source.indexOf('export const getHealthInfo'),
      source.indexOf('export const getHealthInfo') + 2000,
    );
    // Render injecte ces variables automatiquement.
    expect(sante).toContain('RENDER_GIT_COMMIT');
    expect(sante).toContain('RENDER_GIT_BRANCH');
  });

  it('ne divulgue ni cle ni jeton par cette porte', () => {
    const source = readPersistence();
    const sante = source.slice(
      source.indexOf('export const getHealthInfo'),
      source.indexOf('export const getHealthInfo') + 2000,
    );
    // /api/health est public : il ne doit rien renvoyer qui permette de
    // monter une requete authentifiee.
    expect(sante).not.toContain('METRICS_TOKEN');
    expect(sante).not.toContain('ADMIN_PASSWORD');
    expect(sante).not.toContain('SUPABASE_SERVICE');
    expect(sante).not.toContain('RESEND_API_KEY');
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