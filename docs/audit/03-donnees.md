# Étape 3 — Données et persistance

## Portée

Le modèle de données, les tables, les écritures d'état, les chemins de
dégradation silencieuse, et la récupération après incident.

## 1. Table déclarée nulle part : `user_reports`

**Sévérité : moyenne.**

Comparaison systématique des tables utilisées par le code (15) avec celles
déclarées dans les `.sql` du dépôt (17) : une seule table était utilisée sans
avoir de DDL dans le dépôt — **`user_reports`**, utilisée par
`POST /api/social/report`.

Sur un environnement neuf (nouveau serveur, nouvelle base, restauration),
rien ne la créait. Le serveur démarrait normalement et la fonction de
signalement n'écrivait nulle part.

Le DDL est ajouté dans `supabase/schema.sql`, avec les deux index dont la
lecture des signalements par la modération aura besoin (par statut, par
cible).

## 2. Signalements : écrits mais jamais relus

**Sévérité : moyenne. Décision produit requise.**

La chaîne complète :

1. `POST /api/social/report` écrit dans `user_reports` (base) ;
2. le store côté client ajoute le signalement à `friendsStore.reports` ;
3. `AdminDashboardPage` lit `useFriendsStore((s) => s.reports)`.

Mais `hydrateFromServer` ne recharge que les **amis, demandes et blocages** —
**pas les signalements**. Et aucune route serveur ne lit `user_reports`.

Consequence : un joueur signale un autre joueur -> le signalement va en
base, et le tableau de bord d'administration affiche les signalements faits
**dans ce navigateur**. Un admin qui ouvre son tableau de bord sur un autre
appareil, ou après un rechargement, n'en voit **aucun**. Les signalements
s'accumulent dans une table que rien ne consulte.

Le score de confiance n'est **pas** concerné : il se base sur les litiges
(`disputes`), pas sur les signalements.

Ce que je n'ai pas fait, et pourquoi : il manque une route
`GET /api/admin/reports` et le chargement correspondant. C'est une création de
fonctionnalité, pas une correction — la forme du filtrage (par statut, par
cible, avec pagination) et la politique de traitement relèvent de toi.

## 3. Correction : le signalement ne ment plus au joueur

L'écriture passait par `sbFire` (best-effort) et la route répondait **201
avant** que l'écriture n'aboutisse. Table absente ou base indisponible : le
joueur lisait « Signalement envoyé », et le signalement disparaissait.

C'est une information de modération. Un signalement perdu, c'est un joueur qui
continue à harceler en croyant avoir été écouté.

L'écriture est désormais **attendue**. `sbUpsert` renvoie `undefined` quand
aucun client Supabase n'est configuré (mode mémoire — ce n'est pas un échec) et
`false` quand l'écriture est réellement refusée ; le second cas répond 503
« réessaie dans un instant » au lieu de promettre une conservation qui n'a pas
eu lieu.

## 4. Points vérifiés et conformes

- **Écriture d'état en fermeture** : `replaceStateCollection` réessaie trois
  fois par lot de 100 ; en cas d'échec, **rollback mémoire et
  `SERVER_BUSY`**. Le commentaire du code explique l'enjeu, et il est réel :
  une route qui répondait 200 alors que rien n'était écrit faisait disparaître
  un résultat `pending` au redémarrage, la cagnotte restant gelée — ou pire,
  le règlement rejoué et crédité deux fois.
- **Pagination PostgREST** : le plafond silencieux de 1000 lignes est traité
  par une pagination explicite. Au-delà, les lignes disparaissent sans
  erreur — et avec elles, des utilisateurs, des matchs, des sessions nulles.
- **Invariant d'intégrité au démarrage** : comptes en mémoire contre comptes en
  base, plus les invariants de portefeuille. Exposé dans `/api/health`, donc
  vérifiable sans connexion SQL.
- **Reprise des écritures** : les tables de verrouillage d'administrateur et
  de transactions traitées sont hydratées au chargement, donc les protections
  survivent à un redémarrage.
- **Migration `login_attempts`** : contrairement à `user_reports`, son DDL
  **est** dans le dépôt. Son absence en base avait été signalée par
  `/api/health` plutôt que d'être silencieuse — le bon modèle.

## 5. Verifie en production — table creee le 14/10/2026

```sql
SELECT to_regclass('public.user_reports');
```

La premiere execution a renvoye **NULL** : la table manquait bien en base,
et les signalements etaient reellement perdus — ce n etait pas une menace
theorique. Le DDL de la section 1 a ete applique sur le projet de
production, puis la verification a renvoye `user_reports` et
`SELECT ... FROM user_reports` repond `0 rows` : table vide.

Aucun redeploiement n etait necessaire. La correction de la section 3 rend la
reponse honnete, elle n avait pas besoin de la table pour l etre.
