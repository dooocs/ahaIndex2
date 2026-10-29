// Presence for the 梦想人生 scene (public/dream/js/net): who is online, deduped per visitor, with poses.
// Runs over the BroadcastChannel transport, which Node provides, with short heartbeats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresence, activityOf, IDLE_AFTER, AWAY_AFTER } from '../public/dream/js/net/presence.js';
import { createLocalConnect } from '../public/dream/js/net/local.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
let n = 0;
function world() {
  const connect = createLocalConnect({ name: `t${++n}`, heartbeat: 60, timeout: 250 });
  const made = [];
  const join = (id, extra = {}) => {
    const conns = [];
    const p = createPresence({ connect: k => { const c = connect(k); conns.push(c); return c; }, me: { id, g: 'm', prov: '浙江', ...extra } });
    p.setPlanet('hangzhou');
    p.start();
    p.conn = () => conns[conns.length - 1];
    made.push(p);
    return p;
  };
  return { join, done: () => made.forEach(p => p.stop()) };
}
const P = [0, 1, 0], F = [0, 0, -1];

test('two visitors see each other, with province, look and planet', async () => {
  const w = world();
  const a = w.join('a', { prov: '浙江' }), b = w.join('b', { g: 'f', prov: '广东', look: { g: 'f', h: 2, hc: 0, t: 3, b: 1, s: 4 } });
  await wait(80);
  assert.deepEqual(a.counts(), { online: 2, active: 2 });
  const [peer] = a.peers();
  assert.equal(peer.id, 'b'); assert.equal(peer.prov, '广东'); assert.equal(peer.g, 'f'); assert.equal(peer.planet, 'hangzhou');
  assert.deepEqual(peer.look, { g: 'f', h: 2, hc: 0, t: 3, b: 1, s: 4 }, 'look passes through');
  w.done();
});

test('one person in two tabs counts once', async () => {
  const w = world();
  const a1 = w.join('a'), a2 = w.join('a'), b = w.join('b');
  await wait(80);
  assert.equal(b.counts().online, 2);
  assert.equal(b.peers().length, 1);
  w.done();
});

test('poses stream while moving (throttled) and the resting pose lands in presence', async () => {
  const w = world();
  const a = w.join('a'), b = w.join('b');
  await wait(80);
  for (let i = 0; i < 10; i++) a.move([0, 1, -i / 100], F, true);      // 10 calls inside 200 ms → 1 message
  await wait(30);
  assert.deepEqual(b.peers()[0].p, [0, 1, 0]);
  await wait(220);
  a.move([0.1, 1, 0], F, true);
  await wait(30);
  assert.deepEqual(b.peers()[0].p, [0.1, 1, 0]);
  a.move([0.2, 1, 0], F, false);                                     // stopped: resting pose via presence
  const c = w.join('c');                                             // a newcomer sees where a stands
  await wait(120);
  assert.deepEqual(c.peers().find(p => p.id === 'a').p, [0.2, 1, 0]);
  w.done();
});

test('someone who joins and never moves still shows where they stand', async () => {
  const w = world();
  const a = w.join('a'), b = w.join('b');
  await wait(80);
  a.move([0.3, 1, 0], F, false);                                     // standing still from the start
  await wait(40);
  assert.deepEqual(b.peers()[0].p, [0.3, 1, 0]);
  w.done();
});

test('closing the tab leaves at once; losing the connection leaves after the heartbeat timeout', async () => {
  const w = world();
  const a = w.join('a'), b = w.join('b'), c = w.join('c');
  await wait(80);
  assert.equal(c.counts().online, 3);
  a.stop();
  await wait(30);
  assert.equal(c.counts().online, 2, 'a left straight away');
  b.conn().drop();                                                  // b's laptop lid closes
  await wait(80);
  assert.equal(c.counts().online, 2, 'not yet: still within the timeout');
  await wait(400);
  assert.equal(c.counts().online, 1, 'b timed out');
  w.done();
});

test('idle is shared and counted apart from active', async () => {
  const w = world();
  const a = w.join('a'), b = w.join('b');
  await wait(80);
  a.setActivity('idle');
  await wait(40);
  assert.deepEqual(b.counts(), { online: 2, active: 1 });
  assert.equal(b.peers()[0].act, 'idle');
  w.done();
});

test('switching planets is visible to others', async () => {
  const w = world();
  const a = w.join('a'), b = w.join('b');
  await wait(80);
  a.setPlanet('ski');
  await wait(40);
  assert.equal(b.peers()[0].planet, 'ski');
  w.done();
});

test('a late pose after someone left does not bring them back', async () => {
  const w = world();
  const a = w.join('a'), b = w.join('b');
  await wait(80);
  const ghost = createLocalConnect({ name: `t${n}` })('a');          // a stray message from a's old connection
  a.stop();
  await wait(30);
  ghost.send({ event: 'pose', payload: { id: 'a', planet: 'hangzhou', p: P, f: F, t: Date.now() + 1 } });
  await wait(30);
  assert.equal(b.peers().length, 0);
  ghost.unsubscribe();
  w.done();
});

test('activity: active, idle after no input or a hidden tab, away after a long-hidden tab', () => {
  const now = 1e9;
  assert.equal(activityOf({ visible: true, lastInput: now - 1000, now }), 'active');
  assert.equal(activityOf({ visible: true, lastInput: now - IDLE_AFTER, now }), 'idle');
  assert.equal(activityOf({ visible: false, hiddenSince: now - 1000, lastInput: now, now }), 'idle');
  assert.equal(activityOf({ visible: false, hiddenSince: now - AWAY_AFTER, lastInput: now, now }), 'away');
});
