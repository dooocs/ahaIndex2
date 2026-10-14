// node scripts/verify-site.mjs --mode daily|full [--dates d1,d2] [--export export] [--inventory .deploy/remote.json]
// Checks the built pages (and, with --export, the exported files) against the
// newest edition in the database. Exits non-zero before anything is uploaded.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { verifyDist, verifyExport } from './lib/verify-site.mjs';
import { readInventory } from './lib/inventory.mjs';

const { values } = parseArgs({
  options: {
    dist: { type: 'string', default: 'dist' },
    export: { type: 'string' },
    mode: { type: 'string', default: process.env.BUILD_MODE || 'full' },
    dates: { type: 'string', default: process.env.BUILD_DATES || '' },
    inventory: { type: 'string' },
  },
});
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_BUILD_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Site verification requires SUPABASE_URL and SUPABASE_BUILD_KEY');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await client.from('display_items').select('snapshot_date')
  .order('snapshot_date', { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(20_000));
if (error) throw new Error(`Could not verify the latest database edition: ${error.code} ${error.message}`);
const latestDate = data?.[0]?.snapshot_date;
if (!latestDate) throw new Error('No latest database edition found');

const dist = path.resolve(values.dist);
const mode = values.mode === 'daily' ? 'daily' : 'full';
const dates = values.dates.split(',').map((d) => d.trim()).filter(Boolean);
console.log(`Pages verified: ${JSON.stringify(await verifyDist(dist, { latestDate, mode, dates }))}`);
if (values.export) {
  const inventory = values.inventory ? await readInventory(values.inventory) : new Map();
  if (mode === 'daily' && !values.inventory) throw new Error('Verifying a daily export needs --inventory');
  console.log(`Export verified: ${JSON.stringify(await verifyExport(path.resolve(values.export), dist, { latestDate, inventory }))}`);
}
