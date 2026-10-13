# Build and release

The site is built in two modes. Both end in the same export, verification and
upload steps (`.github/workflows/build-deploy.yml`).

| | daily | full |
| --- | --- | --- |
| Trigger | `pipeline-done` / `external-workflow-complete` dispatch | push to `main`, `build-deploy` dispatch, manual run, Sundays 03:17 Beijing |
| Astro renders | homepage, the newest two editions, editions missing from the deploy manifest, and their articles | every page |
| Uploads | those pages + `_astro/` + the export, nothing deleted | everything + the export; optional cleanup |
| CDN | refreshes the changed URLs | refreshes the whole site |

`scripts/plan-build.ts` picks the mode. A daily run falls back to full when OSS
has no deploy manifest yet or more than 7 editions are missing from it.

### Where each page comes from

- **Astro (SSG):** `/`, `/daily/<date>`, `/article/<pid>`, project pages,
  static pages. Project pages are rebuilt by full builds only.
- **Shells + data:** `/daily`, `/daily/<YYYY-MM>`, `/history`, `/subjects`,
  `/subjects/<slug>`, and the sidebar calendar/chart on edition pages are
  rendered in the browser from `/data/*.json` (`src/scripts/*-pages.ts`,
  `src/scripts/sidebar.ts`). The browser never reads the database.
- **Export (`scripts/export-site-data.ts`):** writes `data/*.json`,
  `sitemap*.xml`, `rss.xml`, the deploy manifest, and per-URL copies of the
  shell templates in `src/pages/shell/` (each month and subject URL is a real
  object with its own title, description and canonical URL). Sitemaps and data
  only include editions listed in the manifest, i.e. pages that are deployed.

`_deploy/manifest.json` on OSS lists the deployed editions. It is uploaded last,
after every page it lists is live, and the next daily run reads it.

### Local development

`npm run dev` needs database credentials only for pages that read news data.
Without production access, run the deterministic mock database:

```sh
npm run dev:mock-db &           # http://127.0.0.1:54399, synthetic editions
export SUPABASE_URL=http://127.0.0.1:54399 SUPABASE_BUILD_KEY=sb_publishable_mock
npm run build && npm run export:data -- --dist dist --out export   # once, for /data
npm run dev
```

The dev server maps `/daily/<YYYY-MM>` and `/subjects/<slug>` to their shell
routes and serves `/data/*.json` from `./export`. A daily build is
`BUILD_MODE=daily BUILD_DATES=2026-02-20,2026-02-19 npm run build`.


## Credentials

Set `SUPABASE_URL` and `SUPABASE_BUILD_KEY` in `.env` or CI. The key must have
read access to the tables used by the site. A publishable key uses `anon`; a
secret key uses `service_role`. The build logs the key type and role, never the
credential. The old `SUPABASE_SERVICE_ROLE_KEY` variable and GitHub Secret remain
supported as fallbacks, including installations that put a publishable key there.
Do not expose server-side keys through `PUBLIC_` variables or generated assets.

The production configuration audited on 2026-10-07 had `anon.statement_timeout`
at 15 seconds and `service_role.statement_timeout` at 80 seconds. The failing
GitHub requests used a publishable key, so the applicable role was `anon`.
These are audit values, not constants enforced or changed by this repository.
Check `pg_roles.rolconfig` and `pg_db_role_setting` before changing database
timeouts; `SHOW statement_timeout` on an administrative connection does not
describe the API request's role settings.

## Heatmap pagination

`project_heatmap_data` is read in ascending UUID primary-key order, in pages of
500 rows. The next request uses `id > last_id`, never a growing offset. No extra
index or database migration is required. All historical dates are retained.
Each page logs its cursor, row count, duration and attempt. The completion line
reports the total rows, pages, maximum successful page time and total time.

A database timeout reduces the page size down to a minimum of 100. Transport,
rate-limit and server errors also get bounded retries with backoff. A page has
at most four application attempts. Only a successful page advances the cursor;
duplicate, missing or non-increasing IDs fail the build. Exhausted retries fail
the build instead of returning partial data. Each request has a 20-second client
deadline in addition to the database's own timeout.

Build after the pipeline finishes. Keyset pagination is not a cross-request
database snapshot: concurrent inserts or updates can change the dataset during
the read. When auditing row counts, use a stable pipeline window. A future
versioned build snapshot can address this separately without truncating history.

## Verification and release

CI runs `npm test`, the build, the export, then `npm run verify:site -- --dist
dist --export export` before anything is uploaded. It compares the newest
database edition with the homepage and RSS, checks every homepage article was
built, that sitemaps list only deployed editions and articles, that every month
and subject URL has its exported page and data, and that no shell token is left.
Production runs are serialized and have a 45-minute job limit.

`scripts/deploy-oss.sh` uploads assets first, then pages, data and feeds, then
the bare-URL copies, then the manifest, then refreshes the CDN. Set
`DEPLOY_TARGET=local:/tmp/bucket` to rehearse a deploy into a directory.

A manual full run can list (`dry-run`, the default; also on the weekly run) or
delete objects under `_astro/ article/ daily/ data/ projects/ subjects/` that no
deploy writes any more. Deletion refuses to remove more than 30% of them.
Objects outside those prefixes (for example `og/`) are never touched.

For a production data audit, compare the heatmap completion count and generated
project count against `count(*)` and `count(distinct subject_id)` from
`project_heatmap_data`, and inspect the full historical date range. Aim for page
times below 5 seconds under the current 15-second database timeout. After release,
verify the live homepage and RSS dates, an old project history page, and the next
scheduled pipeline's deployment result.

On a case-insensitive local filesystem, existing project slugs that differ only
by case can overwrite each other's output paths. The 2026-10-07 audit found three
such pairs: ComfyUI, crewAI and OpenSquilla. Check the rendered route list as well
as file counts; release builds run on case-sensitive Linux in GitHub Actions.
This pagination change does not rename or merge those existing project URLs.
