// The archive ledger: one compact record per edition, holding everything the
// archive views need (day score, item count, top story, first three stories).
// Month files store their editions' records, so a daily export recomputes the
// records of the editions it built and merges them into the published files,
// instead of reading every past edition from the database.
//
// Every view derived here equals what archive.ts computes from full rows
// (tests/edition-ledger.test.mjs checks this over the whole mock dataset).
import { dayScore, getWeekNumber, itemTitle } from './archive.ts';
import type { ScoreRow } from './queries.ts';
import type { DailyArchive, GlobalStats, MonthlyArchive, WeeklyArchive } from './types.ts';

export interface TopItem {
  title: string;
  tags: string[];
  source_name: string | null;
  url: string | null;
}

export interface EditionRecord {
  date: string;
  /** Mean aha_index × 100. */
  score: number;
  count: number;
  /** The highest-scoring story (first in page order on ties). */
  top: { title: string; source: string; tags: string[]; aha: number } | null;
  /** The first three stories in page order. */
  first: TopItem[];
}

/** `rows`: one edition's items in page (rank) order. */
export function editionRecord(date: string, rows: ScoreRow[]): EditionRecord {
  let top: ScoreRow | undefined;
  for (const row of rows) if (!top || (row.aha_index || 0) > (top.aha_index || 0)) top = row;
  return {
    date,
    score: dayScore(rows),
    count: rows.length,
    top: top ? { title: itemTitle(top), source: top.source_name || '', tags: (top.tags || []).slice(0, 3), aha: top.aha_index || 0 } : null,
    first: rows.slice(0, 3).map((row) => ({
      title: itemTitle(row),
      tags: (row.tags || []).slice(0, 2),
      source_name: row.source_name,
      url: row.original_url || row.url || null,
    })),
  };
}

/** Records keyed by date: `updates` replace `previous`; newest first. */
export function mergeRecords(previous: EditionRecord[], updates: EditionRecord[]): EditionRecord[] {
  const byDate = new Map(previous.map((r) => [r.date, r]));
  for (const record of updates) byDate.set(record.date, record);
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export interface EditionSummary { date: string; score: number; count: number }

/** `editions` newest first. */
export function globalStats(editions: EditionSummary[]): GlobalStats {
  if (editions.length === 0) return { total_editions: 0, total_items: 0, avg_aha_score: 0, peak_aha_score: 0 };
  let totalItems = 0;
  let totalScore = 0;
  let peak = 0;
  for (const e of editions) {
    totalItems += e.count;
    if (e.count > 0) {
      totalScore += e.score;
      if (e.score > peak) peak = e.score;
    }
  }
  return { total_editions: editions.length, total_items: totalItems, avg_aha_score: totalScore / editions.length, peak_aha_score: peak };
}

/** `records`: one month's editions, newest first. */
export function monthlyArchive(month: string, records: EditionRecord[]): MonthlyArchive {
  let itemCount = 0;
  let totalScore = 0;
  let peakScore = 0;
  let peakDate = '';
  let top: EditionRecord['top'] = null;
  for (const r of records) {
    itemCount += r.count;
    if (r.count === 0) continue;
    totalScore += r.score;
    if (r.score > peakScore) {
      peakScore = r.score;
      peakDate = r.date;
    }
    if (r.top && (!top || r.top.aha > top.aha)) top = r.top;
  }
  return {
    month: `${month}-01`,
    edition_count: records.length,
    item_count: itemCount,
    avg_aha_score: records.length > 0 ? totalScore / records.length : 0,
    peak_aha_score: peakScore,
    peak_date: peakDate,
    summary: '',
    meta_description: '',
    top_story_title: top ? top.title : '',
  };
}

/** `records`: one month's editions, newest first. */
export function weeklyArchives(year: number, records: EditionRecord[]): WeeklyArchive[] {
  const weeks = new Map<number, EditionRecord[]>();
  for (const r of records) {
    const week = getWeekNumber(new Date(r.date));
    const list = weeks.get(week);
    if (list) list.push(r);
    else weeks.set(week, [r]);
  }
  const result: WeeklyArchive[] = [];
  for (const [week, list] of weeks) {
    let itemCount = 0;
    let totalScore = 0;
    let peakScore = 0;
    let peakDate = '';
    for (const r of list) {
      itemCount += r.count;
      if (r.count === 0) continue;
      totalScore += r.score;
      if (r.score > peakScore) {
        peakScore = r.score;
        peakDate = r.date;
      }
    }
    const sorted = list.map((r) => r.date).sort();
    result.push({
      year,
      week_number: week,
      start_date: sorted[0],
      end_date: sorted[sorted.length - 1],
      edition_count: list.length,
      item_count: itemCount,
      avg_aha_score: list.length > 0 ? totalScore / list.length : 0,
      peak_aha_score: peakScore,
      peak_date: peakDate,
    });
  }
  return result.sort((a, b) => b.week_number - a.week_number);
}

/** One entry per edition, newest first, with the day-over-day delta within the month. */
export function dailyArchives(records: EditionRecord[]): DailyArchive[] {
  const ascending = [...records].sort((a, b) => a.date.localeCompare(b.date));
  const result: DailyArchive[] = ascending.map((r) => ({
    snapshot_date: r.date,
    aha_score: r.score,
    aha_delta: '',
    item_count: r.count,
    top_story_title: r.top?.title ?? '',
    top_story_source: r.top?.source ?? '',
    top_tags: r.top?.tags ?? [],
    rarity_score: 0,
    timeliness_score: 0,
    impact_score: 0,
  }));
  for (let i = 1; i < result.length; i++) {
    const delta = result[i].aha_score - result[i - 1].aha_score;
    result[i].aha_delta = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`;
  }
  return result.reverse();
}
