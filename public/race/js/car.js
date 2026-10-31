// 车：卡通敞篷小车 + 戴头盔的车手（toon 材质，描线后像手办），以及玩家车的操控物理。
// 物理是“贴赛道”的街机模型：位置在平面上自由积分，每帧投影回赛道求路面高度、护栏和腾空。
// 车头朝向 h 与运动方向 m 分开：抓地时 m 很快追上 h；漂移时 m 慢慢跟，二者之差就是漂移角，漂移角越大集气越快。
import * as THREE from 'three';
import { toon, mergeColored } from './toon.js';
import { damp } from './noise.js';

const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const TUNE = {
  vmax: 52, vmaxNitro: 72, accel: 22, nitroAccel: 38, brake: 40, reverseMax: 10, roll: 2.0,
  turn: 1.75, grip: 11,
  driftMin: 12, driftYaw: 1.35, driftYawAlign: 0.8, driftGrip: 1.9, driftRelease: 5.5, maxDrift: 1.1,
  gaugeRate: 0.42, nitroTime: 2.6, smallWindow: 0.5, gravity: 30,
};

// ---------- 模型 ----------
export function buildCarModel(body, trim = 0xf3efe6, helmet = 0xffffff) {
  const g = new THREE.Group(), root = new THREE.Group();
  g.add(root);
  // 不动的部件按着色方式分三组合并（普通 / 玻璃 / 发光），颜色走顶点属性
  const plain = [], glass = [], glow = [];
  const m = (geo, hex, o = {}) => (o.kind === 'GLASS' ? glass : o.kind === 'GLOW' ? glow : plain).push({ geo, hex, shade: o.shade });
  // 车身：一段带倒角的侧面轮廓挤出
  const sh = new THREE.Shape();
  sh.moveTo(-2.0, 0.25); sh.lineTo(1.75, 0.25); sh.quadraticCurveTo(2.15, 0.3, 2.1, 0.62);
  sh.lineTo(1.2, 0.86); sh.lineTo(0.45, 0.9); sh.lineTo(-0.15, 1.05); sh.lineTo(-1.7, 1.05); sh.quadraticCurveTo(-2.05, 1.0, -2.05, 0.7); sh.closePath();
  const bodyG = new THREE.ExtrudeGeometry(sh, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 2 });
  bodyG.translate(0, 0, -0.85); bodyG.rotateY(-Math.PI / 2);
  m(bodyG, body);
  // 座舱：深色内饰、风挡、后部的流线头枕
  m(new THREE.BoxGeometry(1.25, 0.2, 1.2).translate(0, 0.98, -0.1), 0x2f3438);
  m(new THREE.BoxGeometry(1.5, 0.42, 0.1).rotateX(-0.45).translate(0, 1.18, 0.52), 0xcfe7ea, { kind: 'GLASS', shade: 0x6f97a6 });
  m(new THREE.CylinderGeometry(0.28, 0.32, 0.7, 10).rotateX(Math.PI / 2).translate(-0.42, 1.12, -0.95), body);
  // 车手：头盔 + 护目镜 + 肩
  m(new THREE.CylinderGeometry(0.32, 0.38, 0.4, 10).translate(0, 1.2, -0.35), trim);
  m(new THREE.SphereGeometry(0.36, 16, 12).translate(0, 1.66, -0.33), helmet);
  m(new THREE.BoxGeometry(0.5, 0.16, 0.2).translate(0, 1.68, -0.08), 0x2a3238);
  // 前后装饰：车头条纹、尾翼、尾灯、车灯
  m(new THREE.BoxGeometry(0.36, 0.06, 1.7).translate(0, 0.98, 1.15), trim);
  m(new THREE.BoxGeometry(1.95, 0.1, 0.5).translate(0, 1.48, -1.82), trim);
  for (const s of [-1, 1]) m(new THREE.BoxGeometry(0.1, 0.42, 0.36).translate(s * 0.75, 1.22, -1.82), 0x2f3438);
  for (const s of [-1, 1]) {
    m(new THREE.BoxGeometry(0.42, 0.16, 0.06).translate(s * 0.6, 0.72, 2.2), 0xf7e9a8, { kind: 'GLOW' });
    m(new THREE.BoxGeometry(0.4, 0.14, 0.06).translate(s * 0.62, 0.78, -2.22), 0xd65b4f, { kind: 'GLOW' });
  }
  const add = (items, opts) => { const x = new THREE.Mesh(mergeColored(items), toon(0xffffff, { ...opts, vcol: true })); x.castShadow = opts.kind !== 'GLOW'; x.receiveShadow = true; root.add(x); };
  add(plain, { breakMul: 0.25 }); add(glass, { kind: 'GLASS' }); add(glow, { kind: 'GLOW', glow: 1.05 });
  // 轮子
  const wheels = [];
  for (const [x, z, front] of [[1.02, 1.35, 1], [-1.02, 1.35, 1], [1.02, -1.35, 0], [-1.02, -1.35, 0]]) {
    const steer = new THREE.Group(), spin = new THREE.Group();
    steer.position.set(x, 0.44, z);
    const wheel = new THREE.Mesh(mergeColored([
      { geo: new THREE.CylinderGeometry(0.44, 0.44, 0.42, 16).rotateZ(Math.PI / 2), hex: 0x2c3238 },
      { geo: new THREE.CylinderGeometry(0.2, 0.2, 0.44, 8).rotateZ(Math.PI / 2), hex: 0xe8e4da },
      { geo: new THREE.BoxGeometry(0.46, 0.5, 0.08), hex: 0xe8e4da },
    ]), toon(0xffffff, { vcol: true, breakMul: 0.2 }));
    wheel.castShadow = true;
    spin.add(wheel); steer.add(spin); root.add(steer);
    wheels.push({ steer, spin, front: !!front });
  }
  // 尾焰：小喷橙色、氮气蓝色
  const flames = [];
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.4, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.7), toon(0xffb347, { kind: 'GLOW', glow: 1.3 }));
    f.position.set(s * 0.45, 0.55, -2.15); f.visible = false; root.add(f);
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.9, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.45), toon(0xfff6d8, { kind: 'GLOW', glow: 1.3 }));
    core.position.copy(f.position); core.visible = false; root.add(core);
    flames.push(f, core);
  }
  g.userData = { root, wheels, flames, flameOuter: flames[0].material };
  return g;
}
const FLAME_ORANGE = new THREE.Color(0xffb347), FLAME_BLUE = new THREE.Color(0x7fd7ff);
export function animateCar(model, { speed, steer, drifting, driftDir, nitro, small, dt, lean = 0, pitch = 0 }) {
  const u = model.userData;
  for (const w of u.wheels) {
    w.spin.rotation.x += speed * dt / 0.44;
    if (w.front) w.steer.rotation.y = drifting ? -driftDir * 0.35 : steer * 0.42;
  }
  u.root.rotation.z = damp(u.root.rotation.z, lean, 8, dt);
  u.root.rotation.x = damp(u.root.rotation.x, pitch, 6, dt);
  const on = nitro || small;
  const t = performance.now() * 0.001;
  u.flames.forEach((f, i) => {
    f.visible = on;
    if (on) { const k = (nitro ? 1.15 : 0.7) * (0.85 + Math.sin(t * 50 + i) * 0.1 + Math.random() * 0.15); f.scale.set(k, k, k * (1 + Math.random() * 0.4)); }
  });
  u.flameOuter.uniforms.uLit.value.copy(nitro ? FLAME_BLUE : FLAME_ORANGE);
}

// ---------- 玩家车 ----------
export class PlayerCar {
  constructor(track, model) {
    this.track = track; this.model = model; this.proj = {}; this.events = [];
  }
  reset(d, lat) {
    const s = this.track.sample(d, {});
    this.x = s.x + s.rx * lat; this.z = s.z + s.rz * lat; this.y = this.track.surfaceY(s, lat);
    this.h = this.m = s.hd; this.s = 0; this.vy = 0; this.air = false; this.airT = 0;
    this.steer = 0; this.drift = false; this.driftDir = 0; this.driftT = 0; this.slip = 0; this.release = 0;
    this.gauge = 0; this.nitroN = 0; this.nitroT = 0; this.smallT = 0; this.smallPow = 0; this.window = 0; this.windowKind = '';
    this.padT = 0; this.startT = 0; this.hint = -1; this.wrongT = 0; this.impact = 0; this.lastSmall = -9; this.time = 0;
    this.track.project(this.x, this.z, -1, this.proj);
    this.hint = this.proj.i; this.d = this.proj.d; this.lat = this.proj.lat;
  }
  emit(type, data = {}) { this.events.push({ type, ...data }); }
  get kmh() { return Math.abs(this.s) * 3.6; }
  get boosting() { return this.nitroT > 0 || this.smallT > 0 || this.padT > 0 || this.startT > 0; }

  fireNitro() {
    if (this.nitroN <= 0 || this.nitroT > 0.3) return;
    this.nitroN--;
    const dbl = this.time - this.lastSmall < 0.45;   // 小喷后紧接氮气 = 双喷
    this.nitroT = TUNE.nitroTime + (dbl ? 0.5 : 0);
    this.s = Math.max(this.s, 20) + (dbl ? 7 : 4);
    this.emit(dbl ? 'double' : 'nitro');
  }
  endDrift(clean) {
    if (!this.drift) return;
    this.drift = false;
    if (clean && this.driftT > 0.25) { this.window = TUNE.smallWindow; this.windowKind = 'drift'; }
    this.emit('driftEnd', { t: this.driftT });
  }

  update(dt, inp, active) {
    const T = TUNE, tr = this.track;
    this.time += dt;
    if (!active) inp = IDLE;
    const steerIn = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
    this.steer = damp(this.steer, steerIn, 12, dt);

    let vmax = T.vmax, acc = T.accel;
    if (this.nitroT > 0) { vmax = T.vmaxNitro; acc = T.nitroAccel; this.nitroT -= dt; }
    if (this.smallT > 0) { vmax += this.smallPow; acc += 14; this.smallT -= dt; }
    if (this.padT > 0) { vmax += 12; acc += 22; this.padT -= dt; }
    if (this.startT > 0) { vmax += 10; acc += 28; this.startT -= dt; }
    vmax = Math.min(vmax, 82);

    // 小喷 / 落地喷：窗口内再按一下 ↑
    if (this.window > 0) {
      this.window -= dt;
      if (inp.upPressed) {
        const perfect = (this.windowKind === 'drift' ? T.smallWindow : 0.45) - this.window < 0.2;
        this.smallT = perfect ? 1.0 : 0.75; this.smallPow = perfect ? 11 : 8;
        this.s += perfect ? 5.5 : 4;
        this.lastSmall = this.time;
        this.emit(this.windowKind === 'land' ? 'landBoost' : 'small', { perfect });
        this.window = 0;
      }
    }
    if (inp.nitroPressed) this.fireNitro();

    const ground = !this.air;
    if (ground) {
      if (inp.up) {
        if (this.s < 0) this.s += T.brake * dt;
        else if (this.s < vmax) this.s += acc * (1 - (this.s / vmax) ** 2 * 0.82) * dt;
      } else if (inp.down) {
        if (this.s > 0.5) this.s -= T.brake * dt; else this.s = Math.max(-T.reverseMax, this.s - 14 * dt);
      } else {
        const dec = (T.roll + Math.abs(this.s) * 0.05) * dt;
        this.s = Math.abs(this.s) <= dec ? 0 : this.s - Math.sign(this.s) * dec;
      }
      if (this.s > vmax) this.s -= (this.s - vmax) * 1.2 * dt;
      this.s -= tr.slope[this.hint] * Math.cos(this.h - tr.hd[this.hint]) * 7 * dt;
    }

    // Shift + 方向：进入漂移
    if (!this.drift && inp.drift && steerIn !== 0 && this.s > T.driftMin && ground) {
      this.drift = true; this.driftDir = steerIn; this.driftT = 0; this.release = 0; this.window = 0;
      this.h += steerIn * 0.08;
      this.emit('driftStart');
    }
    if (this.drift) {
      const align = steerIn * this.driftDir, held = inp.drift;
      this.release = held ? 0 : this.release + dt;
      const yaw = held ? T.driftYaw + T.driftYawAlign * align : (0.4 + 0.9 * align) * Math.exp(-2.4 * this.release);
      this.h += this.driftDir * yaw * clamp(this.s / 26, 0.35, 1) * dt * (ground ? 1 : 0.4);
      const k = held ? T.driftGrip : T.driftRelease;
      this.m += wrap(this.h - this.m) * (1 - Math.exp(-k * dt));
      let a = wrap(this.h - this.m);
      if (Math.abs(a) > T.maxDrift) { this.m = this.h - Math.sign(a) * T.maxDrift; a = Math.sign(a) * T.maxDrift; }
      this.slip = a;
      const sa = Math.abs(Math.sin(a));
      if (ground) {
        this.s -= (2.2 + 10 * sa) * dt;
        this.gauge += dt * T.gaugeRate * (0.3 + sa * 1.8) * clamp(this.s / 34, 0.3, 1.1);
        while (this.gauge >= 1) {
          if (this.nitroN < 2) { this.nitroN++; this.gauge -= 1; this.emit('gauge'); } else { this.gauge = 1; break; }
        }
      }
      this.driftT += dt;
      if ((!held && (Math.abs(a) < 0.09 || (align < 0 && Math.abs(a) < 0.25))) || this.s < 7) this.endDrift(this.s >= 7);
    } else {
      this.slip = damp(this.slip, 0, 10, dt);
      const dir = this.s >= 0 ? 1 : -1, sp = Math.abs(this.s);
      const turn = T.turn * clamp(sp / 9, 0, 1) * (1 - 0.5 * clamp(sp / T.vmax, 0, 1.3));
      this.h += this.steer * turn * dt * dir * (ground ? 1 : 0.35);
      if (this.s >= 0) this.m += wrap(this.h - this.m) * (1 - Math.exp(-T.grip * dt)); else this.m = this.h;
    }

    // 平面积分
    const mv = this.s >= 0 ? this.m : this.h, sgn = this.s >= 0 ? 1 : -1;
    let vx = Math.sin(mv) * Math.abs(this.s) * sgn, vz = Math.cos(mv) * Math.abs(this.s) * sgn;
    this.x += vx * dt; this.z += vz * dt;
    const p = tr.project(this.x, this.z, this.hint, this.proj);
    this.hint = p.i; this.d = p.d;

    // 护栏：把车推回路内，去掉撞墙方向的速度，车头顺着墙摆正
    const lim = tr.halfW - 1.15;
    this.impact = 0;
    if (Math.abs(p.lat) > lim) {
      const sg = Math.sign(p.lat), nx = p.rx * sg, nz = p.rz * sg, over = Math.abs(p.lat) - lim;
      this.x -= nx * over; this.z -= nz * over;
      const vn = vx * nx + vz * nz;
      if (vn > 0) {
        const sp = Math.max(1, Math.hypot(vx, vz)), hit = vn / sp;
        vx -= nx * vn * 1.25; vz -= nz * vn * 1.25;
        const keep = 1 - 0.42 * hit; vx *= keep; vz *= keep;
        const ns = Math.hypot(vx, vz);
        if (this.s >= 0) {
          this.s = ns; if (ns > 0.5) this.m = Math.atan2(vx, vz);
          const th = Math.abs(wrap(this.h - p.hd)) < Math.PI / 2 ? p.hd : p.hd + Math.PI;
          this.h += wrap(th - this.h) * Math.min(1, 0.6 * hit + 0.05);
        } else this.s = -ns;
        this.impact = hit * sp;
        if (hit > 0.3 && this.drift) this.endDrift(false);
        this.emit(hit * sp > 6 ? 'crash' : 'scrape', { power: hit * sp, side: sg });
      }
      p.lat = sg * lim;
    }
    this.lat = p.lat;

    // 竖直：贴地、腾空、落地
    const gy = tr.surfaceY(p, p.lat);
    if (this.air) {
      this.vy -= T.gravity * dt; this.y += this.vy * dt; this.airT += dt;
      if (this.y <= gy) {
        this.y = gy; this.air = false;
        this.emit('land', { air: this.airT, v: this.vy });
        if (this.airT > 0.28) { this.window = 0.45; this.windowKind = 'land'; }
        this.vy = 0; this.airT = 0;
      }
    } else {
      const va = this.s * Math.cos(this.m - p.hd);
      if (va > 18 && va * va * -tr.vcurv[p.i] > T.gravity) {
        this.air = true; this.airT = 0; this.vy = tr.sslope[p.i] * va; this.y = gy + this.vy * dt;
        if (this.drift) this.endDrift(false);
        this.emit('jump');
      } else this.y = gy;
    }

    // 逆行
    if (Math.cos(wrap(this.h - p.hd)) < -0.35 && this.s > 4) this.wrongT += dt; else this.wrongT = Math.max(0, this.wrongT - dt * 2);

    // 加速带
    for (const pad of tr.pads) {
      let dd = this.d - pad.d; if (dd < 0) dd += tr.length;
      if (dd < pad.len && Math.abs(this.lat) < pad.halfW + 0.8 && !this.air) {
        if (this.padT < 0.6) { this.emit('pad'); this.s = Math.min(this.s + 6, 72); }
        this.padT = 1.1;
      }
    }
  }

  sync(dt) {
    const tr = this.track, i = this.hint, mdl = this.model;
    mdl.position.set(this.x, this.y, this.z);
    const rel = this.h - tr.hd[i];
    const pitchT = this.air ? clamp(-this.vy * 0.012, -0.3, 0.3) : -Math.atan(tr.slope[i] * Math.cos(rel));
    this.pv = damp(this.pv ?? 0, pitchT, 10, dt);
    this.rv = damp(this.rv ?? 0, -tr.bank[i] * Math.cos(rel), 10, dt);
    mdl.rotation.set(this.pv, this.h, this.rv, 'YXZ');
    const sp = Math.abs(this.s);
    animateCar(mdl, {
      speed: this.s, steer: this.steer, drifting: this.drift, driftDir: this.driftDir, dt,
      nitro: this.nitroT > 0, small: this.smallT > 0 || this.padT > 0 || this.startT > 0,
      lean: this.drift ? this.driftDir * 0.07 : this.steer * 0.05 * clamp(sp / 30, 0, 1),
      pitch: this.nitroT > 0 ? -0.03 : 0,
    });
  }
}
export const IDLE = { up: false, down: false, left: false, right: false, drift: false, upPressed: false, nitroPressed: false };
