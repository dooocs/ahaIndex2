// Visibility is a convenience. Every privileged operation is checked again by
// the Function against GoTrue and the database's pinned site_owner account.
export const SITE_OWNER_EMAIL = 'szqsunny@outlook.com';

export function isSiteOwnerCandidate(user: {
  id?: string; email?: string; email_confirmed_at?: string | null;
  is_anonymous?: boolean; banned_until?: string | null;
} | null | undefined): boolean {
  return Boolean(user?.id && user.email?.trim().toLowerCase() === SITE_OWNER_EMAIL
    && user.email_confirmed_at && !user.is_anonymous
    && !(user.banned_until && Date.parse(user.banned_until) > Date.now()));
}

export const PEOPLE_PHOTO_BUCKET = 'people-portraits';

export function validPortraitUrl(value: unknown, projectUrl: string): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === new URL(projectUrl).origin && !url.username && !url.password
      && !url.search && !url.hash
      && /^\/storage\/v1\/object\/public\/people-portraits\/[a-z0-9][a-z0-9-]*\/[0-9a-f-]{36}\.jpg$/.test(url.pathname);
  } catch { return false; }
}
