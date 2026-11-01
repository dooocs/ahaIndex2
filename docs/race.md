# 西湖飞车 (/race): structure

`src/pages/race.astro` frames a self-contained page, `public/race/app.html`, in a full-window iframe,
the same way 梦想人生 does. The page is plain ES modules served as static files; it shares three.js r170
with 梦想人生 (`public/dream/vendor/three-r170/`) through the same import map, so there is no bundler
and the daily deploy ships whatever changed.

## Route

About 4.2 km; v3 handling benchmarks are listed below. The start/finish is on 平海路 by 龙翔桥 metro station: the street runs west straight
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

## Handling: 更易上手的街机赛车，保留操作上限

- 动力：不喷气最高 180 km/h，喷气最高 260 km/h；直线刹车仍为 12.5 m/s²。
- 普通抓地：横向加速度 22 m/s²，方向盘更灵敏，直角弯仍要松油或刹车。
- 漂移：Shift 按住才能漂移，反打可收角；松开 Shift 当帧退出漂移并让车头和运动方向一致，0.4 s 以上的完整漂移开启 0.5 s 小喷窗口。
- 成本与收益：漂移能转得比普通抓地更紧，但会持续损失速度；高手要把握走线、松键与氮气时机。
- 撞墙：去除法向运动，沿墙速度保留；首次斜擦有小额惩罚。持续压墙超过 0.3 s 后，额外摩擦在 0.4 s 内渐增至 18 m/s²；离墙后衰减，避免长时间借护栏转弯。护栏回正按时间计算，不依赖帧率。
- AI：过弯横向加速度 17.5 m/s²、减速度 10.6 m/s²，维持竞争性。
- 排行榜：新版物理属于 v3，执行 `sql/race/003_arcade_handling_v3.sql` **后**才能部署。旧 v2 数据保留为历史，仅 v3 计入当前排名，本机个人最佳使用 `race.best.v3`。

Racing line (`line.js`): a curvature-minimising line inside the road (fourth-difference smoothing, ±8.4 m), with a
`speedProfile` derived from corner speed √(a/κ) and braking distance backwards. AI cornering uses 17.5 m/s² × skill,
with 10.6 m/s² braking, below the player's limits because the AI never misses its line. `?auto` uses `pilot.js`.
Yellow chevron boards (`cornerSigns` in `trackMesh.js`) now use `TUNE.latGrip`: corners slower than 150 km/h get
1–3 arrows and the suggested speed rounded down to 10 km/h.

## Leaderboard (个人最佳 + 总榜)

Scores live in the community project (Alibaba Cloud Supabase), schema in `sql/race/001_race_scores.sql`
(run once in its SQL editor, then `sql/race/001_race_scores.test.sql` to self-check; it rolls back). Run
`sql/race/003_arcade_handling_v3.sql` before deploying arcade physics: previous v2 scores remain as
history, and only v3 scores appear on the live leaderboard. The local best uses `race.best.v3`. The browser
talks to PostgREST directly with the public publishable key, which `race.astro` hands to the game by postMessage
(`race:config`); opened outside the site, the game keeps only the local best.

- `race_scores`: one row per finished two-lap race — nickname, per-lap times, total, best lap. Browser roles may
  insert and read, never update or delete. That image forbids SECURITY DEFINER, so everything is plain RLS plus
  column grants.
- Identity without login: the browser keeps a random key in localStorage and sends it only with an insert; a trigger
  stores its sha256 as `player_id` and drops the key, so nobody can post under someone else's id.
- Checks (stop casual tampering, not a determined forger — the game runs in the browser): each lap 60 s–10 min,
  total = sum of laps (±1.5 s), best lap = the fastest lap, one submission per player per 100 s, nickname 1–12 chars.
- `race_leaderboard` (security-invoker view): each player's best run, ranked by total time, earliest first on ties.
  The title screen shows 个人最佳 (local, then the server's best and rank); after a race the result card asks for a
  nickname once, then uploads automatically; 排行榜 shows the top 50 and your own best.
- Only real runs upload: not with `?auto`, a non-default `?laps`, or the test hooks.

部署前先执行 `003_arcade_handling_v3.sql`，然后执行 `003_arcade_handling_v3.test.sql` 自检（自动回滚）。
迁移可重复执行，不删除旧记录；过渡期间旧页面仍能提交 v2，但只保存在历史中。新版本部署前应完成迁移，避免 v3 上传被旧约束拒绝。

## Checking it

- `?debug` shows fps, draw calls and triangles; `?auto` drives the player's car; `?skipcount` skips the countdown;
  `?quality=high` pins quality (no automatic downgrade); `?laps=1..5`; `?cam=x,y,z,lx,ly,lz` pins the camera.
- `node --test tests/race-handling.test.mjs tests/race-board.test.mjs tests/race-simulation.test.mjs` runs 18 checks against the production modules: release/countersteer, short-tap versus full-drift rewards, 小喷/双喷 windows, both walls at 30/60/120 Hz, sustained wall pressure, v3 identity/storage/upload, actual-track laps and AI completion.
- The deterministic 60 Hz benchmark uses the actual ~4.2 km geometry, banking, jumps, racing line and four boost pads, with no rendering or car-to-car pushing. Two laps: conservative grip-only ~197 s; full throttle with frequent wall contacts ~177 s; a tuned drift/boost strategy ~169 s (`f: 1.5, g: 0.9, vInMul: 1.5, pre: 30, driftBelow: 40, thr: -0.2`). Five AI drivers finish in ~204–214 s. These are regression baselines, not human victory-rate measurements; old v2 benchmarks do not apply.
- Browser hand-feel still needs desktop keyboard and phone touch checks, especially 三台山 hairpins, 断桥 landings, drift release with the direction key still held, and short scrapes versus prolonged wall contact. The local verification environment could not connect its remote browser to the preview, so no manual-play result is claimed.
