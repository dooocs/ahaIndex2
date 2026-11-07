import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Sound } from '../public/race/js/audio.js';

class Param {
  value = 0;
  events = [];
  cancelScheduledValues(t) { this.events = this.events.filter(e => e.time < t); }
  setValueAtTime(value, time) { this.value = value; this.events.push({ type: 'value', value, time }); }
  setTargetAtTime(value, time) { this.events.push({ type: 'target', value, time }); }
}
class AudioNode {
  gain = new Param(); frequency = new Param(); Q = new Param(); delayTime = new Param();
  connect(node) { return node; }
  start() {}
}
class AudioContext {
  currentTime = 1; sampleRate = 10; destination = new AudioNode(); state = 'running';
  createGain() { return new AudioNode(); }
  createDelay() { return new AudioNode(); }
  createBiquadFilter() { return new AudioNode(); }
  createOscillator() { return new AudioNode(); }
  createBufferSource() { return new AudioNode(); }
  createBuffer() { return { getChannelData: () => new Float32Array(20) }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
}

function setup(t) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const previous = globalThis.window;
  globalThis.window = { AudioContext };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  return new Sound();
}

const main = readFileSync(new URL('../public/race/js/main.js', import.meta.url), 'utf8');
function controls(sound) {
  const classes = new Set();
  const handlers = {};
  const button = {
    classList: { toggle(name, value) { value ? classes.add(name) : classes.delete(name); }, remove(name) { classes.delete(name); } },
    addEventListener(type, handler) { handlers[type] = handler; },
    click() { handlers.click(); }, blur() {},
  };
  // Execute the actual event wiring without creating the unrelated WebGL world.
  vm.runInNewContext(main.slice(main.indexOf('// 每次进入页面先静音'), main.indexOf('function startRace()')), {
    sound, $: () => button, state: 'title',
    addEventListener(type, handler) { handlers[type] = handler; },
    localStorage: { getItem: () => '0', setItem() { throw new Error('storage blocked'); } },
  });
  return { button, classes, handlers };
}

test('visits and starting a muted race do not create or resume audio, even with an old enabled preference', t => {
  const sound = setup(t);
  const { classes } = controls(sound);
  assert.equal(sound.on, false);
  assert.ok(classes.has('off'));
  sound.start();
  assert.equal(sound.ctx, null);
});

test('speaker click enables audio, then immediately silences music, echo and effects through the master', t => {
  const sound = setup(t);
  const { button, classes } = controls(sound);
  button.click();
  assert.equal(sound.ctx.state, 'running');
  assert.equal(sound.on, true);
  assert.ok(!classes.has('off'));
  button.click();
  assert.equal(sound.on, false);
  assert.ok(classes.has('off'));
  assert.equal(sound.master.gain.value, 0);
  assert.deepEqual(sound.master.gain.events, [{ type: 'value', value: 0, time: 1 }]);
  const ctx = sound.ctx;
  sound.start();
  assert.equal(sound.ctx, ctx);
  assert.equal(sound.master.gain.value, 0);
});

test('rapid on/off cancels pending fade-ins and reopening reuses the audio graph', t => {
  const sound = setup(t);
  const { button } = controls(sound);
  button.click();
  const ctx = sound.ctx;
  for (let i = 0; i < 5; i++) { button.click(); button.click(); }
  button.click();
  assert.equal(sound.ctx, ctx);
  assert.equal(sound.master.gain.value, 0);
  assert.deepEqual(sound.master.gain.events, [{ type: 'value', value: 0, time: 1 }]);
  assert.equal(sound.on, false);
});

test('M toggles once per user gesture without waiting for an unpaused rendering frame', () => {
  const handlers = {};
  let clicks = 0;
  vm.runInNewContext(main.slice(main.indexOf("addEventListener('keydown'"), main.indexOf("addEventListener('keyup'")), {
    addEventListener(type, handler) { handlers[type] = handler; }, typing: () => false,
    MAP: { KeyM: 'mute' }, $: id => id === 'mute' ? { click() { clicks++; } } : { hidden: true },
  });
  handlers.keydown({ code: 'KeyM', repeat: false, preventDefault() {} });
  handlers.keydown({ code: 'KeyM', repeat: true, preventDefault() {} });
  assert.equal(clicks, 1);
});

test('leaving silences the retained audio graph so back/forward cache cannot resume music', t => {
  const sound = setup(t);
  const { button, classes, handlers } = controls(sound);
  button.click();
  handlers.pagehide();
  assert.equal(sound.on, false);
  assert.equal(sound.master.gain.value, 0);
  assert.ok(classes.has('off'));
  sound.start();
  assert.equal(sound.master.gain.value, 0);
});
