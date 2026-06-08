import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import type {
  CreateTournamentInput,
  Tournament,
  TournamentRegistrationInput,
} from '../stores/tournamentStore';
import type { WalletSnapshot } from './walletApi';

const getUserId = () => {
  const user = useAuthStore.getState().user;
  if (!user) throw new Error('Utilisateur non connecté');
  return user.id;
};

// --- REALTIME SUBSCRIPTION ---
export const subscribeToTournaments = (onUpdate: () => void) => {
  return supabase
    .channel('public:tournaments')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, onUpdate)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_entries' }, onUpdate)
    .subscribe();
};

export const fetchServerTournaments = async (): Promise<{ ok: boolean; tournaments: Tournament[] }> => {
  const { data: tournamentsData, error } = await supabase
    .from('tournaments')
    .select('*, tournament_entries(*, tournament_members(*, profiles(*)), profiles!tournament_entries_captain_id_fkey(pseudo, trust_score))')
    .order('created_at', { ascending: false });

  if (error || !tournamentsData) return { ok: true, tournaments: [] };

  const tournaments: Tournament[] = tournamentsData.map((t: any) => ({
    id: t.id,
    name: t.name,
    format: t.format,
    teamSize: t.team_size,
    maxEntries: t.max_entries,
    minEntries: 4, // Default
    entryFee: Number(t.entry_fee),
    status: t.status,
    rules: t.rules,
    startsAt: t.starts_at,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    entries: (t.tournament_entries || []).map((e: any) => ({
      id: e.id,
      seed: e.seed,
      squadName: e.squad_name,
      captainId: e.captain_id,
      captainPseudo: e.profiles?.pseudo || 'Capitaine',
      teamSize: t.team_size,
      checkedIn: true,
      joinedAt: e.joined_at,
      wins: e.wins,
      losses: e.losses,
      finalPlacement: e.final_placement,
      members: (e.tournament_members || []).map((m: any) => ({
        userId: m.user_id,
        pseudo: m.profiles?.pseudo || 'Joueur',
        joinedAt: m.profiles?.date_joined || new Date().toISOString(),
        isCaptain: m.user_id === e.captain_id,
      })),
    })),
    matches: [], // Simplification: on ne charge pas les brackets dans la vue liste pour aller vite
    payouts: {
      grossPool: Number(t.entry_fee) * t.max_entries,
      playerPool: Number(t.entry_fee) * t.max_entries * 0.9,
      arbiterPool: Number(t.entry_fee) * t.max_entries * 0.05,
      first: Number(t.entry_fee) * t.max_entries * 0.6,
      second: Number(t.entry_fee) * t.max_entries * 0.2,
      third: Number(t.entry_fee) * t.max_entries * 0.1,
    },
    arbiters: [],
    platform: 'mobile',
  }));

  return { ok: true, tournaments };
};

export const fetchServerTournament = async (tournamentId: string) => {
  const { tournaments } = await fetchServerTournaments();
  const tournament = tournaments.find(t => t.id === tournamentId);
  if (!tournament) throw new Error("Tournoi introuvable");
  return { ok: true, tournament };
};

export const createServerTournament = async (payload: CreateTournamentInput) => {
  const { data: tournament, error } = await supabase.from('tournaments').insert({
    name: payload.name,
    format: payload.format,
    team_size: parseInt(payload.format.charAt(0)) || 1,
    max_entries: payload.maxEntries,
    entry_fee: payload.entryFee,
    rules: payload.rules || {},
    starts_at: payload.startsAt,
    status: 'recruiting',
  }).select().single();

  if (error || !tournament) throw new Error('Erreur création tournoi');

  return fetchServerTournament(tournament.id);
};

export const registerForServerTournament = async (
  tournamentId: string,
  payload: Omit<TournamentRegistrationInput, 'tournamentId' | 'userId'>
) => {
  const userId = getUserId();
  
  // Create entry
  const { data: entry, error } = await supabase.from('tournament_entries').insert({
    tournament_id: tournamentId,
    captain_id: userId,
    squad_name: payload.squadName,
    seed: Math.floor(Math.random() * 100) + 1,
  }).select().single();

  if (error || !entry) throw new Error('Erreur inscription');

  // Add members
  const membersToInsert = payload.members.map(m => ({
    entry_id: entry.id,
    user_id: m.userId,
  }));
  
  // Add captain
  membersToInsert.push({ entry_id: entry.id, user_id: userId });

  await supabase.from('tournament_members').insert(membersToInsert);

  return fetchServerTournament(tournamentId);
};

export const leaveServerTournament = async (tournamentId: string) => {
  const userId = getUserId();
  // Simplified: Delete entry where user is captain
  await supabase.from('tournament_entries').delete().eq('tournament_id', tournamentId).eq('captain_id', userId);
  return fetchServerTournament(tournamentId);
};

export const assignServerTournamentArbiter = async (tournamentId: string) => {
  return fetchServerTournament(tournamentId); // Arbiters logic skipped for MVP
};

export const startServerTournament = async (tournamentId: string) => {
  await supabase.from('tournaments').update({ status: 'live' }).eq('id', tournamentId);
  return fetchServerTournament(tournamentId);
};

export const setServerTournamentRoomDetails = async (
  tournamentId: string,
  matchId: string,
  roomName: string,
  roomPassword: string
) => {
  return fetchServerTournament(tournamentId); // Not implemented deeply in MVP
};

export const setServerTournamentMatchLive = async (tournamentId: string, matchId: string) => {
  return fetchServerTournament(tournamentId);
};

export const submitServerTournamentResult = async (
  tournamentId: string,
  matchId: string,
  payload: { winnerEntryId: string; scoreA: number; scoreB: number; notes?: string }
) => {
  return fetchServerTournament(tournamentId);
};
