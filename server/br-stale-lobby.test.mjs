import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Un salon BR en sequestre sans issue doit etre annule et rembourse (C4).
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * Deux formes de peremption :
 *   - `scheduled` : le salon ne se lance que si l'arbitre (ou le createur) le
 *     lance, et seulement si les joueurs se sont pointes. Sans balayage, un
 *     salon qui n'a jamais demarre restait `scheduled` POUR TOUJOURS.
 *   - `live`      : l'arbitre a LANCE la partie (passes bloques, pot valorise)
 *     puis a disparu — deconnexion, absence, abandon. Sans balayage, personne
 *     n'appelle jamais `finish` : la cagnotte reste sequestree, le salon
 *     n'etant ni `live` ni `regle` ni `annule`.
 *
 * Aucun cron n'en s'occupait a l'origine : le cron nettoie les matchs, les
 * ligues et les tournois, pas les salons BR. Et un salon BR n'a pas
 * d'`expiresAt`, alors qu'un match en a un (14 jours).
 *
 * Meme famille que V1 et V14 le dit dans les deux sens : un mecanisme de
 * remboursement dont la condition d'appel n'est jamais remplie.
 */

const versements = [];
vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(async (userId, matchId, raison) => {
    versements.push({ kind: 'refund', userId, matchId, raison });
  }),
  releaseWalletWinnings: vi.fn(async (userId, amount, matchId, type) => {
    versements.push({ kind: 'winnings', userId, amount, matchId, type });
  }),
  settleMatchLossWallet: vi.fn(async (userId, matchId, raison) => {
    versements.push({ kind: 'forfeit', userId, matchId, raison });
  }),
}));

vi.mock('./persistence.mjs', () => ({
  getUserById: vi.fn((id) => ({
    id,
    pseudo: id,
    role: 'admin',
    trustScore: 100,
    stats: {},
    progression: {},
    wallet: { cashBalance: 0, bonusBalance: 0, lockedBalance: 0, lockedEntries: {}, transactions: [] },
  })),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((v) => String(v || '').trim()),
  applyUserSettlementOnce: vi.fn(async (userId, _key, updater) => updater({ id: userId, stats: {}, progression: {} })),
}));

import {
  BR_STALE_LOBBY_GRACE_MS,
  countStaleBrLobbies,
  getStaleBrLobbyIds,
  cancelStaleBrLobbyOnServer,
} from './br-engine.mjs';

const ilYA = (ms) => new Date(Date.now() - ms).toISOString();

const salonProgramme = (surcharge = {}) => ({
  id: 'BR-STALE',
  name: 'Salon jamais lance',
  status: 'scheduled',
  mode: 'solo',
  map: 'isolated',
  entryFee: 50,
  pot: 100,
  arbiterId: 'admin-1',
  rankingMode: 'survie_kills',
  scheduledAt: ilYA(BR_STALE_LOBBY_GRACE_MS + 60 * 60 * 1000),
  createdAt: ilYA(48 * 60 * 60 * 1000),
  updatedAt: ilYA(48 * 60 * 60 * 1000),
  players: [
    { userId: 'p1', pseudo: 'P1', teamId: 'T-1', joinedAt: ilYA(40 * 60 * 60 * 1000), checkedIn: false, alive: false, placement: null, kills: 0, eliminatedAt: null, absent: false, settled: false, winnings: 0 },
    { userId: 'p2', pseudo: 'P2', teamId: 'T-2', joinedAt: ilYA(40 * 60 * 60 * 1000), checkedIn: false, alive: false, placement: null, kills: 0, eliminatedAt: null, absent: false, settled: false, winnings: 0 },
  ],
  teams: [],
  disputes: [],
  ...surcharge,
});

beforeEach(() => { versements.length = 0; vi.clearAllMocks(); });

describe('Salons BR programmes et jamais lances', () => {
  it('identifie un salon dont l heure est depassee', () => {
    expect(getStaleBrLobbyIds([salonProgramme()])).toEqual(['BR-STALE']);
    expect(countStaleBrLobbies([salonProgramme()])).toBe(1);
  });

  it('laisse un salon encore dans sa fenetre', () => {
    // L heure approche : le salon peut encore demarrer. Il ne faut surtout pas
    // annuler un salon qui va se lancer dans une heure.
    const salon = salonProgramme({ scheduledAt: ilYA(30 * 60 * 1000) });
    expect(getStaleBrLobbyIds([salon])).toEqual([]);
  });

  it('ne touche pas un salon live encore recent', () => {
    // L'arbitre a lance il y a peu : la partie est peut-etre en cours. La
    // grace (2 h, la meme que la phase B des matchs) protege ce cas.
    const salon = salonProgramme({ status: 'live', startedAt: ilYA(30 * 60 * 1000) });
    expect(getStaleBrLobbyIds([salon])).toEqual([]);
  });

  it('ne touche pas un salon live sans startedAt', () => {
    // Donnee incoherente (un salon live DOIT avoir un startedAt) : sans
    // horloge de reference, la peremption n'est pas prouvable.
    const salon = salonProgramme({ status: 'live', startedAt: null });
    expect(getStaleBrLobbyIds([salon])).toEqual([]);
  });

  it('C4 - identifie un salon LIVE abandonne par l arbitre', () => {
    const salon = salonProgramme({ status: 'live', startedAt: ilYA(BR_STALE_LOBBY_GRACE_MS + 90 * 60 * 1000) });
    expect(getStaleBrLobbyIds([salon])).toEqual(['BR-STALE']);
    expect(countStaleBrLobbies([salon])).toBe(1);
  });

  it('rembourse chaque joueur et annule le salon', async () => {
    const res = await cancelStaleBrLobbyOnServer([salonProgramme()], 'BR-STALE');

    const rembourses = versements.filter((v) => v.kind === 'refund');
    expect(rembourses).toHaveLength(2);
    expect(res.cancelled).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.lobbies[0].status).toBe('cancelled');
    expect(res.lobbies[0].cancellationReason).toBe('NEVER_STARTED');
  });

  it('NE CLOT PAS le salon si un remboursement echoue', async () => {
    // Le cas le plus dangereux : clore un salon dont un joueur n'a pas ete
    // rembourse laisserait du sequestre sans trace, et le joueur verrait le
    // salon « annule » sans jamais avoir vu son argent.
    const { refundLockedEntry } = await import('./wallet-engine.mjs');
    refundLockedEntry.mockImplementationOnce(async () => { throw new Error('SEQUESTRE INDISPONIBLE'); });

    const res = await cancelStaleBrLobbyOnServer([salonProgramme()], 'BR-STALE');

    expect(res.cancelled).toBe(false);
    expect(res.errors).toHaveLength(1);
    // Le salon reste `scheduled` : il sera repris au balayage suivant.
    expect(res.lobbies[0].status).toBe('scheduled');
  });

  it('ne rembourse pas deux fois un joueur deja rembourse', async () => {
    const salon = salonProgramme();
    salon.players[0].settled = true;

    const res = await cancelStaleBrLobbyOnServer([salon], 'BR-STALE');

    const rembourses = versements.filter((v) => v.kind === 'refund');
    expect(rembourses).toHaveLength(1);
    expect(rembourses[0].userId).toBe('p2');
    expect(res.cancelled).toBe(true);
  });
});

describe('Salons BR lances puis abandonnes (C4)', () => {
  it('C4 - rembourse le salon live abandonne et clot avec RAISON arbitre absent', async () => {
    const salon = salonProgramme({ status: 'live', startedAt: ilYA(BR_STALE_LOBBY_GRACE_MS + 90 * 60 * 1000) });

    const res = await cancelStaleBrLobbyOnServer([salon], 'BR-STALE');

    const rembourses = versements.filter((v) => v.kind === 'refund');
    expect(rembourses).toHaveLength(2);
    // Le motif est HONNETE : les joueurs ont joue (ou devaient jouer), c'est
    // le depart de l'arbitre qui a tue le salon.
    expect(res.lobbies[0].cancellationReason).toBe('ARBITER_TIMEOUT');
    expect(res.lobbies[0].status).toBe('cancelled');
    expect(rembourses[0].raison).toContain('(arbitre absent)');
  });

  it('C4 - en echec de remboursement, le salon live n est pas clos', async () => {
    const { refundLockedEntry } = await import('./wallet-engine.mjs');
    refundLockedEntry.mockImplementationOnce(async () => { throw new Error('SEQUESTRE INDISPONIBLE'); });

    const salon = salonProgramme({ status: 'live', startedAt: ilYA(BR_STALE_LOBBY_GRACE_MS + 90 * 60 * 1000) });
    const res = await cancelStaleBrLobbyOnServer([salon], 'BR-STALE');

    expect(res.cancelled).toBe(false);
    expect(res.lobbies[0].status).toBe('live');
  });

  it('un salon settling ne passe PAS par le balayage de peremption', async () => {
    // `settling` appartient au job de reprise des reglements ; le confondre
    // reviendrait a couper la reprise en deux.
    const salon = salonProgramme({ status: 'settling', startedAt: ilYA(BR_STALE_LOBBY_GRACE_MS + 90 * 60 * 1000) });
    expect(getStaleBrLobbyIds([salon])).toEqual([]);

    const res = await cancelStaleBrLobbyOnServer([salon], 'BR-STALE');
    expect(res.cancelled).toBe(false);
    expect(res.lobbies[0].status).toBe('settling');
  });
});
