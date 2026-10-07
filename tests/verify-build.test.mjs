import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { verifyBuild } from '../scripts/lib/verify-build.mjs';

const SITE = 'https://www.amazingindex.com';
const DATE = '2026-10-07';
const sitemap = (urls) => `<urlset>${urls.map((url) => `<url><loc>${SITE}${url}</loc></url>`).join('')}</urlset>`;

async function fixture(t) {
  const dist = await mkdtemp(path.join(tmpdir(), 'aha-build-test-'));
  t.after(() => rm(dist, { recursive: true, force: true }));
  const write = async (file, content) => {
    await mkdir(path.dirname(path.join(dist, file)), { recursive: true });
    await writeFile(path.join(dist, file), content);
  };
  await write('index.html', '<div class="masthead-vol">VOL. 2026.10<br>2026.10.07</div><a class="article" href="/article/a">A</a>');
  await write('rss.xml', `<rss><channel><lastBuildDate>Wed, 07 Oct 2026 00:00:00 GMT</lastBuildDate><item><link>${SITE}/article/a</link></item></channel></rss>`);
  await write('sitemap.xml', `<sitemapindex><sitemap><loc>${SITE}/sitemap-pages.xml</loc></sitemap><sitemap><loc>${SITE}/sitemap-articles-2026.xml</loc></sitemap></sitemapindex>`);
  await write('sitemap-pages.xml', sitemap(['/', `/daily/${DATE}`]));
  await write('sitemap-articles-2026.xml', sitemap(['/article/a']));
  await write('article/a/index.html', '<h1>A</h1>');
  await write(`daily/${DATE}/index.html`, '<h1>Daily</h1>');
  await write('projects/example/index.html', '<h1>Project</h1>');
  return { dist, write };
}

test('accepts a complete build matching the latest database edition', async (t) => {
  const { dist } = await fixture(t);
  assert.deepEqual(await verifyBuild(dist, DATE), {
    latestDate: DATE, rssItems: 1, sitemapUrls: 3, articles: 1, projects: 1,
  });
});

test('rejects stale content even when homepage and RSS agree with each other', async (t) => {
  const { dist } = await fixture(t);
  await assert.rejects(verifyBuild(dist, '2026-10-08'), /latest database edition/);
});

test('rejects mismatched homepage and RSS article identities', async (t) => {
  const { dist, write } = await fixture(t);
  await write('index.html', '<a class="article" href="/article/b">B</a>');
  await assert.rejects(verifyBuild(dist, DATE), /article links differ/);
});

test('rejects a sitemap URL whose page was not generated', async (t) => {
  const { dist } = await fixture(t);
  await rm(path.join(dist, 'article/a/index.html'));
  await assert.rejects(verifyBuild(dist, DATE), /no built page/);
});

test('rejects built articles missing from the sitemap', async (t) => {
  const { dist, write } = await fixture(t);
  await write('article/b/index.html', '<h1>B</h1>');
  await assert.rejects(verifyBuild(dist, DATE), /Article sitemap and built article pages differ/);
});

test('rejects malformed XML', async (t) => {
  const { dist, write } = await fixture(t);
  await write('sitemap-pages.xml', '<urlset><url></urlset>');
  await assert.rejects(verifyBuild(dist, DATE));
});

test('rejects a build with missing project detail pages', async (t) => {
  const { dist } = await fixture(t);
  await rm(path.join(dist, 'projects'), { recursive: true });
  await assert.rejects(verifyBuild(dist, DATE), /No project detail pages/);
});
