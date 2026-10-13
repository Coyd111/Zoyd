# Étape 4 — Concurrence et temps réel

## Portée

Les exclusions mutuelles, la perte d'événements, la reprise après coupure,
l'arrêt du processus et la fenêtre de déploiement.

## 1. Après une coupure, le client affichait « live » avec un état périmé

**Sévérité : haute. Corrigé.**

Le socket ne diffuse que des **deltas**, et n'envoie **aucun état initial** à
la connexion — uniquement `server:hello`, qui ne contient rien d'utile. La
première synchronisation complète passait par `/api/realtime/state/bootstrap`,
et elle n'était déclenchée **qu'une fois par montage**, derrière
`didBootstrapRef` dans `useRealtimeHeartbeat`.

Conséquence directe : après une coupure réseau — tunnel, 4G qui coupe, veille
du téléphone, free tier Render qui se réveille — le socket se reconnecte, et le
client passe `connectionLabel` à `'live'`, **vert**. Mais tout ce qui s'est
passé pendant la coupure est définitivement perdu : un résultat de match, une
demande d'ami, une notification, un tournois démarré.

Le joueur voit « en direct » et une liste de matchs qui ne reflects plus rien.
C'est le pire type de défaut temps réel : invisible, parce que l'interface
affirme le contraire de la réalité.

Le correctif distingue deux événements qui se ressemblent :

- **coupure** (`onDisconnect`) → l'état est marqué `dirtySinceDisconnect` ;
- **déconnexion volontaire** (logout, démontage) → état remis à zéro.

À la reconnexion, si et seulement si l'état avait déjà été synchronisé **et**
qu'une coupure a eu lieu depuis, on resynchronise. Un logout suivi d'une
connexion ne déclenche donc pas de double bootstrap, et un état jamais
synchronisé ne boucle pas.

Pendant la reprise, l'interface affiche `syncing`, pas `live`. Si la reprise
échoue, on reste en `syncing` et `dirtySinceDisconnect` reste à `true` — le
prochain passageonnullera le besoin de reprise.

Cinq tests couvrent la première connexion, la coupure, l'échec de bootstrap
précédent, la confusion logout/coupure, et l'état affiché quand la reprise
échoue.

## 2. La configuration de tests décrivait un environnement inexistant

**Sévérité : moyenne. Corrigé.**

`vitest.config.ts` déclarait `environment: 'jsdom'`. **jsdom n'est pas dans
les dépendances** — il n'est ni dans `package.json` ni résolvable. Vitest
retombait silencieusement sur `node` : les 500+ tests passaient, mais pas dans
l'environnement que la config annonçait.

Une configuration qui décrit un faux environnement est plus dangereuse
qu'une configuration absente : on lit `environment: 'jsdom'`, on conclut qu'on
couvre le DOM, et on ne le couvre pas. Le mode est maintenant déclaré `node`,
avec le motif en commentaire, et la vraie couverture navigateur reste le build
plus les tests Playwright UI.

C'est ce constat qui a fait apparaître le défaut nº 1 : `connect()` sort
précocement sur `typeof window === 'undefined'`, et le test ne touchait pas du
tout la reconnexion.

## 3. Synchronisation d'état : du code mort des deux côtés

**Sévérité : faible. Documenté, non supprimé.**

`POST /api/realtime/state/sync` ne peut plus rien accepter : `tournaments`
renvoie 409 `DEPRECATED_ROUTE`, tout le reste 400 `INVALID_PAYLOAD`. Côté
client, `syncServerState` — le seul appelant de `syncRealtimeState` — n'est
**appelé nulle part**.

Bonne nouvelle : il n'y a donc pas de requête inutile toutes les 15 secondes.
Mauvaise nouvelle : c'est un piège. La fonction client a l'air de fonctionner,
le serveur répond sans se plaindre, et le prochain développeur qui l'appellera
constatera un 400 sans comprendre pourquoi.

`useRealtimeHeartbeat` appelle pourtant `syncFromMatches` toutes les 15
secondes. Le nom est trompeur : la fonction ne synchronise plus d'état, elle
calcule la présence et pousse les rappels (check-in, salle CODM, match en
direct, litige). Rien à corriger, mais à ne pas confondre avec une
synchronisation.

Je n'ai pas supprimé le endpoint : c'est une API publique, et la retirer est un
changement de contrat à décider, pas un nettoyage à faire en douce.

## 4. Arrêt du processus : vérifié, correct

Vérifié parce que c'est le genre de truc qu'on suppose cassé. Ce n'est pas le
cas.

`gracefulShutdown` traite SIGTERM et SIGINT, vide l'intervalle
d'automatisation des matchs, appelle `server.close()` (cesse d'accepter, laisse
finition les requêtes en vol), ferme Socket.IO, et **borne tout à 10 secondes**
par `process.exit(1)`.

Les 19 `setInterval` de fond ne bloquent pas la sortie, précisément parce que
cet exit est explicite. Sans lui, aucun de ces timers — nettoyages des verrous,
des rate limits, métriques, crons — n'aurait laissé l'event loop se vider.

## 5. Verrous en mémoire : corrects pour un processus

Les verrous sont des `Mutex` en mémoire, par joueur, par canal, par portefeuille.
Deux points sont bien traités :

- **l'éviction n'écrase jamais un verrou actif.** Supprimer le verrou d'un
  joueur en cours d'opération recréerait un `Mutex` au prochain appel, et deux
  écritures concurrentes sur le même portefeuille passeraient — c'est-à-dire
  exactement le double débit, le double crédit que le verrou existe pour
  empêcher. L'éviction ne touche que les verrous inactifs ;
- **les verrous inactifs sont purgés** après 30 minutes, donc pas de fuite
  mémoire sur un service qui tourne des mois.

Limite assumée : tout est **par processus**. Pendant un déploiement, l'ancienne
et la nouvelle instance servent quelques secondes en parallèle, chacune avec sa
copie mémoire. J'ai vérifié ce que cela implique réellement :

- les balayages d'argent (`sweepPendingSettlements`, `sweepPendingRefunds`) sont
  protégés par une revendication en base : le second processus perd la course
  et ne fait rien ;
- les écritures d'état sont fail-closed avec rollback mémoire et
  `SERVER_BUSY` ;
- le risque résiduel est une écriture de collection complète par un processus
  dont la copie mémoire est périmée, qui reviendrait sur une écriture plus
  récente de l'autre processus. Fenêtre de quelques secondes, probabilité faible.

Ce n'est pas un défaut à corriger dans le code : c'est une propriété du
déploiement. Les parades sont `autoDeploy: false` avec déploiement manuel, ou un
délai de drainage au démarrage de la nouvelle instance. À trancher quand la
base de joueurs grossira — aujourd'hui, un incident sur cette fenêtre serait
un bug non reproductible, pas une perte d'argent.