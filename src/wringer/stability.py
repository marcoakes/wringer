"""Flaky gates — run a gate more than once and classify what came back.

SPEC_STABILITY_V0.md. The whole feature is one refusal and one routing rule:

**Classification comes from the observations and from nothing else.** Three
passes is `stable_pass`, three failures is `stable_fail`, a mixture is `flaky`,
fewer attempts than were asked for is `unknown`. No gate's *output* is read
here — not for the word "flaky", not for a retry hint, not for anything. A
classifier that reads text is a classifier a worker can talk to, and the
worker is the party being supervised.

**A flaky gate is never handed to a worker as something to fix.** That is the
defect this module exists to prevent: a nondeterministic gate looks exactly
like a failing one, so a repair loop hands it to an agent, the agent edits
source that was never wrong, and the next draw comes up green and calls it a
fix. `run.routing` records which of those two things a gate is, and `loop.py`
reads it instead of guessing from a red tick.

**Never hide a retry.** Every attempt gets its own directory, its own
`result.json` and its own logs; `stability.json` says how many were asked for
and how many ran. A retried gate that reports one clean result is the shape a
hidden flake wears, so the record makes it unwearable.

The compatibility boundary is the `stability:` key's ABSENCE. A gate that
declares none runs once, writes no attempts directory, and contributes no row
here — and a repo with no `stability:` anywhere writes a byte-identical bundle
to the one it wrote before this module existed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from wringer import config, evidence, gates
from wringer.redact import Redactor

SCHEMA_VERSION = "wringer.stability.v1"
# A sibling of `manifest.json`, like `vacuity.json` and `untracked.json` and
# for the same reason: `wringer.evidence.v1` is frozen, so this arrives as its
# own file and a reader that does not know it ignores it. No event type is
# added to `evidence.jsonl` either — that schema's `type` is a closed enum
# with `additionalProperties: false` on every branch, and law 7 means the way
# to publish new shape is a new file.
STABILITY_FILENAME = evidence.STABILITY_FILENAME
# Attempts 2..N live under `gates/NNN_<id>/attempts/NNN/`. Attempt 1 is there
# too: the ordinal is the directory name, so `attempts/001/` is the first
# attempt and the numbering never has a hole a reader has to explain.
ATTEMPTS_DIRNAME = "attempts"

STABLE_PASS = "stable_pass"
STABLE_FAIL = "stable_fail"
FLAKY = "flaky"
UNKNOWN = "unknown"

CLASSIFICATIONS = (STABLE_PASS, STABLE_FAIL, FLAKY, UNKNOWN)

# What a repair loop may do with this gate.
#
# `repair` — hand it over, which is what `wring run` has always done.
# `no_repair` — do NOT hand it over, and say why. The gate's result did not
#   follow from the tree, so there is nothing in the tree for a worker to fix.
# `none` — nothing to repair; the gate passed.
REPAIR = "repair"
NO_REPAIR = "no_repair"
NOTHING_TO_REPAIR = "none"

# What the run acted on for this gate.
PASSED = "passed"
FAILED = "failed"
# The gate never finished the attempts it was asked for, so the run has no
# verdict for it. Reachable exactly one way: a Ctrl-C between attempts.
UNRESOLVED = "unresolved"


@dataclass(frozen=True)
class Observed:
    """Every attempt at one gate in one verification, and what they add up to.

    `results` is in attempt order and holds only attempts that FINISHED. An
    attempt cut short by a Ctrl-C is absent, which is what makes the count
    smaller than `requested` and the classification `unknown`.
    """

    gate: config.Gate
    requested: int
    results: tuple[gates.GateResult, ...]

    @property
    def classification(self) -> str:
        return classify(self.requested, tuple(r.status for r in self.results))

    @property
    def tolerated(self) -> bool:
        """Whether a mixture was declared acceptable for this gate.

        Only ever true alongside `flaky`: `require_consistent: false` says
        nothing about a gate that came back consistent.
        """
        policy = self.gate.stability
        return (
            self.classification == FLAKY
            and policy is not None
            and not policy.require_consistent
        )

    @property
    def verdict(self) -> str:
        """What the run acts on — which is NOT always attempt 1's status.

        `unknown` is treated as `stable_fail` and the record says so, but it
        cannot decide a run: the only way to reach it is an interrupt, and an
        interrupted run has no verdict for the gate it stopped inside.
        """
        found = self.classification
        if found == UNKNOWN:
            return UNRESOLVED
        if found == STABLE_PASS:
            return PASSED
        if found == FLAKY and self.tolerated:
            return PASSED
        return FAILED

    @property
    def deciding(self) -> gates.GateResult | None:
        """The attempt whose files stand at the gate's canonical path.

        The first attempt that matches the verdict, so `gates/NNN_<id>/`
        never contradicts what the run did: a flaky gate that stops the run
        shows a real failure with real logs there, and every other attempt is
        still on disk under `attempts/`.
        """
        verdict = self.verdict
        if verdict == UNRESOLVED:
            return None
        wanted = PASSED if verdict == PASSED else FAILED
        return next((r for r in self.results if r.status == wanted), None)

    @property
    def passed(self) -> bool:
        return self.verdict == PASSED

    @property
    def routing(self) -> str:
        """**The CLASSIFICATION decides this, never the verdict.**

        Checked in this order because a tolerated mixture has verdict `passed`
        and is still not something a worker can fix. Reading the verdict first
        would make `require_consistent: false` quietly buy repairability back
        along with the tick, which is the one thing tolerating a coin flip must
        not do.
        """
        if self.classification == FLAKY:
            return NO_REPAIR
        if self.verdict == PASSED:
            return NOTHING_TO_REPAIR
        return REPAIR

    @property
    def reason(self) -> str:
        """The classification in a sentence, naming the counts it rests on.

        A refusal that only says no is a refusal people turn off, and this one
        has to survive being read by an agent as well as a person.
        """
        ran = len(self.results)
        passes = sum(1 for r in self.results if r.passed)
        failures = ran - passes
        found = self.classification
        if found == UNKNOWN:
            return (
                f"only {ran} of {self.requested} attempts ran, so this gate is "
                "unknown — treated as stable_fail, because a gate that did not "
                "finish has not been shown to be deterministic"
            )
        if found == STABLE_PASS:
            return f"passed all {ran} attempts"
        if found == STABLE_FAIL:
            return f"failed all {ran} attempts"
        tail = (
            "tolerated by require_consistent: false, and still not handed to a "
            "worker to fix"
            if self.tolerated
            else "not handed to a worker to fix: there is nothing in the tree "
            "to change"
        )
        return (
            f"{passes} passed and {failures} failed of {ran} attempts, so the "
            f"result does not follow from the tree — {tail}"
        )


@dataclass(frozen=True)
class Report:
    """Every gate that declared a `stability:` policy, in declared order.

    Empty is not the same as absent: a run where every stability-declaring
    gate was skipped writes no file at all, so a reader never has to tell an
    empty record from a missing one.
    """

    gates: tuple[Observed, ...] = ()

    def of(self, gate_id: str) -> Observed | None:
        return next((row for row in self.gates if row.gate.id == gate_id), None)


def classify(requested: int, statuses: tuple[str, ...]) -> str:
    """The whole classifier. Observations in, one word out.

    `requested` is checked FIRST: a gate asked for three draws and giving two
    has not been shown to be anything, however those two came back. Calling
    two passes `stable_pass` would let an interrupt manufacture the verdict
    the caller was trying to buy with a third attempt.
    """
    if len(statuses) < requested:
        return UNKNOWN
    if all(status == PASSED for status in statuses):
        return STABLE_PASS
    if all(status != PASSED for status in statuses):
        return STABLE_FAIL
    return FLAKY


def attempt_dir(gate_dir: Path, attempt: int) -> Path:
    """`gates/NNN_<id>/attempts/NNN/` — one attempt's own directory."""
    directory = gate_dir / ATTEMPTS_DIRNAME / f"{attempt:03d}"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def as_json(report: Report, relative) -> dict:
    """The published shape (`schema/stability.schema.json`).

    `relative` renders a path the way the bundle's own readers do —
    `Bundle.relative` — so every path here is bundle-relative like the ones
    in `digests.json` and `vacuity.json`.
    """
    rows = []
    for row in report.gates:
        deciding = row.deciding
        rows.append(
            {
                "gate_id": row.gate.id,
                "optional": row.gate.optional,
                "attempts_requested": row.requested,
                "attempts_run": len(row.results),
                "require_consistent": (
                    row.gate.stability.require_consistent
                    if row.gate.stability is not None
                    else True
                ),
                "classification": row.classification,
                "tolerated": row.tolerated,
                "verdict": row.verdict,
                "routing": row.routing,
                "reason": row.reason,
                "deciding_attempt": (
                    row.results.index(deciding) + 1 if deciding is not None else None
                ),
                "attempts": [
                    {
                        "attempt": number,
                        "status": result.status,
                        "exit_code": result.exit_code,
                        "duration_ms": result.duration_ms,
                        "timed_out": result.timed_out,
                        "result": relative(
                            result.stdout_path.parent / "result.json"
                        ),
                    }
                    for number, result in enumerate(row.results, start=1)
                ],
            }
        )
    return {"schema_version": SCHEMA_VERSION, "gates": rows}


def write(
    directory: Path,
    report: Report,
    relative,
    redactor: Redactor | None = None,
) -> Path | None:
    """Write `stability.json`, or nothing when no gate declared a policy."""
    if not report.gates:
        return None
    payload = as_json(report, relative)
    if redactor is not None:
        # A gate command can reach this file through nothing but `reason`,
        # which quotes counts and not commands — but the bundle's rule is that
        # every write is scrubbed by construction rather than because someone
        # checked, and a later field would otherwise opt out silently.
        payload = json.loads(redactor.scrub(json.dumps(payload)))
    path = directory / STABILITY_FILENAME
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


@dataclass(frozen=True)
class RecordedRow:
    """One gate's stability row read back off disk.

    Total, like `vacuity.read_verdict`: a file that is missing, unparseable or
    the wrong shape yields no rows rather than an exception. `wring health`
    reads bundles it did not write, including ones written by a future version.
    """

    gate_id: str
    classification: str
    attempts_requested: int
    attempts_run: int
    tolerated: bool


def read_report(directory: Path) -> tuple[RecordedRow, ...]:
    """Every stability row in a finished bundle, or an empty tuple."""
    try:
        raw = json.loads(
            (directory / STABILITY_FILENAME).read_text(encoding="utf-8")
        )
    except (OSError, ValueError, UnicodeDecodeError):
        return ()
    if not isinstance(raw, dict) or raw.get("schema_version") != SCHEMA_VERSION:
        return ()
    rows = raw.get("gates")
    if not isinstance(rows, list):
        return ()
    found = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        gate_id = row.get("gate_id")
        classification = row.get("classification")
        if not isinstance(gate_id, str) or classification not in CLASSIFICATIONS:
            continue
        found.append(
            RecordedRow(
                gate_id=gate_id,
                classification=classification,
                attempts_requested=int(row.get("attempts_requested") or 0),
                attempts_run=int(row.get("attempts_run") or 0),
                tolerated=bool(row.get("tolerated")),
            )
        )
    return tuple(found)
