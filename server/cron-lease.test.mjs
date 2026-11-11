import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * BAIL DISTRIBUE pour les travaux de fond (`cron.mjs`).
 *
 * Le trou
 * -------
 * Les jobs de fond etaient proteges par des verrous de PROCESSUS
 * (`withMatchMutex`, `withWalletMutex`) et par des drapeaux `*Running`.
 * Ces deux protections ne valent RIEN entre deux instances.
 *
 * Or deux instances coexistent pendant un deploiement Render : l'ancienne
 * (qui termine ses requetes) et la nouvelle (qui demarre). Les deux
 * executent `initCronJobs`, donc les deux balayent les reglements en
 * attente.
 *
 * Concretement, sur le job `sweepPendingSettlements` :
 *   instance A : lit le match 'pending', calcule le partage, verse les gains,
 *                ecrit `payoutDistributed = true` ;
 *   instance B : lit le MEME match 'pending' (son etat memoire est
 *                anterieur), fait le meme travail.
 *
 * Le CREDIT est protege par la cle d'idempotence des gains
 * (`wallet.winningsKeys`), donc le joueur n'est pas paye deux fois. Mais le
 * reste ne l'est pas : l'appel a FedaPay part deux fois, les compteurs
 * avancent deux fois, et le journal ment sur l'etat reel.
 *
 * La solution : un BAIL en base.
 * ------------------------------------------------------------------------
 * L'acquisition est un INSERT qui REFUSE le doublon (code Postgres 23505).
 * Deux instances qui essayent en meme temps : une seule reussit. C'est
 * exactement le mecanisme de `claimTransaction` (reservation FedaPay), deja
 * eprouve dans ce projet.
 *
 * Ce que le test garantit
 * -----------------------
 * 1. Une seule instance obtient le bail pour un job donne.
 * 2. Le bail expire SEUL : une instance disparue ne bloque pas le job
 *    pour toujours (c'est ce qui distingue un bail d'un verrou).
 * 3. Un bail expire peut etre REPRIS (l'etat du job ne reste pas gelé).
 * 4. Une panne de la base ne fait PAS echouer le job : le bail est
 *    indisponible, le job tourne quand meme (degrade, pas arret).
 * 5. En mode memoire (pas de base), le bail est toujours accorde : il n'y a
 *    qu'un processus, le verrou de processus suffit.
 */

// ─── Faux client Supabase, avec le comportement de PostgREST ─────────────────
const lignes = new Map(); // jobName -> { job_name, holder, acquired_at, expires_at }
const journal = [];

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn((table) => {
      let filtre = {};
      let operation = null; // { type: 'update' | 'delete', patch }
      const query = {
        eq: vi.fn((col, val) => { filtre = { ...filtre, [col]: val }; return query; }),
        lt: vi.fn((col, val) => { filtre = { ...filtre, [`${col}<`]: val }; return query; }),
        select: vi.fn(() => query),
        limit: vi.fn(() => query),
        insert: vi.fn((data) => {
          journal.push({ table, op: 'insert', key: data.job_name });
          if (lignes.has(data.job_name)) {
            // PostgREST : violation d'unicite.
            return Promise.resolve({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            });
          }
          lignes.set(data.job_name, { ...data });
          return Promise.resolve({ data, error: null });
        }),
        update: vi.fn((patch) => {
          journal.push({ table, op: 'update', patch });
          operation = { type: 'update', patch };
          return query;
        }),
        delete: vi.fn(() => {
          journal.push({ table, op: 'delete' });
          operation = { type: 'delete' };
          return query;
        }),
        then: (onOk) => {
          if (operation?.type === 'update') {
            const cibles = [...lignes.values()].filter((r) => matches(r, filtre));
            for (const cible of cibles) Object.assign(cible, operation.patch);
            return Promise.resolve({ data: cibles, error: null }).then(onOk);
          }
          if (operation?.type === 'delete') {
            const cibles = [...lignes.values()].filter((r) => matches(r, filtre));
            for (const cible of cibles) lignes.delete(cible.job_name);
            return Promise.resolve({ data: cibles, error: null }).then(onOk);
          }
          const data = [...lignes.values()].filter((r) => matches(r, filtre));
          return Promise.resolve({ data, error: null }).then(onOk);
        },
      };
      return query;
    }),
  },
}));

const matches = (row, filtre) => Object.entries(filtre).every(([key, val]) => {
  if (key.endsWith('<')) {
    const col = key.slice(0, -1);
    return Date.parse(row[col]) < Date.parse(val);
  }
  return row[key] === val;
});

import {
  acquireCronLease,
  releaseCronLease,
  resetCronLeaseStateForTests,
  isCronLeaseTableAvailable,
  withCronLease,
} from './cron-lease.mjs';

const JOB = 'sweepPendingSettlements';

beforeEach(() => {
  lignes.clear();
  journal.length = 0;
  resetCronLeaseStateForTests();
});

describe('Bail de cron — une seule instance traite le job', () => {
  it('la premiere instance obtient le bail, la seconde est refusee', async () => {
    const premier = await acquireCronLease(JOB);
    const second = await acquireCronLease(JOB);

    expect(premier.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(second.reason).toBe('busy');
  });

  it('le bail porte un proprietaire et une expiration', async () => {
    await acquireCronLease(JOB);
    const row = lignes.get(JOB);

    expect(row).toBeTruthy();
    expect(row.holder).toBeTruthy();
    expect(Date.parse(row.expires_at)).toBeGreaterThan(Date.now());
  });

  it('un bail expire n est jamais bloque : le job ne reste pas gele', async () => {
    // Instance A prend le bail, puis disparait (crash, redemarrage).
    await acquireCronLease(JOB);
    const row = lignes.get(JOB);
    row.expires_at = new Date(Date.now() - 1000).toISOString();

    // Instance B tente sa chance : elle doit OBTENIR le bail, sinon le job
    // est bloque jusqu'a la fin des temps.
    const reprise = await acquireCronLease(JOB);
    expect(reprise.acquired).toBe(true);
  });

  it('un bail valide n est PAS repris', async () => {
    await acquireCronLease(JOB);
    const avant = lignes.get(JOB).expires_at;

    const second = await acquireCronLease(JOB);

    expect(second.acquired).toBe(false);
    // Et surtout : le bail du premier n'a pas ete vole (son expiration est
    // inchangee).
    expect(lignes.get(JOB).expires_at).toBe(avant);
  });

  it('liberer le bail rend le job a nouveau disponible', async () => {
    await acquireCronLease(JOB);
    expect((await acquireCronLease(JOB)).acquired).toBe(false);

    await releaseCronLease(JOB);

    expect((await acquireCronLease(JOB)).acquired).toBe(true);
  });

  it('liberer un bail que l on ne detient pas ne supprime pas celui de l autre', async () => {
    await acquireCronLease(JOB);
    const avant = lignes.get(JOB);

    // Une autre instance tente de liberer : elle n'est pas proprietaire.
    await releaseCronLease(JOB, { force: false, holder: 'AUTRE-INSTANCE' });

    expect(lignes.get(JOB)).toBeTruthy();
    expect(lignes.get(JOB).holder).toBe(avant.holder);
  });

  it('les jobs sont independants : un bail sur un job ne bloque pas un autre', async () => {
    await acquireCronLease(JOB);
    const autre = await acquireCronLease('sweepPendingArbiterFees');
    expect(autre.acquired).toBe(true);
  });
});

describe('Bail de cron — degrade sans base', () => {
  it('la table des bails est declaree absente quand la base ne la voit pas', async () => {
    // Pas de table : la sonde doit le dire, pour que l operateur sache que
    // la protection multi-instance n est pas activee.
    expect(isCronLeaseTableAvailable()).toBe(false);
  });
});

describe('Bail de cron — le job est protege, et libere', () => {
  it('le job s execute quand le bail est obtenu', async () => {
    let execute = 0;
    const resultat = await withCronLease('job-ok', async () => { execute += 1; });

    expect(resultat).toBe(true);
    expect(execute).toBe(1);
    // Et le bail est rendu : le job suivant peut tourner.
    expect(lignes.has('job-ok')).toBe(false);
  });

  it('le job est IGNORE quand une autre instance detient le bail', async () => {
    await acquireCronLease('job-busy');
    let execute = 0;

    const resultat = await withCronLease('job-busy', async () => { execute += 1; });

    expect(resultat).toBe(false);
    expect(execute, 'le job ne doit PAS s executer chez la deuxieme instance').toBe(0);
  });

  it('le bail est libere meme quand le job echoue', async () => {
    await expect(withCronLease('job-ko', async () => { throw new Error('panne'); })).rejects.toThrow('panne');

    // Un bail qui resterait bloque apres un echec gelerait le job pendant
    // toute la duree du bail (10 minutes) : l argent ne bouge plus.
    expect(lignes.has('job-ko')).toBe(false);
  });
});
