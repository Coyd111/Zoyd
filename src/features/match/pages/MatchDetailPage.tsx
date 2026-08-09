import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  CreditCard,
  ExternalLink,
  Flame,
  Gavel,
  PlusCircle,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Swords,
  Trophy,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchServerChatChannel,
  markServerChatChannelRead,
  sendServerChatMessage,
} from '../../../app/lib/chatApi';
import {
  addServerDisputeEvidence,
  assignServerArbiter,
  checkInServerMatch,
  confirmServerMatchResult,
  escalateServerDispute,
  joinServerMatch,
  launchServerMatch,
  openServerMatchDispute,
  scheduleServerMatch,
  setServerRoomDetails,
  submitServerMatchResult,
  toggleServerReady,
} from '../../../app/lib/matchApi';
import { applyServerAccountState } from '../../../app/lib/serverSync';
import { useAuthStore } from '../../../app/stores/authStore';
import { useMatchStore, type DisputeCategory } from '../../../app/stores/matchStore';
import { useChatStore } from '../../../app/stores/chatStore';
import { useSocketStore } from '../../../app/stores/socketStore';
import { useWalletStore } from '../../../app/stores/walletStore';
import { buildFundingPath, getRequiredTopUp } from '../../../lib/walletFunding';
import { getMapImage } from '../../../lib/competition';
import { adminCancelServerMatch, adminResolveServerDispute } from '../../../app/lib/matchApi';
import { MatchChat } from '../components/MatchChat';

const statusLabels: Record<string, string> = {
  recruiting: 'Recrutement ouvert',
  full: 'Joueurs complets',
  check_in: 'Confirmation de presence',
  ready: 'Pret a jouer',
  in_progress: 'Partie en cours',
  finished: 'Partie terminee',
  disputed: 'Litige ouvert',
  cancelled: 'Annule',
  forfeited: 'Forfait',
};

const disputeCategoryLabels: Record<DisputeCategory, string> = {
  result: 'Score conteste',
  room_issue: 'Probleme de salle',
  no_show: 'Absence / retard',
  conduct: 'Comportement',
  other: 'Autre',
};

const parseRefs = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const MatchDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const {
    getMatchById,
    canJoinAsArbiter,
  } = useMatchStore();
  const hydrateMatches = useMatchStore((state) => state.hydrateFromServer);
  const { getMessagesForChannel, hydrateFromServer: hydrateChat, receiveServerMessage, markAsRead } = useChatStore();
  const {
    isConnected: socketConnected,
    lastHeartbeatAt,
    seenByChannel,
    getChannelPresence,
    getPresenceSummary,
    getTypingUsers,
    joinChannel,
    leaveChannel,
    markChannelSeen,
    setTyping,
    isChannelLive,
  } = useSocketStore();
  const { getAvailableToSpend } = useWalletStore();

  const [scheduleValue, setScheduleValue] = useState('');
  const [roomName, setRoomName] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [scoreAlpha, setScoreAlpha] = useState('0');
  const [scoreBravo, setScoreBravo] = useState('0');
  const [resultNotes, setResultNotes] = useState('');
  const [scoreboardProofs, setScoreboardProofs] = useState('');
  const [finalResultProofs, setFinalResultProofs] = useState('');
  const [roomCaptureProofs, setRoomCaptureProofs] = useState('');
  const [extraResultProofs, setExtraResultProofs] = useState('');
  const [disputeCategory, setDisputeCategory] = useState<DisputeCategory>('result');
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeEvidence, setDisputeEvidence] = useState('');
  const [addEvidenceInput, setAddEvidenceInput] = useState('');
  const [showAddEvidenceForm, setShowAddEvidenceForm] = useState(false);
  const [isEscalating, setIsEscalating] = useState(false);
  const [showArbiterScore, setShowArbiterScore] = useState(false);

  const match = id ? getMatchById(id) : undefined;
  const messages = match ? getMessagesForChannel(match.channelId) : [];

  useEffect(() => {
    if (!match?.channelId || !user) return;
    let cancelled = false;

    fetchServerChatChannel(match.channelId)
      .then((payload) => {
        if (cancelled) return;
        hydrateChat([payload.channel], payload.messages);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [hydrateChat, match?.channelId, user]);

  useEffect(() => {
    if (match?.channelId) {
      markAsRead(match.channelId);
      if (user) {
        void markServerChatChannelRead(match.channelId).catch(() => undefined);
      }
    }
  }, [markAsRead, match?.channelId, messages.length, user]);

  useEffect(() => {
    if (!match?.channelId || !user) return;

    const playerPresence = match.players.find((player) => player.userId === user.id);
    const isUserArbiter = match.arbiter?.userId === user.id;

    joinChannel(match.channelId, user.id, user.pseudo, {
      role: isUserArbiter ? 'arbiter' : playerPresence ? 'player' : 'spectator',
      team: playerPresence?.team,
      isCheckedIn: playerPresence?.isCheckedIn || isUserArbiter,
      isReady: playerPresence?.isReady || match.status === 'ready' || match.status === 'in_progress',
    });
    markChannelSeen(match.channelId, user.id);

    return () => {
      setTyping(match.channelId, user.id, user.pseudo, false);
      leaveChannel(match.channelId, user.id);
    };
  }, [joinChannel, leaveChannel, markChannelSeen, match?.channelId, setTyping, user]);

  useEffect(() => {
    if (!match?.channelId || !user) return;
    markChannelSeen(match.channelId, user.id);
  }, [markChannelSeen, match?.channelId, messages.length, user]);

  useEffect(() => {
    if (!match) return;
    setScheduleValue(match.scheduledAt ? match.scheduledAt.slice(0, 16) : '');
    setRoomName(match.roomName || '');
    setRoomPassword(match.roomPassword || '');
  }, [match?.id, match?.roomName, match?.roomPassword, match?.scheduledAt]);

  const currentPlayer = useMemo(
    () => match?.players.find((player) => player.userId === user?.id),
    [match?.players, user?.id]
  );
  const isArbiter = !!user && match?.arbiter?.userId === user.id;
  const canSeeRoom = !!currentPlayer || isArbiter;
  const openDisputeRecord = match?.disputes.find(
    (dispute) => dispute.status === 'open' || dispute.status === 'under_review'
  );
  const availableSpend = getAvailableToSpend();
  const channelPresence = match ? getChannelPresence(match.channelId) : [];
  const presenceSummary = match
    ? getPresenceSummary(match.channelId)
    : { onlineCount: 0, checkedInCount: 0, readyCount: 0, arbiterOnline: false, total: 0 };
  const typingUsers = match && user ? getTypingUsers(match.channelId, user.id) : [];
  const readCount = match ? Object.keys(seenByChannel[match.channelId] || {}).length : 0;
  const channelConnected = !!user && socketConnected && match ? isChannelLive(match.channelId) : false;

  if (!id) {
    return null;
  }

  if (!match) {
    return (
      <div className="min-h-screen bg-zoyd-black text-white flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-display font-black uppercase mb-4">Match introuvable</h2>
          <Link to="/mj" className="border border-white/10 px-6 py-3 uppercase text-sm font-display font-black tracking-widest">
            Retour aux matchs
          </Link>
        </div>
      </div>
    );
  }

  const teamAlpha = match.players.filter((player) => player.team === 0);
  const teamBravo = match.players.filter((player) => player.team === 1);
  const statusLabel = statusLabels[match.status] || match.status;
  const canJoinAsPlayer = !!user && !currentPlayer && !isArbiter && !['finished', 'cancelled', 'forfeited'].includes(match.status);
  const canJoinArbiterSlot = !!user && canJoinAsArbiter(match.id);
  const canCheckIn = !!currentPlayer && ['full', 'check_in', 'ready'].includes(match.status);
  const canToggleReady = !!currentPlayer && currentPlayer.isCheckedIn && ['check_in', 'ready'].includes(match.status);
  const canLaunch = isArbiter && !!match.roomName && !!match.roomPassword && match.players.every((player) => player.isCheckedIn && player.isReady);
  const countdown = match.scheduledAt ? getCountdownDisplay(match.scheduledAt) : null;
  const scheduledAtMs = match.scheduledAt ? new Date(match.scheduledAt).getTime() : null;
  const minutesUntilMatch = scheduledAtMs ? Math.round((scheduledAtMs - Date.now()) / 60000) : null;
  const roomPublishWindow = !match.scheduledAt
    ? {
        canPublish: false,
        message: "Confirme d'abord l'heure du match avant de partager la salle.",
      }
    : minutesUntilMatch !== null && minutesUntilMatch > 10
      ? {
          canPublish: false,
          message: `La salle pourra etre partagee dans ${Math.max(1, minutesUntilMatch - 10)} minute(s).`,
        }
      : {
          canPublish: true,
          message:
            minutesUntilMatch !== null && minutesUntilMatch >= 0
              ? 'La salle peut maintenant etre partagee avec les joueurs confirms.'
              : "L'heure est depassee: partage la salle tout de suite ou tranche le dossier.",
        };
  const resultProofSummary = match.result?.proofs;
  const forfeitLabel =
    match.result?.resolutionType === 'forfeit'
      ? match.result.forfeitTeam === 0
        ? 'Squad Alpha perd par forfait'
        : 'Squad Bravo perd par forfait'
      : null;
  const requiredTopUp = getRequiredTopUp(match.entryFee, availableSpend);
  const fundingPath = buildFundingPath({
    context: 'match-join',
    requiredAmount: match.entryFee,
    availableAmount: availableSpend,
    returnTo: `/mj/match/${match.id}`,
  });

  const applyMatchResponse = (payload: { match: typeof match; user?: any; wallet?: any }) => {
    hydrateMatches([payload.match]);
    applyServerAccountState(payload);
  };

  const handleJoin = async (team?: 0 | 1) => {
    if (!user) {
      navigate('/auth/login');
      return;
    }

    if (availableSpend < match.entryFee) {
      toast.error("Solde insuffisant. Fais d'abord un depot avant de bloquer ton pass.");
      navigate(fundingPath);
      return;
    }

    if ((match.trustScoreMin || 0) > user.trustScore) {
      toast.error(`Ce match demande un niveau de confiance minimum de ${match.trustScoreMin}.`);
      return;
    }

    try {
      const response = await joinServerMatch(match.id, team);
      applyMatchResponse(response);
      toast.success(`Pass bloque. Tu rejoins ${team === 1 ? 'Squad Bravo' : team === 0 ? 'Squad Alpha' : 'l equipe disponible'}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de rejoindre ce match avec ton profil actuel.");
    }
  };

  const handleJoinAsArbiter = async () => {
    if (!user) {
      navigate('/auth/login');
      return;
    }

    try {
      const response = await assignServerArbiter(match.id);
      applyMatchResponse(response);
      toast.success("Place d'arbitre reservee. Tu peux maintenant gerer la salle du match.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "La place d'arbitre n'est plus disponible.");
    }
  };

  const handleSchedule = async () => {
    if (!scheduleValue) return;
    try {
      const response = await scheduleServerMatch(match.id, new Date(scheduleValue).toISOString());
      applyMatchResponse(response);
      toast.success('Horaire du match confirme.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible de confirmer cet horaire.');
    }
  };

  const handleRoomSave = async () => {
    if (!roomName || !roomPassword) {
      toast.error('Entre un nom de salle et un mot de passe.');
      return;
    }

    try {
      const response = await setServerRoomDetails(match.id, roomName, roomPassword);
      applyMatchResponse(response);
      toast.success('La salle privee a bien ete partagee.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : roomPublishWindow.message);
    }
  };

  const handleResultSubmit = async () => {
    const alpha = Number(scoreAlpha);
    const bravo = Number(scoreBravo);
    const scoreboardRefs = parseRefs(scoreboardProofs);
    const finalRefs = parseRefs(finalResultProofs);
    const roomRefs = parseRefs(roomCaptureProofs);
    const extraRefs = parseRefs(extraResultProofs);

    if (alpha === bravo) {
      toast.error('Le score final doit designer une equipe gagnante.');
      return;
    }

    try {
      const response = await submitServerMatchResult(match.id, {
        winnerTeam: alpha > bravo ? 0 : 1,
        scores: { team0: alpha, team1: bravo },
        screenshots: [...scoreboardRefs, ...finalRefs, ...roomRefs, ...extraRefs],
        proofs: {
          scoreboard: scoreboardRefs,
          finalResult: finalRefs,
          roomCapture: roomRefs,
          extraEvidence: extraRefs,
        },
        arbiterNotes: resultNotes,
        submittedBy: user?.id || 'arbiter',
      });
      applyMatchResponse(response);
      setScoreboardProofs('');
      setFinalResultProofs('');
      setRoomCaptureProofs('');
      setExtraResultProofs('');
      toast.success('Resultat valide. Les gains sont en cours de distribution.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ajoute au moins un scoreboard et un ecran final avant de valider le score.");
    }
  };

  const handleDispute = async () => {
    if (!user) {
      navigate('/auth/login');
      return;
    }
    if (!disputeReason.trim()) {
      toast.error('Indique au moins une raison de litige.');
      return;
    }
    const disputeRefs = parseRefs(disputeEvidence);
    if (disputeRefs.length === 0) {
      toast.error('Ajoute au moins une preuve avant d ouvrir un litige.');
      return;
    }
    try {
      const response = await openServerMatchDispute(match.id, {
        reason: disputeReason.trim(),
        evidence: disputeRefs,
        category: disputeCategory,
      });
      applyMatchResponse(response);
      toast.success('Litige ouvert. Les gains restent bloques jusqu a resolution.');
      setDisputeReason('');
      setDisputeEvidence('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Un litige est deja actif sur ce match ou les preuves sont insuffisantes.");
    }
  };

  const handleCheckIn = async () => {
    try {
      const response = await checkInServerMatch(match.id);
      applyMatchResponse(response);
      toast.success('Presence confirmee.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Check-in impossible.');
    }
  };

  const handleToggleReady = async () => {
    try {
      const response = await toggleServerReady(match.id);
      applyMatchResponse(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Mise a jour ready impossible.');
    }
  };

  const handleLaunch = async () => {
    try {
      const response = await launchServerMatch(match.id);
      applyMatchResponse(response);
      toast.success('Le match passe en direct.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Lancement impossible.');
    }
  };

  const handleConfirmResult = async () => {
    try {
      const response = await confirmServerMatchResult(match.id);
      applyMatchResponse(response);
      toast.success('Resultat confirme de ton cote.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Confirmation impossible.');
    }
  };

  const handleAddEvidence = async () => {
    const refs = addEvidenceInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (refs.length === 0) {
      toast.error('Entre au moins un lien ou une référence de preuve.');
      return;
    }
    try {
      const response = await addServerDisputeEvidence(match.id, refs);
      applyMatchResponse(response);
      setAddEvidenceInput('');
      setShowAddEvidenceForm(false);
      toast.success(`${refs.length} preuve(s) ajoutée(s) au dossier.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible d\'ajouter les preuves.');
    }
  };

  const handleEscalate = async () => {
    setIsEscalating(true);
    try {
      const response = await escalateServerDispute(match.id);
      applyMatchResponse(response);
      toast.success('Litige escaladé. L\'équipe admin a été notifiée.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Escalade impossible.');
    } finally {
      setIsEscalating(false);
    }
  };

  return (
    <div className="min-h-screen bg-zoyd-black text-white scanline">
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <div className="max-w-[1500px] mx-auto px-6 py-10 relative z-10">
        <div className="flex items-center justify-between gap-4 mb-8">
          <Link to="/mj" className="inline-flex items-center gap-2 text-white/40 hover:text-white transition-colors text-sm uppercase font-mono tracking-widest">
            <ArrowLeft className="w-4 h-4" />
            Retour aux matchs
          </Link>
          <div className="inline-flex items-center gap-2 border border-white/10 px-4 py-2 text-[10px] font-mono uppercase tracking-[0.25em] text-white/50">
            <Radio className="w-3.5 h-3.5 text-zoyd-blue" />
            {statusLabel}
          </div>
        </div>

        <header className="relative mb-10 overflow-hidden min-h-[300px] flex flex-col justify-end p-8 -mx-6 md:mx-0">
          <img 
            src={getMapImage(match.rules.map)}
            alt={match.rules.map}
            className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-luminosity"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zoyd-black via-zoyd-black/80 to-transparent" />
          <div className="absolute inset-0 tactical-grid opacity-10 pointer-events-none" />
          
          <div className="relative z-10">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div className="w-12 h-12 flex items-center justify-center text-zoyd-yellow">
                <Swords className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-mono uppercase tracking-[0.35em] text-zoyd-yellow">LOBBY DU WAGER</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-display font-black italic uppercase tracking-tighter">
              {match.rules.map} <span className="text-white/20">/</span> {match.rules.mode}
            </h1>
            <p className="text-white/40 mt-3 max-w-3xl">
              {match.format} / Wager: {formatZC(match.entryFee)} / Cash Prize: {formatZC(match.prizePool)} / Créé par {match.creatorPseudo}
            </p>
          </div>
        </header>

        <div className="grid xl:grid-cols-[1.15fr_0.85fr] gap-8">
          <div className="space-y-8">
            <div className="grid md:grid-cols-4 gap-4">
              <InfoCard icon={<CreditCard className="w-5 h-5 text-zoyd-yellow" />} label="Mise" value={formatZC(match.entryFee)} />
              <InfoCard icon={<Trophy className="w-5 h-5 text-green-400" />} label="Cash Prize" value={formatZC(match.prizePool)} />
              <InfoCard icon={<ShieldCheck className="w-5 h-5 text-zoyd-blue" />} label="Arbitre" value={match.arbiter ? match.arbiter.pseudo : 'Libre'} />
              <InfoCard icon={<Clock3 className="w-5 h-5 text-white/50" />} label="Horaire" value={match.scheduledAt ? countdown || '00:00:00' : 'A fixer'} />
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <TeamCard title="Squad Alpha" players={teamAlpha} teamSize={match.teamSize} accent="blue" />
              <TeamCard title="Squad Bravo" players={teamBravo} teamSize={match.teamSize} accent="white" />
            </div>

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

            {match.result && (
              <div className="p-6">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <h2 className="text-lg font-display font-black uppercase italic">Score confirme</h2>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-green-400 border border-green-400/20 px-3 py-1">
                    Gains distribues
                  </div>
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  <RuleRow label="Vainqueur" value={match.result.winnerTeam === 0 ? 'Squad Alpha' : 'Squad Bravo'} />
                  <RuleRow label="Score Alpha" value={`${match.result.scores.team0}`} />
                  <RuleRow label="Score Bravo" value={`${match.result.scores.team1}`} />
                </div>
                {forfeitLabel ? (
                  <div className="mt-4 border border-zoyd-yellow/20 bg-zoyd-yellow/5 px-4 py-3 text-sm text-white/70">
                    {forfeitLabel}. Le gain a ete distribue automatiquement.
                  </div>
                ) : null}
                {resultProofSummary ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <EvidencePanel title="Scoreboard" items={resultProofSummary.scoreboard} />
                    <EvidencePanel title="Ecran final" items={resultProofSummary.finalResult} />
                    <EvidencePanel title="Salle / room" items={resultProofSummary.roomCapture} />
                    <EvidencePanel title="Autres preuves" items={resultProofSummary.extraEvidence} />
                  </div>
                ) : null}
                {match.result.proofHash ? (
                  <div className="mt-4 text-[10px] font-mono uppercase tracking-widest text-white/25">
                    Proof hash: {match.result.proofHash}
                  </div>
                ) : null}
                {currentPlayer && !match.result.confirmedByTeams.includes(currentPlayer.userId) && (
                  <button
                    onClick={handleConfirmResult}
                    className="mt-6 inline-flex items-center gap-2 border border-white/10 px-4 py-3 text-[10px] font-display font-black uppercase tracking-widest hover:border-zoyd-blue hover:text-zoyd-blue transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Confirmer le score
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-8">
            <div className="p-6">
              <h2 className="text-lg font-display font-black uppercase italic mb-4">Entrer dans la partie</h2>

              {!user && (
                <div className="space-y-4">
                  <p className="text-white/40 text-sm">
                    Connecte-toi pour rejoindre une equipe, suivre la salle et discuter avec les autres joueurs.
                  </p>
                  <Link to="/auth/login" className="inline-flex items-center gap-2 bg-white text-black px-5 py-3 font-display font-black uppercase tracking-widest text-xs italic">
                    Connexion joueur
                  </Link>
                </div>
              )}

              {user && canJoinAsPlayer && (
                <div className="space-y-4">
                  <div className="border border-white/10 bg-black/40 p-4 text-sm text-white/60">
                    Ton solde dispo: <span className="text-zoyd-yellow font-display font-black">{formatZC(availableSpend)}</span>
                  </div>
                  {requiredTopUp > 0 ? (
                    <div className="border border-zoyd-yellow/20 bg-zoyd-yellow/5 p-4 text-sm text-white/70">
                      Il te manque{' '}
                      <span className="font-display font-black text-zoyd-yellow">{formatZC(requiredTopUp)}</span>{' '}
                      pour bloquer ton pass sur ce match.
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
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <button onClick={() => handleJoin(0)} className="bg-white text-black py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-zoyd-yellow transition-colors">
                      REJOINDRE ALPHA
                    </button>
                    <button onClick={() => handleJoin(1)} className="border border-white/10 py-4 font-display font-black uppercase tracking-widest text-xs italic hover:border-white transition-colors">
                      REJOINDRE BRAVO
                    </button>
                    <button onClick={() => handleJoin()} className="border border-zoyd-blue/30 text-zoyd-blue py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-zoyd-blue hover:text-black transition-colors">
                      PLACEMENT AUTO
                    </button>
                  </div>
                </div>
              )}

              {user && canJoinArbiterSlot && (
                <button onClick={handleJoinAsArbiter} className="mt-4 w-full bg-zoyd-yellow text-black py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-white transition-colors">
                  POSTULER COMME ARBITRE (COMMISSION: {formatZC(match.arbiterFee)})
                </button>
              )}

              {currentPlayer && (
                <div className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-3">
                    <button
                      onClick={handleCheckIn}
                      disabled={!canCheckIn || currentPlayer.isCheckedIn}
                      className="bg-white text-black py-4 font-display font-black uppercase tracking-widest text-xs italic disabled:opacity-30"
                    >
                      {currentPlayer.isCheckedIn ? 'Presence confirmee' : 'Confirmer ma presence'}
                    </button>
                    <button
                      onClick={handleToggleReady}
                      disabled={!canToggleReady}
                      className="border border-zoyd-yellow/30 text-zoyd-yellow py-4 font-display font-black uppercase tracking-widest text-xs italic disabled:opacity-30"
                    >
                      {currentPlayer.isReady ? 'Retirer le ready' : 'Je suis pret'}
                    </button>
                  </div>
                  <p className="text-xs text-white/40">
                    Une fois ton pass engage, ta place reste reservee jusqu'au score final.
                  </p>
                  {match.scheduledAt ? (
                    <p className="text-xs text-white/35">
                      Presence attendue avant l'heure confirmee. Toute equipe incomplete a l'heure du match passe automatiquement en forfait.
                    </p>
                  ) : null}
                </div>
              )}

              {isArbiter && (
                <div className="space-y-5">
                  <div className="border border-white/10 bg-black/40 p-4 text-sm text-white/65">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-zoyd-blue mb-2">
                      Publication de salle
                    </div>
                    <p>{roomPublishWindow.message}</p>
                  </div>

                  <div className="grid md:grid-cols-2 gap-3">
                    <input
                      type="datetime-local"
                      value={scheduleValue}
                      onChange={(event) => setScheduleValue(event.target.value)}
                      className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                    />
                    <button onClick={handleSchedule} className="bg-white text-black py-3 font-display font-black uppercase tracking-widest text-xs italic">
                      Valider l'horaire
                    </button>
                  </div>

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
                    <button onClick={handleRoomSave} disabled={!roomPublishWindow.canPublish} className="border border-zoyd-blue/30 text-zoyd-blue py-3 font-display font-black uppercase tracking-widest text-xs italic hover:bg-zoyd-blue hover:text-black transition-colors disabled:opacity-30">
                      Partager la salle
                    </button>
                    <button onClick={handleLaunch} disabled={!canLaunch} className="bg-zoyd-yellow text-black py-3 font-display font-black uppercase tracking-widest text-xs italic disabled:opacity-30 hover:bg-white transition-colors">
                      DÉMARRER LE MATCH
                    </button>
                  </div>

                  <div className="border-t border-white/5 pt-5 space-y-3">
                    <h3 className="text-sm font-display font-black uppercase italic">Fin de match</h3>
                    <div className="grid md:grid-cols-2 gap-3">
                      <input
                        type="number"
                        value={scoreAlpha}
                        onChange={(event) => setScoreAlpha(event.target.value)}
                        placeholder="Score Alpha"
                        className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                      />
                      <input
                        type="number"
                        value={scoreBravo}
                        onChange={(event) => setScoreBravo(event.target.value)}
                        placeholder="Score Bravo"
                        className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                      />
                    </div>
                    <textarea
                      value={resultNotes}
                      onChange={(event) => setResultNotes(event.target.value)}
                      placeholder="Ce qu'il faut retenir de la fin de match"
                      className="w-full min-h-24 bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                    />
                    <input
                      type="text"
                      value={scoreboardProofs}
                      onChange={(event) => setScoreboardProofs(event.target.value)}
                      placeholder="Screens scoreboard (liens ou refs, separes par des virgules)"
                      className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                    />
                    <input
                      type="text"
                      value={finalResultProofs}
                      onChange={(event) => setFinalResultProofs(event.target.value)}
                      placeholder="Ecran final / victoire (liens ou refs)"
                      className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                    />
                    <input
                      type="text"
                      value={roomCaptureProofs}
                      onChange={(event) => setRoomCaptureProofs(event.target.value)}
                      placeholder="Capture de salle ou room setup (optionnel)"
                      className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                    />
                    <input
                      type="text"
                      value={extraResultProofs}
                      onChange={(event) => setExtraResultProofs(event.target.value)}
                      placeholder="Autres preuves utiles (clips, captures, etc.)"
                      className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                    />
                    <button onClick={handleResultSubmit} className="w-full bg-white text-black py-4 font-display font-black uppercase tracking-widest text-xs italic">
                      Valider le score final
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="overflow-hidden">
              {/* ── LITIGE ACTIF ── */}
              {openDisputeRecord ? (
                <div>
                  {/* Bandeau d'alerte rouge */}
                  <div className="bg-red-500/10 border-b border-red-500/30 px-6 py-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
                      <div>
                        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-red-400 mb-0.5">
                          {openDisputeRecord.level >= 2 ? 'Litige — Niveau Admin' : 'Litige en cours'}
                        </div>
                        <div className="text-sm font-display font-black uppercase italic text-white">
                          Dossier ouvert par {openDisputeRecord.openedByPseudo || 'Inconnu'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[9px] font-mono uppercase tracking-widest border px-2 py-1 ${openDisputeRecord.level >= 2 ? 'border-red-400/40 text-red-400 bg-red-400/10' : 'border-orange-400/30 text-orange-400 bg-orange-400/5'}`}>
                        NIV. {openDisputeRecord.level || 1}
                      </span>
                      {openDisputeRecord.prizePoolFrozen && (
                        <span className="text-[9px] font-mono uppercase tracking-widest border border-zoyd-yellow/30 text-zoyd-yellow bg-zoyd-yellow/5 px-2 py-1">
                          Gains bloqués
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-6 space-y-5">
                    {/* Détails du dossier */}
                    <div className="grid md:grid-cols-2 gap-3">
                      <RuleRow label="Ticket" value={openDisputeRecord.id} />
                      <RuleRow label="Catégorie" value={disputeCategoryLabels[openDisputeRecord.category]} />
                    </div>

                    <div className="border border-white/10 bg-black/30 px-4 py-3">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">Motif déclaré</div>
                      <div className="text-sm text-white/80 leading-relaxed">{openDisputeRecord.reason}</div>
                    </div>

                    {/* Preuves actuelles */}
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-3">
                        Pièces jointes ({openDisputeRecord.evidence.length})
                      </div>
                      {openDisputeRecord.evidence.length > 0 ? (
                        <div className="space-y-1.5">
                          {openDisputeRecord.evidence.map((item: string, i: number) => (
                            <a
                              key={i}
                              href={item.startsWith('http') ? item : undefined}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 text-xs text-zoyd-blue hover:text-white transition-colors font-mono break-all"
                            >
                              <ExternalLink className="w-3 h-3 shrink-0" />
                              {item}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-white/30 italic">Aucune pièce jointe.</p>
                      )}
                    </div>

                    {/* Ajouter des preuves (joueurs + arbitre) */}
                    {(!!currentPlayer || isArbiter) && (
                      <div className="border-t border-white/5 pt-4">
                        <button
                          onClick={() => setShowAddEvidenceForm((v) => !v)}
                          className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/40 hover:text-zoyd-blue transition-colors"
                        >
                          <PlusCircle className="w-3.5 h-3.5" />
                          Ajouter une preuve au dossier
                          {showAddEvidenceForm ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>

                        {showAddEvidenceForm && (
                          <div className="mt-3 flex gap-3">
                            <input
                              type="text"
                              value={addEvidenceInput}
                              onChange={(e) => setAddEvidenceInput(e.target.value)}
                              placeholder="Liens ou refs séparés par des virgules"
                              className="flex-1 bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                            />
                            <button
                              onClick={handleAddEvidence}
                              className="px-5 py-3 border border-zoyd-blue/30 text-zoyd-blue text-[10px] font-display font-black uppercase tracking-widest hover:bg-zoyd-blue hover:text-black transition-colors"
                            >
                              Envoyer
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── CONSOLE ARBITRE ── */}
                    {isArbiter && (
                      <div className="border border-orange-500/20 bg-orange-500/5 p-4 space-y-4">
                        <div className="flex items-center gap-2">
                          <Gavel className="w-4 h-4 text-orange-400" />
                          <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-orange-400">Console Arbitre</span>
                        </div>

                        {/* Valider le score directement depuis ici */}
                        <div>
                          <button
                            onClick={() => setShowArbiterScore((v) => !v)}
                            className="w-full flex items-center justify-between gap-3 border border-white/10 px-4 py-3 text-[10px] font-display font-black uppercase tracking-widest hover:border-white/30 transition-colors"
                          >
                            <span className="flex items-center gap-2">
                              <Trophy className="w-3.5 h-3.5 text-zoyd-yellow" />
                              Trancher le litige — Valider le score
                            </span>
                            {showArbiterScore ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>

                          {showArbiterScore && (
                            <div className="mt-3 space-y-3 border border-white/5 p-4 bg-black/30">
                              <div className="grid md:grid-cols-2 gap-3">
                                <input
                                  type="number"
                                  value={scoreAlpha}
                                  onChange={(e) => setScoreAlpha(e.target.value)}
                                  placeholder="Score Alpha"
                                  className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                                />
                                <input
                                  type="number"
                                  value={scoreBravo}
                                  onChange={(e) => setScoreBravo(e.target.value)}
                                  placeholder="Score Bravo"
                                  className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                                />
                              </div>
                              <textarea
                                value={resultNotes}
                                onChange={(e) => setResultNotes(e.target.value)}
                                placeholder="Notes d'arbitrage sur ce litige..."
                                className="w-full min-h-20 bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                              />
                              <button
                                onClick={handleResultSubmit}
                                className="w-full bg-zoyd-yellow text-black py-3 font-display font-black uppercase tracking-widest text-xs italic hover:bg-white transition-colors"
                              >
                                Valider le score &amp; clore le litige
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Escalade */}
                        {(openDisputeRecord.level || 1) < 2 && (
                          <div className="border-t border-white/5 pt-4">
                            <p className="text-xs text-white/40 mb-3">
                              Impossible de trancher ? L'équipe d'administration ZOYD peut prendre le relais.
                            </p>
                            <button
                              onClick={handleEscalate}
                              disabled={isEscalating}
                              className="flex items-center gap-2 border border-red-500/30 text-red-400 px-4 py-3 text-[10px] font-display font-black uppercase tracking-widest hover:bg-red-500/10 transition-colors disabled:opacity-40"
                            >
                              <Flame className="w-3.5 h-3.5" />
                              {isEscalating ? 'Escalade en cours…' : 'Escalader à l\'Administration'}
                            </button>
                          </div>
                        )}

                        {(openDisputeRecord.level || 1) >= 2 && (
                          <div className="border border-red-400/20 bg-red-400/5 px-4 py-3 text-xs text-red-300">
                            Litige escaladé le {openDisputeRecord.escalatedAt ? new Date(openDisputeRecord.escalatedAt).toLocaleString('fr-FR') : '—'} par {openDisputeRecord.escalatedByPseudo || 'arbitre'}. Un admin va intervenir.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

              ) : (
                /* ── PAS DE LITIGE : formulaire d'ouverture ── */
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <AlertTriangle className="w-4 h-4 text-zoyd-yellow" />
                    <h2 className="text-lg font-display font-black uppercase italic">Un souci sur ce match ?</h2>
                  </div>
                  <div className="space-y-3">
                    <select
                      value={disputeCategory}
                      onChange={(event) => setDisputeCategory(event.target.value as DisputeCategory)}
                      className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                    >
                      {Object.entries(disputeCategoryLabels).map(([value, label]) => (
                        <option key={value} value={value} className="bg-zoyd-black">
                          {label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={disputeReason}
                      onChange={(event) => setDisputeReason(event.target.value)}
                      placeholder="Raison du litige"
                      className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                    />
                    <textarea
                      value={disputeEvidence}
                      onChange={(event) => setDisputeEvidence(event.target.value)}
                      placeholder="Screenshots, room logs ou preuves, séparés par des virgules"
                      className="w-full min-h-24 bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                    />
                    <button onClick={handleDispute} className="w-full border border-white/10 py-4 font-display font-black uppercase tracking-widest text-xs italic hover:border-red-400 hover:text-red-300 transition-colors">
                      Ouvrir un litige
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="h-[520px]">
              <div className="mb-4 border border-white/5 bg-black/30 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-white/25 mb-1">
                      Presence salon
                    </div>
                    <div className="text-sm text-white/65">
                      {presenceSummary.onlineCount}/{presenceSummary.total} presents, {presenceSummary.checkedInCount} check-in, {presenceSummary.readyCount} prets.
                    </div>
                  </div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-white/25">
                    {presenceSummary.arbiterOnline ? 'Arbitre actif' : 'Arbitre attendu'}
                    {lastHeartbeatAt ? ` / sync ${new Date(lastHeartbeatAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}
                  </div>
                </div>
              </div>
              <MatchChat
                messages={messages}
                isConnected={channelConnected}
                presence={channelPresence}
                typingUsers={typingUsers}
                readCount={readCount}
                onTypingChange={(isTyping) => {
                  if (!user) return;
                  setTyping(match.channelId, user.id, user.pseudo, isTyping);
                }}
                onSendMessage={(text) => {
                  if (!user) {
                    navigate('/auth/login');
                    return;
                  }
                  void sendServerChatMessage(match.channelId, text)
                    .then((payload) => {
                      hydrateChat([payload.channel], [payload.message]);
                      receiveServerMessage(payload.message, user.id);
                      setTyping(match.channelId, user.id, user.pseudo, false);
                      markChannelSeen(match.channelId, user.id);
                      void markServerChatChannelRead(match.channelId).catch(() => undefined);
                    })
                    .catch((error) => {
                      toast.error(error instanceof Error ? error.message : "Impossible d'envoyer ce message.");
                    });
                }}
              />
            </div>
          </div>
        </div>
      </div>
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

const TeamCard = ({
  title,
  players,
  teamSize,
  accent,
}: {
  title: string;
  players: Array<{ userId: string; pseudo: string; isCheckedIn: boolean; isReady: boolean; isCaptain: boolean }>;
  teamSize: number;
  accent: 'blue' | 'white';
}) => (
  <div className="hud-panel p-6 bg-zoyd-surface/20">
    <div className="flex items-center justify-between mb-5">
      <h2 className="text-lg font-display font-black uppercase italic">{title}</h2>
      <div className="text-[10px] font-mono uppercase tracking-widest text-white/30">
        {players.length}/{teamSize} places
      </div>
    </div>
    <div className="space-y-3">
      {players.map((player) => (
        <div key={player.userId} className="flex items-center justify-between border border-white/5 px-4 py-3 bg-black/40">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${accent === 'blue' ? 'bg-zoyd-blue' : 'bg-white'}`} />
            <div>
              <div className="font-display font-black text-sm uppercase italic text-white">
                {player.pseudo}
                {player.isCaptain ? ' / Capitaine' : ''}
              </div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-white/20">
                {player.isCheckedIn ? 'Presence confirmee' : 'En attente'}
              </div>
            </div>
          </div>
          <div className={`text-[10px] font-mono uppercase tracking-widest ${player.isReady ? 'text-green-400' : 'text-white/20'}`}>
            {player.isReady ? 'Pret' : 'En attente'}
          </div>
        </div>
      ))}
      {Array.from({ length: Math.max(0, teamSize - players.length) }).map((_, index) => (
        <div key={index} className="border border-dashed border-white/10 px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-white/20">
          Slot libre
        </div>
      ))}
    </div>
  </div>
);

const RuleRow = ({ label, value }: { label: string; value: string }) => (
  <div className="border border-white/5 px-4 py-3 bg-black/30">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-1">{label}</div>
    <div className="font-display font-black text-white italic">{value}</div>
  </div>
);

const EvidencePanel = ({ title, items }: { title: string; items: string[] }) => (
  <div className="border border-white/5 bg-black/30 px-4 py-3">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">{title}</div>
    {items.length > 0 ? (
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={`${title}-${index}`} className="text-xs text-white/70 break-all">
            {item}
          </div>
        ))}
      </div>
    ) : (
      <div className="text-xs text-white/25">Aucune piece jointe.</div>
    )}
  </div>
);

export default MatchDetailPage;
