// Supabase client — OPTIONNEL
// Si SUPABASE_URL / SUPABASE_ANON_KEY sont absents, on retourne un client no-op
// qui absorbe silencieusement toutes les opérations sans crasher le serveur.

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.server') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// Client no-op : toutes les méthodes retournent une promesse résolue vide
const createNoOpClient = () => {
  const noOpQuery = () => ({
    upsert: async () => ({ error: null }),
    insert: async () => ({ error: null }),
    update: async () => ({ error: null }),
    delete: async () => ({ error: null }),
    select: () => noOpQuery(),
    eq: () => noOpQuery(),
    single: async () => ({ data: null, error: null }),
    then: (resolve) => resolve({ data: null, error: null }),
  });

  return {
    from: () => noOpQuery(),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  };
};

let supabase;

if (supabaseUrl && supabaseKey) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[Supabase] Client actif');
  } catch {
    console.warn('[Supabase] Impossible de créer le client, mode no-op activé');
    supabase = createNoOpClient();
  }
} else {
  console.log('[Supabase] Variables absentes — mode no-op (SQLite seul actif)');
  supabase = createNoOpClient();
}

export { supabase };

// PostgreSQL Pool désactivé — utiliser uniquement le client REST Supabase ci-dessus
export const db = null;
