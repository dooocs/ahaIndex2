// 西湖赛道全流程（约 2 分半）：两个模拟玩家沿真实中心线跑满 2 圈，
// 验证服务器判定完赛、每圈用时，以及写给 Supabase 的成绩行（用一个假的 PostgREST 接住）。
// 运行：npm run test:xihu

import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';

const line = JSON.parse(readFileSync(new URL('./fixtures/xihu-centerline.json', import.meta.url), 'utf8'));
const PORT = 25680;

// 假的 PostgREST：记录收到的成绩
const posted = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const parsed = JSON.parse(body || '[]');
    posted.push({ url: req.url, auth: req.headers.authorization, prefer: req.headers.prefer, rows: Array.isArray(parsed) ? parsed : [parsed] });
    res.writeHead(201).end();
  });
}).listen(0);
await new Promise((r) => fake.on('listening', r));

const server = spawn(process.execPath, ['src/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    WAIT_FOR_MORE_MS: '1000',
    COUNTDOWN_MS: '1000',
    SUPABASE_URL: `http://127.0.0.1:${fake.address().port}`,
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** 沿中心线以恒定速度开（按弧长插值），从自己的发车位附近的中心线点出发。 */
async function racer(name, speed, key) {
  const room = await new Client(`http://localhost:${PORT}`).joinOrCreate('xihu_race', { track: 'xihu', name, playerKey: key });
  const me = { room, results: null, slot: 0 };
  room.onMessage('welcome', (w) => { me.slot = w.slot; me.grid = w.track.grid[w.slot]; });
  room.onMessage('time', () => {});
  room.onMessage('finish', () => {});
  room.onMessage('results', (m) => { me.results = m; });
  let idx = -1;
  let carry = 0;
  me.timer = setInterval(() => {
    if (room.state?.phase !== 'racing' || !me.grid) return;
    if (idx < 0) {
      // 发车位最近的中心线点
      let best = Infinity;
      line.forEach(([x, z], i) => { const d = Math.hypot(x - me.grid.x, z - me.grid.z); if (d < best) { best = d; idx = i; } });
    }
    carry += speed * 0.05;
    while (carry >= 3) { idx++; carry -= 3; }
    const [x, z] = line[idx % line.length];
    room.send('s', { x, y: 0, z, r: 0, v: speed });
  }, 50);
  return me;
}

try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${PORT}/health`)).ok) break; } catch {} await sleep(100); }
  const keyA = 'p' + randomBytes(24).toString('hex');
  const a = await racer('阿甘', 68, keyA);
  const b = await racer('游客车手', 66, ''); // 不带密钥：能比赛，但不写库
  check('两人进同一房间', a.room.roomId === b.room.roomId);

  const t0 = Date.now();
  while (!a.results && Date.now() - t0 < 200000) await sleep(500);
  const res = a.results?.results || [];
  console.log(JSON.stringify(res));
  const ra = res.find((r) => r.name === '阿甘');
  const rb = res.find((r) => r.name === '游客车手');
  check('沿西湖赛道跑满 2 圈，两人都完赛', Boolean(ra?.finishMs && rb?.finishMs));
  check('名次正确', ra?.place === 1 && rb?.place === 2);
  check('每圈用时两段、相加等于总用时', ra?.lapMs?.length === 2 && Math.abs(ra.lapMs[0] + ra.lapMs[1] - ra.finishMs) <= 2, JSON.stringify(ra?.lapMs));

  await sleep(1000);
  const rows = posted.flatMap((p) => p.rows);
  check('写库请求带 service key、发到 race_mp_results', posted.length === 1 && posted[0].url === '/rest/v1/race_mp_results' && posted[0].auth === 'Bearer test-service-key');
  check('只有带密钥的玩家写库', rows.length === 1 && rows[0].nickname === '阿甘', JSON.stringify(rows));
  const expectedId = createHash('sha256').update(keyA).digest('hex');
  check('player_id 是密钥的 sha256，与单机榜一致', rows[0]?.player_id === expectedId);
  check('成绩行字段齐全', rows[0] && rows[0].laps === 2 && rows[0].total_ms === ra.finishMs && rows[0].best_lap_ms === Math.min(...ra.lapMs)
    && rows[0].place === 1 && rows[0].players === 2 && rows[0].track === 'xihu', JSON.stringify(rows[0]));
} finally {
  server.kill();
  fake.close();
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(), 200);
}
