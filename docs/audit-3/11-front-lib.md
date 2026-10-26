# Partie 11 — Front lib (clients API + temps réel + SW) (audit-3)

**Relecture :** 2026-10-26, base `main` au `f66b14c`.
**Périmètre :** `src/app/lib/*.ts` (20 modules sources, lus intégralement :
`realtimeClient.ts` 437 lignes, `apiClient.ts` 228, `brApi.ts` 301,
`matchApi.ts` 231, `authApi.ts` 173, `walletApi.ts` 162, `socialApi.ts` 162,
`leagueApi.ts` 127, `tournamentApi.ts` 109, `toast.ts` 100, `sessionReset.ts`
85, `sessionPurge.ts` 68, `chatApi.ts` 69, `logger.ts` 72, `matchStatus.ts`
72, `apiUrl.ts` 33, `serverSync.ts` 13, `notificationApi.ts` 11, `usersApi.ts`
25), les 3 tests du dossier (`sessionPurge.test.ts` 133,
`apiClient.payoutReason.test.ts` 26, `brApi.test.ts` 50), et la chaîne push
cliente : `hooks/useServiceWorker.ts` (139 lignes, lu intégralement),
`public/sw.js` (173 lignes, lu intégralement), `public/sw-register.js` (5
lignes, chargé par `index.html:90`).
**Anti faux-positifs :** ledgers `docs/audit-2/`, invariants
`docs/05-invariants.md`, commentaires `PIEGE:`/`INVARIANT:` des sources,
`docs/08-frontend.md` (sections 2, 5, 6, 7, 8, 10, 11).
**Croisements :** `realtime-server.mjs` (noms d'événements émis :356, :447,
:457-:592), partie 10 C1/C3/C4, partie 9 MAJEUR (chaîne push morte).

## Verdicts par fichier

| Fichier | Verdict |
|---|---|
| `realtimeClient.ts` | 5 INFO (C1, C2, C3, C4, C5) |
| `apiClient.ts` | Propre — tests de paiement en main |
| `authApi.ts` | Propre |
| `walletApi.ts` | Propre — clé d'idempotence centralisée |
| `brApi.ts` + `brApi.test.ts` | Propre — M3 verrouillé par test |
| `matchApi.ts` / `socialApi.ts` / `leagueApi.ts` / `tournamentApi.ts` | Propres |
| `chatApi.ts` / `usersApi.ts` / `notificationApi.ts` / `serverSync.ts` / `matchStatus.ts` / `toast.ts` / `logger.ts` / `apiUrl.ts` / `sessionPurge.ts` + test / `sessionReset.ts` | Propres |
| `useServiceWorker.ts` | Propre |
| `public/sw.js` | Propre — récepteur push complet |

## Ce qui a été vérifié et jugé solide

- **realtimeClient.ts — le contrat socket** : les 13 événements écoutés
  correspondent aux émissions serveur (croisées une à une :
  `presence:snapshot`, `typing:snapshot`, `notification:deliver`,
  `state:matches/tournaments/leagues` (`payload.items || []`),
  `wallet:update` (serveur `:356`, écouté `:199`), `chat:channel/message/read`)
  ; les wrappers d'émission (`presence:join/update/leave`, `channel:seen`,
  `typing:update`, `notification:push`) correspondent aux handlers serveur
  lus en partie 10 — le serveur FORCE `userId`/`pseudo` depuis la session
  (`:473`, `:501`), les champs identité du payload client sont inertes.
- **Le cycle d'imports est cassé au bon endroit** : `realtimeClient` n'importe
  jamais `apiClient` (INVARIANT `:8-11`) ; `apiClient` purge par le registre
  `sessionPurge.ts` (sans import de store) et résout les URLs par le module
  feuille `apiUrl.ts` ; `apiUrl.ts` documente le cycle refermé qu'il évite
  (`apiClient -> sessionReset -> socketStore -> socketConnectionStore ->
  realtimeClient -> apiClient`). Vérifié par grep : aucune importation
  croisée résiduelle.
- **apiClient.ts** : 401 seul — ou 403 explicitement codé `AUTH_REQUIRED` —
  purge l'état (`:63`) ; un 403 métier (2FA, mot de passe actuel) ne détruit
  pas la session ; anti-tempête `logoutQueued` + `queueMicrotask` (`:65-74`)
  ; traduction des codes en messages (35 entrées, les codes métier du
  serveur), raison du prestataire de retrait PRÉSERVÉE et tronquée à 300
  (`resumerMessagePayout`, testée par `apiClient.payoutReason.test.ts`) ;
  timeout 30 s converti en message adapté au réveil du back gratuit Render
  (`:216-218`) ; `credentials: 'include'` systématique.
- **walletApi.ts** : la clé d'idempotence est générée ICI et conservée
  jusqu'au SUCCÈS (régénérée jamais — un double-clic réutilise la même clé ;
  documenté `:104-119`) ; montants serveur source de vérité (`netAmount`,
  `feeAmount`) ; politique de retrait publiée par le serveur, jamais codée
  en dur.
- **authApi.ts** : cookie-only — le `token` de réponse reste dans le type
  pour compatibilité mais n'est pas stocké (INVARIANT `:8-10`) ; le setup
  2FA exige le mot de passe courant (commentaire anti-takeover `:161-163`)
  ; les routes pré-auth (`activate`, `resend-code`, `forgot-password`,
  `reset-password`) passent par `postUnauthenticated` dédié, sans
  `readJson` (pas de purge 401 sur un appel non authentifié).
- **brApi.ts** : `splitBrPayout` aligné sur `computeBrPayouts` serveur
  (taux = pourcentages du POT — M3 verrouillé par `brApi.test.ts`, qui
  prouve somme des parts + commission = pot) ; roster public sans `userId`
  (type `BrLobbyPlayer`), la vue arbitre seule porte les `userId`
  (`BrArbiterPlayer`) — la séparation est dans les TYPES.
- **matchApi.ts / tournamentApi.ts / leagueApi.ts** : wrappers fins, aucun
  recalcul local d'argent ; `downloadMatchHistory` passe par un `fetch` nu
  (CSV ≠ JSON) + Blob + `URL.revokeObjectURL` (`:217-229`) ;
  `adminResolveServerDispute` documente le défaut d'`action` = `settle`
  (`:157-163`) ; pollings 30 s documentés comme tels (`subscribeToMatches`,
  `subscribeToTournaments`).
- **sessionPurge/sessionReset** : testés — la purge appelle EFFECTIVEMENT le
  gestionnaire, est synchrone, absorbe une purge ratée, et
  `resetAllSessionStores` ne laisse survivre ni les maps d'appelant
  tournois ni la file de signalements (F3).
- **matchStatus.ts** : source unique partagée avec le serveur
  (`shared/match-status.json`), `archived` présent dans le type.
- **useServiceWorker.ts** : première installation SANS rechargement
  (`hadControllerAtLoad :57`, `:87-88`) ; listeners retirés au démontage
  (`updateFoundRef`, `controllerChangeRef`) ; le push n'est souscrit que si
  la permission est DÉJÀ accordée (`:105`) — pas de demande inopinée au
  montage ; `SKIP_WAITING` via `postMessage`.
- **sw.js (récepteur push)** : handler `push` complet (`:123-135` : JSON,
  title/body/tag/requireInteraction/url), `notificationclick` focus ou
  ouvre la fenêtre (`:162-173`) ; les routes `/api/` ne sont JAMAIS mises en
  cache (503 `OFFLINE` hors ligne, `:71-79` — le commentaire `:53-70`
  décrit le garde mort du passé et la fuite de données qu'il causait) ;
  activate purge tous les caches de nom différent.

## Constats

### C1 — INFO : P10 C3 tranché — le front n'écoute NI `error` NI `server:error`

`bindRealtimeHandlers` (`realtimeClient.ts:161-203`) retire et rebranche 13
événements : aucun des deux noms d'événement de refus émis par le serveur
(`error` pour rate limit, `realtime-server.mjs:457/:485/:530/:542/:562/:592`
; `server:error` pour accès refusé, `:467/:495`) n'est écouté. Conséquence :
TOUT refus socket est silencieux côté client — l'action semble ne rien
faire, le socket reste ouvert. Pour l'utilisateur, les deux catégories sont
de toute façon identiques (aucun retour), donc l'arbitrage entre les deux
noms côté serveur est libre ; ce qui compte, c'est qu'aucun consommateur
n'existe. Brancher l'un des deux (ou unifier) rendrait les refus visibles ;
la partie 15 dira si les stores gèrent autrement l'erreur (ils ne le font
pas — rien dans le lib ne peut le faire à leur place).

### C2 — INFO : race d'identité — `sessionPromise` n'est pas invalidée à la déconnexion

- `disconnectRealtimeSocket` (`:229-233`) met `identifiedUser` et
  `activeSession` à `null` mais PAS `sessionPromise` (`:105`).
- Si un compte B se connecte pendant que le `POST /api/realtime/auth/session`
  du compte A est en vol (`ensureRealtimeSession :113-145`), B reçoit la
  promesse EN COURS de A (`if (sessionPromise) return sessionPromise`,
  `:118-120`) : `activeSession` devient la session de A et le socket de B
  s'authentifie avec le token de A — le serveur le joint à `user:A`
  (presence, chat:read, typing, `notification:deliver` de A) pendant que
  l'UI affiche B, jusqu'à la déconnexion du socket ou l'expiration (6 h).
- Fenêtre étroite (durée du POST), requiert un changement de compte dans le
  même onglet à la milliseconde près, aucune escalade (même navigateur, les
  données monétaires passent par le cookie de B) ; le nouveau login de B
  finirait par écraser `activeSession` au prochain cycle d'invalidité. INFO,
  correctif d'une ligne (`sessionPromise = null` dans
  `disconnectRealtimeSocket`).

### C3 — INFO : souscription/désinscription push sans vérification de la réponse serveur

- `subscribeToRealtimePush` (`realtimeClient.ts:406-415`) : `fetch` sans
  test `response.ok` — la fonction renvoie `true` même si la route a répondu
  401 (session temps réel expirée entre-temps) ou 500 ; le `useServiceWorker`
  (`:108-109`) ne logue donc un avertissement que si le fetch JETTE, jamais
  sur un échec applicatif.
- `unsubscribeFromRealtimePush` (`:420-437`) : idem, et la désinscription
  navigateur a lieu même si le serveur a échoué — entrée restée côté serveur
  (aujourd'hui sans conséquence : elle est de toute façon introuvable par
  userId, cf. partie 9 MAJEUR ; après correction du MAJEUR, elle le
  redeviendrait).
- Distinct du MAJEUR P9 (racine côté serveur) : ici c'est le retour d'état
  au client qui manque. Un `if (!response.ok) throw` (ou un retour `false`)
  alignerait le comportement sur `fetchRealtimeBootstrap`/`fetchVapidPublicKey`
  qui, eux, vérifient.

### C4 — INFO : interfaces déclarées DANS le corps de `fetchRealtimeBootstrap`

`BootstrapFriend` (:315-324), `BootstrapFriendRequest` (:328-337) et
`BootstrapNotification` (:339-347) sont déclarés DANS le corps de la fonction
(`:296-359`), entre le garde `if (!response.ok) throw` et le `return`.
Légal en TypeScript (les interfaces sont des types de bloc, aucun impact
runtime), mais le placement est manifestement accidentel (insertion de
commentaire au milieu de la fonction) : ça compile, ça ment sur la
structure. Un déplacement au niveau module clarifierait sans changement de
comportement.

### C5 — INFO : micro-remarques

- **Reprise de reconnexion passive** (`:182-192`) : sur `connect_error`
  unauthorized, la régénération de session en échec est avalée
  (`.catch(() => {})`, `:190`) SANS reprogrammation — le commentaire
  « retry au prochain cycle » dépend d'un re-appel EXTERNE de
  `connectRealtimeSocket` (heartbeat store ? — partie 15 dira) ; sinon le
  socket reste mort jusqu'au rechargement de la page.
- **Double enregistrement du SW** : `index.html:90` charge
  `sw-register.js` (`register('/sw.js')`) ET `App.tsx:43` monte
  `useServiceWorker` (`register('/sw.js')`, `:25-31`). Idempotent côté
  navigateur (même URL de script → même registration), sans effet — mais
  l'un des deux chemins est superflu.
- **`server:hello` émis jamais écouté** (serveur `:447-451` : socketId,
  serverTime, userId ; front : absent de `bindRealtimeHandlers`) —
  informationnel, le front connaît son utilisateur ; si l'horloge serveur y
  était destinée, elle est perdue.
- **`ServerPresenceSnapshot.team?: 0 | 1`** (`:44`) : le type aspiré rétrécit
  la valeur que le serveur accepte réellement (tout nombre ≤ 1, cf. partie
  10 C1) — un `0.5` ou `-5` d'un autre client arrive au front hors du type
  déclaré ; cosmétique, le front n'en déduit aucune autorisation.
- **`emitPresenceJoin/Update` transportent `userId`/`pseudo` client** —
  écrasés par le serveur (session), inoffensifs ; c'est même la preuve que
  la garde serveur est utile.

### C6 — INFO : hygiène ASCII (code)

348 lignes non-ASCII sur les 22 fichiers code du périmètre (commentaires et
textes d'affichage accentués : `apiClient.ts` 114, `brApi.ts` 58,
`realtimeClient.ts` 29, `sw.js` 31…), aucune occurrence CJK (grep vérifié).
Même famille que les parties 8-10 : la convention « commentaires de code
ASCII sans accents » n'est pas appliquée rétroactivement sur ces fichiers ;
aucun risque d'encodage constaté (UTF-8 propre, test
`server/encoding-integrity.test.mjs` vert).

## Point reporté de la partie 9 : le front est conforme — la racine du MAJEUR est serveur

Le contrat visible de `/api/realtime/push/subscribe` est `{ subscription }`
et le front envoie exactement la souscription brute du navigateur
(`realtimeClient.ts:412-414` — endpoint, keys, expirationTime). Le
`userId` n'est pas transportable côté client sans ouvrir une usure
d'identité — c'est le SERVEUR qui doit fusionner l'identité de session au
stockage (cf. partie 9 C1, piste de correctif). La chaîne cliente est
SAINE de bout en bout : souscription conditionnée à la permission
(`useServiceWorker.ts:103-110`), Bearer temps réel (PIEGE `:11-12`),
récepteur `sw.js` complet. Seul le maillon serveur est mort.

## Résumé

Six INFO, zéro FAIBLE : le front n'écoute aucun des deux événements de
refus socket (P10 C3 tranché — le wire existe sans consommateur), une race
d'identité étroite sur changement de compte (sessionPromise non invalidée à
la déconnexion), des retours d'état absents sur la souscription/désinscription
push, des interfaces au milieu d'un corps de fonction, et la famille
d'hygiène habituelle (reprise de reconnexion dépendante d'un rappel externe,
double enregistrement du SW, `server:hello` sans auditeur, type `team`
aspiré, champs identité inertes, 348 lignes non-ASCII sans aucune CJK).
Tout le reste est solide : le cycle
d'imports est cassé au bon endroit, la purge de session est testée et
synchrone, l'idempotence de retrait est centralisée dans le client, les
montants affichés viennent du serveur (M3 verrouillé par test), et la
chaîne push cliente est complète — ce qui confirme que le MAJEUR de la
partie 9 est purement serveur.
