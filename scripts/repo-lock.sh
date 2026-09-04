#!/bin/sh
# One writer at a time in this repository.
#
#   scripts/repo-lock.sh acquire <name>   # 0 taken, 1 already held
#   scripts/repo-lock.sh release <name>
#
# **The body count, 2026-09-04.** Two release pipelines ran at once. The
# older one's `git add -A` swept up the newer one's version bump, and the
# commit that reached `main` announced 0.8.11 while carrying 0.9.0 — so
# neither version could be tagged from it and nothing published for two
# hours. A guard now catches that commit, but a guard is the autopsy; this
# is the thing that stops it happening.
#
# `mkdir` is the primitive because it is atomic on every POSIX filesystem:
# two processes racing on the same name, exactly one succeeds. A lock file
# written with `>` is not — both would win.
#
# The lock lives under `.git/`, which is never committed and never part of
# the working tree, so a held lock cannot end up inside a commit — which
# would be this defect wearing a hat.
#
# **The holder is `$PPID`, not `$$`, and the first draft had it wrong.**
# This script is a helper: it exits the instant it has taken the lock, so
# recording its OWN pid marks the lock stale a millisecond after it is
# taken, and the next writer breaks it and walks straight in. A lock that
# is always stale is not a lock, and the guard over the stale path passed
# either way. The holder is the process that CALLED this — `ship.sh`, for
# as long as it runs.
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ACTION=${1:-}
NAME=${2:-}

if [ -z "$ACTION" ] || [ -z "$NAME" ]; then
    echo "usage: scripts/repo-lock.sh acquire|release <name>" >&2
    exit 2
fi
case "$NAME" in
    */*|.|..) echo "repo-lock: <name> is one path segment" >&2; exit 2 ;;
esac

LOCK="$ROOT/.git/wringer-locks/$NAME"

case "$ACTION" in
acquire)
    mkdir -p "$ROOT/.git/wringer-locks" 2>/dev/null || {
        echo "repo-lock: cannot write under .git/ — is this a git checkout?" >&2
        exit 2
    }
    if mkdir "$LOCK" 2>/dev/null; then
        echo "$PPID" > "$LOCK/pid"
        date "+%Y-%m-%dT%H:%M:%S%z" > "$LOCK/since"
        exit 0
    fi

    HELD_BY=$(cat "$LOCK/pid" 2>/dev/null || echo "")
    SINCE=$(cat "$LOCK/since" 2>/dev/null || echo "an unrecorded time")

    # **A stale lock is worse than the collision it prevents**: it blocks
    # every future release with no way forward but a command nobody has
    # written down. If the holder is gone, the lock is a leftover — say so
    # in the same breath as taking it, so a break is never silent.
    if [ -n "$HELD_BY" ] && ! kill -0 "$HELD_BY" 2>/dev/null; then
        echo "repo-lock: breaking a stale '$NAME' lock — it was taken by" >&2
        echo "           process $HELD_BY at $SINCE, and that process is gone." >&2
        rm -rf "$LOCK"
        if mkdir "$LOCK" 2>/dev/null; then
            echo "$PPID" > "$LOCK/pid"
            date "+%Y-%m-%dT%H:%M:%S%z" > "$LOCK/since"
            exit 0
        fi
    fi

    echo "repo-lock: '$NAME' is already held by process ${HELD_BY:-unknown}," >&2
    echo "           taken at $SINCE." >&2
    echo "" >&2
    echo "  Two of these at once is how a release commit ends up announcing" >&2
    echo "  one version and carrying another. Wait for it to finish." >&2
    echo "" >&2
    echo "  If you are certain that process is gone:" >&2
    echo "" >&2
    echo "    rm -rf $LOCK" >&2
    exit 1
    ;;
release)
    rm -rf "$LOCK"
    exit 0
    ;;
*)
    echo "usage: scripts/repo-lock.sh acquire|release <name>" >&2
    exit 2
    ;;
esac
