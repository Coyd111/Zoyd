import { Navigate, Outlet } from 'react-router';
import { BottomNav } from '../components/layout/BottomNav';
import { Navbar } from '../components/layout/Navbar';
import { Sidebar } from '../components/layout/Sidebar';
import { useRealtimeHeartbeat } from '../hooks/useRealtimeHeartbeat';
import { useAuthStore } from '../stores/authStore';

const AdminLayout = () => {
  const { isAuthenticated, user, isLoading } = useAuthStore();
  const isAdmin = isAuthenticated && user?.role === 'admin';

  useRealtimeHeartbeat(isAdmin);

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

  if (!isAdmin) {
    return <Navigate to="/mj" replace />;
  }

  return (
    <div className="min-h-dvh bg-zoyd-black safe-top">
      <Navbar />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 pb-24 md:pb-4 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
      <BottomNav />
    </div>
  );
};

export default AdminLayout;
