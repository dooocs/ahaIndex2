// 把联机成绩写进阿里云 Supabase 的 race_mp_results（建表见 sql/race/003_race_mp_results.sql）。
// 只用 fetch 调 PostgREST，不引入 supabase-js。只有服务器持有 service role key，
// 浏览器端对这张表没有写权限，所以联机榜不能被伪造。

import { config, supabaseEnabled } from './config.js';

const TIMEOUT_MS = 4000;

async function fetchWithTimeout(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 一局的成绩逐行写入：某一行被表约束拒绝（比如同一浏览器开两个标签页用了同一个密钥），不影响其他人。 */
export async function insertResults(rows) {
  if (!rows.length) return { ok: true, skipped: 'no rows' };
  if (!supabaseEnabled()) {
    console.log('[supabase] 未配置，跳过写库：', JSON.stringify(rows));
    return { ok: false, skipped: 'not configured' };
  }
  const results = await Promise.all(rows.map(insertRow));
  return { ok: results.every((r) => r.ok) };
}

async function insertRow(row) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchWithTimeout(`${config.supabase.url}/rest/v1/race_mp_results`, {
        method: 'POST',
        headers: {
          apikey: config.supabase.serviceKey,
          Authorization: `Bearer ${config.supabase.serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(row),
      });
      if (res.ok) return { ok: true };
      const text = await res.text();
      console.error(`[supabase] 写成绩失败（第 ${attempt} 次，${row.nickname}）：${res.status} ${text}`);
      if (res.status < 500) break; // 4xx 重试也没用
    } catch (err) {
      console.error(`[supabase] 写成绩异常（第 ${attempt} 次）：`, err.message);
    }
  }
  return { ok: false };
}
