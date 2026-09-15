import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import { requestPasswordReset, resetPasswordWithCode } from '../../lib/authApi';
import { SEOHead } from '../../components/SEOHead';

const ForgotPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [devCode, setDevCode] = useState('');

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || isRequesting) return;
    setIsRequesting(true);
    try {
      const response = await requestPasswordReset(identifier.trim());
      if (response.resetCode) setDevCode(response.resetCode);
      setCodeSent(true);
      toast.success(response.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Demande impossible.');
    } finally {
      setIsRequesting(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('Les mots de passe ne correspondent pas.');
      return;
    }
    if (isResetting) return;
    setIsResetting(true);
    try {
      const response = await resetPasswordWithCode(identifier.trim(), code, newPassword);
      toast.success(response.message);
      navigate('/auth/login');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Reinitialisation impossible.');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-zoyd-black flex flex-col items-center justify-center p-5 relative font-ui scanline safe-top safe-bottom">
      <SEOHead
        title="Mot de passe oublié — ZOYD"
        description="Reinitialise ton mot de passe ZOYD avec un code de verification."
        path="/auth/forgot"
        noindex
      />
      <img src="/assets/images/codm-5.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-luminosity grayscale pointer-events-none" />
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        <Button variant="ghost" onClick={() => navigate('/auth/login')} className="mb-6 text-white/40 hover:text-white">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Retour connexion
        </Button>

        <div className="bg-zoyd-surface border border-white/10 p-5 sm:p-8">
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 bg-zoyd-yellow/10 flex items-center justify-center">
              {codeSent ? <ShieldCheck className="w-8 h-8 text-zoyd-yellow" /> : <KeyRound className="w-8 h-8 text-zoyd-yellow" />}
            </div>
          </div>

          <h1 className="text-2xl sm:text-3xl font-display font-black text-white text-center mb-2 uppercase italic">
            Mot de passe oublié
          </h1>
          <p className="text-white/60 text-center text-sm mb-8">
            {codeSent
              ? 'Entre le code recu puis choisis un nouveau mot de passe.'
              : 'Indique ton pseudo, email ou numero. Tu recevras un code de verification.'}
          </p>

          {!codeSent ? (
            <form onSubmit={handleRequest} className="space-y-4">
              <div>
                <label htmlFor="forgot-identifier" className="text-[10px] font-mono text-white/40 uppercase mb-2 block">
                  Pseudo, email ou numero
                </label>
                <Input
                  id="forgot-identifier"
                  type="text"
                  placeholder="Ton identifiant"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="bg-black border border-white/10 text-white"
                  autoComplete="username"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={isRequesting || !identifier.trim()}
                className="w-full bg-white text-black py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-zoyd-yellow transition-colors disabled:opacity-50"
              >
                {isRequesting ? 'Envoi en cours...' : 'Recevoir le code'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label htmlFor="reset-code" className="text-[10px] font-mono text-white/40 uppercase mb-2 block">
                  Code de verification (8 chiffres)
                </label>
                <Input
                  id="reset-code"
                  type="text"
                  placeholder="12345678"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  className="bg-black border border-white/10 text-white text-center text-2xl tracking-widest"
                  inputMode="numeric"
                  maxLength={8}
                  required
                />
              </div>
              <div>
                <label htmlFor="reset-password" className="text-[10px] font-mono text-white/40 uppercase mb-2 block">
                  Nouveau mot de passe
                </label>
                <Input
                  id="reset-password"
                  type="password"
                  placeholder="8+ caracteres, majuscule, chiffre, special"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="bg-black border border-white/10 text-white"
                  autoComplete="new-password"
                  required
                />
              </div>
              <div>
                <label htmlFor="reset-confirm" className="text-[10px] font-mono text-white/40 uppercase mb-2 block">
                  Confirmer le mot de passe
                </label>
                <Input
                  id="reset-confirm"
                  type="password"
                  placeholder="Repete le mot de passe"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="bg-black border border-white/10 text-white"
                  autoComplete="new-password"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={isResetting || code.length !== 8 || !newPassword || newPassword !== confirmPassword}
                className="w-full bg-white text-black py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-zoyd-yellow transition-colors disabled:opacity-50"
              >
                {isResetting ? 'Reinitialisation...' : 'Reinitialiser'}
              </Button>
              <button
                type="button"
                onClick={() => { setCodeSent(false); setCode(''); setDevCode(''); }}
                className="w-full text-sm text-white/40 hover:text-white transition-colors touch-target py-2"
              >
                Utiliser un autre identifiant
              </button>
            </form>
          )}

          {import.meta.env.DEV && devCode ? (
            <div className="mt-4 border border-zoyd-yellow/30 bg-zoyd-yellow/5 px-4 py-3 text-center" role="status">
              <p className="text-[10px] font-mono uppercase tracking-widest text-zoyd-yellow mb-1">Mode dev — code reçu</p>
              <p className="font-display font-black text-2xl tracking-[0.3em] text-white">{devCode}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
