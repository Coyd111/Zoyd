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
import type { StoredReport } from '../lib/socialApi';
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

/**
 * Ce que le serveur renvoie réellement pour un ami : le profil public
 * (`getPublicUserById`), donc sans `status`/`isStreamer` mais avec
 * `streamerMode`. Ces deux champs sont dérivés par `hydrateFromServer`.
 */
export type FriendProfileInput = Omit<Friend, 'status' | 'isStreamer'> & { streamerMode?: boolean };

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
  /**
   * Champs de moderation, absents sur un signalement fabrique localement et
   * sur les lignes plus anciennes. Optionnels pour que les consommateurs
   * existants (`communityInsights`) n aient pas a les traiter.
   */
  severity?: 'grave' | 'moyenne' | 'legere' | 'a_qualifier';
  reporterPseudo?: string;
  resolution?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}

export interface FriendsState {
  friends: Friend[];
  requests: FriendRequest[];
  blockedIds: string[];
  reports: Report[];
  pendingId: string | null;
  // Actions
  hydrateFromServer: (
    friends: FriendProfileInput[],
    requests: Array<Omit<FriendRequest, 'senderPseudo' | 'timestamp' | 'status'> & Partial<Pick<FriendRequest, 'senderPseudo' | 'timestamp' | 'status'>>>,
    blockedIds: string[]
  ) => void;
  /**
   * Remplace les signalements par la lecture serveur.
   *
   * `hydrateFromServer` rechargeait amis, demandes et blocages — jamais les
   * signalements. Le tableau de bord n'affichait donc que ceux faits dans ce
   * navigateur : un admin qui ouvrait sa session ailleurs, ou apres un
   * rechargement, n'en voyait aucun. La table accumulait, personne ne lisait.
   *
   * Un adaptateur est necessaire : la forme stockee et la forme consommee par
   * `communityInsights` n'ont pas les memes champs (`createdAt` contre
   * `timestamp`, `reason` ouvert ici contre union la-bas).
   */
  hydrateReportsFromServer: (stored: StoredReport[]) => void;
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

  hydrateReportsFromServer: (stored) => {
    const knownReasons: Report['reason'][] = [
      'toxic_behavior',
      'cheating',
      'no_show',
      'harassment',
      'other',
    ];
    const knownStatuses: Report['status'][] = ['pending', 'reviewed', 'resolved'];

    set({
      reports: (stored || []).map((report) => ({
        id: report.id,
        targetId: report.targetId || '',
        // Le serveur accepte un `reason` libre ; l'union de `Report` est
        // fermee. Une valeur inconnue ne doit pas disparaitre : elle devient
        // `other`, qui reste affichee et donc traitable.
        reason: (knownReasons.includes(report.reason as Report['reason'])
          ? report.reason
          : 'other') as Report['reason'],
        description: report.description || '',
        timestamp: report.createdAt || new Date().toISOString(),
        status: (knownStatuses.includes(report.status as Report['status'])
          ? report.status
          : 'pending') as Report['status'],
        severity: report.severity as Report['severity'] | undefined,
        reporterPseudo: report.reporterPseudo,
        resolution: report.resolution ?? null,
        reviewedBy: report.reviewedBy ?? null,
        reviewedAt: report.reviewedAt ?? null,
      })),
    });
  },

  hydrateFromServer: (friends, requests, blockedIds) => {
    // Le serveur renvoie des profils publics (id/pseudo/country/trustScore/…)
    // et aucun `status` : on force `offline` et on dérive `isStreamer`. Le
    // temps réel est ensuite poussé par le socket
    // (`friend:presence` → updateFriendStatus).
    set({
      friends: friends.map((friend) => ({
        ...friend,
        isStreamer: Boolean(friend.streamerMode),
        status: 'offline' as FriendStatus,
      })),
      // Défensifs : le serveur normalise déjà, mais un `senderPseudo` absent
      // affichait "undefined veut t'ajouter".
      requests: requests.map((request) => ({
        ...request,
        senderPseudo: request.senderPseudo || 'Joueur',
        status: request.status || 'pending',
        timestamp: request.timestamp || new Date().toISOString(),
      })),
      blockedIds,
    });
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
      const response = await reportServerUser(targetId, reason, description);
      // On utilise le signalement RENVOYE PAR LE SERVEUR, pas un objet
      // fabrique ici. Avant, l'identifiant local etait `RP-<Date.now()>`
      // alors que le serveur produit `RP-<base36> majuscule` : apres
      // hydratation, la meme ligne apparaitrait deux fois, et celle qui
      // reste en memoire serait un signalement que personne n'a jamais lu.
      const created = response?.report;
      const report: Report = {
        id: created?.id || `RP-${Date.now()}`,
        targetId: created?.targetId || targetId,
        reason,
        description,
        timestamp: created?.createdAt || new Date().toISOString(),
        status: 'pending',
      };
      set((state) => ({ reports: [report, ...state.reports] }));
      useToastStore.getState().addToast({ type: 'success', title: 'Signalément envoyé', message: "Merci pour votre signalement.", duration: 4000 });
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
