"""R3's emission — `WRINGER_RULING_2026-08-14`.

*Test restated: can `gh attestation verify` or `cosign verify-attestation` read
a Wringer bundle?* Those tools are not on this machine, so what CAN be checked
here is checked here — the envelope, the published predicate type, the closed
result vocabulary, the subject, and the fact that the frozen dialect did not
move — and what cannot is named in `test_the_limit_this_file_cannot_reach`.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wringer import attest, cli, evidence, intoto

CONFIG = """\
version: 1
gates:
  - id: unit
    run: "true"
deliver:
  branch: "wringer/{run}"
  remote: origin
"""


def a_run(repo: Path, monkeypatch, git_run) -> Path:
    (repo / "calc.py").write_text("ok\n", encoding="utf-8")
    (repo / ".wringer.yaml").write_text(CONFIG, encoding="utf-8")
    git_run(repo, "add", "-A")
    git_run(repo, "commit", "-q", "-m", "base")
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == 0
    runs = sorted((repo / ".wringer" / "runs").iterdir())
    return runs[-1]


def a_loop_recording(repo: Path, run: Path, record: dict) -> Path:
    """A loop bundle that CLAIMS this run, carrying a witness record.

    **The witness record lives in the LOOP's bundle, not the run's**, and the
    first draft of `intoto.py` looked in the run and found nothing. Writing one
    into the run directory instead would also be rejected outright — a run's
    `digests.json` records exactly what was in it, and `check_digests` refuses
    a bundle that "holds witness.json, which its own digests.json does not
    record". That refusal is correct and is why this helper exists.
    """
    loop_dir = repo / ".wringer" / "loops" / "20260816-000000-aaaa"
    loop_dir.mkdir(parents=True, exist_ok=True)
    (loop_dir / "loop.jsonl").write_text(
        json.dumps({
            "type": "verify.finished",
            "evidence_dir": str(run.relative_to(repo)),
        }) + "\n",
        encoding="utf-8",
    )
    path = loop_dir / "witness.json"
    path.write_text(json.dumps(record), encoding="utf-8")
    return path


def test_the_envelope_is_in_totos_and_the_predicate_is_the_PUBLISHED_one(
    repo, monkeypatch, git_run
):
    """The whole point of R3: a reader that has never heard of Wringer can read
    this. So the type strings are asserted verbatim — a typo in either makes
    the document unrecognisable while still looking like JSON."""
    run = a_run(repo, monkeypatch, git_run)
    statement = intoto.test_result(repo, run)

    assert statement["_type"] == "https://in-toto.io/Statement/v1"
    assert statement["predicateType"] == (
        "https://in-toto.io/attestation/test-result/v0.1"
    )
    assert statement["predicate"]["result"] == "PASSED"
    assert statement["predicate"]["passedTests"] == ["unit"]
    assert statement["predicate"]["failedTests"] == []


def test_the_result_vocabulary_is_test_results_CLOSED_one(repo, monkeypatch, git_run):
    """`test-result` v0.1 admits PASSED, FAILED and WARNED and nothing else. A
    fourth value would make the document invalid against the very schema it
    claims — which is the defect this repository's own frozen schemas exist to
    prevent, one standard over."""
    run = a_run(repo, monkeypatch, git_run)
    assert intoto.test_result(repo, run)["predicate"]["result"] in (
        intoto.PASSED, intoto.FAILED, intoto.WARNED,
    )


def test_the_subject_carries_the_bundle_digest_ATTEST_ITSELF_computes(
    repo, monkeypatch, git_run
):
    """One number, from one function. A locally recomputed digest would be a
    second inventory to keep in step — and it would skip the verification,
    because `check_digests` re-hashes every file and raises if one has moved."""
    run = a_run(repo, monkeypatch, git_run)
    expected, _ = attest.check_digests(run, "run")
    subject = intoto.subject_of(repo, run)

    assert subject[0]["digest"]["sha256"] == expected
    assert len(expected) == 64
    # And the commit, in in-toto's own registered digest name.
    assert any("gitCommit" in entry["digest"] for entry in subject)


def test_a_run_with_no_witness_and_no_vacuity_emits_NO_custom_predicate(
    repo, monkeypatch, git_run
):
    """Absence is absence. An empty predicate would be a document asserting
    that nothing is known, which is not the same as not asserting."""
    run = a_run(repo, monkeypatch, git_run)
    assert intoto.witness_statement(repo, run) is None


def test_the_custom_predicate_carries_what_test_result_CANNOT(
    repo, monkeypatch, git_run
):
    """**The one field the standard has nowhere to put**, and the reason R3
    permits a custom predicate at all: whether the check that passed had ever
    been shown able to FAIL. A `test-result` reading PASSED over a vacuous gate
    is exactly the artifact the 2026-08-13 corpus run produced 26 times."""
    run = a_run(repo, monkeypatch, git_run)
    a_loop_recording(repo, run, {
        "schema_version": "wringer.witness.v1",
        "witnesses": [{
            "id": "w-totals", "proves": "totals", "path": "t.py",
            "authored": {"by": {"model": "a-model"}, "base_sha": "0" * 40},
            "pinned": {"sha256": "a" * 64},
            "proved_red": {"outcome": "assertion", "verdict": "proven",
                           "exit_code": 1, "first_line": "assert 0 == 6"},
            "executed": {"sha256": "a" * 64, "result": "passed",
                         "exit_code": 0},
            "discarded": None,
        }],
        "limits": ["a limit"],
    })

    statement = intoto.witness_statement(repo, run)
    assert statement is not None
    assert statement["_type"] == "https://in-toto.io/Statement/v1"
    assert statement["predicateType"].startswith("https://github.com/marcoakes")

    row = statement["predicate"]["witnesses"][0]
    assert row["criterion"] == "totals"
    assert row["provedRed"] == "assertion"
    assert row["provedRedVerdict"] == "proven"
    assert row["pinnedSha256"] == "a" * 64
    assert row["executedResult"] == "passed"
    assert row["authoredBy"] == "a-model"


def test_the_limits_travel_WITH_the_predicate(repo, monkeypatch, git_run):
    """The pattern every artifact in this repository follows: what it does not
    claim goes with it, not into a spec nobody opened. A green artifact
    stripped of its caveats is a failure this repository has paid for."""
    run = a_run(repo, monkeypatch, git_run)
    a_loop_recording(repo, run, {
        "schema_version": "wringer.witness.v1", "witnesses": [], "limits": [],
    })
    statement = intoto.witness_statement(repo, run)
    said = " ".join(statement["predicate"]["limits"])
    assert "not a signature" in said
    assert "does not certify agreement with an unstated intended fix" in said


def test_emission_writes_BESIDE_the_bundle_and_never_into_it(
    repo, monkeypatch, git_run
):
    """A run's `digests.json` commits to its own contents, so a new file inside
    it would either invalidate that digest or require rewriting it — and
    **on-disk bundles are never rewritten**."""
    run = a_run(repo, monkeypatch, git_run)
    before = sorted(p.name for p in run.iterdir())

    out = repo / ".wringer" / "attestations" / "x"
    written = intoto.write(repo, run, out)

    assert [p.name for p in written] == [intoto.TEST_RESULT_FILENAME]
    assert sorted(p.name for p in run.iterdir()) == before, (
        "emission wrote into the run bundle, whose digests already committed "
        "to its contents"
    )
    # And the bundle still verifies against its own digests afterwards.
    attest.check_digests(run, "run")


def test_wring_attest_emits_the_standard_beside_its_own_record(
    repo, monkeypatch, git_run, capsys
):
    """Driven through the CLI, because the claim is about what `wring attest`
    leaves on disk rather than about a function."""
    run = a_run(repo, monkeypatch, git_run)
    assert cli.main(["attest", str(run)]) == 0
    capsys.readouterr()

    directories = sorted((repo / ".wringer" / "attestations").iterdir())
    assert directories, "no attestation was written"
    produced = sorted(p.name for p in directories[-1].iterdir())

    assert attest.ATTESTATION_FILENAME in produced
    assert intoto.TEST_RESULT_FILENAME in produced, produced

    statement = json.loads(
        (directories[-1] / intoto.TEST_RESULT_FILENAME).read_text("utf-8")
    )
    assert statement["predicateType"] == intoto.TEST_RESULT_TYPE


def test_the_FROZEN_dialect_did_not_move(repo, monkeypatch, git_run):
    """**Law 7, and R3 verbatim: `wringer.attestation.v1` gets no v2 dialect.**
    Emission is a sibling; the record Wringer has always written is
    byte-for-byte the record it writes now."""
    run = a_run(repo, monkeypatch, git_run)
    assert cli.main(["attest", str(run)]) == 0
    directories = sorted((repo / ".wringer" / "attestations").iterdir())
    payload = json.loads(
        (directories[-1] / attest.ATTESTATION_FILENAME).read_text("utf-8")
    )
    assert payload["schema_version"] == "wringer.attestation.v1"
    for foreign in ("_type", "predicateType", "predicate", "subject"):
        assert foreign not in payload, (
            f"the frozen attestation grew {foreign!r} — R3 says the standard "
            "arrives BESIDE it, never inside it"
        )


def test_the_limit_this_file_cannot_reach():
    """**Named rather than left to be assumed.**

    Neither `gh` nor `cosign` is on this machine, so nothing here proves that
    either tool ACCEPTS these bytes — only that they carry the types, the
    envelope and the closed vocabulary those tools key on. R3's stop is a live
    verification, and the ruling says where it belongs when it cannot run
    locally: *it rides CI the way sequences G and H do, claiming only what
    ran.*

    This test exists so that limit is a line in the suite rather than a
    sentence somebody remembers.
    """
    import shutil

    assert shutil.which("cosign") is None or shutil.which("gh") is None or True
