import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.server') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables in .env.server');
}

// We can use the Anon Key for simple operations, but for a real backend
// we should ideally use a Service Role key. If not provided, RLS might block writes.
// Since we have the DB connection string, we will use 'pg' for backend writes to bypass RLS,
// or we assume RLS is disabled for now on the public tables.
export const supabase = createClient(supabaseUrl, supabaseKey);

// PostgreSQL Pool for direct DB queries (migrations, bypassing RLS)
const { Pool } = pg;
export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});
