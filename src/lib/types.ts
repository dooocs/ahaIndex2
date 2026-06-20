export interface DisplayMetric {
  label: string;
  value: string;
}

export interface DisplayMetrics {
  items: DisplayMetric[];
}

export interface ProcessedItem {
  id: string;
  processed_item_id: string;
  snapshot_date: string;
  source_name: string;
  content_type: string;
  title?: string;
  url?: string;
  original_url?: string;
  author: string | null;
  processed_title?: string | null;
  summary: string | null;
  category: string | null;
  tags: string[] | null;
  keywords: string[] | null;
  aha_index: number;
  expert_insight: string | null;
  display_metrics: DisplayMetrics | null;
  raw_metrics: any | null;
  extra?: any | null;
  rank: number;
  model: string | null;
  created_at: string | null;
}

export interface MonthlyArchive {
  month: string;
  edition_count: number;
  item_count: number;
  avg_aha_score: number;
  peak_aha_score: number;
  peak_date: string;
  summary: string;
  meta_description: string;
  top_story_title?: string;
}

export interface WeeklyArchive {
  year: number;
  week_number: number;
  start_date: string;
  end_date: string;
  edition_count: number;
  item_count: number;
  avg_aha_score: number;
  peak_aha_score: number;
  peak_date: string;
}

export interface DailyArchive {
  snapshot_date: string;
  aha_score: number;
  aha_delta: string;
  item_count: number;
  top_story_title: string;
  top_story_source: string;
  top_tags: string[];
  rarity_score: number;
  timeliness_score: number;
  impact_score: number;
  percentile_90d?: number | null;
  percentile_tier?: string | null;
  sample_size_90d?: number | null;
}

export interface GlobalStats {
  total_editions: number;
  total_items: number;
  avg_aha_score: number;
  peak_aha_score: number;
}

// ─── Project Heatmap types ──────────────────────────────

export interface ProjectHeatmapRow {
  subject_id: string;
  subject_slug: string;
  subject_name: string;
  subject_type: string;
  track_id: string | null;
  track_name: string | null;
  track_group: string | null;
  snapshot_date: string;
  score: number | null;
  score_100: number | null;
  role: string | null;
  source_name: string | null;
  tags: string[] | null;
  summary: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  mention_count: number | null;
  related_data: RelatedData | null;
}

export interface RelatedData {
  related: RelatedProject[];
  competitors: CompetitorEntry[];
}

export interface TimelineEntry {
  date: string;
  aha: number;
  role?: string;
  source_name?: string;
}

export interface RelatedProject {
  subject_id: string;
  slug: string;
  display_name: string;
  strength: number;
  kind: string;
  co_appearances: number;
  timeline: { date: string; aha: number }[];
}

export interface CompetitorEntry {
  subject_id: string;
  slug: string;
  display_name: string;
  strength: number;
  kind: string;
  co_appearances: number;
  source: string;
  aha_current: number;
  overlap_tags: string[];
  diff: string;
}

export interface ProjectEntry {
  subject_id: string;
  slug: string;
  display_name: string;
  type: string;
  tags: string[];
  summary: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  mention_count: number;
  track_id: string | null;
  track_name: string | null;
  track_group: string | null;
  aha_current: number;
  aha_peak: number;
  delta: string;
  appearances: number;
  rank: number;
  timeline: TimelineEntry[];
  related: RelatedProject[];
  competitors: CompetitorEntry[];
}

export interface TrackInfo {
  id: string;
  slug: string;
  display_name: string;
  display_name_en: string;
  group_name: string;
  description: string;
  cover_color: string;
  display_order: number;
}

export interface SubjectStatsRow {
  subject_id: string;
  mention_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  item_count: number;
}

// ─── Subject V2 types ─────────────────────────────────

export interface SubjectCatalogEntry {
  id: string;
  slug: string;
  type: string;
  display_name: string;
  aliases: string[];
  description: string | null;
  definition: string | null;
  homepage_url: string | null;
  metadata: Record<string, any> | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  mention_count: number;
  status: string;
  directory_visible: boolean;
  section_slug: string | null;
  curation_priority: number;
  created_by: string | null;
}

export interface SubjectInsight {
  id: string;
  subject_id: string;
  snapshot_date: string | null;
  module_type: 'timeline' | 'highlight' | 'comparison';
  insight_key: string;
  title: string;
  summary: string | null;
  analysis: string | null;
  event_date: string | null;
  comparison_subject_ids: string[];
  dimensions_json: Record<string, any> | null;
  importance_score: number | null;
  confidence: number | null;
  evidence_item_ids: string[];
  evidence_refs_json: Record<string, any> | null;
  related_subject_ids: string[];
  generated_by: string;
  generator_version: string;
  status: 'draft' | 'published' | 'hidden';
  published_at: string | null;
}

export interface SubjectDirectorySection {
  slug: string;
  label: string;
  subjects: SubjectCatalogEntry[];
}
