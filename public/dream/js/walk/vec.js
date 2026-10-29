// Minimal 3-vector math on plain { x, y, z } objects.
// Reads work on THREE.Vector3 too (same fields), so callers can pass either; results are plain objects.
// Everything here is on the unit sphere: positions are unit vectors, moves are tangent vectors in radians.

export const vec = (x, y, z) => ({ x, y, z });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const scale = (a, s) => vec(a.x * s, a.y * s, a.z * s);
export const addScaled = (a, b, s) => vec(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
export const length = a => Math.hypot(a.x, a.y, a.z);
export function normalize(a) {
  const l = length(a);
  return l > 1e-12 ? scale(a, 1 / l) : vec(0, 0, 0);
}

/** The part of `a` lying in the tangent plane at unit vector `p`. */
export const tangent = (p, a) => addScaled(a, p, -dot(a, p));

/** Any unit tangent at `p` (used to build a local basis). */
export function anyTangent(p) {
  const helper = Math.abs(p.y) < 0.9 ? vec(0, 1, 0) : vec(1, 0, 0);
  return normalize(cross(helper, p));
}

/**
 * Walk along the great circle from `p` in tangent direction `v` (|v| = angle in radians).
 * Returns the new position and the rotation's moved basis direction, so a heading can be parallel-transported.
 */
export function geodesic(p, v) {
  const ang = length(v);
  if (ang < 1e-12) return { p: vec(p.x, p.y, p.z), dir: null, ang: 0 };
  const dir = scale(v, 1 / ang);
  const c = Math.cos(ang), s = Math.sin(ang);
  return {
    p: normalize(addScaled(scale(p, c), dir, s)),
    dir,
    dirAfter: addScaled(scale(dir, c), p, -s),   // where `dir` points once we have arrived
    ang,
  };
}

/** The geodesic step that takes unit vector `p` to unit vector `q` (same shape as `geodesic`'s result). */
export function stepTo(p, q) {
  const d = tangent(p, q), l = length(d);
  if (l < 1e-12) return geodesic(p, vec(0, 0, 0));
  return geodesic(p, scale(d, Math.atan2(l, dot(p, q)) / l));
}

/** Parallel-transport tangent `f` along a geodesic step returned by `geodesic`. */
export function transport(f, step) {
  if (!step.dir) return f;
  const along = dot(f, step.dir);
  return addScaled(addScaled(f, step.dir, -along), step.dirAfter, along);
}

/** Re-orthonormalise heading `f` against position `p` (kills float drift). */
export const orthoHeading = (p, f) => normalize(tangent(p, f));

/** Rotate tangent `f` about `p` by `ang`; positive turns toward `right = f × p`. */
export function turn(p, f, ang) {
  if (!ang) return f;
  const right = cross(f, p);
  return normalize(addScaled(scale(f, Math.cos(ang)), right, Math.sin(ang)));
}
