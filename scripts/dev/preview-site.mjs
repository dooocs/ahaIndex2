// Serves dist/ and export/ merged the way OSS serves them (directory indexes,
// URLs with and without a trailing slash, 404.html), so a build can be checked
// in a browser before it is deployed:
//
//   npm run build && npm run export:data -- --dist dist --out export && npm run preview:site
//
// export/ wins over dist/, as on OSS where the export is uploaded after the
// pages. Shell templates under dist/shell/ are not served, as in production.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.PORT || 4400);
const ROOTS = [path.resolve('export'), path.resolve('dist')];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
};

async function findFile(urlPath) {
  const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^[/\\]+/, '');
  if (rel.startsWith('..') || rel.startsWith('shell')) return null;
  for (const root of ROOTS) {
    for (const candidate of [path.join(root, rel), path.join(root, rel, 'index.html')]) {
      if (!candidate.startsWith(root)) continue;
      if ((await stat(candidate).catch(() => null))?.isFile()) return candidate;
    }
  }
  return null;
}

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const file = await findFile(pathname);
  const target = file ?? await findFile('/404.html');
  res.writeHead(file ? 200 : 404, { 'Content-Type': TYPES[path.extname(target ?? '')] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(target ? await readFile(target) : 'Not found');
}).listen(PORT, '127.0.0.1', () => console.log(`[preview-site] http://127.0.0.1:${PORT} serving ${ROOTS.join(' over ')}`));
