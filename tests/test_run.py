"""`wring run` — the repair loop, driven by scripted workers.

Every "worker" here is a shell one-liner. The loop's contract is about what
it does with a worker's *effects*, not about intelligence, so nothing in this
file needs an LLM — and a test suite that needed one would be untestable in
CI and expensive everywhere else.
"""

from __future__ import annotations

import json
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest
from conftest import flat
from test_interrupt import SIGNAL_CEILING_SECONDS

from wringer import cli, evidence, graph, loop

# A gate that passes only once calc.py has been fixed.
CHECKS = """\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
run:
  worker: {worker}
  max_iterations: {max_iterations}
"""


def write_loop_config(repo: Path, worker: str, max_iterations: int = 3) -> None:
    # json.dumps gives a double-quoted YAML scalar, so a worker like `true`
    # stays the *string* "true" rather than becoming a boolean.
    (repo / ".wringer.yaml").write_text(
        CHECKS.format(worker=json.dumps(worker), max_iterations=max_iterations),
        encoding="utf-8",
    )


def broken(repo: Path) -> None:
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")


def only_loop(repo: Path) -> Path:
    loops = sorted((repo / loop.LOOPS_DIRNAME).iterdir())
    assert len(loops) == 1, loops
    return loops[0]


def events(loop_dir: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in (loop_dir / loop.EVENTS_FILENAME)
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]


def types(loop_dir: Path) -> list[str]:
    return [event["type"] for event in events(loop_dir)]


def manifest(loop_dir: Path) -> dict:
    return json.loads((loop_dir / loop.MANIFEST_FILENAME).read_text(encoding="utf-8"))


def test_the_console_names_every_reason_the_loop_can_stop_for():
    """The console map and the loop's own reasons must agree.

    They did not. `cli._LOOP_ENDINGS` carried four of six, so a loop that
    stopped because the worker oscillated, or because the wall clock ran out,
    printed the bare *"Stopped after N iterations."* fallback while
    `summary.md` beside it stated the true reason. There was an agreement test
    pinning graph↔loop and none pinning the console — a hand-kept table that
    drifted, in the repo whose thesis is that hand-kept tables drift.

    Set equality, not containment, in both directions: a console line for a
    reason the loop cannot produce is dead text that reads as coverage.
    """
    assert set(cli._LOOP_ENDINGS) == set(loop._REASONS), {
        "console is missing": sorted(set(loop._REASONS) - set(cli._LOOP_ENDINGS)),
        "console invents": sorted(set(cli._LOOP_ENDINGS) - set(loop._REASONS)),
    }
    # And the third copy, so all three agree rather than two of three.
    assert set(cli._LOOP_ENDINGS) == set(graph.LOOP_REASONS)
    # Every line must actually render — a template naming a field the
    # formatter is not given would raise at the worst possible moment.
    for reason, line in cli._LOOP_ENDINGS.items():
        assert line.format(n=1, s=""), reason


def test_the_fingerprint_ignores_wringers_own_evidence(repo):
    """Every verify writes a bundle. If Wringer's own output counted as a
    change, the tree would look different on every lap and no worker would
    ever be found idle."""
    before = loop.fingerprint(repo)

    written = repo / evidence.RUNS_DIRNAME / "20260731-000000-aaaa"
    written.mkdir(parents=True)
    (written / "manifest.json").write_text("{}", encoding="utf-8")

    assert loop.fingerprint(repo) == before


def test_the_fingerprint_notices_what_a_worker_would_change(repo):
    before = loop.fingerprint(repo)

    (repo / "calc.py").write_text("the worker was here\n", encoding="utf-8")

    assert loop.fingerprint(repo) != before


def test_a_worker_that_fixes_it_converges(repo, monkeypatch, capsys):
    broken(repo)
    write_loop_config(repo, "echo FIXED > calc.py")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK

    loop_dir = only_loop(repo)
    assert manifest(loop_dir)["result"] == {
        "status": "converged",
        "reason": "converged",
        "iterations": 2,
        "final_run": manifest(loop_dir)["result"]["final_run"],
    }
    assert types(loop_dir) == [
        "loop.started",
        "iteration.started",
        "verify.finished",
        "worker.started",
        "worker.finished",
        "iteration.started",
        "verify.finished",
        "loop.finished",
    ]
    # a real verify bundle per iteration, indistinguishable from a manual one
    assert len(list((repo / evidence.RUNS_DIRNAME).iterdir())) == 2
    assert "Converged in 2 iterations." in capsys.readouterr().out


def test_a_worker_that_never_fixes_it_runs_out_of_iterations(
    repo, monkeypatch, capsys
):
    broken(repo)
    # The gate echoes the file, so each lap fails *differently* and the
    # breaker (which stops repeated failure shapes) stays out of the way —
    # this test is about the iteration budget, not about oscillation.
    (repo / ".wringer.yaml").write_text(
        """\
version: 1
gates:
  - id: test
    run: "cat calc.py; grep -q FIXED calc.py"
run:
  worker: "date +%s%N >> calc.py"
  max_iterations: 3
""",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED

    loop_dir = only_loop(repo)
    result = manifest(loop_dir)["result"]
    assert result["status"] == "stopped"
    assert result["reason"] == "max_iterations"
    assert result["iterations"] == 3
    assert types(loop_dir).count("verify.finished") == 3
    # the last iteration is not briefed or worked — the budget is spent
    assert types(loop_dir).count("worker.finished") == 2
    assert "the budget ran out" in capsys.readouterr().out


def test_a_worker_that_changes_nothing_stops_without_a_second_verify(
    repo, monkeypatch, capsys
):
    """An identical tree gives an identical result; running the gates again
    to prove it would be theatre."""
    broken(repo)
    write_loop_config(repo, "true", max_iterations=5)
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED

    loop_dir = only_loop(repo)
    result = manifest(loop_dir)["result"]
    assert result["reason"] == "no_progress"
    # exactly two verifications: the first, and the one that caught the
    # unchanged tree. Not five.
    assert types(loop_dir).count("verify.finished") == 2
    assert types(loop_dir).count("worker.finished") == 1
    assert "changed nothing" in capsys.readouterr().out


def test_the_evidence_decides_not_the_workers_exit_code(repo, monkeypatch, capsys):
    """A worker that fixed the bug and then fell over has still fixed the
    bug. Its opinion of itself is not evidence."""
    broken(repo)
    write_loop_config(repo, "echo FIXED > calc.py; exit 7")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK

    loop_dir = only_loop(repo)
    assert manifest(loop_dir)["result"]["status"] == "converged"
    finished = [e for e in events(loop_dir) if e["type"] == "worker.finished"]
    assert finished[0]["exit_code"] == 7  # recorded, not acted on
    capsys.readouterr()


def test_a_worker_that_overruns_is_killed_and_the_loop_continues(
    repo, monkeypatch, capsys
):
    broken(repo)
    (repo / ".wringer.yaml").write_text(
        """\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
run:
  worker: "sleep 30"
  max_iterations: 2
  worker_timeout: 1
""",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    started = time.monotonic()
    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    elapsed = time.monotonic() - started

    assert elapsed < 25, f"the worker's timeout did not stick ({elapsed:.1f}s)"
    loop_dir = only_loop(repo)
    finished = [e for e in events(loop_dir) if e["type"] == "worker.finished"]
    assert finished and finished[0]["timed_out"] is True
    # it slept rather than editing, so the tree is unchanged
    assert manifest(loop_dir)["result"]["reason"] == "no_progress"
    assert "timed out" in capsys.readouterr().out


def test_a_missing_run_section_is_a_config_error(
    repo, write_config, monkeypatch, capsys
):
    write_config(
        repo,
        """\
version: 1
gates:
  - id: test
    run: "true"
""",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_CONFIG

    err = flat(capsys.readouterr().err)
    assert "no 'run:' section" in err
    assert "never one it guessed" in err
    assert not (repo / loop.LOOPS_DIRNAME).exists()


def test_run_outside_a_repository_is_refused(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)

    assert cli.main(["run"]) == cli.EXIT_CONFIG

    assert "not a git repository" in capsys.readouterr().err


def test_run_refuses_mid_merge(repo, git_run, monkeypatch, capsys):
    broken(repo)
    write_loop_config(repo, "true")
    git_run(repo, "add", "-A")
    git_run(repo, "commit", "-q", "-m", "base")
    git_run(repo, "checkout", "-q", "-b", "other")
    (repo / "calc.py").write_text("THEIRS\n", encoding="utf-8")
    git_run(repo, "commit", "-qam", "theirs")
    git_run(repo, "checkout", "-q", "main")
    (repo / "calc.py").write_text("OURS\n", encoding="utf-8")
    git_run(repo, "commit", "-qam", "ours")
    git_run(repo, "merge", "other", check=False)
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_REFUSED

    assert "in the middle of a merge" in capsys.readouterr().err


@pytest.mark.parametrize(
    "worker, expected_status, expected_reason",
    [
        ("echo FIXED > calc.py", "converged", "converged"),
        ("true", "stopped", "no_progress"),
    ],
)
def test_json_keys_are_stable(
    repo, monkeypatch, capfd, worker, expected_status, expected_reason
):
    broken(repo)
    write_loop_config(repo, worker)
    monkeypatch.chdir(repo)

    cli.main(["run", "--json"])

    payload = json.loads(capfd.readouterr().out)
    assert set(payload) == {"status", "reason", "iterations", "loop_dir", "final"}
    assert payload["status"] == expected_status
    assert payload["reason"] == expected_reason
    assert set(payload["final"]) == {
        "status",
        "failed_gate",
        "rerun",
        "evidence_dir",
    }


def test_max_iterations_can_be_overridden(repo, monkeypatch, capsys):
    broken(repo)
    write_loop_config(repo, "date +%s%N >> calc.py", max_iterations=9)
    monkeypatch.chdir(repo)

    assert cli.main(["run", "--max-iterations", "2"]) == cli.EXIT_GATE_FAILED

    assert manifest(only_loop(repo))["result"]["iterations"] == 2
    capsys.readouterr()


def test_a_secret_never_reaches_the_workers_log(repo, monkeypatch, capsys):
    broken(repo)
    write_loop_config(repo, "echo $MY_TOKEN; echo FIXED > calc.py")
    monkeypatch.setenv("MY_TOKEN", "hushhush12345")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK

    log = (
        only_loop(repo) / loop.ITERATIONS_DIRNAME / "001" / "worker.stdout.log"
    ).read_text(encoding="utf-8")
    assert "hushhush12345" not in log
    assert "[REDACTED]" in log
    capsys.readouterr()


def test_the_brief_carries_the_json_and_the_failing_output(repo, monkeypatch, capsys):
    broken(repo)
    (repo / ".wringer.yaml").write_text(
        """\
version: 1
gates:
  - id: test
    run: "echo the-planted-failure >&2; grep -q FIXED calc.py"
run:
  worker: "cp {brief} captured-brief.md; echo FIXED > calc.py"
""",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK

    # the worker was handed a real path it could read
    brief = (repo / "captured-brief.md").read_text(encoding="utf-8")
    assert '"failed_gate": "test"' in brief
    assert "the-planted-failure" in brief
    assert "wring verify --gate test" in brief
    assert "Do not edit anything under `.wringer/`" in brief
    capsys.readouterr()


def test_a_real_sigint_stops_the_loop_and_the_worker(repo):
    """Ctrl-C during a worker's turn: exit 4, the worker's process group
    dies with it, and the bundle admits where it stopped."""
    broken(repo)
    (repo / ".wringer.yaml").write_text(
        """\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
run:
  worker: "echo $$ > worker.pid; sleep 30"
  worker_timeout: 60
""",
        encoding="utf-8",
    )

    proc = subprocess.Popen(
        [sys.executable, "-m", "wringer", "run"],
        cwd=repo,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    pid_file = repo / "worker.pid"
    deadline = time.monotonic() + SIGNAL_CEILING_SECONDS
    while not pid_file.exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    assert pid_file.exists(), "the worker never started"

    proc.send_signal(signal.SIGINT)
    proc.communicate(timeout=SIGNAL_CEILING_SECONDS)
    assert proc.returncode == cli.EXIT_INTERRUPTED

    worker_pid = int(pid_file.read_text(encoding="utf-8").strip())
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            import os

            os.kill(worker_pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.05)
    else:
        pytest.fail(f"worker {worker_pid} survived the interrupt")

    loop_dir = only_loop(repo)
    result = manifest(loop_dir)["result"]
    assert result["status"] == "interrupted"
    recorded = types(loop_dir)
    # started and never finished — the honest record of a killed worker
    assert recorded.count("worker.started") == 1
    assert recorded.count("worker.finished") == 0
    assert recorded[-1] == "loop.finished"


# --- what is being built (F3) --------------------------------------------
#
# Measured 2026-08-10 in docs/factory-dry-run.md §4: the brief the loop hands
# a worker was thirty-five lines about a failing gate with not one word about
# the feature. `wring plan` knows the objective and did not pass it on; `wring
# run` knew what was broken and did not know why. These pin the opening
# section that carries the intent across, and the boundary — approval, the
# same one acceptance uses — that leaves every other repo on exactly the
# brief it had before.

SPEC = """\
schema_version: wringer.spec.v1
approved: {approved}
title: Add CSV export to the reports page
intent: |2
  Finance copies the reports table into a spreadsheet by hand every Monday.
criteria:
  - id: header-matches-columns
    title: The header row matches the table columns in order
    guidance: A test compares the header to the rendered columns.
    required: true
    human: false
  - id: every-row-exported
    title: Every row in the table appears in the export
    guidance: A test counts the rows.
    required: true
    human: false
  - id: button-copy-reads-well
    title: The export button copy reads the way a finance team expects
    guidance: Someone from finance reads the button and says so.
    required: true
    human: true
tasks:
{tasks}"""

ONE_TASK = """\
  - id: csv-export
    brief: briefs/csv-export.md
    dir: .
    objective: Add a to_csv() to reports and a button that calls it.
"""

TWO_TASKS = ONE_TASK + """\
  - id: csv-docs
    brief: briefs/csv-docs.md
    dir: .
    objective: Document the export in the reports README.
"""

# What `wring plan` leaves on disk for a task: the objective, the PM's own
# words, and the decisions already made.
TASK_BRIEF = """\
# Add a to_csv() to reports and a button that calls it

Finance copies the reports table into a spreadsheet by hand every Monday.

## Decisions already made
- date-format: ISO-8601.
"""

# The gate fails loudly and is bound to one of the three criteria, so a brief
# built from this repo has both a binding and a criterion with none.
BOUND_CONFIG = """\
version: 1
gates:
  - id: test
    run: "echo the-planted-failure >&2; grep -q FIXED calc.py"
    proves: header-matches-columns
run:
  worker: "cp {brief} captured-brief.md; echo FIXED > calc.py"
"""

# The same repo without the join, for the cases where no spec is on disk at
# all — a `proves:` with nothing to bind to is a config error by design.
UNBOUND_CONFIG = BOUND_CONFIG.replace("    proves: header-matches-columns\n", "")


def spec_repo(
    repo: Path,
    *,
    approved: bool = True,
    tasks: str = ONE_TASK,
    body: str = BOUND_CONFIG,
) -> None:
    broken(repo)
    (repo / ".wringer.yaml").write_text(body, encoding="utf-8")
    (repo / "wringer.spec.yaml").write_text(
        SPEC.format(approved="true" if approved else "false", tasks=tasks),
        encoding="utf-8",
    )
    briefs = repo / "briefs"
    briefs.mkdir(exist_ok=True)
    (briefs / "csv-export.md").write_text(TASK_BRIEF, encoding="utf-8")
    (briefs / "csv-docs.md").write_text("# Document it\n", encoding="utf-8")


def captured(repo: Path) -> str:
    """The brief the worker actually received, as bytes on disk."""
    return (repo / "captured-brief.md").read_text(encoding="utf-8")


def test_an_approved_spec_opens_the_brief_with_what_is_being_built(
    repo, monkeypatch, capsys
):
    """The objective, the criteria and their bindings, then the failing gate.

    Nothing names the task here and nothing needs to: the spec declares one,
    so there is nothing to choose between.
    """
    spec_repo(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    brief = flat(captured(repo))

    # what is being built comes FIRST — before a word about any gate
    assert brief.index("What you are building") < brief.index("Fix this")
    assert "Add CSV export to the reports page" in brief
    assert "Finance copies the reports table into a spreadsheet by hand" in brief
    assert "Add a to_csv() to reports and a button that calls it" in brief

    # every machine criterion, by id and title, with its binding named
    assert (
        "`header-matches-columns` — The header row matches the table columns "
        "in order — bound to `test`"
    ) in brief
    assert (
        "`every-row-exported` — Every row in the table appears in the export "
        "— UNBOUND"
    ) in brief

    # and the failing-gate evidence, unchanged
    assert '"failed_gate": "test"' in brief
    assert "the-planted-failure" in brief
    assert "wring verify --gate test" in brief
    capsys.readouterr()


def test_a_human_criterion_is_one_line_and_never_carries_its_guidance(
    repo, monkeypatch, capsys
):
    """A worker has no business optimising for taste no gate can score it on,
    so the ids travel and the guidance does not."""
    spec_repo(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    brief = flat(captured(repo))

    assert "judged by people, not gates: `button-copy-reads-well`" in brief
    assert "Someone from finance reads the button and says so." not in brief
    # and it is not sitting in the machine list with a binding status
    assert "`button-copy-reads-well` — The export button copy" not in brief
    capsys.readouterr()


@pytest.mark.parametrize("spec_state", ["absent", "unapproved"])
def test_without_an_approved_spec_the_brief_is_the_one_it_always_was(
    repo, monkeypatch, capsys, spec_state
):
    """The opt-in boundary is approval — SPEC_ACCEPT ruling 8, the same one,
    read through the same reader.

    A repo that never ran `wring spec`, and one whose spec a human has not
    approved yet, both get the brief they had before any of this existed:
    the same first line, the same headings, in the same order, and not one
    word from the spec.
    """
    if spec_state == "absent":
        broken(repo)
        (repo / ".wringer.yaml").write_text(UNBOUND_CONFIG, encoding="utf-8")
    else:
        spec_repo(repo, approved=False, body=UNBOUND_CONFIG)
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    brief = captured(repo)

    assert brief.startswith("# Fix this\n")
    assert [line for line in brief.splitlines() if line.startswith("#")] == [
        "# Fix this",
        "## Failing gate: `test`",
        "### stderr",
        "## What to do",
    ]
    for stranger in (
        "What you are building",
        "judged by people",
        "UNBOUND",
        "CSV export",
    ):
        assert stranger not in brief
    capsys.readouterr()


def test_under_fleet_the_task_brief_is_inlined_not_only_named(
    repo, monkeypatch, capsys
):
    """`WRINGER_TASK_BRIEF` names a file a worker had to know to read. Its
    contents now travel IN the brief; the variable stays for the workers that
    already read it (docs/factory-dry-run.md §4).

    Two tasks, so the environment is doing the naming: the single-task
    shortcut cannot account for this one.
    """
    spec_repo(repo, tasks=TWO_TASKS)
    monkeypatch.chdir(repo)
    monkeypatch.setenv("WRINGER_TASK_ID", "csv-export")
    monkeypatch.setenv(
        "WRINGER_TASK_BRIEF", str(repo / "briefs" / "csv-export.md")
    )

    assert cli.main(["run"]) == cli.EXIT_OK
    brief = flat(captured(repo))

    assert "Add a to_csv() to reports and a button that calls it" in brief
    # the file's own contents, not just its path
    assert "date-format: ISO-8601." in brief
    assert "briefs/csv-export.md" in brief
    # the other task's objective is not smuggled in
    assert "Document the export in the reports README" not in brief
    capsys.readouterr()


def test_several_tasks_and_nothing_naming_one_invents_no_objective(
    repo, monkeypatch, capsys
):
    """Absence is absence. The spec's intent and criteria still travel — they
    are the same whichever task this is — and the objective says it is
    missing rather than picking one."""
    spec_repo(repo, tasks=TWO_TASKS)
    monkeypatch.delenv("WRINGER_TASK_ID", raising=False)
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    brief = flat(captured(repo))

    assert "Add CSV export to the reports page" in brief
    assert "`header-matches-columns`" in brief
    assert (
        "declares 2 tasks and nothing named which one this loop is running"
    ) in brief
    assert "Add a to_csv()" not in brief
    assert "date-format: ISO-8601." not in brief
    capsys.readouterr()


def test_a_task_id_the_spec_does_not_declare_is_said_rather_than_guessed(
    repo, monkeypatch, capsys
):
    """A spec edited after `wring plan` ran leaves the environment naming a
    task that is gone. The brief says so; picking the nearest one would be a
    worker building the wrong thing with confidence."""
    spec_repo(repo, tasks=TWO_TASKS)
    monkeypatch.chdir(repo)
    monkeypatch.setenv("WRINGER_TASK_ID", "csv-exprot")

    assert cli.main(["run"]) == cli.EXIT_OK
    brief = flat(captured(repo))

    assert (
        "`WRINGER_TASK_ID` names 'csv-exprot', which `wringer.spec.yaml` "
        "does not declare"
    ) in brief
    assert "Add a to_csv()" not in brief
    # the spec-wide half still travels: it is the same whichever task this is
    assert "Add CSV export to the reports page" in brief
    capsys.readouterr()


HUMAN_ONLY_SPEC = """\
schema_version: wringer.spec.v1
approved: true
title: Rewrite the onboarding copy
intent: |2
  The onboarding page reads like a legal notice.
criteria:
  - id: copy-reads-well
    title: The onboarding copy reads like a person wrote it
    guidance: Someone outside the team reads it and says so.
    required: true
    human: true
tasks:
  - id: onboarding-copy
    brief: briefs/csv-export.md
    dir: .
    objective: Rewrite the three paragraphs on the onboarding page.
"""


def test_a_spec_only_people_can_judge_says_that_and_lists_no_gates(
    repo, monkeypatch, capsys
):
    """Nothing machine-checkable in the spec: the brief must not print an
    empty list of criteria under a heading promising bindings."""
    spec_repo(repo, body=UNBOUND_CONFIG)
    (repo / "wringer.spec.yaml").write_text(HUMAN_ONLY_SPEC, encoding="utf-8")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    brief = flat(captured(repo))

    assert "judged by people, not gates: `copy-reads-well`" in brief
    assert "the gate bound to each" not in brief
    assert "UNBOUND" not in brief
    capsys.readouterr()


def headings(text: str) -> list[str]:
    """The document's OWN headings — what a markdown outline shows.

    Fenced regions are excluded because they are quoted, not said: a brief
    that inlines another file inherits that file's `#` lines otherwise.
    """
    found: list[str] = []
    fence: str | None = None
    for line in text.splitlines():
        stripped = line.strip()
        if fence is None:
            if stripped.startswith("```"):
                fence = stripped[: len(stripped) - len(stripped.lstrip("`"))]
            elif line.startswith("#"):
                found.append(line)
        elif stripped.startswith(fence) and set(stripped) == {"`"}:
            fence = None
    return found


def test_the_task_brief_is_quoted_so_its_headings_are_not_this_documents(
    repo, monkeypatch, capsys
):
    """`wring plan` writes briefs with headings of their own. Pasted bare,
    the task's "Decisions already made" becomes a peer of "What finishing
    means" and the seam between two documents disappears.

    Found by reading the first real brief this produced — the outline was
    wrong in a way no assertion here had thought to ask about.
    """
    spec_repo(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK

    assert headings(captured(repo)) == [
        "# What you are building",
        "## This task — `csv-export`",
        "### The brief for it (`briefs/csv-export.md`)",
        "## What finishing means",
        "# Fix this",
        "## Failing gate: `test`",
        "### stderr",
        "## What to do",
    ]
    capsys.readouterr()


def test_a_brief_full_of_backticks_does_not_close_the_fence_early(
    repo, monkeypatch, capsys
):
    """A task about markdown carries fences of its own. A three-tick quote
    would end inside it and hand the worker a document that stops mid-file."""
    spec_repo(repo)
    (repo / "briefs" / "csv-export.md").write_text(
        "# Document the export\n\n"
        "Show the call:\n\n"
        "```python\nreports.to_csv()\n```\n\n"
        "Then say `to_csv` reads the shown rows.\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    brief = captured(repo)

    # the whole file arrived, fences and all
    assert "reports.to_csv()" in brief
    assert "Then say `to_csv` reads the shown rows." in brief
    # and the document that came back is still one document
    assert headings(brief) == [
        "# What you are building",
        "## This task — `csv-export`",
        "### The brief for it (`briefs/csv-export.md`)",
        "## What finishing means",
        "# Fix this",
        "## Failing gate: `test`",
        "### stderr",
        "## What to do",
    ]
    capsys.readouterr()


def test_a_subdirectory_of_the_specs_repo_still_sees_the_spec(
    repo, monkeypatch, capsys
):
    """The loop resolves its root the way every other command does — `git
    rev-parse --show-toplevel` — so running from a subdirectory of the spec's
    repository reaches the spec at the top.

    Measured after a first draft of docs/brief-quality.md claimed the
    opposite from reading the code.
    """
    spec_repo(repo, body=UNBOUND_CONFIG)
    (repo / "sub").mkdir()
    monkeypatch.chdir(repo / "sub")

    assert cli.main(["run"]) == cli.EXIT_OK
    brief = flat(captured(repo))

    assert "What you are building" in brief
    assert "Add CSV export to the reports page" in brief
    capsys.readouterr()


def test_a_task_in_its_own_repository_does_not_see_the_parents_spec(
    repo, git_run, monkeypatch, capsys
):
    """The real limit, and the layout `wring fleet`'s own tests use: a task
    directory that is its own git repository is its own root, so the spec one
    level up is not its spec. It gets the brief it always got."""
    spec_repo(repo, body=UNBOUND_CONFIG)
    inner = repo / "sub"
    inner.mkdir()
    git_run(inner, "init", "-q", "-b", "main")
    (inner / ".wringer.yaml").write_text(UNBOUND_CONFIG, encoding="utf-8")
    (inner / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    monkeypatch.chdir(inner)
    monkeypatch.setenv("WRINGER_TASK_ID", "csv-export")

    assert cli.main(["run"]) == cli.EXIT_OK
    brief = captured(inner)

    assert brief.startswith("# Fix this\n")
    assert "What you are building" not in brief
    capsys.readouterr()
