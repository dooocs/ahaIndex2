import test from 'node:test';
import assert from 'node:assert/strict';
import { DarkRoomSync, canonicalState, parseState, guestKey } from '../src/lib/dark-room-sync.ts';
import { handleDarkRoom, handleCommunity } from '../sql/dark-room/edge/index.ts';

const owner = '11111111-1111-4111-8111-111111111111';
const device = '22222222-2222-4222-8222-222222222222';
const state = wood => ({ version: 1.3, stores: { wood } });
const storage = () => {
  const items = new Map([[guestKey, JSON.stringify(state(40))]]);
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
};
const cloud = (request, revision) => ({ state: request.state, revision, schema_version: 1, last_request_id: request.request_id, updated_at: new Date().toISOString() });

test('manual snapshot survives later progress, offline reload and autosave coalescing', () => {
  const disk = storage();
  const sync = new DarkRoomSync(owner, disk, device);
  const original = state(100);
  sync.capture(original, 'manual');
  original.stores.wood = 999;
  sync.capture(state(101));
  sync.capture(state(102));
  const reloaded = new DarkRoomSync(owner, disk, device);
  assert.deepEqual(reloaded.record.pending.map(x => [x.operation, x.state.stores.wood]), [['manual', 100], ['autosave', 102]]);
  assert.equal(JSON.parse(disk.getItem(guestKey)).stores.wood, 40);
  const first = reloaded.next();
  assert.equal(first.expected_revision, 0);
  reloaded.acknowledge(cloud(first, 1));
  assert.equal(reloaded.next().expected_revision, 1);
});

test('an attempted request stays immutable and retains its id after a lost response', () => {
  const disk = storage();
  const sync = new DarkRoomSync(owner, disk, device);
  sync.capture(state(10));
  const first = JSON.stringify(sync.next());
  sync.capture(state(20));
  assert.equal(JSON.stringify(sync.next()), first);
  assert.equal(JSON.stringify(new DarkRoomSync(owner, disk, device).next()), first);
  assert.equal(sync.record.pending.length, 2);
});

test('object key ordering does not create redundant autosaves', () => {
  assert.equal(canonicalState({ b: { d: 1, c: 2 }, a: [1, 2] }), canonicalState({ a: [1, 2], b: { c: 2, d: 1 } }));
  const sync = new DarkRoomSync(owner, storage(), device);
  sync.useCloud(cloud({ state: state(2), request_id: 'old' }, 3));
  sync.capture({ stores: { wood: 2 }, version: 1.3 });
  assert.equal(sync.record.pending.length, 0);
  sync.capture(state(2), 'manual');
  assert.equal(sync.record.pending.length, 1);
});

test('accounts isolate local progress and cloud replacement preserves a recovery copy', () => {
  const disk = storage();
  const a = new DarkRoomSync(owner, disk, device);
  const b = new DarkRoomSync(device, disk, device);
  a.capture(state(5), 'manual');
  a.archive(state(5));
  a.useCloud(cloud({ state: state(10), request_id: 'remote' }, 10));
  assert.equal(JSON.parse(disk.getItem(`${a.key}.recovery`)).record.pending[0].state.stores.wood, 5);
  assert.equal(disk.getItem(b.key), null);
  assert.equal(parseState('null'), null);
  assert.equal(parseState('{"version":9}'), null);
});

const env = name => ({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'server-key', SUPABASE_ANON_KEY: 'anon' })[name];
const request = (body, headers = {}) => new Request('https://db.example/functions/v1/meet-api/dark-room', {
  method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const user = { id: owner, email_confirmed_at: '2026-01-01', is_anonymous: false };

test('game endpoint uses the verified caller and the forwarded Aliyun bearer token', async () => {
  const calls = [];
  const result = await handleDarkRoom(request({ action: 'save', payload: { user_id: device } }, { 'x-community-authorization': 'Bearer actual-user' }), env, async (url, options) => {
    calls.push(url);
    if (url.endsWith('/user')) { assert.equal(options.headers.Authorization, 'Bearer actual-user'); return Response.json(user); }
    const body = JSON.parse(options.body);
    assert.equal(body.p_user_id, owner);
    assert.equal(body.p_action, 'save');
    return Response.json({ latest: { revision: 2 } });
  });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(result.headers.get('cache-control'), 'no-store');
});

test('game endpoint rejects anonymous, unverified, banned and foreign-origin access', async () => {
  for (const account of [{ ...user, is_anonymous: true }, { ...user, email_confirmed_at: null }, { ...user, banned_until: '2100-01-01' }]) {
    const response = await handleDarkRoom(request({ action: 'read' }), env, async () => Response.json(account));
    assert.equal(response.status, 401);
  }
  const response = await handleDarkRoom(request({ action: 'read' }, { origin: 'https://evil.example' }), env, () => assert.fail('no upstream request'));
  assert.equal(response.status, 403);
});

test('game endpoint returns CAS conflicts and enforces size limits without Content-Length', async () => {
  const conflict = await handleDarkRoom(request({ action: 'save' }), env, async url => url.endsWith('/user') ? Response.json(user) : Response.json({ error: 'conflict', latest: { revision: 4 } }));
  assert.equal(conflict.status, 409);
  const oversized = await handleDarkRoom(request({ action: 'save', payload: 'x'.repeat(1200000) }), env, async () => Response.json(user));
  assert.equal(oversized.status, 413);
});

test('existing community public/private actions and error contracts remain compatible', async () => {
  const publicRequest = request({ action: 'list_meet_posts', params: { p_limit: 1 } }, { Authorization: 'Bearer anon' });
  const response = await handleCommunity(publicRequest, env, async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.p_actor, null);
    assert.equal(body.p_action, 'list_meet_posts');
    return Response.json([{ id: 1 }]);
  });
  assert.deepEqual(await response.json(), { data: [{ id: 1 }] });
  const privateResponse = await handleCommunity(request({ action: 'submit_meet_post' }, { Authorization: 'Bearer anon' }), env, () => assert.fail('private access denied before RPC'));
  assert.equal(privateResponse.status, 401);
  const rate = await handleCommunity(request({ action: 'submit_meet_post' }), env, async url => url.endsWith('/user') ? Response.json(user) : Response.json({ code: 'P0001', message: 'Please wait 60 seconds' }, { status: 400 }));
  assert.equal(rate.status, 429);
  assert.deepEqual(await rate.json(), { error: { code: 'P0001', message: 'Please wait 60 seconds' } });
});
