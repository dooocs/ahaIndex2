# Build and release

Principle: the daily build is small, predictable and strictly incremental;
everything else happens only when a full build is asked for. Both modes run
`scripts/run-deploy.sh` (from `.github/workflows/deploy.yml`): list the
bucket, plan, build, export, verify, upload.

| | daily (`build-deploy.yml`) | full (`full-build.yml`) |
| --- | --- | --- |
| Trigger | every `repository_dispatch` (`pipeline-done` etc.), push to `main`, manual | manual only |
| Astro renders | the newest edition and the one before it, articles whose newest edition is one of them, and the pages that need no data | every page |
| Database | 2 small queries to plan; the built editions; the 60-day subject window | every edition, every article, all subject mentions |
| Export | merges the built editions into the published data and sitemaps | recomputes all data and sitemaps |
| Uploads | only files whose MD5 differs from the object on OSS; nothing deleted | everything; optional cleanup |
| CDN | refreshes the uploaded URLs | refreshes the whole site |

A daily run never turns into a full one. Pages it does not build stay on OSS
exactly as they were last uploaded.

### 动态 (/feed): the hourly feed deploy

`/feed` is an ordinary Astro page (`src/pages/feed.astro`) rendered at build
time from `proc_feed_posts`, which Octopus writes every hour (original X
posts of the bloggers it follows, translated to Chinese). Daily and full runs
rebuild it like any other page. In between, **Feed Deploy**
(`feed-deploy.yml`) runs `scripts/run-deploy.sh` with `MODE=feed`: a
`BUILD_MODE=feed` build renders no editions, articles or project pages, and
the deploy uploads only `feed/index.html`, its bare-URL copy and any `_astro`
file not yet on OSS, then refreshes the two `/feed` URLs. It is triggered by
Octopus (`repository_dispatch: feed-updated`) with an hourly schedule as a
fallback, and has its own concurrency group so it never displaces a waiting
daily or full deploy.

The page shows the 24 hours up to the newest post (not the build time, so a
rebuild with no new posts is byte-identical and uploads nothing): one card per blogger
(newest first), each post's original text with `text_zh` below it (an empty
`text_zh` means none is needed). Only media archived on the site's OSS is
shown. The build reads `proc_feed_posts` with `SUPABASE_BUILD_KEY`, so the
table must be readable by that key (Octopus `sql/013` grants anon read).

### Deployed = on the bucket

Each run starts with one listing of the bucket (`ossutil ls --recursive`,
parsed by `scripts/lib/inventory.mjs`). That listing, plus the pages the run
builds, is what "deployed" means. Sitemaps, RSS and data are generated from
database data but only reference deployed pages; `scripts/verify-site.mjs`
fails the run before any upload if one of them, or a 上一期 link, points
elsewhere. The listing's ETags (MD5 for normal uploads) let a daily deploy
skip unchanged files.

Published content is never dropped silently. If an edition or article that
the published `summary.json`, a month file or an article sitemap lists is
missing from the listing, the export stops with an error naming it, and
nothing is uploaded; the verify step also checks that every previously
published edition and article is still listed. Content leaves the published
data only through an explicit full build after it was removed from the
database.

### Incremental data

`data/archive/<YYYY-MM>.json` holds a ledger: one record per edition (score,
item count, top story, first three stories), from which the month and year
views are derived (`src/lib/edition-ledger.ts`). A daily export reads the
published `summary.json`, `archive/index.json`, the month files and the
article sitemaps of the built editions (fetched from OSS into
`.deploy/previous/`), recomputes the built editions' records from the
database, and merges them in. A file it cannot fetch is recomputed from the
database instead; with no published `summary.json` at all (the first run), it
reads every edition once. Subject statistics anchor their 30-day window at the
newest edition and read only the mentions of the last 60 days.

### Missed builds

The newest-two rule repairs one missed day by itself: the next run builds the
missed edition as "the one before". A longer gap leaves editions off OSS:
they stay out of the sitemap and data, 上一期 on the edition after the gap
skips to the nearest deployed edition (the build reads the same listing), and
the plan step warns (`edition … is not on OSS`). Run **Build & Deploy**
manually with backfill `missing` (it compares every database edition with
the bucket, at most 16 editions per run) or with a list of dates; the edition
after each restored one is rebuilt too, so its 上一期 points at it again.
下一期 is filled in by the browser from `summary.json`, so neighbours pick up
a restored edition without a rebuild.

### When to run a full build

A daily build leaves older edition pages, older articles and project pages as
they were last built. Run **Full Build & Deploy** after:

- changing a template or component that older editions or articles use;
- changing the shape of `data/*.json` (bump `DATA_VERSION` in
  `src/lib/site-export.ts`; pages show a load error until rebuilt);
- the pipeline revising or removing items of past editions (their records,
  pages and sitemap entries are only recomputed by a full build);
- wanting project pages refreshed.

Pages built before this build system keep working: every link on them still
resolves (checked by rehearsing the first run on a bucket deployed by the
previous code). What they lack until one manual full build: 上一期/下一期
navigation, and a sidebar (calendar, 7-edition chart, edition count) that
follows the live data instead of the build they came from. The archive,
month, subject, history and static pages are replaced by the first daily run
(the archive and month pages with their content rendered in).

Both workflows share one concurrency group, so deploys never overlap. GitHub
keeps one waiting run per group: a trigger that arrives while one run is in
progress and another is waiting replaces the waiting one, so re-run a waiting
full build if a daily run displaced it.

### Where each page comes from

- **Astro (SSG):** `/`, `/daily/<date>`, `/article/<pid>`, project pages,
  static pages.
- **Export-rendered archive:** `/daily` and every `/daily/<YYYY-MM>` are
  written by the export on every run, daily and full, from the shell
  templates `src/pages/shell/daily-year.astro` and `daily-month.astro` with
  their content already in the HTML (`fillSlots` fills each
  `data-ssr-slot` element with markup from `src/lib/archive-render.ts`).
  Crawlers and readers without JavaScript get every month and edition link.
  A daily run renders the months it did not build from their published
  month files, which `run-deploy.sh` fetches; a month file it cannot fetch is
  recomputed from the database and published again. Unchanged pages are not
  uploaded. `verify-site.mjs` fails the run if `/daily` misses a month or a
  month page misses one of its editions. In the browser,
  `src/scripts/archive-pages.ts` only renders when a page still shows its
  loading state (the dev server) or another year is asked for (`?year=`).
- **Shells + data:** `/history`, `/subjects`, `/subjects/<slug>`, the sidebar
  calendar/chart and 下一期 on edition pages are rendered in the browser from
  `/data/*.json` (`src/scripts/*-pages.ts`, `src/scripts/sidebar.ts`). The
  browser never reads the database.
- **Export (`scripts/export-site-data.ts`):** `data/*.json`, `sitemap*.xml`,
  `rss.xml`, the archive pages above, and per-URL copies of the subject shell
  (each subject URL is a real object with its own title, description and
  canonical URL).

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

To look at a build as it will be served, with real credentials in `.env`:

```sh
npm run build && npm run export:data -- --dist dist --out export
npm run preview:site            # http://127.0.0.1:4400, dist + export merged as on OSS
```

To rehearse whole runs without OSS, point `scripts/run-deploy.sh` at a
directory standing in for the bucket (with the mock database running):

```sh
MODE=full DEPLOY_TARGET=local:/tmp/bucket bash scripts/run-deploy.sh
MODE=daily DEPLOY_TARGET=local:/tmp/bucket bash scripts/run-deploy.sh
```

`npm run test:e2e` runs deploy scenarios end to end (`tests/e2e/`): the real
`run-deploy.sh` against the mock database and a stand-in ossutil
(`scripts/dev/fake-ossutil.mjs`): a multi-day gap and its backfill, an
incomplete listing, interrupted page and bare-copy uploads, the first run on a
bucket without data files, and a run with nothing new. After each run every
internal link and every data/sitemap reference must resolve. About 5 minutes;
it runs on pull requests.

The **Test Deploy (Staging)** workflow runs the production script against the
real bucket under `__test__/` only (nothing else is written, the CDN is not
touched): a full run, a check that the real `ossutil ls` output lists every
uploaded object with an ETag equal to its local MD5, a daily run on top, and
the same daily run again, which must upload nothing. It is not a visual
preview: pages under `__test__/` load `/_astro/` and `/data/` from the site
root.

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

`npm test` runs before every deploy. After the export,
`scripts/verify-site.mjs` compares the newest database edition with the
homepage, RSS and summary, checks every homepage article was built, and checks
that data, sitemaps and the sitemap index only reference deployed pages and
that no shell token is left. Nothing is uploaded unless it passes.

`scripts/deploy-oss.sh` uploads assets, then pages, then the bare-URL copies
(`/daily/2026-10-13` serves the same page as `/daily/2026-10-13/`), and only
then the data, RSS and sitemaps that point at them, then refreshes the CDN.
Any failed upload stops the deploy before the indexes change; the next run
retries, since it compares against the bucket again.

A full run can list (`dry-run`, the default) or delete objects under
`_astro/ article/ daily/ data/ projects/ subjects/` that no deploy writes any
more. Deletion refuses to remove more than 30% of them. Objects outside those
prefixes (for example `og/`) are never touched.

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
