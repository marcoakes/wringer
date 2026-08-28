"""Render `summary.md` — the human's entry point into a bundle.

Boring, stable, grep-friendly (docs/specs/SPEC_VERIFY_V0.md §The evidence
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
from wringer import coverage as coverage_module
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
    recorded_after_failure: tuple[str, ...] = (),
    status: str = "passed",
    interrupted: Interrupted | None = None,
    template_only: bool = False,
    vacuity: Any = None,
    acceptance: Any = None,
    scoped_out: list[Gate] | None = None,
    scoped_to: list[str] | None = None,
    stability: Any = None,
    execution: Any = None,
    coverage: Any = None,
    falsification: Any = None,
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
    # **Before the table too, and for the same reason** — field report
    # 2026-08-26 finding 3. This file is what `mr.md` calls "the
    # human-readable report", and it carried three green rows and the word
    # `passed` while six of eight criteria had nothing proving them. The
    # renderer is `accept.disclosure`, quoted verbatim by `mr.md` as well, so
    # the two surfaces that travel to a merger cannot come to say different
    # amounts of the same fact.
    if acceptance is not None:
        lines += accept.disclosure(acceptance.counts())
    # **The coverage number, right under the states it explains** — the field
    # case is run 2, where 5 of 8 requirements had no check at all and the
    # defect that run existed to fix landed on one of the unwatched ones. The
    # states above say what happened; this says how much of what was asked for
    # anybody is watching, which is a different question and had no number.
    #
    # Two lines, never blended (SPEC_COVERAGE_V0, ruling MR1), and both from
    # `coverage.lines` — the one renderer every surface quotes.
    if coverage is not None:
        lines += coverage_module.quoted(coverage)
    lines += [
        "",
        "| gate | status | duration | logs |",
        "|---|---|---|---|",
    ]

    for result in results:
        lines.append(
            f"| {result.gate.id} | {_status(result)}{_flake_mark(stability, result)}"
            f"{_for_the_record(recorded_after_failure, result)}"
            f"{_environment_mark(result)} "
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

    lines += _environment_section(results)

    lines += _execution_section(execution)

    lines += _scoped_out_section(scoped_out, scoped_to)

    lines += _stability_section(bundle, stability)

    if vacuity is not None:
        lines += _vacuity_section(vacuity)

    lines += _born_green_section(acceptance)

    lines += _falsification_section(falsification)

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


def _execution_section(execution: Any) -> list[str]:
    """Where these gates ran — one line for `local`, a table for a container.

    Present on EVERY run, unlike every other section here, and for the reason
    `execution.json` is unconditional: a reader who is not told where a command
    ran supplies the flattering answer. One line is the whole cost of never
    letting them.
    """
    if execution is None:  # pragma: no cover - verify always passes one
        return []
    from wringer import backend as backend_module

    if execution.name == backend_module.LOCAL:
        return [
            "",
            "## Where these gates ran",
            "",
            "**On this machine** (`execution_mode: trusted_local`), with the "
            "invoking user's privileges and the whole environment inherited. "
            "That is not a sandbox and Wringer has never claimed it is one — "
            "`.wringer.yaml` is code, and it ran as you.",
        ]
    identity = execution.identity()
    return [
        "",
        "## Where these gates ran",
        "",
        f"**In a container** — image `{identity['image']}` via "
        f"`{identity['runtime']}`, mounted at `{identity['mount']}`, "
        f"network {'ON (explicitly enabled)' if identity['network'] else 'off'}"
        + (
            f", environment allowlist: "
            f"{', '.join(f'`{n}`' for n in identity['env_allowlist'])}"
            if identity["env_allowlist"]
            else ", no environment passed through"
        )
        + ".",
        "",
        "This records the command line Wringer **asked the runtime for**. "
        "Whether the runtime delivered it is a separate claim, measured in "
        "part: `docs/MANUAL_CHECKS.md` sequence G ran seven named attacks on "
        "three platform-and-runtime combinations and six were prevented in "
        "each. That is not an escape suite, and no `--privileged` control run "
        "has shown these flags are what stopped them. The mount is read-write "
        "by design, because the evidence is written inside the tree.",
    ]


def _flake_mark(stability: Any, result: GateResult) -> str:
    """`(flaky)` beside a gate's status in the table above.

    The table is the part of this document that looks like proof, and for a
    flaky gate neither word in it is the whole truth: `failed` reads as "your
    code is broken", and a TOLERATED mixture reads `passed` while the record
    says the result was a coin flip. One word here is what stops a reader
    acting on the row before they reach the section below.
    """
    if stability is None:
        return ""
    from wringer import stability as stability_module

    row = stability.of(result.gate.id)
    if row is None or row.classification != stability_module.FLAKY:
        return ""
    return " (flaky, tolerated)" if row.tolerated else " (flaky)"


def _environment_mark(result: GateResult) -> str:
    """`(maybe the environment)` beside a red that may not be the code's.

    **Field report 2026-08-28, finding 4.** The first `wring verify` of that
    run recorded `ruff: command not found` — the example's gates resolve only
    with the project's `.venv` on PATH. That is documented behaviour and not a
    defect: the bundle says plainly that gates run with the whole environment
    inherited. What it is not is a red the requirement earned, and in the
    summary it was **indistinguishable** from one. It went into the record as
    one.

    So the table says which it might be, in four words, because the table is
    what a person reads before they go and change their code.

    **Hint tier, and it stays there.** `diagnose.face_of` may read text
    precisely because nothing it returns decides anything — SPEC_ENV ruling 1,
    *a classification may ROUTE and may never CLAIM*. This changes no status,
    no exit code, no acceptance row and no verdict. It is four words beside a
    row that is red either way.
    """
    if result.passed:
        return ""
    from wringer import diagnose as diagnose_module

    return " (maybe the environment)" if diagnose_module.face_of(result) else ""


def _environment_section(results: list[GateResult]) -> list[str]:
    """What the mark above means, said once, with the line it was read from.

    Named a GUESS in its own first sentence rather than in a footnote: the
    whole tier's licence to read text at all is that it never claims, and a
    reader who takes this for a verdict has been misled by the surface rather
    than by the classifier.
    """
    from wringer import diagnose as diagnose_module

    found = [
        (result, diagnose_module.diagnose(result))
        for result in results
        if not result.passed
    ]
    found = [(result, seen) for result, seen in found if seen is not None]
    if not found:
        return []
    lines = [
        "",
        "## Some of these reds may not be yours",
        "",
        "A guess, read from what each gate printed. It decided nothing here — "
        "the gate is red either way, and no verdict, state or exit code "
        "changed because of it. It is here because a red the ENVIRONMENT "
        "caused and a red the requirement earned read identically in the "
        "table above, and a person acting on the wrong one goes and changes "
        "working code.",
        "",
    ]
    for result, seen in found:
        lines.append(
            f"- `{result.gate.id}` {seen.description}, by the look of it: "
            f"`{seen.evidence}`"
        )
    return lines


def _for_the_record(recorded_after_failure: tuple[str, ...], result: GateResult) -> str:
    """`(for the record)` beside a gate that ran after the run had failed.

    Field report 2026-08-27 finding 1's fix put bound gates back on the tree
    after a required failure, so their red reaches the record instead of being
    thrown away. That is worth exactly one word here, because without it the
    table shows two ✗ rows and a reader has no way to tell the gate that
    stopped the run from a gate that ran only so its result would be written
    down. `_result_line` already names which failure this run was; this names
    what the other rows are.
    """
    return " (for the record)" if result.gate.id in recorded_after_failure else ""


def _stability_section(bundle: Bundle, stability: Any) -> list[str]:
    """Every attempt every stability-declaring gate made — SPEC_STABILITY_V0.

    **This section is the anti-hidden-retry guarantee, in prose.** A gate run
    three times that reports one clean line is exactly what a hidden flake
    looks like, so the count, the per-attempt statuses and the links are here
    whatever the classification came out as — including `stable_pass`, where
    there is nothing to warn about and the reader still gets to see that three
    runs bought the tick.

    Absent entirely when no gate declared a policy, so every repo that has not
    opted in writes the summary it always wrote.
    """
    if stability is None or not stability.gates:
        return []
    from wringer import stability as stability_module

    lines = [
        "",
        "## Stability",
        "",
        "Gates that declared `stability:` ran more than once. Every attempt is "
        "on disk; the classification comes from the observations and from no "
        "gate's output.",
        "",
        "| gate | attempts | attempts ran | observed | classification |",
        "|---|---|---|---|---|",
    ]
    for row in stability.gates:
        observed = " ".join(
            "✓" if result.passed else "✗" for result in row.results
        ) or "—"
        lines.append(
            f"| {row.gate.id} | {row.requested} | {len(row.results)} "
            f"| {observed} | **{row.classification}** |"
        )
    lines.append("")
    for row in stability.gates:
        lines.append(f"- `{row.gate.id}` — {row.reason}")
        for number, result in enumerate(row.results, start=1):
            where = bundle.relative(result.stdout_path.parent)
            lines.append(
                f"  - attempt {number}: {result.status}, exit "
                f"{result.exit_code} — [`{where}/`]({where}/)"
            )
    flaky = [
        row
        for row in stability.gates
        if row.classification == stability_module.FLAKY
    ]
    if flaky:
        named = ", ".join(f"`{row.gate.id}`" for row in flaky)
        lines += [
            "",
            f"> ⚠ **{named} did not give the same answer twice on one tree.** "
            "Nothing in the tree explains the difference, so there is nothing "
            "here for a worker to fix — `wring run` will not hand these over, "
            "and an agent told to repair one would edit source that was never "
            "wrong. Fix the gate, not the code.",
        ]
    unknown = [
        row
        for row in stability.gates
        if row.classification == stability_module.UNKNOWN
    ]
    if unknown:
        named = ", ".join(f"`{row.gate.id}`" for row in unknown)
        lines += [
            "",
            f"> ⚠ **{named} ran fewer attempts than declared, so nothing was "
            "measured about them.** Treated as `stable_fail`: a gate that did "
            "not finish has not been shown to be deterministic.",
        ]
    return lines


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


def _falsification_section(result: Any) -> list[str]:
    """What happened when this change was broken on purpose.

    Absent unless `--falsify` was typed, which is the same absence rule every
    other optional section here keeps: a run that measured nothing is not a
    run that scored zero. The sentences are `falsify.lines` — one renderer,
    quoted by the certificate as well.
    """
    if result is None:
        return []
    from wringer import falsify as falsify_module

    said = falsify_module.lines(result.as_json())
    if not said:
        return []
    return ["", "## Broken on purpose", ""] + [
        one if one.startswith("  -") else f"- {one}" for one in said
    ]


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
