# Audit 2 — Étape 3 : concurrence et atomicité

**Périmètre relu intégralement** : `server/mutex.mjs`, `server/persistence.mjs`,
`server/state-helpers.mjs`, `server/cron.mjs`, `server/realtime-server.mjs`,
`server/br-engine.mjs`, `server/match-engine.mjs`, `server/tournament-engine.mjs`,
`server/league-engine.mjs`, `server/single-process-guard.mjs`,
`server/wallet-engine.mjs`, plus les routes concernées
(`routes/br.mjs`, `routes/match.mjs`, `routes/tournament.mjs`,
`routes/league.mjs`, `routes/wallet.mjs`, `routes/admin.mjs`,
`routes/social.mjs`, `routes/chat.mjs`, `routes/realtime.mjs`),
`supabase/schema.sql` et l'historique git des correctifs déjà fusionnés.

**Aucun fichier du projet n'a été modifié** par cette relecture. Seul ce
document a été créé.

**Méthode** : on a d'abord cartographié *qui prend quel verrou, et dans quel
ordre* (annexe A), puis *quels travaux de fond écrivent quelle collection*
(annexe B), puis on a reconstitué les entrelacements possibles
requête/tick contre requête/tick. Chaque affirmation a été relue dans le
contexte complet avant d'être écrite ; ce qui n'a pas pu être vérifié est
explicitement marqué **NON VÉRIFIÉ** (§ 6).

**Rappel de vocabulaire**
- *verrou global* : `withMatchMutex`, `withTournamentMutex`, `withLeagueMutex`.
- *verrou par entité* : `withBrLobbyMutex` (par salon), `withWalletMutex`
  (par joueur), `withUserMutex` (par compte), `withChannelMutex` (par canal).
- *collection d'état* : `matches`, `tournaments`, `leagues`, `brLobbies` —
  persistées dans `state_snapshots` par **remplacement intégral**
  (`replaceStateCollection`).
- *argent* : `wallets`, qui vivent **dans** `app_users.payload` (pas de table
  `wallets` séparée dans le code).

---

## 1. Synthèse

| ID | Sévérité | Objet | Emplacement principal |
|----|-----------|--------|------------------------|
| C1 | **Haute** — CORRIGÉ | BR — l'écriture de la collection sort du verrou par salon : inscription perdue, **pass gelé** | `server/routes/br.mjs:239` |
| C2 | **Haute** — CORRIGÉ | BR — le cron de reprise des règlements ne prend **aucun** verrou : il peut supprimer un salon et ses passes | `server/cron.mjs:377-405` |
| C3 | **Haute** — CORRIGÉ | Match — `disputed` + `payoutDistributed:'pending'` : repris par **aucun** cron → part de cagnotte gelée | `server/match-engine.mjs:1311-1318` |
| C4 | **Haute** — CORRIGÉ | Salons BR, tournois et ligues « en cours » : **aucun** balayage de péremption → passes gelées à jamais | `server/br-engine.mjs:1076`, `server/tournament-engine.mjs:1212`, `server/league-engine.mjs:881` |
| C5 | **Moyenne** | BR — la création de salon est hors de tout verrou : un salon peut disparaître | `server/routes/br.mjs:114-145` |
| C6 | **Moyenne** | `updatePasswordHash` écrit un `payload` capturé **avant** la lecture de la révision → perte d'écriture d'argent | `server/persistence.mjs:2340-2384` |
| C7 | **Moyenne** | `/api/health` ne compte pas les dettes de règlement des matchs : une cagnotte gelée est invisible | `server/persistence.mjs:3603-3614` |

**Répartition : 4 Haute, 3 Moyenne, 0 Faible, 0 Critique.**

> C1 est une **RÉINTÉGRESSION** : le commit `474dcfa` (« plus de double versement
> BR, ni en concurrence ni après reprise ») avait déplacé le *calcul* dans
> `withBrLobbyMutex` mais laissé l'*écriture* dehors. Le défaut décrit dans le
> message du commit (« le joueur évincé avait payé son pass et n'existait plus
> en base ») est donc toujours reproductible. **CORRIGÉ le 23/10/2026** — avec
> C2, par une protection à double étage : écriture **dans** le verrou **et**
> écriture **par entité** (voir les blocs « Correctif » sous C1 et C2).

**Note transverse (amplificateur commun à C1, C2 et C5)** —
`replaceStateCollection` remplace la collection **entière** et **supprime en
base et en mémoire** toute entité absente de la liste transmise
(`server/persistence.mjs:3516-3530`). Une écriture fondée sur un instantané
périmé ne se contente donc pas d'écraser une modification : elle **supprime**
une entité créée depuis. Pour un salon BR, cela veut dire : le salon disparaît,
les joueurs qui y ont payé leur pass n'y sont plus, et **aucun chemin de
remboursement ne les retrouve** (`leaveBrLobbyOnServer` exige d'être dans
`lobby.players` ; `cancelStaleBrLobbyOnServer` parcourt `lobby.players`).
C'est le point qui transforme une « écriture perdue » en « argent gelé ».

---

## 2. Constats

### C1 — BR : l'écriture de `brLobbies` sort du verrou par salon

**Sévérité : Haute — RÉINTÉRESSION d'un correctif existant.**

**Emplacement** : `server/routes/br.mjs:178` (prise du verrou), `:235` (fin du
callback), `:239` (écriture **en dehors**), `server/state-helpers.mjs:341-346`
(`saveBrLobbies` → `replaceStateCollection`), `server/persistence.mjs:3516-3530`
(suppression des entités absentes).

**Le verrou ne couvre que le calcul, pas l'écriture.** Extrait vérifié :

```js
// server/routes/br.mjs:177-240
const outcome = await withBrLobbyMutex(lobbyId, async () => {
  const lobbies = getStoredBrLobbies();          // 179 : snapshot relu DANS le verrou
  ...
  return { outcome: await joinBrLobbyOnServer(lobbies, actor, lobbyId) };  // 183
  ...
});                                                // 235 : verrou relâché ici
if (outcome.aborted) return true;                 // 237
const result = outcome.outcome;
await saveBrLobbies(io, result.lobbies);           // 239 : ÉCRITURE HORS VERROU
```

**Scénario de course concret** — deux inscriptions simultanées sur le même
salon `BR-X` :

1. `T0` — Joueur A : `POST /api/br/lobbies/BR-X/join`. Prend
   `withBrLobbyMutex(BR-X)`, lit la collection `L0` (BR-X sans A).
2. `T1` — Joueur B : `POST /api/br/lobbies/BR-X/join`. Le verrou est pris, la
   lecture rend `L0` : B ne voit pas encore A.
3. `T2` — A : `joinBrLobbyOnServer` appelle `lockEntryFee(A, entryFee, BR-X)`
   (`server/br-engine.mjs:425-427`) : **le pass de A est débité et bloqué dans
   `wallet.lockedEntries[BR-X]`**. Puis A relâche le verrou.
4. `T3` — B : `lockEntryFee(B, …)` : **le pass de B est bloqué**. B relâche le
   verrou.
5. `T4` — A : `saveBrLobbies(io, L0+A)` → la mémoire et la base contiennent
   BR-X avec A.
6. `T5` — B : `saveBrLobbies(io, L0+B)` → **écrasement** : BR-X ne contient plus
   A. La ligne `state_snapshots` de BR-X est réécrite sans A, et A est
   **supprimé** de `lobby.players`.

**Perte** : le pass de A est bloqué (`lockedEntries[BR-X]`, `lockedBalance`
majoré) mais A n'est plus dans le salon. `leaveBrLobbyOnServer` lève
`NOT_JOINED` (`server/br-engine.mjs:477`) ; `cancelStaleBrLobbyOnServer` ne
parcourt que `lobby.players` (`server/br-engine.mjs:1111`) ; le règlement ne
le versera pas non plus. **L'argent de A est gelé sans issue.** Même mécanisme
sur `checkin` (présence perdue), `start` (lancement perdu), `eliminate`
(élimination perdue → classement et répartition de la cagnotte faussés).

**Preuve** :
- `git show 474dcfa -- server/routes/br.mjs` : le correctif déplace le bloc
  `if/else` dans `withBrLobbyMutex`, mais la ligne `await saveBrLobbies(io,
  outcome.lobbies);` reste **après** la fermeture du callback. Le verrou a été
  posé sur le calcul, pas sur le cycle lire-calculer-écrire.
- `server/routes/br.mjs:13-16` (en-tête) et `server/mutex.mjs:104-117`
  affirment l'inverse : « le snapshot est RELU DANS le verrou […] les deux
  versaient la cagnotte deux fois ». La relecture est bien faite ; l'écriture,
  non.
- Contraste : les routes match / tournoi / ligue font l'inverse et sont
  correctes — `saveMatches` / `saveTournaments` / `saveLeagues` sont **à
  l'intérieur** du verrou global (`server/routes/match.mjs:116`, `:145`,
> `server/routes/tournament.mjs:131`, `server/routes/league.mjs:157`).

**Correction** : déplacer l'écriture **dans** le callback du verrou, et y
inclure le `saveBrLobbies` final de l'action `finish` (les écritures
intermédiaires `onProgress` y sont déjà, `server/routes/br.mjs:220`) :

```js
const outcome = await withBrLobbyMutex(lobbyId, async () => {
  const lobbies = getStoredBrLobbies();
  const result = /* ... action ... */;
  await saveBrLobbies(io, result.lobbies);   // DANS le verrou
  return result;
});
```

Un test de non-régression doit forcer deux `join` concurrents sur le même
salon et vérifier que les deux joueurs figurent dans la collection persistée
et que leurs deux passes sont bloqués.

**Correctif (23/10/2026)** — en deux étages, enchâssés :

1. *Écriture dans le verrou* (`server/routes/br.mjs`) : le callback du
   `withBrLobbyMutex(lobbyId)` englobe désormais le cycle complet —
   lecture (`getStoredBrLobbies`) → moteur → `await saveBrLobbies(io,
   result.lobbies)` — pour **les six** actions (join, leave, checkin, start,
   eliminate, finish). La lecture, dont l'objet est restreint au **seul salon
   cible**, fait que le clone du moteur, la progression `onProgress` et le diff
   d'écriture ne portent sur aucune autre entité (voir C2). La réponse HTTP et
   le `catch` restent hors verrou ; pour `finish`, la notification aux gagnants
   est envoyée dans le callback, après l'écriture (l'argent est versé, la
   notification ne doit pas prolonger le verrou).
2. *Écriture par entité* (`server/state-helpers.mjs` : `saveBrLobbies`) :
   abandon du remplacement en bloc. La fonction parcourt la liste qu'on lui
   passe, compare chaque entité à l'état stocké **sur l'état normalisé des deux
   côtés** (une ancienne forme au stockage, ou une coercition de type, ne
   déclenchent pas d'écriture), puis appelle `upsertStateEntity` pour les
   seules entités modifiées. Une entité absente de la liste n'est **jamais**
   supprimée ; un salon inchangé ne repart pas en base. La diffusion socket ne
   part que si `io` est fourni (côté cron : aucun io). Ce point neutralise
   l'amplificateur commun (note transverse) pour **toutes** les écritures BR
   d'un coup.
3. *Fail-closed* (`server/persistence.mjs` : `upsertStateEntity`) : si
   l'écriture en base échoue, l'entité est retirée de la mémoire (rollback) et
   l'erreur remonte — avaler l'échec renvoyait un état mémoire qui ment.

**Tests** : `server/br-write-inside-lock.test.mjs` — ordre verrou → moteur →
save → unlock pour `join` et `finish` (progression intermédiaire `onProgress`
comprise) ; `server/br-save-per-entity.test.mjs` — delta par entité, jamais
de suppression, anciennes formes de stockage sans réécriture, diffusion
sanitisée. La course de l'audit (deux `join` simultanés) est désormais
couverte par l'ordre du cycle : la seconde écriture part avec la lecture faite
*dans* le verrou, après le premier joueur.

---

### C2 — BR : le cron de reprise des règlements ne prend aucun verrou

**Sévérité : Haute.**

**Emplacement** : `server/cron.mjs:377-405` (`sweepPendingBrSettlements`),
`:389` et `:392` (`replaceStateCollection('brLobbies', …)`) ; comparaison
`server/cron.mjs:419-467` (`sweepStaleBrLobbies`, qui prend **lui** le verrou
par salon) ; invariant contraire dans l'en-tête du fichier
`server/cron.mjs:8-11` (« chaque job prend le MEME verrou que la route
correspondante »).

**Le job ne prend ni `withBrLobbyMutex` ni aucun verrou global.** Il lit la
collection, règle les salons `settling`, et réécrit **toute** la collection.

**Scénario de course concret** — tick du cron et action de salon :

1. `T0` — tick du cron (toutes les 5 min, `server/cron.mjs:406`) : lit
   `getStateCollection('brLobbies')` → instantané `L0` (salons A, B).
2. `T0+1s` — `POST /api/br/lobbies/B/checkin` : le joueur B pointe. La route
   écrit `L1 = L0 + B(present)`.
3. `T0+2s` — le cron termine le règlement du salon A. Il écrit
   `replaceStateCollection('brLobbies', L0 + A(regle))` : **B n'y est plus**.
   La présence de B est perdue (l'UI affiche « présent », l'état ne le sait
   plus) et, si le salon B avait été créé après `T0`, il est **supprimé** de
   la base *et* de la mémoire (`server/persistence.mjs:3516-3530`).
4. Conséquence si B a été supprimé : les joueurs de B ont payé leur pass,
   `lockedEntries[B]` existe dans leur portefeuille, mais plus aucun salon ne
   les référence → **passes gelés sans chemin de sortie** (cf. la note
   transverse).

**Variante dans la même famille** — `sweepStaleBrLobbies`
(`server/cron.mjs:434-442`) prend bien `withBrLobbyMutex(lobbyId)`, mais y
écrit **toute** la collection (`replaceStateCollection('brLobbies',
res.lobbies)`). Un verrou **par entité** ne protège pas une écriture **de
collection** : le traitement du salon A peut donc écraser une action
concurrente sur le salon B.

**Preuve** :
- `server/cron.mjs:377-405` : aucun `with*Mutex` dans le corps du job (le
  fichier n'importe `withBrLobbyMutex` que pour `sweepStaleBrLobbies`,
  `server/cron.mjs:50`).
- `server/cron.mjs:389` : `onProgress: (progress) => replaceStateCollection(
  'brLobbies', progress)` — écriture de collection, sans verrou.
- Le règlement BR lui-même est bien protégé (statut `settling` persisté
  avant les versements, `player.settled` persisté après chaque versement :
  `server/br-engine.mjs:784-786`, `:862`, `:868`) : **le double versement n'est
  pas le risque ici ; l'écriture de collection qui écrase une action concurrente
  l'est.**

**Correction** — deux options, la seconde est la plus solide :
1. *Minimale* : donner au job un verrou de collection
   (`withBrLobbyCollectionMutex`) et prendre le `withBrLobbyMutex(lobbyId)`
   **à l'intérieur**, dans l'ordre collection → salon → portefeuille ; relire la
   collection dans le verrou (comme le fait déjà `sweepStaleBrLobbies` à
   `server/cron.mjs:435-436`).
2. *Structurelle* : écrire les salons BR **entité par entité** avec
   `upsertStateEntity` (`server/persistence.mjs:3623`), qui n'écrase pas les
   autres lignes de la collection. C'est la seule voie qui rend le verrou
   par salon suffisant, et c'est cohérent avec l'invariant
   « la collection est remplacée EN BLOC » *à condition* de ne plus l'appliquer
   à `brLobbies`.

**Correctif (23/10/2026)** — l'option 2 (structurelle) est appliquée ; elle
passe main dans la main avec C1 (même fonction d'écriture) :

1. `server/cron.mjs` — `sweepPendingBrSettlements` est réécrite **salon par
   salon** : pour chaque salon `settling`, `withBrLobbyMutex(lobbyId)` ; à
   l'intérieur du verrou, la collection est **relue** (`getStateCollection`) —
   un salon soldé par la route entre la collecte des identifiants et le verrou
   n'est plus repris —, le remboursement/règlement est confié au moteur avec
   la **liste restreinte au seul salon** (`retryPendingBrSettlements([cible])`,
   l'acteur étant l'arbitre du salon), et les écritures (progression
   `onProgress` + résultat) passent par `saveBrLobbies` **dans le verrou**.
   Un échec sur un salon n'empêche plus le suivant (isolation par salon,
   comme pour les matchs en V6).
2. `server/cron.mjs` — `sweepStaleBrLobbies` : verrou par salon déjà présent,
   écriture `replaceStateCollection('brLobbies', …)` remplacée par
   `saveBrLobbies(null, res.lobbies)` — l'annulation du salon A ne peut plus
   écraser une action concurrente sur le salon B. La liste transmise au moteur
   est restreinte au salon relu dans le verrou, et un salon qui vient d'être
   traité entre-temps est sauté sans arrêt du balayage (isolation par salon,
   comme pour les matchs en V6) ; un échec sur un salon ne bloque plus les
   suivants.
3. Les deux jobs sont **exposés** (`export const`) pour le test de câblage,
   qui verrouille : l'ordre verrou → moteur → save → unlock, la relecture dans
   le verrou (salon soldé entre-temps : aucune reprise, aucune écriture), la
   liste restreinte au salon traité, l'épargne des autres salons, et la garde
   anti-chevauchement (second tick sauté).

**Tests** : `server/br-write-inside-lock.test.mjs` (cron ET routes ;
aucune écriture BR ne passe par `replaceStateCollection`) et
`server/br-save-per-entity.test.mjs` (l'écriture ne porte que le delta,
aucune suppression). La suite complète reste verte (23/10/2026 : 930 tests
passés / 2 ignorés, 0 échec).

---

### C3 — Match `disputed` avec `payoutDistributed:'pending'` : repris par aucun cron

**Sévérité : Haute.**

**Emplacement** : `server/match-engine.mjs:1311-1318` (résolution de litige,
action `settle`), `:1005` (pose de `confirmationDeadline`),
`server/cron.mjs:338` (filtre de la reprise des règlements),
`server/cron.mjs:480-484` (filtre de l'expiration des confirmations),
`server/match-engine.mjs:1452` (l'automatisation ignore `disputed`),
`server/match-engine.mjs:98-104` (conditions du balayage d'arbitrage).

**Le couple de filtres est disjoint.** Les deux jobs de reprise des matchs
sélectionnent :

| Job | Filtre | Emplacement |
|---|---|---|
| `sweepPendingSettlements` | `payoutDistributed === 'pending'` **ET** `!confirmationDeadline` | `server/cron.mjs:338` |
| `sweepExpiredConfirmations` | `status === 'awaiting_confirmation'` **ET** deadline dépassée | `server/cron.mjs:480-484` |

Un match qui cumule `payoutDistributed === 'pending'` **et**
`confirmationDeadline` renseigné **et** `status !== 'awaiting_confirmation'`
n'entre dans **aucun** des deux.

**Scénario de course concret** — c'est le scénario nominal, pas une course :

1. `T0` — l'arbitre soumet le résultat (`deferSettlement: true`,
   `server/routes/match.mjs:305-314`) : `status = 'awaiting_confirmation'`,
   `confirmationDeadline = T0 + 30 min` (`server/match-engine.mjs:1004-1005`),
   `payoutDistributed = 'pending'`.
2. `T0+1 min` — le perdant ouvre un litige : `status = 'disputed'`
   (`server/match-engine.mjs:1256`). **`confirmationDeadline` n'est pas effacé**,
   `payoutDistributed` reste `'pending'`.
3. `T0+10 min` — l'admin tranche : `POST /api/admin/matches/:id/resolve-dispute`
   avec `action: 'settle'` → `resolveDisputeOnServer`
   (`server/routes/admin.mjs:649`). Le règlement est **partiellement** en échec
   (Supabase saturée, un joueur supprimé) → `settlementResult.success === false`
   → `match.result.payoutDistributed = 'pending'` (`:1313`),
   `match.status = 'disputed'` (`:1314`), et **`confirmationDeadline` n'est
   effacé que dans la branche succès** (`:1315-1318`).
4. **État final** : `status='disputed'`, `payoutDistributed='pending'`,
   `confirmationDeadline` renseignée.
   - `sweepPendingSettlements` : `pending` ✓ mais `confirmationDeadline`
     présente ✗ → **exclu**.
   - `sweepExpiredConfirmations` : `status !== 'awaiting_confirmation'` ✗ →
     **exclu**.
   - `processMatchAutomationOnServer` : `status === 'disputed'` → `continue`
     (`server/match-engine.mjs:1452`) → **exclu**.
   - `sweepMatchesWithoutArbiter` : le litige est résolu (donc pas « ouvert »),
     `payoutDistributed !== true` → il passe les deux premiers gardes ; mais le
     match est **lancé** et **a un résultat** → `rattard === false`
     (`server/match-engine.mjs:98-104`) → **exclu**.

**Perte** : la part du joueur non payé reste dans `lockedEntries[matchId]`
pour toujours. Le match affiche « litige » alors qu'il n'y a plus de litige
ouvert (`resolveOpenDisputes` les a tous marqués `resolved`,
`server/match-engine.mjs:551-556`) : **personne ne sait qu'il faut agir**, et
aucun compteur de santé ne le signale (voir C7).

**Preuve** : les quatre filtres ci-dessus sont lus dans leur contexte complet
(cron.mjs:320-360 et :469-513, match-engine.mjs:77-128 et :1445-1511). Le
chemin `confirmMatchResultOnServer` (`:1119-1125`) n'a pas ce défaut : en cas
d'échec partiel il laisse `status = 'awaiting_confirmation'` et la deadline
déjà passée → il **est** repris par `sweepExpiredConfirmations`. C'est
l'incohérence entre les deux chemins qui est en cause.

**Correction** :
- dans `resolveDisputeOnServer`, effacer `confirmationDeadline` quand le
  règlement est incomplet (comme le fait `confirmMatchResultOnServer` quand
  le règlement réussit), **et** remettre `status = 'awaiting_confirmation'`
  plutôt que `'disputed'` si `!settlementResult.success` — le match n'a plus de
  litige ouvert, il a une dette ;
- et, en défense, élargir le filtre de `sweepPendingSettlements` à
  `payoutDistributed === 'pending' && (!confirmationDeadline || status ===
  'disputed')`.

**Correctif (23/10/2026)** — appliqué tel que recommandé, en trois couches :

1. `resolveDisputeOnServer` (`server/match-engine.mjs`) : en échec de
   règlement, `status = 'awaiting_confirmation'` **et**
   `confirmationDeadline = null`. Le match n'a plus de contestation à
   trancher : deadline nulle le place immédiatement dans le radar de
   `sweepPendingSettlements` (tick 60 s).
2. `settlePendingMatchResult` : la clôture des règlements payés couvre
   maintenant les deux statuts de dette — `disputed` **et**
   `awaiting_confirmation` — et remet `confirmationDeadline` à null sur le
   succès. En filigrane : un règlement réussi par la reprise laissait avant
   ce correctif un match `awaiting_confirmation` alors que les gains étaient
   versés — état trompeur que la même clôture corrige au passage.
3. `sweepPendingSettlements` (exportée top-level, comme les deux jobs BR, pour
   le test de câblage `server/match-recovery-wiring.test.mjs`) : le filtre
   vise deux vagues — `'pending'` sans deadline **et** sans litige ouvert, OU
   `'pending'` + `disputed` à litige clos. La garde litige ouvert est doublée
   par celle du moteur (`settlePendingMatchResult` refuse un litige ouvert) ;
   un match contesté en cours ne peut donc jamais être payé derrière le dos
   de son perdant.
   Tests : `server/dispute-settlement-recovery.test.mjs` (échec partiel →
   radar de reprise, reprise → match fini entièrement payé, voie nominale
   inchangée, litige ouvert toujours gelé) et
   `server/match-recovery-wiring.test.mjs` (choix des cibles, écriture avec
   le résultat du moteur, échec isolé, garde anti-chevauchement, fenêtres
   expirées). Suite complète : 951 pass / 2 skip.

---

### C4 — Salons BR, tournois et ligues « en cours » : aucun balayage de péremption

**Sévérité : Haute.**

**Emplacement** :

| Collection | Balayage existant | États couverts | État non couvert |
|---|---|---|---|
| `brLobbies` | `getStaleBrLobbyIds` — `server/br-engine.mjs:1076-1085`, appelé par `sweepStaleBrLobbies` (`server/cron.mjs:419`) | `scheduled` | **`live`** |
| `tournaments` | `getExpiredTournamentIds` — `server/tournament-engine.mjs:1212-1217`, appelé par le sweep de 6 h (`server/cron.mjs:281`) | `recruiting` | **`live`** |
| `leagues` | `getStaleLeagueSeasonIds` — `server/league-engine.mjs:881-893`, appelé par `sweepStaleLeagues` (`server/cron.mjs:672`) | `registering` | **`qualifying`** |

**Scénario concret** — salon BR :
1. `T0` — l'arbitre lance la partie : `status = 'live'`
   (`server/br-engine.mjs:580`), `startedAt` renseigné. Les passes des
   participants sont bloqués, `pot` valorisé.
2. `T0+…` — l'arbitre disparaît (déconnexion, absence, abandon). Personne
   n'appelle `finish`.
3. `getStaleBrLobbyIds` ne retient que `status === 'scheduled'` → le salon
   `live` n'est jamais repris. `cancelStaleBrLobbyOnServer` refuse d'ailleurs
   tout salon qui n'est pas `scheduled` (`server/br-engine.mjs:1105`).
4. `sweepPendingBrSettlements` ne vise que `status === 'settling'`
   (`server/br-engine.mjs:1016`). **Aucun cron ne vise `live`.**

**Perte** : la cagnotte reste séquestrée dans les `lockedEntries` des joueurs
indéfiniment, le salon n'est ni `live` ni `regle` ni `annule`, et le
`/api/health` ne le signale pas. Même situation pour un **tournoi `live`** dont
l'arbitre disparaît (les `entryFee × teamSize` restent dans `lockedEntries`) et
pour une **saison de ligue `qualifying`** qui n'aboutit jamais.

**Preuve** : les trois fonctions de balayage lues en entier ; aucune autre
n'existe dans `server/cron.mjs` (16 jobs, tous énumérés en annexe B). Le
projet dispose pourtant de l'équivalent exact pour les matchs 1v1-5v5 :
`sweepMatchesWithoutArbiter` (`server/match-engine.mjs:77-128`), branché sur le
tick de 30 s et **rembourse** les matchs sans arbitre. L'asymétrie est donc
délibérée pour les matchs et inexistante pour BR / tournoi / ligue.

**Correction** : ajouter un balayage « en cours sans issue » pour les trois
collections, sur le modèle de `sweepMatchesWithoutArbiter` :
- BR : `status === 'live' && now - startedAt > BR_ARBITER_DEADLINE_MS` →
  annuler et rembourser (`cancelStaleBrLobbyOnServer` doit alors accepter
  `live`) ;
- tournoi : `status === 'live' && now - startsAt > grâce` → annulation +
  `pendingRefunds` (leRefund existe déjà : `retryPendingTournamentRefunds`) ;
- ligue : `status === 'qualifying' && now - qualifyingStarts > grâce` → idem.

**Correctif (23/10/2026)** — appliqué **sans créer un seul nouveau job** : les
trois balayages existants sont élargis aux états manquants, dans le même
verrou et avec la même discipline « remboursement d'abord, clôture ensuite ».

| Collection | Balayage élargi | Nouvelle cible | Grâce | Annulation |
|---|---|---|---|---|
| `brLobbies` | `getStaleBrLobbyIds` (`server/br-engine.mjs`) | `status === 'live' && startedAt` dépassée | `BR_STALE_LOBBY_GRACE_MS` (2 h, la même que la phase B des matchs 1v1-5v5) | `cancelStaleBrLobbyOnServer` accepte `scheduled` et `live`, motif `ARBITER_TIMEOUT` (mêmes mots que le balayage d'arbitrage) |
| `tournaments` | `getExpiredTournamentIds` (`server/tournament-engine.mjs`) | `status === 'live' && startsAt` dépassée | 24 h (la même que `recruiting`) | `cancelStaleTournamentOnServer` accepte `recruiting` et `live` |
| `leagues` | `getStaleLeagueSeasonIds` (`server/league-engine.mjs`) | `status === 'qualifying' && schedule.qualifyingStarts` dépassée | `LEAGUE_QUALIFYING_STALE_GRACE_MS` (7 jours, une qualification normale tient sa journée par jour) | `cancelStaleLeagueSeasonOnServer` accepte `registering` et `qualifying` |

Trois points de sécurité qui ont guidé les choix :

1. **Tournoi `live` : versé nul part avant la fin.** Les gains ne partent
   qu'en `completed` (`applyTournamentSettlement` refuse tout autre statut) :
   annuler un `live` n'a donc jamais de double paiement possible — les
   `entryFee × teamSize` sont intégralement séquestrés.
2. **Le cron passe un motif honnête.** Le sweep tournoi/ligue choisit le
   texte d'annulation selon l'état réel du tournoi / de la saison (« pas
   assez d'inscriptions » ≠ « lancé puis jamais terminé ») ; le salon BR
   signe lui-même son motif dans `cancelStaleBrLobbyOnServer`.
3. **Refus d'annulation pour les états en cours de traitement.** Un salon BR
   en `settling` n'est pas péremptible : il appartient au job de reprise des
   règlements (le confondre couperait la reprise en deux). De même, un
   tournoi ou une saison close (`completed`, `final`) n'est jamais annulable
   par ce chemin.

Tests : `server/br-stale-lobby.test.mjs` (live récent épargné, live sans
`startedAt` épargné, live abandonné repris et remboursé, échec non-clôture),
`server/tournament-engine.test.mjs` (getter live/grâce/clos, annulation live
rembourse tout, tournoi terminé refusé), `server/league-engine.test.mjs`
(qualification ancienne oui / récente non / sans horloge non, annulation
qualifying rembourse les inscrits), plus le harnais cron existant
(`br-write-inside-lock.test.mjs`) qui continue de couvrir le câblage BR.

---

### C5 — BR : la création de salon est hors de tout verrou

**Sévérité : Moyenne.**

**Emplacement** : `server/routes/br.mjs:114-145` — `createBrLobbyOnServer(
getStoredBrLobbies(), …)` (`:123`) puis `await saveBrLobbies(io,
created.lobbies)` (`:134`), **sans aucun verrou** (ni global, ni par salon).

**Scénario de course concret** — deux créations simultanées :
1. `T0` — Admin 1 : `POST /api/br/lobbies` → lit `L0` → crée `BR-1`.
2. `T0+ε` — Admin 2 : `POST /api/br/lobbies` → lit `L0` (BR-1 pas encore
   écrit) → crée `BR-2`.
3. `T1` — Admin 1 écrit `L0+BR-1` → 201 avec `BR-1`.
4. `T2` — Admin 2 écrit `L0+BR-2` → **BR-1 disparaît** de la base et de la
   mémoire. L'admin a reçu un 201 pour un salon inexistant ; les joueurs ne
   peuvent pas le rejoindre (`LOBBY_NOT_FOUND`).

Le même mécanisme, croisé avec C2, est plus grave : un salon créé **et**
peuplé entre le snapshot du cron et son écriture peut être **supprimé** par le
cron, avec les passes des joueurs.

**Preuve** : `server/routes/br.mjs:114-145` — aucune acquisition de verrou
dans le bloc ; le fichier n'importe que `withBrLobbyMutex`
(`server/routes/br.mjs:49`), utilisé uniquement par les actions de salon
(`:178`). La création n'a pas d'équivalent : elle modifie pourtant la même
collection.

**Correction** : prendre le même verrou de collection que C2 (ou un
`withBrLobbyCollectionMutex`) autour du couple lecture/écriture de la
création, et le poser **avant** le `withBrLobbyMutex` des actions (ordre
collection → salon).

---

### C6 — `updatePasswordHash` écrit un `payload` capturé avant la lecture de la révision

**Sévérité : Moyenne.**

**Emplacement** : `server/persistence.mjs:2340-2341` (lecture du payload
mémoire, **sans** `withUserMutex`), `:2364-2384` (écriture de `payload: user`),
comparaison avec le chemin correct `server/persistence.mjs:1665-1701`.

**Le chemin du mot de passe n'a pas été aligné sur le chemin du portefeuille.**
`updateUserAccount` relit le payload **et** la révision au même instant, puis
adopte le payload le plus récent avant de calculer
(`server/persistence.mjs:1685-1701`) : c'est ce qui ferme la fenêtre de
**péremption** (et pas seulement de chevauchement). `updatePasswordHash` n'a
rien de tout cela :

```js
// server/persistence.mjs:2340-2341 — AUCUN withUserMutex
export const updatePasswordHash = async (userId, newHash) => {
  const user = memoryUsers.get(userId);   // 2341 : PAYLOAD CAPTURÉ ICI
  ...
  await ecrireUserRow(userId, {
    ...
    payload: user,                          // 2371 : on réécrit ce payload périmé
    ...
  }, (frais) => ({ ... payload: frais ... }));  // 2374 : le rejeu ne s'applique qu'EN CAS DE CONFLIT
```

**Scénario de course concret** — un gain et un changement de mot de passe au
même instant :
1. `T0` — Le joueur A est payé (règlement d'un match) : `updateUserAccount`
   → `withUserMutex(A)` → lit la révision `R` → calcule `next` (portefeuille +
   500) → `memoryUsers.set(A, next)` → écriture conditionnelle sur `R` →
   **OK, révision `R+1`**.
2. `T0+ε` — Dans un autre onglet, le joueur A change de mot de passe :
   `POST /api/auth/change-password` → `updatePasswordHash`
   (`server/routes/auth.mjs:576`) → capture `user = memoryUsers.get(A)`.
   Si cette capture a lieu **avant** le `memoryUsers.set` de l'étape 1, `user`
   désigne l'**ancien** payload (sans le gain).
3. `T1` — `ecrireUserRow` relit la révision : elle vaut `R+1` (l'écriture de
   l'étape 1 est passée). La condition `revision = R+1` est **vraie** → pas de
   conflit → **pas de rejeu**.
4. `T2` — l'écriture pose `payload: user`, c'est-à-dire l'ancien payload :
   **le gain de 500 ZC est effacé de la base.** Aucun conflit n'a été détecté,
   donc le `recalculer` (qui n'applique que l'intention « nouveau mot de
   passe ») n'est jamais appelé.

**Perte** : une écriture d'argent disparaît, silencieusement, sans trace :
`verifyDataIntegrity` compare `lockedBalance` à la somme des réservations, pas
le solde au journal (`server/persistence.mjs:1136-1148`) — un gain perdu ne
donc pas remonter.

**Preuve** : les deux chemins (`updateUserAccount` :1665-1780 et
`updatePasswordHash` :2340-2398) lus en entier ; `withUserMutex` est importé et
utilisé dans le premier, absent du second. La fenêtre est étroite (il faut
que le joueur change son mot de passe pendant qu'un match lui est versé), mais
le mode de défaillance est le pire : perte d'argent sans contradiction.

**Correction** : faire passer `updatePasswordHash` par le même point
d'entrée que le portefeuille, c'est-à-dire `updateUserAccount` (qui écrit
déjà la colonne `password_hash` depuis `memoryPasswordHashes`,
`server/persistence.mjs:1727` et `:1748`) : mettre à jour le hash en mémoire,
puis appeler `updateUserAccount(userId, (u) => u)`. Le garde d'unicité
actuelle, l'adoption du payload frais et la revalidation de l'intention
(profil/email) restent alors garantis.

---

### C7 — `/api/health` ne voit pas les dettes de règlement des matchs

**Sévérité : Moyenne.**

**Emplacement** : `server/persistence.mjs:3603-3614` (`splitPendingDebts`),
`:1120-1124` (`pendingSettlementDebts` dans `getHealthInfo`).

**Le compteur est structurellement aveugle aux matchs.** `splitPendingDebts`
compte `item.pendingPayouts` et `item.pendingRefunds` — deux champs qui
n'existent que sur les **ligues** et les **tournois**
(`server/league-engine.mjs:189`, `server/tournament-engine.mjs:167`). Les
matchs portent une dette dans un champ **différent** :
`match.result.payoutDistributed === 'pending'`
(`server/match-engine.mjs:22-24`).

**Conséquence** : `pendingSettlementDebts.matches` vaut
`{ retryable: 0, uncollectable: 0, total: 0 }` **en permanence**, y compris
quand un match est dans l'état gelé de C3. Le champ est donc lu comme une
dette inexistante — exactement le défaut que ce compteur a été créé pour
combattre (`server/persistence.mjs:1110-1119`).

**Preuve** : `splitPendingDebts` est le seul alimentateur de
`pendingSettlementDebts.matches` (`:1121`) ; aucune autre lecture de
`result.payoutDistributed` n'existe dans `persistence.mjs` (le grep complet ne
trouve que `league-engine`, `tournament-engine` et `match-engine`).

**Correction** : ajouter un cas `'matches'` dans `splitPendingDebts` (ou une
fonction dédiée) comptant `item.result?.payoutDistributed === 'pending'`, et
exposer le détail (matchs concernés) dans `/api/health` et dans les métriques.

---

## 3. Points de conception solides — à documenter

Un futur lecteur doit savoir ce qui **est** protégé. Ces points ont été
vérifiés, pas supposés.

### B1 — Le garde mono-processus est réel et branché avant tout chargement

`assertSingleProcess()` (`server/single-process-guard.mjs:136-165`) est appelé
**avant** `loadFromSupabaseWithRetry` (`server/realtime-server.mjs:639-641`) :
refuser de démarrer après avoir chargé laisserait des mutations en cours sur un
état que l'on ne pilote pas. Le refus ne porte que sur les cas **certains**
(cluster actif, `WEB_CONCURRENCY > 1`) ; une valeur illisible est signalée
sans bloquer (`server/single-process-guard.mjs:153-163`). **Limite connue et
assumée** : deux démarrages indépendants sans `WEB_CONCURRENCY` ni `cluster`
ne sont pas détectés (`server/single-process-guard.mjs:19-22`).

### B2 — L'OCC ferme la fenêtre de **péremption**, pas seulement celle de chevauchement

`updateUserAccount` relit le payload **et** la révision au **même instant**
(`server/persistence.mjs:1688`), compare l'empreinte du payload en base à
celle de la mémoire, adopte le payload le plus récent s'il a bougé
(`:1695-1700`), puis écrit sous la condition `revision = revisionObservee`
(`:1764` → `:571-585`). Base de calcul et condition désignent donc le même
instant : il n'y a pas de fenêtre entre les deux. En cas de conflit, le
calcul est **rejoué** sur l'état frais (`:1751-1763`), jamais le vieux patch.
C'est le point le plus solide du projet, et il est couvert par
`server/write-window-race.test.mjs` et `server/stale-base-write.test.mjs`.

### B3 — Un seul point d'entrée sur `app_users`

`ecrireUserRow` (`server/persistence.mjs:604-649`) est le seul chemin
d'écriture, et c'est **lui** qui fait avancer `revision`. Le test
`server/occ-revision-invariant.test.mjs:29` vérifie l'absence de tout
`sbUpsert('app_users', …)` hors de ce point. La seule autre écriture de la
table est un `DELETE` (`server/persistence.mjs:2714`), qui ne peut pas
provoquer de resurrection : une écriture conditionnelle sur une ligne disparue
renvoie 0 ligne modifiée → conflit → relecture → refus (`server/persistence.mjs:616-628`).

### B4 — L'argent n'est pas dans une table à part : il hérite de la protection OCC

Le portefeuille vit dans `app_users.payload` (normalisé par
`normalizeWalletSnapshot`, `server/persistence.mjs:200-229`). Il n'existe
donc **aucune** table `wallets` à protéger séparément dans le code : toute
écriture de solde passe par `updateUserAccount` → `withUserMutex` → OCC. La
table `wallet_transactions` existe dans `supabase/schema.sql` mais **n'est
écrite par aucun code** (grep complet) : c'est une table morte, à ne pas
confondre avec la source de vérité.

### B5 — `withUserMutex` est le vrai point de sérialisation d'un compte

`updateUserAccount` prend `withUserMutex(userId)`
(`server/persistence.mjs:1666`) ; `updateWalletSnapshot` passe par lui
(`:1790`). `withWalletMutex` est un verrou **exérieur**, utile pour
sérialiser un enchaînement debit→paiement. Conséquence utile : les crons qui
appellent `updateWalletSnapshot` **sans** `withWalletMutex` (réconciliation des
retraits, `server/cron.mjs:633-647`) restent sûrs, puisque l'écriture
effective est sérialisée par `withUserMutex` + OCC.

### B6 — L'ordre d'acquisition des verrous est homogeneous : aucun interblocage

Ordre constant sur **tous** les chemins vérifiés :

```
verrou global / par entité  →  withWalletMutex  →  withUserMutex
```

- `withMatchMutex` → `withWalletMutex` : `server/routes/match.mjs:113`,
  `:142` ; `server/match-engine.mjs:425`, `:498`, `:1619`.
- `withTournamentMutex` → `withWalletMutex` : `server/routes/tournament.mjs:100`
  ; `server/tournament-engine.mjs:665`, `:718`.
- `withLeagueMutex` → `withWalletMutex` : `server/routes/league.mjs:172`,
  `:188` ; `server/league-engine.mjs:717`, `:1148`.
- `withBrLobbyMutex` → `withWalletMutex` : `server/br-engine.mjs:425`, `:853`.
- `withWalletMutex` → `withUserMutex` : `server/persistence.mjs:1666`,
  `:1790`.

**Aucun chemin ne prend un verrou par entité puis un global** (donc pas
d'inversion), **aucun chemin ne prend deux verrous globaux**, **aucun chemin
n'imbrique deux `withWalletMutex`** (les boucles de versement les prennent
séquentiellement). Le seul écart est C2 : le job BR ne prend **rien** — ce
n'est pas un interblocage, c'est l'absence de protection.

### B7 — Tous les intervalles ont une garde anti-chevauchement, et les déclencheurs de démarrage partagent la même garde

Les 16 jobs de `server/cron.mjs` plus le tick d'automatisation
(`server/realtime-server.mjs:681-712`) possèdent chacun un drapeau
`xxxRunning` (`matchCleanupRunning`, `pendingSettlementRunning`,
`brSettlementRetryRunning`, `staleBrLobbyRunning`, `confirmationSweepRunning`,
`arbiterFeeRetryRunning`, `refundRetryRunning`, `payoutRetryRunning`,
`leaguePayoutRetryRunning`, `leagueRefundRetryRunning`, `staleLeagueRunning`,
`withdrawalReconcileRunning`, `tournamentSweepRunning`, `leagueCloseRunning`,
`integrityRunning`, `matchAutomationRunning`). Les `setTimeout` de démarrage
utilisent **la même** garde que leur intervalle (ex. `server/cron.mjs:357-359`),
donc un tick de boot ne peut pas chevaucher le premier tick d'intervalle.
Limite assumée : ces gardes empêchent **cron contre cron**, pas **cron contre
route** — c'est exactement la faille de C2.

### B8 — L'écriture d'état est *fail closed* avec retour arrière mémoire

`replaceStateCollection` refuse d'écrire si un rechargement est en cours
(`server/persistence.mjs:3480-3482`) ou si l'état n'est pas fiable
(`:3486-3491` — sinon un batch incomplet supprimerait en base tout ce qui
manque). En cas d'échec d'écriture en base, la mémoire est **restaurée** et
l'appelant reçoit `SERVER_BUSY` (`:3497-3507`, `:3549-3556`). Le client peut
donc réessayer, et la divergence mémoire/base ne devient pas invisible.

### B9 — L'idempotence des dépôts est atomique **entre instances**

`claimTransaction` utilise un `INSERT` (et non un `upsert`) sur
`processed_transactions`, dont `transaction_id` est la clé primaire
(`supabase/schema.sql`) : le doublon renvoie `23505` et le second appelant
échoue au lieu d'écraser le premier (`server/persistence.mjs:3936-3951`). C'est
la bonne primitive pour une protection multi-instance, là où l'OCC ne
s'applique pas.

### B10 — Les sessions n'ont pas besoin d'OCC

`auth_sessions` est indexée sur un jeton aléatoire de 32 octets
(`server/persistence.mjs:2948`) : l'écriture est naturellement idempotente
pour une clé donnée, et deux requêtes de rotation ne peuvent pas concourir sur
la même ligne. `realtime_sessions` suit la même logique.

### B11 — Le règlement BR en deux phases est bien fermé contre le double versement

Le statut `settling` est persisté **avant** le moindre versement
(`server/br-engine.mjs:784-786`) et `player.settled` est persisté **après
chaque** versement (`:862`, `:868`, via `onProgress` → `saveBrLobbies`). Un
salon interrompu est reprenable et les joueurs déjà servis sont sautés. Le
risque de C1/C2 n'est donc **pas** le double versement, mais l'écrasement
d'une action concurrente.

### B12 — La clé d'idempotence de retrait est durable par construction

`trackWithdrawalKey` reporte la clé dans le portefeuille
(`server/persistence.mjs:1914-1929`) ; l'écriture suivante du portefeuille la
persiste, et l'historique la conserve 200 transactions
(`server/wallet-engine.mjs:130-133`). Les deux fenêtres se recouvrent : la clé
ne peut pas disparaître des deux côtés à la fois. `hydrateWithdrawalKeys` /
`hydrateWinningsKeys` reconstruisent les index au démarrage
(`server/realtime-server.mjs:673-677`).

### B13 — Le règlement des matchs est en deux phases, et le retrait est débité sous verrou, payé hors verrou

`submitMatchResultOnServer` persiste d'abord `payoutDistributed:'pending'`
(`server/match-engine.mjs:990`) et ne verse qu'ensuite. Côté retrait, le débit
est fait sous `withWalletMutex` et l'appel réseau FedaPay **hors** verrou
(`server/routes/wallet.mjs:248-290` puis `:316-324`) : l'inverse rendrait le
double paiement possible — c'est le piège décrit dans l'en-tête de
`server/mutex.mjs:18-20`, et il est correctement évité.

---

## 4. Ce que le projet a déjà corrigé (et qui ne doit pas être re-signalé)

| ID historique | Objet | État | Commentaire |
|---|---|---|---|
| V1 | `sweepMatchesWithoutArbiter` n'était branché nulle part | corrigé | branché sur le tick de 30 s (`server/realtime-server.mjs:696`) |
| V2 | `pendingArbiterFee` écrit mais jamais relu | corrigé | `sweepPendingArbiterFees` (`server/cron.mjs:82-106`) |
| V6 | Une exception de règlement tuait tout le balayage d'expiration | corrigé | isolation par match (`server/match-engine.mjs:1157-1185`) |
| V7 | BR : pass verrouillé avant le contrôle `TEAM_FULL` | corrigé | verrou posé après les validations (`server/br-engine.mjs:412-427`) |
| V10 | BR : aucun cron de reprise d'un règlement interrompu | corrigé | `sweepPendingBrSettlements` existe ; désormais **sous verrou par salon + écriture par entité** (`:136-193`, voir Correctif C2 du 23/10/2026) |
| V14 | Salon BR programmé et jamais lancé → passes gelées | corrigé | `sweepStaleBrLobbies` — ne couvre que `scheduled`, voir C4 (l'écriture est désormais par entité, Correctif C2) |
| — | Double versement BR en concurrence | **corrigé le 23/10/2026** | `474dcfa` mettait le calcul sous verrou, l'écriture restait dehors (**C1, réintergression**) → désormais calcul **et** écriture sous le verrou, et écriture **par entité** |
| — | Gains de tournoi / de ligue non versés | corrigé | `pendingPayouts` + crons dédiés (`server/cron.mjs:565`, `:596`) |
| — | Retrait « peut-être parti » | corrigé | `pending_review` + file de réconciliation (`server/wallet-engine.mjs:2093-2113`) |

---

## 5. Cartographie des verrous (annexe A)

| Verrou | Nature | Portée | Pris par |
|---|---|---|---|
| `withMatchMutex` | global | collection `matches` | 13 blocs de route `routes/match.mjs` + 3 blocs `routes/admin.mjs` + 4 crons + tick d'automatisation |
| `withTournamentMutex` | global | collection `tournaments` | 8 blocs de route `routes/tournament.mjs` + 3 crons |
| `withLeagueMutex` | global | collection `leagues` | 11 blocs de route `routes/league.mjs` + 4 crons |
| `withBrLobbyMutex` | par entité | un salon BR | actions de salon (`routes/br.mjs`, cycle complet lecture→calcul→écriture dans le verrou depuis le Correctif C1) + `sweepPendingBrSettlements` et `sweepStaleBrLobbies` (`cron.mjs`, Correctif C2) — **pas** la création de salon (C5) |
| `withWalletMutex` | par entité | un joueur | moteurs de règlement, routes wallet, moteurs BR/ligue/tournoi |
| `withUserMutex` | par entité | un compte | `updateUserAccount` (point de sérialisation réel), suppression de compte, activation, email d'activation |
| `withChannelMutex` | par entité | un canal | `appendChatMessage`, `markChatChannelRead` |
| `withRegistrationMutex` | global (auth) | inscriptions / unicité | `insertUser`, `PATCH /api/auth/me` |

**Écarts restants** : `withBrLobbyMutex` n'est pas pris par la création de
salon (C5) — la partie « le salon crée disparaît » est neutralisée par
l'écriture par entité (le correctif de C1/C2), le reste du constat C5 reste
ouvert ; `withUserMutex` n'est pas pris par `updatePasswordHash` (C6).

---

## 6. Inventaire des travaux de fond (annexe B)

| Job | Intervalle | Écrit | Verrou | Garde |
|---|---|---|---|---|
| `matchCleanup` | 6 h | `matches` | `withMatchMutex` | `matchCleanupRunning` |
| `leagueClose` | 1 h | `leagues` | `withLeagueMutex` | `leagueCloseRunning` |
| nettoyage mémoire | 1 h | — | — | — (synchrone) |
| `runIntegrityCheck` | 1 h (+30 s) | — (lecture) | — | `integrityRunning` |
| `tournamentSweep` | 6 h | `tournaments` | `withTournamentMutex` | `tournamentSweepRunning` — cible aussi les tournois `live` abandonnés (C4) |
| `sweepPendingSettlements` | 60 s (+15 s) | `matches` | `withMatchMutex` | `pendingSettlementRunning` — vise aussi les litiges clos restés `disputed` (C3) |
| `sweepPendingArbiterFees` | 30 min (+45 s) | `matches` | `withMatchMutex` | `arbiterFeeRetryRunning` |
| **`sweepPendingBrSettlements`** | 5 min (+60 s) | `brLobbies` | `withBrLobbyMutex` (par salon — **Correctif C2 appliqué le 23/10/2026**, l'écriture passe par `saveBrLobbies` par entité) | `brSettlementRetryRunning` |
| `sweepStaleBrLobbies` | 30 min (+90 s) | `brLobbies` | `withBrLobbyMutex` (par salon) | `staleBrLobbyRunning` |
| `sweepExpiredConfirmations` | 60 s (+25 s) | `matches` | `withMatchMutex` | `confirmationSweepRunning` |
| `sweepPendingRefunds` | 6 h (+20 s) | `tournaments` | `withTournamentMutex` | `refundRetryRunning` |
| `sweepPendingTournamentPayouts` | 6 h (+25 s) | `tournaments` | `withTournamentMutex` | `payoutRetryRunning` |
| `sweepPendingLeaguePayouts` | 6 h (+30 s) | `leagues` | `withLeagueMutex` | `leaguePayoutRetryRunning` |
| `sweepPendingWithdrawals` | 30 min (+45 s) | portefeuilles | `withUserMutex` (via `updateUserAccount`) | `withdrawalReconcileRunning` |
| `sweepStaleLeagues` | 6 h (+22 s) | `leagues` | `withLeagueMutex` | `staleLeagueRunning` |
| `sweepPendingLeagueRefunds` | 6 h (+24 s) | `leagues` | `withLeagueMutex` | `leagueRefundRetryRunning` |
| tick d'automatisation | 30 s | `matches` | `withMatchMutex` | `matchAutomationRunning` |

Les 16 jobs + le tick sont guarded. Depuis le Correctif C2 (23/10/2026),
**tous prennent le même verrou que leur route** — plus aucun écart. Les
cibles élargies du Correctif C4 ne changent ni le nombre de jobs ni leurs
verrous : `sweepStaleBrLobbies` annule aussi les salons `live` abandonnés,
`sweepStaleLeagues` les saisons `qualifying` abandonnées.

---

## 7. Limites de cette relecture — **NON VÉRIFIÉ**

- **Comportement multi-instance réel** : non testé ici (pas de seconde
  instance). Les conclusions multi-instance reposent sur la lecture de l'OCC,
  du garde mono-processus et du schéma. La fenêtre résiduelle « deux
  instances pendant un déploiement Render » (état en mémoire non protégé par
  OCC, contrairement à l'argent) reste ouverte et est déjà documentée dans
  `docs/audit/04-concurrence.md` § 5.
- **Sémantique PostgREST d'un `UPDATE … WHERE revision = n`** : la preuve
  « 0 ligne modifiée = conflit » repose sur le comportement documenté et sur
  les tests existants (`server/write-window-race.test.mjs`), pas sur une
  exécution contre une vraie base ici.
- **Probabilité réelle d'activation de C1** : dépend du trafic BR. Le
  scénario est déterministe dès que deux actions de salon se chevauchent ; la
  probabilité n'est pas mesurée.
- **État de production** : je n'ai pas lu les journaux ni les données de la
  base. Un salon BR réellement perdu, ou un match réellement dans l'état de
  C3, n'est ni confirmé ni infirmé.
- **`docs/05-invariants.md`** cite des numéros de ligne antérieurs à
  `ce039e8` (la documentation de l'intégralité) : les références de ce document
  ont été re-calculées sur le code actuel.
