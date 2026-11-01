# 阿里云 Supabase · 人物

人物内容的唯一来源（docs/people.md）。这个镜像禁止 SECURITY DEFINER，所以全部函数是
SECURITY INVOKER，权限靠 RLS 和 `site_staff`。在阿里云 SQL 编辑器里按编号执行，001–007 已在线上执行过：

| 文件 | 做什么 |
| --- | --- |
| `001_persons_domain.sql` | 表、RLS、触发器（版本、修订、导出排队）、发布/回滚、读取函数、任务队列 |
| `002_verify.sql` | 走一遍完整流程后整体回滚；报错信息以 `VERIFY_OK` 开头即通过 |
| `003`（未入库） | 一次性数据导入：81 个人物、Sam Altman 样稿、雷军原型（变更集） |
| `004_sync_secrets.sql` | 在 Vault 生成同步令牌，存好新闻库地址和公开 key |
| `005_sync_check.sql` | 从阿里云调用新闻库的 `people_sync_state`，期望 200 |
| `006_people_sync.sql` | 同步函数和 pg_cron 定时任务 |
| `007_payload_dates.sql` | 发布内容补 `former_subjects` / `added_at` / `updated_at`；头像不刷新更新日期；回填更新日期 |
| `008_featured.sql` | 首页排位 `featured_rank`（1–100）和 `set_featured_people()`；发布雷军并设为第 1 位 |

新闻库那一侧是 `../005_sync_channel.sql`。
