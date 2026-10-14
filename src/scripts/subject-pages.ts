// /subjects and /subjects/<slug>, rendered from /data/subjects/*.json. The
// markup mirrors the former Astro templates so the existing styles apply.
import { esc, loadData, onPage, safeUrl } from './site-data.ts';

interface SignalStats {
  signal_count_30d: number;
  trend_pct_30d: number;
  latest_signal_at: string | null;
  sparkline: number[];
}
interface SubjectCard { slug: string; display_name: string; type: string; aliases: string[]; summary: string; stats: SignalStats }
interface SubjectIndex { latest_date: string | null; subject_count: number; sections: { slug: string; label: string; subjects: SubjectCard[] }[] }
interface SubjectDetail {
  subject: { slug: string; display_name: string; type: string; summary: string; section_slug: string | null; homepage_url: string | null };
  stats: SignalStats;
  signals: { title: string; url: string | null; source_name: string | null; snapshot_date: string; score: number | null; external: boolean }[];
  highlights: { summary: string | null; analysis: string | null; evidence_count: number }[];
  related: { slug: string; display_name: string }[];
}

function trendLabel(value: number) {
  if (value > 0) return `▲ +${value}%`;
  if (value < 0) return `▼ ${value}%`;
  return '→ 0%';
}

function sparklinePoints(values: number[], width: number, height: number) {
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  return values.map((value, index) => {
    const y = height - (value / max) * (height - 4) - 2;
    return `${(index * step).toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

const trendClass = (stats: SignalStats) => (stats.trend_pct_30d >= 0 ? 'is-up' : 'is-down');

/** A slug as a path segment; ':' stays as is, so URLs read /subjects/company:xiaomi. */
const segment = (slug: string) => encodeURIComponent(slug).replace(/%3A/gi, ':');

// ─── /subjects ──────────────────────────────────────

function freshness(value: string | null, today: string | null) {
  if (!value) return '更新 · 等待信号';
  const date = value.slice(0, 10);
  return date === today ? '更新 · 今天' : `更新 · ${date}`;
}

function subjectCard(subject: SubjectCard, today: string | null): string {
  const tags = [subject.type, ...subject.aliases].filter(Boolean);
  const stats = subject.stats;
  return `<a class="subject-link-item" href="/subjects/${segment(subject.slug)}">
    <div class="subject-card-top">
      <div>
        <div class="subject-link-name">${esc(subject.display_name)}</div>
        ${subject.summary ? `<p>${esc(subject.summary)}</p>` : ''}
      </div>
      <svg class="subject-sparkline" viewBox="0 0 84 28" aria-hidden="true"> <polyline points="${sparklinePoints(stats.sparkline, 84, 28)}"></polyline> </svg>
    </div>
    <div class="subject-signal-row"> <span>近30天</span> <strong>${stats.signal_count_30d}</strong> <span>条信号</span> <b class="${trendClass(stats)}">${trendLabel(stats.trend_pct_30d)}</b> </div>
    <div class="subject-link-meta"> ${tags.map((tag) => `<span>${esc(tag)}</span>`).join('')} </div>
    <div class="subject-card-foot">
      <span>${freshness(stats.latest_signal_at, today)}</span>
      <strong>查看 ${stats.signal_count_30d} 条信号 →</strong>
    </div>
  </a>`;
}

onPage('[data-subject-index]', async (root) => {
  const data = await loadData<SubjectIndex>('/data/subjects/index.json');
  root.querySelector('[data-subject-meta]')!.innerHTML =
    ` <span>${data.subject_count} 个专题</span> <span>${data.sections.length} 个分区</span> `;
  root.querySelector('[data-subject-directory]')!.innerHTML = data.sections.length > 0
    ? `<div class="subject-directory">${data.sections.map((section) => `
        <section class="subject-section" id="${esc(section.slug)}">
          <div class="subject-section-head"> <h2>${esc(section.label)}</h2> <span>${section.subjects.length}</span> </div>
          <div class="subject-link-grid">${section.subjects.map((s) => subjectCard(s, data.latest_date)).join('')}</div>
        </section>`).join('')}</div>`
    : `<section class="subject-empty"><div class="subject-empty-title">暂无已发布 Subject</div><div class="subject-empty-text">等待 Admin 审核通过后显示。</div></section>`;
});

// ─── /subjects/<slug> ───────────────────────────────

function moduleBlock(no: string, title: string, badge: string | number, body: string): string {
  return `<section class="subject-module${no === '01' ? ' subject-signal-flow' : ''}">
    <div class="subject-module-head"> <div> <span>${no}</span> <h2>${title}</h2> </div> <strong>${esc(badge)}</strong> </div>
    ${body}
  </section>`;
}

onPage('[data-subject-detail]', async (root) => {
  const slug = decodeURIComponent(location.pathname.match(/\/subjects\/([^/]+)\/?$/)?.[1] || '');
  if (!slug) throw new Error('Not a subject URL');
  const { subject, stats, signals, highlights, related } = await loadData<SubjectDetail>(`/data/subjects/${segment(slug)}.json`);
  const homepage = safeUrl(subject.homepage_url);

  const signalList = signals.length > 0
    ? `<div class="subject-signal-list"> ${signals.slice(0, 6).map((signal) => {
        const href = safeUrl(signal.url);
        const score = signal.score === null || signal.score === undefined ? '' : String(Math.round(signal.score * 100));
        return `<a class="subject-signal-item" href="${esc(href || '#')}"${href ? ' target="_blank" rel="noreferrer"' : ''}>
          <div>
            <h3>${esc(signal.title)}</h3>
            <p> ${esc(signal.source_name || 'Unknown')} <span>${esc(signal.snapshot_date.slice(0, 10))}</span> ${score ? `<b>评分 ${score}</b> ` : ''}${signal.external ? '<em>Web</em> ' : ''}</p>
          </div>
          <span>→</span>
        </a>`;
      }).join('')}${stats.signal_count_30d > 6 ? ` <a class="subject-see-all" href="#signals">查看全部 ${stats.signal_count_30d} 条 →</a>` : ''} </div>`
    : '<div class="subject-module-empty">暂无信号</div>';

  const points = highlights.length > 0
    ? `<div class="subject-point-list"> ${highlights.map((item) =>
        `${item.summary ? `<p>· ${esc(item.summary)}</p>` : ''}${item.analysis ? `<p>· ${esc(item.analysis)}</p>` : ''}${item.evidence_count > 0 ? `<span class="subject-evidence">${item.evidence_count} evidence</span>` : ''}`).join('')} </div>`
    : '<div class="subject-module-empty">暂无发布内容</div>';

  const relatedList = related.length > 0
    ? `<div class="subject-related-list"> ${related.map((r) => `<a href="/subjects/${segment(r.slug)}"> ${esc(r.display_name)} <span>→</span> </a>`).join('')} </div>`
    : '<div class="subject-module-empty">暂无关联专题</div>';

  root.innerHTML = `
    <header class="subject-detail-head">
      <a href="/subjects" class="subject-back">← 专题索引</a>
      <div class="subject-detail-kicker">${esc(subject.type)}</div>
      <h1>${esc(subject.display_name)}</h1>
      ${subject.summary ? `<p>${esc(subject.summary)}</p>` : ''}
      <div class="subject-detail-signal">
        <div> <span>近30天</span> <strong>${stats.signal_count_30d}</strong> <span>条信号</span> <b class="${trendClass(stats)}">${trendLabel(stats.trend_pct_30d)}</b> </div>
        <svg viewBox="0 0 128 32" aria-hidden="true"> <polyline points="${sparklinePoints(stats.sparkline, 128, 32)}"></polyline> </svg>
      </div>
      <div class="subject-detail-meta">
        <span>${esc(subject.slug)}</span>
        ${subject.section_slug ? `<span>${esc(subject.section_slug)}</span>` : ''}
        <span>${stats.signal_count_30d} signals</span>
        ${homepage ? `<a href="${esc(homepage)}" target="_blank" rel="noreferrer">Homepage</a>` : ''}
      </div>
    </header>
    ${moduleBlock('01', '信号流', stats.signal_count_30d, signalList)}
    ${moduleBlock('02', '近期要点', 'AI 生成', points)}
    ${moduleBlock('03', '关联', related.length, relatedList)}`;
});
