/**
 * Verrou ZD-13 (audit production 2026-11-19).
 *
 * Le catch-all `/(.*)` de `vercel.json` reecrivait TOUTE URL inconnue vers
 * `index.html` : `/route-inexistante` repondait 200 et les moteurs voyaient
 * une page valide. La correction remplace le catch-all par la liste des
 * routes reellement servies par l'application ; tout le reste recoit le 404
 * de la plateforme.
 *
 * INVARIANT : chaque route de premier niveau de `src/app/routes.tsx` doit
 * avoir sa regle ici, sinon un lien profond valide renverrait 404.
 * PIEGE : `(.*)` est volontaire pour les routes a identifiant et pour la
 * compatibilite des URLs accentuees (`/mj/créer`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface VercelRewrite {
  source: string;
  destination: string;
}

const config = JSON.parse(
  readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'),
) as { rewrites?: VercelRewrite[] };

const rewrites = config.rewrites ?? [];

/** Traduit un motif Vercel (`/mj(.*)`) en expression reguliere d'URL. */
const motifVersRegle = (source: string): RegExp => {
  const corps = source
    .split('(.*)')
    .map((morceau) => morceau.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${corps}$`);
};

const estServie = (chemin: string): boolean =>
  rewrites.some((rewrite) => motifVersRegle(rewrite.source).test(chemin));

describe('vercel.json — les routes servies (ZD-13)', () => {
  it('ne reecrit plus toutes les URL inconnues vers index.html', () => {
    expect(rewrites.map((rewrite) => rewrite.source)).not.toContain('/(.*)');
  });

  it.each([
    '/',
    '/auth/login',
    '/auth/register',
    '/auth/activate',
    '/auth/forgot',
    '/mode',
    '/conditions',
    '/reglement-litiges',
    '/anti-fraude',
    '/confidentialite',
    '/mentions',
    '/jeu-responsable',
    '/mj',
    '/mj/creer',
    '/mj/match/abc',
    '/mj/tournois',
    '/mj/tournois/creer',
    '/mj/tournois/abc',
    '/mj/créer',
    '/wallet',
    '/earnings',
    '/classements',
    '/chat',
    '/profil',
    '/profil/abc',
    '/parametres',
    '/br',
    '/br/lobby-1',
    '/br-league',
    '/br-league/saison-1',
    '/infos',
    '/admin',
  ])('sert %s', (chemin) => {
    expect(estServie(chemin), `${chemin} n'a aucune regle de reecriture`).toBe(true);
  });

  it('laisse une route inconnue hors des reecritures', () => {
    expect(estServie('/route-inexistante')).toBe(false);
    expect(estServie('/mj-inconnu')).toBe(false);
  });
});
