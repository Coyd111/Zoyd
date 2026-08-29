import { create } from 'zustand';
import {
  sendServerFriendRequest,
  acceptServerFriendRequest,
  declineServerFriendRequest,
  removeServerFriend,
  blockServerUser,
  unblockServerUser,
  reportServerUser,
} from '../lib/socialApi';
import { useToastStore } from './toastStore';

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
  pendingId: string | null;
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
  pendingId: null,

  hydrateFromServer: (friends, requests, blockedIds) => {
    set({ friends, requests, blockedIds });
  },

  sendRequest: async (targetId, _targetPseudo, message) => {
    if (get().blockedIds.includes(targetId)) return;
    if (get().pendingId) return;
    set({ pendingId: targetId });
    try {
      const res = await sendServerFriendRequest(targetId, message);
      if (res.ok && res.request) {
        set((state) => ({ requests: [res.request, ...state.requests] }));
      }
    } catch {
      useToastStore.getState().addToast({ type: 'error', title: 'Erreur', message: "Impossible d'envoyer la demande d'ami.", duration: 4000 });
    } finally {
      set({ pendingId: null });
    }
  },

  acceptRequest: async (requestId) => {
    if (get().pendingId) return;
    set({ pendingId: requestId });
    try {
      const res = await acceptServerFriendRequest(requestId);
      if (res.ok && res.friend) {
        set((state) => ({
          requests: state.requests.filter((r) => r.id !== requestId),
          friends: [res.friend, ...state.friends],
        }));
      }
    } catch {
      useToastStore.getState().addToast({ type: 'error', title: 'Erreur', message: "Impossible d'accepter la demande.", duration: 4000 });
    } finally {
      set({ pendingId: null });
    }
  },

  declineRequest: async (requestId) => {
    if (get().pendingId) return;
    set({ pendingId: requestId });
    try {
      await declineServerFriendRequest(requestId);
      set((state) => ({
        requests: state.requests.filter((r) => r.id !== requestId),
      }));
    } catch {
      useToastStore.getState().addToast({ type: 'error', title: 'Erreur', message: "Impossible de refuser la demande.", duration: 4000 });
    } finally {
      set({ pendingId: null });
    }
  },

  removeFriend: async (friendId) => {
    if (get().pendingId) return;
    set({ pendingId: friendId });
    try {
      await removeServerFriend(friendId);
      set((state) => ({
        friends: state.friends.filter((f) => f.id !== friendId),
      }));
    } catch {
      useToastStore.getState().addToast({ type: 'error', title: 'Erreur', message: "Impossible de retirer l'ami.", duration: 4000 });
    } finally {
      set({ pendingId: null });
    }
  },

  blockUser: async (userId) => {
    if (get().pendingId) return;
    set({ pendingId: userId });
    try {
      await blockServerUser(userId);
      set((state) => ({
        blockedIds: [...state.blockedIds, userId],
        friends: state.friends.filter((f) => f.id !== userId),
        requests: state.requests.filter((r) => r.senderId !== userId),
      }));
    } catch {
      useToastStore.getState().addToast({ type: 'error', title: 'Erreur', message: "Impossible de bloquer l'utilisateur.", duration: 4000 });
    } finally {
      set({ pendingId: null });
    }
  },

  unblockUser: async (userId) => {
    if (get().pendingId) return;
    set({ pendingId: userId });
    try {
      await unblockServerUser(userId);
      set((state) => ({
        blockedIds: state.blockedIds.filter((id) => id !== userId),
      }));
    } catch {
      useToastStore.getState().addToast({ type: 'error', title: 'Erreur', message: "Impossible de débloquer l'utilisateur.", duration: 4000 });
    } finally {
      set({ pendingId: null });
    }
  },

  reportUser: async (targetId, reason, description) => {
    if (get().pendingId) return;
    set({ pendingId: targetId });
    try {
      await reportServerUser(targetId, reason, description);
      const report: Report = {
        id: `RP-${Date.now()}`,
        targetId,
        reason,
        description,
        timestamp: new Date().toISOString(),
        status: 'pending',
      };
      set((state) => ({ reports: [report, ...state.reports] }));
      useToastStore.getState().addToast({ type: 'success', title: 'Signalement envoyé', message: "Merci pour votre signalement.", duration: 4000 });
    } catch {
      useToastStore.getState().addToast({ type: 'error', title: 'Erreur', message: "Impossible d'envoyer le signalement.", duration: 4000 });
    } finally {
      set({ pendingId: null });
    }
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
