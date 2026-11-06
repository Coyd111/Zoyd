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
//   .../confirm                    joueur du match uniquement. Une seule
//                                  confirmation ne verse rien ; la deuxieme
//                                  declenche le reglement. Un tiers est 403.
//   .../disputes                   200, participant/arbitre/admin uniquement,
//                                  raison + ≥ 1 preuve obligatoires.
//   .../leave                      200 : remboursement integral du pass du
//                                  joueur pre-lancement ; MATCH_LAUNCHED 409
//                                  des que `startedAt`/resultat existe,
//                                  CREATOR_CANNOT_LEAVE 409 pour le createur,
//                                  NOT_IN_MATCH 409 sinon.
//   .../cancel                     200 : annulation du CREATEUR tant que
//                                  personne d autre n a pose un pass
//                                  (OPPONENTS_PRESENT 409 sinon), statut
//                                  `cancelled` + remboursement integral.
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
    // S4 (audit-2) : l'UUID interne du createur ne sort JAMAIS
    // (state-helpers.mjs:189-191) — le createur reste visible via creatorPseudo.
    expect(match.creatorId).toBeUndefined();
    expect(match.creatorPseudo).toBe(creator.pseudo);
    expect(match.players).toHaveLength(1);
    expect(match.players[0].pseudo).toBe(creator.pseudo);
    expect(match.players[0].isCaptain).toBe(true);

    // ── Le bug le plus grave du projet ──
    // Le serveur retire `userId` (vie privée) mais AJOUTE `isMe`, calculé
    // pour le demandeur. Sans ce drapeau, le client ne pouvait pas se
    // reconnaître dans son match : `currentPlayer` restait undefined et les
    // boutons « Confirmer ma présence » / « Je suis prêt » ne s'affichaient
    // JAMAIS. On verrouille donc le contrat, y compris l'absence de fuite.
    expect(match.players[0].isMe, 'le createur doit se reconnaitre').toBe(true);
    expect(match.players[0].hasConfirmed).toBe(false);
    // vue d'un tiers : isMe false partout, toujours aucun userId
    const asArbiter = await call(arbiter, 'GET', `${BASE}/matches`);
    const sameMatch = asArbiter.body.matches.find((m: any) => m.id === matchId);
    expect(sameMatch).toBeTruthy();
    for (const player of sameMatch.players) {
      expect(player.userId, 'aucun userId ne doit fuiter').toBeUndefined();
    }
    expect(sameMatch.players.every((p: any) => p.isMe === false)).toBe(true);
    // Pas d'arbitre tant que le match est en `recruiting` : rien a corriger.
    if (sameMatch.arbiter) {
      expect(sameMatch.arbiter.isMe).toBe(false);
      expect(sameMatch.arbiter.userId).toBeUndefined();
    }
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
    // Le lobby est complet mais le match ne peut PAS avancer : pas d'arbitre.
    // L'ancien contrat disait `full`, ce qui se lisait « prêt » alors que rien
    // ne pouvait se passer — le joueur ne comprenait pas pourquoi.
    expect(res.body.match.status).toBe('awaiting_arbiter');
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
    // `sanitizeMatchForBroadcast` retire `userId` (joueurs ET arbitre) et
    // ajoute `isMe`, calcule pour le demandeur. C'est ce drapeau qui permet
    // au client de s'identifier dans le match.
    expect(res.body.match.arbiter.userId).toBeUndefined();
    expect(res.body.match.arbiter.isMe).toBe(true);
    // Cote joueur, aucun userId ne doit fuiter, mais isMe est present.
    for (const player of res.body.match.players) {
      expect(player.userId).toBeUndefined();
      expect(typeof player.isMe).toBe('boolean');
    }
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
    // P13 C2 : la salle est livree PAR destinataire — l'arbitre la recoit
    // dans le champ dedie `room`. Les champs bruts ne sortent jamais.
    expect(res.body.match.room).toEqual({ name: `Room-${matchId}`, password: 'test123' });
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

    // 409, pas 403 : le match n'est pas interdit, il est dans un etat qui bloque
    // encore l'action — exactement comme un litige ouvert. Le joueur doit lire
    // « en attente d'un arbitre », pas « acces refuse ».
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ARBITER_REQUIRED');
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

  test('POST /api/matches/:id/result — 200 : mise en attente de confirmation, RIEN n’est versé', async () => {
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
    expect(res.body.awaitingConfirmation).toBe(true);
    const match = res.body.match;
    // La confirmation des deux équipes précède TOUT versement.
    expect(match.status).toBe('awaiting_confirmation');
    expect(match.result.winnerTeam).toBe(0);
    expect(match.result.scores).toEqual({ team0: 10, team1: 3 });
    expect(match.result.resolutionType).toBe('played');
    expect(match.result.payoutDistributed).toBe('pending');
    // `confirmedByTeams` est un tableau de userIds : c'est exactement le type
    // de donnee qui ne doit JAMAIS sortir vers le client (meme ligne que
    // `proofs`/`screenshots` ci-dessous).
    expect(match.result.confirmedByTeams).toBeUndefined();
    expect(match.confirmationDeadline).toBeTruthy();
    // S4 (audit-2) : `proofHash` ne sort pas — il n'est PAS un hash, c'est la
    // concatenation des URL de captures (buildProofHash, state-helpers.mjs:273).
    // Il reste stocke cote serveur comme piste de verification.
    expect(match.result.proofHash).toBeUndefined();
    // Les preuves ne sont jamais rediffusées dans la charge utile publique.
    expect(match.result.proofs).toBeUndefined();
    expect(match.result.screenshots).toBeUndefined();

    // Point de non-retour : l'arbitre n'est PAS payé tant que les joueurs
    // n'ont pas confirmé. L'arbitre démarre à 0 (seuls le créateur et le
    // joiner sont crédités), donc 0 = aucune commission versée.
    const arbiterWallet = await call(arbiter, 'GET', `${BASE}/wallet/me`);
    expect(arbiterWallet.status).toBe(200);
    expect(arbiterWallet.body.wallet.cashBalance).toBe(0);
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

  test('POST /api/matches/:id/confirm — un seul joueur ne suffit pas', async () => {
    const res = await call(creator, 'POST', `${BASE}/matches/${matchId}/confirm`);

    expect(res.status).toBe(200);
    expect(res.body.settled).toBe(false);
    expect(res.body.waitingFor).toEqual([joiner.id]);
    expect(res.body.match.status).toBe('awaiting_confirmation');
    expect(res.body.match.result.payoutDistributed).toBe('pending');

    // Toujours rien versé.
    const winner = await call(creator, 'GET', `${BASE}/wallet/me`);
    expect(winner.body.wallet.cashBalance).toBe(START_BALANCE - ENTRY_FEE);
    expect(winner.body.wallet.lockedEntries).not.toEqual({});
  });

  test('POST /api/matches/:id/confirm — un tiers ne peut pas confirmer', async () => {
    const res = await call(arbiter, 'POST', `${BASE}/matches/${matchId}/confirm`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('POST /api/matches/:id/confirm — la seconde confirmation déclenche le règlement', async () => {
    const res = await call(joiner, 'POST', `${BASE}/matches/${matchId}/confirm`);

    expect(res.status).toBe(200);
    expect(res.body.settled).toBe(true);
    expect(res.body.waitingFor).toEqual([]);
    expect(res.body.match.status).toBe('finished');
    expect(res.body.match.result.payoutDistributed).toBe(true);
    expect(res.body.match.confirmationDeadline).toBeNull();
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

    // La commission d'arbitre n'est versée qu'à ce moment-là.
    const arbiterWallet = await call(arbiter, 'GET', `${BASE}/wallet/me`);
    expect(arbiterWallet.body.wallet.cashBalance).toBe(ARBITER_FEE);
  });

  test('Une fois les gains versés, le litige est refusé', async () => {
    const res = await call(joiner, 'POST', `${BASE}/matches/${matchId}/disputes`, {
      category: 'result',
      reason: ' Trop tard',
      evidence: 'https://example.com/capture.png',
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MATCH_CLOSED');
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
    // S4 (audit-2) : l'identite du demandeur ne sort jamais — ni l'UUID
    // (`requestedBy`), ni le pseudo (`openedByPseudo`, state-helpers.mjs:242) ;
    // les pieces jointes ne sortent que pour les habilites (le createur l'est).
    expect(res.body.match.disputes[0].requestedBy).toBeUndefined();
    expect(res.body.match.disputes[0].openedByPseudo).toBeUndefined();
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

/**
 * Sortie volontaire (-- /leave /) et annulation volontaire du createur (-- /cancel /).
 *
 * Le contrat financier : TANT QUE le match n est pas lance, chaque verrou de
 * mise se rouvre SUR DEMANDE — le joueur seul (/leave) ou le createur tant
 * que personne d autre s est joint (/cancel). Une fois lance, les mises
 * jouent : la route se ferme.
 */
test.describe('Sortie volontaire et annulation du createur', () => {
  test.describe.configure({ mode: 'serial' });

  let owner: Actor;      // createur des matches de sacrifice
  let guest: Actor;      // le second joueur de M2
  let stranger: Actor;   // un exterieur inscrit sans aucun lien aux matchs
  let launchedOwner: Actor;
  let launchedGuest: Actor;
  let launchedArbiter: Actor;
  let mSolo = '';
  let mWithOpponent = '';
  let mIntact = '';
  let mLaunched = '';
  const SOLO_FEE = 50;
  const LAUNCH_FEE = 60;

  test.beforeAll(async () => {
    owner = await registerPlayer('E2EASO');
    guest = await registerPlayer('E2EASO2');
    stranger = await registerPlayer('E2EASO3');
    launchedOwner = await registerPlayer('E2EALO');
    launchedGuest = await registerPlayer('E2EALO2');
    launchedArbiter = await registerPlayer('E2EALO3');
    const admin = await openAdminSession();
    for (const player of [owner, guest, launchedOwner, launchedGuest]) {
      await creditWallet(admin, player.id, START_BALANCE);
    }
  });

  test.afterAll(async () => {
    await disposeActors();
  });

  test('POST /api/matches/:id/leave et .../cancel — 401 sans session', async () => {
    const leave = await callAnonymous('POST', `${BASE}/matches/M-FAKE/leave`);
    expect(leave.status).toBe(401);
    expect(leave.body.code).toBe('AUTH_REQUIRED');

    const cancel = await callAnonymous('POST', `${BASE}/matches/M-FAKE/cancel`);
    expect(cancel.status).toBe(401);
    expect(cancel.body.code).toBe('AUTH_REQUIRED');
  });

  test('cancel du createur sur son match personne — remboursement integral, match clos', async () => {
    const created = await call(owner, 'POST', `${BASE}/matches`, {
      format: MATCH_FORMAT,
      entryFee: SOLO_FEE,
      rules: MATCH_RULES,
      visibility: 'public',
    });
    expect(created.status).toBe(201);
    mSolo = created.body.match.id;
    // Le createur se reconnait SANS que l UUID interne ne sorte (S4).
    expect(created.body.match.isCreator).toBe(true);
    expect(created.body.match.creatorId).toBeUndefined();
    expect(created.body.wallet.lockedBalance).toBe(SOLO_FEE);

    const res = await call(owner, 'POST', `${BASE}/matches/${mSolo}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.match.status).toBe('cancelled');
    expect(res.body.match.cancellationReason).toBe('CANCELLED_BY_CREATOR');
    // La mise est redevenue de l argent liquide disponible.
    expect(res.body.wallet.lockedBalance).toBe(0);
    expect(res.body.wallet.cashBalance).toBe(START_BALANCE);
  });

  test('cancel refuse des qu un adversaire pose un pass; leave recupere sa place; createur finit par annuler', async () => {
    const created = await call(owner, 'POST', `${BASE}/matches`, { format: MATCH_FORMAT, entryFee: ENTRY_FEE, rules: MATCH_RULES, visibility: 'public' });
    expect(created.status).toBe(201);
    mWithOpponent = created.body.match.id;

    const joined = await call(guest, 'POST', `${BASE}/matches/${mWithOpponent}/join`, { team: 1 });
    expect(joined.status).toBe(200);
    expect(joined.body.wallet.lockedBalance).toBe(ENTRY_FEE);

    // Des qu un autre joueur a pose son pass, l annulation se ferme —
    // et le match reste vivant, personne n est paye.
    const refused = await call(owner, 'POST', `${BASE}/matches/${mWithOpponent}/cancel`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('OPPONENTS_PRESENT');
    expect(refused.body.match).toBeUndefined();
    const walletAfterRefusal = await call(owner, 'GET', `${BASE}/wallet/me`);
    expect(walletAfterRefusal.body.wallet.lockedBalance).toBe(ENTRY_FEE);

    // L'invite peut INVERSEMENT partir : son pass revient entier, la place
    // se rouvre, le statut redescend.
    const left = await call(guest, 'POST', `${BASE}/matches/${mWithOpponent}/leave`);
    expect(left.status).toBe(200);
    expect(left.body.match.status).toBe('recruiting');
    expect(left.body.match.players).toHaveLength(1);
    // Le roster ne contient plus que le createur : pour le partant qui
    // lit la reponse, `isMe` est faux (son userId a disparu du roster).
    expect(left.body.match.players[0].isMe).toBe(false);
    expect(left.body.match.creatorPseudo).toBe(owner.pseudo);
    expect(left.body.wallet.lockedBalance).toBe(0);
    expect(left.body.wallet.cashBalance).toBe(START_BALANCE);

    // Le createur, lui, ne quitte PAS son propre match : l annulation est
    // sa porte de sortie.
    const ownerLeave = await call(owner, 'POST', `${BASE}/matches/${mWithOpponent}/leave`);
    expect(ownerLeave.status).toBe(409);
    expect(ownerLeave.body.code).toBe('CREATOR_CANNOT_LEAVE');

    const ownerCancel = await call(owner, 'POST', `${BASE}/matches/${mWithOpponent}/cancel`);
    expect(ownerCancel.status).toBe(200);
    expect(ownerCancel.body.match.status).toBe('cancelled');
    expect(ownerCancel.body.match.cancellationReason).toBe('CANCELLED_BY_CREATOR');
  });

  test('un tiers inscrit ne peut ni sortir (NOT_IN_MATCH) ni annuler (FORBIDDEN)', async () => {
    const created = await call(owner, 'POST', `${BASE}/matches`, { format: MATCH_FORMAT, entryFee: ENTRY_FEE, rules: MATCH_RULES, visibility: 'public' });
    expect(created.status).toBe(201);
    mIntact = created.body.match.id;

    const leave = await call(stranger, 'POST', `${BASE}/matches/${mIntact}/leave`);
    expect(leave.status).toBe(409);
    expect(leave.body.code).toBe('NOT_IN_MATCH');

    const cancel = await call(stranger, 'POST', `${BASE}/matches/${mIntact}/cancel`);
    expect(cancel.status).toBe(403);
    expect(cancel.body.code).toBe('FORBIDDEN');
  });

  test('MATCH_LAUNCHED : une fois lance, la sortie reste fermee — les mises jouent', async () => {
    const created = await call(launchedOwner, 'POST', `${BASE}/matches`, { format: MATCH_FORMAT, entryFee: LAUNCH_FEE, rules: MATCH_RULES, visibility: 'public' });
    expect(created.status).toBe(201);
    mLaunched = created.body.match.id;

    const joined = await call(launchedGuest, 'POST', `${BASE}/matches/${mLaunched}/join`, { team: 1 });
    expect(joined.status).toBe(200);
    const assigned = await call(launchedArbiter, 'POST', `${BASE}/matches/${mLaunched}/arbiter`);
    expect(assigned.status).toBe(200);
    const checkOwner = await call(launchedOwner, 'POST', `${BASE}/matches/${mLaunched}/check-in`, {});
    expect(checkOwner.status).toBe(200);
    const checkGuest = await call(launchedGuest, 'POST', `${BASE}/matches/${mLaunched}/check-in`, {});
    expect(checkGuest.status).toBe(200);
    const readyOwner = await call(launchedOwner, 'POST', `${BASE}/matches/${mLaunched}/ready`, {});
    expect(readyOwner.status).toBe(200);
    const readyGuest = await call(launchedGuest, 'POST', `${BASE}/matches/${mLaunched}/ready`, {});
    expect(readyGuest.status).toBe(200);
    const scheduled = await call(launchedArbiter, 'POST', `${BASE}/matches/${mLaunched}/schedule`, { scheduledAt: new Date(Date.now() + 3 * 60 * 1000).toISOString() });
    expect(scheduled.status).toBe(200);
    const room = await call(launchedArbiter, 'POST', `${BASE}/matches/${mLaunched}/room`, { roomName: 'SALLE E2E SORTIE', roomPassword: 'zz' });
    expect(room.status).toBe(200);
    const launched = await call(launchedArbiter, 'POST', `${BASE}/matches/${mLaunched}/launch`, {});
    expect(launched.status).toBe(200);
    expect(launched.body.match.status).toBe('in_progress');

    const refusedGuest = await call(launchedGuest, 'POST', `${BASE}/matches/${mLaunched}/leave`);
    expect(refusedGuest.status).toBe(409);
    expect(refusedGuest.body.code).toBe('MATCH_LAUNCHED');

    // Meme ferme pour /cancel : un adversaire est engage sur ce match
    // (OPPONENTS_PRESENT).
    const refusedOwner = await call(launchedOwner, 'POST', `${BASE}/matches/${mLaunched}/cancel`);
    expect(refusedOwner.status).toBe(409);
    expect(refusedOwner.body.code).toBe('OPPONENTS_PRESENT');

    // Les deux passes restent verrouilles.
    const walletOwner = await call(launchedOwner, 'GET', `${BASE}/wallet/me`);
    expect(walletOwner.body.wallet.lockedBalance).toBe(LAUNCH_FEE);
    const walletGuest = await call(launchedGuest, 'GET', `${BASE}/wallet/me`);
    expect(walletGuest.body.wallet.lockedBalance).toBe(LAUNCH_FEE);
  });
});
