import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCommunityService } from '../scripts/verify-community-service.mjs';

const env = { PUBLIC_COMMUNITY_ENABLED: 'true', PUBLIC_COMMUNITY_SUPABASE_URL: 'https://community.supabase.co', PUBLIC_COMMUNITY_SUPABASE_KEY: 'sb_publishable_test' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const denied = () => json({ code: '42501' }, 401);

test('disabled community needs no API or credentials', async () => {
  assert.deepEqual(await verifyCommunityService({}, () => assert.fail('Unexpected request')), { enabled: false, checked: false });
});
test('readiness rejects placeholders and reuse of the news database', async () => {
  for (const extra of [{ PUBLIC_COMMUNITY_SUPABASE_KEY: 'sb_publishable_preview' }, { SUPABASE_URL: env.PUBLIC_COMMUNITY_SUPABASE_URL }]) {
    await assert.rejects(verifyCommunityService({ ...env, ...extra }, () => assert.fail('Unexpected request')));
  }
});
test('empty real feed is valid only when anonymous privacy probes fail closed', async () => {
  const calls = [];
  const result = await verifyCommunityService(env, async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.apikey, env.PUBLIC_COMMUNITY_SUPABASE_KEY);
    assert.equal(options.headers.Authorization, undefined);
    if(url.endsWith('/meet_post_count')) return json(0);
    if(url.endsWith('/functions/v1/meet-photos')) return json({error:'login_required'},401);
    if(url.endsWith('/functions/v1/meet-public-photos')) return JSON.parse(options.body).own ? json({error:'invalid_request'},400) : json({photos:[]});
    return url.endsWith('/list_meet_posts') ? json([]) : denied();
  });
  assert.equal(result.checked, true);
  assert.equal(calls.length, 9);
});
test('missing migration, unexpected feed fields and anonymous access block publication', async () => {
  await assert.rejects(verifyCommunityService(env, async () => json({ code: 'PGRST202' }, 404)), /not ready/);
  await assert.rejects(verifyCommunityService(env, async () => json([{ owner_id: 'private-user' }])), /private fields/);
  await assert.rejects(verifyCommunityService(env, async () => json([])), /access must be denied/);
});

test('legacy anon readiness includes the JWT required by self-hosted PostgREST', async () => {
  const key = [ { alg: 'HS256', typ: 'JWT' }, { role: 'anon' } ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.testSignature';
  const target = { ...env, PUBLIC_COMMUNITY_SUPABASE_URL: 'https://spb-example.supabase.opentrust.net', PUBLIC_COMMUNITY_SUPABASE_KEY: key };
  const result = await verifyCommunityService(target, async (url, options) => {
    assert.ok(url.startsWith(target.PUBLIC_COMMUNITY_SUPABASE_URL));
    const headers=new Headers(options.headers);
    assert.equal(headers.get('apikey'), key);
    assert.equal(headers.get('authorization'), `Bearer ${key}`);
    assert.equal(headers.get('x-community-authorization'),url.includes('/functions/v1/') ? `Bearer ${key}` : null);
    if (url.endsWith('/functions/v1/meet-api')) {
      const {action} = JSON.parse(options.body);
      return json({data:action === 'meet_post_count' ? 0 : []});
    }
    if (url.endsWith('/functions/v1/meet-photos')) return json({ error: 'login_required' }, 401);
    if (url.endsWith('/functions/v1/meet-public-photos')) return JSON.parse(options.body).own ? json({error:'invalid_request'},400) : json({photos:[]});
    return denied();
  });
  assert.equal(result.checked, true);
});
test('network errors and malformed backend responses fail readiness', async () => {
  await assert.rejects(verifyCommunityService(env, async () => { throw new Error('offline'); }), /offline/);
  await assert.rejects(verifyCommunityService(env, async () => new Response('<html>Bad gateway</html>', { status: 502 })), /invalid JSON/);
});
