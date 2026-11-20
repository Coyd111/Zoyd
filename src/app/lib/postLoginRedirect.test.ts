import { describe, it, expect } from 'vitest';
import { getPostLoginPath } from './postLoginRedirect';

/**
 * Verrou ZD-06 (audit production 2026-11-19).
 *
 * Un visiteur ouvre /wallet sans session : AppLayout le renvoie vers
 * /auth/login. Apres connexion, l'application le deposait sur / — la
 * destination demandee etait perdue. Le retour ne doit accepter QUE des
 * chemins internes : un `from` externe transformerait la page de connexion
 * en redirection ouverte.
 */
describe('getPostLoginPath', () => {
  it('revient a la destination demandee', () => {
    expect(getPostLoginPath('/wallet')).toBe('/wallet');
    expect(getPostLoginPath('/mj/tournois/creer?onglet=regles#mise')).toBe(
      '/mj/tournois/creer?onglet=regles#mise',
    );
  });

  it('retombe sur l accueil quand aucune destination n est fournie', () => {
    expect(getPostLoginPath(undefined)).toBe('/');
    expect(getPostLoginPath(null)).toBe('/');
    expect(getPostLoginPath('')).toBe('/');
    expect(getPostLoginPath(42)).toBe('/');
  });

  it('refuse les destinations externes (redirection ouverte)', () => {
    expect(getPostLoginPath('https://evil.example')).toBe('/');
    expect(getPostLoginPath('//evil.example')).toBe('/');
    expect(getPostLoginPath('/\\evil.example')).toBe('/');
    expect(getPostLoginPath('wallet')).toBe('/');
  });

  it('ne renvoie jamais vers l ecran de connexion (boucle)', () => {
    expect(getPostLoginPath('/auth/login')).toBe('/');
    expect(getPostLoginPath('/auth/login?from=%2Fwallet')).toBe('/');
  });

  it('respecte un repli explicite', () => {
    expect(getPostLoginPath(undefined, '/mj')).toBe('/mj');
    expect(getPostLoginPath('//evil.example', '/mj')).toBe('/mj');
  });
});
