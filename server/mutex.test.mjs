import { describe, it, expect, vi, afterEach } from 'vitest';
import { withUserMutex, withBrLobbyMutex, cleanupIdleMutexes, startMutexCleanupTimer } from './mutex.mjs';

// Plafond interne (non exporte) : on le reproduit pour declencher l'eviction.
const MUTEX_MAX_SIZE = 10000;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mutex - exclusion mutuelle', () => {
  it('serialise les ecritures concurrentes du meme userId', async () => {
    const order = [];
    const critical = (label) => withUserMutex('wallet-x', async () => {
      order.push(`${label}:enter`);
      await new Promise((r) => setTimeout(r, 25));
      order.push(`${label}:exit`);
    });

    await Promise.all([critical('A'), critical('B')]);

    expect(order).toEqual(['A:enter', 'A:exit', 'B:enter', 'B:exit']);
  });

  it('laisse passer des userId differents en parallele', async () => {
    const order = [];
    const task = (id) => withUserMutex(id, async () => {
      order.push(`${id}:enter`);
      await new Promise((r) => setTimeout(r, 25));
      order.push(`${id}:exit`);
    });
    await Promise.all([task('u1'), task('u2')]);
    expect(order.slice(0, 2).every((e) => e.endsWith(':enter'))).toBe(true);
  });

  it('n evince pas un mutex verrouille quand le plafond est atteint', async () => {
    // Regression : l'eviction supprimait le mutex le plus ancien SANS verifier
    // isLocked(). Le mutex etant recree au prochain appel, une seconde
    // operation pouvait s'executer CONCURRENTIELLEMENT sur le meme
    // portefeuille (double debit / double credit).
    //
    // Scenario reproductible : on remplit le plafond, puis on verrouille
    // `victim` en gelant l'horloge, pour que son horodatage devienne LE PLUS
    // ANCIEN malgre le verrou. Sans la protection, c'est donc lui que
    // l'eviction choisit, et la serialisation se casse.
    for (let i = 0; i < MUTEX_MAX_SIZE; i++) {
      await withUserMutex(`user-${i}`, async () => {});
    }

    // `victim` existe deja (rempli ci-dessus), jamais verrouille.
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow - 60_000);

    let inside = 0;
    let maxConcurrent = 0;

    const criticalSection = () => withUserMutex('victim', async () => {
      inside++;
      maxConcurrent = Math.max(maxConcurrent, inside);
      await new Promise((r) => setTimeout(r, 30));
      inside--;
    });

    // Premiere operation : verrouille `victim` (horodatage ancien).
    const first = criticalSection();
    await new Promise((r) => setTimeout(r, 5));

    // Pendant ce temps, d'autres joueurs declenchent des evictions.
    const churn = Promise.all([
      withUserMutex('churn-1', async () => {}),
      withUserMutex('churn-2', async () => {}),
      withUserMutex('churn-3', async () => {}),
    ]);

    // Seconde operation sur le meme portefeuille pendant que la premiere
    // tourne : elle DOIT attendre.
    const second = criticalSection();

    await Promise.all([first, churn, second]);

    expect(maxConcurrent).toBe(1);
  });
});

describe('mutex - purge periodique de la famille BR (audit-3 P1 C4)', () => {
  it('purge les mutex BR inactifs vieillis, epargne le verrou actif', async () => {
    await withBrLobbyMutex('br-purge-a', async () => {});
    await withBrLobbyMutex('br-purge-b', async () => {});

    // Un verrou tenu : il doit survivre a la purge, meme vieilli.
    let openGate;
    const gate = new Promise((resolve) => { openGate = resolve; });
    const active = withBrLobbyMutex('br-purge-live', () => gate);
    await new Promise((r) => setTimeout(r, 5));

    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 31 * 60 * 1000);
    const deleteSpy = vi.spyOn(Map.prototype, 'delete');
    try {
      cleanupIdleMutexes();
      // Les inactifs vieillis sont purges.
      expect(deleteSpy).toHaveBeenCalledWith('br-purge-a');
      expect(deleteSpy).toHaveBeenCalledWith('br-purge-b');
      // Le verrou actif n'est JAMAIS evince.
      expect(deleteSpy).not.toHaveBeenCalledWith('br-purge-live');
    } finally {
      nowSpy.mockRestore();
      deleteSpy.mockRestore();
    }

    openGate();
    await active;

    // Relache et vieilli, il devient purgeable au tour suivant.
    const realNow2 = Date.now();
    const nowSpy2 = vi.spyOn(Date, 'now').mockReturnValue(realNow2 + 31 * 60 * 1000);
    const deleteSpy2 = vi.spyOn(Map.prototype, 'delete');
    try {
      cleanupIdleMutexes();
      expect(deleteSpy2).toHaveBeenCalledWith('br-purge-live');
    } finally {
      nowSpy2.mockRestore();
      deleteSpy2.mockRestore();
    }
  });

  it('startMutexCleanupTimer demarre explicitement, unref, et tourne sans crash', () => {
    vi.useFakeTimers();
    try {
      const countBefore = vi.getTimerCount();
      const timer = startMutexCleanupTimer();
      // Le timer ne vit qu'a partir de l'appel explicite (plus de timer a
      // l'IMPORT du module — occurrence du type P9 C6).
      expect(vi.getTimerCount()).toBe(countBefore + 1);
      expect(typeof timer.unref).toBe('function');
      expect(() => vi.advanceTimersByTime(2 * 5 * 60 * 1000)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
