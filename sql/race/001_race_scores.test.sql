-- 西湖飞车成绩榜的自检。在执行完 001_race_scores.sql 之后整段执行一次：
-- 全部在一个事务里、以 anon 身份跑，最后 ROLLBACK，不会留下任何数据。
-- 每一步出错都会直接报错停下；看到最后一行 'race_scores: all checks passed' 就是全部通过。

begin;
set local role anon;

-- 1. 正常成绩能插入，密钥被换成哈希、不落库
insert into public.race_scores (player_key, nickname, laps, lap_ms, total_ms, best_lap_ms)
values ('test-key-0123456789abcdef0123456789abcdef', ' 测试 ', 2, '{95000,91000}', 186000, 91000);

do $$
declare r record;
begin
  select * into r from public.race_leaderboard where player_id = encode(sha256(convert_to('test-key-0123456789abcdef0123456789abcdef', 'UTF8')), 'hex');
  if r is null then raise exception 'check 1: row not visible in leaderboard'; end if;
  if r.nickname <> '测试' then raise exception 'check 1: nickname not trimmed (%)', r.nickname; end if;
end $$;

-- 2. player_key 列读不到
do $$ begin
  perform player_key from public.race_scores limit 1;
  raise exception 'check 2: anon can read player_key';
exception when insufficient_privilege then null;
end $$;

-- 3. 各种不合法的成绩都被拒绝
do $$
declare bad text[] := array[
  $q$insert into public.race_scores (player_key, nickname, laps, lap_ms, total_ms, best_lap_ms) values ('k2-0123456789abcdef0123456789abcdef', 'a', 2, '{30000,30000}', 60000, 30000)$q$,   -- 太快
  $q$insert into public.race_scores (player_key, nickname, laps, lap_ms, total_ms, best_lap_ms) values ('k3-0123456789abcdef0123456789abcdef', 'a', 2, '{95000,91000}', 150000, 91000)$q$,  -- 总时间对不上
  $q$insert into public.race_scores (player_key, nickname, laps, lap_ms, total_ms, best_lap_ms) values ('k4-0123456789abcdef0123456789abcdef', 'a', 2, '{95000,91000}', 186000, 80000)$q$,  -- 最快圈对不上
  $q$insert into public.race_scores (player_key, nickname, laps, lap_ms, total_ms, best_lap_ms) values ('short', 'a', 2, '{95000,91000}', 186000, 91000)$q$,                                 -- 密钥太短
  $q$insert into public.race_scores (player_key, nickname, laps, lap_ms, total_ms, best_lap_ms) values ('k5-0123456789abcdef0123456789abcdef', '', 2, '{95000,91000}', 186000, 91000)$q$,      -- 空昵称
  $q$insert into public.race_scores (player_key, nickname, laps, lap_ms, total_ms, best_lap_ms) values ('test-key-0123456789abcdef0123456789abcdef', 'a', 2, '{94000,91000}', 185000, 91000)$q$  -- 100 秒内重复交
];
  q text;
begin
  foreach q in array bad loop
    begin
      execute q;
      raise exception 'check 3: accepted an invalid score: %', q;
    exception when check_violation or raise_exception or invalid_parameter_value or program_limit_exceeded then null;
    end;
  end loop;
end $$;

-- 4. 不能改、不能删
do $$ begin
  update public.race_scores set total_ms = 1;
  raise exception 'check 4: anon can update';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  delete from public.race_scores;
  raise exception 'check 4: anon can delete';
exception when insufficient_privilege then null;
end $$;

select 'race_scores: all checks passed' as result;
rollback;
