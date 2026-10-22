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
import type {
  DailyArchive,
  GlobalStats,
  MonthlyArchive,
  ProcessedItem,
  WeeklyArchive,
} from './types.ts';
import { siteTitle } from './site.ts';

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

/**
 * Replaces the content of each `data-ssr-slot="<name>"` element with the given
 * HTML. A slot's default content (what the template shows before rendering)
 * must not contain an element of the slot's own tag: the content ends at the
 * first closing tag of that name. Every slot must occur exactly once.
 */
export function fillSlots(html: string, slots: Record<string, string>): string {
  let out = html;
  for (const [name, content] of Object.entries(slots)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Invalid slot name ${name}`);
    const pattern = new RegExp(`(<([a-z][a-z0-9]*)\\b[^>]*\\sdata-ssr-slot="${name}"[^>]*>)[\\s\\S]*?(</\\2>)`, 'g');
    const matches = out.match(pattern)?.length ?? 0;
    if (matches !== 1) throw new Error(`Shell page has ${matches} slot(s) named ${name}, expected 1`);
    out = out.replace(pattern, (_match, open: string, _tag: string, close: string) => `${open}${content}${close}`);
  }
  return out;
}

export function yearShellMeta(): ShellMeta {
  return {
    path: '/daily',
    title: siteTitle('历史归档'),
    description: '深入探索 AmazingIndex 过去 AI 行业动态的综合数据库，经过评分和分类，方便您发现。',
  };
}

export function monthShellMeta(month: string): ShellMeta {
  const year = month.slice(0, 4);
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1];
  return {
    path: `/daily/${month}`,
    title: siteTitle(`历史归档 - ${year}年${name}`),
    description: `在 AmazingIndex 探索 ${year}年${name} 的 AI 行业动态与突破。`,
  };
}

// ─── Retired 专题 pages ─────────────────────────────

/**
 * What a retired /subjects URL serves now: a page that search engines drop
 * (noindex) and readers leave at once for `target` (the person who took the
 * subject over, or the people directory). Static hosting has no 301, so the
 * refresh and the canonical link carry the move.
 */
export function retiredSubjectPage(target: string, siteUrl: string): string {
  const href = escapeHtml(target);
  const absolute = escapeHtml(`${siteUrl}${target}`);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<meta name="robots" content="noindex, follow">`
    + `<title>${escapeHtml(siteTitle('专题已下线'))}</title>`
    + `<link rel="canonical" href="${absolute}">`
    + `<meta http-equiv="refresh" content="0; url=${href}">`
    + `</head><body style="margin:0;background:#f0ebe0;color:#1a1612;font:15px/1.8 'Noto Serif SC',serif">`
    + `<p style="max-width:560px;margin:80px auto;padding:0 20px">专题已经下线，内容搬到了「人物」。正在前往 <a href="${href}" style="color:#c0392b">${href}</a>…</p>`
    + `</body></html>`;
}
