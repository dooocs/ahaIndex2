import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_DAILY_EDITIONS,
  archiveIndexJson,
  archiveMonthJson,
  fillShell,
  missingEditions,
  monthShellMeta,
  parseDataFile,
  planDaily,
  subjectShellMeta,
  summaryJson,
} from '../src/lib/site-export.ts';
import { editionRecord, monthlyArchive } from '../src/lib/edition-ledger.ts';
import { parseUrlset, renderUrlset } from '../src/lib/sitemap.ts';

test('a daily plan is the newest edition and the one before it', () => {
  assert.deepEqual(planDaily('2026-10-13', '2026-10-12'), { mode: 'daily', dates: ['2026-10-13', '2026-10-12'], reason: 'newest two' });
  assert.deepEqual(planDaily('2026-10-13', null).dates, ['2026-10-13']);
});

test('backfill dates are added, deduplicated and sorted newest first', () => {
  const plan = planDaily('2026-10-13', '2026-10-12', ['2026-10-09', '2026-10-12', '2026-10-10']);
  assert.deepEqual(plan.dates, ['2026-10-13', '2026-10-12', '2026-10-10', '2026-10-09']);
  assert.equal(plan.reason, 'newest two + 2 backfilled');
});

test('a daily plan never becomes a full build: too many dates is an error', () => {
  const many = Array.from({ length: MAX_DAILY_EDITIONS }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
  assert.throws(() => planDaily('2026-10-13', '2026-10-12', many), /at most 16 editions.*full build/);
  assert.throws(() => planDaily('2026-10-13', '2026-10-12', ['13/10/2026']), /Invalid backfill/);
  assert.throws(() => planDaily(null, null), /no editions/);
});

test('missing editions are database dates whose page is not on the bucket', () => {
  const keys = new Set(['daily/2026-10-13/index.html', 'daily/2026-10-11/index.html']);
  assert.deepEqual(missingEditions(['2026-10-11', '2026-10-13', '2026-10-12', '2026-10-10'], keys), ['2026-10-12', '2026-10-10']);
});

const row = (date, rank, aha) => ({
  snapshot_date: date, processed_item_id: `p${date}${rank}`, rank, aha_index: aha,
  processed_title: `${date}-${rank}`, title: null, source_name: 'S', tags: ['a', 'b', 'c'], original_url: `https://x/${rank}`, url: null,
});

test('summary statistics come from the published editions, newest first', () => {
  const summary = summaryJson([{ date: '2026-01-01', score: 90, count: 1 }, { date: '2026-01-02', score: 70, count: 2 }]);
  assert.equal(summary.latest_date, '2026-01-02');
  assert.deepEqual(summary.editions.map((e) => e.date), ['2026-01-02', '2026-01-01']);
  assert.deepEqual(summary.stats, { total_editions: 2, total_items: 3, avg_aha_score: 80, peak_aha_score: 90 });
});

test('a month file carries its ledger and the views derived from it', () => {
  const records = [editionRecord('2026-01-01', [row('2026-01-01', 1, 0.9)]), editionRecord('2026-01-02', [row('2026-01-02', 1, 0.5), row('2026-01-02', 2, 0.7)])];
  const month = archiveMonthJson('2026-01', records);
  assert.deepEqual(month.records.map((r) => r.date), ['2026-01-02', '2026-01-01']);
  assert.equal(month.summary.top_story_title, '2026-01-01-1');
  assert.deepEqual(month.days.map((d) => d.aha_delta), ['-30.0', '']);
  assert.deepEqual(month.top_items['2026-01-02'].map((i) => i.title), ['2026-01-02-1', '2026-01-02-2']);
  const index = archiveIndexJson([monthlyArchive('2025-12', []), month.summary], summaryJson(records));
  assert.deepEqual(index.years.map((y) => y.year), [2026, 2025]);
});

test('published data files must carry the current data version', () => {
  assert.equal(parseDataFile(null, 'x'), null);
  assert.deepEqual(parseDataFile('{"v":1,"a":2}', 'x'), { v: 1, a: 2 });
  assert.throws(() => parseDataFile('{"v":2}', 'summary.json'), /summary.json has data version 2/);
});

test('a published urlset parses back to the entries it was rendered from', () => {
  const entries = [{ url: 'https://www.amazingindex.com/article/a&b', lastmod: '2026-01-02' }, { url: 'https://www.amazingindex.com/about' }];
  assert.deepEqual(parseUrlset(renderUrlset(entries)), entries);
});

test('fillShell escapes per-URL values and requires every token', () => {
  const shell = '<title>__SHELL_TITLE__</title><meta content="__SHELL_DESCRIPTION__"><link href="https://x__SHELL_PATH__">';
  const html = fillShell(shell, { path: '/subjects/a', title: 'A & "B"', description: '<script>' });
  assert.equal(html, '<title>A &amp; &quot;B&quot;</title><meta content="&lt;script&gt;"><link href="https://x/subjects/a">');
  assert.throws(() => fillShell('<title>__SHELL_TITLE__</title>', { path: '/', title: '', description: '' }), /__SHELL_DESCRIPTION__/);
});

test('shell metadata matches the former page titles', () => {
  assert.deepEqual(monthShellMeta('2026-01'), {
    path: '/daily/2026-01',
    title: '历史归档 - 2026年一月 | AmazingIndex',
    description: '在 AmazingIndex 探索 2026年一月 的 AI 行业动态与突破。',
  });
  assert.equal(subjectShellMeta({ slug: 'x', display_name: 'X', definition: null, description: null }).description, 'X 的关键事件、突出点和横向对比。');
});
