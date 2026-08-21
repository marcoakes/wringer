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

# **The coding agent, checked HERE.** This script used to preflight `git` and
# `node`, validate the whole starting state, print "Ready", and then tell the
# reader to answer `acp: claude-agent-acp` — without ever checking that agent
# existed. On 2026-08-21 it did not: a product manager got through the
# interview, two paid API calls, three approvals and a gate install before
# anything mentioned it (docs/field-report-2026-08-21.md, finding 6).
#
# A script that says "Ready" while the thing it is about to recommend is
# missing is not ready. It is wrong, early, in the one place a reader trusts.
AGENT=claude-agent-acp
if ! command -v "$AGENT" >/dev/null 2>&1; then
    echo "setup: '$AGENT' is not on your PATH." >&2
    echo "" >&2
    echo "  This example tells you to answer 'acp: $AGENT' when Wringer asks" >&2
    echo "  which coding agent should do the building. That agent is what" >&2
    echo "  actually writes the code, so without it the run stops at the" >&2
    echo "  build step having already spent money on drafting." >&2
    echo "" >&2
    echo "  Install it with:" >&2
    echo "    npm install -g @agentclientprotocol/claude-agent-acp" >&2
    echo "" >&2
    echo "  If that succeeds and this still says the same thing, npm's global" >&2
    echo "  bin directory is not on your PATH — 'npm bin -g' prints where it" >&2
    echo "  put the command." >&2
    echo "" >&2
    echo "  If you already use a DIFFERENT agent that speaks ACP, that is" >&2
    echo "  fine: install nothing, and answer with its command instead of" >&2
    echo "  the one above. Wringer runs the agent you name and never one it" >&2
    echo "  guessed." >&2
    exit 2
fi

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

       security add-generic-password -U -s anthropic -a wringer -w

     THIS KEY IS FOR WRINGER, NOT FOR THE CODING AGENT. It pays for
     reading your document and drafting the plan, and nothing else. The
     coding agent that writes the code signs in on its own account, and
     this key never reaches it — setting it does not log the agent in,
     and no other variable does either. Check that half by running
     '$AGENT' once by hand and completing whatever it asks for.

  2. Drive it:

       cd $TARGET/project
       wringer-drive run ../PRD.md --repo .

When it asks which coding agent should do the building, the answer is:

  acp: claude-agent-acp

For the endpoint and the model:

  https://api.anthropic.com/v1/chat/completions
  claude-opus-5

EOF
