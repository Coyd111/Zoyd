import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

/**
 * Les quotas des routes d'ecriture (domaines MATCH, TOURNOI, LIGUE).
 *
 * Ces routes prennent toutes le mutex GLOBAL de leur domaine et ecrivent en
 * base a chaque appel. Sans quota, un simple compte authentifie peut
 * sérialiser les operations de toute la plateforme et epuiser le budget
 * d'ecritures Supabase. C'etait le cas, en particulier, pour les neuf routes
 * du domaine match (schedule/room/launch/result/confirm/disputes/evidence/
 * escalate) et les trois du domaine tournoi (start/room/live) : aucune
 * n'avait de rate limit, et la justification presente dans l'en-tete des
 * fichiers (« les gardes du moteur bornent l'impact ») etait circulaire -
 * ce qui est borne par le moteur, c'est l'ETAT d'un match, pas le TEMPS
 * d'occupation du mutex.
 *
 * Le test est COMPORTEMENTAL et prouve trois choses a la fois :
 *   1. la route repond 429 `RATE_LIMITED` quand le quota est epuise ;
 *   2. le MOTEUR n'est plus appele (pas d'ecriture en base) ;
 *   3. le MUTEX GLOBAL n'est meme pas PRIS - le garde est AVANT le verrou,
 *      sinon la ressource saturee (le mutex) resterait la premiere a
 *      s'ecrouler.
 *
 * Harnais : persistence REELLE (createAuthSession), supabase simule,
 * moteurs simules via state/match/tournament/league-engine mocks.
 */

const hook = vi.hoisted(() => ({ match: 0, tournament: 0, league: 0 }));

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

// Les verrous reels sont conserves : on ne compte QUE les entrees, pour
// prouver que la requete refusee par le quota n'entre pas dans le verrou.
vi.mock('./mutex.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    withMatchMutex: async (fn) => { hook.match += 1; return actual.withMatchMutex(fn); },
    withTournamentMutex: async (fn) => { hook.tournament += 1; return actual.withTournamentMutex(fn); },
    withLeagueMutex: async (fn) => { hook.league += 1; return actual.withLeagueMutex(fn); },
  };
});

vi.mock('./state-helpers.mjs', () => ({
  saveMatches: vi.fn(async () => {}),
  saveLeagues: vi.fn(async () => {}),
  saveTournaments: vi.fn(async () => {}),
  getStoredLeagues: vi.fn(() => []),
  getStoredTournaments: vi.fn(() => []),
  buildMatchActionPayload: vi.fn((match) => ({ ok: true, id: match?.id })),
  buildLeagueActionPayload: vi.fn((season) => ({ ok: true, id: season?.id })),
  buildTournamentActionPayload: vi.fn((t) => ({ ok: true, id: t?.id })),
  sanitizeLeagueForBroadcast: vi.fn((season) => season),
  sanitizeTournamentForBroadcast: vi.fn((t) => t),
}));

vi.mock('./push-notifications.mjs', () => ({
  deliverNotification: vi.fn(async () => {}),
  notifyAllAdmins: vi.fn(async () => {}),
}));

vi.mock('./wallet-engine.mjs', () => ({
  refundLockedEntry: vi.fn(async () => {}),
}));

vi.mock('./match-engine.mjs', () => ({
  createMatchOnServer: vi.fn(async () => ({ matches: [], match: { id: 'M-QUOTA', players: [] } })),
  joinMatchOnServer: vi.fn(async () => ({ matches: [], match: { id: 'M-QUOTA', players: [] } })),
  leaveMatchOnServer: vi.fn(async () => ({ matches: [], match: { id: 'M-QUOTA', players: [] } })),
  cancelMatchSelfOnServer: vi.fn(async () => ({ matches: [], match: { id: 'M-QUOTA', players: [] } })),
  assignArbiterOnServer: vi.fn(() => ({ matches: [], match: { id: 'M-QUOTA', players: [] } })),
  checkInMatchOnServer: vi.fn(() => ({ matches: [], match: { id: 'M-QUOTA', players: [] } })),
  toggleReadyOnServer: vi.fn(() => ({ matches: [], match: { id: 'M-QUOTA', players: [] } })),
  scheduleMatchOnServer: vi.fn(() => ({ matches: [], match: { id: 'M-QUOTA', players: [] } })),
  setRoomDetailsOnServer: vi.fn(() => ({ matches: [], match: { id: 'M-QUOTA', players: [] } })),
  launchMatchOnServer: vi.fn(() => ({ matches: [], match: { id: 'M-QUOTA', players: [] } })),
  submitMatchResultOnServer: vi.fn(async () => ({ matches: [], match: { id: 'M-QUOTA', players: [], confirmationDeadline: Date.now() + 1000 } })),
  confirmMatchResultOnServer: vi.fn(async () => ({ matches: [], match: { id: 'M-QUOTA', players: [] }, settled: false, waitingFor: [] })),
  openDisputeOnServer: vi.fn(() => ({ matches: [], match: { id: 'M-QUOTA', players: [] } })),
  addEvidenceToDisputeOnServer: vi.fn(() => ({ matches: [], match: { id: 'M-QUOTA', players: [] } })),
  escalateDisputeOnServer: vi.fn(() => ({ matches: [], match: { id: 'M-QUOTA', players: [] } })),
}));

vi.mock('./tournament-engine.mjs', () => ({
  createTournamentOnServer: vi.fn(() => ({ tournaments: [], tournament: { id: 'TO-QUOTA', entries: [] } })),
  registerForTournamentOnServer: vi.fn(async () => ({ tournaments: [], tournament: { id: 'TO-QUOTA', entries: [] } })),
  joinTournamentOnServer: vi.fn(async () => ({ tournaments: [], tournament: { id: 'TO-QUOTA', entries: [] } })),
  leaveTournamentOnServer: vi.fn(async () => ({ tournaments: [], tournament: { id: 'TO-QUOTA', entries: [] } })),
  assignTournamentArbiterOnServer: vi.fn(() => ({ tournaments: [], tournament: { id: 'TO-QUOTA', entries: [] } })),
  startTournamentOnServer: vi.fn(async () => ({ tournaments: [], tournament: { id: 'TO-QUOTA', entries: [] } })),
  setTournamentMatchRoomDetailsOnServer: vi.fn(() => ({ tournaments: [], tournament: { id: 'TO-QUOTA', entries: [] } })),
  setTournamentMatchLiveOnServer: vi.fn(() => ({ tournaments: [], tournament: { id: 'TO-QUOTA', entries: [] } })),
  submitTournamentMatchResultOnServer: vi.fn(async () => ({ tournaments: [], tournament: { id: 'TO-QUOTA', entries: [] } })),
}));

vi.mock('./league-engine.mjs', () => ({
  createLeagueSeasonOnServer: vi.fn(() => ({ seasons: [], season: { id: 'LS-QUOTA', registeredPlayers: [] } })),
  startLeagueQualificationOnServer: vi.fn(() => ({ seasons: [], season: { id: 'LS-QUOTA', registeredPlayers: [] } })),
  startLeagueDayOnServer: vi.fn(() => ({ seasons: [], season: { id: 'LS-QUOTA', registeredPlayers: [] } })),
  submitLeagueDayResultsOnServer: vi.fn(() => ({ seasons: [], season: { id: 'LS-QUOTA', registeredPlayers: [] } })),
  advanceToFinalOnServer: vi.fn(() => ({ seasons: [], season: { id: 'LS-QUOTA', registeredPlayers: [] } })),
  submitLeagueFinalResultsOnServer: vi.fn(async () => ({ seasons: [], season: { id: 'LS-QUOTA', registeredPlayers: [] } })),
  getLeagueLeaderboard: vi.fn(() => []),
  updateLeagueSettingsOnServer: vi.fn(() => ({ seasons: [], season: { id: 'LS-QUOTA', registeredPlayers: [] } })),
  joinLeagueSeasonOnServer: vi.fn(async () => ({ seasons: [], season: { id: 'LS-QUOTA', registeredPlayers: [] } })),
  leaveLeagueSeasonOnServer: vi.fn(async () => ({ seasons: [], season: { id: 'LS-QUOTA', registeredPlayers: [] } })),
  reassignPlayerOnServer: vi.fn(() => ({ seasons: [], season: { id: 'LS-QUOTA', registeredPlayers: [] } })),
  refundLeaguePlayerOnServer: vi.fn(async () => ({ seasons: [], season: { id: 'LS-QUOTA', registeredPlayers: [] } })),
  getLeaguePayments: vi.fn(() => []),
}));

import { createUserAccount, createAuthSession } from './persistence.mjs';
import { handleMatchRoutes } from './routes/match.mjs';
import { handleTournamentRoutes } from './routes/tournament.mjs';
import { handleLeagueRoutes } from './routes/league.mjs';

const settle = () => new Promise((r) => setTimeout(r, 10));

const resFactice = () => ({
  statusCode: 200, headersSent: false, ended: false, corps: null,
  setHeader() {}, getHeader() { return undefined; },
  writeHead(code) { this.statusCode = code; this.headersSent = true; },
  end(chunk) {
    this.ended = true;
    if (chunk) { try { this.corps = JSON.parse(String(chunk)); } catch { this.corps = String(chunk); } }
  },
  json(payload) { this.corps = payload; this.ended = true; },
});

// `parseRequestBody` itere sur la requete comme sur un flux : la req factice
// doit etre ITERABLE et produire le corps JSON.
const reqPour = (token, pathname, ip, body = {}, methode = 'POST') => ({
  method: methode,
  url: pathname,
  socket: { remoteAddress: ip },
  headers: { authorization: `Bearer ${token}` },
  async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); },
  on() {}, removeListener() {}, destroy() {},
});

let token = '';

beforeAll(async () => {
  const stamp = `${Date.now()}`.slice(-9);
  const compte = await createUserAccount({
    pseudo: `Quota${stamp}`.slice(0, 24),
    email: `quota-${stamp}@test.local`,
    phone: `+2250703${String(Date.now() % 100000).padStart(6, '0')}`,
    gameId: `CO-QUOTA-${stamp}`,
    password: 'MotDePasseSolide2026!',
    acceptAdult: true,
    acceptTerms: true,
  });
  await settle();
  const session = await createAuthSession(compte.id);
  token = session.token;
});

beforeEach(() => {
  vi.clearAllMocks();
  hook.match = 0;
  hook.tournament = 0;
  hook.league = 0;
});

/**
 * Envoie `nb` requetes depuis la meme IP et renvoie la derniere reponse.
 * Le compteur de mutex est capture AVANT et APRES : c'est lui qui prouve que
 * la requete refusee n'a pas pris le verrou global.
 */
const marteler = async (handler, pathname, ip, nb, body = {}, methode = 'POST') => {
  let res = null;
  for (let i = 0; i < nb; i += 1) {
    res = resFactice();
    await handler({ req: reqPour(token, pathname, ip, body, methode), res, pathname, io: null });
  }
  return res;
};

/** Temoin : la route fonctionne normally (200) tant que le quota n'est pas atteint. */
const temoin = async (handler, pathname, ip, moteur, methode = 'POST') => {
  const res = resFactice();
  await handler({ req: reqPour(token, pathname, ip, {}, methode), res, pathname, io: null });
  // 200 pour une action, 201 pour une creation.
  expect([200, 201], `la route doit repondre 200 ou 201 (${pathname})`).toContain(res.statusCode);
  expect(moteur, `le moteur doit etre appele (${pathname})`).toHaveBeenCalledTimes(1);
};

// Les cas sont decrits avec le NOM de la fonction moteur : la resolution se
// fait au moment du test (les mocks sont hoistes, on ne peut donc pas les
// capturer ici).
const CAS = {
  match: [
    { chemin: '/api/matches/M-QUOTA/schedule', moteur: 'scheduleMatchOnServer' },
    { chemin: '/api/matches/M-QUOTA/room', moteur: 'setRoomDetailsOnServer' },
    { chemin: '/api/matches/M-QUOTA/launch', moteur: 'launchMatchOnServer' },
    { chemin: '/api/matches/M-QUOTA/result', moteur: 'submitMatchResultOnServer' },
    { chemin: '/api/matches/M-QUOTA/confirm', moteur: 'confirmMatchResultOnServer' },
    { chemin: '/api/matches/M-QUOTA/disputes', moteur: 'openDisputeOnServer' },
    { chemin: '/api/matches/M-QUOTA/dispute/evidence', moteur: 'addEvidenceToDisputeOnServer' },
    { chemin: '/api/matches/M-QUOTA/dispute/escalate', moteur: 'escalateDisputeOnServer' },
  ],
  tournament: [
    { chemin: '/api/tournaments/TO-QUOTA/start', moteur: 'startTournamentOnServer' },
    { chemin: '/api/tournaments/TO-QUOTA/matches/D1/room', moteur: 'setTournamentMatchRoomDetailsOnServer' },
    { chemin: '/api/tournaments/TO-QUOTA/matches/D1/live', moteur: 'setTournamentMatchLiveOnServer' },
  ],
  league: [
    { chemin: '/api/leagues', methode: 'POST', moteur: 'createLeagueSeasonOnServer', groupe: 'admin', quota: 20 },
    { chemin: '/api/leagues/LS-QUOTA/join', methode: 'POST', moteur: 'joinLeagueSeasonOnServer', groupe: 'social', quota: 30 },
    { chemin: '/api/leagues/LS-QUOTA/leave', methode: 'POST', moteur: 'leaveLeagueSeasonOnServer', groupe: 'social', quota: 30 },
    { chemin: '/api/leagues/LS-QUOTA/start-qualification', methode: 'POST', moteur: 'startLeagueQualificationOnServer', groupe: 'admin', quota: 20 },
    { chemin: '/api/leagues/LS-QUOTA/days/D1/start', methode: 'POST', moteur: 'startLeagueDayOnServer', groupe: 'admin', quota: 20 },
    { chemin: '/api/leagues/LS-QUOTA', methode: 'PATCH', moteur: 'updateLeagueSettingsOnServer', groupe: 'admin', quota: 20 },
    { chemin: '/api/leagues/LS-QUOTA/reassign', methode: 'POST', moteur: 'reassignPlayerOnServer', groupe: 'admin', quota: 20 },
  ],
};

describe('MATCH : les routes d ecriture sont protegees par un quota', () => {
  for (const cas of CAS.match) {
    it(`POST ${cas.chemin} repond 429 apres le quota et ne prend jamais le mutex`, async () => {
      const moteur = (await import('./match-engine.mjs'))[cas.moteur];
      const ip = `10.41.${CAS.match.indexOf(cas)}.1`;
      const ipTemoin = `10.41.${CAS.match.indexOf(cas)}.9`;

      // Temoin : la route fonctionne quand le quota n'est pas atteint.
      await temoin(handleMatchRoutes, cas.chemin, ipTemoin, moteur);
      vi.clearAllMocks();
      hook.match = 0;

      // Le quota `social` est de 30/min.
      const res = await marteler(handleMatchRoutes, cas.chemin, ip, 31);

      expect(res.statusCode, `la 31e requete doit etre refusee (${cas.chemin})`).toBe(429);
      expect(res.corps.code).toBe('RATE_LIMITED');
      expect(moteur, `le moteur ne doit pas etre appele apres le quota (${cas.chemin})`).toHaveBeenCalledTimes(30);
      expect(hook.match, `le mutex global ne doit pas etre pris apres le quota (${cas.chemin})`).toBe(30);
    });
  }
});

describe('TOURNOI : les routes d ecriture sont protegees par un quota', () => {
  for (const cas of CAS.tournament) {
    it(`POST ${cas.chemin} repond 429 apres le quota et ne prend jamais le mutex`, async () => {
      const moteur = (await import('./tournament-engine.mjs'))[cas.moteur];
      const ip = `10.42.${CAS.tournament.indexOf(cas)}.1`;
      const ipTemoin = `10.42.${CAS.tournament.indexOf(cas)}.9`;

      await temoin(handleTournamentRoutes, cas.chemin, ipTemoin, moteur);
      vi.clearAllMocks();
      hook.tournament = 0;

      const res = await marteler(handleTournamentRoutes, cas.chemin, ip, 31);

      expect(res.statusCode, `la 31e requete doit etre refusee (${cas.chemin})`).toBe(429);
      expect(res.corps.code).toBe('RATE_LIMITED');
      expect(moteur, `le moteur ne doit pas etre appele apres le quota (${cas.chemin})`).toHaveBeenCalledTimes(30);
      expect(hook.tournament, `le mutex global ne doit pas etre pris apres le quota (${cas.chemin})`).toBe(30);
    });
  }
});

describe('LIGUE : les routes qui deplacent de l argent sont protegees par un quota', () => {
  for (const cas of CAS.league) {
    it(`${cas.methode} ${cas.chemin} repond 429 apres le quota et ne prend jamais le mutex`, async () => {
      const moteur = (await import('./league-engine.mjs'))[cas.moteur];
      const ip = `10.43.${CAS.league.indexOf(cas)}.1`;
      const ipTemoin = `10.43.${CAS.league.indexOf(cas)}.9`;

      await temoin(handleLeagueRoutes, cas.chemin, ipTemoin, moteur, cas.methode);
      vi.clearAllMocks();
      hook.league = 0;

      const res = await marteler(handleLeagueRoutes, cas.chemin, ip, cas.quota + 1, {}, cas.methode);

      expect(res.statusCode, `la requete ${cas.quota + 1} doit etre refusee (${cas.chemin})`).toBe(429);
      expect(res.corps.code).toBe('RATE_LIMITED');
      expect(moteur, `le moteur ne doit pas etre appele apres le quota (${cas.chemin})`).toHaveBeenCalledTimes(cas.quota);
      expect(hook.league, `le mutex global ne doit pas etre pris apres le quota (${cas.chemin})`).toBe(cas.quota);
    });
  }
});

describe('le quota est par IP, pas par compte', () => {
  it('une autre IP n est pas bloquee par le quota d une IP', async () => {
    const moteur = (await import('./match-engine.mjs')).scheduleMatchOnServer;

    await marteler(handleMatchRoutes, '/api/matches/M-QUOTA/schedule', '10.44.0.1', 31);
    expect(moteur).toHaveBeenCalledTimes(30);

    vi.clearAllMocks();
    const res = resFactice();
    await handleMatchRoutes({
      req: reqPour(token, '/api/matches/M-QUOTA/schedule', '10.44.0.2'),
      res,
      pathname: '/api/matches/M-QUOTA/schedule',
      io: null,
    });
    expect(res.statusCode, 'une IP differente doit passer').toBe(200);
    expect(moteur).toHaveBeenCalledTimes(1);
  });
});
