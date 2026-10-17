import { describe, it, expect, afterEach } from 'vitest';
import cluster from 'node:cluster';
import { isMultiProcess, isClusterWorker, assertSingleProcess, hasIllegibleConcurrencyConfig } from './single-process-guard.mjs';

/**
 * Unicite du processus.
 *
 * Ce que le projet affirmait avant : « `WEB_CONCURRENCY=1` le garantit
 * aujourd'hui ». Ce que faisaient les fichiers : la variable n'etait configuree
 * NULLE PART. La garantie ne tenait donc que par l'absence de `cluster` dans la
 * commande de demarrage — vraie par hasard, et invisible des qu'on ajoutait un
 * drapeau ou qu'un operateur activait l'autoscaling.
 *
 * Concretement, deux instances ne perdent pas un coup de test : elles perdent de
 * l'argent. Deux retraits lus sur le meme solde produisent deux soldes differents
 * ecrits en sequence, et le second ecrasant le debit du premier.
 */

const ENV_INITIAL = process.env.WEB_CONCURRENCY;

const withEnv = (valeur, run) => {
  if (valeur === undefined) delete process.env.WEB_CONCURRENCY;
  else process.env.WEB_CONCURRENCY = valeur;
  return run();
};

afterEach(() => {
  if (ENV_INITIAL === undefined) delete process.env.WEB_CONCURRENCY;
  else process.env.WEB_CONCURRENCY = ENV_INITIAL;
});

describe('Unicite du processus', () => {
  it('un lancement simple est accepte', () => {
    expect(isMultiProcess()).toBe(false);
    expect(assertSingleProcess()).toBe(true);
  });

  it('WEB_CONCURRENCY=1 est explicitement accepte', async () => {
    await withEnv('1', () => {
      expect(isMultiProcess()).toBe(false);
      expect(assertSingleProcess()).toBe(true);
    });
  });

  it('WEB_CONCURRENCY=2 est refuse', async () => {
    await withEnv('2', () => {
      expect(isMultiProcess()).toBe(true);
      expect(() => assertSingleProcess({ log: { error: () => {} } })).toThrow(/processus unique/);
    });
  });

  it('une valeur illisible est signalee sans arreter le serveur', async () => {
    // Le compromis assume : arreter un service qui fonctionne sur une faute de
    // frappe dans une variable serait un dommage PLUS CERTAIN que la perte
    // d'argent qu'on cherche a eviter. On signale, on ne bloque pas.
    await withEnv('beaucoup', () => {
      expect(isMultiProcess(), 'une valeur illisible ne prouve rien').toBe(false);
      expect(hasIllegibleConcurrencyConfig()).toBe(true);
      const avertis = [];
      expect(assertSingleProcess({ log: { error: () => {}, warn: (m) => avertis.push(m) } })).toBe(true);
      expect(avertis, 'l anomalie doit etre signalee').toHaveLength(1);
      expect(avertis[0]).toMatch(/illisible/);
    });
  });

  it('une valeur valide ne signale rien', async () => {
    await withEnv('1', () => {
      expect(hasIllegibleConcurrencyConfig()).toBe(false);
      const avertis = [];
      assertSingleProcess({ log: { error: () => {}, warn: (m) => avertis.push(m) } });
      expect(avertis).toHaveLength(0);
    });
  });

  it('un worker de cluster se declare multi-processus meme avec WEB_CONCURRENCY=1', async () => {
    // C'est le piege du lancement par cluster : la variable dit 1, mais il y a
    // bien plusieurs processus. `cluster.isPrimary === false` le prouve.
    const vrai = cluster.isPrimary;
    try {
      Object.defineProperty(cluster, 'isPrimary', { value: false, configurable: true });
      expect(isClusterWorker()).toBe(true);
      await withEnv('1', () => {
        expect(isMultiProcess()).toBe(true);
        expect(() => assertSingleProcess({ log: { error: () => {} } })).toThrow();
      });
    } finally {
      Object.defineProperty(cluster, 'isPrimary', { value: vrai, configurable: true });
    }
  });

  it('le motif du refus est exploitable sans ouvrir les logs a l aveu', async () => {
    let capt;
    await withEnv('4', () => {
      capt = [];
      try {
        assertSingleProcess({ log: { error: (m, d) => capt.push({ m, d }) } });
      } catch { /* attendu */ }
    });
    expect(capt).toHaveLength(1);
    expect(capt[0].d.webConcurrency).toBe('4');
    expect(capt[0].d.correctif).toContain('WEB_CONCURRENCY=1');
    expect(capt[0].d.consequence).toMatch(/argent/);
  });
});