// 人生网格：有人生主线或状态的人物（目前是雷军），页面按年份排成网格。
//
// 输入是阿里云 person_public() 的发布快照原文（people_snapshots.payload），
// 不经过 people.ts 的旧结构和旧校验：旧页面只认识转折 / 争议 / 低谷三类事件，
// 这里还有高光、主线（tl_arcs）、身份 / 财富 / 家庭等状态（tl_states）。
//
//   行   = 年份。有事件的年份单独一行；没有事件的年份折叠成一行，
//          但在主线、状态的起止年份处断开，好让它们的格子对齐到年。
//   列   = 年份、年龄、主线泳道（越长越坚持）、每个状态维度、事件。
//   详情 = 每个事件一个“现场”：那一刻的年龄、身份、财富、家庭、正在坚持的主线，
//          以及当时 / 后来两组来源（来源发布于事件期间或其后 45 天内算“当时”，
//          引用上标了 phase 的以标注为准）。
//
// 纯函数：页面在构建时调用，测试直接喂快照。
import type { SnapshotPayload, SnapshotRow } from './people-snapshots.ts';

type Prec = 'year' | 'month' | 'day';
const DAY = 86_400_000;
const YEAR = 365.25 * DAY;
/** 来源在事件结束后多少天内发布，算作“当时”的报道。 */
export const THEN_WINDOW_DAYS = 45;

export const VALENCES: Record<string, string> = { up: '高光', down: '低谷', turn: '转折', dispute: '争议' };
const ARC_COLORS = new Set(['gray', 'blue', 'orange', 'violet', 'teal', 'olive', 'red', 'green']);

/** 有主线或状态的人用人生网格页，其余人还用原来的人物页。 */
export function isLifeGrid(payload: SnapshotPayload | null | undefined): boolean {
  const p = payload as Record<string, any> | null | undefined;
  return (p?.arcs?.length ?? 0) > 0 || (p?.states?.length ?? 0) > 0;
}

const ms = (iso: string) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
const yearOf = (iso: string) => Number(String(iso).slice(0, 4));

/** 一个日期按精度覆盖到的最后一天：2004 → 2004-12-31，2004-08 → 2004-08-31。 */
export function endOf(iso: string, prec: Prec | string | null | undefined): number {
  const [y, m] = [yearOf(iso), Number(String(iso).slice(5, 7))];
  if (prec === 'year') return Date.UTC(y + 1, 0, 1) - DAY;
  if (prec === 'month') return Date.UTC(y, m, 1) - DAY;
  return ms(iso);
}

/** 2015.10.08 / 2018.05 / 2015，按精度。 */
export function dotDate(iso: string | null | undefined, prec: Prec | string | null | undefined = 'day'): string | null {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (prec === 'year') return y;
  if (prec === 'month') return `${y}.${m}`;
  return `${y}.${m}.${d}`;
}

/** 1996年 / 2000年5月 / 2010年4月6日 */
export function chineseDate(iso: string, prec: Prec | string): string {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (prec === 'year') return `${y}年`;
  if (prec === 'month') return `${y}年${m}月`;
  return `${y}年${m}月${d}日`;
}

/** 某个时刻的周岁。 */
function ageOn(birth: string, at: number): number {
  const b = new Date(ms(birth));
  const t = new Date(at);
  let age = t.getUTCFullYear() - b.getUTCFullYear();
  if (t.getUTCMonth() < b.getUTCMonth() || (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate())) age -= 1;
  return Math.max(0, age);
}

/** 某一年里大部分时间的年龄（按 7 月 1 日算）；出生那年是 0。 */
function ageInYear(birth: string, birthPrec: string | null, year: number): number {
  const by = yearOf(birth);
  if (year <= by) return 0;
  if (birthPrec === 'year') return year - by;
  return ageOn(birth, Date.UTC(year, 6, 1));
}

/** 时长：16年、6个月；没结束的写 16年+。 */
export function duration(start: string, end: string | null, today: string): string {
  const years = ((end ? ms(end) : ms(today)) - ms(start)) / YEAR;
  if (end && years < 1) return `${Math.max(1, Math.round(years * 12))}个月`;
  return end ? `${Math.max(1, Math.round(years))}年` : `${Math.max(0, Math.floor(years))}年+`;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^(www|m)\./, '');
  } catch {
    return null;
  }
}

export interface GridSource {
  title: string;
  url: string | null;
  host: string | null;
  outlet: string | null;
  date: string | null;
  quote: string | null;
  excerpt: string | null;
}

export interface GridArc {
  id: string;
  label: string;
  role: string | null;
  summary: string | null;
  color: string;
  lane: number;
  start: string;
  end: string | null;
  span: string;
  duration: string;
  /** 0 起的行号（含首尾）。 */
  rowFrom: number;
  rowTo: number;
  short: boolean;
  entity: { slug: string; name: string; type: string } | null;
  events: string[];
  sources: GridSource[];
}

export interface GridState {
  label: string;
  note: string | null;
  estimate: boolean;
  rowFrom: number;
  rowTo: number;
  startYear: number;
  endYear: number;
}

export interface GridDimension {
  key: string;
  label: string;
  estimate: boolean;
  states: GridState[];
}

export interface GridEvent {
  id: string;
  date: string;
  prec: string;
  year: number;
  title: string;
  valence: string;
  valenceLabel: string;
  importance: number;
  place: string | null;
  thenText: string | null;
  laterText: string | null;
  commentary: string | null;
  sides: { who: string; text: string }[];
  steps: { date: string; text: string }[];
  people: { slug: string; name: string; role: string | null }[];
  links: { id: string; title: string; type: string; note: string | null }[];
  /** 网格里日期那一小格：5月、4.6、全年。 */
  shortDate: string;
  /** 详情页头：2010年4月6日。 */
  dateText: string;
  age: string | null;
  row: number;
  moment: { key: string; label: string; value: string | null; estimate: boolean }[];
  arcs: { id: string; label: string; color: string; year: number }[];
  then: GridSource[];
  later: GridSource[];
}

export interface GridRow {
  from: number;
  to: number;
  label: string;
  age: string | null;
  fold: boolean;
  events: string[];
}

export interface LifeGrid {
  slug: string;
  name: string;
  nameZh: string | null;
  role: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  xHandle: string | null;
  fields: string[];
  take: string | null;
  takeUpdatedAt: string | null;
  lifeText: string;
  updatedAt: string | null;
  featuredRank: number | null;
  labels: { text: string; by: string | null; url: string | null }[];
  achievements: { period: string | null; text: string; note: string | null }[];
  facts: { value: string; label: string }[];
  rows: GridRow[];
  lanes: number;
  arcs: GridArc[];
  dimensions: GridDimension[];
  events: GridEvent[];
  /** 网格里出现过的事件倾向，按固定顺序（图例用）。 */
  valences: string[];
  hasEstimate: boolean;
}

/** 一份发布快照 → 人生网格。today：构建当天（YYYY-MM-DD），没结束的主线算到这一天。 */
export function buildLifeGrid(snapshot: Pick<SnapshotRow, 'slug' | 'payload'>, today: string): LifeGrid {
  const payload = snapshot.payload as Record<string, any>;
  const p = payload.person ?? {};
  const list = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);
  const birth: string | null = p.birth_date ?? null;
  const death: string | null = p.death_date ?? null;
  const endDay = death ?? today;

  const rawEvents = list<any>(payload.events)
    .map((e, i) => ({ e, i }))
    .sort((a, b) => ms(a.e.date) - ms(b.e.date) || a.i - b.i)
    .map(({ e }) => e);
  const rawArcs = list<any>(payload.arcs);
  const rawStates = list<any>(payload.states);

  // ─── 行 ──────────────────────────────────────────
  const years = [
    ...rawEvents.map((e) => yearOf(e.date)),
    ...rawArcs.map((a) => yearOf(a.start)),
    ...rawStates.map((s) => yearOf(s.start)),
  ];
  const y0 = birth ? yearOf(birth) : Math.min(...years);
  const y1 = Math.max(yearOf(endDay), ...years);
  const stateEnd = (s: any) => (s.end ? yearOf(s.end) : y1);
  const arcEnd = (a: any) => (a.end ? yearOf(a.end) : y1);

  const breaks = new Set<number>([y0]);
  for (const e of rawEvents) { breaks.add(yearOf(e.date)); breaks.add(yearOf(e.date) + 1); }
  for (const a of rawArcs) { breaks.add(yearOf(a.start)); breaks.add(arcEnd(a) + 1); }
  for (const s of rawStates) { breaks.add(yearOf(s.start)); breaks.add(stateEnd(s) + 1); }
  const eventYears = new Set(rawEvents.map((e) => yearOf(e.date)));

  const ageText = (y: number) => (birth ? String(ageInYear(birth, p.birth_prec ?? null, y)) : null);
  const rows: GridRow[] = [];
  for (let y = y0; y <= y1; y++) {
    if (breaks.has(y) || rows.length === 0) rows.push({ from: y, to: y, label: '', age: null, fold: false, events: [] });
    else rows[rows.length - 1].to = y;
  }
  for (const r of rows) {
    r.fold = !eventYears.has(r.from);
    r.label = r.from === r.to ? String(r.from)
      : `${r.from}–${Math.floor(r.from / 100) === Math.floor(r.to / 100) ? String(r.to).slice(-2) : r.to}`;
    const a = ageText(r.from);
    const b = ageText(r.to);
    r.age = a === null ? null : a === b ? a : `${a}–${b}`;
  }
  const rowOf = (y: number) => Math.max(0, rows.findIndex((r) => y >= r.from && y <= r.to));

  // ─── 来源 ────────────────────────────────────────
  const source = (s: any): GridSource => ({
    title: s.title,
    url: s.url ?? null,
    host: hostOf(s.url),
    outlet: s.outlet ?? null,
    date: dotDate(s.published_at, s.pub_prec),
    quote: s.quote ?? null,
    excerpt: s.excerpt ?? null,
  });

  // ─── 主线 ────────────────────────────────────────
  const arcs: GridArc[] = rawArcs.map((a, i) => {
    const rowFrom = rowOf(yearOf(a.start));
    const rowTo = rowOf(arcEnd(a));
    return {
      id: `a-${i + 1}`,
      label: a.label,
      role: a.role_text ?? null,
      summary: a.summary ?? null,
      color: ARC_COLORS.has(a.color) ? a.color : 'gray',
      lane: Number.isInteger(a.lane) && a.lane >= 0 ? a.lane : 0,
      start: a.start,
      end: a.end ?? null,
      span: `${dotDate(a.start, a.start_prec)} — ${a.end ? dotDate(a.end, a.end_prec) : death ? dotDate(death, p.death_prec) : '至今'}`,
      duration: duration(a.start, a.end ?? death, today),
      rowFrom,
      rowTo,
      short: rowTo === rowFrom,
      entity: a.entity ? { slug: a.entity.slug, name: a.entity.name, type: a.entity.type } : null,
      events: [],
      sources: list<any>(a.sources).map(source),
    };
  });
  const arcRange = new Map(rawArcs.map((a, i) => [`a-${i + 1}`, [ms(a.start), a.end ? endOf(a.end, a.end_prec) : ms(endDay)]]));
  const arcStart = (a: GridArc) => arcRange.get(a.id)![0];
  const arcStop = (a: GridArc) => arcRange.get(a.id)![1];

  // ─── 状态 ────────────────────────────────────────
  const dimLabels = new Map<string, string>(list<any>(payload.dimensions).map((d) => [d.key, d.label]));
  const dimOrder = [...dimLabels.keys()];
  const dimKeys = [...new Set(rawStates.map((s) => s.dimension as string))]
    .sort((a, b) => (dimOrder.indexOf(a) + 1 || 99) - (dimOrder.indexOf(b) + 1 || 99));
  const dimensions: GridDimension[] = dimKeys.map((key) => {
    const states = rawStates
      .filter((s) => s.dimension === key)
      .sort((a, b) => ms(a.start) - ms(b.start))
      .map((s) => ({
        label: s.label,
        note: s.note ?? null,
        estimate: Boolean(s.is_estimate),
        rowFrom: rowOf(yearOf(s.start)),
        rowTo: rowOf(stateEnd(s)),
        startYear: yearOf(s.start),
        endYear: stateEnd(s),
      }));
    return { key, label: dimLabels.get(key) ?? key, estimate: states.some((s) => s.estimate), states };
  });
  const stateAt = (d: GridDimension, y: number) => d.states.find((s) => y >= s.startYear && y <= s.endYear) ?? null;

  // ─── 事件 ────────────────────────────────────────
  const idOf = (e: any, i: number) => `e-${e.short_id ?? i + 1}`;
  const ids = new Map<string, string>(rawEvents.map((e, i) => [e.short_id, idOf(e, i)]));
  const events: GridEvent[] = rawEvents.map((e, i) => {
    const id = idOf(e, i);
    const y = yearOf(e.date);
    const start = ms(e.date);
    const end = endOf(e.date, e.prec);
    const isThen = (s: any) => {
      if (s.phase === 'then') return true;
      if (s.phase === 'later') return false;
      if (!s.published_at) return false;
      const t = ms(s.published_at);
      return t >= start - DAY && t <= end + THEN_WINDOW_DAYS * DAY;
    };
    let age: string | null = null;
    if (birth) {
      const exact = e.prec === 'day' && p.birth_prec === 'day';
      const n = e.prec === 'day' ? ageOn(birth, start) : e.prec === 'month' ? ageOn(birth, start + 14 * DAY) : ageInYear(birth, p.birth_prec ?? null, y);
      age = `${exact || y === yearOf(birth) ? '' : '约'}${n}岁`;
    }
    const sources = list<any>(e.sources);
    const row = rowOf(y);
    rows[row].events.push(id);
    const [, m, d] = String(e.date).slice(0, 10).split('-').map(Number);
    return {
      id,
      date: e.date,
      prec: e.prec,
      year: y,
      title: e.title,
      valence: VALENCES[e.valence] ? e.valence : 'turn',
      valenceLabel: VALENCES[e.valence] ?? '转折',
      importance: [1, 2, 3].includes(e.importance) ? e.importance : 2,
      place: e.place ?? null,
      thenText: e.then_text ?? null,
      laterText: e.later_text ?? null,
      commentary: e.commentary ?? null,
      sides: list<any>(e.sides),
      steps: list<any>(e.steps),
      people: list<any>(e.people).map((x) => ({ slug: x.slug, name: x.name_zh || x.name, role: x.role ?? null })),
      links: list<any>(e.links)
        .filter((l) => ids.has(l.short_id))
        .map((l) => ({ id: ids.get(l.short_id)!, title: l.title, type: l.type, note: l.note ?? null })),
      shortDate: e.prec === 'year' ? '全年' : e.prec === 'month' ? `${m}月` : `${m}.${d}`,
      dateText: `${e.is_approx ? '约' : ''}${chineseDate(e.date, e.prec)}`,
      age,
      row,
      moment: dimensions.map((dim) => {
        const s = stateAt(dim, y);
        return { key: dim.key, label: dim.label, value: s?.label ?? null, estimate: Boolean(s?.estimate) };
      }),
      arcs: arcs
        .filter((a) => arcStart(a) <= end && arcStop(a) >= start)
        .map((a) => ({ id: a.id, label: a.label, color: a.color, year: Math.floor((Math.max(start, arcStart(a)) - arcStart(a)) / YEAR) + 1 })),
      then: sources.filter(isThen).map(source),
      later: sources.filter((s) => !isThen(s)).map(source),
    };
  });
  for (const a of arcs) {
    a.events = events.filter((e) => arcStart(a) <= endOf(e.date, e.prec) && arcStop(a) >= ms(e.date)).map((e) => e.id);
  }

  // ─── 页头 ────────────────────────────────────────
  const facts: { value: string; label: string }[] = [];
  if (birth) facts.push(death ? { value: `${ageOn(birth, ms(death))}岁`, label: '享年' } : { value: `${ageOn(birth, ms(today))}岁`, label: '今年' });
  const main = arcs.filter((a) => a.lane === 0).sort((a, b) => arcStop(b) - arcStart(b) - (arcStop(a) - arcStart(a))).slice(0, 2);
  for (const a of main) facts.push({ value: a.duration, label: a.label });
  facts.push({ value: String(events.length), label: '个事件' });

  const born = [birth ? dotDate(birth, p.birth_prec) : null, death ? dotDate(death, p.death_prec) : birth ? '至今' : null].filter(Boolean).join(' — ');

  return {
    slug: p.slug ?? snapshot.slug,
    name: p.name,
    nameZh: p.name_zh ?? null,
    role: p.role ?? null,
    nickname: p.nickname ?? null,
    avatarUrl: p.avatar_url ?? null,
    xHandle: p.x_handle ?? null,
    fields: list<string>(p.fields),
    take: p.take_text ?? null,
    takeUpdatedAt: p.take_updated_at ?? null,
    lifeText: [born, p.birth_place].filter(Boolean).join(' · '),
    updatedAt: p.updated_at ?? null,
    featuredRank: Number.isInteger(p.featured_rank) ? p.featured_rank : null,
    labels: list<any>(payload.labels).map((l) => ({ text: l.text, by: l.given_by ?? null, url: list<any>(l.sources)[0]?.url ?? null })),
    achievements: list<any>(payload.achievements).map((a) => ({ period: a.period ?? null, text: a.text, note: a.note ?? null })),
    facts,
    rows,
    lanes: Math.max(1, ...arcs.map((a) => a.lane + 1)),
    arcs,
    dimensions,
    events,
    valences: Object.keys(VALENCES).filter((v) => events.some((e) => e.valence === v)),
    hasEstimate: dimensions.some((d) => d.estimate),
  };
}

/** 一个人能不能上人生网格页：必须有名字，至少一个事件，日期都能读。不行就退回旧页面的规则。 */
export function lifeGridProblems(snapshot: Pick<SnapshotRow, 'slug' | 'payload'>): string[] {
  const payload = snapshot.payload as Record<string, any>;
  const problems: string[] = [];
  if (!payload?.person?.name) problems.push('缺少名字');
  const events = Array.isArray(payload?.events) ? payload.events : [];
  if (events.length === 0) problems.push('还没有已发布的事件');
  const bad = (iso: unknown) => typeof iso !== 'string' || Number.isNaN(ms(iso));
  for (const e of events) if (bad(e.date) || !e.title) problems.push(`事件日期或标题不完整：${e.title ?? e.date}`);
  for (const a of payload?.arcs ?? []) if (bad(a.start) || (a.end && bad(a.end))) problems.push(`主线日期不完整：${a.label}`);
  for (const s of payload?.states ?? []) if (bad(s.start) || (s.end && bad(s.end))) problems.push(`状态日期不完整：${s.label}`);
  return problems;
}

/**
 * 把全部快照分成两组：能上人生网格页的，和其余（交给旧页面和它的校验）。
 * 有主线或状态、但数据不完整的人退回旧页面，并给出提醒。
 */
export function splitPeopleSnapshots<T extends Pick<SnapshotRow, 'slug' | 'payload'>>(
  snapshots: T[],
  onProblem: (message: string) => void = () => {},
): { grids: T[]; legacy: T[] } {
  const grids: T[] = [];
  const legacy: T[] = [];
  for (const s of snapshots) {
    if (!isLifeGrid(s.payload)) { legacy.push(s); continue; }
    const problems = lifeGridProblems(s);
    if (problems.length === 0) grids.push(s);
    else {
      onProblem(`人物 ${s.slug} 的人生网格不完整，改用普通人物页：${problems.join('；')}`);
      legacy.push(s);
    }
  }
  return { grids, legacy };
}

/** 北京时间的今天（YYYY-MM-DD）：没结束的主线和年龄都算到这一天。 */
export const beijingToday = (now = Date.now()) => new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
