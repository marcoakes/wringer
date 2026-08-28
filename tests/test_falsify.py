"""Mechanical falsification — docs/specs/SPEC_FALSIFY_V0.md. Model-free.

**Two fixtures, watched from both sides** (§7). A lane that reported
everything caught, or everything survived, would be green against a fixture
that only checked one direction — so the repository below contains one rule
the bound check exercises and one it does not, and both halves are asserted.

The change is real: a gate that existed BEFORE it, a boundary the check tests,
and a second function nothing tests at all.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from wringer import cli, falsify

SPEC = """\
schema_version: wringer.spec.v1
approved: true
title: Two rules
intent: One of them is checked and one of them is not.
tasks:
  - id: build
    brief: Build it
    objective: Both rules hold.
criteria:
  - id: covered-rule
    title: The covered rule holds
    required: true
"""

CONFIG = """\
version: 1
gates:
  - id: check
    run: "python3 check.py"
    proves: covered-rule
"""

#: Exercises the BOUNDARY, which is what makes `>=` -> `>` a CAUGHT mutation.
#: A check that only tested `covered(4)` would let that mutation through, and
#: the first version of this fixture did exactly that — both sides survived,
#: correctly, and the fixture proved nothing about catching.
CHECK = """\
import rules
assert rules.covered(3) == "big", rules.covered(3)
assert rules.covered(2) == "small", rules.covered(2)
print("ok")
"""

#: The change: `covered` gains its boundary, and `uncovered` arrives with
#: nothing watching it.
AFTER = '''\
def covered(n):
    if n >= 3:
        return "big"
    return "small"


def uncovered(n):
    if n >= 3:
        return "many"
    return "few"
'''


@pytest.fixture()
def both_sides(tmp_path, monkeypatch):
    """A repository with one watched rule and one unwatched one."""
    subprocess.run(["git", "init", "-q", "-b", "main", str(tmp_path)], check=True)
    for name, body in (
        ("wringer.spec.yaml", SPEC),
        (".wringer.yaml", CONFIG),
        ("check.py", CHECK),
        (".gitignore", ".wringer/\n"),
        ("rules.py", 'def covered(n):\n    return "big"\n'),
    ):
        (tmp_path / name).write_text(body, encoding="utf-8")
    quiet = ["-c", "user.name=t", "-c", "user.email=t@e.invalid",
             "-c", "commit.gpgsign=false"]
    for args in (["add", "-A"], [*quiet, "commit", "-m", "red first"]):
        subprocess.run(["git", *args], cwd=tmp_path, check=True,
                       capture_output=True)
    (tmp_path / "rules.py").write_text(AFTER, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    return tmp_path


def _run(repo: Path) -> Path:
    return sorted((repo / ".wringer" / "runs").iterdir())[-1]


def measured(repo: Path) -> dict:
    assert cli.main(["verify", "--falsify"]) == cli.EXIT_OK
    recorded = falsify.read(_run(repo))
    assert recorded is not None, "no falsification record was written"
    return recorded


# --- §7: both sides, and neither on its own would do -----------------------


def test_A_MUTATION_NOTHING_CHECKS_SURVIVES(both_sides, capsys):
    recorded = measured(both_sides)
    capsys.readouterr()

    survivors = [a for a in recorded["attempts"] if a["survived"]]
    assert [a["line"] for a in survivors] == [8], recorded["attempts"]
    assert survivors[0]["path"] == "rules.py"
    assert survivors[0]["mutation"] == "'>=' -> '>'"


def test_A_MUTATION_THE_CHECK_COVERS_IS_CAUGHT(both_sides, capsys):
    """The other half. Without it a lane that reported EVERYTHING as a
    survivor would pass the test above."""
    recorded = measured(both_sides)
    capsys.readouterr()

    caught = [a for a in recorded["attempts"] if not a["survived"]]
    assert [a["line"] for a in caught] == [2], recorded["attempts"]
    assert caught[0]["caught_by"] == ["check"]


def test_THE_TWO_SIDES_ARE_TOLD_APART_IN_ONE_RUN(both_sides, capsys):
    """Both, together, which is the only shape that proves the lane
    discriminates rather than that it has a favourite answer."""
    recorded = measured(both_sides)
    capsys.readouterr()
    assert recorded["counts"] == {"attempted": 2, "caught": 1, "survived": 1}


# --- the defect the very first fixture found ------------------------------


def test_TWO_SAME_SIZE_MUTANTS_ARE_NOT_JUDGED_BY_ONE_ANOTHERS_BYTECODE(
    both_sides, capsys, monkeypatch
):
    """**Measured on the first real fixture, and it errs the WORST way.**

    The two mutants here are the same substitution on two lines, so the files
    are the same SIZE, and this lane rewrites a file several times a second.
    CPython validates a cached `.pyc` against the source's `(mtime truncated
    to seconds, size)` — so the second mutant was executed as the FIRST
    mutant's bytecode, and a mutation nothing checks was recorded as CAUGHT.

    That inflates the caught count, which makes the checks look better than
    they are: the one direction this measurement must never fail in, since
    refusing exactly that is the whole point of the lane.

    This asserts the OUTCOME rather than the mechanism — the two mutants get
    different answers — because the mechanism is one build cache's rule and
    the property is about any of them.

    **Bytecode caching is turned ON here explicitly, and that is not a
    detail.** Gates inherit the whole environment, so a suite run under
    `PYTHONDONTWRITEBYTECODE` writes no `.pyc` at all and this guard cannot
    reproduce the defect it is about — which is exactly what happened the
    first time it was red-watched, under a harness that sets that variable
    for its own reasons. A guard whose subject depends on how the suite was
    invoked is a guard that is off when it matters.
    """
    monkeypatch.delenv("PYTHONDONTWRITEBYTECODE", raising=False)
    recorded = measured(both_sides)
    capsys.readouterr()
    answers = {a["line"]: a["survived"] for a in recorded["attempts"]}
    assert answers == {2: False, 8: True}, (
        "the two same-size mutants were given the same answer, which is what "
        "a stale build artifact looks like from here"
    )


def test_the_run_is_DETERMINISTIC(both_sides, capsys):
    """Two runs of one commit attempt the same mutations in the same order,
    or a survivor is not a fact anybody can go and reproduce."""
    first = measured(both_sides)
    second = measured(both_sides)
    capsys.readouterr()

    def shape(recorded):
        return [
            (a["path"], a["line"], a["mutation"], a["survived"])
            for a in recorded["attempts"]
        ]

    assert shape(first) == shape(second)


# --- the control, without which the whole measurement is a lie ------------


def test_A_FAILING_CONTROL_IS_INCONCLUSIVE_AND_NEVER_A_SCORE(
    both_sides, monkeypatch, capsys
):
    """**Ruling 4.** A scratch copy carries tracked files only. In a
    repository whose dependencies are not committed, every gate fails there —
    and every mutant would then be recorded as CAUGHT. A perfect score
    produced by a broken environment is worse than no measurement.

    Reproduced by making the check depend on a file that is gitignored, so it
    is present in the working tree and absent from the scratch copy: exactly
    the shape a `.venv` or a `node_modules` has.
    """
    (both_sides / ".gitignore").write_text(
        ".wringer/\nsecret_dep.py\n", encoding="utf-8"
    )
    (both_sides / "secret_dep.py").write_text("VALUE = 1\n", encoding="utf-8")
    (both_sides / "check.py").write_text(
        "import secret_dep\n" + CHECK, encoding="utf-8"
    )
    cli.main(["verify", "--falsify"])
    capsys.readouterr()

    recorded = falsify.read(_run(both_sides))
    assert recorded["verdict"] == falsify.INCONCLUSIVE, recorded
    assert recorded["counts"] == {"attempted": 0, "caught": 0, "survived": 0}
    assert "tracked files only" in recorded["reason"]


# --- rulings 3 and 6: it refuses nothing, and never touches your tree -----


def test_RULING_3_THE_FLAG_CHANGES_NO_OUTCOME(both_sides, capsys):
    """No exit code, acceptance row, verdict or delivery outcome differs
    between a run with the flag and a run without it.

    **The whole claim, not the exit code alone.** The first version of this
    guard compared exit codes and acceptance rows, and the exit code is
    decided by `failed_gate` rather than by `status` — so a revert that moved
    `status` inside the falsification block left it green. The comparison now
    covers everything a reader or a delivery would act on.
    """
    import json as json_module

    from wringer import accept

    def snapshot(code):
        run = _run(both_sides)
        manifest = json_module.loads(
            (run / "manifest.json").read_text(encoding="utf-8")
        )
        rows = accept.read(run)
        return (
            code,
            manifest.get("status"),
            manifest.get("failed_gate"),
            rows["counts"],
            [(r["criterion"], r["state"], r["refuses"]) for r in rows["criteria"]],
        )

    without = snapshot(cli.main(["verify"]))
    with_flag = snapshot(cli.main(["verify", "--falsify"]))
    capsys.readouterr()

    assert without[0] == cli.EXIT_OK
    assert without == with_flag, (
        "the falsification flag moved an outcome. It is a hint tier and it "
        "refuses nothing — whether a survivor should ever refuse is a named "
        "future ruling that wants this v0's field evidence first"
    )


def test_RULING_6_THE_PERSONS_TREE_IS_NEVER_TOUCHED(both_sides, capsys):
    """Every mutant is written into a scratch copy and nowhere else. The
    working tree is not touched, not stashed and not reverted."""
    watched = {
        path: path.read_bytes()
        for path in (both_sides / "rules.py", both_sides / "check.py")
    }
    measured(both_sides)
    capsys.readouterr()

    for path, before in watched.items():
        assert path.read_bytes() == before, f"{path.name} moved under the run"
    assert not (both_sides / ".wringer" / "worktrees").exists() or not list(
        (both_sides / ".wringer" / "worktrees").iterdir()
    ), "the scratch copy was left behind"


# --- what is never mutated, and both halves were found by running it ------


def test_PROSE_AND_THIS_REPOSITORYS_OWN_DECLARATIONS_ARE_NEVER_MUTATED():
    """**Found on the first field run**, against run 2's real delivered
    change. It mutated a markdown brief, a YAML spec and the judgements file
    and reported all three as survivors — true statements, and none of them a
    finding, because a conjunction inside prose changes no behaviour.

    Worse, they crowd out the real ones: twelve of twenty-four attempts went
    to prose, and the mutations the checks actually caught were never reached.
    The measurement got LESS informative as the sampling got fairer.
    """
    patch = "\n".join(
        f"+++ b/{name}\n@@ -1 +1 @@\n+if a and b:"
        for name in (
            "briefs/one.md",
            "wringer.spec.yaml",
            "wringer.judgements.yaml",
            ".wringer.yaml",
            "src/real.py",
        )
    )
    planned, _ = falsify.plan(patch)
    assert [one.path for one in planned] == ["src/real.py"], planned


def test_a_comment_line_is_never_mutated():
    patch = "+++ b/a.py\n@@ -1 +2 @@\n+# if a and b: this is prose\n+if a and b:"
    planned, _ = falsify.plan(patch)
    assert [one.line for one in planned] == [3], planned


# --- the ceiling, and the fact that it is SAID ----------------------------


def test_REACHING_THE_CEILING_IS_SAID_AND_NEVER_SILENT():
    """A silent truncation reads as "we tried everything", which is the worse
    of the two mistakes a bounded measurement can make."""
    patch = "+++ b/a.py\n@@ -1 +1 @@\n" + "\n".join(
        f"+if a{n} and b:" for n in range(10)
    )
    planned, truncated = falsify.plan(patch, limit=3)
    assert len(planned) == 3
    assert "7 further mutation" in truncated
    assert "ceiling is 3" in truncated


def test_THE_CEILING_IS_SPREAD_ACROSS_FILES(both_sides):
    """**Found by the first field run.** Taking the diff in order reached the
    ceiling inside the first two files and never attempted the last two at
    all — the `truncated` sentence was true and a reader would still have
    drawn a conclusion about a change half of which was never touched."""
    patch = "".join(
        f"+++ b/{name}\n@@ -1 +1 @@\n" + "".join(f"+if a{n} and b:\n" for n in range(5))
        for name in ("a.py", "b.py", "c.py")
    )
    planned, _ = falsify.plan(patch, limit=6)
    assert sorted({one.path for one in planned}) == ["a.py", "b.py", "c.py"], (
        "the ceiling was spent on the first file(s) and the rest of the "
        "change was never attempted"
    )
    assert len(planned) == 6


def test_the_record_matches_its_published_schema(both_sides, capsys):
    jsonschema = pytest.importorskip("jsonschema")
    recorded = measured(both_sides)
    capsys.readouterr()
    schema = json.loads(
        (Path(__file__).resolve().parents[1] / "schema"
         / "falsification-v1.schema.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(recorded, schema)


# --- ruling 1 and the ceiling, in the words a reader meets ----------------


def test_RULING_1_A_SURVIVOR_IS_A_FINDING_ABOUT_THE_CHECKS(both_sides, capsys):
    """It is in the sentence a reader meets, before anything else in it — not
    in a footnote and not in a spec nobody opened."""
    recorded = measured(both_sides)
    capsys.readouterr()
    said = " ".join(falsify.lines(recorded))

    assert "finding about the checks" in said, said
    assert "not a finding about the change" in said
    assert "necessary and demonstrably NOT sufficient" in said
    assert "never a score" in said.lower()


def test_a_survivor_is_NAMED_with_its_mutant(both_sides, capsys):
    """"3 survived" sends a reader nowhere. The file, the line, what it was,
    what it became, and which checks did not notice."""
    recorded = measured(both_sides)
    capsys.readouterr()
    said = " ".join(falsify.lines(recorded))

    assert "rules.py:8" in said
    assert "'>=' -> '>'" in said
    assert "`check` stayed green" in said


def test_absent_is_absent(tmp_path):
    """A run without the flag measured nothing, which is not a score of
    zero."""
    assert falsify.read(tmp_path) is None
    assert falsify.lines(None) == []


def test_A_CHANGE_THAT_ADDS_ITS_OWN_CHECK_IS_STILL_MEASURABLE(
    both_sides, capsys
):
    """**The first FIELD run came back inconclusive because of this.**

    Run 2's delivered change adds an acceptance test. In a working tree that
    file is UNTRACKED, and a scratch copy is a detached worktree carrying
    tracked files only — so the file never arrived, the gate that runs it
    failed there, and the control refused the whole measurement. Correctly:
    the control's job is exactly to refuse a score produced by a broken
    environment.

    But it meant a change that adds files could never be falsified, which is
    most changes. `deliver.plan` learned the same lesson once already — a
    change made entirely of new files rendered an empty patch — and this is
    that lesson arriving in a second place.
    """
    (both_sides / "extra_check.py").write_text(
        "import rules\n"
        'assert rules.uncovered(3) == "many", rules.uncovered(3)\n'
        'assert rules.uncovered(2) == "few", rules.uncovered(2)\n',
        encoding="utf-8",
    )
    # One criterion, one gate — the engine refuses a second claim on the same
    # requirement, so the new check gets its own.
    (both_sides / "wringer.spec.yaml").write_text(
        SPEC + "  - id: uncovered-rule\n    title: The other rule holds\n"
        "    required: true\n",
        encoding="utf-8",
    )
    (both_sides / ".wringer.yaml").write_text(
        CONFIG + '  - id: extra\n    run: "python3 extra_check.py"\n'
        "    proves: uncovered-rule\n",
        encoding="utf-8",
    )
    recorded = measured(both_sides)
    capsys.readouterr()

    assert recorded["verdict"] == falsify.MEASURED, recorded
    assert "extra" in recorded["gates"], recorded["gates"]
    # Two things, and each is half the fix. The new file is in the DIFF, so
    # its own lines were attempted; and it reached the scratch copy and RAN,
    # so the mutation it covers is now caught where before it survived.
    assert any(a["path"] == "extra_check.py" for a in recorded["attempts"]), (
        recorded["attempts"]
    )
    answers = {
        (a["path"], a["line"]): a["survived"] for a in recorded["attempts"]
    }
    assert answers[("rules.py", 8)] is False, (
        "the new check did not reach the scratch copy, so the mutation it "
        "covers still survived"
    )


def test_A_MUTANT_IS_NEVER_JUDGED_BESIDE_A_PREVIOUS_ONE(tmp_path, monkeypatch):
    """**One mutation at a time, across FILES as well as within one.**

    Each attempt rewrites one file and restores it afterwards. With two
    mutants in the same file the restore is invisible — the next attempt
    overwrites that file from the original anyway — so the two-mutant fixture
    above cannot see whether it happens. Across two files it is load-bearing:
    without the restore, `a.py` stays broken while `b.py`'s mutant runs, and
    the second mutant is judged against a tree carrying BOTH. That inflates
    the caught count, which is the direction this lane must never fail in.

    **The names are load-bearing.** Attempts go round-robin over SORTED
    files, so the watched file has to sort first or the un-restored mutant is
    one nothing reads and the fixture proves nothing — which is what the
    first version of it did.
    """
    subprocess.run(["git", "init", "-q", "-b", "main", str(tmp_path)], check=True)
    (tmp_path / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (tmp_path / ".wringer.yaml").write_text(CONFIG, encoding="utf-8")
    (tmp_path / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    # The check reads ONE of the two files. A mutation of the other must
    # survive — and it can only survive if the first file was put back.
    (tmp_path / "check.py").write_text(
        "import a_watched\n"
        'assert a_watched.rule(3) == "big", a_watched.rule(3)\n'
        'assert a_watched.rule(2) == "small", a_watched.rule(2)\n',
        encoding="utf-8",
    )
    (tmp_path / "a_watched.py").write_text(
        'def rule(n):\n    return "big"\n', encoding="utf-8"
    )
    (tmp_path / "z_unwatched.py").write_text(
        'def rule(n):\n    return "big"\n', encoding="utf-8"
    )
    quiet = ["-c", "user.name=t", "-c", "user.email=t@e.invalid",
             "-c", "commit.gpgsign=false"]
    subprocess.run(["git", "add", "-A"], cwd=tmp_path, check=True,
                   capture_output=True)
    subprocess.run(["git", *quiet, "commit", "-m", "red first"], cwd=tmp_path,
                   check=True, capture_output=True)

    body = 'def rule(n):\n    if n >= 3:\n        return "big"\n    return "small"\n'
    (tmp_path / "a_watched.py").write_text(body, encoding="utf-8")
    (tmp_path / "z_unwatched.py").write_text(body, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("PYTHONDONTWRITEBYTECODE", raising=False)
    assert cli.main(["verify", "--falsify"]) == cli.EXIT_OK

    recorded = falsify.read(_run(tmp_path))
    answers = {a["path"]: a["survived"] for a in recorded["attempts"]}
    assert answers == {"a_watched.py": False, "z_unwatched.py": True}, (
        "a mutant was judged beside another file's mutant, so a breakage "
        "nothing checks was recorded as caught"
    )
