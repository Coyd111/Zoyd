
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Component, type ReactNode } from "react";
import App from "./app/App.tsx";
import "./styles/index.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', background: '#000', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', padding: '2rem' }}>
          <div style={{ maxWidth: 600, textAlign: 'center' }}>
            <h1 style={{ fontSize: '2rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1rem', color: '#FFD700' }}>
              Erreur inattendue
            </h1>
            <p style={{ color: '#fff8', marginBottom: '1.5rem' }}>
              Quelque chose s'est mal passe. Recharge la page ou reviens plus tard.
            </p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              style={{ background: '#FFD700', color: '#000', border: 'none', padding: '0.75rem 2rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Recharger
            </button>
            {this.state.error && (
              <pre style={{ marginTop: '1.5rem', fontSize: '0.75rem', color: '#fff4', textAlign: 'left', overflow: 'auto', maxHeight: 200 }}>
                {this.state.error.message}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
