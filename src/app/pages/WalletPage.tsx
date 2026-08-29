import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { useWalletStore } from '../stores/walletStore';
import { useAuthStore } from '../stores/authStore';
import { useSocketStore } from '../stores/socketStore';
import { Skeleton } from '../components/ui/Skeleton';
import { getFundingPromptCopy, parseFundingPrompt } from '../../lib/walletFunding';
import { formatZC, formatFCFA, getRelativeTime } from '../../lib/utils';
import { ArrowDownToLine, ArrowUpFromLine, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { verifyFedaPayTransaction } from '../lib/walletApi';
import { Helmet } from 'react-helmet-async';

const MIN_WITHDRAWAL_ZC = 150;

declare const FedaPay: {
  checkout: (config: {
    public_key: string;
    transaction: { amount: number; description: string; currency: { code: string } };
    onComplete: (resp: { data?: { token: string } }) => void;
    onClose: () => void;
  }) => void;
} | undefined;

const WalletPage: React.FC = () => {
  const transactions = useWalletStore((s) => s.transactions);
  const deposit = useWalletStore((s) => s.deposit);
  const withdraw = useWalletStore((s) => s.withdraw);
  const cashBalance = useWalletStore((s) => s.cashBalance);
  const bonusBalance = useWalletStore((s) => s.bonusBalance);
  const lockedBalance = useWalletStore((s) => s.lockedBalance);
  const pendingWinnings = useWalletStore((s) => s.pendingWinnings);
  const getAvailableToSpend = useWalletStore((s) => s.getAvailableToSpend);
  const { user } = useAuthStore();
  const bootstrapReady = useSocketStore((s) => s.bootstrapReady);

  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [selectedOperator, setSelectedOperator] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [filter, setFilter] = useState<'all' | 'deposit' | 'withdraw' | 'prize_win'>('all');
  const [fundingPrefillKey, setFundingPrefillKey] = useState('');
  const [searchParams] = useSearchParams();

  const operators = [
    { id: 'MTN MoMo', name: 'MTN MoMo', colorClass: 'bg-[#FFCC00]' },
    { id: 'Moov Money', name: 'Moov Money', colorClass: 'bg-[#009EE2]' },
    { id: 'Orange Money', name: 'Orange Money', colorClass: 'bg-[#FF7900]' },
  ];

  const presetAmounts = [50, 100, 200, 500];
  const spendableBalance = getAvailableToSpend();
  const fundingPrompt = useMemo(() => parseFundingPrompt(searchParams), [searchParams]);
  const fundingCopy = fundingPrompt ? getFundingPromptCopy(fundingPrompt.context) : null;
  const canResumeFundingFlow =
    !!fundingPrompt?.returnTo && spendableBalance >= fundingPrompt.requiredAmount;
  const fundingKey = fundingPrompt
    ? `${fundingPrompt.context}:${fundingPrompt.requiredAmount}:${fundingPrompt.neededAmount}:${fundingPrompt.returnTo || ''}`
    : '';

  useEffect(() => {
    if (fundingPrompt) {
      setShowDepositModal(true);
    }
  }, [fundingPrompt]);

  useEffect(() => {
    if (fundingPrompt && fundingKey !== fundingPrefillKey) {
      setDepositAmount(fundingPrompt.neededAmount.toString());
      setFundingPrefillKey(fundingKey);
    }
  }, [fundingKey, fundingPrefillKey, fundingPrompt]);

  const filteredTransactions = useMemo(() => {
    if (filter === 'all') return transactions;
    return transactions.filter((transaction) => transaction.type === filter);
  }, [filter, transactions]);

  const handleDeposit = async () => {
    if (!depositAmount) return;
    const depositAmountNum = parseFloat(depositAmount);
    if (isNaN(depositAmountNum) || depositAmountNum <= 0) return;
    const amountFCFA = depositAmountNum * 10; // 1 ZC = 10 FCFA

    const publicKey = import.meta.env.VITE_FEDAPAY_PUBLIC_KEY;
    
    if (!publicKey) {
      toast.error("La clé FedaPay (VITE_FEDAPAY_PUBLIC_KEY) est manquante dans l'environnement local.");
      return;
    }

    // Check if FedaPay is loaded
    if (typeof FedaPay === 'undefined') {
      toast.error("Le service de paiement FedaPay n'est pas disponible. Recharge la page ou essaie plus tard.");
      return;
    }

    // Using FedaPay Widget
    FedaPay.checkout({
      public_key: publicKey,
      transaction: {
        amount: amountFCFA,
        description: `Recharge de ${depositAmountNum} ZC (~ ${amountFCFA} FCFA)`,
      },
      customer: {
        email: user?.email || 'joueur@zoyd.app',
        lastname: user?.pseudo || 'Joueur ZOYD'
      },
      onComplete: async (resp: { reason?: string; transaction?: { id: number | string } }) => {
        if (resp.reason === 'CHECKOUT COMPLETE') {
          if (!resp.transaction?.id) {
            toast.error('Transaction invalide.');
            return;
          }
          toast.loading('Verification de la transaction...');
          try {
            const result = await verifyFedaPayTransaction(resp.transaction.id);
            toast.dismiss();
            if (result.ok) {
              toast.success(`${formatZC(result.amount || 0)} ajoutes dans ton wallet.`);
              // Update local state using hydrateFromServer
              useWalletStore.getState().hydrateFromServer(result.wallet);
            } else {
              toast.error('Erreur lors de la verification.');
            }
          } catch (err) {
            toast.dismiss();
            toast.error(err instanceof Error ? err.message : 'Erreur lors de la verification de la transaction FedaPay.');
          }
        } else {
          toast.error('Transaction annulee ou echouee.');
        }
        setShowDepositModal(false);
        setDepositAmount('');
        setSelectedOperator('');
      }
    });
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount || !user) return;
    try {
      const withdrawAmountNum = parseFloat(withdrawAmount);
      if (isNaN(withdrawAmountNum) || withdrawAmountNum <= 0) return;
      await withdraw(withdrawAmountNum, 'Mobile Money', user.phone || '');
      toast.success(`Retrait lance pour ${formatZC(withdrawAmountNum)}.`);
      setShowWithdrawModal(false);
      setWithdrawAmount('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur de retrait.');
    }
  };

  return (
    <div className="min-h-dvh bg-zoyd-black text-white font-ui scanline p-4 md:p-8 safe-top safe-bottom">
      <Helmet>
        <title>Portefeuille — ZOYD</title>
        <meta name="description" content="Gère tes dépôts, retraits et transactions ZC." />
      </Helmet>
      <div className="max-w-6xl mx-auto">
            <div className="relative mb-8 p-5 sm:p-6 md:p-8 border border-white/5 bg-zoyd-surface/20 overflow-hidden">
          <div className="absolute inset-0 z-0">
            <img src="/assets/images/codm-8.jpg" alt="" loading="lazy" className="w-full h-full object-cover opacity-20 mix-blend-luminosity grayscale pointer-events-none" />
            <img src="/assets/images/codm-1.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-overlay grayscale pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-r from-zoyd-black via-zoyd-black/80 to-transparent" />
            <div className="absolute inset-0 tactical-grid opacity-10" />
          </div>
          <div className="relative z-10">
            <h1 className="text-2xl sm:text-3xl md:text-5xl font-display font-black text-white italic uppercase tracking-tighter mb-2">
              LE COFFRE-FORT <span className="text-zoyd-yellow">(WALLET)</span>
            </h1>
            <p className="text-white/60 max-w-xl">Recharge via Mobile Money, verrouille tes wagers et retire tes gains de maniere securisee.</p>
          </div>
        </div>

        {!bootstrapReady ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-28 bg-white/5" />
              ))}
            </div>
            <Skeleton className="h-96 bg-white/5" />
          </div>
        ) : fundingPrompt && fundingCopy ? (
          <div
            className={`mb-8 border p-5 ${
              canResumeFundingFlow
                ? 'border-green-400/20 bg-green-400/5'
                : 'border-zoyd-yellow/20 bg-zoyd-yellow/5'
            }`}
          >
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
              <div className="space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-widest text-zoyd-yellow">
                  Financer ton inscription
                </div>
                <h2 className="text-xl font-display font-black italic text-white">{fundingCopy.title}</h2>
                <p className="text-sm text-white/60 max-w-2xl">{fundingCopy.body}</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3 min-w-full lg:min-w-[360px]">
                <FundingMetric label="Pass demande" value={formatZC(fundingPrompt.requiredAmount)} />
                <FundingMetric
                  label={canResumeFundingFlow ? 'Solde pret' : 'A ajouter maintenant'}
                  value={formatZC(canResumeFundingFlow ? 0 : fundingPrompt.neededAmount)}
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              {!canResumeFundingFlow ? (
                <Button variant="primary" onClick={() => setShowDepositModal(true)} aria-label="Ajouter les ZC nécessaires">
                  <ArrowDownToLine className="w-5 h-5" />
                  AJOUTER LES ZC
                </Button>
              ) : null}

              {canResumeFundingFlow && fundingPrompt.returnTo ? (
                <Link
                  to={fundingPrompt.returnTo}
                  aria-label={fundingCopy.returnLabel}
                  className="inline-flex items-center justify-center gap-2 bg-white text-black px-5 py-3 text-sm font-display font-black tracking-widest uppercase italic hover:bg-zoyd-yellow transition-colors"
                >
                  {fundingCopy.returnLabel}
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="grid md:grid-cols-4 gap-6 mb-8">
          <BalanceCard label="Solde dispo" value={formatZC(spendableBalance)} hint={`~ ${formatFCFA(spendableBalance)}`} accent />
          <BalanceCard label="Cash retirable" value={formatZC(cashBalance)} hint="Pret au retrait" />
          <BalanceCard label="En jeu" value={formatZC(lockedBalance)} hint="Parties et tournois en cours" />
          <BalanceCard label="Bonus ZC" value={formatZC(bonusBalance)} hint="Utilisable, non retirable" />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <Button variant="primary" size="lg" fullWidth onClick={() => setShowDepositModal(true)} aria-label="Effectuer un dépôt Mobile Money">
            <ArrowDownToLine className="w-5 h-5" />
            DÉPÔT MOBILE MONEY (AJOUTER DES ZC)
          </Button>
          <Button variant="secondary" size="lg" fullWidth onClick={() => setShowWithdrawModal(true)} aria-label="Retirer mes gains">
            <ArrowUpFromLine className="w-5 h-5" />
            RETIRER MES GAINS
          </Button>
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>En un coup d'oeil</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-4 text-sm">
              <div className="border border-white/5 p-4 bg-black/40">
                <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">Gains en attente</div>
                <div className="text-2xl font-display font-black text-white">{formatZC(pendingWinnings)}</div>
              </div>
              <div className="border border-white/5 p-4 bg-black/40">
                <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">Frais de retrait</div>
                <div className="text-2xl font-display font-black text-zoyd-yellow">2%</div>
              </div>
              <div className="border border-white/5 p-4 bg-black/40">
                <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">Retrait minimum</div>
                <div className="text-2xl font-display font-black text-white">150 ZC</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <CardTitle>Historique de ton solde</CardTitle>
              <div className="flex flex-wrap gap-2">
                <WalletFilter active={filter === 'all'} onClick={() => setFilter('all')} label="TOUS" />
                <WalletFilter active={filter === 'deposit'} onClick={() => setFilter('deposit')} label="AJOUTS" />
                <WalletFilter active={filter === 'withdraw'} onClick={() => setFilter('withdraw')} label="RETRAITS" />
                <WalletFilter active={filter === 'prize_win'} onClick={() => setFilter('prize_win')} label="GAINS" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {filteredTransactions.length > 0 ? (
                filteredTransactions.map((transaction) => (
                  <TransactionRow key={transaction.id} {...transaction} />
                ))
              ) : (
                <div className="py-12 text-center relative overflow-hidden">
                  <div className="absolute inset-0 opacity-[0.04]">
                    <img src="/assets/images/codm-3.jpg" alt="" loading="lazy" className="w-full h-full object-cover" />
                  </div>
                  <Clock className="relative w-12 h-12 text-white/10 mx-auto mb-4" />
                  <p className="relative text-white/40 font-mono text-sm uppercase tracking-widest">Ton solde n'a pas encore bouge</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Modal isOpen={showDepositModal} onClose={() => setShowDepositModal(false)} title="Ajouter des ZC" size="md">
          <div className="space-y-6">
            <div>
              <label htmlFor="deposit-amount" className="block text-sm font-medium text-white mb-3">Montant a ajouter</label>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {presetAmounts.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setDepositAmount(preset.toString())}
                      aria-label={`Ajouter ${preset} ZC`}
                      className="px-4 py-3 touch-target bg-white/5 border border-white/10 hover:border-zoyd-yellow text-zoyd-yellow font-display font-bold transition-all"
                  >
                    {preset} ZC
                  </button>
                ))}
              </div>
              <Input id="deposit-amount" type="number" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} placeholder="Montant personnalisé" />
            </div>

            <div>
              <label htmlFor="operator-select" className="block text-sm font-medium text-white mb-3">Operateur Mobile Money</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {operators.map((operator) => (
                    <button
                      key={operator.id}
                      onClick={() => setSelectedOperator(operator.id)}
                      aria-label={`Payer avec ${operator.name}`}
                      className={`p-4 touch-target border transition-all ${
                      selectedOperator === operator.id
                        ? 'border-zoyd-yellow bg-white/10'
                        : 'border-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className={`w-12 h-12 mx-auto mb-2 ${operator.colorClass}`} />
                    <p className="text-xs font-display font-semibold text-white text-center">{operator.name}</p>
                  </button>
                ))}
              </div>
            </div>

            <Button variant="primary" fullWidth onClick={handleDeposit} disabled={!selectedOperator || !depositAmount} aria-label="Confirmer le dépôt">
              Ajouter ces ZC
            </Button>
          </div>
        </Modal>

        <Modal isOpen={showWithdrawModal} onClose={() => setShowWithdrawModal(false)} title="Retirer mes ZC" size="md">
          <div className="space-y-6">
            <div>
              <label htmlFor="withdraw-amount" className="block text-sm font-medium text-white mb-3">Montant a retirer</label>
              <Input
                id="withdraw-amount"
                type="number"
                value={withdrawAmount}
                onChange={(event) => setWithdrawAmount(event.target.value)}
                placeholder={`${MIN_WITHDRAWAL_ZC} ZC minimum (${MIN_WITHDRAWAL_ZC * 10} FCFA)`}
                max={cashBalance}
              />
              <p className="text-xs text-white/60 mt-2">Un retrait prend 2% de frais et sort de ton solde retirable.</p>
            </div>

            <Button
              variant="primary"
              fullWidth
              onClick={handleWithdraw}
              disabled={!withdrawAmount || parseFloat(withdrawAmount) < MIN_WITHDRAWAL_ZC || parseFloat(withdrawAmount) > cashBalance}
              aria-label="Confirmer le retrait"
            >
              Retirer mes gains
            </Button>
          </div>
        </Modal>
      </div>
    </div>
  );
};

const BalanceCard = React.memo(({ label, value, hint, accent = false }: { label: string; value: string; hint: string; accent?: boolean }) => (
  <Card className={accent ? 'bg-gradient-to-br from-zoyd-yellow/10 to-transparent border-zoyd-yellow' : ''}>
    <CardHeader>
      <CardTitle className="text-white/60 text-sm">{label}</CardTitle>
    </CardHeader>
    <CardContent>
      <div className={`text-4xl font-display font-black mb-2 ${accent ? 'text-zoyd-yellow' : 'text-white'}`}>{value}</div>
      <div className="text-sm text-white/60">{hint}</div>
    </CardContent>
  </Card>
));

const WalletFilter = React.memo(({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) => (
    <button
    onClick={onClick}
    aria-label={`Filtrer par ${label}`}
    className={`px-3 py-1.5 touch-target text-[10px] font-mono font-black uppercase tracking-widest border transition-all ${
      active ? 'bg-white text-black border-white' : 'bg-transparent text-white/40 border-white/10 hover:border-white/20'
    }`}
  >
    {label}
  </button>
));

const FundingMetric = React.memo(({ label, value }: { label: string; value: string }) => (
  <div className="border border-white/10 bg-black/40 px-4 py-3">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-1">{label}</div>
    <div className="font-display font-black text-lg text-white italic">{value}</div>
  </div>
));

interface TransactionRowProps {
  type: string;
  amount: number;
  description?: string;
  status: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

const TransactionRow = React.memo(({ type, amount, description, status, timestamp, metadata }: TransactionRowProps) => {
  const isPositive = amount >= 0;
  const typeLabel =
    type === 'deposit'
      ? 'Ajout'
      : type === 'withdraw'
        ? 'Retrait'
        : type === 'prize_win'
          ? 'Gain'
          : type === 'entry_fee'
            ? 'Pass'
            : type === 'refund'
              ? 'Remboursement'
              : type === 'bonus'
                ? 'Bonus'
                : type === 'arbitration_fee'
                  ? 'Arbitrage'
                  : type === 'match_loss'
                    ? 'Partie'
                    : type;

  const statusIcon =
    status === 'completed' ? (
      <CheckCircle2 className="w-4 h-4 text-green-400" />
    ) : status === 'failed' || status === 'cancelled' ? (
      <XCircle className="w-4 h-4 text-red-400" />
    ) : (
      <AlertCircle className="w-4 h-4 text-zoyd-yellow" />
    );

  return (
    <div className="flex items-center justify-between border border-white/5 p-4 bg-black/40 touch-target">
      <div className="flex items-center gap-4">
        {statusIcon}
        <div>
          <div className="font-display font-black text-sm uppercase italic text-white">{description}</div>
          <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
            {typeLabel} / {getRelativeTime(timestamp)}
            {metadata?.feeAmount ? ` / frais ${metadata.feeAmount.toFixed(1)} ZC` : ''}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className={`font-display font-black text-lg ${isPositive ? 'text-green-400' : 'text-white'}`}>
          {isPositive ? '+' : ''}{formatZC(Math.abs(amount))}
        </div>
        <Badge variant={status === 'completed' ? 'success' : status === 'pending' ? 'yellow' : 'disabled'}>
          {status}
        </Badge>
      </div>
    </div>
  );
});

export default WalletPage;
