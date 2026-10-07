import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { verifyBuild } from './lib/verify-build.mjs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_BUILD_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Build verification requires SUPABASE_URL and SUPABASE_BUILD_KEY');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await client.from('display_items').select('snapshot_date')
  .order('snapshot_date', { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(20_000));
if (error) throw new Error(`Could not verify the latest database edition: ${error.code} ${error.message}`);
if (!data?.[0]?.snapshot_date) throw new Error('No latest database edition found');
const result = await verifyBuild(fileURLToPath(new URL('../dist/', import.meta.url)), data[0].snapshot_date);
console.log(`Build verified: ${JSON.stringify(result)}`);
