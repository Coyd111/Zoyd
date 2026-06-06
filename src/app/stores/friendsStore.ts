import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

export const useFriendsStore = create<FriendsState>()(
  persist(
    (set, get) => ({
      friends: [],
      requests: [],
      blockedIds: [],
      reports: [],

      sendRequest: (targetId, targetPseudo, message) => {
        if (get().blockedIds.includes(targetId)) return;
        const req: FriendRequest = {
          id: `FR-${Date.now()}`,
          senderId: 'me',
          senderPseudo: targetPseudo,
          status: 'pending',
          timestamp: new Date().toISOString(),
          message,
        };
        set((state) => ({ requests: [req, ...state.requests] }));
      },

      acceptRequest: (requestId) => {
        set((state) => {
          const req = state.requests.find((r) => r.id === requestId);
          if (!req) return state;
          const newFriend: Friend = {
            id: req.senderId === 'me' ? 'mock-friend-id' : req.senderId,
            pseudo: req.senderPseudo,
            country: 'CI',
            status: 'offline',
            isStreamer: false,
            controllerType: 'touch',
            trustScore: 80,
          };
          return {
            requests: state.requests.filter((r) => r.id !== requestId),
            friends: [newFriend, ...state.friends],
          };
        });
      },

      declineRequest: (requestId) => {
        set((state) => ({
          requests: state.requests.filter((r) => r.id !== requestId),
        }));
      },

      removeFriend: (friendId) => {
        set((state) => ({
          friends: state.friends.filter((f) => f.id !== friendId),
        }));
      },

      blockUser: (userId) => {
        set((state) => ({
          blockedIds: [...state.blockedIds, userId],
          friends: state.friends.filter((f) => f.id !== userId),
          requests: state.requests.filter((r) => r.senderId !== userId),
        }));
      },

      unblockUser: (userId) => {
        set((state) => ({
          blockedIds: state.blockedIds.filter((id) => id !== userId),
        }));
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
    }),
    {
      name: 'zoyd-friends',
    }
  )
);
