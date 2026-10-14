// Sidebar archive widgets: 7-edition score chart, month calendar and edition
// count, rendered from /data/summary.json so old pages never go stale. Both
// end at the page's own edition (data-date), or the newest one when empty.
import { loadData, onPage, type Edition, type SummaryData } from './site-data.ts';

const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');

function renderChart(editions: Edition[], date: string): string {
  const recent = editions.filter((e) => e.date <= date).slice(0, 7).reverse();
  const max = Math.max(...recent.map((e) => e.score), 1);
  return recent.map((e, i) => {
    const pct = Math.round((e.score / max) * 100);
    const weekday = WEEKDAYS_EN[new Date(`${e.date}T00:00:00`).getDay()];
    return `<div class="bar${i === recent.length - 1 ? ' today' : ''}" style="height: ${pct}%" title="${weekday} ${e.score.toFixed(0)}"></div>`;
  }).join('') + ' ';
}

function renderCalendar(editions: Edition[], date: string): string {
  const [year, month, today] = date.split('-').map(Number);
  const has = new Set(editions.filter((e) => e.count > 0).map((e) => e.date));
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDay).fill(null)];
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);

  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(` <tr> ${cells.slice(i, i + 7).map((d) => {
      if (!d) return '<td></td>';
      const day = `${year}-${pad(month)}-${pad(d)}`;
      const classes = [has.has(day) && 'has-ed', d === today && 'today-cell', !has.has(day) && d < today && 'empty'].filter(Boolean).join(' ');
      const attr = classes ? ` class="${classes}"` : '';
      return has.has(day)
        ? `<td${attr}><a href="/daily/${day}" style="color: inherit; text-decoration: none;">${d}</a></td>`
        : `<td${attr}>${d}</td>`;
    }).join('')} </tr>`);
  }
  return rows.join('') + ' ';
}

onPage('[data-sidebar]', async (sidebar) => {
  const summary = await loadData<SummaryData>('/data/summary.json');
  const date = sidebar.dataset.date || summary.latest_date;
  if (!date) return;
  const chart = sidebar.querySelector<HTMLElement>('[data-score-chart]');
  if (chart) chart.innerHTML = ' ' + renderChart(summary.editions, date);
  const calendar = sidebar.querySelector<HTMLElement>('[data-mini-cal]');
  if (calendar) calendar.innerHTML = renderCalendar(summary.editions, date);
  const total = sidebar.querySelector<HTMLElement>('[data-total-editions]');
  if (total) total.textContent = String(summary.stats.total_editions);

  // 下一期: the oldest deployed edition newer than this page's.
  const nav = document.querySelector<HTMLElement>('[data-edition-nav]');
  const next = nav?.querySelector<HTMLAnchorElement>('[data-next-edition]');
  const newer = summary.editions.filter((e) => e.date > date).at(-1);
  if (nav && next && newer && sidebar.dataset.date) {
    next.href = `/daily/${newer.date}`;
    next.textContent = `下一期 · ${newer.date} →`;
    next.hidden = false;
    nav.hidden = false;
  }
});
