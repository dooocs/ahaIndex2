import test from 'node:test';
import assert from 'node:assert/strict';
import { localPreviewOrigin, loginTestRequestAction } from '../scripts/community-login-test-network.mjs';

const origin = 'http://127.0.0.1:4328';

test('login checks only accept local preview origins', () => {
  assert.equal(localPreviewOrigin(origin + '/'), origin);
  assert.equal(localPreviewOrigin('http://localhost:4328'), 'http://localhost:4328');
  for (const value of ['https://www.amazingindex.com', 'http://127.0.0.1.evil.test',
    origin + '/login/', origin + '?next=remote', 'http://user:pass@localhost:4328']) {
    assert.throws(() => localPreviewOrigin(value));
  }
});

test('OTP calls are mocked regardless of backend hostname', () => {
  for (const service of ['https://example.supabase.co',
    'https://spb-x6r06737x2zdpg3x.supabase.opentrust.net', 'https://api.example.test', origin]) {
    assert.equal(loginTestRequestAction(service + '/auth/v1/otp', 'POST', origin), 'mock');
  }
});

test('only read-only local preview requests can reach the network', () => {
  assert.equal(loginTestRequestAction(origin + '/login/', 'GET', origin), 'continue');
  assert.equal(loginTestRequestAction(origin + '/src/scripts/community.ts', 'HEAD', origin), 'continue');
  for (const [url, method] of [
    ['https://spb-x6r06737x2zdpg3x.supabase.opentrust.net/auth/v1/token', 'POST'],
    ['https://example.supabase.co/auth/v1/settings', 'GET'],
    ['https://unknown.example.test/send-email', 'POST'],
    ['http://127.0.0.1.evil.test/login/', 'GET'],
    [origin + '/send-email', 'POST'],
  ]) assert.equal(loginTestRequestAction(url, method, origin), 'abort');
});
