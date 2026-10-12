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