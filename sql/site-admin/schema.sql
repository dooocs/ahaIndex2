-- Repeatable Aliyun setup. Resolve the verified owner once; never grant access
-- from browser-supplied email, user_metadata, or a self-registration trigger.
begin;
create table if not exists public.site_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.site_owner enable row level security;
revoke all on public.site_owner from public, anon, authenticated;
grant select on public.site_owner to service_role;
do $$
declare owner_id uuid;
begin
  select id into strict owner_id from auth.users
    where lower(email) = 'szqsunny@outlook.com' and email_confirmed_at is not null
      and not coalesce(is_anonymous, false) and (banned_until is null or banned_until <= now());
  insert into public.site_owner(singleton, user_id) values (true, owner_id) on conflict (singleton) do nothing;
  if not exists (select 1 from public.site_owner where user_id = owner_id) then
    raise exception 'Pinned site owner differs; manual review required';
  end if;
exception when no_data_found then raise exception 'The site owner must complete email login first';
end $$;

create or replace function public.site_admin_authorize(p_actor uuid) returns boolean
language sql stable security invoker set search_path = public as $$
  -- Current email, verification and ban state are checked against GoTrue by
  -- authorizeSiteOwner. This service-only guard additionally pins the UUID.
  select exists (select 1 from public.site_owner o where o.user_id = p_actor)
$$;
revoke all on function public.site_admin_authorize(uuid) from public, anon, authenticated;
grant execute on function public.site_admin_authorize(uuid) to service_role;

alter table public.persons add column if not exists avatar_is_manual boolean not null default false;
create table if not exists public.people_portrait_history (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete cascade,
  object_path text not null unique,
  avatar_url text not null,
  uploaded_by uuid not null,
  created_at timestamptz not null default now()
);
alter table public.people_portrait_history enable row level security;
revoke all on public.people_portrait_history from public, anon, authenticated;
grant select, insert on public.people_portrait_history to service_role;

create or replace function public.people_photo_api(p_action text, p_actor uuid default null, p_payload jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path = public as $$
declare p public.persons; v_url text; v_path text;
begin
  if p_action = 'list' then
    if jsonb_typeof(p_payload->'slugs') is distinct from 'array' then raise exception 'invalid_request' using errcode = '22023'; end if;
    if jsonb_array_length(p_payload->'slugs') > 100 then raise exception 'invalid_request' using errcode = '22023'; end if;
    return jsonb_build_object('photos', coalesce((select jsonb_agg(jsonb_build_object('slug', x.slug, 'avatar_url', x.avatar_url))
      from public.persons x where x.status = 'published'
        and x.slug in (select jsonb_array_elements_text(p_payload->'slugs'))), '[]'::jsonb));
  end if;
  if not public.site_admin_authorize(p_actor) then raise exception 'owner_required' using errcode = '42501'; end if;
  if p_action = 'access' then return jsonb_build_object('owner', true); end if;
  if p_action not in ('inspect', 'save') then raise exception 'invalid_request' using errcode = '22023'; end if;
  select * into p from public.persons where slug = p_payload->>'slug' and status = 'published' for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not (p_payload ? 'expected_avatar') or p.avatar_url is distinct from nullif(p_payload->>'expected_avatar', '') then
    raise exception 'photo_conflict' using errcode = 'P0001';
  end if;
  if p_action = 'inspect' then return jsonb_build_object('ok', true); end if;
  v_path := p_payload->>'object_path';
  v_url := p_payload->>'avatar_url';
  if v_path is null or v_path !~ ('^' || p.slug || '/[0-9a-f-]{36}\.jpg$')
    or v_url is distinct from ('https://spb-x6r06737x2zdpg3x.supabase.opentrust.net/storage/v1/object/public/people-portraits/' || v_path) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  -- This narrowly scoped system edit changes only photo fields; editorial
  -- drafts stay pending. Their stale photo fields cannot undo the owner's edit.
  perform set_config('app.system', 'on', true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  update public.persons set avatar_url = v_url, avatar_is_manual = true,
    draft = draft - 'avatar_url' - 'avatar_is_manual' where id = p.id;
  insert into public.people_portrait_history(person_id, object_path, avatar_url, uploaded_by)
    values (p.id, v_path, v_url, p_actor);
  return jsonb_build_object('avatar_url', v_url);
end $$;
revoke all on function public.people_photo_api(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.people_photo_api(text, uuid, jsonb) to service_role;

-- Also protects manual photos from an automatic job already queued before the
-- edit. The snapshot consumer and the daily avatar job keep their old contract.
create or replace function public.worker_set_avatar(p_slug text, p_url text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from persons where slug = p_slug) then raise exception '人物不存在：%', p_slug; end if;
  perform set_config('app.system', 'on', true);
  update persons set avatar_url = p_url where slug = p_slug and not avatar_is_manual and avatar_url is distinct from p_url;
end $$;
revoke all on function public.worker_set_avatar(text, text) from public, anon, authenticated;
grant execute on function public.worker_set_avatar(text, text) to service_role;

create or replace function public.people_photo_function_only() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated')
    and (new.avatar_url is distinct from old.avatar_url or new.avatar_is_manual is distinct from old.avatar_is_manual) then
    raise exception 'Photo writes require the owner Function' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists people_photo_function_only on public.persons;
create trigger people_photo_function_only before update on public.persons
  for each row execute function public.people_photo_function_only();
revoke all on function public.people_photo_function_only() from public, anon, authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('people-portraits', 'people-portraits', true, 900000, array['image/jpeg'])
on conflict(id) do update set public = true, file_size_limit = 900000, allowed_mime_types = array['image/jpeg'];
-- Public reads are intentional. Browser writes remain forbidden even if an
-- unrelated permissive Storage policy is added later. Only the Function writes.
drop policy if exists portrait_no_browser_insert on storage.objects;
create policy portrait_no_browser_insert on storage.objects as restrictive for insert to anon, authenticated with check (bucket_id <> 'people-portraits');
drop policy if exists portrait_no_browser_update on storage.objects;
create policy portrait_no_browser_update on storage.objects as restrictive for update to anon, authenticated using (bucket_id <> 'people-portraits') with check (bucket_id <> 'people-portraits');
drop policy if exists portrait_no_browser_delete on storage.objects;
create policy portrait_no_browser_delete on storage.objects as restrictive for delete to anon, authenticated using (bucket_id <> 'people-portraits');
commit;
