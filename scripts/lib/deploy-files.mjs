// Decides what a deploy uploads, stages it by upload class, and lists the
// URLs to refresh on the CDN. Used by scripts/deploy-oss.sh.
//
// node scripts/lib/deploy-files.mjs --dist dist --export export --mode daily|full \
//   --dates 2026-10-13,2026-10-12 --inventory .deploy/remote.json --out .deploy
//
// daily: uploads only files whose content is not already on OSS (by MD5), and
//        refreshes only their URLs. Nothing on OSS is deleted.
// full:  uploads everything (a repair), refreshes the whole site.
// feed:  the hourly 动态 deploy: like daily, but only /feed, the 人物 pages
//        (they show the feed's posts) and the _astro assets they may need
//        (new hashes only).
//
// Writes under --out:
//   stage/{astro,html,json,xml,other}/   files to upload, by Cache-Control class
//   bare.txt      "<key of an index.html>\t<the same URL without the trailing slash>"
//   cdn-urls.txt  every URL whose object this deploy changes
//   expected.txt  every object key a full deploy writes (for the cleanup dry run)
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { md5, readInventory } from './inventory.mjs';

export const SITE = 'https://www.amazingindex.com';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function listFiles(root, rel = '') {
  const entries = await readdir(path.join(root, rel), { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}

/** Upload class of a file, which decides its Cache-Control and Content-Type. */
export function uploadClass(rel) {
  if (rel.startsWith('_astro/')) return 'astro';
  if (rel.endsWith('.html')) return 'html';
  if (rel.endsWith('.json')) return 'json';
  if (rel.endsWith('.xml')) return 'xml';
  return 'other';
}

/**
 * Built files a deploy may upload. Shell templates are only published through
 * their per-URL copies. A daily build renders project pages empty, so they are
 * left as the last full deploy published them; everything else it built is
 * current (its editions and articles, and the pages that need no data).
 */
export function selectPages(distFiles, mode) {
  const pages = distFiles.filter((rel) => !rel.startsWith('shell/'));
  if (mode === 'feed') return pages.filter((rel) => rel === FEED_PAGE || rel.startsWith('people/') || rel.startsWith('_astro/'));
  return mode === 'full' ? pages : pages.filter((rel) => !rel.startsWith('projects/'));
}

export const FEED_PAGE = 'feed/index.html';

/** The URL forms of an object: a directory index is served with and without its slash. */
export function urlsFor(rel) {
  if (rel === 'index.html') return [`${SITE}/`];
  if (rel.endsWith('/index.html')) {
    const dir = rel.slice(0, -'/index.html'.length);
    return [`${SITE}/${dir}/`, `${SITE}/${dir}`];
  }
  return [`${SITE}/${rel}`];
}

/** Bare-URL object for a directory index (served for the URL without a slash). */
export function bareKey(rel) {
  return rel !== 'index.html' && rel.endsWith('/index.html') ? rel.slice(0, -'/index.html'.length) : null;
}

/**
 * `files`: rel → { root, hash }. `remote`: key → MD5 (or null) on OSS.
 * Returns what to upload, which bare URLs to (re)copy, and the CDN URLs.
 */
export function diffAgainstRemote(files, remote, mode) {
  const upload = [];
  const bare = [];
  for (const [rel, { hash }] of files) {
    const changed = mode === 'full' || remote.get(rel) !== hash;
    if (changed) upload.push(rel);
    const key = bareKey(rel);
    if (key && (mode === 'full' || changed || remote.get(key) !== hash)) bare.push([rel, key]);
  }
  // _astro files are immutable and served with a one-year cache: never refreshed.
  const urls = [...new Set([...upload, ...bare.map(([rel]) => rel)].filter((rel) => !rel.startsWith('_astro/')).flatMap(urlsFor))];
  return { upload, bare, urls };
}

export async function planDeploy({ dist, exportDir, mode, dates, remote }) {
  if (mode !== 'daily' && mode !== 'full' && mode !== 'feed') throw new Error(`Unknown deploy mode ${mode}`);
  for (const d of dates) if (!DATE.test(d)) throw new Error(`Invalid date ${d}`);
  if (mode === 'daily' && dates.length === 0) throw new Error('A daily deploy needs its edition dates');
  const pages = selectPages(await listFiles(dist), mode);
  if (mode === 'daily') {
    const missing = ['index.html', ...dates.map((d) => `daily/${d}/index.html`)].filter((rel) => !pages.includes(rel));
    if (missing.length > 0) throw new Error(`Daily deploy is missing built pages: ${missing.join(', ')}`);
  }
  if (mode === 'feed' && !pages.includes(FEED_PAGE)) throw new Error(`Feed deploy is missing ${FEED_PAGE}`);
  const exported = await listFiles(exportDir);
  const overlap = exported.filter((rel) => pages.includes(rel));
  if (overlap.length > 0) throw new Error(`Built pages and exported files overlap: ${overlap.slice(0, 5).join(', ')}`);

  const files = new Map();
  for (const [root, list] of [[dist, pages], [exportDir, exported]]) {
    for (const rel of list) files.set(rel, { root, hash: md5(await readFile(path.join(root, rel))) });
  }
  const diff = diffAgainstRemote(files, remote, mode);
  const expected = [...new Set([...files.keys(), ...[...files.keys()].map(bareKey).filter(Boolean)])].sort();
  return { files, ...diff, expected };
}

async function main() {
  const { values } = parseArgs({
    options: {
      dist: { type: 'string', default: 'dist' },
      export: { type: 'string', default: 'export' },
      mode: { type: 'string' },
      dates: { type: 'string', default: '' },
      inventory: { type: 'string' },
      out: { type: 'string', default: '.deploy' },
    },
  });
  const dates = values.dates.split(',').map((d) => d.trim()).filter(Boolean);
  if (values.mode !== 'full' && !values.inventory) throw new Error(`A ${values.mode} deploy needs --inventory to know what is already on OSS`);
  const remote = values.inventory ? await readInventory(values.inventory) : new Map();
  const plan = await planDeploy({ dist: values.dist, exportDir: values.export, mode: values.mode, dates, remote });

  const stage = path.join(values.out, 'stage');
  await rm(stage, { recursive: true, force: true });
  for (const rel of plan.upload) {
    const { root } = plan.files.get(rel);
    const target = path.join(stage, uploadClass(rel), uploadClass(rel) === 'astro' ? rel.slice('_astro/'.length) : rel);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(root, rel), target);
  }
  await writeFile(path.join(values.out, 'bare.txt'), plan.bare.map((pair) => pair.join('\t')).join('\n') + (plan.bare.length ? '\n' : ''));
  await writeFile(path.join(values.out, 'cdn-urls.txt'), plan.urls.join('\n') + (plan.urls.length ? '\n' : ''));
  await writeFile(path.join(values.out, 'expected.txt'), plan.expected.join('\n') + '\n');
  const count = (kind) => plan.upload.filter((rel) => uploadClass(rel) === kind).length;
  console.log(`[deploy-files] mode=${values.mode} files=${plan.files.size} upload=${plan.upload.length} (astro=${count('astro')} html=${count('html')} json=${count('json')} xml=${count('xml')} other=${count('other')}) unchanged=${plan.files.size - plan.upload.length} bare=${plan.bare.length} cdn_urls=${plan.urls.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
