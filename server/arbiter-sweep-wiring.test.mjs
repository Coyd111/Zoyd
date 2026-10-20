import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le balayage d'arbitre est-il REELLEMENT branche ?
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * `sweepMatchesWithoutArbiter` a ete ecrit, documente, et teste — pendant
 * longtemps, il n'etait appele par PERSONNE. Aucun cron, aucune route, aucun
 * tick. Les delais de 2 h par phase n'etaient donc pas appliques : un match
 * sans arbitre restait en sequestre indefiniment.
 *
 * `arbiter-sweep.test.mjs` testait la FONCTION. Il passait. Il ne prouvait
 * rien : une fonction correcte et jamais appelée est un morceau de code mort,
 * et un test vert sur du code mort est une fausse assurance — precisement ce
 * que ce projet traque depuis le début.
 *
 * Ce fichier teste donc le CHEMIN COMPLET : ce que fait reellement le tick
 * d'automatisation, celui que le serveur appelle toutes les 30 secondes.
 */

vi.mock('./persistence.mjs', () => ({
  applyUserSettlementOnce: vi.fn(async (userId, _key, updater) => updater({ id: userId, stats: {}, progression: {} })),
  getUserById: vi.fn((id) => ({
    id, pseudo: id, role: 'player', trustScore: 100, stats: {}, progression: {},
    wallet: { cashBalance: 0, bonusBalance: 0, lockedBalance: 0, lockedEntries: {}, transactions: [] },
  })),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((v) => String(v || '').trim()),
}));

const rembourses = [];
vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(async (userId, matchId, raison) => { rembourses.push({ userId, matchId, raison }); }),
  releaseWalletWinnings: vi.fn(),
  settleMatchLossWallet: vi.fn(),
}));

import { processMatchAutomationOnServer, runMatchAutomationOnServer } from './match-engine.mjs';

const H = 60 * 60 * 1000;
const ilYA = (ms) => new Date(Date.now() - ms).toISOString();

const matchSquelette = (surcharge = {}) => ({
  id: 'M-1',
  status: 'check_in',
  createdAt: ilYA(5 * H),
  players: [{ userId: 'p-1' }, { userId: 'p-2' }],
  disputes: [],
  prizePool: 1000,
  ...surcharge,
});

beforeEach(() => { rembourses.length = 0; vi.clearAllMocks(); });

describe('Le tick d automatisation rembourse ce que personne ne surveillait', () => {
  it("l automatisation SEULE ne touche pas un match sans arbitre ni horaire", async () => {
    // Le cas le plus fréquent : un match créé, jamais programmé, personne ne
    // s'inscrit comme arbitre. L'automatisation le saute — elle ne raisonne
    // qu'en `scheduledAt`. C'est le trou que le balayage comble.
    const match = matchSquelette();

    const res = await processMatchAutomationOnServer([match]);

    expect(res.changed).toBe(false);
    expect(rembourses).toHaveLength(0);
    expect(res.matches[0].status).toBe('check_in');
  });

  it('le tick COMPLET rembourse ce match-la', async () => {
    const match = matchSquelette();

    const res = await runMatchAutomationOnServer([match]);

    expect(res.refunded).toEqual([{ matchId: 'M-1', reason: 'NO_ARBITER' }]);
    expect(rembourses.map((r) => r.userId).sort()).toEqual(['p-1', 'p-2']);
    expect(res.matches[0].status).toBe('cancelled');
    expect(res.changed).toBe(true);
  });

  it('NE REMBOURSE PAS deux fois un match que l automatisation vient d annuler', async () => {
    // Le recoupement des deux mecanismes. Match programme pour l heure
    // passee, sans arbitre : l'automatisation l'annule, le balayage le voit
    // ensuite en `cancelled` et l'ignore.
    const match = matchSquelette({ scheduledAt: ilYA(1 * H) });

    const res = await runMatchAutomationOnServer([match]);

    // Deux remboursements : un par joueur, PAS quatre.
    expect(rembourses).toHaveLength(2);
    expect(res.refunded).toEqual([]);
  });

  it('ne touche pas un match recent', async () => {
    // Garde-fou : le tick ne doit pas annuler tout ce qui bouge.
    const match = matchSquelette({ createdAt: ilYA(30 * 60 * 1000) });

    const res = await runMatchAutomationOnServer([match]);

    expect(res.refunded).toEqual([]);
    expect(rembourses).toHaveLength(0);
    expect(res.matches[0].status).toBe('check_in');
  });

  it('laisse un litige ouvert a l admin', async () => {
    const match = matchSquelette({ disputes: [{ status: 'open' }] });

    const res = await runMatchAutomationOnServer([match]);

    expect(res.refunded).toEqual([]);
    expect(rembourses).toHaveLength(0);
  });

  it('rembourse un arbitre en poste qui ne tranche pas', async () => {
    // Phase B : le match a demarre, l'arbitre s est tu. L'argent ne doit pas
    // rester en sequestre au seul motif que l'arbitre a disparu.
    const match = matchSquelette({
      status: 'in_progress',
      arbiter: { userId: 'p-arb', assignedAt: ilYA(5 * H) },
      startedAt: ilYA(3 * H),
    });

    const res = await runMatchAutomationOnServer([match]);

    expect(res.refunded).toEqual([{ matchId: 'M-1', reason: 'ARBITER_TIMEOUT' }]);
    expect(rembourses).toHaveLength(2);
  });
});
