import React from 'react';
import { Link } from 'react-router';
import { formatZC } from '../../../lib/utils';

interface BracketActionsProps {
  user: { id: string; pseudo: string; rankMJ?: string } | null;
  availableSpend: number;
  registrationCost: number;
  requiredTopUp: number;
  fundingPath: string;
  teamSize: number;
  canRegister: boolean;
  canJoinArbiter: boolean;
  canStartTournament: boolean;
  tournamentStatus: string;
  myEntry?: { id: string; squadName: string; members: Array<{ pseudo: string }> };
  myArbiterSlot?: { slot: number };
  tournamentName: string;
  squadName: string;
  teammateInputs: string[];
  onSquadNameChange: (value: string) => void;
  onTeammateInputChange: (index: number, value: string) => void;
  onRegister: () => void;
  onLeave: () => void;
  onJoinArbiter: () => void;
  onStartTournament: () => void;
}

const BracketActions: React.FC<BracketActionsProps> = ({
  user,
  availableSpend,
  registrationCost,
  requiredTopUp,
  fundingPath,
  teamSize,
  canRegister,
  canJoinArbiter,
  canStartTournament,
  tournamentStatus,
  myEntry,
  myArbiterSlot,
  tournamentName,
  squadName,
  teammateInputs,
  onSquadNameChange,
  onTeammateInputChange,
  onRegister,
  onLeave,
  onJoinArbiter,
  onStartTournament,
}) => (
  <div className="hud-panel p-6 bg-zoyd-surface/20">
    <div className="flex items-center justify-between gap-4 mb-5">
      <h2 className="text-lg font-display font-black uppercase italic">Rejoindre le tournoi</h2>
      <div className="text-[10px] font-mono uppercase tracking-widest text-white/30">
        0% de commission joueur
      </div>
    </div>

    {!user ? (
      <div className="space-y-4">
        <p className="text-white/40 text-sm">
          Connecte-toi pour t'inscrire, ajouter ton equipe ou suivre ton prochain duel.
        </p>
        <Link
          to="/auth/login"
          className="inline-flex items-center gap-2 bg-white text-black px-5 py-3 font-display font-black uppercase tracking-widest text-xs italic"
        >
          Connexion joueur
        </Link>
      </div>
    ) : (
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="border border-white/10 bg-black/40 p-4 text-sm text-white/60">
            Ton solde dispo:{' '}
            <span className="text-zoyd-yellow font-display font-black">{formatZC(availableSpend)}</span>
          </div>
          <div className="border border-white/10 bg-black/40 p-4 text-sm text-white/60">
            {teamSize > 1 ? 'Cout pour ton equipe:' : 'Cout inscription:'}{' '}
            <span className="text-white font-display font-black">{formatZC(registrationCost)}</span>
          </div>
        </div>

        {canRegister && requiredTopUp > 0 ? (
          <div className="border border-zoyd-yellow/20 bg-zoyd-yellow/5 p-4 text-sm text-white/70">
            Il te manque{' '}
            <span className="font-display font-black text-zoyd-yellow">{formatZC(requiredTopUp)}</span>{' '}
            pour confirmer cette inscription.
            <div className="mt-3">
              <Link
                to={fundingPath}
                className="inline-flex items-center gap-2 border border-zoyd-yellow/30 px-4 py-3 text-[10px] font-display font-black uppercase tracking-widest text-zoyd-yellow hover:bg-zoyd-yellow hover:text-black transition-colors"
              >
                Ajouter mes ZC
              </Link>
            </div>
          </div>
        ) : null}

        {canRegister && teamSize > 1 ? (
          <div className="border border-white/10 bg-black/40 p-4 space-y-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-zoyd-yellow">
              Ton equipe
            </div>
            <input
              type="text"
              value={squadName}
              onChange={(event) => onSquadNameChange(event.target.value)}
              placeholder="Nom de ton equipe"
              className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-yellow"
            />
            <div className="grid gap-3">
              {teammateInputs.map((value, index) => (
                <input
                  key={`teammate-${index + 2}`}
                  type="text"
                  value={value}
                  onChange={(event) => onTeammateInputChange(index, event.target.value)}
                  placeholder={`Coequipier ${index + 2} / pseudo CODM`}
                  className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-yellow"
                />
              ))}
            </div>
            <p className="text-xs text-white/35">
              Le capitaine confirme l'inscription pour toute l'equipe de {teamSize} joueurs.
            </p>
          </div>
        ) : null}

        {canRegister ? (
          <button
            onClick={onRegister}
            className="w-full bg-white text-black py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-zoyd-yellow transition-colors"
          >
            {teamSize > 1
              ? "Confirmer mon equipe"
              : "Confirmer mon inscription"}
          </button>
        ) : null}

        {myEntry ? (
          <div className="border border-green-400/20 bg-green-400/5 p-4 text-sm text-white/70">
            Inscription confirmee pour <strong className="text-white">{myEntry.squadName}</strong>.
            {' '}
            Roster: {myEntry.members.map((member) => member.pseudo).join(' / ')}.
          </div>
        ) : null}

        {myEntry && tournamentStatus === 'recruiting' ? (
          <button
            onClick={onLeave}
            className="w-full border border-white/10 py-4 font-display font-black uppercase tracking-widest text-xs italic hover:border-zoyd-yellow hover:text-zoyd-yellow transition-colors"
          >
            Retirer mon inscription
          </button>
        ) : null}

        {canJoinArbiter ? (
          <button
            onClick={onJoinArbiter}
            className="w-full border border-zoyd-blue/30 text-zoyd-blue py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-zoyd-blue hover:text-black transition-colors"
          >
            Prendre une place d'arbitre
          </button>
        ) : null}

        {canStartTournament ? (
          <button
            onClick={onStartTournament}
            className="w-full bg-zoyd-yellow text-black py-4 font-display font-black uppercase tracking-widest text-xs italic"
          >
            Lancer le tableau
          </button>
        ) : null}

        {teamSize > 1 ? (
          <p className="text-xs text-white/35">
            Chaque inscription represente une equipe complete. Une fois tout le monde pret, le tableau se
            lance equipe contre equipe.
          </p>
        ) : null}
      </div>
    )}
  </div>
);

export default BracketActions;
