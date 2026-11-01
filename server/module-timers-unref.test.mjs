import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Les nettoyages periodiques cres a l'import (module-level) REFUSENT le
 * process Node tant qu'ils ne sont pas `.unref()`-ed : en vitest, le worker
 * reste pendu apres la suite ; en prod, un simple import de ces modules dans
 * un script one-shot (migration, benchmark) ne se termine jamais.
 *
 * Le serveur acepte la lenteur, mais un handle oublie est un handle cache :
 * mutex.mjs:222 et channel-presence.mjs:84 posent deja la convention
 * `.unref()` ; ces tests verrouillent les modules qui la rataient :
 *   payment-engine.mjs  - sweeper des verrous de transaction, 5 min
 *   metrics.mjs         - collecte 15 s + nettoyage 5 min
 *   rate-limiter.mjs    - purge des buckets, 60 s
 */

// Memes mocks transitifs que payment-engine.test.mjs : on ne teste pas le
// moteur ici, seulement les timers crees a l'import.
vi.mock('fedapay', () => ({
  FedaPay: { setApiKey: vi.fn(), setEnvironment: vi.fn(), apiKey: null },
  Transaction: { retrieve: vi.fn() },
  Payout: { create: vi.fn(), retrieve: vi.fn() },
}));
vi.mock('./wallet-engine.mjs', () => ({
  depositToWallet: vi.fn(),
  debitFromWallet: vi.fn(),
  refundLockedEntry: vi.fn(),
}));
vi.mock('./persistence.mjs', () => ({
  hasTransactionBeenProcessed: vi.fn(),
  claimTransaction: vi.fn(),
  releaseTransaction: vi.fn(),
  makeError: (code, message) => {
    const err = new Error(message);
    err.code = code;
    return err;
  },
}));

let records;

beforeEach(() => {
  vi.resetModules();
  records = [];
  // Global : les trois modules denomment bare `setInterval` sans import
  // explicite, donc une stub du global capte TOUT le graphe d'import.
  vi.stubGlobal('setInterval', vi.fn((fn, ms) => {
    const handle = { ref: vi.fn(), unref: vi.fn() };
    records.push({ fn, ms, handle });
    return handle;
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const chaqueIntervalleEstDetache = ({ attendus }) => {
  expect(records.length, `intervalles crees a l'import : ${JSON.stringify(attendus)}`).toBeGreaterThanOrEqual(attendus.length);
  const nonDetaches = records.filter((r) => r.handle.unref.mock.calls.length === 0);
  expect(nonDetaches, `intervalles jamais detachs : ${JSON.stringify(nonDetaches.map((r) => r.ms))}`).toEqual([]);
};

describe('import de metrics.mjs : intervalles non refus', () => {
  it('collecte 15 s et nettoyage 5 min, tous deux unref', async () => {
    await import('./metrics.mjs');
    chaqueIntervalleEstDetache({ attendus: [15000, 300000] });
  });
});

describe('import de rate-limiter.mjs : intervalle non refus', () => {
  it('purge des buckets a 60 s, unref', async () => {
    await import('./rate-limiter.mjs');
    chaqueIntervalleEstDetache({ attendus: [60000] });
  });
});

describe('import de payment-engine.mjs : intervalle non refus', () => {
  it('sweeper des verrous de transaction a 5 min, unref', async () => {
    await import('./payment-engine.mjs');
    chaqueIntervalleEstDetache({ attendus: [300000] });
  });
});
