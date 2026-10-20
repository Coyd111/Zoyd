/**
 * walletStore - soldes, transactions et politique de retrait du joueur.
 *
 * Detient cashBalance, bonusBalance, lockedBalance, pendingWinnings,
 * l'historique des transactions et les entrees bloquees. Expose le depot et
 * le retrait, qui passent par l'API.
 *
 * INVARIANT : toute ecriture passe par l'API (depositWalletBalance,
 * withdrawWalletBalance, fetchWalletSnapshot). Ne jamais ecrire le solde en
 * local en esperant que le serveur suive : le serveur est seul juge de
 * l'argent, et le socket peut corriger l'ecran a tout moment.
 * INVARIANT : applyRemoteWallet ne touche QUE les soldes. L'evenement
 * `wallet:update` ne contient pas les transactions : les remplacer par une
 * liste vide ferait disparaitre l'historique a chaque gain.
 * PIEGE : refreshFromServer passe l'userId attendu. Sans ce garde, une
 * reponse arrivee apres un logout + reconnexion ecrirait le wallet ET le
 * profil du compte precedent chez le nouveau joueur.
 * PIEGE : le taux de frais et le minimum de retrait sont PUBLIES par le
 * serveur. Les constantes locales ne servent qu'a la premiere seconde de
 * chargement : ne pas les coder en dur comme une source de verite.
 *
 * Voir aussi : docs/08-frontend.md - section 6 (Les stores Zustand)
 */
import { create } from 'zustand';
import { depositWalletBalance, fetchWalletSnapshot, type WalletSnapshot, type WithdrawalPolicy, withdrawWalletBalance } from '../lib/walletApi';
import { useAuthStore } from './authStore';
import { useNotificationStore } from './notificationStore';
import { roundAmount, formatZC } from '../../lib/utils';

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
  /**
   * Applique un portefeuille venu du serveur en temps réel (`wallet:update`).
   *
   * Distingué de `hydrateFromServer` : on ne touche QUE les soldes. Les
   * transactions ne sont pas dans l'événement, et les remplacer par une liste
   * vide ferait disparaître l'historique à chaque gain. Elles se rechargent
   * par `fetchWalletSnapshot` quand l'utilisateur ouvre son portefeuille.
   */
  applyRemoteWallet: (wallet: Partial<Pick<WalletState, 'cashBalance' | 'bonusBalance' | 'lockedBalance' | 'pendingWinnings'>>) => void;
  refreshFromServer: (expectedUserId?: string) => Promise<void>;
  deposit: (amount: number, method: string) => Promise<void>;
  withdraw: (amount: number, method: string, phone: string, country?: string) => Promise<void>;
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
            pendingWinnings: roundAmount(snapshot.pendingWinnings ?? 0),            // Le serveur envoie `created_at`, le store utilise `timestamp`.
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
                  // Le serveur écrit `timestamp` (wallet-engine.buildTransaction). Lire
              // `created_at` — inexistant — faisait retomber sur
              // `new Date()` : TOUTES les transactions affichaient « à
              // l'instant », quel que soit leur âge. `created_at` reste
              // accepté pour les lignes plus anciennes.
              timestamp: tx.timestamp || tx.created_at || '',
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

        applyRemoteWallet: (wallet) => {
          if (!wallet) return;
          set(() => ({
            cashBalance: roundAmount(wallet.cashBalance ?? 0),
            bonusBalance: roundAmount(wallet.bonusBalance ?? 0),
            lockedBalance: roundAmount(wallet.lockedBalance ?? 0),
            pendingWinnings: roundAmount(wallet.pendingWinnings ?? 0),
          }));
          // Le bandeau de la navbar lit `walletBalance` sur le store d'auth :
          // sans cette synchro, l'en-tête afficherait encore l'ancien total
          // alors que la page portefeuille est deja a jour.
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
          const feeRatePercent = Math.round(get().withdrawalFeeRate * 10000) / 100;
          // Mention explicite des frais FedaPay : le net annonce est ce que
          // ZOYD envoie a FedaPay, pas necessairement ce qui est credite sur
          // le numero du joueur (FedaPay preleve son propre taux par-dessus).
          const fedapayNote = 'FedaPay preleve encore ses propres frais de transfert, qui ne reviennent pas a ZOYD : le montant credite peut etre inferieur.';
          pushWalletNotification(
            'Retrait envoye a FedaPay',
            feeAmount !== null
              ? `${formatZC(netAmount)} nets apres ${formatZC(feeAmount)} de commission ZOYD (${feeRatePercent} %). ${fedapayNote}`
              : `${formatZC(netAmount)} nets apres la commission ZOYD. ${fedapayNote}`,
          );
        },

        addTransaction: (txData) => {
          const tx = buildTransaction(txData);
          set((state) => {
            const next = [tx, ...state.transactions];
            return { transactions: next.length > 100 ? next.slice(0, 100) : next };
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
