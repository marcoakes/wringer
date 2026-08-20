"""Run a job graph and record what each job did."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass

from pipeline.graph import Graph

OK = "ok"
FAILED = "failed"


@dataclass(frozen=True)
class Result:
    """What one job did, and why."""

    name: str
    status: str
    detail: str = ""


def shell(command: str) -> tuple[int, str]:
    """Run one job's command. Separated so tests can drive the runner."""
    done = subprocess.run(
        command, shell=True, capture_output=True, text=True, check=False
    )
    return done.returncode, (done.stderr or done.stdout).strip()


def run(graph: Graph, execute=shell) -> list[Result]:
    """Run every job in dependency order and collect the results."""
    results: list[Result] = []
    for name in graph.order():
        code, output = execute(graph.jobs[name].command)
        if code == 0:
            results.append(Result(name=name, status=OK))
        else:
            results.append(
                Result(name=name, status=FAILED, detail=output or f"exit {code}")
            )
    return results


def succeeded(results: list[Result]) -> bool:
    return all(result.status == OK for result in results)
