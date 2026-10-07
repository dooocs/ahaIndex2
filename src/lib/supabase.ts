import { createClient } from '@supabase/supabase-js';
import { getBuildKeyInfo } from './supabase-key';

const url = import.meta.env.SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = (
  import.meta.env.SUPABASE_BUILD_KEY || process.env.SUPABASE_BUILD_KEY ||
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
)?.trim();

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_BUILD_KEY (legacy SUPABASE_SERVICE_ROLE_KEY is also supported)');
}

const keyInfo = getBuildKeyInfo(key);
console.info(`[build-data] supabase key_type=${keyInfo.type} role=${keyInfo.role}`);

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
