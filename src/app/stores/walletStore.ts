import { create } from 'zustand';
import { depositWalletBalance, fetchWalletSnapshot, type WalletSnapshot, type WithdrawalPolicy, withdrawWalletBalance } from '../lib/walletApi';
import { useAuthStore } from './authStore';
import { useNotificationStore } from './notificationStore';
import { roundAmount, formatZC } from '../../lib/utils';

let lockFundsInFlight = false;

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
  metadata?: Record<string, unknown>;
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
  /**
   * Politique de retrait publiee par le serveur. `hydrateFromServer` ne la
   * reçoit pas (elle ne voit que le snapshot) : c'est `fetchWalletSnapshot`
   * qui l'applique via `applyWithdrawalPolicy`.
   */
  withdrawalFeeRate: number;
  withdrawalMinAmount: number;
  applyWithdrawalPolicy: (policy?: WithdrawalPolicy) => void;
  hydrateFromServer: (snapshot: WalletSnapshot) => void;
  refreshFromServer: (expectedUserId?: string) => Promise<void>;
  deposit: (amount: number, method: string) => Promise<void>;
  withdraw: (amount: number, method: string, phone: string, country?: string) => Promise<void>;
  // TODO: lockFunds/unlockFunds are optimistic-UI helpers; they should be
  // driven by server confirmations via socket events in production.
  // lockFunds returns a revert function on success, false when funds are insufficient.
  lockFunds: (amount: number, entryKey: string) => false | (() => void);
  unlockFunds: (amount: number, entryKey: string) => void;
  addTransaction: (tx: Omit<Transaction, 'id' | 'timestamp'>) => void;
  getTotalBalance: () => number;
  getAvailableCash: () => number;
  getAvailableToSpend: () => number;
}

/**
 * Valeurs de repli, uniquement avant la premiere reponse du serveur.
 *
 * Le taux et le minimum sont publies par le serveur dans `/api/wallet/me`
 * (`withdrawal`) : les coder ici faisait diverger l'affichage du montant
 * reellement verse. Ces constantes ne servent qu'a ne pas afficher un
 * pourcentage faux pendant la premiere seconde de chargement.
 */
const MIN_WITHDRAWAL_ZC = 150;
const FALLBACK_WITHDRAWAL_FEE_RATE = 0.02;

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
        withdrawalFeeRate: FALLBACK_WITHDRAWAL_FEE_RATE,
        withdrawalMinAmount: MIN_WITHDRAWAL_ZC,

        applyWithdrawalPolicy: (policy) => {
          if (!policy) return;
          set(() => ({
            withdrawalFeeRate: Number.isFinite(policy.feeRate) ? policy.feeRate : FALLBACK_WITHDRAWAL_FEE_RATE,
            withdrawalMinAmount: Number.isFinite(policy.minAmount) ? policy.minAmount : MIN_WITHDRAWAL_ZC,
          }));
        },

        hydrateFromServer: (snapshot) => {
          set(() => ({
            cashBalance: roundAmount(snapshot.cashBalance ?? 0),
            bonusBalance: roundAmount(snapshot.bonusBalance ?? 0),
            lockedBalance: roundAmount(snapshot.lockedBalance ?? 0),
            pendingWinnings: roundAmount(snapshot.pendingWinnings ?? 0),
            // Le serveur envoie `created_at`, le store utilise `timestamp`.
            // On liste les champs explicitement (pas de `...tx`) : le spread
            // laissait fuiter `created_at` hors du type `Transaction`.
            transactions: Array.isArray(snapshot.transactions)
              ? snapshot.transactions.map((tx) => ({
                  id: tx.id,
                  type: tx.type,
                  amount: tx.amount,
                  // `Transaction.description` est requis alors que le serveur
                  // l'envoie parfois absent : on normalise plutôt que de
                  // laisser `undefined` dans l'UI.
                  description: tx.description ?? '',
                  status: tx.status,
                  metadata: tx.metadata,
                  timestamp: tx.created_at || new Date().toISOString(),
                }))
              : [],
            // Le serveur rend `cashAmount`/`bonusAmount` optionnels (une passe
            // payée en bonus n'a pas de part cash) alors que le store les
            // exige : sans normalisation, `cashAmount` restait undefined et
            // les calculs de solde disponible continuaient de passer par
            // `|| 0`. On materialise les zéros une fois pour toutes.
            lockedEntries: Object.fromEntries(
              Object.entries(snapshot.lockedEntries || {}).map(([key, entry]) => [
                key,
                {
                  amount: entry.amount,
                  cashAmount: entry.cashAmount ?? 0,
                  bonusAmount: entry.bonusAmount ?? 0,
                  lockedAt: entry.lockedAt,
                },
              ])
            ),
          }));
          syncAuthBalance();
        },

        refreshFromServer: async (expectedUserId) => {
          // Ne swallow PAS l'erreur : le bootstrap en dépend pour savoir s'il
          // doit retenter. Avaler ici affichait 0 ZC alors que le serveur en
          // avait (le joueur croyait son portefeuille vidé).
          const payload = await fetchWalletSnapshot();
          // Garde-fou multi-compte : la réponse peut arriver APRÈS un logout
          // suivi d'une autre connexion (timeout 30s). Sans ce contrôle, le
          // wallet ET le profil du compte précédent s'écrivaient dans le store
          // du nouveau compte → solde et historique d'un autre joueur visibles.
          if (expectedUserId && useAuthStore.getState().user?.id !== expectedUserId) {
            return;
          }
          get().hydrateFromServer(payload.wallet);
          // Politique de retrait : sans cela, le store garde le taux de repli
          // et l'UI peut afficher un pourcentage different du serveur.
          get().applyWithdrawalPolicy(payload.withdrawal);
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
          pushWalletNotification('Depot confirme', `${formatZC(safeAmount)} ajoutées via ${method}.`);
        },

        withdraw: async (amount, method, phone, country) => {
          const safeAmount = roundAmount(amount);
          if (safeAmount < get().withdrawalMinAmount) {
            throw new Error(`Retrait minimum: ${get().withdrawalMinAmount} ZC.`);
          }
          const payload = await withdrawWalletBalance(safeAmount, method, phone, country);
          get().hydrateFromServer(payload.wallet);
          get().applyWithdrawalPolicy(payload.withdrawal);
          if (payload.user) {
            useAuthStore.getState().updateUser(payload.user);
          }
          // Le net vient du serveur : le recalculer ici pouvait afficher un
          // montant different de celui reellement verse par FedaPay.
          const netAmount = Number.isFinite(payload.netAmount)
            ? Number(payload.netAmount)
            : roundAmount(safeAmount - safeAmount * get().withdrawalFeeRate);
          const feeAmount = Number.isFinite(payload.feeAmount) ? Number(payload.feeAmount) : null;
          pushWalletNotification(
            'Retrait confirme',
            feeAmount !== null
              ? `${formatZC(netAmount)} nets après ${formatZC(feeAmount)} de frais.`
              : `${formatZC(netAmount)} net envoyés après frais.`,
          );
        },

        addTransaction: (txData) => {
          const tx = buildTransaction(txData);
          set((state) => {
            const next = [tx, ...state.transactions];
            return { transactions: next.length > 100 ? next.slice(0, 100) : next };
          });
        },

        // Optimistic-UI: lock funds immediately while the server confirms.
        // On server confirmation, hydrateFromServer will overwrite this state.
        // Returns a revert function to roll back if server rejects.
        lockFunds: (amount, entryKey) => {
          if (lockFundsInFlight) return false;
          lockFundsInFlight = true;
          try {
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
              description: `Mise bloquée (${entryKey})`,
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
          } finally {
            lockFundsInFlight = false;
          }
        },

        // Optimistic-UI: restore funds if registration is cancelled.
        // Note: amount is informational — the reservation stored in lockedEntries is authoritative.
        unlockFunds: (_amount, entryKey) => {
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
            description: `Mise debloquée (${entryKey})`,
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
