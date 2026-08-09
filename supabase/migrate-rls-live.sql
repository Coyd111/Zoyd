-- ============================================================
-- ZOYD — Migration RLS Live
-- Coller dans le SQL Editor du dashboard Supabase puis Exécuter
-- ============================================================
-- Ce script est idempotent : il peut etre execute plusieurs fois
-- sans danger. Les CREATE TABLE IF NOT EXISTS sont inclus pour
-- les tables qui n'existeraient pas encore.
-- ============================================================

-- ─── 1. TABLES (si manquantes) ───────────────────────────────

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

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS realtime_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  pseudo TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  endpoint TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'private',
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_reads (
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS state_snapshots (
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, entity_id)
);

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

CREATE TABLE IF NOT EXISTS friendships (
  user_id_1 TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  user_id_2 TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id_1, user_id_2)
);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

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

CREATE TABLE IF NOT EXISTS processed_transactions (
  transaction_id TEXT PRIMARY KEY,
  processed_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM now()),
  user_id TEXT,
  amount_zc DOUBLE PRECISION
);

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

-- ─── 2. INDEXES (si manquants) ──────────────────────────────

CREATE INDEX IF NOT EXISTS idx_app_users_pseudo ON app_users(pseudo_key);
CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users(email_key);
CREATE INDEX IF NOT EXISTS idx_app_users_phone ON app_users(phone_key);
CREATE INDEX IF NOT EXISTS idx_app_users_game_id ON app_users(game_id_key);
CREATE INDEX IF NOT EXISTS idx_app_users_role ON app_users(role);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_realtime_sessions_user ON realtime_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_state_snapshots_kind ON state_snapshots(kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_friend_requests_target ON friend_requests(target_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_sender ON friend_requests(sender_id);
CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON user_notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON wallet_transactions(user_id, created_at DESC);

-- ─── 3. ENABLE RLS ─────────────────────────────────────────

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

-- ─── 4. RLS POLICIES (service_role only) ────────────────────
-- Le frontend n'utilise JAMAIS Supabase directement :
-- tout passe par le serveur custom avec la service_role key.
-- Ces politiques restreignent explicitement l'acces a service_role.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only' AND tablename = 'app_users') THEN
    CREATE POLICY "Service role only" ON app_users FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only' AND tablename = 'auth_sessions') THEN
    CREATE POLICY "Service role only" ON auth_sessions FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only' AND tablename = 'realtime_sessions') THEN
    CREATE POLICY "Service role only" ON realtime_sessions FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only' AND tablename = 'push_subscriptions') THEN
    CREATE POLICY "Service role only" ON push_subscriptions FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only' AND tablename = 'chat_channels') THEN
    CREATE POLICY "Service role only" ON chat_channels FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only' AND tablename = 'chat_messages') THEN
    CREATE POLICY "Service role only" ON chat_messages FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only' AND tablename = 'chat_reads') THEN
    CREATE POLICY "Service role only" ON chat_reads FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only' AND tablename = 'state_snapshots') THEN
    CREATE POLICY "Service role only" ON state_snapshots FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only' AND tablename = 'friend_requests') THEN
    CREATE POLICY "Service role only" ON friend_requests FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only' AND tablename = 'friendships') THEN
    CREATE POLICY "Service role only" ON friendships FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only' AND tablename = 'user_blocks') THEN
    CREATE POLICY "Service role only" ON user_blocks FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only' AND tablename = 'user_notifications') THEN
    CREATE POLICY "Service role only" ON user_notifications FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only' AND tablename = 'processed_transactions') THEN
    CREATE POLICY "Service role only" ON processed_transactions FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role only' AND tablename = 'wallet_transactions') THEN
    CREATE POLICY "Service role only" ON wallet_transactions FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- ─── 5. TRIGGERS updated_at ─────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_app_users_updated_at ON app_users;
CREATE TRIGGER trigger_app_users_updated_at
  BEFORE UPDATE ON app_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_chat_channels_updated_at ON chat_channels;
CREATE TRIGGER trigger_chat_channels_updated_at
  BEFORE UPDATE ON chat_channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── 6. SEED — Canal global ─────────────────────────────────

INSERT INTO chat_channels (id, type, payload, created_at, updated_at)
VALUES (
  'global',
  'global',
  '{"id":"global","type":"global","name":"Chat Global ZOYD","participants":[],"scope":"public","inbox":"all"}'::jsonb,
  now(),
  now()
) ON CONFLICT (id) DO NOTHING;

-- ─── 7. SEED — Admin (optionnel) ────────────────────────────
-- Remplacez les valeurs ci-dessous par votre compte admin.
-- Le hash ci-dessous correspond au mot de passe "admin123" (a changer !).
-- Si vous n'avez pas encore de compte admin, commentez cette section.

-- INSERT INTO app_users (id, pseudo_key, email_key, phone_key, game_id_key, role, password_hash, payload, created_at, updated_at)
-- VALUES (
--   'admin-001',
--   'admin',
--   'admin@zoyd.africa',
--   '0000000000',
--   'ADMIN-001',
--   'admin',
--   '$2b$10$placeholder_hash_a_changer',
--   '{"pseudo":"Admin","email":"admin@zoyd.africa","phone":"0000000000","gameId":"ADMIN-001","role":"admin","wallet":{"cashBalance":0,"bonusBalance":0,"lockedBalance":0,"pendingWinnings":0,"lockedEntries":{},"transactions":[]},"stats":{"wins":0,"losses":0,"draws":0,"totalMatches":0,"totalEarnings":0,"winRate":0,"tournamentsWon":0,"tournamentsPlayed":0,"elo":1200},"progression":{"level":"BEGINNER","xp":0,"nextLevelXp":1000}}'::jsonb,
--   now(),
--   now()
-- ) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- FIN DE LA MIGRATION
-- Verifiez dans le dashboard Supabase > Table Editor que les
-- 14 tables ont bien RLS active (icone cadenas verte).
-- ============================================================
