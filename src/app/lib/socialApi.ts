import { authorizedPost, authorizedDelete } from './apiClient';
import type { Friend, FriendRequest } from '../stores/friendsStore';

export const sendServerFriendRequest = async (targetId: string, message?: string) => {
  return authorizedPost<{ ok: boolean; request: FriendRequest }>('/api/social/request', { targetId, message });
};

export const acceptServerFriendRequest = async (requestId: string) => {
  return authorizedPost<{ ok: boolean; friend: Friend }>('/api/social/accept', { requestId });
};

export const declineServerFriendRequest = async (requestId: string) => {
  return authorizedPost<{ ok: boolean }>('/api/social/decline', { requestId });
};

export const removeServerFriend = async (friendId: string) => {
  return authorizedDelete<{ ok: boolean }>(`/api/social/friends/${friendId}`);
};

export const blockServerUser = async (targetId: string) => {
  return authorizedPost<{ ok: boolean }>('/api/social/block', { targetId });
};

export const unblockServerUser = async (targetId: string) => {
  return authorizedPost<{ ok: boolean }>('/api/social/unblock', { targetId });
};
