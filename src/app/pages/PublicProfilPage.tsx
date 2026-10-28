/**
 * PublicProfilPage - profil public d'un autre joueur (/profil/:id).
 *
 * Meme affichage que ProfilPage, mais pour un tiers : la resolution du
 * joueur dans les matchs se fait alors par `pseudo`, jamais par `isMe`.
 *
 * INVARIANT : sur le profil d'un tiers, `isMe` vaut false PARTOUT : le
 * serveur l'a calcule pour le demandeur, pas pour la cible. Utiliser
 * `pseudo` pour retrouver le joueur dans un match.
 * PIEGE : la page est en `noindex` et sa canonique doit pointer sur
 * /profil/:id, pas sur /profil (l'index). La fausse canonique a deja survecu
 * a un retrait de noindex.
 * PIEGE : les actions sociales (demande d'ami, blocage, signalement) passent
 * par le store friendsStore, donc par l'API.
 *
 * Voir aussi : docs/08-frontend.md - section 10.1 (Pages de src/app/pages/)
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useReducedMotion } from 'motion/react';
import { AlertTriangle, ArrowLeft, Swords, UserPlus, UserX } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useFriendsStore } from '../stores/friendsStore';
import { useMatchStore } from '../stores/matchStore';
import { useTournamentStore } from '../stores/tournamentStore';
import { useSocketStore } from '../stores/socketStore';
import { Skeleton } from '../components/ui/Skeleton';
import { Button } from '../components/ui/Button';
import BootstrapFailedPanel from '../components/BootstrapFailedPanel';
import ProfileView from '../components/profile/ProfileView';
import { buildCompetitiveSummary, createPublicProfile, getObservedPlayerSnapshot } from '../../lib/profileMetrics';
import { sendServerFriendRequest } from '../lib/socialApi';
import { toast } from '../lib/toast';
import { SEOHead } from '../components/SEOHead';

const PublicProfilPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();
  const friends = useFriendsStore((s) => s.friends);
  const sendRequest = useFriendsStore((s) => s.sendRequest);
  const blockUser = useFriendsStore((s) => s.blockUser);
  const reportUser = useFriendsStore((s) => s.reportUser);
  const isBlocked = useFriendsStore((s) => s.isBlocked);
  const isFriend = useFriendsStore((s) => s.isFriend);
  const matches = useMatchStore((s) => s.matches);
  const tournaments = useTournamentStore((s) => s.tournaments);
  const bootstrapReady = useSocketStore((s) => s.bootstrapReady);
  // F2 : echec definitif du bootstrap -> panneau explicite + Reessayer, au
  // lieu du squelette eternel sur un profil public.
  const bootstrapFailed = useSocketStore((s) => s.bootstrapFailed);
  const retryBootstrap = () => { void useSocketStore.getState().bootstrapServerState(currentUser); };
  const prefersReducedMotion = useReducedMotion();

  const friendRecord = friends.find((friend) => friend.id === id);
  const ownProfile = !!currentUser && currentUser.id === id;
  // Le serveur retire le `userId` des joueurs de match : le profil d'un tiers ne
  // peut donc plus etre retrouve DANS un match que par son `pseudo`. Cote
  // client, le seul pseudo associe a un `userId` tiers est celui de la liste
  // d'amis. Pour un non-ami, aucune donnee ne relie son id a un pseudo :
  // `createPublicProfile` renverra alors `null` et la page affiche deja son
  // etat « profil public indisponible ». Pour son propre profil, `currentUser`
  // fournit le pseudo et `isMe` suffit.
  const targetPseudo = ownProfile ? currentUser?.pseudo : friendRecord?.pseudo;
  const target = targetPseudo ? { isOwnProfile: ownProfile, pseudo: targetPseudo } : undefined;
  const observedPlayer = target ? getObservedPlayerSnapshot(target, matches) : undefined;
  const observedArbiter = target
    ? matches.find((match) =>
        target.isOwnProfile ? match.arbiter?.isMe === true : match.arbiter?.pseudo === target.pseudo
      )?.arbiter
    : undefined;

  const publicProfile = useMemo(
    () =>
      id
        ? createPublicProfile({
            userId: id,
            currentUser,
            observedPlayer: observedPlayer ?? undefined,
            observedArbiter: observedArbiter ?? undefined,
            friendRecord: friendRecord ?? undefined,
          })
        : null,
    [currentUser, friendRecord, id, observedArbiter, observedPlayer]
  );

  const summary = useMemo(() => {
    if (!id || !publicProfile || !targetPseudo) return null;
    return buildCompetitiveSummary({
      target: { isOwnProfile: ownProfile, pseudo: targetPseudo },
      overallTrustScore: publicProfile.trustScore,
      matches,
      tournaments,
      dateJoined: publicProfile.dateJoined,
    });
  }, [id, matches, ownProfile, publicProfile, targetPseudo, tournaments]);

  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [confirmReport, setConfirmReport] = useState(false);

  if (!id) return null;

  if (!bootstrapReady && bootstrapFailed) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white flex items-center justify-center">
        <BootstrapFailedPanel onRetry={retryBootstrap} />
      </div>
    );
  }

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
          <p className="text-white/70 mb-6">
            Ce joueur n&apos;a pas encore assez d&apos;activité sur ZOYD pour afficher un profil public complet.
          </p>
          <Button variant="primary" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
            Retour
          </Button>
        </div>
      </div>
    );
  }

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
      toast.success(`Demande envoyée a ${publicProfile.pseudo}.`);
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
      await blockUser(id);
      toast.success(`${publicProfile.pseudo} est maintenant bloqué.`);
    } catch {
      toast.error('Erreur lors du blocage.');
    }
  };

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
    <>
    <SEOHead
      title="Profil — ZOYD"
      description="Profil public d'un joueur ZOYD."
      // La route reelle est `/profil/:id` (routes.tsx:180). La canonique
      // pointait sur `/profil`, qui est l INDEX — donc une URL qui ne designait
      // pas CE profil. Sans effet SEO immediat (la page est en noindex), mais
      // une canonique fausse survivrait au jour ou l on retirerait ce noindex.
      path={id ? `/profil/${id}` : '/profil'}
      noindex
    />
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
      prefersReducedMotion={prefersReducedMotion ?? false}
      emptyMatchesImage="/assets/images/codm-2.jpg"
      emptyTournamentsImage="/assets/images/codm-3.jpg"
      trustDescription="Cette fiche rassemble ce que ZOYD a déjà pu voir de ce joueur dans ses matchs, ses tournois et ses relations."
      codmTitle="Infos visibles"
      backLink={
        <Link to="/profil" className="inline-flex items-center gap-2 text-white/70 hover:text-white transition-colors text-sm uppercase font-mono tracking-widest">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Retour profil
        </Link>
      }
      headerActions={
        !ownProfile ? (
          <div className="flex flex-col gap-2 min-w-[220px]">
            <Button variant="primary" size="sm" onClick={handleAddFriend} disabled={alreadyFriend || blocked} className="touch-target" aria-label={alreadyFriend ? 'Déjà ami' : blocked ? 'Joueur bloqué' : `Ajouter ${publicProfile.pseudo} en ami`}>
              <UserPlus className="w-4 h-4 mr-2" aria-hidden="true" />
              {alreadyFriend ? 'Déjà ami' : blocked ? 'Bloqué' : 'Ajouter en ami'}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleInviteMatch} className="touch-target" aria-label={`Inviter ${publicProfile.pseudo} en match`}>
              <Swords className="w-4 h-4 mr-2" aria-hidden="true" />
              Inviter en match
            </Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmAction('block')} className="touch-target" aria-label={`Bloquer ${publicProfile.pseudo}`}>
              <UserX className="w-4 h-4 mr-2" aria-hidden="true" />
              Bloquer
            </Button>
            {confirmAction === 'block' && (
              <div className="border border-red-500/30 bg-red-500/10 p-3 space-y-2">
                <p className="text-xs text-red-300">Confirmer le blocage de {publicProfile.pseudo} ?</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmAction(null)} className="flex-1 border border-white/10 px-3 py-2 text-[10px] font-mono font-bold tracking-wider uppercase text-white/60 hover:text-white transition-colors">
                    Annuler
                  </button>
                  <button onClick={() => { setConfirmAction(null); void handleBlock(); }} className="flex-1 border border-red-500/30 px-3 py-2 text-[10px] font-mono font-bold tracking-wider uppercase text-red-400 hover:bg-red-400/10 transition-colors">
                    Confirmer
                  </button>
                </div>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={handleReport} className={`touch-target ${confirmReport ? 'border-red-400 text-red-300' : 'text-red-300 hover:text-red-200'}`} aria-label={confirmReport ? 'Confirmer le signalement' : `Signaler ${publicProfile.pseudo}`}>
              <AlertTriangle className="w-4 h-4 mr-2" aria-hidden="true" />
              {confirmReport ? 'Confirmer le signalement' : 'Signaler'}
            </Button>
            {confirmReport && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmReport(false)} className="touch-target text-white/70 hover:text-white">
                Annuler
              </Button>
            )}
          </div>
        ) : undefined
      }
    />
    </>
  );
};

export default PublicProfilPage;
