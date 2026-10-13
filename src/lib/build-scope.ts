// Which pages this build renders. BUILD_MODE=full (default) renders the whole
// site. BUILD_MODE=daily renders the homepage, the editions in BUILD_DATES
// (comma-separated, from scripts/plan-build.ts) and their articles; pages
// that are published from the export script or only rebuilt in full mode
// render nothing.
const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
