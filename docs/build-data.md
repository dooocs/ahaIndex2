# Static build data

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

Run `npm test`, `npm run astro -- check`, `npm run build`, `npm run verify:rss`,
and `npm run verify:build`. The latter loads `.env` if present and needs database
read access. It compares the latest database edition with the homepage and RSS,
parses the XML sitemaps, checks that their pages exist, and compares every built
article page with the article sitemap. Project detail pages must also exist.
Failures stop CI before the OSS upload. Production build/deploy runs are
serialized and have a 45-minute job limit.

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

The next performance step is to separate repeated project metadata and
`related_data` from the historical daily score series, or publish a versioned
build snapshot from the pipeline. That is a separate data-contract change.
