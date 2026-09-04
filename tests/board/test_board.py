"""The board renders what the engine wrote, and refuses what it cannot read.

**The fault-injection triple S1's capture requires is here**, each in its own
test: an unknown schema version, a broken receipt chain, and a `sensitive`
receipt resolved through the pre-change run. Those are the three the spec names
because they are the three where a surface is most tempted to be helpful, and
being helpful is how a board comes to claim more than its evidence.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from board_helpers import criterion, write_loop, write_run

from wringer_board import cards
from wringer_board import read as read_module
from wringer_board import render as render_module
from wringer_board.__main__ import main


def board_of(repo: Path):
    return read_module.read(repo)


def html_of(repo: Path) -> str:
    return render_module.render(board_of(repo))


# --- ruling 4: the six states, and REFUSED as a badge ------------------------


def test_a_resolved_evidenced_row_is_DONE_and_says_it_was_red_first(repo):
    # The CITED run first: `latest_run` falls back to mtime, so the run the
    # board describes has to be the newest one on disk.
    write_run(
        repo,
        "20260816-085900-bbbb",
        [],
        gates={
            "suite": ("stderr", "reports.to_csv() does not exist"),
        },
    )
    write_run(
        repo,
        "20260816-090000-aaaa",
        [
            criterion(
                "csv",
                "Finance can download the figures as a spreadsheet file",
                "evidenced",
                receipt={"kind": "failure", "run": "20260816-085900-bbbb"},
            )
        ],
        gates={"suite": ("stderr", "reports.to_csv() does not exist")},
    )

    page = html_of(repo)
    assert "DONE — AND PROVED" in page
    assert "This was watched failing before it was fixed." in page, (
        "the hero box is missing — the green is the ordinary part, the record "
        "of the same check FAILING is what this page exists to show"
    )
    assert "reports.to_csv() does not exist" in page, (
        "the check's own words are absent; a receipt without them is a badge"
    )


def test_REFUSED_is_a_BADGE_and_coexists_with_other_states(repo):
    """**Ruling 4a.** `refuses` is true for any criterion that is required and
    covered and not evidenced, so a NOT YET card, a NOT REACHED card and a
    bound NEEDS YOU card are all simultaneously refusing rows. Six mutually
    exclusive states with no precedence rule would be a lie about the data.

    It is also the honest model: it is the DELIVERY that was refused, not the
    criterion."""
    write_run(
        repo,
        "20260816-090000-aaaa",
        [
            criterion("a", "Not built yet", "gate-failed", refuses=True),
            criterion("b", "Not checked", "gate-did-not-run", refuses=True),
        ],
        gates={"suite": ("stderr", "AssertionError: expected 3 columns, got 1")},
    )

    page = html_of(repo)
    assert "NOT YET" in page and "NOT REACHED" in page
    assert page.count("badge") >= 2, "a refusing row lost its badge"
    assert "holding up the handover" in page


def test_NOT_REACHED_asserts_no_cause_it_cannot_support(repo):
    """**Ruling 4b.** The sentence is `accept.py`'s own. The board may name a
    cause only when the run's own record supports one — and it frequently does
    not: a scoped run has `gate-did-not-run` with NO failing gate at all."""
    write_run(
        repo, "20260816-090000-aaaa", [criterion("a", "Something", "gate-did-not-run")]
    )
    page = html_of(repo)
    assert "nothing here says anything about it" in page
    assert "failed first" not in page


def test_a_scoped_run_gets_its_own_honest_sentence(repo):
    write_run(
        repo,
        "20260816-090000-aaaa",
        [criterion("a", "Something", "gate-did-not-run")],
        scoped_out=["lint", "types"],
    )
    assert "only asked to check some of the requirements" in html_of(repo)


# --- ruling 5: the promise is EARNED, and computed over CLAIMS ---------------


def test_a_BROKEN_receipt_chain_demotes_the_card_AND_vetoes_the_promise(repo):
    """**Fault injection 2, and the probe's own bug.**

    Demoting a broken-chain card to UNKNOWN removed it from the set of greens,
    and the promise then fired over the survivors — a page reading "every green
    was red first" beside a card that could not show its red.

    A row that CLAIMS `evidenced` and cannot resolve vetoes the promise,
    whatever the card ends up rendering.
    """
    write_run(repo, "20260816-085900-bbbb", [], gates={"suite": ("stderr", "boom")})
    write_run(
        repo,
        "20260816-090000-aaaa",
        [
            criterion(
                "good",
                "Resolvable",
                "evidenced",
                receipt={"kind": "failure", "run": "20260816-085900-bbbb"},
            ),
            criterion(
                "bad",
                "Points nowhere",
                "evidenced",
                receipt={"kind": "failure", "run": "a-run-that-is-not-here"},
            ),
        ],
        gates={"suite": ("stderr", "boom")},
    )

    board = board_of(repo)
    rendered = [cards.card_for(board, c) for c in board.criteria]
    states = {c.id: c.state for c in rendered}
    assert states["bad"] == cards.UNKNOWN
    assert states["good"] == cards.DONE

    assert not cards.promise_earned(board, rendered), (
        "the promise fired over the survivors while a row that CLAIMED "
        "evidenced could not show its red"
    )
    page = html_of(repo)
    assert "does not claim that every requirement" in page
    assert "cannot stand behind" in page


def test_a_SENSITIVE_receipt_resolves_and_says_a_DIFFERENT_sentence(repo):
    """**Fault injection 3, and ruling 5's second half.**

    On the changed tree the gate PASSED, so the gate directory says `passed`
    and reading it would resolve nothing — the failure is in the pre-change
    run. The first draft handled only the `failure` kind and would have
    rendered UNKNOWN for every criterion in any repo using `run.prove: true`,
    which is the mechanism the README's own objections block advertises.

    The two sentences differ because the two facts differ. Rendering the second
    as the first would be an overclaim.
    """
    write_run(
        repo,
        "20260816-090000-aaaa",
        [
            criterion(
                "csv",
                "Finance can download the figures",
                "evidenced",
                receipt={
                    "kind": "sensitive",
                    "cites": "the same check failed on the code before this change",
                },
            )
        ],
    )
    page = html_of(repo)
    assert "DONE — AND PROVED" in page
    assert "BEFORE this change" in page
    assert "recorded failing — the run that failed it" not in page, (
        "a sensitivity receipt is rendered as a failure receipt, which claims "
        "a different and stronger thing than the record supports"
    )


def test_the_promise_is_WITHHELD_when_nothing_is_done(repo):
    write_run(
        repo,
        "20260816-090000-aaaa",
        [criterion("a", "Nothing yet", "gate-failed", refuses=True)],
        gates={"suite": ("stderr", "nope")},
    )
    assert "does not claim that every requirement" in html_of(repo)


# --- ruling 6: an unknown version renders ZERO CARDS -------------------------


def test_an_unknown_schema_version_renders_NO_CARDS_and_exits_nonzero(
    repo, tmp_path, capsys
):
    """**Fault injection 1.** Not best-effort parsing, not partial rendering.
    A board that guessed past a schema version would supply the flattering
    answer, which is the one thing every `limits` block in the engine warns
    about."""
    write_run(
        repo,
        "20260816-090000-aaaa",
        [criterion("a", "Something", "evidenced")],
        version="wringer.acceptance.v9",
    )
    out = tmp_path / "board.html"
    assert main(["render", str(repo), "-o", str(out)]) == 2

    page = out.read_text(encoding="utf-8")
    assert "wringer.acceptance.v9" in page
    assert "cannot read this evidence" in page
    assert "card" not in page.split("<style>")[0] + page.split("</style>")[-1], (
        "a card was rendered beside a version refusal"
    )
    assert "Something" not in page, "a criterion leaked past the refusal"


def test_the_versions_the_board_knows_include_the_WITNESS_lane(repo):
    """v2 is what a run carrying a witness lane writes, and the corpus re-test
    is exactly such a run. A board that knew only v1 could not render the very
    artifact it was commissioned to show.

    **v3 joined on 2026-08-17**, taught from bytes the engine wrote rather than
    from fixtures written here — see `tests/test_acceptance_v3.py`. The engine
    does not EMIT v3 yet: that gate is on the engine (`accept.EMIT_V3`), and it
    exists so this board is never the thing that refuses to read the artifact
    it was built to render."""
    assert read_module.KNOWN_ACCEPTANCE == (
        "wringer.acceptance.v1",
        "wringer.acceptance.v2",
        "wringer.acceptance.v3",
    )
    write_run(
        repo,
        "20260816-090000-aaaa",
        [
            criterion(
                "a",
                "Something",
                "gate-failed",
                refuses=True,
                witness={"proved_red": "assertion", "result": "failed", "covers": True},
            )
        ],
        version="wringer.acceptance.v2",
        gates={"suite": ("stderr", "still failing")},
    )
    page = html_of(repo)
    assert "NOT YET" in page
    assert "written" in page and "BEFORE the work began" in page


# --- ruling 8: order comes from the loop, never from the ids -----------------


def test_the_board_never_orders_runs_by_id(repo):
    """Run ids are `<date>-<HHMMSS>-<4 hex>` and do not sort chronologically:
    in the probe's capture four of five runs shared one second, lexical order
    gave 56dc, 85fa, ba27, e40f, and the truth was 56dc, e40f, 85fa, ba27."""
    for run_id in (
        "20260816-090000-56dc",
        "20260816-090000-e40f",
        "20260816-090000-85fa",
        "20260816-090000-ba27",
    ):
        write_run(repo, run_id, [criterion("a", "x", "gate-failed")])
    write_loop(
        repo,
        "20260816-085959-0001",
        [
            "20260816-090000-56dc",
            "20260816-090000-e40f",
            "20260816-090000-85fa",
            "20260816-090000-ba27",
        ],
    )

    board = board_of(repo)
    assert [a.run_id for a in board.attempts] == [
        "20260816-090000-56dc",
        "20260816-090000-e40f",
        "20260816-090000-85fa",
        "20260816-090000-ba27",
    ]
    assert board.ordered
    assert [a.run_id for a in board.attempts] != sorted(
        a.run_id for a in board.attempts
    ), "the fixture no longer distinguishes loop order from lexical order"


def test_without_a_loop_the_runs_are_an_UNORDERED_SET(repo):
    """No loop bundle covers these runs, so the board may use no
    "first"/"then"/"attempt N" language about them."""
    write_run(repo, "20260816-090000-aaaa", [criterion("a", "x", "gate-failed")])
    board = board_of(repo)
    assert not board.ordered
    assert board.attempts == []


# --- ruling 15: `unevidenced` has FIVE causes --------------------------------


@pytest.mark.parametrize(
    "reason,expected_cause,must_say",
    [
        (
            "the gate arrived with the change it judges",
            "arrived-with-the-work",
            "cannot vouch for the work that brought it",
        ),
        (
            "this gate has never been recorded failing",
            "born-green",
            "never been recorded failing",
        ),
        (
            "the pre-change tree could not establish it",
            "pre-existence-unestablished",
            "existed before the change",
        ),
        # **The fifth, named in S2.** Its fixture is the reason string
        # `accept.py` actually writes for a discarded witness, and it must not
        # be swallowed by the unbound branch it shares `gate: null` with.
        (
            "no gate proves this criterion, and its witness evidences nothing "
            "(the runner could not collect it (exit 2)) — a human decides",
            "witness-evidenced-nothing",
            "turned out to prove nothing",
        ),
    ],
)
def test_the_five_causes_of_unevidenced_are_never_rendered_as_one_another(
    repo, reason, expected_cause, must_say
):
    """**Ruling 15, and it is pinned by fixture on purpose.**

    Only the unbound case is structural; the rest are told apart by matching
    the engine's own `reason` text. So each carries a pinned fixture, and a
    wording change in `accept.py` fails HERE rather than silently re-labelling
    a card.

    Rendering one as another is false and, in one direction, backwards — for a
    check that arrived with the work the record DOES show that gate can fail;
    the objection is that the gate is NEW. It is also one of three things the
    core README advertises as breaking the circularity objection, so getting it
    wrong contradicts the README two clicks away.

    **Amended in S2, and the amendment is the point of the slice.** This test
    was `test_the_four_causes_...` and carried three rows. `SPEC_BOARD_V0`
    ruling 15 enumerated four causes from `accept.py` at `d23d7ca`; the witness
    lane added a fifth, `test_real_bundles.py` met it on REAL data, and naming
    it was handed to S2 in that test's own docstring. The fourth row below is
    that discharge.

    One rename came with it: `never-recorded-failing` is now `born-green`, the
    name `accept.py` and ruling 15 both already used for the same cause. Two
    names for one cause is how a mapping stops being checkable.
    """
    write_run(
        repo,
        "20260816-090000-aaaa",
        [criterion("a", "Something", "unevidenced", reason=reason)],
    )
    board = board_of(repo)
    card = cards.card_for(board, board.criteria[0])
    assert card.cause == expected_cause
    assert must_say in card.sentence


def test_an_UNBOUND_criterion_says_nothing_checks_it_yet(repo):
    write_run(
        repo,
        "20260816-090000-aaaa",
        [criterion("a", "Something", "unevidenced", gate=None, reason="")],
    )
    board = board_of(repo)
    card = cards.card_for(board, board.criteria[0])
    assert card.cause == "unbound"
    # Pinned on the PROPERTY, not the sentence. The old wording — "Nothing
    # checks this yet" — was reworded on 2026-08-20 because six cold readers
    # met it beside a printed check whose assertions matched these very
    # requirements, and concluded the page was lying to them. What must stay
    # true is that an unbound criterion says NOTHING IS CHECKING IT and does
    # not claim more. Reworded again 2026-08-28 — "bound" was the last word
    # here a product manager had to already know — and the property is the
    # same one.
    assert "Nothing is checking this requirement" in card.sentence
    assert "nobody can say whether it works" in card.sentence


def test_an_UNMAPPED_reason_renders_the_engines_words_VERBATIM(repo):
    """**Ruling 17.** Never invisibly, never swallowed, never
    best-effort-prettified. A PM seeing an ugly string files a bug report; a PM
    seeing nothing has been lied to."""
    strange = "the flux capacitor declined to comment"
    write_run(
        repo,
        "20260816-090000-aaaa",
        [criterion("a", "Something", "unevidenced", reason=strange)],
    )
    page = html_of(repo)
    assert "UNTRANSLATED" in page
    assert strange in page
    assert "never been recorded failing" not in page, (
        "an unmapped reason was rendered as the generic born-green sentence, "
        "which is rendering one cause as another"
    )


# --- ruling 9 and the Q1 ceiling ---------------------------------------------


def test_the_limits_render_VERBATIM_in_the_engines_own_voice(repo):
    limit = "A gate passing says the gate passed, and nothing wider."
    write_run(
        repo,
        "20260816-090000-aaaa",
        [criterion("a", "x", "gate-failed")],
        limits=[limit],
        gates={"suite": ("stderr", "nope")},
    )
    assert limit in html_of(repo), (
        "a limit was translated or dropped. A translated limit is a weakened "
        "limit unless the translation is guarded, and that guard is a cycle"
    )


def test_no_rendered_string_claims_a_wrong_fix_was_caught(repo):
    """**The Q1 ceiling, which binds every artifact in this programme.**

    A witness proves the stated criterion could fail and was made to pass; it
    does not certify agreement with an unstated intended fix. Nothing anywhere
    may claim it catches wrong fixes.
    """
    write_run(
        repo,
        "20260816-090000-aaaa",
        [
            criterion(
                "a",
                "Something",
                "gate-failed",
                refuses=True,
                witness={"proved_red": "assertion", "result": "failed", "covers": True},
            )
        ],
        version="wringer.acceptance.v2",
        gates={"suite": ("stderr", "still failing")},
    )
    page = html_of(repo).lower()
    for forbidden in (
        "wrong fix",
        "catches wrong",
        "incorrect fix",
        "guarantees",
        "safe to merge",
        "correct change",
        "proves the change is right",
    ):
        assert forbidden not in page, f"the board claims {forbidden!r}"


def test_the_board_uses_no_house_jargon_on_a_card(repo):
    """B4. No YAML, no exit codes, no gate ids, no run ids in the board's own
    chrome. The two exceptions are on the card and are the check's own words
    and the attempt ordinal — never the surface's vocabulary."""
    write_run(
        repo,
        "20260816-090000-aaaa",
        [criterion("a", "Something", "gate-failed", refuses=True)],
        gates={"suite": ("stderr", "nope")},
    )
    page = html_of(repo)
    body = page.split("</style>")[-1]
    for jargon in (
        "gates_vacuous",
        "not_evidenced",
        "gate-failed",
        "acceptance.json",
        "exit code",
        ".wringer/",
    ):
        assert jargon not in body, f"the board says {jargon!r} to a PM"


def test_a_repository_with_no_evidence_says_so_rather_than_rendering_empty(repo):
    page = html_of(repo)
    assert "no evidence here yet" in page
    assert "DONE" not in page


def test_the_board_says_what_the_run_RECORDED_using_and_never_a_price():
    """Facts only. Wringer keeps no price table — a number it cannot check is
    a number it must not print — so the page reports the counts the model and
    the worker actually reported and adds nothing to them."""
    board = read_module.Board(
        repo=Path("."),
        spend={"drafting": {"prompt_tokens": 2206, "completion_tokens": 4813}},
    )
    html = render_module.render(board)

    assert "What this run recorded using" in html
    assert "2,206" in html and "4,813" in html
    assert "does not price them" in html
    tail = html.split("What this run recorded using")[1][:600]
    for money in ("$", "£", "€", "USD"):
        assert money not in tail, f"the board priced something: {money}"


def test_THE_TWO_LANES_ARE_NEVER_SUMMED_AND_A_SILENT_ONE_IS_SAID():
    """**Run 4B, finding 8 (P2.15).** The drafting reply and the worker were
    added into one total under "the counts the model and the worker
    reported" — and on that delivery the worker was on the shell lane and
    reported nothing, so the number was the drafting call alone and the
    sentence was false. Two questions, two numbers, and a lane that reported
    nothing is SAID to have reported nothing."""
    html = render_module.render(read_module.Board(
        repo=Path("."),
        spend={"drafting": {"total_tokens": 18970}},
    ))

    assert "Drafting reported" in html and "18,970" in html
    assert "The builder reported nothing this run" in html
    assert "not the same as having spent nothing" in html
    assert "the model and the worker" not in html, (
        "one sentence still claims both lanes over one number"
    )

    both = render_module.render(read_module.Board(
        repo=Path("."),
        spend={"drafting": {"total_tokens": 10},
               "worker": {"total_tokens": 270318}},
    ))
    assert "270,318" in both and "10" in both
    assert "270,328" not in both, "the two lanes were summed"


def test_a_run_that_recorded_no_usage_says_NOTHING_rather_than_zero():
    """Absent is not zero. A run whose worker reported no usage has not been
    shown to have spent nothing, and "0 tokens" would be a claim the record
    does not support — the same rule vacuity and health already follow."""
    html = render_module.render(read_module.Board(repo=Path(".")))

    assert "What this run recorded using" not in html
    assert "0 tokens" not in html


def test_the_CHECK_OUTPUT_is_COLLAPSED_and_no_prose_was_added(repo):
    """Field report 2026-08-22 finding 14, answered structurally and only so.

    The block prints a check's raw output, and that output names assertions
    matching requirement cards below which read "nothing checks this". The
    reader's verdict on the paragraph explaining why both are true: *"it will
    read as nonsense to anyone not fluent in the binding model. The tests are
    visibly right there on the page."*

    **Prose was the forbidden move.** The board's own cold reads measured a
    structural pass taking the page 85 → 68 and an explanatory-prose pass
    making it worse, 68 → 82. So this guard has two halves: the raw output is
    behind a shut `<details>`, and the explaining sentence did not multiply —
    it is inside that same block, where a reader meets it in the act of
    opening the log rather than as standing prose on a page they are scanning.
    """
    write_run(
        repo,
        "20260816-090000-aaaa",
        [criterion("a", "Recent games appear first", "gate-failed", refuses=True)],
        gates={
            "suite": (
                "stderr",
                "the most recently played comes first (0.07ms)\n"
                "at most three are shown (0.06ms)\n"
                "it survives closing the page (0.05ms)\n",
            )
        },
    )
    page = html_of(repo)

    assert "the most recently played comes first" in page, "the log vanished"

    # Shut by default. `<details open>` would put the log back on the page.
    assert '<details class="said"' in page, (
        "the check output is not behind a collapsible block at all, so it "
        "renders in full beside cards saying nothing checks them — finding "
        "14, restored"
    )
    block = page.split('<details class="said"')[1]
    assert not block.startswith(" open"), (
        "the check output renders expanded, so a reader scanning the page "
        "still meets test names matching requirements the page says nothing "
        "checks — finding 14, restored"
    )
    assert "<summary" in block.split("</summary>")[0] + "</summary>", block[:200]

    # Everything the reader could misread is INSIDE the collapsed block.
    before_details, after_summary = page.split("</summary>", 1)
    for inside_only in (
        "the most recently played comes first",
        "It may test more than this requirement does",
    ):
        assert inside_only not in before_details, (
            f"{inside_only!r} renders above the fold of the collapsed block"
        )
        assert inside_only in after_summary

    # And the sentence did not become two. One explaining paragraph, as before.
    assert page.count("It may test more than this requirement does") == 1
    assert page.count('<p class="scope">') == 1


def test_the_page_is_WELL_FORMED_and_nothing_it_emits_is_UNSTYLED(repo):
    """**Two properties the mutation sweep showed nobody was checking.**

    F14 turned the check-output block into a `<details>`, and a stray edit to
    the string that closes it produced HTML no test looked at. And two CSS
    blocks — the collapsed block's, and the check-note's — could be deleted
    entirely with the suite still green, which means a card could render
    unstyled exactly the way `_STATE_CLASS` exists to prevent for states.

    So: every tag the card opens is closed, and every class it emits has a
    rule. Derived from the page, not from a list written here.
    """
    import re

    write_run(
        repo,
        "20260816-090000-aaaa",
        [criterion("a", "Something", "gate-failed", refuses=True)],
        gates={"suite": ("stderr", "AssertionError: nope")},
    )
    page = html_of(repo)
    # The stylesheet is CSS, not markup. Counting tags inside it measures the
    # wrong thing — and a comment there naming an element in angle brackets is
    # exactly what made this guard's first run red for a reason that was not a
    # rendering defect.
    markup = re.sub(r"<style>.*?</style>", "", page, flags=re.S)

    for tag in ("details", "div", "p", "section"):
        opened = len(re.findall(rf"<{tag}[\s>]", markup))
        closed = len(re.findall(rf"</{tag}>", markup))
        assert opened == closed, (
            f"the page opens {opened} <{tag}> and closes {closed} — a browser "
            "will guess where the missing one ends, and the guess is not ours"
        )

    emitted = set(re.findall(r'class="([a-z ]+)"', markup))
    names = {name for value in emitted for name in value.split()}
    styled = set(re.findall(r"[.#]([a-z]+)[{ ,:\[]", render_module.CSS))
    unstyled = sorted(name for name in names if name not in styled)
    assert not unstyled, (
        f"the page emits these classes and the stylesheet has no rule for "
        f"them: {unstyled}. A block that renders unstyled is a block a reader "
        "cannot tell from body text"
    )


def test_the_board_and_the_ENGINE_agree_which_run_is_latest(repo):
    """**Two definitions of "now", answering differently.**

    This package ordered by `st_mtime`; `wringer.evidence.latest_run` orders
    by the manifest's own recorded `started_at`. A run beginning at 09:00 that
    takes two hours FINISHES after one beginning at 11:00 that takes a
    minute — so the engine answered the 11:00 run and this page answered the
    09:00 one, and the PM's page then described a different run from the one
    `wring deliver` and `wring explain` were acting on. Any `cp -r` or CI
    artifact restore rewrites mtimes wholesale.

    `read.latest_refusal`, ninety lines below the site, already refuses mtime
    for exactly this reason and says so.
    """
    import json
    import os

    from wringer import evidence as evidence_module
    from wringer_board import read as read_module

    runs = repo / ".wringer" / "runs"
    for run_id, started, finished in (
        ("20260829-090000-aaaa", "2026-08-29T09:00:00+00:00", 2_000_000_000),
        ("20260829-110000-bbbb", "2026-08-29T11:00:00+00:00", 1_000_000_000),
    ):
        directory = runs / run_id
        directory.mkdir(parents=True, exist_ok=True)
        (directory / evidence_module.MANIFEST_FILENAME).write_text(
            json.dumps({
                "schema_version": evidence_module.SCHEMA_VERSION,
                "run_id": run_id,
                "started_at": started,
                "repo": {"head_sha": "0" * 40},
                "result": {"status": "passed", "failed_gate": None},
            }),
            encoding="utf-8",
        )
        # The long run finishes LAST, so it holds the newest mtime.
        os.utime(directory, (finished, finished))

    engine = evidence_module.latest_run(runs)
    board = read_module.latest_run(repo)

    assert engine is not None and board is not None
    assert board.name == engine.name == "20260829-110000-bbbb", (
        board.name, engine.name
    )


# --- B1's only structural check, written 2026-08-30 ------------------------
#
# The ruling's own row says "Structural, because a page test cannot catch a
# server" and named two tests as the way a reviewer catches a violation.
# NEITHER EXISTED. The row's only check was the sentence claiming there was
# one, for the whole life of the surface.


_SERVER_PACKAGES = (
    "flask", "fastapi", "uvicorn", "aiohttp", "starlette", "bottle",
    "tornado", "http.server", "socketserver", "wsgiref",
)


def _source_files() -> list[Path]:
    root = Path(__file__).resolve().parent.parent.parent / "src"
    return sorted(root.rglob("*.py"))


def test_the_surface_ships_no_server():
    """**B1, and it had no check at all.**

    v0 is local and single-user: filesystem bundles, no server, no auth, no
    hosting. A page test cannot catch a server — a server is a dependency and
    an import — so this is structural, over the distribution's metadata and
    over every module it ships.

    Not over the console entry points: the row also said the package
    "registers exactly one", which stopped being true when the packages
    merged on 2026-08-20 and there were four. Asserting a number that the
    merge already falsified would fail for a reason that has nothing to do
    with servers, so the row is amended and this checks the half that is the
    ruling.
    """
    import re
    import tomllib

    root = Path(__file__).resolve().parent.parent.parent
    declared = tomllib.load((root / "pyproject.toml").open("rb"))["project"]
    named = list(declared.get("dependencies") or [])
    for extra in (declared.get("optional-dependencies") or {}).values():
        named.extend(extra)
    offenders = [
        one for one in named
        if any(one.lower().startswith(server) for server in _SERVER_PACKAGES)
    ]
    assert not offenders, f"the distribution declares a web server: {offenders}"

    files = _source_files()
    assert len(files) > 20, f"only {len(files)} modules swept — did src/ move?"
    importing = []
    for path in files:
        text = path.read_text(encoding="utf-8", errors="replace")
        for found in re.finditer(r"^\s*(?:import|from)\s+([\w.]+)", text, re.M):
            module = found.group(1)
            if any(
                module == server or module.startswith(server + ".")
                for server in _SERVER_PACKAGES
            ):
                importing.append(f"{path.name} imports {module}")
    assert not importing, (
        "a shipped module imports a server: " + "; ".join(importing)
    )


def test_the_page_makes_no_request():
    """B1's secondary check, and it did not exist either.

    Scoped to the board's own CHROME — its source literals — because ruling 7
    licenses a check's own message verbatim, and a real gate command or
    failure message may legitimately contain a URL. The chrome is what this
    package writes; gate output is data passing through it.
    """
    import re

    board = Path(__file__).resolve().parent.parent.parent / "src" / "wringer_board"
    files = sorted(board.glob("*.py"))
    assert len(files) > 4, f"only {len(files)} board modules swept"

    forbidden = re.compile(
        r"fetch\(|XMLHttpRequest|<script|<iframe|\bsrc=|<link\b|\bimport\("
    )
    offenders = []
    for path in files:
        for number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            if forbidden.search(line):
                offenders.append(f"{path.name}:{number}: {line.strip()[:80]}")
    assert not offenders, (
        "the board's own chrome would make a request: " + "; ".join(offenders)
    )



# --- 0.8.6 (P1.13): every card carries its anchor -----------------------------


def test_EVERY_CARD_CARRIES_ITS_ANCHOR_ID_in_the_boards_one_spelling(repo):
    """**Runs 4 and 4B, 2026-09-01:** the PM judged on a manual display and
    never saw which card the handover was held on — the stop named the
    refusal and the page held the card, and nothing joined them. The drive
    now points at `board.html#card-<id>`; a card without that id is a link
    that opens the page at the top while the sentence claims a card.

    `render.card_anchor` is the ONE spelling; the drive quotes it, and this
    reads the rendered page for it on every card, in both card shapes."""
    write_run(
        repo,
        "20260903-090000-aaaa",
        [
            criterion("csv", "Finance can download the figures", "evidenced",
                      receipt={"kind": "failure", "run": "20260903-085900-bbbb"}),
            criterion("glance", "The summary reads at a glance", "human",
                      gate=None, cause="human-unanswered"),
            criterion("fast", "It loads fast", "unevidenced",
                      cause="gate-did-not-run"),
        ],
    )
    page = html_of(repo)
    for cid in ("csv", "glance", "fast"):
        anchor = render_module.card_anchor(cid)
        assert anchor == f"card-{cid}"
        assert '<div class="card ' in page
        assert f' id="{anchor}">' in page, f"no card carries id={anchor!r}"
    assert page.count(' id="card-') == 3, "an id on something that is not a card"


def test_THE_READER_PUTS_EACH_LANE_WHERE_ITS_RECORD_CAME_FROM(tmp_path):
    """**The lane split, measured from records the ENGINE'S OWN SCHEMA accepts.**

    0.9.0 wrote this test with a `usage.json` of `{"prompt_tokens": …,
    "completion_tokens": …}`. No engine writes that shape —
    `wringer.usage.v1` is `{schema_version, loop_id, reported_by, verified,
    rows, totals}` with `additionalProperties: false`, and that fixture fails
    validation with seven errors. So the guard passed against a fabrication
    while the real worker lane was structurally dead, and the board told
    every reader "the builder reported nothing this run" over records saying
    44,863 tokens and 0.729392 USD.

    The fixture is validated against the frozen schema here, in the test. A
    fixture the engine could not have written is not evidence about a reader
    of engine records.
    """
    import json

    import jsonschema

    repo = tmp_path / "repo"
    spec_dir = repo / ".wringer" / "specs" / "20260904-000000-aaaa"
    spec_dir.mkdir(parents=True)
    (spec_dir / "response.json").write_text(
        json.dumps({"usage": {"prompt_tokens": 2445, "completion_tokens": 6354}}),
        encoding="utf-8",
    )

    loop_dir = repo / ".wringer" / "loops" / "20260904-000000-bbbb"
    loop_dir.mkdir(parents=True)
    # Shaped on a REAL record:
    # ~/wringer-example/project/.wringer/loops/20260827-163311-0c4c/usage.json
    record = {
        "schema_version": "wringer.usage.v1",
        "loop_id": "20260904-000000-bbbb",
        "reported_by": "agent",
        "verified": False,
        "rows": [
            {
                "iteration": 1,
                "used": 44863,
                "size": 1000000,
                "cost": {"amount": 0.729392, "currency": "USD"},
            }
        ],
        "totals": {
            "used": 44863,
            "size": 1000000,
            "sessions": 1,
            "cost": {"amount": 0.729392, "currency": "USD"},
        },
    }
    schema_path = (
        Path(__file__).resolve().parent.parent.parent / "schema" / "usage.schema.json"
    )
    jsonschema.validate(
        record, json.loads(schema_path.read_text(encoding="utf-8"))
    )
    (loop_dir / "usage.json").write_text(json.dumps(record), encoding="utf-8")

    lanes = read_module._spend(repo, None, loop_dir)

    assert lanes["drafting"] == {"prompt_tokens": 2445, "completion_tokens": 6354}
    assert lanes["worker"] == record["totals"], (
        "the worker lane does not carry what the record's own totals say — "
        "the 0.9.0 defect, where the lane could never match a real record"
    )
    assert lanes["drafting"] != lanes["worker"], "the two records became one"

    # A run whose worker reported nothing has a drafting lane and no worker
    # lane — not a worker lane of zero, and not one total wearing both names.
    only_drafting = read_module._spend(repo, None, None)
    assert set(only_drafting) == {"drafting"}
    assert only_drafting["drafting"]["prompt_tokens"] == 2445
