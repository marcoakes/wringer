"""The short version — the block a reader who reads nothing else reads.

**Written from a field report, 2026-08-28, and the reader was this product's
own product manager**, on a page that had already been through six cold reads
and four rounds of wording fixes:

    you need a fucking PhD to understand what is going on here

Nothing on the page was wrong. The page answered *"what is the state of each
requirement"* in careful, accurate, hedged language, and never answered the
three questions a person actually arrives with: **what did we ask for, what
came back, and what is wrong with it.** Every sentence assumed the reader
already knew what `bound`, `evidenced`, `red first` and `witness` mean.

Two properties are guarded here, and they are the two that decay:

1. **Every requirement is in the summary, in exactly one group.** This is
   finding 12's defect class one level up — a summary that omits the largest
   group is how a reader concludes eight of ten are fine.
2. **The block speaks no engineer.** A vocabulary list, checked against the
   rendered block. This is the whole complaint, made executable: prose that
   drifts back toward the words the rest of the page is built out of fails
   here rather than being discovered by the next person who cannot read it.
"""

from __future__ import annotations

import re
from pathlib import Path

from board_helpers import criterion, write_loop_manifest, write_refusal, write_run

from wringer_board import read as read_module
from wringer_board import render as render_module

LOOP = "20260828-090000-loop"

# **The words this block may not use.** Every one of them appears elsewhere on
# the page, correctly, in the careful register the cards are written in. None
# of them may appear HERE: this is the block for someone who has never read
# any of the rest, and a reader who has to look one of these up has been sent
# back to the page they could not read.
JARGON = (
    "bound",
    "unbound",
    "evidenced",
    "unevidenced",
    "criterion",
    "criteria",
    "red first",
    "witness",
    "receipt",
    "gate",
    "vacuity",
    "schema",
    "verdict",
    "repository",
    "commit",
    "stderr",
)


def _page(repo: Path) -> str:
    return render_module.render(read_module.read(repo))


def _short(page: str) -> str:
    """Just the block, as the text a person reads."""
    start = page.index('<section class="short"')
    end = page.index("</section>", start)
    inner = page[start:end]
    return re.sub(r"<[^>]+>", " ", inner)


def _populated(repo: Path) -> Path:
    """One of each: proved, nothing checking it, not finished, and yours."""
    write_run(
        repo,
        "20260828-085900-bbbb",
        [],
        gates={"suite": ("stderr", "assert 1 == 2")},
    )
    write_run(
        repo,
        "20260828-090000-aaaa",
        [
            criterion(
                "csv",
                "The export downloads as a spreadsheet",
                "evidenced",
                receipt={"kind": "failure", "run": "20260828-085900-bbbb"},
            ),
            criterion(
                "fast",
                "The export finishes inside a minute",
                "unevidenced",
                gate=None,
                reason="no gate proves this criterion",
                refuses=True,
            ),
            criterion(
                "columns",
                "Every column the report shows is in the file",
                "gate-failed",
                refuses=True,
            ),
            criterion(
                "readable",
                "A person can tell what the file is for",
                "human",
                reason="nobody has judged this",
                refuses=True,
            ),
        ],
    )
    write_loop_manifest(repo, LOOP, "converged")
    return repo


def test_the_short_version_is_the_FIRST_thing_after_the_title(repo):
    """Above the promise and above the counts, or it is not a summary.

    Both of those are answers to questions a reader has to already know to
    ask. This is the answer to the one they arrived with, so it goes first.
    """
    page = _page(_populated(repo))
    assert page.index('class="short"') < page.index('class="promise"')
    assert page.index('class="short"') < page.index('class="counts"')
    assert page.index("<h1>") < page.index('class="short"')


def test_every_requirement_appears_in_the_summary_exactly_once(repo):
    """Finding 12's defect class, one level up.

    The count line once read *"1 requirement · 1 done and proved"* over ten
    criteria. A summary that silently drops the largest group is worse than no
    summary: a reader who reads only the summary — which is what a summary is
    FOR — concludes the omitted rows are fine.
    """
    short = _short(_page(_populated(repo)))
    titles = [
        "The export downloads as a spreadsheet",
        "The export finishes inside a minute",
        "Every column the report shows is in the file",
        "A person can tell what the file is for",
    ]
    for title in titles:
        assert short.count(title) == 1, (
            f"{title!r} appears {short.count(title)} times in the short "
            "version; every requirement belongs in exactly one group"
        )


def test_the_short_version_speaks_no_engineer(repo):
    """The complaint, made executable.

    This is the guard that would have caught the page the field report was
    written about, and it is the one that stops the wording drifting back.
    """
    short = _short(_page(_populated(repo))).lower()
    found = [word for word in JARGON if word in short]
    assert not found, (
        f"the short version uses words a product manager has to already "
        f"know: {found}. Everything below this block may; this block may not"
    )


def test_the_short_version_says_what_came_back_in_the_engines_own_words(repo):
    """Never a sentence written in `render.py`.

    `refusals.say` owns every word a PM reads about how a round ended. A
    second copy of that wording inside the summary is how a summary and the
    detail below it come to disagree about the same run.
    """
    short = _short(_page(_populated(repo)))
    assert "The work finished" in short


def test_the_handover_line_agrees_with_the_rows_that_refuse(repo):
    """One partition, and now a fourth reader of it.

    The badge, the body sentence, the count line and this line are all
    functions of `cards.BLOCKED_ON_*`. Three of them disagreeing once is what
    put nine demands for attention on a page whose summary counted two.
    """
    short = _short(_page(_populated(repo)))
    assert "cannot be handed over yet" in short
    assert "3 of 4" in short
    assert "waiting on you" in short
    assert "waiting on an engineer" in short
    assert "waiting on the work" in short


def test_the_summary_never_clears_a_handover_the_ENGINE_refused(repo):
    """**The contradiction the first draft of this block shipped.**

    Written from the first real board it rendered against: every card carried
    `refuses: false`, the round section three inches below carried the
    engine's `delivery-refusal`, and the summary — reading only the cards —
    announced *"Nothing on this page is holding up the handover"* directly
    above *"The handover is being held"*.

    `refuses` is a per-criterion fact and is not the delivery's verdict. A run
    can be refused for a reason no single row carries: five unproved
    requirements refuse the delivery while each of them, on its own, waits on
    nobody. The engine's refusal wins, and it wins in the engine's own words.
    """
    write_run(
        repo,
        "20260828-090000-aaaa",
        [
            criterion(
                "fast",
                "The export finishes inside a minute",
                "unevidenced",
                gate=None,
                reason="no gate proves this criterion",
                refuses=False,
            )
        ],
    )
    write_loop_manifest(repo, LOOP, "converged")
    write_refusal(
        repo,
        "20260828-090100-rrrr",
        "acceptance_unevidenced",
        run="20260828-090000-aaaa",
    )
    short = _short(_page(repo))
    assert "Nothing on this page is holding up the handover" not in short, (
        "the summary cleared a handover the engine refused"
    )
    assert "The handover is being held" in short


def test_an_UNTRANSLATED_refusal_still_holds_the_handover(repo):
    """**The half of that fix that was missed, and it is reproduced.**

    The block above keys on `say()` RETURNING a sentence. An untranslated
    reason — one whose value is not in `MAPPING`, which is every reason added
    to the engine before this surface catches up — makes `say()` return None,
    the search falls through, and the page renders *"Nothing on this page is
    holding up the handover"* directly above the round section's
    `UNTRANSLATED a_brand_new_reason`.

    Not having words for a refusal is a reason to SAY SO. It is never a
    reason to say the opposite.
    """
    write_run(
        repo,
        "20260828-090000-aaaa",
        [
            criterion(
                "fast",
                "The export finishes inside a minute",
                "unevidenced",
                gate=None,
                reason="no gate proves this criterion",
                refuses=False,
            )
        ],
    )
    write_loop_manifest(repo, LOOP, "converged")
    write_refusal(
        repo,
        "20260828-090100-rrrr",
        "a_brand_new_reason",
        run="20260828-090000-aaaa",
    )
    short = _short(_page(repo))

    assert "Nothing on this page is holding up the handover" not in short, (
        "the summary cleared a handover the engine refused, because this "
        "surface had no words for the reason"
    )
    assert "cannot be handed over yet" in short, short
    assert "a_brand_new_reason" in short, short


def test_a_refusal_about_an_OLDER_run_is_history_and_not_the_verdict(repo):
    """**Field report 2026-08-28, and the promise was already in the code.**

    `read.py` said, above the line that reads these records: *"a refusal from
    last week that somebody has since fixed is history, not a verdict about
    the work in front of you."* It was a promise about `latest_refusal`, which
    sorts records by name and knows nothing about which run is on the page.

    On the repository this was found in, yesterday's refusal — *the handover
    is held because a person judged a requirement NOT met* — was still being
    rendered as the current verdict after the person had judged it met, the
    work had been fixed, and two further runs had been recorded.
    """
    # **Cited run FIRST.** `latest_run` falls back to mtime, so the run this
    # page renders has to be the one written last — write them the other way
    # round and the board renders the very run the refusal names, which is not
    # the situation this test is about.
    write_run(
        repo,
        "20260828-085900-bbbb",
        [],
        gates={"suite": ("stderr", "assert 1 == 2")},
    )
    write_run(
        repo,
        "20260828-090000-aaaa",
        [
            criterion(
                "csv",
                "The export downloads as a spreadsheet",
                "evidenced",
                receipt={"kind": "failure", "run": "20260828-085900-bbbb"},
            )
        ],
    )
    write_loop_manifest(repo, LOOP, "converged")
    write_refusal(
        repo,
        "20260828-085930-rrrr",
        "acceptance_unevidenced",
        run="20260828-085900-bbbb",  # an OLDER run than the one rendered
    )
    short = _short(_page(repo))
    assert "The handover is being held" not in short, (
        "a refusal about a run this page is not rendering was shown as the "
        "current verdict"
    )
    assert "Nothing on this page is holding up the handover" in short


def test_a_page_with_nothing_refusing_says_the_handover_is_clear(repo):
    write_run(
        repo,
        "20260828-085900-bbbb",
        [],
        gates={"suite": ("stderr", "assert 1 == 2")},
    )
    write_run(
        repo,
        "20260828-090000-aaaa",
        [
            criterion(
                "csv",
                "The export downloads as a spreadsheet",
                "evidenced",
                receipt={"kind": "failure", "run": "20260828-085900-bbbb"},
            )
        ],
    )
    write_loop_manifest(repo, LOOP, "converged")
    short = _short(_page(repo))
    assert "Nothing on this page is holding up the handover" in short
    assert "cannot be handed over yet" not in short


def test_a_BORN_GREEN_row_is_not_counted_as_unchecked(repo):
    """**Three answers to one question, on one page, in the same eye.**

    `BLOCKED_ON_ENGINEER` is `(NOT_PROVABLE, NEEDS_AN_ENGINEER,
    UNTRANSLATED)` and only the first means nothing is watching. A born-green
    row is `NEEDS_AN_ENGINEER`: its own card reads "The check passes, but it
    has never been recorded failing", and the summary above it counted it
    under "Nothing is testing them at all" while the count line called it "no
    working check".

    An UNTRANSLATED row is worse: the board has explicitly refused to say
    anything about it, and this said something.
    """
    write_run(
        repo,
        "20260828-090000-aaaa",
        [
            criterion(
                "fast",
                "The export finishes inside a minute",
                "unevidenced",
                gate="suite",
                cause="born-green",
                reason="`suite` passed and has never been recorded failing",
                refuses=True,
            )
        ],
    )
    write_loop_manifest(repo, LOOP, "converged")
    short = _short(_page(repo))

    assert "Nothing is testing them at all" not in short, short
    assert "an engineer has to look at" in short.lower(), short

