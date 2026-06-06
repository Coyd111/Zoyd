# ZOYD - Plateforme de Compétition Call of Duty Mobile

## 🎮 À propos

ZOYD est une plateforme de compétition Call of Duty Mobile dédiée à l'Afrique. Elle permet aux joueurs de s'affronter dans des matchs instantanés, de participer à des tournois, et de gagner des ZOYD Dollars (ZD) retirables en Mobile Money.

## 🛠️ Stack Technique

### Core
- **React 18.3** - Framework UI
- **TypeScript** - Type safety
- **React Router 7** - Navigation et routing
- **Vite** - Build tool ultra-rapide

### État & Data
- **Zustand** - État global simplifié (auth, socket)
- **SWR** - Data fetching avec cache et revalidation
- **Socket.io Client** - Temps réel (matchs live, notifications)

### UI/UX
- **Tailwind CSS v4** - Styling utility-first
- **Motion (Framer Motion)** - Animations fluides
- **Lucide React** - Icons modernes
- **Sonner** - Toast notifications

### Formulaires
- **React Hook Form** - Gestion de formulaires performante
- **Zod** - Validation de schémas TypeScript-first

### Design System
- **Couleurs**: Noir (#000), Blanc (#FFF), Jaune (#FFD700) uniquement
- **Fonts**: 
  - Rajdhani (Display/Headings)
  - Inter (UI/Body text)
- **Animations**: Toutes powered by Motion

## 📂 Structure du Projet

```
src/
├── app/
│   ├── components/
│   │   ├── ui/              # Composants de base (Button, Card, Input, etc.)
│   │   ├── layout/          # Layout (Navbar, Sidebar, BottomNav)
│   │   ├── MatchCard.tsx    # Composant match spécifique
│   │   ├── LiveTicker.tsx   # Ticker de matchs live
│   │   └── CountdownTimer.tsx
│   ├── layouts/
│   │   ├── RootLayout.tsx
│   │   ├── AuthLayout.tsx
│   │   └── DashboardLayout.tsx
│   ├── pages/
│   │   ├── LandingPage.tsx
│   │   ├── ModeSelectionPage.tsx
│   │   ├── WalletPage.tsx
│   │   ├── NotFoundPage.tsx
│   │   ├── auth/
│   │   │   ├── LoginPage.tsx
│   │   │   └── RegisterPage.tsx
│   │   └── mj/
│   │       ├── HubMJPage.tsx
│   │       └── CreateMatchPage.tsx
│   ├── stores/
│   │   ├── authStore.ts     # Store Zustand auth
│   │   └── socketStore.ts   # Store Zustand socket
│   ├── routes.tsx
│   └── App.tsx
├── lib/
│   └── utils.ts             # Utilitaires (cn, formatters)
└── styles/
    ├── fonts.css            # Import Google Fonts
    ├── theme.css            # Variables CSS custom
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
/* Principales */
bg-zoyd-black    /* #000000 */
bg-zoyd-white    /* #FFFFFF */
bg-zoyd-yellow   /* #FFD700 */

/* Opacités blanches */
bg-zoyd-white-3  /* rgba(255, 255, 255, 0.03) */
bg-zoyd-white-5  /* rgba(255, 255, 255, 0.05) */
bg-zoyd-white-10 /* rgba(255, 255, 255, 0.10) */
bg-zoyd-white-20 /* rgba(255, 255, 255, 0.20) */
bg-zoyd-white-30 /* rgba(255, 255, 255, 0.30) */
bg-zoyd-white-50 /* rgba(255, 255, 255, 0.50) */
bg-zoyd-white-60 /* rgba(255, 255, 255, 0.60) */

/* Opacités noires */
bg-zoyd-black-60 /* rgba(0, 0, 0, 0.60) */
bg-zoyd-black-75 /* rgba(0, 0, 0, 0.75) */
bg-zoyd-black-80 /* rgba(0, 0, 0, 0.80) */
```

### Animations Custom

```css
animate-pulse-yellow    /* Pulse jaune pour badges LIVE */
animate-skeleton        /* Loading skeleton */
animate-marquee         /* Scroll horizontal infini */
animate-bounce-slow     /* Bounce lent pour indicateurs */
```

## 🔑 Fonctionnalités Implémentées

### ✅ Phase 1 - Design System
- [x] Configuration Tailwind noir/blanc/jaune
- [x] Import Google Fonts (Rajdhani + Inter)
- [x] Composants UI de base (Button, Card, Badge, Input, Modal)
- [x] Layout (Navbar, Sidebar, BottomNav)
- [x] Animations Motion réutilisables

### ✅ Phase 2 - Auth Flow
- [x] Landing page avec animations
- [x] Page inscription 3 étapes (Compte, Gaming Config, Wallet)
- [x] Page connexion
- [x] Page sélection mode (MJ/BR)
- [x] Store Zustand pour l'authentification

### ✅ Phase 3 - Hub MJ (Partiel)
- [x] Hub MJ avec filtres (format, pot)
- [x] MatchCard composant complet
- [x] Listing matchs disponibles
- [x] Preview tournois
- [x] Mini classement hebdomadaire
- [x] LiveTicker pour matchs en cours

### ✅ Phase 4 - Match Flow (Partiel)
- [x] Page création de match (wizard 4 étapes)
- [ ] Page détail match
- [ ] Salon de coordination
- [ ] Dashboard arbitre
- [ ] Socket.io intégration complète

### ✅ Wallet
- [x] Page wallet complète
- [x] Modales dépôt/retrait
- [x] Historique transactions
- [x] Gestion ZOYD Coins

### 🚧 À Implémenter (Phases suivantes)

#### Phase 5 - Tournois
- [ ] Listing tournois complet avec filtres
- [ ] Page détail tournoi + bracket visuel
- [ ] Système d'inscription tournoi
- [ ] Page création tournoi

#### Phase 6 - Profil et Social
- [ ] Dashboard joueur
- [ ] Profil public avec stats
- [ ] Page classements avec podium
- [ ] Chat (global + privé + salons match)
- [ ] Système d'amis

#### Phase 7 - Pages Manquantes
- [ ] Page détail match avec salon
- [ ] Page paramètres complète
- [ ] États vides et erreurs

#### Phase 8 - Polish Final
- [ ] Optimisations performance
- [ ] Tests responsiveness mobile complet
- [ ] Animations finales
- [ ] Lighthouse score > 85

## 🚀 Démarrage Rapide

```bash
# Installation
pnpm install

# Développement
pnpm dev

# Build production
pnpm build
```

## 🎯 Parcours Utilisateur

### 1. Landing → Inscription
- Utilisateur arrive sur landing page
- Clique sur "COMMENCER MAINTENANT"
- Complète l'inscription en 3 étapes
- Redirigé vers sélection de mode

### 2. Sélection Mode → Hub MJ
- Choisit "MULTIJOUEUR"
- Arrive sur Hub MJ
- Voit les matchs disponibles avec filtres
- Peut créer un match ou rejoindre un existant

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
- Dépôt via Mobile Money (MTN, Moov, Orange)
- Retrait avec commission 2%

## 📱 Responsive

- **Mobile**: Bottom navigation + layout optimisé
- **Tablet**: Mêmes vues que mobile avec plus d'espace
- **Desktop**: Sidebar permanente + layout étendu

## 🎨 Conventions de Code

### Nommage
- Composants: PascalCase (`MatchCard.tsx`)
- Hooks/Utils: camelCase (`useAuthStore.ts`)
- CSS Classes: kebab-case (`bg-zoyd-yellow`)

### Imports
```tsx
// React & libs
import React from 'react';
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

## 🔮 Prochaines Étapes Prioritaires

1. **Page Détail Match + Salon**
   - Affichage complet des infos match
   - Salon de coordination temps réel
   - Dashboard arbitre avec countdown T-10min

2. **Tournois**
   - Listing avec filtres
   - Détail + bracket visuel
   - Système d'inscription

3. **Profil & Social**
   - Dashboard joueur personnalisé
   - Stats et historique
   - Classements avec podium animé

4. **Chat Temps Réel**
   - Integration Socket.io complète
   - Chat global communauté
   - Messages privés
   - Salons de match

---

**Fait avec ⚡ par l'équipe ZOYD - African Gaming Infrastructure**
