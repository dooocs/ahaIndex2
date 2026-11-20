// Yunqi's paths are laid out in the home site's tangent plane. The renderer,
// collision tests, and resident patrols all consume these same coordinates.
export const HOME_FENCE = { x0: -55, x1: 55, z0: -53, z1: 1.5 };
export const HOME_PAVILIONS = [[-23, -28], [20, -32]];
export const CENTRAL_LAWN = { x: 0, z: -25.4, rx: 11.5, rz: 8.5 };
export const TRACK_HALF_WIDTH = 1.05;

const near = (a, b, d) => {
  const t = Math.min(0.34, d / Math.hypot(b[0] - a[0], b[1] - a[1]));
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
};

// Smooth each bend with a quadratic arc but keep the first point as the
// common start/finish, on a straight section facing the water court.
const route = [
  [0, -12], [16, -12], [27, -10], [34, -15], [35, -22], [34, -31],
  [39, -41], [33, -47], [18, -45.5], [2, -47.6], [-15, -46], [-29, -47.5],
  [-42, -42], [-41, -34], [-37, -26], [-40, -17], [-32, -10], [-17, -12],
];
export const RUN_LOOP = [[...route[0]]];
for (let i = 1; i < route.length; i++) {
  const p = route[i], a = near(p, route[i - 1], 2.6), b = near(p, route[(i + 1) % route.length], 2.6);
  for (let j = 0; j <= 7; j++) {
    const t = j / 7, u = 1 - t;
    RUN_LOOP.push([u * u * a[0] + 2 * u * t * p[0] + t * t * b[0], u * u * a[1] + 2 * u * t * p[1] + t * t * b[1]]);
  }
}
RUN_LOOP.push([...RUN_LOOP[0]]);

export const HOME_LOOP = [
  [-3.05, -5.5], [-8, -8.5], [-12, -12], [-15, -17], [-16, -27], [-18.3, -32],
  [-15, -37], [0, -38], [13, -38], [17, -36.5], [24.5, -34.2], [25, -28],
  [17, -24], [16, -18], [12, -14], [9, -9], [3.05, -5.5], [2.2, -3.3],
  [0, -2.45], [-2.2, -3.3], [-3.05, -5.5],
];

export const POOL_WALK = Array.from({ length: 33 }, (_, i) => {
  const a = i / 32 * Math.PI * 2;
  return [Math.sin(a) * 3.05, -5.5 + Math.cos(a) * 3.05];
});

export const PARK_SHORTCUTS = [
  [[0, -8.55], [0, -12], [0, -15.5]],
  [[-16, -27], [-20, -24.8], [-28, -24.6], [-38, -21], [-46, -20.5]],
  [[25, -28], [34, -28.8], [44, -30]],
  [[16, -18], [25, -15], [38, -12.5], [47, -12.5]],
  [[-29, -47.5], [-22, -40.5], [-15, -37]],
  [[2, -47.6], [0, -38], [0, -34.3]],
  [[33, -47], [26, -41], [24.5, -34.2]],
  [[-18.3, -32], [-19.8, -30], [-19.5, -26], [-23, -26], [-23, -27.25]],
  [[24.5, -34.2], [23, -29.4], [20, -29.4], [20, -30.2]],
  [[-15, -17], [-8, -15.5], [0, -15.5], [8, -15.5], [16, -18]],
];

export const GROVES = [
  // They reveal the lawn gradually from the entrance and leave open views inside it.
  [[-25, -5], [-31, -5.2], [-36, -6.2], [-9.5, -4.8], [-5.5, -9.2], [5.5, -9.2], [10, -5.2], [21, -4.1], [27, -4.5], [34, -4.9], [41, -5.5]],
  [[-46, -10], [-46, -15], [-47, -34], [-48, -39], [-48, -44], [-43, -48], [-36, -50], [-24, -49], [-10, -50.5], [0, -50.6], [7, -50.4], [23, -50.1], [39, -50], [43, -47], [48, -44]],
  [[-34, -18], [-32, -22], [-28, -28.7], [-28, -33], [-26, -38], [-21, -35], [-17, -32.5], [-11, -42.0], [-6, -42.4], [6, -42.8], [14, -42], [19, -40], [26.4, -37], [29, -31], [27, -25.5], [29, -20], [24, -18.6]],
  [[44.5, -8], [51, -12], [51, -22], [47, -24], [49, -28], [41, -38], [45, -42], [-9.5, -14.2], [10.5, -14.0]],
];

export const FLOWER_BEDS = [
  [-5.6, -6.4, 2.1, 1.0], [5.6, -6.4, 2.1, 1.0], [-16.5, -8.3, 1.9, 0.85], [17.5, -7.0, 1.9, 0.9],
  [-12, -18.5, 1.4, 0.8], [12.5, -19.3, 1.4, 0.85], [-24, -23, 2.8, 1.1], [24, -24, 2.7, 0.95],
  [-24, -34.2, 1.8, 0.85], [19.5, -35.6, 1.35, 0.9], [-10.0, -40.5, 2.45, 1.0], [10, -40.5, 2.4, 1.0],
  [-31, -36, 2.35, 1.25], [31, -35, 2.05, 1.05], [-24, -41.5, 1.8, 0.85], [21, -44, 1.8, 0.85],
];

// Distances and markup share one continuous centerline. The site is projected
// onto the sphere at R=200; distances use its arc length and 1 unit ≈ 1.5 m.
const lengths = [0], metres = [0];
const HOME_PLANET_RADIUS = 200, METRES_PER_UNIT = 1.5;
for (let i = 1; i < RUN_LOOP.length; i++) {
  const a = RUN_LOOP[i - 1], b = RUN_LOOP[i];
  lengths.push(lengths.at(-1) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  const r = HOME_PLANET_RADIUS;
  const cross = Math.hypot(r * (a[1] - b[1]), a[1] * b[0] - a[0] * b[1], r * (b[0] - a[0]));
  const dot = r * r + a[0] * b[0] + a[1] * b[1];
  metres.push(metres.at(-1) + Math.atan2(cross, dot) * r * METRES_PER_UNIT);
}
export const RUN_LENGTH = lengths.at(-1);
export const RUN_METRES = Math.round(metres.at(-1) / 5) * 5;

export function trackAt(distance) {
  const d = ((distance % RUN_LENGTH) + RUN_LENGTH) % RUN_LENGTH;
  let lo = 0, hi = RUN_LOOP.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid] > d) hi = mid; else lo = mid;
  }
  const a = RUN_LOOP[lo], b = RUN_LOOP[hi], len = lengths[hi] - lengths[lo], t = (d - lengths[lo]) / len;
  const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx, dz };
}

export const TRACK_MARKS = Array.from({ length: Math.ceil(metres.at(-1) / 75) }, (_, i) => {
  const distance = i * 75, j = metres.findIndex(m => m > distance) - 1;
  const f = (distance - metres[j]) / (metres[j + 1] - metres[j]);
  const { x, z, dx, dz } = trackAt(lengths[j] + f * (lengths[j + 1] - lengths[j]));
  return { distance, x: x - 2.0 * dz + (i ? 0 : 2.6 * dx), z: z + 2.0 * dx + (i ? 0 : 2.6 * dz), dx, dz };
});

export function distanceToPath(x, z, path) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz));
  }
  return best;
}

export const TRACK_LIGHTS = Array.from({ length: Math.floor(RUN_LENGTH / 8) }, (_, i) => {
  const { x, z, dx, dz } = trackAt((i + 0.48) * RUN_LENGTH / Math.floor(RUN_LENGTH / 8));
  return [x + 1.85 * dz, z - 1.85 * dx];
}).filter(([x, z]) => [HOME_LOOP, ...PARK_SHORTCUTS].every(path => distanceToPath(x, z, path) > 1.15));
