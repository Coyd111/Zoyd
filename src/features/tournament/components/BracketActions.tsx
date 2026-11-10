/**
 * BracketActions - barre d'action du bracket (inscription, arbitrage, ...).
 *
 * Squads libres (2026-11-05) : le capitaine n'inscrit PLUS une equipe, il cree
 * une squad avec son seul pass. La squad est ouverte (quiconque est compatible
 * rejoint, chacun pour son compte) ou privee (sur invitation). Les squads qui
 * recrutent sont listees ici, avec un bouton Rejoindre qui verrouille le pass
 * DE L'APPELANT.
 *
 * INVARIANT : la disponibilite des actions vient du parent, qui combine le
 * role, le statut du tournoi et la presence d'une entree. Ce composant ne
 * decide rien seul.
 * INVARIANT : le cout affiche est le pass INDIVIDUEL (entryFee), jamais
 * entryFee x teamSize : chaque joueur paie pour lui, le capitaine ne gere
 * jamais l'argent des autres.
 * INVARIANT : le deficit de solde passe par walletFunding : construire le
 * lien de recharge avec buildFundingPath, qui assainit la destination.
 * PIEGE : une inscription a un cout : le bouton doit rester desactive
 * pendant la soumission, sinon un double-clic cree deux inscriptions.
 * PIEGE : le pass d'un tournoi n'est PAS remboursable apres le lancement :
 * l'interface doit le dire avant le clic, pas apres.
 */
import React from 'react';
import { Link } from 'react-router';
import { formatZC } from '../../../lib/utils';
import type { TournamentEntry, TournamentSquadAccess } from '../../../app/stores/tournamentStore';

interface JoinableSquad {
  id: string;
  squadName: string;
  captainPseudo: string;
  memberCount: number;
  teamSize: number;
  access: TournamentSquadAccess;
}

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
  myEntry?: TournamentEntry;
  myArbiterSlot?: { slot: number };
  tournamentName: string;
  squadName: string;
  squadAccess: TournamentSquadAccess;
  invitedInputs: string[];
  joinableSquads: JoinableSquad[];
  onSquadNameChange: (value: string) => void;
  onSquadAccessChange: (value: TournamentSquadAccess) => void;
  onInvitedInputChange: (index: number, value: string) => void;
  onJoinSquad: (entryId: string) => void;
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
  squadName,
  squadAccess,
  invitedInputs,
  joinableSquads,
  onSquadNameChange,
  onSquadAccessChange,
  onInvitedInputChange,
  onJoinSquad,
  onRegister,
  onLeave,
  onJoinArbiter,
  onStartTournament,
}) => (
  <div className="hud-panel p-6 bg-zoyd-surface/20">
    <div className="flex items-center justify-between gap-4 mb-5">
      <h2 className="text-lg font-display font-black uppercase italic">Rejoindre le tournoi</h2>
      <div className="text-[10px] font-mono uppercase tracking-widest text-white/60">
        0% de commission joueur
      </div>
    </div>

    {!user ? (
      <div className="space-y-4">
        <p className="text-white/70 text-sm">
          Connecte-toi pour créer ta squad, rejoindre une team ou suivre ton prochain duel.
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
            {teamSize > 1 ? 'Ton pass:' : 'Cout inscription:'}{' '}
            <span className="text-white font-display font-black">{formatZC(registrationCost)}</span>
          </div>
        </div>

        {canRegister && requiredTopUp > 0 ? (
          <div className="border border-zoyd-yellow/20 bg-zoyd-yellow/5 p-4 text-sm text-white/70">
            Il te manque{' '}
            <span className="font-display font-black text-zoyd-yellow">{formatZC(requiredTopUp)}</span>{' '}
            pour verrouiller ton pass.
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
              Ta squad
            </div>
            <input
              type="text"
              value={squadName}
              onChange={(event) => onSquadNameChange(event.target.value)}
              placeholder="Nom de ta squad"
              className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white focus:border-zoyd-yellow"
            />
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Acces de la squad">
              <button
                type="button"
                onClick={() => onSquadAccessChange('open')}
                aria-pressed={squadAccess === 'open'}
                className={`px-3 py-3 text-[10px] font-display font-black uppercase tracking-widest border transition-colors ${
                  squadAccess === 'open'
                    ? 'border-zoyd-yellow text-zoyd-yellow bg-zoyd-yellow/10'
                    : 'border-white/10 text-white/60 hover:text-white'
                }`}
              >
                Ouverte
              </button>
              <button
                type="button"
                onClick={() => onSquadAccessChange('private')}
                aria-pressed={squadAccess === 'private'}
                className={`px-3 py-3 text-[10px] font-display font-black uppercase tracking-widest border transition-colors ${
                  squadAccess === 'private'
                    ? 'border-zoyd-yellow text-zoyd-yellow bg-zoyd-yellow/10'
                    : 'border-white/10 text-white/60 hover:text-white'
                }`}
              >
                Sur invitation
              </button>
            </div>
            {squadAccess === 'private' ? (
              <div className="grid gap-3">
                <div className="text-[10px] font-mono uppercase tracking-widest text-white/50">
                  Invitations ({invitedInputs.length} max)
                </div>
                {invitedInputs.map((value, index) => (
                  <input
                    key={`invite-${index + 1}`}
                    type="text"
                    value={value}
                    onChange={(event) => onInvitedInputChange(index, event.target.value)}
                    placeholder={`Pseudo invite ${index + 1}`}
                    className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white focus:border-zoyd-yellow"
                  />
                ))}
              </div>
            ) : null}
            <p className="text-xs text-white/70">
              TOI SEUL paies ce pass : {formatZC(registrationCost)} verrouilles sur ton compte. Chaque joueur
              qui rejoint paie SON propre pass depuis SON portefeuille : tu ne geres jamais l&apos;argent
              des autres. Les gains sont divises et verses directement a chaque membre.
              {squadAccess === 'private' ? ' En squad privee, seuls les pseudos invites peuvent rejoindre.' : ''}
            </p>
          </div>
        ) : null}

        {canRegister ? (
          <button
            onClick={onRegister}
            className="w-full bg-white text-black py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-zoyd-yellow transition-colors"
          >
            {teamSize > 1 ? 'Créer ma squad' : 'Confirmer mon inscription'}
          </button>
        ) : null}

        {myEntry ? (
          <div className="border border-green-400/20 bg-green-400/5 p-4 text-sm text-white/70">
            Inscription confirmee pour <strong className="text-white">{myEntry.squadName}</strong>.
            {' '}
            Roster: {myEntry.members.map((member) => member.pseudo).join(' / ')}.
            {myEntry.members.length < myEntry.teamSize ? (
              <>
                <div className="mt-2 text-xs">
                  Il reste {myEntry.teamSize - myEntry.members.length} place
                  {myEntry.teamSize - myEntry.members.length > 1 ? 's' : ''} libre
                  {myEntry.teamSize - myEntry.members.length > 1 ? 's' : ''} :{' '}
                  {myEntry.access === 'private'
                    ? 'les joueurs invites rejoignent depuis leur compte.'
                    : 'les joueurs compatibles peuvent rejoindre depuis leur compte.'}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {joinableSquads.length > 0 ? (
          <div className="border border-white/10 bg-black/40 p-4 space-y-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-zoyd-yellow">
              Squads qui recrutent
            </div>
            {joinableSquads.map((squad) => (
              <div key={squad.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="text-white/70 min-w-0">
                  <span className="text-white font-display font-bold">{squad.squadName}</span>{' '}
                  <span className="text-white/50">({squad.captainPseudo})</span>
                  <div className="text-xs text-white/50">
                    {squad.memberCount}/{squad.teamSize} joueurs
                    {squad.access === 'private' ? ' · invitation' : ''}
                  </div>
                </div>
                <button
                  onClick={() => onJoinSquad(squad.id)}
                  className="border border-white/20 px-3 py-2 text-[10px] font-display font-black uppercase tracking-widest text-white hover:border-zoyd-yellow hover:text-zoyd-yellow transition-colors shrink-0"
                >
                  Rejoindre
                </button>
              </div>
            ))}
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
            Prendre une place d&apos;arbitre
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
          <p className="text-xs text-white/70">
            Une squad peut se presenter incomplete : d&apos;autres joueurs la rejoignent jusqu&apos;au
            lancement. Une squad toujours incomplete au lancement est retiree, chaque pass est rembourse
            a son proprietaire. Les gains du podium sont divises en parts egales et verses directement a
            chaque membre.
          </p>
        ) : null}
      </div>
    )}
  </div>
);

export default BracketActions;
