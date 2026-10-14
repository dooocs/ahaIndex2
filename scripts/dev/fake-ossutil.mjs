#!/usr/bin/env node
// A stand-in for the ossutil commands the deploy scripts use (ls, cp, sync,
// rm), backed by a local directory, for end-to-end tests without OSS.
//
//   FAKE_OSS_ROOT   directory holding the bucket (objects stored flat by key)
//   FAKE_OSS_FAIL   regex; a call whose "<command> <args…>" matches fails
//                   without doing anything (simulates an interrupted upload)
//
// Listings follow ossutil's format: LastModifiedTime Size StorageClass ETAG
// ObjectName, with the ETag the uppercase MD5 of the content.
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.env.FAKE_OSS_ROOT;
if (!root) throw new Error('FAKE_OSS_ROOT is not set');
const store = path.join(root, 'objects');
mkdirSync(store, { recursive: true });

const [command, ...rest] = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--endpoint', '--access-key-id', '--access-key-secret', '--region', '-j', '--metadata']);
const args = [];
for (let i = 0; i < rest.length; i++) {
  if (VALUE_FLAGS.has(rest[i])) i++;
  else if (!rest[i].startsWith('-')) args.push(rest[i]);
}
appendFileSync(path.join(root, 'calls.log'), `${command} ${args.join(' ')}\n`);
if (process.env.FAKE_OSS_FAIL && new RegExp(process.env.FAKE_OSS_FAIL).test(`${command} ${args.join(' ')}`)) {
  console.error(`fake ossutil: simulated failure for ${command} ${args.join(' ')}`);
  process.exit(1);
}

const keyOf = (url) => {
  const match = url.match(/^oss:\/\/[^/]+\/(.*)$/);
  if (!match) throw new Error(`not an oss:// url: ${url}`);
  return match[1];
};
const file = (key) => path.join(store, encodeURIComponent(key));
const keys = () => readdirSync(store).map(decodeURIComponent).sort();
const md5 = (content) => createHash('md5').update(content).digest('hex').toUpperCase();

function walk(dir, rel = '') {
  const out = [];
  for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(dir, child));
    else out.push(child);
  }
  return out;
}

switch (command) {
  case 'ls': {
    const prefix = keyOf(args[0]);
    console.log('LastModifiedTime                   Size(B)  StorageClass   ETAG                                  ObjectName');
    let n = 0;
    for (const key of keys().filter((k) => k.startsWith(prefix))) {
      const content = readFileSync(file(key));
      console.log(`2026-10-14 10:00:00 +0800 CST ${String(content.length).padStart(12)}      Standard   ${md5(content)}      oss://${args[0].split('/')[2]}/${key}`);
      n++;
    }
    console.log(`\nObject Number is: ${n}`);
    break;
  }
  case 'cp': {
    const [src, dst] = args;
    if (src.startsWith('oss://') && !existsSync(file(keyOf(src)))) {
      console.error(`fake ossutil: ${src} not found`);
      process.exit(1);
    }
    const content = src.startsWith('oss://') ? readFileSync(file(keyOf(src))) : readFileSync(src);
    if (dst.startsWith('oss://')) writeFileSync(file(keyOf(dst)), content);
    else {
      mkdirSync(path.dirname(dst), { recursive: true });
      writeFileSync(dst, content);
    }
    break;
  }
  case 'sync': {
    const [src, dst] = args;
    const prefix = keyOf(dst);
    for (const rel of walk(src)) cpSync(path.join(src, rel), file(`${prefix}${rel}`));
    break;
  }
  case 'rm': {
    const prefix = keyOf(args[0]);
    const recursive = rest.includes('--recursive') || rest.includes('-r');
    for (const key of recursive ? keys().filter((k) => k.startsWith(prefix)) : [prefix]) rmSync(file(key), { force: true });
    break;
  }
  default:
    console.error(`fake ossutil: unsupported command ${command}`);
    process.exit(2);
}
