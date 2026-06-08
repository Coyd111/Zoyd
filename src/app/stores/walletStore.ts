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
  lockFunds: (amount: number, matchId: string) => boolean;
  unlockFunds: (amount: number, matchId: string) => void;
  releaseWinnings: (
    amount: number,
    matchId: string,
    type?: Extract<TransactionType, 'prize_win' | 'arbitration_fee' | 'refund'>,
    description?: string
  ) => void;
  settleMatchLoss: (matchId: string, description?: string) => void;
  addBonus: (amount: number, reason: string) => void;
  deductEntryFee: (amount: number, matchId: string) => boolean;
  addTransaction: (tx: Omit<Transaction, 'id' | 'timestamp'>) => void;
  getTotalBalance: () => number;
  getAvailableCash: () => number;
  getAvailableToSpend: () => number;
}

const MIN_WITHDRAWAL_ZC = 15;
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
          const payload = await fetchWalletSnapshot();
          get().hydrateFromServer(payload.wallet);
          if (payload.user) {
            useAuthStore.getState().updateUser(payload.user);
          }
        },

        deposit: async (amount, method) => {
          const safeAmount = roundAmount(amount);
          const payload = await depositWalletBalance(safeAmount, method);
          get().hydrateFromServer(payload.wallet);
          if (payload.user) {
            useAuthStore.getState().updateUser(payload.user);
          }
          pushWalletNotification('Depot confirme', `${safeAmount.toFixed(1)} ZC ajoutes via ${method}.`);
        },

        withdraw: async (amount, method, phone) => {
          const safeAmount = roundAmount(amount);
          const payload = await withdrawWalletBalance(safeAmount, method, phone);
          get().hydrateFromServer(payload.wallet);
          if (payload.user) {
            useAuthStore.getState().updateUser(payload.user);
          }
          const netAmount = roundAmount(safeAmount - safeAmount * WITHDRAWAL_FEE_RATE);
          pushWalletNotification('Retrait confirme', `${netAmount.toFixed(1)} ZC net envoyes apres frais.`);
        },

        lockFunds: (amount, matchId) => {
          const safeAmount = roundAmount(amount);
          if (safeAmount > get().cashBalance) return false;

          const tx = buildTransaction({
            type: 'entry_fee',
            amount: -safeAmount,
            description: `Blocage cash pour ${matchId}`,
            status: 'completed',
            matchId,
          });

          set((state) => ({
            cashBalance: roundAmount(state.cashBalance - safeAmount),
            lockedBalance: roundAmount(state.lockedBalance + safeAmount),
            lockedEntries: {
              ...state.lockedEntries,
              [matchId]: {
                amount: safeAmount,
                cashAmount: safeAmount,
                bonusAmount: 0,
                lockedAt: new Date().toISOString(),
              },
            },
            transactions: [tx, ...state.transactions],
          }));
          syncAuthBalance();
          return true;
        },

        unlockFunds: (_amount, matchId) => {
          const reservation = get().lockedEntries[matchId];
          if (!reservation) return;

          const tx = buildTransaction({
            type: 'refund',
            amount: reservation.amount,
            description: `Remboursement du pass ${matchId}`,
            status: 'completed',
            matchId,
          });

          set((state) => {
            const nextLockedEntries = { ...state.lockedEntries };
            delete nextLockedEntries[matchId];

            return {
              cashBalance: roundAmount(state.cashBalance + reservation.cashAmount),
              bonusBalance: roundAmount(state.bonusBalance + reservation.bonusAmount),
              lockedBalance: roundAmount(Math.max(0, state.lockedBalance - reservation.amount)),
              lockedEntries: nextLockedEntries,
              transactions: [tx, ...state.transactions],
            };
          });
          syncAuthBalance();
          pushWalletNotification('Pass rembourse', `Le pass du match ${matchId} est revenu dans ton wallet.`);
        },

        releaseWinnings: (amount, matchId, type = 'prize_win', description) => {
          const reservation = get().lockedEntries[matchId];
          const releasedAmount = reservation?.amount ?? 0;
          const safeAmount = roundAmount(amount);
          const tx = buildTransaction({
            type,
            amount: safeAmount,
            description: description || (type === 'arbitration_fee' ? `Commission arbitre ${matchId}` : `Gain ${matchId}`),
            status: 'completed',
            matchId,
          });

          set((state) => {
            const nextLockedEntries = { ...state.lockedEntries };
            if (reservation) {
              delete nextLockedEntries[matchId];
            }

            return {
              cashBalance: roundAmount(state.cashBalance + safeAmount),
              lockedBalance: roundAmount(Math.max(0, state.lockedBalance - releasedAmount)),
              pendingWinnings: roundAmount(Math.max(0, state.pendingWinnings - safeAmount)),
              lockedEntries: nextLockedEntries,
              transactions: [tx, ...state.transactions],
            };
          });
          syncAuthBalance();

          if (safeAmount > 0) {
            pushWalletNotification(
              type === 'arbitration_fee' ? 'Commission recue' : 'Gain distribue',
              `${safeAmount.toFixed(1)} ZC credites pour ${matchId}.`
            );
          }
        },

        settleMatchLoss: (matchId, description) => {
          const reservation = get().lockedEntries[matchId];
          if (!reservation) return;

          const tx = buildTransaction({
            type: 'match_loss',
            amount: 0,
            description: description || `Pass consomme apres resultat ${matchId}`,
            status: 'completed',
            matchId,
            metadata: { lockedAmount: reservation.amount },
          });

          set((state) => {
            const nextLockedEntries = { ...state.lockedEntries };
            delete nextLockedEntries[matchId];

            return {
              lockedBalance: roundAmount(Math.max(0, state.lockedBalance - reservation.amount)),
              lockedEntries: nextLockedEntries,
              transactions: [tx, ...state.transactions],
            };
          });
          syncAuthBalance();
        },

        addBonus: (amount, reason) => {
          const safeAmount = roundAmount(amount);
          const tx = buildTransaction({
            type: 'bonus',
            amount: safeAmount,
            description: `Bonus: ${reason}`,
            status: 'completed',
          });

          set((state) => ({
            bonusBalance: roundAmount(state.bonusBalance + safeAmount),
            transactions: [tx, ...state.transactions],
          }));
          syncAuthBalance();
        },

        deductEntryFee: (amount, matchId) => {
          const safeAmount = roundAmount(amount);
          const available = get().getAvailableToSpend();
          if (safeAmount > available) return false;

          const bonusDeduct = Math.min(get().bonusBalance, safeAmount);
          const cashDeduct = roundAmount(safeAmount - bonusDeduct);
          const tx = buildTransaction({
            type: 'entry_fee',
            amount: -safeAmount,
            description: `Pass bloque pour ${matchId}`,
            status: 'completed',
            matchId,
            metadata: { cashDeduct, bonusDeduct },
          });

          set((state) => ({
            cashBalance: roundAmount(state.cashBalance - cashDeduct),
            bonusBalance: roundAmount(state.bonusBalance - bonusDeduct),
            lockedBalance: roundAmount(state.lockedBalance + safeAmount),
            lockedEntries: {
              ...state.lockedEntries,
              [matchId]: {
                amount: safeAmount,
                cashAmount: cashDeduct,
                bonusAmount: bonusDeduct,
                lockedAt: new Date().toISOString(),
              },
            },
            transactions: [tx, ...state.transactions],
          }));
          syncAuthBalance();
          pushWalletNotification('Pass bloque', `${safeAmount.toFixed(1)} ZC reserves pour ${matchId}.`);
          return true;
        },

        addTransaction: (txData) => {
          const tx = buildTransaction(txData);
          set((state) => ({ transactions: [tx, ...state.transactions] }));
        },

        getTotalBalance: () => {
          const { cashBalance, bonusBalance, lockedBalance, pendingWinnings } = get();
          return roundAmount(cashBalance + bonusBalance + lockedBalance + pendingWinnings);
        },

        getAvailableCash: () => roundAmount(get().cashBalance),

        getAvailableToSpend: () => roundAmount(get().cashBalance + get().bonusBalance),
      };
});
