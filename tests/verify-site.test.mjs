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
const month = (dates) => data({ month: '2026-10', records: dates.map((date) => ({ date })) });

// A daily run: the bucket holds yesterday's edition and an older article; this run built today's.
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
  for (const page of ['about', 'contact', 'history', 'privacy', 'terms', 'subjects']) await d(`${page}/index.html`);
  await d('shell/daily-year/index.html', SHELL);
  await d('shell/daily-month/index.html', SHELL);
  await d('shell/subject/index.html', SHELL);
  if (mode === 'full') await d('projects/example/index.html');

  await e('data/summary.json', data({ latest_date: DATE, editions: [{ date: DATE }, { date: OLD }] }));
  await e('data/archive/index.json', data({ years: [{ year: 2026, months: [{ month: '2026-10-01' }] }] }));
  await e('data/archive/2026-10.json', month([DATE, OLD]));
  await e('rss.xml', `<rss><channel><lastBuildDate>Wed, 07 Oct 2026 00:00:00 GMT</lastBuildDate><item><link>${SITE}/article/a</link></item></channel></rss>`);
  for (const file of ['history.json', 'subjects/s.json']) await e(`data/${file}`, data());
  await e('data/subjects/index.json', data({ sections: [{ subjects: [{ slug: 's' }] }] }));
  await e('daily/index.html', '<title>Archive</title><a href="/daily/2026-10">十月</a>');
  await e('daily/2026-10/index.html', `<title>October</title><a href="/daily/${DATE}">10.07</a><a href="/daily/${OLD}">10.06</a>`);
  await e('subjects/s/index.html', '<title>S</title>');
  await e('sitemap.xml', `<sitemapindex><sitemap><loc>${SITE}/sitemap-pages.xml</loc></sitemap><sitemap><loc>${SITE}/sitemap-articles-2026.xml</loc></sitemap><sitemap><loc>${SITE}/sitemap-articles-2025.xml</loc></sitemap></sitemapindex>`);
  await e('sitemap-pages.xml', urlset([['/'], ['/about'], ['/daily'], ['/daily/2026-10'], [`/daily/${OLD}`, OLD], [`/daily/${DATE}`, DATE], ['/subjects/s']]));
  await e('sitemap-articles-2026.xml', urlset([['/article/a', DATE], ['/article/older', OLD]]));
  const inventory = new Map([[`daily/${OLD}/index.html`, 'x'], ['article/older/index.html', 'x'], ['sitemap-articles-2025.xml', 'x']]);
  return { dist, exportDir, d, e, inventory };
}

test('accepts a daily build whose export only references deployed pages', async (t) => {
  const { dist, exportDir, inventory } = await fixture(t);
  assert.deepEqual(await verifyDist(dist, { latestDate: DATE, mode: 'daily', dates: [DATE] }), { mode: 'daily', latestDate: DATE, articles: 1, projects: 0 });
  assert.deepEqual(await verifyExport(exportDir, dist, { latestDate: DATE, inventory }), { latestDate: DATE, published: 2, rssItems: 1, sitemapUrls: 9, builtArticles: 1 });
});

test('rejects archive pages exported without their content or links', async (t) => {
  const { dist, exportDir, e, inventory } = await fixture(t);
  await e('daily/index.html', '<title>Archive</title><a href="/daily/2026-10">十月</a><p class="loading-state" data-loading>正在加载归档…</p>');
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: DATE, inventory }), /daily\/index.html was exported without its content/);
  await e('daily/index.html', '<title>Archive</title>');
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: DATE, inventory }), /\/daily does not link 2026-10/);
  await e('daily/index.html', '<title>Archive</title><a href="/daily/2026-10">十月</a>');
  await e('daily/2026-10/index.html', `<title>October</title><a href="/daily/${DATE}">10.07</a>`);
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: DATE, inventory }), /does not link the edition 2026-10-06/);
});

test('a full build must include project pages', async (t) => {
  const { dist } = await fixture(t);
  await assert.rejects(verifyDist(dist, { latestDate: DATE, mode: 'full' }), /project detail pages/);
});

test('rejects stale content even when homepage and RSS agree with each other', async (t) => {
  const { dist, exportDir, inventory } = await fixture(t);
  await assert.rejects(verifyDist(dist, { latestDate: '2026-10-08', mode: 'daily', dates: ['2026-10-08'] }), /latest database edition/);
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: '2026-10-08', inventory }), /summary.json is not using the latest/);
});

test('rejects a homepage linking to an article that was not built', async (t) => {
  const { dist, d } = await fixture(t);
  await d('index.html', '<div class="masthead-vol">2026.10.07</div><a class="article" href="/article/a">A</a><a class="article" href="/article/missing">B</a>');
  await assert.rejects(verifyDist(dist, { latestDate: DATE, mode: 'daily', dates: [DATE] }), /not built: .*missing/);
});

test('rejects an RSS feed that differs from the homepage', async (t) => {
  const { dist, exportDir, e, inventory } = await fixture(t);
  await e('rss.xml', `<rss><channel><lastBuildDate>Wed, 07 Oct 2026 00:00:00 GMT</lastBuildDate><item><link>${SITE}/article/b</link></item></channel></rss>`);
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: DATE, inventory }), /Homepage and RSS article links differ/);
});

test('rejects data and sitemaps that reference pages which are not deployed', async (t) => {
  const { dist, exportDir, inventory } = await fixture(t);
  inventory.delete(`daily/${OLD}/index.html`);
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: DATE, inventory }), /summary.json lists an edition that is not deployed: 2026-10-06/);

  const second = await fixture(t);
  second.inventory.delete('article/older/index.html');
  await assert.rejects(verifyExport(second.exportDir, second.dist, { latestDate: DATE, inventory: second.inventory }), /Sitemap lists a page that is not deployed: .*older/);

  const third = await fixture(t);
  third.inventory.delete('sitemap-articles-2025.xml');
  await assert.rejects(verifyExport(third.exportDir, third.dist, { latestDate: DATE, inventory: third.inventory }), /Sitemap index lists a file that is not deployed/);
});

test('rejects a month ledger listing an edition that is not published', async (t) => {
  const { dist, exportDir, e, inventory } = await fixture(t);
  await e('data/archive/2026-10.json', month([DATE, OLD, '2026-10-01']));
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: DATE, inventory }), /lists an edition that is not published: 2026-10-01/);
});

test('rejects built articles missing from the sitemap and unfilled shell copies', async (t) => {
  const { dist, exportDir, d, e, inventory } = await fixture(t);
  await d('article/new/index.html');
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: DATE, inventory }), /missing from the sitemap: new/);
  await rm(path.join(dist, 'article/new'), { recursive: true });
  await e('subjects/s/index.html', SHELL);
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: DATE, inventory }), /still contains __SHELL_TITLE__/);
});

test('rejects 上一期 links to editions that are neither deployed nor built', async (t) => {
  const { dist, d, inventory } = await fixture(t);
  await d(`daily/${DATE}/index.html`, `<a href="/daily/${OLD}" rel="prev">← 上一期</a>`);
  await verifyDist(dist, { latestDate: DATE, mode: 'daily', dates: [DATE], inventory });
  inventory.delete(`daily/${OLD}/index.html`);
  await assert.rejects(verifyDist(dist, { latestDate: DATE, mode: 'daily', dates: [DATE], inventory }), /links 上一期 to a page that is not deployed: \/daily\/2026-10-06/);
});

test('rejects an export that drops previously published editions or articles', async (t) => {
  const { dist, exportDir, inventory } = await fixture(t);
  const previousDir = path.join(path.dirname(exportDir), 'previous');
  await mkdir(path.join(previousDir, 'data'), { recursive: true });
  await writeFile(path.join(previousDir, 'data/summary.json'), data({ editions: [{ date: OLD }] }));
  await writeFile(path.join(previousDir, 'sitemap-articles-2026.xml'), urlset([['/article/older', OLD]]));
  await verifyExport(exportDir, dist, { latestDate: DATE, inventory, previousDir });

  await writeFile(path.join(previousDir, 'data/summary.json'), data({ editions: [{ date: '2026-10-01' }] }));
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: DATE, inventory, previousDir }), /Previously published edition 2026-10-01 is missing/);
  await writeFile(path.join(previousDir, 'data/summary.json'), data({ editions: [] }));
  await writeFile(path.join(previousDir, 'sitemap-articles-2026.xml'), urlset([['/article/gone', OLD]]));
  await assert.rejects(verifyExport(exportDir, dist, { latestDate: DATE, inventory, previousDir }), /Previously published article .*gone is missing/);
});
