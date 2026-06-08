import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import type { DisputeCategory, Match, MatchResult } from '../stores/matchStore';

// Note: To avoid huge frontend rewrites, the API will reconstruct the "Match" JSON 
// by querying the relational tables, so the UI doesn't break.

const getUserId = () => {
  const user = useAuthStore.getState().user;
  if (!user) throw new Error('Utilisateur non connecté');
  return user.id;
};

// --- REALTIME SUBSCRIPTION ---
export const subscribeToMatches = (onUpdate: () => void) => {
  return supabase
    .channel('public:matches')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, onUpdate)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_participants' }, onUpdate)
    .subscribe();
};

export const fetchAllMatchesFromDb = async (): Promise<Match[]> => {
  // En production, cette requête serait optimisée ou paginée.
  const { data: matchesData, error } = await supabase
    .from('matches')
    .select('*, match_participants(*, profiles(*)), profiles!matches_arbiter_id_fkey(pseudo, trust_score)')
    .order('created_at', { ascending: false });

  if (error || !matchesData) return [];

  // Reconstruire l'objet complexe Match pour zustand
  return matchesData.map((m: any) => ({
    id: m.id,
    creatorId: m.match_participants?.find((p: any) => p.is_captain && p.team === 0)?.user_id || '',
    creatorPseudo: m.match_participants?.find((p: any) => p.is_captain && p.team === 0)?.profiles?.pseudo || 'Inconnu',
    format: m.format,
    teamSize: m.team_size,
    maxPlayers: m.team_size * 2,
    rules: m.rules,
    entryFee: Number(m.entry_fee),
    prizePool: Number(m.prize_pool),
    zoydFee: Number(m.zoyd_fee),
    arbiterFee: Number(m.arbiter_fee),
    visibility: 'public',
    privacy: 'public',
    deviceRestriction: 'open',
    controllerRestriction: 'open',
    status: m.status,
    players: (m.match_participants || []).map((p: any) => ({
      userId: p.user_id,
      pseudo: p.profiles?.pseudo || 'Joueur',
      team: p.team,
      joinedAt: p.joined_at,
      trustScore: p.profiles?.trust_score || 100,
      isReady: p.ready,
      isCheckedIn: p.ready,
      isCaptain: p.is_captain,
    })),
    disputes: [],
    chatChannelId: `match-${m.id}`,
    channelId: `match-${m.id}`,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    trustScoreMin: 0,
    isInstant: true,
    arbiter: m.arbiter_id ? {
      userId: m.arbiter_id,
      pseudo: m.profiles?.pseudo || 'Arbitre',
      assignedAt: m.updated_at,
      trustScore: m.profiles?.trust_score || 100,
      roomName: m.room_name,
      roomPassword: m.room_password,
      hasSubmittedResult: !!m.finished_at,
    } : undefined,
  }));
};

export const createServerMatch = async (payload: any) => {
  const userId = getUserId();
  
  // 1. Insert Match
  const { data: match, error: matchError } = await supabase.from('matches').insert({
    format: payload.format,
    team_size: parseInt(payload.format.charAt(0)) || 1,
    entry_fee: payload.entryFee,
    prize_pool: payload.entryFee * (parseInt(payload.format.charAt(0)) || 1) * 2,
    rules: payload.rules || {},
    status: 'recruiting',
  }).select().single();

  if (matchError || !match) throw new Error('Erreur création match');

  // 2. Insert Creator as Participant
  await supabase.from('match_participants').insert({
    match_id: match.id,
    user_id: userId,
    team: payload.creatorTeam || 0,
    is_captain: true,
  });

  return { ok: true, match: (await fetchAllMatchesFromDb()).find(m => m.id === match.id) as Match };
};

export const joinServerMatch = async (matchId: string, team?: 0 | 1) => {
  const userId = getUserId();
  await supabase.from('match_participants').insert({
    match_id: matchId,
    user_id: userId,
    team: team ?? 1,
    is_captain: false,
  });
  
  // Update match status to full if all players joined (simplified)
  await supabase.from('matches').update({ status: 'full' }).eq('id', matchId);

  return { ok: true, match: (await fetchAllMatchesFromDb()).find(m => m.id === matchId) as Match };
};

export const assignServerArbiter = async (matchId: string) => {
  const userId = getUserId();
  await supabase.from('matches').update({ arbiter_id: userId, status: 'check_in' }).eq('id', matchId);
  return { ok: true, match: (await fetchAllMatchesFromDb()).find(m => m.id === matchId) as Match };
};

export const checkInServerMatch = async (matchId: string) => {
  const userId = getUserId();
  await supabase.from('match_participants').update({ ready: true }).eq('match_id', matchId).eq('user_id', userId);
  return { ok: true, match: (await fetchAllMatchesFromDb()).find(m => m.id === matchId) as Match };
};

export const toggleServerReady = checkInServerMatch;

export const scheduleServerMatch = async (matchId: string, scheduledAt: string) => {
  return { ok: true, match: (await fetchAllMatchesFromDb()).find(m => m.id === matchId) as Match };
};

export const setServerRoomDetails = async (matchId: string, roomName: string, roomPassword: string) => {
  await supabase.from('matches').update({ room_name: roomName, room_password: roomPassword }).eq('id', matchId);
  return { ok: true, match: (await fetchAllMatchesFromDb()).find(m => m.id === matchId) as Match };
};

export const launchServerMatch = async (matchId: string) => {
  await supabase.from('matches').update({ status: 'in_progress' }).eq('id', matchId);
  return { ok: true, match: (await fetchAllMatchesFromDb()).find(m => m.id === matchId) as Match };
};

export const submitServerMatchResult = async (matchId: string, payload: any) => {
  await supabase.from('matches').update({ 
    status: 'finished', 
    winner_team: payload.winnerTeam,
    finished_at: new Date().toISOString()
  }).eq('id', matchId);
  return { ok: true, match: (await fetchAllMatchesFromDb()).find(m => m.id === matchId) as Match };
};

export const confirmServerMatchResult = async (matchId: string) => {
  return { ok: true, match: (await fetchAllMatchesFromDb()).find(m => m.id === matchId) as Match };
};

export const openServerMatchDispute = async (matchId: string, payload: any) => {
  const userId = getUserId();
  await supabase.from('match_disputes').insert({
    match_id: matchId,
    opened_by: userId,
    reason: payload.reason,
    status: 'open'
  });
  await supabase.from('matches').update({ status: 'disputed' }).eq('id', matchId);
  return { ok: true, match: (await fetchAllMatchesFromDb()).find(m => m.id === matchId) as Match };
};

export const adminAwardServerMatch = async (matchId: string, winnerTeam: 0 | 1, arbiterNotes?: string) => {
  await supabase.from('matches').update({ status: 'finished', winner_team: winnerTeam }).eq('id', matchId);
  return { ok: true, match: (await fetchAllMatchesFromDb()).find(m => m.id === matchId) as Match };
};

export const adminResolveServerDispute = async (matchId: string, resolution: string) => {
  await supabase.from('match_disputes').update({ status: 'resolved' }).eq('match_id', matchId);
  await supabase.from('matches').update({ status: 'finished' }).eq('id', matchId);
  return { ok: true, match: (await fetchAllMatchesFromDb()).find(m => m.id === matchId) as Match };
};

export const adminCancelServerMatch = async (matchId: string, reason: string) => {
  await supabase.from('matches').update({ status: 'cancelled' }).eq('id', matchId);
  return { ok: true, match: (await fetchAllMatchesFromDb()).find(m => m.id === matchId) as Match };
};
