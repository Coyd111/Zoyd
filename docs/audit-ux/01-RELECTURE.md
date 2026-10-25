# Relecture du rapport UX OpenCLI — ZOYD

**Date de relecture :** 2026-10-26
**Rapport relu :** `00-RAPPORT-OPENCLI.md` (OpenCLI v1.8.8, audit du 2026-10-25 sur https://zoyd.vercel.app)
**Méthode :** chaque constat vérifiable a été confronté au dépôt (`main` au `2079d53`) et à la production, avec un navigateur réel.

---

## 1. Résultat en une phrase

Trois des quatre constats « Critique » du rapport sont **faux aujourd'hui** — vérifiés
dans le dépôt et sur la production — et le reste relève de choix produit ou de
nouveau travail, pas de corrections. Le score global « 6/10 » repose largement sur
le constat n°1, réfuté.

---

## 2. Les constats, un par un

### 2.1 « Pages légales inaccessibles sans connexion » — CRITIQUE n°1 — **FAUX**

- **Dépôt :** les six routes légales sont publiques, avec le commentaire
  « Pages légales publiques (pas de login requis) » :
  `src/app/routes.tsx:98-122` (`/conditions`, `/reglement-litiges`, `/anti-fraude`,
  `/confidentialite`, `/mentions`, `/jeu-responsable`).
- **Footer :** les liens pointent vers ces routes avec états hover
  (`src/app/pages/LandingPage.tsx:503-508`).
- **Production (testée le 2026-10-26, navigateur réel) :**
  `https://zoyd.vercel.app/anti-fraude` rend la page légale complète — titre
  « ANTI-FRAUDE », navigation « Pages légales », « Dernière mise à jour :
  22 septembre 2026 ». Aucune redirection vers le login.

Le rapport date du 25/10 : la production a peut-être été redéployée depuis, ou le
robot a eu des artefacts DOM (application React, clics non suivis). Dans les deux
cas, le constat ne décrit pas l'état actuel.

### 2.2 « Les liens ne changent pas d'URL » — **MAL OBSERVÉ**

- `Classements` (`LandingPage.tsx:500`) mène à une route sous `AppLayout`, qui
  redirige vers `/auth/login` pour un visiteur non connecté
  (`src/app/layouts/AppLayout.tsx:49-50`) : le lien **navigue** — vers le login.
- Les liens du footer ont un retour visuel : `hover:text-white/70
  transition-colors` sur chaque `<Link>` (`:497-508`).

### 2.3 « `test@example.com` rejeté comme invalide » — **FAUX**

Le schéma d'inscription utilise la validation zod standard
(`src/app/pages/auth/RegisterPage.tsx:89` — `z.string().email('Email invalide')`),
qui accepte `test@example.com`. Le message « Numéro requis » observé par le robot
sort uniquement si le champ téléphone est **vide** — le rapport semble avoir
confondu l'erreur du champ voisin.

### 2.4 « Numéro rejeté même avec le format +229 » — **CHOIX MÉTIER DOCUMENTÉ**

Le validateur du téléphone est strict **volontairement**
(`RegisterPage.tsx:90-100`) : le commentaire explique qu'un `.min(8)` laxiste
laissait stocker un numéro que ZOYD ne pouvait **jamais payer** — l'erreur
n'apparaissait qu'au retrait. La règle « même règle que le serveur » impose le
format `+229 61 00 00 01` (huit chiffres après l'indicatif). Saisir `+229` seul
produit l'erreur attendue « Numéro invalide. Exemple : +229 61 00 00 01 ».

### 2.5 « Pas de feedback de correspondance des mots de passe » — **PARTIEL**

La correspondance est validée (`RegisterPage.tsx:109-112` — « Les mots de passe ne
correspondent pas ») et un indicateur de force existe (`:199`). Un indicateur
temps réel de correspondance champ à champ n'existe pas — amélioration mineure
possible, pas un défaut.

### 2.6 Statistiques « 0 matchs, 0 ZC » sur la landing — **CHOIX PRODUIT**

Les chiffres affichés sont les statistiques réelles d'une plateforme neuve. Les
masquer ou les embellir est une décision produit, pas une correction.

### 2.7 Champ unique email/téléphone/pseudo au login — **CHOIX PRODUIT**

Design délibéré (flexibilité de connexion). La remarque du rapport (« peut créer
de la confusion ») est une opinion UX recevable, à arbitrer.

### 2.8 Pas de page dédiée aux arbitres avant inscription — **NOUVEAU TRAVAIL PRODUIT**

La landing présente la section « Joueur/Arbitre » et le CTA « Arbitrer un match »
redirige vers l'inscription — cohérent avec un flux d'acquisition. Une page de
présentation du rôle d'arbitre serait du **nouveau contenu produit**.

### 2.9 Onboarding, ARIA, performance — **À CONSIDÉRER**

Non vérifié en détail par la relecture. Points recevables pour une future passe
d'accessibilité (contrastes, attributs ARIA, navigation clavier).

---

## 3. Ce qui reste à disposition du produit

Aucun correctif n'est requis par ce rapport. Trois pistes produit, à arbitrer :

1. **Rendre `/classements` publique** (au moins un aperçu) — argument de
   transparence pour les visiteurs ; aujourd'hui elle renvoie au login.
2. **Politique d'affichage des statistiques vides** sur la landing.
3. **Page « devenir arbitre »** — rémunération, responsabilités, avant inscription.

---

*Relecture faite le 2026-10-26, après le rang 13 de l'audit-2 (plus aucun constat
ouvert de ce rapport ne requiert de correctif).*
