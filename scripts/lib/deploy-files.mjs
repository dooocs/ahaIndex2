// Decides what a deploy uploads, stages it by upload class, and lists the
// URLs to refresh on the CDN. Used by scripts/deploy-oss.sh.
//
// node scripts/lib/deploy-files.mjs --dist dist --export export --mode daily|full \
//   [--dates 2026-10-13,2026-10-12] --out .deploy
//
// Writes under --out:
//   stage/html/  stage/json/  stage/xml/  stage/other/   files to upload, by Cache-Control class
//   bare.txt      "<object key of an index.html>\t<the same URL without the trailing slash>"
//   cdn-urls.txt  every URL whose object this deploy changes
//   expected.txt  every object key this deploy writes (for the cleanup dry run)
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

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
  if (rel.endsWith('.html')) return 'html';
  if (rel.endsWith('.json')) return 'json';
  if (rel.endsWith('.xml')) return 'xml';
  return 'other';
}

/**
 * Which built files a deploy uploads, excluding `_astro/` (always uploaded
 * whole) and shell templates (only published through their per-URL copies).
 * A daily build renders only its editions and their articles, so everything it
 * built is current and goes out, except project pages: they are rendered empty
 * in daily mode and left as the last full deploy published them.
 */
export function selectPages(distFiles, mode) {
  const pages = distFiles.filter((rel) => !rel.startsWith('_astro/') && !rel.startsWith('shell/'));
  return mode === 'full' ? pages : pages.filter((rel) => !rel.startsWith('projects/'));
}

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

export async function planDeploy({ dist, exportDir, mode, dates }) {
  if (mode !== 'daily' && mode !== 'full') throw new Error(`Unknown deploy mode ${mode}`);
  for (const d of dates) if (!DATE.test(d)) throw new Error(`Invalid date ${d}`);
  if (mode === 'daily' && dates.length === 0) throw new Error('A daily deploy needs its edition dates');
  const distFiles = await listFiles(dist);
  const pages = selectPages(distFiles, mode);
  if (mode === 'daily') {
    const missing = ['index.html', ...dates.map((d) => `daily/${d}/index.html`)].filter((rel) => !pages.includes(rel));
    if (missing.length > 0) throw new Error(`Daily deploy is missing built pages: ${missing.join(', ')}`);
  }
  const astro = distFiles.filter((rel) => rel.startsWith('_astro/'));
  // The manifest is uploaded last, on its own, once everything it lists is live.
  const exported = (await listFiles(exportDir)).filter((rel) => rel !== '_deploy/manifest.json');
  const overlap = exported.filter((rel) => pages.includes(rel));
  if (overlap.length > 0) throw new Error(`Built pages and exported files overlap: ${overlap.slice(0, 5).join(', ')}`);
  return { pages, astro, exported };
}

async function main() {
  const { values } = parseArgs({
    options: {
      dist: { type: 'string', default: 'dist' },
      export: { type: 'string', default: 'export' },
      mode: { type: 'string' },
      dates: { type: 'string', default: '' },
      out: { type: 'string', default: '.deploy' },
    },
  });
  const dates = values.dates.split(',').map((d) => d.trim()).filter(Boolean);
  const { pages, astro, exported } = await planDeploy({ dist: values.dist, exportDir: values.export, mode: values.mode, dates });

  const stage = path.join(values.out, 'stage');
  await rm(stage, { recursive: true, force: true });
  const sources = [...pages.map((rel) => [values.dist, rel]), ...exported.map((rel) => [values.export, rel])];
  for (const [root, rel] of sources) {
    const target = path.join(stage, uploadClass(rel), rel);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(root, rel), target);
  }

  const uploaded = sources.map(([, rel]) => rel);
  const bare = uploaded.map((rel) => [rel, bareKey(rel)]).filter(([, key]) => key);
  const urls = [...new Set(uploaded.flatMap(urlsFor))];
  const expected = [...new Set([...uploaded, ...bare.map(([, key]) => key), ...astro, '_deploy/manifest.json'])].sort();
  await writeFile(path.join(values.out, 'bare.txt'), bare.map((pair) => pair.join('\t')).join('\n') + (bare.length ? '\n' : ''));
  await writeFile(path.join(values.out, 'cdn-urls.txt'), urls.join('\n') + '\n');
  await writeFile(path.join(values.out, 'expected.txt'), expected.join('\n') + '\n');
  const count = (kind) => uploaded.filter((rel) => uploadClass(rel) === kind).length;
  console.log(`[deploy-files] mode=${values.mode} html=${count('html')} json=${count('json')} xml=${count('xml')} other=${count('other')} bare=${bare.length} astro=${astro.length} cdn_urls=${urls.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
