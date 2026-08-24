import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
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
import { Skeleton } from '../../../app/components/ui/Skeleton';
import { useWalletStore } from '../../../app/stores/walletStore';
import { buildFundingPath, getRequiredTopUp } from '../../../lib/walletFunding';
import { getCountdownDisplay, formatZC } from '../../../lib/utils';
import { MatchHeader } from '../components/MatchHeader';
import { MatchPlayers } from '../components/MatchPlayers';
import { MatchRules } from '../components/MatchRules';
import { MatchResults } from '../components/MatchResults';
import { MatchActions } from '../components/MatchActions';
import { MatchTimeline } from '../components/MatchTimeline';

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
    bootstrapReady,
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
  const [isJoining, setIsJoining] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeEvidence, setDisputeEvidence] = useState('');
  const [addEvidenceInput, setAddEvidenceInput] = useState('');
  const [showAddEvidenceForm, setShowAddEvidenceForm] = useState(false);
  const [isEscalating, setIsEscalating] = useState(false);
  const [showArbiterScore, setShowArbiterScore] = useState(false);
  const [isSubmittingResult, setIsSubmittingResult] = useState(false);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

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

  if (!bootstrapReady) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white flex items-center justify-center safe-top safe-bottom">
        <div className="max-w-[1500px] w-full px-4 py-8 space-y-4">
          <Skeleton className="h-8 w-48 bg-white/5" />
          <Skeleton className="h-40 w-full bg-white/5" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-24 bg-white/5" />
            <Skeleton className="h-24 bg-white/5" />
          </div>
          <Skeleton className="h-64 w-full bg-white/5" />
        </div>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white flex items-center justify-center safe-top safe-bottom">
        <div className="text-center">
          <h2 className="text-2xl font-display font-black uppercase mb-4">Match introuvable</h2>
          <Link to="/mj" className="border border-white/10 px-6 py-3 uppercase text-sm font-display font-black tracking-widest touch-target">
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

    if (isJoining) return;
    setIsJoining(true);
    try {
      const response = await joinServerMatch(match.id, team);
      applyMatchResponse(response);
      toast.success(`Pass bloque. Tu rejoins ${team === 1 ? 'Squad Bravo' : team === 0 ? 'Squad Alpha' : 'l equipe disponible'}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de rejoindre ce match avec ton profil actuel.");
    } finally {
      setIsJoining(false);
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
    if (isSubmittingResult) {
      toast.error('Un resultat est deja en cours de soumission. Patientes...');
      return;
    }

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

    setIsSubmittingResult(true);

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
    } finally {
      setIsSubmittingResult(false);
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
    if (isProcessingAction) return;
    setIsProcessingAction(true);
    try {
      const response = await checkInServerMatch(match.id);
      applyMatchResponse(response);
      toast.success('Presence confirmee.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Check-in impossible.');
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleToggleReady = async () => {
    if (isProcessingAction) return;
    setIsProcessingAction(true);
    try {
      const response = await toggleServerReady(match.id);
      applyMatchResponse(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Mise a jour ready impossible.');
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleLaunch = async () => {
    if (isProcessingAction) return;
    setIsProcessingAction(true);
    try {
      const response = await launchServerMatch(match.id);
      applyMatchResponse(response);
      toast.success('Le match passe en direct.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Lancement impossible.');
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleConfirmResult = async () => {
    if (isProcessingAction) return;
    setIsProcessingAction(true);
    try {
      const response = await confirmServerMatchResult(match.id);
      applyMatchResponse(response);
      toast.success('Resultat confirme de ton cote.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Confirmation impossible.');
    } finally {
      setIsProcessingAction(false);
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
    <div className="min-h-dvh bg-zoyd-black text-white scanline safe-top">
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />
      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 md:px-8 py-8 md:py-10 relative z-10">
        <MatchHeader match={match} statusLabel={statusLabel} />
        <div className="grid xl:grid-cols-[1.15fr_0.85fr] gap-8">
          <div className="space-y-8">
            <MatchPlayers match={match} teamAlpha={teamAlpha} teamBravo={teamBravo} countdown={countdown} />
            <MatchRules match={match} canSeeRoom={canSeeRoom} />
            <MatchResults match={match} forfeitLabel={forfeitLabel} currentPlayer={currentPlayer} onConfirmResult={handleConfirmResult} />
          </div>
          <div className="space-y-8">
            <MatchActions
              match={match}
              user={user}
              currentPlayer={currentPlayer}
              isArbiter={isArbiter}
              canJoinAsPlayer={canJoinAsPlayer}
              canJoinArbiterSlot={canJoinArbiterSlot}
              canCheckIn={canCheckIn}
              canToggleReady={canToggleReady}
              canLaunch={canLaunch}
              availableSpend={availableSpend}
              requiredTopUp={requiredTopUp}
              fundingPath={fundingPath}
              roomPublishWindow={roomPublishWindow}
              openDisputeRecord={openDisputeRecord}
              scheduleValue={scheduleValue}
              setScheduleValue={setScheduleValue}
              roomName={roomName}
              setRoomName={setRoomName}
              roomPassword={roomPassword}
              setRoomPassword={setRoomPassword}
              scoreAlpha={scoreAlpha}
              setScoreAlpha={setScoreAlpha}
              scoreBravo={scoreBravo}
              setScoreBravo={setScoreBravo}
              resultNotes={resultNotes}
              setResultNotes={setResultNotes}
              scoreboardProofs={scoreboardProofs}
              setScoreboardProofs={setScoreboardProofs}
              finalResultProofs={finalResultProofs}
              setFinalResultProofs={setFinalResultProofs}
              roomCaptureProofs={roomCaptureProofs}
              setRoomCaptureProofs={setRoomCaptureProofs}
              extraResultProofs={extraResultProofs}
              setExtraResultProofs={setExtraResultProofs}
              disputeCategory={disputeCategory}
              setDisputeCategory={setDisputeCategory}
              disputeReason={disputeReason}
              setDisputeReason={setDisputeReason}
              disputeEvidence={disputeEvidence}
              setDisputeEvidence={setDisputeEvidence}
              addEvidenceInput={addEvidenceInput}
              setAddEvidenceInput={setAddEvidenceInput}
              showAddEvidenceForm={showAddEvidenceForm}
              setShowAddEvidenceForm={setShowAddEvidenceForm}
              isEscalating={isEscalating}
              showArbiterScore={showArbiterScore}
              setShowArbiterScore={setShowArbiterScore}
              isSubmittingResult={isSubmittingResult}
              isProcessingAction={isProcessingAction}
              handleJoin={handleJoin}
              handleJoinAsArbiter={handleJoinAsArbiter}
              handleSchedule={handleSchedule}
              handleRoomSave={handleRoomSave}
              handleResultSubmit={handleResultSubmit}
              handleDispute={handleDispute}
              handleCheckIn={handleCheckIn}
              handleToggleReady={handleToggleReady}
              handleLaunch={handleLaunch}
              handleAddEvidence={handleAddEvidence}
              handleEscalate={handleEscalate}
            />
            <MatchTimeline
              messages={messages}
              channelConnected={channelConnected}
              channelPresence={channelPresence}
              typingUsers={typingUsers}
              readCount={readCount}
              presenceSummary={presenceSummary}
              lastHeartbeatAt={lastHeartbeatAt}
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
  );
};

export default MatchDetailPage;
