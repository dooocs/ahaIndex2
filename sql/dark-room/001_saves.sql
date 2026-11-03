-- 小黑屋专用表，部署到现有阿里云 amazingindex 项目。
-- This is storage preparation, not browser cloud-sync activation.
-- Clients may read only their own rows. All writes remain server-only until
-- an authenticated, revision-checked save API is implemented and tested.
begin;
create table if not exists public.dark_room_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 1048576),
  revision bigint not null default 1 check (revision > 0),
  schema_version integer not null default 1 check (schema_version > 0),
  game_version text not null default '1.3' check (char_length(game_version) between 1 and 32),
  state_hash text not null check (char_length(state_hash) = 64),
  last_request_id uuid not null default gen_random_uuid(),
  device_id uuid,
  last_operation text not null default 'autosave' check (last_operation in ('autosave','manual','import','reset','restore','conflict')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.dark_room_save_backups (
  user_id uuid not null references public.dark_room_saves(user_id) on delete cascade,
  revision bigint not null check (revision > 0),
  state jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 1048576),
  schema_version integer not null check (schema_version > 0),
  game_version text not null,
  state_hash text not null check (char_length(state_hash) = 64),
  device_id uuid,
  reason text not null check (reason in ('autosave','manual','import','reset','restore','conflict')),
  saved_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, revision)
);
comment on table public.dark_room_saves is '小黑屋：每个网站账号一条主存档；客户端写入尚未开放';
comment on table public.dark_room_save_backups is '小黑屋：自动/操作前检查点，每个账号最多10份';
-- The (user_id, revision) primary key supports own-user lookups and reverse
-- revision scans; no redundant user_id or JSONB GIN index is needed.
alter table public.dark_room_saves enable row level security;
alter table public.dark_room_save_backups enable row level security;
revoke all on public.dark_room_saves, public.dark_room_save_backups from public, anon, authenticated;
grant select on public.dark_room_saves, public.dark_room_save_backups to authenticated;
grant all on public.dark_room_saves, public.dark_room_save_backups to service_role;
drop policy if exists dark_room_saves_read_own on public.dark_room_saves;
create policy dark_room_saves_read_own on public.dark_room_saves for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists dark_room_backups_read_own on public.dark_room_save_backups;
create policy dark_room_backups_read_own on public.dark_room_save_backups for select to authenticated
  using ((select auth.uid()) = user_id);

-- No SECURITY DEFINER. Revision/backup changes are atomic with the row write.
-- A future API must additionally use WHERE revision = expected_revision and
-- authenticate the row owner before invoking a server-side write.
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
      if new.state = old.state and new.schema_version = old.schema_version and new.game_version = old.game_version then
        return null; -- a retry of the last committed request creates no new version
      end if;
      raise exception 'dark_room: request id reused with different content' using errcode = '22023';
    end if;
    -- Ordinary saves make a checkpoint at most once per ten minutes.
    -- Explicit imports/resets/restores/conflict resolutions always keep old state.
    if new.last_operation in ('manual','import','reset','restore','conflict')
       or not exists (select 1 from public.dark_room_save_backups b
                      where b.user_id = old.user_id and b.created_at > statement_timestamp() - interval '10 minutes') then
      insert into public.dark_room_save_backups
        (user_id,revision,state,schema_version,game_version,state_hash,device_id,reason,saved_at)
      values (old.user_id,old.revision,old.state,old.schema_version,old.game_version,old.state_hash,old.device_id,new.last_operation,old.updated_at)
      on conflict (user_id,revision) do nothing;
      delete from public.dark_room_save_backups b
      where b.user_id = old.user_id and b.revision not in
        (select x.revision from public.dark_room_save_backups x where x.user_id = old.user_id order by x.revision desc limit 10);
    end if;
    new.revision := old.revision + 1;
    new.created_at := old.created_at;
  end if;
  new.state_hash := encode(sha256(convert_to(new.state::text, 'UTF8')), 'hex');
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function public.dark_room_before_save() from public, anon, authenticated;
drop trigger if exists dark_room_before_save on public.dark_room_saves;
create trigger dark_room_before_save before insert or update on public.dark_room_saves
for each row execute function public.dark_room_before_save();
notify pgrst, 'reload schema';
commit;
