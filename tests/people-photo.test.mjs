import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isSiteOwnerCandidate, validPortraitUrl } from '../src/lib/site-admin.ts';
import { handlePeoplePhotos, portraitJpeg } from '../sql/dark-room/edge/index.ts';

const project = 'https://spb-x6r06737x2zdpg3x.supabase.opentrust.net';
const endpoint = project + '/functions/v1/meet-api/people-photos';
const ownerId = '11111111-1111-4111-8111-111111111111';
const owner = { id: ownerId, email: 'szqsunny@outlook.com', email_confirmed_at: '2026-11-08T00:00:00Z' };
const jpeg = readFileSync(new URL('./fixtures/portrait.jpg', import.meta.url));
const env = name => ({ SUPABASE_URL: project, SUPABASE_LOCAL_URL: 'http://internal.test', SUPABASE_SERVICE_ROLE_KEY: 'server-fixture' })[name];
const json = (body, status = 200) => Response.json(body, { status });
function request(body, token = 'verified-token') {
  return new Request(endpoint, { method: 'POST', headers: {
    Origin: 'https://www.amazingindex.com', ...(token ? { 'x-community-authorization': `Bearer ${token}` } : {}),
    ...(!(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
  }, body: body instanceof FormData ? body : JSON.stringify(body) });
}
function photo(extra = {}) {
  const form = new FormData();
  form.set('slug', 'lei-jun'); form.set('expected_avatar', '');
  form.set('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'photo.jpg');
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}
function backend(options = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname;
    const body = typeof init?.body === 'string' && init.headers?.['Content-Type'] === 'application/json' ? JSON.parse(init.body) : null;
    calls.push({ path, init, body });
    if (path === '/auth/v1/user') {
      assert.equal(init.headers.Authorization, 'Bearer verified-token');
      return json(options.user ?? owner, options.authStatus ?? 200);
    }
    if (path.endsWith('/site_admin_authorize')) {
      assert.deepEqual(body, { p_actor: (options.user ?? owner).id });
      return json(options.pinned ?? true);
    }
    if (path.endsWith('/people_photo_api')) {
      if (body.p_action === 'list') { assert.equal(body.p_actor, null); return json({ photos: [] }); }
      assert.equal(body.p_actor, ownerId);
      if (body.p_action === 'inspect') return options.inspectConflict ? json({ message: 'photo_conflict', code: 'P0001' }, 400) : json({ ok: true });
      if (body.p_action === 'save') {
        assert.equal(body.p_payload.slug, 'lei-jun');
        assert.equal(body.p_payload.expected_avatar, '');
        assert.equal(body.p_payload.avatar_url, project + '/storage/v1/object/public/people-portraits/' + body.p_payload.object_path);
        if (options.saveConflict) return json({ message: 'photo_conflict', code: 'P0001' }, 400);
        if (options.unknownCommit) throw new Error('connection lost after commit');
        return json({ avatar_url: body.p_payload.avatar_url });
      }
    }
    if (path.startsWith('/storage/v1/object/people-portraits')) return json({}, options.uploadFailure ? 500 : 200);
    throw new Error('Unexpected mock route ' + path);
  };
  return { calls, fetcher };
}

test('visibility requires a verified owner email, not editable user metadata', () => {
  assert.equal(isSiteOwnerCandidate(owner), true);
  assert.equal(isSiteOwnerCandidate({ ...owner, email: 'SZQSUNNY@OUTLOOK.COM' }), true);
  for (const user of [null, {}, { ...owner, email: 'reader@example.test' }, { ...owner, email_confirmed_at: null },
    { ...owner, is_anonymous: true }, { ...owner, banned_until: '2099-01-01' },
    { id: ownerId, user_metadata: { email: owner.email }, email_confirmed_at: owner.email_confirmed_at }]) assert.equal(isSiteOwnerCandidate(user), false);
});
test('only immutable portraits on the configured project are accepted', () => {
  const url = project + '/storage/v1/object/public/people-portraits/lei-jun/' + ownerId + '.jpg';
  assert.equal(validPortraitUrl(url, project), true);
  for (const value of [url + '?token=private', url + '#hash', url.replace(project, 'https://evil.test'), url.replace('lei-jun/', '../'), 'javascript:alert(1)', null]) assert.equal(validPortraitUrl(value, project), false);
});
test('guests cannot upload and their image body is not consumed', async () => {
  const mock = backend(), req = request(photo(), null);
  assert.equal((await handlePeoplePhotos(req, env, mock.fetcher)).status, 401);
  assert.equal(req.bodyUsed, false); assert.equal(mock.calls.length, 0);
});
for (const [label, user] of [
  ['another user', { ...owner, id: '22222222-2222-4222-8222-222222222222', email: 'reader@example.test', user_metadata: { email: owner.email } }],
  ['an unverified owner', { ...owner, email_confirmed_at: null }],
  ['a banned owner', { ...owner, banned_until: '2099-01-01' }],
  ['an anonymous identity', { ...owner, is_anonymous: true }],
]) test(label + ' cannot invoke writes even with a forged owner field', async () => {
  const mock = backend({ user }), req = request(photo({ owner_id: ownerId, email: owner.email }));
  assert.equal((await handlePeoplePhotos(req, env, mock.fetcher)).status, 403);
  assert.equal(req.bodyUsed, false); assert.equal(mock.calls.length, 1);
});
test('a verified email without the originally pinned UUID is refused', async () => {
  const mock = backend({ pinned: false });
  assert.equal((await handlePeoplePhotos(request(photo()), env, mock.fetcher)).status, 403);
  assert.equal(mock.calls.length, 2);
});
test('forged tokens and an unavailable Auth service fail closed', async () => {
  for (const [authStatus, expected] of [[401, 401], [503, 503], [429, 503]]) {
    const mock = backend({ authStatus });
    assert.equal((await handlePeoplePhotos(request({ action: 'access', email: owner.email, user_id: ownerId }), env, mock.fetcher)).status, expected);
    assert.equal(mock.calls.length, 1);
  }
});
test('owner access succeeds only after both server checks', async () => {
  const mock = backend();
  assert.deepEqual(await (await handlePeoplePhotos(request({ action: 'access' }), env, mock.fetcher)).json(), { owner: true });
  assert.equal(mock.calls.length, 2);
});
test('public lookup has a bounded slug list and no access to write actions', async () => {
  const mock = backend();
  assert.deepEqual(await (await handlePeoplePhotos(request({ action: 'list', slugs: ['lei-jun'] }, null), env, mock.fetcher)).json(), { photos: [] });
  assert.equal(mock.calls.length, 1);
  for (const body of [{ action: 'list', slugs: Array(101).fill('lei-jun') }, { action: 'list', slugs: ['../other'] }, { action: 'save', p_actor: ownerId }]) {
    assert.equal((await handlePeoplePhotos(request(body, null), env, mock.fetcher)).status, 400);
  }
  assert.equal(mock.calls.length, 1);
});
test('upload uses the verified UUID and a server-created image path', async () => {
  const mock = backend();
  const response = await handlePeoplePhotos(request(photo({ owner_id: 'forged-owner', avatar_url: 'https://evil.test/image.jpg' })), env, mock.fetcher);
  assert.equal(response.status, 200);
  assert.ok(validPortraitUrl((await response.json()).avatar_url, project));
  assert.deepEqual(mock.calls.map(x => x.path.split('/').at(-1)).slice(0, 3), ['user', 'site_admin_authorize', 'people_photo_api']);
  const upload = mock.calls.find(x => x.init.method === 'POST' && x.path.includes('/storage/'));
  assert.deepEqual(Buffer.from(upload.init.body), jpeg);
  assert.equal(upload.init.headers['x-upsert'], 'false');
});
test('an edit conflict is detected before upload or cleaned up after an atomic save rejection', async () => {
  for (const options of [{ inspectConflict: true }, { saveConflict: true }]) {
    const mock = backend(options);
    assert.equal((await handlePeoplePhotos(request(photo()), env, mock.fetcher)).status, 409);
    const storage = mock.calls.filter(x => x.path.includes('/storage/'));
    assert.equal(storage.length, options.inspectConflict ? 0 : 2);
    if (storage.length) { assert.equal(storage[1].init.method, 'DELETE'); assert.deepEqual(storage[1].body.prefixes, [storage[0].path.replace('/storage/v1/object/people-portraits/', '')]); }
  }
});
test('upload failure never changes the person and an uncertain commit never deletes a possibly published photo', async () => {
  for (const options of [{ uploadFailure: true }, { unknownCommit: true }]) {
    const mock = backend(options);
    assert.equal((await handlePeoplePhotos(request(photo()), env, mock.fetcher)).status, 503);
    assert.equal(mock.calls.some(x => x.init.method === 'DELETE'), false);
    if (options.uploadFailure) assert.equal(mock.calls.some(x => x.body?.p_action === 'save'), false);
  }
});
test('image validation rejects a different type, corrupt header, dimensions and excessive bytes', async () => {
  assert.equal(portraitJpeg(jpeg), true);
  assert.equal(portraitJpeg(new Uint8Array(900001)), false);
  assert.equal(portraitJpeg(jpeg.subarray(0, jpeg.length - 1)), false);
  const bad = Buffer.from(jpeg); const sof = bad.indexOf(Buffer.from([255, 192]));
  assert.ok(sof > 0); bad[sof + 5] = 255;
  assert.equal(portraitJpeg(bad), false);
  const mock = backend(), form = photo();
  form.set('photo', new Blob(['not a photo'], { type: 'image/jpeg' }), 'fake.jpg');
  assert.equal((await handlePeoplePhotos(request(form), env, mock.fetcher)).status, 400);
  assert.equal(mock.calls.some(x => x.path.includes('/storage/')), false);
});
test('a streamed oversized upload is refused even without Content-Length', async () => {
  const mock = backend();
  const req = new Request(endpoint, { method: 'POST', duplex: 'half',
    headers: { Authorization: 'Bearer verified-token', 'Content-Type': 'multipart/form-data; boundary=test' },
    body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(920001)); c.close(); } }),
  });
  assert.equal((await handlePeoplePhotos(req, env, mock.fetcher)).status, 413);
  assert.equal(mock.calls.some(x => x.path.includes('/storage/')), false);
});
test('foreign web origins are rejected; production preflight preserves the custom Auth header', async () => {
  const mock = backend();
  const forbidden = new Request(endpoint, { method: 'POST', headers: { Origin: 'https://evil.test' }, body: '{}' });
  assert.equal((await handlePeoplePhotos(forbidden, env, mock.fetcher)).status, 403);
  const preflight = await handlePeoplePhotos(new Request(endpoint, { method: 'OPTIONS', headers: { Origin: 'https://www.amazingindex.com' } }), env, mock.fetcher);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://www.amazingindex.com');
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /x-community-authorization/);
  assert.equal(mock.calls.length, 0);
});
