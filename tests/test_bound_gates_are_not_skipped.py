"""**A bound gate's red is evidence, and fail-fast was throwing it away.**

Field report 2026-08-27 (run 6 re-run, main Mac), finding 1. The drive said to
the person's face "None of them passes today", naming
`skip-downstream-acceptance`. Minutes later the record refused delivery with
"`skip-downstream-acceptance` passed, but nothing in the record shows it can
fail — a gate born green evidences nothing." Both sentences were true, which
is the problem.

**Measured first, and the measurement is what chose this home.**

  1. `discriminating` receipts — the ones the `born-green` cause is the
     absence of — come from `accept._discriminating_pairs`, which reads
     `health.discover(root)`: the repository's own RUN BUNDLES, keyed by
     `(gate_id, command)`, counting a row where `genuine_failure` (a recorded
     `status: failed` that is not a timeout, not exit 127, not flaky) or where
     `vacuity.json` marked the row sensitive. Nothing else makes that fact.

  2. `skip-downstream-acceptance` had no pre-change red because the gate
     runner is FAIL-FAST: `acceptance` failed at iteration 1, `verify.run`
     broke out of the group loop, and the bundle for that iteration holds
     `001_lint`, `002_test`, `003_acceptance` and stops. The gate never ran
     inside a recorded run while it was red. The one place that DID see it red
     — the drive's `already_passing` trial — keeps only a boolean and writes
     no record at all.

So the fact was never made. The drive's trial is one optional path onto the
product; the starvation is a property of the engine, and reproduces with no
drive anywhere near it (`test_the_field_scenario_...` below is `wring verify`
twice). Fixing the trial would have left the engine defect intact and put
evidence-writing in a layer that consumes the engine rather than records for
it. So the fix is here: **a gate BOUND to a criterion is not skipped by
another gate's failure.**

**The born-green refusal is untouched and must stay.** It fired on the wrong
case; it is not wrong to exist. A bound gate that has never been seen to fail
by anyone still reads `born-green` — `test_a_gate_nobody_has_ever_seen_fail`
is that guard, and it is the one that would go red if this fix had been
written as "call it evidenced anyway".
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest
from core_helpers import reader_facing_pages, repo_root

from wringer import accept, cli, evidence

SPEC = """\
schema_version: wringer.spec.v1
approved: true
title: Two things must hold
intent: |
  Two separate facts have to be true before this ships.
tasks:
  - id: build
    brief: Make them both true
    objective: Both facts hold.
criteria:
  - id: a-holds
    title: A holds
    required: true
  - id: b-holds
    title: B holds
    required: true
"""

CONFIG = """\
version: 1

gates:
  - id: gate-a
    run: python3 acceptance/a.py
    timeout: 60
    proves: a-holds
  - id: gate-b
    run: python3 acceptance/b.py
    timeout: 60
    proves: b-holds
"""

CHECK = """\
import json, pathlib
state = json.loads(pathlib.Path("state.json").read_text())
assert state[{key!r}], state
print("ok")
"""


def _check(name: str) -> str:
    return CHECK.format(key=name)


@pytest.fixture
def two_gates(repo: Path) -> Path:
    """Gate A and gate B, both bound, both red on the tree as it stands.

    The field's shape exactly: `acceptance` red ahead of
    `skip-downstream-acceptance`, both newly installed, both proving a
    criterion, and a single worker turn about to fix both at once.
    """
    (repo / "acceptance").mkdir()
    (repo / "acceptance" / "a.py").write_text(_check("a"), encoding="utf-8")
    (repo / "acceptance" / "b.py").write_text(_check("b"), encoding="utf-8")
    (repo / "state.json").write_text('{"a": false, "b": false}\n', encoding="utf-8")
    (repo / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (repo / ".wringer.yaml").write_text(CONFIG, encoding="utf-8")
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-q", "-m", "the checks, before the work"],
        cwd=repo,
        check=True,
        capture_output=True,
    )
    return repo


def _runs(repo: Path) -> list[Path]:
    """Bundles in the order they were WRITTEN, never by id — the ids are
    `<date>-<HHMMSS>-<4 hex>` and do not sort chronologically."""
    return sorted(
        (repo / ".wringer" / "runs").iterdir(), key=lambda p: p.stat().st_mtime
    )


def _rows(run: Path) -> dict[str, dict]:
    record = json.loads(
        (run / accept.ACCEPTANCE_FILENAME).read_text(encoding="utf-8")
    )
    return {row.get("id") or row.get("criterion"): row for row in record["criteria"]}


def _did_work(repo: Path) -> None:
    repo.joinpath("state.json").write_text('{"a": true, "b": true}\n', "utf-8")


# --- the field scenario ------------------------------------------------------


def test_the_field_scenario_gate_A_red_no_longer_starves_gate_B(
    two_gates, monkeypatch
):
    """Gate A red, gate B behind it, one turn fixes both. B must be EVIDENCED.

    Before the fix B read `unevidenced` / `born-green` / `refuses: true`,
    because the only run in which it was red is the one it never ran in.
    """
    monkeypatch.chdir(two_gates)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED

    before = _runs(two_gates)[-1]
    ran = sorted(path.name.split("_", 1)[1] for path in (before / "gates").iterdir())
    assert ran == ["gate-a", "gate-b"], (
        "the pre-change run does not cover every bound gate, so gate-b's red "
        "is nowhere the record can find it"
    )

    _did_work(two_gates)
    assert cli.main(["verify"]) == cli.EXIT_OK

    rows = _rows(_runs(two_gates)[-1])
    assert rows["a-holds"]["state"] == "evidenced"
    assert rows["b-holds"]["state"] == "evidenced", (
        "gate-b passed and the record shows it can fail, but the criterion it "
        "proves is still unevidenced: " + rows["b-holds"]["reason"]
    )
    assert rows["b-holds"]["demonstrated_able_to_fail"] is True
    assert rows["b-holds"]["refuses"] is False


def test_the_run_still_STOPS_at_the_first_required_failure(two_gates, monkeypatch):
    """Fail-fast decides the OUTCOME. That has not moved.

    The exit code, the run's `status`, the `failed_gate` and the rerun hint
    are all still the first required failure's — a bound gate running for the
    record must not be able to change whose failure this run was.
    """
    monkeypatch.chdir(two_gates)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED

    bundle = _runs(two_gates)[-1]
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["result"]["status"] == "failed"
    assert manifest["result"]["failed_gate"] == "gate-a"
    summary = (bundle / "summary.md").read_text(encoding="utf-8")
    assert "wring verify --gate gate-a" in summary


def test_an_UNBOUND_gate_is_still_skipped_by_a_failure(repo, monkeypatch):
    """The cost is bounded by the bindings, and this is what bounds it.

    A gate with no `proves:` evidences no criterion, so running it after the
    run has already failed buys nothing and costs its whole runtime. It is
    still skipped, and the summary still says so.
    """
    (repo / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (repo / "acceptance").mkdir()
    (repo / "acceptance" / "a.py").write_text(_check("a"), encoding="utf-8")
    (repo / "state.json").write_text('{"a": false}\n', encoding="utf-8")
    (repo / ".wringer.yaml").write_text(
        "version: 1\n\ngates:\n"
        "  - id: gate-a\n    run: python3 acceptance/a.py\n    proves: a-holds\n"
        "  - id: after\n    run: 'echo ran > "
        + (repo / "after-ran.txt").as_posix()
        + "'\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED

    assert not (repo / "after-ran.txt").exists(), (
        "an unbound gate ran after the run had already failed — fail-fast is "
        "gone rather than narrowed, and every red run now pays for every gate"
    )
    summary = (_runs(repo)[-1] / "summary.md").read_text(encoding="utf-8")
    assert "| after | skipped |" in summary


def test_the_summary_says_a_bound_gate_ran_AFTER_the_run_had_failed(
    two_gates, monkeypatch
):
    """Two ✗ rows must not read as two independent things to go and fix.

    `summary.md` is what a person opens and what travels to a reviewer. The
    row that stopped the run and the row that ran only so its result would be
    on the record are different facts, and a table that rendered them
    identically would be the two-surfaces-one-fact drift this project keeps
    naming elsewhere.
    """
    monkeypatch.chdir(two_gates)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED

    summary = (_runs(two_gates)[-1] / "summary.md").read_text(encoding="utf-8")
    assert "for the record" in summary, summary
    line = next(line for line in summary.splitlines() if line.startswith("| gate-b "))
    assert "for the record" in line, line
    stopper = next(
        line for line in summary.splitlines() if line.startswith("| gate-a ")
    )
    assert "for the record" not in stopper, stopper


# --- the refusal this fix must NOT weaken ------------------------------------


def test_a_gate_nobody_has_ever_seen_fail_is_STILL_born_green(repo, monkeypatch):
    """The constraint, guarded.

    The born-green refusal fired on the wrong case. It is not wrong to exist:
    a bound gate that is green on its first recorded run and has never been
    recorded failing evidences nothing, and this fix does not buy it a pass.
    """
    (repo / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (repo / ".wringer.yaml").write_text(
        "version: 1\n\ngates:\n"
        "  - id: gate-a\n    run: 'true'\n    proves: a-holds\n"
        "  - id: gate-b\n    run: 'true'\n    proves: b-holds\n",
        encoding="utf-8",
    )
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-q", "-m", "green from birth"],
        cwd=repo,
        check=True,
        capture_output=True,
    )
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK

    rows = _rows(_runs(repo)[-1])
    for identifier in ("a-holds", "b-holds"):
        assert rows[identifier]["state"] == "unevidenced"
        assert rows[identifier]["cause"] == accept.CAUSE_BORN_GREEN
        assert rows[identifier]["demonstrated_able_to_fail"] is False


def test_a_bound_gate_that_PASSES_after_the_failure_evidences_nothing(
    two_gates, monkeypatch
):
    """Running it for the record is not the same as recording a red.

    Gate B is green from the start here; gate A fails. B runs — and the record
    that comes back says exactly what it saw, which is a pass. The criterion
    stays born-green.
    """
    (two_gates / "state.json").write_text('{"a": false, "b": true}\n', "utf-8")
    subprocess.run(
        ["git", "commit", "-qam", "b was true all along"],
        cwd=two_gates,
        check=True,
        capture_output=True,
    )
    monkeypatch.chdir(two_gates)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED

    bundle = _runs(two_gates)[-1]
    result = json.loads(
        next((bundle / "gates").glob("*_gate-b")).joinpath("result.json")
        .read_text(encoding="utf-8")
    )
    assert result["status"] == "passed"

    two_gates.joinpath("state.json").write_text('{"a": true, "b": true}\n', "utf-8")
    assert cli.main(["verify"]) == cli.EXIT_OK
    rows = _rows(_runs(two_gates)[-1])
    assert rows["b-holds"]["cause"] == accept.CAUSE_BORN_GREEN
    assert rows["a-holds"]["state"] == "evidenced"


# --- the pages that taught the old rule --------------------------------------

# `the` is optional because SPEC_VERIFY's binding rule 2 is written without
# it — and that rule is the most load-bearing statement of the lot.
_STOPS = re.compile(r"stops? (?:at|on) (?:the )?first\s+required failure", re.I)
# **The correction itself, verbatim — not a marker that one happened.**
#
# Two earlier versions of this guard were green for the wrong reason, and
# reverting each amendment individually is what found both.
#
#   1. `proves:` or "bound gate" near the claim. `proves:` is ordinary
#      vocabulary on every page that discusses bindings at all, so the guard
#      was reading the subject matter and calling it a correction. It passed
#      with all five amendments removed.
#   2. A dated `FIXED|AMENDED … 20xx-xx-xx` near the claim. Two of these pages
#      already carry `AMENDED 2026-08-11` — about a different fact, in the same
#      paragraph — so it passed there with the amendment removed.
#
# So the guard asks for the SENTENCE. One wording, on every page that states
# the rule, which is also the only way a reader meets the exception in the
# same breath as the rule it qualifies.
_EXEMPTION = "a gate carrying `proves:` is no longer skipped by another gate's failure"
# Wide, and it can afford to be now: the marker is a whole clause somebody had
# to write about this fact, not vocabulary a page uses in passing. It has to
# reach — on two of these pages the rule is stated at the top of a paragraph
# and the amendment is a paragraph below it.
_WINDOW = 1500


def _flat(text: str) -> str:
    """Collapse whitespace before matching, and drop blockquote markers.

    These pages are hard-wrapped, so the clause straddles a line break on most
    of them, and asserting on where a page happens to wrap is asserting about
    the wrapping. The `>` mattered too and cost a false red: two of the
    amendments are blockquotes, and a naive collapse turned every continuation
    line into `... a gate > carrying \\`proves:\\` ...`.
    """
    return " ".join(
        re.sub(r"(?m)^\s*>\s?", "", text).split()
    ).lower()


def test_no_live_page_still_teaches_the_starvation_as_a_RULE():
    """The claim shipped on six pages, and it is what a reader would act on.

    `wring verify` stopping at the first required failure is still true of the
    OUTCOME and no longer true of bound gates, so a page that states it flat
    is teaching a limit the product does not have — and one of them
    (`fleet-scale.md` §3a) filed it under "what it still cannot do".

    Captures are exempt by `reader_facing_pages(captures=False)`, which is the
    shipped distinction and not a list written here: a dated record is allowed,
    and required, to say what was true when it was taken. Two pages that are
    captures in substance but carry no dated name — `first-contact.md` and
    `fleet-scale.md` — are held to this instead, so they carry the amendment
    where the claim is, and stay under every other guard that discovers them.
    """
    unqualified: list[str] = []
    for path in reader_facing_pages(captures=False):
        text = path.read_text(encoding="utf-8")
        for match in _STOPS.finditer(text):
            near = text[max(0, match.start() - _WINDOW) : match.end() + _WINDOW]
            if _flat(_EXEMPTION) not in _flat(near):
                unqualified.append(
                    f"{path.relative_to(repo_root()).as_posix()}:"
                    f"{text[: match.start()].count(chr(10)) + 1}"
                )
    assert not unqualified, (
        f"these pages state the fail-fast rule without {_EXEMPTION!r} near it "
        "— the starvation of field report 2026-08-27 finding 1, taught as "
        f"current behaviour: {unqualified}"
    )


# --- the loop, which is where the field hit it -------------------------------


def test_the_LOOPS_first_lap_records_every_bound_gates_red(two_gates, monkeypatch):
    """The field's exact shape: one worker turn fixes both, and it converges.

    Before the fix this loop converged with `b-holds` born-green and
    `refuses: true`, so a delivery was refused for the absence of a red that
    the run had been in a position to record and did not.
    """
    (two_gates / ".wringer.yaml").write_text(
        two_gates.joinpath(".wringer.yaml").read_text(encoding="utf-8")
        + '\nrun:\n  max_iterations: 2\n  worker: "printf \'{\\"a\\": true, '
        '\\"b\\": true}\' > state.json"\n',
        encoding="utf-8",
    )
    monkeypatch.chdir(two_gates)
    assert cli.main(["run"]) == cli.EXIT_OK

    final = evidence.latest_run(two_gates / evidence.RUNS_DIRNAME)
    assert final is not None
    rows = _rows(final)
    assert rows["b-holds"]["state"] == "evidenced", rows["b-holds"]["reason"]
    assert rows["b-holds"]["refuses"] is False
