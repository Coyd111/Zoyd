import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Flag,
  Gamepad2,
  Globe,
  Joystick,
  Monitor,
  ShieldCheck,
  Smartphone,
  Swords,
  Target,
  Trophy,
  UserPlus,
  UserX,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useFriendsStore } from '../stores/friendsStore';
import { useMatchStore } from '../stores/matchStore';
import { useTournamentStore } from '../stores/tournamentStore';
import { useSocketStore } from '../stores/socketStore';
import { Skeleton } from '../components/ui/Skeleton';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import EmptyPanel from '../components/EmptyPanel';
import { buildCompetitiveSummary, createPublicProfile, getObservedPlayerSnapshot } from '../../lib/profileMetrics';
import { formatZC } from '../../lib/utils';
import { sendServerFriendRequest, blockServerUser } from '../lib/socialApi';
import { toast } from 'sonner';

const controllerIcons: Record<string, React.ReactNode> = {
  touch: <Smartphone className="w-4 h-4" />,
  controller: <Joystick className="w-4 h-4" />,
  emulator: <Monitor className="w-4 h-4" />,
  pc: <Gamepad2 className="w-4 h-4" />,
  other: <Globe className="w-4 h-4" />,
};

const PublicProfilPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();
  const { friends, sendRequest, blockUser, reportUser, isBlocked, isFriend } = useFriendsStore();
  const { matches } = useMatchStore();
  const { tournaments } = useTournamentStore();
  const bootstrapReady = useSocketStore((s) => s.bootstrapReady);
  const prefersReducedMotion = useReducedMotion();

  const friendRecord = friends.find((friend) => friend.id === id);
  const observedPlayer = id ? getObservedPlayerSnapshot(id, matches) : undefined;
  const observedArbiter = id
    ? matches.find((match) => match.arbiter?.userId === id)?.arbiter
    : undefined;

  const publicProfile = useMemo(
    () =>
      id
        ? createPublicProfile({
            userId: id,
            currentUser,
            observedPlayer: observedPlayer ?? null,
            observedArbiter: observedArbiter ?? null,
            friendRecord: friendRecord ?? null,
          })
        : null,
    [currentUser, friendRecord, id, observedArbiter, observedPlayer]
  );

  const summary = useMemo(() => {
    if (!id || !publicProfile) return null;
    return buildCompetitiveSummary({
      userId: id,
      overallTrustScore: publicProfile.trustScore,
      matches,
      tournaments,
      dateJoined: publicProfile.dateJoined,
    });
  }, [id, matches, publicProfile, tournaments]);

  if (!id) return null;

  if (!bootstrapReady) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white flex items-center justify-center">
        <div className="max-w-[1500px] w-full px-4 py-8 space-y-4">
          <Skeleton className="h-48 w-full bg-white/5" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-24 bg-white/5" />
            <Skeleton className="h-24 bg-white/5" />
          </div>
          <Skeleton className="h-64 w-full bg-white/5" />
        </div>
      </div>
    );
  }

  if (!publicProfile || !summary) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white flex items-center justify-center">
        <div className="text-center max-w-lg px-6">
          <h2 className="text-2xl font-display font-black uppercase mb-4">Profil public indisponible</h2>
          <p className="text-white/35 mb-6">
            Ce joueur n&apos;a pas encore assez d&apos;activite sur ZOYD pour afficher un profil public complet.
          </p>
          <Button variant="primary" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Retour
          </Button>
        </div>
      </div>
    );
  }

  const ownProfile = currentUser?.id === id;
  const blocked = isBlocked(id);
  const alreadyFriend = isFriend(id);

  const handleAddFriend = async () => {
    if (!currentUser) {
      navigate('/auth/login');
      return;
    }
    try {
      await sendServerFriendRequest(id, 'Salut, jouons ensemble !');
      sendRequest(id, publicProfile.pseudo); // Optimistic UI update
      toast.success(`Demande envoyée à ${publicProfile.pseudo}.`);
    } catch (err) {
      toast.error('Impossible d\'envoyer la demande.');
    }
  };

  const handleInviteMatch = () => {
    if (!currentUser) {
      navigate('/auth/login');
      return;
    }
    navigate(`/mj/creer?invite=${encodeURIComponent(id)}`);
  };

  const handleBlock = async () => {
    if (!currentUser) {
      navigate('/auth/login');
      return;
    }
    try {
      await blockServerUser(id);
      blockUser(id); // Optimistic UI update
      toast.success(`${publicProfile.pseudo} est maintenant bloqué.`);
    } catch (err) {
      toast.error('Erreur lors du blocage.');
    }
  };

  const [confirmReport, setConfirmReport] = useState(false);

  const handleReport = () => {
    if (!currentUser) {
      navigate('/auth/login');
      return;
    }
    if (!confirmReport) {
      setConfirmReport(true);
      return;
    }
    reportUser(id, 'other', `Signalement manuel depuis le profil public de ${publicProfile.pseudo}.`);
    toast.success(`Signalement enregistré pour ${publicProfile.pseudo}.`);
    setConfirmReport(false);
  };

  return (
    <div className="min-h-dvh bg-zoyd-black text-white font-ui scanline pb-24 pt-safe-top">
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <header className="relative border-b border-white/5 bg-zoyd-surface/40 overflow-hidden">
        <img src="/assets/images/codm-2.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-luminosity grayscale pointer-events-none" />
        <img src="/assets/images/codm-4.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-overlay grayscale pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-zoyd-black via-zoyd-black/60 to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-[1500px] mx-auto px-4 sm:px-6 py-12">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/profil" className="inline-flex items-center gap-2 text-white/40 hover:text-white transition-colors text-sm uppercase font-mono tracking-widest">
              <ArrowLeft className="w-4 h-4" />
              Retour profil
            </Link>
          </div>

          <div className="flex flex-col lg:flex-row items-start lg:items-center gap-8">
            <div className="relative">
              <div className="w-20 h-20 sm:w-24 sm:h-24 border-2 border-white/10 bg-zoyd-surface flex items-center justify-center">
                <span className="text-5xl font-display font-black text-white/20 italic">
                  {publicProfile.pseudo.slice(0, 2).toUpperCase()}
                </span>
              </div>
              {publicProfile.isOnline ? (
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 border-2 border-zoyd-black" />
              ) : null}
            </div>

            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <h1 className="text-3xl sm:text-4xl font-display font-black uppercase tracking-tighter italic">
                  {publicProfile.pseudo}
                </h1>
                {publicProfile.streamerMode ? <Badge variant="yellow">Streamer mode</Badge> : null}
                <Badge
                  variant={
                    publicProfile.trustScore >= 80
                      ? 'success'
                      : publicProfile.trustScore >= 50
                        ? 'default'
                        : 'disabled'
                  }
                >
                  FIABILITE {publicProfile.trustScore}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-6 text-sm text-white/40 font-mono uppercase tracking-widest">
                {publicProfile.country ? (
                  <span className="flex items-center gap-2">
                    <Flag className="w-4 h-4" /> {publicProfile.country}
                  </span>
                ) : null}
                {publicProfile.controllerType ? (
                  <span className="flex items-center gap-2">
                    {controllerIcons[publicProfile.controllerType] || controllerIcons.other} {publicProfile.controllerType}
                  </span>
                ) : null}
                {publicProfile.gameId ? (
                  <span className="flex items-center gap-2">
                    <Gamepad2 className="w-4 h-4" /> Game ID: {publicProfile.gameId}
                  </span>
                ) : null}
                {publicProfile.dateJoined ? (
                  <span className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" /> Membre depuis {new Date(publicProfile.dateJoined).toLocaleDateString('fr-FR')}
                  </span>
                ) : null}
              </div>
            </div>

            {!ownProfile ? (
              <div className="flex flex-col gap-2 min-w-[220px]">
                <Button variant="primary" size="sm" onClick={handleAddFriend} disabled={alreadyFriend || blocked} className="touch-target">
                  <UserPlus className="w-4 h-4 mr-2" />
                  {alreadyFriend ? 'Deja ami' : blocked ? 'Bloque' : 'Ajouter en ami'}
                </Button>
                <Button variant="secondary" size="sm" onClick={handleInviteMatch} className="touch-target">
                  <Swords className="w-4 h-4 mr-2" />
                  Inviter en match
                </Button>
                <Button variant="danger" size="sm" onClick={handleBlock} className="touch-target">
                  <UserX className="w-4 h-4 mr-2" />
                  Bloquer
                </Button>
                <Button variant="ghost" size="sm" onClick={handleReport} className={`touch-target ${confirmReport ? 'border-red-400 text-red-300' : 'text-red-300 hover:text-red-200'}`}>
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  {confirmReport ? 'Confirmer le signalement' : 'Signaler'}
                </Button>
                {confirmReport && (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmReport(false)} className="touch-target text-white/40 hover:text-white">
                    Annuler
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
        animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        className="max-w-[1500px] mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-8 relative z-10"
      >
        <div className="space-y-6">
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-mono uppercase tracking-widest text-zoyd-blue mb-3">Carrière Joueur</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <StatCard icon={<Trophy className="w-5 h-5 text-zoyd-yellow" />} label="Cash Prize Observé" value={formatZC(summary.stats.totalEarnings)} />
                <StatCard icon={<Swords className="w-5 h-5 text-zoyd-blue" />} label="Matchs observés" value={summary.stats.totalMatches.toString()} />
                <StatCard icon={<Target className="w-5 h-5 text-green-400" />} label="Win rate" value={`${summary.stats.winRate}%`} />
                <StatCard icon={<ShieldCheck className="w-5 h-5 text-white" />} label="Tournois joués" value={`${summary.stats.tournamentsWon} / ${summary.stats.tournamentsPlayed}`} />
              </div>
            </div>

            <div className="pt-4 mt-2 border-t border-white/5">
              <h3 className="text-sm font-mono uppercase tracking-widest text-zoyd-yellow mb-3">Carrière Arbitre</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <StatCard icon={<ShieldCheck className="w-5 h-5 text-zoyd-yellow" />} label="Matchs arbitrés" value={summary.arbiterStats?.arbitratedMatches.toString() || '0'} />
                <StatCard icon={<Trophy className="w-5 h-5 text-green-400" />} label="Commissions générées" value={formatZC(summary.arbiterStats?.totalCommissions || 0)} />
              </div>
            </div>
          </div>

          <div className="hud-panel p-6 bg-zoyd-surface/20">
            <div className="flex items-center gap-3 mb-5">
              <ShieldCheck className="w-5 h-5 text-zoyd-yellow" />
              <h2 className="text-lg font-display font-black uppercase italic">Fiabilite visible</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <TrustCell label="Score global" value={`${summary.trust.overall}/100`} accent="text-zoyd-yellow" />
              <TrustCell label="Matchs completes" value={summary.trust.completedMatches.toString()} accent="text-white" />
              <TrustCell label="Litiges observes" value={summary.trust.disputedMatches.toString()} accent="text-zoyd-blue" />
              <TrustCell label="Forfaits connus" value={summary.trust.forfeits.toString()} accent={summary.trust.forfeits > 0 ? 'text-red-300' : 'text-green-400'} />
            </div>
            <p className="text-xs text-white/35 mt-4">
              Cette fiche rassemble ce que ZOYD a deja pu voir de ce joueur dans ses matchs, ses tournois et ses relations.
            </p>
          </div>

          <div className="hud-panel p-6 bg-zoyd-surface/20">
            <div className="flex items-center gap-3 mb-5">
              <Gamepad2 className="w-5 h-5 text-zoyd-blue" />
              <h2 className="text-lg font-display font-black uppercase italic">Infos visibles</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {publicProfile.rankMJ ? <InfoRow label="Rank MJ" value={publicProfile.rankMJ} /> : null}
              {publicProfile.rankBR ? <InfoRow label="Rank BR" value={publicProfile.rankBR} /> : null}
              {publicProfile.levelCODM ? <InfoRow label="Niveau CODM" value={`${publicProfile.levelCODM}`} /> : null}
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <section>
            <h2 className="text-lg font-display font-black uppercase tracking-tighter italic mb-6">Historique recent match</h2>
            {summary.recentMatches.length === 0 ? (
              <EmptyPanel
                icon={<Swords className="w-8 h-8 text-white/10" />}
                image="/assets/images/codm-2.jpg"
                title="Aucune activite match"
                body="Ce joueur n'a pas encore de match assez avance sur ZOYD pour afficher un historique ici."
              />
            ) : (
              <div className="space-y-3">
                {summary.recentMatches.map((match) => {
                  const player = match.players.find((entry) => entry.userId === id);
                  const isWin = !!match.result && !!player && player.team === match.result.winnerTeam;
                  return (
                    <div
                      key={match.id}
                      className="hud-panel p-4 bg-zoyd-surface/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zoyd-surface/30 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-2 h-2 ${isWin ? 'bg-green-500' : 'bg-white/20'}`} />
                        <div>
                          <div className="font-display font-black text-white text-sm uppercase italic">
                            {match.rules.map} <span className="text-white/20">///</span> {match.rules.mode}
                          </div>
                          <div className="text-[10px] font-mono text-white/30 uppercase tracking-wider">
                            {match.format} / {new Date(match.finishedAt || match.createdAt).toLocaleDateString('fr-FR')}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-display font-black italic text-sm ${isWin ? 'text-zoyd-yellow' : 'text-white/50'}`}>
                          {isWin ? `+${formatZC(Math.max(0, match.prizePool - match.zoydFee - match.arbiterFee))}` : formatZC(match.entryFee)}
                        </div>
                        <div className="text-[10px] font-mono text-white/20 uppercase">
                          {match.status === 'disputed' ? 'LITIGE' : match.status}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-lg font-display font-black uppercase tracking-tighter italic mb-6">Tournois joues</h2>
            {summary.tournamentPlacements.length === 0 ? (
              <EmptyPanel
                icon={<Trophy className="w-8 h-8 text-white/10" />}
                image="/assets/images/codm-3.jpg"
                title="Aucun tournoi visible"
                body="Ses participations et ses podiums apparaitront ici a mesure que ses tournois se termineront."
              />
            ) : (
              <div className="space-y-3">
                {summary.tournamentPlacements.map((placement) => (
                  <div
                    key={`${placement.tournamentId}-${placement.placement}`}
                    className="hud-panel p-4 bg-zoyd-surface/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zoyd-surface/30 transition-colors"
                  >
                    <div>
                      <div className="font-display font-black text-white text-sm uppercase italic">
                        {placement.name}
                      </div>
                      <div className="text-[10px] font-mono text-white/30 uppercase tracking-wider">
                        {placement.format} / {placement.finishedAt ? new Date(placement.finishedAt).toLocaleDateString('fr-FR') : 'Resultat valide'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-display font-black text-zoyd-yellow italic text-sm">
                        Top {placement.placement}
                      </div>
                      <div className="text-[10px] font-mono text-white/20 uppercase">
                        {placement.payout > 0 ? formatZC(placement.payout) : 'Participation'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </motion.div>
    </div>
  );
};

const StatCard = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="hud-panel p-5 bg-zoyd-surface/20 flex items-center gap-4">
    <div className="w-10 h-10 border border-white/10 flex items-center justify-center bg-black">{icon}</div>
    <div>
      <div className="text-[9px] font-mono font-black uppercase tracking-widest text-white/30 mb-1">{label}</div>
      <div className="text-xl font-display font-black text-white italic">{value}</div>
    </div>
  </div>
);

const TrustCell = ({ label, value, accent }: { label: string; value: string; accent: string }) => (
  <div className="border border-white/5 px-4 py-3 bg-black/30">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-1">{label}</div>
    <div className={`font-display font-black italic ${accent}`}>{value}</div>
  </div>
);

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className="border border-white/5 px-4 py-3 bg-black/30">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-1">{label}</div>
    <div className="font-display font-black italic text-white">{value}</div>
  </div>
);

export default PublicProfilPage;
