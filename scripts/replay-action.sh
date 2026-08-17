#!/bin/zsh
# Replay `action.yml`'s steps locally, in order, against a clean checkout.
#
# **Why this exists.** `action.yml` is referenced publicly as
# `uses: marcoakes/wringer@main`, and until 2026-08-17 nothing had ever run it.
# The `uses: ./` job added that day went red, and this repository's CI logs are
# **403 unauthenticated** with no `gh` on the maintainer's machine — so the only
# way to see what the action does is to do it here.
#
# It found two real defects on its first outing:
#
#   1. the action installed the newest PyPI release (0.3.0) and then invoked
#      `wring health`, which 0.3.0 does not have. Fixed: `@main` now installs
#      `@main` via `$GITHUB_ACTION_PATH`.
#   2. `wring verify` needs the TARGET repository's own gate tools on PATH —
#      here `ruff` and `pytest` — which the action does not and will not
#      install. Stated in `action.yml`'s header; the workflow job now installs
#      them first, which is the real shape of a consumer's workflow.
#
# It models the JOB's steps (setup-python, `pip install -e '.[dev]'`) before
# the action's, because leaving them out reproduces defect 2 rather than
# whatever is actually being looked for.
#
# Run it with no arguments. It clones this repo into a scratch tree and touches
# nothing you own.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
S=$(mktemp -d "${TMPDIR:-/tmp}/wringer-action-replay.XXXXXX")
mkdir -p "$S"
export RUNNER_TEMP="$S/tmp"; mkdir -p "$RUNNER_TEMP"
export GITHUB_STEP_SUMMARY="$S/summary.md"; : > "$GITHUB_STEP_SUMMARY"
export GITHUB_PATH="$S/gh_path"; : > "$GITHUB_PATH"

git clone -q "$ROOT" "$S/repo"
export GITHUB_ACTION_PATH="$S/repo"
cd "$S/repo"

# **The JOB's own steps first**, which is what the workflow does before
# `uses: ./`: actions/setup-python, then `pip install -e '.[dev]'`. Modelled
# as a venv whose bin is on PATH, exactly like the hosted toolcache python.
print -r -- "=== JOB STEP: setup-python + pip install -e '.[dev]' ==="
uv venv -q --python 3.12 "$S/runnerpy"
uv pip install -q --python "$S/runnerpy/bin/python" -e "$S/repo[dev]" 2>&1 | tail -2
export PATH="$S/runnerpy/bin:$PATH"
print -r -- "ruff on PATH?  -> $(command -v ruff || echo NO)"
print -r -- "pytest on PATH?-> $(command -v pytest || echo NO)"
print -r -- ""

print -r -- "=== STEP: Install Wringer (from GITHUB_ACTION_PATH, as the fix does) ==="
python3 -m venv --system-site-packages "$RUNNER_TEMP/wringer-venv" 2>&1 | tail -2
bin="$RUNNER_TEMP/wringer-venv/bin"
[ -d "$bin" ] || bin="$RUNNER_TEMP/wringer-venv/Scripts"
"$bin/python" -m pip install --disable-pip-version-check --quiet "$GITHUB_ACTION_PATH" 2>&1 | tail -4
export PATH="$bin:$PATH"
print -r -- "wring --version -> $(wring --version 2>&1)"
print -r -- "has health?     -> $(wring health --help >/dev/null 2>&1 && echo yes || echo NO)"

print -r -- ""
print -r -- "=== STEP: Verify ==="
wring verify; print -r -- "(verify exit $?)"

print -r -- ""
print -r -- "=== STEP: history dir + health ==="
mkdir -p "$RUNNER_TEMP/wringer-history"
wring health --from "$RUNNER_TEMP/wringer-history" --output "$RUNNER_TEMP/wringer-health.txt"
print -r -- "(health exit $?)"
print -r -- "--- health output:"
head -12 "$RUNNER_TEMP/wringer-health.txt" 2>&1

print -r -- ""
print -r -- "scratch tree: $S"
