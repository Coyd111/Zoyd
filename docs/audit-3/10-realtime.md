# Partie 10 — Realtime (serveur + handlers socket) (audit-3)

**Relecture :** 2026-10-26, base `main` au `cc02470`.
**Périmètre :** `server/realtime-server.mjs` (742 lignes, lu intégralement —
les points de wiring déjà vérifiés en partie 1 ne sont pas re-constatés),
zones ciblées de `persistence.mjs` (sessions temps réel `:3251-3323`),
`channel-presence.mjs` (`upsertChannelMember :189-218`, `publicMember
:121-133`), `match-engine.mjs:148` (`MATCH_AUTOMATION_INTERVAL_MS`).
**Anti faux-positifs :** ledgers `docs/audit-2/`, invariants
`docs/05-invariants.md`, commentaires `PIEGE:`/`INVARIANT:` des sources.
(Rappel : handlers socket de la partie 1 reportés ici — aucun constat
n'était en suspens.)

## Verdicts par zone

| Zone | Verdict |
|---|---|
| `handleRequest` (CSRF, dispatch) | Propre — le wiring `res._req`/métriques est sain (vérifié partie 1) |
| `io` (CORS, allowRequest WS) | Propre — le garde s'applique aussi à l'upgrade WebSocket |
| Middleware `io.use` (RL + auth) | Propre — compteur par IP réelle, fallback cookie fail-closed |
| Handlers presence/seen/typing | 3 INFO (C1, C2, C3) — cosmétiques, userId forcé par la session |
| `notification:push` | Propre — self-push + admin, textes sanités côté `deliverNotification` |
| `start`/shutdown | Propre — fail-safe de boot, arrêt gracieux borné 10 s |

## Ce qui a été vérifié et jugé solide

- **CSRF à deux niveaux** (`:275-289`) : Origin hors liste → 403,
  Content-Type non-JSON → 415 — le POST `no-cors` `text/plain` avec le
  cookie SameSite=None est bloqué ; un client sans en-têtes (curl, e2e)
  passe, choix documenté.
- **CORS socket** (`:329-348`) : `allowRequest` filtre l'upgrade WebSocket
  AUSSI (le défaut « cors.origin ne s'applique qu'au polling » est fermé) —
  une page tierce ne peut plus ouvrir un socket avec le cookie de la
  victime.
- **Rate limit de connexion** (`:401-417`) : compteur par IP réelle
  (`getClientIpFromHandshake` réutilise les règles XFF, PIEGE du peer
  LB documenté `:364-373`), 10/60 s, nettoyage 5 min avec cap 10 000
  (`:381-398`).
- **Auth du handshake** (`:419-435`) : token temps réel d'abord, fallback
  cookie `zoyd_auth` ensuite (`getAuthSession` relit sanction + rôle), sans
  session → `unauthorized` (fail-closed).
- **Sessions temps réel** (`persistence.mjs:3251-3287`) : la sanction
  bloquante DETRUIT la session (un banni ne garde pas son socket, le
  commentaire `:3260-3265` décrit exactement l'écart corrigé) ; le rôle est
  RELU depuis le compte, pas réutilisé (`:3270-3286` — un admin rétrogradé
  ne garde pas le droit de push cible).
- **Handlers de présence** : le `userId` est TOUJOURS forcé depuis la
  session (`:473`, `:501` — un client ne peut pas usurper l'identité d'un
  autre dans les snapshots) ; l'accès au canal est relu sur chaque handler
  (`canAccessChatChannel`, 404-friendly) ; rate limit `chat` sur chacun.
- **`presence:update` (zone :481-524)** : le rôle est whitelisté
  (`['player','arbiter','spectator'].includes`, `:512`) ; la mutation cible
  le membre du userId de session uniquement (`:507`).
- **`channel:seen`/`typing:update`** : maps éphémères, accusé par compte
  (PIEGE « room personnelle » respecté via `broadcastChatRead`), isTyping
  false supprime l'entrée (`:582`).
- **`notification:push`** (`:588-615`) : rate limit `default`, garde
  explicite « users can only send push to themselves, admins can send to
  anyone » (`:599-602`), textes sanités au niveau `deliverNotification`
  (`sanitizeText`, `push-notifications.mjs:94-97`), échec isolé (warn).
- **`start`** (`:628-717`) : `assertSingleProcess` AVANT de charger (le
  commentaire `:630-638` justifie le refus de boot) ; chargement en 3
  essais, échec → écritures d'état désactivées (`stateTrusted` faux,
  `/api/health` 503 — le filet anti-purge est réel) ; secrets 2FA, chat
  global, sync des canaux de match, hydratation des clés de retrait ET de
  gains (anti-redoublement au redémarrage), `initCronJobs` UNE FOIS ;
  automation match toutes les 30 s (`match-engine.mjs:148`) sous
  `withMatchMutex` avec garde anti-chevauchement.
- **Arrêt** (`:719-739`) : `uncaughtException` → exit immédiat (l'état n'est
  pas corrompu en silence) ; SIGTERM/SIGINT → close server+io, force exit
  à 10 s.

## Constats

### C1 — INFO : garde `team` tronquée — négatifs et non-entiers acceptés (point reporté `presence:update:513`)

- `presence:update` (`realtime-server.mjs:513`) :
  `typeof safePayload.team === 'number' && safePayload.team <= 1` —
  accepte `-5` et `0.5` (tout nombre ≤ 1). Le même handler whitelist le
  rôle ligne précédente (`:512`) : la ligne team voulait clairement dire
  `[0, 1].includes(...)` ou `Number.isInteger && >= 0`.
- `upsertChannelMember` (`channel-presence.mjs:209`) confirme l'absence :
  `nextMember.team = typeof team === 'number' ? team : nextMember.team` —
  type seulement, pas de valeur.
- `publicMember` (`:125`) diffuse `team` tel quel aux snapshots.
- Impact borné : le handler force `userId` = session (`:501`), donc un
  joueur ne peut muter que SA propre entrée de présence — auto-sabotage
  d'affichage (couleur d'équipe), éphémère (Map mémoire, reconstruite à la
  reconnexion), aucune autorisation ne lit `team`. INFO, pas FAIBLE —
  le correctif est une ligne.

### C2 — INFO : `presence:join` n'a pas de whitelist de rôle

- Le membre peut se déclarer `role: 'admin'` à l'entrée
  (`realtime-server.mjs:471-476` passe `payload.role` tel quel ;
  `upsertChannelMember` prend `role = 'spectator'` PAR DÉFAUT mais lit
  toute valeur fournie, `channel-presence.mjs:190`). Les snapshots de
  présence (`presence:snapshot`) afficheront un membre « admin ».
- Borné : la présence est cosmétique — aucune garde serveur ne lit
  `member.role` (l'arbitre vient de `lobby.arbiterId` /
  `match.players`, la 2FA de la session stockée) ; le canal joint reste
  soumis à `canAccessChatChannel`. Un membre qui s'affiche admin dans un
  canal public est de la frime, pas une escalade. Une whitelist identique
  à `:512` homogénéiserait.

### C3 — INFO : deux noms d'événement pour le même genre de refus

- Rate limit → `socket.emit('error', …)` (`:457`, `:485`, `:529`, `:542`,
  `:592`) ; accès refusé → `socket.emit('server:error', …)` (`:467`,
  `:495`). Si le front n'écoute qu'un des deux, l'autre catégorie de refus
  est silencieuse côté client (le socket reste ouvert, l'action semble
  n'avoir rien fait). Consistant dans le fichier mais arbitraire : à
  aligner côté front (partie 12 dira lequel est écouté).

### C4 — INFO : le rôle figé survit sur le chemin cookie du handshake

- Le correctif « rôle RELU » (`persistence.mjs:3286`) s'applique au chemin
  TOKEN (`getRealtimeSession`). Le fallback COOKIE
  (`getOrCreateRealtimeSessionForUser :3293-3305`) retourne la session
  realtime EXISTANTE brute (`safe` sans `tokenHash`, `:3299`) — rôle figé
  à la création — ou en crée une avec le rôle courant (`:3304`). Un admin
  rétrogradé dont la session realtime préexiste (créée avant la
  rétrogradation, valide jusqu'à 6 h) garde son rôle socket via le
  chemin cookie. Même famille que le défaut corrigé `:3270-3277` (impact
  réel limité : `session.role` ne sert qu'au ciblage push de
  `notification:push`).

### C5 — INFO : micro-remarques sans impact

- **Timers module-load** : `setInterval(cleanupSocketConnectionCounts,
  5 min)` (`realtime-server.mjs:399`) démarre à l'IMPORT, pas dans
  `initCronJobs` — même famille que P8 C5 (`channel-presence:77`) et
  P9 C6 (`persistence:3016`) : sans `unref`, hors invariant du cron.
- **Éviction FIFO du compteur d'IP** (`:389-397`) : sous tempête de connexions
  (10 000 IPs), le FIFO évince les premières entrées — un IP actif peut
  repartir de zéro et gagner des connexions bonus. Effet marginal, la
  fenêtre est 60 s.
- **`unhandledRejection` sans exit** (`:719-721`) : logue en fatal mais le
  process survit — assumé (contrairement à `uncaughtException`), à garder
  en tête si un jour l'état diverge sans panne visible.
- **ASCII** : 58 occurrences non-ASCII (accents de commentaires et textes
  de log) ; aucun CJK (grep vérifié).

## Résumé

Le serveur temps réel est propre : CSRF à deux niveaux, CORS qui couvre
l'upgrade WebSocket, rate limit par IP réelle (PIEGE du peer LB corrigé et
documenté), auth du handshake fail-closed, sanction et rôle relus depuis
l'état courant sur le chemin nominal, drapeaux et hydratations au boot qui
referment les défauts de redoublement, automation sous verrou avec garde
anti-chevauchement. Cinq INFO : garde `team` tronquée (négatifs acceptés,
point reporté tranche — auto-sabotage seulement, userId forcé), rôle
« admin » déclarable dans les snapshots de présence (cosmétique), deux noms
d'événements de refus, rôle figé survivant sur le chemin cookie du
handshake, hygiène de timers module-load.
