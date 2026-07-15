-- ZOYD Platform — Supabase Schema Migration
-- Exécuter dans le SQL Editor du dashboard Supabase

-- ============================================================
-- 1. APP USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  pseudo_key TEXT NOT NULL UNIQUE,
  email_key TEXT NOT NULL UNIQUE,
  phone_key TEXT NOT NULL UNIQUE,
  game_id_key TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'player',
  password_hash TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_users_pseudo ON app_users(pseudo_key);
CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users(email_key);
CREATE INDEX IF NOT EXISTS idx_app_users_phone ON app_users(phone_key);
CREATE INDEX IF NOT EXISTS idx_app_users_game_id ON app_users(game_id_key);
CREATE INDEX IF NOT EXISTS idx_app_users_role ON app_users(role);

-- ============================================================
-- 2. AUTH SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);

-- ============================================================
-- 3. REALTIME SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS realtime_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  pseudo TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_realtime_sessions_user ON realtime_sessions(user_id);

-- ============================================================
-- 4. PUSH SUBSCRIPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  endpoint TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- ============================================================
-- 5. CHAT CHANNELS
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'private',
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. CHAT MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_id, created_at DESC);

-- ============================================================
-- 7. CHAT READS
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_reads (
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

-- ============================================================
-- 8. STATE SNAPSHOTS (matches, tournaments)
-- ============================================================
CREATE TABLE IF NOT EXISTS state_snapshots (
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_state_snapshots_kind ON state_snapshots(kind, updated_at DESC);

-- ============================================================
-- 9. FRIEND REQUESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sender_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_requests_target ON friend_requests(target_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_sender ON friend_requests(sender_id);

-- ============================================================
-- 10. FRIENDSHIPS
-- ============================================================
CREATE TABLE IF NOT EXISTS friendships (
  user_id_1 TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  user_id_2 TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id_1, user_id_2)
);

-- ============================================================
-- 11. USER BLOCKS
-- ============================================================
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

-- ============================================================
-- 12. USER NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS user_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  action_url TEXT,
  metadata JSONB,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON user_notifications(user_id, is_read, created_at DESC);

-- ============================================================
-- 13. PROCESSED TRANSACTIONS (FedaPay idempotency)
-- ============================================================
CREATE TABLE IF NOT EXISTS processed_transactions (
  transaction_id TEXT PRIMARY KEY,
  processed_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM now()),
  user_id TEXT,
  amount_zc DOUBLE PRECISION
);

-- ============================================================
-- 14. WALLET TRANSACTIONS (historique détaillé)
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON wallet_transactions(user_id, created_at DESC);

-- ============================================================
-- RLS POLICIES
-- ============================================================

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE state_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

-- Service role bypasses all RLS (le frontend n'utilise JAMAIS Supabase directement :
-- tout passe par le serveur custom avec la service_role key). Les politiques
-- ci-dessous restreignent explicitement l'acces a service_role, donc une
-- clé anon/authenticated exposee ne pourrait rien lire/ecrire (filet de sécurité).
CREATE POLICY "Service role only" ON app_users FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON auth_sessions FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON realtime_sessions FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON push_subscriptions FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON chat_channels FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON chat_messages FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON chat_reads FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON state_snapshots FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON friend_requests FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON friendships FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON user_blocks FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON user_notifications FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON processed_transactions FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON wallet_transactions FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_app_users_updated_at
  BEFORE UPDATE ON app_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_chat_channels_updated_at
  BEFORE UPDATE ON chat_channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- GLOBAL CHAT CHANNEL SEED
-- ============================================================
INSERT INTO chat_channels (id, type, payload, created_at, updated_at)
VALUES (
  'global',
  'global',
  '{"id":"global","type":"global","name":"Chat Global ZOYD","participants":[],"scope":"public","inbox":"all"}'::jsonb,
  now(),
  now()
) ON CONFLICT (id) DO NOTHING;
