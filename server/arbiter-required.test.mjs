import { describe, it, expect, vi, beforeEach } from 'vitest';

// `requireActorUser` passe par `getUserById` : sans comptes reels, l appel
// echoue avant d atteindre les gardes qu on veut tester. On fournit donc des
// comptes factices, comme le fait la suite du moteur.
vi.mock('./persistence.mjs', () => ({
  applyUserSettlementOnce: vi.fn(async (userId, _key, updater) => updater({ id: userId, stats: {}, progression: {} })),
  getUserById: vi.fn((id) => ({
    id,
    pseudo: id,
    role: id === 'root' ? 'admin' : 'player',
    trustScore: 100,
    stats: {},
    progression: {},
    wallet: { cashBalance: 1000, bonusBalance: 0, lockedBalance: 0, lockedEntries: {}, transactions: [] },
  })),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((v) => String(v || '').trim()),
}));

vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(),
  releaseWalletWinnings: vi.fn(),
  settleMatchLossWallet: vi.fn(),
}));

import * as matchEngine from './match-engine.mjs';

beforeEach(() => vi.clearAllMocks());

/**
 * L'arbitre est obligatoire. Toujours.
 *
 * Ce que le modèle garantissait avant
 * ----------------------------------
 * `submitMatchResultOnServer` portait deux gardes successives :
 *
 *   if (!isArbiter && !isPlayer && !admin) -> refus
 *   if (match.arbiter && !isArbiter && !admin) -> refus
 *
 * La seconde ne s'applique que SI un arbitre existe. Sans arbitre, **n'importe
 * quel participant pouvait valider le score** — y compris le perdant, qui se
 * declarait vainqueur. Personne n'avait rien a dire : pas de tiers, pas de
 * preuve attendue de tiers.
 *
 * C'est l'inverse de ce que veut l arbitrage. L'arbitre n'est pas un
 *BOOSTER de confort sur les gros pots : c'est lui qui fait tenir l'heure du
 * match, qui arrete les rematchs, et dont les ordres s'appliquent avant le
 * lancement. Sans lui, il n'y a pas de match — il y a un pot sans garant.
 *
 * L'administrateur reste autorise, lui seul : c'est le recours quand l'arbitre
 * a disparu, et il doit rester trace.
 */

const matchDeBase = (surcharge = {}) => ({
  id: 'M-1',
  status: 'in_progress',
  isInstant: true,
  players: [
    { userId: 'p-gagnant', team: 0, isCheckedIn: true, isReady: true },
    { userId: 'p-perdant', team: 1, isCheckedIn: true, isReady: true },
  ],
  disputes: [],
  prizePool: 1000,
  entryFee: 500,
  teamSize: 1,
  maxPlayers: 2,
  ...surcharge,
});

const resultatValide = {
  winnerTeam: 0,
  scores: { team0: 5, team1: 2 },
  // Le contrat reel est `proofs: { scoreboard, finalResult }` — pas
  // `proofScreenshots`. Avec le mauvais nom, le garde des preuves s execute
  // et le test echoue pour une raison qui n a rien a voir avec l arbitre.
  proofs: { scoreboard: ['ref-scoreboard'], finalResult: ['ref-final'] },
};

describe('Arbitre obligatoire', () => {
  it('un joueur NE PEUT PAS valider le score quand il n y a pas d arbitre', async () => {
    // Le cas le plus grave : le perdant s'auto-proclame vainqueur, et le pot
    // lui est verse parce que personne n'a de droit de regard.
    const match = matchDeBase();

    await expect(
      matchEngine.submitMatchResultOnServer([match], { id: 'p-perdant' }, 'M-1', resultatValide)
    ).rejects.toMatchObject({ code: 'ARBITER_REQUIRED' });

    await expect(
      matchEngine.submitMatchResultOnServer([match], { id: 'p-gagnant' }, 'M-1', resultatValide)
    ).rejects.toMatchObject({ code: 'ARBITER_REQUIRED' });
  });

  it('un tiers qui ne joue pas ne peut PAS valider non plus', async () => {
    const match = matchDeBase();
    await expect(
      matchEngine.submitMatchResultOnServer([match], { id: 'p-etranger' }, 'M-1', resultatValide)
    ).rejects.toMatchObject({ code: 'ARBITER_REQUIRED' });
  });

  it('ni l administrateur ni personne ne peut regler sans arbitre', async () => {
    // L admin n'est PAS une voie de contournement : l'enregistrement
    // declenche le reglement, donc le garde de la sortie d argent le bloque
    // aussi. C'est le comportement voulu — un administrateur ne doit pas
    // pouvoir etre la voie par laquelle un pot part sans avoir ete observe par
    // un tiers. Ce qui vaut alors est le remboursement.
    const match = matchDeBase();
    await expect(
      matchEngine.submitMatchResultOnServer([match], { id: 'root', role: 'admin' }, 'M-1', resultatValide)
    ).rejects.toMatchObject({ code: 'ARBITER_REQUIRED' });
  });

  it('un joueur ne peut toujours pas valider quand un arbitre EST assigne', async () => {
    // La garde ne doit pas s etre seulement ajoutee : le cas « arbitre
    // present » doit rester interdit aux joueurs.
    const match = matchDeBase({ arbiter: { userId: 'p-arb', pseudo: 'Arb' } });

    await expect(
      matchEngine.submitMatchResultOnServer([match], { id: 'p-gagnant' }, 'M-1', resultatValide)
    ).rejects.toMatchObject({ code: 'ARBITER_REQUIRED' });
  });

  it('l arbitre designe peut valider', async () => {
    const match = matchDeBase({ arbiter: { userId: 'p-arb', pseudo: 'Arb' } });
    await expect(
      matchEngine.submitMatchResultOnServer([match], { id: 'p-arb' }, 'M-1', resultatValide)
    ).resolves.toBeTruthy();
  });

  it('le reglement refuse de distribuer un pot sans arbitre', async () => {
    // La reprise d un resultat interrompu passe par un chemin distinct de la
    // soumission : sans garde ici, un match sans arbitre pourrait etre solde
    // apres coup. Le champ `result.payoutDistributed` est ce que la reprise
    // teste — pas `settlementStatus`, qui n existe pas.
    const match = matchDeBase({
      result: { ...resultatValide, payoutDistributed: 'pending' },
    });

    await expect(
      matchEngine.settlePendingMatchResult([match], 'M-1')
    ).rejects.toMatchObject({ code: 'ARBITER_REQUIRED' });
  });
});