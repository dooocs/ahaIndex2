-- =====================================================================
-- 阿里云 Supabase · 人物发布内容补字段、回填更新日期（007）
-- 1. 发布内容（person_public）补上构建需要的 former_subjects、added_at、updated_at。
--    updated_at = 人物和其已发布内容里最晚的一次修改。
-- 2. 系统维护写入（头像任务）不再刷新 updated_at，和旧规则“只换照片不算更新”一致。
-- 3. 把导入时丢掉的 updated_at 按旧表回填（源库 md5 ef58fb6f31c76bb9c0742481ba35fcb4）。
-- 4. 对账并推送：官方库的 72 份快照全部带上新字段。
-- 执行：整段粘贴执行，可重复执行。
-- =====================================================================

begin;

-- 1. 触发器：系统维护写入保留 updated_at
create or replace function public._ed_before() returns trigger
language plpgsql as $$
declare
  sys  text[] := public._sys_cols();
  k    text;
begin
  if tg_op = 'DELETE' then
    if public._is_agent() then
      raise exception 'agent 不能删除 %，请改为在变更集里提议归档（draft = {"status":"archived"}）', tg_table_name;
    end if;
    return old;
  end if;

  -- draft 只能包含本表的业务列，status 只能提议 published / archived
  if new.draft is not null then
    if jsonb_typeof(new.draft) <> 'object' then
      raise exception '%.draft 必须是 JSON 对象', tg_table_name;
    end if;
    for k in select jsonb_object_keys(new.draft) loop
      if k = 'status' then
        if new.draft->>'status' not in ('published','archived') then
          raise exception 'draft.status 只能是 published 或 archived';
        end if;
      elsif k = any(sys) or not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = tg_table_name and column_name = k
      ) then
        raise exception '%.draft 含有不可编辑的字段：%', tg_table_name, k;
      end if;
    end loop;
  end if;

  if tg_op = 'INSERT' then
    if public._is_agent() then
      if new.changeset_id is null then
        raise exception 'agent 写入 % 必须指定 changeset_id', tg_table_name;
      end if;
      if new.status <> 'draft' then
        raise exception 'agent 只能新增草稿（status = draft）';
      end if;
    end if;
    new.version    := 1;
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
    new.updated_by := auth.uid();
    return new;
  end if;

  -- UPDATE
  if public._is_agent() then
    if old.status = 'draft' then
      if new.changeset_id is null then
        raise exception 'agent 修改草稿必须指定 changeset_id';
      end if;
      if new.status <> 'draft' then
        raise exception 'agent 不能发布内容';
      end if;
    else
      if (to_jsonb(new) - sys) is distinct from (to_jsonb(old) - sys)
         or new.status is distinct from old.status then
        raise exception 'agent 只能通过 draft 字段对已发布内容提议修改';
      end if;
      if new.draft is not null and new.changeset_id is null then
        raise exception 'agent 提议修改必须指定 changeset_id';
      end if;
    end if;
  end if;

  new.id         := old.id;
  new.created_at := old.created_at;
  new.version    := old.version + 1;
  -- 系统维护写入（头像任务、日期回填）不算内容更新，保留原来的 updated_at
  if coalesce(current_setting('app.system', true), '') <> 'on' then
    new.updated_at := now();
  end if;
  new.updated_by := auth.uid();
  return new;
end $$;

-- 2. 发布内容补字段（权限保持不变）
create or replace function public._person_payload(pid uuid, editor boolean) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'person', (
      select jsonb_build_object(
        'slug', p.slug, 'name', p.name, 'name_zh', p.name_zh, 'nickname', p.nickname,
        'avatar_url', p.avatar_url, 'birth_date', p.birth_date, 'birth_prec', p.birth_prec,
        'birth_place', p.birth_place, 'death_date', p.death_date, 'death_prec', p.death_prec,
        'person_group', p.person_group, 'role', p.role, 'tier', p.tier, 'fields', p.fields,
        'take_text', p.take_text, 'take_updated_at', p.take_updated_at,
        'x_handle', p.x_handle, 'github_handle', p.github_handle,
        'former_subjects', p.former_subjects, 'added_at', p.added_at,
        'updated_at', greatest(p.updated_at, (
          select max(u) from (
            select x.updated_at u from tl_states x where x.person_id = p.id and x.status = 'published'
            union all select x.updated_at from tl_arcs x where x.person_id = p.id and x.status = 'published'
            union all select e.updated_at from tl_events e join tl_event_people ep on ep.event_id = e.id
                       where ep.person_id = p.id and e.status = 'published' and ep.status = 'published'
            union all select x.updated_at from person_achievements x where x.person_id = p.id and x.status = 'published'
            union all select x.updated_at from person_labels x where x.person_id = p.id and x.status = 'published'
            union all select x.updated_at from person_stances x where x.person_id = p.id and x.status = 'published'
            union all select x.updated_at from person_comparisons x where x.person_id = p.id and x.status = 'published'
            union all select x.updated_at from person_wealth_points x where x.person_id = p.id and x.status = 'published'
          ) c)),
        'sources', public._cites('person', p.id, editor)
      ) || public._meta(to_jsonb(p), editor)
      from persons p where p.id = pid),

    'dimensions', (
      select coalesce(jsonb_agg(jsonb_build_object('key', d.key, 'label', d.label) order by d.sort), '[]')
      from tl_dimensions d),

    'states', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'dimension', s.dimension_key, 'label', s.label, 'note', s.note,
        'start', s.start_date, 'start_prec', s.start_prec, 'end', s.end_date, 'end_prec', s.end_prec,
        'is_estimate', s.is_estimate, 'sources', public._cites('state', s.id, editor)
      ) || public._meta(to_jsonb(s), editor) order by s.dimension_key, s.start_date), '[]')
      from tl_states s where s.person_id = pid and public._vis(s.status, editor)),

    'arcs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'label', a.label, 'role_text', a.role_text, 'color', a.color, 'lane', a.lane,
        'start', a.start_date, 'start_prec', a.start_prec, 'end', a.end_date, 'end_prec', a.end_prec,
        'summary', a.summary,
        'entity', case when e.id is not null and public._vis(e.status, editor) then
                    jsonb_build_object('slug', e.slug, 'name', e.name, 'type', e.type, 'logo_url', e.logo_url) end,
        'sources', public._cites('arc', a.id, editor)
      ) || public._meta(to_jsonb(a), editor) order by a.lane, a.start_date, a.sort), '[]')
      from tl_arcs a left join entities e on e.id = a.entity_id
      where a.person_id = pid and public._vis(a.status, editor)),

    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'short_id', ev.short_id, 'date', ev.event_date, 'prec', ev.date_prec, 'is_approx', ev.is_approx,
        'title', ev.title, 'valence', ev.valence, 'importance', ev.importance, 'place', ev.place,
        'then_text', ev.then_text, 'later_text', ev.later_text, 'commentary', ev.commentary,
        'sides', ev.sides, 'steps', ev.steps, 'pinned', ev.pinned,
        'my_role', ep.role,
        'people', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'slug', p2.slug, 'name', p2.name, 'name_zh', p2.name_zh, 'avatar_url', p2.avatar_url,
            'role', ep2.role, 'is_primary', ep2.is_primary) order by ep2.is_primary desc, p2.name), '[]')
          from tl_event_people ep2 join persons p2 on p2.id = ep2.person_id
          where ep2.event_id = ev.id and ep2.person_id <> pid
            and public._vis(ep2.status, editor) and public._vis(p2.status, editor)),
        'links', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'type', l.type, 'note', l.note,
            'direction', case when l.from_event = ev.id then 'out' else 'in' end,
            'short_id', ev2.short_id, 'title', ev2.title, 'date', ev2.event_date, 'prec', ev2.date_prec
          ) order by ev2.event_date), '[]')
          from tl_event_links l
          join tl_events ev2 on ev2.id = case when l.from_event = ev.id then l.to_event else l.from_event end
          where (l.from_event = ev.id or l.to_event = ev.id)
            and public._vis(l.status, editor) and public._vis(ev2.status, editor)),
        'sources', public._cites('event', ev.id, editor)
      ) || public._meta(to_jsonb(ev), editor) order by ev.event_date, ev.sort, ev.created_at), '[]')
      from tl_event_people ep join tl_events ev on ev.id = ep.event_id
      where ep.person_id = pid and public._vis(ep.status, editor) and public._vis(ev.status, editor)),

    'wealth', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'as_of', w.as_of, 'as_of_prec', w.as_of_prec, 'amount', w.amount, 'currency', w.currency,
        'basis', w.basis, 'note', w.note, 'sources', public._cites('wealth', w.id, editor)
      ) || public._meta(to_jsonb(w), editor) order by w.as_of), '[]')
      from person_wealth_points w where w.person_id = pid and public._vis(w.status, editor)),

    'achievements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'period', x.period_text, 'text', x.text, 'note', x.note,
        'sources', public._cites('achievement', x.id, editor)
      ) || public._meta(to_jsonb(x), editor) order by x.sort, x.created_at), '[]')
      from person_achievements x where x.person_id = pid and public._vis(x.status, editor)),

    'labels', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'text', x.text, 'given_by', x.given_by, 'sources', public._cites('label', x.id, editor)
      ) || public._meta(to_jsonb(x), editor) order by x.sort, x.created_at), '[]')
      from person_labels x where x.person_id = pid and public._vis(x.status, editor)),

    'stances', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'axis', jsonb_build_object('slug', ax.slug, 'left', ax.left_label, 'right', ax.right_label),
        'position', x.position, 'previous_position', x.previous_position, 'note', x.note,
        'others', (
          select coalesce(jsonb_agg(jsonb_build_object('slug', p3.slug, 'name', p3.name,
                                    'name_zh', p3.name_zh, 'position', s3.position) order by s3.position), '[]')
          from person_stances s3 join persons p3 on p3.id = s3.person_id
          where s3.axis_id = ax.id and s3.person_id <> pid
            and s3.status = 'published' and p3.status = 'published'),
        'sources', public._cites('stance', x.id, editor)
      ) || public._meta(to_jsonb(x), editor) order by x.sort, x.created_at), '[]')
      from person_stances x join stance_axes ax on ax.id = x.axis_id
      where x.person_id = pid and public._vis(x.status, editor) and public._vis(ax.status, editor)),

    'comparisons', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'slug', case when public._vis(p4.status, editor) then p4.slug end,
        'name', coalesce(p4.name_zh, p4.name, x.other_name), 'why', x.why,
        'sources', public._cites('comparison', x.id, editor)
      ) || public._meta(to_jsonb(x), editor) order by x.sort, x.created_at), '[]')
      from person_comparisons x left join persons p4 on p4.id = x.other_person_id
      where x.person_id = pid and public._vis(x.status, editor)),

    'generated_at', now()
  )
$$;

-- 3. 回填 updated_at（以系统身份写入，触发器不会覆盖）
select set_config('app.system', 'on', true);
update public.persons p
   set updated_at = v.updated_at::timestamptz
  from (values
('alex-albert', '2026-10-25 07:08:16.331112+00'),
('alex-hormozi', '2026-10-22 07:20:57.18087+00'),
('andrej-karpathy', '2026-10-20 09:38:17.168001+00'),
('andrew-ng', '2026-10-20 09:28:29.62997+00'),
('anton-cherkasov', '2026-10-24 07:22:13.13122+00'),
('aravind-srinivas', '2026-10-20 09:28:29.62997+00'),
('arvid-kahl', '2026-10-22 07:20:57.18087+00'),
('bilawal-sidhu', '2026-10-23 06:47:57.131046+00'),
('boris-cherny', '2026-10-21 15:46:11.00091+00'),
('brett-williams', '2026-10-24 07:22:13.13122+00'),
('clement-delangue', '2026-10-23 06:23:43.527869+00'),
('damon-chen', '2026-10-23 06:47:57.131046+00'),
('daniel-nguyen', '2026-10-23 06:47:57.131046+00'),
('danny-postma', '2026-10-23 06:23:43.527869+00'),
('dashuai-laoyuan', '2026-10-24 07:22:13.13122+00'),
('david-holz', '2026-10-23 06:47:57.131046+00'),
('demis-hassabis', '2026-10-20 09:28:29.62997+00'),
('dhh', '2026-10-20 09:38:17.168001+00'),
('dominik-sobe', '2026-10-24 07:22:13.13122+00'),
('dwarkesh-patel', '2026-10-23 03:29:02.434703+00'),
('elon-musk', '2026-10-20 09:12:45.365389+00'),
('ethan-mollick', '2026-10-20 09:28:29.62997+00'),
('francois-chollet', '2026-10-20 09:38:17.168001+00'),
('gavin-baker', '2026-10-23 06:47:57.131046+00'),
('gefei', '2026-10-24 07:22:13.13122+00'),
('ginobefun', '2026-10-24 07:22:13.13122+00'),
('greg-brockman', '2026-10-20 09:28:29.62997+00'),
('greg-isenberg', '2026-10-22 07:20:57.18087+00'),
('idoubi', '2026-10-24 07:22:13.13122+00'),
('ilovelife', '2026-10-24 07:22:13.13122+00'),
('ilya-sutskever', '2026-10-20 09:28:29.62997+00'),
('jack-friks', '2026-10-21 15:56:57.086206+00'),
('jason-fried', '2026-10-22 07:20:57.18087+00'),
('jay-nomadtable', '2026-10-24 07:22:13.13122+00'),
('jeff-dean', '2026-10-20 09:28:29.62997+00'),
('jim-fan', '2026-10-20 09:28:29.62997+00'),
('jim-raptis', '2026-10-24 07:22:13.13122+00'),
('john-carmack', '2026-10-20 09:28:29.62997+00'),
('john-rush', '2026-10-23 06:47:57.131046+00'),
('jon-yongfook', '2026-10-21 15:56:57.086206+00'),
('lenny-rachitsky', '2026-10-22 07:20:57.18087+00'),
('livid', '2026-10-22 07:20:57.18087+00'),
('logan-kilpatrick', '2026-10-22 07:20:57.18087+00'),
('luca-restagno', '2026-10-24 07:22:13.13122+00'),
('lukas-hermann', '2026-10-24 07:22:13.13122+00'),
('luolei', '2026-10-24 07:22:13.13122+00'),
('marc-kohlbrugge', '2026-10-24 07:22:13.13122+00'),
('marc-lou', '2026-10-23 06:23:43.527869+00'),
('massimo', '2026-10-21 15:56:01.803029+00'),
('mckay-wrigley', '2026-10-22 07:20:57.18087+00'),
('mitchell-hashimoto', '2026-10-23 06:47:57.131046+00'),
('naval-ravikant', '2026-10-20 09:28:29.62997+00'),
('nearcyan', '2026-10-20 09:28:29.62997+00'),
('nikita-bier', '2026-10-23 06:47:57.131046+00'),
('olly', '2026-10-24 07:22:13.13122+00'),
('pat-walls', '2026-10-22 07:20:57.18087+00'),
('paul-graham', '2026-10-20 09:12:45.365389+00'),
('pauline-cx', '2026-10-29 09:50:03.51743+00'),
('peter-steinberger', '2026-10-21 15:46:11.00091+00'),
('pieter-levels', '2026-10-20 09:12:45.365389+00'),
('riley-goodside', '2026-10-20 09:28:29.62997+00'),
('roon', '2026-10-23 06:01:35.709239+00'),
('ryan-carson', '2026-10-23 06:47:57.131046+00'),
('sam-altman', '2026-10-20 09:12:45.365389+00'),
('sam-parr', '2026-10-23 06:47:57.131046+00'),
('santiago-valdarrama', '2026-10-22 06:54:32.483994+00'),
('shadcn', '2026-10-22 07:20:57.18087+00'),
('simon-hoiberg', '2026-10-24 07:22:13.13122+00'),
('simon-willison', '2026-10-20 09:38:17.168001+00'),
('steph-ango', '2026-10-23 06:47:57.131046+00'),
('thomas-wolf', '2026-10-20 09:38:17.168001+00'),
('tibo-louis-lucas', '2026-10-22 07:20:57.18087+00'),
('tim-urban', '2026-10-23 06:47:57.131046+00'),
('tonino-catapano', '2026-10-29 11:00:34.874917+00'),
('tony-dinh', '2026-10-21 15:56:57.086206+00'),
('tw93', '2026-10-21 15:56:57.086206+00'),
('viggo', '2026-10-24 07:22:13.13122+00'),
('viking', '2026-10-24 07:22:13.13122+00'),
('yang-yi', '2026-10-22 07:20:57.18087+00'),
('yann-lecun', '2026-10-20 09:28:29.62997+00'),
('yasser-elsaid', '2026-10-23 06:47:57.131046+00')
  ) as v(slug, updated_at)
 where p.slug = v.slug and p.updated_at is distinct from v.updated_at::timestamptz;
select set_config('app.system', '', true);

commit;

-- 4. 对账：指纹都变了，所有已发布人物会重新排队，随后推送
select 'reconcile' as 步骤, public.people_sync_reconcile() as 结果
union all
select 'push', public.people_sync_push_run(500)
union all
select 'check', jsonb_build_object(
  'andrew-ng', (select jsonb_build_object('added_at', p->'person'->'added_at', 'updated_at', p->'person'->'updated_at',
                                          'former_subjects', p->'person'->'former_subjects')
                  from (select public.person_public('andrew-ng') p) x),
  'recent_errors', public.people_sync_overview()->'recent_errors');
