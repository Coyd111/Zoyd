# Partie 8 — Fondations (cron, moderation, chat, push) (audit-3)

**Relecture :** 2026-10-26, base `main` au `51147b8`.
**Périmètre :** `server/cron.mjs` (904 lignes, lu intégralement — les zones
argent/ligue/tournoi/BR avaient déjà été croisées en parties 4, 5, 6, 7),
`server/moderation.mjs` (138 lignes, lu intégralement),
`server/chat-helpers.mjs` (151 lignes, lu intégralement),
`server/channel-presence.mjs` (271 lignes, lu intégralement),
`server/push-notifications.mjs` (131 lignes, lu intégralement),
`server/admin-totp.mjs` (252 lignes, lu intégralement — ajouté au périmètre :
couvert par aucune autre partie),
`server/commission-stats.mjs` (65 lignes, lu intégralement — idem). Point
ciblé dans `persistence.mjs` : `tagWalletTransaction` (`:2057-2119`) + garde
des clés de retrait (`:1860-1892`).
**Anti faux-positifs :** ledgers `docs/audit-2/`, invariants
`docs/05-invariants.md`, commentaires `PIEGE:`/`INVARIANT:` des sources.
(Rappel : `utils`, `logger`, `mutex`, `supabase`, `vapid-keys`,
`single-process-guard`, `metrics`, `http-utils`, `rate-limiter`,
`code-delivery` sont couverts par la partie 1.)

## Verdicts par fichier

| Fichier | Verdict |
|---|---|
| `cron.mjs` | Propre — tous les jobs d'argent ont garde anti-chevauchement, verrou, boot immédiat (C5 bootless déjà gravé en P6 C2) |
| `moderation.mjs` | Propre — module pur, 1 INFO (C3 : commentaire mal posé) |
| `chat-helpers.mjs` | 1 INFO (C2 : double émission aux participants) |
| `channel-presence.mjs` | Propre — bornes documentées, nettoyage périodique réel |
| `push-notifications.mjs` | Propre — création base avant émission, souscriptions mortes purgées |
| `admin-totp.mjs` | 1 INFO (C1 : doc « non rejouable » surcrite), micro-INFO (C5) |
| `commission-stats.mjs` | Propre — source de vérité = transactions (micro-INFO C5) |

## Ce qui a été vérifié et jugé solide

- **Câblage des jobs cron** : chaque job d'argent a (a) un drapeau
  anti-chevauchement (`sweepPendingArbiterFees :97`, `sweepPendingSettlements
  :144`, `sweepExpiredConfirmations :191`, `sweepPendingBrSettlements :252`,
  `sweepStaleBrLobbies :323`, retraits `:767`, ligues `:828`), (b) le même
  verrou que la route correspondante (invariant d'en-tête respecté : match
  `:100/:147/:194`, tournoi `:661/:706`, ligue `:737/:871`, BR par salon
  `:266/:339`), (c) un boot immédiat (`:612/:617/:631/:645/:650/:692/:725/:756/
  :819/:903`) — seuls l'archivage de matchs (`:392-438`, INFO C4), le
  nettoyage mémoire (`:507`) et la fermeture ligue (P6 C2) en manquent.
- **Filtres de reprise des matchs (C3 audit-2)** : deux vagues — règlements
  `'pending'` sans fenêtre + litiges CLOS restés `disputed`
  (`cron.mjs:149-163`), garde `settlePendingMatchResult` sur litige ouvert
  maintenue.
- **`sweepPendingArbiterFees`** : file DISTINCTE des règlements
  (`:78-120`) — la créance d'un arbitre sur un match `finished` est bien
  relue.
- **Expirations de confirmation** : gains libérés automatiquement, échecs
  isolés et LOGUÉS (visibles, pas silencieux, `:203-220`).
- **`tagWalletTransaction` (point reporté de la partie 4 — CLOSE)** : le
  cas `txId` null est traité et documenté (`persistence.mjs:2058-2061`) —
  la file `payoutsEnAttente` porte la preuve, la résolution passe par
  `payoutId` (`:2092-2103` en ajout, `:2110-2114` en sortie) ; le tag ne
  résout la file que si `statutResultant` est défini (`:2090-2104`), et le
  remboursement portant la clé reste une preuve indépendante du tag
  (`hasActiveWithdrawalKey :1880-1892`). Le micro-constat P4 C4 (« tagTx
  null → à vérifier en partie 8 ») est donc résolu SANS défaut : la trace
  d'historique peut rester `pending_review` quand la tx a quitté les 200,
  c'est le comportement documenté.
- **moderation.mjs** : gravité déduite du MOTIF, jamais d'un champ client
  (`:69-72`) ; la recommandation n'est JAMAIS appliquée seule (`:39-43`) ;
  `computeExpiry` borné [1, 30] jours, `null` hors bannissement temporaire
  (`:112-119`) ; `isSanctionActive` évalué à la lecture, pas par un drapeau
  (`:133-138`) — un bannissement expire sans cron.
- **chat-helpers.mjs** : `canAccessChatChannel` est la règle unique
  (`:81-82`) ; bootstrap borné (50 canaux, 10 × 20 messages, `:103-109`) ;
  le canal de match agrège joueurs + arbitre et suit la visibilité du match
  (`:54-58`) ; le PIEGE « participants figés » est documenté (`:18-20`) et
  atténué par la re-synchronisation au boot (`syncMatchChatChannels :70-73`).
- **channel-presence.mjs** : clé = userId, pas socketId (multi-onglets,
  `:189-218`) ; déconnexion — spectateur supprimé, joueur/arbitre conservé
  hors ligne (`:229-248`) ; `MAX_ACTIVE_CHANNELS` 500 avec dégradation
  documentée (Map vide, pas d'erreur, `:84-90`) ; nettoyage 10 min
  (`:48-77`) qui purge aussi les canaux de chat mémoire inactifs 24 h
  sauf `global` — l'oscillation après redémarrage (canaux persistés qui
  remontent en mémoire puis ressortent) est transitoire et bornée.
- **push-notifications.mjs** : notification créée EN BASE AVANT émission
  socket et push (`:91-102`) — le centre survit à un client déconnecté ;
  textes sanit (`sanitizeText :94-97`) ; souscriptions mortes 404/410
  purgées (`:71-73`), autres erreurs = push perdu sans panne (`:57`, PIEGE
  documenté) ; `broadcastStateSnapshot` émet à tous SANS donnée dépendante
  du destinataire (`:111-113`) ; erreurs isolées par admin
  (`notifyAllAdmins :120-128`).
- **admin-totp.mjs** : `TOTP_WINDOW_STEPS = 0` assumé et documenté avec son
  compromis (`:87-101`) ; vérification en temps constant sur tampons de
  même taille (`:131-135`) ; type STRICT avant comparaison (`:125`) ; les
  trois gardes répondent elles-mêmes au refus (401/403 + `code`, patron
  respecté partout dans les routes croisées) ; `requireAdmin2fa` exige
  `enabled` ET fraîcheur (`:203-211`) ; `require2faIfAdmin` cale l'override
  admin sur le TOTP (S1/S3 audit-2, corrigés).
- **commission-stats.mjs** : lit les TRANSACTIONS du portefeuille, pas le
  champ figé du match (le défaut qui motivait le module) ; commission de
  retrait exclue si payout échoué (`:43`) ; commission d'arbitre = sortie de
  trésorerie hors revenu (`:54-56`).
- **Tests** : `admin-totp.test.mjs` (RFC + refus + fenêtre + type),
  `admin-totp-guard.test.mjs`, `moderation.test.mjs`,
  `commission-stats.test.mjs` dédiés ; chat/presence/push couverts par les
  e2e et les mocks des autres suites.

## Constats

### C1 — INFO : le commentaire de `TOTP_WINDOW_STEPS` surcrit l'idempotence — un code EST rejouable dans son pas de 30 s

- Le commentaire (`admin-totp.mjs:89-91`) affirme « un code ne peut pas être
  rejoué » : avec `TOTP_WINDOW_STEPS = 0`, un code reste VALIDE pendant tout
  son pas de 30 s et peut être soumis plusieurs fois (aucun cache de codes
  utilisés) ; il n'est pas rejouable que d'un pas à l'autre. La fenêtre
  d'exploitation réelle est étroite — il faut le code ET une session admin
  valide (le flag `admin2faVerified` est posé SUR la session) — donc INFO :
  c'est la doc qui surcite, pas la garde.
- Micro du même fichier : le garde de type (`typeof code !== 'string' ||
  length !== 6`, `:125`) vit DANS la boucle HMAC — correct aujourd'hui
  (fenêtre 0 = une itération), fragile si la fenêtre passe à ±1 (documenté
  comme un changement d'une constante, `:99-100`) : le garde serait évalué
  une fois par pas au lieu d'une fois par appel. Déplacer la garde avant la
  boucle.
- Micro annexe : `base32Decode` saute silencieusement les caractères hors
  alphabet (`:76`) — un secret malformé décode plus court sans erreur ;
  sans risque réel (secrets générés par le serveur).

### C2 — INFO : `broadcastChatChannel` émet deux fois le canal à chaque participant

- Quand `channel.inbox === 'all'`, le canal est émis à TOUT LE MONDE
  (`io.emit`, `chat-helpers.mjs:122-124`) PUIS encore une fois à la room
  `user:<id>` de chaque participant (`:126-128`) : un participant du canal
  reçoit deux événements `chat:channel` identiques. L'écrasement front est
  idempotent (même payload), donc aucun bug visible — purement du bruit
  socket. Le même motif existe pour `broadcastChatMessage` sur le canal
  `global` (`:141-144` : early return, lui est correct).

### C3 — INFO : commentaire mal posé sur `isSanctionKind`

- Le bloc `moderation.mjs:98-101` (« Severite MAXIMALE jamais levee. Le
  definitif n'est jamais automatique… ») décrit la POLITIQUE de la table de
  gravités, mais est posé au-dessus de `isSanctionKind` — qui est un
  prédicat de whitelist (`SANCTION_KINDS.includes`, `:102`), sans rapport
  avec cette politique. La vraie doc du prédicat est l'INVARIANT d'en-tête
  (`:15-16`). Commentaire au mauvais endroit : confusion possible, code
  correct.

### C4 — INFO : l'archivage de matchs inactifs n'a pas de boot immédiat

- `matchCleanupRunning` tourne toutes les 6 h (`cron.mjs:392-438`) SANS
  premier passage différé — contrairement à tous les jobs d'argent. Après un
  redémarrage, les matchs éligibles à l'archivage attendent jusqu'à 6 h.
  Impact limité : c'est de l'archivage (état terminal, le PIEGE d'en-tête
  `:30-31` rappelle qu'il ne rembourse PAS), le filtrage par `updatedAt`
  ne déborde pas. Pour l'homogénéité du fichier, un `setTimeout` de boot
  comme les autres suffirait.
- Micro cron : les textes des drapeaux gardes citent « tick précédent encore
  en cours » en français accentué (`:394`, `:443`) — même convention
  brisée, sans effet.

### C5 — INFO : micro-remarques sans impact

- **ASCII** : 111 occurrences non-ASCII sur les 7 fichiers de la partie —
  surtout `cron.mjs` (~70, accents français des commentaires et textes de
  log) et `admin-totp.mjs` (~34) ; `chat-helpers.mjs` et
  `channel-presence.mjs` sont PROPRES (0) ; `commission-stats.mjs` (2
  tirets cadratins) ; `push-notifications.mjs` (1 `…`). Aucun CJK (grep
  vérifié).
- **push non sanitisé** : `sendPushToUser` envoie `payload` BRUT
  (`JSON.stringify(payload)`, `:67`) alors que la notification en base est
  sanitée — mêmes chaînes aux sites d'appel (titres construits par le
  serveur), et un payload push est rendu en texte par le navigateur : aucune
  injection, asymétrie d'hygiène seulement.
- **commission-stats et retraits en cours** : un retrait `pending_review`
  compte sa commission comme revenu tant que la réconciliation n'a pas
  tranché (`:42-46` — seuls les `failed` sont exclus) ; le comptage se
  recalcule à chaque lecture donc se corrige seul. Dérive statistique
  transitoire.
- **presence en module load** : `setInterval(cleanupChannelMaps, 10 min)`
  démarre à l'IMPORT du module (`channel-presence.mjs:77`), pas dans
  `initCronJobs` — hors invariant « appelé une seule fois » du cron, et
  sans `unref` (les tests qui importent le module traînent un handle) ;
  cadence basse, effet nul en production.

## Résumé

Les fondations sont propres. Aucun FAIBLE ni pire sur ces fichiers : les
invariants d'en-tête sont réels (gardes anti-chevauchement, verrous
partagés avec les routes, boot immédiats sur les jobs d'argent, notification
créée en base avant émission, temps constant sur le TOTP, évaluation des
sanctions à la lecture), et le point reporté de la partie 4
(`tagWalletTransaction` avec `txId` null) est CLOSE — le comportement est
celui documenté, la file porte la preuve. Cinq INFO : doc TOTP surcrite
(rejeu possible dans le pas de 30 s, garde de type mal placée), double
émission socket aux participants de chat, commentaire de moderation au
mauvais endroit, archivage de matchs sans boot immédiat, hygiène ASCII
(111 occurrences, aucune CJK).
