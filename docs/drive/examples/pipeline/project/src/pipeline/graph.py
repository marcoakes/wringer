"""The job graph: what depends on what, and in which order it may run."""

from __future__ import annotations

from dataclasses import dataclass, field


class GraphError(Exception):
    """The graph cannot be run as written."""


@dataclass(frozen=True)
class Job:
    """One step of a pipeline, and the steps it waits for."""

    name: str
    needs: tuple[str, ...] = ()
    command: str = ""


@dataclass
class Graph:
    jobs: dict[str, Job] = field(default_factory=dict)

    @classmethod
    def from_data(cls, data: object) -> Graph:
        if not isinstance(data, dict):
            raise GraphError("a pipeline must be a mapping of job name to job")
        jobs: dict[str, Job] = {}
        for name, raw in data.items():
            if not isinstance(name, str) or not name:
                raise GraphError(f"job names must be non-empty strings: {name!r}")
            if not isinstance(raw, dict):
                raise GraphError(f"job {name!r} must be a mapping")
            unknown = sorted(set(raw) - {"needs", "command"})
            if unknown:
                raise GraphError(f"job {name!r}: unknown keys: {', '.join(unknown)}")
            needs = raw.get("needs") or []
            if not isinstance(needs, list) or any(
                not isinstance(n, str) for n in needs
            ):
                raise GraphError(f"job {name!r}: 'needs' must be a list of names")
            jobs[name] = Job(
                name=name, needs=tuple(needs), command=str(raw.get("command") or "")
            )
        for job in jobs.values():
            for need in job.needs:
                if need not in jobs:
                    raise GraphError(
                        f"job {job.name!r} needs {need!r}, which is not declared"
                    )
        return cls(jobs=jobs)

    def dependents(self, name: str) -> tuple[str, ...]:
        """The jobs that name this one directly."""
        return tuple(
            sorted(job.name for job in self.jobs.values() if name in job.needs)
        )

    def order(self) -> tuple[str, ...]:
        """A run order: every job after everything it needs.

        Ties are broken by name so a run is reproducible; a cycle is refused
        rather than run in some arbitrary order that happens to terminate.
        """
        remaining = {name: set(job.needs) for name, job in self.jobs.items()}
        ordered: list[str] = []
        while remaining:
            ready = sorted(n for n, needs in remaining.items() if not needs)
            if not ready:
                stuck = ", ".join(sorted(remaining))
                raise GraphError(f"these jobs depend on each other in a cycle: {stuck}")
            for name in ready:
                ordered.append(name)
                del remaining[name]
            for needs in remaining.values():
                needs.difference_update(ready)
        return tuple(ordered)
