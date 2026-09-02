# Quickstart

> **Every transcript on this page is real** — one session in a scratch Python
> repo on 2026-07-30, captured and pasted unedited, in the order shown. The
> single clearly-marked block at the bottom is not built yet and says so.
>
## Install

**Python 3.11 or newer**, macOS or Linux. Check first — stock macOS ships
3.9, and the install fails with a bare resolver error rather than a useful
one:

```bash
python3 --version        # must be 3.11+
```

```bash
uv tool install wringer
```

That is **0.7.2**, all nineteen commands, and its only runtime dependency is
PyYAML. It installs four executables — `wring`, `wringer`, `wringer-board`
and `wringer-drive` — as one distribution, and puts them on your PATH without
touching your system Python. `pipx install wringer` and `pip install wringer`
into a venv both work identically.

> **This page describes the released package.** It used to say the opposite —
> that `0.3.0` was behind the repository, that `bench` and `health` were
> missing from the release, and that a reader should **install from source
> instead**. Every one of those sentences was true when it was written and
> false from `0.4.0` onward, and they sat on the Quickstart until 2026-08-22
> because the release guard checked `README.md` and `SECURITY.md` by name and
> this page was not on the list. It is derived now, so a page that names a
> released version is held to the newest tag whether or not anybody
> remembered to add it.

Verify it:

```bash
wring --version          # wring 0.7.2
```

> **Installing from git** — `pip install "git+https://github.com/marcoakes/wringer"`
> — gets you whatever is on `main`, which is ahead of the release and
> occasionally mid-slice. Use it to try something unreleased; use PyPI
> otherwise.

**The first thing that usually goes wrong** is not Wringer: `wring init`
detects the commands your project declares, so if it writes a `pytest -q`
gate and you have not installed your own dev dependencies, `wring verify`
reports `pytest: command not found` and a failing gate. That is Wringer
working correctly — it ran what your repo declared. Install your project's
dependencies into the same environment, or edit `.wringer.yaml`.

## Or let it walk you through it

`wring start` does the next four sections for you: preflight, the gates your
project already declares, the agent that will drive the repair loop, and a
first build that ends on a receipt.

<div align="center">

<img src="docs/start.svg" alt="wring start: preflight, detected gates, the agent, and a receipt" width="700">

*A real session, captured — [`docs/start.cast.json`](docs/start.cast.json) is
the transcript, and `scripts/demo.sh` regenerates both.*

</div>

**Two things that recording cannot honestly show, so they are written here
instead.**

*The key step is not in the recording.* `wring start` asks for your API key at
a prompt that does not echo — and a prompt is the one thing this capture
method cannot film. It records a real process through a pty and Python's
`getpass` reads `/dev/tty` rather than stdin, so a filmed prompt would block
on the operator's own terminal and never return. The recorded run therefore
has the variable already set, which is the non-interactive form of that
answer, and the terminal says so on the `[6/7] key` line. A recording that
staged the typing would be a transcript of a session nobody had.

*The agent in the recording is a stub.* A file on `PATH` that does nothing,
named for whatever `src/wringer/agents.py` says the binary is. Detection is
`shutil.which` and nothing cleverer, so a stub is all it takes to film the
step — and Wringer neither bundles nor installs an agent, so putting a real
vendor binary in anyone's regeneration path would contradict the thing being
demonstrated. The recording shows `claude-code-acp`, which is what that table
said when it was filmed; the vendor has since renamed the package and the
table now says `claude-agent-acp`. **The recording is evidence and is not
edited** — it records what was filmed. The stub name follows the table at the
next re-film. The launch never runs it:
the gates pass on the first try, so there is no failure to hand to a repair
loop. What the recording shows is detection and consent, which is all that
step does.

*Wringer never stores a credential.* `wring start` will ask for your API key
so it can hand it to the build it launches; it keeps it in memory for that
session, folds it into the redactor so it cannot reach a bundle, and writes it
nowhere. Your config records the *name* of an environment variable, never a
key. Nothing else in Wringer ever asks.

Everything it does has a flag, so an agent can run the whole thing without a
terminal — and with no terminal and a missing answer it exits 2 naming what it
wanted rather than guessing. Two refusals are deliberate: it never installs an
agent (it prints the command for you to run), and `wring start --clone` fetches
a repository, records where it came from, and **stops** — a stranger's
`.wringer.yaml` is code, and running it in the same breath as downloading it is
the one thing a guided launch must not do.

## The nineteen commands

**Nineteen, in the repository and in the released package alike** — that has
been true since `0.4.0`, and this line used to say seventeen because `bench`
and `health` came after `0.3.0`. There is no longer a gap between what you
install and what this page walks.

This page walks five of them in order. The rest exist and are documented
where they are used; nothing here is a preview.

| command | does | proves? | network |
|---|---|---|---|
| `start` | the guided launch: preflight, config, agent, first build, receipt | **yes** | `--clone` fetches |
| `init` | write a `.wringer.yaml` from what your project already declares | — | no |
| `verify` | run the declared gates, write an evidence bundle | **yes** | no |
| `explain` | diagnose a finished run, without an LLM | — | no |
| `run` | the repair loop: verify → brief → your worker → verify | **yes** | no |
| `resume` | continue a loop that was killed mid-flight | **yes** | no |
| `fleet` | many loops under supervision, bounded and self-healing | **yes** | no |
| `judge` | weigh a finished bundle against a rubric | — | `--send` |
| `spec` | draft `wringer.spec.yaml` from a PRD, for a human to approve | — | `--send` |
| `plan` | compile an approved spec into fleet tasks, briefs and a rubric | — | no |
| `get` | clone a repository into your workspace | — | fetches |
| `issue` | write a forge issue to a local markdown file | — | fetches |
| `deliver` | a verified change becomes a branch, a commit and a merge request | — | `--send` |
| `doctor` | check this machine's preconditions; exit 1 on anything blocking | — | no |
| `graph` | compose loops into a resumable, evidence-driven workflow (`validate`, `run`, `resume`, `status`, `explain`, `render`) | **yes** | `--send` |
| `bench` | run the same job through every declared worker and compare — it measures, it does not crown | **yes** | no |
| `health` | read the evidence your runs already wrote: is there any evidence each gate can still fail? | no | no |
| `attest` | assemble the provenance claim for a verified change | — | no |
| `audit` | check an attestation offline — no config, no network, no LLM | — | no |

**Nothing reaches a network while it is proving.** That is the line that
matters: the gates, the loop and the vacuity check run offline everywhere they
appear, so the code that decides whether a change is good cannot be reached by
anything outside your machine. Five commands can send, each on a flag you type
and each needing a section your repo declared. `get` and `issue` fetch,
because fetching is what they are for.

`graph` is the one row that is both, and P7 made it so: its loop node proves
and its deliver node can push. It does them in that order and never mixes
them — the evidence is produced with no network in reach, and is then
re-checked by delivery's own refusals before a `--send` you typed can move
anything. A graph adds sequencing, never permission.

The whole PM path — a PRD or an issue in, a reviewed branch out — is
[`docs/pm-loop.md`](docs/pm-loop.md) and
[`docs/issue-to-mr.md`](docs/issue-to-mr.md), both captured end to end.
Composing those steps into one resumable workflow file is
[`docs/graphs.md`](docs/graphs.md) — a graph of loops, with the park, the hand
edit and the resume captured too.

Choosing between workers is [`docs/bench.md`](docs/bench.md): the same job
through every worker you declare, under identical conditions, in one
comparison. It measures and it does not crown — the captured run has two
contenders converging in the same two iterations, and the diffs underneath
showing that one fixed the code and the other rewrote the test.

## Declare your gates

`wring init` reads what your project already declares — `pyproject.toml`,
`package.json`, or a `Makefile` — and writes the matching gates:

```
$ wring init
Wrote .wringer.yaml from pyproject.toml — gates: lint, test
Check they are the commands you want proven, then: wring verify
Added .wringer/ to .gitignore
```

It never invents a command nobody wrote down: in a repo with nothing to
detect you get a commented template to fill in instead. Either way the file
is yours to edit — gates run in your repo root, in the order listed,
cheapest first:

```yaml
version: 1

gates:
  - id: lint
    run: ruff check .
    timeout: 120

  - id: test
    run: pytest -q
    timeout: 300
```

### If your test gate is slow, it is probably on one core

Wringer runs the command you declare, verbatim — so the single biggest
speedup available to most repositories is one word in your own config:

```yaml
  - id: test
    run: pytest -q -n auto      # pip install pytest-xdist
```

Same gates, same evidence, one core per worker. This repository's own suite
went from **240s to 59s** that way, with all 1114 tests passing identically,
because it was IO-bound and running on a single core.

It costs the evidence nothing: the gate still passes or fails on exactly what
it did before. `wring doctor` will offer you this line once a run has recorded
how long your suite actually takes — it proposes and stops, because
`.wringer.yaml` is yours.

**Wringer does not run your *gates* concurrently, and that is deliberate.**
A gate's recorded duration is compared across runs by `wring health` to spot
drift, and gates racing each other for CPU would inflate those numbers by an
amount nobody recorded — the report would say your checks are degrading when
what actually moved was the instrument. Parallelism inside your test runner is
free; parallelism inside the harness is not.

## Verify

```
$ wring verify
✓ lint passed        0.1s
✓ test passed        0.1s

Evidence written to:
.wringer/runs/20260730-210748-c5fc/
```

Exit code `0`. Now an off-by-one slips into `calc.py`:

```
$ wring verify
✓ lint passed        0.0s
✗ test failed        0.1s

--- gates/002_test/stdout.log ---
F                                                                        [100%]
=================================== FAILURES ===================================
___________________________________ test_add ___________________________________

    def test_add():
>       assert add(2, 2) == 4
E       assert 5 == 4
E        +  where 5 = add(2, 2)

test_calc.py:5: AssertionError
=========================== short test summary info ============================
FAILED test_calc.py::test_add - assert 5 == 4
1 failed in 0.01s

Evidence written to:
.wringer/runs/20260730-210750-b3ec/

Next:
  open .wringer/runs/20260730-210750-b3ec/summary.md
  rerun wring verify --gate test
```

Exit code `1`. Gate output is captured, never echoed: a passing run stays
quiet, and a failing one shows the tail of the log it wrote. `deploy`-style
gates listed after a required failure are not run at all.

## What it leaves behind

```
$ find .wringer/runs/20260730-210750-b3ec | sort
.wringer/runs/20260730-210750-b3ec
.wringer/runs/20260730-210750-b3ec/diff.patch
.wringer/runs/20260730-210750-b3ec/evidence.jsonl
.wringer/runs/20260730-210750-b3ec/gates
.wringer/runs/20260730-210750-b3ec/gates/001_lint
.wringer/runs/20260730-210750-b3ec/gates/001_lint/result.json
.wringer/runs/20260730-210750-b3ec/gates/001_lint/stderr.log
.wringer/runs/20260730-210750-b3ec/gates/001_lint/stdout.log
.wringer/runs/20260730-210750-b3ec/gates/002_test
.wringer/runs/20260730-210750-b3ec/gates/002_test/result.json
.wringer/runs/20260730-210750-b3ec/gates/002_test/stderr.log
.wringer/runs/20260730-210750-b3ec/gates/002_test/stdout.log
.wringer/runs/20260730-210750-b3ec/manifest.json
.wringer/runs/20260730-210750-b3ec/status.txt
.wringer/runs/20260730-210750-b3ec/summary.md
```

`summary.md` is the human's entry point:

````markdown
# wring verify — 20260730-210750-b3ec

- repo: **qs2** @ `25cbad0` (branch `main`, dirty)
- started: 2026-07-30T21:07:50+01:00
- result: **failed** — required gate `test` failed
- files: 1 changed, 1 untracked ([diff.patch](diff.patch), [status.txt](status.txt))

| gate | status | duration | logs |
|---|---|---|---|
| lint | passed | 0.0s | [stdout](gates/001_lint/stdout.log) · [stderr](gates/001_lint/stderr.log) |
| test | failed | 0.1s | [stdout](gates/002_test/stdout.log) · [stderr](gates/002_test/stderr.log) |

Rerun the failing gate:

```
wring verify --gate test
```
````

`evidence.jsonl` is the machine's — append-only, one timestamped object per
line:

```json
{"type": "run.started", "ts": "2026-07-30T21:07:50.641+01:00", "run_id": "20260730-210750-b3ec", "wringer_version": "0.1.0", "repo": "qs2", "sha": "25cbad08b3d1e553fdd40631767984d2d19f46d3"}
{"type": "git.status", "ts": "2026-07-30T21:07:50.641+01:00", "dirty": true, "changed_files": ["calc.py"], "untracked": ["__pycache__/"]}
{"type": "gate.started", "ts": "2026-07-30T21:07:50.642+01:00", "gate_id": "lint", "command": "ruff check ."}
{"type": "gate.finished", "ts": "2026-07-30T21:07:50.655+01:00", "gate_id": "lint", "exit_code": 0, "duration_ms": 13}
{"type": "gate.started", "ts": "2026-07-30T21:07:50.655+01:00", "gate_id": "test", "command": "pytest -q"}
{"type": "gate.finished", "ts": "2026-07-30T21:07:50.777+01:00", "gate_id": "test", "exit_code": 1, "duration_ms": 121, "log": "gates/002_test/stdout.log"}
{"type": "run.finished", "ts": "2026-07-30T21:07:50.777+01:00", "status": "failed", "failed_gate": "test"}
```

And `diff.patch` is exactly what you were verifying:

```diff
diff --git a/calc.py b/calc.py
index 4693ad3..d3c55d1 100644
--- a/calc.py
+++ b/calc.py
@@ -1,2 +1,3 @@
 def add(a, b):
-    return a + b
+    # off-by-one slipped in here
+    return a + b + 1
```

Untracked files are listed in `status.txt` and the `git.status` event, not in
the patch — git cannot diff a file it has never seen, and pretending
otherwise would be a lie in an evidence bundle.

Exit codes are contract, and all five are live: `0` all required gates
passed · `1` a required gate failed · `2` config or environment error ·
`3` refused (see below) · `4` interrupted.

`wring verify` refuses with `3` when the tree is in the middle of a merge,
rebase, cherry-pick, revert or bisect — HEAD and the working tree then
describe a state nobody chose, and "passing" would be a claim about a commit
that does not exist yet. Finish or abort the operation, then verify.

Press Ctrl-C and you get `4`: the gate is stopped (it runs in its own process
group, so Wringer has to do that deliberately) and the partial bundle is
written and marked `interrupted` rather than abandoned half-finished.

## `wring explain` — what just happened

Reads the last run, or one you name. No LLM is involved: every line comes
straight out of the bundle.

```
$ wring explain
Run 20260730-210750-b3ec — failed
qs2 @ 25cbad0 (branch main, dirty) · started 2026-07-30T21:07:50+01:00

✓ lint passed        0.0s
✗ test failed        0.1s

Failing gate: test
  command    pytest -q
  exit code  1

--- gates/002_test/stdout.log ---
F                                                                        [100%]
=================================== FAILURES ===================================
___________________________________ test_add ___________________________________

    def test_add():
>       assert add(2, 2) == 4
E       assert 5 == 4
E        +  where 5 = add(2, 2)

test_calc.py:5: AssertionError
=========================== short test summary info ============================
FAILED test_calc.py::test_add - assert 5 == 4
1 failed in 0.01s

Changed files (1):
  calc.py
Untracked (1): __pycache__/

Full report:
  .wringer/runs/20260730-210750-b3ec/summary.md

Rerun:
  wring verify --gate test
```

## For agents: `--json`

`wring verify --json` prints exactly one object and nothing else — no ✓ lines,
no log tails — so a coding agent can act on the result without parsing prose:

```
$ wring verify --json
{"status": "failed", "failed_gate": "test", "rerun": "wring verify --gate test", "evidence_dir": ".wringer/runs/20260730-204959-7eec"}
```

Every key is always present, so a consumer never has to tell "passed" apart
from "the tool forgot to mention it": on a passing run `failed_gate` and
`rerun` are `null`. Exit codes are unchanged, and the full bundle is written
either way.

Everything else that works today:

```bash
wring verify --gate test        # one gate; its evidence keeps its declared number
wring verify --serial           # never overlap two gates, whatever the config says
wring verify --prove            # run the gates against the tree WITHOUT your change
wring verify --falsify          # break your change on purpose; report what nothing noticed
wring explain .wringer/runs/<id>    # diagnose a specific run
wring --version
```

`--prove` answers "could these gates have failed?"; `--falsify` answers the
harder one — "what could I break in this change that every bound check would
still pass?" Both print what they found, and both write a record beside the
run. A repository with an approved `wringer.spec.yaml` also gets the coverage
statement on every run: **how many of its requirements carry a check that can
prove them**, in two lines, one of which is what that number cannot see.

## ⚠️ `.wringer.yaml` is code

`wring verify` runs the commands the repo declares, through a shell, with your
privileges — exactly as if you had typed them. **Read a repository's
`.wringer.yaml` before running `wring verify` in it**, the same way you would read
its `Makefile`. See [SECURITY.md](SECURITY.md).

## Writing the bundle somewhere else

```bash
wring verify --output .wringer/runs/manual-001
```

Naming a path is an instruction, so unlike a normal run this one will reuse
the directory you gave it — clearing the previous run's bundle first, because
one directory describes one run. Anything else you keep in that directory is
left alone.

## The loop — `wring run`

`wring verify` proves a change. `wring run` closes the loop around it: while
the gates fail, it writes the failure into a brief, hands it to **your** coding
agent, and verifies again. Wringer never calls an LLM itself — the worker is
whatever command you declare, spawned as a subprocess.

Add a `run:` section:

```yaml
run:
  worker: claude -p "$(cat {brief})"
  max_iterations: 3
  worker_timeout: 900
```

`{brief}` is the path to this iteration's brief; `{evidence_dir}` and
`{iteration}` are also available. There is **no default worker** — Wringer
runs the command you wrote down, never one it guessed.

A real run, captured from a scratch repo whose `add()` returned `a - b`, with
a shell script standing in for the agent:

```
$ wring run

iteration 1/3
✗ test failed        0.2s
→ worker             0.0s  (exit 0)

iteration 2/3
✓ test passed        0.1s

Converged in 2 iterations.
Loop evidence: .wringer/loops/20260730-234410-7c70/
```

Exit `0` converged · `1` stopped without converging · `2` config error ·
`3` refused · `4` interrupted. `wring run --json` emits one object with
`status`, `reason`, `iterations`, `loop_dir` and the last verify's `--json`.

The loop leaves its own evidence beside the run bundles, referencing rather
than swallowing them:

```
.wringer/loops/20260730-234410-7c70/
  manifest.json     summary.md     loop.jsonl
  iterations/001/{brief.md, worker.stdout.log, worker.stderr.log}
```

```
| iteration | verify | worker | evidence |
|---|---|---|---|
| 1 | failed (`test`) | exit 0 | `.wringer/runs/20260730-234410-9984` |
| 2 | passed | — | `.wringer/runs/20260730-234411-b2e7` |
```

Two rules worth knowing before you point it at a real agent:

- **A worker's exit code never ends the loop.** The evidence decides. A worker
  that crashed after fixing the bug converges on the next lap; one that exited
  cleanly having changed nothing stops with `no_progress` — and stops *without*
  re-running the gates, because an identical tree gives an identical answer.
- **`wring run` never touches git.** No commits, no branches, no pushes.
  Committing what came out is your decision.

`run:` needs Wringer 0.2+; a verify-only config stays valid forever.

## Not built yet

Everything above is real. This is **not implemented** and does not work if
you type it:

```bash
wring verify --changed-only  # gate only what changed
```

It is deliberately unbuilt: the spec names the flag but never defines what
"changed" should mean, and a flag that half-works is worse than a missing
one when agents consume the CLI. The release bar is the spec's
[Definition of PROVEN](docs/specs/SPEC_VERIFY_V0.md#definition-of-proven--the-repo-must-show-its-own-receipts),
and every line of it is ticked — including the PyPI publish, which landed
with 0.2.0 on 2026-08-03.

## Secrets

Gate output is captured, so a tool that echoes a token would otherwise write
it into the bundle. Before anything is written, Wringer erases the *values*
of environment variables whose *names* match `*TOKEN*`, `*SECRET*` or
`*KEY*`, replacing each with `[REDACTED]`. Add your own patterns — the
defaults always stay on:

```yaml
evidence:
  redact:
    env:
      - "*PASSWORD*"
      - "*_URL"
```

This catches secrets that live in the environment, which is where most of
them are. It cannot catch a credential your gate reads from a file and
prints, so keep reading a bundle before you share it — see
[SECURITY.md](SECURITY.md).

Two other bounds on what a bundle can become: each captured stream is capped
(the tail is kept, and the file says how much was dropped), and binary file
contents never enter `diff.patch`.

## What it will never do

Write code (the harness never writes code — agents do), replace your CI, or
send anything without a `--send` flag you typed — the five senders are listed
above. Evidence stays on your disk; `.wringer/` is gitignored by the template.
