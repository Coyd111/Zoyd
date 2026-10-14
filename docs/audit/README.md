# Audit ZOYD — tableau de bord

Audit en 8 étapes, par risque décroissant. Chaque étape a son document et
son propre lot de correctifs, committés séparément.

Projet : ~60 000 lignes de code (hors images), 100 routes HTTP, 11 modules de
routes, 540 tests unitaires, 135 E2E API, 41 E2E UI.

## Avancement

| # | Étape | Statut | Constat principal |
|---|-------|--------|-------------------|
| 0 | Cartographie | fait | 5 zones, dette faible (3 TODO) |
| 1 | Sécurité & secrets | **fait** | 25 variables d'environnement non documentées |
| 2 | Argent & intégrité financière | **fait** | fenêtre de double crédit sur les dépôts FedaPay |
| 3 | Données & persistance | **fait** | `user_reports` sans DDL ; signalements jamais relus |
| 4 | Concurrence & temps réel | **fait** | après coupure, l'interface affiche « live » avec un état périmé ; config de tests décrivant un environnement inexistant |
| 5 | Performance & bundle | **fait** | 364 kB de graphiques sur le chemin critique ; 12,8 Mo de doublons d'images ; fonds 4K à 13,1 Mo |
| 6 | Qualité, tests & dépendances | **fait** | couverture jamais mesurable (outil absent) ; 2FA admin et fusion des deltas sans aucun test |
| 7 | Produit & accessibilité | **fait** | audit axe-core : 0 blocage sur les 5 pages publiques ; animations JS ignorant la préférence système |
| 8 | Documentation & exploitation | à faire | — |

## Constats ouverts

| Sév. | Constat | Où | Action |
|------|---------|-----|--------|
| Moyenne | 25 variables d'environnement sur 30 ne sont documentées ni dans `DEPLOYMENT.md` ni dans `README.md` ; 13 seulement sont déclarées dans `render.yaml` | dépôt | compléter la référence (étape 8) |
| Faible | La comparaison du jeton `/metrics` n'est pas en temps constant (`!==`) | `server/routes/public.mjs` | **corrigé** — comparaison de hachages |
| Faible | `NODE_ENV=test` **et** `ALLOW_DEBUG_CODES=true` désactivent tout le rate limiting | `server/rate-limiter.mjs` | **corrigé** — exige en plus une base désactivée |
| Info | `lockFunds`/`unlockFunds` : code mort d'UI optimiste sur des fonds | `src/app/stores/walletStore.ts` | **supprimé** — doublait le verrouillage serveur |
| Info | 4 canaux d'envoi de code coexistent (Resend, Brevo, SMTP, webhook) | `server/code-delivery.mjs` | documenter la precedence |
| Info | Conversion FedaPay `amount / 10` non confirmée en réel | `server/payment-engine.mjs` | bloqué : clés live requises |
| Info | Verrous en mémoire, corrects pour un processus ; un déploiement est une fenêtre à deux instances | ensemble des moteurs | **documenté** (étape 4) — risque résiduel faible, parades listées |
| Moyenne | `user_reports` utilisée par le code sans DDL dans le dépôt | `supabase/schema.sql` | **corrigé** — DDL et index ajoutés |
| Moyenne | Les signalements sont écrits en base mais **jamais relus** : le tableau de bord admin n'affiche que ceux faits dans ce navigateur | `friendsStore`, `AdminDashboardPage` | **décision produit** — il manque une route de lecture admin |
| Haute | Après une coupure socket, l'interface repassait « live » sans resynchroniser : tout le delta perdu était définitif | `socketConnectionStore`, `useRealtimeHeartbeat` | **corrigé** — reprise au retour du socket |
| Moyenne | `vitest.config.ts` déclarait `jsdom`, qui n'est pas installé : les tests tournaient en Node sans le dire | `vitest.config.ts` | **corrigé** — mode `node` explicite |
| Faible | `POST /api/realtime/state/sync` renvoie 409 ou 400 pour tout, et son appelant n'est jamais utilisé | `server/routes/realtime.mjs` | documenté — suppression = changement de contrat |
| Haute | 364 kB de graphiques sur le chemin critique : `clsx` partagé tirait tout le chunk `recharts` | `vite.config.ts` | **corrigé** — chunk `vendor-utils` isolé |
| Haute | 12,8 Mo d'images livrées en double, et fonds 4K à 13,1 Mo dont la page de connexion | `public/assets/` | **corrigé** — 26,5 Mo ramenés à 2,1 Mo |
| Moyenne | Les animations JavaScript (26 composants) ignoraient `prefers-reduced-motion`, respecté uniquement pour le CSS | `src/app/App.tsx` | **corrigé** — `MotionConfig reducedMotion="user"` |
| Info | Audit axe-core réel : **0 violation** bloquante sur accueil, connexion, inscription, mot de passe oublié, sélection de mode | `e2e/ui/accessibility.spec.ts` | conformité mesurée et verrouillée par un test |
| Info | Polices chargées depuis Google Fonts : dépendance tierce, feuille bloquante, et bascule visible si le CDN est inaccessible | `index.html` | non corrigé — auto-hébergement à trancher |

| Moyenne | `test:coverage` échouait : `@vitest/coverage-v8` absent malgré une config qui l'exige | `vitest.config.ts`, `package.json` | **corrigé** — dépendance ajoutée, couverture mesurée |
| Haute | La 2FA de l'admin — clé de voûte de toute opération financière — n'avait aucun test | `server/admin-totp.mjs` | **corrigé** — 15 tests, vecteurs RFC 6238, conforme |
| Moyenne | Le contrat « delta → fusion » des matchs n'était protégé que par un commentaire | `src/app/stores/matchStore.ts` | **corrigé** — 10 tests, 14 % → 39 % |
| Info | Les stores client ne sont couverts qu'à 33 % (`friendsStore` 3 %) | `src/app/stores/` | constat ouvert — suite à donner |

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
- **Dépôt FedaPay** : réservation atomique *avant* le crédit, libération si
  l'écriture échoue ; anti-vol par appartenance de la transaction.
- **Règlement des matchs** en deux phases (`payoutDistributed: 'pending'`
  avant versement), donc pas de versement orphelin après un crash.
- **Idempotence des retraits** : index dédié, hydraté au chargement, donc
  elle survit à un redémarrage.

## Documents

- [01 - Securite & secrets](01-securite.md)
- [02 — Argent et intégrité financière](02-argent.md)
- [03 - Donnees et persistance](03-donnees.md)
- [04 - Concurrence et temps reel](04-concurrence.md)
- [05 - Performance et bundle](05-performance.md)
- [06 - Qualite, tests et dependances](06-qualite.md)
- [07 - Produit et accessibilite](07-produit.md)

## Méthode

Trois outils d'analyse reproductibles sont utilisés, leurs résultats sont
cités dans les documents :

- inventaire des variables d'environnement (lieu de lecture, repli, défaut) ;
- matrice d'autorisation (route → garde appliquée) ;
- détection de chevauchement de routes (l'ordre d'évaluation a-t-il une
  portée sémantique ?).
