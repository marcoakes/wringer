"""The staleness rider — `WRINGER_RULING_2026-08-14` Phase 1, sliced 2026-08-15.

`deliver.py` wrote `spec_sha256` at three sites and compared it at NONE, and
`spec.authorising_sha256` hashes the spec *as it is now* — so a delivery
manifest could say "authorised by spec S" where S was whatever sat on disk when
the delivery ran. `spec.py`'s own docstring named the gap.

Every test here is about one sentence, and it is `deliver.py`'s standing ruling
inherited verbatim: **invalidate after landing, never abort in flight, and
revert nothing.** The loop stops at an ITERATION BOUNDARY, the worker's turn
stands, the files it wrote stay written, and delivery refuses.

Workers are shell one-liners, as everywhere in this suite.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from core_helpers import flat

from wringer import cli, config, deliver, evidence, loop, staleness

# A gate that never passes, so the loop always takes a worker turn and always
# comes back for another. Convergence would end the loop before the boundary
# this file is about.
NEVER = """\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
run:
  worker: {worker}
  max_iterations: {max_iterations}
"""

SPEC = """\
schema_version: wringer.spec.v1
title: A thing
intent: |
  the PRD said this
approved: false
criteria: []
"""


def git(cwd: Path, *args: str) -> str:
    proc = subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@e.invalid",
         "-c", "commit.gpgsign=false", *args],
        cwd=cwd, capture_output=True, text=True, check=True,
    )
    return proc.stdout.strip()


def write_config(repo: Path, worker: str, max_iterations: int = 2) -> None:
    (repo / ".wringer.yaml").write_text(
        NEVER.format(worker=json.dumps(worker), max_iterations=max_iterations),
        encoding="utf-8",
    )


def only_loop(repo: Path) -> Path:
    loops = sorted((repo / loop.LOOPS_DIRNAME).iterdir())
    assert len(loops) == 1, loops
    return loops[0]


def manifest(loop_dir: Path) -> dict:
    return json.loads((loop_dir / loop.MANIFEST_FILENAME).read_text(encoding="utf-8"))


# --- capture ---------------------------------------------------------------


def test_a_loop_records_the_documents_that_authorised_it(repo, monkeypatch, capsys):
    """Before the first worker turn, and covered by the loop's own digests."""
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    write_config(repo, "true", max_iterations=1)
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    loop_dir = only_loop(repo)

    recorded = json.loads(
        (loop_dir / staleness.BRIEFED_FILENAME).read_text(encoding="utf-8")
    )
    assert recorded["schema_version"] == staleness.SCHEMA_VERSION
    documents = recorded["documents"]
    assert set(documents) == set(staleness.AUTHORITY_DOCUMENTS)
    assert documents["wringer.spec.yaml"] is not None
    assert documents[".wringer.yaml"] is not None
    # No rubric in this repo, and `null` is a value: it is what makes a rubric
    # APPEARING mid-loop a move rather than a silent nothing.
    assert documents["wringer.rubric.yaml"] is None

    digests = json.loads(
        (loop_dir / evidence.DIGESTS_FILENAME).read_text(encoding="utf-8")
    )
    assert staleness.BRIEFED_FILENAME in digests["files"], (
        "briefed.json must be written before digests.json, or the loop's own "
        "tamper-evidence does not cover the brief it is comparing against"
    )


def test_a_repo_with_no_spec_records_the_absence_and_delivers_as_before(
    repo, monkeypatch, capsys
):
    """The compatibility boundary is the absence of the documents, not of the
    feature: a repo that has no spec and no rubric is unaffected."""
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    write_config(repo, "true", max_iterations=1)
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    recorded = staleness.read(only_loop(repo))
    assert recorded == {
        "wringer.spec.yaml": None,
        "wringer.rubric.yaml": None,
        ".wringer.yaml": recorded[".wringer.yaml"],
    }
    assert not staleness.moved(recorded, staleness.capture(repo))


# --- the iteration boundary ------------------------------------------------


def test_a_spec_that_moves_mid_loop_stops_at_the_boundary_and_reverts_nothing(
    repo, monkeypatch, capsys
):
    """The rider's first half, and the ruling it inherits.

    The worker does two things in one turn: it writes a file (work that
    LANDS) and it edits the approved spec. The loop must let the turn finish,
    then decline to start another — never kill the worker mid-flight, and
    never undo what it wrote.
    """
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    write_config(
        repo,
        "printf 'the worker was here\\n' > landed.txt; "
        "printf 'title: something else\\n' >> wringer.spec.yaml",
        max_iterations=3,
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    out = flat(capsys.readouterr().out)

    result = manifest(only_loop(repo))["result"]
    assert result["reason"] == staleness.AUTHORITY_MOVED, result
    # ONE iteration: the turn that moved the spec ran to completion, and the
    # loop declined to spend the next one.
    assert result["iterations"] == 1, result
    assert "moved after the loop was briefed" in out
    assert "nothing was reverted" in out.lower()

    # Nothing reverted, stated as three facts rather than one.
    assert (repo / "landed.txt").read_text(encoding="utf-8") == "the worker was here\n"
    assert "something else" in (repo / "wringer.spec.yaml").read_text(encoding="utf-8")
    assert (repo / "calc.py").read_text(encoding="utf-8") == "BROKEN\n"


def test_the_worker_turn_completes_before_the_check_runs(repo, monkeypatch, capsys):
    """"Never abort in flight" is a claim about ORDER, so it is checked on the
    order: the ledger holds a `worker.finished` for the turn that moved the
    spec, not a `worker.started` with nothing after it."""
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    write_config(repo, "printf 'x\\n' >> wringer.spec.yaml", max_iterations=3)
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    loop_dir = only_loop(repo)

    kinds = [
        json.loads(line)["type"]
        for line in (loop_dir / loop.EVENTS_FILENAME)
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    assert kinds.count("worker.started") == kinds.count("worker.finished") == 1
    assert kinds.index("worker.finished") < kinds.index("loop.finished")


def test_the_console_names_the_new_reason_in_all_three_tables():
    """The hand-kept-table lesson, applied to the table this slice grows."""
    from wringer import graph

    assert staleness.AUTHORITY_MOVED in loop._REASONS
    assert staleness.AUTHORITY_MOVED in cli._LOOP_ENDINGS
    assert staleness.AUTHORITY_MOVED in graph.LOOP_REASONS


# --- delivery --------------------------------------------------------------


CONFIG_WITH_REMOTE = """\
version: 1
gates:
  - id: test
    run: "true"
run:
  worker: {worker}
  max_iterations: 2
deliver:
  branch: wringer/{{run}}
  base: main
  remote: origin
"""


@pytest.fixture
def loop_repo(repo: Path) -> Path:
    """A repo with a `file://` origin, an approved spec, and a change to ship."""
    upstream = repo.parent / f"{repo.name}-upstream.git"
    git(repo, "init", "--bare", "-b", "main", str(upstream))
    git(repo, "remote", "add", "origin", f"file://{upstream}")
    (repo / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    (repo / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (repo / ".wringer.yaml").write_text(
        CONFIG_WITH_REMOTE.format(worker=json.dumps("true")), encoding="utf-8"
    )
    git(repo, "add", "-A")
    git(repo, "commit", "-m", "config")
    git(repo, "push", "-u", "origin", "main")
    (repo / "feature.py").write_text("def added():\n    return 1\n", encoding="utf-8")
    return repo


def test_deliver_refuses_when_an_authorising_document_moved_after_the_loop(
    loop_repo, monkeypatch, capsys
):
    """**The rider's stop condition.** The delivery-time half.

    The loop converged, the gates are green and the change is real. Then the
    approved spec moved. There is no longer anything here that evidences what
    was asked for, because what was asked for is not what was asked for.
    """
    monkeypatch.chdir(loop_repo)
    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()

    (loop_repo / "wringer.spec.yaml").write_text(
        SPEC + "notes: edited after the work\n", encoding="utf-8"
    )

    assert cli.main(["deliver"]) == cli.EXIT_GATE_FAILED
    err = flat(capsys.readouterr().err)
    assert "the work is stale" in err
    assert "wringer.spec.yaml changed" in err
    assert "nothing has been reverted" in err
    # The refusal must not tell anyone to undo work: `deliver.py`'s standing
    # ruling against auto-reversal binds the ADVICE too.
    assert "revert" not in err.replace("nothing has been reverted", "")
    assert not (loop_repo / ".wringer" / "deliveries").exists(), (
        "a refused delivery wrote a delivery bundle"
    )
    # And nothing was reverted, which is the whole ruling.
    assert (loop_repo / "feature.py").is_file()
    assert "edited after the work" in (
        loop_repo / "wringer.spec.yaml"
    ).read_text("utf-8")


def test_the_staleness_refusal_comes_BEFORE_the_tree_refusal(
    loop_repo, monkeypatch, capsys
):
    """Order, and it is load-bearing.

    An authorising document that git tracks moves the tree too, so
    `check_verified_tree` would also refuse — with *"the working tree has
    moved"*, which sends the reader to `wring verify` and produces a fresh run
    that ships the stale work. "What authorised this is not what authorised
    this" is the more precise diagnosis of the same symptom, so it is checked
    first. Same reasoning as `no_progress` before `oscillating` in the loop.
    """
    monkeypatch.chdir(loop_repo)
    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()
    (loop_repo / "wringer.spec.yaml").write_text(SPEC + "y: 2\n", encoding="utf-8")

    assert cli.main(["deliver"]) == cli.EXIT_GATE_FAILED
    err = flat(capsys.readouterr().err)
    assert "the work is stale" in err
    assert "the working tree has moved" not in err


def test_deliver_ships_when_nothing_moved(loop_repo, monkeypatch, capsys):
    """The other direction, or the test above proves only that deliver refuses."""
    monkeypatch.chdir(loop_repo)
    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()

    assert cli.main(["deliver"]) == cli.EXIT_OK
    out = capsys.readouterr().out
    assert "wringer/" in out


def test_a_run_no_loop_produced_records_no_brief_and_is_never_compared(
    loop_repo, monkeypatch, capsys
):
    """The compatibility boundary. `wring verify` writes no brief, so the join
    finds no loop and the check returns having compared nothing — which is
    every repo that has never run a loop, and every loop bundle written before
    this file existed."""
    monkeypatch.chdir(loop_repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    run_dir = evidence.latest_run(loop_repo / evidence.RUNS_DIRNAME)
    assert run_dir is not None
    relative = run_dir.relative_to(loop_repo).as_posix()
    assert staleness.loop_for_run(loop_repo, relative) is None

    assert cli.main(["deliver"]) == cli.EXIT_OK
    assert "wringer/" in capsys.readouterr().out


# --- the comparison itself -------------------------------------------------


def test_a_document_that_appears_is_a_move_and_one_that_vanishes_is_too():
    """`null` is a value. A spec that did not exist when the work was briefed
    and exists now did not authorise it."""
    briefed = {"wringer.spec.yaml": None, ".wringer.yaml": "a" * 64}

    assert staleness.moved(briefed, {"wringer.spec.yaml": "b" * 64,
                                     ".wringer.yaml": "a" * 64}) == (
        "wringer.spec.yaml",
    )
    assert staleness.moved({"wringer.spec.yaml": "a" * 64},
                           {"wringer.spec.yaml": None}) == ("wringer.spec.yaml",)
    assert staleness.moved(briefed, dict(briefed)) == ()


def test_a_capture_that_names_fewer_documents_claims_nothing_about_the_rest():
    """Forward compatibility, in the direction that matters: a brief written
    by an older version is a statement about what it recorded, never a claim
    that everything else was absent. Read the other way, every old loop
    bundle would refuse the moment a fourth document was added."""
    old = {"wringer.spec.yaml": "a" * 64}
    now = {"wringer.spec.yaml": "a" * 64, "wringer.rubric.yaml": "c" * 64,
           ".wringer.yaml": "d" * 64}

    assert staleness.moved(old, now) == ()


def test_an_unreadable_brief_is_not_an_accusation(tmp_path: Path):
    """A damaged capture is not evidence that something moved. `vacuity`'s
    rule: refusing on an unreadable byte turns an instrument fault into a
    verdict about the work."""
    (tmp_path / staleness.BRIEFED_FILENAME).write_text("{ not json", encoding="utf-8")

    assert staleness.read(tmp_path) is None
    assert staleness.read(tmp_path / "nothing-here") is None


def test_the_join_from_a_run_to_its_loop_is_exact(loop_repo, monkeypatch, capsys):
    """Both sides speak repo-relative posix already; if they ever stop, this
    is where a silent no-op would begin — the check would find no loop and
    pass everything."""
    monkeypatch.chdir(loop_repo)
    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()

    final_run = manifest(only_loop(loop_repo))["result"]["final_run"]
    found = staleness.loop_for_run(loop_repo, final_run)
    assert found is not None, f"no loop claims {final_run!r}"
    assert found[0] == only_loop(loop_repo)

    assert staleness.loop_for_run(loop_repo, ".wringer/runs/not-a-run") is None


def test_deliver_refuses_over_a_moved_gate_config_too(loop_repo, monkeypatch, capsys):
    """Three documents authorise the work, not one. `.wringer.yaml` is what
    'verified' means, so editing it after the evidence was produced changes
    what the green tick was about."""
    monkeypatch.chdir(loop_repo)
    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()

    path = loop_repo / ".wringer.yaml"
    path.write_text(path.read_text(encoding="utf-8") + "\n# edited\n", encoding="utf-8")

    assert cli.main(["deliver"]) == cli.EXIT_GATE_FAILED
    assert ".wringer.yaml changed" in flat(capsys.readouterr().err)


def test_the_refusal_carries_the_exit_code_that_means_the_evidence(loop_repo,
                                                                   monkeypatch,
                                                                   capsys):
    """1, not 2 and not 3. The benchmark's rule 2 turns on this: exit 2 is the
    machine and exit 3 is an unsafe tree, and a harness that could not tell
    them apart would score a refusal Wringer never made about the work."""
    monkeypatch.chdir(loop_repo)
    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()
    (loop_repo / "wringer.spec.yaml").write_text(SPEC + "x: 1\n", encoding="utf-8")

    cfg = config.load(loop_repo / ".wringer.yaml")
    run_dir = evidence.latest_run(loop_repo / evidence.RUNS_DIRNAME)
    assert run_dir is not None
    with pytest.raises(deliver.Refused) as caught:
        deliver.plan(loop_repo, cfg, run_dir, run_dir.name)
    assert caught.value.exit_code == cli.EXIT_GATE_FAILED
    assert "the work is stale" in str(caught.value)
