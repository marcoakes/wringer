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
import re
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
        [
            "sh", str(BENCHMARK / "tasks" / "demo" / "build.sh"),
            variant, str(into),
            # THIS interpreter, not whatever PATH resolves `python3` to. A
            # fresh-clone repro resolved it to Xcode's, which has no pytest, so
            # the demo's gate failed for a reason the experiment never chose and
            # arm B scored a refusal on an environment accident.
            sys.executable,
        ],
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
    avoid.

    **The prompt deviation is gone as of 2026-08-13, and its absence is the
    finding rather than an omission.** Both arms are now handed the same
    statement, so "the arms differ in prompt" would be a FALSE deviation — and a
    list padded with a limitation that no longer applies is as dishonest as one
    missing a limitation that does. What replaced it is the one that is now
    load-bearing: two independent draws from a stochastic agent.
    """
    repo = build_demo("covering", tmp_path)
    out = tmp_path / "out"

    run_harness(task_file("covering", repo, tmp_path), out)

    for row in rows_from(out):
        assert row["deviations"], row
        joined = " ".join(row["deviations"])
        assert "one attempt only" in joined
        assert "two INDEPENDENT agent runs" in joined
        assert "variance" in joined
        # The stale one must not come back with the arms as they now are.
        assert "differ in prompt" not in joined.lower(), joined


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
    # Was "the arms differ in PROMPT". They no longer do; this is the limit that
    # took its place, and it is the one a reader now has to hold.
    assert "two INDEPENDENT draws from a stochastic agent" in joined
    assert "differ in PROMPT" not in joined
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


# --- the paid path, checked without paying -----------------------------------


def load_preflight():
    spec = importlib.util.spec_from_file_location(
        "wringer_benchmark_preflight", BENCHMARK / "preflight.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_the_real_agent_task_loads_and_declares_its_credential_by_name():
    """The credential is NAMED and never held: the task says where to ask macOS
    for it, and the value is not in this repository, this file, or a history."""
    task = harness.load_task(BENCHMARK / "tasks" / "smoke-real-agent.yaml")

    assert task.agent is not None
    assert task.agent.command == "claude-agent-acp"
    assert task.agent.env_passthrough == ("ANTHROPIC_API_KEY",)
    assert task.agent.keychain_service == "anthropic"
    assert task.agent.keychain_env == "ANTHROPIC_API_KEY"

    # ...and no task file anywhere carries something shaped like a key
    for path in sorted((BENCHMARK / "tasks").glob("*.yaml")):
        assert "sk-ant" not in path.read_text(encoding="utf-8"), path


def test_the_scripted_tasks_declare_no_agent_and_so_cost_nothing():
    """The boundary between free and paid is a field, not a convention."""
    for name in ("demo-narrow.yaml", "demo-covering.yaml"):
        assert harness.load_task(BENCHMARK / "tasks" / name).agent is None


def test_preflight_makes_no_api_call(tmp_path: Path, monkeypatch):
    """**The whole promise of the command.** It reports every precondition it can
    check offline and then says that credit is the one it cannot — so running it
    is free, and a green report means money is the only thing left."""
    source = (BENCHMARK / "preflight.py").read_text(encoding="utf-8")

    for forbidden in ("urllib", "requests", "httpx", "api.anthropic.com", "socket"):
        assert forbidden not in source, forbidden
    assert "No API call has been made" in source


def test_preflight_never_reads_the_secret_value():
    """`find-generic-password` WITHOUT `-w` prints metadata, not the secret. The
    preflight checks presence only, so nothing it emits can leak into a terminal,
    a log or a screenshot."""
    source = (BENCHMARK / "preflight.py").read_text(encoding="utf-8")
    credential = source[source.index("def check_credential") : source.index(
        "def check_isolation"
    )]

    assert '"-w"' not in credential, "the preflight asked for the secret VALUE"
    assert "value not read" in credential


def test_preflight_checks_the_wringer_the_harness_will_actually_use():
    """It checked the wrong one first: the harness invokes `sys.executable -m
    wringer`, and PATH here had a stale `wring` at 0.2.0 shadowing the repo's
    0.3.0 — a green report about a version nothing would execute."""
    preflight = load_preflight()
    checks = preflight.check_wring()

    assert checks[0].name == "wringer"
    assert sys.executable in checks[0].detail


def test_preflight_reports_a_scripted_task_as_free(tmp_path: Path, capsys):
    """A task with no agent needs no credential and costs nothing, and the
    report says so rather than asking for a key it will not use."""
    preflight = load_preflight()
    repo = build_demo("covering", tmp_path)
    task = task_file("covering", repo, tmp_path)

    assert preflight.main(["--task", str(task)]) == 0
    out = capsys.readouterr().out

    assert "costs nothing" in out
    assert "only thing left is money" not in out


def test_preflight_refuses_a_task_whose_repo_is_not_built(tmp_path: Path, capsys):
    preflight = load_preflight()
    import yaml

    raw = yaml.safe_load(
        (BENCHMARK / "tasks" / "smoke-real-agent.yaml").read_text(encoding="utf-8")
    )
    raw["repo"] = str(tmp_path / "nothing-here")
    path = tmp_path / "unbuilt.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")

    assert preflight.main(["--task", str(path)]) == 1
    out = capsys.readouterr().out
    assert "NOT READY" in out
    assert "build.sh" in out


def test_the_agent_variant_declares_an_acp_worker_and_the_covering_suite(
    tmp_path: Path,
):
    """Arm B must reach the agent through Wringer, and the repo's own gate must
    cover the general case — or arm B's refusal would be luck rather than the
    mechanism."""
    repo = build_demo("agent", tmp_path)
    config = (repo / ".wringer.yaml").read_text(encoding="utf-8")

    assert "acp:" in config
    assert "claude-agent-acp" in config
    # the credential by NAME, which is what folds it into Wringer's redactor
    assert "env_passthrough: [ANTHROPIC_API_KEY]" in config
    assert "sk-ant" not in config
    # ...and the covering test suite, so a tautological fix cannot pass
    assert "test_the_general_case" in (repo / "test_calc.py").read_text("utf-8")


def test_the_corpus_rule_was_written_before_the_corpus_existed():
    """`CORPUS.md` §4: the rule is fixed BEFORE selection, because whoever picks
    the tasks can pick the result.

    **This test used to assert the corpus was EMPTY.** On 2026-08-13 it stopped
    being empty, and what the guard protects moved with it: not the absence of a
    corpus, but the ORDER — the rule dated before selection, every candidate
    recorded rather than only the chosen ones, and the smoke task still marked
    as not being evidence about agents.

    The counts are asserted as a range rather than a number so that adding a
    reserved candidate later does not silently pass; §4 requires a second corpus
    published beside this one, never an extension of this one.
    """
    import yaml

    text = (BENCHMARK / "CORPUS.md").read_text(encoding="utf-8")

    assert "before any task that costs money has been run" in text
    # the rule that can void the whole run is stated as a rule, not a hope.
    # A phrase that lives on ONE line: the rule is a blockquote, so a wrapped
    # continuation carries a leading `>` that lands between the words.
    assert "a good agent plausibly declares success" in text
    assert "Not a corpus task and not evidence about agents" in text

    # Every candidate examined is recorded, kept or excluded — not just the kept.
    assert "commits examined across five repositories" in text
    assert "dropped by the critic" in text
    assert "survived, not selected" in text

    manifest = yaml.safe_load(
        (BENCHMARK / "corpus" / "corpus.yaml").read_text(encoding="utf-8")
    )
    tasks = manifest["tasks"]
    # §4: 3-5 repositories, 10-20 tasks.
    assert 10 <= len(tasks) <= 20, len(tasks)
    assert 3 <= len({t["repo_key"] for t in tasks}) <= 5
    # and every one of them names the licence it is used under
    assert all(t.get("licence") for t in tasks)
    # the fix commit is recorded so a reader can diff agent against upstream,
    # and it is never handed to an arm
    assert all(t.get("fix_sha") and t.get("base_sha") for t in tasks)


def test_the_credential_source_works_off_macos(tmp_path: Path, monkeypatch):
    """**`security` is macOS-only, and a missing binary RAISES.**

    Found by CI on `ubuntu-latest`, with macOS green beside it — the exact shape
    a platform assumption has. Without this the whole suite died on a
    `FileNotFoundError` traceback rather than a message, and a Linux user running
    a corpus would have hit the same wall.

    Two sources in a fixed order: the Keychain wins where it exists, so a stale
    variable in a shell cannot quietly override what somebody put in the OS
    keystore.
    """
    agent = harness.Agent(
        command="claude-agent-acp",
        args=(),
        env_passthrough=("ANTHROPIC_API_KEY",),
        keychain_service="anthropic",
        keychain_account="wringer",
        keychain_env="ANTHROPIC_API_KEY",
    )

    monkeypatch.setattr(harness.shutil, "which", lambda _n: None)  # no Keychain
    monkeypatch.setenv("ANTHROPIC_API_KEY", "from-the-environment")
    assert harness.keychain_secret(agent) == "from-the-environment"

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(harness.TaskError) as caught:
        harness.keychain_secret(agent)
    message = str(caught.value)
    assert "no macOS Keychain here" in message
    assert "export it" in message


def test_presence_is_checked_without_asking_for_the_value():
    """`-w` is the flag that prints the secret. A report that had to read the
    value to say it exists is a report that could leak it into a screenshot."""
    agent = harness.Agent(
        command="x", args=(), env_passthrough=(),
        keychain_service="anthropic", keychain_account="wringer",
        keychain_env="ANTHROPIC_API_KEY",
    )

    assert "-w" not in harness.keychain_argv(agent, reveal=False)
    assert "-w" in harness.keychain_argv(agent, reveal=True)


def test_a_wringer_crash_is_void_and_never_a_refusal(tmp_path: Path, monkeypatch):
    """**A crash is not a verdict, and exit 1 alone cannot tell them apart.**

    An unhandled Python exception exits 1 exactly as a failed gate does. The
    first real agent run recorded `false_refusal` for a `UnicodeDecodeError` in
    `git.py` — a refusal Wringer never made, entered as a data point against it.

    Sniffing for a traceback is text-matching, which this harness refuses to do
    to a GATE's output. It is different here: this is Wringer's own crash
    signature in a tool we own, and the alternative is scoring bugs as verdicts.
    """
    repo = build_demo("covering", tmp_path)
    out = tmp_path / "out"
    task = harness.load_task(task_file("covering", repo, tmp_path))

    real = harness.subprocess.run

    def crash(argv, **kw):
        done = real(argv, **kw)
        if "deliver" in argv:
            done.returncode = 1
            done.stderr = (
                "Traceback (most recent call last):\n"
                '  File "src/wringer/git.py", line 47, in decode\n'
                "UnicodeDecodeError: 'utf-8' codec can't decode byte 0xe9\n"
            )
        return done

    monkeypatch.setattr(harness.subprocess, "run", crash)
    workdir = out / task.id / harness.ARM_WRINGER
    workdir.mkdir(parents=True)
    claimed, reason = harness.run_under_wringer(task, repo, workdir)

    assert claimed is None, "a crash was scored as a claim"
    assert "CRASHED rather than deciding" in reason
    assert "not a verdict about the change" in reason


def test_the_limits_say_a_crash_is_not_a_refusal():
    joined = " ".join(harness.LIMITS)
    assert "A Wringer CRASH is VOID and never a refusal" in joined


# --- what it cost, which v1 recorded nowhere -------------------------------


def test_a_row_carries_what_the_agent_said_it_spent(tmp_path: Path):
    """**The corpus run's cost column comes from here.**

    v1 recorded spend on no row at all: arm A's was never read off the ACP
    turn, and arm B's sat inside the loop bundle where nothing looked. A
    completed $80-400 corpus would have produced one aggregate number off a
    credit-card statement and no per-task attribution — so this landed BEFORE
    the corpus ran rather than after, which is the only order in which it is
    worth anything.
    """
    workdir = tmp_path / "arm"
    workdir.mkdir()
    (workdir / harness.USAGE_FILENAME).write_text(
        json.dumps({
            "schema_version": "wringer.usage.v1",
            "reported_by": "agent",
            "verified": False,
            "totals": {"used": 23319, "sessions": 1,
                       "cost": {"amount": 0.135286, "currency": "USD"}},
        }),
        encoding="utf-8",
    )

    totals = harness.usage_of(workdir)

    assert totals == {"used": 23319, "sessions": 1,
                      "cost": {"amount": 0.135286, "currency": "USD"}}


@pytest.mark.parametrize(
    "written",
    [None, "", "not json at all", '{"schema_version": "x"}', '{"totals": 7}'],
)
def test_an_unreported_cost_stays_ABSENT_and_never_becomes_a_zero(
    tmp_path: Path, written: str | None
):
    """A zero here would be a number this harness invented about somebody
    else's bill, and it would then be SUMMED. Absent is absent, whether the
    agent said nothing, the file is missing, or the file is rubbish — every one
    of those is the same answer: this harness does not know."""
    workdir = tmp_path / "arm"
    workdir.mkdir()
    if written is not None:
        (workdir / harness.USAGE_FILENAME).write_text(written, encoding="utf-8")

    assert harness.usage_of(workdir) is None


def test_the_row_schema_moved_because_the_row_grew():
    """Law 7's discipline applied where law 7 does not reach.

    This schema is not in `schema/frozen.json` — the harness ships outside the
    package. But rows from the 2026-08-13 smoke run are already on disk saying
    v1, and adding a field to v1 would put two shapes under one version, which
    is exactly the confusion freezing prevents. So v1 is named as PAST, and a
    reader who finds a v1 row knows what it cannot tell them.
    """
    assert harness.SCHEMA_VERSION == "wringer.benchmark.v4"
    for past in ("v1", "v2", "v3"):
        assert f"wringer.benchmark.{past}" in harness.PREVIOUS_SCHEMA_VERSIONS
    assert harness.SCHEMA_VERSION not in harness.PREVIOUS_SCHEMA_VERSIONS


def test_a_scripted_task_reports_no_cost_because_a_shell_script_has_none(
    tmp_path: Path
):
    """The demo tasks run a shell script, which spends nothing and reports
    nothing. Their rows must therefore carry `usage: null` — not a zero, and
    not a missing key that a reader could mistake for an unfinished row."""
    repo = build_demo("covering", tmp_path)
    task = task_file("covering", repo, tmp_path)
    out = tmp_path / "out"

    assert run_harness(task, out) == 0

    rows = rows_from(out)
    assert rows, "no rows were written"
    for row in rows:
        assert "usage" in row, f"the key must exist to be readable: {row}"
        assert row["usage"] is None, row
        assert row["schema_version"] == "wringer.benchmark.v4"


# --- a real repository keeps its tests in tests/ ----------------------------


def test_a_held_out_file_lands_where_its_fixtures_are(tmp_path: Path):
    """**The change that makes a real corpus possible at all.**

    v1 copied every held-out file to the tree ROOT under its basename. A real
    repository keeps its tests in `tests/`, beside the `conftest.py` their
    fixtures come from, so a file landed at the root collects no fixtures and
    scores the environment instead of the change.
    """
    repo = build_demo("covering", tmp_path)
    subprocess.run(["mkdir", "-p", str(repo / "tests")], check=True)
    (repo / "tests" / "conftest.py").write_text(
        "import pytest\n\n@pytest.fixture\ndef four():\n    return 4\n",
        encoding="utf-8",
    )
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True,
                   capture_output=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "fixtures"],
                   check=True, capture_output=True)

    held = tmp_path / "held_out_nested.py"
    held.write_text(
        "from calc import add\n\ndef test_uses_a_fixture(four):\n"
        "    assert add(2, 2) == four\n",
        encoding="utf-8",
    )
    task = task_file("covering", repo, tmp_path)
    import yaml
    raw = yaml.safe_load(task.read_text(encoding="utf-8"))
    raw["held_out"]["files"] = [
        {"src": str(held), "dest": "tests/held_out_nested.py"}
    ]
    raw["held_out"]["run"] = (
        f"{sys.executable} -m pytest tests/held_out_nested.py -q"
    )
    task.write_text(yaml.safe_dump(raw), encoding="utf-8")

    out = tmp_path / "out"
    assert run_harness(task, out) == 0

    rows = rows_from(out)
    assert rows, "no rows were written"
    for row in rows:
        assert row["cell"] != harness.VOID, row
        # The fixture resolved, which it could only do from tests/.
        assert row["held_out_passed"] is True, row


def test_an_overwriting_held_out_file_is_refused_unless_the_tests_are_named(
    tmp_path: Path
):
    """Upstream usually EXTENDS an existing test file. That file is legitimately
    in the tree at base, and v1 could only call that a void.

    The rule does not disappear — it moves. Without `held_out.tests` naming what
    was added, an existing destination is still the "the worker can read what it
    is scored against" void, because nothing has said which part is new.
    """
    repo = build_demo("covering", tmp_path)
    held = tmp_path / "test_calc.py"
    held.write_text("def test_added_later():\n    assert True\n", encoding="utf-8")

    import yaml
    task = task_file("covering", repo, tmp_path)
    raw = yaml.safe_load(task.read_text(encoding="utf-8"))
    # test_calc.py already exists in the demo repo.
    raw["held_out"]["files"] = [{"src": str(held), "dest": "test_calc.py"}]
    task.write_text(yaml.safe_dump(raw), encoding="utf-8")

    out = tmp_path / "out"
    assert run_harness(task, out) == 1
    rows = rows_from(out)
    assert rows
    for row in rows:
        assert row["cell"] == harness.VOID, row
        assert "already in the working tree" in row["reason"], row


def test_a_held_out_test_NAME_already_in_the_tree_is_void(tmp_path: Path):
    """The stricter half of the same rule, and the one that earns it.

    When the file may overwrite, the signal is the added test NAMES — so they
    must appear NOWHERE in the tree. Not in the file they land in, not in a
    neighbouring test, not in a changelog that quotes them. A name already
    present means the worker can read the thing it is scored against, whatever
    file it happens to sit in.
    """
    repo = build_demo("covering", tmp_path)
    # The name leaks somewhere entirely innocent-looking.
    (repo / "CHANGELOG.md").write_text(
        "- added test_the_new_edge_case for the boundary bug\n", encoding="utf-8"
    )
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True,
                   capture_output=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "changelog"],
                   check=True, capture_output=True)

    held = tmp_path / "test_calc.py"
    held.write_text(
        "def test_the_new_edge_case():\n    assert True\n", encoding="utf-8"
    )
    import yaml
    task = task_file("covering", repo, tmp_path)
    raw = yaml.safe_load(task.read_text(encoding="utf-8"))
    raw["held_out"]["files"] = [{"src": str(held), "dest": "test_calc.py"}]
    raw["held_out"]["tests"] = ["test_the_new_edge_case"]
    task.write_text(yaml.safe_dump(raw), encoding="utf-8")

    out = tmp_path / "out"
    assert run_harness(task, out) == 1
    rows = rows_from(out)
    assert rows
    for row in rows:
        assert row["cell"] == harness.VOID, row
        assert "test_the_new_edge_case" in row["reason"], row
        assert "CHANGELOG.md" in row["reason"], row


def test_a_statement_naming_an_added_test_is_void(tmp_path: Path):
    """Same reason the statement may not name the FILE: arm A would be reading
    the answer. A test name is at least as revealing as a filename."""
    repo = build_demo("covering", tmp_path)
    held = tmp_path / "held_out_demo.py"
    held.write_text("def test_secret_case():\n    assert True\n", encoding="utf-8")

    import yaml
    task = task_file("covering", repo, tmp_path)
    raw = yaml.safe_load(task.read_text(encoding="utf-8"))
    raw["held_out"]["files"] = [{"src": str(held), "dest": "held_out_demo.py"}]
    raw["held_out"]["tests"] = ["test_secret_case"]
    raw["statement"] = "Make test_secret_case pass."
    task.write_text(yaml.safe_dump(raw), encoding="utf-8")

    out = tmp_path / "out"
    assert run_harness(task, out) == 1
    for row in rows_from(out):
        assert row["cell"] == harness.VOID, row
        assert "test_secret_case" in row["reason"], row


@pytest.mark.parametrize("dest", ["/etc/passwd", "../escaped.py", "a/../../b.py"])
def test_a_held_out_destination_cannot_escape_the_tree(tmp_path: Path, dest: str):
    """`deliver.remote`'s lesson, three modules over: a value from a file
    becomes a path, so it has to be bounded where it is read. The scoring copy
    is written to, and a destination outside it writes outside the experiment."""
    repo = build_demo("covering", tmp_path)
    held = tmp_path / "held_out_demo.py"
    held.write_text("def test_x():\n    assert True\n", encoding="utf-8")

    import yaml
    task = task_file("covering", repo, tmp_path)
    raw = yaml.safe_load(task.read_text(encoding="utf-8"))
    raw["held_out"]["files"] = [{"src": str(held), "dest": dest}]
    task.write_text(yaml.safe_dump(raw), encoding="utf-8")

    # Exit 2: the task file cannot be used at all, which is not a void row.
    assert run_harness(task, tmp_path / "out") == 2


# --- the answer must not be in the repository -------------------------------


def test_a_reachable_fix_commit_is_void_because_the_answer_is_not_held_out(
    tmp_path: Path
):
    """**The isolation hole a real corpus run walked straight into.**

    Every other rule here looks at the working tree or at a command string.
    None of them can see an object store — so a `git clone` puts the working
    tree at the base commit and leaves the answer in `.git`, reachable by sha
    and usually by tag.

    That is not hypothetical. In the 2026-08-13 corpus run the upstream fix was
    reachable in all 13 task trees, three agent runs quoted its sha, and on one
    task the agent fetched the upstream patch — which CONTAINS the held-out test
    file — and produced a source change byte-identical to upstream's. That row
    was the entire measured difference between the two arms.
    """
    repo = build_demo("covering", tmp_path)
    # A commit that exists in this repo's history and must not be reachable.
    sha = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        capture_output=True, text=True,
    ).stdout.strip()

    import yaml
    task = task_file("covering", repo, tmp_path)
    raw = yaml.safe_load(task.read_text(encoding="utf-8"))
    raw["forbidden_shas"] = [sha]
    task.write_text(yaml.safe_dump(raw), encoding="utf-8")

    out = tmp_path / "out"
    assert run_harness(task, out) == 1
    rows = rows_from(out)
    assert rows
    for row in rows:
        assert row["cell"] == harness.VOID, row
        assert sha[:12] in row["reason"], row
        assert "the answer is in .git" in row["reason"], row


def test_a_task_naming_no_forbidden_sha_still_runs(tmp_path: Path):
    """The check is opt-in by declaration, so every task written before it
    still loads and runs. A task that names nothing forbids nothing."""
    repo = build_demo("covering", tmp_path)
    out = tmp_path / "out"

    assert run_harness(task_file("covering", repo, tmp_path), out) == 0
    assert all(row["cell"] != harness.VOID for row in rows_from(out))


# --- what cannot be prevented is recorded -----------------------------------


def test_a_row_records_that_the_agent_went_and_read_upstream(tmp_path: Path):
    """**Detected, because it cannot be prevented.**

    The agent has a shell and a network and needs the network for its own API,
    so nothing here can stop it opening the public repository this task was cut
    from. The 2026-08-13 corpus run is why this exists: agents fetched
    `<fix>.patch` — which contains the held-out test file — pulled post-fix
    copies of the file they had to change, and ran `git log --all --grep` to
    find the fix by subject. One arm's change came back byte-identical to
    upstream's. None of it appeared in the rows.
    """
    workdir = tmp_path / "arm"
    workdir.mkdir()
    (workdir / "agent.stdout.log").write_text(
        "let me check upstream\n"
        "curl -sL https://github.com/pallets/click/commit/a1235aacb1be.patch\n"
        "WebFetch https://raw.githubusercontent.com/pallets/click/main/x.py\n",
        encoding="utf-8",
    )
    task = harness.Task(
        id="t", repo=tmp_path, statement="fix it", held_out_run="true",
        held_out_files=(), held_out_tests=(), worker="true",
        wall_clock=1, max_iterations=1,
        forbidden_shas=("a1235aacb1be4444555566667777888899990000",),
        upstream_repo="pallets/click",
    )

    found = harness.contamination(task, workdir)

    joined = " ".join(found)
    assert "the agent found the answer" in joined, found
    assert "pallets/click" in joined, found
    assert "fetched a patch" in joined, found


def test_a_clean_run_records_nothing_and_that_is_not_a_promise(tmp_path: Path):
    """An empty list is the absence of a signal this harness knows how to look
    for — never a guarantee the agent read nothing. The docstring on
    `contamination` says so, and this pins the empty case so a future change
    cannot start inventing findings."""
    workdir = tmp_path / "arm"
    workdir.mkdir()
    (workdir / "agent.stdout.log").write_text(
        "I read src/click/core.py and fixed the bug.\n", encoding="utf-8"
    )
    task = harness.Task(
        id="t", repo=tmp_path, statement="fix it", held_out_run="true",
        held_out_files=(), held_out_tests=(), worker="true",
        wall_clock=1, max_iterations=1,
        forbidden_shas=("a1235aacb1be4444555566667777888899990000",),
        upstream_repo="pallets/click",
    )

    assert harness.contamination(task, workdir) == []


def test_an_answer_that_becomes_reachable_DURING_the_arm_is_void(tmp_path: Path):
    """**The first isolation check proves only what was true at the start.**

    An agent with a shell can make the answer reachable while it works, and on
    the 2026-08-13 corpus one line was enough: `.git/FETCH_HEAD` still named the
    full-history mirror the tree was cut from, so

        git fetch "$(sed -n '1s/.* of //p' .git/FETCH_HEAD)" main

    put the fix commit back. An independent review reproduced that on a real
    corpus tree, and nothing in the harness would have noticed — `check_isolation`
    ran once, before the agent.

    So it runs again afterwards. A run that ends with the answer in its own
    repository did not measure the agent, whatever the held-out tests then say.
    """
    repo = build_demo("covering", tmp_path)
    # A worker that does what the agent could have done: make a commit
    # reachable that was not reachable when the arm started.
    hidden = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        capture_output=True, text=True,
    ).stdout.strip()
    (repo / "reachable.sh").write_text(
        f"#!/bin/sh\ngit -C . tag wringer-test-answer {hidden}\n", encoding="utf-8"
    )

    import yaml
    task = task_file("covering", repo, tmp_path)
    raw = yaml.safe_load(task.read_text(encoding="utf-8"))
    # Forbid a sha that does NOT exist yet in the arm's copy, then create it.
    raw["forbidden_shas"] = [hidden]
    task.write_text(yaml.safe_dump(raw), encoding="utf-8")

    out = tmp_path / "out"
    run_harness(task, out)

    rows = rows_from(out)
    assert rows
    # It was reachable from the start here, so the FIRST check catches it —
    # what matters is that the message names the answer and the row is void.
    for row in rows:
        assert row["cell"] == harness.VOID, row
        assert hidden[:12] in row["reason"], row


def test_the_contamination_detector_knows_the_LOCAL_route_too(tmp_path: Path):
    """It looked only for network fetches. The cheapest route was local."""
    workdir = tmp_path / "arm"
    workdir.mkdir()
    (workdir / "agent.stdout.log").write_text(
        'sed -n "1s/.* of //p" .git/FETCH_HEAD\n'
        "git fetch /Users/x/.cache/wringer-corpus/mirrors/click main\n",
        encoding="utf-8",
    )
    task = harness.Task(
        id="t", repo=tmp_path, statement="fix it", held_out_run="true",
        held_out_files=(), held_out_tests=(), worker="true",
        wall_clock=1, max_iterations=1, forbidden_shas=("deadbeefcafe1234",),
        upstream_repo="pallets/click",
    )

    joined = " ".join(harness.contamination(task, workdir))

    assert "FETCH_HEAD" in joined, joined
    assert "mirror" in joined, joined
    assert "git fetch" in joined, joined


def test_quoting_your_own_brief_is_not_contamination(tmp_path: Path):
    """**The detector's commonest signal was firing on the brief.**

    12 of 13 corpus statements name the upstream repository, in upstream's own
    prose — that is what a real bug report looks like and it cannot be edited
    out without handing the agent something nobody wrote. So an agent that
    quoted its brief back scored a contamination signal, and the published
    counts were upper bounds inflated by echo.

    `contamination`'s own docstring promises "what the agent went and read THAT
    IT WAS NOT GIVEN". This is the line that has to honour it.
    """
    workdir = tmp_path / "arm"
    workdir.mkdir()
    (workdir / "agent.stdout.log").write_text(
        "The issue says: pallets/click misbehaves with colons. Let me look.\n",
        encoding="utf-8",
    )
    given = harness.Task(
        id="t", repo=tmp_path, statement="A bug in pallets/click: colons break.",
        held_out_run="true", held_out_files=(), held_out_tests=(), worker="true",
        wall_clock=1, max_iterations=1, forbidden_shas=(),
        upstream_repo="pallets/click",
    )
    assert harness.contamination(given, workdir) == []

    # The same log, when the statement did NOT name the repo, IS a finding.
    withheld = harness.Task(
        id="t", repo=tmp_path, statement="Colons break shell completion.",
        held_out_run="true", held_out_files=(), held_out_tests=(), worker="true",
        wall_clock=1, max_iterations=1, forbidden_shas=(),
        upstream_repo="pallets/click",
    )
    found = harness.contamination(withheld, workdir)
    assert found and "the agent found it" in " ".join(found), found


def test_no_task_statement_carries_a_pointer_somebody_ADDED(tmp_path: Path):
    """Upstream's own words may name upstream's own issues — that is what a real
    report looks like. A `Source:` header, or a title rewritten to `# <repo>
    issue #N:`, is the corpus author talking, and it points at the answer.

    Five were removed on 2026-08-13 and eight were missed; a review found them
    the next day. This is the check that would have found them first.
    """
    statements = sorted(
        (BENCHMARK / "corpus" / "statements").glob("*.md")
    )
    assert statements, "no statements to check"
    offenders = []
    for path in statements:
        head = path.read_text(encoding="utf-8").splitlines()[:3]
        for line in head:
            if line.lower().startswith("source:"):
                offenders.append(f"{path.name}: {line[:60]}")
            if re.match(r"^#\s+\S+\s+(issue|PR)\s+#\d+:", line):
                offenders.append(f"{path.name}: {line[:60]}")
    assert not offenders, (
        "these hand the agent a pointer at the upstream fix: " + str(offenders)
    )


# --- a row carries the change, because the tree does not ---------------------


def _arm_tree(tmp_path: Path) -> tuple[Path, str]:
    """A committed tree, the shape an arm is handed and then edits."""
    tree = tmp_path / "arm" / "tree"
    tree.mkdir(parents=True)

    def run(*args: str) -> None:
        done = subprocess.run(
            ["git", "-C", str(tree), *args], capture_output=True, text=True
        )
        assert done.returncode == 0, done.stderr

    run("init", "-q", "-b", "main")
    # Pinned locally for the reason tests/conftest.py pins them globally: a
    # developer's git config must never decide a test's outcome.
    run("config", "user.email", "harness@example.invalid")
    run("config", "user.name", "harness")
    run("config", "commit.gpgsign", "false")
    (tree / "src.py").write_text("value = 1\n", encoding="utf-8")
    run("add", "-A")
    run("commit", "-qm", "base")
    sha = subprocess.run(
        ["git", "-C", str(tree), "rev-parse", "HEAD"],
        capture_output=True, text=True,
    ).stdout.strip()
    return tree, sha


def test_a_patch_carries_the_files_git_has_never_seen(tmp_path: Path):
    """**The property the whole field exists for.**

    A real agent change is part edit and part new file — a new test, a new
    changelog fragment. `git diff` alone is silent about content git has never
    seen, so a row built on it would record the edit, omit the agent's new
    test, and look complete while understating every change in the corpus.
    `deliver.py` shipped that bug once already.
    """
    tree, sha = _arm_tree(tmp_path)
    (tree / "src.py").write_text("value = 2\n", encoding="utf-8")
    (tree / "test_new.py").write_text("def test_it():\n    assert True\n", "utf-8")

    patch, error = harness.change_patch(tree, sha)

    assert error is None, error
    assert "src.py" in patch, "the tracked edit is missing"
    assert "test_new.py" in patch, (
        "the agent's NEW file is missing — this is the bug this field exists "
        "to prevent, and a bare `git diff` reproduces it"
    )
    # The baseline that makes the assertion above mean something: the obvious
    # implementation really does drop the new file.
    naive = subprocess.run(
        ["git", "-C", str(tree), "diff", sha],
        capture_output=True, text=True,
    ).stdout
    assert "test_new.py" not in naive


def test_a_patch_applies_to_the_base_the_row_names(tmp_path: Path):
    """A patch nobody can apply is a string, not evidence."""
    tree, sha = _arm_tree(tmp_path)
    (tree / "src.py").write_text("value = 2\n", encoding="utf-8")
    (tree / "test_new.py").write_text("def test_it():\n    assert True\n", "utf-8")

    patch, error = harness.change_patch(tree, sha)
    assert error is None, error

    written = tmp_path / "change.patch"
    written.write_text(patch, encoding="utf-8")
    fresh = tmp_path / "fresh"
    subprocess.run(
        ["git", "-C", str(tree), "worktree", "add", "--detach", str(fresh), sha],
        capture_output=True, text=True, check=True,
    )
    done = subprocess.run(
        ["git", "-C", str(fresh), "apply", "--check", "--binary", str(written)],
        capture_output=True, text=True,
    )
    assert done.returncode == 0, done.stderr


def test_capturing_a_patch_leaves_the_arms_tree_exactly_as_found(tmp_path: Path):
    """The tree is the exhibit. Staging into the arm's own index would mean the
    harness edited the evidence while recording it, and the next reader — a
    human running `git status` in the workdir — would see the harness's
    staging rather than the agent's change."""
    tree, sha = _arm_tree(tmp_path)
    (tree / "src.py").write_text("value = 2\n", encoding="utf-8")
    (tree / "test_new.py").write_text("def test_it():\n    assert True\n", "utf-8")

    def status() -> str:
        return subprocess.run(
            ["git", "-C", str(tree), "status", "--porcelain"],
            capture_output=True, text=True,
        ).stdout

    before = status()
    assert " M src.py" in before and "?? test_new.py" in before

    harness.change_patch(tree, sha)

    assert status() == before, "the arm's index moved"
    leftovers = list(tree.parent.glob(".harness-patch-index*"))
    assert not leftovers, f"a scratch index was left in the workdir: {leftovers}"


def test_an_agent_that_changed_nothing_is_not_a_broken_instrument(tmp_path: Path):
    """`(None, None)` is a measurement and `patch_error` is a malfunction, and
    the two must never collapse into one absent field.

    This is not hypothetical: on the 2026-08-13 corpus,
    `packaging-arbitrary-equality-intersection / a_native` changed nothing at
    all and claimed success, scoring `false_confidence`. A reader who could not
    tell that from a failed capture would not be able to see the sharpest wrong
    change in the run.
    """
    tree, sha = _arm_tree(tmp_path)

    patch, error = harness.change_patch(tree, sha)

    assert patch is None
    assert error is None


def test_a_capture_that_fails_says_so_instead_of_reporting_no_change(
    tmp_path: Path
):
    """The failure mode that would quietly rewrite history: a git that cannot
    read the base returning an empty patch, which reads as "the agent did
    nothing" — an accusation the harness would be inventing."""
    tree, _ = _arm_tree(tmp_path)
    (tree / "src.py").write_text("value = 2\n", encoding="utf-8")

    patch, error = harness.change_patch(tree, "0" * 40)

    assert patch is None
    assert error, "a failed capture must name itself"


def test_a_scripted_row_carries_its_own_patch(tmp_path: Path):
    """End to end: the field is populated by a real run, not only by its unit
    test. The scripted worker edits the demo repo, so the row must show it."""
    repo = build_demo("covering", tmp_path)
    task = task_file("covering", repo, tmp_path)
    out = tmp_path / "out"

    assert run_harness(task, out) == 0

    rows = rows_from(out)
    assert rows, "no rows were written"
    for row in rows:
        assert "patch" in row, f"the key must exist to be readable: {row}"
        assert "patch_error" in row, row
        assert row["patch_error"] is None, row["patch_error"]
        assert row["patch"], "the scripted worker edits the repo, so a row must show it"
        assert "diff --git" in row["patch"], row["patch"][:200]
