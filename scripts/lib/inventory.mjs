// What is on the bucket: object keys and their ETags. One listing per run is
// the ground truth for "this page is deployed" (sitemaps, RSS and data only
// reference listed or just-built pages) and lets a deploy skip files whose
// content is already there.
//
//   ossutil ls oss://amazingindex/ -r > .deploy/oss-ls.txt
//   node scripts/lib/inventory.mjs --oss-ls .deploy/oss-ls.txt --bucket amazingindex --out .deploy/remote.json
//   node scripts/lib/inventory.mjs --local /tmp/bucket --out .deploy/remote.json   # a local stand-in bucket
//
// For a simple upload, an OSS ETag is the MD5 of the content. Anything else
// (multipart uploads, an unrecognised listing format) gets a null ETag, which
// only means "upload again": correctness never depends on the ETag.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const MD5 = /^[0-9a-f]{32}$/;

/** Parses `ossutil ls -r` output into key → lowercase MD5 ETag (or null). */
export function parseOssutilLs(text, bucket, prefix = '') {
  const root = `oss://${bucket}/${prefix}`;
  const objects = new Map();
  for (const line of text.split('\n')) {
    const tokens = line.trim().split(/\s+/);
    const index = tokens.findIndex((t) => t.startsWith(root));
    if (index < 0) continue;
    const key = tokens.slice(index).join(' ').slice(root.length);
    if (!key || key.endsWith('/')) continue;
    const etag = (tokens[index - 1] || '').replace(/"/g, '').toLowerCase();
    objects.set(key, MD5.test(etag) ? etag : null);
  }
  return objects;
}

export function md5(content) {
  return createHash('md5').update(content).digest('hex');
}

/** Every file under `dir` → its MD5, keyed by its path relative to `dir`. */
export async function localInventory(dir, rel = '') {
  const objects = new Map();
  const entries = await readdir(path.join(dir, rel), { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) for (const [k, v] of await localInventory(dir, child)) objects.set(k, v);
    else if (entry.isFile()) objects.set(child, md5(await readFile(path.join(dir, child))));
  }
  return objects;
}

export async function readInventory(file) {
  const value = JSON.parse(await readFile(file, 'utf8'));
  if (!value || typeof value.objects !== 'object') throw new Error(`${file} is not an inventory`);
  return new Map(Object.entries(value.objects));
}

export async function writeInventory(file, objects) {
  await writeFile(file, JSON.stringify({ generated_at: new Date().toISOString(), count: objects.size, objects: Object.fromEntries(objects) }));
}

async function main() {
  const { values } = parseArgs({
    options: {
      'oss-ls': { type: 'string' },
      local: { type: 'string' },
      bucket: { type: 'string', default: 'amazingindex' },
      prefix: { type: 'string', default: '' },
      out: { type: 'string', default: '.deploy/remote.json' },
    },
  });
  let objects;
  if (values['oss-ls']) objects = parseOssutilLs(await readFile(values['oss-ls'], 'utf8'), values.bucket, values.prefix);
  else if (values.local) objects = await localInventory(path.join(values.local, values.prefix));
  else throw new Error('Pass --oss-ls <listing file> or --local <directory>');
  // Staging copies never count as deployed pages.
  for (const key of [...objects.keys()]) if (key.startsWith('__test__/')) objects.delete(key);
  await writeInventory(values.out, objects);
  const withEtag = [...objects.values()].filter(Boolean).length;
  const editions = [...objects.keys()].filter((k) => /^daily\/\d{4}-\d{2}-\d{2}\/index\.html$/.test(k)).length;
  const articles = [...objects.keys()].filter((k) => /^article\/[^/]+\/index\.html$/.test(k)).length;
  console.log(`[inventory] objects=${objects.size} with_md5=${withEtag} editions=${editions} articles=${articles}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
