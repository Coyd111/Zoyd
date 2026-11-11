-- ZOYD — BAIL DISTRIBUE DES TRAVAUX DE FOND
-- Exécuter dans le SQL Editor du dashboard Supabase.
--
-- Contexte : les jobs de fond (`server/cron.mjs`) n'étaient protégés que par
-- des verrous de PROCESSUS (`withMatchMutex`, `withWalletMutex`) et des
-- drapeaux `*Running`. Ces protections ne valent rien entre deux instances.
--
-- Or deux instances coexistent pendant un déploiement Render : l'ancienne
-- (qui termine ses requêtes) et la nouvelle (qui démarre). Les deux
-- exécutent `initCronJobs`, donc les deux balayent les règlements en
-- attente : l'appel à FedaPay part deux fois, les compteurs avancent deux
-- fois, et le journal ment sur l'état réel.
--
-- `job_name` est la CLÉ PRIMAIRE : l'acquisition du bail est un INSERT qui
-- REFUSE le doublon (code Postgres 23505). Deux instances en compétition
-- pour le même job : une seule obtient le bail. C'est exactement le mécanisme
-- de la réservation FedaPay (`processed_transactions`), déjà éprouvé.
--
-- `expires_at` est INDISPENSABLE : sans expiration, l'instance qui détient
-- le bail et qui meurt (crash, redémarrage) gèlerait le job POUR TOUJOURS.
-- Le job le plus important de la plateforme — le règlement des matchs —
-- resterait bloqué indéfiniment. Passé l'échéance, le bail est reprenable.
--
-- Tant que cette table manque, le bail est ACCORDÉ (dégradé, pas arrêté) :
-- la protection multi-instance n'est pas active, et `/api/health` expose
-- `cronLease.available: false` pour que l'opérateur le voie.

CREATE TABLE IF NOT EXISTS cron_leases (
  job_name TEXT PRIMARY KEY,
  -- Instance détentrice du bail (RENDER_INSTANCE_ID, HOSTNAME ou pid).
  holder TEXT NOT NULL,
  -- Instant d'acquisition (epoch ms).
  acquired_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  -- Fin de validité (epoch ms). Passé ce terme, le bail est reprenable.
  expires_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_cron_leases_expires ON cron_leases(expires_at);

-- Vérification (optionnel) :
--   select table_name from information_schema.tables
--   where table_name = 'cron_leases';
