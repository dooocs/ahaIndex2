-- Exercise the save triggers with the server role. Fixture writes roll back.
begin;
select set_config('dark_room.test_user', coalesce((
  select u.id::text from auth.users u
  where not exists (select 1 from public.dark_room_saves s where s.user_id = u.id)
  order by u.id limit 1
), ''), true);
set local role service_role;
do $$
declare
  account_id uuid := nullif(current_setting('dark_room.test_user'), '')::uuid;
  first_manual jsonb := '{"stores":{"wood":20}}';
  next_manual jsonb := '{"stores":{"wood":99}}';
  step integer;
begin
  if account_id is null then
    raise exception 'test requires an auth account without a save';
  end if;

  insert into public.dark_room_saves (user_id, state, last_operation)
    values (account_id, first_manual, 'manual');
  if not exists (
    select 1 from public.dark_room_save_backups
    where user_id = account_id and revision = 1 and is_manual_slot and state = first_manual
  ) then
    raise exception 'first manual save was not captured';
  end if;

  for step in 2..4 loop
    update public.dark_room_saves
    set state = jsonb_build_object('stores', jsonb_build_object('wood', step)),
        last_request_id = gen_random_uuid(), last_operation = 'autosave'
    where user_id = account_id;
  end loop;
  if (select count(*) from public.dark_room_save_backups
      where user_id = account_id and not is_manual_slot) <> 1 then
    raise exception 'ordinary autosaves should throttle historical checkpoints';
  end if;

  for step in 5..16 loop
    -- Advance only the test history's timestamps to exercise repeated rotation.
    update public.dark_room_save_backups
    set created_at = statement_timestamp() - interval '11 minutes'
    where user_id = account_id and not is_manual_slot;
    update public.dark_room_saves
    set state = jsonb_build_object('stores', jsonb_build_object('wood', step)),
        last_request_id = gen_random_uuid(), last_operation = 'autosave'
    where user_id = account_id;
  end loop;
  if (select count(*) from public.dark_room_save_backups
      where user_id = account_id and not is_manual_slot) <> 10
     or not exists (
       select 1 from public.dark_room_save_backups
       where user_id = account_id and revision = 1 and is_manual_slot and state = first_manual
     ) then
    raise exception 'automatic rotation lost the protected slot or exceeded ten history rows';
  end if;

  update public.dark_room_saves
  set state = next_manual, last_request_id = gen_random_uuid(), last_operation = 'manual'
  where user_id = account_id;
  if (select count(*) from public.dark_room_save_backups
      where user_id = account_id and is_manual_slot) <> 1
     or not exists (
       select 1 from public.dark_room_save_backups
       where user_id = account_id and revision = 17 and is_manual_slot and state = next_manual
     ) or not exists (
       select 1 from public.dark_room_save_backups
       where user_id = account_id and revision = 16 and not is_manual_slot
     ) then
    raise exception 'manual replacement failed to preserve both the new slot and the previous checkpoint';
  end if;

  update public.dark_room_saves set state = state where user_id = account_id;
  if (select revision from public.dark_room_saves where user_id = account_id) <> 17
     or (select count(*) from public.dark_room_save_backups where user_id = account_id) <> 11 then
    raise exception 'request retry changed the revision or snapshot count';
  end if;
end $$;
rollback;
select 'PASS: first manual save, autosave throttling and rotation, manual replacement, idempotency, rollback' as result;
