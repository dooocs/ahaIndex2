# 梦想人生 (/dream): structure and roadmap

`src/pages/dream.astro` frames a self-contained page, `public/dream/app.html`, in a full-window iframe.
The page is plain ES modules served as static files (three.js r170 under `public/dream/vendor/`, an
import map, no bundler), so anything under `public/dream/` ships as-is: a daily deploy uploads whatever
changed by MD5, like any other file in `dist/`.

## Goal

Every concern lives in one place and talks to the others through a small interface, so that a new
planet, a new way to move or a new render effect is a change in one module, not a hunt through one
2,400-line script. The direction of dependencies is fixed:

```
            ┌──────────── app.html (wiring only) ────────────┐
            │                                                 │
   input ──►│ intent      walk (pose, collide-and-slide)      │──► render (planet, post, HUD)
            │               ▲                                 │
            │      planets ─┘ declare footprints, decks, …    │
            └─────────────────────────────────────────────────┘
```

- `walk` knows nothing about three.js, input devices, the camera or any particular planet.
- A planet declares what it contains; it does not reach into global state or into other planets.
- Rendering reads the world and the avatar's pose; it never decides where the avatar may go.
- `app.html` only connects these, so it is the only file that knows they all exist.

## Done: walking (`public/dream/js/walk/`)

Free walking used to undo any step that ended in water, a building or across the railing. Nothing slid
along a wall, a step that started blocked was always refused (the avatar locked up after an autopilot
stop inside a footprint), and the railing was a special-case side test.

| module | owns | depends on |
| --- | --- | --- |
| `vec.js` | unit-sphere math on plain `{x, y, z}` (geodesic steps, parallel transport) | nothing |
| `shapes.js` | 2D shapes in a site's plane: `box`, `circle`, `polyline`, each an exact signed distance (`sdf`) plus the old square-cornered `within` test | nothing |
| `field.js` | `createWalkField`: one per planet. Footprints, barriers, decks, terrain, water → `surfaceH`, `clearance` (signed room for the body), `gradient`, `inFootprint` | `vec`, `shapes` |
| `controller.js` | `createController(field).move(pose, { turn, forward, strafe })`: collide-and-slide | `vec`, a field |

The controller's guarantees (each covered by `tests/dream-walk.test.mjs`):

- a step into an obstacle keeps the part along it (a Newton step out along the clearance gradient,
  which also rounds convex corners), falling back to velocity projection in concave corners;
- a step that starts inside an obstacle is accepted whenever it gains room, and otherwise nudges out,
  so the avatar can never lock up;
- moves are cut into sub-steps of at most 0.08 units and an over-long move is shortened, so a railing
  can't be tunnelled through at low frame rates or on a long mouse drag.

In `app.html` a planet builder calls `beginWalk()` and declares its obstacles with `walk.footprint`,
`walk.barrier` and `walk.deck`. The courtyard railing is one polyline, `HOME_RAIL`, used both to draw
it and to walk against it. The planet's rotation stays the source of truth for the avatar's place
(the autopilot drives it directly); `walkBy()` reads it as a pose, calls the controller and writes it
back.

## Done: a planet twice the size at the same cost (杭州, R 50 → 100; now R = 200, see 西湖 below)

Measured before changing anything (headless Chromium, CPU build time; triangle and draw-call counts are
hardware-independent): at R = 50 the five places together cost 0.13 s of a 1.4 s build. The rest was the
uniform ground icosphere (1.0 s) and vegetation spread evenly over the whole sphere. Doubling R naively
gave a 2.2–2.7 s build and 2.3M triangles a frame (4.5 s and 3.2M with the ground at today's density).

Every place sits within ~25 units of the ring road (the equator), so detail now follows that band:

- the ground is `ringSphere(step)`: latitude rings spaced 0.4 units inside the band, 1.6 near the poles,
  neighbouring rings zipped together (watertight, no T-junctions);
- vegetation keeps full density in the band and thins toward the poles (trees to 30 %, grass to 8 %);
  totals are scaled by the mean density so the band looks as it did;
- scatter spacing uses a hash grid instead of comparing every pair (same result, linear time);
- culling patches grow with R (6 × 4² at R = 100);
- walking, autopilot and label distances are per planet in units (`W.walkSpeed`, `W.travelSpeed`,
  `W.tagCos`), so a bigger planet doesn't make the avatar run faster. Planets that don't set them keep
  the old behaviour (the ski planet is unchanged).

| | R = 50 before | R = 100 now |
| --- | --- | --- |
| build | 1.37–1.58 s | 1.48–1.63 s |
| draw calls (home / lake / wide view) | 684 / 667 / 695 | 629 / 615 / 669 |
| triangles drawn (same views) | 1.32M / 1.38M / 1.42M | 1.26M / 1.32M / 1.46M |

Building places only when the avatar comes near is not worth it yet (they are 0.13 s); it becomes worth
it once there are many more places, and the planet-module split below is the groundwork for it.

## Done: who else is here (`public/dream/js/net/`)

A head count in the top-right corner and every other visitor on the same planet as a small person with
their province overhead. Visitors choose 男生 / 女生 (remembered per browser); both characters are
original designs built once and cloned per person (`avatarModel` / `makeAvatar` / `poseAvatar`).

| module | owns |
| --- | --- |
| `presence.js` | who is online and where: joins a channel keyed by a per-browser visitor id (so tabs count once), streams poses at most 5×/s while moving, puts the resting pose into presence when stopping, `activityOf` decides active / idle / away |
| `supabase.js` | the production transport: Supabase Realtime presence + broadcast on the community project (`vendor/realtime-js-2.103.0.min.js`, bundled from `@supabase/realtime-js` with `esbuild entry.js --bundle --format=esm --minify`) |
| `local.js` | the same channel over BroadcastChannel between tabs (`?presence=local`), with heartbeat and timeout like the server |
| `province.js` | IP → province via a keyless JSONP lookup (whois.pconline.com.cn) run inside a sandboxed, opaque-origin iframe; cached a day; 未知 when it fails |

Who counts as online:

- you join only after a real interaction (a key, a click or a drag), so crawlers never count;
- closing the tab leaves at once (`pagehide` → untrack, socket closed); a lost connection leaves when
  the server's heartbeat times out;
- idle (shown as "· 挂机", dashed label, counted apart) after 2 minutes without input or while the tab
  is hidden; after 5 minutes hidden you leave, and rejoin when the tab comes back.

`/dream` hands the scene the community project's public URL and publishable key (`dream:config`); without
them there is no company and the scene works as before.

## Done: looks and click-to-walk

- **Looks.** Every visitor rolls a look on the first visit — `{ g, h, hc, t, b, s }`: 男生/女生, one of four
  hairstyles each, hair colour, top, trousers/skirt and shoes from curated palettes — kept in this browser and
  sent with presence, so others see the same person. 换一套 rolls again. Bodies (per g) and hairstyles (per
  g × style) are built once; a person is a clone with materials swapped per colour slot, and `toon()` caches
  materials by colour, so a crowd shares a handful.
- **Click to walk.** A click on the ground plans a route with `js/walk/path.js` (A* on a small grid laid on the
  tangent plane between the two points, cells tested lazily against the WalkField, no corner cutting, then
  string-pulled) and the avatar follows it through the same controller as the keys. Clicking a building or
  the water walks to the nearest standable spot on the near side; an unreachable spot flashes the ring.
  Keys, a drag or a stop button take over at any time. Stops are still reached from their labels and buttons.

## Done: saying hello

Click someone (their person or their province tag) to open a small composer: one-click emoji and phrases,
or up to 60 characters of free text. They see a bubble over your head and a note they can reply to or mute
(muted people are remembered per browser). `presence.say(to, text)` / `onMessage` carry it: a broadcast on
the shared channel that only the addressee shows — a nudge, not a private message — from someone the
channel says is present, at most one every 1.2 s, cleaned (control and bidi characters out, whitespace
squeezed, capped without splitting emoji) and always rendered as text. A word filter is still to come.

Delivery takes two paths, deduped by message id: a broadcast (instant) and the sender's presence state,
which carries their last few messages for a minute. Broadcasts are sent with server acks; after two
failures poses also move to presence (about once a second). The Realtime client speaks protocol 1.0.0
(JSON frames): the client's default 2.0.0 sends broadcasts as binary frames, which the hosted Realtime
dropped while presence kept working — online counts were right but messages never arrived.
Try it locally with `?presence=local&broadcast=0`.

On phones the composer is a compact card near the top (clear of the keyboard) with a 44 px × on its corner;
the chips scroll in one row, the field uses 16 px text (iOS zooms the page into smaller fields), and a tap on
the scene puts the composer away instead of walking.

## Done: a view and a body (game-style controls)

The camera and the avatar are separate. The **body** is where the avatar stands and which way it faces;
walking, collisions, routes and presence use it. The **view** is which way the camera looks along the
ground, plus pitch and zoom; the planet's rotation is the view (p → +Y, view → −Z) and the model turns
by the angle between them. Moving is camera-relative: a direction on screen becomes a direction on the
ground, the body walks that way at walking speed and turns to face it, and the view is parallel-carried
along the same step. While you walk away from the camera (or follow a clicked route) the view drifts back
behind you, unless you turned it by hand in the last 2 s.

| | desktop | phone |
| --- | --- | --- |
| move | WASD / arrows, camera-relative | bottom third: a translucent stick appears where the thumb lands |
| look | drag with the mouse (yaw + pitch) | top two thirds: drag |
| zoom | wheel | pinch (two fingers in the top two thirds) |
| go there / say hello | click | tap anywhere |

`js/input/gestures.js` gives each pointer a role when it goes down (mouse → look; touch above the
split → look, below → stick) and keeps it until it lifts, so a thumb on the stick and a finger turning the
view work together and nothing can make the avatar jump. Footprints can carry a height (`{ h }`); the
camera walks back along the ground behind the avatar and, if something tall would hide it, comes forward
at the same height and aims nearer (`occluderHeight`, no mesh raycasts).

## Done: 西湖 at eight times the size on a planet of R = 200, with an overview

西湖 is traced from a north-up map of the real lake: `mp(px, py)` turns the map's pixels into the lake site's
plane (x north, z east, `LK_PX` = 8.5 pixels a unit, 1 unit ≈ 25 m), so the water is about 134 × 104 units —
eight times the first 16 × 13 pond. The ring road is 湖滨路 / 南山路 on the east shore (`roadZ` 62).
Geography scales with the map (outline, islands, ponds, hills); what people walk on and buildings keep a
human size; the pagodas are drawn 2.1× so they read across the water. (A 4× version on R = 100 came first
and was never shipped.)

- **Planet.** R 100 → 200. The other places keep their spacing in units (66, 117, 127 units apart); 西湖 is
  172 units past 西溪 so its hills stay clear of it, and the ~780 units from 西湖 round to home are free for
  new places. Ring-road arcs are cut into ≤ 60° pieces (an arc always takes the short way round). Culling
  patches stop at N = 6 (N = 8 at R = 200 added ~240 draw calls a view). Scatter attempts scale with the
  planet (`TRIES`); the loops stop as soon as the counts are reached.
- **Water** is one signed distance, `lakeSd`: the shore outline (外湖, 北里湖, 西里湖, 岳湖), the ponds west
  of 杨公堤 (茅家埠, 乌龟潭, 金沙港, 浴鹄湾) and 花港观鱼's fish pond, and the channels linking the ponds to
  西里湖. `lakeLand` adds what stands in the water: 苏堤 and 白堤 (~1.4 units wide, gaps at their bridges),
  孤山, 小瀛洲 (a ring with 田字 dikes), 湖心亭 and 阮公墩. `lakeHills` raises 宝石山, 夕照山, 南屏山, the 西山
  and the two peaks of 双峰插云 away from the water, never on the city side. `lakeReach` also fades out
  before `local()` stops answering (0.96 R from the site's centre), so the far corners don't step.
- **Bridges** are walk decks: 苏堤's six, 锦带桥, 断桥, 西泠桥 and one where each channel passes under 杨公堤.
  Every causeway and bridge is walkable end to end (checked with `dreamDebug.walkable`).
- **Places**: 雷峰塔 (雷峰夕照), 保俶塔, 三潭印月, 平湖秋月, 曲院风荷 (lotus), 花港观鱼 (koi), 柳浪闻莺 (a willow
  grove), 净慈寺 (南屏晚钟, with its bell tower), 钱王祠 behind its archway, stele pavilions for 苏堤春晓,
  断桥残雪 and 双峰插云, the music fountain off 湖滨 (61 jets over 14 units, animated in `updateFountain`) and
  a glass store across the road from it (no logo or brand marks). 21 landmark tags.
- **Ground**: `ringSphere(step, win)` keeps one patch (lon ± H, up to z1) at 0.55-unit spacing over the
  lake and its near hills; its rows exist only inside the patch and meet the ordinary rows along the patch's
  two edge meridians, each strip fanning in the other set's edge vertices, so the mesh stays watertight
  (checked: no non-manifold edges). Outside the band the spacing is 1.6, 2.4 from ~110 units out and 3.4
  near the poles. About 593k ground vertices (R = 100 had 262k).
- **Overview** (`W.overview`): while the avatar is anywhere round the lake a 俯瞰西湖 button shows. The camera
  rises (zoom 10, pitch 1.22), turns toward the lake's middle and aims 42 units out; drag still turns and
  tilts it (pitch 0.5–1.35), the wheel or a pinch zooms within it, labels reach further, and the clip planes
  and the ink-line fade follow the camera's distance. Walking (keys, stick, a click, a stop) brings it back
  down. The sun's shadow box widens over the lake; while the view holds still it is redrawn every sixth frame.
- **Costs** (headless test box, so absolute numbers are slow; compare ratios): build 3.5 → 4.8 s, of which
  the ground is ~2.1 s (more vertices on a bigger sphere). Main pass at 家 ~0.65–0.75M triangles (0.54M on
  the 4× version), at the lake 1.1–1.25M (0.78M), overview ~1.35M. Draw calls ~700 (overview ~1,500 in a
  frame that redraws shadows).

On a planet of R = 200 the camera at a stop sees ~56 units to the horizon, while the lake is ~104 units
across, so from the shore you see the near half and the far shore's hills and pagodas over the curve. The
overview is how you see all of it.

Next for cost, if needed: give `ringSphere` several windows (fine near places, coarser along the empty arcs
of the band), which would take ~150k ground vertices off the build.

`?debug` also exposes `window.dreamDebug`: `view(site, at, look, zoom, pitch)` to stand anywhere,
`overview(on)`, `settle()` (skip the easing), `stats()`, `budget()` (triangles on the planet by kind),
`drawn()` (triangles drawn in the current view by kind), `tags()` and `walkable(site, points)`.

## Done: paths through the woods, and trees that get out of the way

Around 西湖 the hill forest used to be planted without looking at the lanes, so near 雷峰塔 big trees stood on
and beside 南山路 and the avatar disappeared behind their crowns.

- **Clearings.** Every lake lane is recorded in `LAKE_LANES` when it is painted (`laneIn`); `laneD(p)` is the
  distance to the nearest one. Hill-forest trees keep their centres 3.6 units from a lane (about 2.5 units of
  open ground once the crowns overhang), meadow trees in the lake's area too; bushes and rocks 1.6. Clearings
  round 雷峰塔 (6), 保俶塔 (4), 双峰's pagodas and the stele pavilions (3.5) and 净慈寺. Along 北山街 and 南山路,
  where they run under the hills, low street trees stand every ~5 units on alternate sides, 2.7 units out.
- **See-through trees.** Trees (all `cut: true` toon materials: the three tree variants, willows, peaches)
  live on `TREE_LAYER` (2). In the vertex shader each tree works out from its crown's centre whether it is
  nearer the camera than the avatar and over it on screen (`CUT_VERT`), and fades as a whole with an ordered
  4×4 dither: gone right over the avatar, thinning toward a circle ~2.1 units round it. Per tree rather than
  per pixel, because a crown cut open per pixel showed its dark inside. The line pass draws layer 0 with
  `normalMat` and then the tree layer with `normalCutMat` (the same fade injected into MeshNormalMaterial), so
  a faded tree leaves no ink. Shadows are untouched. `updateCut()` sets the uniforms once a frame.

## Done: 湖滨, a city on 西湖's east side

After a map of the 湖滨 商圈, across 湖滨路 (here the ring road) from the lake: 平海路 meets the lake at the music
fountain, with the glass store and the in77 blocks either side of it; 东坡路 and 延安路 run parallel to 湖滨路
further east; 庆春路, 邮电路, 解放路, 开元路 and 清波街 cross them. 君悦 stands to the north, 东坡大剧院 and
杭州解百 behind in77, 中国美术学院 to the south, and 吴山 with 城隍阁 above the old houses of 河坊街. A row of
12–20-floor towers beyond 延安路 gives the skyline seen from the lake.

- Plots are data (`CITY_LOTS`: kind, x, z, w, d, floors, tone) in three rows between the streets; builders per
  kind (`cityMall`, `cityTower`, `cityHotel`, `cityDept`, `cityTheatre`, `cityCampus`, `buildJiangnan` with a site
  and no water steps, `cityPavilionTower` for 城隍阁). Buildings keep the planet's scale (a floor is 0.46 units),
  not the map's. No logos or lettering.
- Pavements round every plot come from a per-planet `stoneExtra(d)` hook in `stoneW` (one `local()` call and a
  bounding test per ground vertex), not from dozens of `STONE_RECTS`, each of which costs a `local()` per vertex.
- The lake's flat area (`lakeReach`) and its density area (`LAKE_AREA`) reach over the city; 吴山 is a bump in
  `lakeShape`. Meadow trees, bushes and rocks keep out of the city except on 吴山; plane trees line 东坡路 and
  延安路. Every building is a walk footprint with its height.
- Cost: build +~0.4 s on the test box; ~10k triangles of buildings, batched.

## Next

1. **Pose and motion modes.** Make the pose `{ p, f }` the single source of truth and derive the planet
   rotation and sky offsets from it in one `applyPose()`. Move the autopilot (`travelTo`, `legs`,
   `startLeg`) into `js/walk/autopilot.js` producing poses; free walking and autopilot then become two
   motion modes over the same pose, and the autopilot can check its own routes with the field.
2. **Input.** `js/input.js` turns keyboard, drag and touch into intents `{ turn, forward, strafe }` and
   nothing else. Mobile controls or a gamepad become a new input source, not a change to movement.
3. **Planets as modules.** `js/planets/hangzhou.js`, `js/planets/ski.js`, each exporting
   `build(ctx)` where `ctx` carries the kit, the walk field, the ground paint (roads, stone lanes), the
   scatter helpers and the HUD registry. The per-planet globals (`sites`, `zones`, `ROADS`, `STONES`,
   `terrainH`, `siteKeepout`, …) move into that context and disappear with it, so `loadWorld` stops
   resetting them by hand. A new planet is one file plus one line in the registry.
4. **Render and HUD.** `js/render/` for toon materials, batching, culling, the post passes and adaptive
   quality; `js/hud/` for stop buttons and labels. Both read the world and the pose.
5. **Planet invariants as tests.** Once planets are modules they can be built headless in node with a
   stub kit: every stop's standing spot and every point of its `via` route must have clearance ≥ 0,
   and every stop must be reachable from the ring road. That catches a new building placed on a path
   before anyone walks into it.

Optional feel work once 1–2 are in: turn the heading slowly toward the slide direction while sliding
(tank controls feel smoother along walls), and strafe on Q/E.
