"""**The checker, under trust.** A check that changed since it was bound does
not get to be silently believed.

`SPEC_ACCEPT`'s whole claim is that a criterion is `evidenced` because a bound
gate was recorded RED before the work and is GREEN now. The receipt names the
red bundle. What nothing checked was whether **the check that went red is the
check that is green** — edit `acceptance/recent.test.js` between the two runs
and the transition is still on the record, still resolvable, and no longer
about the same assertions.

The mechanism is stolen wholesale from Codex's `HookTrustStatus::Modified`
(`~/Claude/WRINGER_CODEX_DOSSIER_2026-08-22.md` §5.2), which content-hashes a
hook and stops running it once it differs from the version that was trusted.
Aimed here at our own thesis: the self-serving-check protection applied to the
checker.

**v0 is a NOTE and never a refusal.** Whether a changed check should BLOCK
delivery is a future ruling and wants this v0's field evidence in hand first —
a repository that reformats its test files, or generates them, would find
every delivery refused on a difference nobody cares about, and nobody has
measured how often that happens. So the escalation path is named rather than
improvised: **the ruling to take, when there is evidence to take it with, is
whether `check-changed-since-bound` joins the delivery interlock's refusals.**
Until then the engine says the sentence and the person decides.

**Where this is stored, and why.** A new sibling file inside the run bundle,
`checks.json` — never a field on `acceptance.json`, which is frozen (law 7:
new facts ride new sibling files). Inside the bundle rather than beside the
config, for two reasons that both matter:

1. **It is covered by the seal.** `digests.json` is written last over every
   file in the bundle and the ledger chains its events, so the record of what
   the checker WAS is exactly as tamper-evident as the record of what it said.
   A hash file sitting outside the bundle would be the one unprotected link in
   a chain whose whole point is that it has none.
2. **It is derived, not stateful.** There is no "binding event" in this
   program — a binding is `proves:` sitting in `.wringer.yaml`, and it becomes
   real when a run observes it. So the honest anchor is the RED BUNDLE the
   receipt already cites: that bundle recorded what the check was at the moment
   the transition began. Comparing today's identity against that one needs no
   new persistent state and cannot go stale, because the receipt and the
   identity travel together.
"""

from __future__ import annotations

import hashlib
import json
import shlex
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "wringer.checks.v1"
CHECKS_FILENAME = "checks.json"

#: What the identity of a check could be pinned to, said out loud on every
#: row. A bare `pytest -q` names no file, so all this can hash is the command
#: itself — and a page claiming to have hashed "the check" there would be
#: claiming more than it measured.
COVERAGE_COMMAND_ONLY = "command-only"
COVERAGE_COMMAND_AND_FILES = "command-and-files"

#: The sentence a PM reads, and the engine's own words. Rendered verbatim by
#: every surface — `wring verify`'s report and the board's card — because two
#: wordings of one fact is the drift SPEC_BOARD ruling 1 exists for.
CHANGED_NOTE = (
    "this check changed after it was bound; its green is not the green that "
    "was approved"
)

#: Said beside the note when only the command could be hashed, so a reader is
#: never left thinking a file comparison happened that did not.
COMMAND_ONLY_LIMIT = (
    "only the command was compared — it names no file in this repository, so "
    "a change inside whatever it runs is invisible here"
)

#: **Measured 2026-08-22 by pointing the thesis at this module.** The record is
#: written AFTER the gates have run, so it says what the checker was at that
#: moment — not what executed. A gate that rewrites its own check file, runs
#: the rewritten version and copies the original back leaves this record
#: byte-identical, and no note fires. It is the same class as SECURITY.md's
#: bold row — a worker that can write files can write files — and it is stated
#: rather than left to be discovered, because "the checker under trust" reads
#: much stronger than it is if this sentence is missing.
MUTATE_AND_RESTORE_LIMIT = (
    "this records what the check WAS when the bundle was written, which is "
    "after the gates ran. A gate that edits its own check, runs the edited "
    "version and puts the original back leaves this record unchanged."
)

LIMITS = (
    "this compares a check against the record of the same check in the run "
    "its receipt cites. It says a check changed; it never says the change "
    "was wrong, and it is a note rather than a refusal in v0.",
    COMMAND_ONLY_LIMIT,
    MUTATE_AND_RESTORE_LIMIT,
)

#: Extensions that make a token worth resolving as a file. Deliberately a
#: small, boring list: the cost of missing one is a `command-only` row that
#: says so, and the cost of guessing wrong is hashing something that is not a
#: check. A token containing a path separator is resolved whatever its suffix.
_CHECK_SUFFIXES = (
    ".py", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".sh", ".rb", ".go",
    ".rs", ".java", ".kt", ".php", ".sql", ".yaml", ".yml", ".json", ".toml",
)


@dataclass(frozen=True)
class Identity:
    """What a gate's check WAS, at one moment, as far as it is derivable."""

    gate_id: str
    run: str
    run_sha256: str
    files: dict[str, str] = field(default_factory=dict)
    coverage: str = COVERAGE_COMMAND_ONLY

    def as_json(self) -> dict[str, Any]:
        return {
            "gate_id": self.gate_id,
            "run": self.run,
            "run_sha256": self.run_sha256,
            "files": dict(sorted(self.files.items())),
            "coverage": self.coverage,
        }


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def derivable_files(run: str, root: Path) -> list[Path]:
    """The check files a command NAMES, and only those.

    `npx jest acceptance/recent.test.js` names one; `pytest -q` names none.
    The rule is deliberately conservative — a token is resolved only when it
    already looks like a path or carries a check-ish suffix, and only when it
    exists under `root` — because hashing a file the command does not actually
    run would make a note fire for a change that cannot affect the check.

    Paths that escape the repository are dropped: a check file outside the
    tree is not something this bundle can honestly speak for.
    """
    try:
        # **`comments=True` — found by pointing the thesis at this module,
        # 2026-08-22.** `sh -c "true" # decoy.py` recorded
        # `coverage: command-and-files` and hashed `decoy.py`, a filename the
        # shell never reads. That is a row claiming to have compared a check
        # when it compared something the check cannot touch — the exact defect
        # class this repository exists to catch, in the module written to
        # catch it. A comment is not part of the command, and `shlex` already
        # knows where one starts.
        tokens = shlex.split(run, comments=True)
    except ValueError:
        # An unparseable command still has an identity: its own text.
        return []
    found: list[Path] = []
    seen: set[Path] = set()
    resolved_root = root.resolve()
    for token in tokens:
        if token.startswith("-"):
            continue
        looks_like_a_path = "/" in token or token.endswith(_CHECK_SUFFIXES)
        if not looks_like_a_path:
            continue
        candidate = (root / token).resolve()
        if candidate in seen:
            continue
        try:
            candidate.relative_to(resolved_root)
        except ValueError:
            continue
        if candidate.is_file():
            seen.add(candidate)
            found.append(candidate)
    return found


def identity_of(gate_id: str, run: str, root: Path) -> Identity:
    """Hash what can be hashed, and say which of the two cases this is."""
    files = {
        path.relative_to(root.resolve()).as_posix(): _sha256_file(path)
        for path in derivable_files(run, root)
    }
    return Identity(
        gate_id=gate_id,
        run=run,
        run_sha256=_sha256_text(run),
        files=files,
        coverage=COVERAGE_COMMAND_AND_FILES if files else COVERAGE_COMMAND_ONLY,
    )


def write(
    bundle_dir: Path, root: Path, gates: list[Any], redactor: Any = None
) -> Path | None:
    """`<bundle>/checks.json` — what every declared gate's check was, now.

    Written BEFORE `digests.json`, like every other sibling, so the bundle's
    own tamper-evidence covers it. Returns None and writes nothing when there
    are no gates, because an empty artifact is a claim that nothing was
    checked.
    """
    identities = [
        identity_of(gate.id, gate.run, root).as_json()
        for gate in gates
        if getattr(gate, "run", None)
    ]
    if not identities:
        return None
    # **Scrubbed, like `result.json` beside it** (D8). `Bundle.write_gate_result`
    # records `"command": self.redactor.scrub(result.gate.run)`; this file
    # serialised the same string raw. One fact, two surfaces in one bundle,
    # one of them scrubbed — the drift pattern this codebase has paid for.
    from wringer import evidence as evidence_module

    return evidence_module.write_record(
        bundle_dir / CHECKS_FILENAME,
        {
            "schema_version": SCHEMA_VERSION,
            "checks": identities,
            "limits": list(LIMITS),
        },
        redactor,
    )


def read(bundle_dir: Path) -> dict[str, Identity]:
    """The identities a bundle recorded, keyed by gate id.

    An absent or unreadable file is an empty answer, never an error: bundles
    written before this shipped do not carry one, and a missing record is a
    question nobody can answer rather than a change nobody made.
    """
    path = bundle_dir / CHECKS_FILENAME
    if not path.is_file():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return {}
    if not isinstance(loaded, dict) or loaded.get("schema_version") != SCHEMA_VERSION:
        return {}
    out: dict[str, Identity] = {}
    for row in loaded.get("checks") or []:
        if not isinstance(row, dict) or not row.get("gate_id"):
            continue
        files = row.get("files")
        out[row["gate_id"]] = Identity(
            gate_id=row["gate_id"],
            run=row.get("run", ""),
            run_sha256=row.get("run_sha256", ""),
            files=files if isinstance(files, dict) else {},
            coverage=row.get("coverage", COVERAGE_COMMAND_ONLY),
        )
    return out


def changed(bound: Identity | None, now: Identity | None) -> str | None:
    """The note, or None. **Absence is never a change.**

    A bundle with no `checks.json` — every bundle written before this shipped —
    says nothing about what the check was, and a surface that read that silence
    as "it changed" would put a warning on every historical receipt in every
    repository. That is the failure this project keeps naming in other
    people's tools.
    """
    if bound is None or now is None:
        return None
    if bound.run_sha256 == now.run_sha256 and bound.files == now.files:
        return None
    note = CHANGED_NOTE
    command_only = COVERAGE_COMMAND_ONLY
    if bound.coverage == command_only and now.coverage == command_only:
        note = f"{note} — {COMMAND_ONLY_LIMIT}"
    return note


@dataclass(frozen=True)
class Note:
    """One criterion whose bound check is not the check that went red."""

    criterion: str
    gate_id: str
    sentence: str

    def as_json(self) -> dict[str, Any]:
        return {
            "criterion": self.criterion,
            "gate_id": self.gate_id,
            "sentence": self.sentence,
        }


def notes_for(root: Path, bundle_dir: Path) -> list[Note]:
    """Every changed-since-bound note this run's record supports. DERIVED.

    **Nothing persists a note, on purpose.** `acceptance.json` is frozen
    (law 7) and a new key on it would be a silent break for every reader of a
    bundle already on disk; a second artifact carrying notes would be a fact
    somebody has to keep in step with the identities it was computed from.
    Both surfaces — `wring verify`'s report and the board's card — call this,
    so there is one comparison and it cannot drift from itself.

    The anchor is the receipt the criterion already cites: that bundle is the
    run in which the check was recorded RED, which is precisely the moment the
    approved transition began. A receipt whose bundle is gone, or which
    predates `checks.json`, yields no note — absence is never a change.
    """
    from wringer import accept

    acceptance_path = bundle_dir / accept.ACCEPTANCE_FILENAME
    if not acceptance_path.is_file():
        return []
    try:
        record = json.loads(acceptance_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return []
    now = read(bundle_dir)
    if not now:
        return []

    notes: list[Note] = []
    for row in record.get("criteria") or []:
        if not isinstance(row, dict) or row.get("state") != "evidenced":
            continue
        gate_id, receipt = row.get("gate"), row.get("receipt")
        if not gate_id or not isinstance(receipt, dict):
            continue
        named = receipt.get("bundle")
        if not named:
            continue
        red_bundle = (root / named).resolve()
        if not red_bundle.is_dir():
            continue
        sentence = changed(read(red_bundle).get(gate_id), now.get(gate_id))
        if sentence:
            notes.append(Note(row.get("criterion", ""), gate_id, sentence))
    return notes
