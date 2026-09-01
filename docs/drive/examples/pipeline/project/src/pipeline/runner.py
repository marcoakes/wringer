"""Run a job graph and record what each job did."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass

from pipeline.graph import Graph

OK = "ok"
FAILED = "failed"
# Public vocabulary, exported like the others: a consumer should never have
# to redefine a status string the package already owns.
SKIPPED = "skipped"


@dataclass(frozen=True)
class Result:
    """What one job did, and why.

    `blocked_by` is the one source of truth for why a job was skipped:
    the names of the failures it waited on. Prose belongs in the report,
    derived from this field — never stored beside it where the two could
    disagree.
    """

    name: str
    status: str
    detail: str = ""
    blocked_by: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        # Illegal states are refused at construction: a skip with no cause
        # is an unexplained hole, and a cause on a job that ran is a lie.
        if self.status == SKIPPED and not self.blocked_by:
            raise ValueError(f"{self.name}: skipped with no blocker named")
        if self.status != SKIPPED and self.blocked_by:
            raise ValueError(f"{self.name}: {self.status} but carries blockers")


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
    """Every job ran and passed.

    A skipped job never makes this true: a skip can only arise from a failed
    ancestor, so a run containing one has already not succeeded by way of
    that ancestor — and `all(== OK)` refuses the skip itself as well.
    """
    return all(result.status == OK for result in results)
