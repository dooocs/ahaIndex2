// 动态 (/feed): original X posts of the bloggers Octopus follows, with their
// Chinese translation, from the 24 hours up to the newest post. Octopus writes
// proc_feed_posts hourly (collect → translate); this module reads it at build
// time and turns it into a single stream ordered by send time (timeline) and
// the numbers for the side panel (summarize). Pure functions apart from
// getFeedPosts, so tests/feed.test.mjs covers ordering, summary and text.
//
// text_zh === '' means no translation is needed (already Chinese, or only
// links/media): the page shows the original alone. Otherwise the original is
// shown with the translation below it.
import type { SupabaseClient } from '@supabase/supabase-js';

export const FEED_WINDOW_HOURS = 24;
export const FEED_PATH = '/feed';
const MAX_POSTS = 500;
const MEDIA_ORIGIN = 'https://www.amazingindex.com/';

export interface FeedMedia {
  type: string; // photo | video | animated_gif
  /** The photo, or a video's / GIF's cover image (its poster). */
  url: string;
  width: number | null;
  height: number | null;
  /** Videos and GIFs: the mp4 on the site's OSS; null when it was not archived. */
  video_url: string | null;
  /** The video was over Octopus's size cap: only the cover exists. */
  video_too_large: boolean;
  duration_ms: number | null;
}

export interface FeedPost {
  id: string;
  author: string;
  display_name: string;
  avatar_url: string | null;
  published_at: string;
  updated_at: string;
  url: string;
  text_original: string;
  text_zh: string;
  media: FeedMedia[];
}

export interface FeedAuthor {
  handle: string;
  display_name: string;
  avatar_url: string | null;
  latest_at: string;
  posts: FeedPost[];
}

const COLUMNS = 'id,author,display_name,avatar_url,published_at,updated_at,url,text_original,text_zh,media';

/**
 * Posts updated in the FEED_WINDOW_HOURS up to the newest post, newest first.
 * The window ends at the newest post, not at build time, so the page depends
 * on the data alone: an hourly rebuild with nothing new is byte-identical and
 * uploads nothing, and the nightly pause in collection does not empty it.
 * Throws on a database error.
 */
export async function getFeedPosts(db: SupabaseClient): Promise<FeedPost[]> {
  const newest = await db.from('proc_feed_posts').select('updated_at').order('updated_at', { ascending: false }).limit(1);
  if (newest.error) throw new Error(`Failed to read proc_feed_posts: ${newest.error.message}`);
  const end = newest.data?.[0]?.updated_at;
  if (!end) return [];
  const since = new Date(new Date(end).getTime() - FEED_WINDOW_HOURS * 3600_000).toISOString();
  const { data, error } = await db
    .from('proc_feed_posts')
    .select(COLUMNS)
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(MAX_POSTS);
  if (error) throw new Error(`Failed to read proc_feed_posts: ${error.message}`);
  return (data ?? []).map(normalizePost);
}

function int(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

const onSite = (value: unknown): value is string => typeof value === 'string' && value.startsWith(MEDIA_ORIGIN);

/** Only media archived to the site's own OSS is shown: X's CDN is not reachable for every reader, and never linked. */
function normalizeMedia(value: unknown): FeedMedia[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
    .filter((m) => onSite(m.url))
    .map((m) => ({
      type: String(m.type || 'photo'),
      url: String(m.url),
      width: int(m.width),
      height: int(m.height),
      video_url: onSite(m.video_url) ? m.video_url : null,
      video_too_large: m.video_too_large === true,
      duration_ms: int(m.duration_ms),
    }));
}

/** True for links to X itself (x.com, twitter.com, t.co): shown as text, never linked. */
export function isXUrl(url: string): boolean {
  return /^https?:\/\/((www|mobile)\.)?(x\.com|twitter\.com|t\.co)(\/|$|[?#])/i.test(url);
}

/** "1:05" for 65 000 ms; '' when unknown. */
export function durationLabel(ms: number | null): string {
  if (!ms) return '';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function normalizePost(row: Record<string, any>): FeedPost {
  const author = String(row.author ?? '');
  const avatar = onSite(row.avatar_url) ? row.avatar_url : null;
  return {
    id: String(row.id),
    author,
    display_name: String(row.display_name || author),
    avatar_url: avatar,
    published_at: String(row.published_at),
    updated_at: String(row.updated_at),
    url: String(row.url),
    text_original: String(row.text_original ?? '').trim(),
    text_zh: String(row.text_zh ?? '').trim(),
    media: normalizeMedia(row.media),
  };
}

const time = (iso: string) => new Date(iso).getTime();

/**
 * One card per author (handles compared case-insensitively), cards ordered by
 * each author's newest post, posts newest first. Name and avatar come from
 * the author's newest post.
 */
export function groupByAuthor(posts: FeedPost[]): FeedAuthor[] {
  const groups = new Map<string, FeedPost[]>();
  for (const post of posts) {
    const key = post.author.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(post);
  }
  const authors: FeedAuthor[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => time(b.updated_at) - time(a.updated_at) || b.id.localeCompare(a.id));
    const newest = list[0];
    authors.push({
      handle: newest.author,
      display_name: newest.display_name,
      avatar_url: list.find((p) => p.avatar_url)?.avatar_url ?? null,
      latest_at: newest.updated_at,
      posts: list,
    });
  }
  return authors.sort((a, b) => time(b.latest_at) - time(a.latest_at) || a.handle.localeCompare(b.handle));
}

/**
 * The stream on the left: every post on its own, ordered by when it was
 * actually sent on X (published_at), newest first. updated_at only decides
 * which posts are in the window.
 */
export function timeline(posts: FeedPost[]): FeedPost[] {
  return [...posts].sort((a, b) => time(b.published_at) - time(a.published_at) || b.id.localeCompare(a.id));
}

export interface FeedSummary {
  posts: number;
  authors: number;
  /** Newest send time in the window; '' when empty. */
  latest_at: string;
  /** Oldest send time in the window; '' when empty. */
  earliest_at: string;
  with_media: number;
  translated: number;
  /** Posts per Beijing hour of day (index 0 = 00:00–00:59). */
  by_hour: number[];
  /** Busiest authors first (ties: the one who posted last), every author included. */
  top_authors: { handle: string; display_name: string; avatar_url: string | null; posts: number; latest_at: string }[];
}

const BEIJING_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' });

/** The numbers in the right-hand panel, computed from the posts alone (no AI). */
export function summarize(posts: FeedPost[]): FeedSummary {
  const by_hour = new Array(24).fill(0);
  let latest = '';
  let earliest = '';
  for (const p of posts) {
    by_hour[Number(BEIJING_HOUR.format(new Date(p.published_at))) % 24]++;
    if (!latest || time(p.published_at) > time(latest)) latest = p.published_at;
    if (!earliest || time(p.published_at) < time(earliest)) earliest = p.published_at;
  }
  const top_authors = groupByAuthor(posts)
    .map((a) => ({
      handle: a.handle,
      display_name: a.display_name,
      avatar_url: a.avatar_url,
      posts: a.posts.length,
      latest_at: a.posts.reduce((m, p) => (time(p.published_at) > time(m) ? p.published_at : m), a.posts[0].published_at),
    }))
    .sort((a, b) => b.posts - a.posts || time(b.latest_at) - time(a.latest_at) || a.handle.localeCompare(b.handle));
  return {
    posts: posts.length,
    authors: top_authors.length,
    latest_at: latest,
    earliest_at: earliest,
    with_media: posts.filter((p) => p.media.length > 0).length,
    translated: posts.filter((p) => p.text_zh).length,
    by_hour,
    top_authors,
  };
}

const BEIJING = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "10-17 14:24", Beijing time. */
export function beijingTime(iso: string): string {
  const parts = Object.fromEntries(BEIJING.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A long URL shortened for display: no scheme or www, at most 36 characters. */
export function linkLabel(url: string): string {
  const bare = url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  return bare.length > 36 ? `${bare.slice(0, 35)}…` : bare;
}

// URLs are ASCII only, so a Chinese full stop or bracket right after a link
// ends it. Trailing punctuation that is almost never part of a URL is cut off.
const TOKEN = /(https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)|((?<![A-Za-z0-9_])@[A-Za-z0-9_]{1,15})/g;
const TRAILING = /[.,;:!?'"\]]$/;
const count = (s: string, ch: string) => s.split(ch).length - 1;

/** Splits trailing punctuation off a URL; a ")" stays when it closes a "(" inside the URL (…/Foo_(bar)). */
function trimUrl(url: string): [string, string] {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if (TRAILING.test(ch)) end--;
    else if (ch === ')' && count(url.slice(0, end), ')') > count(url.slice(0, end), '(')) end--;
    else break;
  }
  return [url.slice(0, end), url.slice(end)];
}

function linkifyLine(line: string): string {
  let out = '';
  let last = 0;
  for (const match of line.matchAll(TOKEN)) {
    let token = match[0];
    let tail = '';
    if (match[1]) [token, tail] = trimUrl(token);
    out += esc(line.slice(last, match.index));
    if (match[1] && isXUrl(token)) {
      out += `<span class="feed-xlink">${esc(linkLabel(token))}</span>${esc(tail)}`;
    } else if (match[1]) {
      out += `<a href="${esc(token)}" target="_blank" rel="noopener nofollow ugc">${esc(linkLabel(token))}</a>${esc(tail)}`;
    } else {
      out += `<span class="feed-mention">${esc(token)}</span>`;
    }
    last = match.index! + match[0].length;
  }
  return out + esc(line.slice(last));
}

/**
 * Post text as HTML: escaped, links linked (except links to X itself, kept as
 * text), @mentions as text, blank lines as paragraphs, single newlines kept.
 */
export function renderPostText(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .filter((para) => para.trim())
    .map((para) => `<p>${para.split('\n').map(linkifyLine).join('<br>')}</p>`)
    .join('');
}
