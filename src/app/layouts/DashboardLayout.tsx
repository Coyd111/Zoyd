import React from 'react';
import { Outlet, Navigate } from 'react-router';
import { Navbar } from '../components/layout/Navbar';
import { Sidebar } from '../components/layout/Sidebar';
import { BottomNav } from '../components/layout/BottomNav';
import { useMatchAutomationHeartbeat } from '../hooks/useMatchAutomationHeartbeat';
import { useRealtimeHeartbeat } from '../hooks/useRealtimeHeartbeat';
import { useAuthStore } from '../stores/authStore';

const DashboardLayout: React.FC = () => {
  const { isAuthenticated } = useAuthStore();
  useMatchAutomationHeartbeat(isAuthenticated);
  useRealtimeHeartbeat(isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/auth/login" replace />;
  }

  return (
    <div className="min-h-screen bg-zoyd-black">
      <Navbar />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 pb-20 md:pb-0">
          <Outlet />
        </main>
      </div>
      <BottomNav />
    </div>
  );
};

export default DashboardLayout;
