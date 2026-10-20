import assert from 'node:assert/strict';
import test from 'node:test';
import {
  definingEvent, directoryOrder, isWritten, missingFromPeople, peopleFromRows, personFromRows, postsByHandle,
  retiredSubjectTarget, sortedEvents, validatePerson,
} from '../src/lib/people.ts';
import { normalizePost } from '../src/lib/feed.ts';
import { buildFixture } from '../scripts/dev/mock-supabase.mjs';

const base = (extra = {}) => ({
  slug: 'ada', name: 'Ada', group: '研究者', role: 'Researcher', x_handle: 'ada',
  events: [], record: [], labels: [], stances: [], compare: [],
  added_at: '2026-10-20', updated_at: '2026-10-20', ...extra,
});
const src = { title: 'Blog', url: 'https://example.com/a' };
const row = (extra = {}) => ({
  id: 'p1', slug: 'ada', name: 'Ada', name_zh: null, x_handle: 'ada', person_group: '研究者', role: 'Researcher',
  tier: null, take_text: null, take_updated_at: null, status: 'published', former_subjects: [],
  added_at: '2026-10-01', updated_at: '2026-10-05T08:00:00+00:00', ...extra,
});

test('a row and its profile become one person, dated by the later edit', () => {
  const profile = { person_id: 'p1', born: null, fields: [], events: [], record: [{ period: '2020', text: 'x' }], labels: [], stances: [], compare: [], updated_at: '2026-10-09T00:00:00Z' };
  const p = personFromRows(row({ take_text: '一句话', take_updated_at: '2026-10-07' }), profile);
  assert.equal(p.group, '研究者');
  assert.deepEqual(p.take, { text: '一句话', updated_at: '2026-10-07' });
  assert.equal(p.updated_at, '2026-10-09');
  assert.equal(p.record.length, 1);
  assert.equal('name_zh' in p, false);
  const bare = personFromRows(row(), undefined);
  assert.deepEqual([bare.events, bare.updated_at, isWritten(bare)], [[], '2026-10-05', false]);
});

test('invalid or duplicate rows are left out with a warning; drafts are never shown', () => {
  const problems = [];
  const people = peopleFromRows([
    row(),
    row({ id: 'p2', slug: 'bob', x_handle: 'ADA' }),
    row({ id: 'p3', slug: 'cy', x_handle: 'cy', person_group: '别的' }),
    row({ id: 'p4', slug: 'di', x_handle: 'di', status: 'draft' }),
  ], [], (m) => problems.push(m));
  assert.deepEqual(people.map((p) => p.slug), ['ada']);
  assert.equal(problems.length, 2);
  assert.match(problems.join(), /also used by ada/);
  assert.match(problems.join(), /group must be one of/);
});

test('a compare link to someone not shown becomes plain text', () => {
  const profile = { person_id: 'p1', events: [], record: [], labels: [], stances: [], compare: [{ name: 'Di', slug: 'di', why: 'w' }], updated_at: '2026-10-05T00:00:00Z' };
  const [ada] = peopleFromRows([row(), row({ id: 'p4', slug: 'di', x_handle: 'di', status: 'draft' })], [profile]);
  assert.equal(ada.compare[0].slug, undefined);
});

test('the mock database people are valid, so local builds and e2e show them', () => {
  const { people, person_profiles } = buildFixture();
  const problems = [];
  const shown = peopleFromRows(people, person_profiles, (m) => problems.push(m));
  assert.deepEqual(problems, []);
  assert.deepEqual(shown.map((p) => [p.slug, isWritten(p)]), [['sam-altman', true], ['santiago', false]]);
});

test('an unwritten person needs only a public identity', () => {
  assert.deepEqual(validatePerson(base()), []);
  assert.equal(isWritten(base()), false);
  assert.equal(isWritten(base({ take: { text: '一句话', updated_at: '2026-10-20' } })), true);
});

test('the slug must be URL-safe', () => {
  assert.match(validatePerson(base({ slug: 'Ada Lovelace' })).join(), /lowercase/);
});

test('a 争议 event needs two sides and every event needs a source', () => {
  const fight = { date: '2024.05', type: '争议', title: 'T', body: 'B', sources: [src], sides: [{ who: 'A', text: 'a' }] };
  assert.match(validatePerson(base({ events: [fight] })).join(), /at least two sides/);
  const noSource = { date: '2024', type: '转折', title: 'T', body: 'B', sources: [] };
  assert.match(validatePerson(base({ events: [noSource] })).join(), /at least one source/);
  const ok = { ...fight, sides: [{ who: 'A', text: 'a' }, { who: 'B', text: 'b' }] };
  assert.deepEqual(validatePerson(base({ events: [ok] })), []);
});

test('a published file needs source URLs; a draft may leave them out', () => {
  const e = { date: '2024', type: '转折', title: 'T', body: 'B', sources: [{ title: 'Somewhere', url: '' }] };
  assert.match(validatePerson(base({ events: [e] })).join(), /needs an http\(s\) url/);
  assert.deepEqual(validatePerson(base({ events: [e], draft: true })), []);
});

test('only one pinned event, and only it has steps', () => {
  const e = (extra) => ({ date: '2024', type: '低谷', title: 'T', body: 'B', sources: [src], ...extra });
  assert.match(validatePerson(base({ events: [e({ pinned: true }), e({ pinned: true })] })).join(), /at most one/);
  assert.match(validatePerson(base({ events: [e({ steps: [{ date: '11.17', text: 'x' }] })] })).join(), /only the pinned/);
});

test('stances are 0–100 with a note and a source', () => {
  const s = { left: '开源', right: '闭源', position: 120, note: 'n', source: src };
  assert.match(validatePerson(base({ stances: [s] })).join(), /position must be 0–100/);
  assert.deepEqual(validatePerson(base({ stances: [{ ...s, position: 70, was: 20 }] })), []);
});

test('events read oldest first; the defining event is the pinned one, else the newest non-转折', () => {
  const e = (date, type, extra = {}) => ({ date, type, title: date, body: 'B', sources: [src], ...extra });
  const p = base({ events: [e('2024', '转折'), e('2019', '争议'), e('2022.11', '低谷')] });
  assert.deepEqual(sortedEvents(p).map((x) => x.date), ['2019', '2022.11', '2024']);
  assert.equal(definingEvent(p).date, '2022.11');
  assert.equal(definingEvent({ ...p, events: [...p.events, e('2005', '转折', { pinned: true })] }).date, '2005');
  assert.equal(definingEvent(base()), null);
});

test('written people come first, newest take first, then the rest by name', () => {
  const take = (d) => ({ take: { text: 't', updated_at: d } });
  const order = directoryOrder([
    base({ slug: 'c', name: 'Cy' }),
    base({ slug: 'a', name: 'Al', ...take('2026-10-01') }),
    base({ slug: 'b', name: 'Bo' }),
    base({ slug: 'd', name: 'Di', ...take('2026-10-19') }),
  ]);
  assert.deepEqual(order.map((p) => p.slug), ['d', 'a', 'b', 'c']);
});

test('feed posts are matched to people by handle, case-insensitively', () => {
  const post = (author, at) => normalizePost({ id: `${author}${at}`, author, published_at: at, updated_at: at, url: 'u', text_original: 'x' });
  const byHandle = postsByHandle([post('Ada', '2026-10-20T01:00:00Z'), post('ada', '2026-10-20T03:00:00Z'), post('zed', '2026-10-20T02:00:00Z')]);
  assert.deepEqual(byHandle.get('ada').map((p) => p.published_at), ['2026-10-20T03:00:00Z', '2026-10-20T01:00:00Z']);
  assert.deepEqual(missingFromPeople([base()], byHandle), ['zed']);
});

test('retired subject URLs go to the person who took them over, else the directory', () => {
  const people = [base({ former_subjects: ['person:lovelace'] }), base({ slug: 'elon-musk', name: 'Elon', x_handle: 'e' })];
  assert.equal(retiredSubjectTarget('person:lovelace', people), '/people/ada');
  assert.equal(retiredSubjectTarget('person:elon-musk', people), '/people/elon-musk');
  assert.equal(retiredSubjectTarget('company:xiaomi', people), '/people');
  assert.equal(retiredSubjectTarget(null, people), '/people');
});
