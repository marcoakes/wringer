"""Every printed command is executed in CI, as printed (P0.5, 0.7.5).

**The body count.** Runs 4 and 4B, 2026-09-01: two audit instructions
failed AS PRINTED before one was ever executed — first without a copy
step (`no such file`), then without the branch checkout ("could NOT be
checked from here") — and run 4B's operator followed a printed command
into a dead end. Each was fixed one at a time as the findings arrived
(0.6.6, 0.6.7, 0.7.3). This module is the harness the law names: a
REGISTRY of every command family the product prints, one row each, and
one parametrized test that obtains the printed text from the REAL
surface, extracts the command, runs it through the real entry point
exactly as printed, and asserts the outcome the surface promises.

Writing it found a fourth: the loop's missing-agent hint offered
`npm bin -g`, a subcommand npm removed in 9.0 — exit 1 on npm 11.17.0
("To see a list of supported npm commands, run: npm help"). Dead as
printed for the whole life of the message; nothing had run it.

**What the guard walks.** The same string literals the 0.6.6 installed-
pointer guard walks (`tests/test_docs.py`), docstrings exempt: a literal
is command-shaped when a product verb (`wring`, `wringer-drive`,
`wringer-board`, `npm`, `security`, `uv`) followed by a word, or `git`
followed by a real subcommand, opens a line or follows a newline, colon,
backtick, quote or the word "with". Two refinements were MEASURED before
the regex was written, against 252 literals the naive form matched:
`wring verify: <message>` is the verb naming itself (a label, 110
sites, none of them a command), and `git repository` / `git present` are
English (so `git` needs a subcommand). The remainder rule below says
where a command ends: a row's pattern must consume the whole argv-like
prefix, so a NEW flag on an old verb is unregistered until somebody runs
it. Vendor-neutral by construction: no vendor's binary is a verb here,
and a worker COMMAND the operator typed is not a printed command.

**Dispositions.** A row is executed here; or it names the CI test that
already executes it end to end (checked to exist); or it is HUMAN-ONLY
with a reason CI may not run it — a package manager, the operator's
Keychain, a merge request on a forge. Nothing else is allowed.
"""

from __future__ import annotations

import ast
import dataclasses
import io
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import pytest
from core_helpers import flat, repo_root
from test_bench import CONFIG as BENCH_CONFIG
from test_bench import setup as bench_setup
from test_deliver import (  # noqa: F401
    CONFIG as DELIVER_CONFIG,
)
from test_deliver import (  # noqa: F401
    ISSUE_REPLY,
    MR_REPLY,
    accepting_repo,
    delivery_repo,
    fake_forge,
    git,
    verified,
)
from test_graph_run import PARKS
from test_judge import RUBRIC
from test_spec import DRAFT, fake_transport
from test_spec import reply as drafter_reply

from wringer import agents, bench, cli, deliver, health
from wringer import spec as spec_module
from wringer_board import refusals
from wringer_board.__main__ import main as board_main
from wringer_drive import run as drive_run
from wringer_drive.__main__ import main as drive_main

PACKAGES = ("wringer", "wringer_board", "wringer_drive")

# --- running a printed command, as printed ---------------------------------


@dataclass(frozen=True)
class Done:
    code: int
    out: str
    err: str

    @property
    def text(self) -> str:
        return self.out + self.err


@dataclass
class Ctx:
    """What a row needs: pytest's fixtures, and a place to keep what the
    capture step learned for the executor."""

    request: pytest.FixtureRequest
    tmp_path: Path
    monkeypatch: pytest.MonkeyPatch
    capsys: pytest.CaptureFixture
    state: dict = field(default_factory=dict)

    def fixture(self, name: str):
        return self.request.getfixturevalue(name)

    def outside(self, suffix: str) -> Path:
        """A directory OUTSIDE the scratch repo (`tmp_path` IS the repo, so a
        child of it would be inside a git tree)."""
        path = self.tmp_path.parent / f"{self.tmp_path.name}-{suffix}"
        path.mkdir()
        return path


ENTRY_POINTS = {
    "wring": cli.main,
    "wringer-drive": drive_main,
    "wringer-board": board_main,
}


def execute(ctx: Ctx, command: str, *, stdin: str = "") -> Done:
    """ONE printed command, through the real entry point, in the cwd the
    fixture stands in. A product verb runs in process (`cli.main` and the
    two `__main__.main`s); anything else — git, npm, sh — is a subprocess.
    Never a mock of either."""
    argv = shlex.split(command)
    ctx.capsys.readouterr()
    entry = ENTRY_POINTS.get(argv[0])
    if entry is None:
        done = subprocess.run(
            argv, cwd=Path.cwd(), input=stdin, capture_output=True, text=True,
            check=False,
        )
        return Done(done.returncode, done.stdout, done.stderr)
    original = sys.stdin
    sys.stdin = io.StringIO(stdin)
    try:
        code = entry(argv[1:])
    except SystemExit as exc:  # argparse: --help, and a usage error
        code = exc.code if isinstance(exc.code, int) else 1
    finally:
        sys.stdin = original
    out, err = ctx.capsys.readouterr()
    return Done(code, out, err)


# --- the registry row -----------------------------------------------------


@dataclass(frozen=True)
class Printed:
    """One printed command family.

    `capture` runs the real surface and returns what it printed; `extract`
    is the regex (one group, `re.M`) that lifts the command out of it;
    `execute` runs the extracted command(s) — ALWAYS through `execute()`
    above — and asserts `promise`. A row with no `capture` is a family the
    product names in prose (`wring doctor` names it): its `canonical` form
    is what runs. `patterns` are anchored regexes the guard matches a
    command-shaped literal against; the longest consuming match wins.
    """

    family: str
    printed_by: tuple[str, ...]
    patterns: tuple[str, ...]
    promise: str
    capture: Callable[[Ctx], str] | None = None
    extract: str = ""
    execute: Callable[[Ctx, list[str]], None] | None = None
    canonical: str = ""
    executed_by: tuple[str, ...] = ()
    human_only: str | None = None


# --- fixtures the rows build ------------------------------------------------


def write_config(repo: Path, gates: list[tuple[str, str]], extra: str = "") -> None:
    body = "version: 1\ngates:\n"
    for gate_id, command in gates:
        body += f"  - id: {gate_id}\n    run: {json.dumps(command)}\n"
    (repo / ".wringer.yaml").write_text(body + extra, encoding="utf-8")


JUDGE_SECTION = (
    "judge:\n"
    "  endpoint: http://127.0.0.1:1/v1/chat/completions\n"
    "  model: none\n"
    "  rubric: rubric.yaml\n"
)

RUN_SECTION = (
    "run:\n"
    "  worker: ': {brief}; true'\n"
    "  max_iterations: 1\n"
)


def runs_of(repo: Path) -> set[Path]:
    root = repo / ".wringer" / "runs"
    return set(root.iterdir()) if root.is_dir() else set()


def only_delivery(repo: Path) -> Path:
    found = sorted((repo / ".wringer" / "deliveries").iterdir())
    assert len(found) == 1, found
    return found[0]


def one_new_run(repo: Path, before: set[Path]) -> Path:
    new = runs_of(repo) - before
    assert len(new) == 1, sorted(new)
    (run_dir,) = new
    return run_dir


def dry_run_delivery(ctx: Ctx) -> tuple[Path, str]:
    """`wring deliver` (dry run) in the file://-origin fixture; the delivery
    directory and the console it printed."""
    repo = ctx.fixture("delivery_repo")
    verified(repo, ctx.monkeypatch, ctx.capsys)
    assert cli.main(["deliver"]) == cli.EXIT_OK
    console = ctx.capsys.readouterr().out
    delivery = only_delivery(repo)
    ctx.state.update(repo=repo, delivery=delivery, console=console)
    return delivery, console


def ship(ctx: Ctx) -> tuple[Path, Path, str]:
    """A real red-first delivery, SENT — the shape `test_falsify_committed`
    drives — and the console `--send` printed."""
    repo = ctx.fixture("delivery_repo")
    accepting_repo(repo, bound=False)
    (repo / ".wringer.yaml").write_text(
        DELIVER_CONFIG.replace(
            '  - id: check\n    run: "true"\n',
            '  - id: check\n    run: "grep -q FIXED flag.txt"\n'
            "    proves: csv-downloads\n",
        ),
        encoding="utf-8",
    )
    ctx.monkeypatch.chdir(repo)
    (repo / "flag.txt").write_text("BROKEN\n", encoding="utf-8")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    ctx.capsys.readouterr()
    (repo / "flag.txt").write_text("FIXED\n", encoding="utf-8")
    (repo / "calc.py").write_text(
        "def add(a, b):\n    return a + b\n\n\n"
        "def is_even(n):\n    return n % 2 == 0\n",
        encoding="utf-8",
    )
    assert cli.main(["verify"]) == cli.EXIT_OK
    ctx.capsys.readouterr()
    fake_forge(ctx.monkeypatch, reply=MR_REPLY)
    assert cli.main(["deliver", "--send"]) == cli.EXIT_OK
    console = ctx.capsys.readouterr().out
    delivery = only_delivery(repo)
    subprocess.run(["git", "checkout", "-q", "."], cwd=repo, check=True)
    ctx.state.update(repo=repo, delivery=delivery)
    return repo, delivery, console


def drive_project(ctx: Ctx, *, gate: str, worker: str) -> Path:
    """The repository `tests/drive` builds, from the ENGINE's own renderer —
    duplicated the way that suite duplicates it, so this file stands alone."""
    repo = ctx.tmp_path / "project"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=repo, check=True)
    for key, value in (
        ("user.email", "pm@e.invalid"),
        ("user.name", "PM"),
        ("commit.gpgsign", "false"),
    ):
        subprocess.run(["git", "config", key, value], cwd=repo, check=True)
    drafted = spec_module.Spec(
        approved=False,
        title="Weekly report export",
        intent="A manager can export the weekly report as a CSV.",
        questions=(
            spec_module.Question(
                id="which-columns", question="Which columns?", required=True
            ),
        ),
        criteria=(
            spec_module.Criterion(
                id="exports-csv", title="It exports a CSV", required=True
            ),
        ),
        gates=(),
        tasks=(
            spec_module.Task(
                id="build", brief="briefs/build.md", objective="It exports."
            ),
        ),
        path="wringer.spec.yaml",
    )
    (repo / "wringer.spec.yaml").write_text(
        spec_module.render(drafted), encoding="utf-8"
    )
    (repo / ".wringer.yaml").write_text(
        "version: 1\n"
        "gates:\n"
        "  - id: unit\n"
        f"    run: {json.dumps(gate)}\n"
        "\n" + JUDGE_SECTION.replace("rubric.yaml", "wringer.rubric.yaml") +
        "\n"
        "run:\n"
        f"  worker: {json.dumps(worker)}\n"
        "  max_iterations: 1\n"
        "\n"
        "deliver:\n"
        '  branch: "wringer/{run}"\n',
        encoding="utf-8",
    )
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "base"], cwd=repo, check=True)
    ctx.state["project"] = repo
    return repo


def prd(ctx: Ctx) -> Path:
    path = ctx.tmp_path / "PRD.md"
    path.write_text("We need the weekly report as a CSV.\n", encoding="utf-8")
    return path


def drive_json(argv: list[str], typed: str) -> tuple[int, list[dict]]:
    """One whole drive invocation in json mode, `typed` being everything the
    person types; the ordered steps, one object per line."""
    original_in, original_out = sys.stdin, sys.stdout
    sys.stdin = io.StringIO(typed)
    sys.stdout = captured = io.StringIO()
    try:
        code = drive_main([*argv, "--emit", "json"])
    finally:
        sys.stdin, sys.stdout = original_in, original_out
    steps = [
        json.loads(line)
        for line in captured.getvalue().splitlines()
        if line.strip()
    ]
    return code, steps


BOARD_SPEC = """\
schema_version: wringer.spec.v1
approved: true
title: Arcade
intent: Players pick up where they left off.
open_questions: []
criteria:
  - id: heading-reads-as-mine
    title: The heading reads as mine
    guidance: Decide whether it sounds like your product.
    required: true
    human: true
  - id: machine-one
    title: A test asserts the row renders
    required: true
    human: false
gates: []
tasks:
  - id: build
    brief: briefs/build.md
    dir: .
    objective: Build it.
"""


def board_project(ctx: Ctx) -> Path:
    """A spec with a `human` criterion and a working `show:` for it — the
    pen fails closed without a display (0.6.1)."""
    root = ctx.tmp_path / "board-project"
    root.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=root, check=True)
    subprocess.run(
        ["git", "config", "user.name", "A Person"], cwd=root, check=True
    )
    (root / "wringer.spec.yaml").write_text(BOARD_SPEC, encoding="utf-8")
    write_config(
        root, [("t", "true")],
        'show:\n  heading-reads-as-mine: "echo the heading, as a person sees it"\n',
    )
    return root


SANDBOX_TOOLS = (
    "git", "node", "npm", "sh", "env", "chmod", "dirname", "basename", "cp",
    "mkdir", "rm", "cat", "sed", "tr", "pwd", "grep", "true", "false",
)


def sandbox_bin(where: Path) -> Path:
    """The 0.6.6 front-door sandbox: everything a setup script legitimately
    needs and nothing else, `uv` a stub that makes `.venv/bin/python` this
    suite's own interpreter (offline by construction)."""
    bin_dir = where / "bin"
    bin_dir.mkdir()
    for tool in SANDBOX_TOOLS:
        found = shutil.which(tool)
        if found:
            (bin_dir / tool).symlink_to(found)
    (bin_dir / "uv").write_text(
        "#!/bin/sh\n"
        'if [ "$1" = venv ]; then\n'
        "  mkdir -p .venv/bin\n"
        "  cat > .venv/bin/python <<SHIM\n"
        "#!/bin/sh\n"
        f'exec "{sys.executable}" "\\$@"\n'
        "SHIM\n"
        "  chmod +x .venv/bin/python\n"
        "  exit 0\n"
        "fi\n"
        'if [ "$1" = pip ]; then exit 0; fi\n'
        "exit 1\n",
        encoding="utf-8",
    )
    (bin_dir / "uv").chmod(0o755)
    return bin_dir


def no_traceback(done: Done) -> None:
    assert "Traceback" not in done.text, done.text


# --- rows: the delivery ------------------------------------------------------


def capture_commands_txt(ctx: Ctx) -> str:
    delivery, _ = dry_run_delivery(ctx)
    return (delivery / deliver.COMMANDS_FILENAME).read_text(encoding="utf-8")


def execute_git_sequence(ctx: Ctx, commands: list[str]) -> None:
    repo, delivery, console = (
        ctx.state["repo"], ctx.state["delivery"], ctx.state["console"]
    )
    manifest = json.loads(
        (delivery / deliver.MANIFEST_FILENAME).read_text(encoding="utf-8")
    )
    branch = manifest["branch"]
    assert [c.split()[1] for c in commands] == ["switch", "add", "commit", "push"]
    # `<id>` is the one placeholder in commands.txt. The dry run printed the
    # real directory beside the file list, which is how a person substitutes
    # it — assert that, or the substitution below is this test's secret.
    assert f".wringer/deliveries/{delivery.name}/" in console, console
    for line in commands:
        line = line.replace("<id>", delivery.name)
        stdin = ""
        if "--pathspec-from-file=-" in line:
            stdin = "\0".join(manifest["files"])
        done = execute(ctx, line, stdin=stdin)
        assert done.code == 0, f"{line!r} failed as printed:\n{done.text}"
    assert git(repo, "branch", "--show-current") == branch
    assert branch in git(repo, "ls-remote", "--heads", "origin", branch)
    message = (delivery / deliver.COMMIT_FILENAME).read_text(encoding="utf-8")
    assert git(repo, "log", "-1", "--format=%B").strip() == message.strip()


def capture_falsify(ctx: Ctx) -> str:
    repo, delivery, console = ship(ctx)
    commands = (delivery / deliver.COMMANDS_FILENAME).read_text(encoding="utf-8")
    done = drive_run.final_step(
        repo, repo / "board.html", {"delivery_dir": str(delivery)}
    )
    return "\n".join([console, commands, done.text, done.detail["falsify"]])


def execute_falsify(ctx: Ctx, commands: list[str]) -> None:
    repo, delivery = ctx.state["repo"], ctx.state["delivery"]
    assert len(commands) == 4, commands  # console, commands.txt, step, detail
    assert any("<id>" in c for c in commands), "commands.txt lost its placeholder"
    forms = {c.replace("<id>", delivery.name) for c in commands}
    assert len(forms) == 1, f"the surfaces disagree about the command: {forms}"
    (command,) = forms
    before = runs_of(repo)
    done = execute(ctx, command)
    assert done.code == cli.EXIT_OK, done.text
    recorded = json.loads(
        (one_new_run(repo, before) / "falsification.json").read_text("utf-8")
    )
    assert recorded["verdict"] == "measured", recorded
    assert recorded["counts"]["attempted"] >= 1, recorded
    assert "committed range" in done.out, done.out


def capture_deliver_send(ctx: Ctx) -> str:
    _, console = dry_run_delivery(ctx)
    return console


def execute_deliver_send(ctx: Ctx, commands: list[str]) -> None:
    repo = ctx.state["repo"]
    fake_forge(ctx.monkeypatch, reply=MR_REPLY)
    done = execute(ctx, commands[0])
    assert done.code == cli.EXIT_OK, done.text
    assert "Pushed:  yes" in done.out, done.out
    branch = git(repo, "branch", "--show-current")
    assert branch.startswith("wringer/"), branch
    assert branch in git(repo, "ls-remote", "--heads", "origin", branch)


def capture_default_branch_remedy(ctx: Ctx) -> str:
    """The refusal for REAL: the bare origin's HEAD points at a branch that
    does not exist, so `git remote show origin` reports `(unknown)`."""
    repo = ctx.fixture("delivery_repo")
    upstream = repo.parent / f"{repo.name}-upstream.git"
    (repo / ".wringer.yaml").write_text(
        DELIVER_CONFIG.replace("  base: main\n", ""), encoding="utf-8"
    )
    verified(repo, ctx.monkeypatch, ctx.capsys)
    subprocess.run(
        ["git", "--git-dir", str(upstream), "symbolic-ref", "HEAD",
         "refs/heads/nothing"],
        check=True,
    )
    assert cli.main(["deliver"]) == cli.EXIT_REFUSED
    err = ctx.capsys.readouterr().err
    assert "could not be determined" in flat(err), err
    ctx.state.update(repo=repo, upstream=upstream)
    return err


def execute_default_branch_remedy(ctx: Ctx, commands: list[str]) -> None:
    repo, upstream = ctx.state["repo"], ctx.state["upstream"]
    assert commands == ["git fetch origin", "git remote set-head origin -a"]
    # "Make 'origin' answer" comes first in the printed remedy: that is the
    # person's act on the remote. Then the two printed commands, as printed.
    subprocess.run(
        ["git", "--git-dir", str(upstream), "symbolic-ref", "HEAD",
         "refs/heads/main"],
        check=True,
    )
    for line in commands:
        done = execute(ctx, line)
        assert done.code == 0, f"{line!r} failed as printed:\n{done.text}"
    assert git(repo, "symbolic-ref", "refs/remotes/origin/HEAD") == (
        "refs/remotes/origin/main"
    )
    assert cli.main(["deliver"]) == cli.EXIT_OK, ctx.capsys.readouterr().err


def capture_git_identity_remedy(ctx: Ctx) -> str:
    repo = ctx.fixture("delivery_repo")
    git(repo, "config", "--unset", "user.email")
    ctx.monkeypatch.setenv("GIT_CONFIG_COUNT", "1")
    ctx.monkeypatch.setenv("GIT_CONFIG_KEY_0", "user.useConfigOnly")
    ctx.monkeypatch.setenv("GIT_CONFIG_VALUE_0", "true")
    ctx.monkeypatch.setenv("HOME", str(ctx.outside("home")))
    verified(repo, ctx.monkeypatch, ctx.capsys)
    assert cli.main(["deliver", "--send"]) == cli.EXIT_CONFIG
    err = ctx.capsys.readouterr().err
    ctx.state["repo"] = repo
    return err


def execute_git_identity_remedy(ctx: Ctx, commands: list[str]) -> None:
    assert commands == ['git config --global user.email "..."'], commands
    # `"..."` is the value only the person knows; substituted, as `<id>` is.
    done = execute(ctx, commands[0].replace('"..."', '"wringer@example.invalid"'))
    assert done.code == 0, done.text
    fake_forge(ctx.monkeypatch, reply=MR_REPLY)
    assert cli.main(["deliver", "--send"]) == cli.EXIT_OK, (
        ctx.capsys.readouterr().err
    )


# --- rows: verify, doctor, init, and the first refusals -----------------------


def capture_rerun_gate(ctx: Ctx) -> str:
    repo = ctx.fixture("repo")
    write_config(repo, [("check", "false")])
    ctx.monkeypatch.chdir(repo)
    before = runs_of(repo)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    console = ctx.capsys.readouterr().out
    summary = (one_new_run(repo, before) / "summary.md").read_text("utf-8")
    assert cli.main(["verify", "--json"]) == cli.EXIT_GATE_FAILED
    payload = ctx.capsys.readouterr().out
    json.loads(payload)  # one object, or --json broke
    ctx.state["repo"] = repo
    return "\n".join([summary, console, payload])


def execute_rerun_gate(ctx: Ctx, commands: list[str]) -> None:
    repo = ctx.state["repo"]
    assert len(set(commands)) == 1 and len(commands) == 3, commands
    before = runs_of(repo)
    done = execute(ctx, commands[0])
    assert done.code == cli.EXIT_GATE_FAILED, done.text
    gates = sorted(p.name for p in (one_new_run(repo, before) / "gates").iterdir())
    assert gates == ["001_check"], gates


def capture_doctor_verify(ctx: Ctx) -> str:
    repo = ctx.fixture("repo")
    write_config(repo, [("check", "true")])
    ctx.monkeypatch.chdir(repo)
    cli.main(["doctor"])
    out = ctx.capsys.readouterr().out
    assert re.search(r"last verify\s+never run here", out), out
    ctx.state["repo"] = repo
    return out


def execute_doctor_verify(ctx: Ctx, commands: list[str]) -> None:
    done = execute(ctx, commands[0])
    assert done.code == cli.EXIT_OK, done.text
    cli.main(["doctor"])
    out = ctx.capsys.readouterr().out
    assert re.search(r"last verify\s+all gates passed", out), out


def capture_doctor_init(ctx: Ctx) -> str:
    repo = ctx.fixture("repo")
    ctx.monkeypatch.chdir(repo)
    cli.main(["doctor"])
    out = ctx.capsys.readouterr().out
    assert re.search(r"gates\s+no \.wringer\.yaml here yet", out), out
    return out


def execute_doctor_init(ctx: Ctx, commands: list[str]) -> None:
    done = execute(ctx, commands[0])
    assert done.code == cli.EXIT_OK, done.text
    assert Path(".wringer.yaml").is_file()
    # `wring init` ends on the next command; run that too, as printed.
    chained = re.findall(r"then(?: run)?: (wring verify)\s*$", done.out, re.M)
    assert chained, done.out
    again = execute(ctx, chained[0])
    assert again.code == cli.EXIT_OK, again.text


def capture_git_init(ctx: Ctx) -> str:
    plain = ctx.outside("plain")
    ctx.monkeypatch.chdir(plain)
    assert cli.main(["verify"]) == cli.EXIT_CONFIG
    err = ctx.capsys.readouterr().err
    assert "not a git repository" in flat(err), err
    return err


def execute_git_init(ctx: Ctx, commands: list[str]) -> None:
    done = execute(ctx, commands[0])
    assert done.code == 0, done.text
    assert Path(".git").is_dir()
    cli.main(["verify"])
    err = ctx.capsys.readouterr().err
    assert "not a git repository" not in flat(err), err


def capture_health_from(ctx: Ctx) -> str:
    repo = ctx.fixture("repo")
    write_config(repo, [("check", "true")])
    ctx.monkeypatch.chdir(repo)
    before = runs_of(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    ctx.capsys.readouterr()
    run_dir = one_new_run(repo, before)
    plain = ctx.outside("plain")
    ctx.monkeypatch.chdir(plain)
    assert cli.main(["health"]) == cli.EXIT_CONFIG
    err = ctx.capsys.readouterr().err
    # The bundles CI kept, where the printed command says to look.
    shutil.copytree(run_dir, plain / "ci-history" / run_dir.name)
    return err


def execute_health_from(ctx: Ctx, commands: list[str]) -> None:
    done = execute(ctx, commands[0])
    assert done.code == cli.EXIT_OK, done.text
    assert "check" in done.out, done.out
    assert "no --from" not in done.err, done.err


def capture_health_prove(ctx: Ctx) -> str:
    repo = ctx.fixture("repo")
    write_config(repo, [("check", "grep -q FIXED flag.txt")])
    (repo / "flag.txt").write_text("BROKEN\n", encoding="utf-8")
    (repo / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    (repo / "flag.txt").write_text("FIXED\n", encoding="utf-8")
    ctx.monkeypatch.chdir(repo)
    # A zombie needs a history floor (`health.MIN_HISTORY`): silence is only
    # evidence once there has been room for a failure to appear.
    for _ in range(health.MIN_HISTORY):
        assert cli.main(["verify"]) == cli.EXIT_OK
        ctx.capsys.readouterr()
    assert cli.main(["health", "--strict"]) == cli.EXIT_GATE_FAILED
    err = ctx.capsys.readouterr().err
    ctx.state["repo"] = repo
    return err


def execute_health_prove(ctx: Ctx, commands: list[str]) -> None:
    repo = ctx.state["repo"]
    before = runs_of(repo)
    done = execute(ctx, commands[0])
    assert done.code == cli.EXIT_OK, done.text
    vacuity = json.loads(
        (one_new_run(repo, before) / "vacuity.json").read_text("utf-8")
    )
    assert vacuity["verdict"] == "proven", vacuity
    assert cli.main(["health", "--strict"]) == cli.EXIT_OK, (
        ctx.capsys.readouterr().err
    )


def capture_attest_audit(ctx: Ctx) -> str:
    repo = ctx.fixture("repo")
    write_config(repo, [("check", "true")])
    ctx.monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    ctx.capsys.readouterr()
    assert cli.main(["attest"]) == cli.EXIT_OK
    return ctx.capsys.readouterr().out


def execute_attest_audit(ctx: Ctx, commands: list[str]) -> None:
    done = execute(ctx, commands[0])
    assert done.code == cli.EXIT_OK, done.text
    assert "every digest matches" in done.out, done.out


def capture_board_inputs(ctx: Ctx) -> str:
    done = execute(ctx, "wringer-board render --help")
    assert done.code == 0, done.text
    return flat(done.out)  # argparse wraps a quoted command across lines


def execute_board_inputs(ctx: Ctx, commands: list[str]) -> None:
    repo = ctx.fixture("repo")
    write_config(repo, [("check", "true")])
    ctx.monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    assert cli.main(["attest"]) == cli.EXIT_OK
    attestation = re.search(
        r"wring audit (\S+attestation\.json)", ctx.capsys.readouterr().out
    ).group(1)
    health_report = ctx.tmp_path / "health.json"
    audit_report = ctx.tmp_path / "audit.json"
    engine_bin = Path(sys.executable).parent
    assert (engine_bin / "wring").is_file(), (
        f"`wring` is not installed beside {sys.executable}, so a shell "
        "redirection of it cannot be executed as printed"
    )
    ctx.monkeypatch.setenv(
        "PATH", f"{engine_bin}{os.pathsep}{os.environ.get('PATH', '')}"
    )
    for printed in commands:
        command = (
            printed.replace("ATTESTATION", attestation)
            .replace("--output PATH", f"--output {health_report}")
            .replace("> PATH", f"> {audit_report}")
        )
        if ">" in command:  # the shell's redirection, so the shell runs it
            done = execute(ctx, "sh -c " + shlex.quote(command))
        else:
            done = execute(ctx, command)
        assert done.code == cli.EXIT_OK, f"{command!r}:\n{done.text}"
    json.loads(health_report.read_text(encoding="utf-8"))
    json.loads(audit_report.read_text(encoding="utf-8"))
    done = execute(
        ctx,
        f"wringer-board render . --health-report {health_report} "
        f"--audit-report {audit_report}",
    )
    assert done.code == 0, done.text


def capture_verify_json_from_brief(ctx: Ctx) -> str:
    repo = ctx.fixture("repo")
    # Two iterations: a worker turn happens BETWEEN verifies, and the brief
    # is written for that turn — one iteration is one verify and no brief.
    write_config(
        repo, [("check", "grep -q FIXED flag.txt")],
        RUN_SECTION.replace("max_iterations: 1", "max_iterations: 2"),
    )
    (repo / "flag.txt").write_text("BROKEN\n", encoding="utf-8")
    ctx.monkeypatch.chdir(repo)
    cli.main(["run"])
    ctx.capsys.readouterr()
    briefs = sorted((repo / ".wringer" / "loops").glob("*/iterations/001/brief.md"))
    assert len(briefs) == 1, briefs
    return briefs[0].read_text(encoding="utf-8")


def execute_verify_json(ctx: Ctx, commands: list[str]) -> None:
    done = execute(ctx, commands[0])
    assert done.code == cli.EXIT_GATE_FAILED, done.text
    payload = json.loads(done.out)
    assert payload["status"] == "failed", payload


def capture_npm_prefix_hint(ctx: Ctx) -> str:
    """The ACP roster's first agent, absent from a PATH that holds only what
    `wring run` needs to reach its preflight."""
    repo = ctx.fixture("repo")
    agent = agents.AGENTS[0]
    write_config(
        repo, [("check", "true")],
        f"run:\n  worker:\n    acp:\n      command: {agent.command}\n",
    )
    bin_dir = ctx.tmp_path / "bin"
    bin_dir.mkdir()
    for tool in ("git", "sh", "grep", "true", "cat"):
        (bin_dir / tool).symlink_to(shutil.which(tool))
    ctx.state["path"] = os.environ.get("PATH", "")
    ctx.monkeypatch.setenv("PATH", str(bin_dir))
    ctx.monkeypatch.chdir(repo)
    assert cli.main(["run"]) == cli.EXIT_CONFIG
    err = ctx.capsys.readouterr().err
    assert f"Install it with: {agent.install}" in err, err
    return err


def execute_npm_prefix(ctx: Ctx, commands: list[str]) -> None:
    ctx.monkeypatch.setenv("PATH", ctx.state["path"])
    if shutil.which("npm") is None:
        pytest.skip("npm is not on this machine, so its hint cannot be run here")
    done = execute(ctx, commands[0])
    assert done.code == 0, done.text
    assert Path(done.out.strip()).is_absolute(), done.out


def capture_bench_cleanup(ctx: Ctx) -> str:
    repo = ctx.fixture("repo")
    tree = ctx.outside("worktree")
    tree.rmdir()
    git(repo, "worktree", "add", "-q", str(tree))
    ctx.monkeypatch.chdir(repo)
    ctx.state["tree"] = tree
    return bench._cleanup_lines(repo, (tree,))


def execute_bench_cleanup(ctx: Ctx, commands: list[str]) -> None:
    done = execute(ctx, commands[0])
    assert done.code == 0, done.text
    assert not ctx.state["tree"].exists()


def capture_bench_judge(ctx: Ctx) -> str:
    repo = ctx.fixture("repo")
    bench_setup(repo, ctx.fixture("git_run"), config=BENCH_CONFIG + JUDGE_SECTION)
    (repo / "rubric.yaml").write_text(RUBRIC, encoding="utf-8")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "a rubric")
    ctx.monkeypatch.chdir(repo)
    assert cli.main(["bench"]) == cli.EXIT_OK
    ctx.capsys.readouterr()
    found = sorted((repo / bench.BENCHES_DIRNAME).iterdir())
    assert len(found) == 1, found
    return (found[0] / bench.SUMMARY_FILENAME).read_text(encoding="utf-8")


def execute_bench_judge(ctx: Ctx, commands: list[str]) -> None:
    for command in commands:
        done = execute(ctx, command)
        assert done.code == cli.EXIT_OK, f"{command!r}:\n{done.text}"
        assert "nothing was sent" in done.out, done.out


def capture_graph_park(ctx: Ctx) -> str:
    repo = ctx.fixture("repo")
    (repo / "task.md").write_text("# Add CSV export\n\nThe table needs it.\n")
    (repo / "graph.yaml").write_text(PARKS, encoding="utf-8")
    ctx.monkeypatch.chdir(repo)
    assert cli.main(["graph", "run", "graph.yaml"]) == cli.EXIT_NEEDS_HUMAN
    out = ctx.capsys.readouterr().out
    ctx.state["decision"] = re.search(r"Edit:\n\s+(\S+)", out).group(1)
    return out


def execute_graph_resume(ctx: Ctx, commands: list[str]) -> None:
    # The printed sequence: edit the decision file by hand, then resume.
    decision = Path(ctx.state["decision"])
    text = decision.read_text(encoding="utf-8")
    assert "approved: false" in text, text
    decision.write_text(text.replace("approved: false", "approved: true"))
    done = execute(ctx, commands[0])
    assert done.code == cli.EXIT_OK, done.text
    assert "done" in done.out, done.out


def a_source_repo(ctx: Ctx, name: str) -> Path:
    source = ctx.outside(name)
    git(source, "init", "-q", "-b", "main", ".")
    (source / "hello.txt").write_text("hi\n", encoding="utf-8")
    git(source, "add", "-A")
    git(source, "commit", "-m", "first")
    return source


def capture_start_clone(ctx: Ctx) -> str:
    repo = ctx.fixture("repo")
    source = a_source_repo(ctx, "source")
    ctx.monkeypatch.chdir(repo)
    done = execute(ctx, f"wring start --clone file://{source} --workspace work")
    # Exit 3: the clone STOPS before anything it fetched can run (§3e).
    assert done.code == cli.EXIT_REFUSED, done.text
    assert "this launch stops here" in done.out, done.out
    ctx.state["repo"] = repo
    return done.out


def execute_cd_then_start(ctx: Ctx, commands: list[str]) -> None:
    assert [c.split()[0] for c in commands] == ["cd", "wring"], commands
    ctx.monkeypatch.chdir(commands[0].split(None, 1)[1])
    done = execute(ctx, commands[1])
    # §3b of SPEC_START: no terminal and a missing answer is exit 2 naming
    # the flag — never a hang, never a guess. That IS the launch answering.
    assert done.code == cli.EXIT_CONFIG, done.text
    assert "--accept-gates" in done.err, done.err
    no_traceback(done)
    # And `wring get`, which the door says "will ask for one before it
    # clones" — the workspace `--clone` just wrote is the one it uses.
    ctx.monkeypatch.chdir(ctx.state["repo"])
    fetched = execute(ctx, f"wring get file://{a_source_repo(ctx, 'second')}")
    assert fetched.code == cli.EXIT_OK, fetched.text
    assert "Cloned" in fetched.out, fetched.out


def capture_bench_refusal(ctx: Ctx) -> str:
    repo = ctx.fixture("repo")
    write_config(repo, [("check", "true")])
    ctx.monkeypatch.chdir(repo)
    assert cli.main(["bench"]) == cli.EXIT_CONFIG
    return ctx.capsys.readouterr().err


def execute_start_help(ctx: Ctx, commands: list[str]) -> None:
    done = execute(ctx, commands[0])
    assert done.code == 0, done.text
    assert "usage" in done.out, done.out
    for agent_id in agents.known():
        assert agent_id in done.out, (agent_id, done.out)


def capture_npm_gate(ctx: Ctx) -> str:
    repo = ctx.fixture("repo")
    (repo / "package.json").write_text(
        json.dumps({"name": "x", "scripts": {"test": "node --test"}}),
        encoding="utf-8",
    )
    ctx.monkeypatch.chdir(repo)
    assert cli.main(["init"]) == cli.EXIT_OK
    ctx.capsys.readouterr()
    ctx.state["repo"] = repo
    return (repo / ".wringer.yaml").read_text(encoding="utf-8")


def execute_npm_gate(ctx: Ctx, commands: list[str]) -> None:
    """`npm test` is a gate `wring init` wrote from package.json; the product
    runs it, so the execution is `wring verify` with a real fake npm on
    PATH, and the bundle records the command as written."""
    repo = ctx.state["repo"]
    bin_dir = ctx.tmp_path / "fake-bin"
    bin_dir.mkdir()
    fake = bin_dir / "npm"
    fake.write_text('#!/bin/sh\n[ "$1" = test ] && exit 0\nexit 1\n', "utf-8")
    fake.chmod(0o755)
    ctx.monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    before = runs_of(repo)
    done = execute(ctx, "wring verify")
    assert done.code == cli.EXIT_OK, done.text
    results = sorted((one_new_run(repo, before) / "gates").glob("*/result.json"))
    ran = [json.loads(p.read_text("utf-8"))["command"] for p in results]
    assert commands[0] in ran, (commands, ran)


# --- rows: the front door (issue → spec → plan) and the pen ----------------------


def spec_repo(ctx: Ctx) -> Path:
    repo = ctx.fixture("repo")
    (repo / ".wringer.yaml").write_text(
        DELIVER_CONFIG + JUDGE_SECTION, encoding="utf-8"
    )
    (repo / "rubric.yaml").write_text(RUBRIC, encoding="utf-8")
    ctx.monkeypatch.chdir(repo)
    ctx.state["repo"] = repo
    return repo


def capture_issue(ctx: Ctx) -> str:
    spec_repo(ctx)
    ctx.monkeypatch.setenv("FORGE_TOKEN", "ghp_secretsecret123")
    fake_forge(ctx.monkeypatch, reply=ISSUE_REPLY)
    done = execute(ctx, "wring issue 42")
    assert done.code == cli.EXIT_OK, done.text
    return done.out


def execute_spec_chain(ctx: Ctx, commands: list[str]) -> None:
    """issue → `wring spec issues/42.md` (dry run) → the `--send` it names →
    the edit it names → `wring plan` → the `wring fleet` it names."""
    repo = ctx.state["repo"]
    dry = execute(ctx, commands[0])
    assert dry.code == cli.EXIT_OK, dry.text
    assert "dry run" in dry.out, dry.out
    ready = re.findall(r"When you are ready:\n\s+(wring spec <PRD> --send)", dry.out)
    assert ready, dry.out
    fake_transport(ctx.monkeypatch, reply=drafter_reply(DRAFT))
    sent = execute(ctx, ready[0].replace("<PRD>", commands[0].split()[-1]))
    assert sent.code == cli.EXIT_OK, sent.text
    assert (repo / spec_module.SPEC_FILENAME).is_file()
    planned = re.findall(r"then run: (wring plan)\s*$", sent.out, re.M)
    assert planned, sent.out
    # "read wringer.spec.yaml, answer its open questions, set 'approved:
    # true'" — the person's edit, made through the engine's own renderer.
    loaded = spec_module.load(repo / spec_module.SPEC_FILENAME)
    answered = tuple(
        dataclasses.replace(q, answer="ISO-8601.") if q.required else q
        for q in loaded.questions
    )
    (repo / spec_module.SPEC_FILENAME).write_text(
        spec_module.render(
            dataclasses.replace(loaded, approved=True, questions=answered)
        ),
        encoding="utf-8",
    )
    plan = execute(ctx, planned[0])
    assert plan.code == cli.EXIT_OK, plan.text
    assert (repo / spec_module.TASKS_FILENAME).is_file()
    assert re.search(r"^\s+wring fleet \S+$", plan.out, re.M), plan.out


def capture_witness_refusal(ctx: Ctx) -> str:
    spec_repo(ctx)
    (ctx.state["repo"] / "PRD.md").write_text("A CSV export.\n", encoding="utf-8")
    assert cli.main(["spec", "PRD.md", "--witness"]) == cli.EXIT_CONFIG
    return ctx.capsys.readouterr().err


def execute_witness(ctx: Ctx, commands: list[str]) -> None:
    fake_transport(ctx.monkeypatch, reply=drafter_reply(DRAFT))
    done = execute(ctx, commands[0].replace("<PRD>", "PRD.md"))
    assert done.code == cli.EXIT_OK, done.text
    no_traceback(done)
    assert (ctx.state["repo"] / spec_module.SPEC_FILENAME).is_file()
    # The lane RAN: its record is in the (scratch) witness store. What the
    # fake endpoint answered is not a witness anybody would keep, and the
    # console says nothing either way — noted, not asserted (claim ceiling).
    store = Path(os.environ["WRINGER_WITNESS_STORE"])
    assert list(store.rglob("witness.json")), sorted(store.rglob("*"))


def capture_redraft_refusal(ctx: Ctx) -> str:
    spec_repo(ctx)
    (ctx.state["repo"] / "PRD.md").write_text("A CSV export.\n", encoding="utf-8")
    fake_transport(ctx.monkeypatch, reply=drafter_reply(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    ctx.capsys.readouterr()
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    return ctx.capsys.readouterr().err


def execute_redraft(ctx: Ctx, commands: list[str]) -> None:
    done = execute(ctx, commands[0])
    assert done.code == cli.EXIT_OK, done.text
    assert (ctx.state["repo"] / spec_module.SPEC_FILENAME).is_file()


def capture_board_judge_list(ctx: Ctx) -> str:
    root = board_project(ctx)
    ctx.monkeypatch.chdir(root)
    done = execute(ctx, "wringer-board judge")
    assert done.code == 0, done.text
    ctx.state["root"] = root
    return done.out


def execute_board_judge(ctx: Ctx, commands: list[str]) -> None:
    command = (
        commands[0]
        .replace("<the id>", "heading-reads-as-mine")
        .replace("met|not_met", "met")
    )
    done = execute(ctx, command)
    assert done.code == 0, done.text
    assert "recorded" in done.out, done.out
    assert (ctx.state["root"] / "wringer.judgements.yaml").is_file()


def capture_answers_wrong(ctx: Ctx) -> str:
    project = drive_project(ctx, gate="true", worker=": {brief}; true")
    code, steps = drive_json(
        ["run", str(prd(ctx)), "--repo", str(project)], "The ones on screen.\nno\n"
    )
    assert steps[-1]["id"] == "stopped:answers-wrong", [s["id"] for s in steps]
    return steps[-1]["engine_words"]


def execute_board_revise(ctx: Ctx, commands: list[str]) -> None:
    project = ctx.state["project"]
    ctx.monkeypatch.chdir(project)
    command = (
        commands[0]
        .replace("<the question>", "which-columns")
        .replace("<what you meant>", "All of them.")
    )
    done = execute(ctx, command)
    assert done.code == 0, done.text
    loaded = spec_module.load(project / spec_module.SPEC_FILENAME)
    assert [q.answer for q in loaded.questions] == ["All of them."]


def capture_authority_moved(ctx: Ctx) -> str:
    project = drive_project(ctx, gate="true", worker=": {brief}; true")
    # The plan a person is asked to re-approve has its question answered —
    # approving one with an open question "approves a guess", and the pen
    # refuses that by name.
    path = project / spec_module.SPEC_FILENAME
    loaded = spec_module.load(path)
    answered = tuple(
        dataclasses.replace(q, answer="The ones on screen.")
        for q in loaded.questions
    )
    path.write_text(
        spec_module.render(dataclasses.replace(loaded, questions=answered)),
        encoding="utf-8",
    )
    return refusals.say(refusals.LOOP_ENDING, "authority_moved").next_move


def execute_board_approve(ctx: Ctx, commands: list[str]) -> None:
    project = ctx.state["project"]
    ctx.monkeypatch.chdir(project)
    done = execute(ctx, commands[0], stdin="yes\n")
    assert done.code == 0, done.text
    assert spec_module.load(project / spec_module.SPEC_FILENAME).approved


# --- rows: the drive's stops -------------------------------------------------


def capture_resume_next_move(ctx: Ctx) -> str:
    project = drive_project(ctx, gate="false", worker=": {brief}; exit 1")
    code, steps = drive_json(
        ["run", str(prd(ctx)), "--repo", str(project)],
        "The ones on screen.\nyes\nyes\n",
    )
    built = [s for s in steps if s["id"].startswith("build:")]
    assert built and built[-1]["kind"] == "stopped", [s["id"] for s in steps]
    assert code != 0
    return built[-1]["next_move"]


def execute_drive_resume(ctx: Ctx, commands: list[str]) -> None:
    ctx.monkeypatch.chdir(ctx.state["project"])
    done = execute(ctx, commands[0])
    no_traceback(done)
    for label in ("Preserved:", "Reused:", "Will spend:"):
        assert label in done.out, f"the preface lacks {label!r}:\n{done.text}"
    assert done.out.index("Preserved:") < done.out.index("Will spend:")


def capture_nothing_to_resume(ctx: Ctx) -> str:
    project = drive_project(ctx, gate="true", worker=": {brief}; true")
    ctx.monkeypatch.chdir(project)
    done = execute(ctx, "wringer-drive resume")
    assert done.code == 2, done.text
    return done.text


def execute_drive_run(ctx: Ctx, commands: list[str]) -> None:
    document = prd(ctx)
    done = execute(ctx, commands[0].replace("<your document>", str(document)))
    no_traceback(done)
    assert "I copied your document into the project" in done.out, done.text
    assert done.code == 2, done.text
    # `stopped:nobody-there` is raised from `_ask` and nowhere else: the run
    # reached its first question and stopped there, by name.
    assert "nobody on the other end of the line" in done.text, done.text


def capture_setup_epilogue(name: str) -> Callable[[Ctx], str]:
    def capture(ctx: Ctx) -> str:
        script = repo_root() / "docs" / "drive" / "examples" / name / "setup.sh"
        bin_dir = sandbox_bin(ctx.tmp_path)
        done = subprocess.run(
            ["sh", str(script), str(ctx.tmp_path / "target")],
            capture_output=True, text=True, check=False,
            env={**os.environ, "PATH": str(bin_dir)},
        )
        if "and this needs it." in done.stdout + done.stderr:
            pytest.skip(
                f"{name}'s setup.sh stopped on its own prerequisite check, so "
                "its epilogue was never printed here"
            )
        assert done.returncode == 0, done.stdout + done.stderr
        ctx.state["bin"] = bin_dir
        return done.stdout

    return capture


def execute_setup_epilogue(ctx: Ctx, commands: list[str]) -> None:
    # The pipeline example exports its venv onto PATH; the arcade needs no
    # venv and prints no export. Both then `cd` and run the drive.
    heads = [c.split()[0] for c in commands]
    assert heads in (["export", "cd", "wringer-drive"], ["cd", "wringer-drive"])
    ctx.monkeypatch.setenv("PATH", str(ctx.state["bin"]))  # the sandbox's PATH
    for command in commands[:-1]:
        if command.startswith("export PATH="):
            exported = re.fullmatch(r'export PATH="(.+)"', command).group(1)
            ctx.monkeypatch.setenv(
                "PATH", exported.replace("$PATH", os.environ["PATH"])
            )
        else:
            ctx.monkeypatch.chdir(command.split(None, 1)[1])
    ctx.monkeypatch.delenv("WRINGER_API_KEY", raising=False)
    answers = "http://127.0.0.1:1/v1/chat/completions\nnone\n: {brief}; true\n"
    done = execute(ctx, commands[-1], stdin=answers)
    no_traceback(done)
    assert done.code == 2, done.text
    # The named stop — the drive's own sentence, then the engine's words —
    # on the error channel, where a terminal's non-zero ending goes.
    assert "This stopped, and here is exactly what the tool said" in done.err
    assert "What the tool itself said:" in done.err, done.text
    assert "is not set in this environment" in done.err, done.text


# --- rows named in prose: the verb answers in its own voice -------------------


def execute_doctor(ctx: Ctx, commands: list[str]) -> None:
    repo = ctx.fixture("repo")
    write_config(repo, [("check", "true")])
    ctx.monkeypatch.chdir(repo)
    done = execute(ctx, commands[0])
    assert done.code in (cli.EXIT_OK, cli.EXIT_GATE_FAILED), done.text
    assert re.search(r"^[✓!\-✗] ", done.out, re.M), done.out


def execute_resume_no_loops(ctx: Ctx, commands: list[str]) -> None:
    repo = ctx.fixture("repo")
    write_config(repo, [("check", "true")], RUN_SECTION)
    ctx.monkeypatch.chdir(repo)
    done = execute(ctx, commands[0])
    assert done.code == cli.EXIT_CONFIG, done.text
    assert "no loops under" in flat(done.err), done.err


# --- THE REGISTRY -----------------------------------------------------------

KEYCHAIN = (
    "touches the operator's Keychain: `security` stores or reads a credential "
    "in a login keychain CI does not have, and a key is nobody's to type into "
    "a test. Registered as printed; never executed by CI."
)
PACKAGE_MANAGER = (
    "runs the operator's package manager, which installs or removes software "
    "on their machine — a larger, less reversible power than launching a "
    "build, and one this program's own runbook denies itself (agents.py). "
    "Printed, never executed by CI."
)

REGISTRY: tuple[Printed, ...] = (
    Printed(
        family="deliver:commands.txt git sequence",
        printed_by=("deliver.py:plan (commands=…)",),
        patterns=(
            r"git switch --create",
            r"git add --all --pathspec-from-file=- --pathspec-file-nul",
            r"git commit --file \.wringer/deliveries/<id>/commit\.txt",
            r"git push --set-upstream",
            # the same four verbs, named in the delivery's refusal prose
            r"git push", r"git commit --only", r"git commit",
        ),
        promise="run in order against the origin, the branch is on the remote "
        "carrying the planned files under commit.txt's message",
        capture=capture_commands_txt,
        extract=r"^(git .+)$",
        execute=execute_git_sequence,
    ),
    Printed(
        family="deliver:POST a merge request",
        printed_by=("deliver.py:plan (commands=…)",),
        patterns=(r"POST a merge request",),
        promise="a person opens the merge request on the forge, or --send does",
        human_only=(
            "opens a merge request on the operator's forge with the operator's "
            "token — a public act on somebody's account; CI executes the "
            "programmatic form against a fake forge in tests/test_deliver.py "
            "and never the printed one. Printed, never executed by CI."
        ),
    ),
    Printed(
        family="deliver:wring verify --falsify --delivery <id>",
        printed_by=(
            "cli.py:_report_delivery", "deliver.py:plan (commands=…)",
            "wringer_drive/run.py:final_step (text and detail)",
        ),
        patterns=(r"wring verify --falsify --delivery(?: <id>)?",),
        promise="after --send, the committed range is measured: a "
        "falsification record with verdict 'measured'",
        capture=capture_falsify,
        extract=r"(wring verify --falsify --delivery \S+)",
        execute=execute_falsify,
    ),
    Printed(
        family="deliver:wring deliver --send",
        printed_by=(
            "cli.py:_report_delivery (dry run)",
            "cli.py:_graph_next_actions and graph.py (the run-dir form)",
        ),
        patterns=(r"wring deliver --send", r"wring deliver"),
        promise="the branch is committed, pushed and the MR opened",
        capture=capture_deliver_send,
        extract=r"then:\n\s+(wring deliver --send)",
        execute=execute_deliver_send,
        executed_by=(
            "tests/test_graph_deliver.py::"
            "test_the_dry_run_report_names_a_command_that_exists",
        ),
    ),
    Printed(
        family="deliver:mr.md audit instruction",
        printed_by=("deliver.py:_mr_body",),
        patterns=(r"wring audit --delivery <path-to-this-directory>",),
        promise="from a fresh clone on main, one command checks every claim",
        executed_by=(
            "tests/test_deliver.py::"
            "test_the_mr_audit_instruction_WORKS_AS_PRINTED_from_a_fresh_clone",
        ),
    ),
    Printed(
        family="deliver:git fetch / git remote set-head",
        printed_by=(
            "deliver.py:resolve_base (default_branch_unknown)",
            "deliver.py:_mr_body", "cli.py:cmd_audit (--delivery refusals)",
        ),
        patterns=(r"git fetch", r"git remote set-head"),
        promise="the remote's default is recorded locally and delivery proceeds",
        capture=capture_default_branch_remedy,
        extract=r"^\s+(git (?:fetch|remote set-head) .+?)\s*$",
        execute=execute_default_branch_remedy,
        executed_by=(
            "tests/test_deliver.py::"
            "test_the_mr_audit_instruction_WORKS_AS_PRINTED_from_a_fresh_clone",
            "tests/test_deliver.py::test_audit_delivery_REFUSES_a_clone_"
            "without_the_branch_and_the_printed_fetch_WORKS",
        ),
    ),
    Printed(
        family="deliver:git config --global (no identity)",
        printed_by=("deliver.py:_require_identity",),
        patterns=(r"git config --global",),
        promise="the identity is set and the same --send then delivers",
        capture=capture_git_identity_remedy,
        extract=r'^\s+(git config --global \S+ "\.\.\.")\s*$',
        execute=execute_git_identity_remedy,
    ),
    Printed(
        family="verify:rerun the failing gate",
        printed_by=("summary.py:write", "cli.py:_report_verify", "verify.py:said"),
        patterns=(r"wring verify --gate(?: \S+)?",),
        promise="exactly that gate runs again, numbered as declared",
        capture=capture_rerun_gate,
        extract=r"(wring verify --gate [\w-]+)",
        execute=execute_rerun_gate,
    ),
    Printed(
        family="doctor:Run: wring verify",
        printed_by=(
            "doctor.py:_last_verify", "cli.py:cmd_init", "cli.py:_report_verify",
            "and every sentence naming the verb",
        ),
        patterns=(r"wring verify",),
        promise="a run is recorded and doctor's 'last verify' reads it",
        capture=capture_doctor_verify,
        extract=r"→ Run: (wring verify)\s*$",
        execute=execute_doctor_verify,
    ),
    Printed(
        family="doctor:Run: wring init → wring verify",
        printed_by=("doctor.py:_config", "doctor.py:_runnable_checks"),
        patterns=(r"wring init",),
        promise="a config is written, and the verify it names then runs",
        capture=capture_doctor_init,
        extract=r"→ Run: (wring init)\s*$",
        execute=execute_doctor_init,
    ),
    Printed(
        family="verify:Run 'git init'",
        printed_by=(
            "cli.py:_refuse_unverifiable", "cli.py:cmd_start", "doctor.py:_repo",
        ),
        patterns=(r"git init",),
        promise="the directory is a repository and the refusal is gone",
        capture=capture_git_init,
        extract=r"'(git init)'",
        execute=execute_git_init,
    ),
    Printed(
        family="verify:--json (the brief's pointer)",
        printed_by=("loop.py:brief", "and the sentence in worker_auth"),
        patterns=(r"wring verify --json", r"wring run"),
        promise="one JSON object on stdout carrying the status",
        capture=capture_verify_json_from_brief,
        extract=r"`(wring verify --json)`",
        execute=execute_verify_json,
    ),
    Printed(
        family="health:--from ./ci-history",
        printed_by=("cli.py:cmd_health (no repository)",),
        patterns=(r"wring health --from \./ci-history", r"wring health"),
        promise="the kept bundles are read from that directory",
        capture=capture_health_from,
        extract=r"(wring health --from \./ci-history)",
        execute=execute_health_from,
    ),
    Printed(
        family="health:--strict → wring verify --prove",
        printed_by=("cli.py:cmd_health (--strict)", "health.py:REMEDY",
                    "accept.py, deliver.py, config.py (the same remedy)"),
        patterns=(r"wring verify --prove",),
        promise="a sensitive row is recorded and --strict then passes",
        capture=capture_health_prove,
        extract=r"^\s+(wring verify --prove)\s*$",
        execute=execute_health_prove,
    ),
    Printed(
        family="attest:Check it yourself → wring audit",
        printed_by=("cli.py:cmd_attest", "cli.py:_start_receipt"),
        patterns=(r"wring audit", r"wring attest"),
        promise="the receipt audits clean, offline",
        capture=capture_attest_audit,
        extract=r"Check it yourself[^\n]*\n\s+(wring audit \S+)",
        execute=execute_attest_audit,
    ),
    Printed(
        family="board:the engine reports it renders",
        printed_by=("wringer_board/__main__.py:build_parser (--help)",),
        patterns=(
            r"wring health --json --output PATH",
            r"wring audit --json ATTESTATION > PATH",
        ),
        promise="both reports are written as JSON and the board renders them",
        capture=capture_board_inputs,
        extract=r"'(wring (?:health --json --output PATH"
        r"|audit --json ATTESTATION > PATH))'",
        execute=execute_board_inputs,
    ),
    Printed(
        family="run:missing agent → npm prefix -g",
        printed_by=("loop.py:missing_agent",),
        patterns=(r"npm prefix -g",),
        promise="prints the prefix the install landed under (exit 0)",
        capture=capture_npm_prefix_hint,
        extract=r"`(npm prefix -g)`",
        execute=execute_npm_prefix,
    ),
    Printed(
        family="run:missing agent → npm install -g",
        printed_by=("agents.py:Agent.install", "loop.py:missing_agent",
                    "cli.py:_start_agent"),
        patterns=(r"npm install -g",),
        promise="a person installs the agent; Wringer never does",
        human_only=PACKAGE_MANAGER,
    ),
    Printed(
        family="bench:git worktree remove",
        printed_by=("bench.py:_cleanup_lines",),
        patterns=(r"git worktree remove",),
        promise="the kept worktree is removed by the reader, on purpose",
        capture=capture_bench_cleanup,
        extract=r"^(git worktree remove \S+)$",
        execute=execute_bench_cleanup,
    ),
    Printed(
        family="bench:wring judge <run>",
        printed_by=("bench.py:summary (## Next)",),
        patterns=(r"wring judge", r"wring bench"),
        promise="a dry-run judgement of that row's final run, nothing sent",
        capture=capture_bench_judge,
        extract=r"^(wring judge \S+)$",
        execute=execute_bench_judge,
    ),
    Printed(
        family="judge:--send",
        printed_by=("doctor.py:_drafting_key", "attest.py"),
        patterns=(r"wring judge --send",),
        promise="a verdict from the reply",
        executed_by=(
            "tests/test_judge.py::test_send_produces_a_verdict_from_the_reply",
        ),
    ),
    Printed(
        family="graph:parked → wring graph resume",
        printed_by=("cli.py:_report_graph", "cli.py:_graph_next_actions"),
        patterns=(r"wring graph resume", r"wring graph run"),
        promise="after the decision file is edited, the graph finishes",
        capture=capture_graph_park,
        extract=r"^\s+(wring graph resume \S+)$",
        execute=execute_graph_resume,
    ),
    Printed(
        family="graph:--send on the invocation",
        printed_by=("cli.py:build_parser", "graph.py:SEND_RULING"),
        patterns=(
            r"wring graph run(?: …)? --send", r"wring graph resume … --send",
        ),
        promise="the deliver node that run reaches is authorised, once",
        executed_by=(
            "tests/test_graph_deliver.py::"
            "test_send_on_the_invocation_authorises_the_deliver_node",
            "tests/test_graph_deliver.py::test_resume_requires_retyping_send",
        ),
    ),
    Printed(
        family="start:--clone → cd → wring start (and wring get)",
        printed_by=("cli.py:_start_clone", "cli.py:_start_agent (the door)",
                    "start.py:TEMPLATE (`wring get` clones here)"),
        patterns=(r"wring get", r"wring start", r"git clone"),
        promise="the launch begins in the clone and names the answer it needs; "
        "wring get clones into the workspace the launch wrote",
        capture=capture_start_clone,
        extract=r"^\s+(cd \S+|wring start)\s*$",
        execute=execute_cd_then_start,
    ),
    Printed(
        family="bench:'wring start --help' lists the agent ids",
        printed_by=("cli.py:cmd_bench (no bench: section)",),
        patterns=(r"wring start --help",),
        promise="the usage lists every agent id this version knows",
        capture=capture_bench_refusal,
        extract=r"'(wring start --help)'",
        execute=execute_start_help,
    ),
    Printed(
        family="init:a detected npm gate",
        printed_by=("detect.py:_npm_candidates (written into .wringer.yaml)",),
        patterns=(r"npm test", r"npm run"),
        promise="wring verify runs the written command and records it",
        capture=capture_npm_gate,
        extract=r'run: "?(npm test)"?\s*$',
        execute=execute_npm_gate,
    ),
    Printed(
        family="front door:issue → spec → --send → plan",
        printed_by=(
            "cli.py:cmd_issue", "cli.py:_report_spec", "spec.py:SPEC_HEADER",
            "cli.py:_report_plan", "wringer_board/interview.py",
        ),
        patterns=(
            r"wring issue", r"wring spec <PRD\.md>", r"wring spec <PRD> --send",
            r"wring spec", r"wring plan",
        ),
        promise="each command's output names the next, and the chain reaches "
        "tasks.jsonl",
        capture=capture_issue,
        extract=r"then\n\s+(wring spec \S+)\s*$",
        execute=execute_spec_chain,
    ),
    Printed(
        family="spec:--send --witness",
        printed_by=("cli.py:cmd_spec (--witness without --send)",),
        patterns=(r"wring spec <PRD> --send --witness",),
        promise="drafts, then names each criterion no witness could be "
        "authored for, refusing nothing whole",
        capture=capture_witness_refusal,
        extract=r"`(wring spec <PRD> --send --witness)`",
        execute=execute_witness,
    ),
    Printed(
        family="spec:--send --redraft",
        printed_by=("cli.py:cmd_spec (refusing to overwrite)",),
        patterns=(r"wring spec --send --redraft PRD\.md",),
        promise="drafts again over the existing spec, keeping the answers",
        capture=capture_redraft_refusal,
        extract=r"^\s+(wring spec --send --redraft \S+)\s*$",
        execute=execute_redraft,
    ),
    Printed(
        family="fleet:wring fleet tasks.jsonl",
        printed_by=("cli.py:_report_plan",),
        patterns=(r"wring fleet",),
        promise="the tasks run as a bounded fleet with honest counts",
        executed_by=(
            "tests/test_fleet.py::test_a_fifty_task_fleet_reports_honest_counts",
        ),
    ),
    Printed(
        family="attest:--sign",
        printed_by=("intoto.py", "sign.py"),
        patterns=(r"wring attest --sign",),
        promise="a signature sibling from a keyless signer, in CI only",
        executed_by=("tests/test_sign.py::test_both_together_can_sign",),
    ),
    Printed(
        family="pen:wringer-board judge",
        printed_by=("wringer_board/__main__.py:cmd_judge",
                    "wringer_board/refusals.py (human-unanswered)"),
        patterns=(
            r"wringer-board judge --id <the id> --verdict met\|not_met --note",
            r"wringer-board judge --id", r"wringer-board judge",
        ),
        promise="the person's verdict is recorded and the engine reads it",
        capture=capture_board_judge_list,
        extract=r'^\s+(wringer-board judge --id <the id> --verdict met\|not_met '
        r'--note "why")\s*$',
        execute=execute_board_judge,
    ),
    Printed(
        family="pen:wringer-board revise (answers wrong)",
        printed_by=("wringer_drive/__main__.py:_drive (stopped:answers-wrong)",
                    "spec.py (the interview's pointer)"),
        patterns=(
            r"wringer-board revise --id <the question> --text",
            r"wringer-board revise",
        ),
        promise="the answer is recorded under the question it names",
        capture=capture_answers_wrong,
        extract=r'(wringer-board revise --id <the question> --text "<what you meant>")',
        execute=execute_board_revise,
    ),
    Printed(
        family="pen:wringer-board approve (authority moved)",
        printed_by=("wringer_board/refusals.py (authority_moved)",),
        patterns=(r"wringer-board approve",),
        promise="the spec as it now reads is approved by a person",
        capture=capture_authority_moved,
        extract=r"`(wringer-board approve)`",
        execute=execute_board_approve,
    ),
    Printed(
        family="drive:every next move → wringer-drive resume",
        printed_by=("diagnose.py:RESUME_COMMAND", "wringer_board/refusals.py"),
        patterns=(r"wringer-drive resume",),
        promise="the resume opens on the preface and continues from the stop",
        capture=capture_resume_next_move,
        extract=r"(wringer-drive resume)`?\.?\s*$",
        execute=execute_drive_resume,
    ),
    Printed(
        family="drive:nothing to resume → wringer-drive run <your document>",
        printed_by=("wringer_drive/run.py:nothing_to_resume_step",
                    "wringer_drive/run.py:spec_missing_step / spec_changed_step"),
        patterns=(r"wringer-drive run <your document>",),
        promise="a run starts from the document and stops, named, at the first "
        "question when nobody answers",
        capture=capture_nothing_to_resume,
        extract=r"(wringer-drive run <your document>)",
        execute=execute_drive_run,
    ),
    *(
        Printed(
            family=f"setup.sh epilogue:{example.parent.name}",
            printed_by=(f"docs/drive/examples/{example.parent.name}/setup.sh",),
            patterns=(),
            promise="export, cd, and the drive starts from the copied project "
            "and stops at a NAMED stop, never a traceback",
            capture=capture_setup_epilogue(example.parent.name),
            extract=r"^\s+(export PATH=.+|cd \S+|wringer-drive run \S+ --repo \S+)$",
            execute=execute_setup_epilogue,
        )
        for example in sorted(
            (repo_root() / "docs" / "drive" / "examples").glob("*/setup.sh")
        )
    ),
    Printed(
        family="keychain:security add-generic-password",
        printed_by=("cli.py:_no_key_refusal", "setup.sh epilogues"),
        patterns=(
            r"security add-generic-password -U -s <vendor>-api-key -a wringer -w",
        ),
        promise="a person stores the drafting key once, under the one convention",
        human_only=KEYCHAIN,
    ),
    Printed(
        family="keychain:security find-generic-password",
        printed_by=("cli.py:_no_key_refusal", "setup.sh epilogues"),
        patterns=(r"security find-generic-password( \S+)*",),
        promise="the stored key is read inline into the one variable",
        human_only=KEYCHAIN,
    ),
    Printed(
        family="doctor:uv tool install / uninstall",
        printed_by=("doctor.py:_wring_check (mixed and partial installs)",),
        patterns=(
            r"uv tool install --force wringer",
            r"uv tool install wringer",
            r"uv tool uninstall wringer wringer-board wringer-drive",
        ),
        promise="a person reinstalls the one distribution once",
        human_only=PACKAGE_MANAGER,
    ),
    Printed(
        family="init:uv sync --frozen (a commented example)",
        printed_by=("detect.py:TEMPLATE (a commented prove_setup example)",),
        patterns=(r"uv sync --frozen",),
        promise="a person uncomments it to install their own dependencies",
        human_only=(
            "an example dependency install a person may uncomment into their "
            "own `.wringer.yaml`; it runs the operator's dependency manager "
            "against their lockfile — " + PACKAGE_MANAGER
        ),
    ),
    Printed(
        family="prose:wring doctor",
        printed_by=("diagnose.py", "refusals.py", "doctor.py", "cli.py"),
        patterns=(r"wring doctor",),
        promise="one line per check, in its own voice",
        canonical="wring doctor",
        execute=execute_doctor,
    ),
    Printed(
        family="prose:wring resume",
        printed_by=("fleet.py",),
        patterns=(r"wring resume",),
        promise="continues a killed loop, or says by name there is none",
        canonical="wring resume",
        execute=execute_resume_no_loops,
    ),
)


def rows_named(*, executed: bool) -> list[Printed]:
    return [row for row in REGISTRY if bool(row.execute) == executed]


# --- one test executes every executor row ---------------------------------------


@pytest.mark.parametrize(
    "row", rows_named(executed=True), ids=lambda row: row.family
)
def test_EVERY_PRINTED_COMMAND_RUNS_AS_PRINTED(
    row: Printed, request, tmp_path, monkeypatch, capsys
):
    ctx = Ctx(request, tmp_path, monkeypatch, capsys)
    if row.capture is None:
        commands = [row.canonical]
    else:
        text = row.capture(ctx)
        commands = re.findall(row.extract, text, re.M)
        assert commands, (
            f"{row.family}: the surface did not print the command it is "
            f"registered for:\n{text}"
        )
    row.execute(ctx, commands)


# --- every row has one disposition, and a human-only row says why -------------


def test_every_row_is_executed_here_or_by_a_named_test_or_human_only():
    families = [row.family for row in REGISTRY]
    assert len(set(families)) == len(families), "a family is registered twice"
    for row in REGISTRY:
        assert row.execute or row.executed_by or row.human_only, (
            f"{row.family}: neither executed, referenced nor human-only"
        )
        if row.human_only is not None:
            assert row.execute is None and not row.executed_by, (
                f"{row.family}: a human-only command is executed by CI"
            )
        if row.execute is not None:
            assert row.capture is not None or row.canonical, row.family
        for reference in row.executed_by:
            file, _, name = reference.partition("::")
            source = (repo_root() / file).read_text(encoding="utf-8")
            assert re.search(rf"^def {re.escape(name)}\(", source, re.M), (
                f"{row.family} names {reference}, which does not exist"
            )


def test_EVERY_HUMAN_ONLY_ROW_SAYS_WHY_CI_MAY_NOT_RUN_IT():
    """A command CI does not run must say what it would touch — a Keychain,
    a package manager, a forge — or the registry becomes the place a
    command goes to avoid being run."""
    human = [row for row in REGISTRY if row.human_only is not None]
    assert len(human) >= 6, [row.family for row in human]
    for row in human:
        reason = row.human_only.strip()
        assert len(reason) > 40, f"{row.family}: no reason CI may not run it"
        assert "never executed by CI" in reason, (
            f"{row.family}: the reason does not say CI never runs it: {reason!r}"
        )
        assert re.search(r"Keychain|package manager|forge|dependency", reason), (
            f"{row.family}: the reason names nothing it would touch: {reason!r}"
        )


# --- THE GUARD: a printed command that is not registered fails here ------------

GIT_SUBCOMMANDS = (
    "add|apply|branch|checkout|clone|commit|config|diff|fetch|init|log|pull|"
    "push|rebase|remote|reset|rev-parse|status|switch|worktree"
)
COMMAND_SHAPED = re.compile(
    r"(?:^|(?<=[\n:`'\"])|(?<=\bwith ))[ \t]*"
    r"(?P<span>(?:wring|wringer-drive|wringer-board|npm|security|uv)\s+[a-z]"
    r"[^\n`'\")(]*"
    r"|git\s+(?:" + GIT_SUBCOMMANDS + r")\b[^\n`'\")(]*)"
)
#: `wring verify: <message>` — the verb naming itself. 110 of the 252 naive
#: matches, and not one of them is a command anybody is told to run.
LABEL = re.compile(r"^(?:wring|wringer-drive|wringer-board)\s+[a-z-]+:")
#: Where a matched pattern may stop: at the end, or before plain English.
#: A flag, a placeholder or a path after the match is argv the row did not
#: claim, and that is an unregistered command.
PLAIN_ENGLISH_FOLLOWS = re.compile(r"\s+[a-z][a-z']*(?:\s|$)")


def command_spans(text: str) -> list[str]:
    found = []
    for match in COMMAND_SHAPED.finditer(text):
        span = re.split(r",\s|\s+[—–]\s+|\s+\(", match.group("span"))[0]
        span = span.rstrip(" .,;")
        if LABEL.match(span):
            continue
        found.append(span)
    return found


def shipped_string_literals() -> list[tuple[str, int, str]]:
    """Every string literal in the three shipped packages, docstrings exempt —
    the 0.6.6 installed-pointer guard's walk, kept in step with it."""
    literals = []
    for package in PACKAGES:
        for path in sorted((repo_root() / "src" / package).glob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            docstrings = set()
            for scope in ast.walk(tree):
                if isinstance(
                    scope,
                    (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef,
                     ast.ClassDef),
                ) and scope.body:
                    first = scope.body[0]
                    if isinstance(first, ast.Expr) and isinstance(
                        first.value, ast.Constant
                    ):
                        docstrings.add(id(first.value))
            for node in ast.walk(tree):
                if id(node) in docstrings:
                    continue
                if isinstance(node, ast.Constant) and isinstance(node.value, str):
                    literals.append((f"{package}/{path.name}", node.lineno, node.value))
    return literals


def covering_rows(span: str) -> list[Printed]:
    """The rows whose pattern consumes the longest argv-like prefix of the
    span. One is a registration; zero or two is a guard failure."""
    best: list[Printed] = []
    best_end = -1
    for row in REGISTRY:
        for pattern in row.patterns:
            match = re.match(pattern, span)
            if match is None:
                continue
            rest = span[match.end():]
            if rest and not PLAIN_ENGLISH_FOLLOWS.match(rest):
                continue
            if match.end() > best_end:
                best, best_end = [row], match.end()
            elif match.end() == best_end and row not in best:
                best.append(row)
    return best


def registry_coverage() -> tuple[int, int, list[str]]:
    """(command-shaped literals found, matched by exactly one row, offenders)."""
    found = matched = 0
    offenders = []
    for where, lineno, value in shipped_string_literals():
        for span in command_spans(value):
            found += 1
            rows = covering_rows(span)
            if len(rows) == 1:
                matched += 1
                continue
            named = [row.family for row in rows] or ["UNREGISTERED"]
            offenders.append(f"{where}:{lineno} {span!r} -> {named}")
    return found, matched, offenders


def test_EVERY_PRINTED_COMMAND_IS_REGISTERED():
    """A command printed but registered nowhere fails here, by file, line and
    literal. Measured at 0.7.5: 202 command-shaped sites across the three
    packages, every one matched by exactly one row. The floor below is
    what keeps this guard from going vacuous the way the spec-table guard
    once did: if the walk finds almost nothing, the walk is broken."""
    found, matched, offenders = registry_coverage()
    assert found > 150, (
        f"only {found} command-shaped literals found — the walk or the regex "
        "is broken, and a guard over nothing is not a guard"
    )
    assert not offenders, (
        f"{len(offenders)} printed command(s) no registry row covers "
        "(or two rows claim). Register each in tests/journey/"
        "test_printed_commands.py with an executor, a named CI test that "
        "runs it, or a human-only reason:\n  " + "\n  ".join(offenders)
    )
    assert matched == found
