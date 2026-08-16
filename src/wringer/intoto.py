"""in-toto emission — R3 of `WRINGER_RULING_2026-08-14`.

*Test restated: can `gh attestation verify` or `cosign verify-attestation` read
a Wringer bundle? Before this module: no.*

**One slice, not a project**, and the ruling says why in as many words: the
scan's sharpest warning is that this window is being spent on provenance
plumbing Chainloop and GitHub give away. So this emits the STANDARD and stops.
It writes two documents beside an attestation, both in-toto Statements:

1. the published **`test-result` v0.1** predicate, which any conformant reader
   already understands;
2. **exactly one** custom predicate carrying what the standard cannot — the
   witness provenance (authored / proved-red / pinned digest) and the vacuity
   verdict.

**`wringer.attestation.v1` is frozen and gains no v2 dialect** (Law 7, and R3
verbatim). Nothing here edits it, nothing here reads differently because of it,
and a repository that never runs this command writes byte-identical bundles.
These are SIBLINGS, on the pattern `digests.json` and `vacuity.json` set.

**Why a custom predicate at all, when the ruling is hostile to dialects.**
`test-result` v0.1 has fields for what ran and what passed, and none for the
only thing this program's verdicts turn on: whether the check that passed had
ever been shown able to FAIL. A `test-result` saying `PASSED` over a vacuous
gate is exactly the artifact the 2026-08-13 corpus run produced 26 times. The
custom predicate carries that, one predicate, no more — and every reader that
ignores it still gets a valid, useful `test-result`.

**What emission does NOT do**, said here because a provenance format invites
the assumption: it signs nothing. Signing is `wring attest --sign` in CI
through keyless Sigstore, Wringer holds no key, and `signature_missing` is the
ordinary local result. An in-toto Statement is a claim in a standard envelope;
it is not evidence that anybody stood behind it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from wringer import evidence

# The in-toto Statement envelope, v1. Both documents use it.
STATEMENT_TYPE = "https://in-toto.io/Statement/v1"

# The PUBLISHED predicate, unversioned by us and unextended by us.
TEST_RESULT_TYPE = "https://in-toto.io/attestation/test-result/v0.1"

# The one custom predicate R3 permits. Namespaced under the project's own
# repository so it can never be mistaken for a standard type.
WITNESS_TYPE = "https://github.com/marcoakes/wringer/witness/v0.1"

TEST_RESULT_FILENAME = "test-result.intoto.json"
WITNESS_FILENAME = "witness.intoto.json"

# `test-result` v0.1's closed result vocabulary.
PASSED = "PASSED"
FAILED = "FAILED"
WARNED = "WARNED"

LIMITS = (
    "An in-toto Statement is a claim in a standard envelope. It is not a "
    "signature and not a second opinion: these bytes say what Wringer's own "
    "bundle says, in a shape other tools can read.",
    "`test-result` v0.1 records what ran and what passed. It has no field for "
    "whether a passing check was ever shown able to FAIL, which is the only "
    "thing this program's verdicts turn on — that is why the sibling witness "
    "predicate exists, and why a reader that ignores it learns less.",
    "A witness proves the stated criterion could fail and was made to pass. It "
    "does not certify agreement with an unstated intended fix, and where the "
    "criterion under-describes the intent the witness inherits that gap.",
    "Nothing here is signed. Signing is offered in CI only, via "
    "`wring attest --sign`, through keyless Sigstore OIDC; Wringer holds no "
    "key and signs nothing itself.",
)


def _read(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def subject_of(root: Path, run_dir: Path) -> list[dict[str, Any]]:
    """What these statements are ABOUT.

    The run bundle's own digest, taken from **`attest.check_digests`** — the
    same function `wring attest` uses, so the number here and the number in the
    attestation beside it cannot disagree. Recomputing it locally would be a
    second inventory to keep in step with the one the bundle owns, and it would
    also skip the verification: `check_digests` re-hashes every file and
    RAISES if one has moved, so a subject line here is a statement that the
    bundle was intact when it was written.
    """
    from wringer import attest as attest_module

    manifest = _read(run_dir / evidence.MANIFEST_FILENAME)
    repo = manifest.get("repo", {})
    digest, _count = attest_module.check_digests(run_dir, "run")
    subject: list[dict[str, Any]] = [{
        "name": f"wringer-bundle:{run_dir.name}",
        "digest": {"sha256": digest},
    }]
    head = repo.get("head_sha")
    if head:
        # The commit the gates ran against, in the shape a git-aware reader
        # expects. `gitCommit` is in-toto's own registered digest name.
        subject.append({
            "name": repo.get("branch") or "HEAD",
            "digest": {"gitCommit": head},
        })
    return subject


def test_result(root: Path, run_dir: Path) -> dict[str, Any]:
    """The PUBLISHED predicate, filled from the bundle and nothing else.

    Every gate is a "test" in `test-result`'s sense: something that ran and
    reported. The mapping is deliberately dumb — a gate id becomes a test name
    and a status becomes a bucket — because any cleverness here would be this
    module forming an opinion the bundle does not carry.
    """
    passed, failed, warned = [], [], []
    for _, row in evidence.read_gate_results(run_dir):
        gate = row.get("gate_id") or "?"
        status = str(row.get("status") or "")
        if status == "passed":
            passed.append(gate)
        elif status == "failed":
            failed.append(gate)
        else:
            # Skipped, interrupted, anything unanticipated. WARNED rather than
            # PASSED, for the reason every default in this repository leans the
            # same way: an outcome nobody planned for claims less.
            warned.append(gate)

    manifest = _read(run_dir / evidence.MANIFEST_FILENAME)
    result = (manifest.get("result") or {}).get("status")
    return {
        "_type": STATEMENT_TYPE,
        "subject": subject_of(root, run_dir),
        "predicateType": TEST_RESULT_TYPE,
        "predicate": {
            "result": PASSED if result == "passed" else (
                FAILED if failed else WARNED
            ),
            "configuration": [{
                "name": "wringer-config",
                "uri": ".wringer.yaml",
            }],
            "url": f"file://{run_dir}",
            "passedTests": passed,
            "warnedTests": warned,
            "failedTests": failed,
        },
    }


def witness_record_for(root: Path, run_dir: Path) -> Path:
    """Where the witness record for THIS run lives — in the LOOP's bundle.

    **Not in the run bundle**, and the first draft of this module looked there
    and found nothing. `loop._write_witness_record` writes `witness.json` into
    the LOOP's own directory, on the same reasoning that put the loop's
    manifest there: a loop spans several verify bundles and its record belongs
    to the loop, not to whichever lap happened to be last.

    The join is the loop ledger's `verify.finished` events, whose
    `evidence_dir` is required by `loop-event-v2.schema.json` — the same join
    the benchmark uses to read a loop's containment, and the same one the board
    uses to order attempts. A path that no loop claims returns a path that does
    not exist, and the caller treats absence as absence.
    """
    loops = root / ".wringer" / "loops"
    if not loops.is_dir():
        return run_dir / "witness.json"
    wanted = run_dir.resolve()
    for loop_dir in sorted(loops.iterdir(), reverse=True):
        ledger = loop_dir / "loop.jsonl"
        if not ledger.is_file():
            continue
        for line in ledger.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except ValueError:
                continue
            directory = event.get("evidence_dir")
            if directory and (root / directory).resolve() == wanted:
                return loop_dir / "witness.json"
    return run_dir / "witness.json"


def witness_statement(root: Path, run_dir: Path) -> dict[str, Any] | None:
    """The ONE custom predicate: what `test-result` structurally cannot hold.

    Returns None when the run carried neither a witness lane nor a vacuity
    verdict — absence is absence, and an empty predicate would be a document
    asserting that nothing is known, which is not the same as not asserting.
    """
    witness = _read(witness_record_for(root, run_dir))
    vacuity = _read(run_dir / evidence.VACUITY_FILENAME) if (
        run_dir / evidence.VACUITY_FILENAME
    ).is_file() else {}
    if not witness and not vacuity:
        return None

    criteria = []
    for row in witness.get("witnesses") or []:
        proved = row.get("proved_red") or {}
        executed = row.get("executed") or {}
        criteria.append({
            "criterion": row.get("proves"),
            # W6's field mapping, and the three facts that make a witness worth
            # anything: it pre-dates the work, it was red for the right reason,
            # and the bytes that ran are the bytes that were pinned.
            "authoredBy": ((row.get("authored") or {}).get("by") or {}).get(
                "model"
            ),
            "authoredAgainst": (row.get("authored") or {}).get("base_sha"),
            "provedRed": proved.get("outcome"),
            "provedRedVerdict": proved.get("verdict"),
            "pinnedSha256": (row.get("pinned") or {}).get("sha256"),
            "executedResult": executed.get("result"),
            "discarded": row.get("discarded"),
        })

    return {
        "_type": STATEMENT_TYPE,
        "subject": subject_of(root, run_dir),
        "predicateType": WITNESS_TYPE,
        "predicate": {
            # **The field `test-result` has nowhere to put.** A green gate that
            # was never shown able to fail is the artifact the corpus run
            # produced 26 times, and no standard predicate can express the
            # difference.
            "vacuity": {
                "verdict": vacuity.get("verdict"),
                "reason": vacuity.get("reason"),
            } if vacuity else None,
            "witnesses": criteria,
            "limits": list(LIMITS),
        },
    }


def write(root: Path, run_dir: Path, out_dir: Path) -> list[Path]:
    """Emit beside an attestation. Returns what was written.

    Never inside the run bundle: a run's `digests.json` commits to its own
    contents, and writing a new file in there after the fact would either
    invalidate that digest or require rewriting it — and **on-disk bundles are
    never rewritten**.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    written = [out_dir / TEST_RESULT_FILENAME]
    written[0].write_text(
        json.dumps(test_result(root, run_dir), indent=2) + "\n",
        encoding="utf-8",
    )
    statement = witness_statement(root, run_dir)
    if statement is not None:
        path = out_dir / WITNESS_FILENAME
        path.write_text(
            json.dumps(statement, indent=2) + "\n", encoding="utf-8"
        )
        written.append(path)
    return written
