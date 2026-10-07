import assert from 'node:assert/strict';
import test from 'node:test';
import { getBuildKeyInfo } from '../src/lib/supabase-key.ts';

test('key contents determine the role, regardless of the environment variable name', () => {
  assert.deepEqual(getBuildKeyInfo('sb_publishable_example'), { type: 'publishable', role: 'anon' });
  assert.deepEqual(getBuildKeyInfo('sb_secret_example'), { type: 'secret', role: 'service_role' });
  for (const role of ['anon', 'service_role']) {
    const payload = Buffer.from(JSON.stringify({ role })).toString('base64url');
    assert.deepEqual(getBuildKeyInfo(`header.${payload}.signature`), { type: 'legacy_jwt', role });
  }
});

test('invalid keys fail without including the credential in the error', () => {
  for (const key of ['invalid-private-value', 'header.invalid-payload.signature']) {
    assert.throws(() => getBuildKeyInfo(key), (error) => {
      assert.ok(!error.message.includes(key));
      return /SUPABASE_BUILD_KEY/.test(error.message);
    });
  }
});
