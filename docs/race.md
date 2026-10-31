# 杭州飞车 (/race): structure

`src/pages/race.astro` frames a self-contained page, `public/race/app.html`, in a full-window iframe,
the same way 梦想人生 does. The page is plain ES modules served as static files; it shares three.js r170
with 梦想人生 (`public/dream/vendor/three-r170/`) through the same import map, so there is no bundler
and the daily deploy ships whatever changed.

## Route

Counter-clockwise round the lake, about 3.7 km and 85 s a lap: 湖滨 (start/finish opposite the music fountain)
→ 钱塘门 → 北山街 → 断桥 → 白堤 (锦带桥) → 平湖秋月 → 孤山路 (S-bends) → 西泠桥 → 曲院风荷 → 杨公堤
(环璧、流金、卧龙) → 三台山 zigzag past 于谦祠 (three hairpins) → 杨公堤 (隐秀、景行、浚源) → 花港观鱼 →
苏堤南口 → 太子湾 S-bends → 净慈寺 → 雷峰塔 → 长桥 → 南山路 (柳浪闻莺、钱王祠) → 湖滨. 苏堤 stays in the lake
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
| `scenery.js` | landmarks (保俶塔, 雷峰塔, 六和塔, 三潭印月, 湖心亭, 岳王庙, 于谦祠, 孤山, 苏堤 and its bridges, music fountain), city, trees with near/far LOD, contour-following tea rows, bamboo, lotus, boats |
| `car.js` | car model and the player's handling (see below) |
| `ai.js` | five AI drivers: corner speed from curvature ahead, racing line, overtaking, visual drifts, occasional nitro |
| `effects.js`, `audio.js` | drift smoke and skid marks; synthesized engine, tyres, wind and boosts (WebAudio, no files) |
| `main.js` | wiring: build, race states, camera, HUD, minimap, captions, adaptive quality |

Handling: the car's facing `h` and its direction of travel `m` are separate. With grip `m` catches up fast;
in a drift (Shift + direction) it lags, and the slip angle `h − m` fills the gauge. A full gauge is a nitro
(Ctrl or Space). Releasing a clean drift opens a 0.5 s window for 小喷 (↑); nitro right after 小喷 is 双喷.
Crests launch the car when v²·(−κ) > g — the northern 杨公堤 bridges at ~140 km/h, the short southern ones at ~105 km/h — and a landing opens a 落地喷 window.

## Checking it

- `?debug` shows fps, draw calls and triangles; `?auto` drives the player's car; `?skipcount` skips the countdown;
  `?quality=high` pins quality (no automatic downgrade); `?laps=1..5`.
- Measured on a full simulated race (2 laps, 60 Hz, a drifting autopilot): lap ≈ 85 s, ~35 drifts and ~9 jumps a lap,
  the autopilot winning by ~3 s with the AI spread over 7 s. Scene: ~300–880 draw calls and 0.7–2.0 M triangles per
  frame across all passes.
