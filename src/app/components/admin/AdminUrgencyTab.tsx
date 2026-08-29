import React from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Ban, Eye, Filter, Flame, ExternalLink } from 'lucide-react';
import { formatZC, getRelativeTime } from '../../../lib/utils';
import { StatusPill, DisputeStat, PlayerPill, disputeCategoryLabels } from './AdminTabShared';
import type { DisputeMatch, DisputeFilter } from './AdminTabShared';

type AdminUrgencyTabProps = {
  filteredDisputes: DisputeMatch[];
  disputeFilter: DisputeFilter;
  onFilterChange: (filter: DisputeFilter) => void;
  escalatedCount: number;
  totalCount: number;
  pendingResolve: { matchId: string; type: 'alpha' | 'bravo' | 'none' } | null;
  onSetPendingResolve: (val: { matchId: string; type: 'alpha' | 'bravo' | 'none' } | null) => void;
  onRequestCancel: (matchId: string) => void;
  onResolveWinner: (matchId: string, team: 0 | 1) => void;
  onResolveDisputeOnly: (matchId: string) => void;
};

const AdminUrgencyTab: React.FC<AdminUrgencyTabProps> = ({
  filteredDisputes,
  disputeFilter,
  onFilterChange,
  escalatedCount,
  totalCount,
  pendingResolve,
  onSetPendingResolve,
  onRequestCancel,
  onResolveWinner,
  onResolveDisputeOnly,
}) => (
  <div className="space-y-6">
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
      <div>
        <h2 className="text-xl font-display font-black uppercase italic">Litiges en Cours</h2>
        <p className="text-white/35 text-sm">
          Chaque carte remonte le contexte utile pour décider vite sans chercher l&apos;info ailleurs.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {escalatedCount > 0 && (
          <div className="flex items-center gap-2 border border-red-500/30 bg-red-500/10 px-3 py-2">
            <Flame className="w-3.5 h-3.5 text-red-400" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-red-400">
              {escalatedCount} escaladé(s) — intervention admin requise
            </span>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'escalated', label: 'Escaladés', count: escalatedCount },
            { id: 'level1', label: 'Niveau 1', count: totalCount - escalatedCount },
            { id: 'all', label: 'Tous', count: totalCount },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => onFilterChange(f.id as DisputeFilter)}
              className={`px-3 sm:px-4 py-2 text-[10px] font-display font-black uppercase tracking-[0.15em] border transition-colors touch-target ${
                disputeFilter === f.id
                  ? 'bg-white text-black border-white'
                  : 'border-white/10 text-white/35 hover:text-white hover:border-white/20'
              }`}
            >
              <Filter className="w-3 h-3 inline mr-2" />
              {f.label} ({f.count})
            </button>
          ))}
        </div>
      </div>
    </div>

    {filteredDisputes.length === 0 ? (
      <div className="p-8 text-center">
        <p className="text-white/30 text-sm font-mono">
          {disputeFilter === 'escalated' ? 'Aucun litige escaladé. Bonne nouvelle !' : 'Aucun litige dans ce filtre.'}
        </p>
      </div>
    ) : (
      <div className="grid gap-5">
        {filteredDisputes.map((match) => {
          const activeDispute =
            match.disputes.find((d) => d.status === 'open' || d.status === 'under_review') ||
            match.dispute ||
            match.disputes[0];
          const isEscalated = (activeDispute?.level || 1) >= 2;

          return (
            <div key={match.id} className="p-6">
              {isEscalated && (
                <div className="flex items-center gap-3 mb-5 border-b border-red-500/20 pb-4">
                  <Flame className="w-4 h-4 text-red-400 shrink-0" />
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-red-400">
                      Litige Escaladé — Niveau Admin
                    </div>
                    <div className="text-xs text-white/40">
                      Escaladé par {activeDispute?.escalatedByPseudo || 'l\'arbitre'}
                      {activeDispute?.escalatedAt ? ` · ${getRelativeTime(activeDispute.escalatedAt)}` : ''}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-6 mb-5">
                <div>
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <div className="font-display font-black text-lg uppercase italic">{match.id}</div>
                    <StatusPill
                      label={isEscalated ? 'Niveau Admin' : 'litige ouvert'}
                      tone={isEscalated ? 'text-red-400 border-red-500/40' : 'text-red-300 border-red-500/30'}
                    />
                    {activeDispute?.prizePoolFrozen ? (
                      <StatusPill label="pool gelé" tone="text-zoyd-yellow border-zoyd-yellow/30" />
                    ) : null}
                  </div>
                  <div className="text-[11px] text-white/45">
                    {match.format} / {match.rules.map} / {match.players.length} joueurs / ouvert{' '}
                    {getRelativeTime(activeDispute?.openedAt || activeDispute?.createdAt || match.createdAt)}
                  </div>
                </div>

                <div className="grid sm:grid-cols-3 gap-3 text-sm font-mono text-white/40 min-w-0">
                  <DisputeStat label="Ouvert par" value={activeDispute?.openedByPseudo || 'Inconnu'} />
                  <DisputeStat
                    label="Catégorie"
                    value={activeDispute?.category ? disputeCategoryLabels[activeDispute.category] || 'N/A' : 'N/A'}
                  />
                  <DisputeStat label="Prizepool" value={formatZC(match.prizePool)} />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 mb-5">
                <div className="p-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-white/25 mb-3">ROSTER IMPACTÉ</div>
                  <div className="flex flex-wrap gap-2">
                    {match.players.map((player) => (
                      <PlayerPill key={`${match.id}-${player.userId}`} label={player.pseudo} team={player.team} />
                    ))}
                  </div>
                </div>
                <div className="border border-white/5 bg-black/30 p-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-white/25 mb-3">CONTEXTE</div>
                  <div className="space-y-2 text-sm text-white/45">
                    <div>Preuves: {activeDispute?.evidence?.length || 0} pièce(s)</div>
                    <div>Arbitre: {match.arbiter?.pseudo || 'Non assigné'}</div>
                    <div>Résolution existante: {match.result ? 'Oui, contestée' : 'Aucune'}</div>
                  </div>
                </div>
              </div>

              <div className="p-4 mb-5">
                <div className="text-[10px] font-mono uppercase tracking-widest text-white/25 mb-3">DOSSIER</div>
                <div className="space-y-3">
                  <div className="text-sm text-white/60">{activeDispute?.reason || 'Aucun motif fourni'}</div>
                  {activeDispute?.evidence && activeDispute.evidence.length > 0 && (
                    <div className="border-t border-white/5 pt-3">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">
                        Pièces jointes ({activeDispute.evidence.length})
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {activeDispute.evidence.map((item: string, i: number) => {
                          let safeHref: string | undefined;
                          try {
                            const url = new URL(item);
                            if (url.protocol === 'http:' || url.protocol === 'https:') {
                              safeHref = url.href;
                            }
                          } catch { /* invalid URL, leave undefined */ }
                          return (
                            <a
                              key={i}
                              href={safeHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-[10px] font-mono text-zoyd-blue hover:text-white transition-colors border border-zoyd-blue/20 px-2 py-1"
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                              Preuve {i + 1}
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    if (pendingResolve?.matchId === match.id && pendingResolve.type === 'alpha') {
                      onSetPendingResolve(null);
                      void onResolveWinner(match.id, 0);
                    } else {
                      onSetPendingResolve({ matchId: match.id, type: 'alpha' });
                    }
                  }}
                  className={`px-4 sm:px-6 py-2.5 text-[10px] font-display font-black tracking-widest uppercase italic transition-colors touch-target ${
                    pendingResolve?.matchId === match.id && pendingResolve.type === 'alpha'
                      ? 'bg-green-400 text-black'
                      : 'bg-green-500 text-black hover:bg-green-400'
                  }`}
                >
                  <CheckCircle2 className="w-3 h-3 inline mr-2" />
                  {pendingResolve?.matchId === match.id && pendingResolve.type === 'alpha' ? 'Confirmer Alpha' : 'Valider Alpha'}
                </button>
                <button
                  onClick={() => {
                    if (pendingResolve?.matchId === match.id && pendingResolve.type === 'bravo') {
                      onSetPendingResolve(null);
                      void onResolveWinner(match.id, 1);
                    } else {
                      onSetPendingResolve({ matchId: match.id, type: 'bravo' });
                    }
                  }}
                  className={`px-4 sm:px-6 py-2.5 text-[10px] font-display font-black tracking-widest uppercase italic transition-colors touch-target ${
                    pendingResolve?.matchId === match.id && pendingResolve.type === 'bravo'
                      ? 'bg-zoyd-yellow text-black'
                      : 'bg-white text-black hover:bg-zoyd-yellow'
                  }`}
                >
                  {pendingResolve?.matchId === match.id && pendingResolve.type === 'bravo' ? 'Confirmer Bravo' : 'Valider Bravo'}
                </button>
                <button
                  onClick={() => {
                    if (pendingResolve?.matchId === match.id && pendingResolve.type === 'none') {
                      onSetPendingResolve(null);
                      void onResolveDisputeOnly(match.id);
                    } else {
                      onSetPendingResolve({ matchId: match.id, type: 'none' });
                    }
                  }}
                  className={`px-4 sm:px-6 py-2.5 text-[10px] font-display font-black tracking-widest uppercase italic transition-colors touch-target ${
                    pendingResolve?.matchId === match.id && pendingResolve.type === 'none'
                      ? 'border-zoyd-blue bg-zoyd-blue text-black'
                      : 'border border-zoyd-blue/30 text-zoyd-blue hover:bg-zoyd-blue hover:text-black'
                  }`}
                >
                  {pendingResolve?.matchId === match.id && pendingResolve.type === 'none' ? 'Confirmer clore' : 'Clore sans vainqueur'}
                </button>
                <Link
                  to={`/mj/match/${match.id}`}
                  className="border border-white/10 text-white/40 px-4 sm:px-6 py-2.5 text-[10px] font-display font-black tracking-widest uppercase italic hover:text-white hover:border-white transition-colors flex items-center gap-2 touch-target"
                >
                  <Eye className="w-3 h-3" />
                  Voir le match
                </Link>
                <button
                  onClick={() => onRequestCancel(match.id)}
                  className="border px-4 sm:px-6 py-2.5 text-[10px] font-display font-black tracking-widest uppercase italic transition-colors touch-target border-white/10 text-white/30 hover:text-red-300 hover:border-red-500/30"
                >
                  <Ban className="w-3 h-3 inline mr-2" />
                  Annuler
                </button>
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

export default AdminUrgencyTab;
