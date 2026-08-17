"""`acceptance.json` — the bridge from "gates pass" to "the spec is satisfied".

SPEC_ACCEPT_V0.md §3 and §4, slice A2. A criterion is **evidenced** only when
its bound gate passed in this run AND the record shows that gate can fail.
The second half is the anti-fraud core: a worker that writes both the
acceptance gate and the code it must pass is the vacuity problem in a new
hat, and a gate born green has never demonstrated it can tell satisfied from
unsatisfied.

Two opt-in boundaries are load-bearing and both are tested as boundaries
rather than described:

- **approval, not presence** (ruling 8) — `wring spec` writes model-drafted
  criteria with `approved: false`, and an unapproved draft must change
  nothing at all;
- **binding, not declaring** (ruling 9) — an unbound criterion is loud and
  never fatal, because criteria default `required: true` and nothing is
  bound the moment a spec is approved.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from wringer import accept, cli, config, evidence


def commit(repo: Path, message: str = "the code as it stood") -> None:
    """Put the tree into HEAD, so what follows can be a CHANGE to it.

    The `repo` fixture is one empty commit, so without this NOTHING in the
    tree pre-dates the work — and since 2026-08-11 a sensitivity receipt has
    to establish that the gate it rests on did. Refusing in a tree where
    everything arrived at once is the ruled behaviour, not a quirk to work
    around, so the tests that want a real receipt build a real repo.
    """
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True,
                   capture_output=True)
    subprocess.run(["git", "commit", "-q", "-m", message], cwd=repo,
                   check=True, capture_output=True)

SPEC = """\
schema_version: wringer.spec.v1
approved: {approved}
title: CSV export
intent: The reports page can export what it shows.
tasks:
  - id: build
    brief: Build it
    objective: The reports page exports a CSV.
criteria:
  - id: csv-downloads
    title: The export downloads a CSV
    required: true
{extra}"""

HUMAN_CRITERION = """\
  - id: copy-reads-well
    title: The copy reads the way our users speak
    required: true
    human: true
"""


def write_spec(repo: Path, *, approved: bool = True, extra: str = "") -> None:
    (repo / "wringer.spec.yaml").write_text(
        SPEC.format(approved="true" if approved else "false", extra=extra),
        encoding="utf-8",
    )


def write_config(repo: Path, gates: str) -> None:
    (repo / ".wringer.yaml").write_text(
        f"version: 1\ngates:\n{gates}", encoding="utf-8"
    )


def bound_config(repo: Path, *, command: str = "true") -> None:
    write_config(
        repo,
        f'  - id: csv\n    run: "{command}"\n    proves: csv-downloads\n',
    )


def artifact(repo: Path) -> dict:
    run = evidence.latest_run(repo / evidence.RUNS_DIRNAME)
    assert run is not None
    return json.loads(
        (run / accept.ACCEPTANCE_FILENAME).read_text(encoding="utf-8")
    )


def state_of(repo: Path, criterion: str) -> str:
    rows = {row["criterion"]: row for row in artifact(repo)["criteria"]}
    return rows[criterion]["state"]


# --- the opt-in boundaries -------------------------------------------------


def test_an_unapproved_spec_writes_no_artifact_at_all(repo, monkeypatch, capsys):
    """Ruling 8, and the interlock it protects. `wring spec` drafts criteria
    with `approved: false`; triggering on the file's PRESENCE would hand a
    model-written draft delivery-blocking force before a person had read it —
    the exact interlock SPEC_INTENT §3 exists to hold, and the repair
    SPEC_PROVENANCE §2a already had to make once for attest."""
    write_spec(repo, approved=False)
    bound_config(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    run = evidence.latest_run(repo / evidence.RUNS_DIRNAME)
    assert run is not None
    assert not (run / accept.ACCEPTANCE_FILENAME).exists(), (
        "an unapproved draft produced an acceptance artifact"
    )


def test_a_repo_with_no_spec_writes_no_artifact(repo, monkeypatch, capsys):
    """The other half of the boundary: every repo that never heard of this
    feature must be untouched by it."""
    write_config(repo, '  - id: t\n    run: "true"\n')
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    run = evidence.latest_run(repo / evidence.RUNS_DIRNAME)
    assert run is not None
    assert not (run / accept.ACCEPTANCE_FILENAME).exists()


def test_an_unbound_criterion_is_loud_and_not_fatal(repo, monkeypatch, capsys):
    """Ruling 9. Criteria default `required: true` and nothing is bound the
    moment a spec is approved, so refusing here would refuse the FIRST
    delivery in every spec repo — health ruling 6's wall of red, arriving
    through the door this feature's opt-in used to justify itself."""
    write_spec(repo)
    write_config(repo, '  - id: t\n    run: "true"\n')
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    row = artifact(repo)["criteria"][0]
    assert row["state"] == accept.UNEVIDENCED
    assert row["refuses"] is False, "an unbound criterion refused delivery"
    assert row.get("gate") is None


# --- the anti-fraud core ---------------------------------------------------


def test_a_born_green_gate_evidences_nothing(repo, monkeypatch, capsys):
    """The attack this feature exists to survive: a worker writes the
    acceptance gate AND the code it must pass, and the gate has never once
    demonstrated it can tell satisfied from unsatisfied. Green is not
    evidence; green plus a recorded red is."""
    write_spec(repo)
    bound_config(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    row = artifact(repo)["criteria"][0]
    assert row["state"] == accept.UNEVIDENCED, row
    assert row["receipt"] is None
    assert row["refuses"] is True, "a bound, unevidenced criterion must refuse"
    assert "--prove" in row["reason"], row["reason"]


def test_a_recorded_failure_evidences_the_criterion(repo, monkeypatch, capsys):
    """The honest flow, and the one the spec says this program has always
    wanted: install the acceptance gate first, watch it FAIL — the criterion
    is unmet, which is true — then build. The red run becomes the receipt."""
    write_spec(repo)
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    bound_config(repo, command="grep -q FIXED calc.py")
    monkeypatch.chdir(repo)

    # Red: the criterion is not met, and the artifact says so honestly.
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    assert state_of(repo, "csv-downloads") == accept.GATE_FAILED

    # Green, with the red now in the record.
    (repo / "calc.py").write_text("FIXED\n", encoding="utf-8")
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    row = artifact(repo)["criteria"][0]
    assert row["state"] == accept.EVIDENCED, row
    assert row["refuses"] is False
    assert row["receipt"]["kind"] == "failure"
    assert (repo / row["receipt"]["bundle"]).is_dir(), row["receipt"]


def test_a_gate_that_arrived_with_the_change_cannot_evidence_it(
    repo, monkeypatch, capsys
):
    """The defect a real end-to-end run produced by itself, 2026-08-11.

    The drafter bound criteria to tests in a file that did not exist. The
    gates failed at once — `ModuleNotFoundError`, red for the wrong reason —
    and the agent then wrote that file along with the code it checks.
    `--prove` saw fail-then-pass, issued `sensitive` receipts, acceptance
    counted four of them and delivery went through. **The harness certified
    work whose acceptance tests its own worker had written.**

    A sensitivity receipt says "it failed before and passes now", which is the
    same sentence whether the feature was missing or the TEST was. Ruled: the
    gate must pre-date the change it judges, established structurally — from
    git's own untracked list, never by reading the failure message or parsing
    the command, both of which are the classification SPEC_VACUITY §4b
    refuses.
    """
    write_spec(repo)
    (repo / "reports.py").write_text("def to_csv():\n    return 'x'\n", "utf-8")
    bound_config(repo, command="python3 -m unittest check_export.Case.test_it -v")
    commit(repo)

    # The change brings its OWN acceptance test with it — the shape measured.
    (repo / "check_export.py").write_text(
        "import unittest\n\n\nclass Case(unittest.TestCase):\n"
        "    def test_it(self):\n        self.assertTrue(True)\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["verify", "--prove"]) == cli.EXIT_OK
    capsys.readouterr()

    row = artifact(repo)["criteria"][0]
    assert row["state"] == accept.UNEVIDENCED, row
    assert row["refuses"] is True, "the seam that let this through must refuse"
    assert "check_export" in row["reason"], row["reason"]
    assert "CREATED" in row["reason"]


def test_a_receipt_whose_pre_dating_cannot_be_established_is_not_a_pass(repo):
    """Un-establishable is unevidenced, never a pass — the vacuity precedent
    applied to this artifact itself.

    `assess` called without git state cannot ask whether the gate pre-dates
    the change, and the conservative answer is the only safe one: a caller
    that offers no state gets no sensitivity receipts counted. Asserted
    directly on the seam, because no shipped caller takes that path — and a
    default that only a future caller can hit is exactly the kind that is
    wrong for a year before anyone notices.
    """
    assert accept.created_stems(None) is None
    # A real state answers the question; the answer can be "nothing created".
    class _State:
        untracked = ()
    assert accept.created_stems(_State()) == frozenset()


def test_an_edited_gate_command_resets_the_evidence(repo, monkeypatch, capsys):
    """Identity is `(id, command)` — health ruling 2, applied to this join.
    Editing a gate is HOW checks narrow, so the old command's red history
    cannot evidence the new command's criterion."""
    write_spec(repo)
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    bound_config(repo, command="grep -q FIXED calc.py")
    monkeypatch.chdir(repo)

    cli.main(["verify"])          # red, recorded
    (repo / "calc.py").write_text("FIXED\n", encoding="utf-8")
    cli.main(["verify"])          # green, evidenced
    capsys.readouterr()
    assert state_of(repo, "csv-downloads") == accept.EVIDENCED

    # Same gate id, different command: a different check, and its history is
    # empty — the red above says nothing about THIS one.
    bound_config(repo, command="grep -q FIXED  calc.py")
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()
    assert state_of(repo, "csv-downloads") == accept.UNEVIDENCED


def test_a_human_criterion_is_answered_by_people(repo, monkeypatch, capsys):
    """It counts toward neither evidenced nor unevidenced, and a REQUIRED one
    that nobody has answered now REFUSES.

    **CORRECTED 2026-08-17, OQ-1** (SPEC_REFUSAL §3 ruling 1 and ruling 6's
    first named sentence). This test used to assert `refuses is False` and its
    docstring said *"it never refuses: a person's judgement is not a gate's to
    hold hostage"*. The first half was the policy and it is reversed; the
    second half was always a non-sequitur, because the refusal is not a gate
    holding a judgement hostage — it is the record declining to call a
    requirement satisfied that NOBODY has said is satisfied.

    What is unchanged, and is the part worth keeping: nothing scores it, the
    state stays `human` and never becomes `evidenced`, and the only thing that
    clears it is a person writing `wringer.judgements.yaml` by hand.
    """
    write_spec(repo, extra=HUMAN_CRITERION)
    write_config(repo, '  - id: t\n    run: "true"\n')
    monkeypatch.chdir(repo)

    cli.main(["verify"])
    capsys.readouterr()

    rows = {row["criterion"]: row for row in artifact(repo)["criteria"]}
    human = rows["copy-reads-well"]
    assert human["state"] == accept.HUMAN
    assert human["refuses"] is True
    assert human["cause"] == accept.CAUSE_HUMAN_UNANSWERED
    assert artifact(repo)["counts"]["human"] == 1


def test_a_gate_that_did_not_run_is_absence_not_a_pass(repo, monkeypatch, capsys):
    """Absence of a result is absence, never a pass-through to an older
    green. A criterion whose gate was skipped this run is not evidenced by
    the fact that it was evidenced last week."""
    write_spec(repo)
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    write_config(
        repo,
        '  - id: first\n    run: "false"\n'
        '  - id: csv\n    run: "grep -q FIXED calc.py"\n    proves: csv-downloads\n',
    )
    monkeypatch.chdir(repo)

    # `first` fails, so `csv` never runs and leaves no result.
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    row = artifact(repo)["criteria"][0]
    assert row["state"] == accept.GATE_DID_NOT_RUN, row
    assert row["refuses"] is True


# --- receipts that must not launder a criterion ----------------------------


def test_an_exit_127_row_is_not_a_discrimination_receipt(repo, monkeypatch, capsys):
    """A missing binary proves only that PATH was wrong. Counting it would
    let a typo evidence a criterion — the same laundering health ruling 7
    refuses, at the moment the acceptance claim is made."""
    write_spec(repo)
    monkeypatch.chdir(repo)

    # A run whose gate died at 127, recorded under the pair the criterion
    # will bind to.
    bound_config(repo, command="wringer-no-such-binary")
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    # Now the same command "passes" — planted directly, because the point is
    # what the HISTORY may serve as a receipt.
    planted = repo / evidence.RUNS_DIRNAME / "20260101-000000-aaaa"
    _plant_run(planted, "csv", "wringer-no-such-binary", status="failed",
               exit_code=127)

    bound_config(repo, command="true")
    write_config(
        repo, '  - id: csv\n    run: "true"\n    proves: csv-downloads\n'
    )
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()
    assert state_of(repo, "csv-downloads") == accept.UNEVIDENCED


def _plant_run(directory: Path, gate_id: str, command: str, *, status: str,
               exit_code: int) -> None:
    """A bundle in the shape `verify.run` writes one, planted so a test can
    say what the RECORD holds rather than arranging for it to happen."""
    directory.mkdir(parents=True, exist_ok=True)
    (directory / evidence.MANIFEST_FILENAME).write_text(
        json.dumps({
            "schema_version": evidence.SCHEMA_VERSION,
            "run_id": directory.name,
            "started_at": "2026-01-01T00:00:00+00:00",
            "repo": {"root": ".", "head_sha": "0" * 40, "branch": "main",
                     "dirty": False},
            "result": {"status": status, "failed_gate": gate_id},
        }),
        encoding="utf-8",
    )
    gate_dir = directory / "gates" / f"001_{gate_id}"
    gate_dir.mkdir(parents=True, exist_ok=True)
    (gate_dir / "result.json").write_text(
        json.dumps({
            "gate_id": gate_id, "command": command, "exit_code": exit_code,
            "duration_ms": 1, "timed_out": False, "stdout_truncated": False,
            "stderr_truncated": False, "optional": False, "status": status,
        }),
        encoding="utf-8",
    )


def test_a_bench_sourced_red_row_is_not_a_discrimination_receipt(
    repo, monkeypatch, capsys
):
    """`wring bench` refuses to start unless the baseline is RED, so every
    bench guarantees a failed row for every required gate on a tree nobody
    changed. Health ruling 9 keeps those out of verdicts; the same rule keeps
    them from evidencing a criterion."""
    write_spec(repo)
    bound_config(repo, command="true")
    monkeypatch.chdir(repo)

    # A red row for the pair, but inside a bench worktree.
    _plant_run(
        repo / ".wringer" / "worktrees" / "20260101-000000-bbbb-baseline"
        / ".wringer" / "runs" / "20260101-000000-cccc",
        "csv", "true", status="failed", exit_code=1,
    )

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()
    assert state_of(repo, "csv-downloads") == accept.UNEVIDENCED


def test_a_sensitive_vacuity_row_evidences_and_carries_its_citation(
    repo, monkeypatch, capsys
):
    """The second receipt kind. It also carries `cites` verbatim, because a
    sensitivity receipt inherits vacuity's blind spot (limit 4) — a gate
    whose own command arrived with the change reads sensitive for that reason
    alone, and the citation beside it is how a reader tells."""
    write_spec(repo)
    # The repo as it stood, in HEAD — then the change on top of it.
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    bound_config(repo, command="grep -q FIXED calc.py")
    commit(repo)
    (repo / "calc.py").write_text("FIXED\n", encoding="utf-8")
    monkeypatch.chdir(repo)

    assert cli.main(["verify", "--prove"]) == cli.EXIT_OK
    capsys.readouterr()

    row = artifact(repo)["criteria"][0]
    assert row["state"] == accept.EVIDENCED, row
    assert row["receipt"]["kind"] == "sensitive"
    assert row["receipt"]["cites"], "a sensitivity receipt with no citation"


def test_a_sensitive_receipt_discloses_an_unverified_pre_change_environment(
    repo, monkeypatch, capsys
):
    """RULED 2026-08-11: disclose, do not refuse.

    A prove worktree carries TRACKED FILES ONLY, so in a repo whose
    dependencies are gitignored every pre-change gate fails for that reason
    and every criterion collects a receipt that means nothing
    (SPEC_VACUITY_V0 §5a). Refusing on an absent `run.prove_setup` was the
    obvious answer and is the wrong one: it would have refused the first real
    agent measurement this program ever took, whose gates are stdlib, need no
    setup, and whose receipts were true. So the row says what it did not
    check.

    In `reason` rather than in a key of its own, and that is not a detail:
    `acceptance.json` is frozen (law 7), and a new key — even an optional
    advisory one — is a silent break for every reader of a bundle already on
    disk. `test_no_schema_frozen_at_v0_2_0_has_changed_a_byte` catches the
    other choice, and caught it here.
    """
    write_spec(repo)
    # The repo as it stood, in HEAD — then the change on top of it.
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    bound_config(repo, command="grep -q FIXED calc.py")
    commit(repo)
    (repo / "calc.py").write_text("FIXED\n", encoding="utf-8")
    monkeypatch.chdir(repo)

    assert cli.main(["verify", "--prove"]) == cli.EXIT_OK
    capsys.readouterr()

    row = artifact(repo)["criteria"][0]
    # Counted, per the ruling — the disclosure is not a downgrade.
    assert row["state"] == accept.EVIDENCED
    assert row["refuses"] is False
    assert "prove_setup" in row["reason"], row["reason"]
    assert "unverified" in row["reason"]
    # And the frozen shape is untouched: no new key on the receipt.
    assert set(row["receipt"]) <= {"kind", "bundle", "cites"}, row["receipt"]


def test_a_declared_prove_setup_needs_no_disclosure(repo, monkeypatch, capsys):
    """The other half, or the sentence would be unfalsifiable boilerplate that
    appears on every row whatever the repo did."""
    write_spec(repo)
    # The repo as it stood, in HEAD — then the change on top of it.
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    bound_config(repo, command="grep -q FIXED calc.py")
    commit(repo)
    (repo / "calc.py").write_text("FIXED\n", encoding="utf-8")
    config_path = repo / ".wringer.yaml"
    # `prove_setup` lives under `run:`, and `run:` needs a worker — the loop
    # never runs here, but the section is parsed strictly either way.
    with config_path.open("a", encoding="utf-8") as handle:
        handle.write('run:\n  worker: "true"\n  prove_setup: "true"\n')
    monkeypatch.chdir(repo)

    assert cli.main(["verify", "--prove"]) == cli.EXIT_OK
    capsys.readouterr()

    row = artifact(repo)["criteria"][0]
    assert row["state"] == accept.EVIDENCED
    assert "prove_setup" not in row["reason"], row["reason"]


# --- the artifact itself ---------------------------------------------------


def test_the_artifact_is_covered_by_the_bundles_digests(repo, monkeypatch, capsys):
    """Written BEFORE `digests.json`, so the bundle's own tamper-evidence
    covers it rather than it sitting beside them."""
    write_spec(repo)
    bound_config(repo)
    monkeypatch.chdir(repo)

    cli.main(["verify"])
    capsys.readouterr()

    run = evidence.latest_run(repo / evidence.RUNS_DIRNAME)
    digests = json.loads((run / "digests.json").read_text(encoding="utf-8"))
    assert accept.ACCEPTANCE_FILENAME in digests["files"], digests["files"]


def test_the_four_limits_travel_with_the_artifact(repo, monkeypatch, capsys):
    """Pinned by CONTENT. A `limits` array checked for non-emptiness passes
    against a single entry reading "none" — the release probe that printed
    "all thirteen present" while covering thirteen of seventeen is the same
    shape, and it shipped."""
    write_spec(repo)
    bound_config(repo)
    monkeypatch.chdir(repo)

    cli.main(["verify"])
    capsys.readouterr()

    limits = artifact(repo)["limits"]
    assert len(accept.LIMITS) == 4
    for limit in accept.LIMITS:
        assert limit in limits
    # Limit 4 is the one a reader most needs and least wants.
    assert any("command" in limit and "arrived with the change" in limit
               for limit in limits), limits


def test_counts_never_invent_a_zero(repo, monkeypatch, capsys):
    """Absence is absence. A count that renders 0 for "we did not look" is
    the invented number this repo keeps finding."""
    write_spec(repo)
    bound_config(repo)
    monkeypatch.chdir(repo)

    cli.main(["verify"])
    capsys.readouterr()

    counts = artifact(repo)["counts"]
    assert counts["evidenced"] == 0 and counts["unevidenced"] == 1
    assert set(counts) == {
        "evidenced", "unevidenced", "gate-failed", "gate-did-not-run", "human"
    }, counts


# --- a gate born green says so, where a person reads it (G2, ruling 3) ----


def summary_of(repo: Path) -> str:
    latest = evidence.latest_run(repo / evidence.RUNS_DIRNAME)
    return (latest / "summary.md").read_text(encoding="utf-8")


def test_a_bound_gate_green_on_its_first_run_is_called_out_in_the_summary(
    repo, monkeypatch, capsys
):
    """SPEC_GATEGEN ruling 3, said where the human is looking.

    A gate written for a criterion whose feature does not exist yet has one
    honest colour and it is not green. `acceptance.json` already records this
    as `unevidenced`, but the person who just applied a diff reads
    `summary.md`, and until now that document showed a green tick and said
    nothing.
    """
    write_spec(repo)
    bound_config(repo, command="true")
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    said = " ".join(summary_of(repo).split())
    assert "should be RED" in said
    assert "csv-downloads" in said
    assert "`csv`" in said
    assert "tests something else" in said


def test_a_bound_gate_with_a_receipt_is_not_called_out(
    repo, monkeypatch, capsys
):
    """The warning is about a gate nothing has ever seen fail. Once the
    record holds a real failure for it, the gate has demonstrated it can tell
    satisfied from unsatisfied and the note would be noise."""
    write_spec(repo)
    bound_config(repo, command="test -f built.txt")
    monkeypatch.chdir(repo)

    # red first — the criterion is unmet and the gate says so
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    (repo / "built.txt").write_text("built\n", encoding="utf-8")
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    said = " ".join(summary_of(repo).split())
    assert "should be RED" not in said


def test_an_unbound_criterion_is_not_called_out_as_born_green(
    repo, monkeypatch, capsys
):
    """Ruling 9: an unbound criterion is loud in `acceptance.json` and never
    fatal. It is not a gate born green — there is no gate — and putting it
    under this warning would tell a reader to go and look at a command that
    does not exist."""
    write_spec(repo)
    write_config(repo, '  - id: unrelated\n    run: "true"\n')
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    assert "should be RED" not in summary_of(repo)


# --- wringer.acceptance.v2: the witness lane --------------------------------


def witness_evidence(**overrides):
    fields = {
        "pinned_sha256": "a" * 64,
        "proved_red": "assertion",
        "result": "passed",
        "discarded": None,
        "bundle": ".wringer/runs/x",
    }
    fields.update(overrides)
    return accept.WitnessEvidence(**fields)


def test_a_run_with_no_witness_writes_v1_and_no_witness_key():
    """**The compatibility boundary.** Every repository in the world that
    never opted into the witness lane keeps writing exactly the bytes it wrote
    before the lane existed — and the ABSENCE of a v2 record is what tells a v1
    reader it may proceed."""
    result = accept.Result(rows=(
        accept.Row(criterion="c", title="t", required=True,
                   state=accept.EVIDENCED, gate_id="g", command="true"),
    ))
    payload = result.as_json()

    assert payload["schema_version"] == accept.SCHEMA_VERSION
    assert payload["limits"] == list(accept.LIMITS)
    assert "witness" not in payload["criteria"][0], (
        "a v1 row grew a key, which is a silent break for every existing "
        "reader — the rule this module states about itself"
    )


def test_a_run_with_a_witness_writes_v2():
    result = accept.Result(rows=(
        accept.Row(criterion="c", title="t", required=True,
                   state=accept.EVIDENCED, witness=witness_evidence()),
    ))
    payload = result.as_json()

    assert payload["schema_version"] == accept.SCHEMA_VERSION_V2
    assert payload["criteria"][0]["witness"]["proved_red"] == "assertion"
    # Q1's ceiling travels with the numbers.
    joined = " ".join(payload["limits"]).lower()
    assert "does not certify agreement" in joined


def test_a_witnessed_criterion_with_NO_GATE_can_refuse():
    """**This is the whole reason the version moved.** In v1 only a bound
    criterion could refuse, so `gate: null` implied `refuses: false` to every
    reader. A witness covers a criterion no gate binds, and it must be able to
    stop a delivery on the same terms."""
    row = accept.Row(
        criterion="c", title="t", required=True, state=accept.GATE_FAILED,
        gate_id=None, witness=witness_evidence(result="failed"),
    )
    assert row.covered
    assert row.refuses, (
        "a required criterion whose witness is still red does not refuse, so "
        "the lane is decorative"
    )


def test_a_DISCARDED_witness_covers_nothing_and_refuses_nothing():
    """A witness born green, or one the runner could not collect, evidences
    nothing in EITHER direction. The criterion is uncovered and goes to a
    human, which is honest and deliberately not a failure."""
    for discarded, proved in (
        ("born green", "green"), ("could not collect", "collection_error"),
    ):
        row = accept.Row(
            criterion="c", title="t", required=True, state=accept.UNEVIDENCED,
            gate_id=None,
            witness=witness_evidence(discarded=discarded, proved_red=proved,
                                     result="not_run"),
        )
        assert not row.covered, discarded
        assert not row.refuses, discarded


def test_a_red_witness_beats_a_PASSING_gate(repo, monkeypatch):
    """**The measured baseline this lane exists to break.**

    The corpus ran 13 real bug fixes: `--prove` returned `gates_vacuous` on
    13 of 13, and `wring deliver` said yes on 26 of 26 rows including every
    wrong change. The declared gates carried zero information about the change.

    So a design in which a green gate could overrule a red witness would
    reproduce exactly the result that disproved this programme's operating
    assumption. The witness wins.
    """
    write_spec(repo)
    write_config(repo, '  - id: vacuous\n    run: "true"\n')
    monkeypatch.chdir(repo)
    cfg = config.load(repo / ".wringer.yaml")

    assessed = accept.assess(
        repo, cfg, [],
        witnesses={"csv-downloads": witness_evidence(result="failed")},
    )
    row = assessed.rows[0]

    assert row.state == accept.GATE_FAILED
    assert row.refuses, "a red witness does not stop delivery"
    assert "still red" in row.reason


def test_a_green_witness_evidences_a_criterion_no_gate_binds(
    repo, monkeypatch
):
    """The other direction, and the receipt names where the evidence came
    from — so a reader is never left guessing whether a green came from the
    repository's own check or one Wringer manufactured."""
    write_spec(repo)
    write_config(repo, '  - id: vacuous\n    run: "true"\n')
    monkeypatch.chdir(repo)
    cfg = config.load(repo / ".wringer.yaml")

    assessed = accept.assess(
        repo, cfg, [],
        witnesses={"csv-downloads": witness_evidence(result="passed")},
    )
    row = assessed.rows[0]

    assert row.state == accept.EVIDENCED
    assert not row.refuses
    assert row.receipt is not None and row.receipt.kind == accept.WITNESS


def test_a_FAILING_gate_still_outranks_a_green_witness(repo, monkeypatch):
    """Rule 1 of the ordering: a failing gate wins over everything. The
    criterion is not met, and that is the ordinary honest state of work in
    progress — a witness passing does not paper over it."""
    write_spec(repo)
    write_config(
        repo, '  - id: g\n    run: "false"\n    proves: csv-downloads\n'
    )
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED

    row = artifact(repo)["criteria"][0]
    assert row["state"] == accept.GATE_FAILED, (
        "a failing gate must win: the criterion is not met, and a witness "
        "passing does not paper over work in progress"
    )


def test_the_state_vocabulary_gained_no_word():
    """**No new verdict vocabulary** is the ruling, and it is checked by value
    rather than trusted: delivery consumes the witness through the taxonomy
    this module already had."""
    assert accept.STATES == (
        "evidenced", "unevidenced", "gate-failed", "gate-did-not-run", "human"
    )
