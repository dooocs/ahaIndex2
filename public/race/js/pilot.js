// 自动驾驶（?auto）和调参模拟共用的“车手”：沿 track.line 走线，按限速剖面踩油门/刹车；
// drift 打开时，在够急的弯（纯抓地过弯低于 ~95 km/h）前甩进漂移，车头对准出弯方向就松开，有氮气且前面够直就喷。
import { TUNE, IDLE } from './car.js';
import { speedProfile } from './line.js';

const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function makePilot(track, opts = {}) {
  const o = { drift: true, nitro: true, f: 0.95, g: 0.7, vInMul: 1.6, pre: 35, thr: -0.1, lookOut: 25, driftBelow: 26.5, ...opts };
  const L = track.line, N = track.N, ds = track.ds, s2 = {};
  const idx = d => Math.floor(track.wrapD(d) / ds) % N;
  const latAt = d => { const f = track.wrapD(d) / ds, i = Math.floor(f) % N; return L.lat[i] + (L.lat[(i + 1) % N] - L.lat[i]) * (f - Math.floor(f)); };
  const linePt = d => { const s = track.sample(d, s2), l = latAt(d); return [s.x + s.rx * l, s.z + s.rz * l]; };
  const aLat = TUNE.latGrip * o.f;
  // 要漂的弯：走线曲率的局部最大，且纯抓地过弯速度低于 driftBelow
  const apexes = [];
  if (o.drift) for (let i = 0; i < N; i++) {
    const k = Math.abs(L.k[i]); let peak = true;
    for (let j = -20; j <= 20 && peak; j++) if (j && Math.abs(L.k[(i + j + N) % N]) > k) peak = false;
    if (peak && Math.sqrt(aLat / k) < o.driftBelow && !apexes.some(a => Math.abs(a.i - i) < 30)) apexes.push({ i, d: i * ds, dir: Math.sign(L.k[i]), vg: Math.sqrt(aLat / k) });
  }
  // 每个弯可以单独给参数（调参时逐弯搜出来的），skip 表示这个弯不漂
  apexes.forEach((a, n) => {
    const q = { vInMul: o.vInMul, pre: o.pre, thr: o.thr, lookOut: o.lookOut, ...(o.perApex && o.perApex[n]) };
    Object.assign(a, q, { n, vIn: Math.min(TUNE.vmax, a.vg * q.vInMul) });
  });
  const live = apexes.filter(a => !a.skip);
  // 限速：抓地极限；漂移弯从甩入点到弯心按入弯速度封顶（之后漂移自己掉速）
  const lim = new Float32Array(N);
  for (let i = 0; i < N; i++) lim[i] = Math.abs(L.k[i]);
  const prof = speedProfile(track, lim, { aLat, brake: TUNE.brake * o.g, vmax: 80 });
  for (const a of live) {
    const e = Math.round((a.d - a.pre) / ds);
    for (let j = e; j <= a.i + 10; j++) prof[(j + N) % N] = j < e + 4 ? Math.min(prof[(j + N) % N], a.vIn) : 80;
  }
  for (let pass = 0; pass < 2; pass++) for (let i = 2 * N - 1; i >= 0; i--) { const x = i % N, y = (i + 1) % N; prof[x] = Math.min(prof[x], Math.sqrt(prof[y] * prof[y] + 2 * TUNE.brake * o.g * ds)); }

  let cur = null, stuck = 0, back = 0;   // 正在漂的弯；卡住时倒一下车
  const steerTo = (p, look) => { const [tx, tz] = linePt(p.d + look); return wrapA(Math.atan2(tx - p.x, tz - p.z) - p.m); };
  return {
    apexes, prof,
    reset() { cur = null; stuck = 0; back = 0; },
    step(p, dt = 1 / 60) {
      const inp = { ...IDLE };
      if (back > 0) { back -= dt; const e = steerTo(p, 10); return { ...inp, down: true, left: e < 0, right: e > 0 }; }
      stuck = Math.abs(p.s) < 1.5 ? stuck + dt : 0;
      if (stuck > 0.8) { stuck = 0; back = 0.9; cur = null; }
      inp.upPressed = p.window > 0 && p.window < 0.38;
      // 进入漂移：刚过甩入点
      if (!cur && o.drift) for (const a of live) {
        const de = track.wrapD(a.d - a.pre - p.d);
        if ((de < 3 || de > track.length - 2) && track.wrapD(a.d + 30 - p.d) < a.pre + 30 && p.s > 12) { cur = a; break; }
      }
      if (cur) {
        const [tx, tz] = linePt(p.d + cur.lookOut);
        const want = Math.atan2(tx - p.x, tz - p.z), errH = wrapA(want - p.h) * cur.dir, errM = wrapA(want - p.m) * cur.dir;
        const past = track.wrapD(p.d - cur.d);
        if ((p.drift && p.driftT > 0.25 && errH < cur.thr) || (past > 80 && past < 400)) cur = null;
        else {
          const inner = errM > 0.15 || !p.drift;
          const turn = inner ? cur.dir : (errM < -0.05 ? -cur.dir : 0);
          return { ...inp, up: true, drift: true, left: turn > 0, right: turn < 0 };
        }
      }
      const vt = Math.min(prof[idx(p.d)], prof[idx(p.d + p.s * 0.15)]);
      const e = steerTo(p, 6 + p.s * 0.35);
      inp.up = p.s < vt - 0.3; inp.down = p.s > vt + 0.6; inp.left = e > 0.012; inp.right = e < -0.012;
      if (o.nitro && p.nitroN > 0 && p.nitroT <= 0 && !p.drift) {
        let straight = true;
        for (let d = 0; d < 140 && straight; d += 6) if (prof[idx(p.d + d)] < 48) straight = false;
        inp.nitroPressed = straight;
      }
      return inp;
    },
  };
}
