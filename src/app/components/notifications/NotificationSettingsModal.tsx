/**
 * NotificationSettingsModal - permission de notification navigateur.
 *
 * P13 C5 (audit-3) : modale epuree pour n'afficher que ce qui est
 * REELLEMENT connecte. La seule chose connectee ici est la permission
 * navigateur (Notification.requestPermission), lue par
 * notificationStore.showBrowserNotification au moment de l'envoi.
 *
 * PIEGE (retire en C5) : cette modale affichait cinq toggles decoratifs
 * (types de notifications) et un fichier .ics fictif - aucun reglage
 * n'etait persiste nulle part : "Sauvegarder" ne faisait que fermer la
 * fenetre, l'etat se perdait au demontage, et l'ics annoncait un match
 * fictif a now+1h qui ne correspondait a aucun match reel. Les
 * reintroduire suppose d'implementer des preferences persistees ET leur
 * filtrage dans notificationStore.addNotification d'abord : un ecran qui
 * donne l'illusion d'une preference enregistree est une tromperie douce
 * sur l'etat (famille C5 audit-2).
 * PIEGE : la mise a jour du service worker (SKIP_WAITING, useServiceWorker)
 * n'a jamais eu de bouton ici - l'ancienne docstring la promettait a tort.
 *
 * INVARIANT : la permission navigateur ne se demande qu'APRES une action
 * explicite de l'utilisateur. Un `Notification.requestPermission()` au
 * montage est refuse par les navigateurs.
 * PIEGE : la permission peut etre accordee, refusee ou unsupported selon le
 * navigateur : `unsupported` n'est pas une erreur, c'est un etat legitime.
 *
 * Voir aussi : docs/08-frontend.md - section 7.4 (Le push Web)
 */
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Bell, CheckCircle, Monitor } from 'lucide-react';
import { Button } from '../ui/Button';

interface NotificationSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type PermState = 'default' | 'granted' | 'denied' | 'unsupported';

function useBrowserNotifyPermission(): PermState {
  const [perm, setPerm] = useState<PermState>('default');
  useEffect(() => {
    if (!('Notification' in window)) { setPerm('unsupported'); return; }
    setPerm(Notification.permission as PermState);
  }, []);
  return perm;
}

const NotificationSettingsModal: React.FC<NotificationSettingsModalProps> = ({ open, onClose }) => {
  const notifyPerm = useBrowserNotifyPermission();
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    if (open) {
      setPushEnabled(notifyPerm === 'granted');
    }
  }, [open, notifyPerm]);

  const requestNotify = useCallback(async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    if (result === 'granted') setPushEnabled(true);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Paramètres de notifications"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-zoyd-black border border-white/10 w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* HEADER */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-zoyd-surface/20 sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <Bell className="w-5 h-5 text-zoyd-yellow" />
                <h2 className="text-sm font-display font-black uppercase tracking-tighter italic text-white">Notifications ZOYD</h2>
              </div>
              <button onClick={onClose} className="text-white/70 hover:text-white transition-colors" aria-label="Fermer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-8">
              {/* SECTION PUSH NAVIGATEUR — seule section cablee : la permission
                  navigateur est l'etat reel lu par notificationStore au moment
                  d'afficher une alerte hors onglet. */}
              <section>
                <h3 className="text-[10px] font-mono font-black uppercase tracking-widest text-white/70 mb-3 italic flex items-center gap-2">
                  <Monitor className="w-3.5 h-3.5" /> Push Navigateur
                </h3>
                <div className="hud-panel p-4 bg-zoyd-surface/20 border border-white/5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-ui text-white/70 mb-1">Alertes en temps réel</p>
                      <p className="text-[10px] font-mono text-white/60">Matchs, check-in, résultats et litiges directement sur ton bureau.</p>
                    </div>
                    {notifyPerm === 'unsupported' ? (
                      <span className="text-[10px] font-mono text-white/70 uppercase">Non supporté</span>
                    ) : pushEnabled ? (
                      <span className="flex items-center gap-1.5 text-[10px] font-mono text-green-400 uppercase">
                        <CheckCircle className="w-3.5 h-3.5" /> Activé
                      </span>
                    ) : (
                      <Button variant="primary" size="sm" onClick={requestNotify}>
                        Autoriser
                      </Button>
                    )}
                  </div>
                </div>
              </section>
            </div>

            {/* FOOTER — "Fermer" : il n'y a RIEN a sauvegarder ici (P13 C5) :
                l'ancien bouton "Sauvegarder" ne faisait que fermer la modale
                en laissant croire a un enregistrement. */}
            <div className="px-6 py-4 border-t border-white/5 bg-zoyd-surface/20 flex justify-end gap-3">
              <Button variant="ghost" size="sm" onClick={onClose}>Fermer</Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default NotificationSettingsModal;
