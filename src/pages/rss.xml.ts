import { getItemsByDate, getLatestDate } from '../lib/data';
import { absoluteUrl } from '../lib/sitemap';
import type { ProcessedItem } from '../lib/types';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function itemTitle(item: ProcessedItem): string {
  return item.processed_title || item.title || 'Untitled';
}

function datePubDate(date: string | null | undefined): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toUTCString() : parsed.toUTCString();
}

function renderItem(item: ProcessedItem): string {
  const link = absoluteUrl(`/article/${item.processed_item_id}`);

  return [
    '<item>',
    `<title>${escapeXml(itemTitle(item))}</title>`,
    `<description>${escapeXml(item.summary || '')}</description>`,
    `<link>${escapeXml(link)}</link>`,
    `<guid isPermaLink="true">${escapeXml(link)}</guid>`,
    `<pubDate>${escapeXml(datePubDate(item.snapshot_date))}</pubDate>`,
    '</item>',
  ].join('');
}

function renderRss(items: ProcessedItem[], latestDate: string | null): string {
  const lastBuildDate = latestDate
    ? [`<lastBuildDate>${escapeXml(datePubDate(latestDate))}</lastBuildDate>`]
    : [];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '<channel>',
    '<title>AmazingIndex</title>',
    `<link>${escapeXml(absoluteUrl('/'))}</link>`,
    '<description>每日 AI 行业精选简报，过滤噪音，直达洞察。</description>',
    '<language>zh-CN</language>',
    ...lastBuildDate,
    ...items.map(renderItem),
    '</channel>',
    '</rss>',
  ].join('');
}

export async function GET() {
  const latestDate = await getLatestDate();
  const items = latestDate ? await getItemsByDate(latestDate) : [];

  return new Response(renderRss(items, latestDate), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
    },
  });
}
