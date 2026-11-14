// Deterministic local residents. No presence transport or online-user accounting.
// The same paths are painted on the ground and used for their walks.
export const HOME_LOOP = [
  [-31, -5], [-28, -9], [-8, -11], [8, -11], [28, -9], [31, -5],
  [23, -3.3], [8, -3.3], [3.5, -2.4], [-3.5, -2.4], [-8, -3.3], [-23, -3.3], [-31, -5],
];
export const POOL_WALK = Array.from({ length: 33 }, (_, i) => {
  const a = i / 32 * Math.PI * 2;
  return [Math.sin(a) * 3.05, -5.5 + Math.cos(a) * 3.05];
});

/** A closed path sampled by distance, with optional time to rest at its start.
 * The position depends on time alone: pausing a tab never accumulates drift.
 */
export function createPatrol(points, { speed = 0.7, rest = 0, offset = 0 } = {}) {
  if (!(speed > 0) || rest < 0 || !Number.isFinite(speed + rest + offset)) throw new Error('Invalid patrol timing');
  if (points.length < 2 || points.some(p => p.length !== 2 || !p.every(Number.isFinite))) throw new Error('Invalid patrol path');
  const pts = points.map(p => [...p]);
  if (Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) > 1e-6) pts.push([...pts[0]]);
  const segments = [];
  let length = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > 1e-6) { segments.push({ a, b, start: length, len }); length += len; }
  }
  if (!length) throw new Error('Patrol path has no length');
  const duration = length / speed + rest;
  const pointAt = distance => {
    const d = ((distance % length) + length) % length;
    const s = segments.find(s => d < s.start + s.len) || segments.at(-1);
    const f = (d - s.start) / s.len;
    return [s.a[0] + (s.b[0] - s.a[0]) * f, s.a[1] + (s.b[1] - s.a[1]) * f];
  };
  return {
    length, duration,
    at(t) {
      const time = (((Number.isFinite(t) ? t : 0) + offset) % duration + duration) % duration;
      const moving = time >= rest, distance = Math.max(0, time - rest) * speed;
      const p = pointAt(distance), ahead = pointAt(distance + 0.35);
      const norm = Math.hypot(ahead[0] - p[0], ahead[1] - p[1]) || 1;
      return { x: p[0], z: p[1], dx: (ahead[0] - p[0]) / norm, dz: (ahead[1] - p[1]) / norm, moving, distance };
    },
  };
}
