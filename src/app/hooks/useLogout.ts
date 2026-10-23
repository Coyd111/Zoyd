/**
 * useLogout - deconnexion propre : backend, push, socket, stores, redirection.
 *
 * INVARIANT (F3) : la purge des stores passe PAR `resetAllSessionStores()`,
 * jamais par une copie locale. La copie precedente oubliait les maps
 * par-utilisateur du store tournois (`callerEntryByTournament`...) et la file
 * de signalements (`reports`) : le compte suivant heritait de l'entree du
 * precedent ("ta position" + inscription bloquee) et le dashboard admin
 * restait sur la file de moderation de l'autre compte. sessionReset est le
 * point d'entree unique, teste et isole (chaque etape dans son try/catch) :
 * ce fichier ne fait plus que l'orchestration (backend, push, auth, timers).
 * PIEGE : `cleanupToastTimers` reste ICI, AVANT/AVEC le vidage des toasts :
 * un toast pending survit sinon a la deconnexion et reapparait sur l'ecran
 * suivant ; `idCounter` n'est pas couvert par sessionReset.
 * PIEGE : la deconnexion du socket passe par le store (sessionReset appelle
 * `disconnect()`), pas par un import direct de realtimeClient : c'est le
 * store qui reinitialise la presence.
 *
 * Voir aussi : docs/08-frontend.md - section 6.1 (Les hooks de session)
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { logoutFromBackend } from '../lib/authApi';
import { unsubscribeFromRealtimePush } from '../lib/realtimeClient';
import { useAuthStore } from '../stores/authStore';
import { resetAllSessionStores } from '../lib/sessionReset';
import { useToastStore, cleanupToastTimers } from '../stores/toastStore';

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
    useAuthStore.getState().logout();
    // Purge unique (F3) : wallet, matchs, tournois (maps d'appelant incluses),
    // ligue, chat, amis (file de signalements incluse), notifications,
    // toasts, score de confiance, presence + coupure du socket.
    resetAllSessionStores();
    cleanupToastTimers();
    useToastStore.setState({ toasts: [], idCounter: 0 });
    navigate('/auth/login');
  }, [navigate]);
}
