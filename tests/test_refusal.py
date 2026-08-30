"""The delivery refusals get names — docs/specs/SPEC_REFUSAL_V0.md §4, slice R1.

`deliver.py` refuses in 23 places and every one of them was prose plus an exit
code. A surface downstream that wanted to know *which* refusal happened had to
match English against `deliver.py`'s wording, and a reworded sentence would
silently re-label whatever it rendered.

R1 gives each refusal a name, requires the name at the constructor, and writes
one record per refused attempt. **It changes no refusal.** Nothing here adds
one, removes one, moves one, softens one or changes an exit code, and the two
tests that would catch an attempt are `test_a_delivery_still_refuses_when_the_
record_cannot_be_written` and `test_a_refused_delivery_does_not_become_an_
attestation_anchor` — the second because the drafted design put the record
beside the delivery, which would have invented a refusal in `wring attest`
while touching nothing in `deliver.py`.

**The site guard parses with `ast` and a text scan is forbidden** (§4 ruling
7). Only two of the 23 raises fit on one line, so a same-line check finds
`reason=` on neither of the other 21; and a scan forward to the closing paren
is defeated by the literal `)` inside `deliver.py:191`'s message. The
constructor requirement and this guard are not redundant in either direction:
a required argument catches an omission only on a path something executes, and
most of the 23 sites are on no tested path at all.
"""

from __future__ import annotations

import json
from pathlib import Path

from core_helpers import flat

# The delivery fixture and the graph one, imported rather than copied: a
# second copy of `delivery_repo` would drift from the first the day either
# moves, and these tests are about what happens INSIDE a real refusal.
from test_deliver import CONFIG, delivery_repo, git, verified  # noqa: F401
from test_graph_deliver import (  # noqa: F401
    FORGERY,
    PAUSED,
    decision,
    only_graph,
    setup,
)

from wringer import cli, deliver, evidence


def refusal_records(root: Path) -> list[Path]:
    """Every `refusal.json` written under `.wringer/refusals/`."""
    directory = root / deliver.REFUSALS_DIRNAME
    if not directory.is_dir():
        return []
    return sorted(directory.glob(f"*/{deliver.REFUSAL_FILENAME}"))


def only_record(root: Path) -> dict:
    found = refusal_records(root)
    assert len(found) == 1, found
    return json.loads(found[0].read_text(encoding="utf-8"))


SPEC_FOR_ACCEPTANCE = """\
schema_version: wringer.spec.v1
approved: true
title: Something is asked for
intent: So that an acceptance record exists to damage.
tasks:
  - id: build
    brief: Build it
    objective: It works.
criteria:
  - id: it-works
    title: It works
    required: true
"""


def _approve_a_spec(repo: Path) -> None:
    """An approved spec, which is what makes `verify` write `acceptance.json`
    at all. The criterion is UNBOUND, so it refuses nothing — the record's
    mere existence is the subject here, not its verdict."""
    (repo / "wringer.spec.yaml").write_text(
        SPEC_FOR_ACCEPTANCE, encoding="utf-8"
    )


def test_an_unreadable_acceptance_record_REFUSES_rather_than_delivering(
    delivery_repo, monkeypatch, capsys
):
    """**D2, and it is the interlock the product's central claim rests on.**

    `accept.read` collapsed three causes into one `None`: no approved spec (a
    genuine opt-out), the file absent (the same), and the file PRESENT BUT
    TRUNCATED — disk full mid-write, a SIGKILL, a partial CI artifact restore.
    `_refuse_unevidenced_acceptance` returned on `None`, so a bundle that had
    RECORDED `refuses: true` rows delivered with no refusal and no word.

    Twenty lines over, `_check_untracked_bytes` already refuses on an
    unreadable record and says why: "an unanswerable check refuses rather
    than passes". One file, two policies, and the fail-open one guarded the
    claim.
    """
    repo = delivery_repo
    _approve_a_spec(repo)
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    run_dir = evidence.latest_run(repo / evidence.RUNS_DIRNAME)
    assert run_dir is not None
    written = run_dir / evidence.ACCEPTANCE_FILENAME
    assert written.is_file(), "the fixture records no acceptance at all"
    # Truncated, not deleted: absent is an opt-out and stays one.
    written.write_text(
        written.read_text(encoding="utf-8")[:20], encoding="utf-8"
    )

    assert cli.main(["deliver"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    assert only_record(repo)["reason"] == "acceptance_record_unreadable"


def test_an_unreadable_vacuity_record_REFUSES_rather_than_delivering(
    delivery_repo, monkeypatch, capsys
):
    """The same shape, one refusal over.

    `vacuity.read_verdict` returned `None` both for "this repo never opted
    in" and for "the file that says GATES_VACUOUS is damaged", and
    `_check_not_vacuous` returned on `None`. A run that MEASURED the tautology
    delivered if one byte of its record was damaged.
    """
    from wringer import vacuity

    repo = delivery_repo
    monkeypatch.chdir(repo)
    assert cli.main(["verify", "--prove"]) == cli.EXIT_OK
    capsys.readouterr()

    run_dir = evidence.latest_run(repo / evidence.RUNS_DIRNAME)
    assert run_dir is not None
    written = run_dir / vacuity.VACUITY_FILENAME
    assert written.is_file(), "the fixture proved nothing, so there is no record"
    written.write_text("{ not json", encoding="utf-8")

    assert cli.main(["deliver"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    assert only_record(repo)["reason"] == "vacuity_record_unreadable"


def test_an_ABSENT_record_is_still_an_opt_out(
    delivery_repo, monkeypatch, capsys
):
    """The other half of the boundary, and the reason this is three-valued
    rather than two. Absent is a fact about configuration and opts out;
    unreadable is an instrument failure and never wears a favourable verdict.
    Refusing on absence would refuse every repo that never heard of the
    feature."""
    from wringer import vacuity

    repo = delivery_repo
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    run_dir = evidence.latest_run(repo / evidence.RUNS_DIRNAME)
    assert run_dir is not None
    for name in (evidence.ACCEPTANCE_FILENAME, vacuity.VACUITY_FILENAME):
        if (run_dir / name).exists():
            (run_dir / name).unlink()

    assert cli.main(["deliver"]) == cli.EXIT_OK, capsys.readouterr().err
    capsys.readouterr()
    assert not refusal_records(repo)


# --- D0: the four reasons no test had ever taken ---------------------------
#
# Found by the session-wide recorder in `tests/conftest.py`, which is the
# guard that replaced two lexical ones. Each of these was declared, rendered
# by the board, described in SPEC_REFUSAL's table, and constructed by nothing.


def test_tracked_contents_differ_is_REACHED_by_editing_a_verified_file(
    delivery_repo, monkeypatch, capsys
):
    """**The tracked-diff byte check, driven through `deliver` at last.**

    This is the product's core promise: a run's gate results may only be
    attached to the code that run saw. `if False and before.strip() !=
    after.strip():` deleted the whole check and 199 tests across
    `test_deliver`, `test_refusal`, `test_graph_deliver`, `test_attempts` and
    `test_untracked` still passed. `test_refusal.py` records that someone once
    aimed at this refusal, got `untracked_file_moved` instead, and nobody went
    back for it.

    The shape it exists for: the FILE LIST is identical, so `tree_moved`
    cannot fire — only the bytes moved, which is the commonest way a tree
    moves without its shape moving.
    """
    repo = delivery_repo
    tracked = repo / "tracked.py"
    tracked.write_text("def one():\n    return 1\n", encoding="utf-8")
    git(repo, "add", "-A")
    git(repo, "commit", "-m", "a tracked file to move")
    tracked.write_text("def one():\n    return 2\n", encoding="utf-8")

    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    # Same file list, different bytes.
    tracked.write_text("def one():\n    return 3\n", encoding="utf-8")

    assert cli.main(["deliver"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    assert only_record(repo)["reason"] == "tracked_contents_differ"


def test_untracked_record_unreadable_is_REACHED(
    delivery_repo, monkeypatch, capsys
):
    """Its two neighbours execute — `untracked_record_unknown_version` and
    `files_unreadable_at_verify` — so the fixture reached this function and
    stopped one branch short. Untracked bytes are the one class git cannot
    catch downstream."""
    repo = delivery_repo
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    run_dir = evidence.latest_run(repo / evidence.RUNS_DIRNAME)
    assert run_dir is not None
    recorded = run_dir / evidence.UNTRACKED_FILENAME
    assert recorded.is_file(), "the fixture recorded no untracked files"
    recorded.write_text("{ not json", encoding="utf-8")

    assert cli.main(["deliver"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    assert only_record(repo)["reason"] == "untracked_record_unreadable"


def test_branch_is_current_is_REACHED(delivery_repo, monkeypatch, capsys):
    """Wringer commits to a branch it created, never the one you are on."""
    repo = delivery_repo
    (repo / ".wringer.yaml").write_text(
        CONFIG.replace('branch: "wringer/{run}"', 'branch: "work"'),
        encoding="utf-8",
    )
    git(repo, "checkout", "-q", "-b", "work")
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    assert cli.main(["deliver"]) == cli.EXIT_REFUSED
    capsys.readouterr()
    assert only_record(repo)["reason"] == "branch_is_current"


def test_remote_unreachable_is_REACHED(delivery_repo, monkeypatch, capsys):
    """**Named, and its own fixture had never taken it.**

    `test_deliver.py:1750` asserts `"cannot" in str(...)` over a fixture whose
    origin does not exist — but `resolve_base` refuses first with
    `default_branch_unknown` ("...cannot be sure it is avoiding it"), so the
    reason actually raised was that one and editing this refusal away left
    the test green.

    The distinction it protects: `ls-remote` failing used to fall through to
    "the branch does not exist", so an unreachable remote silently satisfied
    condition 1 and delivery planned a branch that might already be someone
    else's. So the remote here is reachable enough to RESOLVE a default
    branch, and unreachable by the time `branch_exists` looks.
    """
    repo = delivery_repo
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    # The default branch is already cached in `refs/remotes/origin/HEAD`, so
    # `resolve_base` answers without the network; `ls-remote` does not.
    git(repo, "remote", "set-head", "origin", "-a")
    upstream = repo.parent / f"{repo.name}-upstream.git"
    upstream.rename(repo.parent / f"{repo.name}-upstream.gone")

    assert cli.main(["deliver"]) == cli.EXIT_REFUSED
    capsys.readouterr()
    assert only_record(repo)["reason"] == "remote_unreachable"


def test_a_refused_delivery_writes_a_record_naming_the_reason(
    delivery_repo, monkeypatch, capsys
):
    """The refusal `tests/test_deliver.py` already pins — its gates did not
    pass — driven for real, and now legible to something that is not a human
    reading English."""
    (delivery_repo / ".wringer.yaml").write_text(
        CONFIG.replace('run: "true"', 'run: "false"'), encoding="utf-8"
    )
    monkeypatch.chdir(delivery_repo)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    run_dir = sorted((delivery_repo / evidence.RUNS_DIRNAME).iterdir())[-1]

    assert cli.main(["deliver"]) == cli.EXIT_GATE_FAILED
    printed = capsys.readouterr()

    record = only_record(delivery_repo)
    assert record["schema_version"] == deliver.REFUSAL_SCHEMA_VERSION
    assert record["reason"] == "gates_did_not_pass"
    assert record["exit_code"] == cli.EXIT_GATE_FAILED
    # The prose is KEPT, not replaced: a name is for machines, and the
    # sentence is what tells a person what to do.
    assert "its gates did not pass" in flat(record["message"])
    assert record["run"] == run_dir.name
    assert record["at"]

    # And the console said exactly what it said before the slice.
    assert "gates did not pass" in flat(printed.err)
    assert "refusal.json" not in printed.out + printed.err


def test_a_refused_graph_deliver_node_writes_a_record_too(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """§4 ruling 8: one choke point per ENTRY PATH. A graph's deliver node
    refuses through `graph.py:1807`, not through `cli.py:3279`, so a record
    written at only one of them would record half the refusals."""
    setup(repo, git_run, tmp_path_factory, worker_fixes=False, body=PAUSED)
    monkeypatch.chdir(repo)
    assert cli.main(["graph", "run", "graph.yaml"]) == cli.EXIT_NEEDS_HUMAN
    directory = only_graph(repo)
    capsys.readouterr()
    decision(directory).write_text(FORGERY, encoding="utf-8")

    assert cli.main(["graph", "resume", str(directory)]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    record = only_record(repo)
    assert record["reason"] == "gates_did_not_pass"
    assert record["exit_code"] == cli.EXIT_GATE_FAILED


def test_the_record_is_never_written_under_the_deliveries_directory(
    delivery_repo, monkeypatch, capsys
):
    """§4 ruling 8, the location half — and the assertion at
    `tests/test_deliver.py:316` that a record beside the delivery would
    reverse. No delivery directory exists at ANY of the 23 refusals: every
    `raise Refused(` is inside `plan()`, and `Bundle.create` runs strictly
    after `plan()` returns."""
    (delivery_repo / ".wringer.yaml").write_text(
        CONFIG.replace('run: "true"', 'run: "false"'), encoding="utf-8"
    )
    monkeypatch.chdir(delivery_repo)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    assert cli.main(["deliver"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    assert refusal_records(delivery_repo), "no record was written at all"
    assert not (delivery_repo / deliver.DELIVERIES_DIRNAME).exists(), (
        "a refused delivery created .wringer/deliveries/ — which is the "
        "attestation anchor, so every refused delivery would disable "
        "`wring attest` until the next successful one"
    )


def test_a_refused_delivery_does_not_become_an_attestation_anchor(
    delivery_repo, monkeypatch, capsys
):
    """The trap, CONSTRUCTED and OBSERVED rather than reasoned about (§4
    ruling 8; §12's second unreached item).

    `attest.latest_anchor` takes the newest entry under `.wringer/deliveries/`
    as the anchor. A refusal-only entry there has no `manifest.json`, so
    `attest.build` falls through to the run-dir branch and refuses with "is
    not a Wringer bundle". This test drives a real refusal and then a real
    `wring attest`, and the second half — the anchor moved BY HAND — shows the
    breakage this location choice avoids, so the choice is evidence rather
    than an assertion.
    """
    monkeypatch.chdir(delivery_repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()
    # `wring attest` works before anything is refused.
    assert cli.main(["attest"]) == cli.EXIT_OK
    capsys.readouterr()

    # Now refuse a delivery for real: the tree moved since the gates ran.
    # `feature.py` is UNTRACKED in this fixture, so the refusal is the
    # untracked-bytes one — git never saw the file, so nothing else would have
    # caught the edit. The record says which, which is the entire slice: this
    # assertion was written expecting `tracked_contents_differ` and the record
    # corrected it, without anyone reading the prose.
    (delivery_repo / "feature.py").write_text(
        "def added():\n    return 2\n", encoding="utf-8"
    )
    assert cli.main(["deliver"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    assert only_record(delivery_repo)["reason"] == "untracked_file_moved"

    # The anchor is untouched, so attestation still works.
    assert cli.main(["attest"]) == cli.EXIT_OK, "a refusal poisoned the anchor"
    capsys.readouterr()

    # And this is what the rejected location would have done. Nothing in
    # deliver.py would have changed; `wring attest` would simply stop.
    anchor = delivery_repo / deliver.DELIVERIES_DIRNAME / "20260816-000000-dead"
    anchor.mkdir(parents=True)
    (anchor / deliver.REFUSAL_FILENAME).write_text("{}", encoding="utf-8")
    assert cli.main(["attest"]) == cli.EXIT_GATE_FAILED
    assert "is not a Wringer bundle" in flat(capsys.readouterr().err)


def test_a_delivery_still_refuses_when_the_record_cannot_be_written(
    delivery_repo, monkeypatch, capsys
):
    """**Nothing about this feature may convert a refusal into a success**
    (§4 ruling 8). The refusal still happens, with the same exit code and the
    same message, and the failure to write is PRINTED rather than swallowed.

    The unwritable path is a plain file where the directory must go, not a
    chmod: `chmod 000` is not unwritable for root, and this suite runs in
    containers that are.
    """
    (delivery_repo / ".wringer.yaml").write_text(
        CONFIG.replace('run: "true"', 'run: "false"'), encoding="utf-8"
    )
    monkeypatch.chdir(delivery_repo)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    blocked = delivery_repo / deliver.REFUSALS_DIRNAME
    blocked.parent.mkdir(parents=True, exist_ok=True)
    blocked.write_text("not a directory\n", encoding="utf-8")

    assert cli.main(["deliver"]) == cli.EXIT_GATE_FAILED, (
        "an unwritable record changed the exit code — a refusal must not "
        "depend on a bookkeeping write"
    )
    printed = capsys.readouterr()
    said = flat(printed.out) + " " + flat(printed.err)

    assert "its gates did not pass" in said, "the refusal message changed"
    assert "refusal" in said and "could not" in said, (
        f"the write failure was swallowed: {said}"
    )


def test_the_record_validates_against_its_own_schema(
    delivery_repo, monkeypatch, capsys
):
    """The real draft-2020-12 engine, against the file `schema/frozen.json`
    publishes — not against a shape this test also wrote."""
    from jsonschema import Draft202012Validator

    schema_path = (
        Path(__file__).resolve().parent.parent / "schema" / "refusal.schema.json"
    )
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)

    (delivery_repo / ".wringer.yaml").write_text(
        CONFIG.replace('run: "true"', 'run: "false"'), encoding="utf-8"
    )
    monkeypatch.chdir(delivery_repo)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    assert cli.main(["deliver"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    errors = list(Draft202012Validator(schema).iter_errors(only_record(delivery_repo)))
    assert not errors, [f"{e.json_path} {e.message}" for e in errors]


def test_the_refusal_record_is_never_carried_into_a_delivery(
    delivery_repo, monkeypatch, capsys
):
    """One file per refused attempt accumulates forever (§4 ruling 8's
    retention rule). It must not accumulate into somebody else's merge
    request: `deliver.plan`'s carried set excludes everything under
    `.wringer/`, which is why the record goes there and nowhere else."""
    monkeypatch.chdir(delivery_repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()
    (delivery_repo / "feature.py").write_text(
        "def added():\n    return 3\n", encoding="utf-8"
    )
    assert cli.main(["deliver"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    assert refusal_records(delivery_repo)

    # Re-verify against the moved tree, then deliver for real.
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()
    assert cli.main(["deliver"]) == cli.EXIT_OK
    capsys.readouterr()

    plan = sorted((delivery_repo / deliver.DELIVERIES_DIRNAME).iterdir())[-1]
    patch = (plan / deliver.PATCH_FILENAME).read_text(encoding="utf-8")
    assert deliver.REFUSAL_FILENAME not in patch, (
        "a refusal record reached the delivery patch"
    )
