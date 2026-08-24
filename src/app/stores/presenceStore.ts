import { create } from 'zustand';
import type { Match } from './matchStore';
import {
  emitChannelSeen,
  emitPresenceJoin,
  emitPresenceLeave,
  emitTypingUpdate,
  isRealtimeSocketConnected,
  type ServerPresenceSnapshot,
  type ServerTypingSnapshot,
} from '../lib/realtimeClient';

type PresenceRole = 'player' | 'arbiter' | 'spectator';

export interface RoomPresenceMember {
  userId: string;
  pseudo: string;
  role: PresenceRole;
  team?: 0 | 1;
  isCheckedIn: boolean;
  isReady: boolean;
  isOnline: boolean;
  lastActiveAt?: string;
}

export interface TypingMember {
  userId: string;
  pseudo: string;
  startedAt: string;
}

interface ChannelJoinDetails {
  role?: PresenceRole;
  team?: 0 | 1;
  isCheckedIn?: boolean;
  isReady?: boolean;
}

const getNow = () => new Date().toISOString();

const normalizePresenceMember = (member: Partial<RoomPresenceMember> & Pick<RoomPresenceMember, 'userId' | 'pseudo'>): RoomPresenceMember => ({
  userId: member.userId,
  pseudo: member.pseudo,
  role: member.role || 'spectator',
  team: member.team,
  isCheckedIn: Boolean(member.isCheckedIn),
  isReady: Boolean(member.isReady),
  isOnline: Boolean(member.isOnline),
  lastActiveAt: member.lastActiveAt,
});

const buildPresenceFromMatch = (
  match: Match,
  currentChannelPresence: RoomPresenceMember[] = [],
  activeChannelIds: string[],
  currentUserId?: string
): RoomPresenceMember[] => {
  const currentPresenceMap = new Map(currentChannelPresence.map((member) => [member.userId, member]));
  const channelIsActive = activeChannelIds.includes(match.channelId);

  const players = match.players.map<RoomPresenceMember>((player) => {
    const existing = currentPresenceMap.get(player.userId);
    const tacticallyPresent =
      Boolean(existing?.isOnline) ||
      player.isReady ||
      player.isCheckedIn ||
      match.status === 'in_progress' ||
      (channelIsActive && currentUserId === player.userId);

    return {
      userId: player.userId,
      pseudo: player.pseudo,
      role: 'player',
      team: player.team,
      isCheckedIn: player.isCheckedIn,
      isReady: player.isReady,
      isOnline: tacticallyPresent,
      lastActiveAt: existing?.lastActiveAt || (tacticallyPresent ? getNow() : undefined),
    };
  });

  const arbiter = match.arbiter
    ? [
        {
          userId: match.arbiter.userId,
          pseudo: match.arbiter.pseudo,
          role: 'arbiter' as const,
          isCheckedIn: true,
          isReady: match.status === 'ready' || match.status === 'in_progress',
          isOnline:
            Boolean(currentPresenceMap.get(match.arbiter.userId)?.isOnline) ||
            match.status === 'ready' ||
            match.status === 'in_progress' ||
            Boolean(match.arbiter.roomPublishedAt) ||
            (channelIsActive && currentUserId === match.arbiter.userId),
          lastActiveAt:
            currentPresenceMap.get(match.arbiter.userId)?.lastActiveAt ||
            match.arbiter.roomPublishedAt ||
            undefined,
        },
      ]
    : [];

  const viewers = currentChannelPresence.filter(
    (member) =>
      member.role === 'spectator' &&
      !players.some((player) => player.userId === member.userId) &&
      !arbiter.some((entry) => entry.userId === member.userId)
  );

  return [...players, ...arbiter, ...viewers].map(normalizePresenceMember);
};

const trimTypingState = (typing: Record<string, TypingMember[]>) => {
  const cutoff = Date.now() - 6000;
  return Object.fromEntries(
    Object.entries(typing).map(([channelId, members]) => [
      channelId,
      members.filter((member) => new Date(member.startedAt).getTime() >= cutoff),
    ])
  );
};

export const buildCurrentUserPresencePayload = (match: Match, currentUser: { id: string; pseudo: string }) => {
  const player = match.players.find((entry) => entry.userId === currentUser.id);
  const isArbiter = match.arbiter?.userId === currentUser.id;

  if (!player && !isArbiter) {
    return null;
  }

  return {
    channelId: match.channelId,
    userId: currentUser.id,
    pseudo: currentUser.pseudo,
    role: isArbiter ? ('arbiter' as const) : player ? ('player' as const) : ('spectator' as const),
    team: player?.team,
    isCheckedIn: player?.isCheckedIn || isArbiter,
    isReady: player?.isReady || match.status === 'ready' || match.status === 'in_progress',
  };
};

export { buildPresenceFromMatch, trimTypingState };

interface PresenceState {
  activeChannelIds: string[];
  roomPresence: Record<string, RoomPresenceMember[]>;
  typingByChannel: Record<string, TypingMember[]>;
  seenByChannel: Record<string, Record<string, string>>;
  joinChannel: (channelId: string, userId: string, pseudo: string, details?: ChannelJoinDetails) => void;
  leaveChannel: (channelId: string, userId: string) => void;
  markChannelSeen: (channelId: string, userId: string) => void;
  setTyping: (channelId: string, userId: string, pseudo: string, isTyping: boolean) => void;
  clearPresence: () => void;
  applyServerPresenceSnapshot: (snapshot: ServerPresenceSnapshot) => void;
  applyServerTypingSnapshot: (snapshot: ServerTypingSnapshot) => void;
  getChannelPresence: (channelId: string) => RoomPresenceMember[];
  getPresenceSummary: (channelId: string) => {
    onlineCount: number;
    checkedInCount: number;
    readyCount: number;
    arbiterOnline: boolean;
    total: number;
  };
  getTypingUsers: (channelId: string, currentUserId?: string) => TypingMember[];
  isChannelLive: (channelId: string) => boolean;
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  activeChannelIds: [],
  roomPresence: {},
  typingByChannel: {},
  seenByChannel: {},

  joinChannel: (channelId, userId, pseudo, details = {}) => {
    set((state) => {
      const currentMembers = state.roomPresence[channelId] || [];
      const existing = currentMembers.find((member) => member.userId === userId);
      const nextMembers = existing
        ? currentMembers.map((member) =>
            member.userId === userId
              ? {
                  ...member,
                  ...details,
                  isOnline: true,
                  lastActiveAt: getNow(),
                }
              : member
          )
        : [
            ...currentMembers,
            normalizePresenceMember({
              userId,
              pseudo,
              role: details.role || 'spectator',
              team: details.team,
              isCheckedIn: details.isCheckedIn,
              isReady: details.isReady,
              isOnline: true,
              lastActiveAt: getNow(),
            }),
          ];

      return {
        activeChannelIds: state.activeChannelIds.includes(channelId)
          ? state.activeChannelIds
          : [...state.activeChannelIds, channelId],
        roomPresence: {
          ...state.roomPresence,
          [channelId]: nextMembers,
        },
      };
    });

    if (isRealtimeSocketConnected()) {
      emitPresenceJoin({
        channelId,
        userId,
        pseudo,
        ...details,
      });
    }
  },

  leaveChannel: (channelId, userId) => {
    set((state) => ({
      activeChannelIds: state.activeChannelIds.filter((id) => id !== channelId),
      roomPresence: {
        ...state.roomPresence,
        [channelId]: (state.roomPresence[channelId] || []).map((member) =>
          member.userId === userId
            ? {
                ...member,
                isOnline: false,
                lastActiveAt: getNow(),
              }
            : member
        ),
      },
      typingByChannel: {
        ...state.typingByChannel,
        [channelId]: (state.typingByChannel[channelId] || []).filter((member) => member.userId !== userId),
      },
    }));

    if (isRealtimeSocketConnected()) {
      emitPresenceLeave({ channelId });
    }
  },

  markChannelSeen: (channelId, userId) => {
    set((state) => ({
      seenByChannel: {
        ...state.seenByChannel,
        [channelId]: {
          ...(state.seenByChannel[channelId] || {}),
          [userId]: getNow(),
        },
      },
      roomPresence: {
        ...state.roomPresence,
        [channelId]: (state.roomPresence[channelId] || []).map((member) =>
          member.userId === userId ? { ...member, lastActiveAt: getNow(), isOnline: true } : member
        ),
      },
    }));

    if (isRealtimeSocketConnected()) {
      emitChannelSeen({ channelId, userId });
    }
  },

  setTyping: (channelId, userId, pseudo, isTyping) => {
    set((state) => {
      const currentTyping = state.typingByChannel[channelId] || [];
      const nextTyping = isTyping
        ? [
            ...currentTyping.filter((member) => member.userId !== userId),
            { userId, pseudo, startedAt: getNow() },
          ]
        : currentTyping.filter((member) => member.userId !== userId);

      return {
        typingByChannel: {
          ...state.typingByChannel,
          [channelId]: nextTyping,
        },
      };
    });

    if (isRealtimeSocketConnected()) {
      emitTypingUpdate({ channelId, userId, pseudo, isTyping });
    }
  },

  clearPresence: () => {
    set({
      activeChannelIds: [],
      roomPresence: {},
      typingByChannel: {},
    });
  },

  applyServerPresenceSnapshot: (snapshot) => {
    set((state) => ({
      roomPresence: {
        ...state.roomPresence,
        [snapshot.channelId]: snapshot.members.map(normalizePresenceMember),
      },
      seenByChannel: {
        ...state.seenByChannel,
        [snapshot.channelId]: snapshot.seen,
      },
    }));
  },

  applyServerTypingSnapshot: (snapshot) => {
    set((state) => ({
      typingByChannel: {
        ...state.typingByChannel,
        [snapshot.channelId]: snapshot.members,
      },
    }));
  },

  getChannelPresence: (channelId) => get().roomPresence[channelId] || [],

  getPresenceSummary: (channelId) => {
    const members = get().roomPresence[channelId] || [];
    return {
      onlineCount: members.filter((member) => member.isOnline).length,
      checkedInCount: members.filter((member) => member.isCheckedIn).length,
      readyCount: members.filter((member) => member.isReady).length,
      arbiterOnline: members.some((member) => member.role === 'arbiter' && member.isOnline),
      total: members.length,
    };
  },

  getTypingUsers: (channelId, currentUserId) =>
    (get().typingByChannel[channelId] || []).filter((member) => member.userId !== currentUserId),

  isChannelLive: (channelId) => get().activeChannelIds.includes(channelId),
}));
