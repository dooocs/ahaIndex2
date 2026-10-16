import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Dev server only: in production, OSS serves per-URL copies of the shell pages
 * and /data/*.json from the export script. Locally, map those URLs to the shell
 * routes and serve data from ./export (run `npm run build && npm run export:data` once).
 */
function devSiteData() {
  const exportDir = path.resolve('export');
  return {
    name: 'dev-site-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname.startsWith('/data/') && url.pathname.endsWith('.json')) {
          const file = path.join(exportDir, path.normalize(url.pathname));
          if (!file.startsWith(exportDir)) return next();
          try {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(await readFile(file));
          } catch {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Run `npm run build && npm run export:data` to create ./export' }));
          }
          return;
        }
        if (/^\/daily\/?$/.test(url.pathname)) req.url = `/shell/daily-year/${url.search}`;
        else if (/^\/daily\/\d{4}-\d{2}\/?$/.test(url.pathname)) req.url = '/shell/daily-month/';
        else if (/^\/subjects\/[^/]+\/?$/.test(url.pathname)) req.url = '/shell/subject/';
        next();
      });
    },
  };
}

export default defineConfig({
  site: 'https://www.amazingindex.com',
  vite: {
    plugins: [tailwindcss(), devSiteData()],
    optimizeDeps: {
      include: ['@supabase/supabase-js', 'lucide'],
    },
  },
  build: {
    format: 'directory',
  },
});
