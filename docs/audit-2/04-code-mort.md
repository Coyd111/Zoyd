# Audit 2 — Code mort, duplication et dérive

**Périmètre** : `server/` (26 modules applicatifs + 66 tests), `src/` (245 fichiers),
`e2e/` (24 fichiers), plus `shared/` et les 9 documents `docs/00-*.md` à `docs/08-*.md`.

**Aucun fichier applicatif n'a été modifié.** Ce document est un constat, pas un correctif.

**Méthode** : extraction automatique de tous les exports de `server/` et `src/`, puis recherche
de chaque identifiant dans **tout** le dépôt (`server/`, `src/`, `e2e/`, `shared/`, `scripts/`,
`docs/`, fichiers racine), tests compris. Pour chaque « code mort », l'absence d'appel est
confirmée par recherche exhaustive ; ce qui n'a pas pu être confirmé est marqué
**NON VÉRIFIÉ**.

**Distinction appliquée** : « code mort **sans conséquence** » (M28-M32, M37-M38 : bruit) est
séparé de « code mort qui **cache une divergence possible** » (M1, M4, M5, M10, M11 : vraies
anomalies).

---

## 1. Synthèse

| Sévérité | Nombre | IDs |
|---|---|---|
| Élevée | 5 | M1, M2, M3, M4, M5 |
| Moyenne | 15 | M6 → M20 |
| Faible | 18 | M21 → M38 |
| **Total** | **38** | |

### Les 5 constats les plus graves

| ID | Titre | Fichier pivot |
|---|---|---|
| **M1** | La projection serveur `projectedPayouts` est **supprimée** par le store front : tous les gains affichés retombent sur un recalcul local sur le pot théorique | `src/app/stores/matchStore.ts:304-339`, `:393-427` |
| **M2** | Une saison de ligue `cancelled` fait **crasher** `/br-league` et `/br-league/:id` (le type et les libellés du front ignorent ce statut) | `src/features/league/pages/LeaguePage.tsx:78`, `LeagueSeasonPage.tsx:258` |
| **M3** | BR : les parts de cagnotte sont appliquées sur la cagnotte **des gagnants** au lieu de la cagnotte ; le 5ᵉ est payé **plus** que le 4ᵉ, et le front affiche un montant différent du versé | `server/br-engine.mjs:1156-1172` / `src/app/lib/brApi.ts:168-186` |
| **M4** | Les commissions d'arbitre du profil public sont lues sur le champ **figé** `match.arbiterFee` (pot théorique) : V11 n'a été corrigé que côté serveur | `src/lib/profileMetrics.ts:188` |
| **M5** | L'admin tranche un litige sur un montant **recalculé localement**, alors que la projection serveur est disponible et que le commentaire du fichier affirme que ce calcul a été supprimé | `src/app/components/admin/AdminUrgencyTab.tsx:109-110` |

---

## 2. Constats ÉLEVÉE

### M1 — ÉLEVÉE — La projection serveur `projectedPayouts` est supprimée par le store front : tous les gains affichés retombent sur un recalcul local

**Fichiers** : `src/app/stores/matchStore.ts:168-174` (type `Match`), `:304-339` (type
`StoredMatch`), `:393-427` (`normalizeStoredMatch`) · `server/state-helpers.mjs:187` (émission
serveur) · `src/lib/matchPayout.ts:79-96` (consommateurs) · `src/lib/profileMetrics.ts:206`,
`src/lib/communityInsights.ts:427`, `src/app/components/admin/AdminUrgencyTab.tsx:109`,
`src/features/match/pages/MatchDetailPage.tsx:760-762`.

**Preuve.** Le serveur attache la projection à **toutes** les sorties de match :

```js
// server/state-helpers.mjs:187
safe.projectedPayouts = getProjectedPayouts(match);
```

`getProjectedPayouts` (`server/match-engine.mjs:212-241`) calcule la partition sur la cagnotte
**réellement verrouillée** (`getLockedPot`, `:196-204`), et `perWinner` sur le nombre **réel**
de gagnants.

Le type `Match` du front **déclare** le champ (`:168-174`) :

```ts
projectedPayouts?: { basis: number; locked: boolean; arbiterFee: number; winner: number; perWinner: number; };
```

Mais le type `StoredMatch` — celui que reçoit réellement le payload serveur — **ne le déclare
pas** (`:304-339`), et `normalizeStoredMatch` **ne le recopie pas** (`:393-427` : liste
explicite de 30 champs, `projectedPayouts` absent). Le champ est donc **écarté à la
normalisation**, sur les deux chemins d'entrée du store :

- `replaceFromServer` (`:469-479`) — bootstrap HTTP (`src/app/layouts/RootLayout.tsx:43`, `:62`)
  et pages (`TournoisPage`, `LeaguePage`, `LeagueSeasonPage`) ;
- `hydrateFromServer` (`:463-467`) via `mergeMatchesByFreshness` (`:429-455`) — deltas socket
  (`server/state-helpers.mjs:124-127`) et actions (`MatchDetailPage.tsx:95`,
  `AdminDashboardPage.tsx:65`, `CreateMatchPage.tsx:68`).

Conséquence directe : dans `src/lib/matchPayout.ts`, les trois helpers lisent toujours
`undefined` et **retombent sur le chemin de repli** :

```ts
// :80  match.projectedPayouts?.perWinner   → toujours undefined
// :88  match.projectedPayouts?.arbiterFee   → toujours undefined
// :92  if (match.projectedPayouts) ...     → toujours faux
```

Le repli calcule `prizePool - zoydFee - arbiterFee` — c'est-à-dire le pot **théorique**
(`maxPlayers × entryFee`, `server/match-engine.mjs:585`) moins une commission d'arbitre
**figée à la création** (`:601`) — puis divise par `teamSize` (`:82-83`).

**Impact.** Le serveur est la source de vérité, mais elle n'arrive jamais au front. Concrètement :

| Écran | Ce qui est affiché | Ce qui est réellement versé |
|---|---|---|
| Profil public (`profileMetrics.ts:206`) | part = pot théorique × 0,98 ÷ `teamSize` | part = pot **verrouillé** × 0,98 ÷ **nombre réel de gagnants** |
| Classement par gains (`communityInsights.ts:427`) | idem | idem |
| Confirmation de score (`MatchDetailPage.tsx:789`) | « Cagnotte réelle » = `prizePool` | cagnotte réellement bloquée |
| Litiges admin (`AdminUrgencyTab.tsx:109`) | `prizePool − arbiterFee` | idem (voir M5) |

Les deux cas où l'écart est certain : match sans arbitre au moment du règlement (le serveur
ne prélève alors **aucune** commission — `server/match-engine.mjs:215`, `:372` — alors que le
front en retranche 2 %), et match au roster incomplet (`getLockedPot` < `prizePool`).

**Pourquoi les tests ne le voient pas.** `src/lib/profileMetrics.test.ts:28-63` construit un
objet `Match` **littéral** avec `projectedPayouts` (`:56-62`) : le test n exercising jamais
`normalizeStoredMatch`. Le test « V8 » est donc vert sans couvrir le chemin réel.
`server/match-engine.test.mjs:351-410` teste `getProjectedPayouts` côté serveur, ce qui est
juste, mais ne prouve rien sur le trajet HTTP → store.

**Correction.** Déclarer `projectedPayouts` dans `StoredMatch` et le recopier dans
`normalizeStoredMatch` ; ajouter un test de store qui passe par `replaceFromServer` avec un
payload contenant `projectedPayouts`.

---

### M2 — ÉLEVÉE — Une saison de ligue `cancelled` fait crasher `/br-league` et `/br-league/:id`

**Fichiers** : `src/app/stores/leagueStore.ts:22` (type), `:168` (normalisation) ·
`src/features/league/pages/LeaguePage.tsx:62-67` (`STATUS_BADGES`), `:78`, `:94-95` ·
`src/features/league/pages/LeagueSeasonPage.tsx:258`, `:280-281` ·
`src/features/league/components/leagueSeasonConstants.ts:14-19` ·
`server/league-engine.mjs:935` (écriture du statut) · `server/routes/league.mjs:89-98` (diffusion).

**Preuve.** Le serveur écrit `cancelled` sur une saison :

```js
// server/league-engine.mjs:935
season.status = 'cancelled';
```

`GET /api/leagues` renvoie **toutes** les saisons stockées, sans filtre de statut
(`server/routes/league.mjs:89-98`). Le front les stocke via
`replaceFromServer(response.seasons)` (`src/features/league/pages/LeaguePage.tsx:206`), et
`normalizePersistedSeason` conserve le statut tel quel :

```ts
// src/app/stores/leagueStore.ts:168
status: season?.status || 'registering',
```

Mais le type du front **omet** `cancelled` :

```ts
// src/app/stores/leagueStore.ts:22
export type LeagueSeasonStatus = 'registering' | 'qualifying' | 'final' | 'completed';
```

Le type ment sur le domaine, donc TypeScript ne signale rien. Résultat à l'exécution : les
tables de libellés n'ont pas d'entrée pour `cancelled` (`LeaguePage.tsx:62-67`,
`leagueSeasonConstants.ts:14-19`), `STATUS_BADGES[season.status]` vaut `undefined`, et la page
accède à `badge.color` / `badge.label` :

```tsx
// src/features/league/pages/LeaguePage.tsx:78  const badge = STATUS_BADGES[season.status];
// :94  <span className={... ${badge.color}}>     → TypeError: Cannot read properties of undefined
// :95  {badge.label}                              → TypeError
```

Identique sur la page de détail (`LeagueSeasonPage.tsx:258`, `:280-281`).

**Impact.** Une saison annulée (inscriptions insuffisantes à la clôture, ou saison périmée —
`server/cron.mjs:684` appelle `cancelStaleLeagueSeasonOnServer`) fait tomber **la page
entière** `/br-league`, pas seulement sa carte : l'écran des ligues est inaccessible pour tous
les joueurs. Le filtre par onglet (`LeaguePage.tsx:398`) n'aide pas : l'onglet « TOUS » est le
défaut et inclut la saison annulée.

**Correction.** Ajouter `cancelled` au type `LeagueSeasonStatus` (`leagueStore.ts:22`), aux
deux tables de libellés, et à l'onglet de filtre ; ou, à défaut, lire le badge avec un repli
explicite (`STATUS_BADGES[season.status] ?? repli`).

---

### M3 — ÉLEVÉE — BR : les parts sont appliquées sur la cagnotte des gagnants, le 5ᵉ est payé plus que le 4ᵉ, et le front affiche un autre montant

**Fichiers** : `server/br-engine.mjs:1152-1196` (calcul), `:224-256` (validation) ·
`src/app/lib/brApi.ts:168-186` (calcul front) ·
`src/features/br/pages/BrLobbyDetailPage.tsx:168`, `:244-254`, `:263` ·
`server/routes/br.mjs:269-278` (projection serveur) ·
`server/br-engine.test.mjs:30` (défaut de test).

**Preuve.** Le serveur exige que les six taux somment à 100 % **et** que les places soient
décroissantes :

```js
// server/br-engine.mjs:244-255
const total = first + second + third + fourth + fifth + arbiterRate;
if (Math.abs(total - 1) > 1e-6) throw makeError('INVALID_PAYOUT', …);
if (!(first >= second && second >= third && third >= fourth && fourth >= fifth)) {
  throw makeError('INVALID_PAYOUT', 'Les parts doivent etre decroissantes du 1er au 5e.');
}
```

La répartition par défaut du serveur est `40 / 22 / 13 / 12 / 8` + `5` d'arbitre
(`server/br-engine.mjs:117-119`). Les taux sont donc des **pourcentages de la cagnotte**.

Mais le règlement les applique sur la cagnotte **des gagnants** :

```js
// server/br-engine.mjs:1156
const winnersPool = roundAmount(pot * (1 - arbiterRate));
// :1169-1171
const amount = i === lastIndex
  ? roundAmount(winnersPool - distributed)      // la dernière place absorbe le reste
  : roundAmount(winnersPool * shares[i]);        // les autres : taux × cagnotte des gagnants
```

Avec le défaut de production, sur une cagnotte de 100 000 ZC :

| Place | Configuré | Payé par le serveur | Affiché par le front |
|---|---|---|---|
| 1ᵉʳ | 40 % → 40 000 | 0,95 × 40 % = **38 000** | 38 000 |
| 2ᵉ | 22 % → 22 000 | **20 900** | 20 900 |
| 3ᵉ | 13 % → 13 000 | **12 350** | 12 350 |
| 4ᵉ | 12 % → 12 000 | **11 400** | 11 400 |
| 5ᵉ | 8 % → 8 000 | 95 000 − 82 650 = **12 350** | 0,95 × 8 % = **7 600** |

Deux conséquences :

1. **La règle de décroissance que le serveur valide lui-même est violée au moment du
   versement** : le 5ᵉ (12 350) reçoit plus que le 4ᵉ (11 400).
2. **Le front et le serveur n'affichent pas le même montant** : `splitBrPayout`
   (`src/app/lib/brApi.ts:168-186`) applique `winnersPool * rate` pour les cinq places, donc
   7 600 ZC pour le 5ᵉ, alors que le serveur verse 12 350 ZC. Le même écran affiche un
   montant que personne ne recevra. La projection autoritaire est pourtant livrée dans la même
   réponse (`server/routes/br.mjs:274-277`) et n'est pas utilisée sur cette page — elle l'est
   dans le panneau arbitre (`src/features/br/components/BrArbiterPanel.tsx:555-558`), ce qui
   donne deux chiffres différents sur deux écrans du même salon.

**Pourquoi les tests ne le voient pas.** `server/br-engine.test.mjs:30` utilise un
`defaultPayout` de test `{ first: 0.4, second: 0.22, third: 0.15, fourth: 0.12, fifth: 0.08,
arbiterRate: 0.03 }`, qui **n'est pas** `BR_DEFAULT_PAYOUT` (`0.13` au 3ᵉ, `0.05` d'arbitre).
La répartition réellement appliquée en production n'est jamais exercée. Aucun test ne vérifie
le montant du 5ᵉ : `server/br-engine.test.mjs:691-697` ne contrôle que « le 1ᵉ est mieux payé
que le 5ᵉ ».

**Correction.** Appliquer les taux au **pot** (`pot * shares[i]`, la somme des cinq parts
valant 95 % = `pot − pot × arbiterRate`) et absorber l'arrondi sur une seule place ; ou, si
l'intention est d'appliquer les taux à la cagnotte des gagnants, le dire dans
`validateBrPayout` et aligner `BR_DEFAULT_PAYOUT` en conséquence. Dans les deux cas, le front
doit lire `projectedPayouts.payouts` au lieu de `splitBrPayout`.

---

### M4 — ÉLEVÉE — Les commissions d'arbitre du profil public sont lues sur le champ figé `match.arbiterFee`

**Fichiers** : `src/lib/profileMetrics.ts:185-190` · `server/match-engine.mjs:601`, `:372-373`,
`:484-511` · `server/commission-stats.mjs:1-21`, `:29-65` · `server/persistence.mjs:1589`.

**Preuve.** Le front cumule le champ figé :

```ts
// src/lib/profileMetrics.ts:186-188
if (isTargetArbiterInMatch(match, target) && (match.status === 'finished' || match.status === 'disputed') && match.result) {
  arbitratedMatches += 1;
  totalCommissions += match.arbiterFee;   // ← champ figé à la création
}
```

`match.arbiterFee` est écrit **une seule fois**, à la création du match, sur le pot
théorique :

```js
// server/match-engine.mjs:601
arbiterFee: roundAmount(prizePool * 0.02),
```

et n'est **jamais** réécrit au règlement, qui calcule la commission sur la cagnotte
réellement verrouillée dans une variable locale (`:372`) :

```js
const arbiterFee = match.arbiter?.userId ? roundAmount(lockedPot * ARBITER_FEE_RATE) : 0;
```

C'est exactement le défaut décrit dans l'en-tête du module créé pour le corriger côté serveur :

```js
// server/commission-stats.mjs:7-13
// La statistique « commissions » du dashboard admin additionnait
// `match.arbiterFee` : un champ FIGE a la creation sur le pot THEORIQUE …
```

Le serveur a été corrigé (`server/persistence.mjs:1589` lit désormais les transactions via
`sumCommissionTransactions`). **Le front, non.**

**Impact.** La carte « commissions d'arbitre » d'un profil **public** annonce un montant
supérieur au versé dès que le roster était incomplet (pot verrouillé < pot théorique) ou
qu'il n'y avait pas d'arbitre (commission réellement versée : 0, champ figé : 2 % du pot
théorique). L'écart est public et cumulatif sur l'historique d'un joueur.

**Correction.** Lire `getArbiterFee(match)` (`src/lib/matchPayout.ts:87-88`), qui privilégie
`projectedPayouts.arbiterFee` — donc M1 doit être corrigé d'abord ; à défaut, ne rien
afficher tant que la projection serveur n'est pas disponible.

---

### M5 — ÉLEVÉE — L'admin tranche un litige sur un montant recalculé localement

**Fichiers** : `src/app/components/admin/AdminUrgencyTab.tsx:105-110`, `:231`, `:249` ·
`src/app/pages/AdminDashboardPage.tsx:64` (source des matchs) ·
`src/app/stores/matchStore.ts:393-427` (perte de la projection, voir M1).

**Preuve.** Le commentaire du fichier annonce que le calcul local a été supprimé :

```tsx
// src/app/components/admin/AdminUrgencyTab.tsx:105-108
// Montant autoritaire fourni par le serveur (cagnotte reellement
// verrouillee - commission d'arbitre). Le `* 0.98` local ignorait la
// commission d'arbitre et le roster incomplet : l'admin confirmait un
// montant different de celui reellement verse.
```

Mais le repli juste en dessous fait précisément ce que le commentaire décrit :

```tsx
// :109-110
const winnerShare = match.projectedPayouts?.winner
  ?? Math.max(0, Number(match.prizePool || 0) - Number(match.arbiterFee || 0));
```

`match.projectedPayouts` vaut toujours `undefined` (M1 : le champ est écarté par
`normalizeStoredMatch`), donc le repli est le **chemin réel**, pas une sécurité. Le montant
affiché au bouton de résolution (`'Confirmer Alpha — ' + formatZC(winnerShare)`, `:231`) est
le pot théorique moins la commission figée.

**Impact.** L'administrateur valide un litige en annonçant aux deux équipes un montant qui
ne sera pas celui du règlement. La décision d'admin est celle qui déclenche
`applyResultSettlement` (`server/match-engine.mjs:1311-1318`) : l'écart est constaté au
versement.

**Correction.** Rendre `projectedPayouts` disponible (M1) et supprimer le repli ; à défaut,
ne pas afficher de montant tant que la projection est absente, plutôt que d'afficher un
calcul local présenté comme autoritaire.

---

## 3. Constats MOYENNE

### M6 — MOYENNE — Deux référentiels de rangs incompatibles pour `rankMJ` / `rankBR`

**Fichiers** : `src/lib/competition.ts:19-27` · `src/app/pages/ParametresPage.tsx:37`, `:519`,
`:522`, `:525`, `:528` · `server/routes/auth.mjs:398`, `:406-409` ·
`server/match-engine.mjs:325-332`.

**Preuve.** Le front propose `CODM_RANKS` pour « Rank MJ » et « Rank BR » :

```ts
// src/lib/competition.ts:19-27
export const CODM_RANGS = ['Rookie','Veteran','Elite','Pro','Master','Grandmaster','Legendary'] as const;
```

Le serveur n'en accepte que 8, dont 3 communs :

```js
// server/routes/auth.mjs:398
const RANK_VALUES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Legendary', 'Rookie'];
// :406-409 → 400 INVALID_ENUM « Rang invalide pour rankMJ »
```

`'Veteran'`, `'Elite'`, `'Pro'` et `'Grandmaster'` sont refusés. Le joueur choisit « Elite »
dans les paramètres → `PATCH /api/auth/me` renvoie 400 et rien n'est enregistré.

Le champ est de surcroît alimenté par un **deuxième** référentiel, disjoint : le serveur
écrit `user.rankMJ = getRankFromElo(...)` ∈ {Bronze, Silver, Gold, Platinum, Diamond, Master}
(`server/match-engine.mjs:325-332`, `:446`, `:469`), valeurs que le front ne propose jamais.

**Impact.** Échec d'enregistrement visible par l'utilisateur, et un champ unique (`rankMJ`)
dont la valeur dépend de deux référentiels disjoints selon qui l'écrit.

**Correction.** Une seule table de rangs partagée (`shared/`), importée par le serveur et le
front ; ou le serveur valide la liste du front au lieu de la sienne.

---

### M7 — MOYENNE — `CreateMatchPage` annonce 2 % d'arbitre en dur, même sans arbitre

**Fichiers** : `src/app/pages/mj/CreateMatchPage.tsx:40`, `:106-108`, `:441-445`, `:571-578` ·
`server/match-engine.mjs:186`, `:215`, `:372`.

**Preuve.** Le front duplique le taux et l'applique inconditionnellement :

```ts
// src/app/pages/mj/CreateMatchPage.tsx:40
const ARBITER_FEE_RATE = 0.02;
// :107-108
const arbiterShare = useMemo(() => livePot * ARBITER_FEE_RATE, [livePot]);
const winnerShare = useMemo(() => Math.max(0, livePot - arbiterShare), [arbiterShare, livePot]);
```

Affiché à la création (`:441-445`) et dans le récapitulatif de publication (`:571-578`).

Le serveur ne prélève que s'il y a un arbitre :

```js
// server/match-engine.mjs:215
const arbiterFee = match.arbiter?.userId ? roundAmount(basis * ARBITER_FEE_RATE) : 0;
```

À la création du match, il n'y a pas d'arbitre : le champ `match.arbiterFee` est figé à
`prizePool × 0.02` (`:601`) quoi qu'il arrive, et le règlement ne retiendra rien si aucun
arbitre ne se designate.

**Impact.** Le joueur est annoncé une commission d'arbitre de 2 % du pot sur un match qui
n'en aura pas, et une « part vainqueur » inférieure d'autant. Le taux est de plus écrit en
littéral au lieu de reprendre une constante serveur.

**Correction.** Reprendre le taux depuis la politique publiée par le serveur (comme le fait
`withdrawalFeeRate` pour le retrait, `src/app/stores/walletStore.ts:106`), et n'afficher la
part d'arbitre que s'il y a un arbitre.

---

### M8 — MOYENNE — `HubMJPage` : liste de statuts locale, dupliquée dans le fichier, sans `archived`

**Fichiers** : `src/app/pages/mj/HubMJPage.tsx:56`, `:72` ·
`shared/match-status.json` (`CLOSED`) · `src/app/lib/matchStatus.ts:48` ·
`server/match-status-consistency.test.mjs:64-74`.

**Preuve.** La liste apparaît **deux fois** dans le même fichier, sous forme littérale :

```ts
// src/app/pages/mj/HubMJPage.tsx:56 (filtre « besoin d'un arbitre »)
baseMatches.filter((m) => !m.arbiter && m.status !== 'finished' && m.status !== 'cancelled'
  && m.status !== 'forfeited' && m.status !== 'awaiting_confirmation');
// :72 (compteur « arbitresNeeded ») — liste identique, recopiée
```

`CLOSED_STATUSES` existe (`src/app/lib/matchStatus.ts:48`, importé par
`src/app/stores/matchStore.ts:29`) et n'est pas utilisé ici. La source unique classe
`archived` comme **clos** (`shared/match-status.json`), la liste locale l'ignore : un match
archivé reste compté comme « match vivant qui cherche un arbitre ».

La garde `server/match-status-consistency.test.mjs` existe pour empêcher exactement cela,
mais son périmètre est **cadré sur 9 fichiers** (`:64-74`) qui ne comprend pas `HubMJPage.tsx`.

**Impact.** Compteur « matchs actifs » et compteur « arbitres nécessaires » faussés dès qu'un
match est archivé par le cron.

**Correction.** Utiliser `CLOSED_STATUSES` dans les deux filtres, et ajouter
`src/app/pages/mj/HubMJPage.tsx` (et `src/lib/communityInsights.ts`, `src/app/components/admin/AdminTabShared.tsx`)
au périmètre de la garde.

---

### M9 — MOYENNE — `communityInsights` : liste de statuts locale pour les « matchs opérationnels »

**Fichiers** : `src/lib/communityInsights.ts:635` · `src/app/lib/matchStatus.ts:48`.

**Preuve.**

```ts
// src/lib/communityInsights.ts:635
const operationalMatches = matches.filter((match) => !['finished', 'cancelled', 'forfeited', 'awaiting_confirmation'].includes(match.status));
```

Divergence avec la source unique (`shared/match-status.json`) :

- `archived` est **clos** côté serveur, absent de la liste locale → un match archivé est compté
  comme « opérationnel » ;
- `awaiting_confirmation` est **actif** côté serveur (`ACTIVE`), présent dans la liste locale
  → un match en attente de confirmation n'est pas compté comme opérationnel ;
- `disputed` n'est ni actif ni clos côté serveur, et n'est pas filtré ici.

**Impact.** Le compteur « matchs opérationnels » du tableau de bord admin ne correspond à
aucune des deux définitions officielles.

**Correction.** Utiliser `CLOSED_STATUSES` / `ACTIVE_STATUSES` (importables depuis
`src/app/lib/matchStatus.ts`), comme le fait `src/app/pages/AdminDashboardPage.tsx:229-231`.

---

### M10 — MOYENNE — Les tables de libellés admin ne couvrent pas `awaiting_arbiter` ni `archived`, alors que l'invariant du fichier l'exige

**Fichiers** : `src/app/components/admin/AdminTabShared.tsx:8-10` (invariant), `:22-33`
(`statusToneMap`), `:35-46` (`statusLabelFR`).

**Preuve.** L'en-tête du fichier pose la règle :

```
 * INVARIANT : la tonalite par statut doit couvrir TOUS les statuts de match,
 * `awaiting_arbiter` compris. Un statut absent s'affiche avec la valeur par
 * defaut, sans signal visuel.
```

Les deux tables s'arrêtent à `forfeited` : ni `awaiting_arbiter`, ni `archived` n'y figurent.
C'est le cas explicément nommé par l'invariant.

**Impact.** Un match en attente d'arbitre — le match qu'un admin peut arbitrer lui-même, et
qu'il ne voit pas non plus dans la file de priorité (`src/app/lib/matchStatus.ts:69-75` la
corrige, mais la table de libellés non) — s'affiche sans signal visuel et sans libellé.

**Correction.** Ajouter `awaiting_arbiter` et `archived` aux deux tables, et faire échouer un
test qui compare les clés des tables à `ALL_MATCH_STATUSES`.

---

### M11 — MOYENNE — `LIVE_IDENTITY_STATUSES` contredit son propre commentaire et gèle le pseudo avant la soumission du résultat

**Fichiers** : `server/state-helpers.mjs:131-142`, `:170-182` ·
`server/match-engine.mjs:61` (délai d'arbitrage).

**Preuve.** Le commentaire pose la frontière sur la soumission du résultat :

```
 * La frontiere est posee sur la soumission du resultat : tant que le match n'est
 * pas fini, l'arbitre doit savoir qui a gagne sous le nom que le joueur porte
 * MAINTENANT. A partir de `awaiting_confirmation`, le resultat est gele …
```

La liste s'arrête à `in_progress` :

```js
// server/state-helpers.mjs:140-142
const LIVE_IDENTITY_STATUSES = new Set([
  'recruiting', 'full', 'check_in', 'ready', 'in_progress',
]);
```

Un match en `awaiting_arbiter` n'y figure pas : le pseudo affiché est celui du snapshot
(`:171-182`), pas celui du compte. `awaiting_arbiter` peut durer **2 h**
(`server/match-engine.mjs:61`, `ARBITER_DEADLINE_PHASE_A_MS`).

C'est la **quatrième** liste de statuts du dépôt, hors `shared/match-status.json`.

**Impact.** Un joueur qui se renomme pendant l'attente d'arbitre est vu par l'arbitre sous
son ancien pseudo, pendant toute la phase d'attente.

**Correction.** Inclure `awaiting_arbiter` dans la liste, ou dériver la liste de
`shared/match-status.json`.

---

### M12 — MOYENNE — `leagueStore` transforme un pass à 0 en 50 et duplique `LEAGUE_MAX_PLAYERS`

**Fichiers** : `src/app/stores/leagueStore.ts:169`, `:170` ·
`server/league-engine.mjs:52-53`, `:1045` · `src/features/league/pages/LeagueSeasonPage.tsx:323`.

**Preuve.**

```ts
// src/app/stores/leagueStore.ts:169
entryFee: Number(season?.entryFee || 50),
```

Le serveur autorise un pass à 0 (`server/league-engine.mjs:1045` : `newFee < 0` est le seul
refus). `0 || 50` → 50. Le front affiche donc « S'inscrire — 50 ZC »
(`src/features/league/pages/LeagueSeasonPage.tsx:323`) là où le serveur ne prélève rien.

La ligne suivante duplique une constante serveur :

```ts
// :170
maxPlayers: Number(season?.maxPlayers || 500),   // serveur : LEAGUE_MAX_PLAYERS = 500
```

**Impact.** Prix affiché ≠ prix prélevé. Aucune somme ne bouge, mais l'écran ment sur le
tarif.

**Correction.** `Number(season?.entryFee ?? 50)` (et `??` de même pour `maxPlayers`), ou
supprimer les valeurs par défaut puisque le serveur envoie toujours les champs.

---

### M13 — MOYENNE — La répartition de podium d'un tournoi est recalculée par le front

**Fichiers** : `src/app/stores/tournamentStore.ts:207-225`, `:259` ·
`server/tournament-engine.mjs:67-80`, `:158`.

**Preuve.** Le front **remplace** la répartition envoyée par le serveur :

```ts
// src/app/stores/tournamentStore.ts:207-225 (identique à server/tournament-engine.mjs:67-80)
const buildPayout = (entryFee, entriesCount, arbitersNeeded, teamSize = 1) => {
  const grossPool = roundAmount(entryFee * entriesCount * teamSize);
  const arbiterRate = arbitersNeeded === 2 ? 0.1 : 0.05;
  ...
  first: roundAmount(playerPool * 0.5), second: … * 0.3, third: … * 0.2,
};
// :259
payout: buildPayout(Number(tournament?.entryFee || 0), entries.length, arbitersNeeded, teamSize),
```

Les deux implémentations sont identiques **à ce jour** (vérifié ligne à ligne). Le serveur
recalcule d'ailleurs la même chose à chaque normalisation (`server/tournament-engine.mjs:158`,
commentaire `:30-31` : « `buildPayout` est recalcule a chaque normalisation »).

**Impact.** Aucun aujourd'hui, mais toute évolution de la règle serveur (taux d'arbitre,
partage du podium) divergera silencieusement : le front affichera un podium différent de
celui versé, et `profileMetrics.ts:127-134` / `communityInsights.ts:89-94` en déduisent les
gains de tournoi affichés publiquement.

**Correction.** Conserver `tournament.payout` tel que le serveur l'envoie (ne le recalculer
que si le champ est absent).

---

### M14 — MOYENNE — La répartition BR par défaut et les bornes de pass sont dupliquées du serveur

**Fichiers** : `src/features/br/components/BrLobbyCreatePanel.tsx:41-42`, `:53-55` ·
`server/br-engine.mjs:117-119`, `:157-158`.

**Preuve.** Deux copies littérales du même objet :

```ts
// src/features/br/components/BrLobbyCreatePanel.tsx:53-55
const DEFAULT_PAYOUT: BrPayout = {
  first: 0.4, second: 0.22, third: 0.13, fourth: 0.12, fifth: 0.08, arbiterRate: 0.05,
};
// server/br-engine.mjs:117-119 — BR_DEFAULT_PAYOUT, mêmes valeurs
```

Le code reconnaît lui-même le risque :

```
 * Meme choix que `BR_DEFAULT_PAYOUT` cote serveur. Les deux defauts avaient
 * derive (13/5 ici, 15/3 la-bas) … Une seule reference, sinon ca diverge a
 * nouveau au prochain ajustement.
```

Il a effectivement divergé une fois (le commentaire le dit). Les bornes de pass
(`ENTRY_FEE_MIN = 10`, `ENTRY_FEE_MAX = 500`, `:41-42`) dupliquent
`BR_ENTRY_FEE_MIN` / `BR_ENTRY_FEE_MAX` (`server/br-engine.mjs:157-158`).

**Impact.** Un ajustement du défaut serveur ne se répercute pas sur le formulaire admin : le
formulaire propose une répartition que le serveur refuse (`INVALID_PAYOUT`), et
l'admin doit le deviner.

**Correction.** Exposer `BR_DEFAULT_PAYOUT` dans `GET /api/br/config` (comme
`arbiterMaxRate`, `BR_MAPS`, `BR_MODES` le sont déjà) et l'utiliser côté front.

---

### M15 — MOYENNE — ELO par défaut : 1000 sur le tableau de bord, 1200 partout ailleurs

**Fichiers** : `src/app/pages/DashboardPage.tsx:584` · `src/lib/profileMetrics.ts:227` ·
`src/lib/communityInsights.ts:224`, `:365` · `server/match-engine.mjs:385` ·
`server/persistence.mjs` (valeur par défaut du compte).

**Preuve.**

```tsx
// src/app/pages/DashboardPage.tsx:584
<div ...>{user.stats?.elo || 1000}</div>
```

Le serveur, le profil public et le classement utilisent **1200** :
`user?.stats?.elo || 1200` (`server/match-engine.mjs:385`),
`elo: fallbackStats?.elo ?? 1200` (`src/lib/profileMetrics.ts:227`),
`elo: details?.elo ?? 1200` (`src/lib/communityInsights.ts:224`, `:365`).

**Impact.** Un compte sans ELO persisté affiche 1000 sur son tableau de bord et 1200 sur son
profil public et dans le classement « TOP ELO ». Deux valeurs pour la même grandeur sur deux
écrans.

**Correction.** Aligner la valeur par défaut (1200) — ou, mieux, la publier comme la
politique serveur le fait pour le taux de retrait.

---

### M16 — MOYENNE — `socketConnectionStore` définit une liste locale baptisée `ACTIVE_STATUSES`

**Fichiers** : `src/app/stores/socketConnectionStore.ts:106`, `:277`, `:293-299` ·
`src/app/lib/matchStatus.ts:45`.

**Preuve.**

```ts
// src/app/stores/socketConnectionStore.ts:106
const ACTIVE_STATUSES: Match['status'][] = ['check_in', 'ready', 'in_progress'];
```

Le nom est celui de la source unique importée ailleurs (`src/app/lib/matchStatus.ts:45`), mais
le contenu n'a rien à voir : c'est une condition d'action (rappeler le check-in), pas une
classification. Le fichier n'importe pas la source unique.

Le même fichier utilise par ailleurs une liste littérale de statuts clos (`:296-298` :
`'finished'`, `'forfeited'`, `'cancelled'`) sans `archived`.

**Impact.** Le rappel « check-in » n'est pas envoyé pour un match en `awaiting_arbiter` ni
en `awaiting_confirmation` ; un salon publié sur un match archivé déclenche encore une
notification.

**Correction.** Renommer la constante (`CHECK_IN_STATUSES`) et utiliser `CLOSED_STATUSES`
pour le test de `:296-298`.

---

### M17 — MOYENNE — `DAY_KEYS` existe en trois exemplaires

**Fichiers** : `server/league-engine.mjs:90` · `src/features/league/components/leagueSeasonConstants.ts:4` ·
`src/app/stores/leagueStore.ts:151`.

**Preuve.** Les trois listes portent exactement les mêmes cinq jours :

```js
// server/league-engine.mjs:90
const DAY_KEYS = ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// src/features/league/components/leagueSeasonConstants.ts:4
export const DAY_KEYS: LeagueDayKey[] = ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// src/app/stores/leagueStore.ts:151
const DAY_KEYS: LeagueDayKey[] = ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
```

Le fichier `leagueSeasonConstants.ts` existe précisément pour centraliser cette liste, et
son en-tête le dit (`QualificationPanel.tsx:15` : « la liste DAY_KEYS sert a plusieurs
composants : la modifier … »). `leagueStore.ts` en fait une copie locale — le 13ᵉ fichier qui
ne suit pas la convention.

**Impact.** Aucun aujourd'hui (les trois listes concordent). Une journée ajoutée ou retirée
d'un côté laisse l'autre désynchronisé, et le serveur refuse (`INVALID_DAY`,
`server/league-engine.mjs:467`, `:497`, `:1088`).

**Correction.** Source partagée (comme `shared/match-status.json`), ou suppression de la copie
dans `leagueStore.ts` au profit de `leagueSeasonConstants.ts`.

---

### M18 — MOYENNE — Deux tables pays → ISO, avec des valeurs divergentes

**Fichiers** : `src/lib/competition.ts:64-75` · `src/lib/communityInsights.ts:32-43`.

**Preuve.**

```ts
// src/lib/competition.ts:64-75 (pays → ISO pour Codashop)
export const COUNTRY_TO_ISO = { Benin: 'BJ', "Cote d'Ivoire": 'CI', …, Autre: 'BJ' };
// src/lib/communityInsights.ts:32-43 (pays → code affiché)
const countryCodeMap = { Benin: 'BJ', "Cote d'Ivoire": 'CI', …, Autre: '--' };
```

Les huit pays ont la même correspondance, mais `'Autre'` vaut `'BJ'` dans une table et `'--'`
dans l'autre. La seconde table a en plus un repli (`getCountryCode`, `:124-127`) qui tronque
le nom du pays à deux caractères en majuscules — une troisième règle.

**Impact.** Divergence already present on the value `'Autre'`. Any new country added to one
table is missing from the other.

**Correction.** One table, imported by both.

---

### M19 — MOYENNE — Règle de podium du tournoi dupliquée côté front

**Fichiers** : `src/lib/profileMetrics.ts:127-134` · `src/lib/communityInsights.ts:89-94` ·
`server/tournament-engine.mjs:620-628`.

**Preuve.** Les deux fichiers du front réimplémentent le choix du montant par place :

```ts
// src/lib/profileMetrics.ts:127-134
const payout = entry.finalPlacement === 1 ? tournament.payout.first
  : entry.finalPlacement === 2 ? tournament.payout.second
  : entry.finalPlacement === 3 ? tournament.payout.third : 0;
```

alors que le serveur expose déjà `tournament.payout` (`server/tournament-engine.mjs:620-628`
utilise exactement les mêmes clés).

**Impact.** Aucune divergence aujourd'hui. Mais ces montants alimentent les **gains publics**
du profil et le classement par gains : une évolution de la règle serveur (place 4ᵉ payée,
forfait payé, parité) ne se répercute pas sur l'affichage.

**Correction.** Extraire un helper commun (`payoutForPlacement`), aligné sur le serveur.

---

### M20 — MOYENNE — `getWinnerPayout` existe en deux versions, sur deux bases différentes

**Fichiers** : `src/lib/matchPayout.ts:91-96` · `server/match-engine.mjs:183` ·
`server/match-engine.test.mjs:322-349`.

**Preuve.**

```js
// server/match-engine.mjs:183 — export, référencé uniquement par un test
export const getWinnerPayout = (match) => Math.max(0, roundAmount(match.prizePool - match.zoydFee - match.arbiterFee));
```

```ts
// src/lib/matchPayout.ts:91-96 — même formule
export const getWinnerPayout = (match: PayoutMatch): number => {
  if (match.projectedPayouts) return roundAmount(match.projectedPayouts.winner);
  return roundAmount(Math.max(0, Number(match.prizePool || 0) - Number(match.zoydFee || 0) - Number(match.arbiterFee || 0)));
};
```

La formule de repli est identique des deux côtés — et c'est cette formule qui est **active**
de fait (M1). Elle est fausse du point de vue du règlement (pot théorique au lieu du pot
verrouillé ; commission prélevée même sans arbitre). La version serveur n'est utilisée que par
`server/match-engine.test.mjs:322-349`, qui fige des valeurs calculées sur des objets
fabriqués à la main (`prizePool: 100, zoydFee: 5, arbiterFee: 2` → 93).

**Impact.** Un test vert qui certifie un calcul que rien n'utilise en production, et deux
copies d'une règle de partition qui peuvent diverger.

**Correction.** Supprimer l'export serveur (non utilisé hors test) et faire porter le calcul
par la projection serveur (M1).

---

## 4. Constats FAIBLE

### M21 — FAIBLE — Ternaire à branches identiques dans `getStatusFromMatch` (V14, non corrigé)

`server/match-engine.mjs:292` : `return match.arbiter ? 'ready' : 'ready';`
Les deux branches sont identiques ; la ligne est de surcroît redondante avec le garde
`:282` (`if (!match.arbiter?.userId) return 'awaiting_arbiter';`).
**Impact** : aucun. **Correction** : `return 'ready';`.

### M22 — FAIBLE — Ternaire à branches identiques sur le statut d'un résultat soumis

`server/match-engine.mjs:1004` :
`match.status = fullResult.resolutionType === 'forfeit' ? 'awaiting_confirmation' : 'awaiting_confirmation';`
**Impact** : aucun (les deux branches sont bien le même statut). **Correction** : affectation
directe.

### M23 — FAIBLE — Affectation sans effet

`server/match-engine.mjs:1375` : `match.result = match.result || undefined;`
`match.result` vaut `undefined` ou un objet truthy : l'affectation ne change rien.
**Impact** : aucun. **Correction** : supprimer la ligne.

### M24 — FAIBLE — `isInstantNoArbiter` est inatteignable (V15, non corrigé)

`server/match-engine.mjs:965` : `const isInstantNoArbiter = !match.arbiter && match.isInstant;`
Pour atteindre cette ligne, il faut avoir passé le garde `:931` (`isArbiter` ou rôle admin) :
- si l'acteur est l'arbitre, `match.arbiter` existe → `isInstantNoArbiter === false` ;
- si l'acteur est admin, `isAdminOverride === true` (`:943`) → le garde `:966-967` neutralise
  déjà le cas, et le garde `:975` est court-circuité par `!isAdminOverride`.

Le garde `:975-977` (`PROOFS_REQUIRED` pour match instantané sans arbitre) est donc
**inatteignable**. **Impact** : aucun (le garde est redondant, pas manquant).
**Correction** : supprimer `isInstantNoArbiter` et le garde `:975`.

### M25 — FAIBLE — `getMatchActivityForUser` est toujours du code mort (V13, non corrigé)

`server/match-engine.mjs:1658-1669`. Recherche exhaustive sur tout le dépôt (tests
inclus) : **aucune occurrence** hors la définition et le commentaire `server/match-engine.mjs:8`.
Le comportement équivalent vit côté front (`src/app/stores/matchStore.ts:512-524`).
**Impact** : aucun. **Correction** : supprimer la fonction.

### M26 — FAIBLE — `LEAGUE_PLAYERS_PER_DAY` est dérivée mais toujours sans effet (V12)

`server/league-engine.mjs:67`. Seules occurrences : la définition et
`server/league-engine.test.mjs:846` (une assertion). **Aucun plafond par journée n'est
appliqué** dans le moteur : l'impact décrit par `docs/05-invariants.md:1067-1069` subsiste.
**Impact** : aucun contrôle effectif ; le constant existe mais ne borne rien.
**Correction** : l'appliquer dans `assignPlayersToDays`, ou le supprimer.

### M27 — FAIBLE — Le taux de commission d'arbitre est écrit en littéral là où une constante existe

`server/match-engine.mjs:601` : `arbiterFee: roundAmount(prizePool * 0.02)` alors que
`ARBITER_FEE_RATE = 0.02` est défini `:186` et utilisé `:215` et `:372`.
**Impact** : un changement du taux ne toucherait pas le champ figé — exactement la
divergence que M4 exploite. **Correction** : `ARBITER_FEE_RATE`.

### M28 — FAIBLE — Exports jamais importés, des deux côtés du canal de statuts

`server/match-status.mjs:57` (`ALL_MATCH_STATUSES`), `:64` (`isActiveStatus`), `:72`
(`isClosedStatus`) · `src/app/lib/matchStatus.ts:54`, `:81`, `:89`.
Recherche exhaustive : aucune occurrence hors définition. Le front duplique donc les deux
helpers du serveur sans les importer.
**Impact** : bruit. **Correction** : supprimer, ou importer réellement.

### M29 — FAIBLE — Import inutilisé

`server/routes/wallet.mjs:88` : `import { getPublicMatchesForUser } from '../match-engine.mjs';`
Seule occurrence dans le fichier : l'import lui-même. **Impact** : bruit.
**Correction** : supprimer l'import.

### M30 — FAIBLE — Exports front jamais importés

Recherche exhaustive sur tout le dépôt (tests compris) :

| Fichier:ligne | Export |
|---|---|
| `src/app/lib/leagueApi.ts:68` | `submitServerLeagueDayResults` |
| `src/app/lib/leagueApi.ts:87` | `fetchServerLeagueLeaderboard` |
| `src/app/lib/logger.ts:76` | `logInfo` |
| `src/app/lib/walletApi.ts:138` | `resetPendingWithdrawalKey` |
| `src/app/stores/notificationStore.ts:260` | `selectActiveNotifications` |
| `src/app/stores/trustScoreStore.ts:103` | `categoryIcons` |
| `src/lib/utils.ts:70` | `getInitials` |
| `src/lib/competition.ts:29` | `CODM_RANG_SHOWCASE` |
| `src/lib/competition.ts:83` | `MAX_TEAM_SIZE` (le serveur a le sien : `server/match-engine.mjs:146`) |
| `src/lib/codmWeaponData.ts:247` | `ATTACHMENT_SLOTS` |
| `src/lib/codmWeaponData.ts:248` | `PERK_SLOTS` |
| `src/lib/codmWeaponData.ts:251` | `TOTAL_ATTACHMENTS` |
| `src/lib/codmWeaponData.ts:252` | `TOTAL_PERKS` |
| `src/lib/codmWeaponData.ts:254` | `getWeaponCountByCategory` |
| `src/lib/codmApi.ts:63` | `fetchCODMPlayer` |
| `src/lib/codmApi.ts:118` | `fetchCODMStoreBundles` |

**Impact** : bruit, à une exception près : `src/lib/competition.ts:83` (`MAX_TEAM_SIZE = 5`)
est le doublon d'une constante serveur ; il n'est pas utilisé, mais il donne l'illusion
d'être la borne de format de match. **Correction** : supprimer, ou importer.

### M31 — FAIBLE — 23 composants `ui/` jamais importés

`src/app/components/ui/` : `Accordion`, `AlertDialog`, `AspectRatio`, `Avatar`, `Breadcrumb`,
`Chart`, `Checkbox`, `Collapsible`, `ContextMenu`, `Dialog`, `DropdownMenu`, `HoverCard`,
`Menubar`, `NavigationMenu`, `Pagination`, `Popover`, `RadioGroup`, `ScrollArea`, `Select`,
`Slider`, `Switch`, `Textarea`, `ToggleGroup`.
Recherche exhaustive : aucun import depuis un autre fichier.
**Impact** : bruit (bibliothèque de design embarquée, jamais utilisée).
**Correction** : suppression, ou déclaration explicite « non utilisé ».

### M32 — FAIBLE — Trois composants applicatifs jamais importés

`src/app/components/CountdownTimer.tsx` · `src/app/components/LiveTicker.tsx` ·
`src/app/components/figma/ImageWithFallback.tsx`.
Aucun import dans le dépôt. `PROJECT_README.md:171` annonce pourtant « `[x] LiveTicker pour
matchs en cours »` comme une fonctionnalité livrée.
**Impact** : bruit, plus une affirmation fausse dans le README.
**Correction** : supprimer, ou brancher.

### M33 — FAIBLE — En-tête de fichier faux : `matchStore.ts` décrit l'état *avant* V3

`src/app/stores/matchStore.ts:11-14` :
```
 * INVARIANT : ACTIVE_STATUSES = recruiting, full, check_in, ready,
 * in_progress, awaiting_confirmation. `awaiting_arbiter` en est ABSENT : un
 * match vivant sans arbitre n'apparait donc pas dans les matchs actifs.
```
C'est faux : le fichier importe la source unique (`:29`), qui inclut `awaiting_arbiter`
(`shared/match-status.json`, `ACTIVE`).
**Impact** : un lecteur qui se fie à l'en-tête croira que le bug V3 est présent.
**Correction** : réécrire l'en-tête sur la source unique.

### M34 — FAIBLE — `docs/02-modele-metier.md` décrit une liste de statuts périmée

`docs/02-modele-metier.md:208` :
`| ACTIVE_STATUSES | server/match-engine.mjs:102 | recruiting, full, check_in, ready, in_progress, awaiting_confirmation |`
`docs/02-modele-metier.md:215` : `- awaiting_arbiter ∉ ACTIVE_STATUSES (V3) ;`
Les deux affirmations sont fausses : la liste vit dans `shared/match-status.json` et
`awaiting_arbiter` y est actif. L'emplacement cité (`:102`) ne contient plus rien de tel.
**Impact** : le document de référence du modèle métier décrit l'état avant le correctif.
**Correction** : pointer `shared/match-status.json` / `server/match-status.mjs:48`.

### M35 — FAIBLE — `docs/05-invariants.md` : « les quinze constats sont traités »

`docs/05-invariants.md:1195` : « **Aucun.** Les quinze constats (V1 a V15) sont traites. »
Faux sur trois points :

- **V5 / V8** sont déclarés ✅ (`:1212`, `:1214`) mais ne le sont qu'à moitié : le front ne
  reçoit pas la projection serveur (M1), donc le gain public affiché reste calculé sur le
  pot théorique ;
- **V9** (colonne `revision`) est encore ouvert — le tableau de synthèse `:506` ne porte pas
  de « résolu », et `supabase/schema.sql` / `supabase/migrate-rls-live.sql` ne contiennent
  toujours **aucun** `ALTER TABLE app_users ADD COLUMN revision` ;
- **V13, V14, V15** sont toujours présents dans le code (M25, M21, M24).

En outre `docs/05-invariants.md:1139` affirme que « `src/lib/matchPayout.ts:52-56` est du
code mort » : c'est faux depuis le correctif V8, la fonction est appelée par
`src/lib/profileMetrics.ts:206` et `src/lib/communityInsights.ts:427`.
**Impact** : le document donne un état des lieux faux sur les correctifs les plus récents.
**Correction** : mettre à jour le tableau de synthèse et le §8.

### M36 — FAIBLE — `docs/08-frontend.md` et `docs/01-architecture.md` : coordonnées fausses

- `docs/08-frontend.md:274` annonce que `useMatchStore` porte les « projections
  `projectedPayouts` (`:158-164`) » : le store **ne les porte pas** (M1) — il n'en garde que
  la déclaration de type.
- `docs/01-architecture.md:820` cite `server/state-helpers.mjs:149` pour le recalcul de
  `projectedPayouts` ; la ligne réelle est `:187`.
**Impact** : bruit documentaire, mais dans un document qui sert de référence de
cartographie. **Correction** : mettre à jour.

### M37 — FAIBLE — Exports serveur jamais importés

Recherche exhaustive sur tout le dépôt (tests inclus) :

| Fichier:ligne | Export | Nature |
|---|---|---|
| `server/persistence.mjs:533` | `getOccRevisionColumn` | l'état OCC est déjà exposé par `server/persistence.mjs:1100` |
| `server/persistence.mjs:1476` | `getRawUserById` | doublon de `getUserById` |
| `server/persistence.mjs:1519` | `getAllUsers` | doublon du scan mémoire |
| `server/persistence.mjs:2941` | `setLignageSupportePourTest` | **crochet de test jamais appelé par un test** (à la différence de `setOccSupportePourTest`, `:519`, qui l'est) |
| `server/persistence.mjs:3616` | `getStateEntity` | doublon de `getStateCollection` |

**Impact** : bruit. `setLignageSupportePourTest` est le seul des deux crochets de test à n'être
appelé nulle part : le test de non-régression qu'il suggère n'existe pas.
**Correction** : supprimer, ou écrire le test.

### M38 — FAIBLE — Exports `e2e/` jamais importés

`e2e/api/support/harness.ts:29` (`API_BASE_URL`, utilisé en interne `:52` mais exporté sans
raison), `:218` (`generateTotp`, utilisé en interne `:321`, `:336`, `:346`).
Le fichier lui-même documente qu'il n'est ni exécuté par `vitest` ni type-checké par `tsc`
(`:5-7`) : ses erreurs de type ne sont donc pas détectées.
**Impact** : bruit. **Correction** : retirer `export` sur les helpers internes, ou ajouter le
fichier au périmètre de `tsc`.

---

## 5. Contrats implicites — récapitulatif

| # | Contrat | Violation |
|---|---|---|
| 1 | `projectedPayouts` est la source de vérité du serveur (`server/state-helpers.mjs:19-20` : « le client ne recalcule jamais le pot ») | Le store front l'écarte (M1) ; le front recalcule (M4, M5) |
| 2 | `shared/match-status.json` est la source unique des statuts (`server/match-status.mjs:22-24`) | 4 listes locales hors source (M8, M9, M10, M11) ; le cadre de la garde ne couvre pas les fichiers fautifs |
| 3 | `rankMJ` / `rankBR` : une seule liste de rangs | Deux listes disjointes (M6) |
| 4 | `LeagueSeasonStatus` : le type reflète les statuts que le serveur écrit | `'cancelled'` absent → crash (M2) |
| 5 | `projectedPayouts` du BR : la projection serveur est livrée | `splitBrPayout` la recalcule et l'ignore (M3) |
| 6 | `tournament.payout` : envoyé par le serveur | Recalculé par le front (M13) |
| 7 | `match.arbiterFee` : figé à la création | Lu comme s'il était courant (M4) |
| 8 | ELO par défaut : 1200 (serveur) | 1000 sur le tableau de bord (M15) |
| 9 | `entryFee` d'une saison : 0 autorisé | `|| 50` côté front (M12) |
| 10 | `DEFAULT_TRUST_SCORE` : 100 (`server/persistence.mjs:231`) | Aligné (`src/app/pages/DashboardPage.tsx:591`) — **conforme** |

---

## 6. Dérive entre le code et la documentation — récapitulatif

| Document: ligne | Affirmation | Réalité |
|---|---|---|
| `src/app/stores/matchStore.ts:11-14` | `awaiting_arbiter` est absent des matchs actifs | Faux — la source unique l'inclut (M33) |
| `docs/02-modele-metier.md:208` | Liste `ACTIVE_STATUSES` sans `awaiting_arbiter`, en `match-engine.mjs:102` | Faux — la liste est dans `shared/match-status.json` (M34) |
| `docs/02-modele-metier.md:215` | `awaiting_arbiter ∉ ACTIVE_STATUSES` (V3) | Faux (M34) |
| `docs/05-invariants.md:1195` | « Les quinze constats (V1 à V15) sont traités » | Faux pour V5/V8 (M1), V9 (colonne `revision` absente de `supabase/`), V13/V14/V15 (M21, M24, M25) (M35) |
| `docs/05-invariants.md:1139` | `src/lib/matchPayout.ts:52-56` est du code mort | Faux — il est appelé par `profileMetrics.ts:206` et `communityInsights.ts:427` (M35) |
| `docs/08-frontend.md:274` | Le store porte les projections `projectedPayouts` | Faux — il n'en garde que le type (M1, M36) |
| `docs/01-architecture.md:820` | `projectedPayouts` recalculé en `state-helpers.mjs:149` | Ligne réelle : `:187` (M36) |
| `PROJECT_README.md:171` | « `[x] LiveTicker pour matchs en cours »` livré | Le composant n'est importé nulle part (M32) |
| `src/app/components/admin/AdminTabShared.tsx:8-10` | La tonalité doit couvrir `awaiting_arbiter` | La table ne le couvre pas (M10) |
| `src/lib/matchPayout.ts:5-6` | « Source de vérité : la projection `projectedPayouts` calculée par le serveur » | Vrai côté serveur, faux côté front : la projection n'arrive jamais (M1) |
| `src/app/components/admin/AdminUrgencyTab.tsx:105-108` | « Le `* 0.98` local […] l'admin confirmait un montant différent de celui réellement versé » | Le repli ligne 110 fait exactement cela (M5) |

---

## 7. Ce que la revue n'a pas pu établir

- **NON VÉRIFIÉ** — l'état réel de la base de production pour la colonne `revision` (V9) :
  le dépôt ne contient aucune migration ; seul l'état applicatif est vérifiable.
- **NON VÉRIFIÉ** — le comportement de `normalizeStoredMatch` face à un `projectedPayouts`
  absent est certain (le champ n'est jamais recopié), mais la valeur exacte affichée au
  joueur dépend du `teamSize` et du roster : les chiffres du tableau de M1 sont donnés pour
  un cas de référence explicite, pas pour toutes les configurations.
- La revue a porté sur le code ; les **9 documents** `docs/00-*.md` → `docs/08-*.md` n'ont été
  relus que sur les points où le code les contredit (M33-M36, §6). Les références de ligne
  périmées ailleurs dans ces documents n'ont pas été inventoriées.
- `e2e/live-api/` et `e2e/live-ui/` n'ont été lus que pour le code mort ; les specs
  elles-mêmes n'ont pas été rejouées.
