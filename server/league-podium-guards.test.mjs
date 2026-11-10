import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Les deux gardes anti-sur-distribution du podium de ligue.
 *
 * Ce sont elles qui empechent le pot d'etre verse deux fois au meme joueur —
 * un doublon dans le classement (1er ET 2e) ou deux joueurs a la meme place.
 * L audit a montre qu'aucun test ne les executait : `league-engine.test.mjs`
 * n'importait meme pas `releaseWalletWinnings`. Elles tenaient peut-etre, mais
 * rien ne le garantissait.
 */

vi.mock('./persistence.mjs', () => ({
  getUserById: vi.fn((id) => (id === 'admin-1'
    ? { id: 'admin-1', pseudo: 'Admin', role: 'admin', stats: {}, progression: {} }
    : { id, pseudo: id, role: 'player', stats: {}, progression: {} })),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((value) => String(value || '').trim()),
  applyUserSettlementOnce: vi.fn(async (_id, _key, updater) => updater({ id: 'x', stats: {}, progression: {} })),
}));

vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(),
  releaseWalletWinnings: vi.fn(),
  settleMatchLossWallet: vi.fn(),
}));

vi.mock('./mutex.mjs', () => ({
  withWalletMutex: vi.fn(async (_id, fn) => fn()),
  withLeagueMutex: vi.fn(async (fn) => fn()),
}));

import * as leagueEngine from './league-engine.mjs';
import { releaseWalletWinnings } from './wallet-engine.mjs';

const admin = { id: 'admin-1', pseudo: 'Admin', role: 'admin' };

const saisonEnFinale = () => ({
  id: 'LS-PODIUM',
  cycleNumber: 4,
  name: 'Ligue finale',
  status: 'final',
  entryFee: 50,
  registeredPlayers: [],
  finalists: [{ userId: 'f1' }, { userId: 'f2' }, { userId: 'f3' }],
  standings: [],
  schedule: {},
  payout: { gross: 1000, first: 600, second: 250, third: 150 },
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('Gardes anti-sur-distribution du podium', () => {
  it('un meme joueur liste deux fois est refuse', async () => {
    // 1er ET 2e pour le meme joueur : sans la garde, il touchait deux fois le
    // podium, donc le pot etait sur-distribue d autant.
    const res = await leagueEngine.submitLeagueFinalResultsOnServer(
      [saisonEnFinale()],
      admin,
      'LS-PODIUM',
      [{ userId: 'f1', placement: 1 }, { userId: 'f1', placement: 2 }]
    ).then(() => null, (e) => e);

    expect(res, 'le doublon doit etre refuse').toBeTruthy();
    expect(releaseWalletWinnings, 'aucun versement ne doit partir').not.toHaveBeenCalled();
  });

  it('deux joueurs a la meme place sont refuses', async () => {
    const res = await leagueEngine.submitLeagueFinalResultsOnServer(
      [saisonEnFinale()],
      admin,
      'LS-PODIUM',
      [{ userId: 'f1', placement: 1 }, { userId: 'f2', placement: 1 }]
    ).then(() => null, (e) => e);

    expect(res, 'la place partagee doit etre refusee').toBeTruthy();
    expect(releaseWalletWinnings).not.toHaveBeenCalled();
  });

  it('un joueur non qualifie est refuse', async () => {
    const res = await leagueEngine.submitLeagueFinalResultsOnServer(
      [saisonEnFinale()],
      admin,
      'LS-PODIUM',
      [{ userId: 'inconnu', placement: 1 }]
    ).then(() => null, (e) => e);

    expect(res).toBeTruthy();
    expect(releaseWalletWinnings).not.toHaveBeenCalled();
  });

  it('un classement valide verse bien trois prix', async () => {
    // Témoin : les gardes ne doivent pas bloquer un classement legitimate.
    await leagueEngine.submitLeagueFinalResultsOnServer(
      [saisonEnFinale()],
      admin,
      'LS-PODIUM',
      [{ userId: 'f1', placement: 1 }, { userId: 'f2', placement: 2 }, { userId: 'f3', placement: 3 }]
    );

    const primes = releaseWalletWinnings.mock.calls.map((c) => `${c[0]}:${c[1]}`);
    expect(primes).toEqual(['f1:600', 'f2:250', 'f3:150']);
    // Chaque joueur une seule fois, et le total egale le podium annonce.
    const total = releaseWalletWinnings.mock.calls.reduce((s, c) => s + c[1], 0);
    expect(total).toBe(1000);
  });
});

describe('Remboursement admin : garde de statut', () => {
  const joueurInscrit = (statut) => ({
    id: 'LS-REMBOURSE',
    cycleNumber: 2,
    name: 'Ligue',
    status: statut,
    entryFee: 50,
    registeredPlayers: [{ userId: 'c1', pseudo: 'C1', paid: true, entryFee: 50 }],
    standings: [{ userId: 'c1', points: 10 }],
    finalists: [],
    schedule: {},
    payout: { gross: 50, first: 25, second: 15, third: 10 },
  });

  it('une saison soldee ne peut pas etre remboursee', async () => {
    // Sans cette garde, `refundLockedEntry` ne faisait RIEN (reservation deja
    // consommee) mais `payout` etait RECALCULE a la baisse : l ecran affichait
    // une cagnotte differente de celle reellement versee, et la route repondait
    // 200 alors qu aucun ZC n avait bouge.
    await expect(
      leagueEngine.refundLeaguePlayerOnServer([joueurInscrit('completed')], admin, 'LS-REMBOURSE', 'c1')
    ).rejects.toMatchObject({ code: 'MATCH_CLOSED' });
  });

  it('une saison en cours accepte le remboursement', async () => {
    const res = await leagueEngine.refundLeaguePlayerOnServer(
      [joueurInscrit('registering')], admin, 'LS-REMBOURSE', 'c1'
    );
    expect(res.season.registeredPlayers).toHaveLength(0);
    expect(res.season.payout.gross, 'le pot doit suivre le retrait').toBe(0);
  });

  it('une saison annulee refuse aussi : le remboursement de masse est deja fait', async () => {
    await expect(
      leagueEngine.refundLeaguePlayerOnServer([joueurInscrit('cancelled')], admin, 'LS-REMBOURSE', 'c1')
    ).rejects.toMatchObject({ code: 'MATCH_CLOSED' });
  });
});