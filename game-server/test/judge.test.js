// 判定逻辑单测：沿西湖赛道真实中心线走，验证检查点、计圈、防抄近路、速度额度。
// 运行：npm run test:unit

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getTrack } from '../src/tracks.js';
import { advanceCheckpoints, checkSpeed } from '../src/judge.js';

const xihu = getTrack('xihu');
// [x, z, 右向量 x, 右向量 z]，从起点线开始沿行驶方向每 3 米一个点
const line = JSON.parse(readFileSync(new URL('./fixtures/xihu-centerline.json', import.meta.url), 'utf8'));

/** 从发车位出发，沿中心线（可带横向偏移）走 laps 圈，可选跳过某一段。 */
function drive({ laps = 2, lat = 0, skip = null, slot = 0, extra = 0 } = {}) {
  const progress = { lap: 0, cp: 0 };
  const g = xihu.grid[slot];
  let px = g.x;
  let pz = g.z;
  let lapEvents = 0;
  let finishedAt = -1;
  const total = laps * line.length + extra;
  for (let k = 0; k < total; k++) {
    const i = k % line.length;
    if (skip && i >= skip[0] && i < skip[1]) continue;
    const [x, z, rx, rz] = line[i];
    const nx = x + rx * lat;
    const nz = z + rz * lat;
    const res = advanceCheckpoints(xihu, progress, px, pz, nx, nz);
    lapEvents += res.lapsDone;
    if (res.finished && finishedAt < 0) finishedAt = k;
    px = nx;
    pz = nz;
  }
  return { progress, lapEvents, finishedAt };
}

test('导出的西湖赛道数据完整', () => {
  assert.equal(xihu.laps, 2);
  assert.equal(xihu.checkpoints.length, 20);
  assert.equal(xihu.grid.length, 4);
  const finish = xihu.checkpoints.at(-1);
  // 终点线检查点就是 layout.js 的 START_AT（平海路，龙翔桥）
  assert.ok(Math.hypot(finish.x - 604, finish.z + 46) < 2, `终点线在 ${finish.x},${finish.z}`);
});

test('沿中心线跑满 2 圈正好完赛', () => {
  const r = drive({ laps: 2, extra: 5 });
  assert.equal(r.lapEvents, 2);
  assert.equal(r.progress.lap, 2);
  // 在第二圈最后几个点（回到起终点线）时完赛，不早不晚
  assert.ok(r.finishedAt >= 2 * line.length - 3 && r.finishedAt <= 2 * line.length + 4, `finishedAt=${r.finishedAt}`);
});

test('只跑 1 圈多一点不算完赛', () => {
  const r = drive({ laps: 1, extra: 200 });
  assert.equal(r.progress.lap, 1);
  assert.equal(r.finishedAt, -1);
});

test('贴着路边（左右各偏 10 米）也能通过所有检查点', () => {
  for (const lat of [-10, 10]) {
    for (const slot of [0, 1, 2, 3]) {
      const r = drive({ laps: 2, lat, slot, extra: 5 });
      assert.equal(r.progress.lap, 2, `lat=${lat} slot=${slot}`);
      assert.ok(r.finishedAt > 0);
    }
  }
});

test('跳过一段路（瞬移抄近路）无法完赛', () => {
  // 跳过第 400–700 个点（约 1.2–2.1 公里处，三台山前后）
  const r = drive({ laps: 2, skip: [400, 700], extra: 5 });
  assert.equal(r.finishedAt, -1);
  assert.equal(r.progress.lap, 0, '漏掉的检查点之后一圈都不能计');
});

test('倒着开不计圈', () => {
  const progress = { lap: 0, cp: 0 };
  let [px, pz] = line[0];
  for (let k = line.length * 2; k > 0; k--) {
    const [x, z] = line[k % line.length];
    advanceCheckpoints(xihu, progress, px, pz, x, z);
    px = x;
    pz = z;
  }
  assert.equal(progress.lap, 0);
  assert.equal(progress.cp, 0, '反向穿门一个都不算');
});

test('速度额度：网络抖动扎堆到达不误判，真超速会被拦', () => {
  const max = xihu.maxSpeed; // 85 m/s
  // 正常 72 m/s，每 50ms 一条：一直通过
  let a = max * 0.5;
  for (let i = 0; i < 200; i++) {
    const r = checkSpeed(a, max, 0.05, 72 * 0.05);
    assert.ok(r.ok);
    a = r.allowance;
  }
  // 卡顿 300ms 后 6 条消息同时到（间隔 0）：靠攒下的额度吸收
  let r = checkSpeed(a, max, 0.3, 72 * 0.05);
  assert.ok(r.ok);
  for (let i = 0; i < 5; i++) {
    r = checkSpeed(r.allowance, max, 0, 72 * 0.05);
    assert.ok(r.ok, `扎堆第 ${i + 1} 条被误判`);
  }
  // 一帧瞬移 150 米：拦下
  assert.equal(checkSpeed(max, max, 0.05, 150).ok, false);
  // 持续 120 m/s：几帧之内被拦
  let b = max * 0.5;
  let blocked = false;
  for (let i = 0; i < 40 && !blocked; i++) {
    const s = checkSpeed(b, max, 0.05, 120 * 0.05);
    blocked = !s.ok;
    b = s.allowance;
  }
  assert.ok(blocked);
});
