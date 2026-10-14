// Which pages this build renders. BUILD_MODE=full (default) renders the whole
// site. BUILD_MODE=daily renders the homepage, the editions in BUILD_DATES
// (comma-separated, from scripts/plan-build.ts) and their articles; pages
// that are published from the export script or only rebuilt in full mode
// render nothing.
import { readFileSync } from 'node:fs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EDITION_KEY = /^daily\/(\d{4}-\d{2}-\d{2})\/index\.html$/;

export function isDailyBuild(): boolean {
  return process.env.BUILD_MODE === 'daily';
}

/** Explicit daily edition dates, newest first. Empty = let the build choose. */
export function scopeDatesFromEnv(): string[] {
  const dates = (process.env.BUILD_DATES || '').split(',').map((d) => d.trim()).filter(Boolean);
  const invalid = dates.filter((d) => !DATE.test(d));
  if (invalid.length > 0) throw new Error(`BUILD_DATES has invalid dates: ${invalid.join(', ')}`);
  return [...new Set(dates)].sort().reverse();
}

let deployed: Set<string> | null | undefined;

/**
 * Edition dates whose page is on the bucket, from the inventory file named by
 * DEPLOY_INVENTORY (scripts/lib/inventory.mjs). Null when not given (local
 * builds): links then follow the database alone.
 */
export function deployedEditionDates(): Set<string> | null {
  if (deployed !== undefined) return deployed;
  const file = process.env.DEPLOY_INVENTORY;
  if (!file) return (deployed = null);
  const { objects } = JSON.parse(readFileSync(file, 'utf8'));
  deployed = new Set(Object.keys(objects).map((key) => key.match(EDITION_KEY)?.[1]).filter((d): d is string => Boolean(d)));
  return deployed;
}
