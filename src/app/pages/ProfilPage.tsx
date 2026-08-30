import { useMemo } from 'react';
import { Link } from 'react-router';
import { useReducedMotion } from 'motion/react';
import { ChevronRight, LogOut } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useMatchStore } from '../stores/matchStore';
import { useTournamentStore } from '../stores/tournamentStore';
import { Button } from '../components/ui/Button';
import ProfileView from '../components/profile/ProfileView';
import { buildCompetitiveSummary } from '../../lib/profileMetrics';
import { SEOHead } from '../components/SEOHead';

const ProfilPage = () => {
  const user = useAuthStore((s) => s.user);
  const matches = useMatchStore((s) => s.matches);
  const tournaments = useTournamentStore((s) => s.tournaments);
  const prefersReducedMotion = useReducedMotion();

  if (!user) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white flex items-center justify-center safe-top">
        <div className="text-center">
          <h2 className="text-2xl font-display font-black uppercase mb-4">Profil non disponible</h2>
          <Link to="/auth/login">
            <Button variant="primary">Connexion</Button>
          </Link>
        </div>
      </div>
    );
  }

  const summary = useMemo(
    () =>
      buildCompetitiveSummary({
        userId: user.id,
        overallTrustScore: user.trustScore,
        matches,
        tournaments,
        fallbackStats: user.stats,
        dateJoined: user.dateJoined,
      }),
    [matches, tournaments, user]
  );

  return (
    <>
    <SEOHead title="Mon profil — ZOYD" description="Consulte et modifie ton profil ZOYD." path="/profil" noindex />
    <ProfileView
      userId={user.id}
      pseudo={user.pseudo}
      country={user.country}
      controllerType={user.controllerType}
      gameId={user.gameId}
      dateJoined={user.dateJoined}
      trustScore={user.trustScore}
      streamerMode={user.streamerMode}
      streamerPseudo={user.streamerPseudo}
      isOnline={user.isOnline}
      bio={user.bio}
      levelCODM={user.levelCODM}
      rankMJ={user.rankMJ}
      rankBR={user.rankBR}
      progression={user.progression}
      summary={summary}
      prefersReducedMotion={prefersReducedMotion}
      showProgression
      matchesLink={{ to: '/mj', label: 'Hub MJ' }}
      tournamentsLink={{ to: '/mj/tournois', label: 'Voir les tournois' }}
      trustDescription="Un bon Trust Score te permet d'acceder aux wagers High Rollers et de postuler comme Arbitre rémunéré sur ZOYD."
      headerActions={
        <div className="flex flex-col gap-3">
          <Link to="/parametres" className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/40 hover:text-white touch-target">
            Modifier le profil <ChevronRight className="w-3 h-3" aria-hidden="true" />
          </Link>
          <button
            onClick={() => useAuthStore.getState().logout()}
            className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-red-400/50 hover:text-red-400 touch-target"
          >
            <LogOut className="w-3 h-3" aria-hidden="true" />
            Se déconnecter
          </button>
        </div>
      }
    />
    </>
  );
};

export default ProfilPage;
