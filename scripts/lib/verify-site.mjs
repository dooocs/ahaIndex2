// Release checks, run before anything is uploaded.
//   verifyDist: the pages this run built (daily or full) are complete and current.
//   verifyExport: feeds, sitemaps, data and shell copies agree with the built
//   pages and only point at pages that are deployed: on the bucket inventory
//   taken at the start of the run, built by this run, or exported by it.
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

/**
 * `dates`: the editions a daily build rendered; ignored for full builds.
 * `inventory`: what is on the bucket, for links to pages this run did not build.
 */
export async function verifyDist(dist, { latestDate, mode, dates = [], inventory = new Map() }) {
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
  // 上一期 links only to an edition that is deployed or built now.
  const editionPages = ['index.html', ...(await listDirs(path.join(dist, 'daily'))).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).map((d) => `daily/${d}/index.html`)];
  for (const page of editionPages) {
    const nodes = [...elements(parse(await readFile(path.join(dist, page), 'utf8')))];
    for (const link of nodes.filter((node) => node.tagName === 'a' && attr(node, 'rel') === 'prev')) {
      const key = `${attr(link, 'href').replace(/^\//, '').replace(/\/$/, '')}/index.html`;
      assert.ok(inventory.has(key) || await isFile(path.join(dist, key)), `${page} links 上一期 to a page that is not deployed: ${attr(link, 'href')}`);
    }
  }
  for (const shell of ['shell/daily-year/index.html', 'shell/daily-month/index.html']) {
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

/**
 * `inventory`: key → ETag of what is on the bucket (empty for a full run without one).
 * `previousDir`: the published files a daily export merged into; nothing they
 * list may be missing from the new files.
 */
export async function verifyExport(exportDir, dist, { latestDate, inventory = new Map(), previousDir }) {
  const deployed = async (key) => inventory.has(key) || await isFile(path.join(dist, key)) || await isFile(path.join(exportDir, key));

  const summary = await readJson(path.join(exportDir, 'data/summary.json'));
  const dates = summary.editions.map((e) => e.date);
  assert.equal(summary.latest_date, latestDate, 'summary.json is not using the latest database edition');
  assert.deepEqual(dates, [...dates].sort().reverse(), 'summary.json editions are not newest first');
  assert.equal(new Set(dates).size, dates.length, 'summary.json lists an edition twice');
  for (const date of dates) assert.ok(await deployed(`daily/${date}/index.html`), `summary.json lists an edition that is not deployed: ${date}`);
  for (const date of (await listDirs(path.join(dist, 'daily'))).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    assert.ok(dates.includes(date), `Built edition ${date} is missing from summary.json`);
  }
  const index = await readJson(path.join(exportDir, 'data/archive/index.json'));
  const indexMonths = index.years.flatMap((y) => y.months.map((m) => m.month.slice(0, 7)));
  assert.deepEqual([...new Set(dates.map((d) => d.slice(0, 7)))].sort(), [...indexMonths].sort(), 'archive/index.json months differ from the published editions');

  const home = await homepage(dist);
  const feed = xmlValues(await readFile(path.join(exportDir, 'rss.xml'), 'utf8'));
  const feedLinks = feed.get('rss/channel/item/link') ?? [];
  assert.ok(feedLinks.length > 0, 'RSS must not be empty');
  assert.equal(new Set(feedLinks).size, feedLinks.length, 'RSS contains duplicate articles');
  assert.deepEqual([...feedLinks].sort(), [...home.links].sort(), 'Homepage and RSS article links differ');
  const feedDate = new Date(feed.get('rss/channel/lastBuildDate')?.[0]).toISOString().slice(0, 10);
  assert.equal(feedDate, latestDate, 'RSS is not using the latest database edition');

  await readJson(path.join(exportDir, 'data/history.json'));
  // Retired 专题 pages only send readers on, to a page that exists.
  for (const name of ['', ...await listDirs(path.join(exportDir, 'subjects'))]) {
    const file = path.join(exportDir, 'subjects', name, 'index.html');
    if (!(await isFile(file))) continue;
    const html = await readFile(file, 'utf8');
    assert.ok(html.includes('content="noindex'), `subjects/${name} is not a noindex retired page`);
    const target = html.match(/http-equiv="refresh" content="0; url=([^"]+)"/)?.[1];
    assert.ok(target, `subjects/${name} has no redirect`);
    const key = target === '/people' ? 'people/index.html' : `${target.slice(1)}/index.html`;
    assert.ok(await deployed(key), `subjects/${name} redirects to a page that is not deployed: ${target}`);
  }
  for (const file of await readdir(path.join(exportDir, 'data/archive'))) {
    if (file === 'index.json') continue;
    const month = await readJson(path.join(exportDir, 'data/archive', file));
    for (const record of month.records) assert.ok(dates.includes(record.date), `archive/${file} lists an edition that is not published: ${record.date}`);
  }

  const sitemapIndex = xmlValues(await readFile(path.join(exportDir, 'sitemap.xml'), 'utf8'));
  const sitemaps = sitemapIndex.get('sitemapindex/sitemap/loc') ?? [];
  assert.ok(sitemaps.length > 0, 'Sitemap index is empty');
  const entries = [];
  for (const sitemap of sitemaps) {
    const rel = sitePath(sitemap).slice(1);
    assert.ok(await deployed(rel), `Sitemap index lists a file that is not deployed: ${sitemap}`);
    // Sitemaps this run did not regenerate are already on the bucket.
    if (!(await isFile(path.join(exportDir, rel)))) continue;
    const locs = xmlValues(await readFile(path.join(exportDir, rel), 'utf8')).get('urlset/url/loc') ?? [];
    assert.ok(locs.length > 0, `Empty sitemap: ${sitemap}`);
    entries.push(...locs);
  }
  assert.equal(new Set(entries).size, entries.length, 'Sitemaps contain duplicate URLs');
  assert.ok(entries.includes(`${SITE}/daily/${latestDate}`), 'Sitemap omits the latest daily edition');

  const sitemapArticles = new Set();
  for (const loc of entries) {
    const route = sitePath(loc);
    const key = route === '/' ? 'index.html' : `${route.slice(1)}/index.html`;
    assert.ok(await deployed(key), `Sitemap lists a page that is not deployed: ${loc}`);
    const month = route.match(/^\/daily\/(\d{4}-\d{2})$/);
    if (month) await readJson(path.join(exportDir, `data/archive/${month[1]}.json`)).catch(async (error) => {
      // A month file is only rewritten when its editions change.
      if (!inventory.has(`data/archive/${month[1]}.json`)) throw error;
    });
    const article = route.match(/^\/article\/([^/]+)$/);
    if (article) sitemapArticles.add(article[1]);
  }
  if (previousDir) {
    const before = await readFile(path.join(previousDir, 'data/summary.json'), 'utf8').then(JSON.parse).catch(() => null);
    for (const { date } of before?.editions ?? []) {
      assert.ok(dates.includes(date), `Previously published edition ${date} is missing from summary.json`);
    }
    for (const file of await readdir(previousDir).catch(() => [])) {
      if (!/^sitemap-articles-\d{4}\.xml$/.test(file)) continue;
      for (const loc of xmlValues(await readFile(path.join(previousDir, file), 'utf8')).get('urlset/url/loc') ?? []) {
        assert.ok(entries.includes(loc), `Previously published article ${loc} is missing from the article sitemaps`);
      }
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

  // The archive pages carry their content: /daily links every published
  // month, each month page links every one of its editions.
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const archivePage = async (rel) => {
    const file = path.join(exportDir, rel);
    assert.ok(await isFile(file), `Archive page was not exported: ${rel}`);
    const html = await readFile(file, 'utf8');
    for (const token of SHELL_TOKENS) assert.ok(!html.includes(token), `${rel} still contains ${token}`);
    const nodes = [...elements(parse(html))];
    assert.ok(!nodes.some((node) => node.attrs?.some((a) => a.name === 'data-loading')), `${rel} was exported without its content`);
    return new Set(nodes.filter((node) => node.tagName === 'a').map((node) => attr(node, 'href')));
  };
  const yearLinks = await archivePage('daily/index.html');
  for (const month of months) assert.ok(yearLinks.has(`/daily/${month}`), `/daily does not link ${month}`);
  for (const month of months) {
    const links = await archivePage(`daily/${month}/index.html`);
    for (const date of dates.filter((d) => d.startsWith(month))) {
      assert.ok(links.has(`/daily/${date}`), `/daily/${month} does not link the edition ${date}`);
    }
  }
  return { latestDate, published: dates.length, rssItems: feedLinks.length, sitemapUrls: entries.length, builtArticles: builtArticles.length };
}
