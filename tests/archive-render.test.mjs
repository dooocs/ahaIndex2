import assert from 'node:assert/strict';
import test from 'node:test';
import { fillSlots } from '../src/lib/site-export.ts';
import {
  esc,
  renderGlobalStats,
  renderMonthGrid,
  renderMonthIndex,
  renderMonthNav,
  renderMonthWeeks,
  renderYearRail,
  weekdayOf,
} from '../src/lib/archive-render.ts';

const SHELL = [
  '<div class="month-grid" data-month-grid data-ssr-slot="month-grid">',
  '<p class="loading-state" data-loading>正在加载归档…</p>',
  '</div>',
  '<h1 data-month-title data-ssr-slot="month-title">&nbsp;</h1>',
  '<div data-distribution data-ssr-slot="distribution"></div>',
].join('');

test('fillSlots replaces each slot content and keeps the element', () => {
  const html = fillSlots(SHELL, {
    'month-grid': '<div class="month-cell"><div>nested</div></div>',
    'month-title': '2026年十月',
    distribution: '$& $1 stays literal',
  });
  assert.equal(html, [
    '<div class="month-grid" data-month-grid data-ssr-slot="month-grid">',
    '<div class="month-cell"><div>nested</div></div>',
    '</div>',
    '<h1 data-month-title data-ssr-slot="month-title">2026年十月</h1>',
    '<div data-distribution data-ssr-slot="distribution">$& $1 stays literal</div>',
  ].join(''));
  assert.ok(!html.includes('data-loading'));
});

test('fillSlots requires every slot exactly once', () => {
  assert.throws(() => fillSlots(SHELL, { weeks: 'x' }), /0 slot\(s\) named weeks/);
  assert.throws(() => fillSlots(SHELL + SHELL, { 'month-title': 'x' }), /2 slot\(s\) named month-title/);
  assert.throws(() => fillSlots(SHELL, { 'bad"name': 'x' }), /Invalid slot name/);
});

const month = (m, extra = {}) => ({ month: `${m}-01`, edition_count: 3, item_count: 40, avg_aha_score: 81.25, top_story_title: 'Top <b>', ...extra });

test('the year grid links only months with editions and marks the current one', () => {
  const html = renderMonthGrid(2026, [month('2026-10'), month('2026-08')], { year: 2026, month: 10 });
  assert.match(html, /<a href="\/daily\/2026-10" class="month-cell current">/);
  assert.match(html, /<a href="\/daily\/2026-08" class="month-cell ">/);
  // September has no editions, November is in the future: neither is a link.
  assert.ok(!html.includes('/daily/2026-09'));
  assert.ok(!html.includes('/daily/2026-11'));
  assert.equal((html.match(/class="month-cell future/g) || []).length, 2);
  assert.ok(html.includes('Top &lt;b&gt;'));
});

test('the month index links every month, newest first, across years', () => {
  const html = renderMonthIndex([month('2025-08'), month('2026-10'), month('2026-03')]);
  assert.deepEqual([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ['/daily/2026-10', '/daily/2026-03', '/daily/2025-08']);
  assert.ok(html.includes('2025年八月'));
});

test('the year rail marks the shown year and links the others', () => {
  assert.equal(
    renderYearRail([2026, 2025], 2026),
    '<span class="archive-year-rail-year" data-current-year="2026">2026</span> <a class="archive-year-rail-year" style="opacity: 0.35; text-decoration: none; color: inherit;" href="/daily?year=2025">2025</a>',
  );
});

test('a month page links each edition and its neighbouring months', () => {
  const html = renderMonthWeeks({
    month: '2026-10',
    summary: { item_count: 5 },
    weeks: [{ week_number: 42, start_date: '2026-10-12', end_date: '2026-10-18', avg_aha_score: 80 }],
    days: [
      { snapshot_date: '2026-10-16', aha_score: 82, aha_delta: '+1.0', item_count: 3, top_story_title: 'A' },
      { snapshot_date: '2026-10-15', aha_score: 81, aha_delta: '-0.5', item_count: 2, top_story_title: 'B' },
    ],
    top_items: { '2026-10-16': [{ title: 'X', tags: ['t'], source_name: 'HN', url: 'javascript:alert(1)' }] },
  });
  assert.ok(html.includes('href="/daily/2026-10-16" class="dh-date-link"'));
  assert.ok(html.includes('href="/daily/2026-10-15" class="ir-more"'));
  assert.ok(!html.includes('javascript:'), 'unsafe item links are dropped');
  assert.ok(html.includes('周五') && html.includes('周四'));

  const nav = renderMonthNav('2026-09', ['2026-10', '2026-08', '2026-09', '2026-10']);
  assert.ok(nav.includes('href="/daily/2026-08" rel="prev"'));
  assert.ok(nav.includes('href="/daily/2026-10" rel="next"'));
  assert.equal((renderMonthNav('2026-10', ['2026-10', '2026-09']).match(/href=/g) || []).length, 1);
});

test('helpers give the same output in any time zone or locale', () => {
  assert.equal(weekdayOf('2026-10-16'), '周五');
  assert.equal(weekdayOf('2025-08-21'), '周四');
  assert.ok(renderGlobalStats({ total_editions: 180, total_items: 12345, avg_aha_score: 80.04, peak_aha_score: 95 }).includes('12,345'));
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});
