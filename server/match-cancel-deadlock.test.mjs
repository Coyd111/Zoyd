import { describe, it, expect, vi } from 'vitest';

/**
 * INVARIANT match-engine.mjs (`refundMatchPlayers`) : « l appelant tient des
 * verrous GLOBAUX (matchs) mais JAMAIS le verrou wallet d un joueur. Ne pas
 * appeler cette fonction sous `withWalletMutex(userId)` : verrou non
 * re-entrant, blocage immediat. »
 *
 * La route d annulation PAR LE CREATEUR (`POST /api/matches/:id/cancel`)
 * violait cette regle : elle enveloppait `cancelMatchSelfOnServer` d un
 * `withWalletMutex(session.user.id)`, alors que le moteur rembourse chaque
 * joueur en prenant LUI-MEME le verrou wallet de ce joueur. Le createur
 * etait donc son propre second acquereur : le mutex n etant pas re-entrant,
 * la requete attendait indefiniment — en tenant le mutex GLOBAL des matchs,
 * donc en bloquant TOUTES les operations de match de la plateforme.
 *
 * Pourquoi un test de ROUTE et pas un test du moteur : le test existant
 * (`match-exit.test.mjs`) appelle `cancelMatchSelfOnServer` DIRECTEMENT, sans
 * l enveloppe de la route. Il ne voit donc jamais le deadlock — il ne peut
 * pas. C est ce trou qui a laisse passer le bug : la suite unitaire etait
 * verte (1320 tests) pendant que l annulation etait bloquee en HTTP.
 *
 * Ce test passe par la route (donc par le vrai verrou, non simule) et
 * exige une reponse dans un delai court : sous le bug, la reponse n arrive
 * jamais et le test echoue en 2 s au lieu d expirer a 60 s.
 */

// PAS de mock de `./supabase.mjs` : la configuration Vitest pose
// `ZOYD_DISABLE_SUPABASE=true`, donc le module exporte `supabase = null` et
// la persistence travaille en MEMOIRE (`stateTrusted` vrai, ecritures
// acceptees). Un faux client Supabase ici ferait passer `stateTrusted` a
// faux et toute ecriture serait refusee en 503 — le test ne testerait rien.

vi.mock('./push-notifications.mjs', () => ({
  deliverNotification: vi.fn(async () => {}),
  notifyAllAdmins: vi.fn(async () => {}),
  broadcastStateSnapshot: vi.fn(),
  sendPushToUser: vi.fn(),
}));

import { createUserAccount, createAuthSession, getUserById } from './persistence.mjs';
import { depositToWallet } from './wallet-engine.mjs';
import { handleMatchRoutes } from './routes/match.mjs';

const DELAI_MAX_MS = 2000;

const resFactice = () => ({
  statusCode: 200, headersSent: false, ended: false, payload: null,
  setHeader() {}, getHeader() { return undefined; },
  writeHead(code) { this.statusCode = code; this.headersSent = true; },
  end(body) {
    this.ended = true;
    if (typeof body === 'string') {
      try { this.payload = JSON.parse(body); } catch { this.payload = null; }
    }
  },
  json() { this.ended = true; },
});

// `parseRequestBody` itere la requete comme un flux : la req factice doit
// etre ITERABLE (meme contrainte que parse-hors-mutex.test.mjs).
const reqPour = (token, url, body = null, method = 'POST') => ({
  method, url,
  socket: { remoteAddress: '10.7.7.7' },
  headers: { authorization: token ? `Bearer ${token}` : undefined },
  async *[Symbol.asyncIterator]() {
    if (body !== null && body !== undefined) {
      yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    }
  },
  on() {}, removeListener() {}, destroy() {},
});

// `io` factice : `saveMatches` diffuse par socket, et lit `io.sockets.sockets`
// (une Map). Aucune socket connectee ici : la diffusion ne porte sur rien.
const ioFactice = () => ({
  sockets: { sockets: new Map() },
  to: () => ({ emit: () => {} }),
  emit: () => {},
});

const appeler = (token, url, body, method = 'POST') => {
  const res = resFactice();
  const requete = handleMatchRoutes({
    req: reqPour(token, url, body, method),
    res,
    pathname: url,
    io: ioFactice(),
  });
  return { res, requete };
};

let compteur = 0;
const nouveauCompte = async () => {
  compteur += 1;
  const stamp = `${Date.now()}`.slice(-9);
  const compte = await createUserAccount({
    pseudo: `Annul${compteur}${stamp}`.slice(0, 26),
    email: `annul-${compteur}-${stamp}@test.local`,
    phone: `+2250703${String(Date.now() % 100000).padStart(6, '0')}`,
    gameId: `CO-ANN-${compteur}-${stamp}`,
    password: 'MotDePasseSolide2026!',
    acceptAdult: true,
    acceptTerms: true,
  });
  const session = await createAuthSession(compte.id);
  // Solde pour payer un pass : le createur doit pouvoir verrouiller une mise.
  await depositToWallet(compte.id, 500, 'Mobile Money');
  return { compte, token: session.token };
};

describe('annulation par le createur : pas de deadlock sur le verrou wallet', () => {
  it('la route annule le match et rend la mise dans le delai', async () => {
    const { compte, token } = await nouveauCompte();

    // 1 — le createur publie un match et verrouille son pass.
    const creation = appeler(token, '/api/matches', {
      format: '1VS1',
      entryFee: 100,
      rules: { description: 'annulation' },
      visibility: 'public',
    });
    await creation.requete;
    expect(creation.res.statusCode, JSON.stringify(creation.res.payload)).toBe(201);
    const matchId = creation.res.payload?.match?.id;
    expect(matchId).toBeTruthy();

    // Le pass est bien bloque : le test porte sur le REMBOURSEMENT.
    const avantAnnulation = getUserById(compte.id);
    expect(avantAnnulation.wallet.lockedBalance).toBe(100);

    // 2 — il annule son match. SOUS LE BUG, cette requete n aboutit jamais :
    // le moteur reprend le verrou wallet du createur que la route tient deja.
    const annulation = appeler(token, `/api/matches/${matchId}/cancel`, {});
    const abouti = await Promise.race([
      annulation.requete.then(() => true),
      new Promise((r) => setTimeout(() => r(false), DELAI_MAX_MS)),
    ]);

    expect(
      abouti,
      `la route d annulation doit repondre en moins de ${DELAI_MAX_MS} ms (deadlock sur le verrou wallet)`,
    ).toBe(true);
    expect(annulation.res.statusCode).toBe(200);

    // 3 — et le pass est bien rendu : l annulation n est pas seulement
    // repondue, elle rembourse.
    const apresAnnulation = getUserById(compte.id);
    expect(apresAnnulation.wallet.lockedBalance).toBe(0);
    expect(apresAnnulation.wallet.cashBalance).toBe(500);
  });
});
