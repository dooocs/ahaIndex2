// Local stand-in for the news pipeline's Supabase REST API, for builds without
// production credentials. It serves deterministic synthetic rows and implements
// the PostgREST features this repository uses: select, eq/neq/gt/gte/lt/lte/in,
// multi-column order, offset/limit, and the hosted default cap of 1000 rows.
//
//   node scripts/dev/mock-supabase.mjs            # listens on 127.0.0.1:54399
//   SUPABASE_URL=http://127.0.0.1:54399 SUPABASE_BUILD_KEY=sb_publishable_mock npm run build
//
// MOCK_LATEST_DATE (YYYY-MM-DD) hides every row dated after it, which simulates
// the pipeline adding a new edition between two builds. MOCK_FEED_FILE (a JSON
// array of proc_feed_posts rows, e.g. exported from production) replaces the
// synthetic 动态 posts, to look at /feed with real text.
import http from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.MOCK_SUPABASE_PORT || 54399);
const MAX_ROWS = 1000;

function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function uuid(n) {
  const hex = n.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function buildFixture() {
  const rand = prng(20261013);
  let next = 1;
  const id = () => uuid(next++);
  const pick = (list) => list[Math.floor(rand() * list.length)];

  const dates = [];
  for (let date = '2025-12-20'; date <= '2026-02-20'; date = addDays(date, 1)) {
    if (date.endsWith('-25') || date.endsWith('-05')) continue; // missing editions
    dates.push(date);
  }

  const sources = ['GitHub', 'HackerNews', 'arXiv', 'RSS', 'Twitter'];
  const tagPool = ['Agent', 'LLM', 'RAG', '开源', '多模态', '推理', '工具'];
  const displayItems = [];
  const archives = [];
  const reused = [];
  for (const date of dates) {
    const rows = [];
    for (let rank = 1; rank <= 20; rank++) {
      // A few stories reappear on later days, as they do in production.
      const pid = rank === 20 && reused.length > 0 ? reused.shift() : `p-${date.replaceAll('-', '')}-${String(rank).padStart(2, '0')}`;
      const aha = Math.round((0.55 + rand() * 0.44) * 1000) / 1000;
      rows.push({
        id: id(),
        processed_item_id: pid,
        snapshot_date: date,
        source_name: pick(sources),
        content_type: 'snapshot',
        original_url: `https://example.com/${pid}`,
        author: null,
        processed_title: `${date} 精选 ${rank}：${pick(tagPool)} 进展 <${pid}> & 测试`,
        summary: `摘要 ${pid}，包含 "引号" 与 & 符号。`,
        category: pick(['AI', 'DEV', 'RESEARCH']),
        tags: [pick(tagPool), pick(tagPool), pick(tagPool)],
        keywords: null,
        aha_index: aha,
        expert_insight: `第一段观点 ${pid}\n第二段观点`,
        display_metrics: { items: [{ label: '⭐ Stars', value: String(Math.floor(rand() * 9000)) }] },
        raw_metrics: null,
        extra: null,
        rank,
        model: 'mock',
        created_at: `${date}T01:00:00Z`,
      });
    }
    displayItems.push(...rows);
    reused.push(rows[2].processed_item_id); // reappears as tomorrow's last story
    const score = rows.reduce((s, r) => s + r.aha_index, 0) / rows.length * 100;
    archives.push({
      snapshot_date: date,
      aha_score: Math.round(score * 10) / 10,
      aha_delta: '',
      item_count: rows.length,
      top_story_title: rows[0].processed_title,
      top_story_source: rows[0].source_name,
      top_tags: rows[0].tags,
      rarity_score: 0,
      timeliness_score: 0,
      impact_score: 0,
      percentile_90d: Math.round(rand() * 100),
      percentile_tier: pick(['p90_plus', 'p70_p90', 'below_p70']),
      sample_size_90d: 90,
    });
  }

  const tracks = [
    { id: 't-agent', slug: 'agent', display_name: 'Agent', display_name_en: 'Agent', group_name: 'Apps', description: '', cover_color: '#000', display_order: 1, status: 'active' },
    { id: 't-infra', slug: 'infra', display_name: '基础设施', display_name_en: 'Infra', group_name: 'Infra', description: '', cover_color: '#000', display_order: 2, status: 'active' },
  ];

  const heatmap = [];
  for (let p = 1; p <= 30; p++) {
    const subjectId = id();
    const slug = p === 7 ? 'ComfyUI' : `project-${p}`;
    const track = p % 2 ? tracks[0] : tracks[1];
    for (const date of dates) {
      if (rand() > 0.35) continue;
      heatmap.push({
        id: '', subject_id: subjectId, subject_slug: slug, subject_name: `Project ${p}`, subject_type: 'project',
        track_id: track.id, track_name: track.display_name, track_group: track.group_name, snapshot_date: date,
        score_100: Math.round(rand() * 1000) / 10, role: 'primary', source_name: pick(sources), tags: [pick(tagPool)],
        summary: `Project ${p} summary`, first_seen_at: `${dates[0]}T00:00:00Z`, last_seen_at: `${dates.at(-1)}T00:00:00Z`,
        mention_count: 3, related_data: null,
      });
    }
  }
  heatmap.forEach((row) => { row.id = id(); });

  const subjects = [];
  const stats = [];
  const mentions = [];
  const insights = [];
  const rawItems = [];
  const sectionsBySlug = ['model', 'company', 'person', 'product'];
  for (let s = 1; s <= 26; s++) {
    const subjectId = id();
    const visible = s !== 26;
    subjects.push({
      id: subjectId, // Production slugs look like company:xiaomi.
      slug: s % 2 ? `${sectionsBySlug[s % 4]}:subject-${s}` : `subject-${s}`, type: sectionsBySlug[s % 4], display_name: `专题 ${s}`,
      aliases: [`S${s}`, `Alias ${s}`], description: `专题 ${s} 描述`, definition: s % 3 ? `专题 ${s} 定义 & "说明"` : null,
      homepage_url: s % 2 ? `https://example.com/subject-${s}` : null, metadata: null,
      first_seen_at: `${dates[0]}T00:00:00Z`, last_seen_at: `${dates.at(-s % 10 - 1)}T00:00:00Z`, mention_count: 60,
      status: 'active', directory_visible: visible, section_slug: sectionsBySlug[s % 4], curation_priority: s % 5, created_by: null,
    });
    stats.push({ subject_id: subjectId, mention_count: 60, first_seen_at: `${dates[0]}T00:00:00Z`, last_seen_at: `${dates.at(-1)}T00:00:00Z`, item_count: 60 });
    for (let m = 0; m < 60; m++) {
      const item = displayItems[Math.floor(rand() * displayItems.length)];
      const raw = m % 7 === 0;
      const itemId = raw ? id() : item.processed_item_id;
      if (raw) rawItems.push({ id: itemId, snapshot_date: item.snapshot_date, sub_source_type: 'rss', title: `Raw ${itemId}`, content: 'raw content', url: 'https://example.com/raw' });
      mentions.push({
        subject_id: subjectId, item_id: itemId, snapshot_date: item.snapshot_date, source_name: item.source_name,
        score: item.aha_index, context: `context ${m}`, created_at: `${item.snapshot_date}T0${m % 10}:00:00Z`,
        detected_by: 'mock', confidence: 0.9, evidence: m % 11 === 0 ? { external: true, title: `外部 ${m}` } : {},
      });
    }
    insights.push({
      id: id(), subject_id: subjectId, snapshot_date: dates.at(-1), module_type: 'highlight', insight_key: `k${s}`,
      title: `要点 ${s}`, summary: `要点摘要 ${s}`, analysis: s % 2 ? `分析 ${s}` : null, event_date: dates.at(-2),
      comparison_subject_ids: [], dimensions_json: null, importance_score: 0.5, confidence: 0.8,
      evidence_item_ids: ['a', 'b'], evidence_refs_json: null, related_subject_ids: [], generated_by: 'mock',
      generator_version: '1', status: 'published', published_at: `${dates.at(-1)}T00:00:00Z`,
    });
  }

  // 动态: fixed timestamps (the page's window ends at the newest post), so
  // repeated builds render the same /feed.
  const feedEnd = Date.parse(`${dates.at(-1)}T12:00:00Z`);
  const hoursAgo = (h) => new Date(feedEnd - h * 3600_000).toISOString();
  const media = (name, type = 'photo', width = 1200, height = 800) => ({ type, url: `https://www.amazingindex.com/media/x/mock-${name}.jpg`, width, height });
  const avatar = (handle) => `https://www.amazingindex.com/media/x/avatars/mock-${handle}.jpg`;
  const feedPosts = [
    ['sama', 'Sam Altman', 0.5, 'Shipping a new model today. Details: https://openai.com/index/mock-launch and thanks @gdb!', '今天发布新模型。详情：https://openai.com/index/mock-launch，感谢 @gdb！', [media('sama-1')]],
    ['karpathy', 'Andrej Karpathy', 2, '1/ A long thread on tokenizers.\n\nFirst, bytes are not characters <b>&</b> that matters.\n\n2/ Second part of the thread.', '1/ 关于分词器的长帖。\n\n首先，字节不是字符 <b>&</b> 这很重要。\n\n2/ 帖子的第二部分。', [media('karpathy-1'), media('karpathy-2')]],
    ['sama', 'Sam Altman', 5, 'Good morning.', '早上好。', []],
    ['svpino', 'Santiago', 7, 'A video walkthrough of building an agent.', '一段搭建智能体的视频讲解。', [media('svpino-1', 'video', 1280, 720)]],
    ['kaifulee', '李开复', 9, '今天聊聊大模型的推理成本 https://example.com/cost', '', []],
    ['noavatar', 'No Avatar', 12, 'Posting without a profile picture.', '没有头像的博主。', []],
    ['ylecun', 'Yann LeCun', 30, 'Too old for the window.', '超出窗口。', []],
  ];
  const procFeedPosts = feedPosts.map(([handle, name, h, text, zh, list], i) => ({
    id: `feed-${String(i + 1).padStart(2, '0')}`,
    raw_item_ids: [`feed-${i + 1}`],
    author: handle,
    display_name: name,
    avatar_url: handle === 'noavatar' ? null : avatar(handle),
    published_at: hoursAgo(h + 0.1),
    updated_at: hoursAgo(h),
    url: `https://x.com/${handle}/status/${1000 + i}`,
    text_original: text,
    text_zh: zh,
    media: list,
    content_hash: `h${i}`,
    prompt_version: 2,
  }));

  return {
    proc_feed_posts: procFeedPosts,
    display_items: displayItems,
    daily_archives: archives,
    tracks,
    project_heatmap_data: heatmap,
    subjects,
    subject_stats: stats,
    subject_mentions: mentions,
    subject_insights: insights,
    octp_snapshot_raw_items: rawItems,
  };
}

function parseValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  return raw;
}

function parseInList(raw) {
  const inner = raw.replace(/^\(/, '').replace(/\)$/, '');
  const values = [];
  let current = '';
  let quoted = false;
  for (const ch of inner) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === ',' && !quoted) { values.push(current); current = ''; continue; }
    current += ch;
  }
  if (current || inner.length) values.push(current);
  return values.map(parseValue);
}

function compare(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a < b ? -1 : 1;
}

function matches(row, column, expression) {
  const dot = expression.indexOf('.');
  const op = expression.slice(0, dot);
  const raw = expression.slice(dot + 1);
  const value = row[column];
  switch (op) {
    case 'eq': return String(value) === String(parseValue(raw));
    case 'neq': return String(value) !== String(parseValue(raw));
    case 'gt': return compare(value, raw) > 0;
    case 'gte': return compare(value, raw) >= 0;
    case 'lt': return compare(value, raw) < 0;
    case 'lte': return compare(value, raw) <= 0;
    case 'in': return parseInList(raw).map(String).includes(String(value));
    case 'is': return raw === 'null' ? value === null || value === undefined : String(value) === raw;
    default: throw new Error(`Unsupported filter ${op}`);
  }
}

export function queryRows(rows, params) {
  let result = [...rows];
  for (const [key, expression] of params) {
    if (['select', 'order', 'offset', 'limit'].includes(key)) continue;
    result = result.filter((row) => matches(row, key, expression));
  }
  const order = params.get('order');
  if (order) {
    const keys = order.split(',').map((part) => {
      const [column, direction = 'asc', nulls] = part.split('.');
      return { column, desc: direction === 'desc', nullsFirst: nulls === 'nullsfirst' };
    });
    result.sort((a, b) => {
      for (const { column, desc, nullsFirst } of keys) {
        const av = a[column];
        const bv = b[column];
        const aNull = av === null || av === undefined;
        const bNull = bv === null || bv === undefined;
        if (aNull || bNull) {
          if (aNull && bNull) continue;
          return (aNull ? -1 : 1) * (nullsFirst ? 1 : -1);
        }
        const diff = compare(av, bv);
        if (diff !== 0) return desc ? -diff : diff;
      }
      return 0;
    });
  }
  const offset = Number(params.get('offset') || 0);
  const limit = Math.min(Number(params.get('limit') || MAX_ROWS), MAX_ROWS);
  result = result.slice(offset, offset + limit);
  const select = (params.get('select') || '*').split(',').map((c) => c.trim()).filter(Boolean);
  // Like PostgREST: selecting a column the table does not have is an error.
  const known = rows.length > 0 ? new Set(Object.keys(rows[0])) : null;
  const unknown = known ? select.filter((c) => c !== '*' && !known.has(c)) : [];
  if (unknown.length > 0) throw Object.assign(new Error(`column ${unknown[0]} does not exist`), { code: '42703' });
  if (!select.includes('*')) {
    result = result.map((row) => Object.fromEntries(select.map((column) => [column, row[column] ?? null])));
  }
  return result;
}

function visibleTables(fixture, latestDate) {
  if (!latestDate) return fixture;
  return Object.fromEntries(Object.entries(fixture).map(([table, rows]) => [
    table,
    rows.filter((row) => !row.snapshot_date || row.snapshot_date <= latestDate),
  ]));
}

export function startMockSupabase({ port = PORT, latestDate = process.env.MOCK_LATEST_DATE } = {}) {
  const tables = visibleTables(buildFixture(), latestDate);
  if (process.env.MOCK_FEED_FILE) tables.proc_feed_posts = JSON.parse(readFileSync(process.env.MOCK_FEED_FILE, 'utf8'));
  // Per-table request, row and byte counts since the last GET /__stats?reset=1.
  let stats = {};
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__stats') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(stats));
      if (url.searchParams.get('reset')) stats = {};
      return;
    }
    const match = url.pathname.match(/^\/rest\/v1\/([a-z_0-9]+)$/);
    res.setHeader('Content-Type', 'application/json');
    if (!match || req.method !== 'GET') {
      res.writeHead(404).end(JSON.stringify({ code: 'PGRST000', message: 'Not found' }));
      return;
    }
    const rows = tables[match[1]];
    if (!rows) {
      res.writeHead(404).end(JSON.stringify({ code: 'PGRST205', message: `Could not find the table 'public.${match[1]}' in the schema cache` }));
      return;
    }
    try {
      const body = JSON.stringify(queryRows(rows, url.searchParams));
      const entry = (stats[match[1]] ||= { requests: 0, rows: 0, bytes: 0 });
      entry.requests += 1;
      entry.rows += JSON.parse(body).length;
      entry.bytes += Buffer.byteLength(body);
      res.writeHead(200).end(body);
    } catch (error) {
      res.writeHead(400).end(JSON.stringify({ code: error.code || 'PGRST100', message: error.message }));
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startMockSupabase();
  console.log(`[mock-supabase] listening on http://127.0.0.1:${PORT}${process.env.MOCK_LATEST_DATE ? ` latest=${process.env.MOCK_LATEST_DATE}` : ''}`);
}
