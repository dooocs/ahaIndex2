-- 西湖飞车联机成绩的自检。在执行完 003_race_mp_results.sql 之后整段执行一次：
-- 全部在一个事务里跑，最后 ROLLBACK，不会留下任何数据。
-- 每一步出错都会直接报错停下；看到最后一行 'race_mp_results: all checks passed' 就是全部通过。

begin;

-- 1. 联机服务（service_role）能写；三个玩家、两局
set local role service_role;
insert into public.race_mp_results (race_id, track, player_id, nickname, place, players, laps, lap_ms, total_ms, best_lap_ms) values
  ('00000000-0000-4000-8000-000000000001', 'xihu', repeat('a', 64), '阿甘', 1, 3, 2, '{95000,91000}', 186000, 91000),
  ('00000000-0000-4000-8000-000000000001', 'xihu', repeat('b', 64), '小贝', 2, 3, 2, '{96000,93000}', 189000, 93000),
  ('00000000-0000-4000-8000-000000000001', 'xihu', repeat('c', 64), '丙',   3, 3, 2, '{99000,98000}', 197000, 98000),
  ('00000000-0000-4000-8000-000000000002', 'xihu', repeat('b', 64), '小贝', 1, 2, 2, '{92000,90000}', 182000, 90000),
  ('00000000-0000-4000-8000-000000000002', 'xihu', repeat('a', 64), '阿甘', 2, 2, 2, '{93000,92000}', 185000, 92000);

-- 2. 不合法的成绩被拒绝（服务端有 bug 时的最后一道防线）
do $$
declare bad text[] := array[
  $q$insert into public.race_mp_results (race_id, player_id, nickname, place, players, laps, lap_ms, total_ms, best_lap_ms) values ('00000000-0000-4000-8000-000000000003', 'not-a-hash', 'a', 1, 2, 2, '{95000,91000}', 186000, 91000)$q$,      -- player_id 不是哈希
  $q$insert into public.race_mp_results (race_id, player_id, nickname, place, players, laps, lap_ms, total_ms, best_lap_ms) values ('00000000-0000-4000-8000-000000000003', repeat('d', 64), 'a', 1, 2, 2, '{30000,30000}', 60000, 30000)$q$,  -- 太快
  $q$insert into public.race_mp_results (race_id, player_id, nickname, place, players, laps, lap_ms, total_ms, best_lap_ms) values ('00000000-0000-4000-8000-000000000003', repeat('d', 64), ' ', 1, 2, 2, '{95000,91000}', 186000, 91000)$q$,      -- 空昵称
  $q$insert into public.race_mp_results (race_id, player_id, nickname, place, players, laps, lap_ms, total_ms, best_lap_ms) values ('00000000-0000-4000-8000-000000000003', repeat('d', 64), 'a', 5, 2, 2, '{95000,91000}', 186000, 91000)$q$,      -- 名次超出 4
  $q$insert into public.race_mp_results (race_id, player_id, nickname, place, players, laps, lap_ms, total_ms, best_lap_ms) values ('00000000-0000-4000-8000-000000000001', repeat('a', 64), '阿甘', 1, 3, 2, '{95000,91000}', 186000, 91000)$q$  -- 同一局同一人重复
];
  q text;
  rejected boolean;
begin
  foreach q in array bad loop
    rejected := false;
    begin
      execute q;
    exception when check_violation or unique_violation then rejected := true;
    end;
    if not rejected then raise exception 'check 2: accepted an invalid row: %', q; end if;
  end loop;
end $$;

-- 3. 浏览器角色能读总榜：每人只取最好的一次，名次、局数、夺冠次数正确
set local role anon;
do $$
declare r record;
begin
  select * into r from public.race_mp_leaderboard where track = 'xihu' and player_id = repeat('b', 64);
  if r is null then raise exception 'check 3: player b missing from leaderboard'; end if;
  if r.rank <> 1 or r.total_ms <> 182000 then raise exception 'check 3: b should be #1 with 182000, got #% %', r.rank, r.total_ms; end if;
  if r.races <> 2 or r.wins <> 1 then raise exception 'check 3: b races/wins wrong (% / %)', r.races, r.wins; end if;
  select * into r from public.race_mp_leaderboard where track = 'xihu' and player_id = repeat('a', 64);
  if r.rank <> 2 or r.total_ms <> 185000 or r.wins <> 1 then raise exception 'check 3: a wrong (#% % wins %)', r.rank, r.total_ms, r.wins; end if;
  if (select count(*) from public.race_mp_leaderboard where track = 'xihu') <> 3 then raise exception 'check 3: expected 3 players'; end if;
end $$;

-- 4. 浏览器角色不能写、不能改、不能删
do $$ begin
  insert into public.race_mp_results (race_id, player_id, nickname, place, players, laps, lap_ms, total_ms, best_lap_ms)
  values ('00000000-0000-4000-8000-000000000004', repeat('e', 64), 'x', 1, 2, 2, '{95000,91000}', 186000, 91000);
  raise exception 'check 4: anon can insert';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update public.race_mp_results set total_ms = 130000;
  raise exception 'check 4: anon can update';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  delete from public.race_mp_results;
  raise exception 'check 4: anon can delete';
exception when insufficient_privilege then null;
end $$;

set local role authenticated;
do $$ begin
  insert into public.race_mp_results (race_id, player_id, nickname, place, players, laps, lap_ms, total_ms, best_lap_ms)
  values ('00000000-0000-4000-8000-000000000004', repeat('e', 64), 'x', 1, 2, 2, '{95000,91000}', 186000, 91000);
  raise exception 'check 4: authenticated can insert';
exception when insufficient_privilege then null;
end $$;

-- 5. 不影响单机榜：race_leaderboard 仍是单机成绩的视图
reset role;
do $$ begin
  if to_regclass('public.race_scores') is not null then
    perform 1 from information_schema.columns where table_schema = 'public' and table_name = 'race_leaderboard' and column_name = 'total_ms';
    if not found then raise exception 'check 5: race_leaderboard changed shape'; end if;
  end if;
end $$;

select 'race_mp_results: all checks passed' as result;
rollback;
