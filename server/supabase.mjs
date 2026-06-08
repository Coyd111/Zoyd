import { createClient } from '@supabase/supabase-js';
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

// Using Supabase REST API client for all operations
// Note: Direct PostgreSQL connection disabled due to DNS resolution issues
export const supabase = createClient(supabaseUrl, supabaseKey);

// PostgreSQL Pool disabled - using Supabase REST API instead
export const db = null;
