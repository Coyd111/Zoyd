import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration: number;
  action?: { label: string; onClick: () => void };
}

export interface ToastState {
  toasts: Toast[];
  idCounter: number;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  clearAll: () => void;
}

const toastTimers = new Map<string, NodeJS.Timeout>();

export function cleanupToastTimers() {
  toastTimers.forEach((timer) => clearTimeout(timer));
  toastTimers.clear();
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  idCounter: 0,

  addToast: (toast) => {
    set((state) => {
      const id = `TOAST-${state.idCounter + 1}-${Date.now()}`;
      const t: Toast = { ...toast, id };

      if (toast.duration > 0) {
        const timer = setTimeout(() => {
          toastTimers.delete(id);
          set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
        }, toast.duration);
        toastTimers.set(id, timer);
      }

      return { toasts: [...state.toasts, t], idCounter: state.idCounter + 1 };
    });
  },

  removeToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.delete(id);
    }
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  clearAll: () => {
    cleanupToastTimers();
    set({ toasts: [] });
  },
}));
