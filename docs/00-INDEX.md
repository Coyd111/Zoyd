# ZOYD — Index de la documentation

> **Point d'entrée unique.** Si tu ne lis qu'un document du dépôt, lis celui-ci.
> Il t'oriente vers tout le reste et te dit ce qui est vérifié, ce qui ne l'est pas,
> et ce qui est périmé.

Dernière mise à jour : projet à `0328dc8`.

---

## 1. Le produit en une phrase

ZOYD est une **infrastructure de matchs compétitifs avec mise d'argent**, pensée pour
l'Afrique francophone et l'économie Mobile Money. Un joueur ouvre un match, d'autres
rejoignent en miseant, et un **arbitre** — un joueur comme les autres — valide le
résultat et est rémunéré pour ce rôle. CODM est le premier terrain ; l'infrastructure
est conçue pour en ouvrir d'autres.

**Ce que ZOYD n'est pas :** un site de tournois, une place de marché, un casino.
Ce n'est pas non plus un produit Call of Duty Mobile — même si aujourd'hui tout le
code en dépend (voir §5).

---

## 2. Le modèle économique — à lire avant toute modif

| Flux | Qui reçoit | Part |
|---|---|---|
| Mise d'entrée (pot) | les vainqueurs du match | 100 % |
| Commission de retrait | **ZOYD** | **2 %** |
| Part d'arbitre | l'arbitre du match | 2 % |

**La seule recette de ZOYD est la commission de retrait.** Les pots ne génèrent pas de
rake plateforme. Ce n'est pas un détail : c'est un invariant codé en dur dans les
tests E2E. Voir `docs/08-invariants.md` (à écrire).

---

## 3. Où se trouve quoi

```
Zoyd/
├── src/          Front React (Vite)      ~32 700 lignes, 193 fichiers
├── server/       Back Node (Express)     ~28 500 lignes,  99 fichiers
├── e2e/          Tests Playwright         ~3 900 lignes,  21 fichiers
├── public/       Fichiers statiques servis par Vercel
├── docs/         Documentation (ce dossier)
└── *.md          Documents racine — voir §4
```

### Les quatre moteurs métier (le cœur du produit)

| Fichier | Taille | Rôle |
|---|---|---|
| `server/persistence.mjs` | 189 Ko | Source de vérité : lecture/écriture, Supabase, OCC |
| `server/match-engine.mjs` | 64 Ko | Matchs 1v1 — le moteur le plus utilisé |
| `server/tournament-engine.mjs` | 57 Ko | Tournois et brackets |
| `server/league-engine.mjs` | 47 Ko | BR League |
| `server/br-engine.mjs` | 37 Ko | Matches Battle Royale |

> **À savoir avant d'ouvrir `persistence.mjs` :** c'est le fichier le plus gros et le
> plus critique du dépôt. Toute modification y touche potentiellement l'argent.

---

## 4. Ce qui est vrai, et ce qui ne l'est pas

### Documents maintenus (racine du dépôt)

| Fichier | Dernier commit | Sujet |
|---|---|---|
| `PROJECT_README.md` | 2026-10-18 | Présentation et design system |
| `DEPLOYMENT.md` | 2026-10-15 | Déploiement et exploitation |
| `ARCHITECTURE.md` | 2026-08-27 | Schémas d'architecture |

### ✅ Doublons périmés — supprimés

Ces trois fichiers faisaient doublon avec leurs versions racines et étaient
**abandonnés depuis août**. Ils se contredisaient avec les versions tenues à jour.
Ils ont été supprimés : les mettre à jour aurait maintenu la confusion au lieu
de la résoudre. L'historique git les conserve si besoin.

| Fichier supprimé | Doublon vivant à jour |
|---|---|
| ~~`docs/ARCHITECTURE.md`~~ | `ARCHITECTURE.md` (racine) |
| ~~`docs/DEPLOYMENT.md`~~ | `DEPLOYMENT.md` (racine) |
| ~~`docs/PROJECT_PRESENTATION.md`~~ | `PROJECT_README.md` (racine) |

### Rapports d'audit (`docs/audit/`, 11 fichiers)

Ce sont des **constats à un instant donné**, pas une description du projet. Plusieurs
constats y sont faux et ont été réfutés un à un. Ne les traite pas comme l'état actuel
sans revérifier dans le code.

---

## 5. La tension centrale du projet

**ZOYD se veut agnostique ; le code est CODM de bout en bout.**

`CODM` apparaît dans **44 fichiers** : `codmApi.ts`, `persistence.mjs`, `auth.mjs`,
`competition.ts`, les pages de profil, l'inscription, le wallet. L'UID CODM est demandé
à l'inscription. `/mj` et `/br` sont deux **modes de CODM**, pas deux jeux distincts.

Le pitch indique : « Premier terrain : Call of Duty Mobile ».

Conséquence pratique : **ne supposes jamais qu'un changement est indépendant du jeu.**
Vérifie d'abord ce que le pitch et le READMEPromettent vraiment.

---

## 6. Vérification — comment savoir si une affirmation est vraie

Cette session a produit **3 constats vrais sur 22** annoncés. Le taux ne s'améliore
que par une discipline précise :

| Étape | Règle |
|---|---|
| 1 | Une affirmation est une **hypothèse**, pas un résultat |
| 2 | Cherche un **marqueur non ambigu** — une chaîne exacte, lisible dans la source |
| 3 | Vérifie le marqueur **aussi en local** : s'il y est absent des deux côtés, le marqueur est faux, pas la conclusion |
| 4 | Vérifie les **chunks**, pas seulement le bundle principal (le front est découpé) |
| 5 | Pour un test : **mue-le**. Un test qui reste vert après avoir cassé le code ne prouve rien |

L'étape 5 a déjà payé : `server/admin-totp-guard.test.mjs` a été gardé parce que ses
4 portes ont été neutralisées une par une et détectées à chaque fois.

---

## 7. La documentation

Neuf documents, ~8 500 lignes, tous sourcés par `fichier:ligne`. Ce qui suit n'est
pas une description de ce que le projet **devrait** faire : c'est ce qu'il **fait**,
au moment de l'écriture.

| Document | Contenu |
|---|---|
| [`01-architecture.md`](01-architecture.md) | Point d'entrée, pipeline de requête, routage, temps réel, verrous, rate-limiter, cron, table exhaustive des routes, pièges |
| [`02-modele-metier.md`](02-modele-metier.md) | Les 7 moteurs, les 4 cycles de vie, les statuts écrits vs dérivés, les 5 obligations de l'arbitre, le cycle de l'argent, l'OCC |
| [`03-securite.md`](03-securite.md) | 4 portes du garde admin, CSRF, rate-limiter, sessions, mot de passe, **menaces couvertes** et **menaces non couvertes** |
| [`04-api.md`](04-api.md) | Convention de réponse, table complète des codes erreur → statut, routes par domaine |
| [`05-invariants.md`](05-invariants.md) | **54 invariants numérotés** + les 15 violations constatées |
| [`06-tests.md`](06-tests.md) | Les 3 niveaux, **ce que les tests ne prouvent pas**, recette de mutation |
| [`07-exploitation.md`](07-exploitation.md) | Déploiement Vercel + Render, variables d'environnement, schéma Supabase, runbook |
| [`08-frontend.md`](08-frontend.md) | Routes, stores, client temps réel, design system, SEO, les 4 bugs corrigés |

Le code porte aussi un **en-tête de commentaire** en tête de chaque fichier
significatif : 38 fichiers `server/`, 152 fichiers `src/`. Chacun indique le rôle,
les invariants et les pièges, avec renvoi vers le document détaillé.

---

## 8. Ce que la documentation a trouvé — à corriger ensuite

La lecture n'a pas servi qu'à décrire : elle a **confirmé 15 anomalies**. Les plus
graves, avec l'impact concret :

| # | Anomalie | Impact |
|---|---|---|
| **V1** | `sweepMatchesWithoutArbiter` **n'était appelé nulle part** | ✅ **CORRIGÉ** — branché sur le tick de 30 s, avec un test qui couvre le chemin complet |
| **V2** | `pendingArbiterFee` est écrit mais jamais relu | ✅ **CORRIGÉ** — repris par un job cron dédié, avec un test qui couvre le câblage |
| **V3** | `awaiting_arbiter` n'est pas dans `ACTIVE_STATUSES` | Un match en attente d'arbitre **disparaît de la liste des matchs actifs** du joueur |
| **V6** | Une exception `ARBITER_REQUIRED` dans l'expiration des confirmations | ✅ **CORRIGÉ** — isolé par match, et les échecs sont désormais signalés |
| **V7** | BR : le pass est verrouillé avant le contrôle `TEAM_FULL` | ✅ **CORRIGÉ** — le verrou passe après les validations, plus un filet de remboursement |
| **V9** | La migration de la colonne `revision` n'est dans **aucun SQL du dépôt** | Une base neuve n'a pas la colonne OCC — la protection multi-instance n'existe pas |
| **V8** | Le front additionne le total d'équipe aux gains d'un joueur | Affichage faux du gain |

Le détail de chacune, avec les emplacements exacts, est dans
[`05-invariants.md` § « INVARIANTS VIOLÉS OU NON COUVERTS »](05-invariants.md).

**V1 était le plus important, et il est corrigé.** La session précédente avait
conclu que « l'arbitre obligatoire est en place et payé ». C'était vrai pour le
*blocage* du règlement — mais le *balayage* qui rembourse un match abandonné
n'était pas branché. Un match sans arbitre pouvait rester en séquestre
**jusqu'à 14 jours**, au lieu des 2 h promises.

Le correctif enchaîne le balayage à l'automatisation dans une fonction unique
(`runMatchAutomationOnServer`), appelée par le tick de 30 s. L'ordre est
délibéré : le balayage s'applique sur le résultat de l'automatisation, donc un
match déjà annulé est ignoré. Et `server/arbiter-sweep-wiring.test.mjs` couvre
le **chemin complet** — débrancher le balayage fait tomber 2 tests sur 6.

C'est le motif à retenir : **un test qui appelle la fonction ne prouve pas
qu'elle est branchée.** La preuve du branchement exige de traverser le chemin
de production.

**V6 était presque aussi grave, et il est corrigé** : une exception
`ARBITER_REQUIRED` dans l'expiration des confirmations faisait échouer le
balayage **entier** — et comme le match fautif levait à nouveau au run
suivant, le gel était **permanent**. Tous les matchs situés après lui dans la
collection attendaient indéfiniment. Le job frère avait déjà le `try/catch` par
match : l'auteur connaissait le motif, il l'avait oublié 20 lignes plus bas.

---

## 9. État au moment de l'écriture

- Production Render : saine (`ok=true`, `integrity.ok=true`)
- Front Vercel : branché sur `principale`, déploiement automatique **fonctionnel**
- Validation : 846 unitaires · 158 E2E API · TSC 0 · lint 0
- FedaPay : **parqué**, en attente de la spécification de signature webhook
