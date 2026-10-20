// 人物 (/people): the people the site keeps a page on. They live in the news
// database (sql/people/): `people` holds one row per person (the directory:
// identity, the take, status), `person_profiles` the rest of the page
// (events, record, labels, stances, compare), edited by hand in the
// Supabase table editor (docs/people.md).
//
// A person is "written" once their row has a take (蜗牛说): written people
// get an indexed page and a sitemap entry; the others get a noindex page with
// their public identity and recent posts only. Rows with status 'draft' are
// not read by the build at all.
//
// Pure functions: queries.ts reads the rows, peopleFromRows turns them into
// pages' data and drops (with a warning) any row that breaks the rules below,
// so one bad edit never stops a deploy.
import type { FeedPost } from './feed.ts';

export const PEOPLE_PATH = '/people';

export const GROUPS = ['掌舵人', '研究者', '独立开发者', '布道者'] as const;
export const EVENT_TYPES = ['转折', '争议', '低谷'] as const;
export const TIERS = ['必看', '值得关注', '了解即可'] as const;

export type PersonGroup = (typeof GROUPS)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type Tier = (typeof TIERS)[number];

export interface Source {
  title: string;
  url: string;
}

export interface PersonEvent {
  /** 2005, 2023.11 or 2023.11.17 */
  date: string;
  type: EventType;
  title: string;
  /** What happened: facts only. */
  body: string;
  /** Who said what. Required (two or more) for 争议. */
  sides?: { who: string; text: string }[];
  /** 这说明: the site's reading of the event. */
  reading?: string;
  sources: Source[];
  /** 如果只看一件事: at most one event per person. */
  pinned?: boolean;
  /** The pinned event's sequence, shown as a short timeline. */
  steps?: { date: string; text: string }[];
}

export interface Stance {
  left: string;
  right: string;
  /** 0 = all the way left, 100 = all the way right. */
  position: number;
  /** Where the person stood before, when the stance moved. */
  was?: number;
  note: string;
  /** Others on the same axis, for comparison. */
  others?: { name: string; initial?: string; position: number }[];
  source: Source;
}

export interface Person {
  slug: string;
  name: string;
  name_zh?: string;
  x_handle?: string;
  group: PersonGroup;
  role: string;
  born?: string;
  fields?: string[];
  tier?: Tier;
  /** 蜗牛说. Its presence is what makes a person "written". */
  take?: { text: string; updated_at: string };
  events: PersonEvent[];
  record: { period: string; text: string; note?: string }[];
  labels: { text: string; by: string; url?: string }[];
  stances: Stance[];
  compare: { name: string; slug?: string; why: string }[];
  /** Retired /subjects/<slug> URLs that now point here. */
  former_subjects?: string[];
  added_at: string;
  updated_at: string;
  draft?: boolean;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_DATE = /^\d{4}(?:\.\d{2}(?:\.\d{2})?)?$/;
const STEP_DATE = /^(?:\d{4}\.)?\d{2}\.\d{2}$/;
const URL_RE = /^https?:\/\/\S+$/;

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isList = (v: unknown): v is unknown[] => Array.isArray(v);
const isPos = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 100;

/**
 * Problems with one person, as readable messages (empty when it is valid).
 * A draft may cite sources without a URL yet; a published person may not.
 */
export function validatePerson(raw: any): string[] {
  const errors: string[] = [];
  const who = typeof raw?.slug === 'string' && raw.slug ? raw.slug : '(no slug)';
  const err = (message: string) => errors.push(`${who}: ${message}`);
  if (!raw || typeof raw !== 'object') return ['(row): not an object'];
  const draft = raw.draft === true;
  const source = (s: any, where: string) => {
    if (!s || !isText(s.title)) err(`${where}: a source needs a title`);
    else if (!draft && !(isText(s.url) && URL_RE.test(s.url))) err(`${where}: source "${s.title}" needs an http(s) url`);
    else if (isText(s.url) && !URL_RE.test(s.url)) err(`${where}: source "${s.title}" has an invalid url`);
  };

  if (!SLUG.test(raw.slug ?? '')) err('slug must be lowercase letters, digits and hyphens');
  if (!isText(raw.name)) err('name is required');
  if (!isText(raw.role)) err('role is required');
  if (!GROUPS.includes(raw.group)) err(`group must be one of ${GROUPS.join(' / ')}`);
  if (raw.x_handle !== undefined && !HANDLE.test(raw.x_handle)) err('x_handle must be an X handle without @');
  if (raw.tier !== undefined && !TIERS.includes(raw.tier)) err(`tier must be one of ${TIERS.join(' / ')}`);
  if (raw.fields !== undefined && !(isList(raw.fields) && raw.fields.every(isText))) err('fields must be a list of words');
  if (!DAY.test(raw.added_at ?? '')) err('added_at must be YYYY-MM-DD');
  if (!DAY.test(raw.updated_at ?? '')) err('updated_at must be YYYY-MM-DD');
  if (raw.take !== undefined) {
    if (!isText(raw.take?.text)) err('take.text is required when there is a take');
    if (!DAY.test(raw.take?.updated_at ?? '')) err('take.updated_at must be YYYY-MM-DD');
  }

  for (const key of ['events', 'record', 'labels', 'stances', 'compare']) {
    if (!isList(raw[key])) err(`${key} must be a list (it may be empty)`);
  }
  const events: any[] = isList(raw.events) ? raw.events : [];
  events.forEach((e, i) => {
    const where = `events[${i}]`;
    if (!EVENT_DATE.test(e?.date ?? '')) err(`${where}: date must be YYYY, YYYY.MM or YYYY.MM.DD`);
    if (!EVENT_TYPES.includes(e?.type)) err(`${where}: type must be one of ${EVENT_TYPES.join(' / ')}`);
    if (!isText(e?.title)) err(`${where}: title is required`);
    if (!isText(e?.body)) err(`${where}: body is required`);
    if (e?.reading !== undefined && !isText(e.reading)) err(`${where}: reading must be text when present`);
    if (!isList(e?.sources) || e.sources.length === 0) err(`${where}: at least one source is required`);
    else e.sources.forEach((s: any) => source(s, where));
    const sides = e?.sides;
    if (sides !== undefined && !(isList(sides) && sides.every((s: any) => isText(s?.who) && isText(s?.text)))) err(`${where}: each side needs who and text`);
    if (e?.type === '争议' && !(isList(sides) && sides.length >= 2)) err(`${where}: a 争议 event needs at least two sides`);
    if (e?.steps !== undefined) {
      if (!e.pinned) err(`${where}: only the pinned event has steps`);
      if (!(isList(e.steps) && e.steps.every((s: any) => STEP_DATE.test(s?.date ?? '') && isText(s?.text)))) err(`${where}: each step needs date (MM.DD) and text`);
    }
  });
  if (events.filter((e) => e?.pinned).length > 1) err('at most one event can be pinned');

  (isList(raw.record) ? raw.record : []).forEach((r: any, i: number) => {
    if (!isText(r?.period) || !isText(r?.text)) err(`record[${i}]: period and text are required`);
  });
  (isList(raw.labels) ? raw.labels : []).forEach((l: any, i: number) => {
    if (!isText(l?.text) || !isText(l?.by)) err(`labels[${i}]: text and by (who calls him that) are required`);
    if (l?.url !== undefined && !URL_RE.test(l.url)) err(`labels[${i}]: invalid url`);
  });
  (isList(raw.stances) ? raw.stances : []).forEach((s: any, i: number) => {
    const where = `stances[${i}]`;
    if (!isText(s?.left) || !isText(s?.right)) err(`${where}: left and right are required`);
    if (!isPos(s?.position)) err(`${where}: position must be 0–100`);
    if (s?.was !== undefined && !isPos(s.was)) err(`${where}: was must be 0–100`);
    if (!isText(s?.note)) err(`${where}: note is required`);
    source(s?.source, where);
    if (s?.others !== undefined && !(isList(s.others) && s.others.every((o: any) => isText(o?.name) && isPos(o?.position)))) err(`${where}: each of others needs name and position`);
  });
  (isList(raw.compare) ? raw.compare : []).forEach((c: any, i: number) => {
    if (!isText(c?.name) || !isText(c?.why)) err(`compare[${i}]: name and why are required`);
  });
  if (raw.former_subjects !== undefined && !(isList(raw.former_subjects) && raw.former_subjects.every(isText))) err('former_subjects must be a list of subject slugs');
  return errors;
}

/** A `people` row, as the build reads it (published rows only). */
export interface PersonRow {
  id: string;
  slug: string;
  name: string;
  name_zh: string | null;
  x_handle: string | null;
  person_group: string;
  role: string;
  tier: string | null;
  take_text: string | null;
  take_updated_at: string | null;
  status: string;
  former_subjects: string[] | null;
  added_at: string;
  updated_at: string;
}

/** A `person_profiles` row: everything on the page beyond the directory. */
export interface ProfileRow {
  person_id: string;
  born: string | null;
  fields: string[] | null;
  events: unknown;
  record: unknown;
  labels: unknown;
  stances: unknown;
  compare: unknown;
  updated_at: string;
}

const day = (v: string | null | undefined) => String(v ?? '').slice(0, 10);
const opt = <T>(v: T | null | undefined) => (v === null || v === undefined || v === '' ? undefined : v);
const list = (v: unknown) => (Array.isArray(v) ? v : []);

/** One person from their two rows (no profile row yet: identity only). */
export function personFromRows(row: PersonRow, profile: ProfileRow | undefined): Person {
  const updated = [day(row.updated_at), day(profile?.updated_at)].sort().at(-1)!;
  const person: Record<string, unknown> = {
    slug: row.slug,
    name: row.name,
    name_zh: opt(row.name_zh),
    x_handle: opt(row.x_handle),
    group: row.person_group,
    role: row.role,
    born: opt(profile?.born),
    fields: profile?.fields?.length ? profile.fields : undefined,
    tier: opt(row.tier),
    take: opt(row.take_text) ? { text: row.take_text, updated_at: day(row.take_updated_at) || updated } : undefined,
    events: list(profile?.events),
    record: list(profile?.record),
    labels: list(profile?.labels),
    stances: list(profile?.stances),
    compare: list(profile?.compare),
    former_subjects: row.former_subjects?.length ? row.former_subjects : undefined,
    added_at: day(row.added_at),
    updated_at: updated,
    draft: row.status !== 'published' ? true : undefined,
  };
  for (const key of Object.keys(person)) if (person[key] === undefined) delete person[key];
  return person as unknown as Person;
}

/**
 * The people the pages show: valid, published, in no particular order.
 * A row that breaks a rule is left out and reported through `onProblem`
 * (the build turns it into a warning), so one bad edit never stops a deploy.
 */
export function peopleFromRows(rows: PersonRow[], profiles: ProfileRow[], onProblem: (message: string) => void = () => {}): Person[] {
  const profileOf = new Map(profiles.map((p) => [p.person_id, p]));
  const valid: Person[] = [];
  const handles = new Map<string, string>();
  for (const row of rows) {
    const person = personFromRows(row, profileOf.get(row.id));
    if (person.draft) continue;
    const problems = validatePerson(person);
    const handle = person.x_handle?.toLowerCase();
    if (handle && handles.has(handle)) problems.push(`${person.slug}: x_handle @${person.x_handle} is also used by ${handles.get(handle)}`);
    if (problems.length > 0) {
      onProblem(`人物 ${person.slug} 没有发布：${problems.join('；')}`);
      continue;
    }
    if (handle) handles.set(handle, person.slug);
    valid.push(person);
  }
  // A link to someone who is not shown becomes plain text.
  const shown = new Set(valid.map((p) => p.slug));
  return valid.map((p) => ({ ...p, compare: p.compare.map((c) => (c.slug && !shown.has(c.slug) ? { ...c, slug: undefined } : c)) }));
}

export const isWritten = (p: Person) => Boolean(p.take?.text);

/** Events oldest first (a story reads forward). */
export function sortedEvents(p: Person): PersonEvent[] {
  return [...p.events].sort((a, b) => a.date.localeCompare(b.date));
}

/** 看清他的那件事: the pinned event, else the newest 争议 or 低谷, else the newest event. */
export function definingEvent(p: Person): PersonEvent | null {
  const pinned = p.events.find((e) => e.pinned);
  if (pinned) return pinned;
  const events = sortedEvents(p).reverse();
  return events.find((e) => e.type !== '转折') ?? events[0] ?? null;
}

const time = (iso: string) => new Date(iso).getTime();

/** Feed posts by lower-cased handle, newest first. */
export function postsByHandle(posts: FeedPost[]): Map<string, FeedPost[]> {
  const map = new Map<string, FeedPost[]>();
  for (const post of posts) {
    const key = post.author.toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(post);
  }
  for (const list of map.values()) list.sort((a, b) => time(b.published_at) - time(a.published_at) || b.id.localeCompare(a.id));
  return map;
}

export function postsOf(p: Person, byHandle: Map<string, FeedPost[]>): FeedPost[] {
  return p.x_handle ? byHandle.get(p.x_handle.toLowerCase()) ?? [] : [];
}

/** Feed authors with no person file, for a build-time reminder. */
export function missingFromPeople(people: Person[], byHandle: Map<string, FeedPost[]>): string[] {
  const known = new Set(people.filter((p) => p.x_handle).map((p) => p.x_handle!.toLowerCase()));
  return [...byHandle.entries()].filter(([handle]) => !known.has(handle)).map(([, posts]) => posts[0].author).sort();
}

/**
 * The directory order: written people first, newest take first; then the
 * others by name. A stable order keeps rebuilds byte-identical.
 */
export function directoryOrder(people: Person[]): Person[] {
  return [...people].sort((a, b) => {
    const wa = isWritten(a), wb = isWritten(b);
    if (wa !== wb) return wa ? -1 : 1;
    if (wa && wb && a.take!.updated_at !== b.take!.updated_at) return b.take!.updated_at.localeCompare(a.take!.updated_at);
    return a.name.localeCompare(b.name, 'en');
  });
}

/** First letter for the avatar placeholder. */
export const initialOf = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? '?';

/** The site's date style: 2026.10.20 */
export const dotDate = (day: string) => day.replaceAll('-', '.');

/** Where a retired /subjects URL goes: the person who took it over, else the people directory. */
export function retiredSubjectTarget(subjectSlug: string | null, people: Person[]): string {
  if (subjectSlug) {
    // Named in a file, or a person subject whose slug matches ("person:elon-musk" → elon-musk).
    const bare = subjectSlug.startsWith('person:') ? subjectSlug.slice('person:'.length) : null;
    const owner = people.find((p) => p.former_subjects?.includes(subjectSlug)) ?? people.find((p) => p.slug === bare);
    if (owner) return `${PEOPLE_PATH}/${owner.slug}`;
  }
  return PEOPLE_PATH;
}
