import test from 'node:test';
import assert from 'node:assert/strict';
import { communityConfig, communityStorageKey, isCommunityPublicKey, validatePost, safeReturnPath, friendlyError, loginRetrySeconds, postRetrySeconds } from '../src/lib/community-model.ts';

const jwt = (payload, header = { alg: 'HS256', typ: 'JWT' }) => [header, payload].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.testSignature';

const valid = { nickname: '测试用户', age: 28, gender: '女', city: '杭州', occupation: '', title: '一起认识新的世界', about: '喜欢散步阅读和旅行，希望认识认真对待生活的朋友。', looking_for: '', contact: '', consent: true, share_contact: false };
test('post fields are trimmed, validated and mapped without owner/status injection', () => {
  const result = validatePost({ ...valid, city: ' 杭州 ', owner_id: 'someone-else', status: 'published' });
  assert.equal(result.p_city, '杭州');
  assert.equal(result.p_age, 28);
  assert.equal(result.owner_id, undefined);
  assert.equal(result.p_status, undefined);
});
test('adults and explicit consent required, contact sharing is opt-in', () => {
  for (const change of [{ age: 17 }, { age: 18.5 }, { age: 101 }, { consent: false }, { gender: 'invalid' }, { about: 'short' }, { title: 'x'.repeat(61) }, { contact: 'private@example.com' }]) {
    assert.throws(() => validatePost({ ...valid, ...change }));
  }
  assert.equal(validatePost({ ...valid, contact: 'private@example.com', share_contact: true }).p_contact, 'private@example.com');
});
test('city, age and an explicit gender are required for every post', () => {
  for (const change of [{ city: '' }, { city: '   ' }, { city: undefined }, { age: '' }, { age: undefined }, { gender: '' }, { gender: undefined }, { gender: '不公开' }]) {
    assert.throws(() => validatePost({ ...valid, ...change }));
  }
  assert.equal(validatePost(valid).p_gender, '女');
});
test('return URLs remain same-origin and do not loop to login', () => {
  for (const input of [null, 'https://evil.test', '//evil.test', '/\\evil.test', '/\nevil.test', '/login/?next=x', '/auth/callback/?next=x']) assert.equal(safeReturnPath(input), '/account');
  assert.equal(safeReturnPath('/meet/post/?id=12#photos'), '/meet/post?id=12#photos');
  assert.equal(safeReturnPath('/meet/post?id=12'), '/meet/post?id=12');
  assert.equal(safeReturnPath('/'), '/');
});
test('community is opt-in, refuses private keys and non-HTTPS URLs', () => {
  assert.equal(communityConfig({}), null);
  const config = { enabled: 'true', url: 'https://community.supabase.co', key: 'sb_publishable_test' };
  assert.equal(communityConfig(config).url, config.url);
  for (const key of ['sb_secret_secret', 'eyJhbGci.jwt.service-role', '', undefined]) assert.throws(() => communityConfig({ ...config, key }));
  for (const url of ['http://community.supabase.co', 'https://user:pass@community.supabase.co', 'https://community.supabase.co/private', 'https://community.supabase.co?x=1']) assert.throws(() => communityConfig({ ...config, url }));
});
test('auth failures have actionable messages without exposing backend errors', () => {
  assert.match(friendlyError({ code: 'email_address_not_authorized' }), /团队成员/);
  assert.match(friendlyError({ code: 'otp_expired' }), /过期/);
  assert.match(friendlyError({ details: { code: 'otp_expired' } }), /过期/);
  assert.match(friendlyError({ status: 429 }), /频繁/);
  assert.doesNotMatch(friendlyError({ message: 'secret database internal error' }), /secret/);
  assert.match(friendlyError({ code: 'PGRST202' }), /尚未准备就绪/);
  assert.doesNotMatch(friendlyError(new Error('unavailable')), /检查网络/);
});

test('Aliyun legacy anon keys are accepted without accepting privileged or user JWTs', () => {
  const url = 'https://spb-example.supabase.opentrust.net';
  const key = jwt({ role: 'anon', iss: 'supabase' });
  assert.equal(communityConfig({ enabled: 'true', url, key }).key, key);
  for (const invalid of [
    jwt({ role: 'service_role' }), jwt({ role: 'authenticated', sub: 'user-id' }),
    jwt({}), jwt(null), jwt(['anon']), jwt({ role: 'anon' }, { alg: 'none', typ: 'JWT' }),
    jwt({ role: 'anon' }, { alg: 'HS256' }), 'eyJhbGci.invalid.signature',
    'sb_secret_hidden', 'sb_publishable_', 'sb_publishable_key\nextra', `${key}.extra`,
  ]) {
    assert.equal(isCommunityPublicKey(invalid), false);
    assert.throws(() => communityConfig({ enabled: 'true', url, key: invalid }), /never a secret/);
  }
});

test('auth and review sessions are isolated across backend migrations', () => {
  const source = 'https://community.supabase.co';
  const target = 'https://spb-example.supabase.opentrust.net';
  assert.equal(communityStorageKey(`${source}/`), communityStorageKey(source));
  assert.notEqual(communityStorageKey(source), communityStorageKey(target));
  assert.notEqual(communityStorageKey(target), communityStorageKey(target, 'review'));
  assert.notEqual(communityStorageKey(source, 'review'), communityStorageKey(target, 'review'));
  assert.notEqual(communityStorageKey(target), 'amazingindex-community-auth');
});
test('mock endpoints cannot silently become the live community configuration', () => {
  const values = { enabled: 'true', url: 'https://community-preview.supabase.co', key: 'sb_publishable_preview' };
  assert.throws(() => communityConfig(values), /mock credentials/);
  assert.equal(communityConfig(values, true).url, values.url);
  assert.throws(() => communityConfig({ ...values, url: 'https://real.supabase.co' }), /mock credentials/);
  assert.throws(() => communityConfig({ ...values, key: 'sb_publishable_real' }), /mock credentials/);
});

test('email quota, request throttling and resend intervals remain distinct', () => {
  assert.match(friendlyError({ code: 'over_email_send_rate_limit', status: 429 }), /邮件发送已达到服务限额/);
  assert.match(friendlyError({ code: 'over_request_rate_limit', status: 429 }), /登录请求过于频繁/);
  const interval = { code: 'over_email_send_rate_limit', status: 429, message: 'For security purposes, you can only request this after 47 seconds.' };
  assert.match(friendlyError(interval), /等待 47 秒/);
  assert.equal(loginRetrySeconds(interval), 47);
  assert.equal(loginRetrySeconds({ code: 'over_email_send_rate_limit' }), 60);
  assert.equal(loginRetrySeconds({ status: 429 }), 60);
  assert.equal(loginRetrySeconds({ status: 429, message: 'wait 99999999 seconds' }), 3600);
  assert.equal(loginRetrySeconds({ code: 'email_address_not_authorized' }), 0);
  assert.equal(loginRetrySeconds(new Error('Failed to fetch')), 0);
  assert.equal(loginRetrySeconds(null), 0);
  assert.doesNotMatch(friendlyError({ message: 'Failed to generate a link' }), /频繁/);
});

test('post edit cooldown is not misreported as a login or email quota error', () => {
  const error = { code: 'P0001', message: 'Please wait 60 seconds', status: 400 };
  assert.equal(postRetrySeconds(error), 60);
  assert.equal(loginRetrySeconds(error), 0);
  assert.match(friendlyError(error), /帖子提交间隔需满一分钟/);
  assert.doesNotMatch(friendlyError(error), /操作太频繁|登录|邮件/);
  assert.equal(postRetrySeconds({ code: 'P0001', message: 'Internal failure' }), 0);
  assert.equal(postRetrySeconds({ status: 429, message: 'wait 60 seconds' }), 0);
});
