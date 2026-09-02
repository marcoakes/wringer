"""What DRIVE emits, and the one rule that keeps it honest.

SPEC_DRIVE_V0 §9 question 4, decided 2026-08-17: **the transport is the PM's
own coding agent.** They already have one — Marc's directive is that they
install Wringer by pasting a prompt into it — so building them a new surface
would answer a question nobody asked. A local web page is forbidden anyway
(B1's test names `http.server` among the banned dependencies).

So DRIVE emits **structured, verbatim text** and something else carries it:

- an agent driving `wringer-drive --emit json`, relaying and returning answers;
- or a person at a terminal, when nothing is driving.

**Both read the SAME objects in this module**, which is why they cannot drift
into two products with two vocabularies.

## The one rule

**The agent is a TRANSPORT, not a TRANSLATOR.**

Every PM-facing sentence here comes from `wringer_board.refusals.say` or
`wringer_board.interview.plan`, verbatim. Nothing in this package writes a
sentence about a criterion, a refusal or a gate, and nothing paraphrases one.
An agent that summarised would be a second surface deciding what the engine
said, which SPEC_BOARD ruling 1 forbids outright — and it is the failure this
whole programme keeps finding: two things describing one fact, drifting apart.

`test_every_sentence_drive_emits_came_from_the_board` checks it structurally,
so the rule survives somebody being in a hurry.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

# The kinds of thing DRIVE emits. A CLOSED set: a driver routes on these, and
# a kind nobody named is a kind nobody can handle.
ASK = "ask"  # a question only the operator can answer
SHOW = "show"  # text to put in front of them, verbatim
CONFIRM = "confirm"  # a yes/no that gates something
DONE = "done"  # the run finished, here is where to look
STOPPED = "stopped"  # the run stopped, and why, in their language

KINDS = (ASK, SHOW, CONFIRM, DONE, STOPPED)

# The protocol version, so a driver can refuse a shape it does not know rather
# than best-effort parsing it. Law 7: this is a new file, not a field on a
# frozen one.
SCHEMA_VERSION = "wringer.drive.v1"


@dataclass(frozen=True)
class Step:
    """One thing DRIVE needs a person to see, answer or decide.

    `text` is ALWAYS verbatim from the engine or the board. `id` is what a
    driver ROUTES on, so nothing is matched on prose. It is never echoed
    back: an answer on stdin is one line of plain text and nothing else —
    the sentence here used to claim an echo convention no reader
    implemented, and AGENTS.md documents the contract that actually runs.
    """

    kind: str
    id: str
    text: str
    # Optional, and each is a FACT rather than a hint: `engine_words` is what
    # the engine itself printed, carried when a sentence had to be summarised
    # for length; `question` is the board's unblocking question for this value.
    question: str | None = None
    engine_words: str | None = None
    # Only on CONFIRM: what a `no` means, said before they answer.
    refusing_means: str | None = None
    # **How to answer — about the TRANSPORT, never about the question.**
    #
    # The interview reads ONE LINE per answer and said so nowhere. A product
    # manager pasted a multi-line answer and it scattered: question 6 kept
    # line 1 truncated, question 7 — a different question entirely — recorded
    # line 2, and the remainder ran past the interview into the approval
    # prompt, where a stray line counted as "not yes" and declined the whole
    # run (field report 2026-08-21, finding 3).
    #
    # A separate field rather than a suffix on `text`, because an ASK's text
    # is the drafter's question VERBATIM and this package may not rewrite one:
    # softening a question is how a person ends up answering a different one.
    # This says how to type, which is DRIVE's own business as the transport.
    answering: str | None = None
    # **The next move, on a STOPPED step (0.7.0, P0.1).** Verbatim from the
    # engine (`WorkerDiagnosis.next_move`, read off `wring run --json`) when
    # it composed one, else the board's own `Saying.next_move` for the
    # ending. Optional and ABSENT from the JSON when None, so every step
    # written before it existed is byte-identical: a driver that does not
    # know the key ignores it, the sibling-file rule one level up.
    next_move: str | None = None
    detail: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.kind not in KINDS:
            raise ValueError(f"unknown step kind {self.kind!r}; one of {KINDS}")

    def as_json(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "kind": self.kind,
            "id": self.id,
            "text": self.text,
        }
        for name in (
            "question", "engine_words", "refusing_means", "answering", "next_move"
        ):
            value = getattr(self, name)
            if value is not None:
                payload[name] = value
        if self.detail:
            payload["detail"] = self.detail
        return payload

    def as_terminal(self) -> str:
        """The same step, for a person with no agent driving.

        **Not a second wording** — the same strings, laid out. That is the
        whole reason the fallback cannot drift from the primary.
        """
        lines = [self.text]
        if self.engine_words:
            lines += ["", "  What the tool itself said:", f"  {self.engine_words}"]
        if self.question:
            lines += ["", self.question]
        if self.next_move:
            # After the question, on its own line: it ends in a command a
            # person copies, so it is never folded into a paragraph.
            lines += ["", f"Next: {self.next_move}"]
        if self.refusing_means:
            lines += ["", f"If you say no: {self.refusing_means}"]
        if self.answering:
            lines += ["", self.answering]
        return "\n".join(lines)


def emit_json(steps: list[Step]) -> str:
    """One JSON object per line. A driver reads it a line at a time."""
    return "".join(
        json.dumps(step.as_json(), ensure_ascii=False) + "\n" for step in steps
    )
