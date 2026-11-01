-- =====================================================================
-- 向上研究所 · 人物域迁移 001
-- 目标库：阿里云 Supabase（amazingindex）
-- 内容：人物主数据、时间线、证据、编辑流程（草稿 / 发布 / 修订）、任务队列
-- 执行：整段粘贴到 SQL 编辑器执行。脚本在一个事务里，任何一步失败都会整体回滚。
--
-- 阿里云镜像禁止 SECURITY DEFINER（adbpg_enable_security_definer 关闭且不可修改），
-- 所以本脚本所有函数都是 SECURITY INVOKER：
--   · 管理员在浏览器里用自己的登录态直接读写，靠 RLS 判定权限；
--   · 公开读取函数只授权给 service_role，由导出任务和 Edge 函数调用；
--   · anon 对本脚本的任何表和函数都没有权限。
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. 冲突检查：要建的表或函数已存在就中止，不覆盖任何现有对象
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  clash text[] := '{}';
begin
  foreach t in array array[
    'site_staff','changesets','revisions','jobs',
    'persons','person_aliases','entities',
    'person_achievements','person_labels','stance_axes','person_stances','person_comparisons',
    'person_wealth_points',
    'tl_dimensions','tl_states','tl_arcs','tl_events','tl_event_people','tl_event_links',
    'outlets','sources','source_snapshots','citations'
  ] loop
    if to_regclass('public.' || t) is not null then clash := clash || t; end if;
  end loop;

  foreach t in array array[
    'is_staff','is_owner','can_edit','publish_row','publish_changeset','reject_changeset',
    'discard_draft','revert_revision','person_public','person_editor','persons_public',
    'claim_jobs','finish_job','worker_set_avatar',
    '_prec_ok','_short_id','_editorial_tables','_sys_cols','_citation_target_table','_citation_type_of',
    '_is_agent','_ed_before','_affected_persons','_enqueue_export','_ed_after','_citation_check',
    '_vis','_meta','_cites','_person_payload'
  ] loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = t) then
      clash := clash || (t || '()');
    end if;
  end loop;

  if cardinality(clash) > 0 then
    raise exception '以下对象已存在，迁移中止，未做任何修改：%', clash;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. 基础工具
-- ---------------------------------------------------------------------

-- 日期精度：year 必须是 1 月 1 日，month 必须是 1 日
create function public._prec_ok(d date, p text) returns boolean
language sql immutable as $$
  select d is null
      or p = 'day'
      or (p = 'month' and extract(day from d) = 1)
      or (p = 'year'  and extract(month from d) = 1 and extract(day from d) = 1)
$$;

create function public._short_id() returns text
language sql volatile as $$ select substr(md5(gen_random_uuid()::text), 1, 8) $$;

-- ---------------------------------------------------------------------
-- 2. 权限：全站统一的管理员表
-- ---------------------------------------------------------------------
create table public.site_staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'editor' check (role in ('owner','editor')),
  note       text,
  created_at timestamptz not null default now()
);
comment on table public.site_staff is '全站管理员。owner 可管理名单，editor 可编辑内容。相亲贴审核后续也改用此表。';

-- INVOKER：依赖 site_staff 上“只能读自己那一行”的 RLS 策略
create function public.is_staff() returns boolean
language sql stable security invoker set search_path = public as $$
  select exists (select 1 from public.site_staff where user_id = auth.uid())
$$;

create function public.is_owner() returns boolean
language sql stable security invoker set search_path = public as $$
  select exists (select 1 from public.site_staff where user_id = auth.uid() and role = 'owner')
$$;

-- 可执行编辑操作：管理员，或直接连库的会话（SQL 编辑器 / psql）
create function public.can_edit() returns boolean
language sql stable security invoker set search_path = public as $$
  select public.is_staff()
      or session_user not in ('authenticator','anon','authenticated','service_role')
$$;

-- ---------------------------------------------------------------------
-- 3. 编辑流程表
-- ---------------------------------------------------------------------
create table public.changesets (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  note        text,
  origin      text not null default 'manual' check (origin in ('manual','ai_draft','feed_promote','revert','import')),
  author      text,                         -- 人名或 agent 名
  created_by  uuid default auth.uid(),
  status      text not null default 'open' check (status in ('open','applied','rejected')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
comment on table public.changesets is '变更集：一批待审修改。AI 写入必须挂在变更集下。';

create table public.revisions (
  id           bigint generated always as identity primary key,
  table_name   text not null,
  row_id       uuid not null,
  op           text not null check (op in ('INSERT','UPDATE','DELETE')),
  before       jsonb,
  after        jsonb,
  actor        uuid,
  actor_role   text,
  changeset_id uuid,
  txid         bigint not null default txid_current(),
  at           timestamptz not null default now()
);
create index revisions_tx_idx  on public.revisions (txid, op);
create index revisions_row_idx on public.revisions (table_name, row_id, at desc);
create index revisions_cs_idx  on public.revisions (changeset_id) where changeset_id is not null;
comment on table public.revisions is '修订历史，由触发器自动写入，只增不改。';

create table public.jobs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('export_person','export_index','snapshot','avatar','ai_draft')),
  dedupe_key  text not null,
  payload     jsonb not null default '{}',
  status      text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts    int  not null default 0,
  run_after   timestamptz not null default now(),
  locked_at   timestamptz,
  locked_by   text,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index jobs_dedupe_queued on public.jobs (kind, dedupe_key) where status = 'queued';
create index jobs_pick_idx on public.jobs (kind, status, run_after);
comment on table public.jobs is '后台任务队列：导出、快照、头像、AI 起草。同一对象排队中只保留一条。';

-- ---------------------------------------------------------------------
-- 4. 内容表（领域字段）。通用编辑列在第 5 节统一追加。
-- ---------------------------------------------------------------------

-- 人物
create table public.persons (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name            text not null,
  name_zh         text,
  nickname        text,
  avatar_url      text,
  birth_date      date,
  birth_prec      text check (birth_prec in ('year','month','day')),
  birth_place     text,
  death_date      date,
  death_prec      text check (death_prec in ('year','month','day')),
  person_group    text,
  role            text,
  tier            text,
  fields          text[] not null default '{}',
  take_text       text,
  take_updated_at date,
  x_handle        text,
  github_handle   text,
  former_subjects text[] not null default '{}',
  added_at        date default current_date,
  check (public._prec_ok(birth_date, birth_prec)),
  check (public._prec_ok(death_date, death_prec))
);
create unique index persons_x_handle_uq on public.persons (lower(x_handle)) where x_handle is not null;

create table public.person_aliases (
  id        uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete cascade,
  alias     text not null,
  kind      text not null default 'name' check (kind in ('name','name_zh','former_name','handle','nickname')),
  unique (person_id, alias)
);
create index person_aliases_alias_idx on public.person_aliases (lower(alias));

-- 实体：公司 / 产品 / 学校 / 基金
create table public.entities (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  type         text not null check (type in ('company','product','school','fund','org')),
  name         text not null,
  name_en      text,
  logo_url     text,
  website      text,
  founded_on   date,
  founded_prec text check (founded_prec in ('year','month','day')),
  summary      text,
  check (public._prec_ok(founded_on, founded_prec))
);

-- 人物右侧栏：成就、标签、立场、对照
create table public.person_achievements (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.persons(id) on delete cascade,
  period_text text,
  text        text not null,
  note        text,
  sort        int not null default 0
);
create index person_achievements_person_idx on public.person_achievements (person_id);

create table public.person_labels (
  id        uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete cascade,
  text      text not null,
  given_by  text,
  sort      int not null default 0
);
create index person_labels_person_idx on public.person_labels (person_id);

create table public.stance_axes (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  left_label  text not null,
  right_label text not null,
  note        text
);

create table public.person_stances (
  id        uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete cascade,
  axis_id   uuid not null references public.stance_axes(id) on delete cascade,
  position  smallint not null check (position between 0 and 100),
  note      text,
  sort      int not null default 0,
  unique (person_id, axis_id)
);

create table public.person_comparisons (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references public.persons(id) on delete cascade,
  other_person_id uuid references public.persons(id) on delete set null,
  other_name      text,
  why             text not null,
  sort            int not null default 0,
  check (other_person_id is not null or other_name is not null),
  check (other_person_id is distinct from person_id)
);
create index person_comparisons_person_idx on public.person_comparisons (person_id);

create table public.person_wealth_points (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.persons(id) on delete cascade,
  as_of      date not null,
  as_of_prec text not null default 'year' check (as_of_prec in ('year','month','day')),
  amount     numeric(20,2) not null check (amount >= 0),
  currency   text not null default 'USD',
  basis      text not null check (basis in ('forbes','hurun','bloomberg','filing','estimate')),
  note       text,
  check (public._prec_ok(as_of, as_of_prec))
);
create index person_wealth_person_idx on public.person_wealth_points (person_id, as_of);

-- 时间线：状态列定义（配置表，不走草稿）
create table public.tl_dimensions (
  key              text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  label            text not null,
  sort             int not null default 0,
  default_estimate boolean not null default false,
  created_at       timestamptz not null default now()
);

create table public.tl_states (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references public.persons(id) on delete cascade,
  dimension_key text not null references public.tl_dimensions(key) on update cascade,
  label         text not null,
  note          text,
  start_date    date not null,
  start_prec    text not null default 'year' check (start_prec in ('year','month','day')),
  end_date      date,
  end_prec      text check (end_prec in ('year','month','day')),
  is_estimate   boolean not null default false,
  check (public._prec_ok(start_date, start_prec)),
  check (public._prec_ok(end_date, end_prec)),
  check (end_date is null or end_date >= start_date)
);
create index tl_states_person_idx on public.tl_states (person_id, dimension_key, start_date);

create table public.tl_arcs (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.persons(id) on delete cascade,
  entity_id  uuid references public.entities(id) on delete set null,
  label      text not null,
  role_text  text,
  color      text not null default 'gray' check (color in ('blue','orange','violet','teal','olive','red','green','gray')),
  lane       smallint not null default 0 check (lane between 0 and 2),
  start_date date not null,
  start_prec text not null default 'year' check (start_prec in ('year','month','day')),
  end_date   date,
  end_prec   text check (end_prec in ('year','month','day')),
  summary    text,
  sort       int not null default 0,
  check (public._prec_ok(start_date, start_prec)),
  check (public._prec_ok(end_date, end_prec)),
  check (end_date is null or end_date >= start_date)
);
create index tl_arcs_person_idx on public.tl_arcs (person_id, start_date);

create table public.tl_events (
  id          uuid primary key default gen_random_uuid(),
  short_id    text not null unique default public._short_id(),
  event_date  date not null,
  date_prec   text not null default 'day' check (date_prec in ('year','month','day')),
  is_approx   boolean not null default false,
  title       text not null,
  valence     text not null default 'turn' check (valence in ('up','down','turn','dispute')),
  importance  smallint not null default 1 check (importance between 1 and 3),
  place       text,
  then_text   text,
  later_text  text,
  commentary  text,
  sort        int not null default 0,
  check (public._prec_ok(event_date, date_prec))
);
create index tl_events_date_idx on public.tl_events (event_date);

create table public.tl_event_people (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.tl_events(id) on delete cascade,
  person_id  uuid not null references public.persons(id) on delete cascade,
  role       text not null default 'protagonist' check (role in ('protagonist','counterpart','partner','witness')),
  is_primary boolean not null default true,
  unique (event_id, person_id)
);
create index tl_event_people_person_idx on public.tl_event_people (person_id);

create table public.tl_event_links (
  id         uuid primary key default gen_random_uuid(),
  from_event uuid not null references public.tl_events(id) on delete cascade,
  to_event   uuid not null references public.tl_events(id) on delete cascade,
  type       text not null check (type in ('cause','echo','reversal','continuation')),
  note       text,
  unique (from_event, to_event, type),
  check (from_event <> to_event)
);
create index tl_event_links_to_idx on public.tl_event_links (to_event);

-- 证据
create table public.outlets (
  id     uuid primary key default gen_random_uuid(),
  name   text not null,
  domain text unique,
  kind   text not null default 'media' check (kind in ('media','official','personal','research','video','other'))
);

create table public.sources (
  id            uuid primary key default gen_random_uuid(),
  url           text not null,
  canonical_url text not null unique,
  outlet_id     uuid references public.outlets(id) on delete set null,
  title         text not null,
  author        text,
  published_at  date,
  pub_prec      text not null default 'day' check (pub_prec in ('year','month','day')),
  kind          text not null default 'report' check (kind in ('report','self','official','critic','video','research')),
  lang          text not null default 'zh',
  excerpt       text,
  check (public._prec_ok(published_at, pub_prec))
);

create table public.source_snapshots (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references public.sources(id) on delete cascade,
  kind        text not null check (kind in ('fold','full','text')),
  oss_key     text,
  width       int,
  height      int,
  bytes       int,
  visibility  text not null default 'staff' check (visibility in ('public','staff')),
  status      text not null default 'queued' check (status in ('queued','done','failed')),
  error       text,
  captured_at timestamptz,
  created_at  timestamptz not null default now()
);
create index source_snapshots_src_idx on public.source_snapshots (source_id, kind, captured_at desc);
comment on table public.source_snapshots is '网页快照。fold=首屏截图（可公开），full=整页截图，text=正文文本（仅编辑可见）。';

create table public.citations (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references public.sources(id) on delete cascade,
  target_type text not null check (target_type in ('event','state','arc','achievement','label','stance','comparison','wealth','person')),
  target_id   uuid not null,
  quote       text,
  phase       text check (phase in ('then','later')),   -- 空 = 前端按发布日期自动判断
  sort        int not null default 0,
  unique (source_id, target_type, target_id)
);
create index citations_target_idx on public.citations (target_type, target_id);

-- ---------------------------------------------------------------------
-- 5. 通用编辑列 + 触发器 + RLS（对所有内容表统一处理）
-- ---------------------------------------------------------------------

create function public._editorial_tables() returns text[]
language sql immutable as $$
  select array[
    'persons','person_aliases','entities',
    'person_achievements','person_labels','stance_axes','person_stances','person_comparisons',
    'person_wealth_points',
    'tl_states','tl_arcs','tl_events','tl_event_people','tl_event_links',
    'outlets','sources','citations'
  ]
$$;

-- 不能放进 draft、也不参与“内容是否变化”比较的系统列
create function public._sys_cols() returns text[]
language sql immutable as $$
  select array['id','status','draft','changeset_id','version','created_at','updated_at','updated_by']
$$;

create function public._citation_target_table(t text) returns text
language sql immutable as $$
  select case t
    when 'event' then 'tl_events'           when 'state' then 'tl_states'
    when 'arc' then 'tl_arcs'               when 'achievement' then 'person_achievements'
    when 'label' then 'person_labels'       when 'stance' then 'person_stances'
    when 'comparison' then 'person_comparisons'
    when 'wealth' then 'person_wealth_points' when 'person' then 'persons'
  end
$$;

create function public._citation_type_of(tbl text) returns text
language sql immutable as $$
  select case tbl
    when 'tl_events' then 'event'           when 'tl_states' then 'state'
    when 'tl_arcs' then 'arc'               when 'person_achievements' then 'achievement'
    when 'person_labels' then 'label'       when 'person_stances' then 'stance'
    when 'person_comparisons' then 'comparison'
    when 'person_wealth_points' then 'wealth' when 'persons' then 'person'
  end
$$;

-- 当前写入者是否是 agent（service_role 且不在系统函数里）
create function public._is_agent() returns boolean
language sql stable as $$
  select coalesce(auth.role(), '') = 'service_role'
     and coalesce(current_setting('app.system', true), '') <> 'on'
$$;

-- BEFORE 触发器：维护版本与时间戳，校验 draft，限制 agent 只能提交草稿
create function public._ed_before() returns trigger
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
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- 受影响的人物（用于入队导出）
create function public._affected_persons(tbl text, r jsonb) returns setof uuid
language plpgsql stable security invoker set search_path = public as $$
declare
  t   text;
  row jsonb;
begin
  if r is null then return; end if;
  case tbl
    when 'persons' then
      return next (r->>'id')::uuid;
    when 'person_aliases','person_achievements','person_labels','person_stances',
         'person_wealth_points','tl_states','tl_arcs','tl_event_people' then
      return next (r->>'person_id')::uuid;
    when 'person_comparisons' then
      return next (r->>'person_id')::uuid;
      if r->>'other_person_id' is not null then return next (r->>'other_person_id')::uuid; end if;
    when 'tl_events' then
      return query select person_id from tl_event_people where event_id = (r->>'id')::uuid;
    when 'tl_event_links' then
      return query select person_id from tl_event_people
                   where event_id in ((r->>'from_event')::uuid, (r->>'to_event')::uuid);
    when 'entities' then
      return query select person_id from tl_arcs where entity_id = (r->>'id')::uuid;
    when 'stance_axes' then
      return query select person_id from person_stances where axis_id = (r->>'id')::uuid;
    when 'citations' then
      t := public._citation_target_table(r->>'target_type');
      execute format('select to_jsonb(x) from %I x where id = $1', t) into row using (r->>'target_id')::uuid;
      return query select * from public._affected_persons(t, row);
    when 'sources' then
      for row in select to_jsonb(c) from citations c where c.source_id = (r->>'id')::uuid loop
        return query select * from public._affected_persons('citations', row);
      end loop;
    when 'outlets' then
      for row in select to_jsonb(c) from citations c join sources s on s.id = c.source_id
                 where s.outlet_id = (r->>'id')::uuid loop
        return query select * from public._affected_persons('citations', row);
      end loop;
    else
      return;
  end case;
end $$;

create function public._enqueue_export(tbl text, r jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare
  pid uuid;
begin
  for pid in select distinct p from public._affected_persons(tbl, r) p where p is not null loop
    insert into jobs (kind, dedupe_key, payload)
    values ('export_person', pid::text, jsonb_build_object('person_id', pid))
    on conflict (kind, dedupe_key) where status = 'queued' do nothing;
  end loop;
  if tbl = 'persons' then
    insert into jobs (kind, dedupe_key, payload) values ('export_index', 'persons', '{}')
    on conflict (kind, dedupe_key) where status = 'queued' do nothing;
  end if;
end $$;

-- AFTER 触发器：写修订、清理孤儿引用、影响线上内容时入队导出
create function public._ed_after() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  r_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  sys   text[] := public._sys_cols();
  cs    uuid;
  ctype text;
  live_changed boolean;
begin
  cs := coalesce(
    nullif(r_new->>'changeset_id', '')::uuid,
    nullif(current_setting('app.changeset', true), '')::uuid,
    nullif(r_old->>'changeset_id', '')::uuid
  );

  insert into revisions (table_name, row_id, op, before, after, actor, actor_role, changeset_id)
  values (tg_table_name, coalesce((r_new->>'id')::uuid, (r_old->>'id')::uuid), tg_op,
          r_old, r_new, auth.uid(), coalesce(auth.role(), session_user::text), cs);

  if tg_op = 'DELETE' then
    ctype := public._citation_type_of(tg_table_name);
    if ctype is not null then
      delete from citations where target_type = ctype and target_id = old.id;
    end if;
  end if;

  -- 只有线上可见内容变化时才导出：涉及已发布行，且不只是改了 draft
  live_changed :=
    (coalesce(r_new->>'status', '') = 'published' or coalesce(r_old->>'status', '') = 'published')
    and not (tg_op = 'UPDATE'
             and (r_new - sys) = (r_old - sys)
             and r_new->>'status' = r_old->>'status');

  if live_changed then
    perform public._enqueue_export(tg_table_name, r_new);
    if tg_op <> 'INSERT' then perform public._enqueue_export(tg_table_name, r_old); end if;
  end if;

  return null;
end $$;

-- 引用目标必须存在
create function public._citation_check() returns trigger
language plpgsql as $$
declare ok boolean;
begin
  execute format('select exists (select 1 from %I where id = $1)', public._citation_target_table(new.target_type))
    into ok using new.target_id;
  if not ok then
    raise exception '引用目标不存在：% %', new.target_type, new.target_id;
  end if;
  return new;
end $$;

create trigger citations_target_check before insert or update of target_type, target_id
  on public.citations for each row execute function public._citation_check();

-- 统一追加列、触发器、RLS、授权
do $$
declare
  t text;
begin
  foreach t in array public._editorial_tables() loop
    execute format($f$
      alter table public.%1$I
        add column status       text not null default 'draft' check (status in ('draft','published','archived')),
        add column draft        jsonb,
        add column changeset_id uuid references public.changesets(id) on delete set null,
        add column version      int  not null default 1,
        add column created_at   timestamptz not null default now(),
        add column updated_at   timestamptz not null default now(),
        add column updated_by   uuid
    $f$, t);
    execute format('create index %1$s_status_idx on public.%1$I (status)', t);
    execute format('create index %1$s_changeset_idx on public.%1$I (changeset_id) where changeset_id is not null', t);
    execute format('create trigger %1$s_ed_before before insert or update or delete on public.%1$I
                    for each row execute function public._ed_before()', t);
    execute format('create trigger %1$s_ed_after after insert or update or delete on public.%1$I
                    for each row execute function public._ed_after()', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('create policy staff_all on public.%I for all to authenticated
                    using (public.is_staff()) with check (public.is_staff())', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- 非草稿类表的 RLS
alter table public.site_staff enable row level security;
-- 只能读到自己那一行，is_staff() 依赖这条策略。名单只在 SQL 编辑器里维护，浏览器不能写。
create policy self_read on public.site_staff for select to authenticated using (user_id = auth.uid());

alter table public.changesets enable row level security;
create policy staff_all on public.changesets for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 触发器以写入者身份执行，所以管理员需要能插入修订和任务；不给改、删权限
alter table public.revisions enable row level security;
create policy staff_read   on public.revisions for select to authenticated using (public.is_staff());
create policy staff_insert on public.revisions for insert to authenticated with check (public.is_staff());

alter table public.jobs enable row level security;
create policy staff_read   on public.jobs for select to authenticated using (public.is_staff());
create policy staff_insert on public.jobs for insert to authenticated with check (public.is_staff());

alter table public.tl_dimensions enable row level security;
create policy staff_all on public.tl_dimensions for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.source_snapshots enable row level security;
create policy staff_all on public.source_snapshots for all to authenticated using (public.is_staff()) with check (public.is_staff());

revoke all on public.site_staff, public.changesets, public.revisions, public.jobs,
              public.tl_dimensions, public.source_snapshots from anon, authenticated, public;
grant select on public.site_staff to authenticated;
grant select, insert, update, delete on public.changesets,
              public.tl_dimensions, public.source_snapshots to authenticated;
grant select, insert on public.revisions, public.jobs to authenticated;
grant all on public.site_staff, public.changesets, public.revisions, public.jobs,
             public.tl_dimensions, public.source_snapshots to service_role;
grant usage on sequence public.revisions_id_seq to service_role;

-- ---------------------------------------------------------------------
-- 6. 编辑操作：发布、拒绝、丢弃草稿、回滚
-- ---------------------------------------------------------------------

-- 发布一行：新草稿行直接上线；有 draft 的行把 draft 合并进正式字段
create function public.publish_row(p_table text, p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare
  r       jsonb;
  d       jsonb;
  setlist text;
  st      text;
begin
  if not public.can_edit() then raise exception '没有编辑权限'; end if;
  if not (p_table = any(public._editorial_tables())) then raise exception '不支持的表：%', p_table; end if;

  execute format('select to_jsonb(t) from %I t where id = $1', p_table) into r using p_id;
  if r is null then raise exception '% 中不存在 %', p_table, p_id; end if;

  perform set_config('app.changeset', coalesce(r->>'changeset_id', ''), true);
  d  := nullif(r->'draft', 'null'::jsonb);
  st := coalesce(d->>'status', 'published');

  select string_agg(format('%I = (s.r).%I', k, k), ', ')
    into setlist
    from jsonb_object_keys(coalesce(d, '{}'::jsonb) - 'status') k;

  if setlist is null then
    execute format('update %I set status = $1, draft = null, changeset_id = null where id = $2', p_table)
      using st, p_id;
  else
    execute format(
      'update %1$I t set %2$s, status = $1, draft = null, changeset_id = null
         from (select jsonb_populate_record(null::%1$I, $2) as r) s
        where t.id = $3', p_table, setlist)
      using st, (r - 'draft') || (d - 'status'), p_id;
  end if;
end $$;

create function public.publish_changeset(p_changeset uuid) returns int
language plpgsql security invoker set search_path = public as $$
declare
  t  text;
  id uuid;
  n  int := 0;
begin
  if not public.can_edit() then raise exception '没有编辑权限'; end if;
  if not exists (select 1 from changesets where changesets.id = p_changeset and status = 'open') then
    raise exception '变更集不存在或已处理';
  end if;
  foreach t in array public._editorial_tables() loop
    for id in execute format('select id from %I where changeset_id = $1', t) using p_changeset loop
      perform public.publish_row(t, id);
      n := n + 1;
    end loop;
  end loop;
  update changesets set status = 'applied', resolved_at = now(), resolved_by = auth.uid() where changesets.id = p_changeset;
  return n;
end $$;

-- 拒绝变更集：删除其中新建的草稿行，清空对已发布行的修改提议
create function public.reject_changeset(p_changeset uuid) returns int
language plpgsql security invoker set search_path = public as $$
declare
  t text;
  n int := 0;
  c int;
  order_for_delete text[] := array[
    'citations','tl_event_links','tl_event_people','person_stances','person_comparisons',
    'person_achievements','person_labels','person_wealth_points','person_aliases',
    'tl_states','tl_arcs','tl_events','sources','outlets','stance_axes','entities','persons'
  ];
begin
  if not public.can_edit() then raise exception '没有编辑权限'; end if;
  perform set_config('app.changeset', p_changeset::text, true);
  foreach t in array order_for_delete loop
    execute format('delete from %I where changeset_id = $1 and status = ''draft''', t) using p_changeset;
    get diagnostics c = row_count; n := n + c;
    execute format('update %I set draft = null, changeset_id = null where changeset_id = $1', t) using p_changeset;
    get diagnostics c = row_count; n := n + c;
  end loop;
  update changesets set status = 'rejected', resolved_at = now(), resolved_by = auth.uid() where id = p_changeset;
  return n;
end $$;

create function public.discard_draft(p_table text, p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare st text;
begin
  if not public.can_edit() then raise exception '没有编辑权限'; end if;
  if not (p_table = any(public._editorial_tables())) then raise exception '不支持的表：%', p_table; end if;
  execute format('select status from %I where id = $1', p_table) into st using p_id;
  if st = 'draft' then
    execute format('delete from %I where id = $1', p_table) using p_id;
  else
    execute format('update %I set draft = null, changeset_id = null where id = $1', p_table) using p_id;
  end if;
end $$;

-- 回滚某条修订：生成一个反向变更集，审核发布后生效。
-- 回滚删除时，同一次操作里级联删除的行（参与人、关联、引用）会按依赖顺序一起恢复。
create function public.revert_revision(p_revision bigint) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  rv  revisions;
  cs  uuid;
  cur jsonb;
  d   jsonb;
  t   text;
  b   jsonb;
  ex  boolean;
  restore_order text[] := array[
    'persons','entities','stance_axes','outlets','sources','tl_events',
    'person_aliases','person_achievements','person_labels','person_stances','person_comparisons',
    'person_wealth_points','tl_states','tl_arcs','tl_event_people','tl_event_links','citations'
  ];
begin
  if not public.can_edit() then raise exception '没有编辑权限'; end if;
  select * into rv from revisions where id = p_revision;
  if rv.id is null then raise exception '修订不存在'; end if;
  if not (rv.table_name = any(public._editorial_tables())) then raise exception '该表不支持回滚'; end if;

  insert into changesets (title, origin, author)
  values (format('回滚修订 #%s（%s %s）', rv.id, rv.table_name, rv.op), 'revert', 'system')
  returning id into cs;

  execute format('select to_jsonb(t) from %I t where id = $1', rv.table_name) into cur using rv.row_id;

  if rv.op = 'DELETE' then
    if cur is not null then raise exception '该行已重新存在，无需恢复'; end if;
    foreach t in array restore_order loop
      for b in select r.before from revisions r
                where r.txid = rv.txid and r.op = 'DELETE' and r.table_name = t order by r.id loop
        execute format('select exists (select 1 from %I where id = $1)', t) into ex using (b->>'id')::uuid;
        if not ex then
          execute format('insert into %1$I select * from jsonb_populate_record(null::%1$I, $1)', t)
            using b || jsonb_build_object(
              'status', 'draft', 'changeset_id', cs,
              'draft', case when b->>'status' = 'archived' then '{"status":"archived"}'::jsonb end);
        end if;
      end loop;
    end loop;
  elsif cur is null then
    raise exception '该行已被删除，请回滚对应的删除修订';
  elsif rv.op = 'INSERT' then
    execute format('update %I set draft = $1, changeset_id = $2 where id = $3', rv.table_name)
      using '{"status":"archived"}'::jsonb, cs, rv.row_id;
  else
    d := rv.before - public._sys_cols();
    if rv.before->>'status' = 'archived' then d := d || '{"status":"archived"}'; end if;
    execute format('update %I set draft = $1, changeset_id = $2 where id = $3', rv.table_name)
      using d, cs, rv.row_id;
  end if;
  return cs;
end $$;

-- ---------------------------------------------------------------------
-- 7. 读取：公开版只含已发布内容；编辑版含草稿、版本号与 id
-- ---------------------------------------------------------------------

create function public._vis(st text, editor boolean) returns boolean
language sql immutable as $$ select st = 'published' or (editor and st <> 'archived') $$;

create function public._meta(r jsonb, editor boolean) returns jsonb
language sql immutable as $$
  select case when editor then jsonb_build_object(
    'id', r->'id', 'status', r->'status', 'draft', r->'draft',
    'changeset_id', r->'changeset_id', 'version', r->'version', 'updated_at', r->'updated_at')
  else '{}'::jsonb end
$$;

create function public._cites(p_type text, p_id uuid, editor boolean) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'title', s.title, 'url', s.url, 'outlet', o.name, 'outlet_domain', o.domain,
      'published_at', s.published_at, 'pub_prec', s.pub_prec, 'kind', s.kind, 'lang', s.lang,
      'excerpt', s.excerpt, 'quote', c.quote, 'phase', c.phase,
      'snapshot', (
        select jsonb_build_object('oss_key', ss.oss_key, 'width', ss.width, 'height', ss.height, 'kind', ss.kind)
          from source_snapshots ss
         where ss.source_id = s.id and ss.status = 'done'
           and (ss.kind = 'fold' or editor)
           and (ss.visibility = 'public' or editor)
         order by (ss.kind = 'fold') desc, ss.captured_at desc
         limit 1)
    )
    || public._meta(to_jsonb(c), editor)
    || case when editor then jsonb_build_object('source_id', s.id, 'source_status', s.status) else '{}' end
    order by c.sort, s.published_at nulls last), '[]'::jsonb)
  from citations c
  join sources s on s.id = c.source_id
  left join outlets o on o.id = s.outlet_id
  where c.target_type = p_type and c.target_id = p_id
    and public._vis(c.status, editor) and public._vis(s.status, editor)
$$;

create function public._person_payload(pid uuid, editor boolean) returns jsonb
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
        'position', x.position, 'note', x.note,
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

-- 公开：人物详情（只返回已发布内容；人物未发布时返回 null）
create function public.person_public(p_slug text) returns jsonb
language sql stable security invoker set search_path = public as $$
  select public._person_payload(p.id, false)
  from persons p where p.slug = p_slug and p.status = 'published'
$$;

-- 编辑：人物详情（含草稿、待审修改、版本号）+ 未处理的变更集
create function public.person_editor(p_slug text) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  pid uuid;
begin
  if not public.can_edit() then raise exception '没有编辑权限'; end if;
  select id into pid from persons where slug = p_slug;
  if pid is null then return null; end if;
  return public._person_payload(pid, true)
    || jsonb_build_object('open_changesets', (
         select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'title', c.title, 'origin', c.origin, 'author', c.author, 'created_at', c.created_at)
           order by c.created_at desc), '[]')
         from changesets c where c.status = 'open'));
end $$;

-- 公开：人物列表
create function public.persons_public() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', p.slug, 'name', p.name, 'name_zh', p.name_zh, 'nickname', p.nickname,
    'avatar_url', p.avatar_url, 'person_group', p.person_group, 'role', p.role, 'tier', p.tier,
    'fields', p.fields, 'take_text', p.take_text, 'take_updated_at', p.take_updated_at,
    'x_handle', p.x_handle,
    'event_count', (select count(*) from tl_event_people ep join tl_events e on e.id = ep.event_id
                    where ep.person_id = p.id and ep.status = 'published' and e.status = 'published')
  ) order by p.added_at, p.name), '[]')
  from persons p where p.status = 'published'
$$;

-- ---------------------------------------------------------------------
-- 8. worker 专用（仅 service_role 可调用）
-- ---------------------------------------------------------------------
create function public.claim_jobs(p_kind text, p_limit int, p_worker text) returns setof public.jobs
language plpgsql security invoker set search_path = public as $$
begin
  return query
  update jobs j
     set status = 'running', locked_at = now(), locked_by = p_worker,
         attempts = j.attempts + 1, updated_at = now()
   where j.id in (
     select id from jobs
      where kind = p_kind
        and ((status = 'queued' and run_after <= now())
          or (status = 'running' and locked_at < now() - interval '15 minutes'))
      order by run_after
      for update skip locked
      limit p_limit)
  returning j.*;
end $$;

create function public.finish_job(p_id uuid, p_ok boolean, p_error text default null) returns void
language plpgsql security invoker set search_path = public as $$
declare
  j jobs;
begin
  select * into j from jobs where id = p_id;
  if j.id is null then raise exception '任务不存在'; end if;
  if p_ok then
    update jobs set status = 'done', last_error = null, locked_at = null, updated_at = now() where id = p_id;
  elsif j.attempts >= 5 then
    update jobs set status = 'failed', last_error = p_error, locked_at = null, updated_at = now() where id = p_id;
  else
    begin
      update jobs set status = 'queued', last_error = p_error, locked_at = null,
                      run_after = now() + make_interval(mins => j.attempts * j.attempts), updated_at = now()
       where id = p_id;
    exception when unique_violation then
      -- 同一对象已有新的排队任务，这条视为被取代
      update jobs set status = 'done', last_error = '被新任务取代：' || coalesce(p_error, ''),
                      locked_at = null, updated_at = now()
       where id = p_id;
    end;
  end if;
end $$;

-- 头像任务直接更新已发布人物，绕过 agent 草稿限制
create function public.worker_set_avatar(p_slug text, p_url text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  perform set_config('app.system', 'on', true);
  update persons set avatar_url = p_url where slug = p_slug;
  if not found then raise exception '人物不存在：%', p_slug; end if;
end $$;

-- ---------------------------------------------------------------------
-- 9. 函数授权
-- ---------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_prec_ok','_short_id','is_staff','is_owner','can_edit','_editorial_tables','_sys_cols',
                         '_citation_target_table','_citation_type_of','_is_agent','_ed_before','_affected_persons',
                         '_enqueue_export','_ed_after','_citation_check','publish_row','publish_changeset',
                         'reject_changeset','discard_draft','revert_revision','_vis','_meta','_cites',
                         '_person_payload','person_public','person_editor','persons_public',
                         'claim_jobs','finish_job','worker_set_avatar')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end $$;

-- RLS 策略、列默认值、触发器里用到的（触发器以写入者身份调用这些辅助函数）
grant execute on function public.is_staff(), public.is_owner(), public._prec_ok(date, text),
                          public._short_id(), public._sys_cols(), public._editorial_tables(),
                          public._is_agent(), public._citation_target_table(text),
                          public._citation_type_of(text) to anon, authenticated, service_role;
-- 公开读取：只给 service_role（导出任务、Edge 函数）。管理员也可调用，便于预览线上效果。
grant execute on function public.person_public(text), public.persons_public() to authenticated, service_role;
grant execute on function public._vis(text, boolean), public._meta(jsonb, boolean),
                          public._cites(text, uuid, boolean), public._person_payload(uuid, boolean)
                          to authenticated, service_role;
-- 管理员（触发器链路里的导出入队也以管理员身份执行）
grant execute on function public._affected_persons(text, jsonb), public._enqueue_export(text, jsonb)
                          to authenticated, service_role;
grant execute on function public.can_edit(), public.person_editor(text),
                          public.publish_row(text, uuid), public.publish_changeset(uuid),
                          public.reject_changeset(uuid), public.discard_draft(text, uuid),
                          public.revert_revision(bigint) to authenticated;
-- worker
grant execute on function public.claim_jobs(text, int, text), public.finish_job(uuid, boolean, text),
                          public.worker_set_avatar(text, text) to service_role;

-- ---------------------------------------------------------------------
-- 10. 初始配置
-- ---------------------------------------------------------------------
insert into public.tl_dimensions (key, label, sort, default_estimate) values
  ('role',   '身份', 10, false),
  ('wealth', '财富', 20, true),
  ('family', '家庭', 30, false);

commit;
