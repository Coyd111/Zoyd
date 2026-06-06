import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Bell, Calendar, Download, CheckCircle, AlertCircle, Monitor, Smartphone, Clock } from 'lucide-react';
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
  const [agendaEnabled, setAgendaEnabled] = useState(false);
  const [matchReminders, setMatchReminders] = useState(true);
  const [tournamentReminders, setTournamentReminders] = useState(true);
  const [friendActivity, setFriendActivity] = useState(true);
  const [walletAlerts, setWalletAlerts] = useState(true);
  const [disputeAlerts, setDisputeAlerts] = useState(true);

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

  const generateICS = () => {
    const start = new Date(Date.now() + 3600000);
    const end = new Date(start.getTime() + 7200000);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ZOYD//Match Reminder//FR',
      'BEGIN:VEVENT',
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      'SUMMARY:Match ZOYD - Check-in requis',
      'DESCRIPTION:Rappel de match sur ZOYD. Connecte-toi pour le check-in 10 min avant.',
      'LOCATION:ZOYD App',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Rappel match ZOYD',
      'TRIGGER:-PT10M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zoyd-match-reminder.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setAgendaEnabled(true);
  };

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
              <button onClick={onClose} className="text-white/20 hover:text-white transition-colors" aria-label="Fermer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-8">
              {/* SECTION PUSH NAVIGATEUR */}
              <section>
                <h3 className="text-[10px] font-mono font-black uppercase tracking-widest text-white/40 mb-3 italic flex items-center gap-2">
                  <Monitor className="w-3.5 h-3.5" /> Push Navigateur
                </h3>
                <div className="hud-panel p-4 bg-zoyd-surface/20 border border-white/5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-ui text-white/70 mb-1">Alertes en temps réel</p>
                      <p className="text-[10px] font-mono text-white/30">Matchs, check-in, résultats et litiges directement sur ton bureau.</p>
                    </div>
                    {notifyPerm === 'unsupported' ? (
                      <span className="text-[9px] font-mono text-white/20 uppercase">Non supporté</span>
                    ) : pushEnabled ? (
                      <span className="flex items-center gap-1.5 text-[9px] font-mono text-green-400 uppercase">
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

              {/* SECTION AGENDA */}
              <section>
                <h3 className="text-[10px] font-mono font-black uppercase tracking-widest text-white/40 mb-3 italic flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5" /> Agenda & Rappels
                </h3>
                <div className="hud-panel p-4 bg-zoyd-surface/20 border border-white/5 space-y-3">
                  <p className="text-[10px] font-mono text-white/30 leading-relaxed">
                    Télécharge un événement <strong className="text-white/60">.ics</strong> pour ajouter tes matchs et tournois à ton agenda (Google Calendar, Outlook, Apple Calendar).
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-white/60">
                      <Clock className="w-4 h-4 text-zoyd-blue" />
                      Rappel auto 10 min avant
                    </div>
                    <Button variant="secondary" size="sm" onClick={generateICS} disabled={agendaEnabled}>
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      {agendaEnabled ? 'Ajouté' : 'Ajouter au calendrier'}
                    </Button>
                  </div>
                  {agendaEnabled && (
                    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 text-[10px] font-mono text-green-400">
                      <CheckCircle className="w-3.5 h-3.5" /> Événement téléchargé. Ouvre le fichier .ics dans ton application agenda.
                    </motion.div>
                  )}
                </div>
              </section>

              {/* SECTION TYPES DE NOTIFS */}
              <section>
                <h3 className="text-[10px] font-mono font-black uppercase tracking-widest text-white/40 mb-3 italic flex items-center gap-2">
                  <Smartphone className="w-3.5 h-3.5" /> Types de notifications
                </h3>
                <div className="space-y-2">
                  <ToggleRow label="Rappels de match" icon={<Clock className="w-3.5 h-3.5" />} value={matchReminders} onChange={setMatchReminders} />
                  <ToggleRow label="Tournois & inscriptions" icon={<Calendar className="w-3.5 h-3.5" />} value={tournamentReminders} onChange={setTournamentReminders} />
                  <ToggleRow label="Activité amis" icon={<Bell className="w-3.5 h-3.5" />} value={friendActivity} onChange={setFriendActivity} />
                  <ToggleRow label="Transactions wallet" icon={<AlertCircle className="w-3.5 h-3.5" />} value={walletAlerts} onChange={setWalletAlerts} />
                  <ToggleRow label="Litiges & arbitrage" icon={<AlertCircle className="w-3.5 h-3.5" />} value={disputeAlerts} onChange={setDisputeAlerts} />
                </div>
              </section>
            </div>

            {/* FOOTER */}
            <div className="px-6 py-4 border-t border-white/5 bg-zoyd-surface/20 flex justify-end gap-3">
              <Button variant="ghost" size="sm" onClick={onClose}>Annuler</Button>
              <Button variant="primary" size="sm" onClick={onClose}>Sauvegarder</Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const ToggleRow = ({ label, icon, value, onChange }: { label: string; icon: React.ReactNode; value: boolean; onChange: (v: boolean) => void }) => (
  <div className="flex items-center justify-between px-4 py-3 bg-zoyd-surface/10 border border-white/5 hover:bg-zoyd-surface/20 transition-colors">
    <div className="flex items-center gap-3 text-xs text-white/70">
      <span className="text-white/30">{icon}</span>
      {label}
    </div>
    <button
      onClick={() => onChange(!value)}
      className={`w-9 h-5 rounded-full relative transition-colors ${value ? 'bg-zoyd-blue' : 'bg-white/10'}`}
      aria-pressed={value ? 'true' : 'false'}
      aria-label={label}
      title={label}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${value ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  </div>
);

export default NotificationSettingsModal;
