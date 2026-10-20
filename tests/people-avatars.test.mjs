import assert from 'node:assert/strict';
import test from 'node:test';
import { AVATAR_PREFIX, avatarKey, avatarSources, avatarUrl, isJobAvatar, rejectImage } from '../src/lib/people-avatars.ts';
import { avatarOf, personFromRows } from '../src/lib/people.ts';

const person = (extra = {}) => ({ id: '1', slug: 'ada', x_handle: 'ada', github_handle: null, avatar_url: null, ...extra });

test('X first, then GitHub; nothing without a handle', () => {
  assert.deepEqual(avatarSources(person({ github_handle: 'ada-gh' })).map((s) => s.name), ['x', 'github']);
  assert.match(avatarSources(person())[0].url, /^https:\/\/unavatar\.io\/x\/ada\?fallback=false$/);
  assert.match(avatarSources(person({ x_handle: null, github_handle: 'ada-gh' }))[0].url, /^https:\/\/github\.com\/ada-gh\.png/);
  assert.deepEqual(avatarSources(person({ x_handle: null })), []);
});

test('a photo set by hand is never replaced; one the job wrote may be', () => {
  const job = `https://www.amazingindex.com/${AVATAR_PREFIX}ada-0123456789ab.jpg`;
  assert.equal(isJobAvatar(job), true);
  assert.equal(avatarSources(person({ avatar_url: job })).length, 1);
  assert.deepEqual(avatarSources(person({ avatar_url: 'https://www.amazingindex.com/media/hand/ada.jpg' })), []);
});

test('only real images of a sane size are stored', () => {
  assert.equal(rejectImage('image/jpeg; charset=binary', 20_000), null);
  assert.match(rejectImage('text/html', 20_000), /not an image/);
  assert.match(rejectImage('image/png', 100), /too small/);
  assert.match(rejectImage('image/png', 3 * 1024 * 1024), /too large/);
});

test('the same bytes get the same key, new bytes a new one', () => {
  const a = avatarKey('ada', new Uint8Array([1, 2, 3]), 'image/jpeg');
  assert.match(a, /^media\/people\/avatars\/ada-[0-9a-f]{12}\.jpg$/);
  assert.equal(avatarKey('ada', new Uint8Array([1, 2, 3]), 'image/jpeg'), a);
  assert.notEqual(avatarKey('ada', new Uint8Array([1, 2, 4]), 'image/jpeg'), a);
  assert.equal(avatarUrl(a), `https://www.amazingindex.com/${a}`);
});

test('the pages show the stored photo, else the latest post avatar, never another host', () => {
  const row = { id: 'p1', slug: 'ada', name: 'Ada', name_zh: null, x_handle: 'ada', person_group: '研究者', role: 'R', tier: null, take_text: null, take_updated_at: null, status: 'published', former_subjects: [], added_at: '2026-10-01', updated_at: '2026-10-01T00:00:00Z' };
  const post = { avatar_url: 'https://www.amazingindex.com/media/x/avatars/ada.jpg' };
  assert.equal(avatarOf(personFromRows({ ...row, avatar_url: 'https://www.amazingindex.com/media/people/avatars/ada-1.jpg' }), [post]), 'https://www.amazingindex.com/media/people/avatars/ada-1.jpg');
  assert.equal(avatarOf(personFromRows({ ...row, avatar_url: 'https://pbs.twimg.com/ada.jpg' }), [post]), post.avatar_url);
  assert.equal(avatarOf(personFromRows(row), []), null);
});
