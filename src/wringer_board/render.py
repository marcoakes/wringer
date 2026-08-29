"""One screen, one file. SPEC_BOARD_V0 §3 and §7.

Static-first and self-contained: inline CSS, no network, no fonts to fetch, no
server. B1 — the layer is local and single-user — and the probe's single HTML
file is the existence proof this is enough.

**B4, the copy ceiling.** No YAML, no exit codes, no paths, no gate ids, no run
ids in the board's own chrome. Two deliberate exceptions, both on the card and
both because removing them costs the PM information they need: the message the
check printed, verbatim in a block attributed to the check, and the attempt
ordinal with its timestamp. Everything else technical lives in one page-level
collapsed block addressed to engineers.

**The Q1 ceiling, which no string here may exceed:** a witness proves the
stated criterion could fail and was made to pass; it does not certify agreement
with an unstated intended fix. Nothing on this page may say the check catches
wrong fixes.
"""

from __future__ import annotations

import html
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
# `notprovable` and `needsengineer` deliberately share the neutral debt
# styling rather than the alarm colour `needsyou` carries: they are real debts
# and they are not the reader's to discharge.
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
:root{--ink:#16181d;--dim:#5c6370;--line:#e2e5ea;--bg:#fbfcfd;--card:#fff;
--done:#1a7f4b;--doneb:#e6f4ec;--red:#b3261e;--redb:#fdeceb;
--amber:#8a5a00;--amberb:#fdf3e2;--grey:#565d68;--greyb:#f1f3f5;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:themax;margin:0 auto;padding:40px 24px 80px}
h1{font-size:28px;margin:0 0 4px;letter-spacing:-.02em}
.intent{color:var(--dim);margin:0 0 28px;max-width:60ch}
.promise{border:1px solid var(--line);border-left:4px solid var(--done);
background:var(--doneb);padding:14px 18px;border-radius:6px;margin:0 0 10px;font-weight:600}
.promise.withheld{border-left-color:var(--grey);background:var(--greyb);font-weight:400;color:var(--dim)}
.counts{color:var(--dim);font-size:14px;margin:0 0 28px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;
padding:18px 20px;margin:0 0 14px}
.card h2{font-size:17px;margin:0 0 8px;font-weight:600;letter-spacing:-.01em}
.state{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;
text-transform:uppercase;padding:3px 8px;border-radius:4px;margin:0 8px 0 0;vertical-align:2px}
.done .state{background:var(--doneb);color:var(--done)}
.notyet .state{background:var(--amberb);color:var(--amber)}
.notreached .state,.unknown .state,.untranslated .state{background:var(--greyb);color:var(--grey)}
.needsyou .state{background:var(--amberb);color:var(--amber)}
/* Neutral, not amber. These are real debts and they are NOT the reader's to
   discharge — badging them like the rows that need a person is what put nine
   demands for attention on a page whose summary counted two. */
.notprovable .state,.needsengineer .state{background:var(--greyb);color:var(--grey)}
.badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;
text-transform:uppercase;padding:3px 8px;border-radius:4px;background:var(--redb);color:var(--red)}
.ask{margin:14px 0 0;padding-top:12px;border-top:1px solid var(--line);
font-weight:600;color:var(--ink)}
.needsyou .ask{color:var(--amber)}
.done .ask,.notreached .ask{font-weight:400;color:var(--dim)}
.said{margin:12px 0 0;padding:10px 14px;background:#f7f8fa;border:1px solid var(--line);
border-radius:5px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
white-space:pre-wrap;overflow-x:auto}
.said .who{display:block;font-family:inherit;font-size:11px;color:var(--dim);
margin:0 0 6px;text-transform:uppercase;letter-spacing:.05em}
/* F14: the card's check output is collapsible, so it must inherit none of
   the page-level disclosure chrome below — no 36px gap, no rule above it.
   Shut it is one line; open it is exactly the block it always was.
   No tag names in angle brackets here: a literal one inside a stylesheet
   comment makes every tag-counting reader of this page see an unclosed
   element, which is how the well-formedness guard first went red. */
.card details.said{margin:12px 0 0;border-top:none;padding-top:10px;font-size:13px}
.card details.said summary.who{margin:0;color:var(--dim);list-style:revert}
.card details.said[open] summary.who{margin:0 0 6px}
/* **The scope sentence had NO rule at all** — found 2026-08-22 by a guard
   over every class the page emits. It sits INSIDE the monospace log block,
   so with no styling it rendered in the check's own typeface and read as one
   more line the check had printed. That is the opposite of what it is for:
   it is the board speaking ABOUT the log, and F14's structural answer leans
   on the reader meeting it as such at the moment they open the block. */
.said .scope{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
font-size:13px;color:var(--dim);margin:10px 0 0;padding-top:8px;border-top:1px solid var(--line);
white-space:normal}
.wasred{margin:12px 0 0;padding:12px 14px;border:1px solid var(--line);
border-left:4px solid var(--red);background:var(--redb);border-radius:5px;font-size:14px}
.wasred b{color:var(--red)}
.checknote{margin:12px 0 0;padding:10px 14px;border:1px solid var(--line);
border-left:4px solid var(--amber);background:var(--amberb);border-radius:5px;font-size:14px}
.checknote b{color:var(--amber);text-transform:uppercase;font-size:11px;letter-spacing:.06em;
margin-right:6px}
p{margin:0 0 6px}
details{margin-top:36px;border-top:1px solid var(--line);padding-top:18px;font-size:14px;color:var(--dim)}
summary{cursor:pointer;color:var(--ink)}
details li{margin-bottom:8px}
.refusal{border:1px solid var(--red);border-left:4px solid var(--red);background:var(--redb);
padding:18px 20px;border-radius:6px}
.round{margin:0 0 28px;padding:2px 0 0;border-top:1px solid var(--line)}
.round h2{font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
color:var(--dim);margin:18px 0 12px}
.round p{margin:0 0 10px;padding:0 0 0 14px;border-left:2px solid var(--line)}
.round .untranslated{padding:0 0 0 14px;border-left:2px solid var(--grey);margin:0 0 10px}
.round .said{margin-top:6px}
/* **The short version.** Field report 2026-08-28, and the reader was the
   product manager this whole surface is for: *"you need a fucking PhD to
   understand what is going on here."* Everything below this block is true and
   was written for someone who already knows what bound, red-first and
   evidenced mean. This block assumes none of it. */
.short{border:1px solid var(--line);border-radius:8px;background:var(--card);
padding:22px 24px;margin:0 0 22px}
.short h2{font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
color:var(--dim);margin:0 0 14px}
.short dl{margin:0}
.short dt{font-weight:600;font-size:14px;margin:14px 0 2px}
.short dt:first-of-type{margin-top:0}
.short dd{margin:0;color:var(--ink)}
.short dd .why{color:var(--dim);font-size:14px}
.short ul{margin:4px 0 0;padding-left:20px}
.short li{margin:0 0 3px}
.short .verdict{margin:18px 0 0;padding:12px 14px;border-radius:5px;font-weight:600;
background:var(--greyb);border-left:4px solid var(--grey)}
.short .verdict.held{background:var(--amberb);border-left-color:var(--amber);color:var(--amber)}
.short .verdict.clear{background:var(--doneb);border-left-color:var(--done);color:var(--done)}
""".replace("themax", "760px")


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
    unwatched = _titles(cards, BLOCKED_ON_ENGINEER)
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
    refusal = next(
        (
            refusals.say(fact.family, fact.value)
            for fact in board.facts
            if fact.family == refusals.DELIVERY_REFUSAL
        ),
        None,
    )
    held = [card for card in cards if card.refused]
    if refusal is not None:
        parts.append(f'<p class="verdict held">{_esc(refusal.sentence)}</p>')
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


def _card_html(card: Card) -> str:
    klass = _STATE_CLASS.get(card.state, "unknown")
    parts = [f'<div class="card {klass}">']
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
    if card.state == DONE:
        # **The hero.** Not the green — the green is ordinary. What sells is
        # that the same check is on the record having failed.
        # **"It was red first" is the programme's own slogan, and a product
        # manager does not speak it.** Field report 2026-08-28: red and green
        # are an engineer's words for failing and passing, and the hero line of
        # the whole surface was written in them. The fact is unchanged and the
        # sentence after it is untouched; only the words a non-engineer has to
        # already know are gone.
        parts.append(
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
        parts.append(
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
        parts.append(f'<p class="checknote"><b>Note</b> {_esc(card.check_note)}</p>')
    if card.check_environment:
        # **The same hint-tier shape, for the same reason** — field report
        # 2026-08-28, finding 4. A red the environment caused and a red the
        # requirement earned read identically here, so a reader went off to
        # change working code. The engine's sentence verbatim, and the word
        # "guess" is in this block rather than in a footnote: the whole
        # licence for reading a gate's output at all is that nothing read
        # there decides anything.
        parts.append(
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


def render(board: Board) -> str:
    """The whole page, as one self-contained string."""
    cards = [card_for(board, criterion) for criterion in board.criteria]
    title = board.spec_title or "Requirements"

    body: list[str] = [f"<h1>{_esc(title)}</h1>"]

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
        body.append(f'<div class="refusal"><p>{_esc(board.refusal)}</p></div>')
        return _page(title, body)

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
    body.extend(_card_html(card) for card in cards)

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
        counted = ", ".join(
            f"{name.replace('_', ' ')}: {value:,}"
            for name, value in sorted(board.spend.items())
        )
        body.append(
            '<p class="spend">What this run recorded using — '
            f"{_esc(counted)}. These are the counts the model and the worker "
            "reported; Wringer does not price them.</p>"
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
        technical.append(
            f"this page renders run <code>{_esc(board.run_dir.name)}</code> — "
            "the newest record in the repository"
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
