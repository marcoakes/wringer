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


def test_A_CHECK_THE_DELIVERY_WEAKENED_CANNOT_CATCH_ANYTHING(
    both_sides, capsys
):
    """**The scratch copy is the DELIVERED tree, removals included.**

    The worktree is detached at HEAD, so it starts as the tree before the
    change and the delivered files are copied over it. That set came from
    `changed_lines`, which by construction records ADDED lines only — so a
    file the delivery only REMOVED lines from was never copied, and HEAD's
    version of it stayed in the scratch copy. Measured on a three-file diff
    before the fix: a deleted file and a pure-deletion hunk both yielded
    `touched: ['keep.py']`.

    The consequence runs in the one direction this lane must never fail in.
    Here the delivery deletes the boundary assertion from the gate's own
    check — a pure-removal hunk, so nothing was added and the file was
    invisible to the old reader. HEAD's stronger check then caught the
    `>=` -> `>` mutant, and the record said the delivered checks caught it.
    They do not: the assertion that caught it is not in the delivered tree.

    A survivor is a finding about the CHECKS, so a caught count inflated by
    the reconstruction is this lane reporting the opposite of its own job.
    """
    weakened = "\n".join(
        line for line in CHECK.splitlines()
        if "covered(3)" not in line
    ) + "\n"
    (both_sides / "check.py").write_text(weakened, encoding="utf-8")

    recorded = measured(both_sides)
    capsys.readouterr()

    # The delivered check no longer exercises the boundary, so nothing in the
    # delivered tree catches this mutant.
    boundary = [
        a for a in recorded["attempts"] if a["mutation"] == "'>=' -> '>'"
    ]
    assert boundary, recorded["attempts"]
    assert all(a["survived"] for a in boundary), (
        "a mutant was recorded CAUGHT by an assertion this delivery removed: "
        f"{boundary}"
    )
    assert recorded["counts"]["caught"] == 0, recorded["counts"]


def test_A_FILE_THE_DELIVERY_DELETED_IS_GONE_FROM_THE_SCRATCH_COPY(
    both_sides, capsys
):
    """The other half of the reconstruction: an outright deletion.

    A pure-removal hunk was invisible to the old reader; so was a deleted
    file, whose `+++` side is `/dev/null`. HEAD's copy therefore survived in
    the scratch tree, and the control — "the bound checks pass on a scratch
    copy of THIS CHANGE" — was asserted about a hybrid that is not the change.

    Driven on something a gate can see: the delivery removes `legacy.py` and
    the check refuses to pass while it exists. On the changed tree that is
    green; in a scratch copy that still carries HEAD's `legacy.py` the control
    fails and the whole run is `inconclusive`, which is the shipped defect
    made visible without reading any internal state.
    """
    (both_sides / "legacy.py").write_text("# superseded\n", encoding="utf-8")
    # ONLY `legacy.py`: the fixture's own uncommitted change to `rules.py` is
    # what supplies the mutable lines, so `git add -A` here would commit it
    # and the run would have nothing to mutate.
    subprocess.run(["git", "add", "legacy.py"], cwd=both_sides, check=True,
                   capture_output=True)
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@e.invalid",
         "-c", "commit.gpgsign=false", "commit", "-m", "legacy"],
        cwd=both_sides, check=True, capture_output=True,
    )
    (both_sides / "legacy.py").unlink()
    (both_sides / ".wringer.yaml").write_text(
        CONFIG.replace(
            'run: "python3 check.py"',
            'run: "test ! -e legacy.py && python3 check.py"',
        ),
        encoding="utf-8",
    )

    recorded = measured(both_sides)
    capsys.readouterr()

    assert recorded["verdict"] == "measured", (
        "the control ran against a tree still carrying a file the delivery "
        f"deleted: {recorded['verdict']} — {recorded.get('reason')}"
    )


def test_changed_paths_names_both_halves_of_the_diff():
    """Unit, because the reconstruction rests entirely on this partition and
    a diff is cheap to state exactly. Deletion, pure-removal hunk, rename."""
    patch = (
        "--- a/gone.py\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-one\n-two\n"
        "--- a/trimmed.py\n+++ b/trimmed.py\n@@ -1,3 +1,2 @@\n one\n-two\n three\n"
        "--- a/old.py\n+++ b/new.py\n@@ -1 +1 @@\n-a\n+b\n"
    )
    present, absent = falsify.changed_paths(patch)
    assert present == ["new.py", "trimmed.py"], present
    assert absent == ["gone.py", "old.py"], absent
    # ...and the old reader saw only the one file that gained a line.
    assert sorted({p for p, _, _ in falsify.changed_lines(patch)}) == ["new.py"]


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


# --- the table itself, which is data and can go stale like any guard ------


def test_EVERY_MUTATION_IN_THE_TABLE_IS_REACHABLE():
    """**A dead table entry reads as coverage and is not.**

    The first matching pair wins, so a pair whose `what` contains an earlier
    pair's `what` can never fire. `(" += ", " -= ")` was exactly that — `+=`
    matched first — and it sat in the table looking like an operator this lane
    covers. Same vacuity class this project keeps finding in its predicates,
    arriving in a data table instead.
    """
    dead = [
        (was, earlier)
        for index, (was, _) in enumerate(falsify.MUTATIONS)
        for earlier, _ in falsify.MUTATIONS[:index]
        if earlier in was
    ]
    assert not dead, f"shadowed by an earlier entry and can never fire: {dead}"


def test_A_MUTATION_NEVER_PRODUCES_A_DOUBLED_OPERATOR():
    """**Found by probing the table against TypeScript, and it errs the worst
    way.**

    `!==` contains `!=`. With the two-character pairs first, `if (a !== b)`
    became `if (a !!= b)` — a SYNTAX ERROR rather than a mutation. Every check
    catches a syntax error, so it lands in the caught column and makes the
    checks look better than they are. Longest operator first is the rule, and
    this is what holds it.

    The samples are ordinary lines from the languages this table claims to
    work on. The assertion is that every run of operator characters in a
    mutant is a REAL operator — a vocabulary check rather than a length one,
    because the first version of this guard used "three or more characters"
    and flagged `===` and `!==` themselves, which are perfectly good
    operators. `!!=` is not.
    """
    import re

    samples = (
        "if (a === b) {", "if (a !== b) {", "if (a == b) {", "if (a != b) {",
        "if a >= 3:", "if a <= 3:", "x += 1", "x -= 1",
        "if a and b:", "if a or b:", "if not a:",
        "return True", "return False",
    )
    real = {
        "=", "==", "===", "!", "!=", "!==", "<", ">", "<=", ">=", "<>",
        "+", "-", "+=", "-=", "=>", "->", "<-", "<<", ">>", "<<=", ">>=",
        "<=>", "--", "++",
    }
    runs = re.compile(r"[=!<>+-]+")
    offenders = []
    for line in samples:
        planned, _ = falsify.plan(f"+++ b/x.ts\n@@ -1 +1 @@\n+{line}")
        for one in planned:
            broken = [r for r in runs.findall(one.became) if r not in real]
            if one.became == one.was or broken:
                offenders.append((line, one.became, one.mutation, broken))
    assert not offenders, (
        "a mutation produced a broken operator rather than a different "
        f"meaning — a syntax error is caught by everything: {offenders}"
    )


def test_the_three_character_operators_are_mutated_as_themselves():
    """The control for the rule above: `===` and `!==` are not merely left
    alone, they get their own honest mutation."""
    for line, want in (
        ("if (a === b) {", "if (a !== b) {"),
        ("if (a !== b) {", "if (a === b) {"),
    ):
        planned, _ = falsify.plan(f"+++ b/x.ts\n@@ -1 +1 @@\n+{line}")
        assert [one.became for one in planned] == [want], planned


def test_AN_OPERATOR_IS_MATCHED_WHOLE_AND_NEVER_SLICED_OUT_OF_A_RUN():
    """**Found by pointing the table at this repository's own diff.**

    A pytest banner — `================ FAILURES ================` — contains
    `===`, so the equality rule fired on the first three characters and
    produced `!==================================`. That is not a mutation, it
    is a syntax error, and a syntax error is caught by everything: the caught
    column inflates and the checks look better than they are. Markdown rules,
    table separators and ASCII art all have that shape.

    Same direction as the three defects before it, which is why the rule now
    has two mechanisms — longest-operator-first in the table's ORDER, and
    whole-operator matching here.
    """
    runs = (
        "==================== FAILURES ====================",
        "# ------------------------------------------",
        "assert a === b",
        "x = 1  # ====",
        "if (a !== b) {",
    )
    import re

    # **The property is what the mutation INTRODUCES**, and the first version
    # of this guard got it wrong: it compared the LONGEST operator run before
    # and after, and slicing `===` out of a twenty-character banner leaves a
    # run of exactly the same length. Every operator run in the mutant must
    # either be a real operator or have been in the original already.
    real = {
        "=", "==", "===", "!", "!=", "!==", "<", ">", "<=", ">=", "<>",
        "+", "-", "+=", "-=", "=>", "->", "<-", "<<", ">>", "++", "--",
    }
    operators = re.compile(r"[=!<>+-]+")
    offenders = []
    for line in runs:
        planned, _ = falsify.plan(f"+++ b/x.ts\n@@ -1 +1 @@\n+{line}")
        for one in planned:
            before = set(operators.findall(one.was))
            introduced = [
                chunk for chunk in operators.findall(one.became)
                if chunk not in real and chunk not in before
            ]
            if introduced:
                offenders.append((line, one.became, one.mutation, introduced))
    assert not offenders, (
        "a substitution sliced an operator out of a longer run and produced "
        f"a syntax error rather than a different meaning: {offenders}"
    )


def test_a_banner_of_equals_signs_is_left_alone_entirely():
    """The control: not merely mutated safely — not offered at all, because
    there is no operator there to mutate."""
    banner = "==================== FAILURES ===================="
    planned, _ = falsify.plan(f"+++ b/x.py\n@@ -1 +1 @@\n+{banner}")
    assert planned == [], planned


def test_a_real_operator_beside_other_punctuation_is_still_offered():
    """The other control. Whole-operator matching must not make the lane
    silently stop working on ordinary code — a rule that rejects everything
    passes the guard above and measures nothing."""
    planned, _ = falsify.plan(
        "+++ b/x.py\n@@ -1 +1 @@\n+    if n >= 3 and m == 4:"
    )
    assert [one.mutation for one in planned] == ["'==' -> '!='"], planned


# --- D6: emitting a step and SHOWING one are different acts ----------------


def test_FALSIFY_REPORTS_TO_THE_TERMINAL_AND_TO_JSON(both_sides, capsys):
    """**It ran up to 24 mutations against every bound gate and said nothing.**

    Minutes of work on the critical path, real information about what the
    checks do not notice, written to `falsification.json` and to a
    `summary.md` section — and no console line and no `--json` key. The
    renderer already existed; nothing called it. `verify.Outcome` grew
    `vacuity`, `stability` and `acceptance` for exactly the "the caller
    cannot say so if the outcome does not tell it" reason, and these two
    never joined, so the CLI was STRUCTURALLY unable to report them.

    This blocks run 3: the sheet sends a person to read the falsify table,
    and today they would be reading silence.
    """
    assert cli.main(["verify", "--falsify"]) == cli.EXIT_OK
    said = capsys.readouterr().out

    flat = " ".join(said.split()).lower()
    assert "deliberate breakages of this change went unnoticed" in flat, said
    assert "a surviving mutation is a finding about the checks" in flat, said
    # ...and the coverage statement, which reached `summary.md`, the
    # certificate and the board, and never a terminal.
    assert "carries a check that can prove it" in flat, said

    assert cli.main(["verify", "--falsify", "--json"]) == cli.EXIT_OK
    payload = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert payload["falsification"]["verdict"] == "measured", payload
    assert payload["falsification"]["counts"]["survived"] >= 1, payload
    # ...and the contract key that one of the two producers used to drop.
    assert payload["template_only"] is False, payload


def test_a_run_that_measured_NOTHING_says_nothing_about_falsification(
    both_sides, capsys
):
    """The absence rule every optional artifact here keeps. A key that is
    always present and usually null teaches a consumer to ignore it, and
    "not measured" is not "zero"."""
    assert cli.main(["verify", "--json"]) == cli.EXIT_OK
    payload = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert "falsification" not in payload, payload

