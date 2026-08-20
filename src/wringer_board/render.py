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
    DONE,
    NEEDS_YOU,
    NOT_REACHED,
    NOT_YET,
    UNKNOWN,
    UNTRANSLATED,
    Card,
    card_for,
    promise_earned,
)
from wringer_board.read import Board, UnknownVersion

_STATE_CLASS = {
    DONE: "done",
    NOT_YET: "notyet",
    NOT_REACHED: "notreached",
    NEEDS_YOU: "needsyou",
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
.wasred{margin:12px 0 0;padding:12px 14px;border:1px solid var(--line);
border-left:4px solid var(--red);background:var(--redb);border-radius:5px;font-size:14px}
.wasred b{color:var(--red)}
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


def _card_html(card: Card) -> str:
    klass = _STATE_CLASS.get(card.state, "unknown")
    parts = [f'<div class="card {klass}">']
    parts.append(
        f'<h2><span class="state">{_esc(card.state)}</span>{_esc(card.title or card.id)}</h2>'
    )
    if card.refused:
        parts.append(
            '<p><span class="badge">Refused</span> '
            "This one is holding up the handover.</p>"
        )
    if card.sentence:
        parts.append(f"<p>{_esc(card.sentence)}</p>")
    if card.engine_words:
        # Ruling 17: the engine's words verbatim, inside a visible state.
        parts.append(_engine_words(card.engine_words))
    if card.state == DONE:
        # **The hero.** Not the green — the green is ordinary. What sells is
        # that the same check is on the record having failed.
        parts.append(
            '<div class="wasred"><b>It was red first.</b> '
            f"{_esc(card.receipt or '')}</div>"
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
        parts.append(
            '<div class="said"><span class="who">What the check for '
            "<b>this</b> requirement printed"
            + (" <b>BEFORE the work</b>" if card.state == DONE else "")
            + f"</span>{_esc(card.check_said)}"
            + now_passes
            + '<p class="scope">These lines are what this one requirement\'s '
            "check said. It may test more than this requirement does — but it "
            "only <b>proves</b> this one, so a requirement below saying "
            "nothing checks it is not contradicted by anything here.</p></div>"
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
            f" marked done below {'was' if done_count == 1 else 'were'} "
            "demonstrated able to FAIL before being made to pass. "
            "<strong>This says nothing about the rest of the page.</strong>"
            "</div>"
        )
    else:
        body.append(
            '<div class="promise withheld">This page does not claim that every '
            "requirement marked done was demonstrated able to fail first — "
            "either nothing is done yet, or one of the proofs could not be "
            "followed from the evidence in this repository.</div>"
        )

    done = sum(1 for c in cards if c.state == DONE)
    refused = sum(1 for c in cards if c.refused)
    # **Every requirement is accounted for, not just the interesting ones.**
    # The old line read "1 requirement · 1 done and proved · 1 holding up the
    # handover" over TEN criteria, and a reader who read only that line —
    # which is what a count line is for — concluded eight of ten were fine.
    # The remainder is the largest group on most pages and it was the one
    # group the summary omitted.
    rest = len(cards) - done - refused
    parts = [f"{done} of {len(cards)} proved"]
    if refused:
        parts.append(f"{refused} still needs you")
    if rest > 0:
        parts.append(
            f"{rest} will not be proved — nothing checks {'it' if rest == 1 else 'them'}"
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
