-- ZOYD — Concurrence multi-instance : révision des snapshots d'état
-- Exécuter dans le SQL Editor du dashboard Supabase (ou au boot via migration).
--
-- Contexte : `app_users.revision` protège déjà les portefeuilles
-- (server/persistence.mjs `ecrireUserRow`). Les collections d'état
-- (`state_snapshots` : matches, tournaments, leagues, brLobbies) n'avaient
-- aucune version : `replaceStateCollection` écrasait sans condition, donc
-- deux instances pendant un déploiement perdaient l'écriture de l'autre.
--
-- `revision` est incrémenté par toute écriture d'une entité. L'écriture
-- conditionnelle (`update ... where kind + entity_id + revision = observed`)
-- ne touche aucune ligne si une autre instance a écrit entre-temps : le
-- serveur voit le conflit au lieu de l'écraser.
--
-- NOT NULL DEFAULT 0 rend les lignes existantes immédiatement cohérentes.
-- `stateRevisionSupporte()` (persistence.mjs) détecte la colonne : absente,
-- le serveur retombe sur l'écriture inconditionnelle et expose
-- `stateRevisionSupported: false` dans /api/health (fenêtre ouverte,
-- visible, pas silencieuse).

ALTER TABLE state_snapshots ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_state_snapshots_revision ON state_snapshots(revision);

-- Vérification (optionnel) :
--   select column_name, data_type from information_schema.columns
--   where table_name = 'state_snapshots' and column_name = 'revision';
