"""`wring plan` — the approved spec becomes work (docs/specs/SPEC_INTENT_V0.md §4).

`wring plan` runs nothing. It reads a file a human approved, writes the task
file, the briefs and the rubric, prints the gate change it would like someone
to make, and stops. Everything here is about what it refuses.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from core_helpers import flat

from wringer import cli, config, fleet, rubric, spec

CONFIG = """\
version: 1
gates:
  - id: check
    run: "true"
judge:
  endpoint: http://127.0.0.1:11434/v1/chat/completions
  model: cheap-model
  rubric: wringer.rubric.yaml
"""

SPEC = """\
schema_version: wringer.spec.v1
approved: true
title: Add CSV export to the reports page
intent: |2
  Our reports page needs a CSV export.
open_questions:
  - id: date-format
    question: Which date format should the export use?
    required: true
    answer: ISO-8601.
  - id: row-cap
    question: Is there a maximum row count?
    required: false
    answer: ''
criteria:
  - id: export-button-exists
    title: A CSV export button appears on the reports page
    guidance: A test asserts the button renders.
    required: true
    human: false
  - id: reads-well
    title: The column headings read the way a finance team expects
    required: true
    human: true
gates:
  - id: test
    run: pytest -q
tasks:
  - id: csv-export
    brief: briefs/csv-export.md
    dir: .
    objective: Add the export endpoint and the button that calls it.
"""


def setup_repo(repo: Path, spec_text: str = SPEC, config_text: str = CONFIG) -> None:
    (repo / config.CONFIG_FILENAME).write_text(config_text, encoding="utf-8")
    (repo / spec.SPEC_FILENAME).write_text(spec_text, encoding="utf-8")


def test_an_unapproved_spec_is_refused_and_changes_nothing(
    repo, monkeypatch, capsys
):
    setup_repo(repo, SPEC.replace("approved: true", "approved: false"))
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_GATE_FAILED

    err = flat(capsys.readouterr().err)
    assert "approved: false" in err
    assert "no --yes" in err
    # nothing was written, so nothing can be run
    assert not (repo / spec.TASKS_FILENAME).exists()
    assert not (repo / spec.RUBRIC_FILENAME).exists()
    assert not (repo / "briefs").exists()


def test_unanswered_required_questions_are_refused_and_listed(
    repo, monkeypatch, capsys
):
    setup_repo(repo, SPEC.replace("    answer: ISO-8601.\n", "    answer: ''\n"))
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_GATE_FAILED

    err = flat(capsys.readouterr().err)
    assert "date-format: Which date format" in err
    # the optional one is not held against the plan
    assert "row-cap" not in err
    assert not (repo / spec.TASKS_FILENAME).exists()


DECISIONS_V2 = """\
schema_version: wringer.decisions.v2
assumptions:
  - id: date-format
    decision: Dates are written ISO-8601.
    why: It sorts correctly in a spreadsheet.
    instead_of_asking: Which date format should the export use?
    criteria:
      - export-button-exists
"""


def test_PLAN_REFUSES_while_a_criterion_worded_under_an_overruled_decision_stands(
    repo, monkeypatch, capsys
):
    """**Field report 2026-08-21 finding 4, at the level the operator meets it.**

    The evaluator overruled an assumption, `revise` recorded it and withdrew
    the approval — and the criterion that assumption had shaped stayed in the
    spec and the rubric as the thing the work would be judged against. The
    repository held the correction and its contradiction side by side and
    warned about neither.

    `wring plan` now refuses, in the same shape as the unanswered-question
    refusal, and writes nothing.
    """
    setup_repo(repo)
    (repo / "wringer.decisions.yaml").write_text(DECISIONS_V2, encoding="utf-8")
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_GATE_FAILED

    err = flat(capsys.readouterr().err)
    assert "export-button-exists" in err
    assert "decided for you: Dates are written ISO-8601." in err
    assert "you said:" in err and "ISO-8601." in err
    # **Rendered, never resolved.** Wringer does not re-word a requirement:
    # choosing the words is the person's act, and a tool that rewrote one to
    # match an answer would be deciding what they meant.
    assert "will not re-word them for you" in err
    assert not (repo / spec.TASKS_FILENAME).exists(), (
        "a plan was written past a requirement that contradicts the person"
    )


def test_a_decision_nobody_overruled_does_not_hold_the_plan(
    repo, monkeypatch, capsys
):
    """The other direction, and it is the common case by far.

    An assumption still standing is one the person accepts by approving the
    plan. Every criterion it shaped is correctly worded, and a check that
    fired here would refuse every plan this product ever produces.
    """
    setup_repo(repo, SPEC.replace(
        "    question: Which date format should the export use?\n",
        "    question: Something nobody decided?\n",
    ))
    (repo / "wringer.decisions.yaml").write_text(DECISIONS_V2, encoding="utf-8")
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_OK
    capsys.readouterr()
    assert (repo / spec.TASKS_FILENAME).exists()


def test_a_deleted_question_counts_as_answered(repo, monkeypatch, capsys):
    trimmed = SPEC.split("open_questions:")[0] + "open_questions: []\n" + (
        "criteria:" + SPEC.split("criteria:", 1)[1]
    )
    setup_repo(repo, trimmed)
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_OK

    assert (repo / spec.TASKS_FILENAME).is_file()


def test_no_spec_file_is_a_config_error(repo, monkeypatch, capsys):
    (repo / config.CONFIG_FILENAME).write_text(CONFIG, encoding="utf-8")
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_CONFIG

    assert "wring spec" in capsys.readouterr().err


# --- what an approved spec produces --------------------------------------


def test_an_approved_spec_produces_tasks_the_fleet_accepts(
    repo, monkeypatch, capsys
):
    setup_repo(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_OK

    # the fleet's own loader is the contract, so it is what checks the file
    tasks = fleet.load_tasks(repo / spec.TASKS_FILENAME)
    assert [t.id for t in tasks] == ["csv-export"]
    assert tasks[0].brief == "briefs/csv-export.md"
    assert (repo / tasks[0].brief).is_file()


def test_the_criteria_block_is_a_rubric_the_judge_loads_unmodified(
    repo, monkeypatch, capsys
):
    """No translation layer: the judge's own loader reads what plan wrote."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    assert cli.main(["plan"]) == cli.EXIT_OK
    capsys.readouterr()

    loaded = rubric.load(Path(spec.RUBRIC_FILENAME), repo)
    assert loaded.title == "Add CSV export to the reports page"
    assert [c.id for c in loaded.criteria] == ["export-button-exists", "reads-well"]
    assert [c.human for c in loaded.criteria] == [False, True]


def test_the_brief_carries_the_criteria_and_the_answers(repo, monkeypatch, capsys):
    setup_repo(repo)
    monkeypatch.chdir(repo)
    assert cli.main(["plan"]) == cli.EXIT_OK
    capsys.readouterr()

    brief = (repo / "briefs" / "csv-export.md").read_text(encoding="utf-8")
    assert spec.BRIEF_MARKER in brief
    assert "Add the export endpoint" in brief
    assert "export-button-exists" in brief
    assert "a human scores this" in brief
    # a decision the PM already made travels with the work
    assert "ISO-8601." in brief
    # the PM's own words go with it, so the worker sees the source
    assert "Our reports page needs a CSV export." in brief


def test_gates_are_proposed_as_a_diff_and_never_installed(
    repo, monkeypatch, capsys
):
    setup_repo(repo)
    monkeypatch.chdir(repo)
    before = (repo / config.CONFIG_FILENAME).read_text(encoding="utf-8")

    assert cli.main(["plan"]) == cli.EXIT_OK

    out = capsys.readouterr().out
    assert "+  - id: test" in out
    assert "+    run: pytest -q" in out
    assert "does not install" in out
    # the config on disk is untouched, byte for byte
    assert (repo / config.CONFIG_FILENAME).read_text(encoding="utf-8") == before


def test_the_proposed_diff_applies_to_the_real_config(repo, monkeypatch, capsys):
    """A diff nobody can apply is a diff that proves nothing."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    assert cli.main(["plan", "--json"]) == cli.EXIT_OK
    diff = json.loads(capsys.readouterr().out)["gate_diff"]

    patched = repo / "patched"
    patched.mkdir()
    (patched / config.CONFIG_FILENAME).write_text(
        (repo / config.CONFIG_FILENAME).read_text(encoding="utf-8"), encoding="utf-8"
    )
    (repo / "gates.patch").write_text(diff, encoding="utf-8")
    import subprocess

    applied = subprocess.run(
        ["git", "apply", "--unsafe-paths", "--directory", "patched",
         str(repo / "gates.patch")],
        cwd=repo, capture_output=True, text=True,
    )
    assert applied.returncode == 0, applied.stderr

    updated = config.load(patched / config.CONFIG_FILENAME)
    assert [g.id for g in updated.gates] == ["check", "test"]
    assert updated.gates[1].run == "pytest -q"


def test_a_gate_the_config_already_declares_is_not_proposed_twice(
    repo, monkeypatch, capsys
):
    setup_repo(
        repo,
        config_text=CONFIG.replace(
            '  - id: check\n    run: "true"\n',
            '  - id: check\n    run: "true"\n  - id: test\n    run: "pytest"\n',
        ),
    )
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_OK

    out = capsys.readouterr().out
    assert "Already declared" in out
    assert "+  - id: test" not in out


def test_a_spec_with_no_gates_proposes_nothing(repo, monkeypatch, capsys):
    setup_repo(repo, SPEC.replace(
        "gates:\n  - id: test\n    run: pytest -q\n", "gates: []\n"
    ))
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_OK

    assert "is unchanged" in capsys.readouterr().out


def test_json_output_is_one_object(repo, monkeypatch, capsys):
    setup_repo(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["plan", "--json"]) == cli.EXIT_OK

    payload = json.loads(capsys.readouterr().out)
    assert payload["tasks"] == ["csv-export"]
    assert payload["briefs"] == ["briefs/csv-export.md"]
    assert payload["rubric"] == spec.RUBRIC_FILENAME
    assert payload["gates_proposed"] == ["test"]
    assert payload["gates_already_declared"] == []


# --- what it refuses to overwrite ----------------------------------------


def test_a_brief_path_over_a_real_file_is_refused(repo, monkeypatch, capsys):
    setup_repo(repo, SPEC.replace("briefs/csv-export.md", "README.md"))
    (repo / "README.md").write_text("# a real readme\n", encoding="utf-8")
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_CONFIG

    assert "would overwrite README.md" in capsys.readouterr().err
    assert (repo / "README.md").read_text(encoding="utf-8") == "# a real readme\n"
    # nothing else was written either — the checks all run before any write
    assert not (repo / spec.TASKS_FILENAME).exists()


def test_a_tasks_file_that_is_not_a_task_file_is_refused(repo, monkeypatch,
                                                         capsys):
    setup_repo(repo)
    (repo / spec.TASKS_FILENAME).write_text("my notes, actually\n", encoding="utf-8")
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_CONFIG

    assert "refusing to overwrite" in capsys.readouterr().err
    assert (repo / spec.TASKS_FILENAME).read_text("utf-8") == "my notes, actually\n"


def test_rerunning_plan_regenerates_its_own_files(repo, monkeypatch, capsys):
    setup_repo(repo)
    monkeypatch.chdir(repo)
    assert cli.main(["plan"]) == cli.EXIT_OK
    assert cli.main(["plan"]) == cli.EXIT_OK
    capsys.readouterr()

    assert len(fleet.load_tasks(repo / spec.TASKS_FILENAME)) == 1


def test_a_task_dir_that_does_not_exist_is_refused(repo, monkeypatch, capsys):
    setup_repo(repo, SPEC.replace("    dir: .\n", "    dir: services/api\n"))
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_CONFIG

    err = flat(capsys.readouterr().err)
    assert "does not exist" in err
    assert "fleet would park it" in err


def test_a_brief_that_escapes_the_repo_is_refused(repo, monkeypatch, capsys):
    setup_repo(repo, SPEC.replace("briefs/csv-export.md", "../escaped.md"))
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_CONFIG

    assert "escape the repository" in capsys.readouterr().err
    assert not (repo.parent / "escaped.md").exists()


def test_a_brief_reached_through_a_symlink_is_refused(repo, tmp_path_factory,
                                                      monkeypatch, capsys):
    """The string check cannot see a symlink; resolving the path can."""
    outside = tmp_path_factory.mktemp("outside")
    (repo / "briefs").symlink_to(outside, target_is_directory=True)
    setup_repo(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_CONFIG

    assert "outside the repository" in flat(capsys.readouterr().err)
    assert not (outside / "csv-export.md").exists()


# --- the whole PM loop ---------------------------------------------------


def test_the_planned_tasks_actually_run_under_the_fleet(repo, monkeypatch,
                                                        capsys):
    """The end of the loop: what `wring plan` writes, `wring fleet` runs."""
    setup_repo(
        repo,
        config_text="""\
version: 1
gates:
  - id: check
    run: "grep -q DONE work.txt"
run:
  worker: "echo DONE > work.txt"
  max_iterations: 2
fleet:
  deadline: 120
  concurrency: 1
""",
    )
    monkeypatch.chdir(repo)
    assert cli.main(["plan"]) == cli.EXIT_OK
    capsys.readouterr()

    assert cli.main(["fleet", spec.TASKS_FILENAME]) == cli.EXIT_OK

    out = capsys.readouterr().out
    assert "1 succeeded, 0 failed, 0 parked" in out
    assert (repo / "work.txt").read_text(encoding="utf-8").strip() == "DONE"


def test_the_rendered_rubric_is_valid_yaml_the_parser_agrees_with(repo):
    loaded = spec.parse(yaml.safe_load(SPEC), spec.SPEC_FILENAME)
    text = spec.render_rubric(loaded)

    spec.validate_rubric_text(text)

    assert yaml.safe_load(text)["schema_version"] == "wringer.rubric.v1"


def test_the_proposed_gates_land_inside_the_gate_list(repo, monkeypatch, capsys):
    """A config with a blank line between sections still reads as one after
    the diff is applied — the addition goes in the list, not on top of the
    next key."""
    setup_repo(
        repo,
        config_text='version: 1\ngates:\n  - id: check\n    run: "true"\n\n'
        "judge:\n  endpoint: http://127.0.0.1:11434/v1/chat/completions\n"
        "  model: cheap-model\n  rubric: wringer.rubric.yaml\n",
    )
    monkeypatch.chdir(repo)
    assert cli.main(["plan", "--json"]) == cli.EXIT_OK
    diff = json.loads(capsys.readouterr().out)["gate_diff"]

    # the separator survives: the line after the addition is still blank
    lines = diff.splitlines()
    added = max(i for i, line in enumerate(lines) if line.startswith("+"))
    assert not lines[added + 1].strip()

    import subprocess

    (repo / "gates.patch").write_text(diff, encoding="utf-8")
    applied = subprocess.run(
        ["git", "apply", str(repo / "gates.patch")],
        cwd=repo, capture_output=True, text=True,
    )
    assert applied.returncode == 0, applied.stderr
    parsed = config.load(repo / config.CONFIG_FILENAME)
    assert [g.id for g in parsed.gates] == ["check", "test"]
    # and the judge section it was written above is still readable
    assert parsed.judge is not None and parsed.judge.model == "cheap-model"


def test_a_flow_style_config_is_still_read_correctly(repo, monkeypatch, capsys):
    """A gate id the line scan would miss must not be proposed again — the
    human applying that diff would get a config their own loader rejects."""
    setup_repo(
        repo,
        config_text="version: 1\n"
        'gates: [{id: check, run: "true"}, {id: test, run: "pytest"}]\n'
        "judge:\n  endpoint: http://127.0.0.1:11434/v1/chat/completions\n"
        "  model: cheap-model\n  rubric: wringer.rubric.yaml\n",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["plan", "--json"]) == cli.EXIT_OK

    payload = json.loads(capsys.readouterr().out)
    assert payload["gates_proposed"] == []
    assert payload["gates_already_declared"] == ["test"]


def test_an_unparseable_config_still_gets_a_diff(repo, monkeypatch, capsys):
    """A broken .wringer.yaml is a reason to show the change, not to hide it."""
    setup_repo(repo)
    (repo / config.CONFIG_FILENAME).write_text(
        "version: 1\ngates:\n  - id: check\n    run: true\n  oops: [\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["plan", "--json"]) == cli.EXIT_OK

    payload = json.loads(capsys.readouterr().out)
    assert payload["gates_proposed"] == ["test"]
    assert "+  - id: test" in payload["gate_diff"]


# --- what an adversarial review found (2026-08-01) -----------------------


def test_a_flow_style_config_gets_words_not_a_destructive_diff(
    repo, monkeypatch, capsys
):
    """THE one that would have cost someone their gates. The old code, unable
    to find a block-style `gates:` line, appended a SECOND `gates:` key — and
    YAML keeps the last, so the 'purely additive' diff deleted every gate the
    repo already declared, after a human read it and approved it."""
    setup_repo(
        repo,
        config_text="version: 1\n"
        'gates: [{id: check, run: "true"}]\n'
        "judge:\n  endpoint: http://127.0.0.1:11434/v1/chat/completions\n"
        "  model: cheap-model\n  rubric: wringer.rubric.yaml\n",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["plan", "--json"]) == cli.EXIT_OK
    payload = json.loads(capsys.readouterr().out)

    assert payload["gates_proposed"] == ["test"]
    # no diff at all, rather than one that lies about being additive
    assert payload["gate_diff"] == ""

    assert cli.main(["plan"]) == cli.EXIT_OK
    out = capsys.readouterr().out
    assert "as text rather than a diff" in out
    assert "delete the gates you already have" in out
    assert "- id: test" in out
    # and whatever happens, the config is untouched
    assert config.load(repo / config.CONFIG_FILENAME).gates[0].id == "check"


@pytest.mark.parametrize(
    "config_text",
    [
        pytest.param(CONFIG, id="a-diff"),
        pytest.param(
            CONFIG.replace(
                '  - id: check\n    run: "true"\n',
                '  - id: check\n    run: "true"\n  - id: test\n    run: "pytest"\n',
            ),
            id="already-declared",
        ),
        pytest.param(
            "version: 1\n"
            'gates: [{id: check, run: "true"}]\n'
            "judge:\n  endpoint: http://127.0.0.1:11434/v1/chat/completions\n"
            "  model: cheap-model\n  rubric: wringer.rubric.yaml\n",
            id="words-not-a-diff",
        ),
    ],
)
def test_the_gate_proposal_a_person_must_read_fits_a_terminal(
    repo, monkeypatch, capsys, config_text
):
    """Every paragraph of this report is prose and all three were printed
    raw — 128 columns for three proposed gates, more for the flow-style
    explanation. That is `wring deliver`'s 402-column vacuity line
    (tests/test_cli.py) and the graph's 142-column one
    (tests/test_graph_deliver.py) a third time, and here it lands on the one
    sentence that tells a reader Wringer will NOT install these for them.

    Asserted as a property and never on where a line broke: the formatter has
    its own tests, and pinning a break point here would test the formatter.
    """
    setup_repo(repo, config_text=config_text)
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_OK

    printed = capsys.readouterr().out
    over = [line for line in printed.splitlines() if len(line) > 80]
    assert not over, f"{len(over)} line(s) run past any terminal: {over}"
    # And the reflow must not have eaten the message. What each branch SAYS
    # has its own three tests above; this only guards against wrapping
    # swallowing the paragraph that names the gate.
    said = flat(printed)
    assert "Proposed gates (test)" in said or "Already declared" in said


def test_two_tasks_may_not_share_a_brief(repo, monkeypatch, capsys):
    """One file, two tasks: the second write wins, the fleet dispatches both
    tasks against it, and one objective is simply gone."""
    setup_repo(
        repo,
        SPEC.rstrip()
        + "\n  - id: csv-export-ui\n    brief: briefs/csv-export.md\n"
        "    dir: .\n    objective: Add the button.\n",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_CONFIG

    err = flat(capsys.readouterr().err)
    assert "names the same brief" in err
    assert not (repo / spec.TASKS_FILENAME).exists()


def test_a_hand_written_rubric_is_never_overwritten(repo, monkeypatch, capsys):
    """`judge.rubric:` has pointed at a file since v0.2, so a repo adopting
    `wring spec` may already have one — and it is the document that decides
    whether the work is accepted."""
    setup_repo(repo)
    theirs = (
        "schema_version: wringer.rubric.v1\ntitle: Ours, written by hand\n"
        "criteria:\n  - id: careful\n    title: We wrote this\n    required: true\n"
    )
    (repo / spec.RUBRIC_FILENAME).write_text(theirs, encoding="utf-8")
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_CONFIG

    assert "did not write it" in capsys.readouterr().err
    assert (repo / spec.RUBRIC_FILENAME).read_text(encoding="utf-8") == theirs
    assert not (repo / spec.TASKS_FILENAME).exists()


def test_a_rubric_plan_wrote_is_regenerated(repo, monkeypatch, capsys):
    setup_repo(repo)
    monkeypatch.chdir(repo)
    assert cli.main(["plan"]) == cli.EXIT_OK
    assert cli.main(["plan"]) == cli.EXIT_OK
    capsys.readouterr()

    text = (repo / spec.RUBRIC_FILENAME).read_text(encoding="utf-8")
    assert spec.RUBRIC_MARKER in text
    # the marker is a YAML comment, so the judge's loader is unmoved by it
    assert rubric.load(Path(spec.RUBRIC_FILENAME), repo).title == (
        "Add CSV export to the reports page"
    )


def test_a_symlinked_rubric_cannot_reach_outside_the_repo(
    repo, tmp_path_factory, monkeypatch, capsys
):
    outside = tmp_path_factory.mktemp("outside") / "theirs.yaml"
    outside.write_text("not ours\n", encoding="utf-8")
    setup_repo(repo)
    (repo / spec.RUBRIC_FILENAME).symlink_to(outside)
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_CONFIG

    assert "outside the repository" in flat(capsys.readouterr().err)
    assert outside.read_text(encoding="utf-8") == "not ours\n"


def test_a_brief_under_a_file_shaped_parent_is_refused_before_any_write(
    repo, monkeypatch, capsys
):
    """mkdir would raise here — after tasks.jsonl and the rubric are already
    on disk. That is the half-ran state _plan_writes promises is impossible."""
    setup_repo(repo, SPEC.replace("briefs/csv-export.md", "notes/x.md"))
    (repo / "notes").write_text("I am a file, not a directory\n", encoding="utf-8")
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_CONFIG

    assert "is not a directory" in capsys.readouterr().err
    assert not (repo / spec.TASKS_FILENAME).exists()
    assert not (repo / spec.RUBRIC_FILENAME).exists()


def test_a_brief_inside_dot_git_is_refused(repo, monkeypatch, capsys):
    """Law 6, in its most literal form: Wringer never writes git state."""
    setup_repo(repo, SPEC.replace("briefs/csv-export.md", ".git/refs/heads/main"))
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_CONFIG

    assert ".git/" in capsys.readouterr().err
    assert (repo / ".git" / "refs" / "heads" / "main").read_text().strip()


@pytest.mark.parametrize(
    "collides", ["tasks.jsonl", "wringer.rubric.yaml", "wringer.spec.yaml",
                 ".wringer.yaml"]
)
def test_a_brief_over_a_file_plan_owns_is_refused(
    repo, monkeypatch, capsys, collides
):
    setup_repo(repo, SPEC.replace("briefs/csv-export.md", collides))
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_CONFIG

    assert "writes or reads itself" in capsys.readouterr().err


# --- the gate sidecar at plan time (G1, SPEC_GATEGEN_V0) -----------------

SIDECAR = """\
schema_version: wringer.gatespec.v1
gates:
  - id: acc-button
    run: "pytest -q acceptance/test_button.py"
    proves: {proves}
"""


def write_sidecar(repo: Path, proves: str = "export-button-exists") -> None:
    (repo / spec.GATESPEC_FILENAME).write_text(
        SIDECAR.format(proves=proves), encoding="utf-8"
    )


def test_a_hand_written_sidecar_is_accepted_at_plan_time(
    repo, monkeypatch, capsys
):
    """The offline path is first class: no model wrote this file and the flow
    from here is identical (ruling 5)."""
    setup_repo(repo)
    write_sidecar(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_OK
    capsys.readouterr()


def test_a_sidecar_binding_to_an_unknown_criterion_names_both_files(
    repo, monkeypatch, capsys
):
    """Both sides named: the reader has two documents open and needs to know
    which one is wrong."""
    setup_repo(repo)
    write_sidecar(repo, proves="export-buton-exists")
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_CONFIG

    err = flat(capsys.readouterr().err)
    assert spec.GATESPEC_FILENAME in err
    assert spec.SPEC_FILENAME in err
    assert "export-buton-exists" in err
    # and the ids it could have meant
    assert "export-button-exists" in err


def test_a_sidecar_binding_a_human_criterion_is_refused_at_plan_time(
    repo, monkeypatch, capsys
):
    setup_repo(repo)
    write_sidecar(repo, proves="reads-well")
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_CONFIG

    err = flat(capsys.readouterr().err)
    assert "reads-well" in err and "human" in err
    assert spec.GATESPEC_FILENAME in err


def test_plan_validates_the_sidecar_through_the_shipped_binding_rules(
    repo, monkeypatch, capsys
):
    """The no-second-validator pin, and it bites rather than describes.

    `config.check_bindings` is the one place the three join rules live
    (SPEC_GATEGEN ruling 6). This replaces it with a sentinel and asserts the
    sentinel escapes: if a future change validates the sidecar with a second
    copy of the rules under another name, nothing calls this and the test
    goes red. A guard that merely counted error strings would pass happily
    while the copy drifted.
    """
    setup_repo(repo)
    write_sidecar(repo)
    monkeypatch.chdir(repo)

    def sentinel(gates, criteria, where=config.CONFIG_FILENAME):
        raise config.ConfigError("the shipped binding rules ran")

    monkeypatch.setattr(config, "check_bindings", sentinel)

    assert cli.main(["plan"]) == cli.EXIT_CONFIG
    assert "the shipped binding rules ran" in flat(capsys.readouterr().err)


def test_an_unapproved_spec_stops_before_the_sidecar_is_even_read(
    repo, monkeypatch, capsys
):
    """The interlock comes first. A sidecar full of nonsense must not be what
    a reader is told about when the real answer is 'nobody approved this'."""
    setup_repo(repo, SPEC.replace("approved: true", "approved: false"))
    (repo / spec.GATESPEC_FILENAME).write_text(
        "this is not even yaml: [unclosed\n", encoding="utf-8"
    )
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_GATE_FAILED

    err = flat(capsys.readouterr().err)
    assert "approved: false" in err
    assert spec.GATESPEC_FILENAME not in err


# --- the diff carries the proves lines (G2, SPEC_GATEGEN_V0) -------------


def test_the_rendered_diff_carries_the_proves_line(repo, monkeypatch, capsys):
    """The whole point of the sidecar: the binding travels with the command,
    so a human applying the diff installs both in one edit and cannot install
    the gate while forgetting what it was for."""
    setup_repo(repo)
    write_sidecar(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["plan", "--json"]) == cli.EXIT_OK
    payload = json.loads(capsys.readouterr().out)

    assert "+  - id: acc-button" in payload["gate_diff"]
    assert "+    proves: export-button-exists" in payload["gate_diff"]
    assert "acc-button" in payload["gates_proposed"]


def test_the_proposed_diff_with_a_binding_applies_to_the_real_config(
    repo, monkeypatch, capsys
):
    """A diff nobody can apply is a diff nobody checked — and this one has to
    survive `.wringer.yaml`'s own loader afterwards, `proves:` and all."""
    setup_repo(repo)
    write_sidecar(repo)
    monkeypatch.chdir(repo)
    assert cli.main(["plan", "--json"]) == cli.EXIT_OK
    diff = json.loads(capsys.readouterr().out)["gate_diff"]

    (repo / "gates.patch").write_text(diff, encoding="utf-8")
    import subprocess

    applied = subprocess.run(
        ["git", "apply", str(repo / "gates.patch")],
        cwd=repo, capture_output=True, text=True,
    )
    assert applied.returncode == 0, applied.stderr

    updated = config.load(repo / config.CONFIG_FILENAME)
    bound = {g.id: g.proves for g in updated.gates if g.proves}
    assert bound == {"acc-button": "export-button-exists"}


def test_plan_installs_nothing_and_there_is_no_apply_flag(
    repo, monkeypatch, capsys
):
    """Installing a gate is changing what "verified" means. There is no flag
    for it, and the file on disk is byte-identical afterwards."""
    setup_repo(repo)
    write_sidecar(repo)
    before = (repo / config.CONFIG_FILENAME).read_text(encoding="utf-8")
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_OK
    assert (repo / config.CONFIG_FILENAME).read_text(encoding="utf-8") == before
    capsys.readouterr()

    with pytest.raises(SystemExit):
        cli.main(["plan", "--apply"])


def test_one_id_in_both_the_spec_and_the_sidecar_is_refused_naming_both(
    repo, monkeypatch, capsys
):
    """Review finding 2: two sources of proposed gates, and silently
    preferring one would attach the sidecar's binding to a command the reader
    believes came from the spec."""
    setup_repo(repo)
    (repo / spec.GATESPEC_FILENAME).write_text(
        "schema_version: wringer.gatespec.v1\n"
        "gates:\n"
        "  - id: test\n"
        '    run: "pytest -q acceptance/"\n'
        "    proves: export-button-exists\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_CONFIG

    err = flat(capsys.readouterr().err)
    assert "test" in err
    assert spec.GATESPEC_FILENAME in err
    assert spec.SPEC_FILENAME in err


def test_nothing_that_runs_a_gate_ever_reads_the_sidecar(repo):
    """Ruling 2, enforced rather than promised.

    A filename-constant guard, NOT import-parsing — the spec said the latter
    and the review corrected it, because opening a file by name imports
    nothing. Its limit, stated so nobody mistakes it for more: it catches a
    module that NAMES the file, which is the realistic regression (a read
    added to verify.py), and cannot catch a module handed the path by a
    caller. No guard here can catch that, and claiming otherwise would be the
    guard-that-lies this repository refuses.
    """
    import ast

    def reads_it(source: str) -> bool:
        """Does the CODE name the sidecar — as opposed to the prose?

        Docstrings are excluded deliberately. `config.check_bindings`
        explains in words which two files it serves, and a guard that read
        that as a dependency would push every future author to stop
        documenting the seam, which is a worse repository.
        """
        tree = ast.parse(source)
        docstrings = {
            node.body[0].value
            for node in ast.walk(tree)
            if isinstance(
                node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                       ast.AsyncFunctionDef)
            )
            and node.body
            and isinstance(node.body[0], ast.Expr)
            and isinstance(node.body[0].value, ast.Constant)
            and isinstance(node.body[0].value.value, str)
        }
        for node in ast.walk(tree):
            if node in docstrings:
                continue
            if (
                isinstance(node, ast.Constant)
                and isinstance(node.value, str)
                and spec.GATESPEC_FILENAME in node.value
            ):
                return True
            if isinstance(node, ast.Attribute) and node.attr.startswith(
                "GATESPEC_"
            ):
                return True
            if isinstance(node, ast.Name) and node.id.startswith("GATESPEC_"):
                return True
        return False

    source_dir = Path(spec.__file__).resolve().parent
    named = sorted(
        path.name
        for path in source_dir.glob("*.py")
        if reads_it(path.read_text(encoding="utf-8"))
    )
    assert named == ["cli.py", "spec.py"], (
        f"{named} name the gate sidecar. Only `spec.py` (which defines and "
        "parses it) and `cli.py` (whose `plan` renders it) may: a gate that "
        "runs must come from .wringer.yaml, which a person edited."
    )


# --- the hedge refusal's PREMISE (field report 2026-08-22 finding 10) -------
#
# `wring plan` refuses a spec that hedges "(if unanswered, …)" against a
# question that has been answered. The refusal is right and it is narrow. What
# was wrong until 2026-08-22 was the premise it rests on, stated in `cli.py`
# as *"this cannot false-positive on a spec that really does still have an
# open optional question"* — because `Spec.unanswered` counts REQUIRED
# questions only, so an open optional one leaves it empty and the refusal
# fires anyway.


HEDGED_OBJECTIVE = (
    "Add the export endpoint and the button that calls it, capping rows at "
    "whatever the product confirmed in the open question (if unanswered, do "
    "not cap)."
)


def test_a_hedge_against_a_still_OPEN_optional_question_is_LEGITIMATE(
    repo, monkeypatch, capsys
):
    """The false positive, and it is a live one.

    `row-cap` is optional and unanswered in this fixture — a real state, and
    the state `wring plan` is designed to proceed from. A task that says what
    to do if nobody ever answers it is not a stale fallback; it is the correct
    way to write work against a question that may never be settled.

    Refusing it would leave the person no move at all: the refusal says
    "delete the conditional and keep the answer", and there is no answer.
    """
    setup_repo(
        repo,
        SPEC.replace(
            "objective: Add the export endpoint and the button that calls it.",
            f"objective: {HEDGED_OBJECTIVE}",
        ),
    )
    monkeypatch.chdir(repo)

    code = cli.main(["plan"])

    err = flat(capsys.readouterr().err)
    assert code == cli.EXIT_OK, (
        "a hedge against a genuinely open optional question was refused. The "
        f"premise the refusal rests on counts required questions only: {err}"
    )
    assert (repo / spec.TASKS_FILENAME).exists()


def test_a_hedge_is_still_refused_when_EVERY_question_is_answered(
    repo, monkeypatch, capsys
):
    """The other direction, so the fix above cannot be a way to switch the
    refusal off. With the optional question answered too, nothing in the spec
    is open and the fallback is stale by construction — which is the whole
    reason this check is at this point in `wring plan` and nowhere earlier."""
    setup_repo(
        repo,
        SPEC.replace(
            "objective: Add the export endpoint and the button that calls it.",
            f"objective: {HEDGED_OBJECTIVE}",
        ).replace(
            "    question: Is there a maximum row count?\n"
            "    required: false\n"
            "    answer: ''\n",
            "    question: Is there a maximum row count?\n"
            "    required: false\n"
            "    answer: No cap.\n",
        ),
    )
    monkeypatch.chdir(repo)

    assert cli.main(["plan"]) == cli.EXIT_GATE_FAILED

    err = flat(capsys.readouterr().err)
    assert "hedges against a question that has been answered" in err
    assert "if unanswered" in err, "the refusal does not quote the document back"
    assert not (repo / spec.TASKS_FILENAME).exists()
