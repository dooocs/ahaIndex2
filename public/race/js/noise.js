// JS 端噪声与小工具（地形高度、摆放）。与 toon 着色器里的 vn/fbm 同一个哈希。
export const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

function h2(x, y) {
  let px = (x * 0.3183099 + 0.1) % 1, py = (y * 0.3183099 + 0.1) % 1;
  if (px < 0) px += 1; if (py < 0) py += 1;
  px *= 17; py *= 17;
  const v = px * py * (px + py);
  return v - Math.floor(v);
}
export function vnoise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export const fbm2 = (x, y) => 0.55 * vnoise2(x, y) + 0.3 * vnoise2(x * 2.13 + 3.1, y * 2.13 + 3.1) + 0.15 * vnoise2(x * 4.37 + 7.7, y * 4.37 + 7.7);

export function makeRand(seed = 7) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// 把构建切成小段，每 ~40 ms 让出一次主线程，加载时页面和进度条保持响应
const yieldNow = () => new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
let sliceT = 0;
export async function slice() { if (performance.now() - sliceT > 40) { await yieldNow(); sliceT = performance.now(); } }
