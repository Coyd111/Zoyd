import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft, Map as MapIcon, Users, Clock, CheckCircle2, AlertTriangle,
  Swords, Trophy, Shield, LogOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../app/stores/authStore';
import { useWalletStore } from '../../../app/stores/walletStore';
import {
  fetchBrConfig,
  fetchBrLobby,
  joinBrLobby,
  leaveBrLobby,
  checkInBrLobby,
  splitBrPayout,
  type BrConfig,
  type BrLobby,
} from '../../../app/lib/brApi';
import { formatZC, formatFCFA } from '../../../lib/utils';
import { SEOHead } from '../../../app/components/SEOHead';

const countDown = (target: string | null): string => {
  if (!target) return '—';
  const ms = Date.parse(target) - Date.now();
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return 'Imminent';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 1) return `Dans ${hours} h`;
  if (minutes >= 1) return `Dans ${minutes} min`;
  return 'Imminent';
};

const BrLobbyDetailPage: React.FC = () => {
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const user = useAuthStore((s) => s.user);
  const cashBalance = useWalletStore((s) => s.cashBalance);

  const [lobby, setLobby] = useState<BrLobby | null>(null);
  const [config, setConfig] = useState<BrConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    if (!lobbyId) return;
    setLoading(true);
    try {
      const [detail, cfg] = await Promise.all([fetchBrLobby(lobbyId), fetchBrConfig()]);
      setLobby(detail);
      setConfig(cfg);
      setNotFound(false);
    } catch (error) {
      if (error instanceof Error && error.message.includes('introuvable')) {
        setNotFound(true);
      } else {
        toast.error(error instanceof Error ? error.message : 'Chargement impossible.');
      }
    } finally {
      setLoading(false);
    }
  }, [lobbyId]);

  useEffect(() => { void load(); }, [load]);

  // Le pseudo est le seul identifiant visible du roster (aucun userId n'est
  // envoye au client).
  const me = useMemo(
    () => lobby?.players.find((p) => p.pseudo === user?.pseudo) || null,
    [lobby, user?.pseudo],
  );

  const handleJoin = async () => {
    if (!lobby) return;
    if (cashBalance < lobby.entryFee) {
      toast.error(`Solde insuffisant : il te faut ${formatZC(lobby.entryFee)}.`);
      return;
    }
    setActing(true);
    try {
      setLobby(await joinBrLobby(lobby.id));
      toast.success(`Inscrit sur ${lobby.name}. Ton pass de ${formatZC(lobby.entryFee)} est bloque.`);
      await useWalletStore.getState().refreshFromServer(user?.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Inscription impossible.');
    } finally {
      setActing(false);
    }
  };

  const handleCheckIn = async () => {
    if (!lobby) return;
    setActing(true);
    try {
      setLobby(await checkInBrLobby(lobby.id));
      toast.success('Presence confirmee. Bonne chance !');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Confirmation impossible.');
    } finally {
      setActing(false);
    }
  };

  const handleLeave = async () => {
    if (!lobby) return;
    setActing(true);
    try {
      await leaveBrLobby(lobby.id);
      toast.success('Desinscription effectuee, ton pass a ete rembourse.');
      await useWalletStore.getState().refreshFromServer(user?.id);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Desinscription impossible.');
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white font-ui p-8 flex items-center justify-center">
        <span className="text-white/60 text-sm">Chargement du salon...</span>
      </div>
    );
  }

  if (notFound || !lobby) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white font-ui p-8">
        <div className="max-w-2xl mx-auto text-center py-20">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-4" aria-hidden="true" />
          <h1 className="font-display font-black text-xl uppercase italic mb-2">Salon introuvable</h1>
          <p className="text-white/60 text-sm mb-6">Ce salon n'existe pas ou a ete supprime.</p>
          <Link to="/br" className="inline-block text-[10px] font-mono font-black uppercase tracking-widest border border-white/20 px-4 py-2.5 hover:border-white/40 transition-colors">
            Retour aux salons
          </Link>
        </div>
      </div>
    );
  }

  const map = config?.maps[lobby.map];
  const mode = config?.modes[lobby.mode];
  const rankingMode = config?.rankingModes[lobby.rankingMode];
  const split = splitBrPayout(lobby);
  const presentCount = lobby.players.filter((p) => p.checkedIn).length;
  const slotsLeft = lobby.maxPlayers - lobby.players.length;
  const isOpen = lobby.status === 'scheduled' && slotsLeft > 0;
  const canStartWindow = lobby.status === 'scheduled'
    && lobby.scheduledAt !== null
    && Date.parse(lobby.scheduledAt) - Date.now() <= 10 * 60 * 1000;

  return (
    <div className="min-h-dvh bg-zoyd-black text-white font-ui p-4 md:p-8 safe-top safe-bottom">
      <SEOHead title={`${lobby.name} — BR ZOYD`} description="Detail du salon Battle Royale." path={`/br/${lobby.id}`} noindex />

      <div className="max-w-5xl mx-auto">
        <Link to="/br" className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-white/60 hover:text-white transition-colors mb-6">
          <ArrowLeft className="w-3 h-3" aria-hidden="true" />
          Tous les salons
        </Link>

        <header className="mb-6">
          <h1 className="font-display font-black text-2xl md:text-4xl uppercase italic tracking-tighter text-white mb-3">
            {lobby.name}
          </h1>
          <div className="flex flex-wrap gap-2 text-[10px] font-mono">
            <span className="border border-white/10 bg-white/5 px-2.5 py-1.5 text-white/70 flex items-center gap-1.5">
              <MapIcon className="w-3 h-3 text-zoyd-yellow" aria-hidden="true" />
              {map?.label || lobby.map}{map ? ` · ${map.maxPlayers} j. max` : ''}
            </span>
            <span className="border border-white/10 bg-white/5 px-2.5 py-1.5 text-white/70 flex items-center gap-1.5">
              <Swords className="w-3 h-3 text-zoyd-yellow" aria-hidden="true" />
              {mode?.label || lobby.mode} · {mode?.teamSize ?? 1} joueur(s)/equipe
            </span>
            <span className="border border-white/10 bg-white/5 px-2.5 py-1.5 text-white/70 flex items-center gap-1.5">
              <Users className="w-3 h-3 text-zoyd-yellow" aria-hidden="true" />
              {lobby.players.length} / {lobby.maxPlayers}
            </span>
            <span className="border border-zoyd-yellow/20 bg-zoyd-yellow/5 px-2.5 py-1.5 text-zoyd-yellow flex items-center gap-1.5">
              <Clock className="w-3 h-3" aria-hidden="true" />
              {countDown(lobby.scheduledAt)}
            </span>
          </div>
        </header>

        {lobby.notes && (
          <p className="text-xs text-white/70 border-l-2 border-white/20 pl-3 mb-6 leading-relaxed">
            {lobby.notes}
          </p>
        )}

        {/* Repartition : la source de verite est le serveur, on ne recalcule
            que l'affichage a partir de ses pourcentages. */}
        <section className="border border-white/10 bg-zoyd-surface/20 p-5 mb-6">
          <h2 className="text-[10px] font-display font-black text-white/70 uppercase tracking-[0.3em] mb-4">
            Repartition de la cagnotte
          </h2>
          <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-white/10">
            <span className="text-xs text-white/60">Cagnotte actuelle</span>
            <span className="font-display font-black text-xl text-green-400">
              {formatZC(split.pot)}
              <span className="text-[10px] font-mono text-white/40 ml-2">~ {formatFCFA(split.pot)}</span>
            </span>
          </div>
          <div className="space-y-2">
            {split.places.map((place) => (
              <div key={place.place} className="flex items-center justify-between text-xs">
                <span className="text-white/70">
                  {place.place}<sup>e</sup> place
                  <span className="text-[10px] font-mono text-white/40 ml-2">
                    {Math.round(place.rate * 100)} %
                  </span>
                </span>
                <span className="font-mono text-white">{formatZC(place.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-xs pt-2 border-t border-white/10">
              <span className="text-white/70 flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-zoyd-yellow" aria-hidden="true" />
                Arbitre
                <span className="text-[10px] font-mono text-white/40 ml-2">
                  {Math.round(split.arbiterRate * 100)} % (max {Math.round((config?.arbiterMaxRate || 0.05) * 100)} %)
                </span>
              </span>
              <span className="font-mono text-zoyd-yellow">{formatZC(split.arbiterAmount)}</span>
            </div>
          </div>
          <p className="text-[10px] font-mono text-white/50 mt-4 pt-3 border-t border-white/10">
            Classement retenu : {rankingMode?.label || lobby.rankingMode}. Le
            serveur refuse toute repartition qui ne somme pas a 100 %.
          </p>
        </section>

        {/* Message cle, juste avant d'agir : pas de remboursement apres lancement. */}
        <section className="border-2 border-zoyd-yellow/30 bg-zoyd-yellow/5 p-4 mb-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-zoyd-yellow shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-xs text-white/80 leading-relaxed">
            <strong className="text-white">Ton pass de {formatZC(lobby.entryFee)}</strong> est
            preleve a l'inscription et bloque jusqu'a la fin. Si tu es inscrit
            mais absent au lancement, il n'est{' '}
            <strong className="text-white whitespace-nowrap">pas rembourse</strong> : il reste dans la
            cagnotte pour les joueurs presents.
            {me && (
              <span className="block mt-2 text-zoyd-yellow">
                {me.checkedIn
                  ? 'Tu as confirme ta presence : ton pass est en securite.'
                  : "Tu n'as pas encore confirme ta presence. Sans check-in, tu seras compte comme absent."}
              </span>
            )}
          </div>
        </section>

        <section className="border border-white/10 bg-zoyd-surface/20 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[10px] font-display font-black text-white/70 uppercase tracking-[0.3em]">
              Joueurs ({lobby.players.length} / {lobby.maxPlayers})
            </h2>
            <span className="text-[10px] font-mono text-white/50">
              {presentCount} present(s) · {slotsLeft} place(s) libre(s)
            </span>
          </div>

          {lobby.players.length === 0 ? (
            <p className="text-white/50 text-xs py-4">Aucun joueur inscrit pour l'instant.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {lobby.players.map((player, index) => (
                <li
                  key={`${player.teamId}-${index}`}
                  className={`flex items-center justify-between gap-2 border px-3 py-2 text-xs ${
                    player.pseudo === user?.pseudo
                      ? 'border-zoyd-yellow/40 bg-zoyd-yellow/5'
                      : 'border-white/10 bg-black/20'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {player.checkedIn
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" aria-hidden="true" />
                      : <Clock className="w-3.5 h-3.5 text-white/30 shrink-0" aria-hidden="true" />}
                    <span className="truncate">{player.pseudo}</span>
                    {player.pseudo === user?.pseudo && (
                      <span className="text-[9px] font-mono text-zoyd-yellow shrink-0">TOI</span>
                    )}
                  </span>
                  <span className="text-[10px] font-mono text-white/50 shrink-0">
                    {player.checkedIn ? 'present' : 'absent'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Actions : desinscription avec confirmation explicite, car le
            remboursement n'est possible QUE avant le lancement. */}
        <div className="flex flex-col sm:flex-row gap-3">
          {me ? (
            <>
              {!me.checkedIn && lobby.status === 'scheduled' && (
                <button
                  type="button"
                  onClick={handleCheckIn}
                  disabled={acting}
                  className="flex-1 bg-zoyd-yellow text-black px-5 py-3.5 font-display font-black text-xs uppercase italic tracking-[0.2em] hover:bg-white transition-colors disabled:opacity-50 touch-target"
                >
                  {acting ? 'En cours...' : "Confirmer ma presence"}
                </button>
              )}
              {me.checkedIn && (
                <div className="flex-1 flex items-center justify-center gap-2 border border-green-400/30 bg-green-400/10 text-green-400 px-5 py-3.5 font-display font-black text-xs uppercase italic tracking-[0.2em]">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  Presence confirmee
                </div>
              )}
              {lobby.status === 'scheduled' && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Te desinscrire et recuperer ton pass ? Possible uniquement avant le lancement.')) {
                      void handleLeave();
                    }
                  }}
                  disabled={acting}
                  className="flex items-center justify-center gap-2 border border-white/15 px-5 py-3.5 font-display font-black text-xs uppercase italic tracking-[0.2em] text-white/70 hover:border-red-400/40 hover:text-red-400 transition-colors disabled:opacity-50 touch-target"
                >
                  <LogOut className="w-4 h-4" aria-hidden="true" />
                  Me desinscrire
                </button>
              )}
              {lobby.status !== 'scheduled' && (
                <p className="flex-1 text-center text-[10px] font-mono text-white/50 border border-white/10 px-5 py-3.5">
                  {lobby.status === 'live'
                    ? 'Partie en cours : plus aucun remboursement possible.'
                    : 'Session terminee.'}
                </p>
              )}
            </>
          ) : isOpen ? (
            <button
              type="button"
              onClick={() => void handleJoin()}
              disabled={acting || cashBalance < lobby.entryFee}
              className="flex-1 text-center bg-zoyd-yellow text-black px-5 py-3.5 font-display font-black text-xs uppercase italic tracking-[0.2em] hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-target"
            >
              {cashBalance < lobby.entryFee
                ? `Solde insuffisant (${formatZC(lobby.entryFee)} requis)`
                : acting ? 'Inscription...' : "S'inscrire sur ce salon"}
            </button>
          ) : (
            <p className="flex-1 text-center text-[10px] font-mono text-white/50 border border-white/10 px-5 py-3.5">
              {lobby.status !== 'scheduled' ? 'Session terminee.' : 'Salon complet.'}
            </p>
          )}
        </div>

        {canStartWindow && (
          <p className="text-[10px] font-mono text-zoyd-yellow mt-4 text-center">
            L'organisateur peut lancer la partie dans moins de 10 minutes.
          </p>
        )}

        {lobby.status === 'live' && (
          <section className="mt-6 border border-white/10 bg-zoyd-surface/20 p-5">
            <h2 className="text-[10px] font-display font-black text-white/70 uppercase tracking-[0.3em] mb-3 flex items-center gap-2">
              <Trophy className="w-4 h-4" aria-hidden="true" />
              Partie lancee
            </h2>
            {/* Pas de suivi en direct : personne ne joue dans la plateforme, et
                seul l'arbitre a vu la partie. Le classement et la repartition
                apparaissent apres sa saisie, a la cloture. */}
            <p className="text-xs text-white/70 leading-relaxed">
              Le salon est lance. Rien ne s'affiche en direct : les eliminations
              sont saisies par l'arbitre a la fin de la partie, puis le serveur
              calcule le classement et repartit la cagnotte.
            </p>
          </section>
        )}
      </div>
    </div>
  );
};

export default BrLobbyDetailPage;