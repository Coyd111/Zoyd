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

Le **parcours en production** (passe 12) a ajoute un deuxieme jeu de
mesures : ce que le deploiement fait reellement, et non ce que le code
pretend.

| Ce que le parcours mesure | Resultat (2026-11-15) |
|---|---|
| Comptes de test crees en production | 12 ( Benin 10 chiffres, format historique 8 chiffres, Cote d Ivoire, Togo ) |
| Depots FedaPay **sandbox** payes de bout en bout | 13 ( de 100 a 500 ZC ), credit verifie cote serveur |
| Matchs joues jusqu au reglement | 5 ( 1VS1 a 5VS5 ), avec de vraies mises |
| Tournois crees et inscrits | 2 ( le tournoi gratuit est refuse ) |
| Salons BR crees | 1 ( le lancement exige la date : regle des 24 h ) |
| Verifications automatisees | 61 ( le detail par phase est dans le rapport du parcours ) |

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
| 1 | Socle (`http-utils`, `rate-limiter`, `mutex`, `logger`, `utils`, `supabase`) | ~1 900 | une erreur ici se multiplie | **fait** |
| 2 | Argent (`wallet-engine`, `payment-engine`, `webhook`, `payout-countries`) | ~2 400 | le plus fort enjeu | **fait** |
| 3 | Persistance & concurrence (`persistence`, `state-helpers`, `cron`, `cron-lease`) | ~7 600 | le monolithe | **fait** |
| 4 | Moteurs (`match`, `tournament`, `br`, `league`) | ~6 700 | regles de reglement | **fait** |
| 5 | Routes & API (12 fichiers) | ~6 200 | coherence des gardes | **fait** |
| 6 | Temps reel & chat | ~1 300 | diffusion, presence | **fait** |
| 7 | Front (192 fichiers) | 37 600 | stores, abonnements | **fait** |
| 8 | Exploitabilite (`render.yaml`, CI, observabilite) | — | deploiement et alerte | **fait** |
| 9 | **Audit UI** (33 ecrans mesures dans un navigateur) | — | ce que le joueur voit reellement | **fait** |
| 10 | **Redaction** (textes visibles du front) | — | ce que le front DIT | **fait** |
| 11 | **Redaction** (508 messages du serveur) | — | ce que le serveur DIT | **fait** |

Ordre choisi : le **socle** d'abord parce que ses erreurs se multiplient,
l'**argent** ensuite parce que c'est le plus fort enjeu, la
**persistance** ensuite parce qu'elle porte l'**état** (et le monolithe),
puis les moteurs, les routes, le temps réel, le front.

La passe 9 est venue **apres** les huit autres, et pour une raison
precise : les passes 1 a 8 lisaient le CODE. Un code peut etre
parfaitement lisible et produire un ecran mort - c'est exactement ce qui
est arrive au detail d un match (boucle de rendu infinie). Mesurer
l'ecran rendu est le seul controle qui voie ce genre de defaut.

La passe 10 est venue **apres** la neuvieme, pour une raison voisine :
l audit UI mesure la FORME de l ecran (noms accessibles, contraste,
cibles tactiles), pas ce que l ecran DIT. Un ecran parfaitement
accessible peut dire « Arbitres necessaires » et un bouton peut
s appeler « CONNEXION » : le joueur, lui, lit d abord les MOTS.

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

## 7 quater. Passe 3 - persistance & concurrence : ce que la lecture a donne

Modules lus : `persistence.mjs` (5 221), `state-helpers.mjs` (670),
`cron.mjs` (1 037), `cron-lease.mjs` (461) - environ 7 400 lignes.

### Defaut 6 - le rejeu OCC ne resynchronisait pas les index d identite (MAJEUR)

Un conflit OCC fait rejouer l updater sur l etat FRAIS relu en base. Le
payload retenu peut alors porter une identite differente de celle que nous
avions calculee : si l autre instance a RETROGRADE un administrateur (ou
change le pseudo) entre notre lecture et notre ecriture, c est sa version
qui est adoptee.

Mais les index memoire restaient sur l ancien payload :

- `memoryAdminIds` : un admin retrograde gardait ses droits depuis cette
  instance, jusqu a la prochaine ecriture de ce compte (ou le redemarrage).
  Le payload disait `player`, l index disait `admin` ;
- `pseudoKeys` : un joueur change de pseudo n etait plus trouvable, donc
  plus connectable ;
- `memoryPasswordHashes` : meme symptome pour l email.

**Correctif** : l indexation est centralisee dans
`resynchroniserIndexesIdentite`, appelee au rejeu avec le payload RETENU,
et au retour arriere (echec d ecriture) dans l autre sens.

### Ce qui a ete verifie et trouve sain

| module | conclusion |
|---|---|
| `persistence.mjs` — OCC | **sain** (sauf le defaut 6). La base de calcul est l instant RELU EN BASE, pas la copie memoire ; l OCC ferme donc la fenetre ET la peremption. Une ligne disparue est un refus, jamais une resurrection (une suppression d admin qui perd la course ne ressuscite pas un compte avec son solde). Le rejeu repart de l etat frais. |
| `persistence.mjs` — registres | **sain.** La source de verite est le PORTEFEUILLE (`withdrawalKeys` / `winningsKeys`), pas l index memoire : l eviction du cache est donc SANS PERTE. Les registres sont bornes (5 000 joueurs, 500 cles), et une cle dont le paiement est en attente n est jamais evincee. |
| `persistence.mjs` — ecriture d etat | **sain.** L eviction au plafond sort l entite de la MEMOIRE, pas de la base (une divergence visible vaut mieux qu une perte seche de donnees financieres), et l ecart est compte. Le conflit adopte l etat frais et rend l entite reecrivable. |
| `state-helpers.mjs` | **sain.** La sanitisation est complete (UUID, mot de passe de salle, preuves, `confirmedByTeams`, `proofHash` retires) et elle est COUVERTE : `state-helpers.test.mjs` scanne le JSON brut de la diffusion pour y chercher un `userId`. |
| `cron.mjs` | **sain.** Chaque job a sa garde anti-chevauchement, `finally` compris (un job qui echoue ne se desactive pas) ; chaque job prend le MEME verrou que sa route ; les jobs ne tranchent jamais seuls, ils appellent les moteurs. |
| `cron-lease.mjs` | **sain.** Le bail est distribue et expire (10 min), donc une instance morte ne gele pas le job ; le resultat negatif est re-sonde. |

---

## 7 quinquies. Passe 4 - les moteurs : ce que la lecture a donne

Modules lus : `match-engine.mjs` (2 199), `tournament-engine.mjs` (1 924),
`br-engine.mjs` (1 301), `league-engine.mjs` (1 296) - environ 6 700 lignes.

### Defaut 7 - le podium de la ligue NE CONSERVAIT PAS la cagnotte (MAJEUR)

Les trois parts (60 / 25 / 15 %) etaient arrondies INDEPENDAMMENT. Leur
somme pouvait alors DEPASSER le pot : de la monnaie creee.

Mesure sur 200 000 pots : **18 % sur-distribues de 0,01 ZC**, 6 %
sous-distribues du meme montant.

Le cas est REEL : le tarif de la ligue est modifiable par l administration
(jusqu a 500 ZC, centimes compris). Tarif 12,50 ZC sur 3 inscrits -> pot
37,50 ZC -> reparti 22,50 + 9,38 + 5,63 = **37,51 ZC** : 0,01 ZC de plus
que la cagnotte recue.

**Correctif** : le tiers absorbe le reliquat, comme le font deja les trois
autres moteurs - le premier gagnant (match), le 3e (tournoi), le dernier
classe (BR). La ligue etait le seul des quatre a ne pas le faire.

### Ce qui a ete verifie et trouve sain

| module | conclusion |
|---|---|
| `match-engine.mjs` | **sain.** La cagnotte distribuee est le pot REELLEMENT VERROUILLE (`getLockedPot`), jamais le `prizePool` theorique. La base est FIGEE au premier essai (sinon le rejeu sous-payait les impayes). Le premier gagnant absorbe l arrondi, donc la somme des parts est exactement le pot. L echec de la commission d arbitre est TENU A PART de celui des joueurs : il cree une creance reprenable, il ne gele pas le match. |
| `match-engine.mjs` — forge | **sain.** Le payload client n arrive QUE sur `match.result` ; la racine du match (ou vit `settlementBasis`, la base figee) n est pas accessible. Un client ne peut donc pas forger la cagnotte. |
| `tournament-engine.mjs` | **sain.** Les dettes de versement (`pendingPayouts`) sont ecrites AU REGLEMENT (le declencheur `!wasCompleted` est a usage unique : une liste perdue = des ZC definitivement perdus). Les parts sont egales et le reliquat absorbé ; les parts des membres fantomes remontent au capitaine. |
| `br-engine.mjs` | **sain.** Le statut `settling` est ecrit AVANT les versements (un arret laisse un salon reprenable, pas un double versement). La commission d arbitre est plafonnee a 5 %, et les six taux doivent sommer a 100 % - le serveur refuse la repartition sinon. Le dernier classe absorbe le reliquat. |
| `league-engine.mjs` | **sain** (sauf le defaut 7). La cle de reservation du pass est `season.id` (une cle differente gelait le pass a vie). Le classement final doit classer TOUS les finalistes, et un joueur ne peut apparaitre deux fois. Le 3e absorbe le reliquat (corrige). |

---

## 7 sexies. Passe 5 - les routes & l API : ce que la lecture a donne

Modules lus : les 12 fichiers de `server/routes` - environ 6 200 lignes.

### Defaut 8 - sept routes n avaient AUCUN quota (MAJEUR)

Analyse structurelle des 62 routes declarees (`if (req.method === ... &&
pathname === ...)`) : 7 n avaient pas de `rateLimitGuard` - alors que
les en-tetes de LEURS MODULES en annoncent un.

| Route | Module | Pourquoi c etait grave |
|---|---|---|
| `GET /api/social/friends` | social (« rate limit (social) ») | relit la liste COMPLETE a chaque appel |
| `GET /api/social/pending` | social (idem) | idem |
| `GET /api/notifications` | social (« default pour les notifications ») | idem |
| `GET /api/auth/me` | auth (l ordre des gardes commence par le quota) | lecture de session |
| `POST /api/realtime/push/subscribe` | realtime | **ECRIT** en base |
| `POST /api/realtime/push/unsubscribe` | realtime | **ECRIT** en base |
| `POST /api/realtime/push/test` | realtime | **ECRIT** + push |

Les trois routes sociales sérialisaient des lectures de liste ; les trois
routes de push epuisaient le budget d ecritures. C est exactement le
defaut que l audit-3 (P9 C4) avait corrige sur les routes de match et de
tournoi - et laissait dans les memes fichiers, sans que rien ne le
signale.

**Correctif** : un `rateLimitGuard` avant la lecture du corps, partout.

**Le verrou** : un test STRUCTUREL (`server/routes-rate-limit-invariant.
test.mjs`) verifie desormais que TOUTE route a un quota. Un test qui
verifie une route a la fois ne verifie que les routes qu on a pense a
lister : la couverture etait une liste, donc elle ne pouvait pas
couvrir ce qui n etait pas liste. Le test verifie aussi que le quota est
pose AVANT la lecture du corps (apres, le corps est deja en memoire)
et que les trois exemptions sont explicites et documentees - une
exemption non ecrite est un trou.

### Ce qui a ete verifie et trouve sain

| point | conclusion |
|---|---|
| Contrat des modules de routes | **sain.** Chacun renvoie `true` des qu il a repondu, et le dispatcheur s arrete au premier `true`. |
| Ordre des gardes | **sain.** Le rate limit passe AVANT le garde 2FA sur le domaine admin (le quota doit proteger le garde, pas l inverse), et le `return true` est immediat apres un refus de garde : une reponse ne peut pas etre ecrite deux fois. |
| Verrous | **sain.** Le verrou GLOBAL est pris avant le verrou par entite (l inverse ouvre un deadlock), et le verrou est relache dans un `finally`. |

---

## 7 septies. Passe 6 - temps reel & chat : ce que la lecture a donne

Modules lus : `realtime-server.mjs` (756), `routes/realtime.mjs` (214),
`routes/chat.mjs` (287), `channel-presence.mjs` (310), `chat-helpers.mjs`
(168), `push-notifications.mjs` (129) - environ 1 900 lignes.

### Defaut 9 - les privileges d un socket OUVERT n etaient pas revocables (MAJEUR)

`getRealtimeSession` relit bien le role courant, et le test
`realtime-privilege-revocation.test.mjs` le verifie depuis longtemps. Mais
le handler socket `notification:push` n appelait PAS cette fonction : il
lisait `session.role`, la variable de la CONNEXION, figee pour toute la
duree de la session temps reel (6 h).

Concretement : un administrateur retrograde continuait d ecrire dans le
telephone de n IMPORTE QUEL joueur pendant des heures apres sa
retrogradation - un vecteur de phishing deguise en notification
officielle. Le compte etait `player` partout ailleurs (API HTTP, ecran
admin) : il ne l etait plus que sur cette decision.

C est exactement le defaut deja corrige pour le bannissement : le controle
portait sur l evenement declencheur (la connexion) et non sur l etat
courant. Interdire une connexion ne dit rien d un socket deja ouvert.

**Correctif** : le handler utilise `resolveRealtimeRole`, qui EXISTAIT
deja dans `http-utils.mjs`, documente precisement pour ce cas - et qui
n etait utilise NULLE PART. Il relit la session temps reel : il rend
l etat courant, et il coupe tout privilege si la session a ete revoquee,
si le compte est banni, ou s il a disparu.

### Ce qui a ete verifie et trouve sain

| point | conclusion |
|---|---|
| Identite des payloads socket | **sain.** `safePayload = { ...payload, userId: session.userId, pseudo: session.pseudo }` : l identite est IMPOSEE par la session, le client ne peut pas l usurper. |
| Controle d acces aux canaux | **sain.** `canAccessChatChannel` est appele sur CHAQUE evenement de presence, de saisie et d accuse de lecture. |
| Quota socket | **sain.** Les handlers socket passent par `checkRateLimitComplet` (avec la dimension pair), et la connexion elle-meme est plafonnee par IP - resolue avec les MEMES regles que le HTTP. |
| Diffusion d etat | **sain.** `broadcastStateSnapshot` emet a tout le monde et ne porte jamais de donnee dependante du destinataire : son seul appelant diffuse la projection publique (`toPublicBrLobby`). |
| Presence | **sain.** La cle d un membre est le `userId` (plusieurs onglets = un seul membre) ; un ROOM NAME et un MOT DE PASSE ne sortent jamais de la diffusion (`publicMember` est le seul filtre). |

---

## 7 octies. Passe 7 - le front : ce que la lecture a donne

Le front fait 192 fichiers et 37 600 lignes. La lecture y a privilege les
CLASSES de defauts (ce qui se reproduit partout) plutot que les cas
particuliers : une regle structurelle couvre ce qu un test par fichier
ne couvrirait jamais.

### Defaut 10 - le joueur etait told que son solde etait restaure quand il ne l etait pas (MAJEUR)

`PAYOUT_FAILED` signifie « le transfert a echoue ET le solde a ete
restaure » : c est le message que le front affiche au joueur.

Mais quand le REMBOURSEMENT echoue lui aussi (base indisponible,
contention), l argent est ENCORE RETENU : le retrait reste
`pending_review`, et le cron le reconciliera. Le serveur repondait
malgre tout `PAYOUT_FAILED`.

Le test existant (`withdrawal-double-payout.test.mjs`) PROUVAIT deja que
l argent reste retenu dans ce cas (`pending_review`) : il contredisait donc
la reponse envoyee au joueur - « Ton solde a ete restaure » pendant que
les ZC etaient bloques.

**Correctif** : le serveur repond `REFUND_FAILED` (code deja existant,
 deja mappe en 502) quand le remboursement echoue, et le front a un message
distinct : « ton solde n est pas encore restaure, l equipe support revient
vers toi ».

### Le verrou : le contrat d API front <-> serveur

Le front et le serveur sont deux depots, deux langages, et AUCUN contrat
genere. Un chemin renomme d un cote et oublie de l autre ne casse AUCUN
test : les tests du front mockent le reseau, les tests du serveur ne
savent pas qui les appelle. Le resultat est un 404 chez le joueur.

`src/app/lib/api-contract.test.ts` lit les DEUX cotes et les compare :
**82 appels** du front, **66 routes** du serveur, **aucun ecart**
aujourd hui - mais rien ne le garantissait. Le test verifie aussi que
les messages d erreur du front ne promettent pas plus que le serveur ne
garantit (le cas `PAYOUT_FAILED` / `REFUND_FAILED`).

### Ce qui etait deja verifie, et reste verifie

| point | conclusion |
|---|---|
| Selecteurs zustand | **sain, et structurellement garanti.** La regle « jamais d accesseur de LECTURE hors d un hook » est verifiee par un test qui scanne TOUS les `.tsx` du projet : le defaut qui rendait `DashboardPage` inutilisable ne peut pas revenir. |
| Cycle de rendu des listes | **sain.** Les selecteurs qui construisent un tableau passent par `useShallow` (comparaison element par element) ; le test verifie a la fois la stabilite de la reference ET la detection du changement de contenu. |
| Client HTTP | **sain.** Un seul point d entree (`apiClient`), timeout de 30 s, credentials cross-origine, et surtout : un 401 metier (`INVALID_CREDENTIALS`) ne purge PAS la session — taper un mauvais mot de passe ne deconnectait plus le joueur. |

---

## 7 nonies. Passe 8 - exploitabilite : ce que la lecture a donne

Modules lus : `render.yaml` (89), `.github/workflows/ci.yml` (87),
`package.json` (96), `.env.server.example`, plus le seed admin et les
variables d environnement lus par tout le serveur.

### Defaut 11 - l argent pouvait partir vers un numero PUBLIC (MAJEUR)

Le telephone du compte admin de controle tombait sur un numero de
DEMONSTRATION - `+2290161000001` - ecrit en clair dans le depot. Le
depot est public : ce numero est connu de quiconque.

Et `ZOYD_ADMIN_PHONE` n etait ni declaree dans le blueprint, ni
documentee dans le gabarit local. L avertissement `[SECURITY]` du seed ne
couvrait que l email, le pseudo et l id - pas le telephone.

**Correctif** (trois angles) :
1. le retrait vers ce numero est REFUSE (`PLACEHOLDER_PHONE`, 400) - on
   refuse le TRANSFERT, pas le compte ;
2. `ZOYD_ADMIN_PHONE` est declare dans `render.yaml` et documente dans
   `.env.server.example` ;
3. l avertissement `[SECURITY]` couvre desormais le telephone.

### Deux ecarts de configuration

| ecart | consequence |
|---|---|
| Le script `lint` ne couvrait pas `scripts/` | l outil d exploitation (`prod-inspect.mjs`) n etait pas controle par la CI |
| La CI ne rejoue pas les tests `live` | **c est voulu** : ils inscrivent un vrai compte sur la production |

### Le verrou : le contrat d exploitation

`server/deploy-contract.test.mjs` lie les trois mondes qui ne se
parlent que par des NOM DE CHAINE :

- toute variable declaree dans le blueprint est **lue** par le serveur ;
- toute variable lue est **declaree** ou explicitement facultative (avec sa
  raison ecrite) ;
- la CI rejoue les **memes** gates que le developpeur.

Un detail non evident : `ZOYD_2FA_ENC_KEY` est lue via
`readKey('...')` -> `process.env[nom]`. Un scan statique trop naif la
conclurait morte - c est le genre de faux positif qui fait abandonner un
controle.

---

## 7 decies. Passe 9 - l audit UI : ce que la MESURE a donne

Les huit premieres passes lisaient le CODE. Cette passe mesure l ecran
RENDU, dans un vrai navigateur, sur les 33 ecrans de l application.

### La methode (et pourquoi elle est replicable)

`e2e/ui/ui-audit-authenticated.spec.ts` (13 ecrans authentifies),
`e2e/ui/ui-audit-public.spec.ts` (14 ecrans publics, le back-office, et 5
ecrans de DETAIL a identifiant variable) et `e2e/ui/ui-audit-flows.spec.ts`
(les parcours a etats) mesurent, sur chaque ecran :

1. les violations **axe-core** bloquantes (serious / critical) ;
2. les images sans `alt` ;
3. les elements interactifs **sans nom accessible** ;
4. les **cibles tactiles** sous 24 x 24 px (WCAG 2.5.8) ;
5. les **erreurs JavaScript** de la console ;
6. les **reponses HTTP en erreur** de l API, avec leur URL.

La sonde elle-meme est partagee (`e2e/ui/support/audit.ts`) : deux copies
divergeraient, et la seconde cesserait de couvrir un critere sans que
personne ne s en apercoive. `scripts/audit-ui-aggregate.mjs` agrege les
inventaires par **CLASSE** de defaut - c est la classe qui demande une
correction, pas le cas isole.

Chaque inventaire JSON porte le detail du contraste mesure (couleurs
compositees, ratio obtenu, ratio exige) : un constat de contraste qui ne
dit pas CE QUI est trop clair n est pas un constat.

Ce que la passe a decouvert : **le detail d un match etait un ecran mort**.

### Les etats qu une route ne dit pas

Un audit par route visite des URL. Or plusieurs ecrans ne sont pas des
pages mais des **etats** d une meme page :

- `/mj/creer` est un assistant de **quatre** etats (format -> configuration
  -> mise -> recapitulatif) ;
- `/parametres` est un panneau de **quatre** onglets (compte -> securite ->
  gaming -> notifications).

L audit par route s arretait donc sur le premier etat : les saisies de
formulaire, les boutons radio, le recapitulatif de cagnotte et le tableau
de repartition du prize pool n avaient jamais passe sous une sonde. C etait
la que se trouvaient des textes a `text-white/40` et un bouton de
publication dont le nom accessible ne contenait pas son texte visible
(« Verrouiller la mise **&** publier » contre « ... **et** publier » : deux
chaines differentes pour axe-core).

`e2e/ui/ui-audit-flows.spec.ts` parcourt ces etats et les mesure avec la
meme sonde.

### Defaut 12 - boucle de rendu infinie sur le detail d un match (MAJEUR)

`MatchDetailPage` s abonnait a :

```ts
usePresenceStore((s) => (match ? s.getPresenceSummary(match.channelId) : {...}))
```

`getPresenceSummary` **CONSTRUIT** son objet a chaque lecture. La reference
change donc a chaque rendu, `useSyncExternalStore` y voit une modification,
React re-rend, relisit, reboucle :

```
The result of getSnapshot should be cached to avoid an infinite loop
Maximum update depth exceeded
React Router caught the following error during render
```

L ecran tombait sur son error boundary. Personne ne l avait vu : le test
e2e du detail de match visitait une route SANS identifiant, et l audit
d accessibilite existant ne couvrait que cinq pages publiques.

**Correctif** : `useShallow` autour du selecteur (comparaison element par
element), et une constante `EMPTY_PRESENCE_SUMMARY` pour le repli.

**Le verrou** : `selector-reference-stability.test.ts` gagne une REGLE
GENERALE - un selecteur de store ne doit jamais appeler un accesseur qui
construit un objet ou un tableau sans etre enveloppe dans `useShallow`.
La liste des exceptions (les accesseurs qui renvoient un **primitif**) est
verifiee A L EXECUTION : si l un d eux change de nature, le test echoue.
On ne peut pas faire glisser une boucle de rendu sous la regle.

### Une lecon de methode : un audit ne doit pas dependre de l ordre des tests

L audit de `/br` (liste des salons) echouait en fin de suite complete, mais
passait isole. La raison n etait pas un defaut intermittent : **l audit
mesurait un etat different selon l ordre d execution**.

La carte de salon n existe que s il y a un salon. Tant qu aucune autre
serie n avait cree de salon, l audit mesurait une liste VIDE - et les
defauts de la carte (le libelle du bouton « S inscrire », le contraste de
ses textes secondaires) n etaient pas visibles. Dans la suite complete,
une serie precedente avait cree des salons : l audit mesurait enfin la
carte, et signalait ses defauts.

C est le pire genre de defaut de couverture : un audit dont le resultat
dpend de ce qui a tourne avant. Le correctif est dans
`e2e/ui/support/fixtures.ts` : chaque audit FABRIQUE les donnees dont il a
besoin (`creerSalonBr`, `creerMatch`, `creerTournoi`, `creerSaisonLigue`),
et mesure toujours le meme etat, quel que soit l ordre.

### Un defaut de plus trouve par cette remise en etat

Le bouton « S inscrire » de la carte de salon portait un `aria-label`
fixe (« Inscriptions fermees ») alors que son texte visible est
« Complet » ou « Ferme » selon l etat. Un nom accessible qui ne contient
pas le texte visible viole WCAG 2.5.3 (meme regle que le bouton de
publication du recapitulatif).

Le correctif n est pas « un libelle fixe plus correct », mais **un
libelle qui n existe que lorsqu il apporte quelque chose** : le nom du
salon. Le texte visible nomme l action, le libelle ajoute le salon.

### Le verrou du contraste : un plancher, pas une liste

Corriger les 19 textes a `text-white/40` laisse le piege : le prochain
ecran en introduit un autre, et rien ne le signale. D ou une REGLE, dans
`src/app/components/ui/contrast-floor.test.ts` :

- un **texte** ne descend pas sous **50 %** d opacite (~5,3:1 sur fond
  quasi noir) ;
- une **icone** (composant auto-fermant) a un plancher de **40 %**
  (~3,7:1), ce qui satisfait WCAG 1.4.11 pour un graphisme porteur de
  sens - une illustration d etat vide en porte un ;
- une exception exige un marqueur `/* CONTRASTE-OK: <raison> */` sur la
  meme ligne. WCAG 1.4.3 exempte explicitement le texte incident et les
  composants desactives : interdire categoriquement une valeur legitime
  obligerait un jour a violer la norme. La marqueur impose d ecrire la
  raison - c est la que se joue la relecture.

Le meme test verrouille le jeton `--color-zoyd-muted` du design system
(il valait 40 % d opacite : le « secondaire » de toute l application
etait sous le seuil). Un jeton de couleur ne se verifie pas a l oeil.

**Ce que la regle a attrape que l audit n avait pas vu** : la page de
selection de mode portait `text-white/46` - meme famille, meme
interpolation, mais 46 % n est pas un motif que la sonde axe-core
signale. C est precisement ce qu apporte une regle qui couvre TOUT le
source.

### Les autres classes trouvees (et corrigees)

| classe | ou | correction |
|---|---|---|
| Nom accessible sans le texte visible (WCAG 2.5.3) | avatar de la nav et de la barre laterale, presets « BO3 », lien « CREER UN WAGER », bouton « Nouvelle discussion », panneau « Amis ZOYD », **cloche de notifications**, bouton de publication du recapitulatif | le nom accessible contient desormais le texte visible |
| Lien sans nom accessible | fleche de retour du bracket d un tournoi | `aria-label="Retour aux tournois"` |
| Contraste sous 4,5:1 | six pages legales, detail d un salon BR, **19 textes a `text-white/40`** repartis sur dix fichiers, jeton `--color-zoyd-muted` | `text-white/40` et `/30` -> `/70`, jeton porte a 70 % |
| Cibles tactiles < 24 px | nav et pied de page de la landing, liens de retour (match, ligue, profil, salon BR) | `min-h-6` sur chaque lien |

Le cas de la **cloche de notifications** merite un mot : son badge de
compteur est du TEXTE VISIBLE. Un `aria-label="Notifications"` fixe viole
WCAG 2.5.3 (le texte visible doit etre dans le nom accessible). Le nom
reprend donc le compteur affiche - ce qui est, au passage, plus utile :
un lecteur d ecran sait combien de notifications attendent.

### Ce qui n etait PAS un defaut (faux positifs ecartes, et pourquoi)

Un audit qui ne sait pas reconnaitre un faux positif est un audit qui
oblige a ignorer des signalements. Six classes ecartees, chacune avec sa
raison :

| faux positif | pourquoi ce n est pas un defaut |
|---|---|
| Le lien d evitement « Aller au contenu principal » (1 x 1 px) | il est cache (`sr-only`) et n apparait qu AU FOCUS : sa taille reelle est le mecanisme du motif |
| Les liens en ligne dans une phrase (« Frais et conditions · Jeu responsable ») | WCAG 2.5.8 exempte explicitement une cible dans un texte |
| Une case a cocher dans un `<label>` (20 x 20 px) | c est le LABEL qui est la cible : cliquer l etiquette la coche |
| Le 401 de `/api/auth/me` sur une page anonyme | c est le fonctionnement normal d une page publique |
| Les 403 de `/api/admin/{commissions,reports,sanctions}` | la 2FA admin n est pas validee dans le navigateur : le back-office affiche « N/D » et invite a revalider |
| **Le contraste mesure pendant une animation d entree** | les cartes du hub BR entrent en scene avec un `motion.div` (`initial="hidden"`, `variants={staggerItem}`). Pendant le fondu, l opacite du texte est inferieure a 1 : axe compose le texte avec le fond et mesure 1,2:1 ou 3,5:1 la ou il y en a 15. Le defaut etait donc **aleatoire** (il dependait du nombre de cartes) - et c est ce qui l a rendu si difficile a attraper |

Un sixieme faux positif a ete corrige dans la SONDE elle-meme : le lien
« logo » de l inscription ne portait pas de texte, mais son image a un
`alt="ZOYD"` - son nom accessible existe, la mesure le voyait mal.

Le faux positif de l ANIMATION a demande une correction de la sonde
aussi : `waitForRender` attend maintenant la stabilisation des opacites
(`e2e/ui/support/session.ts`). `prefers-reduced-motion` ne suffisait pas :
Framer-motion coupe les animations de TRANSFORM mais PAS celles d
OPACITE (`MotionConfig reducedMotion="user"` preserve explicitement
l opacite).

### La couverture

Les **33 ecrans** de l application sont couverts - une mesure par etat
affiche, `/classements` etant mesure dans ses DEUX variantes (anonyme et
authentifiee) - y compris les 5 ecrans de DETAIL (`/mj/match/:id`,
`/mj/tournois/:id`, `/br/:lobbyId`, `/br-league/:seasonId`,
`/profil/:id`) : leurs donnees sont FABRIQUEES par l API avant le test.
Sans cela, les cinq routes variables seraient tombées sur leur etat
« introuvable », et l audit n aurait mesure que la page d erreur - cinq
fois de suite.

S y ajoutent les **7 etats** des parcours (`ui-audit-flows.spec.ts`) :
les quatre etapes de l assistant de creation d un match et les trois
onglets non par defaut des parametres.

L audit est un GATE BLOQUANT : la CI rejoue `pnpm test:e2e:ui`, donc
chaque ecran, a chaque commit.

Et il est rejoue **en production** : `e2e/live-ui/live-ui-audit.spec.ts`
rejoue la meme sonde sur les quatorze ecrans publics de
`zoyd.vercel.app`. Un audit vert en local ne dit rien du bundle DEPLOYE
- celui-ci peut avoir ete construit avec un autre commit, ou servir un
CSS different. Les ecrans authentifies en sont exclus : les creer en
production polluerait la base.

Verifie sur le deploiement du commit `365d1a0` : 14 ecrans verts, API en
`commit=365d1a0` et `stateTrusted=true`.

---

## 7 undecies. Passe 10 - la REDACTION : coquilles, libelles, incoherences

Les neuf premieres passes regardaient ce que l application **FAIT**. Celle-ci
regarde ce qu elle **DIT**.

### La methode

Trois extractions de chaines (le texte JSX, les attributs de texte, les
messages de toast), relues a la main, puis regoupees par **classe**. Un
audit de redaction qui ne garde que les cas ne sert a rien : « Arbitres
necessaires » et « Base de donnees complete » demandent la meme correction
de processus.

### Ce que la passe a trouve

| classe | nombre | exemples |
|---|---|---|
| Accent manquant dans un texte visible | 25 | « Arbitres necessaires », « Base de donnees complete », « Verification impossible. », « Detail du salon », « Les dernieres leaks » (meta description SEO) |
| Libelle d action au NOM | 5 | le bouton de connexion disait « CONNEXION » (le nom de la page) ; « Connexion joueur » comme appel a l action |
| Taux ZC -> FCFA ecrit en dur | 3 | les CGU affirmaient « 1 ZC = 10 FCFA » ; l assistant de creation recalculait `livePot * 10` a la main |
| Ponctuation collee, mot manquant | 2 | « l'heure exacte,CODE salon commun » ; « Connexion par Google ou numero : » (sans « de telephone ») |

Le cas du **taux** est le plus serieux, et il ne se voyait pas : le test
miroir (`format-mirror.test.ts`) verifie que la constante du front vaut
celle du serveur - mais il ne controle pas ses **usages**. L assistant de
creation faisait donc sa PROPRE conversion, dans un ecran ou le reste de
l application affichait la bonne. Les CGU, elles, affirmaient un taux ecrit
a la main : une **troisieme** copie, que rien ne surveillait.

### Les trois verrous

`src/lib/copy-rules.test.ts` couvre des CLASSES entieres :

1. **Les accents.** Une liste de mots francais qui portent un accent,
   verifiee sur tous les textes visibles. La liste est courte et
   VERIFIEE : chaque entree correspond a une coquille reellement trouvee.
2. **Le libelle d action.** Un bouton porte une ACTION, donc un verbe.
   La regle ne regarde que les elements d action (boutons, et liens qui
   ont l aspect d un bouton) : « Connexion » reste valide pour un lien de
   navigation vers la page de connexion.
3. **Le taux.** Aucun ecran ne peut ecrire le taux en clair ni recalculer
   la conversion a la main.

### Les faux positifs (et pourquoi on ne les corrige pas)

Une regle de redaction qui ne sait pas reconnaitre un faux positif oblige a
ignorer des signalements. Cinq cas ecartes, chacun avec sa raison :

| faux positif | pourquoi |
|---|---|
| « Termine tes matchs » | IMPERATIF de « terminer » : pas d accent. « un match termine » (participe) en prend un. Meme orthographe : seule la regle generale ne peut pas trancher - les cas ambigus sont verrouilles nominativement |
| « Arbitres necessaires » | « arbitres » est un NOM (les arbitres du tournoi), pas un participe. Seul « necessaires » porte un accent |
| « Joueurs au complet » | « complet » = plein. « complete » = acheve. Deux mots, deux orthographes |
| « Connexion » en lien de navigation | c est le NOM de la page. Un lien de navigation porte un nom, un bouton un verbe |
| « Retrait minimum : 150 ZC » | « retrait » est un mot de CONTENU legitime. Interdire ce mot produirait des faux positifs |

Les cas ambigus sont verrouilles par des assertions nominatives (les
badges de statut du hub BR, le libelle admin « SORTIES ARBITRES », la
« Part d'arbitres ») : c'est plus long, mais c'est exact.

### Le code mort : une bibliotheque de design jamais adoptee

Le meme balayage a cherche les **exports jamais cites ailleurs** (56
trouvailles). Presque toutes sont benignes : un `export` de trop, ou un
composant de bibliotheque prevu pour plus tard.

Une seule famille merite un arbitrage humain, parce qu elle mesure une
**incoherence structurelle** : le dossier `src/app/components/ui/` contient
un design system (Button, Input, Modal, Badge, Tabs, Card, Skeleton,
AnimatedNumber... et 9 composants jamais utilises : Label, ProgressBar,
Separator, Alert, Form, Sheet, Table, Toggle, Tooltip, soit ~700 lignes).
Et l application l utilise **parcimonieusement** :

| | brut | design system |
|---|---|---|
| boutons | 219 `<button>` | 35 `<Button>` (10 fichiers) |
| champs | 65 `<input>` | 35 `<Input>` (6 fichiers) |

Autrement dit : **l application a deux langages de bouton**, et le design
system n est employe que dans 14 % des cas. La consequence est
concrete, et l audit UI l a montre : la hauteur, l anneau de focus, l etat
desactive et la typo d un bouton dependent du fichier ou l on se trouve.
C est exactement pour cela que la passe 9 a dut corriger les cibles
tactiles **une par une** (`min-h-6`, `min-h-11`, `touch-target`).

Ce n est pas un defaut qu une relecture de code rattrape : c est une dette
de structure. La corriger est un chantier (219 boutons), pas une
correction. Le chemin qui ne casse rien : adopter le design system
**ecran par ecran**, en commençant par les ecrans les plus vus (hub,
portefeuille, chat). Tant que ce n est pas fait, la regle « une cible
tactile fait 24 px » doit continuer d etre verifiee par la SONDE
(`e2e/ui/support/audit.ts`) - c est elle qui tient la ligne entre-temps.

---

## 7 douzieme. Passe 11 - la REDACTION du backend : ce que le serveur dit

Les dix premieres passes regardaient le CODE. Les deux dernieres regardent
ce que l application **DIT** - d'abord le front (passe 10), puis le
serveur (passe 11).

### Pourquoi le serveur compte

Les messages du serveur sont affiches au joueur : le front ne traduit
que les codes qu il connait (`ERROR_MESSAGES`) et retombe SINON sur le
message du serveur. Un message serveur mal ecrit est donc devant les yeux
du joueur, dans TOUTES les erreurs de l application.

### Ce que la passe a trouve

| classe | nombre | exemple |
|---|---|---|
| **Apostrophe elidee** | ~60 | « Tu n es pas inscrit », « l historique des bails », « d un compte ZOYD » |
| Accent manquant | ~150 | « 2FA deja activee », « Verification 2FA requise », « Corps de requete invalide » |
| Message en anglais | 7 | « Upstream API error. », « Failed to fetch store data. », « Access denied to this channel. » |
| Preposition « a » sans accent | ~25 | « rattache a un compte », « inscrit a cette ligue », « limitee a 0 ou 1 » |
| Meme code, deux libelles | 3 | `2FA_REQUIRED`, `INVALID_ENTRY_FEE` (« positif » vs « strictement positif »), `INVALID_EMAIL` |

**L apostrophe elidee avait une cause**, et elle est instructive : les
messages sont des chaines entre apostrophes simples, et ecrire une
apostrophe demanderait un echappement (`\'`). L auteur SUPPRIMAIT
l apostrophe plutot que de l echapper. Le resultat etait une phrase
grammaticalement fausse, sur les 508 messages du serveur.

Le resultat visible : **le serveur etait a deux langues** - les
COMMENTAIRES accentues, les MESSAGES non accentues.

### Les verrous

`server/copy-rules.test.mjs` (4 tests) verifie sur les 508 messages :

1. aucune apostrophe elidee ;
2. aucun message en anglais ;
3. aucun accent perdu (liste de mots dont l accent est obligatoire -
   les homographes comme « confirme » (imperatif) ou « annuler » (infinitif)
   sont exclus : meme orthographe, sens oppose) ;
4. l existence meme des messages (une regle qui ne verifie rien ne
   verifie rien).

`src/lib/legal-mirror.test.ts` (7 tests) lie les **CGU aux
constantes du serveur** : le retrait minimum, la commission ZOYD, le
plafond quotidien, le maximum par retrait, la commission d arbitrage
(tournoi et match) et le taux ZC -> FCFA. Les CGU etaient un document
JURIDIQUE fige dans un composant React, sans lien avec les seuils
reellement appliques : les changer un jour n'aurait rien mis a jour.
Le test lit les constantes du serveur et verifie que les CGU les
reprennent.

### Les faux positifs (et pourquoi on ne les corrige pas)

| faux positif | pourquoi |
|---|---|
| « Confirme la perte du solde » | IMPERATIF de « confirmer » : pas d accent. « confirmé » (participe) en prend un |
| « un mot de passe valides » | adjectif : pas d accent. « validés » (participe) en prend un |
| « Annule le match plutot » | infinitif : pas d accent |

Meme orthographe, sens oppose : c est le contexte qui tranche, pas une
regle de dictionnaire. Les cas nominatifs sont donc traites par des
corrections ciblees, avec leur phrase entiere.

### Et les journaux ? (meme peigne)

Les messages de JOURNAL ne sont pas affiches au joueur, mais ils sont lus
par l exploitant - et ils etaient dans un etat pire : **105 messages en
anglais et 147 en francais, dans les memes fichiers**, parfois pour le
MEME evenement (« Notification delivery failed » huit fois, « Restitution
du pass match... » en francais).

Le journal est donc passe au meme peigne : les messages anglais sont
traduits (le projet est francais : commentaires, messages joueur,
documentation, commits), les messages francais sont accentues, et les
verrous couvrent desormais les DEUX (le verrou `server/copy-rules.test.mjs`
lit les messages de journal en plus des messages de reponse).

Une consequence a assumer : **le texte des journaux change**. Un grep sur
un ancien libelle (« Notification delivery failed ») ne trouve plus rien.
C est le prix de la coherence, et le changement est date par le commit.

Un piege evite en route : la correction porte sur le CORPS du message
(decode -> correction -> re-encode), jamais sur le fichier entier.
Re-encoder le fichier echappait TOUTES les apostrophes du code, imports
compris - le serveur ne demarrait plus.

---

## 7 trezieme. Passe 12 - le PARCOURS en PRODUCTION

Onze passes de LECTURE ne disent rien de ce que le deploiement fait
reellement. Celle-ci est la premiere qui **exerce** le produit la ou il
vit : `https://zoyd.vercel.app` (front) + `https://zoyd.onrender.com`
(API). C est aussi la premiere qui laisse des traces (des comptes, des
matchs, des tournois) - donc la premiere qui se termine par un
**nettoyage**.

### La methode

Un script, `scripts/prod-walkthrough.mjs`, rejoue le parcours joueur par
phases, contre la production reelle :

| phase | ce qu elle exerce |
|---|---|
| `comptes` | inscription de 12 comptes (numeros du Benin, de la CI et du Togo) |
| `sessions` | connexion, profil, serment d integrite, mise a jour |
| `portefeuille` | lecture du portefeuille, politique de retrait, historique |
| `depot` | verification du depot FedaPay sandbox, idempotence, anti-vol |
| `matchs` | cycle de vie complet, du 1VS1 au 5VS5, avec de vraies mises |
| `tournois` | creation, inscriptions, refus du tournoi gratuit |
| `br` | salon BR, join, check-in, regles de programmation |
| `ligue` | lister les saisons |
| `social` | amis, notifications, chat |
| `temps-reel` | sante du temps reel, session invalide, 404, corps malforme |
| `nettoyage` | annulation des matchs et SUPPRESSION des comptes |

Garde-fou : sans `--live`, le script ne fait rien. Les sessions sont
conservees d une phase a l autre (le quota d authentification est de 50
par IP et par 15 minutes - c est une ressource rare).

### Ce que le parcours a PROUVE (ce que la lecture ne pouvait pas montrer)

**Le depot FedaPay sandbox fonctionne en production, de bout en bout.**
Le front sert une cle publique `pk_sandbox__...`, le widget ouvre
`sandbox-checkout.fedapay.com`, le paiement est approuve, le front
appelle `/api/wallet/verify-fedapay`, le serveur verifie avec sa cle
secrete et credite. Onze depots ont ete payes dans le sandbox (150 a
500 ZC, sur douze comptes), et chaque credit a ete relu cote serveur
(solde + transaction `deposit` + notification dans le centre).

**Le cookie cross-site fonctionne.** Le front (Vercel) et l API (Render)
sont sur DEUX sites : le cookie de session est `HttpOnly; Secure;
SameSite=none`. Aucun test local n exerce ce chemin - en local, tout est
sur `localhost`, donc `Lax`. C est le chemin le plus risque du produit,
et il n etait couvert par aucun test.

**Le cycle de vie d un match va jusqu au bout**, pour les cinq formats :
creation -> inscription (le pass est bloque) -> check-in -> pret ->
programmation de l heure -> publication de la salle -> lancement ->
resultat (avec preuves) -> confirmation des deux equipes -> reglement.
La cagnotte est bien versee (`prize_win` dans le portefeuille).

### Les contraintes que le parcours a revelees

Elles ne sont pas des defauts : ce sont des **regles du serveur** qu il
fallait connaitre, et que la lecture seule ne revelait pas.

| contrainte | consequence |
|---|---|
| `entryFee` doit etre **strictement positif** pour qu on puisse rejoindre un match | un match a 0 est CREABLE mais pas rejoignable |
| La salle se publie **seulement dans les 10 minutes** qui precedent l heure | l ordre est : heure, puis salle |
| Un resultat exige **un tableau des scores ET un ecran final, distincts** | pas de resultat sans preuves |
| Un salon BR se programme **24 h a l avance au minimum** | son cycle ne peut pas etre joue en direct |
| Quotas : `auth` 50/15 min, `social` 30/min, `match` 10/min | le parcours doit etre pace, sinon la moitie des appels part en 429 |

Le piege du parcours : un quota sature ne se distingue pas d un refus
fonctionnel dans la sortie brute. Les deux renvoient une erreur, seule la
mesure la fait (`RATE_LIMITED` contre un code metier).

### Les defauts que le parcours a trouves

**Une classe de texte affiche hors de tout verrou.** Les notifications
(`title`/`body`) et les `hint` sont affiches au joueur, mais les
verrous de redaction ne lisaient que les messages de REPONSE et de
JOURNAL. Le parcours a lu un ecran reel : « Depot credite », « Arbitre
assigne », « Resultat a confirmer », « Tournoi demarre », « Journee BR
Lancee », plus deux `hint` de salon BR et cinq messages de journal.
Le verrou est desormais elargi a ces quatre champs.

**De l anglais dans des messages joueur** : « renseigne la **room** »,
« Ajoute au moins un **scoreboard** » - la, tout parle de « salle ».
Et cote front : « **Best of** », « **room** setup », « **slots** », «
**BO3 - best of 3** ».

**Un libelle accessible qui masque le libelle visible** (WCAG 2.5.3
« Label in Name ») : la barre basse affiche « MSGS » mais son nom
accessible etait « MESSAGES ». Une commande vocale (« clique MSGS »)
ne trouvait pas le bouton. La regle est desormais mesuree dans le DOM
comme le contraste.

### Les verrous

| verrou | ce qu il interdit |
|---|---|
| `server/copy-rules.test.mjs` | accent manquant, apostrophe elidee ou mot anglais dans une REPONSE, un JOURNAL, une NOTIFICATION (`title`/`body`) ou un `hint` |
| `src/lib/copy-rules.test.ts` | accent manquant ou mot anglais dans un texte visible du front |
| `e2e/ui/responsive.spec.ts` | nom accessible qui ne contient pas le libelle visible (WCAG 2.5.3) |

Le dictionnaire des mots accentues est desormais **partage** entre le
front et le serveur : une coquille ne peut plus se cacher d un cote.

### Les limites que le parcours ne prouve pas (et le dit)

- **Le retrait.** Hors perimetre, comme demande. Aucun retrait n a ete
  tente en production.
- **Le cycle BR complet.** Un salon BR ne peut pas demarrer avant sa
  date (24 h). La creation, le join et le check-in sont verifies ; la
  partie, elle, demande un decalage temporel.
- **L etude d utilisabilite.** Ce qui suit est un parcours FONCTIONNEL
  scripté (des interactions reelles, des assertions). Ce n est pas une
  etude humaine (5 personnes, 5 taches, observation de la
  comprehension). Les deux ne trouvent pas les memes choses.
- **Les quotas a l echelle.** Le parcours frappe les quotas pendant
  quelques minutes ; il ne mesure pas le comportement a long terme.

### Le nettoyage : ce qu il a appris

Le nettoyage est la phase la plus utile du script, parce que c est la
seule qui doit etre FIABLE : un nettoyage qui echoue laisse des
comptes, des matchs et de l argent bloque en production.

Trois pieges ont ete rencontres, tous dans le meme sens — une source
de verite qui parait complete et ne l est pas :

| piege | consequence |
|---|---|
| La recherche d utilisateurs **exclut l utilisateur connecte** (`filter((u) => u.id !== session.user.id)`) | le compte de session n etait JAMAIS dans les resultats : il n etait donc jamais supprime. Le nettoyage passe maintenant par la liste CONNUE des pseudos de test. |
| Un pass bloque dans un **tournoi** ou un **salon BR** empeche la suppression du compte (« Tu as des wagers en cours ») | le nettoyage fait sortir chaque inscrit du tournoi et du salon, avant de supprimer les comptes |
| L annulation d un match ne passe que par son **createur**, et seulement s il n est ni lance, ni solde, ni en litige | les matchs deja regles sont laisses (l argent est distribue) ; les autres sont annules, ce qui rend les passes |

La phase est **autonome** : elle ne depend ni de l etat local, ni d une
session preexistante. Elle se reconnecte, decouvre ce qu elle doit
effacer par l API, et se termine sur une verification par tentative de
connexion (le seul test qui ne trompe pas).

---

## 8. Synthese des douze passes

| # | Defaut | Gravite |
|---|---|---|
| 1 | Le quota anti-bruteforce etait contournable (en-tete choisi par l appelant) | MAJEUR |
| 2 | La cle Supabase n etait pas verifiee (cle anon acceptee) | MAJEUR |
| 3 | Le rejeu OCC ne resynchronisait pas les index d identite | MAJEUR |
| 4 | Le podium de la ligue ne conservait pas la cagnotte | MAJEUR |
| 5 | Sept routes n avaient aucun quota | MAJEUR |
| 6 | Les privileges d un socket ouvert n etaient pas revocables | MAJEUR |
| 7 | Le joueur etait told que son solde etait restaure quand il ne l etait pas | MAJEUR |
| 8 | L argent pouvait partir vers un numero public | MAJEUR |
| 9 | Le taux ZC -> FCFA etait reecrit de chaque cote | MAJEUR |
| 10 | Le miroir de formatage des montants avait diverge | MINEUR |
| 11 | La purge de retention echouait en silence (LIMIT invalide) | MAJEUR |
| 12 | Le detail d un match etait un ecran mort (boucle de rendu infinie) | MAJEUR |
| 13 | Le taux ZC -> FCFA etait reecrit dans des textes et des calculs (troisieme copie) | MAJEUR |
| 14 | Un bouton d action portait un nom (« CONNEXION ») | MINEUR |
| 15 | 25 textes visibles du front perdaient leur accent | MINEUR |
| 16 | ~60 messages serveur avaient l apostrophe ELIDEE (« n es ») | MAJEUR |
| 17 | 7 messages serveur etaient en anglais | MINEUR |
| 18 | Les CGU ne tenaient pas compte des seuils reels du serveur | MAJEUR |
| 19 | Le journal melangeait 105 messages anglais et 147 francais | MINEUR |
| 20 | Les NOTIFICATIONS (texte affiche au joueur) n etaient couvertes par AUCUN verrou | MAJEUR |
| 21 | Un message joueur en anglais : « renseigne la **room** », « un **scoreboard** » | MINEUR |
| 22 | Le front affichait « **Best of** », « **room** setup », « **slots** » | MINEUR |
| 23 | Le nom accessible ne contenait pas le libelle visible (WCAG 2.5.3) | MINEUR |

**Seize defauts majeurs, dix mineurs.** Chacun est couvert par un test
verifie ECHOUANT avant le correctif.

### Les verrous structurels ajoutes

Ce sont eux qui comptent : ils couvrent des CLASSES de defauts, pas des
cas isoles.

| verrou | ce qu il empeche |
|---|---|
| `routes-rate-limit-invariant.test.mjs` | une route sans quota (la coverage etait une LISTE) |
| `league-payout-conservation.test.mjs` | une repartition qui cree ou detruit de la monnaie |
| `realtime-socket-privilege.test.mjs` | un privilege fige a la connexion |
| `api-contract.test.ts` | un chemin appele par le front qui n existe pas cote serveur |
| `deploy-contract.test.mjs` | une variable d environnement declaree et non lue, ou lue et non declaree |
| `selector-reference-stability.test.ts` | un accesseur de store appele hors d un hook, ou un accesseur INSTABLE appele dans un selecteur (boucle de rendu) |
| `contrast-floor.test.ts` | un texte sous 50 % d opacite (WCAG 1.4.3), une icone sous 40 % (1.4.11), un jeton de couleur sous le plancher |
| `copy-rules.test.ts` | un accent perdu, un mot anglais, un libelle d action au nom, un taux monetaire ecrit en dur |
| `server/copy-rules.test.mjs` | une apostrophe elidee, un accent perdu, un mot anglais (reponses, JOURNAUX, NOTIFICATIONS et `hint`) |
| `legal-mirror.test.ts` | des CGU qui ne disent plus les seuils reellement appliques |
| `e2e/ui/ui-audit-*.spec.ts` (gate CI) | un ecran qui devient inaccessible : nom accessible, contraste, cible tactile, NOM ACCESSIBLE SANS LE LIBELLE VISIBLE (WCAG 2.5.3), erreur JS, reponse HTTP en erreur |
| `scripts/prod-walkthrough.mjs` + `e2e/live-ui/live-parcours.spec.ts` | un deploiement qui ne fait plus ce que le code pretend (parcours reel, en production) |

### Le keep-alive : l hibernation est traitee (deux mecanismes)

Le service Render du plan gratuit dort apres ~15 minutes sans trafic, et
les travaux de fond ne tournent QUE service eveille. Deux mecanismes,
choisis pour des **modes de defaillance opposes** :

| mecanisme | cadence | pourquoi |
|---|---|---|
| `.github/workflows/keepalive.yml` | 5 min | versionne dans le depot : relu, modifie et audite comme le reste du code. Declenchable a la main. |
| `pg_cron` + `pg_net` (Supabase) | 1 min | precis, et survit au retard des taches planifiees de GitHub. |

Pourquoi deux : le plan gratuit de Supabase met le PROJET en pause apres
7 jours d inactivite complete - c est precisement le moment ou l on
aurait le plus besoin du keep-alive. GitHub, lui, peut retarder une
tache planifiee. Un seul des deux suffit presque toujours ; les deux
ensemble ferment la fenetre.

Le workflow utilise `curl --fail` : une sonde qui repond 500 fait
ECHOUER la tache. Le keep-alive ne doit pas masquer une panne.

#### D ou vient le probleme (et pourquoi il est passe inapercu)

Le keep-alive **existait deja** : il a ete cree le 9 novembre 2026
(`bea0d4a`, « cron keep-alive Render toutes les 10 min »). Le meme jour,
un commit de nettoyage (`13f44cd`, « tous les non-vital build/runtime
restants ») a supprime **14 fichiers** d un coup : la CI, le keep-alive,
les migrations Supabase, les fichiers `public/`, le gabarit `.env`...

**Tout a ete restaure, sauf le keep-alive.** C est la seule omission, et
elle est a l origine de toute la saga de l hibernation.

Pourquoi personne ne l a vu : le symptome est **invisible sans trafic**.
Un service qui dort ne casse rien - il ne fait que retarder un reglement
ou une liberation de fenetre, chez un joueur qui n attendait rien. Aucun
test ne le revele : les tests tournent en memoire, et la production ne
regarde pas ses crons.

La lecon, en une ligne : **un nettoyage trop large a supprime 14 choses,
et 13 ont ete restaures par la suite - la 14e est tombee dans le trou.**
Un test de non-regression ne l aurait pas vu non plus (le workflow est
de la configuration, pas du code) : c est un controle de
`deploy-contract.test.mjs` quiprotege desormais le keep-alive.

#### Mesures

| mesure | resultat |
|---|---|
| Job `cron` Supabase | 19 executions, la derniere **38 secondes** avant la lecture, **0 echec** |
| Service Render | **22 minutes sans aucun trafic de ma part** : instance et processus **identiques** -> il ne s est pas endormi |
| Planificateur GitHub | **tres irregulier** : l historique du workflow montre des ecarts de **3 a 7 heures** entre executions (le workflow d origine etait cale sur 10 min) |

=> Le cron Supabase est **le mecanisme porteur** ; le workflow GitHub est le
filet de securite, pas la cheville. C etait l inverse de ce que j avais
suppose en installant les deux.

#### Pourquoi pas de `healthCheckPath` dans le blueprint

C etait l idee la plus simple — Render sonderait lui-meme la route. Elle
est **dangereuse** ici : `/api/health` repond **503** quand l etat n est pas
fiable (base injoignable). Render Considererait alors l instance comme
**mauvaise** et lui retirerait du trafic : une incident de base deviendrait
une panne de service, sur une route qui ne fait QUE constater la panne.
Le keep-alive externe, lui, ne fait que du trafic.

#### Ce que le keep-alive coute

Le service Render du plan gratuit turned en continuite : **~730 heures
par mois**, pour une enveloppe gratuite de **750 heures**. Cela passe, mais
de justesse : **un second service maintenu en permanence ferait depasser la
quota.**

Si le trafic devient reel, la bonne solution n est pas de multiplier les
pingers : c est de passer sur une instance payante (toujours allouee, sans
ping, et avec des crons qui ne ratent jamais).

Verification : le job `cron` a bien reussi a chaque minute (14:59, 15:00,
15:01) et le service n a pas change d instance ni de processus.

### Ce qui reste ouvert (decision humaine)

**La marge de quota du plan gratuit.** Le keep-alive consomme ~730 h/mois
sur une enveloppe de 750 h. Ca passe, mais de justesse : **un second
service maintenu en permanence ferait depasser la quota.** Ce n est pas
un defaut, c est un arbitrage : si le trafic devient reel, la bonne
solution n est pas de multiplier les pingers, c est de passer sur une
instance payante (toujours allouee, sans ping, et avec des crons qui ne
ratent jamais). Le detail est dans la section keep-alive ci-dessus.

**L ouverture au public.** C est une decision produit, pas un defaut :
quels pays, quels moyens de paiement, quels contenus legaux. Le code ne
decide pas de cela. Ce qui est verifie, c est que rien ne bloque le
reglement une fois la decision prise : les regles de reglement, les
quotas de debit et la conservation de la monnaie sont chacune couvertes
par un test.

Le reste de ce document decrit des etats **verifies** : chaque correctif
cite a son test, chaque test a ete vu echouer avant le correctif.

---

## 8. Ce que ce document ne dit pas (et pourquoi)

Honnetete sur la portee :

- Il ne decrit **pas** le detail des regles metier (remparts, formats de
  telephone, baremes de commission). Pour ca : les moteurs et leurs
  tests.
- Il ne decrit **pas** le front page par page (192 fichiers) - mais il
  decrit ce que l audit UI a mesure dessus, ecran par ecran.
- Il ne pretend **pas** avoir fait une etude d utilisabilite. Le
  parcours de la passe 12 est un parcours FONCTIONNEL scripté (des
  interactions reelles, des assertions). Une etude humaine (5 personnes,
  5 taches, observation de la comprehension et de la charge mentale)
  trouverait d autres choses - elle demande des humains.
- Il ne pretend **pas** avoir teste le retrait en production (hors
  perimetre demande) ni le cycle complet d un salon BR (un salon ne peut
  pas demarrer avant sa date).
- Il ne dit **pas** que le code est correct. Les douze passes ont trouve
  16 defauts majeurs et 10 mineurs ; d autres restent possibles. La carte
  decrit la **forme**, pas la **correction**.

Ce qui est vérifié à la date du document : l'inventaire (mesuré), la
topologie d'exécution (lue dans `realtime-server.mjs`), le contrat des
routes (lu dans les 12 en-têtes), et l'état de production (déployé sur
`origin/main`, gates verts).
