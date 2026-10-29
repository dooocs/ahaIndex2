// 2D shapes in a site's local plane (x across, z away from the ring road; units ≈ 1.5 m).
// Each shape answers two questions and nothing else:
//   sdf(x, z)        exact signed distance: < 0 inside, > 0 outside (drives collide-and-slide)
//   within(x, z, m)  inside the shape grown by m with square corners (the old footprint test,
//                    kept bit-for-bit so vegetation scatter is unchanged)
// They know nothing about spheres, planets or three.js.

const clamp01 = v => Math.max(0, Math.min(1, v));

/** Axis-aligned rectangle [x0, x1] × [z0, z1]. */
export function box(x0, x1, z0, z1) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  return {
    kind: 'box',
    sdf(x, z) {
      const dx = Math.abs(x - cx) - hx, dz = Math.abs(z - cz) - hz;
      return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
    },
    within: (x, z, m = 0) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m,
  };
}

/** Disc of radius r. */
export function circle(cx, cz, r) {
  return {
    kind: 'circle',
    sdf: (x, z) => Math.hypot(x - cx, z - cz) - r,
    within: (x, z, m = 0) => Math.hypot(x - cx, z - cz) < r + m,
  };
}

/** A thick open polyline (a railing, a wall): points [[x, z], …], half-thickness hw. */
export function polyline(points, hw) {
  const segDist = (x, z, [ax, az], [bx, bz]) => {
    const abx = bx - ax, abz = bz - az;
    const t = clamp01(((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz || 1));
    return Math.hypot(x - ax - abx * t, z - az - abz * t);
  };
  const sdf = (x, z) => {
    let d = Infinity;
    for (let i = 0; i < points.length - 1; i++) d = Math.min(d, segDist(x, z, points[i], points[i + 1]));
    return d - hw;
  };
  return { kind: 'polyline', sdf, within: (x, z, m = 0) => sdf(x, z) < m };
}
