// Pointer roles and intents for the 梦想人生 scene (public/dream/js/input/gestures.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGestures } from '../public/dream/js/input/gestures.js';

function rig() {
  const log = { look: [], zoom: [], tap: [], stick: [] };
  const g = createGestures({
    splitY: () => 400,
    look: (dx, dy) => log.look.push([dx, dy]), zoom: f => log.zoom.push(f), tap: (x, y) => log.tap.push([x, y]), stick: s => log.stick.push(s),
  });
  let t = 0;
  const at = (id, x, y, mouse = false) => ({ id, x, y, t: (t += 16), mouse });
  return { g, log, at, wait: ms => { t += ms; } };
}
const sum = a => a.reduce((s, [x, y]) => [s[0] + x, s[1] + y], [0, 0]);

test('a finger in the top half drags the view', () => {
  const { g, log, at } = rig();
  g.down(at(1, 200, 100));
  for (let i = 1; i <= 5; i++) g.move(at(1, 200 + i * 20, 100));
  g.up(at(1, 300, 100));
  assert.deepEqual(sum(log.look), [100, 0], 'every step past the tap slop turns the view');
  assert.equal(log.tap.length, 0);
  assert.equal(log.stick.length, 0);
});

test('a finger in the bottom half is a floating stick: dead zone, direction, ring clamp, release', () => {
  const { g, log, at } = rig();
  g.down(at(1, 200, 600));
  assert.deepEqual(log.stick.at(-1), { ox: 200, oy: 600, kx: 0, ky: 0, x: 0, y: 0, amount: 0 });
  g.move(at(1, 200, 595));                                          // 5 px: inside the dead zone
  assert.equal(log.stick.at(-1).amount, 0);
  g.move(at(1, 200, 572));                                          // half way up: forward
  const s = log.stick.at(-1);
  assert.deepEqual([s.x, s.y], [0, 1]);
  assert.ok(s.amount > 0.3 && s.amount < 0.5);
  g.move(at(1, 400, 600));                                          // far right: clamped to the ring, full push
  const f = log.stick.at(-1);
  assert.deepEqual([Math.round(f.kx), Math.round(f.ky), f.x, f.amount], [56, 0, 1, 1]);
  g.up(at(1, 400, 600));
  assert.equal(log.stick.at(-1), null);
  assert.equal(log.look.length, 0);
});

test('a stick dragged up into the top half stays a stick', () => {
  const { g, log, at } = rig();
  g.down(at(1, 200, 450));
  g.move(at(1, 200, 300));
  assert.equal(log.stick.at(-1).y, 1);
  assert.equal(log.look.length, 0);
});

test('stick and view at the same time, one finger each', () => {
  const { g, log, at } = rig();
  g.down(at(1, 100, 650));                                          // thumb on the stick
  g.down(at(2, 300, 150));                                          // finger on the view
  g.move(at(1, 100, 610));
  for (let i = 1; i <= 4; i++) g.move(at(2, 300 + i * 15, 150));
  assert.ok(log.stick.at(-1).amount > 0.5, 'still walking');
  assert.ok(sum(log.look)[0] > 0, 'and turning');
  assert.equal(log.zoom.length, 0, 'not a pinch');
});

test('two fingers in the top half pinch to zoom, never drag or tap, until both are up', () => {
  const { g, log, at } = rig();
  g.down(at(1, 200, 200)); g.down(at(2, 300, 200));
  g.move(at(1, 150, 200)); g.move(at(2, 350, 200));                 // apart: zoom in
  assert.ok(log.zoom.reduce((a, b) => a * b, 1) < 0.6);
  g.up(at(1, 150, 200));
  for (let i = 1; i <= 4; i++) g.move(at(2, 350 + i * 40, 200));    // the other finger slides on
  g.up(at(2, 510, 200));
  assert.equal(log.look.length, 0);
  assert.equal(log.tap.length, 0);
});

test('a quick still touch is a tap in either half; a slow one is not', () => {
  const { g, log, at, wait } = rig();
  g.down(at(1, 200, 100)); g.up(at(1, 202, 101));
  g.down(at(2, 200, 600)); g.up(at(2, 200, 600));                   // bottom half: the stick flashes, then a tap
  g.down(at(3, 200, 100)); wait(600); g.up(at(3, 200, 100));
  assert.deepEqual(log.tap, [[202, 101], [200, 600]]);
});

test('the mouse always looks, wherever it is, and clicks are taps', () => {
  const { g, log, at } = rig();
  g.down(at(1, 200, 700, true));
  for (let i = 1; i <= 3; i++) g.move(at(1, 200 + i * 30, 700, true));
  g.up(at(1, 290, 700, true));
  g.down(at(1, 50, 700, true)); g.up(at(1, 50, 700, true));
  assert.ok(sum(log.look)[0] > 0);
  assert.equal(log.stick.length, 0);
  assert.deepEqual(log.tap, [[50, 700]]);
});

test('one jumpy event cannot whip the view round', () => {
  const { g, log, at } = rig();
  g.down(at(1, 200, 100)); g.move(at(1, 220, 100));
  g.move(at(1, 900, 100));
  assert.ok(Math.max(...log.look.map(([dx]) => dx)) <= 80);
});
