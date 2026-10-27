# Partie 16 — Docs de service (audit-3)

**Relecture :** 2026-10-27, base `main` au `133a682`.
**Périmètre :** les 10 documents de `docs/` lus intégralement — `00-INDEX.md`
(208 l.), `01-architecture.md` (1425), `02-modele-metier.md` (683),
`03-securite.md` (1253), `04-api.md` (1099), `05-invariants.md` (1308),
`06-tests.md` (1060), `07-exploitation.md` (872), `08-frontend.md` (944),
`openapi.yaml` (179).
**Anti faux-positifs :** chaque divergence doc/code a été tranchée en lisant le
code actuel — `git ls-files` (server 116, src 180, tests 76+17 = 93),
`npx playwright test --list` re-listé le 27/10 (api 158, ui 48, live 38),
`schema.sql:94-95`, `br-engine.mjs:330-339`, `match-engine.mjs:1656-1661` et
`:1306-1839`, `rate-limiter.mjs:48`/`:111`, `routes/br.mjs:129`,
`tournament-engine.mjs:69`, `payment-engine.mjs:16-18`/`:137-138`,
`persistence.mjs:2889`/`:4374-4381`, `realtime-server.mjs:681`/`:722`/`:738`,
`routes.tsx:94-97`/`:240-243`, `vercel.json` (57 l., 19 rewrites),
`matchPayout.ts:93`, `profileMetrics.ts:210`, `communityInsights.ts:427`,
`ProfileView.tsx:358`, `match-engine.test.mjs:393`/`:413`,
`server/auth-logout-quota.test.mjs` (existe), `harness.ts` (368),
`realtimeClient.ts` (438). Aucun constat sans preuve croisée.

## Verdicts par zone

| Zone | Verdict |
|---|---|
| `00-INDEX.md` | **3 FAIBLE (D1 chiffres, D2 renvoi faux, D3 table §8 cassée)** |
| `openapi.yaml` | **1 FAIBLE (D4 — contrat périmé sur les 4 points clés)** |
| `02-modele-metier.md` | **3 FAIBLE (D5 A7, D6 sweep, D7 renvoi V9)** |
| `03-securite.md` | **1 FAIBLE (D8 §16.2 périmé)** |
| `05-invariants.md` | **2 FAIBLE (D9 V5 corps vs table, D10 double V14)** |
| `06-tests.md` | **2 FAIBLE (D11 chiffres, D12 §4.2 figé dépassé)** |
| `08-frontend.md` | **2 FAIBLE (D13 §12 dépassé, D14 arborescence)** |
| Citations décalées (tous docs) | 1 INFO (D15) |
| Typos et franglaises (tous docs) | 1 INFO (D16) |
| `05-invariants.md:1294-1295` | 1 INFO (D17) |
| `01-architecture.md`, `04-api.md` (fond), `07-exploitation.md` (fond) | Propres — voir « solide » |

**14 FAIBLE, 3 INFO.** Aucun CRITIQUE ni MAJEUR : les documents de service
portent du texte, pas des exécutions — mais trois d'entre eux (02, 05, 08)
se contredisent eux-mêmes ou racontent un état déjà corrigé, ce qui est
exactement ce que ces documents prétendent ne jamais faire.

## D1 — FAIBLE — `00-INDEX.md` : les chiffres de cadrage sont périmés ou faux

- `:7` et les en-têtes des docs 01 (`:13`), 02 (`:13`), 05 (`:13`), 06, 08 :
  base « commit de travail `0328dc8` » (18/10). Le dépôt est au `133a682`
  (27/10) et une passe docs du 26/10 (`8e4f1cc`) a déjà remis 01/02/05/08 à
  jour sans toucher ces en-têtes.
- `:44` « Back Node (Express) ~28 500 lignes, 99 fichiers » : **triple
  erreur**. Le serveur est un `http` natif, pas Express — `01-architecture.md`
  (`:74-76`) et `04-api.md` (`:14-15`) le disent eux-mêmes ; `git ls-files
  server` = **116** fichiers ; les lignes sont surestimées.
- `:43` « src/ ~32 700 lignes, 193 fichiers » : `git ls-files src` = **180**
  fichiers (la purge M31/M32 du 26/10 n'est pas reflétée).
- `:45` « e2e ~3 900 lignes, 21 fichiers » : 21 fichiers ✓ mais le détail de
  la partie 15 somme à ~4 530 lignes.
- `:132` « Neuf documents, ~8 500 lignes » : les 9 `.md` somment à **7 544**
  (7 708 avec `openapi.yaml`).
- `:207` « 846 unitaires · 158 E2E API » : la baseline actuelle est
  **1002 passés / 93 fichiers** (76 serveur + 17 front) ; les 158 E2E API
  restent exacts (re-listés le 27/10).

Le dossier de tests actuel (`vitest` baseline 1002/93) est mentionné nulle
part : un lecteur qui croise le doc et `pnpm test:run` voit un écart de 156
tests sans explication.

## D2 — FAIBLE — `00-INDEX.md:35` : renvoi vers un fichier qui n'existe pas

Le §3 cite « `docs/08-invariants.md` (à écrire) ». Ce fichier n'existe pas et
n'a jamais existé : le document des invariants est `docs/05-invariants.md`,
écrit et maintenu. Le renvoi oriente le lecteur vers une erreur 404 et vers
l'idée fausse que les invariants manquent.

## D3 — FAIBLE — `00-INDEX.md` table §8 (`:158-176`) : structure cassée

- Les violations **V13 et V15** du doc 05 (`:518`, `:521`) sont absentes de la
  table résumé (13 lignes sur 15).
- La ligne V14 (`:170`) est écrite sans accents (« CORRIGE - balayage des
  salons perimes »), en rupture de style avec tout le reste du document.
- Une ligne vide (`:172`) coupe la table Markdown en deux ; la ligne V12 est
  rendue comme un paragraphe orphelin.
- `:174` « Le détail de chacune, avec les emplacements exacts, est dans » est
  une phrase **coupée au milieu de la table**, sa fin (`:176`) arrive après
  une ligne parasite.
- `:175` « Réseaux sociaux … ✅ AJOUTÉS » n'est pas une violation : cette ligne
  (qui concerne le JSON-LD, sujet du doc 08) est collée entre deux lignes de
  la table.

## D4 — FAIBLE — `openapi.yaml` : le contrat décrit une API qui n'existe plus

- Modèle d'authentification : `securitySchemes` ne décrit QUE du
  `BearerAuth` (`:171-179`). Le contrat réel est un cookie httpOnly
  `zoyd_auth` + garde d'origine CSRF (`docs/03-securite.md`, `docs/04-api.md`
  §3-4) ; le token Bearer n'existe que pour le temps réel
  (`server/http-utils.mjs:260-270`).
- `:56` login « returns token + user » : faux. Le token n'est renvoyé dans le
  body QUE si `ALLOW_DEBUG_CODES=true` (fail-closed en prod) — verrouillé par
  l'e2e live (`e2e/live-api/live-full.spec.ts:254-265`).
- `:74-88` deposit : aucune mention du double garde **admin + 2FA vérifiée**
  (`requireAdmin2fa`) — c'est précisément pour ce route que le harnais e2e
  maintient un cache TOTP partagé (`e2e/api/support/harness.ts:9-22`).
- `:90-105` withdraw : champs requis faux — il manque `idempotencyKey`
  (OBLIGATOIRE, `400 IDEMPOTENCY_KEY_REQUIRED`), les bornes 150-100 000 ZC,
  l'opérateur, le pays, et la commission 2 % publiée.
- Couverture : 10 `paths` pour 108 routes réelles sur 11 modules
  (`docs/04-api.md` §12) — moins de 10 % de la surface.
- Conséquence : ce fichier est le premier que lit un intégrateur tiers, et il
  est le plus périmé du dossier `docs/`. Trois options honnêtes : le retirer,
  le marquer deprecated, ou le régénérer.

## D5 — FAIBLE — `02-modele-metier.md` : contradiction interne sur l'arbitre BR (A7)

- §3.1 (`:108`) et §10 (`:683`) verrouillent « l'arbitre BR doit être
  `role === 'admin'` / un admin désigné ».
- §5.3 du MÊME document (`:353-355`) décrit correctement **A7** (décision
  produit du 25/10, audit-2) : matchs, tournois et salons BR = volontariat,
  tout joueur authentifié crée et arbitre par défaut.
- Le code suit A7 : `br-engine.mjs:330-339` (`INVALID_ARBITER` — volontariat
  authentifié, pas de test de rôle) ; les gardes réelles sont
  `requireLobbyArbiter` et le statut non-joueur de l'arbitre, plus
  `require2faIfAdmin` sur `finish` (A7).
- Les deux sections §3.1/§10 n'ont pas été repassées quand A7 a été posé :
  un lecteur applique la règle fausse et bloque une fonctionnalité livrée.

## D6 — FAIBLE — `02-modele-metier.md` : contradiction interne sur le sweep

- §4.4 (`:246`) dit le balayage « non branché (§9) ».
- §9.1 du MÊME document (`:661`) dit « branché ✅ ».
- Le code a tranché depuis le 20/10 (`1b733c3`) : `match-engine.mjs:1656-1661`
  (`runMatchAutomationOnServer` → `sweepMatchesWithoutArbiter`, tick 30 s),
  couvert par `server/arbiter-sweep-wiring.test.mjs`.
- C'est le même schéma que D5 : la table/section descriptives a été mise à
  jour, pas la section narrative qui la précède.

## D7 — FAIBLE — `02-modele-metier.md:47` : renvoi croisé faux (V9 au lieu de V11)

Le paragraphe « Écart connu » sur `arbiterPayouts` renvoie à « `docs/
05-invariants.md` V9 ». Or V9 est l'invariant OCC/révision (`05:514`) ;
l'écart `arbiterPayouts` est **V11** (`05:516`). Le lecteur tombe sur la
mauvaise violation.

## D8 — FAIBLE — `03-securite.md` §16.2 : l'état « à faire » de la colonne `revision` est dépassé

- Le doc 03 présente la déclaration de `app_users.revision` dans
  `supabase/schema.sql` comme absente (« à faire »).
- Elle est **provisionnée** : `schema.sql:94-95` (ALTER + index), verdict V9
  du doc 05 (`:514` « **FAUX** — provisionnée »), §4.4 de `07-exploitation.md`
  (« CORRIGÉ », commit `b90264d`), et verrouillé par
  `server/schema-coverage.test.mjs:121-126`.
- `03-securite.md` est le seul des quatre à porter l'état d'avant : il n'a pas
  été relu lors des passes du 20/10 (en-têtes) ni du 26/10 (M33-M36).
- (Vérification faite pendant l'audit : la citation §15 `:1026` de
  `server/auth-logout-quota.test.mjs` est valide — le fichier existe.)

## D9 — FAIBLE — `05-invariants.md` : le corps de V5 raconte l'état d'avant correctif

- Table résumé `:510` : V5 « FAIBLE (latent) -> resolu » ; §7 `:1203` :
  « Dépassé (V5, V8 corrigés) » avec les bonnes cibles
  (`ProfileView.tsx:358`, `profileMetrics.ts:210`, `communityInsights.ts:427`) ;
  §9 `:1286` : « ✅ V5 ».
- Mais le corps de V5 (`:790-830`) dit encore « **Correction à faire.** » et
  cite l'ancien état : `match-engine.mjs:178-180` (`:797`), `matchPayout.ts:
  52-56` (`:809`), et « le test … asserte … 490 » (`:822`).
- État réel : la projection serveur divise par l'équipe gagnante
  (corrigée), `getWinnerPayoutPerPlayer` vit à `matchPayout.ts:93` et est
  branché, et le test figé a été corrigé (`server/match-engine.test.mjs:393`
  commente l'ancien 490, `:413` asserte **980**).
- Trois sections du même document se contredisent sur le même invariant.

## D10 — FAIBLE — `05-invariants.md` : deux V14 dans le tableau résumé

`:519` (« Un salon BR jamais lance garde les passes verrouillees ») et `:520`
(« Ternaire mort dans `getStatusFromMatch` ») portent le MÊME numéro. La
deuxième est en réalité une violation non numérotée (V16 implicite) : tout
renvoi croisé « V14 » depuis un autre doc (00-INDEX `:170`) est ambigu, et la
seconde n'a aucune référence possible.

## D11 — FAIBLE — `06-tests.md` : chiffres unitaires périmés + incohérence interne

- §2.1 `:180` « 61 fichiers *.test.mjs » : réel **76** ; `:188` « 14 fichiers
  *.test.ts » : réel **17** ; §2.3 `:239-241` et §8 `:998` « 846 passés / 75
  fichiers » : réel **1002 passés / 93 fichiers** ; §4.8 `:651-653` idem.
- `:189-192` : « 9 fichiers .test.ts » suivi d'une liste de **11** noms —
  incohérence interne immédiate ; le compte réel est 11 (25 fichiers dans
  `src/app/stores/` = 14 modules + 11 tests).
- Les chiffres Playwright (158 / 48 / 38) restent exacts — re-listés le
  27/10. Le doc s'auto-protège partiellement (§8 « instantané »), mais les
  tables §2.1/§2.3 sont présentées comme « comptage vérifié » sans réserve.

## D12 — FAIBLE — `06-tests.md` §4.2 : le « test qui fige le bug » n'existe plus

La section décrit `server/match-engine.test.mjs:389-402` comme assertant
`perWinner = 490` (valeur fausse) et en tire la leçon « un test peut figer le
bug ». Le test a été corrigé depuis : `:393` commente explicitement «
L'assertion d'origine (490) divisait par le nombre TOTAL de joueurs » et
`:413` asserte **980**. L'exemple est devenu un contre-exemple : un lecteur
qui va vérifier ne trouve pas ce que le document affirme comme présent.
(La leçon reste valable ; c'est la référence factuelle qui est morte.)

## D13 — FAIBLE — `08-frontend.md` §12 : tout le chapitre décrit un état réglé

- §12.1 : `getWinnerPayoutPerPlayer` y est « code mort » (1 occurrence, sa
  définition `:52`) et `hasAuthoritativePayout` est vivant à `:59`.
- Réel : `hasAuthoritativePayout` a été **purgé** (M28/M30/M37/M38,
  `cbd1b7a`) ; `getWinnerPayoutPerPlayer` (`matchPayout.ts:93`) est **vivant
  et branché** — `profileMetrics.ts:210`, `communityInsights.ts:427`,
  `ProfileView.tsx:358`, testé (`matchStore.test.ts:246` = 43.22) ;
- §12.2/12.4 « deux corrections distinctes à faire » : les deux sont faites
  (projection serveur divise par l'équipe gagnante, test corrigé
  `match-engine.test.mjs:413`) ; A9 ajoute en plus le remappage `isMe`
  (`matchPayout.ts:70-73`, `:87-91`).
- `8e4f1cc` (26/10) n'a retouché que 2 lignes du doc (en-tête). Résultat : la
  partie la plus détaillée du document document une divergence qui n'existe
  plus, sans le dire.

## D14 — FAIBLE — `08-frontend.md` §2 : l'arborescence sous-compte

- En-tête `:10` et §2 : « 171 fichiers » ; `git ls-files src` = **180**.
- Par répertoire : `components/` 45 (doc : 43), `app/lib/` 22 (doc : « 18
  modules + 2 tests » ; réel 19 modules + 3 tests — `brApi.test.ts` manque à
  la liste), `src/lib/` 13 (doc : « 9 modules + 1 test » ; réel 10 modules +
  3 tests — `profileMetrics.test.ts` et `social.test.ts` manquent).
- Collent exactement : `stores/` 25, `components/ui/` 19, `hooks/` 7,
  `features/` 27, `pages/` 29, `layouts/` 3, `styles/` 4, `test/` 1.

## D15 — INFO — citations `fichier:ligne` décalées par l'insertion des en-têtes du 20/10

`ce039e8` (20/10) a inséré des en-têtes dans 38 fichiers `server/` et
décalé les lignes ; les docs 03/04 n'ont JAMAIS été repassés, et les autres
seulement partiellement. Écarts vérifiés (doc → réel) :

- `04-api.md` : `http-utils.mjs` +38 (INVALID_REGISTRATION `:307`→`:345`,
  INVALID_ARBITER `:332`→`:370`, WEAK_PASSWORD `:348`→`:386`,
  2FA_ALREADY_ENABLED `:387`→`:425`) ; `persistence.mjs` +71
  (SESSION_TTL_MS `:2821`→`:2889`) ; `routes/br.mjs` `:80`→`:129`.
- `07-exploitation.md` : `realtime-server.mjs` ~+40 (tick 30 s `:640-657`→
  `:681`, uncaughtException `:667-670`→`:722`, SIGTERM `:672-684`→`:738`) ;
  `persistence.mjs` ~+80 (identité admin `:4295-4297`→`:4374-4381`) ;
  `routes.tsx` ~+19 (table §3.4 : `/mode` `:75-78`→`:94-97`, `*`
  `:221-224`→`:240-243`) ; `schema.sql` 408→415 l. ; `migrate-rls-live.sql`
  328→329 l.
- `08-frontend.md` : table §3.1 ~+19 (35 entrées ✓ aucune route nouvelle) ;
  `realtimeClient.ts` 414→438 l. (path `:127`→`:150`, autoConnect
  `:129`→`:152`, withCredentials `:131`→`:154`) ; `matchPayout.ts:52`→`:93`.
- `02-modele-metier.md` : litiges (openDispute `:1120`→`:1306`, resolve
  `:1198`→`:1384`, addEvidence `:1463`→`:1792`, escalate `:1510`→`:1839`) ;
  tailles des 7 moteurs §2 périmées dans les DEUX sens (match 1 545→1 700,
  tournament 1 419→1 343 après purge des exports morts, br 947→1 126,
  cron 548→859, wallet 576→706, persistence 4 361→4 110, mutex 171→191,
  state-helpers 356→454, single-process-guard 135→155).
- `06-tests.md` : `harness.ts` 367→368 (à ±1 : rien à constater) ;
  arbiter-required 145 ✓, arbiter-sweep 107 ✓, admin-totp-guard 131 ✓,
  encoding-integrity 84 ✓ ; `playwright.config.ts:4-6` exacts ✓.
- Les ancrages par NOM DE SYMBOLE (convention des docs 06/08) restent valides
  partout — c'est la défense qui a tenu.

## D16 — INFO — typos, mots collés et franglaises

- `00-INDEX.md:108` « le READMEPromettent vraiment ».
- `06-tests.md` : `:11` « Ce document est lePendant », `:24` « du nom du
  symbole cited », `:556` « les séquences dOpening/closing quotes », `:577`
  « un test d'intégrité documentary », `:875` « Deux lessons ».
- `07-exploitation.md` : `:537` « Deux détails qui compte », `:639`
  « générallement », `:755` « Le.timer de match ne tourne pas », `:773`
  « un node_modules symliqué », `:391` « Table inertie : non Filmée par le
  code » (vocabulaire à reformuler : table inerte, non ciblée par le code).
- `03-securite.md` : `:114` « inverted », `:154` « documented », `:248`
  « placed », `:660` « Le raison », `:832` « commentair », `:1211`
  « lecredential ».
- `02-modele-metier.md:12` « Base de lecture : `server/` (Node/Express) » —
  Express n'existe pas (http natif) ; même motif que D1 `:44`.

## D17 — INFO — `05-invariants.md:1294-1295` : backslashes malformés

Les libellés s'affichent « \settling\ » et « \settled\ » (backslashes
échappés au lieu des guillemets voulus). Décoration de sortie du doc 05, la
section la plus lue.

## Ce qui a été vérifié et jugé solide

- **`01-architecture.md`** — le plus précis des neuf : pipeline de requête,
  gardes, verrous, cron, table exhaustive des 108 routes ; ses seuls écarts
  sont le compte de fichiers recopié de 00-INDEX (`:14` « 99 » → 116) et la
  taille de `realtime-server.mjs` (`:62` « 687 » → 677).
- **`03-securite.md`** — excellent sur le fond (principe « une garde côté
  client ne protège rien », menaces couvertes / non couvertes, table de
  traçabilité tests) ; seul §16.2 est dépassé (D8). Les citations de tests
  vérifiées existent toutes, y compris `auth-logout-quota.test.mjs`.
- **`04-api.md`** — le catalogue 108 routes / 11 modules est exact ; le
  « PIÈGE : un groupe absent de RATE_LIMIT_CONFIG retombe silencieusement
  sur default » est un vrai constat de code confirmé (groupe `'match'` absent,
  repli `rate-limiter.mjs:111`, usage `routes/br.mjs:129`) — le doc est
  sain là où le code piège.
- **`05-invariants.md`** — V9 exact (`schema.sql:94-95`), V1/V10/V14(BR)
  correctement verrouillés côté tests ; sauf V5 (D9) et la double
  numérotation (D10).
- **`06-tests.md`** — les trois niveaux, le harnais, la garde live
  structurelle, la recette de mutation : tout est exact ; seuls les
  instantanés chiffrés ont vieilli (D11, D12).
- **`07-exploitation.md`** — les fichiers qu'il décrit sont INCHANGÉS depuis
  avant sa rédaction (`render.yaml` dernier commit `bb9bb9f` 17/10,
  `ci.yml` `8737c56` 08/10, `keepalive.yml` `bea0d4a` 18/09,
  `vite.config.ts` `5b83afd` 18/10) : tables variables/CI/CSP fiables ;
  CSP reprise verbatim correcte ; le trou du rewrite catch-all `*` est réel
  (`vercel.json:36-56`, aucune source générique).
- **`08-frontend.md`** — 35 entrées de route recensées une à une ✓ ; les
  gardes client §5 et le cycle socket §6.2 sont exacts ; le piège du
  double titre SEO §9.2 est réel.
- Croisés pendant la partie : tournoi 5 %/10 % (`tournament-engine.mjs:69`),
  1 ZC = 10 FCFA (`payment-engine.mjs:16-18`, `:137-138`), serveur = 116
  fichiers, front = 180 fichiers, tests = 93 fichiers (76 serveur + 17 front),
  Playwright 158/48/38 inchangés.

## Motif de la partie

Les dix documents sont d'une qualité de raisonnement rare — citations
systématiques, réserves explicites, auto-critique. Leur point faible commun
est la **maintenance des instantanés** : chiffres, tailles, lignes et statuts
« à faire » ne sont repassés que lors de passes dédiées (26/10), et deux
documents sur dix (03, 04) n'ont jamais eu la sienne. Chaque corrective de
code devrait dérouler la liste des docs qui citent le symbole touché — les
renvois par nom de symbole (déjà la convention) sont la bonne base ; il
reste à y inclure les statuts (tableaux résumé + corps de section, comme V5)
pour éviter les contradictions internes constatées ici.

La synthèse des 16 parties est dans `00-SYNTHESE.md`.
