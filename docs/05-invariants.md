# ZOYD — Les invariants

> **C'est le document le plus important du projet.** Il énonce les règles
> business qui ne doivent jamais casser, où elles sont codées, comment on peut
> les vérifier, et — surtout — **lesquelles ne sont pas tenues**.
>
> Méthode : chaque énoncé porte une citation `fichier:ligne` vérifiée dans le
> code. Un invariant qui n'a pas pu être vérifié est marqué **non vérifié**
> plutôt qu'affirmé. Un rapport antérieur a été utilisé comme piste de
> recherche, **pas comme source** : plusieurs de ses constats ont été
> infirmés (§7).

Base : dépôt local `E:\web_app\projrt\Z.O.Y.D\Zoyd`, commit de travail `0328dc8`.
Dernière vérification : lecture directe de `server/`, `src/`, `e2e/`, `supabase/`.

**Convention de lecture**

| Mention | Signification |
|---|---|
| `fichier:ligne` | Emplacement exact dans le code |
| `server/…test.mjs:n` | Test unitaire couvrant l'invariant (le nom du test est donné) |
| `e2e/…spec.ts:n` | Test E2E API couvrant l'invariant |
| **AUCUN TEST** | Invariant codé mais **non couvert** par un test identifiable |
| **NON VÉRIFIÉ** | Impossible à trancher depuis le dépôt |

---

## 1. Invariants d'argent

Ce sont les invariants qui protègent le portefeuille. Ils sont énumérés
premiers parce que ce sont eux qui coûtent le plus cher quand ils cassent.

### I1 — Aucun règlement sans arbitre désigné

| | |
|---|---|
| **Énoncé** | Aucune somme ne quitte le pot d'un match sans qu'un arbitre ait été désigné. |
| **Code** | `server/match-engine.mjs:306-308` (garde de règlement) et `server/match-engine.mjs:872-874` (garde de soumission) |
| **Erreur** | `ARBITER_REQUIRED` |
| **Tests** | `server/arbiter-required.test.mjs:82` « un joueur NE PEUT PAS valider le score quand il n y a pas d arbitre » · `:96` · `:103` « ni l'administrateur ni personne ne peut regler sans arbitre » · `:115` · `:132` « le reglement refuse de distribuer un pot sans arbitre » · `e2e/api/match.spec.ts:316` |

> La garde est **double et volontairement dupliquée** : `applyResultSettlement`
> est appelée par cinq chemins (`:963`, `:994`, `:1060`, `:1097`, `:1223`), donc
> un garde unique à la soumission laisserait passer la reprise. Le commentaire
> `server/match-engine.mjs:296-305` l'explique.

### I2 — On ne verse que le pot **réellement verrouillé**

| | |
|---|---|
| **Énoncé** | Le montant versé ne peut pas dépasser la somme des réservations wallet des joueurs présents. |
| **Code** | `server/match-engine.mjs:312` (`getLockedPot`) + `:152-160` (somme des `lockedEntries[match.id].amount`) |
| **Erreur** | aucune — garde silencieuse ; seul un test peut la détecter |
| **Tests** | `server/match-engine.test.mjs:556` « should never pay more than the funds actually locked (anti-mint) » · `e2e/api/match.spec.ts:447` « Le règlement distribue la cagnotte verrouillée, pas la cagnotte nominale » |

### I3 — Le pot est **divisé** entre les gagnants, jamais dupliqué

| | |
|---|---|
| **Énoncé** | Le pot (moins la commission) est réparti entre les gagnants ; un 2v2 ne verse pas deux fois le pot. |
| **Code** | `server/match-engine.mjs:350` (`winnerIds`), `:355-358` (`winnerCount`, `sharePerWinner`, `firstWinnerShare` absorbe l'arrondi) |
| **Tests** | `server/match-engine.test.mjs:512` « should split the pot between winners in 2v2 (anti-mint) » (400 verrouillés → 392 distribués sur 2 gagnants) |

### I4 — Le perdant est débité, jamais remboursé

| | |
|---|---|
| **Énoncé** | Un perdant perd son pass : il n'est jamais remboursé après un match joué. |
| **Code** | `server/match-engine.mjs:399` (`settleMatchLossWallet`) ; `server/wallet-engine.mjs:304-332` ; transaction `match_loss` de montant `−reservation.amount` (`:325`) |
| **Tests** | `e2e/api/match.spec.ts:460` (le perdant : `cashBalance` inchangé, `lockedBalance` à 0) · `server/br-engine.test.mjs:774` « consomme le pass des absents (penalite, pas remboursement) » · `:405` « NE rembourse PAS apres le debut » |

### I5 — Un joueur listé deux fois n'est payé qu'une fois

| | |
|---|---|
| **Énoncé** | Un `userId` présent deux fois dans le roster (ou dans un classement) ne perçoit qu'une part. |
| **Code** | match : `server/match-engine.mjs:359` (`paidWinners`) + `:369` · ligue : `server/league-engine.mjs:569-572` (`seenUserIds`) + `:577-580` (`seenPlacements`) |
| **Erreur** | `INVALID_RESULTS` (ligue) |
| **Tests** | `server/league-podium-guards.test.mjs:57` « un meme joueur liste deux fois est refuse » · `:71` « deux joueurs a la meme place sont refuses » · **match : AUCUN TEST** (le cas `paidWinners` n'est pas exercé) |

### I6 — Pas de double règlement

| | |
|---|---|
| **Énoncé** | Un résultat ne peut être versé qu'une fois ; un règlement rejoué ne crédite rien. |
| **Code** | `payoutDistributed` : `server/match-engine.mjs:292-293`, `:979-981`, `:1040-1042` · clé d'idempotence des gains : `server/wallet-engine.mjs:365` + garde `server/persistence.mjs:1947-1956` |
| **Erreur** | `ALREADY_CONFIRMED` (`server/match-engine.mjs:1035`, `:1038`, `:1041`) |
| **Tests** | `server/settlement-idempotence.test.mjs:80` « un second versement identique ne credite RIEN » · `:94` « la seconde tentative ne laisse ni trace ni reservation fantome » · `:110` « un gain et une commission pour la MEME competition sont distincts » · `server/match-engine.test.mjs:427` « should reject if match already has a result » · `server/settlement-recovery.test.mjs:152` « un match deja solde n est pas rejoue » |

### I7 — La part bonus du gain ne devient jamais retirable

| | |
|---|---|
| **Énoncé** | La part d'un gain qui correspond à la mise bonus retourne en **bonus**, pas en cash retirable. |
| **Code** | `server/wallet-engine.mjs:384-386` : `bonusRestore = min(stakeBonus, safeAmount)`, `cashCredit = safeAmount − bonusRestore` |
| **Tests** | `server/wallet-engine.test.mjs:379` « should not launder pure-bonus stake into cash » (`:376` vérifie `metadata.bonusRestore === 3`) |

### I8 — La clé de réservation du gain est unique par (joueur, type, compétition)

| | |
|---|---|
| **Énoncé** | Un joueur ne peut percevoir qu'un gain d'un type donné pour une compétition donnée. |
| **Code** | `server/wallet-engine.mjs:365` (`` `${type}:${matchId}` ``) · source de vérité `wallet.winningsKeys` (`server/persistence.mjs:1947-1956`) |
| **Tests** | `server/settlement-idempotence.test.mjs:110`, `:123`, `:134` · `server/winnings-key-index.test.mjs:92` « un gain reste bloque au-dela de 200 transactions » · `:135` « la cle survit a un redemarrage AU-DELA de 200 transactions » |

### I9 — Un retrait ne peut ni dépasser le solde, ni le plafond, ni omettre la commission

| | |
|---|---|
| **Énoncé** | Retrait ≥ 150 ZC, solde cash suffisant, cumul 24 h ≤ 50 000 ZC, commission = 2 % du brut, le **net** part chez FedaPay. |
| **Code** | `server/wallet-engine.mjs:4` (150), `:146-148`, `:154-156`, `:158-164`, `:18-19` (50 000 / 24 h), `:34-48` (fenêtre glissante), `:55-59` (`calcWithdrawNet`), `:170` (débit du **brut**) |
| **Erreur** | `WITHDRAWAL_MIN`, `INSUFFICIENT_FUNDS`, `DAILY_WITHDRAWAL_LIMIT` |
| **Tests** | `server/wallet-engine.test.mjs:53`, `:66`, `:90` « should calculate fee correctly (2%) » · `server/withdrawal-daily-cap.test.mjs:62`, `:72`, `:82`, `:95`, `:110`, `:126` · `e2e/api/wallet.spec.ts:180`, `:192`, `:253`, `:298` |

### I10 — Un retrait « peut-être parti » ne déclenche ni second transfert ni remboursement automatique

| | |
|---|---|
| **Énoncé** | Si FedaPay a pu traiter le payout alors que la réponse s'est perdue, on ne rembourse pas automatiquement. |
| **Code** | `server/routes/wallet.mjs:290-313` (marquage `pending_review`) · `server/payment-engine.mjs:331-345` (`createdPayoutId` remonté) · `server/wallet-engine.mjs:478-565` (`reconcilePendingWithdrawals`) · file `wallet.payoutsEnAttente` `server/persistence.mjs:2017-2047` |
| **Tests** | `server/withdrawal-double-payout.test.mjs:123` « un retrait en attente de revue ne declenche AUCUN payout » · `server/withdrawal-reconciliation.test.mjs:67`, `:77`, `:87`, `:96` · `server/withdrawal-replay-outside-window.test.mjs:54`, `:74`, `:94`, `:114`, `:134` |

### I11 — Un dépôt FedaPay n'est crédité qu'une fois, et seulement à son titulaire

| | |
|---|---|
| **Énoncé** | La transaction doit appartenir au demandeur (marquage `ZOYD:<userId>`), et un identifiant déjà traité est refusé. |
| **Code** | `server/payment-engine.mjs:59-143` (claim atomique avant le crédit), `:31-41` (`isTransactionOwnedBy`), `:86-92` (anti-vol) |
| **Erreur** | `TRANSACTION_ALREADY_PROCESSED` |
| **Tests** | `server/payment-engine.test.mjs:72`, `:136` « should reject a transaction owned by another user (anti-theft) », `:150` « should REJECT a transaction matched only by phone suffix (collision theft) » · `server/feda-claim-idempotence.test.mjs:74`, `:90`, `:113`, `:118` |

### I12 — Les statistiques sont appliquées une seule fois par compétition

| | |
|---|---|
| **Énoncé** | Un règlement rejoué ne recompte ni victoires, ni ELO, ni XP, ni `totalEarnings`. |
| **Code** | `server/persistence.mjs:200-210` (`applyUserSettlementOnce`), `:181` + `:207` (plafond 500) |
| **Tests** | `server/settlement-stats-and-lock.test.mjs:82` « un second reglement de la meme competition ne touche pas les stats » · `:104` · `:119` · `:129` |

### I13 — Le pass verrouillé est le pot ; le pot affiché est la somme des verrous

| | |
|---|---|
| **Énoncé** | Le pot d'un match est `Σ lockedEntries[match.id].amount`, pas `entryFee × maxPlayers`. |
| **Code** | `server/match-engine.mjs:152-160` (source de vérité), `:526` (pot théorique, créé), `:309-311` (commentaire anti-mint) · BR : `server/br-engine.mjs:525-533` |
| **Tests** | `server/match-engine.test.mjs:365` « should base the projection on locked funds, not on prizePool » · `server/br-engine.test.mjs:476` « recalcule la cagnotte depuis les reservations wallet reelles » |

### I14 — Le pot de tournoi / de ligue est un produit, donc il exige un tarif à ≤ 2 décimales

| | |
|---|---|
| **Énoncé** | Au-delà de 2 décimales, le produit (pot annoncé) et la somme des arrondis (argent bloqué) divergent : le règlement crée ou détruit de la monnaie. |
| **Code** | `server/routes/match.mjs:74` et `server/routes/tournament.mjs:90` (`entryFee: roundAmount(body.entryFee)`) · `server/league-engine.mjs:1003` · `server/tournament-engine.mjs:25` (`getSquadLockAmount`) |
| **Tests** | `server/roundings-and-realtime-sanctions.test.mjs:39` « un tarif a plus de 2 decimales fait diverger pot et argent bloque » · `:56` · `:74` |

### I15 — Un seul verrou de pass par compétition

| | |
|---|---|
| **Énoncé** | Un joueur ne peut pas être débité deux fois pour la même compétition. |
| **Code** | `server/wallet-engine.mjs:197-199` (`ALREADY_LOCKED`) |
| **Tests** | `server/wallet-engine.test.mjs:462` « should reject double-lock on same matchId » |

### I16 — La cagnotte BR ne verse jamais plus que son pot, au centime près

| | |
|---|---|
| **Énoncé** | Les 5 parts payées + la commission = le pot réel ; le dernier bénéficiaire absorbe l'arrondi. |
| **Code** | `server/br-engine.mjs:903-947` (`computeBrPayouts`), `:920-921` (dernier bénéficiaire) · `:942` (commission sur le pot) |
| **Tests** | `server/br-engine.test.mjs:617` « repartit 100% de la cagnotte au centime pres » · `:633` · `:648` « verse la commission arbitre en plus des gains » · `:654` · `e2e/api/br.spec.ts:398` |

### I17 — La clé de réservation du gain de ligue est `season.id`

| | |
|---|---|
| **Énoncé** | La clé doit correspondre à celle du verrou (`lockEntryFee(..., seasonId)`), sinon le verrou n'est jamais libéré et la mise bonus est convertie en cash. |
| **Code** | `server/league-engine.mjs:675`, `:696`, `:716` (clé `season.id`) ; commentaire `server/league-engine.mjs:669-674` |
| **Tests** | **AUCUN TEST** (le risque est documenté dans le commentaire, pas exercé) |

### I18 — Le revenu de ZOYD est la commission de retrait, et rien d'autre

| | |
|---|---|
| **Énoncé** | `revenue` = frais de retrait encaissés. Les parts d'arbitre sont une **sortie** de trésorerie, hors revenu. |
| **Code** | `server/persistence.mjs:1495-1543` (`getCommissionStats`), `:1532` (`revenue: withdrawalTotal`), `:1536-1541` (commentaire « Volontairement HORS du revenu ») · `server/match-engine.mjs:541` (`zoydFee: 0`) |
| **Tests** | `e2e/api/wallet.spec.ts:322` « le revenu est la commission de retrait, PAS les parts d'arbitre » · `:298` |

### I19 — Un retrait n'est pas remboursé deux fois si le prestataire refuse

| | |
|---|---|
| **Énoncé** | En cas de refus définitif, le remboursement porte sur le **montant positif** (la transaction de retrait porte un montant négatif). |
| **Code** | `server/wallet-engine.mjs:531-550`, `:540` (`Math.abs`) ; commentaire `server/wallet-engine.mjs:533-539` |
| **Tests** | `server/withdrawal-reconciliation.test.mjs:77` « un payout rejete rembourse enfin le joueur » · `server/wallet-history.test.mjs:71` « le remboursement est un refund, pas un depot » |

### I20 — L'intégrité des portefeuilles est contrôlée

| | |
|---|---|
| **Énoncé** | Pas de mise bloquée sans réservation, pas de réservation sans mise bloquée, pas de solde négatif, pas de total affiché désynchronisé. |
| **Code** | `server/persistence.mjs:1063` (`verifyDataIntegrity`), appelé par `server/cron.mjs:172-194` (1 h) et au démarrage `server/realtime-server.mjs:621` |
| **Tests** | `server/data-integrity.test.mjs:222`, `:231`, `:239`, `:340`, `:344`, `:348`, `:358` |

---

## 2. Invariants de rôle

### R1 — Un joueur ne peut pas être joueur ET arbitre

| | |
|---|---|
| **Code** | match : `server/match-engine.mjs:654` (désignation) et `:601` (inscription) · tournoi : `server/tournament-engine.mjs:1193-1195` et `:788-790` · BR : `server/br-engine.mjs:308-311` (l'arbitre n'est pas dans `players`), `:728` (exclu du classement) |
| **Erreur** | `ROLE_CONFLICT` |
| **Tests** | `e2e/api/match.spec.ts:208` « 409 : un joueur ne peut pas arbitrer » · `server/tournament-engine.test.mjs:215` « should reject if player is arbiter » · `:386` |

### R2 — Un seul arbitre par match

| | |
|---|---|
| **Code** | `server/match-engine.mjs:653` — `match.arbiter` est un objet unique, premier arrivé premier servi |
| **Erreur** | `ARBITER_TAKEN` |
| **Tests** | **AUCUN TEST** identifiable pour le double `assign` |

### R3 — L'admin peut écrire un résultat mais pas déclencher le versement sans arbitre

| | |
|---|---|
| **Code** | écriture autorisée : `server/match-engine.mjs:872` (`!isArbiter && role !== 'admin'` → refus) · versement refusé : `server/match-engine.mjs:306-308` |
| **Erreur** | `ARBITER_REQUIRED` |
| **Tests** | `server/arbiter-required.test.mjs:103` |

> **Précision de séquence, importante.** La route admin « award »
> (`server/routes/admin.mjs:565-572`) soumet le résultat avec
> `deferSettlement: true`, ce qui **persiste** l'état (`:575`) **avant** de
> tenter le versement (`:578`). Si le match n'a pas d'arbitre, le versement
> échoue en `ARBITER_REQUIRED` (capturé en `:590`) mais **le résultat reste
> écrit** : le match est en `awaiting_confirmation` avec
> `payoutDistributed: 'pending'` et une `confirmationDeadline`. Conséquence
> mesurable : voir **V6** dans `docs/05-invariants.md`.

### R4 — Le lancement d'un tournoi exige que tous les slots d'arbitre soient couverts

| | |
|---|---|
| **Code** | `server/tournament-engine.mjs:1240-1242` · nombre de slots : `:21` (`getArbitersNeeded`) |
| **Erreur** | `MATCH_NOT_READY` |
| **Tests** | `server/tournament-engine.test.mjs:348` « should reject if arbiters not assigned » |

### R5 — Un arbitre de tournoi n'agit que sur les duels de son slot

| | |
|---|---|
| **Code** | `server/tournament-engine.mjs:1268-1271` · affectation : `:306-307` (`arbiterSlot = (index % arbitersNeeded) + 1`) |
| **Erreur** | `FORBIDDEN` |
| **Tests** | **AUCUN TEST** identifiable sur le périmètre de slot |

### R6 — Seul l'arbitre du salon BR élimine et règle

| | |
|---|---|
| **Code** | `server/br-engine.mjs:547-560` (`requireLobbyArbiter`), `:584`, `:714` · lancement : `:483-490` (arbitre **ou** créateur) |
| **Erreur** | `ARBITER_REQUIRED`, `FORBIDDEN` |
| **Tests** | `server/br-engine.test.mjs:199` « refuse une elimination saisie par un joueur inscrit (pas l'arbitre) » · `:205` · `:211` « refuse toute saisie si le salon n'a pas d'arbitre designe » · `:224` · `e2e/api/br.spec.ts:172`, `:190` |

### R7 — L'arbitre BR est un admin désigné à la création, et n'est pas joueur

| | |
|---|---|
| **Code** | `server/br-engine.mjs:281-290` (désignation), `:308-311` (pas de pass, pas dans `players`) |
| **Erreur** | `INVALID_ARBITER` |
| **Tests** | `server/br-engine.test.mjs:161` « designe le createur comme arbitre par defaut » · `:166` « refuse un arbitre inexistant ou non-admin » · `e2e/api/br.spec.ts:70`, `:153`, `:163` |

### R8 — En ligue, seul l'admin pilote — et il n'y a ni arbitre, ni fenêtre de confirmation

| | |
|---|---|
| **Code** | `server/league-engine.mjs:233`, `:364`, `:409`, `:442`, `:517`, `:550`, `:971`, `:1031`, `:1070` |
| **Erreur** | `FORBIDDEN` |
| **Tests** | `server/league-podium-guards.test.mjs:112-144` (gardes de statut du remboursement admin) |

### R9 — Le rôle réel de l'acteur fait foi, jamais un champ du client

| | |
|---|---|
| **Énoncé** | `submittedBy` vient du JSON client ; s'y fier permettrait de sauter les gardes et les preuves. |
| **Code** | `server/match-engine.mjs:880-884` (`isAdminOverride = actorUser.role === 'admin'`, le rôle vient du compte) |
| **Tests** | `server/match-engine.test.mjs:472` « should reject a forged admin-dashboard submittedBy from a player (anti-mint) » |

### R10 — Le capitaine de squad utilise son propre pseudo

| | |
|---|---|
| **Code** | `server/tournament-engine.mjs:802-804` |
| **Erreur** | `INVALID_REGISTRATION` |

### R11 — Un coéquipier doit exister en base (par `userId` ou pseudo exact)

| | |
|---|---|
| **Énoncé** | Une identité injectée dans le bracket enverrait les gains vers un compte fantôme. |
| **Code** | `server/tournament-engine.mjs:815-824` |
| **Erreur** | `INVALID_REGISTRATION` |

### R12 — Le classement final de ligue ne peut pas sur-distribuer le podium

| | |
|---|---|
| **Code** | `server/league-engine.mjs:569-594` (unicité des joueurs, des places, et **tous** les finalistes classés) |
| **Erreur** | `INVALID_RESULTS` |
| **Tests** | `server/league-podium-guards.test.mjs:57`, `:71`, `:83`, `:95` |

### R13 — Les opérations financières et de modération exigent la 2FA admin

| | |
|---|---|
| **Code** | `server/admin-totp.mjs:144-172` (`requireAdmin2fa`) · fenêtre de vérification 5 min : `server/persistence.mjs:3164` |
| **Erreur** | `2FA_REQUIRED`, `MFA_INVALID` |
| **Tests** | `server/admin-totp-guard.test.mjs:103`, `:111`, `:118`, `:126` · `e2e/api/wallet.spec.ts:88` |

---

## 3. Invariants d'état et de cohérence

### E1 — `winnerTeam` ∈ {0, 1}, strictement

| | |
|---|---|
| **Code** | `server/match-engine.mjs:876-878` · ordre des gardes : `:861-871` (le litige passe **avant**, l'ordre est volontaire) |
| **Erreur** | `INVALID_RESULTS` |
| **Tests** | `server/match-engine.test.mjs:618` « should reject an invalid winnerTeam » · `e2e/api/match.spec.ts:345` |

### E2 — Pas de résultat sur un match clôturé

| | |
|---|---|
| **Code** | `server/match-engine.mjs:854-856` (`cancelled`, `forfeited`, `archived`) |
| **Erreur** | `MATCH_CLOSED` |

### E3 — Un litige actif bloque la soumission, la reprise et l'expiration

| | |
|---|---|
| **Code** | `server/match-engine.mjs:858-860`, `:988-992`, `:1094-1095` |
| **Erreur** | `DISPUTE_ALREADY_OPEN` |
| **Tests** | `server/match-engine.test.mjs:642` « should block settlement while a dispute is open » · `:755` · `:789` · `server/settlement-recovery.test.mjs:125` · `e2e/api/match.spec.ts:530`, `:546` |

### E4 — Les preuves sont obligatoires (scoreboard + écran final), sauf forfait ou admin

| | |
|---|---|
| **Code** | `server/match-engine.mjs:907-918` |
| **Erreur** | `PROOFS_REQUIRED` |
| **Tests** | `e2e/api/match.spec.ts:334` « 400 sans scoreboard ni écran final » |

### E5 — Les preuves sont anti-XSS et bornées (≤ 2 000 caractères, ≤ 10 références)

| | |
|---|---|
| **Code** | `server/match-engine.mjs:119-132` (`isSafeProofRef`, `normalizeProofRefs`) |
| **Tests** | **AUCUN TEST** identifiable |

### E6 — La salle ne peut être publiée que ≤ 10 min avant l'heure

| | |
|---|---|
| **Code** | `server/match-engine.mjs:781-784` |
| **Erreur** | `ROOM_TOO_EARLY` |
| **Tests** | `e2e/api/match.spec.ts:278`, `:288` |

### E7 — Un salon BR se programme entre 24 h et 48 h à l'avance

| | |
|---|---|
| **Code** | `server/br-engine.mjs:254-266` · fenêtre : `:89-90` |
| **Erreur** | `INVALID_DATE` |
| **Tests** | `server/br-engine.test.mjs:141`, `:146`, `:151` · `e2e/api/br.spec.ts:130` |

### E8 — La répartition BR somme à 100 %, arbitre ≤ 5 %, parts décroissantes

| | |
|---|---|
| **Code** | `server/br-engine.mjs:185-218` · plafond : `:86` |
| **Erreur** | `INVALID_PAYOUT` |
| **Tests** | `server/br-engine.test.mjs:74`, `:78`, `:85`, `:91`, `:97`, `:103` · `e2e/api/br.spec.ts:112`, `:121` |

### E9 — Un salon BR ne se rembourse qu'avant le lancement (ou si personne n'a joué)

| | |
|---|---|
| **Code** | `server/br-engine.mjs:418-423` (désinscription tardive refusée), `:729-761` (remboursement si `contenders.length === 0`) |
| **Erreur** | `LOBBY_CLOSED` |
| **Tests** | `server/br-engine.test.mjs:396`, `:405`, `:792` · `e2e/api/br.spec.ts:315` |

### E10 — Le format de match/tournoi est 1VS1 → 5VS5, N=N

| | |
|---|---|
| **Code** | `server/match-engine.mjs:515-519` · `server/tournament-engine.mjs:730-734` |
| **Erreur** | `INVALID_MATCH`, `INVALID_FORMAT` |
| **Tests** | `e2e/api/match.spec.ts:75`, `:87` |

### E11 — Le code TOTP ne vit que 30 s

| | |
|---|---|
| **Code** | `server/admin-totp.mjs:13` (`TOTP_PERIOD = 30`), `:64` (`TOTP_WINDOW_STEPS = 0`) |
| **Tests** | `server/admin-totp.test.mjs:66` « TOTP_WINDOW_STEPS vaut 0 : un code ne vit que 30 s » · `:73` · `:82` · `:91` · `:97` |

### E12 — L'identité d'un joueur est gelée à partir de `awaiting_confirmation`

| | |
|---|---|
| **Énoncé** | Un joueur ne peut pas renommer après une défaite pour la faire disparaître, ni après une victoire pour la revendiquer. |
| **Code** | `server/state-helpers.mjs:95-104` (`LIVE_IDENTITY_STATUSES`), `:134` |
| **Tests** | `server/state-helpers.test.mjs:52` « retire confirmedByTeams du resultat diffuse » · `:88` |

### E13 — Aucun `userId` ne fuit dans les payloads publics

| | |
|---|---|
| **Code** | `server/state-helpers.mjs:133` (match), `:277-286` (BR) |
| **Tests** | `server/state-helpers.test.mjs:34`, `:147`, `:162`, `:177` · `e2e/api/br.spec.ts:51`, `:231` |

### E14 — Le règlement se fait en deux phases : écriture AVANT versement

| | |
|---|---|
| **Énoncé** | Le résultat est persisté avec `payoutDistributed: 'pending'`, puis le versement a lieu. L'inverse créait des gains sans trace. |
| **Code** | `server/routes/match.mjs:268-278` · `server/routes/admin.mjs:565-579` · `server/match-engine.mjs:940-954` |
| **Tests** | `e2e/api/match.spec.ts:360` « 200 : mise en attente de confirmation, RIEN n'est versé » · `server/settlement-recovery.test.mjs:103` « la reprise est rejouee par le cron : elle selectionne bien 'pending' » |

---

## 4. Invariants de concurrence et de persistance

### C1 — Un seul mutex par compétition et par joueur

| | |
|---|---|
| **Code** | `server/mutex.mjs:17` (match), `:26` (tournoi), `:35` (ligue), `:88` (salon BR), `:101` (wallet), `:114` (user), `:127` (canal) |
| **Tests** | `server/mutex.test.mjs:12`, `:25`, `:36` · `server/settlement-idempotence.test.mjs:149`, `:172`, `:195` |

### C2 — Un snapshot d'état est relu DANS le verrou

| | |
|---|---|
| **Énoncé** | Relire avant de prendre le verrou fait lire la même version par deux requêtes ; la dernière écriture écrase la première. |
| **Code** | `server/routes/br.mjs:137-139` (commentaire `server/routes/br.mjs:126-136`) |
| **Tests** | **AUCUN TEST** de route équivalent pour `match` / `tournoi` / `ligue` |

### C3 — Le serveur refuse de démarrer en multi-processus

| | |
|---|---|
| **Code** | `server/single-process-guard.mjs:106-121` |
| **Tests** | `server/single-process-guard.test.mjs:38`, `:45`, `:52`, `:66`, `:75`, `:91` |

### C4 — Toute écriture de `app_users` fait avancer `revision`

| | |
|---|---|
| **Code** | `server/persistence.mjs:525-570` (`ecrireUserRow`, point d'entrée unique) |
| **Tests** | `server/occ-revision-invariant.test.mjs:29` « aucune ecriture app_users hors du point d entree centralise » · `:48` |

### C5 — Une écriture conditionnelle ne s'applique que si la révision n'a pas bougé

| | |
|---|---|
| **Code** | `server/persistence.mjs:492-506` (CAS) · `:556-568` (rejeu sur état frais, 4 tentatives max `:419`) |
| **Tests** | `server/write-window-race.test.mjs:145` · `server/stale-base-write.test.mjs:119`, `:162` |

### C6 — Une ligne supprimée n'est jamais recréée

| | |
|---|---|
| **Code** | `server/persistence.mjs:537-552` |
| **Tests** | `server/account-deletion-race.test.mjs:126`, `:145` |

### C7 — Le solde en mémoire est toujours aligné sur la base

| | |
|---|---|
| **Code** | `server/persistence.mjs:1619-1635` (adoption du payload frais) |
| **Tests** | `server/stale-base-write.test.mjs:119` · `server/password-conflict.test.mjs:158`, `:192` |

---

## 5. INVARIANTS VIOLÉS OU NON COUVERTS

> **C'est le cœur du document.** Chaque point a été revérifié dans le code,
> pas recopié. Gravité = impact sur l'argent du joueur et sur la promesse du
> produit, pas sur la propreté du code.

### Résumé

| # | Constat | Le rapport antérieur avait raison ? | Gravité |
|---|---|---|---|
| V1 | `sweepMatchesWithoutArbiter` n'est appelé par aucun cron, aucune route, aucun serveur | **OUI** — **CORRIGÉ** | ÉLEVÉE → résolu |
| V2 | `pendingArbiterFee` est écrit mais jamais relu | **OUI** | MOYENNE |
| V3 | `awaiting_arbiter` ∉ `ACTIVE_STATUSES` | **OUI**, avec une nuance | MOYENNE |
| V4 | `archived` ∈ `MATCH_ETATS_CLOS` mais ∉ `TERMINAL_STATUSES` | **OUI** | MOYENNE |
| V5 | `getProjectedPayouts.perWinner` divise par le nombre total de joueurs | **OUI** sur le fond, **NON** sur l'impact | FAIBLE (latent) |
| V6 | Une exception de règlement tue tout le balayage d'expiration des confirmations | **NOUVEAU** | ÉLEVÉE → résolu |
| V7 | BR : le pass est verrouillé avant le contrôle `TEAM_FULL` → verrou orphelin | **NOUVEAU** | ÉLEVÉE → résolu |
| V8 | Le front additionne le total de l'équipe gagnante aux gains d'un joueur | **NOUVEAU** | MOYENNE |
| V9 | La migration de la colonne `revision` n'est dans aucun fichier SQL du dépôt | **NOUVEAU** | ÉLEVÉE (si non appliquée) |
| V10 | BR : aucun cron de reprise d'un règlement interrompu | **NOUVEAU** | MOYENNE |
| V11 | `arbiterPayouts` utilise le `arbiterFee` figé sur le pot théorique | **NOUVEAU** | FAIBLE |
| V12 | `LEAGUE_PLAYERS_PER_DAY` est une constante morte | **NOUVEAU** | FAIBLE |
| V13 | `getMatchActivityForUser` est du code mort | — | INFO |
| V14 | Ternaire mort dans `getStatusFromMatch` | — | INFO |
| V15 | `isInstantNoArbiter` est inatteignable | — | INFO |

---

### V1 — `sweepMatchesWithoutArbiter` n'est branché nulle part — **CORRIGÉ**
**Gravité : ÉLEVÉE → résolu**

> **Statut : corrigé.** Le balayage est désormais branché sur le tick
> d'automatisation de 30 s, et le **chemin complet** est couvert par un test
> (`server/arbiter-sweep-wiring.test.mjs`) qui échoue si le branchement est
> supprimé. La description ci-dessous est conservée telle quelle : elle
> documente l'état *avant* le correctif, et la méthode employée.

**Constat.** La fonction existe, elle est documentée, elle est testée — et elle
n'est jamais exécutée. Les délais d'arbitrage de 2 h ne sont donc jamais
appliqués en production.

**Vérification (recherche exhaustive sur tout le dépôt).** Occurrences
**complètes** de `sweepMatchesWithoutArbiter` :

| Emplacement | Nature |
|---|---|
| `server/match-engine.mjs:32` | définition (`export const`) |
| `server/match-engine.mjs:305` | commentaire (« voir `sweepMatchesWithoutArbiter` ») |
| `server/arbiter-sweep.test.mjs:21, 41, 52, 62, 76, 85, 101` | tests |

Aucun autre. Vérifié en particulier :

- `server/cron.mjs:19` n'importe de `match-engine.mjs` que
  `settlePendingMatchResult` et `expireConfirmationsOnServer` — les 12 balayages
  du cron (`server/cron.mjs:36`, `:85`, `:151`, `:200`, `:247`, `:285`, `:320`,
  `:365`, `:396`, `:429`, `:472`, `:511`) ne l'appellent pas.
- `server/realtime-server.mjs:140` n'importe que `processMatchAutomationOnServer`,
  appelé en `:647`.
- `server/routes/*.mjs` : aucune occurrence.
- `scripts/` : trois fichiers (`generate-og.cjs`, `wipe-test-data.sql`,
  `cleanup-live-e2e.sql`), aucun lien avec le moteur.

**Conclusion : CONFIRMÉ.** Le rapport antérieur avait raison.

**Le correctif.** Le balayage a été enchaîné à l'automatisation dans une
fonction unique, `runMatchAutomationOnServer` (`server/match-engine.mjs`),
appelée par le tick de 30 s de `server/realtime-server.mjs` :

- **L'ordre est délibéré.** Le balayage s'applique sur le **résultat** de
  l'automatisation. Un match que celle-ci vient d'annuler est déjà en
  `cancelled` quand le balayage le voit — et il l'ignore. Aucun double
  remboursement n'est possible, y compris après un échec partiel : le
  balayage ne clôture pas un match dont un joueur n'a pas été remboursé
  (`server/match-engine.mjs`, le `if (echecs.length > 0) continue;`).
- **L'idempotence est structurelle.** `refundLockedEntry` est idempotent : sans
  réservation, elle ne crédite rien (`server/wallet-engine.mjs:313-315`).
- **Le balayage ne peut pas casser l'automatisation.** Il est enveloppé dans un
  `try/catch` : une donnée corrompue sur un match ne gèle pas les autres.
- **La trace est visible.** Un remboursement par le balayage produit un log
  `warn` avec la liste des matchs et la raison (`NO_ARBITER` /
  `ARBITER_TIMEOUT`). C'est un mouvement d'argent : il doit se voir dans les
  logs, pas seulement dans la base.

**La preuve du branchement.** `server/arbiter-sweep-wiring.test.mjs` ne teste
plus la fonction : il teste le **tick complet**. Il vérifie explicitement que
l'automatisation *seule* ne touche pas un match sans arbitre ni horaire — ce
qui prouve que c'est le balayage qui agit, et non un effet de bord. Balayage
débranché, la suite tombe à **2 échecs sur 6**.

**Conséquence à connaître.** Brancher le balayage **active un délai de 2 h qui
était inerte**. En production, un match lancé depuis plus de 2 h sans résultat,
ou un match sans arbitre depuis plus de 2 h, sera désormais annulé et
remboursé automatiquement. C'est le comportement voulu depuis le début — mais
il n'avait jamais été exercé. Il faut le savoir avant de pousser.

**Impact utilisateur concret (avant le correctif).** Le seul mécanisme actif était
`processMatchAutomationOnServer` (tick 30 s, `server/realtime-server.mjs:640-657`),
qui ne compare qu'à `scheduledAt` (`:1376`) et à `expiresAt` (`:1366`, 14 j).

1. **Match sans `scheduledAt`** (le cas le plus courant : un match créé et
   rejoint, jamais programmé) : aucune branche de l'automation ne s'applique
   (`:1377` exige un `scheduledAt`). Le match reste `recruiting` /
   `awaiting_arbiter` / `check_in` et **le passe reste bloqué jusqu'à
   `expiresAt`, soit 14 jours** — au lieu des 2 h promises. Le joueur ne peut
   ni récupérer son argent, ni rejouer (`lockEntryFee` renverrait
   `ALREADY_LOCKED`, `server/wallet-engine.mjs:197-199`).
2. **Match lancé, arbitre en poste, jamais de résultat** (phase B) : le
   `scheduledAt` est déjà passé, donc `:1377` laisse passer ; `match.arbiter`
   existe donc `:1381` laisse passer ; si les deux équipes sont prêtes, la
   branche `:1393-1397` fait `autoReadyCheckedInPlayers` et `continue` — le
   match reste `in_progress` **et sa cagnotte gelée** jusqu'à `expiresAt`.
   C'est exactement le cas que la phase B (2 h) devait couvrir.

**Ce que dit le code lui-même.** L'en-tête `server/match-engine.mjs:8-14`
justifie les deux phases ; le commentaire `server/match-engine.mjs:304-305` renvoie
explicitement vers le sweep pour dire qu'« en l'absence d'arbitre, le match doit
être REMBOURSE, pas bloqué ». Ce renvoi ne mène nulle part.

---

### V2 — `pendingArbiterFee` est écrit mais jamais relu
**Gravité : MOYENNE**

**Constat.** Quand le versement de la commission d'arbitre échoue, une créance
est inscribed sur le match. Aucun cron, aucune route, aucun moteur ne la relit.

**Vérification.** Occurrences **complètes** de `pendingArbiterFee` :

| Emplacement | Nature |
|---|---|
| `server/match-engine.mjs:433` | écriture (`match.pendingArbiterFee = roundAmount(arbiterFee)`) |
| `server/match-engine.mjs:437` | suppression (`delete match.pendingArbiterFee` si la commission aboutit) |
| `docs/audit/10-lecture-exhaustive.md:210` | mention documentaire |

Aucune lecture. Le champ n'est lu nulle part.

**Conclusion : CONFIRMÉ.**

**Impact utilisateur concret.** La commission d'arbitre en échec est une
**créance définitivement perdue**. Contraste :

| Écosystème | Dette | Reprise |
|---|---|---|
| Gains de tournoi | `tournament.pendingPayouts` (`server/tournament-engine.mjs:708-714`) | cron `server/cron.mjs:365-388` (6 h) |
| Gains de ligue | `season.pendingPayouts` (`server/league-engine.mjs:757-760`) | cron `server/cron.mjs:396-419` (6 h) |
| **Commission d'arbitre (match)** | `match.pendingArbiterFee` | **aucune** |

Deux détails qui aggravent le constat :

1. La créance n'est écrite que si `!settlementErrors.length && arbiterErrors.length`
   (`server/match-engine.mjs:432-434`) — donc uniquement quand le match est
   par ailleurs correctement soldé. La dette est « propre », mais invisible.
2. Le `payoutDistributed` du match reste `true` dans ce cas : `success` ne
   dépend que de `settlementErrors` (`server/match-engine.mjs:484`). Donc ni le
   cron de reprise des règlements — qui ne sélectionne que `'pending'`
   (`server/cron.mjs:257`) — ni le cron d'expiration — qui exige
   `status === 'awaiting_confirmation'` (`server/match-engine.mjs:1090`) — ne
   la verront jamais.

---

### V3 — `awaiting_arbiter` n'est pas dans `ACTIVE_STATUSES`
**Gravité : MOYENNE (visibilité)**

**Constat.** `awaiting_arbiter` est un statut vivant, mais il n'appartient à
aucune des deux listes qui classent les matchs d'un joueur.

**Vérification.**

| Élément | Emplacement |
|---|---|
| Liste `ACTIVE_STATUSES` | `server/match-engine.mjs:102` — `recruiting, full, check_in, ready, in_progress, awaiting_confirmation` |
| Dérivation du statut | `server/match-engine.mjs:223` |
| **Écriture en base** | `server/match-engine.mjs:245` (`updateMatchSnapshot` → `status: getStatusFromMatch(next)`) |
| Copie de la liste côté front | `src/app/stores/matchStore.ts:239` |
| Preuve que c'est persisté | `e2e/api/match.spec.ts:203` — `expect(res.body.match.status).toBe('awaiting_arbiter')` |

**Conclusion : CONFIRMÉ**, avec une **nuance que le rapport antérieur a
manquée**. Le rapport qualifiait `awaiting_arbiter` de « statut dérivé
vivant » et d'« état dérivé, jamais écrit tel quel ». C'est **faux** : le
snapshot réécrit `match.status` avec la valeur dérivée
(`server/match-engine.mjs:245`), et le test E2E le prouve. La distinction
utile n'est pas « écrit / dérivé » mais « écrit explicitement / réécrit par le
snapshot ».

**Impact utilisateur concret.** Le match **disparaît des deux listes** du
joueur :

- « actifs » = `ACTIVE_STATUSES` (`server/match-engine.mjs:1444`)
- « historique » = `['finished','cancelled','forfeited','disputed']`
  (`server/match-engine.mjs:1449`)

`awaiting_arbiter` n'est dans aucune. Le front reproduit exactement la même
logique (`src/app/stores/matchStore.ts:505-517`). Un joueur dont le match est
complet mais sans arbitre **ne voit plus son match** dans « mes matchs » — et
comme il ne voit pas non plus l'invite à postuler comme arbitre, il n'a aucun
moyen de remédier à la situation.

**Précision de localisation.** `getMatchActivityForUser`
(`server/match-engine.mjs:1441`) est lui-même du **code mort** : aucune
occurrence ailleurs dans le dépôt. Le comportement observable vient donc de
`src/app/stores/matchStore.ts`, pas du serveur. Le bug est réel, mais il vit
dans le front — ce que le rapport ne précisait pas.

---

### V4 — `archived` ∈ `MATCH_ETATS_CLOS` mais ∉ `TERMINAL_STATUSES`
**Gravité : MOYENNE**

**Vérification.**

| Liste | Ligne | Contenu |
|---|---|---|
| `MATCH_ETATS_CLOS` | `server/match-engine.mjs:18` | `cancelled, forfeited, archived, finished` |
| `TERMINAL_STATUSES` | `server/match-engine.mjs:103` | `finished, cancelled, forfeited` |

Écriture de `archived` : `server/cron.mjs:63` (archivage après 14 j
d'inactivité, statut `['recruiting','full','check_in']`, `server/cron.mjs:56`).

**Conclusion : CONFIRMÉ.**

**Impact utilisateur concret — trois conséquences mesurables.**

1. **Réclassification d'état.** `getStatusFromMatch` renvoie le statut tel quel
   seulement s'il est terminal (`server/match-engine.mjs:202-204`). Un match
   archivé **sans** `result` ni `finishedAt` et au roster complet est donc
   reclassé `awaiting_arbiter` (`:223`) ou `recruiting` (`:211`). Le front peut
   afficher « en attente d'un arbitre » pour un match archivé.
2. **Un match archivé reste inscriptible.** `joinMatchOnServer` (`:599`) ne
   rejette que `TERMINAL_STATUSES` ; `archived` n'y est pas. Un nouveau joueur
   peut donc **verrouiller un pass sur un match archivé** — et ce match ne
   pourra jamais être soldé, puisque `submitMatchResultOnServer` refuse
   `archived` (`:854-856`).
3. **Les matchs archivés sortent de l'historique.** `archived` n'est ni dans
   `server/match-engine.mjs:1449` ni dans `src/app/stores/matchStore.ts:515`.

**Atténuation.** `processMatchAutomationOnServer` rattrape un match archivé via
`expiresAt` (`:1366-1374`) → remboursement. L'argent n'est pas perdu
définitivement, mais il peut rester bloqué plusieurs jours.

---

### V5 — `getProjectedPayouts.perWinner` divise par le nombre total de joueurs
**Gravité : FAIBLE en l'état, latente**

**Vérification.**

| Lieu | Calcul |
|---|---|
| Projection | `server/match-engine.mjs:178-180` — `perWinner: winner / match.players.length` |
| Règlement | `server/match-engine.mjs:355-356` — `payout / winnerCount` (`winnerCount` = nombre de **gagnants**) |

**Conclusion : CONFIRMÉ sur le fond, INFIRMÉ sur l'impact annoncé.**

Le rapport antérieur concluait : « L'UI affiche une part par joueur inférieure
à la part réellement versée. L'UI ne peut donc pas reconstruire le paiement à
partir de `projectedPayouts`. » La première phrase est **inexacte en l'état
du code** :

- Le champ fautif est bien calculé et **diffusé à tous les clients**
  (`server/state-helpers.mjs:149`), mais **aucun composant du front ne le lit** :
  `src/lib/matchPayout.ts:52-56` (`getWinnerPayoutPerPlayer`) est le seul
  consommateur et il n'est appelé nulle part ; `src/app/stores/matchStore.ts:163`
  ne porte que la déclaration de type.
- Ce que l'UI affiche effectivement est `projectedPayouts.winner` — le **total
  de l'équipe gagnante** — qui est correct : `src/app/components/admin/AdminUrgencyTab.tsx:93-94`
  et `src/features/match/pages/MatchDetailPage.tsx:735`.

**Impact utilisateur concret : nul aujourd'hui.** Risque latent : le champ est
faux, il est envoyé à tous les clients, et le premier écran qui l'affichera
affichera un montant faux.

**Le test qui « couvre » ce point fige le bug.** `server/match-engine.test.mjs:389-402`
s'intitule « should split the winner pot across the players of the winning
team » mais asserte `expect(projection.perWinner).toBe(490)` pour 4 joueurs et
1 960 ZC — soit 1 960 / 4. Le règlement réel verse 980 par gagnant (1 960 / 2).
Un test vert ne prouve donc **rien** ici : il certifie le comportement faux.
C'est un cas d'école de la règle « un test qui reste vert après avoir cassé le
code ne prouve rien » (`docs/00-INDEX.md` §6).

**Correction à faire.** `perWinner` doit diviser par le nombre de joueurs de
l'équipe gagnante. Attention : la projection est calculée pour un match **non
soldé** (`server/state-helpers.mjs:149` s'exécute à chaque broadcast), donc
`winnerTeam` n'existe pas encore — il faut soit la taille d'équipe
(`teamSize`), soit passer le vainqueur en paramètre.

---

### V6 — Une exception de règlement tue tout le balayage d'expiration des confirmations — **CORRIGÉ**
**Gravité : ÉLEVÉE → résolu** — *constat nouveau, absent du rapport*

> **Statut : corrigé.** L'appel est désormais isolé par un `try/catch` dans la
> boucle, et les échecs sont **signalés** (`failed` dans la valeur de retour,
> log `error` côté moteur et côté cron) au lieu d'être avalés. Un match qui ne
> peut pas être réglé ne bloque plus les autres — et ne disparaît plus dans le
> silence. Le raisonnement ci-dessous est conservé tel quel : il documente
> l'état *avant* le correctif.

**Constat.** `expireConfirmationsOnServer` appelle `applyResultSettlement`
**sans** `try/catch`. Un seul match sans arbitre dans la collection fait
échouer le balayage **entier**, et donc le règlement de tous les autres matchs
en attente de confirmation.

**Vérification.**

| Étape | Emplacement |
|---|---|
| Appel non protégé | `server/match-engine.mjs:1097` (dans la boucle `:1089-1106`, aucun `try/catch`) |
| Source de l'exception | `server/match-engine.mjs:306-308` — `ARBITER_REQUIRED` si `!match.arbiter?.userId` |
| Appel du cron, hors de toute boucle de protection | `server/cron.mjs:297` |
| Conséquence | `server/cron.mjs:299` (`replaceStateCollection`) **n'est jamais atteint** ; l'erreur est avalée par le `catch` de `server/cron.mjs:306` |

**Comment un match en `awaiting_confirmation` sans arbitre existe-t-il ?**
La route admin « award » soumet le résultat avec `deferSettlement: true`
(`server/routes/admin.mjs:565-572`), **persiste** l'état (`:575`), puis appelle
`settlePendingMatchResult` (`:578`), qui lève `ARBITER_REQUIRED` — capturé en
`:590`. Le match reste donc en `awaiting_confirmation` avec
`payoutDistributed: 'pending'` et une `confirmationDeadline`.

- Le cron de reprise des règlements **ne le reprendra pas** : il exige
  `!m.confirmationDeadline` (`server/cron.mjs:257`).
- Le cron d'expiration **si**, 30 minutes plus tard — et il casse.

**Impact utilisateur concret.** La cagnotte de **tous les autres matchs** en
attente de confirmation, dans la même collection, reste gelée. Le gel est
**permanent** : le match fautif reste dans la collection et fait échouer
chaque tick. Symptôme visible : une ligne « Erreur expiration des confirmations »
toutes les 60 s dans les logs, et des joueurs dont les gains ne partent
jamais — sur des matchs parfaitement légitimes.

**Correctif.** Encadrer l'appel `applyResultSettlement` dans la boucle par un
`try/catch` qui **continue** au lieu de propager.

**Le correctif appliqué, et un détail qui rend le précédent évitable.**

L'isolation, seule, aurait laissé un problème : le match fautif reste en
`awaiting_confirmation`, et le balayage le retente — et le rejette — toutes
les 60 s, en boucle. Un `log.error` toutes les 60 s est mieux qu'un gel
silencieux, mais c'est du bruit.

La bonne réponse est celle que **le code disait déjà** : le commentaire de la
garde de règlement dans `applyResultSettlement` (« En l'absence d'arbitre, le
match doit être REMBOURSE, pas bloque : voir `sweepMatchesWithoutArbiter` »)
et le fait que le balayage d'arbitrage (V1, désormais branché) rembourse
précisément les matchs sans arbitre. Les deux mécanismes se complètent :
l'expiration des confirmations libère les matchs **réglables**, le balayage
d'arbitrage rembourse les matchs **non réglables**. Aucun des deux ne gèle plus
l'autre.

Le correctif fait donc deux choses :

1. **Isolation** — `try/catch` par match dans la boucle : un échec est
   enregistré dans `failed`, journalisé en `error`, et la boucle **continue**.
2. **Visibilité** — `expireConfirmationsOnServer` retourne désormais
   `{ matches, settled, failed }`, et le cron journalise les échecs. Avant,
   l'erreur était avalée par le `catch` du cron : une cagnotte gelée
   n'apparaissait nulle part.

**La preuve.** `server/match-engine.test.mjs` — un match sans arbitre dont le
règlement est refusé est placé **en premier** dans la collection, suivi d'un
match sain. Le test vérifie que le match sain **est** réglé. C'est
l'assertion qui distingue le correctif de l'ancien code : elle échouait
avant. Mutation vérifiée : en propagant l'exception à la place du `continue`,
la suite tombe à **2 échecs sur 57**.

**Pourquoi ce défaut n'existait pas ailleurs.** Le job frère
`sweepPendingSettlements` (`server/cron.mjs:294-300`) avait déjà le `try/catch`
par match. L'auteur connaissait le motif — il l'avait écrit 20 lignes plus
haut. `expireConfirmationsOnServer` était le seul à ne pas l'avoir.

---

### V7 — BR : le pass est verrouillé avant le contrôle `TEAM_FULL` — **CORRIGÉ**
**Gravité : ÉLEVÉE → résolu** — *constat nouveau, absent du rapport*

> **Statut : corrigé.** Le verrou est désormais posé **après** toutes les
> validations, et un filet de sécurité rembourse le pass si une écriture
> postérieure échoue. Le raisonnement ci-dessous est conservé tel quel : il
> documente l'état *avant* le correctif.

**Constat.** Dans `joinBrLobbyOnServer`, `lockEntryFee` est appelé **avant** la
vérification de complétude d'équipe. Si l'équipe est pleine, l'exception est
levée **après** le débit.

**Vérification.**

| Étape | Emplacement |
|---|---|
| Verrou du pass | `server/br-engine.mjs:356-358` |
| Contrôle d'équipe (après) | `server/br-engine.mjs:375-377` → `TEAM_FULL` |
| Aucun rembobinage | `server/routes/br.mjs:138-195` — l'exception remonte au `respondMappedError` ; rien n'est annulé |

**Impact utilisateur concret.** Un joueur dont l'équipe est complète voit son
pass **débité et bloqué** alors que son inscription a échoué. Pire : il n'est
pas dans `lobby.players`, donc

- la désinscription ne le rattrape pas (`server/br-engine.mjs:415-416` →
  `NOT_JOINED`) ;
- le règlement ne le rattrape pas (`:854`, `:860` : on ne boucle que sur
  `lobby.players`) ;
- `lockEntryFee` renverra `ALREADY_LOCKED` au même `lobby.id`
  (`server/wallet-engine.mjs:197-199`) : **il ne peut plus jamais s'inscrire à
  ce salon**, et son argent reste bloqué.

C'est la même famille de défaut que le verrou orphelin de la ligue, qui avait
été corrigé par un rembobinage explicite (`server/league-engine.mjs:293-327`).
Le BR n'a pas ce filet.

**Pourquoi aucun test ne le voit.** `server/br-engine.test.mjs:375` couvre bien
le refus `TEAM_FULL`, mais `lockEntryFee` y est un `vi.fn()` sans effet
(`server/br-engine.test.mjs:9-14`) : le test ne peut pas, par construction,
détecter un problème de solde.

**Correctif appliqué.** Deux mesures, dans cet ordre :

1. **Déplacer `lockEntryFee` après le contrôle `TEAM_FULL`.** La règle
   générale : *on ne bloque de l'argent qu'après avoir été sûr que l'opération
   aboutira.* Toutes les validations passent d'abord, l'argent ensuite.
2. **Un filet de sécurité.** Les écritures qui suivent le verrou sont
   encadrées : si l'une d'elles échoue, le pass est **remboursé** avant de
   propager l'erreur. V7 venait précisément d'une écriture susceptible
   d'échouer après le débit — on ne remet pas ce genre de piège en place.

**La preuve.** `server/br-engine.test.mjs` — deux joueurs de la même équipe
remplissent un duo en mode `duo`, un troisième de la même équipe est refusé.
Le test vérifie que **`lockEntryFee` n'a pas été appelé** pour le joueur
refusé, et que le salon (nombre de joueurs, pot) est inchangé.

C'est précisément l'angle mort que le documente : `lockEntryFee` y est un
`vi.fn()` sans effet, donc **aucun test ne pouvait voir un problème de solde**.
L'assertion porte donc sur l'appel lui-même — ce que le mock permet, et ce
que la lecture du solde ne permettait pas.

Mutation vérifiée : en remettant le verrou avant le contrôle `TEAM_FULL`, la
suite tombe à **1 échec sur 70**.

---

### V8 — Le front additionne le total de l'équipe gagnante aux gains d'un joueur
**Gravité : MOYENNE (affichage)** — *constat nouveau, absent du rapport*

**Vérification.**

| Emplacement | Code |
|---|---|
| `src/lib/profileMetrics.ts:184` | `matchEarnings += getWinnerPayout(match)` |
| `src/lib/communityInsights.ts:404` | `record.totalEarnings = roundAmount(record.totalEarnings + getWinnerPayout(match))` |
| `src/lib/matchPayout.ts:41-42` | `getWinnerPayout` renvoie `projectedPayouts.winner` |
| `server/match-engine.mjs:172` | `winner` = **total de l'équipe** gagnante, pas la part individuelle |

**Impact utilisateur concret.** Sur un 2VS2, le profil du joueur affiche le
double de ce qu'il a reçu ; en 5VS5, cinq fois. La valeur serveur
`user.stats.totalEarnings` est correcte (`server/match-engine.mjs:380`, qui
utilise la part individuelle `amount`), donc l'écart est visible entre « mes
stats » et l'historique du portefeuille. Aucun mouvement d'argent n'est en jeu :
c'est une divergence d'affichage.

---

### V9 — La migration de la colonne `revision` n'est dans aucun fichier SQL du dépôt
**Gravité : ÉLEVÉE si la migration n'est pas appliquée en production** — *constat nouveau*

**Vérification.**

| Fichier | Contenu |
|---|---|
| `supabase/schema.sql:7-18` | `CREATE TABLE app_users` — **sans** colonne `revision` |
| `supabase/schema.sql:74-88` | un **commentaire** qui explique la colonne et le mécanisme |
| `supabase/migrate-rls-live.sql:12` | `CREATE TABLE app_users` — **sans** `revision` |

Le seul `ALTER TABLE app_users ADD COLUMN revision BIGINT NOT NULL DEFAULT 0`
qui existe dans le dépôt est la chaîne d'avertissement
`server/persistence.mjs:447`.

**Conclusion.** La colonne est **décrite**, pas **provisionnée** par le dépôt.
**L'état d'application en production n'est pas vérifiable depuis le dépôt** —
c'est le point à trancher en premier.

**Impact concret si elle est absente.** `occSupporte()` renvoie `false`
(`server/persistence.mjs:435-451`), et **toute** écriture de compte devient
inconditionnelle (`server/persistence.mjs:528-534`). Toute la protection
multi-instance disparaît, et le serveur émet un seul WARN au démarrage
(`server/persistence.mjs:445-448`) :
« Colonne app_users.revision absente : ecritures non conditionnelles (fenetre
multi-instance ouverte) ». `/api/health` reste vert. C'est exactement le
scénario décrit dans `server/persistence.mjs:396-400` : « Sur de l'argent,
c'est une perte silencieuse ».

---

### V10 — BR : aucun cron de reprise d'un règlement interrompu
**Gravité : MOYENNE** — *constat nouveau*

**Vérification.** Aucune occurrence de `settling` dans `server/cron.mjs`. Le
seul chemin de reprise est un **nouvel appel** de l'arbitre sur
`POST /api/br/lobbies/:id/finish`, puisque `settleBrLobbyOnServer` accepte
`settling` (`server/br-engine.mjs:710-712`).

**Impact concret.** Si l'arbitre ne rejoue pas, les gains non versés restent
en `settling` indéfiniment. Le match, le tournoi et la ligue ont, eux, une file
de reprise automatique (`server/cron.mjs:247-278`, `:365-388`, `:396-419`).
L'écart de traitement est réel : trois systèmes de règlement sur quatre ont
une reprise automatique, le quatrième non.

---

### V11 — `arbiterPayouts` utilise le `arbiterFee` figé sur le pot théorique
**Gravité : FAIBLE** — *constat nouveau*

**Vérification.** `server/persistence.mjs:1515-1521` lit `match.arbiterFee`,
champ figé à la création sur le pot **théorique** (`server/match-engine.mjs:542`),
alors que la commission réellement versée vaut 2 % du pot **réel**
(`server/match-engine.mjs:313`). Le commentaire du code le reconnaît
(`server/persistence.mjs:1515-1517`).

**Impact concret.** L'indicateur « sortie de trésorerie vers les arbitres »
affiché à l'admin ne correspond pas aux sommes réellement versées dès que le
roster était incomplet. **Le revenu n'est pas affecté** : il ne dépend que des
frais de retrait (`server/persistence.mjs:1532`).

---

### V12 — `LEAGUE_PLAYERS_PER_DAY` est une constante morte
**Gravité : FAIBLE** — *constat nouveau*

**Vérification.** `server/league-engine.mjs:18` déclare `LEAGUE_PLAYERS_PER_DAY = 100` ;
aucune autre occurrence dans le dépôt.

**Impact.** Aucun plafond par journée n'est appliqué : avec 500 inscrits et 5
journées, une journée peut réunir 100 joueurs sans contrôle. La seule borne
réelle est `maxPlayers ≤ 500` (`server/league-engine.mjs:16`).

---

### V13 — `getMatchActivityForUser` est du code mort
**Gravité : INFORMATIONNELLE**

`server/match-engine.mjs:1441` — aucune occurrence ailleurs dans le dépôt.
Voir V3 : le comportement équivalent est implémenté côté front
(`src/app/stores/matchStore.ts:505-517`).

### V14 — Ternaire mort dans `getStatusFromMatch`

`server/match-engine.mjs:233` : `return match.arbiter ? 'ready' : 'ready';` —
les deux branches sont identiques. Sans effet.

### V15 — `isInstantNoArbiter` est inatteignable

`server/match-engine.mjs:906-918`. Pour atteindre `:906`, il faut être
l'arbitre — donc `match.arbiter` existe, donc `isInstantNoArbiter === false` —
ou être admin — donc `isAdminOverride === true`, ce qui neutralise déjà `:908`.
La branche `:916` est donc **inatteignable**. Le rapport antérieur avait raison
sur ce point.

---

## 6. Ce que les tests ne prouvent pas

| Ce qui n'est pas prouvé | Pourquoi |
|---|---|
| Que `sweepMatchesWithoutArbiter` tourne en production | Le test est unitaire : il appelle la fonction directement (`server/arbiter-sweep.test.mjs:41`). Aucun test ne vérifie qu'un cron ou une route l'appelle. Un test « qui appelle la fonction » ne prouve pas qu'elle est branchée — c'est exactement le cas de V1. |
| Que la créance d'arbitre en échec est reprise | Aucun test ne la relit : rien ne la relit (V2). |
| Que `perWinner` est correct | Le test qui existe fige la valeur fausse (V5). |
| Que les soldes ne dérivent pas en multi-instance | L'OCC est testée **sur la source** (`server/occ-revision-invariant.test.mjs`), pas sur un vrai déploiement à deux instances. Et la colonne peut ne pas exister (V9). |
| Qu'un match BR `TEAM_FULL` ne coûte rien au joueur | `lockEntryFee` est un mock sans effet dans le test (`server/br-engine.test.mjs:9-14`) — voir V7. |
| Qu'un joueur listé deux fois dans un roster de match n'est payé qu'une fois | Le chemin `paidWinners` (`server/match-engine.mjs:369`) n'est exercé par aucun test identifiable — voir I5. |
| Que la clé de réservation de ligue est bien `season.id` | Aucun test n'exerce ce chemin — voir I17. |
| Que les preuves sont anti-XSS | Aucun test identifiable sur `isSafeProofRef` (`server/match-engine.mjs:120-130`) — voir E5. |

---

## 7. État de la vérification : ce que le rapport antérieur avait dit

Le rapport de cartographie utilisé comme piste de recherche a été **revérifié
point par point** dans le code. Bilan :

### Confirmés (5/5 sur les cinq points signalés)

1. `sweepMatchesWithoutArbiter` n'est appelé par aucun cron, aucune route,
   aucun serveur, aucun script — **confirmé** (V1). **CORRIGÉ depuis** : le
   balayage est branché sur le tick d'automatisation de 30 s
   (`server/match-engine.mjs` → `runMatchAutomationOnServer`, appelé par
   `server/realtime-server.mjs`), et `server/arbiter-sweep-wiring.test.mjs`
   couvre désormais le CHEMIN COMPLET — pas seulement la fonction.
2. `pendingArbiterFee` est écrit mais jamais relu — **confirmé** (V2).
3. `awaiting_arbiter` ∉ `ACTIVE_STATUSES` — **confirmé**, mais le rapport
   se trompait sur un point : le statut est **persisté** en base
   (`server/match-engine.mjs:245`, E2E `e2e/api/match.spec.ts:203`), pas
   « jamais écrit tel quel » (V3).
4. `archived` ∈ `MATCH_ETATS_CLOS` mais ∉ `TERMINAL_STATUSES` — **confirmé** (V4).
5. `getProjectedPayouts.perWinner` divise par le nombre total de joueurs —
   **confirmé sur le fond**, mais l'impact annoncé était **exagéré** : aucun
   composant du front ne lit ce champ aujourd'hui, et le test qui le « couvre »
   fige la valeur fausse (V5).

### Infirmés ou corrigés

| Affirmation du rapport | Réalité vérifiée |
|---|---|
| « Les statuts dérivés sont *jamais écrits* » | **Faux.** `updateMatchSnapshot` les écrit dans `match.status` (`server/match-engine.mjs:245`). Le test E2E `e2e/api/match.spec.ts:203` le prouve. |
| « `perWinner` : l'UI affiche une part par joueur inférieure à la part réellement versée » | **Non vérifiable / inexact.** Le champ est faux et diffusé, mais **aucun composant ne le lit**. `src/lib/matchPayout.ts:52-56` est du code mort. |
| « La commission d'arbitre en échec est une créance écrite mais jamais reprise, *contrairement* aux gains de tournoi et de ligue qui ont `pendingPayouts` + cron » | **Confirmé**, y compris la comparaison avec les crons de tournoi (`server/cron.mjs:365-388`) et de ligue (`:396-419`). |
| Liste des balayages du rapport, §9 | **Incomplète.** Le rapport s'interrompait sur cette section. La matrice complète est dans `docs/02-modele-metier.md` §9.1 : 12 balayages branchés, 2 non branchés, 1 manuel. |
| Le rapport annonçait 7 moteurs | **Confirmé**, mais le neuvième et le dixième fichiers structurants (`server/persistence.mjs`, `server/mutex.mjs`) sont traite à part dans le rapport lui-même. |

### Constats que le rapport n'avait pas vus

V6 (le balayage d'expiration des confirmations meurt sur une exception),
V7 (verrou orphelin BR sur `TEAM_FULL`), V8 (gains d'équipe comptés par joueur
dans le front), V9 (colonne `revision` absente des fichiers SQL),
V10 (BR sans reprise automatique), V11 (`arbiterPayouts` sur le pot théorique),
V12 (`LEAGUE_PLAYERS_PER_DAY` morte).

---

## 8. Ce qu'il faut faire, par ordre de risque

1. **Vérifier en production si la colonne `app_users.revision` existe** (V9).
   Sans elle, toute la protection multi-instance est hors service. C'est une
   seule requête ; tout le reste en dépend.
2. **Ouvrir une file de reprise pour la commission d'arbitre** (V2), sur le
   modèle de `pendingPayouts`.
3. **Corriger `perWinner`** (V5) **et** le test qui fige le bug, avant que le
   champ ne soit affiché.
4. **Réconcilier les trois listes de statuts** (V3, V4) : `awaiting_arbiter`
   dans `ACTIVE_STATUSES`, `archived` dans `TERMINAL_STATUSES` — ou, mieux,
   une source unique pour les statuts.
5. **Donner au BR une reprise automatique** (V10).
6. **Aligner le front sur le serveur** pour les gains par joueur (V8).

### Déjà traités

- ✅ **V1** — le balayage d'arbitrage est branché sur le tick de 30 s, avec un
  test qui couvre le chemin complet.
- ✅ **V6** — l'expiration des confirmations isole les échecs par match et les
  signale ; un match non réglable ne gèle plus les autres.
- ✅ **V7** — le pass BR n'est plus verrouillé avant les validations ; un
  joueur refusé ne perd plus son argent, et un filet rembourse en cas
  d'échec tardif.
