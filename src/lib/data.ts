// Build-time data access for Astro pages: memoized wrappers around the shared
// queries (queries.ts). Only the homepage, edition, article, project and
// /feed pages read the database at build time; everything else is published
// by the export.
import { getSupabase } from './supabase';
import { deployedEditionDates, isDailyBuild, isFeedBuild, scopeDatesFromEnv } from './build-scope';
import * as q from './queries.ts';
import { pickLatestRelatedData } from './project-heatmap';
import { getFeedPosts } from './feed.ts';
import type { DailyArchive, ProjectEntry, ProjectHeatmapRow, TimelineEntry } from './types';

export type { ArticleRouteItem } from './queries.ts';

// ─── Build-time memo cache ──────────────────────────
const cache = new Map<string, Promise<unknown>>();

function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    const pending = fn();
    // A failed read is retried by the next caller instead of being cached.
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return cache.get(key) as Promise<T>;
}

const db = () => getSupabase();

// ─── 动态 ───────────────────────────────────────────

/** The 24 hours of the feed up to its newest post. */
export const getFeed = () => memo('feed', () => getFeedPosts(db()));

// ─── Daily editions ─────────────────────────────────

export const getLatestDate = () => memo('latestDate', () => q.getLatestDate(db()));
export const getAllDates = () => memo('allDates', () => q.getAllDates(db()));
export const getItemsByDate = (date: string) => memo(`itemsByDate:${date}`, () => q.getItemsByDate(db(), date));
export const getNeighborDates = (date: string) => memo(`neighbors:${date}`, async () => {
  if (!isDailyBuild()) {
    // A full build has every date in hand (newest first); no extra queries.
    const all = await getAllDates();
    const i = all.indexOf(date);
    if (i >= 0) return { prev: all[i + 1] ?? null, next: i > 0 ? all[i - 1] : null };
  }
  return q.getNeighborDates(db(), date);
});
export const getAllArticleRouteItems = () => memo('allArticleRouteItems', () => q.getAllArticleRouteItems(db()));
export const getArticleRouteItemsFor = (pids: string[]) => q.getArticleRouteItemsFor(db(), pids);
export const getLatestDailyArchive = () => memo('latestDailyArchive', () => q.getLatestDailyArchive(db()));
export const getDailyArchiveByDate = (date: string): Promise<DailyArchive | null> => q.getDailyArchiveByDate(db(), date);

/**
 * Edition dates this build renders pages for, newest first: every edition in
 * a full build; BUILD_DATES (or the newest two editions) in a daily build;
 * none in a feed build.
 */
export const getBuildDates = () => memo('buildDates', async (): Promise<string[]> => {
  if (!isDailyBuild()) return getAllDates();
  if (isFeedBuild()) return [];
  const explicit = scopeDatesFromEnv();
  if (explicit.length > 0) return explicit;
  const latest = await getLatestDate();
  if (!latest) return [];
  const { prev } = await getNeighborDates(latest);
  return prev ? [latest, prev] : [latest];
});

/** How far back 上一期 looks for a published edition before it is left out. */
const PREVIOUS_LOOKBACK = 30;

/**
 * The edition 上一期 links to: the nearest earlier edition whose page is on
 * the bucket or built by this run, so the link never points at a page that is
 * not there (an edition missing from OSS is skipped). Null if there is none
 * within PREVIOUS_LOOKBACK editions.
 */
export const getPreviousPublished = (date: string) => memo(`previousPublished:${date}`, async (): Promise<string | null> => {
  const deployed = deployedEditionDates();
  const built = new Set(await getBuildDates());
  const published = (d: string) => built.has(d) || deployed === null || deployed.has(d);
  let cursor = date;
  for (let i = 0; i < PREVIOUS_LOOKBACK; i++) {
    const { prev } = await getNeighborDates(cursor);
    if (!prev) return null;
    if (published(prev)) return prev;
    cursor = prev;
  }
  return null;
});

// ─── Projects ───────────────────────────────────────

export const getProjectHeatmapData = () => memo<ProjectHeatmapRow[]>('phmData', () => q.getProjectHeatmapData(db()));

export function buildProjects(rows: ProjectHeatmapRow[]): ProjectEntry[] {
  const grouped = new Map<string, ProjectHeatmapRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.subject_id);
    if (list) list.push(row);
    else grouped.set(row.subject_id, [row]);
  }

  const projects: ProjectEntry[] = [];
  for (const [subjectId, subjectRows] of grouped) {
    subjectRows.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    const first = subjectRows[0];
    const related_data = pickLatestRelatedData(subjectRows);
    const scored = subjectRows.filter((r) => r.score_100 !== null && r.score_100 !== undefined);
    const timeline: TimelineEntry[] = scored.map((r) => ({
      date: r.snapshot_date,
      aha: r.score_100!,
      role: r.role || undefined,
      source_name: r.source_name || undefined,
    }));
    const scores = scored.map((r) => r.score_100!);
    let delta = '';
    if (scores.length >= 2) {
      const diff = scores[scores.length - 1] - scores[scores.length - 2];
      delta = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}`;
    }
    projects.push({
      subject_id: subjectId,
      slug: first.subject_slug,
      display_name: first.subject_name,
      type: first.subject_type,
      tags: first.tags || [],
      summary: first.summary,
      first_seen_at: first.first_seen_at,
      last_seen_at: first.last_seen_at,
      mention_count: first.mention_count || 0,
      track_id: first.track_id,
      track_name: first.track_name,
      track_group: first.track_group,
      aha_current: scores.length > 0 ? scores[scores.length - 1] : 0,
      aha_peak: scores.length > 0 ? Math.max(...scores) : 0,
      delta,
      appearances: subjectRows.length,
      rank: 0,
      timeline,
      related: related_data?.related || [],
      competitors: related_data?.competitors || [],
    });
  }

  projects.sort((a, b) => b.aha_current - a.aha_current);
  projects.forEach((p, i) => { p.rank = i + 1; });
  return projects;
}

export const getProjects = () => memo<ProjectEntry[]>('projects', async () => buildProjects(await getProjectHeatmapData()));

export const getProjectDates = () => memo<string[]>('projectDates', async () => {
  const dates = new Set<string>();
  for (const r of await getProjectHeatmapData()) {
    if (r.score_100 !== null && r.score_100 !== undefined) dates.add(r.snapshot_date);
  }
  return [...dates].sort();
});
