import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router';
import { ArrowLeft, Trophy, Users, Crown, Medal, Zap, ChevronRight, Play, CheckCircle, Clock, Settings, DollarSign, RefreshCw, UserMinus, AlertTriangle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../app/components/ui/Tabs';
import { Button } from '../../../app/components/ui/Button';
import { useLeagueStore, type LeagueSeason, type LeagueDayKey, type LeagueStanding } from '../../../app/stores/leagueStore';
import { useAuthStore } from '../../../app/stores/authStore';
import {
  fetchServerLeagueSeason,
  joinServerLeagueSeason,
  leaveServerLeagueSeason,
  startServerLeagueDay,
  startServerLeagueQualification,
  advanceToServerLeagueFinal,
  submitServerLeagueFinalResults,
  updateServerLeagueSettings,
  reassignServerLeaguePlayer,
  refundServerLeaguePlayer,
  fetchServerLeaguePayments,
} from '../../../app/lib/leagueApi';
import { toast } from 'sonner';
import { formatZC, getRelativeTime } from '../../../lib/utils';
import { applyServerAccountState } from '../../../app/lib/serverSync';

const DAY_KEYS: LeagueDayKey[] = ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_LABELS: Record<LeagueDayKey, string> = {
  tuesday: 'Mardi',
  wednesday: 'Mercredi',
  thursday: 'Jeudi',
  friday: 'Vendredi',
  saturday: 'Samedi',
};
const DAY_SHORT: Record<LeagueDayKey, string> = {
  tuesday: 'MAR',
  wednesday: 'MER',
  thursday: 'JEU',
  friday: 'VEN',
  saturday: 'SAM',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  registering: { label: 'Inscriptions ouvertes', color: 'text-green-400 border-green-400/30 bg-green-400/10' },
  qualifying: { label: 'Qualification en cours', color: 'text-zoyd-yellow border-zoyd-yellow/30 bg-zoyd-yellow/10' },
  final: { label: 'Finale', color: 'text-orange-400 border-orange-400/30 bg-orange-400/10' },
  completed: { label: 'Termine', color: 'text-white/40 border-white/10 bg-white/5' },
};

const DAY_STATUS_ICONS: Record<string, typeof Play> = {
  pending: Clock,
  scheduled: Clock,
  live: Play,
  finished: CheckCircle,
};

const StandingsTable: React.FC<{ standings: LeagueStanding[]; currentUserId?: string }> = ({ standings, currentUserId }) => {
  if (!standings.length) {
    return (
      <div className="border border-white/10 bg-zoyd-surface/20 px-6 py-12 text-center text-sm text-white/40">
        Aucun classement disponible.
      </div>
    );
  }

  return (
    <div className="border border-white/10 bg-zoyd-surface/20 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40">#</th>
              <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40">Joueur</th>
              <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 text-right">Points</th>
              <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 text-right">Meilleur</th>
              <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 text-right">Matchs</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((standing, index) => {
              const isMe = standing.userId === currentUserId;
              const isTop3 = index < 3;
              return (
                <tr
                  key={standing.userId}
                  className={`border-b border-white/5 ${
                    isMe ? 'bg-zoyd-yellow/5' : isTop3 ? 'bg-white/[0.02]' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <span className={`text-sm font-bold ${isTop3 ? 'text-zoyd-yellow' : 'text-white/60'}`}>
                      {index + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-sm ${isMe ? 'text-zoyd-yellow font-bold' : 'text-white'}`}>
                      {standing.pseudo}
                      {isMe && <span className="text-[9px] ml-2 text-zoyd-yellow/60">(TOI)</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-bold text-white">{standing.totalPoints}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm text-white/60">{standing.bestPlacement > 0 ? `#${standing.bestPlacement}` : '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm text-white/60">{standing.matchesPlayed}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const QualificationPanel: React.FC<{
  season: LeagueSeason;
  currentUserId?: string;
  isAdmin: boolean;
  onAdminAction: (action: string, payload?: any) => void;
  isActionLoading: boolean;
}> = ({ season, currentUserId, isAdmin, onAdminAction, isActionLoading }) => {
  return (
    <div className="space-y-4">
      {isAdmin && season.status === 'registering' && (
        <button
          onClick={() => onAdminAction('start-qualification')}
          disabled={isActionLoading || season.registeredPlayers.length < 10}
          className="flex items-center gap-2 border border-zoyd-yellow/30 px-4 py-2.5 text-[10px] font-mono font-bold tracking-wider uppercase text-zoyd-yellow hover:bg-zoyd-yellow/10 transition-colors disabled:opacity-50 touch-target"
        >
          <Play className="w-3.5 h-3.5" />
          Lancer la qualification ({season.registeredPlayers.length} joueurs)
        </button>
      )}

      {DAY_KEYS.map((day) => {
        const slot = season.qualificationGroups[day];
        const status = slot?.status || 'pending';
        const Icon = DAY_STATUS_ICONS[status] || Clock;
        const myGroup = slot?.players.includes(currentUserId || '');

        return (
          <div
            key={day}
            className={`border p-4 ${
              myGroup ? 'border-zoyd-yellow/30 bg-zoyd-yellow/5' : 'border-white/10 bg-zoyd-surface/20'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 flex items-center justify-center border ${
                  status === 'finished'
                    ? 'border-green-400/30 text-green-400'
                    : status === 'live'
                      ? 'border-zoyd-yellow/30 text-zoyd-yellow'
                      : 'border-white/10 text-white/40'
                }`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white">{DAY_LABELS[day]}</div>
                  <div className="text-[10px] text-white/40">{slot?.players.length || 0} joueurs</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {myGroup && status !== 'finished' && (
                  <span className="text-[9px] font-mono font-bold tracking-wider uppercase px-2 py-1 border border-zoyd-yellow/30 text-zoyd-yellow bg-zoyd-yellow/10">
                    TON GROUPE
                  </span>
                )}
                <span className={`text-[10px] font-mono font-bold tracking-wider uppercase px-2 py-1 border ${
                  status === 'finished'
                    ? 'border-green-400/30 text-green-400 bg-green-400/10'
                    : status === 'live'
                      ? 'border-zoyd-yellow/30 text-zoyd-yellow bg-zoyd-yellow/10'
                      : 'border-white/10 text-white/30 bg-white/5'
                }`}>
                  {status === 'finished' ? 'Termine' : status === 'live' ? 'En cours' : status === 'scheduled' ? 'Planifie' : 'En attente'}
                </span>
                {isAdmin && status === 'scheduled' && (
                  <button
                    onClick={() => onAdminAction('start-day', { dayKey: day })}
                    disabled={isActionLoading}
                    className="text-[10px] font-mono font-bold tracking-wider uppercase px-2 py-1 border border-zoyd-yellow/30 text-zoyd-yellow hover:bg-zoyd-yellow/10 transition-colors disabled:opacity-50 touch-target"
                  >
                    Demarrer
                  </button>
                )}
              </div>
            </div>

            {slot?.results && slot.results.length > 0 && (
              <div className="mt-3 border-t border-white/5 pt-3">
                <div className="text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 mb-2">Top 10</div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5">
                  {slot.results.slice(0, 10).map((result, i) => (
                    <div
                      key={result.userId}
                      className={`text-[10px] px-2 py-1 border ${
                        i === 0
                          ? 'border-zoyd-yellow/30 text-zoyd-yellow bg-zoyd-yellow/5'
                          : i < 3
                            ? 'border-white/10 text-white/70 bg-white/[0.02]'
                            : 'border-white/5 text-white/40'
                      }`}
                    >
                      #{result.placement} — {result.points}pts
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {isAdmin && season.status === 'qualifying' && DAY_KEYS.every((d) => season.qualificationGroups[d]?.status === 'finished') && (
        <button
          onClick={() => onAdminAction('advance-to-final')}
          disabled={isActionLoading}
          className="flex items-center gap-2 border border-orange-400/30 px-4 py-2.5 text-[10px] font-mono font-bold tracking-wider uppercase text-orange-400 hover:bg-orange-400/10 transition-colors disabled:opacity-50 touch-target"
        >
          <Trophy className="w-3.5 h-3.5" />
          Avancer vers la finale (Top 40)
        </button>
      )}
    </div>
  );
};

interface PaymentInfo {
  userId: string;
  pseudo: string;
  joinedAt: string;
  paid: boolean;
  amount: number;
  cashAmount: number;
  bonusAmount: number;
}

const AdminPanel: React.FC<{
  season: LeagueSeason;
  onAdminAction: (action: string, payload?: any) => void;
  isActionLoading: boolean;
}> = ({ season, onAdminAction, isActionLoading }) => {
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
    } catch (error) {
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
                Pass d'entrée (ZC)
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

const FinalResultsForm: React.FC<{
  finalists: Array<{ userId: string; pseudo: string; totalPoints: number }>;
  onsubmit: (results: Array<{ userId: string; placement: number; kills: number }>) => void;
  isLoading: boolean;
}> = ({ finalists, onsubmit, isLoading }) => {
  const [entries, setEntries] = useState(() =>
    finalists.map((f) => ({ userId: f.userId, pseudo: f.pseudo, placement: 0, kills: 0 }))
  );

  const updateEntry = (userId: string, field: 'placement' | 'kills', value: number) => {
    setEntries((prev) => prev.map((e) => (e.userId === userId ? { ...e, [field]: value } : e)));
  };

  const handleSubmit = () => {
    const valid = entries.filter((e) => e.placement > 0);
    if (valid.length === 0) return;
    onsubmit(valid.map(({ userId, placement, kills }) => ({ userId, placement, kills })));
  };

  const sortedEntries = [...entries].sort((a, b) => a.placement - b.placement || b.kills - a.kills);

  return (
    <div className="border border-white/10 bg-zoyd-surface/20 p-5 space-y-4">
      <h3 className="text-sm font-bold text-white mb-3">Soumettre les resultats de la finale</h3>
      <p className="text-[10px] text-white/40 mb-4">
          Saisis le classement (placement) et les kills de chaque finaliste. Seuls les joueurs avec un placement {'>'} 0 seront enregistres.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-3 py-2 text-[9px] font-mono font-bold tracking-wider uppercase text-white/40">Joueur</th>
              <th className="px-3 py-2 text-[9px] font-mono font-bold tracking-wider uppercase text-white/40 text-right">Points</th>
              <th className="px-3 py-2 text-[9px] font-mono font-bold tracking-wider uppercase text-white/40 text-right">Placement</th>
              <th className="px-3 py-2 text-[9px] font-mono font-bold tracking-wider uppercase text-white/40 text-right">Kills</th>
            </tr>
          </thead>
          <tbody>
            {sortedEntries.map((entry) => (
              <tr key={entry.userId} className="border-b border-white/5">
                <td className="px-3 py-2 text-sm text-white">{entry.pseudo}</td>
                <td className="px-3 py-2 text-sm text-white/60 text-right">
                  {finalists.find((f) => f.userId === entry.userId)?.totalPoints || 0}
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={entry.placement || ''}
                    onChange={(e) => updateEntry(entry.userId, 'placement', Number(e.target.value))}
                    className="w-16 bg-white/5 border border-white/10 px-2 py-1 text-sm text-white text-center focus:border-zoyd-yellow/50 focus:outline-none"
                    placeholder="#"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    value={entry.kills || ''}
                    onChange={(e) => updateEntry(entry.userId, 'kills', Number(e.target.value))}
                    className="w-16 bg-white/5 border border-white/10 px-2 py-1 text-sm text-white text-center focus:border-zoyd-yellow/50 focus:outline-none"
                    placeholder="0"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-white/5 pt-3">
        <span className="text-[10px] text-white/40">
          {entries.filter((e) => e.placement > 0).length} / {entries.length} joueurs classe(s)
        </span>
        <button
          onClick={handleSubmit}
          disabled={isLoading || entries.filter((e) => e.placement > 0).length === 0}
          className="text-[10px] font-mono font-bold tracking-wider uppercase px-4 py-2 border border-zoyd-yellow/30 text-zoyd-yellow hover:bg-zoyd-yellow/10 transition-colors disabled:opacity-50"
        >
          Valider les resultats
        </button>
      </div>
    </div>
  );
};

const LeagueSeasonPage: React.FC = () => {
  const { seasonId } = useParams<{ seasonId: string }>();
  const { user } = useAuthStore();
  const { getSeasonById, replaceFromServer } = useLeagueStore();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('standings');
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ action: string; payload?: any; message: string } | null>(null);

  useEffect(() => {
    if (!seasonId) return;
    let cancelled = false;

    const load = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);
        const response = await fetchServerLeagueSeason(seasonId);
        if (cancelled) return;
        replaceFromServer([response.season]);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Erreur de chargement.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [seasonId, replaceFromServer]);

  const season = seasonId ? getSeasonById(seasonId) : undefined;

  const isRegistered = useMemo(() => {
    if (!season || !user) return false;
    return season.registeredPlayers.some((p) => p.userId === user.id);
  }, [season, user]);

  const myStanding = useMemo(() => {
    if (!season || !user) return null;
    return season.standings.find((s) => s.userId === user.id) || null;
  }, [season, user]);

  const handleJoin = async () => {
    if (!seasonId || actionLoading) return;
    try {
      setActionLoading(true);
      const response = await joinServerLeagueSeason(seasonId);
      replaceFromServer([response.season]);
      if (response.user && response.wallet) applyServerAccountState({ user: response.user, wallet: response.wallet });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de rejoindre la saison.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleLeave = async () => {
    if (!seasonId || actionLoading) return;
    try {
      setActionLoading(true);
      const response = await leaveServerLeagueSeason(seasonId);
      replaceFromServer([response.season]);
      if (response.user && response.wallet) applyServerAccountState({ user: response.user, wallet: response.wallet });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de quitter la saison.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleAdminAction = async (action: string, payload?: any) => {
    if (!seasonId || actionLoading || user?.role !== 'admin') return;

    // Show confirmation dialog for destructive actions
    const destructiveActions = ['refund', 'reassign', 'submit-final-results', 'advance-to-final'];
    if (destructiveActions.includes(action)) {
      let message = '';
      switch (action) {
        case 'refund':
          message = `Confirmer le remboursement pour le joueur ${payload?.userId || ''} ?`;
          break;
        case 'reassign':
          message = `Confirmer la réassignation du joueur du ${payload?.fromDay} au ${payload?.toDay} ?`;
          break;
        case 'submit-final-results':
          message = 'Confirmer la soumission des résultats de finale ? Cette action est irréversible.';
          break;
        case 'advance-to-final':
          message = 'Confirmer l\'avancement vers la finale ? Cette action clôturera les qualifications.';
          break;
      }
      setConfirmAction({ action, payload, message });
      return;
    }

    // Execute non-destructive actions directly
    executeAdminAction(action, payload);
  };

  const executeAdminAction = async (action: string, payload?: any) => {
    if (!seasonId || actionLoading || user?.role !== 'admin') return;
    try {
      setActionLoading(true);
      let response;
      switch (action) {
        case 'start-qualification':
          response = await startServerLeagueQualification(seasonId);
          break;
        case 'start-day':
          if (payload?.dayKey) response = await startServerLeagueDay(seasonId, payload.dayKey);
          break;
        case 'advance-to-final':
          response = await advanceToServerLeagueFinal(seasonId);
          break;
        case 'submit-final-results':
          if (payload?.results) response = await submitServerLeagueFinalResults(seasonId, payload.results);
          break;
        case 'update-settings':
          if (payload) {
            response = await updateServerLeagueSettings(seasonId, {
              maxPlayers: payload.maxPlayers,
              entryFee: payload.entryFee,
            });
          }
          break;
        case 'reassign':
          if (payload?.userId && payload?.fromDay && payload?.toDay) {
            response = await reassignServerLeaguePlayer(seasonId, payload.userId, payload.fromDay, payload.toDay);
          }
          break;
        case 'refund':
          if (payload?.userId) {
            response = await refundServerLeaguePlayer(seasonId, payload.userId);
          }
          break;
      }
      if (response) replaceFromServer([response.season]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur lors de l'action admin.");
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white scanline font-ui pb-20 pt-safe-top">
        <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />
        <div className="max-w-[1500px] mx-auto px-4 md:px-8 py-12 md:py-24 relative z-10">
          <div className="border border-white/10 bg-zoyd-surface/20 px-6 py-5 text-sm text-white/60">
            Chargement de la saison...
          </div>
        </div>
      </div>
    );
  }

  if (loadError || !season) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white scanline font-ui pb-20 pt-safe-top">
        <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />
        <div className="max-w-[1500px] mx-auto px-4 md:px-8 py-12 md:py-24 relative z-10">
          <Link to="/br-league" className="flex items-center gap-2 text-sm text-white/40 hover:text-white mb-6">
            <ArrowLeft className="w-4 h-4" />
            Retour aux ligues
          </Link>
          <div className="border border-red-500/30 bg-red-500/10 px-6 py-5 text-sm text-red-400">
            {loadError || 'Saison introuvable.'}
          </div>
        </div>
      </div>
    );
  }

  const badge = STATUS_LABELS[season.status];

  return (
    <div className="min-h-dvh bg-zoyd-black text-white scanline font-ui pb-20 pt-safe-top">
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <div className="max-w-[1500px] mx-auto px-4 md:px-8 relative z-10">
        <div className="pt-8">
          <Link to="/br-league" className="flex items-center gap-2 text-sm text-white/40 hover:text-white mb-6">
            <ArrowLeft className="w-4 h-4" />
            Retour aux ligues
          </Link>
        </div>

        <header className="border-b border-white/5 pb-6 md:pb-10 mb-6 md:mb-10">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 border border-zoyd-yellow flex items-center justify-center text-zoyd-yellow">
                  <Zap className="w-4 h-4" />
                </div>
                <span className={`text-[10px] font-mono font-bold tracking-wider uppercase px-2.5 py-1 border ${badge.color}`}>
                  {badge.label}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl md:text-4xl font-black uppercase tracking-tight">
                BR League — Saison {season.cycleNumber}
              </h1>
              <p className="text-xs text-white/40 mt-2">
                Creee {getRelativeTime(season.createdAt)}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {season.status === 'registering' && (
                isRegistered ? (
                  <button
                    onClick={handleLeave}
                    disabled={actionLoading}
                    className="border border-red-500/30 px-4 py-2.5 text-[10px] font-mono font-bold tracking-wider uppercase text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
                  >
                    Se desinscrire
                  </button>
                ) : (
                  <button
                    onClick={handleJoin}
                    disabled={actionLoading}
                    className="border border-zoyd-yellow/30 px-4 py-2.5 text-[10px] font-mono font-bold tracking-wider uppercase text-zoyd-yellow hover:bg-zoyd-yellow/10 transition-colors disabled:opacity-50"
                  >
                    S'inscrire — {formatZC(season.entryFee)}
                  </button>
                )
              )}
            </div>
          </div>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <div className="border border-white/10 bg-zoyd-surface/30 px-4 py-3">
            <div className="text-[9px] font-mono text-white/40 uppercase tracking-wider mb-1">Joueurs</div>
            <div className="text-xl font-black text-white">{season.registeredPlayers.length}/{season.maxPlayers}</div>
          </div>
          <div className="border border-white/10 bg-zoyd-surface/30 px-4 py-3">
            <div className="text-[9px] font-mono text-white/40 uppercase tracking-wider mb-1">Pot</div>
            <div className="text-xl font-black text-zoyd-yellow">{formatZC(season.payout.gross)}</div>
          </div>
          <div className="border border-white/10 bg-zoyd-surface/30 px-4 py-3">
            <div className="text-[9px] font-mono text-white/40 uppercase tracking-wider mb-1">1er</div>
            <div className="text-xl font-black text-green-400">{formatZC(season.payout.first)}</div>
          </div>
          <div className="border border-white/10 bg-zoyd-surface/30 px-4 py-3">
            <div className="text-[9px] font-mono text-white/40 uppercase tracking-wider mb-1">
              {season.status === 'completed' ? 'Terminee' : myStanding ? 'Ta position' : 'Classement'}
            </div>
            <div className="text-xl font-black text-white">
              {season.status === 'completed'
                ? season.finishedAt ? getRelativeTime(season.finishedAt) : '—'
                : myStanding
                  ? `#${season.standings.indexOf(myStanding) + 1}`
                  : '—'}
            </div>
          </div>
        </div>

        {myStanding && (
          <div className="border border-zoyd-yellow/20 bg-zoyd-yellow/5 px-4 py-3 mb-6 flex items-center gap-4">
            <Medal className="w-5 h-5 text-zoyd-yellow flex-shrink-0" />
            <div className="text-sm text-white">
              Tu es <span className="font-bold text-zoyd-yellow">#{season.standings.indexOf(myStanding) + 1}</span> avec{' '}
              <span className="font-bold text-white">{myStanding.totalPoints} points</span>
              {myStanding.bestPlacement > 0 && (
                <> — meilleur placement: <span className="font-bold text-white">#{myStanding.bestPlacement}</span></>
              )}
            </div>
          </div>
        )}

        {season.status === 'completed' && season.podium.first && (
          <div className="grid grid-cols-3 gap-3 mb-8">
            <div className="border border-zoyd-yellow/30 bg-zoyd-yellow/5 px-4 py-4 text-center">
              <Crown className="w-6 h-6 text-zoyd-yellow mx-auto mb-2" />
              <div className="text-[10px] font-mono font-bold tracking-wider uppercase text-zoyd-yellow mb-1">Champion</div>
              <div className="text-sm font-bold text-white">
                {season.registeredPlayers.find((p) => p.userId === season.podium.first)?.pseudo || '—'}
              </div>
              <div className="text-[10px] text-green-400 mt-1">{formatZC(season.payout.first)}</div>
            </div>
            <div className="border border-white/10 bg-white/5 px-4 py-4 text-center">
              <Medal className="w-6 h-6 text-white/40 mx-auto mb-2" />
              <div className="text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 mb-1">Vice-Champion</div>
              <div className="text-sm font-bold text-white">
                {season.registeredPlayers.find((p) => p.userId === season.podium.second)?.pseudo || '—'}
              </div>
              <div className="text-[10px] text-white/40 mt-1">{formatZC(season.payout.second)}</div>
            </div>
            <div className="border border-orange-400/20 bg-orange-400/5 px-4 py-4 text-center">
              <Medal className="w-6 h-6 text-orange-400/60 mx-auto mb-2" />
              <div className="text-[10px] font-mono font-bold tracking-wider uppercase text-orange-400/60 mb-1">3eme</div>
              <div className="text-sm font-bold text-white">
                {season.registeredPlayers.find((p) => p.userId === season.podium.third)?.pseudo || '—'}
              </div>
              <div className="text-[10px] text-orange-400/60 mt-1">{formatZC(season.payout.third)}</div>
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="standings">CLASSEMENT</TabsTrigger>
            <TabsTrigger value="qualification">QUALIFICATION</TabsTrigger>
            {season.status === 'final' && <TabsTrigger value="final">FINALE</TabsTrigger>}
            {user?.role === 'admin' && <TabsTrigger value="admin">ADMIN</TabsTrigger>}
          </TabsList>

          <div className="mt-6">
            <TabsContent value="standings">
              <StandingsTable standings={season.standings} currentUserId={user?.id} />
            </TabsContent>

            <TabsContent value="qualification">
              <QualificationPanel
                season={season}
                currentUserId={user?.id}
                isAdmin={user?.role === 'admin'}
                onAdminAction={handleAdminAction}
                isActionLoading={actionLoading}
              />
            </TabsContent>

            <TabsContent value="final">
              {season.finalMatch.results.length > 0 ? (
                <div className="border border-white/10 bg-zoyd-surface/20 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40">#</th>
                          <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40">Joueur</th>
                          <th className="px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 text-right">Kills</th>
                        </tr>
                      </thead>
                      <tbody>
                        {season.finalMatch.results.map((result, index) => {
                          const player = season.registeredPlayers.find((p) => p.userId === result.userId);
                          return (
                            <tr
                              key={result.userId}
                              className={`border-b border-white/5 ${
                                index === 0 ? 'bg-zoyd-yellow/5' : index < 3 ? 'bg-white/[0.02]' : ''
                              }`}
                            >
                              <td className="px-4 py-3">
                                <span className={`text-sm font-bold ${
                                  index === 0 ? 'text-zoyd-yellow' : index < 3 ? 'text-white/80' : 'text-white/40'
                                }`}>
                                  {result.placement}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm text-white">{player?.pseudo || '—'}</span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span className="text-sm text-white/60">{result.kills}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : season.status === 'final' && user?.role === 'admin' ? (
                <FinalResultsForm
                  finalists={season.finalists}
                  onsubmit={(results) => handleAdminAction('submit-final-results', { results })}
                  isLoading={actionLoading}
                />
              ) : (
                <div className="border border-white/10 bg-zoyd-surface/20 px-6 py-12 text-center text-sm text-white/40">
                  La finale n'a pas encore eu lieu.
                </div>
              )}
            </TabsContent>

            {user?.role === 'admin' && (
              <TabsContent value="admin">
                <AdminPanel
                  season={season}
                  onAdminAction={handleAdminAction}
                  isActionLoading={actionLoading}
                />
              </TabsContent>
            )}
          </div>
        </Tabs>
      </div>

      {/* Confirmation Dialog for Destructive Admin Actions */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zoyd-surface border border-white/10 max-w-md w-full p-6">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-orange-400" />
              </div>
              <div>
                <h3 className="text-white font-display font-black uppercase tracking-widest text-sm mb-2">
                  Confirmation requise
                </h3>
                <p className="text-white/60 text-sm">{confirmAction.message}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setConfirmAction(null)}
                disabled={actionLoading}
                className="flex-1"
              >
                Annuler
              </Button>
              <Button
                variant="primary"
                onClick={() => executeAdminAction(confirmAction.action, confirmAction.payload)}
                disabled={actionLoading}
                className="flex-1"
              >
                {actionLoading ? 'Traitement...' : 'Confirmer'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeagueSeasonPage;
