import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Supply browser/storage/network boundaries, then execute the real board module.
const source = readFileSync(new URL('../public/race/js/board.js', import.meta.url), 'utf8');
const harness = `
export const stored = new Map([['race.best.v2', '{"total":120,"lap":60}']]);
export const calls = [];
const localStorage = { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) };
const location = { origin: 'https://race.test' };
const setTimeout = () => {};
let receive;
const addEventListener = (_event, cb) => { receive = cb; };
export const connect = () => receive({ origin: location.origin, data: { type: 'race:config', rest: { url: 'https://scores.test', key: 'public-test-key' } } });
const fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: opts.method === 'POST' ? 201 : 200, json: async () => [] }; };
`;
let instance = 0;
const board = () => import('data:text/javascript;base64,' + Buffer.from(harness + source).toString('base64') + `#${instance++}`);

test('v3 本机最佳独立计算，保留旧 v2 成绩', async () => {
  const b = await board();
  assert.equal(b.localBest(), null);
  assert.equal(b.saveLocalBest(190, 94).newTotal, true);
  assert.deepEqual(b.localBest(), { total: 190, lap: 94 });
  b.saveLocalBest(195, 93);
  assert.deepEqual(b.localBest(), { total: 190, lap: 93 });
  assert.equal(b.stored.get('race.best.v2'), '{"total":120,"lap":60}');
});

test('v3 上传沿用玩家身份、发送新版物理版本和正确的圈速', async () => {
  const b = await board();
  const key = 'test-player-0123456789abcdef0123456789abcdef';
  b.stored.set('race.player', key);
  b.connect();
  await b.submit({ nick: '西湖车手', laps: [95.125, 92.875] });
  const request = b.calls.find(c => c.opts.method === 'POST');
  assert.equal(request.url, 'https://scores.test/rest/v1/race_scores');
  assert.deepEqual(JSON.parse(request.opts.body), {
    player_key: key, nickname: '西湖车手', laps: 2, lap_ms: [95125, 92875], total_ms: 188000, best_lap_ms: 92875, version: '3',
  });
});
