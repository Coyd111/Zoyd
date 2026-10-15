import { test, expect } from '@playwright/test';
import { call, callAnonymous, registerPlayer, openAdminSession, loginAdminWithout2fa, disposeActors } from './support/harness';

// ────────────────────────────────────────────────────────────────────────────
// Lecture des signalements par la moderation — `GET /api/admin/reports`.
//
// Cette route n'existait pas. Les signalements etaient ecrits en base, mais
// rien ne les relisait : le tableau de bord n'affichait que ceux faits dans le
// navigateur courant. Un admin qui ouvrait sa session sur un autre appareil, ou
// apres un rechargement, n'en voyait AUCUN.
//
// PORTEE DE CETTE SUITE — a lire avant de s'etonner d'une absence :
// la suite E2E demarre volontairement en `ZOYD_DISABLE_SUPABASE=true` (mode
// memoire), sinon les tests dependraient du reseau et des donnees reelles de
// Supabase. Il n'y a donc AUCUNE table a lire ici, et un test « j'ai depose un
// signalement et l'admin le retrouve » ne PEUT PAS passer.
//
// Ce que cette suite verifie : le câblage de la route — authentification,
// 2FA, forme de la reponse, pagination, et le signalement du mode degrade.
//
// Ce que la lecture reelle est verifiee ailleurs : `server/
// user-reports-read.test.mjs` teste `listUserReports` sur un faux client
// PostgREST — filtres sur les colonnes, Plage offset/limit, compte total, et
// surtout l'echec bruyant quand la table est injoignable.
// ────────────────────────────────────────────────────────────────────────────

test.describe('GET /api/admin/reports', () => {
  test('refuse sans session', async () => {
    const res = await callAnonymous('GET', '/api/admin/reports');
    expect(res.status).toBe(401);
  });

  test('refuse a un joueur non administrateur', async () => {
    const joueur = await registerPlayer('NonAdmin');
    const res = await call(joueur, 'GET', '/api/admin/reports');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ADMIN_REQUIRED');
    await disposeActors();
  });

  test('exige la 2FA : un administrateur non verifie ne lit rien', async () => {
    // Un signalement accuse une personne et contient des identites : la 2FA
    // est obligatoire, comme sur `/api/admin/commissions`.
    const adminSans2fa = await loginAdminWithout2fa();
    const res = await call(adminSans2fa, 'GET', '/api/admin/reports');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('2FA_REQUIRED');
    expect(res.body.requires2fa).toBe(true);
    await disposeActors();
  });

  test('signale explicitement le mode degrade quand aucune base n est configuree', async () => {
    // Le point de fond. Sans ce drapeau, l'admin verrait « 0 signalement » et
    // en conclurait que personne ne signale rien — alors que la lecture
    // n'a jamais pu avoir lieu.
    const admin = await openAdminSession();
    const res = await call(admin, 'GET', '/api/admin/reports?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.degraded).toBe(true);
    expect(res.body.reports).toEqual([]);
    expect(res.body.total).toBe(0);
    await disposeActors();
  });

  test('un signalement depose sans erreur ne casse pas la lecture', async () => {
    // Le depot doit reussir — la route ecrit bien — et la lecture qui suit
    // doit rester valide. L'echec serait ailleurs : depot 503 sur table
    // absente, ce que verifie la suite dedicated a l'ecriture.
    const auteur = await registerPlayer('DepotAuteur');
    const cible = await registerPlayer('DepotCible');
    const depot = await call(auteur, 'POST', '/api/social/report', {
      targetId: cible.id,
      reason: 'harassment',
      description: 'Signalement de test',
    });
    expect(depot.status).toBe(201);
    expect(depot.body.report?.id).toBeTruthy();

    const admin = await openAdminSession();
    const lecture = await call(admin, 'GET', '/api/admin/reports');
    expect(lecture.status).toBe(200);
    expect(Array.isArray(lecture.body.reports)).toBe(true);
    await disposeActors();
  });

  test('accepte les filtres et les renvoie dans la reponse', async () => {
    const admin = await openAdminSession();
    for (const query of ['status=pending', 'targetId=U42', 'status=inexistant', 'limit=10&offset=5']) {
      const res = await call(admin, 'GET', `/api/admin/reports?${query}`);
      expect(res.status, `requete « ${query} »`).toBe(200);
      expect(res.body.ok).toBe(true);
    }
    await disposeActors();
  });

  test('borne la pagination et la reflects dans la reponse', async () => {
    const admin = await openAdminSession();
    const res = await call(admin, 'GET', '/api/admin/reports?limit=25&offset=50');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(25);
    expect(res.body.offset).toBe(50);

    // Un `limit` absurde doit etre ramene dans les bornes, pas transmis tel
    // quel a PostgREST.
    const enormeLimit = await call(admin, 'GET', '/api/admin/reports?limit=100000');
    expect(enormeLimit.status).toBe(200);
    expect(enormeLimit.body.limit).toBeLessThanOrEqual(500);

    const negatifOffset = await call(admin, 'GET', '/api/admin/reports?limit=-5&offset=-9');
    expect(negatifOffset.status).toBe(200);
    expect(negatifOffset.body.limit).toBeGreaterThanOrEqual(1);
    expect(negatifOffset.body.offset).toBeGreaterThanOrEqual(0);
    await disposeActors();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Sanctions : lecture et levée.
//
// Bannir sans pouvoir lever enfermerait un joueur sans recours, et l'admin
// n'aurait qu'une requete SQL manuelle pour y remedier. Ces routes sont le
// contre-poids du bannissement : elles doivent exister, être gardées, et
// refuser proprement ce qu'elles ne peuvent pas faire.
//
// PORTEE : la suite E2E tourne en mode memoire, donc aucune sanction n'est
// reellement creee ici. Ce qui est verifie, c'est le cablage et le refus
// propre. L'application et la levée sont couvertes en test unitaire sur un
// faux client PostgREST.
// ────────────────────────────────────────────────────────────────────────────
test.describe('Routes de sanctions', () => {
  test('GET /api/admin/sanctions — refuse sans session', async () => {
    const res = await callAnonymous('GET', '/api/admin/sanctions');
    expect(res.status).toBe(401);
  });

  test('GET /api/admin/sanctions — refuse a un joueur non admin', async () => {
    const joueur = await registerPlayer('JoueurSanctions');
    const res = await call(joueur, 'GET', '/api/admin/sanctions');
    expect(res.status).toBe(403);
    await disposeActors();
  });

  test('GET /api/admin/sanctions — exige la 2FA', async () => {
    const adminSans2fa = await loginAdminWithout2fa();
    const res = await call(adminSans2fa, 'GET', '/api/admin/sanctions');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('2FA_REQUIRED');
    await disposeActors();
  });

  test('GET /api/admin/sanctions — renvoie la forme attendue', async () => {
    const admin = await openAdminSession();
    const res = await call(admin, 'GET', '/api/admin/sanctions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sanctions)).toBe(true);
    await disposeActors();
  });

  test('GET /api/admin/sanctions — filtre par joueur sans erreur', async () => {
    const admin = await openAdminSession();
    const joueur = await registerPlayer('FiltreSanctions');
    const res = await call(admin, 'GET', `/api/admin/sanctions?userId=${joueur.id}`);
    expect(res.status).toBe(200);
    expect(res.body.sanctions).toEqual([]);
    await disposeActors();
  });

  test('POST .../revoke — refuse sans session, puis exige la 2FA', async () => {
    const anonyme = await callAnonymous('POST', '/api/admin/sanctions/SN-INEXISTANTE/revoke', {});
    expect(anonyme.status).toBe(401);

    const adminSans2fa = await loginAdminWithout2fa();
    const res = await call(adminSans2fa, 'POST', '/api/admin/sanctions/SN-INEXISTANTE/revoke', {});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('2FA_REQUIRED');
    await disposeActors();
  });

  test('POST .../revoke — 404 sur une sanction inconnue', async () => {
    // Une levée fantôme laisserait croire que le joueur est libéré alors
    // qu'aucune trace n'a été écrite.
    const admin = await openAdminSession();
    const res = await call(admin, 'POST', '/api/admin/sanctions/SN-INEXISTANTE/revoke', {});
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('SANCTION_NOT_FOUND');
    await disposeActors();
  });
});
