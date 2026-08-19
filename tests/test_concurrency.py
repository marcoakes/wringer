"""Safe gate parallelism — docs/specs/SPEC_PERF_V0.md.

The gates here really run at once, and the proof is a file each writes: two gates
that both see the other's marker were genuinely overlapping, which is a fact about
the clock rather than about a config key.

**What this file is really guarding is a NUMBER.** `duration_ms` is not private to
a run — `wring health` compares it across a window and flags drift past 2×. A
contended wall clock is a real measurement of a different quantity, so the tests
below check that it is recorded, excluded from the comparison, and that the
exclusion is counted rather than silent.
"""

from __future__ import annotations

import json
from pathlib import Path

from conftest import flat

from wringer import cli, concurrency, evidence, health, verify

# Each gate drops its own marker and then waits for the OTHER's. Exit 0 means it
# saw it — which can only happen if both were in flight. Run serially, the first
# gate waits out its loop for a file the second has not created yet and exits 1.
# So "these gates overlapped" is a fact about the clock rather than a config key.
_WAIT_FOR_THE_OTHER = (
    "touch {mark}/{mine}; "
    "for i in 1 2 3 4 5 6 7 8 9 10; do "
    "[ -f {mark}/{theirs} ] && exit 0; sleep 0.2; done; exit 1"
)


def concurrent_config(mark: Path) -> str:
    first = _WAIT_FOR_THE_OTHER.format(mark=mark, mine="first", theirs="second")
    second = _WAIT_FOR_THE_OTHER.format(mark=mark, mine="second", theirs="first")
    return (
        "version: 1\ngates:\n"
        f'  - id: first\n    concurrent: true\n    run: "{first}"\n'
        f'  - id: second\n    concurrent: true\n    run: "{second}"\n'
    )


SERIAL = """\
version: 1
gates:
  - id: first
    run: "true"
  - id: second
    run: "true"
"""


def only_bundle(root: Path) -> Path:
    runs = sorted((root / evidence.RUNS_DIRNAME).iterdir())
    assert len(runs) == 1, runs
    return runs[0]


def recorded(bundle: Path) -> dict:
    return json.loads(
        (bundle / concurrency.CONCURRENCY_FILENAME).read_text(encoding="utf-8")
    )


# --- the compatibility boundary ---------------------------------------------


def test_a_repo_that_declared_nothing_runs_serially_and_records_nothing(
    repo, write_config, monkeypatch, capsys
):
    """Serial is the default, and the bundle gains no file for a feature nobody
    turned on."""
    write_config(repo, SERIAL)
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()
    bundle = only_bundle(repo)

    assert not (bundle / concurrency.CONCURRENCY_FILENAME).exists()
    # and the drift facts are computed over every run, because none was contended
    assert health._drift(()).contended == 0


def test_a_group_of_one_builds_no_pool(repo, write_config, monkeypatch, capsys):
    """Not an optimisation: it is what keeps a repo that declared no concurrency
    behaving exactly as it did, live console output included."""
    write_config(repo, SERIAL)
    monkeypatch.chdir(repo)

    import concurrent.futures

    def refuse(*_a, **_kw):  # pragma: no cover - must never be reached
        raise AssertionError("a serial verify built a thread pool")

    monkeypatch.setattr(concurrent.futures, "ThreadPoolExecutor", refuse)

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()


# --- the gates really overlap -----------------------------------------------


def test_declared_gates_really_run_at_the_same_time(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """**Proven by the clock, not by a config key.**

    Each gate waits for the other's marker and exits 0 only if it sees it. Run
    serially, the first gate waits two seconds for a file the second has not
    created yet and exits 1. Both passing means both were in flight.
    """
    mark = tmp_path / "marks"
    mark.mkdir()
    write_config(repo, concurrent_config(mark))
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_OK, "the gates did not overlap"
    capsys.readouterr()


def test_serial_tightens_and_the_same_config_then_fails(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """`--serial` collapses every group, and the proof is that the same config
    that passed above now cannot: neither gate ever sees the other's marker.

    That is the flag doing something real, and it only ever tightens — there is
    no flag that widens, because a `--jobs N` would let an operator overlap gates
    the repository never declared safe to overlap.
    """
    mark = tmp_path / "marks"
    mark.mkdir()
    write_config(repo, concurrent_config(mark))
    monkeypatch.chdir(repo)

    assert cli.main(["verify", "--serial"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    assert not (only_bundle(repo) / concurrency.CONCURRENCY_FILENAME).exists(), (
        "a serial run recorded concurrency it did not have"
    )


# --- the record -------------------------------------------------------------


def test_the_bundle_says_which_gates_ran_beside_which(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """"This gate was concurrent" is not actionable on its own: a reader looking
    at an inflated duration wants to know what it was competing with."""
    mark = tmp_path / "marks"
    mark.mkdir()
    write_config(repo, concurrent_config(mark))
    monkeypatch.chdir(repo)

    cli.main(["verify"])
    capsys.readouterr()
    payload = recorded(only_bundle(repo))

    assert payload["schema_version"] == "wringer.concurrency.v1"
    rows = {row["gate_id"]: row for row in payload["gates"]}
    assert set(rows) == {"first", "second"}
    assert rows["first"]["beside"] == ["second"]
    assert rows["second"]["beside"] == ["first"]
    assert rows["first"]["group"] == rows["second"]["group"] == 1


def test_the_ledger_chain_holds_after_a_concurrent_run(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """**The reason no event is emitted from a worker thread.**

    `Bundle.event` computes `prev_hash` from the ledger's last line and then
    appends. Two threads there would break the chain that is the bundle's whole
    tamper-evidence — silently, and in a way `wring audit` would later report as
    tampering on an honest run.
    """
    mark = tmp_path / "marks"
    mark.mkdir()
    write_config(repo, concurrent_config(mark))
    monkeypatch.chdir(repo)

    cli.main(["verify"])
    capsys.readouterr()
    bundle = only_bundle(repo)

    from wringer import attest

    # raises `Refused` on the first broken link
    attest.check_chain(bundle / evidence.EVIDENCE_FILENAME, "run")

    # ...and the events are in DECLARED order, whatever order they finished in
    events = [
        json.loads(line)
        for line in (bundle / evidence.EVIDENCE_FILENAME)
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    finished = [e["gate_id"] for e in events if e["type"] == "gate.finished"]
    assert finished == ["first", "second"]


def test_both_gates_leave_their_own_evidence(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """Concurrency changes a duration, never a directory: each gate still writes
    its own numbered directory with its own logs and result."""
    mark = tmp_path / "marks"
    mark.mkdir()
    write_config(repo, concurrent_config(mark))
    monkeypatch.chdir(repo)

    cli.main(["verify"])
    capsys.readouterr()
    bundle = only_bundle(repo)

    for name in ("001_first", "002_second"):
        for leaf in ("result.json", "stdout.log", "stderr.log"):
            assert (bundle / "gates" / name / leaf).is_file(), f"{name}/{leaf}"


# --- what it costs: the number health must not compare ----------------------


def test_a_contended_duration_is_excluded_from_the_drift_trend():
    """SPEED_PLAN R1's first option, taken.

    Two gates at once inflate each other's wall clock by an amount nobody
    recorded. Comparing a contended duration to a solitary one reports the
    INSTRUMENT moving as the gate slowing — so contended rows are excluded from
    the ratio, and the exclusion is counted.
    """
    def row(number: int, *, ms: int, contended: bool) -> health.GateRun:
        return health.GateRun(
            gate_id="a", command="true", status="passed", timed_out=False,
            optional=False, duration_ms=ms, truncated=False,
            receipt=f"r{number:03d}", started_at="", bench_sourced=False,
            concurrent=contended,
        )

    # ten solitary runs at 10ms, then two contended ones at 900ms. Included, the
    # newest-five median would scream drift; excluded, there is none.
    window = tuple(
        [row(n, ms=10, contended=False) for n in range(10)]
        + [row(n, ms=900, contended=True) for n in (10, 11)]
    )
    drift = health._drift(window)

    assert drift.contended == 2
    assert drift.slowest_ratio == 1.0, drift
    assert not drift.slow


def test_the_report_names_the_excluded_runs_rather_than_dropping_them(tmp_path):
    """A duration comparison that quietly dropped runs would be the narrowing
    check this command exists to hunt."""
    from test_health import declared, plant, repo_with, runs_dir, write_run

    repo_with(tmp_path)
    plant(tmp_path, 10)
    write_run(
        runs_dir(tmp_path) / "r900",
        "r900",
        [{"gate_id": "test", "command": "pytest -q", "duration_ms": 900}],
        started_at="2026-08-01T09:00:00+00:00",
    )
    (runs_dir(tmp_path) / "r900" / "concurrency.json").write_text(
        json.dumps({
            "schema_version": "wringer.concurrency.v1",
            "gates": [{"gate_id": "test", "group": 1, "beside": ["lint"]}],
        }),
        encoding="utf-8",
    )
    coverage = health.discover(tmp_path)
    assessed = health.assess(coverage, declared())

    assert assessed[0].drift.contended == 1
    text = flat(health.render(coverage, assessed))
    assert "1 ran concurrently, excluded from the duration trend" in text


def test_reading_a_broken_concurrency_record_yields_nothing(tmp_path: Path):
    """Total by construction, like `vacuity.read_verdict`. The failure mode of
    guessing here is a real duration compared against a contended one."""
    for body in (
        "not json",
        "[]",
        '{"schema_version": "wringer.concurrency.v9", "gates": []}',
        '{"schema_version": "wringer.concurrency.v1", "gates": "nope"}',
    ):
        (tmp_path / concurrency.CONCURRENCY_FILENAME).write_text(body, "utf-8")
        assert concurrency.read_ids(tmp_path) == frozenset()


def test_an_empty_record_writes_no_file(tmp_path: Path):
    assert concurrency.write(tmp_path, []) is None
    assert not (tmp_path / concurrency.CONCURRENCY_FILENAME).exists()


# --- the stop contract, at group granularity --------------------------------


def test_every_gate_in_a_group_runs_before_the_stop_is_decided(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """SPEED_PLAN R2, answered with the loop's own precedent — SPEC_SUPERVISION
    S1 stops AFTER finishing the step in flight.

    Within a group there is no early exit: the gates are already running, so
    "stop at the first required failure" cannot mean serially what it means here.
    Both gates leave evidence even though the first one failed.
    """
    mark = tmp_path / "marks"
    mark.mkdir()
    write_config(
        repo,
        "version: 1\ngates:\n"
        "  - id: first\n    concurrent: true\n    run: 'exit 1'\n"
        f"  - id: second\n    concurrent: true\n    run: 'touch {mark}/ran'\n"
        "  - id: later\n    run: 'true'\n",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    bundle = only_bundle(repo)

    assert (mark / "ran").exists(), "the group's second gate never ran"
    assert (bundle / "gates" / "002_second" / "result.json").is_file()
    # ...and the contract still holds at GROUP granularity: the later group is
    # skipped, and the summary says so
    assert not (bundle / "gates" / "003_later").exists()
    text = (bundle / evidence.SUMMARY_FILENAME).read_text(encoding="utf-8")
    assert "| later | skipped |" in text


def test_a_failure_inside_a_group_still_names_one_failed_gate(
    repo, write_config, monkeypatch, capsys
):
    """The manifest names the first required failure in declared order, so two
    gates failing at once does not make the bundle ambiguous."""
    write_config(
        repo,
        "version: 1\ngates:\n"
        "  - id: first\n    concurrent: true\n    run: 'exit 1'\n"
        "  - id: second\n    concurrent: true\n    run: 'exit 1'\n",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    manifest = json.loads(
        (only_bundle(repo) / evidence.MANIFEST_FILENAME).read_text("utf-8")
    )
    assert manifest["result"]["failed_gate"] == "first"


def test_an_optional_failure_in_a_group_does_not_stop_the_run(
    repo, write_config, monkeypatch, capsys
):
    write_config(
        repo,
        "version: 1\ngates:\n"
        "  - id: first\n    concurrent: true\n    optional: true\n    run: 'exit 1'\n"
        "  - id: second\n    concurrent: true\n    run: 'true'\n"
        "  - id: later\n    run: 'true'\n",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()
    assert (only_bundle(repo) / "gates" / "003_later" / "result.json").is_file()


# --- the config surface -----------------------------------------------------


def test_concurrent_defaults_to_false_and_must_be_a_boolean():
    import pytest

    from wringer import config as config_module

    assert not config_module.parse(
        {"version": 1, "gates": [{"id": "a", "run": "true"}]}
    ).gates[0].concurrent

    with pytest.raises(config_module.ConfigError) as caught:
        config_module.parse(
            {"version": 1, "gates": [{"id": "a", "run": "true", "concurrent": "yes"}]}
        )
    assert "'concurrent' must be a boolean" in str(caught.value)


def test_group_gates_is_a_pure_function_of_the_declaration():
    """Asserted directly, because every property above depends on it and a
    grouping bug would look like a concurrency bug."""
    from wringer import config as config_module

    def gate(name: str, concurrent: bool) -> config_module.Gate:
        return config_module.Gate(id=name, run="true", concurrent=concurrent)

    planned = [
        (1, gate("a", True)),
        (2, gate("b", False)),
        (3, gate("c", True)),
        (4, gate("d", True)),
        (5, gate("e", False)),
    ]
    assert [
        [g.id for _, g in group] for group in verify.group_gates(planned)
    ] == [["a"], ["b"], ["c", "d"], ["e"]]
    # a lone concurrent gate is a group of one, which is the serial path
    assert verify.group_gates([(1, gate("a", True))]) == [[(1, planned[0][1])]]
