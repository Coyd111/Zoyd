import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { subscribeToRealtimePush } from '../lib/realtimeClient';

let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;
let controllerChangeBound = false;

const registerServiceWorker = () => {
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker.register('/sw.js');
  }

  return registrationPromise;
};

export function useServiceWorker() {
  const { user } = useAuthStore();
  const [isInstalled, setIsInstalled] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
  );

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let mounted = true;

    registerServiceWorker()
      .then((registration) => {
        if (!mounted) return;
        setIsInstalled(true);

        if (registration.waiting) {
          setUpdateAvailable(true);
        }

        registration.addEventListener('updatefound', () => {
          setUpdateAvailable(true);
        });

        return navigator.serviceWorker.ready;
      })
      .then(() => {
        if (mounted) {
          setIsInstalled(true);
        }
      })
      .catch((err) => {
        if (mounted) {
          console.warn('Service worker registration failed:', err?.message || err);
          setIsInstalled(false);
        }
      });

    if (!controllerChangeBound) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
      controllerChangeBound = true;
    }

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!user || !('serviceWorker' in navigator) || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    navigator.serviceWorker.ready
      .then((registration) => subscribeToRealtimePush(user, registration))
      .catch(() => undefined);
  }, [user]);

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) return 'denied' as const;

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);

    if (permission === 'granted' && user && 'serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await subscribeToRealtimePush(user, registration);
    }

    return permission;
  };

  const applyServiceWorkerUpdate = async () => {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  };

  return {
    isInstalled,
    updateAvailable,
    notificationPermission,
    requestNotificationPermission,
    applyServiceWorkerUpdate,
  };
}
