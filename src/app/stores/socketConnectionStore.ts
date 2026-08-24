import { create } from 'zustand';
import type { User } from './authStore';
import { useChatStore } from './chatStore';
import type { Match } from './matchStore';
import type { Tournament } from './tournamentStore';
import { useLeagueStore } from './leagueStore';
import { useFriendsStore } from './friendsStore';
import { useNotificationStore } from './notificationStore';
import { usePresenceStore, buildPresenceFromMatch, buildCurrentUserPresencePayload, trimTypingState } from './presenceStore';
import type { RoomPresenceMember } from './presenceStore';
import {
  bindRealtimeHandlers,
  connectRealtimeSocket,
  disconnectRealtimeSocket,
  emitPresenceUpdate,
  fetchRealtimeBootstrap,
  isRealtimeSocketConnected,
  syncRealtimeState,
  type PushDeliveryPayload,
} from '../lib/realtimeClient';

export type { RoomPresenceMember, TypingMember } from './presenceStore';

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

const getNow = () => new Date().toISOString();
const LIVE_STATUSES: Match['status'][] = ['ready', 'in_progress'];

const getLeadPseudo = (match: Match, team: 0 | 1) =>
  match.players.find((player) => player.team === team)?.pseudo || (team === 0 ? 'Squad Alpha' : 'Squad Bravo');

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

const ACTIVE_STATUSES: Match['status'][] = ['check_in', 'ready', 'in_progress'];

interface SocketConnectionState {
  isConnected: boolean;
  serverConnected: boolean;
  connectionLabel: 'offline' | 'syncing' | 'live';
  bootstrapReady: boolean;
  lastHeartbeatAt?: string;
  liveMatches: LiveMatchSnapshot[];
  remoteMatchSnapshots: Match[];
  remoteTournamentSnapshots: Tournament[];
  connect: (user?: User | null) => void;
  disconnect: () => void;
  syncFromMatches: (matches: Match[], currentUser?: User | null) => void;
  syncServerState: (kind: 'matches' | 'tournaments', items: Match[] | Tournament[], user?: User | null) => Promise<void>;
  bootstrapServerState: (user?: User | null) => Promise<void>;
}

export const useSocketConnectionStore = create<SocketConnectionState>((set, get) => ({
  isConnected: false,
  serverConnected: false,
  bootstrapReady: false,
  connectionLabel: 'offline',
  lastHeartbeatAt: undefined,
  liveMatches: [],
  remoteMatchSnapshots: [],
  remoteTournamentSnapshots: [],

  connect: (user) => {
    set((state) => ({
      isConnected: true,
      connectionLabel: state.serverConnected ? 'live' : 'syncing',
      lastHeartbeatAt: getNow(),
    }));

    if (!user || typeof window === 'undefined') {
      return;
    }

    bindRealtimeHandlers({
      onConnect: () => {
        set({
          isConnected: true,
          serverConnected: true,
          connectionLabel: 'live',
          lastHeartbeatAt: getNow(),
        });
      },
      onDisconnect: () => {
        set((state) => ({
          serverConnected: false,
          connectionLabel: state.isConnected ? 'syncing' : 'offline',
          lastHeartbeatAt: getNow(),
        }));
      },
      onPresenceSnapshot: (snapshot) => {
        usePresenceStore.getState().applyServerPresenceSnapshot(snapshot);
        set({ lastHeartbeatAt: getNow() });
      },
      onTypingSnapshot: (snapshot) => {
        usePresenceStore.getState().applyServerTypingSnapshot(snapshot);
        set({ lastHeartbeatAt: getNow() });
      },
      onMatchesSnapshot: (matches) => {
        set({ remoteMatchSnapshots: matches, lastHeartbeatAt: getNow() });
      },
      onTournamentsSnapshot: (tournaments) => {
        set({ remoteTournamentSnapshots: tournaments, lastHeartbeatAt: getNow() });
      },
      onLeaguesSnapshot: (seasons) => {
        useLeagueStore.getState().hydrateFromServer(seasons);
        set({ lastHeartbeatAt: getNow() });
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
    usePresenceStore.getState().clearPresence();
    set({
      isConnected: false,
      serverConnected: false,
      connectionLabel: 'offline',
    });
  },

  syncFromMatches: (matches, currentUser) => {
    const now = Date.now();
    const presenceState = usePresenceStore.getState();
    const activeChannelIds = presenceState.activeChannelIds;
    const nextPresence: Record<string, RoomPresenceMember[]> = {};

    for (const match of matches) {
      nextPresence[match.channelId] = buildPresenceFromMatch(
        match,
        presenceState.roomPresence[match.channelId],
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
    }));

    usePresenceStore.setState((ps) => ({
      roomPresence: {
        ...ps.roomPresence,
        ...nextPresence,
      },
      typingByChannel: trimTypingState(ps.typingByChannel),
    }));
  },

  syncServerState: async (kind, items, user) => {
    if (!user) return;
    try {
      await syncRealtimeState(kind, items, user);
    } catch (error) {
      set((state) => ({
        serverConnected: false,
        connectionLabel: state.isConnected ? 'syncing' : 'offline',
      }));
    }
  },

  bootstrapServerState: async (user) => {
    if (!user) return;
    try {
      const bootstrap = await fetchRealtimeBootstrap(user);

      useFriendsStore.getState().hydrateFromServer(
        bootstrap.friends || [],
        bootstrap.friendRequests || [],
        bootstrap.blockedIds || []
      );

      if (bootstrap.notifications && bootstrap.notifications.length > 0) {
        useNotificationStore.getState().hydrateFromServer(bootstrap.notifications);
      }

      set({
        remoteMatchSnapshots: bootstrap.matches || [],
        remoteTournamentSnapshots: bootstrap.tournaments || [],
        lastHeartbeatAt: bootstrap.timestamp || getNow(),
        bootstrapReady: true,
      });
    } catch (error) {
      set((state) => ({
        serverConnected: false,
        connectionLabel: state.isConnected ? 'syncing' : 'offline',
      }));
    }
  },
}));
