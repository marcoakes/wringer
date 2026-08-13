#!/bin/sh
# Run the corpus: every built task, both arms, appending rows.
#
# A shell loop and not a command, deliberately. `SPEC_BENCHMARK_V0` §8 says
# there is no aggregation and no score — this drives the harness once per task
# and appends, which is the harness's own documented behaviour, and it computes
# nothing. Anything that turned these rows into a rate would have to be argued
# for on its own.
#
# THIS SPENDS MONEY. Every task reaches a real model twice. Preflight runs first
# for each one and costs nothing; a task that fails preflight is skipped loudly
# rather than paid for.
#
# Usage:
#   sh benchmark/corpus/run.sh                 # every built task
#   sh benchmark/corpus/run.sh a b c           # only these task ids
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TASKS="$ROOT/benchmark/corpus/tasks"
OUT=${WRINGER_CORPUS_OUT:-$ROOT/benchmark/results/corpus}
PY=${WRINGER_PYTHON:-$ROOT/.venv/bin/python}

if [ ! -d "$TASKS" ]; then
  echo "no built tasks at $TASKS — run: python3 benchmark/corpus/build.py" >&2
  exit 2
fi

if [ "$#" -gt 0 ]; then
  FILES=""
  for id in "$@"; do
    if [ -f "$TASKS/$id.yaml" ]; then
      FILES="$FILES $TASKS/$id.yaml"
    else
      echo "no such task: $id" >&2
      exit 2
    fi
  done
else
  FILES=$(ls "$TASKS"/*.yaml 2>/dev/null)
fi

[ -n "$FILES" ] || { echo "no task files to run" >&2; exit 2; }

mkdir -p "$OUT"
echo "corpus run -> $OUT"
echo

SKIPPED=0
RAN=0
for task in $FILES; do
  id=$(basename "$task" .yaml)
  echo "=== $id ==="

  # Costs nothing, and catches the things that would otherwise be paid for and
  # then recorded as VOID.
  if ! "$PY" "$ROOT/benchmark/preflight.py" --task "$task" > "$OUT/$id.preflight.txt" 2>&1; then
    echo "  PREFLIGHT FAILED — skipped, not paid for. See $OUT/$id.preflight.txt"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  "$PY" "$ROOT/benchmark/harness.py" --task "$task" --out "$OUT"
  RAN=$((RAN + 1))
  echo
done

echo "=== $RAN task(s) run, $SKIPPED skipped ==="
echo "rows: $OUT/rows.jsonl"
echo
echo "What the agents SAID they spent (their own claim, unverified):"
"$PY" - "$OUT/rows.jsonl" <<'PYTHON'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
if not path.is_file():
    print("  no rows yet")
    raise SystemExit(0)

rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
total = 0.0
currency = None
unreported = 0
for row in rows:
    usage = row.get("usage") or {}
    cost = usage.get("cost") or {}
    amount = cost.get("amount")
    if amount is None:
        unreported += 1
        continue
    if currency is None:
        currency = cost.get("currency")
    if cost.get("currency") != currency:
        # Adding across currencies would be a number with no meaning, and this
        # project holds no exchange rates — `loop.usage_totals` refuses the same
        # thing one layer down.
        print("  MIXED CURRENCIES — no total is printed, read the rows")
        raise SystemExit(0)
    total += float(amount)

print(f"  {total:.4f} {currency or ''} over {len(rows) - unreported} row(s)")
if unreported:
    print(f"  {unreported} row(s) reported nothing — absent, NOT zero")
PYTHON
