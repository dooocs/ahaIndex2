#!/usr/bin/env bash
# One production run: list the bucket, plan, fetch the published data the
# export merges into, build, export, verify, upload. Used by
# .github/workflows/deploy.yml, and locally with DEPLOY_TARGET=local:/dir
# (or a stand-in ossutil on PATH) to rehearse a run end to end.
#
# MODE=feed is the hourly 动态 deploy: no plan or export; it builds the pages
# that need no edition list and uploads only /feed (plus new _astro assets).
#
# Environment:
#   MODE            daily | full | feed (required)
#   BACKFILL        daily only: "" | missing | 2026-10-01,2026-10-02
#   CLEANUP         full only: none | dry-run | delete (see deploy-oss.sh)
#   DEPLOY_TARGET   oss (default) | local:/dir
#   DEPLOY_PREFIX   key prefix for an isolated copy, e.g. "__test__/" (staging); default: the site itself
#   OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, SUPABASE_URL, SUPABASE_BUILD_KEY
set -euo pipefail

MODE="${MODE:?MODE must be daily, full or feed}"
TARGET="${DEPLOY_TARGET:-oss}"
BUCKET="${OSS_BUCKET:-amazingindex}"
PREFIX="${DEPLOY_PREFIX:-}"
export DEPLOY_PREFIX="$PREFIX"
WORK=.deploy
NODE_TS=(node --experimental-strip-types --no-warnings)
CREDS=(--endpoint https://oss-cn-hangzhou.aliyuncs.com --access-key-id "${OSS_ACCESS_KEY_ID:-}" --access-key-secret "${OSS_ACCESS_KEY_SECRET:-}" --region cn-hangzhou)

rm -rf "$WORK" dist export
mkdir -p "$WORK/previous"

# 1. What is on the bucket now: the ground truth for "deployed".
if [[ "$TARGET" == oss ]]; then
  ossutil ls "oss://$BUCKET/$PREFIX" --recursive "${CREDS[@]}" > "$WORK/oss-ls.txt"
  node scripts/lib/inventory.mjs --oss-ls "$WORK/oss-ls.txt" --bucket "$BUCKET" --prefix "$PREFIX" --out "$WORK/remote.json"
else
  node scripts/lib/inventory.mjs --local "${TARGET#local:}" --prefix "$PREFIX" --out "$WORK/remote.json"
fi

if [[ "$MODE" == feed ]]; then
  export BUILD_MODE=feed BUILD_DATES=
  DEPLOY_INVENTORY="$WORK/remote.json" npm run build
  # The page is complete: rendered from the database, not an error page or a shell.
  grep -qE 'class="[^"]*\bfeed-page\b' dist/feed/index.html || { echo "❌ dist/feed/index.html is not the feed page" >&2; exit 1; }
  if grep -q '__SHELL_' dist/feed/index.html; then echo "❌ dist/feed/index.html has a shell token" >&2; exit 1; fi
  INVENTORY="$WORK/remote.json" DEPLOY_TARGET="$TARGET" bash scripts/deploy-oss.sh
  exit 0
fi

# 2. Which editions to build.
"${NODE_TS[@]}" scripts/plan-build.ts --mode "$MODE" --backfill "${BACKFILL:-}" --inventory "$WORK/remote.json" --out "$WORK/plan.json"
BUILD_MODE=$(node -p "require('./$WORK/plan.json').mode")
BUILD_DATES=$(node -p "require('./$WORK/plan.json').dates.join(',')")
export BUILD_MODE BUILD_DATES

# 3. Daily: the published files the export merges the new editions into, and
#    every month file (each month's archive page is rendered from it). A file
#    that cannot be fetched is recomputed from the database instead.
if [[ "$BUILD_MODE" == daily ]]; then
  previous_files=$(node -e '
    const dates = process.env.BUILD_DATES.split(",");
    const files = ["data/summary.json", "data/archive/index.json"];
    // Every month file: the built months are merged into, the others render their /daily/<YYYY-MM> page.
    const published = Object.keys(require("./'"$WORK"'/remote.json").objects).filter((k) => /^data\/archive\/\d{4}-\d{2}\.json$/.test(k)).map((k) => k.slice(13, 20));
    for (const m of new Set([...dates.map((d) => d.slice(0, 7)), ...published])) files.push(`data/archive/${m}.json`);
    for (const y of new Set(dates.map((d) => d.slice(0, 4)))) files.push(`sitemap-articles-${y}.xml`);
    console.log(files.join(" "));')
  for rel in $previous_files; do
    mkdir -p "$(dirname "$WORK/previous/$rel")"
    if [[ "$TARGET" == oss ]]; then
      ossutil cp "oss://$BUCKET/$PREFIX$rel" "$WORK/previous/$rel" --force "${CREDS[@]}" > /dev/null 2>&1 || echo "ℹ️  $rel not fetched"
    else
      cp "${TARGET#local:}/$PREFIX$rel" "$WORK/previous/$rel" 2> /dev/null || echo "ℹ️  $rel not fetched"
    fi
  done
fi

# 4–6. Build, export, verify: nothing is uploaded unless all three pass.
DEPLOY_INVENTORY="$WORK/remote.json" npm run build
"${NODE_TS[@]}" scripts/export-site-data.ts --dist dist --out export --mode "$BUILD_MODE" --inventory "$WORK/remote.json" --previous "$WORK/previous"
node scripts/verify-site.mjs --dist dist --export export --inventory "$WORK/remote.json" --previous "$WORK/previous"

# 7. Upload what changed (daily) or everything (full).
INVENTORY="$WORK/remote.json" DEPLOY_TARGET="$TARGET" bash scripts/deploy-oss.sh
