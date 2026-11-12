import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Un rejeu OCC doit resynchroniser les index d'identite.
 *
 * Le scenario
 * -----------
 * L'OCC compare une revision lue avant l'ecriture. Si l autre instance
 * ecrit ENTRE notre lecture et notre ecriture, notre ecriture CONFLIT :
 * le rejeu repart de l etat frais, et le payload RETENU peut alors porter
 * une identite differente de celle que nous avions calculee.
 *
 * Cas le plus grave : l autre instance RETROGRADE un administrateur. Notre
 * updater (une mutation de portefeuille, par exemple) ne touche pas au
 * role. Le payload rejete porte donc `role: 'player'` - mais les index
 * memoriaux, eux, restaient sur l ancien payload : `memoryAdminIds`
 * conservait le compte. Un admin retrograde gardait ses droits depuis
 * cette instance, jusqu a la prochaine ecriture de ce compte (ou le
 * redemarrage).
 *
 * PIEGE DU TEST : la retrogradation doit arriver ENTRE la lecture et
 * l'ecriture. Si elle est deja en base quand on lit, l'adoption de l etat
 * frais (qui precede le rejeu) corrige deja les index, et le test passe
 * meme sans le correctif : il ne testerait plus rien.
 *
 * Ce que le test garantit
 * -----------------------
 * 1. Apres un rejeu, l index des administrateurs suit le payload RETENU.
 * 2. Le meme pour le pseudo : un joueur change de pseudo reste trouvable.
 * 3. Hors conflit, le comportement est inchange.
 */

/** Ligne `app_users` simulee, pilotable par le test. */
const h = vi.hoisted(() => ({
  row: null,
  // Payload que l autre instance pose ENTRE notre lecture et notre ecriture.
  payloadApresConflit: null,
  // Le prochain ecriture conditionnelle doit CONFLITER.
  conflitArme: false,
}));

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn((table) => {
      const q = {};
      q._select = null;
      q._patch = null;
      q._upsert = null;
      q.select = vi.fn((cols) => { q._select = cols; return q; });
      q.update = vi.fn((patch) => { q._patch = patch; return q; });
      q.upsert = vi.fn((payload) => { q._upsert = payload; return q; });
      q.insert = vi.fn(() => q);
      q.delete = vi.fn(() => q);
      q.eq = vi.fn(() => q);
      q.limit = vi.fn(() => q);
      q.in = vi.fn(() => q);
      q.then = (resoudre) => {
        if (table !== 'app_users') return Promise.resolve({ data: [], error: null }).then(resoudre);

        if (q._upsert) {
          h.row = { ...q._upsert, revision: 0 };
          return Promise.resolve({ data: [], error: null }).then(resoudre);
        }

        if (q._patch) {
          if (!h.row) return Promise.resolve({ data: [], error: null }).then(resoudre);
          // L AUTRE INSTANCE ECRIT : elle fait avancer la revision et
          // change l identite. Notre ecriture conditionnelle porte donc une
          // revision perimee -> 0 ligne touchee -> CONFLIT.
          if (h.conflitArme) {
            h.conflitArme = false;
            h.row = {
              ...h.row,
              revision: h.row.revision + 1,
              payload: h.payloadApresConflit,
            };
            return Promise.resolve({ data: [], error: null }).then(resoudre);
          }
          if (q._patch.revision !== h.row.revision + 1) {
            return Promise.resolve({ data: [], error: null }).then(resoudre);
          }
          h.row = { ...h.row, ...q._patch, revision: q._patch.revision };
          return Promise.resolve({ data: [{ id: h.row.id }], error: null }).then(resoudre);
        }

        if (!h.row) return Promise.resolve({ data: [], error: null }).then(resoudre);
        return Promise.resolve({
          data: [{ id: h.row.id, revision: h.row.revision, payload: h.row.payload }],
          error: null,
        }).then(resoudre);
      };
      return q;
    }),
  },
}));

import {
  updateUserAccount,
  forceUserCache,
  getAdminIds,
  getUserByExactPseudo,
  setOccSupportePourTest,
} from './persistence.mjs';

const PAYLOAD_ADMIN = {
  id: 'u-admin-1',
  pseudo: 'AdminConcurrent',
  email: 'admin-concurrent@test.local',
  phone: '+2250700000001',
  role: 'admin',
  trustScore: 100,
  wallet: { cashBalance: 100, bonusBalance: 0, lockedBalance: 0, lockedEntries: {}, transactions: [] },
  stats: {},
  progression: {},
};

beforeEach(() => {
  setOccSupportePourTest(true);
  h.row = { id: PAYLOAD_ADMIN.id, revision: 0, payload: { ...PAYLOAD_ADMIN } };
  h.payloadApresConflit = { ...PAYLOAD_ADMIN };
  h.conflitArme = false;
  // Le memoire de l instance voit l admin, AVANT que l autre instance ne
  // le retrograde.
  forceUserCache(PAYLOAD_ADMIN.id, { ...PAYLOAD_ADMIN });
});

/** Notre updater : une mutation de portefeuille, qui ne touche PAS au role. */
const updaterPortefeuille = (user) => ({
  ...user,
  wallet: { ...user.wallet, cashBalance: user.wallet.cashBalance + 10 },
});

describe('OCC — le rejeu resynchronise les index d identite', () => {
  it('un admin retrograde par le rejeu ne garde pas ses droits', async () => {
    // L autre instance retrograde le role ET avance la revision, entre
    // notre lecture et notre ecriture.
    h.payloadApresConflit = { ...PAYLOAD_ADMIN, role: 'player' };
    h.conflitArme = true;

    await updateUserAccount(PAYLOAD_ADMIN.id, updaterPortefeuille);

    // Le payload retenu porte la retrogradation...
    expect(getAdminIds(), 'un admin retrograde ne doit plus etre admin').not.toContain(PAYLOAD_ADMIN.id);
  });

  it('le pseudo reste trouvable apres un rejeu', async () => {
    h.payloadApresConflit = { ...PAYLOAD_ADMIN, pseudo: 'RenommeConcurrent' };
    h.conflitArme = true;

    await updateUserAccount(PAYLOAD_ADMIN.id, updaterPortefeuille);

    // Le pseudo retenu doit etre indexe : le joueur reste connectable.
    expect(getUserByExactPseudo('RenommeConcurrent'), 'le pseudo retenu doit rester trouvable').toBeTruthy();
  });

  it('hors conflit, l index des administrateurs suit le role', async () => {
    await updateUserAccount(PAYLOAD_ADMIN.id, (user) => ({ ...user, role: 'player' }));
    expect(getAdminIds()).not.toContain(PAYLOAD_ADMIN.id);
  });
});
