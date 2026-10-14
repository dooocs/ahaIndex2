// Checks a deploy against the real bucket listing: run after
// scripts/run-deploy.sh with DEPLOY_PREFIX=__test__/ (see test-deploy.yml).
//
// node scripts/staging-check.mjs --listing .deploy/staging-ls.txt --prefix __test__/
//
// For every object the deploy wrote (.deploy/expected.txt), the listing must
// contain it and its ETag must equal the MD5 of the local file it came from;
// this is what daily runs rely on to skip unchanged files. Prints the first
// listing lines so the format can be inspected.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { md5, parseOssutilLs } from './lib/inventory.mjs';

const { values } = parseArgs({
  options: {
    listing: { type: 'string' },
    prefix: { type: 'string', default: '__test__/' },
    bucket: { type: 'string', default: 'amazingindex' },
    work: { type: 'string', default: '.deploy' },
  },
});

const text = await readFile(values.listing, 'utf8');
console.log('First lines of the ossutil listing:');
for (const line of text.split('\n').slice(0, 4)) console.log(`  | ${line}`);

const listed = parseOssutilLs(text, values.bucket, values.prefix);
const expected = (await readFile(path.join(values.work, 'expected.txt'), 'utf8')).split('\n').filter(Boolean);
const source = async (key) => {
  for (const candidate of [key, `${key}/index.html`]) {
    for (const root of ['export', 'dist']) {
      const content = await readFile(path.join(root, candidate)).catch(() => null);
      if (content) return content;
    }
  }
  return null;
};

let missing = 0, mismatched = 0, unknownEtag = 0, matched = 0;
for (const key of expected) {
  if (!listed.has(key)) { if (missing++ < 5) console.log(`  missing from listing: ${key}`); continue; }
  const etag = listed.get(key);
  if (!etag) { unknownEtag++; continue; }
  const content = await source(key);
  if (!content) continue;
  if (md5(content) === etag) matched++;
  else if (mismatched++ < 5) console.log(`  ETag differs from local MD5: ${key}`);
}
console.log(`[staging-check] expected=${expected.length} listed=${listed.size} etag_matches_md5=${matched} etag_unknown=${unknownEtag} etag_mismatch=${mismatched} missing=${missing}`);
if (missing > 0 || mismatched > 0) process.exit(1);
if (unknownEtag > 0) console.log('::warning::Some ETags are not plain MD5s; daily runs will re-upload those objects every time (correct, but slower).');
