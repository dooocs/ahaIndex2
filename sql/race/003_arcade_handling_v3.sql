-- AmazingIndex 西湖飞车 v3：街机物理排行榜。
-- 请在部署新版前执行；保留 v2 历史分数，只将 v3 分数纳入当前榜单。
-- 注意：迁移执行后，尚未更新的客户端提交的 v2 分数仍然保存在历史中，不显示在新榜。
begin;
alter table public.race_scores alter column version set default '3';
alter table public.race_scores drop constraint if exists race_scores_version;
alter table public.race_scores add constraint race_scores_version check (version in ('2', '3'));

create or replace view public.race_leaderboard with (security_invoker = true) as
select (row_number() over (order by b.total_ms, b.created_at))::int as rank,
       b.player_id, b.nickname, b.total_ms, b.best_lap_ms, b.lap_ms, b.created_at
from (
  select distinct on (player_id) player_id, nickname, total_ms, best_lap_ms, lap_ms, created_at
  from public.race_scores
  where version = '3'
  order by player_id, total_ms, created_at
) b;
grant select on public.race_leaderboard to anon, authenticated;
commit;
notify pgrst, 'reload schema';
