import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Les gardes 2FA des routes de resultat (audit-2 S1/S2/S3).
 *
 * Le threat model de la 2FA : le mot de passe admin est compromis (phishing,
 * XSS, poste partage), pas le TOTP. Toute route qui ecrit un resultat payant
 * doit donc couter le meme code TOTP que /api/admin/* - sinon le chemin
 * joueur est toujours le plus court.
 *
 * Trois familles de gardes :
 *   - `require2faIfAdmin` (admin-totp.mjs) sur les routes MIXTES : un joueur
 *     arbitre passe sans code, une session admin doit avoir une 2FA fraiche
 *     (POST /api/matches/:id/result, POST /api/matches/:id/arbiter, POST
 *     /api/tournaments/:id/matches/:mid/result).
 *   - `requireAdmin2fa` sur la chaine admin de la ligue (days/:day/results,
 *     advance-to-final, final-results) : le moteur exige deja le role admin,
 *     la route exige la 2FA, comme sur refund/payments.
 *
 * Les moteurs sont simules : on ne teste pas le reglement ici, on verifie
 * QUI peut aller jusqu'au moteur.
 *
 * Harnais : persistence REELLE (createAuthSession, markAdmin2faVerified),
 * supabase simule, collections simulees via state-helpers.
 */


vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => {
      const q = {};
      q.select = vi.fn(() => q);
      q.upsert = vi.fn(() => Promise.resolve({ error: null }));
      q.delete = vi.fn(() => q);
      q.eq = vi.fn(() => Promise.resolve({ data: [], error: null }));
      q.in = vi.fn(() => Promise.resolve({ data: [], error: null }));
      return q;
    }),
  },
}));

vi.mock('./state-helpers.mjs', () => ({
  saveMatches: vi.fn(async () => {}),
  saveLeagues: vi.fn(async () => {}),
  saveTournaments: vi.fn(async () => {}),
  getStoredLeagues: vi.fn(() => []),
  getStoredTournaments: vi.fn(() => []),
  buildMatchActionPayload: vi.fn((match) => ({ ok: true, id: match?.id })),
  buildLeagueActionPayload: vi.fn((season) => ({ ok: true, id: season?.id })),
  buildTournamentActionPayload: vi.fn((t) => ({ ok: true, id: t?.id })),
  sanitizeTournamentForBroadcast: vi.fn((t) => t),
}));

vi.mock('./push-notifications.mjs', () => ({
  deliverNotification: vi.fn(async () => {}),
  notifyAllAdmins: vi.fn(async () => {}),
}));

vi.mock('./wallet-engine.mjs', () => ({
  refundLockedEntry: vi.fn(),
}));

vi.mock('./match-engine.mjs', () => ({
  createMatchOnServer: vi.fn(),
  joinMatchOnServer: vi.fn(),
  assignArbiterOnServer: vi.fn(async () => ({ matches: [], match: { id: 'M-GARDE' } })),
  checkInMatchOnServer: vi.fn(),
  toggleReadyOnServer: vi.fn(),
  scheduleMatchOnServer: vi.fn(),
  setRoomDetailsOnServer: vi.fn(),
  launchMatchOnServer: vi.fn(),
  submitMatchResultOnServer: vi.fn(async () => ({ matches: [], match: { id: 'M-GARDE' } })),
  confirmMatchResultOnServer: vi.fn(),
  openDisputeOnServer: vi.fn(),
  addEvidenceToDisputeOnServer: vi.fn(),
  escalateDisputeOnServer: vi.fn(),
}));

vi.mock('./league-engine.mjs', () => ({
  createLeagueSeasonOnServer: vi.fn(),
  startLeagueQualificationOnServer: vi.fn(),
  startLeagueDayOnServer: vi.fn(),
  submitLeagueDayResultsOnServer: vi.fn(async () => ({
    seasons: [], season: { id: 'LS-GARDE' },
  })),
  advanceToFinalOnServer: vi.fn(async () => ({
    seasons: [], season: { id: 'LS-GARDE' },
  })),
  submitLeagueFinalResultsOnServer: vi.fn(async () => ({
    seasons: [], season: { id: 'LS-GARDE' },
  })),
  getLeagueLeaderboard: vi.fn(),
  updateLeagueSettingsOnServer: vi.fn(),
  joinLeagueSeasonOnServer: vi.fn(),
  leaveLeagueSeasonOnServer: vi.fn(),
  reassignPlayerOnServer: vi.fn(),
  refundLeaguePlayerOnServer: vi.fn(),
  getLeaguePayments: vi.fn(),
}));

vi.mock('./tournament-engine.mjs', () => ({
  createTournamentOnServer: vi.fn(),
  registerForTournamentOnServer: vi.fn(),
  leaveTournamentOnServer: vi.fn(),
  assignTournamentArbiterOnServer: vi.fn(),
  startTournamentOnServer: vi.fn(),
  setTournamentMatchRoomDetailsOnServer: vi.fn(),
  setTournamentMatchLiveOnServer: vi.fn(),
  submitTournamentMatchResultOnServer: vi.fn(async () => ({
    tournaments: [], tournament: { id: 'TO-GARDE' },
  })),
}));

import { saveMatches, saveLeagues, saveTournaments } from './state-helpers.mjs';
import {
  assignArbiterOnServer,
  submitMatchResultOnServer,
} from './match-engine.mjs';
import {
  submitLeagueDayResultsOnServer,
  advanceToFinalOnServer,
  submitLeagueFinalResultsOnServer,
} from './league-engine.mjs';
import { submitTournamentMatchResultOnServer } from './tournament-engine.mjs';
import {
  createUserAccount,
  updateUserAccount,
  createAuthSession,
  markAdmin2faVerified,
} from './persistence.mjs';
import { adminTotpSecrets } from './admin-totp.mjs';
import { handleMatchRoutes } from './routes/match.mjs';
import { handleLeagueRoutes } from './routes/league.mjs';
import { handleTournamentRoutes } from './routes/tournament.mjs';

const settle = () => new Promise((r) => setTimeout(r, 10));

// Comptes : un admin sans 2FA est le threat model teste ; le joueur ordinaire
// prouve que le garde ne bloque PAS le chemin arbitre.


let compteur = 0;
const nouveauCompte = async (role = 'player') => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const compte = await createUserAccount({
    pseudo: `Garde${compteur}${stamp}`.slice(0, 26),
    email: `garde-${compteur}-${stamp}@test.local`,
    phone: `+2250701${String(Date.now() % 100000).padStart(6, '0')}`,
    gameId: `CO-GARDE-${compteur}-${stamp}`,
    password: 'MotDePasseSolide2026!',
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  if (role === 'admin') {
    // Le role doit etre eleve AVANT la creation de session : le user embarque
    // dans la session est un instantane.
    await updateUserAccount(compte.id, (u) => ({ ...u, role: 'admin' }));
    await settle();
  }
  const session = await createAuthSession(compte.id);
  return { compte, token: session.token, id: compte.id };
};

const resFactice = () => ({
  statusCode: 200, headersSent: false, ended: false,
  setHeader() {}, getHeader() { return undefined; },
  writeHead(code) { this.statusCode = code; this.headersSent = true; },
  end() { this.ended = true; },
  json() { this.ended = true; },
});

// `parseRequestBody` itere sur la requete comme sur un flux (cf.
// withdrawal-double-payout.test.mjs) : la req factice doit donc etre
// ITERABLE et produire le corps JSON des routes qui le lient.
const reqPour = (token, url, body = null, method = 'POST') => ({
  method, url,
  socket: { remoteAddress: '10.7.7.7' },
  headers: { authorization: token ? `Bearer ${token}` : undefined },
  async *[Symbol.asyncIterator]() {
    if (body) {
      yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    }
  },
  on() {}, removeListener() {}, destroy() {},
});

// La route complete : session (2FA si admin) -> moteur simule -> reponse 200.


const activer2fa = (id) => {
  adminTotpSecrets.set(id, { secret: 'JBSWY3DPEHPK3PXP', enabled: true, verifiedAt: Date.now() });
};

// Verifie que la reponse est un 403 2FA_REQUIRED et que le moteur n'a PAS
// ete appele derriere le garde.


const expectGarde2fa = (res) => {
  expect(res.statusCode).toBe(403);
};

beforeEach(() => {
  vi.clearAllMocks();
  adminTotpSecrets.clear();
});

describe('S1 : POST /api/matches/:id/result (route mixte arbitre/admin)', () => {
  it('une session admin sans 2FA ne peut pas soumettre de resultat', async () => {
    const { token } = await nouveauCompte('admin');
    const res = resFactice();
    await handleMatchRoutes({
      req: reqPour(token, '/api/matches/M-GARDE/result', { winnerTeam: 0 }), res, pathname: '/api/matches/M-GARDE/result', io: null,
    });
    expectGarde2fa(res);
    expect(submitMatchResultOnServer).not.toHaveBeenCalled();
  });

  it('un arbitre ordinaire soumet toujours son resultat sans TOTP', async () => {
    const { token } = await nouveauCompte('player');
    const res = resFactice();
    await handleMatchRoutes({
      req: reqPour(token, '/api/matches/M-GARDE/result', { winnerTeam: 0 }), res, pathname: '/api/matches/M-GARDE/result', io: null,
    });
    expect(res.statusCode).toBe(200);
    expect(submitMatchResultOnServer).toHaveBeenCalledTimes(1);
    expect(saveMatches).toHaveBeenCalled();
  });

  it('un admin avec 2FA activee mais pas verifiee est bloque aussi', async () => {
    const { token, id } = await nouveauCompte('admin');
    activer2fa(id);
    const res = resFactice();
    await handleMatchRoutes({
      req: reqPour(token, '/api/matches/M-GARDE/result', { winnerTeam: 0 }), res, pathname: '/api/matches/M-GARDE/result', io: null,
    });
    expectGarde2fa(res);
    expect(submitMatchResultOnServer).not.toHaveBeenCalled();
  });

  it('une session admin 2FA-fraiche soumet son resultat par le chemin normal', async () => {
    const { token, id } = await nouveauCompte('admin');
    activer2fa(id);
    expect(markAdmin2faVerified(token)).toBe(true);
    const res = resFactice();
    await handleMatchRoutes({
      req: reqPour(token, '/api/matches/M-GARDE/result', { winnerTeam: 0 }), res, pathname: '/api/matches/M-GARDE/result', io: null,
    });
    expect(res.statusCode).toBe(200);
    expect(submitMatchResultOnServer).toHaveBeenCalledTimes(1);
  });
});

describe('S1 : POST /api/matches/:id/arbiter', () => {
  it('un admin sans 2FA ne peut pas prendre la place d arbitre', async () => {
    const { token } = await nouveauCompte('admin');
    const res = resFactice();
    await handleMatchRoutes({
      req: reqPour(token, '/api/matches/M-GARDE/arbiter', {}), res, pathname: '/api/matches/M-GARDE/arbiter', io: null,
    });
    expectGarde2fa(res);
    expect(assignArbiterOnServer).not.toHaveBeenCalled();
  });

  it('un joueur ordinaire peut toujours prendre une place libre', async () => {
    const { token } = await nouveauCompte('player');
    const res = resFactice();
    await handleMatchRoutes({
      req: reqPour(token, '/api/matches/M-GARDE/arbiter', {}), res, pathname: '/api/matches/M-GARDE/arbiter', io: null,
    });
    expect(res.statusCode).toBe(200);
    expect(assignArbiterOnServer).toHaveBeenCalledTimes(1);
  });

  it('un admin 2FA-fraiche peut toujours arbitrer', async () => {
    const { token, id } = await nouveauCompte('admin');
    activer2fa(id);
    expect(markAdmin2faVerified(token)).toBe(true);
    const res = resFactice();
    await handleMatchRoutes({
      req: reqPour(token, '/api/matches/M-GARDE/arbiter', {}), res, pathname: '/api/matches/M-GARDE/arbiter', io: null,
    });
    expect(res.statusCode).toBe(200);
    expect(assignArbiterOnServer).toHaveBeenCalledTimes(1);
  });
});

describe('S2 : chaine admin de ligue (results -> advance-to-final -> final-results)', () => {
  it('POST /api/leagues/:id/days/:day/results exige la 2FA admin', async () => {
    const { token } = await nouveauCompte('admin');
    const res = resFactice();
    await handleLeagueRoutes({
      req: reqPour(token, '/api/leagues/LS-GARDE/days/D1/results', { results: [] }), res, pathname: '/api/leagues/LS-GARDE/days/D1/results', io: null,
    });
    expectGarde2fa(res);
    expect(submitLeagueDayResultsOnServer).not.toHaveBeenCalled();
  });

  it('la meme route accepte un admin 2FA-fraiche et passe jusqu au moteur', async () => {
    const { token, id } = await nouveauCompte('admin');
    activer2fa(id);
    expect(markAdmin2faVerified(token)).toBe(true);
    const res = resFactice();
    await handleLeagueRoutes({
      req: reqPour(token, '/api/leagues/LS-GARDE/days/D1/results', { results: [] }), res, pathname: '/api/leagues/LS-GARDE/days/D1/results', io: null,
    });
    expect(res.statusCode).toBe(200);
    expect(submitLeagueDayResultsOnServer).toHaveBeenCalledTimes(1);
    expect(saveLeagues).toHaveBeenCalled();
  });

  it('POST /api/leagues/:id/advance-to-final exige la 2FA admin', async () => {
    const { token } = await nouveauCompte('admin');
    const res = resFactice();
    await handleLeagueRoutes({
      req: reqPour(token, '/api/leagues/LS-GARDE/advance-to-final', {}), res, pathname: '/api/leagues/LS-GARDE/advance-to-final', io: null,
    });
    expectGarde2fa(res);
    expect(advanceToFinalOnServer).not.toHaveBeenCalled();
  });

  it('POST /api/leagues/:id/final-results exige la 2FA admin (verse la cagnotte)', async () => {
    const { token } = await nouveauCompte('admin');
    const res = resFactice();
    await handleLeagueRoutes({
      req: reqPour(token, '/api/leagues/LS-GARDE/final-results', { results: [] }), res, pathname: '/api/leagues/LS-GARDE/final-results', io: null,
    });
    expectGarde2fa(res);
    expect(submitLeagueFinalResultsOnServer).not.toHaveBeenCalled();
  });

  it('un non-admin recoit ADMIN_REQUIRED sans toucher le moteur', async () => {
    const { token } = await nouveauCompte('player');
    const res = resFactice();
    await handleLeagueRoutes({
      req: reqPour(token, '/api/leagues/LS-GARDE/final-results', { results: [] }), res, pathname: '/api/leagues/LS-GARDE/final-results', io: null,
    });
    expect(res.statusCode).toBe(403);
    expect(submitLeagueFinalResultsOnServer).not.toHaveBeenCalled();
  });

  it('un admin 2FA-fraiche verse la cagnotte par la route finale', async () => {
    const { token, id } = await nouveauCompte('admin');
    activer2fa(id);
    expect(markAdmin2faVerified(token)).toBe(true);
    const res = resFactice();
    await handleLeagueRoutes({
      req: reqPour(token, '/api/leagues/LS-GARDE/final-results', { results: [] }), res, pathname: '/api/leagues/LS-GARDE/final-results', io: null,
    });
    expect(res.statusCode).toBe(200);
    expect(submitLeagueFinalResultsOnServer).toHaveBeenCalledTimes(1);
    expect(saveLeagues).toHaveBeenCalled();
  });
});

describe('S3 : POST /api/tournaments/:id/matches/:mid/result', () => {
  it('une session admin sans 2FA ne peut pas regler un duel de tournoi', async () => {
    const { token } = await nouveauCompte('admin');
    const res = resFactice();
    await handleTournamentRoutes({
      req: reqPour(token, '/api/tournaments/TO-GARDE/matches/D1/result', { winnerEntryId: 'e-1', scores: [10, 5] }), res, pathname: '/api/tournaments/TO-GARDE/matches/D1/result', io: null,
    });
    expectGarde2fa(res);
    expect(submitTournamentMatchResultOnServer).not.toHaveBeenCalled();
  });

  it('l arbitre assigne du duel continue de passer sans TOTP', async () => {
    const { token } = await nouveauCompte('player');
    const res = resFactice();
    await handleTournamentRoutes({
      req: reqPour(token, '/api/tournaments/TO-GARDE/matches/D1/result', { winnerEntryId: 'e-1', scores: [10, 5] }), res, pathname: '/api/tournaments/TO-GARDE/matches/D1/result', io: null,
    });
    expect(res.statusCode).toBe(200);
    expect(submitTournamentMatchResultOnServer).toHaveBeenCalledTimes(1);
  });

  it('un admin 2FA-fraiche garde son override tournoi', async () => {
    const { token, id } = await nouveauCompte('admin');
    activer2fa(id);
    expect(markAdmin2faVerified(token)).toBe(true);
    const res = resFactice();
    await handleTournamentRoutes({
      req: reqPour(token, '/api/tournaments/TO-GARDE/matches/D1/result', { winnerEntryId: 'e-1', scores: [10, 5] }), res, pathname: '/api/tournaments/TO-GARDE/matches/D1/result', io: null,
    });
    expect(res.statusCode).toBe(200);
    expect(submitTournamentMatchResultOnServer).toHaveBeenCalledTimes(1);
    expect(saveTournaments).toHaveBeenCalled();
  });
});

