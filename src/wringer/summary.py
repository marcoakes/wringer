"""Render `summary.md` — the human's entry point into a bundle.

Boring, stable, grep-friendly (SPEC_VERIFY_V0.md §The evidence
bundle): one screen that says what ran, against which commit, what it
cost, what failed, where the logs are, and the exact command that reruns
the failure. Machines get `evidence.jsonl` and `manifest.json`; this file
is for the person reviewing the change.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from wringer import accept, detect, evidence
from wringer.config import Gate
from wringer.evidence import Bundle
from wringer.gates import GateResult
from wringer.git import RepoState

# Named in evidence.py with the bundle's other filenames, and re-exported
# here because this module is the one that writes it.
SUMMARY_FILENAME = evidence.SUMMARY_FILENAME


@dataclass(frozen=True)
class Interrupted:
    """The gate that was running when the run stopped.

    It has no `GateResult` and no `result.json`: it never finished, and
    inventing a verdict for it would be a lie. What it does have is a
    directory holding whatever it printed before it was killed.
    """

    gate: Gate
    directory: Path


def write(
    bundle: Bundle,
    state: RepoState,
    results: list[GateResult],
    skipped: list[Gate],
    failed_gate: str | None,
    status: str = "passed",
    interrupted: Interrupted | None = None,
    template_only: bool = False,
    vacuity: Any = None,
    acceptance: Any = None,
    scoped_out: list[Gate] | None = None,
    scoped_to: list[str] | None = None,
) -> Path:
    """Write `summary.md` into the bundle and return its path."""
    lines = [
        f"# wring verify — {bundle.run_id}",
        "",
        _repo_line(state),
        f"- started: {bundle.started_at.replace(microsecond=0).isoformat()}",
        _result_line(status, failed_gate),
    ]
    changes = _changes_line(state)
    if changes is not None:
        lines.append(changes)
    # Before the table, because the table is the part that looks like proof.
    # A bundle whose result says `passed` must not be readable as "verified"
    # when the only gate that ran was the placeholder — the terminal saying
    # so is not enough, since the bundle is what outlives the terminal and
    # what a reviewer is handed.
    if template_only:
        lines += ["", f"> ⚠ **{detect.TEMPLATE_WARNING}**"]
    lines += [
        "",
        "| gate | status | duration | logs |",
        "|---|---|---|---|",
    ]

    for result in results:
        lines.append(
            f"| {result.gate.id} | {_status(result)} "
            f"| {result.duration_ms / 1000:.1f}s | {_logs(bundle, result)} |"
        )
    # The gate a Ctrl-C caught mid-flight: it ran, so "skipped" would be
    # false, and it never finished, so no status is available. It gets its
    # own word and keeps its place in the order.
    if interrupted is not None:
        lines.append(
            f"| {interrupted.gate.id} | interrupted | — "
            f"| {_partial_logs(bundle, interrupted.directory)} |"
        )
    # Gates after a required failure never ran: named here, absent from
    # evidence.jsonl, so the summary is the one place the whole declared
    # set is visible.
    for gate in skipped:
        lines.append(f"| {gate.id} | skipped | — | — |")

    lines += _scoped_out_section(scoped_out, scoped_to)

    if vacuity is not None:
        lines += _vacuity_section(vacuity)

    lines += _born_green_section(acceptance)

    if failed_gate is not None:
        lines += [
            "",
            "Rerun the failing gate:",
            "",
            "```",
            f"wring verify --gate {failed_gate}",
            "```",
        ]

    path = bundle.directory / SUMMARY_FILENAME
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _scoped_out_section(
    scoped_out: list[Gate] | None, scoped_to: list[str] | None
) -> list[str]:
    """The gates this run was not asked to run — SPEC_SCOPE_V0 DONE box 2.

    Human-readable at the run level, machine-readable at the fleet level
    (`scope.json`), and absence at the result level: three records, one
    truth. This is the one a person opens.

    **These gates are deliberately NOT rows in the table above.** A row would
    put them in the document that looks like proof; the table is what this
    run measured, and it measured nothing about these. `skipped` is a
    different word for a different thing — a gate after a required failure
    was going to run and did not — and collapsing the two would hide which
    of them the operator chose.

    Absent entirely when nothing was scoped out, so an unscoped run writes
    the summary it always wrote.
    """
    if not scoped_out:
        return []
    named = ", ".join(f"`{gate_id}`" for gate_id in (scoped_to or ()))
    return [
        "",
        "## Scoped out",
        "",
        f"Not run, because this run was scoped to {named}. This bundle "
        "measured nothing about the gates below and claims nothing about "
        "them: each leaves no result, which acceptance reads as "
        "`gate-did-not-run` and delivery refuses on.",
        "",
        *[f"- `{gate.id}`" for gate in scoped_out],
    ]


def _born_green_section(acceptance: Any) -> list[str]:
    """Bound gates that passed with nothing in the record showing they can
    fail — SPEC_GATEGEN_V0 ruling 3, said where a person will read it.

    A gate written for a criterion whose feature does not exist yet has one
    honest colour and it is not green. `acceptance.json` has always recorded
    this as `unevidenced`; what it did not do was reach the document somebody
    opens right after applying a diff, where the row reads `passed` and a
    green tick is the last thing they see.

    **Not a second reader of the record.** The rows come from
    `accept.assess`, which `wring verify` has already run for its own
    artifact — this renders them, and decides nothing.
    """
    if acceptance is None:
        return []
    # `unevidenced` WITH a gate is precisely the born-green case: the unbound
    # kind carries no gate id at all, and telling a reader to go and look at
    # a command that does not exist would be the worse of the two mistakes.
    born_green = [
        row for row in acceptance.rows
        if row.state == accept.UNEVIDENCED and row.gate_id
    ]
    if not born_green:
        return []

    lines = ["", "## Bound gates that have never been red", ""]
    for row in born_green:
        lines.append(
            f"- ⚠ **`{row.gate_id}` should be RED.** It proves "
            f"`{row.criterion}`, and nothing in the record shows it can fail. "
            "If the criterion is unmet, a gate that proves it must fail here "
            "— green means it tests something else, not that the work is "
            "done."
        )
    return lines


def _vacuity_section(result: Any) -> list[str]:
    """What `--prove` found, per gate, with each `sensitive` row citing why.

    The citation is the load-bearing part, not decoration. A detached
    worktree carries tracked files only, so in a repo whose dependencies are
    gitignored EVERY pre-change gate fails on a missing environment — and the
    comparison reads that as proof. `ModuleNotFoundError: No module named
    'yourproject'` in the row is what makes a false `proven` legible at a
    glance instead of convincing.
    """
    from wringer import vacuity as vacuity_module

    verdict = result.verdict
    lines = ["", f"## Vacuity — **{verdict}**", "", result.reason, ""]
    if result.setup and not result.setup.get("ok"):
        lines += [
            f"`run.prove_setup` (`{result.setup['command']}`) failed: "
            f"{result.setup.get('cites')}",
            "",
        ]
    if result.rows:
        lines += [
            "| gate | changed tree | pre-change tree | tests this change | "
            "because |",
            "|---|---|---|---|---|",
        ]
        for row in result.rows:
            lines.append(
                f"| {row.gate_id} | {row.changed} | {row.pre_change} "
                f"| {'yes' if row.sensitive else 'NO'} "
                f"| {row.cites or '—'} |"
            )
        lines.append("")
    if verdict == vacuity_module.GATES_VACUOUS:
        lines += [
            "> ⚠ **Every required gate passed without the change too, so they "
            "proved nothing about it.** Write a test that fails without your "
            "change, then verify again.",
            "",
        ]
    lines.append(
        f"Both trees' output: [`{vacuity_module.VACUITY_DIRNAME}/`]"
        f"({vacuity_module.VACUITY_DIRNAME}/) · "
        f"worktree {result.worktree_ms}ms, prove {result.prove_ms}ms"
    )
    return lines


def _repo_line(state: RepoState) -> str:
    name = state.root.name or str(state.root)
    if state.head_sha is None:
        return f"- repo: **{name}** — not a git repository"
    return (
        f"- repo: **{name}** @ `{state.head_sha[:7]}` "
        f"(branch `{state.branch or 'detached HEAD'}`, "
        f"{'dirty' if state.dirty else 'clean'})"
    )


def _changes_line(state: RepoState) -> str | None:
    """Point the reader at the captured tree, with the counts up front."""
    if state.head_sha is None:
        return None  # nothing was captured, so promise nothing
    counts = [f"{len(state.changed_files)} changed"]
    if state.untracked:
        counts.append(f"{len(state.untracked)} untracked")
    return (
        f"- files: {', '.join(counts)} "
        f"([{evidence.DIFF_FILENAME}]({evidence.DIFF_FILENAME}), "
        f"[{evidence.STATUS_FILENAME}]({evidence.STATUS_FILENAME}))"
    )


def _result_line(status: str, failed_gate: str | None) -> str:
    if status == "interrupted":
        return "- result: **interrupted** — stopped before every gate ran"
    if failed_gate is None:
        return "- result: **passed** — all required gates passed"
    return f"- result: **failed** — required gate `{failed_gate}` failed"


def _status(result: GateResult) -> str:
    if result.passed:
        return "passed"
    label = "timed out" if result.timed_out else "failed"
    return f"{label} (optional)" if result.gate.optional else label


def _partial_logs(bundle: Bundle, gate_dir: Path) -> str:
    """Links for a gate that was killed before it finished.

    Only to files that exist: a gate stopped before it wrote anything leaves
    an empty directory, and a link to a missing log is worse than no link.
    """
    links = [
        f"[{name}]({bundle.relative(path)})"
        for name in ("stdout", "stderr")
        if (path := gate_dir / f"{name}.log").is_file()
    ]
    return " · ".join(links) if links else "—"


def _logs(bundle: Bundle, result: GateResult) -> str:
    return " · ".join(
        f"[{name}]({bundle.relative(path)})"
        for name, path in (
            ("stdout", result.stdout_path),
            ("stderr", result.stderr_path),
        )
    )
