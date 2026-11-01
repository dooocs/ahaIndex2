// 成绩榜：个人最佳 + 总榜。数据在社区库（阿里云 Supabase）的 race_scores 表 / race_leaderboard 视图里，
// 浏览器用公开的 publishable key 直连 PostgREST（见 sql/race/001_race_scores.sql）。
// 外层页面（src/pages/race.astro）通过 postMessage 把 { url, key } 交给这里；直接打开 app.html（没有外层）时只有本机最佳。
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 无痕模式等，忽略 */ } },
};

let cfg = null, cfgWait = null;
const ready = new Promise(res => { cfgWait = res; });
setTimeout(() => cfgWait(null), 4000);          // 4 秒内没收到配置就当没有服务器
addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.type !== 'race:config') return;
  const r = e.data.rest;
  if (r && typeof r.url === 'string' && typeof r.key === 'string') { cfg = { url: r.url.replace(/\/+$/, ''), key: r.key }; cfgWait(cfg); }
});
export const online = () => ready.then(c => !!c);

// 玩家身份：本机随机密钥（只在上传时发出，服务器存它的 sha256），以及哈希后的 id（用来查自己的成绩）
function playerKey() {
  let k = LS.get('race.player');
  if (!k || k.length < 32) {
    const a = new Uint8Array(24); crypto.getRandomValues(a);
    k = 'p' + Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    LS.set('race.player', k);
  }
  return k;
}
async function playerId() {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(playerKey()));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}
export const nickname = () => LS.get('race.nick') || '';
export const setNickname = n => LS.set('race.nick', n);

// 本机最佳（离线也有）
export function localBest() { try { return JSON.parse(LS.get('race.best.v2') || 'null'); } catch { return null; } }
export function saveLocalBest(total, lap) {
  const b = localBest() || {};
  const out = { total: Math.min(b.total ?? Infinity, total), lap: Math.min(b.lap ?? Infinity, lap) };
  LS.set('race.best.v2', JSON.stringify(out));
  return { out, newTotal: total < (b.total ?? Infinity), newLap: lap < (b.lap ?? Infinity) };
}

async function rest(path, opts = {}) {
  const c = await ready;
  if (!c) throw new Error('offline');
  const res = await fetch(`${c.url}/rest/v1/${path}`, {
    ...opts,
    cache: 'no-store',
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.message || msg; } catch { /* 不是 JSON */ }
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return res.status === 204 || res.status === 201 ? null : res.json();
}

// 上传一场成绩（两圈），返回服务器上的个人最佳和名次
export async function submit({ nick, laps }) {
  const lap_ms = laps.map(t => Math.round(t * 1000));
  const total_ms = lap_ms.reduce((a, b) => a + b, 0);
  await rest('race_scores', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ player_key: playerKey(), nickname: nick, laps: lap_ms.length, lap_ms, total_ms, best_lap_ms: Math.min(...lap_ms), version: '2' }),
  });
  return myBest();
}
// 我在总榜上的最佳（含名次）；没交过成绩返回 null
export async function myBest() {
  const id = await playerId();
  const rows = await rest(`race_leaderboard?select=rank,nickname,total_ms,best_lap_ms&player_id=eq.${id}`);
  return rows && rows[0] ? rows[0] : null;
}
// 总榜前 n 名
export async function top(n = 50) {
  const rows = await rest(`race_leaderboard?select=rank,player_id,nickname,total_ms,best_lap_ms&order=rank.asc&limit=${n}`);
  const me = await playerId();
  return rows.map(r => ({ ...r, me: r.player_id === me }));
}
// 把服务器的拒绝原因翻成人话
export function why(err) {
  const m = String(err && err.message || '');
  if (m === 'offline') return '排行榜要在向上研究所站内打开才能上传';
  if (/too many submissions/.test(m)) return '刚交过一次成绩，等一分多钟再交';
  if (/check|violates/.test(m)) return '这条成绩没通过校验，没有上传';
  if (err && err.status === 404 || /does not exist|Could not find the table|schema cache/.test(m)) return '排行榜还没开放，成绩已记在本机';
  return '网络不太好，成绩没传上去，稍后可以再试';
}
