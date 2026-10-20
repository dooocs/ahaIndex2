# 人物：怎么写一个人

每个人一个文件：`src/content/people/<slug>.json`。文件名就是网址：
`sam-altman.json` → `/people/sam-altman`。改完提 PR，合并后下一次构建
（每天、或每小时的动态部署）就会上线。

构建和 `npm test` 都会检查每个文件，不合规就失败，并指出是哪个文件、哪一项。

## 三种状态

| 状态 | 怎么判断 | 线上效果 |
| --- | --- | --- |
| 草稿 | `"draft": true` | 不发布；只在本地 `npm run dev` 里看得到 |
| 评价待写 | 没有 `take` | 有页面，但 `noindex`，不进 sitemap；只显示身份和最近动态 |
| 已写 | 有 `take` | 正常收录，进 sitemap；列表里显示「看清他的那件事」 |

构建时如果动态里出现了还没有档案的博主，日志会列出来：
`动态里有 N 位博主还没有人物档案：@xxx`。

## 最小的文件（评价待写）

```json
{
  "slug": "pieter-levels",
  "name": "Pieter Levels",
  "x_handle": "levelsio",
  "group": "独立开发者",
  "role": "Nomad List · Photo AI 作者",
  "events": [],
  "record": [],
  "labels": [],
  "stances": [],
  "compare": [],
  "added_at": "2026-10-20",
  "updated_at": "2026-10-20"
}
```

- `group`：掌舵人 / 研究者 / 独立开发者 / 布道者
- `x_handle`：不带 @，用来和动态里的帖子对上（不区分大小写）
- `updated_at`：每次改文件都更新，它就是 sitemap 里的日期

## 写完整的一个人

完整的例子见 `src/content/people/sam-altman.json`（草稿，里面的「蜗牛说」
和「这说明」是样稿，需要你重写后再去掉 `draft`）。

- **`take`（蜗牛说）**：`{ "text": "一句话判断", "updated_at": "YYYY-MM-DD" }`。
  这是整页唯一必须是你自己写的东西，有了它这个人才算「已写」。
- **`tier`**（可选）：必看 / 值得关注 / 了解即可
- **`events`**：转折、争议、低谷。每条：
  - `date`：`2005`、`2023.11` 或 `2023.11.17`
  - `type`：转折 / 争议 / 低谷
  - `title`、`body`：发生了什么，只写事实
  - `sources`：至少一条 `{ "title", "url" }`，发布前必须有 url
  - `sides`：谁怎么说，`[{ "who", "text" }]`；**争议至少两方**
  - `reading`（可选）：这说明——你的解读
  - `pinned: true`：「如果只看一件事」，每人最多一条；可以加 `steps`
    （`[{ "date": "11.17", "text": "…" }]`）画成一条小时间线。没有置顶时，
    列表里显示最近的一条争议或低谷。
- **`record`**（关键成就）：`[{ "period": "2014–2019", "text": "…", "note": "可选的小字" }]`
- **`labels`**（别人怎么叫他）：`[{ "text": "ChatGPT 之父", "by": "谁这么叫", "url": "可选" }]`。
  没有出处的标签不要放。
- **`stances`**（他站在哪）：`left`、`right`、`position`（0–100）、`note`、
  `source`；立场变过就加 `was`（以前的位置）；`others` 放对照的人
  `[{ "name": "Yann LeCun", "initial": "L", "position": 10 }]`。
- **`compare`**（对照着看）：`[{ "name", "slug"（可选，链到他的页面）, "why" }]`
- **`born`、`fields`、`name_zh`**：可选
- **`former_subjects`**（可选）：这个人接手的旧专题地址，例如 `["person:lei-jun"]`，
  旧的 `/subjects/person:lei-jun` 会跳到这一页。`person:<slug>` 和文件名一样时不用写。

## 写真人的底线

- 事实和观点分开：`body` 只写发生了什么，你的判断写在 `take` 和 `reading`。
- 争议必须两边都有，每条都有来源。
- 立场轴每条都要有依据链接，没有依据就不画。
