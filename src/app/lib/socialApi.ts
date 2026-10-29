/**
 * socialApi - appels REST social : demandes d'ami, blocages, signalements,
 * administration de la moderation.
 *
 * Client dedie du domaine social. Contient aussi les appels admin de
 * moderation (liste des signalements, sanction, sanctions actives).
 *
 * INVARIANT : un signalement doit utiliser l'identifiant renvoye par le
 * serveur, pas un identifiant fabrique localement : sinon la meme ligne
 * apparait deux fois apres hydratation.
 * PIEGE : la reponse admin peut etre ' degradee ' (le serveur a repondu
 * partiellement). L'interface doit alors afficher un echec de lecture, et
 * non une liste vide qui se lirait comme ' personne ne signale rien '.
 * PIEGE : les appels admin exigent la 2FA cote serveur. Le front ne peut
 * pas s'en passer.
 *
 * Voir aussi : docs/08-frontend.md - section 10 (Inventaire des pages)
 */
import { authorizedPost, authorizedDelete, authorizedGet } from './apiClient';
import type { FriendProfileInput, FriendRequest } from '../stores/friendsStore';

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
  // P12 C1 (audit-3) : le serveur renvoie la demande SANS senderPseudo
  // (persistence.mjs). Le type precedent pretendait `FriendRequest` complet
  // (senderPseudo requis) : le typecheck ne voyait jamais le mensonge et
  // l'objet brut casse le rendu de la section 'Demandes'. Le store
  // normalise a l'insertion (normalizeServerRequest).
  return authorizedPost<{ ok: boolean; request: Omit<FriendRequest, 'senderPseudo'> & { senderPseudo?: string } }>('/api/social/request', { targetId, message });
};

export const acceptServerFriendRequest = async (requestId: string) => {
  // Audit-4 C1 : le serveur livre ici le profil PUBLIC du demandeur
  // (getPublicUserById, miroir de getFriendsForUser), pas un `Friend`
  // complet — le type precedent pretendait `status`/`isStreamer` presents et
  // le typecheck ne voyait jamais les champs derives absents. Le store
  // normalise a l'insertion (normalizeServerFriend), comme le fix P12 C1
  // sur les demandes (voir ci-dessus).
  return authorizedPost<{ ok: boolean; friend: FriendProfileInput }>('/api/social/accept', { requestId });
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
 *
 * `reporterId` est nullable ici, alors qu'il est obligatoire dans `Report` :
 * un signalement anonyme a un auteur null. On retire donc le champ de la
 * base avant d'etendre, sinon l'heritage se contredit.
 */
export interface StoredReport extends Omit<Report, 'reporterId'> {
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
