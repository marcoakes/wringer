"""Environment stops — SPEC_ENV_V0 (F6), as amended 2026-08-17.

Two tiers, and every test here belongs to exactly one of them:

- the **fact tier**, `diagnose.stops_the_loop` — four legs, all facts, and each
  leg has a test in BOTH directions because the expensive failure is a stop
  that refuses a repair the loop exists to deliver;
- the **hint tier**, `diagnose.face_of` — a guess read out of text, labelled a
  guess wherever it is shown, routing nothing.

**The counterweight is not optional.** The rail's own probe
(`scripts/roadmap_render.py`'s F6 node) names
`test_a_loop_does_not_brief_a_worker_against_a_broken_environment`, a name only
the fact tier can honestly satisfy — and the way to satisfy it dishonestly is
to widen the stop until the missing-module case stops too. So the
missing-module counterweight sits beside it and pins that a worker IS still
briefed and the loop still ends `no_progress`. If a future change makes the
probe pass by widening, the counterweight reddens.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from wringer import config, diagnose, gates, graph, health, loop, vacuity

SRC = Path(gates.__file__).parent


def result(
    tmp_path: Path,
    *,
    run: str = "pytest -q",
    exit_code: int = 127,
    stderr: str = "",
    stdout: str = "",
    proves: str | None = None,
    timed_out: bool = False,
) -> gates.GateResult:
    """A `GateResult` over real files, because both readers read files."""
    out = tmp_path / f"{exit_code}-{abs(hash((run, stderr, stdout)))}.out"
    err = out.with_suffix(".err")
    out.write_text(stdout, encoding="utf-8")
    err.write_text(stderr, encoding="utf-8")
    return gates.GateResult(
        gate=config.Gate(id="g", run=run, proves=proves),
        exit_code=exit_code,
        duration_ms=1,
        timed_out=timed_out,
        stdout_path=out,
        stderr_path=err,
    )


# --- one fact, one definition ---------------------------------------------


def test_command_not_found_has_one_definition_site():
    """E1's half that was ALREADY discharged, guarded so it stays that way.

    SPEC_ENV's DONE box asked for this and the tree already had it —
    `gates.COMMAND_NOT_FOUND`, re-exported by `health`. The guard is written to
    say so out loud rather than to imply this cycle did the work: a test that
    takes credit for a previous cycle's fix is how a DONE box stops meaning
    anything.
    """
    assigners = []
    for path in sorted(SRC.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Assign):
                continue
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "COMMAND_NOT_FOUND":
                    # A re-export (`X = gates.X`) is not a definition.
                    if isinstance(node.value, ast.Constant):
                        assigners.append(f"{path.name}:{node.lineno}")
    # **The FILE, not the line.** This pinned `gates.py:49` until 2026-08-17,
    # when adding one import to `gates.py` moved the constant down two lines
    # and reddened a guard about something else entirely. A line number in an
    # assertion is a claim that goes stale on every edit above it — the same
    # drift this window corrected in `SPEC_BOARD_V0.md`'s citations hours
    # earlier, arrived at from the other side.
    assert [name.split(":")[0] for name in assigners] == ["gates.py"], (
        f"127 must have exactly one literal definition site; found {assigners}"
    )
    assert health.COMMAND_NOT_FOUND is gates.COMMAND_NOT_FOUND
    assert gates.COMMAND_NOT_FOUND == 127


def test_face_detection_has_one_definition_and_the_cli_calls_it():
    """One detector, two callers — the gategen-ruling-6 shape.

    The knowledge lived behind exactly one door (`wring start`) while the loop,
    which needed it most, re-guessed for itself. This guard reddens if a second
    detector appears: any module other than `diagnose` that tests output text
    for one of the face tells is re-implementing the thing.
    """
    tells = ("command not found", "No module named", "Permission denied")
    offenders = []
    for path in sorted(SRC.glob("*.py")):
        if path.name == "diagnose.py":
            continue
        text = path.read_text(encoding="utf-8")
        tree = ast.parse(text)
        for node in ast.walk(tree):
            # Only STRING LITERALS in executable positions count. Prose in a
            # docstring may name a tell — and does, on purpose, because a
            # comment that cannot spell the thing it explains is no use.
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                if node.value in tells:
                    offenders.append(f"{path.name}:{node.lineno} {node.value!r}")
    assert offenders == [], (
        "face detection must have ONE definition (diagnose.py). A second "
        f"detector appeared at: {offenders}"
    )
    # And the second caller really does call it.
    cli_src = (SRC / "cli.py").read_text(encoding="utf-8")
    assert "diagnose_mod.face_of(failure)" in cli_src


def test_the_evidence_line_has_one_extractor():
    """`vacuity._cite` was hoisted to `gates.cite` rather than copied.

    Two extractors answering "why did this gate fail" is how two subtly
    different answers to one question ship. The re-export keeps vacuity's own
    documented name pointing at the real thing.
    """
    assert vacuity._cite is gates.cite
    assert vacuity._lines is gates.informative_lines
    defs = []
    for path in sorted(SRC.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name in ("cite", "_cite"):
                defs.append(f"{path.name}:{node.lineno}")
    assert len(defs) == 1, f"one extractor, found {defs}"


# --- the hint tier ---------------------------------------------------------


@pytest.mark.parametrize(
    "kwargs,expected",
    [
        ({"exit_code": 127}, diagnose.FACE_COMMAND_NOT_FOUND),
        ({"exit_code": 126}, diagnose.FACE_NOT_EXECUTABLE),
        (
            {"exit_code": 1, "stderr": "sh: yourtool: command not found"},
            diagnose.FACE_COMMAND_NOT_FOUND,
        ),
        (
            {"exit_code": 1, "stderr": "ModuleNotFoundError: No module named 'pytest'"},
            diagnose.FACE_MISSING_MODULE,
        ),
        (
            {"exit_code": 1, "stderr": "bash: ./x.sh: Permission denied"},
            diagnose.FACE_NOT_EXECUTABLE,
        ),
        ({"exit_code": 1, "stderr": "AssertionError: 2 != 3"}, None),
        ({"exit_code": 0}, None),
    ],
)
def test_the_three_faces_and_the_absence_of_one(tmp_path, kwargs, expected):
    assert diagnose.face_of(result(tmp_path, **kwargs)) is expected


def test_a_timeout_is_never_a_face(tmp_path):
    """SPEC_ENV: "Timeouts are untouched everywhere." A gate that ran for its
    whole budget RAN, so nothing about the environment is implied — and a
    timed-out gate can carry any exit code at all."""
    assert diagnose.face_of(
        result(tmp_path, exit_code=127, timed_out=True)
    ) is None
    assert diagnose.stops_the_loop(
        result(tmp_path, exit_code=127, timed_out=True), pre_worker=True
    ) is False


def test_the_diagnosis_quotes_the_same_line_vacuity_would(tmp_path):
    """One gate, two records, one sentence about it."""
    failing = result(
        tmp_path,
        exit_code=1,
        stderr="Traceback (most recent call last):\n"
        "==========\n"
        "ModuleNotFoundError: No module named 'pytest'",
    )
    found = diagnose.diagnose(failing)
    assert found is not None
    assert found.face == diagnose.FACE_MISSING_MODULE
    assert found.gate == "g"
    # The LAST informative line, not the first: the first is the traceback
    # header, which is true and no use.
    assert found.evidence == "ModuleNotFoundError: No module named 'pytest'"
    assert found.evidence == gates.cite(failing)
    assert found.as_json()["face"] == diagnose.FACE_MISSING_MODULE


def test_every_face_has_a_description():
    """Both directions: a face with no sentence, or a sentence with no face."""
    assert set(diagnose.DESCRIPTIONS) == set(diagnose.FACES)


# --- the fact tier, one test per leg, both directions ----------------------


def test_leg_1_a_127_after_a_worker_has_acted_does_not_stop(tmp_path):
    """A worker can break a tracked script's interpreter, and can revert it.
    The one-sentence test forbids stopping a failure a worker could repair."""
    failing = result(tmp_path, exit_code=127)
    assert diagnose.stops_the_loop(failing, pre_worker=True) is True
    assert diagnose.stops_the_loop(failing, pre_worker=False) is False


def test_leg_2_only_exit_127_stops(tmp_path):
    """126 is hint-only: a worker can `chmod +x` a tracked script."""
    assert diagnose.stops_the_loop(
        result(tmp_path, exit_code=126, run="thing"), pre_worker=True
    ) is False
    assert diagnose.stops_the_loop(
        result(tmp_path, exit_code=1, stderr="command not found"), pre_worker=True
    ) is False, "text must never route — that is the whole design"


def test_leg_3_an_armed_red_gate_invoking_its_deliverable_by_path_does_not_stop(
    tmp_path,
):
    """**Finding D1.** `./bin/tool --selftest`, red at baseline because the
    deliverable does not exist yet, IS gategen's armed-red gate. A worker
    creating `./bin/tool` is the repair the loop exists for, and a stop tier
    keyed on bare 127 would refuse it."""
    assert diagnose.stops_the_loop(
        result(tmp_path, run="./bin/tool --selftest", exit_code=127), pre_worker=True
    ) is False
    assert diagnose.stops_the_loop(
        result(tmp_path, run="bin/tool --selftest", exit_code=127), pre_worker=True
    ) is False
    assert diagnose.stops_the_loop(
        result(tmp_path, run="tool --selftest", exit_code=127), pre_worker=True
    ) is True


def test_leg_4_a_gate_bound_to_a_criterion_never_stops_as_environment(tmp_path):
    """**The fourth leg, added 2026-08-17 — D1's residual.**

    Leg 3 catches the armed-red gate that invokes its deliverable BY PATH. It
    does not catch the one that invokes it by a PATH-resolved name — a gate of
    `mytool --selftest` proving `criterion-3`, where `mytool` is the thing
    being built. That is still born-red on purpose, and stopping it as
    "environment" refuses the whole red-first seam.

    A config fact, not a text guess.
    """
    bound = result(tmp_path, run="mytool --selftest", exit_code=127, proves="c-3")
    unbound = result(tmp_path, run="mytool --selftest", exit_code=127)
    assert diagnose.stops_the_loop(bound, pre_worker=True) is False
    assert diagnose.stops_the_loop(unbound, pre_worker=True) is True


@pytest.mark.parametrize(
    "run,expected",
    [
        ("pytest -q", "pytest"),
        ("FOO=1 pytest -q", "pytest"),
        ("FOO=1 BAR=2 ./x.sh", "./x.sh"),
        ("PATH=/usr/bin:$PATH tool", "tool"),
        ("", ""),
    ],
)
def test_the_first_word_skips_assignment_prefixes(run, expected):
    """Shell resolution semantics, which is why this is a fact and not a
    guess. `FOO=1 pytest` resolves `pytest`."""
    assert diagnose.first_command_word(run) == expected


# --- the vocabulary --------------------------------------------------------


def test_environment_is_a_loop_reason_everywhere_or_nowhere():
    """`graph.LOOP_REASONS` is the drift guard, and it is what FORCES the
    other two to move. Set equality in both directions, as the existing
    agreement test already does for the other eight."""
    assert loop.ENVIRONMENT == "environment"
    assert loop.ENVIRONMENT in graph.LOOP_REASONS
    assert loop.ENVIRONMENT in loop._REASONS
    assert len(graph.LOOP_REASONS) == 9


# --- end to end: the rail's probe, and the counterweight that guards it -----

BROKEN_ENV = """\
version: 1
gates:
  - id: unit
    run: "wringer-no-such-tool-{tag} --check"
run:
  worker: {worker}
  max_iterations: 3
"""

MISSING_MODULE_CFG = """\
version: 1
gates:
  - id: unit
    run: "python3 -c 'import wringer_no_such_module_xyz'"
run:
  worker: {worker}
  max_iterations: 2
"""

# A worker that touches the tree, so `no_progress` can only be reached by the
# worker genuinely leaving it byte-identical — not by this script doing nothing.
NOISY_WORKER = "printf 'lap\\n' >> worker-ran.txt"


def only_loop(repo):
    loops = sorted((repo / loop.LOOPS_DIRNAME).iterdir())
    assert len(loops) == 1, loops
    return loops[0]


def briefs(loop_dir):
    return sorted(loop_dir.glob(f"iterations/*/{loop.BRIEF_FILENAME}"))


def manifest_of(loop_dir):
    import json

    return json.loads(
        (loop_dir / loop.MANIFEST_FILENAME).read_text(encoding="utf-8")
    )


def test_a_loop_does_not_brief_a_worker_against_a_broken_environment(repo):
    """**The rail's own pre-declared probe** (`scripts/roadmap_render.py`, F6).

    A scratch repo whose gate's PATH-resolved command does not exist. The loop
    stops with reason `environment`, one iteration, and — the assertion the
    whole cycle is for — **zero briefs**. F6 measured the opposite: a worker
    briefed to repair a condition no tree edit can affect, then blamed for it.
    """
    import json

    (repo / ".wringer.yaml").write_text(
        BROKEN_ENV.format(tag="alpha", worker=json.dumps(NOISY_WORKER)),
        encoding="utf-8",
    )
    cfg = config.load(repo / ".wringer.yaml")

    outcome = loop.run(repo, cfg)

    assert outcome.reason == loop.ENVIRONMENT, outcome.reason
    assert outcome.status == "stopped"
    assert outcome.iterations == 1
    loop_dir = only_loop(repo)
    assert briefs(loop_dir) == [], "a worker was briefed against the environment"
    assert not (repo / "worker-ran.txt").exists(), "the worker actually RAN"
    assert manifest_of(loop_dir)["result"]["reason"] == loop.ENVIRONMENT


def test_the_environment_stop_writes_a_diagnosis_naming_the_gate(repo):
    """`diagnosis.json`, the sibling — and it validates against its own schema.

    Also pins that the loop manifest is still `wringer.loop.v2` and still
    valid: the whole reason this is a sibling is that the version was NOT
    spent, and a test that did not check would let a silent bump through.
    """
    import json

    (repo / ".wringer.yaml").write_text(
        BROKEN_ENV.format(tag="beta", worker=json.dumps(NOISY_WORKER)),
        encoding="utf-8",
    )
    cfg = config.load(repo / ".wringer.yaml")

    loop.run(repo, cfg)
    loop_dir = only_loop(repo)

    record = json.loads(
        (loop_dir / loop.DIAGNOSIS_FILENAME).read_text(encoding="utf-8")
    )
    assert record["schema_version"] == loop.DIAGNOSIS_SCHEMA_VERSION
    assert record["face"] == diagnose.FACE_COMMAND_NOT_FOUND
    assert record["gate"] == "unit"
    assert record["evidence"]

    schema = json.loads(
        (Path(loop.__file__).parents[2] / "schema" / "diagnosis.schema.json")
        .read_text(encoding="utf-8")
    )
    jsonschema = pytest.importorskip("jsonschema")
    jsonschema.validate(record, schema)

    # The version was NOT spent. That is the point of the sibling.
    assert manifest_of(loop_dir)["schema_version"] == "wringer.loop.v2"


def test_the_diagnosis_is_absent_not_null_when_no_face_matched(repo):
    """Absence is the record. A reader that finds no file is not reading a
    null and wondering whether the check ran."""
    (repo / ".wringer.yaml").write_text(
        """\
version: 1
gates:
  - id: unit
    run: "test -f FIXED"
run:
  worker: "true"
  max_iterations: 1
""",
        encoding="utf-8",
    )
    cfg = config.load(repo / ".wringer.yaml")

    loop.run(repo, cfg)
    loop_dir = only_loop(repo)

    assert not (loop_dir / loop.DIAGNOSIS_FILENAME).exists()


def test_the_counterweight_a_missing_module_still_briefs_and_still_no_progresses(
    repo,
):
    """**THE COUNTERWEIGHT. The probe above must not be satisfiable by
    widening the stop.**

    F6's flagship case, priced out loud by ruling 5 and unchanged by this
    cycle: a fresh repo whose gate is `python3 -m pytest -q` (exit 1, `No
    module named`) STILL briefs a worker once and STILL ends `no_progress`.
    That reason is true by definition — the worker left the tree
    byte-identical — and ruling 5 says a false continue is the direction to
    err, because a false stop refuses a real repair and costs unboundedly.

    What changed is legibility, not routing: the diagnosis is in the record
    and in the brief, labelled a guess.

    If someone later widens the stop tier so the probe passes more easily,
    THIS test reddens. That is its whole job.
    """
    import json

    (repo / ".wringer.yaml").write_text(
        MISSING_MODULE_CFG.format(worker=json.dumps("true")),
        encoding="utf-8",
    )
    cfg = config.load(repo / ".wringer.yaml")

    outcome = loop.run(repo, cfg)

    assert outcome.reason == "no_progress", outcome.reason
    assert outcome.reason != loop.ENVIRONMENT, "the stop tier was WIDENED"
    loop_dir = only_loop(repo)
    assert len(briefs(loop_dir)) == 1, "the worker must still be briefed exactly once"

    # Legible, not different: the diagnosis rides along on a non-environment
    # ending, which is the entire improvement this case gets.
    record = json.loads(
        (loop_dir / loop.DIAGNOSIS_FILENAME).read_text(encoding="utf-8")
    )
    assert record["face"] == diagnose.FACE_MISSING_MODULE

    brief = briefs(loop_dir)[0].read_text(encoding="utf-8")
    assert "A guess, not a verdict" in brief
    assert "stop changing" in brief
    # The one imperative, and NOT an instruction to repair the environment.
    assert "pip install" not in brief
    assert "Do not install anything" in brief


def test_a_bound_gate_that_cannot_run_still_briefs_a_worker(repo):
    """**Leg 4 end to end.** A `proves:`-bound gate is a gategen gate, and a
    born-red gategen gate is SUPPOSED to be red before anyone builds. Stopping
    it as `environment` would refuse the red-first seam outright."""
    import json

    # Criteria live in `wringer.spec.yaml`; `proves:` is the join.
    (repo / "wringer.spec.yaml").write_text(
        """\
schema_version: wringer.spec.v1
approved: true
title: Self-checking tool
intent: The tool can check itself.
tasks:
  - id: build-tool
    brief: Build the tool
    objective: The tool self-checks.
criteria:
  - id: selfcheck
    title: The tool self-checks
    required: true
""",
        encoding="utf-8",
    )
    (repo / ".wringer.yaml").write_text(
        f"""\
version: 1
gates:
  - id: unit
    run: "wringer-no-such-tool-gamma --selftest"
    proves: selfcheck
run:
  worker: {json.dumps(NOISY_WORKER)}
  max_iterations: 2
""",
        encoding="utf-8",
    )
    cfg = config.load(repo / ".wringer.yaml")

    outcome = loop.run(repo, cfg)

    assert outcome.reason != loop.ENVIRONMENT, (
        "a criterion-bound gate was stopped as environment — leg 4 is not wired"
    )
    assert briefs(only_loop(repo)), "the born-red gate briefed nobody"


# --- the fleet: the stampede F6 measured, and the retry it must not spend ---


def test_a_fleet_over_a_broken_environment_spends_no_retry_and_no_worker(
    tmp_path, monkeypatch
):
    """**The DONE box's fleet row — and the gap a mutation found.**

    Written after M11 of this cycle's mutation pass: with `fleet.py`'s
    environment leg deleted entirely, every test in this file stayed GREEN.
    The behaviour was built and unguarded, which is the exact shape H-5(iv)
    exists to catch — a stated guarantee with nothing holding it.

    Two children over a broken environment. Every one stops on its FIRST lap;
    **zero workers are invoked fleet-wide and zero `task.retried` events are
    written**. That is the stampede F6 measured, inverted: it used to be every
    child briefing an agent to repair a missing binary, four at a time.

    The rows read `failed`, not `parked` — `task.parked`'s `why` is a closed
    enum in the frozen fleet event schema and `environment` is not one of its
    five values. The word is the compromise; the retry refusal is the point,
    and the free-string reason carries the diagnosis to the summary table.
    """
    import json
    import subprocess

    from wringer import fleet

    repo = tmp_path / "fleet"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=repo, check=True)

    tasks = []
    for task_id in ("alpha", "beta"):
        workdir = repo / "tasks" / task_id
        workdir.mkdir(parents=True)
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=workdir, check=True)
        for key, value in (
            ("user.email", "t@e.invalid"),
            ("user.name", "t"),
            ("commit.gpgsign", "false"),
        ):
            subprocess.run(["git", "config", key, value], cwd=workdir, check=True)
        (workdir / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
        (workdir / ".wringer.yaml").write_text(
            f"""\
version: 1
gates:
  - id: test
    run: "wringer-no-such-tool-fleet --check"
run:
  worker: "printf 'RAN' >> {repo.as_posix()}/worker-ran.txt"
  max_iterations: 3
  worker_timeout: 30
""",
            encoding="utf-8",
        )
        subprocess.run(["git", "add", "-A"], cwd=workdir, check=True)
        subprocess.run(["git", "commit", "-qm", "base"], cwd=workdir, check=True)
        brief = repo / "briefs" / f"{task_id}.md"
        brief.parent.mkdir(exist_ok=True)
        brief.write_text("# fix it\n", encoding="utf-8")
        tasks.append(
            {
                "id": task_id,
                "brief": str(brief.relative_to(repo)),
                "dir": str(workdir.relative_to(repo)),
            }
        )

    (repo / ".wringer.yaml").write_text(
        """\
version: 1
gates:
  - id: noop
    run: "true"
fleet:
  concurrency: 2
  deadline: 300
  progress_window: 60
  retries: 3
""",
        encoding="utf-8",
    )
    task_file = repo / "tasks.jsonl"
    task_file.write_text(
        "\n".join(json.dumps(t) for t in tasks) + "\n", encoding="utf-8"
    )

    monkeypatch.chdir(repo)
    from wringer import cli

    cli.main(["fleet", "tasks.jsonl"])

    found = sorted((repo / fleet.FLEETS_DIRNAME).iterdir())
    assert len(found) == 1, found
    fleet_dir = found[0]
    record = json.loads(
        (fleet_dir / fleet.MANIFEST_FILENAME).read_text(encoding="utf-8")
    )

    # **No worker was ever invoked, by any child.**
    assert not (repo / "worker-ran.txt").exists(), (
        "a worker ran against a broken environment — the stampede is back"
    )

    # **No retry was spent**, though `retries: 3` was on offer.
    events = [
        json.loads(line)
        for line in (fleet_dir / fleet.EVENTS_FILENAME)
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    retried = [e for e in events if e.get("type") == "task.retried"]
    assert retried == [], f"a retry was spent on an environment stop: {retried}"

    # Every row names the environment, so the summary table is legible without
    # opening a child bundle.
    rows = record["tasks"]
    assert len(rows) == 2, rows
    for row in rows:
        assert loop.ENVIRONMENT in row["reason"], row
        assert row["attempts"] == 1, row
