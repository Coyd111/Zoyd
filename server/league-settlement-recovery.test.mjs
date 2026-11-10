import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le moteur de ligues etait le SEUL des trois systemes de reglement sans
 * aucune reprise des versements.
 *
 * Les tournois avaient `pendingPayouts` + un sweep cron ; les matchs avaient
 * `payoutDistributed: 'pending'`. Les ligues, non : les quatre `catch` de
 * `applyLeagueSettlement` ne faisaient qu'un `log.error`, aucun cron ne les
 * relisait, et le garde de route interdisait toute resoumission apres solde. Un
 * gain de ligue rate etait definitivement perdu, en silence.
 *
 * Le meme audit a montre que le fichier de test des ligues n'importait meme pas
 * `releaseWalletWinnings` : il n'existait aucune assertion sur un versement de
 * ligue dans tout le depot.
 */

vi.mock('./persistence.mjs', () => ({  // Applique une seule fois par competition : c'est le comportement reel.
  // Sans lui dans le mock, le test echouerait sur un appel a undefined.
  applyUserSettlementOnce: vi.fn(async (userId, _key, updater) => updater({ id: userId, stats: {}, progression: {} })),

  // `requireActorUser` resout le compte par id : il faut donc que le mock
  // renvoie un VRAI compte admin, sans quoi le role est undefined et la
  // fonction echoue sur FORBIDDEN avant meme d'atteindre la validation teste.
  getUserById: vi.fn((id) => (id === 'admin-1'
    ? { id: 'admin-1', pseudo: 'Admin', role: 'admin', stats: {}, progression: {} }
    : { id, pseudo: id, role: 'player', stats: {}, progression: {} })),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((value) => String(value || '').trim()),
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
import { releaseWalletWinnings, settleMatchLossWallet } from './wallet-engine.mjs';

beforeEach(() => {
  // `clearAllMocks` n efface PAS les implementations : une posee par un test
  // fuit dans le suivant et le fait echouer pour une mauvaise raison.
  vi.resetAllMocks();
});

const saisonSoldee = (overrides = {}) => ({
  id: 'LS-REPRISE',
  cycleNumber: 3,
  status: 'completed',
  registeredPlayers: [],
  podium: { first: 'c1', second: 'c2', third: 'c3' },
  payout: { gross: 1000, first: 600, second: 250, third: 150, playerPool: 1000 },
  ...overrides,
});

describe('Ligues — le tarif d entree', () => {
  const saisonEnInscription = () => ({
    id: 'LS-SETTINGS',
    cycleNumber: 1,
    status: 'registering',
    entryFee: 50,
    registeredPlayers: [],
    schedule: {},
    payout: { gross: 0, first: 0, second: 0, third: 0 },
  });

  const admin = { id: 'admin-1', pseudo: 'Admin', role: 'admin' };

  it('un tarif non numerique est refuse : NaN sinon divisait tous les calculs', () => {
    // `NaN < 0` ET `NaN > 500` sont tous deux `false` : un `entryFee: "abc"`
    // passait la validation et posait `season.entryFee = NaN`. La cagnotte et
    // tous les montants verses devenaient alors `NaN`, silencieusement.
    // La fonction leve de facon SYNCHRONE : `rejects` ne conviendrait pas.
    expect(() => leagueEngine.updateLeagueSettingsOnServer(
      [saisonEnInscription()], admin, 'LS-SETTINGS', { entryFee: 'abc' }
    )).toThrow(/nombre entre 0 et 500/);

    expect(() => leagueEngine.updateLeagueSettingsOnServer(
      [saisonEnInscription()], admin, 'LS-SETTINGS', { entryFee: NaN }
    )).toThrow(/nombre entre 0 et 500/);
  });

  it('le tarif est arrondi a 2 decimales', async () => {
    // Sans cet arrondi, le pot (produit) et l argent bloque (somme d arrondis
    // par inscription) divergent : de la monnaie creee ou detruite au reglement.
    const res = await leagueEngine.updateLeagueSettingsOnServer(
      [saisonEnInscription()], admin, 'LS-SETTINGS', { entryFee: 10.005 }
    );
    expect(res.seasons[0].entryFee).toBe(10.01);
  });

  it('le tarif reste fige des qu il y a des inscrits', () => {
    // La garde anti-detournement : si elle disparait, les passes deja bloques
    // ne correspondraient plus au pot affiche.
    const saison = saisonEnInscription();
    saison.registeredPlayers = [{ userId: 'c1' }];
    expect(() => leagueEngine.updateLeagueSettingsOnServer(
      [saison], admin, 'LS-SETTINGS', { entryFee: 75 }
    )).toThrow(/déjà inscrits/);
  });
});

describe('Ligues — la dette est ecrite au reglement', () => {
  it('un gain en echec est consigne dans `pendingPayouts`', async () => {
    const saison = saisonSoldee();
    releaseWalletWinnings.mockImplementation(async (userId) => {
      if (userId === 'c2') throw new Error('SUPABASE_DOWN');
    });

    await leagueEngine.applyLeagueSettlement(saison);

    const dettes = saison.pendingPayouts || [];
    expect(dettes).toHaveLength(1);
    expect(dettes[0].userId).toBe('c2');
    expect(dettes[0].kind).toBe('prize');
    expect(dettes[0].amount).toBe(250);
  });

  it('un pass non consomme en echec est consigne lui aussi', async () => {
    const saison = saisonSoldee({
      registeredPlayers: [{ userId: 'c9' }],
      podium: { first: null, second: null, third: null },
    });
    settleMatchLossWallet.mockImplementation(async () => { throw new Error('SUPABASE_DOWN'); });

    await leagueEngine.applyLeagueSettlement(saison);

    expect(saison.pendingPayouts).toHaveLength(1);
    expect(saison.pendingPayouts[0].kind).toBe('forfeit');
    expect(saison.pendingPayouts[0].userId).toBe('c9');
  });

  it('un reglement complet ne laisse aucune dette', async () => {
    const saison = saisonSoldee();
    await leagueEngine.applyLeagueSettlement(saison);
    expect(saison.pendingPayouts).toHaveLength(0);
  });
});

describe('Ligues — la reprise des gains', () => {
  it(' solde le gain rate et le sort de la file', async () => {
    const saisons = [{
      ...saisonSoldee(),
      pendingPayouts: [{ kind: 'prize', place: 2, userId: 'c2', amount: 250 }],
    }];

    const res = await leagueEngine.retryPendingLeaguePayouts(saisons);

    expect(res.retried).toBe(1);
    expect(res.remaining).toBe(0);
    expect(res.leagues[0].pendingPayouts).toHaveLength(0);
    const gain = releaseWalletWinnings.mock.calls[0];
    expect(gain[0]).toBe('c2');
    expect(gain[1]).toBe(250);
    expect(gain[2]).toBe('LS-REPRISE');
  });

  it('un gain qui echoue encore reste dans la file', async () => {
    const saisons = [{
      ...saisonSoldee(),
      pendingPayouts: [{ kind: 'prize', place: 2, userId: 'c2', amount: 250 }],
    }];
    releaseWalletWinnings.mockImplementation(async () => { throw new Error('SUPABASE_DOWN'); });

    const res = await leagueEngine.retryPendingLeaguePayouts(saisons);

    expect(res.retried).toBe(0);
    expect(res.remaining).toBe(1);
    expect(res.leagues[0].pendingPayouts).toHaveLength(1);
  });

  it('un pass non consommation est repris aussi', async () => {
    const saisons = [{
      ...saisonSoldee(),
      pendingPayouts: [{ kind: 'forfeit', userId: 'c9', amount: 0 }],
    }];

    const res = await leagueEngine.retryPendingLeaguePayouts(saisons);

    expect(res.retried).toBe(1);
    expect(settleMatchLossWallet).toHaveBeenCalledWith('c9', 'LS-REPRISE', expect.any(String));
  });

  it('la sante compte les gains en attente', () => {
    expect(leagueEngine.countPendingLeaguePayouts([
      { pendingPayouts: [{ kind: 'prize' }, { kind: 'prize' }] },
      { pendingPayouts: [{ kind: 'forfeit' }] },
      {},
    ])).toBe(3);
  });
});