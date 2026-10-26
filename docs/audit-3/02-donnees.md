# Partie 2 — Données (audit-3)

**Relecture :** 2026-10-26, base `main` au `aba3a69`.
**Périmètre :** `server/persistence.mjs` (4 445 lignes, lues intégralement),
`server/state-helpers.mjs` (474 lignes, lues intégralement) — plus les zones
de croisement nécessaires pour trancher (`league-engine.mjs`, `routes/league.mjs`,
`routes/chat.mjs`, `chat-helpers.mjs`, `push-notifications.mjs`, `realtime-server.mjs`,
`src/app/stores/leagueStore.ts`).
**Anti faux-positifs :** ledgers `docs/audit-2/`, invariants `docs/05-invariants.md`
(V1-V15), commentaires `PIEGE:`/`INVARIANT:` des sources.

## Verdicts par fichier

| Fichier | Verdict |
|---|---|
| `persistence.mjs` | 2 FAIBLE ciblés (C1 course OCC sur le hash, C2 export sans pagination) + micro-notes (C4, C6) |
| `state-helpers.mjs` | 1 INFO documentaire (C3 : exception « ligues » non écrite dans l'INVARIANT d'en-tête) |

Ce qui a été vérifié et jugé solide (non re-constaté, contrairement aux ledgers
audit-2) :

- **OCC complet** : sonde de colonne conditionnelle, `ecrireUserRow` refuse de
  ressusciter une ligne supprimée, callback `recalculer` rejoue l'intention sur
  l'état frais, rollback mémoire intégral en cas d'échec, échecs fail-closed
  (le client peut rejouer, rien n'est avalé).
- **Chargement paginé** des tables (`.range(offset, offset + PAGE_SIZE - 1)`,
  `persistence.mjs:716/:787`) avec garde-fou anti-boucle.
- **Clés d'idempotence** des retraits/gains persistées DANS le portefeuille
  (elles survivent au rechargement avec lui), `claimTransaction` via `sbInsert`
  (23505 = refus attendu, transaction déjà traitée), éviction
  `memoryProcessedTransactions` appliquée à l'insert (`:3950-3953`, cap 10 000).
- **Lockout** persisté haché (pas de compteur lisible en base), login en temps
  constant avec hash factice.
- **Sanctions** évaluées à la lecture (pas de flag binaire figé),
  `revokeSanction` annule mémoire sur échec d'écriture, historique jamais
  supprimé.
- `replaceStateCollection`/`upsertStateEntity` fail-closed avec rollback.
- Zones mémoire plafonnées et documentées (users 100 000 refusés à l'insert
  plutôt qu'évincés, canaux évictés par `updatedAt` sauf `global`, etc.).

## Constats

### C1 — FAIBLE : course OCC — le `password_hash` réécrit depuis la mémoire locale peut ressusciter un ancien mot de passe

- `updateUserAccount` lit le hash en mémoire locale AVANT l'écriture
  (`persistence.mjs:1707`), le porte dans la ligne persistée (`:1728`), et sur
  conflit OCC le callback rejoue l'intention sur l'état frais… mais réécrit
  `password_hash: passwordHash` — la valeur périmée lue au départ (`:1741`).
- Scénario : deux instances derrière le LB. L'instance B change le mot de passe
  d'un compte pendant que l'instance A écrit un profil (pseudo, bio…). Au
  retry d'A, la base reçoit un payload frais + le hash ANCIEN. Tant que la
  mémoire de B fait foi, rien ne se voit ; au rechargement (redémarrage,
  failover), l'ancien mot de passe fonctionne et le nouveau est refusé.
  Réversible en refaisant le changement — d'où FAIBLE, pas MAJEUR.
- Même schéma dans `changeActivationEmail` : hash lu `:2533-2534`, réécrit
  périmé `:2546` (ligne initiale) et `:2572` (callback de conflit).
- `updatePasswordHash` fait correctement (`:2342-2400`) : son callback
  ré-applique le NOUVEAU hash sur l'état frais. Les deux autres écrivains ne
  suivent pas ce modèle.

Piste de correctif (à arbitrer) : dans les callbacks de conflit (et idéalement
la ligne initiale), ne pas porter `password_hash` du tout — laisser ce champ à
`updatePasswordHash` — ou reprendre la colonne fraîche de la ligne relu.

### C2 — FAIBLE : `exportMatchHistory` lit la base sans pagination — export silencieusement tronqué

- `:4328-4331` : `.select(...).eq('kind','matches')` sans `.range` ni boucle.
  PostgREST plafonne chaque select (Supabase : 1 000 lignes par défaut — la
  taille de page du chargement des users dans le même fichier, `:716/:787`).
  Au-delà de 1 000 matchs en base, l'export omet les plus anciens sans aucun
  signal.
- Le commentaire au-dessus (`:4308-4311`) choisit la base POUR éviter un export
  « silencieusement incomplet » (la collection mémoire est évacuée par
  `MAX_STATE_PER_KIND`) — l'objectif est contourné par le plafond du select
  lui-même. `state_snapshots.kind='matches'` n'est borné par aucun plafond en
  base : il croît avec chaque match joué, donc le dépassement est inévitable à
  terme sur une plateforme active.

Piste de correctif : boucle paginée identique au chargement des users.

### C3 — INFO : ligues diffusées EN CLAIR — choix produit documenté, mais l'INVARIANT d'en-tête ne l'écrit pas et le payload embarque des dettes inutiles au client

- `saveLeagues` (`state-helpers.mjs:434-439`) diffuse les saisons normalisées
  SANS sanitisation via `broadcastStateSnapshot` = `io.emit('state:leagues')`
  (`push-notifications.mjs:111-113`), et `buildLeagueActionPayload`
  (`:447-455`) renvoie `season` brut dans la réponse HTTP. Compare :
  matchs sanitisés par socket (`:121-132`), tournois sanitisés par socket
  (`:85-96`), BR sanitisés (`toPublicBrLobby`, `:424`) — ligues, jamais.
- Les saisons portent des identifiants internes : `registeredPlayers[].userId`
  (`league-engine.mjs:369-378`), `standings[].userId`
  (`normalizeStanding :112-119`), `qualificationGroups[day].players` = tableau
  de userIds (`:441-446`), `finalists[].userId` (`:597/:627`),
  `podium.first/second/third` = userIds directs (`:733-756`).
- Pourquoi ce n'est PAS une fuite (trois preuves croisées) :
  1. tous les sockets sont authentifiés — le middleware `io.use` refuse toute
     connexion sans session (`realtime-server.mjs:419-435`, refus `:432-435`) ;
  2. la route HTTP `GET /api/leagues` expose la même chose aux mêmes audiences
     (session requise, `routes/league.mjs:83-86`), décision documentée dans le
     commentaire `:74-82` (« une carte sociale de tes adversaires… Le modele
     `isMe` complet est prevu plus tard ») ;
  3. le front documente le choix : « isPlayerRegistered compare sur userId, qui
     reste lisible dans les donnees de ligue : ce store n'est pas diffuse en
     mode isMe » (`leagueStore.ts:14-15`).
- Ce qui reste à dire :
  - l'INVARIANT d'en-tête de `state-helpers.mjs:11-13` (« les identifiants
    internes … ne sont JAMAIS diffuses ») est FAUX pour les ligues, sans
    exception écrite — un lecteur zèle qui l'appliquerait casse
    `isPlayerRegistered` et la page ligue ;
  - le payload diffusé ET la réponse HTTP embarquent des dettes que le front
    ne déclare même pas dans ses types : `pendingRefunds`
    (`league-engine.mjs:985-1039`), `pendingPayouts` (`:729`),
    `uncollectableRefunds`, plus `paid`/`entryFee`/`paidAt` — montants par
    userId et erreurs de remboursement, visibles de tout joueur authentifié
    sans qu'il en ait besoin.

Piste de correctif (à arbitrer) : (1) excepter explicitement les ligues dans
l'INVARIANT d'en-tête (et/ou `docs/05-invariants.md`) ; (2) un
`toPublicLeague` qui retire dettes et champs de paiement de la diffusion — le
front n'en a pas besoin (`leagueStore.ts:29-56`) ; le mode `isMe` complet
restant « prévu plus tard » (il exigerait une émission par socket comme les
tournois).

### C4 — INFO : garde `userId` morte dans `getChatMessagesForChannel` — champ `members` qui n'existe jamais

- Le garde (`persistence.mjs:3432-3442`) teste `channel.members || []` quand
  `userId` est passé, mais `normalizeChatChannelPayload` (`:3348-3363`) ne
  produit QUE `participants` — `members` est toujours `[]` et `isMember` se
  réduit à `type === 'global'`.
- Aucun appelant ne passe `userId` : `routes/chat.mjs:100` (contrôlé en amont
  par `canAccessChatChannel`, `:88`), `chat-helpers.mjs:105` (canaux
  pré-filtrés par `getChatChannelsForUser`, `:92`), et `realtime-server.mjs:111`
  l'importe sans jamais l'appeler.
- Si le garde était activé un jour : échec FERMÉ (refuse tout canal
  non-global) — un break fonctionnel, pas une fuite. Le vrai contrôle d'accès
  est `canAccessChatChannel` (`chat-helpers.mjs:81-82` : admin, ou scope
  public, ou participant).
- Micro : l'import de `realtime-server.mjs:111` est inutilisé ; variable
  `session` déclarée jamais lue dans `deleteAuthSession` (`:3187`).

### C5 — INFO : incohérence latente scope/inbox des canaux de chat

- `normalizeChatChannelPayload` normalise `scope` et `inbox` INDÉPENDAMMENT
  (`persistence.mjs:3359-3360`). Un canal `scope: 'public'` avec
  `inbox: 'participants'` serait consultable via `canAccessChatChannel`
  (scope public, `chat-helpers.mjs:82`) mais absent du bootstrap
  (`getChatChannelsForUser` filtre `inbox === 'all'`, `persistence.mjs:3384`) :
  messages lisibles, canal invisible dans la liste.
- Aucun créateur actuel ne produit cette combinaison
  (`ensureGlobalChatChannel :3464-3467` et `routes/chat.mjs:127-136` posent les
  deux cohérents) — latent pur.

### C6 — INFO : micro-remarques sans impact

- `resolveReport:4267` — ternaire mort
  `resolution === 'dismissed' ? 'resolved' : 'resolved'` : les deux branches
  sont identiques, la valeur utile part dans la colonne `resolution` (`:4291`).
  Bruit de lecture, comportement correct.
- `markChatChannelRead` — l'éviction de `memoryChatReads` (`:3447-3450`) prend
  la première clé d'insertion : une clé ancienne d'un utilisateur actif peut
  être purgée, ses non-lus repartent alors de l'historique complet. Cap 50 000,
  impact cosmétique.

## Résumé

Rien de CRITIQUE ni de MAJEUR dans la couche de données. Les invariants
d'argent et d'OCC sont solides et correctement documentés (sonde de colonne,
refus de résurrection, rollback mémoire, fail-closed, idempotence persistée).
Deux FAIBLE ciblés : la course OCC sur `password_hash` (multi-instance,
effet différé au redémarrage, récupérable) et l'export de matchs sans
pagination (troncature silencieuse au-delà de 1 000 lignes). Quatre INFO, dont
la principale est documentaire : l'exception « ligues » à l'INVARIANT de
sanitisation mérite d'être écrite noir sur blanc, et le payload ligue porte des
dettes (montants par userId) dont le client n'a pas besoin.
