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
import os
import re
import sys
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


@pytest.mark.parametrize(
    "depth", range(1, len(Path(witness.MATERIAL_DIRNAME).parts) + 1)
)
def test_materialisation_refuses_a_symlink_at_any_component(tmp_path, depth):
    """Left unspecified, a symlink planted on this path makes the write land
    elsewhere and the cleanup delete something else.

    **Parametrised over every component, because P4-3 made the path nested.**
    It was a single top-level `.wringer-witness/`, and a leaf-only check
    covered it. Under `.wringer/witness` a symlink at `.wringer` redirects the
    write exactly as one at `.wringer/witness` does, and `mkdir(parents=True)`
    follows it without a word. One case per component, so the guard cannot
    quietly cover fewer than it claims.
    """
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    planted = tmp_path.joinpath(*Path(witness.MATERIAL_DIRNAME).parts[:depth])
    planted.parent.mkdir(parents=True, exist_ok=True)
    planted.symlink_to(elsewhere)

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


def test_the_brief_carries_the_failure_and_never_the_path_or_command(tmp_path):
    """W5's two halves, and **the boundary moved on 2026-08-15 — deliberately,
    and this docstring is where that is recorded rather than in a diff nobody
    reads.**

    This test used to assert the brief contained no line of the witness at all,
    including `assert 1 == 2`. It passed — and it passed for the wrong reason.
    `_first_meaningful_line` returned pytest's progress bar, so the brief said

        - `sum` — F [100%]

    and of course that contains no source. The independent review found it
    (finding 6): W5's *"carries the failure"* half had no assertion behind it
    and was in fact not happening. A worker told `F [100%]` has been told that
    a check it cannot see failed, and nothing else. That is the brief F3 was
    written about, one layer up.

    **P4-5.1 rules the citation to be the assertion or error line out of the
    runner's own log**, which is what pytest calls the failure. So the line the
    worker gets is now the failure as pytest renders it — one line, capped at
    200 characters, one per criterion.

    What stays forbidden is unchanged and is what this now pins:

    - the **materialisation path** — pytest's short-summary line is
      `FAILED .wringer/witness/test_witness_sum.py::test_it - ...`, and a
      worker that learns that path can go and read the whole check;
    - the **filename**, for the same reason;
    - the **command**, which is what W4 pins so that it cannot become `true`;
    - the **file**. One rendered failure line is not the source: it says
      nothing about the check's structure, its other assertions, or what it
      does not test.

    The scrub is done in `_without_the_witness` rather than by trusting the
    choice of line, because "the line I picked happens not to contain the path"
    is not a property, it is a coincidence that holds until pytest changes its
    output.
    """
    item = make(ASSERTING)
    witness.prove_red(tmp_path, item)
    section = "\n".join(witness.brief_section([item]))

    assert "`sum`" in section
    # The failure IS carried — the half that was missing.
    assert "assert 1 == 2" in section, (
        "the brief no longer carries the failure, which is W5's other half and "
        "the one the review found unenforced"
    )
    assert witness.MATERIAL_DIRNAME not in section, "the brief leaked the path"
    assert item.filename not in section, "the brief leaked the filename"
    assert "-m pytest" not in section, "the brief leaked the command"
    # One line per criterion, so a longer failure cannot become the file.
    assert len([ln for ln in section.splitlines() if ln.startswith("- ")]) == 1


def test_the_citation_is_never_the_progress_bar(tmp_path):
    """**The review's finding 6, pinned so it cannot come back.**

    `pytest -q` prints `F  [100%]` as its first non-`=` line, and the first
    draft's *"first meaningful line"* returned exactly that — for the brief AND
    for `proved_red.first_line`, which W8 makes a MANDATORY citation. A
    mandatory citation that reads `F [100%]` is a field that is always present
    and never says anything, which is worse than an absent one: it looks like
    evidence.
    """
    item = make(ASSERTING)
    result = witness.prove_red(tmp_path, item)

    assert result.first_line, "the citation is empty"
    assert not re.fullmatch(r"[.FEsxXpuw]+\s*(\[\s*\d+%\])?", result.first_line), (
        f"the citation is pytest's progress bar again: {result.first_line!r}"
    )
    assert "assert 1 == 2" in result.first_line


def test_the_citation_prefers_the_error_line_over_earlier_noise(tmp_path):
    """A witness whose failure is an exception, not a bare assert: the
    citation must be the `E` line pytest marks as the failure, not the first
    stray line of a traceback."""
    raising = (
        "def test_it():\n"
        "    raise ValueError('the total was 5, expected 6')\n"
    )
    item = make(raising)
    result = witness.prove_red(tmp_path, item)

    assert "ValueError" in result.first_line
    assert "the total was 5, expected 6" in result.first_line


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
    directory = witness.store_dir(tmp_path)
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


# --- the independent review's HIGH findings, each with the guard it earned ---


def test_the_pin_is_compared_against_the_BYTES_ON_DISK(tmp_path):
    """**The review's first HIGH, and it was fatal to W4's whole claim.**

    `pin()` built its digest from the in-memory `Witness`; `check_pin()`
    compared that same object's digest back against it. Same field, same
    object — the comparison could not fail. The source was read from disk once,
    before the first worker turn, so every later "re-check" re-checked a value
    against itself, and a worker that rewrote the witness mid-loop passed:

        pinned sha:      9065b312e262
        on-disk sha now: e0d5bd480a37
        check_pin: PASSED

    W4's claim is that the bytes which RAN are the bytes that were PINNED. That
    is a claim about a file, so it is answered by reading the file.
    """
    directory = witness.store_dir(tmp_path)
    directory.mkdir(parents=True)
    item = make(ASSERTING)
    (directory / item.filename).write_text(ASSERTING, encoding="utf-8")
    pinned = witness.pin(item, "run-1")

    # Unchanged: passes.
    witness.check_pin(item, pinned, tmp_path)

    # The worker rewrites the witness on disk, which is what W4 says a worker
    # on the host can do.
    (directory / item.filename).write_text(PASSING, encoding="utf-8")

    with pytest.raises(witness.WitnessError) as caught:
        witness.check_pin(item, pinned, tmp_path)
    message = str(caught.value)
    assert "VOID" in message
    assert "on disk" in message


def test_a_witness_that_vanished_from_disk_voids_rather_than_passing(tmp_path):
    """The other half of the same defect: an unreadable file must not be a
    silent pass."""
    directory = witness.store_dir(tmp_path)
    directory.mkdir(parents=True)
    item = make(ASSERTING)
    pinned = witness.pin(item, "run-1")

    with pytest.raises(witness.WitnessError) as caught:
        witness.check_pin(item, pinned, tmp_path)
    assert "no longer readable" in str(caught.value)


def test_a_missing_binary_or_file_is_not_a_proved_red(tmp_path):
    """**The review's third HIGH, and W10 was steering authors into it.**

    W10 directs the author to exercise the INTERFACE the criterion names — a
    CLI, a shell completion, an endpoint. On a pre-change tree, a witness that
    shells out to a tool which does not exist yet raises `FileNotFoundError`,
    which the first draft classified as a real assertion. That failure has
    W8's defining property verbatim: it turns green the moment any binary of
    that name exists, with any content.
    """
    shelling_out = (
        "import subprocess\n"
        "\n"
        "def test_it():\n"
        "    done = subprocess.run(['wringer-no-such-tool', '--sum'],\n"
        "                          capture_output=True, text=True)\n"
        "    assert done.stdout.strip() == '6'\n"
    )
    result = witness.execute(tmp_path, make(shelling_out))
    assert result.exit_code == 1, "premise: this looks like an assertion"
    assert result.outcome == witness.COLLECTION_ERROR

    reading_a_file = (
        "import pathlib\n"
        "\n"
        "def test_it():\n"
        "    text = pathlib.Path('src/calc.py').read_text()\n"
        "    assert 'def total' in text\n"
    )
    assert witness.execute(tmp_path, make(reading_a_file)).outcome == (
        witness.COLLECTION_ERROR
    )


def test_an_image_without_pytest_is_LOUD_and_never_a_silent_discard(tmp_path):
    """**The review's fourth HIGH: the lane was inert in the one configuration
    the re-test needs.**

    `sys.executable` is a host path that does not exist inside the image, so
    the contained branch ran `/host/path/python -m pytest`, the shell exited
    127, and `classify` read that as `collection_error`. Every witness was
    silently discarded, every criterion reported uncovered, and the reason
    given was a witness defect — while the docstring claimed the lane ran
    inside the boundary.

    A criterion must never be reported uncovered for a reason that is not
    about the criterion.
    """
    assert witness.CONTAINED_RUNNER[0] == "python3", (
        "the contained runner is a host-absolute interpreter path again"
    )

    from wringer import config, containment

    parsed = config.parse({
        "version": 1,
        "gates": [{"id": "unit", "run": "true"}],
        "run": {
            "worker": "agent",
            "containment": {
                "runtime": "podman",
                "image": "example/image:tag",
                "egress": {"policy": "none"},
            },
        },
    })
    settings = parsed.run.containment
    established = containment.Established(
        runtime_path="/bin/podman", holder_cid=None, resolved=(),
    )

    # Driven through the real classification path with a runtime that is not
    # there, so the spawn fails exactly as a missing interpreter inside a real
    # image does: a 127 under containment is a configuration fault and must
    # raise rather than be classified as a witness defect.
    monkeypatched = witness.subprocess.run

    class _Done:
        returncode = 127
        stdout = ""
        stderr = "sh: python3: not found"

    witness.subprocess.run = lambda *a, **k: _Done()
    try:
        with pytest.raises(witness.WitnessError) as caught:
            witness.execute(
                tmp_path, make(ASSERTING),
                containment_settings=settings,
                established=established,
            )
    finally:
        witness.subprocess.run = monkeypatched
    message = str(caught.value)
    # **The refusal now arrives EARLIER and says more**, and the assertion moved
    # with it rather than being deleted. The 127 branch below `materialise`
    # still exists and still fires; what changed on 2026-08-16 is that the
    # runner is probed with `--version` BEFORE anything is materialised, so the
    # same configuration fault is caught before the tree is touched — and it
    # catches the sibling case 127 cannot see, where `python3` exists and pytest
    # does not (exit 1, which `classify` read as a genuine assertion).
    assert "pytest is not importable" in message
    assert "example/image:tag" in message, "the refusal does not name the image"
    assert "not about the criterion" in message


def test_the_lane_emits_no_event_the_frozen_ledger_schema_forbids():
    """**The review's second HIGH.** `loop.jsonl`'s `type` is a CLOSED enum of
    eight branches with `additionalProperties: false` on every one, so the
    first draft's `witness.pinned` and `witness.executed` made every bundle
    with a witness lane fail its own published, frozen schema.

    `loop.py` says this itself 375 lines above the offending calls, where it
    declines to add a containment event for exactly this reason, and W6 names
    the cost in advance: the pin event needs `loop-event-v3`. The facts live in
    the sibling `witness.json` instead, on the `vacuity.json` pattern, which
    costs no version at all.
    """
    import json as json_module

    source = (
        Path(__file__).resolve().parent.parent / "src" / "wringer" / "loop.py"
    ).read_text(encoding="utf-8")
    schema = json_module.loads(
        (
            Path(__file__).resolve().parent.parent
            / "schema" / "loop-event-v2.schema.json"
        ).read_text(encoding="utf-8")
    )

    declared = set(
        (schema.get("properties", {}).get("type", {}) or {}).get("enum", [])
    )
    for branch in schema.get("oneOf", []):
        enum = (branch.get("properties", {}).get("type", {}) or {}).get("enum")
        if enum:
            declared.update(enum)
    assert declared, "the loop-event schema declares no event types"

    emitted = set(re.findall(r'bundle\.event\(\s*\n?\s*"([^"]+)"', source))
    unknown = sorted(emitted - declared)
    assert not unknown, (
        f"loop.py emits event types the frozen `loop-event-v2` schema does not "
        f"admit: {unknown}. Every bundle carrying one fails its own published "
        "schema. A new event type costs `loop-event-v3` — put the fact in a "
        "sibling file instead, as `vacuity.json` and `witness.json` do"
    )


# --- P4-3: the bytes of record live outside every repository -----------------


def test_the_store_is_outside_the_repository_it_belongs_to(tmp_path):
    """**The measured failure, and the fix that closes it for BOTH arms.**

    On the first real corpus task the agent opened `.wringer/witness/…py` and
    rewrote it — replacing `pytest.warns(None)`, removed in pytest 8, with a
    `catch_warnings` block. Competent, helpful, and fatal: the pin caught it,
    the run VOIDed by name, and §5's void rule invalidates a whole pass at
    three such rows. An agent that tidies a file it finds in its own tree will
    do it on most tasks.

    W4's reasoning for `.wringer/` was right about the constraint and wrong
    about the destination: the pre-change worktree carries TRACKED files only,
    so the bytes may not live in the working tree — and a path outside the
    repository satisfies that better than a gitignored path inside it, while
    also being absent from the tree the agent was handed.
    """
    repo_root = tmp_path / "project"
    repo_root.mkdir()
    store = witness.store_dir(repo_root).resolve()

    assert not str(store).startswith(str(repo_root.resolve()) + os.sep), (
        f"the store {store} is inside the repository {repo_root}. That is the "
        "arrangement an agent tidied up, and it VOIDed the run"
    )


def test_the_store_is_deterministic_and_per_repository(tmp_path):
    """Same repository, same store, every time — and two repositories never
    share one, even when they have the same basename.

    Determinism is what lets `wring run` find what `wring spec --send
    --witness` wrote in an earlier process. Per-repository separation is what
    stops two checkouts of the same project from reading each other's
    witnesses, which would silently break the one-criterion-one-witness
    property the record is keyed on.
    """
    one = tmp_path / "a" / "project"
    two = tmp_path / "b" / "project"
    for path in (one, two):
        path.mkdir(parents=True)

    assert witness.store_dir(one) == witness.store_dir(one)
    assert witness.store_dir(one) != witness.store_dir(two), (
        "two repositories with the same basename resolved to one store"
    )
    # The basename is carried for a human reading `ls`; the digest is what
    # makes it unique. Both, or the directory is either unreadable or unsafe.
    assert witness.store_dir(one).name.startswith("project-")


def test_a_record_with_no_authored_digest_voids_rather_than_trusting_it(
    tmp_path,
):
    """**Fail CLOSED** (§6d item 7, closed by P4-5.7).

    The first draft read `if expected and expected != actual`, so a record with
    no `authored.sha256` skipped the comparison and the witness was trusted
    anyway. That is the one direction this check must never fail in: deleting a
    field is strictly easier than forging a digest, so a fail-open check is a
    check that anyone who can edit the record can switch off by removing a
    line.
    """
    directory = witness.store_dir(tmp_path)
    directory.mkdir(parents=True)
    (directory / "test_witness_sum.py").write_text(ASSERTING, encoding="utf-8")

    for authored in ({}, {"sha256": ""}):
        (directory / witness.WITNESS_FILENAME).write_text(
            json.dumps({
                "schema_version": witness.SCHEMA_VERSION,
                "witnesses": [{
                    "id": "w-sum", "proves": "sum",
                    "path": "test_witness_sum.py",
                    "authored": authored,
                }],
            }),
            encoding="utf-8",
        )
        with pytest.raises(witness.WitnessError) as caught:
            witness.load(tmp_path)
        message = str(caught.value)
        assert "no authored digest" in message
        assert "VOID" in message


# --- P4-1: a red witness is work to do ---------------------------------------


def test_an_unexecuted_usable_witness_counts_as_unconverted(tmp_path):
    """"Not yet measured" is not "converted", and the direction matters.

    The loop's continuation predicate reads this. Treating an unexecuted
    witness as green would fail open on the ONE check in the run that carries
    information about the change — it was proved red on the pre-change tree and
    nothing since has shown otherwise.
    """
    item = make(ASSERTING)
    witness.prove_red(tmp_path, item)
    assert item.usable
    assert witness.unconverted(item)


def test_a_discarded_witness_is_never_work_to_do(tmp_path):
    """A witness that proves nothing must not hold the loop open. It leaves
    the criterion uncovered and routes to a human, which is the honest
    outcome — spending worker turns on it would be demanding a repair with no
    evidence behind it."""
    item = make(PASSING)
    witness.prove_red(tmp_path, item)
    assert not item.usable
    assert not witness.unconverted(item)


def test_a_converted_witness_stops_being_work_and_leaves_the_brief(tmp_path):
    """The other end of the loop: once the tree makes the check pass, the
    criterion is done and the worker must not be told to fix it again."""
    item = make(ASSERTING)
    witness.prove_red(tmp_path, item)
    assert witness.brief_section([item]) != []

    item.executed = witness.execute(tmp_path, make(PASSING))
    assert item.executed.passed
    assert not witness.unconverted(item)
    assert witness.brief_section([item]) == []


def test_the_brief_quotes_the_CURRENT_failure_not_the_pre_change_one(tmp_path):
    """A worker on lap 3 needs what the check says about lap 3's tree.

    The born-red line is a fact about a tree three turns ago. Briefing it every
    lap would tell a worker that made real progress that nothing had changed.
    """
    item = make(ASSERTING)
    witness.prove_red(tmp_path, item)
    item.executed = witness.execute(
        tmp_path,
        make("def test_it():\n    raise ValueError('closer, but no')\n"),
    )

    section = "\n".join(witness.brief_section([item]))
    assert "closer, but no" in section
    assert "assert 1 == 2" not in section


# --- what the independent review of 2026-08-16 found, pinned ----------------


def test_the_SCRUB_is_what_keeps_the_path_out_and_it_is_measured_here(tmp_path):
    """**HIGH finding 1: the scrub was live and entirely untested.**

    `test_the_brief_carries_the_failure_and_never_the_path_or_command` asserts
    the path is absent, but its fixture fails on `assert 1 == 2` — a line that
    never contains a path in the first place. So the assertion pinned the
    COINCIDENCE its own docstring says it refuses to rely on, and deleting the
    body of `_without_the_witness` left the whole witness suite green. Measured
    by the reviewer, and this is the test that makes it go red.

    The fixture below puts the materialisation path and the filename INSIDE the
    failure message, which is the one place they can arrive that no choice of
    line can dodge — a witness's own assertion text is the author's, and the
    author is a model that has been told which interface to exercise.
    """
    item = make("x")
    leaky = (
        "def test_it():\n"
        f"    raise RuntimeError('boom in {witness.MATERIAL_DIRNAME}/"
        f"{item.filename}')\n"
    )
    item = witness.Witness(criterion="sum", source=leaky)
    result = witness.prove_red(tmp_path, item)

    assert "boom in" in result.first_line, (
        f"the citation lost the failure entirely: {result.first_line!r}"
    )
    assert witness.MATERIAL_DIRNAME not in result.first_line, (
        f"the citation leaked the materialisation path: {result.first_line!r}"
    )
    assert item.filename not in result.first_line, (
        f"the citation leaked the witness filename: {result.first_line!r}"
    )
    # And the same through the brief, which is the surface W5 actually binds.
    section = "\n".join(witness.brief_section([item]))
    assert witness.MATERIAL_DIRNAME not in section
    assert item.filename not in section


@pytest.mark.parametrize("colour", ["FORCE_COLOR", "PY_COLORS"])
def test_a_COLOURED_runner_does_not_bring_the_progress_bar_back(
    tmp_path, monkeypatch, colour
):
    """**HIGH finding 2: §6d item 1 reopened by one environment variable.**

    `execute` hands the child `{**os.environ, ...}`. With `FORCE_COLOR=1` — set
    by default in many CI images — pytest wraps its progress line in ANSI, and
    an ANSI-prefixed line matched neither the progress pattern nor the error
    pattern. The citation fell back to the coloured bar:

        '\\x1b[31mF\\x1b[0m\\x1b[31m                    [100%]\\x1b[0m'

    which is the exact string §6d item 1 was written about, wearing a costume.
    Measured by the reviewer. Fixed twice over — `--color=no` on the runner and
    an ANSI strip before any pattern is applied — because the flag fixes the
    environment's route in and the strip fixes every other one.
    """
    monkeypatch.setenv(colour, "1")
    result = witness.prove_red(tmp_path, make(ASSERTING))

    assert "\x1b" not in result.first_line, (
        f"the citation carries ANSI escapes: {result.first_line!r}"
    )
    assert "assert 1 == 2" in result.first_line, (
        f"the citation is not the failure: {result.first_line!r}"
    )


@pytest.mark.parametrize(
    "source,expected",
    [
        (
            "import pytest\n\n\ndef test_it():\n"
            "    pytest.fail('the total was 5, expected 6', pytrace=False)\n",
            "the total was 5, expected 6",
        ),
        (
            "import pytest\n\n\n@pytest.mark.xfail(strict=True)\ndef test_it():\n"
            "    assert True\n",
            "XPASS",
        ),
    ],
    ids=["pytest.fail-no-traceback", "strict-xfail"],
)
def test_the_citation_survives_witness_shapes_that_emit_no_E_LINE(
    tmp_path, source, expected
):
    """**MEDIUM finding 10.** Two very ordinary shapes print no `E` line at all,
    and the citation fell back to pytest's section separator —
    `____________ test_it ____________` — which carries the test's own name and
    no failure. Same defect class as the progress bar: always present, never
    says anything. `pytest.fail(...)` is a plausible idiom for a model-authored
    witness, so this is not an exotic input.
    """
    result = witness.prove_red(tmp_path, witness.Witness(
        criterion="sum", source=source,
    ))

    assert "___" not in result.first_line, (
        f"the citation is pytest's separator: {result.first_line!r}"
    )
    assert expected in result.first_line, (
        f"the citation does not carry the failure: {result.first_line!r}"
    )


@pytest.mark.parametrize(
    "criterion", ["../../../pwned", "a/b", "..", ".", "with space"]
)
def test_a_criterion_id_that_is_a_PATH_is_refused(criterion):
    """**MEDIUM finding 11.** The id is interpolated into two write paths and
    one delete, and only `-` was being replaced. `../../../pwned` wrote outside
    the store and would have had `clean()` remove outside the tree — the exact
    thing `materialise`'s own comment warns about.

    Refused rather than slugified: a silent rewrite would break the join
    between `witness.json` and `acceptance.json`, which is keyed on the id.
    """
    with pytest.raises(witness.WitnessError) as caught:
        witness.Witness(criterion=criterion, source=ASSERTING).filename
    assert "cannot name a witness file" in str(caught.value)


def test_a_store_that_would_land_INSIDE_the_repository_is_refused(
    tmp_path, monkeypatch
):
    """**MEDIUM finding 7, and it is the precondition the removed mount used to
    cover.**

    P4-3 deleted the anonymous-volume shadow ON THE STRENGTH of the store being
    outside the repository — and nothing enforced that. `HOME`, `XDG_STATE_HOME`
    or the override pointing at the repo root all put it back inside, and
    `HOME=<repo>` is an ordinary container and CI shape. Inside the tree the
    bytes are back where an agent tidies them, back inside the mount, and
    untracked — so the tree is dirty and `wring deliver` refuses.

    A refusal rather than a silent relocation: moving the bytes somewhere the
    operator did not choose is its own surprise, and carrying on would ship the
    failure the move was made to fix.
    """
    for variable in (witness.STORE_ENV, "XDG_STATE_HOME", "HOME"):
        monkeypatch.delenv(witness.STORE_ENV, raising=False)
        monkeypatch.setenv(variable, str(tmp_path))
        with pytest.raises(witness.WitnessError) as caught:
            witness.store_dir(tmp_path)
        message = str(caught.value)
        assert "INSIDE the repository" in message, variable
        assert witness.STORE_ENV in message, "the refusal does not say what to do"
        monkeypatch.delenv(variable, raising=False)


def test_a_store_OUTSIDE_the_repository_is_accepted(tmp_path, monkeypatch):
    """The other direction, so the guard above cannot be a blanket refusal."""
    repo = tmp_path / "project"
    repo.mkdir()
    monkeypatch.setenv(witness.STORE_ENV, str(tmp_path / "store"))
    assert witness.store_dir(repo).is_relative_to(tmp_path / "store")


def test_a_runner_that_cannot_IMPORT_PYTEST_is_never_a_proved_red(
    tmp_path, monkeypatch
):
    """**The defect the P4-7 gate caught on a real corpus task, before the
    money.**

    `python3 -m pytest` with no pytest installed prints `No module named
    pytest` and exits **1** — not 127, which the containment branch already
    catches. Exit 1 with no exception class recorded is `classify`'s definition
    of a genuine ASSERTION, so on `marshmallow-constant-required` the witness
    came back:

        proved_red.outcome  = "assertion"
        proved_red.verdict  = "proven"
        first_line          = "/usr/bin/python3: No module named pytest"
        row.witness.covered = true

    for a check that had never run. **A false proved-red is strictly worse than
    an uncovered criterion**: uncovered goes to a human, this inflates §5.1's
    coverage number with checks that cannot execute — and §5.1 is the clause the
    whole pass is scored on.

    The guard is `--version`, which exits 0 iff the interpreter can import
    pytest. That is a fact the runner states about its own installation, which
    is the only kind of fact W8 lets a decision rest on. No message is read.
    """
    broken = (sys.executable, "-c", "raise SystemExit(1)")
    monkeypatch.setattr(witness, "RUNNER", broken)

    with pytest.raises(witness.WitnessError) as caught:
        witness.prove_red(tmp_path, make(ASSERTING))
    message = str(caught.value)
    assert "cannot run" in message
    assert "pytest is not importable" in message
    assert "not about the criterion" in message


def test_the_runner_probe_costs_no_test_run_and_touches_no_tree(tmp_path):
    """The probe must not itself be a side effect: it collects nothing, writes
    nothing, and leaves the tree exactly as it found it."""
    before = sorted(p.name for p in tmp_path.iterdir())
    assert witness._runner_missing(witness.RUNNER, tmp_path, None) is None
    assert sorted(p.name for p in tmp_path.iterdir()) == before
