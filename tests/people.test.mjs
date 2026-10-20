import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  definingEvent, directoryOrder, isWritten, loadPeople, missingFromPeople, postsByHandle,
  retiredSubjectTarget, sortedEvents, validatePerson,
} from '../src/lib/people.ts';
import { normalizePost } from '../src/lib/feed.ts';

const DIR = path.join(import.meta.dirname, '../src/content/people');

async function committedFiles() {
  const files = {};
  for (const name of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
    files[name.slice(0, -5)] = JSON.parse(await readFile(path.join(DIR, name), 'utf8'));
  }
  return files;
}

const base = (extra = {}) => ({
  slug: 'ada', name: 'Ada', group: '研究者', role: 'Researcher', x_handle: 'ada',
  events: [], record: [], labels: [], stances: [], compare: [],
  added_at: '2026-10-20', updated_at: '2026-10-20', ...extra,
});
const src = { title: 'Blog', url: 'https://example.com/a' };

test('every committed person file passes the build rules', async () => {
  const files = await committedFiles();
  assert.ok(Object.keys(files).length > 0);
  const people = loadPeople(files, { includeDrafts: true });
  assert.equal(people.length, Object.keys(files).length);
});

test('an unwritten person needs only a public identity', () => {
  assert.deepEqual(validatePerson(base(), 'ada'), []);
  assert.equal(isWritten(base()), false);
  assert.equal(isWritten(base({ take: { text: '一句话', updated_at: '2026-10-20' } })), true);
});

test('the slug must match the file name and be URL-safe', () => {
  assert.match(validatePerson(base(), 'bob').join(), /must match the file name/);
  assert.match(validatePerson(base({ slug: 'Ada Lovelace' }), 'Ada Lovelace').join(), /lowercase/);
});

test('a 争议 event needs two sides and every event needs a source', () => {
  const fight = { date: '2024.05', type: '争议', title: 'T', body: 'B', sources: [src], sides: [{ who: 'A', text: 'a' }] };
  assert.match(validatePerson(base({ events: [fight] }), 'ada').join(), /at least two sides/);
  const noSource = { date: '2024', type: '转折', title: 'T', body: 'B', sources: [] };
  assert.match(validatePerson(base({ events: [noSource] }), 'ada').join(), /at least one source/);
  const ok = { ...fight, sides: [{ who: 'A', text: 'a' }, { who: 'B', text: 'b' }] };
  assert.deepEqual(validatePerson(base({ events: [ok] }), 'ada'), []);
});

test('a published file needs source URLs; a draft may leave them out', () => {
  const e = { date: '2024', type: '转折', title: 'T', body: 'B', sources: [{ title: 'Somewhere', url: '' }] };
  assert.match(validatePerson(base({ events: [e] }), 'ada').join(), /needs an http\(s\) url/);
  assert.deepEqual(validatePerson(base({ events: [e], draft: true }), 'ada'), []);
});

test('only one pinned event, and only it has steps', () => {
  const e = (extra) => ({ date: '2024', type: '低谷', title: 'T', body: 'B', sources: [src], ...extra });
  assert.match(validatePerson(base({ events: [e({ pinned: true }), e({ pinned: true })] }), 'ada').join(), /at most one/);
  assert.match(validatePerson(base({ events: [e({ steps: [{ date: '11.17', text: 'x' }] })] }), 'ada').join(), /only the pinned/);
});

test('stances are 0–100 with a note and a source', () => {
  const s = { left: '开源', right: '闭源', position: 120, note: 'n', source: src };
  assert.match(validatePerson(base({ stances: [s] }), 'ada').join(), /position must be 0–100/);
  assert.deepEqual(validatePerson(base({ stances: [{ ...s, position: 70, was: 20 }] }), 'ada'), []);
});

test('drafts are not published, and published people never link to them', () => {
  const files = {
    ada: base({ compare: [{ name: 'Bob', slug: 'bob', why: 'w' }] }),
    bob: base({ slug: 'bob', name: 'Bob', x_handle: 'bob', draft: true }),
  };
  const people = loadPeople(files);
  assert.deepEqual(people.map((p) => p.slug), ['ada']);
  assert.equal(people[0].compare[0].slug, undefined);
  assert.equal(loadPeople(files, { includeDrafts: true }).length, 2);
});

test('compare links and handles are checked across files', () => {
  assert.throws(() => loadPeople({ ada: base({ compare: [{ name: 'X', slug: 'nobody', why: 'w' }] }) }), /unknown person "nobody"/);
  assert.throws(() => loadPeople({ ada: base(), bob: base({ slug: 'bob', x_handle: 'ADA' }) }), /also used by/);
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
