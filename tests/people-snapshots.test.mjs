import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { bornText, eventDate, initialOf, rowsFromSnapshot, rowsFromSnapshots } from '../src/lib/people-snapshots.ts';
import { peopleFromRows, personFromRows, validatePerson } from '../src/lib/people.ts';
import { buildFixture, snapshotFromRows } from '../scripts/dev/mock-supabase.mjs';

// Real person_public() output from the Aliyun schema (sql/people/aliyun/), as
// the sync job writes it into people_snapshots.
const real = JSON.parse(readFileSync(new URL('./fixtures/people-snapshots.json', import.meta.url), 'utf8'));
const bySlug = (slug) => real.find((s) => s.slug === slug);

test('dates are written back at their own precision', () => {
  assert.equal(eventDate('2005-01-01', 'year'), '2005');
  assert.equal(eventDate('2014-02-01', 'month'), '2014.02');
  assert.equal(eventDate('2023-11-17', 'day'), '2023.11.17');
  assert.equal(bornText({ birth_date: '1985-01-01', birth_prec: 'year', birth_place: '芝加哥' }), '1985 · 芝加哥');
  assert.equal(bornText({ birth_date: '1969-12-16', birth_prec: 'day', birth_place: null }), '1969.12.16');
  assert.equal(bornText({}), null);
});

test('stance dots use the surname initial for western names', () => {
  assert.equal(initialOf('Yann LeCun'), 'L');
  assert.equal(initialOf('杨立昆'), '杨');
  assert.equal(initialOf('karpathy'), 'K');
  assert.equal(initialOf(''), undefined);
});

test('a real identity-only snapshot becomes the same row the people table held', () => {
  const { person, profile } = rowsFromSnapshot(bySlug('andrew-ng'));
  assert.deepEqual(
    { slug: person.slug, name_zh: person.name_zh, group: person.person_group, x: person.x_handle, added: person.added_at, status: person.status },
    { slug: 'andrew-ng', name_zh: '吴恩达', group: '布道者', x: 'AndrewYNg', added: '2026-10-20', status: 'published' },
  );
  assert.deepEqual([profile.events, profile.record, profile.stances], [[], [], []]);
  const p = personFromRows(person, profile);
  assert.deepEqual(validatePerson(p), []);
  assert.equal(p.updated_at, '2026-10-20');
  assert.equal(p.nickname, '吴恩达 · AI 网课顶流');
});

test('a real full snapshot keeps every part of the profile', () => {
  const { person, profile } = rowsFromSnapshot(bySlug('sam-altman'));
  assert.equal(profile.born, '1985 · 芝加哥');
  assert.deepEqual(profile.fields, ['大模型', '创业投资', '核能']);
  assert.equal(profile.events.length, 9);
  const fired = profile.events.find((e) => e.title.startsWith('被董事会解雇'));
  assert.deepEqual(
    { date: fired.date, type: fired.type, pinned: fired.pinned, steps: fired.steps.length, sides: fired.sides.length, reading: Boolean(fired.reading) },
    { date: '2023.11', type: '低谷', pinned: true, steps: 4, sides: 2, reading: true },
  );
  assert.equal(profile.events.filter((e) => e.type === '争议').every((e) => e.sides.length >= 2), true);
  assert.equal('steps' in profile.events[0], false, 'no empty keys on events without steps');
  assert.deepEqual(profile.record.map((r) => r.period), ['2014–2019', '2022', '2023']);
  assert.deepEqual(profile.labels[0], { text: 'ChatGPT 之父', by: '中文媒体常用' });
  const regulation = profile.stances.find((s) => s.left === '少监管');
  assert.deepEqual([regulation.position, regulation.was], [40, 75]);
  assert.deepEqual(profile.compare.map((c) => c.name), ['埃隆·马斯克', '杨立昆']);
  // Sources still waiting for a link keep the person off the site, as before.
  const problems = validatePerson(personFromRows(person, profile));
  assert.ok(problems.length > 0 && problems.every((m) => /needs an http\(s\) url/.test(m)), problems.join('\n'));
});

test('snapshots of the mock people show the same pages as their old rows', () => {
  const { people, person_profiles } = buildFixture();
  const snapshots = people.filter((p) => p.status === 'published')
    .map((p) => snapshotFromRows(p, person_profiles.find((x) => x.person_id === p.id), people));
  const warnings = [[], []];
  const before = peopleFromRows(people.filter((p) => p.status === 'published'), person_profiles, (m) => warnings[0].push(m));
  const { people: rows, profiles } = rowsFromSnapshots(snapshots);
  const after = peopleFromRows(rows, profiles, (m) => warnings[1].push(m));
  // Compared as the pages see them: a link to an unpublished person is
  // `slug: undefined` in one and absent in the other, which renders the same.
  const seen = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(seen(after), seen(before));
  assert.deepEqual(warnings[1], warnings[0]);
});

test('high points and one-sided disputes are left to the validator, not dropped silently', () => {
  const s = structuredClone(bySlug('andrew-ng'));
  s.payload.events = [
    { date: '2011-08-16', prec: 'day', title: '小米1发布', valence: 'up', then_text: '1999 元。', commentary: null, sides: null, steps: null, pinned: false, sources: [{ title: 'a', url: 'https://example.com/a' }] },
    { date: '2013-12-01', prec: 'month', title: '十亿赌约', valence: 'dispute', then_text: '打赌。', commentary: null, sides: null, steps: null, pinned: false, sources: [{ title: 'b', url: 'https://example.com/b' }] },
  ];
  const { person, profile } = rowsFromSnapshot(s);
  assert.deepEqual(profile.events.map((e) => e.type), ['高光', '争议']);
  const problems = validatePerson(personFromRows(person, profile));
  assert.ok(problems.some((m) => /type must be one of/.test(m)));
  assert.ok(problems.some((m) => /needs at least two sides/.test(m)));
});
