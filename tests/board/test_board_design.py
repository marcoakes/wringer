"""The board's PRESENTATION guards (pd-board, 2026-09-03).

**Body count.** Marc, 2026-09-03: *"the ones you have done so far look
crap."* Measured by Fable on run 4B's delivered `board.html` in a 560px
pane: one narrow column of prose cards; an h1 that ballooned to five lines;
card body text OVERFLOWING the viewport horizontally; no status a PM reads
at a glance — every card a paragraph, the counts living in sentences. And
runs 4/4B, 2026-09-01: the PM read "green" as "everything proved".

Every guard here is structural — the wording of every pinned sentence is
untouched, and `test_board.py` / `test_short_version.py` keep it so. What
is pinned here is the SHAPE: the rail's six segments in one order with one
of three glyphs, monospace containers that cannot overflow, no percentage
anywhere, a one-node title, disclosures shut by default.
"""

from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from pathlib import Path

import pytest
from board_helpers import (
    criterion,
    write_loop,
    write_loop_manifest,
    write_refusal,
    write_run,
)

from wringer_board import read as read_module
from wringer_board import render as render_module

RUN = "20260903-090000-aaaa"
RED = "20260903-085900-bbbb"
LOOP = "20260903-085800-loop"


def _manifest(repo: Path, run: str, status: str, started: str) -> None:
    (repo / ".wringer" / "runs" / run / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": "wringer.evidence.v1",
                "run_id": run,
                "started_at": started,
                "repo": {"root": ".", "head_sha": "0" * 40, "branch": "main", "dirty": False},
                "result": {"status": status, "failed_gate": None if status == "passed" else "suite"},
                "scoped_out": [],
            }
        ),
        encoding="utf-8",
    )


def _every_state(repo: Path) -> Path:
    """One row per card state the board can render, plus a red run to cite."""
    write_run(
        repo,
        RED,
        [],
        gates={
            "suite": (
                "stderr",
                "AttributeError: 'Report' object has no attribute 'to_csv'\n"
                + "an_unbroken_token_" + "x" * 160,
            )
        },
    )
    _manifest(repo, RED, "failed", "2026-09-03T08:59:00+01:00")
    write_run(
        repo,
        RUN,
        [
            criterion(
                "csv",
                "Finance can download the figures as a spreadsheet file",
                "evidenced",
                receipt={"kind": "failure", "run": RED},
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
                cause="human-unanswered",
            ),
            criterion("scoped", "Old reports stay where they were", "gate-did-not-run"),
            criterion(
                "green",
                "Nothing else broke",
                "unevidenced",
                gate="suite",
                cause="born-green",
                reason="`suite` passed and has never been recorded failing",
                refuses=True,
            ),
            criterion(
                "odd",
                "The flux capacitor",
                "unevidenced",
                reason="the flux capacitor declined to comment",
            ),
            criterion(
                "lost",
                "Points nowhere",
                "evidenced",
                receipt={"kind": "failure", "run": "a-run-that-is-not-here"},
            ),
        ],
        version="wringer.acceptance.v3",
        gates={"suite": ("stderr", "AssertionError: expected 3 columns, got 1")},
    )
    _manifest(repo, RUN, "passed", "2026-09-03T09:00:00+01:00")
    write_loop(repo, LOOP, [RED, RUN])
    write_loop_manifest(repo, LOOP, "converged")
    return repo


def _delivery(repo: Path, run: str, *, mode: str = "live", pushed: bool = True) -> None:
    directory = repo / ".wringer" / "deliveries" / "20260903-091500-dlvr"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": "wringer.delivery.v1",
                "delivery_id": "20260903-091500-dlvr",
                "started_at": "2026-09-03T09:15:00+01:00",
                "mode": mode,
                "run_dir": f".wringer/runs/{run}",
                "branch": "wringer/x",
                "base": "main",
                "remote": "origin",
                "files": [],
                "spec_sha256": None,
                "result": {
                    "branch": "wringer/x",
                    "commit": "a" * 40,
                    "pushed": pushed,
                    "merge_request": None,
                },
            }
        ),
        encoding="utf-8",
    )


def _page(repo: Path) -> str:
    return render_module.render(read_module.read(repo))


def _rail(page: str) -> list[tuple[str, str, str]]:
    """`(label, tone, glyph)` per segment, read off the page."""
    return [
        (label, tone, glyph)
        for tone, glyph, label in re.findall(
            r'<li class="seg ([a-z]+)"><span class="glyph">([^<]+)</span>'
            r'<span class="lab">([^<]+)</span>',
            page,
        )
    ]


class _Title(HTMLParser):
    """What the h1 contains, node by node."""

    def __init__(self) -> None:
        super().__init__()
        self.inside = False
        self.nodes: list[tuple[str, str]] = []

    def handle_starttag(self, tag, attrs):
        if tag == "h1":
            self.inside = True
        elif self.inside:
            self.nodes.append(("tag", tag))

    def handle_endtag(self, tag):
        if tag == "h1":
            self.inside = False

    def handle_data(self, data):
        if self.inside:
            self.nodes.append(("text", data))


# --- the outcome rail ------------------------------------------------------


def test_the_outcome_rail_has_SIX_SEGMENTS_in_ONE_ORDER_with_THREE_GLYPHS(repo):
    """P1.8's six states, in P1.8's order, and nothing else on the rail.

    Runs 4/4B: the PM read "green" as "everything proved" because nothing on
    the page separated built from checked from proved from judged from
    delivered. The order is the journey's own order and it is pinned.
    """
    rail = _rail(_page(_every_state(repo)))
    assert [label for label, _, _ in rail] == list(render_module.RAIL_ORDER)
    assert list(render_module.RAIL_ORDER) == [
        "Built",
        "Checks passing",
        "Requirements proved",
        "Human judgement",
        "Ready to deliver",
        "Delivered",
    ]
    for label, tone, glyph in rail:
        assert glyph in ("✓", "✗", "—"), (label, glyph)
        assert render_module.GLYPHS[tone] == glyph, (label, tone, glyph)


def test_each_segment_is_ONE_FACT_and_absence_says_NOT_KNOWN_HERE(repo):
    """Taken paths: converged → Built met; run passed → Checks met; 2 of 8
    proved → unmet; one human criterion unjudged → unmet; no delivery
    attempt → Ready and Delivered both say "not known here", never "no"."""
    page = _page(_every_state(repo))
    rail = {label: (tone, glyph) for label, tone, glyph in _rail(page)}
    assert rail["Built"] == ("met", "✓")
    assert rail["Checks passing"] == ("met", "✓")
    assert rail["Requirements proved"] == ("unmet", "✗")
    assert "1 of 8 proved" in page
    assert rail["Human judgement"] == ("unmet", "✗")
    assert "0 of 1 judged met" in page
    assert rail["Ready to deliver"] == ("absent", "—")
    assert rail["Delivered"] == ("absent", "—")
    assert page.count("not known here") == 2


def test_a_refused_delivery_and_a_failed_run_read_UNMET_and_no_loop_reads_ABSENT(repo):
    write_run(
        repo,
        RUN,
        [criterion("a", "Something", "gate-failed", refuses=True)],
        gates={"suite": ("stderr", "nope")},
    )
    _manifest(repo, RUN, "failed", "2026-09-03T09:00:00+01:00")
    write_refusal(repo, "20260903-090100-rrrr", "acceptance_unevidenced", run=RUN)
    rail = {label: (tone, glyph) for label, tone, glyph in _rail(_page(repo))}
    assert rail["Built"] == ("absent", "—"), "a standalone verify has no loop to report"
    assert rail["Checks passing"] == ("unmet", "✗")
    assert rail["Ready to deliver"] == ("unmet", "✗")
    assert rail["Delivered"] == ("absent", "—")


def test_a_LIVE_delivery_naming_this_run_reads_DELIVERED_and_a_dry_run_does_not(repo):
    _every_state(repo)
    _delivery(repo, RUN, mode="dry_run")
    rail = {label: (tone, glyph) for label, tone, glyph in _rail(_page(repo))}
    assert rail["Delivered"] == ("absent", "—"), "a dry run delivered nothing"

    _delivery(repo, RUN, mode="live", pushed=True)
    page = _page(repo)
    rail = {label: (tone, glyph) for label, tone, glyph in _rail(page)}
    assert rail["Delivered"] == ("met", "✓")
    assert rail["Ready to deliver"] == ("met", "✓")
    assert "pushed" in page

    _delivery(repo, "some-other-run", mode="live")
    rail = {label: (tone, glyph) for label, tone, glyph in _rail(_page(repo))}
    assert rail["Delivered"] == ("absent", "—"), (
        "a delivery of ANOTHER run was read as this run's"
    )


def test_a_delivery_record_in_an_UNKNOWN_VERSION_is_named_not_parsed(repo):
    _every_state(repo)
    _delivery(repo, RUN)
    path = repo / ".wringer" / "deliveries" / "20260903-091500-dlvr" / "manifest.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["schema_version"] = "wringer.delivery.v9"
    path.write_text(json.dumps(payload), encoding="utf-8")
    page = _page(repo)
    rail = {label: (tone, glyph) for label, tone, glyph in _rail(page)}
    assert rail["Delivered"] == ("absent", "—")
    engineers = page.split("<summary>For engineers</summary>", 1)[1]
    assert "wringer.delivery.v9" in engineers


def test_the_rail_is_ABSENT_on_a_page_that_refuses(repo):
    page = _page(repo)
    assert "no evidence here yet" in page
    assert '<ol class="rail">' not in page
    assert '<div class="tiles">' not in page


# --- the counts strip ------------------------------------------------------


def test_the_counts_strip_has_FOUR_LABELLED_COUNTS_from_the_one_partition(repo):
    page = _page(_every_state(repo))
    tiles = re.findall(
        r'<div class="tile ([a-z]+)"><span class="num">(\d+)</span>'
        r'<span class="lab">([^<]+)</span>',
        page,
    )
    assert [(k, label) for k, _, label in tiles] == [
        ("proved", "Proved"),
        ("person", "Needs a person"),
        ("unproved", "Unproved"),
        ("contradicted", "Contradicted"),
    ]
    counts = {label: int(n) for _, n, label in tiles}
    # Eight rows: 1 proved, 1 needs a person, and the other six unproved —
    # nothing checks it, not built, not reached, born green, untranslated,
    # and a broken receipt chain. Every row is in exactly one tile.
    assert counts == {"Proved": 1, "Needs a person": 1, "Unproved": 6, "Contradicted": 0}
    assert "no audit or falsification has disproved a claim" in page


# --- no score, no percentage, no "green" about the whole -------------------


@pytest.mark.parametrize("build", ["every_state", "refused", "empty"])
def test_NO_DIGIT_IS_FOLLOWED_BY_A_PERCENT_SIGN_anywhere_on_the_page(repo, build):
    """A percentage is a score by another name, and the stylesheet counts:
    `width:50%` in the CSS is the same digit-then-percent a guard over the
    body alone would wave through."""
    if build == "every_state":
        _every_state(repo)
    elif build == "refused":
        write_run(repo, RUN, [criterion("a", "Something", "gate-failed", refuses=True)])
        write_refusal(repo, "20260903-090100-rrrr", "acceptance_unevidenced", run=RUN)
    page = _page(repo)
    found = re.search(r"\d%", page)
    assert found is None, page[max(0, found.start() - 40) : found.end() + 20]


def test_the_chrome_never_calls_the_whole_page_GREEN(repo):
    """Runs 4/4B: the PM read "green" as "everything proved"."""
    page = _page(_every_state(repo))
    body = re.sub(r"<style>.*?</style>", "", page, flags=re.S)
    # A criterion whose id is `green` is the PERSON'S word, not the board's:
    # it reaches the page as an anchor (`card-green`, the spelling the drive
    # points at since 0.8.1) and as the row's own id. The chrome is what is
    # left once every record-supplied id is removed — scoped by DERIVING the
    # ids from the fixture rather than by naming one, so a second fixture
    # criterion cannot quietly widen the exemption.
    for row in read_module.read(_every_state(repo)).criteria:
        body = body.replace(f'id="card-{row.id}"', "")
        body = body.replace(f'id="{row.id}"', "")
    assert not re.search(r"\bgreen\b", body, re.I), (
        re.search(r".{40}\bgreen\b.{40}", body, re.I | re.S).group(0)
    )


# --- the title ---------------------------------------------------------------


def test_the_title_is_ONE_TEXT_NODE_with_no_break(repo):
    """Run 4B's h1 ballooned to five lines at 560px. The stylesheet keeps it
    to one; this pins the half a parser can see — a single text node, no
    tags inside it."""
    parser = _Title()
    parser.feed(_page(_every_state(repo)))
    assert [kind for kind, _ in parser.nodes] == ["text"], parser.nodes
    assert "<br" not in parser.nodes[0][1]


# --- monospace containers cannot overflow ------------------------------------


def _rules(css: str) -> list[tuple[list[str], str]]:
    """`(selectors, declarations)` per rule, media blocks flattened."""
    flat = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    flat = re.sub(r"@media[^{]*\{", "", flat)
    out = []
    for selectors, body in re.findall(r"([^{}]+)\{([^{}]*)\}", flat):
        out.append(([s.strip() for s in selectors.split(",")], body))
    return out


def _wraps(css: str, selector: str) -> bool:
    return any(
        selector in selectors and ("overflow-wrap:anywhere" in body or "word-break" in body)
        for selectors, body in _rules(css)
    )


def test_EVERY_MONOSPACE_CONTAINER_carries_a_wrap_rule(repo):
    """Run 4B's card text overflowed the viewport horizontally: a check's
    output carried one unbroken token and nothing on the page let it break.

    Derived from the page: every `code`/`pre` element and every element
    whose class puts it in the monospace family must have a rule with
    `overflow-wrap:anywhere` or `word-break`.
    """
    page = _page(_every_state(repo))
    markup = re.sub(r"<style>.*?</style>", "", page, flags=re.S)
    assert "<code>" in markup and 'class="said"' in markup, "the fixture emits no monospace"

    mono_selectors = set()
    for selectors, body in _rules(render_module.CSS):
        if "font-family:ui-monospace" in body:
            mono_selectors.update(selectors)
    assert {"code", "pre", ".said", ".ident"} <= mono_selectors, mono_selectors

    unwrapped = sorted(s for s in mono_selectors if not _wraps(render_module.CSS, s))
    assert not unwrapped, (
        f"these monospace containers have no wrap rule and can push the page "
        f"sideways: {unwrapped}"
    )
    emitted = set(re.findall(r"<(code|pre)[\s>]", markup))
    emitted |= {"." + c for c in ("said", "ident") if f'class="{c}"' in markup}
    assert emitted <= mono_selectors


# --- disclosures are shut by default -----------------------------------------


def test_EVERY_DISCLOSURE_is_SHUT_by_default(repo):
    """A scanning reader meets a badge, a title and one sentence per row;
    the receipt, the log, the notes and the environment guess are behind
    one shut `details` per row, and print opens them via the stylesheet."""
    page = _page(_every_state(repo))
    assert '<details class="more">' in page
    assert not re.search(r"<details[^>]*\sopen[\s>]", page), "a disclosure renders open"
    assert "details::details-content{display:block" in render_module.CSS
    # The row's longer material is INSIDE the disclosure.
    for inside in ("This was watched failing before it was fixed.", '<details class="said"'):
        assert inside in page
        assert page.index('<details class="more">') < page.index(inside)


# --- every class the page emits has a rule, over EVERY state -----------------


def test_NOTHING_THE_PAGE_EMITS_IS_UNSTYLED_over_every_state(repo):
    """`test_board.py`'s guard renders one gate-failed row. This renders
    every state, a delivery, a journey and usage — the `spend` and
    `nowpasses` classes had no rule and nobody noticed for a month."""
    _every_state(repo)
    _delivery(repo, RUN)
    (repo / ".wringer" / "runs" / RUN / "usage.json").write_text(
        json.dumps({"prompt_tokens": 1, "completion_tokens": 2}), encoding="utf-8"
    )
    page = _page(repo)
    markup = re.sub(r"<style>.*?</style>", "", page, flags=re.S)
    for tag in ("details", "div", "p", "section", "header", "footer", "ol", "li", "span"):
        opened = len(re.findall(rf"<{tag}[\s>]", markup))
        closed = len(re.findall(rf"</{tag}>", markup))
        assert opened == closed, (tag, opened, closed)
    emitted = {
        name
        for value in re.findall(r'class="([a-z ]+)"', markup)
        for name in value.split()
    }
    styled = set(re.findall(r"[.#]([a-z]+)[{ ,:\[]", render_module.CSS))
    assert "spend" in emitted and "nowpasses" in emitted
    unstyled = sorted(name for name in emitted if name not in styled)
    assert not unstyled, unstyled
