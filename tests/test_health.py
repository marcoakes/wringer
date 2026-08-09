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
                    "exit_code": gate.get(
                        "exit_code",
                        0 if gate.get("status", "passed") == "passed" else 1,
                    ),
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


# --- the verdicts (SPEC_HEALTH_V0.md §2, slice H2) --------------------------


def plant(root: Path, count: int, *, gate="test", command="pytest -q",
          status="passed", start=0, **kw) -> None:
    """`count` verify bundles, each one qualifying run for one pair."""
    for index in range(start, start + count):
        write_run(
            runs_dir(root) / f"r{index:03d}", f"r{index:03d}",
            [dict(gate_id=gate, command=command, status=status, **kw)],
            started_at=f"2026-08-01T{index // 60:02d}:{index % 60:02d}:00+00:00",
        )


def only(assessments, gate="test"):
    found = [a for a in assessments if a.pair.gate_id == gate]
    assert len(found) == 1, [(a.pair.key, a.verdict) for a in assessments]
    return found[0]


def declared(gate="test", command="pytest -q"):
    return {(gate, command)}


def test_one_failure_makes_a_gate_alive_at_any_history_depth(tmp_path):
    """Ruling 10, and the half the spec's first draft got wrong.

    A demonstration is a demonstration: one recorded genuine failure proves
    the gate CAN fail, and no quantity of runs is needed to believe it. The
    draft's limit said "history below MIN_HISTORY proves nothing in either
    direction", which is false in the positive direction against its own
    sensitivity question — and it made the decay demo's first beat, a gate
    demonstrably alive on a failure, impossible to film."""
    plant(tmp_path, 2)
    plant(tmp_path, 1, status="failed", start=90)

    assessed = only(health.assess(health.discover(tmp_path), declared()))

    assert assessed.verdict == health.ALIVE
    assert assessed.qualifying == 3, "three runs, and the verdict is not thin"
    assert assessed.last_failure


def test_thin_history_with_no_evidence_is_untested_never_zombie(tmp_path):
    """Thin history renders as thin history. `untested` is not "probably
    fine", and it is not `zombie` either: nothing has been shown."""
    plant(tmp_path, health.MIN_HISTORY - 1)

    assessed = only(health.assess(health.discover(tmp_path), declared()))

    assert assessed.verdict == health.UNTESTED
    assert assessed.qualifying == health.MIN_HISTORY - 1


def test_enough_green_runs_with_no_discrimination_is_a_zombie(tmp_path):
    """The headline verdict. It claims the RECORD, never the gate: a stable
    codebase can keep a good gate green for months, and the claim is only that
    nothing recent shows it discriminating."""
    plant(tmp_path, health.MIN_HISTORY)

    assessed = only(health.assess(health.discover(tmp_path), declared()))

    assert assessed.verdict == health.ZOMBIE
    assert assessed.last_failure is None
    assert assessed.last_sensitive is None


def test_a_failure_that_falls_out_of_the_window_stops_counting(tmp_path):
    """The decay this instrument exists to measure. Without a window one
    ancient failure keeps a gate `alive` forever — an anti-decay model in a
    decay instrument."""
    plant(tmp_path, 1, status="failed")
    plant(tmp_path, health.WINDOW, start=1)

    assessed = only(health.assess(health.discover(tmp_path), declared()))

    assert assessed.qualifying == health.WINDOW
    assert assessed.verdict == health.ZOMBIE, (
        "a failure older than the window still decided the verdict"
    )


def test_a_single_sensitive_row_makes_a_gate_alive(tmp_path):
    """A `--prove` pass that recorded the gate failing on the pre-change tree
    while passing on the changed one is the strongest vitality evidence there
    is, and one of them is enough."""
    write_run(
        runs_dir(tmp_path) / "p", "p",
        [{"gate_id": "test", "command": "pytest -q"}],
        vacuity_rows=[{
            "gate_id": "test", "changed": "passed", "pre_change": "failed",
            "sensitive": True, "cites": "AssertionError", "pre_change_log": "l",
        }],
    )

    assessed = only(health.assess(health.discover(tmp_path), declared()))

    assert assessed.verdict == health.ALIVE
    # The receipt NAMES the run, because "alive" without one is the claim
    # this command exists to refuse to make.
    assert assessed.last_sensitive is not None
    assert assessed.last_sensitive.endswith("/p"), assessed.last_sensitive
    assert assessed.last_failure is None, "a sensitive row is not a failure"


def test_a_gate_whose_only_failures_are_timeouts_is_not_alive(tmp_path):
    """Ruling 7. A gate that has only ever died of slowness has never
    demonstrated it can REJECT anything, and counting it would let the least
    healthy gates read as the most alive. Every timeout in the real schema
    already carries `status: failed`, which is what made this dangerous."""
    plant(tmp_path, health.MIN_HISTORY, status="failed", timed_out=True)

    assessed = only(health.assess(health.discover(tmp_path), declared()))

    assert assessed.verdict == health.ZOMBIE, (
        "timeouts alone made the gate alive — the inversion ruling 7 forbids"
    )
    assert assessed.drift.timeouts == health.MIN_HISTORY, (
        "the timeouts vanished instead of surfacing as drift"
    )


def test_bench_evidence_cannot_move_a_verdict(tmp_path):
    """Ruling 9, at the verdict layer rather than the reader's.

    A bench guarantees a failed row for every required gate on a tree nobody
    changed. If those counted, one `wring bench` would stamp every benched
    gate `alive` for the next twenty-five runs."""
    plant(tmp_path, health.MIN_HISTORY)
    inside = tmp_path / ".wringer" / "worktrees" / "b-baseline" / ".wringer"
    write_run(inside / "runs" / "synthetic", "synthetic",
              [{"gate_id": "test", "command": "pytest -q", "status": "failed"}])

    assessed = only(health.assess(health.discover(tmp_path), declared()))

    assert assessed.verdict == health.ZOMBIE, (
        "a bench baseline's planted failure was read as the repo's gate "
        "discriminating"
    )
    assert assessed.qualifying == health.MIN_HISTORY, (
        "bench runs padded the window"
    )


def test_a_pair_the_config_no_longer_declares_is_retired_with_no_verdict(
    tmp_path
):
    """The frozen-window hole. A pair stops accumulating runs the moment it is
    renamed or deleted, so its window freezes at whatever it last held and it
    reads `alive` in perpetuity — from evidence of arbitrary age, for a check
    that no longer exists. `retired` claims nothing."""
    plant(tmp_path, 1, status="failed")

    assessed = only(health.assess(health.discover(tmp_path), declared=set()))

    assert assessed.verdict == health.RETIRED
    assert assessed.verdict not in (health.ALIVE, health.ZOMBIE, health.UNTESTED)


def test_with_no_config_at_all_recency_stands_in_for_the_contract(tmp_path):
    """Health reads bundles, not trees, and works in a repo with no
    `.wringer.yaml`. Without a config there is nothing to say which checks are
    still the contract, so a pair absent from the newest bundles is retired
    rather than credited forever."""
    write_run(runs_dir(tmp_path) / "r000", "r000",
              [{"gate_id": "gone", "command": "old", "status": "failed"}],
              started_at="2026-08-01T00:00:00+00:00")
    plant(tmp_path, health.WINDOW, start=1)

    assessed = health.assess(health.discover(tmp_path), declared=None)
    by_id = {a.pair.gate_id: a for a in assessed}

    assert by_id["gone"].verdict == health.RETIRED, (
        "a gate that stopped being run kept a verdict from a frozen window"
    )
    assert by_id["test"].verdict != health.RETIRED


def test_no_count_in_an_assessment_is_an_invented_zero(tmp_path):
    """Absence is absence. A gate with no history renders unknown, never 0 —
    and the duration trend is None rather than 1.0 when there is not enough
    history to compute one."""
    plant(tmp_path, 3)

    assessed = only(health.assess(health.discover(tmp_path), declared()))

    assert assessed.drift.slowest_ratio is None, (
        "a trend was invented from three runs"
    )
    assert assessed.drift.slow is False
    assert assessed.last_failure is None


def test_assessment_is_stable_across_repeated_reads(tmp_path):
    """Ruling 4's precondition: same bundles in, same everything out."""
    plant(tmp_path, 12)

    first = [(a.pair.key, a.verdict, a.qualifying)
             for a in health.assess(health.discover(tmp_path), declared())]
    second = [(a.pair.key, a.verdict, a.qualifying)
              for a in health.assess(health.discover(tmp_path), declared())]

    assert first == second


# --- determinism: ruling 4, pinned by structure not by luck -----------------


def test_the_report_path_reads_no_clock_and_no_environment():
    """Ruling 4, by the import-parsing test's method rather than a grep.

    "Two runs produce identical bytes" is satisfied by code that embeds
    today's DATE (identical across two runs seconds apart), by code that reads
    an environment variable (identical within one process), and by code that
    depends on `os.listdir` order (identical back-to-back on one filesystem).
    The spec's first draft pinned only that weakest property, two boxes before
    it lectured its own checklist about pinning limits by content rather than
    by non-emptiness.

    `datetime.fromisoformat` is fine and is the point: PARSING a recorded
    timestamp is reading the evidence. Calling `now()` is inventing one."""
    import ast

    source = Path(health.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)

    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    for forbidden in ("os", "random", "time", "socket", "urllib", "requests"):
        assert forbidden not in imported, (
            f"{forbidden} reached wringer/health.py — the report must be a "
            "function of the bundles and the config, and of nothing else"
        )

    # And the clock calls, by name, wherever they were reached from.
    banned = {"now", "today", "utcnow", "monotonic", "getenv", "urandom"}
    called = {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }
    assert not (called & banned), (
        f"the report path calls {sorted(called & banned)} — a report that "
        "varied run to run over identical evidence would be adding something "
        "that is not evidence"
    )


# --- the report and the tooth (SPEC_HEALTH_V0.md §4/§5, slice H3) ----------

import subprocess  # noqa: E402

from wringer import cli  # noqa: E402

CONFIG = """\
version: 1
gates:
  - id: test
    run: "pytest -q"
"""


def repo_with(tmp_path: Path, config: str = CONFIG) -> Path:
    """A real git repo, because `wring health` finds its root the same way
    every other command does."""
    subprocess.run(["git", "init", "-q", "."], cwd=tmp_path, check=True)
    (tmp_path / ".wringer.yaml").write_text(config, encoding="utf-8")
    return tmp_path


def test_the_coverage_statement_leads_the_human_report(tmp_path):
    """Before any verdict. What was read and what was not is the first thing
    on the page, because a health tool that skips quietly is the narrowing
    defect with a lens in its hand."""
    repo_with(tmp_path)
    plant(tmp_path, 3)
    bad = runs_dir(tmp_path) / "broken"
    bad.mkdir(parents=True)
    (bad / MANIFEST).write_text("not json", encoding="utf-8")

    coverage = health.discover(tmp_path)
    text = health.render(coverage, health.assess(coverage, declared()))

    first = text.splitlines()[0]
    assert first.startswith("searched "), first
    assert "read 3 bundles" in first, first
    assert "skipped 1" in first, first
    assert any("skipped: " in line and "broken" in line
               for line in text.splitlines()), text


def test_the_four_limits_are_pinned_by_content_not_by_length(tmp_path):
    """The narrowing lesson applied to this command's own output.

    A `limits` array checked for non-emptiness passes against a single entry
    reading "none". The fourth is the one a reader of a vitality report most
    needs and least wants: a sensitive row proves the gate's result changed
    with the tree, not that the change was honest."""
    repo_with(tmp_path)
    plant(tmp_path, 2)
    coverage = health.discover(tmp_path)
    assessed = health.assess(coverage, declared())

    emitted = health.as_json(coverage, assessed)
    text = health.render(coverage, assessed)

    assert len(health.LIMITS) == 4, health.LIMITS
    for limit in health.LIMITS:
        assert limit in emitted["limits"], f"--json drops: {limit}"
    joined = " ".join(text.split())
    for limit in health.LIMITS:
        assert " ".join(limit.split()) in joined, f"the report drops: {limit}"

    blind_spot = [x for x in health.LIMITS if "honest" in x]
    assert blind_spot, "the vacuity blind spot is not among the limits"
    assert "5a" in blind_spot[0], "the blind-spot limit does not cite its source"


def test_every_report_line_fits_a_terminal(tmp_path):
    """The sibling report in `bench` printed its limits at 115 columns for a
    whole slice, because it indented first and asked a helper to reflow a line
    that helper treats as structure. Not twice."""
    repo_with(tmp_path)
    plant(tmp_path, 12)
    coverage = health.discover(tmp_path)

    text = health.render(coverage, health.assess(coverage, declared()))

    too_wide = [line for line in text.splitlines() if len(line) > 80]
    assert not too_wide, too_wide


def test_strict_exits_one_for_a_required_zombie_and_zero_otherwise(
    tmp_path, monkeypatch, capsys
):
    """The only tooth, and it only tightens. Without `--strict` the same tree
    exits 0 — health is an observer, and an instrument that exited non-zero
    after successfully measuring decay would be reporting its own state with
    the patient's chart."""
    repo_with(tmp_path)
    plant(tmp_path, health.MIN_HISTORY)
    monkeypatch.chdir(tmp_path)

    assert cli.main(["health"]) == cli.EXIT_OK
    capsys.readouterr()

    assert cli.main(["health", "--strict"]) == cli.EXIT_GATE_FAILED
    said = capsys.readouterr()
    assert "test" in said.err, said.err


def test_strict_ignores_an_optional_zombie(tmp_path, monkeypatch, capsys):
    """Optional gates get verdicts and never decide outcomes — the contract
    has always been that. Requiredness is read from the CONFIG and never from
    the recorded `optional` flag, which is mutable across a pair's history and
    can hold both values inside one window."""
    repo_with(
        tmp_path,
        'version: 1\ngates:\n  - id: test\n    run: "pytest -q"\n'
        "    optional: true\n",
    )
    plant(tmp_path, health.MIN_HISTORY)
    monkeypatch.chdir(tmp_path)

    assert cli.main(["health", "--strict"]) == cli.EXIT_OK
    capsys.readouterr()


def test_strict_ignores_a_retired_zombie(tmp_path, monkeypatch, capsys):
    """A pair the config no longer declares cannot be required BY that config,
    and it carries no verdict at all. Two routes to the same answer."""
    repo_with(tmp_path, 'version: 1\ngates:\n  - id: other\n    run: "true"\n')
    plant(tmp_path, health.MIN_HISTORY)
    monkeypatch.chdir(tmp_path)

    assert cli.main(["health", "--strict"]) == cli.EXIT_OK
    capsys.readouterr()


def test_the_zombie_remedy_is_honest_about_optional_gates(tmp_path):
    """The draft printed one remedy beside every zombie and claimed it settles
    the question in one run. Vacuity has FOUR verdicts, `gates_vacuous` is
    whole-set, and optional gates are never proved at ALL — a binding non-goal
    — so beside an optional zombie that line would be directing a reader to
    run a command that cannot change the verdict it sits next to."""
    repo_with(tmp_path)
    plant(tmp_path, health.MIN_HISTORY, optional=True)
    coverage = health.discover(tmp_path)

    text = health.render(coverage, health.assess(coverage, declared()))

    assert health.OPTIONAL_REMEDY.split("(")[0].strip() in text, text
    assert "wring verify --prove" not in text.split("What this does not say")[0]


def test_output_writes_the_same_bytes_it_printed(tmp_path, monkeypatch, capsys):
    """`--output` writes the output the OTHER flags selected — the JSON object
    under `--json`, the human report otherwise. One rule, not two formats.

    It exists because the shell spellings that would otherwise be needed
    (`> file`, `| tee`) cannot appear in the Action recipe: the recipe guard
    parses every `wring` line with the real parser, and a redirect lands in
    argv as an unrecognised argument."""
    repo_with(tmp_path)
    plant(tmp_path, 3)
    monkeypatch.chdir(tmp_path)
    out = tmp_path / "health.json"

    assert cli.main(["health", "--json", "--output", str(out)]) == cli.EXIT_OK
    printed = capsys.readouterr().out

    written = out.read_text(encoding="utf-8")
    assert json.loads(written) == json.loads(printed)
    assert json.loads(written)["schema_version"] == health.REPORT_SCHEMA_VERSION


def test_health_runs_outside_a_repository_with_from(tmp_path, monkeypatch, capsys):
    """`--from`'s stated purpose is CI artifact restores and other checkouts,
    and a CI scratch directory is normally not a git checkout. The draft
    exited 2 for "not a repo" in the same sentence that said health does not
    need the tree."""
    artifacts = tmp_path / "artifacts"
    write_run(artifacts / "r1", "r1", [{"gate_id": "t", "command": "c"}])
    outside = tmp_path / "nowhere"
    outside.mkdir()
    monkeypatch.chdir(outside)

    assert cli.main(["health", "--from", str(artifacts)]) == cli.EXIT_OK
    assert "read 1 bundle " in capsys.readouterr().out


def test_health_with_no_repo_and_no_from_says_what_it_wanted(
    tmp_path, monkeypatch, capsys
):
    outside = tmp_path / "nowhere"
    outside.mkdir()
    monkeypatch.chdir(outside)

    assert cli.main(["health"]) == cli.EXIT_CONFIG
    assert "--from" in capsys.readouterr().err


def test_two_runs_over_the_same_bundles_emit_identical_bytes(
    tmp_path, monkeypatch, capsys
):
    """Ruling 4's weakest property, pinned anyway — the structural test beside
    it is what makes the claim real."""
    repo_with(tmp_path)
    plant(tmp_path, 12)
    monkeypatch.chdir(tmp_path)

    cli.main(["health", "--json"])
    first = capsys.readouterr().out
    cli.main(["health", "--json"])
    second = capsys.readouterr().out

    assert first == second


def test_the_bytes_do_not_move_when_the_environment_does(
    tmp_path, monkeypatch, capsys
):
    """The property "two runs produce identical bytes" cannot see: run twice
    seconds apart in one process environment and an env-dependent report is
    perfectly stable."""
    repo_with(tmp_path)
    plant(tmp_path, 12)
    monkeypatch.chdir(tmp_path)

    cli.main(["health", "--json"])
    first = capsys.readouterr().out

    monkeypatch.setenv("WRINGER_TEST_NOISE", "loud")
    monkeypatch.setenv("TZ", "Pacific/Kiritimati")
    monkeypatch.setenv("COLUMNS", "40")
    cli.main(["health", "--json"])
    second = capsys.readouterr().out

    assert first == second


# --- 127 is an environment answer, not a verdict (SPEC_ACCEPT ruling 7) -----
#
# Found by dogfooding on 2026-08-09: `wring graph run` was driven with the
# repo's own gates and a naked PATH, so `ruff` was not on it. The gate died
# in 0.0s with exit 127 and recorded `status: failed` — indistinguishable, in
# every downstream reader, from a lint failure that meant something. The loop
# then briefed a worker to fix a phantom, twice, and burned its iterations.
#
# For health the consequence is worse than noise: a missing binary would read
# as evidence that the gate CAN fail, which is the one thing health exists to
# establish. And SPEC_ACCEPT_V0 §3 clause 2 makes that receipt load-bearing
# for acceptance, so a repo could evidence a criterion with a typo in a path.


def test_a_missing_binary_is_not_a_genuine_failure(tmp_path):
    """127 is the shell saying it never found the command. Nothing ran, so
    nothing discriminated — and a row that proves only that PATH was wrong
    must not be usable as proof that a gate can fail."""
    write_run(
        runs_dir(tmp_path) / "a",
        "a",
        [{"gate_id": "lint", "command": "ruff check", "status": "failed",
          "exit_code": 127}],
    )
    coverage = health.discover(tmp_path)
    row = health.gate_runs(coverage.read[0])[0]

    assert row.exit_code == 127, "the reader dropped the exit code"
    assert row.status == "failed"
    assert not row.timed_out
    assert not row.genuine_failure, (
        "a missing binary counted as evidence the gate can fail"
    )


def test_an_ordinary_failure_is_still_a_genuine_failure(tmp_path):
    """The other direction, so the exclusion cannot quietly widen into
    'nothing counts' — the narrowing shape this repo keeps finding."""
    write_run(
        runs_dir(tmp_path) / "a",
        "a",
        [{"gate_id": "lint", "command": "ruff check", "status": "failed",
          "exit_code": 1}],
    )
    row = health.gate_runs(health.discover(tmp_path).read[0])[0]
    assert row.genuine_failure


def test_a_gate_that_only_ever_died_of_a_missing_binary_is_not_alive(tmp_path):
    """End to end through the verdict, because `genuine_failure` alone is a
    property nobody reads: twelve runs, every one a 127, and the gate must
    read `zombie` — it has never been shown to discriminate anything."""
    for index in range(12):
        write_run(
            runs_dir(tmp_path) / f"r{index:02d}",
            f"r{index:02d}",
            [{"gate_id": "lint", "command": "ruff check", "status": "failed",
              "exit_code": 127}],
            started_at=f"2026-08-01T10:{index:02d}:00+01:00",
        )
    assessed = health.assess(
        health.discover(tmp_path), declared={("lint", "ruff check")}
    )
    assert assessed[0].verdict == health.ZOMBIE, assessed[0].verdict
