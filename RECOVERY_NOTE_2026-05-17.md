# Recovery Note - 2026-05-17

## Contexte retrouve

- Le projet principal est `C:/Users/Paul/Desktop/projrt/Z.O.Y.D/Multiplayer Gaming Platform`.
- La racine ouverte `C:/Users/Paul/Desktop/projrt/Z.O.Y.D` n'est pas un depot Git.
- Le dossier du projet lui-meme ne contient pas non plus de `.git`, donc pas d'historique local exploitable pour reconstruire la conversation.

## Stack actuelle

- React 18 + Vite
- React Router
- Zustand
- Tailwind CSS
- Motion
- Socket.io client

## Ce qui est clairement implemente dans le code

- Routing applicatif avec layouts `RootLayout`, `AuthLayout`, `DashboardLayout`
- Parcours auth et landing
- Hub MJ
- Creation de match
- Detail de match avec:
  - room CODM
  - check-in
  - ready state
  - slot arbitre
  - validation de resultat
  - ouverture de litige
  - chat de match
- Systeme tournois avec:
  - page listing
  - page creation
  - store metier complet
  - generation de bracket
  - auto-advance sur bye
  - slots arbitres
  - distribution des gains
- Pages complementaires visibles dans les routes:
  - wallet
  - earnings
  - classements
  - chat
  - profil
  - profil public
  - parametres
  - admin
- Widget social "Amis ZOYD"

## Fichiers les plus parlants pour reprendre

- `src/app/routes.tsx`
- `src/app/stores/tournamentStore.ts`
- `src/features/tournament/pages/TournoisPage.tsx`
- `src/app/pages/mj/CreateTournamentPage.tsx`
- `src/features/match/pages/MatchDetailPage.tsx`
- `src/app/components/social/FriendsWidget.tsx`

## Ce qui semble avoir ete le focus recent

- Extension du projet au-dela du README initial
- Mise en place du circuit tournois MJ
- Creation et gestion de bracket
- Detail de match plus operationnel cote joueur/arbitre
- Ajout d'une couche sociale minimale

## Important: README partiellement depasse

Le fichier `PROJECT_README.md` decrit bien l'intention produit, mais il est en retard sur l'etat reel du code:

- il presente encore certaines zones comme "a implementer"
- plusieurs de ces zones existent deja dans `src`

## Indices sur les erreurs recentes

- `build.log` a la racine du workspace montre un `pnpm install` lance depuis `C:/Users/Paul/Desktop/projrt/Z.O.Y.D`, donc depuis le mauvais dossier.
- Un autre log montre un `vite build` lance depuis la mauvaise racine, avec erreur `Cannot resolve entry module index.html`.
- Un `npm run build` lance depuis le bon dossier a rencontre une contrainte d'execution locale (`spawn EPERM`) en sandbox, puis un timeout hors sandbox. La verification build n'est donc pas encore tranchee.

## Hypothese de reprise la plus probable

Si on reprend la conversation perdue, le sujet le plus probable et le plus recent est:

1. finaliser ou verifier le flux tournois
2. relier le detail de match avec la logique store
3. remettre a jour la documentation par rapport au code reel
4. verifier le build/dev server depuis le bon dossier

## Prochaines actions utiles

1. Lancer `npm run dev` ou `npm run build` depuis `Multiplayer Gaming Platform`
2. Verifier les pages:
   - `/mj/tournois`
   - `/mj/tournois/creer`
   - `/mj/match/:id`
3. Mettre a jour `PROJECT_README.md` pour refleter l'etat reel
4. Si besoin, reconstruire un plan de travail a partir des derniers fichiers modifies
