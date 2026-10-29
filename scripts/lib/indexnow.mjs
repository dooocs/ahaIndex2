#!/usr/bin/env node
// Tells IndexNow (Bing, Yandex, Seznam, Naver…) which pages a deploy changed.
//
// node scripts/lib/indexnow.mjs --urls .deploy/cdn-urls.txt --dist dist [--dry-run]
//
// Input is the deploy's cdn-urls.txt (every URL whose object changed). Each
// URL is mapped back to its built HTML; non-pages and noindex pages are
// dropped, and the page's own <link rel="canonical"> is what gets submitted,
// once. Ownership is proven by the key file public/<KEY>.txt, served at the
// site root. A failed submission only logs: indexing hints never fail a deploy.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export const KEY = 'defda34111c2442290c413eb3c7d3c8a';
export const HOST = 'www.amazingindex.com';
export const ENDPOINT = 'https://api.indexnow.org/indexnow';
const BATCH = 10000; // protocol limit per POST

/** dist-relative HTML file for a site URL, or null when it is not a page. */
export function htmlFileFor(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.host !== HOST) return null;
  const p = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  if (p === '') return 'index.html';
  if (p.endsWith('.html')) return p;
  if (/\.[a-z0-9]+$/i.test(p.split('/').pop())) return null; // .xml, .json, .txt, images…
  return `${p.replace(/\/+$/, '')}/index.html`;
}

/** The URL a page wants indexed: its canonical, unless it is noindex. */
export function indexableUrl(html) {
  const robots = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i);
  if (robots && /noindex/i.test(robots[1])) return null;
  const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  if (!canonical) return null;
  try { return new URL(canonical[1]).host === HOST ? canonical[1] : null; } catch { return null; }
}

/** Distinct indexable URLs among the changed ones. `read(rel)` returns HTML or null. */
export async function collectUrls(changed, read) {
  const files = [...new Set(changed.map(htmlFileFor).filter(Boolean))];
  const out = new Set();
  for (const rel of files) {
    const html = await read(rel);
    const url = html && indexableUrl(html);
    if (url) out.add(url);
  }
  return [...out].sort();
}

export function payloads(urls) {
  const batches = [];
  for (let i = 0; i < urls.length; i += BATCH) {
    batches.push({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls.slice(i, i + BATCH) });
  }
  return batches;
}

async function main() {
  const { values } = parseArgs({ options: {
    urls: { type: 'string' }, dist: { type: 'string', default: 'dist' }, 'dry-run': { type: 'boolean', default: false },
  } });
  if (!values.urls) throw new Error('--urls is required');
  let text = '';
  try { text = await readFile(values.urls, 'utf8'); } catch { console.log('[indexnow] no changed URLs file, nothing to submit'); return; }
  const changed = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const urls = await collectUrls(changed, (rel) => readFile(path.join(values.dist, rel), 'utf8').catch(() => null));
  if (urls.length === 0) { console.log('[indexnow] no indexable pages changed'); return; }
  console.log(`[indexnow] ${urls.length} page(s): ${urls.slice(0, 5).join(' ')}${urls.length > 5 ? ' …' : ''}`);
  if (values['dry-run']) return;
  for (const body of payloads(urls)) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      // 200 OK / 202 Accepted (key still being validated) are both success.
      const note = res.ok ? '✅' : '⚠️';
      console.log(`[indexnow] ${note} HTTP ${res.status} for ${body.urlList.length} URL(s) ${res.ok ? '' : await res.text().catch(() => '')}`);
    } catch (err) {
      console.log(`[indexnow] ⚠️ submission failed: ${err.message}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.log(`[indexnow] ⚠️ ${err.message}`); });
}
