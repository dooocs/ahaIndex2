// Pointer gestures → intents, with no DOM, camera or planet in sight (unit-tested in tests/dream-gestures.test.mjs).
//
// Each pointer gets a role the moment it goes down, and keeps it until it lifts:
//   mouse                     'look'   drag orbits the camera; a click is a tap
//   touch above the split     'look'   drag orbits; two 'look' fingers pinch to zoom
//   touch below the split     'stick'  a floating joystick centred where the finger landed
// A pointer that barely moved and lifted quickly is a tap (walk there / greet), whatever its role,
// unless it took part in a pinch. Roles never change mid-gesture, so a thumb on the stick and a finger
// turning the view work together, and a stick dragged up the screen stays a stick.
//
// Intents go to the handlers: look(dx, dy) in pixels, zoom(factor) for a pinch (< 1 = closer),
// tap(x, y), stick(state) with state = null (released) or { ox, oy, kx, ky, x, y, amount }:
// origin, knob offset (clamped to the ring), unit direction (x right, y forward = up the screen)
// and 0..1 push past the dead zone.

export function createGestures({
  splitY = () => Infinity,      // y of the line between the look and stick halves (touch only)
  slop = 8, tapMs = 300,        // a tap moves less than slop px and lifts within tapMs
  radius = 56, dead = 0.14,     // stick ring radius (px) and dead zone (share of the radius)
  maxStep = 80,                 // a single move event can't contribute more than this (px)
  look = () => {}, zoom = () => {}, tap = () => {}, stick = () => {},
} = {}) {
  const ptrs = new Map();       // id → { role, x, y, x0, y0, t0, pinched }
  let pinch = null;             // { a, b, d }: the two look pointers and their last distance
  let stickId = null;

  const clampStep = v => Math.max(-maxStep, Math.min(maxStep, v));
  const lookers = () => [...ptrs.entries()].filter(([, p]) => p.role === 'look');
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) || 1;

  function stickState(p) {
    const vx = p.x - p.x0, vy = p.y - p.y0, len = Math.hypot(vx, vy);
    const k = len > radius ? radius / len : 1;
    const push = Math.min(1, len / radius);
    const amount = push <= dead ? 0 : (push - dead) / (1 - dead);
    return { ox: p.x0, oy: p.y0, kx: vx * k, ky: vy * k, x: len ? vx / len : 0, y: len ? -vy / len : 0, amount };
  }

  return {
    /** e: { id, x, y, t, mouse } */
    down(e) {
      if (ptrs.size >= 2 || ptrs.has(e.id)) return;
      const role = e.mouse || e.y < splitY() ? 'look' : (stickId === null ? 'stick' : 'look');
      ptrs.set(e.id, { role, x: e.x, y: e.y, x0: e.x, y0: e.y, t0: e.t, pinched: false });
      if (role === 'stick') { stickId = e.id; stick(stickState(ptrs.get(e.id))); }
      const ls = lookers();
      if (ls.length === 2) {
        ls.forEach(([, p]) => { p.pinched = true; });
        pinch = { a: ls[0][0], b: ls[1][0], d: dist(ls[0][1], ls[1][1]) };
      }
    },
    move(e) {
      const p = ptrs.get(e.id);
      if (!p) return;
      const dx = clampStep(e.x - p.x), dy = clampStep(e.y - p.y);
      p.x = e.x; p.y = e.y;
      if (p.role === 'stick') { stick(stickState(p)); return; }
      if (p.pinched) {
        if (pinch && ptrs.has(pinch.a) && ptrs.has(pinch.b)) {
          const d = dist(ptrs.get(pinch.a), ptrs.get(pinch.b));
          zoom(pinch.d / d);                    // fingers apart → < 1 → closer
          pinch.d = d;
        }
        return;
      }
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > slop || p.moved) { p.moved = true; look(dx, dy); }
    },
    up(e, cancelled = false) {
      const p = ptrs.get(e.id);
      if (!p) return;
      ptrs.delete(e.id);
      if (p.role === 'stick') { stickId = null; stick(null); }
      if (pinch && (e.id === pinch.a || e.id === pinch.b)) pinch = null;
      const still = Math.hypot(e.x - p.x0, e.y - p.y0) <= slop && !p.moved;
      if (!cancelled && !p.pinched && still && e.t - p.t0 <= tapMs) tap(e.x, e.y);
    },
    /** drop everything (window blur, page hidden) */
    reset() { if (stickId !== null) stick(null); ptrs.clear(); pinch = null; stickId = null; },
    get active() { return ptrs.size; },
  };
}
