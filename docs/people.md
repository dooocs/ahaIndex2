# 人物：怎么写一个人

人物内容存在**阿里云 Supabase**，草稿、发布、修订历史都在那里。新闻库（官方
Supabase，构建读的那个）只保存一份**发布快照**，由阿里云的定时任务自动写入。
GitHub 上的构建和任务只碰新闻库，不碰阿里云。

```
你编辑 / 发布 ──▶ 阿里云（唯一来源）
                   │  ▲
         发布快照  │  │  头像、AI 提议
                   ▼  │
          阿里云 pg_cron 同步任务
                   │  ▲
                   ▼  │
     新闻库 people_snapshots / people_outbox ◀── GitHub：头像任务
                   │
                   ▼
     GitHub 构建（每小时）──▶ OSS 上的 /people 页面
```

网址是 `/people/<slug>`。改完发布后约 2 分钟进新闻库，下一次每小时部署上线。

## 在哪里改

在阿里云 Supabase 里改，不要再改新闻库的 `people`、`person_profiles`：它们是迁移前的
旧表，已停止使用，改了也不会生效。新闻库的 `people_snapshots` 每次同步都会被覆盖，也不要手改。

阿里云的表（结构见 `sql/people/aliyun/001_persons_domain.sql`）：

| 表 | 一行是 |
| --- | --- |
| `persons` | 一个人：身份、蜗牛说、照片、出生、发布状态 |
| `tl_events` + `tl_event_people` | 一件事和它涉及的人（一件事可以属于几个人） |
| `tl_arcs` | 人生主线（金山 1992–2007），可挂到 `entities` 里的公司/学校 |
| `tl_states` | 身份 / 财富 / 家庭等状态区间，列由 `tl_dimensions` 决定 |
| `person_achievements`、`person_labels`、`person_stances`、`person_comparisons` | 右栏：成就、别人怎么叫他、立场、对照 |
| `sources` + `citations` | 来源和它支撑的内容 |

每张内容表都有 `status`（`draft` / `published` / `archived`）和 `draft`（对已发布行的待发布修改）。

- 新内容先是草稿，执行 `select publish_row('表名', id);` 上线。
- 改已发布的内容：把改动写进 `draft` 字段，线上不变；`publish_row` 后才生效。
- 一批改动（例如 AI 起草的）放在一个变更集里：`select publish_changeset(id);` 整批上线，
  `select reject_changeset(id);` 整批丢弃。
- 每次增删改都自动记进 `revisions`；`select revert_revision(修订号);` 生成一个反向变更集，
  发布后即回滚。

管理员名单在阿里云的 `site_staff` 表里，只能在 SQL 编辑器里改。

## 三种状态

| 状态 | 怎么判断 | 线上效果 |
| --- | --- | --- |
| 草稿 | `persons.status = 'draft'` | 不进快照，不发布 |
| 评价待写 | 已发布，`take_text` 为空 | 有页面，但 `noindex`，不进 sitemap；只显示身份和最近动态 |
| 已写 | 已发布，有 `take_text` | 正常收录，进 sitemap；列表里显示「看清他的那件事」 |

构建拿到快照后仍按 `src/lib/people.ts` 的规则校验：一个人不符合时，构建不会失败，而是
**跳过这个人**并在日志里警告（`人物 xxx 没有发布：……`），其他人照常上线。

当前页面还没有显示新结构里的人生主线、状态列和「高光」事件，含「高光」或缺正反方的
「争议」的人会被跳过。新的人生时间线页面上线前，这类人物（例如雷军）先不要发布。

## 同步

阿里云里的三个定时任务（`sql/people/aliyun/006_people_sync.sql`）：

| 任务 | 频率 | 做什么 |
| --- | --- | --- |
| `people-sync-push` | 每 2 分钟 | 把有改动的已发布人物推成快照；下线的人删除快照 |
| `people-sync-pull` | 每 10 分钟 | 处理新闻库 `people_outbox` 里的消息（目前是头像） |
| `people-sync-reconcile` | 每天 04:23 | 逐人比对快照指纹，不一致的重推（兜住改别人名字这类间接变化） |

在阿里云查看：`select people_sync_overview();`（任务积压、最近错误）。等不及 2 分钟：
`select people_sync_push_run();`。

阿里云调用新闻库只用一个同步令牌（存在阿里云 Vault，新闻库只存哈希），只能调用
`people_sync_push / state / pull / ack` 四个函数（`sql/people/005_sync_channel.sql`）。
构建发现超过 6 小时没有同步时会在日志里警告。

## 照片

GitHub Actions 的 **People Avatars** 每天 05:30（北京时间）跑一次，也可以手动触发
（可选只看不改的 dry run）：给每个已发布、有 `x_handle` 或 `github_handle` 的人取照片，
X 头像（unavatar.io）优先，其次 GitHub 头像，存到 OSS 的 `media/people/avatars/`，再把地址写进
新闻库的 `people_outbox`。阿里云的同步任务 10 分钟内把它写进 `persons.avatar_url`，再推一份新快照，
页面在下一次每小时部署时换上新照片。照片没变就什么都不做；某个人取不到就跳过并警告。

在阿里云里手动填一个不在 `media/people/avatars/` 下的地址，任务就不再覆盖它。照片只能是
`https://www.amazingindex.com/…` 下的地址，别的地址同步任务会拒收。换照片不改变人物的更新日期。

需要的 secrets：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`（写 `people_outbox`）、
`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`。

## 写真人的底线

- 事实和观点分开：事件的 `then_text` 只写发生了什么，你的判断写在 `take_text` 和 `commentary`。
- 争议两边都要有（`sides`），每条都有来源。
- 立场轴每条都要有依据链接，没有依据就不画。
- 发布前每个来源都要有链接；还没找到链接的来源可以先留着，但这个人不会上线。
