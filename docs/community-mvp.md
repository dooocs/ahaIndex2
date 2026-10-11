# Community MVP

## Scope

- Email magic-link registration/sign-in, persistent session, sign-out.
- Public paginated post list and static detail shell, without city filtering.
- City, age (18+) and gender are required and displayed on every post.
- One post per verified adult user, submit/edit, manual review, withdrawal.
- Post saves are at least 60 seconds apart. The editor shows a countdown from the
  saved timestamp; server-side throttling preserves the in-page edits for retry.
- Contact information is optional, separately stored, and visible to verified
  signed-in users only after the author explicitly consents and the post is live.
- Up to six optional photos, private signed-in viewing, thumbnails, reordering,
  removal, and full-image viewing. Photo changes require review again.
- No comments, chat, matching, payments, or new admin application.

Routes: `/login`, `/auth/callback`, `/account`, `/meet`, `/meet/new`, `/meet/post?id=123`.
Community links use the existing deployment's bare URL objects, without trailing
slashes. Return paths are normalized while preserving their query and fragment.
All are static shells. User data is fetched at runtime, never added to the daily
build, RSS, sitemap, or analytics payload. Community pages are `noindex`; actual
privacy is enforced by database privileges/RLS and RPC authorization, not robots.

## Separate project and closed-test rollout

Do not reuse the news pipeline Supabase project. Its legacy permissions require
a separate audit/remediation task. No changes to those permissions are included.

1. Create a dedicated Supabase project after confirming the organization and cost.
2. For ordinary Supabase Cloud, apply migrations `001` through `007` in
   `ahaIndexSync/sql/community/` in order, to that project only. Aliyun needs the
   generated invoker installation described below. Deploy `meet-photos`,
   `meet-photo-cleanup` and `meet-review`; Aliyun also requires `meet-api`.
3. Enable Email Auth with verification. Do not enable anonymous sign-ins or disable
   email confirmation. Keep the default signup and magic-link email templates.
   The current Free/default-provider API rejects template modifications (HTTP 400),
   so this MVP uses the emailed login link instead of a numeric-code input.
4. Official Supabase Cloud's default SMTP is a **team-only test service**, not a low-volume public
   email provider. It currently restricts recipients to organization team members
   and allows only two emails per hour. Confirm the tester's email is eligible.
   Never invite strangers to your Supabase organization merely to enable login.
   These limits do not establish Aliyun's SMTP behavior; verify Aliyun delivery,
   eligible recipients, and quotas independently before opening registration.
5. Set the Site URL to the intended test origin and the email OTP/link lifetime to
   600 seconds. Allow that origin's exact `/auth/callback` redirect URL (including
   callback query parameters) and retain the legacy `/auth/callback/**` entry; preserve
   server-side resend/verification rate limits. The static callback lets the
   Supabase SDK consume the implicit-flow fragment, clears auth parameters, checks
   the verified user, then follows only a sanitized same-origin return path.
   `ahaIndexSync/sql/community/supabase/config.toml` contains the closed-test config.
6. Configure these build-time public environment variables:

   ```dotenv
   PUBLIC_COMMUNITY_ENABLED=true
   PUBLIC_COMMUNITY_SUPABASE_URL=https://COMMUNITY_PROJECT.supabase.co
   PUBLIC_COMMUNITY_SUPABASE_KEY=sb_publishable_COMMUNITY_KEY
   PUBLIC_COMMUNITY_TURNSTILE_KEY=
   ```

   A modern publishable key or legacy JWT with the `anon` role is accepted, including
   Aliyun Supabase's anon key. Malformed JWTs and authenticated-user keys are rejected.
   This is a credential-type guard, not signature verification. Never put a secret/service-role key
   in any `PUBLIC_` variable. News build credentials remain separate and unchanged.
   Both deployment workflows accept these values as GitHub repository variables.

Auth and review session storage keys include the backend origin. Switching projects
requires a fresh sign-in/review-link exchange and never sends the old project's
session to the new service. The first deployment of this isolation also requires
existing users to sign in again; it does not delete their accounts or posts.

7. Use the private review link described below. Check adulthood, impersonation,
   inappropriate content, and contact details accidentally placed in public text.
   Publication starts a 30-day window; edits require another review.

## Private moderation link

`/meet/review/#key=<64 random hex characters>` is a long-lived bearer credential:
anyone holding it can read private submissions/photos and moderate them. It is
not protected merely by being unlisted. No ordinary website account is required.
Keep the original link private; bookmarking the cleaned address omits the key.

The dedicated page has no analytics or third-party scripts, uses no-referrer and
noindex, and clears the fragment from browser history when it loads. Only the key
hash is stored as the Edge secret `COMMUNITY_REVIEW_KEY_HASH`; the service-role
credential never reaches the browser. The server exchanges the key for a scoped
HMAC session valid for one hour. The entry key stays only in memory and the open
tab renews automatically. The original link does not expire. After a refresh the
short session is restored from sessionStorage; when that session expires, reopen
the original link. Closing/signing out clears access on that tab, not other tabs.

Create or restore the local link using authenticated Supabase CLI access:

```sh
export COMMUNITY_PROJECT_REF=YOUR_COMMUNITY_PROJECT_REF
node --env-file=.env scripts/create-community-review-link.mjs
```

The explicit ref must match `PUBLIC_COMMUNITY_SUPABASE_URL`; the news project is
always rejected. For Aliyun, set `ALIYUN_FUNCTIONS_CLI` to the official standalone
functions-cli and provide the service key only in the trusted server environment
as `COMMUNITY_SERVICE_ROLE_KEY` or `SUPABASE_API_KEY`. Do not download privileged
keys merely to run this helper locally. The general Aliyun Supabase CLI is not
accepted for this operation. The script never defaults to the old project.

The generated link is stored with mode 0600 in ignored
`.local/community-review-link.txt`. It first retains a mode-0600 pending recovery
copy, then requires an actual session exchange and authenticated review listing
before replacing the active link file. A failed configuration keeps the pending
copy and the original active file; do not lose the recovery copy during rotation.
Re-running preserves the existing key. To
replace a leaked link and invalidate existing sessions, run the same command with
`--rotate`. To revoke without replacement, unset `COMMUNITY_REVIEW_KEY_HASH` in
Supabase Edge Function Secrets. Already issued photo links may remain usable for
up to 120 seconds; downloaded/saved images cannot be revoked. Do not publish the
link, screenshot it, commit it, or put the key in a `PUBLIC_` environment variable.

The API is limited to review listing/details and pending -> published/rejected or
published -> withdrawn. It cannot edit text, create/delete accounts, or restore
withdrawn posts. Rejection/withdrawal requires a reason, shown to the owner.
Reviews compare the complete data/photo snapshot under the same per-user lock as
submissions; changed posts require re-review. Every decision adds a service-only
`meet_review_events` entry identifying the key version, not a named person.

The current local link works while the local server runs. For production, deploy
the frontend and set `COMMUNITY_REVIEW_ORIGIN=https://www.amazingindex.com` when
generating the link. This does not deploy the frontend or change Auth redirects.
Prefer a dedicated review origin and named moderator accounts as the team grows;
a bearer link is not suitable for individual staff attribution or device control.

Run `node --env-file=.env scripts/verify-community-review.mjs` for isolated mock UI
tests. `verify-community-review-live.mjs` requires `COMMUNITY_LIVE_TEST=true`, an
explicit `COMMUNITY_TEST_PROJECT_REF`, and a server-only `COMMUNITY_TEST_ADMIN_KEY`
to create disposable
fixtures, exercise the real Edge API, and delete its fixtures; it never moderates
existing user posts. SQL rollback tests are in `sql/community/review-tests.sql`.
Run it with Node's `--experimental-strip-types --env-file=.env` flags. Both live
checks accept modern secret keys or legacy service-role keys; neither discovers
admin credentials automatically. Review live checks require a localhost link.

## Aliyun code-only migration

The target is `spb-x6r06737x2zdpg3x` in `cn-hangzhou`. Migrate the schema, RLS,
functions, Auth configuration, and private storage configuration only. Do not
export or copy old users, identities, posts, contacts, photos, or sessions.

Run `ahaIndexSync/sql/community/aliyun-preflight.sql` before applying migrations.
It reads metadata only: role/database timeout settings, required Auth columns,
storage tables, extensions, and guards against the news database. The tested
image prohibits SECURITY DEFINER functions. Generate the single-transaction
Aliyun installation with `node sql/community/build-aliyun.mjs` in ahaIndexSync.
It uses service-role-only SECURITY INVOKER RPCs and a JWT-verifying `meet-api`
Edge gateway instead of exposing privileged functions to browser roles. The
frontend automatically selects this gateway for managed Aliyun hostnames.
Owner-only table reads still use RLS. Review RPCs remain server-only.
Do not enable the cleanup cron until its function, secret, and connectivity work.

The new project's management SQL connection was checked on 2026-10-11:
PostgreSQL 17.5, `statement_timeout=0`, `lock_timeout=0`. A subsequent metadata
query confirmed `anon` has `statement_timeout=3s`, `authenticated` has `8s`, and
`authenticator` has both statement and lock timeouts of `8s`. These are database
settings, not an end-to-end HTTP timeout guarantee. Installed extensions include
pgcrypto 1.3, pg_cron 1.6, and supabase_vault 0.3.1. Although pg_net is advertised,
its installation script and available versions are absent; the Aliyun adapter
uses the successfully installed HTTP extension for cleanup instead.
The Auth settings endpoint returned HTTP 200 from Cloud Shell after the service
whitelist was restored; database access restrictions were not widened. Schema
initialization subsequently committed successfully, including the private photo
bucket and server-only dispatcher. Auth settings were read back to confirm
email verification and production/local callbacks. A real OTP request to the
human-provided test mailbox returned success; receipt and browser callback
completion are still awaiting the mailbox owner. API acceptance is not delivery.

The general Aliyun CLI reported successful function deployment but actual
business endpoints returned HTTP 503 (`FC deployment is not ready`). The
official standalone functions-cli successfully deployed a no-dependency health
function with a real HTTP 200 response. The four business functions were then
bundled and deployed through that path, including their runtime settings. The frontend
has been switched locally to the new project, and the public-feed/anonymous
privacy readiness check passed. No production release or old-data copy has
occurred. Service credentials remain in Cloud Shell, not local exports.

A subsequent read-only permission audit confirmed all six business tables have
RLS enabled, owner-read policies compare `auth.uid()` to `owner_id`, browser
roles have no business RPC execution privileges or direct post writes, and the
photo bucket is private with a 1 MiB JPEG limit. Actual HTTP requests returned
200 for the service-role public-list dispatcher and 401/42501 for anonymous
dispatcher, raw posts, contacts, and photo rows. These checks do not prove a
complete two-user or photo workflow.

The four business functions now bundle locally without remote npm imports.
For the bundled photo runtime, `aliyun-runtime-assets.sql` creates a separate
private `community-runtime` bucket for the pinned ImageMagick WASM binary;
`COMMUNITY_BUNDLED_RUNTIME=true` makes the encoder load it through the internal
Storage gateway with a fixed size and SHA-256 check. Set `COMMUNITY_RPC_MODE=edge`
for photo listing. The human uploaded the 34-file source archive after automatic
upload was blocked. Its hash and contents were verified, and the private binary
was uploaded and downloaded with its expected SHA-256. Privileged credentials
remained in Cloud Shell, with no old-data export.

Live requests showed that standard Authorization credentials were not preserved
as expected through the function gateway. Aliyun function requests now carry
`X-Community-Authorization` as well; GoTrue, HMAC and cleanup-secret validation
remain mandatory. The fetch wrapper changes only the configured origin's
function routes, never Auth/REST routes or other hosts, and rejects redirects
to prevent forwarding the custom credential to another destination.
Review key exchange and listing returned 200, while a forged review session
returned 401. Anonymous feed, verified-user count and private-photo listing
also returned 200.

A synthetic user uploaded a 1200x1600 JPEG, submitted a pending photo post and
downloaded its private signed image; its metadata marker was stripped and the
pending post was invisible to anonymous readers. Cold upload initially exited
at approximately 230 MB peak memory. A single-buffer WASM loader removed a
duplicate allocation; fresh-revision first uploads at 1200x1600 and 1600x1600
both succeeded. These fixtures do not prove real SMTP delivery. Actual review
API tests confirmed pending invisibility, publication, stale-version HTTP 409,
required withdrawal reasons and invisibility after withdrawal. The original
review link opened in the local browser with a loaded private thumbnail.
The system confirmation dialog stalled the in-app browser; it was replaced by
an accessible page dialog that preserves explicit confirmation and cancellation.
Its browser regression, two-user checks, cleanup and production release still
need validation.

Final local verification on 2026-10-11 passed 54 frontend unit tests, 15 backend
Deno tests, Astro diagnostics (zero errors/warnings, five existing hints), and a
full 5,641-page build. RSS matched the homepage's 20 items; the database edition
and built edition both matched 2026-10-11. Static-output checks found the new
Aliyun origin and no old community origin, synthetic profile, test mailbox or
news build credential. A production-style preview runs at 127.0.0.1:4328; unlike
the development server's cold historical-statistics queries, its homepage loads
from verified static output. The in-app browser's outstanding system review
confirmation still prevents interaction testing. Cleanup setup was attempted in
Cloud Shell, but no execution result was observed; do not mark its cron ready.
These results do not imply deployment to amazingindex.com.

Login regression mocks deny external traffic by default and intercept OTP calls
regardless of the backend hostname. Only read-only local preview assets reach the
network; the mock tests must never consume real email quotas.

The backend now uses `SUPABASE_LOCAL_URL` when Aliyun provides it. This keeps
Auth, database, and Storage operations inside the project network. Private photo
links returned to authors, readers, and reviewers use the public `SUPABASE_URL`
with the same object path and short-lived token. The actual Supabase SDK signing
response is covered by a local regression test; this does not replace validation
of private photo delivery on the deployed Aliyun runtime.

The default `PUBLIC_COMMUNITY_ENABLED=false` keeps navigation hidden and renders a
closed message for direct community URLs. Rebuild after changing configuration.
Enabling the flag does not imply email delivery or production readiness.
Login errors distinguish email-send quota, IP request throttling, resend intervals,
and unauthorized test recipients. A local timestamp-only cooldown survives reloads
and is shared across tabs. It is an accidental-repeat guard, not a replacement for
Supabase's server limits. When a 429 omits a retry interval, the UI waits at least
60 seconds before another manual attempt; this is not a promise that the provider
quota has reset. Never disable verification or mint admin login links to bypass it.
Before deployment, `npm run verify:community:service` checks the real public feed
and anonymous access restrictions. Both deploy workflows run it before building.
It rejects mock credentials and reuse of the news project. This is a read-only
readiness check, not proof of email delivery or a completed two-user Auth test.

## CLI login with a local SOCKS proxy

On the current Mac, Supabase CLI 2.113.0 returns `HttpClientError: Transport error`
when the shell inherits `http_proxy` / `https_proxy` / `all_proxy` values using
`socks5://127.0.0.1:7897`. The same read-only API request reaches Supabase when
those variables are absent. For this environment, run CLI operations directly:

```sh
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
    -u http_proxy -u https_proxy -u all_proxy \
    supabase login --agent no --output-format text
```

Use the same `env -u ...` prefix for subsequent CLI project/config commands.
This affects only that process, not system proxy settings or shell profiles.
Keep TLS verification enabled. Complete the browser verification for the current
login session; codes from an older cancelled session cannot be reused. Never put
the resulting access token in a `PUBLIC_` variable or commit it to this repository.

## Before public signup

- Configure a custom SMTP provider and verify delivery to intended recipient domains.
- Change the Auth Site URL and callback allowlist to the production HTTPS origin.
- Configure Cloudflare Turnstile in Supabase Auth and set the public site key above.
  Exercise challenge failure, expiration, and retry paths on the actual test domain.
- Check email rate limits, moderation coverage, privacy/terms, and reporting mailbox.
- Review the existing dependency audit before opening to the public. The current
  lockfile reports legacy Astro/transitive advisories; this MVP does not upgrade the
  site's framework. Posts use DOM `textContent`, never HTML rendering or SSR input.
- Run the SQL access tests against a disposable database, and real two-user tests.
- Check live routing and cache behavior. Do not cache authenticated API responses.
- Account deletion is operator-assisted in this MVP: verify the request using the
  registered email, delete the Auth user through Auth administration, and confirm
  the cascading removal of posts/contacts. Never delete someone on an unverified request.
- For abuse, withdraw the post and ban the Auth user. Write/contact RPCs check
  `banned_until`, so existing sessions do not bypass that restriction.

## Verification

`npm test` covers configuration, form validation, return URLs, errors, and the
existing build tests. `npm run astro -- check` covers Astro/TypeScript.
`npm run verify:community:login` can run against the real-configured local server:
it intercepts all browser Supabase requests to test rate-limit messages, reload/tab
cooldowns and retries without sending email or consuming the real mail quota.

`ahaIndexSync/sql/community/tests.sql` verifies SQL permissions and the complete
post lifecycle in a transaction, rolling back its fixtures. The separate schema
tests include unverified/banned users, consent, direct-write rejection, per-user
ownership, re-review, pagination, expiry, withdrawal, and account deletion.

For a repeatable community-only browser test with **mock Auth/HTTP responses**, start:

```sh
PUBLIC_COMMUNITY_ENABLED=true \
PUBLIC_COMMUNITY_MOCK_TEST=true \
PUBLIC_COMMUNITY_SUPABASE_URL=https://community-preview.supabase.co \
PUBLIC_COMMUNITY_SUPABASE_KEY=sb_publishable_preview \
npm run dev -- --host 127.0.0.1 --port 4328
```

Then run `npm run verify:community` after `npx playwright install chromium`, or
`PLAYWRIGHT_CHANNEL=chrome npm run verify:community` using installed Chrome.
This test sends no emails and does not prove real Auth/SMTP integration. It checks
Login-link errors/callback, return navigation, submission, persistence, edit, withdrawal,
contact access, text escaping, sign-out, and 320/375/1365px layouts.

### Full-site local preview

The community-only command above does not supply news credentials. In a worktree
without a configured `.env`, community shells load but the homepage throws
`Missing SUPABASE_URL or SUPABASE_BUILD_KEY`. For full-site navigation, provide
the existing news environment as well, using Node.js >=22.12.0. Put the real
community URL, publishable key and enabled flag in the worktree's ignored `.env`.
Do not enable `PUBLIC_COMMUNITY_MOCK_TEST` for manual testing:

```sh
node --env-file=/absolute/path/to/existing/news/.env --env-file=.env \
  node_modules/astro/bin/astro.mjs dev --host 127.0.0.1 --port 4328
```

This reads the existing news environment without copying or committing its secrets.
Keep the news build key separate from all `PUBLIC_COMMUNITY_*` variables. Mock
credentials are only accepted in development with `PUBLIC_COMMUNITY_MOCK_TEST=true`;
production builds reject them even if that flag is set.
The first homepage request computes historical statistics and can take longer
than later requests; do not replace missing news configuration with empty data.

To include the real homepage in the automated mock regression, start a separate
server with the mock variables from the community-only command and the existing
news environment loaded. Then run:

```sh
COMMUNITY_TEST_HOMEPAGE=true PLAYWRIGHT_CHANNEL=chrome npm run verify:community
```

This checks both the daily tab and logo back to the homepage, real news content,
and navigation back to the community. Auth/community HTTP remains mocked. The
secret-free PR job intentionally runs without this optional news integration check.

Full regression: `npm run build`, `npm run verify:rss`, `npm run verify:build` with
the existing news build credentials. No deployment is performed by these commands.

### Real project integration

The closed-test project is `amazingindex-community` (`cfbzfbhpsbcthtwtpyfu`) in
Singapore, separate from the news project. It was created under the Free plan;
no paid add-ons were enabled. The migration and transactional SQL access tests
were applied successfully. The local ignored `.env` holds only public community
configuration; the database password was randomly generated, not logged or saved.
Use the dashboard's password reset if a direct database login is needed later.

`npm run verify:community:live` is an opt-in test against a dedicated project.
Supply `COMMUNITY_LIVE_TEST=true`, `COMMUNITY_TEST_PROJECT_REF`, and a server-only
`COMMUNITY_TEST_ADMIN_KEY` through the process environment. Never commit the key.
Start the real-config local dev server first; optionally set `PLAYWRIGHT_CHANNEL=chrome`.
The test creates two unique Auth fixtures using the official admin `generateLink`
API, opens real links in isolated browsers, submits/reviews/withdraws a test post,
checks cross-user RLS and contact privacy, then deletes its users in `finally` and
verifies cascading cleanup. It does not send emails or prove SMTP delivery.
Do not run this test against the news project or a public production rollout.

The security advisor flags intentionally exposed SECURITY DEFINER RPCs. The
anonymous RPCs expose only published, unexpired public fields (or the signed-in
owner's detail); authenticated mutations derive ownership from `auth.uid()`.
Contact reads require verified, non-banned users and explicit author consent.
Raw tables have RLS and no client write grants. These are reviewed exceptions,
not a claim of zero advisory findings. References:
- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

Photo tables deliberately have RLS with no client policies: only trusted service
code and narrow RPCs access them. The advisor reports this as INFO. It also reports
disabled leaked-password protection; the current UI uses passwordless links, not
passwords. Reassess this setting before exposing password registration:
- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Official references:
- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/auth-captcha

## Photos and design

The community pages follow the supplied `AmazingIndex-design-system` package:
paper colors, restrained red accents, serif headings, ruled rows, and a 333px
sidebar within a 1090px column. Existing self-hosted fonts are reused; Google
Fonts are not requested. Scope remains MVP: no reply counts, contact requests,
city filters, password flow, or invented statistics. City/age/gender remain
required. Unlike the public cover in the reference, all photos remain private.

- Browser accepts JPG/PNG/WebP up to 10 MB, re-encodes to JPEG to remove metadata,
  and writes a max-1600px main image plus a max-400px thumbnail. Both remain below
  900 KB. Browser bytes go directly to the private JPEG-only 1 MB/object Storage
  bucket. Storage INSERT policy accepts only a fresh reservation in that user's
  immutable photo directory. The browser cannot read, replace or delete objects.
- `meet-photos` Edge still validates Auth through `getUser` for private image
  signing and draft removal. It is not in the browser upload path.
- Signing is batched for up to 20 posts with a 120-second TTL. Lazy thumbnails
  refresh once on expiration. Original-size links are requested when opened.
  Sign-out clears private images. Previously issued links can outlive withdrawal
  for up to two minutes; downloaded images cannot be recalled.
- SQL enforces six selected photos, ownership, ready state, presence of main and
  thumbnail objects, atomic attachment and re-review. Twelve total reservations
  per owner allow replacement while editing a six-photo post. The old FC upload
  path's 30-attempt daily limit does not apply to direct Storage uploads.
  Originals are not stored. Service keys never enter the frontend.
- Failed uploads expire after 15 minutes; unattached drafts after 24 hours.
  Deleted/replaced photos and account cascades enqueue physical Storage deletion.
  Hourly `community-photo-cleanup` removes objects through the Storage API before
  removing queue rows. Do not delete `storage.objects` through SQL.
- Configure a random 32-byte `COMMUNITY_CLEANUP_SECRET` using CLI secrets, then call
  server-only `configure_meet_photo_cleanup(secret, functionUrl)` with the same
  secret. This puts the credential in Vault and registers `17 * * * *` in pg_cron.
  Check cron/pg_net responses and the deletion queue; retry failed cleanup calls.
  No paid image-transformation feature is required.
- Review images in the Supabase Storage dashboard before publishing the post.
  `meet_photos` associates the post with immutable owner/id paths; edit metadata
  through the app, not direct writes in the dashboard.

`photos-tests.sql` tests migration 002 permissions and ownership transactionally.
The mock browser test covers direct main/thumbnail upload and the six-photo UI
limit. Verify Aliyun authenticated Storage INSERT and private reads on the live
instance before release. The current browser encoder handles normal uploads;
the API cannot force a malicious direct caller to remove EXIF or send a valid
JPEG. Moderators should inspect images before publication. Tests never use
personal photos or send mail.
