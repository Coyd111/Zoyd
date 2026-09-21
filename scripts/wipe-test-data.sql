-- ═══════════════════════════════════════════════════════════════════
-- ZOYD — Vidage des données de test (prod)
-- Garde : compte admin (id 'admin-zoyd-control'), ses sessions, son 2FA,
--         tournois + ligues (snapshots), canal global (recréé au restart).
-- Supprime : autres utilisateurs, leurs sessions, matchs, messages,
--             amis/blocs/notifs, transactions FedaPay de test.
-- Procédure : 1) Exécuter dans Supabase > SQL Editor
--             2) IMMÉDIATEMENT après : Render > Manual Deploy > Restart service
--                (le serveur garde tout en mémoire : sans restart il ré-écrirait
--                les lignes supprimées en base)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- Sessions + push des comptes test (admin gardé → il reste connecté)
DELETE FROM auth_sessions      WHERE user_id <> 'admin-zoyd-control';
DELETE FROM realtime_sessions  WHERE user_id <> 'admin-zoyd-control';
DELETE FROM push_subscriptions WHERE user_id <> 'admin-zoyd-control';

-- Social (garde ce qui touche l'admin, normalement rien)
DELETE FROM friend_requests WHERE sender_id <> 'admin-zoyd-control' AND target_id <> 'admin-zoyd-control';
DELETE FROM friendships     WHERE user_id_1 <> 'admin-zoyd-control' AND user_id_2 <> 'admin-zoyd-control';
DELETE FROM user_blocks      WHERE blocker_id <> 'admin-zoyd-control' AND blocked_id <> 'admin-zoyd-control';
DELETE FROM user_notifications WHERE user_id <> 'admin-zoyd-control';

-- Chat : tous les messages + tous les salons sauf 'global' (recréé vide au restart)
DELETE FROM chat_messages;
DELETE FROM chat_reads;
DELETE FROM chat_channels WHERE id <> 'global';

-- Matchs (tournois + ligues conservés)
DELETE FROM state_snapshots WHERE kind = 'matches';

-- Transactions FedaPay de test (anti double-crédit — que du test ici)
DELETE FROM processed_transactions;

-- Utilisateurs test (soldes/wallets partent avec eux)
DELETE FROM app_users WHERE id <> 'admin-zoyd-control';

COMMIT;

-- ── Vérification : attendu = 1 seul user (l'admin), 0 match, 0 message ──
SELECT 'app_users' AS table_name, count(*) FROM app_users
UNION ALL SELECT 'matchs', count(*) FROM state_snapshots WHERE kind = 'matches'
UNION ALL SELECT 'tournois', count(*) FROM state_snapshots WHERE kind = 'tournaments'
UNION ALL SELECT 'ligues', count(*) FROM state_snapshots WHERE kind = 'leagues'
UNION ALL SELECT 'chat_messages', count(*) FROM chat_messages
UNION ALL SELECT 'auth_sessions', count(*) FROM auth_sessions;
SELECT id, role, payload->>'pseudo' AS pseudo, payload->>'email' AS email FROM app_users;
