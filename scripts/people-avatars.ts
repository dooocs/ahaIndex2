// Daily People Avatars job (.github/workflows/people-avatars.yml): for every
// published person with an X or GitHub handle, fetch their photo, store it on
// OSS under media/people/avatars/<slug>-<hash>.<ext> (immutable: a new photo
// gets a new name, so nothing needs a CDN refresh) and write
// people.avatar_url. Unchanged photos are neither uploaded nor written. A
// photo set by hand (avatar_url outside that prefix) is left alone. One
// person failing only skips that person. Rules: src/lib/people-avatars.ts.
//
// node --experimental-strip-types scripts/people-avatars.ts [--dry-run]
//
// Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (writes people),
// OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET (default amazingindex),
// OSSUTIL (default ossutil).
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { avatarKey, avatarSources, avatarUrl, rejectImage, type AvatarPerson } from '../src/lib/people-avatars.ts';

const run = promisify(execFile);
const dryRun = process.argv.includes('--dry-run');
const warn = (message: string) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${message}` : `[avatars] warning: ${message}`);
const log = (message: string) => console.log(`[avatars] ${message}`);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (the job writes people.avatar_url)');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = process.env.OSS_BUCKET || 'amazingindex';
const ossutil = process.env.OSSUTIL || 'ossutil';

const { data, error } = await db.from('people')
  .select('id, slug, x_handle, github_handle, avatar_url')
  .eq('status', 'published')
  .order('slug');
if (error) throw new Error(`Failed to read people: ${error.message}`);
const people = (data ?? []) as AvatarPerson[];

async function download(source: string): Promise<{ body: Uint8Array; type: string } | string> {
  try {
    const res = await fetch(source, { redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'amazingindex-people-avatars' } });
    if (!res.ok) return `HTTP ${res.status}`;
    const body = new Uint8Array(await res.arrayBuffer());
    const type = res.headers.get('content-type');
    const rejected = rejectImage(type, body.byteLength);
    return rejected ?? { body, type: type!.split(';')[0].trim().toLowerCase() };
  } catch (e) {
    return (e as Error).message;
  }
}

async function upload(objectKey: string, body: Uint8Array, type: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'avatar-'));
  try {
    const file = path.join(dir, 'avatar');
    await writeFile(file, body);
    await run(ossutil, [
      'cp', file, `oss://${bucket}/${objectKey}`, '--force',
      '--metadata', 'Cache-Control=max-age=31536000,immutable',
      '--metadata', `Content-Type=${type}`,
      '--endpoint', 'https://oss-cn-hangzhou.aliyuncs.com',
      '--access-key-id', process.env.OSS_ACCESS_KEY_ID ?? '',
      '--access-key-secret', process.env.OSS_ACCESS_KEY_SECRET ?? '',
      '--region', 'cn-hangzhou',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const counts = { updated: 0, unchanged: 0, manual: 0, none: 0, failed: 0 };
for (const person of people) {
  const sources = avatarSources(person);
  if (sources.length === 0) {
    if (person.avatar_url) counts.manual += 1;
    else counts.none += 1;
    continue;
  }
  const errors: string[] = [];
  let done = false;
  for (const source of sources) {
    const got = await download(source.url);
    if (typeof got === 'string') {
      errors.push(`${source.name}: ${got}`);
      continue;
    }
    const objectKey = avatarKey(person.slug, got.body, got.type);
    const next = avatarUrl(objectKey);
    if (next === person.avatar_url) {
      counts.unchanged += 1;
    } else if (dryRun) {
      log(`${person.slug}: would store ${next} (from ${source.name})`);
      counts.updated += 1;
    } else {
      try {
        await upload(objectKey, got.body, got.type);
        const write = await db.from('people').update({ avatar_url: next }).eq('id', person.id);
        if (write.error) throw new Error(write.error.message);
        log(`${person.slug}: ${next} (from ${source.name})`);
        counts.updated += 1;
      } catch (e) {
        errors.push(`${source.name}: ${(e as Error).message}`);
        continue;
      }
    }
    done = true;
    break;
  }
  if (!done) {
    counts.failed += 1;
    warn(`${person.slug}: no photo (${errors.join('; ')})${person.avatar_url ? ', keeping the current one' : ''}`);
  }
}

log(`${people.length} people: ${counts.updated} updated, ${counts.unchanged} unchanged, ${counts.manual} set by hand, ${counts.none} without a handle, ${counts.failed} failed${dryRun ? ' (dry run)' : ''}`);
// Everyone failing points at the sources or credentials, not at one person.
const attempted = counts.updated + counts.unchanged + counts.failed;
if (attempted > 0 && counts.failed === attempted) process.exit(1);
