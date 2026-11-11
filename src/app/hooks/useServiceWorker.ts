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
 * INVARIANT : les effets de BORD sont UNIQUES au module, l ETAT est local.
 * Le hook est monte deux fois (App.tsx et NotificationDropdown.tsx) : deux
 * instances veuxaient dire deux listeners `controllerchange` — donc deux
 * `window.location.reload()` a chaque mise a jour — et deux abonnements push,
 * donc deux `POST /api/realtime/push/subscribe` par changement d utilisateur.
 * Le module garde la main unique ; chaque instance garde son etat local.
 */
import { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { subscribeToRealtimePush } from '../lib/realtimeClient';
import { logWarning } from '../lib/logger';
import { waitForServiceWorkerReady } from '../lib/serviceWorkerReady';

let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;

// Effets de bord uniques au module (le hook est monte plusieurs fois).
let controllerChangeInstalled = false;
let updateFoundRegistration: ServiceWorkerRegistration | null = null;
let updateFoundHandler: (() => void) | null = null;
// Comptes deja abonnes au push : evite un POST par instance ET par rendu.
const pushSubscribedFor = new Set<string>();

const registerServiceWorker = () => {
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker.register('/sw.js');
  }

  return registrationPromise;
};

export function useServiceWorker() {
  // SELECTEUR, et non `useAuthStore()` sans selecteur : ce dernier
  // abonne le composant a TOUT le store. Chaque `set()` — un `wallet:update`,
  // un `syncAuthBalance` — re-rendait donc la racine `App`, et avec elle
  // toute l arborescence de routes : micro-saccades sur le solde et la
  // navigation, sur telephone d entree de gamme.
  const user = useAuthStore((s) => s.user);
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

        // L ecouteur `updatefound` est pose UNE SEULE FOIS par
        // enregistrement : le hook etant monte deux fois, il etait pose deux
        // fois sur le meme registration.
        if (updateFoundRegistration !== registration) {
          updateFoundHandler?.();
          updateFoundRegistration = registration;
          updateFoundHandler = () => setUpdateAvailable(true);
          registration.addEventListener('updatefound', updateFoundHandler);
        }
        updateFoundRef.current = () => {
          if (updateFoundRegistration === registration && updateFoundHandler) {
            registration.removeEventListener('updatefound', updateFoundHandler);
            updateFoundRegistration = null;
            updateFoundHandler = null;
          }
        };

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

    // Le rechargement au changement de controleur est pose UNE SEULE FOIS :
    // deux listeners, c etaient deux rechargements a chaque mise a jour.
    if (!controllerChangeInstalled) {
      controllerChangeInstalled = true;
      const onControllerChange = () => {
        // Premiere installation : rien a remplacer, on ne recharge pas.
        if (!hadControllerAtLoad) return;
        window.location.reload();
      };
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      controllerChangeRef.current = () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    }

    return () => {
      mounted = false;
      updateFoundRef.current?.();
      updateFoundRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!user || !('serviceWorker' in navigator) || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    // L abonnement push est UNIQUE par compte : le hook etant monte deux
    // fois, chaque instance rejouait l effectif — donc deux
    // `POST /api/realtime/push/subscribe` par changement d utilisateur.
    if (pushSubscribedFor.has(user.id)) return;

    navigator.serviceWorker.ready
      .then((registration) => {
        pushSubscribedFor.add(user.id);
        return subscribeToRealtimePush(user, registration);
      })
      .catch((err) => {
        pushSubscribedFor.delete(user.id);
        logWarning('SW Push subscription failed', { component: 'useServiceWorker', message: err?.message || String(err) });
      });
  }, [user]);

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) return 'denied' as const;

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);

    if (permission === 'granted' && user && 'serviceWorker' in navigator) {
      // P13 C16 (audit-3) : ce bloc awaitait `navigator.serviceWorker.ready`
      // (sans timeout) PUIS `subscribeToRealtimePush` — deux rejets possibles
      // qui remontaient a NotificationDropdown, dont l onClick fait `void
      // requestNotificationPermission()` : unhandled rejection. Blinde ici :
      // le joueur a ACCEPTE la permission — l echec d'abonnement push
      // (timeout SW, refusee) ne doit pas apparaitre comme un refus, le
      // consentement reste ce que l'utilisateur a vu.
      try {
        const registration = await waitForServiceWorkerReady();
        if (registration) {
          await subscribeToRealtimePush(user, registration);
        }
      } catch (err) {
        logWarning('SW Push subscription failed', { component: 'useServiceWorker', message: err instanceof Error ? err.message : String(err) });
      }
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
