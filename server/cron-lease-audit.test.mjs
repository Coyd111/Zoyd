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
        // PIEGE : PostgREST refuse un `LIMIT` sur un `DELETE ... RETURNING`.
        // L'erreur est « syntax error at or near "limit" » (code 42601) :
        // c'est elle qui faisait echouer la purge EN SILENCE, en production.
        limit: vi.fn(() => {
          if (api._supprime) api._limitApresDelete = true;
          return api;
        }),
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
        delete: vi.fn(() => { api._supprime = true; return api; }),
        then: (onOk) => {
          if (name === 'cron_lease_audit' && !tableAuditVisible) {
            return Promise.resolve({
              data: null,
              error: { code: '42P01', message: 'relation "cron_lease_audit" does not exist' },
            }).then(onOk);
          }
          // Un `limit()` apres un `delete()` : la requete est invalide.
          // PostgreSQL ne supprime RIEN et renvoie l'erreur 42601.
          if (api._limitApresDelete) {
            journal.push({ op: 'delete', erreur: '42601', purgees: 0 });
            return Promise.resolve({
              data: null,
              error: { code: '42601', message: 'syntax error at or near "limit"' },
            }).then(onOk);
          }
          // Purge : on ne supprime que les lignes ANCIENNES que le seuil,
          // et la comparaison est NUMERIQUE (colonne BIGINT).
          const seuil = filtre['acquired_at<'];
          if (seuil !== undefined) {
            const avant = tableAudit.length;
            const supprimees = [];
            const restantes = [];
            for (const l of tableAudit) {
              if (typeof seuil !== 'number') {
                throw new Error(`invalid input syntax for type bigint: "${String(seuil)}"`);
              }
              if (typeof l.acquired_at !== 'number') {
                throw new Error(`invalid input syntax for type bigint: "${String(l.acquired_at)}"`);
              }
              if (l.acquired_at < seuil) supprimees.push(l);
              else restantes.push(l);
            }
            journal.push({ op: 'delete', purgees: supprimees.length });
            tableAudit.length = 0;
            tableAudit.push(...restantes);
            // `RETURNING id` : PostgREST renvoie les lignes SUPPRIMEES.
            return Promise.resolve({ data: supprimees, error: null }).then(onOk);
          }
          return Promise.resolve({ data: [], error: null }).then(onOk);
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
  getCronLeaseAuditHealth,
  getCronLeaseAuditPurgeHealth,
  resetCronLeaseAuditStateForTests,
  AUDIT_RETENTION_DAYS,
  AUDIT_PROBE_INTERVAL_MS,
  TRACE_INTERVAL_MS,
} from './cron-lease-audit.mjs';

// Le faux client Supabase, pour verifier directement le comportement du
// DELETE (et non seulement celui de la purge).
import { supabase } from './supabase.mjs';

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
    // L etat est expose pour `/api/health` : c est ce qui permet de
    // verifier la migration sans connexion SQL.
    expect(getCronLeaseAuditHealth().available).toBe(false);
  });
});

describe('Historique des bails — la sonde se rejoue', () => {
  it('une table absente puis creee est detectee SANS redemarrage', async () => {
    // C est le defaut CORRIGE : la sonde memorisait DEFINITIVEMENT son
    // resultat negatif. La migration d historique est jouee par un humain,
    // A N IMPORTE QUEL MOMENT : le serveur demarre avant, sonde une fois
    // l absence, et ne voyait jamais la table apparaitre — l historique
    // restait donc inactif jusqu au redeploiement suivant.
    tableAuditVisible = false;
    await recordLeaseEventIfAvailable({ jobName: 'job-sonde', acquired: true });
    expect(isCronLeaseAuditAvailable(), 'la premiere sonde doit voir l absence').toBe(false);

    // La table apparait (migration jouee entre-temps).
    tableAuditVisible = true;

    // La sonde suivante doit la voir : on avance l horloge pour simuler
    // l ecoulement du temps (en production, une minute).
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + AUDIT_PROBE_INTERVAL_MS + 1000);
    try {
      const ecrit = await recordLeaseEventIfAvailable({ jobName: 'job-sonde', acquired: true });
      expect(
        isCronLeaseAuditAvailable(),
        'la table doit etre re-sondee et detectee apres sa creation',
      ).toBe(true);
      expect(ecrit, 'l historique doit etre ecrit').toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('la sonde est ESPACEE : une base en panne ne martele pas la base', async () => {
    tableAuditVisible = false;
    await recordLeaseEventIfAvailable({ jobName: 'job-1', acquired: true });
    const sondes = journal.filter((e) => e.op === 'insert').length;

    await recordLeaseEventIfAvailable({ jobName: 'job-2', acquired: true });
    expect(
      journal.filter((e) => e.op === 'insert').length,
      'la sonde ne doit pas repeter l INSERT pendant l intervalle',
    ).toBe(sondes);
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

describe('Historique des bails — la purge est REELLEMENT operationnelle', () => {
  it('la purge SUPPRIME les lignes anciennes (aucun LIMIT sur le DELETE)', async () => {
    // Le defaut CORRIGE : `DELETE ... RETURNING id LIMIT n` est INVALIDE en
    // SQL (erreur 42601, « syntax error at or near "limit" »). La purge
    // echouait donc en silence, la table grossissait de ~4 300 lignes par
    // jour sans borne, et RIEN ne le signalait.
    const vieux = Date.now() - 40 * 24 * 60 * 60 * 1000;
    await recordLeaseEvent({ jobName: 'vieux', acquired: true, acquiredAt: vieux });
    expect(tableAudit).toHaveLength(1);

    const purgees = await purgeLeaseAudit();

    expect(purgees, 'la purge doit avoir supprime la ligne ancienne').toBe(1);
    expect(tableAudit, 'la ligne ancienne doit etre partie de la base').toHaveLength(0);
    expect(
      journal.filter((e) => e.op === 'delete' && e.erreur),
      'aucune requete DELETE invalide ne doit avoir ete envoyee',
    ).toHaveLength(0);
  });

  it('un LIMIT sur le DELETE est refuse par PostgreSQL : le piege, reproduit', async () => {
    // Ce test verrouille le FAUX CLIENT, pas le code de production : il
    // documente la raison pour laquelle un `.limit()` ne doit jamais
    // revenir sur ce DELETE. Si le faux client cessait de refuser, le test
    // d au dessus ne protegerait plus de rien.
    await recordLeaseEvent({
      jobName: 'vieux',
      acquired: true,
      acquiredAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
    });

    const { error, data } = await supabase
      .from('cron_lease_audit')
      .delete()
      .lt('acquired_at', Date.now())
      .select('id')
      .limit(500);

    expect(error, 'un LIMIT sur un DELETE doit etre refuse').not.toBeNull();
    expect(error.code).toBe('42601');
    expect(data).toBeNull();
    expect(tableAudit, 'rien ne doit avoir ete supprime').toHaveLength(1);
  });
});

describe('Historique des bails — le volume est dedplique', () => {
  const T0 = 1_700_000_000_000;

  it('une trace NORMALE par job et par heure', async () => {
    // Sans deduplication, les jobs de fond (toutes les minutes) produisaient
    // ~4 300 lignes par JOUR (mesure en production). A 30 jours de retention
    // : ~130 000 lignes, pour une trace de diagnostic.
    await recordLeaseEvent({ jobName: 'job-a', acquired: true, reason: 'acquis', acquiredAt: T0 });
    await recordLeaseEvent({ jobName: 'job-a', acquired: true, reason: 'acquis', acquiredAt: T0 + 60_000 });
    await recordLeaseEvent({ jobName: 'job-a', acquired: true, reason: 'acquis', acquiredAt: T0 + 120_000 });

    expect(tableAudit).toHaveLength(1);
  });

  it('au-dela d une heure, la trace normale est reecrite', async () => {
    await recordLeaseEvent({ jobName: 'job-a', acquired: true, reason: 'acquis', acquiredAt: T0 });
    await recordLeaseEvent({
      jobName: 'job-a',
      acquired: true,
      reason: 'acquis',
      acquiredAt: T0 + TRACE_INTERVAL_MS + 1_000,
    });

    expect(tableAudit).toHaveLength(2);
  });

  it('chaque job a sa propre trace', async () => {
    await recordLeaseEvent({ jobName: 'job-a', acquired: true, reason: 'acquis', acquiredAt: T0 });
    await recordLeaseEvent({ jobName: 'job-b', acquired: true, reason: 'acquis', acquiredAt: T0 });

    expect(tableAudit).toHaveLength(2);
  });

  it('un REFUS de bail est TOUJOURS ecrit (c est l evenement qu on cherche)', async () => {
    // Une autre instance detenait le job : c'est un evenement
    // d'exploitation, pas du bruit. Il doit etre exhaustif.
    await recordLeaseEvent({ jobName: 'job-a', acquired: false, reason: 'busy', acquiredAt: T0 });
    await recordLeaseEvent({ jobName: 'job-a', acquired: false, reason: 'busy', acquiredAt: T0 + 60_000 });
    await recordLeaseEvent({ jobName: 'job-a', acquired: false, reason: 'busy', acquiredAt: T0 + 120_000 });

    expect(tableAudit).toHaveLength(3);
  });

  it('un job execute SANS protection est TOUJOURS trace', async () => {
    // `table-absente` = le job a tourne sans bail multi-instance. C est
    // exactement le defaut qu on veut voir dans l historique.
    await recordLeaseEvent({ jobName: 'job-a', acquired: true, reason: 'table-absente', acquiredAt: T0 });
    await recordLeaseEvent({ jobName: 'job-a', acquired: true, reason: 'table-absente', acquiredAt: T0 + 60_000 });

    expect(tableAudit).toHaveLength(2);
  });

  it('une ERREUR de base est TOUJOURS tracee', async () => {
    await recordLeaseEvent({ jobName: 'job-a', acquired: true, reason: 'erreur-base', acquiredAt: T0 });
    await recordLeaseEvent({ jobName: 'job-a', acquired: true, reason: 'erreur-base', acquiredAt: T0 + 60_000 });

    expect(tableAudit).toHaveLength(2);
  });
});

describe('Historique des bails — l etat de la purge est PUBLIE', () => {
  it('une purge reussie est horodatee et sans erreur', async () => {
    expect(getCronLeaseAuditPurgeHealth().dernierSuccesAt).toBeNull();

    await purgeLeaseAudit();

    const sante = getCronLeaseAuditPurgeHealth();
    expect(sante.dernierSuccesAt, 'la purge doit etre horodatee').not.toBeNull();
    expect(sante.derniereErreur).toBeNull();
    expect(sante.retentionDays).toBe(AUDIT_RETENTION_DAYS);
  });

  it('une purge qui ECHOUE est VISIBLE (plus d echec silencieux)', async () => {
    // Le defaut vecu : la purge echouait (LIMIT invalide) et rien ne le
    // signalait. L operateur ne pouvait pas le voir. L etat de purge est
    // expose dans `/api/health` pour que l echec soit visible.
    tableAuditVisible = false;

    await purgeLeaseAudit();

    const sante = getCronLeaseAuditPurgeHealth();
    expect(sante.derniereErreur, 'l echec de purge doit etre publie').toBeTruthy();
  });
});
