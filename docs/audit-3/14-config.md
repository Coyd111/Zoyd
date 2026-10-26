# Partie 14 — Config et déploiement (audit-3)

**Relecture :** 2026-10-26, base `main` au `e9325bf`.
**Périmètre :** les fichiers de configuration racine (`package.json` 103,
`.npmrc`, `.nvmrc`, `.gitignore`, `.env.example`, `.env.server.example` —
les deux derniers non trackés, voir C3 —, `vite.config.ts` 98,
`tsconfig.json`/`tsconfig.app.json`/`tsconfig.node.json`, `vercel.json` 57,
`render.yaml` 76, `playwright.config.ts` 139, `index.html` 93), les assets
publics de service (`public/sw.js` 173, `public/sw-register.js`,
`public/manifest.json`, `public/robots.txt`, `public/sitemap.xml` 82,
`public/404.html`), et les deux docs racine `DEPLOYMENT.md` 447 et
`ENV_SETUP.md` 123.
**Anti faux-positifs :** ledgers `docs/audit-2/`, invariants
`docs/05-invariants.md`, commentaires `PIEGE:`/`INVARIANT:` des sources,
tests `server/encoding-integrity.test.mjs` (vert 2/2).
**Croisements serveur :** `br-engine.mjs` (`BR_START_EARLY_TOLERANCE_MS`
`:145-151`, `BR_PRIZED_PLACES` `:122`), `rate-limiter.mjs`
(`TEST_ONLY_RELAXATION` `:85-102`), `realtime-server.mjs` (`PORT` `:238`,
`API_KEY_ROTATION_DAYS` `:239`), `code-delivery.mjs` (`SMTP_SECURE`
`:212`, priorité Resend→Brevo→SMTP→webhook), `persistence.mjs`
(`getHealthInfo` `:1091/:1096/:1121`), `apiUrl.ts:25` (`VITE_REALTIME_URL`),
`WalletPage.tsx:276` (`VITE_FEDAPAY_PUBLIC_KEY`), `e2e/ui/globalSetup.ts:18`
(`ZOYD_DEV_URL`), `supabase/schema.sql` (`login_attempts` `:106`,
`user_reports` `:359`, `user_sanctions` `:384`, ALTER `:409-412`), imports
radix réels de `src/app/components/ui/**`.

## Verdicts par zone

| Zone | Verdict |
|---|---|
| `DEPLOYMENT.md` | **4 FAIBLE (C1), typos (C5)** |
| `ENV_SETUP.md` | **1 FAIBLE (C2)** |
| Gabarits `.env` / `.gitignore` | **2 FAIBLE (C3, C4)** |
| CI / dépendances (`vercel.json`, `render.yaml`, `package.json`) | 2 INFO (C6, C7) |
| Micro-configs inertes (`vite.config.ts`, vercel rewrites, tsconfig, typecheck) | 1 INFO (C8) |
| Cache et SW (`vercel.json` headers, `sw.js`) | 1 INFO (C9), 1 INFO (C10) |
| `sitemap.xml` | 1 INFO (C11) |
| Hygiène ASCII | 1 INFO (C12) |
| `playwright.config.ts`, `index.html`, `render.yaml` (le reste), `manifest.json`, `robots.txt`, `404.html`, `sw-register.js`, 3 tsconfig (le reste), `package.json` (le reste) | Propres — voir « solide » |

## Ce qui a été vérifié et jugé solide

- **`vercel.json`** : CSP complète et cohérente avec le code réel (CDN et
  checkout FedaPay, `wss://zoyd.onrender.com`, fonts Google), HSTS,
  `X-Frame-Options: DENY`, Permissions-Policy stricte, `no-store` sur les
  pages app et `no-cache` sur `index.html` — la déclinaison cache est
  réfléchie par type de ressource.
- **`render.yaml`** : très bien commenté et honnête — `WEB_CONCURRENCY=1`
  justifié comme garantie structurelle (le commentaire `:11-19` explique
  que la garantie tient par l'absence de cluster, pas par la variable),
  `TRUST_PROXY` cohérent avec le load balancer Render, PAS de clé anon
  Supabase (choix volontaire, la service key suffit), admin surchargé
  documenté, `METRICS_TOKEN` présent, canaux mail Resend/Brevo premiers.
- **`playwright.config.ts`** : très solide — le commentaire `:23-29`
  verrouille le piège `ALLOW_DEBUG_CODES` (tokens en réponse : sans lui
  TOUTES les assertions échouent en silence), `ZOYD_DISABLE_SUPABASE`
  force le mode mémoire pour l'E2E, origines CORS cohérentes, les projets
  `live-*` sont structurellement exclus sans `ZOYD_ALLOW_LIVE_TESTS` avec
  `retries: 0` et budgets de démarrage adaptés aux disques lents
  (`timeout: 120_000` documenté).
- **`index.html`** : chargement de police direct (stylesheet) avec le
  commentaire `:9-24` expliquant pourquoi l'astuce `preload`+`onload`
  avait cassé la CSP puis la police — CSP-safe par construction ; OG/Twitter
  complets, JSON-LD avec liens réels.
- **`DEPLOYMENT.md` (le corps)** : la section variables a été réécrite à
  partir du code (`:15-19` le revendique) et le croisement confirme
  UNE PAR UNE : chaque variable documentée est réellement lue
  (`PORT`/`ZOYD_REALTIME_PORT` `realtime-server.mjs:238`,
  `ZOYD_API_KEY_ROTATION_DAYS` `:239`, `SMTP_SECURE` `code-delivery.mjs:212`
  avec le défaut port 465, `ZOYD_DEV_URL` `globalSetup.ts:18`,
  `ZOYD_RATE_LIMIT_MAX` double condition `rate-limiter.mjs:88/:97`,
  `ZOYD_BR_START_EARLY_MS` double condition `br-engine.mjs:145-151`,
  `VITE_REALTIME_URL` `apiUrl.ts:25`, `VITE_FEDAPAY_PUBLIC_KEY`
  `WalletPage.tsx:276`) ; les pièges JWT_SECRET et VITE_SUPABASE sont
  expliqués ; les migrations et vérifications health (`loginLockoutPersisted`
  `persistence.mjs:1091`, `sanctionsPersisted` `:1096`,
  `deployedCommitShort` `:1121`) sont documentées et réelles ; les tables
  de modération (`login_attempts`/`user_reports`/`user_sanctions`) sont
  bien dans `schema.sql`. Les 4 FAIBLE C1 sont des chiffres et chemins
  d'entrée, pas la section variables.
- **`public/sw.js`** : la purge du cache dynamique (`:23-33`) supprime
  `zoyd-assets-v3` à chaque activate — documentée comme volontaire
  (« forces re-fetch of new hashed assets ») et cohérente avec le bump de
  `CACHE_NAME` `zoyd-v6` ; le handler fetch ne met JAMAIS `/api/` en cache
  (réponse 503 OFFLINE explicite), purge le cookie httpOnly à la
  déconnexion, network-first sur les navigations avec repli `index.html`,
  `skipWaiting`+`clients.claim` ; le pied (`:121-173`) est propre : push
  avec valeurs par défaut, message `SKIP_WAITING`/`SHOW_NOTIFICATION`,
  `notificationclick` qui focus la fenêtre existante avant d'en ouvrir une.
- **`public/sw-register.js`**, **`manifest.json`** (nom, id, thème noir,
  icône réelle), **`robots.txt`** (Disallow /admin /wallet /earnings
  /parametres /chat — les pages privées, cohérent avec le SEOHead
  `noindex` des pages app), **`sitemap.xml`** (12 URLs alignées sur les
  routes réelles, `/br` y figure — contrairement à la navigation, C1 P13),
  **`404.html`** (statique, sobre, cohérente avec le thème).
- **tsconfig ×3** : strict, `noUnusedLocals`/`noUnusedParameters`,
  `noFallthroughCasesInSwitch` partout ; `tsconfig.node.json` couvre
  `server/` pour l'éditeur.
- **`package.json`** : `engines >=22.13` cohérent avec `.nvmrc` = 22,
  `packageManager pnpm@11.0.8`, overrides vite présents, scripts e2e
  complets (dont `test:e2e:live-*`), `typecheck`/`lint` (le lint couvre
  `src server e2e`). `.npmrc` = `node-linker=hoisted` (exFAT), cohérent
  avec `render.yaml:6`. `.nvmrc` = 22.

## Constats

### C1 — FAIBLE : `DEPLOYMENT.md` — quatre affirmations de mise en route fausses

Chacune prise isolément est un doc faux ; réunies, elles induisent en
erreur de bout en bout un lecteur qui suit le guide à la lettre :

- `:5` « Node.js 18+ » — `package.json` exige `engines >=22.13` et
  `.nvmrc` vaut 22 : un déployeur sur Node 18 passe le prérequis puis
  échoue (ou pnpm refuse via engines). Le minimum réel est Node 22.13.
- `:136` `cd "Multiplayer Gaming Platform"` — ancien nom du dossier,
  inexistant (le dépôt est `Zoyd`) : la procédure échoue à la première
  commande.
- `:422` « 220 tests couvrant » — la suite réelle est de 93 fichiers /
  1002 pass / 2 skip (baseline du `00-PLAN`) : le chiffre date d'avant
  les audits.
- `:173` Build command « `npm install` » — le projet est pnpm
  (`packageManager pnpm@11.0.8`, `vercel.json:2` et `render.yaml:6`
  utilisent pnpm) ; la ligne propose npm comme commande principale,
  l'alternative pnpm est reléguée en parenthèse.

FAIBLE : pas de code cassé, mais le guide d'entrée est faux sur
l'environnement, le chemin, la taille du projet et l'install.

### C2 — FAIBLE : `ENV_SETUP.md` obsolète, contradictoire avec `DEPLOYMENT.md` et incomplet

Le fichier porte le titre « Variables d'Environnement ZOYD —
Configuration Déploiement » : c'est le premier doc qu'un déployeur lit,
et il contredit les trois corrections documentées dans `DEPLOYMENT.md` :

- `:16` et `:90` promettent `VITE_SUPABASE_URL` « accès direct » — le
  code ne la lit JAMAIS (aucune lecture front ni serveur) ;
  `DEPLOYMENT.md` explique explicitement ce piège VITE_*.
- `:33` `ALLOWED_ORIGINS` « déjà configuré » — le code lit
  `ZOYD_ALLOWED_ORIGINS` ; `DEPLOYMENT.md:46-51` corrige exactement ça.
- `:96` `SUPABASE_ANON_KEY` « lue par supabase.mjs » —
  `DEPLOYMENT.md:31-34` dit de NE PAS la définir (service key seule).
- Omissions côté obligatoire : `METRICS_TOKEN` (sans lui `/metrics`
  répond 403 en prod), `ZOYD_ADMIN_EMAIL`/`ZOYD_ADMIN_PSEUDO`/
  `ZOYD_ADMIN_ID`, `RESEND_API_KEY` (canal mail recommandé,
  `code-delivery.mjs` : priorité Resend→Brevo→SMTP).

Un déployeur qui suit ENV_SETUP seule obtient une configuration en
partie inerte, sans avertissement. FAIBLE. Piste : remplacer le corps
par un lien vers `DEPLOYMENT.md`, ou l'aligner variable par variable.

### C3 — FAIBLE : `.gitignore:5` avale les gabarits `.env.*` — absents du dépôt

`.gitignore:5` ignore `.env.*`, ce qui couvre AUSSI `.env.example` et
`.env.server.example` : `git ls-files '.env*'` ne renvoie rien (seuls
`.gitignore` et `.npmrc` sont trackés). Quiconque clone le dépôt n'a
aucun gabarit à copier-renommer — le fichier `.env.server.example`
explique lui-même `:1-3` « Les vraies valeurs doivent être dans Render »
et « un exemple pour le développement local », mais n'arrive jamais au
clonateur ; ENV_SETUP.md et DEPLOYMENT.md (documents) en font office,
pas un gabarit. FAIBLE (bruit d'installation). Piste : dé-négocier
l'ignore avec `!.env.example` / `!.env.server.example`.

### C4 — FAIBLE : `.env.server.example` contredit `DEPLOYMENT.md`

- `:7` `SUPABASE_ANON_KEY=YOUR_ANON_KEY` — à ne PAS définir
  (`DEPLOYMENT.md:31-34`) ; le gabarit la propose comme variable normale.
- Pas de `METRICS_TOKEN` dans le gabarit (obligatoire en prod).
- `:13` `VITE_REALTIME_URL=...` dans le gabarit SERVEUR : la variable
  est lue par le FRONT au build Vite (`apiUrl.ts:25`) ; la définir dans
  l'environnement Render du backend n'a AUCUN effet — c'est une variable
  au mauvais endroit, dans le fichier censé éviter exactement ce genre
  de confusion.
- `:15` `NODE_ENV=production` dans un gabarit « développement local »
  (`:3`) — verrouille l'environnement local : les gardes
  `NODE_ENV === 'test'` (`br-engine.mjs:146`, `rate-limiter.mjs:90`)
  ne peuvent jamais se déclencher avec ce gabarit.

FAIBLE : gabarit trompeur, aucune conséquence en production si
DEPLOYMENT.md est suivi.

### C5 — FAIBLE : collection de typos (docs racine + SW)

- `DEPLOYMENT.md:74` « **Nernels** jamais en production » (voulu
  « Jamais ») — sur la ligne la plus sensible du doc (exposition de codes).
- `DEPLOYMENT.md:109` « sert » pour un sujet pluriel (voulu « servent »).
- `DEPLOYMENT.md:374-375` « au canal suivant … la.delivery finit par
  réussir mais on perd plusieurs / plusieurs délais » (répétition et
  « la.delivery » incohérent).
- `DEPLOYMENT.md:445` « CACHE_NAME n existe plus » (apostrophe manquante).
- `public/sw.js:65` « Pinvalidée » (collé).

### C6 — INFO : `--no-frozen-lockfile` en CI

`vercel.json:2` et `render.yaml:6` installent avec
`--no-frozen-lockfile` : le lockfile peut dériver silencieusement d'un
build à l'autre (dépendances transitives résolues à la volée),
`pnpm-lock.yaml` étant présent et tracké, un install figé serait
reproductible. Choix probablement lié aux migrations pnpm sur disque
exFAT — remarque, pas une erreur.

### C7 — INFO : 18 paquets `@radix-ui/*` déclarés non importés

`package.json:27-51` déclare 25 paquets `@radix-ui/react-*` ; 7
seulement sont réellement importés (label, slot, dialog, separator,
tabs, toggle, tooltip — via `Form`/`Label`/`Sheet`/`Separator`/`Sidebar`/
`Tabs`/`Toggle`/`Tooltip`). Les 18 autres sont une dette d'installation
(poids du clone et de l'install, pas du bundle : Vite ne les embarque
pas sans import). Utilisé par les templates shadcn/ui ; c'est un choix
courant, listé pour l'arbitrage d'un éventuel ménage.

### C8 — INFO : micro-configs inertes ou obsolètes

- `vite.config.ts:19-39` `excludeHeavyPublicDirs(['raw_unity'])` :
  la cible `dist/assets/codm/raw_unity` n'existe jamais
  (`public/assets/codm/raw_unity` est ignoré par `.gitignore:9` et
  absent) — résidu tolérant, le plugin est un no-op.
- `vite.config.ts` : la liste `external` rollup front est inerte (aucun
  import front de ces paquets serveur).
- `vercel.json` : les rewrites `/br(.*)` précèdent `/br-league(.*)` avec
  la même destination — sans effet observable (le premier couvre le
  second), du bruit de config.
- `tsconfig.node.json:21` inclut `vitest.config.ts`, inexistant (le
  fichier n'existe pas ; la config vitest vit dans le reste) — tolérant.
- `typecheck` (`tsc -p tsconfig.app.json`) ne couvre ni `server/` ni
  `e2e/` — `server` est couvert pour l'éditeur via `tsconfig.node.json`
  mais jamais vérifié en CI, `e2e/` passe au lint. Remarque de couverture.

### C9 — INFO : cache immutable sur des assets publics NON hashés

`vercel.json:7-11` applique `max-age=31536000, immutable` à
`/assets/(.*)` — ce qui couvre AUSSI les fichiers servis depuis
`public/assets/codm/*` aux noms fixes (images de catalogue, non hashées) :
remplacer une image au même nom laisse le client (et le SW) sur l'ancienne
pendant un an. Les assets buildés Vite (hashés) sont le cas principal et
sont bien servis. INFO : au moindre remplacement d'image, renommer le
fichier (ou discriminer la règle).

### C10 — INFO : SW — purge totale assumée + commentaires mixtes

- `sw.js:23-33` : l'activate supprime TOUS les caches ≠ `CACHE_NAME`,
  donc `DYNAMIC_CACHE` `zoyd-assets-v3` ne survit jamais à un déploiement
  (« forces re-fetch » documenté en tête de handler) — assumé et
  cohérent avec le bump de version, listé pour mémoire.
- `playwright.config.ts` : commentaires mixtes FR/EN (« reservere »
  `:50`, « arrived » `:102`, « existant ») — même famille d'hygiène que
  C12.

### C11 — INFO : `sitemap.xml` — `lastmod` figé

Les 12 URLs portent `lastmod` en dur (2026-08-30, `/br` au 2026-10-04),
jamais régénéré : bruit SEO léger (les moteurs tolèrent un lastmod
périmé, mais il perd sa valeur). Les URLs elles-mêmes sont alignées sur
les routes réelles — et `/br` y figure, contrairement à la navigation
mobile (C1 P13). INFO.

### C12 — INFO : hygiène ASCII (code + configs)

Le scan (`zoyd-ascii-scan.mjs`, les 20 fichiers non-`.md` du
périmètre P14 : configs racine, gabarits `.env`, `public/` de service)
relève 168 occurrences non-ASCII sur 69 lignes distinctes : accents des
commentaires FR (`vite.config.ts`, `playwright.config.ts`, `render.yaml`,
`sw.js`) et des textes (`index.html`, `404.html`, `manifest.json`,
`sitemap.xml`, gabarits `.env`). Aucune occurrence CJK sur le périmètre
(grep `[\x{4e00}-\x{9fff}]` vérifié — la seule du projet reste
`match-engine.mjs:1695`, déjà gravée en partie 3). Les `.md` du périmètre
(`DEPLOYMENT.md`, `ENV_SETUP.md`) sont FR accentué par convention, comme
les docs audit. UTF-8 propre (test d'intégrité vert).

## Résumé

Six FAIBLE, six INFO. Les FAIBLE sont tous documentaires, mais
concentrés exactement là où un déployeur regarde en premier :
`DEPLOYMENT.md` ment sur l'environnement (Node 18+), le chemin (ancien
nom de dossier), la taille (220 tests) et l'outil d'install (npm) ;
`ENV_SETUP.md` contredit les trois corrections du même guide et omet
les variables obligatoires ; le `.gitignore` empêche les gabarits
`.env` d'arriver au clonateur, et le gabarit serveur qui reste propose
une variable morte (anon key), omet `METRICS_TOKEN` et place une
variable front au mauvais endroit. Les INFO : no-frozen-lockfile en CI,
18 paquets radix morts, micro-configs inertes (raw_unity, external,
rewrites, vitest.config.ts, couverture typecheck), cache immutable sur
assets non hashés, purge SW assumée, lastmod figé, hygiène ASCII. Tout
le reste est solide : la CSP de `vercel.json` est complète et alignée
sur le code réel, `render.yaml` documente honnêtement ses garanties
(structurelles) et ses choix, `playwright.config.ts` verrouille les
pièges E2E, `sw.js` ne met jamais l'API en cache et purge le cookie
httpOnly, et la section variables de `DEPLOYMENT.md` a passé le
croisement variable par variable : chacune est réellement lue par le
code, avec son comportement d'absence correct.
