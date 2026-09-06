"""The port's contract is a thing this repository keeps working.

**Phase 0 of the Bun port (2026-09-06).** `ts/` holds a TypeScript reader
for every frozen record, generated from `schema/` and proved against records
the engine really wrote. It is not engine behaviour and it changes nothing
about what ships; it is the seam a later surface stands on.

These guards are in the PYTHON suite on purpose. The bar (`wring verify`)
runs pytest, and a contract that only breaks in a toolchain the release gate
does not run is a contract that rots silently. What is checked here is what
Python alone can answer: that the exporter matches records the way the
readers do, and that the schema set stays matchable at all. The TypeScript
half runs under `bun test`, wired into CI beside this.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
EXPORT = REPO / "scripts" / "export-records.py"


def test_NO_TWO_SCHEMAS_CLAIM_ONE_VERSION():
    """**A version that names two shapes cannot be matched to one schema by
    any reader, in any language.**

    Measured 2026-09-06, on this repository's own records:
    `graph.resolved.json` declares `wringer.graph.v1` and is not a
    `wringer.graph.v1` manifest, because `graph.py` writes two shapes under
    one `SCHEMA_VERSION`. The exporter reports it and both readers refuse
    it; this holds the SCHEMA SET to the rule so a second collision cannot
    be introduced.
    """
    sys.path.insert(0, str(REPO / "scripts"))
    import importlib.util

    spec = importlib.util.spec_from_file_location("export_records", EXPORT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    known, versionless = module.schemas_by_version(REPO / "schema")
    assert known, "no schema declares a version, so nothing can be matched"
    # `schemas_by_version` raises on a collision; reaching here is the pass.
    # The versionless set is named rather than counted, so adding one is a
    # deliberate act that shows up in a diff.
    assert sorted(versionless) == [
        "bench-event-v2.schema.json",
        "bench-event.schema.json",
        "evidence-event.schema.json",
        "fleet-event.schema.json",
        "gate-result.schema.json",
        "graph-event.schema.json",
        "judge-request.schema.json",
        "loop-event-v2.schema.json",
        "loop-event.schema.json",
    ], (
        "a schema gained or lost its `schema_version` const. A record of that "
        "shape can no longer be matched by declaration, so either give it one "
        "or add it to the file-matched set the contract names as uncovered."
    )


def test_THE_EXPORTER_MATCHES_A_RECORD_BY_WHAT_IT_DECLARES(tmp_path):
    """Never by filename. A reader that guesses from a name will one day read
    a record of another shape and be confident about it."""
    root = tmp_path / "records"
    root.mkdir()
    (root / "journey.json").write_text(
        json.dumps({"schema_version": "wringer.stop.v1"}), encoding="utf-8"
    )
    (root / "nameless.json").write_text(json.dumps({"nothing": True}), encoding="utf-8")

    done = subprocess.run(
        [sys.executable, str(EXPORT), str(root), "--output", str(tmp_path / "c.json")],
        cwd=REPO, capture_output=True, text=True,
    )
    assert done.returncode == 0, done.stderr
    manifest = json.loads((tmp_path / "c.json").read_text(encoding="utf-8"))

    matched = {Path(one["path"]).name: one["schema"] for one in manifest["records"]}
    assert matched["journey.json"] == "stop.schema.json", (
        "a record named journey.json was matched to journey.schema.json — the "
        "exporter is guessing from the filename"
    )
    skipped = {Path(one["path"]).name for one in manifest["skipped"]}
    assert "nameless.json" in skipped, "a record with no version was matched anyway"


def test_A_RECORD_THAT_DECLARES_A_SHAPE_IT_LACKS_IS_REPORTED_NOT_DROPPED(tmp_path):
    """Law 7. The exporter reports every mismatch and exits non-zero; it does
    not quietly leave them out of the corpus and call it complete."""
    root = tmp_path / "records"
    root.mkdir()
    (root / "broken.json").write_text(
        json.dumps({"schema_version": "wringer.stop.v1"}), encoding="utf-8"
    )

    done = subprocess.run(
        [
            sys.executable, str(EXPORT), str(root),
            "--validate", "--output", str(tmp_path / "c.json"),
        ],
        cwd=REPO, capture_output=True, text=True,
    )
    assert done.returncode == 1, "a record that declares a shape it lacks passed"
    assert "declare a version they do not satisfy" in done.stderr, done.stderr

    manifest = json.loads((tmp_path / "c.json").read_text(encoding="utf-8"))
    assert manifest["records"] == [], "a mismatched record was put in the corpus"
    assert len(manifest["mismatched"]) == 1
    assert manifest["mismatched"][0]["version"] == "wringer.stop.v1"


@pytest.mark.skipif(
    not (REPO / "ts" / "packages" / "records" / "src" / "generated.ts").is_file(),
    reason="the generated types are not in this checkout",
)
def test_EVERY_SCHEMA_HAS_A_GENERATED_TYPE():
    """The generated file is checked in so it is reviewable in a diff, which
    means it can go stale. `bun run generate --check` is the real guard and
    runs in CI; this is the half that runs in the release bar, which has no
    bun."""
    generated = (
        REPO / "ts" / "packages" / "records" / "src" / "generated.ts"
    ).read_text(encoding="utf-8")
    missing = [
        path.name
        for path in sorted((REPO / "schema").glob("*.schema.json"))
        if json.dumps(path.name) not in generated
    ]
    assert not missing, (
        f"{', '.join(missing)} — a schema exists that the port's types do not "
        "describe. Run `cd ts && bun run generate`."
    )
