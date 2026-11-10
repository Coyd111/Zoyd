import { test, expect } from '@playwright/test';
import { call, callAnonymous, registerPlayer, openAdminSession, loginAdminWithout2fa, disposeActors } from './support/harness';

/**
 * Export de l'historique des matchs — la porte de sortie de la sauvegarde.
 *
 * L'historique vit dans `state_snapshots` et n'est jamais purge : un match
 * termine passe a `archived` sans disparaitre. Mais une base n'est pas une
 * sauvegarde tant que personne n'a produit de copie a conserver ailleurs.
 *
 * PORTEE : la suite E2E tourne en mode memoire (`ZOYD_DISABLE_SUPABASE=true`),
 * donc il n'y a aucun match a exporter. Ce qui est verifie ici, c'est le
 * refus propre — et surtout que la route ne renvoie JAMAIS un CSV vide
 * presentable comme « aucun match joue », car c'est le piege classique d'une
 * sauvegarde : un fichier vide qui ressemble a une archive reussie.
 */
test.describe('GET /api/admin/matches/export', () => {
  test('refuse sans session', async () => {
    const res = await callAnonymous('GET', '/api/admin/matches/export');
    expect(res.status).toBe(401);
  });

  test('refuse a un joueur non administrateur', async () => {
    const joueur = await registerPlayer('NonAdminExport');
    const res = await call(joueur, 'GET', '/api/admin/matches/export');
    expect(res.status).toBe(403);
    await disposeActors();
  });

  test('exige la 2FA : un export contient des cagnottes et des reglements', async () => {
    const adminSans2fa = await loginAdminWithout2fa();
    const res = await call(adminSans2fa, 'GET', '/api/admin/matches/export');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('2FA_REQUIRED');
    await disposeActors();
  });

  test('sans base, repond 503 et NON un CSV vide', async () => {
    // Le point central. Un CSV vide telechargeable serait range sans
    // quon regarde, et l administrateur croirait avoir sauvegarde trois mois
    // d historique.
    const admin = await openAdminSession();
    const res = await call(admin, 'GET', '/api/admin/matches/export');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SERVER_BUSY');
    await disposeActors();
  });

  test('accepte une periode et un format sans erreur de validation', async () => {
    // En mode memoire, la route s arrete au 503 : le test verifie donc qu une
    // borne de date malformee ne provoque ni 500 ni erreur inattendue.
    const admin = await openAdminSession();
    for (const query of ['from=2026-01-01&to=2026-12-31', 'format=json', 'format=csv', 'from=pas-une-date']) {
      const res = await call(admin, 'GET', `/api/admin/matches/export?${query}`);
      expect([503, 400], `requete « ${query} »`).toContain(res.status);
    }
    await disposeActors();
  });
});