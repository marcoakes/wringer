"""Reading the engine's artifacts. **This layer renders; it never decides.**

SPEC_BOARD_V0 ruling 1: every card state is a function of bytes the engine
wrote. The surface computes exactly three things that are not reads, and all
three are named there — the receipt chain walk, the staleness comparison, and
the discrimination of `unevidenced`'s four causes. Everything else is a read.

*Why so absolute:* a hand-kept second copy of the engine's judgement is the
exact defect class Wringer exists to catch, and it would drift the week after
it shipped. So this module parses; it does not reimplement `accept.py`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# **The acceptance versions this board understands** (ruling 6, amended
# 2026-08-16). The spec named `wringer.acceptance.v1` alone, because v2 did not
# exist when it was written. It does now — a run carrying a witness lane writes
# v2, and the corpus re-test this board's first real render is built from is
# exactly such a run. Rendering only v1 would mean the board could not show the
# very artifact it was commissioned to show.
#
# v2 is a superset in the only two ways that matter here: a row gains an
# optional `witness` object, and `gate` may be null on a row that still
# `refuses`. Both are handled explicitly below. **The rule ruling 6 actually
# states is unchanged**: anything not on this list produces a banner naming the
# version and NO CARDS AT ALL — not best-effort parsing, not partial rendering.
# v3 adds three keys per row and takes nothing away: `cause` (which of eight
# named conditions put the row where it is), `demonstrated_able_to_fail`
# (three-valued), and `judgement` (a person's answer to a `human` criterion).
# All three are handled explicitly below.
#
# **This board learned v3 from bytes the ENGINE wrote**, not from fixtures
# written here — `tests/test_acceptance_v3.py` reads
# `schema/fixtures/acceptance-v3-*.json` out of the core repository, which the
# core regenerates from `accept.Result.as_json_v3` on every run of its own
# suite. A fixture written from the same guess as its reader is how a surface
# comes to agree with itself and with nothing else, and this repository has
# already paid for that once: eleven mutations walked through an absence guard
# whose fixtures and whose reader shared one author's assumption.
KNOWN_ACCEPTANCE = (
    "wringer.acceptance.v1",
    "wringer.acceptance.v2",
    "wringer.acceptance.v3",
)

ACCEPTANCE_FILENAME = "acceptance.json"
COVERAGE_FILENAME = "coverage.json"
# The run's capture of `wringer.judgements.yaml` (0.6.1) — the engine's
# `accept.JUDGEMENT_RECORD_FILENAME`, named here for the layer seam's
# reason COVERAGE_FILENAME is.
JUDGEMENT_RECORD_FILENAME = "judgements.json"
DIAGNOSIS_FILENAME = "diagnosis.json"
MANIFEST_FILENAME = "manifest.json"
VACUITY_FILENAME = "vacuity.json"
EVENTS_FILENAME = "loop.jsonl"
SPEC_FILENAME = "wringer.spec.yaml"

# **The other artifacts' versions, and the same rule ruling 6 states for the
# acceptance record: a version this board does not know is not parsed.**
#
# Each of these was traced in the engine's source rather than guessed, and the
# trace is written down here because the next reader will want it:
#
#   loop ending    `<loop bundle>/manifest.json` → `result.reason`
#                  (`loop.py:300`, `SCHEMA_VERSION`/`SCHEMA_VERSIONS` at
#                  `loop.py:73-79`). v1 froze `reason` as a closed six-value
#                  enum; v2 made it an open string with eight known values, and
#                  both put it in the same place, which is why both are read.
#   vacuity        `<run bundle>/vacuity.json` → `verdict`
#                  (`evidence.py:95`, `schema/vacuity.schema.json`).
#   fleet outcomes `.wringer/fleets/<id>/manifest.json` → `tasks[].status`
#                  (`fleet.py:36`, `fleet.py:391`,
#                  `schema/fleet-manifest.schema.json`).
#
# **Health and the three signature axes are NOT under `.wringer/` at all**, and
# that is a finding rather than an oversight — see `read_health` and
# `read_audit` below.
KNOWN_LOOP = ("wringer.loop.v1", "wringer.loop.v2")
KNOWN_VACUITY = ("wringer.vacuity.v1",)
KNOWN_FLEET = ("wringer.fleet.v1",)
KNOWN_HEALTH = ("wringer.health.v1",)
KNOWN_REFUSAL = ("wringer.refusal.v1",)
# **The delivery record** (`schema/delivery-manifest.schema.json`): read by
# SHAPE, never through `wringer.deliver` — the seam forbids that import, and
# a board that reaches into the delivery module has started reimplementing
# it. `run_dir` names the run a delivery was made from; `mode` is `dry_run`
# or `live`, and only a live one delivered anything.
KNOWN_DELIVERY = ("wringer.delivery.v1",)
DELIVERIES_DIRNAME = "deliveries"

# Where the engine writes a refused delivery. **Never under
# `.wringer/deliveries/`** — an entry there is what `wring attest` takes as its
# anchor, so a refusal record in that root would silently disable attestation
# until the next success. The engine says so in `deliver.py` and this reader
# depends on it.
REFUSALS_DIRNAME = "refusals"


class UnknownVersion(Exception):
    """An artifact declares a schema version this board does not know.

    Raised rather than worked around. A reader that meets an unknown version
    and carries on is a reader that supplies the flattering answer, which is
    what every `limits` block in the engine warns about.
    """

    def __init__(self, artifact: str, version: str, known: tuple[str, ...]):
        self.artifact = artifact
        self.version = version
        self.known = known
        super().__init__(
            f"{artifact} declares {version!r}, which this board does not know "
            f"(it knows: {', '.join(known)})"
        )


@dataclass(frozen=True)
class Attempt:
    """One verification, in the order the LOOP ran it."""

    run_id: str
    directory: Path
    ordinal: int
    passed: bool | None = None
    failed_gate: str | None = None


@dataclass(frozen=True)
class Criterion:
    """One row of `acceptance.json`, plus the spec text a PM actually wrote."""

    id: str
    title: str
    required: bool
    state: str
    refuses: bool
    gate_id: str | None
    command: str | None
    reason: str
    receipt: dict[str, Any] | None
    witness: dict[str, Any] | None
    # **v3.** The engine's own name for why this row is where it is. None on v1
    # and v2, where the key does not exist — and None is exactly right there:
    # "this record predates causes" and "this row needs no cause" both mean the
    # board must fall back to reading the prose, which is what it did for every
    # record until v3.
    cause: str | None = None
    # **v3, three-valued.** True/False/None, and None is NOT False: it means
    # there was no bound (gate, command) to ask about, which includes a
    # criterion covered by a witness with no gate — and such a row can still be
    # `evidenced`.
    demonstrated_able_to_fail: bool | None = None
    # **v3.** A person's answer to a `human` criterion, verbatim. Never scored
    # here, never re-checked here.
    judgement: dict[str, Any] | None = None
    # **0.6.1.** True when the run's judgement record (`judgements.json`, a
    # sibling this surface reads like `coverage.json`) says this answer was
    # recorded WITHOUT a display — the person said so explicitly, and the
    # fact renders wherever the answer does. False covers both "shown" and
    # "no record travelled" (a run from before the sibling existed): the
    # card claims the fact only where the record states it.
    judged_without_display: bool = False


def _judged_without_display(
    row: dict[str, Any], judgement_record: dict[str, Any] | None
) -> bool:
    """The exact join the certificate makes — id, `at`, verdict — or False."""
    if not isinstance(judgement_record, dict):
        return False
    judged = row.get("judgement")
    if not isinstance(judged, dict):
        return False
    for entry in judgement_record.get("entries", []):
        if not isinstance(entry, dict):
            continue
        if (
            entry.get("criterion") == (row.get("id") or row.get("criterion"))
            and entry.get("at") == judged.get("at")
            and entry.get("verdict") == judged.get("verdict")
        ):
            return bool(entry.get("judged_without_display"))
    return False


@dataclass(frozen=True)
class Fact:
    """One value the ENGINE wrote, and which of `refusals`' families it is in.

    Deliberately just a pair. The board does not rank facts, does not decide
    which of them matters, and does not carry a sentence here — the sentence is
    `refusals.say(family, value)`'s and nowhere else, so there is exactly one
    place a PM's wording can come from.
    """

    family: str
    value: str


@dataclass
class Board:
    """Everything one render needs, read and never recomputed."""

    repo: Path
    run_dir: Path | None = None
    # **0.6.2.** True when a CALLER pinned `run_dir` — `wring deliver`
    # rendering the delivered page from the record it selected — and False
    # for the recency default. The engineers' block words the run line on
    # this flag, because "the newest record in the repository" is a sentence
    # that becomes a lie the moment a caller selects.
    selected: bool = False
    # **Ruling 12 (0.6.2), three-valued.** A non-empty tuple: the named
    # authorising documents hash differently NOW than `briefed.json`
    # recorded — the whole board is OUT OF DATE, and the banner names them.
    # `()`: compared and unmoved. None: no briefed.json to compare against
    # (or no engine to compare with), and the page then says NOTHING about
    # staleness — silence, never a verdict.
    staleness_moved: tuple[str, ...] | None = None
    loop_dir: Path | None = None
    # **0.8.7 (P1.14).** The journey whose phases cite `run_dir` — an exact
    # join, `journey_for_run` — or None, and the page then names none.
    journey_id: str | None = None
    acceptance_version: str | None = None
    criteria: list[Criterion] = field(default_factory=list)
    limits: list[str] = field(default_factory=list)
    attempts: list[Attempt] = field(default_factory=list)
    # The acceptance record's own `counts` object, verbatim — carried for the
    # machine-readable meta block (0.6.2), where a delivery-time invariant
    # compares it against the certificate's copy of the same record.
    acceptance_counts: dict[str, Any] | None = None
    ordered: bool = False
    spec_title: str | None = None
    spec_intent: str | None = None
    scoped_out: list[str] = field(default_factory=list)
    vacuity: dict[str, Any] | None = None
    refusal: str | None = None
    # What else this round recorded, in `refusals.FAMILIES` order. **Only facts
    # that EXIST** — ruling 11, widened from vacuity and health to all seven:
    # an artifact that is not there produces no entry, and the page then says
    # nothing about that family rather than rendering absence as a verdict.
    facts: list[Fact] = field(default_factory=list)
    # What this run's own records say it spent. FACTS ONLY: token counts as
    # recorded, never a price — the standing ruling is that Wringer does not
    # keep a price table, because a number it cannot check is a number it must
    # not print. Absent when nothing recorded a usage, and absent is not zero.
    #: Token counts BY LANE — `{"drafting": {...}, "worker": {...}}`,
    #: each present only when that lane reported. Never summed (P2.15).
    spend: dict[str, dict[str, int]] = field(default_factory=dict)
    # Artifacts that were on disk and declared a version this board does not
    # know. They produce NO fact — the board cannot know where a later version
    # put the field, and a value read from the wrong place is worse than a
    # silence. Named in the engineers' block so the silence is not total.
    unreadable: list[str] = field(default_factory=list)
    # **A bound check that is not the check that went red** — keyed by
    # criterion id, the engine's own sentence verbatim. DERIVED by
    # `wringer.checks.notes_for` and never recomputed here: SPEC_BOARD ruling
    # 1 is that the board renders the engine's words, and a second
    # implementation of the comparison is how one surface comes to disagree
    # with the other about whether a check changed. Empty for every bundle
    # written before `checks.json` shipped — absence is not a change.
    check_notes: dict[str, str] = field(default_factory=dict)
    # `wringer.coverage.v1` as the run wrote it, or None when the run wrote
    # none. Rendered through the engine's own `coverage.lines`, so this
    # package owns no wording for it.
    coverage: dict[str, Any] | None = None
    # `wringer.diagnosis.v1` as the run wrote it, or None. A HINT: it changes
    # no card's state and no verdict, and the card that renders it says so.
    diagnosis: dict[str, Any] | None = None
    # **The run's own overall result** — `manifest.json` → `result.status`,
    # the string the engine wrote (`passed` / `failed`), or None when the run
    # recorded none. Read from the manifest this reader already loads for
    # `scoped_out`; carried for the outcome rail's "Checks passing" segment
    # (pd-board, 2026-09-03), which says "not known here" on None rather
    # than inferring a result from the cards.
    run_status: str | None = None
    # **The delivery record that names this run**, or None. `wringer.delivery.v1`
    # read by shape (`delivery_for_run`), live mode only. Runs 4/4B,
    # 2026-09-01: the PM read "green" as "everything proved" and had no
    # segment telling them whether anything had actually been delivered.
    # None is "no delivery record names this run", which the rail says in
    # those words — never "not delivered".
    delivery: dict[str, Any] | None = None


def _load(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def latest_run(repo: Path) -> Path | None:
    """The most recent verify bundle, by mtime — whoever wrote it.

    By mtime, never by id: run ids are `<date>-<HHMMSS>-<4 hex>` and do not
    sort chronologically. In the probe's capture four of five runs shared one
    second and lexical order was wrong (ruling 8).

    The docstring said "by the LOOP's order where one exists" until
    2026-08-27, which described its CALLER and not this function — and the
    caller was the drift finding 2 named. This reads the directory, and the
    directory is where a standalone `wring verify` puts its record too.
    """
    runs = repo / ".wringer" / "runs"
    if not runs.is_dir():
        return None
    candidates = [p for p in runs.iterdir() if p.is_dir()]
    if not candidates:
        return None
    return _newest(candidates)


def _newest(candidates: list[Path]) -> Path | None:
    """The most recent bundle, by the ENGINE's definition of recent.

    **There were two definitions and they disagreed.** This package ordered by
    `st_mtime`; `wringer.evidence.latest_run` orders by the manifest's own
    recorded `started_at`. A run beginning at 09:00 that takes two hours
    finishes after one beginning at 11:00 that takes a minute, so the engine
    answered `…-110000` and this page answered `…-090000` — and the PM's page
    then described a different run from the one `wring deliver` and `wring
    explain` were acting on. Any `cp -r` or CI artifact restore rewrites
    mtimes wholesale and reorders the lot.

    `latest_refusal`, ninety lines below, already refuses mtime for exactly
    this reason and says so. Now every family answers the same way.

    Falls back to mtime when the engine is not installed, because this package
    must load without it (SPEC_BOARD's seam) — and a board with no engine has
    no better answer available.
    """
    if not candidates:
        return None
    try:
        from wringer import evidence as evidence_module

        return max(candidates, key=evidence_module._started_at)
    except Exception:  # noqa: BLE001 — no engine here; keep the old ordering
        return max(candidates, key=lambda p: p.stat().st_mtime)


def latest_loop(repo: Path) -> Path | None:
    loops = repo / ".wringer" / "loops"
    if not loops.is_dir():
        return None
    candidates = [p for p in loops.iterdir() if p.is_dir()]
    if not candidates:
        return None
    return _newest(candidates)


def _staleness_moved(repo: Path, loop_dir: Path | None) -> tuple[str, ...] | None:
    """Ruling 12's comparison, or None for silence. Engine-guarded like
    every other import through the seam: no engine, no claim."""
    if loop_dir is None:
        return None
    briefed_path = loop_dir / "briefed.json"
    if not briefed_path.is_file():
        return None
    try:
        from wringer import staleness as staleness_module

        briefed = json.loads(briefed_path.read_text(encoding="utf-8"))
        recorded = briefed.get("documents")
        if not isinstance(recorded, dict):
            return None
        return tuple(
            staleness_module.moved(
                recorded,
                staleness_module.capture(repo),
                staleness_module.AUTHORITY_DOCUMENTS,
            )
        )
    except Exception:  # noqa: BLE001 — no engine, unreadable record: silence
        return None


def loop_for_run(repo: Path, run_dir: Path) -> Path | None:
    """The loop whose own ledger cites this run, or None.

    An EXACT join on the ledger's `verify.finished.evidence_dir` — the
    "join from a run to its loop is exact" rule: for a SELECTED record the
    loop rail must be the loop that produced it, not whichever loop is
    newest. None when no ledger cites it (a standalone `wring verify`), and
    the attempts then render as a set with no order language, exactly as a
    loopless repository's do.
    """
    loops = repo / ".wringer" / "loops"
    if not loops.is_dir():
        return None
    wanted = run_dir.name
    candidates = sorted((p for p in loops.iterdir() if p.is_dir()), reverse=True)
    for candidate in candidates:
        ledger = candidate / EVENTS_FILENAME
        if not ledger.is_file():
            continue
        try:
            text = ledger.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            if '"verify.finished"' not in line:
                continue
            try:
                event = json.loads(line)
            except ValueError:
                continue
            named = str(event.get("evidence_dir") or "")
            if named and Path(named).name == wanted:
                return candidate
    return None


#: The drive's journey record (0.8.7, P1.14): `.wringer/journeys/<id>/journey.json`,
#: `wringer.journey.v1`. Read here by shape, never through the drive — the
#: board imports neither package's internals, and the join below is the
#: same EXACT join `loop_for_run` makes, one level up.
JOURNEYS_DIRNAME = Path(".wringer") / "journeys"
JOURNEY_FILENAME = "journey.json"
JOURNEY_SCHEMA_VERSION = "wringer.journey.v1"


def journey_for_run(repo: Path, run_dir: Path) -> str | None:
    """The journey whose phases cite this run, or None.

    An EXACT join on a phase's `id` — the run's directory name, as the drive
    recorded it off the engine's own `evidence_dir`. Runs 4 and 4B,
    2026-09-01: the page named a run id and nothing said which afternoon's
    work it belonged to. None when no journey cites it, and the page then
    says nothing about a journey rather than naming the newest one: a
    journey this run is not part of is not this run's journey.
    """
    root = repo / JOURNEYS_DIRNAME
    if not root.is_dir():
        return None
    wanted = run_dir.name
    for candidate in sorted((p for p in root.iterdir() if p.is_dir()), reverse=True):
        try:
            record = json.loads(
                (candidate / JOURNEY_FILENAME).read_text(encoding="utf-8")
            )
        except (OSError, ValueError):
            continue
        if not isinstance(record, dict):
            continue
        if record.get("schema_version") != JOURNEY_SCHEMA_VERSION:
            continue
        phases = record.get("phases")
        if not isinstance(phases, list):
            continue
        for phase in phases:
            if isinstance(phase, dict) and phase.get("id") == wanted:
                named = record.get("journey_id")
                return named if isinstance(named, str) and named else None
    return None


def delivery_for_run(
    repo: Path, run_dir: Path, unreadable: list[str] | None = None
) -> dict[str, Any] | None:
    """The LIVE delivery record whose `run_dir` names this run, or None.

    An EXACT join on the run directory's name — the same join
    `journey_for_run` and `loop_for_run` make. A dry run wrote a plan and
    touched git not at all, so it is not a delivery and produces None. A
    record in a version this board does not know is named in `unreadable`
    (ruling 6: no best-effort parsing) and produces None. Newest first, so
    a run delivered twice reports the latest record.
    """
    root = repo / ".wringer" / DELIVERIES_DIRNAME
    if not root.is_dir():
        return None
    wanted = run_dir.name
    for candidate in sorted((p for p in root.iterdir() if p.is_dir()), reverse=True):
        payload, unknown = _known(_load(candidate / MANIFEST_FILENAME), KNOWN_DELIVERY)
        if unknown is not None:
            if unreadable is not None:
                unreadable.append(f"delivery record: {unknown}")
            continue
        if payload is None:
            continue
        named = payload.get("run_dir")
        if not isinstance(named, str) or Path(named).name != wanted:
            continue
        if payload.get("mode") != "live":
            continue
        return payload
    return None


def attempts_from_loop(repo: Path, loop_dir: Path | None) -> tuple[list[Attempt], bool]:
    """The verifications this loop ran, IN ORDER, or an unordered set.

    **Ruling 8.** The order comes from the loop's own `verify.finished` events,
    whose `evidence_dir` is required by `loop-event-v2.schema.json`. Sorting by
    id is forbidden and sorting by `started_at` alone is too: both tie at
    second precision, and in the probe's capture the truth and the lexical order
    disagreed.

    Returns `(attempts, ordered)`. When no loop bundle covers the runs, the
    caller must render them as a SET and use no "first"/"then"/"attempt N"
    language about them — which is what `ordered=False` says.
    """
    if loop_dir is None:
        return [], False
    ledger = loop_dir / EVENTS_FILENAME
    if not ledger.is_file():
        return [], False

    attempts: list[Attempt] = []
    for line in ledger.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if event.get("type") != "verify.finished":
            continue
        directory = event.get("evidence_dir")
        if not directory:
            continue
        path = repo / directory
        attempts.append(
            Attempt(
                run_id=Path(directory).name,
                directory=path,
                ordinal=len(attempts) + 1,
                passed=event.get("status") == "passed",
                failed_gate=event.get("failed_gate"),
            )
        )
    return attempts, bool(attempts)


def read_spec(repo: Path) -> tuple[str | None, str | None]:
    """The PM's own words — title and intent — out of `wringer.spec.yaml`.

    `acceptance.json` carries each criterion's id, title and `required`, but the
    spec's title and the intent live only here (probe gap 11). Parsed with a
    deliberately small reader rather than a YAML dependency: this layer reads
    two scalar fields and a block, and pulling a parser in to do it would be a
    second parser of a file the engine already owns.
    """
    path = repo / SPEC_FILENAME
    if not path.is_file():
        return None, None
    title = None
    intent_lines: list[str] = []
    in_intent = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if in_intent:
            if line.startswith((" ", "\t")) or not line.strip():
                intent_lines.append(line.strip())
                continue
            in_intent = False
        if line.startswith("title:"):
            title = line.split(":", 1)[1].strip()
        elif line.startswith("intent:"):
            in_intent = True
    intent = "\n".join(intent_lines).strip() or None
    return title, intent


def latest_fleet(repo: Path) -> Path | None:
    """The most recent fleet bundle. `.wringer/fleets/` — `fleet.py:36`."""
    fleets = repo / ".wringer" / "fleets"
    if not fleets.is_dir():
        return None
    candidates = [p for p in fleets.iterdir() if p.is_dir()]
    if not candidates:
        return None
    return _newest(candidates)


def latest_refusal(repo: Path) -> Path | None:
    """The newest `refusal.json` under `.wringer/refusals/`, or None.

    Run ids are UTC-stamped and sort chronologically, so the newest directory
    name IS the newest refusal — read by name rather than by mtime, because a
    checkout or a copy rewrites mtimes and would silently reorder history.
    """
    root = repo / ".wringer" / REFUSALS_DIRNAME
    if not root.is_dir():
        return None
    records = sorted(
        (d / "refusal.json" for d in root.iterdir() if d.is_dir()),
        key=lambda path: path.parent.name,
    )
    for record in reversed(records):
        if record.is_file():
            return record
    return None


def _known(
    payload: Any, known: tuple[str, ...]
) -> tuple[dict[str, Any] | None, str | None]:
    """`(payload, None)` if its version is known, `(None, version)` if it is not.

    Three outcomes and they are three DIFFERENT facts, which is the whole
    reason this returns a pair rather than an optional dict:

    - `(None, None)` — nothing was there. Absence. The caller renders nothing.
    - `(payload, None)` — readable, and this board knows the dialect.
    - `(None, version)` — present, and written in a dialect this board does not
      know. **Not parsed**: ruling 6's rule is that a version off the list gets
      no best-effort parsing, and reading a field out of a later schema by name
      is exactly that.
    """
    if not isinstance(payload, dict):
        return None, None
    version = payload.get("schema_version")
    if version in known:
        return payload, None
    return None, str(version)


def read_health(path: Path | None) -> tuple[list[str], str | None]:
    """The health verdicts in a report the ENGINE wrote, in first-seen order.

    **Health writes no file under `.wringer/` and this board does not invent
    one.** `schema/health-report.schema.json` says so in its own description —
    it is a derived view, and `cli.py:1965-1975` prints it, writing a file only
    where `--output` names one. So the board reads a report the operator asked
    the engine to write:

        wring health --json --output health.json

    and is given the path. **Ruling 11 offered two mechanisms** — that, or
    running `wring health --json` through the CLI-as-API. The CLI-as-API branch
    is NOT built here: this package has no runtime dependency on the engine,
    and a renderer that shells out mid-render makes the page a function of the
    machine rather than of the bytes on disk. Where no report is given, the
    board says nothing about health, which is ruling 11's own other branch.

    `gates[]` and `retired[]` are read as one list because both carry a
    `verdict` and `retired` is one of the four values (`health.py:790-793`).
    """
    if path is None or not path.is_file():
        return [], None
    payload, unknown = _known(_load(path), KNOWN_HEALTH)
    if payload is None:
        return [], unknown
    seen: list[str] = []
    for row in list(payload.get("gates") or []) + list(payload.get("retired") or []):
        verdict = (row or {}).get("verdict")
        if isinstance(verdict, str) and verdict and verdict not in seen:
            seen.append(verdict)
    return seen, None


def read_audit(path: Path | None) -> dict[str, str]:
    """`wring audit`'s three axes, from a report the engine wrote.

    **The three signature axes are in no file under `.wringer/` either, and
    that is worth stating plainly because it is easy to assume otherwise.** An
    `attestation.json` exists (`.wringer/attestations/<id>/attestation.json`,
    `attest.py:46-47`) and it does NOT carry them: its own `signature` field is
    `null` in v0 by ruling, and `change.commit_signature.status` is git's `%G?`
    letter, a different vocabulary entirely. The values in
    `sign.SIGNATURE_STATES`, `sign.IDENTITY_STATES` and `sign.INTEGRITY_STATES`
    are produced by `sign.assess` inside `attest.audit` and reach a consumer
    only through `wring audit --json` (`cli.py:3624-3641`).

    So the board renders them only from that report, saved by the operator —
    which is what ruling 13 licenses and the limit it sets. **The board never
    assesses a signature itself**: deciding that a missing `.sig` means
    `signature_missing` would be this surface re-implementing `sign.assess`,
    which ruling 1 forbids outright.

    Ruling 13 also asks that such a verdict be **attributed to `wring audit`**.
    The round section carries no wording of its own by design, so the
    attribution is rendered in the engineers' block instead — named here
    because a docstring claiming an attribution the page does not make would be
    the same defect in miniature.

    The audit report carries no `schema_version` — it is a CLI JSON dump rather
    than a bundle — so there is no version to gate on, and the three keys are
    read by name or not at all.
    """
    if path is None or not path.is_file():
        return {}
    payload = _load(path)
    if not isinstance(payload, dict):
        return {}
    out: dict[str, str] = {}
    for key in ("signature", "identity", "integrity"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            out[key] = value
    return out


def read_facts(
    board: Board,
    health_report: Path | None = None,
    audit_report: Path | None = None,
) -> None:
    """The seven families that are not a criterion, read and never derived.

    **Every value here is a string the engine literally wrote in a file.**
    Nothing is recomputed, nothing is inferred from the absence of something
    else, and no verdict is assembled out of parts — ruling 1, and the reason
    this function is a sequence of reads with no branches that decide anything.

    Order is `refusals.FAMILIES`' order rather than a judgement about which
    fact matters most, for the same reason cards render in declared order: a
    surface that sorted by severity would be deciding which debts matter.
    """
    from wringer_board import refusals

    facts: list[Fact] = []

    # 1. The loop ending. `<loop bundle>/manifest.json` → `result.reason`.
    if board.loop_dir is not None:
        payload, unknown = _known(_load(board.loop_dir / MANIFEST_FILENAME), KNOWN_LOOP)
        if unknown is not None:
            board.unreadable.append(f"loop bundle: {unknown}")
        elif payload is not None:
            reason = (payload.get("result") or {}).get("reason")
            if isinstance(reason, str) and reason:
                facts.append(Fact(refusals.LOOP_ENDING, reason))

    # 2. The vacuity verdict. Ruling 11: written only under `run.prove`, so
    # ABSENT is the ordinary case and it renders nothing rather than `fine`.
    payload, unknown = _known(board.vacuity, KNOWN_VACUITY)
    if unknown is not None:
        board.unreadable.append(f"pre-change comparison: {unknown}")
    elif payload is not None:
        verdict = payload.get("verdict")
        if isinstance(verdict, str) and verdict:
            facts.append(Fact(refusals.VACUITY_VERDICT, verdict))

    # 3. Health, from a report the operator had the engine write.
    verdicts, unknown = read_health(health_report)
    if unknown is not None:
        board.unreadable.append(f"health report: {unknown}")
    facts.extend(Fact(refusals.HEALTH_VERDICT, v) for v in verdicts)

    # 4-6. The three signature axes, from `wring audit`'s own report. Absent
    # report → NOTHING about any of them. "Nobody signed this" is a verdict
    # `wring audit` reaches; the board may not reach it by not looking.
    audited = read_audit(audit_report)
    for key, family in (
        ("signature", refusals.SIGNATURE),
        ("identity", refusals.IDENTITY),
        ("integrity", refusals.INTEGRITY),
    ):
        if key in audited:
            facts.append(Fact(family, audited[key]))

    # 7. Fleet task outcomes, deduplicated to the values present. The board
    # names no task id and renders no count: B4, and a count would be a
    # sentence this table does not hold.
    fleet_dir = latest_fleet(board.repo)
    if fleet_dir is not None:
        payload, unknown = _known(_load(fleet_dir / MANIFEST_FILENAME), KNOWN_FLEET)
        if unknown is not None:
            board.unreadable.append(f"fleet bundle: {unknown}")
        elif payload is not None:
            seen: list[str] = []
            for task in payload.get("tasks") or []:
                status = (task or {}).get("status")
                if isinstance(status, str) and status and status not in seen:
                    seen.append(status)
            facts.extend(Fact(refusals.FLEET_OUTCOME, s) for s in seen)

    # 6. **The delivery refusal, if the last attempt was refused.**
    #
    # Until 2026-08-17 nothing here read `.wringer/refusals/` at all, so the
    # single most PM-relevant fact in the whole repository — *your handover was
    # stopped, and here is why* — never reached a card. The refute review of
    # SPEC_DRIVE found it: the board mapped three delivery reasons, none of
    # which was among the engine's, and had no code path to any of them.
    #
    # The NEWEST record only. A refusal from last week that somebody has since
    # fixed is history, not a verdict about the work in front of you, and this
    # board renders the current state or nothing.
    refusal = latest_refusal(board.repo)
    if refusal is not None:
        payload, unknown = _known(_load(refusal), KNOWN_REFUSAL)
        if unknown is not None:
            board.unreadable.append(f"refusal record: {unknown}")
        elif payload is not None:
            reason = payload.get("reason")
            # **The newest RECORD is not the same as a refusal about the state
            # in front of you** — field report 2026-08-28, on a repository
            # where it mattered. Yesterday's refusal said the handover was held
            # because a person had judged a requirement NOT met. The person
            # then judged it met, the work was fixed, two further runs were
            # recorded — and the board still rendered that refusal as the
            # current verdict, three inches below a round section saying the
            # work had finished. Nothing had refused anything today.
            #
            # The paragraph above this block already promised the right
            # behaviour: *"a refusal from last week that somebody has since
            # fixed is history, not a verdict about the work in front of you."*
            # It was a promise about `latest_refusal`, which sorts records and
            # knows nothing about what this page renders.
            #
            # A refusal names the run it refused. If that is not the run on the
            # page, it is history. A record too old to name one is kept, because
            # a fact that cannot be dated is not a fact that has been disproved.
            refused_run = payload.get("run")
            stale = (
                isinstance(refused_run, str)
                and bool(refused_run)
                and board.run_dir is not None
                and refused_run != board.run_dir.name
            )
            if isinstance(reason, str) and reason and not stale:
                facts.append(Fact(refusals.DELIVERY_REFUSAL, reason))

    order = {family: index for index, family in enumerate(refusals.FAMILIES)}
    board.facts = sorted(facts, key=lambda fact: order.get(fact.family, 99))


def _spend(
    repo: Path, run_dir: Path | None, loop_dir: Path | None
) -> dict[str, dict[str, int]]:
    """Token counts this run's own records carry, **by lane, never summed**.

    **Facts, never a price.** Wringer keeps no price table — a number it
    cannot check is a number it must not print — so this reads what the
    drafting reply and the worker actually reported and adds nothing.

    **The two lanes are separate facts** (P2.15, run 4B finding 8). They were
    summed into one total under a sentence saying "the counts the model and
    the worker reported" — and on run 4B's own delivery the worker was on the
    shell lane and reported nothing, so the number was drafting alone and the
    sentence was false. It is the coverage ruling in another costume: two
    numbers, two questions, and blending them answers neither.

    Absent when a lane recorded nothing, and ABSENT IS NOT ZERO: a run whose
    worker reported no usage has not been shown to have spent nothing.
    """
    import json

    lanes: dict[str, dict[str, int]] = {}

    def add(lane: str, payload: object) -> None:
        if not isinstance(payload, dict):
            return
        for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
            value = payload.get(key)
            if isinstance(value, int) and value >= 0:
                totals = lanes.setdefault(lane, {})
                totals[key] = totals.get(key, 0) + value

    def short(lane: str, files: object) -> None:
        """Name the calls whose reply reported no usage, so a figure that is
        SHORT is not rendered as the total (claim ceiling on money)."""
        if not isinstance(files, list):
            return
        named = [one for one in files if isinstance(one, str)]
        if named:
            totals = lanes.setdefault(lane, {})
            totals.setdefault("unreported_parts", []).extend(named)  # type: ignore[arg-type]

    specs = repo / ".wringer" / "specs"
    if specs.is_dir():
        for exchange in sorted(one for one in specs.iterdir() if one.is_dir()):
            assembled = exchange / "response.json"
            if assembled.is_file():
                # The assembled reply already sums the calls THIS exchange
                # sent, and names the calls it reused from another exchange
                # (which counts them). Reading it alone counts each call once.
                try:
                    recorded = json.loads(assembled.read_text(encoding="utf-8"))
                except Exception:  # noqa: BLE001 - a bad record is not a board error
                    continue
                add("drafting", recorded.get("usage"))
                short("drafting", recorded.get("usage_missing_from"))
                continue
            # **A draft that stopped mid-sections still spent (0.9.9).** No
            # assembled reply is written when a call is cut off, refused or
            # unreachable — and the calls that did answer are on disk, paid
            # for. The lane said "reported nothing" over them.
            for part in sorted(exchange.glob("response-*.json")):
                try:
                    add("drafting", json.loads(
                        part.read_text(encoding="utf-8")).get("usage"))
                except Exception:  # noqa: BLE001 - a bad record is not a board error
                    continue
    # **The worker lane, through the engine's own reader — 0.9.3.**
    #
    # This read `usage.json` itself and looked for `prompt_tokens` /
    # `completion_tokens` / `total_tokens` at the top level. `wringer.usage.v1`
    # carries none of them, so the lane could NEVER match a real record: the
    # page said "the builder reported nothing this run" over a record saying
    # 44,863 tokens and 0.729392 USD. 0.9.0 shipped that, and its guard passed
    # because the guard wrote a `usage.json` shape no engine writes.
    #
    # `run_dir` is gone from the search with it: `Bundle.write_usage` only
    # ever writes into a loop bundle, so looking under a run directory could
    # only ever find something no engine put there.
    if loop_dir is not None:
        from wringer import evidence as evidence_module

        reported = evidence_module.read_usage(loop_dir)
        if reported:
            # The record's own fields, unrenamed and unsummed — including
            # `cost` when the agent volunteered one. Wringer prices nothing;
            # a figure the agent reported is the agent's claim, and the page
            # says so beside it.
            lanes["worker"] = dict(reported)
    return lanes


def read(
    repo: Path,
    health_report: Path | None = None,
    audit_report: Path | None = None,
    run_dir: Path | None = None,
) -> Board:
    """Everything one render needs. Raises `UnknownVersion` rather than guess.

    `run_dir` pins the board to ONE verification record (0.6.2): `wring
    deliver` renders the delivered page from the record it selected, so the
    board and the certificate cannot tell different stories — run 3's F13
    was exactly that contradiction, a copied root page naming an old run
    beside a certificate naming the delivered one. None keeps the recency
    default below, byte-identical for every existing caller.
    """
    repo = repo.resolve()
    board = Board(repo=repo)
    board.spec_title, board.spec_intent = read_spec(repo)
    if run_dir is not None:
        board.selected = True
        board.loop_dir = loop_for_run(repo, run_dir)
    else:
        board.loop_dir = latest_loop(repo)
    board.attempts, board.ordered = attempts_from_loop(repo, board.loop_dir)

    # **RECENCY WINS** — the run the board describes is the repository's
    # NEWEST run record, whoever wrote it.
    #
    # This pinned `run_dir` to the loop's last attempt whenever a loop existed,
    # and that is the drift of field report 2026-08-27 finding 2. Both `wring
    # verify` and `wring verify --prove` write STANDALONE runs — outside any
    # loop — and both are what the engine's own refusals send a person off to
    # run. So after the pen had moved and `--prove` had recorded a real red,
    # the page still said "Nobody has yet" and "0 of 8 proved" while
    # `acceptance.json` in the newest run carried the person's `not_met` and
    # `wring deliver` was refusing delivery citing it. The hero surface told a
    # person to go and do a thing they had already done.
    #
    # The loop rail is a DIFFERENT fact and keeps its own: `board.attempts`
    # still comes from the loop's ledger and still tells the loop's story. The
    # page names the run it rendered (the engineers' block), because the whole
    # cost of the finding was that a stale page and a fresh record could not be
    # told apart by reading them.
    board.run_dir = run_dir.resolve() if run_dir is not None else latest_run(repo)
    if board.run_dir is None or not board.run_dir.is_dir():
        board.refusal = (
            "There is no evidence here yet. Nothing has been verified in this "
            "repository, so there is nothing this board can honestly show."
        )
        return board
    board.journey_id = journey_for_run(repo, board.run_dir)

    # **The engine computes it; the board renders it.** One import, one call,
    # no second implementation of the comparison — the same argument that puts
    # `wringer.accept` on the permitted list in `test_layer_seam.py`. It is
    # best-effort: an engine too old to have the module, or a bundle written
    # before `checks.json` existed, yields nothing, and nothing is exactly what
    # the board should then say.
    try:
        from wringer import checks as checks_module

        board.check_notes = {
            note.criterion: note.sentence
            for note in checks_module.notes_for(repo, board.run_dir)
        }
    except Exception:  # pragma: no cover - the board never fails on a hint
        board.check_notes = {}

    accepted = _load(board.run_dir / ACCEPTANCE_FILENAME)
    if accepted is None:
        board.refusal = (
            "This run recorded no acceptance verdict, which means nobody has "
            "written down what the work is for. Wringer only judges criteria "
            "from an APPROVED spec; without one there is nothing to show per "
            "requirement."
        )
        return board

    version = accepted.get("schema_version")
    board.acceptance_version = version
    if version not in KNOWN_ACCEPTANCE:
        raise UnknownVersion(ACCEPTANCE_FILENAME, str(version), KNOWN_ACCEPTANCE)

    board.limits = list(accepted.get("limits") or [])
    board.acceptance_counts = (
        dict(accepted.get("counts")) if isinstance(accepted.get("counts"), dict)
        else None
    )
    # The run's capture of the judgements file (0.6.1) — read once, like
    # coverage below. Absent is absent: no record, no claims.
    judgement_record = _load(board.run_dir / JUDGEMENT_RECORD_FILENAME)
    for row in accepted.get("criteria") or []:
        board.criteria.append(
            Criterion(
                id=row.get("id") or row.get("criterion") or "?",
                title=row.get("title") or "",
                required=bool(row.get("required")),
                state=str(row.get("state") or ""),
                refuses=bool(row.get("refuses")),
                gate_id=row.get("gate"),
                command=row.get("command"),
                reason=str(row.get("reason") or ""),
                receipt=row.get("receipt"),
                # v1 has no such key, and `.get` returning None is exactly right:
                # "this run carried no witness lane" and "this criterion had no
                # witness" are the same fact from a card's point of view.
                witness=row.get("witness"),
                cause=row.get("cause"),
                demonstrated_able_to_fail=row.get("demonstrated_able_to_fail"),
                judgement=row.get("judgement"),
                judged_without_display=_judged_without_display(
                    row, judgement_record
                ),
            )
        )

    board.vacuity = _load(board.run_dir / VACUITY_FILENAME)

    # **The coverage record, if the run wrote one.** ABSENT IS ABSENT: a
    # bundle from before `coverage.json` existed produces no sentences at all
    # rather than a zero nobody measured, which is ruling 11 applied to an
    # eighth family.
    #
    # The sentences themselves come from the ENGINE's renderer, never from
    # wording written here — SPEC_BOARD ruling 1, and the same argument that
    # admitted `accept` and `checks` through the seam. A second copy of "N of
    # M requirements carry a check" living in this package is how the board
    # and the merge request come to state different numbers for one run.
    board.coverage = _load(board.run_dir / COVERAGE_FILENAME)

    # **Ruling 12: staleness is recomputed, is BOARD-level, and follows
    # DELIVERY's document set** (0.6.2; the spec carried an UNBUILT marker
    # for this from 2026-08-30 until it shipped — the mechanism or the
    # marker, never neither). The comparison is the ENGINE's own —
    # `staleness.moved` over `staleness.AUTHORITY_DOCUMENTS`, the tuple
    # imported and never hand-copied — against the `briefed.json` of the
    # loop this page's run belongs to. No briefed.json, or no engine to
    # ask: the page says NOTHING about staleness. Silence, never a verdict.
    board.staleness_moved = _staleness_moved(repo, board.loop_dir)

    # **A guess about a red the ENVIRONMENT may have caused** — field
    # report 2026-08-28, finding 4. `ruff: command not found` went into
    # the record indistinguishable from a red the requirement earned,
    # and this page is the one surface a non-engineer opens. The
    # engine writes it; this renders its sentence and owns no wording
    # for it. Absent unless a face matched.
    board.diagnosis = _load(board.run_dir / DIAGNOSIS_FILENAME)

    # The gates this run was not asked to check. Read from the manifest rather
    # than inferred: a scoped run has its own honest sentence and ruling 4b
    # forbids inventing a cause for NOT REACHED.
    manifest = _load(board.run_dir / MANIFEST_FILENAME) or {}
    board.scoped_out = [
        gate for gate in (manifest.get("scoped_out") or []) if isinstance(gate, str)
    ]
    status = (manifest.get("result") or {}).get("status")
    board.run_status = status if isinstance(status, str) and status else None
    board.delivery = delivery_for_run(repo, board.run_dir, board.unreadable)

    # Read LAST, and only on the path that renders a page: the two refusals
    # above return a board whose only content is the refusal, and a round
    # summary beside "there is no evidence here yet" would be a page arguing
    # with itself.
    read_facts(board, health_report=health_report, audit_report=audit_report)
    board.spend = _spend(repo, board.run_dir, board.loop_dir)
    return board
