# Étape 7 — Produit et accessibilité

## Portée

Ce qu'un joueur vit : ce qu'il peut percevoir, comprendre et terminer. Cette
étape est majoritairement **positive** — l'interface tient ses promesses sur
l'accessibilité — avec un correctif et trois réserves.

## 1. Audit réel dans le navigateur : 0 blocage sur les 5 pages publiques

**Sévérité : informationnelle. Conformité mesurée.**

Audit avec `axe-core` (le standard du secteur), dans un vrai Chromium, sur les
cinq pages qu'un visiteur atteint sans compte :

| Page | Violations `serious` / `critical` |
|---|---|
| Accueil | 0 |
| Connexion | 0 |
| Inscription | 0 |
| Mot de passe oublié | 0 |
| Sélection de mode | 0 |

Le test est versionné dans `e2e/ui/accessibility.spec.ts` et s'exécute à chaque
lancement de la suite UI. Il filtrera une régression future, pas seulement un
état ponctuel.

### Pourquoi cette méthode, et pas une analyse de code

J'ai commencé par analyser le JSX avec des expressions régulières, et le
résultat était **faux deux fois** :

- 73 champs de formulaire semblaient sans étiquette. Faux : le composant
  `Input` rend un `<label htmlFor>` dès qu'il reçoit une prop `label` ;
- un `<select>` de `RegisterPage` sembrait non étiqueté. Faux : mon motif
  cherchait `for=` alors que JSX écrit **`htmlFor=`** ;
- le champ de recherche de `FriendsWidget` semblait non étiqueté. Faux :
  l'attribut `aria-label` était bien présent, mais mon motif s'arrêtait au `>`
  contenu dans `tab === 'friends'`.

Seule l'évaluation dans le DOM rendu ne se trompe pas. Un audit annoncé sur la
base d'une analyse de code aurait été trois fois faux, et cette étape serait
partie sur de mauvaises conclusions.

**Points conformes, vérifiés :** les 181 boutons ont un nom accessible
(texte, `aria-label` ou `aria-labelledby`) ; les 45 images ont un `alt` ;
aucun `div`/`span` cliquable sans `role` ni `tabIndex`, donc rien
d'inaudible au clavier ; `lang="fr"` sur `<html>` ; `Input` gère `aria-invalid`,
`aria-describedby` et `role="alert"` sur ses messages d'erreur ; les cibles
tactiles font 44 px minimum.

## 2. Les animations JavaScript ignoraient la préférence système

**Sévérité : moyenne. Corrigé.**

`theme.css` neutralise déjà les animations CSS sous
`prefers-reduced-motion` — bien fait. Mais **26 composants sont animés par
`motion`, en JavaScript**, sur le réseau `requestAnimationFrame` : cette règle
CSS ne les atteint pas, et Framer Motion ignore le réglage système par défaut.

Un joueur ayant désactivé les animations — réglage frequent chez les personnes
sensibles aux troubles vestibulaires — voyait donc quand même toute l'interface
bouger. La règle existait, mais elle ne s'appliquait qu'à la moitié du projet.

`MotionConfig reducedMotion="user"` à la racine de l'application. Le mode
« utilisateur » coupe transformations et dégradés tout en conservant les
transitions d'opacité : les changements d'état restent perceptibles, sans
mouvement de l'écran.

Le test vérifie le **comportement constaté** et non la configuration déclarée :
l'application publie sur `<html>` la préférence système qu'elle a résolue, et
le test lit cet attribut. Il couvre les deux sens — avec préférence, l'indicateur
vaut `true` ; sans préférence, il vaut `false`, ce qui garantit qu'on n'a pas
juste tout désactivé.

## 3. Polices externes : une dépendance à un tiers, pour toute l'identité visuelle

**Sévérité : informationnelle. Non corrigé — décision d'infrastructure.**

Les polices (JetBrains Mono, Inter, Outfit…) sont chargées depuis
`fonts.googleapis.com` / `fonts.gstatic.com`. Trois conséquences :

- **Résilience** : sur des réseaux qui bloquent ou brident Google Fonts, toute
  l'identité typographique change. Le projet utilise `font-display`,
  `font-black` et `tracking-widest` presque partout : la bascule de police
  serait visible immédiatement.
- **Performance** : feuille de style externe bloquante au premier rendu, sur
  le même trajet critique que le JavaScript.
- **Confidentialité** : chaque visiteur adresse une requête à Google.

L'auto-hébergement des trois polices supprimerait les trois problèmes. Je ne l'ai
pas fait : cela impose de récupérer et versionner des fichiers de police, donc un
arbitrage de conception et de licence.

## 4. Polices bloquées en local, 401 sur la page publique

**Sévérité : faible. Documenté.**

Relevé pendant l'audit : dans l'environnement de test, les requêtes vers
`fonts.gstatic.com` sont rejetées (CORS sur l'en-tête `content-type` en
préflight), et la page d'accueil reçoit des **401** sur des appels API alors
qu'aucun compte n'est connecté.

Les 401 sont attendues : `RootLayout` déclenche ses récupérations avant même de
vérifier la session. Le code est correct — tout est gardé derrière
`if (!isAuthenticated) return;` et **aucun polling ne tourne pour un visiteur
anonyme**. Le bruit des 401 est le prix de la correction d'état, pas une fuite.

## 5. Langue : aucune fuite d'anglais dans l'interface

**Sévérité : informationnelle. Conforme.**

Vérifié sur les 125 composants. Les 36 correspondances initiales pour des
mots anglais étaient toutes des `type="submit"` — des attributs HTML, pas du
texte affiché. Aucun texte utilisateur en anglais.

## 6. États vides : traités

**Sévérité : informationnelle. Conforme.**

200 références à des états vides réparties sur les pages qui en ont besoin
(détail de match 24, actions de match 22, widget d'amis 9, onglet d'urgence
admin 8). Un joueur qui n'a aucun match, aucune demande ou aucun signalement
n'atterrit pas sur un écran vide sans explication.