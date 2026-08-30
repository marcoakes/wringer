"""The coverage number — docs/specs/SPEC_COVERAGE_V0.md.

**The field case this exists for.** On run 2's delivered board, 5 of 8
requirements had no check at all, and the defect that run existed to fix
landed exactly on one of the unwatched ones
(`docs/field-report-2026-08-28-run2.md`). Nothing anywhere carried that as a
number: `acceptance.json` held it per row, every surface counted STATES, and
"how much of what we asked for is anybody watching" was a question a person
answered by reading eight rows and doing arithmetic.

**Ruling MR1 is the thing most of this file guards: two debts, two lines,
never blended.** A single number over both populations points nowhere — the
remedy for the first is to write a check and the remedy for the second is to
declare what a person should be shown, and those are different jobs done by
different people.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wringer import accept, coverage


def row(ident, title, state, gate=None, witness=None):
    return {
        "criterion": ident,
        "title": title,
        "required": True,
        "state": state,
        "gate": gate,
        "command": "true" if gate else None,
        "receipt": None,
        "reason": "",
        "refuses": False,
        "witness": witness,
        "cause": None,
        "demonstrated_able_to_fail": None,
        "judgement": None,
    }


MIXED = [
    row("bound", "The export downloads a CSV", accept.EVIDENCED, gate="check"),
    row("unbound", "The columns are in the order asked for", accept.UNEVIDENCED),
    row("also-unbound", "A large export does not time out", accept.UNEVIDENCED),
    row("shown", "A reader can tell at a glance what to fix", accept.HUMAN),
    row("unshown", "The page still looks right", accept.HUMAN),
]
SHOW = {"shown": "cat SUMMARY.txt"}


# --- MR1: two debts, two lines, never blended -----------------------------


def test_MR1_the_two_numbers_are_SEPARATE_SENTENCES():
    said = coverage.lines(coverage.assess(MIXED, SHOW))
    numbers = [one for one in said if "requirement" in one and " of " in one]
    assert len(numbers) == 2, said
    assert "1 of 3 requirements carry a check that can prove them." in numbers[0]
    assert (
        "1 of 2 requirements that need a person have something to show them."
        in numbers[1]
    )


def test_MR1_the_populations_are_DISJOINT_and_together_are_everything():
    """A requirement only a person can settle can never carry a check — that
    is what the marking means — so counting it in the binding line would make
    that number permanently unreachable and blend the two debts in one
    stroke."""
    measured = coverage.assess(MIXED, SHOW)
    assert len(measured.checkable) == 3
    assert len(measured.people) == 2
    assert len(measured.checkable) + len(measured.people) == len(MIXED)
    assert not (
        {one.criterion for one in measured.checkable}
        & {one.criterion for one in measured.people}
    )


def test_a_line_APPEARS_ONLY_WHEN_ITS_POPULATION_EXISTS():
    """A sentence reading "0 of 0" is a caveat over a clean record, which is
    how a reader learns to skip caveats — the same rule `accept.disclosure`
    already keeps about its warning."""
    only_checks = coverage.lines(coverage.assess([MIXED[0]], {}))
    assert not any("need a person" in one for one in only_checks), only_checks

    only_people = coverage.lines(coverage.assess([MIXED[3]], SHOW))
    assert not any("carry a check" in one or "carries a check" in one
                   for one in only_people), only_people


def test_the_number_reads_as_a_sentence_somebody_wrote(tmp_path):
    """**Both wrong versions were rendered by a real run before this passed.**

    Keying the verb off the COUNT gives "1 of 3 requirements carries"; keying
    the verb off one and the pronoun off the other gives "0 of 1 requirement
    that needs a person have something to show them", which is what a scratch
    repository actually printed. Agreement follows the population, which is
    one rule and is the wording the ruling itself uses.
    """
    one = coverage.lines(coverage.assess([MIXED[0], MIXED[3]], {}))
    assert "1 of 1 requirement carries a check that can prove it." in one[0]
    assert (
        "0 of 1 requirement that needs a person has something to show it."
        in one[1]
    )

    many = coverage.lines(coverage.assess(MIXED, SHOW))
    assert "1 of 3 requirements carry a check that can prove them." in many[0]


# --- what counts as covered ------------------------------------------------


def test_a_WITNESS_that_covers_counts_and_a_DISCARDED_one_does_not():
    """The same rule `accept.WitnessEvidence.covers` states, read off the
    record — because the callers here hold bytes and never a `Row`. A second
    definition of "does anything watch this" is the drift the whole module is
    written against.

    **Both halves, separately, and the first version tested neither.** The
    rule is `discarded is None AND proved_red == "assertion"`, and the
    original fixture tripped both at once — so reverting either half left the
    guard green. A witness that was discarded covers nothing however it went
    red, and a witness that was never red for the right reason covers nothing
    however clean its record is.
    """
    good = row("w", "Witnessed", accept.EVIDENCED,
               witness={"pinned_sha256": "x", "proved_red": "assertion",
                        "result": "passed"})
    discarded = row("d", "Discarded", accept.UNEVIDENCED,
                    witness={"pinned_sha256": "x", "proved_red": "assertion",
                             "result": "not_run",
                             "discarded": "it proved nothing"})
    never_red = row("g", "Never red", accept.UNEVIDENCED,
                    witness={"pinned_sha256": "x", "proved_red": "green",
                             "result": "passed"})
    measured = coverage.assess([good, discarded, never_red], {})
    assert measured.covered == 1
    assert [one.title for one in measured.unwatched] == ["Discarded", "Never red"]


def test_a_v1_record_with_no_witness_key_at_all_is_read_without_error():
    """v1 records omit `witness` entirely — a v1 record is only written when
    there was none — and they are published, valid and read for ever."""
    bare = {"criterion": "a", "title": "A", "required": True,
            "state": accept.UNEVIDENCED, "gate": None, "command": None,
            "receipt": None, "reason": "", "refuses": False}
    measured = coverage.assess([bare], {})
    assert measured.covered == 0
    assert len(measured.checkable) == 1


def test_a_requirement_of_the_wrong_kind_is_asked_NEITHER_question():
    """`covered` is meaningless for a requirement only a person can settle and
    `shown` is meaningless for every other one, so each is None rather than
    False where it does not apply. **False is a debt somebody could pay; None
    is a question nobody asked**, and collapsing those is how a record lies."""
    measured = coverage.assess(MIXED, SHOW)
    checks = {one.criterion: one for one in measured.requirements}
    assert checks["bound"].shown is None and checks["bound"].covered is True
    assert checks["shown"].covered is None and checks["shown"].shown is True


def test_a_repository_with_no_requirements_gets_NO_number():
    assert coverage.assess([], {}) is None
    assert coverage.assess(None, {}) is None
    assert coverage.lines(None) == []


# --- the claim ceiling, and where it lives --------------------------------


def test_THE_CEILING_RIDES_ON_EVERY_SURFACE_THAT_CARRIES_THE_NUMBER():
    """One plain sentence, and it is the honest reading of what was counted:
    a BINDING, which is a declaration somebody made, and not a measurement of
    how much of the requirement that check exercises."""
    said = coverage.lines(coverage.assess(MIXED, SHOW))
    assert coverage.LIMIT in said
    assert "wring health" in coverage.LIMIT
    assert coverage.LIMIT in coverage.assess(MIXED, SHOW).as_json()["limits"]


def test_the_two_sentences_carry_NO_HOUSE_JARGON():
    """They are read on the board by somebody who was never taught these
    words. The list is the board's own, from `test_refusals.py`."""
    said = " ".join(coverage.lines(coverage.assess(MIXED, SHOW))).lower()
    for word in ("criterion", "criteria", "unevidenced", "evidenced",
                 "vacuity", "witness", "red-first", "gate-did-not-run",
                 "acceptance.json", "exit code"):
        assert word not in said, f"{word!r} reaches a PM: {said!r}"


def test_the_unshown_ones_are_NAMED_and_not_only_counted():
    said = " ".join(coverage.lines(coverage.assess(MIXED, SHOW)))
    assert "The page still looks right" in said
    assert "A reader can tell at a glance what to fix" not in said, (
        "a requirement that DOES have something to show it is being listed as "
        "a debt"
    )


def test_the_markdown_keeps_the_two_numbers_in_SEPARATE_PARAGRAPHS():
    """**The separator is load-bearing, not cosmetic.** Consecutive `> ` lines
    are one paragraph in every markdown renderer, so the first draft put the
    two numbers on a single rendered line — which is MR1's blending arriving
    through the formatting rather than through the arithmetic."""
    quoted = coverage.quoted(coverage.assess(MIXED, SHOW))
    body = "\n".join(quoted)
    first = body.index("carry a check")
    second = body.index("need a person")
    assert "\n>\n" in body[first:second], body


# --- the record ------------------------------------------------------------


def test_the_record_round_trips_through_of(tmp_path):
    """`of` exists so `lines` has ONE input shape. A second renderer reading
    the JSON directly is the two-implementations drift this module is about."""
    measured = coverage.assess(MIXED, SHOW)
    coverage.write(tmp_path, measured)
    again = coverage.of(coverage.read(tmp_path))
    assert coverage.lines(again) == coverage.lines(measured)


def test_a_record_from_a_version_that_never_wrote_one_is_ABSENT_NOT_ZERO(tmp_path):
    assert coverage.read(tmp_path) is None
    assert coverage.of(None) is None
    assert coverage.lines(coverage.of(coverage.read(tmp_path))) == []


def test_an_unknown_version_is_not_read_as_this_one(tmp_path):
    (tmp_path / coverage.COVERAGE_FILENAME).write_text(
        json.dumps({"schema_version": "wringer.coverage.v9", "requirements": []}),
        encoding="utf-8",
    )
    assert coverage.read(tmp_path) is None


def test_the_record_matches_its_published_schema(tmp_path):
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads(
        (Path(__file__).resolve().parents[1] / "schema"
         / "coverage-v1.schema.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(coverage.assess(MIXED, SHOW).as_json(), schema)


def test_the_declared_command_is_SCRUBBED_on_the_way_into_the_record(tmp_path):
    """`show:` holds a command somebody wrote, and a command can carry
    anything a person put in it."""
    from wringer.redact import Redactor

    redactor = Redactor(secrets=("sekrit-value",))
    measured = coverage.assess(MIXED, {"shown": "echo sekrit-value"})
    coverage.write(tmp_path, measured, redactor=redactor)
    written = (tmp_path / coverage.COVERAGE_FILENAME).read_text(encoding="utf-8")
    assert "sekrit-value" not in written, written


# --- MR2: a WARNING at plan time, by name, and never a refusal ------------


class _Criterion:
    def __init__(self, ident, title, human):
        self.id, self.title, self.human = ident, title, human


PLANNED = [
    _Criterion("bound", "The export downloads a CSV", False),
    _Criterion("shown", "A reader can tell at a glance what to fix", True),
    _Criterion("unshown", "The page still looks right", True),
]


def test_MR2_the_plan_warns_BY_NAME_about_what_nothing_will_show():
    warned = " ".join(coverage.plan_warning(PLANNED, SHOW))
    assert "unshown" in warned and "The page still looks right" in warned
    assert "shown" not in warned.replace("unshown", ""), warned
    assert "`show:`" in warned


def test_MR2_IT_IS_A_WARNING_AND_SAYS_SO():
    """**No refusal, and the reason is a body count that does not exist yet.**

    The only place this has hurt anybody is at the pen, and the pen now speaks
    in capitals. A plan-time refusal would stop work over a file the person
    can write at any moment up to the judgement, and this project does not add
    a refusal without somebody having been hurt DESPITE the warning.
    """
    warned = " ".join(coverage.plan_warning(PLANNED, SHOW))
    assert "warning, not a refusal" in warned, warned


def test_a_plan_with_nothing_missing_warns_about_NOTHING():
    assert coverage.plan_warning(PLANNED, {"shown": "a", "unshown": "b"}) == []
    assert coverage.plan_warning([PLANNED[0]], {}) == []


# --- every surface the counts already travel on ---------------------------


CONFIG = """\
version: 1
gates:
  - id: check
    run: "true"
    proves: bound
show:
  shown: "echo the thing being judged"
"""

SPEC = """\
schema_version: wringer.spec.v1
approved: true
title: The feature
intent: Ship it.
tasks:
  - id: build
    brief: Build it
    objective: It exports.
criteria:
  - id: bound
    title: The export downloads a CSV
    required: true
  - id: unbound
    title: The columns are in the order asked for
    required: true
  - id: shown
    title: A reader can tell at a glance what to fix
    required: true
    human: true
  - id: unshown
    title: The page still looks right
    required: true
    human: true
"""


@pytest.fixture()
def measured_repo(tmp_path, monkeypatch):
    """A repository whose coverage is deliberately mixed, verified once."""
    import subprocess

    from wringer import cli

    for name, body in ((".wringer.yaml", CONFIG), ("wringer.spec.yaml", SPEC)):
        (tmp_path / name).write_text(body, encoding="utf-8")
    (tmp_path / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    (tmp_path / "feature.py").write_text("x = 1\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q", "-b", "main", str(tmp_path)], check=True)
    monkeypatch.chdir(tmp_path)
    cli.main(["verify"])
    return tmp_path


def _run(repo: Path) -> Path:
    return sorted((repo / ".wringer" / "runs").iterdir())[-1]


def test_THE_RUN_WRITES_THE_RECORD_BESIDE_THE_ACCEPTANCE_ONE(measured_repo):
    recorded = coverage.read(_run(measured_repo))
    assert recorded is not None
    assert recorded["counts"] == {
        "covered": 1, "checkable": 2, "shown": 1, "needing_a_person": 2,
    }


def test_THE_BUNDLE_SUMMARY_CARRIES_BOTH_NUMBERS(measured_repo):
    from wringer import summary as summary_module

    body = (_run(measured_repo) / summary_module.SUMMARY_FILENAME).read_text(
        encoding="utf-8"
    )
    for line in coverage.lines(coverage.of(coverage.read(_run(measured_repo)))):
        assert line in body, f"summary.md does not carry {line!r}"


def test_THE_BOARD_CARRIES_BOTH_NUMBERS_AND_KEEPS_THEM_APART(measured_repo):
    """**The fourth surface, and the one that must not blend them visually.**

    Every word comes from the engine's renderer — the board owns no wording
    for this — which is the same argument that admitted `accept` and `checks`
    through the layer seam.
    """
    from wringer_board import read as board_read
    from wringer_board import render as board_render

    page = board_render.render(board_read.read(measured_repo))
    body = page.split("</style>")[-1]

    assert "carry a check that can prove them" in body, body[:2000]
    assert "have something to show them" in body
    # Separate list items, so a reader meets two debts and not one number.
    assert body.count("<li><strong>") >= 2, body


def test_the_board_says_NOTHING_when_the_run_wrote_no_coverage(measured_repo):
    """Absence is absence — ruling 11 applied to an eighth family. A bundle
    from before this file existed is not a coverage of zero."""
    from wringer_board import read as board_read
    from wringer_board import render as board_render

    (_run(measured_repo) / coverage.COVERAGE_FILENAME).unlink()
    page = board_render.render(board_read.read(measured_repo))

    assert "carry a check that can prove" not in page
    assert "How much of it anybody is watching" not in page


def test_the_board_owns_NO_WORDING_of_its_own_for_this(measured_repo):
    """The sentences on the page are the engine's, character for character.
    A copy living in the board package is how the board and the merge request
    come to state different numbers for one run."""
    source = (
        Path(__file__).resolve().parents[1]
        / "src" / "wringer_board" / "render.py"
    ).read_text(encoding="utf-8")
    assert "carry a check" not in source, (
        "the board has its own copy of the engine's sentence"
    )
    assert "something to show them" not in source


# --- S4: an environment-faced red says so where a person reads ------------


ENV_CONFIG = """\
version: 1
gates:
  - id: lint
    run: "ruffle-that-does-not-exist check ."
    proves: bound
"""


def test_S4_A_RED_THE_ENVIRONMENT_CAUSED_SAYS_SO_IN_THE_SUMMARY(
    tmp_path, monkeypatch
):
    """**Field report 2026-08-28, finding 4.** The first `wring verify` of
    that run recorded `ruff: command not found` — the example's gates resolve
    only with the project's `.venv` on PATH. Documented behaviour, not a
    defect: the bundle says plainly that gates run with the whole environment
    inherited. What it is not is a red the requirement earned, and in the
    summary it was INDISTINGUISHABLE from one. It went into the record as one.
    """
    import subprocess

    from wringer import cli
    from wringer import summary as summary_module

    for name, body in ((".wringer.yaml", ENV_CONFIG), ("wringer.spec.yaml", SPEC)):
        (tmp_path / name).write_text(body, encoding="utf-8")
    (tmp_path / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q", "-b", "main", str(tmp_path)], check=True)
    monkeypatch.chdir(tmp_path)
    assert cli.main(["verify"]) != 0

    run = _run(tmp_path)
    body = (run / summary_module.SUMMARY_FILENAME).read_text(encoding="utf-8")

    assert "| lint | failed (maybe the environment)" in body, body
    assert "Some of these reds may not be yours" in body
    assert "ran a command that is not on PATH" in body
    # **The COMMAND, not the shell's phrasing.** This asserted "command not
    # found" and CI reddened the tag twice: macOS `/bin/sh` says that and
    # Linux's dash says "not found". The engine's own face was right either
    # way — it comes from exit 127 — and the portable fact about the quoted
    # line is that it names the command nobody could find. THE MACHINE IS A
    # VARIABLE, and a local bar on one operating system is not a measurement
    # of both.
    assert "ruffle-that-does-not-exist" in body, (
        "the line the guess was read from is missing"
    )


def test_S4_IT_IS_A_GUESS_AND_THE_SURFACE_SAYS_SO(tmp_path, monkeypatch):
    """Hint tier — SPEC_ENV ruling 1, *a classification may ROUTE and may
    never CLAIM*. The word "guess" is in the section's own first sentence
    rather than in a footnote."""
    import subprocess

    from wringer import cli
    from wringer import summary as summary_module

    for name, body in ((".wringer.yaml", ENV_CONFIG), ("wringer.spec.yaml", SPEC)):
        (tmp_path / name).write_text(body, encoding="utf-8")
    (tmp_path / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q", "-b", "main", str(tmp_path)], check=True)
    monkeypatch.chdir(tmp_path)
    cli.main(["verify"])

    body = (_run(tmp_path) / summary_module.SUMMARY_FILENAME).read_text(
        encoding="utf-8"
    )
    section = body.split("Some of these reds may not be yours")[1]
    assert "A guess" in section.split("\n\n")[1], section[:400]
    assert "decided nothing here" in section


def test_S4_IT_CHANGES_NO_OUTCOME(tmp_path, monkeypatch):
    """**The whole licence for reading text is that nothing it returns
    decides anything.** The gate is red either way, the exit code is the same,
    and the acceptance row is the same — so the control is a run whose gate
    fails ORDINARILY, compared against one that fails on a missing command.
    """
    import subprocess

    from wringer import accept, cli

    ordinary = ENV_CONFIG.replace(
        "ruffle-that-does-not-exist check .", "sh -c 'exit 3'"
    )
    outcomes = {}
    for name, config_body in (("env", ENV_CONFIG), ("ordinary", ordinary)):
        where = tmp_path / name
        where.mkdir()
        (where / ".wringer.yaml").write_text(config_body, encoding="utf-8")
        (where / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
        (where / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
        subprocess.run(["git", "init", "-q", "-b", "main", str(where)], check=True)
        monkeypatch.chdir(where)
        code = cli.main(["verify"])
        rows = accept.read(_run(where))["criteria"]
        outcomes[name] = (
            code,
            {one["criterion"]: (one["state"], one["refuses"]) for one in rows},
        )

    assert outcomes["env"] == outcomes["ordinary"], (
        "the environment guess changed an outcome — it is a hint tier and it "
        "may route, never claim"
    )


def test_S4_A_RED_THE_REQUIREMENT_EARNED_GETS_NO_MARK(tmp_path, monkeypatch):
    """The control for the mark. A gate that ran and failed on its own terms
    must not be labelled as maybe-the-environment, or the label means nothing
    and a reader learns to skip it."""
    import subprocess

    from wringer import cli
    from wringer import summary as summary_module

    (tmp_path / ".wringer.yaml").write_text(
        ENV_CONFIG.replace("ruffle-that-does-not-exist check .", "sh -c 'exit 3'"),
        encoding="utf-8",
    )
    (tmp_path / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (tmp_path / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q", "-b", "main", str(tmp_path)], check=True)
    monkeypatch.chdir(tmp_path)
    cli.main(["verify"])

    body = (_run(tmp_path) / summary_module.SUMMARY_FILENAME).read_text(
        encoding="utf-8"
    )
    assert "maybe the environment" not in body, body
    assert "Some of these reds may not be yours" not in body


def test_S4_THE_BOARD_CARD_CARRIES_THE_ENVIRONMENT_GUESS(tmp_path, monkeypatch):
    """**The other half of S4: the surface a non-engineer actually opens.**

    `summary.md` is read by whoever reviews a bundle. The board is read by
    whoever asked for the work, and until now only the LOOP wrote
    `diagnosis.json` while the board reads the RUN bundle — so this page could
    never show the guess at all.

    The sentence is the engine's, from `diagnose.DESCRIPTIONS`, because
    `wringer.diagnosis.v1` is frozen and `additionalProperties: false` and
    cannot carry it. A table translating faces inside the board package would
    be the drift the layer seam exists to stop.
    """
    import subprocess

    from wringer import cli
    from wringer_board import read as board_read
    from wringer_board import render as board_render

    (tmp_path / ".wringer.yaml").write_text(ENV_CONFIG, encoding="utf-8")
    (tmp_path / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (tmp_path / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q", "-b", "main", str(tmp_path)], check=True)
    monkeypatch.chdir(tmp_path)
    cli.main(["verify"])

    page = board_render.render(board_read.read(tmp_path))
    body = page.split("</style>")[-1]

    assert "This red may not be about your work" in body, body[-3000:]
    assert "ran a command that is not on PATH" in body
    assert "That is a guess" in body, "the page does not say it is a guess"
    assert "red either way" in body


def test_S4_the_board_says_nothing_when_the_red_IS_the_requirements(
    tmp_path, monkeypatch
):
    """The control. A gate that failed on its own terms must carry no such
    block, or the block means nothing and a reader learns to skip it."""
    import subprocess

    from wringer import cli
    from wringer_board import read as board_read
    from wringer_board import render as board_render

    (tmp_path / ".wringer.yaml").write_text(
        ENV_CONFIG.replace("ruffle-that-does-not-exist check .", "sh -c 'exit 3'"),
        encoding="utf-8",
    )
    (tmp_path / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (tmp_path / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q", "-b", "main", str(tmp_path)], check=True)
    monkeypatch.chdir(tmp_path)
    cli.main(["verify"])

    page = board_render.render(board_read.read(tmp_path))
    assert "This red may not be about your work" not in page


def test_a_DISCARDED_witness_covers_nothing_however_it_went_red():
    """The other half of the witness rule, on its own, so reverting either
    half of `_covers` reddens something."""
    discarded = row("d", "Discarded", accept.UNEVIDENCED,
                    witness={"pinned_sha256": "x", "proved_red": "assertion",
                             "result": "not_run", "discarded": "proved nothing"})
    assert coverage.assess([discarded], {}).covered == 0


def test_S4_A_GUESS_ABOUT_A_GATE_NO_REQUIREMENT_OWNS_STILL_REACHES_THE_PAGE(
    tmp_path, monkeypatch
):
    """**The field case itself, and the card alone missed it.**

    In run 2's example the gate that printed `ruff: command not found` was
    `lint` — and `lint` is bound to no criterion. A card is keyed to a
    requirement, so the guess reached no card and the board said nothing at
    all about the one red the field report was about.

    There is no requirement to attach it to, so it goes in the block this page
    keeps engineers' facts in, in the engine's own words. Found by probing the
    new card against the case it was written for.
    """
    import subprocess

    from wringer import cli
    from wringer_board import read as board_read
    from wringer_board import render as board_render

    (tmp_path / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (tmp_path / ".wringer.yaml").write_text(
        "version: 1\ngates:\n  - id: check\n    run: \"true\"\n"
        "    proves: bound\n"
        "  - id: lint\n    run: \"ruffle-that-does-not-exist check .\"\n",
        encoding="utf-8",
    )
    (tmp_path / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q", "-b", "main", str(tmp_path)], check=True)
    monkeypatch.chdir(tmp_path)
    cli.main(["verify"])

    page = board_render.render(board_read.read(tmp_path))
    body = page.split("</style>")[-1]

    assert "is bound to no requirement" in body, body[-2500:]
    assert "ran a command that is not on PATH" in body
    assert "That is a guess" in body, "the page does not say it is a guess"


def test_S4_a_guess_about_a_gate_a_requirement_DOES_own_stays_on_its_card(
    tmp_path, monkeypatch
):
    """The control. A bound gate's guess belongs beside its requirement, not
    in the engineers' block — otherwise the fix above would have quietly moved
    every guess off the surface a non-engineer reads."""
    import subprocess

    from wringer import cli
    from wringer_board import read as board_read
    from wringer_board import render as board_render

    (tmp_path / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (tmp_path / ".wringer.yaml").write_text(ENV_CONFIG, encoding="utf-8")
    (tmp_path / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q", "-b", "main", str(tmp_path)], check=True)
    monkeypatch.chdir(tmp_path)
    cli.main(["verify"])

    body = board_render.render(board_read.read(tmp_path)).split("</style>")[-1]
    assert "This red may not be about your work" in body, body[-2000:]
    assert "is bound to no requirement" not in body


# --- the headline against the rows, on the record that travels -------------


def test_AN_EDITED_COVERAGE_COUNT_OVER_HONEST_ROWS_IS_CAUGHT():
    """The cheapest forgery there is, on the artifact the certificate quotes.

    `coverage.json` travels in every delivery and its two sentences are read
    aloud in `mr.md` and on the board. The certificate has guarded its own
    counts since 0.5.0; the sibling it quotes was unguarded.
    """
    from wringer import coverage as coverage_module

    honest = {
        "schema_version": coverage_module.SCHEMA_VERSION,
        "counts": {
            "covered": 1, "checkable": 2, "shown": 1, "needing_a_person": 1,
        },
        "requirements": [
            {"criterion": "a", "needs_a_person": False, "covered": True},
            {"criterion": "b", "needs_a_person": False, "covered": False},
            {"criterion": "c", "needs_a_person": True, "shown": True},
        ],
        "limits": [coverage_module.LIMIT],
    }
    assert coverage_module.check_counts(honest) is None

    forged = json.loads(json.dumps(honest))
    forged["counts"]["covered"] = 2
    said = coverage_module.check_counts(forged)
    assert said is not None and "covered" in said, said


def test_a_certificate_audit_reads_the_coverage_record_beside_it(tmp_path):
    """The claim reaches the STRANGER's command, which is the whole point:
    `wring audit certificate.json` is what a reviewer runs, and a sibling
    nothing checks is a sibling that can say anything."""
    from wringer import certificate as certificate_module
    from wringer import coverage as coverage_module

    payload = {
        "schema_version": coverage_module.SCHEMA_VERSION,
        "counts": {
            "covered": 9, "checkable": 1, "shown": 0, "needing_a_person": 0,
        },
        "requirements": [
            {"criterion": "a", "needs_a_person": False, "covered": True},
        ],
        "limits": [coverage_module.LIMIT],
    }
    (tmp_path / coverage_module.COVERAGE_FILENAME).write_text(
        json.dumps(payload), encoding="utf-8"
    )

    claims = certificate_module._check_coverage(tmp_path)

    assert [c.outcome for c in claims] == [certificate_module.BROKEN], claims
    # ...and a delivery that carries no coverage record claims nothing.
    assert certificate_module._check_coverage(tmp_path / "empty") == []

