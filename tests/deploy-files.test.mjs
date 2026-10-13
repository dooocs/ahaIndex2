import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { bareKey, planDeploy, selectPages, uploadClass, urlsFor } from '../scripts/lib/deploy-files.mjs';

const DIST = [
  '_astro/a.css', 'index.html', '404.html', 'robots.txt', 'about/index.html',
  'daily/index.html', 'daily/2026-10-12/index.html', 'daily/2026-10-13/index.html', 'daily/2026-09-01/index.html',
  'article/p1/index.html', 'projects/index.html', 'projects/x/index.html', 'shell/subject/index.html',
];

test('a full deploy uploads every built page except assets and shell templates', () => {
  const pages = selectPages(DIST, 'full');
  assert.ok(pages.includes('projects/x/index.html'));
  assert.ok(pages.includes('robots.txt'));
  assert.ok(!pages.some((p) => p.startsWith('_astro/') || p.startsWith('shell/')));
});

test('a daily deploy uploads the homepage, its editions and their articles only', () => {
  assert.deepEqual(selectPages(DIST, 'daily', ['2026-10-13', '2026-10-12']).sort(), [
    'article/p1/index.html', 'daily/2026-10-12/index.html', 'daily/2026-10-13/index.html', 'index.html',
  ]);
});

test('directory indexes are refreshed and copied for both URL forms', () => {
  assert.deepEqual(urlsFor('index.html'), ['https://www.amazingindex.com/']);
  assert.deepEqual(urlsFor('daily/2026-10-13/index.html'), ['https://www.amazingindex.com/daily/2026-10-13/', 'https://www.amazingindex.com/daily/2026-10-13']);
  assert.deepEqual(urlsFor('data/summary.json'), ['https://www.amazingindex.com/data/summary.json']);
  assert.equal(bareKey('subjects/a/index.html'), 'subjects/a');
  assert.equal(bareKey('index.html'), null);
  assert.equal(uploadClass('sitemap.xml'), 'xml');
});

async function tree(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), 'aha-deploy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const rel of files) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), rel);
  }
  return root;
}

test('a daily deploy refuses to go out without its built editions', async (t) => {
  const dist = await tree(t, ['index.html', 'daily/2026-10-13/index.html']);
  const exportDir = await tree(t, ['rss.xml', '_deploy/manifest.json']);
  await assert.rejects(planDeploy({ dist, exportDir, mode: 'daily', dates: ['2026-10-13', '2026-10-12'] }), /2026-10-12/);
  const plan = await planDeploy({ dist, exportDir, mode: 'daily', dates: ['2026-10-13'] });
  assert.deepEqual(plan.exported, ['rss.xml']);
});

test('built pages and exported files may not overlap', async (t) => {
  const dist = await tree(t, ['index.html', 'daily/2026-01/index.html']);
  const exportDir = await tree(t, ['daily/2026-01/index.html']);
  await assert.rejects(planDeploy({ dist, exportDir, mode: 'full', dates: [] }), /overlap/);
});
