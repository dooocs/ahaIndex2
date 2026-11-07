# 西湖飞车 (/race): structure

`src/pages/race.astro` frames a self-contained page, `public/race/app.html`, in a full-window iframe,
the same way 梦想人生 does. The page is plain ES modules served as static files; it shares three.js r170
with 梦想人生 (`public/dream/vendor/three-r170/`) through the same import map, so there is no bundler
and the daily deploy ships whatever changed.

## Route

About 4.2 km and roughly 2 minutes a lap. The start/finish is on 平海路 by 龙翔桥 metro station: the street runs west straight
at the music fountain between the two 湖滨 flagships, modelled on their real architecture without logos or wordmarks —
on the right the two-storey glass box with its cantilevered mezzanine and wooden tables, flanked by beige stone and
brick-lattice blocks over a herringbone plaza; on the left the blue glass towers with the patterned blue feature wall
and a warm-lit entrance. City streets have a low granite curb and metal railings instead of the lakeside balustrade; then the lap goes counter-clockwise round the lake: 湖滨 → 钱塘门 → 北山街 → 断桥 → 白堤 (锦带桥) → 平湖秋月 → 孤山路 (S-bends) → 西泠桥 → 曲院风荷 → 杨公堤
(环璧、流金、卧龙) → 三台山 zigzag past 于谦祠 (three hairpins) → 杨公堤 (隐秀、景行、浚源) → 花港观鱼 →
苏堤南口 → 太子湾 S-bends → 净慈寺 → 雷峰塔 → 长桥 → 南山路 (柳浪闻莺、钱王祠) → 解放路 → 延安路 → 龙翔桥. 苏堤 stays in the lake
as scenery with its own six bridges. Captions name the 西湖十景 and each 杨公堤 bridge as you pass them.

## Look: 梦想人生's renderer on a flat world

`js/toon.js` is 梦想人生's toon shader and ink-line post pass, changed in four places:

- noise is sampled in world metres (no planet matrix);
- every vertex is pushed down by `max(0, d − 140 m)² / 3400 m` of horizontal distance `d` from the camera,
  so the far field curves away like a small planet while the road, cars and shadows near the camera stay flat
  (the normal/depth pass bends the same way, so ink lines line up);
- the post pass adds depth haze (260 m → 1.5 km), fades ink lines with distance and draws speed lines on nitro;
- an optional per-vertex colour path (`vcol`, attributes `aLit`/`aShd`) lets differently coloured static
  parts share one mesh — every 300 m tile of scenery is one draw call per shading kind.

Why flat: on a 100-unit planet the horizon is ~45 m from a chase camera, under a second of road at racing
speed. Physics, AI and the camera all live on the plane; only the picture curves.

## Modules (`public/race/js/`)

| module | owns |
| --- | --- |
| `layout.js` | the map in metres (x east, z south): centerline control points, lake, wetlands and the water channels under 杨公堤, 苏堤, islands, hills, landmark spots |
| `track.js` | `Track`: centerline sampled every 1.5 m — heading, curvature, banking, vertical curvature (jumps), projection, spatial hash |
| `terrain.js` | base height (lake bed, islands, causeways, hills) + cut/fill along the track; bridges are left unfilled so water runs under them |
| `trackMesh.js` | road (asphalt / stone on 白堤 and bridges), kerbs, stone parapets, wooden guardrails on 三台山, arch bridges, start gate, boost pads |
| `scenery.js` | landmarks (保俶塔, 雷峰塔, 六和塔, 三潭印月, 湖心亭, 岳王庙, 于谦祠, 孤山, 苏堤 and its bridges, music fountain), 平海路 flagships and street (per-metre canvas textures for stone lattice, blue glass, patterned wall, herringbone paving; see-through glass), city, trees with near/far LOD (willows are a parasol crown with ~120 thin swaying strands), contour-following tea rows, bamboo, lotus, boats |
| `car.js` | car model and the player's handling (see below) |
| `ai.js` | five AI drivers: corner speed from curvature ahead, racing line, overtaking, visual drifts, occasional nitro |
| `effects.js`, `audio.js` | drift smoke, flame puffs and skid marks; an original pentatonic 江南-style background loop (plucked lead with echo, pad, bass, light percussion) mixed above the synthesized engine, tyres and wind (WebAudio, no files) |
| `main.js` | wiring: build, race states, camera, HUD (analog speedometer 0–280 km/h with the 180+ boost zone in red, three nitro bottles under the car that fill as you drift, burn-time bar), minimap, captions, adaptive quality |

Handling: the car's facing `h` and its direction of travel `m` are separate. Braking and cornering follow real cars
(`car.js` `TUNE`), acceleration stays arcade:

- Acceleration: 0→100 km/h in 1.9 s (Xiaomi SU7 Ultra: 1.98 s), 0→100 in 0.9 s on nitro; top speed 180 km/h, 260 with
  any boost (nitro, 小喷, boost pad, start boost).
- Braking 12.5 m/s² (SU7 Ultra: 100→0 in 30.8 m): 100→0 in 30.8 m / 2.25 s, 180→0 in 99.8 m / 4.0 s. Lifting off
  coasts at 1.0 + 0.03·v m/s² (≈ 2.5 m/s² at 180).
- Grip cornering is capped at 1.0 g (`latGrip` 9.8 m/s², Porsche Panamera Turbo S E-Hybrid class): yaw rate ≤ latGrip / v,
  so the tightest grip turn is ~255 m at 180 km/h and ~80 m at 100. Steering past the limit understeers: the car will not
  turn tighter, scrubs 1.2 m/s² and the tyres squeal. Braking and turning share the grip (friction ellipse, steering
  first): at full lock the brakes give ~40 % — brake in a straight line before the corner.
- Walls are not a way round corners: a scrape costs speed in proportion to how hard the wall had to push the car
  (`wallFriction` 2 × the removed normal speed, plus 14 m/s² while touching).
- Drift (Shift + direction) is how you take tight corners faster: the direction of travel may turn at up to `driftLat`
  13 m/s² (≈ 1.33 g), while the slide's own drag plus any braking never exceeds ~13 m/s² (a drift is not a better brake).
  On the bench (`pilot.js` drivers, best of a parameter grid each, eight corners with a straight approach) a good drift is
  0.3–1.1 s and on average 0.6 s faster than the best brake-and-grip line; in a race with corners chained together the
  measured gain is ~0.3 s per tight corner. On straights drifting only loses speed. The gauge fills only on a real
  drift (slip > ~6°, held > 0.25 s); three nitros can be stored. A tap is a small flick; the slide after release
  scales with how long the drift was held. Releasing a clean drift opens a 0.5 s window for 小喷 (↑); nitro right after
  it is 双喷.
- Nitro (Space / Ctrl) fires whenever one is stored, stacks up to 5 s, and snaps the direction of travel to the nose —
  drift round, point the nose at the exit, fire. At 260 km/h 1.0 g only allows ~530 m radius, so nitro is for straights
  and corner exits.
- Crests launch the car when v²·(−κ) > g; a landing opens a 落地喷 window.

Racing line (`line.js`): a curvature-minimising line inside the road (fourth-difference smoothing, ±8.4 m), with a speed
profile (`speedProfile`: corner speed √(a/κ), braking distance backwards). The AI follows it with cornering 8.4 m/s² ×
skill and braking 9.5 m/s² — below the player's, because the AI never misses its line; with these numbers a clean
grip-only player (the `pilot.js` driver, laps of ~128 s) finishes mid-pack, and drifting the tight corners is what wins.
`?auto` uses the same `pilot.js` driver. Yellow chevron boards (`cornerSigns` in `trackMesh.js`) stand on the outside
of every corner slower than 150 km/h: 1–3 arrows by severity and the grip speed rounded down to 10 km/h.

## Leaderboard (个人最佳 + 总榜)

Scores live in the community project (Alibaba Cloud Supabase), schema in `sql/race/001_race_scores.sql`
(run once in its SQL editor, then `sql/race/001_race_scores.test.sql` to self-check; it rolls back). `002_reset_for_real_physics.sql` cleared the board when braking and grip went realistic and accepts only `version = '2'` from then on; the local best moved to `race.best.v2`. The browser
talks to PostgREST directly with the public publishable key, which `race.astro` hands to the game by postMessage
(`race:config`); opened outside the site, the game keeps only the local best.

- `race_scores`: one row per finished two-lap race — nickname, per-lap times, total, best lap. Browser roles may
  insert and read, never update or delete. That image forbids SECURITY DEFINER, so everything is plain RLS plus
  column grants.
- Identity without login: the browser keeps a random key in localStorage and sends it only with an insert; a trigger
  stores its sha256 as `player_id` and drops the key, so nobody can post under someone else's id.
  The game requires the site's signed-in state before submitting. Guests can still read the board and save local
  bests; the board and result card show “登录后才能提交个人成绩” with a login link returning to `/race`.
  The parent sends only a boolean via same-origin `race:auth`; no session token is sent to the game.
- Checks (stop casual tampering, not a determined forger — the game runs in the browser): each lap 60 s–10 min,
  total = sum of laps (±1.5 s), best lap = the fastest lap, one submission per player per 100 s, nickname 1–12 chars.
- `race_leaderboard` (security-invoker view): each player's best run, ranked by total time, earliest first on ties.
  The title screen shows 个人最佳 (local, then the server's best and rank); after a race the result card asks for a
  nickname once, then uploads automatically; 排行榜 shows the top 50 and your own best.
- Only real runs upload: not with `?auto`, a non-default `?laps`, or the test hooks.

## Checking it

### 高级模式（只在当前页面调参）

- 普通 `/race` 保留原有界面和操控数值；`/race?advanced=1`（也支持 `?advanced`）显示高级调参面板。
  独立游戏入口 `/race/app.html?advanced=1` 同样可用，外层静态页会将高级模式和参数转交给 iframe。
- 面板覆盖动力/刹车、转向/抓地、漂移/集气、氮气/双喷、小喷/落地喷、加速带/起步、腾空/碰撞、跟车镜头和 AI。
  滑杆拖动实时生效，数值框输入后按 Enter 或离开输入框生效，速度以 km/h 显示；`latGrip` 仅影响自动驾驶车手。
  点赛道继续驾驶，可收起面板；“重新试跑”重置比赛并保留本页刚调的参数。
- 参数只存在本页 JS 内存，不写 localStorage、不自动改 URL、不发请求保存，也不写数据库。
  刷新页面重新按入口链接初始化（普通高级链接回到默认值，复制的参数链接恢复其中明确指定的初始值）。
  每项有复位按钮，也可以“恢复默认”。高级试跑不写本机个人最佳，也不上传总榜。
- “复制参数”复制当前完整 JSON，方便记录和交流；“复制参数链接”复制 `/race?advanced=1&t.turn=...`，
  打开即可复现这份设置。只有显式开启高级模式时才接受 `t.*`，未知字段、空值和非有限数会被忽略，超出范围会限幅。
- 参数定义和默认值统一在 `js/tuning.js`，交互面板在 `js/advanced.js` / `advanced.css`。
  默认值保持当前公开版本不变；调参时会使 AI/自动驾驶缓存的限速剖面失效，下一帧按新参数重算。

### 原有检查入口

- `?debug` shows fps, draw calls and triangles; `?auto` drives the player's car; `?skipcount` skips the countdown;
  `?quality=high` pins quality (no automatic downgrade); `?laps=1..5`; `?cam=x,y,z,lx,ly,lz` pins the camera.
- Drift economy check: on a 2 km straight, drifting left and right all the way (taking every 小喷 and nitro it earns)
  is much slower than just holding the throttle (48.2 s vs 40.0 s), so drifting pays only where you would slow down anyway.
- Full simulated race (2 laps, 60 Hz, grip-only `pilot.js` driver): laps of ~129 s and ~128 s, 3rd of 6; the AI spread
  over ~9 s. Scene: ~500–1050 draw calls and 0.9–2.4 M triangles per frame across all passes
  (the most on 平海路 looking down the street at the lake).


### 画质切换

- 右侧声音按钮附近的「画质：标准 / 流畅」可随时切换，无需刷新或重开比赛；选择保存在当前浏览器。存储被禁用时仍能切换。
- 标准模式保留原有视觉和自动降级；流畅模式立即关闭实时阴影、描边、4x MSAA 和纸纹，将像素比限制为 1 且渲染像素不超过约 130 万，更早切换树木远景模型，并减少烟雾实例和发射量。文字 HUD 保持原有清晰度。
- 切回标准会恢复画质并重新采样帧率；车辆操控、AI、碰撞、计时和排行榜规则不变。
- 独立游戏测试入口支持 `?quality=low` / `?quality=standard`；原有 `?quality=high` 仍固定标准画质并禁用自动降级。URL 覆盖本机偏好但不会自行保存，点击按钮才保存。
