"""Flaky gates — SPEC_STABILITY_V0.md.

Every gate here is a real shell command in a real subprocess, and the
alternating one really alternates: it counts its own invocations in a file and
flips on the parity. Nothing is mocked, because a classifier tested against a
fake gate would be a classifier tested against the thing it is supposed to
observe.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wringer import cli, config, evidence, loop, stability, summary

# Counts its own invocations and flips on the parity: attempt 1 passes,
# attempt 2 fails, attempt 3 passes. The counter lives OUTSIDE the repo so a
# test's gate never changes the tree it is verifying.
ALTERNATING = (
    "n=$(cat {counter} 2>/dev/null || echo 0); n=$((n+1)); "
    "printf %s $n > {counter}; [ $((n % 2)) -eq 1 ]"
)


def alternating_config(
    counter: Path, attempts: int = 3, require_consistent: bool | None = None
) -> str:
    tolerance = (
        ""
        if require_consistent is None
        else f"      require_consistent: {str(require_consistent).lower()}\n"
    )
    return (
        "version: 1\n"
        "gates:\n"
        "  - id: coin\n"
        f'    run: "{ALTERNATING.format(counter=counter)}"\n'
        "    stability:\n"
        f"      attempts: {attempts}\n"
        f"{tolerance}"
    )


def only_bundle(root: Path) -> Path:
    runs = sorted((root / evidence.RUNS_DIRNAME).iterdir())
    assert len(runs) == 1, runs
    return runs[0]


def recorded(bundle: Path) -> dict:
    return json.loads(
        (bundle / stability.STABILITY_FILENAME).read_text(encoding="utf-8")
    )


def row(bundle: Path, gate_id: str = "coin") -> dict:
    return next(r for r in recorded(bundle)["gates"] if r["gate_id"] == gate_id)


def result_of(bundle: Path, directory: str) -> dict:
    return json.loads((bundle / directory / "result.json").read_text("utf-8"))


# --- the compatibility boundary ---------------------------------------------


def test_a_repo_with_no_stability_key_writes_the_bundle_it_wrote_yesterday(
    repo, write_config, monkeypatch, capsys
):
    """**The first test, because it is the promise everything else rests on.**

    A gate that declares no `stability:` runs once, writes exactly where it
    always did, and produces no stability record at all. Asserted as the exact
    SET of files in the bundle rather than as "no stability.json", so an
    `attempts/` directory or a stray sibling appearing later fails here too.

    **`execution.json` joined this set deliberately, and it is the one addition
    that is allowed to.** SPEC_EXEC_V0 §3: every other sibling is conditional,
    because a reader who does not find one learns nothing either way, and this
    one is unconditional because a reader who is not told where a command ran
    supplies the flattering answer. Anything else appearing here should fail
    this test until somebody argues for it in a spec.
    """
    write_config(repo, "version: 1\ngates:\n  - id: unit\n    run: 'true'\n")
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()
    bundle = only_bundle(repo)

    written = sorted(
        path.relative_to(bundle).as_posix()
        for path in bundle.rglob("*")
        if path.is_file()
    )
    assert written == [
        "diff.patch",
        "digests.json",
        "evidence.jsonl",
        "execution.json",
        "gates/001_unit/result.json",
        "gates/001_unit/stderr.log",
        "gates/001_unit/stdout.log",
        "manifest.json",
        "status.txt",
        "summary.md",
        "untracked.json",
    ]
    assert not (bundle / stability.STABILITY_FILENAME).exists()
    assert "Stability" not in (bundle / summary.SUMMARY_FILENAME).read_text("utf-8")


# --- classification, from observations only ---------------------------------


def test_an_alternating_gate_is_classified_flaky(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """The headline. Pass, fail, pass on one tree is `flaky` — and the run
    does not pass, because `require_consistent` defaults to true."""
    write_config(repo, alternating_config(tmp_path / "n"))
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    found = row(only_bundle(repo))
    assert found["classification"] == stability.FLAKY
    assert [a["status"] for a in found["attempts"]] == ["passed", "failed", "passed"]
    assert found["verdict"] == "failed"
    assert found["tolerated"] is False


def test_a_gate_that_always_fails_is_stable_fail_and_is_routed_to_repair(
    repo, write_config, monkeypatch, capsys
):
    write_config(
        repo,
        "version: 1\ngates:\n  - id: broken\n    run: 'exit 3'\n"
        "    stability:\n      attempts: 3\n",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    found = row(only_bundle(repo), "broken")
    assert found["classification"] == stability.STABLE_FAIL
    assert found["routing"] == stability.REPAIR
    assert [a["exit_code"] for a in found["attempts"]] == [3, 3, 3]


def test_a_gate_that_always_passes_is_stable_pass(
    repo, write_config, monkeypatch, capsys
):
    write_config(
        repo,
        "version: 1\ngates:\n  - id: unit\n    run: 'true'\n"
        "    stability:\n      attempts: 3\n",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    found = row(only_bundle(repo), "unit")
    assert found["classification"] == stability.STABLE_PASS
    assert found["routing"] == stability.NOTHING_TO_REPAIR
    assert found["attempts_run"] == 3


def test_no_gate_output_can_change_the_classification(
    repo, write_config, monkeypatch, capsys
):
    """**The law: classification reads observations, never text.**

    This gate shouts every word a text-reading classifier would look for and
    exits 0 three times. It is `stable_pass`, because a classifier a gate can
    talk to is a classifier the supervised party controls.
    """
    write_config(
        repo,
        "version: 1\ngates:\n  - id: loud\n"
        "    run: \"echo 'FLAKY: intermittent failure, retrying (attempt 2/3)'; "
        "echo 'FAILED' >&2; exit 0\"\n"
        "    stability:\n      attempts: 3\n",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    assert row(only_bundle(repo), "loud")["classification"] == stability.STABLE_PASS


def test_every_attempt_runs_even_after_the_answer_looks_settled(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """Stopping at the first failure would make `stable_fail` and `flaky`
    indistinguishable; stopping at the first pass would be retry-until-green
    with a record attached. The counter file is the witness."""
    counter = tmp_path / "n"
    write_config(repo, alternating_config(counter, attempts=4))
    monkeypatch.chdir(repo)

    cli.main(["verify"])
    capsys.readouterr()

    assert counter.read_text() == "4"
    assert row(only_bundle(repo))["attempts_run"] == 4


# --- every attempt on disk --------------------------------------------------


def test_every_attempt_has_its_own_directory_result_and_logs(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """Never hide a retry. A gate run three times that leaves one result is
    exactly what a hidden flake looks like."""
    write_config(repo, alternating_config(tmp_path / "n"))
    monkeypatch.chdir(repo)

    cli.main(["verify"])
    capsys.readouterr()
    bundle = only_bundle(repo)

    for number in (1, 2, 3):
        directory = bundle / "gates" / "001_coin" / "attempts" / f"{number:03d}"
        assert (directory / "result.json").is_file(), directory
        assert (directory / "stdout.log").is_file()
        assert (directory / "stderr.log").is_file()

    # and the record points at each of them, by the path a reader would type
    found = row(bundle)
    assert [a["result"] for a in found["attempts"]] == [
        "gates/001_coin/attempts/001/result.json",
        "gates/001_coin/attempts/002/result.json",
        "gates/001_coin/attempts/003/result.json",
    ]
    assert found["attempts_requested"] == 3


def test_the_canonical_result_never_contradicts_the_run(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """`gates/NNN_<id>/result.json` holds the DECIDING attempt, not the first.

    The alternating gate PASSES on attempt 1 and the run fails on it. If the
    canonical result were attempt 1's, the bundle would say `passed` on the
    same screen its manifest names the gate as the failure — the
    self-contradicting bundle `_clear_previous` exists to prevent, arriving
    through a different door.
    """
    write_config(repo, alternating_config(tmp_path / "n"))
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    bundle = only_bundle(repo)

    manifest = json.loads((bundle / evidence.MANIFEST_FILENAME).read_text("utf-8"))
    assert manifest["result"]["failed_gate"] == "coin"
    assert result_of(bundle, "gates/001_coin")["status"] == "failed"
    # attempt 1 is still on disk saying what it really did
    assert result_of(bundle, "gates/001_coin/attempts/001")["status"] == "passed"
    assert row(bundle)["deciding_attempt"] == 2


def test_the_deciding_attempts_logs_are_the_ones_at_the_canonical_path(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """The copy is of the whole attempt, not only its verdict — or the brief
    a worker gets quotes a passing run's output beside a failure."""
    write_config(
        repo,
        "version: 1\ngates:\n  - id: coin\n"
        "    run: \"n=$(cat {c} 2>/dev/null || echo 0); n=$((n+1)); "
        "printf %s $n > {c}; if [ $((n % 2)) -eq 1 ]; then echo GREEN; else "
        'echo RED; exit 1; fi"\n'
        "    stability:\n      attempts: 3\n".format(c=tmp_path / "n"),
    )
    monkeypatch.chdir(repo)

    cli.main(["verify"])
    capsys.readouterr()
    bundle = only_bundle(repo)

    assert (bundle / "gates/001_coin/stdout.log").read_text("utf-8") == "RED\n"
    assert (
        bundle / "gates/001_coin/attempts/001/stdout.log"
    ).read_text("utf-8") == "GREEN\n"


def test_the_console_prints_one_line_per_attempt(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """A retry cannot be hidden from the terminal either. Three lines carrying
    the same gate id is the honest shape: something ran three times."""
    write_config(repo, alternating_config(tmp_path / "n"))
    monkeypatch.chdir(repo)

    cli.main(["verify"])
    out = capsys.readouterr().out

    assert out.count("coin passed") == 2
    assert out.count("coin failed") == 1


# --- what the run does with it ----------------------------------------------


def test_a_flaky_gate_is_not_repairable(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    write_config(repo, alternating_config(tmp_path / "n"))
    monkeypatch.chdir(repo)

    cli.main(["verify"])
    capsys.readouterr()

    found = row(only_bundle(repo))
    assert found["routing"] == stability.NO_REPAIR
    assert "not handed to a worker" in found["reason"]


def test_a_tolerated_mixture_passes_the_run_and_is_still_not_repairable(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """`require_consistent: false` buys the tick and nothing else. The
    classification is still `flaky` — it comes from the observations — and the
    routing is still `no_repair`, because tolerating a coin flip never makes
    the nondeterminism a thing a worker can fix."""
    write_config(
        repo, alternating_config(tmp_path / "n", require_consistent=False)
    )
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()
    bundle = only_bundle(repo)

    found = row(bundle)
    assert found["classification"] == stability.FLAKY
    assert (found["tolerated"], found["verdict"], found["routing"]) == (
        True,
        "passed",
        stability.NO_REPAIR,
    )
    assert result_of(bundle, "gates/001_coin")["status"] == "passed"


def test_an_optional_flaky_gate_leaves_the_run_passing_and_still_records_it(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """An optional gate never stops a run, so this record is the only place
    its nondeterminism is visible at all."""
    write_config(
        repo,
        alternating_config(tmp_path / "n").replace(
            "    stability:", "    optional: true\n    stability:"
        ),
    )
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    found = row(only_bundle(repo))
    assert (found["optional"], found["classification"]) == (True, stability.FLAKY)


def test_a_gate_skipped_after_a_required_failure_leaves_no_stability_row(
    repo, write_config, monkeypatch, capsys
):
    """Non-evidence is not evidence: it did not run, so it says nothing."""
    write_config(
        repo,
        "version: 1\ngates:\n"
        "  - id: first\n    run: 'exit 1'\n"
        "  - id: later\n    run: 'true'\n"
        "    stability:\n      attempts: 2\n",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    # no gate that ran declared a policy, so there is no file at all
    assert not (only_bundle(repo) / stability.STABILITY_FILENAME).exists()


# --- unknown ----------------------------------------------------------------


def test_an_interrupt_between_attempts_records_unknown(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """`unknown` has exactly one door: a Ctrl-C before the declared attempts
    are done. The attempts that finished are on disk and in the record, the
    classification refuses to call two passes `stable_pass`, and the run
    itself is `interrupted` — so `unknown` never decides a pass or a fail.
    """
    from wringer import gates as gates_module

    write_config(
        repo,
        "version: 1\ngates:\n  - id: unit\n    run: 'true'\n"
        "    stability:\n      attempts: 3\n",
    )
    monkeypatch.chdir(repo)

    real = gates_module.run
    calls = {"n": 0}

    def interrupt_on_the_third(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 3:
            raise KeyboardInterrupt
        return real(*args, **kwargs)

    monkeypatch.setattr(gates_module, "run", interrupt_on_the_third)

    assert cli.main(["verify"]) == cli.EXIT_INTERRUPTED
    capsys.readouterr()
    bundle = only_bundle(repo)

    found = row(bundle, "unit")
    assert found["classification"] == stability.UNKNOWN
    assert (found["attempts_requested"], found["attempts_run"]) == (3, 2)
    assert found["verdict"] == "unresolved"
    assert found["deciding_attempt"] is None
    assert found["routing"] == stability.REPAIR
    assert "treated as stable_fail" in found["reason"]
    # the two that finished are still there, in full
    assert [a["status"] for a in found["attempts"]] == ["passed", "passed"]
    assert not (bundle / "gates/001_unit/result.json").exists()


def test_classify_checks_the_count_before_the_statuses():
    """A gate asked for three draws and giving two has been shown nothing,
    however those two came back — or an interrupt could manufacture the
    verdict the third attempt was there to buy."""
    assert stability.classify(3, ("passed", "passed")) == stability.UNKNOWN
    assert stability.classify(3, ("failed", "failed")) == stability.UNKNOWN
    assert stability.classify(2, ("passed", "passed")) == stability.STABLE_PASS


# --- the summary ------------------------------------------------------------


def test_the_summary_names_the_flake_in_the_table_and_in_its_own_section(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """The table is the part of the document that looks like proof, so one
    word goes there too — a reader must not act on the row before reaching
    the section."""
    write_config(repo, alternating_config(tmp_path / "n"))
    monkeypatch.chdir(repo)

    cli.main(["verify"])
    capsys.readouterr()

    text = (only_bundle(repo) / summary.SUMMARY_FILENAME).read_text("utf-8")
    assert "| coin | failed (flaky) |" in text
    assert "## Stability" in text
    assert "did not give the same answer twice" in text
    assert "attempt 2: failed" in text


def test_the_summary_marks_a_tolerated_mixture_too(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """The worse of the two under-reports: without this the row reads a plain
    `passed` while the record says the result was a coin flip."""
    write_config(
        repo, alternating_config(tmp_path / "n", require_consistent=False)
    )
    monkeypatch.chdir(repo)

    cli.main(["verify"])
    capsys.readouterr()

    text = (only_bundle(repo) / summary.SUMMARY_FILENAME).read_text("utf-8")
    assert "| coin | passed (flaky, tolerated) |" in text


def test_a_stable_pass_still_gets_a_stability_section(
    repo, write_config, monkeypatch, capsys
):
    """There is nothing to warn about and the reader still gets to see that
    three runs bought the tick — the count is the anti-hidden-retry
    guarantee, and it does not only apply to bad news."""
    write_config(
        repo,
        "version: 1\ngates:\n  - id: unit\n    run: 'true'\n"
        "    stability:\n      attempts: 3\n",
    )
    monkeypatch.chdir(repo)

    cli.main(["verify"])
    capsys.readouterr()

    text = (only_bundle(repo) / summary.SUMMARY_FILENAME).read_text("utf-8")
    assert "## Stability" in text
    assert "| unit | 3 | 3 | ✓ ✓ ✓ | **stable_pass** |" in text


# --- the loop ---------------------------------------------------------------


def test_the_loop_never_hands_a_flaky_gate_to_the_worker(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """**The defect this whole slice exists to prevent.**

    A nondeterministic gate looks exactly like a failing one, so without this
    the loop briefs an agent, the agent edits source that was never wrong, and
    the next draw comes up green and calls it a fix. The worker here would
    leave a file if it ran; the assertion is that it does not exist.
    """
    marker = tmp_path / "the-worker-ran"
    write_config(
        repo,
        alternating_config(tmp_path / "n")
        + f"run:\n  worker: \"touch {marker}\"\n  max_iterations: 3\n",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    out = capsys.readouterr().out

    assert not marker.exists(), "a flaky gate was handed to the worker to fix"
    assert "flaky" in out

    recorded_loop = json.loads(
        (
            loop.latest_loop(repo / loop.LOOPS_DIRNAME) / loop.MANIFEST_FILENAME
        ).read_text("utf-8")
    )
    assert recorded_loop["result"]["reason"] == loop.FLAKY_GATE
    assert recorded_loop["result"]["iterations"] == 1


def test_the_loop_still_repairs_a_gate_that_really_is_broken(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    """The other half, or the test above passes for a loop that never briefs
    anybody. Same config shape, a gate that fails consistently, and the
    worker's fix converges."""
    write_config(
        repo,
        "version: 1\ngates:\n  - id: unit\n    run: 'test -f fixed'\n"
        "    stability:\n      attempts: 2\n"
        'run:\n  worker: "touch fixed"\n  max_iterations: 3\n',
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()
    assert (repo / "fixed").is_file()


def test_the_loop_records_the_flaky_gate_by_name(
    repo, write_config, monkeypatch, capsys, tmp_path
):
    write_config(
        repo,
        alternating_config(tmp_path / "n")
        + 'run:\n  worker: "true"\n  max_iterations: 3\n',
    )
    monkeypatch.chdir(repo)

    cli.main(["run"])
    capsys.readouterr()

    events = loop.read_events(loop.latest_loop(repo / loop.LOOPS_DIRNAME))
    finished = next(e for e in events if e["type"] == "loop.finished")
    assert finished["reason"] == loop.FLAKY_GATE
    text = (
        loop.latest_loop(repo / loop.LOOPS_DIRNAME) / loop.SUMMARY_FILENAME
    ).read_text("utf-8")
    assert "coin" in text
    assert "nondeterministic" in text


# --- the record read back --------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        "not json at all",
        "[]",
        '{"schema_version": "wringer.stability.v9", "gates": []}',
        '{"schema_version": "wringer.stability.v1", "gates": "nope"}',
    ],
)
def test_reading_a_broken_record_yields_no_rows_rather_than_an_exception(
    tmp_path: Path, body: str
):
    """Total, like `vacuity.read_verdict`. `wring health` reads bundles it did
    not write, including ones written by a future version."""
    (tmp_path / stability.STABILITY_FILENAME).write_text(body, encoding="utf-8")
    assert stability.read_report(tmp_path) == ()


def test_reading_a_missing_record_yields_no_rows(tmp_path: Path):
    assert stability.read_report(tmp_path) == ()


def test_an_empty_report_writes_no_file(tmp_path: Path):
    """A reader must never have to tell an empty record from a missing one."""
    assert stability.write(tmp_path, stability.Report(), lambda p: str(p)) is None
    assert not (tmp_path / stability.STABILITY_FILENAME).exists()


def test_the_observed_report_is_addressable_by_gate_id():
    gate = config.Gate(
        id="unit", run="true", stability=config.Stability(attempts=1)
    )
    report = stability.Report(
        gates=(stability.Observed(gate=gate, requested=1, results=()),)
    )
    assert report.of("unit") is not None
    assert report.of("nothing") is None
