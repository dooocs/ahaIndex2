// Client side of the published /data/*.json files: fetch, escape, render hooks.
// The files are produced by scripts/export-site-data.ts after each deploy.

import type { GlobalStats } from '../lib/archive-render.ts';

export { esc, safeUrl, renderGlobalStats, MONTH_NAMES, WEEKDAYS_ZH, type GlobalStats } from '../lib/archive-render.ts';

const DATA_VERSION = 1;
const MAX_AGE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: Promise<any> }>();

/** Fetch one data file (cached for the visit, revalidated with the CDN). */
export function loadData<T>(path: string): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < MAX_AGE_MS) return hit.value as Promise<T>;
  const value = fetch(path, { cache: 'no-cache' }).then(async (response) => {
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const data = await response.json();
    if (data?.v !== DATA_VERSION) throw new Error(`${path}: unexpected data version`);
    return data as T;
  });
  value.catch(() => cache.delete(path));
  cache.set(path, { at: Date.now(), value });
  return value;
}

/** Run `render` on every page view (initial load and client-side navigation) that has `selector`. */
export function onPage(selector: string, render: (root: HTMLElement) => Promise<void> | void) {
  document.addEventListener('astro:page-load', () => {
    const root = document.querySelector<HTMLElement>(selector);
    if (!root) return;
    Promise.resolve(render(root)).catch((error) => {
      console.error(error);
      root.querySelectorAll<HTMLElement>('[data-loading]').forEach((el) => {
        el.textContent = '数据加载失败，请稍后刷新重试。';
      });
    });
  });
}

/** Tell page scripts (impression tracking) that new cards are in the DOM. */
export function announceRendered() {
  document.dispatchEvent(new CustomEvent('aha:content-rendered'));
}

export interface Edition { date: string; score: number; count: number }
export interface SummaryData { v: number; latest_date: string | null; stats: GlobalStats; editions: Edition[] }
