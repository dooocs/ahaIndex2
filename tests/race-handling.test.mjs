import test from 'node:test';
import assert from 'node:assert/strict';
import { driver, IDLE } from './helpers/race.mjs';
const input = o => ({ ...IDLE, ...o });
const frame = 1 / 60;

test('松开漂移立即恢复抓地，且保留小喷窗口', () => {
  const p = driver();
  Object.assign(p, { drift: true, driftT: 0.8, driftDir: 1, h: 0.55, m: 0.1, s: 28 });
  p.update(frame, input({ up: true }), true);
  assert.equal(p.drift, false);
  assert.equal(p.slip, 0);
  assert.ok(Math.abs(p.h - p.m) < 1e-10);
  assert.ok(p.window > 0);
  assert.equal(p.windowKind, 'drift');
  assert.equal(p.events.filter(e => e.type === 'driftEnd').length, 1);
  p.update(frame, input({ up: true }), true);
  assert.equal(p.drift, false, '松开 Shift 后不应自动重新漂移');
});

test('松开漂移但仍打方向也必须结束侧滑', () => {
  const p = driver();
  Object.assign(p, { drift: true, driftT: 0.6, driftDir: 1, h: 0.55, m: 0.12, s: 30 });
  p.update(frame, input({ up: true, left: true }), true);
  assert.equal(p.drift, false);
  assert.ok(Math.abs(p.h - p.m) < 0.025);
});

test('普通方向有街机抓地、仍保留高速转向半径', () => {
  const p = driver();
  p.s = 28;
  for (let i = 0; i < 60; i++) p.update(frame, input({ up: true, left: true }), true);
  assert.ok(p.h > 0.48, `转向响应过弱：${p.h.toFixed(2)} rad`);
  assert.ok(p.h < 1.3);
});

test('漂移中反打方向可以主动收角', () => {
  const p = driver();
  p.s = 28;
  for (let i = 0; i < 20; i++) p.update(frame, input({ up: true, left: true, drift: true }), true);
  assert.equal(p.drift, true);
  const h = p.h;
  for (let i = 0; i < 8; i++) p.update(frame, input({ up: true, right: true, drift: true }), true);
  assert.ok(p.h < h, '反打方向应让车头角度回收');
});

test('浅角度擦墙保留绝大多数平行动量', () => {
  const p = driver(15);
  p.x = 15 - 1.15 - 0.01;
  p.h = p.m = 0.35; p.s = 40;
  p.update(frame, input({ up: false }), true);
  assert.ok(p.impact > 0);
  assert.ok(p.s > 34, `不该重刹：${p.s}`);
  assert.ok(p.s < 40, '碰撞不能提速');
  assert.ok(Math.abs(p.m) < 0.01, '运动方向应顺墙滑动');
});

test('斜撞墙不会直接归零，连续擦墙不会逐帧重罚', () => {
  const p = driver(15);
  p.x = 15 - 1.15 - 0.01; p.h = p.m = 0.55; p.s = 40;
  p.update(frame, input({ up: false }), true);
  assert.ok(p.s > 29, `斜撞不该直接停：${p.s}`);
  const first = p.s;
  for (let i = 0; i < 15; i++) p.update(frame, input({ up: false }), true);
  assert.ok(p.s > first * 0.75, `持续撞墙不能高速消耗：${p.s}`);
});

test('正面撞墙仍可能停下，保留高手绕墙的价值', () => {
  const p = driver(15);
  p.x = 15 - 1.15 - 0.01; p.h = p.m = Math.PI / 2; p.s = 40;
  p.update(frame, input({ up: false }), true);
  assert.ok(p.s < 1);
});

test('漂移的优势与代价同时存在（保留高手操作空间）', () => {
  const grip = driver(10000), drift = driver(10000);
  grip.s = drift.s = 35;
  for (let i = 0; i < 60; i++) {
    grip.update(frame, input({ up: true, left: true }), true);
    drift.update(frame, input({ up: true, left: true, drift: true }), true);
  }
  assert.ok(drift.m > grip.m + 0.2, '漂移应让实际运动方向转得更快');
  assert.ok(drift.s < grip.s - 5, '漂移应有明确的掉速成本');
  assert.ok(drift.gauge > 0 && grip.gauge === 0, '真实漂移才能集气');
});

test('轻点漂移立即收住，不奖励短促点按；完整漂移可衔接小喷和双喷', () => {
  const tap = driver();
  tap.s = 28;
  for (let i = 0; i < 10; i++) tap.update(frame, input({ up: true, left: true, drift: true }), true);
  tap.update(frame, input({ up: true }), true);
  assert.equal(tap.drift, false);
  assert.equal(tap.window, 0);
  assert.equal(tap.gauge, 0);

  const p = driver();
  p.s = 28;
  for (let i = 0; i < 42; i++) p.update(frame, input({ up: true, left: true, drift: true }), true);
  p.update(frame, input({ up: true }), true);
  assert.ok(p.window > 0);
  p.update(frame, input({ up: true, upPressed: true }), true);
  assert.ok(p.smallT > 0);
  assert.equal(p.window, 0);
  assert.ok(p.events.some(e => e.type === 'small' && e.perfect));
  p.nitroN = 1;
  p.update(frame, input({ up: true, nitroPressed: true }), true);
  assert.equal(p.nitroN, 0);
  assert.ok(p.nitroT > 2.6, '小喷后衔接氮气应有双喷奖励');
  assert.ok(p.events.some(e => e.type === 'double'));
});

test('小喷窗口过期后不能补喷', () => {
  const p = driver();
  Object.assign(p, { drift: true, driftT: 0.8, driftDir: 1, h: 0.4, m: 0.1, s: 28 });
  p.update(frame, input({ up: true }), true);
  for (let i = 0; i < 40; i++) p.update(frame, input({ up: true }), true);
  p.update(frame, input({ up: true, upPressed: true }), true);
  assert.equal(p.smallT, 0);
  assert.equal(p.events.filter(e => e.type === 'small').length, 0);
});

test('长时间压墙会损失速度，松开方向离墙后摩擦计时清零', () => {
  const p = driver(15);
  p.x = 13.84; p.h = p.m = 0.35; p.s = 40;
  for (let i = 0; i < 180; i++) p.update(frame, input({ up: true, left: true }), true);
  assert.ok(p.s > 8 && p.s < 30, `持续压墙应逐渐减速而不是骤停或全速：${p.s}`);
  assert.ok(p.events.filter(e => e.type === 'crash' || e.type === 'scrape').length <= 13);
  p.x = 0; p.h = p.m = 0;
  for (let i = 0; i < 120; i++) p.update(frame, input({ up: true }), true);
  assert.equal(p.wallT, 0);
  assert.ok(p.s > 30, '离墙后应正常加速');
});

for (const hz of [30, 60, 120]) test(`${hz} Hz：双侧斜擦保速，松漂同帧结束`, () => {
  for (const side of [-1, 1]) {
    const p = driver(15);
    p.x = side * 13.849; p.h = p.m = side * 0.35; p.s = 40;
    p.update(1 / hz, input({}), true);
    assert.ok(p.s > 34 && p.s < 40);
    assert.ok(Math.abs(p.m) < 0.01);
    assert.ok(Math.abs(p.lat) <= 13.85);
  }
  const p = driver();
  Object.assign(p, { drift: true, driftT: 0.8, driftDir: 1, h: 0.55, m: 0.1, s: 28 });
  p.update(1 / hz, input({ up: true }), true);
  assert.equal(p.drift, false);
  assert.equal(p.slip, 0);
  assert.ok(Math.abs(p.h - p.m) < 1e-10);
});
