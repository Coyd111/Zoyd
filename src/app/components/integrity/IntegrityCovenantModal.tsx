/**
 * IntegrityCovenantModal — le Serment d'intégrité (fenêtres F1..F10).
 *
 * Plein écran, non-fermable (pas d'Escape, pas de backdrop cliquable : un
 * serment n'est pas une bannière). Affiché par le gate d'AppLayout tant que
 * `user.covenant` est absent — c'est-à-dire une seule fois par compte, au
 * login, tout de suite après l'authentification.
 *
 * INVARIANT : les réponses OUI/NON ne partent JAMAIS vers le serveur. Le seul
 * contenu transmis est `{ version, report? }` au moment du scellement (F10) :
 * `report` porte le pseudo suspect de F7, optionnel. Côté base, seule la date
 * d'acceptation est consignée (user.covenant) — aucun aveu nominatif.
 * INVARIANT : tonalité solennelle, JAMAIS inquisitionnelle (« tu mens ? tu es
 * sûr ? » a été écarté en conception : suspecté d'office, l'honnête joueur
 * repousse). Les branches NON honorent une réponse franche, elles n'accusent
 * pas et ne bloquent pas.
 * INVARIANT : la date est posée par le SERVEUR (POST /api/auth/covenant) ;
 * l'horloge du navigateur ne fait foi de rien.
 * PIEGE : la fermeture ne survient qu'APRES `updateUser({ covenant })` dans
 * le store — c'est le gate d'AppLayout qui relâche l'écran, pas la modal.
 *
 * Voir aussi : AppLayout.tsx (le gate), lib/authApi.ts (COVENANT_VERSION,
 * submitCovenant), server/routes/auth.mjs (POST /api/auth/covenant).
 */
import { useCallback, useState } from 'react';
import { COVENANT_VERSION, submitCovenant } from '../../lib/authApi';
import { useAuthStore } from '../../stores/authStore';

type ScreenId =
  | 'f1' | 'f2' | 'f2oui' | 'f2non'
  | 'f3' | 'f4' | 'f4oui' | 'f4non'
  | 'f5' | 'f6' | 'f7' | 'f8' | 'f9' | 'f10';

/** Compteur « étape X/10 » : seules les fenêtres canoniques F1..F10 avancent. */
const STEP_OF: Record<ScreenId, number> = {
  f1: 1,
  f2: 2, f2oui: 2, f2non: 2,
  f3: 3,
  f4: 4, f4oui: 4, f4non: 4,
  f5: 5,
  f6: 6,
  f7: 7,
  f8: 8,
  f9: 9,
  f10: 10,
};

interface ScreenContent {
  kicker: string;
  title: string;
  body: string[];
}

/**
 * Le verbatim, validé mot à mot avant le code. Les interstitiels OUI/NON
 * (F2/F4) gardent le numéro de l'étape qui les a ouverts.
 */
const SCREENS: Record<ScreenId, ScreenContent> = {
  f1: {
    kicker: "Avant l'arène",
    title: 'Le serment d’intégrité',
    body: [
      'Tout joueur qui entre ici prononce un serment. Une seule fois, à voix haute, devant personne.',
      "Ce n'est pas un interrogatoire : il n'y a pas de bonne réponse, rien n'est enregistré, aucune trace nominative n'est gardée. Ce qui reste, c'est ton engagement.",
      'Lis chaque fenêtre. Réponds comme dans ta tête, pas comme on l’attend.',
    ],
  },
  f2: {
    kicker: 'Premier serment',
    title: 'Gagner au plein jeu',
    body: [
      'Une victoire qui ne vient pas de toi ne raconte rien. Elle se gagne sans aimant, sans script, sans outil interdit, sans compte fantôme, sans astuce que tu cacherais.',
      'Promets-tu de gagner à force de jeu — et jamais à force de triche ?',
    ],
  },
  f2oui: {
    kicker: 'Premier serment — dit',
    title: 'Respect',
    body: [
      'Tu viens de reconnaître la règle avant même de pouvoir la casser. C’est la moitié du serment : la connaître.',
      "L'autre moitié, tu l'écriras chaque saison : la tenir quand personne ne regarde.",
    ],
  },
  f2non: {
    kicker: 'Premier serment — reporte',
    title: 'Le serment n’avance pas contre toi',
    body: [
      'Alors tu préfères ne rien jurer à moitié. C’est dit, et c’est respecté.',
      "Le serment n'avance pas contre toi : il t'attend. La suite t'appartient.",
    ],
  },
  f3: {
    kicker: 'À lire',
    title: 'Ce que le serment protège',
    body: [
      'Ton nom : chaque victoire porte ta signature. Protéger ton nom, c’est protéger ce qu’elle dit de toi.',
      "L'arène : elle vaut parce que chacun joue selon les mêmes règles.",
      'Les autres : les heures qu’un tricheur vole ne reviennent pas.',
      'Aucune sanction n’est dissimulée dans ce serment : il engage, il ne piège pas.',
    ],
  },
  f4: {
    kicker: 'Second serment',
    title: 'Fair-play, deux sens',
    body: [
      'Le fair-play protège deux jeux : celui des autres — que tu ne fausses pas — et le tien, parce qu’une victoire volée ne t’appartient pas.',
      'Promets-tu les deux sens — vers l’adversaire, et vers toi-même — même sans témoin ?',
    ],
  },
  f4oui: {
    kicker: 'Second serment — dit',
    title: 'Deux promesses dites',
    body: [
      'Une pour l’adversaire, une pour toi. Elles ne valent que par les jours sans témoin — aujourd’hui, tu les as dites pour tous.',
    ],
  },
  f4non: {
    kicker: 'Second serment — reporte',
    title: 'La question reste ouverte',
    body: [
      'Tu gardes la question pour plus tard. Le serment n’avance pas contre toi : il attend, il ne compte pas.',
      'Poursuis ce qui suit ; le reste se dispose.',
    ],
  },
  f5: {
    kicker: 'Point d’honneur',
    title: 'Des exceptions à soi',
    body: [
      "Les exceptions que l'on se pardonne à soi-même sont les brèches où tout passe : le premier hack « juste pour essayer », le second « pour rattraper », le troisième pour sauver un rang acquis à découvert.",
      'Un nom honorable ne s’aménage pas d’exception sur mesure.',
    ],
  },
  f6: {
    kicker: 'La même règle pour tous',
    title: 'La porte des sanctions',
    body: [
      'Il n’y a qu’une seule règle, sans privilège : surveillance, exclusion temporaire, bannissement définitif. Ce n’est pas une menace — c’est l’application, pour n’importe quel joueur, de ce que tout le monde a promis.',
      'Le serment te protège du revers : tant qu’il tient, ton nom reste net, et rien ne te visera.',
    ],
  },
  f7: {
    kicker: 'De ton côté de la règle',
    title: 'Signaler un suspect',
    body: [
      'Si tu connais le pseudo d’un joueur qui triche, tu peux le signaler ici et maintenant.',
      'Ton pseudo n’apparaît nulle part : le signalement reste anonyme. C’est un humain qui l’examine — un pseudo seul ne condamne personne.',
      'Tu peux aussi passer ; signaler n’est pas une corvée.',
    ],
  },
  f8: {
    kicker: 'Ce qui se sceau',
    title: 'Inscrit, et non inscrit',
    body: [
      "La date de ce serment est marquée sur ton compte par nos serveurs — pas par ton navigateur — et s'affichera sur ton profil : ton sceau d'intégrité.",
      "Tes réponses, elles, ne sont écrites nulle part. Un serment à voix haute ne se consigne pas par écrit.",
    ],
  },
  f9: {
    kicker: 'Après',
    title: 'Une habitude, pas un certificat',
    body: [
      'Ton sceau vivra sur ton profil, avec sa date. Il ne prouve pas que tu es propre : il prouve que tu as dit.',
      "C'est le début d'une habitude — celle de se tenir debout avec les autres.",
    ],
  },
  f10: {
    kicker: 'Le dernier mot',
    title: 'Entre dans l’arène',
    body: [
      'Rien n’a changé ici : même solde, même rang, même saison. Ce qui a changé, tu le sais — et c’est pour ça que ça tiendra.',
      'Que ton rang soit à la hauteur de ta parole.',
    ],
  },
};

/** Fenêtres à CTA simple : la cible quand on poursuit. */
const CONTINUE_TO: Partial<Record<ScreenId, ScreenId>> = {
  f1: 'f2',
  f2oui: 'f3',
  f2non: 'f3',
  f3: 'f4',
  f4oui: 'f5',
  f4non: 'f5',
  f5: 'f6',
  f6: 'f7',
  f8: 'f9',
  f9: 'f10',
};

export const IntegrityCovenantModal = ({ onClose }: { onClose?: () => void }) => {
  const [screen, setScreen] = useState<ScreenId>('f1');
  const [reportPseudo, setReportPseudo] = useState('');
  const [reportNote, setReportNote] = useState('');
  const [signalArmed, setSignalArmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const updateUser = useAuthStore((s) => s.updateUser);

  const content = SCREENS[screen];
  const step = STEP_OF[screen];

  const go = useCallback((next: ScreenId) => {
    setSubmitError(null);
    setScreen(next);
  }, []);

  const armSignal = useCallback(() => {
    const pseudo = reportPseudo.trim();
    if (pseudo.length > 0) setSignalArmed(true);
    setSubmitError(null);
    setScreen('f8');
  }, [reportPseudo]);

  const skipSignal = useCallback(() => {
    setSignalArmed(false);
    setReportPseudo('');
    setReportNote('');
    setSubmitError(null);
    setScreen('f8');
  }, []);

  /** F10 : scellement — la seule requête qui part, avec version (+ signal). */
  const sealCovenant = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const pseudo = reportPseudo.trim();
      const report = signalArmed && pseudo.length > 0
        ? { pseudo, note: reportNote.trim() || undefined }
        : undefined;
      const result = await submitCovenant(COVENANT_VERSION, report);
      if (result?.user?.covenant) {
        // PIEGE (authStore) : `covenant` est dans allowedKeys — sans cette
        // écriture, le gate réapparaîtrait à la navigation suivante.
        updateUser({ covenant: result.user.covenant });
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Le scellement a échoué. Réessaie.');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, signalArmed, reportPseudo, reportNote, updateUser]);

  const suspectLimit = 30;
  const noteLimit = 300;

  return (
    <div
      className="fixed inset-0 z-[80] bg-zoyd-black scanline overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Serment d'intégrité"
    >
      <div className="pointer-events-none fixed inset-0 tactical-grid opacity-10" />
      <div className="relative min-h-dvh flex flex-col safe-top">
        {/* En-tête : version + progression — jamais de croix de fermeture. */}
        <header className="border-b border-white/10 bg-zoyd-black px-4 pt-6">
          <p className="text-[10px] font-mono tracking-widest text-white/60 uppercase">
            Serment d&apos;intégrité — {COVENANT_VERSION}
          </p>
          <div className="mt-3 h-px w-full bg-white/10">
            <div
              className="h-px bg-zoyd-yellow transition-all duration-300"
              style={{ width: `${(step / 10) * 100}%` }}
            />
          </div>
        </header>

        <main className="flex-1 w-full max-w-xl mx-auto px-4 py-8">
          <p className="text-[10px] font-mono tracking-widest text-white/60 uppercase">
            Étape {step}/10 — {content.kicker}
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

          {screen === 'f8' && signalArmed && (
            <p className="mt-4 text-[10px] font-mono tracking-widest text-zoyd-yellow uppercase">
              Ton signalement partira avec le serment — sans ton nom.
            </p>
          )}

          {screen === 'f7' && (
            <div className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="covenant-suspect"
                  className="text-[10px] font-mono tracking-widest text-white/60 uppercase"
                >
                  Pseudo du suspect ({reportPseudo.length}/{suspectLimit})
                </label>
                <input
                  id="covenant-suspect"
                  value={reportPseudo}
                  onChange={(e) => setReportPseudo(e.target.value.slice(0, suspectLimit))}
                  maxLength={suspectLimit}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Pseudo exact du joueur suspecté"
                  className="mt-1 w-full bg-transparent border border-white/10 focus:border-zoyd-yellow outline-none px-4 py-3 text-white font-mono text-sm touch-target"
                />
              </div>
              <div>
                <label
                  htmlFor="covenant-note"
                  className="text-[10px] font-mono tracking-widest text-white/60 uppercase"
                >
                  Note libre ({reportNote.length}/{noteLimit}) — optionnel
                </label>
                <textarea
                  id="covenant-note"
                  value={reportNote}
                  onChange={(e) => setReportNote(e.target.value.slice(0, noteLimit))}
                  maxLength={noteLimit}
                  rows={3}
                  placeholder="Ce que tu as vu (match, mode, moment)"
                  className="mt-1 w-full bg-transparent border border-white/10 focus:border-zoyd-yellow outline-none px-4 py-3 text-white font-mono text-sm resize-none"
                />
              </div>
            </div>
          )}
        </main>

        <footer className="w-full max-w-xl mx-auto px-4 pb-10 space-y-3">
          {screen === 'f2' && (
            <>
              <button
                type="button"
                onClick={() => go('f2oui')}
                className="w-full touch-target bg-zoyd-yellow text-zoyd-black font-display font-black uppercase italic tracking-tighter text-lg px-6 py-3"
              >
                Oui
              </button>
              <button
                type="button"
                onClick={() => go('f2non')}
                className="w-full touch-target border border-white/10 text-white/80 font-display font-black uppercase italic tracking-tighter text-lg px-6 py-3 hover:border-white/30"
              >
                Non
              </button>
            </>
          )}
          {screen === 'f4' && (
            <>
              <button
                type="button"
                onClick={() => go('f4oui')}
                className="w-full touch-target bg-zoyd-yellow text-zoyd-black font-display font-black uppercase italic tracking-tighter text-lg px-6 py-3"
              >
                Oui
              </button>
              <button
                type="button"
                onClick={() => go('f4non')}
                className="w-full touch-target border border-white/10 text-white/80 font-display font-black uppercase italic tracking-tighter text-lg px-6 py-3 hover:border-white/30"
              >
                Non
              </button>
            </>
          )}
          {screen === 'f7' && (
            <>
              {reportPseudo.trim().length > 0 ? (
                <button
                  type="button"
                  onClick={armSignal}
                  className="w-full touch-target bg-zoyd-yellow text-zoyd-black font-display font-black uppercase italic tracking-tighter text-lg px-6 py-3"
                >
                  Je rapporte
                </button>
              ) : (
                <button
                  type="button"
                  onClick={skipSignal}
                  className="w-full touch-target border border-white/10 text-white/80 font-display font-black uppercase italic tracking-tighter text-lg px-6 py-3 hover:border-white/30"
                >
                  Suivant
                </button>
              )}
            </>
          )}
          {screen === 'f1' && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-full touch-target border border-white/15 text-white/70 font-display font-black uppercase italic tracking-tighter text-sm px-6 py-3"
            >
              Découvrir l'arène d'abord
            </button>
          )}
          {screen === 'f10' && (
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
                className="w-full touch-target bg-zoyd-yellow text-zoyd-black font-display font-black uppercase italic tracking-tighter text-lg px-6 py-3 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? 'Sceau en cours…' : "Entrer dans l'arène"}
              </button>
            </>
          )}
          {CONTINUE_TO[screen] && screen !== 'f10' && (
            <button
              type="button"
              onClick={() => go(CONTINUE_TO[screen] as ScreenId)}
              className="w-full touch-target bg-zoyd-yellow text-zoyd-black font-display font-black uppercase italic tracking-tighter text-lg px-6 py-3"
            >
              {screen === 'f3' || screen === 'f8'
                ? "J'ai lu — continuer"
                : screen === 'f1'
                  ? 'Commencer le serment'
                  : 'Continuer'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};

export default IntegrityCovenantModal;
