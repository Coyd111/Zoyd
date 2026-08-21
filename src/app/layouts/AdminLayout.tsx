import React from 'react';
import { Navigate, Outlet } from 'react-router';
import { BottomNav } from '../components/layout/BottomNav';
import { Navbar } from '../components/layout/Navbar';
import { Sidebar } from '../components/layout/Sidebar';
import { useMatchAutomationHeartbeat } from '../hooks/useMatchAutomationHeartbeat';
import { useRealtimeHeartbeat } from '../hooks/useRealtimeHeartbeat';
import { useAuthStore } from '../stores/authStore';

const AdminLayout: React.FC = () => {
  const { isAuthenticated, user } = useAuthStore();
  
  // Enhanced admin protection with role validation
  const isAdmin = isAuthenticated && user?.role === 'admin';

  if (!isAuthenticated) {
    return <Navigate to="/auth/login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/mj" replace />;
  }

  useMatchAutomationHeartbeat(isAdmin);
  useRealtimeHeartbeat(isAdmin);

  return (
    <div className="min-h-screen bg-zoyd-black">
      <Navbar />
      <div className="flex">
        <Sidebar />
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
      <BottomNav />
    </div>
  );
};

export default AdminLayout;
