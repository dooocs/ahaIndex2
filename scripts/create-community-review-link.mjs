import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile, chmod, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { reviewDeployCommand, verifyReviewDeployment } from './community-review-deploy.mjs';
import { isCommunityPublicKey } from '../src/lib/community-model.ts';

const origin = new URL(process.env.COMMUNITY_REVIEW_ORIGIN || 'http://127.0.0.1:4328');
if (!['http://127.0.0.1:4328', 'http://localhost:4328', 'https://www.amazingindex.com'].includes(origin.origin)) throw new Error('Review origin is not allowed by the Edge Function');
const command=reviewDeployCommand(process.env);
if(!isCommunityPublicKey(process.env.PUBLIC_COMMUNITY_SUPABASE_KEY || '')) throw new Error('Provide the public community key for review endpoint verification.');
const directory = resolve('.local');
const file = resolve(directory, 'community-review-link.txt');
const pending = resolve(directory, 'community-review-link.pending.txt');
await mkdir(directory, { recursive: true, mode: 0o700 });
let key;
if (!process.argv.includes('--rotate')) {
  try { key = new URLSearchParams(new URL((await readFile(file, 'utf8')).trim()).hash.slice(1)).get('key'); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Existing review link cannot be read; restore it or explicitly rotate'); }
}
if (key && !/^[0-9a-f]{64}$/.test(key)) throw new Error('Invalid existing review key');
let pendingKey;
try { pendingKey=new URLSearchParams(new URL((await readFile(pending,'utf8')).trim()).hash.slice(1)).get('key'); }
catch(error) { if(error.code!=='ENOENT') throw new Error('Pending review link cannot be read'); }
if(pendingKey) {
  if(!/^[0-9a-f]{64}$/.test(pendingKey) || process.argv.includes('--rotate') || (key && key!==pendingKey)) {
    throw new Error(`Recover the unfinished review configuration in ${pending} before changing another key.`);
  }
  key ||= pendingKey;
}
key ||= randomBytes(32).toString('hex');
const hash = createHash('sha256').update(key).digest('hex');
// Retain a recovery copy before remote configuration can change the active key.
if(!pendingKey) await writeFile(pending,`${origin.origin}/meet/review/#key=${key}\n`,{mode:0o600,flag:'wx'});
await chmod(pending,0o600);
const result = spawnSync(command.cli,command.args, {
  input: `COMMUNITY_REVIEW_KEY_HASH=${hash}\n`, env:command.env, encoding: 'utf8', timeout: 90000,
});
if (result.status !== 0) throw new Error(`Could not configure review secret; existing link is unchanged and recovery is in ${pending}`);
try { await verifyReviewDeployment(process.env,origin.origin,key); }
catch { throw new Error(`Review endpoint is not verified; existing link is unchanged and recovery is in ${pending}`); }
await writeFile(pending,`${origin.origin}/meet/review/#key=${key}\n`,{mode:0o600});
await rename(pending,file);
await chmod(file, 0o600);
console.log(`Review link saved to ${file}. The key itself is not printed. Rotation invalidates existing sessions and links.`);
