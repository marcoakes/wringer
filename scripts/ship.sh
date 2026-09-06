#!/bin/sh
# Commit and push, but only behind the gate — the repo's own discipline
# applied to the repo's own history.
#
#   scripts/ship.sh <path-to-commit-message-file>
#
# Refuses if ruff or pytest is red. "Never claim a check ran unless it ran"
# is law 1; this is the version of it that cannot be forgotten in a hurry.
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 2

MESSAGE=${1:-}
if [ -z "$MESSAGE" ] || [ ! -f "$MESSAGE" ]; then
    echo "usage: scripts/ship.sh <commit-message-file>" >&2
    exit 2
fi

# **One writer at a time — 2026-09-04.** `git add -A` below stages whatever
# is in the tree, including edits another pipeline is midway through making.
# That is exactly how a release commit came to announce 0.8.11 while
# carrying 0.9.0's version bump. The gate takes ten minutes; the window is
# wide open without this.
"$ROOT/scripts/repo-lock.sh" acquire ship || exit 1
trap '"$ROOT/scripts/repo-lock.sh" release ship' EXIT INT TERM

"$ROOT/scripts/check.sh" || {
    echo "refusing to ship: the gate is red" >&2
    exit 1
}

# **A release announces one version ONCE — 2026-09-06.** The lock above
# stops two writers overlapping, and it is only as good as its reach: two
# hand-driven chains, both waiting on the same green-bar file, both woke
# when it appeared. The first committed 0.9.9 and pushed; the second ran
# seconds later against a tree that by then held the NEXT release's work,
# and `git add -A` put 0.9.10's code on `main` under the subject
# `release: 0.9.9`. The version file still said 0.9.9, so the guard that
# checks a subject against its own tree was satisfied, and `main` went red.
#
# So the message is checked against the commit already on `main` before
# anything is staged. Anything that commits a release goes through here.
SUBJECT=$(head -1 "$MESSAGE")
ANNOUNCES=$(printf '%s' "$SUBJECT" | sed -n 's/^release: *\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p')
if [ -n "$ANNOUNCES" ]; then
    ALREADY=$(git log -1 --format=%s 2>/dev/null | sed -n 's/^release: *\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p')
    if [ "$ANNOUNCES" = "$ALREADY" ]; then
        echo "refusing to ship: the commit already on this branch announces" >&2
        echo "release $ALREADY, and so does this message. One of them carries" >&2
        echo "something it does not name. Check what is staged before retrying." >&2
        exit 1
    fi
fi

git add -A
git commit -q -F "$MESSAGE" || exit 1
git push || exit 1

git log --oneline -1
