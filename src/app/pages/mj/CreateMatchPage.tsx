import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, ChevronLeft, Check, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { MJ_FORMATS, MJ_MAP_POOL, MJ_MODE_OPTIONS, getMapImage } from '../../../lib/competition';
import { buildFundingPath, getRequiredTopUp } from '../../../lib/walletFunding';
import { createServerMatch } from '../../lib/matchApi';
import { applyServerAccountState } from '../../lib/serverSync';
import { useAuthStore } from '../../stores/authStore';
import { useMatchStore, type MatchFormat } from '../../stores/matchStore';
import { useWalletStore } from '../../stores/walletStore';
import { SEOHead } from '../../components/SEOHead';

const ENTRY_OPTIONS = [50, 100, 200, 500, 1000];
const WEAPON_OPTIONS = ['Toutes permises', 'Sniper uniquement', 'Assaut / SMG', 'Corps a corps uniquement'];
const ARBITER_FEE_RATE = 0.02;
const TEAM_OPTIONS = [
  { label: 'Squad Alpha', value: 0 },
  { label: 'Squad Bravo', value: 1 },
] as const;

interface MatchFormData {
  entryFee: number;
  maxPlayers: number;
  trustScoreMin: number;
  weaponRestriction: string;
  isPrivate: boolean;
  deviceRestriction?: string;
  controllerRestriction?: string;
  rules?: Record<string, unknown>;
  scheduledAt?: string;
}

const CreateMatchPage: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<Partial<MatchFormData>>({});
  const [selectedFormat, setSelectedFormat] = useState<MatchFormat | ''>('');
  const [selectedGameMode, setSelectedGameMode] = useState('');
  const [selectedMap, setSelectedMap] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const hydrateMatches = useMatchStore((state) => state.hydrateFromServer);
  const { getAvailableToSpend } = useWalletStore();

  const { register, handleSubmit, watch, setValue, getValues } = useForm({
    defaultValues: {
      passAmount: 50,
      trustScoreMin: '0',
      score: 15,
      bestOf: 3,
      isPrivate: false,
      creatorTeam: 0,
      pointstreaks: 'restricted',
      meleeAllowed: true,
    },
  });

  const selectedPass = Number(watch('passAmount') || 0);
  const selectedCreatorTeam = Number(watch('creatorTeam') || 0);
  const availableSpend = getAvailableToSpend();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && currentStep > 1 && !isSubmitting) {
        setCurrentStep((prev) => prev - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, isSubmitting]);

  const playerSlots = useMemo(() => {
    return selectedFormat ? parseInt(selectedFormat.split('VS')[0], 10) * 2 : 2;
  }, [selectedFormat]);

  const livePot = useMemo(() => selectedPass * playerSlots, [playerSlots, selectedPass]);
  const arbiterShare = useMemo(() => livePot * ARBITER_FEE_RATE, [livePot]);
  const winnerShare = useMemo(() => Math.max(0, livePot - arbiterShare), [arbiterShare, livePot]);
  const requiredTopUp = useMemo(() => getRequiredTopUp(selectedPass, availableSpend), [availableSpend, selectedPass]);

  const onStep1Submit = () => {
    if (!selectedFormat) {
      toast.error('Selectionne un format pour continuer.');
      return;
    }

    setFormData((prev) => ({ ...prev, format: selectedFormat }));
    setCurrentStep(2);
  };

  const onStep2Submit = (data: Partial<MatchFormData>) => {
    if (!selectedGameMode || !selectedMap) {
      toast.error('Choisis un mode et une carte.');
      return;
    }

    setFormData((prev) => ({
      ...prev,
      ...data,
      gameMode: selectedGameMode,
      map: selectedMap,
    }));
    setCurrentStep(3);
  };

  const onStep3Submit = (data: Partial<MatchFormData>) => {
    if (!selectedPass || selectedPass <= 0) {
      toast.error('Choisis une mise valide pour continuer.');
      return;
    }

    setFormData((prev) => ({ ...prev, ...data }));
    setCurrentStep(4);
  };

  const onFinalSubmit = async () => {
    if (!user) {
      toast.error('Connecte-toi avant de créer une partie.');
      navigate('/auth/login');
      return;
    }

    if (!selectedFormat || !selectedGameMode || !selectedMap) {
      toast.error('La configuration de la partie est incomplete.');
      return;
    }

    if (selectedPass > availableSpend) {
      toast.error("Solde insuffisant. Recharge d'abord ton wallet pour engager ton pass.");
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

    setIsSubmitting(true);
    try {
      const response = await createServerMatch({
        creatorTeam: Number(getValues('creatorTeam') || 0) === 1 ? 1 : 0,
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
          meleeAllowed: !!getValues('meleeAllowed'),
        },
      });

      hydrateMatches([response.match]);
      applyServerAccountState(response);
      toast.success('Partie publiee. Ta place est reservee.');
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
          {[1, 2, 3, 4].map((step) => (
            <div key={step} className="flex-1 flex flex-col gap-2" aria-current={step === currentStep ? 'step' : undefined}>
              <div className={`h-1.5 transition-all duration-500 ${step <= currentStep ? (step === currentStep ? 'bg-zoyd-yellow' : 'bg-white') : 'bg-white/5'}`} role="progressbar" aria-valuenow={step <= currentStep ? 100 : 0} aria-valuemin={0} aria-valuemax={100} />
              <span className={`text-[10px] font-mono font-black uppercase tracking-[0.2em] ${step === currentStep ? 'text-white' : 'text-white/40'}`}>
                Étape 0{step}
              </span>
            </div>
          ))}
        </nav>

        <AnimatePresence mode="wait">
          {currentStep === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="hud-panel p-6 sm:p-8 md:p-10 bg-zoyd-surface/40">
                <h2 className="text-3xl font-display font-black text-white mb-10 italic uppercase">Choisis le format</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-12">
                  {MJ_FORMATS.map((format) => (
                    <button
                      key={format}
                      onClick={() => setSelectedFormat(format)}
                      aria-label={`Sélectionner le format ${format}`}
                      className={`group relative p-5 sm:p-6 md:p-8 border transition-all ${selectedFormat === format ? 'bg-zoyd-blue border-zoyd-blue text-black' : 'bg-black border-white/5 hover:border-white/20'}`}
                    >
                      <p className={`text-3xl font-display font-black italic ${selectedFormat === format ? 'text-black' : 'text-white/40 group-hover:text-white transition-colors'}`}>
                        {format}
                      </p>
                      {selectedFormat === format && (
                        <div className="absolute top-2 right-2">
                          <Check className="w-4 h-4" />
                        </div>
                      )}
                    </button>
                  ))}
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
                  <h2 className="text-3xl font-display font-black text-white mb-10 italic uppercase">Comment vous allez jouer</h2>

                  <div className="space-y-12">
                    <div>
                      <label className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block underline">
                        01 / Mode de jeu
                      </label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {MJ_MODE_OPTIONS.map((mode) => (
                          <button
                            type="button"
                            key={mode.id}
                            onClick={() => setSelectedGameMode(mode.name)}
                            aria-label={`Sélectionner le mode ${mode.name}`}
                            className={`p-4 border text-left transition-all ${selectedGameMode === mode.name ? 'border-white bg-white/5' : 'border-white/5 hover:border-white/20'}`}
                          >
                            <div className="font-display font-black text-lg italic text-white">{mode.name}</div>
                            <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest">{mode.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block underline">
                        02 / Carte choisie
                      </label>
                      <div className="max-h-[400px] overflow-y-auto pr-1 scrollbar-hide grid grid-cols-2 md:grid-cols-4 gap-3">
                        {MJ_MAP_POOL.map((map) => (
                          <button
                            type="button"
                            key={map}
                            onClick={() => setSelectedMap(map)}
                            aria-label={`Sélectionner la carte ${map}`}
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

                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <label htmlFor="weapons" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block">
                          Restriction d'armes
                        </label>
                        <select id="weapons" {...register('weapons')} aria-label="Restriction d'armes" className="w-full bg-black border border-white/10 p-4 text-xs font-display font-black italic uppercase focus:border-zoyd-blue">
                          {WEAPON_OPTIONS.map((weapon) => (
                            <option key={weapon} value={weapon}>
                              {weapon}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="pointstreaks" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block">
                          Point streaks
                        </label>
                        <select id="pointstreaks" {...register('pointstreaks')} aria-label="Point streaks" className="w-full bg-black border border-white/10 p-4 text-xs font-display font-black italic uppercase focus:border-zoyd-blue">
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
                        <label htmlFor="bestOf" className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block">
                          Best of
                        </label>
                        <input id="bestOf" type="number" {...register('bestOf')} placeholder="3" aria-label="Best of" className="w-full bg-black border border-white/10 p-4 text-xs font-display font-black italic uppercase focus:border-zoyd-blue" />
                      </div>
                    </div>

                    <label htmlFor="meleeAllowed" className="flex items-center gap-4 cursor-pointer group">
                      <div className="w-5 h-5 border-2 border-white/20 flex items-center justify-center group-hover:border-zoyd-blue transition-colors">
                        <input id="meleeAllowed" type="checkbox" {...register('meleeAllowed')} aria-label="Autoriser le corps à corps" className="opacity-0 absolute w-5 h-5 cursor-pointer peer" />
                        <div className="w-2 h-2 bg-zoyd-blue opacity-0 peer-checked:opacity-100 transition-opacity" />
                      </div>
                      <span className="text-[11px] font-display font-black text-white/40 uppercase group-hover:text-white italic">
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
                  <h2 className="text-3xl font-display font-black text-white mb-10 italic uppercase">La Mise (Prize Pool)</h2>

                  <div className="space-y-12 mb-12">
                    <div>
                      <label className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block underline">
                        Mise par joueur
                      </label>
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                        {ENTRY_OPTIONS.map((amount) => (
                          <button
                            key={amount}
                            type="button"
                            onClick={() => setValue('passAmount', amount)}
                            aria-label={`Mise de ${amount} ZC`}
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
                            <span className="text-xs font-display font-black text-white/40 italic">Pot Total (Cagnotte)</span>
                            <span className="font-display font-black text-2xl text-zoyd-yellow">{livePot.toLocaleString()} ZC</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-xs font-display font-black text-white/40 italic">Pour le gagnant</span>
                            <span className="font-display font-black text-xl text-white">{winnerShare.toLocaleString()} ZC</span>
                          </div>
                          <div className="flex justify-between pt-2">
                            <span className="text-xs font-display font-black text-white/40 italic">Commission de l'arbitre</span>
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

                        <div>
                          <label className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-3 block">
                            Ton equipe
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            {TEAM_OPTIONS.map((team) => (
                              <button
                                key={team.value}
                                type="button"
                                onClick={() => setValue('creatorTeam', team.value)}
                                aria-label={`Sélectionner ${team.label}`}
                                className={`p-4 border font-display font-black italic uppercase transition-all ${selectedCreatorTeam === team.value ? 'bg-white text-black border-white' : 'border-white/10 text-white/40 hover:border-white/30'}`}
                              >
                                {team.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <label htmlFor="isPrivate" className="flex items-center gap-4 cursor-pointer group">
                          <div className="w-5 h-5 border-2 border-white/20 flex items-center justify-center group-hover:border-zoyd-blue transition-colors">
                            <input id="isPrivate" type="checkbox" {...register('isPrivate')} aria-label="Partie privée sur invitation" className="opacity-0 absolute w-5 h-5 cursor-pointer peer" />
                            <div className="w-2 h-2 bg-zoyd-blue opacity-0 peer-checked:opacity-100 transition-opacity" />
                          </div>
                          <span className="text-[11px] font-display font-black text-white/40 uppercase group-hover:text-white italic">
                            Partie privee (sur invitation)
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
                      Recapitulatif <ChevronRight className="w-6 h-6" />
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
                    <ShieldCheck className="w-4 h-4" /> Pret a publier
                  </div>
                  <h2 className="text-2xl sm:text-4xl md:text-5xl font-display font-black text-white italic uppercase tracking-tighter">
                    Récapitulatif du Wager
                  </h2>
                </div>

                <div className="grid md:grid-cols-2 gap-4 mb-12">
                  <SummaryBox label="Format" value={selectedFormat || '-'} />
                  <SummaryBox label="Mode / carte" value={`${selectedGameMode || '-'} / ${selectedMap || '-'}`} />
                  <SummaryBox label="Pass" value={`${selectedPass.toFixed(1)} ZC`} highlight />
                  <SummaryBox label="Solde dispo" value={`${availableSpend.toFixed(1)} ZC`} />
                  <SummaryBox label="Armes" value={getValues('weapons') || 'Toutes'} />
                  <SummaryBox label="Ton equipe" value={selectedCreatorTeam === 0 ? 'Squad Alpha' : 'Squad Bravo'} />
                  <SummaryBox label="Visibilite" value={getValues('isPrivate') ? 'Prive' : 'Public'} />
                </div>

                {requiredTopUp > 0 ? (
                  <div className="mb-8 border border-zoyd-yellow/20 bg-zoyd-yellow/5 px-5 py-4 text-sm text-white/70">
                    Il te manque <span className="font-display font-black text-zoyd-yellow">{requiredTopUp.toFixed(1)} ZC</span> pour publier cette
                    partie. Ton pass sera bloque des la mise en ligne.
                  </div>
                ) : null}

                <div className="flex gap-4">
                  <button onClick={() => setCurrentStep(3)} aria-label="Modifier la configuration" className="flex-1 border border-white/10 py-5 font-display font-black text-xs tracking-widest uppercase opacity-40 hover:opacity-100 flex items-center justify-center gap-2 touch-target">
                    <ChevronLeft className="w-4 h-4" /> Modifier
                  </button>
                  <button onClick={onFinalSubmit} disabled={isSubmitting} aria-label="Verrouiller la mise et publier" className={`flex-[2] py-5 font-display font-black italic tracking-[0.1em] md:tracking-[0.2em] uppercase transition-all flex items-center justify-center gap-4 touch-target ${isSubmitting ? 'bg-white/50 text-black/50 cursor-not-allowed' : 'bg-white text-black hover:bg-zoyd-yellow'}`}>
                    <span className="text-xs sm:text-sm">VERROUILLER LA MISE & PUBLIER</span> <ShieldCheck className="w-6 h-6" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const SummaryBox = ({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) => (
  <div className="bg-black border border-white/5 p-6 flex flex-col items-center text-center">
    <span className="text-[10px] font-mono font-black text-white/40 uppercase tracking-[0.2em] mb-3 italic">{label}</span>
    <span className={`font-display font-black text-xl italic uppercase ${highlight ? 'text-zoyd-yellow' : 'text-white'}`}>{value}</span>
  </div>
);

export default CreateMatchPage;
