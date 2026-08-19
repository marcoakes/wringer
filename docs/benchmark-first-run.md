# The benchmark's first real run — 2026-08-13

**This is evidence, not a spec.** It records what happened the first time a real
model went through `benchmark/harness.py`, including the parts that went wrong
and the part that makes the result undecidable. It is not rewritten; corrections
arrive as postscripts.

Contract: [specs/SPEC_BENCHMARK_V0.md](../SPEC_BENCHMARK_V0.md). The task was
`benchmark/tasks/smoke-real-agent.yaml`, which `benchmark/CORPUS.md` §5
deliberately keeps out of the corpus.

---

## The result

```
smoke-real-agent     a_native     true_confidence    agent stop_reason='end_turn'; held-out: 2 passed
smoke-real-agent     b_wringer    true_confidence    wring deliver would deliver this (dry run, exit 0); held-out: 2 passed
```

Both arms. Same fix, arrived at independently:

```diff
 def add(a, b):
-    return a + b + 1
+    return a + b
```

Arm A: 27.7s. Arm B: 25.4s (one 24.2s agent turn, converged in 2 iterations).
Arm B's agent reported **23,319 tokens and $0.135** — its own claim, unverified,
recorded verbatim in `usage.json`. Arm A's spend is **unrecorded**: the harness
does not read a `Turn`'s usage, which is a gap and not a zero.

## What this establishes, and it is smaller than it looks

**Established: the harness works with a real model at both ends.** Both arms
reached a real agent, the credential came out of the Keychain and into one child's
environment without ever being printed, the held-out test was copied forward into a
third tree and scored, the isolation checks passed, and a row landed on disk. That
had never happened before.

**NOT established: anything about the claim.** Both arms landed in the same cell,
so this task discriminates nothing between them. The agent did not need
supervising, so supervision bought nothing — which is the correct and expected
outcome for an easy task, and exactly what `CORPUS.md` §3 exists to prevent in a
real corpus:

> The corpus must contain tasks where a good agent plausibly declares success
> wrongly. A corpus of easy issues makes both arms score identically and the
> false-confidence cell — the one that decides the claim — is empty *by
> construction*.

This run is that failure mode, deliberately: a planted one-line bug in a repo we
own. It was built to prove the plumbing, and it did.

**A pointed contrast worth keeping.** The *scripted* demo tasks
(`demo-narrow.yaml`, `demo-covering.yaml`) do produce `false_confidence` and
`true_refusal`, because the scripted worker writes a tautological fix. The real
agent wrote the honest fix on the first attempt. So the two most interesting cells
this project has produced still come from a worker written to be dishonest, and
whether a real agent ever lands in them is unmeasured.

## Three defects, found by running it

The first attempt failed in three ways. All three are fixed; each is recorded
because the *shape* is what matters.

### 1. `wring deliver` crashed on an untracked latin-1 file — Wringer's defect

```
UnicodeDecodeError: 'utf-8' codec can't decode byte 0x8f in position 363
  File "src/wringer/git.py", line 278, in _git
  File "src/wringer/git.py", line 179, in diff_untracked
```

`git.py`'s `_git` used `text=True`, which decodes **strictly**. Git emits the
*contents* of files it considers text, and "text" to git means "no NUL in the first
8000 bytes" — which a latin-1 file satisfies while not being UTF-8 at all.

Two things make this worse than an ordinary crash. It is in the **one command that
writes git history**. And it exits **1** with a traceback, which is
indistinguishable from *"a required gate failed"* to anything reading exit codes —
so the harness recorded `false_refusal`: a refusal Wringer never made, entered as
a data point against it.

Reproduced with one file containing `café` in latin-1. A `.pyc` does **not**
reproduce it: git finds the NUL, calls it binary, and prints "Binary files
differ". Fixed by one `git.decode` helper with `errors="replace"`, and the class
was swept — `attest`, `deliver` and `acquire` all decoded git's bytes the same
strict way.

### 2. The harness gave ACP a relative `cwd` — the harness's defect

```
AcpError: session/new was refused: Invalid params: `cwd` must be an absolute
path, but received: benchmark/results/smoke-real-agent/a_native/tree
```

Arm A recorded VOID before it ever reached the agent. `--out` was relative, and
every path derived from it inherited that. Fixed by resolving `--out` once.

### 3. `build.sh` used a relative destination *after* `cd` — the fixture's defect

`build.sh agent benchmark/tasks/demo` planted the bare origin repository *inside*
the demo repo, because `DEST` was consumed after `cd "$REPO"`. Its zlib objects
then sat there as untracked non-UTF-8 files — which is what triggered defect 1.
Every earlier caller passed an absolute path, which is why nothing caught it.

Fixed by absolutising `DEST` before anything changes directory, and
`__pycache__/` joined the demo's `.gitignore` so a stray binary tree cannot ride
along into an arm again.

## And one finding that is nobody's defect

**The agent verified its own work with a stale `wring`.** Arm B's evidence
directory holds four run bundles. Two were written by the loop. The other two say:

```json
{"type": "run.started", "wringer_version": "0.2.0", ...}
```

The real agent, given a shell, ran `wring verify` to check itself — using
`~/.local/bin/wring` at **0.2.0**, while the harness drove this repo's 0.3.0. Those
two bundles are missing every sibling added since 0.2.0, `execution.json`
included, so they claim nothing about where their gates ran.

Not a Wringer bug: every 0.3.0 run wrote the file. It is an **environment** fact
with three lessons:

- `benchmark/preflight.py` already notes a shadowing `wring` on PATH, and this run
  is why that note is not cosmetic — an agent with a shell will use it.
- The mixture is **detectable**, because `wringer_version` has been in
  `run.started` since v1. The frozen schema earned its keep here.
- A reader of that directory cannot tell the vintages apart without opening
  `evidence.jsonl`. Nothing summarises it.

## What it cost

**$0.135 reported for arm B; arm A unrecorded.** The estimate in
`preflight.py` was $1–3, so this came in an order of magnitude under — on a
one-line bug, which is the cheapest possible task. It is not evidence about what a
corpus costs.

## What has still never been run

- **A corpus.** Nothing selected; `CORPUS.md`'s candidate table is empty.
- **A task hard enough to discriminate.** §3's rule is unexercised, and until it
  is, the claim in `SPEC_BENCHMARK_V0` §1 has not been tested once.
- **Arm A's spend.** The harness reads no usage from a `Turn`.

---

## Postscript, 2026-08-13 — the stale binary is gone

`~/.local/bin/wring` was a `uv tool install` from 2026-08-05 pinned at **0.2.0**,
and it is what the agent picked up off PATH to verify its own work.

Reinstalled **editable against this repository**
(`uv tool install --force --editable .`), so the binary on PATH is now the same
source tree as the one under test and cannot drift from it again — which a
re-pinned 0.3.0 snapshot would have done the moment the repo moved.

Verified rather than assumed: a `wring verify` in a fresh repo, run through
`~/.local/bin/wring`, records `wringer_version: 0.3.0` in `run.started` and
writes `execution.json` — the sibling whose absence was the original symptom.
