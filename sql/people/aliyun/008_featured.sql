-- =====================================================================
-- 阿里云 Supabase · 人物首页精选（008）
-- 1. persons 加 featured_rank：首页排位 1–100，不能重复；空 = 不上首页（只有个人页）。
-- 2. 发布内容（person_public、persons_public）带上排位。
-- 3. set_featured_people(array[...])：按数组顺序一次性重排首页，不在数组里的人移出首页。
--    排位不算内容更新，不改人物的更新日期。
-- 4. 发布雷军的导入变更集，并把他设为首页第 1 位；随后立即推送。
-- 执行：整段粘贴执行，可重复执行。
-- =====================================================================

begin;

-- 1. 排位列。唯一约束延迟到提交时检查，重排时互换名次不会中途冲突
alter table public.persons add column if not exists featured_rank smallint
  check (featured_rank between 1 and 100);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'persons_featured_rank_uq') then
    alter table public.persons add constraint persons_featured_rank_uq
      unique (featured_rank) deferrable initially deferred;
  end if;
end $$;

-- 2. 发布内容带上排位（权限保持不变）
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
        'featured_rank', p.featured_rank,
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

create or replace function public.persons_public() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', p.slug, 'name', p.name, 'name_zh', p.name_zh, 'nickname', p.nickname,
    'avatar_url', p.avatar_url, 'person_group', p.person_group, 'role', p.role, 'tier', p.tier,
    'fields', p.fields, 'take_text', p.take_text, 'take_updated_at', p.take_updated_at,
    'x_handle', p.x_handle, 'featured_rank', p.featured_rank,
    'event_count', (select count(*) from tl_event_people ep join tl_events e on e.id = ep.event_id
                    where ep.person_id = p.id and ep.status = 'published' and e.status = 'published')
  ) order by p.featured_rank nulls last, p.added_at, p.name), '[]')
  from persons p where p.status = 'published'
$$;

-- 3. 一次性设定首页名单
create or replace function public.set_featured_people(p_slugs text[]) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_missing text[];
  v_dup     text[];
  v_n       int;
  v_c       int;
begin
  if not public.can_edit() then raise exception '没有编辑权限'; end if;
  p_slugs := coalesce(p_slugs, '{}');
  if cardinality(p_slugs) > 100 then
    raise exception '首页最多 100 人，现在是 % 人', cardinality(p_slugs);
  end if;
  select array_agg(s) into v_dup from (select s from unnest(p_slugs) s group by s having count(*) > 1) d;
  if v_dup is not null then raise exception '名单里有重复：%', v_dup; end if;
  select array_agg(s) into v_missing from unnest(p_slugs) s
   where not exists (select 1 from persons p where p.slug = s);
  if v_missing is not null then raise exception '这些人不存在：%', v_missing; end if;

  perform set_config('app.system', 'on', true);
  update persons set featured_rank = null
   where featured_rank is not null and not (slug = any(p_slugs));
  get diagnostics v_n = row_count;
  v_c := v_n;
  update persons p set featured_rank = v.ord
    from unnest(p_slugs) with ordinality as v(slug, ord)
   where p.slug = v.slug and p.featured_rank is distinct from v.ord;
  get diagnostics v_n = row_count;
  v_c := v_c + v_n;
  perform set_config('app.system', '', true);

  return jsonb_build_object(
    'featured', (select coalesce(jsonb_agg(jsonb_build_object('rank', featured_rank, 'slug', slug,
                   'status', status) order by featured_rank), '[]')
                   from persons where featured_rank is not null),
    'changed', v_c);
end $$;

revoke all on function public.set_featured_people(text[]) from public, anon, service_role;
grant execute on function public.set_featured_people(text[]) to authenticated;

-- 4. 发布雷军（变更集已处理过就跳过），设为首页第 1 位
do $$ begin
  if exists (select 1 from changesets where id = '1c8085b7-7cab-5438-8a11-ba4a9d603373' and status = 'open') then
    perform public.publish_changeset('1c8085b7-7cab-5438-8a11-ba4a9d603373');
  end if;
end $$;
select public.set_featured_people(array['lei-jun']);

commit;

-- 推送（不等 2 分钟），然后检查
select 'push' as 步骤, public.people_sync_push_run(500) as 结果
union all
select 'lei-jun', (select jsonb_build_object(
          'featured_rank', p->'person'->'featured_rank',
          'events', jsonb_array_length(p->'events'), 'arcs', jsonb_array_length(p->'arcs'),
          'states', jsonb_array_length(p->'states'))
        from (select public.person_public('lei-jun') p) x)
union all
select 'recent_errors', public.people_sync_overview()->'recent_errors';
