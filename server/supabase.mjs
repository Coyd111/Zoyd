// Supabase client — Primary database
// Uses service_role key for server-side operations (bypasses RLS)

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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
    console.log('[Supabase] Client actif (url:', supabaseUrl, ')');
  } catch (err) {
    console.error('[Supabase] Erreur creation client:', err.message);
    supabase = null;
  }
} else {
  console.warn('[Supabase] Variables SUPABASE_URL/SUPABASE_SERVICE_KEY absentes — mode degrade');
}

export { supabase };
