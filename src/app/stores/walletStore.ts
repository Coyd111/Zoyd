import { create } from 'zustand';
import { depositWalletBalance, fetchWalletSnapshot, type WalletSnapshot, withdrawWalletBalance } from '../lib/walletApi';
import { useAuthStore } from './authStore';
import { useNotificationStore } from './notificationStore';

export type TransactionType =
  | 'deposit'
  | 'withdraw'
  | 'entry_fee'
  | 'prize_win'
  | 'refund'
  | 'arbitration_fee'
  | 'bonus'
  | 'referral'
  | 'penalty'
  | 'match_loss';

export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'cancelled' | 'frozen';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  description: string;
  status: TransactionStatus;
  timestamp: string;
  matchId?: string;
  tournamentId?: string;
  metadata?: Record<string, any>;
}

interface LockedEntry {
  amount: number;
  cashAmount: number;
  bonusAmount: number;
  lockedAt: string;
}

export interface WalletState {
  cashBalance: number;
  bonusBalance: number;
  lockedBalance: number;
  pendingWinnings: number;
  transactions: Transaction[];
  lockedEntries: Record<string, LockedEntry>;
  hydrateFromServer: (snapshot: WalletSnapshot) => void;
  refreshFromServer: () => Promise<void>;
  deposit: (amount: number, method: string) => Promise<void>;
  withdraw: (amount: number, method: string, phone: string) => Promise<void>;
  // TODO: lockFunds/unlockFunds are optimistic-UI helpers; they should be
  // driven by server confirmations via socket events in production.
  lockFunds: (amount: number, entryKey: string) => boolean;
  unlockFunds: (amount: number, entryKey: string) => void;
  addTransaction: (tx: Omit<Transaction, 'id' | 'timestamp'>) => void;
  getTotalBalance: () => number;
  getAvailableCash: () => number;
  getAvailableToSpend: () => number;
}

const MIN_WITHDRAWAL_ZC = 150;
const WITHDRAWAL_FEE_RATE = 0.02;

const roundAmount = (amount: number) => Math.round(amount * 100) / 100;

export const useWalletStore = create<WalletState>()((set, get) => {
      const syncAuthBalance = () => {
        const { user, updateUser } = useAuthStore.getState();
        if (!user) return;
        updateUser({ walletBalance: get().getAvailableToSpend() });
      };

      const pushWalletNotification = (title: string, message: string) => {
        useNotificationStore.getState().addNotification({
          type: 'wallet_update',
          title,
          message,
          priority: 'normal',
        });
      };

      const buildTransaction = (tx: Omit<Transaction, 'id' | 'timestamp'>): Transaction => ({
        ...tx,
        id: `TX-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
      });

      return {
        cashBalance: 0,
        bonusBalance: 0,
        lockedBalance: 0,
        pendingWinnings: 0,
        transactions: [],
        lockedEntries: {},

        hydrateFromServer: (snapshot) => {
          set(() => ({
            cashBalance: roundAmount(snapshot.cashBalance ?? 0),
            bonusBalance: roundAmount(snapshot.bonusBalance ?? 0),
            lockedBalance: roundAmount(snapshot.lockedBalance ?? 0),
            pendingWinnings: roundAmount(snapshot.pendingWinnings ?? 0),
            transactions: Array.isArray(snapshot.transactions) ? snapshot.transactions : [],
            lockedEntries: snapshot.lockedEntries || {},
          }));
          syncAuthBalance();
        },

        refreshFromServer: async () => {
          try {
            const payload = await fetchWalletSnapshot();
            get().hydrateFromServer(payload.wallet);
            if (payload.user) {
              useAuthStore.getState().updateUser(payload.user);
            }
          } catch {
            // silent
          }
        },

        deposit: async (amount, method) => {
          const safeAmount = roundAmount(amount);
          try {
            const payload = await depositWalletBalance(safeAmount, method);
            get().hydrateFromServer(payload.wallet);
            if (payload.user) {
              useAuthStore.getState().updateUser(payload.user);
            }
            pushWalletNotification('Depot confirme', `${safeAmount.toFixed(1)} ZC ajoutes via ${method}.`);
          } catch (err) {
            throw err;
          }
        },

        withdraw: async (amount, method, phone) => {
          const safeAmount = roundAmount(amount);
          try {
            const payload = await withdrawWalletBalance(safeAmount, method, phone);
            get().hydrateFromServer(payload.wallet);
            if (payload.user) {
              useAuthStore.getState().updateUser(payload.user);
            }
            const netAmount = roundAmount(safeAmount - safeAmount * WITHDRAWAL_FEE_RATE);
            pushWalletNotification('Retrait confirme', `${netAmount.toFixed(1)} ZC net envoyes apres frais.`);
          } catch (err) {
            throw err;
          }
        },

        addTransaction: (txData) => {
          const tx = buildTransaction(txData);
          set((state) => ({ transactions: [tx, ...state.transactions] }));
        },

        // Optimistic-UI: lock funds immediately while the server confirms.
        // On server confirmation, hydrateFromServer will overwrite this state.
        // Returns a revert function to roll back if server rejects.
        lockFunds: (amount, entryKey) => {
          const state = get();
          const safeAmount = roundAmount(amount);
          const available = roundAmount(state.cashBalance + state.bonusBalance);
          if (available < safeAmount) return false;

          const cashUsed = Math.min(state.cashBalance, safeAmount);
          const bonusUsed = roundAmount(safeAmount - cashUsed);
          const previousCash = state.cashBalance;
          const previousBonus = state.bonusBalance;
          const previousLocked = state.lockedBalance;
          const previousEntries = { ...state.lockedEntries };

          set((s) => ({
            cashBalance: roundAmount(s.cashBalance - cashUsed),
            bonusBalance: roundAmount(s.bonusBalance - bonusUsed),
            lockedBalance: roundAmount(s.lockedBalance + safeAmount),
            lockedEntries: {
              ...s.lockedEntries,
              [entryKey]: {
                amount: safeAmount,
                cashAmount: cashUsed,
                bonusAmount: bonusUsed,
                lockedAt: new Date().toISOString(),
              },
            },
          }));

          get().addTransaction({
            type: 'entry_fee',
            amount: -safeAmount,
            description: `Mise bloquee (${entryKey})`,
            status: 'completed',
          });

          return () => {
            set({
              cashBalance: previousCash,
              bonusBalance: previousBonus,
              lockedBalance: previousLocked,
              lockedEntries: previousEntries,
            });
          };
        },

        // Optimistic-UI: restore funds if registration is cancelled.
        unlockFunds: (amount, entryKey) => {
          const state = get();
          const reservation = state.lockedEntries[entryKey];
          if (!reservation) return;

          const cashToRefund = reservation.cashAmount ?? reservation.amount;
          const bonusToRefund = reservation.bonusAmount ?? 0;

          set((s) => {
            const { [entryKey]: _, ...rest } = s.lockedEntries;
            return {
              cashBalance: roundAmount(s.cashBalance + cashToRefund),
              bonusBalance: roundAmount(s.bonusBalance + bonusToRefund),
              lockedBalance: roundAmount(Math.max(0, s.lockedBalance - reservation.amount)),
              lockedEntries: rest,
            };
          });

          get().addTransaction({
            type: 'refund',
            amount: roundAmount(reservation.amount),
            description: `Mise debloquee (${entryKey})`,
            status: 'completed',
          });
        },

        getTotalBalance: () => {
          const { cashBalance, bonusBalance, lockedBalance, pendingWinnings } = get();
          return roundAmount(cashBalance + bonusBalance + lockedBalance + pendingWinnings);
        },

        getAvailableCash: () => roundAmount(get().cashBalance),

        getAvailableToSpend: () => roundAmount(get().cashBalance + get().bonusBalance),
      };
});
