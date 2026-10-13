import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getArticleSitemapEntriesForYear,
  getArticleSitemapYears,
  getPagesSitemapEntries,
  getSitemapIndexEntries,
  renderRss,
  uniqueArticleItems,
} from '../src/lib/sitemap.ts';
import { fetchAllRows } from '../src/lib/queries.ts';

test('pages sitemap lists static pages, months, editions and subjects in order', () => {
  const urls = getPagesSitemapEntries(['2026-01-02', '2025-12-31'], [{ slug: 's', last_seen_at: '2026-01-02T10:00:00Z', first_seen_at: null }]).map((e) => e.url.replace('https://www.amazingindex.com', ''));
  assert.deepEqual(urls, ['', '/about', '/contact', '/history', '/privacy', '/terms', '/daily', '/subjects', '/daily/2025-12', '/daily/2026-01', '/daily/2025-12-31', '/daily/2026-01-02', '/subjects/s']);
});

test('an article is dated by the newest edition it appears in', () => {
  const unique = uniqueArticleItems([
    { id: '1', processed_item_id: 'a', snapshot_date: '2026-01-02' },
    { id: '2', processed_item_id: 'a', snapshot_date: '2025-12-31' },
    { id: '3', processed_item_id: 'b', snapshot_date: '2025-12-31' },
  ]);
  assert.deepEqual(unique.map((i) => [i.processed_item_id, i.snapshot_date]), [['a', '2026-01-02'], ['b', '2025-12-31']]);
  assert.deepEqual(getArticleSitemapYears(unique), ['2025', '2026']);
  assert.deepEqual(getArticleSitemapEntriesForYear(unique, '2025').map((e) => e.url), ['https://www.amazingindex.com/article/b']);
  assert.equal(getSitemapIndexEntries(['2026-01-02', '2025-12-31'], ['2025', '2026'])[1].lastmod, '2025-12-31');
});

test('RSS escapes titles and summaries', () => {
  const xml = renderRss([{ processed_item_id: 'a', processed_title: 'A & <B>', summary: '"q"', snapshot_date: '2026-01-02' }], '2026-01-02');
  assert.match(xml, /<title>A &amp; &lt;B&gt;<\/title>/);
  assert.match(xml, /<description>&quot;q&quot;<\/description>/);
  assert.match(xml, /<lastBuildDate>Fri, 02 Jan 2026 00:00:00 GMT<\/lastBuildDate>/);
});

test('fetchAllRows reads past the hosted 1000-row cap', async () => {
  const total = 2500;
  const calls = [];
  const rows = await fetchAllRows(async (from, to) => {
    calls.push([from, to]);
    const end = Math.min(to + 1, total);
    return { data: from >= total ? [] : Array.from({ length: end - from }, (_, i) => from + i), error: null };
  });
  assert.equal(rows.length, total);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});
