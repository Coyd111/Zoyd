-- ═══════════════════════════════════════════════════════════════════
-- ZOYD — Nettoyage des comptes créés par la suite E2E live
--
-- CIBLE STRICTE : uniquement les comptes dont le pseudo commence par
-- 'ZOYDLIVE' (créés par e2e/live-api/live-full.spec.ts). Le compte admin
-- et tout compte réel sont hors périmètre.
--
-- ⚠ Un run interrompu (test échoué, Ctrl+C) laisse son compte derrière :
--   la suppression du compte est faite par le dernier test, donc s'il ne
--   s'exécute pas, le compte reste. C'est ce script qui rattrape ça.
--
-- Procédure : 1) Exécuter dans Supabase > SQL Editor
--             2) IMMÉDIATEMENT après : Render > Manual Deploy > Restart service
--                (le serveur garde tout en mémoire : sans restart il
--                réécrirait en base les comptes supprimés)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 1) Capturer les ids visés AVANT suppression (pour les tables liées).
CREATE TEMP TABLE zoyd_e2e_users AS
SELECT id
FROM app_users
WHERE payload->>'pseudo' LIKE 'ZOYDLIVE%';

-- 2) Tables enfants (les FK ont ON DELETE CASCADE pour la plupart, mais
--    chat_reads n'en a pas : on les purge explicitement).
DELETE FROM chat_reads         WHERE user_id IN (SELECT id FROM zoyd_e2e_users);
DELETE FROM user_notifications WHERE user_id IN (SELECT id FROM zoyd_e2e_users);
DELETE FROM auth_sessions      WHERE user_id IN (SELECT id FROM zoyd_e2e_users);
DELETE FROM realtime_sessions  WHERE user_id IN (SELECT id FROM zoyd_e2e_users);
DELETE FROM push_subscriptions WHERE user_id IN (SELECT id FROM zoyd_e2e_users);
DELETE FROM friend_requests
WHERE sender_id IN (SELECT id FROM zoyd_e2e_users)
   OR target_id IN (SELECT id FROM zoyd_e2e_users);
DELETE FROM friendships
WHERE user_id_1 IN (SELECT id FROM zoyd_e2e_users)
   OR user_id_2 IN (SELECT id FROM zoyd_e2e_users);
DELETE FROM user_blocks
WHERE blocker_id IN (SELECT id FROM zoyd_e2e_users)
   OR blocked_id  IN (SELECT id FROM zoyd_e2e_users);

-- 3) Matchs créés par ces comptes (aucun ne survit : ils n'ont jamais pu
--    être financés, donc aucun match réel n'est concerné).
DELETE FROM state_snapshots
WHERE kind = 'matches'
  AND payload::text ~ 'ZOYDLIVE';

-- 4) Les comptes eux-mêmes.
DELETE FROM app_users WHERE id IN (SELECT id FROM zoyd_e2e_users);

DROP TABLE zoyd_e2e_users;

COMMIT;

-- ── Vérification attendu : 1 seul user (l'admin) ──
SELECT id, role, payload->>'pseudo' AS pseudo, payload->>'email' AS email
FROM app_users
ORDER BY role;
SELECT 'app_users' AS table_name, count(*) FROM app_users
UNION ALL SELECT 'auth_sessions', count(*) FROM auth_sessions
UNION ALL SELECT 'matches', count(*) FROM state_snapshots WHERE kind = 'matches';
