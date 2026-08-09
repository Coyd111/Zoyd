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
import { getFundingPromptCopy, parseFundingPrompt } from '../../lib/walletFunding';
import { formatZC, formatFCFA, getRelativeTime } from '../../lib/utils';
import { ArrowDownToLine, ArrowUpFromLine, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { verifyFedaPayTransaction } from '../lib/walletApi';

const MIN_WITHDRAWAL_ZC = 150;

declare const FedaPay: {
  checkout: (config: {
    public_key: string;
    transaction: { amount: number; description: string; currency: { code: string } };
    onComplete: (resp: { data?: { token: string } }) => void;
    onClose: () => void;
  }) => void;
};

const WalletPage: React.FC = () => {
  const {
    transactions,
    deposit,
    withdraw,
    cashBalance,
    bonusBalance,
    lockedBalance,
    pendingWinnings,
    getAvailableToSpend,
  } = useWalletStore();
  const { user } = useAuthStore();

  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [selectedOperator, setSelectedOperator] = useState('');
  const [amount, setAmount] = useState('');
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
      setAmount(fundingPrompt.neededAmount.toString());
      setFundingPrefillKey(fundingKey);
    }
  }, [fundingKey, fundingPrefillKey, fundingPrompt]);

  const filteredTransactions = useMemo(() => {
    if (filter === 'all') return transactions;
    return transactions.filter((transaction) => transaction.type === filter);
  }, [filter, transactions]);

  const handleDeposit = async () => {
    if (!amount) return;
    const depositAmount = parseFloat(amount);
    const amountFCFA = depositAmount * 10; // 1 ZC = 10 FCFA

    const publicKey = import.meta.env.VITE_FEDAPAY_PUBLIC_KEY;
    
    if (!publicKey) {
      toast.error("La cle FedaPay (VITE_FEDAPAY_PUBLIC_KEY) est manquante dans l'environnement local.");
      return;
    }

    // Using FedaPay Widget
    FedaPay.init({
      public_key: publicKey,
      transaction: {
        amount: amountFCFA,
        description: `Recharge de ${depositAmount} ZC (~ ${amountFCFA} FCFA)`,
      },
      customer: {
        email: 'joueur@zoyd.app',
        lastname: 'Joueur ZOYD'
      },
      onComplete: async (resp: { reason?: string; transaction?: { id: number | string } }) => {
        if (resp.reason === 'CHECKOUT COMPLETE') {
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
          } catch (error: any) {
            toast.dismiss();
            toast.error(error.message || 'Erreur lors de la verification de la transaction FedaPay.');
          }
        } else {
          toast.error('Transaction annulee ou echouee.');
        }
        setShowDepositModal(false);
        setAmount('');
        setSelectedOperator('');
      }
    });
  };

  const handleWithdraw = async () => {
    if (!amount) return;
    try {
      const withdrawAmount = parseFloat(amount);
      await withdraw(withdrawAmount, 'Mobile Money', user?.phone || '');
      toast.success(`Retrait lance pour ${formatZC(withdrawAmount)}.`);
      setShowWithdrawModal(false);
      setAmount('');
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  return (
    <div className="min-h-screen bg-zoyd-black p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="relative mb-8 p-8 border border-white/5 bg-zoyd-surface/20 overflow-hidden">
          <div className="absolute inset-0 z-0">
            <img src="/assets/illustrations/wallet_vault.jpg" alt="ZOYD Vault" className="w-full h-full object-cover opacity-20 mix-blend-luminosity grayscale" />
            <div className="absolute inset-0 bg-gradient-to-r from-zoyd-black via-zoyd-black/80 to-transparent" />
            <div className="absolute inset-0 tactical-grid opacity-10" />
          </div>
          <div className="relative z-10">
            <h1 className="text-4xl md:text-5xl font-display font-black text-white italic uppercase tracking-tighter mb-2">
              LE COFFRE-FORT <span className="text-zoyd-yellow">(WALLET)</span>
            </h1>
            <p className="text-white/60 max-w-xl">Recharge via Mobile Money, verrouille tes wagers et retire tes gains de maniere securisee.</p>
          </div>
        </div>

        {fundingPrompt && fundingCopy ? (
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
                <Button variant="primary" onClick={() => setShowDepositModal(true)}>
                  <ArrowDownToLine className="w-5 h-5" />
                  AJOUTER LES ZC
                </Button>
              ) : null}

              {canResumeFundingFlow && fundingPrompt.returnTo ? (
                <Link
                  to={fundingPrompt.returnTo}
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
          <Button variant="primary" size="lg" fullWidth onClick={() => setShowDepositModal(true)}>
            <ArrowDownToLine className="w-5 h-5" />
            DÉPÔT MOBILE MONEY (AJOUTER DES ZC)
          </Button>
          <Button variant="secondary" size="lg" fullWidth onClick={() => setShowWithdrawModal(true)}>
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
                <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">Gains en attente</div>
                <div className="text-2xl font-display font-black text-white">{formatZC(pendingWinnings)}</div>
              </div>
              <div className="border border-white/5 p-4 bg-black/40">
                <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">Frais de retrait</div>
                <div className="text-2xl font-display font-black text-zoyd-yellow">2%</div>
              </div>
              <div className="border border-white/5 p-4 bg-black/40">
                <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">Retrait minimum</div>
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
                <div className="py-12 text-center">
                  <Clock className="w-12 h-12 text-white/10 mx-auto mb-4" />
                  <p className="text-white/20 font-mono text-sm uppercase tracking-widest">Ton solde n'a pas encore bouge</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Modal isOpen={showDepositModal} onClose={() => setShowDepositModal(false)} title="Ajouter des ZC" size="md">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-zoyd-white mb-3">Montant a ajouter</label>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {presetAmounts.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setAmount(preset.toString())}
                    className="px-4 py-3 rounded-lg bg-zoyd-white-5 border border-zoyd-white-10 hover:border-zoyd-yellow text-zoyd-yellow font-display font-bold transition-all"
                  >
                    {preset} ZC
                  </button>
                ))}
              </div>
              <Input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Montant personnalise" />
            </div>

            <div>
              <label className="block text-sm font-medium text-zoyd-white mb-3">Operateur Mobile Money</label>
              <div className="grid grid-cols-3 gap-3">
                {operators.map((operator) => (
                  <button
                    key={operator.id}
                    onClick={() => setSelectedOperator(operator.id)}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      selectedOperator === operator.id
                        ? 'border-zoyd-yellow bg-zoyd-white-10'
                        : 'border-zoyd-white-10 hover:border-zoyd-white-20'
                    }`}
                  >
                    <div className={`w-12 h-12 rounded-full mx-auto mb-2 ${operator.colorClass}`} />
                    <p className="text-xs font-display font-semibold text-zoyd-white text-center">{operator.name}</p>
                  </button>
                ))}
              </div>
            </div>

            <Button variant="primary" fullWidth onClick={handleDeposit} disabled={!selectedOperator || !amount}>
              Ajouter ces ZC
            </Button>
          </div>
        </Modal>

        <Modal isOpen={showWithdrawModal} onClose={() => setShowWithdrawModal(false)} title="Retirer mes ZC" size="md">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-zoyd-white mb-3">Montant a retirer</label>
              <Input
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder={`${MIN_WITHDRAWAL_ZC} ZC minimum (${MIN_WITHDRAWAL_ZC * 10} FCFA)`}
                max={cashBalance}
              />
              <p className="text-xs text-zoyd-white-60 mt-2">Un retrait prend 2% de frais et sort de ton solde retirable.</p>
            </div>

            <Button
              variant="primary"
              fullWidth
              onClick={handleWithdraw}
              disabled={!amount || parseFloat(amount) < MIN_WITHDRAWAL_ZC || parseFloat(amount) > cashBalance}
            >
              Retirer mes gains
            </Button>
          </div>
        </Modal>
      </div>
    </div>
  );
};

const BalanceCard = ({ label, value, hint, accent = false }: { label: string; value: string; hint: string; accent?: boolean }) => (
  <Card className={accent ? 'bg-gradient-to-br from-zoyd-yellow/10 to-transparent border-zoyd-yellow' : ''}>
    <CardHeader>
      <CardTitle className="text-zoyd-white-60 text-sm">{label}</CardTitle>
    </CardHeader>
    <CardContent>
      <div className={`text-4xl font-display font-black mb-2 ${accent ? 'text-zoyd-yellow' : 'text-zoyd-white'}`}>{value}</div>
      <div className="text-sm text-zoyd-white-60">{hint}</div>
    </CardContent>
  </Card>
);

const WalletFilter = ({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1 text-[10px] font-mono font-black uppercase tracking-widest border transition-all ${
      active ? 'bg-white text-black border-white' : 'bg-transparent text-white/40 border-white/10 hover:border-white/20'
    }`}
  >
    {label}
  </button>
);

const FundingMetric = ({ label, value }: { label: string; value: string }) => (
  <div className="border border-white/10 bg-black/40 px-4 py-3">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-1">{label}</div>
    <div className="font-display font-black text-lg text-white italic">{value}</div>
  </div>
);

interface TransactionRowProps {
  type: string;
  amount: number;
  description?: string;
  status: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

const TransactionRow = ({ type, amount, description, status, timestamp, metadata }: TransactionRowProps) => {
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
    <div className="flex items-center justify-between border border-white/5 p-4 bg-black/40">
      <div className="flex items-center gap-4">
        {statusIcon}
        <div>
          <div className="font-display font-black text-sm uppercase italic text-white">{description}</div>
          <div className="text-[10px] font-mono text-white/20 uppercase tracking-widest">
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
};

export default WalletPage;
