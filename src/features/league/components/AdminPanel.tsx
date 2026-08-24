import { useEffect, useState } from 'react';
import { Settings, DollarSign, RefreshCw, UserMinus } from 'lucide-react';
import type { LeagueSeason, LeagueDayKey } from '../../../app/stores/leagueStore';
import { DAY_KEYS, DAY_LABELS } from './leagueSeasonConstants';
import { fetchServerLeaguePayments } from '../../../app/lib/leagueApi';
import { formatZC } from '../../../lib/utils';
import { toast } from 'sonner';

interface PaymentInfo {
  userId: string;
  pseudo: string;
  joinedAt: string;
  paid: boolean;
  amount: number;
  cashAmount: number;
  bonusAmount: number;
}

export const AdminPanel = ({
  season,
  onAdminAction,
  isActionLoading,
}: {
  season: LeagueSeason;
  onAdminAction: (action: string, payload?: Record<string, unknown>) => void;
  isActionLoading: boolean;
}) => {
  const [settingsTab, setSettingsTab] = useState<'settings' | 'reassign' | 'payments'>('settings');
  const [maxPlayers, setMaxPlayers] = useState(season.maxPlayers);
  const [entryFee, setEntryFee] = useState(season.entryFee);
  const [payments, setPayments] = useState<PaymentInfo[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [reassignUserId, setReassignUserId] = useState('');
  const [reassignFromDay, setReassignFromDay] = useState<LeagueDayKey>('tuesday');
  const [reassignToDay, setReassignToDay] = useState<LeagueDayKey>('wednesday');

  const loadPayments = async () => {
    setLoadingPayments(true);
    try {
      const response = await fetchServerLeaguePayments(season.id);
      setPayments(response.payments);
    } catch {
      toast.error("Erreur lors du chargement des paiements.");
    } finally {
      setLoadingPayments(false);
    }
  };

  useEffect(() => {
    if (settingsTab === 'payments') loadPayments();
  }, [settingsTab]);

  const handleSaveSettings = () => {
    onAdminAction('update-settings', { maxPlayers, entryFee });
  };

  const handleReassign = () => {
    if (!reassignUserId) return;
    onAdminAction('reassign', { userId: reassignUserId, fromDay: reassignFromDay, toDay: reassignToDay });
  };

  const handleRefund = (userId: string) => {
    onAdminAction('refund', { userId });
  };

  const paidCount = payments.filter((p) => p.paid).length;
  const unpaidCount = payments.filter((p) => !p.paid).length;
  const totalCollected = payments.filter((p) => p.paid).reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 mb-4">
        {([
          { key: 'settings', label: 'PARAMETRES', icon: Settings },
          { key: 'reassign', label: 'REASSIGNER', icon: RefreshCw },
          { key: 'payments', label: 'PAIEMENTS', icon: DollarSign },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setSettingsTab(key)}
            className={`flex items-center gap-2 text-[10px] font-mono font-bold tracking-wider uppercase px-3 py-2 border transition-colors ${
              settingsTab === key
                ? 'border-zoyd-yellow/30 text-zoyd-yellow bg-zoyd-yellow/10'
                : 'border-white/10 text-white/40 hover:text-white/60'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {settingsTab === 'settings' && (
        <div className="border border-white/10 bg-zoyd-surface/20 p-5 space-y-4">
          <h3 className="text-sm font-bold text-white mb-3">Parametres de la ligue</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 block mb-1.5">
                Nombre max de joueurs
              </label>
              <input
                type="number"
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(Number(e.target.value))}
                min={10}
                max={1000}
                className="w-full bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:border-zoyd-yellow/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 block mb-1.5">
                Pass d&apos;entree (ZC)
              </label>
              <input
                type="number"
                value={entryFee}
                onChange={(e) => setEntryFee(Number(e.target.value))}
                min={0}
                max={500}
                className="w-full bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:border-zoyd-yellow/50 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-white/5 pt-3">
            <span className="text-[10px] text-white/40">
              {season.registeredPlayers.length} inscrits — Pot: {formatZC(season.registeredPlayers.length * entryFee)}
            </span>
            <button
              onClick={handleSaveSettings}
              disabled={isActionLoading || season.status !== 'registering'}
              className="text-[10px] font-mono font-bold tracking-wider uppercase px-4 py-2 border border-zoyd-yellow/30 text-zoyd-yellow hover:bg-zoyd-yellow/10 transition-colors disabled:opacity-50 touch-target"
            >
              Sauvegarder
            </button>
          </div>
        </div>
      )}

      {settingsTab === 'reassign' && (
        <div className="border border-white/10 bg-zoyd-surface/20 p-5 space-y-4">
          <h3 className="text-sm font-bold text-white mb-3">Reassigner un joueur</h3>
          {season.status !== 'qualifying' ? (
            <p className="text-sm text-white/40">La reassignment n est possible que pendant la qualification.</p>
          ) : (
            <>
              <div>
                <label className="text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 block mb-1.5">
                  Joueur
                </label>
                <select
                  value={reassignUserId}
                  onChange={(e) => setReassignUserId(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:border-zoyd-yellow/50 focus:outline-none"
                >
                  <option value="">Selectionner un joueur</option>
                  {season.registeredPlayers.map((p) => {
                    const currentDay = Object.entries(season.qualificationGroups).find(
                      ([, slot]) => slot?.players.includes(p.userId)
                    )?.[0];
                    return (
                      <option key={p.userId} value={p.userId}>
                        {p.pseudo} ({currentDay ? DAY_LABELS[currentDay as LeagueDayKey] : 'non assigne'})
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 block mb-1.5">
                    Depuis
                  </label>
                  <select
                    value={reassignFromDay}
                    onChange={(e) => setReassignFromDay(e.target.value as LeagueDayKey)}
                    className="w-full bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:border-zoyd-yellow/50 focus:outline-none"
                  >
                    {DAY_KEYS.map((day) => (
                      <option key={day} value={day}>{DAY_LABELS[day]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 block mb-1.5">
                    Vers
                  </label>
                  <select
                    value={reassignToDay}
                    onChange={(e) => setReassignToDay(e.target.value as LeagueDayKey)}
                    className="w-full bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:border-zoyd-yellow/50 focus:outline-none"
                  >
                    {DAY_KEYS.map((day) => (
                      <option key={day} value={day}>{DAY_LABELS[day]}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                onClick={handleReassign}
                disabled={isActionLoading || !reassignUserId || reassignFromDay === reassignToDay}
                className="w-full text-[10px] font-mono font-bold tracking-wider uppercase px-4 py-2 border border-zoyd-yellow/30 text-zoyd-yellow hover:bg-zoyd-yellow/10 transition-colors disabled:opacity-50 touch-target"
              >
                <RefreshCw className="w-3.5 h-3.5 inline mr-2" />
                Reassigner
              </button>
            </>
          )}
        </div>
      )}

      {settingsTab === 'payments' && (
        <div className="border border-white/10 bg-zoyd-surface/20 p-5 space-y-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white">Gestion des paiements</h3>
            <button
              onClick={loadPayments}
              disabled={loadingPayments}
              className="text-[10px] font-mono font-bold tracking-wider uppercase px-3 py-1.5 border border-white/10 text-white/40 hover:text-white/60 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 inline mr-1 ${loadingPayments ? 'animate-spin' : ''}`} />
              Actualiser
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="border border-green-400/20 bg-green-400/5 px-3 py-2">
              <div className="text-[9px] font-mono text-green-400/60 uppercase tracking-wider">Payes</div>
              <div className="text-lg font-bold text-green-400">{paidCount}</div>
            </div>
            <div className="border border-red-400/20 bg-red-400/5 px-3 py-2">
              <div className="text-[9px] font-mono text-red-400/60 uppercase tracking-wider">Impayes</div>
              <div className="text-lg font-bold text-red-400">{unpaidCount}</div>
            </div>
            <div className="border border-zoyd-yellow/20 bg-zoyd-yellow/5 px-3 py-2">
              <div className="text-[9px] font-mono text-zoyd-yellow/60 uppercase tracking-wider">Total</div>
              <div className="text-lg font-bold text-zoyd-yellow">{formatZC(totalCollected)}</div>
            </div>
          </div>

          {loadingPayments ? (
            <div className="text-sm text-white/40 text-center py-4">Chargement...</div>
          ) : payments.length === 0 ? (
            <div className="text-sm text-white/40 text-center py-4">Aucun paiement enregistre.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="px-3 py-2 text-[9px] font-mono font-bold tracking-wider uppercase text-white/40">Joueur</th>
                    <th className="px-3 py-2 text-[9px] font-mono font-bold tracking-wider uppercase text-white/40">Statut</th>
                    <th className="px-3 py-2 text-[9px] font-mono font-bold tracking-wider uppercase text-white/40 text-right">Montant</th>
                    <th className="px-3 py-2 text-[9px] font-mono font-bold tracking-wider uppercase text-white/40 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.userId} className="border-b border-white/5">
                      <td className="px-3 py-2 text-sm text-white">{payment.pseudo}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] font-mono font-bold tracking-wider uppercase px-2 py-0.5 border ${
                          payment.paid
                            ? 'border-green-400/30 text-green-400 bg-green-400/10'
                            : 'border-red-400/30 text-red-400 bg-red-400/10'
                        }`}>
                          {payment.paid ? 'Paye' : 'Impaye'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sm text-white/60 text-right">{formatZC(payment.amount)}</td>
                      <td className="px-3 py-2 text-right">
                        {payment.paid && (
                          <button
                            onClick={() => handleRefund(payment.userId)}
                            disabled={isActionLoading}
                            className="text-[10px] font-mono font-bold tracking-wider uppercase px-2 py-1 border border-red-400/30 text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
                          >
                            <UserMinus className="w-3 h-3 inline mr-1" />
                            Rembourser
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
