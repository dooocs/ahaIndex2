import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_DAILY_BACKFILL,
  fillShell,
  mergeDeployedDates,
  monthShellMeta,
  parseManifest,
  planBuild,
  subjectShellMeta,
} from '../src/lib/site-export.ts';
import {
  computeDailyArchives,
  computeGlobalStats,
  computeMonthlyArchives,
  indexScoreRows,
} from '../src/lib/archive.ts';

const manifest = (dates) => ({ v: 1, dates, latest_date: dates[0] ?? null, mode: 'full', commit: null, generated_at: '' });

test('a full request always plans a full build', () => {
  assert.deepEqual(planBuild('full', ['2026-10-13'], manifest(['2026-10-13'])).mode, 'full');
});

test('daily without a manifest falls back to a full build', () => {
  const plan = planBuild('daily', ['2026-10-13', '2026-10-12'], null);
  assert.equal(plan.mode, 'full');
  assert.match(plan.reason, /manifest/);
});

test('daily builds the newest two editions', () => {
  const plan = planBuild('daily', ['2026-10-11', '2026-10-13', '2026-10-12'], manifest(['2026-10-12', '2026-10-11']));
  assert.deepEqual(plan, { mode: 'daily', dates: ['2026-10-13', '2026-10-12'], reason: '1 new edition(s)' });
});

test('daily backfills missing editions and the edition before each of them', () => {
  // 10-09 was never deployed: 10-08 must be rebuilt for its 下一期 link.
  const plan = planBuild('daily', ['2026-10-13', '2026-10-12', '2026-10-09', '2026-10-08', '2026-10-07'], manifest(['2026-10-12', '2026-10-08', '2026-10-07']));
  assert.deepEqual(plan.dates, ['2026-10-13', '2026-10-12', '2026-10-09', '2026-10-08']);
});

test('daily after a failed deploy also rebuilds the last deployed edition', () => {
  const plan = planBuild('daily', ['2026-10-13', '2026-10-12', '2026-10-11'], manifest(['2026-10-11']));
  assert.deepEqual(plan.dates, ['2026-10-13', '2026-10-12', '2026-10-11']);
});

test('a daily run with nothing new still rebuilds the newest two editions', () => {
  const plan = planBuild('daily', ['2026-10-13', '2026-10-12', '2026-10-11'], manifest(['2026-10-13', '2026-10-12', '2026-10-11']));
  assert.deepEqual(plan, { mode: 'daily', dates: ['2026-10-13', '2026-10-12'], reason: '0 new edition(s)' });
});

test('too many missing editions turn a daily build into a full one', () => {
  const dates = Array.from({ length: MAX_DAILY_BACKFILL + 2 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  assert.equal(planBuild('daily', dates, manifest([dates[0]])).mode, 'full');
});

test('deployed dates are previous plus built, limited to the database, newest first', () => {
  assert.deepEqual(
    mergeDeployedDates(['2026-10-10', '2026-09-01'], ['2026-10-12', '2026-10-10'], ['2026-10-12', '2026-10-10', '2026-10-01']),
    ['2026-10-12', '2026-10-10'],
  );
});

test('parseManifest accepts nothing yet and rejects a malformed manifest', () => {
  assert.equal(parseManifest(null), null);
  assert.deepEqual(parseManifest(JSON.stringify(manifest(['2026-10-13']))).dates, ['2026-10-13']);
  assert.throws(() => parseManifest(JSON.stringify({ v: 1, dates: ['13/10/2026'] })), /unexpected shape/);
  assert.throws(() => parseManifest(JSON.stringify({ v: 2, dates: [] })), /unexpected shape/);
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

const row = (date, rank, aha, title = `${date}-${rank}`) => ({
  snapshot_date: date, processed_item_id: `p${date}${rank}`, rank, aha_index: aha,
  processed_title: title, title: null, source_name: 'S', tags: ['a', 'b', 'c', 'd'], original_url: null, url: null,
});

test('archive statistics use the mean score of each edition', () => {
  const index = indexScoreRows([row('2026-01-02', 1, 0.8), row('2026-01-02', 2, 0.6), row('2026-01-01', 1, 0.9)]);
  assert.deepEqual([...index.keys()], ['2026-01-02', '2026-01-01']);
  const stats = computeGlobalStats(index);
  assert.equal(stats.total_editions, 2);
  assert.equal(stats.total_items, 3);
  assert.ok(Math.abs(stats.avg_aha_score - 80) < 1e-9);
  assert.ok(Math.abs(stats.peak_aha_score - 90) < 1e-9);
});

test('daily archives carry the top story and the day-over-day delta', () => {
  const index = indexScoreRows([row('2026-01-02', 1, 0.5), row('2026-01-02', 2, 0.7, 'top'), row('2026-01-01', 1, 0.9)]);
  const [jan2, jan1] = computeDailyArchives(index, 2026, 1);
  assert.equal(jan2.top_story_title, 'top');
  assert.deepEqual(jan2.top_tags, ['a', 'b', 'c']);
  assert.equal(jan2.aha_delta, '-30.0');
  assert.equal(jan1.aha_delta, '');
  const [month] = computeMonthlyArchives(index, 2026);
  assert.equal(month.month, '2026-01-01');
  assert.equal(month.top_story_title, '2026-01-01-1');
  assert.equal(month.edition_count, 2);
});
