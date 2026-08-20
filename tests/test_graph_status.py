"""`wring graph status` and `wring graph explain` (SPEC_GRAPH_V0 §1, §4).

Both read **the ledger and `graph.resolved.json`**, and nothing else. Not the
author's YAML, which describes the next run rather than this one; not
`state.json` or `manifest.json`, which are conveniences — a reporter that
trusted them would describe the cheapest files in the bundle instead of what
happened.

Neither of them decides anything, which is why neither can return 5. `wring
graph run` and `wring graph resume` return it, because a parked graph is the
claim `wring judge` makes with that code: nothing was decided; a person must
act. A report is not that claim.
"""

from __future__ import annotations

import json
import re

from core_helpers import flat

from wringer import cli, graph

CONFIG = """\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
run:
  worker: "sh ./fix.sh"
  max_iterations: 3
"""

PARKS = """\
version: 1
id: parks
budgets:
  wall_clock: 600
state:
  approved: "false"
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
    then: route
  route:
    kind: router
    routes:
      - when: "state.build-status == 'converged'"
        to: done
    default: fail
inputs:
  task: task.md
"""


def only_graph(repo):
    found = sorted((repo / graph.GRAPHS_DIRNAME).iterdir())
    assert len(found) == 1, found
    return found[0]


def setup(repo, *, worker_fixes: bool = True, body: str = PARKS) -> None:
    (repo / "task.md").write_text("# Add CSV export\n\nThe table needs it.\n", "utf-8")
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / "fix.sh").write_text(
        "echo FIXED > calc.py\n" if worker_fixes else "true\n", encoding="utf-8"
    )
    (repo / ".wringer.yaml").write_text(CONFIG, encoding="utf-8")
    (repo / "graph.yaml").write_text(body, encoding="utf-8")


def approve(directory, node: str = "approve") -> None:
    (directory / graph.NODES_DIRNAME / node / graph.DECISION_FILENAME).write_text(
        'approved: true\ncomments: ""\nstate_updates: {}\n', encoding="utf-8"
    )


# --- status ----------------------------------------------------------------


def test_status_says_where_a_parked_graph_is_and_why(repo, monkeypatch, capsys):
    setup(repo)
    monkeypatch.chdir(repo)
    assert cli.main(["graph", "run", "graph.yaml"]) == cli.EXIT_NEEDS_HUMAN
    directory = only_graph(repo)
    capsys.readouterr()

    assert cli.main(["graph", "status", str(directory)]) == cli.EXIT_OK
    printed = flat(capsys.readouterr().out)

    assert "parked" in printed
    assert "approve" in printed
    assert "a person must approve this node" in printed


def test_status_marks_every_node_with_where_the_run_got_to(
    repo, monkeypatch, capsys
):
    """One screen, and it has to be the whole graph: a status that showed only
    the current node would answer "where" and never "how far"."""
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    cli.main(["graph", "status", str(directory)])
    lines = capsys.readouterr().out.splitlines()

    marked = {
        parts[1]: " ".join(parts[3:])
        for parts in (line.split() for line in lines)
        if len(parts) >= 4 and parts[0] in cli.GRAPH_MARKS.values()
    }
    assert marked == {
        "read-intent": "done",
        "approve": "waiting",
        "build": "not reached",
        "route": "not reached",
    }, marked


def test_status_shows_the_routing_state_it_replayed(repo, monkeypatch, capsys):
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    approve(directory)
    cli.main(["graph", "resume", str(directory)])
    capsys.readouterr()

    cli.main(["graph", "status", str(directory)])
    printed = flat(capsys.readouterr().out)

    assert "build-status = converged" in printed
    assert "approved = false" in printed


def test_status_describes_what_ran_not_what_the_file_says_now(
    repo, monkeypatch, capsys
):
    """`graph.resolved.json` exists for exactly this. Editing the YAML changes
    the next run; a report that read it would describe a graph this run never
    executed, which is the same mistake as delivering against a bundle taken
    before the code moved."""
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    (repo / "graph.yaml").write_text(
        "version: 1\nid: rewritten\nbudgets:\n  wall_clock: 60\n"
        "nodes:\n  totally-different:\n    kind: human\n"
        '    prompt: "not the graph that ran"\n    then: done\n',
        encoding="utf-8",
    )

    cli.main(["graph", "status", str(directory)])
    printed = flat(capsys.readouterr().out)

    assert "read-intent" in printed
    assert "totally-different" not in printed
    assert "rewritten" not in printed


def test_status_calls_a_killed_graph_interrupted(repo, monkeypatch, capsys):
    """A ledger that simply stops is neither done, nor failed, nor waiting for
    a person — it is the shape `kill -9` leaves, and saying "parked" about it
    would send someone to edit a file nobody is waiting on."""
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    ledger = directory / graph.EVENTS_FILENAME
    kept = []
    for line in ledger.read_text(encoding="utf-8").splitlines():
        kept.append(line)
        if json.loads(line).get("type") == "node.finished":
            break
    ledger.write_text("\n".join(kept) + "\n", encoding="utf-8")

    assert cli.main(["graph", "status", str(directory)]) == cli.EXIT_OK
    printed = flat(capsys.readouterr().out)
    assert "interrupted" in printed
    assert "approve" in printed, "it does not say which node was next"


def test_status_refuses_a_directory_that_is_not_a_graph_run(
    repo, monkeypatch, capsys
):
    setup(repo)
    monkeypatch.chdir(repo)
    assert cli.main(["graph", "status", "task.md"]) == cli.EXIT_CONFIG
    assert "graph" in flat(capsys.readouterr().err)


# --- explain ---------------------------------------------------------------


def test_explain_says_why_it_stopped_and_the_next_action(repo, monkeypatch, capsys):
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    assert cli.main(["graph", "explain", str(directory)]) == cli.EXIT_OK
    printed = capsys.readouterr().out

    assert "approve" in printed
    assert graph.DECISION_FILENAME in printed
    # Repo-relative, the way every other path this program prints is — a
    # reader copies these lines into a terminal standing in the repo.
    assert (
        f"wring graph resume .wringer/graphs/{directory.name}" in flat(printed)
    ), printed


def test_explain_names_the_failing_node_and_does_not_offer_resume(
    repo, monkeypatch, capsys
):
    """A failed graph has a `graph.finished` event, so resume refuses it.
    Offering it anyway would be advice that cannot work."""
    setup(repo, worker_fixes=False)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    approve(directory)
    assert cli.main(["graph", "resume", str(directory)]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    cli.main(["graph", "explain", str(directory)])
    printed = flat(capsys.readouterr().out)

    assert "failed" in printed
    assert "route" in printed, printed
    assert "wring graph resume" not in printed


def test_explain_on_a_finished_graph_says_there_is_nothing_to_do(
    repo, monkeypatch, capsys
):
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    approve(directory)
    assert cli.main(["graph", "resume", str(directory)]) == cli.EXIT_OK
    capsys.readouterr()

    cli.main(["graph", "explain", str(directory)])
    printed = flat(capsys.readouterr().out)

    assert "done" in printed
    assert "wring graph resume" not in printed


def test_every_wring_command_explain_offers_parses(repo, monkeypatch, capsys):
    """Advice that does not parse is not advice. Fed back to the real parser,
    the same way the dry-run delivery report's lines are."""
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    cli.main(["graph", "explain", str(directory)])
    offered = [
        line.strip()
        for line in capsys.readouterr().out.splitlines()
        if line.strip().startswith("wring ")
    ]

    assert offered, "explain offered no command at all"
    parser = cli.build_parser()
    for line in offered:
        parser.parse_args(line.split()[1:])


def test_neither_status_nor_explain_returns_the_parked_code(
    repo, monkeypatch, capsys
):
    """5 is a claim — *nothing was decided; a person must act*. `run` and
    `resume` make it. A report does not: it only says that somebody else
    already did."""
    setup(repo)
    monkeypatch.chdir(repo)
    assert cli.main(["graph", "run", "graph.yaml"]) == cli.EXIT_NEEDS_HUMAN
    directory = only_graph(repo)
    capsys.readouterr()

    assert cli.main(["graph", "status", str(directory)]) != cli.EXIT_NEEDS_HUMAN
    assert cli.main(["graph", "explain", str(directory)]) != cli.EXIT_NEEDS_HUMAN
    capsys.readouterr()


# --- render, and the picture that cannot go stale --------------------------


def drawn(diagram: str) -> tuple[set[str], set[tuple[str, str]]]:
    """Read the Mermaid back — derived from the text, never enumerated here.

    A test that listed the expected nodes would be the second hand-maintained
    picture the renderer exists to avoid.
    """
    nodes = set(re.findall(r"^  ([A-Za-z0-9_-]+)\[", diagram, re.MULTILINE))
    edges = {
        (match[0], match[2])
        for match in re.findall(
            r"^  ([A-Za-z0-9_-]+) -->(\|[^|]*\|)? ([A-Za-z0-9_-]+)$",
            diagram,
            re.MULTILINE,
        )
    }
    return nodes, edges


def test_the_diagram_agrees_with_the_resolved_graph_node_for_node(
    repo, monkeypatch, capsys
):
    """Both sides derived: the picture from `render_mermaid`, the truth from
    the same `Graph` object the executor walked. Four hand-maintained lists
    went stale in one release this month; a diagram is the easiest of all."""
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    resolved = graph.resolved(graph.Bundle.at(directory))
    nodes, edges = drawn(graph.render_mermaid(resolved))

    assert nodes == {node.id for node in resolved.nodes}
    assert edges == {
        (node.id, target) for node in resolved.nodes for target in node.targets
    }


def test_render_draws_the_run_when_given_one(repo, monkeypatch, capsys):
    """§4: the resolved graph exists so `render` describes what RAN. Handed a
    run directory it reads that, and the YAML on disk cannot change it."""
    setup(repo)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    (repo / "graph.yaml").write_text(
        "version: 1\nid: rewritten\nbudgets:\n  wall_clock: 60\n"
        "nodes:\n  totally-different:\n    kind: human\n"
        '    prompt: "not the graph that ran"\n    then: done\n',
        encoding="utf-8",
    )

    assert cli.main(["graph", "render", str(directory)]) == cli.EXIT_OK
    diagram = capsys.readouterr().out

    nodes, _ = drawn(diagram)
    assert nodes == {"read-intent", "approve", "build", "route"}, diagram


def test_render_still_draws_a_file(repo, monkeypatch, capsys):
    setup(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["graph", "render", "graph.yaml"]) == cli.EXIT_OK
    nodes, _ = drawn(capsys.readouterr().out)
    assert nodes == {"read-intent", "approve", "build", "route"}
