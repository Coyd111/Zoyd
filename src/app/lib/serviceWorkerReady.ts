/**
 * serviceWorkerReady - attend l'enregistrement du service worker avec un
 * plafond de temps.
 *
 * `navigator.serviceWorker.ready` n'a AUCUN timeout et ne se resout JAMAIS
 * en erreur : si aucun SW ne s'enregistre (enregistrement bloque, mode
 * prive strict, sw.js introuvable), la promesse reste pending pour
 * toujours. Les deux awaits utilisateurs (affichage d'une notification
 * navigateur dans notificationStore, demande de permission dans
 * useServiceWorker) attendaient donc indefiniment.
 *
 * INVARIANT : au timeout, la promesse RESOUT avec `null` : l'appelant
 * decide (sauter la notification, ne pas s'abonner). Un rejet ici
 * propagerait un rejet non gere vers les call sites qui font `void`.
 *
 * PIEGE : ne pas utiliser ce helper pour l'attente passive au montage
 * (useServiceWorker :107, useLogout) : ces sites sont deja fire-and-forget
 * avec .catch et n'attendent pas le resultat.
 */

const SW_READY_TIMEOUT_MS = 8000;

export const waitForServiceWorkerReady = async (): Promise<ServiceWorkerRegistration | null> => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } catch {
    // Certains contextes rejettent la promesse ready (SecurityError) :
    // meme traitement que le timeout, l'appelant decide.
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
};
