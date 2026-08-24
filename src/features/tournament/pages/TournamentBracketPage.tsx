import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  CreditCard,
  Gamepad2,
  Radio,
  ShieldCheck,
  Trophy,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
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
import { useAuthStore } from '../../../app/stores/authStore';
import {
  useTournamentStore,
  type TournamentMatch,
  type TournamentStatus,
} from '../../../app/stores/tournamentStore';
import { useWalletStore } from '../../../app/stores/walletStore';
import { buildFundingPath, getRequiredTopUp } from '../../../lib/walletFunding';
import { formatZC } from '../../../lib/utils';

const statusLabels: Record<TournamentStatus, string> = {
  recruiting: 'Recrutement ouvert',
  live: 'Tournoi en cours',
  completed: 'Tournoi termine',
  cancelled: 'Tournoi annule',
};

const matchStatusLabels: Record<TournamentMatch['status'], string> = {
  pending: 'En attente',
  ready: 'Pret',
  live: 'En cours',
  finished: 'Termine',
};

const getRoundLabel = (round: number, totalRounds: number) => {
  if (round === totalRounds) return 'Finale';
  if (round === totalRounds - 1) return 'Demies';
  if (round === totalRounds - 2) return 'Quarts';
  return `Round ${round}`;
};

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

  const tournament = id ? getTournamentById(id) : undefined;
  const availableSpend = getAvailableToSpend();

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const loadTournament = async () => {
      try {
        setLoadError(null);
        setIsLoading(true);
        const response = await fetchServerTournament(id);
        if (cancelled) return;
        hydrateTournaments([response.tournament]);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Impossible de charger ce tournoi.');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadTournament();

    return () => {
      cancelled = true;
    };
  }, [hydrateTournaments, id]);

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
  const bracketRounds = Array.from({ length: tournament.mainRounds }, (_, index) => index + 1);
  const participantLabel = tournament.teamSize > 1 ? 'Equipes inscrites' : 'Joueurs inscrits';
  const participantSlotLabel = tournament.teamSize > 1 ? 'equipes' : 'joueurs';

  const updateTeammateInput = (index: number, value: string) => {
    setTeammateInputs((current) => current.map((entry, entryIndex) => (entryIndex === index ? value : entry)));
  };

  const applyTournamentResponse = (payload: { tournament: typeof tournament; user?: any; wallet?: any }) => {
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
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

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
                <span className="text-[9px] font-mono font-black text-zoyd-blue uppercase tracking-widest border border-zoyd-blue/30 px-2 py-0.5">
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
              <span className="text-[9px] font-mono text-white/20 uppercase tracking-widest">Cagnotte joueurs</span>
              <span className="text-2xl font-display font-black text-zoyd-yellow italic">
                {formatZC(tournament.payout.playerPool)}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-mono text-white/20 uppercase tracking-widest">Inscrits</span>
              <span className="text-2xl font-display font-black text-white italic">
                {tournament.entries.length}/{tournament.maxEntries}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-4 md:px-8 py-8 md:py-12 relative z-10 space-y-10">
        {loadError ? (
          <div className="border border-red-400/20 bg-red-400/5 px-5 py-4 text-sm text-red-200">
            {loadError}
          </div>
        ) : null}
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

        <div className="grid xl:grid-cols-[0.95fr_1.05fr] gap-8">
          <div className="space-y-8">
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
                      {tournament.teamSize > 1 ? 'Cout pour ton equipe:' : 'Cout inscription:'}{' '}
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

                  {canRegister && tournament.teamSize > 1 ? (
                    <div className="border border-white/10 bg-black/40 p-4 space-y-4">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-zoyd-yellow">
                        Ton equipe
                      </div>
                      <input
                        type="text"
                        value={squadName}
                        onChange={(event) => setSquadName(event.target.value)}
                        placeholder="Nom de ton equipe"
                        className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-yellow"
                      />
                      <div className="grid gap-3">
                        {teammateInputs.map((value, index) => (
                          <input
                            key={`teammate-${index + 2}`}
                            type="text"
                            value={value}
                            onChange={(event) => updateTeammateInput(index, event.target.value)}
                            placeholder={`Coequipier ${index + 2} / pseudo CODM`}
                            className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-yellow"
                          />
                        ))}
                      </div>
                      <p className="text-xs text-white/35">
                        Le capitaine confirme l'inscription pour toute l'equipe de {tournament.teamSize} joueurs.
                      </p>
                    </div>
                  ) : null}

                  {canRegister ? (
                    <button
                      onClick={handleRegister}
                      className="w-full bg-white text-black py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-zoyd-yellow transition-colors"
                    >
                      {tournament.teamSize > 1
                        ? "Confirmer mon equipe"
                        : "Confirmer mon inscription"}
                    </button>
                  ) : null}

                  {myEntry && tournament.status === 'recruiting' ? (
                    <button
                      onClick={handleLeave}
                      className="w-full border border-white/10 py-4 font-display font-black uppercase tracking-widest text-xs italic hover:border-zoyd-yellow hover:text-zoyd-yellow transition-colors"
                    >
                      Retirer mon inscription
                    </button>
                  ) : null}

                  {canJoinArbiter ? (
                    <button
                      onClick={handleJoinArbiter}
                      className="w-full border border-zoyd-blue/30 text-zoyd-blue py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-zoyd-blue hover:text-black transition-colors"
                    >
                      Prendre une place d'arbitre
                    </button>
                  ) : null}

                  {canStartTournament ? (
                    <button
                      onClick={handleStartTournament}
                      className="w-full bg-zoyd-yellow text-black py-4 font-display font-black uppercase tracking-widest text-xs italic"
                    >
                      Lancer le tableau
                    </button>
                  ) : null}

                  {myEntry ? (
                    <div className="border border-green-400/20 bg-green-400/5 p-4 text-sm text-white/70">
                      Inscription confirmee pour <strong className="text-white">{myEntry.squadName}</strong>.
                      {' '}
                      Roster: {myEntry.members.map((member) => member.pseudo).join(' / ')}.
                    </div>
                  ) : null}

                  {myArbiterSlot ? (
                    <div className="border border-zoyd-blue/20 bg-zoyd-blue/5 p-4 text-sm text-white/70">
                      Place d'arbitre #{myArbiterSlot.slot} active. Les duels que tu accompagnes apparaitront juste
                      en dessous.
                    </div>
                  ) : null}

                  {tournament.teamSize > 1 ? (
                    <p className="text-xs text-white/35">
                      Chaque inscription represente une equipe complete. Une fois tout le monde pret, le tableau se
                      lance equipe contre equipe.
                    </p>
                  ) : null}
                </div>
              )}
            </div>

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
                        <div className="text-[10px] font-mono uppercase tracking-widest text-white/20">
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

            <div className="grid md:grid-cols-2 gap-6">
              <PayoutCard
                title={tournament.teamSize > 1 ? 'Top 3 squads' : 'Top 3 joueurs'}
                rows={[
                  ['1er', formatZC(tournament.payout.first)],
                  ['2e', formatZC(tournament.payout.second)],
                  ['3e', formatZC(tournament.payout.third)],
                ]}
              />
              <PayoutCard
                title="Supervision"
                rows={[
                  ['Total', formatZC(tournament.payout.arbiterPool)],
                  ['Par poste', formatZC(tournament.payout.arbiterPool / tournament.arbitersNeeded)],
                  ['Retrait', '2% au cash-out'],
                ]}
              />
            </div>
          </div>

          <div className="space-y-8">
            <div className="hud-panel p-6 bg-zoyd-surface/20">
              <div className="flex items-center justify-between gap-4 mb-6">
                <h2 className="text-lg font-display font-black uppercase italic">Tableau du tournoi</h2>
                {champion ? (
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zoyd-yellow border border-zoyd-yellow/20 px-3 py-1">
                    Champion: {champion.squadName}
                  </div>
                ) : null}
              </div>

              <div className="flex gap-8 overflow-x-auto pb-4">
                {bracketRounds.map((round) => (
                  <div key={round} className="min-w-[280px] flex flex-col gap-5">
                    <div className="text-center">
                      <span className="text-[10px] font-mono font-black text-white/20 uppercase tracking-[0.35em] italic">
                        {getRoundLabel(round, tournament.mainRounds)}
                      </span>
                    </div>
                    {tournament.matches
                      .filter((match) => match.bracketType === 'main' && match.round === round)
                      .map((match) => (
                        <BracketMatchCard
                          key={match.id}
                          match={match}
                          tournamentName={tournament.name}
                          selected={selectedMatchId === match.id}
                          onSelect={() => setSelectedMatchId(match.id)}
                          entryALabel={tournament.entries.find((entry) => entry.id === match.entryAId)?.squadName || 'A confirmer'}
                          entryBLabel={tournament.entries.find((entry) => entry.id === match.entryBId)?.squadName || 'A confirmer'}
                        />
                      ))}
                  </div>
                ))}

                {bronzeMatch ? (
                  <div className="min-w-[280px] flex flex-col gap-5">
                    <div className="text-center">
                      <span className="text-[10px] font-mono font-black text-white/20 uppercase tracking-[0.35em] italic">
                        Bronze
                      </span>
                    </div>
                    <BracketMatchCard
                      match={bronzeMatch}
                      tournamentName={tournament.name}
                      selected={selectedMatchId === bronzeMatch.id}
                      onSelect={() => setSelectedMatchId(bronzeMatch.id)}
                      entryALabel={tournament.entries.find((entry) => entry.id === bronzeMatch.entryAId)?.squadName || 'A confirmer'}
                      entryBLabel={tournament.entries.find((entry) => entry.id === bronzeMatch.entryBId)?.squadName || 'A confirmer'}
                    />
                  </div>
                ) : null}
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
                      className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                    >
                      {actionableMatches.map((match) => {
                        const entryA =
                          tournament.entries.find((entry) => entry.id === match.entryAId)?.squadName || 'A confirmer';
                        const entryB =
                          tournament.entries.find((entry) => entry.id === match.entryBId)?.squadName || 'A confirmer';
                        return (
                          <option key={match.id} value={match.id}>
                            {entryA} vs {entryB} - {matchStatusLabels[match.status]}
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
                        className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                      />
                      <input
                        type="text"
                        value={roomPassword}
                        onChange={(event) => setRoomPassword(event.target.value)}
                        placeholder="Mot de passe de la salle"
                        className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
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
                        className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                      />
                      <input
                        type="number"
                        value={scoreB}
                        onChange={(event) => setScoreB(event.target.value)}
                        placeholder="Score equipe B"
                        className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                      />
                    </div>

                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Ce qu'il faut retenir de ce duel"
                      className="w-full min-h-24 bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
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

            {champion ? (
              <div className="hud-panel p-6 bg-zoyd-surface/20">
                <div className="flex items-center gap-3 mb-4">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  <h2 className="text-lg font-display font-black uppercase italic">Podium final</h2>
                </div>
                <div className="space-y-3">
                  {[1, 2, 3].map((placement) => {
                    const entry = tournament.entries.find((candidate) => candidate.finalPlacement === placement);
                    return (
                      <div
                        key={placement}
                        className="border border-white/5 bg-black/40 px-4 py-3 flex items-center justify-between"
                      >
                        <div className="font-display font-black text-sm uppercase italic text-white">
                          #{placement} {entry?.squadName || 'TBD'}
                        </div>
                        <div className="text-[10px] font-mono uppercase tracking-widest text-white/30">
                          {placement === 1
                            ? formatZC(tournament.payout.first)
                            : placement === 2
                              ? formatZC(tournament.payout.second)
                              : formatZC(tournament.payout.third)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
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

const RuleRow = ({ label, value }: { label: string; value: string }) => (
  <div className="border border-white/5 px-4 py-3 bg-black/30">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-1">{label}</div>
    <div className="font-display font-black text-white italic">{value}</div>
  </div>
);

const PayoutCard = ({ title, rows }: { title: string; rows: Array<[string, string]> }) => (
  <div className="hud-panel p-6 bg-zoyd-surface/20">
    <div className="flex items-center gap-3 mb-4">
      <Trophy className="w-4 h-4 text-zoyd-yellow" />
      <h2 className="text-lg font-display font-black uppercase italic">{title}</h2>
    </div>
    <div className="space-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between border border-white/5 bg-black/30 px-4 py-3">
          <span className="text-sm font-display font-black uppercase italic text-white">{label}</span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">{value}</span>
        </div>
      ))}
    </div>
  </div>
);

const BracketMatchCard = ({
  match,
  tournamentName,
  selected,
  onSelect,
  entryALabel,
  entryBLabel,
}: {
  match: TournamentMatch;
  tournamentName: string;
  selected: boolean;
  onSelect: () => void;
  entryALabel: string;
  entryBLabel: string;
}) => {
  const statusTone =
    match.status === 'live'
      ? 'text-zoyd-blue'
      : match.status === 'finished'
        ? 'text-white/30'
        : match.status === 'ready'
          ? 'text-zoyd-yellow'
          : 'text-white/20';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left relative border bg-zoyd-surface/30 p-4 transition-all ${
        selected ? 'border-zoyd-blue/40' : 'border-white/10 hover:border-white/20'
      }`}
      aria-label={`Ouvrir le match ${match.id} de ${tournamentName}`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[9px] font-mono text-white/20 uppercase tracking-widest">
          {match.bracketType === 'third_place' ? 'Bronze' : `Match ${match.position}`}
        </span>
        <span className={`text-[9px] font-mono uppercase tracking-widest ${statusTone}`}>{matchStatusLabels[match.status]}</span>
      </div>

      <PlayerLine label={entryALabel} active={match.winnerEntryId === match.entryAId} score={match.scoreA} />
      <PlayerLine label={entryBLabel} active={match.winnerEntryId === match.entryBId} score={match.scoreB} />

      <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[9px] font-mono uppercase tracking-widest text-white/20">
        <span>
          {match.scheduledAt
            ? new Date(match.scheduledAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            : 'A venir'}
        </span>
        <span>Poste arbitre #{match.arbiterSlot}</span>
      </div>
    </button>
  );
};

const PlayerLine = ({ label, active, score }: { label: string; active: boolean; score?: number }) => (
  <div
    className={`flex items-center justify-between py-2 px-3 border border-white/5 mb-1 ${
      active ? 'bg-zoyd-yellow/10 border-zoyd-yellow/30' : 'bg-black/40'
    }`}
  >
    <span className={`font-display font-black text-sm uppercase italic ${active ? 'text-white' : 'text-white/40'}`}>
      {label}
    </span>
    <span className="font-mono font-black text-sm text-white/60">{score ?? '-'}</span>
  </div>
);

export default TournamentBracketPage;
