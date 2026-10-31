// 赛道：一条闭合中心线，按固定步长采样成数组，车辆、AI、地形和摆放物件都按“沿路距离 + 横向偏移”来问。
// 朝向 h：前进方向 (sin h, cos h)，左转 h 增大；右向量 r = (−cos h, sin h)；横向偏移 lat 向右为正。
import * as THREE from 'three';

const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Track {
  constructor(points, width, step = 1.5) {
    this.width = width;
    this.halfW = width / 2;
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], p[2] || 0, p[1])), true, 'centripetal');
    curve.arcLengthDivisions = 8000;
    const N = Math.round(curve.getLength() / step);
    const pts = curve.getSpacedPoints(N);
    this.N = N;
    const F = () => new Float32Array(N);
    this.px = F(); this.py = F(); this.pz = F();
    for (let i = 0; i < N; i++) { this.px[i] = pts[i].x; this.py[i] = pts[i].y; this.pz[i] = pts[i].z; }
    let len = 0;
    for (let i = 0; i < N; i++) { const j = (i + 1) % N; len += Math.hypot(this.px[j] - this.px[i], this.pz[j] - this.pz[i]); }
    this.length = len;
    this.ds = len / N;

    this.hd = F(); this.tx = F(); this.tz = F(); this.rx = F(); this.rz = F();
    this.curv = F(); this.bank = F(); this.slope = F(); this.vcurv = F(); this.sslope = F();
    const at = (a, i) => a[(i % N + N) % N];
    for (let i = 0; i < N; i++) {
      const h = Math.atan2(at(this.px, i + 1) - at(this.px, i - 1), at(this.pz, i + 1) - at(this.pz, i - 1));
      this.hd[i] = h;
      this.tx[i] = Math.sin(h); this.tz[i] = Math.cos(h);
      this.rx[i] = -Math.cos(h); this.rz[i] = Math.sin(h);
      this.slope[i] = (at(this.py, i + 1) - at(this.py, i - 1)) / (2 * this.ds);
    }
    // 水平曲率（左转为正），平滑后用于 AI、路肩、倾角
    const raw = F();
    for (let i = 0; i < N; i++) raw[i] = wrap(at(this.hd, i + 1) - this.hd[i]) / this.ds;
    this.curv = smooth(raw, 6);
    // 弯道外侧抬高：左转（curv > 0）右侧更高，bank > 0
    const bk = F();
    for (let i = 0; i < N; i++) bk[i] = clamp(this.curv[i] * 4.5, -0.12, 0.12);
    this.bank = smooth(bk, 14);
    // 竖直曲率：越过坡顶时 v²·(−κ) > g 就腾空
    const sy = smooth(this.py, 2);
    const K = 3;
    for (let i = 0; i < N; i++) {
      const s0 = (sy[i] - at(sy, i - K)) / (K * this.ds), s1 = (at(sy, i + K) - sy[i]) / (K * this.ds);
      this.vcurv[i] = (s1 - s0) / (K * this.ds);
      this.sslope[i] = (at(sy, i + 1) - at(sy, i - 1)) / (2 * this.ds);
    }

    // 空间哈希：地形压平、物件避让、最近点查询
    this.cell = 20;
    this.grid = new Map();
    for (let i = 0; i < N; i++) {
      const k = this.key(Math.floor(this.px[i] / this.cell), Math.floor(this.pz[i] / this.cell));
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(i);
    }
    this.bridge = new Uint8Array(N);
    this.surface = new Uint8Array(N);   // 0 沥青，1 石板
  }

  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  forEachNear(x, z, r, fn) {
    const c = this.cell, R = Math.ceil(r / c), cx = Math.floor(x / c), cz = Math.floor(z / c), r2 = r * r;
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
      const arr = this.grid.get(this.key(cx + a, cz + b));
      if (!arr) continue;
      for (const i of arr) {
        const dx = this.px[i] - x, dz = this.pz[i] - z, d2 = dx * dx + dz * dz;
        if (d2 < r2) fn(i, d2);
      }
    }
  }
  nearest(x, z, r = 80) {
    let best = Infinity, bi = -1;
    this.forEachNear(x, z, r, (i, d2) => { if (d2 < best) { best = d2; bi = i; } });
    return bi < 0 ? null : { i: bi, dist: Math.sqrt(best) };
  }
  // 点到赛道中心线的水平距离（近似：最近采样点，误差 < 步长/2）
  distTo(x, z, r = 80) { const n = this.nearest(x, z, r); return n ? n.dist : Infinity; }
  dAt(x, z) { const n = this.nearest(x, z, 600); return n ? n.i * this.ds : 0; }

  wrapD(d) { const L = this.length; return ((d % L) + L) % L; }

  // 沿路距离 d 处的中心线状态
  sample(d, o = {}) {
    d = this.wrapD(d);
    const f = d / this.ds, i = Math.floor(f) % this.N, j = (i + 1) % this.N, t = f - Math.floor(f);
    o.i = i; o.d = d;
    o.x = this.px[i] + (this.px[j] - this.px[i]) * t;
    o.z = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    o.y = this.py[i] + (this.py[j] - this.py[i]) * t;
    o.hd = this.hd[i] + wrap(this.hd[j] - this.hd[i]) * t;
    o.tx = Math.sin(o.hd); o.tz = Math.cos(o.hd);
    o.rx = -o.tz; o.rz = o.tx;
    o.bank = this.bank[i] + (this.bank[j] - this.bank[i]) * t;
    o.curv = this.curv[i];
    return o;
  }
  surfaceY(o, lat) { return o.y + lat * Math.sin(o.bank); }
  // 沿路 d、横向 lat 处的世界坐标
  pointAt(d, lat, out = new THREE.Vector3()) {
    const s = this.sample(d, this._s || (this._s = {}));
    return out.set(s.x + s.rx * lat, this.surfaceY(s, lat), s.z + s.rz * lat);
  }

  // 世界坐标投影到赛道。hint ≥ 0 时只在附近找（每帧连续移动），否则全局找。
  project(x, z, hint, o = {}) {
    const N = this.N;
    let bi = 0, best = Infinity;
    if (hint < 0) {
      for (let i = 0; i < N; i++) { const dx = this.px[i] - x, dz = this.pz[i] - z, d2 = dx * dx + dz * dz; if (d2 < best) { best = d2; bi = i; } }
    } else {
      for (let k = -40; k <= 40; k++) {
        const i = (hint + k + N) % N, dx = this.px[i] - x, dz = this.pz[i] - z, d2 = dx * dx + dz * dz;
        if (d2 < best) { best = d2; bi = i; }
      }
    }
    let i = bi, j = (i + 1) % N;
    let ex = this.px[j] - this.px[i], ez = this.pz[j] - this.pz[i];
    let t = ((x - this.px[i]) * ex + (z - this.pz[i]) * ez) / (ex * ex + ez * ez);
    if (t < 0) {
      i = (bi - 1 + N) % N; j = bi;
      ex = this.px[j] - this.px[i]; ez = this.pz[j] - this.pz[i];
      t = ((x - this.px[i]) * ex + (z - this.pz[i]) * ez) / (ex * ex + ez * ez);
    }
    t = clamp(t, 0, 1);
    this.sample((i + t) * this.ds, o);
    o.lat = (x - o.x) * o.rx + (z - o.z) * o.rz;
    return o;
  }

  // 前方 range 米内曲率绝对值最大处（带符号）及其距离
  curvAhead(d, from, range) {
    const i0 = Math.floor(this.wrapD(d + from) / this.ds), steps = Math.max(1, Math.floor(range / this.ds));
    let m = 0, at = 0;
    for (let k = 0; k < steps; k += 2) { const c = this.curv[(i0 + k) % this.N]; if (Math.abs(c) > Math.abs(m)) { m = c; at = k * this.ds; } }
    return { k: m, at: at + from };
  }
}

function smooth(a, w) {
  const N = a.length, o = new Float32Array(N);
  for (let i = 0; i < N; i++) { let s = 0; for (let k = -w; k <= w; k++) s += a[((i + k) % N + N) % N]; o[i] = s / (2 * w + 1); }
  return o;
}
