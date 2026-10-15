# Procédures d'exploitation

Ce document est écrit pour **toi seul** administrateur. Il contient les gestes
que le code ne peut pas faire à ta place, et que rien dans le dépôt ne peut
vérifier.

---

## 1. Sauvegarde de l'historique — tous les 3 mois

### Ce qui existe déjà

L'historique des matchs **est dans la base et n'est jamais purgé** : un match
terminé passe à `archived`, il n'est pas supprimé. Et les snapshots ne sont
évincés que de la **mémoire** du serveur, jamais de la base.

Mais une base n'est pas une sauvegarde tant que personne n'a produit de copie à
conserver ailleurs.

### Le geste

1. Tableau de bord admin → bouton **« EXPORTER L'HISTORIQUE (CSV) »**
   (ou **JSON** si tu veux la structure complète)
2. Vérifie le fichier dans `Téléchargements`
3. Range-le **hors de ce projet** : un disque externe, un cloud, un mail
   envoyé à toi-même

Le bouton se trouve dans la barre d'onglet, au-dessus des onglets.

### Pourquoi le JSON en complément du CSV

| Format | Pour quoi |
|---|---|
| **CSV** | Lisible dans Excel ou LibreOffice, directement exploitable |
| **JSON** | Préserve la structure complète, y compris les champs que le CSV aplati |

Prends les deux. Le CSV pour lire, le JSON pour un jour où tu devras
réinjecter l'historique.

### Si le bouton affiche 503

C'est que le serveur tourne **sans base**. Ne range rien : un export vide se
range sans qu'on regarde, et tu croirais avoir sauvé trois mois qui n'ont
jamais été copiés. Vérifie `/api/health`.

### Deux tests, une seule fois — à faire maintenant

Une sauvegarde jamais restaurée est une hypothèse, pas une sauvegarde.

**Test A — le fichier est-il exploitable ?**
Ouvre le CSV. Vérifie que les accents s'affichent (le fichier commence par un
BOM UTF-8, donc oui) et que le nombre de lignes correspond à ce que tu
attendais. Un CSV où toutes les dates sont vides indique un problème, pas un
historique.

**Test B — la base se restaure-t-elle ?**
C'est la partie que personne ne fait et qui se découvre le jour où on en a
besoin :

1. Ouvre ton projet Supabase → **Backups**
2. Restaure le point le plus récent dans un **projet jetable**
3. Vérifie qu'il y a bien des comptes, des portefeuilles avec des soldes, des
   matchs

Note la date et la durée. Si ça plante, tu le sauras aujourd'hui.

### Ce que tu perds si la base disparaît

Entre deux exports : **jusqu'à trois mois** de matchs. Les **comptes et les
soldes sont dans la base, pas dans les matchs** — ils ne sont pas couverts par
cet export. C'est un point aveugle assumé : le restore de base (test B) est
ce qui les protège.

---

## 2. Escalade d'incident — tu es seul

Pas d'équipe, pas d'escalade à trois personnes. Une règle simple : **si tu ne
sais pas, tu ne touches à rien.**

### L'ordre, toujours

1. **`/api/health` d'abord.** Toujours. Il dit quel commit tourne, si la base
   est connectée, et si les tables sont là.
2. Ensuite seulement, les logs Render.
3. **`git log -1`**, pour savoir si le code en production est bien le dernier.

Ne commence jamais par modifier une variable d'environnement. Un
redémarrage avec une variable modifiée peut transformer un problème visible en
problème muet.

### Les trois pannes que tu as déjà vues

| Symptôme | Cause | Geste |
|---|---|---|
| `[FATAL] Creation du compte admin impossible` au démarrage | `ZOYD_ADMIN_EMAIL` ne correspond plus au compte en base | Ne change rien. Connecte-toi avec le nouveau mail, puis vérifie que le compte existe. Le seed ne peut pas écraser un compte existant, par conception. |
| Salde figé, dépôt qui ne passe pas | Table manquante ou base injoignable | `/api/health` → `sanctionsPersisted`, `loginLockoutPersisted`. Si `false` : rejoue le DDL de `supabase/schema.sql`. |
| Tableau de bord vide alors que la base est saine | Mode dégradé, table absente | `/api/health` → `degraded`. Rejoue le DDL. |

### Erreurs d'interface qui ne sont pas des pannes

- **« Code 2FA invalide » alors que le code est bon** : la fenêtre est de 30 s.
  Regarde le décompte sous le champ, et attends le code suivant s'il affiche
  moins de 5 secondes. Si ça arrive souvent, ton téléphone a une horloge qui
  dérive : mets-le à l'heure.
- **« Le signalements sont indisponibles »** : le bandeau orange de
  l'onglet modération. La table des signalements est injoignable. Ce n'est pas
  « aucun signalement ».
- **« Tu es banni »** alors que tu ne l'es pas : onglet **signalements →
  Sanctions en cours → Lever**.

### Le cas que tu dois connaître par cœur

**Une sanction n'est jamais définitive par inadvertance.** Tu peux lever
n'importe quel bannissement depuis l'interface, définitif compris. La levée est
immédiate et tracée.

---

## 3. Rotation des clés

### `METRICS_TOKEN` — la plus simple

Tu ne reçois aucune alerte dessus. Change-le quand tu veux, sans fenêtre de
transition.

### `FEDAPAY_SECRET_KEY` — la seule qui mérite une procédure

Le serveur ne lit qu'une valeur. Il n'y a pas de coexistence : pendant le
basculement, les joueurs qui paient reçoivent une erreur.

**La procédure :**

1. **Hors heures de jeu.** En pratique : personne ne paie à 4 h du matin.
2. Note l'ancienne valeur quelque part **avant** de changer.
3. Change la variable sur Render.
4. **Attends le redéploiement** (~2 min), puis vérifie le commit déployé.
5. **Fais un dépôt test immédiatement.** C'est le seul contrôle qui compte.
6. Garde l'ancienne valeur notée pendant **24 h**.

Si le dépôt test échoue, remets l'ancienne valeur : c'est le retour arrière
que l'étape 5 rend possible.

### `ZOYD_ADMIN_PASSWORD` — changé via l'interface

Tu l'as déjà fait, ça fonctionne. Règle générale pour le mot de passe admin :
unique, long, différent de tout autre service. Un mot de passe réutilisé sur
une autre plateforme n'est plus une weakness, c'est un chemin.

### `SUPABASE_SERVICE_KEY`

La clé `service_role` de ton projet Supabase. Ne la change pas sans raison :
elle ne expire pas. Si tu dois régénérer la clé dans le tableau de bord
Supabase, **l'ancienne continue de fonctionner** jusqu'à ce que tu la
révoques — donc :

1. Génère la nouvelle
2. Mets-la sur Render, vérifie que le serveur démarre
3. **Révoque l'ancienne ensuite**, pas avant

L'inverse te laisse sans base fonctionnelle.

---

## Récapitulatif — les gestes datés

| Quoi | Quand | Où |
|---|---|---|
| Export CSV + JSON | Tous les 3 mois | Tableau de bord admin |
| Test de restauration | Une fois, maintenant | Supabase → Backups |
| Vérifier `/api/health` | **Toujours, avant tout diagnostic** | `curl .../api/health` |
| Rotation FedaPay | Trimestriel ou en cas de doute | Render → Environment |
| Vérifier le commit déployé | Après chaque déploiement | `/api/health` → `deployedCommitShort` |