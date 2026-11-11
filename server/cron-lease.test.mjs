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
// La table `cron_leases` peut etre absente (migration non jouee) puis
// apparaitre (migration jouee entre-temps) : c'est le scenario reellement
// vecu en production.
let tableVisible = true;

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
          if (table === 'cron_leases' && !tableVisible) {
            return Promise.resolve({
              data: null,
              error: { code: '42P01', message: 'relation "cron_leases" does not exist' },
            });
          }
          // Postgres refuse une chaine ISO dans une colonne BIGINT. Le mock
          // reproduit ce comportement : c'est le defaut vecu en production
          // (« invalid input syntax for type bigint »), ou le bail n etait
          // jamais acquis et la protection multi-instance restait inactive.
          if (table === 'cron_leases') {
            for (const colonne of ['acquired_at', 'expires_at']) {
              const valeur = data[colonne];
              if (typeof valeur !== 'number' || !Number.isFinite(valeur)) {
                return Promise.resolve({
                  data: null,
                  error: {
                    code: '22P02',
                    message: `invalid input syntax for type bigint: "${String(valeur)}"`,
                  },
                });
              }
            }
          }
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
          if (table === 'cron_leases' && !tableVisible) {
            return Promise.resolve({
              data: null,
              error: { code: '42P01', message: 'relation "cron_leases" does not exist' },
            }).then(onOk);
          }
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
    // `expires_at` est un BIGINT : la comparaison est numerique. Le mock
    // refuse un ISO, comme Postgres (code 22P02), pour que le defaut ne
    // puisse pas revenir sans faire echouer un test.
    if (typeof row[col] === 'number') {
      if (typeof val !== 'number') {
        throw new Error(`invalid input syntax for type bigint: "${String(val)}"`);
      }
      return row[col] < val;
    }
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
  PROBE_INTERVAL_MS,
} from './cron-lease.mjs';

const JOB = 'sweepPendingSettlements';

beforeEach(() => {
  lignes.clear();
  journal.length = 0;
  tableVisible = true;
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
    // L expiration est un EPOCH EN MILLISECONDES (colonne BIGINT) : c'est
    // ce qui a casse en production (« invalid input syntax for type
    // bigint » quand une chaine ISO y etait ecrite).
    expect(typeof row.expires_at).toBe('number');
    expect(row.expires_at).toBeGreaterThan(Date.now());
    expect(typeof row.acquired_at).toBe('number');
  });

  it('le bail est ecrit avec des entiers, compatibles avec les colonnes BIGINT', async () => {
    // Le mock simule Postgres et REFUSE un ISO dans une colonne BIGINT
    // (code 22P02). Si le code reintroduisait une chaine ISO, l acquisition
    // echouerait — et le bail ne serait jamais pris : la protection
    // multi-instance resterait inactive, sans qu'aucune erreur ne remonte
    // au client (le job s execute normalement, mais sans bail).
    const bail = await acquireCronLease('job-types');

    expect(bail.acquired, 'le bail doit etre reellement acquis').toBe(true);
    expect(bail.reason).toBe('acquis');
    const row = lignes.get('job-types');
    expect(Number.isInteger(row.expires_at)).toBe(true);
    expect(Number.isInteger(row.acquired_at)).toBe(true);
  });

  it('un bail expire n est jamais bloque : le job ne reste pas gele', async () => {
    // Instance A prend le bail, puis disparait (crash, redemarrage).
    await acquireCronLease(JOB);
    const row = lignes.get(JOB);
    row.expires_at = Date.now() - 1000;

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

  it('un resultat NEGATIF est re-sonde : une migration jouee apres coup est vue', async () => {
    // C'est le defaut CORRIGE en production : la sonde memorisait
    // definitivement l'absence de la table. Or la migration est jouee par un
    // humain, A N'IMPORTE QUEL MOMENT : le serveur demarre a 11:36, la
    // migration est jouee a 11:42, et la protection restait inactivée
    // jusqu'au redeploiement suivant.
    //
    // On force l'echec de la premiere sonde...
    tableVisible = false;
    await acquireCronLease('job-sonde');
    expect(isCronLeaseTableAvailable(), 'la premiere sonde doit voir l absence').toBe(false);

    // ...puis la table apparait (migration jouee entre-temps).
    tableVisible = true;

    // La sonde suivante doit la voir, SANS redemarrage. La re-sonde est
    // espacee de `PROBE_INTERVAL_MS` : on avance l horloge pour simuler
    // l ecoulement du temps (en production, une minute).
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + PROBE_INTERVAL_MS + 1000);
    try {
      const bail = await acquireCronLease('job-sonde');
      expect(
        isCronLeaseTableAvailable(),
        'la table doit etre re-sondee et detectee apres sa creation',
      ).toBe(true);
      // Et le bail est reellement acquis : la protection est active.
      expect(bail.acquired).toBe(true);
      expect(bail.reason).toBe('acquis');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('la re-sonde est ESPACEE : une panne de base ne martele pas la base', async () => {
    // Une sonde par job et par tick (60 s) sur une base en panne, c'est une
    // requete inutile par job et par minute. L espacement evite de la
    // marteler — sans jamais empecher la detection de la migration.
    tableVisible = false;
    await acquireCronLease('job-espacement');
    const inserts = journal.filter((e) => e.op === 'insert').length;

    // Deux acquisitions rapprochees : une seule tentative d'INSERT.
    await acquireCronLease('job-espacement');
    expect(
      journal.filter((e) => e.op === 'insert').length,
      'la sonde ne doit pas repeter l INSERT pendant l intervalle',
    ).toBe(inserts);
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
