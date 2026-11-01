# 西湖飞车 (/race): structure

`src/pages/race.astro` frames a self-contained page, `public/race/app.html`, in a full-window iframe,
the same way 梦想人生 does. The page is plain ES modules served as static files; it shares three.js r170
with 梦想人生 (`public/dream/vendor/three-r170/`) through the same import map, so there is no bundler
and the daily deploy ships whatever changed.

## Route

About 4.2 km and 90–95 s a lap. The start/finish is on 平海路 by 龙翔桥 metro station: the street runs west straight
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

Handling: the car's facing `h` and its direction of travel `m` are separate. With grip `m` catches up fast;
in a drift (Shift + direction) it lags. Top speed is 180 km/h without boost and 260 km/h with any boost (nitro, 小喷,
boost pad, start boost); nitro pushes at about 1.7× normal thrust (and keeps full thrust right up to 260) plus a
+11 km/h kick when it fires. From standstill: 0→100 km/h in 1.9 s and 0→180 in 5.1 s without nitro; 0→100 in 0.9 s,
0→180 in 1.7 s and 0→260 in 2.9 s on nitro (100→180 takes 3.2 s without, 0.7 s with).
Space (or Ctrl) fires nitro whenever one is stored, including while one is already burning (the time adds up, to at
most 5 s). The moment it fires it ends any drift and snaps the travel direction to where the nose points — drift
round, point the nose at the exit, fire. While it burns the tyres grip fully when not drifting (no slide, steering
at 72 %), and you can start a new drift; the nitro's thrust (cut to 30 % like any throttle in a drift) still pushes,
so a drift under nitro sheds less speed (260 → ~200 km/h over 1 s, against 180 → ~120 km/h without). Drifting costs speed: drag of 4.5 + 12·sin(slip) + 0.3·v·sin(slip) m/s² with throttle cut to 30 %, so the faster
you enter and the longer you hold it, the more you lose: a 1 s drift takes 80 → 50, 120 → 75, 180 → 120 km/h. The gauge only fills on a real drift (slip above
~6° and held longer than 0.25 s); three nitros can be stored, shown as three slots under the car. The slide after you let go
scales with how long you held the drift: a tap (≤0.12 s) is a small flick of ~10° that straightens at once, a 0.3 s
drift slides on 0.1 s, a 1 s drift about 0.5 s. Releasing a clean
drift opens a 0.5 s window for 小喷 (↑), a small top-up that never outruns not drifting; nitro right after it is 双喷.
Crests launch the car when v²·(−κ) > g — the northern 杨公堤 bridges at ~140 km/h, the short southern ones at
~105 km/h — and a landing opens a 落地喷 window.

## Checking it

- `?debug` shows fps, draw calls and triangles; `?auto` drives the player's car; `?skipcount` skips the countdown;
  `?quality=high` pins quality (no automatic downgrade); `?laps=1..5`; `?cam=x,y,z,lx,ly,lz` pins the camera.
- Drift economy check: on a 2 km straight, drifting left and right all the way (taking every 小喷 and nitro it earns)
  is much slower than just holding the throttle (48.2 s vs 40.0 s), so drifting pays only where you would slow down anyway.
- Full simulated race (2 laps, 60 Hz, a clean grip-driving autopilot): laps of 93 s and 91 s, finishing ~4 s ahead of
  the AI, which spread over 8 s. Scene: ~500–1050 draw calls and 0.9–2.4 M triangles per frame across all passes
  (the most on 平海路 looking down the street at the lake).
