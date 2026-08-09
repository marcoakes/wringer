"""`wring health` — the reader (SPEC_HEALTH_V0.md §3, slice H1).

The command's whole thesis is that a check can narrow while still passing. So
the first thing tested here is not a verdict — it is whether this tool can
narrow while still passing, which it would do the instant a bundle it could
not read fell off the edge without being named.

`discovered == read + skipped + duplicate` is the load-bearing assertion in
this file. A bundle dropped before classification looks exactly like a clean
run, and the spec's first draft made that unavoidable: it defined a bundle as
a directory whose manifest carried a KNOWN SCHEMA VERSION, which made every
unreadable bundle undiscoverable and therefore unskippable — "there is no
quiet path" asserted by the very predicate that built one.
"""

from __future__ import annotations

import json
from pathlib import Path

from wringer import evidence, health

MANIFEST = evidence.MANIFEST_FILENAME


def write_run(
    directory: Path,
    run_id: str,
    gates: list[dict],
    *,
    started_at: str = "2026-08-01T10:00:00+01:00",
    vacuity_rows: list[dict] | None = None,
) -> Path:
    """A verify bundle, in the shape `verify.run` really writes one."""
    directory.mkdir(parents=True, exist_ok=True)
    (directory / MANIFEST).write_text(
        json.dumps(
            {
                "schema_version": health.RUN_SCHEMA,
                "run_id": run_id,
                "started_at": started_at,
                "repo": {"root": ".", "head_sha": "0" * 40, "branch": "main",
                         "dirty": False},
                "result": {"status": "passed", "failed_gate": None},
            }
        ),
        encoding="utf-8",
    )
    for index, gate in enumerate(gates, start=1):
        gate_dir = directory / "gates" / f"{index:03d}_{gate['gate_id']}"
        gate_dir.mkdir(parents=True, exist_ok=True)
        (gate_dir / "result.json").write_text(
            json.dumps(
                {
                    "gate_id": gate["gate_id"],
                    "command": gate["command"],
                    "exit_code": 0 if gate.get("status", "passed") == "passed" else 1,
                    "duration_ms": gate.get("duration_ms", 10),
                    "timed_out": gate.get("timed_out", False),
                    "stdout_truncated": False,
                    "stderr_truncated": False,
                    "optional": gate.get("optional", False),
                    "status": gate.get("status", "passed"),
                }
            ),
            encoding="utf-8",
        )
    if vacuity_rows is not None:
        (directory / "vacuity.json").write_text(
            json.dumps(
                {
                    "schema_version": "wringer.vacuity.v1",
                    "verdict": "proven",
                    "reason": "planted",
                    "worktree_ms": 1,
                    "prove_ms": 1,
                    "setup": None,
                    "gates": vacuity_rows,
                }
            ),
            encoding="utf-8",
        )
    return directory


def runs_dir(root: Path) -> Path:
    return root / evidence.RUNS_DIRNAME


# --- the coverage ledger ----------------------------------------------------


def test_the_committed_example_bundle_reads_rather_than_skipping(tmp_path):
    """The compatibility gate, and the oldest bundle in the tree.

    `.wringer/` is gitignored, so `.wringer.example/` is the ONLY bundle in a
    fresh clone. It predates vacuity and usage. If discovery is too narrow it
    lands in `skipped`; if it is too brittle it raises. It must read."""
    repo_root = Path(__file__).resolve().parent.parent
    example = repo_root / ".wringer.example"
    if not example.is_dir():  # pragma: no cover - repo-only fixture
        import pytest

        pytest.skip(".wringer.example is not part of the distribution")

    coverage = health.discover(repo_root)
    receipts = [bundle.receipt for bundle in coverage.read]
    assert any(r.startswith(".wringer.example/") for r in receipts), (
        f"the committed fixture was not read: {receipts}"
    )
    assert not [s for s in coverage.skipped if s.receipt.startswith(".wringer.example")]


def test_an_unreadable_manifest_is_discovered_and_named(tmp_path):
    """The predicate that mattered. A directory whose manifest is not JSON has
    no schema version — under the first draft's definition it was not a bundle
    at all, so it could never reach the skip list it was promised to appear
    in."""
    write_run(runs_dir(tmp_path) / "20260801-100000-aaaa", "20260801-100000-aaaa",
              [{"gate_id": "test", "command": "pytest -q"}])
    garbage = runs_dir(tmp_path) / "20260801-110000-bbbb"
    garbage.mkdir(parents=True)
    (garbage / MANIFEST).write_text("this is not json {{{", encoding="utf-8")

    coverage = health.discover(tmp_path)

    assert len(coverage.read) == 1
    assert len(coverage.skipped) == 1
    skip = coverage.skipped[0]
    assert "20260801-110000-bbbb" in skip.receipt
    assert "not JSON" in skip.reason, skip.reason


def test_an_unknown_schema_version_is_named_with_its_version(tmp_path):
    """A bundle from a newer Wringer is not a defect and is not silently
    dropped: it is named, with the version, so the reader can see the shape of
    what was missed."""
    future = runs_dir(tmp_path) / "20260801-120000-cccc"
    future.mkdir(parents=True)
    (future / MANIFEST).write_text(
        json.dumps({"schema_version": "wringer.evidence.v9", "run_id": "x"}),
        encoding="utf-8",
    )

    coverage = health.discover(tmp_path)

    assert not coverage.read
    assert len(coverage.skipped) == 1
    assert "wringer.evidence.v9" in coverage.skipped[0].reason


def test_the_coverage_arithmetic_balances(tmp_path):
    """`discovered == read + skipped + duplicate`, which is the assertion the
    spec's first DONE box did NOT make: it pinned only that the skip COUNT
    matched the skip LIST, and a bundle dropped before classification passes
    that silently while never appearing in either."""
    write_run(runs_dir(tmp_path) / "a", "a", [{"gate_id": "t", "command": "c"}])
    write_run(runs_dir(tmp_path) / "b", "b", [{"gate_id": "t", "command": "c"}])
    bad = runs_dir(tmp_path) / "c"
    bad.mkdir(parents=True)
    (bad / MANIFEST).write_text("{", encoding="utf-8")

    coverage = health.discover(tmp_path)

    planted = 3
    assert coverage.discovered == planted, (
        f"{planted} bundles were planted and the ledger accounts for "
        f"{coverage.discovered}: read={len(coverage.read)} "
        f"skipped={len(coverage.skipped)} duplicate={len(coverage.duplicates)}"
    )


def test_the_same_bundle_reached_twice_is_counted_once_and_named(tmp_path):
    """`--from` takes arbitrary paths, so the repo's own runs restored as a CI
    artifact arrive twice. Counting them twice moves gates across MIN_HISTORY
    and pads the window until an older failure falls out of it — an
    unnormalised path argument doing the job the threshold key was removed to
    prevent."""
    write_run(runs_dir(tmp_path) / "dup", "dup", [{"gate_id": "t", "command": "c"}])

    coverage = health.discover(tmp_path, extra=(runs_dir(tmp_path),))

    assert len(coverage.read) == 1, [b.receipt for b in coverage.read]
    assert len(coverage.duplicates) == 1
    assert coverage.duplicates[0].already_read_as, "a duplicate names no original"


def test_a_from_root_outside_the_repo_is_read_and_prefixed(tmp_path):
    """Receipts are repo-root-relative, or `--from`-root-relative WITH the
    root named — never "bundle-relative", which in this repo already means
    relative to a bundle's own root and is the one base a receipt cannot use,
    since a receipt's whole job is to say which bundle."""
    repo = tmp_path / "repo"
    (repo / ".wringer").mkdir(parents=True)
    elsewhere = tmp_path / "ci-history"
    write_run(elsewhere / "runs" / "r1", "r1", [{"gate_id": "t", "command": "c"}])

    coverage = health.discover(repo, extra=(elsewhere,))

    assert len(coverage.read) == 1
    receipt = coverage.read[0].receipt
    assert receipt.startswith(f"{elsewhere.as_posix()}:"), receipt
    assert "runs/r1" in receipt


def test_health_reads_with_no_repository_at_all(tmp_path):
    """`--from`'s stated purpose is CI artifact restores and other checkouts,
    and a CI scratch directory holding downloaded artifacts is normally not a
    git checkout. Health reads bundles, not trees."""
    elsewhere = tmp_path / "artifacts"
    write_run(elsewhere / "r1", "r1", [{"gate_id": "t", "command": "c"}])

    coverage = health.discover(None, extra=(elsewhere,))

    assert len(coverage.read) == 1


# --- bench evidence is read, labelled, and decides nothing ------------------


def test_bench_sourced_bundles_are_read_but_never_qualify(tmp_path):
    """Ruling 9, and the sharpest machinery finding of the spec review.

    `wring bench` refuses to start unless the baseline is RED, so it
    guarantees a failed row for every required gate on a tree nobody changed,
    under the SAME `(id, command)` pairs as the repo's real gates — and its
    contender loops write enough bundles to fill the window by themselves.
    Counting them would make every benched gate read `alive` on a staged
    repair exercise, which is a way to make zombies disappear.

    They are read and labelled rather than dropped: evidence that is hidden
    cannot be audited."""
    write_run(runs_dir(tmp_path) / "real", "real",
              [{"gate_id": "test", "command": "pytest -q"}])
    inside = tmp_path / ".wringer" / "worktrees" / "20260801-1-baseline" / ".wringer"
    write_run(inside / "runs" / "synthetic", "synthetic",
              [{"gate_id": "test", "command": "pytest -q", "status": "failed"}])

    coverage = health.discover(tmp_path)

    by_id = {bundle.run_id: bundle for bundle in coverage.read}
    assert set(by_id) == {"real", "synthetic"}, sorted(by_id)
    assert by_id["real"].qualifying is True
    assert by_id["synthetic"].bench_sourced is True
    assert by_id["synthetic"].qualifying is False, (
        "a bench baseline's planted failure counts as evidence the repo's "
        "gate discriminates"
    )


# --- identity: (id, command), and the sensitivity join ----------------------


def test_editing_a_gates_command_starts_a_new_pair(tmp_path):
    """Editing is HOW checks narrow — the session that motivated this command
    watched a probe keep its name while its coverage shrank. Continuity across
    an edit cannot be evidenced, so it is not granted."""
    write_run(runs_dir(tmp_path) / "old", "old",
              [{"gate_id": "lint", "command": "ruff check src"}])
    write_run(runs_dir(tmp_path) / "new", "new",
              [{"gate_id": "lint", "command": "ruff check src tests"}])

    pairs = health.history(health.discover(tmp_path))

    assert [p.key for p in pairs] == [
        ("lint", "ruff check src"),
        ("lint", "ruff check src tests"),
    ]
    assert all(len(p.runs) == 1 for p in pairs)


def test_a_sensitive_row_attaches_to_the_pair_not_to_the_bare_id(tmp_path):
    """The join the spec had to be made to state.

    A `vacuity.json` row carries `gate_id` and NO command — the schema's rows
    are `additionalProperties: false`, and `read_verdict` exposes exactly
    those fields. So sensitivity must be joined to the sibling `result.json`
    in the SAME bundle to learn which command it was about. An implementation
    keying on `gate_id` alone lets an edited gate inherit its predecessor's
    sensitivity and stay `alive` — the identity ruling defeated in the precise
    case it exists for, and a failure-only fixture would never notice."""
    write_run(
        runs_dir(tmp_path) / "old", "old",
        [{"gate_id": "test", "command": "pytest -q"}],
        vacuity_rows=[{
            "gate_id": "test", "changed": "passed", "pre_change": "failed",
            "sensitive": True, "cites": "AssertionError", "pre_change_log": "x",
        }],
    )
    write_run(
        runs_dir(tmp_path) / "new", "new",
        [{"gate_id": "test", "command": "pytest -q tests/unit"}],
    )

    pairs = {p.key: p for p in health.history(health.discover(tmp_path))}

    old = pairs[("test", "pytest -q")]
    new = pairs[("test", "pytest -q tests/unit")]
    assert any(run.sensitive for run in old.runs), "the sensitive row was lost"
    assert not any(run.sensitive for run in new.runs), (
        "the edited gate inherited its predecessor's sensitivity — history "
        "attached to the id instead of to the pair"
    )


# --- what counts as a failure ----------------------------------------------


def test_a_timeout_is_not_a_genuine_failure(tmp_path):
    """The inversion the spec review caught, pinned against the real schema.

    `gate-result.schema.json` has a two-value status whose own description
    reads "passed requires exit_code 0 AND timed_out false" — so EVERY timeout
    already records `status: failed`. The spec's first draft defined a genuine
    failure as `status: failed`, full stop, which admits every timeout and
    makes a gate that has only ever died of slowness read as the most alive
    thing in the report."""
    write_run(
        runs_dir(tmp_path) / "slow", "slow",
        [{"gate_id": "test", "command": "pytest -q", "status": "failed",
          "timed_out": True}],
    )
    write_run(
        runs_dir(tmp_path) / "real", "real",
        [{"gate_id": "test", "command": "pytest -q", "status": "failed"}],
    )

    pairs = health.history(health.discover(tmp_path))
    assert len(pairs) == 1
    runs = {run.receipt.split("/")[-1]: run for run in pairs[0].runs}

    assert runs["slow"].genuine_failure is False, (
        "a timeout counted as the gate discriminating; slowness is not "
        "discrimination"
    )
    assert runs["real"].genuine_failure is True


def test_a_gate_that_never_finished_leaves_no_row(tmp_path):
    """A gate with no `result.json` never finished, and non-evidence is not
    evidence. It must not become a row, and it must not become a zero."""
    directory = write_run(runs_dir(tmp_path) / "cut", "cut",
                          [{"gate_id": "test", "command": "pytest -q"}])
    # A gate that started and was interrupted: its directory and logs exist,
    # its result does not.
    unfinished = directory / "gates" / "002_lint"
    unfinished.mkdir(parents=True)
    (unfinished / "stdout.log").write_text("half a line", encoding="utf-8")

    pairs = health.history(health.discover(tmp_path))

    assert [p.gate_id for p in pairs] == ["test"]


# --- determinism ------------------------------------------------------------


def test_ordering_reads_the_recorded_time_not_the_directory_name(tmp_path):
    """Bundles are ordered by what the manifest RECORDS, parsed to an absolute
    instant. `started_at` carries a local offset, so two bundles written in
    different zones cannot be ordered by string comparison — and the directory
    name is not the truth either."""
    write_run(runs_dir(tmp_path) / "zzz-older", "zzz-older",
              [{"gate_id": "t", "command": "c"}],
              started_at="2026-08-01T09:00:00+00:00")
    # 11:00+02:00 IS 09:00Z — the same instant as the one above, spelled the
    # way a machine in another zone would spell it. Sorted as strings these
    # two swap; sorted as instants they tie and fall to the id tiebreak.
    write_run(runs_dir(tmp_path) / "aaa-newer", "aaa-newer",
              [{"gate_id": "t", "command": "c"}],
              started_at="2026-08-01T11:00:00+02:00")
    write_run(runs_dir(tmp_path) / "mmm-newest", "mmm-newest",
              [{"gate_id": "t", "command": "c"}],
              started_at="2026-08-01T18:00:00+00:00")

    coverage = health.discover(tmp_path)
    assert coverage.read[-1].run_id == "mmm-newest", [
        b.run_id for b in coverage.read
    ]


def test_discovery_is_stable_across_repeated_reads(tmp_path):
    """Directory iteration order is OS-dependent, so every boundary sorts.
    Same inputs, same order, or the report cannot be byte-deterministic."""
    for name in ("d", "a", "c", "b"):
        write_run(runs_dir(tmp_path) / name, name,
                  [{"gate_id": "t", "command": "c"}])

    first = [b.receipt for b in health.discover(tmp_path).read]
    second = [b.receipt for b in health.discover(tmp_path).read]

    assert first == second
    assert first == sorted(first), first
