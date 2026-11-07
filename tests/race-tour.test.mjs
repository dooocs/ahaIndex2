import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createTour, LANDMARKS, TOUR, TOUR_DURATION } from '../public/race/js/tour.js';
import * as LY from '../public/race/js/layout.js';

// Use the game's bundled Three.js and actual course without adding a runtime dependency.
const vendor = new URL('../public/dream/vendor/three-r170/three.module.min.js', import.meta.url).href;
const source = readFileSync(new URL('../public/race/js/track.js', import.meta.url), 'utf8').replace("'three'", JSON.stringify(vendor));
const { Track } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const track = new Track(LY.CENTERLINE, LY.ROAD_WIDTH), start = track.dAt(...LY.START_AT);
const ground = (x, z) => 60 * Math.sin(x / 120) * Math.cos(z / 120);
const tour = createTour(track, ground, start);

test('the drone completes the real course and loops without a cut', () => {
  const flightStart = TOUR.overview + TOUR.descend;
  for (const t of [TOUR.overview, flightStart, flightStart + TOUR.lap, flightStart + TOUR.lap + TOUR.ascend, TOUR_DURATION]) {
    const a = tour.sample(t - 0.0001), b = tour.sample(t + 0.0001);
    for (const key of ['position', 'look']) assert.ok(Math.hypot(...a[key].map((v, i) => v - b[key][i])) < 0.1, `cut at ${t}`);
  }
  for (let i = 0; i <= 100; i++) {
    const shot = tour.sample(flightStart + TOUR.lap * i / 100);
    const s = track.sample(start + shot.progress * track.length);
    assert.ok(Math.hypot(shot.position[0] - s.x, shot.position[2] - s.z) <= 85.001);
    assert.ok(shot.position[1] >= ground(shot.position[0], shot.position[2]) + 204.99);
    assert.ok([...shot.position, ...shot.look].every(Number.isFinite));
  }
});

test('portrait overview pulls back and markers use existing scenery coordinates', () => {
  assert.ok(tour.sample(0, 390 / 844).position[1] > tour.sample(0, 16 / 9).position[1]);
  assert.deepEqual(LANDMARKS.find(s => s.name === '雷峰塔').at, LY.LEIFENG);
  assert.deepEqual(LANDMARKS.find(s => s.name === '苏堤').at, LY.SUDI[2]);
  assert.deepEqual(LANDMARKS.find(s => s.name === '三潭印月').at, LY.SANTAN[1]);
  assert.deepEqual(tour.sample(0), tour.sample(TOUR_DURATION));
});

test('start can interrupt any point of the tour and enters the normal countdown', () => {
  const main = readFileSync(new URL('../public/race/js/main.js', import.meta.url), 'utf8');
  const startRace = main.slice(main.indexOf('function startRace()'), main.indexOf('let lastCount = 4;'));
  for (const time of [0, 8, 30, 77]) {
    const elements = Object.fromEntries(['mute', 'title', 'hud', 'tour'].map(id => [id, { hidden: id === 'hud', classList: { remove() {} } }]));
    const ctx = { state: 'title', tourTime: time, countT: 0, Q: new URLSearchParams(), resets: 0,
      $: id => elements[id], sound: { start() {} }, canvas: { focus() {} }, syncMute() {},
    };
    ctx.resetRace = () => ctx.resets++;
    vm.runInNewContext(`${startRace}\nstartRace();`, ctx);
    assert.equal(ctx.state, 'count'); assert.equal(ctx.countT, 3.6); assert.equal(ctx.resets, 1);
    assert.equal(elements.title.hidden, true); assert.equal(elements.tour.hidden, true); assert.equal(elements.hud.hidden, false);
    assert.equal(ctx.tourTime, time);
  }
});
