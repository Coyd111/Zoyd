import { Outlet, Navigate } from 'react-router';
import { Navbar } from '../components/layout/Navbar';
import { Sidebar } from '../components/layout/Sidebar';
import { BottomNav } from '../components/layout/BottomNav';
import { useRealtimeHeartbeat } from '../hooks/useRealtimeHeartbeat';
import { useAuthStore } from '../stores/authStore';

interface AppLayoutProps {
  requireAdmin?: boolean;
}

const AppLayout = ({ requireAdmin = false }: AppLayoutProps) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const user = useAuthStore((s) => s.user);

  const isAdmin = user?.role === 'admin';

  useRealtimeHeartbeat(isAuthenticated);

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-zoyd-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-zoyd-yellow rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth/login" replace />;
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/mj" replace />;
  }

  return (
    <div className="min-h-dvh bg-zoyd-black safe-top">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:font-display focus:font-black focus:text-xs focus:uppercase focus:tracking-widest">
        Aller au contenu principal
      </a>
      <Navbar />
      <div className="flex">
        <Sidebar />
        <main id="main-content" className="flex-1 pb-24 md:pb-4 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
      <BottomNav />
    </div>
  );
};

export default AppLayout;
