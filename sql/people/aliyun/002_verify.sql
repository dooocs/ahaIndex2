-- =====================================================================
-- 向上研究所 · 人物域迁移 001 的验证脚本
-- 在执行完 001 之后运行。它会写入测试数据走一遍完整流程，
-- 最后故意抛出一条消息让整个事务回滚，所以不会在库里留下任何数据。
--
-- 看结果：
--   报错信息以 VERIFY_OK 开头   → 全部通过
--   报错信息以 VERIFY_FAIL 开头 → 有问题，把整条信息发给 Claude
-- =====================================================================

do $$
declare
  n      int := 0;
  cs     uuid;
  pid    uuid;
  eid    uuid;
  sid    uuid;
  pub    jsonb;
  t      text;
  cnt    int;
  procedure_ok boolean;
begin
  -- 1. 表和 RLS
  foreach t in array array[
    'site_staff','changesets','revisions','jobs','persons','person_aliases','entities',
    'person_achievements','person_labels','stance_axes','person_stances','person_comparisons',
    'person_wealth_points','tl_dimensions','tl_states','tl_arcs','tl_events','tl_event_people',
    'tl_event_links','outlets','sources','source_snapshots','citations'
  ] loop
    if to_regclass('public.' || t) is null then
      raise exception 'VERIFY_FAIL：缺少表 %', t;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'VERIFY_FAIL：表 % 没有开启 RLS', t;
    end if;
    n := n + 1;
  end loop;

  -- 2. Supabase 依赖
  if to_regprocedure('auth.uid()') is null or to_regprocedure('auth.role()') is null then
    raise exception 'VERIFY_FAIL：缺少 auth.uid() 或 auth.role()';
  end if;
  n := n + 1;

  select count(*) into cnt from tl_dimensions;
  if cnt <> 3 then raise exception 'VERIFY_FAIL：tl_dimensions 应有 3 行，实际 %', cnt; end if;
  n := n + 1;

  -- 3. 权限
  if has_table_privilege('anon', 'public.persons', 'select') then
    raise exception 'VERIFY_FAIL：anon 不应能直接读 persons（会暴露草稿）';
  end if;
  if has_table_privilege('anon', 'public.revisions', 'select') then
    raise exception 'VERIFY_FAIL：anon 不应能读 revisions';
  end if;
  if has_function_privilege('anon', 'public.person_public(text)', 'execute') then
    raise exception 'VERIFY_FAIL：anon 不应能调用 person_public（公开读取走 CDN 和 Edge 函数）';
  end if;
  if not has_function_privilege('service_role', 'public.person_public(text)', 'execute')
     or not has_function_privilege('service_role', 'public.persons_public()', 'execute') then
    raise exception 'VERIFY_FAIL：service_role 应能调用公开读取函数';
  end if;
  if has_table_privilege('authenticated', 'public.persons', 'truncate')
     or has_table_privilege('authenticated', 'public.revisions', 'truncate') then
    raise exception 'VERIFY_FAIL：登录用户不应有 TRUNCATE 权限（不受 RLS 约束）';
  end if;
  if not has_table_privilege('authenticated', 'public.revisions', 'insert')
     or has_table_privilege('authenticated', 'public.revisions', 'update') then
    raise exception 'VERIFY_FAIL：管理员应能插入修订、但不能修改修订';
  end if;
  select count(*) into cnt from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prosecdef
     and p.proname in ('is_staff','can_edit','publish_row','person_public','_ed_after','_cites');
  if cnt > 0 then raise exception 'VERIFY_FAIL：仍有 SECURITY DEFINER 函数'; end if;
  select count(*) into cnt from pg_trigger where tgname like '%_ed_before' or tgname like '%_ed_after';
  if cnt <> 34 then raise exception 'VERIFY_FAIL：编辑触发器应有 34 个，实际 %', cnt; end if;
  if has_function_privilege('anon', 'public.publish_row(text, uuid)', 'execute') then
    raise exception 'VERIFY_FAIL：anon 不应能调用 publish_row';
  end if;
  if has_function_privilege('service_role', 'public.publish_changeset(uuid)', 'execute') then
    raise exception 'VERIFY_FAIL：service_role（agent）不应能发布变更集';
  end if;
  if not has_function_privilege('authenticated', 'public._sys_cols()', 'execute')
     or not has_function_privilege('service_role', 'public._is_agent()', 'execute') then
    raise exception 'VERIFY_FAIL：触发器辅助函数缺少执行权限，写入会失败';
  end if;
  if not has_function_privilege('service_role', 'public.claim_jobs(text, integer, text)', 'execute') then
    raise exception 'VERIFY_FAIL：service_role 应能领取任务';
  end if;
  n := n + 12;

  -- 4. 端到端：草稿 → 发布 → 公开读取
  insert into changesets (title, origin) values ('verify', 'manual') returning id into cs;
  insert into persons (slug, name, name_zh, birth_date, birth_prec, changeset_id)
    values ('zz-verify', 'Verify', '验证人', '1969-12-16', 'day', cs) returning id into pid;
  insert into tl_events (event_date, date_prec, title, valence, importance, changeset_id)
    values ('2010-04-01', 'month', '验证事件', 'turn', 3, cs) returning id into eid;
  insert into tl_event_people (event_id, person_id, changeset_id) values (eid, pid, cs);
  insert into sources (url, canonical_url, title, published_at, changeset_id)
    values ('https://example.com/a', 'example.com/a', '验证来源', '2010-04-02', cs) returning id into sid;
  insert into citations (source_id, target_type, target_id, changeset_id) values (sid, 'event', eid, cs);
  insert into tl_arcs (person_id, label, color, start_date, changeset_id) values (pid, '验证主线', 'orange', '2010-01-01', cs);
  insert into tl_states (person_id, dimension_key, label, start_date, is_estimate, changeset_id)
    values (pid, 'wealth', '验证状态', '2010-01-01', true, cs);
  n := n + 1;

  if public.person_public('zz-verify') is not null then
    raise exception 'VERIFY_FAIL：未发布的人物不应能公开读取';
  end if;
  n := n + 1;

  cnt := public.publish_changeset(cs);
  if cnt <> 7 then raise exception 'VERIFY_FAIL：变更集应发布 7 行，实际 %', cnt; end if;
  n := n + 1;

  pub := public.person_public('zz-verify');
  if pub is null
     or jsonb_array_length(pub->'events') <> 1
     or jsonb_array_length(pub->'events'->0->'sources') <> 1
     or jsonb_array_length(pub->'arcs') <> 1
     or jsonb_array_length(pub->'states') <> 1 then
    raise exception 'VERIFY_FAIL：公开读取内容不完整：%', left(pub::text, 300);
  end if;
  n := n + 1;

  -- 5. 已发布内容改草稿，线上不变；发布后生效
  update tl_events set draft = '{"title":"验证事件（改）"}' where id = eid;
  if public.person_public('zz-verify')->'events'->0->>'title' <> '验证事件' then
    raise exception 'VERIFY_FAIL：草稿修改不应影响线上内容';
  end if;
  perform public.publish_row('tl_events', eid);
  if public.person_public('zz-verify')->'events'->0->>'title' <> '验证事件（改）' then
    raise exception 'VERIFY_FAIL：发布草稿后线上内容没有更新';
  end if;
  n := n + 2;

  -- 6. 修订与任务
  select count(*) into cnt from revisions where row_id = eid;
  if cnt < 3 then raise exception 'VERIFY_FAIL：事件修订记录应至少 3 条，实际 %', cnt; end if;
  select count(*) into cnt from jobs where kind = 'export_person' and dedupe_key = pid::text and status = 'queued';
  if cnt <> 1 then raise exception 'VERIFY_FAIL：应有 1 条待导出任务，实际 %', cnt; end if;
  n := n + 2;

  -- 7. 回滚标题修改
  perform public.publish_changeset(public.revert_revision(
    (select id from revisions where row_id = eid and op = 'UPDATE'
        and after->>'title' = '验证事件（改）' and before->>'title' = '验证事件' order by id limit 1)));
  if public.person_public('zz-verify')->'events'->0->>'title' <> '验证事件' then
    raise exception 'VERIFY_FAIL：回滚没有恢复原标题';
  end if;
  n := n + 1;

  -- 8. 日期精度约束
  begin
    insert into tl_events (event_date, date_prec, title) values ('2010-04-05', 'month', 'x');
    raise exception 'VERIFY_FAIL：日期精度约束没有生效';
  exception when check_violation then
    n := n + 1;
  end;

  raise exception 'VERIFY_OK：% 项检查全部通过，测试数据已自动回滚', n;
end $$;
