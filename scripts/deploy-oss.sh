#!/usr/bin/env bash
# Uploads a verified build (dist/) and export (export/) to OSS, then refreshes
# the CDN. Run after the build, scripts/export-site-data.ts and
# scripts/verify-site.mjs have passed: nothing here re-checks content.
# Daily uploads only what differs from the bucket inventory taken at the start
# of the run; full uploads everything. Neither deletes anything unless
# CLEANUP=delete is asked for on a full run.
#
# Environment:
#   BUILD_MODE      daily | full | feed (required; feed = only /feed, /people and their assets)
#   BUILD_DATES     daily mode: the edition dates that were built (comma-separated)
#   INVENTORY       bucket listing from scripts/lib/inventory.mjs (default .deploy/remote.json; required for daily)
#   DEPLOY_PREFIX   object key prefix, e.g. "__test__/" for staging (default: none)
#   DEPLOY_TARGET   oss (default) | local:/path — a directory standing in for the bucket, for dry runs
#   SKIP_CDN        1 = do not refresh the CDN
#   CLEANUP         none (default) | dry-run | delete — full mode only: objects no deploy writes any more
#   OSS_BUCKET      default amazingindex
#   OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET   for DEPLOY_TARGET=oss
set -euo pipefail

MODE="${BUILD_MODE:?BUILD_MODE must be daily, full or feed}"
DATES="${BUILD_DATES:-}"
PREFIX="${DEPLOY_PREFIX:-}"
TARGET="${DEPLOY_TARGET:-oss}"
BUCKET="${OSS_BUCKET:-amazingindex}"
CLEANUP="${CLEANUP:-none}"
DIST="${DIST_DIR:-dist}"
EXPORT="${EXPORT_DIR:-export}"
WORK="${DEPLOY_WORKDIR:-.deploy}"
INVENTORY="${INVENTORY:-$WORK/remote.json}"

START=$(date +%s)
INVENTORY_ARGS=()
[[ -f "$INVENTORY" ]] && INVENTORY_ARGS=(--inventory "$INVENTORY")
node scripts/lib/deploy-files.mjs --dist "$DIST" --export "$EXPORT" --mode "$MODE" --dates "$DATES" "${INVENTORY_ARGS[@]}" --out "$WORK"
STAGE="$WORK/stage"

if [[ "$TARGET" == oss ]]; then
  CREDS=(--endpoint https://oss-cn-hangzhou.aliyuncs.com --access-key-id "$OSS_ACCESS_KEY_ID" --access-key-secret "$OSS_ACCESS_KEY_SECRET" --region cn-hangzhou)
  DEST="oss://$BUCKET/$PREFIX"
  # For the parallel workers below (xargs runs them in fresh shells).
  export DEST OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET
  copy_bare() {
    # Server-side copy: REPLACE, or the copy keeps the source's headers and ignores ours.
    ossutil cp "$DEST$1" "$DEST$2" --force --metadata-directive REPLACE --cache-control "no-cache" --content-type "text/html; charset=utf-8" \
      --endpoint https://oss-cn-hangzhou.aliyuncs.com --access-key-id "$OSS_ACCESS_KEY_ID" --access-key-secret "$OSS_ACCESS_KEY_SECRET" --region cn-hangzhou > /dev/null
  }
  remove_key() {
    ossutil rm "$DEST$1" --force \
      --endpoint https://oss-cn-hangzhou.aliyuncs.com --access-key-id "$OSS_ACCESS_KEY_ID" --access-key-secret "$OSS_ACCESS_KEY_SECRET" --region cn-hangzhou > /dev/null
  }
  export -f copy_bare remove_key
elif [[ "$TARGET" == local:* ]]; then
  LOCAL_ROOT="${TARGET#local:}/$PREFIX"
  LOCAL_ROOT="${LOCAL_ROOT%/}/"
  mkdir -p "$LOCAL_ROOT"
else
  echo "Unknown DEPLOY_TARGET $TARGET" >&2
  exit 1
fi

# put SRC_DIR KEY_PREFIX CACHE_CONTROL CONTENT_TYPE JOBS — upload a directory under a key prefix, never deleting.
put() {
  local src="$1" sub="$2" cache="$3" type="$4" jobs="$5"
  [[ -d "$src" ]] || return 0
  if [[ "$TARGET" == oss ]]; then
    local meta=()
    # Real HTTP headers. (--metadata would only write x-oss-meta-* user metadata,
    # which browsers, crawlers and the CDN all ignore.)
    [[ -n "$cache" ]] && meta+=(--cache-control "$cache")
    [[ -n "$type" ]] && meta+=(--content-type "$type")
    ossutil sync "$src/" "$DEST$sub" --force -j "$jobs" "${meta[@]}" "${CREDS[@]}"
  else
    mkdir -p "$LOCAL_ROOT$sub"
    cp -R "$src/." "$LOCAL_ROOT$sub"
  fi
}

# 1. Assets first, so no uploaded page references a missing file.
put "$STAGE/astro" "_astro/" "max-age=31536000,immutable" "" 20 &
PID_ASTRO=$!
put "$STAGE/other" "" "" "" 10 &
PID_OTHER=$!
wait "$PID_ASTRO"
wait "$PID_OTHER"
echo "✅ assets uploaded"

# 2. Pages, then their bare-URL copies (/daily/2026-10-13 serves the same
#    page as /daily/2026-10-13/). Every page the new indexes point at is in
#    place before step 3 publishes them.
put "$STAGE/html" "" "no-cache" "text/html; charset=utf-8" 20
echo "✅ pages uploaded"
if [[ "$TARGET" == oss ]]; then
  # xargs exits non-zero if any copy fails.
  tr '\t\n' '\0\0' < "$WORK/bare.txt" | xargs -0 -r -P 20 -n 2 bash -c 'copy_bare "$1" "$2"' _
  echo "✅ bare URLs copied: $(grep -c . "$WORK/bare.txt" || true)"
else
  echo "ℹ️  local target: bare URL copies skipped ($(grep -c . "$WORK/bare.txt" || true))"
fi

# 3. Last, the data, RSS and sitemaps that point at those pages. Any failure
#    above stops the script here, leaving the previous indexes published.
put "$STAGE/json" "" "max-age=300" "application/json; charset=utf-8" 10 &
PID_JSON=$!
put "$STAGE/xml" "" "max-age=300" "application/xml; charset=utf-8" 5 &
PID_XML=$!
wait "$PID_JSON"
wait "$PID_XML"
echo "✅ data, RSS and sitemaps uploaded"

echo "✅ deploy took $(( $(date +%s) - START ))s"

# 4. CDN.
if [[ "${SKIP_CDN:-0}" != 1 && "$TARGET" == oss && -z "$PREFIX" ]]; then
  if [[ "$MODE" == full ]]; then
    python3 scripts/refresh-cdn.py --directory
  else
    if [[ -s "$WORK/cdn-urls.txt" ]]; then python3 scripts/refresh-cdn.py --urls "$WORK/cdn-urls.txt"; fi
  fi
fi

# 4b. IndexNow: tell Bing & co. which pages changed (after the CDN serves them).
#     Production daily/feed deploys only; a full rebuild changes every object
#     without the content changing, which is not what IndexNow is for.
#     Never fails the deploy.
if [[ "${SKIP_INDEXNOW:-0}" != 1 && "$TARGET" == oss && -z "$PREFIX" && "$MODE" != full ]]; then
  node scripts/lib/indexnow.mjs --urls "$WORK/cdn-urls.txt" --dist "$DIST" || true
fi

# 5. Objects that no deploy writes any more (old asset hashes, removed pages).
if [[ "$MODE" == full && "$CLEANUP" != none ]]; then
  [[ -f "$INVENTORY" ]] || { echo "Cleanup needs the bucket inventory ($INVENTORY)" >&2; exit 1; }
  node -e '
    const keys = Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).objects);
    const prefixes = ["_astro/", "article/", "daily/", "data/", "people/", "projects/", "subjects/"];
    console.log(keys.filter((k) => prefixes.some((p) => k.startsWith(p))).join("\n"));
  ' "$INVENTORY" > "$WORK/remote.txt"
  sort -u "$WORK/remote.txt" -o "$WORK/remote.txt"
  comm -23 "$WORK/remote.txt" <(sort -u "$WORK/expected.txt") > "$WORK/orphans.txt"
  ORPHANS=$(grep -c . "$WORK/orphans.txt" || true)
  REMOTE=$(grep -c . "$WORK/remote.txt" || true)
  echo "🧹 $ORPHANS of $REMOTE objects under the page prefixes are no longer written by a deploy"
  head -50 "$WORK/orphans.txt"
  if [[ "$CLEANUP" == delete ]]; then
    # Refuse to delete a large share of the site: that points at a bug, not stale files.
    if (( REMOTE > 0 && ORPHANS * 100 / REMOTE > 30 )); then
      echo "❌ refusing to delete $ORPHANS objects (more than 30% of $REMOTE)" >&2
      exit 1
    fi
    if [[ "$TARGET" == oss ]]; then
      tr '\n' '\0' < "$WORK/orphans.txt" | xargs -0 -r -P 20 -n 1 bash -c 'remove_key "$1"' _
    else
      while read -r key; do [[ -n "$key" ]] && rm -f "$LOCAL_ROOT$key"; done < "$WORK/orphans.txt"
    fi
    echo "🧹 deleted $ORPHANS objects"
  fi
fi
