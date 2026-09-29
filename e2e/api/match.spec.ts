import { test, expect } from '@playwright/test';
import {
  call,
  callAnonymous,
  creditWallet,
  disposeActors,
  openAdminSession,
  registerPlayer,
  type Actor,
} from './support/harness';

// Contrat réel relevé dans server/realtime-server.mjs + server/match-engine.mjs :
//   POST /api/matches              201, format `^(\d+)VS(\d+)$` (1..5, symétrique),
//                                  entryFee REQUIS, rules = OBJET MatchRules
//                                  (une chaîne est silencieusement remplacée par {}).
//   POST /api/matches/:id/join     200, refus ALREADY_JOINED 409, ROLE_CONFLICT 409,
//                                  NO_SLOT_AVAILABLE 409, MATCH_NOT_FOUND 404.
//                                  Le passe (entryFee) est VERROUILLÉ dans le wallet.
//   .../arbiter                    200, refus ROLE_CONFLICT 409 / ARBITER_TAKEN 409.
//   .../check-in                   200, CHECKIN_REQUIRED 400 si /ready avant.
//   .../ready                      200, MATCH_NOT_READY 400 sans check-in.
//   .../schedule                   200, seul `scheduledAt` est lu (roomCode ignoré).
//   .../room                       200, arbitre/admin uniquement (403 FORBIDDEN),
//                                 scheduledAt obligatoire et à ≤ 10 min.
//   .../launch                     200, arbitre uniquement, roster complet + check-in
//                                  + ready + salle publiée.
//   .../result                     200, arbitre uniquement dès qu'un arbitre est
//                                  assigné ; scoreboard + écran final obligatoires.
//   .../confirm                    409 ALREADY_CONFIRMED : `submitMatchResultOnServer`
//                                  passe déjà le match à `finished`, donc la
//                                  confirmation joueur est inatteignable (cf. rapport).
//   .../disputes                   200, participant/arbitre/admin uniquement,
//                                  raison + ≥ 1 preuve obligatoires.
const BASE = '/api';
const MATCH_FORMAT = '1VS1';
const ENTRY_FEE = 100;
const START_BALANCE = 1_000;
const LOCKED_POT = ENTRY_FEE * 2; // 200 ZC réellement verrouillés
const ARBITER_FEE = Math.round(LOCKED_POT * 0.02); // 4 ZC
const WINNER_PAYOUT = LOCKED_POT - ARBITER_FEE; // 196 ZC

const MATCH_RULES = {
  mode: 'battle_royale',
  map: 'Nuketown',
  scoreTarget: 10,
  bestOf: 3,
};

test.describe('Match lifecycle', () => {
  // Les tests partagent token, matchId et l'état du wallet : l'ordre compte.
  test.describe.configure({ mode: 'serial' });

  let creator: Actor;
  let joiner: Actor;
  let arbiter: Actor;
  let matchId = '';
  let disputeMatchId = '';
  const scheduledAt = new Date(Date.now() + 3 * 60 * 1000).toISOString();

  test.beforeAll(async () => {
    creator = await registerPlayer('E2EA');
    joiner = await registerPlayer('E2EB');
    arbiter = await registerPlayer('E2EARB');
    const admin = await openAdminSession();
    // Seuls les joueurs paient un passe ; l'arbitre est rémunéré sur la
    // cagnotte verrouillée au moment du règlement.
    await creditWallet(admin, creator.id, START_BALANCE);
    await creditWallet(admin, joiner.id, START_BALANCE);
  });

  test.afterAll(async () => {
    await disposeActors();
  });

  test('POST /api/matches — 400 sur un format non conforme (1v1)', async () => {
    const res = await call(creator, 'POST', `${BASE}/matches`, {
      format: '1v1',
      entryFee: ENTRY_FEE,
      rules: MATCH_RULES,
      visibility: 'public',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FORMAT');
  });

  test('POST /api/matches — 400 sur un format asymétrique ou hors bornes', async () => {
    for (const format of ['3VS2', '6VS6']) {
      const res = await call(creator, 'POST', `${BASE}/matches`, { format, entryFee: ENTRY_FEE });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_FORMAT');
    }
  });

  test('POST /api/matches — 400 sans entryFee', async () => {
    const res = await call(creator, 'POST', `${BASE}/matches`, {
      format: MATCH_FORMAT,
      rules: MATCH_RULES,
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_AMOUNT');
  });

  test('POST /api/matches — 401 sans session', async () => {
    const res = await callAnonymous('POST', `${BASE}/matches`, {
      format: MATCH_FORMAT,
      entryFee: ENTRY_FEE,
    });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  test('POST /api/matches — 201 : règles en objet + passe verrouillé', async () => {
    const res = await call(creator, 'POST', `${BASE}/matches`, {
      format: MATCH_FORMAT,
      entryFee: ENTRY_FEE,
      rules: MATCH_RULES,
      visibility: 'public',
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    const match = res.body.match;
    matchId = match.id;
    expect(matchId).toMatch(/^M-/);
    expect(match.format).toBe(MATCH_FORMAT);
    expect(match.teamSize).toBe(1);
    expect(match.maxPlayers).toBe(2);
    expect(match.rules).toEqual(MATCH_RULES);
    expect(match.entryFee).toBe(ENTRY_FEE);
    expect(match.prizePool).toBe(LOCKED_POT);
    expect(match.arbiterFee).toBe(ARBITER_FEE);
    expect(match.status).toBe('recruiting');
    expect(match.visibility).toBe('public');
    expect(match.creatorId).toBe(creator.id);
    expect(match.players).toHaveLength(1);
    expect(match.players[0].pseudo).toBe(creator.pseudo);
    expect(match.players[0].isCaptain).toBe(true);
    // Diffusion publique : ni userId interne, ni mot de passe de salle.
    expect(match.players[0].userId).toBeUndefined();
    expect(match.roomPassword).toBeUndefined();

    // Le passe du créateur est bloqué, pas débité deux fois.
    expect(res.body.wallet.cashBalance).toBe(START_BALANCE - ENTRY_FEE);
    expect(res.body.wallet.lockedBalance).toBe(ENTRY_FEE);
    expect(res.body.wallet.lockedEntries[matchId].amount).toBe(ENTRY_FEE);
    expect(res.body.user.id).toBe(creator.id);
  });

  test('GET /api/matches — liste les matchs publics visibles', async () => {
    const res = await call(creator, 'GET', `${BASE}/matches`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.matches)).toBe(true);
    const listed = res.body.matches.find((entry: any) => entry.id === matchId);
    expect(listed).toBeTruthy();
    expect(listed.format).toBe(MATCH_FORMAT);
    expect(listed.players[0].userId).toBeUndefined();
  });

  test('POST /api/matches/:id/join — 409 si le créateur rejoint son propre match', async () => {
    const res = await call(creator, 'POST', `${BASE}/matches/${matchId}/join`, { team: 1 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_JOINED');
  });

  test('POST /api/matches/:id/join — le second joueur rejoint, son passe est bloqué', async () => {
    const res = await call(joiner, 'POST', `${BASE}/matches/${matchId}/join`, { team: 1 });

    expect(res.status).toBe(200);
    expect(res.body.match.players).toHaveLength(2);
    expect(res.body.match.players[1].pseudo).toBe(joiner.pseudo);
    expect(res.body.match.players[1].team).toBe(1);
    expect(res.body.match.status).toBe('full');
    expect(res.body.wallet.cashBalance).toBe(START_BALANCE - ENTRY_FEE);
    expect(res.body.wallet.lockedBalance).toBe(ENTRY_FEE);
  });

  test('POST /api/matches/:id/arbiter — 409 : un joueur ne peut pas arbitrer', async () => {
    const res = await call(creator, 'POST', `${BASE}/matches/${matchId}/arbiter`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROLE_CONFLICT');
  });

  test('POST /api/matches/:id/arbiter — 200 : l’arbitre est assigné', async () => {
    const res = await call(arbiter, 'POST', `${BASE}/matches/${matchId}/arbiter`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.match.arbiter.pseudo).toBe(arbiter.pseudo);
    // Divergence relevée : `sanitizeMatchForBroadcast` retire `userId` aux
    // JOUEURS mais le laisse sur l'arbitre. On fige le comportement observé.
    expect(res.body.match.arbiter.userId).toBe(arbiter.id);
    expect(res.body.match.arbiter.hasSubmittedResult).toBe(false);
    // Roster complet + arbitre => le match bascule en phase de check-in.
    expect(res.body.match.status).toBe('check_in');
  });

  test('POST /api/matches/:id/ready — 400 avant le check-in', async () => {
    const res = await call(creator, 'POST', `${BASE}/matches/${matchId}/ready`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CHECKIN_REQUIRED');
  });

  test('POST /api/matches/:id/check-in — les deux joueurs valident leur présence', async () => {
    const first = await call(creator, 'POST', `${BASE}/matches/${matchId}/check-in`);
    expect(first.status).toBe(200);
    expect(first.body.match.players[0].isCheckedIn).toBe(true);

    const second = await call(joiner, 'POST', `${BASE}/matches/${matchId}/check-in`);
    expect(second.status).toBe(200);
    expect(second.body.match.players.every((player: any) => player.isCheckedIn)).toBe(true);
  });

  test('POST /api/matches/:id/ready — les deux joueurs sont prêts', async () => {
    const first = await call(creator, 'POST', `${BASE}/matches/${matchId}/ready`);
    expect(first.status).toBe(200);
    expect(first.body.match.players[0].isReady).toBe(true);

    const second = await call(joiner, 'POST', `${BASE}/matches/${matchId}/ready`);
    expect(second.status).toBe(200);
    expect(second.body.match.players.every((player: any) => player.isReady)).toBe(true);
    // Un arbitre est assigné : le démarrage reste manuel.
    expect(second.body.match.status).toBe('ready');
  });

  test('POST /api/matches/:id/schedule — seul scheduledAt est pris en compte', async () => {
    const res = await call(creator, 'POST', `${BASE}/matches/${matchId}/schedule`, {
      scheduledAt,
      roomCode: `ROOM-${matchId}`,
      roomPassword: 'ignored',
    });

    expect(res.status).toBe(200);
    expect(new Date(res.body.match.scheduledAt).toISOString()).toBe(new Date(scheduledAt).toISOString());
    expect(res.body.match.roomCode).toBeUndefined();
    expect(res.body.match.roomPassword).toBeUndefined();
  });

  test('POST /api/matches/:id/room — 403 : seul l’arbitre publie la salle', async () => {
    const res = await call(creator, 'POST', `${BASE}/matches/${matchId}/room`, {
      roomName: `Room-${matchId}`,
      roomPassword: 'test123',
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('POST /api/matches/:id/room — 200 : l’arbitre publie la salle', async () => {
    const res = await call(arbiter, 'POST', `${BASE}/matches/${matchId}/room`, {
      roomName: `Room-${matchId}`,
      roomPassword: 'test123',
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // La salle n'est jamais diffusée en clair dans la réponse.
    expect(res.body.match.roomName).toBeUndefined();
    expect(res.body.match.roomPassword).toBeUndefined();
  });

  test('POST /api/matches/:id/launch — 403 : seul l’arbitre lance', async () => {
    const res = await call(joiner, 'POST', `${BASE}/matches/${matchId}/launch`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('POST /api/matches/:id/launch — 200 : le match passe in_progress', async () => {
    const res = await call(arbiter, 'POST', `${BASE}/matches/${matchId}/launch`);

    expect(res.status).toBe(200);
    expect(res.body.match.status).toBe('in_progress');
    expect(typeof res.body.match.startedAt).toBe('string');
  });

  test('POST /api/matches/:id/result — 403 : un joueur ne peut pas valider si un arbitre est assigné', async () => {
    const res = await call(creator, 'POST', `${BASE}/matches/${matchId}/result`, {
      winnerTeam: 0,
      scores: { team0: 1, team1: 0 },
      screenshots: [],
      proofs: {
        scoreboard: ['https://example.com/score.png'],
        finalResult: ['https://example.com/result.png'],
      },
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('POST /api/matches/:id/result — 400 sans scoreboard ni écran final', async () => {
    const res = await call(arbiter, 'POST', `${BASE}/matches/${matchId}/result`, {
      winnerTeam: 0,
      scores: { team0: 10, team1: 3 },
      screenshots: [],
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROOFS_REQUIRED');
  });

  test('POST /api/matches/:id/result — 400 sur un winnerTeam hors {0,1}', async () => {
    const res = await call(arbiter, 'POST', `${BASE}/matches/${matchId}/result`, {
      winnerTeam: 5,
      scores: { team0: 10, team1: 3 },
      screenshots: [],
      proofs: {
        scoreboard: ['https://example.com/score.png'],
        finalResult: ['https://example.com/result.png'],
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_RESULTS');
  });

  test('POST /api/matches/:id/result — 200 : l’arbitre valide, le règlement est distribué', async () => {
    const res = await call(arbiter, 'POST', `${BASE}/matches/${matchId}/result`, {
      winnerTeam: 0,
      scores: { team0: 10, team1: 3 },
      screenshots: [],
      proofs: {
        scoreboard: ['https://example.com/score.png'],
        finalResult: ['https://example.com/result.png'],
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const match = res.body.match;
    expect(match.status).toBe('finished');
    expect(match.result.winnerTeam).toBe(0);
    expect(match.result.scores).toEqual({ team0: 10, team1: 3 });
    expect(match.result.resolutionType).toBe('played');
    expect(match.result.payoutDistributed).toBe(true);
    expect(typeof match.result.proofHash).toBe('string');
    // Les preuves ne sont jamais rediffusées dans la charge utile publique.
    expect(match.result.proofs).toBeUndefined();
    expect(match.result.screenshots).toBeUndefined();

    // La réponse décrit l'ARBITRE : sa commission = 2 % de la cagnotte verrouillée.
    expect(res.body.wallet.cashBalance).toBe(ARBITER_FEE);
  });

  test('POST /api/matches/:id/result — 409 si un résultat existe déjà', async () => {
    const res = await call(arbiter, 'POST', `${BASE}/matches/${matchId}/result`, {
      winnerTeam: 1,
      scores: { team0: 0, team1: 10 },
      screenshots: [],
      proofs: {
        scoreboard: ['https://example.com/score.png'],
        finalResult: ['https://example.com/result.png'],
      },
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RESULT_ALREADY_EXISTS');
  });

  test('POST /api/matches/:id/confirm — 409 : le match est déjà soldé', async () => {
    // Contrat observé : submitMatchResultOnServer bascule le match à
    // `finished` avant toute confirmation, donc confirmMatchResultOnServer
    // répond systématiquement ALREADY_CONFIRMED. On verrouille ce comportement
    // plutôt que de le contourner.
    for (const actor of [creator, joiner]) {
      const res = await call(actor, 'POST', `${BASE}/matches/${matchId}/confirm`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ALREADY_CONFIRMED');
    }
  });

  test('Le règlement distribue la cagnotte verrouillée, pas la cagnotte nominale', async () => {
    const winner = await call(creator, 'GET', `${BASE}/wallet/me`);
    expect(winner.status).toBe(200);
    // 1 000 - 100 (passe) + 196 (gain)
    expect(winner.body.wallet.cashBalance).toBe(START_BALANCE - ENTRY_FEE + WINNER_PAYOUT);
    expect(winner.body.wallet.lockedBalance).toBe(0);
    expect(winner.body.wallet.lockedEntries).toEqual({});
    expect(winner.body.user.stats.wins).toBe(1);
    expect(winner.body.user.stats.totalEarnings).toBe(WINNER_PAYOUT);

    const loser = await call(joiner, 'GET', `${BASE}/wallet/me`);
    expect(loser.status).toBe(200);
    // Le perdant consomme son passe : aucun remboursement.
    expect(loser.body.wallet.cashBalance).toBe(START_BALANCE - ENTRY_FEE);
    expect(loser.body.wallet.lockedBalance).toBe(0);
    expect(loser.body.user.stats.losses).toBe(1);
  });

  test('POST /api/matches — 409 si le solde ne permet pas de bloquer le passe', async () => {
    const res = await call(arbiter, 'POST', `${BASE}/matches`, {
      format: MATCH_FORMAT,
      entryFee: 50_000,
      rules: MATCH_RULES,
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
  });

  test('POST /api/matches — rules par défaut = {} quand la clé est absente', async () => {
    const res = await call(creator, 'POST', `${BASE}/matches`, {
      format: MATCH_FORMAT,
      entryFee: 50,
      visibility: 'public',
    });

    expect(res.status).toBe(201);
    disputeMatchId = res.body.match.id;
    // Une chaîne `rules` n'est pas validée mais remplacée par {} : le contrat
    // réel impose un OBJET MatchRules.
    expect(res.body.match.rules).toEqual({});
    expect(res.body.match.status).toBe('recruiting');
  });

  test('POST /api/matches/:id/disputes — accès réservé aux participants', async () => {
    const joined = await call(joiner, 'POST', `${BASE}/matches/${disputeMatchId}/join`, { team: 1 });
    expect(joined.status).toBe(200);
    expect(joined.body.match.players).toHaveLength(2);

    // L'arbitre du match précédent n'est ni joueur ni arbitre de celui-ci.
    const res = await call(arbiter, 'POST', `${BASE}/matches/${disputeMatchId}/disputes`, {
      reason: 'Je ne joue pas ici',
      evidence: ['https://example.com/proof.png'],
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('POST /api/matches/:id/disputes — 400 sans preuve', async () => {
    const res = await call(creator, 'POST', `${BASE}/matches/${disputeMatchId}/disputes`, {
      reason: 'Adversaire qui triche',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DISPUTE_INCOMPLETE');
  });

  test('POST /api/matches/:id/disputes — 200 : le litige gèle la cagnotte', async () => {
    const res = await call(creator, 'POST', `${BASE}/matches/${disputeMatchId}/disputes`, {
      reason: 'Adversaire qui triche',
      evidence: ['https://example.com/proof.png'],
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.match.status).toBe('disputed');
    expect(res.body.match.disputes).toHaveLength(1);
    expect(res.body.match.disputes[0].status).toBe('open');
    expect(res.body.match.disputes[0].prizePoolFrozen).toBe(true);
    expect(res.body.match.disputes[0].openedByPseudo).toBe(creator.pseudo);
    expect(res.body.match.disputes[0].evidence).toEqual(['https://example.com/proof.png']);
  });

  test('POST /api/matches/:id/result — 409 tant qu’un litige est actif', async () => {
    const res = await call(creator, 'POST', `${BASE}/matches/${disputeMatchId}/result`, {
      winnerTeam: 0,
      scores: { team0: 1, team1: 0 },
      screenshots: ['https://example.com/proof.png'],
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DISPUTE_ALREADY_OPEN');

    // La cagnotte reste gelée : aucun gain crédité.
    const wallet = await call(creator, 'GET', `${BASE}/wallet/me`);
    expect(wallet.body.wallet.cashBalance).toBe(START_BALANCE - ENTRY_FEE + WINNER_PAYOUT - 50);
    expect(wallet.body.wallet.lockedBalance).toBe(50);
  });
});
