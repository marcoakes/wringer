"""Run a verification and write its bundle — the core `wring verify` drives.

Split out of `cli.py` so something other than the console can ask for a
verification and get the answer as data: `wring run` needs a full verify per
iteration (SPEC_RUN_V0.md), and shelling out to itself to get one would mean
parsing its own output.

The split is deliberately narrow. This module owns the part that is the same
however it was invoked — snapshot git, open a bundle, run the planned gates
in order, stop on the first required failure, write the manifest and the
summary. `cli.py` keeps everything that is about being a command line:
argument parsing, precondition messages, exit codes, and printing.
"""

from __future__ import annotations

import os
import signal
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from wringer import (
    __version__,
    accept,
    concurrency,
    config,
    detect,
    evidence,
    gates,
    git,
    redact,
    stability,
    summary,
    vacuity,
)
from wringer import backend as backend_module
from wringer import containment as containment_module

# Called as each gate finishes, so a console can report a long run as it
# happens rather than after it. None for callers that want no output.
GateReporter = Callable[[gates.GateResult], None]


@dataclass(frozen=True)
class Outcome:
    """Everything a caller could want to know about one verification."""

    bundle: evidence.Bundle
    results: list[gates.GateResult]
    skipped: list[config.Gate]
    interrupted: summary.Interrupted | None
    failed_gate: str | None
    status: str
    # Every required gate is still the placeholder `wring init` writes, so
    # this run's `passed` is about the harness and not about the code. The
    # caller has to be able to say so; a green exit that quietly means
    # nothing is the failure mode this whole tool argues against.
    template_only: bool = False
    # The prove pass's verdict, when one ran. Carried for the SAME reason
    # as `template_only`: a run can pass and still have proven nothing,
    # and the caller cannot say so if the outcome does not tell it.
    # None means vacuity was never checked — which the console must stay
    # silent about (SPEC_VACUITY_V0 §7).
    vacuity: vacuity.Result | None = None
    # Every gate that declared a `stability:` policy, with every attempt it
    # made. Carried for the same reason as the two fields above and one more:
    # `wring run` READS it to decide whether a failing gate may be handed to a
    # worker, and a repair loop that cannot tell a flake from a bug hands the
    # agent source that was never wrong (SPEC_STABILITY_V0 §4). Empty for
    # every repo that declared no policy.
    stability: stability.Report = field(default_factory=stability.Report)
    # This lap's acceptance verdict, or None when no APPROVED spec declares
    # criteria — which is most repositories, and their bundles are unchanged.
    #
    # **Carried for the same reason `vacuity` and `stability` are, and P4-1 is
    # the caller that needed it.** The repair loop's continuation predicate was
    # `passed` alone, so a criterion whose witness was red while every declared
    # gate was green looked exactly like a converged run — which on the corpus
    # is EVERY task, because `CORPUS.md` §3 selects for gates that do not cover
    # the issue. The loop cannot ask "is there work left" from `results`, since
    # the answer lives in the acceptance row. `accept.assess` already computes
    # `required`, `covered` and `refuses`; recomputing any of that in `loop.py`
    # would be a second reader of one fact, drifting from the first.
    acceptance: accept.Result | None = None

    @property
    def passed(self) -> bool:
        return self.status == "passed"


def bundle_path(bundle: evidence.Bundle, root: Path) -> str:
    """The bundle's path as a reader would type it — repo-relative when it
    lives inside the repo, absolute when it somehow does not."""
    try:
        return bundle.directory.relative_to(root).as_posix()
    except ValueError:
        return str(bundle.directory)


def json_summary(outcome: Outcome, root: Path) -> dict[str, object]:
    """The `--json` object (spec §CLI surface), also embedded in a loop's
    brief so the worker reads exactly what an agent piping `--json` would.

    Keys are stable and present even when empty: a consumer should never have
    to distinguish "passed" from "the tool forgot to tell me".
    """
    return {
        "status": outcome.status,
        "failed_gate": outcome.failed_gate,
        "rerun": (
            f"wring verify --gate {outcome.failed_gate}"
            if outcome.failed_gate is not None
            else None
        ),
        "evidence_dir": bundle_path(outcome.bundle, root),
    }


def plan(
    cfg: config.Config, requested: str | Sequence[str] | None
) -> list[tuple[int, config.Gate]]:
    """The gates this run will attempt, each with its declared position.

    Every gate by default, in declared order (the config decides what runs
    cheapest first). `--gate ID` narrows the run but keeps each gate's
    number, so its evidence lands where a full run would have put it.

    **One id or many.** `wring verify --gate` has taken a single id since
    v0.1; SPEC_SCOPE_V0 lifts the concept to the loop, where a fleet child
    converges on the gates its task owns. That is one signature widened at
    one seam rather than a second verification path — `verify.run` iterates
    exactly the list it is handed, and a gate absent from that list is never
    a post-failure skip either, so it leaves no result and absence is already
    the record acceptance reads as `gate-did-not-run`.

    Narrowing NEVER reorders: the declared order is the order things run in,
    whatever order the ids were typed in.
    """
    numbered = list(enumerate(cfg.gates, start=1))
    if requested is None:
        return numbered

    wanted = [requested] if isinstance(requested, str) else list(requested)
    declared = {gate.id for gate in cfg.gates}
    for gate_id in wanted:
        if gate_id not in declared:
            # The unknown id BY NAME, never the whole requested list: with
            # several `--gate` flags the reader needs to know which one of
            # them they got wrong.
            known = ", ".join(gate.id for gate in cfg.gates)
            raise config.ConfigError(
                f"no gate '{gate_id}' in {config.CONFIG_FILENAME} "
                f"(declared: {known})"
            )

    chosen = set(wanted)
    return [(index, gate) for index, gate in numbered if gate.id in chosen]


def wants_prove(cfg: config.Config, flag: bool) -> bool:
    """Whether this run proves its gates can fail — SPEC_VACUITY_V0 §3a.

    **The config declares the policy; a flag may only tighten it.** `or` is
    the whole rule, and it is load-bearing rather than lazy: there is no
    expression here through which a caller could turn `run.prove: true` off,
    and there is deliberately no `--no-prove` and no environment variable for
    one to read.

    The reason is authority over the supervised party. `wring run` drives an
    agent that writes code, and `--prove` exists precisely to catch that agent
    writing tautological tests — so if switching it on were a flag, whoever
    invokes `wring run` would decide whether the check happens, and that
    invoker is increasingly the agent itself.
    """
    declared = cfg.run.prove if cfg.run is not None else False
    return bool(declared or flag)


def run(
    root: Path,
    cfg: config.Config,
    planned: list[tuple[int, config.Gate]],
    output: str | None = None,
    on_gate: GateReporter | None = None,
    prove: bool = False,
    serial: bool = False,
    established: object | None = None,
    witnesses: object | None = None,
) -> Outcome:
    """Verify once and write the bundle. Raises `evidence.EvidenceError` if
    the bundle cannot be opened; the caller decides what that costs.

    Raises `backend.BackendError` when the declared execution backend cannot
    run here — checked BEFORE the bundle is opened, so a missing container
    runtime costs a sentence rather than a half-written bundle that proves
    nothing.
    """
    engine = backend_module.for_config(cfg.execution)
    refusal = engine.preflight()
    if refusal is not None:
        raise backend_module.BackendError(refusal)
    # The worker's containment, checked in the same breath and the same place
    # (SPEC_CONTAIN_V0 ruling 3). STATIC refusals only — a `which`, an image
    # lookup, an image probe — so this costs no packet and `wring verify`
    # performs it too. That is the point: a repository whose containment is
    # broken finds out in CI rather than an hour into a corpus pass, and a
    # record that states repository policy is only worth reading if a
    # repository unable to honour its policy produces no bundle at all.
    #
    # The refusals that need a running container (a runtime that will not
    # start, an allowlist that will not arm) belong to `containment.establish`
    # and fire where a worker is about to run — because arming an allowlist
    # means issuing a DNS query, and SECURITY.md promises `wring verify` makes
    # no outbound connection.
    worker_containment = cfg.run.containment if cfg.run is not None else None
    # What Wringer KNOWS the image must carry, as opposed to what the
    # repository declared in `requires:` (SPEC_CONTAIN_V0 §11 A-5). An ACP
    # worker names its own binary, so an image that cannot run the declared
    # agent is refused through refusal 4 by name — at `wring verify` time,
    # rather than an hour into a corpus pass — without the repository having to
    # write the same name in two places and remember to keep them in step.
    worker_requires: tuple[str, ...] = ()
    if cfg.run is not None and isinstance(cfg.run.worker, config.AcpWorker):
        worker_requires = (cfg.run.worker.command,)
    containment_refusal = containment_module.preflight(
        worker_containment, root, worker_requires
    )
    if containment_refusal is not None:
        raise backend_module.BackendError(containment_refusal)
    # Snapshot git before the bundle exists, so Wringer's own run directory
    # is never what makes the tree look dirty — or shows up in its own
    # evidence as an untracked file.
    state = git.inspect(root)
    patch = git.diff(root, state.head_sha)
    status_text = git.status(root)
    # Built from the environment this run inherits, so the gates' own
    # secrets are the ones erased — plus every variable this config names as
    # holding a credential. A gate is a shell command that inherits the whole
    # environment, so the key `run.worker.acp.env_passthrough` declares for an
    # agent is one a gate can echo just as easily.
    redactor = redact.Redactor.from_config(
        cfg.evidence, extra_names=config.declared_secret_names(cfg)
    )
    if output is not None:
        bundle = evidence.Bundle.at(Path(output), redactor=redactor)
    else:
        bundle = evidence.Bundle.create(root / evidence.RUNS_DIRNAME, redactor=redactor)

    bundle.event(
        "run.started",
        run_id=bundle.run_id,
        wringer_version=__version__,
        repo=root.name,
        sha=state.head_sha,
    )
    bundle.event(
        "git.status",
        dirty=state.dirty,
        changed_files=list(state.changed_files),
        # Only when there are any, so the event stays the spec's shape for
        # the common case.
        **({"untracked": list(state.untracked)} if state.untracked else {}),
    )
    if patch is not None:
        bundle.write_capture(evidence.DIFF_FILENAME, patch)
    if status_text is not None:
        bundle.write_capture(evidence.STATUS_FILENAME, status_text)

    results: list[gates.GateResult] = []
    skipped: list[config.Gate] = []
    failed_gate: str | None = None
    interrupted: summary.Interrupted | None = None
    # Appended by `_run_gate` for every gate that declared a policy, INCLUDING
    # one a Ctrl-C caught between attempts: the attempts that did run are on
    # disk, so hiding them from the record here would be the retry-hiding this
    # feature exists to make impossible.
    observed: list[stability.Observed] = []
    # One row per gate that ran beside another. Empty for every repo that
    # declared no concurrency, and an empty list writes no file.
    ran_beside: list[concurrency.Ran] = []

    # Gates run in GROUPS, in declared order. A group is one gate, or a maximal
    # run of consecutive `concurrent: true` gates (SPEC_PERF_V0 §2). A repo that
    # declared none gets a group per gate, which is exactly the loop that shipped.
    grouped = group_gates(planned, serial=serial)
    for offset, group in enumerate(grouped):
        if len(group) > 1:
            names = [gate.id for _, gate in group]
            ran_beside += [
                concurrency.Ran(
                    gate_id=gate.id,
                    group=offset + 1,
                    beside=tuple(n for n in names if n != gate.id),
                )
                for _, gate in group
            ]
        remaining = [pending for _, pending in _flatten(grouped[offset + 1 :])]
        try:
            done = _run_group(
                bundle, group, root, observed, on_gate, engine
            )
        except KeyboardInterrupt:
            # Ctrl-C: finish the bundle rather than abandon it half-written.
            # A run that stopped is evidence too, as long as it says so.
            # The gate that was running is neither passed nor skipped, so it
            # is carried separately — its directory already exists and holds
            # whatever it printed before it was killed.
            index, gate = group[0]
            interrupted = summary.Interrupted(
                gate=gate, directory=bundle.gate_dir(index, gate.id)
            )
            skipped = [pending for _, pending in group[1:]] + remaining
            break
        results.extend(done)
        # **Every gate in a group runs, and only then is the stop decided.**
        # Within a group there is no early exit — the gates are already in
        # flight, so "stop at the first required failure" cannot mean what it
        # means serially. The contract is preserved at GROUP granularity: a
        # failure here still skips every later group, and a repo that declared
        # no concurrency has one gate per group and so keeps the contract
        # exactly.
        failed = next(
            (r for r in done if not r.passed and not r.gate.optional), None
        )
        if failed is not None:
            failed_gate = failed.gate.id
            skipped = remaining
            break

    if interrupted is not None:
        status = "interrupted"
    elif failed_gate is not None:
        status = "failed"
    else:
        status = "passed"

    bundle.event(
        "run.finished",
        status=status,
        **({"failed_gate": failed_gate} if failed_gate is not None else {}),
    )
    # Read from the config rather than recorded in the manifest:
    # `wringer.evidence.v1` is frozen and cannot grow a field for this.
    template_only = detect.is_untouched_template(cfg.gates)

    # The prove pass, when the repo declared it or a flag tightened to it.
    # AFTER the gates and only when they all passed: there is nothing to prove
    # about a failure, which is law 3's shape.
    proved: vacuity.Result | None = None
    if wants_prove(cfg, prove):
        if status != "passed":
            proved = vacuity.not_applicable(
                "a required gate failed, so there is nothing to prove about "
                "this run — fix the gate first"
            )
        else:
            proved = vacuity.prove(
                root, cfg, planned, results, bundle.directory, state.dirty,
                # The pre-change gates write into THIS bundle, so they get
                # this bundle's redactor. Without it they were the one set of
                # bundle files written with no scrubbing at all.
                redactor=bundle.redactor,
            )
        # NO LEDGER EVENT. This appended `vacuity.finished` until 2026-08-15,
        # and no published schema described it: `evidence-event.schema.json`
        # is a closed `oneOf` of five branches, so every `--prove` run's
        # ledger carried a line the bundle's own schema rejects — and it
        # landed AFTER `run.finished`, which every other reader treats as the
        # last line.
        #
        # The rule it broke is the one four sibling schemas already state in
        # writing (`vacuity`, `digests`, `untracked`, `stability`): the
        # evidence bundle is frozen at `wringer.evidence.v1`, so a new fact
        # arrives as its OWN FILE and `evidence.jsonl` grows no event type.
        # `stability.schema.json` says exactly that and then does it.
        #
        # Nothing read the event — one producer, zero consumers — and both of
        # its fields are in `vacuity.json`, which is written BEFORE
        # `digests.json` and is therefore covered by the bundle's own
        # tamper-evidence. Adding `wringer.evidence.v2` for a line nobody
        # reads would move the bundle-format version against four published
        # schemas saying that is precisely what siblings exist to avoid.

    observed_report = stability.Report(gates=tuple(observed))
    bundle.write_manifest(state=state, status=status, failed_gate=failed_gate)
    # EVERY run, opt-in or not, and before the digests like every other sibling.
    # A bundle that does not say where its gates ran is a bundle a reader fills
    # in with an assumption, and the assumption is the flattering one
    # (SPEC_EXEC_V0 §3).
    #
    # `worker` is whether the repo DECLARED one, not whether this invocation ran
    # it: `worker_execution` is a statement about the repository's policy, and
    # the policy is the same on the verify lap that precedes a worker and the
    # one that follows it. Keyed off the declaration so a verify-only repo gets
    # `null` rather than a sentence about a worker it does not have.
    #
    # `containment` is what moves this record to `wringer.execution.v2`, and
    # `established` is what separates POLICY from what this lap actually stood
    # up. `verify.run` never starts a holder — `wring verify`, `wring start`
    # and `wring bench`'s baseline all reach here having contained nothing —
    # so `established` is None and the record says so by omitting the block.
    # Absence is the honest reading; a placeholder would be this file claiming
    # a containment it did not have.
    backend_module.write(
        bundle.directory,
        engine,
        [gate.id for _, gate in planned],
        worker=cfg.run is not None,
        containment=worker_containment,
        established=established,
    )
    # Before the digests, like every other sibling, so the bundle's own
    # tamper-evidence covers the retry record rather than sitting beside it.
    # Absent entirely when no gate declared a policy.
    stability.write(
        bundle.directory,
        observed_report,
        bundle.relative,
        redactor=bundle.redactor,
    )
    # Before the digests like every other sibling. This is the record that keeps
    # `wring health`'s duration drift honest: a contended wall clock is a real
    # number and a different quantity, so health excludes these rows from the
    # comparison rather than treating the instrument's movement as the gates'
    # (SPEC_PERF_V0 §3, answering SPEED_PLAN R1).
    concurrency.write(bundle.directory, ran_beside)
    # Before the digests, so the digest covers it. git cannot diff a file it
    # has never seen, so without this an untracked file's *contents* are
    # absent from the bundle and delivery could only compare their names.
    bundle.write_untracked(root, state.untracked)
    if proved is not None:
        # Also before the digests, so the verdict and the pre-change logs are
        # covered by the bundle's own tamper-evidence rather than sitting
        # beside it.
        vacuity.write(bundle.directory, proved)
    # Acceptance LAST of the sibling files and AFTER vacuity, because a
    # `sensitive: true` row THIS run just wrote is one of the two receipts
    # that can evidence a criterion — the spec's own one-run remedy for a
    # gate born green. Assessing before vacuity.write left that row
    # invisible and the criterion unevidenced in the exact case the
    # remedy names. Still before the digests for the same reason vacuity is: the
    # artifact is part of what this bundle claims, so the bundle's own
    # tamper-evidence must cover it. Absent entirely unless an APPROVED spec
    # declares criteria (SPEC_ACCEPT_V0 ruling 8) — a repo that never opted
    # in writes a byte-identical bundle.
    # **The witnesses run HERE, not once at the end of the loop**, and that is
    # the placement W4 asks for: the pin is re-checked immediately before every
    # execution, so "the bytes that ran are the bytes that were pinned" is a
    # claim about this moment rather than about an hour ago. It also means every
    # lap's `acceptance.json` is a true statement about that lap, instead of one
    # lap's artifact being retro-fitted after the loop.
    witness_evidence = _run_witnesses(
        root, witnesses, bundle, cfg
    )
    accepted = accept.assess(
        root, cfg, results, state=state, redactor=bundle.redactor,
        witnesses=witness_evidence,
    )
    if accepted is not None:
        accept.write(bundle.directory, accepted, redactor=bundle.redactor)
    # AFTER acceptance, which is a move made for one reason: SPEC_GATEGEN
    # ruling 3 says a bound gate green at its first recorded run must be
    # called out, and `summary.md` is the document the person who just
    # installed that gate actually reads. The alternative was a second reader
    # of the same record inside the summary, which is the drift the review
    # of that spec spent its length refusing.
    # DERIVED from the two lists that already exist — the declared set and
    # the planned set — because a hand-kept second copy of "what was left
    # out" is exactly the guard that goes stale and then lies.
    scoped_to = [gate.id for _, gate in planned]
    scoped_out = [gate for gate in cfg.gates if gate.id not in set(scoped_to)]
    summary.write(
        bundle,
        state,
        results=results,
        skipped=skipped,
        scoped_out=scoped_out,
        scoped_to=scoped_to,
        failed_gate=failed_gate,
        status=status,
        interrupted=interrupted,
        template_only=template_only,
        vacuity=proved,
        acceptance=accepted,
        stability=observed_report,
        execution=engine,
    )
    # LAST, so it covers everything else the run wrote. `digests.json` is what
    # lets a later `wring attest` say "and none of it has been altered since"
    # about the whole bundle rather than only the ledger.
    bundle.write_digests()

    return Outcome(
        bundle=bundle,
        results=results,
        skipped=skipped,
        interrupted=interrupted,
        failed_gate=failed_gate,
        status=status,
        template_only=template_only,
        vacuity=proved,
        stability=observed_report,
        acceptance=accepted,
    )


Group = list[tuple[int, config.Gate]]


def group_gates(
    planned: list[tuple[int, config.Gate]], serial: bool = False
) -> list[Group]:
    """Partition the planned gates into groups that run together.

    A group is one gate, or a **maximal run of CONSECUTIVE** `concurrent: true`
    gates. Consecutive is the whole rule: collecting every concurrent gate into
    one group wherever it sat would reorder them relative to the serial gates
    between, and declared order is a contract — the config decides what runs
    cheapest first.

    A repo that declared no concurrency gets one group per gate, which is the
    loop that shipped.

    `serial=True` — `wring verify --serial` — collapses every group to one gate.
    It TIGHTENS and there is deliberately no flag that widens: a `--jobs N` would
    let an operator overlap gates the repository never declared safe to overlap,
    from outside the only file that knows whether they interfere.
    """
    if serial:
        return [[entry] for entry in planned]

    groups: list[Group] = []
    for entry in planned:
        _, gate = entry
        if gate.concurrent and groups and groups[-1][-1][1].concurrent:
            groups[-1].append(entry)
        else:
            groups.append([entry])
    return groups


def _flatten(groups: list[Group]) -> list[tuple[int, config.Gate]]:
    return [entry for group in groups for entry in group]


def _run_group(
    bundle: evidence.Bundle,
    group: Group,
    root: Path,
    observed: list[stability.Observed],
    on_gate: GateReporter | None,
    engine: Any,
) -> list[gates.GateResult]:
    """Run one group and return its results in DECLARED order.

    **The ledger is written by this thread and no other.** `Bundle.event` reads
    the file's last line to compute `prev_hash` and then appends, so two threads
    there would break the chain that is the bundle's whole tamper-evidence —
    silently, and in a way `wring audit` would later report as tampering on an
    honest run. The same rule `wring bench`'s parallel attempts follow, and for
    the same reason.

    So `gates.run` is what goes in the pool, and every event and every write into
    the bundle happens out here, in declared order, after the join. A group of
    one takes the serial path and does not build a pool at all — not an
    optimisation, but what keeps a repo that declared no concurrency running
    exactly as it did, live console output included.
    """
    for _index, gate in group:
        bundle.event("gate.started", gate_id=gate.id, command=gate.run)

    if len(group) == 1:
        index, gate = group[0]
        result = _run_gate(bundle, gate, index, root, observed, on_gate, engine)
        _gate_finished(bundle, result)
        return [result]

    from concurrent.futures import ThreadPoolExecutor

    # Every process group these gates start, so a Ctrl-C can reach them. A
    # thread pool does not receive SIGINT — only the main thread does — so
    # without this the pool's own shutdown would wait out every gate's full
    # timeout (900s by default) with nothing attached to its output. That is
    # SPEC_VERIFY's exit-4 contract quietly revoked by a pool, and it is the
    # same hazard `wring bench`'s parallel attempts reap through
    # `loop.worker_pgids`. Here the pids arrive through `gates.run`'s existing
    # `on_spawn`, which was written for precisely this.
    live: list[int] = []
    per_thread: list[list[stability.Observed]] = [[] for _ in group]

    def one(slot: int) -> gates.GateResult:
        index, gate = group[slot]
        return _run_gate(
            bundle, gate, index, root, per_thread[slot], on_gate, engine,
            on_spawn=live.append,
        )

    # Bounded by the group the repository declared and by nothing else. Wringer
    # does not invent a worker count: the repo said which gates may overlap, and
    # that IS the bound. A repo that marks twenty gates concurrent has asked for
    # twenty, and SPEC_PERF_V0 §5 says so rather than quietly capping it.
    with ThreadPoolExecutor(max_workers=len(group)) as pool:
        try:
            # `map`, not `as_completed`: results come back in declared order,
            # which is what keeps the bundle byte-deterministic over the same
            # inputs — and what lets the ledger below be written in that order.
            results = list(pool.map(one, range(len(group))))
        except BaseException:
            _kill_groups(live)
            # In declared order, so a partial record is still ordered.
            for collected in per_thread:
                observed.extend(collected)
            raise

    for collected in per_thread:
        observed.extend(collected)
    for result in results:
        _gate_finished(bundle, result)
    return results


def _kill_groups(pids: list[int]) -> None:
    """Kill the process groups of gates still in flight. Total by construction.

    Runs on the way out of an interrupt, so a failure here must not replace the
    interrupt with a different exception. `start_new_session` makes each gate a
    group leader, so its pid IS its pgid — the same fact `gates._stop` relies on.
    """
    for pid in list(pids):
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError, OSError):
            continue


def _run_gate(
    bundle: evidence.Bundle,
    gate: config.Gate,
    index: int,
    root: Path,
    observed: list[stability.Observed],
    on_gate: GateReporter | None,
    engine: Any,
    on_spawn: Any = None,
) -> gates.GateResult:
    """Run one gate — every attempt it declared — and record all of them.

    **Emits no ledger event.** `gate.started` and `gate.finished` are the
    caller's, written on one thread in declared order, because `Bundle.event`
    computes `prev_hash` from the ledger's last line and two threads there would
    break the chain silently (SPEC_PERF_V0 §3). This function may therefore run
    inside a pool; the two things in it that are not thread-safe — the events and
    the position in `observed` — were moved out for exactly that reason.

    Returns the DECIDING attempt: the one whose files stand at the gate's
    canonical path and whose verdict the run acts on. A gate that declared no
    `stability:` policy makes exactly one attempt, writes exactly where it
    always did, and appends nothing to `observed`.

    **Every attempt runs, even after the answer looks settled.** Stopping at
    the first failure would make `stable_fail` and `flaky` indistinguishable,
    which is the whole measurement; stopping at the first pass would be
    retry-until-green with a record attached.
    """
    gate_dir = bundle.gate_dir(index, gate.id)
    policy = gate.stability

    if policy is None:
        result = _one_attempt(bundle, gate, gate_dir, root, engine, on_spawn)
        if on_gate is not None:
            on_gate(result)
        return result

    collected: list[gates.GateResult] = []
    try:
        for attempt in range(1, policy.attempts + 1):
            result = _one_attempt(
                bundle,
                gate,
                stability.attempt_dir(gate_dir, attempt),
                root,
                engine,
                on_spawn,
            )
            collected.append(result)
            # One console line per ATTEMPT, so a retry cannot be hidden from
            # the terminal either. Three lines carrying the same gate id is
            # the honest shape: something ran three times.
            if on_gate is not None:
                on_gate(result)
    except KeyboardInterrupt:
        # The attempts that finished are on disk and belong in the record.
        # `Observed` reads fewer results than requested as `unknown`, and the
        # caller turns the interrupt into the run's own verdict.
        observed.append(
            stability.Observed(
                gate=gate, requested=policy.attempts, results=tuple(collected)
            )
        )
        raise

    seen = stability.Observed(
        gate=gate, requested=policy.attempts, results=tuple(collected)
    )
    observed.append(seen)
    deciding = seen.deciding
    # `deciding` is None only for `unresolved`, which needs an interrupt — and
    # an interrupt left through the `except` above.
    assert deciding is not None
    adopted = bundle.adopt_gate_attempt(gate_dir, deciding)
    return adopted


def _one_attempt(
    bundle: evidence.Bundle,
    gate: config.Gate,
    directory: Path,
    root: Path,
    engine: Any,
    on_spawn: Any = None,
) -> gates.GateResult:
    """Run the gate's command once, into the directory it was given."""
    result = gates.run(
        gate,
        cwd=root,
        stdout_path=directory / "stdout.log",
        stderr_path=directory / "stderr.log",
        redactor=bundle.redactor,
        backend=engine,
        on_spawn=on_spawn,
    )
    bundle.write_gate_result(directory, result)
    return result


def _gate_finished(bundle: evidence.Bundle, result: gates.GateResult) -> None:
    """The `gate.finished` event — one per gate, whatever it cost.

    Deliberately unchanged in shape. `wringer.evidence.v1` closes every branch
    with `additionalProperties: false`, so an `attempts` key here would make
    every bundle fail the schema it publishes; law 7 says new shape arrives as
    a new file, and `stability.json` is that file.
    """
    finished: dict[str, object] = {
        "gate_id": result.gate.id,
        "exit_code": result.exit_code,
        "duration_ms": result.duration_ms,
    }
    if not result.passed:
        # The spec carries `log` on the failing gate only — that is the one
        # a reader is being sent to.
        finished["log"] = bundle.relative(result.stdout_path)
    if result.truncated:
        # Only when true: an absent key means the log is whole.
        finished["truncated"] = True
    bundle.event("gate.finished", **finished)


def _run_witnesses(
    root: Path, witnesses: object | None, bundle: Any, cfg: config.Config
) -> dict[str, accept.WitnessEvidence]:
    """Execute each pinned witness against THIS tree, and report what it did.

    Returns evidence keyed by criterion, in the shape `accept.assess` consumes.
    An empty dict for every repository with no witness lane, which is what
    keeps their bundles byte-identical.

    **The pin is re-checked here, immediately before each execution**, against
    the bytes on disk (SPEC_GATEGEN_V0 §6 W4). A mismatch raises
    `witness.WitnessError` and VOIDs the run — not a failing gate, no run at
    all — because a check the worker could edit is a check that says nothing.

    A DISCARDED witness is still reported. It evidences nothing, but a reader
    needs to see that a criterion went to a human because its witness was born
    green or could not be collected, rather than finding a silent gap.
    """
    from wringer import witness as witness_module

    if not witnesses:
        return {}

    worker_containment = cfg.run.containment if cfg.run is not None else None
    evidence_by_criterion: dict[str, accept.WitnessEvidence] = {}
    for item in witnesses:
        pinned = item.record.get("pinned") or {}
        proved = item.proved_red.outcome if item.proved_red is not None else (
            witness_module.COLLECTION_ERROR
        )
        if not item.usable or not pinned:
            evidence_by_criterion[item.criterion] = accept.WitnessEvidence(
                pinned_sha256=pinned.get("sha256", ""),
                proved_red=proved,
                result="not_run",
                discarded=item.discarded or "the witness was never pinned",
                bundle=bundle_path(bundle, root),
            )
            continue

        witness_module.check_pin(item, pinned, root)
        executed = witness_module.execute(
            root, item,
            containment_settings=worker_containment,
            established=None,
        )
        item.executed = executed
        evidence_by_criterion[item.criterion] = accept.WitnessEvidence(
            pinned_sha256=pinned.get("sha256", ""),
            proved_red=proved,
            result="passed" if executed.passed else "failed",
            discarded=None,
            bundle=bundle_path(bundle, root),
        )
    return evidence_by_criterion
