# Audit 2 — Autorisation et validation d'entrée sur les routes HTTP

**Périmètre** : `server/routes/*.mjs` (11 modules, 113 endpoints), `server/admin-totp.mjs`,
`server/http-utils.mjs`, `server/rate-limiter.mjs`, `server/moderation.mjs`,
`server/state-helpers.mjs`, et les fonctions de `server/persistence.mjs` appelées par les
routes (plus les moteurs `match-engine.mjs`, `league-engine.mjs`, `tournament-engine.mjs`,
`br-engine.mjs` pour ce qui touche l'autorisation).

**Aucun fichier applicatif n'a été modifié.** Ce document est un constat, pas un correctif.

**Méthode** : inventaire route par route (méthode, chemin, garde appliquée, validation des
entrées, ce qu'un corps falsifié permet). Chaque affirmation a été relue dans son contexte ;
celle qui n'a pas pu être confirmée est marquée **NON VÉRIFIÉ**.

---

## 1. Synthèse

| Sévérité | Nombre | IDs |
|---|---|---|
| Haute | 4 | S1, S2, S3, S4 |
| Moyenne | 4 | S5, S6, S7, S8 |
| Faible | 7 | S9, S10, S11, S12, S13, S14, S15 |
| **Total** | **15** | |

**Répartition des 113 endpoints par garde :**

| Garde | Nombre | Détail |
|---|---|---|
| Session (joueur authentifié) | 61 | — |
| Session + rôle `admin` vérifié **dans le moteur** (pas de 2FA) | 9 | ligues (8), `POST /api/br/lobbies` (1) |
| `requireAdmin2fa` (admin + TOTP) | 14 | `admin.mjs` (10), `wallet/deposit`, `league/refund`, `league/payments`, `br/.../finish` |
| `requireAdmin` seul (routes 2FA) | 4 | `2fa/status`, `2fa/setup`, `2fa/enable`, `2fa/verify` |
| Session temps réel (`Bearer` uniquement) | 4 | realtime bootstrap + push |
| Aucune session (public par nature) | 20 | auth (8), public (6), br (3), league (1), tournament (1), realtime (1) |
| Jeton applicatif | 1 | `GET /metrics` |
| **Total** | **113** | |

**Les 4 constats les plus graves sont des contournements de la 2FA admin** (S1, S2, S3) et
une **fuite de preuves de match dans une réponse publique** (S4).

---

## 2. Inventaire exhaustif

Légende des gardes :

- `PUB` = aucune session
- `SESS` = session applicative (`zoyd_auth` ou `Authorization: Bearer`)
- `SESS+role` = session + contrôle du rôle `admin` effectué **dans le moteur métier**, sans 2FA
- `2FA` = `requireAdmin2fa` (rôle admin **et** TOTP vérifié dans la fenêtre)
- `ADMIN` = `requireAdmin` (rôle admin seul)
- `RT` = session temps réel (en-tête `Bearer` uniquement)

### 2.1 `routes/auth.mjs` — 12 endpoints

| # | Méthode + chemin | Garde | Validation / remarque |
|---|---|---|---|
| 1 | `POST /api/auth/register` | PUB + RL `auth` | Liste blanche stricte `REGISTER_FIELDS` (pas de mass-assignment). Email regex, pseudo/streamerPseudo `sanitizeText`. `acceptAdult`/`acceptTerms` vérifiés côté persistance (`LEGAL_NOT_ACCEPTED`). Voir S14 (champs non validés). |
| 2 | `POST /api/auth/login` | PUB + RL `auth` | `authenticateUserAccount` (scrypt, `timingSafeEqual`). Sanction bloquante → 403 `ACCOUNT_SANCTIONED`. **Conforme.** |
| 3 | `POST /api/auth/activate` | PUB + RL `auth` | Code par `timingSafeEqual`, 5 tentatives max, expiration. Route morte (les comptes sont créés actifs) mais inoffensive. |
| 4 | `POST /api/auth/resend-code` | PUB + RL `auth` | `resendActivationCode` refuse les comptes actifs. **Conforme.** |
| 5 | `POST /api/auth/activation-email` | PUB + RL `auth` | **Aucune session, aucun mot de passe** ; mute l'email d'un compte. Neutralisé par `isActive !== false`. Voir **S9**. |
| 6 | `POST /api/auth/forgot-password` | PUB + RL `auth` | Réponse identique que le compte existe ou non (pas d'oracle d'énumération). **Conforme.** |
| 7 | `POST /api/auth/reset-password` | PUB + RL `auth` | Code 8 chiffres, 5 tentatives, 15 min, révocation de toutes les sessions. **Conforme.** |
| 8 | `GET /api/auth/me` | SESS | Renvoie le dossier de l'appelant (email/telephone/portefeuille inclus) — normal. |
| 9 | `PATCH /api/auth/me` | SESS + RL `auth` | Liste blanche `ALLOWED_PROFILE_FIELDS`, énumérations, bornes `levelCODM` (1-150), `pseudo` ≤ 30, `bio` ≤ 500, téléphone formaté, changement d'email **exigeant le mot de passe courant**. **Conforme.** |
| 10 | `POST /api/auth/logout` | PUB + RL `auth_logout` (session facultative) | Groupe de quota dédié, `skipRotation`. **Conforme.** |
| 11 | `POST /api/auth/change-password` | SESS + RL `auth` | Mot de passe courant exigé, force brute du nouveau mot de passe vérifiée, révoque **toutes** les sessions + temps réel. **Conforme.** |
| 12 | `DELETE /api/auth/me` | SESS + RL `auth` | `confirmForfeit === true` exigé ; solde gelé bloquant la suppression ; admin ne peut pas s'auto-supprimer. **Conforme.** |

### 2.2 `routes/admin.mjs` — 14 endpoints

| # | Méthode + chemin | Garde | Validation / remarque |
|---|---|---|---|
| 13 | `POST /api/admin/reload` | 2FA + RL `admin` | **Conforme.** |
| 14 | `GET /api/admin/commissions` | 2FA + RL `admin` | **Conforme.** |
| 15 | `GET /api/admin/reports` | 2FA + RL `admin` | `status`/`targetId` = chaînes libres en query (non filtrables) ; pagination bornée 1-500. |
| 16 | `POST /api/admin/reports/:id/resolve` | 2FA + RL `admin` | `resolution` validée par `isSanctionKind` ; `note` `sanitizeText` ; `durationDays` borné à [1,30] par `computeExpiry` ; rejouer un signalement traité → 409. **Conforme.** |
| 17 | `GET /api/admin/sanctions` | 2FA + RL `admin` | `userId` en query, filtré. **Conforme.** |
| 18 | `POST /api/admin/sanctions/:id/revoke` | 2FA + RL `admin` | 404 si inconnue ou déjà levée (pas de réécriture de trace). **Conforme.** |
| 19 | `GET /api/admin/matches/export` | 2FA + RL `admin` | CSV échappé + BOM. Écrit en `res.writeHead` (échappe aux en-têtes CORS — sans effet ici, route à jeton admin). |
| 20 | `GET /api/admin/2fa/status` | ADMIN + RL `admin` | Ne renvoie que `enabled`/`serverTime`/`period`. **Conforme.** |
| 21 | `POST /api/admin/2fa/setup` | ADMIN + RL `admin` + **mot de passe** | Anti-takeover : refuse de ré-enrôler une 2FA active. **Voir S10** (garde reposant sur le Map mémoire). |
| 22 | `POST /api/admin/2fa/enable` | ADMIN + RL `admin` | Code TOTP vérifié (`timingSafeEqual`, fenêtre 0 pas = 30 s, rejouable dans son pas). **Conforme.** |
| 23 | `POST /api/admin/2fa/verify` | ADMIN + RL `admin` | Idem. Fenêtre de marquage : 5 min. **Voir S11** (source de jeton). || 24 | `POST /api/admin/matches/:id/award` | 2FA + RL `admin` | `winnerTeam` strict (0/1), règlement en deux phases. **Conforme.** |
| 25 | `POST /api/admin/matches/:id/resolve-dispute` | 2FA + RL `admin` | `action` ∈ {settle, refund, none} validé dans le moteur. **Conforme.** |
| 26 | `POST /api/admin/matches/:id/cancel` | 2FA + RL `admin` | Refus si déjà soldé. **Conforme.** |

### 2.3 `routes/social.mjs` — 12 endpoints

| # | Méthode + chemin | Garde | Validation / remarque |
|---|---|---|---|
| 27 | `GET /api/social/friends` | SESS | `getPublicUserById` → pas d'email/telephone/portefeuille. **Conforme.** |
| 28 | `GET /api/social/pending` | SESS | **Conforme** (direction entrante seulement). |
| 29 | `POST /api/social/request` | SESS + RL `social` | `targetId` doit exister (`USER_NOT_FOUND`). `body.message` **non sanitisé**. Voir S12. |
| 30 | `POST /api/social/accept` | SESS + RL `social` | `requestId` vérifié comme appartenant à l'appelant (`target_id !== userId` → 401). **Mais la réponse contient le dossier complet de l'expéditeur — voir S6.** |
| 31 | `POST /api/social/decline` | SESS + RL `social` | Même contrôle de propriété. **Conforme.** |
| 32 | `DELETE /api/social/friends/:id` | SESS + RL `social` | N'affecte que la relation de l'appelant. **Conforme.** |
| 33 | `POST /api/social/block` | SESS + RL `social` | `targetId` non validé (type/existence) — sans impact. Voir S13. |
| 34 | `POST /api/social/unblock` | SESS + RL `social` | Idem. |
| 35 | `POST /api/social/report` | SESS + RL `social` | `reporterId` = session (pas de corps). Gravité calculée serveur (`severityForReason`). `targetId` non validé. Voir S13. |
| 36 | `POST /api/notifications/read` | SESS + RL `default` | `markNotificationAsRead(session.user.id, …)` → scopé au compte. **Conforme.** |
| 37 | `POST /api/notifications/read-all` | SESS + RL `default` | Scopé au compte. **Conforme.** |
| 38 | `GET /api/notifications` | SESS | Uniquement les non-lus du compte. **Conforme.** |

### 2.4 `routes/wallet.mjs` — 5 endpoints

| # | Méthode + chemin | Garde | Validation / remarque |
|---|---|---|---|
| 39 | `GET /api/wallet/history` | SESS + RL `default` | Scopé au compte, `limit` plafonné à 200. **Conforme.** |
| 40 | `GET /api/wallet/me` | SESS + RL `default` | Dossier + politique de retrait. **Conforme.** |
| 41 | `POST /api/wallet/deposit` | **2FA** + RL `wallet` | `amount` ∈ (0, 5 000 000], `userId` exigé. **Conforme.** |
| 42 | `POST /api/wallet/withdraw` | SESS + RL `wallet` | Montant ∈ [150, 100 000], pays whitelisté, opérateur whitelisté, téléphone parsé, **clé d'idempotence obligatoire**, état lu dans le mutex, appel FedaPay hors verrou, remboursement conditionné à `payoutMaybeSent !== true`. **Conforme.** |
| 43 | `POST /api/wallet/verify-fedapay` | SESS + RL `wallet` | `transactionId` numérique, transaction relue chez FedaPay, statut `approved`, **anti-vol par appartenance** (`ZOYD:<userId>`), devise XOF, idempotence BDD. **Conforme.** |

### 2.5 `routes/tournament.mjs` — 9 endpoints

| # | Méthode + chemin | Garde | Validation / remarque |
|---|---|---|---|
| 44 | `GET /api/tournaments/:id` | PUB + RL `default` | `sanitizeTournamentForBroadcast` : `captainId`, `members[].userId`, `arbiters[].userId` retirés. **Conforme** (sauf `payload.notes` non sanitisé, cf. S12). |
| 45 | `POST /api/tournaments` | SESS + RL `default` | Format 1VS1-5VS5, `maxEntries` 2-256, `entryFee` arrondi à 2 décimales. **Conforme.** |
| 46 | `POST /api/tournaments/:id/register` | SESS + RL `default` | Capitaine forcé à son **propre pseudo** ; coéquipiers résolus par `userId` **ou** pseudo exact, doivent exister ; unicité de squad ; roster complet ; pass verrouillé. **Conforme.** |
| 47 | `POST /api/tournaments/:id/leave` | SESS + RL `default` | Seul le capitaine ; remboursement. **Conforme.** |
| 48 | `POST /api/tournaments/:id/arbiter` | SESS | Un joueur ne peut pas arbitrer son propre tournoi. **Conforme.** |
| 49 | `POST /api/tournaments/:id/start` | SESS | Arbitre du tournoi **ou admin**. Lance le bracket. |
| 50 | `POST /api/tournaments/:id/matches/:mid/room` | SESS | `requireTournamentMatchAction` : slot d'arbitre assigné **ou admin**. `roomName` ≤ 100, `roomPassword` ≤ 50, `sanitizeText`. **Conforme.** |
| 51 | `POST /api/tournaments/:id/matches/:mid/live` | SESS | Même garde ; salle publiée exigée. **Conforme.** |
| 52 | `POST /api/tournaments/:id/matches/:mid/result` | SESS + RL `default` | Même garde, **mais l'override admin déclenche `applyTournamentSettlement` sans 2FA — voir S3.** `winnerEntryId` doit être l'un des deux participants ; scores finis et distincts. |

### 2.6 `routes/league.mjs` — 15 endpoints

| # | Méthode + chemin | Garde | Validation / remarque |
|---|---|---|---|
| 53 | `GET /api/leagues` | SESS + RL `default` | Retire `members[].playerId` **seulement** ; `registeredPlayers[].userId` et `standings[].userId` restent. **Voir S5.** |
| 54 | `GET /api/leagues/:id` | SESS + RL `default` | Renvoie la saison **brute** (aucune sanitisation). **Voir S5.** |
| 55 | `POST /api/leagues` | SESS | `createLeagueSeasonOnServer` : rôle admin requis (`FORBIDDEN`). `name` 3-100, `teamSize` 1-5. |
| 56 | `POST /api/leagues/:id/join` | SESS | Statut `registering`, capacité, unicité, pass verrouillé sous mutex, **remboursement compensé si `saveLeagues` échoue**. **Conforme.** |
| 57 | `POST /api/leagues/:id/leave` | SESS | Inscrit uniquement, remboursement. **Conforme.** |
| 58 | `POST /api/leagues/:id/start-qualification` | SESS+role admin | ≥ 10 inscrits. **Voir S2** (chaîne sans 2FA). |
| 59 | `POST /api/leagues/:id/days/:day/start` | SESS+role admin | `dayKey` strictement whitelisté (anti-`__proto__`). **Voir S2.** |
| 60 | `POST /api/leagues/:id/days/:day/results` | SESS+role admin | `userId` ∈ inscrits de la journée, pas de doublon, placement 1-100. **Voir S2.** |
| 61 | `POST /api/leagues/:id/advance-to-final` | SESS+role admin | Toutes les journées terminées. **Voir S2.** |
| 62 | `POST /api/leagues/:id/final-results` | SESS+role admin | Classement final complet, un placement par finaliste, pas de doublon. **Déclenche le versement — voir S2.** |
| 63 | `GET /api/leagues/:id/leaderboard` | **PUB** + RL `default` | Renvoie `standings` bruts. **Voir S15.** |
| 64 | `PATCH /api/leagues/:id` | SESS+role admin | `maxPlayers` 10-1000, `entryFee` fini 0-500 arrondi, tarif figé dès la première inscription. **Voir S2.** |
| 65 | `POST /api/leagues/:id/reassign` | SESS+role admin | `fromDay`/`toDay` whitelistés, joueur réellement assigné. **Voir S2.** |
| 66 | `POST /api/leagues/:id/refund/:userId` | **2FA** | Joueur inscrit, saison non soldée. **Conforme.** |
| 67 | `GET /api/leagues/:id/payments` | **2FA** + RL `admin` | **Conforme.** |

### 2.7 `routes/br.mjs` — 11 endpoints

| # | Méthode + chemin | Garde | Validation / remarque |
|---|---|---|---|
| 68 | `GET /api/br/config` | PUB | Constantes de jeu. **Conforme.** |
| 69 | `GET /api/br/lobbies` | PUB + RL `default` | `toPublicBrLobby` : `players[].userId`, `killedBy`, `arbiterId`, `creatorId`, `teams[].key` retirés. **Conforme.** |
| 70 | `POST /api/br/lobbies` | SESS + RL `match`→`default` | `createBrLobbyOnServer` : rôle **admin** requis ; mode/map whitelistés ; pass ∈ [min,max] ; date à 24-48 h ; `payout` validé ; **l'arbitre doit être un admin existant**. **Conforme.** |
| 71 | `POST /api/br/lobbies/:id/join` | SESS + RL `default` | Statut `scheduled`, pas de doublon, capacité, équipe complète, **pass verrouillé après toutes les validations** (remboursé en cas d'échec ultérieur). **Conforme.** |
| 72 | `POST /api/br/lobbies/:id/leave` | SESS + RL `default` | **Conforme.** |
| 73 | `POST /api/br/lobbies/:id/checkin` | SESS + RL `default` | Inscrit uniquement, pas de double pointage. **Conforme.** |
| 74 | `POST /api/br/lobbies/:id/start` | SESS + RL `default` | Organisateur ou arbitre uniquement ; fenêtre ±10 min ; ≥ 5 présents ; cagnotte recalculée depuis les réservations wallet réelles. **Conforme.** |
| 75 | `POST /api/br/lobbies/:id/eliminate` | SESS + RL `default` | **`requireLobbyArbiter`** : seul l'arbitre du salon ; joueur éliminé ∈ roster ; tueur ∈ roster, vivant, présent ; `assists` borné à [0,10]. **Conforme.** |
| 76 | `POST /api/br/lobbies/:id/finish` | **2FA** + RL `admin` | `requireAdmin2fa` **puis** `requireLobbyArbiter` dans le moteur ; progression persistée à chaque versement (reprise idempotente). **Conforme.** |
| 77 | `GET /api/br/lobbies/:id` | PUB + RL `default` | Vue publique ; `projectedPayouts` sanitisés (`toPublicBrRanking`). **Conforme.** |
| 78 | `GET /api/br/lobbies/:id/arbiter` | SESS + **arbitre du salon ou créateur** | Seule vue qui rend les `userId` (nécessaires pour `eliminate`). **Conforme.** |

### 2.8 `routes/match.mjs` — 13 endpoints

| # | Méthode + chemin | Garde | Validation / remarque |
|---|---|---|---|
| 79 | `POST /api/matches` | SESS + RL `social` | Format 1VS1-5VS5, `entryFee` fini ≥ 0 arrondi, `tournamentId` UUID. `rules` (objet libre) non borné → S12. |
| 80 | `POST /api/matches/:id/join` | SESS + RL `social` | Statut clos, déjà inscrit, rôle d'arbitre, `trustScoreMin`, restrictions device/controller, équipe disponible, pass verrouillé. **Conforme.** |
| 81 | `POST /api/matches/:id/arbiter` | SESS + RL `social` | Place libre, **un joueur ne peut pas arbitrer son propre match**. Aucune restriction de rôle → un admin peut prendre la place d'arbitre. **Voir S1.** |
| 82 | `POST /api/matches/:id/check-in` | SESS + RL `social` | Joueur du match uniquement. **Conforme.** |
| 83 | `POST /api/matches/:id/ready` | SESS + RL `social` | Joueur du match, présence exigée. **Conforme.** |
| 84 | `POST /api/matches/:id/schedule` | SESS | Créateur, arbitre, joueur **ou admin**. Horodatage non validé (chaîne libre) → S12. |
| 85 | `POST /api/matches/:id/room` | SESS | **Arbitre du match ou admin** ; salle complète exigée ; ≤ 10 min avant l'heure ; `roomName` ≤ 100, `roomPassword` ≤ 50, `sanitizeText`. **Conforme** (mais l'override admin n'est pas 2FA). |
| 86 | `POST /api/matches/:id/launch` | SESS | **Arbitre ou admin** ; roster complet, tous présents et prêts, salle publiée. **Conforme.** |
| 87 | `POST /api/matches/:id/result` | SESS | **Arbitre, ou admin en override.** Ni statut `in_progress`, ni roster complet, ni preuves exigés dans le cas admin. **Voir S1 — contournement de la 2FA.** `winnerTeam` strict 0/1 ; `proofs` normalisés (10 réf. max, schémas dangereux exclus) ; `screenshots` non validés en tableau ; `scores` non validés. |
| 88 | `POST /api/matches/:id/confirm` | SESS | Joueur du match, un seul vote, pas de double confirmation. **Mais la réponse expose les `userId` des autres — voir S8.** |
| 89 | `POST /api/matches/:id/disputes` | SESS | Joueur, arbitre **ou admin** ; match non soldé ; raison + ≥ 1 preuve ; un seul litige actif. `category` non validée → S12. **Conforme** (hors override admin sans 2FA). |
| 90 | `POST /api/matches/:id/dispute/evidence` | SESS | Joueur ou arbitre **ou admin** ; litige actif exigé ; références normalisées. **Conforme.** |
| 91 | `POST /api/matches/:id/dispute/escalate` | SESS | **Arbitre ou admin** ; un seul passage au niveau 2. **Conforme.** |

### 2.9 `routes/chat.mjs` — 5 endpoints

| # | Méthode + chemin | Garde | Validation / remarque |
|---|---|---|---|
| 92 | `GET /api/chat/bootstrap` | SESS + RL `chat` | 50 canaux, 10 actifs × 20 messages. **Conforme.** |
| 93 | `GET /api/chat/channels/:id` | SESS | `canAccessChatChannel` (admin, scope public, ou participant) ; refus = **404** (pas d'énumération). **Mais `participants` (userId) est renvoyé brut — voir S7.** |
| 94 | `POST /api/chat/channels` | SESS + RL `chat` | Type whitelisté (`private|match|team|dm`) ; participants filtrés sur les comptes existants ; expéditeur = session. `name` non sanitisé, tableau `participants` non borné, type `match` fabricable → S12. |
| 95 | `POST /api/chat/channels/:id/messages` | SESS + RL `chat` | Contrôle d'accès au canal ; `text` `sanitizeText` + 2000 ; `senderId` = session ; `replyTo` non validé → S12. **Conforme** (hors `replyTo`). |
| 96 | `POST /api/chat/channels/:id/read` | SESS + RL `chat` | Contrôle d'accès ; accusé scopé au compte. **Conforme.** |

### 2.10 `routes/realtime.mjs` — 6 endpoints

| # | Méthode + chemin | Garde | Validation / remarque |
|---|---|---|---|
| 97 | `POST /api/realtime/auth/session` | SESS + RL `auth` | Crée une session temps réel (entrée serveur). **Conforme.** |
| 98 | `GET /api/realtime/push/public-key` | PUB | Clé VAPID **publique** uniquement. **Conforme.** |
| 99 | `GET /api/realtime/state/bootstrap` | RT | Bootstrap borné (100 matchs, 50 tournois) ; matchs/tournois sanitizés ; amis/notifications/blocs scopés au compte. **Conforme.** |
| 100 | `POST /api/realtime/push/subscribe` | RT | `endpoint` exigé. **Conforme.** |
| 101 | `POST /api/realtime/push/unsubscribe` | RT | `endpoint` exigé. **Conforme.** (l'endpoint n'est pas vérifié comme appartenant au compte — sans impact : la suppression d'un abonnement push inconnu est sans effet.) |
| 102 | `POST /api/realtime/push/test` | RT | Notification de test au compte de l'appelant. **Conforme.** |

### 2.11 `routes/public.mjs` — 11 endpoints

| # | Méthode + chemin | Garde | Validation / remarque |
|---|---|---|---|
| 103 | `GET /api/health` | PUB | 503 si l'état n'est pas fiable. **Conforme.** |
| 104 | `GET /api/realtime/health` | PUB | **Conforme.** |
| 105 | `GET /api/codm/store` | SESS + RL `default` | Proxy Codashop : session exigée (évite un proxy gratuit pour Internet). **Conforme.** |
| 106 | `GET /api/codm/player/:id` | SESS + RL `default` | `userId` numérique `^\d{1,20}$`. **Conforme.** |
| 107 | `GET /metrics` | Jeton `METRICS_TOKEN` | 403 si non configuré ; comparaison en temps constant sur hachages SHA-256. **Conforme.** |
| 108 | `GET /api/users/:id` | SESS | `getPublicUserById` → pas d'email/telephone/portefeuille/legal. **Conforme.** |
| 109 | `GET /api/leaderboard` | PUB + RL `default` | Champs selected (id, pseudo, elo, winRate, …). **Conforme.** |
| 110 | `GET /api/stats` | PUB + RL `default` | Agrégats seulement. **Conforme.** |
| 111 | `GET /api/matches` | **PUB** + RL `default` | `sanitizeMatchForBroadcast` appliqué — **mais la sanitisation est incomplète : voir S4.** |
| 112 | `GET /api/tournaments` | PUB + RL `default` | `sanitizeTournamentForBroadcast` avec le spectateur. **Conforme.** |
| 113 | `GET /api/users/search` | SESS + RL `social` | Champs selected, `limit` ≤ 50. **Conforme.** |

---

## 3. Constats

### S1 — HAUTE — La 2FA admin est contournable : attribuer un match et verser la cagnotte par la route joueur

**Fichiers** : `server/routes/match.mjs:288` (`POST /api/matches/:id/result`),
`server/routes/match.mjs:154` (`POST /api/matches/:id/arbiter`),
`server/match-engine.mjs:931`, `server/match-engine.mjs:943`,
`server/routes/admin.mjs:586` (route admin équivalente).

**Chemin d'exploitation.** Le threat model de la 2FA est « mot de passe admin compromis »
(phishing, XSS, poste partagé) : la 2FA doit alors bloquer l'argent. Or le même pouvoir
existe sur un chemin qui ne demande **aucun code TOTP** :

1. L'attaquant dispose du mot de passe admin (pas du TOTP). Il s'authentifie et obtient une
   session `role: 'admin'`.
2. `POST /api/matches/:id/result` avec `{ "winnerTeam": 0 }`. La route (`match.mjs:289-294`)
   n'exige **que** une session — pas `requireAdmin2fa`.
3. Dans `submitMatchResultOnServer`, le garde est :
   ```js
   if (!isArbiter && actorUser.role !== 'admin') throw makeError('ARBITER_REQUIRED', …);   // match-engine.mjs:931
   const isAdminOverride = actorUser.role === 'admin';                                     // match-engine.mjs:943
   ```
   L'override admin **saute** le contrôle `status === 'in_progress'`, le roster complet
   (`NOT_ENOUGH_PLAYERS`) **et** l'exigence de preuves (`PROOFS_REQUIRED`). Le résultat est
   persisté avec `payoutDistributed: 'pending'` et `confirmationDeadline = now + 30 min`.
4. La cagnotte part sans que personne n'ait à confirmer : le job cron
   `sweepExpiredConfirmations` (`server/cron.mjs:474-486`) appelle
   `expireConfirmationsOnServer` → `applyResultSettlement` → `releaseWalletWinnings` vers
   l'équipe désignée par l'attaquant.
5. Si le match n'a pas encore d'arbitre, `applyResultSettlement` refuse de verser
   (`ARBITER_REQUIRED`, garde le plus près de la sortie d'argent). L'attaquant prend alors la
   place d'arbitre **avant** l'étape 2 : `POST /api/matches/:id/arbiter` (`match.mjs:154`,
   aucun 2FA) — `assignArbiterOnServer` (`match-engine.mjs:706`) ne refuse que les joueurs
   du match, pas les admins.

**Preuve.** La route jumelle qui fait exactement la même chose
(`POST /api/admin/matches/:id/award` → `submitMatchResultOnServer(..., { deferSettlement: true })`
puis `settlePendingMatchResult`) est protégée par `requireAdmin2fa` (`admin.mjs:586`). Deux
chemins, une seule barrière : c'est le chemin non protégé qui est le plus court.

Confirmation directe dans le code : le commentaire de `expireConfirmationsOnServer`
(`server/match-engine.mjs:1169-1172`) décrit exactement ce scénario —

> « Cas reel : un resultat soumis par un admin sur un match sans arbitre declenche
> ARBITER_REQUIRED au reglement (l'admin peut ecrire un resultat, mais l'argent ne sort pas
> sans tiers). »

autrement dit : *l'admin peut écrire un résultat*, et dès qu'un arbitre existe l'argent sort
tout seul. La seule action manquante pour l'attaquant est de s'attribuer la place d'arbitre
(étape 5 ci-dessus), laquelle ne demande aucun TOTP.

**Correction.** Retirer l'override admin de `submitMatchResultOnServer` pour cette route, ou
appliquer `requireAdmin2fa` sur `POST /api/matches/:id/result` quand
`session.user.role === 'admin'` — en reprenant le motif déjà utilisé par
`POST /api/admin/matches/:id/award`. Idem pour `POST /api/matches/:id/arbiter` si l'on
interdit aux admins de prendre une place d'arbitre sur un match sans arbitre.

**Correctif (23/10/2026)** : la nouvelle garde `require2faIfAdmin`
(`server/admin-totp.mjs`) passe toute session non admin et exige, pour une
session admin, la même fenêtre 2FA que `requireAdmin2fa` (2FA activée **et**
vérifiée depuis moins de 5 min). Appliquée sur les deux chemins joueur :
- `POST /api/matches/:id/result` — l'override admin paie le code TOTP, exactement
  comme la route jumelle `award` ;
- `POST /api/matches/:id/arbiter` — un admin ne peut plus s'attribuer une place
  d'arbitre sans TOTP : c'est ce qui fermait la boucle (devenir arbitre pour
  caser la cagnotte par la voie normale d'arbitrage).
Le garde `ARBITER_REQUIRED` du moteur reste le contrôle de proximité du
versement. Tests : `server/admin-result-2fa-gates.test.mjs` — admin sans 2FA,
2FA activée jamais vérifiée, 2FA fraiche, arbitre ordinaire.

---

### S2 — HAUTE — La cagnotte de la ligue BR est versée sans 2FA

**Fichiers** : `server/routes/league.mjs:312` (`POST /api/leagues/:id/final-results`),
`server/routes/league.mjs:271` (`…/days/:day/results`),
`server/routes/league.mjs:295` (`…/advance-to-final`),
`server/league-engine.mjs:599`, `server/league-engine.mjs:491`, `server/league-engine.mjs:674`
→ `server/league-engine.mjs:697` (`applyLeagueSettlement`).

**Chemin d'exploitation.** `POST /api/leagues/:id/final-results` exige **une session** ; le
rôle admin est vérifié dans le moteur (`league-engine.mjs:599`) :

```js
if (actorUser.role !== 'admin') throw makeError('FORBIDDEN', 'Seul un administrateur peut soumettre les resultats de la finale.');
```

Aucun `requireAdmin2fa` sur la route. `submitLeagueFinalResultsOnServer` appelle
`applyLeagueSettlement(season)` (`league-engine.mjs:674`), qui distribue de l'argent réel :
`releaseWalletWinnings` pour le 1er/2e/3e (60 % / 25 % / 15 % de la cagnotte) et
`settleMatchLossWallet` pour tous les autres.

La chaîne complète est donc accessible **sans TOTP** :

| Étape | Route | Garde | Argent |
|---|---|---|---|
| 1 | `POST /api/leagues/:id/days/:day/results` | session + rôle admin | détermine le classement de qualification |
| 2 | `POST /api/leagues/:id/advance-to-final` | session + rôle admin | désigne les 40 finalistes |
| 3 | `POST /api/leagues/:id/final-results` | session + rôle admin | **verse la cagnotte** |

**Preuve.** La route voisine `POST /api/leagues/:id/refund/:userId` (`league.mjs:390-397`)
exige bien `requireAdmin2fa`, et `GET /api/leagues/:id/payments` (`league.mjs:413-416`)
aussi — un remboursement ponctuel est plus protégé qu'un versement complet. Côté front,
`submit-final-results` est classée parmi les actions « destructives »
(`src/features/league/pages/LeagueSeasonPage.tsx:154`) mais il ne s'agit que d'une
confirmation client : aucun code TOTP n'est demandé ni transmis
(`src/app/lib/leagueApi.ts:80-85`). Le serveur est bien la barrière — et il ne l'est pas ici.

**Correction.** Appliquer `requireAdmin2fa` sur `final-results` (impérativement) et sur
`days/:day/results` + `advance-to-final` (la chaîne deLigendes), comme cela est déjà fait
pour `refund` et `payments`.

**Correctif (23/10/2026)** : la chaîne complète passe sous `requireAdmin2fa`
(`server/routes/league.mjs`), alignée sur `refund/:userId` et `payments` —
un versement complet ne peut pas coûter moins qu'un remboursement ponctuel :
- `POST /api/leagues/:id/days/:day/results` (classement de qualification) ;
- `POST /api/leagues/:id/advance-to-final` (désignation des finalistes) ;
- `POST /api/leagues/:id/final-results` (versement 60/25/15 % + pertes).
Un non-admin reçoit désormais le 403 `ADMIN_REQUIRED` de la garde (avant, le
même 403 venait du moteur) : aucune régression d'autorisation.

---

### S3 — HAUTE — Le règlement d'un tournoi peut être déclenché sans 2FA

**Fichiers** : `server/routes/tournament.mjs:278` (`POST /api/tournaments/:id/matches/:mid/result`),
`server/tournament-engine.mjs:1309`, `server/tournament-engine.mjs:1449`.

**Chemin d'exploitation.** `requireTournamentMatchAction` (`tournament-engine.mjs:1308-1311`) :

```js
const assignedSlot = tournament.arbiters.find((arbiter) => arbiter.userId === actorUser.id);
if (actorUser.role !== 'admin' && assignedSlot?.slot !== match.arbiterSlot) {
  throw makeError('FORBIDDEN', 'Seul l arbitre du poste assigne peut agir sur ce duel.');
}
```

Un admin passe donc la garde **sans être l'arbitre du duel**. Si ce résultat termine le
tournoi, `applyTournamentSettlement(nextTournament)` s'exécute (`tournament-engine.mjs:1449-1451`)
et distribue la cagnotte aux finalistes. La route ne demande qu'une session
(`tournament.mjs:281-285`) et n'est pas sous 2FA.

**Preuve.** Les identifiants de tournoi et de duel sont publics : `GET /api/tournaments/:id`
est une route publique (`tournament.mjs:74`). Un compte admin compromis suffit donc à
déterminer le vainqueur d'un tournoi et à déclencher le versement.

**Correction.** `requireAdmin2fa` sur cette route pour le cas admin, ou retirer l'override
admin de `requireTournamentMatchAction` (comme pour S1).

**Correctif (23/10/2026)** : la même garde conditionnelle `require2faIfAdmin` est posée
sur `POST /api/tournaments/:id/matches/:mid/result` — l'override admin paie le
code TOTP ; l'arbitre assigné du duel garde son chemin normal. Le garde
`requireTournamentMatchAction` du moteur reste intact (contrôle de
proximité). Tests : `server/admin-result-2fa-gates.test.mjs`.

---

### S4 — HAUTE — Les preuves de match (captures, litiges) et des identifiants de joueurs sortent dans une réponse publique

**Fichiers** : `server/state-helpers.mjs:163` (`sanitizeMatchForBroadcast`),
`server/state-helpers.mjs:191-198`, `server/routes/public.mjs:412` (`GET /api/matches`),
`server/match-engine.mjs:983`, `server/match-engine.mjs:1245-1246`,
`server/state-helpers.mjs:117` (`broadcastMatchesToSessions`).

**Chemin d'exploitation.** La route `GET /api/matches` est **publique** (aucune session,
`public.mjs:412-433`). Elle applique bien `sanitizeMatchForBroadcast` — la même fonction que
la diffusion socket — mais **celle-ci est incomplète**. Elle retire `roomPassword`,
`roomName`, `screenshots`, `players[].userId`, `arbiter.userId`, `result.proofs`,
`result.screenshots`, `result.confirmedByTeams`… et laisse passer :

| Champ laissé | Contenu | Origine |
|---|---|---|
| `match.creatorId` | UUID du créateur du match | `match-engine.mjs:592` |
| `match.disputes[].requestedBy` | UUID du joueur qui a contesté | `match-engine.mjs:1246` |
| `match.dispute.requestedBy` | idem (copie singulière) | `match-engine.mjs:1254-1255` |
| `match.disputes[].evidence` | **les références de preuve du litige** | `match-engine.mjs:1245` |
| `match.result.proofHash` | **les captures de scoreboard, en clair** | `match-engine.mjs:983` |

Le point critique est `proofHash` : ce n'est **pas** un hash. `buildProofHash`
(`server/match-engine.mjs`) est une simple concaténation :

```js
const buildProofHash = (matchId, winnerTeam, scores, refs) =>
  [String(matchId).toLowerCase(), winnerTeam, scores?.team0 ?? 0, scores?.team1 ?? 0,
   ...refs.map((ref) => ref.toLowerCase())].join('|');
```

La sanitisation supprime `result.proofs` et `result.screenshots` mais conserve `proofHash` :
les URL de captures reviennent donc en clair dans la réponse publique. Le front les affiche
d'ailleurs explicitement à tous les joueurs : `src/features/match/components/MatchResults.tsx:92`
— « Hash de preuve : {match.result.proofHash} ».

Quant à `disputes[].evidence`, ce sont des URLs libres saisies par le joueur
(`normalizeProofRefs` n'interdit que `javascript:`, `vbscript:`, `data:` non-image et les
chevrons) : elles sont publiées telles quelles.

**Portée.** Le même défaut touche la diffusion socket : `broadcastMatchesToSessions`
(`state-helpers.mjs:117-128`) émet `state:matches` avec le **même** payload vers chaque
socket connecté — donc vers des clients qui n'ont aucune qualité de partie.

**Preuve.** Le code de `sanitizeMatchForBroadcast` (`state-helpers.mjs:163-200`) est la
source : `const { roomPassword, roomName, screenshots, ...safe } = match;` puis aucune
suppression de `creatorId`, `disputes`, `dispute`, `proofHash`.

**Correction.** Étendre `sanitizeMatchForBroadcast` : retirer `creatorId`,
`disputes`/`dispute` (ou au minimum `requestedBy` et `evidence`), et `result.proofHash`
(remplacer par un condensat réel, ou le supprimer). Si les litiges doivent rester visibles,
les rendre par socket aux seules parties (comme `isMe`).

---

### S5 — MOYENNE — La saison de ligue n'est jamais sanitisée : ni en HTTP, ni en socket

**Fichiers** : `server/routes/league.mjs:121` (détail), `server/routes/league.mjs:91-97`
(liste), `server/state-helpers.mjs:354-359` (`saveLeagues`),
`server/state-helpers.mjs:367` (`buildLeagueActionPayload`),
`server/push-notifications.mjs:111-113` (`broadcastStateSnapshot`).

**Chemin d'exploitation.** `GET /api/leagues/:id` renvoie la saison **brute** :

```js
respondJson(res, 200, { ok: true, season });     // league.mjs:121
```

alors que `normalizeLeagueSeason` (`league-engine.mjs:118-197`) construit un objet qui
contient `registeredPlayers[].userId`, `standings[].userId`, `qualificationGroups[].players[]`
(les userId), `finalists[].userId`, `podium.{first,second,third}`, `finalMatch.results[].userId`,
et surtout les dettes **`pendingPayouts[]`**, `pendingRefunds[]`, `uncollectableRefunds[]`
(userId + montant + `lastError`).

La route de liste (ligne 91-97) ne retire que `members[].playerId` — `registeredPlayers[].userId`
et `standings[].userId` y restent également.

Aggravant : la règle « la sanitisation sert DEUX sorties » (`state-helpers.mjs:9-10`) n'est
pas respectée pour les ligues. Il n'existe **aucun** `sanitizeLeagueForBroadcast` ;
`saveLeagues` diffuse la saison brute à tout le monde :

```js
const saveLeagues = async (io, seasons) => {
  await replaceStateCollection('leagues', seasons);
  const storedLeagues = getStoredLeagues();
  broadcastStateSnapshot(io, 'leagues', storedLeagues);      // state-helpers.mjs:356
```

et `broadcastStateSnapshot` fait un `io.emit` global (`push-notifications.mjs:112`).
`buildLeagueActionPayload` (`state-helpers.mjs:367-375`) renvoie lui aussi la saison brute dans
toutes les réponses POST de la ligue.

**Preuve.** Le module de routes documentait le risque et n'a protégé que la moitié :
« la reponse renvoyait la saison EN CLAIR, avec le `userId` de chaque joueur inscrit…
exiger une session ferme desormais l'exposition anonyme sans toucher au client »
(`league.mjs:74-81`). La fermeture de l'accès anonyme a été faite ; la sanitisation, non.

**Correction.** Écrire `sanitizeLeagueForBroadcast(season, viewerId)` (retrait des UUID,
`isMe`, et des dettes `pending*`/`uncollectable*`) et l'appliquer aux trois sorties : liste,
détail, socket — plus `buildLeagueActionPayload`.

---

### S6 — MOYENNE — `POST /api/social/accept` renvoie le dossier complet de l'expéditeur d'une demande d'ami

**Fichiers** : `server/routes/social.mjs:144`, `server/persistence.mjs:3766`,
`server/persistence.mjs:277` (`sanitizeUserPayload`), `server/persistence.mjs:1471`
(`getPublicUserById`).

**Chemin d'exploitation.** `acceptFriendRequest` se termine par :

```js
return getUserById(req.sender_id);      // persistence.mjs:3766
```

`getUserById` renvoie `sanitizeUserPayload(user)` (`persistence.mjs:277`), qui **conserve**
`email`, `phone`, `gameId`, `legal`, `stats`, `progression`, `achievements` et le
`wallet` complet (dont l'**historique des transactions**). La route le renvoie tel quel :

```js
respondJson(res, 200, { ok: true, friend });   // social.mjs:144
```

alors que la lecture de la liste d'amis utilise, elle, `getPublicUserById`
(`persistence.mjs:1471`) qui retire `wallet`, `walletBalance`, `email`, `phone`, `legal`.

**Chemin concret.** La cible envoie une demande d'ami à l'attaquant (le pseudo est public :
classement, recherche de joueurs). L'attaquant répond `POST /api/social/accept` avec le
`requestId` (visible dans `GET /api/social/pending`) et reçoit en **une seule réponse** l'email,
le numéro de téléphone, le gameId, les métadonnées légales et l'historique de transactions du
portefeuille de la cible — données qu'aucune autre route ne délivre à un tiers.

**Correction.** Renvoyer `getPublicUserById(req.sender_id)` (ou un `sanitizeUserPayload`
allégé) au lieu de `getUserById`.

---

### S7 — MOYENNE — Le canal de chat d'un match public rend les `userId` de tous ses participants

**Fichiers** : `server/routes/chat.mjs:94-100`, `server/chat-helpers.mjs:81-82`,
`server/chat-helpers.mjs:58`, `server/persistence.mjs:3382`.

**Chemin d'exploitation.** `canAccessChatChannel` (`chat-helpers.mjs:81-82`) autorise tout
utilisateur authentifié lorsque le canal est public :

```js
export const canAccessChatChannel = (channel, user) =>
  !!channel && !!user && (user.role === 'admin' || channel.scope === 'public' || channel.participants.includes(user.id));
```

Or les canaux de match sont publics dès que le match l'est
(`buildMatchChatChannel`, `chat-helpers.mjs:58` : `scope: match.visibility === 'public' ? 'public' : 'participants'`).
La route de détail renvoie le canal **brut** :

```js
respondJson(res, 200, {
  ok: true,
  channel: { ...channel, unreadCount: getUnreadCountForUser(channel.id, session.user.id) },
  messages: getChatMessagesForChannel(channel.id, 150),
});      // chat.mjs:94-100
```

`channel.participants` contient les `userId` bruts des joueurs **et** de l'arbitre du match.
La sanitisation des matchs, qui retire volontairement `players[].userId`
(`state-helpers.mjs:168-183`), est donc contournée par le canal de chat : n'importe quel
joueur connecté récupère les UUID de tous les joueurs de tous les matchs publics.

**Preuve.** Le commentaire de `state-helpers.mjs:146-151` pose la règle (« les UUID internes
ne doivent pas fuiter ») ; le canal de chat en est une seconde voie de sortie.

**Correction.** Dans la réponse du détail d'un canal, remplacer `participants` par une liste
de pseudos + `isMe` (comme pour les matchs), ou ne l'exposer qu'aux participants/admins.

---

### S8 — MOYENNE — `POST /api/matches/:id/confirm` renvoie les `userId` des autres joueurs

**Fichiers** : `server/routes/match.mjs:355-359`, `server/match-engine.mjs:1106-1108`.

**Chemin d'exploitation.** La réponse de confirmation inclut le tableau des joueurs qui n'ont
pas encore confirmé :

```js
respondJson(res, 200, {
  ...buildMatchActionPayload(outcome.match, session.user.id),
  settled: outcome.settled,
  waitingFor: outcome.waitingFor,     // match.mjs:358
});
```

`outcome.waitingFor` est calculé en `match-engine.mjs:1106-1108` à partir des `userId` bruts :

```js
const pending = match.players.map((player) => player.userId)
  .filter((userId) => !match.result.confirmedByTeams.includes(userId));
```

C'est la seule réponse HTTP de tout le module match qui rend des identifiants internes
bruts, alors que le payload voisin (`buildMatchActionPayload`) est sanitisé. Le
contournement est trivial : il suffit d'être joueur d'un match et de le confirmer.

**Correction.** Renvoyer des pseudos, ou un tableau de booléens aligné sur `players`
(le modèle `isMe` déjà utilisé ailleurs).

---

### S9 — FAIBLE — `POST /api/auth/activation-email` mute l'email d'un compte sans session ni mot de passe

**Fichiers** : `server/routes/auth.mjs:265-290`, `server/persistence.mjs:2513-2522`.

**Chemin d'exploitation.** La route est publique et appelle `changeActivationEmail(oldEmail, newEmail)`
(`persistence.mjs:2513`), qui **écrit le nouvel email dans la base** et renvoie un code
d'activation. Aucune session, aucun mot de passe, aucun code actuel n'est exigé.

Aujourd'hui, la route est neutralisée par un garde d'état, pas d'autorisation :

```js
if (user.isActive !== false) {
  throw makeError('ACCOUNT_ALREADY_ACTIVE', 'Ce compte est deja actif. Modifie ton email depuis les parametres.');
}     // persistence.mjs:2520
```

Comme l'inscription active le compte directement (`isActive: input.isActive !== false`,
`persistence.mjs:1301`), ce garde renvoie toujours `ACCOUNT_ALREADY_ACTIVE` : la route est
morte. Mais la protection est **un état de données, pas une décision d'autorisation**.
Le jour où un seul compte non actif existe (import, fixture, « compte en attente de
modération », réactivation future), la route devient une prise de compte complète :
changer l'email d'une cible → demander un reset sur le nouvel email → réinitialiser le
mot de passe → le compte est à l'attaquant.

**Correction.** Exiger une session **et** le mot de passe courant (comme
`PATCH /api/auth/me`), et conserver le garde `isActive` en défense supplémentaire.

---

### S10 — FAIBLE — Le garde anti-takeover du ré-enrôlement 2FA ne repose que sur un Map en mémoire

**Fichiers** : `server/routes/admin.mjs:493-505`, `server/admin-totp.mjs:55`,
`server/persistence.mjs:3968-3988`.

**Chemin d'exploitation.** Le refus de ré-enrôler une 2FA active repose sur :

```js
const existing = adminTotpSecrets.get(session.user.id);   // admin.mjs:493
if (existing?.enabled) { … 409 2FA_ALREADY_ENABLED … }
```

`adminTotpSecrets` est un `Map` **en mémoire** (`admin-totp.mjs:55`), peuplé au démarrage
par `loadAdminTotpSecrets` (`realtime-server.mjs:654`). Ce chargement **avale ses erreurs**
(`catch { /* table may not exist yet */ }`, `persistence.mjs:3986`) : si la table
`admin_2fa_secrets` est absente ou la lecture échoue, le Map est vide.

Dans ce cas, un attaquant qui a le seul mot de passe admin peut :
1. `POST /api/admin/2fa/setup` avec le mot de passe (le garde anti-takeover ne s'applique pas,
   le Map étant vide) → un nouveau secret lui est renvoyé ;
2. `POST /api/admin/2fa/enable` avec son propre code → `enabled = true` ;
3. `POST /api/admin/2fa/verify` → accès financier complet.

L'écriture en base peut, elle, échouer silencieusement : `saveAdminTotpSecret` est appelée
dans un `try/catch` qui ne fait qu'un `log.error` (`admin.mjs:504-508`, `admin.mjs:543-547`),
et la route `/api/admin/2fa/setup` répond 200 avec l'`otpauthUrl` malgré l'échec. La
configuration en base est alors écrasée par le secret de l'attaquant
(`saveAdminTotpSecret(userId, secret, true)`), ce qui **détruit** la 2FA légitime.

**Précondition.** `admin_2fa_secrets` est bien déclarée dans `supabase/schema.sql:271` :
le scénario suppose une table absente en production, un chargement échoué au démarrage, ou un
Map vidé par un redémarrage pendant la fenêtre. Le garde repose donc sur un état mémoire
non garanti.

**Correction.** Avant d'accepter un ré-enrôlement, relire l'état depuis la base
(`sbSelect('admin_2fa_secrets', { user_id })`) et refuser si `enabled === true` ; ne pas
répondre 200 si la persistance a échoué.

---

### S11 — FAIBLE — La vérification 2FA est marquée sur une session différente de celle qui a été testée

**Fichiers** : `server/routes/admin.mjs:549`, `server/routes/admin.mjs:577`,
`server/http-utils.mjs:250-267` (`readBearerToken`), `server/http-utils.mjs:282-291`
(`getAuthenticatedAppSession`), `server/persistence.mjs:3230`.

**Chemin d'exploitation.** `requireAdmin2fa` teste la session obtenue par
`getAuthenticatedAppSession`, qui **privilégie l'en-tête `Authorization`** :

```js
const authorization = req.headers.authorization || '';
if (authorization.startsWith('Bearer ')) { … return token ? getAuthSession(token, …) : null; }
const token = readBearerToken(req);        // http-utils.mjs:284-290
```

Mais le marquage de la vérification utilise `readBearerToken`, qui **privilégie le cookie** :

```js
markAdmin2faVerified(readBearerToken(req));   // admin.mjs:549 et admin.mjs:577
```

Le décalage est documenté dans le module (`http-utils.mjs:23-25` : « les priorités sont
volontairement inversées ») mais il a une conséquence de sécurité : si un client envoie les
deux credentials avec **deux sessions différentes**, le code TOTP est validé contre la
session de l'en-tête (celle que `requireAdmin2fa` a testée) tandis que le marquage
`admin2faVerified` est appliqué à la session du cookie — qui n'a donc jamais été testée par
un code TOTP.

Deux conséquences : (a) la session réellement testée n'est jamais marquée (403
`2FA_REQUIRED` sur les routes financières suivantes) ; (b) une session est marquée
2FA-valide sans qu'aucun code n'ait été vérifié pour elle.

**Portée réelle.** Je n'ai pas trouvé de vecteur d'escalade inter-comptes : la session du
cookie et celle de l'en-tête portent le même utilisateur dans le cas nominal, et un
attaquant qui injecte un `Authorization` arbitraire doit déjà contrôler le client de la
victime. **Impact qualifié de faible**, mais le décalage de contexte est réel et mérite d'être
supprimé.

**Correction.** Utiliser la même source de jeton dans les deux chemins (par exemple
exposer `req._authToken` renseigné par `getAuthenticatedAppSession` et le réutiliser dans
`markAdmin2faVerified`).

---

### S12 — FAIBLE — Champs libres non sanitisés ou non validés, persistés puis renvoyés en public

**Fichiers** : `server/routes/match.mjs:305-314`, `server/match-engine.mjs:597`,
`server/routes/tournament.mjs:289-295`, `server/routes/chat.mjs:127-136`,
`server/routes/social.mjs:106-109`.

| Champ | Route | Défaut | Effet |
|---|---|---|---|
| `result.arbiterNotes` | `POST /api/matches/:id/result` | ni `sanitizeText` ni plafond | stocké dans `match.result`, **renvoyé par la route publique `GET /api/matches`** (`state-helpers.mjs:191-198` ne retire que `screenshots`, `proofs`, `confirmedByTeams`) |
| `result.scores` | idem | type/plage non validés (`team0`/`team1` peuvent être des chaînes, des objets, `NaN`) | persisté et renvoyé en public ; `buildProofHash` l'utilise tel quel |
| `dispute.category` | `POST /api/matches/:id/disputes` | chaîne libre, pas de liste blanche | persisté et renvoyé en public |
| `payload.notes` | `POST /api/tournaments/:id/matches/:mid/result` | ni `sanitizeText` ni plafond | persisté dans le tournoi, renvoyé par la route **publique** `GET /api/tournaments/:id` |
| `channel.name` | `POST /api/chat/channels` | ni `sanitizeText` ni plafond (`normalizeChatChannelPayload` ne fait qu'un `trim()`, `persistence.mjs:3354`) | stocké, renvoyé et diffusé en socket ; un canal peut s'appeler « Admin ZOYD » |
| `body.participants` | idem | tableau non borné (chaque id doit exister) | canal créé avec N participants |
| `body.type` | idem | `match`/`team` fabricables alors que le canal n'est pas un match | usurpation d'interface (`CH-match-…`) |
| `message` (demande d'ami) | `POST /api/social/request` | ni `sanitizeText` ni plafond | stocké, renvoyé par `GET /api/social/pending` |
| `replyTo` | `POST /api/chat/channels/:id/messages` | chaîne libre | stocké dans le message |
| `match.rules` | `POST /api/matches` | objet libre, **sans borne de taille ni de profondeur** | jusqu'à 1 Mo stockés par match, × 30/min/IP (quota `social`) → amplification de stockage |

**Portée.** Le front n'utilise `dangerouslySetInnerHTML` que dans un unique composant de
graphique (`src/app/components/ui/Chart.tsx:104`) : React échappe le reste, donc **ce n'est
pas un XSS exploitable aujourd'hui**. L'enjeu est la donnée non validée qui revient dans des
réponses publiques, l'amplification de stockage et la cohérence de la surface d'attaque.

**Correction.** Appliquer `sanitizeText` + plafond de longueur à tous les champs de texte
libre, valider `scores` (entiers ≥ 0), valider `category` par liste blanche, borner
`rules` (taille et profondeur), borner `participants`.

---

### S13 — FAIBLE — `POST /api/social/report` et `POST /api/social/block` : `targetId` non validé

**Fichiers** : `server/routes/social.mjs:221-223`, `server/routes/social.mjs:190`,
`server/persistence.mjs:4110`.

**Chemin d'exploitation.** Le contrôle est une simple présence :

```js
if (!body.targetId || !body.reason) { … 400 MISSING_FIELDS … }     // social.mjs:221
```

`targetId` n'est ni vérifié comme identifiant de compte existant, ni typé. Il est écrit tel
quel dans la colonne `target_id` de `user_reports` et dans `payload`
(`social.mjs:253-265`). Ensuite, `resolveReport` (`persistence.mjs:4254`) en fait :

```js
const created = await createSanction({ userId: row.target_id || …, kind: resolution, … });
```

et `createSanction` ne vérifie que la **présence** d'un `userId` (`persistence.mjs:4110`) :
une sanction peut donc être créée contre un identifiant qui ne correspond à aucun compte.
Conséquence : la file de modération se remplit de signalements impossibles à traiter
(`resolveReport` échoue en `SANCTION_FAILED` ou crée une sanction orpheline, visible dans
`GET /api/admin/sanctions` avec un pseudo vide), et la règle « un signalement accuse une
personne » perd sa garantie.

**Correction.** Valider `targetId` (UUID existant) et `reason` ∈ clés de `REPORT_SEVERITIES`
avant écriture ; rejeter le signalement si la cible n'existe pas.

---

### S14 — FAIBLE — `POST /api/auth/register` : champs d'énumération non validés, longueurs non bornées

**Fichiers** : `server/routes/auth.mjs:113-126`, `server/persistence.mjs:1297-1316`.

**Chemin d'exploitation.** La liste blanche `REGISTER_FIELDS` inclut `controllerType` et
`device` **sans validation d'énumération** : le contrôle n'existe que sur
`PATCH /api/auth/me` (`auth.mjs:394-405`). `buildUserPayload` les conserve tels quels
(`persistence.mjs:1302-1303`) : un compte peut être créé avec
`controllerType: "<img src=x onerror=…>"` (React l'échappe, mais la donnée est stockée et
diffusée). `pseudo` n'a pas de plafond à l'inscription (30 caractères au PATCH seulement,
`auth.mjs:437`) : un pseudo de plusieurs milliers de caractères est accepté. `email` n'a pas
de plafond à l'inscription (120 au PATCH, `auth.mjs:462`). `gameId` n'est validé que par
sa non-vacuité (`persistence.mjs:1362`).

**Correction.** Factoriser un validateur d'énumération et de longueur commun à
l'inscription et au PATCH (`controllerType`, `device`, `pseudo` ≤ 30, `email` ≤ 120,
`gameId` au format numérique CODM).

---

### S15 — FAIBLE — `GET /api/leagues/:id/leaderboard` est publique alors que `GET /api/leagues` exige une session

**Fichiers** : `server/routes/league.mjs:335-345`, `server/routes/league.mjs:71-85`.

**Chemin d'exploitation.** La route publique renvoie `season.standings` bruts :

```js
const standings = getLeagueLeaderboard(getStoredLeagues(), leagueLeaderboard[1]);
respondJson(res, 200, { ok: true, standings });      // league.mjs:339-340
```

`standings` contient `userId`, `pseudo`, `totalPoints`, `bestPlacement`, `matchesPlayed` et
`placements[]` (l'historique des placements jour par jour) de **tous** les inscrits de la
saison. La liste des saisons, elle, exige une session (`league.mjs:82-85`) — la route
publique est donc un raccourci vers la même donnée, non sanitisée.

L'incohérence est assumée dans l'en-tête du module (« le classement est un GET sans session :
il n'expose que le classement, pas les identifiants », `league.mjs:30-31`) — mais la
prétendue absence d'identifiants n'est pas tenue : `standings[].userId` est présent.

**Correction.** Appliquer la même politique d'accès que le reste de la ligue (session), ou
renvoyer des pseudos + `isMe` au lieu des `userId`.

---

## 4. Points vérifiés et conformes

Ces contrôles ont été faits et sont **conformes** ; ils ne sont pas à refaire.

### 4.1 CSRF et CORS — conformes

Le garde global est dans `server/realtime-server.mjs:264-289`, **avant** le dispatch des
modules :

```js
if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) { … 403 CSRF_ORIGIN_REJECTED … }
  const contentType = String(req.headers['content-type'] || '');
  if (contentType && !contentType.includes('application/json')) { … 415 UNSUPPORTED_MEDIA_TYPE … }
}
```

Vérifié :

- **Cookie `SameSite=None; Secure` en production** (`http-utils.mjs:85-94`) : le SameSite ne
  protège donc **rien** — c'est bien le garde serveur qui porte la protection, et il est
  présent.
- **Double barrière** : l'origine doit être dans `ALLOWED_ORIGINS`, **et** le
  `Content-Type` doit être `application/json`. Un `fetch(..., { mode: 'no-cors' })` ou un
  `<form enctype="text/plain">` depuis `https://evil.com` est rejeté (403 origine, ou 415
  type). Un `fetch` avec `application/json` déclenche un préflight : la route `OPTIONS`
  (`realtime-server.mjs:264-267`) répond avec `Access-Control-Allow-Origin` vide pour une
  origine non whitelistée → le navigateur bloque la requête.
- **CORS** : `getCorsOrigin` (`http-utils.mjs:117-120`) renvoie `''` pour toute origine non
  whitelistée → aucune donnée lisible cross-origin.
- **Socket** : `allowRequest` filtre l'upgrade WebSocket par origine
  (`realtime-server.mjs:329-337`) et `cors.origin` fait de même pour le transport polling —
  une page tierce ne peut pas ouvrir un socket authentifié avec le cookie de la victime.
- **Aucun GET ne mute d'état** : vérifié sur les 25 routes GET de l'inventaire.

### 4.2 Correctement protégées — la majorité des routes

- **Toutes les routes d'argent du module admin** : `reload`, `commissions`, `reports` (GET),
  `reports/:id/resolve`, `sanctions` (GET), `sanctions/:id/revoke`, `matches/export`,
  `matches/:id/award`, `matches/:id/resolve-dispute`, `matches/:id/cancel` —
  `requireAdmin2fa` (`admin.mjs:157, 176, 198, 253, 318, 352, 389, 586, 641, 669`), plus
  `POST /api/wallet/deposit` (`wallet.mjs:154`), `POST /api/leagues/:id/refund/:userId`
  (`league.mjs:396`), `GET /api/leagues/:id/payments` (`league.mjs:416`),
  `POST /api/br/lobbies/:id/finish` (`br.mjs:212`).
- **Guards 2FA (`requireAdmin2fa`)** : rôle admin vérifié **côté serveur**
  (`admin-totp.mjs:189`), TOTP obligatoire et activé (`admin-totp.mjs:196`), fenêtre
  vérifiée (`admin-totp.mjs:201`), comparaison en temps constant sur tampons de même taille
  (`admin-totp.mjs:124-128`), fenêtre TOTP de 0 pas (code non rejouable hors de son pas de
  30 s, `admin-totp.mjs:95`).
- **Anti-takeover de la 2FA** : `POST /api/admin/2fa/setup` exige le **mot de passe admin**
  (`admin.mjs:476-487`) — un cookie volé ne suffit pas à s'auto-enrôler (voir S10 pour la
  limite restante).
- **Mass assignment** : listes blanches strictes sur `POST /api/auth/register`
  (`auth.mjs:113-121`), `PATCH /api/auth/me` (`auth.mjs:387-391`) et sur le corps du
  résultat de match (`match.mjs:305-313`). `role`, `wallet`, `trustScore` ne sont jamais
  acceptés depuis le client.
- **Changement d'email** : exige le mot de passe courant (`auth.mjs:472-479`), unicité
  vérifiée sous mutex (`auth.mjs:483-488`).
- **Retrait** : clé d'idempotence obligatoire, état lu **dans** `withWalletMutex`, appel
  FedaPay **hors** verrou, remboursement conditionné à la preuve que l'argent n'est pas
  parti, clés relâchées dans tous les cas (`wallet.mjs:183-430`).
- **Dépôt FedaPay** : transaction relue chez le provider, statut `approved` exigé,
  **anti-vol par appartenance** à l'appelant, devise XOF, réservation atomique avant crédit,
  idempotence en base (`payment-engine.mjs`, `verifyFedaPayTransactionAndCredit`).
- **Signalements** : l'expéditeur est la session, la gravité est calculée serveur
  (`severityForReason`, `moderation.mjs:69-72`), le traitement est tracé
  (`reviewed_by`, `reviewed_at`, `resolution`) et n'est pas rejouable (`ALREADY_REVIEWED`).
  Le `kind` de sanction est validé par liste blanche (`isSanctionKind`, `moderation.mjs:102`).
- **Chat** : contrôle d'accès par canal sur **chaque** route (`canAccessChatChannel`), refus
  en **404** (pas d'énumération de canaux privés), expéditeur = session, texte sanitizé et
  tronqué à 2000.
- **BR** : l'arbitre est désigné à la création et **doit être un admin existant**
  (`br-engine.mjs:320-329`), le créateur n'est pas auto-inscrit et ne paie aucun pass,
  `eliminate` exige l'arbitre du salon (`requireLobbyArbiter`, `br-engine.mjs:608-621`),
  `finish` exige l'arbitre **et** la 2FA, la vue `/arbiter` (seule à rendre les `userId`) est
  restreinte à l'arbitre ou au créateur (`br.mjs:307`), les vues publiques retirent
  `userId`, `killedBy`, `arbiterId`, `creatorId` et `teams[].key`
  (`state-helpers.mjs:315-324`).
- **Tournois** : le capitaine est forcé à son propre pseudo, les coéquipiers doivent exister
  et être uniques, pas de double inscription, le pass est verrouillé sous mutex.
- **Matchs** : `winnerTeam` strict, roster complet et statut `in_progress` exigés hors
  override admin, preuves obligatoires (`normalizeProofRefs` : 10 réf. max, 2 000 caractères,
  schémas `javascript:`/`vbscript:`/`data:` exclus), règlement en deux phases
  (`payoutDistributed: 'pending'` puis versement), garde `ARBITER_REQUIRED` au plus près de
  la sortie d'argent (`applyResultSettlement`), anti-double-confirmation, litiges qui gèlent
  la cagnotte.
- **Ligue** : `dayKey` strictement whitelisté (anti-`__proto__`, `league-engine.mjs:467`),
  tarif figé dès la première inscription, remboursement impossible sur une saison soldée,
  résultats de journée/finale vérifiés contre les inscrits (pas de doublon, pas de place
  partagée), compensation du pass si `saveLeagues` échoue.
- **Rôles** : lus depuis la base à chaque requête (`getUserById` dans `getAuthSession`), donc
  une rétrogression admin prend effet immédiatement — y compris pour les sessions temps réel
  (`persistence.mjs:3271-3287`).
- **Sanctions** : `getAuthSession` **détruit** la session d'un compte bloqué
  (`persistence.mjs:3085-3088`) ; `isSanctionActive` est évalué à la lecture
  (`moderation.mjs:133-137`).
- **Mots de passe** : scrypt + sel aléatoire, comparaison en temps constant, force minimale
  (8 caractères, majuscule, chiffre, spécial) à l'inscription **et** au changement.

### 4.3 Routes sans session — normal ou justifié

| Route | Justification |
|---|---|
| `POST /api/auth/register`, `login`, `activate`, `resend-code`, `activation-email`, `forgot-password`, `reset-password` | pré-session par nature (voir S9 pour la dernière) |
| `POST /api/auth/logout` | appelable sans session, quota dédié `auth_logout`, aucun effet de bord |
| `GET /api/health`, `GET /api/realtime/health` | sonde de santé |
| `GET /metrics` | jeton `METRICS_TOKEN`, comparaison en temps constant |
| `GET /api/leaderboard`, `GET /api/stats` | agrégats publics |
| `GET /api/matches`, `GET /api/tournaments`, `GET /api/tournaments/:id` | catalogue public — **mais voir S4** |
| `GET /api/br/config`, `GET /api/br/lobbies`, `GET /api/br/lobbies/:id` | vitrine BR — **voir S5/S7 pour les fuites annexes** |
| `GET /api/leagues/:id/leaderboard` | **incohérent — voir S15** |
| `GET /api/realtime/push/public-key` | clé publique VAPID |

---

## 5. Note hors périmètre

`sanitizeMatchForBroadcast` retire `roomName` et `roomPassword` de **toutes** les sorties,
y compris de la réponse HTTP au participant du match (`state-helpers.mjs:163`) et de la
diffusion socket. Le mot de passe de la salle n'atteint donc jamais le joueur censé le
recevoir, alors que le front l'attend (`src/app/stores/matchStore.ts:418-419`,
`src/features/match/components/MatchRules.tsx:57-60`). Ce n'est pas une faille
d'autorisation — c'est l'inverse, une sur-protection qui casse la fonctionnalité — mais
elle mérite d'être traitée avec S4 : la même fonction sert aux deux.

---

## 6. Récapitulatif

| ID | Sévérité | Objet | Fichier:ligne principal |
|---|---|---|---|
| S1 | Haute | Contournement 2FA — attribution d'un match + versement par la route joueur | `server/routes/match.mjs:288` |
| S2 | Haute | Contournement 2FA — versement de la cagnotte de ligue | `server/routes/league.mjs:312` |
| S3 | Haute | Contournement 2FA — règlement d'un tournoi | `server/routes/tournament.mjs:278` |
| S4 | Haute | Preuves, litiges et `userId` exposés publiquement (`GET /api/matches`) | `server/state-helpers.mjs:163` |
| S5 | Moyenne | Saison de ligue jamais sanitisée (HTTP + socket) | `server/routes/league.mjs:121` |
| S6 | Moyenne | `POST /api/social/accept` renvoie le dossier complet de l'expéditeur | `server/routes/social.mjs:144` |
| S7 | Moyenne | Canal de chat public : `userId` des participants | `server/routes/chat.mjs:94` |
| S8 | Moyenne | `POST /api/matches/:id/confirm` renvoie les `userId` des autres | `server/routes/match.mjs:355` |
| S9 | Faible | `POST /api/auth/activation-email` mute un email sans session | `server/routes/auth.mjs:265` |
| S10 | Faible | Garde anti-takeover 2FA sur un Map mémoire | `server/routes/admin.mjs:493` |
| S11 | Faible | Marquage 2FA sur une session ≠ session testée (cookie vs Bearer) | `server/routes/admin.mjs:549` |
| S12 | Faible | Champs libres non sanitisés / non bornés, renvoyés en public | `server/routes/match.mjs:305` |
| S13 | Faible | `targetId` non validé dans `report`/`block` | `server/routes/social.mjs:221` |
| S14 | Faible | Énumérations et longueurs non validées à l'inscription | `server/routes/auth.mjs:113` |
| S15 | Faible | Classement de ligue public vs liste de ligue protégée | `server/routes/league.mjs:335` |

**Racine commune de S1/S2/S3** : les moteurs vérifient le rôle `admin`
en interne (`actorUser.role !== 'admin'`), ce qui est correct, mais les routes correspondantes
n'appliquent pas `requireAdmin2fa` alors que l'équivalent existe déjà dans `routes/admin.mjs`.
La barrière 2FA doit être appliquée **au niveau de la route**, pas laissée à l'appelant.
