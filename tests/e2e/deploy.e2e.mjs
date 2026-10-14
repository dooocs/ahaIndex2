// End-to-end deploy scenarios: scripts/run-deploy.sh, unchanged, against the
// mock database (scripts/dev/mock-supabase.mjs) and a stand-in OSS
// (scripts/dev/fake-ossutil.mjs). Slow (each run builds the site): run with
// `npm run test:e2e`, not part of `npm test`.
//
// After every successful run the bucket must be self-consistent: every
// internal link in every page resolves, and every edition, article, month and
// subject that data or sitemaps reference exists.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startMockSupabase } from '../../scripts/dev/mock-supabase.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), 'aha-e2e-'));
const PORT = 54398;
const SITE = 'https://www.amazingindex.com';

// `ossutil` on PATH is the fake.
const bin = path.join(work, 'bin');
mkdirSync(bin);
writeFileSync(path.join(bin, 'ossutil'), `#!/bin/sh\nexec node ${path.join(repo, 'scripts/dev/fake-ossutil.mjs')} "$@"\n`);
chmodSync(path.join(bin, 'ossutil'), 0o755);

let server;
async function database(latestDate) {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = await startMockSupabase({ port: PORT, latestDate });
}
test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  rmSync(work, { recursive: true, force: true });
});

/** One CI run against `bucket` with the database as of `date`. */
async function run(bucket, date, mode, { backfill = '', fail = '' } = {}) {
  await database(date);
  return new Promise((resolve) => {
    const child = spawn('bash', ['scripts/run-deploy.sh'], {
      cwd: repo,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_OSS_ROOT: bucket,
        FAKE_OSS_FAIL: fail,
        SUPABASE_URL: `http://127.0.0.1:${PORT}`,
        SUPABASE_BUILD_KEY: 'sb_publishable_mock',
        OSS_ACCESS_KEY_ID: 'id',
        OSS_ACCESS_KEY_SECRET: 'secret',
        MODE: mode,
        BACKFILL: backfill,
        SKIP_CDN: '1',
      },
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('close', (code) => resolve({ code, output }));
  });
}

async function ok(bucket, date, mode, options) {
  const result = await run(bucket, date, mode, options);
  assert.equal(result.code, 0, `run failed:\n${result.output.slice(-3000)}`);
  assertConsistent(bucket);
  return result.output;
}

const bucketDir = (name) => path.join(work, name);
const objects = (bucket) => new Map(readdirSync(path.join(bucket, 'objects')).map((f) => [decodeURIComponent(f), path.join(bucket, 'objects', f)]));
const read = (bucket, key) => readFileSync(path.join(bucket, 'objects', encodeURIComponent(key)), 'utf8');
const hashes = (bucket) => new Map([...objects(bucket)].map(([k, f]) => [k, createHash('md5').update(readFileSync(f)).digest('hex')]));
const copyBucket = (from, to) => cpSync(from, to, { recursive: true });

function assertConsistent(bucket) {
  const keys = objects(bucket);
  const page = (route) => {
    const k = route.replace(/^\//, '').replace(/\/$/, '');
    return k === '' ? keys.has('index.html') : keys.has(k) || keys.has(`${k}/index.html`);
  };
  for (const key of keys.keys()) {
    if (!key.endsWith('.html')) continue;
    for (const [, href] of read(bucket, key).matchAll(/href="([^"]*)"/g)) {
      if (!href.startsWith('/') || href.startsWith('//')) continue;
      const route = decodeURIComponent(href.split(/[?#]/)[0]);
      assert.ok(page(route), `${key} links to ${href}, which is not on the bucket`);
    }
  }
  for (const { slug } of JSON.parse(read(bucket, 'data/subjects/index.json')).sections.flatMap((x) => x.subjects)) {
    assert.ok(page(`/subjects/${slug}`) && keys.has(`data/subjects/${slug}.json`), `subject ${slug} is listed but its page or data is missing`);
  }
  const summary = JSON.parse(read(bucket, 'data/summary.json'));
  for (const { date } of summary.editions) assert.ok(page(`/daily/${date}`), `summary.json lists ${date}, which is not on the bucket`);
  for (const key of keys.keys()) {
    if (/^data\/archive\/\d{4}-\d{2}\.json$/.test(key)) {
      for (const { date } of JSON.parse(read(bucket, key)).records) assert.ok(page(`/daily/${date}`), `${key} lists ${date}, which is not on the bucket`);
    }
    if (/^sitemap.*\.xml$/.test(key)) {
      for (const [, loc] of read(bucket, key).matchAll(/<loc>([^<]*)<\/loc>/g)) {
        const route = loc.slice(SITE.length);
        assert.ok(/^\/sitemap/.test(route) ? keys.has(route.slice(1)) : page(route), `${key} lists ${loc}, which is not on the bucket`);
      }
    }
  }
}

/** Everything except project pages (rebuilt by full builds only) and assets. */
function assertSameSite(actual, expected) {
  const a = hashes(actual);
  const b = hashes(expected);
  const relevant = (k) => !k.startsWith('projects') && !k.startsWith('_astro/');
  const differing = [...b.keys()].filter((k) => relevant(k) && a.get(k) !== b.get(k));
  const extra = [...a.keys()].filter((k) => relevant(k) && !b.has(k));
  assert.deepEqual({ differing: differing.slice(0, 10), extra: extra.slice(0, 10) }, { differing: [], extra: [] });
}

const prevLink = (bucket, date) => read(bucket, `daily/${date}/index.html`).match(/<a href="\/daily\/([\d-]+)" rel="prev"/)?.[1] ?? null;

// The site as a fresh full build publishes it on 02-18 and on 02-19.
const reference = {};
test('reference: full builds into empty buckets', async () => {
  reference['2026-02-18'] = bucketDir('ref-0218');
  await ok(reference['2026-02-18'], '2026-02-18', 'full');
  reference['2026-02-19'] = bucketDir('ref-0219');
  await ok(reference['2026-02-19'], '2026-02-19', 'full');
});

test('multi-day gap: links skip missing editions, backfill restores them and the edition after', async () => {
  const bucket = bucketDir('gap');
  await ok(bucket, '2026-02-15', 'full');
  // 02-16 and 02-17: the pipeline ran, both deploys failed.
  const output = await ok(bucket, '2026-02-18', 'daily');
  assert.match(output, /edition 2026-02-16 is not on OSS/);
  assert.equal(prevLink(bucket, '2026-02-17'), '2026-02-15', '上一期 skips the missing 02-16');
  assert.ok(!JSON.parse(read(bucket, 'data/summary.json')).editions.some((e) => e.date === '2026-02-16'));

  const backfilled = await ok(bucket, '2026-02-18', 'daily', { backfill: 'missing' });
  assert.match(backfilled, /"dates":\["2026-02-18","2026-02-17","2026-02-16"\]/);
  assert.equal(prevLink(bucket, '2026-02-17'), '2026-02-16', 'the edition after a restored one links to it');
  assertSameSite(bucket, reference['2026-02-18']);
});

test('incomplete OSS listing: the run stops before uploading anything', async () => {
  const bucket = bucketDir('incomplete');
  copyBucket(reference['2026-02-18'], bucket);
  // A listing that misses one published edition (its page is "not there").
  rmSync(path.join(bucket, 'objects', encodeURIComponent('daily/2026-02-03/index.html')));
  const before = hashes(bucket);
  const result = await run(bucket, '2026-02-19', 'daily');
  assert.notEqual(result.code, 0);
  assert.match(result.output, /previously published editions are missing from the OSS listing.*2026-02-03/s);
  assert.deepEqual(hashes(bucket), before, 'nothing was uploaded');
});

test('interrupted uploads never publish indexes that point at missing pages', async () => {
  for (const [what, fail] of [['pages', '^sync .*stage/html/'], ['bare-URL copies', '^cp oss://amazingindex/article/']]) {
    const bucket = bucketDir(`interrupted-${what.replace(/\W/g, '')}`);
    copyBucket(reference['2026-02-18'], bucket);
    const indexes = ['data/summary.json', 'data/archive/index.json', 'rss.xml', 'sitemap-pages.xml', 'sitemap-articles-2026.xml'];
    const before = Object.fromEntries(indexes.map((k) => [k, read(bucket, k)]));
    const result = await run(bucket, '2026-02-19', 'daily', { fail });
    assert.notEqual(result.code, 0, `the ${what} failure stops the deploy`);
    for (const k of indexes) assert.equal(read(bucket, k), before[k], `${k} is still the previous one after a failed ${what} upload`);
    assertConsistent(bucket);
    // The next run completes the deploy.
    await ok(bucket, '2026-02-19', 'daily');
    assertSameSite(bucket, reference['2026-02-19']);
  }
});

test('first incremental run on a bucket without data files bootstraps once', async () => {
  const bucket = bucketDir('existing');
  await ok(bucket, '2026-02-17', 'full');
  // A bucket deployed before this change: pages and sitemaps, no data/ files.
  for (const key of objects(bucket).keys()) if (key.startsWith('data/')) rmSync(path.join(bucket, 'objects', encodeURIComponent(key)));
  const output = await ok(bucket, '2026-02-18', 'daily');
  assert.match(output, /bootstrap: \d+ editions from the database/);
  assertSameSite(bucket, reference['2026-02-18']);
});

test('a run with nothing new uploads nothing', async () => {
  const bucket = bucketDir('idempotent');
  copyBucket(reference['2026-02-19'], bucket);
  const output = await ok(bucket, '2026-02-19', 'daily');
  assert.match(output, /upload=0 /);
  assert.match(output, /bare=0 /);
});
