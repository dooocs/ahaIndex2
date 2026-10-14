// Shapes of the files the export script publishes next to the built pages
// (/data/*.json, per-URL copies of shell pages) and the daily build plan.
// Pure functions; scripts/export-site-data.ts does the IO.
import {
  dailyArchives,
  globalStats,
  monthlyArchive,
  weeklyArchives,
  type EditionRecord,
  type EditionSummary,
  type TopItem,
} from './edition-ledger.ts';
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

// ─── Build plan ─────────────────────────────────────

/** A daily run never builds more than this many editions, backfill included. */
export const MAX_DAILY_EDITIONS = 16;

export interface BuildPlan {
  mode: 'daily' | 'full';
  /** Edition pages to build in daily mode, newest first; empty in full mode. */
  dates: string[];
  reason: string;
}

/**
 * Daily: the newest edition and the one before it, plus any backfill dates.
 * A daily run never turns into a full one: too many dates is an error.
 */
export function planDaily(latest: string | null, previous: string | null, backfill: string[] = []): BuildPlan {
  if (!latest) throw new Error('The database has no editions');
  const invalid = backfill.filter((d) => !DATE.test(d));
  if (invalid.length > 0) throw new Error(`Invalid backfill dates: ${invalid.join(', ')}`);
  const dates = [...new Set([latest, previous, ...backfill].filter((d): d is string => Boolean(d)))].sort().reverse();
  if (dates.length > MAX_DAILY_EDITIONS) {
    throw new Error(`A daily run builds at most ${MAX_DAILY_EDITIONS} editions (asked for ${dates.length}); run the full build instead`);
  }
  const extra = dates.length - (previous ? 2 : 1);
  return { mode: 'daily', dates, reason: extra > 0 ? `newest two + ${extra} backfilled` : 'newest two' };
}

/** Database editions whose page is not on OSS, newest first. */
export function missingEditions(databaseDates: string[], deployedKeys: Set<string>): string[] {
  return [...new Set(databaseDates)].filter((d) => !deployedKeys.has(editionKey(d))).sort().reverse();
}

// ─── Deployed pages ─────────────────────────────────

export const editionKey = (date: string) => `daily/${date}/index.html`;
export const articleKey = (pid: string) => `article/${pid}/index.html`;

/**
 * Published content is only ever removed on purpose. Throws when any of
 * `keys` (pages that published data or sitemaps reference) is not deployed,
 * instead of letting the export drop it from summary.json or a sitemap.
 */
export function assertStillDeployed(keys: string[], isDeployed: (key: string) => boolean, context: string): void {
  const missing = keys.filter((key) => !isDeployed(key));
  if (missing.length === 0) return;
  throw new Error(
    `${missing.length} ${context} missing from the OSS listing and this build ` +
    `(${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}). ` +
    'Refusing to publish data that would drop them. If the listing is incomplete, re-run; ' +
    'if pages are really gone, restore them with a backfill run, or run the full build to rebuild everything.',
  );
}

// ─── /data/*.json ───────────────────────────────────

export interface SummaryJson {
  v: number;
  latest_date: string | null;
  stats: GlobalStats;
  /** Every deployed edition, newest first: date, day score (0-100), item count. */
  editions: EditionSummary[];
}

export function summaryJson(editions: EditionSummary[]): SummaryJson {
  const sorted = editions.map(({ date, score, count }) => ({ date, score, count })).sort((a, b) => b.date.localeCompare(a.date));
  return { v: DATA_VERSION, latest_date: sorted[0]?.date ?? null, stats: globalStats(sorted), editions: sorted };
}

export interface ArchiveIndexJson {
  v: number;
  latest_date: string | null;
  stats: GlobalStats;
  years: { year: number; months: MonthlyArchive[] }[];
}

/** `months`: one summary per month with editions, any order. */
export function archiveIndexJson(months: MonthlyArchive[], summary: SummaryJson): ArchiveIndexJson {
  const years = [...new Set(months.map((m) => Number(m.month.slice(0, 4))))].sort((a, b) => b - a);
  return {
    v: DATA_VERSION,
    latest_date: summary.latest_date,
    stats: summary.stats,
    years: years.map((year) => ({
      year,
      months: months.filter((m) => m.month.startsWith(`${year}-`)).sort((a, b) => b.month.localeCompare(a.month)),
    })),
  };
}

export interface ArchiveMonthJson {
  v: number;
  month: string;
  /** The ledger: one record per edition of the month, newest first. */
  records: EditionRecord[];
  summary: MonthlyArchive;
  weeks: WeeklyArchive[];
  days: DailyArchive[];
  /** The first three stories of each edition, in page order. */
  top_items: Record<string, TopItem[]>;
}

export function archiveMonthJson(month: string, records: EditionRecord[]): ArchiveMonthJson {
  const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date));
  return {
    v: DATA_VERSION,
    month,
    records: sorted,
    summary: monthlyArchive(month, sorted),
    weeks: weeklyArchives(Number(month.slice(0, 4)), sorted),
    days: dailyArchives(sorted),
    top_items: Object.fromEntries(sorted.map((r) => [r.date, r.first])),
  };
}

export function parseDataFile<T extends { v: number }>(text: string | null, name: string): T | null {
  if (text === null) return null;
  const value = JSON.parse(text);
  if (value?.v !== DATA_VERSION) throw new Error(`${name} has data version ${value?.v}, expected ${DATA_VERSION}`);
  return value as T;
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
