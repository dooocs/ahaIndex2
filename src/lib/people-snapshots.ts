// 人物发布快照 → 旧的 people / person_profiles 行。
//
// 人物内容现在由阿里云 Supabase 维护（草稿、发布、修订都在那里），阿里云的
// pg_cron 同步任务把每个已发布人物的 person_public() 输出写进新闻库的
// people_snapshots（docs/people.md）。构建只读这张表。
//
// 这里把快照还原成 people.ts 认识的两种行，peopleFromRows 的校验和所有页面
// 保持不变。纯函数：queries.ts 读表，这里只做转换。
//
// 旧页面还不认识的内容会原样交给校验：比如“高光”事件、没有正反方的争议，
// 校验会跳过这个人并给出警告，不会让构建失败。新的人生时间线页面上线前，
// 这类人物（目前只有雷军）先不要发布。
import type { PersonRow, ProfileRow } from './people.ts';

export interface SnapshotRow {
  person_id: string;
  slug: string;
  payload: SnapshotPayload;
  synced_at: string;
}

interface SnapSource { title: string; url: string | null }
interface SnapEvent {
  date: string;
  prec: 'year' | 'month' | 'day';
  title: string;
  valence: string;
  then_text: string | null;
  commentary: string | null;
  sides: { who: string; text: string }[] | null;
  steps: { date: string; text: string }[] | null;
  pinned: boolean | null;
  sources: SnapSource[];
}
export interface SnapshotPayload {
  person: Record<string, any>;
  events?: SnapEvent[];
  achievements?: { period: string | null; text: string; note: string | null; sources?: SnapSource[] }[];
  labels?: { text: string; given_by: string | null; sources?: SnapSource[] }[];
  stances?: {
    axis: { left: string; right: string };
    position: number;
    previous_position: number | null;
    note: string | null;
    others: { name: string; name_zh: string | null; position: number }[];
    sources?: SnapSource[];
  }[];
  comparisons?: { slug: string | null; name: string; why: string }[];
  generated_at?: string;
}

/** 阿里云里的事件倾向 → 旧页面的事件类型。 */
export const EVENT_TYPE_OF: Record<string, string> = { turn: '转折', dispute: '争议', down: '低谷', up: '高光' };

/** 2005 / 2014.02 / 2023.11.17：按日期精度写成旧格式。 */
export function eventDate(iso: string, prec: string): string {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (prec === 'year') return y;
  if (prec === 'month') return `${y}.${m}`;
  return `${y}.${m}.${d}`;
}

/** 出生年份（按精度）加出生地，例如 “1985 · 芝加哥”。 */
export function bornText(person: Record<string, any>): string | null {
  const parts = [
    person.birth_date ? eventDate(person.birth_date, person.birth_prec ?? 'year') : null,
    person.birth_place || null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

const source = (s: SnapSource) => ({ title: s.title, url: s.url ?? '' });

/** 立场轴上的小圆点：西文名取姓的首字母（Yann LeCun → L），其余取第一个字。 */
export function initialOf(name: string | null | undefined): string | undefined {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const word = /^[A-Za-z]/.test(words[0]) ? words.at(-1)! : words[0];
  return Array.from(word)[0].toUpperCase();
}
const text = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? undefined : v);
const list = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);
const nonEmpty = <T>(v: T[] | null | undefined) => (Array.isArray(v) && v.length > 0 ? v : undefined);

/** 去掉值为 undefined 的键，和手写的 JSON 一样（校验对“有这个键”很敏感）。 */
function clean<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** 一份快照 → 一行 people 和一行 person_profiles。 */
export function rowsFromSnapshot(s: SnapshotRow): { person: PersonRow; profile: ProfileRow } {
  const p = s.payload?.person ?? {};
  const updated = p.updated_at ?? s.synced_at;

  const person: PersonRow = {
    id: s.person_id,
    slug: p.slug ?? s.slug,
    name: p.name,
    name_zh: p.name_zh ?? null,
    x_handle: p.x_handle ?? null,
    person_group: p.person_group,
    role: p.role,
    tier: p.tier ?? null,
    take_text: p.take_text ?? null,
    take_updated_at: p.take_updated_at ?? null,
    status: 'published',
    former_subjects: p.former_subjects ?? [],
    avatar_url: p.avatar_url ?? null,
    github_handle: p.github_handle ?? null,
    nickname: p.nickname ?? null,
    added_at: p.added_at,
    updated_at: updated,
  };

  const profile: ProfileRow = {
    person_id: s.person_id,
    born: bornText(p),
    fields: list(p.fields),
    events: list(s.payload.events).map((e) => clean({
      date: eventDate(e.date, e.prec),
      type: EVENT_TYPE_OF[e.valence] ?? e.valence,
      title: e.title,
      body: e.then_text ?? '',
      reading: text(e.commentary),
      sides: nonEmpty(e.sides),
      steps: nonEmpty(e.steps),
      pinned: e.pinned ? true : undefined,
      sources: list(e.sources).map(source),
    })),
    record: list(s.payload.achievements).map((a) => clean({
      period: a.period ?? '',
      text: a.text,
      note: text(a.note),
    })),
    labels: list(s.payload.labels).map((l) => clean({
      text: l.text,
      by: l.given_by ?? '',
      url: text(list(l.sources)[0]?.url ?? undefined),
    })),
    stances: list(s.payload.stances).map((x) => clean({
      left: x.axis.left,
      right: x.axis.right,
      position: x.position,
      was: x.previous_position ?? undefined,
      note: x.note ?? '',
      others: nonEmpty(list(x.others).map((o) => ({
        name: o.name_zh || o.name,
        initial: initialOf(o.name),
        position: o.position,
      }))),
      source: list(x.sources)[0] ? source(list(x.sources)[0]) : { title: '', url: '' },
    })),
    compare: list(s.payload.comparisons).map((c) => clean({
      name: c.name,
      slug: c.slug ?? undefined,
      why: c.why,
    })),
    updated_at: updated,
  };

  return { person, profile };
}

/** 全部快照 → peopleFromRows 需要的两组行（按 slug 排序，和旧查询一致）。 */
export function rowsFromSnapshots(snapshots: SnapshotRow[]): { people: PersonRow[]; profiles: ProfileRow[] } {
  const rows = [...snapshots]
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map(rowsFromSnapshot);
  return { people: rows.map((r) => r.person), profiles: rows.map((r) => r.profile) };
}

/** 最近一次同步离现在多久（小时），用于构建时提醒同步任务可能停了。 */
export function hoursSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (now - t) / 3_600_000;
}
