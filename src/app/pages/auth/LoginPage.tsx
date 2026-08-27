import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Eye, EyeOff, ShieldCheck, ChevronRight, Lock } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { loginWithBackend } from '../../lib/authApi';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../stores/notificationStore';
import ZoydLogo from '../../components/branding/ZoydLogo';
import { Helmet } from 'react-helmet-async';

const loginSchema = z.object({
  emailOrPseudo: z.string().min(1, 'Email ou pseudo requis'),
  password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caracteres'),
});

type LoginFormData = z.infer<typeof loginSchema>;

const LoginPage: React.FC = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuthStore();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    try {
      const auth = await loginWithBackend(data.emailOrPseudo, data.password);
      
      login(auth.user, auth.token, auth.expiresAt);

      useNotificationStore.getState().addNotification({
        type: 'system',
        title: 'Connexion reussie',
        message: `Content de te revoir, ${auth.user.pseudo} !`,
        priority: 'normal',
        actionUrl: '/',
        metadata: { showToast: true, dedupeKey: 'login-welcome' },
      });

      // Pickup pending registration notifications
      try {
        const pending = JSON.parse(localStorage.getItem('zoyd_pending_notifs') || '[]');
        if (Array.isArray(pending) && pending.length > 0) {
          for (const n of pending) {
            useNotificationStore.getState().addNotification({
              ...n,
              metadata: { showToast: true, dedupeKey: `pending-${n.title}` },
            });
          }
          localStorage.removeItem('zoyd_pending_notifs');
        }
      } catch { /* ignore */ }

      navigate('/');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Connexion impossible.';
      toast.error(errorMessage);
      useNotificationStore.getState().addNotification({
        type: 'system',
        title: 'Echec de connexion',
        message: errorMessage,
        priority: 'high',
        metadata: { showToast: false, dedupeKey: `login-error-${errorMessage}` },
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-zoyd-black flex flex-col lg:flex-row font-ui scanline safe-top">
      <Helmet>
        <title>Connexion — ZOYD</title>
        <meta name="description" content="Connecte-toi à ZOYD, la plateforme compétitive CODM en Afrique." />
      </Helmet>
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <div className="hidden lg:flex lg:w-1/2 relative bg-zoyd-black overflow-hidden">
        <motion.div
          initial={{ opacity: 0, scale: 1.1 }}
          animate={{ opacity: 0.3, scale: 1 }}
          transition={{ duration: 2, ease: 'easeOut' }}
          className="absolute inset-0"
        >
          <img
            src="/assets/images/codm-1.jpg"
            alt=""
            loading="lazy"
            className="w-full h-full object-cover opacity-20 mix-blend-luminosity grayscale pointer-events-none"
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.15 }}
          transition={{ duration: 3, delay: 1 }}
          className="absolute inset-0"
        >
          <img
            src="/assets/images/codm-2.jpg"
            alt=""
            loading="lazy"
            className="w-full h-full object-cover opacity-10 mix-blend-overlay grayscale pointer-events-none"
          />
        </motion.div>

        <div className="absolute inset-0 bg-gradient-to-t from-zoyd-black via-zoyd-black/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-zoyd-black/40 to-transparent" />

        <div className="absolute top-8 right-8 z-10">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-black/40 backdrop-blur-sm border border-white/10">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[9px] font-mono text-white/40 uppercase tracking-widest">En ligne</span>
          </div>
        </div>

        <div className="relative z-10 p-16 flex flex-col justify-end h-full">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="space-y-6 max-w-lg"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-zoyd-blue/10 border border-zoyd-blue/20 text-zoyd-blue text-[10px] font-mono font-black uppercase tracking-[0.2em] italic">
              <ShieldCheck className="w-3.5 h-3.5" />
              Acces securise ZOYD
            </div>

            <h2 className="text-6xl font-display font-black text-white italic uppercase leading-[0.9] tracking-tighter">
              Le champ de <br />
              <span className="text-zoyd-yellow underline decoration-zoyd-yellow/30 underline-offset-8">bataille</span> attend.
            </h2>

            <p className="text-white/40 text-lg font-light leading-relaxed">
              Retrouve ton profil joueur, ton wallet et tes modes de jeu dans le meme espace.
            </p>

            <div className="grid grid-cols-2 gap-8 pt-8 border-t border-white/5">
              <div>
                <div className="text-2xl font-display font-black text-white italic">Profil unique</div>
                <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest mt-1">Compte centralise</div>
              </div>
              <div>
                <div className="text-2xl font-display font-black text-white italic">Wallet integre</div>
                <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest mt-1">Gains et activite</div>
              </div>
            </div>

            <div className="flex items-center gap-4 pt-4">
              <div className="flex -space-x-2">
                {['S1', 'X2', 'ZK'].map((tag, i) => (
                  <div key={tag} className="w-8 h-8 border-2 border-zoyd-black bg-zoyd-surface flex items-center justify-center">
                    <span className="text-[8px] font-display font-black text-white/60 italic">{tag}</span>
                  </div>
                ))}
              </div>
              <div className="text-[10px] font-mono text-white/40">
                <span className="text-white/40 font-black">2,847</span> joueurs actifs
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center px-5 py-10 sm:p-8 relative safe-bottom">
        <img src="/assets/images/codm-3.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-5 mix-blend-luminosity grayscale pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-full max-w-[440px]"
        >
          <div className="lg:hidden mb-12 flex justify-center">
            <Link to="/" className="inline-block group">
              <ZoydLogo className="group-hover:opacity-90 transition-opacity" />
            </Link>
          </div>

          <header className="mb-10">
            <h1 className="text-4xl font-display font-black text-white uppercase italic tracking-tighter mb-2">
              Identification
            </h1>
            <p className="text-white/40 font-mono text-[11px] uppercase tracking-widest flex items-center gap-2">
              <Lock className="w-3 h-3" /> Acces joueur securise
            </p>
          </header>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-4">
              <Input
                label="Email, telephone ou pseudo"
                autoComplete="username"
                inputMode="text"
                {...register('emailOrPseudo', { required: 'Identification requise' })}
                error={errors.emailOrPseudo?.message}
                placeholder="ShadowX, +22960000000 ou soldat@zoyd.com"
              />

              <div className="relative">
                <Input
                  label="Mot de passe"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  {...register('password', { required: 'Mot de passe requis' })}
                  error={errors.password?.message}
                  placeholder="........"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  className="absolute right-2 top-8 touch-target flex items-center justify-center text-white/40 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              fullWidth
              size="lg"
              className="py-6 font-display font-black italic tracking-widest text-lg group overflow-hidden relative"
              disabled={isLoading}
            >
              {isLoading ? (
                <div className="w-6 h-6 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              ) : (
                <>
                  CONNEXION <ChevronRight className="w-6 h-6 ml-2 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </Button>

            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/5" />
              </div>
              <div className="relative flex justify-center">
                <span className="px-4 bg-zoyd-black text-[9px] font-mono text-white/40 uppercase tracking-widest">
                  Autres options
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <Button type="button" variant="ghost" fullWidth className="border-white/5 text-white/60 font-mono text-[10px] tracking-widest">
                CONTINUER AVEC GOOGLE
              </Button>
              <Button type="button" variant="ghost" fullWidth className="border-white/5 text-white/60 font-mono text-[10px] tracking-widest">
                CONNEXION PAR NUMERO
              </Button>
            </div>
          </form>

          <footer className="mt-12 text-center border-t border-white/5 pt-8">
            <p className="text-white/40 text-[11px] font-mono uppercase tracking-widest">
              Pas encore de compte ?{' '}
              <Link to="/auth/register" className="text-zoyd-yellow hover:text-white transition-colors font-black italic ml-2">
                CREER MON COMPTE
              </Link>
            </p>
          </footer>
        </motion.div>
      </div>
    </div>
  );
};

export default LoginPage;
