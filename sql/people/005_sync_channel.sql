-- =====================================================================
-- 官方 Supabase（aha index）· 人物同步通道
-- 阿里云是人物内容的唯一来源；本库只存发布快照（给 GitHub 构建读）
-- 和一个消息箱（GitHub 任务把头像、AI 提议交给阿里云）。
--
-- 阿里云的同步任务只持有一个“同步令牌”，只能调用下面四个函数：
--   people_sync_push   写入 / 删除发布快照
--   people_sync_state  对账：返回每个人的快照指纹
--   people_sync_pull   取消息箱里未处理的消息
--   people_sync_ack    回报消息处理结果
-- 这四个函数是 SECURITY DEFINER，是本库“不用 DEFINER”约定的有意例外：
-- 换成 service_role 密钥会让阿里云拿到本库的全部权限。
-- =====================================================================

-- 发布快照：一行一个已发布人物，内容是阿里云 person_public() 的输出
create table public.people_snapshots (
  person_id           uuid primary key,
  slug                text not null unique,
  payload             jsonb not null,
  content_hash        text not null,
  source_generated_at timestamptz,
  synced_at           timestamptz not null default now()
);
comment on table public.people_snapshots is '人物发布快照，由阿里云同步任务写入，只读。不要手改，会被覆盖。';

alter table public.people_snapshots enable row level security;
create policy people_snapshots_read on public.people_snapshots for select to anon, authenticated using (true);
revoke all on public.people_snapshots from anon, authenticated;
grant select on public.people_snapshots to anon, authenticated;

-- 消息箱：GitHub 任务写入，阿里云同步任务取走
create table public.people_outbox (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('avatar', 'proposal')),
  person_slug text not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  created_by  text not null default current_user,
  attempts    int not null default 0,
  last_error  text,
  consumed_at timestamptz
);
create index people_outbox_pending_idx on public.people_outbox (id) where consumed_at is null;
comment on table public.people_outbox is '交给阿里云的人物消息。avatar: {"avatar_url": "..."}；proposal: AI 修改提议。';

alter table public.people_outbox enable row level security;
revoke all on public.people_outbox from anon, authenticated;

-- 同步令牌：只存哈希，明文只在阿里云 Vault 里
create table public.people_sync_tokens (
  id           bigint generated always as identity primary key,
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  note         text,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);
alter table public.people_sync_tokens enable row level security;
revoke all on public.people_sync_tokens from anon, authenticated;

-- 同步状态：给构建和监控看最近一次同步时间
create table public.people_sync_status (
  id           smallint primary key default 1 check (id = 1),
  last_push_at timestamptz,
  last_pull_at timestamptz,
  last_result  jsonb
);
insert into public.people_sync_status (id) values (1);
alter table public.people_sync_status enable row level security;
create policy people_sync_status_read on public.people_sync_status for select to anon, authenticated using (true);
revoke all on public.people_sync_status from anon, authenticated;
grant select on public.people_sync_status to anon, authenticated;

create function public._people_sync_auth(p_token text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_token is null or length(p_token) < 32 or not exists (
    select 1 from public.people_sync_tokens
     where token_sha256 = encode(extensions.digest(p_token, 'sha256'), 'hex')
       and revoked_at is null
  ) then
    raise exception 'invalid sync token' using errcode = '42501';
  end if;
end $$;

-- 写入 / 删除快照。p_upserts: [{person_id, slug, payload, content_hash, source_generated_at}]
create function public.people_sync_push(p_token text, p_upserts jsonb default '[]', p_deletes uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_up  int := 0;
  v_del int := 0;
  r     jsonb;
begin
  perform public._people_sync_auth(p_token);
  if jsonb_typeof(p_upserts) <> 'array' then raise exception 'p_upserts must be an array'; end if;

  for r in select * from jsonb_array_elements(p_upserts) loop
    -- 换了 slug 的人：先腾出旧 slug
    delete from public.people_snapshots
     where slug = r->>'slug' and person_id <> (r->>'person_id')::uuid;
    insert into public.people_snapshots (person_id, slug, payload, content_hash, source_generated_at, synced_at)
    values ((r->>'person_id')::uuid, r->>'slug', r->'payload', r->>'content_hash',
            (r->>'source_generated_at')::timestamptz, now())
    on conflict (person_id) do update
       set slug = excluded.slug, payload = excluded.payload, content_hash = excluded.content_hash,
           source_generated_at = excluded.source_generated_at, synced_at = now()
     where public.people_snapshots.content_hash is distinct from excluded.content_hash
        or public.people_snapshots.slug is distinct from excluded.slug;
    if found then v_up := v_up + 1; end if;
  end loop;

  delete from public.people_snapshots where person_id = any(coalesce(p_deletes, '{}'));
  get diagnostics v_del = row_count;

  update public.people_sync_status
     set last_push_at = now(), last_result = jsonb_build_object('upserted', v_up, 'deleted', v_del)
   where id = 1;
  return jsonb_build_object('upserted', v_up, 'deleted', v_del);
end $$;

create function public.people_sync_state(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._people_sync_auth(p_token);
  return coalesce((select jsonb_object_agg(person_id::text, content_hash) from public.people_snapshots), '{}'::jsonb);
end $$;

create function public.people_sync_pull(p_token text, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public._people_sync_auth(p_token);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'kind', o.kind, 'person_slug', o.person_slug, 'payload', o.payload,
           'created_at', o.created_at, 'attempts', o.attempts) order by o.id), '[]'::jsonb)
    into v
    from (select * from public.people_outbox where consumed_at is null
           order by id limit greatest(1, least(coalesce(p_limit, 50), 500))) o;
  update public.people_sync_status set last_pull_at = now() where id = 1;
  return v;
end $$;

-- p_results: [{id, ok, error}]。失败 5 次后视为处理完毕，错误留在 last_error 里
create function public.people_sync_ack(p_token text, p_results jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  n int := 0;
begin
  perform public._people_sync_auth(p_token);
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    if coalesce((r->>'ok')::boolean, false) then
      update public.people_outbox set consumed_at = now(), last_error = null
       where id = (r->>'id')::bigint and consumed_at is null;
    else
      update public.people_outbox
         set attempts = attempts + 1, last_error = left(r->>'error', 1000),
             consumed_at = case when attempts + 1 >= 5 then now() end
       where id = (r->>'id')::bigint and consumed_at is null;
    end if;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

revoke all on function public._people_sync_auth(text) from public, anon, authenticated;
revoke all on function public.people_sync_push(text, jsonb, uuid[]),
                       public.people_sync_state(text),
                       public.people_sync_pull(text, int),
                       public.people_sync_ack(text, jsonb) from public;
grant execute on function public.people_sync_push(text, jsonb, uuid[]),
                          public.people_sync_state(text),
                          public.people_sync_pull(text, int),
                          public.people_sync_ack(text, jsonb) to anon, authenticated, service_role;
