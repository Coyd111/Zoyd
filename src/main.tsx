/**
 * main.tsx - point d'entree de l'application React (createRoot sur #root).
 *
 * Monte l'application dans un <StrictMode>, enveloppee d'un RootErrorBoundary
 * local. Ce boundary est en styles INLINE, pas en Tailwind : il doit rester
 * affichable meme si le CSS n'a pas ete charge. Point d'entree du bundle
 * declare dans index.html.
 *
 * INVARIANT : ne rien importer ici qui declenche une requete au chargement ;
 * le bootstrap de session passe par App.tsx, volontairement plus bas.
 * INVARIANT : le boundary racine ne doit dependre d'aucun token du design
 * system - c'est la derniere ligne de defense quand React echoue.
 * PIEGE : StrictMode monte les effets deux fois en dev : tout effet de bord
 * (abonnement socket, fetch) doit etre idempotent.
 *
 * Voir aussi : docs/08-frontend.md - section 1 (Vue d'ensemble)
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Component, type ReactNode } from "react";
import App from "./app/App.tsx";
import "./styles/index.css";

class RootErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
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
              onClick={() => window.location.reload()}
              style={{ background: '#FFD700', color: '#000', border: 'none', padding: '0.75rem 2rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Recharger
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>
);
