import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getBuildKeyInfo } from './supabase-key.ts';

let client: SupabaseClient | undefined;

export function createBuildClient(url: string | undefined, rawKey: string | undefined): SupabaseClient {
  const key = rawKey?.trim();
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_BUILD_KEY (legacy SUPABASE_SERVICE_ROLE_KEY is also supported)');
  }
  const keyInfo = getBuildKeyInfo(key);
  console.info(`[build-data] supabase key_type=${keyInfo.type} role=${keyInfo.role}`);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * The build's database client, created on first use. Pages that never read
 * the news database (about, legal, community) build and run in dev without
 * credentials.
 */
export function getSupabase(): SupabaseClient {
  client ??= createBuildClient(
    import.meta.env.SUPABASE_URL ?? process.env.SUPABASE_URL,
    import.meta.env.SUPABASE_BUILD_KEY || process.env.SUPABASE_BUILD_KEY ||
      import.meta.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  return client;
}
