#!/bin/sh
# Watch ONE CI job and print its annotations the moment it finishes.
#
#   scripts/watch-job.sh <sha-prefix> [job-name]     # default job: action
#
# **Why this exists, with the numbers that produced it.** This repository's
# Actions LOGS are 403 unauthenticated and there is no `gh` on the maintainer's
# machine, so annotations are the only way to see why a job failed. They are
# public, and they are available as soon as THAT JOB completes.
#
# On 2026-08-17 the `action` job was diagnosed over six push-and-look cycles,
# and each one waited for the whole RUN to reach `completed`. Measured on
# `5aa53ce`:
#
#     action                        done at +3.5m   <- what was needed
#     pytest (macos-latest, 3.12)   done at +5.4m   <- what was waited for
#     whole run                            +5.4m
#
# So every cycle spent ~1.9 extra minutes on a macOS job that had nothing to do
# with the question, plus up to 45s of polling granularity. About fifteen
# minutes across the six, none of it the annotations' fault.
#
# This polls the JOB. No token, no `gh`, no auth.
set -u

REPO=${WRINGER_REPO:-marcoakes/wringer}
SHA=${1:?usage: watch-job.sh <sha-prefix> [job-name]}
JOB=${2:-action}
API="https://api.github.com/repos/$REPO"
STARTED=$(date +%s)

echo "watching '$JOB' for $SHA in $REPO ..."

while :; do
    RUN=$(curl -sS "$API/actions/runs?per_page=15" 2>/dev/null | python3 -c "
import json, sys
try:
    runs = json.load(sys.stdin)['workflow_runs']
except Exception:
    sys.exit(0)
for r in runs:
    if r['head_sha'].startswith('$SHA') and r['name'] == 'tests':
        print(r['jobs_url']); break
")
    [ -n "$RUN" ] && break
    sleep 10
done

while :; do
    OUT=$(curl -sS "$RUN" 2>/dev/null | python3 -c "
import json, sys
try:
    jobs = json.load(sys.stdin)['jobs']
except Exception:
    sys.exit(0)
for j in jobs:
    if j['name'] == '$JOB' and j['status'] == 'completed':
        print(j['id'], j['conclusion'])
        break
")
    [ -n "$OUT" ] && break
    sleep 10
done

ID=$(echo "$OUT" | cut -d' ' -f1)
CONCLUSION=$(echo "$OUT" | cut -d' ' -f2)
echo "$JOB: $CONCLUSION  (after $(( ($(date +%s) - STARTED) / 60 ))m$(( ($(date +%s) - STARTED) % 60 ))s of watching)"
echo

# Annotations are public even where logs are 403. The Node.js deprecation
# warning is filtered: it is on every run and is nobody's finding.
curl -sS "$API/check-runs/$ID/annotations" 2>/dev/null | python3 -c "
import json, sys
try:
    anns = json.load(sys.stdin)
except Exception:
    print('(annotations could not be read)'); sys.exit(0)
shown = 0
for a in anns if isinstance(anns, list) else []:
    message = a.get('message') or ''
    if 'Node.js' in message:
        continue
    print(f\"[{a.get('annotation_level')}] {message}\")
    shown += 1
if not shown:
    print('(no annotations — the job emitted none, which is itself a finding '
          'if it failed)')
"
[ "$CONCLUSION" = "success" ] || exit 1
