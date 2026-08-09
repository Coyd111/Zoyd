import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  Eye,
  EyeOff,
  Smartphone,
  Tablet,
  Monitor,
  Gamepad2,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  Zap,
  Globe,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import {
  CODM_RANKS,
  CONTROLLER_OPTIONS,
  COUNTRY_OPTIONS,
  DEVICE_OPTIONS,
} from '../../../lib/competition';
import { registerWithBackend, type RegisterPayload } from '../../lib/authApi';
import ZoydLogo from '../../components/branding/ZoydLogo';

const step1Schema = z
  .object({
    pseudo: z.string().min(3, 'Minimum 3 caracteres').max(20, 'Maximum 20 caracteres'),
    email: z.string().email('Email invalide'),
    phone: z.string().min(8, 'Numero invalide'),
    password: z.string().min(8, 'Minimum 8 caracteres'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['confirmPassword'],
  });

const step2Schema = z.object({
  gameId: z.string().min(1, 'UID CODM requis'),
  levelCODM: z.coerce.number().min(1, 'Niveau invalide').optional(),
  rankMJ: z.string().optional(),
  rankBR: z.string().optional(),
  country: z.string().optional(),
  streamerPseudo: z.string().optional(),
});

const deviceIcons: Record<string, React.ElementType> = {
  phone: Smartphone,
  tablet: Tablet,
  pc: Monitor,
  other: Gamepad2,
};

const controllerIcons: Record<string, React.ElementType> = {
  touch: Smartphone,
  controller: Gamepad2,
  emulator: Monitor,
  pc: Monitor,
  other: Globe,
};

const RegisterPage: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<Partial<RegisterPayload>>({});
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const navigate = useNavigate();
  const { login } = useAuthStore();

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
    getValues,
  } = useForm<Partial<RegisterPayload>>({
    resolver: currentStep === 1 ? zodResolver(step1Schema) : currentStep === 2 ? zodResolver(step2Schema) : undefined,
    defaultValues: {
      controllerType: 'touch',
      country: 'Benin',
      rankMJ: 'Rookie',
      rankBR: 'Rookie',
      streamerMode: false,
    },
  });

  const password = watch('password', '');
  const selectedController = watch('controllerType', 'touch');
  const streamerModeEnabled = watch('streamerMode', false);

  const getPasswordStrength = (pwd: string) => {
    if (!pwd) return 0;
    let strength = 0;
    if (pwd.length >= 8) strength++;
    if (pwd.length >= 12) strength++;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) strength++;
    if (/\d/.test(pwd)) strength++;
    return strength;
  };

  const passwordStrength = getPasswordStrength(password);
  const strengthLabels = ['', 'Faible', 'Moyen', 'Fort', 'Elite'];

  const onStep1Submit = (data: Partial<RegisterPayload>) => {
    setFormData((prev) => ({ ...prev, ...data }));
    setCurrentStep(2);
  };

  const onStep2Submit = (data: Partial<RegisterPayload>) => {
    if (!selectedDevice) {
      toast.error("Choisis ton appareil principal pour personnaliser ton experience ZOYD.");
      return;
    }

    if (!data.gameId?.trim()) {
      toast.error('Renseigne ton UID CODM avant de continuer.');
      return;
    }

    setFormData((prev) => ({
      ...prev,
      ...data,
      gameId: data.gameId.trim(),
      device: selectedDevice as RegisterPayload['device'],
      controllerType: (data.controllerType || getValues('controllerType') || 'touch') as RegisterPayload['controllerType'],
    }));
    setCurrentStep(3);
  };

  const onFinalSubmit = async () => {
    setIsLoading(true);
    try {
      const auth = await registerWithBackend({
        pseudo: formData.pseudo,
        email: formData.email,
        phone: formData.phone,
        password: formData.password,
        gameId: formData.gameId,
        controllerType: formData.controllerType || 'touch',
        device: formData.device || 'phone',
        levelCODM: Number(formData.levelCODM) || 1,
        rankMJ: formData.rankMJ || 'Rookie',
        rankBR: formData.rankBR || 'Rookie',
        country: formData.country || 'Benin',
        streamerMode: Boolean(formData.streamerMode),
        streamerPseudo: formData.streamerMode ? formData.streamerPseudo : '',
      });

      login(auth.user, auth.token, auth.expiresAt);
      toast.success('Compte active. Bienvenue sur ZOYD.');
      navigate('/mode');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Inscription impossible.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zoyd-black flex flex-col lg:flex-row font-ui">
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <div className="hidden lg:flex lg:w-1/2 relative bg-zoyd-black overflow-hidden">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.3 }} className="absolute inset-0">
          <img
            src="/assets/illustrations/operator_ghost.jpg"
            alt="Call of Duty Mobile Operator"
            className="w-full h-full object-cover opacity-80 mix-blend-luminosity grayscale transition-opacity duration-1000"
          />
        </motion.div>

        <div className="absolute inset-0 bg-gradient-to-t from-zoyd-black via-zoyd-black/60 to-transparent" />

        <div className="relative z-10 p-16 flex flex-col justify-end h-full">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 max-w-lg">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-zoyd-yellow/10 border border-zoyd-yellow/20 text-zoyd-yellow text-[10px] font-mono font-black uppercase tracking-[0.2em] italic">
              <Zap className="w-3.5 h-3.5" />
              Profil joueur ZOYD
            </div>
            <h2 className="text-6xl font-display font-black text-white italic uppercase leading-[0.9] tracking-tighter">
              Entre sur <br />
              <span className="text-zoyd-blue underline decoration-zoyd-blue/30 underline-offset-8">la plateforme</span>.
            </h2>
            <p className="text-white/40 text-lg font-light">
              Cree ton compte, configure ton profil CODM et prepare ton entree dans l'univers ZOYD.
            </p>
          </motion.div>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 relative">
        <div className="w-full max-w-[560px]">
          <header className="mb-10">
            <div className="flex items-center justify-between mb-8">
              <Link to="/" className="flex items-center gap-2 group">
                <ZoydLogo compact className="group-hover:opacity-90 transition-opacity" />
              </Link>
              <div className="flex gap-1.5">
                {[1, 2, 3].map((step) => (
                  <div
                    key={step}
                    className={`h-1 w-8 rounded-full transition-all duration-500 ${
                      step <= currentStep ? (step === currentStep ? 'bg-zoyd-yellow w-12' : 'bg-zoyd-blue') : 'bg-white/5'
                    }`}
                  />
                ))}
              </div>
            </div>
            <h1 className="text-3xl font-display font-black text-white uppercase italic tracking-tighter">
              {currentStep === 1 ? 'Creer un compte' : currentStep === 2 ? 'Configuration joueur' : 'Finalisation'}
            </h1>
            <p className="text-white/40 font-mono text-[10px] uppercase tracking-widest mt-1">Etape 0{currentStep} / 03</p>
          </header>

          <AnimatePresence mode="wait">
            {currentStep === 1 && (
              <motion.form
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                onSubmit={handleSubmit(onStep1Submit)}
                className="space-y-4"
              >
                <Input
                  label="Pseudo CODM"
                  {...register('pseudo')}
                  error={errors.pseudo?.message}
                  placeholder="ShadowX"
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Email"
                    type="email"
                    {...register('email')}
                    error={errors.email?.message}
                    placeholder="soldat@zoyd.com"
                  />
                  <Input
                    label="Telephone"
                    type="tel"
                    {...register('phone')}
                    error={errors.phone?.message}
                    placeholder="+229 60 00 00 00"
                  />
                </div>

                <div className="relative">
                  <Input
                    label="Mot de passe"
                    type={showPassword ? 'text' : 'password'}
                    {...register('password')}
                    error={errors.password?.message}
                    placeholder="........"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-10 text-white/20 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  {password && (
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex gap-1 flex-1 max-w-[120px]">
                        {[1, 2, 3, 4].map((index) => (
                          <div key={index} className={`h-1 flex-1 rounded-full ${index <= passwordStrength ? 'bg-zoyd-blue' : 'bg-white/5'}`} />
                        ))}
                      </div>
                      <span className="text-[9px] font-mono text-white/40 uppercase tracking-widest">
                        {strengthLabels[passwordStrength]}
                      </span>
                    </div>
                  )}
                </div>

                <Input
                  label="Confirmation du mot de passe"
                  type="password"
                  {...register('confirmPassword')}
                  error={errors.confirmPassword?.message}
                  placeholder="........"
                />

                <Button type="submit" variant="primary" fullWidth size="lg" className="py-6 mt-6">
                  CONTINUER <ChevronRight className="w-5 h-5 ml-2" />
                </Button>
              </motion.form>
            )}

            {currentStep === 2 && (
              <motion.form
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                onSubmit={handleSubmit(onStep2Submit)}
                className="space-y-6"
              >
                <div>
                  <label className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block underline">
                    01 / Type d'appareil
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {DEVICE_OPTIONS.map((device) => {
                      const Icon = deviceIcons[device.id];
                      return (
                        <button
                          key={device.id}
                          type="button"
                          onClick={() => setSelectedDevice(device.id)}
                          className={`p-4 border transition-all flex flex-col items-center gap-2 ${
                            selectedDevice === device.id
                              ? 'bg-white text-black border-white'
                              : 'bg-zoyd-surface/20 border-white/5 text-white/40 hover:border-white/20'
                          }`}
                        >
                          <Icon className="w-6 h-6" />
                          <span className="text-[9px] font-mono font-black uppercase">{device.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-mono font-black text-zoyd-blue tracking-widest uppercase mb-4 block underline">
                    02 / Type de controle
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {CONTROLLER_OPTIONS.map((option) => {
                      const Icon = controllerIcons[option.id];
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setValue('controllerType', option.id)}
                          className={`p-4 border text-left transition-all ${
                            selectedController === option.id
                              ? 'bg-white text-black border-white'
                              : 'bg-zoyd-surface/20 border-white/5 text-white/40 hover:border-white/20'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <Icon className="w-5 h-5" />
                            <div>
                              <div className="text-[9px] font-mono font-black uppercase tracking-widest">{option.id}</div>
                              <div className="text-xs font-display font-black italic uppercase">{option.label}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="ID CODM (UID obligatoire)"
                    {...register('gameId')}
                    placeholder="6742..."
                  />
                  <Input label="Niveau actuel du compte" type="number" {...register('levelCODM')} placeholder="150" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-mono font-black text-white/40 uppercase mb-2 block tracking-widest">Grade MJ</label>
                    <select {...register('rankMJ')} className="w-full bg-transparent border-0 border-b border-white/20 p-3 text-xs font-display font-black italic uppercase text-white focus:outline-none focus:border-zoyd-blue">
                      {CODM_RANKS.map((rank) => (
                        <option key={rank} value={rank} className="bg-zoyd-black">
                          {rank}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-mono font-black text-white/40 uppercase mb-2 block tracking-widest">Grade BR</label>
                    <select {...register('rankBR')} className="w-full bg-transparent border-0 border-b border-white/20 p-3 text-xs font-display font-black italic uppercase text-white focus:outline-none focus:border-zoyd-blue">
                      {CODM_RANKS.map((rank) => (
                        <option key={rank} value={rank} className="bg-zoyd-black">
                          {rank}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-mono font-black text-white/40 uppercase mb-2 block tracking-widest">Pays</label>
                    <select {...register('country')} className="w-full bg-transparent border-0 border-b border-white/20 p-3 text-xs font-display font-black italic uppercase text-white focus:outline-none focus:border-zoyd-blue">
                      {COUNTRY_OPTIONS.map((country) => (
                        <option key={country} value={country} className="bg-zoyd-black">
                          {country}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-3 border border-white/10 px-4 py-3 bg-transparent">
                    <input id="streamerMode" type="checkbox" {...register('streamerMode')} className="w-4 h-4 accent-zoyd-yellow" />
                    <label htmlFor="streamerMode" className="text-[10px] font-mono font-black uppercase tracking-widest text-white/60">
                      Activer le pseudo streamer
                    </label>
                  </div>
                </div>

                {streamerModeEnabled && (
                  <Input
                    label="Pseudo streamer"
                    {...register('streamerPseudo')}
                    placeholder="ShadowXTV"
                  />
                )}

                <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">
                  Ces informations servent a personnaliser ton experience de jeu, sans etre exposees publiquement.
                </p>

                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(1)}
                    className="flex-1 border border-white/10 py-5 font-display font-black text-[10px] tracking-widest uppercase opacity-40 hover:opacity-100 flex items-center justify-center gap-2 transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" /> RETOUR
                  </button>
                  <Button type="submit" variant="primary" fullWidth size="lg" className="flex-[2]" disabled={!selectedDevice}>
                    VERIFIER LA CONFIG <ChevronRight className="w-5 h-5 ml-2" />
                  </Button>
                </div>
              </motion.form>
            )}

            {currentStep === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-8 text-center"
              >
                <div className="relative inline-block">
                  <div className="w-24 h-24 border-2 border-green-500 rounded-full flex items-center justify-center bg-green-500/10">
                    <ShieldCheck className="w-12 h-12 text-green-500" />
                  </div>
                  <motion.div
                    animate={{ scale: [1, 1.2, 1], opacity: [0, 0.5, 0] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="absolute inset-0 border-2 border-green-500 rounded-full"
                  />
                </div>

                <div>
                  <h2 className="text-3xl font-display font-black text-white uppercase italic tracking-tighter">Profil pret</h2>
                  <p className="text-white/40 font-mono text-[11px] uppercase tracking-widest mt-2">
                    Compte #{formData.pseudo || 'ZOYD'} pret pour ZOYD
                  </p>
                </div>

                <div className="hud-panel p-6 bg-zoyd-surface/20 border-white/5 text-left space-y-4">
                  <div className="flex justify-between items-center border-b border-white/20 pb-2">
                    <span className="text-[10px] font-mono text-white/20 uppercase tracking-widest">Identite</span>
                    <span className="text-xs font-display font-black text-white italic uppercase">{formData.pseudo}</span>
                  </div>
                  <div className="flex justify-between items-center border-b border-white/20 pb-2">
                    <span className="text-[10px] font-mono text-white/20 uppercase tracking-widest">Appareil principal</span>
                    <span className="text-xs font-display font-black text-zoyd-blue italic uppercase">{formData.device}</span>
                  </div>
                  <div className="flex justify-between items-center border-b border-white/20 pb-2">
                    <span className="text-[10px] font-mono text-white/20 uppercase tracking-widest">Controle</span>
                    <span className="text-xs font-display font-black text-white italic uppercase">{formData.controllerType || 'touch'}</span>
                  </div>
                  <div className="flex justify-between items-center border-b border-white/20 pb-2">
                    <span className="text-[10px] font-mono text-white/20 uppercase tracking-widest">Pays</span>
                    <span className="text-xs font-display font-black text-white italic uppercase">{formData.country || 'Benin'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-mono text-white/20 uppercase tracking-widest">Mode streamer</span>
                    <span className="text-xs font-display font-black text-zoyd-yellow italic uppercase">
                      {formData.streamerMode ? 'Active' : 'Desactive'}
                    </span>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(2)}
                    className="flex-1 border border-white/10 py-5 font-display font-black text-[10px] tracking-widest uppercase opacity-40 hover:opacity-100 flex items-center justify-center gap-2 transition-all"
                  >
                    REGLAGES
                  </button>
                  <Button
                    type="button"
                    onClick={onFinalSubmit}
                    variant="primary"
                    fullWidth
                    size="lg"
                    className="flex-[2] py-6"
                    disabled={isLoading}
                  >
                    {isLoading ? <div className="w-6 h-6 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : 'ACTIVER MON COMPTE'}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <footer className="mt-12 text-center border-t border-white/5 pt-8">
            <p className="text-white/40 text-[11px] font-mono uppercase tracking-widest">
              Deja membre ?{' '}
              <Link to="/auth/login" className="text-zoyd-yellow hover:text-white transition-colors font-black italic ml-2">
                ME CONNECTER
              </Link>
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
