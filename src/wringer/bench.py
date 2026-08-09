"""`wring bench` — the same job, every declared worker, one at a time.

**It measures. It does not crown.** (SPEC_BENCH_V0.md, ruling 6.) There is no
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
for the bare-worktree trap. Serial is measurement hygiene, not a missing
feature — parallel contenders on one machine contend for CPU, IO and the
network, and wall-clock is a primary column.
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
SCHEMA_VERSION = "wringer.bench.v1"
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
            "limits": list(LIMITS),
        }
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

    A shell worker has no meaningful preflight and gets none: a worker that
    fails at runtime is that contender's recorded outcome, not a bench abort.
    """
    from wringer import agents

    missing = []
    for contender in contenders:
        worker = contender.worker
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
    trees: dict[str, Path] = {}
    for contender in contenders:
        tree = _worktree(root, bench_id, contender.id)
        found = git.inspect(tree).head_sha
        if found != baseline_sha:
            raise BenchError(
                f"contender '{contender.id}' was checked out at {found}, but "
                f"the baseline is {baseline_sha} — a commit landed while the "
                "worktrees were being made, and rows from two different trees "
                "cannot be compared. Nothing was run; bench again"
            )
        trees[contender.id] = tree

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

    rows: list[Row] = []
    for contender in contenders:
        if on_event is not None:
            on_event(contender)
        bundle.event("contender.started", contender=contender.id)
        rows.append(
            _bench_one(
                root, cfg, settings, contender, trees[contender.id],
                baseline_sha, prove, loop_console or {}, redactor,
            )
        )
        bundle.event("contender.finished", **rows[-1].as_json())

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
            (baseline_tree, *(trees[c.id] for c in contenders)),
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
    except (evidence.EvidenceError, config.ConfigError) as exc:
        # Honest partial success (invariant 6): one contender's failure is a
        # row, not the end of the comparison.
        return Row(
            contender=contender.id,
            agent_id=contender.agent_id,
            outcome="error",
            reason=str(exc),
            iterations=0,
            wall_clock_ms=int((time.monotonic() - started) * 1000),
            loop_ref="",
            head_moved=git.inspect(tree).head_sha != baseline_sha,
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
        lines.append(
            f"| `{row.contender}` | {row.outcome} | {row.iterations} | "
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

    lines += ["", "## What this does not say", ""]
    lines += [f"- {limit}" for limit in LIMITS]
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
    lines += [
        f"wring judge {row.final_run}" for row in rows if row.final_run
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
