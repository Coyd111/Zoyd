/**
 * useServiceWorker - enregistrement du service worker, mise a jour, push Web.
 *
 * Enregistre /sw.js une seule fois (promesse module), signale la disponibilite
 * d'une mise a jour, et souscrit le PushManager quand la permission de
 * notification est deja accordee.
 *
 * INVARIANT : la premiere installation ne doit PAS recharger la page. Le
 * rechargement n'a lieu que si un controleur actif est remplace, sinon la
 * premiere visite de chaque visiteur rechargeait l'ecran pour rien.
 * PIEGE : le push exige un Bearer temps reel, pas le cookie applicatif :
 * l'abonnement passe par subscribeToRealtimePush (realtimeClient.ts).
 * PIEGE : l'enregistrement est asynchrone ; les ecrans qui demandent la
 * permission doivent attendre navigator.serviceWorker.ready.
 *
 * Voir aussi : docs/08-frontend.md - section 7.4 (Le push Web)
 */
import { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { subscribeToRealtimePush } from '../lib/realtimeClient';
import { logWarning } from '../lib/logger';

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
  const updateFoundRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let mounted = true;

    // Etat AVANT enregistrement : un `controllerchange` ne vaut rechargement
    // que s'il remplace un service worker deja actif.
    //
    // Sans cette distinction, la PREMIERE visite de chaque visiteur — ou
    // chaque ouverture dans un navigateur vierge — rechargeait la page juste
    // apres l'affichage. Un aller-retour visible pour rien, puisque le
    // nouveau controleur n remplace aucun ancien contenu. C'est aussi ce qui
    // faisait echouer les tests : le contexte d'execution etait detruit entre
    // le montage et la lecture de l'etat.
    const hadControllerAtLoad = Boolean(navigator.serviceWorker.controller);

    registerServiceWorker()
      .then((registration) => {
        if (!mounted) return;
        setIsInstalled(true);

        if (registration.waiting) {
          setUpdateAvailable(true);
        }

        const onUpdateFound = () => setUpdateAvailable(true);
        registration.addEventListener('updatefound', onUpdateFound);
        updateFoundRef.current = () => registration.removeEventListener('updatefound', onUpdateFound);

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
        logWarning('SW Registration failed', { component: 'useServiceWorker', message: err?.message || String(err) });
      });

    const onControllerChange = () => {
      // Premiere installation : rien a remplacer, on ne recharge pas.
      if (!hadControllerAtLoad) return;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    controllerChangeRef.current = () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);

    return () => {
      mounted = false;
      updateFoundRef.current?.();
      updateFoundRef.current = null;
      controllerChangeRef.current?.();
      controllerChangeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!user || !('serviceWorker' in navigator) || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    navigator.serviceWorker.ready
      .then((registration) => subscribeToRealtimePush(user, registration))
      .catch((err) => logWarning('SW Push subscription failed', { component: 'useServiceWorker', message: err?.message || String(err) }));
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
