#!/usr/bin/env python3
"""Check every precondition a paid benchmark run needs — and spend nothing.

**This makes no API call.** Not as an oversight: the one precondition it cannot
check offline is whether the account has credit, and the cheapest honest way to
learn that is to run the task. So this reports everything else and then says so.

The point of the command is that when it prints `READY`, the only thing left
between you and a result is money. One line per check, `wring doctor`'s shape,
because that command already taught this repo what a precondition report looks
like.

    python3 benchmark/preflight.py --task benchmark/tasks/smoke-real-agent.yaml
"""

from __future__ import annotations

import argparse
import importlib.util
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent

OK, FAIL, NOTE = "✓", "✗", "·"

# Cost estimates, with their provenance, because a number with no source is a
# number somebody will quote. Measured on this project 2026-08-11: one real
# drafting call was 736 in / 2049 out, and one real repair turn was 41301 tokens
# for $0.75 (docs/first-contact.md).
SMOKE_COST = "roughly $1-3 — two arms, one small planted bug, one turn each"
CORPUS_COST = (
    "roughly $80-400 for one full pass — 10-20 tasks x 2 arms, plus reruns"
)


@dataclass(frozen=True)
class Check:
    mark: str
    name: str
    detail: str
    fix: str = ""


def load_harness():
    spec = importlib.util.spec_from_file_location(
        "wringer_benchmark_harness", HERE / "harness.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def check_task(harness, path: Path) -> tuple[Check, object | None]:
    try:
        task = harness.load_task(path)
    except harness.TaskError as exc:
        return Check(FAIL, "task file", str(exc), f"fix {path}"), None
    return Check(OK, "task file", f"{task.id} — {path.name}"), task


def check_repo(task) -> Check:
    if not task.repo.is_dir():
        return Check(
            FAIL, "task repo", f"{task.repo} does not exist",
            "sh benchmark/tasks/demo/build.sh agent benchmark/tasks/demo "
            "$(command -v python3)",
        )
    if not (task.repo / ".git").exists():
        return Check(FAIL, "task repo", f"{task.repo} is not a git repository")
    return Check(OK, "task repo", str(task.repo))


def check_agent(task) -> list[Check]:
    if task.agent is None:
        return [
            Check(
                NOTE, "agent", "this task is SCRIPTED — it costs nothing and "
                "needs no credential",
            )
        ]
    found = shutil.which(task.agent.command)
    checks = [
        Check(OK, "agent binary", f"{task.agent.command} at {found}")
        if found
        else Check(
            FAIL, "agent binary", f"{task.agent.command} is not on PATH",
            "npm install -g @agentclientprotocol/claude-agent-acp",
        )
    ]
    if found:
        # The version, because `agents.py` has already shipped a registry
        # naming a DEAD package once (the deprecated
        # @zed-industries/claude-code-acp, frozen at 0.16.2). A binary that
        # exists is not a binary that is current.
        listed = subprocess.run(
            ["npm", "ls", "-g", "--depth=0"], capture_output=True, text=True
        )
        line = next(
            (
                row.strip()
                for row in listed.stdout.splitlines()
                if "claude-agent-acp" in row or "claude-code-acp" in row
            ),
            "",
        )
        if "zed-industries" in line:
            checks.append(
                Check(
                    FAIL, "agent package", f"{line} — that package is DEPRECATED",
                    "npm uninstall -g @zed-industries/claude-code-acp && "
                    "npm install -g @agentclientprotocol/claude-agent-acp",
                )
            )
        elif line:
            checks.append(Check(OK, "agent package", line))
    return checks


def check_credential(harness, task) -> Check:
    """That the Keychain entry EXISTS. Its value is never read into this report.

    `security` is asked for presence only — `find-generic-password` without
    `-w` prints metadata and not the secret, so nothing here can leak it into a
    terminal, a log or a screenshot.
    """
    if task.agent is None or not task.agent.keychain_service:
        return Check(NOTE, "credential", "this task declares none")
    argv = [
        "security", "find-generic-password", "-s", task.agent.keychain_service
    ]
    if task.agent.keychain_account:
        argv += ["-a", task.agent.keychain_account]
    done = subprocess.run(argv, capture_output=True, text=True)
    where = task.agent.keychain_service + (
        f"/{task.agent.keychain_account}" if task.agent.keychain_account else ""
    )
    if done.returncode != 0:
        return Check(
            FAIL, "credential", f"no Keychain entry for {where}",
            f"security add-generic-password -U -s {task.agent.keychain_service} "
            f"-a {task.agent.keychain_account or 'wringer'} -w",
        )
    return Check(OK, "credential", f"Keychain entry {where} present (value not read)")


def check_isolation(harness, task) -> Check:
    """The held-out signal must be invisible to the worker AND to every gate.

    Run HERE as well as in the harness, because discovering a void experiment
    after paying for a turn is the expensive way to learn it.
    """
    try:
        harness.check_isolation(task, task.repo)
    except harness.Void as exc:
        return Check(FAIL, "held-out isolation", f"VOID — {exc}")
    except harness.TaskError as exc:
        return Check(FAIL, "held-out isolation", str(exc))
    return Check(
        OK, "held-out isolation",
        "not in the tree, not in a gate command, not in the statement",
    )


def check_wring() -> list[Check]:
    """The Wringer the HARNESS will actually use — not whatever `wring` is on PATH.

    Those are different things, and this check reported the wrong one first: the
    harness invokes `sys.executable -m wringer`, while PATH here gave a stale
    `~/.local/bin/wring` at 0.2.0 shadowing the repo's 0.3.0. A preflight that
    read the shadowed binary would have said "0.2.0" about a run that used 0.3.0
    — a green report about a version nothing would execute.
    """
    checks: list[Check] = []
    mine = subprocess.run(
        [sys.executable, "-m", "wringer", "--version"],
        capture_output=True, text=True,
    )
    if mine.returncode != 0:
        return [
            Check(
                FAIL, "wringer", f"{sys.executable} cannot import wringer",
                "pip install -e '.[dev]'  (from the repo root), then run this "
                "with that interpreter",
            )
        ]
    used = mine.stdout.strip()
    checks.append(Check(OK, "wringer", f"{used} — via {sys.executable}"))

    # A stale `wring` on PATH does not break the run, and saying nothing about
    # it invites somebody to debug the wrong version for an hour.
    found = shutil.which("wring")
    if found is not None:
        theirs = subprocess.run(
            [found, "--version"], capture_output=True, text=True
        ).stdout.strip()
        if theirs and theirs != used:
            checks.append(
                Check(
                    NOTE, "wring on PATH",
                    f"{theirs} at {found} — SHADOWS the one above. Harmless "
                    "here (the harness never calls it), but any `wring` you "
                    "type yourself is that one",
                )
            )
    return checks


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Check a benchmark task's preconditions without spending.",
    )
    parser.add_argument("--task", required=True)
    args = parser.parse_args(argv)

    harness = load_harness()
    checks: list[Check] = list(check_wring())
    task_check, task = check_task(harness, Path(args.task))
    checks.append(task_check)

    if task is not None:
        checks.append(check_repo(task))
        checks += check_agent(task)
        checks.append(check_credential(harness, task))
        if task.repo.is_dir():
            checks.append(check_isolation(harness, task))

    width = max(len(check.name) for check in checks)
    for check in checks:
        print(f"{check.mark} {check.name:<{width}}  {check.detail}")
        if check.fix:
            print(f"{'':<{width + 2}}  → {check.fix}")

    blocking = [check for check in checks if check.mark == FAIL]
    print()
    if blocking:
        print(f"NOT READY — {len(blocking)} precondition(s) above to fix first.")
        return 1

    paid = task is not None and task.agent is not None
    if not paid:
        print("READY. This task is scripted and costs nothing:")
        print(f"  python3 benchmark/harness.py --task {args.task} --out results/")
        return 0

    print("READY — and the ONLY thing left is money.")
    print()
    print("  This task:   " + SMOKE_COST)
    print("  A corpus:    " + CORPUS_COST)
    print()
    print("**No API call has been made by this command**, so whether the")
    print("account has credit is the one precondition it cannot check. Add")
    print("credit at https://console.anthropic.com/settings/billing, then:")
    print()
    print(f"  python3 benchmark/harness.py --task {args.task} --out results/")
    print()
    print("A run with no credit fails at the agent's first turn and records")
    print("VOID for that arm — it will not be mistaken for a refusal.")
    return 0


if __name__ == "__main__":  # pragma: no cover - the entry point
    raise SystemExit(main())
