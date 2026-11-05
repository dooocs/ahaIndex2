-- Add one protected manual save slot per account to the existing save tables.
begin;

alter table public.dark_room_save_backups
  add column if not exists is_manual_slot boolean not null default false;

create unique index if not exists dark_room_one_manual_slot
  on public.dark_room_save_backups (user_id) where is_manual_slot;

comment on table public.dark_room_save_backups is '小黑屋存档，含每账号一份手动档和最近十份历史备份';
comment on column public.dark_room_save_backups.is_manual_slot is '玩家最后一次手动保存的快照，独立于历史轮转';

create or replace function public.dark_room_before_save() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.created_at := statement_timestamp();
  else
    if new.user_id <> old.user_id then
      raise exception 'dark_room: owner cannot change' using errcode = '22023';
    end if;
    if new.last_request_id = old.last_request_id then
      if new.state = old.state and new.schema_version = old.schema_version
         and new.game_version = old.game_version and new.last_operation = old.last_operation
         and new.device_id is not distinct from old.device_id then
        return null;
      end if;
      raise exception 'dark_room: request id reused with different content' using errcode = '22023';
    end if;
    new.revision := old.revision + 1;
    new.created_at := old.created_at;
  end if;
  new.state_hash := encode(sha256(convert_to(new.state::text, 'UTF8')), 'hex');
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

-- Run after the main row exists so the first write can also be a manual save.
-- The main row and its snapshots commit together under the account's row lock.
create or replace function public.dark_room_after_save() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.last_operation <> 'autosave' or not exists (
      select 1 from public.dark_room_save_backups b
      where b.user_id = new.user_id and not b.is_manual_slot
        and b.created_at > statement_timestamp() - interval '10 minutes'
    ) then
      insert into public.dark_room_save_backups
        (user_id, revision, state, schema_version, game_version, state_hash, device_id, reason, saved_at)
      values
        (old.user_id, old.revision, old.state, old.schema_version, old.game_version,
         old.state_hash, old.device_id, new.last_operation, old.updated_at)
      on conflict (user_id, revision) do nothing;
    end if;
  end if;

  if new.last_operation = 'manual' then
    update public.dark_room_save_backups
    set is_manual_slot = false
    where user_id = new.user_id and is_manual_slot;

    insert into public.dark_room_save_backups
      (user_id, revision, state, schema_version, game_version, state_hash, device_id, reason, saved_at, is_manual_slot)
    values
      (new.user_id, new.revision, new.state, new.schema_version, new.game_version,
       new.state_hash, new.device_id, 'manual', new.updated_at, true);
  end if;

  delete from public.dark_room_save_backups b
  where b.user_id = new.user_id and not b.is_manual_slot
    and b.revision in (
      select h.revision
      from public.dark_room_save_backups h
      where h.user_id = new.user_id and not h.is_manual_slot
      order by h.revision desc
      offset 10
    );
  return null;
end;
$$;

revoke all on function public.dark_room_before_save() from public, anon, authenticated;
revoke all on function public.dark_room_after_save() from public, anon, authenticated;

drop trigger if exists dark_room_after_save on public.dark_room_saves;
create trigger dark_room_after_save after insert or update on public.dark_room_saves
for each row execute function public.dark_room_after_save();

notify pgrst, 'reload schema';
commit;
