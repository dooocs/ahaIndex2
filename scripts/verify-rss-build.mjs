import { readFile } from 'node:fs/promises';

const indexHtmlPath = new URL('../dist/index.html', import.meta.url);
const rssPath = new URL('../dist/rss.xml', import.meta.url);

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

const [indexHtml, rssXml] = await Promise.all([
  readFile(indexHtmlPath, 'utf8'),
  readFile(rssPath, 'utf8'),
]);

const homepageItems = countMatches(indexHtml, /href="\/article\/[^"]+"\s+class="article/g);
const rssItems = countMatches(rssXml, /<item>/g);

if (rssItems !== homepageItems) {
  throw new Error(
    `RSS item count (${rssItems}) must match homepage article count (${homepageItems}).`,
  );
}

console.log(`RSS build verified: ${rssItems} item(s) match the homepage.`);
