-- 西湖飞车 · 真实刹车/抓地上线后清空旧榜。旧成绩（极速过弯时代的）和新成绩不可比。
-- 在 001_race_scores.sql 之后执行一次。
-- 1) 清空所有旧成绩
delete from public.race_scores;
-- 2) 只收新版本（version = '2'）的成绩：还开着旧页面、用旧代码跑的人交上来会被拒绝
alter table public.race_scores alter column version set default '2';
alter table public.race_scores drop constraint if exists race_scores_version;
alter table public.race_scores add constraint race_scores_version check (version = '2');
notify pgrst, 'reload schema';
