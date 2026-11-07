import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../public/dream/vendor/three-r170/three.module.min.js';
import { createTour, LANDMARKS, TOUR, TOUR_DURATION } from '../public/race/js/tour.js';
import * as LY from '../public/race/js/layout.js';

// Use the game's bundled Three.js and actual course without adding a runtime dependency.
const vendor = new URL('../public/dream/vendor/three-r170/three.module.min.js', import.meta.url).href;
const source = readFileSync(new URL('../public/race/js/track.js', import.meta.url), 'utf8').replace("'three'", JSON.stringify(vendor));
const { Track } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const track = new Track(LY.CENTERLINE, LY.ROAD_WIDTH), start = track.dAt(...LY.START_AT);
const ground = (x, z) => 60 * Math.sin(x / 120) * Math.cos(z / 120);
const tour = createTour(track, ground, start);

test('the drone completes a rounded rectangle and loops without a cut', () => {
  const flightStart = TOUR.overview + TOUR.descend;
  for (const t of [TOUR.overview, flightStart, flightStart + TOUR.lap, flightStart + TOUR.lap + TOUR.ascend, TOUR_DURATION]) {
    const a = tour.sample(t - 0.0001), b = tour.sample(t + 0.0001);
    for (const key of ['position', 'look']) assert.ok(Math.hypot(...a[key].map((v, i) => v - b[key][i])) < 0.1, `cut at ${t}`);
  }
  const positions = [];
  for (let i = 0; i <= 100; i++) {
    const shot = tour.sample(flightStart + TOUR.lap * i / 100);
    positions.push(shot.position);
    assert.ok(shot.position[1] >= ground(shot.position[0], shot.position[2]) + 204.99);
    assert.ok([...shot.position, ...shot.look].every(Number.isFinite));
  }
  // 四边各有长直线，三台山的三个发卡弯不会传到无人机航线。
  const [x0, z0, x1, z1] = tour.bounds;
  for (const [axis, value] of [[0, x0 + 100], [0, x1 - 100], [2, z0 + 100], [2, z1 - 100]]) {
    assert.ok(positions.filter(p => Math.abs(p[axis] - value) < 0.001).length >= 5);
  }
  for (const p of positions) assert.ok(p[0] >= x0 + 99.99 && p[0] <= x1 - 99.99 && p[2] >= z0 + 99.99 && p[2] <= z1 - 99.99);
});

test('portrait overview pulls back and markers use existing scenery coordinates', () => {
  assert.ok(tour.sample(0, 390 / 844).position[1] > tour.sample(0, 16 / 9).position[1]);
  assert.deepEqual(LANDMARKS.find(s => s.name === '雷峰塔').at, LY.LEIFENG);
  assert.deepEqual(LANDMARKS.find(s => s.name === '苏堤').at, LY.SUDI[2]);
  assert.deepEqual(LANDMARKS.find(s => s.name === '三潭印月').at, LY.SANTAN[1]);
  assert.deepEqual(tour.sample(0), tour.sample(TOUR_DURATION));
});

test('overview holds for one second only and fits the entire course with tighter framing', () => {
  assert.equal(TOUR.overview, 1);
  assert.equal(tour.sample(0.999).phase, 'overview');
  assert.equal(tour.sample(1.001).phase, 'descend');
  assert.equal(tour.sample(TOUR_DURATION - 0.01).phase, 'ascend');
  assert.ok(tour.sample(0, 2).position[1] < 1150);
  for (const aspect of [2, 16 / 9, 1, 390 / 844]) {
    const shot = tour.sample(0, aspect), camera = new THREE.PerspectiveCamera(58, aspect, 0.5, 6000);
    camera.position.fromArray(shot.position); camera.lookAt(...shot.look); camera.updateMatrixWorld();
    for (let i = 0; i < track.N; i += 5) {
      const p = new THREE.Vector3(track.px[i], track.py[i], track.pz[i]).project(camera);
      assert.ok(Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.94, `course clipped at ${aspect}, ${i}`);
      assert.ok(track.px[i] > tour.bounds[0] && track.px[i] < tour.bounds[2]);
      assert.ok(track.pz[i] > tour.bounds[1] && track.pz[i] < tour.bounds[3]);
    }
  }
  assert.equal(tour.sample(0).reveal, 1);
  assert.equal(tour.sample(TOUR.overview + TOUR.descend + 10).reveal, 0);
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
