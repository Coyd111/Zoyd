/**
 * CreateMatchPage - creation d'un match (formulaire en plusieurs etapes).
 *
 * Regle format, carte, regles, frais d'entree et restrictions, puis cree le
 * match via l'API et applique la reponse serveur au profil et au wallet.
 *
 * INVARIANT : la creation passe par createServerMatch (API), puis la reponse
 * (match, user, wallet) est hydratee avec applyServerAccountState. Ecrire
 * le match localement en esperant que le serveur suive afficherait un match
 * inexistant.
 * INVARIANT : si le solde est insuffisant, le joueur est redirige vers le
 * portefeuille avec un montant a recharger (buildFundingPath) - le retour
 * doit sanitiser la destination.
 * PIEGE : le `returnTo` n'est accepte que pour une liste blanche de
 * prefixes (/mj, /br-league) et doit commencer par un seul `/` : un `//`
 * ou une URL absolue serait une redirection ouverte.
 * PIEGE : le match cree debloque les frais DANS la cagnotte : la partition
 * affichee est celle du serveur, pas prizePool moins des frais.
 *
 * Voir aussi : docs/08-frontend.md - section 12 (Le champ perWinner)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, ChevronLeft, Check, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from '../../lib/toast';
import {
  MJ_BEST_OF_PRESETS,
  MJ_BEST_OF_SCENE,
  MJ_FORMATS,
  MJ_MAPS_FOR_MODE,
  MJ_MODE_OPTIONS,
  MJ_MODE_PRESETS,
  MJ_PICKS_ALTERNANCE,
  MJ_WEAPON_OPTIONS,
  formatTimeLimit,
  getMapImage,
} from '../../../lib/competition';
import { buildFundingPath, getRequiredTopUp } from '../../../lib/walletFunding';
import { createServerMatch } from '../../lib/matchApi';
import { applyServerAccountState } from '../../lib/serverSync';
import { useAuthStore } from '../../stores/authStore';
import { useMatchStore, type MatchFormat } from '../../stores/matchStore';
import { useWalletStore } from '../../stores/walletStore';
import { SEOHead } from '../../components/SEOHead';
import { Modal } from '../../components/ui/Modal';

const ENTRY_OPTIONS = [50, 100, 200, 500, 1000];
const ARBITER_FEE_RATE = 0.02;
const TEAM_OPTIONS = [
  { label: 'Squad Alpha', value: 0 },
  { label: 'Squad Bravo', value: 1 },
] as const;

interface MatchFormData {
  passAmount: number;
  trustScoreMin: string;
  /** Sélection d'armes : pas de valeur par défaut, la 1re option du select fait foi. */
  weapons?: string;
  score: number;
  bestOf: number;
  pointstreaks: 'allowed' | 'restricted';
  /** Compétences d'opérateur (P1 02/11/2026) : vocabulaire identique a pointstreaks. */
  operatorSkills: 'allowed' | 'restricted';
  /** Limite de temps saisie en MINUTES dans l'UI, stockee en SECONDES dans rules. */
  timeLimitMinutes?: number;
  /** P3 : contrat affiche "picks en alternance" (BO3+), arbitre dans la salle CODM. */
  picksAlternate?: boolean;
  meleeAllowed: boolean;
  isPrivate: boolean;
  creatorTeam: number;
  /** Role du createur : joueur (pass bloque) ou arbitre (aucun pass). */
  creatorRole: 'player' | 'arbiter';
}

const CreateMatchPage: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedFormat, setSelectedFormat] = useState<MatchFormat | ''>('');
  const [selectedGameMode, setSelectedGameMode] = useState('');
  const [selectedMap, setSelectedMap] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const hydrateMatches = useMatchStore((state) => state.hydrateFromServer);
  const { getAvailableToSpend } = useWalletStore();

  const { register, handleSubmit, watch, setValue, getValues } = useForm<MatchFormData>({
    defaultValues: {
      passAmount: 50,
      trustScoreMin: '0',
      score: 15,
      bestOf: 3,
      isPrivate: false,
      creatorTeam: 0,
      creatorRole: 'player',
      pointstreaks: 'restricted',
      operatorSkills: 'restricted',
      timeLimitMinutes: undefined,
      meleeAllowed: true,
      picksAlternate: false,
    },
  });

  const selectedPass = Number(watch('passAmount') || 0);
  const selectedCreatorRole = watch('creatorRole');
  const isArbiterCreator = selectedCreatorRole === 'arbiter';
  const selectedCreatorTeam = Number(watch('creatorTeam') || 0);
  // P3 : la convention "picks en alternance" ne concerne que les BO3+.
  const bestOfValue = Number(watch('bestOf') || 1);
  const availableSpend = getAvailableToSpend();

  /**
   * Preset esports du mode choisi (S&D/HARDPOINT/CONTROL) : sinon `undefined`
   * et le formulaire laisse le reglage libre (pas de valeur sourcee).
   */
  const rulePreset = selectedGameMode ? MJ_MODE_PRESETS[selectedGameMode] : undefined;
  /**
   * Cartes jouables pour le mode selectionne (compatibilite verifiee :
   * Oasis ne se joue qu'en FRONTLINE). PIEGE : le formulaire ne rend JAMAIS
   * MJ_MAP_POOL en direct - toujours passer par ce filtre, sinon une carte
   * incompatible avec le mode peut etre publiee.
   */
  const availableMaps = MJ_MAPS_FOR_MODE(selectedGameMode);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        if (showPublishConfirm) {
          setShowPublishConfirm(false);
          return;
        }
        if (currentStep > 1) setCurrentStep((prev) => prev - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, isSubmitting, showPublishConfirm]);

  const playerSlots = useMemo(() => {
    return selectedFormat ? parseInt(selectedFormat.split('VS')[0], 10) * 2 : 2;
  }, [selectedFormat]);

  const livePot = useMemo(() => selectedPass * playerSlots, [playerSlots, selectedPass]);
  const arbiterShare = useMemo(() => livePot * ARBITER_FEE_RATE, [livePot]);
  const winnerShare = useMemo(() => Math.max(0, livePot - arbiterShare), [arbiterShare, livePot]);
  // Un arbitre ne paie rien : le requiredTopUp ne s'applique qu'au joueur.
  const requiredTopUp = useMemo(
    () => (isArbiterCreator ? 0 : getRequiredTopUp(selectedPass, availableSpend)),
    [isArbiterCreator, availableSpend, selectedPass],
  );

  const onStep1Submit = () => {
    if (!selectedFormat) {
      toast.error('Sélectionne un format pour continuer.');
      return;
    }

    setCurrentStep(2);
  };

  /**
   * Choisir un mode peut INVALIDER la carte deja cliquee (compat verifiee :
   * Oasis ne se joue qu'en FRONTLINE). On vide la selection plutot que
   * garder une carte hors reglement dans CODM.
   */
  const handleModeSelect = (name: string) => {
    setSelectedGameMode(name);
    if (selectedMap && !MJ_MAPS_FOR_MODE(name).includes(selectedMap)) {
      setSelectedMap('');
      toast.info(`${selectedMap} n'est pas jouable en ${name}. Choisis une autre carte.`);
    }
  };

  /** Preset esports : pre-remplit score et limite de temps (saisie libre ensuite). */
  const applyRulePreset = () => {
    if (!rulePreset) return;
    setValue('score', rulePreset.scoreTarget);
    setValue('timeLimitMinutes', rulePreset.timeLimitSeconds / 60);
    toast.info(`Preset appliqué (${rulePreset.source}). Ajustable librement.`);
  };

  const onStep2Submit = (_data: Partial<MatchFormData>) => {
    if (!selectedGameMode || !selectedMap) {
      toast.error('Choisis un mode et une carte.');
      return;
    }

    setCurrentStep(3);
  };

  const onStep3Submit = (_data: Partial<MatchFormData>) => {
    if (!selectedPass || selectedPass <= 0) {
      toast.error('Choisis une mise valide pour continuer.');
      return;
    }

    setCurrentStep(4);
  };

  const openPublishConfirm = () => {
    if (!user) {
      toast.error('Connecte-toi avant de créer une partie.');
      navigate('/auth/login');
      return;
    }

    if (!selectedFormat || !selectedGameMode || !selectedMap) {
      toast.error('La configuration de la partie est incomplète.');
      return;
    }

    // Un créateur-arbitre ne bloque aucun pass : le garde de solde
    // ne s'applique qu'au joueur.
    if (selectedCreatorRole === 'player' && selectedPass > availableSpend) {
      toast.error("Solde insuffisant. Recharge d'abord ton portefeuille pour engager ton pass.");
      navigate(
        buildFundingPath({
          context: 'match-create',
          requiredAmount: selectedPass,
          availableAmount: availableSpend,
          returnTo: '/mj/creer',
        })
      );
      return;
    }

    setShowPublishConfirm(true);
  };

  const onFinalSubmit = async () => {
    setShowPublishConfirm(false);
    setIsSubmitting(true);
    try {
      /**
       * UI en minutes, rules en secondes : une minute moisi (0.5) devient
       * 30 s arrondies. Vide/0/negatif = pas de limite publiee du tout :
       * n'envoie pas `timeLimitSeconds: 0`, le lecteur l'afficherait comme
       * une vraie limite.
       */
      const timeLimitMinutes = Number(getValues('timeLimitMinutes') || 0);
      const timeLimitSeconds =
        Number.isFinite(timeLimitMinutes) && timeLimitMinutes > 0
          ? Math.round(timeLimitMinutes * 60)
          : undefined;
      const response = await createServerMatch({
        creatorTeam: Number(getValues('creatorTeam') || 0) === 1 ? 1 : 0,
        creatorRole: getValues('creatorRole') === 'arbiter' ? 'arbiter' : 'player',
        format: selectedFormat,
        entryFee: Number(getValues('passAmount') || 0),
        visibility: getValues('isPrivate') ? 'private' : 'public',
        trustScoreMin: Number(getValues('trustScoreMin') || 0),
        isInstant: true,
        rules: {
          mode: selectedGameMode,
          map: selectedMap,
          weaponRestrictions: getValues('weapons'),
          scoreTarget: Number(getValues('score') || 15),
          bestOf: Number(getValues('bestOf') || 3),
          pointstreaks: getValues('pointstreaks') === 'allowed' ? 'allowed' : 'restricted',
          operatorSkills: getValues('operatorSkills') === 'allowed' ? 'allowed' : 'restricted',
          meleeAllowed: !!getValues('meleeAllowed'),
          // P3 : le contrat "picks en alternance" n'a de sens qu'en BO3+ ;
          // non coche ou BO<=2, le champ n'est PAS envoye (pas de valeur
          // inventee dans rules).
          ...(Number(getValues('bestOf') || 1) >= 3 && getValues('picksAlternate')
            ? { picksAlternate: true }
            : {}),
          ...(timeLimitSeconds
            ? { timeLimitSeconds, timeLimitScope: rulePreset?.timeLimitScope ?? 'match' }
            : {}),
        },
      });

      hydrateMatches([response.match]);
      applyServerAccountState(response);
      toast.success('Partie publiée. Ta place est réservée.');
      navigate(`/mj/match/${response.match.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible de publier cette partie.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-zoyd-black text-white font-ui scanline pb-20">
      <SEOHead title="Créer un match — ZOYD" description="Configure et lance un nouveau match wager." path="/mj/creer" noindex />
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-12 relative z-10">
        <header className="mb-12 relative overflow-hidden border border-white/5">
          <img src="/assets/images/codm-4.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-luminosity grayscale pointer-events-none" />
          <div className="relative z-10 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 border border-zoyd-blue flex items-center justify-center text-zoyd-blue">
                <span className="font-display font-black">VS</span>
              </div>
              <span className="text-[10px] font-mono font-black text-zoyd-blue uppercase tracking-[0.3em]">
                Configure ton Wager
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-6xl font-display font-black uppercase tracking-tighter italic">
              CRÉER UN <span className="text-zoyd-yellow">WAGER</span>
            </h1>
          </div>
        </header>

        <nav aria-label="Progression des étapes" className="flex items-center gap-4 mb-16">
          {[
            { step: 1, name: 'Format' },
            { step: 2, name: 'Config' },
            { step: 3, name: 'Mise' },
            { step: 4, name: 'Recap' },
          ].map(({ step, name }) => (
            <div key={step} className="flex-1 flex flex-col gap-2" aria-current={step === currentStep ? 'step' : undefined}>
              <div className={`h-1.5 transition-all duration-500 ${step <= currentStep ? (step === currentStep ? 'bg-zoyd-yellow' : 'bg-white') : 'bg-white/5'}`} role="progressbar" aria-valuenow={step <= currentStep ? 100 : 0} aria-valuemin={0} aria-valuemax={100} />
              <span className={`text-[10px] font-mono font-black uppercase tracking-[0.2em] ${step === currentStep ? 'text-white' : 'text-white/70'}`}>
                {`0${step} · ${name}`}
              </span>
            </div>
          ))}
        </nav>

        <AnimatePresence mode="wait">
          {currentStep === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="hud-panel p-6 sm:p-8 md:p-10 bg-zoyd-surface/40">
                <h2 className="text-xl sm:text-2xl md:text-3xl font-display font-black text-white mb-10 italic uppercase">Choisis le format</h2>
                <div id="format-group" role="radiogroup" aria-labelledby="format-group" className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-12">
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
                        onClick={() => setSelectedFormat(format)}
                        className={`group relative p-5 sm:p-6 md:p-8 border transition-all ${selectedFormat === format ? 'bg-zoyd-blue border-zoyd-blue text-black' : 'bg-black border-white/5 hover:border-white/20'}`}
                      >
                        <p className={`text-2xl sm:text-3xl font-display font-black italic ${selectedFormat === format ? 'text-black' : 'text-white/70 group-hover:text-white transition-colors'}`}>
                          {format}
                        </p>
                        {selectedFormat === format && (
                          <div className="absolute top-2 right-2">
                            <Check className="w-4 h-4" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={onStep1Submit}
                  className="bg-white text-black w-full py-5 min-h-[44px] font-display font-black italic tracking-widest uppercase hover:bg-zoyd-yellow disabled:opacity-20 transition-all flex items-center justify-center gap-4"
                  disabled={!selectedFormat}
                  aria-label="Continuer à l'étape suivante"
                >
                  Continuer <ChevronRight className="w-6 h-6" />
                </button>
              </div>
            </motion.div>
          )}

          {currentStep === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <form onSubmit={handleSubmit(onStep2Submit)} className="space-y-8">
                <div className="hud-panel p-6 sm:p-8 md:p-10 bg-zoyd-surface/40">
                  <h2 className="text-xl sm:text-2xl md:text-3xl font-display font-black text-white mb-10 italic uppercase">Comment vous allez jouer</h2>

                  <div className="space-y-12">
                    <div>
                      <label className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block underline">
                        01 / Mode de jeu
                      </label>
                      <div id="gamemode-group" role="radiogroup" aria-labelledby="gamemode-group" className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {MJ_MODE_OPTIONS.map((mode) => (
                          <button
                            type="button"
                            key={mode.id}
                            role="radio"
                            aria-checked={selectedGameMode === mode.name}
                            aria-label={`Mode ${mode.name}: ${mode.desc}`}
                            onClick={() => handleModeSelect(mode.name)}
                            className={`p-4 border text-left transition-all ${selectedGameMode === mode.name ? 'border-white bg-white/5' : 'border-white/5 hover:border-white/20'}`}
                          >
                            <div className="font-display font-black text-lg italic text-white">{mode.name}</div>
                            <div className="text-[10px] font-mono text-white/70 uppercase tracking-widest">{mode.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block underline">
                        02 / Carte choisie
                      </label>
                      <div id="map-pool" role="group" aria-label="Sélection de la carte" className="max-h-[400px] overflow-y-auto pr-1 scrollbar-hide grid grid-cols-2 md:grid-cols-4 gap-3">
                        {availableMaps.map((map) => (
                          <button
                            type="button"
                            key={map}
                            role="radio"
                            aria-checked={selectedMap === map}
                            aria-label={`Carte ${map}`}
                            onClick={() => setSelectedMap(map)}
                            className={`relative h-20 sm:h-24 overflow-hidden border transition-all ${selectedMap === map ? 'border-zoyd-blue shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'border-white/10 hover:border-white/30'}`}
                          >
                            {getMapImage(map) && (
                              <img 
                                src={getMapImage(map)}
                                alt={map}
                                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${selectedMap === map ? 'opacity-80 mix-blend-normal' : 'opacity-40 mix-blend-luminosity hover:opacity-60'}`}
                              />
                            )}
                            <div className={`absolute inset-0 bg-gradient-to-t ${selectedMap === map ? 'from-black/90 to-transparent' : 'from-black/80 to-black/20'}`} />
                            <span className={`relative z-10 flex h-full items-end p-3 text-xs font-display font-black italic uppercase tracking-wider ${selectedMap === map ? 'text-zoyd-blue' : 'text-white'}`}>
                              {map}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {selectedGameMode && rulePreset && (
                      <div className="flex items-center justify-between gap-4 border border-zoyd-yellow/20 bg-zoyd-yellow/5 px-4 py-3">
                        <div>
                          <div className="text-[10px] font-mono font-black text-zoyd-yellow uppercase tracking-widest">
                            Preset esports — {selectedGameMode}
                          </div>
                          <div className="text-[10px] font-mono text-white/60 uppercase tracking-widest mt-1">
                            Score {rulePreset.scoreTarget} · {formatTimeLimit(rulePreset.timeLimitSeconds, rulePreset.timeLimitScope)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={applyRulePreset}
                          aria-label={`Appliquer le preset ${selectedGameMode}`}
                          className="shrink-0 border border-zoyd-yellow/40 px-4 py-2 text-[10px] font-display font-black uppercase tracking-widest text-zoyd-yellow hover:bg-zoyd-yellow hover:text-black transition-all"
                        >
                          Appliquer
                        </button>
                      </div>
                    )}
                    {selectedGameMode && !rulePreset && (
                      <div className="border border-white/5 px-4 py-3 bg-black/30">
                        <div className="text-[10px] font-mono text-white/60 uppercase tracking-widest">
                          Réglage libre — pas de preset vérifié pour {selectedGameMode}
                        </div>
                      </div>
                    )}

                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <label htmlFor="weapons" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block">
                          Restriction d'armes
                        </label>
                        <select id="weapons" {...register('weapons')} aria-label="Restriction d'armes" className="w-full bg-black border border-white/10 p-4 text-xs font-display font-black italic uppercase focus:border-zoyd-blue">
                          {MJ_WEAPON_OPTIONS.map((weapon) => (
                            <option key={weapon} value={weapon}>
                              {weapon}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="pointstreaks" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block">
                          Séries de points
                        </label>
                        <select id="pointstreaks" {...register('pointstreaks')} aria-label="Séries de points" className="w-full bg-black border border-white/10 p-4 text-xs font-display font-black italic uppercase focus:border-zoyd-blue">
                          <option value="restricted">Interdites</option>
                          <option value="allowed">Permises</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="operatorSkills" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block">
                          Compétences d'opérateur
                        </label>
                        <select id="operatorSkills" {...register('operatorSkills')} aria-label="Compétences d'opérateur" className="w-full bg-black border border-white/10 p-4 text-xs font-display font-black italic uppercase focus:border-zoyd-blue">
                          <option value="restricted">Interdites</option>
                          <option value="allowed">Permises</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="score" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block">
                          Score cible
                        </label>
                        <input id="score" type="number" {...register('score')} placeholder="15" aria-label="Score cible" className="w-full bg-black border border-white/10 p-4 text-xs font-display font-black italic uppercase focus:border-zoyd-blue" />
                      </div>
                      <div>
                        <label htmlFor="timeLimitMinutes" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block">
                          Limite de temps (min)
                        </label>
                        <input
                          id="timeLimitMinutes"
                          type="number"
                          {...register('timeLimitMinutes', { valueAsNumber: true })}
                          placeholder="Libre"
                          aria-label="Limite de temps en minutes"
                          className="w-full bg-black border border-white/10 p-4 text-xs font-display font-black italic uppercase focus:border-zoyd-blue"
                        />
                        <p className="text-[10px] font-mono text-white/40 uppercase tracking-widest mt-2">
                          Vide = libre. Un preset remplit ce champ.
                        </p>
                      </div>
                      <div>
                        <label htmlFor="bestOf" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block">
                          Best of
                        </label>
                        <input id="bestOf" type="number" {...register('bestOf')} placeholder="3" aria-label="Best of" className="w-full bg-black border border-white/10 p-4 text-xs font-display font-black italic uppercase focus:border-zoyd-blue" />
                        {/* P4 2026-11-02 : presets de la scene wager (DuelX :
                            BO1/BO3/BO5). Un preset REMPLIT le champ, la
                            saisie libre reste possible (reglement libre). */}
                        <div className="flex flex-wrap gap-2 mt-3">
                          {MJ_BEST_OF_PRESETS.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setValue('bestOf', preset)}
                              aria-label={`Preset best of ${preset}`}
                              className={`px-3 py-2 border text-[11px] font-display font-black italic uppercase tracking-widest transition-colors ${
                                bestOfValue === preset
                                  ? 'border-white bg-white/10 text-white'
                                  : 'border-white/10 text-white/40 hover:border-white/30 hover:text-white/70'
                              }`}
                            >
                              BO{preset}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] font-mono text-white/40 uppercase tracking-widest mt-2">
                          {MJ_BEST_OF_SCENE}
                        </p>
                      </div>
                    </div>

                    {/* P3 (02/11/2026) : convention duelx des BO3. Contrat
                        AFFICHE arbitre par les joueurs dans la salle CODM
                        (carte de la manche 1 au createur, manche 2 a
                        l'adversaire) - le champ n'existe pas en BO1/BO2. */}
                    {bestOfValue >= 3 && (
                      <div className="mt-6">
                        <label htmlFor="picksAlternate" className="flex items-center gap-4 cursor-pointer group">
                          <div className="w-5 h-5 border-2 border-white/20 flex items-center justify-center group-hover:border-zoyd-blue transition-colors">
                            <input id="picksAlternate" type="checkbox" {...register('picksAlternate')} aria-label="Picks en alternance par manche" className="opacity-0 absolute w-5 h-5 cursor-pointer peer" />
                            <div className="w-2 h-2 bg-zoyd-blue opacity-0 peer-checked:opacity-100 transition-opacity" />
                          </div>
                          <span className="text-[11px] font-display font-black text-white/70 uppercase group-hover:text-white italic">
                            Picks en alternance par manche
                          </span>
                        </label>
                        <p className="text-[10px] font-mono text-white/40 uppercase tracking-widest mt-2">
                          Manche 1 : createur / Manche 2 : adversaire / Departage : accord (convention wager)
                        </p>
                      </div>
                    )}

                    <label htmlFor="meleeAllowed" className="flex items-center gap-4 cursor-pointer group">
                      <div className="w-5 h-5 border-2 border-white/20 flex items-center justify-center group-hover:border-zoyd-blue transition-colors">
                        <input id="meleeAllowed" type="checkbox" {...register('meleeAllowed')} aria-label="Autoriser le corps à corps" className="opacity-0 absolute w-5 h-5 cursor-pointer peer" />
                        <div className="w-2 h-2 bg-zoyd-blue opacity-0 peer-checked:opacity-100 transition-opacity" />
                      </div>
                      <span className="text-[11px] font-display font-black text-white/70 uppercase group-hover:text-white italic">
                        Corps a corps autorise
                      </span>
                    </label>
                  </div>

                  <div className="flex gap-4 mt-12">
                    <button type="button" onClick={() => setCurrentStep(1)} aria-label="Retour à l'étape précédente" className="flex-1 border border-white/10 py-5 font-display font-black text-xs tracking-widest uppercase opacity-40 hover:opacity-100 flex items-center justify-center gap-2 touch-target">
                      <ChevronLeft className="w-4 h-4" /> Retour
                    </button>
                    <button type="submit" aria-label="Passer à la mise" className="flex-[2] bg-white text-black py-5 font-display font-black italic tracking-widest uppercase hover:bg-zoyd-yellow transition-all flex items-center justify-center gap-4 touch-target">
                      La Mise (Wager) <ChevronRight className="w-6 h-6" />
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          )}

          {currentStep === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <form onSubmit={handleSubmit(onStep3Submit)}>
                <div className="hud-panel p-6 sm:p-8 md:p-10 bg-zoyd-surface/40">
                  <h2 className="text-xl sm:text-2xl md:text-3xl font-display font-black text-white mb-10 italic uppercase">La Mise (Prize Pool)</h2>

                  <div className="space-y-12 mb-12">
                    <div>
                      <label className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block underline">
                        Mise par joueur
                      </label>
                      <div id="entry-amount-group" role="radiogroup" aria-label="Montant de la mise" className="grid grid-cols-3 md:grid-cols-6 gap-2">
                        {ENTRY_OPTIONS.map((amount) => (
                          <button
                            key={amount}
                            type="button"
                            role="radio"
                            aria-checked={selectedPass === amount}
                            aria-label={`Mise de ${amount} ZC`}
                            onClick={() => setValue('passAmount', amount)}
                            className={`p-3 border font-display font-black italic text-sm transition-all ${selectedPass === amount ? 'border-zoyd-blue bg-zoyd-blue/10 text-zoyd-blue' : 'border-white/5 hover:border-zoyd-blue text-zoyd-blue'}`}
                          >
                            {amount}
                          </button>
                        ))}
                      </div>
                      <input id="passAmount" {...register('passAmount')} type="number" inputMode="numeric" step="0.5" placeholder="Montant personnalisé" aria-label="Montant de la mise personnalisé" className="mt-4 w-full bg-black border border-white/5 p-4 text-[10px] font-mono font-black tracking-widest uppercase focus:border-zoyd-yellow transition-all" />
                    </div>

                    <div className="grid md:grid-cols-2 gap-8 items-start">
                      <div className="p-6 border border-white/5 bg-black/60 relative overflow-hidden">
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,227,81,0.08),transparent_70%)] pointer-events-none" />
                        <h3 className="text-[10px] font-mono font-black text-zoyd-muted uppercase tracking-[0.2em] mb-4 relative z-10">Répartition du Prize Pool</h3>
                        <div className="space-y-4 relative z-10">
                          <div className="flex justify-between border-b border-white/10 pb-4">
                            <span className="text-xs font-display font-black text-white/70 italic">Pot Total (Cagnotte)</span>
                            <span className="font-display font-black text-2xl text-zoyd-yellow">{livePot.toLocaleString()} ZC</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-xs font-display font-black text-white/70 italic">Pour le gagnant</span>
                            <span className="font-display font-black text-xl text-white">{winnerShare.toLocaleString()} ZC</span>
                          </div>
                          <div className="flex justify-between pt-2">
                            <span className="text-xs font-display font-black text-white/70 italic">Commission de l'arbitre</span>
                            <span className="font-display font-black text-lg text-white/70">{arbiterShare.toLocaleString()} ZC</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div>
                          <label htmlFor="trustScoreMin" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                            Niveau de confiance minimum
                          </label>
                          <select id="trustScoreMin" {...register('trustScoreMin')} aria-label="Niveau de confiance minimum" className="w-full bg-black border border-white/10 p-4 text-xs font-display font-black italic uppercase focus:border-zoyd-blue">
                            <option value="0">Aucun (0+)</option>
                            <option value="30">30+</option>
                            <option value="50">50+</option>
                            <option value="80">80+</option>
                            <option value="90">90+</option>
                          </select>
                        </div>

                        {/* Choix du rôle : joueur (pass bloqué) ou arbitre
                            (aucun pass). En mode arbitre, le champ équipe
                            disparaît : il n'y a aucun slot à prendre. */}
                        <div>
                          <label className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                            Ton rôle
                          </label>
                          <div id="role-group" role="radiogroup" aria-label="Sélection du rôle" className="grid grid-cols-2 gap-2">
                            {([
                              { label: 'Joueur', value: 'player' as const, desc: 'Tu bloques ton pass et tu joues.' },
                              { label: 'Arbitre', value: 'arbiter' as const, desc: 'Tu arbitres, tu ne paies pas.' },
                            ]).map((role) => (
                              <button
                                key={role.value}
                                type="button"
                                role="radio"
                                aria-checked={selectedCreatorRole === role.value}
                                aria-label={`Rôle ${role.label}`}
                                onClick={() => setValue('creatorRole', role.value)}
                                className={`p-4 border text-left font-display font-black italic uppercase transition-all ${selectedCreatorRole === role.value ? 'bg-white text-black border-white' : 'border-white/10 text-white/70 hover:border-white/30'}`}
                              >
                                {role.label}
                                <span className="block mt-1 text-[9px] font-mono font-bold uppercase tracking-widest opacity-70">{role.desc}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {!isArbiterCreator && (
                          <div>
                            <label className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                              Ton équipe
                            </label>
                            <div id="team-group" role="radiogroup" aria-label="Sélection de l'équipe" className="grid grid-cols-2 gap-2">
                              {TEAM_OPTIONS.map((team) => (
                                <button
                                  key={team.value}
                                  type="button"
                                  role="radio"
                                  aria-checked={selectedCreatorTeam === team.value}
                                  aria-label={`Équipe ${team.label}`}
                                  onClick={() => setValue('creatorTeam', team.value)}
                                  className={`p-4 border font-display font-black italic uppercase transition-all ${selectedCreatorTeam === team.value ? 'bg-white text-black border-white' : 'border-white/10 text-white/70 hover:border-white/30'}`}
                                >
                                  {team.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <label htmlFor="isPrivate" className="flex items-center gap-4 cursor-pointer group">
                          <div className="w-5 h-5 border-2 border-white/20 flex items-center justify-center group-hover:border-zoyd-blue transition-colors">
                            <input id="isPrivate" type="checkbox" {...register('isPrivate')} aria-label="Partie privée sur invitation" className="opacity-0 absolute w-5 h-5 cursor-pointer peer" />
                            <div className="w-2 h-2 bg-zoyd-blue opacity-0 peer-checked:opacity-100 transition-opacity" />
                          </div>
                          <span className="text-[11px] font-display font-black text-white/70 uppercase group-hover:text-white italic">
                            Partie privée (sur invitation)
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button type="button" onClick={() => setCurrentStep(2)} aria-label="Retour à l'étape précédente" className="flex-1 border border-white/10 py-5 min-h-[44px] font-display font-black text-xs tracking-widest uppercase opacity-40 hover:opacity-100 flex items-center justify-center gap-2 touch-target">
                      <ChevronLeft className="w-4 h-4" /> Retour
                    </button>
                    <button type="submit" aria-label="Passer au récapitulatif" className="flex-[2] bg-white text-black py-5 min-h-[44px] font-display font-black italic tracking-widest uppercase hover:bg-zoyd-yellow transition-all flex items-center justify-center gap-4 touch-target">
                      Récapitulatif <ChevronRight className="w-6 h-6" />
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          )}

          {currentStep === 4 && (
            <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="hud-panel p-6 sm:p-8 md:p-10 bg-zoyd-surface/40">
                <div className="text-center mb-12">
                  <div className="inline-flex items-center gap-3 px-3 py-1 bg-green-500/10 border border-green-500/20 text-green-500 font-display font-black text-[10px] tracking-widest uppercase mb-6 italic">
                    <ShieldCheck className="w-4 h-4" /> Prêt à publier
                  </div>
                  <h2 className="text-xl sm:text-4xl md:text-5xl font-display font-black text-white italic uppercase tracking-tighter">
                    Récapitulatif du Wager
                  </h2>
                </div>

                <div className="grid md:grid-cols-2 gap-4 mb-12">
                  <SummaryBox label="Format" value={selectedFormat || '-'} />
                  <SummaryBox label="Mode / carte" value={`${selectedGameMode || '-'} / ${selectedMap || '-'}`} />
                  <SummaryBox
                        label={isArbiterCreator ? 'Droit d\u2019entrée par joueur' : 'Ton pass'}
                        value={`${selectedPass.toFixed(1)} ZC`}
                        highlight
                      />
                  <SummaryBox label="Solde dispo" value={`${availableSpend.toFixed(1)} ZC`} />
                  <SummaryBox label="Armes" value={getValues('weapons') || 'Toutes'} />
                  {Number(getValues('bestOf') || 1) >= 3 && getValues('picksAlternate') ? (
                    <SummaryBox
                      label="Manches"
                      value={MJ_PICKS_ALTERNANCE}
                    />
                  ) : null}
                  <SummaryBox
                    label="Limite de temps"
                    value={
                      formatTimeLimit(Number(getValues('timeLimitMinutes') || 0) * 60, rulePreset?.timeLimitScope) || 'Libre'
                    }
                  />
                  {isArbiterCreator ? null : <SummaryBox label="Ton équipe" value={selectedCreatorTeam === 0 ? 'Squad Alpha' : 'Squad Bravo'} />}
                  <SummaryBox label="Ton rôle" value={isArbiterCreator ? 'Arbitre (sans pass)' : 'Joueur (pass bloqué)'} />
                  <SummaryBox label="Visibilité" value={getValues('isPrivate') ? 'Privé' : 'Public'} />
                </div>

                {requiredTopUp > 0 ? (
                  <div className="mb-8 border border-zoyd-yellow/20 bg-zoyd-yellow/5 px-5 py-4 text-sm text-white/70">
                    Il te manque <span className="font-display font-black text-zoyd-yellow">{requiredTopUp.toFixed(1)} ZC</span> pour publier cette
                    partie. Ton pass sera bloqué dès la mise en ligne.
                  </div>
                ) : null}

                <div className="flex gap-4">
                  <button onClick={() => setCurrentStep(3)} aria-label="Modifier la configuration" className="flex-1 border border-white/10 py-5 font-display font-black text-xs tracking-widest uppercase opacity-40 hover:opacity-100 flex items-center justify-center gap-2 touch-target">
                    <ChevronLeft className="w-4 h-4" /> Modifier
                  </button>
                  <button onClick={openPublishConfirm} disabled={isSubmitting} aria-label={isArbiterCreator ? 'Publier le match' : 'Verrouiller la mise et publier'} className={`flex-[2] py-5 font-display font-black italic tracking-[0.1em] md:tracking-[0.2em] uppercase transition-all flex items-center justify-center gap-4 touch-target ${isSubmitting ? 'bg-white/50 text-black/50 cursor-not-allowed' : 'bg-white text-black hover:bg-zoyd-yellow'}`}>
                    <span className="text-xs sm:text-sm">{isArbiterCreator ? 'Publier le match' : 'Verrouiller la mise & publier'}</span> <ShieldCheck className="w-6 h-6" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Modal
          isOpen={showPublishConfirm}
          onClose={() => { if (!isSubmitting) setShowPublishConfirm(false); }}
          title="Confirmer la publication"
        >
          <div className="space-y-5">
            <p className="text-sm text-white/70">
              {isArbiterCreator
                ? 'En tant que créateur-arbitre, tu ne bloques aucun pass. Les joueurs paieront leur droit d\'entrée à la jointure.'
                : 'Tu vas bloquer ton pass dès la mise en ligne. Vérifie les montants avant de publier.'}
            </p>
            <dl className="border border-white/10 bg-black/40 divide-y divide-white/5 text-sm">
              <div className="flex items-center justify-between px-4 py-3">
                <dt className="text-white/75">{isArbiterCreator ? 'Ton rôle' : 'Pass bloqué'}</dt>
                <dd className="font-display font-black text-zoyd-yellow">{isArbiterCreator ? 'ARBITRE' : `${selectedPass.toFixed(1)} ZC`}</dd>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <dt className="text-white/75">Cagnotte totale ({playerSlots} joueurs)</dt>
                <dd className="font-display font-black text-white">{livePot.toFixed(1)} ZC</dd>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <dt className="text-white/75">Part arbitre (2 %)</dt>
                <dd className="font-display font-black text-white">{arbiterShare.toFixed(1)} ZC</dd>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <dt className="text-white/75">Part vainqueur</dt>
                <dd className="font-display font-black text-green-400">{winnerShare.toFixed(1)} ZC</dd>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <dt className="text-white/75">{isArbiterCreator ? 'Solde (inchangé, sans pass)' : 'Solde après blocage'}</dt>
                <dd className="font-display font-black text-white">{isArbiterCreator ? `${availableSpend.toFixed(1)} ZC` : `${(availableSpend - selectedPass).toFixed(1)} ZC`}</dd>
              </div>
            </dl>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => setShowPublishConfirm(false)}
                disabled={isSubmitting}
                className="border border-white/10 px-4 py-4 text-xs font-display font-black uppercase tracking-widest text-white/70 hover:text-white transition-colors touch-target"
              >
                Annuler
              </button>
              <button
                onClick={() => void onFinalSubmit()}
                disabled={isSubmitting}
                aria-label="Confirmer et publier la partie"
                className="bg-zoyd-yellow text-black px-4 py-4 text-xs font-display font-black uppercase tracking-widest italic hover:bg-white transition-colors disabled:opacity-50 touch-target"
              >
                {isSubmitting ? 'Publication...' : 'Confirmer et publier'}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
};

const SummaryBox = ({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) => (
  <div className="bg-black border border-white/5 p-6 flex flex-col items-center text-center">
    <span className="text-[10px] font-mono font-black text-white/70 uppercase tracking-[0.2em] mb-3 italic">{label}</span>
    <span className={`font-display font-black text-xl italic uppercase ${highlight ? 'text-zoyd-yellow' : 'text-white'}`}>{value}</span>
  </div>
);

export default CreateMatchPage;
