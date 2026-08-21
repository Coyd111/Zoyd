import { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { subscribeToRealtimePush } from '../lib/realtimeClient';

let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;

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
  const controllerChangeRef = useRef<(() => void) | null>(null);

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
          setIsInstalled(false);
        }
      });

    const onControllerChange = () => window.location.reload();
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    controllerChangeRef.current = () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);

    return () => {
      mounted = false;
      controllerChangeRef.current?.();
      controllerChangeRef.current = null;
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
