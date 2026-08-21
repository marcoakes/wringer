"""Plain language for every named thing the engine can say. SPEC_BOARD_V0 §4.

**Ruling 16 — the mapping is total, keyed on `(family, value)`, and totality is
forced by a test.** Every named value the shipped engine can emit gets exactly
one PM sentence and exactly one unblocking question. The key is a pair and not
a bare value because `unevidenced` alone has five causes, and one sentence for
five facts is precisely the collapse ruling 15 exists to prevent.

**Ruling 17 — an unmapped value renders UNTRANSLATED**, with the engine's own
words, verbatim. Never invisibly, never swallowed, never best-effort
prettified: *a PM seeing an ugly string files a bug report; a PM seeing nothing
has been lied to.*

**Ruling 18 — this file translates and never negotiates.** There is no entry
here that softens a refusal, no "proceed anyway", and no value whose sentence
tells a reader the thing did not matter. A refusal rendered in plain language
is still a refusal.

**The unblocking question is one question.** Not a list, not a diagnosis, and
never a command to run — the board is read by someone who does not use a
terminal. Where the honest answer is that only an engineer can move it, the
question says so rather than inventing an action for the reader.

## Where these values come from, and the one honest weakness

Five families are enumerable from FROZEN SCHEMAS, which is the strongest source
this project has — a schema is a published contract and `schema/frozen.json`
byte-freezes it. Three are enumerable only from public module symbols
(`graph.LOOP_REASONS`, `sign.SIGNATURE_STATES`, `sign.IDENTITY_STATES`,
`sign.INTEGRITY_STATES`).

This package has **no runtime dependency on `wringer`** and will not gain one:
B1's structural test asserts the surface ships nothing it does not need, and a
renderer that cannot run without the engine installed is a worse product. So
the values are written down here, and `tests/test_refusals.py` cross-checks
every one of them against the engine's own symbols and schemas **whenever the
engine is importable** — which it is wherever this is developed or its CI runs.

The weakness, stated rather than hidden: on a machine with no `wringer`
installed, that cross-check cannot run, and this file is then a hand-kept list.
The test says so out loud instead of skipping quietly, because a guard that
goes silent is how the last three stale claims in this programme survived.

**`sign.INTEGRITY_STATES` is now a real tuple** (`ab884b5`), so the per-value
exemption ruling 16 granted the two integrity values — on the stated grounds
that no collection existed — is discharged. They are enumerated like their two
siblings and the exemption is gone rather than left as a comment.
"""

from __future__ import annotations

from dataclasses import dataclass

# --- families -------------------------------------------------------------

CRITERION_STATE = "criterion-state"
UNEVIDENCED_CAUSE = "unevidenced-cause"
LOOP_ENDING = "loop-ending"
VACUITY_VERDICT = "vacuity-verdict"
HEALTH_VERDICT = "health-verdict"
SIGNATURE = "signature"
IDENTITY = "identity"
INTEGRITY = "integrity"
FLEET_OUTCOME = "fleet-outcome"
DELIVERY_REFUSAL = "delivery-refusal"
# **The same fact, said at the only moment a person can act on it.**
# `UNEVIDENCED_CAUSE`'s `born-green` is what a reader meets at the HANDOVER,
# on the record, when the work is finished and the answer is no. Measured on
# 2026-08-17: the operator approved a check, and five seconds later was told
# that check could never have failed. The information existed when they were
# asked and nothing used it. This family is that information, said at the
# question — a different sentence because it is a different moment: nothing
# has been recorded yet, and the objection is about the tree as it stands.
GATE_AT_INSTALL = "gate-at-install"

FAMILIES = (
    CRITERION_STATE,
    UNEVIDENCED_CAUSE,
    LOOP_ENDING,
    VACUITY_VERDICT,
    HEALTH_VERDICT,
    SIGNATURE,
    IDENTITY,
    INTEGRITY,
    FLEET_OUTCOME,
    DELIVERY_REFUSAL,
    GATE_AT_INSTALL,
)


@dataclass(frozen=True)
class Saying:
    """One sentence a PM reads, and the one question that unblocks it."""

    sentence: str
    question: str


# --- the mapping ----------------------------------------------------------
#
# Read it as a table, because that is what it is. Each row is the whole of what
# this board is permitted to say about that value.

MAPPING: dict[tuple[str, str], Saying] = {
    # Criterion states. `schema/acceptance.schema.json`'s enum, five values.
    (CRITERION_STATE, "evidenced"): Saying(
        "This is done, and the same check that passes now is on the record "
        "having failed before the work.",
        "Nothing is needed from you on this one.",
    ),
    (CRITERION_STATE, "gate-failed"): Saying(
        "Not done yet — the check that decides it is written and is failing right now.",
        "Nothing is needed from you yet; this is what work in progress looks like.",
    ),
    (CRITERION_STATE, "gate-did-not-run"): Saying(
        "This was not checked in this run, so nothing here says anything "
        "about it either way.",
        "Was this requirement meant to be part of this round of work?",
    ),
    (CRITERION_STATE, "human"): Saying(
        "A person has to decide this one. Nothing automatic can, and Wringer "
        "will not pretend otherwise.",
        "Is this requirement met? Only you can answer it.",
    ),
    (CRITERION_STATE, "unevidenced"): Saying(
        "Something is done or claimed here that cannot be proved from what is "
        "on record.",
        "See the specific reason on the card — the five reasons are not "
        "interchangeable.",
    ),
    # `unevidenced`'s causes. FIVE, not four. Ruling 15 enumerated four from
    # `accept.py` at `d23d7ca`; the witness lane added the second row below and
    # S1's real-bundle tests found it on real data rather than by reading.
    (UNEVIDENCED_CAUSE, "unbound"): Saying(
        "No check is bound to this requirement, so nobody can prove it either "
        "way. A check elsewhere on this page may happen to test something "
        "similar; it does not count for this one.",
        # The old question here was "Which check should decide this
        # requirement?" — asked of a reader who has no list of checks, does
        # not know what one is, and has nowhere to write an answer. All six
        # cold readers on 2026-08-19 named it, and it was the most-repeated
        # question on the page. A question a reader cannot act on is not a
        # question; it is a demand disguised as one.
        "Nothing is needed from you — an engineer has to bind a check to this "
        "before it can be proved.",
    ),
    (UNEVIDENCED_CAUSE, "witness-evidenced-nothing"): Saying(
        "Nothing in this repository checks this requirement, so Wringer wrote "
        "a check for it — and that check turned out to prove nothing, so it "
        "was thrown away rather than counted.",
        "Which check should decide this requirement?",
    ),
    (UNEVIDENCED_CAUSE, "born-green"): Saying(
        "The check passes, but it has never been recorded failing — so its "
        "passing proves nothing yet.",
        "Nothing is needed from you; this one needs a check that has been seen "
        "to fail.",
    ),
    (UNEVIDENCED_CAUSE, "pre-existence-unestablished"): Saying(
        "The check passes, but this run could not establish that the check "
        "existed before the change it is judging.",
        "Nothing is needed from you; an engineer has to make that provable.",
    ),
    (UNEVIDENCED_CAUSE, "arrived-with-the-work"): Saying(
        "A new check cannot vouch for the work that brought it. This check was "
        "created by the same change it judges.",
        "Nothing is needed from you; the check has to exist before the work "
        "that it judges.",
    ),
    # **The three HUMAN causes** — `wringer.acceptance.v3`. The engine's
    # `cause` is ONE closed enum of eight spanning `unevidenced` and `human`
    # rows, so they live in this family rather than a second one; a separate
    # vocabulary would mean the board could not render half of it.
    #
    # These are the cards the PM product exists for. Every other sentence here
    # tells a PM what a machine found; these three tell them the machine has
    # stopped and is waiting for THEM.
    (UNEVIDENCED_CAUSE, "human-unanswered"): Saying(
        "No check can decide this one — it needs a person to look and say. "
        "Nobody has yet.",
        # **It must say WHERE the answer goes.** The 2026-08-20 cold read: "it
        # is blocked on me personally and I have not been given any way to
        # unblock it — there is no button, no reply box, no email address, no
        # instruction for how I answer the question it is asking. A page that
        # stops on my answer should tell me where to put my answer."
        #
        # The mechanism exists and the page was simply not naming it.
        #
        # **Names the VERB now, not the file** — field report 2026-08-21
        # finding 13. Naming the file was accurate and useless: a product
        # manager had to create it, guess its schema, and hand-write YAML
        # including a sha256 digest, on the critical path of a delivery. That
        # friction never stopped an agent — writing YAML and hashing a string
        # are the two easiest things a machine does — so it stopped only the
        # person whose judgement the file exists to record.
        #
        # No automation answers this. `wringer-board judge` prints the
        # requirement and takes the person's own words; it is their pen, in a
        # place they can reach.
        "Is this requirement met? Only you can answer it — no check and no "
        "agent can. Run `wringer-board judge` to see it and record what you "
        "found, and until you do, the handover waits.",
    ),
    (UNEVIDENCED_CAUSE, "human-said-no"): Saying(
        "A person looked at this and said it is not met. Nothing here can "
        "overrule that, and nothing tried to.",
        "What would have to change for you to call this met?",
    ),
    (UNEVIDENCED_CAUSE, "human-judgement-stale"): Saying(
        "Somebody answered this, but the requirement has been REWORDED since — "
        "so the answer was given to a different question.",
        "Does your earlier answer still hold for the requirement as it reads now?",
    ),
    # Loop endings. `graph.LOOP_REASONS`, NINE values.
    (LOOP_ENDING, "converged"): Saying(
        "The work finished: the checks it was asked to satisfy are passing.",
        "Nothing is needed from you on this one.",
    ),
    (LOOP_ENDING, "max_iterations"): Saying(
        "The work stopped because it had used up the number of attempts it "
        "was allowed, not because it was finished.",
        "Should this be given more attempts, or is something else wrong?",
    ),
    (LOOP_ENDING, "budget_exhausted"): Saying(
        "The work stopped because it reached the spending or time limit set "
        "for it, not because it was finished.",
        "Should this be given a larger budget, or is something else wrong?",
    ),
    (LOOP_ENDING, "no_progress"): Saying(
        "The work stopped because an attempt changed nothing at all. Running "
        "it again unchanged would not help.",
        "Nothing is needed from you; an engineer has to look at why it is stuck.",
    ),
    (LOOP_ENDING, "environment"): Saying(
        "The work never started: the very first check could not run at all, "
        "because the command it needs is not installed on the machine. No "
        "attempt was made and nothing was changed.",
        "Nothing is needed from you; the machine the work runs on has to be "
        "set up first.",
    ),
    (LOOP_ENDING, "oscillating"): Saying(
        "The work stopped because it kept hitting the same failure over and "
        "over, which means it is going round in circles rather than making "
        "progress.",
        "Nothing is needed from you; an engineer has to look at why it is stuck.",
    ),
    (LOOP_ENDING, "authority_moved"): Saying(
        "The work stopped because the requirements it was working from changed "
        "underneath it. It will not carry on against a question that moved.",
        "Did you mean to change the requirements while this was running?",
    ),
    (LOOP_ENDING, "flaky_gate"): Saying(
        "The work stopped because one of the checks gives different answers on "
        "the same code, so nothing it said could be trusted.",
        "Nothing is needed from you; a check that cannot make up its mind is "
        "an engineer's problem.",
    ),
    (LOOP_ENDING, "interrupted"): Saying(
        "The work was stopped part-way — by a person, or by the machine it was "
        "running on.",
        "Should this be started again?",
    ),
    # Vacuity verdicts. `schema/vacuity.schema.json`, four values.
    (VACUITY_VERDICT, "proven"): Saying(
        "The checks were tested against the code as it was before this change, "
        "and at least one of them noticed the difference. They are measuring "
        "something.",
        "Nothing is needed from you on this one.",
    ),
    (VACUITY_VERDICT, "gates_vacuous"): Saying(
        "Every check passed both before and after this change, so none of them "
        "noticed it. Passing here proves nothing about the work, and the "
        "handover is refused.",
        "Nothing is needed from you; this needs a check that can tell the difference.",
    ),
    (VACUITY_VERDICT, "not_applicable"): Saying(
        "There was nothing to compare against, so this question was not asked.",
        "Nothing is needed from you.",
    ),
    (VACUITY_VERDICT, "inconclusive"): Saying(
        "The comparison could not be completed, so this says nothing either "
        "way. It is not a pass.",
        "Nothing is needed from you; an engineer has to find out why it could "
        "not be run.",
    ),
    # Health verdicts. `schema/health-report.schema.json`, four values.
    (HEALTH_VERDICT, "alive"): Saying(
        "There is a record of this check failing at some point, so it is still "
        "capable of telling you something.",
        "Nothing is needed from you on this one.",
    ),
    (HEALTH_VERDICT, "zombie"): Saying(
        "This check has passed every time for a long run of attempts and there "
        "is no record of it ever failing. A check that never fails may have "
        "stopped testing anything.",
        "Nothing is needed from you; an engineer has to confirm this check can "
        "still fail.",
    ),
    (HEALTH_VERDICT, "untested"): Saying(
        "There is not enough history yet to say whether this check can fail.",
        "Nothing is needed from you.",
    ),
    (HEALTH_VERDICT, "retired"): Saying(
        "This check is no longer part of the set being run.",
        "Was this check meant to be switched off?",
    ),
    # Signature. `sign.SIGNATURE_STATES`, four values.
    (SIGNATURE, "signature_valid"): Saying(
        "This record carries a signature and it checks out.",
        "Nothing is needed from you on this one.",
    ),
    (SIGNATURE, "signature_invalid"): Saying(
        "This record carries a signature and it does NOT check out. Treat the "
        "record as unproven until somebody explains why.",
        "Nothing is needed from you; an engineer has to explain this one.",
    ),
    (SIGNATURE, "signature_missing"): Saying(
        "Nobody signed this record. That is the ordinary result for work done "
        "on somebody's own machine and it is not a failure.",
        "Nothing is needed from you.",
    ),
    (SIGNATURE, "signature_unverified"): Saying(
        "A signature is present and nothing checked it, so this says neither "
        "that it is good nor that it is bad.",
        "Nothing is needed from you.",
    ),
    # Identity. `sign.IDENTITY_STATES`, three values.
    (IDENTITY, "identity_trusted"): Saying(
        "The signature belongs to somebody this repository said in advance it "
        "would trust.",
        "Nothing is needed from you on this one.",
    ),
    (IDENTITY, "identity_untrusted"): Saying(
        "The signature belongs to somebody this repository did NOT say it would trust.",
        "Nothing is needed from you; an engineer has to explain this one.",
    ),
    (IDENTITY, "identity_unknown"): Saying(
        "This repository never wrote down whose signature it expects, so "
        "'signed by somebody' cannot become 'signed by the right somebody'.",
        "Nothing is needed from you.",
    ),
    # Integrity. `sign.INTEGRITY_STATES`, two values — and they are enumerated
    # now rather than exempted, because the tuple exists (`ab884b5`).
    (INTEGRITY, "integrity_valid"): Saying(
        "Every file behind this record is byte-for-byte what it was when it "
        "was written. Nothing has been altered since.",
        "Nothing is needed from you on this one.",
    ),
    (INTEGRITY, "integrity_invalid"): Saying(
        "At least one file behind this record has been altered since it was "
        "written. The evidence no longer matches what it claims.",
        "Nothing is needed from you; an engineer has to explain this one.",
    ),
    # Fleet task outcomes. `schema/fleet-manifest.schema.json`, three values.
    (FLEET_OUTCOME, "succeeded"): Saying(
        "This piece of work finished and its checks passed.",
        "Nothing is needed from you on this one.",
    ),
    (FLEET_OUTCOME, "failed"): Saying(
        "This piece of work ran and did not get its checks passing.",
        "Nothing is needed from you yet.",
    ),
    (FLEET_OUTCOME, "parked"): Saying(
        "This piece of work was set aside rather than finished or failed — it "
        "stopped needing something it did not have.",
        "Nothing is needed from you; an engineer has to look at what it was "
        "waiting for.",
    ),
    # **Delivery refusals — ALL TWENTY-THREE, derived from
    # `deliver.REFUSAL_REASONS`.**
    #
    # This comment used to say three was "the honest number, not an oversight",
    # because `deliver.py` raised its refusals as prose with no reason enum and
    # inventing names here would have been the surface deciding what the engine
    # says. That was true when it was written and stopped being true on
    # 2026-08-17: refusal R1 landed `deliver.REFUSAL_REASONS`, a closed public
    # tuple of 23, and every refused attempt now writes
    # `.wringer/refusals/<id>/refusal.json` carrying one of them.
    #
    # So the names are the ENGINE's and this file only supplies sentences. The
    # cross-check in `tests/test_refusals.py` is set-equality against that
    # tuple in both directions, so a 24th refusal reddens rather than silently
    # rendering untranslated.
    #
    # Most of these say "nothing is needed from you". That is not padding: a
    # PM whose handover is blocked by a git-plumbing problem needs to know it
    # is not theirs to solve, and saying so is the whole difference between a
    # page that informs and a page that worries somebody.
    (DELIVERY_REFUSAL, "unfinished_git_operation"): Saying(
        "The handover is being held because the project is midway through "
        "another operation that was never finished.",
        "Nothing is needed from you; an engineer has to finish or abandon it.",
    ),
    (DELIVERY_REFUSAL, "no_git_identity"): Saying(
        "The handover is being held because the machine doing the work has "
        "no name or email recorded, so nothing can be attributed to "
        "anybody.",
        "Nothing is needed from you; the machine has to be set up first.",
    ),
    (DELIVERY_REFUSAL, "remote_unreachable"): Saying(
        "The handover is being held because the place it would be sent to "
        "could not be reached.",
        "Nothing is needed from you; this is usually a network or access problem.",
    ),
    (DELIVERY_REFUSAL, "head_moved"): Saying(
        "The handover is being held because the project moved underneath "
        "this work while it was being checked, so the proof is about a "
        "different version.",
        "Nothing is needed from you; it has to be re-checked against the "
        "current version.",
    ),
    (DELIVERY_REFUSAL, "tree_moved"): Saying(
        "The handover is being held because the files changed after they "
        "were checked, so the proof no longer describes what would be "
        "handed over.",
        "Nothing is needed from you; it has to be re-checked.",
    ),
    (DELIVERY_REFUSAL, "tracked_contents_differ"): Saying(
        "The handover is being held because a file's contents differ from "
        "what was checked.",
        "Nothing is needed from you; it has to be re-checked.",
    ),
    (DELIVERY_REFUSAL, "untracked_record_unreadable"): Saying(
        "The handover is being held because the record of newly added files "
        "could not be read.",
        "Nothing is needed from you; an engineer has to look at the evidence.",
    ),
    (DELIVERY_REFUSAL, "untracked_record_unknown_version"): Saying(
        "The handover is being held because the record of newly added files "
        "is in a format this version does not read.",
        "Nothing is needed from you; the tooling versions do not match.",
    ),
    (DELIVERY_REFUSAL, "files_unreadable_at_verify"): Saying(
        "The handover is being held because a file could not be read when "
        "the proof was assembled.",
        "Nothing is needed from you; an engineer has to look at the file.",
    ),
    (DELIVERY_REFUSAL, "unsupported_file_type"): Saying(
        "The handover is being held because the change includes a kind of "
        "file this cannot safely hand over.",
        "Nothing is needed from you; an engineer has to decide what to do with it.",
    ),
    (DELIVERY_REFUSAL, "untracked_file_moved"): Saying(
        "The handover is being held because a newly added file changed "
        "after it was checked.",
        "Nothing is needed from you; it has to be re-checked.",
    ),
    (DELIVERY_REFUSAL, "case_alias_collision"): Saying(
        "The handover is being held because two files differ only in "
        "capitalisation, which this computer treats as the same file.",
        "Nothing is needed from you; an engineer has to rename one of them.",
    ),
    (DELIVERY_REFUSAL, "gates_vacuous"): Saying(
        "The handover is being held because the checks did not notice this "
        "change at all, so their passing says nothing about it.",
        "Nothing is needed from you; this needs a check that can tell the difference.",
    ),
    (DELIVERY_REFUSAL, "authority_moved"): Saying(
        "The handover is being held because the requirements changed after "
        "this work started, so it was judged against a different question "
        "from the one you are asking now.",
        "Did you mean to change the requirements while this was running?",
    ),
    (DELIVERY_REFUSAL, "signature_required"): Saying(
        "The handover is being held because this project requires work to "
        "be signed, and this was not.",
        "Nothing is needed from you; an engineer has to set up signing.",
    ),
    (DELIVERY_REFUSAL, "acceptance_unevidenced"): Saying(
        "The handover is being held because at least one requirement cannot "
        "show its proof.",
        "See the cards above — each one holding this up says what it needs.",
    ),
    (DELIVERY_REFUSAL, "default_branch_unknown"): Saying(
        "The handover is being held because it cannot tell which branch is "
        "the project's main one, so it cannot be sure it is avoiding it.",
        "Nothing is needed from you; an engineer has to tell it.",
    ),
    (DELIVERY_REFUSAL, "gates_did_not_pass"): Saying(
        "The handover is being held because the project's own checks did "
        "not pass on this work.",
        "Nothing is needed from you; the work is not finished yet.",
    ),
    (DELIVERY_REFUSAL, "nothing_to_deliver"): Saying(
        "There is nothing to hand over: no files were changed.",
        "Nothing is needed from you; no work was done to deliver.",
    ),
    (DELIVERY_REFUSAL, "branch_is_base"): Saying(
        "The handover is being held because it would deliver onto the "
        "branch it is meant to be compared against.",
        "Nothing is needed from you; an engineer has to point it somewhere else.",
    ),
    (DELIVERY_REFUSAL, "branch_is_default"): Saying(
        "The handover is being held because it would write straight onto "
        "the project's main branch instead of proposing a change for "
        "review.",
        "Nothing is needed from you; that is the safety rule working.",
    ),
    (DELIVERY_REFUSAL, "branch_is_current"): Saying(
        "The handover is being held because it would deliver onto the very "
        "branch it is working on.",
        "Nothing is needed from you; an engineer has to point it somewhere else.",
    ),
    (DELIVERY_REFUSAL, "branch_exists"): Saying(
        "The handover is being held because a place to put it already "
        "exists, and overwriting it might destroy somebody's work.",
        "Nothing is needed from you; an engineer has to clear the way.",
    ),
    # **Said BEFORE the person answers, which is the whole reason it exists.**
    # Ruling 18 holds: this does not soften anything and it does not decide.
    # It is one fact and one question, put in front of the person while their
    # answer can still change the outcome.
    (GATE_AT_INSTALL, "born-green"): Saying(
        "This check already passes against the project as it stands, so "
        "nothing the work does can make it fail — which means either the "
        "requirement is already met, or this check cannot tell the "
        "difference.",
        "Is this requirement already met, or does it need a different check?",
    ),
}


def say(family: str, value: str) -> Saying | None:
    """The sentence and question for a value, or None — never a guess.

    Returning None is what drives ruling 17's UNTRANSLATED state. There is
    deliberately no default, no nearest-match and no generic fallback sentence:
    a wrong plain-English sentence is worse than an ugly true one, because the
    reader cannot tell it is wrong.
    """
    return MAPPING.get((family, value))


def values_for(family: str) -> frozenset[str]:
    """Every value this board can translate in one family."""
    return frozenset(value for (f, value) in MAPPING if f == family)
