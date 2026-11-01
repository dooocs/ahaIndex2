// 所有可调参数集中在这里，部署时通过 .env 覆盖。

const num = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`环境变量 ${name} 不是数字：${raw}`);
  return n;
};

export const config = {
  port: num('PORT', 2567),

  // 全服同时在线上限（含匹配中、比赛中、看结算的玩家）
  maxPlayersGlobal: num('MAX_PLAYERS_GLOBAL', 20),

  // 每局人数
  minPlayersPerRace: num('MIN_PLAYERS_PER_RACE', 2),
  maxPlayersPerRace: num('MAX_PLAYERS_PER_RACE', 4),

  // 凑够最少人数后，再等多久看还有没有人加入；满 4 人则立即开始
  waitForMoreMs: num('WAIT_FOR_MORE_MS', 8000),
  // 锁房后到发车的倒计时（客户端显示 3、2、1、GO）
  countdownMs: num('COUNTDOWN_MS', 4000),
  // 第一名冲线后，其他人还有多久可以完赛
  finishGraceMs: num('FINISH_GRACE_MS', 30000),
  // 单局最长时间，防止房间永远不结束
  maxRaceMs: num('MAX_RACE_MS', 10 * 60 * 1000),
  // 结算画面停留多久后关闭房间
  resultsLingerMs: num('RESULTS_LINGER_MS', 15000),
  // 掉线后保留座位多少秒
  reconnectSeconds: num('RECONNECT_SECONDS', 20),

  // 允许发起连接的网页来源；没有 Origin 头的请求（如服务器脚本）放行
  allowedOrigins: (process.env.ALLOWED_ORIGINS ||
    'https://amazingindex.com,https://www.amazingindex.com,https://game.amazingindex.com,http://localhost:4321,http://localhost:2567')
    .split(',').map((s) => s.trim()).filter(Boolean),

  // 阿里云 Supabase（社区库）：只用来写联机成绩
  supabase: {
    url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
};

export const supabaseEnabled = () => Boolean(config.supabase.url && config.supabase.serviceKey);
