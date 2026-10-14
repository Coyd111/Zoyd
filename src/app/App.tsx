import { RouterProvider } from 'react-router';
import { HelmetProvider } from 'react-helmet-async';
import { MotionConfig, useReducedMotion } from 'motion/react';
import { useEffect } from 'react';
import { router } from './routes';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAuthSessionBootstrap } from './hooks/useAuthSessionBootstrap';
import { useChatSessionBootstrap } from './hooks/useChatSessionBootstrap';
import { useServiceWorker } from './hooks/useServiceWorker';
import { useWalletSessionBootstrap } from './hooks/useWalletSessionBootstrap';

/**
 * Publie la preference systeme resolue sur `<html>`, ce qui la rend
 * observable depuis le DOM : le test d'accessibilite verifie le comportement
 * constate plutot que la configuration declaree.
 */
function MotionPreferenceReporter() {
  const reduced = useReducedMotion();
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reduced ? 'true' : 'false';
  }, [reduced]);
  return null;
}

export default function App() {
  useServiceWorker();
  useAuthSessionBootstrap();
  useChatSessionBootstrap();
  useWalletSessionBootstrap();
  return (
    <ErrorBoundary>
      <HelmetProvider>
        {/*
          `theme.css` neutralise deja les animations CSS sous
          `prefers-reduced-motion`. Mais 26 composants sont animes par
          `motion`, en JavaScript : cette preference ne les atteint pas, et
          Framer Motion ignore le reglage systeme par defaut. Sans ce
          `MotionConfig`, un joueur ayant desactive les animations dans son
          systeme voit quand meme tout bouger.
          `reducedMotion: 'user'` fait respecter la preference, en coupant les
          transformations et les degrades tout en conservant les transitions
          d'opacite — les changements d'etat restent percusibles.
        */}
        <MotionConfig reducedMotion="user">
          <MotionPreferenceReporter />
          <RouterProvider router={router} />
        </MotionConfig>
      </HelmetProvider>
    </ErrorBoundary>
  );
}
