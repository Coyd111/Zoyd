-- ==========================================================================
-- ZOYD - Nettoyage des comptes crees par la suite E2E live
--
-- CIBLE STRICTE : uniquement les comptes dont le pseudo commence par
-- 'ZOYDLIVE' (crees par e2e/live-api/live-full.spec.ts).
-- Le compte admin et tout compte reel sont hors perimetre.
--
-- ATTENTION : un run interrompu (test echoue, Ctrl+C) laisse son compte
-- derriere, car la suppression est faite par le dernier test : s'il ne
-- s'execute pas, le compte reste. C'est ce script qui rattrape ca.
--
-- NOTE TECHNIQUE : pas de CREATE TEMP TABLE ici. Le SQL Editor de Supabase
-- n'execute pas les scripts dans une seule session, donc une table
-- temporaire disparait avant les DELETE (erreur 42P01 "relation does not
-- exist"). Le critere est donc inline dans chaque requete. C'est
-- equivalent : app_users n'est modifie que par le DERNIER DELETE, donc la
-- liste des ids vises reste identique du debut a la fin.
-- Chaque DELETE est atomique et le script est re-executable sans risque.
--
-- PROCEDURE :
--   1) Lancer l'ETAPE 1 (DRY RUN, lecture seule) et verifier la liste.
--   2) Supprimer l'ETAPE 1 de l'editeur, puis lancer l'ETAPE 2.
--   3) Lancer l'ETAPE 3 pour verifier.
--   4) IMMEDIATEMENT apres : Render > Manual Deploy > Restart service
--      (le serveur garde tout en memoire : sans restart il reecrirait en
--      base les comptes supprimes).
-- ==========================================================================


-- ==========================================================================
-- ETAPE 1 - DRY RUN (lecture seule, ne supprime rien)
-- Lancer cette requete seule et verifier que la liste ne contient
-- QUE des pseudos ZOYDLIVE.
-- ==========================================================================
SELECT id,
       payload->>'pseudo' AS pseudo,
       payload->>'email'  AS email,
       created_at
FROM app_users
WHERE payload->>'pseudo' LIKE 'ZOYDLIVE%'
ORDER BY created_at;


-- ==========================================================================
-- ETAPE 2 - SUPPRESSION
-- A lancer uniquement si le dry run ne liste que des comptes ZOYDLIVE.
-- ==========================================================================

-- 2a) Tables enfants. La plupart des FK sont en ON DELETE CASCADE, mais
--     chat_reads n'en a pas : on la purge explicitement.
DELETE FROM chat_reads
WHERE user_id IN (SELECT id FROM app_users WHERE payload->>'pseudo' LIKE 'ZOYDLIVE%');

DELETE FROM user_notifications
WHERE user_id IN (SELECT id FROM app_users WHERE payload->>'pseudo' LIKE 'ZOYDLIVE%');

DELETE FROM auth_sessions
WHERE user_id IN (SELECT id FROM app_users WHERE payload->>'pseudo' LIKE 'ZOYDLIVE%');

DELETE FROM realtime_sessions
WHERE user_id IN (SELECT id FROM app_users WHERE payload->>'pseudo' LIKE 'ZOYDLIVE%');

DELETE FROM push_subscriptions
WHERE user_id IN (SELECT id FROM app_users WHERE payload->>'pseudo' LIKE 'ZOYDLIVE%');

DELETE FROM friend_requests
WHERE sender_id IN (SELECT id FROM app_users WHERE payload->>'pseudo' LIKE 'ZOYDLIVE%')
   OR target_id IN (SELECT id FROM app_users WHERE payload->>'pseudo' LIKE 'ZOYDLIVE%');

DELETE FROM friendships
WHERE user_id_1 IN (SELECT id FROM app_users WHERE payload->>'pseudo' LIKE 'ZOYDLIVE%')
   OR user_id_2 IN (SELECT id FROM app_users WHERE payload->>'pseudo' LIKE 'ZOYDLIVE%');

DELETE FROM user_blocks
WHERE blocker_id IN (SELECT id FROM app_users WHERE payload->>'pseudo' LIKE 'ZOYDLIVE%')
   OR blocked_id  IN (SELECT id FROM app_users WHERE payload->>'pseudo' LIKE 'ZOYDLIVE%');

-- 2b) Messages de chat envoyes par ces pseudos (droit a l'effacement).
--     Ces comptes n'en ont normalement pas, mais on ne laisse rien.
DELETE FROM chat_messages
WHERE payload->>'senderPseudo' LIKE 'ZOYDLIVE%';

-- 2c) Matchs des comptes de test. Filet de securite : ils n'avaient
--     aucun solde, ils n'ont donc jamais pu creer de match. Le filtre est
--     volontairement large (le pseudo est cherche dans tout le payload) :
--     il ne peut pas toucher un match reel, qui ne contient pas ZOYDLIVE.
DELETE FROM state_snapshots
WHERE kind = 'matches'
  AND payload::text LIKE '%ZOYDLIVE%';

-- 2d) Enfin les comptes eux-memes (apres les enfants, pour ne jamais
--     laisser de ligne orpheline).
DELETE FROM app_users
WHERE payload->>'pseudo' LIKE 'ZOYDLIVE%';


-- ==========================================================================
-- ETAPE 3 - VERIFICATION
-- Attendu : 1 seul user (l'admin), 0 match, 0 restant ZOYDLIVE.
-- ==========================================================================
SELECT id, role, payload->>'pseudo' AS pseudo, payload->>'email' AS email
FROM app_users
ORDER BY role;

SELECT 'app_users'      AS table_name, count(*) FROM app_users
UNION ALL SELECT 'auth_sessions', count(*) FROM auth_sessions
UNION ALL SELECT 'matches',       count(*) FROM state_snapshots WHERE kind = 'matches'
UNION ALL SELECT 'chat_messages', count(*) FROM chat_messages
UNION ALL SELECT 'restants ZOYDLIVE',
       count(*) FROM app_users WHERE payload->>'pseudo' LIKE 'ZOYDLIVE%';