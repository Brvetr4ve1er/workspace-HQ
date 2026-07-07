#!/usr/bin/env bash
# Behavior-preservation harness for the collector refactor.
#   golden.sh baseline  -> run CURRENT code, save normalized output as the baseline snapshot
#   golden.sh verify    -> run again, diff vs baseline; nonzero exit + "GOLDEN FAIL" on any change
#
# Ephemeral by design: baseline and verify run minutes apart on identical inputs, so a
# nightly scan or the calendar advancing cannot cause spurious diffs. Fully side-effect
# free: reports go to a temp dir, and BOTH data/latest.json and the vault daily note that
# assemble.mjs writes are backed up and restored. prev is seeded from data/latest.json so
# the real (non-null prev) code path is exercised. The only normalized field is scan.date.
set -euo pipefail
cd "$(dirname "$0")/../../.."
TMP="${TMPDIR:-/tmp}"
SNAP="$TMP/hq-golden-baseline.json"
RD="$TMP/hq-golden-reports"
DAILY="C:/Users/ROG STRIX/Documents/VEEMO CORTEX/10_Daily/2026-07-06.md"

run() {
  mkdir -p "$RD"
  # seed a non-null prev once; keep it stable across baseline+verify within a task
  [ -e "$RD/Workspace Status 2026-07-04.json" ] || cp data/latest.json "$RD/Workspace Status 2026-07-04.json"
  # back up the two live artifacts assemble.mjs mutates
  cp data/latest.json "$RD/latest.bak"
  if [ -e "$DAILY" ]; then cp "$DAILY" "$RD/daily.bak"; rm -f "$RD/daily.absent"; else : > "$RD/daily.absent"; rm -f "$RD/daily.bak"; fi
  node collector/assemble.mjs --date 2026-07-06 --reports-dir "$RD" >/dev/null
  # restore live artifacts (assemble clobbers latest.json + injects into the daily note)
  cp "$RD/latest.bak" data/latest.json
  if [ -e "$RD/daily.bak" ]; then cp "$RD/daily.bak" "$DAILY"; elif [ -e "$RD/daily.absent" ]; then rm -f "$DAILY"; fi
  node collector/lib/__fixtures__/normalize.mjs "$RD/Workspace Status 2026-07-06.json"
}

case "${1:-}" in
  baseline) rm -rf "$RD"; run > "$SNAP"; echo "baseline captured: $SNAP" ;;
  verify)
    run > "$TMP/hq-golden-after.json"
    if diff "$TMP/hq-golden-after.json" "$SNAP"; then echo "GOLDEN OK: no behavior change";
    else echo "GOLDEN FAIL: output changed"; exit 1; fi ;;
  *) echo "usage: golden.sh {baseline|verify}"; exit 2 ;;
esac
