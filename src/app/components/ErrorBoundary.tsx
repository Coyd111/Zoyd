/**
 * ErrorBoundary - filet de securite React pour l'ensemble de l'application.
 *
 * Capture une exception de rendu, journalise via logError et affiche un
 * repli. Monte dans App.tsx, au-dessus de tous les providers.
 *
 * INVARIANT : le repli doit etre rendu sans dependre des stores, du
 * routeur ni du design system : le boundary se declenche precisement quand
 * le reste est casse.
 * INVARIANT : toute erreur doit etre JOURNALISEE avant l'affichage du
 * repli, sinon elle disparait silencieusement.
 * PIEGE : un boundary React ne rattrape PAS les erreurs des gestionnaires
 * d'evenements, des promesses rejetees ni des effets asynchrones : ceux-la
 * doivent etre catches explicitement (voir apiClient.readJson).
 *
 * Voir aussi : docs/08-frontend.md - section 3.3 (Erreurs de route)
 */
import React from 'react';
import { logError } from '../lib/logger';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logError(error, { component: 'ErrorBoundary', action: 'componentDidCatch', componentStack: errorInfo.componentStack });
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="min-h-dvh bg-zoyd-black text-white flex items-center justify-center p-6 safe-top">
            <div className="text-center max-w-md">
              <h2 className="text-xl font-display font-black uppercase mb-4">Une erreur est survenue</h2>
              <p className="text-white/70 text-sm mb-6">
                {import.meta.env.DEV ? (this.state.error?.message || 'Erreur inconnue.') : 'Une erreur inattendue s\'est produite.'}
              </p>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-white text-black font-display font-black text-xs uppercase tracking-widest hover:bg-zoyd-yellow transition-colors"
              >
                Recharger
              </button>
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
