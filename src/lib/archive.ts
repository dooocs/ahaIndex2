// Archive and statistics computed from narrow score rows. Pure functions: the
// numbers match what the pages computed before from full rows (mean aha_index
// of an edition × 100), and the export script reuses them for the JSON files.
import type { DailyArchive, GlobalStats, MonthlyArchive, WeeklyArchive } from './types.ts';
import type { ScoreRow } from './queries.ts';

export type ScoreIndex = Map<string, ScoreRow[]>;

/** Group rows by date. Map order = dates newest first; rows keep their rank order. */
export function indexScoreRows(rows: ScoreRow[]): ScoreIndex {
  const byDate: ScoreIndex = new Map();
  for (const row of rows) {
    const list = byDate.get(row.snapshot_date);
    if (list) list.push(row);
    else byDate.set(row.snapshot_date, [row]);
  }
  return new Map([...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])));
}

export function dayScore(rows: Pick<ScoreRow, 'aha_index'>[]): number {
  return rows.length > 0 ? rows.reduce((s, i) => s + (i.aha_index || 0), 0) / rows.length * 100 : 0;
}

export function itemTitle(row: Pick<ScoreRow, 'processed_title' | 'title'>): string {
  return row.processed_title || row.title || '';
}

export function getWeekNumber(d: Date) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function computeGlobalStats(index: ScoreIndex): GlobalStats {
  if (index.size === 0) return { total_editions: 0, total_items: 0, avg_aha_score: 0, peak_aha_score: 0 };
  let totalItems = 0;
  let totalScore = 0;
  let peakScore = 0;
  for (const rows of index.values()) {
    totalItems += rows.length;
    if (rows.length > 0) {
      const score = dayScore(rows);
      totalScore += score;
      if (score > peakScore) peakScore = score;
    }
  }
  return {
    total_editions: index.size,
    total_items: totalItems,
    avg_aha_score: totalScore / index.size,
    peak_aha_score: peakScore,
  };
}

export function computeMonthlyArchives(index: ScoreIndex, year: number): MonthlyArchive[] {
  const monthsMap: Record<string, string[]> = {};
  for (const d of index.keys()) {
    if (!d.startsWith(`${year}-`)) continue;
    const month = d.slice(0, 7);
    (monthsMap[month] ||= []).push(d);
  }

  const result: MonthlyArchive[] = [];
  for (const [monthStr, monthDates] of Object.entries(monthsMap)) {
    let itemCount = 0;
    let totalScore = 0;
    let peakScore = 0;
    let peakDate = '';
    let topItem: ScoreRow | null = null;
    for (const d of monthDates) {
      const rows = index.get(d) || [];
      itemCount += rows.length;
      if (rows.length === 0) continue;
      const score = dayScore(rows);
      totalScore += score;
      if (score > peakScore) {
        peakScore = score;
        peakDate = d;
      }
      for (const row of rows) {
        if (!topItem || (row.aha_index || 0) > (topItem.aha_index || 0)) topItem = row;
      }
    }
    result.push({
      month: `${monthStr}-01`,
      edition_count: monthDates.length,
      item_count: itemCount,
      avg_aha_score: monthDates.length > 0 ? totalScore / monthDates.length : 0,
      peak_aha_score: peakScore,
      peak_date: peakDate,
      summary: '',
      meta_description: '',
      top_story_title: topItem ? itemTitle(topItem) : '',
    });
  }
  return result.sort((a, b) => b.month.localeCompare(a.month));
}

export function computeWeeklyArchives(index: ScoreIndex, year: number, month: number): WeeklyArchive[] {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const weeksMap: Record<number, string[]> = {};
  for (const d of index.keys()) {
    if (!d.startsWith(prefix)) continue;
    (weeksMap[getWeekNumber(new Date(d))] ||= []).push(d);
  }

  const result: WeeklyArchive[] = [];
  for (const [weekNoStr, weekDates] of Object.entries(weeksMap)) {
    let itemCount = 0;
    let totalScore = 0;
    let peakScore = 0;
    let peakDate = '';
    for (const d of weekDates) {
      const rows = index.get(d) || [];
      itemCount += rows.length;
      if (rows.length === 0) continue;
      const score = dayScore(rows);
      totalScore += score;
      if (score > peakScore) {
        peakScore = score;
        peakDate = d;
      }
    }
    const sorted = [...weekDates].sort();
    result.push({
      year,
      week_number: parseInt(weekNoStr, 10),
      start_date: sorted[0],
      end_date: sorted[sorted.length - 1],
      edition_count: weekDates.length,
      item_count: itemCount,
      avg_aha_score: weekDates.length > 0 ? totalScore / weekDates.length : 0,
      peak_aha_score: peakScore,
      peak_date: peakDate,
    });
  }
  return result.sort((a, b) => b.week_number - a.week_number);
}

/** One entry per edition of a month, newest first, with the day-over-day delta. */
export function computeDailyArchives(index: ScoreIndex, year: number, month: number): DailyArchive[] {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const dates = [...index.keys()].filter((d) => d.startsWith(prefix)).sort();
  const result: DailyArchive[] = dates.map((d) => {
    const rows = index.get(d) || [];
    const top = [...rows].sort((a, b) => (b.aha_index || 0) - (a.aha_index || 0))[0];
    return {
      snapshot_date: d,
      aha_score: dayScore(rows),
      aha_delta: '',
      item_count: rows.length,
      top_story_title: top ? itemTitle(top) : '',
      top_story_source: top ? (top.source_name || '') : '',
      top_tags: top?.tags?.slice(0, 3) ?? [],
      rarity_score: 0,
      timeliness_score: 0,
      impact_score: 0,
    };
  });
  for (let i = 1; i < result.length; i++) {
    const delta = result[i].aha_score - result[i - 1].aha_score;
    result[i].aha_delta = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`;
  }
  return result.sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));
}
