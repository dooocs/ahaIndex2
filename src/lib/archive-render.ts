// HTML for the archive views: /daily (year view) and /daily/<YYYY-MM> (month
// view). Pure string functions shared by the export script, which writes the
// pages with this markup already in them (crawlers and readers without
// JavaScript see real links), and by src/scripts/archive-pages.ts, which uses
// the same functions when it has to render in the browser (dev server, ?year=).
// The markup is the one the archive styles (src/styles/archive.css) expect.

export const MONTH_NAMES = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
export const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export interface GlobalStats { total_editions: number; total_items: number; avg_aha_score: number; peak_aha_score: number }

export interface MonthCellData {
  month: string;
  edition_count: number;
  item_count: number;
  avg_aha_score: number;
  top_story_title?: string;
}
export interface DayData { snapshot_date: string; aha_score: number; aha_delta: string; item_count: number; top_story_title: string }
export interface WeekData { week_number: number; start_date: string; end_date: string; avg_aha_score: number }
export interface DayTopItem { title: string; tags: string[]; source_name: string | null; url: string | null }
export interface MonthData {
  month: string;
  summary: { item_count: number } | null;
  weeks: WeekData[];
  days: DayData[];
  top_items: Record<string, DayTopItem[]>;
}
/** The calendar month a view treats as "now": the newest edition's month when exported, the reader's month in the browser. */
export interface YearMonth { year: number; month: number }

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

const pad = (n: number) => String(n).padStart(2, '0');
const shortDate = (date: string) => date.substring(5).replace('-', '.');
/** Grouped thousands, the same in Node and every browser locale. */
const grouped = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function monthLabel(month: string): string {
  return `${month.slice(0, 4)}年${MONTH_NAMES[Number(month.slice(5, 7)) - 1]}`;
}

/** Weekday of a YYYY-MM-DD date, independent of the time zone it is computed in. */
export function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS_ZH[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function renderGlobalStats(stats: GlobalStats): string {
  const stat = (label: string, value: string, style = '') =>
    ` <div class="side-stat"> <span class="ss-label">${label}</span> <span class="ss-val"${style}>${value}</span> </div>`;
  return stat('总期数', String(stats.total_editions)) +
    stat('收录文章', grouped(stats.total_items)) +
    stat('历史平均分', stats.avg_aha_score.toFixed(1)) +
    stat('最高得分', stats.peak_aha_score.toFixed(1), ' style="color: var(--accent);"') + ' ';
}

// ─── /daily: year view ──────────────────────────────

export function renderYearRail(years: number[], year: number): string {
  return years.map((y) => y === year
    ? `<span class="archive-year-rail-year" data-current-year="${y}">${y}</span>`
    : `<a class="archive-year-rail-year" style="opacity: 0.35; text-decoration: none; color: inherit;" href="/daily?year=${y}">${y}</a>`).join(' ');
}

function monthCell(year: number, monthNum: number, data: MonthCellData | undefined, now: YearMonth): string {
  const label = `<div class="mc-label">${MONTH_NAMES[monthNum - 1]}</div>`;
  const isFuture = year > now.year || (year === now.year && monthNum > now.month);
  const isCurrent = year === now.year && monthNum === now.month;
  if (isFuture || !data) {
    const inner = ` ${label} <div class="mc-score">--</div> <div class="mc-score-sub">平均 Aha 指数</div> <div class="mc-count">0 篇</div> <div class="mc-bar"><div></div><div></div><div></div></div> `;
    // Only months with editions are links: an empty month has no page.
    return `<div class="month-cell ${isFuture ? 'future' : ''} ${isCurrent ? 'current' : ''}">${inner}</div>`;
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

/** Twelve cells, December first; `months` are the year's months with editions. */
export function renderMonthGrid(year: number, months: MonthCellData[], now: YearMonth): string {
  return Array.from({ length: 12 }, (_, i) => {
    const monthNum = 12 - i;
    return monthCell(year, monthNum, months.find((m) => Number(m.month.slice(5, 7)) === monthNum), now);
  }).join('');
}

export function renderDistribution(months: MonthCellData[]): string {
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

/**
 * Every month with editions, newest first, as plain links. Lets a reader (and
 * a crawler) reach every year's months from /daily without the ?year= switch.
 */
export function renderMonthIndex(months: MonthCellData[]): string {
  const sorted = [...months].sort((a, b) => b.month.localeCompare(a.month));
  return sorted.map((m) =>
    `<a href="/daily/${esc(m.month.slice(0, 7))}" class="month-index-link">${esc(monthLabel(m.month.slice(0, 7)))}<span class="mil-count">${m.edition_count} 期 · ${m.item_count} 篇</span></a>`,
  ).join('');
}

// ─── /daily/<YYYY-MM>: month view ───────────────────

function dayBlock(day: DayData, items: DayTopItem[]): string {
  const weekday = weekdayOf(day.snapshot_date);
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
    <div class="day-head" data-date="${esc(day.snapshot_date)}">
      <div class="dh-toggle">▶</div>
      <div class="dh-date"><a href="/daily/${esc(day.snapshot_date)}" class="dh-date-link">${shortDate(day.snapshot_date)}</a></div>
      <div class="dh-weekday">${weekday}</div>
      <div class="dh-score">${day.aha_score.toFixed(1)}</div>
      <div class="dh-delta" style="color: ${day.aha_delta.startsWith('-') ? 'var(--red, #dc2626)' : 'var(--green)'};">${esc(day.aha_delta)}</div>
      <div class="dh-top">${esc(day.top_story_title)}</div>
      <div class="dh-count">${day.item_count} 篇</div>
      <div class="dh-bar"> <div class="f"></div> <div class="f"></div> <div class="${day.aha_score > 90 ? 'fh' : ''}"></div> </div>
    </div>
    <div class="day-items" data-items-for="${esc(day.snapshot_date)}">
      ${rows}
      <a href="/daily/${esc(day.snapshot_date)}" class="ir-more">查看当日全部 ${day.item_count} 篇简报 →</a>
    </div>
  </div>`;
}

export function renderMonthWeeks(data: MonthData): string {
  return data.weeks.map((week) => {
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
}

export function renderMonthCount(data: MonthData): string {
  return `共收录 ${data.summary?.item_count || 0} 篇`;
}

/** 上个月 / 下个月 among the months with editions (`months`, any order). */
export function renderMonthNav(month: string, months: string[]): string {
  const sorted = [...new Set(months)].sort();
  const i = sorted.indexOf(month);
  const older = i > 0 ? sorted[i - 1] : null;
  const newer = i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null;
  const link = (target: string | null, rel: string, text: (label: string) => string) => target
    ? `<a href="/daily/${esc(target)}" rel="${rel}" class="month-nav-link">${esc(text(monthLabel(target)))}</a>`
    : '<span class="month-nav-link is-empty"></span>';
  return link(older, 'prev', (l) => `← ${l}`) + link(newer, 'next', (l) => `${l} →`);
}
