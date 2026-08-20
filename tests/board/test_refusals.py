"""S2 — the mapping is total, and every string in it is inside the ceiling.

`SPEC_BOARD_V0` §4, rulings 16–18, and §11's definition of DONE item 3.

**The two greps here run over the WHOLE STRING TABLE**, not over one rendered
page. S1's versions (`test_board.py`) render a repository and grep the HTML,
which catches a violation only on a path that fixture happens to reach. Every
sentence this surface can ever say now lives in one dict, so both greps can be
exhaustive — and that is the reason the sentences were moved out of `cards.py`
into `refusals.py` rather than left where they were.
"""

from __future__ import annotations

import pytest

from wringer_board import cards, refusals

# --- what the engine can emit, written down -------------------------------
#
# One link in a two-link chain. `test_the_mapping_covers_exactly_these` guards
# the mapping against this list and always runs;
# `test_these_are_the_engines_own_values` guards this list against the engine
# and runs wherever the engine is importable. Neither link is a substitute for
# the other, and the second one's absence is reported rather than passed over.

ENGINE_VALUES: dict[str, frozenset[str]] = {
    refusals.CRITERION_STATE: frozenset(
        {"evidenced", "unevidenced", "gate-failed", "gate-did-not-run", "human"}
    ),
    # EIGHT since `wringer.acceptance.v3`. One closed enum spanning
    # `unevidenced` and `human` rows — not two vocabularies, because human
    # causes outside a public symbol would be causes this board could not
    # render.
    refusals.UNEVIDENCED_CAUSE: frozenset(
        {
            "unbound",
            "witness-evidenced-nothing",
            "born-green",
            "pre-existence-unestablished",
            "arrived-with-the-work",
            "human-unanswered",
            "human-said-no",
            "human-judgement-stale",
        }
    ),
    refusals.LOOP_ENDING: frozenset(
        {
            "converged",
            "max_iterations",
            "budget_exhausted",
            "no_progress",
            "oscillating",
            "authority_moved",
            "flaky_gate",
            "interrupted",
            # The ninth, from SPEC_ENV's F6: the first gate could not run at
            # all, so no worker was ever briefed.
            "environment",
        }
    ),
    refusals.VACUITY_VERDICT: frozenset(
        {"proven", "gates_vacuous", "not_applicable", "inconclusive"}
    ),
    refusals.HEALTH_VERDICT: frozenset({"alive", "zombie", "untested", "retired"}),
    refusals.SIGNATURE: frozenset(
        {
            "signature_valid",
            "signature_invalid",
            "signature_missing",
            "signature_unverified",
        }
    ),
    refusals.IDENTITY: frozenset(
        {"identity_trusted", "identity_untrusted", "identity_unknown"}
    ),
    refusals.INTEGRITY: frozenset({"integrity_valid", "integrity_invalid"}),
    refusals.FLEET_OUTCOME: frozenset({"succeeded", "failed", "parked"}),
    # **Three, and the honest number.** `deliver.py` raises twenty-three
    # refusals as prose with no enum, and exactly three are reachable from an
    # artifact this board can read (ruling 19). The other twenty render
    # UNTRANSLATED with the engine's own words. Naming all twenty-three is
    # `SPEC_REFUSAL_V0.md` in the core repo, which is UNREVIEWED and UNBUILT —
    # so this table does not pretend those names exist.
    # **ALL 23, and they are the ENGINE's names since refusal R1 landed
    # `deliver.REFUSAL_REASONS` on 2026-08-17.** This list used to hold three
    # invented ones, because `deliver.py` had no reason enum and naming them
    # here would have been the surface deciding what the engine says. It has
    # one now, so this is checked against it below like every other family.
    # ONE value, and it is `accept.CAUSE_BORN_GREEN` — the same string the
    # engine uses at the handover, said at the install question instead. A
    # second value here would be a vocabulary this board invented; the family
    # exists to move a fact earlier, not to add facts.
    refusals.GATE_AT_INSTALL: frozenset({"born-green"}),
    refusals.DELIVERY_REFUSAL: frozenset(
        {
            "acceptance_unevidenced",
            "authority_moved",
            "branch_exists",
            "branch_is_base",
            "branch_is_current",
            "branch_is_default",
            "case_alias_collision",
            "default_branch_unknown",
            "files_unreadable_at_verify",
            "gates_did_not_pass",
            "gates_vacuous",
            "head_moved",
            "no_git_identity",
            "nothing_to_deliver",
            "remote_unreachable",
            "signature_required",
            "tracked_contents_differ",
            "tree_moved",
            "unfinished_git_operation",
            "unsupported_file_type",
            "untracked_file_moved",
            "untracked_record_unknown_version",
            "untracked_record_unreadable",
        }
    ),
}


def test_the_mapping_covers_exactly_these_and_nothing_else():
    """**Ruling 16, set equality in BOTH directions.**

    A missing entry is a value a PM would meet as an untranslated string. An
    extra entry is dead text that reads as coverage — the drift
    `tests/test_run.py:73` in the core was written after, and the reason this
    assertion is not just `issubset`.
    """
    assert set(ENGINE_VALUES) == set(refusals.FAMILIES), (
        "a family exists in one place and not the other"
    )
    for family, expected in ENGINE_VALUES.items():
        got = refusals.values_for(family)
        assert got == expected, (
            f"{family}: mapping has {sorted(got)}, the engine emits "
            f"{sorted(expected)}. Missing: {sorted(expected - got)}. "
            f"Dead entries: {sorted(got - expected)}"
        )


def test_these_are_the_engines_own_values():
    """The second link: the list above, checked against the engine itself.

    Five families come from FROZEN SCHEMAS — the strongest source this project
    has, because `schema/frozen.json` byte-freezes them and a change without a
    new version fails the core's own suite. Three come from public module
    symbols, which is what ruling 16 requires and what
    `sign.INTEGRITY_STATES` (`ab884b5`) made possible for the third axis.

    **The honest limit, and it is a skip with its consequence spelled out
    rather than a silent pass.** This package has no runtime dependency on
    `wringer` and will not gain one. Where the engine is not installed, this
    check cannot run, and the list above is then hand-kept — so the skip
    message says exactly which claim is going unchecked, in the shape Q3 ruled
    for SECURITY.md's unprobeable rows: loud, never silent.
    """
    wringer = pytest.importorskip(
        "wringer",
        reason=(
            "the engine is not importable here, so THE CENTRAL CLAIM OF THIS "
            "FILE IS UNCHECKED: that ENGINE_VALUES is the engine's own "
            "vocabulary rather than a hand-kept list. Install the core "
            "alongside this package to check it."
        ),
    )
    import json
    from pathlib import Path

    from wringer import accept, deliver, graph, sign

    root = Path(wringer.__file__).resolve().parents[2]
    schema = root / "schema"
    if not (schema / "vacuity.schema.json").is_file():
        pytest.skip(
            "the engine is importable but its `schema/` is not on disk (an "
            "installed wheel rather than a checkout), so the five "
            "schema-sourced families are UNCHECKED here"
        )

    def enum(name: str, *keys: str) -> frozenset[str]:
        node = json.loads((schema / name).read_text(encoding="utf-8"))
        for key in keys:
            node = node[key]
        return frozenset(node)

    derived = {
        refusals.CRITERION_STATE: enum(
            "acceptance.schema.json",
            "properties",
            "criteria",
            "items",
            "properties",
            "state",
            "enum",
        ),
        refusals.LOOP_ENDING: frozenset(graph.LOOP_REASONS),
        # **NEW, and the point of OQ-4.** This family used to be the one with
        # no engine symbol to read: the causes were told apart by matching
        # `accept.py`'s free text, so there was nothing to enumerate FROM and
        # a reworded message could silently re-label a card. `accept.CAUSES`
        # is now public and closed, so this family joins the derived set like
        # every other and the hand-kept list above is checked against it.
        refusals.UNEVIDENCED_CAUSE: frozenset(accept.CAUSES),
        # Derived from the engine's own constant, not repeated as a literal:
        # if `accept.CAUSE_BORN_GREEN` is ever renamed, this family goes red
        # rather than quietly translating a string the engine stopped using.
        refusals.GATE_AT_INSTALL: frozenset({accept.CAUSE_BORN_GREEN}),
        # The 23 delivery refusals, from the engine's own closed tuple. A 24th
        # reddens here rather than silently rendering untranslated on a card.
        refusals.DELIVERY_REFUSAL: frozenset(deliver.REFUSAL_REASONS),
        refusals.VACUITY_VERDICT: enum(
            "vacuity.schema.json", "properties", "verdict", "enum"
        ),
        refusals.HEALTH_VERDICT: enum(
            "health-report.schema.json",
            "$defs",
            "gate",
            "properties",
            "verdict",
            "enum",
        ),
        refusals.SIGNATURE: frozenset(sign.SIGNATURE_STATES),
        refusals.IDENTITY: frozenset(sign.IDENTITY_STATES),
        # No per-value exemption any more. Ruling 16 granted one on the stated
        # grounds that "no collection and no schema enum exists"; the tuple
        # landed at `ab884b5` and the exemption is discharged rather than left
        # as a comment nobody re-reads.
        refusals.INTEGRITY: frozenset(sign.INTEGRITY_STATES),
        refusals.FLEET_OUTCOME: enum(
            "fleet-manifest.schema.json",
            "properties",
            "tasks",
            "items",
            "properties",
            "status",
            "enum",
        ),
    }

    for family, engine_values in derived.items():
        assert ENGINE_VALUES[family] == engine_values, (
            f"{family}: this file says {sorted(ENGINE_VALUES[family])}, the "
            f"engine says {sorted(engine_values)}"
        )


def test_the_v1_and_v2_prose_fallback_still_selects_only_mapped_causes():
    """**The FALLBACK path, which v3 does not delete.**

    Since v3 the engine writes `cause` and this board reads it, so the regexes
    are no longer how causes are told apart. They remain for v1 and v2 records,
    which have no `cause` key and which this board must keep reading — so a
    pattern that can select a name the mapping cannot say is still the collapse
    ruling 15 forbids, just on a narrower path.

    It is now a SUBSET check rather than equality: the mapping legitimately
    covers three human causes no regex will ever select, because a v1 or v2
    record has no human judgement in it to describe.
    """
    selectable = {name for name, _ in cards.UNEVIDENCED_CAUSES} | {cards.UNBOUND}
    covered = ENGINE_VALUES[refusals.UNEVIDENCED_CAUSE]
    assert selectable <= covered, (
        f"cards.py can select {sorted(selectable - covered)}, which the "
        f"mapping cannot say"
    )


# --- the whole string table, and the two greps that bind it ----------------


def not_rendered() -> set[str]:
    """Strings in `cards.py` that are MATCHERS or KEYS, never output.

    Two kinds, both identified from the code rather than listed by hand, so a
    new sentence cannot hide in here by being added to a list:

    - the `reason` regexes, which are matched against the ENGINE's words and
      therefore have to contain the engine's vocabulary to work at all;
    - the cause names, which are dictionary keys into `refusals.MAPPING` and
      are never rendered — `render.py` writes `card.sentence` and
      `card.engine_words` and nothing else from a card's text.

    Excluding them is not a loophole and it is worth being exact about why:
    `witness-evidenced-nothing` is a key and `"witness evidences nothing"` is a
    pattern that must match `accept.py`'s own sentence. Forbidding the word
    there would forbid the board from recognising the cause at all, while the
    thing the rule actually protects — what a PM reads — is untouched.
    """
    names = {name for name, _ in cards.UNEVIDENCED_CAUSES} | {cards.UNBOUND}
    patterns = {pattern.pattern for _, pattern in cards.UNEVIDENCED_CAUSES}
    return names | patterns


def every_string() -> list[tuple[str, str]]:
    """Every string this surface can render, with where it came from.

    `refusals.MAPPING` is exhaustive by construction. `cards.py`'s own literals
    are swept too, because it still writes some sentences itself — the receipt
    sentences, the UNKNOWN sentence, the NOT REACHED sentence — and a grep over
    the mapping alone would miss them while reading as complete.
    """
    strings: list[tuple[str, str]] = []
    for (family, value), saying in refusals.MAPPING.items():
        strings.append((f"{family}/{value} sentence", saying.sentence))
        strings.append((f"{family}/{value} question", saying.question))

    import inspect

    excluded = not_rendered()
    for literal in _string_literals(inspect.getsource(cards)):
        if len(literal) > 20 and literal not in excluded:
            strings.append(("cards.py literal", literal))
    return strings


def test_the_excluded_strings_are_only_matchers_and_keys():
    """The guard on the exclusion, because an exclusion nobody checks grows.

    Every excluded string must be either a cause name or a regex source. If a
    future slice adds a sentence to that set, this reddens.
    """
    names = {name for name, _ in cards.UNEVIDENCED_CAUSES} | {cards.UNBOUND}
    patterns = {pattern.pattern for _, pattern in cards.UNEVIDENCED_CAUSES}
    assert not_rendered() - names - patterns == set(), (
        "something that is neither a cause name nor a regex is being excluded "
        "from the ceiling and jargon greps"
    )
    # And a rendered sentence must never be in it.
    for saying in refusals.MAPPING.values():
        assert saying.sentence not in not_rendered()


def _string_literals(source: str) -> list[str]:
    """Every string literal in a module's source, docstrings excluded.

    Docstrings are excluded deliberately: they are addressed to whoever
    maintains this, they cite rulings and name the witness lane by name, and
    grepping them for house jargon would forbid the file from explaining
    itself. Nothing in a docstring reaches a PM.
    """
    import ast

    tree = ast.parse(source)
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef)):
            doc = ast.get_docstring(node, clean=False)
            if doc is not None:
                docstrings.add(doc)
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if node.value not in docstrings:
                out.append(node.value)
    return out


def test_no_surface_string_claims_a_wrong_fix_was_caught():
    """**The Q1 ceiling, over the whole table rather than over one page.**

    *A witness proves the stated criterion could fail and was made to pass; it
    does not certify agreement with an unstated intended fix, and where the
    criterion under-describes the intent, the witness inherits that gap.*

    Nothing here may claim otherwise. S1's version of this rendered one
    repository and grepped the HTML, which reaches only the strings that
    fixture happens to produce; this one reaches every string that exists.
    """
    forbidden = (
        "wrong fix",
        "wrong change",
        "catches wrong",
        "incorrect fix",
        "guarantees correct",
        "guarantees",
        "safe to merge",
        "proves the change is right",
        "certifies",
        "correct change",
    )
    offenders = [
        f"{where}: {phrase!r} in {text!r}"
        for where, text in every_string()
        for phrase in forbidden
        if phrase in text.lower()
    ]
    assert not offenders, "the surface exceeds the claim ceiling: " + "; ".join(
        offenders
    )


def test_no_rendered_string_uses_house_jargon():
    """**L5 and B4 at once, and the strongest of the three L5 checks.**

    A term only this programme knows is a term the reader cannot look up. The
    list is `SPEC_BOARD_V0` §1's L5 row, plus the machinery words a PM should
    never meet.
    """
    jargon = (
        "vacuity",
        "vacuous",
        "gategen",
        "witness",
        "ratchet",
        "red-first",
        "fork ruling",
        "unevidenced",
        "gate-did-not-run",
        "acceptance.json",
        ".wringer",
        "exit code",
        "schema",
        "criterion state",
        "proves:",
    )
    offenders = [
        f"{where}: {word!r} in {text!r}"
        for where, text in every_string()
        for word in jargon
        if word in text.lower()
    ]
    assert not offenders, "house jargon reaches a PM: " + "; ".join(offenders)


def test_every_saying_has_a_sentence_and_exactly_one_question():
    """Ruling 16: one sentence, one unblocking question. Not a list of them.

    A question mark count is a crude proxy and it is the honest one available:
    what it actually catches is a `question` field that has quietly become a
    troubleshooting guide, which is how a PM surface turns into a runbook.
    """
    for (family, value), saying in refusals.MAPPING.items():
        assert saying.sentence.strip(), f"{family}/{value} has no sentence"
        assert saying.question.strip(), f"{family}/{value} has no question"
        assert saying.question.count("?") <= 1, (
            f"{family}/{value} asks more than one question: {saying.question!r}"
        )


def test_an_unmapped_value_is_None_rather_than_a_guess():
    """Ruling 17's mechanism. There is no default and no nearest match.

    A wrong plain-English sentence is worse than an ugly true one, because the
    reader cannot tell that it is wrong.
    """
    assert refusals.say(refusals.CRITERION_STATE, "something_new") is None
    assert refusals.say("a-family-that-does-not-exist", "evidenced") is None
