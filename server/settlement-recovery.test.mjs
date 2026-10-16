import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Les deux pertes d argent DEFINITIVES restantes.
 *
 * 1. Matchs : un reglement partiel etait persiste `false`. Or la reprise
 *    ne selectionnait que `'pending'`. Un joueur dont le versement avait echoue
 *    sortait donc du mecanisme et ne touchait jamais sa part, sans aucun signal
 *    hors une ligne de log. `false` et `pending` ne voulaient pas dire la meme
 *    chose, et le code les confondait.
 *
 * 2. Tournois : aucun mecanisme de reprise des GAINS. Le declencheur etait a
 *    usage unique, aucun cron ne reprenait les gains (seulement les
 *    remboursements), aucune route admin ne relancait. La garde d'idempotence
 *    ne peut rien y faire : elle bloque le SUR-paiement, pas le
 *    sous-paiement.
 */

vi.mock('./persistence.mjs', () => ({
  getUserById: vi.fn(),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((value) => String(value || '').trim()),
  patchUserForMatchOutcome: vi.fn(),
  patchUserForTournamentOutcome: vi.fn(),
}));

vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(),
  releaseWalletWinnings: vi.fn(),
  settleMatchLossWallet: vi.fn(),
}));

vi.mock('./mutex.mjs', () => ({
  withWalletMutex: vi.fn(async (_id, fn) => fn()),
  withMatchMutex: vi.fn(async (fn) => fn()),
  withTournamentMutex: vi.fn(async (fn) => fn()),
}));

import * as matchEngine from './match-engine.mjs';
import * as tournamentEngine from './tournament-engine.mjs';
import { releaseWalletWinnings, settleMatchLossWallet } from './wallet-engine.mjs';

beforeEach(() => {
  // `clearAllMocks` n efface PAS les implementations : une posee par un test
  // fuit dans le suivant et le fait echouer pour une mauvaise raison.
  vi.resetAllMocks();
});

// ─── Matchs ──────────────────────────────────────────────────────────────────

const matchARegler = () => ({
  id: 'M-REPRISE',
  status: 'awaiting_confirmation',
  format: 'duo',
  rules: { mode: 'duo', map: 'isolated' },
  confirmationDeadline: null,
  disputes: [],
  players: [
    { userId: 'g1', team: 0, ready: true, confirmed: true, stats: { kills: 0, deaths: 0 } },
    { userId: 'g2', team: 1, ready: true, confirmed: true, stats: { kills: 0, deaths: 0 } },
  ],
  teams: [
    { id: 'A', members: [{ userId: 'g1' }] },
    { id: 'B', members: [{ userId: 'g2' }] },
  ],
  arbiter: { userId: 'arb1' },
  result: {
    type: 'kills',
    // `winnerTeam` est un INDEX numerique (0 ou 1), pas un identifiant :
    // avec un identifiant, aucun joueur n'est designe gagnant et le reglement
    // « reussit » sans verser personne.
    winnerTeam: 0,
    players: [
      { userId: 'g1', team: 0, teamId: 'A', kills: 5, placement: 1 },
      { userId: 'g2', team: 1, teamId: 'B', kills: 2, placement: 2 },
    ],
    payoutDistributed: 'pending',
    confirmedByTeams: ['A', 'B'],
  },
});

describe('Matchs — un reglement interrompu reste rejouable', () => {
  it('un echec partiel ne persiste PAS `false`', async () => {
    const match = matchARegler();
    releaseWalletWinnings.mockImplementation(async (userId) => {
      if (userId === 'g1') throw new Error('SUPABASE_DOWN');
    });

    const resultat = await matchEngine.settlePendingMatchResult([match], match.id);

    // On lit le CLONE retourne. L objet d origine n est jamais modifie — un
    // test qui le lirait passerait toujours, a vide.
    expect(
      resultat.match.result.payoutDistributed,
      '`false` sortait le match du mecanisme de reprise, definitivement'
    ).toBe('pending');
  });

  it('la reprise est rejouee par le cron : elle selectionne bien `pending`', async () => {
    // Le cron ne retient que `'pending'`. C'est ce filtre, et lui seul, qui
    // decide si un joueur sera paye sans intervention humaine.
    const match = matchARegler();
    releaseWalletWinnings.mockImplementation(async (userId) => {
      if (userId === 'g1') throw new Error('SUPABASE_DOWN');
    });

    const premier = await matchEngine.settlePendingMatchResult([match], match.id);
    expect(premier.success).toBe(false);

    // Deuxieme passage : le钱包 et les concurrents sont revenus.
    releaseWalletWinnings.mockImplementation(async () => {});
    const second = await matchEngine.settlePendingMatchResult(premier.matches, match.id);

    expect(second.match.result.payoutDistributed).toBe(true);
    expect(second.success).toBe(true);
    // Le joueur rate a la premiere tentative est enfin paye.
    const versements = releaseWalletWinnings.mock.calls.filter((c) => c[0] === 'g1');
    expect(versements.length, 'g1 doit avoir ete servi au second passage').toBeGreaterThan(0);
  });

  it('un litige ouvert gele la reprise : on ne paie pas un resultat conteste', async () => {
    const match = matchARegler();
    match.disputes = [{ id: 'D1', status: 'open', reason: 'cheating' }];
    releaseWalletWinnersGuard();
    function releaseWalletWinnersGuard() { releaseWalletWinnings.mockClear(); }

    const res = await matchEngine.settlePendingMatchResult([match], match.id);

    expect(res.success).toBe(false);
    expect(releaseWalletWinnings, 'aucun versement ne doit partir sur un litige ouvert').not.toHaveBeenCalled();
    expect(res.match.result.payoutDistributed).toBe('pending');
  });

  it('la reprise solde un match que l echec avait laisse `disputed`', async () => {
    // Sans cette cloture, le match resterait `disputed` alors que tous les
    // joueurs seraient payes : un etat qui ment sur la realite economique.
    const match = matchARegler();
    match.status = 'disputed';
    match.finishedAt = null;

    const res = await matchEngine.settlePendingMatchResult([match], match.id);

    expect(res.success).toBe(true);
    expect(res.match.status).toBe('finished');
    expect(res.match.finishedAt).toBeTruthy();
  });

  it('un match deja solde n est pas rejoue', async () => {
    const match = matchARegler();
    match.result.payoutDistributed = true;

    const res = await matchEngine.settlePendingMatchResult([match], match.id);

    expect(res.success).toBe(true);
    expect(releaseWalletWinnings).not.toHaveBeenCalled();
  });
});

// ─── Tournois ────────────────────────────────────────────────────────────────

const tournoiSolde = () => ({
  id: 'T-REPRISE',
  name: 'Tournoi test',
  status: 'completed',
  entries: [
    {
      id: 'E1',
      captainId: 'c1',
      finalPlacement: 1,
      members: [{ userId: 'c1' }],
    },
    {
      id: 'E2',
      captainId: 'c2',
      finalPlacement: 2,
      members: [{ userId: 'c2' }],
    },
  ],
  arbitrers: [],
  payout: { first: 1000, second: 500, third: 250, arbiterPool: 0 },
  arbiterPool: 0,
  arbitersNeeded: 0,
  pendingPayouts: [],
});

describe('Tournois — la dette est ecrite AU moment du reglement', () => {
  it('un gain en echec est consigne dans `pendingPayouts`', async () => {
    // C'est le seul endroit ou la dette nait. Si ce lien disparait, le systeme
    // complet de reprise ne sert a rien : la liste resterait vide.
    const tournoi = tournoiSolde();
    releaseWalletWinnings.mockImplementation(async (userId) => {
      if (userId === 'c1') throw new Error('SUPABASE_DOWN');
    });

    await tournamentEngine.applyTournamentSettlement(tournoi);

    const dettes = tournoi.pendingPayouts || [];
    expect(dettes, 'le gain rate doit etre consigne').toHaveLength(1);
    expect(dettes[0].captainId).toBe('c1');
    expect(dettes[0].kind).toBe('prize');
    expect(dettes[0].amount).toBe(1000);
  });

  it('un gain qui aboutit ne laisse PAS de dette', async () => {
    const tournoi = tournoiSolde();

    await tournamentEngine.applyTournamentSettlement(tournoi);

    expect(tournoi.pendingPayouts).toHaveLength(0);
  });

  it('la dette s accumule et se dedoublonne jamais d elle-meme', async () => {
    const tournoi = tournoiSolde();
    releaseWalletWinnings.mockImplementation(async (userId) => {
      if (userId === 'c1') throw new Error('SUPABASE_DOWN');
    });

    await tournamentEngine.applyTournamentSettlement(tournoi);
    const premiere = (tournoi.pendingPayouts || []).length;

    // Rejeu du reglement alors que la dette existe deja.
    releaseWalletWinnings.mockImplementation(async () => {});
    await tournamentEngine.applyTournamentSettlement(tournoi);

    // La reprise est separee de l ecriture de la dette : rejouer le
    // reglement ne doit pas empiler une copie du meme gain rate.
    expect(premiere).toBe(1);
    expect(tournoi.pendingPayouts.length).toBe(1);
  });

  it('la dette survit au rechargement du tournoi', () => {
    // C est precisement ce qui manquait : sans la normalisation, un redemarrage
    // entre l echec et la reprise effacait la dette.
    const normalise = (t) => tournamentEngine.normalizeTournamentCollection([t])[0];
    const resultat = normalise({
      id: 'T-REPRISE',
      pendingPayouts: [{
        kind: 'prize',
        captainId: 'c1',
        entryId: 'E1',
        amount: 1000,
        lastError: 'SUPABASE_DOWN',
      }],
    });

    expect(resultat.pendingPayouts).toHaveLength(1);
    expect(resultat.pendingPayouts[0].captainId).toBe('c1');
    expect(resultat.pendingPayouts[0].amount).toBe(1000);
  });

  it('la reprise solde le gain rate, et la dette sort de la file', async () => {
    const tournoi = {
      ...tournoiSolde(),
      pendingPayouts: [{
        kind: 'prize', captainId: 'c1', entryId: 'E1', amount: 1000, lastError: 'SUPABASE_DOWN',
      }],
    };
    releaseWalletWinnings.mockImplementation(async () => {});

    const res = await tournamentEngine.retryPendingTournamentPayouts([tournoi]);

    expect(res.retried).toBe(1);
    expect(res.remaining).toBe(0);
    expect(res.tournaments[0].pendingPayouts, 'un gain reussi ne doit pas etre rejoue').toHaveLength(0);
    const gain = releaseWalletWinnings.mock.calls.find((c) => c[0] === 'c1');
    expect(gain[1]).toBe(1000);
    expect(gain[2]).toBe('T-REPRISE');
  });

  it('un gain qui echoue encore reste dans la file', async () => {
    const tournoi = {
      ...tournoiSolde(),
      pendingPayouts: [{
        kind: 'prize', captainId: 'c1', entryId: 'E1', amount: 1000, lastError: 'SUPABASE_DOWN',
      }],
    };
    releaseWalletWinnings.mockImplementation(async () => { throw new Error('SUPABASE_DOWN'); });

    const res = await tournamentEngine.retryPendingTournamentPayouts([tournoi]);

    expect(res.retried).toBe(0);
    expect(res.remaining).toBe(1);
    expect(res.tournaments[0].pendingPayouts).toHaveLength(1);
  });

  it('la reprise d un pass non consomme est elle aussi couverte', async () => {
    const tournoi = {
      ...tournoiSolde(),
      pendingPayouts: [{
        kind: 'forfeit', captainId: 'c3', entryId: 'E3', amount: 0, lastError: 'SUPABASE_DOWN',
      }],
    };

    const res = await tournamentEngine.retryPendingTournamentPayouts([tournoi]);

    expect(res.retried).toBe(1);
    expect(settleMatchLossWallet).toHaveBeenCalledWith('c3', 'T-REPRISE', expect.any(String));
  });

  it('la commission d arbitre en echec est reprise elle aussi', async () => {
    const tournoi = {
      ...tournoiSolde(),
      pendingPayouts: [{
        kind: 'arbiter', arbiterUserId: 'a1', slot: 1, amount: 300, lastError: 'SUPABASE_DOWN',
      }],
    };

    const res = await tournamentEngine.retryPendingTournamentPayouts([tournoi]);

    expect(res.retried).toBe(1);
    const fee = releaseWalletWinnings.mock.calls[0];
    expect(fee[0]).toBe('a1');
    expect(fee[2]).toBe('T-REPRISE-ARB-1');
    expect(fee[3]).toBe('arbitration_fee');
  });

  it('la sante compte les gains en attente', () => {
    const n = tournamentEngine.countPendingTournamentPayouts([
      { pendingPayouts: [{ kind: 'prize' }, { kind: 'prize' }] },
      { pendingPayouts: [{ kind: 'arbiter' }] },
      {},
    ]);
    expect(n).toBe(3);
  });
});