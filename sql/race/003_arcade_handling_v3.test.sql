-- 在 001 → 002 → 003 之后执行。以浏览器身份验证新旧版本隔离，最后回滚。
begin;
set local role anon;

-- 旧客户端仍能交 v2 历史，默认版本变成 v3；v2 即使更快也不进入新榜。
insert into public.race_scores (player_key, nickname, laps, lap_ms, total_ms, best_lap_ms, version)
values ('arcade-v2-0123456789abcdef0123456789abcdef', '旧版', 2, '{80000,80000}', 160000, 80000, '2');
insert into public.race_scores (player_key, nickname, laps, lap_ms, total_ms, best_lap_ms)
values ('arcade-v3-0123456789abcdef0123456789abcdef', '新版', 2, '{110000,110000}', 220000, 110000);

-- 后续第二场：仅在回滚事务内由所有者调整测试记录时间，正常客户端无更新权限。
reset role;
update public.race_scores set created_at = now() - interval '101 seconds'
where player_id = encode(sha256(convert_to('arcade-v3-0123456789abcdef0123456789abcdef', 'UTF8')), 'hex');
set local role anon;
insert into public.race_scores (player_key, nickname, laps, lap_ms, total_ms, best_lap_ms, version)
values ('arcade-v3-0123456789abcdef0123456789abcdef', '新版', 2, '{90000,90000}', 180000, 90000, '3');

do $$
declare
  old_id text := encode(sha256(convert_to('arcade-v2-0123456789abcdef0123456789abcdef', 'UTF8')), 'hex');
  new_id text := encode(sha256(convert_to('arcade-v3-0123456789abcdef0123456789abcdef', 'UTF8')), 'hex');
  rejected boolean := false;
begin
  if (select count(*) from public.race_scores where player_id = old_id and version = '2') <> 1 then
    raise exception 'v2 history was not preserved';
  end if;
  if exists (select 1 from public.race_leaderboard where player_id = old_id) then
    raise exception 'v2 score leaked into v3 leaderboard';
  end if;
  if (select count(*) from public.race_scores where player_id = new_id and version = '3') <> 2 then
    raise exception 'default/explicit v3 scores were not accepted';
  end if;
  if (select count(*) from public.race_leaderboard where player_id = new_id and total_ms = 180000) <> 1 then
    raise exception 'v3 leaderboard did not select the personal best';
  end if;
  begin
    insert into public.race_scores (player_key, nickname, laps, lap_ms, total_ms, best_lap_ms, version)
    values ('arcade-invalid-0123456789abcdef0123456789abcdef', '错误版本', 2, '{90000,90000}', 180000, 90000, 'invalid');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'unsupported physics version accepted'; end if;
end $$;

select 'race arcade v3: all checks passed' as result;
rollback;
