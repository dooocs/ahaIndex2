// AI 车手：沿赛道距离 + 横向偏移来开。看前方弯道算目标速度，弯前走外线、弯心切内线，
// 弯够急就做个漂移的样子（车身甩角 + 冒烟），直道上偶尔放氮气。名字取自西湖的传说。
import { animateCar, TUNE } from './car.js';
import { damp } from './noise.js';

export const AI_DRIVERS = [
  { name: '白娘子', body: 0xf3efe6, trim: 0x9ccfd8, helmet: 0xffffff, skill: 1.0 },
  { name: '小青', body: 0x5fb58a, trim: 0xf3efe6, helmet: 0xcfeedd, skill: 0.97 },
  { name: '济公', body: 0xd9a24a, trim: 0x8a3f33, helmet: 0xe8c66a, skill: 0.95 },
  { name: '许仙', body: 0x6f8fd0, trim: 0xf3efe6, helmet: 0xdfe8ff, skill: 0.93 },
  { name: '法海', body: 0x8a5a9e, trim: 0xe8c66a, helmet: 0xf2e3b3, skill: 0.91 },
];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class AICar {
  constructor(track, model, cfg, rand) {
    this.track = track; this.model = model; this.cfg = cfg; this.name = cfg.name; this.rand = rand;
    this.skill = cfg.skill; this.line = (rand() - 0.5) * 0.4; this.s2 = {};
  }
  reset(dist, lat) {
    this.dist = dist; this.lat = lat; this.latV = 0; this.s = 0; this.nitroT = 0; this.nitroCd = 8 + this.rand() * 8;
    this.yaw = 0; this.drift = false; this.driftDir = 0; this.y = 0; this.vy = 0; this.air = false; this.smallT = 0; this.steer = 0;
    const s = this.track.sample(dist, this.s2);
    this.x = s.x + s.rx * lat; this.z = s.z + s.rz * lat; this.h = s.hd;
  }
  get d() { return this.track.wrapD(this.dist); }

  update(dt, active, playerProgress, myProgress) {
    const tr = this.track, hw = tr.halfW;
    if (!active) { this.sync(dt); return; }
    // 远远落后玩家时稍微加把劲，领先太多时稍微松一点（只影响直道速度）
    const gap = playerProgress - myProgress;
    const rub = clamp(1 + gap / 2400, 0.94, 1.06);
    const vTop = TUNE.vmax * this.skill * rub * (this.nitroT > 0 ? 1.3 : 1);
    // 前方 120 米最急的弯决定目标速度（v² = a_lat / κ）
    const ahead = tr.curvAhead(this.dist, 8, 30 + this.s * 1.4);
    const kAbs = Math.max(Math.abs(ahead.k), 1e-4);
    const vCorner = Math.sqrt((19 + this.skill * 6) / kAbs);
    const vt = Math.min(vTop, vCorner * (1 + clamp(ahead.at / 120, 0, 0.4)));
    if (this.s < vt) this.s += (TUNE.accel + (this.nitroT > 0 ? 14 : 0)) * (1 - (this.s / Math.max(vTop, 1)) ** 2 * 0.7) * dt;
    else this.s -= Math.min(32, (this.s - vt) * 3) * dt;
    // 爬坡减速
    const s = tr.sample(this.dist, this.s2);
    this.s -= tr.slope[s.i] * 6 * dt;
    // 横向：弯前走外线，弯心切内线；其余回到自己的习惯线
    const kNow = tr.curv[s.i];
    let target = this.line * hw;
    if (Math.abs(ahead.k) > 1 / 220) target = (ahead.at > 35 ? 1 : -1) * Math.sign(ahead.k) * hw * 0.5;
    if (Math.abs(kNow) > 1 / 120) target = Math.sign(kNow) * -hw * 0.55;
    // 避让前车
    for (const o of this.others) {
      if (o === this) continue;
      let dd = o.d - this.d; if (dd < -tr.length / 2) dd += tr.length; if (dd > tr.length / 2) dd -= tr.length;
      if (dd > 0 && dd < 14 && Math.abs(o.lat - this.lat) < 3.2) target = o.lat + (o.lat > 0 ? -4.5 : 4.5);
    }
    target = clamp(target, -hw + 2.2, hw - 2.2);
    const latA = (target - this.lat) * 3.2 - this.latV * 2.6;
    this.latV += latA * dt;
    this.latV = clamp(this.latV, -9, 9);
    this.lat = clamp(this.lat + this.latV * dt, -hw + 1.3, hw - 1.3);
    this.dist += this.s * dt;
    this.steer = damp(this.steer, clamp(kNow * 30 + this.latV * 0.06, -1, 1), 8, dt);

    // 急弯 + 有速度 = 漂移的样子
    const wantDrift = Math.abs(kNow) > 1 / 70 && this.s > 22;
    if (wantDrift && !this.drift) { this.drift = true; this.driftDir = Math.sign(kNow); }
    if (!wantDrift && this.drift) { this.drift = false; this.smallT = 0.7; this.s += 3; }
    this.yaw = damp(this.yaw, this.drift ? this.driftDir * 0.5 : 0, 5, dt);
    if (this.smallT > 0) this.smallT -= dt;

    // 直道放氮气
    this.nitroCd -= dt;
    if (this.nitroCd <= 0 && Math.abs(ahead.k) < 1 / 300) { this.nitroT = 2.2; this.nitroCd = 12 + this.rand() * 10; }
    if (this.nitroT > 0) this.nitroT -= dt;

    // 跳桥：和玩家一样的判定
    const ys = tr.surfaceY(s, this.lat);
    if (this.air) {
      this.vy -= TUNE.gravity * dt; this.y += this.vy * dt;
      if (this.y <= ys) { this.y = ys; this.air = false; this.vy = 0; }
    } else if (this.s > 18 && this.s * this.s * -tr.vcurv[s.i] > TUNE.gravity) {
      this.air = true; this.vy = tr.sslope[s.i] * this.s; this.y = ys;
    } else this.y = ys;

    this.x = s.x + s.rx * this.lat; this.z = s.z + s.rz * this.lat; this.h = s.hd + this.yaw;
    this.sync(dt, s);
  }
  sync(dt, s = this.track.sample(this.dist, this.s2)) {
    const mdl = this.model;
    mdl.position.set(this.x, this.y ?? this.track.surfaceY(s, this.lat), this.z);
    mdl.rotation.set(this.air ? clamp(-this.vy * 0.012, -0.3, 0.3) : -Math.atan(this.track.slope[s.i]), this.h, -s.bank, 'YXZ');
    animateCar(mdl, { speed: this.s, steer: this.steer, drifting: this.drift, driftDir: this.driftDir, dt, nitro: this.nitroT > 0, small: this.smallT > 0, lean: this.drift ? this.driftDir * 0.07 : 0 });
  }
}
