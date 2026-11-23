-- Run AFTER schema.sql. Every write rolls back, including portrait history.
begin;
do $$
begin
  if has_function_privilege('anon', 'public.site_admin_authorize(uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.people_photo_api(text,uuid,jsonb)', 'execute')
    or has_table_privilege('authenticated', 'public.site_owner', 'insert')
    or has_table_privilege('authenticated', 'public.people_portrait_history', 'insert') then
    raise exception 'Browser role has privileged access';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('portrait_no_browser_insert','portrait_no_browser_update','portrait_no_browser_delete')
    and permissive = 'RESTRICTIVE') <> 3 then raise exception 'Storage write restrictions missing'; end if;
end $$;
set local role service_role;
do $$
declare owner_id uuid; p public.persons; photo jsonb; old_draft jsonb;
  object_path text; avatar text;
begin
  select user_id into strict owner_id from public.site_owner;
  if not public.site_admin_authorize(owner_id) then raise exception 'Pinned owner rejected'; end if;
  if public.site_admin_authorize(gen_random_uuid()) then raise exception 'Another UUID accepted'; end if;
  begin
    perform public.people_photo_api('access', gen_random_uuid());
    raise exception 'Other user reached privileged dispatcher';
  exception when insufficient_privilege then null; end;
  select * into strict p from public.persons where status = 'published' order by slug limit 1;
  old_draft := p.draft;
  object_path := p.slug || '/' || gen_random_uuid()::text || '.jpg';
  avatar := 'https://spb-x6r06737x2zdpg3x.supabase.opentrust.net/storage/v1/object/public/people-portraits/' || object_path;
  photo := jsonb_build_object('slug', p.slug, 'expected_avatar', coalesce(p.avatar_url, ''), 'object_path', object_path, 'avatar_url', avatar);
  perform public.people_photo_api('save', owner_id, photo);
  if not exists (select 1 from public.persons where id = p.id and avatar_url = avatar and avatar_is_manual
    and draft is not distinct from (old_draft - 'avatar_url' - 'avatar_is_manual')) then raise exception 'Manual save/draft preservation failed'; end if;
  if not exists (select 1 from public.people_portrait_history h where h.object_path = photo->>'object_path' and h.uploaded_by = owner_id) then raise exception 'Uploader audit missing'; end if;
  begin
    perform public.people_photo_api('save', owner_id, photo);
    raise exception 'Stale edit accepted';
  exception when raise_exception then if sqlerrm <> 'photo_conflict' then raise; end if; end;
  perform public.worker_set_avatar(p.slug, 'https://www.amazingindex.com/media/people/avatars/automatic.jpg');
  if not exists (select 1 from public.persons where id = p.id and avatar_url = avatar) then raise exception 'Automatic job replaced manual photo'; end if;
end $$;
rollback;
