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
