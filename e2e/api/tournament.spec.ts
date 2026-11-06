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

// Contrat reel releve dans server/routes/tournament.mjs + tournament-engine.mjs
// (squads libres, 2026-11-05) :
//   POST /api/tournaments                       201; format ^(\d+)VS(\d+)$ (1..5
//                                               symetrique), entryFee > 0 requis;
//                                               `reserveCreatorAsArbiter` reserve
//                                               le slot 1 au createur.
//   POST /api/tournaments/:id/register          200 (401 anonyme). Le capitaine
//                                               pose SEUL SON pass : le
//                                               portefeuille verrouille entryFee
//                                               (JAMAIS entryFee x teamSize) et
//                                               la squad nait incomplete, OUVERTE
//                                               ou PRIVEE (liste d'invites, au
//                                               moins un pseudo).
//   POST /api/tournaments/:id/join/:entryId     200; le coequipier verrouille
//                                               LUI-MEME son pass sur SON
//                                               portefeuille. 404 SQUAD_NOT_FOUND,
//                                               409 SQUAD_FULL, 403 FORBIDDEN
//                                               (squad privee sans invitation).
//   POST /api/tournaments/:id/start             arbitre (ou admin) seuls; les
//                                               squads incompletes sont balayees
//                                               MAIS le balayage porte seulement
//                                               si les squads completes couvrent
//                                               minEntries (400 MATCH_NOT_READY
//                                               sans mutation sinon).
//   POST /api/tournaments/:id/matches/:mId/result  arbitre du poste; cagnotte
//                                               reversee en parts EGALES dans
//                                               chaque membre du podium, passe
//                                               consomme pour les perdants,
//                                               commission d'arbitre de 5% (<= 8
//                                               entrees) credit au reglement.
const BASE = '/api';
const ENTRY_FEE = 100;
const MAX_ENTRIES = 2; // 2 squads de 2 -> 4 joueurs, bracket = 1 finale.
const START_BALANCE = 1_000;
// Payouts (buildPayout) : cagnotte = 100 x 2 squads x 2 joueurs = 400 ZC ;
// commission arbitre 5 % (1 slot) = 20 ; pool joueurs = 380 ; podium 50/30 :
// premier = 190, second = 114, troisieme = 76 (jamais attribue a 2 squads).
const ARBITER_SHARE = 20;
const WINNER_POT = 190;
const RUNNER_UP_POT = 114;
const WINNER_SHARE = WINNER_POT / 2; // 95 ZC PAR MEMBRE (gagnant)
const RUNNER_UP_SHARE = RUNNER_UP_POT / 2; // 57 ZC PAR MEMBRE (finaliste battu)

const TOURNAMENT_RULES = {
  mode: 'S&D',
  mapPool: ['Raid', 'Standoff'],
  scoreTarget: 7,
  bestOf: 1,
};

test.describe('Tournament squads libres', () => {
  // L'ordre compte : tournoi, registrations, joins, lancement, resultats et
  // soldes se lisent d'un test a l'autre.
  test.describe.configure({ mode: 'serial' });

  let arbiter: Actor; // createur du tournoi, arbitre du slot 1
  let capA: Actor;
  let joinerB: Actor;
  let capC: Actor;
  let joinerD: Actor;
  let outsider: Actor; // essaye les joins sans jamais debloquer de fonds
  let tournamentId = '';
  let entryAId = '';
  let entryCId = '';
  let matchId = '';

  const readWallet = async (actor: Actor) => {
    const res = await call<{ wallet: { cashBalance: number; lockedBalance: number; lockedEntries: Record<string, { amount: number }> } }>(
      actor,
      'GET',
      `${BASE}/wallet/me`,
    );
    expect(res.status).toBe(200);
    return res.body.wallet;
  };

  const findEntry = (body: any, entryId: string) =>
    body?.tournament?.entries?.find((entry: any) => entry.id === entryId);

  test.beforeAll(async () => {
    arbiter = await registerPlayer('E2ETA');
    capA = await registerPlayer('E2ETB');
    capC = await registerPlayer('E2ETC');
    joinerB = await registerPlayer('E2ETD');
    joinerD = await registerPlayer('E2ETE');
    outsider = await registerPlayer('E2ETF');
    const admin = await openAdminSession();
    // Seuls les PARTICIPANTS paient un pass ; l'arbitre est remunere sur la
    // cagnotte au reglement.
    for (const player of [capA, joinerB, capC, joinerD]) {
      await creditWallet(admin, player.id, START_BALANCE);
    }
  });

  test.afterAll(async () => {
    await disposeActors();
  });

  test('register sans session — 401', async () => {
    const res = await callAnonymous('POST', `${BASE}/tournaments/fake/register`, { pseudo: 'X' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  test('creation 2VS2 — 201, arbitre reserveur, minEntries a 2 squads', async () => {
    const res = await call(arbiter, 'POST', `${BASE}/tournaments`, {
      name: 'E2E Squads libres',
      format: '2VS2',
      entryFee: ENTRY_FEE,
      maxEntries: MAX_ENTRIES,
      rules: TOURNAMENT_RULES,
      reserveCreatorAsArbiter: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    const tournament = res.body.tournament;
    tournamentId = tournament.id;
    expect(tournamentId).toMatch(/^T-MJ-/);
    expect(tournament.teamSize).toBe(2);
    expect(tournament.minEntries).toBe(2);
    expect(tournament.entryFee).toBe(ENTRY_FEE);
    expect(tournament.status).toBe('recruiting');
    // Le createur est arbitre : son slot est visible SUR SA PROPRE reponse.
    expect(res.body.myArbiterSlot).toBe(1);
    expect(res.body.myEntryId).toBeNull();
    // A la creation, aucune squad : la cagnotte affichee est a recruits nuls.
    expect(tournament.entries).toHaveLength(0);
  });

  test('inscription au pseudo d un autre — 400', async () => {
    const res = await call(capA, 'POST', `${BASE}/tournaments/${tournamentId}/register`, {
      pseudo: 'PasMonPseudo',
      squadName: 'Ghost Squad',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REGISTRATION');
  });

  test('squad PRIVEE sans aucun pseudo invite — 400', async () => {
    const res = await call(capC, 'POST', `${BASE}/tournaments/${tournamentId}/register`, {
      pseudo: capC.pseudo,
      squadName: 'Closes C',
      access: 'private',
      invitedPseudos: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REGISTRATION');
  });

  test('capitaine OUVERT : SON SEUL pass est verrouille (900 / 100), squad naissance 1/2', async () => {
    const res = await call(capA, 'POST', `${BASE}/tournaments/${tournamentId}/register`, {
      pseudo: capA.pseudo,
      squadName: 'Alpha Squad',
      access: 'open',
    });

    expect(res.status).toBe(200);
    entryAId = res.body.myEntryId;
    expect(entryAId).toBeTruthy();
    const entry = findEntry(res.body, entryAId);
    // LA nuance de la bascule : la squad nait incomplete (1 membre), OUVERTE,
    // sans liste d'invites.
    expect(entry.access).toBe('open');
    expect(entry.members).toHaveLength(1);
    expect(entry.members[0].pseudo).toBe(capA.pseudo);
    expect(entry.members[0].isCaptain).toBe(true);
    expect(entry.members[0].isMe).toBe(true);
    expect(entry.invitedPseudos).toHaveLength(0);
    // Le pass individuel : entryFee pose sur le portefeuille du CAPITAINE
    // uniquement — jamais entryFee x teamSize.
    expect(res.body.wallet.cashBalance).toBe(START_BALANCE - ENTRY_FEE);
    expect(res.body.wallet.lockedBalance).toBe(ENTRY_FEE);
    expect(res.body.wallet.lockedEntries[tournamentId].amount).toBe(ENTRY_FEE);
  });

  test('coequipier OUVERT : il verrouille SON PROPRE pass (900 / 100), squad 2/2', async () => {
    const res = await call(joinerB, 'POST', `${BASE}/tournaments/${tournamentId}/join/${entryAId}`);
    expect(res.status).toBe(200);
    expect(res.body.myEntryId).toBe(entryAId);
    const entry = findEntry(res.body, entryAId);
    expect(entry.members).toHaveLength(2);
    expect(entry.members.some((member: any) => member.pseudo === joinerB.pseudo && member.isMe)).toBe(true);
    // Le contrat join : les fonds du coequipier partent de SON portefeuille.
    expect(res.body.wallet.cashBalance).toBe(START_BALANCE - ENTRY_FEE);
    expect(res.body.wallet.lockedBalance).toBe(ENTRY_FEE);
    expect(res.body.wallet.lockedEntries[tournamentId].amount).toBe(ENTRY_FEE);
  });

  test('squad inconnue — 404 SQUAD_NOT_FOUND', async () => {
    const res = await call(outsider, 'POST', `${BASE}/tournaments/${tournamentId}/join/ENTRY-INEXISTANT`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('SQUAD_NOT_FOUND');
  });

  test('squad deja complete — 409 SQUAD_FULL', async () => {
    const res = await call(outsider, 'POST', `${BASE}/tournaments/${tournamentId}/join/${entryAId}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SQUAD_FULL');
  });

  test('lancement par un joueur (non arbitre) — 403', async () => {
    const res = await call(capA, 'POST', `${BASE}/tournaments/${tournamentId}/start`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('lancement premature: 1 squad complete < minEntries — 400 SANS mutation', async () => {
    // Garde AMONT : le refus precede tout balayage (aucun refund), donc les
    // portefeuilles sont figes — l'argent verrouille reste verrouille.
    const res = await call(arbiter, 'POST', `${BASE}/tournaments/${tournamentId}/start`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MATCH_NOT_READY');
    const walletA = await readWallet(capA);
    expect(walletA.cashBalance).toBe(START_BALANCE - ENTRY_FEE);
    expect(walletA.lockedBalance).toBe(ENTRY_FEE);
  });

  test('capitaine PRIVE : pass individuel, invitations stockees, AUCUN membre fantome', async () => {
    const res = await call(capC, 'POST', `${BASE}/tournaments/${tournamentId}/register`, {
      pseudo: capC.pseudo,
      squadName: 'Charlie Private',
      access: 'private',
      invitedPseudos: [joinerD.pseudo, 'amis_de_plus'],
    });

    expect(res.status).toBe(200);
    entryCId = res.body.myEntryId;
    const entry = findEntry(res.body, entryCId);
    expect(entry.access).toBe('private');
    // La liste d'invites est STOCKEE (normalisee) mais ne nest PAS des membres.
    expect(entry.invitedPseudos).toHaveLength(2);
    expect(entry.invitedPseudos).toContain(joinerD.pseudo);
    expect(entry.members).toHaveLength(1);
    expect(res.body.wallet.cashBalance).toBe(START_BALANCE - ENTRY_FEE);
    expect(res.body.wallet.lockedBalance).toBe(ENTRY_FEE);
  });

  test('join d une squad PRIVEE sans invitation — 403 FORBIDDEN', async () => {
    const res = await call(outsider, 'POST', `${BASE}/tournaments/${tournamentId}/join/${entryCId}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('invite (et seul lui) complete la squad PRIVEE — 200, pass individuel', async () => {
    const res = await call(joinerD, 'POST', `${BASE}/tournaments/${tournamentId}/join/${entryCId}`);
    expect(res.status).toBe(200);
    const entry = findEntry(res.body, entryCId);
    expect(entry.members).toHaveLength(2);
    const solo = entry.members.find((member: any) => member.isMe);
    expect(solo?.pseudo).toBe(joinerD.pseudo);
    expect(res.body.wallet.cashBalance).toBe(START_BALANCE - ENTRY_FEE);
    expect(res.body.wallet.lockedBalance).toBe(ENTRY_FEE);
  });

  test('lancement par l arbitre — 200, bracket live', async () => {
    const res = await call(arbiter, 'POST', `${BASE}/tournaments/${tournamentId}/start`);
    expect(res.status).toBe(200);
    expect(res.body.tournament.status).toBe('live');
    expect(res.body.tournament.entries).toHaveLength(2);
    // 2 squads -> 1 finale uniquement.
    expect(res.body.tournament.matches).toHaveLength(1);
    matchId = res.body.tournament.matches[0].id;
    expect(res.body.tournament.matches[0].bracketType).toBe('main');
    expect(res.body.tournament.matches[0].entryAId).toBeTruthy();
    expect(res.body.tournament.matches[0].entryBId).toBeTruthy();
  });

  test('resultat egal — 400', async () => {
    const res = await call(arbiter, 'POST', `${BASE}/tournaments/${tournamentId}/matches/${matchId}/result`, {
      winnerEntryId: entryAId,
      scoreA: 7,
      scoreB: 7,
      notes: 'Position a 7 partout.',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REGISTRATION');
  });

  test('resultat avec un vainqueur inexistant — 400', async () => {
    const res = await call(arbiter, 'POST', `${BASE}/tournaments/${tournamentId}/matches/${matchId}/result`, {
      winnerEntryId: 'ENTRY-INEXISTANT',
      scoreA: 7,
      scoreB: 0,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REGISTRATION');
  });

  test('finale arbitree — settlement en parts EGALES PAR MEMBRE', async () => {
    const res = await call(arbiter, 'POST', `${BASE}/tournaments/${tournamentId}/matches/${matchId}/result`, {
      winnerEntryId: entryAId,
      scoreA: 7,
      scoreB: 3,
      notes: 'Alpha Squad gagne la finale.',
    });

    expect(res.status).toBe(200);
    expect(findEntry(res.body, entryAId)?.finalPlacement).toBe(1);
    expect(findEntry(res.body, entryCId)?.finalPlacement).toBe(2);
    expect(res.body.tournament.status).toBe('completed');

    // Le contrat du partionnement : chaque gagnant recoit WINNER_POT / 2,
    // CREDITE DIRECTEMENT sur son propre portefeuille ; le pass consomme
    // libere la reservation. PASS INDIVIDUEL : 1000 - 100 + 95 = 995 chez les
    // gagnants, 1000 - 100 + 57 = 957 chez les finalistes.
    for (const winner of [capA, joinerB]) {
      const wallet = await readWallet(winner);
      expect(wallet.cashBalance).toBe(START_BALANCE - ENTRY_FEE + WINNER_SHARE);
      expect(wallet.lockedBalance).toBe(0);
      expect(wallet.lockedEntries).toEqual({});
    }
    for (const runnerUp of [capC, joinerD]) {
      const wallet = await readWallet(runnerUp);
      expect(wallet.cashBalance).toBe(START_BALANCE - ENTRY_FEE + RUNNER_UP_SHARE);
      expect(wallet.lockedBalance).toBe(0);
      expect(wallet.lockedEntries).toEqual({});
    }
    // Commission d'arbitre : 5 % de la cagnotte, creditee au reglement.
    const arbiterWallet = await readWallet(arbiter);
    expect(arbiterWallet.cashBalance).toBe(ARBITER_SHARE);
  });

  test('resultat rejoue — 409 MATCH_CLOSED', async () => {
    const res = await call(arbiter, 'POST', `${BASE}/tournaments/${tournamentId}/matches/${matchId}/result`, {
      winnerEntryId: entryAId,
      scoreA: 7,
      scoreB: 0,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MATCH_CLOSED');
  });

  test('detail public en fin de tournoi — output sane', async () => {
    const res = await callAnonymous('GET', `${BASE}/tournaments/${tournamentId}`);
    expect(res.status).toBe(200);
    expect(res.body.tournament.status).toBe('completed');
    // Les mappes internes ne fuient jamais : ni captainId, ni userId.
    const raw = JSON.stringify(res.body.tournament);
    expect(raw).not.toContain('"captainId"');
    expect(raw).not.toContain('"userId"');
  });
});
