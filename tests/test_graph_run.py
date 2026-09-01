"""Executing a graph: intent, human, parking and resume (SPEC_GRAPH_V0 §3).

**Resume is built here, with the first two node kinds, and not later.** The
executor's whole state machine is "what has the ledger already recorded, and
what runs next" — retrofitting that onto a straight-line runner is the base
plan's largest sequencing mistake, because the straight-line version has
nowhere to put the answer.

The human node is the `approved: false` interlock again, deliberately:
SPEC_INTENT §3's three rules hold verbatim, so a person editing a file is the
only thing that moves a parked graph.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta

from core_helpers import flat

from wringer import cli, graph

PARKS = """\
version: 1
id: parks
budgets:
  wall_clock: 600
nodes:
  read-intent:
    kind: intent
    input: inputs.task
    writes:
      brief: state.brief
    then: approve
  approve:
    kind: human
    prompt: "Read the brief and approve it."
    then: done
inputs:
  task: task.md
"""


def only_graph(repo):
    found = sorted((repo / graph.GRAPHS_DIRNAME).iterdir())
    assert len(found) == 1, found
    return found[0]


def events(directory) -> list[dict]:
    text = (directory / graph.EVENTS_FILENAME).read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def setup(repo, body: str = PARKS) -> None:
    (repo / "task.md").write_text("# Add CSV export\n\nThe table needs it.\n", "utf-8")
    (repo / "graph.yaml").write_text(body, encoding="utf-8")


# --- a graph that parks ----------------------------------------------------


def test_a_graph_runs_to_its_human_node_and_parks(repo, monkeypatch, capsys):
    """Exit 5 — parked. Not 0, which would make `wring graph run && deploy`
    ship on a graph nobody approved; not 1, which would page someone for a
    graph that is merely waiting for them (SPEC_GRAPH_V0 §5.3)."""
    setup(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["graph", "run", "graph.yaml"]) == cli.EXIT_NEEDS_HUMAN
    printed = capsys.readouterr().out

    directory = only_graph(repo)
    kinds = [event["type"] for event in events(directory)]
    assert kinds[0] == "graph.started"
    assert "node.finished" in kinds          # the intent node completed
    assert kinds[-1] == "node.parked"
    assert "approve" in printed


def test_parking_writes_the_decision_file_a_person_edits(repo, monkeypatch, capsys):
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    capsys.readouterr()

    node = only_graph(repo) / graph.NODES_DIRNAME / "approve"
    assert (node / "prompt.md").is_file()
    decision = (node / "decision.yaml").read_text(encoding="utf-8")

    # `approved: false` is written as a CONSTANT — SPEC_INTENT §3's first
    # rule, which no flag, variable or reply may flip.
    assert "approved: false" in decision
    assert "Read the brief and approve it." in (node / "prompt.md").read_text("utf-8")


def test_the_intent_node_stages_its_input_into_evidence(repo, monkeypatch, capsys):
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    capsys.readouterr()

    staged = only_graph(repo) / graph.NODES_DIRNAME / "read-intent" / "brief.md"
    assert "Add CSV export" in staged.read_text(encoding="utf-8")


def test_a_missing_intent_input_fails_the_graph(repo, monkeypatch, capsys):
    setup(repo)
    (repo / "task.md").unlink()
    monkeypatch.chdir(repo)

    assert cli.main(["graph", "run", "graph.yaml"]) == cli.EXIT_GATE_FAILED
    # An outcome, on stdout with the rest of the report — a failing node is
    # a result like a failing gate, not a config error.
    assert "task.md" in flat(capsys.readouterr().out)
    assert events(only_graph(repo))[-1]["type"] == "graph.finished"


# --- resume ----------------------------------------------------------------


def test_resume_without_approval_stays_parked(repo, monkeypatch, capsys):
    """The interlock. Re-read from disk every time, and unapproved is still
    unapproved — there is deliberately no flag that says otherwise."""
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    assert cli.main(["graph", "resume", str(directory)]) == cli.EXIT_NEEDS_HUMAN
    capsys.readouterr()

    parks = [e for e in events(directory) if e["type"] == "node.parked"]
    assert len(parks) == 1, (
        "a second look at an unapproved decision file is not a second park — "
        "one event per park, not per glance"
    )


def test_resume_after_approval_finishes_the_graph(repo, monkeypatch, capsys):
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    decision = directory / graph.NODES_DIRNAME / "approve" / "decision.yaml"
    decision.write_text(
        "approved: true\ncomments: \"looks right\"\nstate_updates: {}\n", "utf-8"
    )

    assert cli.main(["graph", "resume", str(directory)]) == cli.EXIT_OK
    capsys.readouterr()

    recorded = events(directory)
    assert recorded[-1]["type"] == "graph.finished"
    assert recorded[-1]["status"] == "done"
    assert any(e["type"] == "graph.resumed" for e in recorded)


def test_resume_never_reruns_a_completed_node(repo, monkeypatch, capsys):
    """The whole reason resume reads the ledger. Re-running the intent node
    would restage its input and, in a real graph, re-run a loop that had
    already spent a worker's time."""
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    (directory / graph.NODES_DIRNAME / "approve" / "decision.yaml").write_text(
        "approved: true\ncomments: \"\"\nstate_updates: {}\n", "utf-8"
    )
    cli.main(["graph", "resume", str(directory)])
    capsys.readouterr()

    started = [
        e["node_id"] for e in events(directory) if e["type"] == "node.started"
    ]
    assert started.count("read-intent") == 1, (
        f"the intent node ran {started.count('read-intent')} times: {started}"
    )


def test_a_doctored_state_file_changes_nothing(repo, monkeypatch, capsys):
    """`state.json` is a convenience snapshot; the ledger is the truth. Editing
    it must not move the graph — otherwise the cheapest file in the bundle
    would be the one that decides what happens next."""
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    (directory / graph.STATE_FILENAME).write_text(
        json.dumps({"approved": "true", "brief": "forged"}), encoding="utf-8"
    )

    # Still parked: approval lives in the decision file a person edits, and
    # the ledger is what says where the graph is.
    assert cli.main(["graph", "resume", str(directory)]) == cli.EXIT_NEEDS_HUMAN
    capsys.readouterr()


def test_state_updates_from_an_approved_decision_are_applied(
    repo, monkeypatch, capsys
):
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    (directory / graph.NODES_DIRNAME / "approve" / "decision.yaml").write_text(
        'approved: true\ncomments: ""\nstate_updates:\n  risk: "low"\n', "utf-8"
    )
    cli.main(["graph", "resume", str(directory)])
    capsys.readouterr()

    updates = [e for e in events(directory) if e["type"] == "state.updated"]
    assert any(e.get("path") == "risk" and e.get("value") == "low" for e in updates)


def test_resume_on_a_finished_graph_says_so(repo, monkeypatch, capsys):
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    (directory / graph.NODES_DIRNAME / "approve" / "decision.yaml").write_text(
        "approved: true\ncomments: \"\"\nstate_updates: {}\n", "utf-8"
    )
    cli.main(["graph", "resume", str(directory)])
    capsys.readouterr()

    assert cli.main(["graph", "resume", str(directory)]) == cli.EXIT_CONFIG
    assert "finished" in flat(capsys.readouterr().err)


def test_a_killed_graph_resumes_from_the_ledger_alone(repo, monkeypatch, capsys):
    """No manifest, no state.json — only the ledger. That is the shape a
    `kill -9` leaves, and resume has to work from it."""
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    (directory / graph.MANIFEST_FILENAME).unlink()
    (directory / graph.STATE_FILENAME).unlink()
    (directory / graph.NODES_DIRNAME / "approve" / "decision.yaml").write_text(
        "approved: true\ncomments: \"\"\nstate_updates: {}\n", "utf-8"
    )

    assert cli.main(["graph", "resume", str(directory)]) == cli.EXIT_OK
    capsys.readouterr()
    assert events(directory)[-1]["status"] == "done"


def test_a_graph_killed_between_nodes_resumes_at_the_next_one(
    repo, monkeypatch, capsys
):
    """The case `parked_at` does NOT cover, and the one that pins the resume
    machinery.

    A parked resume starts from the node that parked, so it exercises neither
    `_next_after` nor the completed-node skip — both can be deleted and every
    other resume test still passes. That was measured, not assumed.

    A `kill -9` between nodes leaves a ledger that simply stops after
    `node.finished`, with no park and no `graph.finished`. Resume then has to
    work out where it got to from the ledger alone, and must not re-run the
    node that already completed.
    """
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    # Truncate to exactly what a kill between nodes leaves: everything up to
    # and including the intent node finishing, and nothing after.
    ledger = directory / graph.EVENTS_FILENAME
    kept = []
    for line in ledger.read_text(encoding="utf-8").splitlines():
        kept.append(line)
        if json.loads(line).get("type") == "node.finished":
            break
    ledger.write_text("\n".join(kept) + "\n", encoding="utf-8")
    (directory / graph.NODES_DIRNAME / "approve" / "decision.yaml").unlink()

    assert cli.main(["graph", "resume", str(directory)]) == cli.EXIT_NEEDS_HUMAN
    capsys.readouterr()

    started = [e["node_id"] for e in events(directory) if e["type"] == "node.started"]
    assert started.count("read-intent") == 1, (
        f"the completed intent node ran again on resume: {started}"
    )
    assert "approve" in started, "resume did not reach the node that was next"


# --- a park does not spend the budget (factory blocker F1) -----------------


LOOPS_AFTER_APPROVAL = """\
version: 1
id: parks-then-builds
budgets:
  wall_clock: 600
nodes:
  read-intent:
    kind: intent
    input: inputs.task
    writes:
      brief: state.brief
    then: approve
  approve:
    kind: human
    prompt: "Read the brief and approve it."
    then: build
  build:
    kind: loop
    budgets:
      max_iterations: 2
    writes:
      status: state.build-status
    then: done
inputs:
  task: task.md
"""


def _age_the_park(directory, hours: float) -> None:
    """Rewrite the bundle so the park happened `hours` ago.

    The graph started, ran its intent node, parked — and then a person took
    `hours` to look at it. That is the ordinary life of an approval, and the
    only honest way to test it is to move the recorded timestamps rather than
    to wait.
    """
    import json as _json
    from datetime import timedelta

    manifest_path = directory / graph.MANIFEST_FILENAME
    recorded = _json.loads(manifest_path.read_text(encoding="utf-8"))
    started = datetime.fromisoformat(recorded["started_at"])
    shifted = started - timedelta(hours=hours)
    recorded["started_at"] = shifted.replace(microsecond=0).isoformat()
    manifest_path.write_text(_json.dumps(recorded, indent=2) + "\n", "utf-8")

    # The ledger moves with it: the run really did start and park that long
    # ago, and the events are what a resume reads.
    path = directory / graph.EVENTS_FILENAME
    lines = []
    for line in path.read_text(encoding="utf-8").splitlines():
        event = _json.loads(line)
        stamped = datetime.fromisoformat(event["ts"]) - timedelta(hours=hours)
        event["ts"] = stamped.isoformat(timespec="milliseconds")
        lines.append(_json.dumps(event))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_a_slow_human_approval_does_not_spend_the_graphs_budget(
    repo, monkeypatch, capsys
):
    """Factory blocker F1, and it made the interlock unusable overnight.

    A graph's `wall_clock` counted real time while PARKED at a human node, so
    an approval slower than the budget failed the moment it was granted:
    "the graph's 1800s budget was spent before this node started, so the loop
    was never run" (reproduced on graph 20260809-113623-769d, 1800s budget,
    approved ~75 minutes later). The human gate is the whole point of the
    graph — a PM reads a brief and decides — and a budget that expires while
    waiting for that decision makes the feature unusable for its purpose.

    Budgets bound EXECUTION, not human latency. Invariant 3 wants every wait
    to have a deadline, and the wait it means is a machine's, not a person's:
    supervision exists so a runaway loop cannot burn a night, and a parked
    graph is burning nothing at all.
    """
    setup(repo, body=LOOPS_AFTER_APPROVAL)
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / ".wringer.yaml").write_text(
        'version: 1\ngates:\n  - id: test\n    run: "grep -q FIXED calc.py"\n'
        'run:\n  worker: ": {brief}; sh -c \'echo FIXED > calc.py\'"\n'
        '  max_iterations: 2\n',
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["graph", "run", "graph.yaml"]) == cli.EXIT_NEEDS_HUMAN
    directory = only_graph(repo)
    capsys.readouterr()

    # The person comes back two hours later — well past the 600s budget.
    _age_the_park(directory, hours=2)
    (directory / graph.NODES_DIRNAME / "approve" / "decision.yaml").write_text(
        'approved: true\ncomments: "took me a while"\nstate_updates: {}\n',
        encoding="utf-8",
    )

    code = cli.main(["graph", "resume", str(directory)])
    printed = flat(capsys.readouterr().out + capsys.readouterr().err)

    assert code == cli.EXIT_OK, (
        "a graph refused to resume because a human took two hours to approve "
        f"it — the budget counted their thinking time. Printed: {printed}"
    )
    recorded = events(directory)
    assert not any(e["type"] == "budget.exhausted" for e in recorded), recorded
    assert recorded[-1]["type"] == "graph.finished"
    assert recorded[-1]["status"] == "done"


def test_execution_time_still_exhausts_the_budget(repo, monkeypatch, capsys):
    """The other direction, so the fix does not become "budgets never
    expire". Time the graph spent RUNNING still counts, and a graph whose
    execution outlives its wall clock is still exhausted — invariant 3 is
    intact, it just stopped charging people for thinking."""
    setup(repo, body=LOOPS_AFTER_APPROVAL)
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / ".wringer.yaml").write_text(
        'version: 1\ngates:\n  - id: test\n    run: "grep -q FIXED calc.py"\n'
        'run:\n  worker: ": {brief}; sh -c \'echo FIXED > calc.py\'"\n'
        '  max_iterations: 2\n',
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()
    (directory / graph.NODES_DIRNAME / "approve" / "decision.yaml").write_text(
        "approved: true\ncomments: \"\"\nstate_updates: {}\n", encoding="utf-8"
    )

    # No park to discount — the graph simply started long ago and kept
    # running, which is exactly what the budget exists to stop.
    import json as _json

    manifest_path = directory / graph.MANIFEST_FILENAME
    recorded = _json.loads(manifest_path.read_text(encoding="utf-8"))
    started = datetime.fromisoformat(recorded["started_at"])
    recorded["started_at"] = (
        (started - timedelta(hours=2)).replace(microsecond=0).isoformat()
    )
    manifest_path.write_text(_json.dumps(recorded, indent=2) + "\n", "utf-8")

    assert cli.main(["graph", "resume", str(directory)]) != cli.EXIT_OK
    capsys.readouterr()
    assert any(e["type"] == "budget.exhausted" for e in events(directory))
