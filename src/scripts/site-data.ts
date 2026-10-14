// Client side of the published /data/*.json files: fetch, escape, render hooks.
// The files are produced by scripts/export-site-data.ts after each deploy.

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

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) links and site paths are rendered as hrefs. */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
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
export interface GlobalStats { total_editions: number; total_items: number; avg_aha_score: number; peak_aha_score: number }
export interface SummaryData { v: number; latest_date: string | null; stats: GlobalStats; editions: Edition[] }

export function renderGlobalStats(stats: GlobalStats): string {
  const stat = (label: string, value: string, style = '') =>
    ` <div class="side-stat"> <span class="ss-label">${label}</span> <span class="ss-val"${style}>${value}</span> </div>`;
  return stat('总期数', String(stats.total_editions)) +
    stat('收录文章', stats.total_items.toLocaleString()) +
    stat('历史平均分', stats.avg_aha_score.toFixed(1)) +
    stat('最高得分', stats.peak_aha_score.toFixed(1), ' style="color: var(--accent);"') + ' ';
}

export const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const MONTH_NAMES = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
