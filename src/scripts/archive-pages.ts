// /daily (year view), /daily/<YYYY-MM> (month view) and /history, rendered
// from /data/archive/*.json and /data/history.json. The markup mirrors the
// former Astro templates so the existing styles apply unchanged.
import {
  MONTH_NAMES,
  WEEKDAYS_ZH,
  announceRendered,
  esc,
  loadData,
  onPage,
  renderGlobalStats,
  safeUrl,
  type GlobalStats,
  type SummaryData,
} from './site-data.ts';

interface MonthlyArchive {
  month: string;
  edition_count: number;
  item_count: number;
  avg_aha_score: number;
  top_story_title?: string;
}
interface ArchiveIndex { latest_date: string | null; stats: GlobalStats; years: { year: number; months: MonthlyArchive[] }[] }
interface DailyArchive { snapshot_date: string; aha_score: number; aha_delta: string; item_count: number; top_story_title: string }
interface WeeklyArchive { week_number: number; start_date: string; end_date: string; avg_aha_score: number }
interface TopItem { title: string; tags: string[]; source_name: string | null; url: string | null }
interface ArchiveMonth {
  month: string;
  summary: MonthlyArchive | null;
  weeks: WeeklyArchive[];
  days: DailyArchive[];
  top_items: Record<string, TopItem[]>;
}
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

const pad = (n: number) => String(n).padStart(2, '0');
const shortDate = (date: string) => date.substring(5).replace('-', '.');

function localToday() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

// ─── /daily: year view ──────────────────────────────

function monthCell(year: number, monthNum: number, data: MonthlyArchive | undefined): string {
  const today = localToday();
  const label = `<div class="mc-label">${MONTH_NAMES[monthNum - 1]}</div>`;
  const isFuture = year > today.year || (year === today.year && monthNum > today.month);
  const isCurrent = year === today.year && monthNum === today.month;
  if (isFuture || !data) {
    const inner = ` ${label} <div class="mc-score">--</div> <div class="mc-score-sub">平均 Aha 指数</div> <div class="mc-count">0 篇</div> <div class="mc-bar"><div></div><div></div><div></div></div> `;
    return isFuture
      ? `<div class="month-cell future">${inner}</div>`
      : `<a href="/daily/${year}-${pad(monthNum)}" class="month-cell ${isCurrent ? 'current' : ''}">${inner}</a>`;
  }
  return `<a href="/daily/${year}-${pad(monthNum)}" class="month-cell ${isCurrent ? 'current' : ''}">
    ${label}
    <div class="mc-score">${data.avg_aha_score.toFixed(1)}</div>
    <div class="mc-score-sub">平均指数</div>
    <div class="mc-top">${esc(data.top_story_title)}</div>
    <div class="mc-count">${data.item_count} 篇</div>
    <div class="mc-bar"> <div class="f"></div> <div class="f"></div> <div class="${data.avg_aha_score > 85 ? 'fh' : ''}"></div> </div>
  </a>`;
}

function distribution(months: MonthlyArchive[]): string {
  const buckets = { high: 0, mid: 0, low: 0, veryLow: 0 };
  for (const m of months) {
    if (m.avg_aha_score >= 90) buckets.high++;
    else if (m.avg_aha_score >= 80) buckets.mid++;
    else if (m.avg_aha_score >= 70) buckets.low++;
    else buckets.veryLow++;
  }
  const total = months.length || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  const row = (label: string, value: number, fill: string, extra = '') =>
    `<div class="sb-row"> <div class="sb-label">${label}</div> <div class="sb-track"><div class="sb-fill ${fill}" style="width: ${value}%;${extra}"></div></div> <div class="sb-count">${value}%</div> </div>`;
  return row('90-100', pct(buckets.high), 'high') + row('80-89', pct(buckets.mid), 'mid') +
    row('70-79', pct(buckets.low), 'low') + row('&lt; 70', pct(buckets.veryLow), 'low', ' opacity: 0.3;');
}

onPage('[data-archive-year]', async (root) => {
  const data = await loadData<ArchiveIndex>('/data/archive/index.json');
  const years = data.years.map((y) => y.year);
  const requested = Number(new URLSearchParams(location.search).get('year'));
  const year = years.includes(requested) ? requested : (years[0] ?? localToday().year);
  const months = data.years.find((y) => y.year === year)?.months ?? [];

  root.querySelector('[data-year-rail]')!.innerHTML = years.map((y) => y === year
    ? `<span class="archive-year-rail-year">${y}</span>`
    : `<a class="archive-year-rail-year" style="opacity: 0.35; text-decoration: none; color: inherit;" href="/daily?year=${y}">${y}</a>`).join(' ');
  root.querySelector('[data-month-grid]')!.innerHTML = Array.from({ length: 12 }, (_, i) => {
    const monthNum = 12 - i;
    return monthCell(year, monthNum, months.find((m) => Number(m.month.slice(5, 7)) === monthNum));
  }).join('');
  root.querySelector('[data-global-stats]')!.innerHTML = renderGlobalStats(data.stats);
  root.querySelector('[data-distribution]')!.innerHTML = distribution(months);
});

// ─── /daily/<YYYY-MM>: month view ───────────────────

function dayBlock(day: DailyArchive, items: TopItem[]): string {
  const weekday = WEEKDAYS_ZH[new Date(`${day.snapshot_date}T00:00:00`).getDay()];
  if (day.item_count === 0) {
    return `<div class="day-block"><div class="day-head today-row"><div class="dh-toggle"></div><div class="dh-date">${shortDate(day.snapshot_date)}</div><div class="dh-weekday">${weekday}</div><div class="today-tag">今日</div><div class="pending">正在编译今日简报...</div></div></div>`;
  }
  const rows = items.map((item, idx) => {
    const href = safeUrl(item.url);
    return `<div class="item-row">
      <div class="ir-num">${pad(idx + 1)}</div>
      <div class="ir-title">${esc(item.title)}</div>
      <div class="ir-tags"> ${item.tags.map((tag) => `<span class="ir-tag">${esc(tag)}</span>`).join('')} </div>
      <div class="ir-src">${esc(item.source_name)}</div>
      ${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" class="ir-link">阅读全文 →</a>` : ''}
    </div>`;
  }).join('');
  return `<div class="day-block">
    <div class="day-head" data-date="${day.snapshot_date}">
      <div class="dh-toggle">▶</div>
      <div class="dh-date">${shortDate(day.snapshot_date)}</div>
      <div class="dh-weekday">${weekday}</div>
      <div class="dh-score">${day.aha_score.toFixed(1)}</div>
      <div class="dh-delta" style="color: ${day.aha_delta.startsWith('-') ? 'var(--red, #dc2626)' : 'var(--green)'};">${esc(day.aha_delta)}</div>
      <div class="dh-top">${esc(day.top_story_title)}</div>
      <div class="dh-count">${day.item_count} 篇</div>
      <div class="dh-bar"> <div class="f"></div> <div class="f"></div> <div class="${day.aha_score > 90 ? 'fh' : ''}"></div> </div>
    </div>
    <div class="day-items" data-items-for="${day.snapshot_date}">
      ${rows}
      <a href="/daily/${day.snapshot_date}" class="ir-more">查看当日全部 ${day.item_count} 篇简报 →</a>
    </div>
  </div>`;
}

onPage('[data-archive-month]', async (root) => {
  const month = location.pathname.match(/\/daily\/(\d{4}-\d{2})\/?$/)?.[1];
  if (!month) throw new Error('Not a month archive URL');
  // A month file only changes with its own editions; site-wide statistics come from the summary.
  const [data, summary] = await Promise.all([
    loadData<ArchiveMonth>(`/data/archive/${month}.json`),
    loadData<SummaryData>('/data/summary.json'),
  ]);
  const year = Number(month.slice(0, 4));
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1];

  root.querySelector('[data-month-crumb]')!.textContent = `${year}年${name}`;
  root.querySelector('[data-month-title]')!.textContent = `${year}年${name}`;
  root.querySelector('[data-month-count]')!.textContent = `共收录 ${data.summary?.item_count || 0} 篇`;
  root.querySelector('[data-weeks]')!.innerHTML = data.weeks.map((week) => {
    const days = data.days.filter((d) => d.snapshot_date >= week.start_date && d.snapshot_date <= week.end_date);
    return `<div class="week-section">
      <div class="week-header">
        <h3>第 ${week.week_number} 周</h3>
        <span class="week-range">${shortDate(week.start_date)} - ${shortDate(week.end_date)}</span>
        <span class="week-stats">平均分: ${week.avg_aha_score.toFixed(1)}</span>
      </div>
      ${days.map((day) => dayBlock(day, data.top_items[day.snapshot_date] || [])).join('')}
      <div class="back-to-overview"> <a href="/daily" class="lnk">返回年度归档 ↑</a> </div>
    </div>`;
  }).join('');
  root.querySelector('[data-global-stats]')!.innerHTML = renderGlobalStats(summary.stats);

  root.querySelectorAll<HTMLElement>('.day-head[data-date]').forEach((head) => {
    head.addEventListener('click', () => {
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
