import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNotificationStore } from './notificationStore';

vi.mock('../lib/notificationApi', () => ({
  markServerNotificationRead: vi.fn().mockResolvedValue({ ok: true }),
  markAllServerNotificationsRead: vi.fn().mockResolvedValue({ ok: true }),
}));

const makeNotif = (overrides = {}) => ({
  id: `n-${Date.now()}`,
  type: 'match_start' as const,
  title: 'Match',
  message: 'Le match commence',
  priority: 'normal' as const,
  read: false,
  timestamp: new Date().toISOString(),
  dismissed: false,
  ...overrides,
});

describe('notificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [] });
  });

  it('should add a notification', () => {
    useNotificationStore.getState().addNotification({
      type: 'friend_request',
      title: 'Ami',
      message: 'Demande',
      priority: 'normal',
    });
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });

  it('should mark as read', () => {
    useNotificationStore.getState().addNotification({
      type: 'system',
      title: 'Sys',
      message: 'Info',
      priority: 'low',
    });
    const id = useNotificationStore.getState().notifications[0].id;
    useNotificationStore.getState().markAsRead(id);
    expect(useNotificationStore.getState().notifications[0].read).toBe(true);
  });

  it('should mark all as read', () => {
    useNotificationStore.getState().addNotification({ type: 'system', title: 'A', message: '', priority: 'low' });
    useNotificationStore.getState().addNotification({ type: 'system', title: 'B', message: '', priority: 'low' });
    useNotificationStore.getState().markAllAsRead();
    const allRead = useNotificationStore.getState().notifications.every((n) => n.read);
    expect(allRead).toBe(true);
  });

  it('should dismiss a notification', () => {
    useNotificationStore.getState().addNotification({ type: 'system', title: 'X', message: '', priority: 'low' });
    const id = useNotificationStore.getState().notifications[0].id;
    useNotificationStore.getState().dismiss(id);
    expect(useNotificationStore.getState().notifications[0].dismissed).toBe(true);
  });

  it('should compute unread count', () => {
    useNotificationStore.getState().addNotification({ type: 'system', title: 'A', message: '', priority: 'low' });
    useNotificationStore.getState().addNotification({ type: 'system', title: 'B', message: '', priority: 'low' });
    expect(useNotificationStore.getState().getUnreadCount()).toBe(2);
    const id = useNotificationStore.getState().notifications[0].id;
    useNotificationStore.getState().markAsRead(id);
    expect(useNotificationStore.getState().getUnreadCount()).toBe(1);
  });

  it('should clear all', () => {
    useNotificationStore.getState().addNotification({ type: 'system', title: 'A', message: '', priority: 'low' });
    useNotificationStore.getState().clearAll();
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });
});
