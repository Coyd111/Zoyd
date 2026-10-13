# Étape 5 — Performance et poids du bundle

## Portée

Ce que télécharge un visiteur avant d'interagir, ce qui est chargé sans
besoin, et ce qui est livré pour rien.

**Bilan chiffré de l'étape :**

| Mesure | Avant | Après | Gain |
|---|---|---|---|
| Premier chargement (JS, gzip) | 344 Ko | 243 Ko | **-29 %** |
| Images du build | 26,5 Mo | 2,1 Mo | **-92 %** |
| Poids total du build | 29,6 Mo | 5,2 Mo | **-82 %** |

## 1. 364 kB de graphiques téléchargés avant le premier pixel

**Sévérité : haute. Corrigé.**

Le chunk d'entrée importait **statiquement** `vendor-charts` (364 Ko).
J graphical n'est utilisé que par `EarningsCharts`, lui-même chargé en
`React.lazy` depuis `EarningsDashboard`. La page qui affiche les graphiques
était donc déjà paresseuse… mais le chunk partait quand même au chargement
initial.

Le mécanisme est contre-intuitif, et c'est ce qui le rend durable :

- `src/lib/utils.ts` importe `clsx` et `tailwind-merge` pour le `cn()`
  classique des composants ;
- **recharts dépend aussi de `clsx`** ;
- Rollup rangeait le module `clsx` partagé dans le chunk `vendor-charts`.

L'entrée avait besoin de `clsx` pour composer ses classes, donc elle
importait `vendor-charts` — et entraînait avec elle 364 Ko de graphiques pour
un utilitaire d'1 Ko. Deux pages sur l'application perdaient ce poids, les
autres le payaient sans l'utiliser.

`clsx`, `tailwind-merge` et `react-is` ont leur propre chunk `vendor-utils`.
`vendor-charts` est redevenu purement paresseux : plus aucune importation
statique depuis l'entrée.

## 2. Doublons d'images : 12,8 Mo livrés pour rien

**Sévérité : haute. Corrigé.**

`public/assets/codm/image/` contenait quatre fichiers JPEG de 4,2 à 5,2 Mo,
noms d'origine de fond d'écran (`call-of-duty-mobile-season-3-...`,
`-lazarus-cosmic-wrath-`, etc.).

Vérification par empreinte MD5 : ce sont des **doublons octet pour octet** de
`codm-7.jpg`, `codm-1.jpg`, `codm-8.jpg` et `codm-2.jpg`, qui sont, eux, bien
référencés. Les quatre noms longs n'étaient cités nulle part dans le dépôt.

Le build avait déjà un plugin `excludeHeavyPublicDirs` chargé de purger
`dist/assets/codm/raw_unity`. Il ne visait pas `codm/image`. Quatre doublons de
12,8 Mo étaient donc publiés en production à chaque déploiement.

## 3. Fonds d'écran en 4K encodés sans retenue : 13,1 Mo → 1,5 Mo

**Sévérité : haute. Corrigé.**

Les quatre images réellement utilisées (`codm-1`, `2`, `7`, `8`) pesaient
**13,1 Mo au total**, toutes en **3840x2160** — des fonds d'écran 4K, encodés
comme des photos.

Elles ne sont pas décoratives à la marge : `codm-1.jpg` est le fond de la page
de **connexion**, `codm-7.jpg` celui de l'**inscription** et du chat. Un joueur
qui ouvre la page de connexion sur un forfait mobile télécharge 4,2 Mo
avant de voir le formulaire — pour une image floutée sous des voiles de
dégradé.

Réencodage : mêmes noms, mêmes chemins, mêmes usages dans le code, 1920x1080,
qualité 82, progressif. Résultat **-89 %**, sans toucher une seule ligne de
code ni une seule référence.

Les quatre petites illustrations (`codm-3` à `codm-6`, 49 à 129 Ko) sont
restées intactes : le réencodage ne les aurait pas améliorées, le script
conserve l'original quand le résultat n'est pas plus léger.

## 4. La vidéo de l'accueil : mesurée, laissée en l'état

**Sévérité : informationnelle.**

`hero-bg.mp4` (1,4 Mo, H.264 1080p, 940 kbps) est lu en `autoPlay` sur
l'accueil, l'inscription et la sélection de mode. `preload="none"` est
annulé par `autoPlay` : le navigateur télécharge la vidéo malgré tout.

Le bitrate est raisonnable pour du 1080p, et aucune image d'appoint
(`poster`) n'est fournie — mais la vidéo est à **24 % d'opacité**, sous trois
voiles de dégradé. Une version 720p diviserait le poids par deux sans
différence perceptible à cette opacité.

Je ne l'ai pas fait : c'est une décision visuelle, pas une correction.

## 5. Dépendances : aucun déchet réel

62 dépendances déclarées, 266 fichiers source inspectés. Les seules non
importées sont celles qui ne passent pas par un `import` : `typescript`,
`eslint`, `@typescript-eslint/*`, `@types/react*`, `tailwindcss`,
`@testing-library/jest-dom`. Aucune dépendance d'exécution n'est morte.

Une inexactitude mineure : `tw-animate-css` est déclaré en `dependencies` alors
que c'est un fichier CSS consommé au build (`src/styles/tailwind.css`). Il
n'a rien à faire dans les dépendances de production. Sans effet sur le bundle,
à classer quand la dépendance sera touchée.

## 6. Ce qui reste sur le chemin critique

Après correction, le premier chargement JS est de **243 Ko gzip** :

| Chunk | gzip | Statut |
|---|---|---|
| `vendor-react` | 102 Ko | incompressible sans arbitrage |
| `index` | 83 Ko | code applicatif + composants partagés |
| `vendor-motion` | 42 Ko | `framer-motion`, importé par l'entrée |

**Piste sérieuse, non traitée** : `framer-motion` pèse 42 Ko gzip et est
chargé dès la page d'accueil, alors qu'il sert surtout aux transitions de
pages authentifiées. Le landing est le premier écran vu par les visiteurs et le
moins animé. L'isoler dans les routes authentifiées est un changement
structurant (les composants partagés l'utilisent), pas une ligne de config :
à faire quand le besoin s'en fera sentir, pas avant.

`vendor-react` à 102 Ko est le plancher réaliste pour une application React
avec routeur. Réduire React lui-même n'est pas à l'ordre du jour.