"""**The positioning claim, and the guards that stop it growing.**

`docs/enforced-vs-instructed.md` is the one page in this repository that makes
a claim about somebody ELSE's software. That makes it the easiest page here to
be wrong on and the most expensive one to be wrong on: a competitor's tree
moves without asking us, and a sentence about what their code cannot do decays
from the day it is written.

Four properties, and the last two are the ones that matter:

1. **Every leg of the triple is on the page**, and the README says the same
   three. Two documents describing one claim is the drift this suite keeps
   refusing.
2. **Every claim about a competitor names the tree AND the commit** it was read
   at. "deepagents cannot run a check" is not a fact; "deepagents at `23b83ad`
   gives its grader `ls`, `read_file`, `glob` and `grep`" is one.
3. **The page says what happens to the claim when they close the gap.** This is
   the honesty clause and it is load-bearing: `RubricMiddleware` is `@beta` and
   moving, their own grader prompt already anticipates tools that "run tests",
   and the day they ship that, two of these three rows stop being true of them.
   A positioning page with no retraction plan becomes a page that gets
   defended.
4. **It does not lean on work-with-anything.** That used to be half the
   sentence, and it stopped differentiating the moment a competitor made
   model-agnosticism their own wedge. A page still resting on it would be
   selling a thing two harnesses now also sell.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "docs" / "enforced-vs-instructed.md"
README = ROOT / "README.md"

#: The three legs, as the words they must be said in. A leg renamed is a claim
#: nobody can hold to a measurement.
LEGS = ("enforced", "instructed", "executed", "judged", "refus", "exit 0")


def page() -> str:
    return PAGE.read_text(encoding="utf-8")


def test_ALL_THREE_LEGS_ARE_ON_THE_PAGE():
    body = page().lower()
    missing = [word for word in LEGS if word not in body]
    assert not missing, (
        f"the positioning page no longer states these: {missing}. The claim is "
        "a triple; two legs is a different claim"
    )


def test_THE_README_AND_THE_PAGE_NAME_THE_SAME_TRIPLE():
    """**Lockstep, in the one direction that can go wrong.** A README that
    claims a leg the page does not defend is a claim with no measurement
    behind it, which is how a positioning sentence becomes marketing."""
    fold = README.read_text(encoding="utf-8").lower()
    assert "enforced-vs-instructed" in fold, "the README no longer links the page"
    for word in ("enforced", "instructed", "executed", "judged", "exit 0"):
        assert word in fold, (
            f"the README names a triple the page defends and omits {word!r}"
        )


def test_EVERY_COMPETITOR_CLAIM_NAMES_THE_TREE_AND_THE_COMMIT():
    """**A claim about somebody else's code without a commit is a rumour.**

    Their tree moves without asking us. A reader who wants to check a sentence
    here needs the exact revision it was read at, and a window that later finds
    the sentence false needs to know whether the code changed or the sentence
    was always wrong.
    """
    body = page()
    for repository in ("openai/codex", "langchain-ai/deepagents"):
        assert repository in body, (
            f"the page makes claims about {repository} and never names the "
            "repository"
        )
    # A short hex sha beside each. Derived from the dossiers, which are the
    # only place either commit was recorded.
    shas = set(re.findall(r"`([0-9a-f]{7})`", body))
    assert {"343074d", "23b83ad"} <= shas, (
        f"the page does not name the commits its claims were read at: {shas}"
    )


def test_THE_PAGE_SAYS_WHAT_HAPPENS_WHEN_THE_GAP_CLOSES():
    """**The honesty clause, and it is the reason this file exists.**

    `RubricMiddleware` is `@beta` and moving. Giving that grader execution and
    gating the exit code is a small step for LangChain, and when they take it,
    two of these three rows stop being true of them. A page that has said in
    advance what it will do that day gets EDITED; a page that has not gets
    DEFENDED, and this repository has watched itself withdraw a claim once
    already and would rather do it on purpose.
    """
    body = page().lower()
    assert "beta" in body, (
        "the page does not say that the competitor's mechanism is marked beta "
        "and moving"
    )
    assert "edited the same day" in body or "gets edited" in body, (
        "the page states no plan for the day the gap closes, so it is a page "
        "that will be argued instead of corrected"
    )
    assert "small step" in body, (
        "the page does not say how EASY the closing move is, which is the "
        "part that makes the plan necessary"
    )


def test_THE_PAGE_DOES_NOT_REST_ON_WORKS_WITH_ANYTHING():
    """Model-agnosticism is the competitor's wedge too, measured: they court
    the same no-lock-in buyer with Claude-Code-compatible hooks and env names.
    The page must say so rather than lean on a differentiator that is no
    longer one."""
    body = page().lower()
    assert "no longer differentiate" in body, (
        "the page still offers work-with-anything as a differentiator against "
        "a competitor whose wedge is the same thing"
    )


def test_THE_MEASUREMENT_IN_THE_OTHER_DIRECTION_IS_LINKED_NOT_SUMMARISED():
    """The Stop-hook capture is the narrowest demonstration of this page's
    claim, and it is a CAPTURE — so the page points at it rather than retelling
    it. A summary of a measurement is a place for the measurement to drift."""
    body = page()
    assert "supervise-their-harness.md" in body, (
        "the page does not link the run where this claim was demonstrated "
        "inside the competitor's own harness"
    )
    assert (ROOT / "docs" / "supervise-their-harness.md").is_file()
