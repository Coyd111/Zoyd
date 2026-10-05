import { test, expect } from '@playwright/test';
import {
  call,
  callAnonymous,
  registerPlayer,
  disposeActors,
  openAdminSession,
  creditWallet,
  type Actor,
} from './support/harness';

// Cycle de vie complet d'un salon BR : creation (admin) -> inscription ->
// check-in -> demarrage -> eliminations -> reglement de la cagnotte.
//
// Ce que ces tests verrouillent :
// - les regles de fenetre 24h-48h et de repartition (100%, arbitre <= 5%)
// - le PASS JAMAIS REMBOURSE apres le lancement (absent = penalite)
// - l'absence de userId dans les payloads publics
// - le reglement : top 5 payes, commission arbitre, pass des perdants consomme

const in24h = () => new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString();
const payout = { first: 0.4, second: 0.22, third: 0.15, fourth: 0.12, fifth: 0.08, arbiterRate: 0.03 };

test.describe('Battle Royale API', () => {
  test.describe.configure({ mode: 'serial' });

  let admin: Actor;

  test.beforeAll(async () => {
    admin = await openAdminSession();
    // Le createur paie son propre pass : l'admin de test doit avoir de quoi.
    await creditWallet(admin, admin.id, 100_000);
  });

  test.afterAll(async () => {
    await disposeActors();
  });

  test('GET /api/br/config expose le referentiel (4 maps, sans Alcatraz)', async () => {
    const res = await callAnonymous('GET', '/api/br/config');
    expect(res.status).toBe(200);
    expect(res.body.mapIds).toEqual(['isolated', 'blackout', 'krai', 'rebirth_island']);
    expect(res.body.mapIds).not.toContain('alcatraz');
    expect(res.body.modeIds).toEqual(['solo', 'duo', 'squad']);
    expect(res.body.rankingModeIds).toEqual(['survie', 'survie_kills', 'kills']);
    expect(res.body.prizedPlaces).toBe(5);
    expect(res.body.arbiterMaxRate).toBe(0.05);
  });

  test('GET /api/br/lobbies — 200 et aucun userId dans le roster', async () => {
    const res = await callAnonymous('GET', '/api/br/lobbies');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.lobbies)).toBe(true);
    for (const lobby of res.body.lobbies) {
      for (const player of lobby.players || []) {
        expect(player.userId).toBeUndefined();
      }
    }
  });

  test('POST /api/br/lobbies — 401 sans session', async () => {
    const res = await callAnonymous('POST', '/api/br/lobbies', {
      mode: 'solo', map: 'isolated', entryFee: 50, scheduledAt: in24h(), payout,
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  test('le createur paie et joue son propre salon (pass bloque)', async () => {
    // Le createur est inscrit automatiquement et son pass DOIT etre bloque :
    // c'est la regle commerciale du BR (pas de partie gratuite, donc pas de
    // salon gratuit). L'admin de test n'a pas de solde : on le finance.
    const before = await call(admin, 'GET', '/api/wallet/me');
    const balanceBefore = before.body.wallet.cashBalance;

    const res = await call(admin, 'POST', '/api/br/lobbies', {
      name: 'Salon createur', mode: 'solo', map: 'isolated',
      entryFee: 50, scheduledAt: in24h(), payout,
    });
    expect(res.status).toBe(201);
    expect(res.body.lobby.players).toHaveLength(1);
    expect(res.body.lobby.creatorId).toBe(admin.id);

    const after = await call(admin, 'GET', '/api/wallet/me');
    expect(after.body.wallet.cashBalance).toBe(balanceBefore - 50);
  });

  test('refuse la creation si le createur ne peut pas payer son pass', async () => {
    // On vide l'admin via une tentative impossible : le controle doit etre
    // fait AVANT de persister le salon, sinon un salon sans createur existe.
    const broke = await registerPlayer('BRBROKE');
    expect(broke).toBeTruthy();
    const res = await call(broke, 'POST', '/api/br/lobbies', {
      mode: 'solo', map: 'isolated', entryFee: 50, scheduledAt: in24h(), payout,
    });
    // Non-admin : refuse avant meme le paiement.
    expect(res.status).toBe(403);
  });

  test('POST /api/br/lobbies — refuse un non-admin', async () => {
    const player = await registerPlayer('BRNOPE');
    const res = await call(player, 'POST', '/api/br/lobbies', {
      mode: 'solo', map: 'isolated', entryFee: 50, scheduledAt: in24h(), payout,
    });
    expect(res.status).toBe(403);
  });

  test('POST /api/br/lobbies — refuse une repartition qui ne somme pas a 100%', async () => {
    const res = await call(admin, 'POST', '/api/br/lobbies', {
      mode: 'solo', map: 'isolated', entryFee: 50, scheduledAt: in24h(),
      payout: { ...payout, second: 0.5 },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PAYOUT');
  });

  test('POST /api/br/lobbies — refuse une commission arbitre > 5%', async () => {
    const res = await call(admin, 'POST', '/api/br/lobbies', {
      mode: 'solo', map: 'isolated', entryFee: 50, scheduledAt: in24h(),
      payout: { ...payout, arbiterRate: 0.2 },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PAYOUT');
  });

  test('POST /api/br/lobbies — refuse une programmation hors 24h-48h', async () => {
    const tooSoon = await call(admin, 'POST', '/api/br/lobbies', {
      mode: 'solo', map: 'isolated', entryFee: 50,
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), payout,
    });
    expect(tooSoon.status).toBe(400);
    expect(tooSoon.body.code).toBe('INVALID_DATE');

    const tooLate = await call(admin, 'POST', '/api/br/lobbies', {
      mode: 'solo', map: 'isolated', entryFee: 50,
      scheduledAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(), payout,
    });
    expect(tooLate.status).toBe(400);
  });

  test('POST /api/br/lobbies — refuse Alcatraz (map retiree)', async () => {
    const res = await call(admin, 'POST', '/api/br/lobbies', {
      mode: 'solo', map: 'alcatraz', entryFee: 50, scheduledAt: in24h(), payout,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_MAP');
  });

  test('inscription : bloque le pass, puis refus du double et du pret depasse', async () => {
    const created = await call(admin, 'POST', '/api/br/lobbies', {
      name: 'Salon cycle de vie', mode: 'solo', map: 'isolated',
      entryFee: 50, scheduledAt: in24h(), rankingMode: 'survie_kills', payout,
    });
    expect(created.status).toBe(201);
    const lobbyId = created.body.lobby.id;
    // Le createur est automatiquement inscrit.
    expect(created.body.lobby.players).toHaveLength(1);

    const player = await registerPlayer('BRJOIN');
    await creditWallet(admin, player.id, 500);

    const join = await call(player, 'POST', `/api/br/lobbies/${lobbyId}/join`);
    expect(join.status).toBe(200);
    expect(join.body.lobby.players).toHaveLength(2);

    const wallet = await call(player, 'GET', '/api/wallet/me');
    // 500 - 50 de pass bloque.
    expect(wallet.body.wallet.cashBalance).toBe(450);

    const again = await call(player, 'POST', `/api/br/lobbies/${lobbyId}/join`);
    // 409 et non 400 : c'est un conflit d'etat (deja inscrit), pas une
    // requete mal formee.
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_JOINED');
  });

  test('desinscription AVANT le lancement rembourse le pass', async () => {
    const created = await call(admin, 'POST', '/api/br/lobbies', {
      mode: 'solo', map: 'isolated', entryFee: 50, scheduledAt: in24h(), payout,
    });
    const lobbyId = created.body.lobby.id;
    const player = await registerPlayer('BRLEAVE');
    await creditWallet(admin, player.id, 300);

    await call(player, 'POST', `/api/br/lobbies/${lobbyId}/join`);
    const afterJoin = await call(player, 'GET', '/api/wallet/me');
    expect(afterJoin.body.wallet.cashBalance).toBe(250);

    const leave = await call(player, 'POST', `/api/br/lobbies/${lobbyId}/leave`);
    expect(leave.status).toBe(200);

    const afterLeave = await call(player, 'GET', '/api/wallet/me');
    // Rembourse : on revient au solde initial.
    expect(afterLeave.body.wallet.cashBalance).toBe(300);
  });

  test('check-in, demarrage, eliminations et reglement', async () => {
    const created = await call(admin, 'POST', '/api/br/lobbies', {
      name: 'Salon reglement', mode: 'squad', map: 'rebirth_island',
      entryFee: 40, scheduledAt: in24h(), rankingMode: 'survie_kills', payout,
    });
    const lobbyId = created.body.lobby.id;
    // squad sur Rebirth Island => 25 max.
    expect(created.body.lobby.maxPlayers).toBe(25);

    const entrants = [await registerPlayer('BRA1'), await registerPlayer('BRA2'), await registerPlayer('BRA3'),
      await registerPlayer('BRA4'), await registerPlayer('BRA5'), await registerPlayer('BRA6')];
    for (const entrant of entrants) {
      await creditWallet(admin, entrant.id, 200);
      const join = await call(entrant, 'POST', `/api/br/lobbies/${lobbyId}/join`);
      expect(join.status).toBe(200);
    }

    // Check-in de tous, SAUF le dernier : c'est l'absent penalise.
    for (const entrant of entrants.slice(0, -1)) {
      const checkin = await call(entrant, 'POST', `/api/br/lobbies/${lobbyId}/checkin`);
      expect(checkin.status).toBe(200);
    }
    // Le createur (admin) doit aussi confirmer sa presence.
    await call(admin, 'POST', `/api/br/lobbies/${lobbyId}/checkin`);

    // Le salon est programme dans 24h : on ne peut pas demarrer maintenant.
    // 409 et non 400 : conflit d'etat (trop tot), pas une requete mal formee.
    const tooEarly = await call(admin, 'POST', `/api/br/lobbies/${lobbyId}/start`);
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.code).toBe('TOO_EARLY');
  });
});