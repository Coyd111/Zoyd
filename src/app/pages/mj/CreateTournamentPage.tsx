import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { ArrowLeft, CheckCircle2, ShieldCheck, Swords, Trophy, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  CONTROLLER_OPTIONS,
  DEVICE_OPTIONS,
  MJ_FORMATS,
  MJ_MAP_POOL,
  MJ_MODE_OPTIONS,
} from '../../../lib/competition';
import { formatZC } from '../../../lib/utils';
import {
  useTournamentStore,
  type TournamentControllerRestriction,
  type TournamentDeviceRestriction,
} from '../../stores/tournamentStore';
import { useAuthStore } from '../../stores/authStore';
import type { MatchFormat } from '../../stores/matchStore';
import { createServerTournament } from '../../lib/tournamentApi';
import { applyServerAccountState } from '../../lib/serverSync';

const ENTRY_OPTIONS = [50, 100, 200, 500, 1000];
const MAX_ENTRY_OPTIONS = [4, 8, 16, 32];
const WEAPON_OPTIONS = [
  'Toutes armes selon reglement',
  'Snipers uniquement',
  'Assaut / SMG',
  'No scorestreak agressif',
];

type FormValues = {
  name: string;
  format: MatchFormat;
  mode: string;
  entryFee: number;
  maxEntries: number;
  scoreTarget: number;
  bestOf: number;
  weaponRestrictions: string;
  pointstreaks: 'allowed' | 'restricted';
  meleeAllowed: boolean;
  notes: string;
  startsAt: string;
  deviceRestriction: TournamentDeviceRestriction;
  controllerRestriction: TournamentControllerRestriction;
  reserveCreatorAsArbiter: boolean;
};

const getLocalDateTimeValue = (date: Date) => {
  const copy = new Date(date);
  const year = copy.getFullYear();
  const month = String(copy.getMonth() + 1).padStart(2, '0');
  const day = String(copy.getDate()).padStart(2, '0');
  const hours = String(copy.getHours()).padStart(2, '0');
  const minutes = String(copy.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const getDefaultStartAt = () => {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(19, 0, 0, 0);
  return getLocalDateTimeValue(next);
};

const CreateTournamentPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const hydrateTournaments = useTournamentStore((state) => state.hydrateFromServer);
  const [selectedMapPool, setSelectedMapPool] = useState<string[]>(['Raid', 'Standoff', 'Crash']);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      name: '',
      format: '1VS1',
      mode: 'S&D',
      entryFee: 50,
      maxEntries: 8,
      scoreTarget: 7,
      bestOf: 1,
      weaponRestrictions: WEAPON_OPTIONS[0],
      pointstreaks: 'restricted',
      meleeAllowed: false,
      notes: 'Pas de matchs entre 00h00 et 07h00. Verification room 10 min avant le round.',
      startsAt: getDefaultStartAt(),
      deviceRestriction: 'open',
      controllerRestriction: 'open',
      reserveCreatorAsArbiter: true,
    },
  });

  const selectedFormat = watch('format');
  const selectedMode = watch('mode');
  const selectedEntryFee = Number(watch('entryFee') || 0);
  const selectedMaxEntries = Number(watch('maxEntries') || 4);
  const reserveCreatorAsArbiter = watch('reserveCreatorAsArbiter');
  const selectedDeviceRestriction = watch('deviceRestriction');
  const selectedControllerRestriction = watch('controllerRestriction');
  const teamSize = Number(selectedFormat.split('VS')[0] || 1);

  const projections = useMemo(() => {
    const totalPlayers = selectedMaxEntries * teamSize;
    const grossPool = selectedEntryFee * totalPlayers;
    const arbitersNeeded = selectedMaxEntries > 8 ? 2 : 1;
    const arbiterRate = arbitersNeeded === 2 ? 0.1 : 0.05;
    const arbiterPool = grossPool * arbiterRate;
    const playerPool = grossPool - arbiterPool;
    return {
      totalPlayers,
      squadCost: selectedEntryFee * teamSize,
      arbitersNeeded,
      grossPool,
      playerPool,
      arbiterPool,
      first: playerPool * 0.5,
      second: playerPool * 0.3,
      third: playerPool * 0.2,
    };
  }, [selectedEntryFee, selectedMaxEntries, teamSize]);

  const toggleMap = (map: string) => {
    setSelectedMapPool((current) =>
      current.includes(map) ? current.filter((entry) => entry !== map) : [...current, map]
    );
  };

  const onSubmit = async (data: FormValues) => {
    if (!user) {
      toast.error('Connecte-toi avant de creer un tournoi.');
      navigate('/auth/login');
      return;
    }

    if (!data.name.trim() || data.name.trim().length < 4) {
      toast.error('Donne un nom clair au tournoi.');
      return;
    }

    if (selectedMapPool.length === 0) {
      toast.error('Selectionne au moins une carte dans le map pool.');
      return;
    }

    const startAt = new Date(data.startsAt);
    if (Number.isNaN(startAt.getTime()) || startAt.getTime() <= Date.now()) {
      toast.error("Choisis une fenetre de depart valide dans le futur.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await createServerTournament({
        creatorId: user.id,
        creatorPseudo: user.pseudo,
        creatorTrustScore: user.trustScore,
        format: data.format,
        name: data.name.trim(),
        maxEntries: selectedMaxEntries,
        entryFee: selectedEntryFee,
        startsAt: startAt.toISOString(),
        deviceRestriction: data.deviceRestriction,
        controllerRestriction: data.controllerRestriction,
        reserveCreatorAsArbiter: data.reserveCreatorAsArbiter,
        rules: {
          mode: data.mode,
          mapPool: selectedMapPool,
          scoreTarget: Number(data.scoreTarget || 7),
          bestOf: Number(data.bestOf || 1),
          weaponRestrictions: data.weaponRestrictions,
          pointstreaks: data.pointstreaks,
          meleeAllowed: !!data.meleeAllowed,
          notes: data.notes.trim(),
        },
      });

      hydrateTournaments([response.tournament]);
      applyServerAccountState(response);
      toast.success('Tournoi publie. Les inscriptions sont ouvertes.');
      navigate(`/mj/tournois/${response.tournament.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible de publier ce tournoi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-zoyd-black text-white font-ui scanline pb-20">
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 py-8 relative z-10">
        <div className="flex items-center justify-between gap-4 mb-10">
          <Link
            to="/mj/tournois"
            className="touch-target inline-flex items-center gap-2 text-white/40 hover:text-white transition-colors text-sm uppercase font-mono tracking-widest"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour aux tournois
          </Link>
          <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-zoyd-yellow border border-zoyd-yellow/20 px-4 py-2">
            Solo et squad
          </div>
        </div>

        <header className="relative mb-10 p-5 sm:p-6 md:p-8 border border-white/5 bg-zoyd-surface/20 overflow-hidden">
          <div className="absolute inset-0 z-0">
            <img src="/assets/images/codm-5.jpg" alt="" loading="lazy" className="w-full h-full object-cover opacity-20 mix-blend-luminosity grayscale pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-r from-zoyd-black via-zoyd-black/80 to-transparent" />
            <div className="absolute inset-0 tactical-grid opacity-10" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 border border-zoyd-yellow flex items-center justify-center text-zoyd-yellow bg-black/50">
                <Trophy className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-mono uppercase tracking-[0.35em] text-zoyd-yellow">
                Ton prochain tournoi
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-6xl font-display font-black italic uppercase tracking-tighter">
              Créer un <span className="text-zoyd-yellow">tournoi</span>
            </h1>
            <p className="text-white/60 mt-3 max-w-xl">
              Prepare une cup solo ou en equipe, choisis l'heure, les regles et le montant d'inscription.
              Une fois publie, les joueurs pourront te rejoindre directement.
            </p>
          </div>
        </header>

        <form onSubmit={handleSubmit(onSubmit)} className="grid xl:grid-cols-[1.05fr_0.95fr] gap-8">
          <input type="hidden" {...register('format')} />
          <input type="hidden" {...register('mode')} />
          <input type="hidden" {...register('entryFee', { valueAsNumber: true })} />
          <input type="hidden" {...register('maxEntries', { valueAsNumber: true })} />
          <div className="space-y-8">
            <section className="hud-panel p-5 sm:p-6 md:p-8 bg-zoyd-surface/30">
              <div className="flex items-center gap-3 mb-6">
                <Swords className="w-5 h-5 text-zoyd-blue" />
                <h2 className="text-2xl font-display font-black uppercase italic">Ton tournoi</h2>
              </div>

              <div className="grid lg:grid-cols-2 gap-6">
                <div className="lg:col-span-2">
                  <label htmlFor="tournament-name" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                    Nom du tournoi
                  </label>
                  <input
                    id="tournament-name"
                    {...register('name', { required: true, minLength: 4 })}
                    placeholder="Ex: Raid Solo Night Cup"
                    className="w-full bg-black border border-white/10 p-4 text-sm font-display font-black italic uppercase focus:outline-none focus:border-zoyd-blue"
                  />
                  {errors.name ? (
                    <p className="text-[10px] font-mono uppercase tracking-widest text-red-300 mt-2" role="alert">
                      Minimum 4 caracteres pour nommer le tournoi.
                    </p>
                  ) : null}
                </div>

                <div>
                  <label htmlFor="format-group" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                    Format du tournoi
                  </label>
                  <div id="format-group" role="radiogroup" aria-labelledby="format-group" className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {MJ_FORMATS.map((format) => {
                      const selected = selectedFormat === format;
                      const formatTeamSize = Number(format.split('VS')[0] || 1);
                      return (
                        <button
                          key={format}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={`Format ${format}, ${formatTeamSize === 1 ? 'solo' : `squad ${formatTeamSize} joueurs`}`}
                          onClick={() => setValue('format', format)}
                          className={`border p-4 text-left transition-all focus:outline-none focus:ring-2 focus:ring-zoyd-blue focus:ring-offset-2 focus:ring-offset-zoyd-black ${
                            selected
                              ? 'border-zoyd-yellow bg-zoyd-yellow/10 text-zoyd-yellow'
                              : 'border-white/10 hover:border-white/30 text-white/40'
                          }`}
                        >
                          <div className="font-display font-black text-2xl italic">{format}</div>
                          <div className="text-[10px] font-mono uppercase tracking-widest mt-2">
                            {formatTeamSize === 1 ? 'Solo' : `${formatTeamSize} joueurs / squad`}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label htmlFor="starts-at" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                    Debut souhaite
                  </label>
                  <input
                    id="starts-at"
                    type="datetime-local"
                    {...register('startsAt', { required: true })}
                    className="w-full bg-black border border-white/10 p-4 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                  />
                  {errors.startsAt ? (
                    <p className="text-[10px] font-mono uppercase tracking-widest text-red-300 mt-2" role="alert">
                      La date de debut est requise.
                    </p>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="hud-panel p-5 sm:p-6 md:p-8 bg-zoyd-surface/30">
              <div className="flex items-center gap-3 mb-6">
                <ShieldCheck className="w-5 h-5 text-zoyd-blue" />
                <h2 className="text-2xl font-display font-black uppercase italic">Comment il se joue</h2>
              </div>

              <div className="space-y-8">
                <div>
                  <label htmlFor="mode-group" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                    Mode de jeu
                  </label>
                  <div id="mode-group" role="radiogroup" aria-labelledby="mode-group" className="grid md:grid-cols-2 gap-3">
                    {MJ_MODE_OPTIONS.map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        role="radio"
                        aria-checked={selectedMode === mode.name}
                        aria-label={`Mode ${mode.name}: ${mode.desc}`}
                        onClick={() => setValue('mode', mode.name)}
                        className={`p-4 border text-left transition-all focus:outline-none focus:ring-2 focus:ring-zoyd-blue focus:ring-offset-2 focus:ring-offset-zoyd-black ${
                          selectedMode === mode.name
                            ? 'border-white bg-white/5'
                            : 'border-white/5 hover:border-white/20'
                        }`}
                      >
                        <div className="font-display font-black text-lg italic text-white">{mode.name}</div>
                        <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                          {mode.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="map-pool" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                    Cartes au programme
                  </label>
                  <div id="map-pool" role="group" aria-label="Selection des cartes" className="max-h-[300px] overflow-y-auto pr-1 scrollbar-hide grid grid-cols-2 md:grid-cols-4 gap-2">
                    {MJ_MAP_POOL.map((map) => {
                      const selected = selectedMapPool.includes(map);
                      return (
                        <button
                          key={map}
                          type="button"
                          role="checkbox"
                          aria-checked={selected}
                          aria-label={`Carte ${map}`}
                          onClick={() => toggleMap(map)}
                          className={`min-h-[44px] p-3 border text-xs font-display font-black italic uppercase transition-all focus:outline-none focus:ring-2 focus:ring-zoyd-blue focus:ring-offset-2 focus:ring-offset-zoyd-black ${
                            selected
                              ? 'bg-white text-black border-white'
                              : 'border-white/5 hover:border-white/20 text-white/40'
                          }`}
                        >
                          {map}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label htmlFor="weapon-restrictions" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                      Restriction d&apos;armes
                    </label>
                    <select
                      id="weapon-restrictions"
                      {...register('weaponRestrictions')}
                      className="w-full bg-black border border-white/10 p-4 text-xs font-display font-black italic uppercase focus:outline-none focus:border-zoyd-blue"
                    >
                      {WEAPON_OPTIONS.map((weapon) => (
                        <option key={weapon} value={weapon}>
                          {weapon}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="pointstreaks" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                      Point streaks
                    </label>
                    <select
                      id="pointstreaks"
                      {...register('pointstreaks')}
                      className="w-full bg-black border border-white/10 p-4 text-xs font-display font-black italic uppercase focus:outline-none focus:border-zoyd-blue"
                    >
                      <option value="restricted">Interdites</option>
                      <option value="allowed">Permises</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="score-target" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                      Score cible
                    </label>
                    <input
                      id="score-target"
                      type="number"
                      min={1}
                      {...register('scoreTarget', { valueAsNumber: true, min: 1 })}
                      className="w-full bg-black border border-white/10 p-4 text-xs font-display font-black italic uppercase focus:outline-none focus:border-zoyd-blue"
                    />
                  </div>

                  <div>
                    <label htmlFor="best-of" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                      Best of
                    </label>
                    <input
                      id="best-of"
                      type="number"
                      min={1}
                      {...register('bestOf', { valueAsNumber: true, min: 1 })}
                      className="w-full bg-black border border-white/10 p-4 text-xs font-display font-black italic uppercase focus:outline-none focus:border-zoyd-blue"
                    />
                  </div>
                </div>

                <label htmlFor="melee-allowed" className="flex items-center gap-4 cursor-pointer group">
                  <div className="min-w-[44px] min-h-[44px] w-11 h-11 border-2 border-white/20 flex items-center justify-center group-hover:border-zoyd-blue transition-colors">
                    <input
                      id="melee-allowed"
                      type="checkbox"
                      {...register('meleeAllowed')}
                      className="opacity-0 absolute w-11 h-11 cursor-pointer peer"
                    />
                    <div className="w-3 h-3 bg-zoyd-blue opacity-0 peer-checked:opacity-100 transition-opacity" />
                  </div>
                  <span className="text-[11px] font-display font-black text-white/40 uppercase group-hover:text-white italic">
                    Corps a corps autorise
                  </span>
                </label>

                <div>
                  <label htmlFor="match-notes" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                    Notes de match
                  </label>
                  <textarea
                    id="match-notes"
                    {...register('notes')}
                    className="w-full min-h-28 bg-black border border-white/10 p-4 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                  />
                </div>
              </div>
            </section>

            <section className="hud-panel p-5 sm:p-6 md:p-8 bg-zoyd-surface/30">
              <div className="flex items-center gap-3 mb-6">
                <Users className="w-5 h-5 text-zoyd-yellow" />
                <h2 className="text-2xl font-display font-black uppercase italic">Inscriptions et recompenses</h2>
              </div>

              <div className="space-y-8">
                <div>
                  <label htmlFor="entry-fee" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                    Pass par joueur
                  </label>
                  <div id="entry-fee" role="radiogroup" aria-labelledby="entry-fee" className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {ENTRY_OPTIONS.map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        role="radio"
                        aria-checked={selectedEntryFee === amount}
                        aria-label={`Frais d'entree ${amount} ZC`}
                        onClick={() => setValue('entryFee', amount)}
                        className={`min-h-[44px] p-3 border font-display font-black italic text-sm transition-all focus:outline-none focus:ring-2 focus:ring-zoyd-blue focus:ring-offset-2 focus:ring-offset-zoyd-black ${
                          selectedEntryFee === amount
                            ? 'border-zoyd-yellow bg-zoyd-yellow/10 text-zoyd-yellow'
                            : 'border-white/5 hover:border-zoyd-yellow text-zoyd-yellow'
                        }`}
                      >
                        {amount}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="max-entries" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                    Nombre de places
                  </label>
                  <div id="max-entries" role="radiogroup" aria-labelledby="max-entries" className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {MAX_ENTRY_OPTIONS.map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        role="radio"
                        aria-checked={selectedMaxEntries === amount}
                        aria-label={`${amount} places maximum`}
                        onClick={() => setValue('maxEntries', amount)}
                        className={`min-h-[44px] p-4 border font-display font-black italic text-sm transition-all focus:outline-none focus:ring-2 focus:ring-zoyd-blue focus:ring-offset-2 focus:ring-offset-zoyd-black ${
                          selectedMaxEntries === amount
                            ? 'bg-white text-black border-white'
                            : 'border-white/10 text-white/40 hover:border-white/30'
                        }`}
                      >
                        {amount} slots
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label htmlFor="device-restriction" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                      Appareils acceptes
                    </label>
                    <select
                      id="device-restriction"
                      {...register('deviceRestriction')}
                      className="w-full bg-black border border-white/10 p-4 text-xs font-display font-black italic uppercase focus:outline-none focus:border-zoyd-blue"
                    >
                      <option value="open">Ouvert</option>
                      {DEVICE_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="controller-restriction" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                      Type de controle accepte
                    </label>
                    <select
                      id="controller-restriction"
                      {...register('controllerRestriction')}
                      className="w-full bg-black border border-white/10 p-4 text-xs font-display font-black italic uppercase focus:outline-none focus:border-zoyd-blue"
                    >
                      <option value="open">Ouvert</option>
                      {CONTROLLER_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label htmlFor="reserve-arbiter" className="flex items-center gap-4 cursor-pointer group">
                  <div className="min-w-[44px] min-h-[44px] w-11 h-11 border-2 border-white/20 flex items-center justify-center group-hover:border-zoyd-blue transition-colors">
                    <input
                      id="reserve-arbiter"
                      type="checkbox"
                      {...register('reserveCreatorAsArbiter')}
                      className="opacity-0 absolute w-11 h-11 cursor-pointer peer"
                    />
                    <div className="w-3 h-3 bg-zoyd-blue opacity-0 peer-checked:opacity-100 transition-opacity" />
                  </div>
                  <span className="text-[11px] font-display font-black text-white/40 uppercase group-hover:text-white italic">
                    Je veux tenir la premiere place d'arbitre
                  </span>
                </label>
              </div>
            </section>
          </div>

          <aside className="space-y-6 xl:sticky xl:top-10 h-fit">
            <div className="hud-panel p-5 sm:p-6 md:p-8 bg-zoyd-surface/40">
              <div className="inline-flex items-center gap-3 px-3 py-1 bg-green-500/10 border border-green-500/20 text-green-400 font-display font-black text-[10px] tracking-widest uppercase mb-6 italic">
                <CheckCircle2 className="w-4 h-4" /> En un coup d'oeil
              </div>

              <div className="space-y-4">
                <SummaryBox label="Nom" value={watch('name') || 'Tournoi sans nom'} />
                <SummaryBox
                  label="Format"
                  value={teamSize === 1 ? `${selectedFormat} / solo` : `${selectedFormat} / ${teamSize} joueurs`}
                />
                <SummaryBox label="Mode" value={selectedMode} />
                <SummaryBox label="Cartes" value={selectedMapPool.join(' / ') || 'Aucune carte'} />
                <SummaryBox label="Fenetre" value={watch('startsAt') || 'A definir'} />
                <SummaryBox label="Restrictions" value={`${selectedDeviceRestriction} / ${selectedControllerRestriction}`} />
              </div>
            </div>

            <div className="hud-panel p-5 sm:p-6 md:p-8 bg-zoyd-surface/40">
              <h2 className="text-lg font-display font-black uppercase italic mb-6">Ce que les joueurs jouent</h2>
              <div className="space-y-4">
                <ProjectionRow label="Places ouvertes" value={`${selectedMaxEntries} ${teamSize > 1 ? 'equipes' : 'joueurs'}`} />
                <ProjectionRow label="Joueurs au complet" value={`${projections.totalPlayers}`} />
                <ProjectionRow label="Arbitres necessaires" value={`${projections.arbitersNeeded}`} />
                <ProjectionRow label={teamSize > 1 ? 'Cout pour une equipe' : 'Cout pour un joueur'} value={formatZC(projections.squadCost)} />
                <ProjectionRow label="Cagnotte totale" value={formatZC(projections.grossPool)} accent="text-zoyd-yellow" />
                <ProjectionRow label="A gagner" value={formatZC(projections.playerPool)} />
                <ProjectionRow label="Part arbitres" value={formatZC(projections.arbiterPool)} />
                <ProjectionRow label="Top 1" value={formatZC(projections.first)} accent="text-zoyd-yellow" />
                <ProjectionRow label="Top 2" value={formatZC(projections.second)} />
                <ProjectionRow label="Top 3" value={formatZC(projections.third)} />
              </div>
            </div>

            <div className="hud-panel p-5 sm:p-6 md:p-8 bg-zoyd-surface/40">
              <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-4">
                Publication
              </div>
              <p className="text-sm text-white/60 mb-6">
                Ton tournoi apparaitra d&apos;abord dans les inscriptions ouvertes. Les joueurs rejoignent ensuite
                depuis leur profil, pendant que tu gardes la main sur l&apos;organisation.
              </p>
              {teamSize > 1 ? (
                <div className="border border-zoyd-yellow/20 bg-zoyd-yellow/5 p-4 text-sm text-white/60 mb-6">
                  Pour les formats en equipe, le capitaine inscrit tout son groupe d&apos;un coup.
                </div>
              ) : null}
              {reserveCreatorAsArbiter ? (
                <div className="border border-zoyd-blue/20 bg-zoyd-blue/5 p-4 text-sm text-white/60 mb-6">
                  Tu prendras la premiere place d&apos;arbitre pour lancer les premiers duels au bon moment.
                </div>
              ) : null}
              <button
                type="submit"
                disabled={isSubmitting}
                className={`touch-target w-full py-5 font-display font-black italic tracking-widest uppercase transition-all ${isSubmitting ? 'bg-white/50 text-black/50 cursor-not-allowed' : 'bg-white text-black hover:bg-zoyd-yellow'}`}
              >
                {isSubmitting ? 'Publication...' : 'Publier le tournoi'}
              </button>
            </div>
          </aside>
        </form>
      </div>
    </div>
  );
};

const SummaryBox = ({ label, value }: { label: string; value: string }) => (
  <div className="border border-white/5 px-4 py-3 bg-black/30">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-1">{label}</div>
    <div className="font-display font-black text-white italic">{value}</div>
  </div>
);

const ProjectionRow = ({
  label,
  value,
  accent = 'text-white',
}: {
  label: string;
  value: string;
  accent?: string;
}) => (
  <div className="flex items-center justify-between border-b border-white/5 pb-3">
    <span className="text-xs font-display font-black text-white/40 italic">{label}</span>
    <span className={`font-display font-black italic ${accent}`}>{value}</span>
  </div>
);

export default CreateTournamentPage;
