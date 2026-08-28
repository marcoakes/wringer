"""The certificate — docs/specs/SPEC_CERTIFICATE_V0.md.

**The acceptance list is a cold reviewer's own four sentences**, written after
reading a real delivery on 2026-08-27 (`docs/field-report-2026-08-27-run6-rerun.md`):

1. *"'Unevidenced' isn't a word I use … '6 of 8 requirements have no test
   proving them' would land faster."*
2. *"It doesn't say which six. That's the big one … To find out I'd need the
   board, which the same file tells me stays with the machine that ran it."*
3. *"'1 for a person to judge' doesn't say it was judged. You judged that
   criterion met, with a note. The MR doesn't show the verdict, the note, or
   who gave it."*
4. *"Nothing names the one proved criterion either."*

Each is one test below, named for the gap it closes rather than for the
function it calls, so a later reader can tell which sentence went unmet.

**Every judged record here is SYNTHETIC and labelled as a fixture.** The only
real judged record this project has is run 2's, and its note was typed by a
coding agent at the operator's instruction — the one act the product forbids,
recorded in `docs/field-report-2026-08-28-run2.md`. Building a test fixture
out of it would quietly launder a recorded deviation into evidence. A real
note is a banked capture for the next run where the pen is the operator's.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wringer import accept, certificate

# --- a synthetic record, and the fixture says so ---------------------------
#
# Hand-built rather than produced by a run, because these tests are about the
# RENDERING of every state — including states one repository could not be in
# at once. The states and causes come from `accept`'s own symbols, so a
# renamed state breaks this file rather than quietly rendering the old word.

FIXTURE_JUDGEMENT = {
    "verdict": "met",
    "by": "A. Reviewer",
    "at": "2026-08-28T09:15:00+00:00",
    "stale": False,
    "note": "Read it on the terminal and knew which one thing to go and fix.",
}


def row(
    ident: str,
    title: str,
    state: str,
    *,
    cause: str | None = None,
    gate: str | None = None,
    command: str | None = None,
    receipt: dict | None = None,
    judgement: dict | None = None,
    refuses: bool = False,
    required: bool = True,
) -> dict:
    return {
        "criterion": ident,
        "title": title,
        "required": required,
        "state": state,
        "gate": gate,
        "command": command,
        "receipt": receipt,
        "reason": f"because {ident}",
        "refuses": refuses,
        "witness": None,
        "cause": cause,
        "demonstrated_able_to_fail": None,
        "judgement": judgement,
    }


ROWS = [
    row(
        "exports-csv",
        "The export downloads a CSV",
        accept.EVIDENCED,
        gate="check",
        command="pytest -q tests/test_export.py",
        receipt={"kind": accept.FAILURE, "bundle": ".wringer/runs/20260101-000000-aaaa"},
    ),
    row("headers-right", "The columns are in the order finance asked for",
        accept.UNEVIDENCED, cause=accept.CAUSE_UNBOUND),
    row("big-exports", "A large export does not time out", accept.UNEVIDENCED,
        cause=accept.CAUSE_BORN_GREEN, gate="slow", command="true"),
    row("reads-clearly", "A reader can tell at a glance what to fix",
        accept.HUMAN, judgement=FIXTURE_JUDGEMENT),
]


def record(rows=None, counts=None) -> dict:
    rows = ROWS if rows is None else rows
    tallied = {state: 0 for state in accept.STATES}
    for one in rows:
        tallied[one["state"]] += 1
    return {
        "schema_version": "wringer.acceptance.v3",
        "counts": counts if counts is not None else tallied,
        "criteria": rows,
        "limits": ["the record's own ceiling sentence"],
    }


def built(tmp_path: Path, rows=None, counts=None, spec_sha256="abc123") -> dict:
    run = tmp_path / ".wringer" / "runs" / "20260828-101010-beef"
    run.mkdir(parents=True, exist_ok=True)
    (run / accept.ACCEPTANCE_FILENAME).write_text(
        json.dumps(record(rows, counts)), encoding="utf-8"
    )
    made = certificate.build(
        tmp_path,
        run,
        title="The feature",
        branch="wringer/20260828-101010-beef",
        base="main",
        head_sha="0" * 40,
        files_changed=3,
        spec_sha256=spec_sha256,
        run_relative=".wringer/runs/20260828-101010-beef",
    )
    assert made is not None
    return made


# --- gap 1: "'Unevidenced' isn't a word I use" -----------------------------


def test_GAP_1_the_page_uses_no_word_the_reviewer_said_they_do_not_use(tmp_path):
    """The reviewer's first gap, over EVERY state rather than the two they met.

    A vocabulary fixed only where somebody complained is the next complaint.
    So this renders one row in every state `accept` declares, crossed with
    every cause it declares, and greps the whole page.

    **`limits` is excluded from the grep, and that exclusion is the honest
    part.** The record's own ceiling sentences are carried VERBATIM — they are
    the engine's careful words about its own limits, a ceiling nobody may
    lower, and rewriting them here would be a second copy that could drift.
    They are rendered under their own attribution, after this document's own
    ceiling, which IS in this document's plain English.
    """
    every = [
        row(f"r{i}", f"Requirement {i}", state, cause=cause)
        for i, (state, cause) in enumerate(
            [(state, None) for state in accept.STATES]
            + [(accept.UNEVIDENCED, cause) for cause in accept.CAUSES]
            + [(accept.HUMAN, cause) for cause in accept.CAUSES]
        )
    ]
    payload = built(tmp_path, rows=every)
    page = certificate.render(payload)
    above_the_ceiling = page.split("## What this does not say")[0]

    for word in ("unevidenced", "evidenced", "criterion", "criteria",
                 "vacuity", "vacuous", "witness", "red-first", "gategen"):
        assert word not in above_the_ceiling.lower(), (
            f"{word!r} reaches the reviewer:\n{above_the_ceiling}"
        )


def test_GAP_1_the_headline_counts_the_way_the_reviewer_asked(tmp_path):
    """*"'6 of 8 requirements have no test proving them' would land faster."*"""
    said = " ".join(certificate.headline(built(tmp_path)))
    assert "Of the 4 requirements" in said, said
    assert "2 have no check proving them" in said, said
    assert "1 is proved" in said, said


def test_a_state_this_page_has_no_wording_for_REFUSES_TO_TRANSLATE():
    """**The refusal, and it is a real outcome rather than a fallback.**

    A `(state, cause)` pair the table has never met is a row this version
    cannot describe. Rendering the nearest phrase would be a guess wearing a
    verdict's clothes — the exact failure the board's UNTRANSLATED chip
    exists to refuse, and the one this project has caught in its own surfaces
    more than once.
    """
    chip, sentence = certificate._plain("some-future-state", "some-future-cause")
    assert chip == certificate.UNKNOWN
    assert "guess" in sentence


def test_every_state_and_cause_the_engine_declares_HAS_WORDING():
    """The control for the test above: the refusal must be unreachable for
    anything the engine can actually produce today. A page that says "I
    cannot describe this" about an ordinary row is a page that has stopped
    working, and only a total table tells the two apart."""
    missing = []
    for state in accept.STATES:
        if certificate._plain(state, None)[0] == certificate.UNKNOWN:
            missing.append((state, None))
    for cause in accept.CAUSES:
        state = accept.HUMAN if cause.startswith("human-") else accept.UNEVIDENCED
        if certificate._plain(state, cause)[0] == certificate.UNKNOWN:
            missing.append((state, cause))
    assert not missing, f"no wording for: {missing}"


# --- gap 2: "It doesn't say which six. That's the big one." ----------------


def test_GAP_2_every_requirement_is_named_BY_TITLE_with_its_state(tmp_path):
    payload = built(tmp_path)
    page = certificate.render(payload)
    for one in ROWS:
        assert one["title"] in page, f"{one['title']!r} is not on the page"
    assert certificate.NO_CHECK in page
    assert certificate.NEVER_FAILED in page
    assert certificate.PROVED in page


def test_GAP_2_the_unproved_ones_are_told_apart_rather_than_lumped(tmp_path):
    """Two rows are unproved and they need different things done to them.

    One has nothing testing it; the other has a check that has never been
    red. Telling a reader "no check proves this" about the second would send
    them to write a check that already exists — which is why the wording is
    keyed on the cause and not on the state.
    """
    page = certificate.render(built(tmp_path))
    unbound = page.split("The columns are in the order finance asked for")[1]
    assert "Nothing tests this" in unbound.split("###")[0]
    born = page.split("A large export does not time out")[1].split("###")[0]
    assert "only ever been green" in born, born
    assert "Nothing tests this" not in born, (
        "a check that exists and has never been red is being described as no "
        "check at all, which sends the reader to write one that already exists"
    )


# --- gap 3: "doesn't say it was judged, by whom, or the note" --------------


def test_GAP_3_a_human_verdict_shows_who_what_their_words_and_when(tmp_path):
    """**And the note is the reason this test exists at all.**

    Body count, field report 2026-08-28: a judgement note reading `your words
    here5` — an agent's chat placeholder with a stray keystroke — was recorded
    as the reason a requirement passed and travelled into a delivered branch.
    It was caught by somebody opening the YAML, because no surface in the
    program rendered a judgement note to anybody.
    """
    page = certificate.render(built(tmp_path))
    judged = page.split("A reader can tell at a glance what to fix")[1]

    assert "MET" in judged
    assert FIXTURE_JUDGEMENT["by"] in judged, "the page does not say WHO judged"
    assert FIXTURE_JUDGEMENT["at"] in judged, "the page does not say WHEN"
    assert FIXTURE_JUDGEMENT["note"] in judged, (
        "the page does not carry the note. A note nobody renders is a note "
        "nobody proof-reads"
    )


def test_GAP_3_a_note_is_rendered_VERBATIM_and_never_summarised(tmp_path):
    ugly = "your words here5"
    rows = [row("reads-clearly", "Reads clearly", accept.HUMAN,
                judgement={**FIXTURE_JUDGEMENT, "note": ugly})]
    page = certificate.render(built(tmp_path, rows=rows))
    assert ugly in page, (
        "a placeholder recorded as somebody's reasoning must reach the page "
        "exactly as it was recorded — that is how it gets noticed"
    )


def test_AN_OLDER_RECORD_WITH_NO_ANSWER_IN_IT_INVENTS_NO_VERDICT(tmp_path):
    """**The v1/v2 hole, and the first draft of this module fell in it.**

    `cause` is v3-only. A v1 or v2 `acceptance.json` — still published, still
    valid, read for ever — carries a `human` row with no cause AND no
    judgement. The draft keyed the wording on `(state, cause)` alone, so
    `(human, None)` meant "a person said yes", and reading an older record
    would have printed *"A person looked and said it was met"* over a row
    nobody had ever answered. That is a verdict invented by a renderer, in
    the one place this document exists to show a person's actual answer.

    The ANSWER decides a settled row now, which is the fact the row is about.
    """
    older = row("reads-clearly", "Reads clearly", accept.HUMAN)
    older.pop("cause")
    older.pop("judgement")
    payload = built(tmp_path, rows=[older])
    page = certificate.render(payload)

    assert certificate.AWAITING_A_PERSON in page, page
    assert certificate.JUDGED_MET not in page, (
        "a record that carries no answer is being rendered as a person "
        "saying yes"
    )
    assert "said it was met" not in page, page


def test_a_settled_human_row_is_STILL_shown_as_answered(tmp_path):
    """The control for the test above. A v3 row a person answered `met`
    carries no cause either — there is nothing to explain it from — so a fix
    that keyed only on absence would have made every real judgement read as
    unanswered, which is the opposite failure and just as wrong."""
    page = certificate.render(built(tmp_path))
    assert certificate.JUDGED_MET in page, page


def test_a_judgement_with_no_note_says_so_rather_than_going_quiet(tmp_path):
    rows = [row("reads-clearly", "Reads clearly", accept.HUMAN,
                judgement={k: v for k, v in FIXTURE_JUDGEMENT.items() if k != "note"})]
    page = certificate.render(built(tmp_path, rows=rows))
    assert "left no note" in page


def test_a_judgement_the_wording_moved_under_is_MARKED(tmp_path):
    rows = [row("reads-clearly", "Reads clearly", accept.HUMAN,
                cause=accept.CAUSE_HUMAN_JUDGEMENT_STALE,
                judgement={**FIXTURE_JUDGEMENT, "stale": True})]
    page = certificate.render(built(tmp_path, rows=rows))
    assert "REWORDED" in page


# --- gap 4: "Nothing names the one proved criterion either" ----------------


def test_GAP_4_a_proved_requirement_is_named_with_its_check_and_receipt(tmp_path):
    page = certificate.render(built(tmp_path))
    proved = page.split("The export downloads a CSV")[1].split("###")[0]
    assert "`check`" in proved, "the page does not name the check"
    assert "pytest -q tests/test_export.py" in proved
    assert "20260101-000000-aaaa" in proved, (
        "the page does not say where the check was seen failing"
    )


def test_the_page_names_the_RUN_and_not_a_path_into_somebody_elses_machine(
    tmp_path,
):
    """The fifth acceptance sentence: nothing on the page needs the machine
    that ran it. A run id is a name a reader can quote back; a path under
    somebody's `.wringer/` is the thing the reviewer already complained
    about. The path stays in the machine record, for whoever has the disk."""
    payload = built(tmp_path)
    page = certificate.render(payload)
    assert ".wringer/runs" not in page, page
    assert "20260101-000000-aaaa" in page
    assert payload["requirements"][0]["receipt"]["bundle"].startswith(".wringer/")


# --- the record ------------------------------------------------------------


def test_the_record_holds_no_empty_field_for_a_fact_it_has_not_earned(tmp_path):
    """**The face grows; the record does not.**

    A key present and null is a claim that the question was asked and came
    back empty. The next two slices each add a fact, and each rides its own
    sibling record — so a `coverage` or `falsification` key sitting here
    empty would be this version asserting a measurement nobody took.
    """
    payload = built(tmp_path)
    assert set(payload) == {
        "schema_version", "written_at", "change", "run", "spec",
        "acceptance", "requirements", "limits",
    }, sorted(payload)


def test_a_repository_with_no_spec_gets_NO_certificate(tmp_path):
    """The opt-in boundary, unchanged. A certificate over zero requirements
    would be a document asserting that nothing was asked for."""
    run = tmp_path / ".wringer" / "runs" / "20260828-101010-beef"
    run.mkdir(parents=True)
    assert certificate.build(
        tmp_path, run, title="t", branch="b", base="main", head_sha=None,
        files_changed=0, spec_sha256=None, run_relative="r",
    ) is None


def test_the_record_carries_the_acceptance_ceiling_AND_its_own(tmp_path):
    """Never fewer. A shorter list on the MORE portable artifact would be the
    ceiling quietly falling as the claim travels further, which is the exact
    failure the ceiling exists to prevent."""
    limits = built(tmp_path)["limits"]
    assert "the record's own ceiling sentence" in limits
    for mine in certificate.LIMITS:
        assert mine in limits


def test_the_face_puts_its_own_plain_ceiling_ABOVE_the_engines_words(tmp_path):
    page = certificate.render(built(tmp_path))
    section = page.split("## What this does not say")[1]
    mine = section.index(certificate.LIMITS[0])
    theirs = section.index("the record's own ceiling sentence")
    assert mine < theirs, (
        "the ceiling section opens in the vocabulary the reviewer said they "
        "do not use"
    )


def test_the_record_matches_its_published_schema(tmp_path):
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads(
        (Path(__file__).resolve().parents[1] / "schema"
         / "certificate-v1.schema.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(built(tmp_path), schema)


# --- checking it offline ---------------------------------------------------


SPEC = """\
schema_version: wringer.spec.v1
approved: true
title: The feature
intent: Ship it.
tasks:
  - id: build
    brief: Build it
    objective: It exports.
criteria:
  - id: exports-csv
    title: The export downloads a CSV
    required: true
  - id: headers-right
    title: The columns are in the order finance asked for
    required: true
  - id: big-exports
    title: A large export does not time out
    required: true
  - id: reads-clearly
    title: A reader can tell at a glance what to fix
    required: true
    human: true
"""


@pytest.fixture()
def clone(tmp_path: Path) -> Path:
    (tmp_path / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    return tmp_path


def outcomes(report) -> dict[str, str]:
    return {claim.what: claim.outcome for claim in report.claims}


def test_a_certificate_that_matches_its_clone_HOLDS(clone):
    from wringer import spec as spec_module

    payload = built(clone, spec_sha256=spec_module.authorising_sha256(clone))
    report = certificate.check(payload, clone)
    assert all(
        claim.outcome != certificate.BROKEN for claim in report.claims
    ), outcomes(report)
    assert report.ok


def test_AN_EDITED_COUNT_OVER_HONEST_ROWS_IS_CAUGHT(clone):
    """The cheapest forgery there is: leave the rows alone and change the
    number above them. It is also the only claim on this page checkable with
    nothing but the page."""
    payload = built(clone, counts={**{s: 0 for s in accept.STATES},
                                   "evidenced": 4})
    report = certificate.check(payload, clone)
    assert not report.ok
    assert outcomes(report)[
        "the counts match the requirements listed below them"
    ] == certificate.BROKEN


def test_A_REQUIREMENT_THE_SPEC_DOES_NOT_DECLARE_IS_CAUGHT(clone):
    """**The strongest thing here, and it needs no evidence bundle at all.**

    A certificate is a claim about a spec. One that names requirements the
    spec in front of the reader does not contain is the forgery worth
    catching, and the reader already has the clone.
    """
    from wringer import spec as spec_module

    payload = built(
        clone,
        rows=ROWS + [row("invented", "A requirement nobody wrote",
                         accept.EVIDENCED)],
        # The clone's REAL digest, so the ids claim is the only thing that can
        # be broken here. A guard red for two reasons is a guard that can stay
        # red for the wrong one, and this one is watching the strongest check
        # in the command.
        spec_sha256=spec_module.authorising_sha256(clone),
    )
    report = certificate.check(payload, clone)
    assert not report.ok
    broken = [c for c in report.claims if c.outcome == certificate.BROKEN]
    assert len(broken) == 1, broken
    assert "invented" in broken[0].detail, broken


def test_a_commit_that_is_not_in_this_clone_IS_CAUGHT(clone, monkeypatch):
    import subprocess

    subprocess.run(["git", "init", "-q", str(clone)], check=True)
    from wringer import spec as spec_module

    payload = built(clone, spec_sha256=spec_module.authorising_sha256(clone))
    report = certificate.check(payload, clone)
    assert outcomes(report)[
        "the commit this was verified at is in this clone"
    ] == certificate.BROKEN


def test_a_receipt_whose_run_did_not_travel_is_NEITHER_A_PASS_NOR_A_FAILURE(
    clone,
):
    """**Three outcomes, and the third is not a hedge.**

    `check` runs against whatever the reader is holding. A claim whose
    evidence did not travel HAS NOT BEEN CHECKED, and reporting that as ✓ or
    ✗ would be a lie in one of the two directions — the same reason
    `demonstrated_able_to_fail` is three-valued rather than two.

    And `ok` stays true, because an ordinary handover carries no run bundles
    at all: a document that read as broken in the normal case would teach its
    readers that red means nothing.
    """
    from wringer import spec as spec_module

    payload = built(clone, spec_sha256=spec_module.authorising_sha256(clone))
    report = certificate.check(payload, clone)
    receipts = [c for c in report.claims if "failing" in c.what]
    assert receipts, report.claims
    assert all(c.outcome == certificate.NOT_HERE for c in receipts), receipts
    assert "did not travel" in receipts[0].detail
    assert report.ok, "an absent bundle is not a broken certificate"


def test_a_receipt_whose_run_IS_here_and_records_no_failure_IS_CAUGHT(clone):
    """The bundle travelled, so the claim is checkable — and it is false.

    The join is `health.gate_runs`, the same reader `accept` used to write
    the receipt. A second implementation here could disagree with the engine
    about whether a run shows a check failing, and two answers to that
    question is the drift this whole program is about.
    """
    from wringer import evidence

    bundle = clone / ".wringer" / "runs" / "20260101-000000-aaaa"
    gate = bundle / "gates" / "001_check"
    gate.mkdir(parents=True)
    (gate / "result.json").write_text(
        json.dumps({
            "schema_version": "wringer.gate.v1",
            "gate_id": "check",
            "command": "pytest -q tests/test_export.py",
            "status": "passed",
            "exit_code": 0,
            "duration_ms": 10,
            "optional": False,
            "timed_out": False,
            "truncated": False,
        }),
        encoding="utf-8",
    )
    (bundle / evidence.MANIFEST_FILENAME).write_text(
        json.dumps({
            "schema_version": "wringer.evidence.v1",
            "run_id": "20260101-000000-aaaa",
            "started_at": "2026-01-01T00:00:00+00:00",
        }),
        encoding="utf-8",
    )
    report = certificate.check(built(clone), clone)
    named = [c for c in report.claims if "The export downloads a CSV" in c.what]
    assert named, [c.what for c in report.claims]
    assert named[0].outcome == certificate.BROKEN, named[0]
    assert not report.ok


# --- author-blind, which is a property to TEST and not to announce ---------


def test_THE_CHECK_NEVER_READS_WHO_PRODUCED_THE_BRANCH(clone):
    """**Author-blind, measured rather than declared.**

    A verification whose answer moves when the author changes is a
    verification of the author. So every name in the document is replaced —
    the judgement's `by`, the change title, the branch — and the outcome of
    every claim must be identical, claim for claim and in the same order.
    """
    from wringer import spec as spec_module

    digest = spec_module.authorising_sha256(clone)
    one = certificate.check(built(clone, spec_sha256=digest), clone)

    disguised = [
        {**r, "judgement": None if not r["judgement"] else {
            **r["judgement"], "by": "Somebody Else Entirely"}}
        for r in ROWS
    ]
    payload = built(clone, rows=disguised, spec_sha256=digest)
    payload["change"]["title"] = "A completely different sounding change"
    payload["change"]["branch"] = "someone-elses/branch"
    two = certificate.check(payload, clone)

    assert [c.outcome for c in one.claims] == [c.outcome for c in two.claims]
    assert one.ok == two.ok


def test_the_offline_check_reads_no_identity_field_anywhere():
    """The grep behind the property above.

    `by` is COPIED into the record — a reviewer must see who judged — and the
    checking half must never branch on it. So the identity words are allowed
    in the rendering half of this module and forbidden below the divider.

    The list is the identity fields that actually exist to be read: the
    record's `by`, and git's own author/committer format specifiers, which
    are the only way this module could ask git who wrote something.
    """
    source = (
        Path(certificate.__file__).read_text(encoding="utf-8")
        .split("# --- checking it, offline")[1]
    )
    for word in ('"by"', "'by'", '["by"]', "committer", "%an", "%ae", "%cn",
                 "%ce", "signed_by", "worker", "agent_name"):
        assert word not in source, (
            f"the offline check reads {word!r} — it must not be able to tell "
            "who produced the branch"
        )


# --- the pages that taught the old sentence -------------------------------
#
# Same shape as `test_bound_gates_are_not_skipped.py`'s doc guard, and the
# same two vacuity classes are avoided ON PURPOSE, because both were MEASURED
# on that guard and each one made it pass with the fix removed:
#
#   1. Subject-matter words near the claim. `certificate` and `board` are
#      ordinary vocabulary on any page that discusses a delivery at all, so a
#      guard keyed on them reads the topic and calls it a correction.
#   2. A dated `AMENDED … 20xx-xx-xx` near the claim. Pages in this repository
#      already carry dated markers about other facts in the same paragraph.
#
# So this asks for the SENTENCE — one wording, wherever the old claim is
# stated, which is also the only way a reader meets the correction in the same
# breath as the thing it corrects.

_STAYS_BEHIND = "stays with the machine that ran it"
_AMENDMENT = (
    "the gate LOGS stay behind; the certificate and a copy of the board "
    "travel with the delivery"
)
_WINDOW = 1500


def _flat(text: str) -> str:
    """Collapse whitespace and drop blockquote markers before matching.

    These pages are hard-wrapped and the amendment is a blockquote, so
    asserting on where a page happens to wrap would be asserting about the
    wrapping — and a naive collapse turns every continuation line into
    `... certificate > and a copy ...`.
    """
    import re

    return " ".join(re.sub(r"(?m)^\s*>\s?", "", text).split()).lower()


def test_no_live_page_still_tells_a_reviewer_the_map_is_not_coming():
    """**The reviewer's second gap, in the pages rather than the code.**

    *"To find out I'd need the board, which the same file tells me 'stays
    with the machine that ran it.' I'm told there's a hole and told the map
    isn't coming."*

    Captures are exempt through `reader_facing_pages(captures=False)` — the
    shipped distinction, not a list written here. A dated record is allowed,
    and required, to say what was true when it was taken, which is why the
    field report that contains the reviewer's complaint keeps the sentence
    verbatim and the tutorial that shows a 2026-08-01 capture carries the
    amendment beside it instead of an edited capture.
    """
    from core_helpers import reader_facing_pages, repo_root

    unqualified = []
    for path in reader_facing_pages(captures=False):
        text = path.read_text(encoding="utf-8")
        start = 0
        while True:
            found = text.find(_STAYS_BEHIND, start)
            if found < 0:
                break
            start = found + 1
            near = text[max(0, found - _WINDOW): found + len(_STAYS_BEHIND)
                        + _WINDOW]
            if _flat(_AMENDMENT) not in _flat(near):
                unqualified.append(
                    f"{path.relative_to(repo_root()).as_posix()}:"
                    f"{text[:found].count(chr(10)) + 1}"
                )
    assert not unqualified, (
        f"these pages say {_STAYS_BEHIND!r} without {_AMENDMENT!r} near it — "
        "the sentence a cold reviewer read as 'the map isn't coming', taught "
        f"as current behaviour: {unqualified}"
    )


def test_the_ENGINE_no_longer_writes_the_broad_sentence_at_all():
    """The page guard above covers prose. This covers the renderer, which is
    where the sentence a reviewer actually reads comes from — and a page
    amended while the code still emits the old claim would be the two
    surfaces disagreeing again, which is the whole subject."""
    from wringer import deliver

    source = Path(deliver.__file__).read_text(encoding="utf-8")
    assert "The full bundle" not in source, (
        "`wring deliver` still claims the whole bundle stays behind"
    )
    assert "The gate LOGS stay with the machine that ran it" in source


def test_a_ONE_REQUIREMENT_CHANGE_IS_NOT_DESCRIBED_IN_THE_PLURAL(tmp_path):
    """Small, and found by READING a real clean-room delivery rather than by
    a test: the release bar's own chain produced *"Of the 1 requirements this
    change was asked to satisfy"*. That is the difference between a sentence
    somebody wrote and a sentence a program assembled, on the first line of
    the document."""
    one = certificate.render(
        built(tmp_path, rows=[row("only", "The only one", accept.EVIDENCED)])
    )
    assert "Of the 1 requirement this change" in one, one
    many = certificate.render(built(tmp_path))
    assert "Of the 4 requirements this change" in many, many


def test_THE_CONSOLE_PRINTS_ITS_OWN_CEILING_AND_POINTS_AT_THE_REST(
    tmp_path, capsys, monkeypatch
):
    """**Nothing is lowered; the wall is.**

    A real delivery's certificate carries thirteen ceiling sentences — its
    own four plus the acceptance record's nine, which is correct and stays,
    because the ceiling has to travel ON the artifact. Printing all thirteen
    after a passing check is how a reader learns to skip the `!` mark, which
    is the lesson `accept.disclosure` already encodes about warnings printed
    over clean records.

    So the console prints THIS COMMAND's ceiling and says where the rest is,
    by name and by count. The measurement that prompted it is in the finish
    report: the release bar's own clean-room delivery, audited by hand.
    """
    from wringer import cli, spec as spec_module

    (tmp_path / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    payload = built(tmp_path, spec_sha256=spec_module.authorising_sha256(tmp_path))
    record_path = tmp_path / certificate.RECORD_FILENAME
    record_path.write_text(json.dumps(payload), encoding="utf-8")

    monkeypatch.chdir(tmp_path)
    cli.main(["audit", str(record_path)])
    printed = capsys.readouterr().out

    for mine in certificate.LIMITS:
        assert mine in printed, f"the command's own ceiling is missing: {mine!r}"
    assert "the record's own ceiling sentence" not in printed, (
        "the console is reprinting the record's whole ceiling after a passing "
        "check, which is how people learn to skip the mark"
    )
    assert "more sentences" in printed and "What this does not say" in printed, (
        "the console dropped sentences and did not say where they went"
    )
