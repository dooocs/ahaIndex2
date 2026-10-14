// Shapes of the files the export script publishes next to the built pages
// (/data/*.json, the deploy manifest, per-URL copies of shell pages), and the
// daily build plan. Pure functions; scripts/export-site-data.ts does the IO.
import {
  computeDailyArchives,
  computeGlobalStats,
  computeMonthlyArchives,
  computeWeeklyArchives,
  dayScore,
  itemTitle,
  type ScoreIndex,
} from './archive.ts';
import { fallbackSignalStats } from './subject-data.ts';
import type {
  DailyArchive,
  GlobalStats,
  MonthlyArchive,
  ProcessedItem,
  SubjectCatalogEntry,
  SubjectDirectorySection,
  SubjectInsight,
  SubjectSignal,
  SubjectSignalStats,
  WeeklyArchive,
} from './types.ts';

export const DATA_VERSION = 1;
export const MONTH_NAMES = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Deploy manifest and build plan ─────────────────

export interface DeployManifest {
  v: number;
  /** Edition dates whose pages are on OSS, newest first. */
  dates: string[];
  latest_date: string | null;
  mode: 'daily' | 'full';
  commit: string | null;
  generated_at: string;
}

export function parseManifest(text: string | null | undefined): DeployManifest | null {
  if (!text) return null;
  const value = JSON.parse(text);
  if (!value || value.v !== DATA_VERSION || !Array.isArray(value.dates) || !value.dates.every((d: unknown) => typeof d === 'string' && DATE.test(d))) {
    throw new Error('Deploy manifest has an unexpected shape');
  }
  return value as DeployManifest;
}

/**
 * Dates now deployed: what the previous manifest recorded plus the editions
 * this run built, limited to dates that still exist in the database.
 */
export function mergeDeployedDates(previous: string[], built: string[], database: string[]): string[] {
  const exists = new Set(database);
  return [...new Set([...previous, ...built])].filter((d) => exists.has(d)).sort().reverse();
}

export interface BuildPlan {
  mode: 'daily' | 'full';
  /** Edition pages to build in daily mode, newest first; empty in full mode. */
  dates: string[];
  reason: string;
}

/** More missing editions than this and a daily build gives way to a full one. */
export const MAX_DAILY_BACKFILL = 7;

export function planBuild(requested: 'daily' | 'full', databaseDates: string[], manifest: DeployManifest | null): BuildPlan {
  if (requested === 'full') return { mode: 'full', dates: [], reason: 'full build requested' };
  if (!manifest) return { mode: 'full', dates: [], reason: 'no deploy manifest yet' };
  const newestFirst = [...new Set(databaseDates)].sort().reverse();
  if (newestFirst.length === 0) return { mode: 'full', dates: [], reason: 'database has no editions' };
  const deployed = new Set(manifest.dates);
  const missing = newestFirst.filter((d) => !deployed.has(d));
  if (missing.length > MAX_DAILY_BACKFILL) {
    return { mode: 'full', dates: [], reason: `${missing.length} editions are not deployed` };
  }
  // Each missing edition plus the edition before it, whose 下一期 link must now
  // point at it; and always the newest two, so a run with nothing new (a code
  // push) still refreshes today's and yesterday's pages.
  const before = missing.map((d) => newestFirst[newestFirst.indexOf(d) + 1]).filter(Boolean);
  const dates = [...new Set([...newestFirst.slice(0, 2), ...missing, ...before])].sort().reverse();
  return { mode: 'daily', dates, reason: `${missing.length} new edition(s)` };
}

// ─── /data/*.json ───────────────────────────────────

/** Restrict an index to deployed editions, so the JSON describes the live site. */
export function restrictIndex(index: ScoreIndex, dates: string[]): ScoreIndex {
  const keep = new Set(dates);
  return new Map([...index.entries()].filter(([d]) => keep.has(d)));
}

export interface SummaryJson {
  v: number;
  latest_date: string | null;
  stats: GlobalStats;
  /** Every edition, newest first: date, day score (0-100), item count. */
  editions: { date: string; score: number; count: number }[];
}

export function summaryJson(index: ScoreIndex): SummaryJson {
  const editions = [...index.entries()].map(([date, rows]) => ({ date, score: dayScore(rows), count: rows.length }));
  return { v: DATA_VERSION, latest_date: editions[0]?.date ?? null, stats: computeGlobalStats(index), editions };
}

export interface ArchiveIndexJson {
  v: number;
  latest_date: string | null;
  stats: GlobalStats;
  years: { year: number; months: MonthlyArchive[] }[];
}

export function archiveIndexJson(index: ScoreIndex): ArchiveIndexJson {
  const years = [...new Set([...index.keys()].map((d) => Number(d.slice(0, 4))))].sort((a, b) => b - a);
  return {
    v: DATA_VERSION,
    latest_date: [...index.keys()][0] ?? null,
    stats: computeGlobalStats(index),
    years: years.map((year) => ({ year, months: computeMonthlyArchives(index, year) })),
  };
}

export interface TopItem {
  title: string;
  tags: string[];
  source_name: string | null;
  url: string | null;
}

export interface ArchiveMonthJson {
  v: number;
  month: string;
  stats: GlobalStats;
  summary: MonthlyArchive | null;
  weeks: WeeklyArchive[];
  days: DailyArchive[];
  /** The first three stories of each edition, in page order. */
  top_items: Record<string, TopItem[]>;
}

export function archiveMonthJson(index: ScoreIndex, month: string): ArchiveMonthJson {
  const year = Number(month.slice(0, 4));
  const monthNum = Number(month.slice(5, 7));
  const days = computeDailyArchives(index, year, monthNum);
  const top_items: Record<string, TopItem[]> = {};
  for (const day of days) {
    top_items[day.snapshot_date] = (index.get(day.snapshot_date) || []).slice(0, 3).map((row) => ({
      title: itemTitle(row),
      tags: (row.tags || []).slice(0, 2),
      source_name: row.source_name,
      url: row.original_url || row.url || null,
    }));
  }
  return {
    v: DATA_VERSION,
    month,
    stats: computeGlobalStats(index),
    summary: computeMonthlyArchives(index, year).find((m) => m.month === `${month}-01`) ?? null,
    weeks: computeWeeklyArchives(index, year, monthNum),
    days,
    top_items,
  };
}

/** Fields a briefing card renders. */
export type CardItem = Pick<ProcessedItem,
  'processed_item_id' | 'snapshot_date' | 'processed_title' | 'title' | 'summary' | 'tags' | 'source_name' | 'category' | 'aha_index' | 'display_metrics'>;

export function cardItem(item: ProcessedItem): CardItem {
  return {
    processed_item_id: item.processed_item_id,
    snapshot_date: item.snapshot_date,
    processed_title: item.processed_title ?? null,
    title: item.title,
    summary: item.summary,
    tags: item.tags,
    source_name: item.source_name,
    category: item.category,
    aha_index: item.aha_index,
    display_metrics: item.display_metrics,
  };
}

export interface HistoryJson {
  v: number;
  items: CardItem[];
}

/** The 100 highest-scoring stories of the newest five editions. */
export function historyJson(itemsOfLatestFive: ProcessedItem[]): HistoryJson {
  const items = [...itemsOfLatestFive].sort((a, b) => (b.aha_index || 0) - (a.aha_index || 0)).slice(0, 100);
  return { v: DATA_VERSION, items: items.map(cardItem) };
}

export interface SubjectCard {
  slug: string;
  display_name: string;
  type: string;
  aliases: string[];
  summary: string;
  stats: SubjectSignalStats;
}

export interface SubjectIndexJson {
  v: number;
  latest_date: string | null;
  subject_count: number;
  sections: { slug: string; label: string; subjects: SubjectCard[] }[];
}

export function subjectIndexJson(
  sections: SubjectDirectorySection[],
  statsBySubject: Map<string, SubjectSignalStats>,
  latestDate: string | null,
): SubjectIndexJson {
  const statsOf = (subject: SubjectCatalogEntry) => statsBySubject.get(subject.id) || fallbackSignalStats(subject);
  const bySignal = (a: SubjectCatalogEntry, b: SubjectCatalogEntry) => {
    const as = statsOf(a);
    const bs = statsOf(b);
    if (as.signal_count_30d !== bs.signal_count_30d) return bs.signal_count_30d - as.signal_count_30d;
    if (as.trend_pct_30d !== bs.trend_pct_30d) return bs.trend_pct_30d - as.trend_pct_30d;
    return (b.curation_priority || 0) - (a.curation_priority || 0);
  };
  return {
    v: DATA_VERSION,
    latest_date: latestDate,
    subject_count: sections.reduce((n, s) => n + s.subjects.length, 0),
    sections: sections.map((section) => ({
      slug: section.slug,
      label: section.label,
      subjects: [...section.subjects].sort(bySignal).map((subject) => ({
        slug: subject.slug,
        display_name: subject.display_name,
        type: subject.type,
        aliases: (subject.aliases || []).slice(0, 2),
        summary: subject.definition || subject.description || '',
        stats: statsOf(subject),
      })),
    })),
  };
}

export interface SubjectJson {
  v: number;
  subject: {
    slug: string;
    display_name: string;
    type: string;
    summary: string;
    section_slug: string | null;
    homepage_url: string | null;
  };
  stats: SubjectSignalStats;
  signals: Pick<SubjectSignal, 'title' | 'url' | 'source_name' | 'snapshot_date' | 'score' | 'external'>[];
  highlights: { summary: string | null; analysis: string | null; evidence_count: number }[];
  related: { slug: string; display_name: string }[];
}

export function subjectJson(
  subject: SubjectCatalogEntry,
  stats: SubjectSignalStats | undefined,
  signals: SubjectSignal[],
  insights: SubjectInsight[],
  related: SubjectCatalogEntry[],
): SubjectJson {
  return {
    v: DATA_VERSION,
    subject: {
      slug: subject.slug,
      display_name: subject.display_name,
      type: subject.type,
      summary: subject.definition || subject.description || '',
      section_slug: subject.section_slug,
      homepage_url: subject.homepage_url,
    },
    stats: stats || fallbackSignalStats(subject),
    signals: signals.map(({ title, url, source_name, snapshot_date, score, external }) => ({ title, url, source_name, snapshot_date, score, external })),
    highlights: insights.filter((i) => i.module_type === 'highlight').map((i) => ({
      summary: i.summary,
      analysis: i.analysis,
      evidence_count: Array.isArray(i.evidence_item_ids) ? i.evidence_item_ids.length : 0,
    })),
    related: related.map((r) => ({ slug: r.slug, display_name: r.display_name })),
  };
}

// ─── Shell pages ────────────────────────────────────

/** Tokens a shell page is built with; replaced per URL by the export. */
export const SHELL_TOKENS = { title: '__SHELL_TITLE__', description: '__SHELL_DESCRIPTION__', path: '__SHELL_PATH__' } as const;

export interface ShellMeta {
  path: string;
  title: string;
  description: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A shell page's HTML for one URL. Every token must occur, or the shell is wrong. */
export function fillShell(html: string, meta: ShellMeta): string {
  for (const token of Object.values(SHELL_TOKENS)) {
    if (!html.includes(token)) throw new Error(`Shell page is missing ${token}`);
  }
  return html
    .replaceAll(SHELL_TOKENS.title, escapeHtml(meta.title))
    .replaceAll(SHELL_TOKENS.description, escapeHtml(meta.description))
    .replaceAll(SHELL_TOKENS.path, escapeHtml(meta.path));
}

export function monthShellMeta(month: string): ShellMeta {
  const year = month.slice(0, 4);
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1];
  return {
    path: `/daily/${month}`,
    title: `历史归档 - ${year}年${name} | AmazingIndex`,
    description: `在 AmazingIndex 探索 ${year}年${name} 的 AI 行业动态与突破。`,
  };
}

export function subjectShellMeta(subject: Pick<SubjectCatalogEntry, 'slug' | 'display_name' | 'definition' | 'description'>): ShellMeta {
  return {
    path: `/subjects/${subject.slug}`,
    title: `${subject.display_name} · AI 专题 | 蜗牛杂货站`,
    description: subject.definition || subject.description || `${subject.display_name} 的关键事件、突出点和横向对比。`,
  };
}
