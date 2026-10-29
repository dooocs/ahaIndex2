// Click-to-walk route finding on a WalkField: A* over a small grid laid on the tangent plane between
// start and goal, then string-pulled into a few waypoints. Pure, like the rest of js/walk.
//
// The grid only spans the two points plus a margin, and cells are tested lazily, so a typical click
// touches a few hundred cells. A goal inside a building snaps to the nearest standable cell. The route
// is advice: the controller still does collide-and-slide while following it.

import { dot, cross, normalize, addScaled, scale, tangent, length } from './vec.js';

/**
 * @param {ReturnType<import('./field.js').createWalkField>} field
 * @param {{x,y,z}} from  unit direction
 * @param {{x,y,z}} to    unit direction
 * @returns {Array<{x,y,z}> | null}  waypoints after `from`, ending at (or next to) `to`; null if unreachable
 */
export function findPath(field, from, to, { cell = 0.3, margin = 5, maxSpan = 80, maxVisit = 40000 } = {}) {
  const R = field.radius;
  const m = normalize(addScaled(from, to, 1));
  let e1 = tangent(m, addScaled(to, from, -1));
  e1 = length(e1) < 1e-9 ? normalize(tangent(m, { x: 1, y: 0, z: 0 })) : normalize(e1);
  const e2 = cross(m, e1);
  // gnomonic plane at m, in planet units
  const toUV = d => { const k = R / dot(d, m); return [dot(d, e1) * k, dot(d, e2) * k]; };
  const toDir = (u, v) => normalize(addScaled(addScaled(scale(m, R), e1, u), e2, v));

  const [su, sv] = toUV(from), [gu, gv] = toUV(to);
  if (Math.hypot(gu - su, gv - sv) > maxSpan) return null;
  const u0 = Math.min(su, gu) - margin, v0 = Math.min(sv, gv) - margin;
  const W = Math.ceil((Math.abs(gu - su) + 2 * margin) / cell) + 1, H = Math.ceil((Math.abs(gv - sv) + 2 * margin) / cell) + 1;
  const cu = i => u0 + (i % W) * cell, cv = i => v0 + Math.floor(i / W) * cell;
  const at = (u, v) => Math.max(0, Math.min(H - 1, Math.round((v - v0) / cell))) * W + Math.max(0, Math.min(W - 1, Math.round((u - u0) / cell)));

  const free = new Int8Array(W * H);              // 0 unknown, 1 free, -1 blocked
  const ok = i => (free[i] ||= field.clearance(toDir(cu(i), cv(i))) >= 0 ? 1 : -1) > 0;

  const start = at(su, sv);
  let goal = at(gu, gv);
  if (!ok(goal)) {                                  // clicked a building, the water, …: nearest standable cell within 4 units
    let best = -1, bd = Infinity;
    const r = Math.ceil(4 / cell), gi = goal % W, gj = Math.floor(goal / W), si = start % W, sj = Math.floor(start / W);
    for (let j = Math.max(0, gj - r); j <= Math.min(H - 1, gj + r); j++)
      for (let i = Math.max(0, gi - r); i <= Math.min(W - 1, gi + r); i++) {
        const near = Math.hypot(i - gi, j - gj);
        const d = near + 0.1 * Math.hypot(i - si, j - sj);        // near the click, leaning to the side we come from
        if (near <= r && d < bd && ok(j * W + i)) { bd = d; best = j * W + i; }
      }
    if (best < 0) return null;
    goal = best;
  }

  // A*, 8-connected, no corner cutting
  const g = new Float32Array(W * H).fill(Infinity), came = new Int32Array(W * H).fill(-1), closed = new Uint8Array(W * H);
  const h = i => { const dx = Math.abs(i % W - goal % W), dy = Math.abs(Math.floor(i / W) - Math.floor(goal / W)); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
  const heap = [];
  const push = (i, f) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let s = k; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === k) break; [heap[s], heap[k]] = [heap[k], heap[s]]; k = s; } } return top[1]; };
  g[start] = 0; free[start] = 1; push(start, h(start));
  let visits = 0, found = false;
  while (heap.length && visits++ < maxVisit) {
    const c = pop();
    if (closed[c]) continue;
    if (c === goal) { found = true; break; }
    closed[c] = 1;
    const ci = c % W, cj = Math.floor(c / W);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const n = j * W + i;
      if (closed[n] || !ok(n)) continue;
      if (di && dj && (!ok(cj * W + i) || !ok(j * W + ci))) continue;
      const ng = g[c] + (di && dj ? 1.4142 : 1);
      if (ng < g[n]) { g[n] = ng; came[n] = c; push(n, ng + h(n)); }
    }
  }
  if (!found) return null;

  const cells = [];
  for (let c = goal; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  // string-pull: keep a waypoint only where the straight line from the last kept one stops being clear
  const clearLine = (a, b) => {
    const [au, av] = [cu(a), cv(a)], [bu, bv] = [cu(b), cv(b)], n = Math.ceil(Math.hypot(bu - au, bv - av) / (cell * 0.5));
    for (let k = 1; k < n; k++) if (field.clearance(toDir(au + (bu - au) * k / n, av + (bv - av) * k / n)) < 0) return false;
    return true;
  };
  const keep = [];
  let anchor = cells[0];
  for (let k = 1; k < cells.length; k++) {
    if (!clearLine(anchor, cells[k])) { anchor = cells[k - 1]; keep.push(anchor); }
  }
  keep.push(goal);
  const out = keep.map(c => toDir(cu(c), cv(c)));
  if (goal === at(gu, gv)) out[out.length - 1] = normalize(to);   // end exactly where clicked when it is standable
  return out;
}
