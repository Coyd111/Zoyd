import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { logoutFromBackend } from '../lib/authApi';
import { unsubscribeFromRealtimePush } from '../lib/realtimeClient';
import { useAuthStore } from '../stores/authStore';
import { useSocketStore } from '../stores/socketStore';

export function useLogout() {
  const navigate = useNavigate();

  return useCallback(() => {
    const user = useAuthStore.getState().user;
    logoutFromBackend().catch(() => undefined);
    if (user && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => unsubscribeFromRealtimePush(user, reg))
        .catch(() => undefined);
    }
    useSocketStore.getState().disconnect();
    useAuthStore.getState().logout();
    navigate('/auth/login');
  }, [navigate]);
}
