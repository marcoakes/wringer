"""S2, second half — the seven families that are not a criterion, on the page.

The mapping was total after S2's first commit and **seven of its ten families
reached no page at all**: loop endings, vacuity verdicts, health verdicts,
signature, identity, integrity and fleet outcomes. `docs/BOARD_S2.md` said so
in its own "what did NOT land" section rather than claiming the slice. This
file is that section being discharged.

**The test that matters most in here is not the seven that render a sentence.**
It is `test_a_missing_artifact_renders_NOTHING_about_its_family`: a mapping
that renders `signature_missing` because it found no signature would be the
surface reaching a verdict by not looking, and *a missing artifact and a bad
verdict are different facts*. Every family is checked in that direction as well
as this one, because the direction a lazy build skips is that one.
"""

from __future__ import annotations

import json

import pytest
from board_helpers import (
    criterion,
    write_audit_report,
    write_fleet,
    write_health_report,
    write_loop_manifest,
    write_run,
    write_vacuity,
)

from wringer_board import read as read_module
from wringer_board import refusals
from wringer_board import render as render_module

RUN = "20260816-090000-aaaa"
LOOP = "20260816-085959-0001"
FLEET = "20260816-085900-f001"


def _with_cards(repo):
    """A run the board can render at all, so the round section has a page."""
    write_run(
        repo,
        RUN,
        [criterion("a", "Something", "gate-failed", refuses=True)],
        gates={"suite": ("stderr", "nope")},
    )
    return repo


def _page(repo, **reports) -> str:
    return render_module.render(read_module.read(repo, **reports))


def _round(page: str) -> str:
    """Just the round section — so an assertion about it cannot be satisfied
    by a card, a limit, or the engineers' block further down the page."""
    if 'class="round"' not in page:
        return ""
    return page.split('<section class="round">', 1)[1].split("</section>", 1)[0]


# --- one family at a time, each from the artifact the engine actually writes --


def test_a_loop_ending_reaches_the_page_in_PM_language(repo, tmp_path):
    """`.wringer/loops/<id>/manifest.json` → `result.reason` (`loop.py:300`)."""
    _with_cards(repo)
    write_loop_manifest(repo, LOOP, "max_iterations")
    assert "used up the number of attempts it was allowed" in _round(_page(repo))


def test_a_vacuity_verdict_reaches_the_page_in_PM_language(repo):
    """`<run bundle>/vacuity.json` → `verdict` (`evidence.py:95`)."""
    _with_cards(repo)
    write_vacuity(repo, RUN, "gates_vacuous")
    assert "none of them noticed it" in _round(_page(repo))


def test_a_health_verdict_reaches_the_page_in_PM_language(repo, tmp_path):
    """`wring health --json --output PATH` → `gates[].verdict`."""
    _with_cards(repo)
    report = write_health_report(tmp_path / "health.json", ["zombie"])
    assert "may have stopped testing anything" in _round(
        _page(repo, health_report=report)
    )


@pytest.mark.parametrize(
    "axis,value,must_say",
    [
        ("signature", "signature_invalid", "does NOT check out"),
        ("identity", "identity_untrusted", "did NOT say it would trust"),
        ("integrity", "integrity_invalid", "has been altered since it was written"),
    ],
)
def test_the_three_audit_axes_reach_the_page_in_PM_language(
    repo, tmp_path, axis, value, must_say
):
    """**`wring audit --json`, and there is nowhere else these come from.**

    `attestation.json` does not carry them: its own `signature` field is null
    in v0 by ruling, and `change.commit_signature.status` is git's `%G?`
    letter, a different vocabulary. `sign.assess` produces these three inside
    `attest.audit` and only `wring audit --json` emits them (`cli.py:3624`).
    """
    _with_cards(repo)
    report = write_audit_report(tmp_path / "audit.json", **{axis: value})
    assert must_say in _round(_page(repo, audit_report=report))


def test_a_fleet_outcome_reaches_the_page_in_PM_language(repo):
    """`.wringer/fleets/<id>/manifest.json` → `tasks[].status` (`fleet.py:36`)."""
    _with_cards(repo)
    write_fleet(repo, FLEET, ["parked"])
    assert "set aside rather than finished or failed" in _round(_page(repo))


# --- the direction a lazy build skips ----------------------------------------


def test_a_missing_artifact_renders_NOTHING_about_its_family(repo, tmp_path):
    """**Ruling 11, widened from vacuity and health to all seven.**

    *Absence is not a verdict.* The board is one line of code away, in every
    one of these families, from rendering "nobody signed this" because it
    found no report — which would be this surface reaching `sign.assess`'s
    conclusion by not looking, and ruling 1 forbids it outright.

    The page is rendered with a criterion, a loop LEDGER and no other artifact
    at all: no loop manifest, no `vacuity.json`, no health report, no audit
    report, no fleet bundle. Nothing about any of the seven may appear —
    asserted phrase by phrase, because "the section is absent" would also pass
    if the section had been quietly deleted.
    """
    _with_cards(repo)
    page = _page(repo)

    for family in (
        refusals.LOOP_ENDING,
        refusals.VACUITY_VERDICT,
        refusals.HEALTH_VERDICT,
        refusals.SIGNATURE,
        refusals.IDENTITY,
        refusals.INTEGRITY,
        refusals.FLEET_OUTCOME,
    ):
        for value in refusals.values_for(family):
            saying = refusals.say(family, value)
            assert saying.sentence not in page, (
                f"{family}/{value} was rendered from an artifact that is not "
                "there — a missing measurement rendered as a verdict"
            )
    assert 'class="round"' not in page, (
        "the round section rendered with no facts in it, which is a heading "
        "asserting that something happened"
    )


def test_no_audit_report_means_the_page_never_says_UNSIGNED(repo):
    """The single most tempting one, stated on its own.

    `signature_missing` is the ORDINARY case for local work and its sentence is
    reassuring — which is exactly why a board that inferred it would be
    believed. The board may render it when `wring audit` said it, and never
    because nobody ran `wring audit`.
    """
    _with_cards(repo)
    page = _page(repo)
    assert "Nobody signed this record" not in page
    assert "signature" not in _round(page)


_UNREADABLE = (
    "absent",  # the operator named a path and the file is not there
    "not_json",  # it is there and it is not JSON
    "wrong_type",  # it is valid JSON and it is not an object
    "empty",  # it is a valid empty object
    "no_verdicts",  # it is the right shape and carries no verdict at all
)


@pytest.mark.parametrize("how", _UNREADABLE)
@pytest.mark.parametrize("which", ("health", "audit"))
def test_a_report_that_cannot_be_read_renders_NOTHING_rather_than_a_default(
    repo, tmp_path, which: str, how: str
):
    """**The absence discipline, closed over every way a read can fail.**

    The first version of this slice guarded absence in ONE shape — "no path was
    given" — and an adversarial pass found eleven mutations that make the page
    assert a verdict the engine never wrote while all fifty-six tests stayed
    green. The worst was the one the commit message had singled out as watched:
    splitting `read_audit`'s `if path is None or not path.is_file()` so that a
    path pointing at a MISSING file returns `signature_missing`. A typo in an
    operator's `--audit-report` would then have printed "Nobody signed this
    record" — the surface reaching `sign.assess`'s conclusion by not looking,
    which ruling 1 forbids outright, and the single most believable thing this
    page could get wrong because that verdict is the ordinary local answer.

    A path that was NAMED and could not be read is not the same fact as a path
    that was never named, and neither is a verdict. Both render nothing here;
    the second is reported to the operator by the engineers' block, and neither
    is ever answered with a default.

    Parametrised over both readers and over five ways a file can fail to be a
    report, because the defect was never in one branch — it was in guarding one
    branch and calling the discipline covered.
    """
    _with_cards(repo)
    path = tmp_path / f"{which}.json"
    if how == "not_json":
        path.write_text("{not json at all", encoding="utf-8")
    elif how == "wrong_type":
        path.write_text('["a list, not an object"]', encoding="utf-8")
    elif how == "empty":
        path.write_text("{}", encoding="utf-8")
    elif how == "no_verdicts":
        payload = (
            {"schema_version": "wringer.health.v1", "gates": [], "retired": []}
            if which == "health"
            else {"run": "20260816-000000-0000"}
        )
        path.write_text(json.dumps(payload), encoding="utf-8")
    # "absent": deliberately never written.

    page = _page(repo, **{f"{which}_report": path})
    families = (
        (refusals.HEALTH_VERDICT,)
        if which == "health"
        else (refusals.SIGNATURE, refusals.IDENTITY, refusals.INTEGRITY)
    )
    for family in families:
        for value in refusals.values_for(family):
            saying = refusals.say(family, value)
            assert saying.sentence not in page, (
                f"a {which} report that was {how} produced {family}/{value} — "
                "an unreadable measurement rendered as a verdict, which is the "
                "one thing this section may never do"
            )


def test_an_artifact_appearing_LATER_starts_being_rendered(repo, tmp_path):
    """The absence test's other half: absence must be absence, not blindness.

    Without this, deleting the whole feature would pass every assertion above.
    """
    _with_cards(repo)
    assert "used up the number of attempts" not in _page(repo)
    write_loop_manifest(repo, LOOP, "max_iterations")
    assert "used up the number of attempts" in _page(repo)


# --- ruling 17, on this section, through the SAME mechanism ------------------


def test_an_unmapped_value_lands_in_UNTRANSLATED_with_the_engines_own_words(repo):
    """**Ruling 17**, and `loop-manifest-v2`'s `reason` is an OPEN string
    (`schema/loop-manifest-v2.schema.json`), so a value this table has never
    heard of is a shipped possibility rather than a hypothetical.

    Never invisibly, never swallowed, never best-effort prettified. A PM seeing
    an ugly string files a bug report; a PM seeing nothing has been lied to.
    """
    _with_cards(repo)
    write_loop_manifest(repo, LOOP, "the_flux_capacitor_declined_to_comment")

    section = _round(_page(repo))
    assert "UNTRANSLATED" in section
    assert "the_flux_capacitor_declined_to_comment" in section
    assert "no plain-English wording for it yet" in section
    for value in refusals.values_for(refusals.LOOP_ENDING):
        assert refusals.say(refusals.LOOP_ENDING, value).sentence not in section, (
            "an unmapped ending was rendered as a mapped one, which is "
            "rendering one fact as another"
        )


def test_the_untranslated_block_is_ONE_mechanism_shared_with_the_cards(repo):
    """Ruling 17 has one implementation, not two.

    A second copy is how one of the two paths quietly stops being verbatim —
    so the card path and the round path are asserted to emit the same block.
    """
    write_run(
        repo,
        RUN,
        [criterion("a", "Something", "unevidenced", reason="a reason nothing matches")],
    )
    write_loop_manifest(repo, LOOP, "an_ending_nothing_matches")
    page = _page(repo)
    assert page.count("no plain-English wording for it yet") == 2
    assert "a reason nothing matches" in page
    assert "an_ending_nothing_matches" in _round(page)


# --- a version this board does not know is not parsed ------------------------


def test_an_artifact_in_an_UNKNOWN_VERSION_is_not_parsed_and_is_not_silent(repo):
    """Ruling 6's rule, applied to the artifacts ruling 6 predates.

    A version off the known list gets no best-effort parsing — and reading
    `result.reason` out of a schema this board has never seen is exactly that,
    because the board cannot know where a later version put the field.

    So the PM section stays silent, and the fact that something on disk went
    unread is named in the engineers' block. **Silence in both places would
    make an unreadable artifact indistinguishable from an absent one**, which
    is the distinction this whole file is about.
    """
    _with_cards(repo)
    write_loop_manifest(repo, LOOP, "converged", version="wringer.loop.v99")

    import re

    page = _page(repo)
    assert "The work finished" not in page, (
        "a field was read out of a schema version this board does not know"
    )
    # Comments stripped first: a version named only inside `<!-- -->` is a
    # version named nowhere, and the first version of this assertion passed on
    # exactly that.
    visible = re.sub(r"<!--.*?-->", "", page, flags=re.S)
    engineers = visible.split("<summary>For engineers</summary>", 1)[1]
    assert "wringer.loop.v99" in engineers, (
        "an artifact was on disk, went unread, and the page accounts for it "
        "nowhere — indistinguishable from an artifact that is not there"
    )
    assert "wringer.loop.v99" not in _round(page), (
        "a version number reached a PM's line — B4"
    )


def test_both_loop_manifest_versions_are_read(repo):
    """v1 froze `reason` as a closed six-value enum and v2 opened it to a
    string; both put it at `result.reason`, and the repository's own real
    bundles are v1. A board that knew only v2 could not read them."""
    assert read_module.KNOWN_LOOP == ("wringer.loop.v1", "wringer.loop.v2")
    _with_cards(repo)
    write_loop_manifest(repo, LOOP, "no_progress", version="wringer.loop.v1")
    assert "an attempt changed nothing at all" in _round(_page(repo))


# --- what the section is, and what it may not be -----------------------------


def test_the_round_section_is_NOT_a_criterion_card(repo, tmp_path):
    """It sits between the counts and the cards and must not read as one.

    A reader who mistook "the work stopped because it ran out of attempts" for
    a requirement would be reading a round-level fact as a per-requirement
    verdict — one fact rendered as another, which is the failure ruling 15
    names for causes and which applies just as hard here.
    """
    _with_cards(repo)
    write_loop_manifest(repo, LOOP, "budget_exhausted")
    page = _page(repo)
    section = _round(page)

    assert 'class="card' not in section
    assert "<h2>" in section and "What happened in this round" in section
    assert "Refused" not in section
    assert "It was red first." not in section
    # Between the counts and the first card, in that order.
    assert page.index('class="counts"') < page.index('class="round"')
    assert page.index('class="round"') < page.index('class="card ')


def test_a_verdict_this_page_did_not_compute_is_ATTRIBUTED(repo, tmp_path):
    """**Ruling 13**: a verdict the surface did not earn is attributed, or it
    is a padlock this surface did not earn.

    `integrity_valid`'s sentence — every file is byte-for-byte what it was — is
    a strong claim, and the board neither computed it nor could. So the page
    says whose answer it is. It says so in the engineers' block rather than on
    a PM's line, because the round section carries no wording of its own; what
    ruling 13 forbids is an unattributed padlock, and there is none.
    """
    _with_cards(repo)
    report = write_audit_report(tmp_path / "audit.json", integrity="integrity_valid")
    page = _page(repo, audit_report=report)
    engineers = page.split("<summary>For engineers</summary>", 1)[1]
    assert "wring audit" in engineers
    assert "did not check them itself" in engineers
    assert "wring audit" not in _round(page), "a command name reached a PM's line"


def test_the_facts_render_in_the_MAPPINGS_declared_order(repo, tmp_path):
    """Declared order, never sorted by severity — which would be the surface
    deciding which facts matter, the same call ruling 4 refuses for cards."""
    _with_cards(repo)
    write_fleet(repo, FLEET, ["failed"])
    write_vacuity(repo, RUN, "inconclusive")
    write_loop_manifest(repo, LOOP, "oscillating")
    report = write_audit_report(tmp_path / "audit.json", integrity="integrity_valid")

    board = read_module.read(repo, audit_report=report)
    assert [fact.family for fact in board.facts] == [
        refusals.LOOP_ENDING,
        refusals.VACUITY_VERDICT,
        refusals.INTEGRITY,
        refusals.FLEET_OUTCOME,
    ]


def test_repeated_values_are_said_ONCE(repo, tmp_path):
    """Four succeeded tasks are one fact, not four sentences.

    The board names no task and no check — B4 — so four copies of one sentence
    would be four undistinguishable lines, and a reader counting them would be
    counting nothing.
    """
    _with_cards(repo)
    write_fleet(repo, FLEET, ["succeeded", "succeeded", "failed", "succeeded"])
    report = write_health_report(tmp_path / "health.json", ["alive", "alive", "alive"])
    section = _round(_page(repo, health_report=report))
    assert section.count("This piece of work finished and its checks passed.") == 1
    assert section.count("still capable of telling you something") == 1


def test_this_section_says_NOTHING_that_is_not_in_the_mapping(repo, tmp_path):
    """**Why the two exhaustive greps in `test_refusals.py` still cover this.**

    Those greps run over `refusals.MAPPING` and `cards.py`'s literals. They
    reach this section only for as long as this section has no wording of its
    own — so that is asserted directly, over the RENDERED text rather than over
    the source: every line a PM can read here is a mapping sentence, the
    heading, or ruling 17's untranslated block with the engine's own word in
    it. A sentence written in `render.py` would be a string the Q1 ceiling and
    the jargon list never see.
    """
    import re

    _with_cards(repo)
    write_loop_manifest(repo, LOOP, "an_ending_nothing_matches")
    write_vacuity(repo, RUN, "inconclusive")
    write_fleet(repo, FLEET, ["succeeded", "failed", "parked"])
    health = write_health_report(
        tmp_path / "health.json", ["alive", "zombie", "untested", "retired"]
    )
    audit = write_audit_report(
        tmp_path / "audit.json",
        signature="signature_valid",
        identity="identity_trusted",
        integrity="integrity_valid",
    )

    section = _round(_page(repo, health_report=health, audit_report=audit))
    allowed = {saying.sentence for saying in refusals.MAPPING.values()} | {
        "What happened in this round",
        "UNTRANSLATED",
        "Wringer said, and this board has no plain-English wording for it yet",
        "an_ending_nothing_matches",
    }
    said = [
        line.strip()
        for line in re.sub(r"<[^>]+>", "\n", section).splitlines()
        if line.strip()
    ]
    assert said, "the fixture stopped producing a section"
    assert set(said) - allowed == set(), (
        "the round section has wording of its own, which the ceiling greps do "
        f"not reach: {sorted(set(said) - allowed)}"
    )


# --- the whole page, from artifacts a REAL run wrote -------------------------

# Copied verbatim out of `/Users/marc/Claude/first-contact/demo-rehearsal`, a
# repository a real `wring run` drove on 2026-08-11, and out of reports the
# real engine wrote over those bundles on 2026-08-16. Fixtures are a second
# copy of the engine's output shape — the drift ruling 1 exists to refuse — so
# the load-bearing guard is bytes the engine produced.

REAL_LOOP_MANIFEST = {
    "schema_version": "wringer.loop.v1",
    "loop_id": "20260811-183109-9d53",
    "started_at": "2026-08-11T19:31:09+01:00",
    "repo": {
        "root": ".",
        "head_sha": "b6bcd41bb6255273860ed7e608091a7f7db8eafb",
        "branch": "main",
        "dirty": True,
    },
    "config": {"max_iterations": 5, "worker": "sh ./oneshot.sh"},
    "result": {
        "status": "converged",
        "reason": "converged",
        "iterations": 2,
        "final_run": ".wringer/runs/20260811-183109-5a78",
    },
}

REAL_VACUITY = {
    "schema_version": "wringer.vacuity.v1",
    "verdict": "proven",
    "reason": (
        "bind-hdr, bind-rows, bind-cents failed on the pre-change tree, "
        "so the gates test this change"
    ),
    "worktree_ms": 118,
    "prove_ms": 402,
    "setup": None,
    "gates": [],
}

# `wring fleet tasks.jsonl`, 2026-08-16 — one task, one loop, converged.
REAL_FLEET_MANIFEST = {
    "schema_version": "wringer.fleet.v1",
    "fleet_id": "20260816-214704-7da1",
    "started_at": "2026-08-16T22:47:04+01:00",
    "config": {"concurrency": 2, "deadline": 600, "retries": 1, "join": "all"},
    "result": {"succeeded": 1, "failed": 0, "parked": 0, "join_satisfied": True},
    "tasks": [
        {
            "id": "csv",
            "status": "succeeded",
            "reason": "converged",
            "attempts": 1,
            "loops": ["20260816-214704-d270"],
        }
    ],
}

# `wring audit --json`, 2026-08-16, over an attestation `wring attest` built
# from those same bundles. **The ordinary local answer**: intact, unsigned, and
# nobody named in advance who to trust.
REAL_AUDIT = {
    "ok": True,
    "attestation": ".wringer/attestations/20260816-214636-330c/attestation.json",
    "checked": [],
    "problem": None,
    "integrity": "integrity_valid",
    "signature": "signature_missing",
    "identity": "identity_unknown",
    "signature_reason": "no signature beside this attestation.",
    "limits": [],
    "signature_limits": [],
}

# `wring health --json`, 2026-08-16, over the same repository's bundles.
REAL_HEALTH_VERDICTS = ["alive", "alive", "alive", "untested", "retired"]


def test_the_real_artifacts_of_a_real_run_all_render(repo, tmp_path):
    """Every one of the seven, from bytes the engine wrote rather than fixtures.

    Two of these were got wrong by reading alone before this test existed and
    are pinned here for that reason: the real loop manifests on disk are
    `wringer.loop.v1`, not the v2 the current engine writes, and the real audit
    report carries **no `schema_version` at all** because it is a CLI report
    rather than a bundle.
    """
    _with_cards(repo)
    loop = repo / ".wringer" / "loops" / "20260811-183109-9d53"
    loop.mkdir(parents=True)
    (loop / "manifest.json").write_text(
        json.dumps(REAL_LOOP_MANIFEST), encoding="utf-8"
    )
    (repo / ".wringer" / "runs" / RUN / "vacuity.json").write_text(
        json.dumps(REAL_VACUITY), encoding="utf-8"
    )
    fleet = repo / ".wringer" / "fleets" / "20260816-214704-7da1"
    fleet.mkdir(parents=True)
    (fleet / "manifest.json").write_text(
        json.dumps(REAL_FLEET_MANIFEST), encoding="utf-8"
    )
    audit = tmp_path / "audit.json"
    audit.write_text(json.dumps(REAL_AUDIT), encoding="utf-8")
    health = write_health_report(tmp_path / "health.json", REAL_HEALTH_VERDICTS)

    section = _round(_page(repo, health_report=health, audit_report=audit))

    for must_say in (
        "The work finished",  # loop: converged
        "at least one of them noticed the difference",  # vacuity: proven
        "still capable of telling you something",  # health: alive
        "not enough history yet",  # health: untested
        "no longer part of the set being run",  # health: retired
        "Nobody signed this record",  # signature_missing
        "never wrote down whose signature it expects",  # identity_unknown
        "byte-for-byte what it was",  # integrity_valid
        "finished and its checks passed",  # fleet: succeeded
    ):
        assert must_say in section, f"a real value did not render: {must_say!r}"
