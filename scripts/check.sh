#!/bin/sh
# The gate, run the way CI runs it: ruff then pytest, from the repo root,
# with the venv on PATH so gates find their own tools.
#
# A named script rather than an ad-hoc one-liner on purpose: permission rules
# match command prefixes, so `cd repo && a && b` matches nothing and asks a
# human every time. This asks once, forever.
#
# Writes each step's TRUE exit code to .wringer/last/, because a wrapper's
# own exit code can lie about which half failed.
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 2
PATH="$ROOT/.venv/bin:$PATH"
export PATH

mkdir -p "$ROOT/.wringer/last"

ruff check src tests examples scripts
LINT=$?
echo "$LINT" > "$ROOT/.wringer/last/lint.exit"

# Parallel by default: this suite spawns real git repos, real subprocesses
# and real `wring verify` runs rather than mocking them — which is the whole
# point — so it is IO-bound and one core was leaving 4x on the table (240s
# serial, 59s on six workers, identical results). Every test already isolates
# through tmp_path, which is what makes this safe.
#
# WRINGER_TEST_JOBS=1 turns it off for a machine where a parallel failure is
# hard to read: xdist interleaves output, and a bisect wants the serial run.
pytest -q -n "${WRINGER_TEST_JOBS:-auto}"
TEST=$?
echo "$TEST" > "$ROOT/.wringer/last/test.exit"

echo "---"
echo "ruff  exit $LINT"
echo "pytest exit $TEST"

[ "$LINT" -eq 0 ] && [ "$TEST" -eq 0 ]
