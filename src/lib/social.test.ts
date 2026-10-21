import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SOCIAL_LINKS, SOCIAL_SAME_AS } from './social';

/**
 * Les liens sociaux ne doivent pas diverger entre eux.
 *
 * Pourquoi ce fichier existe
 * --------------------------
 * Les liens vivent a deux endroits : la source unique (`src/lib/social.ts`),
 * utilisee par le pied de page, et le JSON-LD de `index.html` (`sameAs`),
 * que les moteurs lisent.
 *
 * Deux copies de la meme donnee divergent. C'est arrive trois fois dans ce
 * projet : les listes de statuts (V3/V4), la base de la sortie de tresorerie
 * (V11), l'effectif par journee de ligue (V12). Un test qui verifie que les
 * deux copies disent la meme chose evite le quatrieme.
 *
 * Il verifie aussi que les URL ne portent AUCUN parametre de suivi : ces
 * parametres identifient la session qui a produit le clic, pas le profil. Ils
 * se periment, et ils exposent la navigation du visiteur.
 */
const racine = path.resolve(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');

/** Extrait le tableau `sameAs` du JSON-LD de `index.html`. */
const lireSameAs = (): string[] => {
  const bloc = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!bloc) throw new Error('JSON-LD introuvable dans index.html');
  const data = JSON.parse(bloc[1]);
  return Array.isArray(data.sameAs) ? data.sameAs : [];
};

describe('Liens sociaux — une seule source, aucune divergence', () => {
  it('la source declare les trois reseaux attendus', () => {
    expect(SOCIAL_LINKS.map((l) => l.id)).toEqual(['discord', 'tiktok', 'whatsapp']);
  });

  it('le JSON-LD declare exactement les memes URL que la source unique', () => {
    // Ni plus, ni moins : une URL en trop dans le JSON-LD est un lien vers un
    // profil qui n existe plus ou n a jamais existe.
    expect(lireSameAs().sort()).toEqual([...SOCIAL_SAME_AS].sort());
  });

  it('aucune URL ne porte de parametre de suivi', () => {
    for (const lien of SOCIAL_LINKS) {
      expect(lien.href, `${lien.id} : URL de suivi dans ${lien.href}`).not.toMatch(/[?&]utm_/);
      expect(lien.href, `${lien.id} : parametre de session dans ${lien.href}`).not.toMatch(/is_from_webapp|sender_device|fbclid|gclid/);
    }
  });

  it('les URL sont absolues et en https', () => {
    for (const lien of SOCIAL_LINKS) {
      expect(lien.href).toMatch(/^https:\/\//);
    }
  });

  it('chaque lien a un libelle d accessibilite (le logo seul ne dit rien)', () => {
    for (const lien of SOCIAL_LINKS) {
      expect(lien.alt.length).toBeGreaterThan(10);
      expect(lien.label.length).toBeGreaterThan(0);
    }
  });
});
