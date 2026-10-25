# Relecture complète — synthèse

**Périmètre** : 65 000 lignes — 193 fichiers `src/`, 99 `server/`, 21 `e2e/`.
**Méthode** : 5 relecteurs en parallèle, chacun sur un sous-système, avec
interdiction de signaler du style. Chaque constat doit être vérifié dans le
code, et les constats corrigés (V1–V15) sont exclus.

**Résultat** : **93 constats** — 4 critiques, 21 élevées, 38 moyennes, 34 faibles.

| Rapport | Fichier | Constats |
|---|---|---|
| Argent | [`01-argent.md`](01-argent.md) | 13 (3 crit., 4 élev.) |
| Autorisation | [`02-autorisation.md`](02-autorisation.md) | 15 (4 hautes) |
| Concurrence | [`03-concurrence.md`](03-concurrence.md) | 7 (4 hautes) |
| Code mort & dérive | [`04-code-mort.md`](04-code-mort.md) | 38 (5 élev.) |
| Front | [`05-front.md`](05-front.md) | 20 (1 crit., 4 hautes) |

---

## 1. Ce que j'ai vérifié moi-même

Un rapport d'audit n'est pas une vérité : c'est une piste. J'ai donc rouvert le
code pour les constats les plus graves avant de les retenir.

| Constat | Verdict | Preuve |
|---|---|---|
| **F1** — `useState` après retour précoce | ✅ **CONFIRMÉ — CORRIGÉ** | `PublicProfilPage.tsx:93, 95, 110` (retours) puis `:165-166` (`useState`). Au 1ᵉʳ rendu : 0 hook ; au 2ᵉ : 2 hooks de plus → React lève « Rendered more hooks than during the previous render » → l'`ErrorBoundary` racine s'affiche et **toute l'application tombe** sur `/profil/:id`. |
| **M1** — `projectedPayouts` écarté par le store | ✅ **CONFIRMÉ — CORRIGÉ** | `matchStore.ts:393-427` (`normalizeStoredMatch`) ne recopie pas `projectedPayouts`, alors que le type `Match` le déclare (`:168-173`). Le champ est perdu sur **tous** les chemins (HTTP et socket). **CORRIGÉ le 23/10/2026** (`StoredMatch` déclare le champ, `normalizeStoredProjection` le recopie avec garde « pas de pot inventé » ; 6 tests de chaîne payload→store→helpers). |
| **C1** — écriture BR hors du verrou | ✅ **CONFIRMÉ — CORRIGÉ** | `routes/br.mjs:178` ouvre `withBrLobbyMutex`, `:235` le referme, et `:239` (`saveBrLobbies`) écrit **en dehors**. La lecture est verrouillée, l'écriture non. **CORRIGÉ le 23/10/2026.** |

### 1.1 Ce que M1 implique sur mes propres correctifs

**Les correctifs V5 et V8 sont inopérants côté client.**

V5 a rendu juste `perWinner` côté serveur. V8 a fait que le front utilise la
part par joueur. Mais le front ne reçoit jamais `projectedPayouts` : le
normaliseur du store l'écarte. `getWinnerPayoutPerPlayer` retombe donc sur son
repli — `getWinnerPayout(match) / teamSize` — où `getWinnerPayout` utilise
`prizePool` **théorique** et `arbiterFee` **figé**.

**Mon test V8 passait, et il avait raison de passer — mais il testait la
mauvaise couche.** Il construisait l'objet `match` à la main, sans passer par
`normalizeStoredMatch`. Le test validait une fonction, pas le chemin réel de la
donnée. C'est exactement le piège que V1 avait posé, et je l'ai reproduit
moins d'une heure après l'avoir écrit.

### 1.2 Les deux autres réinteressions

- **C1** est une **réintergression** : le commentaire de `routes/br.mjs:167-176`
  explique que le snapshot est relu *dans* le verrou — c'est vrai — mais
  l'écriture est restée dehors. Le correctif initial était partiel.
  **CORRIGÉ le 23/10/2026** (voir le bloc « Correctif » sous C1 dans
  `03-concurrence.md`).
- **A1** est une **réintergression** : `03-concurrence.md` (§4) décrit le job
  de réconciliation des retraits comme « corrigé » ; `01-argent.md` montre que
  le câblage passe un mauvais 5ᵉ argument et que le job est un **no-op depuis
  toujours**.

### 1.3 Les documents ment aussi

`docs/05-invariants.md:1195` affirme « les quinze constats sont traités ». C'est
faux pour V5, V8, V9, V13, V14 et V15. Le rapport `04-code-mort.md` relève
 sept autres affirmations devenues fausses dans la documentation et dans les
en-têtes de fichier. **La documentation de la session précédente est elle-même
en cause** : elle a été écrite avant les derniers correctifs, et ne les a pas
suivis.

---

## 2. Les constats les plus graves

### 2.1 Argent

| ID | Constat | Impact |
|---|---|---|
| **A1** | Le job de réconciliation des retraits est un no-op (`cron.mjs:638`) | Tout retrait en `pending_review` reste débité à jamais, sans refund ni alerte. `/api/health` ne compte pas ces dettes. **CORRIGÉ le 23/10/2026.** |
| **A2** | La clé d'idempotence est inscrite en mémoire **avant** l'écriture (`wallet-engine.mjs:434`) ; l'annulation du portefeuille (`persistence.mjs:1769`) ne l'annule pas | Échec d'écriture → le gain n'est jamais versé, la reprise croit avoir réussi, le pass reste bloqué. Un salon BR peut afficher une prime versée qui ne l'est pas. **CORRIGÉ le 23/10/2026.** |
| **A3** | Le remboursement précède le marquage (`wallet-engine.mjs:582`) | Si le marquage échoue, le cycle suivant rembourse une seconde fois. Latent — mais armé par A1. **CORRIGÉ le 23/10/2026** (remboursement idempotent ; au passage, deux défauts de la file de réconciliation — écrasée par toute écriture du portefeuille, et filtre annulé par une réassignation — ont été trouvés et corrigés). |
| **A4** | Les parts BR sont appliquées à `winnersPool` (pot − commission) au lieu du pot, alors que `validateBrPayout` les valide comme fractions du pot | Masse conservée, répartition fausse : le 5ᵉ est surpayé de 4,35 % du pot, les quatre premiers sous-payés. **CORRIGÉ le 23/10/2026** (livré avec M3 — les taux sont appliqués au pot, le dernier bénéficiaire absorbe le reliquat ; chaque part est assertée contre le barème déclaré, essai avec un pot à décimales 999,97). |
| **A7** | `assignTournamentArbiterOnServer` n'exige aucun rôle | Tout joueur authentifié prend un slot d'arbitre, contrôle le résultat (aucun litige possible en tournoi) et touche 5–10 % du pot. Le BR exige un admin, la ligue aussi — le tournoi non. **Décision produit le 25/10/2026** : la garde admin n'est PAS appliquée (le volontariat est le comportement attendu ; seule la ligue garde l'admin comme arbitre) ; le rate limit passe sur la route et la 2FA admin des résultats est déjà couverte par S3 ; `createBrLobbyOnServer` garde son arbitre admin (à trancher séparément). |
| **A9** | Les montants réellement versés ne sont jamais écrits | `match.payouts` reste vide : l'export admin et les profils publics sont faux. **CORRIGÉ le 25/10/2026** (`recordActualPayout` — écriture unique par (userId, type), export CSV rempli avec `arbiterFeeReel`/`pendingArbiterFee`, projection basée sur les montants actuels, UUID remplacés par `isMe` dans le payload ; au passage, la note de créance d'arbitre n'était jamais écrite à la première tentative). |

### 2.2 Autorisation

| ID | Constat | Impact |
|---|---|---|
| **S1** | `POST /api/matches/:id/result` : l'override admin du moteur permet d'écrire le vainqueur **sans TOTP** | La route jumelle `/api/admin/matches/:id/award` est, elle, sous `requireAdmin2fa`. Le cron règle la cagnotte 30 min après. **CORRIGÉ le 23/10/2026** (`require2faIfAdmin` sur result + arbiter : l'admin paie un TOTP frais, l'arbitre joueur passe sans code). |
| **S2** | `/api/leagues/:id/final-results` (+ `days/:day/results`, `advance-to-final`) : rôle admin seul, aucun TOTP | `applyLeagueSettlement` verse la cagnotte réelle. Le remboursement voisin est en revanche sous 2FA. **CORRIGÉ le 23/10/2026** (les trois routes de la chaîne passent sous `requireAdmin2fa`, alignées sur refund/payments). |
| **S3** | `POST /api/tournaments/:id/matches/:mid/result` : l'admin contourne le slot d'arbitre | Déclenche `applyTournamentSettlement`. **CORRIGÉ le 23/10/2026** (`require2faIfAdmin` ; l'arbitre assigné continue de passer sans code). |
| **S4** | `GET /api/matches` est publique et `sanitizeMatchForBroadcast` est incomplète | Sortent `creatorId`, `disputes[].requestedBy`, `disputes[].evidence`, et surtout `result.proofHash` — qui n'est **pas** un hash mais la concaténation en clair des URL de captures (le front l'affiche). **CORRIGÉ le 25/10/2026** (`creatorId` retiré du payload ; litiges anonymisés — l'identité du demandeur et les preuves ne sortent plus, réservées aux parties, à l'arbitre et à l'admin ; `proofHash` supprimé du payload, le front n'affiche plus de « Hash de preuve »). |

### 2.3 Concurrence

| ID | Constat | Impact |
|---|---|---|
| **C2** | Le cron de règlement BR ne prend **aucun** verrou (`cron.mjs:377-405`) | Il réécrit toute la collection et **supprime** les salons absents de son instantané → salon disparu, passes gelées. Contredit l'invariant du fichier lui-même. **CORRIGÉ le 23/10/2026** (verrou par salon + écriture par entité). |
| **C3** | Match `disputed` + `payoutDistributed:'pending'` (`match-engine.mjs:1311-1318`) | Les deux filtres de reprise sont disjoints → reprise par **aucun** cron, part de cagnotte gelée, invisible dans `/api/health`. **CORRIGÉ le 23/10/2026** (échec de règlement → `awaiting_confirmation` sans deadline + filtre du job élargi aux litiges clos ; reprise testée). |
| **C4** | États « en cours » jamais repris : salon BR `live`, tournoi `live`, ligue `qualifying` | Aucun balayage de péremption (l'équivalent existe pour les matchs) → passes gelées à jamais. **CORRIGÉ le 23/10/2026** (les trois balayages existants élargis, aucun nouveau job, annulations remboursantes sous leurs verrous respectifs). |

### 2.4 Front

| ID | Constat | Impact |
|---|---|---|
| **F1** | `useState` après retour précoce | **Toute l'app tombe** sur `/profil/:id`. (CRITIQUE) |
| **F2** | `bootstrapReady` n'est jamais remis à `true` en cas d'échec (`socketConnectionStore.ts:399`) | Portefeuille, match, hub, classements et profil restent sur un squelette **à jamais** : le joueur ne voit jamais son solde. **CORRIGÉ le 23/10/2026** (`bootstrapFailed` explicite, backoff 2s→5s→10s→20s dans le heartbeat, panneau « chargement impossible + Réessayer » sur les cinq écrans ; 3 tests). |
| **F3** | `useLogout.ts:51,54` duplique la purge au lieu d'appeler `sessionReset` | Les maps `callerEntryByTournament` survivent → le compte suivant hérite de l'entrée du précédent (« ta position » + inscription bloquée). **CORRIGÉ le 23/10/2026** (délégation à `resetAllSessionStores`, plus aucune copie locale ; 1 test verrouillant maps d'appelant + file de signalements). |
| **F4** | `AdminDashboardPage.tsx:111` avale l'échec de `/api/admin/commissions` | Affiche « REVENUS ZOYD : 0 ZC » — le commentaire dit « plutôt que de mentir », le code ment. Le modèle `reportsUnavailable` existe dans le même fichier. **CORRIGÉ le 23/10/2026** (`commissionsUnavailable` sur le même modèle ; « indisponible » affiché, plus de « 0 ZC » imaginaire). |
| **F5** | `award` / `cancel` / `refund` sont sous `requireAdmin2fa` mais **aucune invite TOTP** | Actions systématiquement en 403. Le bon modèle existe : `BrArbiterPanel.tsx:206`. **CORRIGÉ le 23/10/2026** (`TwoFactorPrompt` extrait et branché sur dashboard admin — award, resolve-dispute, cancel, export — et panneau ligue — refund à replay du payload ; rejeu de l'action après `verifyAdmin2fa`). |

### 2.5 Dérive serveur ↔ front

| ID | Constat |
|---|---|
| **M2** | `LeagueSeasonStatus` ignore `cancelled`, que le serveur écrit → `badge.color` lève une TypeError et casse `/br-league` entière. **CORRIGÉ le 23/10/2026** (sans crash ni runtime : type complet, libellés, onglet ANNULÉE, repli défensif sur les deux pages). |
| **M3** | Le front calcule les parts BR sur la cagnotte des gagnants : il affiche 7 600 ZC là où le serveur verse 12 350 ZC. **CORRIGÉ le 23/10/2026** (serveur et front recalés sur pot × taux ; la page de détail lit la projection serveur en priorité, repli sur les taux avant le premier classement ; 6 nouveaux tests). |
| **M4** | Les commissions d'arbitre du profil **public** lisent toujours `match.arbiterFee` (figé au pot théorique) : V11 n'a été corrigé que côté serveur. **CORRIGÉ le 23/10/2026** (lecture par `getArbiterFee`, projection prioritaire ; 2 tests). |
| **M5** | `AdminUrgencyTab.tsx:109-110` tranche un litige sur `prizePool − arbiterFee`, alors que le commentaire du fichier affirme que ce calcul local a été supprimé. **CORRIGÉ le 23/10/2026** (repli supprimé : montant affiché seulement quand la projection le porte). |

---

## 3. Ce qui est solidement protégé

Il faut le dire, sinon la liste ci-dessus donnerait une image fausse.

- **L'OCC est excellent** — `updateUserAccount` relit payload *et* révision au
  même instant et adopte l'état frais : la fenêtre est fermée, pas seulement le
  chevauchement. Les portefeuilles en héritent.
- **L'ordre des verrous est homogène partout** (global/entité → wallet → user,
  jamais l'inverse) : **aucun interblocage**. Les 16 crons ont tous une garde
  anti-chevauchement partagée avec leur trigger de boot.
- **L'écriture d'état est *fail closed***, avec rollback mémoire.
- **CSRF/CORS** : double garde (Origin sur liste blanche + `Content-Type:
  application/json`), plus un filtre d'origine sur le WebSocket.
- **14 routes financières et de modération sont sous `requireAdmin2fa`**, et la
  règle « un 403 métier ne détruit jamais la session » est bien appliquée
  (`apiClient.ts:63`).
- **L'idempotence des versements** est testée (`settlement-idempotence.test.mjs`).
- **Aucun code d'erreur serveur n'atteint l'écran en clair** (ni stack, ni nom de table).
- Le `Modal` (piège de focus complet), le retry avec backoff du portefeuille,
  `isMatchPayoutSettled`, les gardes multi-compte, l'`ErrorBoundary` sur chaque
  branche protégée, l'anneau `focus-visible` et les cibles tactiles 44 px.

---

## 4. Ordre de correction proposé

| # | Action | Pourquoi d'abord |
|---|---|---|
| 1 | **F1** — remonter les `useState` | Une page publique qui casse toute l'application. Visible par n'importe qui, en une URL. |
| 2 | **A1 + A2 + A3** — job de réconciliation, clé d'idempotence, marquage — **LIVRÉ le 23/10/2026** (avec les deux défauts latents de la file de réconciliation) | De l'argent réellement perdu ou versé deux fois. A1 et A3 sont liés : livrer A3 avec A1 armerait la double remise. |
| 3 | **C1 + C2** — écriture BR dans le verrou, cron BR sous verrou — **LIVRÉ le 23/10/2026** (double étage : verrou + écriture par entité, avec isolation par salon des jobs d'annulation) ; l'option structurelle recommandée par l'audit a été appliquée | Réinteressions : je les ai introduites ou laissées en partie. |
| 4 | **C3 + C4** — reprise des états `disputed`/`live`/`qualifying` — **LIVRÉ le 23/10/2026** (C3 : échec de règlement de litige → dette reprise ; C4 : les trois balayages élargis aux états abandonnés, aucun nouveau job) | Cagnottes gelées sans qu'aucun cron ne les reprenne. |
| 5 | **S1 + S2 + S3** — TOTP sur les trois routes de résultat — **LIVRÉ le 23/10/2026** (garde conditionnelle `require2faIfAdmin` + chaîne ligue sous `requireAdmin2fa`, 16 tests de route) | L'admin sans 2FA peut écrire un résultat et l'argent part 30 min après. |
| 6 | **M1** — recopier `projectedPayouts` dans le store — **LIVRÉ le 23/10/2026** | C'est ce qui rend V5 et V8 effectifs. Et c'est ce qui a permis à deux « corrections » de passer inaperçues. |
| 7 | **M2, M3, M4, M5** — dérives front/serveur — **LIVRÉ le 23/10/2026** (M2 : statut `cancelled` + replis défensifs ; M3 : les taux BR appliqués au pot des deux côtés, projection serveur prioritaire à l'écran ; M4 : commissions du profil via projection ; M5 : repli local de tranchage supprimé) | `/br-league` cassée, montants affichés faux. |
| 8 | **F2, F3, F4, F5** — squelette permanent, fuite entre comptes, mensonge du dashboard, TOTP non demandé — **LIVRÉ le 23/10/2026** (F2 : `bootstrapFailed` + backoff + panneaux « Réessayer » sur les 5 écrans ; F3 : purge déléguée à `resetAllSessionStores` ; F4 : « indisponible » à la place du faux « 0 ZC » ; F5 : invite TOTP réutilisable + rejeu automatique de l'action) | Le joueur ne voit pas son solde ; le compte suivant hérite du précédent. |
| 9 | **S4** — `proofHash` exposé publiquement — **LIVRÉ le 25/10/2026** (identifiants et preuves de litige retirés du payload public, preuves réservées aux parties, à l'arbitre et à un admin ; le faux hash ne sort plus et n'est plus affiché) | Fuite d'URL de captures. |
| 10 | **A4, A7, A9** — parts BR, slot d'arbitre de tournoi, montants non écrits — **LIVRÉ le 25/10/2026** (A4 déjà réglé par M3 ; A7 : décision produit + rate limit ; A9 : versements réels écrits une seule fois, export CSV et projection nourris) | Répartition fausse et prise de contrôle. |
| 11 | La documentation — corriger les affirmations fausses | Une doc qui ment est pire qu'une doc absente. |

---

## 5. La leçon de cette relecture

Trois choses que cette session a apprises, et qu'aucune relecture de code ne
les aurait données :

1. **Un test sur la mauvaise couche passe.** V8 avait un test vert, un calcul
   juste, et un helper correct — et aucun effet, parce que la donnée ne
   parvenait jamais au code. Le test devait passer par `normalizeStoredMatch`.
2. **Un correctif partiel se lit comme un correctif.** C1 : le commentaire
   explique que le snapshot est relu dans le verrou, et c'est vrai — mais
   l'écriture est dehors. La moitié faite se présente comme entière.
3. **Corriger l'argent puis documenter, dans cet ordre, crée des documents
   faux.** Les 9 documents de la session précédente décrivent un état que les
   correctifs suivants ont dépassé. `05-invariants.md:1195` — « les quinze
   constats sont traités » — est aujourd'hui faux pour six d'entre eux.

> La documentation de `docs/00-*.md` à `docs/08-*.md` est à revalider dans son
> ensemble. Elle a été écrite une fois ; elle n'a pas été maintenue.
