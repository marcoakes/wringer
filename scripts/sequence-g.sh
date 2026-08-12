#!/bin/sh
# Sequence G — the container path, attacked. docs/MANUAL_CHECKS.md.
#
# WHY THIS IS A SCRIPT AND NOT A LIST OF THINGS TO TYPE.
#
# Sequence G has been in MANUAL_CHECKS.md, unrun, since 0.2, because the
# maintainer's machine has no container runtime. It stayed unrun partly because
# it was seven paragraphs of prose asking a human to hand-run seven attacks and
# transcribe the results. This is that, executed, with the transcription done
# for them.
#
# IT REFUSES RATHER THAN SKIPS. A checklist script that prints "0 failures"
# because it found no runtime is the advert sequence G's own last line warns
# about. With no runtime this exits 2 and records nothing.
#
# It attacks THROUGH WRINGER, not through a hand-written `docker run`: the
# thing under test is the argv `backend.Container` builds, so a bespoke command
# line here would measure a command line nobody ships.
#
# Usage:
#   sh scripts/sequence-g.sh [runtime] [image] [scratch-parent]
#
# Defaults to `docker` and the published image. Copies the bundle it produced
# to .wringer/sequence-g-bundle/ and prints what each attack saw.
set -u

RUNTIME=${1:-docker}
IMAGE=${2:-ghcr.io/marcoakes/wringer:main}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# Through `scratch_dir` like every other deleting script here, for the reason
# that file's own comment gives: the leaf is always `wringer-<name>`, so the
# blast radius of the `rm -rf` below is a directory this repo created, whatever
# the base. `mktemp -d` would also have been safe and the guard in
# tests/test_scratch.py is still right to insist on one mechanism — five
# scripts got this wrong once, and "safe by a different route" is how the
# sixth does.
. "$(dirname "$0")/scratch.sh"
WORK=$(scratch_dir "${3:-}" sequence-g) || exit 2

if ! command -v "$RUNTIME" >/dev/null 2>&1; then
  echo "sequence G: no '$RUNTIME' on PATH." >&2
  echo >&2
  echo "REFUSING rather than skipping. A checklist that reports no failures" >&2
  echo "because it ran no attacks is the advert this sequence exists to" >&2
  echo "refuse — and SECURITY.md's 'designed to isolate' must not be" >&2
  echo "upgraded on the strength of a script that did nothing." >&2
  echo >&2
  echo "Install a runtime, or run this on a machine that has one, then add a" >&2
  echo "row to docs/MANUAL_CHECKS.md." >&2
  exit 2
fi

rm -rf "$WORK"
mkdir -p "$WORK"
cd "$WORK" || exit 2

git init -q -b main .
git config user.name "sequence-g"
git config user.email "sequence-g@example.invalid"
git config commit.gpgsign false
git commit -q --allow-empty -m "initial"

# Each attack is a GATE, so it runs through exactly the argv Wringer ships.
# `optional: true` on every one of them: an attack that succeeds must not stop
# the run before the later attacks get their turn — a partial sequence is the
# checklist-with-only-passes failure wearing a different hat.
cat > .wringer.yaml <<YAML
version: 1
gates:
  - id: host-ssh-keys
    optional: true
    run: "ls -la ~/.ssh 2>&1; ls -la /root/.ssh 2>&1; ls -la /home/*/.ssh 2>&1"
  - id: host-credentials-in-env
    optional: true
    run: "env | grep -Ei 'aws|github|gitlab|token|secret|password|api.?key' || echo 'NONE FOUND'"
  - id: docker-socket
    optional: true
    run: "ls -la /var/run/docker.sock /run/docker.sock 2>&1; cat /var/run/docker.sock 2>&1 | head -c 64"
  - id: host-git-config
    optional: true
    run: "git config --global --list 2>&1; cat ~/.gitconfig 2>&1; cat ~/.git-credentials 2>&1"
  - id: outside-the-mount
    optional: true
    run: "ls -la / 2>&1; cat /etc/shadow 2>&1 | head -c 64; ls ${HOME:-/root} 2>&1"
  - id: outbound-network
    optional: true
    run: "getent hosts example.com 2>&1; (command -v curl >/dev/null && curl -sS -m 5 -o /dev/null -w 'HTTP %{http_code}\\n' https://example.com 2>&1) || echo 'no curl in image'"
  - id: host-process-table
    optional: true
    run: "ps aux 2>&1 | head -20"
execution:
  backend: container
  image: ${IMAGE}
  runtime: ${RUNTIME}
YAML

PATH="$ROOT/.venv/bin:$PATH"
export PATH

echo "sequence G: $RUNTIME, image $IMAGE"
echo "workspace: $WORK"
echo

wring verify
VERIFY=$?

RUN=$(ls -d .wringer/runs/*/ 2>/dev/null | tail -1)
if [ -z "$RUN" ]; then
  echo "sequence G: no bundle was written — nothing was measured." >&2
  exit 2
fi

echo
echo "=== what each attack actually saw ==="
for dir in "$RUN"gates/*/; do
  id=$(basename "$dir" | sed 's/^[0-9]*_//')
  echo
  echo "--- $id (exit $(python3 -c "import json,sys;print(json.load(open('${dir}result.json'))['exit_code'])" 2>/dev/null || echo '?')) ---"
  head -20 "${dir}stdout.log" 2>/dev/null
  head -10 "${dir}stderr.log" 2>/dev/null
done

cp "$RUN"execution.json "$ROOT/.wringer/sequence-g-execution.json" 2>/dev/null || true
mkdir -p "$ROOT/.wringer"
cp -R "$RUN" "$ROOT/.wringer/sequence-g-bundle" 2>/dev/null || true

echo
echo "=== verify exit $VERIFY ==="
echo
echo "NOW DO THE PART A SCRIPT CANNOT DO."
echo
echo "Read each attack's output above and classify it BY HAND:"
echo
echo "  prevented   — the thing cannot be done. Not 'it failed this time'."
echo "  detected    — it can be done and Wringer records that it happened."
echo "  mitigated   — it partly works, and the damage is bounded."
echo "  out_of_scope— this boundary never claimed to stop it."
echo
echo "NEVER write 'prevented' where Wringer merely records evidence"
echo "afterwards. Record every attempt that SUCCEEDED — an attack that works"
echo "is the finding, and a table of passes is an advert."
echo
echo "Then add a row to docs/MANUAL_CHECKS.md's coverage record, and only"
echo "then consider whether SECURITY.md's 'designed to isolate' has earned"
echo "a stronger word. The bundle is at .wringer/sequence-g-bundle/."
