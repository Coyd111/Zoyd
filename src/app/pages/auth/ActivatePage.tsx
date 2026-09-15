import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react';
import { activateAccount, resendActivationCode, changeActivationEmail } from '../../lib/authApi';
import { SEOHead } from '../../components/SEOHead';

const RESEND_COOLDOWN_SECONDS = 60;

const ActivatePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const initialEmail = location.state?.email || '';
  const initialDevCode = location.state?.devCode || '';

  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [showEmailChange, setShowEmailChange] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [isChangingEmail, setIsChangingEmail] = useState(false);
  const [devCode, setDevCode] = useState(initialDevCode);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await activateAccount(email, code);

      if (response.ok) {
        toast.success(response.message);
        navigate('/auth/login');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Activation impossible.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email || isResending || resendCooldown > 0) return;
    setIsResending(true);
    try {
      const response = await resendActivationCode(email);
      if (response.activationCode) setDevCode(response.activationCode);
      toast.success(response.message);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Renvoi impossible.');
    } finally {
      setIsResending(false);
    }
  };

  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || isChangingEmail) return;
    setIsChangingEmail(true);
    try {
      const response = await changeActivationEmail(email, newEmail.trim());
      setEmail(newEmail.trim());
      setNewEmail('');
      setShowEmailChange(false);
      if (response.activationCode) setDevCode(response.activationCode);
      toast.success(response.message);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Changement d\'email impossible.');
    } finally {
      setIsChangingEmail(false);
    }
  };

  return (
    <div className="min-h-dvh bg-zoyd-black flex flex-col items-center justify-center p-5 relative font-ui scanline safe-top safe-bottom">
      <SEOHead
        title="Activation — ZOYD"
        description="Active ton compte ZOYD avec le code reçu par email."
        path="/auth/activate"
        noindex
      />
      <img src="/assets/images/codm-5.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-luminosity grayscale pointer-events-none" />
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />
      
      <div className="w-full max-w-md relative z-10">
        <Button
          variant="ghost"
          onClick={() => navigate(-1)}
          className="mb-6 text-white/40 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Retour
        </Button>

        <div className="bg-zoyd-surface border border-white/10 p-5 sm:p-8">
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 bg-zoyd-yellow/10 flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-zoyd-yellow" />
            </div>
          </div>

          <h1 className="text-2xl sm:text-3xl font-display font-black text-white text-center mb-2 uppercase italic">
            Active ton compte
          </h1>
          <p className="text-white/40 text-center text-sm mb-8">
            Entre le code d'activation envoyé à ton email
          </p>

          <form onSubmit={handleActivate} className="space-y-4">
            {initialEmail ? (
              <div className="bg-white/5 border border-white/10 p-4 flex items-center gap-3">
                <Mail className="w-5 h-5 text-zoyd-yellow" />
                <div>
                  <p className="text-[10px] font-mono text-white/40 uppercase">Email</p>
                  <p className="text-white text-sm">{email}</p>
                </div>
              </div>
            ) : (
              <div>
                <label className="text-[10px] font-mono text-white/40 uppercase mb-2 block">
                  Email
                </label>
                <Input
                  type="email"
                  placeholder="ton@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-label="Email"
                  className="bg-black border border-white/10 text-white"
                  required
                />
              </div>
            )}

            <div>
              <label htmlFor="activation-code" className="text-[10px] font-mono text-white/40 uppercase mb-2 block">
                Code d'activation (8 chiffres)
              </label>
              <Input
                id="activation-code"
                type="text"
                placeholder="12345678"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                aria-label="Code d'activation"
                className="bg-black border border-white/10 text-white text-center text-2xl tracking-widest"
                inputMode="numeric"
                maxLength={8}
                required
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading || code.length !== 8}
              className="w-full bg-white text-black py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-zoyd-yellow transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Activation en cours...' : 'Activer mon compte'}
            </Button>
          </form>

          {import.meta.env.DEV && devCode ? (
            <div className="mt-4 border border-zoyd-yellow/30 bg-zoyd-yellow/5 px-4 py-3 text-center" role="status">
              <p className="text-[10px] font-mono uppercase tracking-widest text-zoyd-yellow mb-1">Mode dev — code reçu</p>
              <p className="font-display font-black text-2xl tracking-[0.3em] text-white">{devCode}</p>
            </div>
          ) : null}

          <div className="mt-6 space-y-3 border-t border-white/10 pt-6">
            <button
              type="button"
              onClick={() => void handleResend()}
              disabled={isResending || resendCooldown > 0 || !email}
              className="w-full text-sm text-white/70 hover:text-white transition-colors disabled:opacity-40 touch-target py-2"
            >
              {isResending
                ? 'Envoi en cours...'
                : resendCooldown > 0
                  ? `Renvoyer le code dans ${resendCooldown}s`
                  : "Je n'ai pas reçu le code — renvoyer"}
            </button>
            {showEmailChange ? (
              <form onSubmit={handleChangeEmail} className="space-y-3">
                <label htmlFor="new-email" className="text-[10px] font-mono text-white/40 uppercase block">
                  Nouvel email
                </label>
                <Input
                  id="new-email"
                  type="email"
                  placeholder="nouvel@email.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="bg-black border border-white/10 text-white"
                  required
                />
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setShowEmailChange(false)}
                    className="border border-white/10 px-4 py-3 text-xs font-display font-black uppercase tracking-widest text-white/60 hover:text-white transition-colors touch-target"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={isChangingEmail || !newEmail.trim()}
                    className="bg-white text-black px-4 py-3 text-xs font-display font-black uppercase tracking-widest italic hover:bg-zoyd-yellow transition-colors disabled:opacity-50 touch-target"
                  >
                    {isChangingEmail ? 'En cours...' : 'Valider'}
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setShowEmailChange(true)}
                className="w-full text-sm text-white/40 hover:text-white transition-colors touch-target py-2"
              >
                Utiliser une autre adresse email
              </button>
            )}
          </div>

          <p className="text-white/40 text-xs text-center mt-6">
            Le code expire dans 15 minutes. Verifie tes spams.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ActivatePage;
