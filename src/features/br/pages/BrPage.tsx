import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Calendar, Map as MapIcon, Users, Swords, ChevronRight, AlertTriangle, Clock, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../app/stores/authStore';
import { useWalletStore } from '../../../app/stores/walletStore';
import {
  fetchBrConfig,
  fetchBrLobbies,
  joinBrLobby,
  type BrConfig,
  type BrLobby,
} from '../../../app/lib/brApi';
import { formatZC } from '../../../lib/utils';
import { SEOHead } from '../../../app/components/SEOHead';

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  scheduled: { label: 'INSCRIPTIONS', className: 'text-green-400 border-green-400/30 bg-green-400/10' },
  live: { label: 'EN COURS', className: 'text-zoyd-yellow border-zoyd-yellow/30 bg-zoyd-yellow/10' },
  settling: { label: 'REGLEMENT', className: 'text-orange-400 border-orange-400/30 bg-orange-400/10' },
  finished: { label: 'TERMINE', className: 'text-white/60 border-white/10 bg-white/5' },
  cancelled: { label: 'ANNULE', className: 'text-red-400 border-red-400/30 bg-red-400/10' },
};

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

const BrLobbyCard: React.FC<{
  lobby: BrLobby;
  config: BrConfig;
  joined: boolean;
  isLoading: boolean;
  onJoin: (lobby: BrLobby) => void;
}> = React.memo(({ lobby, config, joined, isLoading, onJoin }) => {
  const map = config.maps[lobby.map];
  const mode = config.modes[lobby.mode];
  const ranking = config.rankingModes[lobby.rankingMode];
  const badge = STATUS_BADGES[lobby.status] || STATUS_BADGES.scheduled;
  const slotsLeft = lobby.maxPlayers - lobby.players.length;
  const full = slotsLeft <= 0;
  const open = lobby.status === 'scheduled' && !full;
  const checkedIn = lobby.players.some((p) => p.checkedIn);

  return (
    <div className="border border-white/10 bg-zoyd-surface/30 hover:border-white/20 transition-colors p-5 flex flex-col">
      {/* Toute la carte (hors zone de boutons) mene au detail : un joueur qui
          clique le nom du salon s'attend a le voir. */}
      <Link to={`/br/${lobby.id}`} className="block">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="font-display font-black text-white tracking-tight uppercase text-sm truncate">
              {lobby.name}
            </h3>
            <div className="text-[10px] font-mono text-white/50 mt-1">
              {lobby.creatorPseudo ? `Organise par ${lobby.creatorPseudo}` : 'Organise par ZOYD'}
            </div>
          </div>
          <span className={`shrink-0 text-[9px] font-mono font-black uppercase tracking-widest border px-1.5 py-0.5 ${badge.className}`}>
            {badge.label}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-white/70 mb-3">
          <div className="flex items-center gap-1.5">
            <MapIcon className="w-3 h-3 text-zoyd-yellow" aria-hidden="true" />
            <span className="truncate">{map?.label || lobby.map}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Swords className="w-3 h-3 text-zoyd-yellow" aria-hidden="true" />
            <span>{mode?.label || lobby.mode}{map ? ` · ${map.vehicles ? 'vehicules' : 'sans vehicule'}` : ''}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="w-3 h-3 text-zoyd-yellow" aria-hidden="true" />
            <span>{lobby.players.length} / {lobby.maxPlayers}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-zoyd-yellow" aria-hidden="true" />
            <span className="truncate">{countDown(lobby.scheduledAt)}</span>
          </div>
        </div>
      </Link>

      <div className="flex items-center justify-between text-[10px] font-mono mb-3">
        <span className="text-white/60">Cagnotte actuelle</span>
        <span className="text-zoyd-yellow font-bold">{formatZC(lobby.pot)}</span>
      </div>

      <div className="text-[10px] font-mono text-white/50 mb-4">
        Classement : {ranking?.label || lobby.rankingMode} · Pass {formatZC(lobby.entryFee)}
      </div>

      {/* Note permanente : c'est la regle quisurvit / punit les absents. */}
      <p className="text-[10px] text-white/60 border-l-2 border-zoyd-yellow/40 pl-2 mb-4 leading-relaxed">
        Ton pass est preleve a l'inscription. <strong className="text-white">Pas de remboursement</strong>{' '}
        si tu ne te presentes pas le jour du lancement : ta part finance la
        cagnotte des joueurs presents.
      </p>

      <div className="flex items-center gap-2 mt-auto">
        <Link
          to={`/br/${lobby.id}`}
          className="flex-1 text-center text-[10px] font-mono font-black uppercase tracking-widest border border-white/15 px-3 py-2.5 text-white/80 hover:border-white/30 hover:text-white transition-colors touch-target"
        >
          Details
          <ChevronRight className="w-3 h-3 inline ml-1" aria-hidden="true" />
        </Link>
        {joined ? (
          <span className={`flex-1 text-center text-[10px] font-mono font-black uppercase tracking-widest px-3 py-2.5 border ${
            checkedIn
              ? 'border-green-400/30 bg-green-400/10 text-green-400'
              : 'border-zoyd-yellow/30 bg-zoyd-yellow/10 text-zoyd-yellow'
          }`}>
            {checkedIn ? 'Present' : 'Inscrit'}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onJoin(lobby)}
            disabled={!open || isLoading}
            className="flex-1 text-[10px] font-mono font-black uppercase tracking-widest bg-zoyd-yellow text-black px-3 py-2.5 hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed touch-target"
            aria-label={open ? `S'inscrire a ${lobby.name}` : 'Inscriptions fermees'}
          >
            {isLoading ? '...' : full ? 'Complet' : open ? "S'inscrire" : 'Ferme'}
          </button>
        )}
      </div>
    </div>
  );
});

const BrPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const cashBalance = useWalletStore((s) => s.cashBalance);
  const [config, setConfig] = useState<BrConfig | null>(null);
  const [lobbies, setLobbies] = useState<BrLobby[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const load = useMemo(() => async () => {
    setLoading(true);
    try {
      const [cfg, list] = await Promise.all([fetchBrConfig(), fetchBrLobbies()]);
      setConfig(cfg);
      setLobbies(list);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Chargement des salons BR impossible.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleJoin = async (lobby: BrLobby) => {
    if (cashBalance < lobby.entryFee) {
      toast.error(`Solde insuffisant : il te faut ${formatZC(lobby.entryFee)}.`);
      return;
    }
    setJoiningId(lobby.id);
    try {
      const updated = await joinBrLobby(lobby.id);
      setLobbies((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      toast.success(`Inscrit sur ${lobby.name}. Ton pass de ${formatZC(lobby.entryFee)} est bloque.`);
      // Le wallet a change : on recharge pour que le solde soit exact.
      await useWalletStore.getState().refreshFromServer(user?.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Inscription impossible.');
    } finally {
      setJoiningId(null);
    }
  };

  const openCount = lobbies.filter((l) => l.status === 'scheduled').length;
  const liveCount = lobbies.filter((l) => l.status === 'live').length;

  return (
    <div className="min-h-dvh bg-zoyd-black text-white font-ui p-4 md:p-8 safe-top safe-bottom">
      <SEOHead
        title="Battle Royale — ZOYD"
        description="Salons BR ouverts a tous : solo, duo ou squad, jusqu'a 100 joueurs, avec classement par survie et kills."
        path="/br"
      />

      <div className="max-w-[1500px] mx-auto">
        <header className="mb-8">
          <div className="flex items-center gap-2 text-[10px] font-mono text-zoyd-yellow uppercase tracking-[0.3em] mb-2">
            <Trophy className="w-3.5 h-3.5" aria-hidden="true" />
            ZOYD Battle Royale
          </div>
          <h1 className="font-display font-black text-3xl md:text-5xl uppercase italic tracking-tighter text-white mb-3">
            BR — <span className="text-zoyd-yellow">UN SALON,</span> 100 JOUEURS
          </h1>
          <p className="text-white/70 text-sm max-w-2xl leading-relaxed">
            Un seul match, une seule map, jusqu'au dernier survivant. Les joueurs
            n'attendent pas qu'une plateforme lance la partie : chaque salon est
            programme, et il demarre a l'heure avec les presents.
          </p>
        </header>

        {/* Regle commerciale affichee AVANT toute inscription : c'est le point
            qui evite les litiges « on m'a pris mon argent ». */}
        <section className="border-2 border-zoyd-yellow/30 bg-zoyd-yellow/5 p-4 mb-8 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-zoyd-yellow shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-xs text-white/80 leading-relaxed">
            <h2 className="font-display font-black text-sm uppercase tracking-tight italic text-zoyd-yellow mb-1">
              Le pass n'est jamais rembourse une fois la partie lancee
            </h2>
            <p>
              Tu payes ton pass a l'inscription, et il est bloque sur ton solde
              jusqu'a la fin. Si tu ne te presentes pas au lancement, ton pass
              reste dans la cagnotte : il finance la prime des joueurs qui, eux,
              sont venus. Seule une desinscription <em>avant</em> l'heure de depart
              rembourse integralement.
            </p>
          </div>
        </section>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
          <div className="border border-white/10 bg-zoyd-surface/30 px-4 py-3">
            <div className="text-[10px] font-mono text-white/60 uppercase tracking-wider mb-1">Salons ouverts</div>
            <div className="text-lg md:text-2xl font-black text-zoyd-yellow">{openCount}</div>
          </div>
          <div className="border border-white/10 bg-zoyd-surface/30 px-4 py-3">
            <div className="text-[10px] font-mono text-white/60 uppercase tracking-wider mb-1">En cours</div>
            <div className="text-lg md:text-2xl font-black text-white">{liveCount}</div>
          </div>
          <div className="border border-white/10 bg-zoyd-surface/30 px-4 py-3">
            <div className="text-[10px] font-mono text-white/60 uppercase tracking-wider mb-1">Joueurs inscrits</div>
            <div className="text-lg md:text-2xl font-black text-white">
              {lobbies.reduce((sum, l) => sum + l.players.length, 0)}
            </div>
          </div>
          <div className="border border-white/10 bg-zoyd-surface/30 px-4 py-3">
            <div className="text-[10px] font-mono text-white/60 uppercase tracking-wider mb-1">Cagnotte en jeu</div>
            <div className="text-lg md:text-2xl font-black text-green-400">
              {formatZC(lobbies.reduce((sum, l) => sum + (l.pot || 0), 0))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-white/60 text-sm">Chargement des salons...</div>
        ) : lobbies.length === 0 ? (
          <div className="text-center py-16 border border-white/10 bg-zoyd-surface/20">
            <Calendar className="w-10 h-10 text-white/20 mx-auto mb-4" aria-hidden="true" />
            <p className="text-white/70 text-sm">
              Aucun salon programme pour le moment.
            </p>
            <p className="text-white/50 text-xs mt-2">
              Les salons sont ouverts 24 a 48 h a l'avance.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {lobbies.map((lobby) => (
              <BrLobbyCard
                key={lobby.id}
                lobby={lobby}
                config={config || { maps: {}, modes: {}, rankingModes: {} } as unknown as BrConfig}
                // Le roster public ne contient AUCUN userId (vie privée) : on
                // compare donc sur le pseudo, seul identifiant visible ici.
                joined={Boolean(user?.pseudo) && lobby.players.some((p) => p.pseudo === user?.pseudo)}
                isLoading={joiningId === lobby.id}
                onJoin={handleJoin}
              />
            ))}
          </div>
        )}

        {/* Maps disponibles : la liste vient du serveur, elle ne peut pas
            diverger du moteur. Alcatraz n'y est pas (retire du jeu). */}
        {config && (
          <section className="mt-10 border border-white/10 bg-zoyd-surface/20 p-5">
            <h2 className="text-[10px] font-display font-black text-white/70 uppercase tracking-[0.3em] mb-3">
              Maps et modes
            </h2>
            <div className="flex flex-wrap gap-2">
              {config.mapIds.map((id) => {
                const map = config.maps[id];
                return (
                  <span
                    key={id}
                    className="text-[10px] font-mono border border-white/10 bg-black/30 px-2.5 py-1.5 text-white/70"
                  >
                    {map.label} · {map.maxPlayers} j.
                    {map.vehicles ? ' · vehicules' : ' · sans vehicule'}
                  </span>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {config.modeIds.map((id) => {
                const mode = config.modes[id];
                return (
                  <span
                    key={id}
                    className="text-[10px] font-mono border border-zoyd-yellow/20 bg-zoyd-yellow/5 px-2.5 py-1.5 text-zoyd-yellow"
                  >
                    {mode.label} · {mode.teamSize} joueur(s)/equipe · max {mode.maxPlayers}
                  </span>
                );
              })}
            </div>
            <p className="text-[10px] font-mono text-white/40 mt-4">
              Plafond effectif = minimum(mode, map). Rebirth Island limite donc
              les salons a {config.maps.rebirth_island?.maxPlayers ?? 40} joueurs.
            </p>
          </section>
        )}

        <p className="text-[10px] font-mono text-white/40 mt-6">
            Les gains sont libelles en ZC (1 ZC = 10 FCFA). Les commissions et
            le classement de chaque salon sont fixes par l'organisateur et valides
            par le serveur.
        </p>
      </div>
    </div>
  );
};

export default BrPage;
