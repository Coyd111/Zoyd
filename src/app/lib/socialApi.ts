import { authorizedPost, authorizedDelete } from './apiClient';
import type { Friend, FriendRequest } from '../stores/friendsStore';

export interface Report {
  id: string;
  reporterId: string;
  reporterPseudo: string;
  targetId: string;
  reason: string;
  description: string;
  status: string;
  createdAt: string;
}

export const sendServerFriendRequest = async (targetId: string, message?: string) => {
  try {
    return await authorizedPost<{ ok: boolean; request: FriendRequest }>('/api/social/request', { targetId, message });
  } catch (error) {
    throw error;
  }
};

export const acceptServerFriendRequest = async (requestId: string) => {
  try {
    return await authorizedPost<{ ok: boolean; friend: Friend }>('/api/social/accept', { requestId });
  } catch (error) {
    throw error;
  }
};

export const declineServerFriendRequest = async (requestId: string) => {
  try {
    return await authorizedPost<{ ok: boolean }>('/api/social/decline', { requestId });
  } catch (error) {
    throw error;
  }
};

export const removeServerFriend = async (friendId: string) => {
  try {
    return await authorizedDelete<{ ok: boolean }>(`/api/social/friends/${friendId}`);
  } catch (error) {
    throw error;
  }
};

export const blockServerUser = async (targetId: string) => {
  try {
    return await authorizedPost<{ ok: boolean }>('/api/social/block', { targetId });
  } catch (error) {
    throw error;
  }
};

export const unblockServerUser = async (targetId: string) => {
  try {
    return await authorizedPost<{ ok: boolean }>('/api/social/unblock', { targetId });
  } catch (error) {
    throw error;
  }
};

export const reportServerUser = async (targetId: string, reason: string, description: string) => {
  try {
    return await authorizedPost<{ ok: boolean; report: Report }>('/api/social/report', { targetId, reason, description });
  } catch (error) {
    throw error;
  }
};
