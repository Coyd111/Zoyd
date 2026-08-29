import crypto from 'node:crypto';
import { getWalletSnapshot, updateWalletSnapshot } from './persistence.mjs';

const MIN_WITHDRAWAL_ZC = 150;
const WITHDRAWAL_FEE_RATE = 0.02;
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
export const depositToWallet = async (userId, amount, method = 'Mobile Money') => {
  const safeAmount = roundAmount(amount);
  if (safeAmount <= 0) {
    throw makeError('INVALID_AMOUNT', 'Le montant du depot est invalide.');
  }

  return (await updateWalletSnapshot(userId, (wallet) =>
    withTransaction(
      {
        ...wallet,
        cashBalance: roundAmount(wallet.cashBalance + safeAmount),
      },
      {
        type: 'deposit',
        amount: safeAmount,
        description: `Depot ZC via ${method}`,
        status: 'completed',
        metadata: { method },
      }
    )
  )).wallet;
};

/**
 * Withdraw funds from a user's cash balance (minimum 150 ZC, 2% fee).
 * @param {string} userId - ID of the user.
 * @param {number} amount - Amount to withdraw in ZC.
 * @param {string} [method] - Withdrawal method (e.g. 'Mobile Money').
 * @param {string} [phone] - Phone number for mobile money transfer.
 * @returns {Promise<Object>} Updated wallet snapshot.
 */
export const withdrawFromWallet = async (userId, amount, method = 'Mobile Money', phone = '') => {
  const safeAmount = roundAmount(amount);
  if (safeAmount < MIN_WITHDRAWAL_ZC) {
    throw makeError('WITHDRAWAL_MIN', `Retrait minimum: ${MIN_WITHDRAWAL_ZC} ZC.`);
  }

  return (await updateWalletSnapshot(userId, (wallet) => {
    if (safeAmount > wallet.cashBalance) {
      throw makeError('INSUFFICIENT_FUNDS', 'Solde cash insuffisant pour ce retrait.');
    }

    const feeAmount = roundAmount(safeAmount * WITHDRAWAL_FEE_RATE);
    const netAmount = roundAmount(safeAmount - feeAmount);

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
        metadata: { method, phone, feeAmount, netAmount },
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
        amount: 0,
        description: description || `Pass consomme apres resultat ${matchId}`,
        status: 'completed',
        matchId,
        metadata: { lockedAmount: reservation.amount },
      }
    );
  })).wallet;

/**
 * Release winnings (prize or arbiter fee) into the user's cash balance.
 * Also unlocks any associated entry fee reservation for the match.
 * @param {string} userId - ID of the user.
 * @param {number} amount - Amount to release.
 * @param {string} matchId - ID of the match or tournament.
 * @param {string} [type] - Transaction type ('prize_win' or 'arbitration_fee').
 * @param {string} [description] - Transaction description.
 * @returns {Promise<Object>} Updated wallet snapshot.
 */
export const releaseWalletWinnings = async (userId, amount, matchId, type = 'prize_win', description) => {
  const safeAmount = roundAmount(amount);
  if (safeAmount < 0) {
    throw makeError('INVALID_AMOUNT', 'Le montant des gains ne peut pas etre negatif.');
  }
  return (await updateWalletSnapshot(userId, (wallet) => {
    const reservation = wallet.lockedEntries?.[matchId];
    const releasedAmount = reservation?.amount ?? 0;
    const nextLockedEntries = { ...wallet.lockedEntries };
    if (reservation) {
      delete nextLockedEntries[matchId];
    }

    return withTransaction(
      {
        ...wallet,
        cashBalance: roundAmount(wallet.cashBalance + roundAmount(amount)),
        lockedBalance: roundAmount(Math.max(0, wallet.lockedBalance - releasedAmount)),
        lockedEntries: nextLockedEntries,
      },
      {
        type,
        amount: roundAmount(amount),
        description: description || (type === 'arbitration_fee' ? `Commission arbitre ${matchId}` : `Gain ${matchId}`),
        status: 'completed',
        matchId,
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
