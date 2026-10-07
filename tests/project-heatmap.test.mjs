import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { fetchProjectHeatmapData } from '../src/lib/project-heatmap.ts';

const makeRows = (count) => Array.from({ length: count }, (_, i) => ({
  id: `00000000-0000-0000-0000-${(i + 1).toString(16).padStart(12, '0')}`,
  subject_id: 'example',
  snapshot_date: '2026-10-07',
  related_data: { related: [], competitors: [] },
}));
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const timeout = () => response({ code: '57014', message: 'canceling statement due to statement timeout' }, 500);

function setup(rows, intercept = () => undefined) {
  const requests = [];
  const logs = [];
  const delays = [];
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input);
      const query = url.searchParams;
      assert.equal(url.pathname, '/rest/v1/project_heatmap_data');
      assert.equal(query.get('order'), 'id.asc');
      assert.equal(query.has('offset'), false);
      assert.ok(query.get('select').split(',').includes('id'));
      assert.ok(query.get('select').split(',').includes('related_data'));
      assert.ok(!query.get('select').includes('*'));
      assert.ok(init.signal);
      const request = { cursor: query.get('id')?.replace(/^gt\./, ''), limit: Number(query.get('limit')) };
      requests.push(request);
      const intercepted = intercept(request, requests.length);
      if (intercepted) return intercepted;
      return response(rows.filter((row) => !request.cursor || row.id > request.cursor).slice(0, request.limit));
    } },
  });
  return {
    requests, logs, delays,
    run: () => fetchProjectHeatmapData(client, {
      log: (line) => logs.push(line), sleep: async (ms) => { delays.push(ms); },
    }),
  };
}

test('reads all rows in primary-key order, including the partial last page', async () => {
  const rows = makeRows(1201);
  const reader = setup(rows);
  assert.deepEqual(await reader.run(), rows);
  assert.deepEqual(reader.requests, [
    { cursor: undefined, limit: 500 },
    { cursor: rows[499].id, limit: 500 },
    { cursor: rows[999].id, limit: 500 },
  ]);
  assert.match(reader.logs.at(-1), /complete rows=1201 pages=3/);
});

test('an exact page boundary ends with an empty page', async () => {
  const rows = makeRows(500);
  const reader = setup(rows);
  assert.deepEqual(await reader.run(), rows);
  assert.equal(reader.requests.length, 2);
});

test('an empty table terminates without retrying', async () => {
  const reader = setup([]);
  assert.deepEqual(await reader.run(), []);
  assert.equal(reader.requests.length, 1);
});

test('a timeout retries the same cursor with a smaller page without losing rows', async () => {
  const rows = makeRows(1001);
  const reader = setup(rows, (_request, number) => number === 2 ? timeout() : undefined);
  assert.deepEqual(await reader.run(), rows);
  assert.deepEqual(reader.requests.slice(1, 4), [
    { cursor: rows[499].id, limit: 500 },
    { cursor: rows[499].id, limit: 250 },
    { cursor: rows[749].id, limit: 250 },
  ]);
  assert.equal(reader.delays.length, 1);
  assert.match(reader.logs[1], /code=57014/);
});

test('repeated timeouts fail after four attempts and never return partial data', async () => {
  const rows = makeRows(501);
  const reader = setup(rows, (_request, number) => number > 1 ? timeout() : undefined);
  await assert.rejects(reader.run(), /page=2.*attempt=4.*code=57014/);
  assert.deepEqual(reader.requests.slice(1).map((r) => r.limit), [500, 250, 125, 100]);
  assert.ok(reader.requests.slice(1).every((r) => r.cursor === rows[499].id));
  assert.equal(reader.delays.length, 3);
  assert.ok(!reader.logs.some((line) => line.includes('complete')));
});

test('a transient gateway failure retries without changing the cursor or page size', async () => {
  const reader = setup(makeRows(1), (_request, number) => number === 1
    ? response({ code: 'PGRST003', message: 'connection pool unavailable' }, 504) : undefined);
  assert.equal((await reader.run()).length, 1);
  assert.deepEqual(reader.requests[0], reader.requests[1]);
});

test('network errors retry and do not look like an empty final page', async () => {
  const reader = setup(makeRows(1), (_request, number) => {
    if (number === 1) throw new TypeError('fetch failed');
  });
  assert.equal((await reader.run()).length, 1);
  assert.equal(reader.requests.length, 2);
});

test('permission failures stop immediately', async () => {
  const reader = setup([], () => response({ code: '42501', message: 'permission denied' }, 403));
  await assert.rejects(reader.run(), /code=42501/);
  assert.equal(reader.requests.length, 1);
  assert.equal(reader.delays.length, 0);
});

for (const kind of ['duplicate', 'backwards', 'missing']) {
  test(`rejects a ${kind} cursor instead of accepting incomplete data`, async () => {
    const rows = makeRows(501);
    const reader = setup(rows, (_request, number) => {
      if (number !== 2) return;
      return response([kind === 'missing' ? {} : rows[kind === 'duplicate' ? 499 : 0]]);
    });
    await assert.rejects(reader.run(), /missing, duplicate or out-of-order id/);
  });
}
