# ZOYD — Présentation Complète du Projet

## 1. Vision

**ZOYD** est une **plateforme de compétition gaming** dédiée au **Call of Duty Mobile (CODM)**, permettant aux joueurs de s'affronter en matchs 1v1 et 5v5 avec mise en jeu réelle (Zoyd Coins / FCFA). La plateforme gère l'intégralité du cycle de vie d'un match : création, arbitrage, résultat, paiement et litiges — le tout en temps réel.

**Marché cible** : Afrique de l'Ouest (Bénin, Côte d'Ivoire, Sénégal…) où le CODM et les paris esports sont très populaires.

---

## 2. Stack Technique

| Couche | Technologie |
|---|---|
| **Frontend** | React 18 + TypeScript + Vite 6.3 |
| **UI** | Tailwind CSS v4 + Radix UI + MUI Icons |
| **State** | Zustand 5 + SWR |
| **Routing** | react-router v7 (22 routes lazy-loaded) |
| **Backend** | Node.js ESM monolithique (1 fichier, 2 391 lignes) |
| **Temps réel** | Socket.IO 4.8 (présence, chat, sync d'état) |
| **Base de données** | Supabase (PostgreSQL) + cache mémoire in-process |
| **Paiements** | FedaPay (Mobile Money, FCFA) |
| **Notifications** | Web Push (VAPID) |
| **Tests** | Vitest (149 unit) + Playwright (34 E2E) |
| **Déploiement** | Render (render.yaml) |
| **Package manager** | pnpm 11 |

---

## 3. Architecture

```
┌─────────────────────────────────────────────────┐
│                    FRONTEND                      │
│  React 18 + TypeScript + Vite                    │
│  22 routes · 137 fichiers · 24 000+ lignes      │
│  Zustand stores (14) · Socket.IO client          │
├─────────────────────────────────────────────────┤
│                    API REST                       │
│  68 endpoints HTTP (GET/POST/PATCH/DELETE)        │
│  Rate limiting par groupe (auth, wallet, chat…)  │
│  Auth: Bearer token (UUID)                       │
├─────────────────────────────────────────────────┤
│                REALTIME SERVER                    │
│  Node.js ESM monolithique (2 391 lignes)         │
│  Socket.IO : 7 événements (presence, chat, sync) │
│  Cron jobs : matchs inactifs, inscriptions ligue │
│  Notifications push (web-push + VAPID)           │
├─────────────────────────────────────────────────┤
│              MOTEURS MÉTIER                      │
│  match-engine (856l) · tournament-engine (970l)  │
│  league-engine (740l) · wallet-engine (195l)     │
│  payment-engine (64l) · persistence (839l)       │
├─────────────────────────────────────────────────┤
│              BASE DE DONNÉES                     │
│  Supabase (PostgreSQL) · 14 tables               │
│  Cache mémoire in-process (14 Maps/Sets)         │
│  Sync automatique Supabase ↔ mémoire             │
└─────────────────────────────────────────────────┘
```

---

## 4. Métriques du Code

| Métrique | Valeur |
|---|---|
| **Fichiers source** | ~173 |
| **Lignes de code** | ~33 500 |
| **Fichiers serveur** | 18 (.mjs) |
| **Fichiers frontend** | 137 (.ts/.tsx/.css) |
| **Routes frontend** | 22 |
| **Endpoints API** | 68 |
| **Événements Socket.IO** | 7 |
| **Tables BDD** | 14 |
| **Packages npm** | 73 (66 deps + 7 devDeps) |
| **Fichiers de test** | 11 |
| **Tests unitaires** | 149 ✅ |
| **Tests E2E** | 34 ✅ |
| **Build Vite** | ✅ (~2min) |
| **Commits** | 28 (1 contributeur, 2026) |

---

## 5. Fonctionnalités

### 5.1 Authentification
- Inscription (pseudo, email, téléphone, UID CODM, mot de passe)
- Connexion par pseudo, email ou téléphone
- Sessions Bearer token (UUID)
- Changement de mot de passe
- Logout (invalidation session)

### 5.2 Matchs (MJ — Mode Jeton)
- Création de matchs **1v1** et **5v5**
- Frais d'entrée en Zoyd Coins (ZC) — 1 ZC = 10 FCFA
- Système d'**arbitrage** : un joueur neutre valide le résultat
- Workflow complet : Recrutement → Check-in → Ready → Lancement → Résultat → Confirmation → Paiement
- Système de **litiges** (disputes) avec escalade admin
- Preuves obligatoires (screenshots scoreboard + résultat final)
- Chat intégré par match

### 5.3 Tournois (MJ)
- Tournois à **bracket éliminatoire**
- Inscriptions, assignation d'arbitres
- Salle de match, résultats par round
- Bracket visualisé en temps réel

### 5.4 Battle Royale League (BR League)
- Système de **ligue hebdomadaire** (max 500 joueurs)
- Inscription payante (50 ZC de base)
- **5 jours de qualification** (100 joueurs/jour)
- **Finale** : Top 40 qualifiés
- **Score Z** = Survie + Kills :
  - 1er = 25 pts, 2e = 20, 3e = 17, 4e = 15, 5e = 13
  - 6e-10e = 10, 11e-20e = 6, 21e-40e = 3, 41e-100e = 0
  - 1 kill = 2 points
- Podium : 60% / 25% / 15%
- XP et progression intégrées

### 5.5 Portefeuille & Paiements
- **Zoyd Coins** (ZC) : monnaie interne (1 ZC = 10 FCFA)
- Dépôt via FedaPay (Mobile Money)
- Retrait via Mobile Money
- Idempotence des transactions (clé DB)
- Wallet avec solde, bonus, montant verrouillé

### 5.6 Social
- Système d'amis (demandes, acceptation, refus, suppression)
- Blocage d'utilisateurs
- Recherche de joueurs
- Profils publics

### 5.7 Chat
- Chat global (canal #général)
- Chat par match
- Bootstrap canal + messages
- Marquer lu / non lu

### 5.8 Notifications
- Notifications push (Web Push / VAPID)
- Types : demande d'ami, résultat, litige, tournoi, ligue
- Lu / non lu / marquer tout lu

### 5.9 Administration
- Dashboard admin
- Attribution manuelle de gains
- Résolution de litiges
- Annulation de matchs

### 5.10 Classements
- Leaderboard global (ELO, win rate, gains)
- Classements par catégorie

---

## 6. Moteurs Métier (Serveur)

| Moteur | Lignes | Responsabilité |
|---|---|---|
| `realtime-server.mjs` | 2 391 | HTTP + Socket.IO + routing + rate limiting |
| `tournament-engine.mjs` | 970 | Logique tournois (bracket, rounds, résultats) |
| `match-engine.mjs` | 856 | Logique matchs (create, join, result, disputes) |
| `persistence.mjs` | 839 | Cache mémoire + Supabase sync + CRUD |
| `league-engine.mjs` | 740 | BR League (qualification, jours, finale, Score Z) |
| `wallet-engine.mjs` | 195 | Portefeuille (dépôt, retrait, verrouillage) |
| `cron.mjs` | 85 | Tâches planifiées (nettoyage, inscriptions ligue) |
| `logger.mjs` | 69 | Logger structuré JSON (5 levels) |
| `payment-engine.mjs` | 64 | Vérification FedaPay + idempotence |
| `supabase.mjs` | 34 | Client Supabase service_role |

---

## 7. Frontend — Pages Principales

| Page | Lignes | Description |
|---|---|---|
| `MatchDetailPage.tsx` | 1 155 | Détail d'un match (chat, result, disputes) |
| `TournamentBracketPage.tsx` | 998 | Bracket de tournoi interactif |
| `AdminDashboardPage.tsx` | 979 | Dashboard administrateur |
| `LeagueSeasonPage.tsx` | 964 | Saison BR League + admin panel |
| `CreateTournamentPage.tsx` | 637 | Création de tournoi |
| `ParametresPage.tsx` | 540 | Paramètres utilisateur |
| `RegisterPage.tsx` | 533 | Inscription |
| `LandingPage.tsx` | 485 | Page d'accueil marketing |
| `CreateMatchPage.tsx` | 479 | Création de match |
| `WalletPage.tsx` | 425 | Portefeuille |

---

## 8. Base de Données (14 tables)

| Table | Rôle |
|---|---|
| `app_users` | Profils joueurs |
| `auth_sessions` | Sessions d'authentification |
| `realtime_sessions` | Sessions Socket.IO |
| `push_subscriptions` | Abonnements notifications push |
| `chat_channels` | Canaux de discussion |
| `chat_messages` | Messages de chat |
| `chat_reads` | État de lecture des messages |
| `state_snapshots` | Cache état serveur (matches, tournois, ligues) |
| `friend_requests` | Demandes d'amis |
| `friendships` | Amitiés confirmées |
| `user_blocks` | Blocages |
| `user_notifications` | Notifications |
| `processed_transactions` | Transactions FedaPay traitées |
| `wallet_transactions` | Historique de transactions wallet |

---

## 9. Infra & Sécurité

- **Rate limiting** : 5 groupes (auth 50/15min, wallet 20/10min, social 30/1min, chat 60/1min, admin 20/5min)
- **Logging structuré** : JSON avec timestamps, levels (debug→fatal), modules
- **Auth** : Bearer token UUID, mot de passe scrypt (salt + 64 bytes)
- **Idempotence** : transactions FedaPay vérifiées en DB avant crédit
- **CORS** : whitelist d'origins
- **Body limit** : 1 MB max par requête
- **Admin** : protection role-based sur les endpoints critiques

---

## 10. Historique des Commits (28)

| Phase | Commits | Description |
|---|---|---|
| **Fondation** | 1-5 | Structure React, routing, composants UI |
| **Backend** | 6-10 | Serveur temps réel, auth, WebSocket |
| **Intégration** | 11-15 | Supabase, FedaPay, déploiement Render |
| **Features** | 16-20 | Social, admin, litiges, tournois |
| **Migration** | 21-25 | Migration persistence → Supabase, fix bugs critiques |
| **Finalisation** | 26-28 | Password change, leaderboard, notifications, nettoyage |
| **Infrastructure** | hors git | Rate limiting, logging, OpenAPI, E2E tests, BR League |

---

## 11. État Actuel

| Aspect | Status |
|---|---|
| **Frontend** | ✅ 22 routes, toutes wirées au serveur |
| **Backend** | ✅ 68 endpoints REST + 7 Socket.IO events |
| **BDD** | ✅ 14 tables Supabase, cache mémoire |
| **Paiements** | ✅ FedaPay intégré, idempotent |
| **Tests** | ✅ 149 unit + 34 E2E = **183 tests** |
| **Build** | ✅ Vite build réussi |
| **Documentation** | ✅ OpenAPI 3.1 (2 945 lignes) |
| **Logging** | ✅ Structuré JSON (logger.mjs) |
| **Rate limiting** | ✅ 5 groupes configurés |
| **Notifications** | ✅ Web Push + VAPID |
| **SQL RLS** | ⏳ Script prêt, à appliquer via dashboard |
| **Tests E2E browser** | ⏳ Non implémentés (Playwright API-only) |
| **Monitoring** | ❌ Pas de métriques Prometheus |
| **Cache Redis** | ❌ Non implémenté (scaling horizontal limité) |
| **Migration DB** | ⏳ Scripts SQL manuels, pas de Drizzle/Knex |

---

## 12. Déploiement

- **Hébergement** : Render (render.yaml configuré)
- **Variables d'env** : `.env.server` (Supabase, FedaPay, VAPID)
- **Build** : `vite build` → `dist/`
- **Start** : `node server/realtime-server.mjs` (port 4001)
- **Frontend** : servis depuis `dist/` via Vite dev server (proxy → :4001)
- **Domaine** : `zoyd.africa` / `www.zoyd.africa`

---

## 13. Roadmap

| Priorité | Tâche | Status |
|---|---|---|
| 🔴 Haute | Appliquer SQL RLS via dashboard Supabase | ⏳ |
| 🟡 Moyenne | Tests E2E navigateur (Playwright browser) | ⏳ |
| 🟡 Moyenne | Monitoring Prometheus + Grafana | ❌ |
| 🟢 Basse | Cache Redis pour scaling horizontal | ❌ |
| 🟢 Basse | Drizzle ORM comme migration tool | ❌ |
| 🟢 Basse | Logging structuré avancé (pinston) | ❌ |
