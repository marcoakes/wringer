"""Run many repair loops under supervision — `wringer.fleet.v1`.

SPEC_SUPERVISION_V0.md §S3. Hundreds of tasks may be queued; a bounded pool
runs at a time; what can heal is retried once on a *new* failure shape; what
cannot is parked with its evidence; and the whole thing survives its own
death because every fact is on an append-only ledger before it is acted on.

**The fleet is only a supervisor.** Each child is an ordinary `wring run`
loop in its own directory, spawned as a subprocess — which is what keeps the
whole thing testable with shell workers and keeps the fleet's own logic
small enough to reason about.

The invariants this file exists to enforce, from the incident that paid for
them: nothing retries without a ceiling, nothing retries on an identical
failure, nothing waits without a deadline, and liveness is measured by
**ledger growth** rather than by a process still existing — the incident's
fleet had live processes for eight hours and produced nothing.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from wringer import accept, config, evidence, loop, spec
from wringer.redact import Redactor

FLEETS_DIRNAME = Path(".wringer") / "fleets"
WORKTREES_DIRNAME = Path(".wringer") / "worktrees"
SCHEMA_VERSION = "wringer.fleet.v1"
EVENTS_FILENAME = "fleet.jsonl"
MANIFEST_FILENAME = "manifest.json"
SUMMARY_FILENAME = "summary.md"

# How often the supervisor looks at its children. Short enough that a
# finished child is noticed promptly, long enough that watching costs
# nothing next to the work being watched.
POLL_SECONDS = 0.2

SUCCEEDED, FAILED, PARKED = "succeeded", "failed", "parked"

SCOPE_FILENAME = "scope.json"
SCOPE_SCHEMA_VERSION = "wringer.fleetscope.v1"

# Where a worktree child's loop bundles are kept after its tree is removed
# (SPEC_SCOPE_V0 ruling 8). Inside the fleet bundle, one directory per task,
# and the loop keeps its own id so the manifest's `loops` list resolves here.
#
# **Deliberately NOT a `health` search root**, and review finding 5 is why:
# `bench_sourced` is decided by POSITION, so a copy out from under
# `.wringer/worktrees/` reads False and would arm the receipts the original
# was excluded from. Preserving evidence is worth doing; promoting it while
# preserving it is the guard-that-lies wearing the opposite coat.
PRESERVED_DIRNAME = "loops"


class FleetError(Exception):
    """The fleet could not run (CLI exit code 2)."""


@dataclass(frozen=True)
class Task:
    id: str
    brief: str
    dir: str


@dataclass(frozen=True)
class ScopedTask:
    """One task, the criteria it proves, and the gates those resolve to."""

    task: str
    criteria: tuple[str, ...]
    gates: tuple[str, ...]


@dataclass(frozen=True)
class Scope:
    """A resolved `fleet.scope` — SPEC_SCOPE_V0 ruling 1.

    `declared` is the whole gate set AS THIS RUN SAW IT, so a reader computes
    any task's EXCLUDED gates from `scope.json` alone rather than fetching
    `.wringer.yaml` at that commit (review finding 10). `wringer.fleetscope.v1`
    can never grow a field afterwards, which is why the review ran before the
    freeze.
    """

    tasks: tuple[ScopedTask, ...]
    unclaimed: tuple[str, ...]
    declared: tuple[str, ...]

    def gates_for(self, task_id: str) -> tuple[str, ...]:
        for scoped in self.tasks:
            if scoped.task == task_id:
                return scoped.gates
        return ()


def resolve_scope(
    root: Path, cfg: config.Config, tasks: list[Task]
) -> Scope | None:
    """Join task → criteria → gates, or refuse — ruling 5, EIGHT refusals.

    Total by design: if `fleet.scope` is declared it must cover every task in
    the task file. A fleet where some children are scoped and some run the
    full set would make "succeeded" mean two different things in one summary
    table.

    **Every refusal names both sides** — the id and the document it is
    missing from — and every one of them fires here, before any child spawns:
    a fleet that spawned four children and then found its map wrong has
    already spent somebody's money.
    """
    settings = cfg.fleet
    if settings is None or settings.scope is None:
        return None

    where = config.CONFIG_FILENAME
    declared = tuple(gate.id for gate in cfg.gates)

    # Refusal 8 (review finding 1, HIGH) — FIRST, because it is the one that
    # decides whether anything below is guarded at all. `accept.assess`
    # returns None unless the spec is approved, so a scoped fleet in an
    # unapproved repo writes no `acceptance.json`, and then there is nothing
    # for `wring deliver` to refuse on: the absence that guards the tick is
    # itself absent. `config._check_bindings` never consults `approved`, so
    # this route really is open one join away.
    approved = _approved_spec(root)
    if approved is None:
        raise FleetError(
            f"{where} declares 'fleet.scope', but {spec.SPEC_FILENAME} is not "
            "'approved: true'. A scoped run claims less than a full one, and "
            "what makes that safe is that acceptance records the gates that "
            "did not run — an artifact written only for an APPROVED spec. "
            "Without it a scoped fleet would deliver on a bundle nothing "
            "checked. Approve the spec, or drop 'fleet.scope'"
        )

    criteria = {c.id: c for c in approved.criteria}
    bound = {gate.proves: gate.id for gate in cfg.gates if gate.proves}
    declared_tasks = [task.id for task in tasks]
    mapped = [entry.task for entry in settings.scope]

    # Refusals 1 and 2 — the map and the task file must name the same tasks.
    for task_id in mapped:
        if task_id not in declared_tasks:
            raise FleetError(
                f"{where}: 'fleet.scope' names task '{task_id}', which is not "
                f"in the task file (it has: {', '.join(declared_tasks)}). "
                "Every scoped task must be one this fleet is going to run"
            )
    for task_id in declared_tasks:
        if task_id not in mapped:
            raise FleetError(
                f"{where}: task '{task_id}' is in the task file but not in "
                "'fleet.scope'. The map is total or it is absent — a fleet "
                "where some children are scoped and some run the whole gate "
                "set makes 'succeeded' mean two different things in one "
                "summary table"
            )

    owners: dict[str, str] = {}
    scoped_tasks: list[ScopedTask] = []
    for entry in settings.scope:
        # Refusal 7a (review finding 2) — BEFORE the zero-gates check, so the
        # message names the defect the human actually made. "Bind a gate" is
        # advice about a problem they do not have.
        if not entry.criteria:
            raise FleetError(
                f"{where}: 'fleet.scope.{entry.task}' is empty, so that child "
                "would have nothing to converge on. Give the task a "
                "criterion, or drop it from the map and from the task file"
            )

        seen: set[str] = set()
        for criterion_id in entry.criteria:
            # Review finding 3 — a set would absorb it, and every other
            # duplicate in this repo is loud.
            if criterion_id in seen:
                raise FleetError(
                    f"{where}: 'fleet.scope.{entry.task}' lists "
                    f"'{criterion_id}' twice. One mention is all it takes"
                )
            seen.add(criterion_id)

            # Refusal 3 — unknown criterion.
            criterion = criteria.get(criterion_id)
            if criterion is None:
                known = ", ".join(sorted(criteria)) or "none"
                raise FleetError(
                    f"{where}: 'fleet.scope.{entry.task}' names criterion "
                    f"'{criterion_id}', which is not in {spec.SPEC_FILENAME}. "
                    f"Declared there: {known}"
                )
            # Refusal 5 — a `human: true` criterion. Nothing to run: the same
            # category error `config.check_bindings` refuses one join away.
            if criterion.human:
                raise FleetError(
                    f"{where}: 'fleet.scope.{entry.task}' names criterion "
                    f"'{criterion_id}', which {spec.SPEC_FILENAME} marks "
                    "'human: true'. There is no gate to converge on — human "
                    "criteria are answered by people, and a loop cannot "
                    "satisfy one"
                )
            # Refusal 4 — bound to no gate.
            if criterion_id not in bound:
                raise FleetError(
                    f"{where}: 'fleet.scope.{entry.task}' names criterion "
                    f"'{criterion_id}', which no gate proves. Bind a gate to "
                    f"it with 'proves: {criterion_id}', or remove it from the "
                    "map — a child cannot converge on a criterion nothing "
                    "measures"
                )
            # Refusal 6 — one criterion, one owner.
            if criterion_id in owners:
                raise FleetError(
                    f"{where}: tasks '{owners[criterion_id]}' and "
                    f"'{entry.task}' both claim criterion '{criterion_id}'. "
                    "One criterion, one owner: two children converging on the "
                    "same gate would each be told the other's work is theirs"
                )
            owners[criterion_id] = entry.task

        gates_for_task = tuple(
            gate.id for gate in cfg.gates if gate.proves in entry.criteria
        )
        # Refusal 7b — kept because refusal 4 is what normally catches this,
        # and a resolution that silently produced an empty gate set would
        # dispatch a child with no `--gate` at all, which is an UNSCOPED run
        # wearing a scoped fleet's clothes.
        if not gates_for_task:
            raise FleetError(
                f"{where}: 'fleet.scope.{entry.task}' resolves to no gates. "
                "Bind a gate to one of its criteria, or run that task outside "
                "the scoped fleet"
            )
        scoped_tasks.append(
            ScopedTask(
                task=entry.task,
                criteria=entry.criteria,
                gates=gates_for_task,
            )
        )

    # Legal and LOUD (ruling 5's last sentence): a bound criterion no task
    # claimed lands here, its gate goes red in the operator's final verify if
    # nobody built it, and acceptance refuses delivery exactly as today.
    unclaimed = tuple(sorted(set(bound) - set(owners)))
    return Scope(
        tasks=tuple(scoped_tasks), unclaimed=unclaimed, declared=declared
    )


def _approved_spec(root: Path) -> Any:
    """The spec if a human approved it, else None.

    Read through acceptance's own reader so the two cannot drift: the
    boundary that decides whether `acceptance.json` exists is the boundary
    that decides whether a scoped fleet may run at all.
    """
    return accept.read_spec(root)


@dataclass
class TaskState:
    """One task's life. Mutable because it is exactly the thing that changes."""

    task: Task
    attempts: int = 0
    status: str = "pending"
    reason: str = ""
    signatures: list[str] = field(default_factory=list)
    loop_dirs: list[str] = field(default_factory=list)
    worktree: str | None = None
    # Bundle-relative paths of the loop directories copied out of this task's
    # worktree before it was removed. Empty for every shared-tree fleet: there
    # the child's loops are still where the child wrote them.
    preserved: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Outcome:
    directory: Path
    succeeded: int
    failed: int
    parked: int
    join_satisfied: bool

    @property
    def total(self) -> int:
        return self.succeeded + self.failed + self.parked


def load_tasks(path: Path) -> list[Task]:
    """One JSON object per line: references, never inline payloads.

    Invariant 5. The incident handed each consumer a 50 KB blob inline and
    every one of them drowned; a task therefore names a brief *file* and a
    directory, and stays small enough to read at a glance.
    """
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise FleetError(f"cannot read {path}: {exc}") from exc

    tasks: list[Task] = []
    seen: set[str] = set()
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        where = f"{path.name}:{number}"
        try:
            raw = json.loads(line)
        except json.JSONDecodeError as exc:
            raise FleetError(f"{where}: not valid JSON: {exc}") from exc
        if not isinstance(raw, dict):
            raise FleetError(f"{where}: each line must be a JSON object")

        unknown = sorted(set(raw) - {"id", "brief", "dir"})
        if unknown:
            raise FleetError(f"{where}: unknown keys: {', '.join(unknown)}")
        for key in ("id", "brief", "dir"):
            if not isinstance(raw.get(key), str) or not raw[key].strip():
                raise FleetError(f"{where}: '{key}' must be a non-empty string")

        task_id = raw["id"].strip()
        if not config.GATE_ID_PATTERN.fullmatch(task_id) or len(task_id) > 64:
            raise FleetError(
                f"{where}: id '{task_id}' must be a slug — it names a directory"
            )
        if task_id in seen:
            raise FleetError(f"{where}: duplicate task id '{task_id}'")
        seen.add(task_id)
        tasks.append(Task(id=task_id, brief=raw["brief"], dir=raw["dir"]))

    if not tasks:
        raise FleetError(f"{path} declares no tasks")
    return tasks


@dataclass(frozen=True)
class Bundle:
    directory: Path
    fleet_id: str
    started_at: datetime
    redactor: Redactor = Redactor()

    @classmethod
    def create(
        cls, fleets_root: Path, redactor: Redactor | None = None
    ) -> Bundle:
        started_at = datetime.now().astimezone()
        try:
            fleets_root.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise FleetError(f"cannot create {fleets_root}: {exc}") from exc
        for _ in range(64):
            fleet_id = evidence.new_run_id(started_at)
            directory = fleets_root / fleet_id
            try:
                directory.mkdir(exist_ok=False)
            except FileExistsError:
                continue
            except OSError as exc:
                raise FleetError(f"cannot create {directory}: {exc}") from exc
            return cls(directory, fleet_id, started_at, redactor or Redactor())
        raise FleetError(f"could not allocate a directory under {fleets_root}")

    def event(self, event_type: str, **fields: Any) -> None:
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
        self, settings: config.Fleet, states: list[TaskState], satisfied: bool
    ) -> None:
        counts = _counts(states)
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "fleet_id": self.fleet_id,
            "started_at": self.started_at.replace(microsecond=0).isoformat(),
            "config": {
                "concurrency": settings.concurrency,
                "deadline": settings.deadline,
                "retries": settings.retries,
                "join": settings.join,
            },
            "result": {
                "succeeded": counts[SUCCEEDED],
                "failed": counts[FAILED],
                "parked": counts[PARKED],
                "join_satisfied": satisfied,
            },
            "tasks": [
                {
                    "id": s.task.id,
                    "status": s.status,
                    "reason": s.reason,
                    "attempts": s.attempts,
                    "loops": s.loop_dirs,
                }
                for s in states
            ],
        }
        (self.directory / MANIFEST_FILENAME).write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )

    def write_scope(self, scope: Scope) -> Path:
        """`scope.json` — who proved what, and what nobody ran.

        The machine-readable third of the record (the run bundle's "Scoped
        out" section is the human-readable one, and the absent result rows
        are the one that actually refuses). Written at the START, before any
        child: it is the fleet's declaration of intent, and a fleet killed
        mid-flight should still say what it set out to prove.

        `declared_gates` is the whole set as this run saw it, so a reader
        computes any task's EXCLUDED gates from this file alone — review
        finding 10, folded before the freeze precisely because
        `wringer.fleetscope.v1` can never grow a field afterwards.
        """
        payload = {
            "schema_version": SCOPE_SCHEMA_VERSION,
            "fleet_id": self.fleet_id,
            "declared_gates": list(scope.declared),
            "tasks": [
                {
                    "task": scoped.task,
                    "criteria": list(scoped.criteria),
                    "gates": list(scoped.gates),
                }
                for scoped in scope.tasks
            ],
            "unclaimed_criteria": list(scope.unclaimed),
        }
        path = self.directory / SCOPE_FILENAME
        path.write_text(
            self.redactor.scrub(json.dumps(payload, indent=2)) + "\n",
            encoding="utf-8",
        )
        return path

    def preserve_loops(self, state: TaskState, worktree: Path) -> list[str]:
        """Copy a worktree child's loop bundles in here, BEFORE the tree goes.

        SPEC_SCOPE_V0 ruling 8. `git worktree remove --force` discards
        untracked files, and a child's whole `.wringer/` is untracked, so the
        loop directories this fleet's own summary points at went with the
        tree — measured in the dossier (§3d) as a guard-that-lies: the
        sentence promising the evidence and the command deleting it were
        written by the same function.

        Copies, never moves: the removal is what tidies the original, and a
        move would leave the tree half-dismantled if the copy failed.

        What this does NOT preserve, said here because a reader will look for
        it: the child's `.wringer/runs/` bundles, which the loop directory
        REFERENCES by run id. They go with the tree. Keeping them would widen
        exactly the laundering surface `PRESERVED_DIRNAME` documents, and
        they can arm nothing anyway — review finding 4 measured a worktree
        child's runs as `bench_sourced`, so they were never in the receipt
        economy to begin with.
        """
        source = worktree / loop.LOOPS_DIRNAME
        if not source.is_dir():
            return []
        kept: list[str] = []
        for directory in sorted(source.iterdir()):
            if not directory.is_dir():
                continue
            target = self.directory / PRESERVED_DIRNAME / state.task.id
            try:
                target.mkdir(parents=True, exist_ok=True)
                shutil.copytree(directory, target / directory.name)
            except (OSError, shutil.Error):
                # A copy that failed is worth less than a summary that does
                # not claim it. The teardown continues either way: leaving a
                # hundred trees on disk to save one loop directory is not a
                # trade this supervisor makes.
                continue
            kept.append(f"{PRESERVED_DIRNAME}/{state.task.id}/{directory.name}")
        return kept

    def write_digests(self) -> Path:
        """Hash every file in this fleet bundle. **Written last.**"""
        return evidence.digest_directory(self.directory)

    def write_summary(
        self, states: list[TaskState], satisfied: bool, scoped: bool = False
    ) -> None:
        counts = _counts(states)
        lines = [
            f"# wring fleet — {self.fleet_id}",
            "",
            f"- started: {self.started_at.replace(microsecond=0).isoformat()}",
            f"- result: **{counts[SUCCEEDED]} succeeded, {counts[FAILED]} failed, "
            f"{counts[PARKED]} parked** of {len(states)}",
            f"- join: **{'satisfied' if satisfied else 'not satisfied'}**",
            "",
            "| task | status | attempts | why |",
            "|---|---|---|---|",
        ]
        for state in states:
            lines.append(
                f"| {state.task.id} | {state.status} | {state.attempts} "
                f"| {state.reason or '—'} |"
            )
        lines += _blocked_sentence(states, scoped)

        parked = [s for s in states if s.status == PARKED]
        if parked:
            # DERIVED, because the claim is about what is on disk. A child
            # that died before its loop bundle existed — a missing task
            # directory, a `--gate` id its own config does not declare —
            # leaves nothing at all, and pointing a reader at directories
            # that were never written is the same defect as ruling 8's,
            # one step earlier in the child's life.
            where = (
                "in the child loop directories"
                if any(s.loop_dirs for s in parked)
                else "the tasks below left no child loop directory of their own"
            )
            lines += [
                "",
                f"Parked work is not lost: its evidence is above and {where}. "
                "**There is no fleet resume yet** — "
                "`wring resume` continues a single killed *loop*, not a fleet. "
                "To retry, re-run `wring fleet` with a task file holding the "
                "parked ids.",
            ]

        lines += _preserved_section(states)
        (self.directory / SUMMARY_FILENAME).write_text(
            "\n".join(lines) + "\n", encoding="utf-8"
        )


def _blocked_sentence(states: list[TaskState], scoped: bool) -> list[str]:
    """The one honest sentence an unscoped multi-task fleet owed its reader.

    Dossier §3b, the mechanism nobody wrote down: every child runs the WHOLE
    declared gate set, so a task cannot converge until every OTHER task's work
    exists in the tree it is looking at. All but the last task therefore fail
    their first pass, and the retry queue harvests the work they left behind.
    The summary reported those expected failures as failures, with reasons
    like `no_progress`, and an operator watching half their tasks fail on
    every run had no way to know it was the design.

    Three conditions, all DERIVED from this fleet rather than from a flag:
    something has to have gone wrong, there has to be another task that could
    have blocked it, and the fleet must not be SCOPED — scoping is what
    removes the pathology, so printing the sentence there would teach a
    reader to discount a failure that means exactly what it says.
    """
    if scoped or len(states) < 2:
        return []
    if not any(s.status in (FAILED, PARKED) for s in states):
        return []
    return [
        "",
        "This fleet is not scoped, so every child ran the whole declared gate "
        "set: a failure above may mean **blocked by a gate another task will "
        "build**, not broken work. That is why `fleet.retries` matters — one "
        "full pass leaves every task's code in the shared tree and the retry "
        "queue converts the rest. `docs/fleet-scale.md` has the measurements; "
        "`fleet.scope` is how a task converges on its own gates instead.",
    ]


def _preserved_section(states: list[TaskState]) -> list[str]:
    """Where a worktree child's loop bundles went, and what they are not.

    Both halves in one paragraph on purpose (review finding 5): a reader who
    finds these has to learn in the same breath that nothing reads them. The
    copy is out from under `.wringer/worktrees/`, so `health.Bundle`'s
    positional `bench_sourced` marker no longer applies to it — the only
    thing keeping deliberately-excluded runs out of the receipt economy is
    that `.wringer/fleets` is not a discovery root.
    """
    kept = [(s.task.id, path) for s in states for path in s.preserved]
    if not kept:
        return []
    return [
        "",
        "## Preserved evidence",
        "",
        "`worktree: true`, so each child ran in its own checkout and the "
        "fleet removed it. Its loop directories were copied in here first, "
        "before each worktree was removed:",
        "",
        *[f"- `{path}/` — {task_id}" for task_id, path in kept],
        "",
        "They are here **for a human to read**. `wring health` does not "
        "discover them and must not: a bundle that was excluded from the "
        "receipt economy by its position under `.wringer/worktrees/` would "
        "stop being excluded once copied out of it. The child's own run "
        "bundles are not here — they went with the tree, and being "
        "bench-sourced they could arm nothing either way.",
    ]


def _counts(states: list[TaskState]) -> dict[str, int]:
    counts = {SUCCEEDED: 0, FAILED: 0, PARKED: 0}
    for state in states:
        if state.status in counts:
            counts[state.status] += 1
    return counts


@dataclass
class _Child:
    state: TaskState
    proc: subprocess.Popen
    started: float
    loop_dir: Path | None = None
    last_growth: float = 0.0
    last_size: int = -1


def run(
    root: Path,
    cfg: config.Config,
    tasks: list[Task],
    on_event: Any = None,
) -> Outcome:
    """Supervise the queue until it empties or the deadline bites."""
    assert cfg.fleet is not None
    settings = cfg.fleet
    # BEFORE the bundle, let alone a child: ruling 5's refusals are hard
    # errors at `wring fleet` start, and a refused fleet leaves no directory
    # behind to be mistaken for a run that happened.
    scope = resolve_scope(root, cfg, tasks)
    # Every name this config declares. A fleet's bundle records what its
    # children did, and its children are the ones handed a credential.
    redactor = Redactor.from_config(
        cfg.evidence, extra_names=config.declared_secret_names(cfg)
    )
    bundle = Bundle.create(root / FLEETS_DIRNAME, redactor=redactor)
    if scope is not None:
        bundle.write_scope(scope)

    bundle.event(
        "fleet.started",
        fleet_id=bundle.fleet_id,
        tasks=len(tasks),
        concurrency=settings.concurrency,
        deadline=settings.deadline,
    )

    states = [TaskState(task=t) for t in tasks]
    queue = list(states)
    running: list[_Child] = []
    deadline = time.monotonic() + settings.deadline

    while queue or running:
        expired = time.monotonic() >= deadline
        while queue and not expired and len(running) < settings.concurrency:
            state = queue.pop(0)
            child = _spawn(root, bundle, state, settings, scope)
            if child is None:
                continue
            running.append(child)

        if expired:
            for child in running:
                _stop(child)
                child.state.status = PARKED
                child.state.reason = "fleet deadline"
                bundle.event(
                    "task.parked", task=child.state.task.id, why="deadline"
                )
            for state in queue:
                state.status = PARKED
                state.reason = "fleet deadline"
                bundle.event("task.parked", task=state.task.id, why="deadline")
            running, queue = [], []
            break

        time.sleep(POLL_SECONDS)
        for child in list(running):
            if child.proc.poll() is not None:
                running.remove(child)
                _settle(bundle, child, settings, queue)
            elif _is_silent(child, settings):
                _stop(child)
                running.remove(child)
                child.state.status = FAILED
                child.state.reason = "reaped: no progress in its ledger"
                bundle.event("task.reaped", task=child.state.task.id)
                _maybe_retry(bundle, child.state, settings, queue, "no_progress")

    if settings.worktree:
        # Tidy up every checkout this fleet made. Parked and failed tasks
        # keep their EVIDENCE — but only because it is COPIED OUT first
        # (ruling 8). `git worktree remove --force` discards untracked files
        # and a child's whole `.wringer/` is untracked, so until this landed
        # the sentence promising the evidence and the call deleting it were
        # written by the same function. The working copies still go, or a
        # hundred-task fleet leaves a hundred trees behind.
        for state in states:
            if state.worktree:
                state.preserved = bundle.preserve_loops(
                    state, Path(state.worktree)
                )
                remove_worktree(root, Path(state.worktree))

    satisfied = _join_satisfied(states, settings.join)
    counts = _counts(states)
    bundle.event(
        "fleet.finished",
        succeeded=counts[SUCCEEDED],
        failed=counts[FAILED],
        parked=counts[PARKED],
        join_satisfied=satisfied,
    )
    bundle.write_manifest(settings, states, satisfied)
    bundle.write_summary(states, satisfied, scoped=scope is not None)
    bundle.write_digests()  # LAST, so it covers the manifest and the summary

    return Outcome(
        directory=bundle.directory,
        succeeded=counts[SUCCEEDED],
        failed=counts[FAILED],
        parked=counts[PARKED],
        join_satisfied=satisfied,
    )


def make_worktree(root: Path, task_id: str) -> Path | None:
    """Give a task its own checkout, so parallel children cannot collide.

    The only git WRITE Wringer performs, and it is metadata: `worktree add`
    and `worktree remove`. No commit, no branch move, no push — the law that
    the harness never writes history is untouched.

    Detached at HEAD: a worktree on a branch would move that branch, which is
    history. Returns None if git refuses, and the caller parks the task —
    a fleet that silently ran two children in one tree would be worse.
    """
    path = root / WORKTREES_DIRNAME / task_id
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        remove_worktree(root, path)
    proc = subprocess.run(
        ["git", "worktree", "add", "--detach", str(path), "HEAD"],
        cwd=root, capture_output=True, text=True, timeout=120,
    )
    return path if proc.returncode == 0 else None


def remove_worktree(root: Path, path: Path) -> None:
    """Tidy up. --force because a child may have left the tree dirty, and a
    fleet that cannot clean up after itself accumulates until a human does."""
    subprocess.run(
        ["git", "worktree", "remove", "--force", str(path)],
        cwd=root, capture_output=True, text=True, timeout=120,
    )


def _spawn(
    root: Path,
    bundle: Bundle,
    state: TaskState,
    settings: config.Fleet,
    scope: Scope | None = None,
) -> _Child | None:
    if settings.worktree:
        made = make_worktree(root, state.task.id)
        if made is None:
            state.status = PARKED
            state.reason = "could not create a git worktree"
            bundle.event("task.parked", task=state.task.id, why="worktree_failed")
            return None
        state.worktree = str(made)
        bundle.event("task.worktree", task=state.task.id, path=str(
            made.relative_to(root) if made.is_relative_to(root) else made))
        workdir = made
    else:
        workdir = (root / state.task.dir).resolve()
    if not workdir.is_dir():
        state.status = PARKED
        state.reason = f"no such directory: {state.task.dir}"
        bundle.event("task.parked", task=state.task.id, why="missing_dir")
        return None

    state.attempts += 1
    # The fallback ladder is *declared*, never improvised: attempt N uses
    # entry N-1 if the repo wrote one down.
    fallback = None
    index = state.attempts - 2
    if 0 <= index < len(settings.worker_fallbacks):
        fallback = settings.worker_fallbacks[index]

    env = dict(os.environ)
    # Shell-native rather than a new placeholder vocabulary: a repo's worker
    # command can use these directly.
    # Named in `loop.py`, where the brief reads them back: the child inlines
    # the brief file's contents now, and these stay for the workers that were
    # written to read them.
    env[loop.TASK_ID_ENV] = state.task.id
    env[loop.TASK_BRIEF_ENV] = str((root / state.task.brief).resolve())
    if fallback:
        env["WRINGER_WORKER_FALLBACK"] = fallback

    # Invariant 8: budgets nest. These were parsed and silently discarded, so
    # a child could outlive the fleet that spawned it — and the fleet's own
    # deadline is no substitute, because it kills the supervisor rather than
    # the worker burning the budget.
    argv = [sys.executable, "-m", "wringer", "run"]
    if settings.child_max_iterations is not None:
        argv += ["--max-iterations", str(settings.child_max_iterations)]
    if settings.child_worker_timeout is not None:
        argv += ["--worker-timeout", str(settings.child_worker_timeout)]
    if settings.child_wall_clock is not None:
        argv += ["--wall-clock", str(settings.child_wall_clock)]
    # SPEC_SCOPE_V0: the child converges on ITS task's gates and briefs on
    # nothing else. `resolve_scope` has already refused a task that resolves
    # to none, so this never dispatches an unscoped run by accident.
    for gate_id in scope.gates_for(state.task.id) if scope is not None else ():
        argv += ["--gate", gate_id]

    proc = subprocess.Popen(
        argv,
        cwd=workdir,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=os.name == "posix",
    )
    bundle.event(
        "task.started",
        task=state.task.id,
        attempt=state.attempts,
        dir=state.task.dir,
        **({"fallback": fallback} if fallback else {}),
    )
    now = time.monotonic()
    return _Child(state=state, proc=proc, started=now, last_growth=now)


def _stop(child: _Child) -> None:
    """Kill the child `wring run` **and the worker it is supervising**.

    Killing the child's process group is not enough, and that was the hole.
    The worker runs in its OWN group — `gates.run` uses `start_new_session`,
    which is how a gate timeout kills a shell and everything it spawned — so
    signalling the supervisor's group leaves the worker running. A fleet
    deadline that stops the supervisor and not the work it started does not
    bound anything, which is the one thing a deadline is for. `_spawn`'s own
    comment has said so about child budgets since it was written.

    The worker's group is on disk: `loop._run_worker` and `_run_acp_worker`
    write `worker.pgid` the instant the worker exists, precisely so that
    something outside the loop can reap it. `wring resume` already reads those
    files; this reads the same ones.

    Order matters. The supervisor goes FIRST, so it cannot start another
    worker between the two kills.
    """
    import signal

    try:
        os.killpg(os.getpgid(child.proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError, AttributeError):
        try:
            child.proc.kill()
        except OSError:
            pass

    loop_dir = _child_loop_dir(_child_root(child))
    if loop_dir is not None:
        loop.reap_orphans(loop.worker_pgids(loop_dir))


def _child_root(child: _Child) -> Path:
    """Where the child was run — its worktree, or the task's own directory."""
    if child.state.worktree:
        return Path(child.state.worktree)
    return Path(child.state.task.dir).resolve()


def _child_loop_dir(root_dir: Path) -> Path | None:
    return loop.latest_loop(root_dir / loop.LOOPS_DIRNAME)


def _child_ledger(root_dir: Path) -> Path | None:
    found = _child_loop_dir(root_dir)
    return found / loop.EVENTS_FILENAME if found is not None else None


def _is_silent(child: _Child, settings: config.Fleet) -> bool:
    """Liveness is ledger growth, not a live process.

    The incident's fleet had twenty live processes for eight hours. "It is
    still running" is not evidence that anything is happening.
    """
    ledger = _child_ledger(
        Path(child.state.worktree)
        if child.state.worktree
        else Path(child.state.task.dir).resolve()
    )
    size = -1
    if ledger is not None and ledger.is_file():
        try:
            size = ledger.stat().st_size
        except OSError:
            size = -1
    now = time.monotonic()
    if size > child.last_size:
        child.last_size = size
        child.last_growth = now
        return False
    return (now - child.last_growth) >= settings.progress_window


def _settle(
    bundle: Bundle, child: _Child, settings: config.Fleet, queue: list[TaskState]
) -> None:
    """Record what a finished child achieved, and heal it if it can be."""
    state = child.state
    workdir = (
        Path(state.worktree) if state.worktree else Path(state.task.dir).resolve()
    )
    found = loop.latest_loop(workdir / loop.LOOPS_DIRNAME)
    signature, reason = None, "unknown"
    if found is not None:
        state.loop_dirs.append(found.name)
        try:
            manifest = json.loads(
                (found / loop.MANIFEST_FILENAME).read_text(encoding="utf-8")
            )
            reason = manifest.get("result", {}).get("reason", "unknown")
        except (OSError, json.JSONDecodeError):
            pass
        signature = _last_signature(found)

    if child.proc.returncode == 0:
        state.status = SUCCEEDED
        state.reason = "converged"
        bundle.event("task.finished", task=state.task.id, status=SUCCEEDED,
                     loop=found.name if found else None)
        return

    bundle.event(
        "task.finished",
        task=state.task.id,
        status=FAILED,
        reason=reason,
        loop=found.name if found else None,
        **({"failure_signature": signature} if signature else {}),
    )
    _maybe_retry(bundle, state, settings, queue, reason, signature)


def _last_signature(loop_dir: Path) -> str | None:
    try:
        events = loop.read_events(loop_dir)
    except evidence.EvidenceError:
        return None
    signatures = [
        e["failure_signature"]
        for e in events
        if e.get("type") == "verify.finished" and e.get("failure_signature")
    ]
    return signatures[-1] if signatures else None


def _maybe_retry(
    bundle: Bundle,
    state: TaskState,
    settings: config.Fleet,
    queue: list[TaskState],
    reason: str,
    signature: str | None = None,
) -> None:
    """The self-healing ladder, and the rule that stops it being a treadmill.

    A failure shape seen before for *this task* is deterministic: retrying it
    would reproduce it. That is invariant 2, and it is the single rule that
    would have saved the incident's twenty wasted agents.
    """
    if signature is not None and signature in state.signatures:
        state.status = PARKED
        state.reason = f"{reason} (same failure twice — retrying would repeat it)"
        bundle.event("task.parked", task=state.task.id, why="deterministic")
        return
    if signature is not None:
        state.signatures.append(signature)

    if state.attempts > settings.retries:
        state.status = PARKED if settings.on_exhausted == "park" else FAILED
        state.reason = f"{reason} (attempts exhausted)"
        bundle.event(
            "task.parked" if state.status == PARKED else "task.finished",
            task=state.task.id,
            why="exhausted",
        )
        return

    state.status = "pending"
    state.reason = reason
    bundle.event("task.retried", task=state.task.id, after=reason)
    queue.append(state)


def _join_satisfied(states: list[TaskState], join: str) -> bool:
    succeeded = sum(1 for s in states if s.status == SUCCEEDED)
    if join == "all":
        return succeeded == len(states)
    if join == "first_pass":
        return succeeded >= 1
    if join.startswith("quorum:"):
        return succeeded >= len(states) * float(join.split(":", 1)[1])
    return False  # pragma: no cover - validated at parse time
