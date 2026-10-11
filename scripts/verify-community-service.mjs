import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { communityConfig } from '../src/lib/community-model.ts';
import { communityFunctionFetch } from '../src/lib/community-transport.ts';

export async function verifyCommunityService(env, fetcher = fetch) {
  const config = communityConfig({
    enabled: env.PUBLIC_COMMUNITY_ENABLED,
    url: env.PUBLIC_COMMUNITY_SUPABASE_URL,
    key: env.PUBLIC_COMMUNITY_SUPABASE_KEY,
  });
  if (!config) return { enabled: false, checked: false };
  const serviceFetch = communityFunctionFetch(config,fetcher);
  if (env.SUPABASE_URL && new URL(env.SUPABASE_URL).origin === config.url) {
    throw new Error('Community must use a separate project from the news database.');
  }

  async function request(path, body) {
    const response = await serviceFetch(`${config.url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        apikey: config.key, 'Content-Type': 'application/json',
        ...(!config.key.startsWith('sb_publishable_') ? { Authorization: `Bearer ${config.key}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    let data;
    try { data = await response.json(); } catch { throw new Error(`Community returned invalid JSON: ${path}`); }
    return { response, data };
  }

  const invoker = new URL(config.url).hostname.endsWith('.supabase.opentrust.net');
  const feed = invoker
    ? await request('/functions/v1/meet-api', { action: 'list_meet_posts', params: { p_limit: 1 } })
    : await request('/rest/v1/rpc/list_meet_posts', { p_limit: 1 });
  const { response } = feed;
  const data = invoker ? feed.data?.data : feed.data;
  assert.equal(response.status, 200, 'Community list RPC is not ready; apply the migration before enabling it');
  assert.ok(Array.isArray(data), 'Community feed must be an array');
  const publicFields = new Set(['id', 'nickname', 'age', 'gender', 'city', 'occupation', 'title', 'about', 'looking_for', 'created_at', 'expires_at', 'photo_count']);
  for (const post of data) {
    assert.ok(post && typeof post === 'object' && !Array.isArray(post), 'Invalid public post');
    assert.ok(Object.keys(post).every(key => publicFields.has(key)), 'Unexpected private fields in public feed');
    assert.ok(typeof post.city === 'string' && post.city.trim(), 'Public posts need a city');
    assert.ok(Number.isInteger(post.age) && post.age >= 18 && post.age <= 100, 'Public posts must be adults');
    assert.ok(['女', '男', '其他'].includes(post.gender), 'Public posts need a gender');
  }

  // Read-only anonymous probes: neither raw rows nor contacts may be exposed.
  for (const [path, body] of [
    ['/rest/v1/meet_posts?select=id&limit=1'],
    ['/rest/v1/meet_contacts?select=post_id&limit=1'],
    ['/rest/v1/meet_photos?select=id&limit=1'],
    ['/rest/v1/rpc/get_meet_contact', { p_id: 0 }],
  ]) {
    const result = await request(path, body);
    assert.ok([401, 403].includes(result.response.status) && result.data?.code === '42501', `Anonymous access must be denied: ${path}`);
  }
  if (invoker) {
    const bridge = await request('/rest/v1/rpc/meet_api', { p_action: 'list_meet_posts', p_actor: null });
    assert.ok([401,403].includes(bridge.response.status) && bridge.data?.code === '42501', 'Anonymous dispatcher must be denied');
  }
  const count = invoker
    ? await request('/functions/v1/meet-api', { action: 'meet_post_count' })
    : await request('/rest/v1/rpc/meet_post_count', {});
  assert.equal(count.response.status, 200, 'Photo migration is not ready');
  const total = invoker ? count.data?.data : count.data;
  assert.ok(Number.isSafeInteger(total) && total >= 0, 'Invalid community count');
  const photos = await request('/functions/v1/meet-photos', { action: 'list', posts: [] });
  assert.ok(photos.response.status === 401 && photos.data?.error === 'login_required', 'Photo endpoint must be healthy and reject anonymous access');
  return { enabled: true, checked: true, publicFeed: 'ready', anonymousPrivacy: 'denied' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await verifyCommunityService(process.env)));
  } catch (error) {
    console.error(`Community readiness failed: ${error.message}`);
    process.exitCode = 1;
  }
}
