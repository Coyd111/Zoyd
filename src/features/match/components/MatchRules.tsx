import React from 'react';
import type { Match } from '../../../app/stores/matchStore';

const RuleRow = ({ label, value }: { label: string; value: string }) => (
  <div className="border border-white/5 px-4 py-3 bg-black/30">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-1">{label}</div>
    <div className="font-display font-black text-white italic">{value}</div>
  </div>
);

interface MatchRulesProps {
  match: Match;
  canSeeRoom: boolean;
}

export const MatchRules: React.FC<MatchRulesProps> = ({ match, canSeeRoom }) => (
  <>
    <div className="p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-lg font-display font-black uppercase italic">Format et regles</h2>
        {match.trustScoreMin ? (
          <div className="text-[10px] font-mono uppercase tracking-widest text-zoyd-yellow border border-zoyd-yellow/20 px-3 py-1">
            Fiabilite {match.trustScoreMin}+
          </div>
        ) : null}
      </div>
      <div className="grid md:grid-cols-2 gap-4 text-sm text-white/70">
        <RuleRow label="Format" value={match.format} />
        <RuleRow label="Best of" value={`BO${match.rules.bestOf}`} />
        <RuleRow label="Score cible" value={`${match.rules.scoreTarget}`} />
        <RuleRow label="Armes" value={match.rules.weaponRestrictions || 'Toutes'} />
        <RuleRow label="Point streaks" value={match.rules.pointstreaks === 'allowed' ? 'Permises' : 'Interdites'} />
        <RuleRow label="Corps a corps" value={match.rules.meleeAllowed ? 'Autorise' : 'Interdit'} />
      </div>
    </div>

    {canSeeRoom && (
      <div className="p-6">
        <h2 className="text-lg font-display font-black uppercase italic mb-4">Salle privee du match</h2>
        {match.roomName && match.roomPassword ? (
          <div className="grid md:grid-cols-2 gap-4">
            <RuleRow label="Nom de la salle" value={match.roomName} />
            <RuleRow label="Mot de passe" value={match.roomPassword} />
          </div>
        ) : (
          <p className="text-white/40 text-sm">
            La salle sera partagee peu avant le debut du match.
          </p>
        )}
        {match.arbiter?.roomPublishedAt ? (
          <div className="mt-4 text-[10px] font-mono uppercase tracking-widest text-white/30">
            Salle publiee {new Date(match.arbiter.roomPublishedAt).toLocaleString('fr-FR')}
          </div>
        ) : null}
      </div>
    )}
  </>
);
