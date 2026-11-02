# ZOYD - Plateforme de Compétition Call of Duty Mobile

## 🎮 À propos

ZOYD est une plateforme de compétition Call of Duty Mobile dédiée à
l'Afrique francophone. Elle permet aux joueurs de s'affronter dans des matchs
instantanés (1v1 à 5v5), des salons **Battle Royale**, des tournois et des
ligues saisonnières — un **arbitre** (un joueur comme les autres) valide le
résultat et est rémunéré pour ce rôle. Les gains sont des **ZOYD Coins (ZC)**
retirables en Mobile Money.

> Documentation complète : `docs/` (entrer par `docs/00-INDEX.md`).

## 🛠️ Stack Technique

### Core
- **React 19.3** - Framework UI
- **TypeScript** - Type safety
- **React Router 8** - Navigation et routing (`routes.tsx` : 35 entrées)
- **Vite 8** - Build tool (découpe Rolldown `codeSplitting.groups`)

### État & Data
- **Zustand 5** - État global (13 stores, **aucun ne persiste** : la session
  vit dans un cookie httpOnly)
- **Socket.IO 4.8** - Temps réel (matchs live, chat, présence, notifications)
- **API clients maison** - `src/app/lib/` (un client par module backend)

### UI/UX
- **Tailwind CSS v4** - Styling utility-first
- **Motion (Framer Motion)** - Animations fluides
- **Lucide React** - Icônes
- **Toasts maison** - `src/app/lib/toast.ts` (surface d'appel calquée sur
  `sonner`, sans dépendance)
- **Recharts** - Graphiques (charts earnings / admin)

### Formulaires
- **React Hook Form** - Gestion de formulaires performante
- **Zod** - Validation de schémas TypeScript-first

### Design System
- **Couleurs**: Noir, Blanc, Jaune et Bleu — déclarés dans `src/styles/theme.css` (`--color-*`) et exposés en `zoyd-*`
- **Fonts**:
  - Rajdhani (Display/Headings)
  - Inter (UI/Body text)
  - Auto-hébergées (plus aucune requête fonts.googleapis/gstatic, durcissement du 01/11/2026)
- **Animations**: Toutes powered by Motion

## 📂 Structure du Projet

```
src/
├── app/
│   ├── components/
│   │   ├── ui/               # Composants de base (Button, Card, Badge,
│   │   │                     #   Input, Modal, Tabs, Skeleton...)
│   │   ├── layout/           # Navbar, Sidebar, BottomNav
│   │   ├── branding/         # ZoydLogo, SocialIcons
│   │   ├── notifications/    # ToastContainer, NotificationDropdown
│   │   ├── profile/          # ProfileView
│   │   ├── social/           # FriendsWidget
│   │   └── MatchCard.tsx     # Carte de match réutilisable
│   ├── hooks/                # useAuthSessionBootstrap, useServiceWorker...
│   ├── layouts/              # RootLayout, AppLayout, AuthLayout
│   ├── lib/                  # apiClient + un client par module backend
│   │                         #   (auth, wallet, social, chat, br...)
│   ├── pages/                # Landing, Wallet, Chat, Profil, Admin... ;
│   │   └── legal/            #   6 pages légales statiques
│   ├── stores/              # 12 stores Zustand + 1 alias de compat.
│   │                         #   (auth, socketConnection, match, tournament,
│   │                         #   league, wallet, chat, friends,
│   │                         #   notification, presence, trustScore, toast)
│   ├── routes.tsx            # 35 entrées de routing
│   └── App.tsx               # Point d'entrée React
├── features/
│   ├── match/                # MatchDetailPage, MatchChat
│   ├── tournament/           # TournoisPage, TournamentBracketPage
│   ├── league/               # LeaguePage, LeagueSeasonPage
│   └── br/                   # BrPage, BrLobbyDetailPage, panels
│                             #   creation + arbitre BR
├── lib/                      # competition.ts (calculs de classement), utils.ts
├── assets/                   # Images, polices auto-hébergées, cartes CODM
└── styles/
    ├── fonts.css             # Polices auto-hébergées
    ├── theme.css             # Variables CSS custom
    ├── tailwind.css
    └── index.css
```

## 🎨 Design System

### Composants UI de Base

#### Button
```tsx
<Button variant="primary" size="lg">COMMENCER</Button>
<Button variant="secondary">ANNULER</Button>
<Button variant="ghost">VOIR PLUS</Button>
```

Variants: `primary` (jaune), `secondary` (blanc outline), `ghost` (transparent)
Sizes: `sm`, `md`, `lg`, `xl`

#### Card
```tsx
<Card hover animate>
  <CardHeader>
    <CardTitle>Titre</CardTitle>
    <CardDescription>Description</CardDescription>
  </CardHeader>
  <CardContent>Contenu</CardContent>
  <CardFooter>Actions</CardFooter>
</Card>
```

#### Badge
```tsx
<Badge variant="yellow">OUVERT</Badge>
<Badge variant="live">LIVE</Badge>
<Badge variant="disabled">BIENTÔT</Badge>
```

#### Input
```tsx
<Input 
  label="Email" 
  error="Message d'erreur"
  helperText="Texte d'aide"
  placeholder="ton@email.com"
/>
```

### Couleurs Tailwind Custom

```css
/* Principales — valeurs réelles : src/styles/theme.css */
bg-zoyd-black    /* #050505 */
bg-zoyd-white    /* #FFFFFF */
bg-zoyd-yellow   /* #FFFF00 */
bg-zoyd-blue     /* #0070FF */

/* Surfaces — valeurs réelles : src/styles/theme.css */
bg-zoyd-surface  /* #0A0A0A */
border-zoyd-border /* #1A1A1A */
text-zoyd-muted  /* rgba(255, 255, 255, 0.4) */

/* Fonds semi-transparents : opacités arbitraires Tailwind sur les couleurs
   natives (bg-black/80, bg-white/5, ...). AUCUN token d'opacité dédié
   n'existe dans theme.css — ne pas écrire bg-zoyd-black-80. */
```

### Animations Custom

```css
animate-pulse-yellow    /* Pulse jaune pour badges LIVE (theme.css) */
animate-marquee         /* Scroll horizontal infini (theme.css) */
```

## 🔑 Fonctionnalités Implémentées

> État vérifié le 02/11/2026 contre `src/app/routes.tsx`, `server/` et
> `docs/audit-4/00-SYNTHESE.md`. Le détail de ce qui n'est PAS garanti est
> dans `docs/03-securite.md` et `docs/05-invariants.md`.

### ✅ Auth
- [x] Landing page avec animations
- [x] Inscription 3 étapes (Compte, Gaming Config, Wallet)
- [x] Connexion, activation par code, mot de passe oublié
- [x] Sessions **cookie-only** (aucun token en localStorage : `authStore.ts:8`)
- [x] Verrouillage anti-bruteforce persistant + RLS service-role

### ✅ Sélection de mode
- [x] `/mode` : Battle Royale d'abord, MultiJoueur ensuite

### ✅ Battle Royale (BR)
- [x] Salons `/br` + `/br/:lobbyId` avec démarrage 24-48 h d'avance
- [x] 4 variantes exposées par `GET /api/br/config`
- [x] Panel de création + panel **arbitre** BR
- [x] Ligues BR saisonnières `/br-league` + `/br-league/:seasonId` (top 40)

### ✅ MultiJoueur (MJ)
- [x] Hub `/mj` avec filtres (format, pot), MatchCard complète
- [x] Création de match (wizard 4 étapes)
- [x] Détail match `/mj/match/:id` + salon live
- [x] Dashboard arbitre + confirmation qui déclenche le paiement du pot
- [x] Intégration Socket.IO complète (état, wallet, chat, présence)

### ✅ Tournois
- [x] Listing `/mj/tournois`, création, inscriptions
- [x] Bracket visuel `/mj/tournois/:id`
- [x] Picks en alternance (BO3) + ordre des manches harmonisé (02/11/2026)

### ✅ Chat & Social
- [x] Canaux global + privé + salons de match (présence, « en train d'écrire »)
- [x] Liste d'amis (demandes, ajout, retrait), blocages
- [x] Signalements + modération admin (rapports, sanctions)

### ✅ Wallet
- [x] Page wallet complète : solde, historique, modales dépôt/retrait
- [x] Dépôt via FedaPay (Mobile Money) — checkout embarqué
- [x] Retrait avec **commission 2%** (`wallet-engine.mjs`), plafond journalier
- [x] Opérateurs par pays : MTN/Moov/Celtiis (BJ), MTN/Moov/Orange/Wave (CI),
      Orange/Wave (SN), Moov/Togocel (TG)

### ✅ Profil & pages
- [x] Profil `/profil` + profil public `/profil/:id`
- [x] Classements `/classements` (gateway anonyme = public / authentifié = app)
- [x] Paramètres, gains `/earnings`, infos `/infos`
- [x] PWA (service worker), SEO (SEOHead + canonique, contrôle CSP)

### ✅ Admin
- [x] Dashboard `/admin` (route protégée `requireAdmin`)
- [x] 2FA TOTP admin, export matchs, modération, stats commissions

## 🚀 Démarrage Rapide

Prérequis : **Node.js 22.13+** (`.nvmrc`), **pnpm 11**.

```bash
# Installation
pnpm install        # sur exFAT : CI=true pnpm install --config.node-linker=hoisted

# Front seul
pnpm dev

# Front + API temps réel (dev-runner)
pnpm dev:full

# Build production
pnpm build

# Qualité
pnpm lint           # eslint --max-warnings 0
pnpm test:run       # vitest run (portée server/)
pnpm test:e2e       # Playwright, projets api + ui (jamais live)
```

Variables : copier `.env.example` (front, `VITE_REALTIME_URL`,
`VITE_FEDAPAY_PUBLIC_KEY`) et `.env.server.example` (backend). **Jamais de
secret côté `VITE_*`** : tout ce qui porte ce préfixe finit dans le bundle.

## 🎯 Parcours Utilisateur

### 1. Landing → Inscription
- Utilisateur arrive sur landing page
- Clique sur "COMMENCER MAINTENANT"
- Complète l'inscription en 3 étapes
- Redirigé vers sélection de mode

### 2. Sélection Mode
- **Battle Royale** : crée ou rejoint un salon (`/br`), s'engage sur
  une manche unique, arbitre dédié
- **MultiJoueur** : arrive sur le Hub MJ, voit les matchs disponibles
  avec filtres, peut créer ou rejoindre

### 3. Création de Match
- Clique sur "CRÉER UN MATCH"
- Wizard 4 étapes:
  1. Format (1v1 à 5v5)
  2. Règles (mode, carte, score, armes)
  3. Économie (pot, arbitre, public/privé)
  4. Récapitulatif + Publication

### 4. Wallet
- Accès via Navbar ou Sidebar
- Consultation solde et transactions
- Dépôt via Mobile Money (FedaPay selon le pays)
- Retrait avec commission 2% et plafond journalier

## 📱 Responsive

- **Mobile**: Bottom navigation + layout optimisé
- **Tablet**: Mêmes vues que mobile avec plus d'espace
- **Desktop**: Sidebar permanente + layout étendu

## 🎨 Conventions de Code

### Nommage
- Composants: PascalCase (`MatchCard.tsx`)
- Hooks/Utils: camelCase (`useAuthStore.ts`)
- CSS Classes: kebab-case (`bg-zoyd-yellow`)
- Instructions d'architecture vive dans `docs/` :
  `docs/00-INDEX.md` pointe chaque sujet (routes, sécurité, tests, argent,
  exploitation) — **lire le doc correspondant AVANT toute modification**.

### Imports
```tsx
// React & libs
import { useNavigate } from 'react-router';

// Components
import { Button } from '../components/ui/Button';

// Stores & utils
import { useAuthStore } from '../stores/authStore';
import { cn } from '../../lib/utils';
```

### Composants
```tsx
interface ComponentProps {
  // Props typées
}

const Component: React.FC<ComponentProps> = ({ props }) => {
  // Hooks en premier
  // States
  // Fonctions handlers
  // Return JSX
};

export { Component };
```

Les fichiers significatifs portent un **en-tête de commentaire** (rôle,
invariants, pièges) : 38/40 fichiers `server/`, la majorité de `src/`.

## 🔮 Axes Suivants

La feuille de route vivante est tenue dans `docs/00-INDEX.md` et
`docs/audit-4/00-SYNTHESE.md`. Axes connus au 02/11/2026 :

1. **Webhook FedaPay** — les retraits vivent en `pending_review` avec
   réconciliation manuelle ; aucun webhook de payout dans le code.
2. **Multi-instance** — le single-process-guard est la seule barrière ;
   l'OCC `revision` protège `app_users` (prod : colonne présente).

---

**Fait avec ⚡ par l'équipe ZOYD - African Gaming Infrastructure**
