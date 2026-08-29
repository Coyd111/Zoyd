import React from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Clock3, CreditCard, ShieldCheck, Users } from 'lucide-react';
import { formatZC } from '../../../lib/utils';
import type { TournamentStatus } from '../../../app/stores/tournamentStore';

interface Tournament {
  id: string;
  name: string;
  status: TournamentStatus;
  entryFee: number;
  teamSize: number;
  format: string;
  arbiters: Array<{ userId?: string }>;
  arbitersNeeded: number;
  entries: Array<unknown>;
  maxEntries: number;
  startsAt: string;
  payout: { playerPool: number };
}

const statusLabels: Record<TournamentStatus, string> = {
  recruiting: 'Recrutement ouvert',
  live: 'Tournoi en cours',
  completed: 'Tournoi termine',
  cancelled: 'Tournoi annulé',
};

const InfoCard = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="hud-panel p-5 bg-zoyd-surface/20">
    <div className="flex items-center gap-3 mb-3">
      {icon}
      <span className="text-[10px] font-mono uppercase tracking-widest text-white/30">{label}</span>
    </div>
    <div className="text-2xl font-display font-black italic text-white">{value}</div>
  </div>
);

const BracketHeader: React.FC<{ tournament: Tournament }> = ({ tournament }) => (
  <>
    <header className="relative border-b border-white/5 bg-zoyd-surface/40">
      <div className="max-w-[1500px] mx-auto px-4 md:px-8 py-6 md:py-8 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div className="flex items-center gap-6">
          <Link
            to="/mj/tournois"
            className="w-10 h-10 border border-white/10 flex items-center justify-center hover:bg-white hover:text-black transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-[10px] font-mono font-black text-zoyd-yellow uppercase tracking-widest italic">
                ID: {tournament.id}
              </span>
              <span className="w-1 h-1 bg-white/20 rounded-full" />
              <span className="text-[10px] font-mono font-black text-zoyd-blue uppercase tracking-widest border border-zoyd-blue/30 px-2 py-0.5">
                {statusLabels[tournament.status]}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-5xl font-display font-black uppercase tracking-tighter italic">
              {tournament.name}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-8">
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Cagnotte joueurs</span>
            <span className="text-2xl font-display font-black text-zoyd-yellow italic">
              {formatZC(tournament.payout.playerPool)}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Inscrits</span>
            <span className="text-2xl font-display font-black text-white italic">
              {tournament.entries.length}/{tournament.maxEntries}
            </span>
          </div>
        </div>
      </div>
    </header>

    <div className="grid md:grid-cols-4 gap-4">
      <InfoCard
        icon={<CreditCard className="w-5 h-5 text-zoyd-yellow" />}
        label={tournament.teamSize > 1 ? 'Pass / joueur' : 'Pass'}
        value={formatZC(tournament.entryFee)}
      />
      <InfoCard icon={<Users className="w-5 h-5 text-white" />} label="Format" value={tournament.format} />
      <InfoCard
        icon={<ShieldCheck className="w-5 h-5 text-zoyd-blue" />}
        label="Arbitres"
        value={`${tournament.arbiters.filter((arbiter) => arbiter.userId).length}/${tournament.arbitersNeeded}`}
      />
      <InfoCard
        icon={<Clock3 className="w-5 h-5 text-white/60" />}
        label="Fenetre"
        value={new Date(tournament.startsAt).toLocaleString('fr-FR', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      />
    </div>
  </>
);

export default BracketHeader;
