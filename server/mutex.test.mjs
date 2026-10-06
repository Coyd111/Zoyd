import { describe, it, expect, vi, afterEach } from 'vitest';
import { withUserMutex } from './mutex.mjs';

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
