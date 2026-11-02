# ZOYD — Synthèse de l'audit-4 (journée CODM du 02/11/2026)

> Rapport final de l'audit-4. Comme pour les dossiers audit-2 et audit-3, la synthèse
> vit dans `docs/` ; les registres détaillés (notes de session, cartographie
> produit complète, rapport de recherche CODM) restent hors dépôt, dans le
> dossier Temp de la machine de travail — ils sont cités en fin de document.

**Ouverture :** 2026-11-02 (lecture cartographie, base `3bf10cf`) —
**Clôture :** 2026-11-02, dépôt à `034f17f` (rapport mis à jour) et vérifié
en production.
**Objet :** cartographie produit complète en lecture, recherche CODM du jour,
puis livraison des chantiers qu'elles ont produits : hiérarchie produit
(D1–D6), P0 référentiel cartes, P1 presets MJ, P2 variant BR, harmonisation
tournoi, P3 anti-friction wager.
**Méthode :** le code d'abord (pages et moteurs lus docstrings comprises),
ensuite une recherche web en GET uniquement (sources datées citées), puis des
commits unitaires avec la discipline « afficher suppose présent » : aucune
règle inventée sur une donnée existante, aucun effet moteur pour un contrat
affiché, référentiel servi là où il appartient. Chaque commit passe la chaîne
complète de gates, puis est vérifié en production par sonde lecture-seule
(une sonde n'écrit jamais : GET, crawl de bundles ou poll de JSON public).

---

## 1. La journée en un tableau — 8 commits, de `11504de` à `034f17f`

| # | Cycle | Commit | Clé | Gates à la clôture |
|---|---|---|---|---|
| C1 | Hiérarchie produit, option A (D1–D3) | `11504de` | salons BR promus carte principale de /mode, ligue BR requalifiée « Événement hebdomadaire / Ouverture différée », quickAction dashboard | e2e 228/228 |
| C2 | D5 + D6 | `a7a2ba8` | chemin BR salons depuis le hub MJ (bande secondaire), vitrine publique (hero, SignalStrips 4→6, 4e pilier, footer verrouillé par e2e) | e2e 230/230 |
| C3 | Recherche CODM + FIX P0 | `1c5e756` | `MJ_MAP_POOL` purgé de 9 cartes fantômes → 32 réelles ; plafond Krai 100→40 ; rapport de recherche daté | vitest 930 · build 5,82 s · e2e 230/230 (6,2 m) |
| C4 | FIX P1 gameplay MJ | `9a840b8` | presets score/temps par mode (S&D 9 · 120 s, HARDPOINT 250 · 600 s, CONTROL 3 · 90 s), CONTROL parmi les 5 modes, compat Oasis/FRONTLINE, 5 classes d'armes, champ opérateur, limite temps minutes→secondes | vitest 930/2 · build 28,65 s · e2e 230/230 (7,1 m) |
| C5 | P2 variant BR in-game | `2b75e61` | 4 variants arbitrés (Classic, Blitz, Sniper Challenge, Resurgence), validation création + normalisation sans invention, contrat servi par `GET /api/br/config`, UI création + détail | vitest 936/2 · build 6,94 s · e2e 230/230 (5,7 m) |
| C6 | Harmonisation tournoi | `45e219c` | liste locale du tournoi remplacée par `MJ_WEAPON_OPTIONS`, défaut de création « Toutes permises », défaut legacy conservé sur la data existante | vitest 939/2 · build 8,25 s · e2e 230/230 (6,9 m) |
| C7 | P3 anti-friction wager | `1726a84` | picks en alternance BO3+ (contrat affiché, zéro moteur), doc rôle spectateur (§3.4 du modèle métier) | vitest 941/2 · build 6,12 s · e2e 230/230 (6,4 m) |
| C8 | Presets BO1/BO3/BO5 (roadmap) | `034f17f` | chips best-of des deux formulaires MJ, presets REMPLISSENT le champ (champ libre conservé), helper source partagé ; +1 spec e2e tournoi | vitest 941/2 · build 6,40 s · e2e 231/231 (6,8 m) |

Sur la journée : tsc 0 et eslint 0 à chaque commit ; les 230 specs e2e
existants tiennent sans adaptation (du C3 au C7, aucune spec modifiée —
les seuls ajouts de specs e2e sont dans C1/C2 :
`e2e/ui/mode-hierarchie.spec.ts` et C8 : `e2e/ui/best-of-presets.spec.ts`).

## 2. Détail par cycle

### C1 — Hiérarchie produit, option A (commit `11504de`)

- D1/D2 : `ModeSelectionPage` rend les salons BR carte principale (badge
  « Salons ouverts », chips « Salon à la demande / Pass remboursable /
  Création ouverte à tous », CTA « Entrer en Battle Royale » → `/br`) ; la
  ligue devient bande secondaire : badges « Événement hebdomadaire » /
  « Ouverture différée », pitch 500 joueurs conservé DANS la bande, CTA
  « Voir la ligue » → `/br-league`. La docstring porte l'invariant : la
  hiérarchie est une promesse utilisateur, sa re-promotion exige une
  décision contraire explicite.
- D3 : `DashboardPage` quickAction 3 = « BR Salons » → `/br`.
- Étiquetage : `LeaguePage` (eyebrow « Événement hebdomadaire », phrase
  « les saisons démarrent après l'ouverture publique », SEO) et
  `LeagueSeasonPage` (badge d'en-tête).

### C2 — D5 + D6 (commit `a7a2ba8`)

- Zéro changement serveur, aucune route, aucun libellé Sidebar/BottomNav
  touché ; SEO landing (double écriture `index.html` + SEOHead) non modifié.
- D5 `HubMJPage` : bande secondaire statique sous la liste MJ — « Battle
  Royale » + « Salons ouverts », pitch pass remboursable, CTA « Entrer en
  salons » → `/br`, lien discret « BR League — événement hebdo ». Zéro
  store : incompatible ni avec le bootstrap socket/polling ni avec
  `BootstrapFailedPanel`.
- D6 `LandingPage` : sous-titre hero mentionne « salons Battle Royale » ;
  SignalStrips hero 4 → 6 ; 4e pilier « Battle Royale » ; grille
  `md:grid-cols-3` → `md:grid-cols-2 lg:grid-cols-4` ; le footer « MJ + BR »
  existant est désormais verrouillé par e2e.
- `e2e/ui/mode-hierarchie.spec.ts` : 3 tests (vitrine /mode, landing, hub MJ
  authentifié — pattern login de `layout.spec`), assertions DOM + href sans
  navigation-déclenchement. Piège (strict-mode) : le libellé
  « Salons ouverts » matche badge, strip ET paragraphe descriptif → cibler
  `exact:true` partout.

### C3 — Recherche CODM + FIX P0 (commit `1c5e756`)

- Recherche sans écriture prod (agent-reach : Exa x7, Jina x6, DDG x4,
  fandom api x2) : pools esports 2026 (HARDPOINT FT250 / S&D FT9 OT20 /
  CONTROL FT3), scène wager DuelX (1v1 kill 30 / 10 min, S&D 13, HP 250,
  alternance des picks), réglages de salon privé (Win Condition, Time
  Limit, Spectators, Password), plafonds BR (Krai 40 ; Isolated/Blackout
  100 avec véhicules ; Alcatraz → Rebirth Island 22/04/2026).
  Arbitrages utilisateur en cascade : « P0 seulement », puis
  « purge + ajout de réelles ».
- `src/lib/competition.ts` : 9 cartes fantômes retirées (Pawnshop,
  Dashboard, Reactor, Aerial, Boulevard, Canopy, Townhouse, Sandbox,
  Grazna), 9 réelles ajoutées (Apocalypse, Hacienda, Combine, Arsenal,
  Crossroads Strike, Seaside, Winter Raid, Vacant, Hovec Sawmill) → pool
  de 32. `getMapImage` reste sans visuel à ajouter.
- `server/br-engine.mjs` : Krai `maxPlayers` 100→40 + docstring source
  (le cap 40 de Rebirth Island affiché comme non confirmé, commenté en
  source) ; test invariant « plafonne Krai à 40 joueurs ».
- Impact zéro API (aucun schema touché) ; aucun nom de carte dans une
  assertion e2e → suite intacte.

### C4 — FIX P1 gameplay MJ (commit `9a840b8`)

- `competition.ts` : CONTROL rejoint les modes (5 au total) ;
  `MJ_MODE_PRESETS` clé sur le libellé de `rules.mode` ; `DOM`/`FL` sans
  preset — saisie libre, aucune valeur source ; `MJ_MAP_MODE_RESTRICTIONS`
  + `MJ_MAPS_FOR_MODE` (Oasis FRONTLINE-only) ; `MJ_WEAPON_OPTIONS` = 5
  classes (Toutes permises / AR / SMG / Snipers / Corps a corps) ;
  `formatTimeLimit` pour l'affichage.
- `CreateMatchPage` : cartes filtrées par mode (mode incompatible = vide +
  toast) ; bandeau preset avec bouton « Appliquer », plus un helper pour
  les modes sans preset (DOM/FL) ; `operatorSkills` (vocabulaire
  pointstreaks) ; limite de temps saisie en MINUTES, stockée en SECONDES
  (jamais 0) ; recap « Limite de temps ».
- Types/matchStore/matchApi : `operatorSkills?`, `timeLimitSeconds?`,
  `timeLimitScope?` ; `MatchRules` affiche « Compét. opérateur » et
  « Limite de temps » seulement si publiée.
- Serveur zéro-touch : `createMatchOnServer` stocke `rules` tel quel
  (`server/match-engine.mjs:742`).

### C5 — P2 variant BR in-game (commit `2b75e61`)

- Contrat affiché : l'arbitre règle le variant DANS la salle privée CODM au
  lancement (capture d'écran à l'appui) — zéro effet moteur. 4 options
  arbitrées : Classic, Blitz, Sniper Challenge, Resurgence.
- `server/br-engine.mjs` : `BR_VARIANTS` + `BR_VARIANT_IDS` (détail du
  variant seulement si source) ; hints de cartes corrigés (Krai « cap 40
  joueurs », Rebirth « NON CONFIRME », rien sur Isolated/Blackout) ;
  validation création (`INVALID_VARIANT` hors menu, défaut classic) ;
  `normalizeBrLobby` neutralise un variant inconnu sans en inventer (vieux
  salon = pas de chip).
- `server/routes/br.mjs` : `GET /api/br/config` expose variants +
  variantIds — le référentiel est servi, rien en dur au front.
- Front : types `brApi.ts`, select `#br-variant` à la création (avec détail
  source + hint de carte), chip variant conditionnelle au détail ; +6
  tests vitest ; e2e verrouille les 4 variantIds du JSON de config.
- Sonde du jour utile : la config Render a servi l'ancien contrat à t+2
  min après le push (auto-deploy en file), VERT ~5 min — les délais de
  build Render font partie de la lecture des sondes.

### C6 — Harmonisation tournoi (commit `45e219c`)

- `CreateTournamentPage` : liste locale `WEAPON_OPTIONS` (4 chaînes libres)
  supprimée au profit de `MJ_WEAPON_OPTIONS` ; défaut « Toutes permises » ;
  « No scorestreak agressif » disparaît (doublon sémantique du select
  pointstreaks).
- `tournament-engine.mjs` : défaut de CRÉATION « Toutes permises » ; les
  valeurs hors référentiel passent tel quel (règlement libre) ;
  `normalizeTournamentSnapshot` garde le défaut LEGACY « Toutes armes
  selon reglement » quand le champ est absent — un champ absent ne
  reçoit JAMAIS une règle remplacée.
- +3 tests : défaut partagé, conservation d'une classe explicite,
  normalisation legacy sans reinvention (fixture T-LEGACY).

### C7 — P3 anti-friction wager (commit `1726a84`)

- Picks en alternance (convention DuelX des wagers, recherche du jour) :
  `MJ_PICKS_ALTERNANCE` dans `competition.ts` ; checkbox « Picks en
  alternance par manche » rendue SEULEMENT en BO3+ (`bestOf >= 3`), helper
  dessous, SummaryBox « Manches » au recap ; `picksAlternate` envoyé
  seulement si coché
  ET BO3+ ; ligne « Picks » dans `MatchRules` seulement si
  `rules.picksAlternate` est présent ET BO3+ (vieux match = rien) ; types
  optionnels (`picksAlternate?`).
- Serveur zéro-touch PROUVÉ : +2 tests sur `createMatchOnServer` (un champ
  de règles inconnu survit au stockage ; `rules` vide sans clé) — pas de
  liste blanche, l'UI décide de l'affichage.
- Doc rôle spectateur : `docs/02-modele-metier.md` nouveau §3.4 —
  transposition du réglage CODM « Number of Spectators Allowed »
  (emplacement gratuit distinct des slots joueurs) ; l'arbitre ZOYD est
  hors-slot (pas de pass, pas de roster, hors de tout flux d'argent —
  3 moteurs sur 4 : match/tournoi/BR, la ligue n'a pas d'arbitre) ; rôle
  chat spectator déjà présent au front (`MatchDetailPage.tsx:178-186`) ;
  le spectateur ne peut pas voir la salle privée (`canSeeRoom`,
  :213-214), miser ni valider un résultat ; le suivi en salle ou hors-jeu
  reste un choix de l'arbitre.

### C8 — Presets BO1/BO3/BO5, item roadmap (commit `034f17f`)

- Recherche exacte : culture wager DuelX « BO1/BO3/BO5 alterné », constat
  « champ libre OK, presets utiles » → la discipline P1 est appliquée aux
  presets : le champ libre CONSERVÉ, un preset REMPLIT le champ, il ne le
  remplace pas (règlement libre, aucune liste blanche côté serveur).
- `competition.ts` : `MJ_BEST_OF_PRESETS = [1, 3, 5]` + `MJ_BEST_OF_SCENE`
  (texte source affiché sous l'input « Best of » des deux formulaires).
- `CreateMatchPage` : chips sous le champ bestOf (étape 2), état actif sur
  la valeur courante, `setValue` au clic ; la checkbox « Picks en
  alternance » du P3 continue de réagir à la valeur du champ (BO3+).
- `CreateTournamentPage` : mêmes chips (défaut moteur BO1), watcher
  `selectedBestOf` pour l'état actif.
- Serveur zéro-touch : aucune modification (le test vitest du P3 couvre le
  stockage brut de `rules`, `bestOf` inclus) ; e2e verrouille le champ
  tournoi (chips visibles, preset remplit le champ 1 → 3 → 5).
- Sonde prod : `index-DVEumqNF.js` porte le texte source (inline) ; le
  template « Preset best of » est dans les deux chunks de formulaires
  (`CreateMatchPage-C_gmxGld.js`, `CreateTournamentPage-DVm6VAcF.js`) ;
  Render zero-touch = rien à sonder côté API.

## 3. Invariants transversaux intacts

1. **Afficher suppose présent** — aucune règle inventée sur la data
   existante : variant inconnu = pas de chip ; vieux tournoi sans champ =
   défaut legacy conservé ; `operatorSkills`/`timeLimit`/`picksAlternate`
   absents des vieux matchs = aucune ligne affichée.
2. **Règlement libre** — les valeurs hors référentiel passent tel quel à la
   création (aucune liste blanche côté match/tournoi/BR) ; l'UI ne propose
   QUE le référentiel vérifié, le moteur accepte tout règlement explicite.
3. **Contrat affiché, zéro moteur** — variant BR et picks alternance sont
   des règles réglées dans la salle CODM ; le serveur stocke tel quel et
   les tests le prouvent (pas d'effet moteur caché).
4. **Référentiel servi par le serveur** — la config BR expose
   variants/variantIds/hints ; les classes, presets et compatibilités MJ
   vivent dans `competition.ts`, un seul import pour les deux formulaires.
5. **Hiérarchie produit** — MJ + BR salons = cœur ; BR League = événement
   différé ; docstring en tête de `ModeSelectionPage` interdit la
   re-promotion sans décision contraire.

## 4. Production à la clôture

- Dépôt : `origin/main` = `034f17fe59cebcb500ffa2325473798e0640acfb`, arbre
  de travail propre.
- Front Vercel : index déployé `index-DVEumqNF.js`, crawl BFS 56/59 chunks
  en GET ; les marqueurs C7/C8 y sont (constante + checkbox + helper C7 ;
  texte preset + chips C8).
- API Render : alignée (le seul retard observé de la journée, ~5 min sur
  C5 pendant un auto-deploy en file).
- Non sondables en lecture-seule : pages auth-gated (/mj…) et défauts du
  moteur (POST = écriture) → couverture par e2e local et vitest,
  déviations documentées.

## 5. Rappels (portés, cf. cartographie §10)

- **Promesse produit (mot utilisateur du jour) :** « la LEAGUE BR c'est
  juste un événement qui n'aura lieu pas avant au moins deux semaines après
  l'ouverture au public » ; le VRAI produit = MJ + BR (salons privés
  inclus). Toute évolution de vitrine doit respecter cette hiérarchie.
- S-9 (« Match de démo ») fermé et compatible avec toute option.
- Les écrans BR réels sont complets et accessibles dès aujourd'hui (/br :
  liste, création, détail, check-in, répartition) : l'option A n'a changé
  QUE la vitrine, jamais le moteur.

## 6. Roadmap (initialisée par la recherche du jour)

- **Presets BO1/BO3/BO5 côté création — LIVRÉ (C8, commit `034f17f`)** :
  presets remplissant le champ, champ libre conservé, zéro moteur.
- Stockage de l'ordre des manches vers le bracket (BO3 alterné : séquence
  de cartes par manche) — NON entamé, reste à arbitrer avant tout code : 
  c'est le dernier item de la recherche CODM encore ouvert.

## 7. Leçons de la journée

- `zoyd-byscan.cjs` ne vérifie QUE les octets du message de commit (0x27,
  >0x7E) : plusieurs dérives de saisie n'ont été attrapées que par
  relecture avant push. Discipline : écrire le message en un seul
  passage, puis relire, puis scanner.
- Sonde : les libellés servis par l'API (JSON `/api/br/config`) ne
  s'évaluent pas comme ceux du bundle (chunks) — vérifier chaque contrat
  à son bon endroit, jamais le référentiel lui-même dans les chunks.
- Le bundle déployé change de hash à chaque push front ; l'API Render peut
  servir un contrat périmé le temps de l'auto-deploy → relire jusqu'au
  verdict VERT, pas à la première lecture.
- Les logs `[ERROR]` de vitest/e2e sont des chemins de panne volontairement
  testés : ils ne sont pas des échecs.

## 8. Registres détaillés (hors dépôt, Temp de la machine de travail)

- `zoyd-cartographie.md` — cartographie produit complète (lecture
  2026-11-02, base `3bf10cf`) + sections 10 bis → 10 decies (cycles de la
  journée) + §10 rappels.
- `zoyd-audit4-notes.md` — notes enrichies par cycle (décisions, gates,
  sondes, leçons).
- `zoyd-codm-recherche.md` — rapport de recherche CODM daté (sources).
- Probes GET-only : `zoyd-probe-p2-api-poll.mjs`, `zoyd-probe-tournoi-scan.mjs`,
  `zoyd-probe-p3-scan.mjs`, `zoyd-probe-p4-scan.mjs`, scanner `zoyd-byscan.cjs`.
