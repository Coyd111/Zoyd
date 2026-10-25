import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Les ecritures BR sont BRANCHEES DANS LE VERROU, PAR ENTITE (C1/C2).
 *
 * Pourquoi ce fichier
 * -------------------
 * C1 (audit-2, REINTERGRESSION de 474dcfa) : la route relisait l'instantane
 * dans `withBrLobbyMutex`, mais ecrivait `saveBrLobbies` APRES avoir relache
 * le verrou. Deux actions simultanees reappliquaient chacune son instantane :
 * le joueur inscrit dans la premiere ne figurait plus dans la collection
 * persistee, et son pass, deja bloque, n'avait plus aucun chemin de sortie.
 *
 * C2 : le cron de reprise ne prenait AUCUN verrou et reecrivait la collection
 * ENTIERE via `replaceStateCollection`, qui SUPPRIME les entites absentes de
 * l'instantane : un salon cree (ou une presence cochee) entre la lecture et
 * l'ecriture disparaissait en base - passes bloques, salon ampute.
 *
 * La distinction mecanisme/cablage est la meme que pour
 * `arbiter-fee-wiring.test.mjs` : un mecanisme correct jamais branche au bon
 * endroit est un bug silencieux. On verrouille ici TOUS les points de cablage :
 *   1. la route ecrit DANS le verrou (ordre verrou -> moteur -> save -> unlock) ;
 *   2. le cron de reprise prend le verrou du salon, RELIT dans le verrou, et
 *      n'ecrit que le salon traite (les autres salons survivent) ;
 *   3. `sweepStaleBrLobbies` ecrit aussi par entite, dans le verrou ;
 *   4. la garde anti-chevauchement des jobs BR est effective ;
 *   5. aucune ecriture BR ne passe par `replaceStateCollection`.
 *
 * Les tests appellent `handleBrRoutes` et les fonctions exportees par
 * `server/cron.mjs` - pas les fonctions des moteurs.
 */

const h = vi.hoisted(() => {
  const etat = new Map(); // kind -> Map(id -> entite brute)
  const traces = []; // sequence d'evenements ordonnes
  const ecritures = []; // ids BR passes a upsertStateEntity
  const engine = {
    joinBrLobbyOnServer: vi.fn(),
    leaveBrLobbyOnServer: vi.fn(),
    checkInBrLobbyOnServer: vi.fn(),
    startBrLobbyOnServer: vi.fn(),
    eliminateBrPlayerOnServer: vi.fn(),
    settleBrLobbyOnServer: vi.fn(),
    createBrLobbyOnServer: vi.fn(),
    computeBrPayouts: vi.fn(),
    computeBrRanking: vi.fn(() => []),
    retryPendingBrSettlements: vi.fn(),
    countStaleBrLobbies: vi.fn(() => 0),
    getStaleBrLobbyIds: vi.fn(() => []),
    cancelStaleBrLobbyOnServer: vi.fn(),
  };
  return {
    etat,
    traces,
    ecritures,
    engine,
    // Hook appele par le verrou AVANT le callback : simule "une action
    // concurrente finit pendant la fenetre d'ouverture du verrou".
    mutationDuVerrou: { fn: null },
    sessionCourante: null,
    derniereReponse: null,
    derniereErreur: null,
  };
});

const seedLobby = (lobby) => {
  if (!h.etat.has('brLobbies')) h.etat.set('brLobbies', new Map());
  h.etat.get('brLobbies').set(lobby.id, { ...lobby });
};

vi.mock('./persistence.mjs', () => ({
  // La couche de persistance est le SOCLE des ecrits BR : en production,
  // `upsertStateEntity` remplace UNE seule ligne. Le fake reprend la meme
  // semantique : aucune suppression, et un dossier des entites ecrites.
  upsertStateEntity: vi.fn(async (kind, entity) => {
    if (!h.etat.has(kind)) h.etat.set(kind, new Map());
    h.etat.get(kind).set(entity.id, { ...entity });
    if (kind === 'brLobbies') h.ecritures.push(entity.id);
  }),
  // Semantique REELLE du remplacement en bloc : les entites absentes de la
  // liste sont DETRUITES. On reimplemente le comportement destructeur pour
  // prouver que les ecritures BR n'y passent plus.
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

vi.mock('./match-engine.mjs', () => ({
  settlePendingMatchResult: vi.fn(),
  expireConfirmationsOnServer: vi.fn(),
  countPendingArbiterFees: vi.fn(() => 0),
  retryPendingArbiterFees: vi.fn(),
}));

vi.mock('./br-engine.mjs', () => ({
  BR_MAPS: {},
  BR_MAP_IDS: [],
  BR_MODES: {},
  BR_MODE_IDS: [],
  BR_RANKING_MODES: {},
  BR_RANKING_MODE_IDS: [],
  BR_PRIZED_PLACES: 8,
  BR_ARBITER_MAX_RATE: 0.02,
  ...h.engine,
}));

// `saveBrLobbies` simule : semantique PAR ENTITE identique a la vraie
// (n'ecrit que ce qui est different de l'etat stocke, ne supprime JAMAIS).
// Les verifications descendent jusqu'a la couche d'enregistrement (ecritures).
vi.mock('./state-helpers.mjs', async () => {
  const persistance = await import('./persistence.mjs');
  return {
    getStoredBrLobbies: vi.fn(() => Array.from((h.etat.get('brLobbies') || new Map()).values())),
    saveBrLobbies: vi.fn(async (_io, lobbies) => {
      h.traces.push('save');
      for (const lobby of Array.isArray(lobbies) ? lobbies : []) {
        if (!lobby || !lobby.id) continue;
        const courant = persistance.getStateEntity('brLobbies', lobby.id);
        if (courant && JSON.stringify(courant) === JSON.stringify(lobby)) continue;
        await persistance.upsertStateEntity('brLobbies', lobby);
      }
      return Array.from((h.etat.get('brLobbies') || new Map()).values());
    }),
    toPublicBrLobby: vi.fn((x) => ({ ...x, diffuse: true })),
    toPublicBrRanking: vi.fn((x) => x || []),
    saveMatches: vi.fn(async () => {}),
    buildMatchActionPayload: vi.fn(),
  };
});

vi.mock('./push-notifications.mjs', () => ({
  deliverNotification: vi.fn(async () => {
    h.traces.push('notif');
  }),
  broadcastStateSnapshot: vi.fn(),
}));

// Ce sont des paths RELATIFS A L'IMPORTATEUR : routes/br.mjs est sous
// server/routes/, cron.mjs est sous server/. Vitest moque le module RESOLU :
// './http-utils.mjs' depuis ce fichier de test vise le meme fichier que
// '../http-utils.mjs' depuis routes/br.mjs.
vi.mock('./http-utils.mjs', () => ({
  getAuthenticatedAppSession: vi.fn(() => h.sessionCourante),
  parseRequestBody: vi.fn(async () => ({ userId: 'p-9', killerUserId: null, assists: 0 })),
  respondJson: vi.fn((_res, status, payload) => {
    h.traces.push(`reponse:${status}`);
    h.derniereReponse = payload;
  }),
  respondMappedError: vi.fn((_res, error) => {
    h.traces.push('erreur');
    h.derniereErreur = error;
  }),
}));

vi.mock('./rate-limiter.mjs', () => ({
  getClientIp: vi.fn(() => '1.2.3.4'),
  rateLimitGuard: vi.fn(() => true),
}));

vi.mock('./admin-totp.mjs', () => ({
  // Le harnais ne teste pas le TOTP lui-meme : la garde est branchee pour
  // laisser passer et retourner la session courante du test.
  requireAdmin2fa: vi.fn(() => h.sessionCourante),
  require2faIfAdmin: vi.fn(() => h.sessionCourante),
}));

vi.mock('./mutex.mjs', () => ({
  // Verrou DE SCRUTATION : il trace la sequence, declenche le hook de mutation
  // (simulation d'une action concurrente) et serialise le callback. On teste
  // ici le CABLAGE (ordre verrou/moteur/save/unlock), pas la promesse du
  // verrou lui-meme (couvert par mutex.test.mjs).
  withBrLobbyMutex: vi.fn(async (lobbyId, fn) => {
    h.traces.push('br:lock');
    if (typeof h.mutationDuVerrou.fn === 'function') h.mutationDuVerrou.fn(lobbyId);
    const resultat = await fn();
    h.traces.push('br:unlock');
    return resultat;
  }),
  withWalletMutex: vi.fn(async (_id, fn) => fn()),
  withUserMutex: vi.fn(async (_id, fn) => fn()),
  withMatchMutex: vi.fn(async (_token, fn) => fn()),
  withLeagueMutex: vi.fn(async (fn) => fn()),
  withTournamentMutex: vi.fn(async (fn) => fn()),
}));

const { sweepPendingBrSettlements, sweepStaleBrLobbies } = await import('./cron.mjs');
const { handleBrRoutes } = await import('./routes/br.mjs');

const actionRoute = (nom, lobbyId = 'BR-1') => handleBrRoutes({
  req: { method: 'POST' },
  res: {},
  io: null,
  pathname: `/api/br/lobbies/${lobbyId}/${nom}`,
});

const salonDeBase = (id, surcharge = {}) => ({
  id,
  name: `Salon ${id}`,
  status: 'scheduled',
  arbiterId: 'arb-1',
  creatorId: 'arb-1',
  entryFee: 10,
  pot: 20,
  players: [],
  teams: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...surcharge,
});

beforeEach(() => {
  h.etat.clear();
  h.traces.length = 0;
  h.ecritures.length = 0;
  h.mutationDuVerrou.fn = null;
  h.sessionCourante = null;
  h.derniereReponse = null;
  h.derniereErreur = null;
  vi.clearAllMocks();
});

describe('C1 - la route ecrit DANS le verrou du salon', () => {
  it('join : le verrou couvre le cycle COMPLET lire -> calculer -> ecrire', async () => {
    h.sessionCourante = { user: { id: 'arb-1' } };
    seedLobby(salonDeBase('BR-1'));

    h.engine.joinBrLobbyOnServer.mockImplementation(async (lobbies, _actor, lobbyId) => {
      h.traces.push('moteur:join');
      const cible = lobbies.find((l) => l.id === lobbyId);
      if (!cible) throw new Error('salon absent : le moteur a recu un etat vide');
      return {
        lobby: { ...cible, players: [...cible.players, { userId: 'p-1', pseudo: 'P1' }] },
        lobbies: lobbies.map((l) => (l.id === lobbyId
          ? { ...l, players: [...l.players, { userId: 'p-1', pseudo: 'P1' }] }
          : l)),
      };
    });

    const traite = await actionRoute('join');

    expect(traite).toBe(true);
    // C'EST LA NON-REGRESSION C1 : avant la retouche, l'ordre etait
    //   lock, moteur, unlock, save - l'ecriture s'appliquait HORS du verrou,
    //   par-dessus celle d'une action concurrente qui venait de finir.
    expect(h.traces).toEqual(['br:lock', 'moteur:join', 'save', 'br:unlock', 'reponse:200']);
    // L'ecriture est PARTIE a la couche de persistance (par entite).
    expect(h.ecritures).toEqual(['BR-1']);
    // Aucune ecriture BR par entite ne passe par le remplacement en bloc.
    expect(h.etat.get('brLobbies').get('BR-1').players).toHaveLength(1);
  });

  it('finish : le reglement, sa persistance finale et la notification sont sous le verrou', async () => {
    h.sessionCourante = { user: { id: 'arb-1' } };
    seedLobby(salonDeBase('BR-1', { status: 'live', players: [{ userId: 'p-1', pseudo: 'P1', paidPass: true }] }));

    h.engine.settleBrLobbyOnServer.mockImplementation(async (lobbies, _actor, lobbyId, opts) => {
      h.traces.push('moteur:settle');
      const cible = lobbies.find((l) => l.id === lobbyId);
      if (!cible) throw new Error('salon absent : le moteur a recu un etat vide');
      // La progression intermediaire (salon marque `settling`) est persistee
      // PAR LE MOTEUR, pendant qu'on est encore dans le verrou.
      await opts.onProgress([{ ...cible, status: 'settling' }]);
      return {
        lobby: { ...cible, status: 'finished' },
        lobbies: [{ ...cible, status: 'finished' }],
        payouts: [{ userId: 'p-1', placement: 1, amount: 100, kills: 3 }],
        arbiter: { rate: 0.02, amount: 5 },
      };
    });

    const traite = await actionRoute('finish');

    expect(traite).toBe(true);
    // L'ordre verrouille : progression (save), ecriture finale (save),
    // notification, puis SEULEMENT le verrou se relache et la reponse part.
    expect(h.traces).toEqual(['br:lock', 'moteur:settle', 'save', 'save', 'notif', 'br:unlock', 'reponse:200']);
    expect(h.ecritures).toEqual(['BR-1', 'BR-1']);
    expect(h.derniereReponse.ok).toBe(true);
    expect(h.etat.get('brLobbies').get('BR-1').status).toBe('finished');
  });
});

describe('C2 - le cron de reprise des reglements BR', () => {
  it('prend le verrou, n ecrit QUE le salon traite, epargne les autres salons', async () => {
    seedLobby(salonDeBase('BR-ATT', { status: 'settling', arbiterId: 'arb-9', pot: 100 }));
    seedLobby(salonDeBase('BR-HORS', { status: 'scheduled', arbiterId: 'arb-8', pot: 50 }));

    h.engine.retryPendingBrSettlements.mockImplementation(async (lobbies, options) => {
      h.traces.push('cron:moteur');
      // LA LISTE TRANSMISE AU MOTEUR EST RESTREINTE AU SALON TRAITE : le cron
      // ne lui confie plus la collection entiere.
      expect(lobbies).toHaveLength(1);
      expect(lobbies[0].id).toBe('BR-ATT');
      expect(lobbies[0].status).toBe('settling');
      // L'ACTEUR est l'arbitre du salon, resolu a partir de `arbiterId`.
      expect(options.getActor(lobbies[0]).id).toBe('arb-9');
      await options.onProgress([{ ...lobbies[0], regleProgression: true }]);
      return { lobbies: [{ ...lobbies[0], status: 'finished' }], retried: 1, remaining: 0 };
    });

    await sweepPendingBrSettlements();

    expect(h.traces).toEqual(['br:lock', 'cron:moteur', 'save', 'save', 'br:unlock']);
    // Seul le salon traite a ete ecrit ; BR-HORS n'a PAS ete re-ecrit.
    expect(h.ecritures).toEqual(['BR-ATT', 'BR-ATT']);
    expect(h.etat.get('brLobbies').get('BR-HORS').pot).toBe(50);
    // Le chemin d'ecriture ENTIER ne passe plus par le remplacement en bloc.
    expect(h.etat.get('brLobbies').get('BR-ATT').status).toBe('finished');
  });

  it('RELIT le salon dans le verrou : un salon solde entre-temps n est plus repris', async () => {
    seedLobby(salonDeBase('BR-ATT', { status: 'settling', arbiterId: 'arb-9', pot: 100 }));

    // Simule la route `finish` qui SOLDE le salon pendant la fenetre
    // d'ouverture du verrou : la relecture ne doit plus rien trouver a faire.
    h.mutationDuVerrou.fn = () => {
      const brut = h.etat.get('brLobbies');
      brut.set('BR-ATT', { ...brut.get('BR-ATT'), status: 'finished' });
    };

    await sweepPendingBrSettlements();

    // Pas de duree de verrou, pas de moteur : le salon est deja solde.
    expect(h.traces).toEqual(['br:lock', 'br:unlock']);
    expect(h.ecritures).toEqual([]);
    expect(h.engine.retryPendingBrSettlements).not.toHaveBeenCalled();
  });

  it('verrou par salon : un echec sur le salon A n empeche pas le salon B', async () => {
    seedLobby(salonDeBase('BR-A', { status: 'settling', arbiterId: 'arb-9' }));
    seedLobby(salonDeBase('BR-B', { status: 'settling', arbiterId: 'arb-9' }));

    h.engine.retryPendingBrSettlements.mockImplementation(async (lobbies) => {
      h.traces.push(`cron:moteur:${lobbies[0].id}`);
      if (lobbies[0].id === 'BR-A') throw new Error('panne transitoire');
      return { lobbies: [{ ...lobbies[0], status: 'finished' }], retried: 1, remaining: 0 };
    });

    await sweepPendingBrSettlements();

    // Les deux salons ont ete traites, chacun sous son propre verrou.
    expect(h.traces).toEqual([
      'br:lock', 'cron:moteur:BR-A', 'br:unlock',
      'br:lock', 'cron:moteur:BR-B', 'save', 'br:unlock',
    ]);
  });
});

describe('C2 - le balayage des salons BR perimes', () => {
  it('annule le salon perime sous son verrou et ecrit par entite', async () => {
    seedLobby(salonDeBase('BR-VIEUX', { status: 'scheduled', pot: 45 }));
    seedLobby(salonDeBase('BR-HORS', { status: 'scheduled', pot: 50 }));
    h.engine.getStaleBrLobbyIds.mockImplementation(() => ['BR-VIEUX']);
    h.engine.cancelStaleBrLobbyOnServer.mockImplementation(async (lobbies, lobbyId) => {
      h.traces.push('cron:annule');
      expect(lobbyId).toBe('BR-VIEUX');
      const cible = lobbies.find((l) => l.id === lobbyId);
      expect(cible).toBeTruthy();
      return {
        lobbies: lobbies.map((l) => (l.id === lobbyId ? { ...l, status: 'cancelled' } : l)),
        cancelled: true,
        refunded: 45,
        errors: [],
      };
    });

    await sweepStaleBrLobbies();

    expect(h.traces).toEqual(['br:lock', 'cron:annule', 'save', 'br:unlock']);
    expect(h.ecritures).toEqual(['BR-VIEUX']);
    expect(h.etat.get('brLobbies').get('BR-VIEUX').status).toBe('cancelled');
    expect(h.etat.get('brLobbies').get('BR-HORS').pot).toBe(50);
  });
});

describe('C2 - la garde anti-chevauchement des jobs BR', () => {
  it('un second appel pendant l execution du premier est SAUTE', async () => {
    seedLobby(salonDeBase('BR-ATT', { status: 'settling', arbiterId: 'arb-9', pot: 100 }));

    let resolveEngine;
    h.engine.retryPendingBrSettlements.mockImplementation(() => new Promise((resolve) => {
      resolveEngine = resolve;
    }));

    const premier = sweepPendingBrSettlements();
    await new Promise((resolve) => setImmediate(resolve));
    const second = sweepPendingBrSettlements();
    // Le second appel frappe la garde : il retourne immediatement, sans
    // prendre le verrou ni relancer la reprise.
    expect(await second).toBeUndefined();
    expect(h.traces.filter((t) => t === 'br:lock')).toHaveLength(1);
    resolveEngine({ lobbies: [{ id: 'BR-ATT', status: 'finished' }], retried: 1, remaining: 0 });
    await premier;
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.traces.filter((t) => t === 'br:lock')).toHaveLength(1);
  });
});
