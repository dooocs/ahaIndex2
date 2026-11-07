-- Installed directly in the existing Aliyun project. Only the authenticated
-- Edge Function may call this dispatcher with its verified account ID.
begin;
create or replace function public.dark_room_api(p_user_id uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  current_save public.dark_room_saves;
  chosen public.dark_room_save_backups;
  next_state jsonb;
  operation text;
  request_id uuid;
  device uuid;
  expected bigint;
  slots jsonb;
begin
  if p_user_id is null or p_action not in ('read', 'save', 'restore') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  -- Also serialize first-save races, when there is no row to lock yet.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dark-room:' || p_user_id::text, 0));
  select * into current_save from public.dark_room_saves where user_id = p_user_id for update;

  if p_action = 'read' then
    select coalesce(jsonb_agg(to_jsonb(b) - 'state' - 'user_id' order by b.revision desc), '[]'::jsonb)
      into slots from public.dark_room_save_backups b where b.user_id = p_user_id;
    return jsonb_build_object('latest', case when current_save.user_id is null then null else to_jsonb(current_save) - 'user_id' end, 'slots', slots);
  end if;

  request_id := (p_payload->>'request_id')::uuid;
  device := (p_payload->>'device_id')::uuid;
  expected := (p_payload->>'expected_revision')::bigint;
  operation := case when p_action = 'restore' then 'restore' else p_payload->>'operation' end;
  if request_id is null or device is null or expected is null or expected < 0
     or operation is null or operation not in ('autosave','manual','import','reset','restore','conflict') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- Check the last committed request before CAS so a lost response can be retried.
  if current_save.last_request_id = request_id then
    if current_save.device_id is distinct from device or current_save.last_operation <> operation
       or (p_action = 'save' and current_save.state is distinct from p_payload->'state') then
      raise exception 'request_id_reused' using errcode = '22023';
    end if;
    return jsonb_build_object('latest', to_jsonb(current_save) - 'user_id');
  end if;
  if expected <> coalesce(current_save.revision, 0) then
    return jsonb_build_object('error', 'conflict', 'latest', case when current_save.user_id is null then null else to_jsonb(current_save) - 'user_id' end);
  end if;
  if p_action = 'restore' then
    select * into chosen from public.dark_room_save_backups
      where user_id = p_user_id and revision = (p_payload->>'revision')::bigint;
    if chosen.user_id is null or chosen.schema_version <> 1 then
      raise exception 'save_unavailable' using errcode = '22023';
    end if;
    next_state := chosen.state;
  else
    next_state := p_payload->'state';
  end if;
  -- Keep the engine's supported 1.3 state format and reject malformed imports.
  if next_state is null or jsonb_typeof(next_state) <> 'object'
     or next_state->>'version' is distinct from '1.3'
     or octet_length(next_state::text) > 1048576 then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  if current_save.user_id is null then
    insert into public.dark_room_saves
      (user_id, state, state_hash, last_request_id, device_id, last_operation)
      values (p_user_id, next_state, repeat('0',64), request_id, device, operation)
      returning * into current_save;
  else
    update public.dark_room_saves set state = next_state, schema_version = 1, game_version = '1.3',
      last_request_id = request_id, device_id = device, last_operation = operation
      where user_id = p_user_id and revision = expected returning * into current_save;
  end if;
  return jsonb_build_object('latest', to_jsonb(current_save) - 'user_id');
end;
$$;
revoke all on function public.dark_room_api(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.dark_room_api(uuid,text,jsonb) to service_role;
comment on table public.dark_room_saves is '小黑屋，每个账号一份最新进度，由鉴权接口校验版本后写入';
notify pgrst, 'reload schema';
commit;
