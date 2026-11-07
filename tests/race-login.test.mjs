import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

function board() {
  const events = new EventTarget(), parent = {}, calls = [], storage = new Map();
  const context = vm.createContext({
    addEventListener: events.addEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events), Event,
    location: { origin: 'https://www.amazingindex.com' }, parent,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    crypto: webcrypto, TextEncoder, Uint8Array, AbortSignal, setTimeout() {},
    async fetch(url, options) { calls.push({ url, options }); return { ok: true, status: options.method === 'POST' ? 201 : 200, json: async () => [] }; },
  });
  vm.runInContext(readFileSync(new URL('../public/race/js/board.js', import.meta.url), 'utf8').replace(/export /g, ''), context);
  const message = (data, origin = context.location.origin, source = parent) => {
    const event = new Event('message');
    Object.assign(event, { data, origin, source }); events.dispatchEvent(event);
  };
  message({ type: 'race:config', rest: { url: 'https://example.test', key: 'public-key' } });
  return { context, calls, message, events };
}

test('guests keep local results and read the leaderboard, but cannot upload', async () => {
  const { context, calls } = board();
  context.saveLocalBest(180, 89);
  assert.equal(context.localBest().total, 180);
  await context.top();
  assert.equal(calls.length, 1);
  await assert.rejects(context.submit({ nick: '游客', laps: [89, 91] }), /login_required/);
  assert.equal(calls.length, 1);
});

test('only parent auth messages enable uploads, and signing out disables them again', async () => {
  const { context, calls, message, events } = board();
  let changes = 0;
  events.addEventListener('race:authchange', () => changes++);
  message({ type: 'race:auth', signedIn: true }, 'https://other.test');
  message({ type: 'race:auth', signedIn: true }, undefined, {});
  assert.equal(vm.runInContext('signedIn()', context), false);
  message({ type: 'race:auth', signedIn: true });
  message({ type: 'race:auth', signedIn: true });
  assert.equal(changes, 1);
  await context.submit({ nick: '玩家', laps: [89, 91] });
  assert.equal(calls[0].options.method, 'POST');
  message({ type: 'race:auth', signedIn: false });
  await assert.rejects(context.submit({ nick: '玩家', laps: [89, 91] }), /login_required/);
  assert.equal(calls.filter(c => c.options.method === 'POST').length, 1);
});
