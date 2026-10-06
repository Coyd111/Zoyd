import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Gavel, PlayCircle, Shield, Skull, Trophy, Users,
} from 'lucide-react';

import { ApiError } from '../../../app/lib/apiClient';
import { verifyAdmin2fa } from '../../../app/lib/authApi';
import {
  eliminateBrPlayer,
  fetchBrArbiterView,
  finishBrLobby,
  startBrLobby,
  type BrArbiterView,
  type BrLobbyStatus,
} from '../../../app/lib/brApi';
import { formatZC } from '../../../lib/utils';
import { toast } from '../../../app/lib/toast';

/**
 * Panneau ARBITRE : la seule interface qui pilote le cycle de vie d'un salon.
 *
 * Dans ce modele, personne ne joue dans la plateforme : l'arbitre regarde la
 * partie, puis saisit les eliminations. Il n'y a donc aucun suivi en direct
 * cote joueurs — cet ecran est la source de verite du classement.
 *
 * Pourquoi une vue serveur dediee : `eliminate` exige des `userId`, et le
 * roster public les masque volontairement (un roster partage ne doit pas
 * permettre de relier un pseudo a un compte). `GET /api/br/lobbies/:id/arbiter`
 * est le seul endroit ou l'arbitre les recupere, et elle refuse tout autre
 * lecteur — c'est ce qui empeche un inscrit de s'attribuer des kills, donc
 * une part de cagnotte.
 */
interface BrArbiterPanelProps {
  lobbyId: string;
  status: BrLobbyStatus;
  onChanged: () => void | Promise<void>;
}

/**
 * Nombre de presents minimum pour lancer : le serveur refuse en dessous
 * (il doit y avoir de quoi payer les 5 places). Doit rester aligne sur
 * `BR_PRIZED_PLACES` cote serveur.
 */
const MIN_PRESENT_TO_START = 5;

const STATUS_LABEL: Record<BrLobbyStatus, string> = {
  scheduled: 'Avant la partie',
  live: 'Saisie des resultats',
  settling: 'Reglement en cours',
  finished: 'Session terminee',
  cancelled: 'Session annulee',
};

const BrArbiterPanel: React.FC<BrArbiterPanelProps> = ({ lobbyId, status, onChanged }) => {
  const [view, setView] = useState<BrArbiterView | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [eliminatedUserId, setEliminatedUserId] = useState('');
  const [killerUserId, setKillerUserId] = useState('');
  const [assists, setAssists] = useState('0');

  // La cloture tire de l'argent : le serveur exige la 2FA admin. On la
  // demande dans l'ecran plutot que d'echouer, sinon l'arbitre ne pourrait
  // jamais terminer une partie.
  const [twofaOpen, setTwofaOpen] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [twofaError, setTwofaError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setView(await fetchBrArbiterView(lobbyId));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Vue arbitre indisponible.');
    } finally {
      setLoading(false);
    }
  }, [lobbyId]);

  useEffect(() => { void load(); }, [load]);

  const players = view?.lobby.players ?? [];
  const summary = view?.summary;

  /** Vivants et presents : seuls eux peuvent etre elimines ou tuer. */
  const alivePlayers = useMemo(
    () => players.filter((p) => p.alive && !p.absent),
    [players],
  );
  const eliminated = useMemo(
    () => players.filter((p) => !p.alive && !p.absent),
    [players],
  );
  const absent = useMemo(() => players.filter((p) => p.absent), [players]);

  /** Le tueur ne peut pas etre le joueur elimine, ni un mort, ni un absent. */
  const killerCandidates = useMemo(
    () => alivePlayers.filter((p) => p.userId !== eliminatedUserId),
    [alivePlayers, eliminatedUserId],
  );

  // Une nouvelle partie : on repart d'un formulaire vide pour ne pas
  // resoumettre l'elimination precedente par erreur.
  useEffect(() => {
    setEliminatedUserId('');
    setKillerUserId('');
    setAssists('0');
  }, [status]);

  const refreshAll = async () => {
    await load();
    await onChanged();
  };

  const handleStart = async () => {
    const absentCount = absent.length;
    const warning = absentCount > 0
      ? `${absentCount} joueur(s) n'ont pas confirme leur presence : leur pass sera consommé et ils seront.classes derniers.`
      : 'Les presents seront figes dans le roster de depart.';
    if (!window.confirm(`Lancer la partie ?\n\n${warning}\n\nCette action est irreversible : plus aucun remboursement.`)) {
      return;
    }
    setActing(true);
    try {
      await startBrLobby(lobbyId);
      toast.success('Partie lancee. Saisis les eliminations au fil de la partie.');
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Lancement impossible.');
    } finally {
      setActing(false);
    }
  };

  const handleEliminate = async () => {
    if (!eliminatedUserId) {
      toast.error('Choisis d\'abord le joueur elimine.');
      return;
    }
    const target = players.find((p) => p.userId === eliminatedUserId);
    const killer = killerUserId ? players.find((p) => p.userId === killerUserId) : null;
    const detail = killer ? ` par ${killer.pseudo}` : ' (sans kill attribue)';
    if (!window.confirm(`Eliminer ${target?.pseudo}${detail} ?`)) return;

    setActing(true);
    try {
      await eliminateBrPlayer(lobbyId, {
        userId: eliminatedUserId,
        killerUserId: killerUserId || null,
        assists: Number(assists) || 0,
      });
      toast.success(`${target?.pseudo} elimine.`);
      setEliminatedUserId('');
      setKillerUserId('');
      setAssists('0');
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Elimination impossible.');
    } finally {
      setActing(false);
    }
  };

  const runFinish = async () => {
    await finishBrLobby(lobbyId);
    await refreshAll();
  };

  const handleFinish = async () => {
    const aliveNow = alivePlayers.length;
    const remaining = Math.max(0, aliveNow - 1);
    const confirmed = window.confirm(
      `Cloturer et verser la cagnotte ?\n\n`
      + `${aliveNow} joueur(s) encore en vie : ${remaining} elimination(s) restante(s) `
      + `seront classees d'office a la derniere place.\n\n`
      + `Les gains sont verses immediatement et definitivement. Cette action est irreversible.`,
    );
    if (!confirmed) return;

    setActing(true);
    setTwofaError(null);
    try {
      await runFinish();
      setTwofaOpen(false);
      setTotpCode('');
      toast.success('Session reglee : la cagnotte est versee.');
    } catch (error) {
      if (error instanceof ApiError && error.code === '2FA_REQUIRED') {
        setTwofaOpen(true);
      } else {
        toast.error(error instanceof Error ? error.message : 'Cloture impossible.');
      }
    } finally {
      setActing(false);
    }
  };

  const handleTwofaSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = totpCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setTwofaError('Le code TOTP fait 6 chiffres.');
      return;
    }
    setActing(true);
    setTwofaError(null);
    try {
      await verifyAdmin2fa(code);
      await runFinish();
      setTwofaOpen(false);
      setTotpCode('');
      toast.success('Session reglee : la cagnotte est versee.');
    } catch (error) {
      setTwofaError(error instanceof Error ? error.message : 'Verification impossible.');
    } finally {
      setActing(false);
    }
  };

  return (
    <section className="border-2 border-zoyd-yellow/40 bg-zoyd-yellow/5 p-5 mb-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-[10px] font-display font-black text-zoyd-yellow uppercase tracking-[0.3em] flex items-center gap-2">
          <Gavel className="w-4 h-4" aria-hidden="true" />
          Arbitre
        </h2>
        <span className="text-[10px] font-mono text-white/50">{STATUS_LABEL[status]}</span>
      </div>

      {loading && (
        <p className="text-xs text-white/60">Chargement de la vue arbitre...</p>
      )}

      {!loading && loadError && (
        <p className="text-xs text-red-400">{loadError}</p>
      )}

      {!loading && view && summary && (
        <>
          <dl className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-5">
            <Stat label="Inscrits" value={summary.total} />
            <Stat label="Presents" value={summary.present} />
            <Stat label="En vie" value={summary.alive} accent={status === 'live'} />
            <Stat label="Elimines" value={summary.eliminated} />
            <Stat label="Absents" value={summary.absent} accent={summary.absent > 0} />
          </dl>

          <p className="text-[10px] font-mono text-white/50 mb-5">
            Cagnotte reellement bloquee : {formatZC(summary.pot)}
          </p>

          {status === 'scheduled' && (
            <div>
              <StartRequirements
                presentCount={summary.present}
                scheduledAt={view.lobby.scheduledAt}
                minPresent={MIN_PRESENT_TO_START}
              />
              <button
                type="button"
                onClick={() => void handleStart()}
                disabled={acting || summary.present < MIN_PRESENT_TO_START}
                className="w-full flex items-center justify-center gap-2 bg-zoyd-yellow text-black px-5 py-3.5 font-display font-black text-xs uppercase italic tracking-[0.2em] hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed touch-target"
              >
                <PlayCircle className="w-4 h-4" aria-hidden="true" />
                {acting ? 'En cours...' : 'Lancer la partie'}
              </button>
              {summary.present < MIN_PRESENT_TO_START && (
                <p className="text-[10px] font-mono text-red-400 mt-2 text-center">
                  Il faut au moins {MIN_PRESENT_TO_START} joueurs presents pour lancer la partie.
                </p>
              )}
            </div>
          )}

          {status === 'live' && (
            <div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div>
                  <label
                    htmlFor="br-elim"
                    className="block text-[9px] font-mono text-white/50 uppercase mb-1"
                  >
                    Joueur elimine
                  </label>
                  <select
                    id="br-elim"
                    value={eliminatedUserId}
                    onChange={(e) => setEliminatedUserId(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 px-3 py-2.5 text-xs text-white focus:border-zoyd-yellow/50 touch-target"
                  >
                    <option value="">— Choisir —</option>
                    {alivePlayers.map((p) => (
                      <option key={p.userId} value={p.userId}>
                        {p.pseudo} ({p.kills} kill{p.kills > 1 ? 's' : ''})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="br-killer"
                    className="block text-[9px] font-mono text-white/50 uppercase mb-1"
                  >
                    Tue par (laisser vide si mort/mort)
                  </label>
                  <select
                    id="br-killer"
                    value={killerUserId}
                    onChange={(e) => setKillerUserId(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 px-3 py-2.5 text-xs text-white focus:border-zoyd-yellow/50 touch-target"
                  >
                    <option value="">— Aucun kill attribue —</option>
                    {killerCandidates.map((p) => (
                      <option key={p.userId} value={p.userId}>
                        {p.pseudo} ({p.kills} kill{p.kills > 1 ? 's' : ''})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="br-assists"
                    className="block text-[9px] font-mono text-white/50 uppercase mb-1"
                  >
                    Assists du tueur (0 a 10)
                  </label>
                  <input
                    id="br-assists"
                    type="number"
                    min={0}
                    max={10}
                    value={assists}
                    onChange={(e) => setAssists(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 px-3 py-2.5 text-xs text-white focus:border-zoyd-yellow/50 touch-target"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleEliminate()}
                disabled={acting || alivePlayers.length <= 1 || !eliminatedUserId}
                className="w-full flex items-center justify-center gap-2 border border-zoyd-yellow/40 text-zoyd-yellow px-5 py-3.5 font-display font-black text-xs uppercase italic tracking-[0.2em] hover:bg-zoyd-yellow hover:text-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed touch-target"
              >
                <Skull className="w-4 h-4" aria-hidden="true" />
                Enregistrer l&apos;elimination
              </button>

              {alivePlayers.length <= 1 && (
                <p className="text-[10px] font-mono text-zoyd-yellow mt-2 text-center">
                  Il ne reste qu&apos;un joueur : la partie est terminee, tu peux cloturer.
                </p>
              )}

              {eliminated.length > 0 && (
                <div className="mt-5 pt-4 border-t border-white/10">
                  <p className="text-[9px] font-mono text-white/50 uppercase tracking-widest mb-2">
                    Eliminés (ordre de sortie)
                  </p>
                  <ul className="space-y-1">
                    {eliminated
                      .slice()
                      .sort((a, b) => (b.placement || 0) - (a.placement || 0))
                      .map((p) => {
                        const killer = players.find((x) => x.userId === p.killedBy);
                        return (
                          <li
                            key={p.userId}
                            className="flex items-center justify-between gap-2 border border-white/10 bg-black/20 px-3 py-1.5 text-[11px]"
                          >
                            <span className="truncate">
                              {p.placement ?? '?'}<sup>e</sup> · {p.pseudo}
                            </span>
                            <span className="text-[10px] font-mono text-white/50 shrink-0">
                              {killer ? `par ${killer.pseudo}` : 'sans kill'}
                            </span>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              )}

              <div className="mt-5 pt-4 border-t border-white/10">
                {!twofaOpen ? (
                  <button
                    type="button"
                    onClick={() => void handleFinish()}
                    disabled={acting}
                    className="w-full flex items-center justify-center gap-2 bg-green-400 text-black px-5 py-3.5 font-display font-black text-xs uppercase italic tracking-[0.2em] hover:bg-white transition-colors disabled:opacity-40 touch-target"
                  >
                    <Trophy className="w-4 h-4" aria-hidden="true" />
                    {acting ? 'En cours...' : 'Cloturer et verser la cagnotte'}
                  </button>
                ) : (
                  <form onSubmit={handleTwofaSubmit}>
                    <p className="text-xs text-white/80 leading-relaxed mb-3 flex items-start gap-2">
                      <Shield className="w-4 h-4 text-zoyd-yellow shrink-0 mt-0.5" aria-hidden="true" />
                      Cette action deverse de l&apos;argent : confirme par ton code TOTP
                      admin.
                    </p>
                    <label htmlFor="br-totp" className="sr-only">Code TOTP a 6 chiffres</label>
                    <input
                      id="br-totp"
                      aria-label="Code TOTP à 6 chiffres"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="000000"
                      className="w-full bg-black/40 border border-white/10 px-3 py-3 text-center font-mono text-lg tracking-[0.5em] text-white focus:border-zoyd-yellow/50 touch-target"
                    />
                    {twofaError && (
                      <p className="text-[10px] font-mono text-red-400 mt-2">{twofaError}</p>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => { setTwofaOpen(false); setTwofaError(null); }}
                        className="flex-1 border border-white/15 px-4 py-3 font-display font-black text-[10px] uppercase italic tracking-[0.2em] text-white/70 hover:border-white/40 transition-colors touch-target"
                      >
                        Annuler
                      </button>
                      <button
                        type="submit"
                        disabled={acting}
                        className="flex-1 bg-green-400 text-black px-4 py-3 font-display font-black text-[10px] uppercase italic tracking-[0.2em] hover:bg-white transition-colors disabled:opacity-40 touch-target"
                      >
                        {acting ? 'Verification...' : 'Verifier et verser'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}

          {status === 'finished' && (
            <FinalStandings view={view} />
          )}

          {status === 'settling' && (
            <p className="text-xs text-white/70 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-zoyd-yellow" aria-hidden="true" />
              Reglement en cours. Ne relance pas la cloture : les gains seraient
              verses deux fois.
            </p>
          )}
        </>
      )}
    </section>
  );
};

/** Compteur du resume. */
const Stat: React.FC<{ label: string; value: number; accent?: boolean }> = ({
  label, value, accent,
}) => (
  <div className="border border-white/10 bg-black/20 px-3 py-2">
    <dt className="text-[9px] font-mono text-white/50 uppercase tracking-widest">{label}</dt>
    <dd className={`font-display font-black text-lg ${accent ? 'text-zoyd-yellow' : 'text-white'}`}>
      {value}
    </dd>
  </div>
);

/**
 * Conditions de lancement, affichees AVANT le bouton : l'arbitre doit savoir
 * pourquoi il est bloque plutot que decouvrir un refus du serveur.
 */
const StartRequirements: React.FC<{
  presentCount: number;
  scheduledAt: string | null;
  minPresent: number;
}> = ({ presentCount, scheduledAt, minPresent }) => {
  const msUntil = scheduledAt ? Date.parse(scheduledAt) - Date.now() : 0;
  const tooEarly = msUntil > 10 * 60 * 1000;
  const hours = Number.isFinite(msUntil) ? Math.max(0, Math.floor(msUntil / 3_600_000)) : 0;

  return (
    <ul className="space-y-1.5 mb-4">
      <Requirement
        ok={presentCount >= minPresent}
        label={`${presentCount} present(s) — il en faut ${minPresent}`}
      />
      <Requirement
        ok={!tooEarly}
        label={tooEarly
          ? `Trop tot : lancement possible dans ${hours} h (10 min avant l'heure prevue)`
          : 'Fenetre de lancement ouverte'}
      />
    </ul>
  );
};

const Requirement: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <li className={`flex items-start gap-2 text-[11px] ${ok ? 'text-green-400' : 'text-white/60'}`}>
    {ok
      ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
      : <AlertTriangle className="w-3.5 h-3.5 text-zoyd-yellow shrink-0 mt-px" aria-hidden="true" />}
    <span>{label}</span>
  </li>
);

/** Classement final et versements, une fois la session reglee. */
const FinalStandings: React.FC<{ view: BrArbiterView }> = ({ view }) => (
  <div>
    <p className="text-[9px] font-mono text-white/50 uppercase tracking-widest mb-2">
      Classement final et versements
    </p>
    <ul className="space-y-1">
      {view.ranking.map((row) => (
        <li
          key={row.userId}
          className="flex items-center justify-between gap-2 border border-white/10 bg-black/20 px-3 py-1.5 text-[11px]"
        >
          <span className="truncate">
            {row.pseudo}
            <span className="text-[10px] font-mono text-white/40 ml-2">
              {row.kills} kill{row.kills > 1 ? 's' : ''}
            </span>
          </span>
          <span className="font-mono text-white/70 shrink-0">
            {row.winnings > 0 ? formatZC(row.winnings) : '—'}
          </span>
        </li>
      ))}
    </ul>
    {view.projectedPayouts.arbiter && (
      <p className="flex items-center gap-2 text-[11px] text-zoyd-yellow mt-2 pt-2 border-t border-white/10">
        <Users className="w-3.5 h-3.5" aria-hidden="true" />
        Ta commission d&apos;arbitrage : {formatZC(view.projectedPayouts.arbiter.amount)}
      </p>
    )}
  </div>
);

export default BrArbiterPanel;
