"""F4 at scale — the scoped loop and the scoped fleet (SPEC_SCOPE_V0.md).

Scripted workers throughout, like `test_run.py`: the contract under test is
what the harness SAYS and what it records, never what an agent is clever
enough to do.

The cycle's one-sentence test — *can the harness's own scoping ever make a
green tick claim more than it measured?* — is pinned here as executable
assertions rather than as prose.
"""

from __future__ import annotations

import json
from pathlib import Path

from conftest import flat

from wringer import cli, config, fleet, loop, verify

# Two gates, and the one this task does NOT own is declared FIRST. That
# ordering is the test: `verify.run` stops at the first required failure, so
# an unscoped run fails on `theirs` and briefs the worker about it. Scoping
# must make `theirs` unrepresentable — not merely later in the list.
TWO_GATES = """\
version: 1
gates:
  - id: theirs
    run: "grep -q FIXED other.py"
  - id: mine
    run: "grep -q FIXED calc.py"
run:
  worker: {worker}
  max_iterations: {max_iterations}
"""

# Writes only the file this task owns. The other gate stays red forever.
FIXES_MINE = "printf 'FIXED\\n' > calc.py"


def write_two_gate_config(
    repo: Path, worker: str = FIXES_MINE, max_iterations: int = 3
) -> None:
    (repo / ".wringer.yaml").write_text(
        TWO_GATES.format(worker=json.dumps(worker), max_iterations=max_iterations),
        encoding="utf-8",
    )
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / "other.py").write_text("BROKEN\n", encoding="utf-8")


def only_loop(repo: Path) -> Path:
    loops = sorted((repo / loop.LOOPS_DIRNAME).iterdir())
    assert len(loops) == 1, loops
    return loops[0]


def briefs(loop_dir: Path) -> list[str]:
    """Every brief this loop handed a worker, in iteration order."""
    return [
        path.read_text(encoding="utf-8")
        for path in sorted(loop_dir.glob(f"iterations/*/{loop.BRIEF_FILENAME}"))
    ]


def final_run(repo: Path, loop_dir: Path) -> Path:
    manifest = json.loads(
        (loop_dir / loop.MANIFEST_FILENAME).read_text(encoding="utf-8")
    )
    return repo / manifest["result"]["final_run"]


# -------------------------------------------------------------- S1: the flag


def test_wring_run_gate_is_repeatable_and_scopes_the_loop(repo, monkeypatch, capsys):
    """The flag as a human at a terminal meets it. The fleet is the intended
    caller, and it makes the same narrower claim in both mouths."""
    write_two_gate_config(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["run", "--gate", "mine"]) == cli.EXIT_OK

    bundle = final_run(repo, only_loop(repo))
    assert sorted(p.name for p in (bundle / "gates").iterdir()) == ["002_mine"]


def test_an_unknown_scoped_gate_stops_the_run_before_any_work(
    repo, monkeypatch, capsys
):
    """Config errors cost nothing when they fire first. A typo'd `--gate`
    must not spawn a worker and then discover the gate does not exist."""
    write_two_gate_config(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["run", "--gate", "mine", "--gate", "nope"]) == cli.EXIT_CONFIG

    assert "no gate 'nope'" in flat(capsys.readouterr().err)
    # Nothing ran: no loop directory at all.
    assert not (repo / loop.LOOPS_DIRNAME).exists()


# ---------------------------------------------------------------- S1: the loop


def test_the_loop_converges_on_its_scoped_gates_while_another_stays_red(repo):
    """THE decisive test (spec DONE box 1, plan S1).

    Two gates, scope to one, and make the OTHER fail. The loop must converge
    on what it was asked to prove, and the brief must never name the gate
    this task does not own — the measured pathology was the harness telling
    an agent to go and fix another task's work, in a shared tree, four at a
    time.
    """
    write_two_gate_config(repo)
    cfg = config.load(repo / ".wringer.yaml")

    outcome = loop.run(repo, cfg, gates=["mine"])

    assert outcome.status == "converged", outcome.reason
    # `other.py` is still BROKEN — the gate this task does not own is red and
    # stayed red, and the loop converged anyway.
    assert "FIXED" not in (repo / "other.py").read_text(encoding="utf-8")

    handed = briefs(only_loop(repo))
    assert handed, "the loop converged without ever briefing a worker"
    for text in handed:
        assert "theirs" not in flat(text), text


def test_a_scoped_out_gate_leaves_no_result_row(repo):
    """Absence is the record, and it is the record that already refuses.

    Not "recorded as skipped": post-failure skips leave no `gates/` directory
    either (spec §6, measured), and acceptance reads that absence as
    `gate-did-not-run`. A scoped-out gate must be indistinguishable from a
    gate that was never asked for, because that is what it is.
    """
    write_two_gate_config(repo)
    cfg = config.load(repo / ".wringer.yaml")

    loop.run(repo, cfg, gates=["mine"])

    bundle = final_run(repo, only_loop(repo))
    ran = sorted(path.name for path in (bundle / "gates").iterdir())
    assert ran == ["002_mine"], ran
    # The declared position survives narrowing (`plan`'s existing promise):
    # evidence lands where a full run would have put it.


def test_the_summary_names_every_scoped_out_gate_and_the_scope_that_excluded_it(repo):
    """Spec DONE box 2, content-pinned.

    Human-readable at the run level, machine-readable at the fleet level,
    absence at the result level — three records, one truth. This is the first.
    """
    write_two_gate_config(repo)
    cfg = config.load(repo / ".wringer.yaml")

    loop.run(repo, cfg, gates=["mine"])

    text = flat((final_run(repo, only_loop(repo)) / "summary.md").read_text("utf-8"))
    assert "## Scoped out" in text
    assert "`theirs`" in text
    # The scope that excluded it, named — a reader must not have to guess
    # whether the gate was skipped, broken, or never asked for.
    assert "this run was scoped to `mine`" in text


def test_an_unscoped_run_says_nothing_about_scope(repo):
    """No `--gate`, no new behaviour. The section is absent rather than
    empty: every repo that never opted in writes the summary it always did."""
    write_two_gate_config(repo, worker="printf 'FIXED\\n' > calc.py other.py")
    cfg = config.load(repo / ".wringer.yaml")

    loop.run(repo, cfg)

    text = (final_run(repo, only_loop(repo)) / "summary.md").read_text("utf-8")
    assert "Scoped out" not in text


def test_scoping_to_an_unknown_gate_is_refused_naming_the_declared_set(repo):
    """`plan` already refused an unknown single `--gate`; the repeatable form
    must refuse the same way rather than silently scoping to nothing."""
    write_two_gate_config(repo)
    cfg = config.load(repo / ".wringer.yaml")

    try:
        verify.plan(cfg, ["mine", "nope"])
    except config.ConfigError as exc:
        message = flat(str(exc))
        # The UNKNOWN id by name, not the whole requested list stringified:
        # a reader must be told which of the ids they typed does not exist.
        assert "no gate 'nope'" in message
        assert "theirs" in message and "mine" in message
    else:
        raise AssertionError("an unknown gate id was accepted")


def test_the_briefs_criteria_list_marks_which_criteria_this_task_owns(repo):
    """Ruling 3: the criteria list marks ownership.

    The join is ruling 1's read backwards — this task's criteria are the ones
    whose bound gate is in the scoped set. A worker that cannot tell its own
    objectives from the fleet's is the F3 defect one level up.
    """
    (repo / ".wringer.yaml").write_text(
        """\
version: 1
gates:
  - id: theirs
    run: "grep -q FIXED other.py"
    proves: c-other
  - id: mine
    run: "grep -q FIXED calc.py"
    proves: c-mine
run:
  worker: "printf 'FIXED\\n' > calc.py"
  max_iterations: 3
""",
        encoding="utf-8",
    )
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / "other.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / "wringer.spec.yaml").write_text(
        """\
schema_version: wringer.spec.v1
title: Two tasks, one tree
intent: A spec with more than one owner.
approved: true
criteria:
  - id: c-other
    title: the other task's criterion
  - id: c-mine
    title: this task's criterion
tasks:
  - id: t-mine
    brief: briefs/t-mine.md
    dir: .
    objective: fix calc.py
""",
        encoding="utf-8",
    )
    (repo / "briefs").mkdir()
    (repo / "briefs" / "t-mine.md").write_text("Make calc.py say FIXED.\n", "utf-8")
    cfg = config.load(repo / ".wringer.yaml")

    loop.run(repo, cfg, gates=["mine"])

    text = flat(briefs(only_loop(repo))[0])
    # Its own criterion is marked as this task's; the other is present and
    # marked as somebody else's. Neither is hidden — a worker that cannot see
    # the whole spec cannot tell when its change breaks a neighbour.
    assert "`c-mine` — this task's criterion — bound to `mine` — THIS TASK" in text
    assert "`c-other` — the other task's criterion — bound to `theirs` — " \
        "another task's" in text


# ------------------------------------------------------------- S2: fleet.scope

SCOPED_GATES = """\
version: 1
gates:
  - id: g-alpha
    run: "grep -q ALPHA alpha.txt"
    proves: c-alpha
  - id: g-beta
    run: "grep -q BETA beta.txt"
    proves: c-beta
{extra_gates}\
fleet:
  deadline: 300
  concurrency: 1
{scope}\
"""

SCOPED_SPEC = """\
schema_version: wringer.spec.v1
title: Two owners, one tree
intent: Two tasks, each proving its own criterion.
approved: {approved}
criteria:
  - id: c-alpha
    title: alpha works
  - id: c-beta
    title: beta works
{extra_criteria}\
tasks:
  - id: t-alpha
    brief: briefs/t-alpha.md
    dir: .
    objective: make alpha work
"""

DEFAULT_SCOPE = """\
  scope:
    t-alpha: [c-alpha]
    t-beta: [c-beta]
"""


def scoped_repo(
    repo: Path,
    scope: str = DEFAULT_SCOPE,
    approved: str = "true",
    extra_gates: str = "",
    extra_criteria: str = "",
) -> config.Config:
    (repo / ".wringer.yaml").write_text(
        SCOPED_GATES.format(scope=scope, extra_gates=extra_gates), encoding="utf-8"
    )
    (repo / "wringer.spec.yaml").write_text(
        SCOPED_SPEC.format(approved=approved, extra_criteria=extra_criteria),
        encoding="utf-8",
    )
    return config.load(repo / ".wringer.yaml")


def two_tasks() -> list:
    return [
        fleet.Task(id="t-alpha", brief="briefs/t-alpha.md", dir="."),
        fleet.Task(id="t-beta", brief="briefs/t-beta.md", dir="."),
    ]


def refusal(repo: Path, tasks: list, **kwargs) -> str:
    """Resolve a scope that must be refused, and return the message flat."""
    cfg = scoped_repo(repo, **kwargs)
    try:
        fleet.resolve_scope(repo, cfg, tasks)
    except fleet.FleetError as exc:
        return flat(str(exc))
    raise AssertionError("the scope was accepted and should not have been")


# --- ruling 5: the map is total, and every refusal names BOTH sides ----------


def test_a_scoped_task_that_is_not_in_the_task_file_is_refused(repo):
    """Refusal 1. Both sides: the id, and the file it is missing from."""
    message = refusal(repo, [two_tasks()[0]])

    assert "t-beta" in message
    assert ".wringer.yaml" in message


def test_a_task_file_task_missing_from_the_scope_map_is_refused(repo):
    """Refusal 2. A fleet where some children are scoped and some run the
    full set would make 'succeeded' mean two things in one summary table."""
    message = refusal(repo, two_tasks(), scope="  scope:\n    t-alpha: [c-alpha]\n")

    assert "t-beta" in message
    assert ".wringer.yaml" in message


def test_an_unknown_criterion_in_the_scope_map_is_refused(repo):
    """Refusal 3."""
    message = refusal(
        repo,
        two_tasks(),
        scope="  scope:\n    t-alpha: [c-alpha]\n    t-beta: [c-nope]\n",
    )

    assert "c-nope" in message
    assert "t-beta" in message
    assert "wringer.spec.yaml" in message


def test_a_criterion_bound_to_no_gate_is_refused(repo):
    """Refusal 4. A criterion nothing proves gives the child nothing to
    converge on, and the human wrote the binding, so the human is told."""
    message = refusal(
        repo,
        two_tasks(),
        scope="  scope:\n    t-alpha: [c-alpha]\n    t-beta: [c-beta, c-loose]\n",
        extra_criteria="  - id: c-loose\n    title: nothing proves this\n",
    )

    assert "c-loose" in message
    assert "t-beta" in message


def test_a_human_criterion_in_the_scope_map_is_refused(repo):
    """Refusal 5. Nothing to run — the category error `check_bindings`
    already refuses one join away."""
    message = refusal(
        repo,
        two_tasks(),
        scope="  scope:\n    t-alpha: [c-alpha]\n    t-beta: [c-beta, c-taste]\n",
        extra_criteria="  - id: c-taste\n    title: it feels right\n    human: true\n",
    )

    assert "c-taste" in message
    assert "t-beta" in message
    assert "human" in message


def test_a_criterion_claimed_by_two_tasks_is_refused(repo):
    """Refusal 6. One criterion, one owner — the `proposals()` collision
    refusal is the precedent and the message shape."""
    message = refusal(
        repo,
        two_tasks(),
        scope="  scope:\n    t-alpha: [c-alpha]\n    t-beta: [c-alpha, c-beta]\n",
    )

    assert "c-alpha" in message
    assert "t-alpha" in message and "t-beta" in message


def test_a_task_with_an_empty_criteria_list_is_refused_with_its_own_remedy(repo):
    """Refusal 7a — review finding 2, folded.

    The only surviving path to 'resolves to zero gates' is an EMPTY list, for
    which 'bind a gate' is advice about a problem the human does not have.
    The message must name the defect they actually made.
    """
    message = refusal(
        repo, two_tasks(), scope="  scope:\n    t-alpha: [c-alpha]\n    t-beta: []\n"
    )

    assert "t-beta" in message
    # Its own remedy, not refusal 4's.
    assert "drop it from the map and from the task file" in message
    assert "bind a gate" not in message


def test_a_criterion_listed_twice_in_one_task_is_refused(repo):
    """Review finding 3, folded. Harmless to the resolution — a set absorbs
    it — and refused anyway, because every other duplicate in this repo is
    loud and a silent one here would be the exception a reader has to learn."""
    message = refusal(
        repo,
        two_tasks(),
        scope="  scope:\n    t-alpha: [c-alpha]\n    t-beta: [c-beta, c-beta]\n",
    )

    assert "c-beta" in message
    assert "t-beta" in message


def test_scope_against_an_unapproved_spec_is_refused(repo):
    """Refusal 8 — review finding 1 (HIGH), the one that keeps the whole
    cycle's guarantee unconditional.

    `accept.assess` returns None unless the spec is approved, so a scoped
    fleet in an unapproved repo writes NO `acceptance.json` — and then there
    is nothing for `wring deliver` to refuse on. Measured by R0 on shipped
    code: with `approved: false` delivery proceeded to "Would create branch"
    on a bundle in which a required gate had never run.
    """
    message = refusal(repo, two_tasks(), approved="false")

    assert "wringer.spec.yaml" in message
    assert "fleet.scope" in message
    # The remedy is that a person approves the spec.
    assert "approved: true" in message


def test_the_refusals_fire_before_any_child_spawns(repo, monkeypatch, capsys):
    """Ruling 5: hard errors at `wring fleet` start. A fleet that spawned
    four children and then discovered its map was wrong has already spent
    somebody's money."""
    scoped_repo(repo, scope="  scope:\n    t-alpha: [c-alpha]\n")
    (repo / "briefs").mkdir(exist_ok=True)
    (repo / "briefs" / "t-alpha.md").write_text("go\n", encoding="utf-8")
    (repo / "briefs" / "t-beta.md").write_text("go\n", encoding="utf-8")
    (repo / "tasks.jsonl").write_text(
        "\n".join(
            json.dumps({"id": t.id, "brief": t.brief, "dir": t.dir})
            for t in two_tasks()
        )
        + "\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["fleet", "tasks.jsonl"]) == cli.EXIT_CONFIG

    assert "t-beta" in flat(capsys.readouterr().err)
    # No fleet bundle: it stopped before it started.
    assert not (repo / ".wringer" / "fleets").exists()


# --- the resolution, and what it records -------------------------------------


def test_scope_resolves_criteria_to_gates_through_the_shipped_bindings(repo):
    """Ruling 1: the map's values are CRITERIA, and the gate is reached
    through the `proves:` binding the human already installed. One join,
    declared twice nowhere."""
    cfg = scoped_repo(repo)

    resolved = fleet.resolve_scope(repo, cfg, two_tasks())

    assert resolved is not None
    assert resolved.gates_for("t-alpha") == ("g-alpha",)
    assert resolved.gates_for("t-beta") == ("g-beta",)


def test_a_criterion_no_task_claimed_is_legal_and_loud(repo):
    """Ruling 5's last sentence: legal, and it lands in the unclaimed list.
    Its gate goes red in the final verify if nobody built it, and acceptance
    refuses delivery exactly as today."""
    cfg = scoped_repo(
        repo,
        extra_gates='  - id: g-extra\n    run: "true"\n    proves: c-extra\n',
        extra_criteria="  - id: c-extra\n    title: nobody owns this\n",
    )

    resolved = fleet.resolve_scope(repo, cfg, two_tasks())

    assert resolved is not None
    assert resolved.unclaimed == ("c-extra",)


def test_an_undeclared_scope_leaves_the_fleet_exactly_as_it_was(repo):
    """No `fleet.scope`, no resolution and no new behaviour — the unscoped
    fleets this cycle must not move."""
    cfg = scoped_repo(repo, scope="")

    assert fleet.resolve_scope(repo, cfg, two_tasks()) is None


# --- the dispatch, and scope.json --------------------------------------------

SHARED_TREE_FLEET = """\
version: 1
gates:
  - id: g-alpha
    run: "grep -q ALPHA alpha.txt"
    proves: c-alpha
  - id: g-beta
    run: "grep -q BETA beta.txt"
    proves: c-beta
run:
  worker: "sh worker.sh"
  max_iterations: 3
  worker_timeout: 60
fleet:
  deadline: 300
  concurrency: 1
  progress_window: 120
  scope:
    t-alpha: [c-alpha]
    t-beta: [c-beta]
"""


def shared_tree_fleet(repo: Path) -> config.Config:
    """One tree, two tasks, each owning one gate — the shape the cycle is for."""
    (repo / ".wringer.yaml").write_text(SHARED_TREE_FLEET, encoding="utf-8")
    (repo / "wringer.spec.yaml").write_text(
        SCOPED_SPEC.format(approved="true", extra_criteria=""), encoding="utf-8"
    )
    # Each child edits only the file its own gate reads. Which one it is
    # comes from WRINGER_TASK_ID, the variable the fleet already sets.
    (repo / "worker.sh").write_text(
        'if [ "$WRINGER_TASK_ID" = t-alpha ]; then\n'
        "  printf 'ALPHA\\n' > alpha.txt\n"
        "else\n"
        "  printf 'BETA\\n' > beta.txt\n"
        "fi\n",
        encoding="utf-8",
    )
    (repo / "alpha.txt").write_text("BROKEN\n", encoding="utf-8")
    (repo / "beta.txt").write_text("BROKEN\n", encoding="utf-8")
    (repo / "briefs").mkdir(exist_ok=True)
    for task_id in ("t-alpha", "t-beta"):
        (repo / "briefs" / f"{task_id}.md").write_text("go\n", encoding="utf-8")
    (repo / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    return config.load(repo / ".wringer.yaml")


def test_a_scoped_fleet_dispatches_each_child_onto_its_own_gates(repo):
    """The whole point, end to end through real child processes.

    Measured pathology (dossier §3a–3b): unscoped, every child runs the WHOLE
    gate set, so all but the last fail their first pass and the retry queue
    harvests the work. Scoped, each child converges on its own gate the first
    time — and `t-alpha` never once fails on `g-beta`.
    """
    cfg = shared_tree_fleet(repo)
    tasks = two_tasks()

    outcome = fleet.run(repo, cfg, tasks)

    assert (outcome.succeeded, outcome.failed, outcome.parked) == (2, 0, 0)
    # Each child converged on the FIRST attempt: no retry-harvest needed,
    # because no child was ever blocked on the other's gate.
    manifest = json.loads(
        (outcome.directory / fleet.MANIFEST_FILENAME).read_text(encoding="utf-8")
    )
    assert [t["attempts"] for t in manifest["tasks"]] == [1, 1]


def test_scope_json_records_the_joins_the_unclaimed_and_the_declared_set(repo):
    """`wringer.fleetscope.v1` — machine-readable at the fleet level.

    Review finding 10, folded: `declared_gates` is here so a reader computes
    each task's EXCLUDED gates from this file ALONE, rather than fetching
    `.wringer.yaml` at that commit. The schema is frozen the moment it is
    published, so a field missing today is missing forever.
    """
    cfg = shared_tree_fleet(repo)

    outcome = fleet.run(repo, cfg, two_tasks())

    written = json.loads(
        (outcome.directory / fleet.SCOPE_FILENAME).read_text(encoding="utf-8")
    )
    assert written["schema_version"] == "wringer.fleetscope.v1"
    assert written["declared_gates"] == ["g-alpha", "g-beta"]
    assert written["tasks"] == [
        {"task": "t-alpha", "criteria": ["c-alpha"], "gates": ["g-alpha"]},
        {"task": "t-beta", "criteria": ["c-beta"], "gates": ["g-beta"]},
    ]
    assert written["unclaimed_criteria"] == []
    # The point of `declared_gates`: excluded is computable from this file.
    excluded = set(written["declared_gates"]) - set(written["tasks"][0]["gates"])
    assert excluded == {"g-beta"}


# --- the guard pin: DONE box 3, the spec's one-sentence test ------------------


def test_a_scoped_child_bundle_can_never_evidence_an_unscoped_criterion(repo):
    """**Can the harness's own scoping ever make a green tick claim more than
    it measured?** It cannot, and this is that sentence as a unit test.

    Criterion `c-beta` is bound to `g-beta`; the child is scoped away from
    it; `g-beta` therefore leaves no result, and acceptance must read that
    absence as `gate-did-not-run` with `refuses` true — the shipped guard,
    pinned against scope BY NAME. It pins behaviour that already ships (R0
    measured it through `wring verify --gate`); the box stays because it is
    what stops a later slice loosening the guard once scope has a reason to
    want it loosened.
    """
    cfg = shared_tree_fleet(repo)
    # Both gates would pass if both ran — so nothing but the SCOPE keeps
    # `c-beta` from being claimed, which is exactly what is under test.
    (repo / "alpha.txt").write_text("ALPHA\n", encoding="utf-8")
    (repo / "beta.txt").write_text("BETA\n", encoding="utf-8")

    outcome = verify.run(repo, cfg, verify.plan(cfg, ["g-alpha"]))

    assert outcome.status == "passed"
    acceptance = json.loads(
        (outcome.bundle.directory / "acceptance.json").read_text(encoding="utf-8")
    )
    rows = {row["criterion"]: row for row in acceptance["criteria"]}
    assert rows["c-beta"]["state"] == "gate-did-not-run"
    assert rows["c-beta"]["refuses"] is True
    # And the run that DID happen claims only what it measured.
    assert rows["c-alpha"]["state"] != "gate-did-not-run"


def test_a_real_scope_json_validates_against_its_published_schema(repo):
    """`wringer.fleetscope.v1` is frozen the moment it is published, so the
    document a real fleet writes must match it on the same commit — a
    schema nothing produces is a promise nobody kept."""
    from jsonschema import Draft202012Validator

    schema_path = (
        Path(__file__).resolve().parent.parent / "schema" / "fleetscope.schema.json"
    )
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)

    cfg = shared_tree_fleet(repo)
    outcome = fleet.run(repo, cfg, two_tasks())
    written = json.loads(
        (outcome.directory / fleet.SCOPE_FILENAME).read_text(encoding="utf-8")
    )

    errors = [
        f"{e.json_path} {e.message}"
        for e in Draft202012Validator(schema).iter_errors(written)
    ]
    assert not errors, "\n".join(errors)


# ----------------------------------------------------------- S3: the honesty
#
# Three claims a fleet summary makes that were not true, and one guard on the
# fix. None of them is scope-specific; all three are the same defect class —
# a document pointing at evidence that is not there, or explaining a failure
# it will not explain.

WORKTREE_FLEET = """\
version: 1
gates:
  - id: t-gate
    run: "grep -q FIXED work.txt"
run:
  worker: "sh worker.sh"
  max_iterations: 2
  worker_timeout: 60
fleet:
  concurrency: 1
  deadline: 300
  progress_window: 120
  retries: 0
  worktree: true
"""


def worktree_repo(repo: Path) -> config.Config:
    """One repo, two tasks, `worktree: true` — the mode ruling 8 is about.

    `t-good` converges; `t-bad`'s worker leaves the gate red, so it parks.
    Both get a worktree, both write a loop bundle inside it, and both trees
    are removed at teardown — which is where the evidence used to go.
    """
    import subprocess

    (repo / ".wringer.yaml").write_text(WORKTREE_FLEET, encoding="utf-8")
    (repo / "work.txt").write_text("BROKEN\n", encoding="utf-8")
    (repo / "worker.sh").write_text(
        'if [ "$WRINGER_TASK_ID" = t-good ]; then\n'
        "  printf 'FIXED\\n' > work.txt\n"
        "fi\n",
        encoding="utf-8",
    )
    (repo / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    (repo / "briefs").mkdir(exist_ok=True)
    for task_id in ("t-good", "t-bad"):
        (repo / "briefs" / f"{task_id}.md").write_text("go\n", encoding="utf-8")
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "base"], cwd=repo, check=True)
    return config.load(repo / ".wringer.yaml")


def worktree_tasks() -> list:
    return [
        fleet.Task(id=task_id, brief=f"briefs/{task_id}.md", dir=".")
        for task_id in ("t-good", "t-bad")
    ]


def fleet_summary(outcome) -> str:
    return flat(
        (outcome.directory / fleet.SUMMARY_FILENAME).read_text(encoding="utf-8")
    )


def fleet_manifest(outcome) -> dict:
    return json.loads(
        (outcome.directory / fleet.MANIFEST_FILENAME).read_text(encoding="utf-8")
    )


def test_worktree_teardown_keeps_the_evidence_its_summary_cites(repo):
    """Ruling 8, and the dossier's §3d measured it lying.

    `git worktree remove --force` discards untracked files, and a child's
    whole loop bundle is untracked, so every loop directory the summary
    points at went with the tree. The copy happens BEFORE the removal, and
    the pin is not the copy call — it is that every loop the manifest names
    is really on disk, which is the reader's actual question.
    """
    cfg = worktree_repo(repo)

    outcome = fleet.run(repo, cfg, worktree_tasks())

    named = [
        (task["id"], loop_id)
        for task in fleet_manifest(outcome)["tasks"]
        for loop_id in task["loops"]
    ]
    assert len(named) == 2, named
    # The trees really are gone — the claim is about what SURVIVED them.
    assert not (repo / fleet.WORKTREES_DIRNAME / "t-good").exists()
    missing = [
        (task_id, loop_id)
        for task_id, loop_id in named
        if not (outcome.directory / fleet.PRESERVED_DIRNAME / task_id / loop_id
                ).is_dir()
    ]
    assert not missing, f"the summary cites evidence that is not there: {missing}"


def test_the_preserved_copies_are_never_a_discovery_root(repo):
    """R0 finding 5 — preserving evidence must not PROMOTE it.

    `health.Bundle.bench_sourced` is decided by POSITION: a bundle under
    `.wringer/worktrees/` is excluded from the receipt economy. A copy under
    `.wringer/fleets/` is out from under that marker and reads `False`, so
    the only thing keeping deliberately-excluded runs from arming acceptance
    receipts is that `.wringer/fleets` is not a discovery root. That is a
    guard nothing pinned, one `wring health --from` away from being lost.
    """
    from wringer import health

    cfg = worktree_repo(repo)
    outcome = fleet.run(repo, cfg, worktree_tasks())
    preserved = outcome.directory / fleet.PRESERVED_DIRNAME
    assert preserved.is_dir(), "nothing was preserved, so nothing is pinned"

    assert (repo / fleet.FLEETS_DIRNAME) not in health.search_roots(repo)
    found = [
        bundle.receipt
        for bundle in health.discover(repo).read
        if fleet.FLEETS_DIRNAME.as_posix() in bundle.directory.as_posix()
    ]
    assert not found, (
        f"health discovered {found} inside the fleet bundle — preserved "
        "copies are for a human to read and decide nothing"
    )


def test_the_summary_says_where_the_preserved_copies_are_and_what_they_are_not(
    repo,
):
    """A reader who finds them must learn both halves in the same paragraph:
    where they came from, and that nothing reads them."""
    cfg = worktree_repo(repo)

    outcome = fleet.run(repo, cfg, worktree_tasks())

    summary = fleet_summary(outcome)
    assert "before each worktree was removed" in summary
    assert "for a human to read" in summary
    assert "`loops/t-bad/" in summary


def test_an_unscoped_multi_task_fleet_says_a_failure_may_be_another_tasks_gate(
    repo,
):
    """Dossier §3b: every child runs the WHOLE gate set, so in a multi-task
    fleet all but the last task fail their first pass — blocked by work that
    does not exist yet — and the retry queue converts them. The summary
    reported those as plain failures and an operator had no way to know.
    """
    cfg = shared_tree_fleet(repo)
    unscoped = config.parse(
        {
            "version": 1,
            "gates": [
                {"id": "g-alpha", "run": "grep -q ALPHA alpha.txt"},
                {"id": "g-beta", "run": "grep -q BETA beta.txt"},
            ],
            "run": {"worker": "sh worker.sh", "max_iterations": 2},
            "fleet": {"deadline": 300, "concurrency": 1, "retries": 0},
        },
        source=str(repo / ".wringer.yaml"),
    )
    assert cfg.fleet is not None  # the scoped one, kept only for its tree

    outcome = fleet.run(repo, unscoped, two_tasks())

    assert outcome.succeeded < 2, "nothing was blocked, so nothing to explain"
    assert "blocked by a gate another task will build" in fleet_summary(outcome)


def test_a_scoped_fleet_does_not_blame_another_task(repo):
    """The sentence explains the pathology scoping REMOVES. Printing it in a
    scoped fleet would teach a reader to discount a real failure."""
    cfg = shared_tree_fleet(repo)

    outcome = fleet.run(repo, cfg, two_tasks())

    assert "another task will build" not in fleet_summary(outcome)


def test_a_one_task_fleet_never_blames_another_task(repo):
    """There is no other task. Derived from the task count, not from a flag."""
    cfg = shared_tree_fleet(repo)
    solo = config.parse(
        {
            "version": 1,
            "gates": [{"id": "g-alpha", "run": "grep -q ALPHA alpha.txt"}],
            "run": {"worker": "false", "max_iterations": 1},
            "fleet": {"deadline": 300, "concurrency": 1, "retries": 0},
        },
        source=str(repo / ".wringer.yaml"),
    )
    assert cfg.fleet is not None

    outcome = fleet.run(repo, solo, [two_tasks()[0]])

    assert outcome.succeeded == 0
    assert "another task will build" not in fleet_summary(outcome)


def test_a_parked_task_that_left_no_loop_directory_is_not_claimed_to_have_one(
    repo,
):
    """The same defect ruling 8 fixes, one step earlier: a child that dies
    before its loop bundle exists leaves NOTHING, and the summary pointed a
    reader at child loop directories anyway.

    Found while measuring `fleet.scope` against tasks in separate repos —
    there the child exits 2 on an unknown `--gate` id, writes no loop bundle,
    and the summary reads `unknown (attempts exhausted)` beside a promise of
    evidence that was never written. A missing task directory reaches the
    same state in one line.
    """
    shared_tree_fleet(repo)
    cfg = config.parse(
        {
            "version": 1,
            "gates": [{"id": "g-alpha", "run": "true"}],
            "run": {"worker": "true", "max_iterations": 1},
            "fleet": {"deadline": 300, "concurrency": 1, "retries": 0},
        },
        source=str(repo / ".wringer.yaml"),
    )

    outcome = fleet.run(
        repo, cfg, [fleet.Task(id="t-gone", brief="briefs/t-alpha.md", dir="nope")]
    )

    assert outcome.parked == 1
    summary = fleet_summary(outcome)
    assert "left no child loop directory" in summary
    assert "in the child loop directories" not in summary
