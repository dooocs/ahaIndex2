import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTimetable, DWELL, RAMP } from '../public/dream/js/bus/timetable.js';
import { offsetFromSamples, syncClock } from '../public/dream/js/bus/clock.js';
import { ridersOn, hasRoom, isBumped } from '../public/dream/js/bus/riders.js';

const line = () => makeTimetable({ length: 1000, stops: [0, 40, 400, 700], speed: 50, buses: 3 });

test('the period is every dwell plus every leg', () => {
  const tt = line();
  const move = tt.legs.reduce((t, l) => t + l.move, 0);
  assert.equal(tt.period, 4 * DWELL + move);
  // a 40-unit leg is too short for cruise: peak speed d / ramp, 2 × ramp seconds
  assert.ok(Math.abs(tt.legs[0].vp - 40 / RAMP) < 1e-9);
  assert.equal(tt.legs[0].move, 2 * RAMP);
  // a long leg cruises at full speed
  assert.equal(tt.legs[1].vp, 50);
});

test('a bus waits at a stop for the dwell, then leaves gently and arrives gently', () => {
  const tt = line();
  const t0 = -tt.phaseOf(0, 0);          // bus 0 arrives at stop 0 at t = 0 (mod period)
  const a = tt.at(0, t0 + 5);
  assert.equal(a.stop, 0); assert.equal(a.s, 0); assert.equal(a.v, 0); assert.ok(Math.abs(a.dwellLeft - (DWELL - 5)) < 1e-9);
  const b = tt.at(0, t0 + DWELL + 0.05);
  assert.equal(b.stop, null); assert.ok(b.v > 0 && b.v < 2, `slow start, v=${b.v}`); assert.ok(b.s > 0 && b.s < 0.1);
  const leg = tt.legs[1], end = t0 + leg.t0 + DWELL + leg.move;
  const c = tt.at(0, end - 0.05);
  assert.ok(c.v < 2, `slow arrival, v=${c.v}`); assert.ok(Math.abs(c.s - 400) < 0.1);
  assert.equal(tt.at(0, end + 0.01).stop, 2);
});

test('positions move forward continuously round the whole loop', () => {
  const tt = line();
  let prev = tt.at(1, 0).s, total = 0;
  for (let t = 0.05; t <= tt.period + 1e-6; t += 0.05) {
    const s = tt.at(1, t).s, ds = ((s - prev) % 1000 + 1000) % 1000;
    assert.ok(ds <= 50 * 0.05 + 1e-6, `jump of ${ds} at t=${t}`);
    total += ds; prev = s;
  }
  assert.ok(Math.abs(total - 1000) < 0.5, `one period is one lap, got ${total}`);
});

test('buses are spread evenly in time', () => {
  const tt = line();
  const p = tt.period;
  assert.ok(Math.abs(tt.phaseOf(1, 0) - p / 3) < 1e-9);
  assert.deepEqual(tt.at(1, 10), tt.at(0, 10 + p / 3));
});

test('nextAt: the wait for the next bus, 0 while one is at the stop', () => {
  const tt = line();
  for (const t of [0, 3.3, 17, 60.2, 130, 400.7]) {
    for (let i = 0; i < 4; i++) {
      const n = tt.nextAt(i, t);
      if (n.wait === 0) { assert.equal(tt.at(n.bus, t).stop, i); continue; }
      assert.equal(tt.at(n.bus, t + n.wait + 0.01).stop, i, `bus ${n.bus} at stop ${i} after ${n.wait}s`);
      for (let b = 0; b < 3; b++) for (let dt = 0.25; dt < n.wait - 0.01; dt += 0.25) assert.notEqual(tt.at(b, t + dt).stop, i);
    }
  }
});

test('bad lines are refused', () => {
  assert.throws(() => makeTimetable({ length: 100, stops: [10, 5], speed: 50, buses: 1 }));
  assert.throws(() => makeTimetable({ length: 0, stops: [0], speed: 50, buses: 1 }));
});

test('clock: whole-second Date answers pin the offset to about the round trip', async () => {
  const skew = 3725.4;            // server is 3.7254 s ahead
  let local = 1_000_000;
  const now = () => local;
  const sleep = async ms => { local += ms; };
  const fetchDate = async () => { local += 20; const server = local + skew; local += 20; return { date: Math.floor(server / 1000) * 1000, age: 0 }; };
  const { offset, samples } = await syncClock({ fetchDate, now, sleep, count: 12, gap: 130 });
  assert.equal(samples, 12);
  assert.ok(Math.abs(offset - skew) < 60, `offset ${offset} vs ${skew}`);
});

test('clock: no answers means no correction; inconsistent ones fall back to a median', () => {
  assert.equal(offsetFromSamples([]), 0);
  const m = offsetFromSamples([{ t0: 0, t1: 10, lo: 5000, hi: 6000 }, { t0: 0, t1: 10, lo: 0, hi: 1000 }, { t0: 0, t1: 10, lo: 5000, hi: 6000 }]);
  assert.ok(m > 4000 && m < 6000);
});

test('riders: boarding order decides who stays when a bus overfills', () => {
  const r = (id, since, bus = 0, line = '1314') => ({ id, ride: { line, bus, since } });
  const list = [r('b', 2), r('a', 2), r('c', 1), r('x', 0, 1), r('y', 0, 0, '520'), { id: 'walker', ride: null }];
  assert.deepEqual(ridersOn(list, '1314', 0).map(q => q.id), ['c', 'a', 'b']);
  assert.equal(hasRoom(list, '1314', 0, 3), false);
  assert.equal(hasRoom(list, '1314', 0, 4), true);
  assert.equal(isBumped(list, '1314', 0, 2, 'b'), true);
  assert.equal(isBumped(list, '1314', 0, 2, 'a'), false);
  assert.equal(isBumped(list, '1314', 0, 2, 'walker'), false);
});
