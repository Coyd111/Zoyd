import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useReducedMotion } from 'motion/react';
import { AlertTriangle, ArrowLeft, Swords, Trophy, UserPlus, UserX } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useFriendsStore } from '../stores/friendsStore';
import { useMatchStore } from '../stores/matchStore';
import { useTournamentStore } from '../stores/tournamentStore';
import { useSocketStore } from '../stores/socketStore';
import { Skeleton } from '../components/ui/Skeleton';
import { Button } from '../components/ui/Button';
import ProfileView from '../components/profile/ProfileView';
import { buildCompetitiveSummary, createPublicProfile, getObservedPlayerSnapshot } from '../../lib/profileMetrics';
import { sendServerFriendRequest, blockServerUser } from '../lib/socialApi';
import { toast } from 'sonner';

const PublicProfilPage = () => {
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
          <p className="text-white/40 mb-6">
            Ce joueur n&apos;a pas encore assez d&apos;activite sur ZOYD pour afficher un profil public complet.
          </p>
          <Button variant="primary" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
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
      sendRequest(id, publicProfile.pseudo);
      toast.success(`Demande envoyee a ${publicProfile.pseudo}.`);
    } catch {
      toast.error("Impossible d'envoyer la demande.");
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
      blockUser(id);
      toast.success(`${publicProfile.pseudo} est maintenant bloque.`);
    } catch {
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
    toast.success(`Signalement enregistre pour ${publicProfile.pseudo}.`);
    setConfirmReport(false);
  };

  return (
    <ProfileView
      userId={id}
      pseudo={publicProfile.pseudo}
      country={publicProfile.country}
      controllerType={publicProfile.controllerType}
      gameId={publicProfile.gameId}
      dateJoined={publicProfile.dateJoined}
      trustScore={publicProfile.trustScore}
      streamerMode={publicProfile.streamerMode}
      isOnline={publicProfile.isOnline}
      levelCODM={publicProfile.levelCODM}
      rankMJ={publicProfile.rankMJ}
      rankBR={publicProfile.rankBR}
      summary={summary}
      prefersReducedMotion={prefersReducedMotion}
      emptyMatchesImage="/assets/images/codm-2.jpg"
      emptyTournamentsImage="/assets/images/codm-3.jpg"
      trustDescription="Cette fiche rassemble ce que ZOYD a deja pu voir de ce joueur dans ses matchs, ses tournois et ses relations."
      codmTitle="Infos visibles"
      backLink={
        <Link to="/profil" className="inline-flex items-center gap-2 text-white/40 hover:text-white transition-colors text-sm uppercase font-mono tracking-widest">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Retour profil
        </Link>
      }
      headerActions={
        !ownProfile ? (
          <div className="flex flex-col gap-2 min-w-[220px]">
            <Button variant="primary" size="sm" onClick={handleAddFriend} disabled={alreadyFriend || blocked} className="touch-target" aria-label={alreadyFriend ? 'Déjà ami' : blocked ? 'Joueur bloqué' : `Ajouter ${publicProfile.pseudo} en ami`}>
              <UserPlus className="w-4 h-4 mr-2" aria-hidden="true" />
              {alreadyFriend ? 'Deja ami' : blocked ? 'Bloque' : 'Ajouter en ami'}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleInviteMatch} className="touch-target" aria-label={`Inviter ${publicProfile.pseudo} en match`}>
              <Swords className="w-4 h-4 mr-2" aria-hidden="true" />
              Inviter en match
            </Button>
            <Button variant="danger" size="sm" onClick={handleBlock} className="touch-target" aria-label={`Bloquer ${publicProfile.pseudo}`}>
              <UserX className="w-4 h-4 mr-2" aria-hidden="true" />
              Bloquer
            </Button>
            <Button variant="ghost" size="sm" onClick={handleReport} className={`touch-target ${confirmReport ? 'border-red-400 text-red-300' : 'text-red-300 hover:text-red-200'}`} aria-label={confirmReport ? 'Confirmer le signalement' : `Signaler ${publicProfile.pseudo}`}>
              <AlertTriangle className="w-4 h-4 mr-2" aria-hidden="true" />
              {confirmReport ? 'Confirmer le signalement' : 'Signaler'}
            </Button>
            {confirmReport && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmReport(false)} className="touch-target text-white/40 hover:text-white">
                Annuler
              </Button>
            )}
          </div>
        ) : undefined
      }
    />
  );
};

export default PublicProfilPage;
