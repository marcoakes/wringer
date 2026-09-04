"""One screen, one file. SPEC_BOARD_V0 §3 and §7.

Static-first and self-contained: inline CSS, no network, no fonts to fetch, no
server. B1 — the layer is local and single-user — and the probe's single HTML
file is the existence proof this is enough.

**B4, the copy ceiling.** No YAML, no exit codes, no paths, no gate ids, no run
ids in the board's own chrome. Two deliberate exceptions, both on the card and
both because removing them costs the PM information they need: the message the
check printed, verbatim in a block attributed to the check, and the attempt
ordinal with its timestamp. A third, in the header (pd-board, 2026-09-03,
P1.14): the journey and run identity in one small monospace line — runs 4/4B
showed a PM four unrelated ids across four surfaces and nothing joining them,
and the join is the one id worth a line above the fold. Everything else
technical lives in one page-level collapsed block addressed to engineers.

**The outcome rail and the counts strip** (pd-board, 2026-09-03). Runs 4/4B,
2026-09-01: the PM read "green" as "everything proved". Six segments in a
fixed order — Built · Checks passing · Requirements proved · Human judgement ·
Ready to deliver · Delivered — each derived from ONE fact this reader already
holds, each with one of three glyphs, and a segment whose fact is not on disk
says "not known here". No score, no percentage, and the word "green" appears
nowhere on the page as a word about the whole.

**The Q1 ceiling, which no string here may exceed:** a witness proves the
stated criterion could fail and was made to pass; it does not certify agreement
with an unstated intended fix. Nothing on this page may say the check catches
wrong fixes.
"""

from __future__ import annotations

import html
import json
from pathlib import Path

from wringer_board import refusals
from wringer_board.cards import (
    BLOCKED_ON_ENGINEER,
    BLOCKED_ON_PERSON,
    BLOCKED_ON_THE_WORK,
    DONE,
    INDETERMINATE,
    NEEDS_AN_ENGINEER,
    NEEDS_YOU,
    NOT_PROVABLE,
    NOT_REACHED,
    NOT_YET,
    SETTLED,
    UNKNOWN,
    UNTRANSLATED,
    Card,
    card_for,
    promise_earned,
    waiting_on,
)
from wringer_board.read import Board, UnknownVersion

# **Derived over `cards.STATES`, so a new state cannot render unstyled.**
# Four semantic tones and nothing else (pd-board, 2026-09-03): proved is
# green, a person's lane (`needsyou`) is blue, everything unproved — not yet,
# not reached, nothing checks it, needs an engineer — is amber, and the two
# the board cannot read are neutral. `needsyou` no longer shares a colour
# with the engineer's debts, which is what finding 12 (2026-08-21) was about:
# nine amber demands for attention on a page whose summary counted two.
_STATE_CLASS = {
    DONE: "done",
    NOT_YET: "notyet",
    NOT_REACHED: "notreached",
    NEEDS_YOU: "needsyou",
    NOT_PROVABLE: "notprovable",
    NEEDS_AN_ENGINEER: "needsengineer",
    UNKNOWN: "unknown",
    UNTRANSLATED: "untranslated",
}

CSS = """
:root{--ink:#1b1f27;--dim:#5b6472;--line:#dfe3e8;--bg:#f4f6f8;--card:#fff;--well:#f7f8fa;
--green:#166534;--greenb:#dcfce7;--blue:#1e40af;--blueb:#dbeafe;
--amber:#854d0e;--amberb:#fef3c7;--red:#991b1b;--redb:#fee2e2;--grey:#4b5563;--greyb:#e9edf2;
--done:var(--green);--doneb:var(--greenb)}
@media (prefers-color-scheme:dark){:root{--ink:#e6e8ec;--dim:#a2a9b4;--line:#2a2f3a;
--bg:#0f1115;--card:#171a21;--well:#1d212a;
--green:#86efac;--greenb:#14301f;--blue:#93c5fd;--blueb:#172554;
--amber:#fcd34d;--amberb:#3b2a08;--red:#fca5a5;--redb:#3f1515;--grey:#b3bac6;--greyb:#262b35}}
*{box-sizing:border-box;min-width:0}
html{color-scheme:light dark}
body{margin:0;background:var(--bg);color:var(--ink);
font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:60rem;margin:0 auto;padding:2rem 1.5rem 5rem}
h1{font-size:1.5rem;line-height:1.25;margin:0 0 .25rem;letter-spacing:-.01em;
overflow-wrap:anywhere;text-wrap:balance}
h2{font-size:1.25rem;line-height:1.3;margin:0 0 .75rem;letter-spacing:-.01em}
p{margin:0 0 .5rem;max-width:72ch}
code,pre,.said,.ident{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
overflow-wrap:anywhere}
code{font-size:.875em;background:var(--well);border:1px solid var(--line);border-radius:4px;
padding:0 .3em}
pre{margin:0;white-space:pre-wrap}
/* --- the header: title, identity, the outcome rail, the counts strip ------ */
.top{margin:0 0 1.5rem}
.ident{display:block;font-size:.8125rem;color:var(--dim);margin:0 0 1rem;max-width:none}
.ident code{background:none;border:0;padding:0;font-size:1em}
.rail{list-style:none;margin:0 0 .5rem;padding:0;display:grid;gap:.5rem;
grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr))}
.seg{border:1px solid var(--line);border-radius:6px;background:var(--card);
padding:.625rem .75rem;display:grid;grid-template-columns:auto 1fr;column-gap:.5rem;
align-items:start}
.glyph{display:inline-block;width:1.375rem;height:1.375rem;line-height:1.375rem;text-align:center;
border-radius:999px;font-weight:700;font-size:.875rem}
.met .glyph{background:var(--greenb);color:var(--green)}
.unmet .glyph{background:var(--redb);color:var(--red)}
.absent .glyph{background:var(--greyb);color:var(--grey)}
.lab{font-weight:600;font-size:.875rem;line-height:1.375rem}
.note{grid-column:2;font-size:.8125rem;line-height:1.4;color:var(--dim);margin:.125rem 0 0}
.tiles{display:grid;gap:.5rem;margin:0 0 .5rem;
grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr))}
.tile{border:1px solid var(--line);border-left:4px solid var(--grey);border-radius:6px;
background:var(--card);padding:.625rem .75rem}
.proved{border-left-color:var(--green)}
.person{border-left-color:var(--blue)}
.unproved{border-left-color:var(--amber)}
.contradicted{border-left-color:var(--red)}
.num{display:block;font-size:1.5rem;font-weight:700;line-height:1.2;font-variant-numeric:tabular-nums}
.tile .lab{display:block;line-height:1.4}
.tile .note{display:block}
/* --- the PM material ------------------------------------------------------ */
.intent{color:var(--dim);margin:0;max-width:72ch}
.promise{border:1px solid var(--line);border-left:4px solid var(--done);
background:var(--doneb);padding:.75rem 1rem;border-radius:6px;margin:0 0 .5rem;font-weight:600;
color:var(--ink)}
.promise.withheld{border-left-color:var(--grey);background:var(--greyb);font-weight:400;color:var(--dim)}
.withheld{color:var(--dim)}
.counts{color:var(--dim);font-size:.875rem;margin:0 0 1.5rem}
.reqs{margin:0 0 1.5rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;
padding:.875rem 1rem;margin:0 0 .5rem}
.card h2{font-size:1.05rem;margin:0 0 .5rem;font-weight:600;line-height:1.35;letter-spacing:0;
display:flex;flex-wrap:wrap;gap:.25rem .625rem;align-items:baseline}
.state{display:inline-block;font-size:.6875rem;font-weight:700;letter-spacing:.06em;line-height:1.6;
text-transform:uppercase;padding:.0625rem .5rem;border-radius:4px;white-space:nowrap}
.done .state{background:var(--greenb);color:var(--green)}
.needsyou .state{background:var(--blueb);color:var(--blue)}
.notyet .state,.notreached .state,.notprovable .state,.needsengineer .state{
background:var(--amberb);color:var(--amber)}
.unknown .state,.untranslated .state{background:var(--greyb);color:var(--grey)}
.badge{display:inline-block;font-size:.6875rem;font-weight:700;letter-spacing:.06em;line-height:1.6;
text-transform:uppercase;padding:.0625rem .5rem;border-radius:4px;background:var(--redb);color:var(--red)}
.ask{margin:.5rem 0 0;padding-top:.5rem;border-top:1px solid var(--line);font-weight:600;color:var(--ink)}
.needsyou .ask{color:var(--blue)}
.done .ask,.notreached .ask{font-weight:400;color:var(--dim)}
.said{margin:.75rem 0 0;padding:.625rem .875rem;background:var(--well);border:1px solid var(--line);
border-radius:5px;font-size:.8125rem;line-height:1.5;white-space:pre-wrap;color:var(--ink)}
.said .who{display:block;font-family:inherit;font-size:.6875rem;color:var(--dim);
margin:0 0 .375rem;text-transform:uppercase;letter-spacing:.05em}
/* F14: the card's check output is collapsible, so it must inherit none of
   the page-level disclosure chrome below — no gap, no rule above it.
   Shut it is one line; open it is exactly the block it always was.
   No tag names in angle brackets here: a literal one inside a stylesheet
   comment makes every tag-counting reader of this page see an unclosed
   element, which is how the well-formedness guard first went red. */
.card details.said{margin:.75rem 0 0;border-top:none;padding-top:.625rem;font-size:.8125rem}
.card details.said summary.who{margin:0;color:var(--dim);list-style:revert;cursor:pointer}
.card details.said[open] summary.who{margin:0 0 .375rem}
/* **The scope sentence had NO rule at all** — found 2026-08-22 by a guard
   over every class the page emits. It sits INSIDE the monospace log block,
   so with no styling it rendered in the check's own typeface and read as one
   more line the check had printed. That is the opposite of what it is for:
   it is the board speaking ABOUT the log, and F14's structural answer leans
   on the reader meeting it as such at the moment they open the block. */
.said .scope,.said .nowpasses{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
font-size:.8125rem;color:var(--dim);margin:.625rem 0 0;padding-top:.5rem;border-top:1px solid var(--line);
white-space:normal}
.nowpasses{color:var(--ink)}
.wasred{margin:.75rem 0 0;padding:.625rem .875rem;border:1px solid var(--line);
border-left:4px solid var(--green);background:var(--greenb);border-radius:5px;font-size:.875rem;color:var(--ink)}
.wasred b{color:var(--green)}
.checknote{margin:.75rem 0 0;padding:.625rem .875rem;border:1px solid var(--line);
border-left:4px solid var(--amber);background:var(--amberb);border-radius:5px;font-size:.875rem;color:var(--ink)}
.checknote b{color:var(--amber);text-transform:uppercase;font-size:.6875rem;letter-spacing:.06em;
margin-right:.375rem}
/* The card's longer material — receipt, check output, notes, the environment
   guess — behind one shut disclosure per row, so a scanning reader meets a
   badge, a title and one sentence per requirement. Open in print. */
.more{margin:.5rem 0 0;font-size:.875rem;color:var(--dim)}
.more summary{cursor:pointer;color:var(--dim);font-size:.8125rem}
.more[open] summary{margin:0 0 .25rem}
.refusal{border:1px solid var(--red);border-left:4px solid var(--red);background:var(--redb);
padding:.875rem 1rem;border-radius:6px;margin:0 0 1rem;color:var(--ink)}
.refusal p{max-width:none}
.round{margin:0 0 1.5rem;padding:0}
.round h2{font-size:.8125rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
color:var(--dim);margin:0 0 .75rem}
.round p{margin:0 0 .625rem;padding:0 0 0 .875rem;border-left:2px solid var(--line)}
.round .untranslated{padding:0 0 0 .875rem;border-left:2px solid var(--grey);margin:0 0 .625rem}
.round .said{margin-top:.375rem}
/* **The short version.** Field report 2026-08-28, and the reader was the
   product manager this whole surface is for: *"you need a fucking PhD to
   understand what is going on here."* Everything below this block is true and
   was written for someone who already knows what bound, red-first and
   evidenced mean. This block assumes none of it. */
.short{border:1px solid var(--line);border-radius:8px;background:var(--card);
padding:1rem 1.25rem;margin:0 0 1rem}
.short h2{font-size:.8125rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
color:var(--dim);margin:0 0 .75rem}
.short dl{margin:0}
.short dt{font-weight:600;font-size:.9375rem;margin:.875rem 0 .125rem}
.short dt:first-of-type{margin-top:0}
.short dd{margin:0;color:var(--ink)}
.short dd .why{color:var(--dim);font-size:.875rem}
.short ul{margin:.25rem 0 0;padding-left:1.25rem}
.short li{margin:0 0 .125rem}
.short .verdict{margin:1rem 0 0;padding:.75rem .875rem;border-radius:5px;font-weight:600;max-width:none;
background:var(--greyb);border-left:4px solid var(--grey)}
.short .verdict.held{background:var(--amberb);border-left-color:var(--amber);color:var(--amber)}
.held{color:var(--amber)}
.short .verdict.clear{background:var(--greenb);border-left-color:var(--green);color:var(--green)}
.clear{color:var(--green)}
.verdict{font-weight:600}
/* --- the tail: usage, limits, the requirements document, engineers ------- */
.tail{margin-top:2rem;border-top:1px solid var(--line);padding-top:1rem;font-size:.875rem;color:var(--dim)}
.spend{margin:0 0 .75rem}
.tail details{margin:0 0 .75rem}
.tail summary{cursor:pointer;color:var(--ink);font-weight:500}
.tail details[open] summary{margin:0 0 .5rem}
.tail li{margin-bottom:.5rem;overflow-wrap:anywhere}
.tail ul{padding-left:1.25rem}
@media (max-width:40rem){
.wrap{padding:1.25rem 1rem 4rem}
h1{font-size:1.25rem}
.card{padding:.75rem .875rem}
.short{padding:.875rem 1rem}}
@media print{
body{background:#fff;color:#000}
.wrap{max-width:none;padding:0}
.card,.seg,.tile,.short,.promise{break-inside:avoid}
details::details-content{display:block;content-visibility:visible}}
"""


def _esc(text: str | None) -> str:
    return html.escape(text or "", quote=False)


def _engine_words(text: str) -> str:
    """**Ruling 17's one mechanism**, used by a card and by a round fact alike.

    The engine's own words, verbatim, inside a visible state — never
    swallowed, never prettified. It lives in one function because a second
    copy of it is how one of the two paths quietly stops being verbatim.
    """
    return (
        '<div class="said"><span class="who">Wringer said, and this board '
        "has no plain-English wording for it yet</span>"
        f"{_esc(text)}</div>"
    )


def _round_html(board: Board) -> str:
    """What else this round recorded, one plain-language line per fact.

    **Not a criterion card, and it must not look like one** — no card box, no
    per-fact heading, no state chip except the UNTRANSLATED one, which is a
    refusal to translate rather than a verdict about a requirement. A reader
    must never mistake "the work stopped because it ran out of attempts" for a
    requirement that failed.

    **Only facts that EXIST** (ruling 11, widened from vacuity and health to
    all seven). An absent artifact contributes nothing, so an unsigned page and
    a page nobody audited are the same page — because they are the same fact:
    *nobody looked.* Rendering absence as a verdict is the defect class this
    project exists to catch, and it is one line of code away in every one of
    these families.

    Every sentence comes from `refusals.say` and nowhere else. There is no
    wording in this function, which is what keeps the two greps in
    `test_refusals.py` exhaustive over what a PM can read here.
    """
    if not board.facts:
        return ""
    parts = ['<section class="round"><h2>What happened in this round</h2>']
    for fact in board.facts:
        saying = refusals.say(fact.family, fact.value)
        if saying is None:
            parts.append(
                f'<div class="untranslated"><span class="state">'
                f"{_esc(UNTRANSLATED)}</span>{_engine_words(fact.value)}</div>"
            )
        else:
            parts.append(f"<p>{_esc(saying.sentence)}</p>")
    parts.append("</section>")
    return "\n".join(parts)


def _marked(text: str) -> str:
    """`**bold**` from the engine's sentence, escaped, and nothing else.

    The engine words these lines in markdown because three of the four
    surfaces that carry them are markdown files. This is the fourth, and it
    renders exactly one construct rather than pulling in a markdown parser to
    put a number in bold — everything else in the string is escaped, so a
    sentence that ever carried angle brackets stays text.
    """
    import re

    return re.sub(
        r"\*\*(.+?)\*\*", r"<strong>\1</strong>", _esc(text)
    )


def _environment_sentence(recorded: dict) -> str | None:
    """The ENGINE's sentence for a diagnosis's face, or None.

    One reader for it, used by the card and by the engineers' block alike,
    because a second copy is how the two come to say different things about
    one record.
    """
    try:
        from wringer import diagnose as diagnose_module

        return diagnose_module.DESCRIPTIONS.get(recorded.get("face"))
    except Exception:  # pragma: no cover - a hint never breaks the page
        return None


def _coverage_lines(board: Board) -> list[str]:
    """The engine's coverage sentences, or nothing at all.

    **Guarded, and the guard is the seam.** The board must load and render
    with no engine importable — `test_layer_seam.py` proves it in a
    subprocess — so this import is inside the function and its failure is
    caught. A board without the engine simply has no coverage sentences, and
    says nothing rather than guessing at them.
    """
    if not board.coverage:
        return []
    try:
        from wringer import coverage as coverage_module
    except Exception:  # pragma: no cover - the board never fails on an import
        return []
    try:
        return coverage_module.lines(coverage_module.of(board.coverage))
    except Exception:  # pragma: no cover - a hint never breaks the page
        return []


def _titles(cards: list[Card], states: tuple[str, ...]) -> list[str]:
    return [card.title or card.id for card in cards if card.state in states]


def _bullets(titles: list[str]) -> str:
    return "<ul>" + "".join(f"<li>{_esc(one)}</li>" for one in titles) + "</ul>"


def _headline_html(board: Board, cards: list[Card]) -> str:
    """The whole page in plain English, for a reader who reads nothing else.

    **Field report 2026-08-28, and the reader was Wringer's own product
    manager**, on a page that had already survived six cold reads: *"you need a
    PhD to understand what is going on here."* He was right, and nothing below
    was wrong — the page answered "what is the state of each requirement" in
    careful, hedged, accurate language, and never answered the three questions
    a person actually arrives with: **what did we ask for, what came back, and
    what is wrong with it.**

    So this block asks nothing of the reader's vocabulary. No `bound`, no
    `evidenced`, no `red first`, no `witness`, no `criterion` — the words the
    rest of the page is built out of appear nowhere in it. It says what was
    asked for, names what came back, names what did not, and says in one line
    whether any of it can be handed over.

    It repeats what the cards below say, deliberately. A summary that only
    forwarded to the detail would be one more thing to read before the answer.
    """
    proved = _titles(cards, SETTLED)
    yours = _titles(cards, BLOCKED_ON_PERSON)
    # **Split, because "nothing is testing them at all" was asserted over rows
    # whose own card says the check passes.** `BLOCKED_ON_ENGINEER` is
    # `(NOT_PROVABLE, NEEDS_AN_ENGINEER, UNTRANSLATED)`, and only the first
    # means nothing is watching. A born-green row is `NEEDS_AN_ENGINEER`: its
    # card reads "The check passes, but it has never been recorded failing",
    # and this summary counted it under "Nothing is testing them at all" — two
    # answers to one question on one page, in the same reader's eye. An
    # UNTRANSLATED row is worse: the board has explicitly refused to say
    # anything about it, and this said something.
    unwatched = _titles(cards, (NOT_PROVABLE,))
    engineer_other = _titles(
        cards, tuple(s for s in BLOCKED_ON_ENGINEER if s != NOT_PROVABLE)
    )
    unfinished = _titles(cards, BLOCKED_ON_THE_WORK)
    unreadable = _titles(cards, INDETERMINATE)
    total = len(cards)

    # **No "what you asked for" row.** It was written, rendered, and read back
    # as the page title repeated word for word twenty pixels below itself —
    # the `h1` IS what was asked for. A summary that opens by restating the
    # heading teaches the reader that this block is padding.
    parts = ['<section class="short"><h2>The short version</h2><dl>']

    # **What came back, from the round's own fact** — never a sentence written
    # here. `refusals.say` owns every word a PM reads about how a round ended,
    # and a second copy of that wording in a summary block is how the summary
    # and the detail come to disagree about the same run.
    ending = next(
        (
            refusals.say(fact.family, fact.value)
            for fact in board.facts
            if fact.family == refusals.LOOP_ENDING
        ),
        None,
    )
    if ending is not None:
        parts.append("<dt>What came back</dt>")
        parts.append(f"<dd>{_esc(ending.sentence)}</dd>")

    if proved:
        parts.append(
            f"<dt>What is actually proved — {len(proved)} of {total}</dt><dd>"
            + _bullets(proved)
            + '<p class="why">Each of these was checked by something that was '
            "watched to fail first, so a tick here means it did not work "
            "before and does work now.</p></dd>"
        )
    else:
        parts.append(
            f"<dt>What is actually proved — none of the {total}</dt>"
            "<dd>Nothing on this page has a check that was watched to fail "
            "and then pass.</dd>"
        )

    if unwatched:
        parts.append(
            f"<dt>What nobody is checking — {len(unwatched)} of {total}</dt><dd>"
            + _bullets(unwatched)
            + '<p class="why">These are not failing. Nothing is testing them '
            "at all, so this page cannot tell you either way. That is an "
            "engineer's job to fix, not yours.</p></dd>"
        )

    if engineer_other:
        parts.append(
            f"<dt>What an engineer has to look at — {len(engineer_other)} of "
            f"{total}</dt><dd>"
            + _bullets(engineer_other)
            + '<p class="why">Something IS checking these, and what the record '
            "says about them cannot be turned into an answer yet. That is an "
            "engineer's job to fix, not yours.</p></dd>"
        )

    if unfinished:
        parts.append(
            f"<dt>What is not finished — {len(unfinished)} of {total}</dt><dd>"
            + _bullets(unfinished)
            + '<p class="why">The work on these is not done yet.</p></dd>'
        )

    if yours:
        parts.append(
            f"<dt>What only you can decide — {len(yours)} of {total}</dt><dd>"
            + _bullets(yours)
            + '<p class="why">No check can settle these. They need a person to '
            "look and say.</p></dd>"
        )

    if unreadable:
        parts.append(
            f"<dt>What this page could not read — {len(unreadable)} of "
            f"{total}</dt><dd>"
            + _bullets(unreadable)
            + '<p class="why">The record says something this page does not '
            "understand, so it is showing you nothing rather than a guess."
            "</p></dd>"
        )

    # **How much of it anybody is watching, which the lists above do not
    # say.** They partition the requirements by what this ROUND found; this
    # counts what is BOUND, and the two differ exactly where it matters — a
    # check that exists and has never been red is not "nobody is checking",
    # and a requirement only a person can settle is not uncovered, it is
    # waiting.
    #
    # Every word comes from the engine's `coverage.lines` and none of it is
    # written here, for the same reason `refusals.say` owns every sentence in
    # the round section: two surfaces wording one number is how they come to
    # state different ones.
    said = _coverage_lines(board)
    if said:
        parts.append("<dt>How much of it anybody is watching</dt><dd>")
        parts.append(
            "<ul>" + "".join(f"<li>{_marked(one)}</li>" for one in said) + "</ul>"
        )
        parts.append("</dd>")

    parts.append("</dl>")

    # **The one line most readers came for, and the first draft got it wrong
    # in the most instructive way.**
    #
    # It read `card.refused` alone. On the very first real board it rendered
    # against, EVERY card had `refuses: false` and the round section three
    # inches below carried `delivery-refusal: acceptance_unevidenced` — so the
    # page said *"Nothing on this page is holding up the handover"* directly
    # above *"The handover is being held"*. Two answers to the one question a
    # summary exists to answer, which is the exact defect class findings 12 and
    # 13 were about, reintroduced by the block written to cure them.
    #
    # `refuses` is a per-criterion fact and it is not the delivery's verdict:
    # a run can be refused for reasons no single row carries — five unproved
    # requirements refuse the delivery while each of them, individually, is
    # waiting on nobody. **The engine's delivery refusal is the authority**,
    # and its own sentence is what gets rendered; the card partition is only
    # consulted when the record carries no refusal at all.
    # **Keyed on the FACT EXISTING, not on `say()` returning a sentence.**
    #
    # The comment above describes this defect and the fix missed half of it:
    # an UNTRANSLATED refusal — one whose value is not in `MAPPING`, which is
    # every reason added to the engine before the board catches up — made
    # `say()` return None, so the search fell through and the page rendered
    # *"Nothing on this page is holding up the handover"* directly above the
    # round section's `UNTRANSLATED a_brand_new_reason`. Reproduced. The
    # engine's refusal is the authority whether or not this surface has words
    # for it; not having words is a reason to say so, never a reason to say
    # the opposite.
    withheld = next(
        (
            fact
            for fact in board.facts
            if fact.family == refusals.DELIVERY_REFUSAL
        ),
        None,
    )
    refusal = (
        refusals.say(withheld.family, withheld.value)
        if withheld is not None
        else None
    )
    held = [card for card in cards if card.refused]
    if refusal is not None:
        parts.append(f'<p class="verdict held">{_esc(refusal.sentence)}</p>')
    elif withheld is not None:
        # The engine's own word, quoted, because inventing a friendlier one
        # for a reason this version has never met is the guess the
        # UNTRANSLATED chip exists to refuse.
        parts.append(
            '<p class="verdict held">This cannot be handed over yet. The '
            "engine held it for a reason this page has no words for: "
            f"<code>{_esc(withheld.value)}</code>.</p>"
        )
    elif held:
        who = sorted({waiting_on(card.state) for card in held})
        parts.append(
            '<p class="verdict held">This cannot be handed over yet: '
            f"{len(held)} of {total} {'thing is' if len(held) == 1 else 'things are'} "
            f"holding it up, and {' and '.join(who)}.</p>"
        )
    else:
        parts.append(
            '<p class="verdict clear">Nothing on this page is holding up the '
            "handover.</p>"
        )
    parts.append("</section>")
    return "\n".join(parts)


def card_anchor(criterion_id: str) -> str:
    """The one place a card's page anchor is spelled (0.8.6, P1.13).

    `board.html#card-<criterion id>` is how a terminal step points a person
    at ONE card, and the drive quotes this rather than composing its own —
    two spellings of one anchor would be a link that opens the page at the
    top and a sentence claiming it opened on the card. Runs 4 and 4B
    (2026-09-01): the PM judged on a manual display and never saw which
    card the handover was held on.
    """
    return f"card-{criterion_id}"

# **The outcome rail** (pd-board, 2026-09-03; P1.8's six states, in P1.8's
# order). Runs 4/4B, 2026-09-01: the PM read "green" as "everything proved",
# because the page had no status a person reads at a glance — every card was
# a paragraph and the counts lived in sentences. Six segments, this order,
# and a test pins the order and the glyph set.
def _rail_order() -> tuple[str, ...]:
    """The six labels, IN THE ENGINE'S ORDER and the engine's words (0.8.5).

    **The debt 0.8.3 recorded, paid.** This page shipped its own copy of the
    six states two releases before `certificate.md`, `summary.md` and
    `mr.md` got them from `wringer.outcome` — so for two releases the board
    and the artifacts each held a spelling of one vocabulary, which is the
    two-surfaces-one-fact drift this whole programme keeps finding. The
    board asks; a board with no engine present keeps the last-known words
    and says nothing it cannot support, exactly as every other admitted
    import here behaves.
    """
    try:
        from wringer import outcome
    except Exception:  # pragma: no cover - a board with no engine beside it
        return _FALLBACK_ORDER
    return tuple(outcome.WORDS[state] for state in outcome.STATES)


#: What the labels were when this page was written, for a board installed
#: without the engine. Never a second DEFINITION: the engine decides, and
#: this is only what to print when nothing can be asked.
_FALLBACK_ORDER = (
    "Built",
    "Checks passing",
    "Requirements proved",
    "Human judgement complete",
    "Ready to deliver",
    "Delivered",
)
MET, UNMET, ABSENT = "met", "unmet", "absent"
GLYPHS = {MET: "✓", UNMET: "✗", ABSENT: "—"}
NOT_KNOWN = "not known here"


def _rail_facts(board: Board, cards: list[Card]) -> list[tuple[str, str, str]]:
    """`(label, tone, note)` per segment — each from ONE fact, never inferred.

    A segment whose fact is not on disk is ABSENT and says so: no loop
    bundle is not "not built", no delivery record is not "not delivered".
    The Built and Ready segments read the SAME facts the short version reads
    (`refusals.LOOP_ENDING`, `refusals.DELIVERY_REFUSAL`), so the two cannot
    disagree about a run.
    """
    facts = {fact.family: fact.value for fact in board.facts}

    ending = facts.get(refusals.LOOP_ENDING)
    if ending is None:
        built = (ABSENT, f"{NOT_KNOWN} — no build loop is recorded for this run")
    elif ending == "converged":
        built = (MET, "the build loop finished")
    else:
        built = (UNMET, "the build loop stopped before it finished")

    if board.run_status == "passed":
        checks = (MET, "every check in this run passed")
    elif board.run_status == "failed":
        checks = (UNMET, "a check in this run failed")
    else:
        checks = (ABSENT, f"{NOT_KNOWN} — this run recorded no overall result")

    total = len(cards)
    done = sum(1 for c in cards if c.state in SETTLED)
    if total == 0:
        proved = (ABSENT, f"{NOT_KNOWN} — this record lists no requirements")
    else:
        proved = (MET if done == total else UNMET, f"{done} of {total} proved")

    humans = [c for c in board.criteria if c.state == "human"]
    judged_met = sum(
        1
        for c in humans
        if c.cause is None
        and isinstance(c.judgement, dict)
        and c.judgement.get("verdict") == "met"
    )
    if not humans:
        judgement = (ABSENT, "no requirement needs a person's judgement")
    else:
        judgement = (
            MET if judged_met == len(humans) else UNMET,
            f"{judged_met} of {len(humans)} judged met",
        )

    refused = facts.get(refusals.DELIVERY_REFUSAL)
    if refused is not None:
        ready = (UNMET, "a delivery from this run was refused")
    elif board.delivery is not None:
        ready = (MET, "a delivery was made from this run")
    else:
        ready = (ABSENT, f"{NOT_KNOWN} — no delivery has been attempted for this run")

    if board.delivery is not None:
        result = board.delivery.get("result") or {}
        pushed = isinstance(result, dict) and result.get("pushed") is True
        delivered = (MET, "pushed" if pushed else "committed, not pushed")
    else:
        delivered = (ABSENT, f"{NOT_KNOWN} — no delivery record names this run")

    tones = (built, checks, proved, judgement, ready, delivered)
    return [
        (label, tone, note)
        for label, (tone, note) in zip(_rail_order(), tones, strict=True)
    ]


def _rail_html(board: Board, cards: list[Card]) -> str:
    parts = ['<ol class="rail">']
    for label, tone, note in _rail_facts(board, cards):
        parts.append(
            f'<li class="seg {tone}"><span class="glyph">{GLYPHS[tone]}</span>'
            f'<span class="lab">{_esc(label)}</span>'
            f'<span class="note">{_esc(note)}</span></li>'
        )
    parts.append("</ol>")
    return "".join(parts)


def _tiles_html(cards: list[Card]) -> str:
    """Three labelled counts from the ONE partition the badges read, and one
    state this page cannot yet answer.

    Never a gauge.

    **`Contradicted` printed `0` beside the sentence "no audit or
    falsification has disproved a claim", and that sentence was not derived
    from anything — 2026-09-04.** No audit result and no falsification
    result is read into this page; nothing anywhere sets the number. Had a
    falsification disproved a claim, the tile would have gone on printing
    `0` and gone on making the same assertion, on the one surface a
    stakeholder reads as evidence.

    A count of zero is a claim: it says *this was looked for and not found*.
    So the tile carries the mark the rest of the product already uses for a
    fact it has no record of, and says which record is missing. When the
    fact exists the tile takes a number, and the difference between "none"
    and "not looked at" stays visible until then.
    """
    done = sum(1 for c in cards if c.state in SETTLED)
    person = sum(1 for c in cards if c.state in BLOCKED_ON_PERSON)
    unproved = sum(
        1
        for c in cards
        if c.state in BLOCKED_ON_ENGINEER + BLOCKED_ON_THE_WORK + INDETERMINATE
    )
    tiles = (
        ("proved", done, "Proved", "each was recorded failing before the fix"),
        ("person", person, "Needs a person", "only a person can settle these"),
        ("unproved", unproved, "Unproved", "no check has settled these yet"),
        (
            "contradicted",
            # The SAME glyph the rail uses for a fact with no record behind
            # it, from the same table — two spellings of "nothing on record"
            # on one page is how they drift apart.
            GLYPHS[ABSENT],
            "Contradicted",
            "nothing on record: no audit or falsification result is read "
            "into this page yet",
        ),
    )
    parts = ['<div class="tiles">']
    for klass, count, label, note in tiles:
        parts.append(
            f'<div class="tile {klass}"><span class="num">{count}</span>'
            f'<span class="lab">{_esc(label)}</span>'
            f'<span class="note">{_esc(note)}</span></div>'
        )
    parts.append("</div>")
    return "".join(parts)


def _card_html(card: Card) -> str:
    klass = _STATE_CLASS.get(card.state, "unknown")
    # `id=` on the row, so the anchor the drive prints lands here (P1.13).
    # ONE spelling, `card_anchor` — a raw id here would open the page at the
    # top while the terminal step claimed it opened on the card.
    anchor = html.escape(card_anchor(card.id), quote=True)
    parts = [f'<div class="card {klass}" id="{anchor}">']
    parts.append(
        f'<h2><span class="state">{_esc(card.state)}</span>{_esc(card.title or card.id)}</h2>'
    )
    if card.refused:
        # **The chip names who it waits on — finding 13.** Two refused rows
        # printed this identical sentence under two different badges, and
        # nothing on the page said why they differed. The clause comes from
        # `cards.WAITING_ON`, the same partition the badge and the count line
        # read, so the three cannot contradict each other.
        parts.append(
            '<p><span class="badge">Refused</span> '
            "This one is holding up the handover, and "
            f"{_esc(waiting_on(card.state))}.</p>"
        )
    if card.sentence:
        parts.append(f"<p>{_esc(card.sentence)}</p>")
    if card.engine_words:
        # Ruling 17: the engine's words verbatim, inside a visible state.
        parts.append(_engine_words(card.engine_words))
    # **The longer material goes behind ONE shut disclosure per row** (pd-board,
    # 2026-09-03): the receipt block, the check's output, the changed-check
    # note and the environment guess. Measured on run 4B's delivered page in a
    # 560px pane: every card was a paragraph, and a PM scanning for status met
    # the log before the verdict. Nothing here is reworded; it moves.
    more: list[str] = []
    if card.state == DONE:
        # **The hero.** Not the green — the green is ordinary. What sells is
        # that the same check is on the record having failed.
        # **"It was red first" is the programme's own slogan, and a product
        # manager does not speak it.** Field report 2026-08-28: red and green
        # are an engineer's words for failing and passing, and the hero line of
        # the whole surface was written in them. The fact is unchanged and the
        # sentence after it is untouched; only the words a non-engineer has to
        # already know are gone.
        more.append(
            '<div class="wasred"><b>This was watched failing before it was '
            f"fixed.</b> {_esc(card.receipt or '')}</div>"
        )
    if card.check_said:
        # **Say WHOSE check this is, or the page reads as a contradiction.**
        #
        # Six cold readers on 2026-08-19 hit the same wall: this block prints
        # a check's output, and that output names assertions whose wording
        # matches OTHER requirement cards almost exactly — cards which say
        # "Nothing checks this yet". The product manager reader:
        #
        #   "Those two statements cannot both be true. That is the difference
        #    between 'we verified 1 of 10' and 'we verified 9 of 10', and I
        #    can't tell which from the page."
        #
        # Both ARE true. One check can assert many things while being bound to
        # a single requirement, and a check proves only the requirement it is
        # bound to. The page was leaving the reader to derive that, and every
        # one of them derived the opposite.
        now_passes = (
            # **Say that it passes NOW.** Every reader on both cold runs hit
            # this: the only evidence on the page was a failing log. "I am
            # told it passes and shown it failing." The board KNEW it passes —
            # that is what DONE means — and never said so beside the red.
            '<p class="nowpasses">Those failures are the point: this is the '
            "recorded run from <b>before</b> the work, kept so that a tick "
            "means <b>this did not work before and works now</b> rather than "
            "&ldquo;nobody noticed a problem&rdquo;. The same check "
            "<b>passes today</b> — that is what marks this requirement done."
            "</p>"
            if card.state == DONE
            else ""
        )
        # **Collapsed by default, and that is the WHOLE change — F14.**
        #
        # Field report 2026-08-22 finding 14, Medium: this block prints a
        # check's raw output, and that output names assertions matching six
        # requirement cards below which read "nothing checks this". The
        # paragraph at the bottom explains why both are true, and the report's
        # verdict on it was *"technically correct and it will read as nonsense
        # to anyone not fluent in the binding model. The tests are visibly
        # right there on the page."*
        #
        # **The only permitted answer was structural.** The board's own cold
        # reads measured it: structural changes took the page from 85 to 68,
        # and ADDED EXPLANATORY PROSE made it worse, 68 → 82. So not one word
        # moves here. What moves is the shape: the raw output goes behind the
        # summary line it already had, so a reader scanning the page never
        # meets the apparently-contradicting test names at all, and a reader
        # who opens it deliberately meets the scope sentence in the same act.
        #
        # `wasred` stays outside and visible — that is the hero, and it is a
        # receipt rather than a log.
        more.append(
            '<details class="said"><summary class="who">What the check for '
            "<b>this</b> requirement printed"
            + (" <b>BEFORE the work</b>" if card.state == DONE else "")
            + f"</summary>{_esc(card.check_said)}"
            + now_passes
            + '<p class="scope">These lines are what this one requirement\'s '
            "check said. It may test more than this requirement does — but it "
            "only <b>proves</b> this one, so a requirement below saying "
            "nothing checks it is not contradicted by anything here.</p></details>"
        )
    if card.check_note:
        # **Hint tier, and it looks like one.** The engine's sentence
        # verbatim (SPEC_BOARD ruling 1), in its own neutral block — not a
        # badge, not a refusal chip, and it does not touch the state above it.
        # A changed check is a thing worth knowing before you trust a green;
        # in v0 it is not a thing that stops a handover, and the page must not
        # imply it is.
        more.append(f'<p class="checknote"><b>Note</b> {_esc(card.check_note)}</p>')
    if card.check_environment:
        # **The same hint-tier shape, for the same reason** — field report
        # 2026-08-28, finding 4. A red the environment caused and a red the
        # requirement earned read identically here, so a reader went off to
        # change working code. The engine's sentence verbatim, and the word
        # "guess" is in this block rather than in a footnote: the whole
        # licence for reading a gate's output at all is that nothing read
        # there decides anything.
        more.append(
            '<p class="checknote"><b>This red may not be about your work</b> '
            f"— it looks like the check {_esc(card.check_environment)}. That "
            "is a guess from what it printed. Nothing here was decided by it, "
            "and the check is red either way.</p>"
        )
    if card.question:
        # **The unblocking question, rendered — H-4.** Ruling 16 has given
        # every value a question since S2 and nothing on this surface showed
        # one, so half the mapping was guarded, pinned against the engine, and
        # read by nobody. A card that states a problem without saying what is
        # needed is a report; this is what makes the page a conversation.
        #
        # LAST in the card on purpose: a reader takes in the state, then what
        # happened, then what is being asked of them.
        parts.append(f'<p class="ask">{_esc(card.question)}</p>')
    if more:
        # Shut by default — a test pins it — and open in print via the
        # stylesheet. The summary names what is inside rather than "more".
        parts.append(
            '<details class="more"><summary>The evidence behind this '
            "one</summary>" + "\n".join(more) + "</details>"
        )
    parts.append("</div>")
    return "\n".join(parts)


def _intent_html(text: str) -> str:
    """The PRD, as something a person can read.

    Not a markdown implementation and not trying to be: it strips the two
    marks that actually leaked onto the page — leading `#` heading hashes and
    `*emphasis*` — and keeps paragraph breaks. Everything is escaped FIRST, so
    this can never turn a requirements document into markup.
    """
    import re

    out = []
    for para in _esc(text).split("\n\n"):
        lines = []
        for line in para.splitlines():
            line = re.sub(r"^\s*#{1,6}\s*", "", line)
            line = re.sub(r"\*{1,2}([^*]+)\*{1,2}", r"<em>\1</em>", line)
            lines.append(line.strip())
        joined = " ".join(one for one in lines if one)
        if joined:
            out.append(f"<p>{joined}</p>")
    return "".join(out)


def _meta_island(board: Board) -> str:
    """The page's machine-readable identity (`wringer.boardmeta.v1`, 0.6.2).

    A JSON island a machine can read without parsing prose: which run this
    page renders, the acceptance record's own counts, each human answer's
    verdict with a digest of its note, and the canonical digest of the
    coverage record — computed by the ENGINE's `coverage.record_digest`, the
    one canonicalisation both sides share. `wring deliver`'s cross-artifact
    invariant compares these against the certificate before anything is
    pushed (run 3's F13: a delivered page and a delivered certificate told
    two different stories, and nothing was positioned to notice). P2.3's
    self-test opens the portable page and reads exactly this block.

    Facts already on the page, restated structurally — never a second
    assessment.
    """
    import hashlib

    judged = []
    for criterion in board.criteria:
        answer = criterion.judgement
        if not isinstance(answer, dict):
            continue
        note = answer.get("note")
        judged.append(
            {
                "criterion": criterion.id,
                "verdict": answer.get("verdict"),
                **(
                    {
                        "note_sha256": hashlib.sha256(
                            str(note).encode("utf-8")
                        ).hexdigest()
                    }
                    if note
                    else {}
                ),
            }
        )
    coverage_digest = None
    try:
        from wringer import coverage as coverage_module

        coverage_digest = coverage_module.record_digest(board.coverage)
    except Exception:  # noqa: BLE001 — no engine here: the key stays null
        coverage_digest = None
    meta = {
        "schema_version": "wringer.boardmeta.v1",
        "run_id": board.run_dir.name if board.run_dir is not None else None,
        "selected": board.selected,
        "counts": board.acceptance_counts,
        "judgements": judged,
        "coverage_sha256": coverage_digest,
    }
    payload = json.dumps(meta, sort_keys=True, ensure_ascii=False)
    # An HTML-escaped data attribute, deliberately not a script-tag JSON
    # island: B1's guard forbids that tag's opening token in this package's
    # chrome outright, and a carrier that cannot even be mistaken for
    # executable is the better shape anyway. A reader takes the attribute
    # and `html.unescape`s it. Escaped with quote=True HERE — the page's
    # `_esc` deliberately leaves quotes alone for text nodes, and a quote
    # inside an ATTRIBUTE ends it: the first render shipped exactly that,
    # a data-meta cut off at the JSON's first `"`.
    return (
        '<div id="wringer-board-meta" hidden data-meta="'
        + html.escape(payload, quote=True)
        + '"></div>'
    )


def render(board: Board) -> str:
    """The whole page, as one self-contained string."""
    cards = [card_for(board, criterion) for criterion in board.criteria]
    title = board.spec_title or "Requirements"

    # **One text node in the title, and the stylesheet keeps it to a line**
    # (pd-board, 2026-09-03: run 4B's page opened with an h1 that ballooned
    # to five lines in a 560px pane).
    body: list[str] = ['<header class="top">', f"<h1>{_esc(title)}</h1>"]

    # **THE VERDICT FIRST, and the requirements document LAST.**
    #
    # Six readers were handed this page cold on 2026-08-19 and none could say
    # whether the work was done (`docs/coldread/`). The page opened with the
    # PRD — sixteen lines of the reader's own input — before it said anything
    # about the state of the work. A reader arrives with one question and was
    # answered with the document they had already written.
    #
    # So the intent moves below the cards, and the first thing on the page is
    # the answer.
    if board.refusal:
        body.append("</header>")
        body.append(f'<div class="refusal"><p>{_esc(board.refusal)}</p></div>')
        return _page(title, body)

    # The identity line (P1.14): the journey this run belongs to, when one
    # cites it, and the run — the same ids the engineers' block names, in
    # one monospace line a PM can quote back.
    if board.run_dir is not None:
        ident = []
        if board.journey_id:
            ident.append(f"journey <code>{_esc(board.journey_id)}</code>")
        ident.append(f"run <code>{_esc(board.run_dir.name)}</code>")
        body.append(f'<span class="ident">{" · ".join(ident)}</span>')

    # **Ruling 12: OUT OF DATE, across the whole board and above everything
    # on it** (0.6.2). Recomputed at render time by the reader, against the
    # engine's own `briefed.json` and document set — a page whose authorising
    # documents moved after the work was briefed describes an answer to a
    # question that has changed, and every card below inherits that. Not per
    # card, by ruling. Absent `briefed.json` renders NOTHING here: silence,
    # never a verdict.
    if board.staleness_moved:
        moved_names = ", ".join(f"<code>{_esc(n)}</code>" for n in board.staleness_moved)
        body.append(
            '<div class="refusal"><p><strong>OUT OF DATE.</strong> '
            "Since the work on this page was briefed, the documents that "
            f"authorise it have changed: {moved_names}. Everything below "
            "describes the question as it was THEN — re-run "
            "<code>wring verify</code> and re-render before trusting a "
            "single card.</p></div>"
        )

    # The outcome rail and the counts strip close the header. Six facts a
    # reader takes in at a glance, then four labelled counts; the short
    # version below says the same things in sentences, deliberately.
    body.append(_rail_html(board, cards))
    body.append(_tiles_html(cards))
    body.append("</header>")

    # **THE SHORT VERSION, above everything.** The promise below is a careful
    # sentence about a subset, and the counts below it are a tally — both are
    # answers to questions a reader has to already know to ask. This is the
    # answer to the question they arrived with.
    body.append(_headline_html(board, cards))

    # **The promise, earned or withheld** — never softened into a maybe.
    done_count = sum(1 for c in cards if c.state == DONE)
    if promise_earned(board, cards):
        # **SCOPED to the rows it covers.** It read "Every requirement marked
        # done on this page was demonstrated able to FAIL before it was made
        # to pass" — in a green box, above ten cards, of which it was true of
        # one. Every cold reader on 2026-08-19 took it as a guarantee about
        # the page. It is a guarantee about a subset, so it now says which.
        body.append(
            '<div class="promise">'
            f"{'The one requirement' if done_count == 1 else f'All {done_count} requirements'}"
            f" ticked below {'was' if done_count == 1 else 'were'} watched "
            "failing first, and then made to pass. That is what a tick here "
            "means. <strong>It says nothing about the rest of this "
            "page.</strong></div>"
        )
    else:
        body.append(
            '<div class="promise withheld">This page does not claim that every '
            "requirement marked done was demonstrated able to fail first — "
            "either nothing is done yet, or one of the proofs could not be "
            "followed from the evidence in this repository.</div>"
        )

    # **Every requirement is accounted for, not just the interesting ones.**
    # The old line read "1 requirement · 1 done and proved · 1 holding up the
    # handover" over TEN criteria, and a reader who read only that line —
    # which is what a count line is for — concluded eight of ten were fine.
    # The remainder is the largest group on most pages and it was the one
    # group the summary omitted.
    #
    # **Counted from the CARD STATES, not from `refused`** — field report
    # 2026-08-21 finding 12. `refused` is a true engine fact about the
    # DELIVERY, and it is not the same partition as the badges: eight rows
    # were badged `NEEDS YOU` while being counted here under "will not be
    # proved", and their own bodies said nothing was needed from the reader.
    # Three answers to one question, because two different partitions were
    # being read on one page. There is one now, `cards.BLOCKED_ON_*`, and this
    # line and the badges are both functions of it.
    done = sum(1 for c in cards if c.state in SETTLED)
    person = sum(1 for c in cards if c.state in BLOCKED_ON_PERSON)
    engineer = sum(1 for c in cards if c.state in BLOCKED_ON_ENGINEER)
    working = sum(1 for c in cards if c.state in BLOCKED_ON_THE_WORK)
    unknown = sum(1 for c in cards if c.state in INDETERMINATE)

    parts = [f"{done} of {len(cards)} proved"]
    if person:
        parts.append(f"{person} needs you")
    if working:
        parts.append(f"{working} not done yet")
    if engineer:
        parts.append(
            f"{engineer} cannot be proved yet — "
            f"{'it has' if engineer == 1 else 'they have'} no working check"
        )
    if unknown:
        parts.append(
            f"{unknown} cannot be read from the evidence "
            f"{'here' if unknown == 1 else 'here'}"
        )
    body.append(f'<p class="counts">{" · ".join(parts)}</p>')

    # **Between the counts and the cards, and that placement is the point.**
    # These are facts about the ROUND — how the work stopped, whether the
    # checks noticed the change, what an audit found — and reading them after
    # the cards would make them look like a footnote to the requirements
    # rather than the context the requirements were judged in.
    body.append(_round_html(board))

    # **Declared order, never sorted by state** — which would be the surface
    # deciding which debts matter.
    if cards:
        body.append('<section class="reqs"><h2>Each requirement</h2>')
        body.extend(_card_html(card) for card in cards)
        body.append("</section>")

    # Everything from here down is the tail: usage, the engine's limits, the
    # requirements document, and the engineers' block — one quiet group
    # below the PM material, in the order they already had.
    body.append('<footer class="tail">')

    # **Above the limits block, not below it** — field report 2026-08-22
    # finding 15. This paragraph is a sibling of the collapsed
    # "What this page does not claim" section, never a child of it, but
    # with that section shut it sat directly under its summary line with
    # no heading in between — so it read as filed under the disclaimer.
    # Usage is not a disclaimer. Moving it above removes the adjacency
    # rather than arguing with the reader about what the DOM says.
    #
    # **What this run recorded spending. Facts only, and never a price** —
    # Wringer keeps no price table, because a number it cannot check is a
    # number it must not print. Rendered only when something recorded a
    # usage: absent is not zero, and a page saying "0 tokens" would claim
    # more than the record supports.
    if board.spend:
        # **One line per lane, and the lanes are never summed** (P2.15, run
        # 4B finding 8). The sentence here said "the counts the model and the
        # worker reported" over a single total — and on run 4B's delivery the
        # worker was on the shell lane and reported nothing, so the number
        # was the drafting call alone and the sentence was false. Two
        # questions, two numbers; a lane that reported nothing is SAID to
        # have reported nothing, which is not the same as spending nothing.
        said = {"drafting": "Drafting", "worker": "The builder"}
        rows = []
        for lane in ("drafting", "worker"):
            totals = board.spend.get(lane)
            if not totals:
                continue
            counted = ", ".join(
                f"{name.replace('_', ' ')}: {value:,}"
                for name, value in sorted(totals.items())
            )
            rows.append(f"<li>{said[lane]} reported {_esc(counted)}.</li>")
        for lane in ("drafting", "worker"):
            if not board.spend.get(lane):
                rows.append(
                    f"<li>{said[lane]} reported nothing this run — which is "
                    "not the same as having spent nothing.</li>"
                )
        body.append(
            '<p class="spend">What this run recorded using, by lane. '
            "Wringer does not price them.</p>"
            f'<ul class="spend">{"".join(rows)}</ul>'
        )

    # Ruling 9: the honest limits render VERBATIM, in the engine's own voice.
    # Translating a limit weakens it unless the translation is guarded, and
    # that guard is a cycle. §8's sixth non-goal refuses it.
    if board.limits:
        body.append(
            "<details><summary>What this page does not claim — "
            "Wringer's own words, unedited</summary><ul>"
        )
        body.extend(f"<li>{_esc(limit)}</li>" for limit in board.limits)
        body.append("</ul></details>")

    # **The requirements document, LAST and collapsed.** It is the input, not
    # the answer, and it was the first thing on the page. Its markdown was
    # never rendered either, so a reader met a literal `# ` and literal
    # asterisks on a page written for someone who does not know what those
    # are — the six cold readers all noticed and one called it "a leftover
    # formatting character".
    if board.spec_intent:
        body.append(
            '<details class="intent-block"><summary>What was asked for, in '
            "the words it was asked in</summary>"
            f'<div class="intent">{_intent_html(board.spec_intent)}</div>'
            "</details>"
        )

    technical = [
        f"acceptance record: <code>{_esc(board.acceptance_version)}</code>",
        f"verifications in this loop: {len(board.attempts)}"
        + ("" if board.ordered else " (order unknown — rendered as a set)"),
    ]
    # **The run this page came from, named.** Field report 2026-08-27 finding
    # 2: the board and the record disagreed, and nothing on the page said
    # which record it was rendering — so the only way to tell a stale page
    # from a fresh one was to go and read `.wringer/runs/` by hand. A run id
    # is a technical string and belongs in the block B4 keeps technical
    # strings in; it does not belong on a PM's line. But it belongs on the
    # page. The board renders the repository's NEWEST run record, so this is
    # also what says so.
    if board.run_dir is not None:
        if board.selected:
            # A caller pinned the record (0.6.2 — `wring deliver` renders
            # the delivered page from the run it selected). "The newest
            # record in the repository" would be a lie here the moment a
            # newer run lands, which is exactly run 3's F13 contradiction
            # from the other side.
            technical.append(
                f"this page renders run <code>{_esc(board.run_dir.name)}</code>"
                " — the record its caller selected (a delivery renders the "
                "run it delivers), not necessarily the newest in the "
                "repository"
            )
        else:
            technical.append(
                f"this page renders run <code>{_esc(board.run_dir.name)}</code> — "
                "the newest record in the repository"
            )
    # **The journey that run belongs to (0.8.7, P1.14)** — named only when
    # a journey's own phases cite THIS run, the exact join `read.journey_for_run`
    # makes. Runs 4 and 4B, 2026-09-01: a spec id, a loop id, a run id and a
    # delivery id on four surfaces, and nothing joining them. Beside the run
    # id because it is the same kind of string, and the newest journey in
    # the repository is never named in its place.
    if board.run_dir is not None and board.journey_id:
        technical.append(
            f"journey <code>{_esc(board.journey_id)}</code> — the drive run "
            "whose record cites this run (<code>.wringer/journeys/"
            f"{_esc(board.journey_id)}/journey.json</code>)"
        )
    # **A guess about a gate NO REQUIREMENT OWNS.** Found by probing the
    # board's new card against the field case it was written for: in run 2's
    # example the gate that printed `ruff: command not found` was `lint`, and
    # `lint` is bound to nothing — so the guess reached no card and this page
    # said nothing about the one red the report was about.
    #
    # A card is keyed to a requirement and there is no requirement here, so
    # the fact belongs in the block this page keeps engineers' facts in. The
    # engine's own sentence, as everywhere else.
    if board.diagnosis:
        owned = {one.gate_id for one in board.criteria if one.gate_id}
        gate = board.diagnosis.get("gate")
        if gate and gate not in owned:
            said = _environment_sentence(board.diagnosis)
            if said:
                technical.append(
                    f"the check <code>{_esc(str(gate))}</code> is bound to no "
                    f"requirement, and its red looks like the environment: it "
                    f"{_esc(said)}. That is a guess from what it printed, and "
                    "nothing here was decided by it"
                )

    if board.vacuity:
        technical.append(
            f"vacuity verdict: <code>{_esc(str(board.vacuity.get('verdict')))}</code>"
        )
    # **Attribution, and the one place it can live.** Ruling 13 says a verdict
    # this surface did not compute may be rendered "attributed to `wring
    # audit`" — and the round section above may carry no wording of its own, so
    # the attribution is here, in the block B4 reserves for exactly this. Two
    # commands, two lines, and only when their facts are actually on the page.
    families = {fact.family for fact in board.facts}
    if families & {refusals.SIGNATURE, refusals.IDENTITY, refusals.INTEGRITY}:
        technical.append(
            "signature, identity and integrity: as <code>wring audit</code> "
            "reported them. This page did not check them itself"
        )
    if refusals.HEALTH_VERDICT in families:
        technical.append("check health: as <code>wring health</code> reported it")
    # **An artifact the board would not parse is named HERE and nowhere else.**
    # It is present, it declares a version off the known list, and the board
    # does not know where that version put the field — so the round section
    # above stays silent rather than guessing, and the silence is accounted for
    # in the one block B4 puts technical strings in. Naming it on a PM's line
    # would be a version number in the chrome; leaving it nowhere would make an
    # unreadable artifact indistinguishable from an absent one, which is the
    # distinction this slice is about.
    technical.extend(
        f"not read, version unknown to this board: <code>{_esc(entry)}</code>"
        for entry in board.unreadable
    )
    body.append(
        "<details><summary>For engineers</summary><ul>"
        + "".join(f"<li>{line}</li>" for line in technical)
        + "</ul></details>"
    )
    body.append("</footer>")
    body.append(_meta_island(board))
    return _page(title, body)


def _page(title: str, body: list[str]) -> str:
    return (
        '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{_esc(title)}</title><style>{CSS}</style></head>"
        f'<body><div class="wrap">{"".join(body)}</div></body></html>\n'
    )


def render_unknown_version(error: UnknownVersion) -> str:
    """Ruling 6: a version this board does not know renders ZERO CARDS.

    Not best-effort parsing, not partial rendering. A board that guessed past a
    schema version would supply the flattering answer, which is the one thing
    every `limits` block in the engine warns about.
    """
    body = [
        "<h1>This board cannot read this evidence</h1>",
        '<div class="refusal">',
        f"<p>The record in this repository is written in "
        f"<code>{_esc(error.version)}</code>, and this board understands "
        f"<code>{_esc(', '.join(error.known))}</code>.</p>",
        "<p>Rather than guess at what changed and show you something that "
        "might be wrong, it is showing you nothing. Update the board, or read "
        "the evidence with the version of Wringer that wrote it.</p>",
        "</div>",
    ]
    return _page("Unreadable evidence", body)


def write(board: Board, out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(board), encoding="utf-8")
    return out
