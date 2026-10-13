// Build-time data access for Astro pages: memoized wrappers around the shared
// queries (queries.ts) and pure computations (archive.ts, subject-data.ts).
import { getSupabase } from './supabase';
import * as q from './queries.ts';
import { pickLatestRelatedData } from './project-heatmap';
import {
  computeDailyArchives,
  computeGlobalStats,
  computeMonthlyArchives,
  computeWeeklyArchives,
  indexScoreRows,
} from './archive.ts';
import {
  buildDirectorySections,
  buildSignals,
  computeSignalStats,
  mergeSubjectStats,
  relatedSubjects,
  sortSignalMentions,
} from './subject-data.ts';
import type {
  DailyArchive,
  GlobalStats,
  MonthlyArchive,
  ProcessedItem,
  ProjectEntry,
  ProjectHeatmapRow,
  SubjectCatalogEntry,
  SubjectDirectorySection,
  SubjectInsight,
  SubjectSignal,
  SubjectSignalStats,
  TimelineEntry,
  TrackInfo,
  WeeklyArchive,
} from './types';

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

// ─── Daily editions ─────────────────────────────────

export const getLatestDate = () => memo('latestDate', () => q.getLatestDate(db()));
export const getAllDates = () => memo('allDates', () => q.getAllDates(db()));
export const getItemsByDate = (date: string) => memo(`itemsByDate:${date}`, () => q.getItemsByDate(db(), date));
export const getNeighborDates = (date: string) => memo(`neighbors:${date}`, () => q.getNeighborDates(db(), date));
export const getAllArticleRouteItems = () => memo('allArticleRouteItems', () => q.getAllArticleRouteItems(db()));
export const getArticleRouteItemsFor = (pids: string[]) => q.getArticleRouteItemsFor(db(), pids);
export const getLatestDailyArchive = () => memo('latestDailyArchive', () => q.getLatestDailyArchive(db()));
export const getDailyArchiveByDate = (date: string): Promise<DailyArchive | null> => q.getDailyArchiveByDate(db(), date);

const getScoreIndex = () => memo('scoreIndex', async () => indexScoreRows(await q.getScoreRows(db())));

export async function getGlobalStats(): Promise<GlobalStats> {
  return computeGlobalStats(await getScoreIndex());
}

export async function getMonthlyArchives(year: number): Promise<MonthlyArchive[]> {
  return computeMonthlyArchives(await getScoreIndex(), year);
}

export async function getWeeklyArchives(year: number, month: number): Promise<WeeklyArchive[]> {
  return computeWeeklyArchives(await getScoreIndex(), year, month);
}

export async function getDailyArchives(year: number, month: number): Promise<DailyArchive[]> {
  return computeDailyArchives(await getScoreIndex(), year, month);
}

export async function getHistoryItems(): Promise<ProcessedItem[]> {
  const dates = (await getAllDates()).slice(0, 5);
  const items: ProcessedItem[] = [];
  for (const d of dates) items.push(...await getItemsByDate(d));
  return items.sort((a, b) => (b.aha_index || 0) - (a.aha_index || 0)).slice(0, 100);
}

// ─── Projects ───────────────────────────────────────

export const getProjectHeatmapData = () => memo<ProjectHeatmapRow[]>('phmData', () => q.getProjectHeatmapData(db()));
export const getTracks = () => memo<TrackInfo[]>('tracks', () => q.getTracks(db()));

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

export async function getProjectBySlug(slug: string): Promise<ProjectEntry | null> {
  return (await getProjects()).find((p) => p.slug === slug) ?? null;
}

export async function getProjectById(id: string): Promise<ProjectEntry | null> {
  return (await getProjects()).find((p) => p.subject_id === id) ?? null;
}

export const getProjectDates = () => memo<string[]>('projectDates', async () => {
  const dates = new Set<string>();
  for (const r of await getProjectHeatmapData()) {
    if (r.score_100 !== null && r.score_100 !== undefined) dates.add(r.snapshot_date);
  }
  return [...dates].sort();
});

// ─── Subjects ───────────────────────────────────────

export const getDirectorySubjects = () => memo<SubjectCatalogEntry[]>('directorySubjects', async () => {
  const [subjects, stats] = await Promise.all([q.getDirectorySubjectRows(db()), q.getSubjectStats(db())]);
  return mergeSubjectStats(subjects, stats);
});

export async function getSubjectDirectorySections(): Promise<SubjectDirectorySection[]> {
  return buildDirectorySections(await getDirectorySubjects());
}

export async function getPublicDirectorySubjects(): Promise<SubjectCatalogEntry[]> {
  return (await getSubjectDirectorySections()).flatMap((section) => section.subjects);
}

export async function getSubjectBySlug(slug: string): Promise<SubjectCatalogEntry | null> {
  return (await getPublicDirectorySubjects()).find((subject) => subject.slug === slug) ?? null;
}

export const getSubjectInsights = (subjectId: string): Promise<SubjectInsight[]> => q.getSubjectInsights(db(), subjectId);

export async function getSubjectSignalStatsBySubject(subjectIds: string[]): Promise<Map<string, SubjectSignalStats>> {
  const mentions = await q.fetchSubjectMentions(db(), subjectIds);
  return computeSignalStats(subjectIds, mentions, await getLatestDate());
}

export async function getSubjectSignals(subjectId: string, limit = 20): Promise<SubjectSignal[]> {
  const sorted = sortSignalMentions(await q.fetchSubjectMentions(db(), [subjectId]));
  const itemIds = sorted.slice(0, limit).map((row) => row.item_id).filter(Boolean);
  const [displayItems, rawItems] = await Promise.all([
    q.loadDisplaySignalItems(db(), itemIds),
    q.loadRawSnapshotSignalItems(db(), itemIds),
  ]);
  return buildSignals(sorted, displayItems, rawItems, limit);
}

export async function getRelatedSubjects(subject: SubjectCatalogEntry, limit = 6): Promise<SubjectCatalogEntry[]> {
  return relatedSubjects(await getDirectorySubjects(), subject, limit);
}
