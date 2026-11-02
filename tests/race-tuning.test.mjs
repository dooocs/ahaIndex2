import test from 'node:test';
import assert from 'node:assert/strict';
import { TUNING_FIELDS, DEFAULT_TUNE, isAdvanced, applyTuning, advancedSearch, setTune, resetTune, tuningURL } from '../public/race/js/tuning.js';

test('normal links ignore tuning overrides, including after an advanced visit', () => {
  for (const search of ['', '?t.turn=4', '?advanced=0&t.turn=4', '?advanced=false&t.turn=4', '?advanced=no&t.turn=4']) {
    const values = { ...DEFAULT_TUNE };
    applyTuning(search, values);
    assert.equal(isAdvanced(search), false);
    assert.equal(advancedSearch(search), '');
    assert.deepEqual(values, DEFAULT_TUNE);
  }
  const advanced = { ...DEFAULT_TUNE };
  applyTuning('?advanced=1&t.turn=4', advanced);
  assert.equal(advanced.turn, 4);
  // A new page starts from the defaults, never a saved previous session.
  assert.equal(DEFAULT_TUNE.turn, 1.75);
});

test('explicit advanced links work on the static iframe wrapper and standalone game', () => {
  for (const flag of ['advanced', 'advanced=1', 'advanced=true']) {
    const search = `?${flag}&t.turn=2.2&t.brake=25&unknown=1&t.unknown=99`;
    const forwarded = advancedSearch(search);
    assert.equal(forwarded, '?advanced=1&t.brake=25&t.turn=2.2');
    const values = { ...DEFAULT_TUNE };
    applyTuning(forwarded, values);
    assert.equal(values.turn, 2.2);
    assert.equal(values.brake, 25);
    assert.equal(values.unknown, undefined);
  }
});

test('untrusted URL values cannot inject properties or non-finite physics values', () => {
  const values = { ...DEFAULT_TUNE };
  applyTuning('?advanced=1&t.vmax=0&t.vmaxBoost=1e300&t.turn=NaN&t.grip=Infinity&t.gravity=&t.brake=%20&t.__proto__=99', values);
  assert.equal(values.vmax, 10);
  assert.equal(values.vmaxBoost, 140);
  assert.equal(values.turn, DEFAULT_TUNE.turn);
  assert.equal(values.grip, DEFAULT_TUNE.grip);
  assert.equal(values.gravity, DEFAULT_TUNE.gravity);
  assert.equal(values.brake, DEFAULT_TUNE.brake);
  assert.equal(Object.getPrototypeOf(values), Object.prototype);
  for (const input of [undefined, null, {}, [], true, '', ' ', NaN, Infinity, '-Infinity']) assert.equal(setTune('turn', input, values), false);
  for (const key of ['__proto__', 'constructor', 'toString', 'unknown']) assert.equal(setTune(key, 5, values), false);
});

test('copy link round-trips every control and removes recording/test switches', () => {
  const values = { ...DEFAULT_TUNE };
  for (const f of TUNING_FIELDS) setTune(f.key, f.value === f.min ? f.max : f.min, values);
  const href = tuningURL('https://www.amazingindex.com/race?auto&go&laps=1&skipcount&cam=1,2,3&from=test&t.obsolete=4#game', values);
  const url = new URL(href);
  assert.equal(url.pathname, '/race');
  assert.equal(url.searchParams.get('from'), 'test');
  assert.equal(url.hash, '#game');
  for (const key of ['auto', 'go', 'laps', 'skipcount', 'cam', 't.obsolete']) assert.equal(url.searchParams.has(key), false);
  const reopened = { ...DEFAULT_TUNE };
  applyTuning(advancedSearch(url.search), reopened);
  assert.deepEqual(reopened, values);
  resetTune(values);
  assert.deepEqual(values, DEFAULT_TUNE);
  assert.equal(tuningURL('https://www.amazingindex.com/race', values), 'https://www.amazingindex.com/race?advanced=1');
});

test('the original player handling values remain the defaults', () => {
  // Captured from main before advanced mode: existing public links must retain this handling.
  const original = {
    latGrip: 22, vmax: 50, vmaxBoost: 72.2, accel: 16.2, nitroAccel: 27.7, brake: 40, reverseMax: 10, roll: 2,
    turn: 1.75, grip: 11, nitroTurn: 0.72, driftMin: 12, driftYaw: 1.35, driftYawAlign: 0.8, driftGrip: 1.9,
    driftRelease: 5.5, maxDrift: 1.1, driftDrag: 4.5, driftDragAngle: 12, driftDragSpeed: 0.3,
    driftThrottle: 0.3, gaugeRate: 0.3, nitroTime: 2.6, smallWindow: 0.5, gravity: 30,
  };
  for (const [key, value] of Object.entries(original)) assert.equal(DEFAULT_TUNE[key], value, key);
});
