import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerCar, AICar, AI_DRIVERS, Track, makePilot, racingLine, CENTERLINE, ROAD_WIDTH, START_AT } from './helpers/race.mjs';
import { makeRand } from '../public/race/js/noise.js';

// Actual Westlake geometry, banking, jumps, racing line and four boost pads.
// No rendering or car-to-car pushing: this is a deterministic handling benchmark.
const track = new Track(CENTERLINE, ROAD_WIDTH);
track.line = racingLine(track, 2.6);
track.pads = [[425, -180], [50, -352], [-403, -178], [-300, 474]].map(([x, z]) => ({
  d: (Math.round(track.dAt(x, z) / track.ds) - 1) * track.ds, len: 10 * track.ds, halfW: 4.2,
}));
const start = track.dAt(...START_AT), dt = 1 / 60;

function race(opts, { fullThrottle = false, opponents = false } = {}) {
  const p = new PlayerCar(track, {});
  p.reset(start - 50, 4.8); p.startT = 1.2;
  const pilot = makePilot(track, opts), rand = makeRand(3);
  const ais = opponents ? AI_DRIVERS.map((cfg, k) => {
    const a = new AICar(track, {}, cfg, rand);
    a.sync = () => {}; // Rendering only; update/profile are the production implementations.
    a.reset(start - 10 - k * 8, k % 2 ? 4.8 : -4.8);
    return a;
  }) : [];
  ais.forEach(a => { a.others = ais; });
  let lastD = p.d, progress = -50, finish = null, lapStart = 0, smalls = 0, nitros = 0;
  const laps = [];
  for (let frame = 0; frame < 60 * 300; frame++) {
    const time = (frame + 1) * dt;
    if (finish === null) {
      const inp = pilot.step(p, dt);
      if (fullThrottle) { inp.up = true; inp.down = false; }
      p.update(dt, inp, true);
      assert.ok([p.x, p.y, p.z, p.h, p.m, p.s].every(Number.isFinite));
      assert.ok(Math.abs(p.lat) <= track.halfW - 1.15 + 1e-6, '不能穿过护栏');
      let dd = p.d - lastD;
      if (dd > track.length / 2) dd -= track.length;
      if (dd < -track.length / 2) dd += track.length;
      progress += dd; lastD = p.d;
      for (const e of p.events) {
        if (e.type === 'small') smalls++;
        if (e.type === 'nitro' || e.type === 'double') nitros++;
      }
      p.events.length = 0;
      if (progress >= (laps.length + 1) * track.length) { laps.push(time - lapStart); lapStart = time; }
      if (progress >= 2 * track.length) finish = time;
    }
    for (const a of ais) if (!a.finish) {
      a.update(dt, true, progress, a.dist - start);
      if (a.dist - start >= 2 * track.length) a.finish = time;
    }
    if (finish !== null && ais.every(a => a.finish)) break;
  }
  return { finish, laps, smalls, nitros, ai: ais.map(a => ({ name: a.name, time: a.finish })) };
}

test('真实西湖赛道：普通转向和五名 AI 都能完成两圈，AI 车技保持分层', () => {
  const result = race({ drift: false, nitro: false }, { opponents: true });
  assert.ok(result.finish > 120 && result.finish < 240);
  assert.equal(result.laps.length, 2);
  assert.ok(result.laps.every(t => t > 60 && t < 120), '圈速需满足成绩榜校验');
  assert.ok(result.ai.every(a => a.time > 120 && a.time < 240));
  assert.ok(result.ai[0].time < result.ai.at(-1).time - 5, '不同车技不能全都同速');
});

test('真实西湖赛道：选择漂移和喷气时机比全油门频繁碰护栏更快', () => {
  const throttle = race({ drift: false, nitro: false }, { fullThrottle: true });
  const skilled = race({ f: 1.5, g: 0.9, vInMul: 1.5, pre: 30, driftBelow: 40, thr: -0.2 });
  assert.ok(throttle.finish && skilled.finish);
  assert.ok(skilled.smalls > 5 && skilled.nitros > 2, '需要实际触发小喷与氮气');
  assert.ok(skilled.finish < throttle.finish - 4, `应保留操作收益：${skilled.finish} / ${throttle.finish}`);
  assert.ok(skilled.laps.every(t => t > 60), '合理操作不能被排行榜的最短圈速拒绝');
});
