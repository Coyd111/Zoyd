import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import {
  assignServerTournamentArbiter,
  fetchServerTournament,
  leaveServerTournament,
  registerForServerTournament,
  setServerTournamentMatchLive,
  setServerTournamentRoomDetails,
  startServerTournament,
  submitServerTournamentResult,
} from '../../../app/lib/tournamentApi';
import { applyServerAccountState } from '../../../app/lib/serverSync';
import { useAuthStore, type User } from '../../../app/stores/authStore';
import type { WalletSnapshot } from '../../../app/lib/walletApi';
import { useTournamentStore } from '../../../app/stores/tournamentStore';
import { useWalletStore } from '../../../app/stores/walletStore';
import { buildFundingPath, getRequiredTopUp } from '../../../lib/walletFunding';
import { formatZC } from '../../../lib/utils';
import BracketHeader from '../components/BracketHeader';
import BracketGrid from '../components/BracketGrid';
import BracketSidebar from '../components/BracketSidebar';
import BracketActions from '../components/BracketActions';
import { Helmet } from 'react-helmet-async';

const TournamentBracketPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { getAvailableToSpend } = useWalletStore();
  const getTournamentById = useTournamentStore((state) => state.getTournamentById);
  const hydrateTournaments = useTournamentStore((state) => state.hydrateFromServer);

  const [selectedMatchId, setSelectedMatchId] = useState('');
  const [roomName, setRoomName] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [scoreA, setScoreA] = useState('0');
  const [scoreB, setScoreB] = useState('0');
  const [notes, setNotes] = useState('');
  const [squadName, setSquadName] = useState('');
  const [teammateInputs, setTeammateInputs] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  const tournament = id ? getTournamentById(id) : undefined;
  const availableSpend = getAvailableToSpend();

  const loadTournament = useCallback(async () => {
    if (!id) return;
    try {
      setLoadError(null);
      setIsLoading(true);
      const response = await fetchServerTournament(id);
      hydrateTournaments([response.tournament]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Impossible de charger ce tournoi.');
    } finally {
      setIsLoading(false);
    }
  }, [id, hydrateTournaments]);

  useEffect(() => {
    void loadTournament();
  }, [loadTournament]);

  const myEntry = useMemo(
    () => tournament?.entries.find((entry) => entry.members.some((member) => member.userId === user?.id)),
    [tournament?.entries, user?.id]
  );
  const myArbiterSlot = useMemo(
    () => tournament?.arbiters.find((arbiter) => arbiter.userId === user?.id),
    [tournament?.arbiters, user?.id]
  );

  const actionableMatches = useMemo(() => {
    if (!tournament || !myArbiterSlot) return [];
    return tournament.matches.filter(
      (match) => match.arbiterSlot === myArbiterSlot.slot && (match.status === 'ready' || match.status === 'live')
    );
  }, [myArbiterSlot, tournament]);

  useEffect(() => {
    if (!actionableMatches.some((match) => match.id === selectedMatchId)) {
      setSelectedMatchId(actionableMatches[0]?.id || '');
    }
  }, [actionableMatches, selectedMatchId]);

  useEffect(() => {
    if (!tournament || tournament.teamSize <= 1) {
      setTeammateInputs([]);
      return;
    }

    setSquadName((current) => current || `${user?.pseudo || 'Squad'} Squad`);
    setTeammateInputs((current) =>
      Array.from({ length: Math.max(0, tournament.teamSize - 1) }, (_, index) => current[index] || '')
    );
  }, [tournament?.id, tournament?.teamSize, user?.pseudo]);

  const selectedMatch = tournament?.matches.find((match) => match.id === selectedMatchId);
  const participantMatch = useMemo(() => {
    if (!tournament || !myEntry) return undefined;
    return tournament.matches.find(
      (match) =>
        (match.entryAId === myEntry.id || match.entryBId === myEntry.id) &&
        ['ready', 'live'].includes(match.status)
    );
  }, [myEntry, tournament]);

  if (!id) return null;

  if (!tournament && isLoading) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white flex items-center justify-center safe-top safe-bottom">
        <div className="text-center">
          <h2 className="text-2xl font-display font-black uppercase mb-4">Chargement du tournoi</h2>
          <p className="text-white/40">Le bracket et les inscriptions se synchronisent avec le serveur.</p>
        </div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white flex items-center justify-center safe-top safe-bottom">
        <div className="text-center">
          <h2 className="text-2xl font-display font-black uppercase mb-4">Tournoi introuvable</h2>
          {loadError ? <p className="text-sm text-red-200 mb-4">{loadError}</p> : null}
          {loadError ? (
            <button onClick={() => void loadTournament()} className="underline hover:text-white text-sm text-red-200">
              Réessayer
            </button>
          ) : null}
          <Link
            to="/mj/tournois"
            className="border border-white/10 px-6 py-3 uppercase text-sm font-display font-black tracking-widest"
          >
            Retour aux tournois
          </Link>
        </div>
      </div>
    );
  }

  const hasOpenArbiterSlot = tournament.arbiters.some((arbiter) => !arbiter.userId);
  const registrationCost = tournament.entryFee * tournament.teamSize;
  const requiredTopUp = getRequiredTopUp(registrationCost, availableSpend);
  const fundingPath = buildFundingPath({
    context: 'tournament-entry',
    requiredAmount: registrationCost,
    availableAmount: availableSpend,
    returnTo: `/mj/tournois/${tournament.id}`,
  });
  const canRegister = !!user && !myEntry && !myArbiterSlot && tournament.status === 'recruiting';
  const canJoinArbiter = !!user && !myEntry && !myArbiterSlot && hasOpenArbiterSlot;
  const canStartTournament =
    !!myArbiterSlot &&
    tournament.status === 'recruiting' &&
    tournament.entries.length >= tournament.minEntries &&
    tournament.arbiters.every((arbiter) => !!arbiter.userId);
  const champion = tournament.entries.find((entry) => entry.finalPlacement === 1);
  const bronzeMatch = tournament.matches.find((match) => match.bracketType === 'third_place');

  const updateTeammateInput = (index: number, value: string) => {
    setTeammateInputs((current) => current.map((entry, entryIndex) => (entryIndex === index ? value : entry)));
  };

  const applyTournamentResponse = (payload: { tournament: typeof tournament; user?: Partial<User>; wallet?: WalletSnapshot | null }) => {
    hydrateTournaments([payload.tournament]);
    applyServerAccountState(payload);
  };

  const handleRegister = async () => {
    if (!user) {
      navigate('/auth/login');
      return;
    }

    const cleanedSquadName = squadName.trim();
    const cleanedTeammates = teammateInputs.map((entry) => entry.trim());

    if (tournament.teamSize > 1) {
      if (cleanedSquadName.length < 3) {
        toast.error('Donne un nom clair a ton equipe avant de valider.');
        return;
      }
      if (cleanedTeammates.some((entry) => entry.length < 2)) {
        toast.error(`Ajoute les ${tournament.teamSize - 1} coequipiers avant de confirmer ton equipe.`);
        return;
      }

      const rosterKeys = new Set<string>();
      for (const pseudo of [user.pseudo, ...cleanedTeammates]) {
        const key = pseudo.toLowerCase();
        if (rosterKeys.has(key)) {
          toast.error('Chaque pseudo de ton equipe doit etre unique.');
          return;
        }
        rosterKeys.add(key);
      }
    }

    if (availableSpend < registrationCost) {
      toast.error("Solde insuffisant. Ajoute des ZC avant de confirmer ton inscription.");
      navigate(fundingPath);
      return;
    }

    try {
      const response = await registerForServerTournament(tournament.id, {
        pseudo: user.pseudo,
        rankMJ: user.rankMJ,
        squadName: tournament.teamSize > 1 ? cleanedSquadName : undefined,
        teammates: tournament.teamSize > 1 ? cleanedTeammates.map((pseudo) => ({ pseudo })) : undefined,
      });
      applyTournamentResponse(response);
      toast.success(
        tournament.teamSize === 1
          ? `Ta place est reservee pour ${tournament.name}.`
          : `${cleanedSquadName} est maintenant inscrite a ${tournament.name}.`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tournament.teamSize === 1
            ? "Impossible de confirmer ton inscription avec ton profil actuel."
            : "Impossible de confirmer cette equipe pour le moment."
      );
    }
  };

  const handleLeave = async () => {
    if (!user || !myEntry) return;
    try {
      const response = await leaveServerTournament(tournament.id);
      applyTournamentResponse(response);
      toast.success('Inscription retiree et pass rembourse.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de retirer cette inscription.");
    }
  };

  const handleJoinArbiter = async () => {
    if (!user) {
      navigate('/auth/login');
      return;
    }

    try {
      const response = await assignServerTournamentArbiter(tournament.id);
      applyTournamentResponse(response);
      toast.success("Place d'arbitre reservee. Tu peux maintenant accompagner les duels.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "La place d'arbitre n'est plus disponible.");
    }
  };

  const handleStartTournament = async () => {
    try {
      const response = await startServerTournament(tournament.id);
      applyTournamentResponse(response);
      toast.success('Le tableau est pret. Les premiers duels peuvent commencer.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Le tournoi ne peut pas demarrer tout de suite.");
    }
  };

  const handleSaveRoom = async () => {
    if (!selectedMatch || !roomName || !roomPassword) {
      toast.error('Entre un nom de salle et un mot de passe.');
      return;
    }
    try {
      const response = await setServerTournamentRoomDetails(tournament.id, selectedMatch.id, roomName, roomPassword);
      applyTournamentResponse(response);
      toast.success('La salle privee a ete partagee pour ce duel.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible de partager la salle pour ce duel.');
    }
  };

  const handleSetLive = async () => {
    if (!selectedMatch) return;
    try {
      const response = await setServerTournamentMatchLive(tournament.id, selectedMatch.id);
      applyTournamentResponse(response);
      toast.success('Le duel est maintenant en cours.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible de passer ce duel en direct.');
    }
  };

  const handleSubmitResult = async () => {
    if (!selectedMatch || !selectedMatch.entryAId || !selectedMatch.entryBId) return;
    const alpha = Number(scoreA);
    const bravo = Number(scoreB);

    if (alpha === bravo) {
      toast.error('Le score final doit donner un vainqueur.');
      return;
    }

    const winnerEntryId = alpha > bravo ? selectedMatch.entryAId : selectedMatch.entryBId;
    try {
      const response = await submitServerTournamentResult(tournament.id, selectedMatch.id, {
        winnerEntryId,
        scoreA: alpha,
        scoreB: bravo,
        notes,
      });
      applyTournamentResponse(response);
      toast.success('Score valide. Le tableau avance.');
      setNotes('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible de valider ce score.');
    }
  };

  return (
    <div className="min-h-dvh bg-zoyd-black text-white scanline font-ui pb-24 lg:pb-0 safe-top">
      <Helmet>
        <title>Bracket du tournoi — ZOYD</title>
        <meta name="description" content="Consulte le bracket d'un tournoi ZOYD." />
      </Helmet>
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <BracketHeader tournament={tournament} />

      <main className="max-w-[1500px] mx-auto px-4 md:px-8 py-8 md:py-12 relative z-10 space-y-10">
        {loadError ? (
          <div className="border border-red-400/20 bg-red-400/5 px-5 py-4 text-sm text-red-200">
            {loadError}
            <button onClick={() => void loadTournament()} className="ml-4 underline hover:text-white">
              Réessayer
            </button>
          </div>
        ) : null}

        <div className="grid xl:grid-cols-[0.95fr_1.05fr] gap-8">
          <div className="space-y-8">
            <BracketActions
              user={user}
              availableSpend={availableSpend}
              registrationCost={registrationCost}
              requiredTopUp={requiredTopUp}
              fundingPath={fundingPath}
              teamSize={tournament.teamSize}
              canRegister={canRegister}
              canJoinArbiter={canJoinArbiter}
              canStartTournament={canStartTournament}
              tournamentStatus={tournament.status}
              myEntry={myEntry}
              myArbiterSlot={myArbiterSlot}
              tournamentName={tournament.name}
              squadName={squadName}
              teammateInputs={teammateInputs}
              onSquadNameChange={setSquadName}
              onTeammateInputChange={updateTeammateInput}
              onRegister={handleRegister}
              onLeave={() => setConfirmAction('leave')}
              onJoinArbiter={handleJoinArbiter}
              onStartTournament={handleStartTournament}
            />

            <BracketSidebar
              tournament={tournament}
              myEntry={myEntry}
              myArbiterSlot={myArbiterSlot}
              participantMatch={participantMatch}
              userPseudo={user?.pseudo}
            />
          </div>

          <div className="space-y-8">
            <BracketGrid
              tournament={tournament}
              selectedMatchId={selectedMatchId}
              onSelectMatch={setSelectedMatchId}
              champion={champion ? { squadName: champion.squadName } : undefined}
              bronzeMatch={bronzeMatch}
            />

            {selectedMatch && myArbiterSlot ? (
              <div className="hud-panel p-6 bg-zoyd-surface/20">
                <div className="flex items-center justify-between gap-4 mb-5">
                  <h2 className="text-lg font-display font-black uppercase italic">Espace arbitre</h2>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-white/30">
                    Poste #{myArbiterSlot.slot}
                  </div>
                </div>

                {actionableMatches.length > 0 ? (
                  <div className="space-y-5">
                    <select
                      value={selectedMatchId}
                      onChange={(event) => setSelectedMatchId(event.target.value)}
                      className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white focus:border-zoyd-blue"
                    >
                      {actionableMatches.map((match) => {
                        const entryA =
                          tournament.entries.find((entry) => entry.id === match.entryAId)?.squadName || 'A confirmer';
                        const entryB =
                          tournament.entries.find((entry) => entry.id === match.entryBId)?.squadName || 'A confirmer';
                        return (
                          <option key={match.id} value={match.id}>
                            {entryA} vs {entryB}
                          </option>
                        );
                      })}
                    </select>

                    <div className="grid md:grid-cols-2 gap-3">
                      <input
                        type="text"
                        value={roomName}
                        onChange={(event) => setRoomName(event.target.value)}
                        placeholder="Nom de la salle CODM"
                        className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:border-zoyd-blue"
                      />
                      <input
                        type="text"
                        value={roomPassword}
                        onChange={(event) => setRoomPassword(event.target.value)}
                        placeholder="Mot de passe de la salle"
                        className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:border-zoyd-blue"
                      />
                    </div>

                    <div className="grid md:grid-cols-2 gap-3">
                      <button
                        onClick={handleSaveRoom}
                        className="border border-zoyd-blue/30 text-zoyd-blue py-3 font-display font-black uppercase tracking-widest text-xs italic hover:bg-zoyd-blue hover:text-black transition-colors"
                      >
                        Partager la salle
                      </button>
                      <button
                        onClick={handleSetLive}
                        className="bg-white text-black py-3 font-display font-black uppercase tracking-widest text-xs italic"
                      >
                        Passer en cours
                      </button>
                    </div>

                    <div className="grid md:grid-cols-2 gap-3">
                      <input
                        type="number"
                        value={scoreA}
                        onChange={(event) => setScoreA(event.target.value)}
                        placeholder="Score equipe A"
                        className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:border-zoyd-blue"
                      />
                      <input
                        type="number"
                        value={scoreB}
                        onChange={(event) => setScoreB(event.target.value)}
                        placeholder="Score equipe B"
                        className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:border-zoyd-blue"
                      />
                    </div>

                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Ce qu'il faut retenir de ce duel"
                      className="w-full min-h-24 bg-black border border-white/10 px-4 py-3 text-sm text-white focus:border-zoyd-blue"
                    />
                    <button
                      onClick={handleSubmitResult}
                      className="w-full bg-zoyd-yellow text-black py-4 font-display font-black uppercase tracking-widest text-xs italic"
                    >
                      Valider le score
                    </button>
                  </div>
                ) : (
                  <div className="border border-white/10 bg-black/40 p-4 text-sm text-white/60">
                    Aucun duel a suivre pour le moment.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </main>

      {confirmAction === 'leave' && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-zoyd-surface border border-white/10 max-w-md w-full p-6">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-orange-400" />
              </div>
              <div>
                <h3 className="text-white font-display font-black uppercase tracking-widest text-sm mb-2">
                  Confirmer le retrait ?
                </h3>
                <p className="text-white/60 text-sm">
                  Tu vas quitter ce tournoi. Ton pass d&apos;inscription ({formatZC(registrationCost)}) sera rembourse.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="flex-1 border border-white/10 px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/60 hover:text-white transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => { setConfirmAction(null); void handleLeave(); }}
                className="flex-1 border border-red-500/30 bg-red-500/10 px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-red-400 hover:bg-red-400/10 transition-colors"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TournamentBracketPage;
