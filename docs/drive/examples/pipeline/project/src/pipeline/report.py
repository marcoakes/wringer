"""Turn a list of results into the summary a person reads after a run."""

from __future__ import annotations

from pipeline.runner import FAILED, OK, Result


def render(results: list[Result]) -> str:
    """One line per job, then a verdict line."""
    lines = []
    for result in results:
        if result.status == OK:
            lines.append(f"  ok       {result.name}")
        elif result.status == FAILED:
            lines.append(f"  FAILED   {result.name}  {result.detail}".rstrip())
        else:
            # The cause is DERIVED from the structured field, never stored
            # twice: prose beside `blocked_by` is a second truth waiting to
            # disagree with the first.
            cause = ", ".join(result.blocked_by) if result.blocked_by else result.detail
            lines.append(f"  {result.status:<8} {result.name}  {cause}".rstrip())
    failed = [r.name for r in results if r.status == FAILED]
    if failed:
        lines.append("")
        lines.append(f"Run did not succeed: {len(failed)} failed ({', '.join(failed)})")
    else:
        lines.append("")
        lines.append(f"Run succeeded: {len(results)} jobs")
    return "\n".join(lines)
