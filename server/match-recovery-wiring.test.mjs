import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CABLAGE des deux jobs de reprise de matchs de `server/cron.mjs` (C3).
 *
 * Meme principe qu'`arbiter-fee-wiring.test.mjs` et `br-write-inside-lock` :
 * un mecanisme correct jamais branche au bon endroit est un bug silencieux.
 * Ici on verrouille le CHOIX DES CIBLES et le cycle d'ecriture :
 *   1. `sweepPendingSettlements` vise le reglement interrompu (pending sans
 *      deadline) ET le match `disputed` au litige CLOS — pas les matchs
 *      `awaiting_confirmation` (fenetre ouverte) ni les litiges OUVERTS ;
 *   2. un reglement en echec isole ne prive pas les autres, et l'ecriture
 *      repasse par le resultat du MOTEUR (pas par l'instantane initial) ;
 *   3. la garde anti-chevauchement du tick est effective ;
 *   4. `sweepExpiredConfirmations` alimente le moteur puis n'ecrit QUE si
 *      quelque chose a change.
 */

const h = vi.hoisted(() => {
  const etat = new Map(); // kind -> Map(id -> entite brute)
  const traces = []; // sequence d'evenements ordonnes
  const idsReprises = []; // ids passes au moteur de reprise
  const moteurMatch = {
    settlePendingMatchResult: vi.fn(),
    expireConfirmationsOnServer: vi.fn(),
    countPendingArbiterFees: vi.fn(() => 0),
    retryPendingArbiterFees: vi.fn(),
  };
  return {
    etat,
    traces,
    idsReprises,
    moteurMatch,
    // Retenir le verrou match : simule un tick lent encore en cours.
    retenirMatch: null,
  };
});

const seedMatch = (match) => {
  if (!h.etat.has('matches')) h.etat.set('matches', new Map());
  h.etat.get('matches').set(match.id, JSON.parse(JSON.stringify(match)));
};

vi.mock('./persistence.mjs', () => ({
  upsertStateEntity: vi.fn(async (kind, entity) => {
    if (!h.etat.has(kind)) h.etat.set(kind, new Map());
    h.etat.get(kind).set(entity.id, { ...entity });
    if (kind === 'brLobbies') h.traces.push(`br:ecrit:${entity.id}`);
  }),
  replaceStateCollection: vi.fn(async (kind, items) => {
    if (!h.etat.has(kind)) h.etat.set(kind, new Map());
    const brut = h.etat.get(kind);
    brut.clear();
    for (const item of items) brut.set(item.id, { ...item });
  }),
  getStateCollection: vi.fn((kind) => Array.from((h.etat.get(kind) || new Map()).values())),
  getStateEntity: vi.fn((kind, id) => (h.etat.get(kind) || new Map()).get(id) || null),
  getUserById: vi.fn((id) => (id ? { id, pseudo: `pseudo-${id}` } : null)),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((v) => String(v || '').trim()),
  applyUserSettlementOnce: vi.fn(async (u, _k, updater) => updater({ id: u, stats: {}, progression: {} })),
  cleanupExpiredActivationCodes: vi.fn(async () => {}),
  cleanupExpiredPasswordResets: vi.fn(async () => {}),
  cleanupMemoryChatReads: vi.fn(),
  cleanupMemoryNotifications: vi.fn(),
  cleanupMemoryFriendRequests: vi.fn(),
  verifyDataIntegrity: vi.fn(async () => ({ ok: true })),
  listUserIds: vi.fn(() => []),
  tagWalletTransaction: vi.fn(),
  forgetWithdrawalKey: vi.fn(),
}));

vi.mock('./wallet-engine.mjs', () => ({
  reconcilePendingWithdrawals: vi.fn(async () => ({ reconciled: 0 })),
  refundRejectedWithdrawal: vi.fn(),
}));

vi.mock('./payment-engine.mjs', () => ({
  retrieveFedaPayPayout: vi.fn(),
  payoutSucceeded: vi.fn(),
  payoutFailed: vi.fn(),
}));

vi.mock('./league-engine.mjs', () => ({
  assignPlayersToDays: vi.fn(),
  getStaleLeagueSeasonIds: vi.fn(() => []),
  cancelStaleLeagueSeasonOnServer: vi.fn(),
  retryPendingLeagueRefunds: vi.fn(),
  countPendingLeagueRefunds: vi.fn(() => 0),
  countUncollectableLeagueRefunds: vi.fn(() => 0),
  retryPendingLeaguePayouts: vi.fn(),
  countPendingLeaguePayouts: vi.fn(() => 0),
}));

vi.mock('./tournament-engine.mjs', () => ({
  getExpiredTournamentIds: vi.fn(() => []),
  cancelStaleTournamentOnServer: vi.fn(),
  retryPendingTournamentRefunds: vi.fn(),
  countPendingTournamentRefunds: vi.fn(() => 0),
  countUncollectableTournamentRefunds: vi.fn(() => 0),
  retryPendingTournamentPayouts: vi.fn(),
  countPendingTournamentPayouts: vi.fn(() => 0),
}));

vi.mock('./match-engine.mjs', () => ({ ...h.moteurMatch }));

vi.mock('./br-engine.mjs', () => ({
  BR_MAPS: {},
  BR_MAP_IDS: [],
  BR_MODES: {},
  BR_MODE_IDS: [],
  BR_RANKING_MODES: {},
  BR_RANKING_MODE_IDS: [],
  BR_PRIZED_PLACES: 8,
  BR_ARBITER_MAX_RATE: 0.02,
  retryPendingBrSettlements: vi.fn(),
  countStaleBrLobbies: vi.fn(() => 0),
  getStaleBrLobbyIds: vi.fn(() => []),
  cancelStaleBrLobbyOnServer: vi.fn(),
}));

vi.mock('./state-helpers.mjs', () => ({
  getStoredBrLobbies: vi.fn(() => Array.from((h.etat.get('brLobbies') || new Map()).values())),
  saveBrLobbies: vi.fn(async () => {}),
  toPublicBrLobby: vi.fn((x) => ({ ...x, diffuse: true })),
  toPublicBrRanking: vi.fn((x) => x || []),
  saveMatches: vi.fn(async () => {}),
  buildMatchActionPayload: vi.fn(),
}));

vi.mock('./push-notifications.mjs', () => ({
  deliverNotification: vi.fn(async () => {
    h.traces.push('notif');
  }),
  broadcastStateSnapshot: vi.fn(),
}));

vi.mock('./http-utils.mjs', () => ({
  getAuthenticatedAppSession: vi.fn(() => null),
  parseRequestBody: vi.fn(async () => ({})),
  respondJson: vi.fn(),
  respondMappedError: vi.fn(),
}));

vi.mock('./rate-limiter.mjs', () => ({
  getClientIp: vi.fn(() => '1.2.3.4'),
  rateLimitGuard: vi.fn(() => true),
}));

vi.mock('./admin-totp.mjs', () => ({
  requireAdmin2fa: vi.fn((x) => x),
}));

vi.mock('./mutex.mjs', () => ({
  withBrLobbyMutex: vi.fn(async (_id, fn) => fn()),
  withWalletMutex: vi.fn(async (_id, fn) => fn()),
  withUserMutex: vi.fn(async (_id, fn) => fn()),
  // Verrou DE SCRUTATION : retient le callback aussi longtemps que le test
  // veut, pour prouver la garde anti-chevauchement du tick. Contrairement aux
  // verrous BR (id, fn), le verrou match ne recoit QUE le callback.
  withMatchMutex: vi.fn(async (premier, deuxieme) => {
    const fn = typeof premier === 'function' ? premier : deuxieme;
    if (h.retenirMatch instanceof Promise) {
      await h.retenirMatch;
      h.retenirMatch = null;
    }
    return fn();
  }),
  withLeagueMutex: vi.fn(async (fn) => fn()),
  withTournamentMutex: vi.fn(async (fn) => fn()),
}));

const { sweepPendingSettlements, sweepExpiredConfirmations } = await import('./cron.mjs');

// Construction d'un match : `surcharge` definit le statut de la dette.
const matchDeBase = (id, surcharge = {}) => ({
  id,
  status: 'finished',
  arbiter: { userId: 'arb-1', assignedAt: '2026-01-01T00:00:00Z' },
  players: [{ userId: 'p-1', team: 0 }],
  confirmationDeadline: null,
  disputes: [],
  result: { winnerTeam: 0, payoutDistributed: 'pending' },
  ...surcharge,
});

// Dates RELATIVES a l'horloge reelle : la fenetre expiree du code cron
// compare au `Date.now()` courant, pas a une epoque figee.
const dateFutur = new Date(Date.now() + 30 * 60 * 1000).toISOString();
const datePasse = new Date(Date.now() - 60 * 1000).toISOString();

beforeEach(() => {
  h.etat.clear();
  h.traces.length = 0;
  h.idsReprises.length = 0;
  h.retenirMatch = null;
  vi.clearAllMocks();
  // Par defaut, le moteur de reprise confirme passage sans rien changer.
  h.moteurMatch.settlePendingMatchResult.mockImplementation(async (list, matchId) => {
    h.idsReprises.push(matchId);
    return { matches: list, match: list.find((m) => m.id === matchId) || null, success: true };
  });
  h.moteurMatch.expireConfirmationsOnServer.mockImplementation(async (list) => ({
    matches: list,
    settled: [],
    failed: [],
  }));
});

describe('C3 - sweepPendingSettlements : le choix des cibles', () => {
  it('vise le reglement interrompu ET le litige clos restant disputed, PAS les autres', async () => {
    seedMatch(matchDeBase('M-INT')); // pending sans deadline : repris (historique)
    seedMatch(matchDeBase('M-ATT', {
      status: 'awaiting_confirmation',
      confirmationDeadline: dateFutur, // fenetre de contestation OUVERTE
    }));
    seedMatch(matchDeBase('M-LIT', {
      status: 'disputed',
      confirmationDeadline: dateFutur, // deadline RESTANTE, litige clos (C3)
      disputes: [{ id: 'd1', status: 'resolved' }],
    }));
    seedMatch(matchDeBase('M-OUV', {
      status: 'disputed',
      confirmationDeadline: null,
      disputes: [{ id: 'd1', status: 'open' }], // litige OUVERT : admin d'abord
    }));
    seedMatch(matchDeBase('M-FER', { result: { winnerTeam: 0, payoutDistributed: true } }));

    await sweepPendingSettlements();

    expect(h.idsReprises).toEqual(['M-INT', 'M-LIT']);
    // Meme le match non repris survive a l'ecriture de collection.
    const apres = h.etat.get('matches');
    expect(apres.size).toBe(5);
    expect(apres.get('M-ATT').status).toBe('awaiting_confirmation');
    expect(apres.get('M-OUV').disputes[0].status).toBe('open');
    expect(apres.get('M-FER').result.payoutDistributed).toBe(true);
  });

  it('passe l ecriture par le RESULTAT DU MOTEUR (pas l instantane initial)', async () => {
    seedMatch(matchDeBase('M-LIT', {
      status: 'disputed',
      confirmationDeadline: dateFutur,
      disputes: [{ id: 'd1', status: 'resolved' }],
    }));
    // Imitation du vrai moteur : cloture + signal de paiement.
    h.moteurMatch.settlePendingMatchResult.mockImplementation(async (list, matchId) => {
      h.idsReprises.push(matchId);
      return {
        matches: list.map((m) => (m.id === matchId
          ? { ...m, status: 'finished', result: { ...m.result, payoutDistributed: true } }
          : m)),
        match: { id: matchId },
        success: true,
      };
    });

    await sweepPendingSettlements();

    const cible = h.etat.get('matches').get('M-LIT');
    expect(cible.status).toBe('finished');
    expect(cible.result.payoutDistributed).toBe(true);
  });

  it('un reglement en echec isole n empeche pas la suite des reprises', async () => {
    seedMatch(matchDeBase('M-CASSE'));
    seedMatch(matchDeBase('M-BON', {
      status: 'disputed',
      disputes: [{ id: 'd1', status: 'resolved' }],
    }));
    h.moteurMatch.settlePendingMatchResult.mockImplementation(async (list, matchId) => {
      h.idsReprises.push(matchId);
      if (matchId === 'M-CASSE') throw new Error('PANNE_PORTFEUILLE');
      return {
        matches: list.map((m) => (m.id === matchId
          ? { ...m, result: { ...m.result, payoutDistributed: true } }
          : m)),
        match: { id: matchId },
        success: true,
      };
    });

    await sweepPendingSettlements();

    // Les deux ont ete VISITES, meme apres l'echec du premier.
    expect(h.idsReprises).toEqual(['M-CASSE', 'M-BON']);
    expect(h.etat.get('matches').get('M-BON').result.payoutDistributed).toBe(true);
  });

  it('garde anti-chevauchement : un tick lent n empile pas un second passage', async () => {
    seedMatch(matchDeBase('M-INT'));

    // Tick 1 : retenu dans le verrou.
    let degagerTick1;
    h.retenirMatch = new Promise((resolve) => { degagerTick1 = resolve; });
    const tick1 = sweepPendingSettlements();
    // Tick 2 arrive pendant que le 1er dort sur son leger : doit sortir sans
    // passer par le moteur.
    await sweepPendingSettlements();

    degagerTick1(undefined);
    await tick1;

    expect(h.idsReprises).toEqual(['M-INT']);
  });
});

describe('C3 - sweepExpiredConfirmations : cablage de la fenetre expiree', () => {
  it('alimente le moteur et n ecrit QUE si des fenetres ont ete soldees', async () => {
    seedMatch(matchDeBase('E-1', {
      status: 'awaiting_confirmation',
      confirmationDeadline: datePasse,
    }));
    seedMatch(matchDeBase('E-2', {
      status: 'awaiting_confirmation',
      confirmationDeadline: null, // pas de fenetre : hors job
    }));
    h.moteurMatch.expireConfirmationsOnServer.mockImplementation(async (list) => ({
      matches: list.map((m) => (m.id === 'E-1'
        ? { ...m, status: 'finished', result: { ...m.result, payoutDistributed: true } }
        : m)),
      settled: [{ id: 'E-1', success: true }],
      failed: [],
    }));

    await sweepExpiredConfirmations();

    // Le moteur recoit TOUTE la collection (lui fait le tri fin, litiges
    // ouverts compris).
    expect(h.moteurMatch.expireConfirmationsOnServer).toHaveBeenCalledTimes(1);
    const listePassee = h.moteurMatch.expireConfirmationsOnServer.mock.calls[0][0];
    expect(listePassee.map((m) => m.id)).toEqual(['E-1', 'E-2']);
    const apres = h.etat.get('matches');
    expect(apres.get('E-1').status).toBe('finished');
    expect(apres.get('E-2').result.payoutDistributed).toBe('pending');
  });

  it('rien a solder : aucune ecriture', async () => {
    seedMatch(matchDeBase('E-3', {
      status: 'awaiting_confirmation',
      confirmationDeadline: dateFutur, // fenetre NON expiree
    }));

    await sweepExpiredConfirmations();

    expect(h.moteurMatch.expireConfirmationsOnServer).not.toHaveBeenCalled();
    expect(h.traces.filter((t) => t.startsWith('ecrit'))).toEqual([]);
  });
});
