#!/bin/sh
# Regenerate the README demo: a real `wring verify` failing on a planted bug,
# then a real `wring run` repairing it and verifying again.
#
# Everything below is genuinely executed. The cast records what came back and
# when; the SVG renders exactly that. If the console changes, run this again
# rather than editing either file — the same rule the captured transcripts
# have always had (law 8).
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
. "$(dirname "$0")/scratch.sh"
SCRATCH=$(scratch_dir "${1:-}" demo) || exit 2
# Prefer the repo venv (a developer regenerating the demo has one), then the
# uv-tool install SETUP.md step 3 creates, then PATH. The venv was hardcoded,
# which made this script one machine's — and "reproducible by anyone" was
# printed a few lines above the assumption.
for candidate in "$ROOT/.venv/bin" "$HOME/.local/bin"; do
    if [ -x "$candidate/wring" ] && [ -x "$candidate/python" ]; then
        PY="$candidate/python"; WRING="$candidate/wring"; break
    fi
done
PY=${PY:-$(command -v python3 || true)}
WRING=${WRING:-$(command -v wring || true)}
if [ -z "$PY" ] || [ -z "$WRING" ]; then
    echo "FATAL: need both python and wring — looked in $ROOT/.venv/bin," >&2
    echo "  \$HOME/.local/bin, then \$PATH. Install with:" >&2
    echo "  uv tool install --force --python 3.12 $ROOT" >&2
    exit 2
fi
echo "recording with $WRING ($("$WRING" --version))"

# Which recordings to regenerate; empty (the default) means every one.
#
# Not tidiness. Every cast carries real run ids and real durations, so
# regenerating all seven to change one rewrites six artifacts a reviewer then
# has to read past to find the change — the same reason `TIMING_QUANTUM`
# exists in demo_record.py: the diff has to be readable for whether the DEMO
# changed. It narrows what is REGENERATED and never what is recorded; each
# section still runs its real commands and captures what came back.
ONLY=${2:-}
want() {
    [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]
}
case "$ONLY" in
    "" | demo | start | vacuous | graph | bench | health | gategen) ;;
    *)
        echo "FATAL: no recording called '$ONLY'. One of: demo start" >&2
        echo "  vacuous graph bench health gategen — or omit it for all." >&2
        exit 2
        ;;
esac

if want demo; then
if [ -d "$SCRATCH" ]; then find "$SCRATCH" -mindepth 1 -delete 2>/dev/null; fi
mkdir -p "$SCRATCH"
cd "$SCRATCH"

git init -q -b main .
git config user.email demo@example.invalid
git config user.name "demo"
echo ".wringer/" > .gitignore

# A planted bug: the test expects 4, the code returns 5.
cat > calc.py <<'EOF'
def add(a, b):
    return a + b + 1
EOF

cat > test_calc.py <<'EOF'
from calc import add


def test_add():
    assert add(2, 2) == 4
EOF

# The worker stands in for a coding agent. In a real repo this is
#   worker: claude -p "$(cat {brief})"
# or an acp: mapping; here it is a shell one-liner so the demo is honest
# about running no agent and reproducible by anyone.
# `sed -i ''` is BSD-only and this script claims to be reproducible by
# anyone; GNU sed reads the '' as a filename and fails. Writing beside the
# file and moving it works on both, and needs no feature detection.
cat > fix.sh <<'EOF'
sed 's/return a + b + 1/return a + b/' calc.py > calc.py.tmp
mv calc.py.tmp calc.py
EOF

cat > .wringer.yaml <<'EOF'
version: 1
gates:
  - id: test
    run: "python3 -m pytest -q"

run:
  worker: "sh ./fix.sh"
  max_iterations: 3
EOF

git add -A
git commit -qm "the calculator, with a planted bug"

"$PY" "$ROOT/scripts/demo_record.py" "$SCRATCH" "$ROOT/docs/demo.cast.json" "$WRING"
"$PY" "$ROOT/scripts/demo_render.py" "$ROOT/docs/demo.cast.json" "$ROOT/docs/demo.svg"
fi

# ---------------------------------------------------------------------------
# The second recording: the guided launch.
#
# Its own scratch, and that is not tidiness. The tree above already carries a
# .wringer.yaml with `gates:` and `run:`, so `wring start` there would refuse
# to rewrite a `run:` section the file already has — the recording would be a
# correct refusal rather than a launch.
#
# It lands BESIDE docs/demo.svg rather than replacing it. The README's hero is
# `wring run` repairing a planted bug, which is the product's core claim; the
# launch is a different story (onboarding) and both are worth showing.
# ---------------------------------------------------------------------------
if want start; then
START=$(scratch_dir "${1:-}" start) || exit 2
STUBS=$(scratch_dir "${1:-}" start-bin) || exit 2

if [ -d "$START" ]; then find "$START" -mindepth 1 -delete 2>/dev/null; fi
if [ -d "$STUBS" ]; then find "$STUBS" -mindepth 1 -delete 2>/dev/null; fi
mkdir -p "$START" "$STUBS"

# The agent is a STUB, and the documentation says so beside the picture.
# It is the only route that films the agent step while keeping the rule that
# Wringer neither bundles nor installs an agent, and without putting a vendor
# binary into anyone's regeneration path. It is never executed: the launch's
# gates pass on the first try, so no repair loop runs and nothing speaks ACP.
cat > "$STUBS/claude-code-acp" <<'EOF'
#!/bin/sh
echo "this is a stub; the demo detects it and never runs it" >&2
exit 1
EOF
chmod +x "$STUBS/claude-code-acp"

cd "$START"
git init -q -b main .
git config user.email demo@example.invalid
git config user.name "demo"
echo ".wringer/" > .gitignore

# No .wringer.yaml: the launch DETECTS the gates, which is the step being
# filmed. A `test_*.py` at the root is what detection reads as a Python
# layout, so the gate it proposes is `pytest -q`.
cat > calc.py <<'EOF'
def add(a, b):
    return a + b
EOF

cat > test_calc.py <<'EOF'
from calc import add


def test_add():
    assert add(2, 2) == 4
EOF

git add -A
git commit -qm "a calculator, and a test that passes"

# Obviously fake, and it never reaches the recording: `wring start` prints the
# NAME of the variable and never its value. Setting it is what makes the key
# step non-interactive — which is the only form this recorder can film, since
# getpass reads /dev/tty and would block on the operator's real terminal.
ANTHROPIC_API_KEY=sk-ant-notarealkey
export ANTHROPIC_API_KEY
PATH="$STUBS:$PATH"
export PATH

"$PY" "$ROOT/scripts/demo_record.py" "$START" "$ROOT/docs/start.cast.json" \
    "$WRING" start
"$PY" "$ROOT/scripts/demo_render.py" "$ROOT/docs/start.cast.json" \
    "$ROOT/docs/start.svg" "wring start — preflight, gates, agent, receipt"
fi

# ---------------------------------------------------------------------------
# The third recording: the agent lies, Wringer catches it.
#
# HEAD is GREEN. The worker is then handed a change with a real test that
# catches a real bug, and it "fixes" the failure by making the test
# tautological — `assert multiply(3, 4) == multiply(3, 4)`. The gates go green
# and the loop reports convergence. The bug is still there.
#
# `wring verify --prove` re-runs those gates against the pre-change tree. They
# pass there too, so they proved nothing about the change: `gates_vacuous`.
# `wring deliver` then refuses the bundle, exit 1.
#
# **Why the baseline must be green.** `--prove` compares against HEAD, so it
# catches gates that could not fail — not an agent deleting a test that was
# already failing at HEAD, which SPEC_VACUITY_V0 §5a states as a known limit.
# Committing the failing test would therefore record `sensitive` and tell the
# opposite story. The tree is left DIRTY for the same reason: a clean tree
# makes `--prove` return `not_applicable` and write no verdict at all.
#
# The gate is `python3 -m pytest -q` and the test imports only the repo's own
# module, because the pre-change worktree carries TRACKED FILES ONLY — a gate
# needing an installed dependency fails there on a missing environment, and
# the comparison reads that failure as PROOF.
# ---------------------------------------------------------------------------
if want vacuous; then
VACUOUS=$(scratch_dir "${1:-}" vacuous) || exit 2
# The bare `origin` gets a scratch of its own rather than a path derived by
# string-appending to $VACUOUS: `scratch.sh` constructs safe answers, and
# building one by hand next to it is how that guarantee gets lost. It also
# has to be CLEARED — a bare repo surviving from a previous run already has
# `main`, so the push below fails and `set -eu` kills the script before the
# recording happens.
ORIGIN=$(scratch_dir "${1:-}" vacuous-origin) || exit 2
for tree in "$VACUOUS" "$ORIGIN"; do
    if [ -d "$tree" ]; then find "$tree" -mindepth 1 -delete 2>/dev/null; fi
    mkdir -p "$tree"
done
cd "$VACUOUS"

git init -q -b main .
git config user.email demo@example.invalid
git config user.name "demo"
echo ".wringer/" > .gitignore

cat > calc.py <<'EOF'
def add(a, b):
    return a + b
EOF

cat > test_calc.py <<'EOF'
from calc import add


def test_add():
    assert add(2, 2) == 4
EOF

cat > .wringer.yaml <<'EOF'
version: 1
gates:
  - id: test
    run: "python3 -m pytest -q"

run:
  worker: "sh ./fix.sh"
  max_iterations: 3

deliver:
  branch: "wringer/{run}"
EOF

git add -A
git commit -qm "a calculator, and a test that passes"

# A real `origin` on disk. `wring deliver` refuses when the remote's default
# branch cannot be resolved, and that refusal would be recorded INSTEAD of the
# vacuity one — the recording would show a true message about the wrong thing.
git init -q --bare -b main "$ORIGIN"
git remote add origin "$ORIGIN"
git push -q origin main
git remote set-head origin -a

# The change an agent is asked to land: a new function with a real bug, and a
# real test that catches it. The gates fail here, which is what gives the loop
# something to do.
cat > calc.py <<'EOF'
def add(a, b):
    return a + b


def multiply(a, b):
    return a + b
EOF

cat > test_calc.py <<'EOF'
from calc import add, multiply


def test_add():
    assert add(2, 2) == 4


def test_multiply():
    assert multiply(3, 4) == 12
EOF

# The lie. It stands in for a coding agent, as `demo.sh`'s first recording
# does, so the demo is honest about running no agent and reproducible by
# anyone. What it does is what matters and it is exactly what a reward-hacking
# agent does: make the assertion true rather than the code correct.
cat > fix.sh <<'EOF'
sed 's/multiply(3, 4) == 12/multiply(3, 4) == multiply(3, 4)/' test_calc.py > t
mv t test_calc.py
EOF

"$PY" "$ROOT/scripts/demo_record.py" "$VACUOUS" "$ROOT/docs/vacuous.cast.json" \
    "$WRING" vacuous
"$PY" "$ROOT/scripts/demo_render.py" "$ROOT/docs/vacuous.cast.json" \
    "$ROOT/docs/vacuous.svg" "the gates went green and proved nothing"
fi

# ---------------------------------------------------------------------------
# The fourth recording: the graph, and the interlock nothing can flip.
#
# `wring graph run` stages the brief, reaches the human node and PARKS — exit
# 5, a person must act. Nothing on that screen is a flag: SPEC_INTENT §3's
# three rules bind here verbatim, so the only thing that moves a parked graph
# is somebody editing `decision.yaml`. That edit is filmed as its own step,
# displayed and executed as one string, which is why this recording needed no
# new recorder capability — no pty driving, no synthesised keystrokes into the
# one file law 8 forbids editing.
#
# `wring graph resume` then runs the loop, the router reads what the loop
# actually found, and the graph reaches `done`. `wring graph status` reads it
# all back out of the ledger.
#
# The node ids are SHORT on purpose. The renderer's canvas is a fixed 80
# columns with no wrapping, and `wring graph run`'s park report prints the
# decision file's full path — `.wringer/graphs/<20-char id>/nodes/<id>/
# decision.yaml`. A long node id puts that line off the edge of the picture.
# ---------------------------------------------------------------------------
if want graph; then
GRAPH=$(scratch_dir "${1:-}" graph) || exit 2
if [ -d "$GRAPH" ]; then find "$GRAPH" -mindepth 1 -delete 2>/dev/null; fi
mkdir -p "$GRAPH"
cd "$GRAPH"

git init -q -b main .
git config user.email demo@example.invalid
git config user.name "demo"
echo ".wringer/" > .gitignore

cat > calc.py <<'EOF'
def add(a, b):
    return a + b + 1
EOF

cat > test_calc.py <<'EOF'
from calc import add


def test_add():
    assert add(2, 2) == 4
EOF

cat > brief.md <<'EOF'
# Fix the calculator

`add` returns one too many. The test says so.
EOF

# The worker stands in for a coding agent, as every other recording here does,
# so the demo is honest about running no agent and reproducible by anyone.
cat > fix.sh <<'EOF'
sed 's/return a + b + 1/return a + b/' calc.py > calc.py.tmp
mv calc.py.tmp calc.py
EOF

cat > .wringer.yaml <<'EOF'
version: 1
gates:
  - id: test
    run: "python3 -m pytest -q"

run:
  worker: "sh ./fix.sh"
  max_iterations: 3
EOF

cat > graph.yaml <<'EOF'
version: 1
id: demo

inputs:
  brief: brief.md

budgets:
  wall_clock: 600

nodes:
  read:
    kind: intent
    input: inputs.brief
    writes:
      brief: state.brief
    then: ok
  ok:
    kind: human
    prompt: "Read the brief, then set approved: true by hand."
    then: build
  build:
    kind: loop
    budgets:
      max_iterations: 3
    writes:
      status: state.build-status
    then: route
  route:
    kind: router
    routes:
      - when: "state.build-status == 'converged'"
        to: done
    default: fail
EOF

git add -A
git commit -qm "the calculator, with a planted bug"

"$PY" "$ROOT/scripts/demo_record.py" "$GRAPH" "$ROOT/docs/graph.cast.json" \
    "$WRING" graph
"$PY" "$ROOT/scripts/demo_render.py" "$ROOT/docs/graph.cast.json" \
    "$ROOT/docs/graph.svg" "a graph parks, a person decides, the graph resumes"
fi

# ---------------------------------------------------------------------------
# The fifth recording: two workers, one job, and no winner.
#
# `wring bench` runs the same repair through every declared contender under
# identical conditions and writes one comparison. The recording exists to show
# the thing the table REFUSES to do.
#
# Both contenders are shell scripts. That is not a shortcut around an agent
# binary — it is what makes the point filmable. `careful.sh` fixes the
# function. `hasty.sh` rewrites the failing assertion into a tautology, which
# is what a reward-hacking agent does and what SPEC_VACUITY_V0 §5a records as
# the blind spot. Both converge. Every measured column — outcome, iterations,
# wall clock — says they did equally well, because on those columns they DID.
#
# So the bench prints them in declared order with no winner and no score, and
# the limits underneath say what the numbers cannot: a green gate proves the
# gates went green, not that the fix is honest. The last step of the recording
# is the reader doing what that sentence tells them to do — reading the diff —
# and finding that one contender changed the code and the other changed the
# test. An auto-ranked bench would have crowned the faster liar.
# ---------------------------------------------------------------------------
if want bench; then
BENCH=$(scratch_dir "${1:-}" bench) || exit 2
if [ -d "$BENCH" ]; then find "$BENCH" -mindepth 1 -delete 2>/dev/null; fi
mkdir -p "$BENCH"
cd "$BENCH"

git init -q -b main .
git config user.email demo@example.invalid
git config user.name "demo"
echo ".wringer/" > .gitignore

# The job, COMMITTED red: a benchmark of repair needs something to repair, and
# bench refuses a green baseline rather than measuring N agents converging in
# zero iterations against work that was already done.
cat > calc.py <<'EOF'
def multiply(a, b):
    return a + b
EOF

cat > test_calc.py <<'EOF'
from calc import multiply


def test_multiply():
    assert multiply(3, 4) == 12
EOF

cat > careful.sh <<'EOF'
sed 's/return a + b/return a * b/' calc.py > c && mv c calc.py
EOF

cat > hasty.sh <<'EOF'
sed 's/multiply(3, 4) == 12/multiply(3, 4) == multiply(3, 4)/' test_calc.py > t
mv t test_calc.py
EOF

cat > .wringer.yaml <<'EOF'
version: 1
gates:
  - id: test
    run: "python3 -m pytest -q"

bench:
  contender_wall_clock: 120
  contenders:
    - id: careful
      worker: "sh ./careful.sh"
    - id: hasty
      worker: "sh ./hasty.sh"
EOF

git add -A
git commit -qm "multiply is wrong, and a test says so"

"$PY" "$ROOT/scripts/demo_record.py" "$BENCH" "$ROOT/docs/bench.cast.json" \
    "$WRING" bench
"$PY" "$ROOT/scripts/demo_render.py" "$ROOT/docs/bench.cast.json" \
    "$ROOT/docs/bench.svg" "same job, both workers, and no winner"
fi

# ---------------------------------------------------------------------------
# The sixth recording: a gate dies, and every tick stays green.
#
# This is the one `wring health` exists for. A gate fails for real on camera —
# it demonstrably CAN fail, with a receipt. Then a worker "fixes" it the way a
# reward-hacking agent does: by rewriting the failing assertion into a
# tautology. From that moment the check is dead, and NOTHING anywhere says so.
# Every run afterwards passes. Every bundle is valid. Every dashboard shows a
# green tick.
#
# Twenty-five more real runs later — really executed, as one displayed-equals-
# executed shell step, because faking time in a recording about decay would be
# the exact dishonesty this product sells against — the failure has left the
# window, and `wring health` says `zombie` with the receipts.
#
# NOTE what is deliberately NOT here: `--prove` on the neutering change. With
# the test failing at HEAD, proving it would record `sensitive: true` for the
# WRONG REASON (SPEC_VACUITY_V0 §5a) and stamp a fresh vitality receipt on the
# gate being killed. That is limit 4 of this command's own report, it is
# inherited whole, and docs/health.md says so in words beside the picture
# rather than leaving a reader to find it.
# ---------------------------------------------------------------------------
if want health; then
HEALTH=$(scratch_dir "${1:-}" health) || exit 2
if [ -d "$HEALTH" ]; then find "$HEALTH" -mindepth 1 -delete 2>/dev/null; fi
mkdir -p "$HEALTH"
cd "$HEALTH"

git init -q -b main .
git config user.email demo@example.invalid
git config user.name "demo"
echo ".wringer/" > .gitignore

cat > calc.py <<'EOF'
def multiply(a, b):
    return a + b
EOF

cat > test_calc.py <<'EOF'
from calc import multiply


def test_multiply():
    assert multiply(3, 4) == 12
EOF

# The "fix". It makes the gates green without making the code correct — the
# shape SPEC_VACUITY_V0 §5a names, and the shape that leaves no trace anywhere
# except in the longitudinal record this command reads.
cat > fix.sh <<'EOF'
sed 's/multiply(3, 4) == 12/multiply(3, 4) == multiply(3, 4)/' test_calc.py > t
mv t test_calc.py
EOF

cat > .wringer.yaml <<'EOF'
version: 1
gates:
  - id: test
    run: "python3 -m pytest -q"

run:
  worker: "sh ./fix.sh"
  max_iterations: 2
EOF

git add -A
git commit -qm "multiply is wrong, and a test says so"

"$PY" "$ROOT/scripts/demo_record.py" "$HEALTH" "$ROOT/docs/health.cast.json" \
    "$WRING" health
"$PY" "$ROOT/scripts/demo_render.py" "$ROOT/docs/health.cast.json" \
    "$ROOT/docs/health.svg" "the gate is dead and every tick is green"
fi

# ---------------------------------------------------------------------------
# The seventh recording: a criterion becomes a gate, and the gate is RED first.
#
# This is `docs/factory-dry-run.md`'s scenario, re-driven end to end with the
# machinery SPEC_GATEGEN_V0.md specified — and it is the only recording here
# that films the chain BUILDING something rather than catching something.
#
# A PM's spec asks for CSV export. Four acceptance criteria, one `human:
# true`. `wringer.gates.yaml` proposes one gate per machine criterion with the
# `proves:` line that binds it. `wring plan` renders those through the human
# diff and STOPS; something outside Wringer applies it; the first `wring
# verify` records the gate RED, because the feature does not exist yet and a
# gate that proves an unmet criterion has exactly one honest colour.
#
# **The sidecar is hand-written, and that is the point rather than a
# shortcut.** There is no LLM endpoint on this machine, and SPEC_GATEGEN
# ruling 5 keeps the offline path first-class: the file the drafter would emit
# is a file a person can write, and everything downstream is identical.
#
# **No gate here needs pytest.** The dry run died on `No module named pytest`
# — exit 1, an environment failure the loop read as a repair job (F6, still
# open) — so every check in this scenario is stdlib-only and the environment
# does not get to decide the result. That is a choice about what this
# recording measures, not a fix, and docs/gategen.md says so beside it.
#
# **The worker takes ONE step per call.** It stands in for a coding agent, as
# every recording here does, and it does what one does with a repair brief:
# looks at the tree, moves the nearest failing thing, stops. That is what
# makes each of the three gates go red on its own iteration before it goes
# green — the discrimination receipt acceptance requires, produced by the
# loop's own sequencing rather than by a step staged for the camera.
#
# The gate commands are BYTE-IDENTICAL between the red run and the green one.
# Acceptance keys its receipt on `(gate id, command)`, so editing a command
# between them — even cosmetically — silently costs the criterion its
# evidence and `wring deliver` refuses. Nothing here rewrites them.
# ---------------------------------------------------------------------------
if want gategen; then
GATEGEN=$(scratch_dir "${1:-}" gategen) || exit 2
# Its own bare `origin`, cleared like the vacuous one: `wring deliver` refuses
# when the remote's default branch cannot be resolved, and a bare repo left
# over from a previous run already has `main`, so the push below fails and
# `set -eu` kills the script before anything is recorded.
GGORIGIN=$(scratch_dir "${1:-}" gategen-origin) || exit 2
for tree in "$GATEGEN" "$GGORIGIN"; do
    if [ -d "$tree" ]; then find "$tree" -mindepth 1 -delete 2>/dev/null; fi
    mkdir -p "$tree"
done
cd "$GATEGEN"

git init -q -b main .
git config user.email demo@example.invalid
git config user.name "demo"
# `__pycache__/` as well as the evidence directory, and it earns its line: the
# gates import `reports`, so the first red verify leaves a .pyc behind, and
# without this the delivered commit carries a compiled artifact nobody wrote.
# Anchored to a directory name Python owns — the `build/` lesson is that an
# unanchored pattern silently swallows a path that means something else.
printf '.wringer/\n__pycache__/\n' > .gitignore

# The repo as it stands: a reports module that works, and a check that says so.
cat > reports.py <<'EOF'
ROWS = [("alpha", 12.5), ("beta", 3.0)]


def table():
    """The report, header row first."""
    return [("name", "amount"), *ROWS]
EOF

# The repo's existing gate. Stdlib only, and no pytest deliberately.
cat > test_reports.py <<'EOF'
from reports import table

assert table()[0] == ("name", "amount")
assert len(table()) == 3
EOF

# The three acceptance checks, one per machine criterion, hand-written here
# because there is no endpoint on this machine. Each one exits non-zero with a
# SHORT message rather than a traceback: the failure is filmed, and a
# twenty-line stack would be a wall rather than a demo.
cat > g_hdr.py <<'EOF'
"""hdr — the CSV header is the table's columns, in order."""
import csv
import io

import reports

if not hasattr(reports, "to_csv"):
    raise SystemExit("reports.to_csv() does not exist")
header = next(csv.reader(io.StringIO(reports.to_csv())))
if header != list(reports.table()[0]):
    raise SystemExit(f"header is {header}")
EOF

cat > g_rows.py <<'EOF'
"""rows — every row of the table reaches the CSV."""
import csv
import io

import reports

if not hasattr(reports, "to_csv"):
    raise SystemExit("reports.to_csv() does not exist")
out = list(csv.reader(io.StringIO(reports.to_csv())))
if len(out) != len(reports.table()):
    raise SystemExit(f"{len(out)} rows, table has {len(reports.table())}")
EOF

cat > g_cents.py <<'EOF'
"""cents — amounts keep two decimal places."""
import csv
import io

import reports

if not hasattr(reports, "to_csv"):
    raise SystemExit("reports.to_csv() does not exist")
out = list(csv.reader(io.StringIO(reports.to_csv())))
for row in out[1:]:
    if len(row[1].partition(".")[2]) != 2:
        raise SystemExit(f"amount {row[1]} is not two decimals")
EOF

# The worker. It stands in for a coding agent and takes ONE step per call —
# whichever failing gate is nearest — which is what a repair brief asks for and
# what makes each gate red on its own iteration.
cat > build.sh <<'EOF'
if ! grep -q 'def to_csv' reports.py; then
    cat >> reports.py <<'PY'


def to_csv():
    return ",".join(table()[0]) + "\n"
PY
elif ! grep -q 'for name' reports.py; then
    cat > reports.py <<'PY'
ROWS = [("alpha", 12.5), ("beta", 3.0)]


def table():
    """The report, header row first."""
    return [("name", "amount"), *ROWS]


def to_csv():
    header, *rows = table()
    out = [",".join(header)]
    out += [f"{name},{amount}" for name, amount in rows]
    return "\n".join(out) + "\n"
PY
else
    sed 's/{amount}/{amount:.2f}/' reports.py > r && mv r reports.py
fi
EOF

# The diff `wring plan` prints is machine-readable too, and `gate_diff` writes
# `a/` and `b/` prefixes so `git apply` takes it as-is. This is what lets the
# install step be ONE line a reader can type — see docs/gategen.md for what
# that does and does not prove about a human being in the loop.
cat > patch.py <<'EOF'
import json
import sys

sys.stdout.write(json.load(sys.stdin)["gate_diff"])
EOF

cat > .wringer.yaml <<'EOF'
version: 1
gates:
  - id: test
    run: "python3 test_reports.py"

run:
  worker: "sh ./build.sh"
  max_iterations: 5

deliver:
  branch: "wringer/{run}"
EOF

# Hand-written in the shape `wring spec` drafts, `approved: true` because the
# reading step is `docs/pm-loop.md`'s and this recording starts after it.
cat > wringer.spec.yaml <<'EOF'
schema_version: wringer.spec.v1
approved: true
title: Export the report as CSV

intent: |2
  The table view is fine but nobody can get the numbers out of it.
  Add a CSV export: same columns, same order, every row, and the
  amounts must still read as money.

open_questions: []

criteria:
  - id: hdr
    title: The CSV header is the table's columns, in order
    required: true
    human: false
  - id: rows
    title: Every row of the table reaches the CSV
    required: true
    human: false
  - id: cents
    title: Amounts keep two decimal places
    required: true
    human: false
  - id: copy
    title: The export button's label reads well
    required: true
    human: true

gates: []

tasks:
  - id: csv
    brief: brief.md
    dir: .
    objective: Add reports.to_csv() and a button that calls it
EOF

# The sidecar — `wringer.gatespec.v1`, the only channel that may carry
# `proves:`. Ids are short because the renderer's canvas is a fixed 80
# columns, the same constraint the graph recording's node ids are under.
cat > wringer.gates.yaml <<'EOF'
schema_version: wringer.gatespec.v1

gates:
  - id: csv-hdr
    run: "python3 g_hdr.py"
    proves: hdr
  - id: csv-rows
    run: "python3 g_rows.py"
    proves: rows
  - id: csv-cents
    run: "python3 g_cents.py"
    proves: cents
EOF

git add -A
git commit -qm "the report, and a spec asking for CSV export"

git init -q --bare -b main "$GGORIGIN"
git remote add origin "$GGORIGIN"
git push -q origin main
git remote set-head origin -a

"$PY" "$ROOT/scripts/demo_record.py" "$GATEGEN" "$ROOT/docs/gategen.cast.json" \
    "$WRING" gategen
"$PY" "$ROOT/scripts/demo_render.py" "$ROOT/docs/gategen.cast.json" \
    "$ROOT/docs/gategen.svg" "a criterion becomes a gate, and it is red first"
fi
