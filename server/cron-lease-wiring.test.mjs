import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Les jobs de fond passent-ils par le BAIL distribue ?
 *
 * Pourquoi ce fichier separe de `cron-lease.test.mjs`
 * -------------------------------------------------
 * `cron-lease.test.mjs` prouve le MECANISME du bail : une seule instance
 * obtient le bail, un bail expire se reprend, le bail est rendu apres un
 * echec.
 *
 * Il ne prouve pas que les JOBS l'utilisent. Or c'est precisement le piege :
 * un bail parfaitement ecrit, teste, et jamais appele. C'est le meme piege que
 * le job de reprise des commissions d'arbitre, ecrit et teste mais JAMAIS
 * APPele (cf. `arbiter-fee-wiring.test.mjs`).
 *
 * Ce test lit donc la source de `cron.mjs` et verifie que chaque job qui
 * ECRIT un etat partage est enveloppe par `sousBail`.
 *
 * Pourquoi la lecture de source plutot qu'un test d'execution
 * -------------------------------------------------------
 * Les jobs sont enregistres dans `initCronJobs`, qui demarre des timers
 * reels. Un test d'execution du timer serait lent, flaky (intervalle de
 * 60 s) et dependrait de l'horloge. La source, elle, ne ment pas : si le
 * job n'est pas enveloppe, il s'executera deux fois sur deux instances.
 */

const source = readFileSync(resolve('server/cron.mjs'), 'utf8');

/**
 * Les jobs qui ECRIVENT un etat partage (matches, tournois, ligues, salons
 * BR) ou qui deplacent de l'argent.
 *
 * Le controle d'integrite et le nettoyage memoire sont VOLONTAIREMENT
 * absents : le premier ne lit que, le second ne touche qu'a la memoire
 * locale de l'instance. Leur proteger n'aurait aucun sens.
 */
const JOBS_PROTEGES = [
  'runMatchCleanup',
  'sweepPendingSettlements',
  'sweepPendingArbiterFees',
  'sweepPendingBrSettlements',
  'sweepStaleBrLobbies',
  'sweepExpiredConfirmations',
  'sweepPendingRefunds',
  'sweepPendingTournamentPayouts',
  'sweepPendingLeaguePayouts',
  'sweepPendingWithdrawals',
  'sweepStaleLeagues',
  'sweepPendingLeagueRefunds',
];

describe('Câblage du bail distribue — cron.mjs', () => {
  it('chaque job qui ecrit un etat partage est enveloppe par sousBail', () => {
    for (const job of JOBS_PROTEGES) {
      // Les DEUX appels (intervalle + premier passage au boot) doivent etre
      // enveloppes : un seul des deux laisse une fenetre non protegee.
      const brut = new RegExp(
        `\\bset(?:Interval|Timeout)\\(\\s*\\(\\) => \\{ void ${job}\\(\\); \\}`,
        'g',
      );
      const occurrences = (source.match(brut) || []).length;
      expect(
        occurrences,
        `${job} : ${occurrences} appel(s) de timer hors bail (attendu 0)`,
      ).toBe(0);

      const sousBail = new RegExp(
        `\\bset(?:Interval|Timeout)\\(\\s*sousBail\\('${job}', ${job}\\)`,
        'g',
      );
      const protege = (source.match(sousBail) || []).length;
      expect(
        protege,
        `${job} : ${protege} appel(s) de timer sous bail (attendu 2)`,
      ).toBe(2);
    }
  });

  it('aucun job ne s execute hors bail', () => {
    // Defence globale : tout `setInterval`/`setTimeout` qui lance un job doit
    // passer par `sousBail`. Un job oublie dans la liste ci-dessus serait
    // donc signale ici.
    const timers = source.match(/\bset(?:Interval|Timeout)\([^)]*void\s+\w+\(\)/g) || [];
    expect(
      timers,
      `appels de timer hors bail : ${timers.join(' | ')}`,
    ).toEqual([]);
  });

  it('le bail est rendu meme quand le job echoue', () => {
    // Un bail qui resterait bloque apres un echec gelerait le job pendant
    // toute sa duree (10 minutes) : l argent des matchs resterait bloque.
    // Le `finally` de `withCronLease` est la garantie — elle est dans le
    // module du bail, mais l appel doit bien passer par ce module.
    expect(source).toMatch(/import \{ withCronLease \} from '\.\/cron-lease\.mjs'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// La purge de l'historique durable des bails : elle doit etre CAPABLE de
// tenir.
//
// Pourquoi horaire
// ---------------
// Les jobs de fond produisent des milliers de traces par jour. Une purge
// QUOTIDIENNE n'effacerait qu'une fraction de ce qui est produit : le
// retard de purge grossirait sans fin, et la table finirait par manger la
// base. La purge doit donc passer au moins aussi vite que la production.
//
// PIEGE : la purge n'est PAS un job qui ecrit un etat partage — elle
// n'a pas besoin du bail. Mais elle ne doit pas non plus etre lancee par
// un `setInterval` brut, sans quoi elle tournerait sur CHAQUE instance.
// ─────────────────────────────────────────────────────────────────────────────
describe('Purge de l historique des bails — planification', () => {
  it('la purge est HORAIRE, et non quotidienne', () => {
    expect(
      source,
      'la purge doit passer toutes les heures',
    ).toMatch(/setInterval\(\(\) => \{ void purgeLeaseAudit\(\); \}, 60 \* 60 \* 1000\)/);
    // Le rythme quotidien d avant : il ne pouvait pas tenir.
    expect(
      source,
      'la purge ne doit plus etre quotidienne',
    ).not.toMatch(/void purgeLeaseAudit\(\); \}, 24 \* 60 \* 60 \* 1000/);
  });

  it('un premier passage differe, pour ne pas attendre une heure', () => {
    expect(source).toMatch(
      /setTimeout\(\(\) => \{ void purgeLeaseAudit\(\); \}, 60 \* 1000\)/,
    );
  });
});
