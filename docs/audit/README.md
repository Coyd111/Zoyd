# Audit ZOYD — tableau de bord

Audit en 8 étapes, par risque décroissant. Chaque étape a son document et
son propre lot de correctifs, committés séparément.

Projet : ~60 000 lignes de code (hors images), 100 routes HTTP, 11 modules de
routes, 512 tests unitaires, 135 E2E API, 41 E2E UI.

## Avancement

| # | Étape | Statut | Constat principal |
|---|-------|--------|-------------------|
| 0 | Cartographie | fait | 5 zones, dette faible (3 TODO) |
| 1 | Sécurité & secrets | **en cours** | 25 variables d'environnement non documentées |
| 2 | Argent & intégrité financière | à faire | — |
| 3 | Données & persistance | à faire | — |
| 4 | Concurrence & temps réel | à faire | — |
| 5 | Performance & bundle | à faire | — |
| 6 | Qualité, tests & dépendances | à faire | — |
| 7 | Produit & accessibilité | à faire | — |
| 8 | Documentation & exploitation | à faire | — |

## Constats ouverts

| Sév. | Constat | Où | Action |
|------|---------|-----|--------|
| Moyenne | 25 variables d'environnement sur 30 ne sont documentées ni dans `DEPLOYMENT.md` ni dans `README.md` ; 13 seulement sont déclarées dans `render.yaml` | dépôt | compléter la référence (étape 1) |
| Faible | La comparaison du jeton `/metrics` n'est pas en temps constant (`!==`) | `server/routes/public.mjs` | `crypto.timingSafeEqual` |
| Faible | `NODE_ENV=test` **et** `ALLOW_DEBUG_CODES=true` désactivent tout le rate limiting ; un `NODE_ENV` erroné en production rend la protection inopérante | `server/rate-limiter.mjs` | garde supplémentaire |
| Info | `lockFunds`/`unlockFunds` ne sont appelées que par les tests : code mort portant un TODO d'UI optimiste sur des fonds | `src/app/stores/walletStore.ts` | supprimer ou brancher sur le socket |
| Info | 4 canaux d'envoi de code coexistent (Resend, Brevo, SMTP, webhook) | `server/code-delivery.mjs` | documenter la precedence |

## Points vérifiés et conformes

Autant de=valueurs d'approuver que de défauts : ces contrôles ont été faits,
ils ne sont pas à refaire.

- **Matrice d'autorisation** : 100 routes, toutes gardées, sauf 8 — les 6
  routes d'authentification (avant session, par nature) et 2 lectures
  publiques (`/api/health`, `/api/leaderboard`).
- **`ALLOW_DEBUG_CODES`** : fermeture par défaut (`=== 'true'`), `NODE_ENV`
  absent = production. Correct.
- **`ZOYD_RATE_LIMIT_MAX`** : n'agit que sous
  `NODE_ENV=test && ALLOW_DEBUG_CODES=true`. Ne peut pas affaiblir la
  production (voir la réserve sur `NODE_ENV` ci-dessus).
- **Double clé Supabase** (`SUPABASE_SERVICE_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY`) : alias volontaire et documenté, sans repli
  silencieux sur une clé anon.
- **CSP** : `script-src` sans `unsafe-inline`, contrôle de régression en test.
- **Service worker** : plus aucune mise en cache des réponses `/api/`.
- **Seed admin** : ne peut plus écraser un compte existant.
- **Verrous de portefeuille** : toutes les mutations passent par
  `withWalletMutex`, puis `updateUserAccount`.

## Documents

- [01 — Sécurité & secrets](01-securite.md)

## Méthode

Trois outils d'analyse reproductibles sont utilisés, leurs résultats sont
cités dans les documents :

- inventaire des variables d'environnement (lieu de lecture, repli, défaut) ;
- matrice d'autorisation (route → garde appliquée) ;
- détection de chevauchement de routes (l'ordre d'évaluation a-t-il une
  portée sémantique ?).