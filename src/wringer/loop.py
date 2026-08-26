"""The repair loop — verify, brief the worker, verify again (docs/specs/SPEC_RUN_V0.md).

`wring verify` proves a change. This closes the loop around it: while the
gates fail, write what failed into a brief and hand it to the worker the repo
declared, then verify again. The worker is somebody else's program — usually
a coding agent — spawned as a subprocess. **Wringer makes no LLM call and no
network call of its own here**, exactly as in v0.1.

Two rulings shape everything below:

- **A worker's exit code never ends the loop.** The evidence decides. A
  worker that crashed after fixing the bug converges on the next lap; one
  that exited cleanly without touching anything stops on `no_progress`.
- **The loop never writes to git.** It runs gates and a worker. Committing
  what came out is the human's decision.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import shutil
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from wringer import (
    __version__,
    accept,
    acp,
    attest,
    config,
    containment,
    diagnose,
    evidence,
    fleet,
    gates,
    git,
    spec,
    stability,
    staleness,
    verify,
    witness,
)
from wringer.redact import Redactor

LOOPS_DIRNAME = Path(".wringer") / "loops"
# **v2, and v1 is still published and still frozen** — the `untracked-v2`
# precedent, and the bump SPEC_ENV_V0 §3 already chartered the mechanics of.
#
# v1 froze `result.reason` and `loop.finished.reason` as CLOSED enums of six
# values, so a seventh way for the loop to stop was unrepresentable without a
# new version. `flaky_gate` is that seventh way, and none of the six is even
# nearly true of it: no worker ran, the tree is not unchanged, and the same
# failure did not come back — re-verifying would give a DIFFERENT answer,
# which is the whole point.
#
# v2's `reason` is an open string with its known values in the description,
# which is a deliberate design change and not laziness. The fleet's own
# manifest and events have always recorded `reason` as a plain string, and
# SPEC_ENV_V0 §4 cites that approvingly as the reason an environment stop
# needs no fleet schema change at all. Closed here, every future stop reason
# costs a version — F6's `environment` would have needed v3 — and version
# churn on the bundle format is what a frozen schema is supposed to prevent,
# not cause. The drift guard moves from the schema to
# `test_the_console_names_every_reason_the_loop_can_stop_for`, which already
# exists and already caught this class of gap once.
SCHEMA_VERSION = "wringer.loop.v2"
# Every version a reader accepts. DERIVED from here rather than named at each
# reader, because the naive bump silently orphans every bundle already on disk
# (SPEC_ENV_V0 §3, finding D3): `health._KINDS` is keyed off this constant, so
# changing it without widening the map makes health forget every v1 loop —
# wordlessly, which is the failure mode health exists to catch.
SCHEMA_VERSIONS = (SCHEMA_VERSION, "wringer.loop.v1")
EVENTS_FILENAME = "loop.jsonl"
MANIFEST_FILENAME = "manifest.json"
SUMMARY_FILENAME = "summary.md"

# What the agent said it spent, when it said anything — a SIBLING file, on
# purpose and by law 7. `worker.finished` is `additionalProperties: false` in
# the published `wringer.loop.v1` event schema, and that schema is frozen, so
# a usage field on the event would make every loop bundle written afterwards
# invalid against the format its own manifest names. `vacuity.json` solved the
# identical problem the identical way: a new file, a new version, every
# existing reader untouched, and the file simply ABSENT from every loop whose
# agent reported nothing.
USAGE_FILENAME = "usage.json"
USAGE_SCHEMA_VERSION = "wringer.usage.v1"
ITERATIONS_DIRNAME = "iterations"
BRIEF_FILENAME = "brief.md"
PGID_FILENAME = "worker.pgid"

# Why a loop stopped without ever calling a worker: the gate that failed did
# not give the same answer twice on one tree (SPEC_STABILITY_V0 §4). The value
# v2 exists for, and the one reason in the table that is about the CHECK rather
# than about the worker or the budget.
FLAKY_GATE = "flaky_gate"

# The gate failed for a reason no tree edit can affect, and the shell itself is
# the witness — SPEC_ENV_V0 (F6). The second reason in the table that is not
# about the worker, and the only one that ends a loop having briefed NOBODY.
#
# **It costs no schema version.** `wringer.loop.v2`'s `reason` is an open
# string on purpose, and the v2 manifest schema says so in its own description
# while citing SPEC_ENV by name — a later cycle spending this spec's argument
# before this spec did. `graph.LOOP_REASONS` is the drift guard.
ENVIRONMENT = "environment"

# `diagnosis.json` — a SIBLING file, and the `usage.json` reasoning above
# applies unchanged: `result` is `additionalProperties: false` in the published
# `wringer.loop.v2` manifest schema, and that schema is frozen, so a
# `diagnosis` field on it would make every loop bundle written afterwards
# invalid against the format its own manifest names. SPEC_ENV's ruling 3 asked
# for exactly that field and could not have it. Law 7: a new file is always
# allowed; a field on a frozen shape never is.
#
# ABSENT rather than null when nothing matched a face, like `usage.json` is
# absent when the agent reported nothing.
DIAGNOSIS_FILENAME = "diagnosis.json"
DIAGNOSIS_SCHEMA_VERSION = "wringer.diagnosis.v1"

# `worker-diagnosis.json` — R1 (2026-08-18), and a THIRD sibling for the same
# reason the second one exists.
#
# It is not a fourth `face` on `diagnosis.json`: that file's `face` is a
# closed enum in a published, frozen schema, and its required `gate` and
# `evidence` fields are read off a failing gate's log by `gates.cite`. This
# fact came from the worker's own ledger and names no gate, so writing it
# there would mean inventing values for two required fields. Law 7 again: a
# new file is always allowed, a field on a frozen shape never is.
#
# ABSENT unless a worker turn really ended clean and empty, so a reader that
# finds one knows the worker never engaged without having to read a null.
WORKER_DIAGNOSIS_FILENAME = "worker-diagnosis.json"
WORKER_DIAGNOSIS_SCHEMA_VERSION = "wringer.workerdiagnosis.v2"

# The synthetic gate id the worker runs as. Not a gate anyone declared — it
# just borrows the gate runner's process-group kill, bounded drain, and
# scrub-then-cap log writing rather than reimplementing them worse.
WORKER_ID = "worker"

# How much of a failing gate's log to quote into the brief. The worker can
# open the bundle for the rest; this is what it needs to start.
BRIEF_TAIL_LINES = 40

# The environment a fleet hands its children. Declared HERE, where the brief
# reads them, and used by `fleet.py` — which already imports this module — so
# the two halves of the contract cannot drift apart in two files.
TASK_ID_ENV = "WRINGER_TASK_ID"
TASK_BRIEF_ENV = "WRINGER_TASK_BRIEF"

# How much prose from the spec — the intent, and the task's own brief file —
# is quoted into a loop brief. A PM writes a page and a page belongs here;
# anything longer is named by path rather than pasted, which is the same
# bargain `_tail` strikes with a gate's log.
BRIEF_PROSE_CHARS = 8000

# Untracked files this big contribute their size rather than their contents
# to the fingerprint. Hashing a 2 GB artifact to notice it changed would cost
# more than the whole loop.
FINGERPRINT_MAX_BYTES = 10 * 1024 * 1024

# How much of a failing gate's log shapes its failure signature. Enough to
# tell two different failures apart, little enough that a long tail of
# incidental output does not drown the part that identifies it.
SIGNATURE_TAIL_LINES = 30

# Noise stripped before a failure is hashed, so the *shape* of a failure is
# what gets compared rather than the timestamps and paths around it. Missing
# a match is safe — the iteration ceiling still catches it; matching two
# genuinely different failures would not be, so these stay conservative.
_NOISE = (
    re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?"),  # timestamps
    # A bare clock time, which is what most tools actually print. Without
    # this, two identical failures a second apart hash differently and the
    # breaker never fires — it only looked correct on a machine fast enough
    # to run both laps inside the same second.
    re.compile(r"\b\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\b"),                 # clock times
    re.compile(r"\d{8}-\d{6}-[0-9a-f]{4}"),                            # run ids
    re.compile(r"0x[0-9a-fA-F]+"),                                     # addresses
    re.compile(r"\b\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|seconds)\b"),      # durations
    re.compile(r"/(?:tmp|private/var|var/folders)/\S+"),               # scratch paths
    re.compile(r"\bpid[= ]\d+\b", re.IGNORECASE),                      # pids
)

Reporter = Callable[..., None]


@dataclass(frozen=True)
class Outcome:
    directory: Path
    status: str  # converged | stopped | interrupted
    reason: str  # one of `_REASONS`
    iterations: int
    final: verify.Outcome | None
    # The gate that stopped this loop for being nondeterministic, when one
    # did. Carried so the console can NAME it: "stopped" with no gate id sends
    # a reader looking for a worker problem that does not exist.
    flaky_gate: str | None = None
    # The criteria whose witness was still red when the loop stopped, if any.
    #
    # Carried for the same reason `flaky_gate` is: the console has to be able to
    # NAME what is outstanding. The review found three of `_LOOP_ENDINGS`'
    # sentences saying *"the gates still fail"* over a run where every declared
    # gate was green and only the manufactured witness was red — which is the
    # corpus's shape and therefore the shape P4-1 exists for. Generalising the
    # sentence to "the checks" made it true; this is what stops it being vague.
    unconverted: tuple[str, ...] = ()
    # The environment diagnosis, when the final failure wore a face — the same
    # object `diagnosis.json` is written from, so the console and the record
    # cannot disagree about which line they quote.
    #
    # **Carried on EVERY ending, not only `environment`.** That is the hint
    # tier: a loop that ended `no_progress` against a missing module still gets
    # a legible diagnosis, and F6's flagship case is exactly that one. None
    # when nothing matched.
    diagnosis: diagnose.Diagnosis | None = None
    # The LAST worker turn, when it ended cleanly having changed nothing (R1).
    # A separate tier from `diagnosis` above because it is about the worker
    # rather than about a gate, and it is the difference between "it tried and
    # failed" and "it never engaged" — which `no_progress` alone cannot say.
    worker_diagnosis: diagnose.WorkerDiagnosis | None = None

    @property
    def converged(self) -> bool:
        return self.status == "converged"


@dataclass(frozen=True)
class Bundle:
    """The loop's own evidence, beside but never inside the verify bundles.

    Verify runs are referenced by path: one run, one bundle, one place. Like
    `evidence.Bundle`, this owns the redactor so every write scrubs by
    construction rather than by the caller remembering.
    """

    directory: Path
    loop_id: str
    started_at: datetime
    redactor: Redactor = Redactor()

    @classmethod
    def create(
        cls,
        loops_root: Path,
        now: datetime | None = None,
        redactor: Redactor | None = None,
    ) -> Bundle:
        started_at = now if now is not None else datetime.now().astimezone()
        try:
            loops_root.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise evidence.EvidenceError(f"cannot create {loops_root}: {exc}") from exc

        for _ in range(64):
            loop_id = evidence.new_run_id(started_at)
            directory = loops_root / loop_id
            try:
                directory.mkdir(exist_ok=False)
            except FileExistsError:
                continue  # same second, fresh suffix
            except OSError as exc:
                raise evidence.EvidenceError(
                    f"cannot create {directory}: {exc}"
                ) from exc
            return cls(
                directory=directory,
                loop_id=loop_id,
                started_at=started_at,
                redactor=redactor or Redactor(),
            )
        raise evidence.EvidenceError(
            f"could not allocate a loop directory under {loops_root}"
        )

    def iteration_dir(self, iteration: int) -> Path:
        directory = self.directory / ITERATIONS_DIRNAME / f"{iteration:03d}"
        directory.mkdir(parents=True, exist_ok=True)
        return directory

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

    def write_brief(self, iteration: int, text: str) -> Path:
        path = self.iteration_dir(iteration) / BRIEF_FILENAME
        path.write_text(self.redactor.scrub(text), encoding="utf-8")
        return path

    def write_usage(self, rows: list[dict[str, Any]]) -> Path | None:
        """What the agent reported it spent, per session, plus totals.

        **Returns None and writes NOTHING when no row exists.** Absent means
        unreported; a file full of zeroes would be Wringer asserting a number
        no agent ever gave it, which is the invention an attestation clause
        with no inputs is omitted to avoid.

        Scrubbed like every other write into this bundle. The numbers cannot
        carry a credential, but the shape is the bundle's rule and a write
        path that opted out of it is how two leaks shipped.
        """
        if not rows:
            return None
        payload = {
            "schema_version": USAGE_SCHEMA_VERSION,
            "loop_id": self.loop_id,
            # Said in the artifact, not only in the docs: a reader who found
            # this file without the spec should still know whose numbers
            # these are.
            "reported_by": "agent",
            "verified": False,
            "rows": rows,
            "totals": usage_totals(rows),
        }
        path = self.directory / USAGE_FILENAME
        path.write_text(
            json.dumps(evidence.deep_scrub(self.redactor, payload), indent=2) + "\n",
            encoding="utf-8",
        )
        return path

    def write_digests(self) -> Path:
        """Hash every file in this loop bundle. **Written last.**"""
        return evidence.digest_directory(self.directory)

    def write_manifest(
        self,
        state: git.RepoState,
        run: config.Run,
        status: str,
        reason: str,
        iterations: int,
        final_run: str | None,
    ) -> None:
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "loop_id": self.loop_id,
            "started_at": self.started_at.replace(microsecond=0).isoformat(),
            "repo": {
                "root": ".",
                "head_sha": state.head_sha,
                "branch": state.branch,
                "dirty": state.dirty,
            },
            "config": {
                "max_iterations": run.max_iterations,
                "worker": self.redactor.scrub(_worker_text(run.worker)),
            },
            "result": {
                "status": status,
                "reason": reason,
                "iterations": iterations,
                "final_run": final_run,
            },
        }
        (self.directory / MANIFEST_FILENAME).write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )


@dataclass(frozen=True)
class Resumable:
    """What a ledger says about a loop that never finished.

    Rebuilt from `loop.jsonl` alone. A supervisor that held state anywhere
    else could not survive its own death, which is the point: kill -9 at any
    moment and the last recorded fact is still the truth.
    """

    directory: Path
    loop_id: str
    iterations_done: int
    seen_signatures: frozenset[str]
    started_at: str | None
    orphan_pgids: tuple[int, ...]


def read_events(loop_dir: Path) -> list[dict[str, Any]]:
    path = loop_dir / EVENTS_FILENAME
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise evidence.EvidenceError(f"cannot read {path}: {exc}") from exc
    events: list[dict[str, Any]] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            # A ledger truncated mid-write by a SIGKILL is exactly the case
            # resume exists for: keep every whole line and drop the partial.
            break
    return events


def latest_loop(loops_root: Path) -> Path | None:
    if not loops_root.is_dir():
        return None
    found = [p for p in loops_root.iterdir() if p.is_dir()]
    if not found:
        return None
    return max(found, key=evidence._started_at)


def inspect_for_resume(loop_dir: Path) -> Resumable | None:
    """Read a ledger and say whether it describes an unfinished loop.

    A loop with `loop.finished` is over — including one a human interrupted,
    because they chose to stop it and can choose to start another. Only a
    ledger that simply *stops* was killed.
    """
    events = read_events(loop_dir)
    if not events:
        return None
    if any(e.get("type") == "loop.finished" for e in events):
        return None

    started = next((e for e in events if e.get("type") == "loop.started"), {})
    verifies = [e for e in events if e.get("type") == "verify.finished"]
    return Resumable(
        directory=loop_dir,
        loop_id=started.get("loop_id", loop_dir.name),
        iterations_done=len(verifies),
        seen_signatures=frozenset(
            e["failure_signature"] for e in verifies if e.get("failure_signature")
        ),
        started_at=started.get("ts"),
        orphan_pgids=worker_pgids(loop_dir),
    )


def worker_pgids(loop_dir: Path) -> tuple[int, ...]:
    """Worker process groups this loop left behind, from the files it wrote.

    Public because `wring resume` is no longer the only caller: a fleet
    stopping a child has to reap the child's WORKER too — killing the
    supervisor's group leaves the worker in its own one, still running —
    and it reads exactly these files rather than inventing a second way to
    find the same processes.
    """
    found = []
    for path in sorted((loop_dir / ITERATIONS_DIRNAME).glob(f"*/{PGID_FILENAME}")):
        try:
            found.append(int(path.read_text(encoding="utf-8").strip()))
        except (OSError, ValueError):
            continue
    return tuple(found)


def reap_orphans(pgids: tuple[int, ...]) -> list[int]:
    """Try to kill worker groups the dead loop left behind.

    A SIGKILL of the loop cannot signal the worker's process group, so an
    orphan can outlive it. Resume knows the pgid because `worker.started`
    recorded it, so it can try — and reports what it managed, because
    claiming a kill it did not make would be the usual sin.
    """
    import signal

    try:
        mine = os.getpgid(0)
    except (AttributeError, OSError):  # pragma: no cover - non-POSIX
        return []

    killed = []
    for pgid in pgids:
        if pgid == mine or pgid <= 1:
            # Never signal our own group: that would kill this very process,
            # and its parent, and whatever else shares the group.
            continue
        try:
            os.killpg(pgid, signal.SIGKILL)
            killed.append(pgid)
        except (ProcessLookupError, PermissionError, OSError):
            pass  # already gone, or never ours to signal
    return killed


def missing_agent(settings: config.Run) -> str | None:
    """Why this loop cannot start, or None — SPEC_ACP_V0 §3's first row.

    An ACP worker whose binary is not on `PATH` is an environment error, and
    the spec says so: *binary missing → exit 2 before the loop starts*. Without
    this the loop ran, spawned nothing, and reported `worker (exit 1)` twice
    before stopping on `no_progress` — blaming a worker for a binary nobody
    installed, which is the misattribution class F6 exists to fix, one seam
    over. `bench.py` has done this preflight since it shipped; the loop did
    not, so the same absent agent read as two different things depending on
    which command found it.

    Returns the message rather than raising: the caller owns the exit code,
    and `wring run`'s is 2.
    """
    worker = settings.worker
    if not isinstance(worker, config.AcpWorker):
        # A shell worker gets no preflight, for `bench.py`'s reason: its
        # failure at runtime is that worker's recorded outcome, not a refusal.
        return None
    if shutil.which(worker.command) is not None:
        return None
    from wringer import agents

    known = agents.by_command(worker.command)
    # **The second sentence is here because the first one was not enough.**
    # Field report 2026-08-21, finding 9: an operator ran this exact install
    # line, it SUCCEEDED, and the agent was still not on PATH — npm's global
    # bin directory was not on theirs. The message named the package to
    # install and left the reader to conclude that installing it would be
    # sufficient, which on that machine it was not. Naming the failure mode
    # costs one line and is the difference between a message that ends the
    # problem and one that starts a second search.
    hint = (
        f"\n\nInstall it with: {known.install}"
        "\nIf you have just installed it and this still says the same thing, "
        "the installer's directory may not be on PATH — `npm bin -g` prints "
        "where it put the command."
    ) if known is not None else ""
    return (
        f"the ACP agent {worker.command!r} is not on PATH, so there is nothing "
        f"to hand the brief to.{hint}\n\nWringer never installs an agent. "
        "Nothing has been created."
    )


def unauthenticated_agent(settings: config.Run) -> str | None:
    """Why this loop's worker cannot authenticate, or None.

    `missing_agent` above refuses an agent that is not installed. This refuses
    the next thing along, which two field runs hit and nothing checked: an
    agent that IS installed and has never been logged in. Both runs paid for
    drafting first and met the wall afterwards.

    It is deliberately the SECOND of the two, and only speaks when the first
    is silent: an absent binary has one good message and it is the other
    function's.

    Only a definite "no" refuses. `worker_auth` returns `UNKNOWN` for every
    agent whose auth surface nobody here has measured, for a containment, and
    for an answer it cannot parse — and none of those may stop a run, because
    a stop on Wringer's ignorance of a vendor would be this repository
    charging a person for its own gap.
    """
    worker = settings.worker
    if not isinstance(worker, config.AcpWorker):
        return None
    if settings.containment is not None:
        return None
    from wringer import worker_auth

    found = worker_auth.read(worker)
    if not found.will_fail:
        return None
    return worker_auth.refusal(worker, found)


def _worker_text(worker: Any) -> str:
    """How a worker is written down in the manifest, whichever form it is."""
    if isinstance(worker, config.AcpWorker):
        return " ".join(["acp:", worker.command, *worker.args])
    return str(worker)


def _unconverted(
    outcome: verify.Outcome, witnesses: list[witness.Witness] | None
) -> list[witness.Witness]:
    """Every REQUIRED criterion whose usable witness is still red (P4-1).

    Empty for every repository with no witness lane, which is what keeps their
    loops byte-identical: `[]` is falsy, the continuation predicate collapses
    back to `final.passed`, and nothing about them moved.

    `required` comes from the acceptance row rather than being recomputed here.
    Only a REQUIRED criterion may hold the loop open, for exactly the reason
    only a required one may refuse a delivery (`accept.Row.refuses`): an
    optional criterion is a statement, not a gate, and spending worker turns on
    one would be this loop inventing a requirement the spec declined to make.
    """
    if not witnesses:
        return []
    accepted = outcome.acceptance
    if accepted is None:
        # Unreachable in a run that HAS witnesses — they are authored from an
        # approved spec's criteria, which is the same condition that makes
        # `assess` return a verdict. Kept explicit rather than assumed away,
        # and in the direction that repairs rather than the one that skips.
        return [item for item in witnesses if witness.unconverted(item)]
    required = {row.criterion for row in accepted.rows if row.required}
    return [
        item for item in witnesses
        if item.criterion in required and witness.unconverted(item)
    ]


def failure_signature(
    outcome: verify.Outcome, witnesses: list[witness.Witness] | None = None
) -> str | None:
    """A hash of the *shape* of a failure, or None if nothing failed.

    Two failures with the same signature are the same failure. Retrying one
    is not repair, it is repetition — which is the whole lesson of the
    incident SPEC_SUPERVISION_V0 was written from: twenty agents were retried
    on identical input and produced nothing twenty times.

    Normalization is deliberately conservative. A false negative merely
    spends budget the iteration ceiling still bounds; a false positive would
    stop a loop that was genuinely making progress.

    **A red witness is part of the shape** (P4-1), and this is the constraint
    that ruling attaches to loop engagement rather than an optimisation. The
    loop now continues on a red witness with every gate green, where
    `failed_gate` is None — so without this the signature would be None on
    every one of those laps, the breaker would never see a repeat, and the only
    stop left would be `no_progress` plus the iteration ceiling. A worker that
    changes something irrelevant every turn would run to the ceiling every
    time. Feeding the witness's failure into the SAME machinery gates feed is
    how a witness that never converts ends through the stops that already
    exist, which is what W10's companion clause asks for: surface through the
    existing refusal machinery rather than loop forever.
    """
    parts: list[str] = []
    if outcome.failed_gate is not None:
        failing = next(
            (r for r in outcome.results if r.gate.id == outcome.failed_gate),
            None,
        )
        if failing is not None:
            parts += [outcome.failed_gate, str(failing.exit_code)]
            for path in (failing.stdout_path, failing.stderr_path):
                try:
                    text = path.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    text = ""
                parts.append(_normalize(text))

    for item in _unconverted(outcome, witnesses):
        executed = item.executed
        # The criterion and the log, normalised by exactly the rules a gate's
        # log gets — the same `_normalize`, deliberately, because a second
        # normaliser for witnesses would be a second thing to keep in step.
        #
        # **What that does and does not buy, corrected after the review.** An
        # earlier draft of this comment said a timestamp or a path "is stripped
        # by the same rules and cannot make two identical failures look
        # different". `_NOISE` strips ISO timestamps, clock times, run ids,
        # `0x` addresses, durations, pids, and paths under `/tmp`,
        # `/private/var` and `/var/folders` — and measurably NOT UUIDs, nor
        # absolute paths elsewhere (`/Users/…`, `/home/…`, `/workspace/…`). A
        # witness whose failure carries one of those gets a fresh signature
        # every lap, so the breaker never fires and the loop spends its whole
        # `max_iterations` before stopping.
        #
        # That is bounded, not unbounded — the ceiling is unconditional — and it
        # is the flaky-witness limit §6f banks by name rather than a defect this
        # comment may claim is absent.
        parts += [
            f"witness:{item.criterion}",
            str(executed.exit_code) if executed is not None else "unrun",
            _normalize(executed.log if executed is not None else ""),
        ]

    if not parts:
        return None
    return hashlib.sha256("\0".join(parts).encode("utf-8")).hexdigest()


def _normalize(text: str) -> str:
    """Strip the parts of a log that differ between identical failures."""
    tail = text.splitlines()[-SIGNATURE_TAIL_LINES:]
    lines = []
    for line in tail:
        for pattern in _NOISE:
            line = pattern.sub("", line)
        collapsed = " ".join(line.split())
        if collapsed:
            lines.append(collapsed)
    return "\n".join(lines)


def fingerprint(root: Path) -> str:
    """A hash of everything a worker could have changed.

    HEAD, the tracked diff, the porcelain status, and the contents of every
    untracked file. If this is unchanged across a worker's turn, the worker
    changed nothing, and re-running the gates would produce the same answer
    at the same cost — so the loop stops instead.

    Deliberately the degenerate form of the roadmap's anti-thrash machinery:
    failure-signature hashing and oscillation detection are a later slice.
    """
    state = git.inspect(root)
    digest = hashlib.sha256()
    for part in (
        state.head_sha or "",
        git.diff(root, state.head_sha) or "",
        _without_wringer(git.status(root) or ""),
    ):
        digest.update(part.encode("utf-8", "surrogateescape"))
        digest.update(b"\0")

    for relative in sorted(state.untracked):
        if _is_wringers(relative):
            # Every verify writes a new bundle, so counting Wringer's own
            # evidence as the worker's work would make the tree look changed
            # on every lap and no worker would ever be found idle. The same
            # rule that makes verify snapshot git before opening its bundle.
            continue
        digest.update(relative.encode("utf-8", "surrogateescape"))
        path = root / relative
        try:
            if path.is_dir():
                # git reports an untracked directory as one entry; its
                # contents are covered by walking it in sorted order
                for child in sorted(p for p in path.rglob("*") if p.is_file()):
                    digest.update(str(child.relative_to(root)).encode())
                    _hash_file(digest, child)
            else:
                _hash_file(digest, path)
        except OSError:
            # vanished mid-scan; its absence is itself a change we will see
            digest.update(b"<unreadable>")
        digest.update(b"\0")
    return digest.hexdigest()


def _is_wringers(relative: str) -> bool:
    """Whether a path belongs to Wringer's own evidence rather than the repo."""
    return relative.split("/", 1)[0] == evidence.RUNS_DIRNAME.parts[0]


def _without_wringer(porcelain: str) -> str:
    """Porcelain status with Wringer's own entries dropped, for the same
    reason the untracked walk skips them."""
    return "\n".join(
        line
        for line in porcelain.splitlines()
        if not _is_wringers(line[3:].strip().strip('"'))
    )


def _hash_file(digest: Any, path: Path) -> None:
    size = path.stat().st_size
    if size > FINGERPRINT_MAX_BYTES:
        digest.update(f"<{size} bytes>".encode())
        return
    digest.update(path.read_bytes())


def run(
    root: Path,
    cfg: config.Config,
    max_iterations: int | None = None,
    worker_timeout: int | None = None,
    wall_clock: int | None = None,
    on_iteration: Reporter | None = None,
    on_gate: verify.GateReporter | None = None,
    on_worker: Reporter | None = None,
    resuming: Resumable | None = None,
    # The gates this loop is responsible for — SPEC_SCOPE_V0 ruling 3. None
    # is every declared gate, which is every loop that came before this flag.
    # A scoped loop's `converged` is a true statement about what it verified;
    # the bundle beside it says what that was, and the frozen loop-manifest
    # reason enum is untouched — absence is the record, not a new reason.
    gates: Sequence[str] | None = None,
    # Tightens only. `run.prove: true` is read inside `verify.wants_prove`,
    # so a False here can never turn off what the repo declared — which is
    # the point: the agent being supervised often invokes this command.
    prove: bool = False,
) -> Outcome:
    """Drive the loop. `cfg.run` must not be None — the caller checks that,
    because a missing `run:` section is a config error with its own message.

    `resuming` continues a loop whose ledger stopped without `loop.finished`:
    the same directory is appended to, iteration numbering carries on, and
    the budget resumes with its *remainder* — spent iterations stay spent.
    """
    assert cfg.run is not None
    settings = cfg.run
    budget = max_iterations if max_iterations is not None else settings.max_iterations
    # Invariant 8: budgets NEST. A fleet's per-child ceilings override the
    # repo's own, because the outer budget is the one that was reasoned
    # about. Without this the fleet's `child:` keys were parsed and thrown
    # away, and a child could outlive the fleet that spawned it.
    turn_ceiling = (
        worker_timeout if worker_timeout is not None else settings.worker_timeout
    )
    whole_loop = wall_clock if wall_clock is not None else settings.wall_clock

    planned = verify.plan(cfg, gates)
    # What this task owns, for the brief's criteria list (ruling 3). None
    # when nothing was scoped: an unscoped loop owns everything, and marking
    # every criterion "THIS TASK" would be noise that teaches a reader to
    # ignore the mark in the fleet case, where it carries the whole point.
    # Derived from the plan, so it cannot drift from what actually runs.
    scoped = {gate.id for _, gate in planned} if gates is not None else None
    # `extra_names` matters most HERE: this is the command that hands an agent
    # a credential by name, and `config.py` has always promised those values
    # are folded in. Without it a passthrough variable was protected only when
    # its name happened to match one of the default patterns.
    redactor = Redactor.from_config(
        cfg.evidence, extra_names=config.declared_secret_names(cfg)
    )
    state = git.inspect(root)

    if resuming is not None:
        bundle = Bundle(
            directory=resuming.directory,
            loop_id=resuming.loop_id,
            started_at=datetime.now().astimezone(),
            redactor=redactor,
        )
        killed = reap_orphans(resuming.orphan_pgids)
        bundle.event(
            "loop.resumed",
            iterations_done=resuming.iterations_done,
            reaped_pgids=list(killed),
        )
    else:
        bundle = Bundle.create(root / LOOPS_DIRNAME, redactor=redactor)
        bundle.event(
            "loop.started",
            loop_id=bundle.loop_id,
            wringer_version=__version__,
            repo=root.name,
            sha=state.head_sha,
            max_iterations=budget,
        )

    # What authorises this loop's work, hashed BEFORE the first worker turn.
    # A resumed loop keeps the capture its first life wrote: the brief this
    # compares against is the one the work was actually done under, and
    # re-capturing on resume would quietly bless anything edited while the
    # loop was dead (SPEC_RUN_V0 §the staleness rider).
    briefed = staleness.read(bundle.directory)
    if briefed is None:
        briefed = staleness.capture(root)
        staleness.write(bundle.directory, briefed)

    # **Declaring is not establishing** (SPEC_CONTAIN_V0 ruling 3). The static
    # refusals have already fired inside `verify.run`'s preflight; this is
    # where the containment is actually stood up, once, before the first
    # worker turn — and where the dynamic refusals live, because arming an
    # allowlist means starting a container and issuing a DNS query.
    #
    # `establish` raises or returns; it has no path that yields a falsy answer,
    # so there is deliberately no `except` here that could carry on with an
    # uncontained worker under a config claiming containment. That fallback is
    # the defect class this whole programme exists to catch.
    worker_containment = settings.containment
    established = None
    if worker_containment is not None:
        established = containment.establish(
            worker_containment, root, bundle.directory
        )
    # No ledger event for this, deliberately. `loop.jsonl`'s `type` is a closed
    # enum with `additionalProperties: false` on every branch, so a new event
    # costs a schema version — and the fact already has a home that costs
    # none: `execution.json`'s `worker_execution.established` block, written
    # by every verify lap of this loop. A second record of the same fact is a
    # second thing to keep in step.

    # **The witness lane, pinned before the first worker turn** (SPEC_GATEGEN
    # §6 W4). Everything here is offline: no LLM, no network. Authoring already
    # happened at `wring spec --send --witness`, which is what makes the check
    # pre-date the work — the load-bearing property, because a check authored
    # before the work exists cannot have been written to flatter it.
    witnesses = _pin_witnesses(
        bundle, root, worker_containment, established
    )

    final: verify.Outcome | None = None
    status = reason = "stopped"
    iterations = 0
    # The gate that stopped this loop for being nondeterministic. Named in the
    # summary and on the console: "stopped" with no gate id would send a reader
    # looking for a worker problem that does not exist.
    flaky_gate: str | None = None
    # One row per session that reported. Stays empty for every shell worker
    # and every agent that says nothing, and an empty list writes no file.
    usage_rows: list[dict[str, Any]] = []
    # The LAST worker turn's emptiness, not every turn's: a loop whose first
    # lap did real work and whose second produced nothing is not a worker that
    # never engaged. Overwritten each lap, so what survives is how the loop
    # actually ended. None whenever the last turn did something.
    empty_turn: diagnose.WorkerDiagnosis | None = None
    # The tree as it was when the previous worker was handed control. Equal
    # again now means that worker changed nothing.
    before_worker: str | None = None
    # Every failure shape this loop has already seen. Seeing one twice means
    # the worker is going in circles (A→B→A) or standing still (A→A), and
    # either way the gates will keep saying the same thing.
    seen_signatures: set[str] = set(
        resuming.seen_signatures if resuming is not None else ()
    )
    already = resuming.iterations_done if resuming is not None else 0
    deadline = (
        time.monotonic() + whole_loop
        if whole_loop is not None
        else None
    )

    if already >= budget:
        # Resumed with nothing left to spend: honest, and not an error.
        iterations = already
        status, reason = "stopped", "max_iterations"
    for iteration in range(already + 1, budget + 1):
        iterations = iteration
        if on_iteration is not None:
            on_iteration(iteration, budget)
        bundle.event("iteration.started", iteration=iteration)

        final = verify.run(
            root, cfg, planned, on_gate=on_gate, prove=prove,
            established=established,
            # Handed to EVERY lap, so each lap's `acceptance.json` is a true
            # statement about that lap rather than one artifact retro-fitted
            # after the loop. The pin is re-checked inside, immediately before
            # each execution.
            witnesses=witnesses,
        )
        # **Work remaining is gates OR witnesses, and that is P4-1** (ruled
        # 2026-08-15). The continuation predicate was `final.passed` alone, and
        # on the corpus that made §5.3 unsatisfiable as built: `CORPUS.md` §3
        # selects tasks whose declared gates do NOT cover the issue, so those
        # gates are green at base, so every loop converged at iteration 1
        # having briefed nobody — the measured zero-worker-turns-in-26-attempts
        # result, rebuilt one layer up. A red witness meant a refusal at
        # delivery and nothing before it, which is a supervisor that watches a
        # repair it never asks for.
        #
        # A usable witness that is red on the changed tree is WORK TO DO. The
        # loop continues while any required criterion has one, inside every
        # budget it already had — `max_iterations`, the wall clock, the worker
        # timeout are untouched, and this adds no new budget and no new stop.
        outstanding = _unconverted(final, witnesses)
        signature = failure_signature(final, witnesses)
        bundle.event(
            "verify.finished",
            iteration=iteration,
            status=final.status,
            **(
                {"failed_gate": final.failed_gate}
                if final.failed_gate is not None
                else {}
            ),
            **({"failure_signature": signature} if signature is not None else {}),
            evidence_dir=verify.bundle_path(final.bundle, root),
        )

        if final.status == "interrupted":
            status = reason = "interrupted"
            break
        if final.passed and not outstanding:
            status = reason = "converged"
            break

        # **A flaky gate is never handed to a worker.** Checked before every
        # other stop, because every one of them is a statement about the
        # WORKER and this is a statement about the CHECK: the gate did not give
        # the same answer twice on one tree, so nothing in the tree explains
        # the difference and there is nothing in it to fix. An agent briefed
        # with this gate edits source that was never wrong, and the next draw
        # comes up green and calls it a fix — the loop reporting `converged`
        # over a repair that repaired nothing.
        #
        # It stops rather than re-verifying. Looping on a nondeterministic gate
        # until it comes up all-green is retry-until-green one level up, and it
        # would end in an honest-looking `converged` bought by re-drawing.
        flaky = _flaky_failure(final)
        if flaky is not None:
            status, reason = "stopped", FLAKY_GATE
            flaky_gate = flaky
            break

        # **The environment stop — SPEC_ENV_V0 (F6).** Checked here, after
        # flaky and before everything else, for the same reason flaky is
        # checked first: every stop below is a statement about the WORKER, and
        # this is a statement about the ENVIRONMENT. A worker briefed against a
        # command that is not on PATH is asked to repair something no tree edit
        # can affect, and F6 measured what happens next — the loop files
        # `no_progress` and blames the worker.
        #
        # Four legs, all facts, all in `diagnose.stops_the_loop`, and NONE of
        # them reads the failure's TEXT. `pre_worker` is computed here rather
        # than there because only the loop knows its own life: `already` counts
        # iterations inherited from a resumed bundle, and a resumed life
        # re-observes a tree a worker may have touched.
        failing = _failing_result(final)
        pre_worker = already == 0 and iteration == 1 and before_worker is None
        if failing is not None and diagnose.stops_the_loop(
            failing, pre_worker=pre_worker
        ):
            status, reason = "stopped", ENVIRONMENT
            break

        current = fingerprint(root)
        if before_worker is not None and current == before_worker:
            # An identical tree gives an identical result; verifying it again
            # would be theatre. Checked BEFORE the breaker because it is the
            # more precise diagnosis of the same symptom: "your worker did
            # nothing" is actionable in a way "the failure came back" is not.
            status, reason = "stopped", "no_progress"
            break

        # The breaker. The worker changed *something* and the same failure
        # shape came back anyway — it is going round in a circle (A→B→A) or
        # editing things that do not touch the failure (A→A). Spending the
        # rest of the budget on it would be the incident of 2026-07-30 in
        # miniature: twenty retries of a failure that was never transient.
        #
        # Never on the first lap of *this* life. A repeat only means anything
        # with a worker's turn between the two sightings, and a resumed loop
        # opens by re-observing a tree no worker has touched since the kill —
        # which would otherwise trip the breaker before the worker ever ran.
        if iteration > already + 1 and signature is not None and (
            signature in seen_signatures
        ):
            status, reason = "stopped", "oscillating"
            break
        if signature is not None:
            seen_signatures.add(signature)
        if iteration == budget:
            status, reason = "stopped", "max_iterations"
            break
        # Checked between steps, never mid-gate: Wringer does not abandon a
        # verify half-done to save seconds, so a deadline stops the *next*
        # step rather than killing the one in flight.
        if deadline is not None and time.monotonic() >= deadline:
            status, reason = "stopped", "budget_exhausted"
            break

        brief = bundle.write_brief(
            iteration, _brief(final, root, cfg, scoped, witnesses)
        )
        before_worker = current

        acp_worker = (
            settings.worker
            if isinstance(settings.worker, config.AcpWorker)
            else None
        )
        if acp_worker is not None:
            command = " ".join([acp_worker.command, *acp_worker.args])
            bundle.event(
                "worker.started",
                iteration=iteration,
                command=command,
                worker_kind="acp",
            )
        else:
            command = config.substitute(
                settings.worker,
                brief=brief,
                evidence_dir=verify.bundle_path(final.bundle, root),
                iteration=iteration,
            )
            bundle.event("worker.started", iteration=iteration, command=command)
        try:
            if acp_worker is not None:
                result = _run_acp_worker(
                    bundle, acp_worker, brief, turn_ceiling,
                    iteration, root,
                    containment_settings=worker_containment,
                    established=established,
                )
            else:
                result = _run_worker(
                    bundle, command, turn_ceiling, iteration, root,
                    containment_settings=worker_containment,
                    established=established,
                )
        except KeyboardInterrupt:
            # A worker.started with no worker.finished, mirroring how verify
            # records a gate that was killed mid-flight.
            status = reason = "interrupted"
            break
        bundle.event(
            "worker.finished",
            iteration=iteration,
            exit_code=result.exit_code,
            duration_ms=result.duration_ms,
            **({"timed_out": True} if result.timed_out else {}),
            **getattr(result, "acp_extras", {}),
        )
        # Collected for the sibling file, never for the event above.
        reported = getattr(result, "acp_usage", None)
        if reported is not None:
            usage_rows.append({"iteration": iteration, **reported.as_json()})
        empty_turn = getattr(result, "acp_empty_turn", None)
        if on_worker is not None:
            on_worker(result)

        # **The iteration boundary, and it is here for a reason.** The turn
        # has finished; the next one has not started. `deliver.py`'s standing
        # ruling is inherited verbatim — invalidate AFTER landing, never abort
        # in flight, because a turn that has run cannot be un-run — so this
        # never interrupts a worker and never reverts anything. The landed
        # work stays exactly where it is and the loop declines to spend
        # another turn answering a question that has changed.
        #
        # `wringer.loop.v2` froze `reason` as an OPEN string precisely so a
        # new stop reason costs no schema version, which is why this needs no
        # `loop-event-v3`. The ruling's stale-MARKING event still does, and is
        # deferred until v3 can be designed once carrying both it and the
        # witness pin.
        if staleness.moved(
            briefed, staleness.capture(root), staleness.BOUNDARY_DOCUMENTS
        ):
            status, reason = "stopped", staleness.AUTHORITY_MOVED
            break

    # The holder outlives every worker turn on purpose — it owns the network
    # namespace they join — so it is torn down here, once, when the loop is
    # over. Total by construction like every other cleanup on this path: a
    # failure to remove a container must not replace the loop's real verdict
    # with a cleanup error. `HOLDER_MAX_SECONDS` is the backstop for the one
    # case this line cannot cover, a SIGKILL of the loop itself.
    if worker_containment is not None:
        containment.teardown(worker_containment, bundle.directory)

    # No separate post-loop execution: `verify.run` executes the witnesses on
    # every lap, which is where the pin re-check belongs and which makes each
    # lap's acceptance artifact honest on its own. The first draft ran them
    # once at the end and then had no way to get the result into the
    # acceptance the loop had already written.
    _write_witness_record(bundle, witnesses)

    bundle.event(
        "loop.finished", status=status, reason=reason, iterations=iterations
    )
    final_run = verify.bundle_path(final.bundle, root) if final is not None else None
    bundle.write_manifest(
        state=state,
        run=settings,
        status=status,
        reason=reason,
        iterations=iterations,
        final_run=final_run,
    )
    _write_summary(
        bundle, state, status, reason, iterations, final_run, flaky_gate
    )
    bundle.write_usage(usage_rows)  # absent when nothing was reported
    # AFTER the summary and BEFORE the digests, so `write_digests`'s existing
    # walker covers it without being taught a new filename. Absent — not null —
    # when the final failure matched no face.
    found = _write_diagnosis(bundle, final)
    _write_worker_diagnosis(bundle, empty_turn)
    bundle.write_digests()  # LAST, so it covers the manifest and the summary

    return Outcome(
        directory=bundle.directory,
        status=status,
        reason=reason,
        iterations=iterations,
        final=final,
        flaky_gate=flaky_gate,
        # From the LAST lap's own answer, not recomputed: `final` is the
        # verification the loop stopped on, and `witnesses` holds what those
        # laps executed. Empty for every repository with no witness lane, so
        # their console output is byte-identical.
        unconverted=tuple(
            item.criterion for item in _unconverted(final, witnesses)
        ) if final is not None else (),
        diagnosis=found,
        worker_diagnosis=empty_turn,
    )


def _write_worker_diagnosis(
    bundle: Bundle, empty: diagnose.WorkerDiagnosis | None
) -> None:
    """Write `worker-diagnosis.json`, or nothing at all (R1).

    Same contract as `_write_diagnosis` beside it: a hint that reaches the
    RECORD rather than only the console, absent rather than null when there is
    nothing to say, and never a verdict — nothing that reads this file may let
    it reach acceptance, vacuity or health.
    """
    if empty is None:
        return
    path = bundle.directory / WORKER_DIAGNOSIS_FILENAME
    payload = {
        "schema_version": WORKER_DIAGNOSIS_SCHEMA_VERSION,
        **empty.as_json(),
    }
    path.write_text(
        bundle.redactor.scrub(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
        ),
        encoding="utf-8",
    )


def _failing_result(outcome: verify.Outcome | None) -> gates.GateResult | None:
    """The `GateResult` for the gate this verification stopped on, or None."""
    if outcome is None or outcome.failed_gate is None:
        return None
    return next(
        (r for r in outcome.results if r.gate.id == outcome.failed_gate), None
    )


def _write_diagnosis(
    bundle: Bundle, final: verify.Outcome | None
) -> diagnose.Diagnosis | None:
    """Write `diagnosis.json`, or nothing at all when no face matched.

    **A routing diagnosis, never a verdict** — SPEC_ENV ruling 1, kept verbatim
    in the schema's own description. Nothing that reads this file may let it
    reach acceptance, vacuity or health; `health.genuine_failure` keeps
    discounting 127 from the exit code it reads itself.

    It is a sibling rather than a field on `result` because that object is
    `additionalProperties: false` in the frozen `wringer.loop.v2` manifest
    schema. This is `usage.json`'s answer to the identical problem, and
    `vacuity.json`'s before it.

    Absence is meaningful and is the common case: a loop whose gates failed for
    ordinary reasons writes no `diagnosis.json` at all, so a reader that finds
    one knows the environment was implicated without having to read a null.
    """
    failing = _failing_result(final)
    if failing is None:
        return None
    found = diagnose.diagnose(failing)
    if found is None:
        return None
    path = bundle.directory / DIAGNOSIS_FILENAME
    payload = {"schema_version": DIAGNOSIS_SCHEMA_VERSION, **found.as_json()}
    path.write_text(
        bundle.redactor.scrub(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
        ),
        encoding="utf-8",
    )
    return found


def _flaky_failure(outcome: verify.Outcome) -> str | None:
    """The failing gate's id when its own attempts disagreed, else None.

    Read off the stability RECORD this verification just wrote, never inferred
    from a red tick and never from a gate's output: the classifier is the one
    in `stability.py` and there is deliberately no second one here. A gate with
    no `stability:` policy has no row, so this is None for every repo that
    never opted in — which is what keeps the loop's behaviour byte-identical
    for them.
    """
    if outcome.failed_gate is None:
        return None
    row = outcome.stability.of(outcome.failed_gate)
    if row is None or row.routing != stability.NO_REPAIR:
        return None
    return outcome.failed_gate


def _run_worker(
    bundle: Bundle,
    command: str,
    timeout: int,
    iteration: int,
    root: Path,
    containment_settings: config.Containment | None = None,
    established: containment.Established | None = None,
) -> gates.GateResult:
    """Run the worker through the gate runner, for its process-group kill,
    its bounded drain, and its scrub-then-cap log writing.

    Under a containment the command is not the worker's own — it is a runtime
    argv that carries the worker's command into a container. `gates.run` is
    still what spawns it, so the timeout ladder, the process group, the
    bounded drain and the scrub-then-cap logging are the same machinery in
    both cases. That machinery took four bolts to get right and is not
    reimplemented for a second spawn path.
    """
    directory = bundle.iteration_dir(iteration)
    pgid_file = directory / PGID_FILENAME

    def remember(pid: int) -> None:
        # Written the instant the worker exists, so a SIGKILL of this loop
        # still leaves `wring resume` something to reap. A plain file rather
        # than an event: it is operational state, not a claim about the run.
        pgid_file.write_text(str(pid), encoding="utf-8")

    spawn = command
    if containment_settings is not None and established is not None:
        # **Path translation, and without it every documented worker command
        # fails on its first line.** `{brief}` substitutes an absolute HOST
        # path, and the documented worker form is
        # `claude -p "$(cat {brief})"`; inside a container with the repository
        # at /workspace that file does not exist, so the worker's first act
        # would be to read a brief that is not there. That is F3 in a new
        # costume — the worker not being told what it is building — and it
        # would look like an agent failure rather than a mount problem.
        #
        # `shlex.join`, never `" ".join`: this string goes to `gates.run`,
        # which spawns with `shell=True`, and the worker's own command is the
        # last element — full of spaces, quotes and `$(...)`. Joining by hand
        # would let the shell re-split it, which is a different command from
        # the one the repository wrote down.
        spawn = shlex.join(
            containment.argv(
                containment_settings,
                established,
                containment.translate(command, root),
                root,
                directory,
            )
        )

    result = gates.run(
        config.Gate(id=WORKER_ID, run=spawn, timeout=timeout),
        cwd=root,
        stdout_path=directory / "worker.stdout.log",
        stderr_path=directory / "worker.stderr.log",
        redactor=bundle.redactor,
        on_spawn=remember,
    )
    if containment_settings is not None:
        # The container the runtime CLIENT started outlives a kill of the
        # client, so a timeout that killed the process group would otherwise
        # leave the worker running against the mounted tree — the timeout not
        # being enforced at all. By cidfile, never by pgid: a container has no
        # host process group, and on macOS it lives inside the runtime's VM.
        containment.teardown(containment_settings, directory)
    # It finished, so there is nothing to reap and a stale pgid could name a
    # process the OS has since given to somebody else.
    pgid_file.unlink(missing_ok=True)
    return result


def _run_acp_worker(
    bundle: Bundle,
    worker: config.AcpWorker,
    brief: Path,
    timeout: int,
    iteration: int,
    root: Path,
    containment_settings: config.Containment | None = None,
    established: containment.Established | None = None,
) -> gates.GateResult:
    """One ACP session, shaped into the same GateResult a shell worker gives.

    The loop must not care which form ran — that is what keeps the breaker,
    the wall clock, the plateau check and the ledger identical for both.
    """
    directory = bundle.iteration_dir(iteration)
    stdout_path = directory / "worker.stdout.log"
    stderr_path = directory / "worker.stderr.log"
    pgid_file = directory / PGID_FILENAME
    started = time.monotonic()
    extras: dict[str, Any] = {"worker_kind": "acp"}
    tree_before = _tree_fingerprint(root)

    def remember(pid: int) -> None:
        # Exactly what `_run_worker` does, and it was missing here. The ACP
        # agent runs in its own process group — `run_turn` starts a new
        # session — so a SIGKILL of this loop cannot signal it, and without
        # this file `wring resume` had nothing to reap: a real agent process,
        # holding a real session and editing a real repo, outliving its
        # supervisor with no record that it ever existed. `wring resume`
        # exists FOR the killed loop, which made this the one path where the
        # supervision promise did not hold.
        pgid_file.write_text(str(pid), encoding="utf-8")

    try:
        turn, exit_code = acp.run_turn(
            command=worker.command,
            args=worker.args,
            env_passthrough=worker.env_passthrough,
            brief=brief.read_text(encoding="utf-8"),
            root=root,
            timeout=timeout,
            stdout_path=stdout_path,
            stderr_path=stderr_path,
            on_spawn=remember,
            # The agent's stderr and its session updates both become files in
            # this bundle, so they get the bundle's redactor — the same one
            # every other write path here already uses.
            redactor=bundle.redactor,
            # **Both spawn paths now carry the boundary** (SPEC_CONTAIN_V0
            # §11). Passed unconditionally: `run_turn` treats a None pair as
            # uncontained, which is byte-for-byte today's behaviour for every
            # repository that declares no containment.
            containment_settings=containment_settings,
            established=established,
            workdir=directory,
        )
    except acp.AcpError as exc:
        # It is over either way, so the pgid goes: a stale one names a process
        # the OS may since have given to somebody else.
        pgid_file.unlink(missing_ok=True)
        # Not a verdict about the code — a failed worker turn, which the
        # evidence will judge on the next lap like any other.
        #
        # **Read off the exception, not off its words.** This was
        # `"deadline" in str(exc)` until the message came to carry the agent's
        # own `data` verbatim; after that, an agent that used the word in its
        # remedy would have been recorded as having timed out, and a timeout
        # is the one ending `diagnose_failed_turn` deliberately says nothing
        # about. The fact travels on `AcpError.timed_out`.
        timed_out = exc.timed_out
        # **Scrubbed HERE, once, rather than at each surface.** The agent's
        # error now reaches the console (`_report_worker_diagnosis`), the
        # ledger, `worker-diagnosis.json` and the bundle log — and the agent
        # is handed a credential by name through `env_passthrough`, so its
        # own words are exactly the kind of text that can carry one back. The
        # writes below scrub again and that is free; the console print does
        # not, and this is the only point upstream of all of them.
        said = bundle.redactor.scrub(str(exc))
        # APPENDED, never written over. `run_turn`'s `finally` has already put
        # whatever the agent managed to say into this file, and on a failed
        # turn that is the entire diagnostic value of the bundle — the last
        # words before it died. Overwriting them left a log that recorded only
        # that something went wrong, which is the half a reader already knows.
        # A shell worker keeps its stdout when it crashes; SPEC_ACP_V0 §2 says
        # an ACP worker leaves the same shape of evidence, so it keeps its own.
        #
        # Scrubbed like every other write into a bundle — one line up now,
        # because the same words also reach a console this file cannot scrub.
        with stdout_path.open("a", encoding="utf-8") as log:
            log.write(f"[wringer: ACP turn failed] {said}\n")
        if not stderr_path.exists():
            stderr_path.write_text("", encoding="utf-8")
        result = gates.GateResult(
            gate=config.Gate(id=WORKER_ID, run=worker.command, timeout=timeout),
            exit_code=1,
            duration_ms=int((time.monotonic() - started) * 1000),
            timed_out=timed_out,
            stdout_path=stdout_path,
            stderr_path=stderr_path,
        )
        object.__setattr__(result, "acp_extras", {**extras, "acp_error": said})
        # **The ending that used to have no shape.** This branch returned here
        # with no diagnosis of any kind, so a refused turn — an agent that has
        # never been logged in answers `session/prompt` with exactly this —
        # reached the operator as `no_progress` and the sentence "an engineer
        # has to look at why it is stuck". A product manager hit it on
        # 2026-08-21, and the one fact that would have unstuck them was in a
        # log file nobody told them about.
        #
        # The ledger comes off the exception, so the counts are READ rather
        # than assumed; when the failure predates the turn they are None and
        # the record says nothing about them rather than claiming zero.
        partial = getattr(exc, "turn", None)
        refused = diagnose.diagnose_failed_turn(
            timed_out=timed_out,
            files_written=len(partial.files_written) if partial else None,
            refusals=len(partial.refusals) if partial else None,
            engine_words=said,
        )
        if refused is not None:
            object.__setattr__(result, "acp_empty_turn", refused)
        return result
    finally:
        if containment_settings is not None:
            # The container the runtime CLIENT started outlives a kill of the
            # client, so a session that died mid-turn would otherwise leave the
            # agent running against the mounted tree. The shell path does this
            # for the same reason (`_run_worker`); in a `finally` here because
            # the failure path returns early, and a reap that only runs when
            # the turn succeeded reaps exactly the cases that do not need it.
            containment.teardown(containment_settings, directory)

    # The session is over, so the group is gone with it.
    pgid_file.unlink(missing_ok=True)

    for permission in turn.permissions:
        bundle.event(
            "worker.permission",
            iteration=iteration,
            tool=permission["tool"],
            outcome=permission["outcome"],
        )

    extras["stop_reason"] = turn.stop_reason
    if turn.agent_name:
        extras["agent_name"] = turn.agent_name
    if turn.agent_version:
        extras["agent_version"] = turn.agent_version
    if turn.protocol_version:
        extras["protocol_version"] = turn.protocol_version
    if turn.refusals:
        extras["refused_paths"] = len(turn.refusals)

    result = gates.GateResult(
        gate=config.Gate(id=WORKER_ID, run=worker.command, timeout=timeout),
        exit_code=exit_code,
        duration_ms=int((time.monotonic() - started) * 1000),
        timed_out=False,
        stdout_path=stdout_path,
        stderr_path=stderr_path,
    )
    object.__setattr__(result, "acp_extras", extras)
    # Carried BESIDE `acp_extras`, deliberately. Everything in `acp_extras` is
    # splatted into the `worker.finished` event, whose published schema is
    # frozen and `additionalProperties: false`; usage travels on its own
    # attribute and lands in the `usage.json` sibling instead (law 7).
    if turn.usage is not None:
        object.__setattr__(result, "acp_usage", turn.usage)
    # R1: the turn ended, and the LEDGER says whether anything happened in it.
    # Beside `acp_extras` for the same frozen-schema reason as usage.
    empty = diagnose.diagnose_turn(
        stop_reason=turn.stop_reason,
        files_written=len(turn.files_written),
        refusals=len(turn.refusals),
        errored=False,
        engine_words=(turn.updates[-1].strip() if turn.updates else ""),
        changed_tree=_tree_fingerprint(root) != tree_before,
    )
    if empty is not None:
        object.__setattr__(result, "acp_empty_turn", empty)
    return result


def _tree_fingerprint(root: Path) -> str:
    """What the working tree looks like right now — enough to tell whether a
    worker turn touched anything.

    **Measured in the full run of 2026-08-26, and it is why this exists.** The
    ACP ledger counts files the agent wrote THROUGH THE PROTOCOL. An agent
    holding its own filesystem tools writes none that way, so `files_written`
    was 0 on a turn that changed seven files and 174 lines and turned the
    acceptance check green. `worker-diagnosis.json` recorded
    `turn_changed_nothing` and told the operator the agent "finished its turn
    without changing a file… this usually means it could not authenticate" —
    on the converged run whose convergence that turn caused.

    The ledger is not wrong about ACP writes; it is blind to every other way a
    file gets written, and a diagnosis derived from it alone speaks
    confidently about a repository it did not look at. This looks at it.

    Two `git` calls, measured at 18ms and 16ms on a real project. `git status`
    names every changed and untracked path (`-uall`, for `inspect`'s reason);
    `git diff HEAD` carries the CONTENT of tracked edits, so an agent that
    rewrote a file already listed as modified still moves this value.

    **Wringer's own workspace is excluded**, and that is not tidiness. This
    loop writes the turn's logs into `.wringer/` WHILE the turn runs, so a
    fingerprint that counted them would move on every turn ever taken — the
    idle turn included, which is the one shape the diagnosis exists for. The
    same reason `git.inspect`'s docstring gives for calling it before the
    bundle is written.

    **Untracked files are covered by their size and modification time**, not
    by their contents. An agent rewriting a file that was already untracked
    before its turn creates no new path and changes no tracked byte, so a
    fingerprint of names and tracked diffs alone would miss it — and that is
    not a corner: it is what this repository's own `ownhands` fixture does, and
    what an agent does in any project whose work is not yet committed. Reading
    every untracked file instead would be unbounded (`node_modules`), while
    `git status` has already walked exactly this list, so a stat per entry is
    the same order of cost as the call above it.

    **The limit that remains, said rather than left to be discovered**: a write
    that reproduces a file's exact size AND its exact nanosecond timestamp is
    invisible here. Such a write also changed nothing.
    """
    ours_prefix = evidence.WRINGER_DIRNAME

    def ours(path: str) -> bool:
        return path == ours_prefix or path.startswith(ours_prefix + "/")

    state = git.inspect(root)
    untracked = [p for p in state.untracked if not ours(p)]
    stamps = []
    for path in untracked:
        try:
            stat = (root / path).stat()
        except OSError:
            # Vanished between the listing and here, which is itself a change.
            stamps.append(f"{path}\0gone")
            continue
        stamps.append(f"{path}\0{stat.st_size}\0{stat.st_mtime_ns}")
    parts = [
        "\n".join(p for p in state.changed_files if not ours(p)),
        "\n".join(stamps),
        git.diff(root, state.head_sha) or "",
    ]
    return hashlib.sha256("\0".join(parts).encode("utf-8", "replace")).hexdigest()


def usage_totals(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Add up what the agent reported, and refuse to add what cannot be added.

    Tokens add across sessions: each session's figure is that session's own
    cumulative total, and the sessions are independent.

    **Money adds only within one currency.** A total of "3.5" over a USD row
    and a EUR row is a number with no meaning, and this program does not hold
    exchange rates — that would be a live vendor fact with a shelf life,
    exactly what the no-price-table ruling refuses. Mixed currencies therefore
    produce token totals and NO cost total, and the absence says so.
    """
    totals: dict[str, Any] = {
        "used": sum(int(row.get("used") or 0) for row in rows),
        "size": max((int(row.get("size") or 0) for row in rows), default=0),
        "sessions": len(rows),
    }
    costs = [row["cost"] for row in rows if isinstance(row.get("cost"), dict)]
    currencies = {cost.get("currency") for cost in costs}
    if costs and len(currencies) == 1:
        totals["cost"] = {
            "amount": round(sum(float(cost.get("amount") or 0.0) for cost in costs), 6),
            "currency": costs[0].get("currency"),
        }
    return totals


def _pin_witnesses(
    bundle: Bundle,
    root: Path,
    containment_settings: config.Containment | None,
    established: containment.Established | None,
) -> list[witness.Witness]:
    """Establish the born red, pin it, and record the pin. Or VOID.

    **Three things happen here and the order is the argument** (W4):

    1. The ledger's own hash chain is walked BEFORE any pin is trusted. Today
       the chain is walked only by `attest.audit` — i.e. after somebody
       attests and then audits — never at the moment a pin is read. A pin read
       out of a ledger nobody checked is a pin that proves nothing.
    2. Born red is established on a **HEAD worktree**, not on the working
       tree. The spec's first draft said the working tree *is* the pre-change
       tree because the worker has not run, and then said the HEAD worktree at
       proving time is the same tree — which agree only when the tree is
       clean, and nothing enforces that. Using the same mechanism makes the
       identity true by construction.
    3. A witness that is born GREEN, or that the runner could not COLLECT, is
       discarded and its criterion reported uncovered. That is W8, and it is
       the hole that let four criteria come back `evidenced` on the strength of
       an import error.

    Absence is absence: a repository with no witness lane gets an empty list
    and every downstream behaviour is byte for byte what it was.
    """
    found = witness.load(root)
    if not found:
        return []

    # (1) The chain, before anything in it is believed.
    try:
        attest.check_chain(bundle.directory / EVENTS_FILENAME, "loop")
    except attest.Refused as exc:
        raise witness.WitnessError(
            f"the loop ledger's hash chain is broken ({exc}), so a pin read "
            "out of it cannot be trusted. This VOIDs the run"
        ) from exc

    # (2) The pre-change tree, by the mechanism that makes it one.
    tree = fleet.make_worktree(root, f"witness-{bundle.directory.name}")
    if tree is None:
        raise witness.WitnessError(
            "a scratch worktree could not be created, so no witness could be "
            "proved red against the pre-change tree. Nothing is claimed either "
            "way and the run does not proceed on an unproved witness"
        )
    try:
        for item in found:
            # **Proved where it will be EXECUTED, which is where the gates run**
            # — not inside the worker's containment. This passed the worker's
            # containment through until 2026-08-16, and the first real corpus
            # task under the fixed lane measured the consequence.
            #
            # `witness.execute`'s own docstring already says the witness runs
            # where the gates run, and `verify._run_witnesses` already passed no
            # established containment. So proving contained and executing
            # uncontained meant the two halves of one claim ran in two different
            # environments — and the worker image has the AGENT, not the
            # project's dependencies. On `marshmallow-constant-required` the
            # proving run came back `/usr/bin/python3: No module named pytest`,
            # exit 1, no exception class recorded, which `classify` read as a
            # genuine ASSERTION. The row went out `covered: true`,
            # `verdict: proven`, for a witness that had never run.
            #
            # That is a FALSE proved-red — §5.1's coverage number inflated by
            # witnesses that could not execute — and it is worse than an
            # uncovered criterion, which merely goes to a human.
            witness.prove_red(tree, item)
    finally:
        fleet.remove_worktree(root, tree)

    for item in found:
        pinned = witness.pin(item, bundle.directory.name)
        item.record["pinned"] = pinned
    # **No ledger event, and that is a correction rather than a preference.**
    # The first draft emitted `witness.pinned` and `witness.executed` into
    # `loop.jsonl`, whose `type` is a CLOSED enum of eight branches with
    # `additionalProperties: false` on every one — so every bundle with a
    # witness lane wrote a ledger that failed its own published, frozen schema.
    # This module says so 375 lines above, where it declines to emit a
    # containment event for exactly this reason, and `SPEC_GATEGEN` §6 W6 names
    # the cost in advance: the pin event needs `loop-event-v3`.
    #
    # The facts have a home that costs no version — the sibling `witness.json`,
    # on the `vacuity.json` pattern — so they go there and the frozen schema is
    # left alone. Designing v3 once, carrying both this and the staleness
    # rider's stale-marking event, is still the right move and is still owed.
    return found


def _write_witness_record(bundle: Bundle, witnesses: list) -> Path | None:
    """The lane's own sibling artifact, `witness.json` (`wringer.witness.v1`).

    A SIBLING file rather than ledger events, and that is a correction the
    independent review forced: the first draft emitted `witness.pinned` and
    `witness.executed` into `loop.jsonl`, whose `type` is a CLOSED enum with
    `additionalProperties: false` on every branch — so every bundle carrying a
    witness lane wrote a ledger that failed its own published, frozen schema.
    This module declines a containment event 200 lines above for exactly that
    reason. `vacuity.json` set the pattern: a new file costs no version.

    Absent entirely from every run with no witness lane.
    """
    if not witnesses:
        return None
    payload = {
        "schema_version": witness.SCHEMA_VERSION,
        "witnesses": [
            {
                # **NAMED FIELDS, never a splat of the stored record**, and
                # this is the review's finding 5 folded. `witness.load` sets
                # `record` verbatim from the store's own `witness.json`, and
                # splatting it into this row — which `witness.schema.json`
                # closes with `additionalProperties: false` — means one extra
                # key in the store produces a bundle that fails its own
                # published, frozen schema. That is HIGH finding 2 of the
                # PREVIOUS review ("every bundle carrying this lane wrote a
                # ledger that failed its own published schema") arriving one
                # file over, and the schema being frozen now is exactly what
                # makes a future store field trigger it.
                "id": item.record.get("id", f"w-{item.criterion}"),
                "proves": item.record.get("proves", item.criterion),
                "path": item.record.get("path", item.filename),
                "authored": item.record.get("authored", {}),
                **(
                    {"pinned": item.record["pinned"]}
                    if item.record.get("pinned") is not None else {}
                ),
                "proved_red": (
                    {
                        "outcome": item.proved_red.outcome,
                        "exit_code": item.proved_red.exit_code,
                        "first_line": item.proved_red.first_line,
                        "verdict": (
                            witness.PROVEN if item.usable
                            else witness.NOT_ESTABLISHED
                        ),
                    }
                    if item.proved_red is not None else None
                ),
                "executed": (
                    {
                        "sha256": item.sha256,
                        "result": (
                            "passed" if item.executed.passed else "failed"
                        ),
                        "exit_code": item.executed.exit_code,
                    }
                    if item.executed is not None else None
                ),
                "discarded": item.discarded,
            }
            for item in witnesses
        ],
        "limits": list(witness.LIMITS),
    }
    path = bundle.directory / witness.WITNESS_FILENAME
    # Through the redactor, like every other artifact this bundle writes. The
    # first draft wrote it raw, and the payload carries output lifted from
    # model-authored Python that ran with the whole host environment.
    text = json.dumps(payload, indent=2) + "\n"
    path.write_text(bundle.redactor.scrub(text), encoding="utf-8")
    return path


def _brief(
    outcome: verify.Outcome,
    root: Path,
    cfg: config.Config,
    scoped: set[str] | None = None,
    witnesses: list[witness.Witness] | None = None,
) -> str:
    """What the worker is told: what is being built, then what is broken.

    The second half is the repair brief, unchanged since v0.2. The first half
    is F3, measured in `docs/factory-dry-run.md` §4: a loop handed a worker
    thirty-five lines about a missing pytest and not one word about the CSV
    export it had been asked to build. `wring plan` knew the objective and did
    not pass it on; `wring run` knew what was broken and did not know why.
    Nothing carried the PM's intent across the gap, and what the worker is
    told IS this product's output quality — Wringer never writes the code.

    Assembled entirely from files the repo already holds. **No model is asked
    anything here**, as nowhere else in this module, and the redactor still
    owns the write (`Bundle.write_brief`).
    """
    return (
        _objective(root, cfg, scoped)
        + _repair_brief(outcome, root)
        + "\n".join(witness.brief_section(witnesses or []))
    )


def _objective(
    root: Path, cfg: config.Config, scoped: set[str] | None = None
) -> str:
    """What is being built — or nothing at all, which is most repos.

    The opt-in boundary is **approval**, exactly as acceptance's is
    (docs/specs/SPEC_ACCEPT_V0.md ruling 8), and it is read through acceptance's own
    reader so the two cannot drift apart. Triggering on the file existing
    would put a model's unread draft into the instructions a worker acts on,
    which is the interlock SPEC_INTENT §3 owns. Without an approved spec this
    returns the empty string and the brief is byte-identical to the one this
    loop has written since v0.2.
    """
    approved = accept.read_spec(root)
    if approved is None:
        return ""

    lines = [
        "# What you are building",
        "",
        f"**{approved.title}** — from `{spec.SPEC_FILENAME}`, which a human "
        "approved.",
        "",
        _clip(approved.intent.strip(), spec.SPEC_FILENAME),
        "",
        *_task_lines(root, approved),
        *_criteria_lines(approved, cfg, scoped),
        "Everything above is what this work is for. Everything below is the "
        "gate that failed on this lap.",
        "",
    ]
    return "\n".join(lines) + "\n"


def _task_lines(root: Path, approved: spec.Spec) -> list[str]:
    """The one task this loop is running, and the brief `wring plan` wrote."""
    task, absent = _task(approved)
    if task is None:
        return ["## This task", "", absent, ""]

    lines = [
        f"## This task — `{task.id}`",
        "",
        task.objective.strip(),
        "",
    ]
    found = _task_brief(root, task)
    if found is not None:
        where, text = found
        lines += [f"### The brief for it (`{where}`)", "", _quote(text), ""]
    return lines


def _quote(text: str) -> str:
    """Another file's contents, verbatim and fenced.

    Fenced rather than pasted because `wring plan` writes briefs with their
    own `#` headings, and inlined bare they land under this document's — so
    the task's "Decisions already made" reads as a peer of "What finishing
    means" and the boundary between the two files disappears. Caught by
    reading the first real brief this produced.

    The fence is as long as it needs to be: a brief about markdown carries
    backticks of its own, and a three-tick fence would close inside it and
    hand the worker a broken document.
    """
    longest = max((len(run) for run in re.findall(r"`+", text)), default=0)
    fence = "`" * max(3, longest + 1)
    return f"{fence}markdown\n{text}\n{fence}"


def _task(approved: spec.Spec) -> tuple[spec.Task | None, str]:
    """Which of the spec's tasks this is, or why the loop cannot say.

    Under `wring fleet` the child is told by name. Under a bare `wring run` a
    spec declaring one task leaves nothing to choose between; a spec declaring
    several and naming none is a question this module refuses to answer by
    guessing, and says so in the brief instead.
    """
    named = os.environ.get(TASK_ID_ENV, "").strip()
    if named:
        for task in approved.tasks:
            if task.id == named:
                return task, ""
        return None, (
            f"`{TASK_ID_ENV}` names '{named}', which `{spec.SPEC_FILENAME}` "
            "does not declare, so no objective is quoted here."
        )
    if len(approved.tasks) == 1:
        return approved.tasks[0], ""
    return None, (
        f"`{spec.SPEC_FILENAME}` declares {len(approved.tasks)} tasks and "
        f"nothing named which one this loop is running (`{TASK_ID_ENV}` is "
        "unset), so no objective is quoted here."
    )


def _task_brief(root: Path, task: spec.Task) -> tuple[str, str] | None:
    """The task's own brief file: where it came from, and what it says.

    `wring fleet` passes this file to a child as `WRINGER_TASK_BRIEF`, an
    absolute path a worker had to know to read — which is how the objective
    reached a worker before this, and only if it had been written to look for
    it. It is read HERE instead, and the variable stays set for the workers
    that already read it.

    Total by construction, like `accept.read_spec`: a brief that is missing,
    unreadable or empty leaves the objective standing on its own rather than
    taking a loop down over a document.
    """
    candidates: list[Path] = []
    declared = os.environ.get(TASK_BRIEF_ENV, "").strip()
    if declared:
        candidates.append(Path(declared))
    try:
        candidates.append(spec.resolve_inside(root, task.brief, task.brief))
    except spec.SpecError:
        pass

    for path in candidates:
        try:
            # Bounded at the read, not after it: a repository is allowed to
            # hold a file too big to paste into anything.
            with path.open(encoding="utf-8", errors="replace") as stream:
                text = stream.read(BRIEF_PROSE_CHARS + 1)
        except OSError:
            continue
        if not text.strip():
            continue
        where = (
            path.relative_to(root).as_posix()
            if path.is_relative_to(root)
            else path.as_posix()
        )
        return where, _clip(text.strip(), where)
    return None


def _criteria_lines(
    approved: spec.Spec, cfg: config.Config, scoped: set[str] | None = None
) -> list[str]:
    """Every criterion, and whether anything in this repo proves it.

    `UNBOUND` is the honest answer for a criterion no gate names, and it is
    most of them the day a spec is approved (ruling 9). Saying so is the
    point: a worker that knows which of its objectives nothing can check
    knows where the work is not going to be caught.

    **Nothing here proposes a gate, and nothing binds one.** Which gate
    evidences a criterion whose feature does not exist yet is F2's question
    and it has no spec yet.

    `scoped` marks ownership (SPEC_SCOPE_V0 ruling 3): a criterion is THIS
    TASK's when the gate bound to it is one this loop is converging on. That
    is ruling 1's join read backwards, and it needs no new vocabulary — the
    `{proves: id}` map below already computed it.

    The other tasks' criteria stay VISIBLE and are marked as theirs rather
    than hidden. A worker that cannot see the whole spec cannot tell when its
    change breaks a neighbour's criterion, and hiding them would trade the
    instruction pathology this cycle fixes for a blindness it does not.
    """
    bound = {gate.proves: gate.id for gate in cfg.gates if gate.proves}
    machine = [c for c in approved.criteria if not c.human]

    lines = ["## What finishing means", ""]
    if machine:
        lines += [
            "The acceptance criteria a human approved, and the gate bound to "
            "each:",
            "",
        ]
        for criterion in machine:
            gate_id = bound.get(criterion.id)
            binding = (
                f"bound to `{gate_id}`"
                if gate_id
                else "UNBOUND (no gate proves it yet)"
            )
            owner = ""
            if scoped is not None and gate_id:
                owner = (
                    " — THIS TASK"
                    if gate_id in scoped
                    else " — another task's, and not this loop's to fix"
                )
            lines.append(
                f"- `{criterion.id}` — {criterion.title} — {binding}{owner}"
            )
        lines.append("")

    human = [criterion.id for criterion in approved.criteria if criterion.human]
    if human:
        named = ", ".join(f"`{criterion}`" for criterion in human)
        # One line, and never their guidance: a worker has no business
        # optimising for taste no gate can judge it on.
        lines += [
            f"Some are judged by people, not gates: {named}. Their guidance is "
            "deliberately not in this brief — nothing you do to a gate can "
            "satisfy them.",
            "",
        ]
    return lines


def _clip(text: str, where: str) -> str:
    """Quote prose whole when it fits, and name the file when it does not."""
    if len(text) <= BRIEF_PROSE_CHARS:
        return text
    return (
        text[:BRIEF_PROSE_CHARS].rstrip()
        + f"\n\n[... clipped here; the whole of it is in `{where}` ...]"
    )


def _repair_brief(outcome: verify.Outcome, root: Path) -> str:
    """What the worker is told about the failure: the machine-readable
    verdict, the failing gate, and enough of its output to act without
    opening the bundle."""
    summary = verify.json_summary(outcome, root)
    lines = [
        "# Fix this",
        "",
        "`wring verify` failed. This is the structured result an agent would",
        "get from `wring verify --json`:",
        "",
        "```json",
        json.dumps(summary, indent=2),
        "```",
        "",
    ]

    failing = next(
        (r for r in outcome.results if r.gate.id == outcome.failed_gate), None
    )
    if failing is not None:
        lines += [
            f"## Failing gate: `{failing.gate.id}`",
            "",
            f"- command: `{failing.gate.run}`",
            f"- exit code: {failing.exit_code}",
        ]
        if failing.timed_out:
            lines.append(f"- timed out after {failing.gate.timeout}s")
        lines.append("")
        for label, path in (
            ("stdout", failing.stdout_path),
            ("stderr", failing.stderr_path),
        ):
            tail = _tail(path)
            if tail:
                lines += [f"### {label}", "", "```", tail, "```", ""]

    # **The hint, labelled a guess — SPEC_ENV ruling 2's hint tier.**
    #
    # GATEGEN finding 8's discipline, applied at birth: this brief's reader is
    # increasingly a machine, so the section states FACTS and permits exactly
    # ONE imperative — stop changing files and say why. It must not instruct an
    # install. A worker mutating the environment mid-loop turns gates green for
    # a reason no record carries, which is worse than the failure it fixes.
    #
    # A worker that obeys hands the loop a clean `no_progress` on the next lap,
    # which is the honest end and the one ruling 5 chose on purpose.
    found = diagnose.diagnose(failing) if failing is not None else None
    if found is not None:
        lines += [
            "## This may not be a code problem",
            "",
            f"**A guess, not a verdict.** `{found.gate}` {found.description}.",
            "It was read from the gate's own output, on this line:",
            "",
            "```",
            found.evidence,
            "```",
            "",
            "Nothing in this tree may explain that, and no edit here would fix",
            "it. **If you conclude the fix is outside this tree, stop changing",
            "files and say why.** Do not install anything and do not change the",
            "environment: a gate that turns green because the environment moved",
            "under it proves nothing, and no record would carry the reason.",
            "",
        ]

    lines += [
        "## What to do",
        "",
        "Fix the failure above, then re-check with:",
        "",
        "```",
        str(summary["rerun"] or "wring verify"),
        "```",
        "",
        "The whole evidence bundle — diff, status, every gate's logs — is at "
        f"`{summary['evidence_dir']}`.",
        "Do not edit anything under `.wringer/`: that is the evidence, not the code.",
        "",
    ]
    return "\n".join(lines)


def _tail(path: Path) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    lines = text.splitlines()
    if not lines:
        return ""
    kept = lines[-BRIEF_TAIL_LINES:]
    dropped = len(lines) - len(kept)
    note = f"[... {dropped} earlier lines, see the bundle ...]\n" if dropped else ""
    return note + "\n".join(kept)


_REASONS = {
    "converged": "every required gate passed",
    "max_iterations": "the iteration budget ran out",
    "no_progress": "the worker changed nothing, so the gates would say the same",
    "oscillating": "the same failure came back, so the worker is not converging",
    "budget_exhausted": "the wall-clock budget ran out",
    FLAKY_GATE: "the failing gate is nondeterministic, so there is nothing in "
    "the tree for a worker to fix",
    ENVIRONMENT: "the first gate could not run at all — the command is not on "
    "PATH — so nothing in the tree explains it and no worker was briefed",
    staleness.AUTHORITY_MOVED: "the spec, the rubric or the gate config moved "
    "after this loop was briefed, so the landed work answers a question that "
    "has changed. Nothing is reverted",
    "interrupted": "stopped before it finished",
}


def _write_summary(
    bundle: Bundle,
    state: git.RepoState,
    status: str,
    reason: str,
    iterations: int,
    final_run: str | None,
    flaky_gate: str | None = None,
) -> None:
    events = [
        json.loads(line)
        for line in (bundle.directory / EVENTS_FILENAME)
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    verifies = {e["iteration"]: e for e in events if e["type"] == "verify.finished"}
    workers = {e["iteration"]: e for e in events if e["type"] == "worker.finished"}

    name = state.root.name or str(state.root)
    head = f"`{state.head_sha[:7]}`" if state.head_sha else "not a git repository"
    lines = [
        f"# wring run — {bundle.loop_id}",
        "",
        f"- repo: **{name}** @ {head}",
        f"- started: {bundle.started_at.replace(microsecond=0).isoformat()}",
        f"- result: **{status}** — {_REASONS.get(reason, reason)}",
        f"- iterations: {iterations}",
        "",
        "| iteration | verify | worker | evidence |",
        "|---|---|---|---|",
    ]
    for number in sorted(verifies):
        row = verifies[number]
        outcome = row["status"]
        if row.get("failed_gate"):
            outcome += f" (`{row['failed_gate']}`)"
        worker = workers.get(number)
        if worker is None:
            told = "—"
        else:
            told = f"exit {worker['exit_code']}"
            if worker.get("timed_out"):
                told += ", timed out"
        lines.append(f"| {number} | {outcome} | {told} | `{row['evidence_dir']}` |")

    if flaky_gate is not None:
        lines += [
            "",
            f"> ⚠ **No worker ran. `{flaky_gate}` is nondeterministic** — it did "
            "not give the same answer twice on one tree, so nothing in the tree "
            "explains the difference and there is nothing in it for a worker to "
            "fix. An agent briefed with this gate would edit source that was "
            "never wrong, and the next draw coming up green would read as a "
            "fix. Fix the gate, then run again. The attempts are in the final "
            "verification's `stability.json`.",
        ]
    if final_run:
        lines += ["", f"Final verification: `{final_run}`"]
    (bundle.directory / SUMMARY_FILENAME).write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )

