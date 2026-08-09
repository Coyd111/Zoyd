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
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey) {
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
