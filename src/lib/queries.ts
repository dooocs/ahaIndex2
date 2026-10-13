// Database reads shared by the Astro build and scripts/export-site-data.ts.
// Every function takes the client as its first argument and imports nothing
// with side effects, so it runs under Vite and under plain Node
// (`node --experimental-strip-types`) alike.
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchProjectHeatmapData } from './project-heatmap.ts';
import type {
  DailyArchive,
  ProcessedItem,
  ProjectHeatmapRow,
  SubjectCatalogEntry,
  SubjectInsight,
  SubjectStatsRow,
  TrackInfo,
} from './types.ts';

export type Db = SupabaseClient;

const TABLE = 'display_items';
/** Hosted Supabase returns at most this many rows per request. */
export const PAGE_SIZE = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: any }>;

/** Offset pagination. The query must have a total order so pages do not overlap. */
export async function fetchAllRows<T>(createQuery: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await createQuery(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

export function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

export function isMissingRelationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as { code?: string; message?: string; hint?: string };
  return Boolean(
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    err.message?.includes('schema cache') ||
    err.message?.includes('Could not find the table') ||
    err.hint?.includes('Perhaps you meant the table')
  );
}

// ─── Daily editions ─────────────────────────────────

export async function getLatestDate(db: Db): Promise<string | null> {
  const { data, error } = await db.from(TABLE).select('snapshot_date').order('snapshot_date', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0]?.snapshot_date ?? null;
}

/** Every edition date, newest first. Reads two narrow columns. */
export async function getAllDates(db: Db): Promise<string[]> {
  const data = await fetchAllRows<{ snapshot_date: string }>((from, to) =>
    db.from(TABLE)
      .select('snapshot_date, processed_item_id')
      .order('snapshot_date', { ascending: false })
      .order('processed_item_id', { ascending: true })
      .range(from, to),
  );
  return [...new Set(data.map((r) => r.snapshot_date))];
}

export async function getItemsByDate(db: Db, date: string): Promise<ProcessedItem[]> {
  return fetchAllRows<ProcessedItem>((from, to) =>
    db.from(TABLE)
      .select('*')
      .eq('snapshot_date', date)
      .order('rank', { ascending: true })
      .order('processed_item_id', { ascending: true })
      .range(from, to),
  );
}

/** The edition dates immediately before and after `date`, if any. */
export async function getNeighborDates(db: Db, date: string): Promise<{ prev: string | null; next: string | null }> {
  const [prev, next] = await Promise.all([
    db.from(TABLE).select('snapshot_date').lt('snapshot_date', date).order('snapshot_date', { ascending: false }).limit(1),
    db.from(TABLE).select('snapshot_date').gt('snapshot_date', date).order('snapshot_date', { ascending: true }).limit(1),
  ]);
  if (prev.error) throw prev.error;
  if (next.error) throw next.error;
  return { prev: prev.data?.[0]?.snapshot_date ?? null, next: next.data?.[0]?.snapshot_date ?? null };
}

export interface ArticleRouteItem {
  id: string;
  processed_item_id: string;
  snapshot_date: string;
}

/** Every (article, date) pair, newest date first. */
export async function getAllArticleRouteItems(db: Db): Promise<ArticleRouteItem[]> {
  return fetchAllRows<ArticleRouteItem>((from, to) =>
    db.from(TABLE)
      .select('id, processed_item_id, snapshot_date')
      .order('snapshot_date', { ascending: false })
      .order('processed_item_id', { ascending: true })
      .range(from, to),
  );
}

/** Every date on which the given articles appear, newest first. */
export async function getArticleRouteItemsFor(db: Db, pids: string[]): Promise<ArticleRouteItem[]> {
  const rows: ArticleRouteItem[] = [];
  for (const batch of chunkValues([...new Set(pids)], 100)) {
    rows.push(...await fetchAllRows<ArticleRouteItem>((from, to) =>
      db.from(TABLE)
        .select('id, processed_item_id, snapshot_date')
        .in('processed_item_id', batch)
        .order('snapshot_date', { ascending: false })
        .order('processed_item_id', { ascending: true })
        .range(from, to),
    ));
  }
  return rows.sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date) || a.processed_item_id.localeCompare(b.processed_item_id));
}

/**
 * The narrow per-item columns that archives, statistics and top stories need,
 * in the same order as getItemsByDate within each date, dates newest first.
 */
export interface ScoreRow {
  snapshot_date: string;
  processed_item_id: string;
  rank: number;
  aha_index: number | null;
  processed_title: string | null;
  title: string | null;
  source_name: string | null;
  tags: string[] | null;
  original_url: string | null;
  url: string | null;
}

export async function getScoreRows(db: Db): Promise<ScoreRow[]> {
  return fetchAllRows<ScoreRow>((from, to) =>
    db.from(TABLE)
      .select('snapshot_date, processed_item_id, rank, aha_index, processed_title, title, source_name, tags, original_url, url')
      .order('snapshot_date', { ascending: false })
      .order('rank', { ascending: true })
      .order('processed_item_id', { ascending: true })
      .range(from, to),
  );
}

const DAILY_ARCHIVE_COLUMNS = 'snapshot_date, aha_score, aha_delta, item_count, top_story_title, top_story_source, top_tags, rarity_score, timeliness_score, impact_score, percentile_90d, percentile_tier, sample_size_90d';

export async function getLatestDailyArchive(db: Db): Promise<DailyArchive | null> {
  const { data, error } = await db.from('daily_archives').select(DAILY_ARCHIVE_COLUMNS).order('snapshot_date', { ascending: false }).limit(1);
  if (error) throw error;
  return (data?.[0] as DailyArchive) ?? null;
}

export async function getDailyArchiveByDate(db: Db, date: string): Promise<DailyArchive | null> {
  const { data, error } = await db.from('daily_archives').select(DAILY_ARCHIVE_COLUMNS).eq('snapshot_date', date).limit(1);
  if (error) throw error;
  return (data?.[0] as DailyArchive) ?? null;
}

// ─── Projects ───────────────────────────────────────

export function getProjectHeatmapData(db: Db): Promise<ProjectHeatmapRow[]> {
  return fetchProjectHeatmapData(db);
}

export async function getTracks(db: Db): Promise<TrackInfo[]> {
  const { data, error } = await db.from('tracks').select('*').eq('status', 'active').order('display_order');
  if (error) throw error;
  return (data as TrackInfo[]) ?? [];
}

// ─── Subjects ───────────────────────────────────────

export async function getSubjectStats(db: Db): Promise<SubjectStatsRow[]> {
  try {
    return await fetchAllRows<SubjectStatsRow>((from, to) =>
      db.from('subject_stats')
        .select('subject_id, mention_count, first_seen_at, last_seen_at, item_count')
        .order('subject_id', { ascending: true })
        .range(from, to),
    );
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

export async function getDirectorySubjectRows(db: Db): Promise<SubjectCatalogEntry[]> {
  try {
    return await fetchAllRows<SubjectCatalogEntry>((from, to) =>
      db.from('subjects')
        .select('id, slug, type, display_name, aliases, description, definition, homepage_url, metadata, first_seen_at, last_seen_at, mention_count, status, directory_visible, section_slug, curation_priority, created_by')
        .eq('status', 'active')
        .eq('directory_visible', true)
        .neq('type', 'project')
        .order('curation_priority', { ascending: false })
        .order('display_name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    );
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

export async function getSubjectInsights(db: Db, subjectId: string): Promise<SubjectInsight[]> {
  const { data, error } = await db
    .from('subject_insights')
    .select('id, subject_id, snapshot_date, module_type, insight_key, title, summary, analysis, event_date, comparison_subject_ids, dimensions_json, importance_score, confidence, evidence_item_ids, evidence_refs_json, related_subject_ids, generated_by, generator_version, status, published_at')
    .eq('subject_id', subjectId)
    .eq('status', 'published')
    .order('module_type', { ascending: true })
    .order('event_date', { ascending: false, nullsFirst: false })
    .order('importance_score', { ascending: false, nullsFirst: false });
  if (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
  return (data as SubjectInsight[]) ?? [];
}

export interface SubjectMentionRow {
  subject_id: string;
  item_id: string;
  snapshot_date: string;
  source_name: string | null;
  score: number | null;
  context: string | null;
  created_at: string | null;
  detected_by?: string | null;
  confidence?: number | null;
  evidence?: Record<string, any> | null;
}

/** All mentions of the given subjects, newest first. Paginated: no silent cap. */
export async function fetchSubjectMentions(db: Db, subjectIds: string[]): Promise<SubjectMentionRow[]> {
  const ids = [...new Set(subjectIds.filter(Boolean))];
  const rows: SubjectMentionRow[] = [];
  try {
    for (const batch of chunkValues(ids, 100)) {
      rows.push(...await fetchAllRows<SubjectMentionRow>((from, to) =>
        db.from('subject_mentions')
          .select('subject_id, item_id, snapshot_date, source_name, score, context, created_at, detected_by, confidence, evidence')
          .in('subject_id', batch)
          .order('snapshot_date', { ascending: false })
          .order('created_at', { ascending: false })
          .order('subject_id', { ascending: true })
          .order('item_id', { ascending: true })
          .range(from, to),
      ));
    }
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
  return rows;
}

export interface DisplaySignalItem {
  processed_item_id: string;
  snapshot_date: string;
  source_name: string | null;
  processed_title: string | null;
  summary: string | null;
  original_url: string | null;
  aha_index: number | null;
  rank: number | null;
}

export interface RawSnapshotSignalItem {
  id: string;
  snapshot_date: string;
  sub_source_type: string | null;
  title: string | null;
  content: string | null;
  url: string | null;
}

const dateOnly = (value: string | null | undefined): string => String(value || '').slice(0, 10);

export async function loadDisplaySignalItems(db: Db, itemIds: string[]): Promise<Map<string, DisplaySignalItem>> {
  const map = new Map<string, DisplaySignalItem>();
  try {
    for (const batch of chunkValues([...new Set(itemIds)], 100)) {
      const rows = await fetchAllRows<DisplaySignalItem>((from, to) =>
        db.from('display_items')
          .select('processed_item_id, snapshot_date, source_name, processed_title, summary, original_url, aha_index, rank')
          .in('processed_item_id', batch)
          .order('processed_item_id', { ascending: true })
          .order('snapshot_date', { ascending: true })
          .range(from, to),
      );
      for (const item of rows) map.set(`${item.processed_item_id}:${dateOnly(item.snapshot_date)}`, item);
    }
  } catch (error) {
    if (isMissingRelationError(error)) return map;
    throw error;
  }
  return map;
}

export async function loadRawSnapshotSignalItems(db: Db, itemIds: string[]): Promise<Map<string, RawSnapshotSignalItem>> {
  const map = new Map<string, RawSnapshotSignalItem>();
  try {
    for (const batch of chunkValues([...new Set(itemIds)], 100)) {
      const rows = await fetchAllRows<RawSnapshotSignalItem>((from, to) =>
        db.from('octp_snapshot_raw_items')
          .select('id, snapshot_date, sub_source_type, title, content, url')
          .in('id', batch)
          .order('id', { ascending: true })
          .order('snapshot_date', { ascending: true })
          .range(from, to),
      );
      for (const item of rows) map.set(`${item.id}:${dateOnly(item.snapshot_date)}`, item);
    }
  } catch (error) {
    if (isMissingRelationError(error)) return map;
    throw error;
  }
  return map;
}
