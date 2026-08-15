"""The witness lane — SPEC_GATEGEN_V0 §6, W1–W10.

**What this file is really guarding.** The corpus run measured the declared
gates at `gates_vacuous` on 13 of 13 tasks and `wring deliver` said yes to 26
of 26 rows including every wrong change. The witness exists so that a criterion
can be evidenced by a check that was demonstrated able to fail. Every test
below is about one of the three things that makes such a check worth anything:
it pre-dates the work, it is pinned, and its red was for the right reason.

The last of those is where this lane can most easily lie to itself, so it has
the most tests.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wringer import witness


def make(source: str, criterion: str = "sum") -> witness.Witness:
    return witness.Witness(criterion=criterion, source=source)


ASSERTING = "def test_it():\n    assert 1 == 2\n"
PASSING = "def test_it():\n    assert 1 == 1\n"
MISSING_IMPORT = "import no_such_module_xyz\n\ndef test_it():\n    assert True\n"
BODY_IMPORT = (
    "def test_it():\n"
    "    import no_such_module_xyz\n"
    "    assert no_such_module_xyz.thing() == 1\n"
)
SYNTAX = "def test_it(:\n"
NOTHING = "# no tests here\n"


# --- W8: red for the RIGHT reason -------------------------------------------


def test_a_witness_that_fails_on_an_assertion_is_a_proved_red(tmp_path):
    result = witness.execute(tmp_path, make(ASSERTING))
    assert result.outcome == witness.ASSERTION
    assert result.exit_code == 1


def test_a_witness_the_runner_cannot_load_is_not_a_proved_red(tmp_path):
    """**The hole this closes**, and it is not hypothetical: `accept.py`'s own
    call-site comment records *"four criteria came back `evidenced` on the
    strength of an import error."*

    A model that has never seen the source writes a check importing a
    plausible-sounding symbol. It is red on the pre-change tree for
    `ModuleNotFoundError`, gets pinned, and turns green the moment the worker
    creates any file of that name with any content.
    """
    result = witness.execute(tmp_path, make(MISSING_IMPORT))
    assert result.outcome == witness.COLLECTION_ERROR

    item = make(MISSING_IMPORT)
    witness.prove_red(tmp_path, item)
    assert not item.usable
    assert "could not collect" in (item.discarded or "")


def test_an_import_INSIDE_the_test_body_is_caught_too(tmp_path):
    """**The half an exit code cannot see, and the one this lane's own first
    draft got wrong.**

    A module-level import error is exit 2. An import inside the test body
    collects fine and fails at exit 1 — indistinguishable from a real assertion
    by exit code alone — while carrying exactly the property W8 refuses: it
    turns green the moment any file of that name exists with any content.

    The first draft of the authoring instruction actually *told* the author to
    move imports into the body in order to avoid collection errors, which would
    have converted every witness W8 discards into one it accepts. Found by
    driving the lane rather than by reading it.

    The discriminator is the exception CLASS off the runner's own report
    object, which is a fact the runner states about its run — not the failure
    message, whose auto-classification `vacuity.py:39-44` refuses by name.
    """
    result = witness.execute(tmp_path, make(BODY_IMPORT))

    assert result.exit_code == 1, (
        "the premise of this test is that the exit code looks like an "
        "assertion; if that changed, the guard below is measuring nothing"
    )
    assert result.outcome == witness.COLLECTION_ERROR


def test_the_author_is_not_told_to_hide_imports_in_the_body():
    """The instruction and the guard have to agree, or the guard is a tax on
    an author doing what it was asked. Asserted on the shipped text, because
    that is what the model actually receives."""
    instruction = witness.AUTHOR_INSTRUCTION.lower()
    assert "import inside the test body" not in instruction
    assert "wherever it happens" in instruction


def test_a_real_assertion_about_a_missing_attribute_is_still_a_red(tmp_path):
    """The other direction, and it is why `AttributeError` is NOT on the
    load-failure list: a missing attribute is frequently a real behavioural
    failure, and a guard that claims more than it can tell would discard
    honest witnesses."""
    source = (
        "class Thing:\n"
        "    pass\n"
        "\n"
        "def test_it():\n"
        "    assert Thing().total() == 6\n"
    )
    result = witness.execute(tmp_path, make(source))
    assert result.outcome == witness.ASSERTION


def test_a_born_green_witness_is_discarded(tmp_path):
    item = make(PASSING)
    witness.prove_red(tmp_path, item)
    assert not item.usable
    assert "born green" in (item.discarded or "")


@pytest.mark.parametrize(
    "source,label", [(SYNTAX, "a syntax error"), (NOTHING, "no tests at all")]
)
def test_anything_that_is_not_a_collected_failure_claims_less(
    tmp_path, source, label
):
    """Conservative by construction: an outcome nobody anticipated is not a
    proved red."""
    item = make(source)
    witness.prove_red(tmp_path, item)
    assert not item.usable, label


def test_the_classification_is_structural_and_exhaustive():
    """Read off the runner's exit code, never off its message. Measured on
    this machine: 1 failed, 2 import or syntax error, 5 nothing collected."""
    assert witness.classify(0) == witness.GREEN
    assert witness.classify(1) == witness.ASSERTION
    assert witness.classify(1, frozenset({"ImportError"})) == (
        witness.COLLECTION_ERROR
    )
    assert witness.classify(2) == witness.COLLECTION_ERROR
    assert witness.classify(5) == witness.COLLECTION_ERROR
    # An exit code nobody planned for.
    assert witness.classify(99) == witness.COLLECTION_ERROR


# --- W4: the pin ------------------------------------------------------------


def test_the_pin_covers_bytes_command_and_path():
    """Pinning bytes alone would let a worker rewrite the command to `true`
    while the file stayed byte-identical — the forgery this rejects, one field
    over."""
    pinned = witness.pin(make(ASSERTING), "run-1")
    assert set(pinned) == {"sha256", "run", "path", "command"}
    assert pinned["path"].startswith(witness.MATERIAL_DIRNAME)


@pytest.mark.parametrize("field", ["sha256", "command", "path"])
def test_a_mismatch_in_any_pinned_element_voids(field):
    """One test per element, each mutating one and watching the run refuse.
    A pin covering three things needs three demonstrations."""
    item = make(ASSERTING)
    pinned = witness.pin(item, "run-1")
    pinned[field] = "something-else"

    with pytest.raises(witness.WitnessError) as caught:
        witness.check_pin(item, pinned)
    assert "VOID" in str(caught.value)


def test_an_untouched_pin_passes():
    item = make(ASSERTING)
    witness.check_pin(item, witness.pin(item, "run-1"))


# --- W4: materialisation ----------------------------------------------------


def test_materialisation_refuses_a_symlink(tmp_path):
    """Left unspecified, a symlink planted at this path makes the write land
    elsewhere and the cleanup delete something else."""
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (tmp_path / witness.MATERIAL_DIRNAME).symlink_to(elsewhere)

    with pytest.raises(witness.WitnessError) as caught:
        witness.materialise(tmp_path, make(ASSERTING))
    assert "symlink" in str(caught.value)


def test_materialisation_refuses_to_overwrite(tmp_path):
    item = make(ASSERTING)
    witness.materialise(tmp_path, item)
    with pytest.raises(witness.WitnessError) as caught:
        witness.materialise(tmp_path, item)
    assert "will not overwrite" in str(caught.value)


def test_cleanup_removes_the_runners_own_litter(tmp_path):
    """**A bug found by driving this rather than reading it.** The runner
    writes `__pycache__` beside the witness; a per-entry `unlink` raises
    `IsADirectoryError` on it, which a tolerant `except OSError` then swallows
    — so the directory survived and the NEXT run refused to overwrite it. A
    cleanup that fails silently plus a materialisation that refuses to
    overwrite is a lane that works exactly once.
    """
    witness.execute(tmp_path, make(ASSERTING))
    assert not (tmp_path / witness.MATERIAL_DIRNAME).exists()

    # And again, which is the case that actually broke.
    result = witness.execute(tmp_path, make(ASSERTING))
    assert result.outcome == witness.ASSERTION


# --- W2: the author, and what it is told ------------------------------------


def test_the_authoring_instruction_carries_W10():
    """A witness may not pick WHERE the fix lives. Measured rather than
    theorised: the calibration's single catch was location-luck — upstream
    escaped in `format_completion`, the agent escaped in the generated zsh
    script, and the criterion never said where it belonged. Under W10 the
    honest score for that stop condition is 0.
    """
    instruction = witness.AUTHOR_INSTRUCTION
    assert "INTERFACE THE CRITERION NAMES" in instruction
    assert "Do not choose where the fix should live" in instruction


def test_the_author_never_sees_upstream_or_a_held_out_test():
    """The isolation clause, asserted on what is actually sent."""
    request = witness.render_request(
        "the total of an empty list is 0", "sum", "m", 2000, "calc.py\n"
    )
    body = json.dumps(request).lower()
    for forbidden in ("upstream", "held-out", "held out", "the true fix"):
        assert forbidden not in body, forbidden


def test_a_fenced_reply_is_accepted_and_an_empty_one_is_not():
    fenced = {"choices": [{"message": {"content": "```python\nx = 1\n```"}}]}
    assert witness.parse_response(fenced).strip() == "x = 1"

    for empty in ({"choices": []}, {"choices": [{"message": {"content": "  "}}]}):
        with pytest.raises(witness.WitnessError):
            witness.parse_response(empty)


# --- W5: what the worker is told --------------------------------------------


def test_the_brief_carries_the_failure_and_never_the_source(tmp_path):
    """Name-only, on the precedent human criteria set: they appear in the
    brief by id ALONE with guidance withheld."""
    item = make(ASSERTING)
    witness.prove_red(tmp_path, item)
    section = "\n".join(witness.brief_section([item]))

    assert "`sum`" in section
    assert "assert 1 == 2" not in section, "the brief leaked the witness source"
    assert witness.MATERIAL_DIRNAME not in section, "the brief leaked the path"
    assert "-m pytest" not in section, "the brief leaked the command"


def test_a_discarded_witness_is_absent_from_the_brief(tmp_path):
    """A witness that proves nothing must not be described to the worker as
    something to make pass — that is a demand with no evidence behind it."""
    item = make(PASSING)
    witness.prove_red(tmp_path, item)
    assert witness.brief_section([item]) == []


# --- the record and its limits ----------------------------------------------


def test_the_record_refuses_bytes_that_do_not_match_the_authored_digest(tmp_path):
    """The authored-to-pinned window is unprotected — `wring spec` has no
    hash-chained ledger — and this is what closes it as far as it can be
    closed."""
    directory = tmp_path / witness.WITNESS_DIRNAME
    directory.mkdir(parents=True)
    (directory / "test_witness_sum.py").write_text(ASSERTING, encoding="utf-8")
    (directory / witness.WITNESS_FILENAME).write_text(
        json.dumps({
            "schema_version": witness.SCHEMA_VERSION,
            "witnesses": [{
                "id": "w-sum", "proves": "sum", "path": "test_witness_sum.py",
                "authored": {"sha256": "0" * 64},
            }],
        }),
        encoding="utf-8",
    )
    with pytest.raises(witness.WitnessError) as caught:
        witness.load(tmp_path)
    assert "digest its author recorded" in str(caught.value)


def test_absence_is_absence(tmp_path):
    """A repository with no witness lane gets an empty list, and every
    downstream behaviour is byte for byte what it was."""
    assert witness.load(tmp_path) == []


def test_the_limits_never_claim_the_witness_catches_wrong_fixes():
    """**Q1's ceiling, and no artifact anywhere may exceed it.** A witness
    proves the stated criterion could fail and was made to pass; it does not
    certify agreement with an unstated intended fix."""
    joined = " ".join(witness.LIMITS).lower()

    assert "does not certify agreement" in joined
    assert "not sufficient" in joined
    assert "tamper-evident" in joined
    for claim in (
        "catches wrong fixes",
        "catches wrong changes",
        "delivery is safe",
        "proves the change is correct",
        "guarantees",
    ):
        assert claim not in joined, claim
