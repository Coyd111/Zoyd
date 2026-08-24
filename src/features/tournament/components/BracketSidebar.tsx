import React from 'react';
import { CheckCircle2, Gamepad2, Radio } from 'lucide-react';
import type { Tournament, TournamentMatch } from '../../../app/stores/tournamentStore';

const RuleRow = ({ label, value }: { label: string; value: string }) => (
  <div className="border border-white/5 px-4 py-3 bg-black/30">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-1">{label}</div>
    <div className="font-display font-black text-white italic">{value}</div>
  </div>
);

interface BracketSidebarProps {
  tournament: Tournament;
  myEntry?: Tournament['entries'][number];
  myArbiterSlot?: { slot: number };
  participantMatch?: TournamentMatch;
  userPseudo?: string;
}

const BracketSidebar: React.FC<BracketSidebarProps> = ({
  tournament,
  myEntry,
  myArbiterSlot,
  participantMatch,
  userPseudo,
}) => {
  const participantLabel = tournament.teamSize > 1 ? 'Equipes inscrites' : 'Joueurs inscrits';
  const participantSlotLabel = tournament.teamSize > 1 ? 'equipes' : 'joueurs';

  return (
    <div className="space-y-8">
      <div className="hud-panel p-6 bg-zoyd-surface/20">
        <div className="flex items-center gap-3 mb-4">
          <Gamepad2 className="w-5 h-5 text-zoyd-blue" />
          <h2 className="text-lg font-display font-black uppercase italic">Regles officielles</h2>
        </div>
        <div className="grid md:grid-cols-2 gap-4 text-sm text-white/70">
          <RuleRow label="Mode" value={tournament.rules.mode} />
          <RuleRow label="Best of" value={`BO${tournament.rules.bestOf}`} />
          <RuleRow label="Score cible" value={`${tournament.rules.scoreTarget}`} />
          <RuleRow
            label="Point streaks"
            value={tournament.rules.pointstreaks === 'allowed' ? 'Permises' : 'Interdites'}
          />
          <RuleRow
            label="Corps a corps"
            value={tournament.rules.meleeAllowed ? 'Autorise' : 'Interdit'}
          />
          <RuleRow label="Map pool" value={tournament.rules.mapPool.join(' / ')} />
        </div>
        <p className="text-xs text-white/35 mt-4">
          {tournament.rules.notes || "Aucun match n'est planifie entre 00h00 et 07h00."}
        </p>
      </div>

      <div className="hud-panel p-6 bg-zoyd-surface/20">
        <div className="flex items-center justify-between gap-4 mb-5">
          <h2 className="text-lg font-display font-black uppercase italic">{participantLabel}</h2>
          <div className="text-[10px] font-mono uppercase tracking-widest text-white/30">
            {tournament.entries.length} / {tournament.maxEntries} {participantSlotLabel}
          </div>
        </div>
        <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
          {tournament.entries.map((entry) => (
            <div
              key={entry.id}
              className={`border px-4 py-3 bg-black/40 ${
                myEntry?.id === entry.id ? 'border-zoyd-yellow/30' : 'border-white/5'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-display font-black text-sm uppercase italic text-white">
                    #{entry.seed} - {entry.squadName}
                  </div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                    {entry.captainPseudo}
                    {entry.finalPlacement ? ` - Top ${entry.finalPlacement}` : ''}
                  </div>
                </div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-white/30">
                  {entry.wins} vic. / {entry.losses} def.
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {entry.members.map((member) => (
                  <span
                    key={member.userId}
                    className={`border px-2 py-1 text-[10px] font-mono uppercase tracking-widest ${
                      member.isCaptain
                        ? 'border-zoyd-yellow/20 text-zoyd-yellow'
                        : 'border-white/10 text-white/40'
                    }`}
                  >
                    {member.pseudo}
                    {member.isCaptain ? ' (C)' : ''}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {participantMatch ? (
        <div className="hud-panel p-6 bg-zoyd-surface/20">
          <div className="flex items-center gap-3 mb-4">
            <Radio className="w-4 h-4 text-zoyd-yellow" />
            <h2 className="text-lg font-display font-black uppercase italic">Ton prochain duel</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <RuleRow
              label={tournament.teamSize > 1 ? 'Equipe A' : 'Joueur A'}
              value={tournament.entries.find((entry) => entry.id === participantMatch.entryAId)?.squadName || 'A confirmer'}
            />
            <RuleRow
              label={tournament.teamSize > 1 ? 'Equipe B' : 'Joueur B'}
              value={tournament.entries.find((entry) => entry.id === participantMatch.entryBId)?.squadName || 'A confirmer'}
            />
            <RuleRow
              label="Horaire"
              value={
                participantMatch.scheduledAt
                  ? new Date(participantMatch.scheduledAt).toLocaleString('fr-FR')
                  : 'A confirmer'
              }
            />
            <RuleRow label="Salle" value={participantMatch.roomName || 'A partager'} />
          </div>
          {participantMatch.roomPassword ? (
            <div className="mt-4 border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/70">
              Mot de passe de la salle: <strong className="text-white">{participantMatch.roomPassword}</strong>
            </div>
          ) : null}
        </div>
      ) : null}

      {myArbiterSlot ? (
        <div className="hud-panel p-6 bg-zoyd-surface/20">
          <div className="flex items-center gap-3 mb-4">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <h2 className="text-lg font-display font-black uppercase italic">Place d'arbitre</h2>
          </div>
          <div className="border border-zoyd-blue/20 bg-zoyd-blue/5 p-4 text-sm text-white/70">
            Place d'arbitre #{myArbiterSlot.slot} active. Les duels que tu accompagnes apparaitront juste
            en dessous.
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default BracketSidebar;
