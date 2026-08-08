"""The deliver node, and the lie that cannot deliver (SPEC_GRAPH_V0 §3e, §5.5).

Two rulings meet in this file and neither is decoration.

**Ruling 2 — state routes; only bundles gate.** A human node's `state_updates`
can say anything it likes, including `build-status: converged` for a repo
whose gates never passed. It will route the graph straight at the deliver
node, and the delivery will still refuse, because delivery re-asks the
*bundle*. That refusal is the difference between a graph engine and a liar,
and `test_a_forged_converged_state_still_cannot_deliver` is the whole point of
the slice.

**Ruling 5 — `--send` is the human's, typed on the invocation.** The amended
law 6 says git history moves only on a flag a person typed, so the flag is
typed on `wring graph run` or `wring graph resume` and authorises the deliver
node reached in THAT invocation, once. A graph file may not carry it and a
decision file may not carry it, because **a file is not a typed flag** — and
parking is exactly where a file would otherwise smuggle one across.
"""

from __future__ import annotations

import json
from pathlib import Path

from conftest import flat

from wringer import cli, deliver, graph

CONFIG = """\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
run:
  worker: "sh ./fix.sh"
  max_iterations: 3
deliver:
  branch: "wringer/{run}"
  remote: origin
"""

# loop → router → deliver. The headline flow with the human taken out, so the
# tests that are about delivery are not also about parking.
SHIP = """\
version: 1
id: ship
budgets:
  wall_clock: 900
nodes:
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
        to: send-it
    default: fail
  send-it:
    kind: deliver
    then: done
"""

# loop → human → router → deliver. The human node sits AFTER the loop on
# purpose: that is the only position from which `state_updates` can overwrite
# what the loop really found, which is the forgery this file exists to refuse.
PAUSED = """\
version: 1
id: paused
budgets:
  wall_clock: 900
nodes:
  build:
    kind: loop
    budgets:
      max_iterations: 2
    writes:
      status: state.build-status
    then: approve
  approve:
    kind: human
    prompt: "Say what really happened, then approve."
    then: route
  route:
    kind: router
    routes:
      - when: "state.build-status == 'converged'"
        to: send-it
    default: fail
  send-it:
    kind: deliver
    then: done
"""

APPROVED = 'approved: true\ncomments: ""\nstate_updates: {}\n'
FORGERY = (
    "approved: true\n"
    'comments: "it is fine, honestly"\n'
    "state_updates:\n"
    '  build-status: "converged"\n'
)


def only_graph(repo: Path) -> Path:
    found = sorted((repo / graph.GRAPHS_DIRNAME).iterdir())
    assert len(found) == 1, found
    return found[0]


def events(directory: Path) -> list[dict]:
    text = (directory / graph.EVENTS_FILENAME).read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def deliveries(repo: Path) -> list[Path]:
    root = repo / deliver.DELIVERIES_DIRNAME
    return sorted(root.iterdir()) if root.is_dir() else []


def delivery_manifest(repo: Path) -> dict:
    found = deliveries(repo)
    assert len(found) == 1, found
    return json.loads(
        (found[0] / deliver.MANIFEST_FILENAME).read_text(encoding="utf-8")
    )


def refs(repo: Path, git_run) -> set[str]:
    listed = git_run(repo, "for-each-ref", "--format=%(refname)")
    return {line for line in listed.splitlines() if line.strip()}


def decision(directory: Path, node: str = "approve") -> Path:
    return directory / graph.NODES_DIRNAME / node / graph.DECISION_FILENAME


def setup(
    repo: Path,
    git_run,
    tmp_path_factory,
    *,
    worker_fixes: bool = True,
    body: str = SHIP,
    config: str = CONFIG,
) -> Path:
    """A committed repo with a real bare `origin`, ready to run a graph.

    The baseline is COMMITTED so `check_verified_tree` has a stable HEAD to
    compare against, and the worker's edit is a tracked change rather than a
    new file — the ordinary shape of the thing being delivered.
    """
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / "fix.sh").write_text(
        "echo FIXED > calc.py\n" if worker_fixes else "true\n", encoding="utf-8"
    )
    (repo / ".wringer.yaml").write_text(config, encoding="utf-8")
    (repo / "graph.yaml").write_text(body, encoding="utf-8")
    git_run(repo, "add", "-A")
    git_run(repo, "commit", "-qm", "baseline")

    # A real bare `origin` on disk. Delivery refuses when the remote's default
    # branch cannot be resolved — one of its five conditions — and without one
    # that refusal would stand in for whichever refusal a test is about.
    origin = tmp_path_factory.mktemp("origin") / "bare.git"
    git_run(repo, "init", "--bare", "-b", "main", "-q", str(origin))
    git_run(repo, "remote", "add", "origin", str(origin))
    git_run(repo, "push", "-q", "origin", "main")
    git_run(repo, "remote", "set-head", "origin", "-a")
    return origin


# --- the test that matters -------------------------------------------------


def test_a_forged_converged_state_still_cannot_deliver(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """SPEC_GRAPH_V0 §7, ruling 2 — the whole slice in one test.

    The loop really ran and really did not converge. A person then edited the
    decision file and wrote `build-status: converged` into state by hand. The
    router believes it, because routing IS what state is for. The delivery
    does not, because delivery re-reads the run bundle the loop recorded and
    that bundle's gates failed.

    A graph that could ship on a forged string would be Wringer publishing a
    claim of verification about code that was never verified — the exact
    failure `check_verified_tree` exists to prevent, one layer up.
    """
    setup(repo, git_run, tmp_path_factory, worker_fixes=False, body=PAUSED)
    monkeypatch.chdir(repo)
    before = refs(repo, git_run)

    assert cli.main(["graph", "run", "graph.yaml"]) == cli.EXIT_NEEDS_HUMAN
    directory = only_graph(repo)
    capsys.readouterr()

    decision(directory).write_text(FORGERY, encoding="utf-8")

    # `--send` typed too: the refusal must not be an artefact of the dry run.
    code = cli.main(["graph", "resume", str(directory), "--send"])
    printed = capsys.readouterr()

    assert code == cli.EXIT_GATE_FAILED
    said = flat(printed.out) + " " + flat(printed.err)
    assert "gates did not pass" in said, said

    # The forgery DID route — that is what state is for, and pretending
    # otherwise would test the wrong thing.
    selected = [e for e in events(directory) if e["type"] == "route.selected"]
    assert selected and selected[-1]["to"] == "send-it", selected

    # And delivery refused anyway.
    failed = [e for e in events(directory) if e["type"] == "node.failed"]
    assert failed and failed[-1]["node_id"] == "send-it", failed
    assert refs(repo, git_run) == before, "a forged state moved git history"
    assert not deliveries(repo), (
        "a refused delivery wrote a delivery bundle — the refusal happens "
        "before anything is planned"
    )


def test_the_refusal_a_graph_reports_fits_a_terminal(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """Delivery's refusals are prose, and prose composed for a graph's report
    was printed raw: 142 columns for the gates refusal, in a message whose
    entire job is to be read and acted on. That is `wring deliver`'s
    402-column vacuity line again, one layer up — `_wrap_message` exists for
    it and the graph's report was not using it.

    Asserted as a property, never on where a line broke: the formatter has its
    own tests, and pinning a break point here would test the formatter.
    """
    setup(repo, git_run, tmp_path_factory, worker_fixes=False, body=PAUSED)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    decision(directory).write_text(FORGERY, encoding="utf-8")
    assert cli.main(["graph", "resume", str(directory)]) == cli.EXIT_GATE_FAILED
    printed = capsys.readouterr()

    over = [line for line in printed.out.splitlines() if len(line) > 80]
    assert not over, f"{len(over)} line(s) run past any terminal: {over}"
    # And the reflow must not have eaten the message.
    assert "its gates did not pass" in flat(printed.out)


def test_a_vacuous_bundle_is_refused_and_the_graph_does_not_route_around_it(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """`gates_vacuous` is already a delivery refusal (SPEC_VACUITY §3b). A
    graph must inherit it rather than route past it — the graph adds
    sequencing, never permission."""
    from wringer import vacuity

    setup(repo, git_run, tmp_path_factory, body=PAUSED)
    monkeypatch.chdir(repo)
    before = refs(repo, git_run)

    assert cli.main(["graph", "run", "graph.yaml"]) == cli.EXIT_NEEDS_HUMAN
    directory = only_graph(repo)
    capsys.readouterr()

    # Doctor the loop's final run into one whose own gates proved nothing.
    reference = json.loads(
        (directory / graph.NODES_DIRNAME / "build" / "loop.ref.json").read_text("utf-8")
    )
    loop_manifest = json.loads(
        (repo / reference["loop_dir"] / "manifest.json").read_text(encoding="utf-8")
    )
    run_dir = repo / loop_manifest["result"]["final_run"]
    (run_dir / vacuity.VACUITY_FILENAME).write_text(
        json.dumps(
            {
                "schema_version": vacuity.SCHEMA_VERSION,
                "verdict": vacuity.GATES_VACUOUS,
                "reason": "every gate passed on the pre-change tree too",
                "gates": [],
            }
        ),
        encoding="utf-8",
    )

    decision(directory).write_text(APPROVED, encoding="utf-8")
    code = cli.main(["graph", "resume", str(directory), "--send"])
    printed = capsys.readouterr()

    assert code == cli.EXIT_GATE_FAILED
    assert refs(repo, git_run) == before, "a vacuous bundle moved git history"
    assert "vacuous" in (flat(printed.out) + flat(printed.err)).lower()


# --- dry run by default ----------------------------------------------------


def test_the_deliver_node_dry_runs_and_git_is_untouched(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """Dry-run by default, exactly as `wring deliver` is. The patch, message,
    branch and MR body land on disk and nothing touches git."""
    setup(repo, git_run, tmp_path_factory)
    monkeypatch.chdir(repo)
    before = refs(repo, git_run)
    head = git_run(repo, "rev-parse", "HEAD")

    assert cli.main(["graph", "run", "graph.yaml"]) == cli.EXIT_OK
    printed = capsys.readouterr()

    manifest = delivery_manifest(repo)
    assert manifest["mode"] == "dry_run"
    assert manifest["result"]["branch"] is None
    assert manifest["result"]["pushed"] is False
    assert refs(repo, git_run) == before
    assert git_run(repo, "rev-parse", "HEAD") == head

    # The bytes a human reads before authorising anything.
    written = deliveries(repo)[0]
    for name in (deliver.PATCH_FILENAME, deliver.COMMIT_FILENAME,
                 deliver.BRANCH_FILENAME, deliver.MR_FILENAME):
        assert (written / name).is_file(), f"{name} was not written"

    assert "--send" in printed.out, (
        "a dry run that does not say what to type next is a dead end"
    )


def test_the_dry_run_report_names_a_command_that_exists(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """"Says exactly what to type next" is only true if the thing it says
    parses. Every `wring ...` line the report prints is fed back to the real
    parser here — the graph is `done`, so `wring graph resume` is NOT an
    answer and a report offering it would be lying."""
    setup(repo, git_run, tmp_path_factory)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    printed = capsys.readouterr().out

    offered = [
        line.strip()
        for line in printed.splitlines()
        if line.strip().startswith("wring ")
    ]
    assert offered, f"the dry-run report offered no next command:\n{printed}"
    parser = cli.build_parser()
    for line in offered:
        parser.parse_args(line.split()[1:])
    assert not any(line.startswith("wring graph resume") for line in offered), (
        f"the report offers to resume a finished graph: {offered}"
    )


def test_send_on_the_invocation_authorises_the_deliver_node(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """The amended law 6: a human types the flag, and the graph run IS the
    human's invocation. With it, delivery passes through every shipped
    refusal and then really writes git history."""
    origin = setup(repo, git_run, tmp_path_factory)
    monkeypatch.chdir(repo)

    assert cli.main(["graph", "run", "graph.yaml", "--send"]) == cli.EXIT_OK
    capsys.readouterr()

    manifest = delivery_manifest(repo)
    assert manifest["mode"] == "live"
    assert manifest["result"]["branch"].startswith("wringer/")
    assert manifest["result"]["pushed"] is True

    pushed = git_run(repo, "ls-remote", "--heads", str(origin))
    assert manifest["result"]["branch"] in pushed, pushed


def test_a_dry_run_is_recorded_in_the_ledger_as_a_dry_run(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """The bundle has to say which of the two happened, or a reader of the
    evidence cannot tell a plan from a push."""
    setup(repo, git_run, tmp_path_factory)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    capsys.readouterr()

    directory = only_graph(repo)
    finished = next(
        e for e in events(directory)
        if e["type"] == "node.finished" and e["node_id"] == "send-it"
    )
    assert finished["status"] == "dry_run"


# --- a file is not a typed flag --------------------------------------------


def test_a_graph_file_may_not_carry_send():
    """Ruling 5. `send: true` in a document is the one thing the document may
    not say, and it is refused by NAME with the reason rather than lumped in
    with every other typo."""
    body = SHIP.replace("    kind: deliver\n", "    kind: deliver\n    send: true\n")
    problems = ""
    try:
        graph.parse(body, "graph.yaml")
    except graph.GraphError as exc:
        problems = str(exc)
    assert "send" in problems, problems
    assert "invocation" in problems, (
        f"the refusal does not say where --send actually goes: {problems}"
    )


def test_a_decision_file_may_not_carry_send(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """A decision file is edited by hand, which makes it the most plausible
    place for someone to try to write the flag down. It is still a file."""
    setup(repo, git_run, tmp_path_factory, body=PAUSED)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    decision(directory).write_text(
        'approved: true\ncomments: ""\nstate_updates: {}\nsend: true\n', "utf-8"
    )
    code = cli.main(["graph", "resume", str(directory)])
    printed = capsys.readouterr()

    # Named specifically. `send` alone would match the node id `send-it` and
    # pass against a graph that has no deliver node at all — it did, before
    # this line said what the message must actually contain.
    assert code == cli.EXIT_GATE_FAILED
    said = flat(printed.out) + " " + flat(printed.err)
    assert "a decision file 'send:' is not a key a file may carry" in said, said
    assert "typed on the invocation" in said, said
    assert not any(
        m["mode"] == "live"
        for m in (
            json.loads((d / deliver.MANIFEST_FILENAME).read_text("utf-8"))
            for d in deliveries(repo)
            if (d / deliver.MANIFEST_FILENAME).is_file()
        )
    ), "a decision file authorised a send"


def test_state_updates_cannot_authorise_a_send(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """The subtler half: routing state called `send` is still routing state.
    Nothing reads state as authority, so writing one changes nothing."""
    setup(repo, git_run, tmp_path_factory, body=PAUSED)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    directory = only_graph(repo)
    capsys.readouterr()

    decision(directory).write_text(
        'approved: true\ncomments: ""\nstate_updates:\n  send: "true"\n', "utf-8"
    )
    assert cli.main(["graph", "resume", str(directory)]) == cli.EXIT_OK
    capsys.readouterr()

    assert delivery_manifest(repo)["mode"] == "dry_run"


def test_resume_requires_retyping_send(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """Scope is deliberately narrow: the flag authorises the deliver node
    reached in THAT invocation. A graph that parked has ended that
    invocation, so the authorisation ends with it — otherwise the park itself
    would be the file that carried the flag."""
    setup(repo, git_run, tmp_path_factory, body=PAUSED)
    monkeypatch.chdir(repo)
    before = refs(repo, git_run)

    # Typed on the run that parked, and never reaching a deliver node.
    assert cli.main(["graph", "run", "graph.yaml", "--send"]) == cli.EXIT_NEEDS_HUMAN
    directory = only_graph(repo)
    capsys.readouterr()

    decision(directory).write_text(APPROVED, encoding="utf-8")
    assert cli.main(["graph", "resume", str(directory)]) == cli.EXIT_OK
    capsys.readouterr()

    assert delivery_manifest(repo)["mode"] == "dry_run", (
        "a --send typed before the park authorised a delivery after it"
    )
    assert refs(repo, git_run) == before


def test_resume_with_send_delivers(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """The other half of the same rule: retyped, it works."""
    origin = setup(repo, git_run, tmp_path_factory, body=PAUSED)
    monkeypatch.chdir(repo)

    assert cli.main(["graph", "run", "graph.yaml"]) == cli.EXIT_NEEDS_HUMAN
    directory = only_graph(repo)
    capsys.readouterr()

    decision(directory).write_text(APPROVED, encoding="utf-8")
    assert cli.main(["graph", "resume", str(directory), "--send"]) == cli.EXIT_OK
    capsys.readouterr()

    manifest = delivery_manifest(repo)
    assert manifest["mode"] == "live"
    assert manifest["result"]["branch"] in git_run(
        repo, "ls-remote", "--heads", str(origin)
    )


def test_the_flag_is_never_written_into_the_bundle(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """If the authorisation were recorded anywhere on disk, the next reader of
    that file would be a file carrying a typed flag."""
    setup(repo, git_run, tmp_path_factory)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml", "--send"])
    capsys.readouterr()

    directory = only_graph(repo)
    for name in (
        graph.EVENTS_FILENAME,
        graph.MANIFEST_FILENAME,
        graph.STATE_FILENAME,
        graph.RESOLVED_FILENAME,
    ):
        body = (directory / name).read_text(encoding="utf-8")
        assert "--send" not in body, f"{name} records the flag: {body}"
        assert '"send"' not in body, f"{name} records the flag: {body}"


def test_one_typed_send_authorises_one_deliver_node(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """"Once" is part of the ruling. `deliver.send` is spied on rather than
    faked away at the planning layer, so the second node still plans for real
    — it simply is not authorised."""
    twice = SHIP.replace(
        "  send-it:\n    kind: deliver\n    then: done\n",
        "  send-it:\n    kind: deliver\n    then: send-again\n"
        "  send-again:\n    kind: deliver\n    then: done\n",
    )
    setup(repo, git_run, tmp_path_factory, body=twice)
    monkeypatch.chdir(repo)

    calls: list[str] = []
    monkeypatch.setattr(
        deliver,
        "send",
        lambda root, bundle, planned, push=True: calls.append(planned.branch)
        or {"branch": planned.branch, "commit": "0" * 40, "pushed": True},
    )
    assert cli.main(["graph", "run", "graph.yaml", "--send"]) == cli.EXIT_OK
    capsys.readouterr()

    assert len(calls) == 1, f"one typed --send authorised {len(calls)} deliveries"
    statuses = {
        e["node_id"]: e["status"]
        for e in events(only_graph(repo))
        if e["type"] == "node.finished" and e["node_id"].startswith("send-")
    }
    assert statuses == {"send-it": "live", "send-again": "dry_run"}, statuses


# --- which bundle a deliver node ships -------------------------------------


def test_the_deliver_node_ships_the_loops_final_run_not_the_newest_on_disk(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """Decided rather than guessed at runtime: a deliver node ships the run
    bundle THIS graph's loop node recorded — `loop.ref.json` → that loop's
    `result.final_run` — not whatever directory under `.wringer/runs/` happens
    to sort last. A `wring verify` typed by hand while a graph is parked must
    not change what the graph delivers."""
    setup(repo, git_run, tmp_path_factory, body=PAUSED)
    monkeypatch.chdir(repo)

    assert cli.main(["graph", "run", "graph.yaml"]) == cli.EXIT_NEEDS_HUMAN
    directory = only_graph(repo)
    capsys.readouterr()

    reference = json.loads(
        (directory / graph.NODES_DIRNAME / "build" / "loop.ref.json").read_text("utf-8")
    )
    loop_manifest = json.loads(
        (repo / reference["loop_dir"] / "manifest.json").read_text(encoding="utf-8")
    )
    expected = Path(loop_manifest["result"]["final_run"]).name

    # A decoy that sorts after every real run: an empty directory is enough,
    # because delivering it could not possibly work.
    decoy = repo / ".wringer" / "runs" / "9999-12-31T235959Z-decoy"
    decoy.mkdir(parents=True)

    decision(directory).write_text(APPROVED, encoding="utf-8")
    assert cli.main(["graph", "resume", str(directory)]) == cli.EXIT_OK
    capsys.readouterr()

    assert Path(delivery_manifest(repo)["run_dir"]).name == expected


def test_a_deliver_node_with_no_loop_upstream_says_so(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """No loop node ran, so there is no verified bundle this graph produced.

    A passing run bundle is left on disk first, from a `wring verify` typed by
    hand — exactly what a fallback to `evidence.latest_run` would reach for,
    and exactly what this graph has no business delivering. Without that
    setup the test passes against the fallback too, because there would be
    nothing on disk for the fallback to find.
    """
    body = """\
version: 1
id: bare
budgets:
  wall_clock: 600
nodes:
  send-it:
    kind: deliver
    then: done
"""
    setup(repo, git_run, tmp_path_factory, body=body)
    monkeypatch.chdir(repo)
    (repo / "calc.py").write_text("FIXED\n", encoding="utf-8")
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    code = cli.main(["graph", "run", "graph.yaml"])
    printed = capsys.readouterr()

    assert code == cli.EXIT_GATE_FAILED
    said = flat(printed.out) + " " + flat(printed.err)
    assert "loop" in said, said
    assert not deliveries(repo), "a graph delivered a run it did not produce"


def test_the_delivery_bundle_is_referenced_never_nested(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """One run, one bundle, one place — the same ruling the loop node obeys."""
    setup(repo, git_run, tmp_path_factory)
    monkeypatch.chdir(repo)
    cli.main(["graph", "run", "graph.yaml"])
    capsys.readouterr()

    directory = only_graph(repo)
    node = directory / graph.NODES_DIRNAME / "send-it"
    reference = json.loads((node / "deliver.ref.json").read_text(encoding="utf-8"))

    assert reference["delivery_dir"].startswith(".wringer/deliveries/")
    assert (repo / reference["delivery_dir"]).is_dir()
    assert not (node / deliver.PATCH_FILENAME).exists(), "the bundle was nested"

    finished = next(
        e for e in events(directory)
        if e["type"] == "node.finished" and e["node_id"] == "send-it"
    )
    assert finished["ref"] == reference["delivery_dir"]


# --- the traps -------------------------------------------------------------


def test_a_redactable_value_in_the_diff_does_not_block_a_graphs_delivery(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """`deliver.plan` compares SCRUBBED to SCRUBBED (`a089bae`). The graph
    must hand it the graph's own redactor — built from
    `declared_secret_names` — or the tree-match refusal fires on any repo with
    a declared credential's value in its diff, permanently and unclearably.

    The variable is deliberately named so that only the DECLARED-name path
    catches it: `*TOKEN*`, `*SECRET*` and `*KEY*` would all match by pattern
    and hide the bug.
    """
    secret = "notarealcredential-in-a-graph-diff-3f0c9a71"
    monkeypatch.setenv("WRINGER_FORGE_PASSPHRASE", secret)
    config = CONFIG.replace(
        "run:\n",
        "forge:\n"
        "  kind: github\n"
        "  endpoint: https://api.github.com\n"
        "  repo: owner/name\n"
        "  token_env: WRINGER_FORGE_PASSPHRASE\n"
        "run:\n",
    )
    setup(repo, git_run, tmp_path_factory, config=config)
    (repo / "fix.sh").write_text(
        f"printf 'FIXED\\nTOKEN = {secret}\\n' > calc.py\n", encoding="utf-8"
    )
    git_run(repo, "add", "-A")
    git_run(repo, "commit", "-qm", "worker writes a credential")
    monkeypatch.chdir(repo)

    code = cli.main(["graph", "run", "graph.yaml"])
    printed = capsys.readouterr()

    assert code == cli.EXIT_OK, (
        "delivery was refused over a tree that never moved: "
        + flat(printed.out) + flat(printed.err)
    )
    written = (deliveries(repo)[0] / deliver.PATCH_FILENAME).read_text("utf-8")
    assert secret not in written


def test_a_refused_delivery_keeps_its_own_exit_code(
    repo, git_run, tmp_path_factory, monkeypatch, capsys
):
    """`deliver.Refused` carries the code the CLI should use: "there is
    nothing to deliver" (1) and "this tree is unsafe" (3) are different
    answers, and flattening them into one graph failure throws away the half
    that says whether the user can do anything about it."""
    setup(repo, git_run, tmp_path_factory)
    # No resolvable default branch — condition 2's refusal, which is a 3.
    git_run(repo, "remote", "remove", "origin")
    git_run(repo, "remote", "add", "origin", "file:///nonexistent/bare.git")
    monkeypatch.chdir(repo)

    code = cli.main(["graph", "run", "graph.yaml"])
    printed = capsys.readouterr()

    assert code == cli.EXIT_REFUSED, (
        f"a refusal that carries exit {cli.EXIT_REFUSED} came back as {code}: "
        + flat(printed.out) + flat(printed.err)
    )
