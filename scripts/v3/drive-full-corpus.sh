#!/usr/bin/env bash
# Driver: one child process per case (WASM kernel isolation), sequential.
# Usage: bash scripts/v3/drive-full-corpus.sh <runId> <sizes>
set -u
RUN_ID="${1:?runId}"
SIZES="${2:-50,200}"
cd "$(dirname "$0")/../.." || exit 1
TSX="node_modules/tsx/dist/cli.mjs"
mkdir -p "OUTPUT/v3/$RUN_ID/_cases"
# --list emits the EXACT case ids the runner writes (stem<TAB>file<TAB>size),
# so resume-skip decisions match the TS stem logic byte for byte.
node "$TSX" scripts/v3/run-full-corpus.ts --list "$SIZES" | while IFS=$'\t' read -r stem file size; do
  case_id="$stem-$size"
  if [ -f "OUTPUT/v3/$RUN_ID/_cases/$case_id.json" ]; then
    echo "[skip] $case_id (already done)"
    continue
  fi
  echo "=== $file @ $size mm ==="
  timeout 2400 node "$TSX" scripts/v3/run-full-corpus.ts --one "$RUN_ID" "$file" "$size" 2>&1 | grep -vE "^envelope loft" || true
done
node "$TSX" scripts/v3/run-full-corpus.ts --summarize "$RUN_ID"
