import { readFile } from 'node:fs/promises';

const indexHtmlPath = new URL('../dist/index.html', import.meta.url);
const rssPath = new URL('../dist/rss.xml', import.meta.url);

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function countHomepageArticleLinks(indexHtml) {
  return countMatches(
    indexHtml,
    /<a\b(?=[^>]*\bhref="\/article\/[^"]+")(?=[^>]*\bclass="\s*(?:[^\s"]+\s+)*article(?:\s+[^"]*)?")[^>]*>/g,
  );
}

const [indexHtml, rssXml] = await Promise.all([
  readFile(indexHtmlPath, 'utf8'),
  readFile(rssPath, 'utf8'),
]);

const homepageItems = countHomepageArticleLinks(indexHtml);
const rssItems = countMatches(rssXml, /<item>/g);

if (rssItems !== homepageItems) {
  throw new Error(
    `RSS item count (${rssItems}) must match homepage article count (${homepageItems}).`,
  );
}

console.log(`RSS build verified: ${rssItems} item(s) match the homepage.`);
