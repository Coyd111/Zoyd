# Partie 9 — Routes (hors match/league/tournament/br) (audit-3)

**Relecture :** 2026-10-26, base `main` au `d1e70e2`.
**Périmètre :** `server/routes/auth.mjs` (618 lignes, lu intégralement),
`routes/wallet.mjs` (492, lu intégralement), `routes/admin.mjs` (708, lu
intégralement), `routes/public.mjs` (480, lu intégralement),
`routes/social.mjs` (321, lu intégralement), `routes/chat.mjs` (231, lu
intégralement), `routes/realtime.mjs` (211, lu intégralement),
`routes/match.mjs` (466, lu intégralement — déjà croisé en partie 3 : seules
les gardes de route sont re-constatées ici). `routes/br.mjs`, `routes/league.mjs`
et `routes/tournament.mjs` ont leurs parties dédiées (5, 6, 7). Croisements :
`http-utils.mjs` (cookies, rotation, pagination), `persistence.mjs`
(`insertUser`, sessions, souscriptions push, `getHealthInfo`),
`push-notifications.mjs`, `realtimeClient.ts` (contrat front du push),
ledger `docs/audit-2/02-autorisation.md` (rangs 92-112).
**Anti faux-positifs :** ledgers `docs/audit-2/` (S1/S7/S8/S12 gravés),
invariants `docs/05-invariants.md`, commentaires `PIEGE:`/`INVARIANT:`.

## Verdicts par fichier

| Fichier | Verdict |
|---|---|
| `routes/auth.mjs` | Propre — validations moteur côté persistence, révocations complètes |
| `routes/wallet.mjs` | Propre — les 10 PIEGE d'en-tête sont réels et appliqués |
| `routes/admin.mjs` | Propre — 2FA sur toute opération financière/modération, CSV échappé |
| `routes/public.mjs` | 2 INFO (C3, C4) |
| `routes/social.mjs` | 2 INFO (C5, S12 connue) |
| `routes/chat.mjs` | 2 INFO (C4, C5) |
| `routes/realtime.mjs` | 1 MAJEUR (C1 : Web Push jamais délivré), INFO (C4) |
| `routes/match.mjs` | Propre (hors constats déjà gravés en partie 3) |

## Ce qui a été vérifié et jugé solide

- **auth.mjs** : liste blanche stricte à l'inscription ET au PATCH profil
  (`:113-118`, `:387-391` — mass assignment fermé) ; le `phone` invalide à
  l'inscription est refusé par le MOTEUR (`insertUser:1357-1367`,
  `isAnySupportedPhone`), la route n'a pas besoin de le re-valider ; le
  changement d'email exige le mot de passe actuel (`:472-479`) ; le
  changement de mot de passe révoque TOUTES les sessions app ET temps réel
  (B9, `:578-579`) ; `logout` sur groupe RL DÉDIÉ `auth_logout`, token
  facultatif, `skipRotation` (le session-fire-and-forget ne survit plus au
  logout, `:523-538`) ; suppression de compte exige `confirmForfeit`
  explicite et annonce le solde abandonné (`:598-609`) ; la sanction
  bloquante répond un code DÉDIÉ (`:163-185`) ; réinitialisation sans oracle
  d'énumération (réponse identique que le compte existe ou non, `:326-332`).
- **wallet.mjs** : tous les invariants d'en-tête sont appliqués —
  idempotence OBLIGATOIRE (`:221-226`), lecture de l'état d'idempotence
  DANS le mutex (`:247-282`), débit sous verrou puis FedaPay HORS verrou
  (`:283-289`, `:315`), remboursement conditionné à `payoutMaybeSent`
  (`:335-358`), tag `failed` + clé relâchée dans `finally` (`:383-407`),
  drapeau `abandonner` (le `return true` du callback ne sort pas de la
  requête, `:296`), montants autoritaires `buildWithdrawalAmounts`
  (`:426`). Le garde double-payout 409 est testé et fonctionnel.
- **admin.mjs** : rate limit AVANT le garde 2FA sur les 11 routes
  (`:172-707`) ; `requireAdmin2fa` sur toute opération financière
  (commissions, export, award, resolve-dispute, cancel, reload) et de
  modération (reports, sanctions, revoke) ; le trio 2FA status/setup/enable/
  verify seul en `requireAdmin` (documenté) ; le SETUP exige le mot de passe
  admin (`:492-504` — anti-takeover si le Map mémoire perdait ses secrets) ;
  ré-enrôlement d'une 2FA ACTIVE refusé 409 (`:510-518`) ;
  `markAdmin2faVerified` agit sur la session STOCKÉE via le token lu par
  `readBearerToken` — qui privilégie le cookie `zoyd_auth`
  (`http-utils.mjs:250-255`) ; award en DEUX PHASES (`deferSettlement: true`
  puis `settlePendingMatchResult`, `:624-638`) ; CSV échappé (`csvCell`)
  et préfixé BOM (`:103-107`, `:155`).
- **public.mjs** : `/metrics` fail-closed (403 sans `METRICS_TOKEN`,
  401 sur jeton erroné, comparaison temps CONSTANT sur hachages SHA-256,
  `:347-358`) ; `/api/health` 503 quand `stateTrusted` est faux (`:105`) ;
  proxies CODM exigent une session (`:131-136`, `:242-249`) ; flèches
  explicites pour la sanitisation (le PIEGE `map(sanitize)` = index en
  viewerId est évité, `:424-427`, `:444`) ; recherche bornée 50 et
  paginée (`:462-463`).
- **match.mjs (gardes de route)** : session partout, RL `social` sur
  create/join/arbiter/check-in/ready, parsing du corps HORS du mutex global
  (`:83-90` — l'INVARIANT « le verrou couvre la mutation, pas le parsing »),
  ordre global→wallet (`:91` puis `:117`, `:145` puis `:146`), whitelist du
  corps de résultat (`:313-321`), `require2faIfAdmin` sur result/arbiter
  (audit-2 S1 corrigé).
- **Points d'audit-2 clos vérifiés** : #101 (unsubscribe sans vérification
  d'appartenance de l'endpoint) est classé Conforme PAR DÉCISION — non
  re-constaté ; S8/S7/S12 restent leurs familles connues, je cite sans
  re-ranger.

## Constats

### C1 — MAJEUR : la chaîne Web Push est morte en silencieux — la résolution utilisateur→souscriptions ne peut JAMAIS aboutir

Prouvé par reproducteur vitest exécuté puis supprimé
(`upsertPushSubscription('user-target', {endpoint, keys})` puis
`getPushSubscriptionsForUser('user-target')` → **0** souscription, alors
que le comportement attendu est 1).

- **Le front** (`src/app/lib/realtimeClient.ts:390-418`) envoie la
  souscription BRUTE du navigateur (`PushManager.subscribe` : `endpoint`,
  `keys`, `expirationTime`) — conformément au contrat visible de la route :
  `{ subscription }`. Aucun champ `userId`.
- **La mémoire** (`persistence.mjs:3326-3330`) :
  `upsertPushSubscription(userId, subscription)` écrit
  `memoryPushSubscriptions.set(subscription.endpoint, subscription)` —
  le `userId` n'est stocké QUE dans la ligne Supabase (`user_id`), via
  `sbFire` (best-effort), jamais dans le payload mémoire.
- **Le rechargement** (`persistence.mjs:917-920`) :
  `memoryPushSubscriptions.set(s.endpoint, s.payload)` — la colonne
  `user_id` de la ligne n'est PAS fusionnée dans le payload ; au
  redémarrage, la mémoire ne sait toujours pas à qui appartient une
  souscription.
- **Le filtre** (`persistence.mjs:3337-3343`) :
  `payload.userId === userId || payload.user_id === userId` — aucun des
  deux n'existe dans le payload navigateur → **toujours vide**.
- **La conséquence** (`push-notifications.mjs:56-79`) :
  `sendPushToUser` retourne `{delivered: 0, attempted: 0}` pour TOUT le
  monde, sans log ni erreur — le PUSH NAVIGATEUR ne part JAMAIS. L'INVARIANT
  d'en-tête « notification créée EN BASE AVANT l'émission socket et l'envoi
  push » est respecté, mais son 3e canal est mort : le centre de
  notifications (base + socket) fonctionne, le push hors application ne
  part pas — le joueur qui a fermé l'onglet ne reçoit RIEN, alors que
  l'INVARIANT `:11` annonce précisément que le centre « doit survivre à un
  client non connecté » via le push.
- **Aucun test** ne couvre `getPushSubscriptionsForUser` (grep : définition
  seule) ; `countPushSubscriptions` compte la taille de la Map (métrique
  non nulle, faussement rassurante).
- **Gravité MAJEUR** : fonction entière cassée (la finalité de VAPID, du
  service worker et de `subscribeToRealtimePush`), sans impact argent/compte
  (les notifications restent visibles dans l'app ouverte). Le défaut
  d'audit-2 #101 (`unsubscribe` sans garde) reste INFÉRIEUR à celui-ci :
  là où audit-2 voyait « la suppression d'un abonnement inconnu est sans
  effet », la vraie cause est que la mémoire ne connaît JAMAIS le
  propriétaire — le même ignorant fait les deux rangs.

Piste de correctif : stocker `{ ...subscription, userId }` dans la Map
(ou fusionner `user_id` au chargement : `set(s.endpoint, { ...s.payload,
userId: s.user_id })`) ; le filtre `:3340` marchera alors des deux côtés.

### C2 — INFO : bornage et unicité du créateur de canal DM

- `POST /api/chat/channels` (`chat.mjs:108-151`) : `participants` filtré sur
  les comptes existants mais NON BORNÉ (le ledger audit-2 #94 le note déjà
  en S12) ; `name` non sanitisé (`:130`) ; `replyTo` non validé (`:183`) —
  famille S12 connue.
- Deux utilisateurs qui se créent chacun un canal DM vers l'autre produisent
  DEUX canaux distincts pour la même paire (`upsertChatChannel` n'a aucune
  clé de déduplication paire d'utilisateurs) : bruit de canal, sans accès
  croisé (le scope reste `participants`).

### C3 — INFO : `crypto.randomUUID()` utilisé sans import — dépendance implicite au global WebCrypto

- `public.mjs:151` et `:259`, `chat.mjs:177` appellent `crypto.randomUUID()`
  alors qu'aucun `import crypto` n'existe dans ces fichiers (seuls
  `createHash`/`timingSafeEqual` sont importés de `node:crypto`). Cela
  fonctionne car Node ≥ 19 expose le WebCrypto en global
  (`engines.node >= 22.13`, `.nvmrc = 22` — vérifié). Sous Node 18, ce
  serait un `ReferenceError` → 500 à chaque proxy CODM et message de chat.
  La dépendance est réelle mais non déclarée : un import explicite
  `crypto.randomUUID from 'node:crypto'` (ou `randomUUID`) la rendrait
  robuste au downgrade.

### C4 — INFO : plusieurs routes sans rate limit, en décalage avec l'en-tête du fichier

- `GET /api/chat/channels/:id` (`chat.mjs:79-106`) n'a AUCUN rate limit —
  les 4 autres routes du fichier l'ont ; l'en-tête (`:7-9`) laisse croire
  le contraire pour toutes.
- `GET /api/realtime/state/bootstrap` (`realtime.mjs:91-119`) n'en a pas :
  c'est la lecture la plus coûteuse du domaine (100 matchs + 50 tournois
  sanitisés + 4 listes), appelable en boucle.
- `routes/match.mjs` : schedule/room/launch/result/confirm/disputes/
  evidence/escalate n'ont pas de RL (create/join/arbiter/check-in/ready oui).
  Les gardes du moteur bornent l'impact, donc pas un défaut — mais le
  commentaire d'en-tête `:8-9` (« rate limit (social pour les actions
  sociales) ») ne décrit que la moitié du fichier.
- Standard : si un choix RL-per-endpoint est documenté ailleurs, renvoyer
  à ce doc ; sinon homogénéiser.

### C5 — INFO : famille S12 sur les routes sociales — items connus complétés

- `POST /api/social/report` (`social.mjs:215-279`) : `description` non
  bornée (le motif `reason` est sanitisé mais sans `slice`) ; `targetId`
  accepté sans vérifier que le compte existe ni que ce n'est pas soi-même
  — l'admin reçoit un signalement sans pseudo cible (l'ID reste filtrable,
  `reporter_id`/`target_id` indexés `:253-254`, et la lecture admin croise
  `getUserById`).
- L'identifiant du signalement est `RP-${Date.now().toString(36)}`
  (`:226`) : deux dépôts dans la MÊME milliseconde partagent l'ID —
  `sbUpsert` écraserait le premier signalement. Fenêtre étroite, mais un
  compteur ou `crypto.randomUUID()` (déjà disponible globalement, C3) la
  ferme gratuitement.
- `POST /api/social/request` : `deliverNotification` cible `body.targetId`
  (`:111`) AVANT le résultat du moteur — si `sendFriendRequest` échoue
  (throw → `respondMappedError`), le destinataire peut recevoir la
  notification d'une demande qui n'existe pas. Race très courte
  (notification non awaitée), sans accès à rien.

### C6 — INFO : découvert au fil de la relecture, concernant persistence.mjs (périmètre partie 2)

- `setInterval(cleanupExpired, 5 min)` démarre à l'IMPORT du module
  (`persistence.mjs:3016-3040`) : même motif que `channel-presence.mjs:77`
  (P8 C5) — hors `initCronJobs` (invariant « appelé une seule fois »),
  sans `unref`, et il purge aussi demandes d'ami et notifications lues.
  Effet nul en production, hygiene seulement.

## Point reporté : `/api/health` et `countPendingWithdrawals` (P4 C3)

- Confirmé : `getHealthInfo` (`persistence.mjs:1066-1123`) n'appelle PAS
  `countPendingWithdrawals` et n'expose AUCUN état de retrait — seulement
  `pendingSettlementDebts` (matches/leagues/tournaments, `:1115-1119`). La
  recommandation d'audit-2 (exposer `pendingWithdrawals`) n'a jamais été
  appliquée, et `countPendingWithdrawals` n'a AUCUN consommateur en
  production (définition + tests). Le constat P4 C3 reste ouvert tel quel
  : la santé ne signale ni les retraits `pending_review`, ni la file
  `payoutsEnAttente` — un séquestre de retrait est invisible hors logs.

## Résumé

Un MAJEUR nouveau : la chaîne Web Push est morte en silencieux — le
`userId` n'est jamais porté par le payload mémoire de souscription (front
brut, colonne `user_id` ignorée au rechargement), donc
`getPushSubscriptionsForUser` ne retrouve jamais rien et
`sendPushToUser` délivre toujours 0 — prouvé par reproducteur exécuté puis
supprimé ; tout l'apparat VAPID/service worker/souscription ne sert plus à
rien, tandis que la métrique `countPushSubscriptions` reste faussement
rassurante. Six INFO (déduplication DM, WebCrypto implicite, rate limits
incohérents avec les en-têtes, S12 sur les routes sociales, timer
module-load de persistence) et le point reporté P4 C3 confirmé encore
ouvert (health n'expose aucun état de retrait). Le reste du domaine est
solide : listes blanches strictes, révocations complètes au changement de
mot de passe, discipline de verrous et d'idempotence appliquée à la
lettre dans wallet.mjs, 2FA partout où l'argent ou la modération bouge.
