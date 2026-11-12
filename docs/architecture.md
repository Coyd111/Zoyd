# ZOYD — carte du projet

> Document de travail. Il décrit la forme du projet pour qu'on puisse
> travailler dessus sans le relire intégralement à chaque fois.
>
> **Règle de maintenance** : toute modification structurelle (nouveau
> module, nouveau domaine, changement de point d'entrée) doit mettre à
> jour ce fichier **dans le même commit**. Une carte qui ment est pire
> qu'aucune carte.

---

## 1. Pourquoi ce document existe

Le dépôt ne contenait **aucun fichier Markdown** (0 sur 389 fichiers).
Toute la connaissance du projet vivait dans les commentaires du code — qui
sont, il faut le dire, **exceptionnellement bons** : chaque module déclare
son rôle, l'ordre de ses gardes, et ses `INVARIANT :` / `PIEGE :`.

Mais des commentaires ne donnent pas une carte : ils sont dispersés dans
45 modules serveur et 192 fichiers front. Pour savoir « où va une écriture
d'argent ? » ou « quel module touche la table X ? », il faut tout lire.

Ce document est la vue d'ensemble. Il ne remplace rien : il donne les
points d'entrée, et renvoie aux Comments pour le détail.

---

## 2. Mesures

Relevé du 2026-11-12. Méthode : `split(/\r?\n/).length` par fichier.

| Zone | Fichiers | Lignes | Dont tests |
|---|---|---|---|
| `server/` | 169 | 48 563 | ~19 500 |
| `src/` | 192 | 37 607 | ~2 500 |
| `e2e/` | 29 | 5 850 | 5 850 |
| `supabase/` | 5 | 869 | 0 |
| `scripts/` | 1 | 257 | 0 |
| **Total** | **396** | **~93 000** | |

**45 modules serveur de production** (hors tests), **12 fichiers de routes**.

Les trois fichiers les plus lourds :

| Fichier | Lignes | Poids |
|---|---|---|
| `server/persistence.mjs` | 5 221 | 17 % du serveur. Source de vérité unique. |
| `server/match-engine.mjs` | 2 199 | Cycle de vie des matchs 1v1–5v5. |
| `server/tournament-engine.mjs` | 1 924 | Tournois. |

`persistence.mjs` est **le point à traiter en priorité structurelle** :
à lui seul, il dépasse tous les autres modules réunis d'un facteur 2.

---

## 3. Topologie d'exécution

### 3.1 Le serveur

Point d'entrée unique : **`server/realtime-server.mjs`** (756 lignes).
Il monte le serveur HTTP, Socket.IO, les timers de fond et la séquence de
démarrage, **dans le même processus**.

```
realtime-server.mjs
  │
  ├─ assertSingleProcess()          ← AVANT tout chargement d'état
  ├─ chargement de l'état           ← persistence.mjs
  ├─ initCronJobs()                 ← cron.mjs (12 jobs)
  └─ pipeline HTTP
       ├─ garde CSRF
       ├─ boucle sur ROUTE_MODULES   ← le premier qui renvoie `true` gagne
       │    public → auth → social → wallet → tournament → league →
       │    br → match → admin → chat → realtime → webhook
       └─ filet de sécurité
```

**Invariant de démarrage** (déclaré dans `realtime-server.mjs`) :
l'ordre n'est pas décoratif — `assertSingleProcess` passe **avant** tout
chargement d'état, et le chargement **avant** le cron et le socket. Si
l'état n'a pas pu être chargé, le serveur **exécute quand même** mais refuse
toute écriture (`stateTrusted === false`) et `/api/health` répond `503`.

**L'ordre de `ROUTE_MODULES` n'a aucune portée sémantique** (c'est écrit
dans le code) : un module répond en renvoyant `true`, et le premier qui
répond gagne. Le listing ci-dessus est l'ordre réel du fichier, pas une
priorité métier.

### 3.2 Le client

React + Vite + React Router + Zustand + TanStack Query + Radix.

```
src/
  app/          points d'entrée, pages, stores, hooks, lib   (~20 000 l.)
  features/     match · tournament · league · br             (~7 700 l.)
  lib/          utilitaires transverses                       (~2 800 l.)
```

Le front **lit** l'état, il ne le possède pas : la source de vérité est
`persistence.mjs` côté serveur.

### 3.3 Le dossier `shared/` — une seule source pour deux runtimes

`shared/match-status.json` est importé **par le serveur et par le front**.
C'est le mécanisme du projet pour les constantes qui doivent être
identiques des deux côtés : les statuts de match étaient réécrits à cinq
endroits, dans deux langages, et les listes divergeaient — un match en
attente d'arbitre disparaissait de la liste des matchs actifs.

**Règle** : toute constante partagée entre les deux runtimes vit dans
`shared/`, jamais dupliquée. C'est le seul mécanisme de partage
autorisé aujourd'hui — à vérifier avant d'en inventer un autre.

---

## 4. Carte des modules serveur

### 4.1 Socle (à lire en premier — tout en dépend)

| Module | Lignes | Rôle | Invariant central |
|---|---|---|---|
| `realtime-server.mjs` | 756 | Point d'entrée, pipeline HTTP, socket | Ordre de démarrage ; l'identité socket est **imposée** par la session |
| `persistence.mjs` | 5 221 | Cache mémoire + écritures Supabase | **Toute écriture d'argent passe par `updateWalletSnapshot`** |
| `state-helpers.mjs` | 670 | Jonction moteurs ↔ persistance ↔ socket, sanitisation | Écriture **par entité** (OCC conditionnel), jamais en bloc |
| `http-utils.mjs` | 623 | Cookies, CORS, JSON, session, mapping d'erreurs | `respondJson` est la **seule** sortie JSON |
| `rate-limiter.mjs` | 365 | Quotas par IP et par groupe | `X-Forwarded-For` lu **seulement** si le pair est un proxy de confiance |
| `mutex.mjs` | 220 | Verrous de processus | Verrou **global avant** le verrou par entité |
| `metrics.mjs` | 263 | Compteurs Prometheus en mémoire | Cardinalité des labels **bornée** |
| `logger.mjs` | 100 | Logs JSON | `time`/`level`/`module`/`msg` non écrasables |
| `supabase.mjs` | 86 | Fabrique du client `service_role` | Seule une clé `service_role` est acceptée |
| `single-process-guard.mjs` | 162 | Refuse de démarrer en multi-processus | Appelé **avant** tout chargement d'état |
| `utils.mjs` | 85 | Arrondis, erreurs codées, XP | Tout montant passe par `roundAmount` |
| `instance-id.mjs` | 41 | Identité de l'instance | Stable pour la durée du processus |

### 4.2 Routes (12 fichiers) — le contrat commun

Chaque module de route :
- renvoie `true` **dès qu'il a écrit la réponse**, `false` sinon ;
- déclare l'**ordre de ses gardes** dans son en-tête ;
- utilise `respondJson` et rien d'autre pour répondre.

Ordre typique : `session (401)` → `rate limit` → `lecture du corps` →
`verrou` → `moteur` → `save` → `réponse`.

| Route | Lignes | Domaine |
|---|---|---|
| `admin.mjs` | 1 078 | Administration, commissions, modération, sanctions, 2FA |
| `auth.mjs` | 841 | Inscription, connexion, profil, sessions |
| `match.mjs` | 648 | Matchs 1v1–5v5 |
| `public.mjs` | 614 | Santé, proxy CODM, métriques, classements, recherche |
| `wallet.mjs` | 545 | Portefeuille : solde, dépôt, retrait |
| `league.mjs` | 467 | Ligue BR |
| `tournament.mjs` | 400 | Tournois |
| `br.mjs` | 411 | Battle Royale |
| `social.mjs` | 339 | Amis, signalements, notifications |
| `webhook.mjs` | 327 | Webhook FedaPay (dépôts + payouts) |
| `chat.mjs` | 287 | Chat |
| `realtime.mjs` | 214 | Sessions temps réel, push |

### 4.3 Moteurs métier (l'argent)

| Module | Lignes | Rôle | Invariant central |
|---|---|---|---|
| `match-engine.mjs` | 2 199 | Matchs 1v1–5v5 | `applyResultSettlement` est la **seule** sortie de la cagnotte ; le pot distribué est le pot **réellement verrouillé**, jamais `prizePool` théorique |
| `tournament-engine.mjs` | 1 924 | Tournois | `applyTournamentSettlement` ne s'exécute que si `completed` ; les échecs deviennent des **dettes persistées** |
| `league-engine.mjs` | 1 296 | Ligue BR | `applyLeagueSettlement` est la seule sortie ; podium 60/25/15 |
| `br-engine.mjs` | 1 301 | Battle Royale | Le statut `settling` est écrit **avant** les versements |
| `wallet-engine.mjs` | 918 | Toutes les mutations de portefeuille | Le montant d'une transaction est **signé** ; `releaseWalletWinnings` est idempotent |
| `payment-engine.mjs` | 446 | FedaPay | La transaction est **relue** chez FedaPay, jamais le corps de la requête |

### 4.4 Modules feuille (aucune dépendance métier)

`utils` · `moderation` · `proof-helpers` · `payout-countries` ·
`commission-stats` · `match-status` · `vapid-keys` · `secret-crypto` ·
`code-delivery` · `channel-presence` · `chat-helpers` · `finance-observability`

`payout-countries.mjs` existe **pour une raison structurelle** : il ne
doit rien importer, sinon `persistence.mjs` ne pourrait pas l'importer
(`payment-engine` importe `persistence`, ce qui crée un cycle).

### 4.5 Fond

| Module | Lignes | Rôle |
|---|---|---|
| `cron.mjs` | 1 037 | 12 travaux de fond, chacun sous **le même verrou** que sa route |
| `cron-lease.mjs` | 461 | Bail **distribué** : une seule instance traite un job |
| `cron-lease-audit.mjs` | 301 | Historique durable des prises de bail |

---

## 5. Le contrat du code — ce qu'il faut vérifier

Le code **déclare** ses invariants en prose (`INVARIANT :`) et ses pièges
(`PIEGE :`). C'est la meilleure documentation qui soit, et c'est
exactement ce qui rend le travail systématique possible : **on peut
vérifier que le code fait ce qu'il promet**.

Or les audits précédents ont déjà trouvé des divergences. Exemple cité
dans `routes/match.mjs` :

> *« L'audit avait laissé les neuf dernières SANS garde, en invoquant
> "les gardes du moteur bornent l'impact de chacun" : c'était circulaire. »*

Autrement dit : l'en-tête annonçait un ordre de gardes, et le code ne
l'appliquait pas. **C'est le travail de fond qui reste** : domaine par
domaine, vérifier que chaque invariant déclaré est **effectivement
appliqué** et **couvert par un test**.

Les invariants d'argent, à ne jamais voir bouger :

1. Toute écriture d'argent passe par `persistence.updateWalletSnapshot`.
2. Le débit est **sous** verrou, l'appel FedaPay **hors** verrou.
3. Le remboursement n'a lieu que sur une **certitude d'échec**
   (`payoutMaybeSent !== true`) ; sinon `pending_review`.
4. La vérité FedaPay est **relue** chez eux, jamais prise du webhook.
5. Le pot distribué est le pot **réellement verrouillé**.
6. Le webhook est **fail-closed** : pas de secret, pas de traitement.
7. Toute opération financière ou de modération admin exige la **2FA**.

---

## 6. Limites connues et assumées (déclarées dans le code)

Elles sont documentées : ce ne sont pas des défauts à corriger, ce sont
des frontières à respecter.

- **Deux instances coexistent pendant un déploiement** (`instance-id.mjs`) :
  états mémoire différents. Le garde-fou multi-processus **ne voit pas**
  ce cas. C'est ce que le bail de cron covers pour les jobs de fond.
- **`WEB_CONCURRENCY` / cluster** : refus au démarrage au-delà de 1.
- **Fenêtre de rate limit** : compteur remis à zéro, pas de fenêtre
  glissante exacte.
- **Métriques** : éviction FIFO à saturation → un compteur peut être
  perdu **sans trace**.
- **Historique du portefeuille plafonné à 200 entrées** : les
  `pending_review` sortis de la fenêtre ne sont trouvés que par un autre
  chemin.
- **`roundAmount` renvoie 0 sur une entrée non finie** : il masque
  l'erreur, il faut valider avant.

---

## 7. Plan de passes

Chaque passe = une lecture complète du domaine, une **matrice**
« invariant déclaré → où il est appliqué → test qui le couvre », puis
les corrections, chacune avec son test de non-régression **vérifié
échouant avant**.

| # | Domaine | Volume | Enjeu |
|---|---|---|---|
| 0 | **Cette carte** | — | fait |
| 1 | Socle (`http-utils`, `rate-limiter`, `mutex`, `logger`, `utils`, `supabase`) | ~1 900 l. | Une erreur ici se propage partout |
| 2 | Argent (`wallet-engine`, `payment-engine`, `webhook`, `payout-countries`) | ~2 400 l. | Le plus fort enjeu |
| 3 | Persistance & concurrence (`persistence`, `state-helpers`, `cron`, `cron-lease`) | ~7 600 l. | Le monolithe de 5 221 lignes |
| 4 | Moteurs (`match`, `tournament`, `br`, `league`) | ~6 700 l. | Logique métier, règles de règlement |
| 5 | Routes & API (12 fichiers) | ~6 200 l. | Cohérence des gardes entre fichiers |
| 6 | Temps réel & chat (`realtime-server`, `channel-presence`, `chat`) | ~1 300 l. | Diffusion, présence |
| 7 | Front (`src/`, 192 fichiers) | 37 600 l. | Stores, abonnements, rendu |
| 8 | Exploitabilité (`render.yaml`, CI, observabilité) | — | Déploiement et alerte |

Ordre choisi : le **socle** d'abord parce que ses erreurs se multiplient,
l'**argent** ensuite parce que c'est le plus fort enjeu, la
**persistance** ensuite parce qu'elle porte l'**état** (et le monolithe),
puis les moteurs, les routes, le temps réel, le front.

---

## 8. Ce que ce document ne dit pas (et pourquoi)

Honnêteté sur la portée :

- Il ne décrit **pas** le détail des règles métier (remparts, formats de
  téléphone, barèmes de commission). Pour ça : les moteurs et leurs
  tests.
- Il ne décrit **pas** le front page par page (192 fichiers).
- Il ne dit **pas** que le code est correct. Les audits précédents ont
  trouvé 19 défauts majeurs et 34 mineurs ; d'autres restent possibles.
  La carte décrit la **forme**, pas la **correction**.

Ce qui est vérifié à la date du document : l'inventaire (mesuré), la
topologie d'exécution (lue dans `realtime-server.mjs`), le contrat des
routes (lu dans les 12 en-têtes), et l'état de production (déployé sur
`origin/main`, gates verts).
