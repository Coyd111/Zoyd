-- ═══════════════════════════════════════════════════════════════════════════
-- ZOYD — Purge CIBLÉE des données de test (prod)
--
-- Contexte (audit live 07/11/2026) : la prod contient des comptes et entournois
-- de test qui polluent classements / tournois / ligues :
--   pseudos TestJoueur1..4 (TE, gains fictifs 19 / 11,4 / 7,6 ZC),
--   AUDIT CUP 1V1, Bracket Test (T-MJ-MTBME3NZ), ligues #2-#4 ANNULÉE,
--   comptes d'audit créés le 07/11 (Audit*, Acc*, Real*).
--
-- Périmètre : UNIQUEMENT ces pseudos + leurs enfants. L'admin
-- ('admin-zoyd-control') et tout autre joueur réel sont hors périmètre :
-- le filtre est par pseudo documenté ci-dessous, jamais par « tout le monde ».
--
-- Procédure (Supabase > SQL Editor) :
--   1) Lancer l'ÉTAPE 1 (DRY RUN, lecture seule) et vérifier la liste.
--   2) Supprimer l'ÉTAPE 1 de l'éditeur, puis lancer l'ÉTAPE 2 (même session
--      si une seule requête enchaînée : commité — sinon relancer l'ÉTAPE 2
--      seule, chaque DELETE est atomique et ré-exécutable).
--   3) Lancer l'ÉTAPE 3 pour vérifier.
--   4) IMMÉDIATEMENT après : Render > Manual Deploy > Restart service
--      (le serveur garde tout en mémoire : sans restart il ré-écrirait
--      les lignes supprimées en base).
--
-- RÉFÉRENCE pseudo/email (à adapter si tu as renommé vos tests) :
--   TestJoueur%, TE, AUDIT%, Audit%, Acc%, Real%, ZOYDLIVE%
--   (ZOYDLIVE = suite E2E live, cf. scripts/cleanup-live-e2e.sql)
-- ═══════════════════════════════════════════════════════════════════════════

-- ==========================================================================
-- ÉTAPE 1 — DRY RUN (lecture seule, ne supprime rien)
-- Vérifier que la liste ne contient QUE des comptes de test.
-- ==========================================================================
SELECT id,
       payload->>'pseudo' AS pseudo,
       payload->>'email'  AS email,
       created_at
FROM app_users
WHERE payload->>'pseudo' LIKE 'TestJoueur%'
   OR payload->>'pseudo' LIKE 'Test%'
   OR payload->>'pseudo' LIKE 'TE'
   OR payload->>'pseudo' LIKE 'Audit%'
   OR payload->>'pseudo' LIKE 'ACC%'
   OR payload->>'pseudo' LIKE 'Acc%'
   OR payload->>'pseudo' LIKE 'Real%'
   OR payload->>'pseudo' LIKE 'ZOYDLIVE%'
   OR payload->>'email' LIKE '%@test.local'
   OR payload->>'email' LIKE '%@example.com'
ORDER BY created_at;

-- Tournois et ligues concernés (lecture seule) :
SELECT kind, entity_id,
       payload->>'name' AS name,
       payload->>'status' AS status
FROM state_snapshots
WHERE kind = 'tournaments'
  AND (payload->>'name' ILIKE '%test%' OR payload->>'name' ILIKE '%audit%'
       OR payload::text ILIKE '%testjoueur%' OR payload::text ILIKE '%zoydlive%');

SELECT kind, entity_id,
       payload->>'name' AS name,
       payload->>'status' AS status
FROM state_snapshots
WHERE kind = 'leagues'
  AND (payload->>'name' ILIKE '%test%' OR payload->>'name' ILIKE '%saison 2%'
       OR payload->>'name' ILIKE '%saison 3%' OR payload->>'name' ILIKE '%saison 4%');

-- ==========================================================================
-- ÉTAPE 2 — SUPPRESSION (à lancer uniquement si le dry run est propre)
-- ==========================================================================

-- 2a) Comptes de test (en premier, les FK de sessions sont CASCADE ou purges
--     explicites ci-dessous — même forme que cleanup-live-e2e.sql).
--     On supprime les enfants avant les parents pour ne jamais laisser
--     de ligne orpheline.
DELETE FROM chat_reads
WHERE user_id IN (
  SELECT id FROM app_users
  WHERE payload->>'pseudo' LIKE 'TestJoueur%' OR payload->>'pseudo' LIKE 'Test%'
     OR payload->>'pseudo' LIKE 'TE'      OR payload->>'pseudo' LIKE 'Audit%'
     OR payload->>'pseudo' LIKE 'ACC%'    OR payload->>'pseudo' LIKE 'Acc%'
     OR payload->>'pseudo' LIKE 'Real%'   OR payload->>'pseudo' LIKE 'ZOYDLIVE%'
     OR payload->>'email' LIKE '%@test.local' OR payload->>'email' LIKE '%@example.com'
);

DELETE FROM user_notifications
WHERE user_id IN (
  SELECT id FROM app_users
  WHERE payload->>'pseudo' LIKE 'TestJoueur%' OR payload->>'pseudo' LIKE 'Test%'
     OR payload->>'pseudo' LIKE 'TE'      OR payload->>'pseudo' LIKE 'Audit%'
     OR payload->>'pseudo' LIKE 'ACC%'    OR payload->>'pseudo' LIKE 'Acc%'
     OR payload->>'pseudo' LIKE 'Real%'   OR payload->>'pseudo' LIKE 'ZOYDLIVE%'
     OR payload->>'email' LIKE '%@test.local' OR payload->>'email' LIKE '%@example.com'
);

DELETE FROM auth_sessions
WHERE user_id IN (
  SELECT id FROM app_users
  WHERE payload->>'pseudo' LIKE 'TestJoueur%' OR payload->>'pseudo' LIKE 'Test%'
     OR payload->>'pseudo' LIKE 'TE'      OR payload->>'pseudo' LIKE 'Audit%'
     OR payload->>'pseudo' LIKE 'ACC%'    OR payload->>'pseudo' LIKE 'Acc%'
     OR payload->>'pseudo' LIKE 'Real%'   OR payload->>'pseudo' LIKE 'ZOYDLIVE%'
     OR payload->>'email' LIKE '%@test.local' OR payload->>'email' LIKE '%@example.com'
);

DELETE FROM realtime_sessions
WHERE user_id IN (
  SELECT id FROM app_users
  WHERE payload->>'pseudo' LIKE 'TestJoueur%' OR payload->>'pseudo' LIKE 'Test%'
     OR payload->>'pseudo' LIKE 'TE'      OR payload->>'pseudo' LIKE 'Audit%'
     OR payload->>'pseudo' LIKE 'ACC%'    OR payload->>'pseudo' LIKE 'Acc%'
     OR payload->>'pseudo' LIKE 'Real%'   OR payload->>'pseudo' LIKE 'ZOYDLIVE%'
     OR payload->>'email' LIKE '%@test.local' OR payload->>'email' LIKE '%@example.com'
);

DELETE FROM push_subscriptions
WHERE user_id IN (
  SELECT id FROM app_users
  WHERE payload->>'pseudo' LIKE 'TestJoueur%' OR payload->>'pseudo' LIKE 'Test%'
     OR payload->>'pseudo' LIKE 'TE'      OR payload->>'pseudo' LIKE 'Audit%'
     OR payload->>'pseudo' LIKE 'ACC%'    OR payload->>'pseudo' LIKE 'Acc%'
     OR payload->>'pseudo' LIKE 'Real%'   OR payload->>'pseudo' LIKE 'ZOYDLIVE%'
     OR payload->>'email' LIKE '%@test.local' OR payload->>'email' LIKE '%@example.com'
);

DELETE FROM friend_requests
WHERE sender_id IN (
  SELECT id FROM app_users
  WHERE payload->>'pseudo' LIKE 'TestJoueur%' OR payload->>'pseudo' LIKE 'Test%'
     OR payload->>'pseudo' LIKE 'TE'      OR payload->>'pseudo' LIKE 'Audit%'
     OR payload->>'pseudo' LIKE 'ACC%'    OR payload->>'pseudo' LIKE 'Acc%'
     OR payload->>'pseudo' LIKE 'Real%'   OR payload->>'pseudo' LIKE 'ZOYDLIVE%'
     OR payload->>'email' LIKE '%@test.local' OR payload->>'email' LIKE '%@example.com'
) OR target_id IN (
  SELECT id FROM app_users
  WHERE payload->>'pseudo' LIKE 'TestJoueur%' OR payload->>'pseudo' LIKE 'Test%'
     OR payload->>'pseudo' LIKE 'TE'      OR payload->>'pseudo' LIKE 'Audit%'
     OR payload->>'pseudo' LIKE 'ACC%'    OR payload->>'pseudo' LIKE 'Acc%'
     OR payload->>'pseudo' LIKE 'Real%'   OR payload->>'pseudo' LIKE 'ZOYDLIVE%'
     OR payload->>'email' LIKE '%@test.local' OR payload->>'email' LIKE '%@example.com'
);

DELETE FROM friendships
WHERE user_id_1 IN (
  SELECT id FROM app_users
  WHERE payload->>'pseudo' LIKE 'TestJoueur%' OR payload->>'pseudo' LIKE 'Test%'
     OR payload->>'pseudo' LIKE 'TE'      OR payload->>'pseudo' LIKE 'Audit%'
     OR payload->>'pseudo' LIKE 'ACC%'    OR payload->>'pseudo' LIKE 'Acc%'
     OR payload->>'pseudo' LIKE 'Real%'   OR payload->>'pseudo' LIKE 'ZOYDLIVE%'
     OR payload->>'email' LIKE '%@test.local' OR payload->>'email' LIKE '%@example.com'
) OR user_id_2 IN (
  SELECT id FROM app_users
  WHERE payload->>'pseudo' LIKE 'TestJoueur%' OR payload->>'pseudo' LIKE 'Test%'
     OR payload->>'pseudo' LIKE 'TE'      OR payload->>'pseudo' LIKE 'Audit%'
     OR payload->>'pseudo' LIKE 'ACC%'    OR payload->>'pseudo' LIKE 'Acc%'
     OR payload->>'pseudo' LIKE 'Real%'   OR payload->>'pseudo' LIKE 'ZOYDLIVE%'
     OR payload->>'email' LIKE '%@test.local' OR payload->>'email' LIKE '%@example.com'
);

DELETE FROM user_blocks
WHERE blocker_id IN (
  SELECT id FROM app_users
  WHERE payload->>'pseudo' LIKE 'TestJoueur%' OR payload->>'pseudo' LIKE 'Test%'
     OR payload->>'pseudo' LIKE 'TE'      OR payload->>'pseudo' LIKE 'Audit%'
     OR payload->>'pseudo' LIKE 'ACC%'    OR payload->>'pseudo' LIKE 'Acc%'
     OR payload->>'pseudo' LIKE 'Real%'   OR payload->>'pseudo' LIKE 'ZOYDLIVE%'
     OR payload->>'email' LIKE '%@test.local' OR payload->>'email' LIKE '%@example.com'
) OR blocked_id IN (
  SELECT id FROM app_users
  WHERE payload->>'pseudo' LIKE 'TestJoueur%' OR payload->>'pseudo' LIKE 'Test%'
     OR payload->>'pseudo' LIKE 'TE'      OR payload->>'pseudo' LIKE 'Audit%'
     OR payload->>'pseudo' LIKE 'ACC%'    OR payload->>'pseudo' LIKE 'Acc%'
     OR payload->>'pseudo' LIKE 'Real%'   OR payload->>'pseudo' LIKE 'ZOYDLIVE%'
     OR payload->>'email' LIKE '%@test.local' OR payload->>'email' LIKE '%@example.com'
);

-- Chat des comptes de test (droit à l'effacement, même filet que cleanup-live).
DELETE FROM chat_messages
WHERE payload->>'senderPseudo' LIKE 'TestJoueur%' OR payload->>'senderPseudo' LIKE 'Test%'
   OR payload->>'senderPseudo' LIKE 'Audit%'    OR payload->>'senderPseudo' LIKE 'Acc%'
   OR payload->>'senderPseudo' LIKE 'Real%'     OR payload->>'senderPseudo' LIKE 'ZOYDLIVE%';

-- Matchs des comptes de test (filet large : le pseudo est cherché dans tout
-- le payload ; un match réel ne contient aucun de ces marqueurs).
DELETE FROM state_snapshots
WHERE kind = 'matches'
  AND (payload::text LIKE '%TestJoueur%' OR payload::text LIKE '%Test%'
    OR payload::text LIKE '%Audit%'    OR payload::text LIKE '%ZOYDLIVE%'
    OR payload::text LIKE '%Real%');

-- Tournois de test identifiés par leur nom (Bracket Test, AUDIT CUP...).
DELETE FROM state_snapshots
WHERE kind = 'tournaments'
  AND (payload->>'name' ILIKE '%test%' OR payload->>'name' ILIKE '%audit%'
       OR payload::text ILIKE '%testjoueur%' OR payload::text ILIKE '%zoydlive%');

-- Ligues de test annulées (Saison 2/3/4, 0 joueur — dette irrecouvrable
-- déjà reclassée uncollectable en santé ; on retire l'affichage mort).
-- ATTENTION : si une ligue liste des dettes encore utiles, elle n'a pas
-- 'Saison' dans le nom — ce DELETE ne la touche pas.
DELETE FROM state_snapshots
WHERE kind = 'leagues'
  AND (payload->>'name' ILIKE '%test%' OR payload->>'name' ILIKE '%saison 2%'
       OR payload->>'name' ILIKE '%saison 3%' OR payload->>'name' ILIKE '%saison 4%');

-- Enfin les comptes eux-mêmes (après les enfants).
DELETE FROM app_users
WHERE payload->>'pseudo' LIKE 'TestJoueur%' OR payload->>'pseudo' LIKE 'Test%'
   OR payload->>'pseudo' LIKE 'TE'      OR payload->>'pseudo' LIKE 'Audit%'
   OR payload->>'pseudo' LIKE 'ACC%'    OR payload->>'pseudo' LIKE 'Acc%'
   OR payload->>'pseudo' LIKE 'Real%'   OR payload->>'pseudo' LIKE 'ZOYDLIVE%'
   OR payload->>'email' LIKE '%@test.local' OR payload->>'email' LIKE '%@example.com';

-- ==========================================================================
-- ÉTAPE 3 — VÉRIFICATION (après restart Render)
-- Attendu : admin + éventuels joueurs réels restants, 0 test, 0 match de test.
-- ==========================================================================
SELECT id, role, payload->>'pseudo' AS pseudo, payload->>'email' AS email
FROM app_users ORDER BY role;

SELECT 'app_users'      AS table_name, count(*) FROM app_users
UNION ALL SELECT 'auth_sessions', count(*) FROM auth_sessions
UNION ALL SELECT 'matches',       count(*) FROM state_snapshots WHERE kind = 'matches'
UNION ALL SELECT 'tournaments',   count(*) FROM state_snapshots WHERE kind = 'tournaments'
UNION ALL SELECT 'leagues',       count(*) FROM state_snapshots WHERE kind = 'leagues'
UNION ALL SELECT 'chat_messages', count(*) FROM chat_messages
UNION ALL SELECT 'restants test',
       count(*) FROM app_users
       WHERE payload->>'pseudo' LIKE 'Test%' OR payload->>'pseudo' LIKE 'Audit%'
          OR payload->>'pseudo' LIKE 'Acc%'  OR payload->>'pseudo' LIKE 'Real%'
          OR payload->>'pseudo' LIKE 'ZOYDLIVE%';
