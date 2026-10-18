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

### ⚠️ Doublons périmés — à supprimer, PAS à mettre à jour

Ces trois fichiers font doublon avec leurs versions racines et sont **abandonnés depuis
août**. Ils se contredisent avec les versions tenues à jour. Les mettre à jour
maintiendrait la confusion au lieu de la résoudre.

| Fichier obsolète | Doublon vivant à jour |
|---|---|
| `docs/ARCHITECTURE.md` | `ARCHITECTURE.md` (racine) |
| `docs/DEPLOYMENT.md` | `DEPLOYMENT.md` (racine) |
| `docs/PROJECT_PRESENTATION.md` | `PROJECT_README.md` (racine) |

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

## 7. Reste à documenter

Rien de ce qui suit n'existe encore. Ne le cherche pas, ce n'est pas perdu.

- [ ] `01-architecture.md` — composants, flux, temps réel, OCC
- [ ] `02-modele-metier.md` — match, pari, arbitrage, validation, remboursement
- [ ] `03-securite.md` — rôles, 2FA, gardes, ce que le client NE protège pas
- [ ] `04-api.md` — routes, contrats, codes erreur
- [ ] `05-invariants.md` — les règles métier qui ne doivent jamais casser
- [ ] `06-tests.md` — stratégie de validation et ce que les tests ne prouvent pas
- [ ] `07-exploitation.md` — déploiement, configuration, incidents

---

## 8. État au moment de l'écriture

- Production Render : saine (`ok=true`, `integrity.ok=true`)
- Front Vercel : branché sur `principale`, déploiement automatique **fonctionnel**
- Validation : 846 unitaires · 158 E2E API · TSC 0 · lint 0
- FedaPay : **parqué**, en attente de la spécification de signature webhook