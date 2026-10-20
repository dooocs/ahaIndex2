-- 人物头像: people.avatar_url (only the site's own OSS, so every reader can
-- load it) and people.github_handle (a second avatar source for developers).
-- The daily People Avatars job (.github/workflows/people-avatars.yml) fills
-- avatar_url under media/people/avatars/; a URL anywhere else was set by hand
-- and the job leaves it alone. Re-running is safe.

alter table public.people
  add column if not exists avatar_url text
    check (avatar_url ~ '^https://www\.amazingindex\.com/[^?#\s]+$'),
  add column if not exists github_handle text
    check (github_handle ~ '^[A-Za-z0-9-]{1,39}$');

-- updated_at dates the sitemap entry: bump it only when something other than
-- the photo changes (the avatar job must not make every page look edited).
create or replace function public.people_touch_updated_at() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'avatar_url' - 'updated_at') is distinct from (to_jsonb(old) - 'avatar_url' - 'updated_at') then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end
$$;
