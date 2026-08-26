import { RouterProvider } from 'react-router';
import { HelmetProvider } from 'react-helmet-async';
import { router } from './routes';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAuthSessionBootstrap } from './hooks/useAuthSessionBootstrap';
import { useChatSessionBootstrap } from './hooks/useChatSessionBootstrap';
import { useServiceWorker } from './hooks/useServiceWorker';
import { useWalletSessionBootstrap } from './hooks/useWalletSessionBootstrap';

export default function App() {
  useServiceWorker();
  useAuthSessionBootstrap();
  useChatSessionBootstrap();
  useWalletSessionBootstrap();
  return (
    <ErrorBoundary>
      <HelmetProvider>
        <RouterProvider router={router} fallbackElement={<div className="min-h-dvh bg-zoyd-black flex items-center justify-center text-white/50 font-mono text-xs uppercase tracking-widest safe-top">Chargement...</div>} />
      </HelmetProvider>
    </ErrorBoundary>
  );
}
