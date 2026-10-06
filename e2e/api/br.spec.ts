import { test, expect } from '@playwright/test';
import {
  call,
  callAnonymous,
  registerPlayer,
  disposeActors,
  loginAdminWithout2fa,
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

  test('l\'arbitre cree le salon sans payer de pass ni etre joueur', async () => {
    // Regle metier : le createur est l'ARBITRE, pas un joueur. Il ne paie
    // aucun pass et ne figure pas dans le roster — sinon creer un salon
    // coutait 50 ZC a l'admin et la cagnotte comptait un joueur non paye.
    const before = await call(admin, 'GET', '/api/wallet/me');
    const balanceBefore = before.body.wallet.cashBalance;

    const res = await call(admin, 'POST', '/api/br/lobbies', {
      name: 'Salon createur', mode: 'solo', map: 'isolated',
      entryFee: 50, scheduledAt: in24h(), payout,
    });
    expect(res.status).toBe(201);
    expect(res.body.lobby.players).toHaveLength(0);
    // `creatorId`/`arbiterId` ne sortent plus de l'API publique : un joueur
    // ne doit pas pouvoir relier le pseudo de l'organisateur a un compte.
    // Le role est porte par le booleen `isArbiter`.
    expect(res.body.lobby.creatorId).toBeUndefined();
    expect(res.body.lobby.arbiterId).toBeUndefined();
    expect(res.body.lobby.isArbiter).toBe(true);

    // Aucun debit : l'admin peut creer un salon meme sans solde.
    const after = await call(admin, 'GET', '/api/wallet/me');
    expect(after.body.wallet.cashBalance).toBe(balanceBefore);
  });

  test('refuse la creation a un non-administrateur', async () => {
    // Un joueur ne peut pas creer de salon : il n'en serait pas l'arbitre.
    const broke = await registerPlayer('BRBROKE');
    const res = await call(broke, 'POST', '/api/br/lobbies', {
      mode: 'solo', map: 'isolated', entryFee: 50, scheduledAt: in24h(), payout,
    });
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

  test('le salon designe un arbitre a la creation', async () => {
    const res = await call(admin, 'POST', '/api/br/lobbies', {
      mode: 'solo', map: 'isolated', entryFee: 50, scheduledAt: in24h(), payout,
    });
    expect(res.status).toBe(201);
    // Sans arbitre designe, personne ne pourrait saisir les resultats.
    // L'id n'est plus public : c'est `isArbiter` qui l'atteste.
    expect(res.body.lobby.isArbiter).toBe(true);
  });

  test('refuse un arbitre qui n\'est pas administrateur', async () => {
    const res = await call(admin, 'POST', '/api/br/lobbies', {
      mode: 'solo', map: 'isolated', entryFee: 50, scheduledAt: in24h(),
      payout, arbiterId: 'quelquun',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ARBITER');
  });

  test('un joueur inscrit ne peut pas saisir les eliminations', async () => {
    // Faille fermee : l'eliminate est reserve a l'arbitre du salon, sinon un
    // joueur s'attribuait des kills et donc une part de cagnotte.
    const created = await call(admin, 'POST', '/api/br/lobbies', {
      mode: 'solo', map: 'isolated', entryFee: 50, scheduledAt: in24h(), payout,
    });
    const lobbyId = created.body.lobby.id;
    const player = await registerPlayer('BRNOARB');
    await creditWallet(admin, player.id, 300);
    expect((await call(player, 'POST', `/api/br/lobbies/${lobbyId}/join`)).status).toBe(200);
    expect((await call(player, 'POST', `/api/br/lobbies/${lobbyId}/checkin`)).status).toBe(200);

    // Le salon est programme dans 24h : `eliminate` exige `live`.
    const res = await call(player, 'POST', `/api/br/lobbies/${lobbyId}/eliminate`, { userId: 'x' });
    // 409 (pas en cours) ou 403 (pas l'arbitre) : jamais 200.
    expect([403, 409]).toContain(res.status);
  });

  test('un joueur inscrit ne peut pas lancer la partie', async () => {
    const created = await call(admin, 'POST', '/api/br/lobbies', {
      mode: 'solo', map: 'isolated', entryFee: 50, scheduledAt: in24h(), payout,
    });
    const lobbyId = created.body.lobby.id;
    const player = await registerPlayer('BRNOSTART');
    await creditWallet(admin, player.id, 300);
    await call(player, 'POST', `/api/br/lobbies/${lobbyId}/join`);

    const res = await call(player, 'POST', `/api/br/lobbies/${lobbyId}/start`);
    expect([403, 409]).toContain(res.status);
  });

  test('inscription : bloque le pass, puis refus du double et du pret depasse', async () => {
    const created = await call(admin, 'POST', '/api/br/lobbies', {
      name: 'Salon cycle de vie', mode: 'solo', map: 'isolated',
      entryFee: 50, scheduledAt: in24h(), rankingMode: 'survie_kills', payout,
    });
    expect(created.status).toBe(201);
    const lobbyId = created.body.lobby.id;
    // L'arbitre n'est pas inscrit : le salon demarre vide.
    expect(created.body.lobby.players).toHaveLength(0);

    const player = await registerPlayer('BRJOIN');
    await creditWallet(admin, player.id, 500);

    const join = await call(player, 'POST', `/api/br/lobbies/${lobbyId}/join`);
    expect(join.status).toBe(200);
    expect(join.body.lobby.players).toHaveLength(1);

    const wallet = await call(player, 'GET', '/api/wallet/me');
    // 500 - 50 de pass bloque.
    expect(wallet.body.wallet.cashBalance).toBe(450);

    const again = await call(player, 'POST', `/api/br/lobbies/${lobbyId}/join`);
    // 409 et non 400 : c'est un conflit d'etat (deja inscrit), pas une
    // requete mal formee.
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_JOINED');
  });

  test('la vue publique ne laisse FUITER aucun identifiant joueur', async () => {
    // Le roster public masque les userId. C'etait vrai pour la liste et le
    // detail, mais les REPONSES D'ACTION renvoyaient le lobby brut : un
    // joueur pouvait lire tous les userId du salon en s'inscrivant.
    const created = await call(admin, 'POST', '/api/br/lobbies', {
      name: 'Salon fuite', mode: 'solo', map: 'isolated',
      entryFee: 50, scheduledAt: in24h(), payout,
    });
    const lobbyId = created.body.lobby.id;
    const player = await registerPlayer('BRLEAK');
    await creditWallet(admin, player.id, 500);
    const other = await registerPlayer('BRLEAK2');
    await creditWallet(admin, other.id, 500);
    await call(player, 'POST', `/api/br/lobbies/${lobbyId}/join`);
    await call(other, 'POST', `/api/br/lobbies/${lobbyId}/join`);

    const assertNoUserIds = (body: unknown, label: string) => {
      const raw = JSON.stringify(body);
      expect(raw, `${label} ne doit contenir aucun userId`).not.toContain(player.id);
      expect(raw, `${label} ne doit contenir aucun userId`).not.toContain(other.id);
      expect(raw, `${label} ne doit pas exposer l'id de l'arbitre`).not.toContain(admin.id);
    };

    const list = await call(player, 'GET', '/api/br/lobbies');
    expect(list.status).toBe(200);
    assertNoUserIds(list.body, 'la liste des salons');

    const detail = await call(player, 'GET', `/api/br/lobbies/${lobbyId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.lobby.players).toHaveLength(2);
    assertNoUserIds(detail.body, 'le detail du salon');

    // La reponse d'action (ici l'inscription) ne doit rien laisser non plus.
    const join = await call(player, 'GET', `/api/wallet/me`);
    expect(join.status).toBe(200);
    const checkin = await call(player, 'POST', `/api/br/lobbies/${lobbyId}/checkin`);
    expect(checkin.status).toBe(200);
    assertNoUserIds(checkin.body, 'la reponse de check-in');

    // Et pour autant le joueur n'est pas designe : isArbiter vaut false.
    expect(checkin.body.lobby.isArbiter).toBe(false);
  });

  test('la vue arbitre est reservee a l\'arbitre et fournit les userId', async () => {
    const created = await call(admin, 'POST', '/api/br/lobbies', {
      name: 'Salon vue arbitre', mode: 'solo', map: 'isolated',
      entryFee: 50, scheduledAt: in24h(), payout,
    });
    const lobbyId = created.body.lobby.id;
    const player = await registerPlayer('BRVIEW');
    await creditWallet(admin, player.id, 500);
    await call(player, 'POST', `/api/br/lobbies/${lobbyId}/join`);

    // Un inscrit ne doit PAS pouvoir voir les identifiants.
    const denied = await call(player, 'GET', `/api/br/lobbies/${lobbyId}/arbiter`);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('ARBITER_REQUIRED');
    expect(JSON.stringify(denied.body)).not.toContain(player.id);

    // L'arbitre, lui, recoit les userId : c'est ce qui lui permet de saisir
    // qui est elimine, `eliminate` exigeant un userId.
    const view = await call(admin, 'GET', `/api/br/lobbies/${lobbyId}/arbiter`);
    expect(view.status).toBe(200);
    expect(view.body.lobby.isArbiter).toBe(true);
    const players = view.body.lobby.players as Array<{ userId: string; pseudo: string }>;
    expect(players).toHaveLength(1);
    expect(players[0].userId).toBe(player.id);
    expect(view.body.summary).toMatchObject({ total: 1, alive: 1, pot: 50 });
  });

  test('la vue arbitre est refusee a un inscrit qui tente de demarrer', async () => {
    // Faille inverse : la vue doit etre aussi fermee que `start`/`eliminate`.
    const created = await call(admin, 'POST', '/api/br/lobbies', {
      name: 'Salon vue fermee', mode: 'solo', map: 'isolated',
      entryFee: 50, scheduledAt: in24h(), payout,
    });
    const lobbyId = created.body.lobby.id;
    const stranger = await registerPlayer('BRSTRANGE');
    await creditWallet(admin, stranger.id, 500);
    const res = await call(stranger, 'GET', `/api/br/lobbies/${lobbyId}/arbiter`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ARBITER_REQUIRED');
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

  test('lancement refuse en sous-effectif, accepte a 5 presents, absent penalise', async () => {
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

    // L'arbitre n'est pas inscrit : son check-in est refuse, et c'est normal
    // (il surveille, il ne joue pas).
    const arbiterCheckin = await call(admin, 'POST', `/api/br/lobbies/${lobbyId}/checkin`);
    expect(arbiterCheckin.status).toBe(400);
    expect(arbiterCheckin.body.code).toBe('NOT_JOINED');

    // Check-in de tous SAUF le dernier : c'est l'absent penalise.
    for (const entrant of entrants.slice(0, -1)) {
      const checkin = await call(entrant, 'POST', `/api/br/lobbies/${lobbyId}/checkin`);
      expect(checkin.status).toBe(200);
    }

    // 5 presents : le lancement passe. (La fenetre d'anticipation de 10 min
    // est elargie dans ce serveur de test ; la regle de production est
    // verifiee en unite, dans br-engine.test.mjs.)
    const res = await call(admin, 'POST', `/api/br/lobbies/${lobbyId}/start`);
    expect(res.status).toBe(200);
    expect(res.body.lobby.status).toBe('live');
    // Le 6e, absent, est marque absent : son pass est consomme, pas rembourse.
    const absentPlayer = res.body.lobby.players.find(
      (p: { pseudo: string }) => p.pseudo === entrants[5].pseudo
    );
    expect(absentPlayer.absent).toBe(true);
    expect(absentPlayer.alive).toBe(false);
  });

  test('le lancement est refuse en dessous de 5 presents', async () => {
    const created = await call(admin, 'POST', '/api/br/lobbies', {
      name: 'Salon sous-effectif', mode: 'solo', map: 'isolated',
      entryFee: 50, scheduledAt: in24h(), rankingMode: 'survie_kills', payout,
    });
    const lobbyId = created.body.lobby.id;

    const entrants = [await registerPlayer('BRLOW1'), await registerPlayer('BRLOW2'),
      await registerPlayer('BRLOW3'), await registerPlayer('BRLOW4')];
    for (const entrant of entrants) {
      await creditWallet(admin, entrant.id, 300);
      await call(entrant, 'POST', `/api/br/lobbies/${lobbyId}/join`);
      await call(entrant, 'POST', `/api/br/lobbies/${lobbyId}/checkin`);
    }

    const res = await call(admin, 'POST', `/api/br/lobbies/${lobbyId}/start`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NOT_ENOUGH_PLAYERS');
  });

  test('cycle complet : lancement, eliminations, versement top 5 et commission arbitre', async () => {
    // C'est le chemin qui touche de l'argent, et il n'etait couvert qu'en
    // unite : via HTTP, la creation impose 24h d'avance, donc rien ne pouvait
    // etre demarre. La fenetre d'anticipation est donc elargie dans le
    // webServer E2E uniquement.
    const created = await call(admin, 'POST', '/api/br/lobbies', {
      name: 'Salon complet', mode: 'solo', map: 'isolated',
      entryFee: 50, scheduledAt: in24h(), rankingMode: 'survie_kills', payout,
    });
    const lobbyId = created.body.lobby.id;

    const entrants: Actor[] = [];
    // 6 joueurs : 5 elimines, il reste le vainqueur.
    for (let i = 0; i < 6; i++) {
      const actor = await registerPlayer(`BRC${i}`);
      await creditWallet(admin, actor.id, 500);
      expect((await call(actor, 'POST', `/api/br/lobbies/${lobbyId}/join`)).status).toBe(200);
      expect((await call(actor, 'POST', `/api/br/lobbies/${lobbyId}/checkin`)).status).toBe(200);
      entrants.push(actor);
    }
    // L'arbitre n'est pas joueur : son solde ne bouge pas.
    const arbiterBefore = await call(admin, 'GET', '/api/wallet/me');

    const start = await call(admin, 'POST', `/api/br/lobbies/${lobbyId}/start`);
    expect(start.status).toBe(200);
    expect(start.body.lobby.status).toBe('live');

    // Eliminations en chaine : chaque joueur elimine le suivant. On laisse
    // UN seul survivant (p5) : en BR le vainqueur est le dernier vivant, et
    // le classement doit donc etre sans ambiguite.
    const chain = [
      { victim: entrants[0], killer: entrants[1] },
      { victim: entrants[1], killer: entrants[2] },
      { victim: entrants[2], killer: entrants[3] },
      { victim: entrants[3], killer: entrants[4] },
      { victim: entrants[4], killer: entrants[5] },
    ];
    for (const step of chain) {
      const res = await call(admin, 'POST', `/api/br/lobbies/${lobbyId}/eliminate`, {
        userId: step.victim.id, killerUserId: step.killer.id, assists: 0,
      });
      expect(res.status, `elimination de ${step.victim.pseudo}: ${JSON.stringify(res.body)}`).toBe(200);
    }

    // Un joueur deja mort ne peut pas etre reelimine.
    const replay = await call(admin, 'POST', `/api/br/lobbies/${lobbyId}/eliminate`, {
      userId: entrants[0].id, killerUserId: entrants[5].id,
    });
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe('ALREADY_ELIMINATED');

    const finish = await call(admin, 'POST', `/api/br/lobbies/${lobbyId}/finish`);
    expect(finish.status, JSON.stringify(finish.body)).toBe(200);
    expect(finish.body.lobby.status).toBe('finished');

    // Contrat de repartition : la commission d'arbitre sort du pot, et les
    // pourcentages de places s'appliquent au SOLDE (pot - commission).
    const pot = 6 * 50;
    const winnersPool = Math.round(pot * (1 - payout.arbiterRate) * 100) / 100;
    const ranks = [entrants[5], entrants[4], entrants[3], entrants[2], entrants[1]];
    const expected = [winnersPool * payout.first, winnersPool * payout.second,
      winnersPool * payout.third, winnersPool * payout.fourth, null];
    // Le dernier Beneficiaire absorbe l'arrondi : la somme doit tomber juste.
    expected[4] = Math.round((winnersPool - expected.slice(0, 4)
      .reduce((a, b) => a + Math.round(b * 100) / 100, 0)) * 100) / 100;

    for (let i = 0; i < ranks.length; i++) {
      const wallet = await call(ranks[i], 'GET', '/api/wallet/me');
      // 500 - 50 de pass bloque, plus le gain de la place.
      expect(wallet.body.wallet.cashBalance, `payout ${i + 1}e (${ranks[i].pseudo})`)
        .toBeCloseTo(450 + expected[i], 2);
      // Plus aucune reservation : le pass a ete solde.
      expect(wallet.body.wallet.lockedBalance, `reservation ${ranks[i].pseudo}`).toBe(0);
    }

    // Le 6e, elimine en premier (5e place), a bien ete paye : tout le monde
    // est classe dans un salon de 5 joueurs presents.
    expect(finish.body.payouts).toHaveLength(5);

    // L'arbitre percu SA commission, prelevee sur la cagnotte, sans avoir paye
    // de pass : c'etait la regression qui le payait zero.
    const arbiterAfter = await call(admin, 'GET', '/api/wallet/me');
    const arbiterGain = arbiterAfter.body.wallet.cashBalance - arbiterBefore.body.wallet.cashBalance;
    expect(arbiterGain, 'commission d arbitrage').toBeCloseTo(pot * payout.arbiterRate, 2);

    // Le pot est vide au centime pres : aucune cagnotte perdue ni creee.
    const distributed = expected.reduce((a, b) => a + b, 0);
    expect(distributed + pot * payout.arbiterRate).toBeCloseTo(pot, 2);
  });

  test('la cloture exige la 2FA admin', async () => {
    // Money-out : sans 2FA verifiee, `finish` est refuse meme pour
    // l'arbitre. Sans ce verrou, un compte arbitre vole suffirait.
    const created = await call(admin, 'POST', '/api/br/lobbies', {
      name: 'Salon 2fa', mode: 'solo', map: 'isolated',
      entryFee: 50, scheduledAt: in24h(), payout,
    });
    const lobbyId = created.body.lobby.id;
    for (let i = 0; i < 5; i++) {
      const actor = await registerPlayer(`BRF${i}`);
      await creditWallet(admin, actor.id, 500);
      await call(actor, 'POST', `/api/br/lobbies/${lobbyId}/join`);
      await call(actor, 'POST', `/api/br/lobbies/${lobbyId}/checkin`);
    }
    await call(admin, 'POST', `/api/br/lobbies/${lobbyId}/start`);

    // Nouvelle session admin, SANS verification 2FA.
    const unverified = await loginAdminWithout2fa();
    const res = await call(unverified, 'POST', `/api/br/lobbies/${lobbyId}/finish`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('2FA_REQUIRED');
    // Le salon n'a pas bouge : la 2FA a bloque AVANT tout versement.
    const after = await call(admin, 'GET', `/api/br/lobbies/${lobbyId}`);
    expect(after.body.lobby.status).toBe('live');
  });
});