import { create } from 'zustand';
import {
  sendServerFriendRequest,
  acceptServerFriendRequest,
  declineServerFriendRequest,
  removeServerFriend,
  blockServerUser,
  unblockServerUser,
} from '../lib/socialApi';

export type FriendStatus = 'online' | 'offline' | 'in_match' | 'in_lobby';
export type FriendRequestStatus = 'pending' | 'accepted' | 'blocked' | 'declined';

export interface Friend {
  id: string;
  pseudo: string;
  avatar?: string;
  country: string;
  status: FriendStatus;
  lastSeen?: string;
  isStreamer: boolean;
  controllerType: string;
  trustScore: number;
}

export interface FriendRequest {
  id: string;
  senderId: string;
  senderPseudo: string;
  senderAvatar?: string;
  status: FriendRequestStatus;
  timestamp: string;
  message?: string;
}

export interface Report {
  id: string;
  targetId: string;
  reason: 'toxic_behavior' | 'cheating' | 'no_show' | 'harassment' | 'other';
  description: string;
  timestamp: string;
  status: 'pending' | 'reviewed' | 'resolved';
}

export interface FriendsState {
  friends: Friend[];
  requests: FriendRequest[];
  blockedIds: string[];
  reports: Report[];
  // Actions
  hydrateFromServer: (friends: Friend[], requests: FriendRequest[], blockedIds: string[]) => void;
  sendRequest: (targetId: string, targetPseudo: string, message?: string) => void;
  acceptRequest: (requestId: string) => void;
  declineRequest: (requestId: string) => void;
  removeFriend: (friendId: string) => void;
  blockUser: (userId: string) => void;
  unblockUser: (userId: string) => void;
  reportUser: (targetId: string, reason: Report['reason'], description: string) => void;
  updateFriendStatus: (friendId: string, status: FriendStatus) => void;
  isBlocked: (userId: string) => boolean;
  isFriend: (userId: string) => boolean;
  getOnlineFriends: () => Friend[];
}

export const useFriendsStore = create<FriendsState>()((set, get) => ({
  friends: [],
  requests: [],
  blockedIds: [],
  reports: [],

  hydrateFromServer: (friends, requests, blockedIds) => {
    set({ friends, requests, blockedIds });
  },

  sendRequest: async (targetId, _targetPseudo, message) => {
    if (get().blockedIds.includes(targetId)) return;
    try {
      const res = await sendServerFriendRequest(targetId, message);
      if (res.ok && res.request) {
        set((state) => ({ requests: [res.request, ...state.requests] }));
      }
    } catch (error) {
      console.error('Erreur envoi demande ami:', error);
    }
  },

  acceptRequest: async (requestId) => {
    try {
      const res = await acceptServerFriendRequest(requestId);
      if (res.ok && res.friend) {
        set((state) => ({
          requests: state.requests.filter((r) => r.id !== requestId),
          friends: [res.friend, ...state.friends],
        }));
      }
    } catch (error) {
      console.error('Erreur acceptation demande:', error);
    }
  },

  declineRequest: async (requestId) => {
    try {
      await declineServerFriendRequest(requestId);
      set((state) => ({
        requests: state.requests.filter((r) => r.id !== requestId),
      }));
    } catch (error) {
      console.error('Erreur refus demande:', error);
    }
  },

  removeFriend: async (friendId) => {
    try {
      await removeServerFriend(friendId);
      set((state) => ({
        friends: state.friends.filter((f) => f.id !== friendId),
      }));
    } catch (error) {
      console.error('Erreur suppression ami:', error);
    }
  },

  blockUser: async (userId) => {
    try {
      await blockServerUser(userId);
      set((state) => ({
        blockedIds: [...state.blockedIds, userId],
        friends: state.friends.filter((f) => f.id !== userId),
        requests: state.requests.filter((r) => r.senderId !== userId),
      }));
    } catch (error) {
      console.error('Erreur blocage:', error);
    }
  },

  unblockUser: async (userId) => {
    try {
      await unblockServerUser(userId);
      set((state) => ({
        blockedIds: state.blockedIds.filter((id) => id !== userId),
      }));
    } catch (error) {
      console.error('Erreur deblocage:', error);
    }
  },

  reportUser: (targetId, reason, description) => {
    const report: Report = {
      id: `RP-${Date.now()}`,
      targetId,
      reason,
      description,
      timestamp: new Date().toISOString(),
      status: 'pending',
    };
    set((state) => ({ reports: [report, ...state.reports] }));
  },

  updateFriendStatus: (friendId, status) => {
    set((state) => ({
      friends: state.friends.map((f) =>
        f.id === friendId ? { ...f, status, lastSeen: new Date().toISOString() } : f
      ),
    }));
  },

  isBlocked: (userId) => get().blockedIds.includes(userId),
  isFriend: (userId) => get().friends.some((f) => f.id === userId),
  getOnlineFriends: () => get().friends.filter((f) => f.status === 'online' || f.status === 'in_match' || f.status === 'in_lobby'),
}));
