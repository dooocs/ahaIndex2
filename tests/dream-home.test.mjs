import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../public/dream/vendor/three-r170/three.module.min.js';
import { createWalkField } from '../public/dream/js/walk/field.js';
import * as shapes from '../public/dream/js/walk/shapes.js';
import { createPatrol, HOME_LOOP, POOL_WALK } from '../public/dream/js/home/patrol.js';
import { RESIDENTS, createResidents } from '../public/dream/js/home/residents.js';

const html = await readFile(new URL('../public/dream/app.html', import.meta.url), 'utf8');
const between = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const HOME = { dir: new THREE.Vector3(0, 1, 0), ex: new THREE.Vector3(1, 0, 0), ez: new THREE.Vector3(0, 0, 1), roadZ: 6 };
const R = 200, L = (s, x, z) => s.dir.clone().multiplyScalar(R).addScaledVector(s.ex, x).addScaledVector(s.ez, z).normalize();
const LT = (s, x, z) => s.ex.clone().multiplyScalar(x).addScaledVector(s.ez, z);
// Read the shipped layout and collision declarations, so a changed bench, pool or tower
// really affects this check. This is not a separately maintained copy of the obstacles.
const definitions = between('const HOME_FENCE =', '// 天街');
function homeField() {
  const field = createWalkField({ radius: R, water: -0.55, bodyRadius: 0.1 });
  const box = (site, x0, x1, z0, z1, h) => field.footprint(site, shapes.box(x0, x1, z0, z1), { h });
  const disc = (site, x, z, r, h) => field.footprint(site, shapes.circle(x, z, r), { h });
  const obstacles = between('  TOWERS.forEach(([x, z], i) => box(HOME', '  box(MALL,');
  const rail = between('  // the courtyard railing is the same polyline', '\n}\nconst inFence');
  new Function('HOME', 'box', 'disc', 'walk', 'shapes', definitions + obstacles + rail)(HOME, box, disc, field, shapes);
  return field;
}

test('residents stay on dry, unobstructed paths for the full patrol cycle', () => {
  const field = homeField();
  for (const npc of RESIDENTS) {
    const patrol = npc.path && createPatrol(npc.path, npc);
    for (let t = 0; t <= (patrol?.duration || 0); t += 0.1) {
      const p = patrol ? patrol.at(t) : { x: npc.at[0], z: npc.at[1] };
      assert.ok(field.clearance(L(HOME, p.x, p.z)) >= 0, `${npc.role} hits an obstacle at ${p.x}, ${p.z}`);
    }
  }
  for (let z = 4; z >= -2.4; z -= 0.1) assert.ok(field.clearance(L(HOME, 0, z)) >= 0, 'arrival axis stays open');
  assert.ok(field.clearance(L(HOME, 0, -5.5)) < 0, 'reflecting pool blocks walking');
  assert.ok(field.clearance(L(HOME, -13.5, -15)) >= 0, 'open pavilion is enterable');
});

test('patrol pauses, travels by distance and rejoins its start without frame-dependent drift', () => {
  const p = createPatrol([[0, 0], [4, 0], [4, 3], [0, 3]], { speed: 2, rest: 3 });
  assert.equal(p.length, 14);
  assert.equal(p.at(2).moving, false);
  assert.equal(p.at(4).x, 2);
  assert.deepEqual(p.at(1), p.at(p.duration + 1));
  assert.ok(Math.hypot(p.at(p.duration - 1e-6).x, p.at(p.duration - 1e-6).z) < 1e-4);
  for (const route of [HOME_LOOP, POOL_WALK]) {
    const patrol = createPatrol(route);
    for (let i = 0; i < 400; i++) {
      const at = patrol.at(i * 0.37);
      assert.ok(Object.values(at).every(v => typeof v === 'boolean' || Number.isFinite(v)));
      assert.ok(Math.abs(Math.hypot(at.dx, at.dz) - 1) < 1e-6);
    }
  }
});

test('invalid patrol routes and timings are rejected', () => {
  for (const pts of [[], [[0, 0]], [[0, 0], [0, 0]], [[0, 0], [NaN, 1]]]) assert.throws(() => createPatrol(pts));
  assert.throws(() => createPatrol(HOME_LOOP, { speed: 0 }));
  assert.throws(() => createPatrol(HOME_LOOP, { rest: -2 }));
});

test('home builders produce finite 3D geometry within a bounded triangle budget', () => {
  const geos = [], objects = [], heroTrees = [], field = homeField();
  const mesh = (g, hex) => new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: hex }));
  const prep = g => { const n = g.index ? g.toNonIndexed() : g; if (n.attributes.uv) n.deleteAttribute('uv'); return n; };
  const pushGeo = g => geos.push(g), addObj = o => objects.push(o);
  const frame = between('const UP = new THREE.Vector3', '// ---------- geometry helpers');
  const kit = between('function kit(s,', 'function signMesh(');
  const builders = between('// ---------- 云栖府:', '// ---------- 天街:');
  const f = new Function('THREE', 'HOME', 'R', 'L', 'LT', 'terrainH', 'prep', 'pushGeo', 'addObj', 'toon', 'planet', 'signMesh', 'G_OPTS', 'buildCar', 'heroTrees', 'polyD', 'walk', 'HOME_PATHS',
    definitions + frame + 'const addAt = (geo, hex, opts, m) => pushGeo(prep(geo).applyMatrix4(m));\n' + kit + builders + '\nbuildHome();');
  f(THREE, HOME, R, L, LT, () => 0.05, prep, pushGeo, addObj, hex => new THREE.MeshBasicMaterial({ color: hex }), { add: addObj },
    (text, w, h) => mesh(new THREE.PlaneGeometry(w, h), 0xffffff), {}, () => new THREE.Group(), heroTrees,
    (p, points) => Math.min(...points.slice(1).map((b, i) => { const a = points[i], dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.z - a[1]) * dz) / (dx * dx + dz * dz))); return Math.hypot(p.x - a[0] - t * dx, p.z - a[1] - t * dz); })), field, [HOME_LOOP, POOL_WALK]);
  let triangles = 0;
  const check = g => {
    const positions = g.attributes.position.array;
    for (const v of positions) assert.ok(Number.isFinite(v));
    triangles += (g.index?.count || g.attributes.position.count) / 3;
  };
  geos.forEach(check); objects.forEach(o => o.traverse(m => { if (m.geometry) check(m.geometry); }));
  assert.ok(geos.length > 400, 'built detailed façades and landscaping');
  assert.ok(triangles < 50000, `geometry budget: ${triangles} triangles`);
  assert.ok(heroTrees.length > 10, 'planted garden trees');
});

// A tiny DOM fixture suffices for the residents' controls; three.js still performs
// their real transforms. No browser or WebGL context is required for this test.
class Element {
  constructor() { this.listeners = new Map(); this.children = []; this.style = {}; this.hidden = false; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type, fn) { if (this.listeners.get(type) === fn) this.listeners.delete(type); }
  setAttribute() {}
  append(...nodes) { this.children.push(...nodes); nodes.forEach(n => { if (typeof n !== 'string') n.parent = this; }); }
  remove() { this.parent.children = this.parent.children.filter(n => n !== this); }
  focus() {}
}
test('greeting pauses a resident, close resumes, leaving home hides labels and disposal cleans up', () => {
  const els = Object.fromEntries(['home-npc-tags', 'home-note', 'home-note-close', 'home-note-name', 'home-note-text'].map(id => [id, new Element()]));
  const oldDocument = globalThis.document;
  globalThis.document = { getElementById: id => els[id], createElement: () => new Element() };
  globalThis.innerWidth = 1200; globalThis.innerHeight = 800;
  const planet = new THREE.Group();
  let player = L(HOME, 80, 40);
  const avatar = () => ({ root: new THREE.Group(), body: new THREE.Group(), armL: { rotation: {} }, armR: { rotation: {} } });
  try {
    const residents = createResidents({ planet, site: HOME, ground: L, tangent: LT, makeAvatar: avatar, poseAvatar() {}, radius: R, surfaceHeight: () => 0.05, playerDirection: () => player });
    residents.update(0); residents.update(0.05);
    assert.equal(planet.children.length, 6);
    const neighbor = planet.children[1], tag = els['home-npc-tags'].children[1];
    player = neighbor.position.clone().normalize();
    tag.listeners.get('click')({ stopPropagation() {} });
    assert.equal(els['home-note'].hidden, false);
    const at = neighbor.position.clone();
    residents.update(0.1); residents.update(0.15);
    assert.ok(at.distanceTo(neighbor.position) < 1e-9, 'stops while greeting');
    els['home-note-close'].listeners.get('click')();
    player = L(HOME, 80, 40); residents.update(0.2); residents.update(0.25);
    assert.ok(at.distanceTo(neighbor.position) > 0.01, 'resumes patrol');
    const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000); camera.position.set(0, 210, 14); camera.lookAt(0, 200, 0); camera.updateMatrixWorld(); planet.updateMatrixWorld();
    residents.placeTags(camera, 0);
    assert.ok(els['home-npc-tags'].children.every(t => t.hidden), 'no labels elsewhere on the planet');
    residents.dispose();
    assert.equal(planet.children.length, 0);
    assert.equal(els['home-npc-tags'].children.length, 0);
    assert.equal(els['home-note-close'].listeners.size, 0);
    assert.equal(els['home-note'].hidden, true);
  } finally { globalThis.document = oldDocument; delete globalThis.innerWidth; delete globalThis.innerHeight; }
});
