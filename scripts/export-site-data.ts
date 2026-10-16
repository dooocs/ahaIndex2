// Generates everything the site serves besides the Astro-built pages:
//   data/*.json        archive, history, subject and sidebar data for client-rendered pages
//   sitemap*.xml       database data, limited to pages that are deployed
//   rss.xml            the homepage's edition
//   daily/, daily/<YYYY-MM>/   the archive pages, rendered from the archive data
//   subjects/<slug>/   per-URL copies of the built subject shell
//
// node --experimental-strip-types scripts/export-site-data.ts --dist dist --out export \
//   --mode daily|full --inventory .deploy/remote.json [--previous .deploy/previous]
//
// "Deployed" means on the bucket (--inventory, listed at the start of the run)
// or built by this run (--dist): nothing published here points at a page that
// is not there.
//
// A daily export is incremental. The archive data is a ledger of one record
// per edition (src/lib/edition-ledger.ts): it recomputes the records of the
// editions this run built and merges them into the published summary.json,
// archive/index.json and the affected month files (--previous holds copies
// of those, fetched from OSS). Only when there is no previous summary does it
// read every edition once (bootstrap). Subject statistics read the 60-day
// window they cover; article sitemaps are regenerated for the years of the
// built editions only. A full export recomputes everything from the database.
// Writes only to --out.
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createBuildClient } from '../src/lib/supabase.ts';
import * as q from '../src/lib/queries.ts';
import { indexScoreRows } from '../src/lib/archive.ts';
import { editionRecord, mergeRecords, monthlyArchive, type EditionRecord } from '../src/lib/edition-ledger.ts';
import {
  buildDirectorySections,
  buildSignals,
  computeSignalStats,
  mergeSubjectStats,
  relatedSubjects,
  signalWindowStart,
  sortSignalMentions,
} from '../src/lib/subject-data.ts';
import {
  getArticleSitemapEntriesForYear,
  getArticleSitemapPath,
  getPagesSitemapEntries,
  getSitemapIndexEntries,
  parseUrlset,
  renderRss,
  SITE_URL,
  renderSitemapIndex,
  renderUrlset,
  uniqueArticleItems,
} from '../src/lib/sitemap.ts';
import {
  archiveIndexJson,
  archiveMonthJson,
  articleKey,
  assertStillDeployed,
  editionKey,
  fillShell,
  fillSlots,
  historyJson,
  monthShellMeta,
  parseDataFile,
  subjectIndexJson,
  subjectJson,
  subjectShellMeta,
  summaryJson,
  type ArchiveIndexJson,
  type ArchiveMonthJson,
  type SummaryJson,
  yearShellMeta,
} from '../src/lib/site-export.ts';
import {
  esc,
  monthLabel,
  renderDistribution,
  renderGlobalStats,
  renderMonthCount,
  renderMonthGrid,
  renderMonthIndex,
  renderMonthNav,
  renderMonthWeeks,
  renderYearRail,
} from '../src/lib/archive-render.ts';
import type { MonthlyArchive } from '../src/lib/types.ts';
import { readInventory } from './lib/inventory.mjs';

const SIGNAL_LIMIT = 12;
const RELATED_LIMIT = 8;
// One URL path segment and one OSS key segment: production slugs look like
// "company:xiaomi". Anything that would change the path is refused.
const SAFE_SEGMENT = /^(?!\.{1,2}$)[^/\\?#%\s\u0000-\u001f]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const { values: args } = parseArgs({
  options: {
    dist: { type: 'string', default: 'dist' },
    out: { type: 'string', default: 'export' },
    mode: { type: 'string', default: 'full' },
    inventory: { type: 'string' },
    previous: { type: 'string' },
  },
});
const mode = args.mode === 'daily' ? 'daily' : 'full';
const dist = path.resolve(args.dist!);
const out = path.resolve(args.out!);
const log = (message: string) => console.info(`[export] ${message}`);
const started = performance.now();

async function readIfExists(file: string): Promise<string | null> {
  return readFile(file, 'utf8').catch((error) => (error.code === 'ENOENT' ? null : Promise.reject(error)));
}
async function isFile(file: string) {
  return Boolean((await stat(file).catch(() => null))?.isFile());
}
async function write(rel: string, content: string) {
  const file = path.join(out, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}
const json = (value: unknown) => JSON.stringify(value);
const byNewest = (a: string, b: string) => b.localeCompare(a);

/** Edition dates whose pages this run built, newest first. */
async function builtDates(): Promise<string[]> {
  const entries = await readdir(path.join(dist, 'daily'), { withFileTypes: true }).catch(() => []);
  const dates: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && DATE.test(entry.name) && await isFile(path.join(dist, 'daily', entry.name, 'index.html'))) dates.push(entry.name);
  }
  return dates.sort(byNewest);
}

const db = createBuildClient(process.env.SUPABASE_URL, process.env.SUPABASE_BUILD_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
if (mode === 'daily' && !args.inventory) throw new Error('A daily export needs --inventory to know which pages are deployed');
const inventory = args.inventory ? await readInventory(args.inventory) : new Map<string, string | null>();

const built = await builtDates();
if (built.length === 0) throw new Error(`No edition pages found in ${dist}/daily`);
const homeDate = built[0];

const itemsCache = new Map<string, ReturnType<typeof q.getItemsByDate>>();
const itemsOf = (date: string) => {
  if (!itemsCache.has(date)) itemsCache.set(date, q.getItemsByDate(db, date));
  return itemsCache.get(date)!;
};

// ─── Archive ledger ─────────────────────────────────
const previous = (rel: string) => (args.previous ? readIfExists(path.join(args.previous, rel)) : Promise.resolve(null));
const previousSummary = mode === 'daily' ? parseDataFile<SummaryJson>(await previous('data/summary.json'), 'summary.json') : null;

let records: EditionRecord[];       // records of the months this export writes
let monthsToWrite: string[];
let summary: SummaryJson;
let monthSummaries: MonthlyArchive[];

function indexToRecords(rows: q.ScoreRow[]): EditionRecord[] {
  return [...indexScoreRows(rows)].map(([date, dayRows]) => editionRecord(date, dayRows));
}


// Every page any existing file lists must still be there: listed in the
// inventory or built now. Nothing is silently dropped from published data.
const deployedKeys = new Set(inventory.keys());
for (const date of built) deployedKeys.add(editionKey(date));
for (const pid of await readdir(path.join(dist, 'article')).catch(() => [])) deployedKeys.add(articleKey(pid));
const isListed = (key: string) => deployedKeys.has(key);

if (previousSummary) {
  // Incremental: the built editions, merged into what is published.
  assertStillDeployed(previousSummary.editions.map((e) => editionKey(e.date)), isListed, 'previously published editions are');
  const updates = indexToRecords(await q.getScoreRowsForDates(db, built));
  monthsToWrite = [...new Set(updates.map((r) => r.date.slice(0, 7)))].sort(byNewest);
  records = [];
  for (const month of monthsToWrite) {
    const previousMonth = parseDataFile<ArchiveMonthJson>(await previous(`data/archive/${month}.json`), `archive/${month}.json`);
    let base = previousMonth?.records ?? [];
    if (!previousMonth) {
      // No published month file yet: read that month's other editions once.
      const others = previousSummary.editions.filter((e) => e.date.startsWith(month) && !built.includes(e.date)).map((e) => e.date);
      base = indexToRecords(await q.getScoreRowsForDates(db, others));
    }
    assertStillDeployed(base.map((r) => editionKey(r.date)), isListed, `editions in archive/${month}.json are`);
    records.push(...mergeRecords(base.filter((r) => r.date.startsWith(month)), updates.filter((r) => r.date.startsWith(month))));
  }
  const editions = new Map(previousSummary.editions.map((e) => [e.date, e]));
  for (const r of updates) editions.set(r.date, { date: r.date, score: r.score, count: r.count });
  summary = summaryJson([...editions.values()]);
  const previousIndex = parseDataFile<ArchiveIndexJson>(await previous('data/archive/index.json'), 'archive/index.json');
  const months = new Map((previousIndex?.years ?? []).flatMap((y) => y.months).map((m) => [m.month.slice(0, 7), m]));
  for (const month of monthsToWrite) months.set(month, monthlyArchive(month, records.filter((r) => r.date.startsWith(month))));
  monthSummaries = [...months.values()];
  log(`incremental: ${updates.length} edition record(s) into ${monthsToWrite.join(', ')}; ${summary.editions.length} editions published`);
} else {
  // Full export, or the first daily export: every edition, read once. Every
  // database edition must have a page; a daily run that finds one missing
  // stops (a backfill run builds it), rather than leaving it out.
  const allRows = await q.getScoreRows(db);
  records = indexToRecords(allRows);
  assertStillDeployed(records.map((r) => editionKey(r.date)), isListed, 'database editions are');
  monthsToWrite = [...new Set(records.map((r) => r.date.slice(0, 7)))].sort(byNewest);
  summary = summaryJson(records);
  monthSummaries = monthsToWrite.map((month) => monthlyArchive(month, records.filter((r) => r.date.startsWith(month))));
  log(`${mode === 'daily' ? 'bootstrap' : 'full'}: ${records.length} editions from the database`);
}
if (summary.latest_date !== homeDate) throw new Error(`Newest published edition ${summary.latest_date} is not the newest built one ${homeDate}`);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await write('data/summary.json', json(summary));
await write('data/archive/index.json', json(archiveIndexJson(monthSummaries, summary)));
for (const month of monthsToWrite) await write(`data/archive/${month}.json`, json(archiveMonthJson(month, records.filter((r) => r.date.startsWith(month)))));

const historyItems = [];
for (const { date } of summary.editions.slice(0, 5)) historyItems.push(...await itemsOf(date));
await write('data/history.json', json(historyJson(historyItems)));
await write('rss.xml', renderRss(await itemsOf(homeDate), homeDate));

// ─── Subjects ───────────────────────────────────────
const [subjectRows, subjectStats] = await Promise.all([q.getDirectorySubjectRows(db), q.getSubjectStats(db)]);
// A slug that is not a safe path segment gets no page, so it is left out everywhere.
const sections = buildDirectorySections(mergeSubjectStats(subjectRows, subjectStats))
  .map((section) => ({
    ...section,
    subjects: section.subjects.filter((subject) => {
      if (SAFE_SEGMENT.test(subject.slug)) return true;
      const message = `subject ${JSON.stringify(subject.slug)} has a slug that is not a single URL path segment; it gets no page`;
      console.log(process.env.GITHUB_ACTIONS ? `::warning::${message}` : `[export] warning: ${message}`);
      return false;
    }),
  }))
  .filter((section) => section.subjects.length > 0);
const publicSubjects = sections.flatMap((s) => s.subjects);
const subjectIds = publicSubjects.map((s) => s.id);
// Every subject's 30-day window ends at the newest published edition.
const anchor = summary.latest_date!;
const since = signalWindowStart(anchor);
const mentions = await q.fetchSubjectMentions(db, subjectIds, since);
const lastSeen = new Map(publicSubjects.map((s) => [s.id, s.last_seen_at]));
const stats = computeSignalStats(subjectIds, mentions, anchor, lastSeen);
await write('data/subjects/index.json', json(subjectIndexJson(sections, stats, anchor)));

const mentionsBySubject = new Map<string, typeof mentions>();
for (const m of mentions) {
  const list = mentionsBySubject.get(m.subject_id);
  if (list) list.push(m);
  else mentionsBySubject.set(m.subject_id, [m]);
}
const signalMentions = new Map<string, typeof mentions>();
for (const subject of publicSubjects) {
  let sorted = sortSignalMentions(mentionsBySubject.get(subject.id) || []);
  // Quiet subjects: the newest signals may predate the window.
  if (sorted.length < SIGNAL_LIMIT) sorted = [...sorted, ...sortSignalMentions(await q.fetchMentionsBefore(db, subject.id, since, SIGNAL_LIMIT - sorted.length))];
  signalMentions.set(subject.id, sorted);
}
const signalItemIds = [...signalMentions.values()].flatMap((rows) => rows.slice(0, SIGNAL_LIMIT).map((r) => r.item_id)).filter(Boolean);
const [displayItems, rawItems, insights] = await Promise.all([
  q.loadDisplaySignalItems(db, signalItemIds),
  q.loadRawSnapshotSignalItems(db, signalItemIds),
  q.getSubjectInsightsFor(db, subjectIds),
]);
const subjectShell = await readFile(path.join(dist, 'shell/subject/index.html'), 'utf8');
for (const subject of publicSubjects) {
  const signals = buildSignals(signalMentions.get(subject.id) || [], displayItems, rawItems, SIGNAL_LIMIT);
  const related = relatedSubjects(publicSubjects, subject, RELATED_LIMIT);
  await write(`data/subjects/${subject.slug}.json`, json(subjectJson(subject, stats.get(subject.id), signals, insights.get(subject.id) || [], related)));
  await write(`subjects/${subject.slug}/index.html`, fillShell(subjectShell, subjectShellMeta(subject)));
}

// ─── Archive pages, rendered into the HTML ──────────
// /daily and every /daily/<YYYY-MM> are written on every run, daily and full,
// with their content in the page (crawlers and readers without JavaScript see
// the links). Unchanged copies are not uploaded again. A daily run renders
// the months it did not touch from their published files (run-deploy.sh
// fetches every month file into --previous); a month file it cannot read is
// recomputed from the database and published again.
const publishedMonths = [...new Set(summary.editions.map((e) => e.date.slice(0, 7)))].sort(byNewest);
const latest = summary.latest_date!;
const now = { year: Number(latest.slice(0, 4)), month: Number(latest.slice(5, 7)) };
const archiveIndex = archiveIndexJson(monthSummaries, summary);
const globalStatsHtml = renderGlobalStats(summary.stats);

async function monthData(month: string): Promise<ArchiveMonthJson> {
  if (monthsToWrite.includes(month)) return archiveMonthJson(month, records.filter((r) => r.date.startsWith(month)));
  const published = parseDataFile<ArchiveMonthJson>(await previous(`data/archive/${month}.json`), `archive/${month}.json`);
  if (published) return published;
  log(`archive/${month}.json not fetched: recomputing it from the database`);
  const dates = summary.editions.filter((e) => e.date.startsWith(month)).map((e) => e.date);
  const recomputed = archiveMonthJson(month, indexToRecords(await q.getScoreRowsForDates(db, dates)));
  await write(`data/archive/${month}.json`, json(recomputed));
  return recomputed;
}

const monthShell = await readFile(path.join(dist, 'shell/daily-month/index.html'), 'utf8');
for (const month of publishedMonths) {
  const data = await monthData(month);
  const label = monthLabel(month);
  await write(`daily/${month}/index.html`, fillSlots(fillShell(monthShell, monthShellMeta(month)), {
    'month-crumb': esc(label),
    'month-title': esc(label),
    'month-count': renderMonthCount(data),
    weeks: renderMonthWeeks(data),
    'month-nav': renderMonthNav(month, publishedMonths),
    'global-stats': globalStatsHtml,
  }));
}

const yearShell = await readFile(path.join(dist, 'shell/daily-year/index.html'), 'utf8');
const newestYear = archiveIndex.years[0];
await write('daily/index.html', fillSlots(fillShell(yearShell, yearShellMeta()), {
  'year-rail': renderYearRail(archiveIndex.years.map((y) => y.year), newestYear.year),
  'month-grid': renderMonthGrid(newestYear.year, newestYear.months, now),
  'month-index': renderMonthIndex(archiveIndex.years.flatMap((y) => y.months)),
  'global-stats': globalStatsHtml,
  distribution: renderDistribution(newestYear.months),
}));
log(`archive pages: /daily and ${publishedMonths.length} month page(s) rendered`);

// ─── Sitemaps ───────────────────────────────────────
const publishedDates = summary.editions.map((e) => e.date);
const allYears = [...new Set(publishedDates.map((d) => d.slice(0, 4)))].sort(byNewest);
const pidOf = (url: string) => url.slice(`${SITE_URL}/article/`.length);

// pid → the date it is listed under, per year file this export writes.
const articleYears = new Map<string, Map<string, string>>();
const yearOf = (year: string) => {
  if (!articleYears.has(year)) articleYears.set(year, new Map());
  return articleYears.get(year)!;
};
async function addFromDatabase(year: string) {
  for (const item of uniqueArticleItems(await q.getArticleRouteItemsBetween(db, `${year}-01-01`, `${year}-12-31`))) {
    if (isListed(articleKey(item.processed_item_id))) yearOf(year).set(item.processed_item_id, item.snapshot_date);
  }
}

if (mode === 'full') {
  for (const item of uniqueArticleItems(await q.getAllArticleRouteItems(db))) {
    if (isListed(articleKey(item.processed_item_id))) yearOf(item.snapshot_date.slice(0, 4)).set(item.processed_item_id, item.snapshot_date);
  }
} else {
  // The articles this run built, each dated by the newest edition it appears in.
  const builtPids = (await Promise.all(built.map(itemsOf))).flat().map((item) => item.processed_item_id);
  const builtSet = new Set(built);
  const routes = uniqueArticleItems(await q.getArticleRouteItemsFor(db, builtPids)).filter((r) => builtSet.has(r.snapshot_date));
  for (const year of [...new Set(routes.map((r) => r.snapshot_date.slice(0, 4)))]) {
    const published = await previous(getArticleSitemapPath(year).slice(1));
    if (published === null) {
      await addFromDatabase(year);
      log(`article sitemap ${year}: no published file, read from the database`);
      continue;
    }
    const entries = parseUrlset(published);
    assertStillDeployed(entries.map(({ url }) => articleKey(pidOf(url))), isListed, `articles in ${getArticleSitemapPath(year).slice(1)} are`);
    for (const { url, lastmod } of entries) if (lastmod) yearOf(year).set(pidOf(url), lastmod);
  }
  for (const route of routes) {
    for (const [year, entries] of articleYears) if (year !== route.snapshot_date.slice(0, 4)) entries.delete(route.processed_item_id);
    yearOf(route.snapshot_date.slice(0, 4)).set(route.processed_item_id, route.snapshot_date);
  }
}
// A year whose file is on neither the bucket nor this export: read it once.
for (const year of allYears) {
  if (!articleYears.has(year) && !inventory.has(getArticleSitemapPath(year).slice(1))) await addFromDatabase(year);
}
let articleCount = 0;
for (const [year, entries] of articleYears) {
  const items = [...entries].map(([pid, date]) => ({ id: pid, processed_item_id: pid, snapshot_date: date }));
  articleCount += items.length;
  await write(getArticleSitemapPath(year), renderUrlset(getArticleSitemapEntriesForYear(items, year)));
}
await write('sitemap.xml', renderSitemapIndex(getSitemapIndexEntries(publishedDates, [...allYears].sort())));
await write('sitemap-pages.xml', renderUrlset(getPagesSitemapEntries(publishedDates, publicSubjects)));

log(`mode=${mode} built=${built.length} published_editions=${publishedDates.length} months_written=${monthsToWrite.length} subjects=${publicSubjects.length} mentions=${mentions.length} article_years=${[...articleYears.keys()].join(',')} articles=${articleCount} in ${Math.round(performance.now() - started)}ms`);
