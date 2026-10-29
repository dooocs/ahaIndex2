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

## Done: a planet twice the size at the same cost (杭州, R 50 → 100)

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
