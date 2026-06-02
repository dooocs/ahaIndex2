import { getAllItems } from '../lib/data';
import { absoluteUrl } from '../lib/sitemap';
import type { ProcessedItem } from '../lib/types';

const FEED_LIMIT = 50;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function uniqueArticleItems(items: ProcessedItem[]): ProcessedItem[] {
  const seen = new Map<string, ProcessedItem>();

  for (const item of items) {
    if (!item.processed_item_id) continue;
    if (!seen.has(item.processed_item_id)) {
      seen.set(item.processed_item_id, item);
    }
  }

  return [...seen.values()];
}

function itemTitle(item: ProcessedItem): string {
  return item.processed_title || item.title || 'Untitled';
}

function itemPubDate(item: ProcessedItem): string {
  const parsed = new Date(`${item.snapshot_date}T00:00:00.000Z`);
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
    `<pubDate>${escapeXml(itemPubDate(item))}</pubDate>`,
    '</item>',
  ].join('');
}

function renderRss(items: ProcessedItem[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '<channel>',
    '<title>AmazingIndex</title>',
    `<link>${escapeXml(absoluteUrl('/'))}</link>`,
    '<description>每日 AI 行业精选简报，过滤噪音，直达洞察。</description>',
    '<language>zh-CN</language>',
    ...items.map(renderItem),
    '</channel>',
    '</rss>',
  ].join('');
}

export async function GET() {
  const items = uniqueArticleItems(await getAllItems()).slice(0, FEED_LIMIT);

  return new Response(renderRss(items), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
    },
  });
}
