# ZOYD — Le modèle métier

> Ce document décrit **ce que fait le produit**, pas ce qu'il devrait faire.
> Chaque affirmation structurante porte une citation `fichier:ligne` dans le code.
> Quand une affirmation n'a pas pu être vérifiée dans le code, elle est marquée
> **non vérifié**.
>
> Les règles qui ne doivent jamais casser sont dans `docs/05-invariants.md`.
> Les écarts constatés entre le modèle voulu et le code livré sont listés dans
> `docs/05-invariants.md` § « INVARIANTS VIOLÉS OU NON COUVERTS ».
>
> **Convention de citation (audit-3 P16).** Les renvois `fichier:ligne` datent
> de la vérification indiquée ci-dessous : toute modification du fichier les
> décale. L'ancrage fiable est le **nom du symbole** (fonction, constante) ;
> la ligne est un indice, pas une garantie.

Base de lecture : `server/` (Node, http natif) + `src/` (React/Vite).
Dernière vérification : dépôt local, commit `5f4b796` (27/10/2026), repassé le
28/10/2026 (audit-3 P16).

---

## 1. Le modèle économique

### 1.1 La seule recette de ZOYD est la commission de retrait

| Flux | Destinataire | Part | Source |
|---|---|---|---|
| Mise d'entrée (pot) | les vainqueurs | 100 % du pot réel | `server/match-engine.mjs:312-314` |
| **Commission de retrait** | **ZOYD** | **2 %** | `server/wallet-engine.mjs:5`, `server/wallet-engine.mjs:55-59` |
| Part d'arbitre | l'arbitre | 2 % (match) · 5–10 % (tournoi) · 0 % (ligue) · ≤ 5 % (BR) | voir §6 |

Trois garde-fous matérielisent cette règle :

1. **Aucun rake sur le pot.** `match.zoydFee` est créé à `0` et n'est jamais
   modifié : `server/match-engine.mjs:541`. Le pot n'est amputé que de la part
   d'arbitre (`server/match-engine.mjs:313`).
2. **Le revenu affiché = frais de retrait uniquement.**
   `getCommissionStats()` calcule `revenue: withdrawalTotal` et place
   explicitement les parts d'arbitre **hors** du revenu :
   `server/persistence.mjs:1527-1542` (« Volontairement HORS du revenu »).
3. **Test E2E dédié.** `e2e/api/wallet.spec.ts:322` — « le revenu est la
   commission de retrait, PAS les parts d'arbitre » ; et
   `e2e/api/wallet.spec.ts:298` — « agrège les frais de retrait (2 %) réellement
   encaissés ».

> **Écart connu.** `arbiterPayouts` (la sortie de trésorerie vers les
> arbitres) est reconstitué à partir de `match.arbiterFee`, un champ **figé à
> la création sur le pot théorique** (`server/match-engine.mjs:542`), alors que
> la commission réellement versée vaut 2 % du pot **réellement verrouillé**
> (`server/match-engine.mjs:313`). Le commentaire du code le reconnaît
> (`server/persistence.mjs:1515-1517`). Ce n'est pas un chiffre de revenu :
> c'est un indicateur d'écart, approximatif. Voir `docs/05-invariants.md` V11.

### 1.2 L'unité

- **ZC** = *Zoyd Coins*. 1 ZC = 10 FCFA (`server/payment-engine.mjs`,
  test `server/payment-engine.test.mjs:110` « should compute ZC correctly »).
- Les retraits passent par **FedaPay** (Mobile Money, 4 pays) :
  `server/payout-countries.mjs`.
- Les pots et les soldes sont arrondis à 2 décimales par `roundAmount` :
  `server/utils.mjs:1-5`.

---

## 2. Les sept moteurs

| # | Fichier | Lignes | Rôle | Rémunération d'arbitre |
|---|---|---|---|---|
| 1 | `server/match-engine.mjs` | 1 898 | Match 1VS1 → 5VS5, deux équipes, un tiers | **2 %** du pot verrouillé |
| 2 | `server/tournament-engine.mjs` | 1 588 | Tournoi à bracket, 1 ou 2 arbitres à *slots* | **5 %** (1 arbitre) / **10 %** (2 arbitres) |
| 3 | `server/league-engine.mjs` | 1 239 | Ligue BR saisonnière (5 journées, top 40, finale) | **0 %** — l'admin *est* l'arbitre |
| 4 | `server/br-engine.mjs` | 1 230 | Salon Battle Royale (5 → 100 joueurs, un lobby) | **≤ 5 %** du pot |
| 5 | `server/wallet-engine.mjs` | 750 | Portefeuille, séquestre, retraits, réconciliation | — |
| 6 | `server/payment-engine.mjs` | 441 | FedaPay : dépôts (crédit ZC) et retraits (payout) | — |
| 7 | `server/cron.mjs` | 904 | Orchestrateur des balayages automatiques | — |

Socle transversal, non compté ci-dessus :

- `server/persistence.mjs` (4 456 l.) — lecture/écriture, Supabase, OCC.
- `server/mutex.mjs` (202 l.) — verrous **de processus** (`async-mutex`).
- `server/state-helpers.mjs` (525 l.) — ce qui est diffusé au client.
- `server/single-process-guard.mjs` (164 l.) — refuse de démarrer en multi-processus.

### 2.1 Graphe de dépendances

```
cron.mjs ──┬─> match-engine.mjs ──> wallet-engine.mjs ──> persistence.mjs
           ├─> tournament-engine.mjs ─┘
           ├─> league-engine.mjs ─────┘
           └─> payment-engine.mjs

realtime-server.mjs ──> match-engine.mjs   (automation, tick 30 s)
routes/{match,admin,br,league,tournament,wallet}.mjs ──> moteurs + mutex.mjs
```

Il n'existe **pas** de `dispute-engine.mjs` : la gestion des litiges est
intégrée au moteur de match (`openDisputeOnServer` `server/match-engine.mjs:1330`,
`resolveDisputeOnServer` `server/match-engine.mjs:1408`,
`addEvidenceToDisputeOnServer` `server/match-engine.mjs:1816`,
`escalateDisputeOnServer` `server/match-engine.mjs:1863`).

---

## 3. L'arbitre

### 3.1 Qui peut être arbitre

| Contexte | Règle | Emplacement |
|---|---|---|
| Match | n'importe quel joueur connecté, **hors joueurs du match** | `server/match-engine.mjs:647-654` |
| Tournoi | le créateur est slot 1 par défaut ; sinon un joueur inscrit ne peut pas | `server/tournament-engine.mjs:736-746`, `server/tournament-engine.mjs:1193-1195` |
| Ligue | **pas d'arbitre** — toutes les transitions sont admin | `server/league-engine.mjs:233`, `:364`, `:409`, `:442`, `:517`, `:550` |
| BR | désigné **à la création** (défaut : le créateur), tout compte existant — volontariat A7, **pas de test de rôle** | `server/br-engine.mjs:330-339` |

**Un joueur ne peut pas être joueur ET arbitre.** C'est le même invariant dans
les trois moteurs qui connaissent un roster de joueurs :

- match : `server/match-engine.mjs:654` (`ROLE_CONFLICT`, « Un joueur ne peut pas
  arbitrer son propre match ») et symétriquement `server/match-engine.mjs:601`
  (« Tu occupes deja la place d'arbitre ») ;
- tournoi : `server/tournament-engine.mjs:1193-1195` et
  `server/tournament-engine.mjs:788-790` ;
- BR : l'arbitre n'est **structurellement pas** dans `players` — il ne paie
  aucun pass et ne figure pas au classement
  (`server/br-engine.mjs:308-311`, `server/br-engine.mjs:728`,
  `server/br-engine.mjs:634-636`).

### 3.2 Les cinq obligations de l'arbitre (match)

Ce sont cinq obligations **distinctes**, avec cinq sanctions distinctes.

| # | Obligation | Où elle est vérifiée | Sanction si manquée |
|---|---|---|---|
| 1 | **Être désigné** | `server/match-engine.mjs:352` (dérivation `awaiting_arbiter`) | Match bloqué ; remboursement par le sweep (§9.1) — **branché** sur le tick de 30 s (V1 corrigé) |
| 2 | **Publier la salle** | `server/match-engine.mjs:765-784` | `ROOM_TOO_EARLY` (> 10 min avant) ; `ROOM_INCOMPLETE` |
| 3 | **Lancer le match** | `server/match-engine.mjs:806-824` | `FORBIDDEN` (811-813) ; `MATCH_NOT_READY` (822-824) |
| 4 | **Trancher le résultat** | `server/match-engine.mjs:872-874` puis `server/match-engine.mjs:306-308` | `ARBITER_REQUIRED` — **double garde** : à la soumission *et* à la sortie d'argent |
| 5 | **Respecter la fenêtre de confirmation** | `server/match-engine.mjs:946` + `server/match-engine.mjs:1085-1109` | Cron 60 s : règlement automatique |

L'obligation n°4 est la plus dure, et c'est le cœur du modèle. Le garde de
règlement (`server/match-engine.mjs:306-308`) est placé **au plus près de la
sortie d'argent**, pas seulement à l'entrée : `applyResultSettlement` est
appelée par cinq chemins distincts (`server/match-engine.mjs:963`, `:994`,
`:1060`, `:1097`, `:1223`), donc un seul garde à la soumission ne suffirait pas.

> **Un seul arbitre par match.** `server/match-engine.mjs:653` :
> `ARBITER_TAKEN`, premier arrivé premier servi.
> La ligne 653 est aussi la preuve que le match est mono-arbitre : `match.arbiter`
> est un objet, pas un tableau.

### 3.3 La commission d'arbitre, selon le moteur

| Moteur | Taux | Base | Ligne |
|---|---|---|---|
| Match | 2 % | pot **réellement verrouillé** | `server/match-engine.mjs:142`, `:313` |
| Tournoi | 5 % / 10 % | pot brut (inscriptions × tarif × taille d'équipe) | `server/tournament-engine.mjs:21`, `:27-45` |
| Ligue | 0 % | — | aucun code de commission dans `server/league-engine.mjs` |
| BR | ≤ 5 % | pot | `server/br-engine.mjs:86`, `:199-204`, `:942` |

---

## 4. Cycle de vie d'un match

### 4.1 Les statuts **écrits** dans `match.status`

| Statut | Écrit à | Sens |
|---|---|---|
| `recruiting` | `server/match-engine.mjs:551` | Roster incomplet. |
| `awaiting_arbiter` | `server/match-engine.mjs:245` (via `updateMatchSnapshot`) | Roster complet, **pas d'arbitre** : rien ne peut avancer. |
| `check_in` | `server/match-engine.mjs:245` | Au moins un joueur non pointé ou non prêt. |
| `ready` | `server/match-engine.mjs:245` | Tous pointés, tous prêts, arbitre présent. |
| `in_progress` | `server/match-engine.mjs:719`, `:826` | Match lancé. |
| `awaiting_confirmation` | `server/match-engine.mjs:945` | Résultat écrit, **gains pas encore versés**. |
| `finished` | `server/match-engine.mjs:958`, `:1000`, `:1063`, `:1100`, `:1225` | Match soldé. |
| `forfeited` | `server/match-engine.mjs:958`, `:1312` | Forfait : l'adversaire est payé. |
| `cancelled` | `server/match-engine.mjs:75`, `:1236`, `:1283`, `:1327` | Remboursé. |
| `disputed` | `server/match-engine.mjs:1167` | Litige ouvert : **la cagnotte est gelée**. |
| `archived` | `server/cron.mjs:63` | Archivé après 14 j d'inactivité. |

### 4.2 Les statuts **dérivés** (`getStatusFromMatch`, `server/match-engine.mjs:197-234`)

`getStatusFromMatch` recalcule l'état depuis l'état structurel du match. Il
retourne, dans l'ordre :

1. `disputed` si un litige est `open` ou `under_review` (`:198`) ;
2. le statut **tel quel** s'il est terminal (`:202-204`) ;
3. `finished` si `match.result` ou `match.finishedAt` existe (`:206-208`) ;
4. `recruiting` si le roster est incomplet (`:211`) ;
5. `awaiting_arbiter` si `!match.arbiter?.userId` (`:223`) ;
6. `check_in` si tout le monde n'est pas pointé/prêt (`:225-227`) ;
7. `in_progress` si `match.status === 'in_progress'` (`:229-231`) ;
8. `ready` (`:233`).

**Attention — un statut dérivé peut être PERSISTÉ.** `updateMatchSnapshot`
(`server/match-engine.mjs:236-247`) réécrit `status` avec
`getStatusFromMatch(next)` à la ligne `245`, et ses appelants font
`Object.assign(match, updateMatchSnapshot(match, {}))` (`:630`, `:663`, `:690`,
`:723`, `:751`, `:793`, `:1345`). `awaiting_arbiter` est donc **un statut réel
en base**, pas une vue volatile — ce que confirme le test E2E
`e2e/api/match.spec.ts:203` (`expect(res.body.match.status).toBe('awaiting_arbiter')`).

> **Correction d'un rapport de cartographie antérieur.** Ce rapport affirmait que
> les statuts dérivés étaient « jamais écrits, produits par `getStatusFromMatch` »
> et qualifiait `awaiting_arbiter` d'« état dérivé, jamais écrit tel quel ».
> C'est **faux** : `server/match-engine.mjs:245` les écrit. La distinction utile
> n'est pas « écrit vs dérivé » mais « écrit explicitement vs réécrit par le
> snapshot ».

### 4.3 Les trois listes de statuts, et leur divergence

La source unique vit dans `shared/match-status.json`, importée par le serveur
(`server/match-status.mjs:48-54`) et par le front (`src/app/lib/matchStatus.ts`).
Les copies divergentes ont été fusionnées (V3, V4 corrigés) :

| Liste | Source | Contenu |
|---|---|---|
| `ACTIVE_STATUSES` | `shared/match-status.json` (`server/match-status.mjs:48`) | `recruiting`, `full`, `awaiting_arbiter`, `check_in`, `ready`, `in_progress`, `awaiting_confirmation` |
| `CLOSED_STATUSES` | `shared/match-status.json` (`server/match-status.mjs:51`) | `cancelled`, `forfeited`, `archived`, `finished` |
| `HISTORY_STATUSES` | `shared/match-status.json` (`server/match-status.mjs:54`) | les CLOSED plus `disputed` |

Les trois divergences historiques sont résolues :
- `awaiting_arbiter` ∈ `ACTIVE_STATUSES` (V3, corrigé) ;
- `archived` ∈ `CLOSED_STATUSES` (V4, corrigé) ;
- `full` reste listé pour les données anciennes mais n'est plus jamais
  produit par `getStatusFromMatch` — marqué legacy dans
  `server/match-status.mjs:37-39`.

### 4.4 Transitions

| # | Déclencheur | Fonction | Depuis | Vers | Argent |
|---|---|---|---|---|---|
| 1 | Création | `createMatchOnServer:507` | — | `recruiting` | verrou du pass créateur (`:529`) |
| 2 | Inscription | `joinMatchOnServer:593` | `recruiting` | snapshot (`awaiting_arbiter` / `check_in` / `ready`) | verrou du pass (`:614`) |
| 3 | Désignation d'arbitre | `assignArbiterOnServer:647` | `awaiting_arbiter` | `check_in` / `ready` | — |
| 4 | Pointage | `checkInMatchOnServer:679` | `check_in` | `ready` | — |
| 5 | Prêt | `toggleReadyOnServer:703` | `check_in` | `ready` | — |
| 6 | Programmation | `scheduleMatchOnServer:737` | — | inchangé | — |
| 7 | Publication de salle | `setRoomDetailsOnServer:765` | `ready` | inchangé | — |
| 8 | Lancement | `launchMatchOnServer:806` | `ready` | `in_progress` | — |
| 9 | Soumission du résultat | `submitMatchResultOnServer:844` | `in_progress` | `awaiting_confirmation` | **rien** (`:945-947`) |
| 10 | Confirmation (tous) | `confirmMatchResultOnServer:1025` | `awaiting_confirmation` | `finished` | versement (`:1060`) |
| 11 | Expiration (cron 60 s) | `expireConfirmationsOnServer:1085` | `awaiting_confirmation` | `finished` | versement (`:1097`) |
| 12 | Litige | `openDisputeOnServer:1120` | `awaiting_confirmation` | `disputed` | **gelé** |
| 13 | Clôture admin « settle » | `resolveDisputeOnServer:1198` | `disputed` | `finished` | versement (`:1223`) |
| 14 | Clôture admin « refund » | `resolveDisputeOnServer:1230` | `disputed` | `cancelled` | remboursement (`:1233`) |
| 15 | Forfait no-show | `resolveForfeit:1291` | `in_progress` | `forfeited` | perdant débité, gagnant crédité |
| 16 | Automation 14 j | `processMatchAutomationOnServer:1355` | — | `cancelled` | remboursement (`:1320-1325`) |
| 17 | Automation « pas d'arbitre à l'heure » | `processMatchAutomationOnServer:1381` | — | `cancelled` | remboursement |
| 18 | Automation « une seule équipe prête » | `processMatchAutomationOnServer:1408` | — | `forfeited` | forfait |
| 19 | Admin | `cancelMatchOnServer:1260` | — | `cancelled` | remboursement (`:1277`) |
| 20 | Sweep arbitrage 2 h | `sweepMatchesWithoutArbiter:81` | — | `cancelled` | remboursement — **branché ✅** (tick 30 s, §9.1) |

### 4.5 Le litige

Trois niveaux, un seul gel :

- `open` (`server/match-engine.mjs:1159`) : litige frais, `prizePoolFrozen: true`
  (`:1162`), statut `disputed` (`:1167`) ;
- `under_review` (`server/match-engine.mjs:1535`) : escaladé au niveau 2 par
  l'arbitre (`:1863`) ;
- `resolved` (`server/match-engine.mjs:495`) : clos par l'admin.

Pendant qu'un litige est actif, **deux** chemins de versement sont gelés :
`settlePendingMatchResult` (`server/match-engine.mjs:988-992`) et
`expireConfirmationsOnServer` (`server/match-engine.mjs:1094-1095`).

---

## 5. Cycle de vie d'un tournoi, d'une ligue et d'un salon BR

### 5.1 Tournoi (`server/tournament-engine.mjs`)

**Statuts du tournoi** : `recruiting` (`:88`, `:253`) → `live` (`:1245`) →
`completed` (`:485`) ; `cancelled` (`:989`).

**Statuts d'un duel** (`tournament.matches[].status`) : `pending` (`:314`,
`:333`, `:417`, `:448`) → `ready` (`:409`) → `live` (`:1340`) → `finished`
(`:436`, `:545`).

**Cycle** :

```
createTournamentOnServer:725        status = 'recruiting'
   │  le créateur réserve le slot 1 d'arbitre (`:736-746`)
   ▼
registerForTournamentOnServer:777    lock du pass capitaine × teamSize (`:879`)
   ▼
assignTournamentArbiterOnServer:1187 remplissage des slots (`:1200-1201`)
   ▼
startTournamentOnServer:1226         status = 'live' + génération du bracket
   │  garde : TOUS les slots doivent être couverts (`:1240-1242`)
   ▼
pour chaque duel : room (`:1286`) → live (`:1325`) → résultat (`:1362`)
   │  chaque duel est rattaché à un slot : arbiterSlot = (index % arbitersNeeded) + 1 (`:307`)
   ▼
applyTournamentSettlement:605        au passage à 'completed' (`:1409-1411`)
```

Le règlement est **réentrant** : `applyTournamentSettlement` est exporté
(`:605`) et un cron le rejoue (voir §9). Les sommes en échec sont inscrites
dans `tournament.pendingPayouts` **au moment du règlement**
(`server/tournament-engine.mjs:708-714`), jamais après — le déclencheur
`!wasCompleted` est à usage unique (`:1409`).

### 5.2 Ligue (`server/league-engine.mjs`)

**Statuts de saison** : `registering` (`:105`, `:246`) → `qualifying` (`:396`) →
`final` (`:537`) → `completed` (`:620`) ; `cancelled` (`:886`).

**Statuts de journée** : `pending` (`:51`) → `scheduled` (`:382`) → `live`
(`:428`) → `finished` (`:490`).

**Statut de finale** : `season.finalMatch.status` `pending` (`:115`, `:260`) →
`finished` (`:617`).

**Cycle** :

```
createLeagueSeasonOnServer:231   status = 'registering'  [admin]
   │  joinLeagueSeasonOnServer:275   lock 50 ZC (`:290`)
   │  leaveLeagueSeasonOnServer:336  remboursement
   ▼
startLeagueQualificationOnServer:362  status = 'qualifying'  [admin, ≥ 10 inscrits]
   │  assignPlayersToDays:218  répartition aléatoire en 5 journées
   ▼
startLeagueDayOnServer:407  →  submitLeagueDayResultsOnServer:440   (× 5)
   ▼
advanceToFinalOnServer:515      status = 'final'  (top 40)
   ▼
submitLeagueFinalResultsOnServer:548  status = 'completed' + podium
   ▼
applyLeagueSettlement:648       gains + pass des non-podium
```

**Particularité structurante : la ligue n'a aucun arbitre et aucune fenêtre de
confirmation.** Toutes les transitions sont réservées à `role === 'admin'`
(`:233`, `:364`, `:409`, `:442`, `:517`, `:550`, `:971`, `:1031`, `:1070`), le
classement est saisi par l'admin, et le versement est déclenché par lui. La
seule contre-vérification est la **2FA admin** demandée au niveau des routes
(`server/routes/league.mjs`, `requireAdmin2fa`).

Répartition du pot : 60 % / 25 % / 15 % (`server/league-engine.mjs:21-23`,
`buildLeaguePayout:43-48`). Le pass est de 50 ZC (`:15`), 5 journées (`:17`),
top 40 en finale (`:19`), table finale de 100 (`:20`).

> `LEAGUE_PLAYERS_PER_DAY = 100` (`server/league-engine.mjs:18`) est déclaré
> mais **jamais référencé** : il n'existe aucun plafond par journée.

### 5.3 Salon Battle Royale (`server/br-engine.mjs`)

**Statuts du salon** : `scheduled` (`:306`) → `live` (`:519`) →
`settling` (`:723`, transitoire **persistant et reprenable**) → `finished`
(`:882`) ; `cancelled` (`:753`, seul cas : personne n'a joué → tout remboursé).

**Cycle** :

```
createBrLobbyOnServer:227   status = 'scheduled'  [joueur authentifie — volontariat A7]
   │  l'arbitre est désigné ICI : n'importe quel compte existant, par
   │  défaut le créateur ; il n'est jamais joueur du salon
   │  programming 24 h – 48 h (`:254-266`)
   ▼
joinBrLobbyOnServer:335     lock du pass (`:357`)
   │  leaveBrLobbyOnServer:407  — SEUL remboursement (avant lancement)
   ▼
checkInBrLobbyOnServer:442
   ▼
startBrLobbyOnServer:471    status = 'live'
   │  les absents sont marqués `absent` (`:511-517`)
   │  le pot est RECALCULÉ depuis les réservations wallet réelles (`:525-533`)
   ▼
eliminateBrPlayerOnServer:569   [arbitre du salon uniquement]
   ▼
settleBrLobbyOnServer:692  status = 'settling' → 'finished'
```

**Règle économique propre au BR** : le pass est payé à l'inscription et
**n'est jamais remboursé après le début**. Un inscrit absent pénalise ceux qui
sont venus, donc sa part reste dans la cagnotte
(`server/br-engine.mjs:403-406`, `:418-423`, `:838-867`).

Répartition : top **5** payés (`BR_PRIZED_PLACES`, `:83`), parts 40 / 22 / 13 /
12 / 8 % du `winnersPool` (`BR_DEFAULT_PAYOUT`, `:78-80`), le dernier
bénéficiaire absorbant l'arrondi (`:920-921`). Les places 6+ consomment leur
pass.

Classement : `computeBrRanking:633` — `survie` (`:644-647`), `kills` (`:648`),
`survie_kills` = 0,7 × survie + 0,3 × kills (`:115-116`, `:658`).

---

## 6. Les deux pots, et pourquoi c'est un garde anti-mint

| Notion | Champ | Base de calcul | Usage |
|---|---|---|---|
| Pot **théorique** | `match.prizePool` | `entryFee × maxPlayers` — `server/match-engine.mjs:526` | Affichage à la création ; `getWinnerPayout` (`:139`) |
| Pot **réel** | `getLockedPot(match)` | Somme des `wallet.lockedEntries[match.id].amount` — `server/match-engine.mjs:152-160` | **Source de vérité du règlement** |

Le code documente l'écart à deux endroits :

> « Cagnotte RÉELLEMENT verrouillée par les joueurs du match. Source de vérité =
> les réservations wallet (`lockedEntries`), pas `match.prizePool` (calculé sur
> maxPlayers à la création). Sans ça, un match à roster incomplet distribue un
> pot fantôme : le joueur créait de la monnaie. »
> — `server/match-engine.mjs:144-151`

> « Anti-mint : on ne distribue QUE l'argent réellement verrouillé.
> `match.prizePool` est calculé sur `maxPlayers` à la création ; s'il servait de
> base, un match à roster incomplet paierait un pot fantôme. »
> — `server/match-engine.mjs:309-311`

Le règlement utilise effectivement le pot réel :
`const lockedPot = getLockedPot(match)` (`server/match-engine.mjs:312`), puis
`payout = lockedPot − commission` (`:314`). La projection affichée
(`getProjectedPayouts:168-182`) utilise la **même base**, avec repli sur
`prizePool` quand aucune réservation n'existe (`:170`) — c'est cette fonction
qui est diffusée au client (`server/state-helpers.mjs:149`).

**Test qui verrouille le garde** :
`server/match-engine.test.mjs:556` — « should never pay more than the funds
actually locked (anti-mint) » : 200 ZC réellement verrouillés, `prizePool`
théorique 400 → le joueur ne reçoit que 196 ZC (200 − 2 % d'arbitre), pas
392. Et `server/match-engine.test.mjs:512` — « should split the pot between
winners in 2v2 (anti-mint) » : 400 verrouillés → 392 distribués au total sur
**2** gagnants, pas 1 × 400.

**Côté BR**, la même règle : le pot est recalculé depuis les réservations
wallet réelles au lancement (`server/br-engine.mjs:525-533`), et la
répartition part de `lobby.pot` (`computeBrPayouts:903-907`).

**Côté tournoi et ligue**, le pot est un **produit** (`entryFee × inscriptions ×
taille d'équipe`, `server/tournament-engine.mjs:28` ; `inscrits × tarif`,
`server/league-engine.mjs:43-48`), pas une somme de réservations. C'est
exact tant que le tarif a **au plus 2 décimales** : au-delà, produit et somme
d'arrondis divergent de quelques centimes (`server/roundings-and-realtime-sanctions.test.mjs:39-54`).
La normalisation est faite à l'entrée des routes
(`server/routes/match.mjs:74`, `server/routes/tournament.mjs:90`) et dans le
moteur ligue (`server/league-engine.mjs:1003`).

---

## 7. Le cycle de l'argent

### 7.1 Les quatre primitives du `wallet-engine`

| Primitive | Ligne | Effet sur les soldes | Effet sur `lockedEntries` | Transaction |
|---|---|---|---|---|
| `lockEntryFee(userId, amount, matchId)` | `server/wallet-engine.mjs:190` | `-cash` puis `-bonus`, `+locked` | **crée** `lockedEntries[matchId] = { amount, cashAmount, bonusAmount, lockedAt }` (`:215-223`) | `entry_fee`, montant négatif (`:226-232`) |
| `refundLockedEntry(userId, matchId, description)` | `server/wallet-engine.mjs:268` | `+cash` (`:281`), `+bonus` (`:282`), `-locked` (`:283`) | **supprime** la réservation (`:276`) | `refund`, montant positif (`:287-292`) |
| `releaseWalletWinnings(userId, amount, matchId, type, description, options)` | `server/wallet-engine.mjs:346` | `+cash` et/ou `+bonus` selon la part bonus (`:397-398`) | **supprime** la réservation (`:379-381`) | `prize_win` ou `arbitration_fee` (`:404`) |
| `settleMatchLossWallet(userId, matchId, description)` | `server/wallet-engine.mjs:304` | `-locked` (`:317`), **aucun** retour en cash/bonus | **supprime** la réservation (`:312`) | `match_loss`, montant `−reservation.amount` (`:325`) |

Deux opérations d'entrée-sortie de l'économie existent à côté :
`depositToWallet` (`:107`) et `withdrawFromWallet` (`:144`).

### 7.2 Les règles qui rendent ces quatre primitives sûres

1. **Un seul verrou par compétition.** `lockEntryFee` refuse une seconde
   réservation pour le même `matchId` : `ALREADY_LOCKED`
   (`server/wallet-engine.mjs:197-199`).
2. **Solde suffisant** : `INSUFFICIENT_FUNDS` (`:201-204`).
3. **Cash d'abord, bonus ensuite** (`:206-207`) — le bonus ne peut pas servir à
   payer une mise que le cash ne couvre pas seul.
4. **Le perdant est débité, jamais remboursé** : le chemin perdant est
   `settleMatchLossWallet`, jamais `refundLockedEntry`
   (`server/match-engine.mjs:399`).
5. **Idempotence des gains** : clé `` `${type}:${matchId}` ``
   (`server/wallet-engine.mjs:365`), guardée par `hasSettledWinningsKey`
   (`server/persistence.mjs:1947-1956`) qui lit `wallet.winningsKeys` (dans le
   payload du compte, non plafonné), avec repli sur l'index mémoire puis sur
   l'historique. Le commentaire `server/wallet-engine.mjs:360-364` explique le
   bug que cette garde corrige : sans elle, un second appel ne trouvait plus la
   réservation, `releasedAmount` retombait à 0, et le joueur était crédité du
   montant **entier** une seconde fois.
6. **La part bonus du gain reste en bonus.** `bonusRestore = min(stakeBonus,
   safeAmount)` et `cashCredit = safeAmount − bonusRestore`
   (`server/wallet-engine.mjs:384-386`) : la part du gain correspondant à la
   mise bonus **ne devient jamais retirable**.
7. **Le pass consommé vaut son montant, pas 0** (`server/wallet-engine.mjs:322-325`) :
   sans cela l'historique ne reconstituait plus les soldes.
8. **Les statistiques ont leur propre idempotence** : `applyUserSettlementOnce`
   (`server/persistence.mjs:200-210`), clé `user.settlementKeys` plafonnée à
   500 (`:181`, `:207`). Sinon un règlement rejoué recréditait 0 ZC mais
   recomptait les victoires, l'ELO et l'XP (`server/persistence.mjs:184-194`).

### 7.3 Les quatre chemins de sortie d'un match

```
applyResultSettlement (server/match-engine.mjs:295)  ← SEUL point de sortie de l'argent d'un match
   │
   ├─ lockedPot = getLockedPot(match)                     (:312)
   ├─ arbiterFee = lockedPot × 2 %                        (:313)
   ├─ payout    = lockedPot − arbiterFee                  (:314)
   ├─ winnerCount = nombre de gagnants                    (:350, :355)
   ├─ sharePerWinner = payout / winnerCount               (:356)
   ├─ firstWinnerShare = payout − sharePerWinner × (winnerCount − 1)   (:358)  ← absorbe l'arrondi
   │
   ├─ gagnant : releaseWalletWinnings(...)                (:372-375)
   │            + paidWinners : un même user listé 2× n'est payé qu'une fois (:369)
   ├─ perdant  : settleMatchLossWallet(...)               (:399)
   └─ arbitre  : releaseWalletWinnings(..., 'arbitration_fee') (:440-446)
```

Trois chemins d'échec sont distincts : `settlementErrors` (joueurs),
`arbiterErrors` (arbitre), et le retour `{ success, playersDistributed,
arbiterDistributed, arbiterErrors }` (`server/match-engine.mjs:483-489`). La
séparation est volontaire : sinon l'échec de la commission d'arbitre
déclarait le match non soldé alors que tous les joueurs étaient payés
(`server/match-engine.mjs:469-482`).

### 7.4 La sémantique de `payoutDistributed`

Valeur persistée après règlement (`server/match-engine.mjs:275-293`) :

| Valeur | Sens |
|---|---|
| `true` | règlement complet |
| `'pending'` | à solder — soit en attente de confirmation, soit interrompu |
| `false` | délibérément non versé (annulé, remboursé) |

`false` et `'pending'` ne veulent pas dire la même chose : le cron de reprise
ne sélectionne que `'pending'` (`server/cron.mjs:257`), donc un match dont un
seul joueur n'avait pas été payé sortait définitivement du mécanisme
(`server/match-engine.mjs:278-282`).

### 7.5 La sortie d'argent des autres moteurs

| Moteur | Gains | Perdants / non-podium |
|---|---|---|
| Tournoi | `releaseWalletWinnings(captainId, payout, tournament.id, 'prize_win')` — `server/tournament-engine.mjs:627` | `settleMatchLossWallet(captainId, tournament.id)` — `:629` |
| Tournoi (arbitre) | `releaseWalletWinnings(arbiter.userId, arbiterShare, '{id}-ARB-{slot}', 'arbitration_fee')` — `:679-685` | — |
| Ligue | `releaseWalletWinnings(podium.first/second/third, …, season.id, 'prize_win')` — `server/league-engine.mjs:675`, `:696`, `:716` | `settleMatchLossWallet(player.userId, season.id)` — `:738` |
| BR | `releaseWalletWinnings(prize.userId, prize.amount, lobby.id, 'prize_win')` — `server/br-engine.mjs:793-799` | `settleMatchLossWallet(player.userId, lobby.id)` — `:860-866` |

> **Piège de clé de réservation en ligue.** La clé doit être `season.id`, pas
> `${season.id}-1ST` : le pass a été bloqué par `lockEntryFee(..., seasonId)`.
> Avec une clé différente, `lockedEntries[matchId]` valait `undefined`, le
> verrou n'était **jamais** libéré (pass gelé à vie) et la mise bonus du
> champion était convertie à 100 % en cash retirable. Le commentaire
> `server/league-engine.mjs:669-674` documente ce correctif.

### 7.6 Le retrait : la seule source de revenu

```
withdrawFromWallet (server/wallet-engine.mjs:144)
   ├─ minimum 150 ZC (`:146-148`)
   ├─ solde cash suffisant (`:154-156`)
   ├─ plafond cumulé 50 000 ZC / 24 h glissantes (`:158-164`, `:18-19`, `:34-48`)
   ├─ commission 2 % : calcWithdrawNet (`:55-59`) → net = brut − 2 %
   └─ DÉBIT DU BRUT (`:170`) ; c'est le NET qui part chez FedaPay
      (server/routes/wallet.mjs)
```

Le plafond est calculé sur `Math.abs(tx.amount)` parce que la transaction de
retrait porte un montant **négatif** (`server/wallet-engine.mjs:42-45`).

Les retraits incertains (« payout peut-être parti ») sont dans une file
dédiéee `wallet.payoutsEnAttente`, hors de l'historique plafonné à 200
(`server/persistence.mjs:2017-2047`), et relus par
`reconcilePendingWithdrawals` (`server/wallet-engine.mjs:478`), branché au cron
(`server/cron.mjs:429-463`, tick 30 min).

---

## 8. L'OCC (Optimistic Concurrency Control)

### 8.1 Sur quelle colonne

**`app_users.revision`** — un compteur entier, `BIGINT NOT NULL DEFAULT 0`,
avancé par **toute** écriture de la table. La sonde `occSupporte()`
(`server/persistence.mjs:435-451`) détecte sa présence ; si elle manque, le
serveur retombe sur l'écriture inconditionnelle d'avant et **avertit**
(`server/persistence.mjs:444-449`).

> **Réserve importante.** La colonne n'est présente dans **aucun** des deux
> fichiers SQL du dépôt : `supabase/schema.sql:7-18` (le `CREATE TABLE
> app_users` ne la contient pas ; seul un commentaire la décrit à
> `supabase/schema.sql:74-88`) et `supabase/migrate-rls-live.sql:12` (idem).
> Le `ALTER TABLE app_users ADD COLUMN revision BIGINT NOT NULL DEFAULT 0`
> n'existe que dans le message d'avertissement du code
> (`server/persistence.mjs:447`). **L'application de la migration en base de
> production n'est pas vérifiable depuis le dépôt.**

### 8.2 Quel mécanisme

| Composant | Ligne | Rôle |
|---|---|---|
| `OCC_MAX_TENTATIVES = 4` | `server/persistence.mjs:419` | Nombre de tentatives avant refus rejouable |
| `occSupporte()` | `:435-451` | Sonde mémoïsée |
| `lireRevisionUser(userId)` | `:472-483` | Lit `revision` en base |
| `ecrireUserRowSiRevision(userId, revisionObservee, patch)` | `:492-506` | **CAS** : `.eq('id', id).eq('revision', revisionObservee)` + `revision: revisionObservee + 1` |
| `ecrireUserRow(...)` | `:525-570` | Point d'entrée unique + rejeu sur état frais |
| `rechargerUserRow(userId)` | `:576-590` | Relit `{ revision, payload }` |

Le CAS est détecté **par le compte de lignes mises à jour**, pas par un code
d'erreur : PostgREST signale un conflit par un succès
(`server/persistence.mjs:488-490`).

### 8.3 Les trois subtilités qui font la différence

1. **Le rejeu repart de l'état frais de l'autre instance**, révision comprise
   (`server/persistence.mjs:556-568`). Rejouer le patch calculé sur l'ancienne
   révision échouerait encore (`:564-565`).
2. **La base de calcul est l'instant relu en base**, pas la copie mémoire
   (`server/persistence.mjs:1603-1635`). L'OCC ferme la **fenêtre** (deux
   écritures qui se chevauchent) mais pas la **péremption** (instance B qui calcule
   depuis une copie antérieure à A). Si le payload en base diffère de la copie
   mémoire, le serveur adopte le payload frais (`:1629-1634`).
3. **Une ligne disparue est une suppression, pas une création**
   (`server/persistence.mjs:537-552`). Un upsert l'aurait **recréée**, donc
   ressuscité un compte banni avec son solde.

### 8.4 Ce que l'OCC ne protège pas

1. **Les collections d'état** (`matches`, `tournaments`, `leagues`,
   `brLobbies`) : elles vivent dans `state_snapshots` (`supabase/schema.sql:170-176`)
   et sont écrites par `replaceStateCollection`
   (`server/persistence.mjs:3410`), un upsert batch **sans condition de version**.
   Leur protection est le mutex de processus + `single-process-guard.mjs`.
2. **Les tables de chat, notifications, demandes d'amis** : pas de versionnement.
3. **Le mutex de `server/mutex.mjs`** est un verrou de **processus**
   (`async-mutex`, `server/mutex.mjs:1-3`), pas distribué. Le garde de processus
   unique le signale : « `WEB_CONCURRENCY=1, ou un verrou distribue / OCC en
   base.` » (`server/single-process-guard.mjs:118`).

**Invariant vérifié sur la source** : aucun `sbUpsert('app_users', …)` en
dehors de `ecrireUserRow` — `server/occ-revision-invariant.test.mjs:29`.

---

## 9. Les fenêtres temporelles

| Fenêtre | Valeur | Emplacement | Est-elle appliquées ? |
|---|---|---|---|
| Arbitrage — phase A (prise de poste → lancement) | **2 h** | `server/match-engine.mjs:15` | **Oui** — sweep, tick 30 s (`runMatchAutomationOnServer`) |
| Arbitrage — phase B (lancement → résultat) | **2 h** | `server/match-engine.mjs:16` | **Oui** — idem |
| Confirmation du résultat | **30 min** | `server/match-engine.mjs:108`, appliquée `:946` | **Oui** — cron 60 s (`server/cron.mjs:285-313`) |
| Expiration d'un match sans résultat | **14 j** | `server/match-engine.mjs:572` | **Oui** — automation 30 s (`server/realtime-server.mjs:640-657`) |
| 2FA admin (session marquée vérifiée) | **5 min** | `server/persistence.mjs:3164` | **Oui** |
| Code TOTP | **30 s** (pas RFC 6238 de 30 s, fenêtre de tolérance 0) | `server/admin-totp.mjs:13`, `:64` | **Oui** |
| Publication de la salle | ≤ **10 min** avant l'heure | `server/match-engine.mjs:781-784` | **Oui** |
| Lancement BR | ≤ **10 min** avant l'heure | `server/br-engine.mjs:106-112`, `:493-498` | **Oui** (surchargeable en test uniquement, `:106-111`) |
| Programmation BR | **24 h – 48 h** | `server/br-engine.mjs:89-90`, `:254-266` | **Oui** |
| Retrait minimum | **150 ZC** | `server/wallet-engine.mjs:4`, `:146-148` | **Oui** |
| Plafond de retrait | **50 000 ZC / 24 h** glissantes | `server/wallet-engine.mjs:18-19`, `:158-164` | **Oui** |
| Tournoi jamais démarré | **24 h** de grâce après `startsAt` | `server/tournament-engine.mjs:1172` | **Oui** — cron 6 h (`server/cron.mjs:200-237`) |
| Ligue jamais lancée | **1 h** de grâce | `server/league-engine.mjs:832` | **Oui** — cron 6 h (`server/cron.mjs:472-505`) |
| Session | rotation à 30 min, plafond absolu 30 j | `server/persistence.mjs:2990` et suivants | **Oui** |

### 9.1 La matrice des balayages automatiques

| Balayage | Déclencheur | Période | Déclaré | Branché ? |
|---|---|---|---|---|
| Automation match (14 j, no-show, pas d'arbitre à l'heure) | `server/realtime-server.mjs:640-657` | **30 s** | `MATCH_AUTOMATION_INTERVAL_MS` (`server/match-engine.mjs:98`) | ✅ |
| Reprise des règlements de match interrompus | `server/cron.mjs:247-278` | 60 s + boot | — | ✅ |
| Expiration des fenêtres de confirmation | `server/cron.mjs:285-313` | 60 s + boot | — | ✅ |
| Archivage des matchs inactifs | `server/cron.mjs:36-82` | 6 h | — | ✅ |
| Tournois jamais démarrés | `server/cron.mjs:200-237` | 6 h + boot | — | ✅ |
| Reprise des remboursements de tournoi | `server/cron.mjs:320-355` | 6 h + boot | — | ✅ |
| Reprise des gains de tournoi | `server/cron.mjs:365-388` | 6 h + boot | — | ✅ |
| Reprise des gains de ligue | `server/cron.mjs:396-419` | 6 h + boot | — | ✅ |
| Ligues jamais lancées | `server/cron.mjs:472-505` | 6 h + boot | — | ✅ |
| Reprise des remboursements de ligue | `server/cron.mjs:511-547` | 6 h + boot | — | ✅ |
| Réconciliation des retraits incertains | `server/cron.mjs:429-463` | 30 min + boot | — | ✅ |
| Contrôle d'intégrité | `server/cron.mjs:172-194` | 1 h | — | ✅ |
| **Balayage des matchs sans arbitre (2 h)** | `sweepMatchesWithoutArbiter` | — | `server/match-engine.mjs:15-16` | ✅ **branché** (tick 30 s, via `runMatchAutomationOnServer`) |
| **Reprise des commissions d'arbitre en échec** | `match.pendingArbiterFee` | 30 min + boot | `sweepPendingArbiterFees` (`server/cron.mjs`) | ✅ **branché** (audit-2 A1/A3 — `retryPendingArbiterFees`) |
| **Reprise des règlements BR interrompus** | `lobby.status === 'settling'` | 5 min | `sweepPendingBrSettlements` (`server/cron.mjs`) | ✅ **branché** (l'acteur de la reprise est l'arbitre du salon — A7) |
| **Annulation des salons BR jamais lancés ou abandonnés** | `scheduled` dépassé / `live` abandonné | 30 min + boot | `sweepStaleBrLobbies` (`server/cron.mjs`) | ✅ **branché** (remboursement des passes — V14, C4) |

Les balayages livrés le sont dans l'ordre de `docs/audit-2/00-SYNTHESE.md`
§ 4 : chaque rang y est daté et les tests correspondants sont listés dans
`docs/06-tests.md`.

---

## 10. Ce que le modèle ne couvre pas

- **Pas de moteur de litige séparé** : la gestion est dans `match-engine.mjs`.
- **Pas de répartition multi-pari** : un seul gagnant par équipe, pas de pari
  interne au produit.
- **Pas de commission sur le pot** : le pot est intégralement redistribute
  (moins la part d'arbitre).
- **Pas d'arbitre en ligue** : l'admin est juge et partie, compensé par la 2FA.
- **Pas de racket plateforme** : la seule monétisation est le retrait.
- **Pas de mode « inter-espèces »** : tout se règle en ZC.
- **Le salon BR est la seule surface où l'arbitre n'est pas un joueur** : il est
  désigné à la création (défaut : le créateur) parmi tout compte existant —
  volontariat A7, pas de test de rôle (`server/br-engine.mjs:330-339`).
