import { create } from 'zustand';
import type { User } from './authStore';
import { useChatStore } from './chatStore';
import type { Match } from './matchStore';
import type { Tournament } from './tournamentStore';
import { useFriendsStore } from './friendsStore';
import { useNotificationStore } from './notificationStore';
import {
  bindRealtimeHandlers,
  connectRealtimeSocket,
  disconnectRealtimeSocket,
  emitChannelSeen,
  emitPresenceJoin,
  emitPresenceLeave,
  emitPresenceUpdate,
  emitTypingUpdate,
  fetchRealtimeBootstrap,
  isRealtimeSocketConnected,
  syncRealtimeState,
  type PushDeliveryPayload,
  type ServerPresenceSnapshot,
  type ServerTypingSnapshot,
} from '../lib/realtimeClient';

type PresenceRole = 'player' | 'arbiter' | 'spectator';

export interface LiveMatchSnapshot {
  id: string;
  channelId: string;
  player1: string;
  player2: string;
  format: string;
  pot: number;
  status: Match['status'];
  roomReady: boolean;
}

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

interface SocketState {
  isConnected: boolean;
  serverConnected: boolean;
  connectionLabel: 'offline' | 'syncing' | 'live';
  latencyMs: number;
  lastHeartbeatAt?: string;
  liveMatches: LiveMatchSnapshot[];
  remoteMatchSnapshots: Match[];
  remoteTournamentSnapshots: Tournament[];
  activeChannelIds: string[];
  roomPresence: Record<string, RoomPresenceMember[]>;
  typingByChannel: Record<string, TypingMember[]>;
  seenByChannel: Record<string, Record<string, string>>;
  connect: (user?: User | null) => void;
  disconnect: () => void;
  syncFromMatches: (matches: Match[], currentUser?: User | null) => void;
  syncServerState: (kind: 'matches' | 'tournaments', items: Match[] | Tournament[], user?: User | null) => Promise<void>;
  bootstrapServerState: (user?: User | null) => Promise<void>;
  joinChannel: (channelId: string, userId: string, pseudo: string, details?: ChannelJoinDetails) => void;
  leaveChannel: (channelId: string, userId: string) => void;
  markChannelSeen: (channelId: string, userId: string) => void;
  setTyping: (channelId: string, userId: string, pseudo: string, isTyping: boolean) => void;
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

const getNow = () => new Date().toISOString();
const LIVE_STATUSES: Match['status'][] = ['ready', 'in_progress'];
const ACTIVE_STATUSES: Match['status'][] = ['check_in', 'ready', 'in_progress'];

const getLeadPseudo = (match: Match, team: 0 | 1) =>
  match.players.find((player) => player.team === team)?.pseudo || (team === 0 ? 'Squad Alpha' : 'Squad Bravo');

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

const pushRealtimeReminder = (
  type: 'check_in_required' | 'match_start' | 'arbitration_assigned' | 'dispute_update' | 'system',
  title: string,
  message: string,
  actionUrl: string,
  dedupeKey: string,
  priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal'
) => {
  useNotificationStore.getState().addNotification({
    type,
    title,
    message,
    priority,
    actionUrl,
    metadata: {
      dedupeKey,
      showToast: priority === 'high' || priority === 'urgent',
      showBrowser: priority === 'high' || priority === 'urgent',
    },
  });
};

const buildCurrentUserPresencePayload = (match: Match, currentUser: User) => {
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

const deliverServerNotification = (payload: PushDeliveryPayload) => {
  useNotificationStore.getState().addNotification({
    type: 'system',
    title: payload.title,
    message: payload.body || 'Notification ZOYD',
    priority: payload.requireInteraction ? 'urgent' : 'high',
    actionUrl: payload.url,
    metadata: {
      dedupeKey: `server-push-${payload.tag || payload.title}-${payload.url || '/'}`,
      showToast: true,
      showBrowser: true,
      browserTag: payload.tag,
      source: 'server-push',
    },
  });
};

const applyServerPresenceSnapshot = (
  snapshot: ServerPresenceSnapshot,
  state: SocketState
): Pick<SocketState, 'roomPresence' | 'seenByChannel' | 'lastHeartbeatAt'> => ({
  roomPresence: {
    ...state.roomPresence,
    [snapshot.channelId]: snapshot.members.map(normalizePresenceMember),
  },
  seenByChannel: {
    ...state.seenByChannel,
    [snapshot.channelId]: snapshot.seen,
  },
  lastHeartbeatAt: getNow(),
});

const applyServerTypingSnapshot = (
  snapshot: ServerTypingSnapshot,
  state: SocketState
): Pick<SocketState, 'typingByChannel' | 'lastHeartbeatAt'> => ({
  typingByChannel: {
    ...state.typingByChannel,
    [snapshot.channelId]: snapshot.members,
  },
  lastHeartbeatAt: getNow(),
});

export const useSocketStore = create<SocketState>((set, get) => ({
  isConnected: false,
  serverConnected: false,
  connectionLabel: 'offline',
  latencyMs: 18,
  lastHeartbeatAt: undefined,
  liveMatches: [],
  remoteMatchSnapshots: [],
  remoteTournamentSnapshots: [],
  activeChannelIds: [],
  roomPresence: {},
  typingByChannel: {},
  seenByChannel: {},

  connect: (user) => {
    set((state) => ({
      ...state,
      isConnected: true,
      connectionLabel: state.serverConnected ? 'live' : 'syncing',
      lastHeartbeatAt: getNow(),
    }));

    if (!user || typeof window === 'undefined') {
      return;
    }

    bindRealtimeHandlers({
      onConnect: () => {
        set((state) => ({
          ...state,
          isConnected: true,
          serverConnected: true,
          connectionLabel: 'live',
          lastHeartbeatAt: getNow(),
        }));
      },
      onDisconnect: () => {
        set((state) => ({
          ...state,
          serverConnected: false,
          connectionLabel: state.isConnected ? 'syncing' : 'offline',
          lastHeartbeatAt: getNow(),
        }));
      },
      onPresenceSnapshot: (snapshot) => {
        set((state) => ({
          ...state,
          ...applyServerPresenceSnapshot(snapshot, state),
        }));
      },
      onTypingSnapshot: (snapshot) => {
        set((state) => ({
          ...state,
          ...applyServerTypingSnapshot(snapshot, state),
        }));
      },
      onMatchesSnapshot: (matches) => {
        set((state) => ({
          ...state,
          remoteMatchSnapshots: matches,
          lastHeartbeatAt: getNow(),
        }));
      },
      onTournamentsSnapshot: (tournaments) => {
        set((state) => ({
          ...state,
          remoteTournamentSnapshots: tournaments,
          lastHeartbeatAt: getNow(),
        }));
      },
      onChatChannel: (channel) => {
        useChatStore.getState().upsertServerChannel(channel);
      },
      onChatMessage: ({ channel, message }) => {
        useChatStore.getState().upsertServerChannel(channel);
        useChatStore.getState().receiveServerMessage(message, user.id);
      },
      onChatRead: ({ channelId, userId }) => {
        useChatStore.getState().applyServerRead(channelId, userId, user.id);
      },
      onPushDelivery: (payload) => {
        deliverServerNotification(payload);
      },
    });

    void connectRealtimeSocket(user);
  },

  disconnect: () => {
    disconnectRealtimeSocket();
    set((state) => ({
      ...state,
      isConnected: false,
      serverConnected: false,
      connectionLabel: 'offline',
      activeChannelIds: [],
      roomPresence: {},
      typingByChannel: {},
    }));
  },

  syncFromMatches: (matches, currentUser) => {
    const now = Date.now();
    const activeChannelIds = get().activeChannelIds;
    const nextPresence: Record<string, RoomPresenceMember[]> = {};

    for (const match of matches) {
      nextPresence[match.channelId] = buildPresenceFromMatch(
        match,
        get().roomPresence[match.channelId],
        activeChannelIds,
        currentUser?.id
      );

      if (!currentUser) {
        continue;
      }

      const currentUserPresence = buildCurrentUserPresencePayload(match, currentUser);
      if (currentUserPresence && activeChannelIds.includes(match.channelId) && isRealtimeSocketConnected()) {
        emitPresenceUpdate(currentUserPresence);
      }

      const isParticipant = match.players.some((player) => player.userId === currentUser.id);
      const isArbiter = match.arbiter?.userId === currentUser.id;

      if (!isParticipant && !isArbiter) {
        continue;
      }

      if (
        isParticipant &&
        match.scheduledAt &&
        ACTIVE_STATUSES.includes(match.status) &&
        !match.players.find((player) => player.userId === currentUser.id)?.isCheckedIn
      ) {
        const minutesUntilMatch = Math.round((new Date(match.scheduledAt).getTime() - now) / 60000);
        if (minutesUntilMatch <= 20) {
          pushRealtimeReminder(
            'check_in_required',
            minutesUntilMatch <= 5 ? 'Check-in urgent' : 'Check-in ouvert',
            `${match.id}: confirme ta presence avant le debut du match.`,
            `/mj/match/${match.id}`,
            `rt-check-in-${match.id}-${currentUser.id}`,
            minutesUntilMatch <= 5 ? 'high' : 'normal'
          );
        }
      }

      if (
        match.roomName &&
        match.roomPassword &&
        match.status !== 'finished' &&
        match.status !== 'forfeited' &&
        match.status !== 'cancelled'
      ) {
        pushRealtimeReminder(
          'arbitration_assigned',
          'Salle disponible',
          `${match.id}: la room CODM est prete pour les joueurs confirms.`,
          `/mj/match/${match.id}`,
          `rt-room-${match.id}-${currentUser.id}`,
          'high'
        );
      }

      if (match.status === 'in_progress') {
        pushRealtimeReminder(
          'match_start',
          'Match en direct',
          `${match.id}: la partie est en cours, rejoins le salon tactique maintenant.`,
          `/mj/match/${match.id}`,
          `rt-live-${match.id}-${currentUser.id}`,
          'high'
        );
      }

      if (match.disputes.some((dispute) => dispute.status === 'open' || dispute.status === 'under_review')) {
        pushRealtimeReminder(
          'dispute_update',
          'Litige en cours',
          `${match.id}: un dossier est ouvert et le prize pool reste gele.`,
          `/mj/match/${match.id}`,
          `rt-dispute-${match.id}-${currentUser.id}`,
          'normal'
        );
      }

      if (isArbiter && match.scheduledAt && !match.roomName) {
        const minutesUntilMatch = Math.round((new Date(match.scheduledAt).getTime() - now) / 60000);
        if (minutesUntilMatch <= 10 && minutesUntilMatch >= -5) {
          pushRealtimeReminder(
            'system',
            'Publier la salle',
            `${match.id}: partage la room CODM maintenant pour lancer le match a l'heure.`,
            `/mj/match/${match.id}`,
            `rt-arbiter-room-${match.id}-${currentUser.id}`,
            minutesUntilMatch <= 2 ? 'high' : 'normal'
          );
        }
      }
    }

    set((state) => ({
      ...state,
      isConnected: true,
      connectionLabel: state.serverConnected ? 'live' : 'syncing',
      lastHeartbeatAt: getNow(),
      liveMatches: matches
        .filter((match) => LIVE_STATUSES.includes(match.status))
        .map((match) => ({
          id: match.id,
          channelId: match.channelId,
          player1: getLeadPseudo(match, 0),
          player2: getLeadPseudo(match, 1),
          format: match.format,
          pot: match.prizePool,
          status: match.status,
          roomReady: Boolean(match.roomName && match.roomPassword),
        })),
      roomPresence: {
        ...state.roomPresence,
        ...nextPresence,
      },
      typingByChannel: trimTypingState(state.typingByChannel),
    }));
  },

  syncServerState: async (kind, items, user) => {
    if (!user) return;
    try {
      await syncRealtimeState(kind, items, user);
    } catch (error) {
      set((state) => ({
        ...state,
        serverConnected: false,
        connectionLabel: state.isConnected ? 'syncing' : 'offline',
      }));
    }
  },

  bootstrapServerState: async (user) => {
    if (!user) return;
    try {
      const bootstrap = await fetchRealtimeBootstrap(user);
      
      // Hydrate friends
      useFriendsStore.getState().hydrateFromServer(
        bootstrap.friends || [],
        bootstrap.friendRequests || [],
        bootstrap.blockedIds || []
      );

      // Hydrate notifications
      if (bootstrap.notifications && bootstrap.notifications.length > 0) {
        useNotificationStore.getState().hydrateFromServer(bootstrap.notifications);
      }

      set((state) => ({
        ...state,
        remoteMatchSnapshots: bootstrap.matches || [],
        remoteTournamentSnapshots: bootstrap.tournaments || [],
        lastHeartbeatAt: bootstrap.timestamp || getNow(),
      }));
    } catch (error) {
      set((state) => ({
        ...state,
        serverConnected: false,
        connectionLabel: state.isConnected ? 'syncing' : 'offline',
      }));
    }
  },

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
        ...state,
        isConnected: true,
        connectionLabel: state.serverConnected ? 'live' : 'syncing',
        lastHeartbeatAt: getNow(),
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
      ...state,
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
      ...state,
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
        ...state,
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
