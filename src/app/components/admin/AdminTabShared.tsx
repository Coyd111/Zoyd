import React from 'react';
import type { Match } from '../../stores/matchStore';

export const statusToneMap: Record<string, string> = {
  recruiting: 'text-white/50 border-white/10',
  full: 'text-zoyd-yellow border-zoyd-yellow/30',
  check_in: 'text-zoyd-blue border-zoyd-blue/30',
  ready: 'text-green-400 border-green-500/30',
  in_progress: 'text-green-400 border-green-500/30',
  disputed: 'text-red-400 border-red-500/30',
  finished: 'text-white/30 border-white/10',
  cancelled: 'text-red-300 border-red-500/20',
  forfeited: 'text-red-300 border-red-500/20',
};

export const moderationToneMap: Record<string, string> = {
  success: 'text-green-400 border-green-500/20 bg-green-500/5',
  warning: 'text-zoyd-yellow border-zoyd-yellow/20 bg-zoyd-yellow/5',
  danger: 'text-red-300 border-red-500/20 bg-red-500/5',
  neutral: 'text-white/40 border-white/10 bg-black/40',
};

export const disputeCategoryLabels: Record<string, string> = {
  result: 'Score conteste',
  room_issue: 'Probleme de salle',
  no_show: 'Absence / retard',
  conduct: 'Comportement',
  other: 'Autre',
};

export type MatchFilter = 'all' | 'priority' | 'active' | 'closed';
export type UserFilter = 'all' | 'critical' | 'watch';
export type DisputeFilter = 'all' | 'escalated' | 'level1';

export type PriorityItem = {
  id: string;
  kind: 'litige' | 'signalement' | 'ops';
  label: string;
  body: string;
  timestamp: string;
  severity: number;
  action: () => void;
  actionLabel: string;
};

export type DisputeMatch = Match & {
  disputes: Array<{
    status: string;
    level?: number;
    prizePoolFrozen?: boolean;
    openedAt?: string;
    openedByPseudo?: string;
    createdAt?: string;
    category?: string;
    reason?: string;
    evidence?: string[];
    escalatedByPseudo?: string;
    escalatedAt?: string;
  }>;
  dispute?: {
    openedAt?: string;
  };
  result?: unknown;
  roomName?: string;
};

export type FlaggedUser = {
  key: string;
  pseudo: string;
  status: 'critical' | 'watch' | 'clean';
  trustScore: number | string;
  reportsCount: number;
  disputedMatches: number;
  forfeits: number;
  activityCount: number;
  hasPublicProfile: boolean;
  primaryUserId?: string;
};

export type AdminEvent = {
  id: string;
  action: string;
  target: string;
  timestamp: string;
  tone: string;
};

export const StatusPill = ({ label, tone }: { label: string; tone: string }) => (
  <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 border ${tone}`}>{label}</span>
);

export const MetaChip = ({ label, value }: { label: string; value: string }) => (
  <div className="px-3 py-2">
    <div className="text-[10px] text-white/20 mb-1">{label}</div>
    <div className="text-white/65">{value}</div>
  </div>
);

export const DisputeStat = ({ label, value }: { label: string; value: string }) => (
  <div className="px-4 py-3">
    <div className="text-[10px] uppercase tracking-widest text-white/20 mb-1">{label}</div>
    <div className="text-white">{value}</div>
  </div>
);

export const PlayerPill = ({ label, team }: { label: string; team: 0 | 1 }) => (
  <span
    className={`px-3 py-2 text-[10px] font-mono uppercase tracking-widest ${
      team === 0 ? 'text-zoyd-blue' : 'text-zoyd-yellow'
    }`}
  >
    {team === 0 ? 'A' : 'B'} / {label}
  </span>
);

export const SignalBadge = ({ label }: { label: string }) => (
  <span className="px-2 py-1 text-white/50">{label}</span>
);

export const PriorityBadge = ({ kind }: { kind: 'litige' | 'signalement' | 'ops' }) => {
  if (kind === 'litige') {
    return <StatusPill label="litige" tone="text-red-300 border-red-500/30" />;
  }
  if (kind === 'signalement') {
    return <StatusPill label="report" tone="text-zoyd-yellow border-zoyd-yellow/30" />;
  }
  return <StatusPill label="ops" tone="text-zoyd-blue border-zoyd-blue/30" />;
};

export const StatCard = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="p-6 flex items-center gap-4">
    <div className="w-12 h-12 flex items-center justify-center">{icon}</div>
    <div>
      <div className="text-[10px] font-mono text-white/20 uppercase tracking-widest mb-1">{label}</div>
      <div className="text-2xl font-display font-black italic">{value}</div>
    </div>
  </div>
);

export const FocusCard = ({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}) => (
  <div className={`p-4 ${moderationToneMap[tone]}`}>
    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest mb-3">
      {icon}
      {label}
    </div>
    <div className="text-2xl font-display font-black italic text-white">{value}</div>
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/25 mt-1">{detail}</div>
  </div>
);

export const StatusLane = ({
  label,
  count,
  body,
  accent,
}: {
  label: string;
  count: number;
  body: string;
  accent: string;
}) => (
  <div className="p-4">
    <div className="flex items-center justify-between gap-3 mb-3">
      <div className="font-display font-black text-sm uppercase italic">{label}</div>
      <div className="text-xl font-display font-black italic text-white">{count}</div>
    </div>
    <div className="h-1 bg-white/5 mb-3 overflow-hidden">
      <div className={`${accent} h-full`} style={{ width: `${Math.min(100, count * 18)}%` }} />
    </div>
    <p className="text-[11px] text-white/40">{body}</p>
  </div>
);
