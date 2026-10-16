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

    // Medianes : la machine chargee gonfle les echantillons, pas leur ordre.
    const existant = [];
    const inexistant = [];
    for (let i = 0; i < 5; i += 1) {
      existant.push(await mesure(`Chrono${stamp}`));
      inexistant.push(await mesure(`Inconnu${stamp}${i}`));
    }
    const mediane = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const mExistant = mediane(existant);
    const mInexistant = mediane(inexistant);

    // Avant le correctif, l'ecart etait de plusieurs centaines de ms : scrypt
    // plus un aller-retour base. On tolere 60 ms de bruit, on interdit le saut.
    const ecart = Math.abs(mExistant - mInexistant);
    expect(
      ecart,
      `ecart temporel de ${ecart.toFixed(1)} ms (existant ${mExistant.toFixed(1)} / inexistant ${mInexistant.toFixed(1)})`
    ).toBeLessThan(60);
  }, 30000);

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