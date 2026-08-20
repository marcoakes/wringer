#!/bin/sh
# Make a driveable copy of the example, and say exactly what to do next.
#
# The project is shipped as plain files rather than as a git repository,
# because a repository inside a repository is a submodule nobody asked for.
# This makes the real thing: its own git repo, its own bare `origin` on local
# disk so a handover has somewhere to go, and its own virtual environment so
# `pytest` and `ruff` resolve when Wringer runs the project's own checks.
#
# It installs nothing globally and touches nothing outside the directory you
# name. Run it again with a different directory to get another clean copy.
#
#   sh setup.sh ~/wringer-example
#
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
TARGET=${1:-}

if [ -z "$TARGET" ]; then
    echo "usage: sh setup.sh <a directory that does not exist yet>" >&2
    echo "   eg: sh setup.sh ~/wringer-example" >&2
    exit 2
fi
if [ -e "$TARGET" ]; then
    echo "setup: $TARGET already exists. Name a directory that does not, so" >&2
    echo "       nothing of yours is overwritten." >&2
    exit 2
fi
for tool in git uv; do
    command -v "$tool" >/dev/null 2>&1 || {
        echo "setup: '$tool' is not on your PATH, and this needs it." >&2
        exit 2
    }
done

mkdir -p "$TARGET"
TARGET=$(cd "$TARGET" && pwd)

echo "→ copying the example project into $TARGET/project"
cp -R "$HERE/project" "$TARGET/project"
cp "$HERE/PRD.md" "$TARGET/PRD.md"

echo "→ making it a git repository with a bare origin on local disk"
git init -q --bare "$TARGET/origin.git"
cd "$TARGET/project"
git init -q -b main .
git config user.name "Pipeline team"
git config user.email "team@example.invalid"
git add -A
git commit -q -m "pipeline: the runner, its tests, and the executable spec for skipping"
git remote add origin "$TARGET/origin.git"
git push -q origin main

echo "→ making a virtual environment with pytest and ruff"
uv venv -q .venv
uv pip install -q --python .venv/bin/python pytest ruff

echo "→ checking the starting state is what this example claims"
FAILED=0
.venv/bin/python -m pytest -q >/dev/null 2>&1 || FAILED=1
[ "$FAILED" -eq 0 ] || { echo "setup: the project's own tests are NOT green at the start, which this example depends on. Something is wrong with this copy." >&2; exit 1; }
.venv/bin/python -m ruff check . >/dev/null 2>&1 || { echo "setup: ruff is NOT clean at the start, which this example depends on." >&2; exit 1; }
if .venv/bin/python -m pytest -q acceptance/test_skip_downstream.py >/dev/null 2>&1; then
    echo "setup: the acceptance check PASSES already, and it must not — the whole" >&2
    echo "       point is that it is red until the feature is built." >&2
    exit 1
fi

cat <<EOF

Ready. The starting state is the one this example needs:

  the project's own tests   GREEN   (18 tests)
  the project's lint        CLEAN
  the acceptance check      RED     - the feature does not exist yet

Two things to do, both in THIS terminal window:

  1. Put your key in the environment. Wringer reads it from there and
     nowhere else, and a coding agent launched from a desktop icon will
     not have it:

       export WRINGER_API_KEY="\$(security find-generic-password -s anthropic -a wringer -w)"

     If you have not stored one yet, run this first and paste the key at
     the masked prompt:

       security add-generic-password -s anthropic -a wringer -w

  2. Drive it:

       export PATH="$TARGET/project/.venv/bin:\$PATH"
       cd $TARGET/project
       wringer-drive run ../PRD.md --repo .

When it asks which coding agent should do the building, the answer is:

  acp: claude-agent-acp

For the endpoint and the model:

  https://api.anthropic.com/v1/chat/completions
  claude-opus-5

EOF
