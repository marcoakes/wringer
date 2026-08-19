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

import ast
import json
from pathlib import Path

from conftest import flat

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

SOURCE = Path(deliver.__file__)


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


def raise_sites() -> list[ast.Raise]:
    """Every `raise Refused(...)` in `deliver.py`, parsed rather than grepped."""
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"), filename=str(SOURCE))
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Raise) or not isinstance(node.exc, ast.Call):
            continue
        callee = node.exc.func
        name = (
            callee.id
            if isinstance(callee, ast.Name)
            else callee.attr if isinstance(callee, ast.Attribute) else None
        )
        if name == "Refused":
            found.append(node)
    return found


def named_reason(node: ast.Raise) -> str | None:
    """The `reason=` a site passes, or None — a non-literal counts as None,
    because a name computed at runtime is not a name a reader can enumerate."""
    for keyword in node.exc.keywords:  # type: ignore[union-attr]
        if keyword.arg == "reason":
            value = keyword.value
            return value.value if isinstance(value, ast.Constant) else None
    return None


# --- the two directions ----------------------------------------------------


def test_every_refusal_site_names_a_reason():
    """§4 ruling 7. A site that raises without a name is a refusal no machine
    can tell from any other, and the whole slice is that they can."""
    sites = raise_sites()
    assert len(sites) == 23, (
        f"expected 23 `raise Refused(` sites in {SOURCE.name}, found "
        f"{len(sites)} at lines {[n.lineno for n in sites]} — if a refusal was "
        "added or removed, docs/specs/SPEC_REFUSAL_V0.md §4's table and "
        "deliver.REFUSAL_REASONS both move with it"
    )

    unnamed = [node.lineno for node in sites if named_reason(node) is None]
    assert not unnamed, (
        f"{SOURCE.name} raises Refused without a literal `reason=` at lines "
        f"{unnamed}. `Refused.__init__` requires it, but most of these 23 "
        "sites are on no tested path, so nothing would have executed the "
        "constructor to find out."
    )

    stray = sorted(
        {
            named_reason(node)
            for node in sites
            if named_reason(node) not in deliver.REFUSAL_REASONS
        }
    )
    assert not stray, (
        f"raised but not in deliver.REFUSAL_REASONS: {stray} — a name that is "
        "not in the tuple is a name no reader can enumerate"
    )


def test_every_named_reason_is_raised_somewhere():
    """The other direction, and the reason it exists: a name in the tuple that
    nothing raises is dead text that reads as coverage."""
    raised = {named_reason(node) for node in raise_sites()}
    declared = set(deliver.REFUSAL_REASONS)
    assert raised == declared, (
        f"declared but never raised: {sorted(declared - raised)}; "
        f"raised but never declared: {sorted(raised - declared)}"
    )


def test_the_reasons_are_a_closed_tuple_without_duplicates():
    assert isinstance(deliver.REFUSAL_REASONS, tuple)
    assert len(set(deliver.REFUSAL_REASONS)) == len(deliver.REFUSAL_REASONS)


# --- the record ------------------------------------------------------------


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
