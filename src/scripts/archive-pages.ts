// /daily (year view), /daily/<YYYY-MM> (month view) and /history.
// The export writes the year and month pages with their content already in
// the HTML (src/lib/archive-render.ts); this script renders them from
// /data/archive/*.json only when the page still shows its loading state
// (the dev server's shells) or another year is asked for (/daily?year=).
// /history is always rendered here from /data/history.json.
import {
  announceRendered,
  esc,
  loadData,
  onPage,
  renderGlobalStats,
  type GlobalStats,
  type SummaryData,
} from './site-data.ts';
import {
  monthLabel,
  renderDistribution,
  renderMonthCount,
  renderMonthGrid,
  renderMonthIndex,
  renderMonthNav,
  renderMonthWeeks,
  renderYearRail,
  type MonthCellData,
  type MonthData,
} from '../lib/archive-render.ts';

interface ArchiveIndex { latest_date: string | null; stats: GlobalStats; years: { year: number; months: MonthCellData[] }[] }
interface CardItem {
  processed_item_id: string;
  snapshot_date: string;
  processed_title: string | null;
  title?: string;
  summary: string | null;
  tags: string[] | null;
  source_name: string;
  category: string | null;
  aha_index: number;
  display_metrics: { items: { label: string; value: string }[] } | null;
}

function readerMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

const html = (root: HTMLElement, selector: string, value: string) => {
  const el = root.querySelector(selector);
  if (el) el.innerHTML = value;
};

// ─── /daily: year view ──────────────────────────────

onPage('[data-archive-year]', async (root) => {
  const requested = Number(new URLSearchParams(location.search).get('year'));
  const shown = Number(root.querySelector<HTMLElement>('[data-current-year]')?.dataset.currentYear);
  const prerendered = !root.querySelector('[data-loading]');
  if (prerendered && (!requested || requested === shown)) return;

  const data = await loadData<ArchiveIndex>('/data/archive/index.json');
  const years = data.years.map((y) => y.year);
  const year = years.includes(requested) ? requested : (years[0] ?? readerMonth().year);
  const months = data.years.find((y) => y.year === year)?.months ?? [];

  html(root, '[data-year-rail]', renderYearRail(years, year));
  html(root, '[data-month-grid]', renderMonthGrid(year, months, readerMonth()));
  html(root, '[data-month-index]', renderMonthIndex(data.years.flatMap((y) => y.months)));
  html(root, '[data-global-stats]', renderGlobalStats(data.stats));
  html(root, '[data-distribution]', renderDistribution(months));
});

// ─── /daily/<YYYY-MM>: month view ───────────────────

onPage('[data-archive-month]', async (root) => {
  if (root.querySelector('[data-loading]')) {
    const month = location.pathname.match(/\/daily\/(\d{4}-\d{2})\/?$/)?.[1];
    if (!month) throw new Error('Not a month archive URL');
    // A month file only changes with its own editions; site-wide statistics come from the summary.
    const [data, summary] = await Promise.all([
      loadData<MonthData>(`/data/archive/${month}.json`),
      loadData<SummaryData>('/data/summary.json'),
    ]);
    const label = monthLabel(month);
    html(root, '[data-month-crumb]', esc(label));
    html(root, '[data-month-title]', esc(label));
    html(root, '[data-month-count]', renderMonthCount(data));
    html(root, '[data-month-nav]', renderMonthNav(month, summary.editions.map((e) => e.date.slice(0, 7))));
    html(root, '[data-weeks]', renderMonthWeeks(data));
    html(root, '[data-global-stats]', renderGlobalStats(summary.stats));
  }

  root.querySelectorAll<HTMLElement>('.day-head[data-date]').forEach((head) => {
    head.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('a')) return;
      const items = root.querySelector(`[data-items-for="${head.dataset.date}"]`);
      const toggle = head.querySelector('.dh-toggle');
      if (!items || !toggle) return;
      const open = !items.classList.contains('open');
      items.classList.toggle('open', open);
      toggle.classList.toggle('open', open);
    });
  });
});

// ─── /history ───────────────────────────────────────

function briefingCard(item: CardItem): string {
  const parts = item.snapshot_date.split('-');
  const left = parts.length === 3 ? `${parts[1]}.${parts[2]}` : item.snapshot_date;
  const title = item.processed_title || item.title || '无标题';
  const category = item.tags && item.tags.length > 0 ? item.tags[0] : '综合';
  const tags = (item.tags || []).slice(1, 3);
  const metrics = (item.display_metrics?.items || []).filter((m) => m.label !== '📖 来源');
  return [
    `<a href="/article/${esc(item.processed_item_id)}" target="_blank" rel="noopener noreferrer" class="article" style="position: relative; text-decoration: none; color: inherit;"`,
    ` data-item-id="${esc(item.processed_item_id)}" data-snapshot-date="${esc(item.snapshot_date)}" data-category="${esc(item.category)}"`,
    ` data-event="click_article" data-track-impression="true">`,
    `<div class="article-num">${esc(left)}</div>`,
    `<div class="article-body"><h2 class="article-title">${esc(title)}</h2><p class="article-desc">${esc(item.summary || '无摘要')}</p>`,
    `<div class="article-meta"><div class="flex items-center gap-2 flex-wrap"><span class="tag primary">${esc(category)}</span>`,
    tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join(''),
    `</div><div class="article-extra">`,
    item.source_name ? `<span class="article-source-name">${esc(item.source_name)}</span>` : '',
    metrics.map((m) => `<span class="article-metric"><span class="metric-label">${esc(m.label)}</span><span class="metric-value">${esc(m.value)}</span></span>`).join(''),
    `</div></div></div></a>`,
  ].join('');
}

onPage('[data-history-list]', async (root) => {
  const { items } = await loadData<{ items: CardItem[] }>('/data/history.json');
  root.innerHTML = items.length > 0
    ? items.map(briefingCard).join('')
    : '<div class="loading-state">暂无历史数据</div>';
  if (items.length > 0) {
    // The masthead and score card describe the listed stories, as the static page did.
    const score = (items.reduce((sum, item) => sum + (item.aha_index || 0), 0) / items.length * 100).toFixed(1);
    document.querySelectorAll<HTMLElement>('[data-sidebar] [data-score-number], .masthead .score-trigger').forEach((el) => { el.textContent = score; });
    const [y, m, d] = items[0].snapshot_date.split('-');
    const vol = document.querySelector<HTMLElement>('.masthead-vol');
    if (vol && y && m && d) vol.innerHTML = ` VOL. ${esc(y)}.${esc(m)}<br> ${esc(y)}.${esc(m)}.${esc(d)} `;
  }
  announceRendered();
});
