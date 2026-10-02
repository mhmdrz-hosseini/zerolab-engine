#!/usr/bin/env bash
# Final-code rerun pass: delete the _cases records of every case whose outcome
# was affected by late fixes (suggested-backing pass-through, relative fuse
# threshold, full-budget skin rung, all-pose construction retry) and re-drive.
# The driver's resume logic re-runs only the deleted ones.
set -u
RUN_ID="${1:?runId}"
cd "$(dirname "$0")/../.." || exit 1
DIR="OUTPUT/v3/$RUN_ID/_cases"
# every non-generated case + giraffe-200 (relative-threshold policy flip)
for f in "$DIR"/*.json; do
  status=$(python -c "import json;print(json.load(open(r'''$f''',encoding='utf-8'))['status'])" 2>/dev/null || echo unknown)
  case_id=$(basename "$f" .json)
  if [ "$status" != "generated" ] || [ "$case_id" = "obj_1_Minimalist_Giraffe_figurine-2-200" ] || [ "$case_id" = "obj_2_latern_cap-50" ] || [ "$case_id" = "obj_2_latern_cap-200" ]; then
    echo "redo: $case_id ($status)"
    rm -f "$f"
    rm -rf "OUTPUT/v3/$RUN_ID/$case_id"
  fi
done
echo "--- re-driving missing cases ---"
bash scripts/v3/drive-full-corpus.sh "$RUN_ID" 50,200
