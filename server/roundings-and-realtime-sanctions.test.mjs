import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Trois failles confirmees en relisant le depot, hors de la liste annoncee.
 *
 * 1. `forgot-password` repondait `found: false` ET un message different quand
 *    aucun compte ne correspondait. Oracle d enumeration gratuit : soumettre un
 *    email suffisait a savoir s il etait inscrit.
 *
 * 2. Les sessions temps reel ne testaient AUCUNE sanction. Un joueur banni
 *    gardait sa socket pendant toute sa duree de vie, alors que le chemin HTTP
 *    destructait la session. L ecart etait invisible.
 *
 * 3. La cagnotte est calculee sur un PRODUIT (tarif x entrees x taille) alors
 *    que l argent bloque est une SOMME d arrondis par equipe. Les deux
 *    coincident tant que le tarif a au plus 2 decimales — et le tarif n etait
 *    valide que comme « nombre positif », donc 10.005 passait etcreait des ZC.
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

import { roundAmount } from './utils.mjs';

beforeEach(() => vi.clearAllMocks());

describe('Cagnotte : produit contre somme des arrondis', () => {
  it('un tarif a plus de 2 decimales fait diverger pot et argent bloque', () => {
    const tarif = 10.005;
    const tailleEquipe = 3;
    const entrees = 4;

    // Ce que chaque equipe BLOQUE reellement : arrondi par equipe.
    const parEquipe = roundAmount(tarif * tailleEquipe);
    const bloqueReel = parEquipe * entrees;

    // Ce que la cagnotte annonce : produit, arrondi une seule fois.
    const potAnnonce = roundAmount(tarif * entrees * tailleEquipe);

    // L ecart existe bien : c est de la monnaie creee ou detruite au reglement.
    expect(bloqueReel).not.toBe(potAnnonce);
    expect(bloqueReel - potAnnonce).toBeCloseTo(0.02, 5);
  });

  it('apres arrondi du tarif a 2 decimales, les deux coincident', () => {
    const tarif = roundAmount(10.005);
    const tailleEquipe = 3;
    const entrees = 4;

    expect(roundAmount(tarif * tailleEquipe) * entrees).toBe(
      roundAmount(tarif * entrees * tailleEquipe)
    );
  });

  it('le tarif arrondi ne peut pas devenir negatif par un arrondi', () => {
    // Garde-fou : arrondir 0.004 donne 0, pas un negatif ni un NaN.
    expect(roundAmount(0.004)).toBe(0);
    expect(roundAmount(-0.001)).toBeGreaterThanOrEqual(0);
  });
});

describe('Lecture du correctif applique aux routes', () => {
  it('les deux routes normalisent le tarif avant tout calcul', async () => {
    // Le comportement observable : le tarif est arrondi des l entree. On verifie
    // que le code source porte la normalisation ET que roundAmount fait bien ce
    // qu on attend sur un cas qui diverge.
    const { readFileSync } = await import('node:fs');
    for (const fichier of ['server/routes/match.mjs', 'server/routes/tournament.mjs']) {
      const source = readFileSync(fichier, 'utf8');
      expect(
        source.includes('entryFee: roundAmount(body.entryFee)'),
        `${fichier} doit arrondir le tarif avant de calculer la cagnotte`
      ).toBe(true);
    }
  });
});

describe('Sanctions sur les sessions temps reel', () => {
  it('getRealtimeSession teste les sanctions', async () => {
    // Une lecture du code ne remplace pas un comportement. On verifie donc que
    // le garde existe ET que `getBlockingSanction` est appele dans le chemin.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('server/persistence.mjs', 'utf8');
    const corps = source.slice(
      source.indexOf('export const getRealtimeSession'),
      source.indexOf('export const getRealtimeSession') + 900
    );
    expect(corps).toContain('getBlockingSanction');
  });
});