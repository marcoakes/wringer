"""**Drift dies by derivation** — the published schema and the writer, joined.

`test_schema.py` already validates real bundles against the published schemas,
which catches a WRITER that stops matching the schema. It cannot catch the
other direction: a writer that grows a field the schema never learns about
validates fine, because every schema here is `additionalProperties: false`
only where somebody remembered to say so, and a reader targeting the published
format simply never hears about the new field.

Codex publishes its protocol schemas by GENERATING them from the source of
truth (`generate-json-schema`), and the teardown banked that as a steal (§5.7):
*drift dies by derivation.* Wringer's schemas are hand-written and frozen, so
they cannot be generated — a generated file would move bytes on every
refactor, and law 7 says a byte change without a version bump is a silent
break. What CAN be derived is the comparison. This file derives the field set
from the writer's own source and holds the published file to it.

**Scoped to where it can be TRUE, and the exclusions are named.** A guard that
claimed to cover every schema and quietly skipped half would be the defect
class this repository exists to catch, aimed at its own drift protection.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "schema"
SRC = ROOT / "src" / "wringer"

#: writer → (published schema, path to the object it writes).
#:
#: Every entry is a dataclass with an `as_json` whose returned dict is built
#: from string literals, so the field set is derivable from source without
#: instantiating anything.
COVERED: dict[tuple[str, str, str], tuple[str, tuple[str, ...]]] = {
    ("checks", "Identity", "as_json"): (
        "checks.schema.json", ("checks", "items"),
    ),
    ("certificate", "Report", "as_json"): (
        "audit.schema.json", (),
    ),
    ("certificate", "Claim", "as_json"): (
        "audit.schema.json", ("claims", "items"),
    ),
    ("falsify", "Attempt", "as_json"): (
        "falsification-v1.schema.json", ("attempts", "items"),
    ),
    ("coverage", "Requirement", "as_json"): (
        "coverage-v1.schema.json", ("requirements", "items"),
    ),
    ("accept", "Row", "as_json_v3"): (
        "acceptance-v3.schema.json", ("criteria", "items"),
    ),
    ("accept", "Receipt", "as_json"): (
        "acceptance-v3.schema.json", ("criteria", "items", "receipt"),
    ),
    ("accept", "Judgement", "as_json"): (
        "acceptance-v3.schema.json", ("criteria", "items", "judgement"),
    ),
    ("vacuity", "GateRow", "as_json"): (
        "vacuity.schema.json", ("gates", "items"),
    ),
    ("artifacts", "Artifact", "as_json"): (
        "gate-artifacts.schema.json", ("artifacts", "items"),
    ),
    ("artifacts", "Omission", "as_json"): (
        "gate-artifacts.schema.json", ("omitted", "items"),
    ),
    ("bench", "Row", "as_json"): (
        "bench-manifest-v2.schema.json", ("contenders", "items"),
    ),
    ("diagnose", "Diagnosis", "as_json"): (
        "diagnosis.schema.json", (),
    ),
    ("diagnose", "WorkerDiagnosis", "as_json"): (
        "worker-diagnosis-v3.schema.json", (),
    ),
}

#: **What this guard does NOT cover, and why.** Each line is a reason, not an
#: apology: a guard whose scope is unstated is a guard whose scope shrinks.
EXCLUDED = {
    # Superseded versions kept so old bundles still validate. Their writers
    # are gone or have moved on; holding a live writer to a retired schema
    # would force the schema to move, which law 7 forbids.
    "acceptance.schema.json": "superseded by v3; kept for bundles already on disk",
    "acceptance-v2.schema.json": "superseded by v3; kept for bundles already on disk",
    "bench-event.schema.json": "superseded by v2",
    "bench-manifest.schema.json": "superseded by v2",
    "decisions.schema.json": "superseded by v2",
    "execution.schema.json": "superseded by v2",
    "loop-event.schema.json": "superseded by v2",
    "loop-manifest.schema.json": "superseded by v2",
    "untracked.schema.json": "superseded by v2",
    "worker-diagnosis.schema.json": "superseded by v2",
    "worker-diagnosis-v2.schema.json": "superseded by v3; kept for old bundles",
    # Person-authored INPUT formats. There is no writer to derive from —
    # a human writes these, and the schema is the contract they are held to.
    "next-move.schema.json": "an inline-dict writer (loop._write_next_move) "
    "beside the diagnosis it quotes; the REAL written file is "
    "jsonschema-validated in tests/test_worker_contract.py (0.7.1, the "
    "run-4B end-to-end test)",
    "judgements.schema.json": "a person writes this file; there is no writer",
    "judgements-v2.schema.json": "the pen assembles entries as inline dicts "
    "with conditional keys; the REAL written file is jsonschema-validated in "
    "tests/board/test_board_judge.py::test_the_written_file_matches_its_"
    "published_schema",
    "journey.schema.json": "an inline-dict writer in the DRIVE, not the "
    "engine (wringer_drive.journey — this guard derives from src/wringer/ "
    "only, and the engine never writes a journey); the REAL written file is "
    "jsonschema-validated in tests/drive/test_drive_journey.py::"
    "test_the_written_journey_VALIDATES_against_its_published_schema "
    "(0.8.7, P1.14)",
    "judgement-record.schema.json": "an inline-dict writer "
    "(accept.write_judgement_record) capturing another file verbatim; the "
    "REAL bundle sibling is jsonschema-validated in tests/board/"
    "test_pen_fails_closed.py",
    "rubric.schema.json": "a person writes this file; there is no writer",
    "spec.schema.json": "drafted then human-approved; the loader is the reader",
    "gatespec.schema.json": "a person or the drafter writes this sidecar",
    "gatespec-v2.schema.json": "a person or the drafter writes this sidecar; "
    "the REAL rendered file is jsonschema-validated in tests/test_schema.py",
    "choices.schema.json": "a person or the drafter writes this sidecar "
    "(0.8.4); the REAL rendered file is jsonschema-validated in "
    "tests/test_schema.py::test_a_rendered_CHOICES_file_matches_its_schema",
    "fleetscope.schema.json": "declared in .wringer.yaml by a person",
    # Inline-dict writers: the record is assembled in a function rather than
    # by a dataclass, often with conditional keys, so the field set is not a
    # constant in the source. Deriving these needs a refactor of the writer,
    # not of this test, and a refactor for a test's convenience is how a
    # writer stops matching what it means.
    "manifest.schema.json": "assembled inline with conditional keys",
    "delivery-manifest.schema.json": "assembled inline with conditional keys",
    "digests.schema.json": "a map of path → hash; no fixed field set",
    "evidence-event.schema.json": "free-kwargs events; the payload is open by design",
    "graph-event.schema.json": "free-kwargs events",
    "fleet-event.schema.json": "free-kwargs events",
    "bench-event-v2.schema.json": "free-kwargs events",
    "loop-event-v2.schema.json": "free-kwargs events",
    "graph-manifest.schema.json": "assembled inline from the graph file",
    "fleet-manifest.schema.json": "assembled inline",
    "loop-manifest-v2.schema.json": "assembled inline with conditional keys",
    "execution-v2.schema.json": "assembled inline; backend-conditional keys",
    "health-report.schema.json": "a module-level as_json(), not a dataclass",
    "stability.schema.json": "a module-level as_json(), not a dataclass",
    "concurrency.schema.json": "assembled inline",
    "untracked-v2.schema.json": "assembled inline",
    "acquired-manifest.schema.json": "assembled inline",
    "attestation.schema.json": "assembled inline across several clauses",
    # Assembled inline, AND the growth direction this guard exists for is
    # covered twice over elsewhere: the schema is `additionalProperties:
    # false` at the top level and on every requirement item, and
    # `test_certificate.py` both validates a real built record against it and
    # pins the exact top-level key set — because "no empty key for a fact this
    # version has not earned" is a rule about the record and not only about
    # the schema.
    "certificate-v1.schema.json": "assembled inline; growth is closed by "
                                  "additionalProperties and pinned in "
                                  "test_certificate.py",
    "briefed.schema.json": "assembled inline",
    "decisions-v2.schema.json": "assembled inline",
    "judge-request.schema.json": "assembled inline from a rubric",
    "judge-verdict.schema.json": "parsed from a model reply, not written by us",
    "refusal.schema.json": "assembled inline",
    "usage.schema.json": "assembled inline from acp.Usage across two shapes",
    "witness.schema.json": "assembled inline; nested shapes across three lanes",
    "gate-result.schema.json": "assembled inline",
}


#: Keys the ENCLOSING writer adds, not the row's own `as_json`. Every bundle
#: file carries its `schema_version`, and several carry `limits`; both are
#: written where the file is written, so a row-level writer that produced them
#: would be producing them once per row.
ENVELOPE = {"schema_version", "limits"}


def _returned_keys(module: str, klass: str, method: str) -> set[str]:
    """The literal string keys a writer's `as_json` puts in its dict.

    Read from SOURCE rather than by calling it: constructing every one of
    these needs a bundle, a run and a repository, and a guard that needs the
    world to exist is a guard that gets skipped.
    """
    tree = ast.parse((SRC / f"{module}.py").read_text(encoding="utf-8"))
    target = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef) and node.name == klass
    )
    body = next(
        node
        for node in target.body
        if isinstance(node, ast.FunctionDef) and node.name == method
    )
    keys: set[str] = set()
    # `as_json_v3` is built as `{**self.as_json(), ...}` on purpose — "so a key
    # can never exist in one shape and not the other" — so the literal keys in
    # its own body are only the additions. Follow the spread rather than
    # reporting the base keys as missing, which is what a first version of
    # this guard did.
    for node in ast.walk(body):
        if isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values, strict=False):
                if key is not None:
                    continue
                call = value
                if (
                    isinstance(call, ast.Call)
                    and isinstance(call.func, ast.Attribute)
                    and call.func.attr.startswith("as_json")
                ):
                    keys |= _returned_keys(module, klass, call.func.attr)
    for node in ast.walk(body):
        if isinstance(node, ast.Dict):
            for key in node.keys:
                if isinstance(key, ast.Constant) and isinstance(key.value, str):
                    keys.add(key.value)
        # `recorded["environment"] = ...` — the conditional-key idiom this
        # repository uses instead of a second dataclass.
        if isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant):
            if isinstance(node.slice.value, str) and isinstance(node.ctx, ast.Store):
                keys.add(node.slice.value)
    return keys


def _schema_properties(filename: str, path: tuple[str, ...]) -> set[str]:
    node = json.loads((SCHEMA_DIR / filename).read_text(encoding="utf-8"))
    for step in path:
        node = node["properties"][step] if step != "items" else node["items"]
    return set(node["properties"])


@pytest.mark.parametrize(
    "writer", sorted(COVERED), ids=lambda w: f"{w[0]}.{w[1]}.{w[2]}"
)
def test_the_WRITER_and_the_PUBLISHED_SCHEMA_declare_the_same_fields(writer):
    """**The drift direction nothing else covers.**

    Validating a real bundle catches a writer that stops matching the schema.
    It cannot catch a writer that GROWS a field the schema never learned — the
    bundle still validates, and every tool targeting the published format is
    quietly reading a narrower record than the one on disk.
    """
    module, klass, method = writer
    filename, path = COVERED[writer]
    written = _returned_keys(module, klass, method) | ENVELOPE
    published = _schema_properties(filename, path)

    unpublished = written - published - ENVELOPE
    assert not unpublished, (
        f"{module}.{klass}.{method} writes {sorted(unpublished)}, which "
        f"{filename} does not publish. A tool written against the schema will "
        "never see those fields, and the bundle validates anyway — which is "
        "why nothing else catches this"
    )
    unwritten = published - written
    assert not unwritten, (
        f"{filename} publishes {sorted(unwritten)}, which "
        f"{module}.{klass}.{method} no longer writes. A reader is being "
        "promised a field that is not there"
    )


def test_EVERY_PUBLISHED_SCHEMA_is_either_COVERED_or_EXCLUDED_WITH_A_REASON():
    """**The guard on the guard.**

    A round-trip check whose scope nobody states is a check whose scope
    shrinks silently: somebody adds a schema, this file does not grow, and the
    suite still reports "schema round-trip: passing". Every published schema
    must be in one of the two lists, and a new one fails here until a person
    decides which and says why.
    """
    published = {p.name for p in SCHEMA_DIR.glob("*.schema.json")}
    covered = {filename for filename, _path in COVERED.values()}
    accounted = covered | set(EXCLUDED)
    missing = sorted(published - accounted)
    assert not missing, (
        f"these published schemas are neither round-tripped nor excluded: "
        f"{missing}. Add a writer to COVERED, or a REASON to EXCLUDED — the "
        "one thing that may not happen is a schema quietly outside this "
        "guard's scope"
    )
    stale = sorted(accounted - published)
    assert not stale, (
        f"these are listed here and are not published any more: {stale}"
    )


def test_the_EXCLUSIONS_each_carry_a_reason():
    for filename, reason in EXCLUDED.items():
        assert reason and len(reason) > 12, (
            f"{filename} is excluded with no real reason: {reason!r}"
        )
