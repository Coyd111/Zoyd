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

## 8. Synthese des huit passes

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

**Huit defauts majeurs, deux mineurs.** Chacun est couvert par un test
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
| `selector-reference-stability.test.ts` (existant) | un accesseur de store appele hors d un hook |

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

Verification : le job `cron` a bien reussi a chaque minute (14:59, 15:00,
15:01) et le service n a pas change d instance ni de processus.

### Ce qui reste ouvert (decision humaine)

**L hibernation du plan gratuit.** Le service Render dort apres ~15 min
sans visite : les crons de fond ne tournent que service eveille. Aucun
impact aujourd hui (0 transaction d argent, 3 matchs de test), mais au
moment de l ouverture au public, un joueur qui gagne un match pendant
que le dernier joueur a ferme l application attend le prochain visiteur.
Le correctif le plus simple est un client externe qui pingue
`/api/health` chaque minute.

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
