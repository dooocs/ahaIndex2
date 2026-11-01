import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildLifeGrid, duration, endOf, isLifeGrid, lifeGridProblems, splitPeopleSnapshots } from '../src/lib/life-grid.ts';
import { featuredCards } from '../src/lib/people-home.ts';
import { rowsFromSnapshots } from '../src/lib/people-snapshots.ts';
import { peopleFromRows } from '../src/lib/people.ts';

// Real person_public() output for Lei Jun after sql/people/aliyun/008, and two
// classic people (no 主线 / 状态).
const leiJun = JSON.parse(readFileSync(new URL('./fixtures/people-lei-jun.json', import.meta.url), 'utf8'));
const classic = JSON.parse(readFileSync(new URL('./fixtures/people-snapshots.json', import.meta.url), 'utf8'));
const grid = buildLifeGrid(leiJun, '2026-11-01');
const event = (title) => grid.events.find((e) => e.title === title);

test('people with 主线 or 状态 get the life grid; everyone else stays on the classic page', () => {
  assert.equal(isLifeGrid(leiJun.payload), true);
  for (const s of classic) assert.equal(isLifeGrid(s.payload), false);
  const warnings = [];
  const { grids, legacy } = splitPeopleSnapshots([leiJun, ...classic], (m) => warnings.push(m));
  assert.deepEqual(grids.map((s) => s.slug), ['lei-jun']);
  assert.deepEqual(legacy.map((s) => s.slug), classic.map((s) => s.slug));
  assert.deepEqual(warnings, []);
  // Without the split, the classic validation drops Lei Jun (高光 events, 争议 without sides).
  const dropped = [];
  peopleFromRows(...Object.values(rowsFromSnapshots([leiJun])), (m) => dropped.push(m));
  assert.equal(dropped.length, 1);
});

test('an incomplete grid falls back to the classic page with a warning', () => {
  const broken = structuredClone(leiJun);
  broken.payload.events = [];
  assert.deepEqual(lifeGridProblems(broken), ['还没有已发布的事件']);
  const warnings = [];
  const { grids, legacy } = splitPeopleSnapshots([broken], (m) => warnings.push(m));
  assert.equal(grids.length, 0);
  assert.equal(legacy.length, 1);
  assert.match(warnings[0], /lei-jun.*还没有已发布的事件/);
});

test('rows: every event year stands alone, quiet years fold between boundaries', () => {
  assert.equal(grid.rows[0].label, '1969');
  assert.equal(grid.rows[0].age, '0');
  assert.equal(grid.rows.at(-1).label, '2026');
  const quiet = grid.rows.find((r) => r.label === '1970–86');
  assert.ok(quiet?.fold, 'childhood folds into one row up to the 1987 state boundary');
  assert.equal(quiet.age, '0–16');
  // Ages follow the year (born in December: 17 for most of 1987).
  assert.equal(grid.rows.find((r) => r.label === '1987').age, '17');
  // Every year is covered exactly once.
  let y = 1969;
  for (const r of grid.rows) { assert.equal(r.from, y); y = r.to + 1; }
  assert.equal(y, 2027);
  // Every event sits in its year's row.
  for (const e of grid.events) {
    const r = grid.rows[e.row];
    assert.ok(e.year >= r.from && e.year <= r.to && !r.fold && r.events.includes(e.id), e.title);
  }
});

test('arcs span their years and count from the start', () => {
  const kingsoft = grid.arcs.find((a) => a.label === '金山');
  assert.equal(kingsoft.duration, '16年');
  assert.equal(kingsoft.span, '1992 — 2007.12');
  assert.equal(grid.rows[kingsoft.rowFrom].from, 1992);
  assert.equal(grid.rows[kingsoft.rowTo].to, 2007);
  const xiaomi = grid.arcs.find((a) => a.label === '小米');
  assert.equal(xiaomi.duration, '16年+');
  assert.equal(xiaomi.end, null);
  assert.equal(grid.rows[xiaomi.rowTo].to, 2026);
  assert.equal(grid.arcs.find((a) => a.label === '三色').duration, '6个月');
  assert.equal(grid.lanes, 3);
  assert.ok(kingsoft.events.includes(event('出任金山CEO').id));
});

test('an event shows the moment: age, states, what he was keeping at', () => {
  const founding = event('一碗小米粥，小米成立');
  assert.equal(founding.dateText, '2010年4月6日');
  assert.equal(founding.shortDate, '4.6');
  assert.equal(founding.age, '40岁');
  assert.deepEqual(founding.moment.map((m) => [m.label, m.value, m.estimate]), [
    ['身份', '小米创始人 · CEO', false],
    ['财富', '创业重投入', true],
    ['家庭', '成家', false],
  ]);
  assert.deepEqual(founding.arcs.map((a) => `${a.label} 第${a.year}年`), ['小米 第1年', '天使投资 第5年']);
  const exam = event('考入武汉大学计算机系');
  assert.equal(exam.age, '约17岁');
  assert.equal(exam.shortDate, '全年');
  assert.equal(event('出生于湖北仙桃').age, '0岁');
});

test('sources split into 当时 and 后来 by publication date, phase overrides', () => {
  const su7 = event('SU7上市');
  assert.deepEqual(su7.then.map((s) => s.date), ['2024.03.29', '2024.03.29']);
  assert.deepEqual(su7.later.map((s) => s.outlet), ['界面新闻']);
  // A source without a date is never 当时.
  const exam = event('两年修完四年学分');
  assert.equal(exam.then.length, 0);

  const forced = structuredClone(leiJun);
  const e = forced.payload.events.find((x) => x.title === 'SU7上市');
  e.sources[0].phase = 'later';
  const after = buildLifeGrid(forced, '2026-11-01').events.find((x) => x.title === 'SU7上市');
  assert.equal(after.then.length, 1);
  assert.equal(after.later.length, 2);
});

test('header facts and dates', () => {
  assert.equal(grid.lifeText, '1969.12.16 — 至今 · 湖北仙桃');
  assert.deepEqual(grid.facts, [
    { value: '56岁', label: '今年' },
    { value: '16年+', label: '小米' },
    { value: '16年', label: '金山' },
    { value: '43', label: '个事件' },
  ]);
  assert.equal(grid.featuredRank, 1);
  assert.deepEqual(grid.valences, ['up', 'down', 'turn', 'dispute']);
  assert.equal(endOf('2004-01-01', 'year'), Date.UTC(2004, 11, 31));
  assert.equal(endOf('2004-02-01', 'month'), Date.UTC(2004, 1, 29));
  assert.equal(duration('2010-04-06', null, '2010-12-01'), '0年+');
});

test('directory: featured people with a page, by rank, labels before fields', () => {
  const sam = structuredClone(classic.find((s) => s.slug === 'sam-altman'));
  sam.payload.person.featured_rank = 2;
  const cards = featuredCards([sam, leiJun, ...classic.filter((s) => s.slug !== 'sam-altman')], () => true);
  assert.deepEqual(cards.map((c) => [c.rank, c.slug]), [[1, 'lei-jun'], [2, 'sam-altman']]);
  assert.deepEqual(cards[0], {
    slug: 'lei-jun', rank: 1, name: '雷军', alt: 'Lei Jun', role: '小米集团创始人 · 董事长兼 CEO',
    initial: '雷', avatar: null, tags: ['雷布斯', '中关村劳模', '手机'],
  });
  // No page (e.g. dropped by validation) → not listed.
  assert.deepEqual(featuredCards([sam, leiJun], (slug) => slug !== 'lei-jun').map((c) => c.slug), ['sam-altman']);
  // At most 100.
  const many = Array.from({ length: 120 }, (_, i) => ({ slug: `p${i}`, payload: { person: { slug: `p${i}`, name: `P ${i}`, featured_rank: i + 1 } } }));
  assert.equal(featuredCards(many, () => true).length, 100);
});
