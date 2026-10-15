import { authorizedPost, authorizedDelete, authorizedGet } from './apiClient';
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

export const reportServerUser = async (targetId: string, reason: string, description: string) => {
  return authorizedPost<{ ok: boolean; report: Report }>('/api/social/report', { targetId, reason, description });
};

/**
 * Signalements tels que le serveur les stocke. `Report` (plus haut) est la
 * forme d'echange ; celle-ci est la forme de lecture pour la moderation.
 */
export interface StoredReport extends Report {
  reporterId: string | null;
  /** Gravite calculee par le serveur a l ecriture, jamais par le client. */
  severity?: string | null;
  resolution?: string | null;
  sanctionId?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}

/**
 * Lecture paginee des signalements — reservee a l administration.
 *
 * `degraded` signale que le serveur tourne sans base : la liste est alors
 * vide pour une raison qui n'a rien a voir avec l'absence de signalement.
 * L'appelant doit pouvoir le dire a l'admin, sinon il conclurait que tout va
 * bien alors que la table est peut-etre tombee.
 */
export interface AdminReportsPage {
  ok: boolean;
  reports: StoredReport[];
  total: number;
  limit: number;
  offset: number;
  degraded?: boolean;
}

export const fetchAdminReports = async (options: { status?: string; targetId?: string; limit?: number; offset?: number } = {}) => {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.targetId) params.set('targetId', options.targetId);
  params.set('limit', String(options.limit ?? 100));
  params.set('offset', String(options.offset ?? 0));
  return authorizedGet<AdminReportsPage>(`/api/admin/reports?${params.toString()}`);
};

// ─── Sanctions (moderation) ─────────────────────────────────────────────────

export interface ActiveSanction {
  id: string;
  userId: string;
  targetPseudo: string;
  kind: 'warning' | 'temporary_ban' | 'permanent_ban';
  reason: string;
  note: string;
  reportId: string | null;
  issuedBy: string;
  issuedAt: string;
  expiresAt: string | null;
}

/** Sanctions en cours, tous joueurs confondus. Necessaire pour lever une erreur. */
export const fetchActiveSanctions = async (userId?: string) => {
  const params = new URLSearchParams();
  if (userId) params.set('userId', userId);
  params.set('limit', '200');
  return authorizedGet<{ ok: boolean; sanctions: ActiveSanction[]; limit: number }>(
    `/api/admin/sanctions?${params.toString()}`
  );
};

/** Leve une sanction. Le joueur retrouve acces immediatement. */
export const revokeAdminSanction = async (sanctionId: string) => {
  return authorizedPost<{ ok: boolean; sanctionId: string; revokedBy: string; revokedAt: string }>(
    `/api/admin/sanctions/${encodeURIComponent(sanctionId)}/revoke`,
    {}
  );
};
/**
 * Traitement d'un signalement : applique la sanction et trace qui a tranche.
 *
 * Le definitif passe par la meme route, mais l interface exige une
 * confirmation explicite avant de l'envoyer.
 */
export const resolveAdminReport = async (
  reportId: string,
  resolution: string,
  note: string,
  durationDays?: number
) => {
  return authorizedPost<{
    ok: boolean;
    reportId: string;
    resolution: string;
    status: string;
    sanction: { id: string; kind: string; expiresAt: string | null } | null;
    reviewedBy: string;
    reviewedAt: string;
  }>(`/api/admin/reports/${encodeURIComponent(reportId)}/resolve`, {
    resolution,
    note,
    ...(durationDays ? { durationDays } : {}),
  });
};
