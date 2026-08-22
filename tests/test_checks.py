"""**The checker under trust** — a check that changed since it was bound.

`SPEC_ACCEPT`'s claim is that a criterion is `evidenced` because a bound gate
was recorded RED before the work and is GREEN now. Nothing checked that the
check which went red is the check that is green: edit the test file between the
two runs and the transition is still on the record, still resolvable, and no
longer about the same assertions.

Reproduced end-to-end before any of this was written — a real repo, a real
binding, red then green, then one appended line in the bound check file — and
the note appeared on both surfaces. These are the guards for that.

**v0 is a NOTE.** Every test here that asserts the note appears has a sibling
asserting it changed no verdict, no state and no exit code, because the whole
risk of a hint tier is that it quietly grows teeth nobody ruled on.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wringer import checks, cli

SPEC = """\
schema_version: wringer.spec.v1
approved: true
title: The cabinet remembers
intent: |
  People lose their place in the cabinet.
tasks:
  - id: build
    brief: Build it
    objective: The cabinet remembers.
criteria:
  - id: recent-first
    title: The most recently played comes first
"""

CONFIG = """\
version: 1

gates:
  - id: recent
    run: python3 acceptance/recent.py
    timeout: 30
    proves: recent-first
"""

CHECK = """\
import json, pathlib
data = json.loads(pathlib.Path("store.json").read_text())
assert data.get("recent") == ["b", "a"], data
print("ok")
"""


@pytest.fixture
def bound(repo: Path) -> Path:
    """A repo where one criterion is bound to a check that reads a file."""
    (repo / "acceptance").mkdir()
    (repo / "acceptance" / "recent.py").write_text(CHECK, encoding="utf-8")
    (repo / "store.json").write_text('{"recent": []}\n', encoding="utf-8")
    (repo / ".wringer.yaml").write_text(CONFIG, encoding="utf-8")
    (repo / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    return repo


def _runs(repo: Path) -> list[Path]:
    """Bundles in the order they were WRITTEN, never by id.

    Run ids are `<date>-<HHMMSS>-<4 hex>` and do not sort chronologically —
    the same trap board ruling 8 exists for, and it bit this file's own first
    draft.
    """
    return sorted(
        (repo / ".wringer" / "runs").iterdir(), key=lambda p: p.stat().st_mtime
    )


# --- what an identity is, and what it honestly covers -----------------------


def test_a_command_that_NAMES_A_FILE_hashes_that_file(bound):
    identity = checks.identity_of("recent", "python3 acceptance/recent.py", bound)
    assert identity.coverage == checks.COVERAGE_COMMAND_AND_FILES
    assert list(identity.files) == ["acceptance/recent.py"]


def test_a_command_that_NAMES_NO_FILE_says_so_rather_than_pretending(bound):
    """`pytest -q` is not derivable and the row admits it.

    The alternative — silently hashing nothing and reporting the same
    `coverage` as a real file comparison — is a check that covers less than
    its name claims, which is the defect class this repository exists to
    catch.
    """
    identity = checks.identity_of("suite", "pytest -q", bound)
    assert identity.coverage == checks.COVERAGE_COMMAND_ONLY
    assert identity.files == {}
    assert identity.run_sha256, "even an underivable check has its command hashed"


def test_a_path_that_ESCAPES_THE_REPO_is_not_hashed(bound):
    """A check file outside the tree is not something this bundle can speak
    for, and hashing it would put a machine-local absolute path in a record
    that is supposed to travel."""
    assert checks.derivable_files("sh ../../elsewhere/x.sh", bound) == []
    assert checks.derivable_files("sh /etc/hosts", bound) == []


def test_an_unparseable_command_still_has_an_identity(bound):
    identity = checks.identity_of("odd", "echo 'unclosed", bound)
    assert identity.run_sha256
    assert identity.coverage == checks.COVERAGE_COMMAND_ONLY


# --- absence is never a change ---------------------------------------------


def test_a_bundle_with_NO_checks_file_yields_NO_NOTE(bound):
    """Every bundle written before this shipped has no `checks.json`.

    Reading that silence as "the check changed" would put a warning on every
    historical receipt in every repository — a surface rendering absence as a
    verdict, which is the thing this project keeps naming in other tools.
    """
    assert checks.changed(None, checks.identity_of("g", "pytest -q", bound)) is None
    assert checks.changed(checks.identity_of("g", "pytest -q", bound), None) is None
    assert checks.read(bound) == {}


def test_an_UNCHANGED_check_yields_no_note(bound, monkeypatch, capsys):
    monkeypatch.chdir(bound)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED  # red first
    (bound / "store.json").write_text('{"recent": ["b", "a"]}\n', encoding="utf-8")
    capsys.readouterr()
    assert cli.main(["verify"]) == cli.EXIT_OK  # green, same check
    out = capsys.readouterr().out
    assert checks.CHANGED_NOTE not in out, out
    assert checks.notes_for(bound, _runs(bound)[-1]) == []


# --- the note itself --------------------------------------------------------


def test_EDITING_THE_BOUND_CHECK_surfaces_the_engines_note(
    bound, monkeypatch, capsys
):
    """**The money test.** Red, green, then one appended line in the file the
    check runs — and the receipt still resolves, which is exactly why nothing
    caught this before."""
    monkeypatch.chdir(bound)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    (bound / "store.json").write_text('{"recent": ["b", "a"]}\n', encoding="utf-8")
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    check = bound / "acceptance" / "recent.py"
    check.write_text(check.read_text(encoding="utf-8") + "# nothing\n", "utf-8")

    assert cli.main(["verify"]) == cli.EXIT_OK
    out = capsys.readouterr().out
    assert checks.CHANGED_NOTE in out, out
    assert "recent-first" in out

    notes = checks.notes_for(bound, _runs(bound)[-1])
    assert [n.criterion for n in notes] == ["recent-first"]
    assert notes[0].sentence == checks.CHANGED_NOTE


def test_the_note_CHANGES_NO_VERDICT_and_NO_EXIT_CODE(bound, monkeypatch, capsys):
    """**v0 is a hint and this is what holds it to that.**

    Whether a changed check should BLOCK delivery is a named future ruling
    that wants field evidence first. A hint tier that quietly starts refusing
    is a decision nobody took, so the criterion stays `evidenced`, the exit
    code stays 0, and `refuses` stays false.
    """
    monkeypatch.chdir(bound)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    (bound / "store.json").write_text('{"recent": ["b", "a"]}\n', encoding="utf-8")
    assert cli.main(["verify"]) == cli.EXIT_OK
    check = bound / "acceptance" / "recent.py"
    check.write_text(check.read_text(encoding="utf-8") + "# nothing\n", "utf-8")
    capsys.readouterr()

    assert cli.main(["verify"]) == cli.EXIT_OK, "the note changed the exit code"
    record = json.loads(
        (_runs(bound)[-1] / "acceptance.json").read_text(encoding="utf-8")
    )
    row = next(r for r in record["criteria"] if r["criterion"] == "recent-first")
    assert row["state"] == "evidenced", "the note changed the verdict"
    assert row["refuses"] is False, "the note refused a delivery in v0"


def test_the_note_never_changes_a_CARD_either(bound, monkeypatch):
    """**Added because the first version of the guard above let this through.**

    Revert-the-fix on the board side — making the note set `refused=True` on
    the card — and every test still passed, because the engine-side assertions
    above read `acceptance.json` and the board reads its own `Board`. A hint
    tier can grow teeth on EITHER surface, and only one of them was watched.

    So: the same card, built twice from the same criterion, with and without
    the note. Every field but `check_note` must be identical.
    """
    from dataclasses import replace as dataclass_replace

    from wringer_board import cards
    from wringer_board import read as board_read

    monkeypatch.chdir(bound)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    (bound / "store.json").write_text('{"recent": ["b", "a"]}\n', encoding="utf-8")
    assert cli.main(["verify"]) == cli.EXIT_OK
    check = bound / "acceptance" / "recent.py"
    check.write_text(check.read_text(encoding="utf-8") + "# nothing\n", "utf-8")
    assert cli.main(["verify"]) == cli.EXIT_OK

    board = board_read.read(bound)
    assert board.check_notes, "the note never reached the board at all"
    criterion = next(c for c in board.criteria if c.id == "recent-first")

    with_note = cards.card_for(board, criterion)
    board.check_notes = {}
    without = cards.card_for(board, criterion)

    assert with_note.check_note, "the note is absent from the card that has one"
    assert without.check_note is None
    assert dataclass_replace(with_note, check_note=None) == without, (
        "the changed-since-bound note altered something OTHER than the note "
        "field on the card — in v0 it is a hint and changes no verdict, no "
        "state, and no refusal"
    )
    assert with_note.refused is without.refused is False


def test_the_note_is_NOT_A_KEY_on_the_frozen_acceptance_record(
    bound, monkeypatch
):
    """Law 7: new facts ride new sibling files.

    `acceptance.json` is frozen, so the note is DERIVED at read time from
    `checks.json` and the receipt — never written onto a row, where it would
    be a silent break for every existing reader.
    """
    monkeypatch.chdir(bound)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    (bound / "store.json").write_text('{"recent": ["b", "a"]}\n', encoding="utf-8")
    assert cli.main(["verify"]) == cli.EXIT_OK
    check = bound / "acceptance" / "recent.py"
    check.write_text(check.read_text(encoding="utf-8") + "# nothing\n", "utf-8")
    assert cli.main(["verify"]) == cli.EXIT_OK

    raw = (_runs(bound)[-1] / "acceptance.json").read_text(encoding="utf-8")
    assert checks.CHANGED_NOTE not in raw
    assert "check_note" not in raw and "checks" not in json.loads(raw)


def test_checks_json_is_INSIDE_the_seal(bound, monkeypatch):
    """The record of what the checker WAS is as tamper-evident as the record
    of what it said — which it would not be if it sat outside the bundle."""
    monkeypatch.chdir(bound)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    bundle = _runs(bound)[-1]
    assert (bundle / checks.CHECKS_FILENAME).is_file()
    digests = json.loads((bundle / "digests.json").read_text(encoding="utf-8"))
    assert checks.CHECKS_FILENAME in digests["files"], (
        "checks.json is not covered by the bundle's own digests, so the record "
        "of the checker is the one unsealed link in the chain"
    )
    assert cli.main(["audit", str(bundle)]) == cli.EXIT_OK


def test_the_BOARD_renders_the_engines_sentence_VERBATIM(bound, monkeypatch):
    """SPEC_BOARD ruling 1: the board shows the engine's words, not its own.

    Compared against `checks.CHANGED_NOTE` itself rather than against a copy
    written here, because a copy is how two surfaces come to say two things.
    """
    from wringer_board import read as board_read
    from wringer_board import render as board_render

    monkeypatch.chdir(bound)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    (bound / "store.json").write_text('{"recent": ["b", "a"]}\n', encoding="utf-8")
    assert cli.main(["verify"]) == cli.EXIT_OK
    check = bound / "acceptance" / "recent.py"
    check.write_text(check.read_text(encoding="utf-8") + "# nothing\n", "utf-8")
    assert cli.main(["verify"]) == cli.EXIT_OK

    page = board_render.render(board_read.read(bound))
    assert checks.CHANGED_NOTE in page, page[:400]
    assert 'class="checknote"' in page
    # Hint tier on the page too: it is not a refusal chip and not a state.
    assert checks.CHANGED_NOTE not in page.split('<span class="badge">')[0][-200:]


def test_ONE_wording_for_the_note_across_both_surfaces():
    """The console and the board must not be able to drift apart.

    Both call `checks.notes_for`, and neither owns a literal of the sentence.
    A second copy anywhere in `src/` is the drift this asserts against.
    """
    src = Path(checks.__file__).resolve().parents[1]
    # A fragment short enough to survive the source's own line wrapping and
    # long enough that nothing else could contain it by accident.
    literal = "its green is not the green"
    holders = sorted(
        path.name
        for path in src.rglob("*.py")
        if literal in path.read_text(encoding="utf-8")
    )
    assert holders == ["checks.py"], (
        f"the note's wording is written out in more than one place: {holders}"
    )


def test_the_ESCALATION_PATH_is_named_rather_than_improvised():
    """v0 refuses nothing, and the document says what would change that.

    A hint tier with no named next step is how a warning becomes permanent
    furniture nobody ever rules on.
    """
    text = Path(checks.__file__).read_text(encoding="utf-8")
    assert "future ruling" in text
    assert "delivery interlock" in text, (
        "the module never says WHAT the escalation would be, so nobody can "
        "take the ruling it defers"
    )


# --- THE REPOSITORY IS THE ATTACKER -----------------------------------------
#
# Wringer's thesis is that it trusts nothing — not the worker's exit code, not
# the agent's summary, not the tests the agent wrote. This module is new
# evidence, so the thesis gets pointed at it. Everything below was RUN as a
# hostile `.wringer.yaml` before it was written down.


def test_a_gate_CANNOT_forge_its_own_checks_record(bound, monkeypatch):
    """A gate that overwrites `checks.json` mid-run loses.

    Measured: a gate whose command writes a fabricated `checks.json` into the
    newest bundle finds the engine has written the real one over it, because
    `checks.write` runs after the gates and before the digests. The record is
    the engine's, which is the only version of this that is worth anything.
    """
    (bound / ".wringer.yaml").write_text(
        "version: 1\ngates:\n  - id: g\n    run: >-\n"
        "      sh -c 'd=$(ls -dt .wringer/runs/* 2>/dev/null | head -1);"
        ' printf "{}" > "$d/checks.json" 2>/dev/null; true\'\n',
        encoding="utf-8",
    )
    monkeypatch.chdir(bound)
    assert cli.main(["verify"]) == cli.EXIT_OK

    record = json.loads((_runs(bound)[-1] / "checks.json").read_text("utf-8"))
    assert record.get("schema_version") == checks.SCHEMA_VERSION, record
    assert record["checks"], "the gate's forgery survived; the engine's did not"
    assert record["checks"][0]["gate_id"] == "g"


def test_a_file_a_gate_PLANTS_is_inside_the_seal_and_audit_says_VERIFIES(
    bound, monkeypatch, capsys
):
    """**An honest limit, pinned so nobody later claims otherwise.**

    `digests.json` is sealed after the gates run, so anything a gate writes
    into its own bundle during the run is sealed WITH it and audits clean.
    SECURITY.md says this — *nothing before the seal is covered* — and this is
    the executable form of that sentence, because a page saying it is worth
    less than a test that would go red if it stopped being true.
    """
    (bound / ".wringer.yaml").write_text(
        "version: 1\ngates:\n  - id: g\n    run: >-\n"
        "      sh -c 'd=$(ls -dt .wringer/runs/* 2>/dev/null | head -1);"
        ' echo PLANTED > "$d/planted.txt" 2>/dev/null; true\'\n',
        encoding="utf-8",
    )
    monkeypatch.chdir(bound)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    bundle = _runs(bound)[-1]
    assert (bundle / "planted.txt").is_file(), "the attack did not land"
    digests = json.loads((bundle / "digests.json").read_text("utf-8"))
    assert "planted.txt" in digests["files"], (
        "the planted file is OUTSIDE the seal, which would make the audit "
        "below a real detection — if that is now true, this test should be "
        "rewritten to assert the detection"
    )
    assert cli.main(["audit", str(bundle)]) == cli.EXIT_OK, (
        "audit refused a planted file. That would be an improvement, and it "
        "would mean SECURITY.md's 'nothing before the seal is covered' is no "
        "longer the right sentence"
    )


def test_a_COMMENT_is_not_part_of_the_check(bound):
    """**Found by attacking this module, 2026-08-22.**

    `sh -c "true" # decoy.py` recorded `coverage: command-and-files` and
    hashed `decoy.py` — a filename the shell never reads. A row claiming to
    have compared a check when it compared something the check cannot touch
    is the defect class this repository exists to catch, appearing inside the
    module written to catch it.
    """
    (bound / "decoy.py").write_text("print(1)\n", encoding="utf-8")
    identity = checks.identity_of("g", 'sh -c "true" # decoy.py', bound)
    assert identity.files == {}, (
        f"a filename in a COMMENT was hashed as if it were the check: "
        f"{identity.files}"
    )
    assert identity.coverage == checks.COVERAGE_COMMAND_ONLY
    # And the real thing still resolves, so the fix did not just switch it off.
    real = checks.identity_of("g", "python3 acceptance/recent.py", bound)
    assert list(real.files) == ["acceptance/recent.py"]


def test_the_MUTATE_AND_RESTORE_limit_is_stated_where_the_record_travels():
    """A gate can edit its check, run the edit, and put the original back.

    This module cannot see that — it records what the checker was when the
    bundle was written, which is after the gates ran. The limit ships INSIDE
    the record rather than in a spec nobody opens, because "the checker under
    trust" reads far stronger than it is without it.
    """
    assert checks.MUTATE_AND_RESTORE_LIMIT in checks.LIMITS
    said = " ".join(checks.MUTATE_AND_RESTORE_LIMIT.split())
    assert "after the gates ran" in said
    assert "puts the original back" in said


def test_no_string_from_the_REPOSITORY_reaches_the_board_as_markup(
    bound, monkeypatch
):
    """The spec, the criteria and the check's own output are all attacker
    input — a repository writes every one of them.

    The `<details>` block F14 introduced makes this sharper than it was: a
    check that prints `</details><script>` would break out of the collapsed
    block if the output were not escaped. Measured, both ways.
    """
    from wringer_board import read as board_read
    from wringer_board import render as board_render

    (bound / "wringer.spec.yaml").write_text(
        SPEC.replace(
            "The most recently played comes first",
            "<script>alert(3)</script> and <b>bold</b>",
        ).replace("The cabinet remembers", "</h1><script>alert(1)</script>"),
        encoding="utf-8",
    )
    (bound / ".wringer.yaml").write_text(
        "version: 1\ngates:\n  - id: recent\n    run: >-\n"
        "      sh -c 'printf \"</details><script>alert(9)</script>\\n\" >&2; exit 1'\n"
        "    proves: recent-first\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(bound)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED

    page = board_render.render(board_read.read(bound))
    for payload in (
        "<script>alert(1)",
        "<script>alert(3)",
        "</details><script>",
    ):
        assert payload not in page, f"{payload!r} reached the board as markup"
    assert "&lt;script&gt;" in page, "nothing was escaped at all — check the probe"
