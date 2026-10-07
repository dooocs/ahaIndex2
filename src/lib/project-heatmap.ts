import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProjectHeatmapRow } from './types';

const TABLE = 'project_heatmap_data';
const COLUMNS = [
  'id', 'subject_id', 'subject_slug', 'subject_name', 'subject_type',
  'track_id', 'track_name', 'track_group', 'snapshot_date', 'score_100',
  'role', 'source_name', 'tags', 'summary', 'first_seen_at', 'last_seen_at',
  'mention_count', 'related_data',
].join(',');
const MAX_ATTEMPTS = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface ReadOptions {
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export async function fetchProjectHeatmapData(
  client: SupabaseClient,
  { log = console.info, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }: ReadOptions = {},
): Promise<ProjectHeatmapRow[]> {
  const rows: ProjectHeatmapRow[] = [];
  const started = performance.now();
  let cursor: string | undefined;
  let pageSize = 500;
  let page = 1;
  let maxPageMs = 0;

  while (true) {
    let batch: ProjectHeatmapRow[] | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const pageStarted = performance.now();
      let query = client.from(TABLE).select(COLUMNS).order('id', { ascending: true }).limit(pageSize);
      if (cursor) query = query.gt('id', cursor);

      const { data, error, status } = await query.abortSignal(AbortSignal.timeout(20_000));
      const elapsedMs = Math.round(performance.now() - pageStarted);
      const context = `table=${TABLE} page=${page} cursor=${cursor ?? 'start'} limit=${pageSize} attempt=${attempt} elapsed_ms=${elapsedMs}`;

      if (!error) {
        if (!Array.isArray(data)) throw new Error(`[build-data] ${context} missing response data`);
        batch = data as unknown as ProjectHeatmapRow[];
        maxPageMs = Math.max(maxPageMs, elapsedMs);
        log(`[build-data] ${context} rows=${batch.length} total=${rows.length + batch.length}`);
        break;
      }

      const timedOut = error.code === '57014' || /timeout|timed out/i.test(error.message);
      const retryable = timedOut || status === 0 || status === 429 || status >= 500;
      log(`[build-data] ${context} status=${status} code=${error.code || 'transport_error'}`);
      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw new Error(`[build-data] ${context} failed status=${status} code=${error.code || 'transport_error'}: ${error.message}`);
      }

      // Keep the same cursor until the complete page succeeds.
      if (timedOut) pageSize = Math.max(100, Math.floor(pageSize / 2));
      await sleep(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
    }

    if (!batch) throw new Error(`[build-data] ${TABLE} page ${page} returned no result`);
    let nextCursor = cursor;
    for (const row of batch) {
      if (!UUID.test(row.id) || (nextCursor && row.id <= nextCursor)) {
        throw new Error(`[build-data] ${TABLE} page ${page} returned a missing, duplicate or out-of-order id`);
      }
      nextCursor = row.id;
    }
    rows.push(...batch);
    cursor = nextCursor;
    if (batch.length < pageSize) break;
    page++;
  }

  log(`[build-data] table=${TABLE} complete rows=${rows.length} pages=${page} max_page_ms=${maxPageMs} elapsed_ms=${Math.round(performance.now() - started)}`);
  return rows;
}
