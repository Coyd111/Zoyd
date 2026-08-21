import crypto from 'node:crypto';
import { getWalletSnapshot, updateWalletSnapshot } from './persistence.mjs';

const MIN_WITHDRAWAL_ZC = 150;
const WITHDRAWAL_FEE_RATE = 0.02;
const roundAmount = (amount) => Math.round(Number(amount || 0) * 100) / 100;
const getNow = () => new Date().toISOString();
const makeError = (code, message) => Object.assign(new Error(message), { code });

const buildTransaction = (tx) => ({
  ...tx,
  id: `TX-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
  timestamp: getNow(),
});

const withTransaction = (wallet, tx) => ({
  ...wallet,
  transactions: [buildTransaction(tx), ...(Array.isArray(wallet.transactions) ? wallet.transactions : [])].slice(0, 200),
});

export const getServerWallet = (userId) => getWalletSnapshot(userId);

export const depositToWallet = (userId, amount, method = 'Mobile Money') => {
  const safeAmount = roundAmount(amount);
  if (safeAmount <= 0) {
    throw makeError('INVALID_AMOUNT', 'Le montant du depot est invalide.');
  }

  return updateWalletSnapshot(userId, (wallet) =>
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
  ).wallet;
};

export const withdrawFromWallet = (userId, amount, method = 'Mobile Money', phone = '') => {
  const safeAmount = roundAmount(amount);
  if (safeAmount < MIN_WITHDRAWAL_ZC) {
    throw makeError('WITHDRAWAL_MIN', `Retrait minimum: ${MIN_WITHDRAWAL_ZC} ZC.`);
  }

  return updateWalletSnapshot(userId, (wallet) => {
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
  }).wallet;
};

export const lockEntryFee = (userId, amount, matchId) => {
  const safeAmount = roundAmount(amount);

  return updateWalletSnapshot(userId, (wallet) => {
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
  }).wallet;
};

export const refundLockedEntry = (userId, matchId, description) =>
  updateWalletSnapshot(userId, (wallet) => {
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
  }).wallet;

export const settleMatchLossWallet = (userId, matchId, description) =>
  updateWalletSnapshot(userId, (wallet) => {
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
  }).wallet;

export const releaseWalletWinnings = (userId, amount, matchId, type = 'prize_win', description) =>
  updateWalletSnapshot(userId, (wallet) => {
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
  }).wallet;

export const debitFromWallet = (userId, amount, description = 'Debit') => {
  const safeAmount = roundAmount(amount);
  if (safeAmount <= 0) {
    throw makeError('INVALID_AMOUNT', 'Le montant du debit est invalide.');
  }

  return updateWalletSnapshot(userId, (wallet) => {
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
  }).wallet;
};
