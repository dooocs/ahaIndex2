// Walk core of the 梦想人生 scene (public/dream/js/walk): collide-and-slide on a small planet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalkField, createController, shapes } from '../public/dream/js/walk/index.js';
import { normalize, addScaled, scale, tangent, cross, dot } from '../public/dream/js/walk/vec.js';

const R = 50;
// one site whose local plane sits on the north pole: x → +X, z → +Z
const SITE = { dir: { x: 0, y: 1, z: 0 }, ex: { x: 1, y: 0, z: 0 }, ez: { x: 0, y: 0, z: 1 } };
const at = (x, z) => normalize(addScaled(addScaled(scale(SITE.dir, R), SITE.ex, x), SITE.ez, z));
const heading = (p, dx, dz) => normalize(tangent(p, addScaled(scale(SITE.ex, dx), SITE.ez, dz)));
const pose = (x, z, dx, dz) => { const p = at(x, z); return { p, f: heading(p, dx, dz) }; };

function world({ water = -Infinity, terrain = () => 0 } = {}) {
  return createWalkField({ radius: R, water }).setTerrain(terrain);
}
/** Hold "forward" for `secs` at `fps`, like the keyboard loop does (0.2 rad/s). */
function walk(ctl, ps, secs, { fps = 60, speed = 0.2, strafe = 0 } = {}) {
  const dt = 1 / fps;
  for (let i = 0; i < secs * fps; i++) ps = ctl.move(ps, { forward: speed * dt, strafe: strafe * dt });
  return ps;
}

test('walking straight into a building stops at its wall, never inside', () => {
  const f = world().footprint(SITE, shapes.box(-2, 2, -6, -2));
  const ctl = createController(f);
  const end = walk(ctl, pose(0, 3, 0, -1), 3);
  const p = f.local(SITE, end.p);
  assert.ok(f.clearance(end.p) >= 0, 'ended outside');
  assert.ok(p.z > -2 && p.z < -1.7, `stopped right at the wall (z=${p.z.toFixed(3)})`);
});

test('walking into a wall at an angle slides along it instead of stopping', () => {
  const f = world().footprint(SITE, shapes.box(-20, 20, -6, -2));
  const ctl = createController(f);
  const start = pose(0, 0, 1, -1);                       // 45° into the long wall
  const end = walk(ctl, start, 2);                      // ~14 units of wall: stays short of its far end
  const p = f.local(SITE, end.p);
  assert.ok(f.clearance(end.p) >= 0);
  assert.ok(p.x > 5, `kept moving along the wall (x=${p.x.toFixed(2)})`);
  assert.ok(Math.abs(p.z - -1.9) < 0.1, `hugging the wall (z=${p.z.toFixed(3)})`);
});

test('sliding off the end of a wall rounds the corner and carries on', () => {
  const f = world().footprint(SITE, shapes.box(-4, 0, -6, -2));
  const ctl = createController(f);
  const end = walk(ctl, pose(1.5, 1, -1, -1), 1.2);      // hits the front, slides to the corner, goes round
  const p = f.local(SITE, end.p);
  assert.ok(f.clearance(end.p) >= 0);
  assert.ok(p.x < -5 && p.z < -4, `got past the building (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
});

test('a concave corner holds you, and you can always back out of it', () => {
  const f = world().footprint(SITE, shapes.box(-6, 6, -6, -2)).footprint(SITE, shapes.box(2, 6, -6, 6));
  const ctl = createController(f);
  let ps = walk(ctl, pose(0, 2, 1, -1), 4);              // drive into the inside corner
  const stuck = f.local(SITE, ps.p);
  assert.ok(f.clearance(ps.p) >= 0);
  assert.ok(stuck.x > 1.5 && stuck.z > -2 && stuck.z < -1.5, `wedged in the corner (${stuck.x.toFixed(2)}, ${stuck.z.toFixed(2)})`);
  ps = walk(ctl, ps, 1, { speed: -0.2 });                // back out
  const out = f.local(SITE, ps.p);
  assert.ok(Math.hypot(out.x - stuck.x, out.z - stuck.z) > 2, 'backed away');
});

test('starting inside a footprint (e.g. an autopilot stop) never locks: any input gets you out', () => {
  const f = world().footprint(SITE, shapes.circle(0, 0, 1.3));
  const ctl = createController(f);
  for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const start = pose(0.3, 0.2, dx, dz);                // inside the fountain, facing any way
    assert.ok(f.clearance(start.p) < 0);
    const end = walk(ctl, start, 1.5);
    assert.ok(f.clearance(end.p) >= 0, `escaped when facing (${dx}, ${dz})`);
  }
});

test('a thin railing cannot be tunnelled through at low fps or by a long drag', () => {
  const rail = shapes.polyline([[-10, 0], [10, 0]], 0.1);
  const f = world().barrier(SITE, rail);
  const ctl = createController(f);
  let ps = walk(ctl, pose(0, 2, 0, -1), 3, { fps: 12 });  // 12 fps: 0.83 units per frame
  assert.ok(f.local(SITE, ps.p).z > 0, 'low fps: still on the near side');
  ps = ctl.move(pose(0, 2, 0, -1), { forward: 0.3 });    // one drag of 15 units
  assert.ok(f.local(SITE, ps.p).z > 0, 'long drag: still on the near side');
});

test('a gap in the railing lets you through', () => {
  const f = world()
    .barrier(SITE, shapes.polyline([[-10, 0], [-1.2, 0]], 0.1))
    .barrier(SITE, shapes.polyline([[1.2, 0], [10, 0]], 0.1));
  const ctl = createController(f);
  const end = walk(ctl, pose(0, 2, 0, -1), 2);
  assert.ok(f.local(SITE, end.p).z < -3);
});

test('decks carry you over water; stepping off the side slides along the edge', () => {
  const f = world({ water: -0.55, terrain: () => -1 });   // water everywhere
  const dk = f.deck(SITE, [0, 4], [0, -8], 0.42, 0, -0.13);
  const ctl = createController(f);
  assert.ok(f.surfaceH(at(0, 0)) === dk.heightAt(0.5));
  let ps = walk(ctl, pose(0, 3, 0, -1), 1.5);
  assert.ok(f.local(SITE, ps.p).z < -2, 'walked along the deck');
  ps = walk(ctl, pose(0, 3, 1, -1), 1.5);                // veer toward the water
  const p = f.local(SITE, ps.p);
  assert.ok(Math.abs(p.x) < 0.42 && p.z < -2, `kept on the deck, slid along it (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
});

test('turn > 0 turns right (toward heading × up), matching the old planet-yaw convention', () => {
  const f = world();
  const ctl = createController(f);
  const ps = pose(0, 0, 0, -1);
  const right = cross(ps.f, ps.p);
  const r = ctl.move(ps, { turn: 0.3 });
  assert.ok(dot(r.f, right) > 0.29);
});

test('advanced reports the arc covered along the heading (drives the sky drift)', () => {
  const ctl = createController(world());
  const r = ctl.move(pose(0, 0, 0, -1), { forward: 0.01 });
  assert.ok(Math.abs(r.advanced - 0.01) < 1e-9);
});

test('inFootprint keeps the old square-cornered footprint test for scatter', () => {
  const f = world().footprint(SITE, shapes.box(-1, 1, -1, 1)).footprint(SITE, shapes.circle(5, 0, 1));
  assert.equal(f.inFootprint(at(1.1, 1.1), 0.15), true);   // corner region of the grown square
  assert.equal(f.inFootprint(at(1.2, 0), 0.15), false);
  assert.equal(f.inFootprint(at(5, 1.1), 0.15), true);
  assert.equal(f.inFootprint(at(5, 1.2), 0.15), false);
});
