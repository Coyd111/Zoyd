import { db } from './supabase.mjs';

const initSupabaseDB = async () => {
  console.log('Initializing Supabase Database Schema...');

  try {
    await db.query(`
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

      CREATE TABLE IF NOT EXISTS auth_sessions (
        token TEXT PRIMARY KEY,
        user_id UUID NOT NULL,
        issued_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS realtime_sessions (
        token TEXT PRIMARY KEY,
        user_id UUID NOT NULL,
        pseudo TEXT NOT NULL,
        role TEXT NOT NULL,
        issued_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        user_id UUID NOT NULL,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_channels (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_reads (
        channel_id TEXT NOT NULL,
        user_id UUID NOT NULL,
        read_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (channel_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS state_snapshots (
        kind TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (kind, entity_id)
      );
    `);
    
    console.log('✅ Supabase Schema initialized successfully!');
  } catch (error) {
    console.error('❌ Error initializing Supabase Schema:', error);
  } finally {
    db.end();
  }
};

initSupabaseDB();
