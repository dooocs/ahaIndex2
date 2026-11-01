-- =====================================================================
-- 阿里云 Supabase · 人物同步任务（阿里云 ⇄ 官方 Supabase）
-- 前置：001、003 已执行；aliyun_004 已存好 Vault 配置；官方库已建同步通道并登记令牌。
--
--   people_sync_push_run()   每 2 分钟：把待导出的人物推成官方库的发布快照
--   people_sync_pull_run()   每 10 分钟：取官方库消息箱里的头像消息，写进阿里云
--   people_sync_reconcile()  每天一次：逐人比对两边快照指纹，不一致的重新排队
--   people_sync_overview()   随时查看：任务积压、最近错误
--
-- 这些函数会读 Vault 里的令牌，只有直连数据库的会话（SQL 编辑器、pg_cron）能调用。
-- 执行：整段粘贴执行。末尾会立刻跑一次推送和对账，并注册定时任务。
-- =====================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists http with schema extensions;

begin;

-- ---------------------------------------------------------------------
-- 调用官方库的同步函数。令牌只在这里拼进请求体，任何报错信息都不含令牌。
-- ---------------------------------------------------------------------
create or replace function public._people_sync_call(p_fn text, p_body jsonb default '{}')
returns jsonb language plpgsql set search_path = public, extensions as $$
declare
  v_url text;
  v_key text;
  v_tok text;
  r     extensions.http_response;
begin
  if p_fn not in ('people_sync_push', 'people_sync_state', 'people_sync_pull', 'people_sync_ack') then
    raise exception '不支持的同步函数：%', p_fn;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'people_sync_official_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'people_sync_official_key';
  select decrypted_secret into v_tok from vault.decrypted_secrets where name = 'people_sync_token';
  if v_url is null or v_key is null or v_tok is null then
    raise exception '缺少同步配置：请先执行 aliyun_004_sync_secrets.sql';
  end if;

  perform set_config('http.curlopt_timeout_ms', '30000', true);
  r := extensions.http((
    'POST', v_url || '/rest/v1/rpc/' || p_fn,
    array[extensions.http_header('apikey', v_key)],
    'application/json',
    (coalesce(p_body, '{}'::jsonb) || jsonb_build_object('p_token', v_tok))::text
  )::extensions.http_request);

  if r.status <> 200 then
    raise exception '官方库 % 返回 %：%', p_fn, r.status, left(r.content, 500);
  end if;
  return r.content::jsonb;
end $$;

-- ---------------------------------------------------------------------
-- 推送：认领排队中的导出任务 → 生成发布内容 → 一次性推给官方库
-- 认领时先把任务改成 running：认领之后发生的新修改会排一条新任务，不会被吞掉。
-- ---------------------------------------------------------------------
create or replace function public.people_sync_push_run(p_limit int default 100)
returns jsonb language plpgsql set search_path = public, extensions as $$
declare
  j       record;
  v_slug  text;
  v_pay   jsonb;
  v_ids   uuid[] := '{}';
  v_ups   jsonb := '[]';
  v_dels  uuid[] := '{}';
  v_res   jsonb;
  v_err   text;
begin
  for j in
    update jobs
       set status = 'running', locked_at = now(), locked_by = 'pg_cron', attempts = attempts + 1, updated_at = now()
     where id in (select id from jobs
                   where kind in ('export_person', 'export_index') and status = 'queued' and run_after <= now()
                   order by run_after
                   for update skip locked
                   limit greatest(1, coalesce(p_limit, 100)))
    returning *
  loop
    v_ids := v_ids || j.id;
    continue when j.kind <> 'export_person';
    select p.slug into v_slug from persons p
     where p.id = (j.payload->>'person_id')::uuid and p.status = 'published';
    if v_slug is null then
      v_dels := v_dels || (j.payload->>'person_id')::uuid;
    else
      v_pay := public.person_public(v_slug);
      v_ups := v_ups || jsonb_build_object(
        'person_id', j.payload->>'person_id', 'slug', v_slug, 'payload', v_pay,
        'content_hash', md5((v_pay - 'generated_at')::text),
        'source_generated_at', v_pay->>'generated_at');
    end if;
  end loop;

  if cardinality(v_ids) = 0 then
    return jsonb_build_object('jobs', 0);
  end if;

  begin
    v_res := public._people_sync_call('people_sync_push',
               jsonb_build_object('p_upserts', v_ups, 'p_deletes', to_jsonb(v_dels)));
    update jobs set status = 'done', last_error = null, locked_at = null, updated_at = now()
     where id = any(v_ids);
    return jsonb_build_object('jobs', cardinality(v_ids), 'upserts', jsonb_array_length(v_ups),
                              'deletes', cardinality(v_dels), 'official', v_res);
  exception when others then
    v_err := left(sqlerrm, 1000);
  end;

  -- 失败：退回排队并退避重试；同一人已有新排队任务的，这条视为被取代
  update jobs j2
     set status = case when j2.attempts >= 8 then 'failed' else 'queued' end,
         last_error = v_err, locked_at = null, updated_at = now(),
         run_after = now() + make_interval(mins => least(60, j2.attempts * j2.attempts))
   where j2.id = any(v_ids)
     and not exists (select 1 from jobs q where q.kind = j2.kind and q.dedupe_key = j2.dedupe_key
                                            and q.status = 'queued' and q.id <> j2.id);
  update jobs set status = 'done', last_error = '被新任务取代：' || v_err, locked_at = null, updated_at = now()
   where id = any(v_ids) and status = 'running';
  return jsonb_build_object('jobs', cardinality(v_ids), 'error', v_err);
end $$;

-- ---------------------------------------------------------------------
-- 头像：只在地址真的变化时才更新，避免每次同步都产生一条修订
-- ---------------------------------------------------------------------
create or replace function public.worker_set_avatar(p_slug text, p_url text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from persons where slug = p_slug) then
    raise exception '人物不存在：%', p_slug;
  end if;
  perform set_config('app.system', 'on', true);
  update persons set avatar_url = p_url where slug = p_slug and avatar_url is distinct from p_url;
end $$;

-- ---------------------------------------------------------------------
-- 拉取：处理官方库消息箱。proposal（AI 提议）在第 6 步接入，现在先不认领。
-- ---------------------------------------------------------------------
create or replace function public.people_sync_pull_run(p_limit int default 50)
returns jsonb language plpgsql set search_path = public, extensions as $$
declare
  v_msgs jsonb;
  m      jsonb;
  v_url  text;
  v_res  jsonb := '[]';
  v_ok   int := 0;
  v_bad  int := 0;
  v_skip int := 0;
begin
  v_msgs := public._people_sync_call('people_sync_pull', jsonb_build_object('p_limit', p_limit));

  for m in select * from jsonb_array_elements(v_msgs) loop
    if m->>'kind' = 'proposal' then
      v_skip := v_skip + 1;
      continue;
    end if;
    begin
      if m->>'kind' = 'avatar' then
        v_url := m->'payload'->>'avatar_url';
        if v_url is null or v_url !~ '^https://www\.amazingindex\.com/' then
          raise exception '头像地址必须在 https://www.amazingindex.com/ 下：%', coalesce(v_url, '(空)');
        end if;
        perform public.worker_set_avatar(m->>'person_slug', v_url);
      else
        raise exception '未知消息类型：%', m->>'kind';
      end if;
      v_res := v_res || jsonb_build_object('id', m->'id', 'ok', true);
      v_ok := v_ok + 1;
    exception when others then
      v_res := v_res || jsonb_build_object('id', m->'id', 'ok', false, 'error', left(sqlerrm, 500));
      v_bad := v_bad + 1;
    end;
  end loop;

  if jsonb_array_length(v_res) > 0 then
    perform public._people_sync_call('people_sync_ack', jsonb_build_object('p_results', v_res));
  end if;
  return jsonb_build_object('pulled', jsonb_array_length(v_msgs), 'ok', v_ok, 'failed', v_bad, 'skipped', v_skip);
end $$;

-- ---------------------------------------------------------------------
-- 对账：官方库每个快照的指纹 vs 本地已发布人物当前内容的指纹
-- 兜住触发器覆盖不到的间接变化（例如别人改名后，引用他的页面也该更新）
-- ---------------------------------------------------------------------
create or replace function public.people_sync_reconcile()
returns jsonb language plpgsql set search_path = public, extensions as $$
declare
  v_remote jsonb;
  p        record;
  k        text;
  v_n      int := 0;
  v_seen   int := 0;
begin
  v_remote := public._people_sync_call('people_sync_state');

  for p in select id, slug from persons where status = 'published' loop
    v_seen := v_seen + 1;
    if v_remote->>(p.id::text) is distinct from md5((public.person_public(p.slug) - 'generated_at')::text) then
      insert into jobs (kind, dedupe_key, payload)
      values ('export_person', p.id::text, jsonb_build_object('person_id', p.id))
      on conflict (kind, dedupe_key) where status = 'queued' do nothing;
      v_n := v_n + 1;
    end if;
  end loop;

  for k in select jsonb_object_keys(v_remote) loop
    if not exists (select 1 from persons where id = k::uuid and status = 'published') then
      insert into jobs (kind, dedupe_key, payload)
      values ('export_person', k, jsonb_build_object('person_id', k))
      on conflict (kind, dedupe_key) where status = 'queued' do nothing;
      v_n := v_n + 1;
    end if;
  end loop;

  return jsonb_build_object('published', v_seen, 'remote', (select count(*) from jsonb_object_keys(v_remote)),
                            'requeued', v_n);
end $$;

-- ---------------------------------------------------------------------
-- 查看同步状况
-- ---------------------------------------------------------------------
create or replace function public.people_sync_overview()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'jobs', (select coalesce(jsonb_object_agg(kind || ':' || status, n), '{}')
               from (select kind, status, count(*) n from jobs group by 1, 2) x),
    'recent_errors', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'key', dedupe_key,
                        'attempts', attempts, 'error', last_error, 'at', updated_at) order by updated_at desc), '[]')
                        from (select * from jobs where last_error is not null order by updated_at desc limit 5) e),
    'cron', (select coalesce(jsonb_agg(jsonb_build_object('job', jobname, 'schedule', schedule, 'active', active)), '[]')
               from cron.job where jobname like 'people-sync-%')
  )
$$;

-- 只给直连会话用：不开放给浏览器、也不开放给 agent
revoke all on function public._people_sync_call(text, jsonb), public.people_sync_push_run(int),
                       public.people_sync_pull_run(int), public.people_sync_reconcile(),
                       public.people_sync_overview()
  from public, anon, authenticated, service_role;
revoke all on function public.worker_set_avatar(text, text) from public, anon, authenticated;
grant execute on function public.worker_set_avatar(text, text) to service_role;

commit;

-- ---------------------------------------------------------------------
-- 首次同步：推送导入时排好的 75 条任务，然后对账（应当没有需要重推的）
-- ---------------------------------------------------------------------
select 'push' as 步骤, public.people_sync_push_run(500) as 结果
union all
select 'reconcile', public.people_sync_reconcile()
union all
select 'push again', public.people_sync_push_run(500);

-- ---------------------------------------------------------------------
-- 定时任务（同名任务会被覆盖，可重复执行）。pg_cron 按 UTC：20:23 UTC = 北京时间 04:23
-- ---------------------------------------------------------------------
select cron.schedule('people-sync-push',      '*/2 * * * *',  'select public.people_sync_push_run()');
select cron.schedule('people-sync-pull',      '*/10 * * * *', 'select public.people_sync_pull_run()');
select cron.schedule('people-sync-reconcile', '23 20 * * *',  'select public.people_sync_reconcile()');

select public.people_sync_overview() as 同步状况;
