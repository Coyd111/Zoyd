import React from 'react';

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

  componentDidCatch(_error: Error, _errorInfo: React.ErrorInfo) {
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="min-h-dvh bg-zoyd-black text-white flex items-center justify-center p-6 safe-top">
            <div className="text-center max-w-md">
              <h2 className="text-xl font-display font-black uppercase mb-4">Une erreur est survenue</h2>
              <p className="text-white/40 text-sm mb-6">
                {this.state.error?.message || 'Erreur inconnue. Recharge la page.'}
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
