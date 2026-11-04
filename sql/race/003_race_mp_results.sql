-- 西湖飞车 · 联机成绩（社区库，阿里云 Supabase）。在 SQL Editor 里整段执行一次（可重复执行），
-- 然后执行 003_race_mp_results.test.sql 自检（它会回滚，不留数据）。
--
-- 和单机榜 race_scores 的区别：
-- - 成绩由 ECS 上的联机服务（game-server/）判定并写入：检查点按顺序通过、每圈用时、名次都是服务器算的，
--   浏览器角色对这张表只有读权限，所以联机榜不能被伪造。写入用 service role key，不受 RLS 限制。
-- - player_id 与单机榜相同：浏览器本地密钥 race.player 的 sha256 十六进制（由联机服务计算），
--   同一个人的单机成绩和联机成绩可以对上。

create table if not exists public.race_mp_results (
  id          bigint generated always as identity primary key,
  race_id     uuid not null,                                -- 同一局的几行共用
  track       text not null default 'xihu' check (char_length(track) <= 32),
  player_id   text not null check (player_id ~ '^[0-9a-f]{64}$'),
  nickname    text not null check (char_length(btrim(nickname)) between 1 and 12),
  place       smallint not null check (place between 1 and 4),
  players     smallint not null check (players between 2 and 4),
  laps        smallint not null check (laps = 2),
  lap_ms      integer[] not null check (cardinality(lap_ms) = 2),
  total_ms    integer not null check (total_ms between 120000 and 1200000),
  best_lap_ms integer not null check (best_lap_ms between 50000 and 600000),
  created_at  timestamptz not null default now(),
  unique (race_id, player_id)
);

create index if not exists race_mp_results_player_best on public.race_mp_results (track, player_id, total_ms, created_at);
create index if not exists race_mp_results_total on public.race_mp_results (track, total_ms, created_at);

-- 权限：浏览器角色只读；写入只走 service role（联机服务）
alter table public.race_mp_results enable row level security;
revoke all on public.race_mp_results from anon, authenticated;
grant select on public.race_mp_results to anon, authenticated;

drop policy if exists race_mp_results_read on public.race_mp_results;
create policy race_mp_results_read on public.race_mp_results for select to anon, authenticated using (true);

-- 联机总榜：每条赛道每个玩家只取最好的一次，按总时间排名（同成绩先跑出来的在前）。
-- 另外带上联机局数和夺冠次数。SECURITY INVOKER 视图，读权限仍走上面的 RLS。
create or replace view public.race_mp_leaderboard with (security_invoker = true) as
select (row_number() over (partition by b.track order by b.total_ms, b.created_at))::int as rank,
       b.track, b.player_id, b.nickname, b.total_ms, b.best_lap_ms, b.lap_ms, b.created_at,
       s.races, s.wins
from (
  select distinct on (track, player_id) track, player_id, nickname, total_ms, best_lap_ms, lap_ms, created_at
  from public.race_mp_results
  order by track, player_id, total_ms, created_at
) b
join (
  select track, player_id, count(*)::int as races, count(*) filter (where place = 1)::int as wins
  from public.race_mp_results
  group by track, player_id
) s using (track, player_id);
grant select on public.race_mp_leaderboard to anon, authenticated;

-- 让 PostgREST 立刻看到新表和视图
notify pgrst, 'reload schema';
