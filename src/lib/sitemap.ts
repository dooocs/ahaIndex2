// Sitemap and RSS rendering. Pure functions over data already read: the
// export script feeds them the editions that are actually deployed.
import type { ProcessedItem, SubjectCatalogEntry } from './types.ts';
import type { ArticleRouteItem } from './queries.ts';

export const SITE_URL = 'https://www.amazingindex.com';
export const STATIC_PATHS = ['/', '/about', '/contact', '/feed', '/history', '/privacy', '/terms'];

export type SitemapEntry = { url: string; lastmod?: string };
export type SitemapIndexEntry = { url: string; lastmod?: string };
type SubjectDates = Pick<SubjectCatalogEntry, 'slug' | 'last_seen_at' | 'first_seen_at'>;

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function absoluteUrl(path: string): string {
  return stripTrailingSlash(new URL(path, SITE_URL).toString());
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderUrl(entry: SitemapEntry): string {
  const lastmod = entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : '';
  return `<url><loc>${escapeXml(entry.url)}</loc>${lastmod}</url>`;
}

/** Entries of a urlset this module rendered (the inverse of renderUrlset). */
export function parseUrlset(xml: string): SitemapEntry[] {
  const unescape = (v: string) => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  return [...xml.matchAll(/<url><loc>([^<]*)<\/loc>(?:<lastmod>([^<]*)<\/lastmod>)?<\/url>/g)]
    .map(([, loc, lastmod]) => (lastmod ? { url: unescape(loc), lastmod: unescape(lastmod) } : { url: unescape(loc) }));
}

export function renderUrlset(entries: SitemapEntry[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(renderUrl),
    '</urlset>',
  ].join('');
}

function renderSitemap(entry: SitemapIndexEntry): string {
  const lastmod = entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : '';
  return `<sitemap><loc>${escapeXml(entry.url)}</loc>${lastmod}</sitemap>`;
}

export function renderSitemapIndex(entries: SitemapIndexEntry[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(renderSitemap),
    '</sitemapindex>',
  ].join('');
}

const dateOf = (value: string | null | undefined): string | undefined => value ? value.slice(0, 10) : undefined;

/** `dates`: deployed edition dates, any order. `subjects`: public directory subjects. */
export function getPagesSitemapEntries(dates: string[], subjects: SubjectDates[]): SitemapEntry[] {
  const sortedDates = [...dates].sort();
  const months = [...new Set(sortedDates.map((date) => date.slice(0, 7)))].sort();
  let latestSubject: string | undefined;
  for (const subject of subjects) {
    const candidate = dateOf(subject.last_seen_at) ?? dateOf(subject.first_seen_at);
    if (candidate && (!latestSubject || candidate > latestSubject)) latestSubject = candidate;
  }
  return [
    ...STATIC_PATHS.map((path) => ({ url: absoluteUrl(path) })),
    { url: absoluteUrl('/daily') },
    { url: absoluteUrl('/subjects'), lastmod: latestSubject },
    ...months.map((month) => ({ url: absoluteUrl(`/daily/${month}`) })),
    ...sortedDates.map((date) => ({ url: absoluteUrl(`/daily/${date}`), lastmod: date })),
    ...subjects.map((subject) => ({
      url: absoluteUrl(`/subjects/${subject.slug}`),
      lastmod: dateOf(subject.last_seen_at) ?? dateOf(subject.first_seen_at),
    })),
  ];
}

export function getArticleSitemapPath(year: string): string {
  return `/sitemap-articles-${year}.xml`;
}

/**
 * One entry per article, dated by the newest edition it appears in.
 * `items` must be sorted newest date first (as the queries return them).
 */
export function uniqueArticleItems(items: ArticleRouteItem[]): ArticleRouteItem[] {
  const seen = new Map<string, ArticleRouteItem>();
  for (const item of items) {
    if (item.processed_item_id && !seen.has(item.processed_item_id)) seen.set(item.processed_item_id, item);
  }
  return [...seen.values()];
}

export function getArticleSitemapYears(uniqueItems: ArticleRouteItem[]): string[] {
  return [...new Set(uniqueItems.filter((item) => item.snapshot_date).map((item) => item.snapshot_date.slice(0, 4)))].sort();
}

export function getArticleSitemapEntriesForYear(uniqueItems: ArticleRouteItem[], year: string): SitemapEntry[] {
  return uniqueItems
    .filter((item) => item.snapshot_date?.startsWith(`${year}-`))
    .map((item) => ({ url: absoluteUrl(`/article/${item.processed_item_id}`), lastmod: item.snapshot_date }))
    .sort((a, b) => a.url.localeCompare(b.url));
}

/** `datesNewestFirst`: deployed edition dates. */
export function getSitemapIndexEntries(datesNewestFirst: string[], years: string[]): SitemapIndexEntry[] {
  return [
    { url: absoluteUrl('/sitemap-pages.xml'), lastmod: datesNewestFirst[0] },
    ...years.map((year) => ({
      url: absoluteUrl(getArticleSitemapPath(year)),
      lastmod: datesNewestFirst.find((date) => date.startsWith(`${year}-`)),
    })),
  ];
}

// ─── RSS ────────────────────────────────────────────

function rssPubDate(date: string | null | undefined): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toUTCString() : parsed.toUTCString();
}

function renderRssItem(item: ProcessedItem): string {
  const link = absoluteUrl(`/article/${item.processed_item_id}`);
  return [
    '<item>',
    `<title>${escapeXml(item.processed_title || item.title || 'Untitled')}</title>`,
    `<description>${escapeXml(item.summary || '')}</description>`,
    `<link>${escapeXml(link)}</link>`,
    `<guid isPermaLink="true">${escapeXml(link)}</guid>`,
    `<pubDate>${escapeXml(rssPubDate(item.snapshot_date))}</pubDate>`,
    '</item>',
  ].join('');
}

/** The feed of one edition: the same items, in the same order, as the homepage. */
export function renderRss(items: ProcessedItem[], latestDate: string | null): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '<channel>',
    '<title>AmazingIndex</title>',
    `<link>${escapeXml(absoluteUrl('/'))}</link>`,
    '<description>每日 AI 行业精选简报，过滤噪音，直达洞察。</description>',
    '<language>zh-CN</language>',
    ...(latestDate ? [`<lastBuildDate>${escapeXml(rssPubDate(latestDate))}</lastBuildDate>`] : []),
    ...items.map(renderRssItem),
    '</channel>',
    '</rss>',
  ].join('');
}
