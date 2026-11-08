import type { ProcessedItem } from './types.ts';

/** Select an edition's visible stories, preserving its existing rank order. */
export function selectDailyItems(items: readonly ProcessedItem[]): ProcessedItem[] {
  let hackerNewsCount = 0;

  return items.filter((item) => {
    const source = (item.source_name ?? '').trim().toLowerCase();
    const contentType = (item.content_type ?? '').trim().toLowerCase();

    // Older paper feeds used content_type=article, so also check their source.
    if (['paper', 'papers', 'hf_papers'].includes(contentType) || /\bpapers?\b/.test(source)) {
      return false;
    }

    if (source.replace(/[\s_-]+/g, '') === 'hackernews') {
      return ++hackerNewsCount <= 3;
    }

    return true;
  });
}
