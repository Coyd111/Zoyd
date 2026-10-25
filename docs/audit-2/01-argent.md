# Audit 2 — Étape 1 : l'argent

## Périmètre

Relecture de tous les chemins où de l'argent bouge : mise d'entrée → pot →
répartition → commission → retrait.

Fichiers lus intégralement : `server/wallet-engine.mjs`,
`server/payment-engine.mjs`, `server/payout-countries.mjs`,
`server/match-engine.mjs`, `server/tournament-engine.mjs`,
`server/league-engine.mjs`, `server/br-engine.mjs`,
`server/routes/wallet.mjs`, `server/routes/admin.mjs`,
`server/routes/tournament.mjs`, `server/routes/league.mjs`,
`server/routes/br.mjs`, `server/routes/match.mjs`,
`server/persistence.mjs` (sections portefeuille/paiements),
`server/cron.mjs`, `server/commission-stats.mjs`, `server/mutex.mjs`,
`server/utils.mjs`, `server/http-utils.mjs`, `server/realtime-server.mjs`
(dispatch), `src/lib/matchPayout.ts`, `src/lib/profileMetrics.ts`.

Aucun fichier applicatif n'a été modifié.

## Synthèse

| ID | Sévérité | Objet | Emplacement principal |
|----|-----------|-------|------------------------|
| A1 | **CRITIQUE** — CORRIGÉ | La réconciliation des retraits n'est jamais branchée : le job est un no-op, l'argent des retraits « peut-être partis » reste retenu à jamais | `server/cron.mjs:638` |
| A2 | **CRITIQUE** — CORRIGÉ | Un échec d'écriture du portefeuille rend un gain définitivement perdu (index mémoire des gains non annulé) | `server/wallet-engine.mjs:434` |
| A3 | **CRITIQUE** — CORRIGÉ | La réconciliation rembourse deux fois si l'écriture du tag échoue (latent, révélé par la correction de A1) | `server/wallet-engine.mjs:582` |
| A4 | **ÉLEVÉE** | BR : le barème appliqué n'est pas le barème validé et affiché (5e surpayé, 4 premiers sous-payés) | `server/br-engine.mjs:1169` |
| A5 | **ÉLEVÉE** | Un tournoi à 3 participants ne peut jamais se terminer : les passes restent bloquées à vie | `server/tournament-engine.mjs:365` |
| A6 | **ÉLEVÉE** | Un tournoi à 2 participants détruit 18 % de la cagnotte (la 3e place n'existe pas) | `server/tournament-engine.mjs:498` |
| A7 | **ÉLEVÉE** | Un joueur authentifié peut s'auto-attribuer la place d'arbitre d'un tournoi, contrôler le résultat et percevoir la commission, sans litige possible | `server/tournament-engine.mjs:1227` |
| A8 | **MOYENNE** | Le plafond de retraits cumulés sur 24 h est calculé sur un historique plafonné à 200 : il est contournable | `server/wallet-engine.mjs:76` |
| A9 | **MOYENNE** | Le règlement n'écrit jamais les montants réellement versés : export admin et profils publics affichent des chiffres faux | `server/match-engine.mjs:354` |
| A10 | **MOYENNE** | Un remboursement de retrait raté n'a aucune file de reprise, et la clé d'idempotence est relâchée quand même | `server/routes/wallet.mjs:374` |
| A11 | **MOYENNE** | `/api/wallet/verify-fedapay` envoie une réponse 400 puis poursuit le traitement (double écriture de réponse) | `server/routes/wallet.mjs:447` |
| A12 | **MOYENNE** | Le dépôt administrateur n'a pas de clé d'idempotence | `server/routes/wallet.mjs:173` |
| A13 | **FAIBLE** | `settlementKeys` est plafonné à 500 : au-delà, les statistiques d'un vieux règlement peuvent être réappliquées | `server/persistence.mjs:246` |

**Répartition : 3 Critique — A1, A2, A3 corrigés —, 4 Élevée, 5 Moyenne, 1 Faible.**

> A1 est une **RÉINTÉRESSION** : `docs/audit-2/03-concurrence.md` §4 liste « Retrait
> « peut-être parti » | corrigé | `pending_review` + file de réconciliation ».
> Le mécanisme existe et son test unitaire est vert ; c'est le **câblage** du
> cron qui est faux (même famille que V1, V2, V6 : un mécanisme écrit, testé,
> jamais branché).

---

## 1. Constats

### A1 — CRITIQUE — La réconciliation des retraits n'est jamais branchée : le job est un no-op

**Fichiers** : `server/cron.mjs:633-647` (l'appel), `server/cron.mjs:637-638`
(les deux accesseurs fautifs) ; `server/wallet-engine.mjs:520-523` (la
signature), `:533-553` (la boucle de collecte), `:554` (la sortie anticipée).

**Ce que fait le code.** `reconcilePendingWithdrawals` attend neuf arguments,
dont les positions 4 et 5 sont `listUserIds` et `getWallet` :

```js
// server/wallet-engine.mjs:520-523
export const reconcilePendingWithdrawals = async (
  payoutSucceeded, payoutFailed, retrieveFedaPayPayout,
  listUserIds, getWallet, tagTx, refund, forgetKey, warn,
) => {
```

Le cron passe la **même** fonction aux positions 4 et 5 :

```js
// server/cron.mjs:633-647
const result = await reconcilePendingWithdrawals(
  payoutSucceeded,
  payoutFailed,
  retrieveFedaPayPayout,
  () => listUserIds(),      // 637 : listUserIds  -> OK
  () => listUserIds(),      // 638 : getWallet     -> FAUX : renvoie un tableau d'ids
  (userId, txId, patch) => tagWalletTransaction(userId, txId, patch),
  (userId, amount, extra) => depositToWallet(userId, amount, 'Remboursement', { ... }),
  (userId, key) => forgetWithdrawalKey(userId, key),
  (message, detail) => log.warn(message, detail),
);
```

`getWallet(userId)` renvoie donc `Array.from(memoryUsers.keys())` — un **tableau
d'identifiants**, pas un portefeuille. Dans la boucle :

```js
// server/wallet-engine.mjs:534-552
const wallet = getWallet(userId);
for (const entree of wallet?.payoutsEnAttente || []) { ... }   // undefined -> []
for (const tx of wallet?.transactions || []) { ... }            // undefined -> []
```

`wallet.payoutsEnAttente` et `wallet.transactions` sont `undefined` sur un
tableau : les deux sources sont vides, `pending` est vide, et la fonction sort
immédiatement :

```js
// server/wallet-engine.mjs:554
if (pending.length === 0) return { resolved: 0, refunded: 0, stillPending: 0 };
```

**Impact concret.** Le job `sweepPendingWithdrawals` (toutes les 30 min +
45 s au boot) **ne fait rien, depuis toujours**. Conséquences :

- Un retrait dont l'envoi FedaPay est incertain (`payoutMaybeSent`) est marqué
  `pending_review` par la route (`server/routes/wallet.mjs:346-356`) et
  empilé dans `wallet.payoutsEnAttente` (`server/persistence.mjs:2093-2104`).
  Il n'est **jamais** relu chez FedaPay, **jamais** remboursé si le
  prestataire a refusé, **jamais** solder si le virement est passé.
- **L'argent du joueur reste débité indéfiniment** : le solde est amputé, le
  joueur a reçu une erreur, et aucun chemin automatique ne le rend.
- Aucune alerte : `getHealthInfo` expose `pendingSettlementDebts` pour les
  matchs, les ligues et les tournois (`server/persistence.mjs:1120-1124`) mais
  **pas** les retraits en attente ; `countPendingWithdrawals`
  (`server/wallet-engine.mjs:610`) est exporté et **n'est appelé nulle part**
  en production (vérifié par recherche sur tout `server/`).
- L'aggravant : `depositToWallet` n'a aucune clé d'idempotence
  (`server/wallet-engine.mjs:149-175`). Le jour où le câblage sera corrigé, le
  défaut A3 devient immédiatement exploitable. Les deux correctifs doivent
  tomber ensemble. (A1 et A3 ont effectivement été corrigés ensemble le
  23/10/2026 — voir les blocs « Correctif ».)

**Pourquoi les tests ne l'ont pas vu.** `server/withdrawal-reconciliation.test.mjs:52-61`
teste la fonction **unitairement** avec un `getWallet` correct
(`() => ({ transactions: [tx] })`) : le test est vert. Aucun test ne vérifie le
**câblage** du cron — `server/arbiter-fee-wiring.test.mjs:55` mocke
`reconcilePendingWithdrawals` en entier, donc il ne peut pas voir l'argument
faux. C'est exactement le manque que comble `arbiter-fee-wiring.test.mjs` pour
les commissions d'arbitre.

**Correction proposée.**
1. `server/cron.mjs:638` → passer `(userId) => getUserById(userId)?.wallet`
   (`getUserById` est déjà importé ligne 43).
2. Ajouter `pendingWithdrawals: countPendingWithdrawals(listUserIds, (id) => getUserById(id)?.wallet)`
   à `getHealthInfo` (`server/persistence.mjs:1120`), pour que la dette soit
   visible sur `/api/health`.
3. Ajouter un test de **câblage** (`sweepPendingWithdrawals` avec un
   `pending_review` en base → le remboursement est déclenché), sur le modèle de
   `server/arbiter-fee-wiring.test.mjs`.
4. Corriger A3 **avant** de ré-activer le job.

**Correctif (23/10/2026).**
- `server/cron.mjs:643` : le 5ᵉ argument est désormais
  `(userId) => getUserById(userId)?.wallet` — `payoutsEnAttente` et
  `transactions` sont de nouveau lus, le balayage fait son travail.
- Points 2 et 3 **restent à faire** : la dette n'est pas encore exposée sur
  `/api/health`, et le branchement du cron lui-même n'a toujours pas de test
  (le moteur, lui, est couvert par `server/withdrawal-refund-idempotence.test.mjs`).

---

### A2 — CRITIQUE — Un échec d'écriture du portefeuille rend un gain définitivement perdu

**Fichiers** : `server/wallet-engine.mjs:434` (l'inscription de la clé),
`:411-417` (la garde) ; `server/persistence.mjs:2024-2032`
(`trackWinningsKey`), `:2013-2022` (`hasSettledWinningsKey`), `:1766-1776`
(le rollback mémoire de l'écriture).

**Ce que fait le code.** Dans `releaseWalletWinnings`, la clé d'idempotence
est inscrite **dans l'updater**, c'est-à-dire **avant** l'écriture en base :

```js
// server/wallet-engine.mjs:411-434
const dejaVerse = hasSettledWinningsKey(userId, idempotencyKey, wallet);
if (dejaVerse) {
  return wallet;          // <-- sortie SILENCIEUSE : rien n'est crédité
}
...
trackWinningsKey(userId, idempotencyKey);   // 434 : index MÉMOIRE alimenté
```

`trackWinningsKey` écrit dans une `Map` en mémoire
(`server/persistence.mjs:2025-2032`) qui **n'est pas annulée** quand
l'écriture du portefeuille échoue. Or `updateUserAccount` annule bien le
portefeuille en mémoire :

```js
// server/persistence.mjs:1766-1776
if (supabase && persisted !== OCC_OK) {
  ...
  memoryUsers.set(userId, current);      // le portefeuille revient en arrière
  ...
  throw makeError('SERVER_BUSY', 'Sauvegarde du profil impossible, reessaie dans un instant.');
}
```

`memoryWinningsKeys` (l'index) **n'est pas** remis dans le même état.

**Impact concret.** Une erreur de base transitoire (Supabase indisponible,
timeout) ou un conflit OCC au moment du versement d'un gain :

1. `releaseWalletWinnings` → l'updater inscrit la clé en mémoire → l'écriture
   échoue → `SERVER_BUSY` → **le joueur n'est pas payé**.
2. Le moteur de règlement tombe dans son `catch` et consigne une dette
   (`pendingPayouts` pour un tournoi/une ligue, `settlementErrors` pour un
   match, `settlementErrors` pour un salon BR).
3. Le cron de reprise rejoue le versement. `hasSettledWinningsKey` consulte
   `getWinningsKeys(userId)` → **la clé est en mémoire** → `dejaVerse = true`
   → `releaseWalletWinnings` renvoie le portefeuille **intact** : le gain n'est
   **pas** crédité, et **aucune erreur n'est levée**.
4. La reprise compte ce versement comme **réussi** (`retried += 1`) et retire
   la dette de `pendingPayouts` (`server/tournament-engine.mjs:1165`,
   `server/league-engine.mjs:850`). **La dette est close, l'argent n'a jamais
   été versé.**
5. La réservation `lockedEntries[matchId]` n'a jamais été consommée : le pass
   du joueur reste bloqué, et il n'existe aucun chemin qui le libère (le
   match est clos, le règlement est « terminé »).

Dans le salon BR, le damage est aggravé : `player.settled = true` et
`player.winnings = prize.amount` sont écrits après l'appel
(`server/br-engine.mjs:862-863`) → **le salon affiche une prime versée qui ne
l'a jamais été**.

Les quatre moteurs de règlement sont concernés : match
(`server/match-engine.mjs:431`), tournoi (`server/tournament-engine.mjs:667`),
ligue (`server/league-engine.mjs:724`), BR (`server/br-engine.mjs:854`).

**Pourquoi les tests ne l'ont pas vu.** Aucun test n'exerce un **échec
d'écriture** du portefeuille pendant un versement. Les tests d'idempotence
(`server/settlement-idempotence.test.mjs`, `server/winnings-key-index.test.mjs`)
vérifient qu'un second versement ne crédite rien — c'est-à-dire exactement le
comportement qui cause la perte ici, mais dans le cas *opposé* (le premier
versement ayant réussi).

**Correction proposée.**
1. Exposer `untrackWinningsKey(userId, key)` dans `persistence.mjs` et
   l'appeler dans le `catch` de `updateWalletSnapshot` (ou faire porter
   l'annulation par `updateUserAccount`, qui est le seul point d'écriture).
2. Alternative plus robuste : faire de la garde d'idempotence une contrainte
   UNIQUE en base (table `settled_winnings`), comme `processed_transactions`
   pour les dépôts — c'est la seule façon d'être correct en multi-instance
   (cf. `docs/audit-2/03-concurrence.md` §B2).
3. Tant que la correction n'est pas faite : ne pas considérer un versement
   « sans effet » comme un versement réussi. `releaseWalletWinnings` devrait
   **lever** quand la clé est déjà présente **et** que le portefeuille ne
   contient pas la transaction correspondante, au lieu de renvoyer le
   portefeuille intact.

**Correctif (23/10/2026).**
- `untrackWinningsKey(userId, key)` est exporté (`server/persistence.mjs`) et
  appelé dans le `catch` de chaque écriture de versement
  (`server/wallet-engine.mjs`, `releaseWalletWinnings`) : le rollback mémoire
  annule désormais aussi l'index.
- La décision « déjà versé ? » est **figée au premier passage de l'updater**
  (`let dejaVerse = null` puis garde conditionnelle) : la boucle OCC peut
  rejouer l'updater sans que la trace inscrite par l'itération précédente
  fasse croire le versement déjà fait — le piège inverse d'un
  `hasSettledWinningsKey` réévalué à chaque passage.
- Couvert par `server/withdrawal-refund-idempotence.test.mjs` (échec d'écriture
  injecté entre l'updater et l'écriture) et `server/stale-base-write.test.mjs`
  pour la base. La contrainte UNIQUE en base (point 2) reste une piste pour le
  multi-instance, non traitée.

---

### A3 — CRITIQUE — La réconciliation rembourse deux fois si l'écriture du tag échoue

**Fichiers** : `server/wallet-engine.mjs:573-592` (la séquence
remboursement → tag → forgetKey), `:596-603` (le `catch`).

**Ce que fait le code.** Dans la branche « refus définitif » :

```js
// server/wallet-engine.mjs:582-592
const montant = item.tx ? Math.abs(Number(item.tx.amount) || 0) : 0;
if (montant > 0) {
  await refund(item.userId, montant, { idempotencyKey: item.idempotencyKey });  // 584
} else { ... }
await tagTx(item.userId, item.tx?.id || null, { ...marque, payoutStatus: 'failed', status: 'failed' }); // 590
forgetKey(item.userId, item.idempotencyKey);   // 591
```

Le **remboursement passe avant le tag**, et le `catch` unique (`:596`) englobe
les deux. Si le tag échoue (conflit OCC, base indisponible) **après** que le
remboursement a réussi :

- l'argent est déjà crédité ;
- la transaction reste `pending_review` et l'entrée reste dans
  `payoutsEnAttente` (le tag est aussi ce qui sort l'entrée de la file,
  `server/persistence.mjs:2105-2112`) ;
- le `catch` journalise « Reconciliation retrait impossible » et incrémente
  `stillPending` → **l'entrée sera reprise au cycle suivant**.

Le cycle suivant relit le payout, constate toujours le refus, et rembourse
**encore**. Le callback `refund` du cron est un `depositToWallet` nu : il
n'exécute **aucun** contrôle de clé d'idempotence. La clé travels dans les
métadonnées (`server/cron.mjs:640-644`) mais n'est jamais consultée.

**Impact concret.** Double remboursement = perte sèche pour la plateforme, sur
un montant de retrait entier. Aujourd'hui ce défaut est **masqué par A1**
(le job ne tourne pas) : **corriger A1 seul l'arme**. Les deux correctifs
doivent être livrés ensemble.

**Correction proposée.**
1. Rendre le remboursement idempotent : écrire d'abord une trace durable
   « remboursement effectué pour (userId, idempotencyKey) » (champ dédié dans
   le portefeuille, ou la transaction `refund` elle-même avec son
   `metadata.idempotencyKey`), et ne créditer que si cette trace est absente.
2. Réordonner : marquer d'abord la transaction `failed` (donc sortir l'entrée
   de `payoutsEnAttente`), puis rembourser ; en cas d'échec du tag, on ne
   rembourse pas (le cycle suivant réessaiera).
3. Dans tous les cas, ne pas crediter et ne pas marquer « traité » dans la même
   zone non transactionnelle : il faut une seule opération atomique
   (écriture de la trace + crédit), par exemple via `updateUserAccount` qui
   les écrit dans la même ligne `app_users`.

**Correctif (23/10/2026).**
- `refundRejectedWithdrawal(userId, montant, refundKey, context)`
  (`server/wallet-engine.mjs:206`) : le crédit **et** la trace durable
  (`wallet.winningsKeys` + transaction `refund` avec
  `metadata.winningsKey`) sont écrits dans **une seule** opération — point 3.
- Le callback du cron (`server/cron.mjs:650`) dérive une clé stable
  `refund:${idempotencyKey}` (ou `refund:payout:${payoutId}`) ; un rejeu ne
  crédite pas deux fois.
- L'ordre choisi est remboursement
  **puis** tag : le remboursement passe en premier car fermer la dette avant
  de l'avoir rendue figerait un litige jamais remboursé, silencieux à vie.
  L'idempotence du remboursement rend ce dernier sûr.
- Deux défauts latents **découverts par les nouveaux tests** :
  1. `normalizeWalletSnapshot` (`server/persistence.mjs:200`) ne copiait pas
     `payoutsEnAttente` : **toute** écriture du portefeuille (dépôt, retrait,
     gain) écrasait la file — la dette n'y survivait qu'à la chance (uniquement
     via les marquages immédiatement suivi d'aucun mouvement de solde). La file
     est désormais copiée.
  2. `tagWalletTransaction` (`server/persistence.mjs:2134`) filtrait la file,
     puis une réassignation finale écrasait le résultat avec le tableau
     **précédent au filtre** : l'entrée refusée ne sortait **jamais** de la
     file et resterait à vie (invisible jusqu'au point 1, puisque toute
     écriture détruisait de toute façon la file). Corrigé en même temps.
- Couverture : `server/withdrawal-refund-idempotence.test.mjs` (idempotence,
  échec d'écriture, boucle avec tag en échec, ordre remboursement → tag,
  survie de la file).

---

### A4 — ÉLEVÉE — BR : le barème appliqué n'est pas le barème validé et affiché

**Fichiers** : `server/br-engine.mjs:1152-1195` (`computeBrPayouts`),
`:1156` (`winnersPool`), `:1166-1173` (les parts) ; `server/br-engine.mjs:224-256`
(`validateBrPayout`) ; `server/br-engine.mjs:117-119` (`BR_DEFAULT_PAYOUT`).

**Ce que fait le code.** Le barème est validé comme une **fraction du pot** :
`validateBrPayout` exige `first + second + third + fourth + fifth + arbiterRate = 1`
(`:244-250`), et le défaut est `40 + 22 + 13 + 12 + 8 + 5` (`:117-119`).

Mais `computeBrPayouts` applique les parts du gagnant à `winnersPool`, qui est
**déjà amputé de la commission** :

```js
// server/br-engine.mjs:1156
const winnersPool = roundAmount(pot * (1 - arbiterRate));
...
// server/br-engine.mjs:1169-1171
const amount = i === lastIndex
  ? roundAmount(winnersPool - distributed)     // <-- absorbe TOUT le reste
  : roundAmount(winnersPool * shares[i]);      // <-- part × (pot - commission)
```

Le dernier bénéficiaire absorbe le reste de `winnersPool` : il avale la part
`fifth` **et** la sous-application des quatre premières parts.

**Impact concret.** Pot 1 000 ZC, barème par défaut :
1er = 380 (déclaré 400) · 2e = 209 (220) · 3e = 123,50 (130) ·
4e = 114 (120) · **5e = 123,50 (déclaré 80)** · arbitre = 50.

La masse est conservée (950 + 50 = 1 000 ✓), mais **la répartition est fausse** :
le 5e est surpayé de 43,50 ZC (4,35 % du pot) et les quatre premiers sont
sous-payés. Avec moins de 5 joueurs, c'est pire : le 3e sur 3 reçoit
`950 - 380 - 209 = 361` au lieu de 130 (cas couvert par le test
`server/br-engine.test.mjs:713-719`, qui ne vérifie que le **total**).

Le défaut ne vient pas du barème par défaut : il touche **tout** barème
accepté par `validateBrPayout` (somme = 100 % avec la commission), y compris
celui du test `server/br-engine.test.mjs:30`
(`0.4/0.22/0.15/0.12/0.08 + 0.03` → sur un pot de 333,33, le 5e reçoit 34,77
au lieu des 26,67 déclarés, soit 2,4 % du pot en trop). Seule la masse totale
est correcte, et c'est la seule chose que le test asserve
(`server/br-engine.test.mjs:668-719`).

Le barème **configuré** par l'administrateur n'est donc pas celui qui est
appliqué au versement (l'affichage côté interface n'a pas été relu — voir §3).

**Correction proposée.** Appliquer les parts au **pot**, et laisser le dernier
absorber le reliquat **après** la commission :

```js
const arbiterAmount = roundAmount(pot * arbiterRate);
const amount = i === lastIndex
  ? roundAmount(pot - arbiterAmount - distributed)
  : roundAmount(pot * shares[i]);
```

Contrôle : pot 1 000 → 400 / 220 / 130 / 120 / **80** / 50, total 1 000 ✓.
Ajouter un test qui asserte **chaque part** contre le barème déclaré (le test
existant n'asserte que le total).

**Correctif (livré avec M3 le 23/10/2026).**
- La forme en vigueur est déjà celle proposée : les parts sont appliquées au
  **pot** et le dernier bénéficiaire absorbe le reliquat après commission —
  vérifié numériquement (pot 1 000 → 400 / 220 / 130 / 120 / 80 / 50).
- Couverture M3 (`server/br-engine.test.mjs`) : chaque part est assertée
  contre le barème déclaré, plus un cas de pot à décimales (999,97) qui
  ferait éclater un reliquat mal absorbé.
- Restant : relire l'affichage de la répartition côté interface (§3), non
  couvert par ce lot.

---

### A5 — ÉLEVÉE — Un tournoi à 3 participants ne peut jamais se terminer : les passes restent bloquées à vie

**Fichiers** : `server/tournament-engine.mjs:291` (`minEntries`),
`:365-382` (création du match de 3e place), `:424-431` (`placeSemifinalLoser`),
`:462-484` (auto-avant), `:531-540` (`isTournamentComplete`),
`:1212-1217` (balayage de péremption).

**Ce que fait le code.** `minEntries = Math.min(4, maxEntries)` (`:291`) : un
tournoi créé avec `maxEntries = 3` est **lançable à 3 participants**. Le
tableau devient alors `bracketSize = 4`, `mainRounds = 2`, donc un match de 3e
place **est** créé (`:365-382`).

Mais ce match de 3e place ne peut **jamais** se remplir :

- le 1er match de 1/2 final a deux participants → son perdant part en 3e place
  (`placeSemifinalLoser`, appelé depuis `advanceTournament:593`) ;
- le 2e match de 1/2 final n'a qu'un participant (le 3e inscrit) → il est
  **auto-avanté** dans `normalizeMatches` (`:462-484`), chemin qui appelle
  `placeWinner` mais **jamais** `placeSemifinalLoser`.

Le match de 3e place a donc **un seul participant** : il ne passe jamais
`'ready'`, donc jamais `'finished'`. Or :

```js
// server/tournament-engine.mjs:531-540
const bronzeMatch = tournament.matches.find((match) => match.bracketType === 'third_place');
if (!bronzeMatch) return true;
return bronzeMatch.status === 'finished' && !!bronzeMatch.winnerEntryId;   // jamais vrai
```

`isTournamentComplete` reste faux → `finalizeTournamentPlacements` n'est jamais
appelé → `applyTournamentSettlement` n'est **jamais** exécuté → les passes des
3 capitaines (`entryFee × teamSize` chacun) restent dans `lockedEntries`.

**Impact concret.** Les 3 capitaines perdent l'argent de leur inscription,
**sans contrepartie et sans issue** : le tournoi reste `'live'`, aucun cron ne
balaye les tournois `'live'` (`getExpiredTournamentIds` ne retient que
`'recruiting'`, `:1215`), et le support n'a aucun signal (`/api/health` ne
compte que `pendingPayouts`/`pendingRefunds`).

C'est un **complément de C4** (`docs/audit-2/03-concurrence.md`), mais la
**cause racine est différente** : C4 décrit un tournoi bloqué parce que son
arbitre a disparu ; ici le tournoi est **structurellement incapable de se
terminer**, même avec un arbitre présent et réactif. Le correctif de C4
(balayer les tournois `'live'`) récupérerait l'argent, mais le tournoi ne
verserait jamais son podium.

**Correction proposée.**
1. Ne créer le match de 3e place que s'il peut avoir deux participants, ou
   le compléter par une bye (l'auto-avant doit aussi alimenter
   `placeSemifinalLoser`) ;
2. à défaut, ne pas Lan cer un tournoi dont le tableau ne peut pas se remplir :
   `startTournamentOnServer` (`:1266-1295`) doit refuser un effectif qui ne
   remplit pas le bracket (exiger `entries.length >= 4` ou lapuissance de 2
   immediatement inférieure) ;
3. étendre le balayage de péremption aux tournois `'live'` (C4) et ajouter le
   cas « tournoi `live` dont le bracket est incomplet » à la file de
   remboursement.

---

### A6 — ÉLEVÉE — Un tournoi à 2 participants détruit 18 % de la cagnotte

**Fichiers** : `server/tournament-engine.mjs:67-85` (`buildPayout`),
`:291` (`minEntries`), `:498-529` (`finalizeTournamentPlacements`),
`:661-700` (`applyTournamentSettlement`).

**Ce que fait le code.** Le barème du tournoi est 50 / 30 / 20 % du
`playerPool` :

```js
// server/tournament-engine.mjs:73-75
const first = roundAmount(playerPool * 0.5);
const second = roundAmount(playerPool * 0.3);
const third = roundAmount(playerPool - first - second);   // 20 %
```

Or `maxEntries = 2` ⇒ `minEntries = 2` ⇒ le tournoi est lançable à 2
participants ⇒ `bracketSize = 2` ⇒ `mainRounds = 1` ⇒ **pas de match de 3e
place** (`:365`). `finalizeTournamentPlacements` (`:498-529`) attribue donc
`finalPlacement = 1` et `2`, et **jamais 3** :

```js
// server/tournament-engine.mjs:504-520
const thirdPlaceId = bronzeMatch?.winnerEntryId;   // undefined
...
if (entry.id === thirdPlaceId) { return { ...entry, finalPlacement: 3 }; }  // jamais vrai
```

`applyTournamentSettlement` ne verse que les classements existants
(`:661-700`) : `payout.third` (20 % du `playerPool`) **n'est jamais versé à
personne**.

**Impact concret.** Tournoi à 2 équipes, `entryFee = 1 000 ZC`, 1 arbitre :
`grossPool = 2 000` · `arbiterPool = 100` (5 %) · `playerPool = 1 800` ·
versé = `900 + 540 = 1 440` · **détruit = 360 ZC (18 % du pot)**. Et les
passes des 2 capitaines sont consommés (`releaseWalletWinnings` /
`settleMatchLossWallet` libèrent la réservation) : l'argent quitte le
séquestre sans jamais atteindre la bonne poche.

**Correction proposée.**
1. Refuser `maxEntries < 4` à la création d'un tournoi (la route autorise
   aujourd'hui 2 à 256, `server/routes/tournament.mjs:110`), ou refuser de
   lancer un tournoi dont le bracket ne peut pas produire 3 places
   classées ;
2. à défaut, redistribuer les parts non attribuées aux classements existants
   (comme le fait BR avec le « dernier bénéficiaire absorbe ») et **asserter**
   que `somme des parts versées == grossPool` avant de solder.

---

### A7 — ÉLEVÉE — Un joueur authentifié peut s'auto-attribuer la place d'arbitre d'un tournoi, contrôler le résultat et percevoir la commission

**Fichiers** : `server/tournament-engine.mjs:1227-1256`
(`assignTournamentArbiterOnServer`), `server/routes/tournament.mjs:178-194`
(la route) ; `server/tournament-engine.mjs:702-746` (la commission),
`:1402-1451` (`submitTournamentMatchResultOnServer`).

**Ce que fait le code.** La fonction d'attribution d'arbitre **ne vérifie
aucun rôle** :

```js
// server/tournament-engine.mjs:1227-1248
export const assignTournamentArbiterOnServer = (tournaments, actor, tournamentId) => {
  const actorUser = requireActorUser(actor);
  ...
  if (tournament.entries.some((entry) => entry.members.some((member) => member.userId === actorUser.id))) {
    throw makeError('ROLE_CONFLICT', "Un joueur ne peut pas arbitrer son propre tournoi.");
  }
  ...
  const emptySlot = tournament.arbiters.find((arbiter) => !arbiter.userId);
  if (!emptySlot) throw makeError('ARBITER_TAKEN', "Il n'y a plus de place d'arbitre disponible.");
  Object.assign(emptySlot, { userId: actorUser.id, ... });
```

La route n'exige qu'une session (et n'a **pas** de rate limit) :

```js
// server/routes/tournament.mjs:178-194
const tournamentArbiter = pathname.match(/^\/api\/tournaments\/([^/]+)\/arbiter$/);
if (req.method === 'POST' && tournamentArbiter) {
  const session = getAuthenticatedAppSession(req);
  if (!session) { ... 401 ... }
  try { await withTournamentMutex(async () => {
    const outcome = assignTournamentArbiterOnServer(getStoredTournaments(), session.user, tournamentArbiter[1]);
```

L'arbitre désigné contrôle ensuite le résultat du duel
(`requireTournamentMatchAction:1308-1311`) et **le règlement part
immédiatement** si le tournoi se termine (`:1449-1451`). L'arbitre perçoit sa
part de commission (`:702-746`, `arbiterPool / arbitersNeeded`, soit 5 % ou
10 % du pot selon la taille).

Le contraste est net dans le même code : `createBrLobbyOnServer` exige un
arbitre **admin** (`server/br-engine.mjs:317-329`), et la ligue exige un
admin pour tous les résultats qui déterminent le podium
(`server/league-engine.mjs:491`, `:566`, `:599`). Le tournoi, non.

**Impact concret.**
- **Contrôle du résultat** : un joueur (avec un second compte, ou un
  complice inscrit comme capitaine) prend un slot d'arbitre du tournoi d'un
  tiers, déclare son complice vainqueur, et empoche 50 % du `playerPool` ;
  l'arbitre empoche 5 à 10 % du pot.
- **Aucun recours** : le moteur de tournoi ne contient **aucun** mécanisme de
  litige ni de confirmation (recherche exhaustive : 0 occurrence de
  `dispute` / `contest` / `confirmation` dans `server/tournament-engine.mjs` et
  `server/routes/tournament.mjs`). Contrairement au match 1v1-5v5 (fenêtre de
  confirmation de 30 min + litige), le verdict du tournoi est définitif.
- **Blocage** : `startTournamentOnServer:1280` exige que **tous** les slots
  d'arbitre soient couverts → un joueur peut aussi **prendre un slot et
  disparaître**, empêchant le tournoi de démarrer et bloquant les passes de
  tous les inscrits.
- Le même jour, `assignArbiterOnServer` côté match
  (`server/match-engine.mjs:706-729`, route `server/routes/match.mjs:154-164`)
  est lui aussi ouvert à tout joueur authentifié : il contrôle le résultat du
  match et touche 2 % du pot (avec, en plus, la fenêtre de confirmation qui
  limite la fraude).

À distinguer de **S3** (`docs/audit-2/02-autorisation.md`), qui porte sur
l'override admin sans 2FA sur la route de résultat : ici, c'est l'**acquisition
de la qualité d'arbitre** qui n'est pas gardée.

**Correction proposée.**
1. `assignTournamentArbiterOnServer` : exiger `actorUser.role === 'admin'`
   (comme `createBrLobbyOnServer`), ou un drapeau serveur `canBeArbiter` /
   `trustScore` minimal ;
2. `requireTournamentMatchAction` : retirer l'override admin, ou exiger la 2FA
   sur la route (cf. S3) ;
3. ajouter un rate limit sur `POST /api/tournaments/:id/arbiter` ;
4. même garde pour `assignArbiterOnServer` côté match.

**Correctif (25/10/2026) — décision produit et rate limit.**
- **Décision produit : la garde admin n'est PAS appliquée.** La ligue reste
  le seul domaine où l'arbitre est un admin. Pour les tournois et les
  matchs, tout joueur authentifié peut se présenter volontaire : soit il
  prend un slot créé en « premier arrivé », soit il crée son propre
  match / tournoi. Exiger `role === 'admin'` (points 1 et 4) dénature le
  modèle volontariat attendu. Le filet existant demeure : `ROLE_CONFLICT`
  interdit d'arbitrer son propre tournoi, et le match impose la fenêtre de
  confirmation au perdant.
- **Point 2 : couvert par S3** — `require2faIfAdmin` (serveur) impose une
  2FA fraîche à toute session admin qui passe par les routes de résultat ;
  le joueur arbitre, lui, passe sans code.
- **Point 3 : rate limit en place** — `POST /api/tournaments/:id/arbiter`
  est passé au groupe `social` (comme son jumeau match
  `POST /api/matches/:id/arbiter`), placé avant la session.
- **Point de vigilance BR : `createBrLobbyOnServer` exige toujours un
  arbitre admin** (correctif anti-fraude conservé en l'état). Si BR doit
  rejoindre le modèle volontariat, c'est une décision produit distincte à
  trancher — cette lacune n'est pas corrigée unilatéralement.


---

### A8 — MOYENNE — Le plafond de retraits cumulés sur 24 h est calculé sur un historique plafonné à 200 : il est contournable

**Fichiers** : `server/wallet-engine.mjs:76-90` (`getWindowedWithdrawalTotal`),
`:130-133` (`withTransaction`, plafond de 200), `:60`
(`MAX_WITHDRAWAL_DAILY_ZC = 50 000`), `:199-206` (le contrôle).

**Ce que fait le code.** Le cumul est lu dans l'historique du portefeuille :

```js
// server/wallet-engine.mjs:76-90
export const getWindowedWithdrawalTotal = (wallet, nowMs = Date.now()) => {
  ...
  for (const tx of wallet?.transactions || []) { ... total += Math.abs(...) }
```

Or l'historique est plafonné à 200 entrées :

```js
// server/wallet-engine.mjs:132
transactions: [buildTransaction(tx), ...(Array.isArray(wallet.transactions) ? wallet.transactions : [])].slice(0, 200),
```

**Impact concret.** Le retrait minimum est 150 ZC (`MIN_WITHDRAWAL_ZC`). Pour
dépasser le plafond de 50 000 ZC, il faut **au moins 334 retraits** de 150 ZC
sur 24 h. Or seuls les **200 derniers** restent visibles : le cumul calculé
plafonne à 200 × 150 = **30 000 ZC**, et le contrôle
`cumul + safeAmount > 50 000` (`:201`) **ne se déclenche jamais**. Un joueur
peut donc enchaîner 334 retraits de 150 ZC et vider 50 100 ZC en 24 h — ce que
le plafond existe précisément pour empêcher (commentaire de `MAX_WITHDRAWAL_DAILY_ZC` :
« un joueur pouvait enchaîner les retraits jusqu'à vider son solde »).

Le rate limiter (`wallet`, 20 requêtes / 10 min / IP) n'empêche pas 334
retraits en quelques heures depuis plusieurs IP.

Le test `server/withdrawal-daily-cap.test.mjs:110-124` ne voit pas le
défaut : il utilise deux retraits de 30 000 ZC, donc un cumul visible de
30 000 — il vérifie le plafond sans jamais remplir l'historique.

**Correction proposée.** Compter le cumul sur une source **non plafonnée** :
listePers dedicated des retraits de la fenêtre (dans le portefeuille, comme
`payoutsEnAttente`) ou compteur horodaté persistant. Le plafond doit lire
cette source, pas `wallet.transactions`.

---

### A9 — MOYENNE — Le règlement n'écrit jamais les montants réellement versés : export admin et profils publics affichent des chiffres faux

**Fichiers** : `server/match-engine.mjs:354-549` (`applyResultSettlement` — aucun
écriture de `match.payouts`), `:601` (`arbiterFee` théorique) ;
`server/routes/admin.mjs:109-141` (`buildMatchesCsv`) ;
`server/state-helpers.mjs:187` (`safe.projectedPayouts = getProjectedPayouts(match)`) ;
`src/lib/matchPayout.ts:79-84`, `src/lib/profileMetrics.ts:206`.

**Ce que fait le code.** `applyResultSettlement` calcule les montants
réellement versés (`sharePerWinner`, `firstWinnerShare`, `arbiterFee`) mais ne
les écrit **nulle part** dans le match : le champ `match.payouts` n'est jamais
alimenté (recherche exhaustive sur `server/match-engine.mjs`). En revanche le
champ `match.arbiterFee` reste celui de la création :

```js
// server/match-engine.mjs:601
arbiterFee: roundAmount(prizePool * 0.02),   // prizePool = entryFee × maxPlayers (théorique)
```

alors que le règlement prélève 2 % du **pot réel** :

```js
// server/match-engine.mjs:372
const arbiterFee = match.arbiter?.userId ? roundAmount(lockedPot * ARBITER_FEE_RATE) : 0;
```

**Impact concret.**
- **Export admin** (`GET /api/admin/matches/export`, protégé par la 2FA) :
  la colonne `arbiterFee` sort le montant **théorique**, et la colonne
  `payouts` sort **toujours vide** (`match.payouts` n'existe pas). Le document
  qui sert de sauvegarde de l'historique financier ne contient donc aucun
  montant réellement versé.
- **Profils publics** : après le règlement, les réservations sont libérées →
  `getLockedPot` vaut 0 → `getProjectedPayouts` retombe sur `match.prizePool`
  (`server/match-engine.mjs:212-214`) → `perWinner` redevient le **pot
  théorique**. Le profil public d'un joueur et `communityInsights` affichent
  donc un gain **jamais versé** (match au roster incomplet : le règlement verse
  moins que le pot théorique).

**Correction proposée.**
1. Écrire les montants réellement versés dans `match.payouts` (userId, pseudo,
   montant, type) au moment du règlement, et les persister ;
2. alimenter l'export CSV avec `match.payouts` et avec l'`arbiterFee`
   **réellement** versé ;
3. faire de `match.payouts` la source de la projection **une fois le match
   clos** (au lieu du repli sur `prizePool`).

**Correctif (25/10/2026).**
- **Point 1 : `recordActualPayout`** (`server/match-engine.mjs`) écrit dans
  `match.payouts` une entrée `(userId, pseudo, amount, type, paidAt)` au fil
  du règlement : la part du vainqueur après réussite du versement, la
  commission quand elle aboutit, et aussi la reprise A1/A3
  (`retryPendingArbiterFees`) quand la créance est enfin payée.
  **Écriture unique par (userId, type)** : le rejeu d'un règlement
  interrompu recalcule la répartition sur un pot réduit (les réservations
  des payés sont déjà libérées) ; la garde conserve la première valeur
  écrite — la seule qui a fini sur un compte, l'idempotence du wallet
  (`type:matchId` par utilisateur) rendant les relances silencieuses.
- **Point 2 : export CSV** (`server/routes/admin.mjs`) — la colonne
  `payouts` est remplie (uuid:pseudo:montant | …), et deux colonnes
  s'ajoutent : `arbiterFeeReel` (somme des commissions réellement payées)
  et `pendingArbiterFee` (créance restante, suivi de la reprise).
  `arbiterFee` reste théorique, en vis-à-vis pour la comparaison.
- **Point 3 : projection** — `getProjectedPayouts` bascule sur les montants
  écrits dès que `match.payouts` existe (`basis` = total versé + commission
  réelle), au lieu du repli sur `prizePool` théorique après libération des
  réservations. Côté front, le tableau arrive normalisé
  (`matchStore.normalizeStoredPayouts`) et `src/lib/matchPayout.ts` fait
  primer la part **du lecteur** (`isMe`) sur la projection pour les gains
  d'un profil possédé ; les profils vus par un tiers sont servis par la
  projection, réelle depuis ce correctif.
- **Sanitisation** : l'UUID de chaque payé ne sort plus du payload public —
  remplacé par `isMe`, comme le roster.
- **Défaut voisin découvert au passage** : la note de créance
  `pendingArbiterFee` était évaluée **avant** la tentative de versement de
  la commission (donc jamais écrite à la première tentative). La note est
  désormais posée après le try/catch, quand elle reflète vraiment un échec.
- Couverture : `server/match-engine.test.mjs` (bloc A9 — versement réel,
  écriture unique au rejeu, commission en échec puis reprise, projection),
  `server/state-helpers.test.mjs` (fuite d'UUID dans `payouts`),
  `server/matches-export-csv.test.mjs` (schéma de colonnes de l'export).


---

### A10 — MOYENNE — Un remboursement de retrait raté n'a aucune file de reprise, et la clé d'idempotence est relâchée quand même

**Fichiers** : `server/routes/wallet.mjs:362-383` (le remboursement),
`:403-407` (le `finally` qui relâche la clé) ;
`server/wallet-engine.mjs:310-336` (`refundLockedEntry`, non idempotent par
clé mais sans-op si la réservation n'existe plus).

**Ce que fait le code.**

```js
// server/routes/wallet.mjs:362-383
try {
  await withWalletMutex(session.user.id, async () => {
    await depositToWallet(session.user.id, body.amount, 'Remboursement', { type: 'refund', ... });
  });
} catch (refundError) {
  log.error('CRITICAL: Refund also failed — balance to reconcile manually', { ... });
}
...
} finally {
  if (cleanKey) forgetWithdrawalKey(session.user.id, cleanKey);   // 406
}
```

**Impact concret.** Si le remboursement échoue (base indisponible, conflit
OCC), **l'argent n'est pas rendu** et rien ne le rejouera : contrairement aux
tournois et aux ligues (qui ont `pendingRefunds` + un cron dédié,
`server/cron.mjs:711-747`), le portefeuille n'a **aucune** file de
remboursements en attente. Le retrait est ensuite marqué `failed`
(`:389`) : il devient invisible dans l'historique (le joueur lit « retrait
échoué ») et n'est pas compté dans les commissions
(`server/commission-stats.mjs:42-45`), alors que l'argent est bien sorti de
son solde. Le support doit le découvrir seul.

Pire : `forgetWithdrawalKey` est exécuté dans le `finally`, **même si le
remboursement a échoué** → la clé d'idempotence est brûlée alors que
l'intention n'a pas été honorée (la clé est recouverte par le cas
« remboursement » de `hasActiveWithdrawalKey`, `server/persistence.mjs:1900-1912`,
qui suppose que le remboursement **a** eu lieu).

**Correction proposée.**
1. Écrire une dette « remboursement dû » dans le portefeuille (champ dédié,
   comme `payoutsEnAttente`) avant de tenter le crédit, et la solder après ;
   le cron la rejoue (un `refund` idempotent, cf. A3) ;
2. ne relâcher `idempotencyKey` que si le remboursement a **réussi** ;
3. tant que (1) n'existe pas : ne pas marquer le retrait `failed` si le
   remboursement a échoué — le laisser `pending_review` pour que la
   réconciliation (A1) le tranche.

---

### A11 — MOYENNE — `/api/wallet/verify-fedapay` envoie une réponse 400 puis poursuit le traitement

**Fichiers** : `server/routes/wallet.mjs:440-451` (le callback du mutex),
`:479-488` (le `catch`).

**Ce que fait le code.**

```js
// server/routes/wallet.mjs:440-451
try { await withWalletMutex(session.user.id, async () => {
    const body = await parseRequestBody(req);
    const transactionId = ... String(body.transactionId);
    if (!/^\d{1,20}$/.test(transactionId)) {
      respondJson(res, 400, { ok: false, error: 'transactionId invalide.', code: 'INVALID_TRANSACTION_ID' });
      return true;      // <-- sort du CALLBACK, pas de la route
    }
    const outcome = await verifyFedaPayTransactionAndCredit(transactionId, session.user);
```

Le `return true` ne quitte que le callback du mutex : la route **continue** et
appelle `verifyFedaPayTransactionAndCredit` avec un identifiant invalide.
L'appel à FedaPay échoue → le `catch` de la route (`:479`) appelle
`respondMappedError` → **seconde** `respondJson` → `res.writeHead` sur une
réponse déjà envoyée → `ERR_HTTP_HEADERS_SENT` (avalée par le filet de
`server/realtime-server.mjs:312-317`, mais le client a déjà reçu un 400 et le
journal se remplit d'erreurs internes).

**Impact concret.** Aucun argent (un identifiant mal formé ne peut pas être
crédité), mais : un appel réseau inutile à FedaPay pour chaque requête
malformée, une erreur interne par requête, et surtout **le même schéma que
celui qui a valu un double versement** sur `/api/wallet/withdraw` — là, il a
été corrigé par le drapeau `abandonner` (`server/routes/wallet.mjs:246`,
`:274-276`, `:297`), ici le motif est toujours présent.

**Correction proposée.** Valider **avant** d'entrer dans le mutex, ou utiliser
le drapeau `abandonner` comme dans la route de retrait ; ajouter une garde
`if (res.headersSent) return;` dans `respondJson`
(`server/http-utils.mjs:129`) pour qu'une seconde réponse ne puisse pas
provoquer d'exception.

---

### A12 — MOYENNE — Le dépôt administrateur n'a pas de clé d'idempotence

**Fichier** : `server/routes/wallet.mjs:150-181`.

**Ce que fait le code.** La route est bien protégée (`requireAdmin2fa` +
rate limit + montant borné à 5 000 000 ZC + `withWalletMutex`), mais :

```js
// server/routes/wallet.mjs:173-176
try { await withWalletMutex(body.userId, async () => {
    const wallet = await depositToWallet(body.userId, body.amount, body.method || 'admin-credit');
```

**Impact concret.** Un double-clic, un retry de client ou un double envoi
crédite **deux fois** le compte, sans trace de l'opération dans les métadonnées
de la transaction (aucun `idempotencyKey`, aucun `adminId`). Le contrôle de
l`'idempotence des dépôts FedaPay (`claimTransaction`) ne s'applique pas ici :
c'est le seul chemin de crédit du portefeuille qui n'ait aucune clé.

**Correction proposée.** Exiger une `idempotencyKey` dans le corps (comme
`/api/wallet/withdraw`), la contrôler dans l'index `withdrawalKeys` (ou un
index dédié `adminCredits`), et l'inscrire dans les métadonnées de la
transaction avec l'`adminId` qui a crédité.

---

### A13 — FAIBLE — `settlementKeys` est plafonné à 500 : au-delà, les statistiques d'un vieux règlement peuvent être réappliquées

**Fichiers** : `server/persistence.mjs:246` (`MAX_TRACKED_SETTLEMENT_KEYS`),
`:265-275` (`applyUserSettlementOnce`).

**Ce que fait le code.**

```js
// server/persistence.mjs:269-272
const deja = Array.isArray(user.settlementKeys) ? user.settlementKeys : [];
if (deja.includes(key)) return user;
const next = updater(structuredClone(user));
next.settlementKeys = [...deja, key].slice(-MAX_TRACKED_SETTLEMENT_KEYS);   // 500
```

**Impact concret.** Passé 500 règlements, la clé du plus vieux règlement
disparaît de la liste → un rejeu de ce règlement (cron de reprise, resoumission
admin) réapplique les statistiques : `wins`/`losses`/`totalEarnings`/`elo`/
`progression` sont comptés **deux fois**. L'argent, lui, reste protégé par
`winningsKeys` (index distinct). C'est un chiffre faux sur un profil public,
pas une perte d'argent.

Le mécanisme est analogue à celui de `winningsKeys`, mais la borne n'est ni
documentée ni testée, alors que celle de `winningsKeys` l'est
(`server/winnings-key-index.test.mjs:165-175`).

**Correction proposée.** Porter les clés de règlement dans une table dédiée
(ou un compteur par type), comme `processed_transactions` pour les dépôts ;
à défaut, documenter la borne et l'exposer dans `/api/health`.

---

## 2. Ce qui est déjà couvert par des tests

### Chemins bien protégés

| Chemin | Fichier de test | Ce qui est verrouillé |
|---|---|---|
| Dépôt FedaPay : réservation atomique entre instances | `server/feda-claim-idempotence.test.mjs` | `insert` et non `upsert` ; double instance avec cache mémoire vierge |
| Dépôt FedaPay : vol d'une transaction | `server/payment-engine.test.mjs:136-191` | propriété `ZOYD:<userId>` ; collision par suffixe de téléphone refusée |
| Dépôt FedaPay : calcul 1 ZC = 10 FCFA | `server/payment-engine.test.mjs:110` | conversion et rejets |
| Idempotence des gains (hors historique de 200) | `server/winnings-key-index.test.mjs` | index `winningsKeys` persisté ; survie au redémarrage ; borne de 500 assumée |
| Idempotence des retraits (hors historique de 200) | `server/withdrawal-key-durability.test.mjs` | champ `withdrawalKeys` persisté ; libération d'une clé brûlée |
| Rejeu d'un retrait hors fenêtre | `server/withdrawal-replay-outside-window.test.mjs` | file `payoutsEnAttente` ; pas de double traitement |
| Double versement sur la branche 409 | `server/withdrawal-double-payout.test.mjs` | aucun `initiateFedaPayPayout` après un refus `PAYOUT_PENDING_REVIEW` |
| Plafond de retraits (cas simples) | `server/withdrawal-daily-cap.test.mjs` | cumul sur 24 h, fenêtre, statut `failed`, solde prioritaire sur plafond |
| Règlement en deux phases (match) | `server/settlement-recovery.test.mjs` | `payoutDistributed:'pending'` persisté ; reprise par le cron ; litige qui gèle |
| Règlement BR interrompu | `server/br-settlement-recovery.test.mjs`, `server/br-settlement-regressions.test.mjs` | `settling` persisté avant versement ; pas de re-paiement ; pas de `finished` si un versement échoue |
| Dettes de gains non versés (tournoi / ligue) | `server/settlement-recovery.test.mjs:190-320`, `server/league-settlement-recovery.test.mjs` | `pendingPayouts` écrit au règlement ; reprise ; dette retirée quand le gain aboutit |
| Commission d'arbitre non versée | `server/arbiter-fee-recovery.test.mjs`, `server/arbiter-fee-wiring.test.mjs` | créance relue, **câblage du cron vérifié** |
| Idempotence des versements (match) | `server/settlement-idempotence.test.mjs` | second versement sans effet ; gain et commission distincts ; joueurs distincts |
| Garde anti-sur-distribution du podium (ligue) | `server/league-podium-guards.test.mjs` | doublon de joueur, place partagée, joueur non qualifié, saison soldée non remboursable |
| Verrou orphelin (ligue) | `server/league-orphan-lock.test.mjs` | restitution du pass si l'écriture échoue |
| Barème BR : conservation de la masse | `server/br-engine.test.mjs:668-719` | **le total** = le pot au centime près (pas les parts individuelles → A4 non couvert) |
| Équilibre du portefeuille | `server/data-integrity.test.mjs:204-360` | `lockedBalance` = Σ `lockedEntries` ; soldes négatifs ; verrouillage > solde ; total désynchronisé |
| Arrondi des tarifs (match, tournoi, ligue) | `server/roundings-and-realtime-sanctions.test.mjs` | tarif arrondi à 2 décimales avant tout calcul de pot |
| Règlement des ligues (tarif, podium) | `server/league-settlement-recovery.test.mjs:63-108` | `NaN` refusé ; tarif figé dès le premier inscrit |
| Statistiques de commission | `server/commission-stats.test.mjs` | revenu = frais de retrait seuls ; commission d'arbitre hors revenu ; payout échoué exclu |
| Erreurs FedaPay (diagnostic) | `server/payment-payout-errors.test.mjs` | 403/401/429 message ; `payoutId` remonter ; identifiant invalide refusé avant l'appel |
| Verrous | `server/mutex.test.mjs`, `server/settlement-idempotence.test.mjs:148-200` | exclusion mutuelle par salon BR ; verrou libéré sur exception |
| Multi-instance / OCC | `server/write-window-race.test.mjs`, `server/occ-revision-invariant.test.mjs`, `server/stale-base-write.test.mjs` | écriture conditionnelle ; rejeu sur état frais |

### Chemins NON couverts (les constats ci-dessus ne sont pas détectés par la suite)

| Chemin | Ce qui manque |
|---|---|
| **Câblage de la réconciliation des retraits** (A1) | corrigé : le moteur est couvert par `server/withdrawal-refund-idempotence.test.mjs` (boucle complète avec vrai portefeuille et vrai remboursement) ; **reste sans test** : le branchement du cron lui-même — le job est toujours mocké (`server/arbiter-fee-wiring.test.mjs:55`) |
| **Double remboursement de la réconciliation** (A3) | corrigé et couvert : `server/withdrawal-refund-idempotence.test.mjs` fait échouer le tag après un remboursement réussi, puis rejoue le cycle |
| **Échec d'écriture pendant un versement** (A2) | corrigé et couvert : `server/withdrawal-refund-idempotence.test.mjs` injecte une erreur d'écriture entre l'updater et l'écriture OCC |
| **Barème BR, part par part** (A4) | seul le total est asservé (`server/br-engine.test.mjs:668`) |
| **Tournoi à 2 ou 3 participants** (A5, A6) | aucun test ne couvre un bracket de taille 2 ou 3 (`maxEntries` 2 ou 3) ni l'absence de match de 3e place |
| **Prise d'un slot d'arbitre par un non-admin** (A7) | aucun test sur `assignTournamentArbiterOnServer` ni sur `assignArbiterOnServer` côté rôle |
| **Plafond de retrait avec historique plein** (A8) | le test du plafond n'atteint jamais 200 transactions |
| **Montants réellement versés dans le match** (A9) | aucun test n'écrit ni ne relit `match.payouts` |
| **Remboursement de retrait raté** (A10) | aucun test n'injecte un échec du `depositToWallet` de remboursement |
| **Dépôt admin idempotent** (A12) | aucun test de double dépôt admin |
| **`settlementKeys` au-delà de 500** (A13) | aucun test (contrairement à `winningsKeys`) |

---

## 3. Limites de cette relecture — **NON VÉRIFIÉ**

- **État de production** : je n'ai lu ni les journaux Render, ni les données
  Supabase. L'existence d'un retrait réellement en `pending_review`, d'un
  tournoi réellement bloqué à 2 ou 3 participants, ou d'un match BR dont le
  barème a été contesté n'est ni confirmée ni infirmée.
- **Multi-instance** : les conclusions sur l'OCC et la fenêtre de déploiement
  reposent sur la lecture du code (comme `docs/audit-2/03-concurrence.md`
  §7), pas sur une exécution à deux instances.
- **Échecs d'écriture en conditions réelles** : la probabilité d'un
  `OCC_ECHEC` / d'une panne Supabase pendant un versement n'est pas mesurée ;
  A2 est déterministe **une fois** l'échec survenu, sa probabilité d'occurrence
  ne l'est pas.
- **Barème BR effectivement affiché** : je n'ai pas lu le composant front qui
  affiche la répartition d'un salon BR. Si l'interface affiche déjà le barème
  *calculé* (et non le barème *configuré*), l'écart A4 n'est visible que dans
  la lecture du code serveur.
- **`docs/05-invariants.md` et `docs/06-tests.md`** ne sont pas re-vérifiés
  ligne à ligne ; les références de ce document sont recalculées sur le code
  actuel.

## 4. Rappel des limites assumées (connues, non re-signalées)

- `winningsKeys` et `withdrawalKeys` sont plafonnés à 500 entrées
  (`server/persistence.mjs:1997`, `:1847`). C'est **documenté et testé**
  (`server/winnings-key-index.test.mjs:165-175`) : au-delà de 500 gains ou
  500 retraits, la clé la plus ancienne est oubliée. Le repli sur
  l'historique (200 entrées) ne couvre pas ce cas.
- `settlementKeys` est plafonné à 500 (voir A13, non documenté).
- Le mono-processus est imposé (`server/single-process-guard.mjs`) ; la fenêtre
  de déploiement Render (deux instances le temps du déploiement) reste ouverte
  et est déjà documentée dans `docs/audit-2/03-concurrence.md` §7.
