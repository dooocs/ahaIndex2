import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { HOST, KEY, collectUrls, htmlFileFor, indexableUrl, payloads } from '../scripts/lib/indexnow.mjs';

const S = `https://${HOST}`;

test('the key file is served from public/ and contains exactly the key', async () => {
  assert.equal(await readFile(new URL(`../public/${KEY}.txt`, import.meta.url), 'utf8'), KEY);
});

test('changed URLs map back to built pages; assets and other hosts are dropped', () => {
  assert.equal(htmlFileFor(`${S}/`), 'index.html');
  assert.equal(htmlFileFor(`${S}/daily/2026-10-13/`), 'daily/2026-10-13/index.html');
  assert.equal(htmlFileFor(`${S}/daily/2026-10-13`), 'daily/2026-10-13/index.html');
  assert.equal(htmlFileFor(`${S}/404.html`), '404.html');
  assert.equal(htmlFileFor(`${S}/sitemap.xml`), null);
  assert.equal(htmlFileFor(`${S}/og/a.png`), null);
  assert.equal(htmlFileFor('https://example.com/x/'), null);
});

test('a page is submitted by its canonical URL, and noindex pages not at all', () => {
  const page = (extra) => `<head>${extra}<link rel="canonical" href="${S}/daily/2026-10-13"></head>`;
  assert.equal(indexableUrl(page('')), `${S}/daily/2026-10-13`);
  assert.equal(indexableUrl(page('<meta name="robots" content="noindex, nofollow">')), null);
  assert.equal(indexableUrl('<head></head>'), null);
  assert.equal(indexableUrl('<link rel="canonical" href="https://example.com/">'), null);
});

test('both URL forms of one page are submitted once', async () => {
  const html = { 'daily/2026-10-13/index.html': `<link rel="canonical" href="${S}/daily/2026-10-13">`,
    '404.html': '<meta name="robots" content="noindex, nofollow"><link rel="canonical" href="' + S + '/">' };
  const urls = await collectUrls([`${S}/daily/2026-10-13/`, `${S}/daily/2026-10-13`, `${S}/404.html`, `${S}/rss.xml`, `${S}/gone/`],
    async (rel) => html[rel] ?? null);
  assert.deepEqual(urls, [`${S}/daily/2026-10-13`]);
});

test('payloads carry the host, key and key location', () => {
  const [body] = payloads([`${S}/`]);
  assert.deepEqual(body, { host: HOST, key: KEY, keyLocation: `${S}/${KEY}.txt`, urlList: [`${S}/`] });
});
