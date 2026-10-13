// Release checks, run before anything is uploaded.
//   verifyDist: the pages this run built (daily or full) are complete and current.
//   verifyExport: feeds, sitemaps, data and shell copies agree with the built
//   pages and only point at editions that are deployed.
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'parse5';
import sax from 'sax';

const SITE = 'https://www.amazingindex.com';
const SHELL_TOKENS = ['__SHELL_TITLE__', '__SHELL_DESCRIPTION__', '__SHELL_PATH__'];

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

const textContent = (node) => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(textContent).join('');
const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value ?? '';
const hasClass = (node, name) => attr(node, 'class').split(/\s+/).includes(name);
const isFile = async (file) => Boolean((await stat(file).catch(() => null))?.isFile());

function sitePath(value) {
  const url = new URL(value);
  assert.equal(url.origin, SITE, `Unexpected sitemap origin: ${url.origin}`);
  return decodeURIComponent(url.pathname);
}

async function homepage(dist) {
  const nodes = [...elements(parse(await readFile(path.join(dist, 'index.html'), 'utf8')))];
  const links = nodes.filter((node) => node.tagName === 'a' && hasClass(node, 'article'))
    .map((node) => new URL(attr(node, 'href'), SITE).toString());
  const vol = nodes.find((node) => hasClass(node, 'masthead-vol'));
  return { links, volText: vol ? textContent(vol) : '' };
}

async function listDirs(dir) {
  return (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => e.name);
}

/** `dates`: the editions a daily build rendered; ignored for full builds. */
export async function verifyDist(dist, { latestDate, mode, dates = [] }) {
  const home = await homepage(dist);
  assert.ok(home.links.length > 0, 'Homepage lists no articles');
  assert.ok(home.volText.includes(latestDate.replaceAll('-', '.')), 'Homepage masthead is not using the latest database edition');
  for (const link of home.links) {
    assert.ok(await isFile(path.join(dist, new URL(link).pathname, 'index.html')), `Homepage links to an article that was not built: ${link}`);
  }
  const editions = mode === 'daily' ? dates : [latestDate];
  assert.ok(mode !== 'daily' || dates.includes(latestDate), 'A daily build must include the latest edition');
  for (const date of editions) {
    assert.ok(await isFile(path.join(dist, 'daily', date, 'index.html')), `Edition page was not built: ${date}`);
  }
  for (const shell of ['shell/daily-month/index.html', 'shell/subject/index.html']) {
    const html = await readFile(path.join(dist, shell), 'utf8');
    for (const token of SHELL_TOKENS) assert.ok(html.includes(token), `${shell} is missing ${token}`);
  }
  const articles = (await listDirs(path.join(dist, 'article'))).length;
  const projects = (await listDirs(path.join(dist, 'projects'))).length;
  if (mode === 'full') assert.ok(projects > 0, 'No project detail pages were built');
  return { mode, latestDate, articles, projects };
}

async function readJson(file) {
  const value = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(value?.v, 1, `${file} has an unexpected data version`);
  return value;
}

export async function verifyExport(exportDir, dist, { latestDate }) {
  const manifest = await readJson(path.join(exportDir, '_deploy/manifest.json'));
  const deployed = new Set(manifest.dates);
  assert.ok(deployed.has(latestDate), 'Deploy manifest omits the latest edition');
  assert.deepEqual(manifest.dates, [...manifest.dates].sort().reverse(), 'Deploy manifest dates are not newest first');
  for (const date of (await listDirs(path.join(dist, 'daily'))).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    assert.ok(deployed.has(date), `Built edition ${date} is missing from the deploy manifest`);
  }

  const home = await homepage(dist);
  const feed = xmlValues(await readFile(path.join(exportDir, 'rss.xml'), 'utf8'));
  const feedLinks = feed.get('rss/channel/item/link') ?? [];
  assert.ok(feedLinks.length > 0, 'RSS must not be empty');
  assert.equal(new Set(feedLinks).size, feedLinks.length, 'RSS contains duplicate articles');
  assert.deepEqual([...feedLinks].sort(), [...home.links].sort(), 'Homepage and RSS article links differ');
  const feedDate = new Date(feed.get('rss/channel/lastBuildDate')?.[0]).toISOString().slice(0, 10);
  assert.equal(feedDate, latestDate, 'RSS is not using the latest database edition');

  for (const file of ['summary.json', 'archive/index.json', 'history.json', 'subjects/index.json']) {
    await readJson(path.join(exportDir, 'data', file));
  }

  const index = xmlValues(await readFile(path.join(exportDir, 'sitemap.xml'), 'utf8'));
  const sitemaps = index.get('sitemapindex/sitemap/loc') ?? [];
  assert.ok(sitemaps.length > 0, 'Sitemap index is empty');
  const entries = [];
  for (const sitemap of sitemaps) {
    const xml = xmlValues(await readFile(path.join(exportDir, sitePath(sitemap)), 'utf8'));
    const locs = xml.get('urlset/url/loc') ?? [];
    const mods = xml.get('urlset/url/lastmod') ?? [];
    assert.ok(locs.length > 0, `Empty sitemap: ${sitemap}`);
    // lastmod is optional per entry; only article sitemaps rely on it, and every article entry has one.
    locs.forEach((loc, i) => entries.push({ loc, lastmod: sitePath(sitemap).startsWith('/sitemap-articles-') ? mods[i] : undefined }));
  }
  assert.equal(new Set(entries.map((e) => e.loc)).size, entries.length, 'Sitemaps contain duplicate URLs');
  assert.ok(entries.some((e) => e.loc === `${SITE}/daily/${latestDate}`), 'Sitemap omits the latest daily edition');

  const sitemapArticles = new Set();
  for (const { loc, lastmod } of entries) {
    const route = sitePath(loc);
    let match;
    if ((match = route.match(/^\/daily\/(\d{4}-\d{2}-\d{2})$/))) {
      assert.ok(deployed.has(match[1]), `Sitemap lists an edition that is not deployed: ${loc}`);
    } else if ((match = route.match(/^\/daily\/(\d{4}-\d{2})$/))) {
      assert.ok(await isFile(path.join(exportDir, route, 'index.html')), `No month page exported for ${loc}`);
      await readJson(path.join(exportDir, `data/archive/${match[1]}.json`));
    } else if ((match = route.match(/^\/subjects\/([^/]+)$/))) {
      assert.ok(await isFile(path.join(exportDir, route, 'index.html')), `No subject page exported for ${loc}`);
      await readJson(path.join(exportDir, `data/subjects/${match[1]}.json`));
    } else if ((match = route.match(/^\/article\/([^/]+)$/))) {
      sitemapArticles.add(match[1]);
      const built = await isFile(path.join(dist, route, 'index.html'));
      assert.ok(built || (lastmod && deployed.has(lastmod)), `Sitemap lists an article that is not deployed: ${loc}`);
    } else {
      assert.ok(await isFile(path.join(dist, route === '/' ? '' : route, 'index.html')), `Sitemap URL has no built page: ${loc}`);
    }
  }
  const builtArticles = await listDirs(path.join(dist, 'article'));
  for (const pid of builtArticles) assert.ok(sitemapArticles.has(pid), `Built article is missing from the sitemap: ${pid}`);

  for (const dir of ['daily', 'subjects']) {
    for (const name of await listDirs(path.join(exportDir, dir))) {
      const html = await readFile(path.join(exportDir, dir, name, 'index.html'), 'utf8');
      for (const token of SHELL_TOKENS) assert.ok(!html.includes(token), `${dir}/${name} still contains ${token}`);
    }
  }
  return { latestDate, deployed: deployed.size, rssItems: feedLinks.length, sitemapUrls: entries.length, builtArticles: builtArticles.length };
}
