// 地形：基础高度（湖、岛、堤、山）+ 沿赛道削填，网格按区块切开以便视锥剔除。
// 网格间距不均匀：赛道一带 4 米，向外逐渐放大到 40 米，一张网格、没有接缝。
import * as THREE from 'three';
import { toon } from './toon.js';
import * as LY from './layout.js';
import { fbm2, smoothstep, clamp01 } from './noise.js';

export const WATER = -1.0;

// ---------- 多边形有符号距离（内部为负） ----------
function polySD(x, z, pts) {
  let d = Infinity, inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, az] = pts[j], [bx, bz] = pts[i];
    const ex = bx - ax, ez = bz - az, wx = x - ax, wz = z - az;
    const t = clamp01((wx * ex + wz * ez) / (ex * ex + ez * ez));
    const dx = wx - ex * t, dz = wz - ez * t;
    d = Math.min(d, dx * dx + dz * dz);
    if ((az > z) !== (bz > z) && x < ax + (bx - ax) * (z - az) / (bz - az)) inside = !inside;
  }
  return inside ? -Math.sqrt(d) : Math.sqrt(d);
}
function polylineD(x, z, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const ex = bx - ax, ez = bz - az, t = clamp01(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez));
    d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return d;
}
const WATERS = [LY.LAKE, LY.LOTUS_POND, ...LY.WETLANDS, ...LY.CHANNELS];

// 水深：岸线外为 0，向内 12 米降到湖底（窄水道中间也够深）
function waterDepth(x, z) {
  let sd = Infinity;
  for (const w of WATERS) sd = Math.min(sd, polySD(x, z, w));
  const qd = polylineD(x, z, LY.QIANTANG) - 130;
  sd = Math.min(sd, qd);
  return sd < 0 ? smoothstep(0, 12, -sd) : 0;
}

function hillsH(x, z) {
  let h = 0;
  for (const hl of LY.HILLS) {
    const dx = (x - hl.c[0]) / hl.rx, dz = (z - hl.c[1]) / hl.rz, r2 = dx * dx + dz * dz;
    if (r2 > 2.6) continue;
    const ridge = 0.75 + 0.5 * fbm2(x * 0.006 + hl.c[0], z * 0.006 + hl.c[1]);
    h = Math.max(h, hl.h * Math.exp(-r2 * 1.25) * ridge);
  }
  return h;
}

// 不含赛道的基础地形
export function baseHeight(x, z) {
  let h = 0.5 + (fbm2(x * 0.01, z * 0.01) - 0.5) * 1.2;
  h += hillsH(x, z);
  const wd = waterDepth(x, z);
  if (wd > 0) h = h * (1 - wd) + (WATER - 3.2) * wd;
  // 湖中陆地
  const g = LY.GUSHAN, gd = ((x - g.c[0]) / g.rx) ** 2 + ((z - g.c[1]) / g.rz) ** 2;
  if (gd < 1.6) h = Math.max(h, WATER + 0.3 + (g.h + 1.2) * Math.exp(-gd * 1.6) - 0.2 * gd);
  // 苏堤：一条景观堤，六座桥的位置断开让水过
  const sd = polylineD(x, z, LY.SUDI);
  if (sd < 18) {
    let gap = Infinity;
    for (const [gx, gz] of LY.SUDI_GAPS) gap = Math.min(gap, Math.hypot(x - gx, z - gz));
    const keep = smoothstep(8, 13, gap);
    h = Math.max(h, (0.55 - smoothstep(7, 16, sd) * 4.8) * keep + h * (1 - keep));
  }
  for (const s of LY.ISLANDS) {
    const d = Math.hypot(x - s.c[0], z - s.c[1]);
    if (d < s.r + 12) h = Math.max(h, s.h - smoothstep(s.r - 6, s.r + 12, d) * 5);
  }
  // 城市：压平
  const c = LY.CITY;
  if (x > c.x0 - 40) h = h * (1 - smoothstep(c.x0 - 40, c.x0 + 30, x) * 0.85);
  return h;
}

// ---------- 赛道削填 ----------
// 每个地形点找最近的赛道采样：路面以内贴路，外面按约 1:1.6 的坡放坡回原地形；桥下不填（让水过）。
export function makeHeightFn(track) {
  const hw = track.halfW;
  // 先标出赛道 90 米内的粗格子，远处的点不用逐个查最近采样
  const C = 30, near = new Set();
  for (let i = 0; i < track.N; i += 4) {
    const cx = Math.floor(track.px[i] / C), cz = Math.floor(track.pz[i] / C);
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) near.add((cx + a) * 100003 + (cz + b));
  }
  return (x, z, base = baseHeight(x, z)) => {
    if (!near.has(Math.floor(x / C) * 100003 + Math.floor(z / C))) return { h: base, near: Infinity, i: -1 };
    let best = Infinity, bi = -1;
    track.forEachNear(x, z, hw + 70, (i, d2) => { if (d2 < best) { best = d2; bi = i; } });
    if (bi < 0) return { h: base, near: Infinity, i: -1 };
    const dist = Math.sqrt(best);
    const lat = (x - track.px[bi]) * track.rx[bi] + (z - track.pz[bi]) * track.rz[bi];
    const ty = track.py[bi] + clamp01(Math.abs(lat) / hw) * Math.sign(lat) * hw * Math.sin(track.bank[bi]) - 0.45;
    if (track.bridge[bi]) return { h: base, near: dist, i: bi };
    const flat = hw + 7;
    const fall = 6 + Math.abs(base - ty) * 1.6;
    const w = 1 - smoothstep(flat, flat + fall, dist);
    return { h: base + (ty - base) * w, near: dist, i: bi };
  };
}

// ---------- 网格 ----------
function axis(lo, hi, c0, c1, fine, coarse) {
  const out = [];
  let v = lo;
  while (v < hi) {
    out.push(v);
    const away = v < c0 ? c0 - v : v > c1 ? v - c1 : 0;
    v += Math.min(coarse, fine + away * 0.06);
  }
  out.push(hi);
  return out;
}

export async function buildTerrain(track, scene, slice) {
  const heightAt = makeHeightFn(track);
  // 桥：水面以上、底下原本是水的采样点
  for (let i = 0; i < track.N; i++) track.bridge[i] = track.py[i] > 1.3 && baseHeight(track.px[i], track.pz[i]) < WATER + 0.2 ? 1 : 0;
  // 桥两端各留几米，免得填方压到拱脚
  { const b = track.bridge.slice(); for (let i = 0; i < track.N; i++) if (b[i]) for (let k = -3; k <= 3; k++) track.bridge[(i + k + track.N) % track.N] = 1; }

  const xs = axis(-1300, 1700, -470, 560, 4, 44), zs = axis(-1300, 1700, -720, 880, 4, 44);
  const nx = xs.length, nz = zs.length;
  const H = new Float32Array(nx * nz), PATH = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    if ((j & 15) === 0) await slice();
    for (let i = 0; i < nx; i++) {
      const x = xs[i], z = zs[j], r = heightAt(x, z);
      H[j * nx + i] = r.h;
      // 平地赛段两侧铺一条石板人行道（山路两边是草和茶园）
      if (r.i >= 0 && track.py[r.i] < 5 && !track.bridge[r.i]) PATH[j * nx + i] = 1 - smoothstep(track.halfW + 3, track.halfW + 6, r.near);
    }
  }
  const hAt = (i, j) => H[clamp(j, 0, nz - 1) * nx + clamp(i, 0, nx - 1)];
  const nrm = (i, j, out) => {
    const dx = xs[Math.min(i + 1, nx - 1)] - xs[Math.max(i - 1, 0)], dz = zs[Math.min(j + 1, nz - 1)] - zs[Math.max(j - 1, 0)];
    out.set(-(hAt(i + 1, j) - hAt(i - 1, j)) / dx, 1, -(hAt(i, j + 1) - hAt(i, j - 1)) / dz).normalize();
    return out;
  };

  const groundMat = toon(0x8cc46a, { kind: 'GROUND', shade: 0x4f8a6c, breakMul: 0.5, path: true });
  const waterMat = toon(0x6bbcbf, { kind: 'WATER', shade: 0x3f86a0, breakMul: 0.25, noiseScale: 0.6 });
  const CH = 72;   // 每个区块 72×72 格
  const n = new THREE.Vector3();
  for (let cj = 0; cj < nz - 1; cj += CH) {
    await slice();
    for (let ci = 0; ci < nx - 1; ci += CH) {
      const i1 = Math.min(ci + CH, nx - 1), j1 = Math.min(cj + CH, nz - 1), w = i1 - ci + 1, d = j1 - cj + 1;
      const pos = new Float32Array(w * d * 3), nor = new Float32Array(w * d * 3), pa = new Float32Array(w * d);
      let wet = false, dry = false;
      for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
        const k = j * w + i, gi = ci + i, gj = cj + j, h = hAt(gi, gj);
        pos[k * 3] = xs[gi]; pos[k * 3 + 1] = h; pos[k * 3 + 2] = zs[gj];
        nrm(gi, gj, n); nor[k * 3] = n.x; nor[k * 3 + 1] = n.y; nor[k * 3 + 2] = n.z;
        pa[k] = PATH[gj * nx + gi];
        if (h < WATER + 0.05) wet = true; else dry = true;
      }
      const idx = [];
      for (let j = 0; j < d - 1; j++) for (let i = 0; i < w - 1; i++) {
        const a = j * w + i, b = a + 1, c = a + w, e = c + 1;
        idx.push(a, c, b, b, c, e);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('aPath', new THREE.BufferAttribute(pa, 1));
      g.setIndex(idx);
      g.computeBoundingSphere();
      g.boundingSphere.radius += 60;   // 远处会被着色器压低，包围球放宽一点
      const m = new THREE.Mesh(g, groundMat);
      m.receiveShadow = true; m.castShadow = false;
      m.matrixAutoUpdate = false;
      scene.add(m);
      if (wet) {
        // 水面：同一块区域的平面（隔一点取一个顶点，远处弯曲时要有足够的顶点）
        const st = 2, ww = Math.floor((w - 1) / st) + 1, dd = Math.floor((d - 1) / st) + 1;
        const wp = new Float32Array(ww * dd * 3), wi = [];
        for (let j = 0; j < dd; j++) for (let i = 0; i < ww; i++) {
          const gi = Math.min(ci + i * st, i1), gj = Math.min(cj + j * st, j1), k = (j * ww + i) * 3;
          wp[k] = xs[gi]; wp[k + 1] = WATER; wp[k + 2] = zs[gj];
        }
        for (let j = 0; j < dd - 1; j++) for (let i = 0; i < ww - 1; i++) { const a = j * ww + i, b = a + 1, c = a + ww, e = c + 1; wi.push(a, c, b, b, c, e); }
        const wg = new THREE.BufferGeometry();
        wg.setAttribute('position', new THREE.BufferAttribute(wp, 3));
        const wn = new Float32Array(ww * dd * 3); for (let k = 1; k < wn.length; k += 3) wn[k] = 1;
        wg.setAttribute('normal', new THREE.BufferAttribute(wn, 3));
        wg.setIndex(wi);
        wg.computeBoundingSphere(); wg.boundingSphere.radius += 60;
        const wm = new THREE.Mesh(wg, waterMat);
        wm.receiveShadow = true; wm.castShadow = false; wm.matrixAutoUpdate = false;
        scene.add(wm);
      }
      if (!dry && !wet) continue;
    }
  }
  // 供摆放物件查询：双线性插值
  const fi = (arr, v) => { let lo = 0, hi = arr.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m; else hi = m; } return lo + clamp01((v - arr[lo]) / (arr[lo + 1] - arr[lo])); };
  const groundAt = (x, z) => {
    const u = fi(xs, x), v = fi(zs, z), i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j;
    return (hAt(i, j) * (1 - a) + hAt(i + 1, j) * a) * (1 - b) + (hAt(i, j + 1) * (1 - a) + hAt(i + 1, j + 1) * a) * b;
  };
  return { groundAt, isWater: (x, z) => groundAt(x, z) < WATER - 0.1 };
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
