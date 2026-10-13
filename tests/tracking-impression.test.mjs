import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM / IntersectionObserver fakes, installed before tracking.ts loads.
const listeners = {};
let observerCallback;
let cards = [];
const fetchCalls = [];

function makeCard(itemId) {
  return { dataset: { itemId, snapshotDate: '2026-10-13', trackImpression: 'true' } };
}

globalThis.document = {
  visibilityState: 'visible',
  cookie: '',
  addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  querySelector() { return null; },
  querySelectorAll() { return cards; },
};
globalThis.window = globalThis;
globalThis.location = { pathname: '/', search: '', href: 'https://amazingindex.com/' };
globalThis.IntersectionObserver = class {
  constructor(cb) { observerCallback = cb; this.observed = new Set(); }
  observe(el) { this.observed.add(el); }
  unobserve(el) { this.observed.delete(el); }
  disconnect() { this.observed.clear(); }
};
globalThis.fetch = (url, opts) => { fetchCalls.push(JSON.parse(opts.body)); return Promise.resolve(); };
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uid-test' };

mock.timers.enable({ apis: ['setTimeout'] });
await import('../src/scripts/tracking.ts');

const fire = (type) => (listeners[type] || []).forEach((fn) => fn({ type }));
const intersect = (el, visible) =>
  observerCallback([{ target: el, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]);
const impressions = () => fetchCalls.filter((c) => c.event_type === 'impression').map((c) => c.item_id);

let n = 0;
beforeEach(() => {
  fetchCalls.length = 0;
  document.visibilityState = 'visible';
  cards = [makeCard(`item-${++n}`)];
  fire('astro:page-load');
});

test('records an impression after 5s of continuous visibility', () => {
  intersect(cards[0], true);
  mock.timers.tick(4999);
  assert.deepEqual(impressions(), []);
  mock.timers.tick(1);
  assert.deepEqual(impressions(), [cards[0].dataset.itemId]);
});

test('leaving the viewport before 5s cancels the impression', () => {
  intersect(cards[0], true);
  mock.timers.tick(3000);
  intersect(cards[0], false);
  mock.timers.tick(10000);
  assert.deepEqual(impressions(), []);
});

test('dwell restarts from zero after the card comes back', () => {
  intersect(cards[0], true);
  mock.timers.tick(4000);
  intersect(cards[0], false);
  intersect(cards[0], true);
  mock.timers.tick(4000);
  assert.deepEqual(impressions(), []);
  mock.timers.tick(1000);
  assert.deepEqual(impressions(), [cards[0].dataset.itemId]);
});

test('hiding the tab cancels, and returning restarts the dwell', () => {
  intersect(cards[0], true);
  mock.timers.tick(3000);
  document.visibilityState = 'hidden';
  fire('visibilitychange');
  mock.timers.tick(10000);
  assert.deepEqual(impressions(), []);
  document.visibilityState = 'visible';
  fire('visibilitychange');
  mock.timers.tick(5000);
  assert.deepEqual(impressions(), [cards[0].dataset.itemId]);
});

test('an item is recorded at most once', () => {
  const card = cards[0];
  intersect(card, true);
  mock.timers.tick(5000);
  intersect(card, false);
  intersect(card, true);
  mock.timers.tick(5000);
  assert.deepEqual(impressions(), [card.dataset.itemId]);
});
