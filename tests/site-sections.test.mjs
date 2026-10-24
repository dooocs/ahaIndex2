import assert from 'node:assert/strict';
import test from 'node:test';
import { SHELVES, sectionForPath, visibleShelves } from '../src/lib/site.ts';

test('every path lights the tab of its section', () => {
  assert.equal(sectionForPath('/'), 'daily');
  assert.equal(sectionForPath('/daily/2026-10-19'), 'daily');
  assert.equal(sectionForPath('/article/abc'), 'daily');
  assert.equal(sectionForPath('/history'), 'daily');
  assert.equal(sectionForPath('/projects/x'), 'daily');
  assert.equal(sectionForPath('/feed'), 'feed');
  assert.equal(sectionForPath('/feed/'), 'feed');
  assert.equal(sectionForPath('/people'), 'people');
  assert.equal(sectionForPath('/people/sam-altman'), 'people');
  assert.equal(sectionForPath('/subjects/company:xiaomi'), null);
  assert.equal(sectionForPath('/meet/new'), 'meet');
  assert.equal(sectionForPath('/dream'), 'dream');
  assert.equal(sectionForPath('/dream/app.html'), 'dream');
});

test('site pages outside a section have no active tab', () => {
  for (const p of ['/about', '/privacy', '/terms', '/login', '/dailyx', '/feeder', '/dreamer']) assert.equal(sectionForPath(p), null, p);
});

test('community-only sections are hidden until community is enabled', () => {
  assert.deepEqual(visibleShelves(false).map((s) => s.id), ['daily', 'feed', 'people', 'dream']);
  assert.deepEqual(visibleShelves(true).map((s) => s.id), SHELVES.map((s) => s.id));
});

test('section ids are unique', () => {
  assert.equal(new Set(SHELVES.map((s) => s.id)).size, SHELVES.length);
});
