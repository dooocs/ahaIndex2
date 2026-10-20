// Database reads shared by the Astro build and scripts/export-site-data.ts.
// Every function takes the client as its first argument and imports nothing
// with side effects, so it runs under Vite and under plain Node
// (`node --experimental-strip-types`) alike.
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchProjectHeatmapData } from './project-heatmap.ts';
import type { PersonRow, ProfileRow } from './people.ts';
import type {
  DailyArchive,
  ProcessedItem,
  ProjectHeatmapRow,
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
  /** Not a column of display_items in production; kept for the title fallback of full rows. */
  title?: string | null;
  source_name: string | null;
  tags: string[] | null;
  original_url: string | null;
  url?: string | null;
}

// Only columns that exist on production display_items (it has no title or url).
const SCORE_COLUMNS = 'snapshot_date, processed_item_id, rank, aha_index, processed_title, source_name, tags, original_url';

export async function getScoreRows(db: Db): Promise<ScoreRow[]> {
  return fetchAllRows<ScoreRow>((from, to) =>
    db.from(TABLE)
      .select(SCORE_COLUMNS)
      .order('snapshot_date', { ascending: false })
      .order('rank', { ascending: true })
      .order('processed_item_id', { ascending: true })
      .range(from, to),
  );
}

/** Score rows of the given editions only, in the same order as getScoreRows. */
export async function getScoreRowsForDates(db: Db, dates: string[]): Promise<ScoreRow[]> {
  if (dates.length === 0) return [];
  return fetchAllRows<ScoreRow>((from, to) =>
    db.from(TABLE)
      .select(SCORE_COLUMNS)
      .in('snapshot_date', [...new Set(dates)])
      .order('snapshot_date', { ascending: false })
      .order('rank', { ascending: true })
      .order('processed_item_id', { ascending: true })
      .range(from, to),
  );
}

/** (article, date) pairs of editions in [from, to], newest date first. */
export async function getArticleRouteItemsBetween(db: Db, from: string, to: string): Promise<ArticleRouteItem[]> {
  return fetchAllRows<ArticleRouteItem>((start, end) =>
    db.from(TABLE)
      .select('id, processed_item_id, snapshot_date')
      .gte('snapshot_date', from)
      .lte('snapshot_date', to)
      .order('snapshot_date', { ascending: false })
      .order('processed_item_id', { ascending: true })
      .range(start, end),
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

// ─── People ─────────────────────────────────────────

const PEOPLE_COLUMNS = 'id, slug, name, name_zh, x_handle, person_group, role, tier, take_text, take_updated_at, status, former_subjects, added_at, updated_at';
const PROFILE_COLUMNS = 'person_id, born, fields, events, record, labels, stances, compare, updated_at';

/**
 * Published people and their profiles (sql/people/). Before the tables exist
 * both are empty, so deploys keep working until the migration is applied.
 */
export async function getPeopleRows(db: Db): Promise<{ people: PersonRow[]; profiles: ProfileRow[] }> {
  try {
    const people = await fetchAllRows<PersonRow>((from, to) =>
      db.from('people').select(PEOPLE_COLUMNS).eq('status', 'published').order('slug', { ascending: true }).range(from, to),
    );
    const profiles: ProfileRow[] = [];
    for (const batch of chunkValues(people.map((p) => p.id), 100)) {
      profiles.push(...await fetchAllRows<ProfileRow>((from, to) =>
        db.from('person_profiles').select(PROFILE_COLUMNS).in('person_id', batch).order('person_id', { ascending: true }).range(from, to),
      ));
    }
    return { people, profiles };
  } catch (error) {
    if (isMissingRelationError(error)) return { people: [], profiles: [] };
    throw error;
  }
}
