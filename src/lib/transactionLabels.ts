/**
 * transactionLabels - libelles FR des types de transaction.
 *
 * Source unique partagee : WalletPage (historique) et EarningsDashboard
 * (liste des derniers mouvements) affichaient CHACUN leur table — la page
 * gains montrait les types bruts anglais (`payout`, `deposit`...) la ou le
 * wallet traduisait deja (P13 C16, audit-3).
 *
 * INVARIANT : le fallback est le type BRUT : un type serveur inconnu doit
 * rester visible (débogable), jamais masque par un libelle mensonger.
 * Les nouveaux types cote serveur (wallet-engine) DOIVENT avoir leur entree
 * ici, sinon ils s'affichent bruts au joueur.
 */

const TYPE_LABELS: Record<string, string> = {
  deposit: 'Ajout',
  withdraw: 'Retrait',
  prize_win: 'Gain',
  entry_fee: 'Pass',
  refund: 'Remboursement',
  bonus: 'Bonus',
  arbitration_fee: 'Arbitrage',
  match_loss: 'Partie',
  debit: 'Débit',
  penalty: 'Pénalité',
  referral: 'Parrainage',
};

export const getTransactionTypeLabel = (type: string): string =>
  TYPE_LABELS[type] || type;
