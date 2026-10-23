import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * C3 (audit-2) — reprendre un reglement passe en echec DURANT la resolution
 * d'un litige.
 *
 * Chemin nominal casse :
 *   1. l'arbitre soumet un resultat differe — `awaiting_confirmation`,
 *      `confirmationDeadline` a +30 min, `payoutDistributed` a `'pending'` ;
 *   2. le perdant ouvre un litige (le pool gèle, deadline NON effacee) ;
 *   3. l'admin tranche avec `action: 'settle'` et le reglement echoue
 *      PARTIELLEMENT (un joueur a ete supprime, Supabase sature...).
 *
 * AVANT correctif : le match repartait en `disputed` EN GARDANT sa deadline.
 * Cet etat etait invisible des QUATRE filtres de reprise :
 *   - `sweepPendingSettlements` exige l'absence de `confirmationDeadline` ;
 *   - `sweepExpiredConfirmations` exige `awaiting_confirmation` ;
 *   - l'automation saute tout match `disputed` ;
 *   - `sweepMatchesWithoutArbiter` exige un match jamais lance OU sans
 *     resultat (or il est lance AVEC un resultat).
 * La part non payee restait en sequestre pour toujours, et le statut
 * mentait : le litige etait clos, personne ne savait qu'il fallait agir.
 *
 * APRES correctif : l'echec ramene le match en `awaiting_confirmation`
 * SANS fenetre (un litige clos n'a plus rien a confirmer) — ce qui le place
 * dans le radar de `sweepPendingSettlements` ; et `settlePendingMatchResult`
 * cloture un match en dette une fois le reglement rejoue avec succes.
 */

const h = vi.hoisted(() => ({
  // comptes du test : id -> compte (wallet + stats)
  comptes: new Map(),
  // ids pour lesquels la consommation du pass perdant echoue
  echecs: new Set(),
}));

const creerCompte = (id) => ({
  id,
  pseudo: `Pse-${id}`,
  wallet: {
    zCoins: 1000,
    lockedEntries: {},
    transactions: [],
  },
  stats: { wins: 0, losses: 0, draws: 0, elo: 1200, totalEarnings: 0 },
  progression: { level: 'BEGINNER', xp: 0 },
  trustScore: 100,
});

vi.mock('./persistence.mjs', () => ({
  DEFAULT_TRUST_SCORE: 100,
  // Un CLONE a chaque lecture : le moteur mute ce qu'il recoit, l'etat du
  // test doit rester la source de verite pour les assertions.
  getUserById: vi.fn((id) => {
    const compte = h.comptes.get(id);
    return compte ? JSON.parse(JSON.stringify(compte)) : null;
  }),
  updateUserAccount: vi.fn(),
  sanitizeText: vi.fn((v) => String(v || '').trim()),
  applyUserSettlementOnce: vi.fn(async (userId, _cle, updater) => {
    const compte = h.comptes.get(userId);
    if (!compte) throw new Error('compte introuvable');
    h.comptes.set(userId, updater(compte));
  }),
}));

vi.mock('./wallet-engine.mjs', () => ({
  lockEntryFee: vi.fn(),
  refundLockedEntry: vi.fn(),
  releaseWalletWinnings: vi.fn(),
  settleMatchLossWallet: vi.fn((userId) => {
    if (h.echecs.has(userId)) throw new Error('PANNE_PORTFEUILLE');
  }),
}));

import * as moteur from './match-engine.mjs';

const ID = 'M-LITIGE';
const idMatch = ID;
const deadlineFuture = new Date(Date.parse('2026-01-01T00:00:00Z') + 30 * 60 * 1000).toISOString();

// Le match EST l'etat degrade decrit dans le constat C3 : resultat soumis,
// litige ouvert, reglement DIFFERE.
const matchLitige = (surcharge = {}) => {
  for (const compte of ['u1', 'u2', 'u3', 'arb']) {
    h.comptes.set(compte, creerCompte(compte));
  }
  // L'admin : `requireActorUser` repasse par `getUserById` et verifie le
  // role REEL du compte, pas celui du cache de la route.
  h.comptes.set('admin', { ...creerCompte('admin'), role: 'admin' });
  // La source de verite du pot REGLEE : les reservations wallet.
  for (const joueur of ['u1', 'u2', 'u3']) {
    h.comptes.get(joueur).wallet.lockedEntries[idMatch] = { amount: 10 };
  }
  return {
    id: idMatch,
    status: 'disputed',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    players: [
      { userId: 'u1', team: 0 },
      { userId: 'u2', team: 0 },
      { userId: 'u3', team: 1 },
    ],
    arbiter: { userId: 'arb', assignedAt: '2026-01-01T00:00:00Z' },
    confirmationDeadline: deadlineFuture,
    result: {
      winnerTeam: 0,
      payoutDistributed: 'pending',
      confirmedByTeams: ['u1', 'u2', 'u3'],
      submittedAt: '2026-01-01T00:00:00Z',
    },
    disputes: [
      {
        id: 'd1',
        status: 'open',
        reason: 'Le perdant conteste le rapport',
        openedAt: '2026-01-01T00:01:00Z',
      },
    ],
    ...surcharge,
  };
};

const adminActor = () => ({ id: 'admin', role: 'admin', pseudo: 'Admin' });

beforeEach(() => {
  h.comptes.clear();
  h.echecs.clear();
  vi.clearAllMocks();
});

describe('C3 - resolveDisputeOnServer : le reglement en echec tombe dans le radar de reprise', () => {
  it('echec partiel : le match repart en attente SANS fenetre, pas en disputed', async () => {
    // `settleMatchLossWallet` echoue pour le perdant : le reglement est
    // partiel (les gagnants sont payes, pas le perdant).
    h.echecs.add('u3');
    const outcome = await moteur.resolveDisputeOnServer(
      [matchLitige()], adminActor(), idMatch, 'Resultat confirme apres examen',
      { action: 'settle' },
    );

    expect(outcome.action).toBe('settle');
    // Le litige est CLOS avant l'echec du reglement.
    expect(outcome.match.disputes[0].status).toBe('resolved');
    // TROIS points C3 : statut en dette (attente), deadline effacee (le
    // match retombe dans `sweepPendingSettlements`), drapeau en 'pending'.
    expect(outcome.match.status).toBe('awaiting_confirmation');
    expect(outcome.match.confirmationDeadline).toBe(null);
    expect(outcome.match.result.payoutDistributed).toBe('pending');
  });

  it('echec partiel, puis reprise : le match finit ENTIEREMENT paye et clos', async () => {
    h.echecs.add('u3');
    const resolution = await moteur.resolveDisputeOnServer(
      [matchLitige()], adminActor(), idMatch, 'Resultat confirme apres examen',
      { action: 'settle' },
    );
    expect(resolution.match.status).not.toBe('finished');

    // La panne disparait : le cron de reprise rejoue le reglement (60 s
    // plus tard). Le joueur dette doit recevoir sa part et le match clot.
    h.echecs.clear();
    const reprise = await moteur.settlePendingMatchResult(resolution.matches, idMatch);
    expect(reprise.success).toBe(true);
    expect(reprise.match.result.payoutDistributed).toBe(true);
    expect(reprise.match.status).toBe('finished');
    expect(reprise.match.finishedAt).toBeTruthy();
    expect(reprise.match.confirmationDeadline).toBe(null);
  });

  it('reglement reussi des la resolution : le chemin nominal ne bouge pas', async () => {
    const outcome = await moteur.resolveDisputeOnServer(
      [matchLitige()], adminActor(), idMatch, 'Resultat confirme apres examen',
      { action: 'settle' },
    );
    expect(outcome.match.status).toBe('finished');
    expect(outcome.match.finishedAt).toBeTruthy();
    expect(outcome.match.confirmationDeadline).toBe(null);
    expect(outcome.match.result.payoutDistributed).toBe(true);
  });
});

describe('C3 - settlePendingMatchResult : cloture des etats de dette', () => {
  it('un etat HISTORIQUE disputed + deadline + litiges resolves est clos par la reprise', async () => {
    // Cas de base deja vieux dans la base : litige clos mais statut
    // `disputed`, deadline restante, reglement en attente. Le filtre cron
    // elargi vise cet etat : le moteur doit le solder ET le fermer.
    const match = matchLitige({
      disputes: [{ id: 'd1', status: 'resolved' }],
    });
    const outcome = await moteur.settlePendingMatchResult([match], idMatch);
    expect(outcome.success).toBe(true);
    expect(outcome.match.status).toBe('finished');
    expect(outcome.match.finishedAt).toBeTruthy();
    expect(outcome.match.confirmationDeadline).toBe(null);
  });

  it('un litige OUVERT reste gele : le reglement est refuse, rien ne bouge', async () => {
    const match = matchLitige({
      status: 'awaiting_confirmation',
      confirmationDeadline: null,
      disputes: [{ id: 'd1', status: 'open' }],
    });
    const outcome = await moteur.settlePendingMatchResult([match], idMatch);
    expect(outcome.success).toBe(false);
    expect(outcome.match.result.payoutDistributed).toBe('pending');
    expect(outcome.match.status).toBe('awaiting_confirmation');
  });
});
