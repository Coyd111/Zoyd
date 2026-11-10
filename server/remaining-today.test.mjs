import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le contrat de /api/wallet/me pour la politique de retrait publiee.
 *
 * La route documente son champ ainsi : « Publie pour que le front affiche
 * la regle au lieu de decouvrir le refus » (routes/wallet.mjs:133-139). Elle
 * publie `dailyLimit` = MAX_WITHDRAWAL_DAILY_ZC, donc `remainingToday` doit
 * etre ce qui RESTE de ce plafond — pas le cumul deja retires (getWindowed
 * WithdrawalTotal), sinon le joueur lisait 200 sur un plafond de 50 000 et
 * le front en deduisait un solde de retrait fantome.
 *
 * Sans consommateur front a ce jour, le correctif est purement serveur :
 * le test fixe le contrat pour le jour ou le front l'affichera.
 *
 * Harnais wallet-history.test.mjs : persistence + wallet-engine REELS,
 * supabase simule, creditedUser 1000 ZC.
 */

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      select: vi.fn(() => ({ range: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
      delete: vi.fn(() => {
        const chain = { eq: vi.fn(() => chain) };
        chain.then = (onOk) => Promise.resolve({ error: null }).then(onOk);
        return chain;
      }),
    })),
  },
}));

vi.mock('./payment-engine.mjs', () => ({
  PAYOUT_COUNTRY_CONFIG: {},
  initiateFedaPayPayout: vi.fn(async () => { throw new Error('non teste'); }),
  normalizePayoutCountry: vi.fn((p) => p || 'BJ'),
  parsePhoneForFedaPay: vi.fn(),
  verifyFedaPayTransactionAndCredit: vi.fn(),
}));

vi.mock('./push-notifications.mjs', () => ({
  deliverNotification: vi.fn(async () => {}),
}));

vi.mock('./state-helpers.mjs', () => ({
  getStoredTournaments: vi.fn(() => []),
  sanitizeMatchForBroadcast: vi.fn((m) => m),
  sanitizeTournamentForBroadcast: vi.fn((t) => t),
  buildMatchActionPayload: vi.fn((match) => ({ ok: true, id: match?.id })),
  saveMatches: vi.fn(async () => {}),
}));

import * as p from './persistence.mjs';
import {
  depositToWallet,
  withdrawFromWallet,
  MAX_WITHDRAWAL_DAILY_ZC,
} from './wallet-engine.mjs';
import { handleWalletRoutes } from './routes/wallet.mjs';

let counter = 0;

/** Numero beninois de test : toujours 10 chiffres apres l'indicatif. */
const testPhone = () => `+229${String((Date.now() % 900000000) + counter * 7).padStart(10, '0')}`;

/** Compte cree, avec de quoi retirer : 1000 ZC de depart. */
const creditedUser = async (tag) => {
  counter += 1;
  const n = `${(Date.now() % 100000)}${counter}`.slice(-10);
  const created = await p.createUserAccount({
    pseudo: `${tag}${n}`,
    email: `${tag.toLowerCase()}-${n}@test.local`,
    phone: testPhone(),
    gameId: `CO-${tag}-${n}`,
    password: 'MotDePasse!Solide2026',
    acceptAdult: true,
    acceptTerms: true,
  });
  await depositToWallet(created.id, 1000, 'MTN MoMo');
  return created.id;
};

/** Req iterable (parseRequestBody itere sur le flux) + token Bearer. */
const reqPour = (token, url, body = null, method = 'GET') => ({
  method, url,
  socket: { remoteAddress: '10.7.9.9' },
  headers: { authorization: token ? `Bearer ${token}` : undefined },
  async *[Symbol.asyncIterator]() {
    if (body) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  },
  on() {}, removeListener() {}, destroy() {},
});

/** Res qui capture le corps JSON ecrit par respondJson (res.end(string)). */
const resFactice = () => ({
  statusCode: 200, headersSent: false, ended: false, corps: null,
  setHeader() {}, getHeader() { return undefined; },
  writeHead(code) { this.statusCode = code; this.headersSent = true; },
  end(body) { this.corps = body ?? ''; this.ended = true; },
  json(body) { this.corps = JSON.stringify(body); this.ended = true; },
});

beforeEach(() => { counter = 0; });

describe('GET /api/wallet/me — remainingToday', () => {
  it('publie ce qui RESTE du plafond journalier, pas le cumul deja retires', async () => {
    const userId = await creditedUser('Rema');
    const session = await p.createAuthSession(userId);
    await withdrawFromWallet(userId, 200, 'MTN MoMo', '0165240654');

    const res = resFactice();
    await handleWalletRoutes({
      req: reqPour(session.token, '/api/wallet/me'),
      res,
      pathname: '/api/wallet/me',
      io: null,
    });

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.corps);
    expect(payload.ok).toBe(true);
    // coherence de fond : la route publie bien le plafond du moteur
    expect(payload.withdrawal.dailyLimit).toBe(MAX_WITHDRAWAL_DAILY_ZC);
    expect(payload.withdrawal.dailyWindowHours).toBe(24);
    // LE CONTRAT : remainingToday = plafond − cumul deja retires (200, sans
    // les tx failed). Sous le bug, le serveur renvoyait le cumul (200).
    expect(payload.withdrawal.remainingToday).toBe(MAX_WITHDRAWAL_DAILY_ZC - 200);
    expect(payload.withdrawal.remainingToday).toBe(49_800);
  });

  it('un compte frais voit le plafond entier — jamais le cumul inverse', async () => {
    const userId = await creditedUser('Neuf');
    const session = await p.createAuthSession(userId);

    const res = resFactice();
    await handleWalletRoutes({
      req: reqPour(session.token, '/api/wallet/me'),
      res,
      pathname: '/api/wallet/me',
      io: null,
    });

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.corps);
    // Sous le bug, remainingToday = 0 (cumul nul) sur un plafond vierge.
    expect(payload.withdrawal.remainingToday).toBe(MAX_WITHDRAWAL_DAILY_ZC);
  });
});
