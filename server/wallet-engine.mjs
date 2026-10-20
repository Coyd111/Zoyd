/**
 * server/wallet-engine.mjs - Toutes les mutations de portefeuille : depot,
 * retrait, blocage du pass, remboursement, versement des gains, debit.
 *
 * Une seule porte d'entree vers la base : `updateWalletSnapshot`. Ce module ne
 * connait ni FedaPay ni la base : il calcule et applique sur l'etat du
 * portefeuille.
 *
 * INVARIANT : toute mutation passe par `updateWalletSnapshot` : c'est la
 *   seule porte vers le solde, et c'est elle qui notifie les ecouteurs
 *   temps reel.
 * INVARIANT : le montant d'une transaction est SIGNE : un retrait est
 *   NEGATIF, un remboursement est POSITIF. Le journal doit se reconcilier
 *   avec les soldes.
 * INVARIANT : le solde est verifie AVANT le plafond journalier : sinon
 *   `INSUFFICIENT_FUNDS` devient inatteignable pour les gros retraits.
 * INVARIANT : le debit precede l'appel FedaPay, et le remboursement n'a lieu
 *   que sur une certitude d'echec (indicateur `payoutMaybeSent`).
 * INVARIANT : `releaseWalletWinnings` est idempotent sur la cle
 *   type + competition : un second appel rend le portefeuille intact au lieu
 *   de payer deux fois.
 * INVARIANT : la cle de gain est ecrite DANS le portefeuille : elle doit
 *   etre persistee avec lui, sinon la protection disparait au redemarrage.
 * PIEGE : l'historique est plafonne a 200 entrees : une cle stockee
 *   uniquement dans l'historique finit par disparaitre (d'ou `winningsKeys`
 *   et la liste dediee `payoutsEnAttente`).
 * PIEGE : le montant d'un retrait est negatif dans l'historique : le
 *   remboursement doit utiliser `Math.abs`, sinon il rembourse un montant
 *   NEGATIF (le joueur perd de l'argent au moment ou on lui rend justice).
 * PIEGE : `depositToWallet` sert aussi aux remboursements : `options.type` et
 *   `options.description` doivent etre surcharges, sinon un remboursement
 *   s'affiche comme un depot dans l'historique.
 * PIEGE : la part BONUS de la mise du gagnant revient en bonus (non
 *   retirable) et non en cash : l'anti-blanchiment est applique ici.
 * PIEGE : les fonctions FedaPay sont INJECTEES dans
 *   `reconcilePendingWithdrawals` : ce module ne doit pas importer
 *   `payment-engine.mjs`, sous peine de cycle.
 *
 * Invariants detailles : docs/05-invariants.md
 * Architecture et routage : docs/01-architecture.md
 */

import crypto from 'node:crypto';
import { getWalletSnapshot, updateWalletSnapshot, hasSettledWinningsKey, trackWinningsKey } from './persistence.mjs';

const MIN_WITHDRAWAL_ZC = 150;
const WITHDRAWAL_FEE_RATE = 0.02;


/**
 * Plafond de retraits cumules par joueur sur 24 h.
 *
 * La route ne borne que la TRANSACTION. Sans cumul, un joueur pouvait en
 * chainer les retraits jusqu a vider son solde : le seul frein etait le rate
 * limiter par IP, contournable trivialement.
 *
 * Volontairement genereux : l objectif est de rendre impossible le cumul
 * repete, pas d empecher un retrait legitime.
 */
const MAX_WITHDRAWAL_DAILY_ZC = 50_000;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

export { MIN_WITHDRAWAL_ZC, WITHDRAWAL_FEE_RATE, MAX_WITHDRAWAL_DAILY_ZC };

/**
 * Somme des retraits du joueur sur la fenetre glissante.
 *
 * Lue dans l historique du portefeuille plutot que dans un registre separe :
 * c est la seule source deja persistee et rattachee au compte, donc elle
 * survit a un redemarrage.
 *
 * @param {object} wallet
 * @param {number} [nowMs]
 * @returns {number} cumul en ZC
 */
export const getWindowedWithdrawalTotal = (wallet, nowMs = Date.now()) => {
  const debut = nowMs - DAILY_WINDOW_MS;
  let total = 0;
  for (const tx of wallet?.transactions || []) {
    if (tx?.type !== 'withdraw') continue;
    if (tx?.status === 'failed') continue;
    const quand = new Date(tx?.timestamp || 0).getTime();
    if (!quand || quand < debut) continue;
    // ATTENTION : amount est NEGATIF sur une transaction de retrait. C est
    // la sortie de caisse consignee, pas le montant retire. Sans le signe, le
    // cumul restait nul et le plafond ne limitait rien.
    total += Math.abs(Number(tx?.amount) || 0);
  }
  return roundAmount(total);
};

/**
 * Compute fee + net for a withdrawal (single source of truth, 2-decimal rounding).
 * @param {number} amount - Gross amount in ZC
 * @returns {{ feeAmount: number, netAmount: number }}
 */
export const calcWithdrawNet = (amount) => {
  const gross = roundAmount(amount);
  const feeAmount = roundAmount(gross * WITHDRAWAL_FEE_RATE);
  return { feeAmount, netAmount: roundAmount(gross - feeAmount) };
};

/**
 * Montants de retrait renvoyes au client.
 *
 * Vivait dans `realtime-server.mjs`, alors que les routes de portefeuille sont
 * dans `routes/wallet.mjs`. Le calcul derive de `calcWithdrawNet` — la source de
 * verite du moteur — donc il vit ici, a cote.
 *
 * @param {number} grossAmount - Montant brut en ZC
 * @returns {{ feeRate: number, grossAmount: number, feeAmount: number, netAmount: number }}
 */
export const buildWithdrawalAmounts = (grossAmount) => {
  const { feeAmount, netAmount } = calcWithdrawNet(grossAmount);
  return {
    feeRate: WITHDRAWAL_FEE_RATE,
    grossAmount: roundAmount(grossAmount),
    feeAmount,
    netAmount,
  };
};
import { roundAmount, getNow, makeError } from './utils.mjs';

const buildTransaction = (tx) => ({
  ...tx,
  id: `TX-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
  timestamp: getNow(),
});

const withTransaction = (wallet, tx) => ({
  ...wallet,
  transactions: [buildTransaction(tx), ...(Array.isArray(wallet.transactions) ? wallet.transactions : [])].slice(0, 200),
});

/**
 * Get the current wallet state for a user.
 * @param {string} userId - ID of the user.
 * @returns {Object} Wallet snapshot with balances and transaction history.
 */
export const getServerWallet = (userId) => getWalletSnapshot(userId);

/**
 * Deposit funds into a user's cash balance.
 * @param {string} userId - ID of the user.
 * @param {number} amount - Amount to deposit in ZC.
 * @param {string} [method] - Payment method (e.g. 'Mobile Money').
 * @returns {Promise<Object>} Updated wallet snapshot.
 */
export const depositToWallet = async (userId, amount, method = 'Mobile Money', options = {}) => {
  const safeAmount = roundAmount(amount);
  if (safeAmount <= 0) {
    throw makeError('INVALID_AMOUNT', 'Le montant du depot est invalide.');
  }

return (await updateWalletSnapshot(userId, (wallet) => {
    return withTransaction(
      {
        ...wallet,
        cashBalance: roundAmount(wallet.cashBalance + safeAmount),
      },
      {
        // Un remboursement de retrait N'EST PAS un dépôt. Écrit `deposit`, il
        // apparaissait dans l'historique comme « Depot ZC via Remboursement… »
        // à côté d'un retrait marqué « completed » : le joueur lisait des
        // retraits réussis qui n'avaient jamais eu lieu. `type` et
        // `description` sont donc surchargeables.
        type: options.type || 'deposit',
        amount: safeAmount,
        description: options.description || `Depot ZC via ${method}`,
        status: options.status || 'completed',
        metadata: { method, ...(options.metadata || {}) },
      }
    );
  })).wallet;
};

/**
 * Withdraw funds from a user's cash balance (minimum 150 ZC, 2% fee).
 * @param {string} userId - ID of the user.
 * @param {number} amount - Amount to withdraw in ZC.
 * @param {string} [method] - Withdrawal method (e.g. 'Mobile Money').
 * @param {string} [phone] - Phone number for mobile money transfer.
 * @param {Object} [extraMetadata] - Extra metadata merged into the transaction (e.g. idempotencyKey).
 * @returns {Promise<Object>} Updated wallet snapshot.
 */
export const withdrawFromWallet = async (userId, amount, method = 'Mobile Money', phone = '', extraMetadata = {}) => {
  const safeAmount = roundAmount(amount);
  if (safeAmount < MIN_WITHDRAWAL_ZC) {
    throw makeError('WITHDRAWAL_MIN', `Retrait minimum: ${MIN_WITHDRAWAL_ZC} ZC.`);
  }

  return (await updateWalletSnapshot(userId, (wallet) => {
    // Le solde d'abord : on ne peut pas retirer plus que ce qu on a, quelle que
    // soit la fenetre de cumul. L ordre inverse rendait INSUFFICIENT_FUNDS
    // inatteignable pour les retraits superieurs au plafond.
    if (safeAmount > wallet.cashBalance) {
      throw makeError('INSUFFICIENT_FUNDS', 'Solde cash insuffisant pour ce retrait.');
    }
    // Plafond cumule sur la fenetre glissante, verifie avant tout debit.
    const cumul = getWindowedWithdrawalTotal(wallet);
    if (cumul + safeAmount > MAX_WITHDRAWAL_DAILY_ZC) {
      throw makeError(
        'DAILY_WITHDRAWAL_LIMIT',
        'Plafond de retraits atteint : ' + MAX_WITHDRAWAL_DAILY_ZC + ' ZC sur 24 h.',
      );
    }
    const { feeAmount, netAmount } = calcWithdrawNet(safeAmount);

    return withTransaction(
      {
        ...wallet,
        cashBalance: roundAmount(wallet.cashBalance - safeAmount),
      },
      {
        type: 'withdraw',
        amount: -safeAmount,
        description: `Retrait ${method} vers ${phone || 'compte mobile'}`,
        status: 'completed',
        metadata: { method, phone, feeAmount, netAmount, ...extraMetadata },
      }
    );
  })).wallet;
};

/**
 * Lock funds for a match entry fee (deducts from cash then bonus balance).
 * @param {string} userId - ID of the user.
 * @param {number} amount - Entry fee amount to lock.
 * @param {string} matchId - ID of the match to lock funds for.
 * @returns {Promise<Object>} Updated wallet snapshot.
 */
export const lockEntryFee = async (userId, amount, matchId) => {
  const safeAmount = roundAmount(amount);
  if (safeAmount <= 0) {
    throw makeError('INVALID_AMOUNT', 'Le montant du pass doit etre superieur a zero.');
  }

  return (await updateWalletSnapshot(userId, (wallet) => {
    if (wallet.lockedEntries?.[matchId]) {
      throw makeError('ALREADY_LOCKED', 'Un pass est deja bloque pour ce match.');
    }

    const available = roundAmount(wallet.cashBalance + wallet.bonusBalance);
    if (safeAmount > available) {
      throw makeError('INSUFFICIENT_FUNDS', 'Solde insuffisant pour bloquer ce pass.');
    }

    const cashDeduct = Math.min(wallet.cashBalance, safeAmount);
    const bonusDeduct = roundAmount(safeAmount - cashDeduct);

    return withTransaction(
      {
        ...wallet,
        cashBalance: roundAmount(wallet.cashBalance - cashDeduct),
        bonusBalance: roundAmount(wallet.bonusBalance - bonusDeduct),
        lockedBalance: roundAmount(wallet.lockedBalance + safeAmount),
        lockedEntries: {
          ...wallet.lockedEntries,
          [matchId]: {
            amount: safeAmount,
            cashAmount: cashDeduct,
            bonusAmount: bonusDeduct,
            lockedAt: getNow(),
          },
        },
      },
      {
        type: 'entry_fee',
        amount: -safeAmount,
        description: `Pass bloque pour ${matchId}`,
        status: 'completed',
        matchId,
        metadata: { cashDeduct, bonusDeduct },
      }
    );
  })).wallet;
};

/**
 * Un echec de remboursement est-il RECUPERABLE ?
 *
 * Le cron de reprise rejouait TOUS les echecs toutes les 6 h, sans distinction.
 * Un compte supprime echoue avec `USER_NOT_FOUND` a jamais : la reprise le
 * rejouait indefiniment, en remplacant les logs par une boucle de WARN
 * identiques. Le bruit masquait ensuite les echecs qui comptent vraiment
 * (`SUPABASE_DOWN`), les seuls pour lesquels une reprise a un sens.
 *
 * `USER_NOT_FOUND` est donc definitif : il n'y a plus de portefeuille a
 * crediter. L'argent a disparu avec le compte, ce qui est deja le comportement
 * assume lors d'une suppression de compte (`forfeitedCash`). Reinscrire une
 * dette impossible ne la rend pasolvable, ca la rend invisible.
 *
 * Tout le reste — base indisponible, contention, erreur reseau transitoire —
 * reste recuperable et doit etre rejoue.
 *
 * @param {unknown} error
 * @returns {boolean} true si l'echec ne se resoudra pas seul
 */
export const isUnrecoverableRefundError = (error) =>
  error?.code === 'USER_NOT_FOUND' || error?.code === 'USER_DELETED';

/**
 * Refund a locked entry fee back to the user's cash and bonus balances.
 * Used when a match is cancelled or the user leaves before start.
 * @param {string} userId - ID of the user.
 * @param {string} matchId - ID of the match whose entry to refund.
 * @param {string} [description] - Transaction description.
 * @returns {Promise<Object>} Updated wallet snapshot.
 */
export const refundLockedEntry = async (userId, matchId, description) =>
  (await updateWalletSnapshot(userId, (wallet) => {
    const reservation = wallet.lockedEntries?.[matchId];
    if (!reservation) {
      return wallet;
    }

    const nextLockedEntries = { ...wallet.lockedEntries };
    delete nextLockedEntries[matchId];

    return withTransaction(
      {
        ...wallet,
        cashBalance: roundAmount(wallet.cashBalance + reservation.cashAmount),
        bonusBalance: roundAmount(wallet.bonusBalance + reservation.bonusAmount),
        lockedBalance: roundAmount(Math.max(0, wallet.lockedBalance - reservation.amount)),
        lockedEntries: nextLockedEntries,
      },
      {
        type: 'refund',
        amount: reservation.amount,
        description: description || `Remboursement du pass ${matchId}`,
        status: 'completed',
        matchId,
      }
    );
  })).wallet;

/**
 * Settle a match loss by consuming the locked entry fee (no refund).
 * Moves funds from locked balance to consumed with no return.
 * @param {string} userId - ID of the user.
 * @param {string} matchId - ID of the match lost.
 * @param {string} [description] - Transaction description.
 * @returns {Promise<Object>} Updated wallet snapshot.
 */
export const settleMatchLossWallet = async (userId, matchId, description) =>
  (await updateWalletSnapshot(userId, (wallet) => {
    const reservation = wallet.lockedEntries?.[matchId];
    if (!reservation) {
      return wallet;
    }

    const nextLockedEntries = { ...wallet.lockedEntries };
    delete nextLockedEntries[matchId];

    return withTransaction(
      {
        ...wallet,
        lockedBalance: roundAmount(Math.max(0, wallet.lockedBalance - reservation.amount)),
        lockedEntries: nextLockedEntries,
      },
      {
        type: 'match_loss',
        // Le pass consomme vaut `amount` ET NON 0 : avec 0, la somme des
        // transactions ne reconciliait plus les soldes, donc l'historique
        // d'un portefeuille n'etait pas reconstituable depuis son ledger.
        amount: -reservation.amount,
        description: description || `Pass consomme apres resultat ${matchId}`,
        status: 'completed',
        matchId,
        metadata: { lockedAmount: reservation.amount },
      }
    );
  })).wallet;

/**
 * Release winnings (prize or arbiter fee) into the user's wallet.
 * Also unlocks any associated entry fee reservation for the match.
 * Anti-blanchiment : la part bonus de la mise du gagnant retourne en bonus
 * (non retirable) au lieu de se convertir en cash via le gain.
 * @param {string} userId - ID of the user.
 * @param {number} amount - Amount to release.
 * @param {string} matchId - ID of the match or tournament.
 * @param {string} [type] - Transaction type ('prize_win' or 'arbitration_fee').
 * @param {string} [description] - Transaction description.
 * @returns {Promise<Object>} Updated wallet snapshot.
 */
export const releaseWalletWinnings = async (userId, amount, matchId, type = 'prize_win', description, options = {}) => {
  const safeAmount = roundAmount(amount);
  if (safeAmount < 0) {
    throw makeError('INVALID_AMOUNT', 'Le montant des gains ne peut pas etre negatif.');
  }
  // Cle d'idempotence.
  //
  // Un joueur ne peut legitimement percevoir qu'UN gain de type donne pour une
  // competition donnee : `match-engine` paie le vainqueur et la commission
  // d'arbitre (deux types distincts), `league-engine` le podium d'une saison,
  // `tournament-engine` le capitaine puis l'arbitre, `br-engine` chaque
  // gagnant puis l'arbitre. La paire type + competition identifie donc un
  // versement de facon unique, pour un joueur donne.
  //
  // SANS cette garde, un second appel ne retrouve plus la reservation
  // (`lockedEntries[matchId]` deja supprimee) : `releasedAmount` vaut 0 et
  // `cashCredit` retombe sur le montant EN ENTIER. Le joueur etait donc credite
  // deux fois, et l'ecart passait inapercu — aucun invariant ne compare le
  // solde au journal.
  const idempotencyKey = options.idempotencyKey || `${type}:${matchId}`;
  return (await updateWalletSnapshot(userId, (wallet) => {
    // La garde s'appuie sur `wallet.winningsKeys`, qui vit dans le payload du
    // compte : ni plafonne comme l'historique, ni perdu au redemarrage.
    const dejaVerse = hasSettledWinningsKey(userId, idempotencyKey, wallet);
    if (dejaVerse) {
      // Versement deja effectue : on rend le portefeuille intact. Rethrow
      // n'est pas une option : l'appelant (reglement BR, ligue, tournoi)
      // compterait cet etape comme traitee.
      return wallet;
    }
    const reservation = wallet.lockedEntries?.[matchId];
    const releasedAmount = reservation?.amount ?? 0;
    const nextLockedEntries = { ...wallet.lockedEntries };
    if (reservation) {
      delete nextLockedEntries[matchId];
    }
    // La mise bonus du gagnant ne doit pas devenir du cash retirable :
    // on la rend en bonus, le reste du gain part en cash.
    const stakeBonus = roundAmount(reservation?.bonusAmount || 0);
    const bonusRestore = Math.min(stakeBonus, safeAmount);
const cashCredit = roundAmount(safeAmount - bonusRestore);

      // La cle est inscrite DANS le portefeuille, donc ecriture en base avec
      // lui : c est ce qui la fait survivre a un redemarrage. L index memoire
      // est alimente dans la foullee, avant l ecriture, pour qu un echec
      // ulterieur ne laisse pas la porte ouverte.
      trackWinningsKey(userId, idempotencyKey);

      return withTransaction(
      {
        ...wallet,
        cashBalance: roundAmount(wallet.cashBalance + cashCredit),
        bonusBalance: roundAmount(wallet.bonusBalance + bonusRestore),
        lockedBalance: roundAmount(Math.max(0, wallet.lockedBalance - releasedAmount)),
        lockedEntries: nextLockedEntries,
        winningsKeys: [...(Array.isArray(wallet.winningsKeys) ? wallet.winningsKeys : []), idempotencyKey],
      },
      {
        type,
        amount: safeAmount,
        description: description || (type === 'arbitration_fee' ? `Commission arbitre ${matchId}` : `Gain ${matchId}`),
status: 'completed',
          matchId,
          // La cle est stockee AVEC la transaction : c'est elle qui permet a
          // `hydrateWinningsKeys` de reconstruire l'index apres un redemarrage,
          // quand la transaction a deja disparu des 200 dernieres.
          metadata: { cashCredit, bonusRestore, winningsKey: idempotencyKey },
        }
      );
  })).wallet;
};

/**
 * Directly debit an amount from a user's cash balance.
 * @param {string} userId - ID of the user.
 * @param {number} amount - Amount to debit.
 * @param {string} [description] - Transaction description.
 * @returns {Promise<Object>} Updated wallet snapshot.
 */
export const debitFromWallet = async (userId, amount, description = 'Debit') => {
  const safeAmount = roundAmount(amount);
  if (safeAmount <= 0) {
    throw makeError('INVALID_AMOUNT', 'Le montant du debit est invalide.');
  }

  return (await updateWalletSnapshot(userId, (wallet) => {
    if (safeAmount > wallet.cashBalance) {
      throw makeError('INSUFFICIENT_FUNDS', 'Solde insuffisant pour ce debit.');
    }
    return withTransaction(
      {
        ...wallet,
        cashBalance: roundAmount(wallet.cashBalance - safeAmount),
      },
      {
        type: 'debit',
        amount: -safeAmount,
        description,
        status: 'completed',
      }
    );
  })).wallet;
};

/**
 * Retraits marques pending_review : le payout peut-etre parti, on ne sait pas.
 *
 * AVANT, ces retraits etaient un trou : la route refusait de rembourser (a
 * raison), mais rien ne les relisait. Le joueur restait debite, sans trace
 * consultable ailleurs que dans les logs.
 *
 * Ce balayage relit chaque payout douteux aupres de FedaPay et tranche :
 *   - succes : le retrait est honore ;
 *   - echec : le prestataire a refuse, on rembourse enfin le joueur ;
 *   - encore : on laisse en revue, prochain passage.
 *
 * Les fonctions FedaPay sont INJECTEES : ce module ne doit pas dependre de
 * payment-engine. L injection rend en outre la fonction testable sans reseau.
 *
 * `listUserIds` et `getWallet` sont fournis par l appelant : ce module ne
 * connait pas le registre des comptes, seulement les portefeuilles.
 *
 * @param {(status: string) => boolean} payoutSucceeded
 * @param {(status: string) => boolean} payoutFailed
 * @param {(payoutId: number) => Promise<{status: string}>} retrieveFedaPayPayout
 * @param {() => string[]} listUserIds
 * @param {(userId: string) => object|undefined} getWallet
 * @param {(userId: string, txId: string, patch: object) => Promise<boolean>} tagTx
 * @param {(userId: string, amount: number, label: string, opts: object) => Promise<object>} refund
 * @param {(userId: string, key: string) => void} forgetKey
 * @param {(message: string, detail: object) => void} warn
 */
export const reconcilePendingWithdrawals = async (
  payoutSucceeded, payoutFailed, retrieveFedaPayPayout,
  listUserIds, getWallet, tagTx, refund, forgetKey, warn,
) => {
  const pending = [];
  // Deux sources, et c'est VOLONTAIRE :
  //
  // 1. `payoutsEnAttente`, dans le portefeuille : liste dediee, non plafonnee
  //    par l'activite du joueur. C'est la seule source fiable — l'historique est
  //    plafonne a 200 entrees, et un retrait qui en sortait n'etait plus jamais
  //    relu. Son argent restait retenu indefiniment, sans log ni alerte.
  // 2. L'historique : filet de securite pour les portefeuilles enregistres
  //    avant l'existence de la liste. Partiel, et assume comme tel.
  for (const userId of listUserIds()) {
    const wallet = getWallet(userId);
    const dejaVus = new Set();
    for (const entree of wallet?.payoutsEnAttente || []) {
      if (!entree?.payoutId) continue;
      dejaVus.add(entree.payoutId);
      pending.push({
        userId,
        payoutId: entree.payoutId,
        idempotencyKey: entree.idempotencyKey || null,
        tx: (wallet?.transactions || []).find((t) => t?.id === entree.txId) || null,
      });
    }
    for (const tx of wallet?.transactions || []) {
      if (tx?.type !== 'withdraw') continue;
      if (tx.metadata?.payoutStatus !== 'pending_review') continue;
      if (!tx.metadata?.payoutId) continue;
      if (dejaVus.has(tx.metadata.payoutId)) continue;
      pending.push({ userId, payoutId: tx.metadata.payoutId, idempotencyKey: tx.metadata?.idempotencyKey || null, tx });
    }
  }
  if (pending.length === 0) return { resolved: 0, refunded: 0, stillPending: 0 };

  let resolved = 0;
  let refunded = 0;
  let stillPending = 0;

  for (const item of pending) {
    try {
      const payout = await retrieveFedaPayPayout(item.payoutId);
      // La transaction peut avoir disparu de la fenetre : le `payoutId` vient
      // alors de la file, qui est justement la raison de son existence.
      const marque = {
        payoutId: item.payoutId,
        ...(item.tx ? {} : {}),
      };
      if (payoutSucceeded(payout.status)) {
        await tagTx(item.userId, item.tx?.id || null, { ...marque, payoutStatus: 'success', status: 'completed' });
        forgetKey(item.userId, item.idempotencyKey);
        resolved += 1;
      } else if (payoutFailed(payout.status)) {
        // Refus DEFINITIF : cette fois on peut rembourser sans risque.
        //
        // ABSOLU : une transaction de retrait porte un montant NEGATIF (c'est
        // la sortie de caisse consignee). Le code transmettait tel quel, donc le
        // remboursement versait un montant NEGATIF — l'argent du joueur etait
        // retire au lieu de rendu, au moment precis ou on lui rendait enfin
        // justice. Les tests existants passaient parce que leurs fixtures
        // portaient un montant positif.
        const montant = item.tx ? Math.abs(Number(item.tx.amount) || 0) : 0;
        if (montant > 0) {
          await refund(item.userId, montant, { idempotencyKey: item.idempotencyKey });
        } else {
          warn('Retrait en attente resolu sans transaction : aucun montant a rembourser', {
            userId: item.userId, payoutId: item.payoutId,
          });
        }
        await tagTx(item.userId, item.tx?.id || null, { ...marque, payoutStatus: 'failed', status: 'failed' });
        forgetKey(item.userId, item.idempotencyKey);
        refunded += 1;
      } else {
        stillPending += 1;
      }
    } catch (error) {
      // Relire FedaPay a echoue : on ne decide rien. Rembourser ici serait
      // exactement le double versement que la route evite a tout prix.
      stillPending += 1;
      warn('Reconciliation retrait impossible', {
        userId: item.userId, txId: item.tx?.id || null, payoutId: item.payoutId, error: error.message,
      });
    }
  }

  return { resolved, refunded, stillPending };
};

/** Nombre de retraits en attente de reconciliation (sante). */
export const countPendingWithdrawals = (listUserIds, getWallet) => {
  let total = 0;
  for (const userId of listUserIds()) {
    for (const tx of getWallet(userId)?.transactions || []) {
      if (tx?.type === 'withdraw' && tx.metadata?.payoutStatus === 'pending_review') total += 1;
    }
  }
  return total;
};
