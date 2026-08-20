#!/bin/sh
# Make a driveable copy of the cabinet, and say exactly what to do next.
#
# It installs nothing globally, needs no `npm install`, and touches nothing
# outside the directory you name.
#
#   sh setup.sh ~/arcade-run
#
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
TARGET=${1:-}

if [ -z "$TARGET" ]; then
    echo "usage: sh setup.sh <a directory that does not exist yet>" >&2
    echo "   eg: sh setup.sh ~/arcade-run" >&2
    exit 2
fi
if [ -e "$TARGET" ]; then
    echo "setup: $TARGET already exists. Name a directory that does not, so" >&2
    echo "       nothing of yours is overwritten." >&2
    exit 2
fi
for tool in git node; do
    command -v "$tool" >/dev/null 2>&1 || {
        echo "setup: '$tool' is not on your PATH, and this needs it." >&2
        exit 2
    }
done

mkdir -p "$TARGET"
TARGET=$(cd "$TARGET" && pwd)

echo "→ copying the cabinet into $TARGET/project"
cp -R "$HERE/project" "$TARGET/project"
cp "$HERE/PRD.md" "$TARGET/PRD.md"

echo "→ making it a git repository with a bare origin on local disk"
git init -q --bare "$TARGET/origin.git"
cd "$TARGET/project"
git init -q -b main .
git config user.name "Arcade team"
git config user.email "team@example.invalid"
git add -A
git commit -q -m "arcade cabinet: four games, the shell around them, and the spec for continuing"
git remote add origin "$TARGET/origin.git"
git push -q origin main

echo "→ checking the starting state is what this example claims"
npm test >/dev/null 2>&1 || {
    echo "setup: the cabinet's own tests are NOT green at the start, which this" >&2
    echo "       example depends on. Something is wrong with this copy." >&2
    exit 1
}
npm run lint >/dev/null 2>&1 || {
    echo "setup: lint is NOT clean at the start, which this example depends on." >&2
    exit 1
}
if node --test acceptance/recently-played.test.js >/dev/null 2>&1; then
    echo "setup: the acceptance check PASSES already, and it must not — the whole" >&2
    echo "       point is that it is red until the feature is built." >&2
    exit 1
fi

cat <<EOF

Ready. The starting state is the one this example needs:

  the cabinet's own tests   GREEN   (10 tests)
  lint                      CLEAN
  the acceptance check      RED     - "pick up where you left off" is not built

Open $TARGET/project/index.html in a browser if you want to see the cabinet
as it is now. There is no Continue row. That is the point.

Two things to do, both in THIS terminal window:

  1. Put your key in the environment. Wringer reads it from there and
     nowhere else, and a coding agent launched from a desktop icon will
     not have it:

       export WRINGER_API_KEY="\$(security find-generic-password -s anthropic -a wringer -w)"

     If you have not stored one yet, run this first and paste the key at
     the masked prompt:

       security add-generic-password -s anthropic -a wringer -w

  2. Drive it:

       cd $TARGET/project
       wringer-drive run ../PRD.md --repo .

When it asks which coding agent should do the building, the answer is:

  acp: claude-agent-acp

For the endpoint and the model:

  https://api.anthropic.com/v1/chat/completions
  claude-opus-5

EOF
