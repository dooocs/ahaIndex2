#!/usr/bin/env bash
# Uploads a verified build (dist/) and export (export/) to OSS, then refreshes
# the CDN. Run after the build, scripts/export-site-data.ts and
# scripts/verify-site.mjs have passed: nothing here re-checks content.
#
# Environment:
#   BUILD_MODE      daily | full (required)
#   BUILD_DATES     daily mode: the edition dates that were built (comma-separated)
#   DEPLOY_PREFIX   object key prefix, e.g. "__test__/" for staging (default: none)
#   DEPLOY_TARGET   oss (default) | local:/path — a directory standing in for the bucket, for dry runs
#   SKIP_CDN        1 = do not refresh the CDN
#   CLEANUP         none (default) | dry-run | delete — full mode only: objects no deploy writes any more
#   OSS_BUCKET      default amazingindex
#   OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET   for DEPLOY_TARGET=oss
set -euo pipefail

MODE="${BUILD_MODE:?BUILD_MODE must be daily or full}"
DATES="${BUILD_DATES:-}"
PREFIX="${DEPLOY_PREFIX:-}"
TARGET="${DEPLOY_TARGET:-oss}"
BUCKET="${OSS_BUCKET:-amazingindex}"
CLEANUP="${CLEANUP:-none}"
DIST="${DIST_DIR:-dist}"
EXPORT="${EXPORT_DIR:-export}"
WORK="${DEPLOY_WORKDIR:-.deploy}"

START=$(date +%s)
node scripts/lib/deploy-files.mjs --dist "$DIST" --export "$EXPORT" --mode "$MODE" --dates "$DATES" --out "$WORK"
STAGE="$WORK/stage"

if [[ "$TARGET" == oss ]]; then
  CREDS=(--endpoint https://oss-cn-hangzhou.aliyuncs.com --access-key-id "$OSS_ACCESS_KEY_ID" --access-key-secret "$OSS_ACCESS_KEY_SECRET" --region cn-hangzhou)
  DEST="oss://$BUCKET/$PREFIX"
  # For the parallel workers below (xargs runs them in fresh shells).
  export DEST OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET
  copy_bare() {
    ossutil cp "$DEST$1" "$DEST$2" --force --metadata "Cache-Control=no-cache" --metadata "Content-Type=text/html; charset=utf-8" \
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
    [[ -n "$cache" ]] && meta+=(--metadata "Cache-Control=$cache")
    [[ -n "$type" ]] && meta+=(--metadata "Content-Type=$type")
    ossutil sync "$src/" "$DEST$sub" --force -j "$jobs" "${meta[@]}" "${CREDS[@]}"
  else
    mkdir -p "$LOCAL_ROOT$sub"
    cp -R "$src/." "$LOCAL_ROOT$sub"
  fi
}

# 1. Assets first, so no uploaded page references a missing file.
put "$DIST/_astro" "_astro/" "max-age=31536000,immutable" "" 20 &
PID_ASTRO=$!
put "$STAGE/other" "" "" "" 10 &
PID_OTHER=$!
wait "$PID_ASTRO"
wait "$PID_OTHER"
echo "✅ assets uploaded"

# 2. Pages, data and feeds.
put "$STAGE/html" "" "no-cache" "text/html; charset=utf-8" 20 &
PID_HTML=$!
put "$STAGE/json" "" "max-age=300" "application/json; charset=utf-8" 10 &
PID_JSON=$!
put "$STAGE/xml" "" "max-age=300" "application/xml; charset=utf-8" 5 &
PID_XML=$!
wait "$PID_HTML"
wait "$PID_JSON"
wait "$PID_XML"
echo "✅ pages, data and feeds uploaded"

# 3. Bare URLs: /daily/2026-10-13 serves the same page as /daily/2026-10-13/.
if [[ "$TARGET" == oss ]]; then
  # xargs exits non-zero if any copy fails.
  tr '\t\n' '\0\0' < "$WORK/bare.txt" | xargs -0 -r -P 20 -n 2 bash -c 'copy_bare "$1" "$2"' _
  echo "✅ bare URLs copied: $(grep -c . "$WORK/bare.txt" || true)"
else
  echo "ℹ️  local target: bare URL copies skipped ($(grep -c . "$WORK/bare.txt" || true))"
fi

# 4. The manifest last: the next daily build trusts it to list only live editions.
if [[ "$TARGET" == oss ]]; then
  ossutil cp "$EXPORT/_deploy/manifest.json" "${DEST}_deploy/manifest.json" --force \
    --metadata "Cache-Control=no-cache" --metadata "Content-Type=application/json; charset=utf-8" "${CREDS[@]}"
else
  mkdir -p "$LOCAL_ROOT/_deploy" && cp "$EXPORT/_deploy/manifest.json" "$LOCAL_ROOT/_deploy/manifest.json"
fi
echo "✅ manifest uploaded; deploy took $(( $(date +%s) - START ))s"

# 5. CDN.
if [[ "${SKIP_CDN:-0}" != 1 && "$TARGET" == oss && -z "$PREFIX" ]]; then
  if [[ "$MODE" == full ]]; then
    python3 scripts/refresh-cdn.py --directory
  else
    python3 scripts/refresh-cdn.py --urls "$WORK/cdn-urls.txt"
  fi
fi

# 6. Objects that no deploy writes any more (old asset hashes, removed pages).
if [[ "$MODE" == full && "$CLEANUP" != none ]]; then
  : > "$WORK/remote.txt"
  for dir in _astro/ article/ daily/ data/ projects/ subjects/; do
    if [[ "$TARGET" == oss ]]; then
      ossutil ls "$DEST$dir" --recursive -s "${CREDS[@]}" | grep '^oss://' | sed "s#^$DEST##" >> "$WORK/remote.txt" || true
    else
      (cd "$LOCAL_ROOT" && find "$dir" -type f 2>/dev/null) >> "$WORK/remote.txt" || true
    fi
  done
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
