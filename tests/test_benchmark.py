"""The benchmark harness — SPEC_BENCHMARK_V0.md.

The harness lives outside `src/wringer/` and is not importable from the package,
so it is loaded here by path. That asymmetry is the point: the package must not
need it, and a test that imported it as `wringer.benchmark` would have made it
part of the product.

Both demo tasks run for real — a scripted worker, a fake upstream test, no model
call — so every cell this file asserts was actually produced on this machine.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

BENCHMARK = Path(__file__).resolve().parent.parent / "benchmark"


def load_harness():
    """Import `benchmark/harness.py` by path.

    Not a package, not on `sys.path`, and deliberately neither: `MANIFEST.in`
    prunes `benchmark/`, so a distribution has no such module and the package
    must never reach for one.
    """
    spec = importlib.util.spec_from_file_location(
        "wringer_benchmark_harness", BENCHMARK / "harness.py"
    )
    module = importlib.util.module_from_spec(spec)
    # Registered BEFORE exec: `@dataclass` resolves its own module out of
    # `sys.modules` to check for `KW_ONLY`, and a module loaded by path that is
    # not there yet raises an AttributeError from inside dataclasses.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


harness = load_harness()


def build_demo(variant: str, into: Path) -> Path:
    """Build one demo repo into a temp directory, through its own script."""
    done = subprocess.run(
        ["sh", str(BENCHMARK / "tasks" / "demo" / "build.sh"), variant, str(into)],
        capture_output=True, text=True,
    )
    assert done.returncode == 0, done.stderr
    return into / f"repo-{variant}"


def task_file(variant: str, repo: Path, tmp_path: Path, **overrides) -> Path:
    """A copy of a shipped task file pointed at a freshly built repo.

    The shipped YAML is read rather than reinvented, so this test cannot drift
    from the task a human would actually run.
    """
    import yaml

    name = {"narrow": "demo-narrow.yaml", "covering": "demo-covering.yaml"}[variant]
    raw = yaml.safe_load((BENCHMARK / "tasks" / name).read_text(encoding="utf-8"))
    raw["repo"] = str(repo)
    raw["held_out"]["files"] = [
        str(BENCHMARK / "tasks" / "held_out_demo.py")
    ]
    raw.update(overrides)
    path = tmp_path / f"{variant}.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    return path


def rows_from(out: Path) -> list[dict]:
    text = (out / harness.RESULTS_FILENAME).read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def run_harness(task: Path, out: Path, *args: str) -> int:
    done = subprocess.run(
        [
            sys.executable, str(BENCHMARK / "harness.py"),
            "--task", str(task), "--out", str(out), *args,
        ],
        capture_output=True, text=True, cwd=BENCHMARK.parent,
    )
    print(done.stdout, done.stderr)
    return done.returncode


# --- the harness is not the product -----------------------------------------


def test_the_harness_is_not_importable_from_the_package():
    """It runs Wringer; it is not Wringer. A distribution has no such module,
    and the package must never reach for one."""
    with pytest.raises(ImportError):
        importlib.import_module("wringer.harness")
    with pytest.raises(ImportError):
        importlib.import_module("wringer.benchmark")


def test_the_distribution_prunes_the_harness():
    """Stated in MANIFEST.in rather than left to the absence of a graft, so the
    exclusion is a decision a reader can find."""
    manifest = (BENCHMARK.parent / "MANIFEST.in").read_text(encoding="utf-8")
    assert "prune benchmark" in manifest


# --- the two arms, and the two cells the demo really produces ---------------


def test_the_covering_task_demonstrates_the_claim(tmp_path: Path):
    """**Arm A claims success and is wrong; arm B refuses and is right.**

    The scripted worker writes a tautological fix that hardcodes the case in the
    issue. The repo's own test covers the general case, so the gate stays red and
    `wring deliver` refuses ON THE EVIDENCE — which is the only refusal that
    counts.
    """
    repo = build_demo("covering", tmp_path)
    out = tmp_path / "out"

    assert run_harness(task_file("covering", repo, tmp_path), out) == 0
    rows = {row["arm"]: row for row in rows_from(out)}

    assert rows["a_native"]["cell"] == harness.FALSE_CONFIDENCE
    assert rows["a_native"]["claimed"] is True
    assert rows["a_native"]["held_out_passed"] is False

    assert rows["b_wringer"]["cell"] == harness.TRUE_REFUSAL
    assert rows["b_wringer"]["claimed"] is False
    # ...and refused for the RIGHT reason: the evidence, not the machine
    assert "refused on the evidence" in rows["b_wringer"]["reason"]
    assert "gates did not pass" in rows["b_wringer"]["reason"]


def test_the_narrow_task_is_a_wringer_loss_and_says_so(tmp_path: Path):
    """**The demo that would not appear in an advert.**

    Same bug, same worker, same held-out test — and a repo whose own test covers
    only the reported case. The tautological fix goes green, `wring deliver` says
    yes, and upstream disagrees: BOTH arms land in false confidence.

    Wringer's precision is bounded by the quality of the gates the repository
    wrote down. It runs the checks a repo has and cannot invent the one nobody
    wrote. A harness that could only produce the flattering cell would be
    measuring nothing, so this task ships and runs beside the other.
    """
    repo = build_demo("narrow", tmp_path)
    out = tmp_path / "out"

    assert run_harness(task_file("narrow", repo, tmp_path), out) == 0
    rows = {row["arm"]: row for row in rows_from(out)}

    assert rows["a_native"]["cell"] == harness.FALSE_CONFIDENCE
    assert rows["b_wringer"]["cell"] == harness.FALSE_CONFIDENCE
    assert rows["b_wringer"]["claimed"] is True
    assert "would deliver this" in rows["b_wringer"]["reason"]


def test_one_arm_can_be_run_alone(tmp_path: Path):
    repo = build_demo("covering", tmp_path)
    out = tmp_path / "out"

    assert run_harness(task_file("covering", repo, tmp_path), out, "--arm", "b") == 0
    rows = rows_from(out)

    assert [row["arm"] for row in rows] == ["b_wringer"]


def test_rows_are_appended_never_rewritten(tmp_path: Path):
    """A corpus run is resumable, and a harness that truncated its own results on
    a second invocation would lose the expensive half of the experiment."""
    repo = build_demo("covering", tmp_path)
    out = tmp_path / "out"
    task = task_file("covering", repo, tmp_path)

    run_harness(task, out, "--arm", "a")
    run_harness(task, out, "--arm", "b")

    assert len(rows_from(out)) == 2


# --- isolation: the check that makes the experiment mean anything ------------


def test_a_held_out_file_already_in_the_tree_is_void(tmp_path: Path):
    """**If a worker can read the test it is scored against, the experiment is
    over.** The "worker writes its own success criterion" defect, at the
    benchmark's own level."""
    repo = build_demo("covering", tmp_path)
    # plant it where the harness will look
    (repo / "held_out_demo.py").write_text("# leaked\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", "-A"], capture_output=True)
    subprocess.run(
        ["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@e.invalid",
         "commit", "-qm", "leak"],
        capture_output=True,
    )
    out = tmp_path / "out"

    assert run_harness(task_file("covering", repo, tmp_path), out) == 1
    for row in rows_from(out):
        assert row["cell"] == harness.VOID
        assert "already in the working tree" in row["reason"]
        # and no half-measurement: a cell needs both coordinates
        assert row["claimed"] is None
        assert row["held_out_passed"] is None


def test_a_gate_that_mentions_the_held_out_file_is_void(tmp_path: Path):
    """The circularity trap: Wringer's own verdict would be partly the ground
    truth it is being measured against."""
    repo = build_demo("covering", tmp_path)
    (repo / ".wringer.yaml").write_text(
        "version: 1\ngates:\n  - id: test\n"
        '    run: "python3 -m pytest test_calc.py held_out_demo.py -q"\n'
        'run:\n  worker: "sh ./scripted-fix.sh"\n',
        encoding="utf-8",
    )
    out = tmp_path / "out"

    assert run_harness(task_file("covering", repo, tmp_path), out) == 1
    for row in rows_from(out):
        assert row["cell"] == harness.VOID
        assert "circularity trap" in row["reason"]


def test_a_statement_that_mentions_the_held_out_file_is_void(tmp_path: Path):
    """Arm A would be reading the answer."""
    repo = build_demo("covering", tmp_path)
    out = tmp_path / "out"
    task = task_file(
        "covering", repo, tmp_path,
        statement="Fix add so that held_out_demo.py passes.",
    )

    assert run_harness(task, out) == 1
    for row in rows_from(out):
        assert row["cell"] == harness.VOID
        assert "told which test it is scored against" in row["reason"]


def test_the_held_out_files_never_enter_an_arms_tree(tmp_path: Path):
    """Scored in a THIRD copy, made after the arm finished. Asserted on the
    filesystem the arm actually worked in, because "copied forward" is a claim
    about a directory rather than about an intention."""
    repo = build_demo("covering", tmp_path)
    out = tmp_path / "out"

    run_harness(task_file("covering", repo, tmp_path), out)

    for row in rows_from(out):
        tree = Path(row["evidence"]["tree"])
        assert tree.is_dir()
        assert not (tree / "held_out_demo.py").exists(), (
            "the held-out test reached a tree an arm could read"
        )
        # ...and it IS in the scoring copy, or the signal was never applied
        assert (tree.parent / "scoring" / "held_out_demo.py").is_file()


# --- an arm that measured nothing -------------------------------------------


def test_a_precondition_refusal_is_void_and_not_a_true_refusal(tmp_path: Path):
    """**The most important rule here, and it was found the hard way.**

    Arm B counts a refusal only when `wring deliver` exited 1 — refused on the
    evidence. Exit 3 is a precondition: an unreachable remote, a dirty tree.
    Wringer never reached a verdict about the change.

    The first run of this harness scored arm B a `true_refusal` because the demo
    repo had no reachable `origin`. A constant refuser scores perfect
    true-refusal on every failing task and perfect false-refusal on every passing
    one — precision bought by an accident of the machine, in exactly the
    direction that flatters the claim under test.
    """
    # The NARROW repo, deliberately: its gates PASS with the tautological fix, so
    # `deliver` gets past the evidence checks and reaches the remote one. On
    # `covering` the gates fail first and exit 1 — the right answer for the wrong
    # reason, which this test would then have asserted.
    repo = build_demo("narrow", tmp_path)
    # take the remote away: deliver now cannot resolve a default branch
    subprocess.run(
        ["git", "-C", str(repo), "remote", "remove", "origin"], capture_output=True
    )
    out = tmp_path / "out"

    assert run_harness(task_file("narrow", repo, tmp_path), out, "--arm", "b") == 1
    row = rows_from(out)[0]

    assert row["cell"] == harness.VOID
    assert row["claimed"] is None
    assert "never reached its evidence decision" in row["reason"]
    assert "not a verdict about the change" in row["reason"]


def test_a_worker_that_cannot_start_is_void_for_arm_a(tmp_path: Path):
    """The agent never ran, so it claimed nothing. Recording that as "claims
    failure" would put a row in the refusal column no agent earned."""
    repo = build_demo("covering", tmp_path)
    out = tmp_path / "out"
    task = task_file(
        "covering", repo, tmp_path, worker="definitely-not-a-program-here"
    )

    assert run_harness(task, out, "--arm", "a") == 1
    row = rows_from(out)[0]

    assert row["cell"] == harness.VOID
    assert "could not be started" in row["reason"]


# --- the row's own honesty --------------------------------------------------


def test_every_row_carries_deviations_and_they_are_never_empty(tmp_path: Path):
    """A row listing no deviations would be the overclaim this harness exists to
    avoid: the arms differ in PROMPT as well as in supervision, always."""
    repo = build_demo("covering", tmp_path)
    out = tmp_path / "out"

    run_harness(task_file("covering", repo, tmp_path), out)

    for row in rows_from(out):
        assert row["deviations"], row
        joined = " ".join(row["deviations"])
        assert "differ in prompt, not only in supervision" in joined
        assert "one attempt only" in joined


def test_every_row_carries_the_limits(tmp_path: Path):
    """Pinned by content. A benchmark is the artifact most likely to be read as a
    larger claim than it is, and a limit in a design document nobody opened is a
    limit nobody reads."""
    repo = build_demo("covering", tmp_path)
    out = tmp_path / "out"

    run_harness(task_file("covering", repo, tmp_path), out)
    joined = " ".join(rows_from(out)[0]["limits"])

    assert "agreement with UPSTREAM'S fix" in joined
    assert "inflates the measured false-refusal rate" in joined
    assert "claim of completion is its EXIT CODE" in joined
    assert "differ in PROMPT" in joined
    assert "void row contributes to no rate" in joined
    assert "constant refuser" in joined


def test_the_classifier_is_the_whole_2x2_and_nothing_else():
    """No weighting, no score, no aggregate. Four cells, from two booleans."""
    assert harness.classify(True, True) == harness.TRUE_CONFIDENCE
    assert harness.classify(True, False) == harness.FALSE_CONFIDENCE
    assert harness.classify(False, False) == harness.TRUE_REFUSAL
    assert harness.classify(False, True) == harness.FALSE_REFUSAL


def test_there_is_no_aggregate_command():
    """A rate over two scripted rows would be a number worth nothing, and the
    absence is a decision — SPEC_BENCHMARK_V0 §8."""
    source = (BENCHMARK / "harness.py").read_text(encoding="utf-8")
    for absent in ("def summarise", "def summarize", "def aggregate", "def rate"):
        assert absent not in source, absent


# --- the task file surface --------------------------------------------------


@pytest.mark.parametrize(
    "drop", ["id", "repo", "statement", "held_out", "worker", "budget"]
)
def test_every_task_field_is_required(tmp_path: Path, drop: str):
    """No defaults. A benchmark whose budget or worker came from the harness
    rather than from the task file is one whose conditions nobody wrote down."""
    import yaml

    raw = yaml.safe_load(
        (BENCHMARK / "tasks" / "demo-covering.yaml").read_text(encoding="utf-8")
    )
    raw.pop(drop)
    path = tmp_path / "broken.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")

    with pytest.raises(harness.TaskError) as caught:
        harness.load_task(path)
    assert drop in str(caught.value)


def test_a_held_out_block_with_no_files_is_refused(tmp_path: Path):
    """A held-out suite with no files is one that was already in the tree, which
    is the void this harness exists to refuse."""
    import yaml

    raw = yaml.safe_load(
        (BENCHMARK / "tasks" / "demo-covering.yaml").read_text(encoding="utf-8")
    )
    raw["held_out"] = {"run": "pytest -q"}
    path = tmp_path / "nofiles.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")

    with pytest.raises(harness.TaskError) as caught:
        harness.load_task(path)
    assert "already in the tree" in str(caught.value)


def test_both_shipped_tasks_load():
    """The files a human would actually run, parsed by the real loader."""
    for name in ("demo-narrow.yaml", "demo-covering.yaml"):
        task = harness.load_task(BENCHMARK / "tasks" / name)
        assert task.id
        assert task.held_out_files
        assert task.wall_clock > 0
