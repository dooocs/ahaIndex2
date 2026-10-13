import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { verifyDist, verifyExport } from '../scripts/lib/verify-site.mjs';

const SITE = 'https://www.amazingindex.com';
const DATE = '2026-10-07';
const OLD = '2026-10-06';
const urlset = (entries) => `<urlset>${entries.map(([url, lastmod]) => `<url><loc>${SITE}${url}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`).join('')}</urlset>`;
const SHELL = '<title>__SHELL_TITLE__</title><meta content="__SHELL_DESCRIPTION__"><link href="__SHELL_PATH__">';
const data = (extra = {}) => JSON.stringify({ v: 1, ...extra });

async function fixture(t, mode = 'daily') {
  const root = await mkdtemp(path.join(tmpdir(), 'aha-site-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dist = path.join(root, 'dist');
  const exportDir = path.join(root, 'export');
  const write = async (base, file, content) => {
    await mkdir(path.dirname(path.join(base, file)), { recursive: true });
    await writeFile(path.join(base, file), content);
  };
  const d = (file, content = '<h1>page</h1>') => write(dist, file, content);
  const e = (file, content) => write(exportDir, file, content);
  await d('index.html', '<div class="masthead-vol">VOL. 2026.10<br>2026.10.07</div><a class="article" href="/article/a">A</a>');
  await d('article/a/index.html');
  await d(`daily/${DATE}/index.html`);
  for (const page of ['about', 'contact', 'history', 'privacy', 'terms', 'daily', 'subjects']) await d(`${page}/index.html`);
  await d('shell/daily-month/index.html', SHELL);
  await d('shell/subject/index.html', SHELL);
  if (mode === 'full') await d('projects/example/index.html');

  await e('_deploy/manifest.json', data({ dates: [DATE, OLD], latest_date: DATE, mode, commit: null, generated_at: '' }));
  await e('rss.xml', `<rss><channel><lastBuildDate>Wed, 07 Oct 2026 00:00:00 GMT</lastBuildDate><item><link>${SITE}/article/a</link></item></channel></rss>`);
  for (const file of ['summary.json', 'archive/index.json', 'archive/2026-10.json', 'history.json', 'subjects/index.json', 'subjects/s.json']) await e(`data/${file}`, data());
  await e('daily/2026-10/index.html', '<title>October</title>');
  await e('subjects/s/index.html', '<title>S</title>');
  await e('sitemap.xml', `<sitemapindex><sitemap><loc>${SITE}/sitemap-pages.xml</loc></sitemap><sitemap><loc>${SITE}/sitemap-articles-2026.xml</loc></sitemap></sitemapindex>`);
  await e('sitemap-pages.xml', urlset([['/'], ['/about'], ['/daily'], ['/daily/2026-10'], [`/daily/${OLD}`, OLD], [`/daily/${DATE}`, DATE], ['/subjects/s']]));
  await e('sitemap-articles-2026.xml', urlset([['/article/a', DATE], ['/article/older', OLD]]));
  return { dist, exportDir, d, e };
}

test('accepts a daily build whose export matches the deployed editions', async (t) => {
  const { dist, exportDir } = await fixture(t);
  assert.deepEqual(await verifyDist(dist, { latestDate: DATE, mode: 'daily', dates: [DATE] }), { mode: 'daily', latestDate: DATE, articles: 1, projects: 0 });
  assert.deepEqual(await verifyExport(exportDir, dist, { latestDate: DATE }), { latestDate: DATE, deployed: 2, rssItems: 1, sitemapUrls: 9, builtArticles: 1 });
});

test('a full build must include project pages', async (t) => {
  const { dist } = await fixture(t);
  await assert.rejects(verifyDist(dist, { latestDate: DATE, mode: 'full' }), /project detail pages/);
});

test('rejects stale content even when homepage and RSS agree with each other', async (t) => {
  const { dist, exportDir } = await fixture(t);
  await assert.rejects(verifyDist(dist, { latestDate: '2026-10-08', mode: 'daily', dates: ['2026-10-08'] }), /latest database edition/);
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: '2026-10-08' }), /manifest omits the latest edition/);
});

test('rejects a homepage linking to an article that was not built', async (t) => {
  const { dist, d } = await fixture(t);
  await d('index.html', '<div class="masthead-vol">2026.10.07</div><a class="article" href="/article/a">A</a><a class="article" href="/article/missing">B</a>');
  await assert.rejects(verifyDist(dist, { latestDate: DATE, mode: 'daily', dates: [DATE] }), /not built: .*missing/);
});

test('rejects an RSS feed that differs from the homepage', async (t) => {
  const { dist, exportDir, e } = await fixture(t);
  await e('rss.xml', `<rss><channel><lastBuildDate>Wed, 07 Oct 2026 00:00:00 GMT</lastBuildDate><item><link>${SITE}/article/b</link></item></channel></rss>`);
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: DATE }), /Homepage and RSS article links differ/);
});

test('rejects sitemap URLs for editions or articles that are not deployed', async (t) => {
  const { dist, exportDir, e } = await fixture(t);
  await e('sitemap-pages.xml', urlset([['/'], [`/daily/${DATE}`, DATE], ['/daily/2026-10-05', '2026-10-05']]));
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: DATE }), /edition that is not deployed/);
  await e('sitemap-pages.xml', urlset([['/'], [`/daily/${DATE}`, DATE]]));
  await e('sitemap-articles-2026.xml', urlset([['/article/a', DATE], ['/article/ghost', '2026-10-01']]));
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: DATE }), /article that is not deployed/);
});

test('rejects built articles missing from the sitemap and unfilled shell copies', async (t) => {
  const { dist, exportDir, d, e } = await fixture(t);
  await d('article/new/index.html');
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: DATE }), /missing from the sitemap: new/);
  await rm(path.join(dist, 'article/new'), { recursive: true });
  await e('subjects/s/index.html', SHELL);
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: DATE }), /still contains __SHELL_TITLE__/);
});
