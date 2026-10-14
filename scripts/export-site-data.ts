// Generates everything the site serves besides the Astro-built pages:
//   data/*.json        archive, history, subject and sidebar data for client-rendered pages
//   sitemap*.xml       limited to editions that are deployed
//   rss.xml            the homepage's edition
//   daily/<YYYY-MM>/, subjects/<slug>/   per-URL copies of the built shell pages
//   _deploy/manifest.json                 the deployed editions, for the next daily build
//
// node --experimental-strip-types scripts/export-site-data.ts \
//   --dist dist --out export --mode daily|full [--prev-manifest .deploy/manifest.prev.json]
//
// Reads the news database with SUPABASE_URL / SUPABASE_BUILD_KEY. Writes only to --out.
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createBuildClient } from '../src/lib/supabase.ts';
import * as q from '../src/lib/queries.ts';
import { indexScoreRows } from '../src/lib/archive.ts';
import {
  buildDirectorySections,
  buildSignals,
  computeSignalStats,
  mergeSubjectStats,
  relatedSubjects,
  sortSignalMentions,
} from '../src/lib/subject-data.ts';
import {
  getArticleSitemapEntriesForYear,
  getArticleSitemapPath,
  getArticleSitemapYears,
  getPagesSitemapEntries,
  getSitemapIndexEntries,
  renderRss,
  renderSitemapIndex,
  renderUrlset,
  uniqueArticleItems,
} from '../src/lib/sitemap.ts';
import {
  DATA_VERSION,
  archiveIndexJson,
  archiveMonthJson,
  fillShell,
  historyJson,
  mergeDeployedDates,
  monthShellMeta,
  parseManifest,
  restrictIndex,
  subjectIndexJson,
  subjectJson,
  subjectShellMeta,
  summaryJson,
  type DeployManifest,
} from '../src/lib/site-export.ts';

const SIGNAL_LIMIT = 12;
const RELATED_LIMIT = 8;
const SAFE_SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const { values: args } = parseArgs({
  options: {
    dist: { type: 'string', default: 'dist' },
    out: { type: 'string', default: 'export' },
    mode: { type: 'string', default: 'full' },
    'prev-manifest': { type: 'string' },
  },
});
const mode = args.mode === 'daily' ? 'daily' : 'full';
const dist = path.resolve(args.dist!);
const out = path.resolve(args.out!);

const log = (message: string) => console.info(`[export] ${message}`);
const started = performance.now();

async function readIfExists(file: string | undefined): Promise<string | null> {
  if (!file) return null;
  return readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

async function write(rel: string, content: string) {
  const file = path.join(out, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

const json = (value: unknown) => JSON.stringify(value);

/** Edition dates whose pages this run built. */
async function builtDates(): Promise<string[]> {
  const entries = await readdir(path.join(dist, 'daily'), { withFileTypes: true }).catch(() => []);
  const dates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !DATE.test(entry.name)) continue;
    if ((await stat(path.join(dist, 'daily', entry.name, 'index.html')).catch(() => null))?.isFile()) dates.push(entry.name);
  }
  return dates;
}

const db = createBuildClient(process.env.SUPABASE_URL, process.env.SUPABASE_BUILD_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
const previous = parseManifest(await readIfExists(args['prev-manifest']));
if (mode === 'daily' && !previous) throw new Error('A daily export needs the previous deploy manifest');

const built = await builtDates();
if (built.length === 0) throw new Error(`No edition pages found in ${dist}/daily`);

// ─── Editions ───────────────────────────────────────
const fullIndex = indexScoreRows(await q.getScoreRows(db));
const deployed = mergeDeployedDates(previous?.dates ?? [], built, [...fullIndex.keys()]);
const index = restrictIndex(fullIndex, deployed);
// The homepage shows the newest edition this run built; RSS must match it.
const homeDate = [...built].sort().at(-1)!;
log(`mode=${mode} built=${built.length} deployed=${deployed.length} home=${homeDate}`);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await write('data/summary.json', json(summaryJson(index)));
const archiveIndex = archiveIndexJson(index);
await write('data/archive/index.json', json(archiveIndex));
const months = [...new Set(deployed.map((d) => d.slice(0, 7)))];
for (const month of months) await write(`data/archive/${month}.json`, json(archiveMonthJson(index, month)));

const historyItems = [];
for (const date of deployed.slice(0, 5)) historyItems.push(...await q.getItemsByDate(db, date));
await write('data/history.json', json(historyJson(historyItems)));

const homeItems = await q.getItemsByDate(db, homeDate);
await write('rss.xml', renderRss(homeItems, homeDate));

// ─── Subjects ───────────────────────────────────────
const [subjectRows, subjectStats] = await Promise.all([q.getDirectorySubjectRows(db), q.getSubjectStats(db)]);
// A slug that is not a safe path segment gets no page, so it is left out everywhere.
const sections = buildDirectorySections(mergeSubjectStats(subjectRows, subjectStats))
  .map((section) => ({
    ...section,
    subjects: section.subjects.filter((subject) => {
      if (SAFE_SEGMENT.test(subject.slug)) return true;
      log(`skip subject with unsafe slug ${JSON.stringify(subject.slug)}`);
      return false;
    }),
  }))
  .filter((section) => section.subjects.length > 0);
const publicSubjects = sections.flatMap((s) => s.subjects);
const mentions = await q.fetchSubjectMentions(db, publicSubjects.map((s) => s.id));
await write('data/subjects/index.json', json(subjectIndexJson(sections, computeSignalStats(publicSubjects.map((s) => s.id), mentions, homeDate), homeDate)));

const mentionsBySubject = new Map<string, typeof mentions>();
for (const m of mentions) {
  const list = mentionsBySubject.get(m.subject_id);
  if (list) list.push(m);
  else mentionsBySubject.set(m.subject_id, [m]);
}
const sortedBySubject = new Map(publicSubjects.map((s) => [s.id, sortSignalMentions(mentionsBySubject.get(s.id) || [])]));
const signalItemIds = [...sortedBySubject.values()].flatMap((rows) => rows.slice(0, SIGNAL_LIMIT).map((r) => r.item_id)).filter(Boolean);
const [displayItems, rawItems] = await Promise.all([
  q.loadDisplaySignalItems(db, signalItemIds),
  q.loadRawSnapshotSignalItems(db, signalItemIds),
]);
const subjectShell = await readFile(path.join(dist, 'shell/subject/index.html'), 'utf8');
for (const subject of publicSubjects) {
  const own = mentionsBySubject.get(subject.id) || [];
  const stats = computeSignalStats([subject.id], own, homeDate).get(subject.id);
  const signals = buildSignals(sortedBySubject.get(subject.id) || [], displayItems, rawItems, SIGNAL_LIMIT);
  const insights = await q.getSubjectInsights(db, subject.id);
  const related = relatedSubjects(publicSubjects, subject, RELATED_LIMIT);
  await write(`data/subjects/${subject.slug}.json`, json(subjectJson(subject, stats, signals, insights, related)));
  await write(`subjects/${subject.slug}/index.html`, fillShell(subjectShell, subjectShellMeta(subject)));
}

// ─── Archive month pages ────────────────────────────
const monthShell = await readFile(path.join(dist, 'shell/daily-month/index.html'), 'utf8');
for (const month of months) await write(`daily/${month}/index.html`, fillShell(monthShell, monthShellMeta(month)));

// ─── Sitemaps ───────────────────────────────────────
const deployedSet = new Set(deployed);
const articles = uniqueArticleItems((await q.getAllArticleRouteItems(db)).filter((item) => deployedSet.has(item.snapshot_date)));
const years = getArticleSitemapYears(articles);
await write('sitemap.xml', renderSitemapIndex(getSitemapIndexEntries(deployed, years)));
await write('sitemap-pages.xml', renderUrlset(getPagesSitemapEntries(deployed, publicSubjects)));
for (const year of years) await write(getArticleSitemapPath(year), renderUrlset(getArticleSitemapEntriesForYear(articles, year)));

// ─── Manifest (uploaded last by the deploy script) ──
const manifest: DeployManifest = {
  v: DATA_VERSION,
  dates: deployed,
  latest_date: deployed[0] ?? null,
  mode,
  commit: process.env.GITHUB_SHA || null,
  generated_at: new Date().toISOString(),
};
await write('_deploy/manifest.json', json(manifest));

log(`wrote months=${months.length} subjects=${publicSubjects.length} articles=${articles.length} in ${Math.round(performance.now() - started)}ms`);
