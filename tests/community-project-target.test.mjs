import test from 'node:test';
import assert from 'node:assert/strict';
import { communityProjectTarget } from '../scripts/community-project-target.mjs';

const ref = 'spb-x6r06737x2zdpg3x';
const url = `https://${ref}.supabase.opentrust.net`;

test('explicit project guards support Aliyun and official cloud', () => {
  assert.deepEqual(communityProjectTarget(url, ref), { url, projectRef: ref, aliyun: true });
  assert.equal(communityProjectTarget('https://abcdefghijklmnopqrst.supabase.co', 'abcdefghijklmnopqrst').aliyun, false);
});

test('missing refs, mismatched origins, and credential-bearing URLs fail closed', () => {
  for (const [value, project] of [
    [url, undefined], [url, 'spb-anotherproject123'], [url, 'invalid'],
    [`${url}.evil.test`, ref], [url + '/api', ref], [url + '?key=secret', ref],
    [`https://user:pass@${ref}.supabase.opentrust.net`, ref],
    [`http://${ref}.supabase.opentrust.net`, ref],
    ['https://wyhpcfjtmtitorinkevj.supabase.co', 'wyhpcfjtmtitorinkevj'],
  ]) assert.throws(() => communityProjectTarget(value, project));
});
