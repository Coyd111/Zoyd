import React from 'react';
import { Outlet, Navigate } from 'react-router';
import { Navbar } from '../components/layout/Navbar';
import { Sidebar } from '../components/layout/Sidebar';
import { BottomNav } from '../components/layout/BottomNav';
import { useRealtimeHeartbeat } from '../hooks/useRealtimeHeartbeat';
import { useAuthStore } from '../stores/authStore';

const DashboardLayout: React.FC = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-zoyd-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-zoyd-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth/login" replace />;
  }

  useRealtimeHeartbeat(isAuthenticated);

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

export default DashboardLayout;
