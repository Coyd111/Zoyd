import { supabase, db } from './supabase.mjs';

const initSupabaseDB = async () => {
  console.log('Initializing Supabase Database Schema...');

  // Since direct PostgreSQL connection is disabled (DNS issues),
  // we'll use Supabase REST API for table creation
  // Note: Tables should already exist from manual SQL execution
  
  if (!db) {
    console.log('⚠️  Direct PostgreSQL connection disabled');
    console.log('ℹ️  Tables should be created manually in Supabase Dashboard');
    console.log('ℹ️  Use supabase-additional-tables.sql if needed');
    return;
  }

  try {
    await db.query(`
      -- Users & Authentication
      CREATE TABLE IF NOT EXISTS app_users (
        id UUID PRIMARY KEY,
        pseudo_key TEXT NOT NULL UNIQUE,
        email_key TEXT NOT NULL UNIQUE,
        phone_key TEXT NOT NULL UNIQUE,
        game_id_key TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
        pseudo TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        game_id TEXT NOT NULL,
        controller_type TEXT NOT NULL DEFAULT 'touch',
        device TEXT NOT NULL DEFAULT 'phone',
        level_codm INTEGER NOT NULL DEFAULT 1,
        rank_mj TEXT NOT NULL DEFAULT 'Bronze',
        rank_br TEXT NOT NULL DEFAULT 'Bronze',
        country TEXT NOT NULL DEFAULT 'Benin',
        streamer_mode BOOLEAN NOT NULL DEFAULT FALSE,
        streamer_pseudo TEXT,
        trust_score INTEGER NOT NULL DEFAULT 100,
        stats JSONB NOT NULL DEFAULT '{"wins":0,"losses":0,"draws":0,"totalMatches":0,"totalEarnings":0,"winRate":0,"tournamentsWon":0,"tournamentsPlayed":0,"elo":1200}',
        progression JSONB NOT NULL DEFAULT '{"level":"BEGINNER","xp":0,"nextLevelXp":1000}',
        achievements JSONB NOT NULL DEFAULT '[]',
        date_joined TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_online BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        token TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        issued_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS realtime_sessions (
        token TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        pseudo TEXT NOT NULL,
        role TEXT NOT NULL,
        issued_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      -- Wallet
      CREATE TABLE IF NOT EXISTS wallets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
        cash_balance NUMERIC NOT NULL DEFAULT 0,
        bonus_balance NUMERIC NOT NULL DEFAULT 0,
        locked_balance NUMERIC NOT NULL DEFAULT 0,
        pending_winnings NUMERIC NOT NULL DEFAULT 0,
        locked_entries JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        transaction_type TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        reference TEXT,
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON wallet_transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON wallet_transactions(created_at DESC);

      -- Matches
      CREATE TABLE IF NOT EXISTS matches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        format TEXT NOT NULL,
        team_size INTEGER NOT NULL,
        entry_fee NUMERIC NOT NULL,
        prize_pool NUMERIC NOT NULL,
        zoyd_fee NUMERIC NOT NULL,
        arbiter_fee NUMERIC NOT NULL,
        rules JSONB NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'recruiting',
        arbiter_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
        room_name TEXT,
        room_password TEXT,
        finished_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS match_participants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        team INTEGER NOT NULL,
        is_captain BOOLEAN NOT NULL DEFAULT FALSE,
        ready BOOLEAN NOT NULL DEFAULT FALSE,
        checked_in BOOLEAN NOT NULL DEFAULT FALSE,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(match_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_match_participants_match_id ON match_participants(match_id);
      CREATE INDEX IF NOT EXISTS idx_match_participants_user_id ON match_participants(user_id);

      -- Tournaments
      CREATE TABLE IF NOT EXISTS tournaments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        format TEXT NOT NULL,
        team_size INTEGER NOT NULL,
        max_entries INTEGER NOT NULL,
        min_entries INTEGER NOT NULL DEFAULT 4,
        entry_fee NUMERIC NOT NULL,
        rules JSONB NOT NULL DEFAULT '{}',
        starts_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'recruiting',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tournament_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        captain_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        squad_name TEXT NOT NULL,
        seed INTEGER NOT NULL,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        final_placement INTEGER,
        checked_in BOOLEAN NOT NULL DEFAULT FALSE,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(tournament_id, captain_id)
      );

      CREATE TABLE IF NOT EXISTS tournament_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entry_id UUID NOT NULL REFERENCES tournament_entries(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(entry_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_tournament_entries_tournament_id ON tournament_entries(tournament_id);
      CREATE INDEX IF NOT EXISTS idx_tournament_entries_captain_id ON tournament_entries(captain_id);
      CREATE INDEX IF NOT EXISTS idx_tournament_members_entry_id ON tournament_members(entry_id);
      CREATE INDEX IF NOT EXISTS idx_tournament_members_user_id ON tournament_members(user_id);

      -- Chat
      CREATE TABLE IF NOT EXISTS chat_channels (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_id ON chat_messages(channel_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);

      CREATE TABLE IF NOT EXISTS chat_reads (
        channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        read_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (channel_id, user_id)
      );

      -- State Snapshots
      CREATE TABLE IF NOT EXISTS state_snapshots (
        kind TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (kind, entity_id)
      );

      CREATE INDEX IF NOT EXISTS idx_state_snapshots_kind ON state_snapshots(kind);
    `);
    
    console.log('✅ Supabase Schema initialized successfully!');
  } catch (error) {
    console.error('❌ Error initializing Supabase Schema:', error);
  } finally {
    db.end();
  }
};

initSupabaseDB();
