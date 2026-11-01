// 本地联机仿真：起一个服务端，用多个模拟玩家跑完整流程并检查结果。
// 运行：npm test（会自动用较短的等待时间启动服务端）

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';

const PORT = 25670;
const ENDPOINT = `http://localhost:${PORT}`;
const env = {
  ...process.env,
  PORT: String(PORT),
  MAX_PLAYERS_GLOBAL: '7',
  WAIT_FOR_MORE_MS: '1500',
  COUNTDOWN_MS: '1500',
  FINISH_GRACE_MS: '8000',
  RESULTS_LINGER_MS: '3000',
  RECONNECT_SECONDS: '10',
  SUPABASE_URL: '',
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const server = spawn(process.execPath, ['src/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${ENDPOINT}/health`);
      if (res.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error('服务端没起来');
}

const status = async () => (await fetch(`${ENDPOINT}/status`)).json();

/** 一个模拟玩家：沿测试椭圆赛道中心线以给定速度行驶。 */
async function makePlayer(name, { speed = 70, cheat = false } = {}) {
  const client = new Client(ENDPOINT);
  const room = await client.joinOrCreate('xihu_race', { track: 'test-oval', name });
  room.reconnection.minUptime = 1000; // 默认 5 秒内掉线不自动重连，比赛场景要放宽
  const p = { name, room, finish: null, results: null, theta: Math.PI / 2, timer: null, dropped: 0, reconnected: 0 };
  // 从自己的发车位出发：取发车位在椭圆上对应的角度
  room.onMessage('welcome', (w) => {
    const g = w.track.grid[w.slot];
    if (g && room.state?.phase !== 'racing') p.theta = Math.atan2(g.z / 180, g.x / 300);
  });
  room.onMessage('time', () => {});
  room.onMessage('finish', (m) => { if (m.sessionId === room.sessionId) p.finish = m; });
  room.onMessage('results', (m) => { p.results = m; });
  room.onDrop(() => { p.dropped++; });
  room.onReconnect(() => { p.reconnected++; });

  const rx = 300; const rz = 180;
  const drive = () => {
    if (room.state?.phase !== 'racing') return;
    const me = room.state.racers.get(room.sessionId);
    if (!me || me.finished) return;
    const dt = 0.05;
    if (cheat) {
      p.theta += 0.6; // 每帧跳一大段，明显超速
    } else {
      const ds = Math.hypot(rx * Math.sin(p.theta), rz * Math.cos(p.theta));
      p.theta += (speed * dt) / ds;
    }
    const x = rx * Math.cos(p.theta);
    const z = rz * Math.sin(p.theta);
    room.send('s', { x, y: 0, z, r: p.theta + Math.PI / 2, v: speed });
  };
  p.timer = setInterval(drive, 50);
  p.stop = () => clearInterval(p.timer);
  return p;
}

const phaseOf = (p) => p.room.state?.phase;

async function waitUntil(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return true;
    await sleep(50);
  }
  console.log(`   等待超时：${label}`);
  return false;
}

try {
  await waitForServer();

  // ── 场景 1：2 人匹配，等待更多玩家后开局，跑完 2 圈，服务器判定名次 ──
  const a = await makePlayer('阿甘', { speed: 72 });
  const b = await makePlayer('小贝', { speed: 66 });
  check('两人被匹配进同一个房间', a.room.roomId === b.room.roomId);
  await sleep(300);
  check('两人到齐后进入「等待更多玩家」', phaseOf(a) === 'waiting' && a.room.state.waitEndsAt > 0);
  await waitUntil(() => phaseOf(a) === 'countdown', 3000, 'countdown');
  check('等待结束自动开始倒计时', phaseOf(a) === 'countdown');

  // ── 场景 2：倒计时期间来的人进新房间；凑满 4 人立即开局（不再等待） ──
  const c = await makePlayer('丙');
  check('开跑后的房间不再进人，新玩家进了新房间', c.room.roomId !== a.room.roomId);
  const d = await makePlayer('丁');
  const e = await makePlayer('戊', { cheat: true });
  const f = await makePlayer('己');
  check('4 人凑满同一房间', [d, e, f].every((p) => p.room.roomId === c.room.roomId));
  await sleep(300);
  check('满 4 人立即倒计时，不再等待', phaseOf(c) === 'countdown');

  // ── 场景 3：全服上限（测试时设为 7 人）──
  const g = await makePlayer('庚');
  let rejected = null;
  try { await makePlayer('辛'); } catch (err) { rejected = err; }
  check('超过全服上限的玩家被拒绝', Boolean(rejected), rejected?.message);
  const st = await status();
  check('/status 显示在线人数和已满', st.online === 7 && st.full === true, JSON.stringify(st));
  g.room.leave();
  await sleep(300);
  check('有人离开后名额释放', (await status()).online === 6);

  // ── 场景 4：比赛中掉线并自动重连 ──
  await waitUntil(() => phaseOf(c) === 'racing', 4000, 'room2 racing');
  await sleep(3000);
  d.room.connection.close(4010, 'simulated network drop'); // 与浏览器断网时 SDK 的处理一致
  await waitUntil(() => d.reconnected > 0, 8000, 'reconnect');
  check('比赛中掉线后自动重连回原房间', d.reconnected > 0 && d.room.state.racers.get(d.room.sessionId)?.connected === true,
    `drop=${d.dropped} reconnect=${d.reconnected}`);

  // 等两个房间都比完
  await waitUntil(() => a.results && b.results && c.results, 75000, 'all results');
  const r1 = a.results?.results || [];
  check('房间 1 两人都完赛', r1.filter((x) => x.finishMs).length === 2, JSON.stringify(r1));
  check('房间 1 名次正确（快的赢）', r1[0]?.name === '阿甘' && r1[0]?.place === 1);
  const expected = Math.round((1531 * 2 / 72) * 1000);
  check('完赛用时由服务器计算且合理', r1[0] && Math.abs(r1[0].finishMs - expected) < 4000, `阿甘 ${r1[0]?.finishMs}ms，理论约 ${expected}ms`);
  const laps = r1[0]?.lapMs || [];
  check('服务器记录了每圈用时，两圈相加等于总用时', laps.length === 2 && Math.abs(laps[0] + laps[1] - r1[0].finishMs) <= 2, JSON.stringify(laps));

  const r2 = c.results?.results || [];
  const cheater = r2.find((x) => x.name === '戊');
  check('瞬移玩家无法通过检查点，记为未完赛', cheater && cheater.finishMs === null, JSON.stringify(cheater));
  check('掉线重连的玩家照常完赛', Boolean(r2.find((x) => x.name === '丁')?.finishMs));

  let last = null;
  await (async () => { for (let i = 0; i < 100; i++) { last = await status(); if (last.online === 0 && last.rooms === 0) return; await sleep(100); } })();
  check('结算后房间关闭、名额全部释放', last.online === 0 && last.rooms === 0, JSON.stringify(last));
} catch (err) {
  console.error('测试异常：', err);
  results.push({ name: 'exception', ok: false });
} finally {
  server.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) {
    console.log('\n服务端日志：\n' + serverLog.join(''));
    process.exitCode = 1;
  }
  setTimeout(() => process.exit(), 200);
}
