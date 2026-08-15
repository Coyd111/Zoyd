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
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  clearAll: () => void;
}

let toastIdCounter = 0;
const toastTimers = new Map<string, NodeJS.Timeout>();

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (toast) => {
    const id = `TOAST-${++toastIdCounter}-${Date.now()}`;
    const t: Toast = { ...toast, id };
    set((state) => ({ toasts: [...state.toasts, t] }));

    if (toast.duration > 0) {
      const timer = setTimeout(() => {
        toastTimers.delete(id);
        set((state) => ({ toasts: state.toasts.filter((x) => x.id !== id) }));
      }, toast.duration);
      toastTimers.set(id, timer);
    }
  },

  removeToast: (id) => {
    // Clear the timer if it exists
    const timer = toastTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.delete(id);
    }
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  clearAll: () => {
    // Clear all timers
    toastTimers.forEach((timer) => clearTimeout(timer));
    toastTimers.clear();
    set({ toasts: [] });
  },
}));
