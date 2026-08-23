import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react';
import { activateAccount } from '../../lib/authApi';

const ActivatePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const initialEmail = location.state?.email || '';
  
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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

  return (
    <div className="min-h-dvh bg-zoyd-black flex flex-col items-center justify-center p-5 relative font-ui scanline safe-top safe-bottom">
      <img src="/assets/images/hero/warzone-05.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-luminosity grayscale pointer-events-none" />
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

        <div className="bg-zoyd-surface border border-white/10 p-8">
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 bg-zoyd-yellow/10 flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-zoyd-yellow" />
            </div>
          </div>

          <h1 className="text-3xl font-display font-black text-white text-center mb-2 uppercase italic">
            Active ton compte
          </h1>
          <p className="text-white/40 text-center text-sm mb-8">
            Entre le code d'activation envoye a ton email
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
              <label className="text-[10px] font-mono text-white/40 uppercase mb-2 block">
                Code d'activation (6 chiffres)
              </label>
              <Input
                type="text"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                aria-label="Code d'activation"
                className="bg-black border border-white/10 text-white text-center text-2xl tracking-widest"
                inputMode="numeric"
                maxLength={6}
                required
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading || code.length !== 6}
              className="w-full bg-white text-black py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-zoyd-yellow transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Activation en cours...' : 'Activer mon compte'}
            </Button>
          </form>

          <p className="text-white/20 text-xs text-center mt-6">
            Le code expire dans 15 minutes. Verifie tes spams.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ActivatePage;
