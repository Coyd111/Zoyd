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

| # | Domaine | Volume | Enjeu | Etat |
|---|---|---|---|---|
| 0 | **Cette carte** | — | — | fait |
| 1 | Socle (`http-utils`, `rate-limiter`, `mutex`, `logger`, `utils`, `supabase`) | ~1 900 | une erreur ici se multiplie | **en cours** |
| 2 | Argent (`wallet-engine`, `payment-engine`, `webhook`, `payout-countries`) | ~2 400 | le plus fort enjeu | a faire |
| 3 | Persistance & concurrence (`persistence`, `state-helpers`, `cron`, `cron-lease`) | ~7 600 | le monolithe | a faire |
| 4 | Moteurs (`match`, `tournament`, `br`, `league`) | ~6 700 | regles de reglement | a faire |
| 5 | Routes & API (12 fichiers) | ~6 200 | coherence des gardes | a faire |
| 6 | Temps reel & chat | ~1 300 | diffusion, presence | a faire |
| 7 | Front (192 fichiers) | 37 600 | stores, abonnements | a faire |
| 8 | Exploitabilite (`render.yaml`, CI, observabilite) | — | deploiement et alerte | a faire |

Ordre choisi : le **socle** d'abord parce que ses erreurs se multiplient,
l'**argent** ensuite parce que c'est le plus fort enjeu, la
**persistance** ensuite parce qu'elle porte l'**état** (et le monolithe),
puis les moteurs, les routes, le temps réel, le front.

---

## 7 bis. Passe 1 — le socle : ce que la lecture a donne

La passe 1 a lu les 6 modules du socle (1 479 lignes) en entier. Bilan :

### Defaut 1 — le quota anti-bruteforce etait contournable (MAJEUR)

**Mesure en production**, sur `zoyd.onrender.com` :

| experience | resultat |
|---|---|
| 70 requetes sequentielles, **avec** un `X-Forwarded-For` constant | **0 refus** |
| 70 requetes sequentielles, **sans** l en-tete | refus des la #45, corps `{ code: "RATE_LIMITED" }` |

Ajouter un en-tete suffisait a sortir du quota : les 50 tentatives / 15 min
de la connexion et les 20 / 10 min des retraits etaient neutralisables en
changeant d en-tete a chaque requete.

**Cause** : la cle de seau est `${ip}|${groupe}`, et `ip` vient de
`getClientIp` — donc de l en-tete que l appelant controle. La regle
« dernier saut » ne protege que si la plateforme AJOUTE son saut, ce qui
n est pas le cas ici. Le test unitaire existant (`rate-limiter.test.mjs`)
verifiait cette regle en SIMULANT un proxy qui ajoute : il prouvait ce que
le code fait, pas ce que la plateforme fait. L hypothese n avait jamais
ete verifiee contre la realite.

**Correctif** : chaque requete compte dans DEUX seaux — le sien (fin, par
IP) et celui de son **pair TCP** (grossier, non falsifiable, plafonne a
`ZOYD_RATE_LIMIT_PEER_MULTIPLIER` fois le quota fin, 20 par defaut). 104
points d appel sont cables ; un test de **source** exige que chacun
transmette le pair (un point d appel oublie est un trou, invisible pour
un test comportemental).

### Defaut 2 — la cle Supabase n etait pas verifiee (MAJEUR)

`supabase.mjs` declarait « seule une cle `service_role` est acceptee » —
mais le code n acceptait n importe quelle valeur de `SUPABASE_SERVICE_KEY`.
Une cle `anon` posee par erreur faisait echouer chaque ecriture derriere
le RLS : le serveur annoncait un client actif et **l argent cessait d etre
persiste sans la moindre alerte**.

**Correctif** : le role est lu dans le JWT de la cle (`lireRoleCle`). Un
role autre que `service_role` -> le client n est pas cree -> mode degrade
-> `/api/health` repond `503`. Une cle au format `sb_secret_...` (non
verifiable) est acceptee mais signalee : on ne refuse pas ce qu on ne peut
pas controler.

### Ce qui a ete verifie et trouve sain

| module | conclusion |
|---|---|
| `mutex.mjs` | **sain.** Un mutex en cours d acquisition n est jamais evince : `async-mutex` decremente son compteur de facon **synchrone** dans `acquire()`, donc `isLocked()` est vrai avant le premier `await`. Pas de course. |
| `logger.mjs` | **sain.** Les cles reservees ne sont pas ecrasables ; la sortie part de stdout. |
| `http-utils.mjs` | **sain.** Les deux resolutions de token ont des priorites volontairement inversees, et la raison est ecrite. Le corps de requete est plafonne a 1 Mo et le socket detruit au-dela. |
| `utils.mjs` | Un ecart avec le front : `formatZcForNotification` (serveur) renvoie `0 ZC` pour un montant non fini, `formatZC` (front) renvoie `NaN ZC`. L invariant « les deux formats doivent rester identiques » est donc viole d un cote. |

---

## 7 ter. Passe 2 - l argent : ce que la lecture a donne

Modules lus : `wallet-engine.mjs` (917), `payment-engine.mjs` (445),
`routes/webhook.mjs` (326), `routes/wallet.mjs` (545),
`payout-countries.mjs` (178) - environ 2 400 lignes.

### Defaut 4 - le taux ZC -> FCFA etait reecrit de chaque cote (MAJEUR)

Le taux etait REECRIT a la main : `10` dans `payment-engine.mjs` (la
conversion appliquee au payout) et `ZC_TO_FCFA` dans `src/lib/utils.ts`
(la conversion affichee au joueur). Le serveur l appelait « miroir
declare » - il reconnaissait donc lui-meme que les deux peuvent diverger,
sans rien faire pour l empecher.

Changer un seul des deux rend la conversion fausse ET SILENCIEUSE : le
joueur verrait un montant en FCFA, le prestataire en recevrait un autre.

**Correctif** : le taux est IMPORTE d une source unique cote serveur
(`ZC_TO_FCFA` dans `server/utils.mjs`, module feuille), et le test de
miroir compare les deux valeurs.

### Defaut 5 - du code mort dans le moteur de paiement (MINEUR)

`normalizePhoneLoose` etait declare et jamais appele : la preuve par le
telephone avait ete abandonnee (les 8 derniers chiffres coincident entre
pays), la fonction ne servait plus a rien. Supprimee.

### Une decision reverifiee, et maintenue : le webhook n a pas de quota

Le webhook est la seule route sans rate limit. Le code le dit
explicitement : limiter par IP bloquerait les retries FedaPay si leurs
IPs partagent un bucket.

La passe 2 a reexamine la decision, et elle TIENT - pour deux raisons :
un quota par IP mettrait le risque (les retries FedaPay passent par des
IPs partagees), et surtout la **passe 1** a montre que la cle de seau
par IP est **choisie par l appelant** : un quota par IP n aurait donc
protege de rien contre un attaquant, tout en risquant de bloquer les
depots. Ne pas ajouter de quota ici sans avoir d abord resolu la cle de
seau. La decision est desormais documentee dans le fichier.

### Ce qui a ete verifie et trouve sain

| module | conclusion |
|---|---|
| `wallet-engine.mjs` | **sain.** Toutes les mutations passent par `updateWalletSnapshot` ; le solde est verifie AVANT le plafond journalier (sinon `INSUFFICIENT_FUNDS` devient inatteignable) ; le remboursement prend la valeur absolue du montant negatif de l historique ; `releaseWalletWinnings` fige sa decision « deja verse » au premier passage, donc l OCC ne peut pas le faire taire. |
| `routes/wallet.mjs` | **sain.** Le debit est SOUS verrou, l appel FedaPay HORS verrou ; la cle d idempotence est obligatoire ; la branche 409 (payout ambigu) sort du flux avant le second transfert ; le remboursement n a lieu que sur une certitude d absence d envoi, sinon le retrait est marque `pending_review` et repris par la reconciliation. |
| `routes/webhook.mjs` | **sain.** La verite est RELUE chez FedaPay (jamais le corps du webhook), la signature est obligatoire et fail-closed, et un retrait `pending_review` n est jamais rembourse sur la seule parole du webhook. |
| `payout-countries.mjs` | **sain.** Les regles vivent dans un module FEUILLE (pour eviter un cycle d imports) ; le Benin est a 10 chiffres (migration ARCEP) avec le format 8 en legacy ; un numero invalide renvoie un `number` vide, sans lever. |

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
