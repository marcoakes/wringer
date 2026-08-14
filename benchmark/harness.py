#!/usr/bin/env python3
"""The benchmark harness — one task, two arms, one row.

**This runs Wringer. It is not Wringer.** It lives outside `src/wringer/`
deliberately and is excluded from the distribution: nothing here may be imported
by the package, and the package must not need it. What it produces — the result
rows — is the most publishable thing this project would own, and also the only
thing here that could embarrass it.

---

## The claim, stated so it can lose

> **`delivery_eligible` is a better predictor of *actually correct* than *the
> agent says it is done*.**

Not "Wringer completes more tasks" — a refusing system completes fewer. Not
"Wringer's gates go green" — that is the thing under suspicion. It is a claim
about two predictors of a third, independent fact, and one table decides it:

|                          | held-out PASSES | held-out FAILS |
|--------------------------|-----------------|----------------|
| agent declared done      | true_confidence | **false_confidence** |
| Wringer says deliverable | true_confidence | **false_confidence** |

The number that decides the claim is the bottom-right cell against the
top-right. **The claim loses** if Wringer's false-confidence rate is not
materially lower, or if its false-refusal rate is high enough that the precision
is not worth the throughput. Both outcomes get published, and what gets published
on a loss is decided here, before any number exists: **the rows, whole, plus the
deviations, plus this file.**

## The circularity trap, which is the whole design problem

Wringer's own delivery decision must not define truth. If the evaluator asks
"did Wringer approve it", the experiment measures nothing.

So the independent signal is **upstream's own later tests** — the ones the
maintainers wrote for this issue, held out from everything. Genuinely
independent, because they were written by people who never saw the agent's
change.

**Its honest limit, which travels with every number this harness emits:** a
held-out suite measures agreement with upstream's fix, not satisfaction of the
requirement. A different-but-correct implementation fails it. That is a false
negative in the *ground truth itself*, and it inflates the measured
false-REFUSAL rate rather than the false-confidence rate — conservative in the
direction that matters and generous in the direction that flatters.

**The hard constraint, enforced rather than promised.** Held-out tests must not
be in the working tree, must not be reachable by any declared gate, and must not
be in any brief. If a worker can read them the experiment is over and the number
is worthless — the "worker writes its own success criterion" defect, moved up one
level to the benchmark itself. `check_isolation` refuses a task that breaks any
of those, before either arm runs, and `VOID` is a recorded outcome rather than a
footnote.

## What is NOT claimed about the two arms

**Both arms are handed the same statement.** Arm B then runs `wring run` over
what came back — which engages the repair loop only if the change broke a
declared gate — and asks `wring deliver` for a decision. So the arms differ in
supervision and in nothing else, which is what the claim is about.

That changed on 2026-08-13, forced by a zero-cost oracle run against the first
real corpus task. Arm B used to be `wring run` alone, whose brief is built from
FAILING gates. `CORPUS.md` §3 requires tasks where the repository's own gates do
not cover the issue — so those gates are green at base, `loop.run` verifies first
and stops at `converged`, and arm B would have run no agent at all, delivered
nothing, and scored `true_refusal` on every task that mattered. Wringer would
have won the benchmark by never attempting the work.

What still cannot be claimed: the arms are two INDEPENDENT draws from a
stochastic agent, so the difference between them mixes supervision with variance.
Every row carries that as a `deviation`, and the list is never empty.

Usage:

    python3 benchmark/harness.py --task benchmark/tasks/<t>.yaml --out results/
    python3 benchmark/harness.py --task ... --arm b     # one arm only
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

# The harness reads YAML because task files are hand-written and a human has to
# review a corpus. PyYAML is Wringer's one runtime dependency, so this adds
# nothing to the environment a contributor already needs.
import yaml

ARM_NATIVE = "a_native"
ARM_WRINGER = "b_wringer"
ARMS = (ARM_NATIVE, ARM_WRINGER)

# The four cells, named rather than derived at read time, so a row says what it
# means without the reader holding the 2x2 in their head.
TRUE_CONFIDENCE = "true_confidence"
FALSE_CONFIDENCE = "false_confidence"
TRUE_REFUSAL = "true_refusal"
FALSE_REFUSAL = "false_refusal"
# Not a cell. The task never ran, or ran and cannot be scored, so it contributes
# to NO rate — counting it anywhere would be inventing a data point.
VOID = "void"

RESULTS_FILENAME = "rows.jsonl"
# v2 adds `usage` — what each arm's agent reported it spent.
#
# A NEW VERSION rather than a field bolted onto v1, and the reason is law 7's
# even though this schema is not in `schema/frozen.json`: rows from the
# 2026-08-13 smoke run are already on disk claiming v1, and two files carrying
# the same version with different shapes is precisely the confusion freezing
# exists to prevent. The rule is cheap to obey here, so it is obeyed here.
#
# Why it went in before the corpus run and not after: a corpus costs $80-400
# and `CORPUS.md`'s table has a cost column. v1 recorded no spend on ANY row —
# arm A's was never read off the turn and arm B's sat unread inside the loop
# bundle — so a completed corpus would have produced one aggregate number off a
# credit-card statement and no per-task attribution at all.
# v3 adds `contamination` — what the agent went and read that it was not given.
#
# Bumped for the same reason v2 was, and this time it is load-bearing: the v2
# rows from the 2026-08-13 corpus run carry no contamination field, and NINE of
# the twenty-six carried a signal when the check was applied to them afterwards
# (four of those fetched upstream content outright). A reader must be able to tell
# "this row was checked and was clean" from "this row predates the check", and
# one version cannot say both.
SCHEMA_VERSION = "wringer.benchmark.v4"
PREVIOUS_SCHEMA_VERSIONS = (
    "wringer.benchmark.v1",
    "wringer.benchmark.v2",
    "wringer.benchmark.v3",
)

# Where each arm's spend lands, in the arm's own directory. Same filename and
# the same `totals` shape as `wringer.usage.v1` inside a loop bundle, so a
# reader who has seen one has seen both.
USAGE_FILENAME = "usage.json"

# What every number this harness emits does NOT say. Travels in each row, for the
# reason `bench.LIMITS` and `health.LIMITS` do: a benchmark is the artifact most
# likely to be read as a larger claim than it is, and a limit that lives only in
# a design document is a limit nobody reads.
LIMITS = (
    "The held-out suite measures agreement with UPSTREAM'S fix, not "
    "satisfaction of the requirement. A different-but-correct implementation "
    "fails it — a false negative in the ground truth itself, which inflates the "
    "measured false-refusal rate and not the false-confidence rate.",
    "Arm A's claim of completion is its EXIT CODE. An agent that exits 0 having "
    "done nothing is recorded as claiming success, because that is what a "
    "caller with no harness would believe.",
    "The arms are two INDEPENDENT draws from a stochastic agent given the same "
    "statement. The difference between them therefore mixes the supervision "
    "with the agent's own variance between draws, and one task cannot separate "
    "them.",
    "One attempt per arm per task. Agents are stochastic, so a single row is a "
    "draw and not a measurement — SPEC_ATTEMPTS_V0 is the same lesson one layer "
    "down.",
    "A void row contributes to no rate. Whoever picks the tasks can pick the "
    "result, so the selection rule and the excluded tasks must be published "
    "beside any number from this harness.",
    "Arm B counts a refusal only when `wring deliver` exited 1 — refused ON THE "
    "EVIDENCE. Exit 2 or 3 is a config or precondition problem and is VOID, "
    "because a constant refuser would otherwise score perfect precision on an "
    "accident of the machine.",
    "A Wringer CRASH is VOID and never a refusal. An unhandled exception also "
    "exits 1, so exit code alone cannot tell a verdict from a bug — and scoring "
    "a bug as a refusal enters a data point Wringer never earned.",
)


class TaskError(Exception):
    """The task file cannot be used (exit 2)."""


class Void(Exception):
    """The experiment for this task is void, and the row says why.

    Raised for exactly one class of problem: the held-out signal was reachable
    by something it must be invisible to. Not an error to be worked around — a
    void experiment is the honest outcome, and a harness that continued anyway
    would emit a number worth nothing.
    """


@dataclass(frozen=True)
class Agent:
    """A real coding agent, spoken to over ACP.

    **Both arms use this same invocation path**, and that is a deliberate
    reduction in deviations rather than an oversight. Arm A is "the agent alone"
    — no gates, no loop, no verification, no brief built from failures — and the
    transport it is reached through is a wire protocol, not supervision. Using
    two different CLIs for the two arms would have added a difference the
    experiment is not trying to measure.

    The credential is named, never held: `keychain_*` say where to ASK macOS for
    it, the value goes straight into one child's environment, and `wringer.acp`
    folds it into the redactor so it cannot reach a log.
    """

    command: str
    args: tuple[str, ...]
    env_passthrough: tuple[str, ...]
    keychain_service: str | None = None
    keychain_account: str | None = None
    keychain_env: str | None = None


@dataclass(frozen=True)
class Task:
    """One benchmark task, as a human wrote it down."""

    id: str
    repo: Path
    statement: str
    held_out_run: str
    # Files the held-out suite needs, copied in ONLY for scoring and never into
    # a tree an agent can see. `(source, destination)`: the source is relative to
    # the task file, the destination is relative to the tree.
    #
    # A DESTINATION exists because a real repository keeps its tests in
    # `tests/`, beside a `conftest.py` that its fixtures come from. Landing them
    # at the tree root — which is all v1 could do — collects a file with no
    # fixtures and scores the environment.
    held_out_files: tuple[tuple[Path, str], ...]
    # The test names upstream ADDED for this issue, when the held-out file is a
    # newer version of one the repo already has.
    #
    # **This is what makes the FAIL_TO_PASS shape possible at all.** Upstream
    # usually extends an existing test file rather than creating one, so the
    # destination legitimately exists at base, and refusing that (which is the
    # only thing v1 could do) restricts a corpus to the rare fix that invented a
    # whole new file — a small and badly biased subset. What must actually be
    # held out is not the FILE but these TESTS, and `check_isolation` enforces
    # exactly that: none of these names may appear anywhere in the tree.
    held_out_tests: tuple[str, ...]
    # Commits that must NOT be reachable in the arm's repository — in practice
    # the upstream fix this task is asking for.
    #
    # **The isolation hole that a real corpus run walked straight into.** A
    # `git clone` brings the whole history, so the working tree sits at the base
    # commit while the answer waits in `.git`, reachable by sha and usually by
    # tag. Every other isolation rule here looks at the working tree or at a
    # command string, and none of them can see an object store.
    forbidden_shas: tuple[str, ...]
    worker: str
    wall_clock: int
    max_iterations: int
    base_sha: str | None = None
    # None for a scripted task, which is what the two demo tasks are. Present
    # for a task that costs money.
    agent: Agent | None = None
    # The upstream project, e.g. "marshmallow-code/marshmallow". Used ONLY to
    # notice afterwards that an agent went and read it.
    upstream_repo: str | None = None

    @property
    def held_out_names(self) -> tuple[str, ...]:
        """Every string that would give the held-out signal away.

        Both the destination path AND its bare basename, because a gate command
        or a statement can name either and both are equally revealing. Plus the
        added test names, which are the actual signal when the file itself is
        one the repo already has.
        """
        names: list[str] = []
        for _, dest in self.held_out_files:
            names.append(dest)
            base = dest.rsplit("/", 1)[-1]
            if base != dest:
                names.append(base)
        return tuple(dict.fromkeys(names + list(self.held_out_tests)))


@dataclass
class Row:
    """One (task, arm) result. **Never asserts more than it measured.**"""

    schema_version: str
    task: str
    arm: str
    claimed: bool | None
    held_out_passed: bool | None
    cell: str
    reason: str
    wall_clock_ms: int
    # What the agent SAID it spent. Absent when it said nothing, and absent all
    # the way to the file — a zero here would be a number this harness invented
    # about somebody else's bill, which is the honest-absence rule the loop's
    # own usage record already follows.
    usage: dict[str, Any] | None = None
    # What the agent read that it was not given. Empty is the normal case and
    # is NOT a promise of cleanliness — it is the absence of a signal this
    # harness knows how to look for.
    contamination: list[str] = field(default_factory=list)
    deviations: list[str] = field(default_factory=list)
    evidence: dict[str, Any] = field(default_factory=dict)
    # The change itself, as a patch against `evidence.base_sha`.
    #
    # Until v4 a row recorded only where the tree WAS, and the tree is session
    # scratch. On 2026-08-14 the 52 published corpus rows described 52 changes
    # of which the repository held no copy; they were recovered from
    # /private/tmp with hours to spare and are in corpus/results/patches/. A
    # result that cannot show what was done is not a result anybody can check.
    #
    # None means no patch was captured. When `patch_error` is also None that is
    # the honest answer that the agent changed nothing — which happened, and
    # was scored `false_confidence` because it also claimed success.
    patch: str | None = None
    # Why there is no patch, when its absence is this harness malfunctioning
    # rather than an empty change. Never conflate the two: one is a measurement
    # and the other is a broken instrument.
    patch_error: str | None = None
    limits: list[str] = field(default_factory=lambda: list(LIMITS))


def load_task(path: Path) -> Task:
    """Read a task file, refusing anything underspecified.

    Every field is required. There are no defaults here on purpose: a benchmark
    whose budget or worker came from the harness rather than from the task file
    is a benchmark whose conditions nobody wrote down.
    """
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise TaskError(f"cannot read {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise TaskError(f"{path} is not a mapping")

    missing = [
        key
        for key in ("id", "repo", "statement", "held_out", "worker", "budget")
        if key not in raw
    ]
    if missing:
        raise TaskError(f"{path} is missing: {', '.join(missing)}")

    held_out = raw["held_out"]
    if not isinstance(held_out, dict) or "run" not in held_out:
        raise TaskError(f"{path}: 'held_out' needs a 'run' command")
    files = held_out.get("files") or []
    if not isinstance(files, list) or not files:
        raise TaskError(
            f"{path}: 'held_out.files' must list the test files to copy in for "
            "scoring. A held-out suite with no files is one that was already in "
            "the tree, which is the void this harness refuses"
        )
    # A bare string keeps v1's meaning exactly — land at the tree root under the
    # same basename — so every task written before this still loads unchanged.
    pairs: list[tuple[str, str]] = []
    for entry in files:
        if isinstance(entry, str):
            pairs.append((entry, Path(entry).name))
        elif isinstance(entry, dict) and "src" in entry:
            src = str(entry["src"])
            pairs.append((src, str(entry.get("dest") or Path(src).name)))
        else:
            raise TaskError(
                f"{path}: each 'held_out.files' entry is a path, or a mapping "
                f"with 'src' and optionally 'dest'. Got: {entry!r}"
            )
    for _, dest in pairs:
        if Path(dest).is_absolute() or ".." in Path(dest).parts:
            raise TaskError(
                f"{path}: held-out destination {dest!r} must be inside the "
                "tree. An absolute path or a '..' would write outside the copy "
                "being scored"
            )

    tests = held_out.get("tests") or []
    if not isinstance(tests, list) or not all(isinstance(t, str) for t in tests):
        raise TaskError(f"{path}: 'held_out.tests' must be a list of test names")

    upstream_repo = raw.get("upstream_repo")
    forbidden = raw.get("forbidden_shas") or []
    if not isinstance(forbidden, list) or not all(
        isinstance(x, str) for x in forbidden
    ):
        raise TaskError(f"{path}: 'forbidden_shas' must be a list of commit shas")

    budget = raw["budget"]
    if not isinstance(budget, dict):
        raise TaskError(f"{path}: 'budget' must be a mapping")
    for key in ("wall_clock", "max_iterations"):
        if not isinstance(budget.get(key), int) or budget[key] < 1:
            raise TaskError(f"{path}: 'budget.{key}' must be a positive integer")

    # `{python}` in a held-out command resolves to the interpreter running this
    # harness. Same reason the demo's gate takes one: a bare `python3` is whatever
    # PATH resolves to, and a scoring command that cannot import pytest scores the
    # environment rather than the change. A fresh-clone repro found this by
    # resolving `python3` to Xcode's.
    held_out_command = str(held_out["run"]).replace("{python}", sys.executable)

    agent = None
    raw_agent = raw.get("agent")
    if raw_agent is not None:
        if not isinstance(raw_agent, dict) or "command" not in raw_agent:
            raise TaskError(f"{path}: 'agent' needs a 'command'")
        keychain = raw_agent.get("keychain") or {}
        agent = Agent(
            command=str(raw_agent["command"]),
            args=tuple(str(a) for a in raw_agent.get("args") or ()),
            env_passthrough=tuple(
                str(n) for n in raw_agent.get("env_passthrough") or ()
            ),
            keychain_service=keychain.get("service"),
            keychain_account=keychain.get("account"),
            keychain_env=keychain.get("env"),
        )

    base = path.parent
    return Task(
        id=str(raw["id"]),
        repo=(base / str(raw["repo"])).resolve(),
        statement=str(raw["statement"]),
        held_out_run=held_out_command,
        held_out_files=tuple(
            ((base / src).resolve(), dest) for src, dest in pairs
        ),
        held_out_tests=tuple(tests),
        forbidden_shas=tuple(forbidden),
        upstream_repo=str(upstream_repo) if upstream_repo else None,
        worker=str(raw["worker"]),
        wall_clock=int(budget["wall_clock"]),
        max_iterations=int(budget["max_iterations"]),
        base_sha=str(raw["base_sha"]) if raw.get("base_sha") else None,
        agent=agent,
    )


# Directories whose contents are not the repository's source, and which a real
# clone makes expensive to walk. `.git` alone is thousands of files.
_NOT_SOURCE = {".git", ".venv", "venv", "__pycache__", ".mypy_cache",
               ".pytest_cache", ".ruff_cache", ".tox", "node_modules"}


def _tree_files(tree: Path) -> list[Path]:
    """Every source file in the tree, skipping the directories that are not it.

    Walked rather than globbed so `.git` can be pruned before it is descended
    into: on a real repository that is the difference between reading a hundred
    files and reading ten thousand.
    """
    found: list[Path] = []
    for parent, dirs, names in os.walk(tree):
        dirs[:] = [d for d in dirs if d not in _NOT_SOURCE]
        found.extend(Path(parent) / name for name in names)
    return found


def check_isolation(task: Task, tree: Path) -> None:
    """**The check that makes the whole experiment mean anything.**

    Raises `Void` when the held-out signal is reachable by something it must be
    invisible to. Three ways it can be, all of them checked rather than promised:

    1. the file is already IN the working tree — then it is not held out at all;
    2. a declared gate's command MENTIONS it — then Wringer's own verdict is
       partly the ground truth, which is the circularity trap;
    3. the task statement mentions it — then the agent is told the answer.

    A fourth is checked by construction rather than by inspection: the brief is
    built by `wring run` from failing gates, and a gate cannot name the held-out
    file without tripping (2).
    """
    for path, dest in task.held_out_files:
        if not path.is_file():
            raise TaskError(f"held-out file {path} does not exist")
        landing = tree / dest
        if landing.exists() and not task.held_out_tests:
            raise Void(
                f"the held-out file '{dest}' is already in the working "
                "tree, so it is not held out from anything. The worker can read "
                "the test it is being scored against, which is the 'worker "
                "writes its own success criterion' defect at the benchmark's "
                "own level"
            )

    # When the held-out file OVERWRITES one the repo already has, the file being
    # present is expected and the signal is the added tests. So the check moves
    # to them, and it is stricter than a filename comparison: the names must not
    # appear ANYWHERE in the tree — not in the file they will land in, not in a
    # neighbouring test, not in a fixture, not in a changelog that quotes them.
    if task.held_out_tests:
        for found in _tree_files(tree):
            try:
                text = found.read_text(encoding="utf-8", errors="replace")
            except OSError:  # pragma: no cover - unreadable is not readable
                continue
            for name in task.held_out_tests:
                if name in text:
                    raise Void(
                        f"the held-out test '{name}' already appears in the "
                        f"working tree ({found.relative_to(tree)}), so it is "
                        "not held out from anything. Whatever else it is, it is "
                        "not an independent signal"
                    )

    for sha in task.forbidden_shas:
        found = subprocess.run(
            ["git", "-C", str(tree), "cat-file", "-t", sha],
            capture_output=True, text=True,
        )
        if found.returncode == 0:
            raise Void(
                f"the commit this task is asking the agent to write ({sha[:12]}) "
                f"is REACHABLE in the arm's own repository — `git cat-file -t` "
                f"says {found.stdout.strip()!r}. The working tree is at the base "
                "commit and the answer is in .git, which is not held out from "
                "anything: an agent with a shell can read the diff, and one did"
            )

    config_path = tree / ".wringer.yaml"
    if config_path.is_file():
        try:
            declared = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        except yaml.YAMLError as exc:  # pragma: no cover - config.load reports it
            raise TaskError(f"{config_path} is not valid YAML: {exc}") from exc
        commands = [
            str(gate.get("run", ""))
            for gate in (declared or {}).get("gates", [])
            if isinstance(gate, dict)
        ]
        for name in task.held_out_names:
            for command in commands:
                if name in command:
                    raise Void(
                        f"a declared gate's command mentions the held-out file "
                        f"'{name}' ({command!r}), so Wringer's own verdict "
                        "would be partly the ground truth it is being measured "
                        "against. That is the circularity trap, and it makes "
                        "the number worthless"
                    )

    for name in task.held_out_names:
        if name in task.statement:
            raise Void(
                f"the task statement mentions '{name}', which is held out, so "
                "the agent is told which test it is scored against. Arm A would "
                "be reading the answer"
            )


def prepare_tree(task: Task, into: Path) -> Path:
    """A fresh copy of the task's repo for one arm.

    A COPY rather than a worktree: the two arms must not share a `.git`, and a
    worktree's `.git` is a file pointing back at one. The copy is what makes
    "same starting SHA, no shared mutable state" true across arms rather than
    hoped for.
    """
    tree = into / "tree"
    shutil.copytree(task.repo, tree, symlinks=True)
    # Any evidence the source tree happened to carry is not this arm's evidence.
    for stale in (tree / ".wringer",):
        if stale.is_dir():
            shutil.rmtree(stale)
    if task.base_sha:
        done = subprocess.run(
            ["git", "-C", str(tree), "checkout", "--detach", task.base_sha],
            capture_output=True, text=True,
        )
        if done.returncode != 0:
            raise TaskError(
                f"cannot check out {task.base_sha} in the copy: "
                f"{done.stderr.strip()}"
            )
    return tree


def head_sha(tree: Path) -> str:
    done = subprocess.run(
        ["git", "-C", str(tree), "rev-parse", "HEAD"],
        capture_output=True, text=True,
    )
    return done.stdout.strip() if done.returncode == 0 else ""


def score_held_out(task: Task, tree: Path, workdir: Path) -> tuple[bool, str]:
    """Run the held-out suite against what an arm produced.

    **In a THIRD copy**, made after the arm has finished, with the held-out files
    added. The arm's tree is never touched: copying forward means no arm can have
    seen these files even by accident, and the copy is kept as evidence.
    """
    scoring = workdir / "scoring"
    shutil.copytree(tree, scoring, symlinks=True)
    for path, dest in task.held_out_files:
        landing = scoring / dest
        landing.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, landing)

    done = subprocess.run(
        task.held_out_run,
        shell=True,
        cwd=scoring,
        capture_output=True,
        text=True,
        timeout=task.wall_clock,
    )
    (workdir / "held_out.stdout.log").write_text(done.stdout, encoding="utf-8")
    (workdir / "held_out.stderr.log").write_text(done.stderr, encoding="utf-8")
    tail = (done.stdout or done.stderr or "").strip().splitlines()
    return done.returncode == 0, (tail[-1] if tail else f"exit {done.returncode}")


# Wringer's published exit codes, which are what let this harness tell a
# refusal about the EVIDENCE from a refusal about the machine.
#
# **This distinction is the difference between a measurement and an advert**, and
# the demo found it the hard way: the first run of this harness scored arm B a
# `true_refusal` because the demo repo had no reachable `origin`, so
# `wring deliver` exited 3 before it ever looked at the evidence. A constant
# refuser scores perfect true-refusal on every failing task and perfect
# false-refusal on every passing one — precision bought by an accident, in the
# direction that flatters the claim under test.
WRINGER_OK = 0            # deliverable
WRINGER_EVIDENCE = 1      # refused ON THE EVIDENCE — the real measurement
WRINGER_CONFIG = 2        # config or environment: nothing was measured
WRINGER_PRECONDITION = 3  # refused a precondition: nothing was measured
# What a POSIX shell reports when it cannot find the command at all.
COMMAND_NOT_FOUND = 127


def keychain_argv(agent: Agent, *, reveal: bool) -> list[str]:
    """The `security` command line. `reveal=False` asks for METADATA only.

    Split out so the preflight can check PRESENCE without ever passing `-w`, the
    flag that prints the secret. A report that had to read the value to say it
    exists would be a report that could leak it into a terminal or a screenshot.
    """
    argv = ["security", "find-generic-password", "-s", agent.keychain_service or ""]
    if agent.keychain_account:
        argv += ["-a", agent.keychain_account]
    if reveal:
        argv.append("-w")
    return argv


def keychain_available() -> bool:
    """Whether macOS's `security` is here at all.

    **It is macOS-only**, and `subprocess.run` RAISES on a missing binary rather
    than returning non-zero — so without this check a Linux run died with a
    `FileNotFoundError` traceback instead of a message. Found by CI on
    `ubuntu-latest`, where the whole suite went red; macOS was green, which is
    exactly the shape a platform assumption has.
    """
    return shutil.which("security") is not None


def keychain_secret(agent: Agent) -> str | None:
    """The credential this agent needs, or None if it declared none.

    **Never printed, never written, never returned to a caller that logs.** It
    goes into one child's environment and nowhere else, and `wringer.acp` folds
    it into the redactor so an agent that echoes it cannot put it in a log. The
    value is not in this repository, not in a task file, and not in a shell
    history.

    Two sources, in this order, because the Keychain is macOS-only and a corpus
    run may well happen on Linux:

    1. **macOS Keychain**, asked at the moment it is needed;
    2. **an environment variable already set by the caller**, when there is no
       Keychain — the ordinary way on Linux and in CI.

    The order matters and is not a fallback chain to be extended casually: the
    Keychain wins where it exists, so a stale variable in a shell cannot quietly
    override the credential a person put in the OS keystore.
    """
    if not (agent.keychain_service and agent.keychain_env):
        return None

    if keychain_available():
        done = subprocess.run(
            keychain_argv(agent, reveal=True), capture_output=True, text=True
        )
        if done.returncode == 0 and done.stdout.strip():
            return done.stdout.strip()
        raise TaskError(
            f"no Keychain entry for service '{agent.keychain_service}'"
            + (f" account '{agent.keychain_account}'" if agent.keychain_account else "")
            + ". Add one with:  security add-generic-password -U -s "
            f"{agent.keychain_service} -a {agent.keychain_account or 'wringer'} -w"
        )

    # No Keychain: this is not macOS. The variable the task NAMES is the only
    # other place the value may come from, and it must already be set — nothing
    # here prompts, and nothing here reads a file.
    from_env = os.environ.get(agent.keychain_env)
    if from_env:
        return from_env
    raise TaskError(
        f"no macOS Keychain here (`security` is not on PATH), and "
        f"${agent.keychain_env} is not set. On Linux or in CI, export it "
        f"yourself before running; on macOS, add it to the Keychain with: "
        f"security add-generic-password -U -s {agent.keychain_service} "
        f"-a {agent.keychain_account or 'wringer'} -w"
    )


def agent_env(task: Task) -> dict[str, str]:
    """The environment an arm's child gets: this process's, plus the credential.

    A copy rather than a mutation of `os.environ`, so nothing else in this
    process — including anything that later writes a log — can read it back out.
    """
    environ = dict(os.environ)
    if task.agent is not None:
        secret = keychain_secret(task.agent)
        if secret is not None and task.agent.keychain_env:
            environ[task.agent.keychain_env] = secret
    return environ


def run_agent_alone(
    task: Task, tree: Path, workdir: Path
) -> tuple[bool | None, str]:
    """**Arm A with a real agent: one ACP turn, and nothing checks the result.**

    No gates, no loop, no verification, no brief built from failures. The agent
    is handed the task statement and its own turn, exactly as a person with no
    harness would.

    `wringer.acp.run_turn` is the transport, and using it is a deliberate
    reduction in deviations: both arms then reach the agent the same way, so the
    only differences left are what it is TOLD and whether anything checks what it
    did. Two different CLIs would have added a difference this experiment is not
    measuring. It also buys the redactor, so a credential the agent echoes cannot
    reach a log.

    The claim of completion is `turn.stop_reason == "end_turn"` — the agent
    saying it is finished, which is the closest thing arm A has to "the agent
    says it is done".
    """
    from wringer import acp
    from wringer.redact import Redactor

    agent = task.agent
    assert agent is not None
    secret = keychain_secret(agent)
    redactor = Redactor(secrets=(secret,) if secret else ())
    if secret and agent.keychain_env:
        # `acp.run_turn` builds the child's environment from the NAMES in
        # `env_passthrough`, read out of this process's environment — so the
        # value has to be here for the child to receive it. Set as late as
        # possible and never written anywhere: this harness process is
        # short-lived, and the redactor above covers every log the turn writes.
        os.environ[agent.keychain_env] = secret

    try:
        turn, code = acp.run_turn(
            command=agent.command,
            args=agent.args,
            env_passthrough=agent.env_passthrough,
            brief=task.statement,
            root=tree,
            timeout=task.wall_clock,
            stdout_path=workdir / "agent.stdout.log",
            stderr_path=workdir / "agent.stderr.log",
            redactor=redactor,
        )
    except Exception as exc:  # noqa: BLE001 - any failure here is VOID, not a claim
        return None, (
            f"the agent could not be run ({type(exc).__name__}: "
            f"{redactor.scrub(str(exc))}), so this arm measured nothing"
        )

    # What the agent said it spent, in the same shape and the same filename the
    # loop writes for arm B, so the two arms are read the same way. It is the
    # AGENT'S OWN CLAIM and `verified: false` says so — there is no price table
    # here, per SPEC_BENCH_V0 ruling 3, and an agent that reports nothing
    # produces no file rather than a zero somebody could add up.
    reported = getattr(turn, "usage", None)
    if reported is not None:
        from wringer import loop as loop_module

        row = reported.as_json()
        (workdir / USAGE_FILENAME).write_text(
            json.dumps(
                {
                    "schema_version": "wringer.usage.v1",
                    "reported_by": "agent",
                    "verified": False,
                    "rows": [{"iteration": 1, **row}],
                    "totals": loop_module.usage_totals([row]),
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

    reason = getattr(turn, "stop_reason", None)
    if code != 0 and reason is None:
        return None, (
            f"the agent exited {code} without completing a turn, so it claimed "
            "nothing"
        )
    claimed = reason == "end_turn"
    return claimed, f"agent stop_reason={reason!r}"


def run_native(task: Task, tree: Path, workdir: Path) -> tuple[bool | None, str]:
    """**Arm A: the agent, alone.** No gates, no loop, no harness.

    The statement goes in as `WRINGER_TASK_BRIEF`-shaped input the same way arm
    B's brief does — through a file the worker command can read — so the two arms
    differ in the CONTENT of what they are told rather than in the mechanism of
    being told.

    The claim of completion is the exit code, and that is a limit rather than a
    design: an agent that exits 0 having done nothing is recorded as claiming
    success, because that is what a caller with no harness would believe.
    """
    statement = workdir / "statement.md"
    statement.write_text(task.statement, encoding="utf-8")
    command = task.worker.replace("{brief}", str(statement))
    done = subprocess.run(
        command,
        shell=True,
        cwd=tree,
        capture_output=True,
        text=True,
        timeout=task.wall_clock,
        env=None,
    )
    (workdir / "worker.stdout.log").write_text(done.stdout, encoding="utf-8")
    (workdir / "worker.stderr.log").write_text(done.stderr, encoding="utf-8")
    if done.returncode == COMMAND_NOT_FOUND:
        # The agent never ran, so it claimed nothing. Recording this as "claims
        # failure" would put a row in the refusal column that no agent earned.
        return None, (
            f"the worker command could not be started (exit "
            f"{COMMAND_NOT_FOUND}), so this arm measured nothing"
        )
    return done.returncode == 0, f"agent exit {done.returncode}"


def do_the_work(task: Task, tree: Path, workdir: Path) -> tuple[bool | None, str]:
    """Somebody attempts the task in this tree. **Both arms come through here.**

    A real agent when the task names one, the scripted worker otherwise. Arm A
    stops at what this returns; arm B carries on into supervision. One function
    is what makes "the arms differ only in supervision" a fact about the code
    rather than a sentence in a document.
    """
    if task.agent is not None:
        return run_agent_alone(task, tree, workdir)
    return run_native(task, tree, workdir)


def run_under_wringer(
    task: Task, tree: Path, workdir: Path
) -> tuple[bool | None, str]:
    """**Arm B: the same agent, the same statement, and then supervision.**

    `delivery_eligible` is measured by ASKING WRINGER — a dry-run
    `wring deliver`, whose exit code is its actual decision. A reimplementation
    here would be a second opinion that could drift from the product, and the
    thing being measured is the product's decision.

    ## Why the agent runs FIRST, which changed on 2026-08-13

    Arm B used to be `wring run` alone, whose brief is built from failing gates.
    That works on the demo repo, where a planted bug makes the repo's own suite
    red at the base commit. **It cannot work on a corpus task**, and the oracle
    build proved it before a penny was spent: `CORPUS.md` §3 requires tasks where
    the repository's own gates do NOT cover the issue, so those gates are GREEN
    at base — and `loop.run` verifies before it does anything else and stops at
    `converged` without ever calling a worker.

    The consequence was not a small one. On exactly the tasks that decide the
    claim, arm B would have run no agent, produced a clean tree, been refused by
    `wring deliver` for having nothing to deliver, and scored `true_refusal`.
    Wringer would have "won" the benchmark by never attempting the work — an
    artifact of the harness, and the precise failure §1 names when it says a
    refusing system completes fewer.

    So the statement goes to the agent first, exactly as in arm A, and Wringer
    supervises what comes back: `wring run` (which engages the loop only if the
    change broke a gate — which IS the supervision, and is silent when there is
    nothing to say) and then the delivery decision.

    **This makes the experiment better, not merely possible.** The arms now
    differ ONLY in supervision. The prompt deviation that every v1 row had to
    carry — "arm B is given a brief built from failing gates" — is gone, because
    both arms are now given the same words.
    """
    # The identical call arm A makes, into arm B's own directory. A failure here
    # is VOID for the same reason it is in arm A: no claim was made. A scripted
    # task goes through the same door, which is what makes the zero-cost oracle
    # a faithful rehearsal of THIS arm rather than of a different one.
    attempted, why = do_the_work(task, tree, workdir)
    if attempted is None:
        return None, why

    ran = subprocess.run(
        [
            sys.executable, "-m", "wringer", "run",
            "--wall-clock", str(task.wall_clock),
        ],
        cwd=tree, capture_output=True, text=True, timeout=task.wall_clock * 2,
        # The credential reaches the child through its environment and nowhere
        # else. Wringer's own redactor keeps it out of the bundle, because the
        # repo's `run.worker.acp.env_passthrough` names it.
        env=agent_env(task),
    )
    (workdir / "run.stdout.log").write_text(ran.stdout, encoding="utf-8")
    (workdir / "run.stderr.log").write_text(ran.stderr, encoding="utf-8")

    # The loop already wrote what the agent reported, into its own bundle. Copy
    # it up beside arm A's so both arms answer "what did this cost" from the
    # same filename. The LAST loop's file wins: a tree can hold several loop
    # bundles, and only the one this arm just ran is this arm's spend.
    # **Arm B's spend is now two things: the agent's own turn and whatever the
    # loop spent afterwards.** Copying the loop's file over the turn's would
    # silently drop the larger half — the turn is where the work happens and the
    # loop is often silent — so they are MERGED and the totals recomputed.
    loops = sorted((tree / ".wringer" / "loops").glob("*/" + USAGE_FILENAME))
    if loops:
        from wringer import loop as loop_module

        rows: list[dict[str, Any]] = []
        for source in (workdir / USAGE_FILENAME, loops[-1]):
            if not source.is_file():
                continue
            try:
                rows.extend(
                    json.loads(source.read_text(encoding="utf-8")).get("rows") or []
                )
            except (OSError, ValueError):  # unreadable is the same as unreported
                continue
        if rows:
            (workdir / USAGE_FILENAME).write_text(
                json.dumps(
                    {
                        "schema_version": "wringer.usage.v1",
                        "reported_by": "agent",
                        "verified": False,
                        "rows": rows,
                        "totals": loop_module.usage_totals(rows),
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

    delivered = subprocess.run(
        [sys.executable, "-m", "wringer", "deliver", "--json"],
        cwd=tree, capture_output=True, text=True, timeout=task.wall_clock,
    )
    (workdir / "deliver.stdout.log").write_text(delivered.stdout, encoding="utf-8")
    (workdir / "deliver.stderr.log").write_text(delivered.stderr, encoding="utf-8")

    tail = (delivered.stderr or delivered.stdout or "").strip().splitlines()
    detail = " ".join(" ".join(tail).split())[:400] or str(delivered.returncode)

    if delivered.returncode == WRINGER_OK:
        return True, "wring deliver would deliver this (dry run, exit 0)"
    if delivered.returncode == WRINGER_EVIDENCE:
        # **A CRASH IS NOT A REFUSAL**, and exit 1 alone cannot tell them apart:
        # an unhandled Python exception also exits 1. The first real agent run
        # recorded `false_refusal` for a `UnicodeDecodeError` in `git.py` — a
        # refusal Wringer never made, entered as a data point against it.
        #
        # Sniffing for a traceback is text-matching, which this harness refuses
        # to do to a GATE's output. It is different here: this is Wringer's own
        # crash signature, in a tool we own, and the alternative is silently
        # scoring bugs as verdicts.
        if "Traceback (most recent call last)" in (delivered.stderr or ""):
            last = [
                line for line in (delivered.stderr or "").strip().splitlines()
                if line.strip()
            ]
            return None, (
                "`wring deliver` CRASHED rather than deciding — "
                f"{last[-1] if last else 'unknown exception'}. That is a defect "
                "in Wringer, not a verdict about the change, so this arm "
                "measured nothing"
            )
        # The measurement. Wringer looked at the evidence and said no.
        return False, f"wring deliver refused on the evidence: {detail}"
    if ran.returncode in (WRINGER_CONFIG, WRINGER_PRECONDITION):
        return None, (
            f"`wring run` could not run here (exit {ran.returncode}), so this "
            f"arm measured nothing: {detail}"
        )
    # Exit 2 or 3 from deliver: config, or a precondition like an unreachable
    # remote. Wringer never reached its evidence decision, so scoring this as a
    # refusal would credit the harness for an accident of the machine.
    return None, (
        f"wring deliver never reached its evidence decision (exit "
        f"{delivered.returncode}) — a config or precondition problem, not a "
        f"verdict about the change: {detail}"
    )


def usage_of(workdir: Path) -> dict[str, Any] | None:
    """What the arm's agent reported, if it reported anything.

    Total by construction: an unreadable or malformed file is the same answer
    as no file, because a benchmark that guessed at a cost would be worse than
    one that admits it does not know. The raw file stays on disk either way.
    """
    path = workdir / USAGE_FILENAME
    if not path.is_file():
        return None
    try:
        totals = json.loads(path.read_text(encoding="utf-8")).get("totals")
    except (OSError, ValueError):
        return None
    return totals if isinstance(totals, dict) else None


def contamination(task: Task, workdir: Path) -> list[str]:
    """What the agent went and read that it was not given. **Detected, because
    it cannot be prevented.**

    The agent has a shell and a network, and it needs the network to reach its
    own API — so there is no way from here to stop it opening the upstream
    repository this task was cut from. Every task built from public history has
    this hole, and the honest response is the one this project applies to
    container escapes: if you cannot prevent it, record that it happened, and
    never let silence be read as absence.

    The 2026-08-13 corpus run is why. Agents fetched `<fix>.patch` — which
    contains the held-out test file — pulled post-fix copies of the very source
    file they had to change, and ran `git log --all --grep` to find the fix
    commit by subject. One arm's change came back byte-identical to upstream's.
    None of it was visible in the rows.
    """
    signals: list[str] = []
    for name in ("agent.stdout.log", "agent.stderr.log", "worker.stdout.log"):
        log = workdir / name
        if not log.is_file():
            continue
        text = log.read_text(encoding="utf-8", errors="replace")
        for sha in task.forbidden_shas:
            # Any prefix long enough to be a deliberate reference.
            if sha[:8] in text:
                signals.append(
                    f"the fix commit {sha[:12]} is quoted in {name} — the agent "
                    "found the answer"
                )
        # **Only when the STATEMENT did not already name it.** An independent
        # review pointed out on 2026-08-14 that 12 of 13 corpus statements name
        # the upstream slug in upstream's own prose — so an agent that merely
        # quotes its own brief back tripped this, and the published counts were
        # upper bounds inflated by brief-echo rather than measurements. The
        # docstring says "what the agent went and read THAT IT WAS NOT GIVEN",
        # and this is the line that has to honour it.
        given = task.upstream_repo is not None and task.upstream_repo in task.statement
        if task.upstream_repo and task.upstream_repo in text and not given:
            signals.append(
                f"the upstream repository {task.upstream_repo} is named in "
                f"{name} and NOT in the statement, so the agent found it"
            )
        for needle, why in (
            # The local route, added after a review reproduced it: one
            # `git fetch` at the URL `.git/FETCH_HEAD` records brings the whole
            # history back, fix commit included.
            ("FETCH_HEAD", "read .git/FETCH_HEAD, which names the full-history "
                           "mirror this tree was cut from"),
            ("wringer-corpus/mirrors", "named the corpus mirror, which has the "
                                       "whole history including the fix"),
            ("git fetch", "ran `git fetch`, which can re-open a truncated "
                          "history"),
            (".patch", "fetched a patch"),
            ("patch-diff.githubusercontent.com", "fetched a PR diff"),
            ("raw.githubusercontent.com", "fetched a file from GitHub"),
        ):
            if needle in text:
                signals.append(f"{why} ({needle} appears in {name})")
    return sorted(set(signals))


def classify(claimed: bool, held_out_passed: bool) -> str:
    """The 2x2, and nothing else. No weighting, no score, no aggregate."""
    if claimed and held_out_passed:
        return TRUE_CONFIDENCE
    if claimed and not held_out_passed:
        return FALSE_CONFIDENCE
    if not claimed and not held_out_passed:
        return TRUE_REFUSAL
    return FALSE_REFUSAL


def change_patch(tree: Path, base_sha: str) -> tuple[str | None, str | None]:
    """The arm's change as a patch against `base_sha`, and why not, if not.

    **Staging is the whole point.** Part of a real agent change is untracked —
    a new test file, a new `changelog.d/` fragment — and `git diff` alone is
    silent about content git has never seen. `deliver.py` learned this once
    already: a change made entirely of new files rendered an empty patch, so
    approving it meant approving nothing. A benchmark row that dropped the
    agent's new tests would understate every change it recorded.

    So everything is staged and diffed from the index — but into a THROWAWAY
    index under `GIT_INDEX_FILE`, never the tree's own. The tree is the
    evidence an arm leaves behind and the next thing to touch it is a human
    reading it; a harness that rewrote the index while recording would be
    editing its own exhibit. `deliver.py` reaches for `--no-index` for the same
    reason, and this reaches for a scratch index because it wants ONE patch
    that `git apply` accepts rather than a concatenation of per-file diffs.

    Returns `(patch, error)`. `(None, None)` is the honest empty change.
    """
    index = tree.parent / ".harness-patch-index"
    env = {**os.environ, "GIT_INDEX_FILE": str(index)}
    try:
        for argv in (
            ["git", "-C", str(tree), "read-tree", base_sha],
            ["git", "-C", str(tree), "add", "-A"],
        ):
            step = subprocess.run(argv, capture_output=True, text=True, env=env)
            if step.returncode != 0:
                return None, f"{' '.join(argv[3:])}: {step.stderr.strip()[:200]}"
        done = subprocess.run(
            ["git", "-C", str(tree), "diff", "--cached", "--binary",
             "--no-color", "--no-ext-diff", base_sha],
            capture_output=True, text=True, errors="replace", env=env,
        )
        if done.returncode != 0:
            return None, f"diff --cached: {done.stderr.strip()[:200]}"
    except OSError as exc:
        return None, f"git unavailable: {exc}"
    finally:
        # A stale scratch index left beside the tree would be read as part of
        # the evidence by whoever opens the workdir next.
        index.unlink(missing_ok=True)
    return (done.stdout or None), None


def deviations_for(arm: str) -> list[str]:
    """**Never empty.** Every arm deviates from "identical conditions" somewhere,
    and a row that listed none would be the overclaim this harness exists to
    avoid."""
    shared = [
        "one attempt only — agents are stochastic and a single row is a draw",
        "the two arms are two INDEPENDENT agent runs from the same statement, "
        "so the difference between them mixes the supervision with the "
        "agent's own variance between draws",
    ]
    if arm == ARM_NATIVE:
        return shared + [
            "claim of completion is the agent's own end of turn, which is the "
            "strongest signal a caller without a harness has",
            "nothing runs the repository's tests in this arm — that is the "
            "point of it, and it is also why this arm is cheaper",
        ]
    return shared + [
        "claim of completion is a dry-run `wring deliver` exit code, which is "
        "the product's own decision rather than a reimplementation of it",
        "the loop engages only when the change broke a declared gate. On a task "
        "whose gates were green at base and stayed green, arm B's supervision "
        "is the DELIVERY DECISION alone and no repair happened",
    ]


def run_arm(task: Task, arm: str, out: Path) -> Row:
    """One arm, end to end, into its own directory."""
    workdir = out / task.id / arm
    workdir.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()

    tree = prepare_tree(task, workdir)
    try:
        check_isolation(task, tree)
    except Void as exc:
        return Row(
            schema_version=SCHEMA_VERSION,
            task=task.id, arm=arm, claimed=None, held_out_passed=None,
            cell=VOID, reason=str(exc),
            wall_clock_ms=int((time.monotonic() - started) * 1000),
            deviations=deviations_for(arm),
        )

    sha = head_sha(tree)
    if arm == ARM_NATIVE:
        claimed, claim_reason = do_the_work(task, tree, workdir)
    else:
        claimed, claim_reason = run_under_wringer(task, tree, workdir)

    if claimed is None:
        # The arm never produced a claim, so there is nothing to put in the
        # table. The held-out suite is deliberately NOT run: a cell needs both
        # coordinates, and half a row invites somebody to fill in the other half.
        patch, patch_error = change_patch(tree, sha)
        return Row(
            schema_version=SCHEMA_VERSION,
            task=task.id, arm=arm, claimed=None, held_out_passed=None,
            cell=VOID, reason=claim_reason,
            wall_clock_ms=int((time.monotonic() - started) * 1000),
            # A VOID arm still costs money — an agent that ran and then
            # produced no claim was PAID for the turn, and a corpus total that
            # skipped those rows would understate the bill.
            usage=usage_of(workdir),
            contamination=contamination(task, workdir),
            deviations=deviations_for(arm),
            evidence={"tree": str(tree), "base_sha": sha,
                      "workdir": str(workdir)},
            # A VOID arm leaves a change on disk the same as any other, and
            # what an agent did before it failed to claim anything is often the
            # most interesting thing in the row.
            patch=patch, patch_error=patch_error,
        )

    # **ISOLATION AGAIN, NOW THAT THE ARM HAS FINISHED.**
    #
    # The first check proves only that the answer was unreachable when the arm
    # STARTED. An agent with a shell can make it reachable while it works — and
    # on the 2026-08-13 corpus exactly one line was needed, because
    # `.git/FETCH_HEAD` still named the full-history mirror the tree was cut
    # from. That hole is narrowed now, and a narrowed hole that is checked once
    # at the start is still an unchecked hole.
    #
    # A run that ends with the answer in its own repository did not measure the
    # agent, whatever the held-out tests then say, so it is VOID rather than a
    # cell.
    try:
        check_isolation(task, tree)
    except Void as exc:
        patch, patch_error = change_patch(tree, sha)
        return Row(
            schema_version=SCHEMA_VERSION,
            task=task.id, arm=arm, claimed=None, held_out_passed=None,
            cell=VOID,
            reason=f"AFTER the arm ran: {exc}",
            wall_clock_ms=int((time.monotonic() - started) * 1000),
            usage=usage_of(workdir),
            contamination=contamination(task, workdir),
            deviations=deviations_for(arm),
            evidence={"tree": str(tree), "base_sha": sha,
                      "workdir": str(workdir)},
            # Kept precisely BECAUSE the row is void: a change made by an arm
            # that reached the answer is the exhibit for how it reached it.
            patch=patch, patch_error=patch_error,
        )

    passed, held_reason = score_held_out(task, tree, workdir)
    # From the ARM's tree, which scoring never touches — it copies forward into
    # `scoring/` and adds the held-out files there. So a row's patch cannot
    # contain upstream's tests no matter when this runs, and the one thing a
    # reader would suspect a self-recorded patch of is structurally impossible.
    patch, patch_error = change_patch(tree, sha)
    return Row(
        schema_version=SCHEMA_VERSION,
        task=task.id,
        arm=arm,
        claimed=claimed,
        held_out_passed=passed,
        cell=classify(claimed, passed),
        reason=f"{claim_reason}; held-out: {held_reason}",
        wall_clock_ms=int((time.monotonic() - started) * 1000),
        usage=usage_of(workdir),
        contamination=contamination(task, workdir),
        deviations=deviations_for(arm),
        evidence={
            "tree": str(tree),
            "base_sha": sha,
            "workdir": str(workdir),
        },
        patch=patch,
        patch_error=patch_error,
    )


def write_rows(out: Path, rows: list[Row]) -> Path:
    """Append the rows. **Append, never rewrite**: a corpus run is resumable and
    a harness that truncated its own results on a second invocation would lose
    the expensive half of the experiment."""
    out.mkdir(parents=True, exist_ok=True)
    path = out / RESULTS_FILENAME
    with path.open("a", encoding="utf-8") as stream:
        for row in rows:
            stream.write(json.dumps(asdict(row)) + "\n")
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run one benchmark task through both arms and write a row.",
    )
    parser.add_argument("--task", required=True, help="the task YAML file")
    parser.add_argument("--out", required=True, help="where rows and evidence go")
    parser.add_argument(
        "--arm", choices=("a", "b", "both"), default="both",
        help="run one arm only (default: both)",
    )
    args = parser.parse_args(argv)

    try:
        task = load_task(Path(args.task))
    except TaskError as exc:
        print(f"harness: {exc}", file=sys.stderr)
        return 2

    wanted = {
        "a": [ARM_NATIVE], "b": [ARM_WRINGER], "both": list(ARMS),
    }[args.arm]
    # RESOLVED, because ACP refuses a relative `cwd`: `session/new` returned
    # "Invalid params: `cwd` must be an absolute path" and arm A recorded VOID on
    # the first real agent run. Every path derived from `--out` inherits this.
    out = Path(args.out).resolve()

    rows: list[Row] = []
    for arm in wanted:
        try:
            rows.append(run_arm(task, arm, out))
        except (TaskError, subprocess.SubprocessError, OSError) as exc:
            print(f"harness: {task.id} {arm}: {exc}", file=sys.stderr)
            return 2

    path = write_rows(out, rows)
    for row in rows:
        print(f"{row.task:<20} {row.arm:<12} {row.cell:<18} {row.reason}")
    print(f"\nRows appended to {path}")
    if any(row.cell == VOID for row in rows):
        # Exit 1, loudly. A void experiment that exited 0 would be counted as a
        # run by whoever aggregates, and the whole point of naming it is that it
        # contributes to no rate.
        # Generic, because there are TWO kinds of void and this line named
        # only one of them: the held-out signal being reachable, and an arm
        # never reaching a claim at all. Each row's `reason` says which; a
        # summary line that guessed would send a reader to the wrong fix.
        print(
            "\n! VOID — an arm produced no usable measurement. This task "
            "contributes to no rate; read each row's reason for why.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - the entry point
    raise SystemExit(main())
