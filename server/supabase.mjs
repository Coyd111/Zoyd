// Supabase client — Primary database
// Uses service_role key for server-side operations (bypasses RLS)

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './logger.mjs';

const log = createLogger('supabase');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.server') });

const supabaseUrl = process.env.SUPABASE_URL;
// SUPABASE_SERVICE_ROLE_KEY est le nom documenté dans DEPLOYMENT.md et celui
// utilisé par le dashboard Supabase. Les deux autres sont acceptés pour
// rétro-compatibilité : sans cela, un déploiement configuré selon la doc se
// retrouvait en « mode dégradé » (supabase = null) et perdait toute persistance.
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

// Opt-out explicite : la suite E2E doit démarrer en mode MÉMOIRE, sinon elle
// dépend du réseau et des données de Supabase. `dotenv.config()` recharge
// .env.server et écrase les variables vides du process, donc vider
// SUPABASE_URL ne suffisait pas à isoler les tests.
const supabaseDisabled = process.env.ZOYD_DISABLE_SUPABASE === 'true';

let supabase = null;

if (supabaseDisabled) {
  log.warn('ZOYD_DISABLE_SUPABASE=true — mode memoire (tests E2E)');
} else if (supabaseUrl && supabaseKey) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    log.info('Client actif');
  } catch (err) {
    log.error('Erreur creation client', err);
    supabase = null;
  }
} else {
  log.warn('Variables SUPABASE_URL/SUPABASE_SERVICE_KEY absentes — mode degrade');
}

export { supabase };
