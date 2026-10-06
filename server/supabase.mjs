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
// SUPABASE_SERVICE_ROLE_KEY est le nom documente dans DEPLOYMENT.md et celui
// utilise par le dashboard Supabase. SUPABASE_SERVICE_KEY est aussi accepte
// (c-est le nom dans render.yaml) pour retro-compatibilite : sans cela, un
// deploiement configure selon la doc se retrouvait en mode degrade
// (supabase = null) et perdait toute persistance.
//
// PAS de repli sur SUPABASE_ANON_KEY : ce code est concu pour ecrire avec le
// role service_role, qui contourne les RLS. Avec une cle anon, chaque
// ecriture echoue derriere un client qui se dit pourtant actif, et
// l argent cesse d etre persiste sans la moindre alerte.
//
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

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
