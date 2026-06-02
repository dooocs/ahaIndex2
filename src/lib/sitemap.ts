import { getAllDates, getAllItems } from './data';
import type { ProcessedItem } from './types';

const SITE_URL = 'https://www.amazingindex.com';
const STATIC_PATHS = ['/', '/about', '/contact', '/history', '/privacy', '/terms'];

export type SitemapEntry = {
  url: string;
  lastmod?: string;
};

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function absoluteUrl(path: string): string {
  return stripTrailingSlash(new URL(path, SITE_URL).toString());
}

function escapeXml(value: string): string {
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

export function renderUrlset(entries: SitemapEntry[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(renderUrl),
    '</urlset>',
  ].join('');
}

export function sitemapResponse(xml: string): Response {
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
}

export function getStaticSitemapEntries(): SitemapEntry[] {
  return STATIC_PATHS.map((path) => ({ url: absoluteUrl(path) }));
}

function getDailySitemapEntries(dates: string[]): SitemapEntry[] {
  const sortedDates = [...dates].sort();
  const months = [...new Set(sortedDates.map((date) => date.slice(0, 7)))].sort();

  return [
    ...months.map((month) => ({ url: absoluteUrl(`/daily/${month}`) })),
    ...sortedDates.map((date) => ({
      url: absoluteUrl(`/daily/${date}`),
      lastmod: date,
    })),
  ];
}

export async function getPagesSitemapEntries(): Promise<SitemapEntry[]> {
  const dates = await getAllDates();

  return [
    ...getStaticSitemapEntries(),
    { url: absoluteUrl('/daily') },
    ...getDailySitemapEntries(dates),
  ];
}

function getUniqueArticleItems(items: ProcessedItem[]): ProcessedItem[] {
  const seen = new Map<string, ProcessedItem>();

  for (const item of items) {
    if (!item.processed_item_id) continue;
    if (!seen.has(item.processed_item_id)) {
      seen.set(item.processed_item_id, item);
    }
  }

  return [...seen.values()];
}

export function getArticleSitemapEntriesForYear(
  items: ProcessedItem[],
  year: string,
): SitemapEntry[] {
  const entries: SitemapEntry[] = [];

  for (const item of items) {
    if (!item.snapshot_date?.startsWith(`${year}-`)) continue;

    entries.push({
      url: absoluteUrl(`/article/${item.processed_item_id}`),
      lastmod: item.snapshot_date,
    });
  }

  return entries.sort((a, b) => a.url.localeCompare(b.url));
}

export async function getArticleSitemapYears(): Promise<string[]> {
  const items = getUniqueArticleItems(await getAllItems());
  const years = new Set<string>();

  for (const item of items) {
    if (item.snapshot_date) {
      years.add(item.snapshot_date.slice(0, 4));
    }
  }

  return [...years].sort();
}

export async function getArticleSitemapEntriesByYear(
  year: string,
): Promise<SitemapEntry[]> {
  const items = getUniqueArticleItems(await getAllItems());
  return getArticleSitemapEntriesForYear(items, year);
}
