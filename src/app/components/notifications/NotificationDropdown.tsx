import React, { useRef, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { Bell, Check, Trash2, X, Swords, Trophy, UserPlus, AlertTriangle, Wallet, ShieldCheck, Calendar, Clock } from 'lucide-react';
import { useNotificationStore, type Notification, type NotificationType, selectUnreadCount } from '../../stores/notificationStore';
import { useServiceWorker } from '../../hooks/useServiceWorker';

const SAFE_PROTOCOLS = ['https:', 'http:'];

const safeNavigate = (navigate: ReturnType<typeof useNavigate>, actionUrl: string) => {
  try {
    const url = new URL(actionUrl, window.location.origin);
    if (SAFE_PROTOCOLS.includes(url.protocol) && url.origin === window.location.origin) {
      navigate(url.pathname + url.search + url.hash);
    }
  } catch {
    navigate('/');
  }
};

const typeIcons: Record<NotificationType, React.ReactNode> = {
  match_start: <Swords className="w-3.5 h-3.5 text-zoyd-yellow" />,
  match_invite: <Swords className="w-3.5 h-3.5 text-zoyd-blue" />,
  tournament_reminder: <Trophy className="w-3.5 h-3.5 text-purple-400" />,
  friend_request: <UserPlus className="w-3.5 h-3.5 text-green-400" />,
  friend_online: <UserPlus className="w-3.5 h-3.5 text-green-400" />,
  result_ready: <Trophy className="w-3.5 h-3.5 text-zoyd-yellow" />,
  dispute_update: <AlertTriangle className="w-3.5 h-3.5 text-red-400" />,
  wallet_update: <Wallet className="w-3.5 h-3.5 text-zoyd-yellow" />,
  system: <ShieldCheck className="w-3.5 h-3.5 text-white/40" />,
  arbitration_assigned: <ShieldCheck className="w-3.5 h-3.5 text-zoyd-blue" />,
  check_in_required: <Clock className="w-3.5 h-3.5 text-orange-400" />,
};

const priorityBadge: Record<Notification['priority'], string> = {
  urgent: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  normal: 'bg-white/5 text-white/30 border-white/10',
  low: 'bg-white/5 text-white/40 border-white/5',
};

export const NotificationDropdown: React.FC = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const notifications = useNotificationStore((s) => s.notifications);
  const unread = useNotificationStore(selectUnreadCount);
  const { notificationPermission, requestNotificationPermission } = useServiceWorker();

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle, { passive: true });
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const visible = notifications.filter((n) => !n.dismissed).slice(0, 15);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative text-white/40 hover:text-white transition-colors p-1 touch-target"
        aria-label="Notifications"
        aria-expanded={open ? 'true' : 'false'}
        aria-haspopup="menu"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-zoyd-blue rounded-full flex items-center justify-center text-[8px] font-mono font-black text-white animate-pulse">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-12 w-[380px] bg-zoyd-black border border-white/10 shadow-2xl shadow-black/80 z-50"
          >
            {/* HEADER */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-zoyd-surface/30">
              <span className="text-[10px] font-mono font-black uppercase tracking-widest text-white/40 italic">Notifications</span>
              <div className="flex items-center gap-2">
                {unread > 0 && (
                  <button
                    onClick={() => markAllAsRead()}
                    className="text-[9px] font-mono uppercase tracking-wider text-zoyd-blue hover:text-white transition-colors flex items-center gap-1"
                    aria-label="Tout marquer comme lu"
                  >
                    <Check className="w-3 h-3" /> Tout lire
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white transition-colors" aria-label="Fermer">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* LIST */}
            <div className="max-h-[420px] overflow-y-auto">
              {notificationPermission !== 'granted' ? (
                <div className="px-4 py-3 border-b border-white/5 bg-zoyd-blue/5">
                  <button
                    onClick={() => void requestNotificationPermission()}
                    className="w-full text-left text-[10px] font-mono uppercase tracking-widest text-zoyd-blue hover:text-white transition-colors"
                  >
                    Activer les alertes navigateur
                  </button>
                </div>
              ) : null}
              {visible.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Bell className="w-8 h-8 text-white/10 mx-auto mb-3" />
                  <p className="text-white/40 text-xs font-mono uppercase tracking-widest">Aucune notification</p>
                </div>
              ) : (
                visible.map((n) => (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    className={`px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer ${n.read ? 'opacity-60' : ''}`}
                    onClick={() => {
                      if (!n.read) markAsRead(n.id);
                      if (n.actionUrl) safeNavigate(navigate, n.actionUrl);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (!n.read) markAsRead(n.id);
                        if (n.actionUrl) safeNavigate(navigate, n.actionUrl);
                      }
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">{typeIcons[n.type]}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-[9px] font-mono font-black uppercase tracking-wider px-1.5 py-0.5 border ${priorityBadge[n.priority]}`}>
                            {n.priority}
                          </span>
                          <span className="text-[9px] font-mono text-white/40">{new Date(n.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className="text-xs font-display font-bold text-white uppercase tracking-tight truncate">{n.title}</p>
                        <p className="text-[10px] font-ui text-white/40 leading-relaxed line-clamp-2">{n.message}</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                        className="text-white/10 hover:text-red-400 transition-colors mt-0.5 touch-target flex items-center justify-center"
                        aria-label="Supprimer la notification"
                        title="Supprimer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {!n.read && <div className="w-1.5 h-1.5 bg-zoyd-blue rounded-full mt-2 ml-6" />}
                  </div>
                ))
              )}
            </div>

            {/* FOOTER */}
            {visible.length > 0 && (
              <div className="px-4 py-2 border-t border-white/5 bg-zoyd-surface/20 text-center">
                <Link to="/parametres" onClick={() => setOpen(false)} className="text-[9px] font-mono uppercase tracking-wider text-white/30 hover:text-zoyd-yellow transition-colors">
                  Paramètres de notification →
                </Link>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default NotificationDropdown;
