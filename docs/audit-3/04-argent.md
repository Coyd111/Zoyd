# Partie 4 — Argent (wallet, paiement) (audit-3)

**Relecture :** 2026-10-26, base `main` au `2f951a9`.
**Périmètre :** `server/wallet-engine.mjs` (~750 lignes), `server/payment-engine.mjs`
(428 lignes), `server/payout-countries.mjs` (167 lignes), `server/routes/wallet.mjs`
(~492 lignes) — lus intégralement. Croisements : `server/cron.mjs` (sweep retraits,
`:758-804`), `server/withdrawal-reconciliation.test.mjs`, tests wallet et paiement
(`server/*.test.mjs`).
**Anti faux-positifs :** ledgers `docs/audit-2/`, invariants `docs/05-invariants.md`,
commentaires `PIEGE:`/`INVARIANT:` des sources.

## Verdicts par fichier

| Fichier | Verdict |
|---|---|
| `payment-engine.mjs` | 1 MAJEUR (C1 : vocabulaire de statuts payout — `sent` non reconnu) |
| `wallet-engine.mjs` | 1 FAIBLE (C2 : plafond journalier contournable via fenêtre 200), 2 INFO (C3, C4) |
| `payout-countries.mjs` | Propre — module feuille, liste statique de pays |
| `routes/wallet.mjs` | INFO (C4 : champ `remainingToday` mal nommé) |

Ce qui a été vérifié et jugé solide (non re-constaté, couvert par les ledgers
audit-2) :

- **`releaseWalletWinnings`** : idempotence `type:<matchId>` tracée DANS le
  portefeuille (survit à la fenêtre 200), untrack de la réservation sur échec,
  anti-blanchiment (`bonusRestore`) : un gain libéré ne peut pas financer un
  bonus.
- **`refundRejectedWithdrawal`** : décision OCC figée — le remboursement est
  décidé une fois, les rejeus reconvergent ; clé d'idempotence dérivée de façon
  stable côté cron (`refund:<cle>` ou `refund:payout:<id>`, `cron.mjs:788-795`).
- **Route `/api/wallet/withdraw`** : idempotencyKey obligatoire (`:221-226`),
  TOCTOU sous mutex, drapeau `abandonner` (`:266-296`), remboursement REFUSÉ
  tant que `payoutMaybeSent !== true` (ne jamais rembourser un payout peut-être
  parti), tag + forget en `finally` (`:383-407`).
- **`reconcilePendingWithdrawals`** : file dédiée `payoutsEnAttente`, non
  plafonnée par l'activité du joueur (`:636-656`) — le PIEGE de la fenêtre 200
  est connu du module et traité pour la réconciliation ; ordre
  remboursement-AVANT-tag avec reconvergence documentée (`:695-709`) ;
  `Math.abs` du montant (`:693`) ; erreur de lecture FedaPay → aucune décision,
  `stillPending` (`:728-735`).
- **Plafond journalier réel** : `Math.abs` sur les montants négatifs
  (`getWindowedWithdrawalTotal :91-94`), solde vérifié AVANT plafond, frais via
  `calcWithdrawNet` source unique (`:104-108`).
- **`payoutMaybeSent`** porte le `payoutId` de FedaPay : la réconciliation a une
  clé de lecture fiable même si la tx a disparu de l'historique.

## Constats

### C1 — MAJEUR : le vocabulaire de statuts payout ne connaît pas `sent` — un payout payé reste « en attente » pour toujours

- `payoutSucceeded` (`payment-engine.mjs:419-422`) reconnaît
  `['success', 'successful', 'completed', 'paid', 'done']` ;
  `payoutFailed` (`:425-428`) reconnaît
  `['failed', 'failure', 'error', 'rejected', 'cancelled', 'canceled']`.
- Or le cycle de vie officiel FedaPay (doc « Payouts management ») est
  `pending → started → processing → sent → failed` : le statut final de
  SUCCÈS est **`sent`**. Aucune occurrence de `sent`/`transferred` dans tout le
  dépôt côté payout (les seuls `sent` sont le `delivery` d'auth, sans rapport).
- Le branchement production est confirmé : le cron injecte bien ces deux
  prédicats (`cron.mjs:770-772`, import `:67`). Donc pour tout payout que
  FedaPay marque `sent` — le cas nominal d'un versement réussi :
  1. `reconcilePendingWithdrawals` tombe dans la branche ni-succès-ni-échec
     (`wallet-engine.mjs:725-727`) → `stillPending` ;
  2. l'entrée ne sort JAMAIS de `payoutsEnAttente` : la lecture
     `Payout.retrieve` est rejouée à chaque cycle, à vie ;
  3. le retrait reste « en attente » pour le joueur alors que l'argent est
     parti ; l'admin ne peut pas distinguer « payé » de « coincé ».
- Les tests ne peuvent pas détecter le défaut : `withdrawal-reconciliation.test.mjs:33-34`
  injecte des prédicats COPIÉS sur le même vocabulaire
  (`'success'/'successful'/'completed'`, `'failed'/'rejected'/'cancelled'`) —
  le test valide la mécanique de réconciliation avec un détecteur calqué sur la
  même hypothèse, pas le branchement production. Aucune fixture n'utilise
  `sent`. Les autres tests mockent la réconciliation entière (ex.
  `arbiter-fee-wiring.test.mjs:55`).
- Symétrique partiel : l'échec définitif FedaPay est `failed` (couvert) ; les
  variantes `refused`/`declined` ne le sont pas non plus.

Gravité MAJEUR : pas d'argent perdu (le payout part quand même, la
réconciliation ne fait que relire), mais la fonction « trancher la dette de
retrait » échoue sur son cas nominal de succès : état du joueur faux pour
toujours, file de réconciliation qui grossit sans fin, requêtes FedaPay
rejouées indéfiniment.

Piste de correctif : aligner les deux prédicats sur le cycle de vie réel —
`payoutSucceeded` ajoute `sent` (éventuellement `transferred`), `payoutFailed`
ajoute `refused`/`declined` ; corriger les fixtures du test pour refléter le
vocabulaire réel, ou faire tester les prédicats de `payment-engine` eux-mêmes.

### C2 — FAIBLE : plafond journalier de retrait lu dans une fenêtre de 200 entrées — contournable en bourrant l'historique

- `getWindowedWithdrawalTotal` (`wallet-engine.mjs:83-97`) somme les retraits
  des 24 h dans `wallet.transactions` — qui est plafonnée à 200 entrées à
  CHAQUE écriture (`.slice(0, 200)`, `:139`).
- Un joueur peut pousser 200 transactions récentes (ex. cycles créer/annuler un
  match à mise minime, coût net proche de 0) pour faire sortir ses retraits de
  la fenêtre : le cumul redevient bas et le plafond de 50 000 ZC/jour (`:67`)
  ne limite plus rien.
- Le module CONNAÎT la limite : le commentaire de la file dédiée
  (`:638-641`) l'évoque pour la réconciliation (« l'historique est plafonne a
  200 entrees, et un retrait qui en sortait n'etait plus jamais relu »), mais
  le plafond JOURNALIER reste, lui, lu dans la même source boiteuse.
- FAIBLE : garde-fou anti-cumul contournable, mais chaque retrait reste une
  écriture tracée, le flux reste gardé ailleurs (mutex, idempotence), et
  l'attaque demande de la préparation en laissant un historique suspect.

Piste de correctif : compter le cumul dans un registre dédié persistant (comme
la file `payoutsEnAttente`), ou au minimum cumuler aussi la file dédiée et
conserver un total agrégé par jour.

### C3 — INFO : `countPendingWithdrawals` ignore la file dédiée — rayon de santé sous-compté

- `countPendingWithdrawals` (`wallet-engine.mjs:742-749`) compte les tx
  `withdraw` à `payoutStatus: 'pending_review'` dans l'historique (fenêtre
  200) ; il ignore `payoutsEnAttente` — la source que le module déclare
  lui-même « la seule fiable » (`:636-641`).
- Effet : une dette hors fenêtre (le cas exact que la file existe pour couvrir)
  n'apparaît pas dans le compteur de santé (consommé par `/api/health`, à
  re-vérifier en partie 8/9). Sous-comptage uniquement : aucune décision
  d'argent ne dépend de ce compteur.

### C4 — INFO : micro-remarques sans impact

- **Spread no-op** : `...(item.tx ? {} : {})` (`wallet-engine.mjs:676-679`) —
  les deux branches sont identiques, l'objet `marque` est le même dans tous les
  cas. Le comportement est correct (`tagTx` accepte `txId` null, la file porte
  la dette) ; le spread est du code mort à nettoyer.
- **`remainingToday` mal nommé** : `routes/wallet.mjs:140` publie
  `remainingToday: getWindowedWithdrawalTotal(wallet)` — la valeur est le cumul
  DÉJÀ utilisé, pas le reste disponible. Le front ne lit ce champ nulle part
  (grep `src/` : 0 match), donc aucun affichage faux aujourd'hui ; le nom de
  l'API ment pour le prochain consommateur. À arbitrer : renommer `usedToday`
  ou publier `dailyLimit - cumul`.
- **Erreurs FedaPay masquées** : `TRANSACTION_NOT_APPROVED`/`INVALID_AMOUNT`
  remontent au front sous le code générique `FEDAPAY_API_ERROR`
  (`payment-engine.mjs:168-179`) — diagnostic support plus lent, aucune fuite.
- **`tagTx(userId, txId || null)`** : quand la tx a disparu des 200 dernières,
  le tag ne peut pas marquer l'historique ; si le tag retire quand même l'entrée
  de la file, la trace finale du retrait reste `pending_review` dans
  l'historique (cosmétique — l'argent est déjà tranché par la file). À vérifier
  en partie 8 (implémentation `tagWalletTransaction`).

## Résumé

Un MAJEUR dans la réconciliation des retraits : les prédicats `payoutSucceeded`
/`payoutFailed` ignorent `sent`, statut final de succès du cycle de vie
officiel FedaPay — tout payout réussi reste « en attente » pour toujours
(étiquette fausse pour le joueur, file qui grossit sans fin, requêtes
rejouées à chaque cycle), et les tests injectent le même vocabulaire, donc ne
peuvent pas le voir. Le reste du flux d'argent est solide : plafond réel
(`Math.abs`), mutex + idempotence sur la route de retrait, remboursement OCC
idempotent, ordre remboursement-avant-tag reconvergent. Un FAIBLE : le plafond
journalier est lu dans une fenêtre de 200 entrées contournable par bourrage
d'historique. Deux INFO.
