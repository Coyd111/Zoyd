/**
 * IntegrityCovenantModal — le Serment d'intégrité (3 écrans, P0-1 UI/UX).
 *
 * Plein écran, fermable par "Découvrir l'arène d'abord" — affiché par le
 * gate d'AppLayout en bannière + modale (jamais bloquant avant le 1er match).
 * Une seule fois par compte, au login, à la demande du joueur.
 *
 * INVARIANT : les réponses ne partent JAMAIS vers le serveur. Le seul
 * contenu transmis est `{ version, report? }` au moment du scellement
 * (écran 3) : `report` porte le pseudo suspect, optionnel. Côté base, seule la
 * date d'acceptation est consignée (user.covenant).
 * INVARIANT : tonalité solennelle, JAMAIS inquisitionnelle.
 * INVARIANT : la date est posée par le SERVEUR (POST /api/auth/covenant).
 *
 * Voir aussi : AppLayout.tsx (bannière), lib/authApi.ts (COVENANT_VERSION,
 * submitCovenant), server/routes/auth.mjs (POST /api/auth/covenant).
 */
import { useCallback, useState } from 'react';
import { COVENANT_VERSION, submitCovenant } from '../../lib/authApi';
import { useAuthStore } from '../../stores/authStore';

type ScreenId = 's1' | 's2' | 's3';

const SCREENS: Record<ScreenId, { kicker: string; title: string; body: string[] }> = {
  s1: {
    kicker: 'Le serment',
    title: 'Gagner au plein jeu',
    body: [
      'Une victoire qui ne vient pas de toi ne raconte rien. Elle se gagne sans aimant, sans script, sans outil interdit, sans compte fantôme.',
      'Promets-tu de gagner à force de jeu — et de jouer fair-play envers l’adversaire et envers toi-même, même sans témoin ?',
    ],
  },
  s2: {
    kicker: 'À lire',
    title: 'Ce que le serment protège',
    body: [
      'Ton nom : chaque victoire porte ta signature.',
      "L'arène : elle vaut parce que chacun joue selon les mêmes règles.",
      'Sans privilège : on te protège tant que ton nom reste net — surveillance, exclusion temporaire puis définitive si la règle est rompue.',
      'Tu peux aussi signaler un tricheur en bas, en anonyme, si tu en connais un.',
    ],
  },
  s3: {
    kicker: 'Sceau',
    title: 'Entre dans l’arène',
    body: [
      "La date de ce serment est marquée sur ton compte par nos serveurs — pas par ton navigateur.",
      'Elle s’affichera sur ton profil : ton sceau d’intégrité. Rien n’a changé ici : même solde, même rang — ce qui a changé, tu le sais.',
    ],
  },
};

export const IntegrityCovenantModal = ({ onClose }: { onClose?: () => void }) => {
  const [screen, setScreen] = useState<ScreenId>('s1');
  const [showReport, setShowReport] = useState(false);
  const [reportPseudo, setReportPseudo] = useState('');
  const [reportNote, setReportNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const updateUser = useAuthStore((s) => s.updateUser);
  const content = SCREENS[screen];
  const step = screen === 's1' ? 1 : screen === 's2' ? 2 : 3;

  const sealCovenant = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const pseudo = reportPseudo.trim();
      const report = showReport && pseudo.length > 0
        ? { pseudo, note: reportNote.trim() || undefined }
        : undefined;
      const result = await submitCovenant(COVENANT_VERSION, report);
      if (result?.user?.covenant) {
        updateUser({ covenant: result.user.covenant });
      }
      onClose?.();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Le scellement a échoué. Réessaie.');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, showReport, reportPseudo, reportNote, updateUser, onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] bg-zoyd-black scanline overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Serment d'intégrité"
    >
      <div className="pointer-events-none fixed inset-0 tactical-grid opacity-10" />
      <div className="relative min-h-dvh flex flex-col safe-top">
        <header className="border-b border-white/10 bg-zoyd-black px-4 pt-6">
          <p className="text-[10px] font-mono tracking-widest text-white/60 uppercase">
            Serment d’intégrité — {COVENANT_VERSION}
          </p>
          <div className="mt-3 h-px w-full bg-white/10">
            <div
              className="h-px bg-zoyd-yellow transition-all duration-300"
              style={{ width: `${(step / 3) * 100}%` }}
            />
          </div>
        </header>

        <main className="flex-1 w-full max-w-xl mx-auto px-4 py-8">
          <p className="text-[10px] font-mono tracking-widest text-white/60 uppercase">
            Étape {step}/3 — {content.kicker}
          </p>
          <h2 className="mt-2 font-display font-black uppercase italic tracking-tighter text-3xl text-white">
            {content.title}
          </h2>
          <div className="mt-6 space-y-4">
            {content.body.map((line) => (
              <p key={line} className="text-base leading-relaxed text-white/90">
                {line}
              </p>
            ))}
          </div>

          {screen === 's2' && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setShowReport((v) => !v)}
                className="text-[11px] font-mono uppercase tracking-widest text-zoyd-yellow underline"
              >
                {showReport ? 'Masquer le signalement' : 'Signaler un suspect (anonyme, optionnel)'}
              </button>
              {showReport && (
                <div className="mt-4 space-y-4">
                  <input
                    value={reportPseudo}
                    onChange={(e) => setReportPseudo(e.target.value.slice(0, 30))}
                    maxLength={30}
                    placeholder="Pseudo exact du joueur suspecté"
                    aria-label="Pseudo du suspect"
                    className="w-full bg-transparent border border-white/10 px-4 py-3 text-white font-mono text-sm touch-target"
                  />
                  <textarea
                    value={reportNote}
                    onChange={(e) => setReportNote(e.target.value.slice(0, 300))}
                    maxLength={300}
                    rows={3}
                    placeholder="Ce que tu as vu (match, mode, moment)"
                    aria-label="Note de signalement"
                    className="w-full bg-transparent border border-white/10 px-4 py-3 text-white font-mono text-sm"
                  />
                </div>
              )}
            </div>
          )}
        </main>

        <footer className="w-full max-w-xl mx-auto px-4 pb-10 space-y-3">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-full touch-target border border-white/15 text-white/70 font-display font-black uppercase italic text-sm px-6 py-3"
            >
              Découvrir l’arène d’abord
            </button>
          )}
          {screen === 's1' && (
            <button
              type="button"
              onClick={() => setScreen('s2')}
              className="w-full touch-target bg-zoyd-yellow text-zoyd-black font-display font-black uppercase italic text-lg px-6 py-3"
            >
              Commencer le serment
            </button>
          )}
          {screen === 's2' && (
            <button
              type="button"
              onClick={() => setScreen('s3')}
              className="w-full touch-target bg-zoyd-yellow text-zoyd-black font-display font-black uppercase italic text-lg px-6 py-3"
            >
              J’ai lu — continuer
            </button>
          )}
          {screen === 's3' && (
            <>
              {submitError && (
                <p role="alert" className="text-sm text-zoyd-yellow">
                  {submitError}
                </p>
              )}
              <button
                type="button"
                onClick={sealCovenant}
                disabled={submitting}
                className="w-full touch-target bg-zoyd-yellow text-zoyd-black font-display font-black uppercase italic text-lg px-6 py-3 disabled:opacity-40"
              >
                {submitting ? 'Sceau en cours…' : "Entrer dans l’arène"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
};

export default IntegrityCovenantModal;
