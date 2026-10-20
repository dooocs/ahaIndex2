-- 人物 (/people): one row per person in `people` (the directory), the rest of
-- the page in `person_profiles`. Apply once to the news database (the one the
-- build reads with SUPABASE_URL / SUPABASE_BUILD_KEY). Re-running is safe.
--
-- Readers (anon / authenticated, i.e. the build's key) can only SELECT
-- published rows. Writes go through the table editor or the service role;
-- no role but those can change anything. No SECURITY DEFINER functions.
--
-- How to fill the rows: docs/people.md.

create table if not exists public.people (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique
                   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name             text not null check (btrim(name) <> ''),
  name_zh          text,
  x_handle         text check (x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  person_group     text not null
                   check (person_group in ('掌舵人', '研究者', '独立开发者', '布道者')),
  role             text not null check (btrim(role) <> ''),
  tier             text check (tier in ('必看', '值得关注', '了解即可')),
  -- 蜗牛说. A person is "written" (indexed, in the sitemap) once this is set.
  take_text        text check (take_text is null or btrim(take_text) <> ''),
  take_updated_at  date,
  status           text not null default 'draft' check (status in ('draft', 'published')),
  -- Retired /subjects/<slug> URLs that redirect here, e.g. {person:lei-jun}.
  former_subjects  text[] not null default '{}',
  added_at         date not null default current_date,
  updated_at       timestamptz not null default now()
);

create unique index if not exists people_x_handle_key on public.people (lower(x_handle)) where x_handle is not null;

create table if not exists public.person_profiles (
  person_id   uuid primary key references public.people (id) on delete cascade,
  born        text,
  fields      text[] not null default '{}',
  -- Lists of objects; their shapes are in docs/people.md and checked by the build.
  events      jsonb not null default '[]' check (jsonb_typeof(events) = 'array'),
  record      jsonb not null default '[]' check (jsonb_typeof(record) = 'array'),
  labels      jsonb not null default '[]' check (jsonb_typeof(labels) = 'array'),
  stances     jsonb not null default '[]' check (jsonb_typeof(stances) = 'array'),
  compare     jsonb not null default '[]' check (jsonb_typeof(compare) = 'array'),
  updated_at  timestamptz not null default now()
);

-- updated_at follows every edit (it dates the sitemap entry).
create or replace function public.people_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists people_touch_updated_at on public.people;
create trigger people_touch_updated_at before update on public.people
  for each row execute function public.people_touch_updated_at();

drop trigger if exists person_profiles_touch_updated_at on public.person_profiles;
create trigger person_profiles_touch_updated_at before update on public.person_profiles
  for each row execute function public.people_touch_updated_at();

alter table public.people enable row level security;
alter table public.person_profiles enable row level security;

drop policy if exists people_read_published on public.people;
create policy people_read_published on public.people
  for select to anon, authenticated
  using (status = 'published');

drop policy if exists person_profiles_read_published on public.person_profiles;
create policy person_profiles_read_published on public.person_profiles
  for select to anon, authenticated
  using (exists (select 1 from public.people p where p.id = person_id and p.status = 'published'));

revoke all on public.people, public.person_profiles from anon, authenticated;
grant select on public.people, public.person_profiles to anon, authenticated;
