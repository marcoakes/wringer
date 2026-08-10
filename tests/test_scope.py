"""F4 at scale — the scoped loop and the scoped fleet (SPEC_SCOPE_V0.md).

Scripted workers throughout, like `test_run.py`: the contract under test is
what the harness SAYS and what it records, never what an agent is clever
enough to do.

The cycle's one-sentence test — *can the harness's own scoping ever make a
green tick claim more than it measured?* — is pinned here as executable
assertions rather than as prose.
"""

from __future__ import annotations

import json
from pathlib import Path

from conftest import flat

from wringer import cli, config, loop, verify

# Two gates, and the one this task does NOT own is declared FIRST. That
# ordering is the test: `verify.run` stops at the first required failure, so
# an unscoped run fails on `theirs` and briefs the worker about it. Scoping
# must make `theirs` unrepresentable — not merely later in the list.
TWO_GATES = """\
version: 1
gates:
  - id: theirs
    run: "grep -q FIXED other.py"
  - id: mine
    run: "grep -q FIXED calc.py"
run:
  worker: {worker}
  max_iterations: {max_iterations}
"""

# Writes only the file this task owns. The other gate stays red forever.
FIXES_MINE = "printf 'FIXED\\n' > calc.py"


def write_two_gate_config(
    repo: Path, worker: str = FIXES_MINE, max_iterations: int = 3
) -> None:
    (repo / ".wringer.yaml").write_text(
        TWO_GATES.format(worker=json.dumps(worker), max_iterations=max_iterations),
        encoding="utf-8",
    )
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / "other.py").write_text("BROKEN\n", encoding="utf-8")


def only_loop(repo: Path) -> Path:
    loops = sorted((repo / loop.LOOPS_DIRNAME).iterdir())
    assert len(loops) == 1, loops
    return loops[0]


def briefs(loop_dir: Path) -> list[str]:
    """Every brief this loop handed a worker, in iteration order."""
    return [
        path.read_text(encoding="utf-8")
        for path in sorted(loop_dir.glob(f"iterations/*/{loop.BRIEF_FILENAME}"))
    ]


def final_run(repo: Path, loop_dir: Path) -> Path:
    manifest = json.loads(
        (loop_dir / loop.MANIFEST_FILENAME).read_text(encoding="utf-8")
    )
    return repo / manifest["result"]["final_run"]


# -------------------------------------------------------------- S1: the flag


def test_wring_run_gate_is_repeatable_and_scopes_the_loop(repo, monkeypatch, capsys):
    """The flag as a human at a terminal meets it. The fleet is the intended
    caller, and it makes the same narrower claim in both mouths."""
    write_two_gate_config(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["run", "--gate", "mine"]) == cli.EXIT_OK

    bundle = final_run(repo, only_loop(repo))
    assert sorted(p.name for p in (bundle / "gates").iterdir()) == ["002_mine"]


def test_an_unknown_scoped_gate_stops_the_run_before_any_work(
    repo, monkeypatch, capsys
):
    """Config errors cost nothing when they fire first. A typo'd `--gate`
    must not spawn a worker and then discover the gate does not exist."""
    write_two_gate_config(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["run", "--gate", "mine", "--gate", "nope"]) == cli.EXIT_CONFIG

    assert "no gate 'nope'" in flat(capsys.readouterr().err)
    # Nothing ran: no loop directory at all.
    assert not (repo / loop.LOOPS_DIRNAME).exists()


# ---------------------------------------------------------------- S1: the loop


def test_the_loop_converges_on_its_scoped_gates_while_another_stays_red(repo):
    """THE decisive test (spec DONE box 1, plan S1).

    Two gates, scope to one, and make the OTHER fail. The loop must converge
    on what it was asked to prove, and the brief must never name the gate
    this task does not own — the measured pathology was the harness telling
    an agent to go and fix another task's work, in a shared tree, four at a
    time.
    """
    write_two_gate_config(repo)
    cfg = config.load(repo / ".wringer.yaml")

    outcome = loop.run(repo, cfg, gates=["mine"])

    assert outcome.status == "converged", outcome.reason
    # `other.py` is still BROKEN — the gate this task does not own is red and
    # stayed red, and the loop converged anyway.
    assert "FIXED" not in (repo / "other.py").read_text(encoding="utf-8")

    handed = briefs(only_loop(repo))
    assert handed, "the loop converged without ever briefing a worker"
    for text in handed:
        assert "theirs" not in flat(text), text


def test_a_scoped_out_gate_leaves_no_result_row(repo):
    """Absence is the record, and it is the record that already refuses.

    Not "recorded as skipped": post-failure skips leave no `gates/` directory
    either (spec §6, measured), and acceptance reads that absence as
    `gate-did-not-run`. A scoped-out gate must be indistinguishable from a
    gate that was never asked for, because that is what it is.
    """
    write_two_gate_config(repo)
    cfg = config.load(repo / ".wringer.yaml")

    loop.run(repo, cfg, gates=["mine"])

    bundle = final_run(repo, only_loop(repo))
    ran = sorted(path.name for path in (bundle / "gates").iterdir())
    assert ran == ["002_mine"], ran
    # The declared position survives narrowing (`plan`'s existing promise):
    # evidence lands where a full run would have put it.


def test_the_summary_names_every_scoped_out_gate_and_the_scope_that_excluded_it(repo):
    """Spec DONE box 2, content-pinned.

    Human-readable at the run level, machine-readable at the fleet level,
    absence at the result level — three records, one truth. This is the first.
    """
    write_two_gate_config(repo)
    cfg = config.load(repo / ".wringer.yaml")

    loop.run(repo, cfg, gates=["mine"])

    text = flat((final_run(repo, only_loop(repo)) / "summary.md").read_text("utf-8"))
    assert "## Scoped out" in text
    assert "`theirs`" in text
    # The scope that excluded it, named — a reader must not have to guess
    # whether the gate was skipped, broken, or never asked for.
    assert "this run was scoped to `mine`" in text


def test_an_unscoped_run_says_nothing_about_scope(repo):
    """No `--gate`, no new behaviour. The section is absent rather than
    empty: every repo that never opted in writes the summary it always did."""
    write_two_gate_config(repo, worker="printf 'FIXED\\n' > calc.py other.py")
    cfg = config.load(repo / ".wringer.yaml")

    loop.run(repo, cfg)

    text = (final_run(repo, only_loop(repo)) / "summary.md").read_text("utf-8")
    assert "Scoped out" not in text


def test_scoping_to_an_unknown_gate_is_refused_naming_the_declared_set(repo):
    """`plan` already refused an unknown single `--gate`; the repeatable form
    must refuse the same way rather than silently scoping to nothing."""
    write_two_gate_config(repo)
    cfg = config.load(repo / ".wringer.yaml")

    try:
        verify.plan(cfg, ["mine", "nope"])
    except config.ConfigError as exc:
        message = flat(str(exc))
        # The UNKNOWN id by name, not the whole requested list stringified:
        # a reader must be told which of the ids they typed does not exist.
        assert "no gate 'nope'" in message
        assert "theirs" in message and "mine" in message
    else:
        raise AssertionError("an unknown gate id was accepted")


def test_the_briefs_criteria_list_marks_which_criteria_this_task_owns(repo):
    """Ruling 3: the criteria list marks ownership.

    The join is ruling 1's read backwards — this task's criteria are the ones
    whose bound gate is in the scoped set. A worker that cannot tell its own
    objectives from the fleet's is the F3 defect one level up.
    """
    (repo / ".wringer.yaml").write_text(
        """\
version: 1
gates:
  - id: theirs
    run: "grep -q FIXED other.py"
    proves: c-other
  - id: mine
    run: "grep -q FIXED calc.py"
    proves: c-mine
run:
  worker: "printf 'FIXED\\n' > calc.py"
  max_iterations: 3
""",
        encoding="utf-8",
    )
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / "other.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / "wringer.spec.yaml").write_text(
        """\
schema_version: wringer.spec.v1
title: Two tasks, one tree
intent: A spec with more than one owner.
approved: true
criteria:
  - id: c-other
    title: the other task's criterion
  - id: c-mine
    title: this task's criterion
tasks:
  - id: t-mine
    brief: briefs/t-mine.md
    dir: .
    objective: fix calc.py
""",
        encoding="utf-8",
    )
    (repo / "briefs").mkdir()
    (repo / "briefs" / "t-mine.md").write_text("Make calc.py say FIXED.\n", "utf-8")
    cfg = config.load(repo / ".wringer.yaml")

    loop.run(repo, cfg, gates=["mine"])

    text = flat(briefs(only_loop(repo))[0])
    # Its own criterion is marked as this task's; the other is present and
    # marked as somebody else's. Neither is hidden — a worker that cannot see
    # the whole spec cannot tell when its change breaks a neighbour.
    assert "`c-mine` — this task's criterion — bound to `mine` — THIS TASK" in text
    assert "`c-other` — the other task's criterion — bound to `theirs` — " \
        "another task's" in text
