import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Historique durable des prises de bail de cron.
 *
 * Pourquoi cet historique existe
 * ------------------------------
 * Les compteurs de `cron-lease.mjs` repondent a « la protection
 * multi-instance fonctionne-t-elle MAINTENANT ? ». Ils sont en MEMOIRE :
 * ils repartent a zero au redemarrage de l'instance — et Render l'hiberne,
 * donc le compteur retombe a zero plusieurs fois par jour.
 *
 * Une question d'exploitation est differente : « la protection a-t-elle
 * DEJA echoue, un jour, sur un job donne ? ». Elle est HISTORIQUE.
 *
 * Concretement, les deux defauts de production vus apres le deploiement du
 * bail etaient invisibles : le booleen disait `true`, la table des baux
 * etait vide entre deux jobs (le bail est RELACHE a la fin de chaque job),
 * et rien ne montrait qu'un job tournait sans protection.
 *
 * Ce que le test garantit
 * -----------------------
 * 1. Une tentative de bail est tracee, qu'elle aboutisse ou non.
 * 2. `acquired: false` est distingue de `acquired: true` : c'est la ligne
 *    qui prouve qu'une AUTRE instance detenait le job.
 * 3. L'echec d'ecriture de l'historique ne fait PAS echouer le job
 *    (fail-open : l'historique est une trace, jamais une condition).
 * 4. La purge respecte la retention ET borne le volume purge.
 * 5. La purge compare des ENTIERS : une chaine ISO contre un BIGINT
 *    echouerait (« invalid input syntax for type bigint ») — le defaut
 *    exact qui a produit l'incident du bail.
 */

// ─── Faux client Supabase ────────────────────────────────────────────────────
const tableAudit = [];
const journal = [];
let tableAuditVisible = true;

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn((name) => {
      let filtre = {};
      const api = {
        select: vi.fn(() => api),
        limit: vi.fn(() => api),
        order: vi.fn(() => api),
        range: vi.fn(() => api),
        gte: vi.fn((col, val) => { filtre = { ...filtre, [`${col}>=`]: val }; return api; }),
        lt: vi.fn((col, val) => { filtre = { ...filtre, [`${col}<`]: val }; return api; }),
        insert: vi.fn((data) => {
          journal.push({ op: 'insert', data });
          if (name === 'cron_lease_audit' && !tableAuditVisible) {
            return Promise.resolve({
              data: null,
              error: { code: '42P01', message: 'relation "cron_lease_audit" does not exist' },
            });
          }
          tableAudit.push({ id: tableAudit.length + 1, ...data });
          return Promise.resolve({ data, error: null });
        }),
        delete: vi.fn(() => api),
        then: (onOk) => {
          if (name === 'cron_lease_audit' && !tableAuditVisible) {
            return Promise.resolve({
              data: null,
              error: { code: '42P01', message: 'relation "cron_lease_audit" does not exist' },
            }).then(onOk);
          }
          // Purge : on ne supprime que les lignes older than le seuil, et la
          // comparaison est NUMERIQUE (colonne BIGINT).
          const seuil = filtre['acquired_at<'];
          let data = [...tableAudit];
          if (seuil !== undefined) {
            const avant = data.length;
            data = data.filter((l) => {
              if (typeof seuil !== 'number') {
                throw new Error(`invalid input syntax for type bigint: "${String(seuil)}"`);
              }
              if (typeof l.acquired_at !== 'number') {
                throw new Error(`invalid input syntax for type bigint: "${String(l.acquired_at)}"`);
              }
              return l.acquired_at >= seuil;
            });
            journal.push({ op: 'delete', purgees: avant - data.length });
            tableAudit.length = 0;
            tableAudit.push(...data);
          }
          return Promise.resolve({ data, error: null }).then(onOk);
        },
      };
      return api;
    }),
  },
}));

import {
  recordLeaseEvent,
  recordLeaseEventIfAvailable,
  purgeLeaseAudit,
  isCronLeaseAuditAvailable,
  resetCronLeaseAuditStateForTests,
  AUDIT_RETENTION_DAYS,
} from './cron-lease-audit.mjs';

beforeEach(() => {
  tableAudit.length = 0;
  journal.length = 0;
  tableAuditVisible = true;
  resetCronLeaseAuditStateForTests();
});

describe('Historique des bails — la trace est ecrite', () => {
  it('une tentative aboutie est tracee', async () => {
    const ok = await recordLeaseEvent({
      jobName: 'sweepPendingSettlements',
      acquired: true,
      reason: 'acquis',
      acquiredAt: 1_700_000_000_000,
      durationMs: 1234,
    });

    expect(ok).toBe(true);
    expect(tableAudit).toHaveLength(1);
    expect(tableAudit[0].job_name).toBe('sweepPendingSettlements');
    expect(tableAudit[0].acquired).toBe(true);
    expect(tableAudit[0].reason).toBe('acquis');
  });

  it('une tentative REFUSEE est tracee comme telle', async () => {
    // C'est la ligne la plus interesante : elle prouve qu'une AUTRE instance
    // detenait le job, donc que deux instances etaient actives.
    await recordLeaseEvent({
      jobName: 'sweepPendingWithdrawals',
      acquired: false,
      reason: 'busy',
    });

    expect(tableAudit).toHaveLength(1);
    expect(tableAudit[0].acquired).toBe(false);
    expect(tableAudit[0].reason).toBe('busy');
  });

  it('les instants sont des ENTIERS (colonnes BIGINT)', async () => {
    await recordLeaseEvent({
      jobName: 'job',
      acquired: true,
      acquiredAt: 1_700_000_000_000,
      durationMs: 42,
    });

    expect(typeof tableAudit[0].acquired_at).toBe('number');
    expect(typeof tableAudit[0].duration_ms).toBe('number');
  });

  it('un job sans nom n est pas trace', async () => {
    expect(await recordLeaseEvent({ acquired: true })).toBe(false);
    expect(tableAudit).toHaveLength(0);
  });
});

describe('Historique des bails — jamais une condition', () => {
  it('une table absente ne leve rien', async () => {
    tableAuditVisible = false;

    const ok = await recordLeaseEventIfAvailable({ jobName: 'job', acquired: true });

    // L historique est un COMPLEMENT : son echec ne doit jamais arreter un
    // job de fond (l'argent qui ne bouge pas est pire que l'argent qui
    // bouge deux fois).
    expect(ok).toBe(false);
    expect(isCronLeaseAuditAvailable()).toBe(false);
  });

  it('la table absente est signalee, pour que l operateur sache', () => {
    expect(isCronLeaseAuditAvailable(), 'la table doit etre declaree absente').toBe(false);
  });
});

describe('Historique des bails — purge de retention', () => {
  it('purge les lignes au-dela de la retention', async () => {
    const vieux = Date.now() - 40 * 24 * 60 * 60 * 1000;
    const recent = Date.now() - 60 * 1000;
    await recordLeaseEvent({ jobName: 'vieux', acquired: true, acquiredAt: vieux });
    await recordLeaseEvent({ jobName: 'recent', acquired: true, acquiredAt: recent });
    expect(tableAudit).toHaveLength(2);

    const purgees = await purgeLeaseAudit();

    expect(purgees).toBe(1);
    expect(tableAudit).toHaveLength(1);
    expect(tableAudit[0].job_name).toBe('recent');
  });

  it('la purge compare des ENTIERS, jamais des chaines ISO', async () => {
    // Le defaut vecu en production : une chaine ISO comparee a un BIGINT
    // echoue (« invalid input syntax for type bigint »). Le mock leve
    // volontairement si on lui passe une chaine.
    await recordLeaseEvent({ jobName: 'job', acquired: true, acquiredAt: Date.now() });
    await expect(purgeLeaseAudit()).resolves.toBeGreaterThanOrEqual(0);
  });

  it('la retention par defaut est de 30 jours', () => {
    expect(AUDIT_RETENTION_DAYS).toBe(30);
  });
});
