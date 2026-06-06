import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle, AlertTriangle, XCircle, Info, X, ExternalLink } from 'lucide-react';
import { useToastStore } from '../../stores/toastStore';
import type { ToastType } from '../../stores/toastStore';

const toastConfig: Record<ToastType, { icon: React.ReactNode; border: string; bg: string; text: string }> = {
  success: {
    icon: <CheckCircle className="w-4 h-4 text-green-400" />,
    border: 'border-green-500/30',
    bg: 'bg-green-500/5',
    text: 'text-green-400',
  },
  error: {
    icon: <XCircle className="w-4 h-4 text-red-400" />,
    border: 'border-red-500/30',
    bg: 'bg-red-500/5',
    text: 'text-red-400',
  },
  warning: {
    icon: <AlertTriangle className="w-4 h-4 text-orange-400" />,
    border: 'border-orange-500/30',
    bg: 'bg-orange-500/5',
    text: 'text-orange-400',
  },
  info: {
    icon: <Info className="w-4 h-4 text-zoyd-blue" />,
    border: 'border-zoyd-blue/30',
    bg: 'bg-zoyd-blue/5',
    text: 'text-zoyd-blue',
  },
};

const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore();

  return (
    <div
      className="fixed top-16 right-4 z-[70] flex flex-col gap-3 w-[360px] max-w-[calc(100vw-2rem)]"
      aria-live="polite"
      aria-atomic="true"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => {
          const cfg = toastConfig[toast.type];
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, x: 60, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className={`relative border ${cfg.border} ${cfg.bg} backdrop-blur-sm p-4 shadow-lg shadow-black/40`}
              role="alert"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">{cfg.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-display font-black uppercase tracking-tight ${cfg.text}`}>
                    {toast.title}
                  </p>
                  {toast.message && (
                    <p className="text-[11px] font-ui text-white/50 mt-1 leading-relaxed">{toast.message}</p>
                  )}
                  {toast.action && (
                    <button
                      onClick={() => {
                        toast.action?.onClick?.();
                        removeToast(toast.id);
                      }}
                      className="mt-2 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-white/40 hover:text-zoyd-yellow transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      {toast.action.label}
                    </button>
                  )}
                </div>
                <button
                  onClick={() => removeToast(toast.id)}
                  className="text-white/20 hover:text-white transition-colors shrink-0 -mt-0.5"
                  aria-label="Fermer la notification"
                  title="Fermer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Progress bar */}
              {toast.duration > 0 && (
                <motion.div
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: 0 }}
                  transition={{ duration: toast.duration / 1000, ease: 'linear' }}
                  className={`absolute bottom-0 left-0 right-0 h-[2px] origin-left ${cfg.text.replace('text-', 'bg-')}`}
                />
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export default ToastContainer;
