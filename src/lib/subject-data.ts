// Subject directory, signal statistics and signal lists, computed from rows
// already read from the database. Pure functions shared by the build and the
// export script.
import type {
  SubjectCatalogEntry,
  SubjectDirectorySection,
  SubjectSignal,
  SubjectSignalStats,
  SubjectStatsRow,
} from './types.ts';
import type { DisplaySignalItem, RawSnapshotSignalItem, SubjectMentionRow } from './queries.ts';

export const DIRECTORY_SECTION_LIMIT = 20;

const SECTION_LABELS: Record<string, string> = {
  agent: 'Agent',
  agents: 'Agent',
  company: '公司',
  org: '组织',
  person: '人物',
  task: '任务',
  model: '模型',
  paper: '论文',
  package: 'Package',
  product: '产品',
  project: '项目',
  concept: '概念',
  research: '研究',
  infrastructure: '基础设施',
};

export function subjectSectionLabel(slug: string): string {
  return SECTION_LABELS[slug] || slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function compareSubjectCatalogEntries(a: SubjectCatalogEntry, b: SubjectCatalogEntry): number {
  const priorityA = a.curation_priority || 0;
  const priorityB = b.curation_priority || 0;
  if (priorityA !== priorityB) return priorityB - priorityA;
  const lastSeenA = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
  const lastSeenB = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
  if (lastSeenA !== lastSeenB) return lastSeenB - lastSeenA;
  const mentionA = a.mention_count || 0;
  const mentionB = b.mention_count || 0;
  if (mentionA !== mentionB) return mentionB - mentionA;
  return a.display_name.localeCompare(b.display_name);
}

/** Directory subjects with their live statistics merged in, in directory order. */
export function mergeSubjectStats(subjects: SubjectCatalogEntry[], stats: SubjectStatsRow[]): SubjectCatalogEntry[] {
  const statsBySubject = new Map(stats.map((stat) => [stat.subject_id, stat]));
  return subjects.map((subject) => {
    const stat = statsBySubject.get(subject.id);
    if (!stat) return subject;
    return {
      ...subject,
      mention_count: stat.mention_count ?? subject.mention_count,
      first_seen_at: stat.first_seen_at ?? subject.first_seen_at,
      last_seen_at: stat.last_seen_at ?? subject.last_seen_at,
    };
  }).sort(compareSubjectCatalogEntries);
}

export function buildDirectorySections(subjects: SubjectCatalogEntry[]): SubjectDirectorySection[] {
  const sections = new Map<string, SubjectCatalogEntry[]>();
  for (const subject of subjects) {
    const key = subject.section_slug || subject.type || 'other';
    const list = sections.get(key);
    if (list) list.push(subject);
    else sections.set(key, [subject]);
  }
  return [...sections.entries()]
    .map(([slug, sectionSubjects]) => ({
      slug,
      label: subjectSectionLabel(slug),
      subjects: [...sectionSubjects].sort(compareSubjectCatalogEntries).slice(0, DIRECTORY_SECTION_LIMIT),
    }))
    .filter((section) => section.subjects.length > 0)
    .sort((a, b) => {
      const priorityA = Math.max(...a.subjects.map((s) => s.curation_priority || 0), 0);
      const priorityB = Math.max(...b.subjects.map((s) => s.curation_priority || 0), 0);
      if (priorityA !== priorityB) return priorityB - priorityA;
      if (a.subjects.length !== b.subjects.length) return b.subjects.length - a.subjects.length;
      return a.label.localeCompare(b.label);
    });
}

export function relatedSubjects(all: SubjectCatalogEntry[], subject: SubjectCatalogEntry, limit = 6): SubjectCatalogEntry[] {
  return all
    .filter((candidate) => candidate.id !== subject.id &&
      (candidate.section_slug === subject.section_slug || candidate.type === subject.type))
    .sort(compareSubjectCatalogEntries)
    .slice(0, limit);
}

function dateOnly(value: string | null | undefined): string {
  return String(value || '').slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const mentionDate = (row: SubjectMentionRow) => dateOnly(row.snapshot_date);

/** Mentions older than this many days before the anchor date never affect the statistics. */
export const SIGNAL_WINDOW_DAYS = 60;

/** The first date whose mentions computeSignalStats reads. */
export function signalWindowStart(anchorDate: string): string {
  return addDays(anchorDate, -(SIGNAL_WINDOW_DAYS - 1));
}

/**
 * 30-day signal counts, trend against the 30 days before, and a 14-day
 * sparkline per subject, all ending at `anchorDate` (the latest edition), so
 * every subject and every page measures the same window. `lastSeen` is used
 * for the latest signal time of a subject with no mention in the window.
 */
export function computeSignalStats(
  subjectIds: string[],
  mentions: SubjectMentionRow[],
  anchorDate: string,
  lastSeen: Map<string, string | null> = new Map(),
): Map<string, SubjectSignalStats> {
  const latestDate = anchorDate;
  const currentStart = addDays(latestDate, -29);
  const previousStart = addDays(latestDate, -59);
  const previousEnd = addDays(currentStart, -1);
  const sparkDates = Array.from({ length: 14 }, (_, i) => addDays(latestDate, i - 13));

  const bySubject = new Map<string, SubjectMentionRow[]>();
  for (const mention of mentions) {
    const list = bySubject.get(mention.subject_id);
    if (list) list.push(mention);
    else bySubject.set(mention.subject_id, [mention]);
  }

  const stats = new Map<string, SubjectSignalStats>();
  for (const subjectId of subjectIds) {
    const rows = bySubject.get(subjectId) || [];
    const currentCount = rows.filter((row) => { const d = mentionDate(row); return d >= currentStart && d <= latestDate; }).length;
    const previousCount = rows.filter((row) => { const d = mentionDate(row); return d >= previousStart && d <= previousEnd; }).length;
    const trendPct = previousCount > 0
      ? Math.round(((currentCount - previousCount) / previousCount) * 100)
      : currentCount > 0 ? 100 : 0;
    const latestSignal = [...rows].sort((a, b) =>
      String(b.created_at || b.snapshot_date).localeCompare(String(a.created_at || a.snapshot_date)))[0];
    stats.set(subjectId, {
      subject_id: subjectId,
      signal_count_30d: currentCount,
      previous_signal_count_30d: previousCount,
      trend_pct_30d: trendPct,
      latest_signal_at: latestSignal?.created_at || latestSignal?.snapshot_date || lastSeen.get(subjectId) || null,
      sparkline: sparkDates.map((date) => rows.filter((row) => mentionDate(row) === date).length),
    });
  }
  return stats;
}

export function fallbackSignalStats(subject: SubjectCatalogEntry): SubjectSignalStats {
  return {
    subject_id: subject.id,
    signal_count_30d: subject.mention_count || 0,
    previous_signal_count_30d: 0,
    trend_pct_30d: subject.mention_count ? 100 : 0,
    latest_signal_at: subject.last_seen_at,
    sparkline: [0, 0, 0, 0, 0, 0, subject.mention_count || 0],
  };
}

/** The item ids whose details the newest `limit` signals of one subject need. */
export function sortSignalMentions(mentions: SubjectMentionRow[]): SubjectMentionRow[] {
  return [...mentions].sort((a, b) => {
    const dateDiff = mentionDate(b).localeCompare(mentionDate(a));
    if (dateDiff !== 0) return dateDiff;
    return Number(b.score || 0) - Number(a.score || 0);
  });
}

export function buildSignals(
  sortedMentions: SubjectMentionRow[],
  displayItems: Map<string, DisplaySignalItem>,
  rawItems: Map<string, RawSnapshotSignalItem>,
  limit: number,
): SubjectSignal[] {
  return sortedMentions.slice(0, limit).map((row) => {
    const key = `${row.item_id}:${mentionDate(row)}`;
    const displayItem = displayItems.get(key);
    const rawItem = rawItems.get(key);
    const evidence = row.evidence || {};
    return {
      subject_id: row.subject_id,
      item_id: row.item_id,
      snapshot_date: mentionDate(row),
      source_name: displayItem?.source_name || rawItem?.sub_source_type || row.source_name || (evidence.source_name as string) || null,
      title: displayItem?.processed_title || rawItem?.title || String(evidence.title || evidence.item_title || row.context || row.item_id),
      summary: displayItem?.summary || rawItem?.content || ((evidence.summary || row.context || null) as string | null),
      url: displayItem?.original_url || rawItem?.url || ((evidence.source_url || null) as string | null),
      score: displayItem?.aha_index ?? row.score ?? null,
      rank: displayItem?.rank ?? (typeof evidence.rank === 'number' ? evidence.rank : null),
      confidence: row.confidence ?? null,
      detected_by: row.detected_by ?? null,
      external: Boolean(evidence.external || evidence.source_table === 'web_research'),
    };
  });
}
