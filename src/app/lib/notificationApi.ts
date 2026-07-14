import { authorizedPost } from './apiClient';

export const markServerNotificationRead = async (notificationId: string) => {
  return authorizedPost<{ ok: boolean; success: boolean }>('/api/notifications/read', {
    notificationId
  });
};

export const markAllServerNotificationsRead = async () => {
  return authorizedPost<{ ok: boolean; changes: number }>('/api/notifications/read-all');
};
