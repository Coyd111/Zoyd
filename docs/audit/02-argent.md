# Étape 2 — Argent et intégrité financière

## Portée

Le portefeuille, les dépôts FedaPay, les retraits, le verrouillage des
cagnottes, les règlements de matchs, tournois, ligues et BR, et le code mort
qui touche à l'argent.

## 1. Correction : fenêtre de double crédit sur les dépôts FedaPay

**Sévérité : moyenne.** Fenêtre étroite, mais le scénario est réel et le
montant en jeu est le dépôt d'un joueur.

Le chemin de réservation d'une transaction était :

1. `hasTransactionBeenProcessed` — un `SELECT` pour savoir si la transaction
   a déjà été traitée ;
2. `claimTransaction` — une écriture pour la réserver.

Entre les deux, rien n'empêchait une seconde tentative. L'écriture était un
**`upsert`** : sur `processed_transactions.transaction_id` (clé primaire),
PostgREST **met à jour la ligne existante et renvoie succès**. La seconde
réservation n'échouait donc pas — elle écrasait la première, et les deux
crédits passaient.

Le verrou `processingTransactions` en mémoire ne fermait cette fenêtre
qu'à l'intérieur d'**un seul processus**. Or un déploiement Render laisse un
instant l'ancienne et la nouvelle instance servir en parallèle, chacune avec
son cache mémoire vide au démarrage.

**Correctif** : la réservation utilise désormais un `INSERT`, qui échoue en
`23505` sur violation d'unicité. La fenêtre est fermée au niveau de la base,
pas du processus.

### Note de méthode

Un test comportemental qui rejoue deux réservations l'une après l'autre
passe **même avec l'ancien code** : le cache mémoire masque le défaut. Le
test qui prouve la correction est donc celui qui vérifie l'opération
(`insert`, pas `upsert`) — il échoue bien sur l'ancien code. Une simulation
séquentielle ne peut pas reproduire une course : il faut deux `SELECT` avant
toute écriture, ce qu'un test séquentiel ne fait jamais.

## 2. Invariants de portefeuille — quatre ajoutés

`verifyDataIntegrity` ne vérifiait que deux choses :

- `lockedBalance` égale la somme des `lockedEntries` ;
- `lockedBalance` n'est pas négatif.

Rien ne vérifiait les soldes eux-mêmes. Les trois chemins de débit (retrait,
pass BR, débit de match) contrôlent le solde avant d'écrire, donc un solde
négatif ne devrait pas exister — mais **rien ne le vérifiait à l'échelle du
portefeuille**. Une future voie de débit oubliée, ou une payload corrompue
chargée depuis la base, serait invisible jusqu'à ce qu'un joueur la voie.

Désormais également vérifiés :

| Invariant | Détecte |
|-----------|---------|
| `cashBalance >= 0` | solde cash négatif |
| `bonusBalance >= 0` | solde bonus négatif |
| `lockedBalance <= cashBalance + bonusBalance` | on a verrouillé plus que ce qu'on possède |
| `walletBalance == cashBalance + bonusBalance` | total affiché désynchronisé des soldes |

Le dernier ne peut pas être atteint par le code : `updateUserAccount`
recalcule toujours `walletBalance`. Il reste utile contre une payload
corrompue venue de la base. Le test le vérifie explicitement au lieu de
prétendre le contraire.

## 3. Code mort supprimé : `lockFunds` / `unlockFunds`

`src/app/stores/walletStore.ts` exposait un verrouillage optimiste des fonds
d'entrée : il déplaçait cash et bonus vers `lockedBalance`, créait une
entrée verrouillée, journalisait une transaction `entry_fee`, et renvoyait
une fonction de rollback.

**Ces fonctions n'étaient appelées par aucun code de production** — seulement
par leurs propres tests. Elles portaient un TODO attendant le `wallet:update`
que le serveur émet désormais.

Supprimées. La raison n'est pas le volume : c'est que ces fonctions
**reproduisaient côté client ce que le serveur fait déjà** à l'inscription.
Le mécanisme `wallet:update` Announcement la prochaine resynchronisation par le
serveur — si quelqu'un avait branché ce code, il aurait créé un
**double verrouillage** : le serveur verrouillerait à l'inscription, le
client verrouillerait en plus localement. Du code mort qui manipule de
l'argent est un passif, pas une archive.

## 4. Points vérifiés et conformes

Autant de valeur que de défauts.

- **Dépôt FedaPay** : le motif *claim / release* est correct. La transaction
  est réservée de façon atomique **avant** le crédit, et libérée si l'écriture
  échoue — sans quoi un échec de crédit laisserait la transaction marquée
  traitée à jamais, avec l'argent jamais crédité.
- **Anti-vol du dépôt** : la transaction doit appartenir au demandeur
  (`ZOYD:<userId>` gravé par notre widget, ou email identique). Un
  `transactionId` volé ne crédite pas un autre compte.
- **Vérification de devise** : XOF attendu ; le téléphone n'est plus utilisé
  comme preuve, car la comparaison sur 8 chiffres collisions entre pays
  (`+229 97…` contre `+225 97…`) — un attaquant pouvait s'inscrire avec un
  numéro cousin et réclamer le dépôt d'un autre.
- **Idempotence des retraits** : index dédié, hydraté au chargement depuis
  les portefeuilles persistés, donc la protection survit à un redémarrage.
- **Verrous** : toutes les mutations de solde passent par
  `withWalletMutex`, puis `updateUserAccount` → `withUserMutex`.
- **Règlement en deux phases** : `deferSettlement` persiste d'abord
  `payoutDistributed: 'pending'`, le versement a lieu ensuite. Avec `false`,
  les portefeuilles étaient crédités *avant* `saveMatches` — un crash entre
  les deux laissait l'argent parti sans trace, et l'attribution pouvait être
  rejouée.
- **Frais non remboursables** : une passe BR est bloquée à l'inscription et
  jamais remboursée une fois la partie lancée.

## 5. Restant à traiter à cette étape

- **Conversion `transaction.amount / 10`** (1 ZC = 10 FCFA) : non confirmée
  contre l'API réelle. Bloqué jusqu'aux clés live.
- **Multi-instance** : les verrous et l'état en mémoire sont corrects pour
  **un** processus. `WEB_CONCURRENCY=1` le garantit aujourd'hui, mais un
  déploiement reste une fenêtre à deux instances (voir §1). UneInstance
  persistée par joueur — ou un verrou distribué — supprimerait la classe de
  problème, mais c'est un chantier, pas un correctif.