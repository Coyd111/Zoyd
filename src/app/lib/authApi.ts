import { supabase } from '../../lib/supabase';
import type { User } from '../stores/authStore';

interface AuthResponse {
  ok: boolean;
  token: string;
  user: User;
  expiresAt: string;
}

export interface RegisterPayload {
  pseudo: string;
  email: string;
  phone: string;
  password: string;
  gameId: string;
  controllerType: User['controllerType'];
  device: User['device'];
  levelCODM: number;
  rankMJ: string;
  rankBR: string;
  country: string;
  streamerMode: boolean;
  streamerPseudo?: string;
}

export const registerWithBackend = async (payload: RegisterPayload): Promise<AuthResponse> => {
  // 1. Inscription via Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: payload.email,
    password: payload.password,
    options: {
      data: {
        pseudo: payload.pseudo,
      }
    }
  });

  if (authError) {
    // Messages d'erreur Supabase traduits en français
    const msg = authError.message.toLowerCase();
    if (msg.includes('already registered') || msg.includes('already exists')) {
      throw new Error('Cette adresse email est déjà utilisée. Essayez de vous connecter.');
    }
    if (msg.includes('password')) {
      throw new Error('Le mot de passe doit contenir au moins 6 caractères.');
    }
    if (msg.includes('email')) {
      throw new Error('L\'adresse email est invalide.');
    }
    throw new Error(`Erreur d'inscription: ${authError.message}`);
  }
  if (!authData.user) throw new Error('Création du compte échouée.');

  // 2. Création du profil public
  const profile = {
    id: authData.user.id,
    role: 'player',
    pseudo: payload.pseudo,
    email: payload.email,
    phone: payload.phone,
    game_id: payload.gameId,
    controller_type: payload.controllerType,
    device: payload.device,
    level_codm: payload.levelCODM,
    rank_mj: payload.rankMJ,
    rank_br: payload.rankBR,
    country: payload.country,
    streamer_mode: payload.streamerMode,
    trust_score: 100,
    date_joined: new Date().toISOString(),
    is_online: true,
  };

  const { error: profileError } = await supabase.from('profiles').insert(profile);
  
  if (profileError) {
    // Si échec du profil, on nettoie potentiellement l'utilisateur (simplifié ici)
    throw new Error(`Erreur Profil: ${profileError.message}`);
  }

  // On crée un portefeuille vide
  await supabase.from('wallets').insert({
    user_id: authData.user.id,
    cash_balance: 0,
    locked_balance: 0,
  });

  const appUser: User = {
    id: authData.user.id,
    role: 'player',
    pseudo: payload.pseudo,
    email: payload.email,
    phone: payload.phone,
    gameId: payload.gameId,
    controllerType: payload.controllerType,
    device: payload.device,
    levelCODM: payload.levelCODM,
    rankMJ: payload.rankMJ,
    rankBR: payload.rankBR,
    country: payload.country,
    streamerMode: payload.streamerMode,
    walletBalance: 0,
    trustScore: 100,
    stats: { wins: 0, losses: 0, draws: 0, totalMatches: 0, totalEarnings: 0, winRate: 0, tournamentsWon: 0, tournamentsPlayed: 0, elo: 1200 },
    progression: { level: 'BEGINNER', xp: 0, nextLevelXp: 1000 },
    achievements: [],
    dateJoined: profile.date_joined,
    isOnline: true,
  };

  return {
    ok: true,
    token: authData.session?.access_token || '',
    user: appUser,
    expiresAt: authData.session?.expires_at ? new Date(authData.session.expires_at * 1000).toISOString() : new Date().toISOString(),
  };
};

export const loginWithBackend = async (identifier: string, password: string): Promise<AuthResponse> => {
  // Supabase Auth ne prend que l'email en natif sans trigger, on suppose que c'est un email pour l'instant.
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: identifier,
    password: password,
  });

  if (authError) throw new Error('Email ou mot de passe incorrect.');
  if (!authData.user) throw new Error('Utilisateur non trouvé.');

  // Récupération du profil
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authData.user.id)
    .single();

  if (profileError || !profile) throw new Error('Profil introuvable.');

  const appUser: User = {
    id: profile.id,
    role: profile.role,
    pseudo: profile.pseudo,
    email: profile.email,
    phone: profile.phone,
    gameId: profile.game_id,
    controllerType: profile.controller_type,
    device: profile.device,
    levelCODM: profile.level_codm,
    rankMJ: profile.rank_mj,
    rankBR: profile.rank_br,
    country: profile.country,
    streamerMode: profile.streamer_mode,
    walletBalance: 0, // Sera hydraté par walletStore
    trustScore: profile.trust_score,
    stats: profile.stats,
    progression: { level: 'BEGINNER', xp: 0, nextLevelXp: 1000 }, // Simplifié pour la migration
    achievements: [],
    dateJoined: profile.date_joined,
    isOnline: profile.is_online,
  };

  return {
    ok: true,
    token: authData.session?.access_token || '',
    user: appUser,
    expiresAt: authData.session?.expires_at ? new Date(authData.session.expires_at * 1000).toISOString() : new Date().toISOString(),
  };
};

export const fetchCurrentUser = async (token: string) => {
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) throw new Error('Session invalide');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authData.user.id)
    .single();

  if (profileError || !profile) throw new Error('Profil introuvable');

  const appUser: User = {
    id: profile.id,
    role: profile.role,
    pseudo: profile.pseudo,
    email: profile.email,
    phone: profile.phone,
    gameId: profile.game_id,
    controllerType: profile.controller_type,
    device: profile.device,
    levelCODM: profile.level_codm,
    rankMJ: profile.rank_mj,
    rankBR: profile.rank_br,
    country: profile.country,
    streamerMode: profile.streamer_mode,
    walletBalance: 0,
    trustScore: profile.trust_score,
    stats: profile.stats,
    progression: { level: 'BEGINNER', xp: 0, nextLevelXp: 1000 },
    achievements: [],
    dateJoined: profile.date_joined,
    isOnline: profile.is_online,
  };

  return {
    ok: true,
    user: appUser,
    expiresAt: new Date().toISOString(),
  };
};

export const logoutFromBackend = async (token: string) => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  return { ok: true };
};
