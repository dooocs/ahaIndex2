-- Integration test against the created tables. All fixtures roll back.
-- Uses one existing account's UUID solely as an FK target; never edits auth.users.
begin;
do $$
declare u uuid; i int; rev bigint; n int;
begin
  select id into u from auth.users order by id limit 1;
  if u is null then raise exception 'test requires one existing auth account'; end if;
  if exists(select 1 from public.dark_room_saves where user_id=u) then
    raise exception 'test refuses to touch an existing save';
  end if;
  perform set_config('dark_room.test_user',u::text,true);
  insert into public.dark_room_saves(user_id,state,revision,state_hash)
    values(u,'{"stores":{"wood":7},"中文":"测试"}',999,'ignored');
  if not exists(select 1 from public.dark_room_saves where user_id=u and revision=1 and length(state_hash)=64) then
    raise exception 'insert metadata/hash failed';
  end if;
  for i in 1..12 loop
    update public.dark_room_saves set state=jsonb_build_object('stores',jsonb_build_object('wood',i)),
      last_request_id=gen_random_uuid(),last_operation='manual',revision=999 where user_id=u;
  end loop;
  select revision into rev from public.dark_room_saves where user_id=u;
  select count(*) into n from public.dark_room_save_backups where user_id=u;
  if rev<>13 or n<>10 then raise exception 'revision/retention failed: %, %',rev,n; end if;
  update public.dark_room_saves set state=state where user_id=u;
  if (select revision from public.dark_room_saves where user_id=u)<>13 then raise exception 'idempotency failed'; end if;
  begin
    update public.dark_room_saves set state='[]',last_request_id=gen_random_uuid() where user_id=u;
    raise exception 'invalid state accepted';
  exception when check_violation then null;
  end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('dark_room.test_user'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('dark_room.test_user'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.dark_room_saves)<>1 then raise exception 'own-save read failed'; end if;
  if (select count(*) from public.dark_room_save_backups)<>10 then raise exception 'own-backup read failed'; end if;
  begin
    update public.dark_room_saves set state='{}';
    raise exception 'browser write unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ begin
  if exists(select 1 from public.dark_room_saves) or exists(select 1 from public.dark_room_save_backups) then
    raise exception 'cross-account read allowed';
  end if;
end $$;
reset role;
do $$ begin
  if has_table_privilege('anon','public.dark_room_saves','select') or has_table_privilege('anon','public.dark_room_save_backups','select') then
    raise exception 'anonymous access allowed';
  end if;
end $$;
rollback;
select 'PASS: hash, server revision, backup retention, retry, JSON validation, own/cross-account RLS, denied client writes and anonymous access; fixtures rolled back' as result;
