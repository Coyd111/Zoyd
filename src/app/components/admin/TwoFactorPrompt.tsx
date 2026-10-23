/**
 * TwoFactorPrompt - invite TOTP admin reutilisable (F5).
 *
 * Extrait du pattern de BrArbiterPanel : le seul ecran qui sollicitait un
 * code TOTP. Les autres actions admin sous `requireAdmin2fa` (award, cancel,
 * resolve-dispute du tableau de bord, refund de ligue) partaient en 403 sans
 * invite : l'admin devait aller dans Parametres > Securite, saisir le code,
 * revenir et recliquer - ou, sur le panneau ligue, le bouton restait mort.
 *
 * Contrat : le parent garde un "pending action" (closure du handler d'action)
 * pose au moment ou une reponse serveur arrive en `2FA_REQUIRED`
 * (`ApiError.code`), ouvre cette invite, et rejoue l'action apres
 * `verifyAdmin2fa`. Ce composant possede simplement son champ de saisie : il
 * coupe les non-chiffres, borne a 6, et remonte un code via `onSubmit`.
 *
 * INVARIANT : c'est une BARRIERE SERVEUR (requireAdmin2fa) : le champ ne fait
 * que collecter le code, le serveur fait foi.
 * PIEGE : le code TOTP expire vite (fenetre courte) : renvoyer un vieux code
 * serait refuse. D'ou champ vierge + focus automatique a chaque ouverture.
 *
 * Voir aussi : docs/08-frontend.md - section 5 (Les gardes client)
 */
import React, { useEffect, useRef, useState } from 'react';
import { Shield } from 'lucide-react';

interface TwoFactorPromptProps {
  open: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
  onCancel: () => void;
  /** Texte du bouton de verification, ajuste a l'action ("Verifier et verser", etc.). */
  verifyLabel?: string;
  /** Phrase d'introduction, ajustee a l'action en attente. */
  description?: string;
}

const TwoFactorPrompt: React.FC<TwoFactorPromptProps> = ({
  open,
  submitting,
  error,
  onSubmit,
  onCancel,
  verifyLabel = 'Verifier',
  description,
}) => {
  const [code, setCode] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // A chaque (re)ouverture : champ vierge et focus. Un code residuel d'une
  // tentation precedente, envoye un cycle plus tard, serait refuse : la
  // fenetre TOTP impose un code FRAIS.
  useEffect(() => {
    if (open) {
      setCode('');
      inputRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Verification 2FA requise">
      <div className="bg-zoyd-surface border border-white/10 max-w-md w-full p-6">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(code);
          }}
        >
          <div className="flex items-start gap-4 mb-4">
            <div className="w-12 h-12 rounded-full bg-zoyd-yellow/20 flex items-center justify-center shrink-0">
              <Shield className="w-6 h-6 text-zoyd-yellow" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-white font-display font-black uppercase tracking-widest text-sm mb-2">
                Verification 2FA requise
              </h3>
              <p className="text-white/60 text-sm">
                {description ||
                  "Cette action verse de l'argent : confirme par ton code TOTP admin (6 chiffres)."}
              </p>
            </div>
          </div>
          <label htmlFor="admin-twofa-code" className="sr-only">
            Code TOTP a 6 chiffres
          </label>
          <input
            ref={inputRef}
            id="admin-twofa-code"
            aria-label="Code TOTP à 6 chiffres"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="w-full bg-black/40 border border-white/10 px-3 py-3 text-center font-mono text-lg tracking-[0.5em] text-white focus:border-zoyd-yellow/50 touch-target"
          />
          {error && <p className="text-[10px] font-mono text-red-400 mt-2">{error}</p>}
          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 border border-white/10 px-4 py-3 text-[10px] font-mono font-bold tracking-wider uppercase text-white/60 hover:text-white transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-zoyd-yellow text-black px-4 py-3 text-[10px] font-display font-black uppercase italic tracking-[0.2em] hover:bg-white transition-colors disabled:opacity-40"
            >
              {submitting ? 'Verification...' : verifyLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TwoFactorPrompt;
