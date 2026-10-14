#!/usr/bin/env bash
# Runs a command and surfaces its outcome as GitHub Actions annotations, which
# show on the run summary and through the API (unlike the raw log):
#   - every [inventory]/[plan]/[export]/[deploy-files]/[staging-check] line as a notice
#   - on failure, the last 40 lines of output as an error
# Usage: bash scripts/ci-annotate.sh "<title>" command args...
set -uo pipefail
title="$1"; shift
log=$(mktemp)
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
escape() { sed -e ':a;N;$!ba' -e 's/%/%25/g; s/\r/%0D/g; s/\n/%0A/g'; }
grep -E '^\[(inventory|plan|export|deploy-files|staging-check)\]|^  \| ' "$log" | head -9 | while IFS= read -r line; do
  echo "::notice title=${title}::$(printf '%s' "$line" | escape)"
done
if [[ $status -ne 0 ]]; then
  echo "::error title=${title} failed::$(grep -vE '^\s+at |^npm (warn|notice)' "$log" | tail -40 | escape)"
fi
rm -f "$log"
exit "$status"
