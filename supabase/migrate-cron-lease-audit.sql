-- ZOYD — Historique durable des prises de bail de cron
-- Exécuter dans le SQL Editor du dashboard Supabase.
--
-- Contexte
-- --------
-- La table `cron_leases` (cf. migrate-cron-leases.sql) ne garde que le bail
-- COURANT : la ligne est SUPPRIMEE à la fin de chaque job (le bail est
-- relâché dans un `finally`). Conséquence : entre deux jobs, la table est
-- VIDE — c'est le comportement correct, mais cela veut dire qu'il n'existe
-- AUCUN endroit où constater qu'un job a tourné SANS protection multi-
-- instance.
--
-- C'est exactement ce qui s'est produit en production après le déploiement
-- du bail : chaque INSERT échouait sur un BIGINT, donc le bail n'était
-- JAMAIS pris, et la protection promise n'existait pas. Le booleen
-- `cronLeaseAvailable` disait `true` (la table était visible), la table des
-- bails était vide entre deux jobs, et les compteurs en mémoire
-- repartaient à zéro au redémarrage de l'instance. Aucun signal.
--
-- Cette table apporte l'historique DURABLE : une ligne par prise de bail,
-- conservée 30 jours. Elle survit au redémarrage et à l'hibernation de
-- l'instance.
--
-- `acquired = false` est la ligne la plus intéressante : elle dit qu'une
-- AUTRE instance détenait le job — donc que deux instances étaient actives
-- en même temps.
--
-- RLS : la table contient l'identité de l'instance (topologie du
-- déploiement). Elle doit être réservée au serveur (service_role), comme
-- toutes les autres tables.

CREATE TABLE IF NOT EXISTS cron_lease_audit (
  id BIGSERIAL PRIMARY KEY,
  -- Job de fond concerné.
  job_name TEXT NOT NULL,
  -- Instance qui a traite la tentative (RENDER_INSTANCE_ID, HOSTNAME ou pid).
  holder TEXT NOT NULL,
  -- Le bail a-t-il été obtenu ? false = une autre instance le détenait.
  acquired BOOLEAN NOT NULL,
  -- Motif : acquis, repris, busy, erreur-base, table-absente, erreur-job.
  reason TEXT,
  -- Instant de la tentative (epoch ms).
  acquired_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  -- Durée du job en ms, si elle est connue.
  duration_ms BIGINT
);

-- La purge filtre sur `acquired_at` : sans cet index, le DELETE de retention
-- parcours toute la table.
CREATE INDEX IF NOT EXISTS idx_cron_lease_audit_acquired ON cron_lease_audit(acquired_at);

-- Consultation par job (la question d'exploitation la plus frequente :
-- « ce job a-t-il déjà tourné sans protection ? »).
CREATE INDEX IF NOT EXISTS idx_cron_lease_audit_job ON cron_lease_audit(job_name, acquired_at DESC);

ALTER TABLE cron_lease_audit ENABLE ROW LEVEL SECURITY;

-- `CREATE POLICY IF NOT EXISTS` n'existe pas en Postgres : on supprime la
-- politique si elle existe avant de la recreer. Le script est donc
-- REJOUABLE, ce qui compte pour une migration manuelle.
DROP POLICY IF EXISTS "Service role only" ON cron_lease_audit;
CREATE POLICY "Service role only" ON cron_lease_audit
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Vérification (optionnel) :
--   select count(*), count(*) filter (where acquired = false) as refus
--   from cron_lease_audit where acquired_at > extract(epoch from now())*1000 - 86400000;
