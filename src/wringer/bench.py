"""`wring bench` — the same job, every declared worker, independently.

**It measures. It does not crown.** (docs/specs/SPEC_BENCH_V0.md, ruling 6.) There is no
winner here, no score, and no field in any schema that orders contenders — not
as a hedge, but because the one fact that would justify a ranking is precisely
the fact this machinery cannot establish. A contender that "fixes" a planted
failing test by rewriting it into a tautology produces green gates and, with
HEAD unmoved, a `proven` vacuity verdict — SPEC_VACUITY_V0 §5a's stated blind
spot — and it converges FASTER than an honest fix. An auto-ranked bench would
systematically reward reward-hacking, in the product built to catch it. So the
rows are rendered in declared order, the limits are printed beside them, and
the reader ranks with the diffs in front of them.

Everything else in this module exists to make the rows comparable, which is
the only claim it does make:

- **a red baseline**, because a benchmark of repair needs something to repair;
- **one common tree**, checked rather than assumed;
- **identical ceilings**, handed to `loop.run` rather than computed and
  admired;
- **isolation that outlives the bench**, because the evidence lives inside it.

It wraps and never reimplements: `loop.run` in process (ruling 2), the fleet's
own `make_worktree`, `verify.run` for the baseline, `vacuity`'s setup contract
for the bare-worktree trap.

**Serial remains the default, and it is still measurement hygiene rather than a
missing feature**: parallel contenders on one machine contend for CPU, IO and
the network, and wall-clock is a primary column. `bench.parallel` lets a repo
spend that column to buy elapsed time, and the artifact then says the column is
contended rather than leaving a reader to compare numbers that cannot be
compared (SPEC_ATTEMPTS_V0).

**`bench.attempts` is what closes this module's own first stated limit** — *"one
run per contender; agents are stochastic; a difference within noise is noise."*
N independent attempts per contender, each with its own worktree, its own loop
bundle and its own ledger, all from one checked baseline under one ceiling. What
that buys is not a ranking: it is whether a contender agrees with ITSELF, which
is the agent's own nondeterminism made visible — the same finding a flaky gate
is one level down. Across contenders there is still no comparison, and
*"insufficient to rank these"* stays a valid and expected answer.
"""

from __future__ import annotations

import dataclasses
import json
import shutil
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from wringer import config, evidence, fleet, gates, git, loop, vacuity, verify
from wringer.redact import Redactor

BENCHES_DIRNAME = Path(".wringer") / "benches"
# **v2, and v1 is still published and still frozen** — the `untracked-v2` and
# `wringer.loop.v2` precedent. v1's contender rows are `additionalProperties:
# false` and its description says "one row per contender", both of which are
# true only of a bench making ONE attempt each. `bench.attempts` makes N
# independent attempts per contender, so a row needs to say which attempt it is
# — and a bench with six rows for two contenders is not a v1 document however
# permissively you read one.
#
# With `attempts: 1` — every bench that shipped — the rows are byte-identical to
# v1's apart from the version string: `attempt` is absent, because a number that
# is always 1 is noise in the one artifact a stranger reads.
SCHEMA_VERSION = "wringer.bench.v2"
# Every version a reader accepts, DERIVED here rather than named at each reader.
# `health._KINDS` is keyed off this, and a bump that forgot it would make health
# forget every bench already on disk — wordlessly, which is the failure mode
# health exists to catch (SPEC_ENV_V0 §3's finding D3, met once already this
# release by the loop bump).
SCHEMA_VERSIONS = (SCHEMA_VERSION, "wringer.bench.v1")
EVENTS_FILENAME = "bench.jsonl"
MANIFEST_FILENAME = "manifest.json"
SUMMARY_FILENAME = "summary.md"

# What the artifact says about itself, so a reader who found it without the
# spec still knows how large the claim is. Ruling 6 calls this the place the
# blind spot is stated; it is not decoration, and a test pins each entry.
LIMITS = (
    "One run per contender. Agents are stochastic; a difference within "
    "noise is noise.",
    "Usage and cost are the agent's own report, unverified. Absent means "
    "unreported, never zero.",
    "A green gate proves the gates went green, not that the fix is honest — "
    "read the diffs before believing any row.",
)


# What a bench with repeats or parallelism does NOT claim, appended to LIMITS
# only when the thing they qualify actually happened. Not folded into `LIMITS`
# itself: a limit about attempts printed on a single-attempt bench is a sentence
# a reader learns to skip, and this file's whole argument is that the limits are
# the part they must not skip.
ATTEMPT_LIMIT = (
    "Repeated attempts are independent draws from a stochastic process. Two "
    "attempts by the same contender disagreeing is the agent's own "
    "nondeterminism, measured — not evidence that either attempt is the better "
    "implementation. There is no field here that ranks them and no method here "
    "that could."
)
PARALLEL_LIMIT = (
    "These attempts ran CONCURRENTLY, so wall_clock_ms is contended and rows "
    "may not be compared on it. It records elapsed time under load, which is "
    "not the same quantity a serial bench records. Attempts also appear in the "
    "ledger in declared order rather than completion order, because the ledger "
    "is written by one thread — the `prev_hash` chain is what that protects."
)


# `LIMITS[0]` says "One run per contender", which is FALSE the moment
# `bench.attempts` is more than one — and it was being printed directly above the
# new limit that contradicted it. A stale claim beside its own correction is the
# drift this repository hunts, so the sentence is REPLACED rather than
# accompanied.
SINGLE_RUN_LIMIT = LIMITS[0]
REPEATED_RUNS_LIMIT = (
    "Each contender ran more than once. Agents are stochastic, so these rows "
    "are independent draws rather than one measurement each — read them "
    "together, and read a difference between two attempts by the same "
    "contender as that contender's own noise."
)


def attempt_limits(cfg_bench: config.Bench) -> tuple[str, ...]:
    """The limits that only apply when repeats or parallelism actually ran."""
    extra: list[str] = []
    if cfg_bench.attempts > 1:
        extra.append(ATTEMPT_LIMIT)
    if cfg_bench.parallel > 1:
        extra.append(PARALLEL_LIMIT)
    return tuple(extra)


def limits_for(cfg_bench: config.Bench | None) -> tuple[str, ...]:
    """Every limit this bench's artifact should carry, with none of them false.

    One SUBSTITUTION and then additions: a bench that made three attempts each
    must not print "one run per contender" — that is the same class of defect as
    a stale count in a document, committed by the file whose whole argument is
    that the limits are the part a reader must not skip.
    """
    if cfg_bench is None:
        return LIMITS
    base = list(LIMITS)
    if cfg_bench.attempts > 1:
        base[0] = REPEATED_RUNS_LIMIT
    return tuple(base) + attempt_limits(cfg_bench)


def agreement(rows: tuple[Row, ...]) -> tuple[str, str]:
    """Whether a contender's repeated attempts agreed, and what that is worth.

    **This is the only comparison this module makes, and it compares a
    contender with ITSELF.** Across contenders there is no comparison and never
    will be (ruling 6). Within one contender, repeated attempts either reached
    the same outcome or did not, and that is an observed fact about the agent
    rather than a judgement about any implementation it produced.

    Returns `(verdict, sentence)`. The verdict is deliberately not a score:
    `insufficient` is a valid and expected answer and is the default, because
    one attempt each cannot disagree with anything.
    """
    by_contender: dict[str, set[str]] = {}
    for row in rows:
        if row.attempt is None:
            continue
        by_contender.setdefault(row.contender, set()).add(row.outcome)
    if not by_contender:
        return (
            "insufficient",
            "One attempt each, so nothing here can agree or disagree with "
            "anything. The evidence is insufficient to rank these, which is "
            "the expected answer and not a shortfall.",
        )
    disagreed = sorted(name for name, seen in by_contender.items() if len(seen) > 1)
    if not disagreed:
        return (
            "consistent",
            "Every contender's attempts reached the same outcome as each "
            "other. That says the agent was consistent here; it says nothing "
            "about which contender is better, and the evidence is still "
            "insufficient to rank them.",
        )
    named = ", ".join(f"`{name}`" for name in disagreed)
    return (
        "inconsistent",
        f"{named} reached DIFFERENT outcomes across attempts on the same tree "
        "from the same commit under the same ceiling. Nothing in the inputs "
        "explains the difference, so it is the agent's own nondeterminism — "
        "the same finding a flaky gate is one level down. A single run of "
        "these contenders would have reported one of those outcomes as though "
        "it were the answer.",
    )


class BenchError(Exception):
    """The bench cannot run: config or environment (CLI exit code 2)."""


class NothingToMeasure(Exception):
    """The baseline is green, so there is no work to compare (exit code 1).

    Carries the baseline bundle's path: the refusal writes no bench bundle,
    but the verify really ran and its evidence is the answer to *why* there
    was nothing to measure. A refusal that threw that away would be asking
    the reader to take its word.
    """

    def __init__(self, reason: str, evidence_path: str, cleanup: str = "") -> None:
        super().__init__(reason)
        self.reason = reason
        self.evidence_path = evidence_path
        # The refusal made a worktree and kept it, because the bundle inside
        # it is the evidence. Keeping it SILENTLY would leave a directory the
        # reader never asked for and cannot find — so the line that reclaims
        # it is printed, and never run.
        self.cleanup = cleanup


@dataclass(frozen=True)
class Row:
    """One contender's result. **No field here orders anything.**"""

    contender: str
    agent_id: str | None
    outcome: str  # a loop reason, or "error"
    reason: str
    iterations: int
    wall_clock_ms: int
    loop_ref: str
    # Whether the worker moved its worktree's HEAD. The harness never writes
    # git history, but a worker is somebody else's agent and may commit — and
    # every tree-anchored verdict in this row is then relative to a tree the
    # agent moved (ruling 6).
    head_moved: bool
    # The VERIFY bundle the loop's last verification wrote, relative to the
    # repo root. Not the loop directory: `wring judge` reads a verify bundle's
    # manifest and gate results, so a next-action naming the loop would be
    # advice that cannot be taken — and the summary prints exactly this line.
    final_run: str = ""
    usage: dict[str, Any] | None = None
    # Which independent attempt this is, 1-based — or **None when the bench made
    # one attempt each**, which is every bench that shipped. Two states rather
    # than a number that is sometimes noise: `None` is omitted from the record,
    # so a single-attempt bench's rows carry exactly the keys v1 published, and
    # an int is always written, so attempt 1 of three is never mistaken for the
    # only one.
    attempt: int | None = None

    def as_json(self) -> dict[str, Any]:
        recorded: dict[str, Any] = {
            "contender": self.contender,
            "outcome": self.outcome,
            "reason": self.reason,
            "iterations": self.iterations,
            "wall_clock_ms": self.wall_clock_ms,
            "loop_ref": self.loop_ref,
            "head_moved": self.head_moved,
        }
        if self.final_run:
            recorded["final_run"] = self.final_run
        if self.agent_id:
            recorded["agent"] = self.agent_id
        if self.usage is not None:
            recorded["usage"] = self.usage
        # Present exactly when the bench made more than one attempt each.
        if self.attempt is not None:
            recorded["attempt"] = self.attempt
        return recorded


@dataclass(frozen=True)
class Outcome:
    directory: Path
    rows: tuple[Row, ...]
    baseline_sha: str
    baseline_ref: str


@dataclass(frozen=True)
class Bundle:
    """A bench's evidence — `.wringer/benches/<bench_id>/`.

    Like every other bundle here it owns the redactor, so a write path cannot
    skip scrubbing by the author forgetting. Loop and verify bundles are
    referenced by path and never nested: one run, one bundle, one place.
    """

    directory: Path
    bench_id: str
    started_at: datetime
    redactor: Redactor = Redactor()

    @classmethod
    def create(
        cls,
        benches_root: Path,
        bench_id: str,
        started_at: datetime,
        redactor: Redactor | None = None,
    ) -> Bundle:
        """Created at a KNOWN id, not one allocated here.

        The id exists before the bundle does, because it names the worktrees —
        and the worktrees are made before the baseline is known to be red,
        while a green baseline must still write no bench bundle at all.
        """
        try:
            benches_root.mkdir(parents=True, exist_ok=True)
            directory = benches_root / bench_id
            directory.mkdir(exist_ok=False)
        except OSError as exc:
            raise BenchError(f"cannot create {benches_root / bench_id}: {exc}") from exc
        return cls(
            directory=directory,
            bench_id=bench_id,
            started_at=started_at,
            redactor=redactor or Redactor(),
        )

    def event(self, event_type: str, **fields: Any) -> None:
        """Append one chained, scrubbed line. The ledger is the truth."""
        scrubbed = evidence.deep_scrub(self.redactor, fields)
        path = self.directory / EVENTS_FILENAME
        line = json.dumps(
            {
                "type": event_type,
                "ts": evidence.timestamp(),
                "prev_hash": evidence.chain_head(path),
                **scrubbed,
            }
        )
        with path.open("a", encoding="utf-8") as stream:
            stream.write(line + "\n")

    def write_manifest(
        self,
        cfg_bench: config.Bench,
        baseline_sha: str,
        baseline_ref: str,
        failing_gates: tuple[str, ...],
        rows: tuple[Row, ...],
    ) -> Path:
        payload = {
            "schema_version": SCHEMA_VERSION,
            "bench_id": self.bench_id,
            "started_at": self.started_at.replace(microsecond=0).isoformat(),
            "baseline": {
                "sha": baseline_sha,
                "run_dir": baseline_ref,
                "failing_gates": list(failing_gates),
            },
            "contender_wall_clock": cfg_bench.contender_wall_clock,
            # Declared order, always. There is no ordering field here and no
            # sort anywhere: ruling 6.
            "contenders": [row.as_json() for row in rows],
            "limits": list(limits_for(cfg_bench)),
        }
        if cfg_bench.attempts > 1:
            payload["attempts"] = cfg_bench.attempts
        if cfg_bench.parallel > 1:
            payload["parallel"] = cfg_bench.parallel
        path = self.directory / MANIFEST_FILENAME
        path.write_text(
            json.dumps(evidence.deep_scrub(self.redactor, payload), indent=2) + "\n",
            encoding="utf-8",
        )
        return path

    def write_summary(self, text: str) -> Path:
        path = self.directory / SUMMARY_FILENAME
        path.write_text(self.redactor.scrub(text), encoding="utf-8")
        return path

    def write_digests(self) -> Path:
        """Hash every file in this bundle. **Written last.**"""
        return evidence.digest_directory(self.directory)


def preflight(contenders: tuple[config.Contender, ...]) -> None:
    """Every ACP contender's binary must resolve, before anything is created.

    Wringer never installs an agent — it names the absent one and prints what
    to run (`wring start`'s rule). Refused HERE so the refusal costs nothing
    and leaves nothing behind, and because an absent binary discovered
    mid-bench would be a partial comparison presented as a whole one.

    A shell worker's RUNTIME failure is that contender's recorded outcome,
    not a bench abort — but a shell worker with no `{brief}` cannot even be
    told what to build, so its rows would measure nothing while spending the
    ceiling (0.6.0, run 3 F5/F6). That is refused here for the same reason an
    absent binary is: a partial comparison presented as a whole one.
    """
    from wringer import agents

    missing = []
    for contender in contenders:
        worker = contender.worker
        if isinstance(worker, str) and "{brief}" not in worker:
            missing.append(
                f"contender '{contender.id}' declares a shell worker with no "
                f"{{brief}} — it has no channel through which to receive the "
                f"task, so its rows would measure a worker that was never "
                f"briefed"
            )
            continue
        if isinstance(worker, config.ExecWorker):
            if shutil.which(worker.argv[0]) is None:
                missing.append(
                    f"contender '{contender.id}' needs {worker.argv[0]!r}, "
                    f"which is not on PATH"
                )
            continue
        if not isinstance(worker, config.AcpWorker):
            continue
        if shutil.which(worker.command) is None:
            hint = ""
            found = agents.find(contender.agent_id or "")
            if found is not None:
                hint = f" — install it with: {found.install}"
            missing.append(
                f"contender '{contender.id}' needs '{worker.command}', which is "
                f"not on PATH{hint}"
            )
    if missing:
        raise BenchError(
            "\n".join(missing)
            + "\n\nWringer never installs an agent. Nothing has been created."
        )


def run(
    root: Path,
    cfg: config.Config,
    selected: tuple[str, ...] = (),
    prove: bool = False,
    on_event: Any = None,
    loop_console: dict[str, Any] | None = None,
) -> Outcome:
    """Bench every selected contender, serially, and write the comparison."""
    assert cfg.bench is not None
    settings = cfg.bench
    contenders = _selected(settings, selected)
    preflight(contenders)

    # **Refusal 8, runtime half** (SPEC_CONTAIN_V0 §3). `_for_contender`
    # carries `run:` — and therefore `run.containment` — into every contender,
    # and every contender runs in a detached worktree under
    # `.wringer/worktrees/`. A worktree's `.git` is a FILE pointing into the
    # main repository, so a container mounting it alone opens a broken
    # repository; a refusal keyed on `fleet.worktree` is structurally blind to
    # this, because bench never reads that key. SPEC_EXEC_V0 §8 kept bench out
    # of the gate backend deliberately, and this keeps it out of the worker
    # one rather than handing it containment by inheritance.
    if cfg.run is not None and cfg.run.containment is not None:
        raise BenchError(
            "'run.containment' cannot be used with 'wring bench'. Every "
            "contender runs in a detached worktree, whose .git is a file "
            "pointing into the main repository — mounted alone it is a broken "
            "repository, so every contender's worker would fail on that "
            "rather than on the work. Bench a repository without "
            "'run.containment', or contain the worker under 'wring run'"
        )

    redactor = Redactor.from_config(
        cfg.evidence, extra_names=config.declared_secret_names(cfg)
    )
    started_at = datetime.now().astimezone()
    bench_id = evidence.new_run_id(started_at)

    # The baseline first, and its worktree is kept whatever happens next: on a
    # green tree it IS the refusal's evidence.
    baseline_tree = _worktree(root, bench_id, "baseline")
    _setup(cfg, baseline_tree, redactor)
    baseline = _verify_baseline(root, cfg, baseline_tree)
    baseline_sha = git.inspect(baseline_tree).head_sha
    baseline_ref = _relative(baseline.bundle.directory, root)

    if baseline.passed:
        raise NothingToMeasure(
            "every required gate passes at the baseline, so there is nothing "
            "to repair and nothing to compare. Commit the failing test that "
            "defines the job, then bench",
            baseline_ref,
            _cleanup_lines(root, (baseline_tree,)),
        )
    failing = tuple(
        result.gate.id
        for result in baseline.results
        if not result.passed and not result.gate.optional
    )

    # Every contender's worktree up front, each checked to sit on the same
    # commit. `make_worktree` detaches at HEAD *at call time*, so a commit
    # landing between two creations would silently put contender 2 on a
    # different tree than contender 1 — the check is the mechanism.
    # One worktree per ATTEMPT, keyed by (contender, attempt). Independent by
    # construction rather than by discipline: two attempts sharing a tree would
    # be one attempt with a race in it, and nothing downstream could tell.
    plan = _attempt_plan(contenders, settings.attempts)
    trees: dict[tuple[str, int | None], Path] = {}
    for contender, attempt in plan:
        tree = _worktree(root, bench_id, _tree_name(contender.id, attempt))
        found = git.inspect(tree).head_sha
        if found != baseline_sha:
            raise BenchError(
                f"contender '{contender.id}' was checked out at {found}, but "
                f"the baseline is {baseline_sha} — a commit landed while the "
                "worktrees were being made, and rows from two different trees "
                "cannot be compared. Nothing was run; bench again"
            )
        trees[(contender.id, attempt)] = tree

    bundle = Bundle.create(
        root / BENCHES_DIRNAME, bench_id, started_at, redactor=redactor
    )
    bundle.event(
        "bench.started",
        bench_id=bench_id,
        sha=baseline_sha,
        contenders=[c.id for c in contenders],
        contender_wall_clock=settings.contender_wall_clock,
    )
    bundle.event(
        "baseline.verified",
        status=baseline.status,
        failing_gates=list(failing),
        run_ref=baseline_ref,
    )

    # **Every event in this ledger is written by THIS thread and no other.**
    # `Bundle.event` reads the file's last line to compute `prev_hash` and then
    # appends, so two threads interleaving there would break the chain that is
    # the bundle's whole tamper-evidence — silently, and in a way `wring audit`
    # would later report as tampering on an honest run. So the attempts run in a
    # pool and the ledger is written around them, in DECLARED order.
    #
    # The cost is real and is stated in the artifact: under `parallel > 1` the
    # ledger's order is declared order and not completion order.
    for contender, _attempt in plan:
        if on_event is not None:
            on_event(contender)
        bundle.event("contender.started", contender=contender.id)

    rows = _run_attempts(
        plan, trees, root, cfg, settings, baseline_sha, prove,
        loop_console or {}, redactor,
    )
    for row in rows:
        bundle.event("contender.finished", **row.as_json())

    # `rows`, not `contenders`: `bench.started` records the ids under that
    # name, and one key meaning an array in one event and a count in the next
    # is an ambiguity that would freeze into the published format forever.
    bundle.event("bench.finished", rows=len(rows))
    bundle.write_manifest(
        settings, baseline_sha, baseline_ref, failing, tuple(rows)
    )
    bundle.write_summary(
        _summary(
            root,
            bench_id,
            baseline_sha,
            baseline_ref,
            failing,
            tuple(rows),
            # Declared order here too, and the baseline first: these are the
            # directories the evidence lives in, so the reader gets them in
            # the order they read the rows.
            # Declared order, one per ATTEMPT: these are the directories the
            # evidence lives in, and a reader given fewer paths than there are
            # rows cannot find half of it.
            (baseline_tree, *(trees[key] for key in _plan_keys(plan))),
            settings,
        )
    )
    bundle.write_digests()  # LAST, so it covers the manifest and the summary
    return Outcome(
        directory=bundle.directory,
        rows=tuple(rows),
        baseline_sha=baseline_sha,
        baseline_ref=baseline_ref,
    )


def _selected(
    settings: config.Bench, selected: tuple[str, ...]
) -> tuple[config.Contender, ...]:
    """Selection may narrow the declared set and may never define one.

    Below two is refused here as it is at parse time, and for the same
    reason: a flag that could produce a single-row "comparison" would
    manufacture the artifact the two-contender floor exists to refuse.
    """
    if not selected:
        return settings.contenders
    known = {contender.id: contender for contender in settings.contenders}
    unknown = sorted(set(selected) - set(known))
    if unknown:
        raise BenchError(
            f"no contender named {', '.join(unknown)} — this config declares: "
            f"{', '.join(known)}"
        )
    chosen = tuple(c for c in settings.contenders if c.id in set(selected))
    if len(chosen) < 2:
        raise BenchError(
            "--contender selected one contender, and a comparison of one is "
            "'wring run', which is the command for it"
        )
    return chosen


def _worktree(root: Path, bench_id: str, name: str) -> Path:
    """A worktree scoped to THIS bench.

    `<bench_id>-<name>`, never the bare contender id: `make_worktree`
    force-removes a colliding path, and contender ids are stable across runs,
    so a bare name would make the second `wring bench` on a repo silently
    delete the first one's loop bundles — and with them every by-path
    reference its bundle recorded.
    """
    made = fleet.make_worktree(root, f"{bench_id}-{name}")
    if made is None:
        raise BenchError(
            f"could not create a git worktree for '{name}'. A bench needs one "
            "per contender: without isolation each would start from the last "
            "one's wreckage"
        )
    return made


def _setup(cfg: config.Config, tree: Path, redactor: Redactor) -> None:
    """`run.prove_setup`, in every worktree, before any gate.

    A worktree carries TRACKED FILES ONLY. In any repo whose dependencies are
    gitignored, every gate fails there on a missing environment and the loop
    briefs an agent to fight a venv — so a bench would measure the environment
    and call it the agent. The key already exists for exactly this trap, and a
    failing setup is an environment answer rather than a brief.
    """
    command = cfg.run.prove_setup if cfg.run is not None else None
    if not command:
        return
    logs = tree / ".wringer" / "bench-setup"
    logs.mkdir(parents=True, exist_ok=True)
    result = gates.run(
        config.Gate(
            id="prove_setup", run=command, timeout=vacuity.SETUP_TIMEOUT_SECONDS
        ),
        cwd=tree,
        stdout_path=logs / "prove_setup.stdout.log",
        stderr_path=logs / "prove_setup.stderr.log",
        redactor=redactor,
    )
    if not result.passed:
        raise BenchError(
            f"'run.prove_setup' failed in {tree.name} (exit {result.exit_code}). "
            "Every contender runs in a fresh worktree carrying tracked files "
            "only, so the setup is what makes the gates runnable there — and a "
            "bench whose gates fail on a missing environment measures the "
            f"environment. Its output is in {logs}"
        )


def _verify_baseline(
    root: Path, cfg: config.Config, tree: Path
) -> verify.Outcome:
    try:
        return verify.run(tree, cfg, verify.plan(cfg, None))
    except evidence.EvidenceError as exc:
        raise BenchError(f"the baseline could not be verified: {exc}") from exc


def _attempt_plan(
    contenders: tuple[config.Contender, ...], attempts: int
) -> list[tuple[config.Contender, int | None]]:
    """Every (contender, attempt) this bench will run, in declared order.

    `None` for the attempt when the bench makes one each, which is every bench
    that shipped — it is what keeps the worktree names, the rows and the ledger
    identical to what v1 wrote.
    """
    if attempts <= 1:
        return [(contender, None) for contender in contenders]
    return [
        (contender, number)
        for contender in contenders
        for number in range(1, attempts + 1)
    ]


def _plan_keys(
    plan: list[tuple[config.Contender, int | None]],
) -> list[tuple[str, int | None]]:
    return [(contender.id, attempt) for contender, attempt in plan]


def _tree_name(contender_id: str, attempt: int | None) -> str:
    """The worktree's name. Unchanged for a single-attempt bench, because the
    directory a reader is pointed at should not move for a feature they did not
    turn on."""
    return contender_id if attempt is None else f"{contender_id}-a{attempt}"


def _run_attempts(
    plan: list[tuple[config.Contender, int | None]],
    trees: dict[tuple[str, int | None], Path],
    root: Path,
    cfg: config.Config,
    settings: config.Bench,
    baseline_sha: str,
    prove: bool,
    console: dict[str, Any],
    redactor: Redactor,
) -> list[Row]:
    """Run every attempt, serially or in a bounded pool, and return rows in
    DECLARED order whatever order they finished in.

    **Serial when `parallel: 1`, and that path does not touch a pool at all.**
    Not an optimisation: it is what makes a bench that declared no parallelism
    behave exactly as it did, including its console interleaving and its
    interrupt handling.

    Parallel attempts share nothing mutable. Each has its own worktree, its own
    loop bundle, its own ledger, and its own `Config` — `_contender_config`
    already returns a fresh frozen dataclass per contender. The one shared
    object is the `Redactor`, which is frozen and read-only, and the bench
    ledger, which this function never touches.
    """
    def one(pair: tuple[config.Contender, int | None]) -> Row:
        contender, attempt = pair
        return _bench_one(
            root, cfg, settings, contender, trees[(contender.id, attempt)],
            baseline_sha, prove, console, redactor, attempt,
        )

    if settings.parallel <= 1:
        return [one(pair) for pair in plan]

    from concurrent.futures import ThreadPoolExecutor

    # Threads rather than subprocesses, because SPEC_BENCH ruling 2 wraps
    # `loop.run` IN PROCESS so the identical ceiling is handed over rather than
    # re-derived on the far side of a CLI. The work each thread does is almost
    # entirely waiting on `subprocess.communicate`, so the GIL is not the
    # bottleneck — the agents are.
    #
    # `map` rather than `as_completed`: the results come back in plan order,
    # which is what keeps the rows and the ledger deterministic. A bench whose
    # artifact changed shape depending on which agent happened to finish first
    # would be an artifact nobody could diff.
    with ThreadPoolExecutor(max_workers=settings.parallel) as pool:
        try:
            return list(pool.map(one, plan))
        except BaseException:
            # A Ctrl-C reaches the MAIN thread only, so the workers are still
            # inside `communicate` and their agents are still running. Reaping
            # the process groups is what makes them return: every loop writes
            # `worker.pgid` for exactly this, and `loop.reap_orphans` is the
            # shipped machinery. Without this the pool's own shutdown waits for
            # every agent's full timeout with nothing attached to its output —
            # SPEC_SUPERVISION's reapability invariant, which a thread pool
            # would otherwise quietly revoke.
            _reap_attempts(trees.values())
            raise


def _reap_attempts(trees: Any) -> list[int]:
    """Kill every worker any attempt left running. Total by construction.

    Reads each worktree's loop bundles for the `worker.pgid` files `loop.run`
    writes, and reaps them. Runs on the way out of an interrupt, so a failure
    here must not replace the interrupt with a different exception.
    """
    killed: list[int] = []
    for tree in trees:
        try:
            loops = tree / loop.LOOPS_DIRNAME
            if not loops.is_dir():
                continue
            for directory in sorted(loops.iterdir()):
                killed += loop.reap_orphans(loop.worker_pgids(directory))
        except (OSError, ValueError):  # pragma: no cover - best effort
            continue
    return killed


def _bench_one(
    root: Path,
    cfg: config.Config,
    settings: config.Bench,
    contender: config.Contender,
    tree: Path,
    baseline_sha: str,
    prove: bool,
    console: dict[str, Any],
    redactor: Redactor,
    attempt: int | None = None,
) -> Row:
    """One contender's loop, in process, under the shared ceiling."""
    # The config's OWN redactor, never a fresh empty one. `vacuity.prove`
    # shipped that exact defect — pre-change gates run with no redactor at
    # all, so their logs got neither the declared names nor even the built-in
    # patterns. A setup command is a shell command inheriting the whole
    # environment, and it can echo a credential as easily as a gate can.
    _setup(cfg, tree, redactor)
    started = time.monotonic()
    try:
        outcome = loop.run(
            tree,
            _contender_config(cfg, contender),
            # The SAME ceiling for every contender, never a remainder: a
            # contender squeezed by its predecessor's overrun would be
            # measured under conditions its predecessor set.
            wall_clock=settings.contender_wall_clock,
            prove=prove,
            **console,
        )
    except Exception as exc:  # noqa: BLE001
        # **Honest partial success (invariant 6): one contender's failure is a
        # row, not the end of the comparison** — and it was only true for two
        # exception types. `_setup` raises `BenchError` on a failed
        # `prove_setup`, `loop.run` raises `WitnessError` on a VOID, and
        # `git.inspect`/`make_worktree` raise `OSError`; any of those in the
        # THIRD contender discarded the first two's already-paid-for results,
        # because `write_manifest`, `write_summary` and `write_digests` all
        # sit after `_run_attempts`. That is real money with no artifact — law
        # 11 — and under `parallel > 1` it also kills every still-healthy
        # attempt's agent.
        #
        # The comment above promised this shape; the `except` clause did not
        # implement it.
        return Row(
            contender=contender.id,
            agent_id=contender.agent_id,
            outcome="error",
            reason=str(exc),
            iterations=0,
            wall_clock_ms=int((time.monotonic() - started) * 1000),
            loop_ref="",
            head_moved=git.inspect(tree).head_sha != baseline_sha,
            attempt=attempt,
        )

    return Row(
        contender=contender.id,
        agent_id=contender.agent_id,
        outcome=outcome.reason,
        reason=outcome.status,
        iterations=outcome.iterations,
        wall_clock_ms=int((time.monotonic() - started) * 1000),
        loop_ref=_relative(outcome.directory, root),
        head_moved=git.inspect(tree).head_sha != baseline_sha,
        final_run=_final_run_of(outcome.directory, tree, root),
        usage=_usage_of(outcome.directory),
        attempt=attempt,
    )


def _contender_config(
    cfg: config.Config, contender: config.Contender
) -> config.Config:
    """The repo's own config with only the worker substituted.

    When the repo declared no `run:` at all, the section is built from the
    `Run` dataclass's SHIPPED DEFAULTS plus this contender's worker — nothing
    is invented that `wring run` would not default to itself.
    """
    base = cfg.run or config.Run(worker=contender.worker)
    return dataclasses.replace(
        cfg, run=dataclasses.replace(base, worker=contender.worker)
    )


def _final_run_of(loop_dir: Path, tree: Path, root: Path) -> str:
    """The verify bundle the loop's last verification wrote.

    The loop records it as a path relative to the tree it ran in, which is the
    contender's worktree — so it is rebased onto the repo root here, and the
    result is what `wring judge` can actually be handed.
    """
    try:
        recorded = json.loads(
            (loop_dir / loop.MANIFEST_FILENAME).read_text(encoding="utf-8")
        )
        final = recorded["result"]["final_run"]
    except (OSError, ValueError, KeyError, TypeError):
        return ""
    return _relative(tree / str(final), root) if final else ""


def _usage_of(loop_dir: Path) -> dict[str, Any] | None:
    """The totals the agent reported, if it reported anything.

    Absent stays absent all the way to the row: a zero here would be a number
    Wringer made up about somebody else's spending.
    """
    path = loop_dir / loop.USAGE_FILENAME
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("totals")
    except (OSError, ValueError):
        return None


def _relative(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def _cleanup_lines(root: Path, trees: tuple[Path, ...]) -> str:
    """The `git worktree remove` lines, printed and never run.

    Every worktree a referenced bundle lives in is KEPT — the loop bundles are
    inside them and the baseline's verify bundle is the statement of the job,
    so a bench that removed them would be a bench that removed its evidence.
    Reclaiming the disk is therefore the reader's call, made after they have
    read what is in there, and this is the exact line to make it with.
    """
    return "\n".join(
        f"git worktree remove {_relative(tree, root)}" for tree in trees
    )


def _summary(
    root: Path,
    bench_id: str,
    baseline_sha: str,
    baseline_ref: str,
    failing: tuple[str, ...],
    rows: tuple[Row, ...],
    trees: tuple[Path, ...] = (),
    cfg_bench: config.Bench | None = None,
) -> str:
    """The human read-out. **Declared order, and no winner.**"""
    lines = [
        f"# wring bench — {bench_id}",
        "",
        f"- baseline: `{baseline_sha[:12]}`, failing "
        f"{', '.join(f'`{gate}`' for gate in failing) or 'nothing'}",
        f"- evidence: `{baseline_ref}`",
        "",
        "| contender | outcome | iterations | wall clock | tokens | cost |",
        "|---|---|---|---|---|---|",
    ]
    for row in rows:
        usage = row.usage or {}
        cost = usage.get("cost") or {}
        # An em dash where a number was never reported. Absent is absent all
        # the way to the screen: a 0 here would read as "spent nothing".
        spent = f"{cost.get('amount')} {cost.get('currency')}" if cost else "—"
        # The attempt number in the id cell, because the table is what a reader
        # scans and three rows called `claude` with no way to tell them apart is
        # a table that cannot be read.
        named = (
            f"`{row.contender}`"
            if row.attempt is None
            else f"`{row.contender}` #{row.attempt}"
        )
        lines.append(
            f"| {named} | {row.outcome} | {row.iterations} | "
            f"{row.wall_clock_ms / 1000:.1f}s | "
            f"{usage.get('used', '—')} | {spent} |"
        )

    moved = [row.contender for row in rows if row.head_moved]
    if moved:
        lines += [
            "",
            f"! {', '.join(moved)} moved HEAD in their worktree. Every "
            "tree-anchored verdict in those rows is relative to a tree the "
            "worker moved.",
        ]

    if cfg_bench is not None and cfg_bench.attempts > 1:
        verdict, sentence = agreement(rows)
        lines += [
            "",
            f"## Across attempts — **{verdict}**",
            "",
            sentence,
        ]
        if cfg_bench.parallel > 1:
            lines += [
                "",
                f"Ran {cfg_bench.parallel} at a time, so the wall-clock column "
                "is contended and rows may not be compared on it.",
            ]

    lines += ["", "## What this does not say", ""]
    lines += [f"- {limit}" for limit in limits_for(cfg_bench)]
    lines += ["", "## Next", ""]
    for row in rows:
        if row.loop_ref:
            lines.append(f"- `{row.contender}`: evidence in `{row.loop_ref}`")
    lines += [
        "",
        "A rubric's opinion on any row, if you want one:",
        "",
        "```",
    ]
    # **Only rows whose loop CONVERGED (0.7.5).** `wring judge` refuses a
    # bundle whose gates did not pass — "a judge has nothing to add when the
    # deterministic gates already said no" — so offering the line for a row
    # that stopped on its budget was advice that cannot be taken: executed
    # as printed, the idler contender's line exited 3. Found the day every
    # printed command was first run in CI (P0.5); the same class as the
    # graph report that once offered `resume` on a finished graph.
    lines += [
        f"wring judge {row.final_run}"
        for row in rows
        if row.final_run and row.outcome == "converged"
    ]
    lines += ["```", ""]

    if trees:
        lines += [
            "## Reclaiming the disk",
            "",
            "The worktrees are kept because the evidence above lives inside "
            "them. When you are done reading it:",
            "",
            "```",
            _cleanup_lines(root, trees),
            "```",
            "",
        ]
    return "\n".join(lines) + "\n"
