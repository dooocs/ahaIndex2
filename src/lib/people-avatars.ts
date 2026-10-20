// Photos for 人物, kept on the site's own OSS so every reader can load them.
// scripts/people-avatars.ts (the daily People Avatars workflow) fetches each
// published person's photo, stores it under media/people/avatars/ with its
// content hash in the name, and writes people.avatar_url. Separate from the
// 动态 pipeline: it reads only the people table and writes only that column
// and that prefix.
//
// Sources, in order: a photo set by hand (avatar_url outside the job's
// prefix) is never replaced; else the X profile picture (via unavatar.io, no
// API key); else the GitHub avatar (people.github_handle). Pure functions;
// the script does the network and storage.
import { createHash } from 'node:crypto';

export const AVATAR_PREFIX = 'media/people/avatars/';
export const SITE_ORIGIN = 'https://www.amazingindex.com/';
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MIN_AVATAR_BYTES = 512;

const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export interface AvatarPerson {
  id: string;
  slug: string;
  x_handle: string | null;
  github_handle: string | null;
  avatar_url: string | null;
}

export interface AvatarSource {
  name: 'x' | 'github';
  url: string;
}

/** A URL the job wrote (it may replace it); anything else was set by hand. */
export function isJobAvatar(url: string | null | undefined): boolean {
  return Boolean(url && url.startsWith(`${SITE_ORIGIN}${AVATAR_PREFIX}`));
}

/** Where to look, in order; empty when the photo was set by hand or there is no handle. */
export function avatarSources(p: AvatarPerson): AvatarSource[] {
  if (p.avatar_url && !isJobAvatar(p.avatar_url)) return [];
  const sources: AvatarSource[] = [];
  if (p.x_handle) sources.push({ name: 'x', url: `https://unavatar.io/x/${encodeURIComponent(p.x_handle)}?fallback=false` });
  if (p.github_handle) sources.push({ name: 'github', url: `https://github.com/${encodeURIComponent(p.github_handle)}.png?size=400` });
  return sources;
}

/** Why a downloaded body is not a usable photo, or null when it is. */
export function rejectImage(contentType: string | null, bytes: number): string | null {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!TYPES[type]) return `not an image (${type || 'no content type'})`;
  if (bytes < MIN_AVATAR_BYTES) return `too small (${bytes} bytes)`;
  if (bytes > MAX_AVATAR_BYTES) return `too large (${bytes} bytes)`;
  return null;
}

/** The object key for a photo: the same bytes always get the same key, new bytes a new one. */
export function avatarKey(slug: string, body: Uint8Array, contentType: string): string {
  const ext = TYPES[contentType.split(';')[0].trim().toLowerCase()];
  if (!ext) throw new Error(`Unsupported avatar type ${contentType}`);
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 12);
  return `${AVATAR_PREFIX}${slug}-${hash}.${ext}`;
}

export const avatarUrl = (key: string) => `${SITE_ORIGIN}${key}`;
