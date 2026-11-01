-- 西湖飞车 · 成绩榜。跑在社区库（阿里云 Supabase，"amazingindex"），浏览器用公开的 publishable key 直连 PostgREST。
-- 该镜像不允许 SECURITY DEFINER 函数，所以这里全部是普通（SECURITY INVOKER）函数，权限靠 RLS 和列/表授权控制：
--   - 浏览器只能 INSERT 一条成绩、SELECT 成绩；不能改、不能删（删由你在后台手动做）。
--   - 玩家身份：浏览器本地生成一个随机密钥 player_key，只在上传时发送；触发器把它换成 sha256 存进 player_id，
--     密钥本身不落库。别人看得到 player_id（哈希），但拿不到密钥，冒充不了你的身份。
--   - 防作弊（挡住随手乱改，挡不住专门伪造）：每圈 60 s–10 min、总时间 = 各圈之和（误差 1.5 s 内）、
--     最快圈 = 各圈最小值、同一玩家 100 秒内只能交一次（一场两圈至少两分钟）。
-- 一次执行，可重复执行。

create table if not exists public.race_scores (
  id          bigint generated always as identity primary key,
  player_key  text,                                -- 只在插入时出现，触发器换成哈希后清空
  player_id   text not null default '',            -- sha256(player_key) 的 16 进制
  nickname    text not null check (char_length(btrim(nickname)) between 1 and 12),
  laps        smallint not null check (laps = 2),
  lap_ms      integer[] not null,
  total_ms    integer not null check (total_ms between 120000 and 1200000),
  best_lap_ms integer not null check (best_lap_ms between 60000 and 600000),
  version     text not null default '1' check (char_length(version) <= 16),
  created_at  timestamptz not null default now()
);

-- 各圈之和、最小值（IMMUTABLE，给 CHECK 用）
create or replace function public.race_lap_sum(int[]) returns bigint
language sql immutable as $$ select coalesce(sum(x), 0) from unnest($1) as x $$;
create or replace function public.race_lap_min(int[]) returns int
language sql immutable as $$ select min(x) from unnest($1) as x $$;
create or replace function public.race_lap_ok(int[]) returns boolean
language sql immutable as $$ select bool_and(x between 60000 and 600000) from unnest($1) as x $$;

alter table public.race_scores drop constraint if exists race_scores_laps_match;
alter table public.race_scores add constraint race_scores_laps_match check (
  array_length(lap_ms, 1) = laps
  and public.race_lap_ok(lap_ms)
  and abs(public.race_lap_sum(lap_ms) - total_ms) <= 1500
  and public.race_lap_min(lap_ms) = best_lap_ms
);

-- 插入前：密钥换成哈希、昵称去掉首尾空白、限流
create or replace function public.race_scores_before_insert() returns trigger
language plpgsql as $$
begin
  if new.player_key is null or char_length(new.player_key) not between 32 and 128 then
    raise exception 'race: bad player key' using errcode = '22023';
  end if;
  new.player_id := encode(sha256(convert_to(new.player_key, 'UTF8')), 'hex');
  new.player_key := null;
  new.nickname := btrim(new.nickname);
  new.created_at := now();
  if exists (select 1 from public.race_scores r where r.player_id = new.player_id and r.created_at > now() - interval '100 seconds') then
    raise exception 'race: too many submissions' using errcode = '54000';
  end if;
  return new;
end
$$;
drop trigger if exists race_scores_before_insert on public.race_scores;
create trigger race_scores_before_insert before insert on public.race_scores
  for each row execute function public.race_scores_before_insert();

create index if not exists race_scores_player_best on public.race_scores (player_id, total_ms, created_at);
create index if not exists race_scores_total on public.race_scores (total_ms, created_at);

-- 权限：浏览器角色只能插入、读取；不能改、不能删。player_key 列不可读。
alter table public.race_scores enable row level security;
revoke all on public.race_scores from anon, authenticated;
grant insert (player_key, nickname, laps, lap_ms, total_ms, best_lap_ms, version) on public.race_scores to anon, authenticated;
grant select (id, player_id, nickname, laps, lap_ms, total_ms, best_lap_ms, version, created_at) on public.race_scores to anon, authenticated;

drop policy if exists race_scores_insert on public.race_scores;
create policy race_scores_insert on public.race_scores for insert to anon, authenticated with check (true);
drop policy if exists race_scores_read on public.race_scores;
create policy race_scores_read on public.race_scores for select to anon, authenticated using (true);

-- 总榜：每个玩家只取自己最好的一次，按总时间排名（同成绩先交的在前）。SECURITY INVOKER 视图，读权限仍走上面的 RLS。
create or replace view public.race_leaderboard with (security_invoker = true) as
select (row_number() over (order by b.total_ms, b.created_at))::int as rank,
       b.player_id, b.nickname, b.total_ms, b.best_lap_ms, b.lap_ms, b.created_at
from (
  select distinct on (player_id) player_id, nickname, total_ms, best_lap_ms, lap_ms, created_at
  from public.race_scores
  order by player_id, total_ms, created_at
) b;
grant select on public.race_leaderboard to anon, authenticated;

-- 让 PostgREST 立刻看到新表和视图
notify pgrst, 'reload schema';
