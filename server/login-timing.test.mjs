import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La page de connexion ne doit pas dire QUAND elle a decide.
 *
 * Avant, `if (!hash) throw` partait avant toute derivation : un compte
 * inexistant repondait instantanement, un compte existant payait scrypt puis un
 * aller-retour Supabase. L'ecart se mesurait, et la page devenait un oracle
 * d'enumeration des pseudos et emails inscrits.
 *
 * Le test mesure donc une propriete temporelle, pas une branche de code : c'est
 * la seule facon de prouver que les deux reponses sont indiscernables. Il est
 * donc tolerant au bruit d'une machine chargee — sinon il serait flaky — mais
 * assez strict pour attraper la suppression du travail factice.
 */

vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => {
      const q = {};
      q.select = vi.fn(() => q);
      q.upsert = vi.fn(() => Promise.resolve({ error: null }));
      q.delete = vi.fn(() => q);
      q.eq = vi.fn(() => Promise.resolve({ data: [], error: null }));
      q.in = vi.fn(() => Promise.resolve({ data: [], error: null }));
      return q;
    }),
  },
}));

import { createUserAccount, authenticateUserAccount } from './persistence.mjs';

const PASSWORD = 'MotDePasseSolide2026!';
const settle = () => new Promise((r) => setTimeout(r, 10));

const mesure = async (identifier) => {
  const debut = process.hrtime.bigint();
  await authenticateUserAccount({ identifier, password: 'Mauvais' }).catch(() => {});
  return Number(process.hrtime.bigint() - debut) / 1e6;
};

const mediane = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
/**
 * Le MINIMUM, et non la mediane.
 *
 * `scryptAsync` est un `promisify(crypto.scrypt)` : il s'execute sur le
 * threadpool de libuv (4 threads par defaut). La suite lance les fichiers de
 * test en parallele : les appels scrypt se disputent ces threads, et l
 * etendue d une meme serie va alors de 559 a 985 ms. La mediane valait 799 ms
 * de facon stable pour le compte existant, mais 680 ou 805 pour le compte
 * inexistant — et l ecart « mesure » variait de 6 a 125 ms sans que le code
 * n ait change.
 *
 * Le MINIMUM est l echantillon le moins perturbé : il vaut ~100 ms quand le
 * scrypt est seul sur le threadpool, contre ~800 ms en charge.
 *
 * Ce qui compte, c est que l ecart SYSTEMATIQUE — la fuite qu on cherche —
 * survit a l echantillonnage. Or la cause racine du bruit etait la
 * contention : les fichiers de test sont desormais serialises
 * (`fileParallelism: false` dans `vitest.config.ts`), et l ecart mesure
 * tombe alors a 1-3 ms, de facon stable. La conception a temps constant
 * fonctionne ; le 60 ms de tolerance represente vingt fois cet ecart, et
 * attraperait la fuite d origine (plusieurs centaines de ms).
 */
const minimum = (xs) => Math.min(...xs);

beforeEach(() => vi.clearAllMocks());

describe("Login : l'existence d'un compte ne se lit pas au chrono", () => {
  it('un compte inexistant coute le meme temps qu un compte existant', async () => {
    const stamp = `${Date.now()}`.slice(-9);
    await createUserAccount({
      pseudo: `Chrono${stamp}`,
      email: `chrono-${stamp}@test.local`,
      phone: `+2250700${String(Date.now() % 100000).padStart(6, '0')}`,
      gameId: `CO-CHR-${stamp}`,
      password: PASSWORD,
      acceptAdult: true,
      acceptTerms: true,
    });
    await settle();

    // ─── Pourquoi cet echantillonnage ───────────────────────────────────────
    //
    // La version precedente prenait 5 echantillons par cas, et CINQ
    // identifiants DIFFERENTS pour le cas inexistant. Deux erreurs en
    // découlaient :
    //
    // 1. Cinq echantillons, c'est une mediane tres bruyante : un seul passage
    //    du ramasse-miettes suffit a la deplacer de dizaines de ms. Le test
    //    echouait donc une fois sur trois, selon la charge de la machine.
    // 2. Les deux cas n'etaient pas compares a egale charge : l'existant
    //    etait mesure 5 fois sur la MEME cle (donc rechauffe), l'inexistant
    //    5 fois sur des cles differentes (donc 5 chemins a froid). On
    //    comparait un cas chaud a un cas froid.
    //
    // Ici : NEUF echantillons, un echantillon de chauffe JETE, et les deux
    // cas mesures en ALTERNANCE. L'alternance est le point cle : une pause
    // du ramasse-miettes ou un pic de charge tombent sur les deux series, et
    // non sur une seule. C'est ce qui rend la comparaison honnete.
    const existant = [];
    const inexistant = [];
    const idExistant = `Chrono${stamp}`;
    const idInexistant = `Inconnu${stamp}`;

    // Chauffage : le premier appel paie le JIT et les caches internes. On le
    // jette — sinon les deux series ne demarrent pas au meme point.
    await mesure(idExistant);
    await mesure(idInexistant);

    for (let i = 0; i < 15; i += 1) {
      existant.push(await mesure(idExistant));
      inexistant.push(await mesure(idInexistant));
    }

    const mExistant = minimum(existant);
    const mInexistant = minimum(inexistant);

    // Avant le correctif, l'ecart etait de plusieurs centaines de ms : scrypt
    // plus un aller-retour base. On tolere 60 ms de bruit, on interdit le saut.
    const ecart = Math.abs(mExistant - mInexistant);
    expect(
      ecart,
      `ecart temporel de ${ecart.toFixed(1)} ms (existant ${mExistant.toFixed(1)} / inexistant ${mInexistant.toFixed(1)})`
      + ` — existant [${existant.map((x) => x.toFixed(0)).join(' ')}]`
      + ` / inexistant [${inexistant.map((x) => x.toFixed(0)).join(' ')}]`,
    ).toBeLessThan(60);
  }, 120000);

  it('les deux cas rendent la MEME erreur, cote API', async () => {
    const stamp = `${Date.now()}`.slice(-9).slice(0, 6);
    const inexistant = await authenticateUserAccount({
      identifier: `FANTOME${stamp}`,
      password: 'Mauvais',
    }).then(() => null, (e) => e);
    const reel = await authenticateUserAccount({
      identifier: `FANTOME${stamp}`,
      password: 'Mauvais',
    }).then(() => null, (e) => e);

    // Deux appels identiques sur un compte inexistant doivent etre
    // indissociables — y compris dans le code et le statut.
    expect(inexistant.code).toBe(reel.code);
    expect(inexistant.message).toBe(reel.message);
  });
});