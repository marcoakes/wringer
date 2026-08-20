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
    loop_dir: Path | None = None
    acceptance_version: str | None = None
    criteria: list[Criterion] = field(default_factory=list)
    limits: list[str] = field(default_factory=list)
    attempts: list[Attempt] = field(default_factory=list)
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
    spend: dict[str, int] = field(default_factory=dict)
    # Artifacts that were on disk and declared a version this board does not
    # know. They produce NO fact — the board cannot know where a later version
    # put the field, and a value read from the wrong place is worse than a
    # silence. Named in the engineers' block so the silence is not total.
    unreadable: list[str] = field(default_factory=list)


def _load(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def latest_run(repo: Path) -> Path | None:
    """The most recent verify bundle, by the LOOP's order where one exists.

    Falls back to the newest directory by mtime, never by id: run ids are
    `<date>-<HHMMSS>-<4 hex>` and do not sort chronologically. In the probe's
    capture four of five runs shared one second and lexical order was wrong
    (ruling 8).
    """
    runs = repo / ".wringer" / "runs"
    if not runs.is_dir():
        return None
    candidates = [p for p in runs.iterdir() if p.is_dir()]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def latest_loop(repo: Path) -> Path | None:
    loops = repo / ".wringer" / "loops"
    if not loops.is_dir():
        return None
    candidates = [p for p in loops.iterdir() if p.is_dir()]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


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
    return max(candidates, key=lambda p: p.stat().st_mtime)


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
            if isinstance(reason, str) and reason:
                facts.append(Fact(refusals.DELIVERY_REFUSAL, reason))

    order = {family: index for index, family in enumerate(refusals.FAMILIES)}
    board.facts = sorted(facts, key=lambda fact: order.get(fact.family, 99))


def _spend(repo: Path, run_dir: Path | None, loop_dir: Path | None) -> dict[str, int]:
    """Token counts this run's own records already carry.

    **Facts, never a price.** Wringer keeps no price table — a number it
    cannot check is a number it must not print — so this reads what the
    drafting reply and the worker actually reported and adds nothing.

    Absent when nothing recorded a usage, and ABSENT IS NOT ZERO: a run whose
    worker reported no usage has not been shown to have spent nothing, and a
    page saying "0 tokens" would be a claim the record does not support.
    """
    import json

    totals: dict[str, int] = {}

    def add(payload: object) -> None:
        if not isinstance(payload, dict):
            return
        for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
            value = payload.get(key)
            if isinstance(value, int) and value >= 0:
                totals[key] = totals.get(key, 0) + value

    specs = repo / ".wringer" / "specs"
    if specs.is_dir():
        for response in sorted(specs.glob("*/response.json")):
            try:
                add(json.loads(response.read_text(encoding="utf-8")).get("usage"))
            except Exception:  # noqa: BLE001 - a bad record is not a board error
                continue
    for directory in (run_dir, loop_dir):
        if directory is None:
            continue
        usage = directory / "usage.json"
        if usage.is_file():
            try:
                add(json.loads(usage.read_text(encoding="utf-8")))
            except Exception:  # noqa: BLE001
                continue
    return totals


def read(
    repo: Path,
    health_report: Path | None = None,
    audit_report: Path | None = None,
) -> Board:
    """Everything one render needs. Raises `UnknownVersion` rather than guess."""
    repo = repo.resolve()
    board = Board(repo=repo)
    board.spec_title, board.spec_intent = read_spec(repo)
    board.loop_dir = latest_loop(repo)
    board.attempts, board.ordered = attempts_from_loop(repo, board.loop_dir)

    # The run the board describes: the LAST one the loop verified where a loop
    # exists, so the board and the loop agree about which run is "this run".
    board.run_dir = board.attempts[-1].directory if board.attempts else latest_run(repo)
    if board.run_dir is None or not board.run_dir.is_dir():
        board.refusal = (
            "There is no evidence here yet. Nothing has been verified in this "
            "repository, so there is nothing this board can honestly show."
        )
        return board

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
            )
        )

    board.vacuity = _load(board.run_dir / VACUITY_FILENAME)

    # The gates this run was not asked to check. Read from the manifest rather
    # than inferred: a scoped run has its own honest sentence and ruling 4b
    # forbids inventing a cause for NOT REACHED.
    manifest = _load(board.run_dir / MANIFEST_FILENAME) or {}
    board.scoped_out = [
        gate for gate in (manifest.get("scoped_out") or []) if isinstance(gate, str)
    ]

    # Read LAST, and only on the path that renders a page: the two refusals
    # above return a board whose only content is the refusal, and a round
    # summary beside "there is no evidence here yet" would be a page arguing
    # with itself.
    read_facts(board, health_report=health_report, audit_report=audit_report)
    board.spend = _spend(repo, board.run_dir, board.loop_dir)
    return board
