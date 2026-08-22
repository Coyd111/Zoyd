import { create } from 'zustand';
import { useToastStore, type ToastType } from './toastStore';
import { markServerNotificationRead, markAllServerNotificationsRead } from '../lib/notificationApi';

export type NotificationType =
  | 'match_start'
  | 'match_invite'
  | 'tournament_reminder'
  | 'friend_request'
  | 'friend_online'
  | 'result_ready'
  | 'dispute_update'
  | 'wallet_update'
  | 'system'
  | 'arbitration_assigned'
  | 'check_in_required';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  priority: NotificationPriority;
  read: boolean;
  timestamp: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  dismissed: boolean;
}

export interface ServerNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  priority: string;
  read?: boolean;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  timestamp?: string;
}

export interface NotificationState {
  notifications: Notification[];
  // Actions
  addNotification: (n: Omit<Notification, 'id' | 'timestamp' | 'read' | 'dismissed'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
  getUnreadCount: () => number;
  getByPriority: () => Notification[];
  getRecent: (count?: number) => Notification[];
  hydrateFromServer: (serverNotifications: ServerNotification[]) => void;
}

const toastTypeByPriority: Record<NotificationPriority, ToastType> = {
  urgent: 'warning',
  high: 'info',
  normal: 'info',
  low: 'info',
};

const showBrowserNotification = async (notification: Notification) => {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
    return;
  }

  if (Notification.permission !== 'granted') {
    return;
  }

  const shouldShowBrowser =
    Boolean(notification.metadata?.showBrowser) ||
    ((notification.priority === 'high' || notification.priority === 'urgent') && document.visibilityState === 'hidden');

  if (!shouldShowBrowser) {
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(notification.title, {
    body: notification.message,
    icon: '/logo icone.png',
    badge: '/logo icone.png',
    tag: notification.metadata?.browserTag || notification.metadata?.dedupeKey || notification.id,
    requireInteraction: notification.priority === 'urgent',
    data: notification.actionUrl ? { url: notification.actionUrl } : undefined,
  });
};

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],

  addNotification: (n) => {
    const dedupeKey = typeof n.metadata?.dedupeKey === 'string' ? n.metadata.dedupeKey : null;
    let createdNotification: Notification | null = null;
    let shouldToast = false;

    set((state) => {
      if (dedupeKey) {
        const existing = state.notifications.find(
          (notification) => !notification.dismissed && notification.metadata?.dedupeKey === dedupeKey
        );

        if (existing) {
          const refreshedNotification: Notification = {
            ...existing,
            ...n,
            timestamp: new Date().toISOString(),
            read: false,
            dismissed: false,
          };
          const nextNotifications = [
            refreshedNotification,
            ...state.notifications.filter((notification) => notification.id !== existing.id),
          ];
          createdNotification = refreshedNotification;
          shouldToast =
            Boolean(n.metadata?.showToast) &&
            (existing.message !== n.message || existing.title !== n.title || existing.priority !== n.priority);
          return { notifications: nextNotifications };
        }
      }

      const notif: Notification = {
        ...n,
        id: `NOTIF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        read: false,
        dismissed: false,
      };
      createdNotification = notif;
      shouldToast = Boolean(n.metadata?.showToast) || n.priority === 'high' || n.priority === 'urgent';
      return { notifications: [notif, ...state.notifications] };
    });

    if (createdNotification && shouldToast) {
      useToastStore.getState().addToast({
        type:
          (createdNotification.metadata?.toastType as ToastType | undefined) ||
          toastTypeByPriority[createdNotification.priority],
        title: createdNotification.title,
        message: createdNotification.message,
        duration: createdNotification.priority === 'urgent' ? 7000 : 5000,
      });
    }

    if (createdNotification) {
      void showBrowserNotification(createdNotification);
    }
  },

  markAsRead: (id) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    }));
    void markServerNotificationRead(id).catch(() => undefined);
  },

  markAllAsRead: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    }));
    void markAllServerNotificationsRead().catch(() => undefined);
  },

  dismiss: (id) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, dismissed: true } : n
      ),
    }));
  },

  clearAll: () => set({ notifications: [] }),

  getUnreadCount: () => get().notifications.filter((n) => !n.read && !n.dismissed).length,

  getByPriority: () => {
    const priorityOrder: Record<NotificationPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    return [...get().notifications]
      .filter((n) => !n.dismissed)
      .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  },

  getRecent: (count = 5) =>
    get().notifications
      .filter((n) => !n.dismissed)
      .slice(0, count),

  hydrateFromServer: (serverNotifications) => {
    const nextNotifications = serverNotifications.map((n: ServerNotification) => ({
      id: n.id,
      type: n.type as NotificationType,
      title: n.title,
      message: n.message,
      priority: n.priority as NotificationPriority,
      actionUrl: n.actionUrl,
      metadata: n.metadata,
      read: n.read ?? false,
      dismissed: false,
      timestamp: n.created_at || n.timestamp || new Date().toISOString(),
    }));
    set({ notifications: nextNotifications });
  },
}));

// Selectors — use these with useNotificationStore(selector) for optimal re-render behavior
export const selectUnreadCount = (s: NotificationState) =>
  s.notifications.filter((n) => !n.read && !n.dismissed).length;

export const selectActiveNotifications = (s: NotificationState) => {
  const priorityOrder: Record<NotificationPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  return s.notifications
    .filter((n) => !n.dismissed)
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
};
