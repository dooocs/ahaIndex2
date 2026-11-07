import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { readQuality, qualityProfile, bindQualityButton } from '../public/race/js/quality.js';

const source = name => readFileSync(new URL(`../public/race/js/${name}.js`, import.meta.url), 'utf8');
function button() {
  return {
    attrs: {}, handlers: {}, textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(k, v) { this.handlers[k] = v; },
    blur() { this.blurred = true; },
    click() { this.handlers.click(); },
  };
}
function storage(value) {
  return { getItem: () => value, setItem(k, v) { value = v; }, get value() { return value; } };
}

test('preferences restore on a new visit; explicit test URLs override without writing', () => {
  const saved = storage('low');
  assert.equal(readQuality(new URLSearchParams(), saved), 'low');
  for (const query of ['quality=high', 'quality=standard']) assert.equal(readQuality(new URLSearchParams(query), saved), 'standard');
  assert.equal(saved.value, 'low');
  assert.equal(readQuality(new URLSearchParams('quality=low'), storage('standard')), 'low');
  assert.equal(readQuality(new URLSearchParams(), storage('invalid')), 'standard');
});

test('blocked storage never prevents the initial view or repeated switches', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  const b = button(), applied = [];
  const control = bindQualityButton(b, readQuality(new URLSearchParams(), blocked), m => applied.push(m), blocked);
  b.click(); b.click(); b.click();
  assert.equal(control.mode, 'low');
  assert.deepEqual(applied, ['standard', 'low', 'standard', 'low']);
  assert.equal(b.attrs['aria-pressed'], 'true');
  assert.match(b.attrs['aria-label'], /流畅.*标准/);
  assert.equal(b.blurred, true);
});

test('low profile limits rendering pixels on Retina and large screens; standard restores device settings', () => {
  for (const [width, height] of [[390, 844], [1920, 1080], [3840, 2160]]) {
    const p = qualityProfile('low', { width, height, dpr: 3 });
    assert.ok(p.pixelRatio <= 1);
    assert.ok(width * height * p.pixelRatio ** 2 <= 1440 * 900 + 1);
    assert.equal(p.shadows, false); assert.equal(p.samples, 0); assert.equal(p.grain, false);
    assert.equal(p.smokeLimit, 90); assert.ok(p.lodScale < 1);
  }
  assert.equal(qualityProfile('standard', { dpr: 3 }).pixelRatio, 2);
  assert.equal(qualityProfile('standard', { dpr: 3, coarse: true }).pixelRatio, 1.5);
  assert.equal(qualityProfile('standard', { dpr: 1 }).pixelRatio, 1);
});

test('actual game wiring switches immediately, restores shadows including multi-material meshes, and preserves the race', () => {
  const main = source('main'), saved = storage('standard'), b = button();
  const materials = [{ needsUpdate: false }, { needsUpdate: false }];
  const calls = [], race = { lap: 2, time: 45, speed: 38, drift: true };
  const ctx = vm.createContext({
    readQuality, qualityProfile, bindQualityButton,
    Q: new URLSearchParams(), localStorage: saved,
    window: { devicePixelRatio: 2 }, matchMedia: () => ({ matches: false }), innerWidth: 1920, innerHeight: 1080,
    renderer: { shadowMap: { enabled: true }, setPixelRatio(v) { this.pr = v; }, setSize() {} },
    camera: { updateProjectionMatrix() {} },
    scene: { traverse(fn) { fn({ material: materials }); } },
    post: { setQuality(p) { calls.push(p); }, setSize() {} },
    smoke: { setLimit(n) { this.limit = n; } },
    document: { documentElement: { style: { setProperty() {} } } },
    slow: 3, frames: 12, fpsT: 50, race,
    addEventListener() {}, $: () => b,
  });
  vm.runInContext(main.slice(main.indexOf('let qualityMode'), main.indexOf('// ---------- 输入')), ctx);
  vm.runInContext("bindQualityButton($('quality'), qualityMode, applyQuality, localStorage);", ctx);
  b.click();
  assert.equal(ctx.renderer.shadowMap.enabled, false);
  assert.equal(ctx.smoke.limit, 90);
  assert.ok(ctx.renderer.pr < 1);
  assert.equal(vm.runInContext('lowTier', ctx), 2);
  assert.equal(ctx.slow, 0); assert.equal(ctx.frames, 0);
  assert.equal(b.textContent, '画质：流畅');
  assert.equal(readQuality(new URLSearchParams(), saved), 'low');
  b.click();
  assert.equal(ctx.renderer.shadowMap.enabled, true);
  assert.ok(materials.every(m => m.needsUpdate));
  assert.equal(ctx.renderer.pr, 2); assert.equal(ctx.smoke.limit, 260);
  assert.equal(calls.at(-1).samples, 4);
  assert.equal(vm.runInContext('lowTier', ctx), 0);
  assert.deepEqual(race, { lap: 2, time: 45, speed: 38, drift: true });
  b.click(); ctx.innerWidth = 3840; ctx.innerHeight = 2160;
  vm.runInContext('resize()', ctx);
  assert.ok(ctx.renderer.pr < 0.5);
});

test('post processing reallocates MSAA resources only on a mode change and restores paper texture', () => {
  const targets = [];
  class Target {
    constructor(w, h, opts = {}) { Object.assign(this, opts); this.texture = {}; this.disposals = 0; targets.push(this); }
    dispose() { this.disposals++; }
    setSize() {}
  }
  const THREE = {
    WebGLRenderTarget: Target, DepthTexture: class {},
    ShaderMaterial: class { constructor(opts) { Object.assign(this, opts); } },
    Vector2: class { set() {} }, Matrix4: class {}, Color: class {},
    Scene: class { add() {} }, OrthographicCamera: class {}, Mesh: class {}, PlaneGeometry: class {},
  };
  const ctx = vm.createContext({ THREE, G: { uInk: {} }, NOISE_GLSL: '' });
  const code = source('toon');
  vm.runInContext(code.slice(code.indexOf('export function createPost'), code.indexOf('// 把若干')).replace('export function', 'function'), ctx);
  const post = vm.runInContext('createPost({ near: 0.5, far: 2600 })', ctx);
  post.setQuality(qualityProfile('low')); post.setQuality(qualityProfile('low'));
  assert.equal(targets[0].samples, 0); assert.equal(targets[0].disposals, 1);
  assert.equal(post.post.uniforms.uGrain.value, 0);
  post.setQuality(qualityProfile('standard'));
  assert.equal(targets[0].samples, 4); assert.equal(targets[0].disposals, 2);
  assert.equal(post.post.uniforms.uGrain.value, 1);
});

test('smoke budget hides and clears removed instances before restoring them', () => {
  const ctx = vm.createContext({});
  vm.runInContext(source('effects').split('export class Smoke')[1].split('export class Skids')[0].replace(/^ \{/, 'class Smoke {') + '\nthis.Smoke = Smoke;', ctx);
  const smoke = Object.create(ctx.Smoke.prototype);
  Object.assign(smoke, {
    mesh: { count: 260, setMatrixAt() {}, instanceMatrix: {}, instanceColor: { setXYZ() {} } },
    p: Array.from({ length: 260 }, () => ({ life: 1 })), k: 259, zero: {},
  });
  smoke.setLimit(90);
  for (let i = 0; i < 300; i++) smoke.emit(0, 0, 0, 0, 1, 0);
  assert.ok(smoke.k < 90);
  assert.equal(smoke.mesh.count, 90);
  assert.ok(smoke.p.slice(90).every(p => p.life === 0));
  smoke.setLimit(260);
  assert.equal(smoke.mesh.count, 260);
  assert.ok(smoke.p.slice(90).every(p => p.life === 0));
});
