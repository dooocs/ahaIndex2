# 人物：怎么写一个人

人物存在新闻库（构建读的那个阿里云 Supabase）的两张表里：

| 表 | 一行是 | 放什么 |
| --- | --- | --- |
| `people` | 一个人（列表） | 身份、蜗牛说、关注建议、发布状态 |
| `person_profiles` | 这个人的详情（`person_id` 对应 `people.id`） | 事件、成就、标签、立场、对照 |

第一次使用：在 SQL 编辑器里依次执行 `sql/people/001_people.sql`（建表、
权限）和 `sql/people/002_seed.sql`（动态里已知的博主，加一份 Sam Altman
草稿）。两个文件都可以重复执行。

之后在表编辑器里直接改。网址是 `/people/<slug>`。每小时的动态部署和每天的
构建都会重新读这两张表，改完一小时内上线，不用提 PR。

## 三种状态

| 状态 | 怎么判断 | 线上效果 |
| --- | --- | --- |
| 草稿 | `status = 'draft'` | 不读、不发布 |
| 评价待写 | `published`，`take_text` 为空 | 有页面，但 `noindex`，不进 sitemap；只显示身份和最近动态 |
| 已写 | `published`，有 `take_text` | 正常收录，进 sitemap；列表里显示「看清他的那件事」 |

一行不符合下面的规则时，构建不会失败，而是**跳过这个人**并在日志里给出警告
（`人物 xxx 没有发布：……`），其他人照常上线。动态里出现了还没有发布档案
的博主，日志也会列出来。

## `people`（列表）

| 列 | 说明 |
| --- | --- |
| `slug` | 网址，小写字母、数字、连字符：`sam-altman` |
| `name`、`name_zh` | 名字；中文名可空 |
| `x_handle` | 不带 @，用来和动态里的帖子对上（不区分大小写，不能重复） |
| `person_group` | 掌舵人 / 研究者 / 独立开发者 / 布道者 |
| `role` | 一行身份：`OpenAI CEO · 前 YC 总裁` |
| `tier` | 可空：必看 / 值得关注 / 了解即可 |
| `take_text`、`take_updated_at` | 蜗牛说和它的改写日期。整页唯一必须是你自己写的东西 |
| `status` | `draft` / `published` |
| `former_subjects` | 可空：这个人接手的旧专题地址，例如 `{person:lei-jun}`；`person:<slug>` 和 slug 一样时不用填 |
| `added_at` | 收录日期；`updated_at` 自动更新 |

## `person_profiles`（详情）

`born`（可空文本）、`fields`（文本数组，领域），其余是 JSON 数组：

**`events`**：转折、争议、低谷，按时间排序显示。

```json
[
  {
    "date": "2023.11",
    "type": "低谷",
    "title": "被董事会解雇，5 天后回归",
    "body": "只写发生了什么。",
    "sources": [{ "title": "OpenAI 公告 2023.11.17", "url": "https://…" }],
    "sides": [{ "who": "董事会的说法", "text": "…" }, { "who": "支持他的一方", "text": "…" }],
    "reading": "这说明：你的解读（可选）",
    "pinned": true,
    "steps": [{ "date": "11.17", "text": "董事会宣布解雇他" }, { "date": "11.22", "text": "宣布回归" }]
  }
]
```

- `date`：`2005`、`2023.11` 或 `2023.11.17`；`type`：转折 / 争议 / 低谷
- 每条至少一个来源，发布时每个来源都要有 url
- **争议至少两方** `sides`
- `pinned: true` 是「如果只看一件事」，每人最多一条，只有它能有 `steps`。
  没有置顶时，列表显示最近的一条争议或低谷。

**`record`**（关键成就）：`[{ "period": "2014–2019", "text": "YC 总裁", "note": "可选小字" }]`

**`labels`**（别人怎么叫他）：`[{ "text": "ChatGPT 之父", "by": "谁这么叫", "url": "可选" }]`。没有出处的不要放。

**`stances`**（他站在哪）：

```json
[{ "left": "开源", "right": "闭源", "position": 72, "was": 40,
   "note": "一句说明", "source": { "title": "依据", "url": "https://…" },
   "others": [{ "name": "Yann LeCun", "initial": "L", "position": 10 }] }]
```

`position` / `was` 是 0–100；`was` 是以前的位置，立场没变就不填。

**`compare`**（对照着看）：`[{ "name": "马斯克", "slug": "elon-musk", "why": "一起创立 OpenAI，后来成了对手。" }]`。
`slug` 可选，对方已发布时会链到他的页面。

## 写真人的底线

- 事实和观点分开：`body` 只写发生了什么，你的判断写在 `take_text` 和 `reading`。
- 争议两边都要有，每条都有来源。
- 立场轴每条都要有依据链接，没有依据就不画。
