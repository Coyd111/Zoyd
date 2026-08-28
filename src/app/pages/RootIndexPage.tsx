import React from 'react';
import { useAuthStore } from '../stores/authStore';
import LandingPage from './LandingPage';
import DashboardPage from './DashboardPage';

const RootIndexPage: React.FC = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-zoyd-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-zoyd-yellow rounded-full animate-spin" />
      </div>
    );
  }

  return isAuthenticated ? <DashboardPage /> : <LandingPage />;
};

export default RootIndexPage;
