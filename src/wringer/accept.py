"""Acceptance evidence — the bridge (SPEC_ACCEPT_V0.md).

**Every acceptance criterion carries the evidence that proves it — or is
marked as the human judgement it always was.** Wringer proves a change is
*mergeable*; this makes "gates pass" start to mean "the spec is satisfied",
and says honestly which criteria can never make that trip.

The whole feature is one join — `proves:` on a gate names the criterion it
evidences — plus one refusal to be talked out of: **green is not evidence.**
A criterion is `evidenced` only when its bound gate passed in THIS run and
the record shows that gate can fail. A worker that writes both the acceptance
gate and the code it must pass is the vacuity problem in a new hat, and a
gate born green has never demonstrated it can tell satisfied from
unsatisfied. The bench said it first (a benchmark of repair needs a red
baseline), health says it across time (a gate that cannot fail is not a
gate), and this says it at the moment the claim is made.

Two opt-in boundaries, both rulings and both tested as boundaries:

- **approval, not presence** (ruling 8). `wring spec` drafts criteria with
  `approved: false`. Triggering on the file existing would hand a model's
  draft delivery-blocking force before a person read it — the interlock
  SPEC_INTENT §3 owns, and the repair SPEC_PROVENANCE §2a already made once.
- **binding, not declaring** (ruling 9). Criteria default `required: true`
  and nothing is bound the moment a spec is approved, so refusing on unbound
  criteria would refuse the first delivery in every spec repo. An unbound
  criterion is loud — UNEVIDENCED, in capitals — and never fatal. Binding a
  gate is the act that says "hold me to this".

This module reads; it never scores. No model is asked anything here, and
`human: true` criteria are answered by people — nothing in this file can
give one a verdict.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from wringer import evidence as evidence_module
from wringer import spec as spec_module
from wringer.redact import Redactor

SCHEMA_VERSION = "wringer.acceptance.v1"
# Named in evidence.py with the bundle's other filenames and re-exported here:
# this module writes it, and that one is the one that has to be able to REMOVE
# it from a reused `--output` directory.
ACCEPTANCE_FILENAME = evidence_module.ACCEPTANCE_FILENAME
SPEC_FILENAME = spec_module.SPEC_FILENAME

# The states an artifact records. The author's SORT is three declarations
# (bound / human / unbound); these are what a RUN makes of them, which is why
# binding alone never earns the claim.
EVIDENCED = "evidenced"
UNEVIDENCED = "unevidenced"
GATE_FAILED = "gate-failed"
GATE_DID_NOT_RUN = "gate-did-not-run"
HUMAN = "human"

STATES = (EVIDENCED, UNEVIDENCED, GATE_FAILED, GATE_DID_NOT_RUN, HUMAN)

# What this artifact does NOT say, travelling with the numbers rather than
# living in a spec nobody opened. A test pins each by content.
LIMITS = (
    "Evidenced means the bound gate passed and has demonstrably failed "
    "before. It does not mean the criterion is what the user needed, that "
    "the gate covers the criterion's whole meaning, or that coverage cannot "
    "narrow later — `wring health` watches that across time.",
    "The gate-to-criterion binding is a human's declaration. Wringer checks "
    "the binding's consequences, never its wisdom.",
    "Human criteria are answered by people. Nothing here scored them.",
    "A sensitivity receipt says the gate's result differed between the two "
    "trees, not that the difference was the change. A gate whose own "
    "command arrived with the change reads sensitive for that reason alone "
    "— the citation beside it is how you tell.",
)

_REMEDY = (
    "run `wring verify --prove` to record whether it can fail, or install "
    "the gate first and watch it go red"
)


@dataclass(frozen=True)
class Receipt:
    """Where the record shows this gate can fail."""

    kind: str            # failure | sensitive
    bundle: str          # repo-relative path to the bundle holding it
    cites: str | None = None
    # Only on a sensitive receipt, and only when the run that produced it
    # declared no `run.prove_setup`. RULED 2026-08-11 as disclosure rather
    # than refusal: a prove worktree carries tracked files only, so in a repo
    # whose dependencies are gitignored EVERY pre-change gate fails for the
    # wrong reason and every criterion collects a receipt that means nothing
    # (SPEC_VACUITY_V0 §5a). But refusing on an absent `prove_setup` would
    # have refused the first real measurement this program ever took, whose
    # gates are stdlib and need no setup and whose receipts were true. So the
    # artifact says what it did not check, and `cites` — already carried — is
    # the tell that separates the two cases.
    #
    # **It rides in `reason`, not in a key of its own.** `acceptance.json` is
    # frozen (law 7, `schema/frozen.json`), and a new key — even an optional
    # advisory one — is a silent break for every reader of a bundle already on
    # disk and costs a `wringer.acceptance.v2`. `reason` is free text in the
    # same row, which is where the ruling asked for it: beside the receipt. If
    # a machine-readable form is ever wanted, THAT is the version bump
    # conversation, and it should not be had for a sentence.
    environment: str | None = None

    def as_json(self) -> dict[str, Any]:
        recorded: dict[str, Any] = {"kind": self.kind, "bundle": self.bundle}
        # Present only for a sensitivity receipt, and load-bearing there:
        # limit 4 is why a reader needs the line the verdict rests on.
        if self.cites:
            recorded["cites"] = self.cites
        return recorded


@dataclass(frozen=True)
class Row:
    """One criterion, and what this run can honestly say about it."""

    criterion: str
    title: str
    required: bool
    state: str
    gate_id: str | None = None
    command: str | None = None
    receipt: Receipt | None = None
    reason: str = ""

    @property
    def refuses(self) -> bool:
        """Whether this row stops delivery (ruling 9).

        Only a BOUND criterion can refuse, and only when it is required. An
        unbound one is a debt the author has not paid yet — loud, never
        fatal — because every spec starts with all its criteria required and
        none of them bound, and refusing there would refuse the first
        delivery in every repo that ever ran `wring spec`.
        """
        return (
            self.required
            and self.gate_id is not None
            and self.state != EVIDENCED
        )

    def as_json(self) -> dict[str, Any]:
        return {
            "criterion": self.criterion,
            "title": self.title,
            "required": self.required,
            "state": self.state,
            "gate": self.gate_id,
            "command": self.command,
            "receipt": self.receipt.as_json() if self.receipt else None,
            "reason": self.reason,
            "refuses": self.refuses,
        }


@dataclass(frozen=True)
class Result:
    rows: tuple[Row, ...] = field(default_factory=tuple)

    @property
    def refusing(self) -> tuple[Row, ...]:
        return tuple(row for row in self.rows if row.refuses)

    def counts(self) -> dict[str, int]:
        """One key per state, always all of them.

        Every state is present even at zero: these are counts OVER a known
        population, not measurements that might be absent. The absent-is-not-
        zero law bites on receipts and on drift, where "we did not look" and
        "we looked and found none" are different — here the criteria are
        enumerated, so a zero is a real zero.
        """
        tally = {state: 0 for state in STATES}
        for row in self.rows:
            tally[row.state] += 1
        return tally

    def as_json(self) -> dict[str, Any]:
        return {
            "schema_version": SCHEMA_VERSION,
            "counts": self.counts(),
            "criteria": [row.as_json() for row in self.rows],
            "limits": list(LIMITS),
        }


def read_spec(root: Path) -> spec_module.Spec | None:
    """The APPROVED spec, or None (ruling 8).

    Total by construction: an unreadable or unparseable spec is treated as
    one that is not there. This runs inside `wring verify`, and a malformed
    spec file must not take down a verification — the spec commands are where
    that error belongs, and they report it properly.
    """
    path = root / SPEC_FILENAME
    if not path.is_file():
        return None
    try:
        loaded = spec_module.load(path)
    except Exception:
        return None
    return loaded if loaded.approved else None


def created_stems(state: Any) -> frozenset[str] | None:
    """The names this change brought into existence, or None if unknowable.

    Sourced from git's own untracked list — files it has never seen — so
    nothing here parses a command or reads a failure message. Both were
    considered and refused: classifying failure prose is what SPEC_VACUITY §4b
    forbids, and parsing a shell command for filenames is that same
    classification wearing a structural costume.

    **Stems, not filenames**, and the reason is measured rather than
    theoretical: the gate that exposed this ran
    `python3 -m unittest test_csv_export.CsvExportTest.test_columns...`, which
    names the MODULE. `test_csv_export.py` does not appear in it and a
    filename match would have found nothing. The stem does.

    The cost is stated rather than hidden: a change that creates `utils.py` in
    a repo whose gate command happens to contain the word `utils` will refuse
    a receipt it need not have. That direction is chosen. Ruled 2026-08-11 —
    un-establishable is unevidenced, never a pass — which is the vacuity
    precedent applied to this artifact itself.
    """
    untracked = getattr(state, "untracked", None)
    if untracked is None:
        return None
    return frozenset(
        Path(path).stem for path in untracked if Path(path).stem
    )


def _arrived_with_the_change(command: str | None, created: Any) -> str | None:
    """The name this gate exercises that did not exist before, or None.

    None means "nothing found", which is only an answer when `created` is a
    real set. A None `created` means the question could not be asked, and the
    caller treats that as unevidenced rather than as a pass.
    """
    if not command or not created:
        return None
    for stem in sorted(created):
        if re.search(rf"\b{re.escape(stem)}\b", command):
            return stem
    return None


def assess(
    root: Path,
    cfg: Any,
    results: Any,
    *,
    state: Any = None,
    redactor: Redactor | None = None,
) -> Result | None:
    """What this run can say about each criterion. None when not opted in.

    `results` is the run's own gate results — the gates that actually ran and
    finished. A criterion whose gate is absent from them did not run, and
    absence is absence: never a pass-through to an older green.
    """
    approved = read_spec(root)
    if approved is None:
        return None

    scrub = (redactor or Redactor()).scrub
    bound: dict[str, Any] = {
        gate.proves: gate for gate in cfg.gates if getattr(gate, "proves", None)
    }
    ran = {result.gate.id: result for result in results}

    # Read the record ONCE for the whole artifact rather than per criterion:
    # the same bundles answer every question here, and re-walking them per row
    # would make the cost quadratic in criteria for no new information.
    discriminating = _discriminating_pairs(root)
    # None when the caller had no git state to offer — and None is NOT an
    # empty set here. "Nothing was created" and "we could not ask" are
    # different claims, and only the first may earn a receipt.
    created = created_stems(state)

    rows = []
    for criterion in approved.criteria:
        rows.append(
            _assess_one(criterion, bound, ran, discriminating, created, scrub)
        )
    return Result(rows=tuple(rows))


def _assess_one(criterion, bound, ran, discriminating, created, scrub) -> Row:
    common = {
        "criterion": criterion.id,
        "title": criterion.title,
        "required": criterion.required,
    }

    if criterion.human:
        return Row(
            **common,
            state=HUMAN,
            reason="answered by people, not gates",
        )

    gate = bound.get(criterion.id)
    if gate is None:
        return Row(
            **common,
            state=UNEVIDENCED,
            reason=(
                "no gate proves this criterion — add `proves: "
                f"{criterion.id}` to the gate that evidences it"
            ),
        )

    command = scrub(gate.run)
    detail = {**common, "gate_id": gate.id, "command": command}

    result = ran.get(gate.id)
    if result is None:
        return Row(
            **detail,
            state=GATE_DID_NOT_RUN,
            reason=(
                f"`{gate.id}` left no result in this run, so this run says "
                "nothing about the criterion"
            ),
        )
    if not result.passed:
        return Row(
            **detail,
            state=GATE_FAILED,
            reason=f"`{gate.id}` failed, so the criterion is not met",
        )

    receipt = discriminating.get((gate.id, command))
    if receipt is None:
        return Row(
            **detail,
            state=UNEVIDENCED,
            reason=(
                f"`{gate.id}` passed, but nothing in the record shows it can "
                f"fail — a gate born green evidences nothing. {_REMEDY}"
            ),
        )

    # RULED 2026-08-11: the gate must PRE-DATE the change it judges.
    #
    # A sensitivity receipt says the gate failed before and passes now. That
    # is the same sentence whether the feature was missing or the TEST was —
    # and measured on the first real end-to-end run, it was the test: the
    # drafter bound criteria to a file that did not exist, the agent wrote
    # that file along with the code it checks, and four criteria came back
    # `evidenced` on the strength of an import error. The harness certified
    # work whose acceptance tests its own worker had written.
    #
    # E1a is NOT reversed by this. The pre-change comparison remains the
    # mechanism by which a one-shot agent evidences anything; this adds the
    # one precondition the born-red story always implied.
    if receipt.kind == "sensitive":
        if created is None:
            return Row(
                **detail,
                state=UNEVIDENCED,
                reason=(
                    f"`{gate.id}` passed and the record shows it can fail, but "
                    "this run could not establish that the gate existed before "
                    "the change — and a receipt that cannot be established is "
                    "not a receipt"
                ),
            )
        arrived = _arrived_with_the_change(command, created)
        if arrived is not None:
            return Row(
                **detail,
                state=UNEVIDENCED,
                reason=(
                    f"`{gate.id}` exercises `{arrived}`, which this change "
                    "CREATED — so it failed beforehand only because it did not "
                    "exist yet. A gate that arrived with the work cannot "
                    "evidence the work. Commit the check first and let it go "
                    "red on its own"
                ),
            )
    return Row(
        **detail,
        state=EVIDENCED,
        receipt=receipt,
        reason=(
            f"`{gate.id}` passed, and the record shows it can fail"
            + (f". {receipt.environment}" if receipt.environment else "")
        ),
    )


def _discriminating_pairs(root: Path) -> dict[tuple[str, str], Receipt]:
    """Every `(id, command)` the record shows can fail, with its receipt.

    Reuses health's shipped reader rather than a lookalike, so the exclusions
    stay in ONE place and cannot drift apart: bench-sourced bundles never
    qualify (health ruling 9 — a bench guarantees a red row for every
    required gate on a tree nobody changed), and `genuine_failure` already
    excludes timeouts and exit 127 (a missing binary proves only that PATH
    was wrong).

    The newest receipt wins, because the reader is being sent somewhere to
    look and the most recent demonstration is the most useful one.
    """
    # Imported here, not at module scope: `verify` imports this module and
    # `health` imports `loop` which imports `verify`, so a top-level import
    # closes the cycle. The dependency is real but it is one function deep.
    from wringer import health

    found: dict[tuple[str, str], Receipt] = {}
    coverage = health.discover(root)
    for bundle in coverage.read:
        if not bundle.qualifying:
            continue
        for run in health.gate_runs(bundle):
            key = (run.gate_id, run.command)
            if run.genuine_failure:
                found[key] = Receipt(kind="failure", bundle=bundle.receipt)
            elif run.sensitive:
                found[key] = Receipt(
                    kind="sensitive",
                    bundle=bundle.receipt,
                    cites=_cite_of(bundle.directory, run.gate_id),
                    environment=_environment_of(bundle.directory),
                )
    return found


def _environment_of(bundle_dir: Path) -> str | None:
    """The E3 disclosure, or None when that run verified its own environment.

    Read from the BUNDLE rather than from the live config on purpose: the
    receipt is a claim about the run that produced it, and a `prove_setup`
    added to `.wringer.yaml` afterwards would otherwise retroactively launder
    every receipt already on disk.
    """
    from wringer import vacuity

    try:
        recorded = json.loads(
            (bundle_dir / vacuity.VACUITY_FILENAME).read_text(encoding="utf-8")
        )
    except (OSError, ValueError):
        return None
    if recorded.get("setup"):
        return None
    return (
        "unverified — this run declared no 'run.prove_setup', so a pre-change "
        "tree missing its dependencies would have failed for that reason "
        "instead. Read 'cites' to tell the two apart"
    )


def _cite_of(bundle_dir: Path, gate_id: str) -> str | None:
    """The `cites` line the sensitivity rests on, carried verbatim.

    Limit 4 exists because a sensitive row inherits vacuity's blind spot: a
    gate whose own command arrived with the change reads sensitive for that
    reason alone. Vacuity's answer — binding, and correct — is to make the
    failure VISIBLE rather than to classify it, so the line travels with the
    receipt instead of being interpreted here.
    """
    from wringer import vacuity

    verdict = vacuity.read_verdict(bundle_dir)
    if verdict is None:
        return None
    for row in verdict.rows:
        if row.gate_id == gate_id and row.sensitive:
            return row.cites
    return None


def write(bundle_dir: Path, result: Result, redactor: Redactor | None = None) -> Path:
    """Write `acceptance.json`. Called BEFORE the digests cover the bundle."""
    payload = result.as_json()
    if redactor is not None:
        payload = json.loads(redactor.scrub(json.dumps(payload)))
    path = bundle_dir / ACCEPTANCE_FILENAME
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def read(bundle_dir: Path) -> dict[str, Any] | None:
    """The recorded artifact, or None when the repo never opted in.

    Total by construction, exactly like `vacuity.read_verdict`: a bundle
    whose artifact cannot be read is treated as one that has none. The
    refusal downstream is for a bundle that RECORDED an unevidenced criterion,
    and a damaged file is not that.
    """
    path = bundle_dir / ACCEPTANCE_FILENAME
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    return raw if isinstance(raw, dict) else None
