// Kinematic character controller on a sphere: collide-and-slide against a WalkField.
//
// Input is an intent in the avatar's own frame (turn / forward / strafe, all in radians of arc);
// output is the new pose. It is a pure function of (field, pose, intent): no input devices, no
// planet rotation, no rendering. The app turns its own state into a pose, calls move(), and
// turns the result back (for this app: the planet's quaternion).
//
// Pose: { p, f }  p = unit position on the sphere, f = unit heading tangent at p.
//
// Guarantees, whatever the obstacles look like:
//   - a move never ends with less room than it started with when it started blocked (so it can't lock up);
//   - a move against an obstacle keeps the part of it that runs along the obstacle (sliding);
//   - moves are split into short sub-steps, so thin railings can't be tunnelled through at low fps
//     or on a long mouse drag;
//   - when the avatar starts inside an obstacle (an autopilot stop, a float edge), any input pushes it out.

import { dot, cross, scale, addScaled, tangent, normalize, length, geodesic, stepTo, transport, orthoHeading, turn as turnHeading } from './vec.js';

/**
 * @param {ReturnType<import('./field.js').createWalkField>} field
 * @param {object} [o]
 * @param {number} [o.maxStep]   longest sub-step, units (must stay well under the thinnest barrier's band)
 * @param {number} [o.maxSubsteps]
 * @param {number} [o.pushOut]   how far one depenetration nudge moves, units
 * @param {number} [o.slides]    how many obstacle normals one sub-step may slide along (2 = corners)
 */
export function createController(field, { maxStep = 0.08, maxSubsteps = 96, pushOut = 0.05, slides = 2 } = {}) {
  const R = field.radius;

  const ok = (c, c0) => c >= 0 || (c0 < 0 && c > c0 + 1e-6);
  const accept = (p, f, step, c) => ({ p: step.p, f: orthoHeading(step.p, transport(f, step)), c, step });

  function trySub(p, f, v, c0) {
    // v: tangent at p, radians. Returns an accepted { p, f, c, step } or { blockedAt, c }.
    const step = geodesic(p, v);
    const c = field.clearance(step.p);
    return ok(c, c0) ? accept(p, f, step, c) : { blockedAt: step.p, c };
  }

  // Slide by projection: carry the blocked target back out along the obstacle's normal by its depth
  // (a Newton step on clearance). Against a flat wall that is exactly "keep the part along the wall";
  // it also rounds convex corners, where projecting the velocity would leave nothing to keep.
  function projectOut(p, f, v, q, c, c0) {
    for (let i = 0; i < 3; i++) {
      const g = field.gradient(q);
      if (!g) return null;
      q = geodesic(q, scale(g.n, (-c / g.mag + 1e-3) / R)).p;
      c = field.clearance(q);
      if (ok(c, c0)) {
        const step = stepTo(p, q);
        // never accept a "slide" that goes backwards or further than asked (a bad normal near a step edge)
        if (!step.dir || dot(step.dir, v) <= 0 || step.ang > length(v) * 1.5) return null;
        return accept(p, f, step, c);
      }
    }
    return null;
  }

  /** One short sub-step with sliding. Returns the new pose and whether anything got in the way. */
  function subStep(p, f, v) {
    const c0 = field.clearance(p);
    let r = trySub(p, f, v, c0);
    if (r.p) return { ...r, blocked: false };

    const proj = projectOut(p, f, v, r.blockedAt, r.c, c0);
    if (proj) return { ...proj, blocked: true };

    // concave corners and other awkward spots: project the velocity instead, one obstacle at a time
    let vs = v;
    for (let i = 0; i < slides && r.blockedAt; i++) {
      const n = field.normal(r.blockedAt) || field.normal(p);
      if (!n) break;
      const np = normalize(tangent(p, n));           // the obstacle's outward normal, carried to p
      const into = dot(vs, np);
      if (into >= 0) break;                          // not pushing into this one: nothing to slide off
      vs = addScaled(vs, np, -into);                 // drop the part that pushes in, keep the rest
      if (Math.hypot(vs.x, vs.y, vs.z) < 1e-9) break;
      r = trySub(p, f, vs, c0);
      if (r.p) return { ...r, blocked: true };
    }

    if (c0 < 0) {                                    // stuck inside: nudge out, whatever was asked
      const n = field.normal(p);
      if (n) {
        const out = trySub(p, f, scale(n, pushOut / R), c0);
        if (out.p) return { ...out, blocked: true };
      }
    }
    return { p, f, c: c0, blocked: true, stopped: true };
  }

  /**
   * @param {{p, f}} pose
   * @param {{turn?: number, forward?: number, strafe?: number}} intent  radians; turn > 0 is to the right
   * @returns {{p, f, advanced: number, blocked: boolean}}  advanced: arc actually covered along the heading
   */
  function move(pose, { turn = 0, forward = 0, strafe = 0 } = {}) {
    let p = normalize(pose.p);
    let f = turnHeading(p, orthoHeading(p, pose.f), turn);
    const dist = Math.hypot(forward, strafe) * R;
    if (dist < 1e-9) return { p, f, advanced: 0, blocked: false };

    // a huge single move (a wild drag) is shortened rather than taken in long, tunnelling steps
    const n = Math.min(maxSubsteps, Math.ceil(dist / maxStep));
    const k = Math.min(1, (n * maxStep) / dist) / n;
    const a = forward * k, b = strafe * k;
    let advanced = 0, blocked = false;
    for (let i = 0; i < n; i++) {
      const v = addScaled(scale(f, a), cross(f, p), b);   // re-expressed in the current frame every sub-step
      const r = subStep(p, f, v);
      if (r.step) advanced += dot(r.step.dir ? scale(r.step.dir, r.step.ang) : { x: 0, y: 0, z: 0 }, f);
      p = r.p; f = r.f; blocked ||= r.blocked;
      if (r.stopped) break;
    }
    return { p, f, advanced, blocked };
  }

  return { move };
}
