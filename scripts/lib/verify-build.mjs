import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'parse5';
import sax from 'sax';

const SITE = 'https://www.amazingindex.com';

function xmlValues(xml) {
  const values = new Map();
  const stack = [];
  const parser = sax.parser(true);
  parser.onopentag = ({ name }) => stack.push({ name, text: '' });
  parser.ontext = parser.oncdata = (text) => { if (stack.length) stack.at(-1).text += text; };
  parser.onclosetag = () => {
    const key = stack.map((node) => node.name).join('/');
    const { text } = stack.pop();
    if (!values.has(key)) values.set(key, []);
    values.get(key).push(text.trim());
  };
  parser.write(xml).close();
  return values;
}

function* elements(node) {
  if (node.tagName) yield node;
  for (const child of node.childNodes ?? []) yield* elements(child);
}

function textContent(node) {
  return node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(textContent).join('');
}

function attr(node, name) {
  return node.attrs?.find((attribute) => attribute.name === name)?.value ?? '';
}

function hasClass(node, name) {
  return attr(node, 'class').split(/\s+/).includes(name);
}

function sitePath(value) {
  const url = new URL(value);
  assert.equal(url.origin, SITE, `Unexpected sitemap origin: ${url.origin}`);
  return decodeURIComponent(url.pathname);
}

export async function verifyBuild(dist, latestDate) {
  const [html, rss] = await Promise.all([
    readFile(path.join(dist, 'index.html'), 'utf8'),
    readFile(path.join(dist, 'rss.xml'), 'utf8'),
  ]);
  const home = [...elements(parse(html))];
  const feed = xmlValues(rss);
  const feedLinks = feed.get('rss/channel/item/link') ?? [];
  assert.ok(feedLinks.length > 0, 'RSS must not be empty');
  assert.equal(new Set(feedLinks).size, feedLinks.length, 'RSS contains duplicate articles');
  const homeLinks = home.filter((node) => node.tagName === 'a' && hasClass(node, 'article'))
    .map((node) => new URL(attr(node, 'href'), SITE).toString());
  assert.deepEqual([...homeLinks].sort(), [...feedLinks].sort(), 'Homepage and RSS article links differ');
  const feedDate = new Date(feed.get('rss/channel/lastBuildDate')?.[0]).toISOString().slice(0, 10);
  assert.equal(feedDate, latestDate, 'RSS is not using the latest database edition');
  assert.ok(home.some((node) => hasClass(node, 'masthead-vol') && textContent(node).includes(latestDate.replaceAll('-', '.'))),
    'Homepage masthead is not using the latest database edition');

  const index = xmlValues(await readFile(path.join(dist, 'sitemap.xml'), 'utf8'));
  const sitemaps = index.get('sitemapindex/sitemap/loc') ?? [];
  assert.ok(sitemaps.length > 0, 'Sitemap index is empty');
  const urls = [];
  for (const sitemap of sitemaps) {
    const xml = xmlValues(await readFile(path.join(dist, sitePath(sitemap)), 'utf8'));
    const entries = xml.get('urlset/url/loc') ?? [];
    assert.ok(entries.length > 0, `Empty sitemap: ${sitemap}`);
    urls.push(...entries);
  }
  assert.equal(new Set(urls).size, urls.length, 'Sitemaps contain duplicate URLs');
  for (const url of urls) {
    const route = sitePath(url);
    const file = path.join(dist, route, 'index.html');
    assert.ok((await stat(file).catch(() => null))?.isFile(), `Sitemap URL has no built page: ${url}`);
  }
  assert.ok(urls.includes(`${SITE}/daily/${latestDate}`), 'Sitemap omits the latest daily edition');
  const files = await readdir(dist, { recursive: true });
  const builtArticles = files.filter((file) => file.startsWith('article/') && file.endsWith('/index.html'))
    .map((file) => `${SITE}/${file.slice(0, -'/index.html'.length)}`);
  const sitemapArticles = urls.filter((url) => sitePath(url).startsWith('/article/'));
  assert.deepEqual(sitemapArticles.sort(), builtArticles.sort(), 'Article sitemap and built article pages differ');
  const projects = files.filter((file) => file.startsWith('projects/') && file.endsWith('/index.html') && file !== 'projects/index.html').length;
  assert.ok(projects > 0, 'No project detail pages were built');
  return { latestDate, rssItems: feedLinks.length, sitemapUrls: urls.length, articles: builtArticles.length, projects };
}
