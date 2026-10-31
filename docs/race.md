# 杭州飞车 (/race): structure

`src/pages/race.astro` frames a self-contained page, `public/race/app.html`, in a full-window iframe,
the same way 梦想人生 does. The page is plain ES modules served as static files; it shares three.js r170
with 梦想人生 (`public/dream/vendor/three-r170/`) through the same import map, so there is no bundler
and the daily deploy ships whatever changed.

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
| `layout.js` | the map in metres (x east, z south): centerline control points, lake, islands, hills, landmark spots |
| `track.js` | `Track`: centerline sampled every 1.5 m — heading, curvature, banking, vertical curvature (jumps), projection, spatial hash |
| `terrain.js` | base height (lake bed, islands, causeways, hills) + cut/fill along the track; bridges are left unfilled so water runs under them |
| `trackMesh.js` | road (asphalt / stone on 苏堤 and bridges), kerbs, stone parapets, wooden guardrails in the hills, arch bridges, start gate, boost pads |
| `scenery.js` | landmarks (保俶塔, 雷峰塔, 六和塔, 三潭印月, 湖心亭, 岳王庙, 孤山, 龙井村), city, trees with near/far LOD, contour-following tea rows, bamboo, lotus, boats |
| `car.js` | car model and the player's handling (see below) |
| `ai.js` | five AI drivers: corner speed from curvature ahead, racing line, overtaking, visual drifts, occasional nitro |
| `effects.js`, `audio.js` | drift smoke and skid marks; synthesized engine, tyres, wind and boosts (WebAudio, no files) |
| `main.js` | wiring: build, race states, camera, HUD, minimap, captions, adaptive quality |

Handling: the car's facing `h` and its direction of travel `m` are separate. With grip `m` catches up fast;
in a drift (Shift + direction) it lags, and the slip angle `h − m` fills the gauge. A full gauge is a nitro
(Ctrl or Space). Releasing a clean drift opens a 0.5 s window for 小喷 (↑); nitro right after 小喷 is 双喷.
Crests launch the car when v²·(−κ) > g — every 苏堤 bridge does at ~140 km/h — and a landing opens a 落地喷 window.

## Checking it

- `?debug` shows fps, draw calls and triangles; `?auto` drives the player's car; `?skipcount` skips the countdown;
  `?quality=high` pins quality (no automatic downgrade); `?laps=1..5`.
- Measured on a full simulated race (2 laps, 60 Hz): lap ≈ 70 s, six jumps a lap, AI finishing 2–11 s behind a
  clean nitro-free lap. Scene: ~300–680 draw calls and 0.8–1.9 M triangles per frame across all passes.
