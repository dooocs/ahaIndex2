import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { bareKey, diffAgainstRemote, planDeploy, selectPages, uploadClass, urlsFor } from '../scripts/lib/deploy-files.mjs';
import { localInventory, md5, parseOssutilLs } from '../scripts/lib/inventory.mjs';

const DIST = [
  '_astro/a.css', 'index.html', '404.html', 'robots.txt', 'about/index.html', 'daily/index.html',
  'daily/2026-10-12/index.html', 'daily/2026-10-13/index.html', 'article/p1/index.html',
  'projects/index.html', 'projects/x/index.html', 'shell/subject/index.html',
];

test('a full deploy takes every built file except shell templates', () => {
  const pages = selectPages(DIST, 'full');
  assert.ok(pages.includes('projects/x/index.html') && pages.includes('_astro/a.css'));
  assert.ok(!pages.some((p) => p.startsWith('shell/')));
});

test('a daily deploy takes everything it built except project pages', () => {
  assert.deepEqual(selectPages(DIST, 'daily').sort(), [
    '404.html', '_astro/a.css', 'about/index.html', 'article/p1/index.html', 'daily/2026-10-12/index.html',
    'daily/2026-10-13/index.html', 'daily/index.html', 'index.html', 'robots.txt',
  ]);
});

test('daily uploads only what differs from the bucket; full uploads everything', () => {
  const files = new Map([
    ['index.html', { hash: 'new' }],
    ['about/index.html', { hash: 'same' }],
    ['article/p1/index.html', { hash: 'same' }],
    ['_astro/a.css', { hash: 'css' }],
    ['_astro/b.js', { hash: 'js' }],
  ]);
  const remote = new Map([['index.html', 'old'], ['about/index.html', 'same'], ['about', 'same'], ['article/p1/index.html', 'same'], ['_astro/a.css', 'css']]);
  const daily = diffAgainstRemote(files, remote, 'daily');
  assert.deepEqual(daily.upload, ['index.html', '_astro/b.js']);
  // An unchanged page whose bare copy is missing gets its bare copy back.
  assert.deepEqual(daily.bare, [['article/p1/index.html', 'article/p1']]);
  assert.deepEqual(daily.urls, ['https://www.amazingindex.com/', 'https://www.amazingindex.com/article/p1/', 'https://www.amazingindex.com/article/p1']);
  const full = diffAgainstRemote(files, remote, 'full');
  assert.equal(full.upload.length, files.size);
  assert.equal(full.bare.length, 2);
});

test('an object with an unknown ETag is uploaded again', () => {
  const { upload } = diffAgainstRemote(new Map([['index.html', { hash: 'h' }]]), new Map([['index.html', null]]), 'daily');
  assert.deepEqual(upload, ['index.html']);
});

test('directory indexes are refreshed and copied for both URL forms', () => {
  assert.deepEqual(urlsFor('index.html'), ['https://www.amazingindex.com/']);
  assert.deepEqual(urlsFor('daily/2026-10-13/index.html'), ['https://www.amazingindex.com/daily/2026-10-13/', 'https://www.amazingindex.com/daily/2026-10-13']);
  assert.equal(bareKey('subjects/a/index.html'), 'subjects/a');
  assert.equal(bareKey('index.html'), null);
  assert.equal(uploadClass('sitemap.xml'), 'xml');
  assert.equal(uploadClass('_astro/x.js'), 'astro');
});

test('ossutil listings parse to keys and MD5 ETags, skipping folders and staging', () => {
  const listing = [
    'LastModifiedTime                   Size(B)  StorageClass   ETAG                                  ObjectName',
    '2026-10-14 10:00:00 +0800 CST            3      Standard   764EFA883DDA1E11DB47671C4A3BBD9E      oss://amazingindex/a.txt',
    '2026-10-14 10:00:00 +0800 CST            0      Standard   D41D8CD98F00B204E9800998ECF8427E      oss://amazingindex/dir/',
    '2026-10-14 10:00:00 +0800 CST        99999      Standard   "5D41402ABC4B2A76B9719D911017C592-3"  oss://amazingindex/big.bin',
    '',
    'Object Number is: 3',
  ].join('\n');
  assert.deepEqual([...parseOssutilLs(listing, 'amazingindex')], [['a.txt', '764efa883dda1e11db47671c4a3bbd9e'], ['big.bin', null]]);
});

async function tree(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), 'aha-deploy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), content);
  }
  return root;
}

test('a local inventory hashes like OSS', async (t) => {
  const root = await tree(t, { 'a/index.html': 'x' });
  assert.deepEqual([...await localInventory(root)], [['a/index.html', md5('x')]]);
});

test('a daily deploy refuses to go out without its built editions', async (t) => {
  const dist = await tree(t, { 'index.html': 'h', 'daily/2026-10-13/index.html': 'd' });
  const exportDir = await tree(t, { 'rss.xml': 'r' });
  await assert.rejects(planDeploy({ dist, exportDir, mode: 'daily', dates: ['2026-10-13', '2026-10-12'], remote: new Map() }), /2026-10-12/);
  const plan = await planDeploy({ dist, exportDir, mode: 'daily', dates: ['2026-10-13'], remote: new Map([['rss.xml', md5('r')]]) });
  assert.deepEqual(plan.upload, ['daily/2026-10-13/index.html', 'index.html']);
});

test('built pages and exported files may not overlap', async (t) => {
  const dist = await tree(t, { 'index.html': 'h', 'daily/2026-01/index.html': 'm' });
  const exportDir = await tree(t, { 'daily/2026-01/index.html': 'm' });
  await assert.rejects(planDeploy({ dist, exportDir, mode: 'full', dates: [], remote: new Map() }), /overlap/);
});

test('a feed deploy takes only /feed, the people pages and the assets they may need', () => {
  assert.deepEqual(selectPages([...DIST, 'feed/index.html', 'people/index.html', 'people/ada/index.html'], 'feed').sort(), ['_astro/a.css', 'feed/index.html', 'people/ada/index.html', 'people/index.html']);
});

test('a feed deploy uploads /feed and new assets only, and refreshes both /feed URLs', async (t) => {
  const dist = await tree(t, { 'index.html': 'h', 'feed/index.html': 'f2', '_astro/old.css': 'o', '_astro/new.css': 'n', 'about/index.html': 'a' });
  const exportDir = path.join(dist, 'no-export');
  await assert.rejects(planDeploy({ dist: await tree(t, { 'index.html': 'h' }), exportDir, mode: 'feed', dates: [], remote: new Map() }), /feed\/index\.html/);
  const remote = new Map([['feed/index.html', md5('f1')], ['feed', md5('f1')], ['_astro/old.css', md5('o')]]);
  const plan = await planDeploy({ dist, exportDir, mode: 'feed', dates: [], remote });
  assert.deepEqual(plan.upload.sort(), ['_astro/new.css', 'feed/index.html']);
  assert.deepEqual(plan.bare, [['feed/index.html', 'feed']]);
  assert.deepEqual(plan.urls, ['https://www.amazingindex.com/feed/', 'https://www.amazingindex.com/feed']);
  const unchanged = await planDeploy({ dist, exportDir, mode: 'feed', dates: [], remote: new Map([...remote, ['feed/index.html', md5('f2')], ['feed', md5('f2')], ['_astro/new.css', md5('n')]]) });
  assert.deepEqual([unchanged.upload, unchanged.urls], [[], []]);
});
