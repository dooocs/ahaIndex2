import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFixture } from '../scripts/dev/mock-supabase.mjs';
import {
  computeDailyArchives,
  computeGlobalStats,
  computeMonthlyArchives,
  computeWeeklyArchives,
  indexScoreRows,
} from '../src/lib/archive.ts';
import {
  dailyArchives,
  editionRecord,
  globalStats,
  mergeRecords,
  monthlyArchive,
  weeklyArchives,
} from '../src/lib/edition-ledger.ts';

// Every edition of the mock database, in the order the export reads them.
const rows = buildFixture().display_items
  .map(({ snapshot_date, processed_item_id, rank, aha_index, processed_title, title, source_name, tags, original_url, url }) =>
    ({ snapshot_date, processed_item_id, rank, aha_index, processed_title, title, source_name, tags, original_url, url }))
  .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date) || a.rank - b.rank || a.processed_item_id.localeCompare(b.processed_item_id));
const index = indexScoreRows(rows);
const records = [...index.entries()].map(([date, dayRows]) => editionRecord(date, dayRows));
const months = [...new Set(records.map((r) => r.date.slice(0, 7)))];
const monthRecords = (month) => records.filter((r) => r.date.startsWith(month));

test('ledger views equal the row-based archive computations for every month', () => {
  assert.ok(months.length >= 3);
  for (const month of months) {
    const year = Number(month.slice(0, 4));
    const num = Number(month.slice(5, 7));
    assert.deepEqual(monthlyArchive(month, monthRecords(month)), computeMonthlyArchives(index, year).find((m) => m.month === `${month}-01`), month);
    assert.deepEqual(weeklyArchives(year, monthRecords(month)), computeWeeklyArchives(index, year, num), month);
    assert.deepEqual(dailyArchives(monthRecords(month)), computeDailyArchives(index, year, num), month);
  }
});

test('global statistics from edition summaries equal those from rows', () => {
  assert.deepEqual(globalStats(records), computeGlobalStats(index));
});

test('first stories keep page order, titles and links', () => {
  const [record] = records;
  const dayRows = index.get(record.date);
  assert.equal(record.count, dayRows.length);
  assert.deepEqual(record.first.map((i) => i.title), dayRows.slice(0, 3).map((r) => r.processed_title));
  assert.deepEqual(record.first[0].tags, dayRows[0].tags.slice(0, 2));
});

test('merging replaces records by date and keeps the newest first', () => {
  const older = records.slice(2, 5);
  const updated = { ...records[2], score: 1 };
  const merged = mergeRecords(older, [records[0], updated]);
  assert.deepEqual(merged.map((r) => r.date), [records[0].date, ...older.map((r) => r.date)]);
  assert.equal(merged[1].score, 1);
});
