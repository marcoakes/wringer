"""`wringer-drive` — one verb, prose in, a board out.

Two front doors onto the SAME steps (SPEC_DRIVE_V0 §9 q4):

- `--emit json`, for a coding agent to drive. One JSON object per line.
- the default, for a person at a terminal when nothing is driving.

Neither is a second implementation. Both render `wringer_drive.steps.Step`
objects whose text came from the engine or the board, which is the only reason
they cannot drift into two products with two vocabularies.

**There is no `--yes`.** The approval question is asked by this process, after
this process rendered the plan, and no flag or environment variable answers it
— and neither does text that was already on stdin before the question was
rendered. Stale input is drained, never read: a pre-piped `yes` is an approval
nobody gave, and a pasted answer's overflow is not an answer to the next
question.
"""

from __future__ import annotations

import argparse
import io
import os
import select
import sys
from dataclasses import replace
from pathlib import Path

try:
    import termios
except ImportError:  # pragma: no cover — non-POSIX; the drain degrades below
    termios = None

from wringer_drive import run as run_module
from wringer_drive import steps
from wringer_drive.steps import ASK, SHOW, emit_json


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="wringer-drive",
        description=(
            "Take a document describing what you want built, and drive it "
            "through to a page showing what is done and what is proved."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    started = sub.add_parser(
        "run", help="prose in, a board out — the whole chain, one verb"
    )
    started.add_argument("prd", help="the document describing what you want")
    started.add_argument(
        "--repo", default=".", help="the project to build in (default: here)"
    )
    started.add_argument(
        "--emit",
        choices=("text", "json"),
        default="text",
        help="`json` emits one object per line for a coding agent to drive; "
        "`text` is for a person at a terminal. The same steps either way",
    )
    # **Deliberately absent, and this is where somebody would add it**: there
    # is no `--yes`, no `--auto`, no `--non-interactive` that answers the
    # approval. `test_there_is_no_flag_that_answers_the_approval` reads this
    # parser and fails if one appears.

    # 0.7.1 (P0.2): the verb run 4B had no name for. Same steps, same
    # renderer, one extra sentence first; it takes no document because the
    # record already knows where the one it copied is.
    resumed = sub.add_parser(
        "resume",
        help="continue a stopped run from the step it stopped at — answers, "
        "the approved plan and installed checks are reused, never re-asked",
    )
    resumed.add_argument(
        "--repo", default=".", help="the project the run stopped in (default: here)"
    )
    resumed.add_argument(
        "--emit",
        choices=("text", "json"),
        default="text",
        help="`json` emits one object per line for a coding agent to drive; "
        "`text` is for a person at a terminal. The same steps either way",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    repo = Path(args.repo).resolve()
    session = run_module.Session(repo=repo)

    try:
        if args.command == "resume":
            return _resume(session, args)
        return _run(session, args)
    except KeyboardInterrupt:
        # **START-HERE.md calls Ctrl-C safe; this gave a PM a traceback.**
        #
        # `wringer.cli.main` catches `KeyboardInterrupt` and this did not, and
        # SIGINT reaches the whole foreground process group — so the main
        # thread took it inside `proc.stdout.read()` or `_read_line`'s
        # `os.read(fd, 1)` and unwound uncaught, printing exactly the thing
        # `bring_prd_inside`'s own docstring says a product manager must never
        # see.
        #
        # And it says what has already been written, because by the time a
        # long build stalls `.gitignore` has been appended to and
        # `.wringer.yaml` has had the gate diff applied. "Nothing of yours is
        # touched" was not true at that point.
        session.emit(
            steps.Step(
                kind=steps.STOPPED,
                id="stopped:interrupted",
                text=(
                    "You stopped this. Nothing new was started. What was "
                    "already written stays: the PRD copy under `.wringer/`, "
                    "the `.gitignore` line, and any gates that were installed "
                    "in `.wringer.yaml` — all of them ordinary files you can "
                    "read and undo."
                ),
            )
        )
        return 4
    except run_module.Stop as stop:
        session.emit(stop.step)
        # **Which channel the ENDING goes to, and why it differs by mode.**
        #
        # At a terminal, a failure belongs on the error channel: that is what
        # a person's shell, pipeline and scrollback expect.
        #
        # In `json` mode stdout IS the step stream, and the ending is a step
        # like any other — the last one, and the one carrying the news. Found
        # by driving it on 2026-08-19: the refusal went to stderr, so an agent
        # following `AGENTS.md` (read one object per line from stdout) never
        # saw why the run stopped, and would have shown the person a board and
        # silence. The contract does not have an exception for the most
        # important object in it.
        _render(
            session.steps[-1:],
            args.emit,
            sys.stderr if stop.exit_code and args.emit != "json" else sys.stdout,
        )
        return stop.exit_code


def _render(steps, mode: str, stream=None) -> None:
    """**`stream=None`, not `stream=sys.stdout`.**

    A default argument is evaluated once, at import — so `stream=sys.stdout`
    captures whatever stdout was when the module loaded and ignores every
    later reassignment. Anything that replaces stdout after import (a test
    harness, a driver capturing output, `contextlib.redirect_stdout`) would
    have been silently written past. Found by this package's own tests, which
    saw nothing while the process printed correctly.
    """
    stream = stream if stream is not None else sys.stdout
    if mode == "json":
        stream.write(emit_json(steps))
    else:
        for step in steps:
            stream.write(step.as_terminal() + "\n\n")
    stream.flush()


def _drain_stale_stdin() -> str:
    """Discard whatever is already waiting on stdin, BEFORE a question renders.

    **Returns what it discarded, so the caller can SAY so.** Dropping a
    person's typing silently is how the field run lost half an answer without
    anyone noticing: the fix for the overflow reaching the approval was to
    drain it, and a silent drain trades one invisible loss for another. What
    is thrown away is shown.

    A terminal's typed-ahead lines live in the driver's own buffer and
    `tcflush` discards them without handing them over, so the tty branch
    returns nothing and cannot report. That is a real limit and it is stated
    rather than papered over.

    Text that arrived before a question existed cannot be that question's
    answer: it is a pasted answer's overflow, or a script's pre-supplied text.
    The field run had a stray line DECLINE a build; the mirror image — a stray
    `yes` approving one — is the consent model being answered by leftovers.
    The order in `_ask` is the whole mechanism: drain, then render, then read.
    An answer written after the question rendered is never touched.

    In-memory stdins (the suite's `io.StringIO`) have no descriptor and hold
    nothing the OS buffered, so there is nothing stale to drain there.
    """
    try:
        fd = sys.stdin.fileno()
    except (OSError, ValueError, io.UnsupportedOperation):
        return ""
    discarded = bytearray()
    try:
        if os.isatty(fd):
            # Typed-ahead lines live in the terminal driver, not the pipe.
            if termios is not None:
                termios.tcflush(fd, termios.TCIFLUSH)
            return ""
        while True:
            ready, _, _ = select.select([fd], [], [], 0)
            if not ready:
                break
            chunk = os.read(fd, 4096)
            if chunk == b"":
                break
            discarded += chunk
    except OSError:  # pragma: no cover — an unselectable stdin drains nothing
        return discarded.decode("utf-8", "replace")
    return discarded.decode("utf-8", "replace")


def _read_line() -> str:
    """One line from stdin, and NOT ONE BYTE MORE.

    `input()` on a piped stdin buffers everything available into the text
    wrapper on first read — so a pasted answer's overflow ends up somewhere no
    descriptor-level drain can see it, pre-answering questions that have not
    been asked. Reading the descriptor byte-wise up to the newline leaves the
    overflow IN the pipe, where the next `_drain_stale_stdin` discards it.

    Raises EOFError on a closed stream with nothing read, exactly as `input()`
    does, so the nobody-there stop below keeps its meaning.
    """
    try:
        fd = sys.stdin.fileno()
    except (OSError, ValueError, io.UnsupportedOperation):
        line = sys.stdin.readline()
        if line == "":
            raise EOFError from None
        return line.rstrip("\n")
    taken = bytearray()
    while True:
        byte = os.read(fd, 1)
        if byte == b"":
            if not taken:
                raise EOFError
            break
        if byte == b"\n":
            break
        taken += byte
    return taken.decode("utf-8", "replace").rstrip("\r")


# Said on every `ask`, in DRIVE's own voice, because it is about the transport
# and not about the question. Field report 2026-08-21 finding 3: the interview
# reads one line and told nobody, so a pasted answer scattered across three
# different questions and then declined the run.
ONE_LINE = (
    "Answer on ONE line and press Enter. Only the first line is recorded — "
    "if your answer has line breaks in it, put it on a single line."
)


def _ask(step, mode: str, repo=None) -> str:
    """Put one step in front of whoever is there, and take their answer.

    In `json` mode the driver — an agent — has already been handed the step and
    replies on stdin. In `text` mode a person types it. **Same step, same
    text**; only the transport differs. Anything on stdin from BEFORE the step
    rendered is stale and is drained unread — leftover text must never answer
    a question, least of all a `confirm`.

    **Three things are added here rather than at each construction site**, so
    no step can be added later that quietly misses them: every `ask` says that
    it takes one line, anything drained is shown rather than dropped in
    silence, and the question is CHECKPOINTED before it renders. The third is
    LangChain's `interrupt()` ordering, and it is here rather than at the call
    sites for the same reason as the other two — a step added later inherits
    it instead of having to remember it.
    """
    if repo is not None:
        run_module.checkpoint(repo, step.id)
    stale = _drain_stale_stdin()
    if step.kind == ASK and not step.answering:
        # A CONFIRM already says "Type yes or no" on its own question line.
        step = replace(step, answering=ONE_LINE)
    _render([step], mode)
    if stale.strip():
        _render(
            [
                run_module.Step(
                    kind=SHOW,
                    id="stale-input-discarded",
                    text="These lines were already waiting when this question "
                    "was asked, so they are not an answer to it and were NOT "
                    "recorded:",
                    engine_words=stale.strip(),
                )
            ],
            mode,
        )
    try:
        return _read_line().strip()
    except EOFError:
        # **A non-interactive stream is not a yes.** Ruling 2: on a stream with
        # nobody behind it the verb STOPS and says why, rather than choosing a
        # default — a default here would be an approval nobody gave.
        raise run_module.Stop(
            run_module.Step(
                kind="stopped",
                id="stopped:nobody-there",
                text="Nothing was built. This needs an answer from a person "
                "and there was nobody on the other end of the line — no "
                "default is taken for an approval.",
            ),
            exit_code=2,
        ) from None


# What counts as each answer, and NOTHING ELSE does. Fail-closed is absolute:
# only these words proceed, and the re-prompt below never widens the set — it
# gives a person another go at hitting it.
YES = ("y", "yes")
NO = ("n", "no")

# How many times a `confirm` will re-ask before giving up. Bounded on purpose:
# an unbounded loop against a stream that keeps producing text would spin
# forever, and this verb must terminate on any input.
CONFIRM_ATTEMPTS = 3


def _confirm(step, mode: str, repo=None) -> bool:
    """A yes/no, with a THIRD outcome that is neither: ask again.

    **A stray line must never be able to spend a person's decision** — field
    report 2026-08-21 finding 3. The first field run lost a whole build to
    exactly this: overflow from a pasted answer reached the approval prompt,
    counted as "not yes", and declined the run. The person was never told
    their decision had been taken, because from the code's point of view one
    had been.

    Fail-closed is untouched and is the reason this is safe: nothing proceeds
    without the literal word, an unreadable answer proceeds with nothing, and
    a stream with nobody behind it still STOPS rather than defaulting. What
    changes is that garbage no longer silently means `no`. Refusing is a
    decision, and a decision needs somebody to have made it.
    """
    for attempt in range(CONFIRM_ATTEMPTS):
        said = _ask(step, mode, repo).strip().lower()
        if said in YES:
            return True
        if said in NO:
            return False
        step = replace(
            step,
            id=f"{step.id}:reask",
            text=f"I did not understand that. I received: {said!r}."
            if said
            else "I did not get an answer.",
            question=step.question,
            answering="Please answer yes or no."
            + (
                ""
                if attempt < CONFIRM_ATTEMPTS - 2
                else " This is the last time I will ask; if I still cannot "
                "read an answer, nothing will be done."
            ),
        )
    raise run_module.Stop(
        run_module.Step(
            kind="stopped",
            id="stopped:unreadable-answer",
            text="Nothing was built and nothing was changed. This needed a "
            "yes or a no and I could not read one, so I have not taken a "
            "decision on your behalf.",
        ),
        exit_code=2,
    )


def _run(session: run_module.Session, args) -> int:
    """`wringer-drive run`: the PRD comes inside, then the whole sequence."""
    mode = args.emit
    repo = session.repo

    # Step 0 — bring the PRD inside, and say so.
    inside = run_module.bring_prd_inside(session, Path(args.prd).resolve())
    _render(session.steps[-1:], mode)

    # Step 0a — say where the last run stopped, if there was one. Rendered
    # before anything else happens, because a person coming back to a killed
    # run needs to know they are not starting again — and because an agent
    # driving this reads one object per line and would otherwise have to infer
    # a resume from which questions failed to appear.
    resumed = run_module.resumed_step(repo)
    if resumed is not None:
        session.emit(resumed)
        _render([resumed], mode)

    # `run` starts every phase, whatever the record says: its approval is
    # asked live on every run (the law in `run.py`'s resume section).
    return _drive(session, mode, inside, start=None)


def _resume(session: run_module.Session, args) -> int:
    """`wringer-drive resume`: the record's phase is the starting point.

    **0.7.1 (P0.2), from run 4B.** Re-running `run` already reused an
    approved spec and spent nothing on a second draft; no verb SAID so, and
    nothing printed what would be reused versus spent. This one reads the
    checkpoint, refuses a plan whose bytes moved since it was approved, says
    the three lines, and joins the one sequence at the phase that stopped.
    """
    mode = args.emit
    repo = session.repo

    facts = run_module.resume_facts(repo)
    if facts is None:
        raise run_module.Stop(run_module.nothing_to_resume_step(), exit_code=2)
    if facts.spec_changed:
        raise run_module.Stop(run_module.spec_changed_step(), exit_code=1)

    preface = session.emit(run_module.resume_preface(facts))
    _render([preface], mode)

    # The document the record's own `run` copied inside. Only the draft phase
    # reads it, and only while no spec exists; a resume that finds neither is
    # a run that never drafted and a document that has since gone.
    inside = repo / run_module.DRIVE_DIRNAME / run_module.PRD_FILENAME
    if not facts.spec_present and not facts.prd_inside:
        raise run_module.Stop(run_module.nothing_to_resume_step(), exit_code=2)
    return _drive(session, mode, inside, start=facts.phase)


def _gates(session: run_module.Session, mode: str) -> None:
    """The gate phase's body (step 7): a diff, INSTALLED only on a yes (§3a).

    The diff is rendered by this process before the question is asked, for
    the same reason the plan is: the interlock is that a person SAW it. A
    helper only so `_drive` reads as the phase list it is; the call site
    keeps its "Step 7" marker for the board-boundary guard.
    """
    repo = session.repo
    proposal = run_module.gate_proposal(repo)
    diff = run_module.gate_diff_step(proposal)
    if diff is not None:
        session.emit(diff)
        _render([diff], mode)
        # Step 7a — a check that already passes today is named HERE, before the
        # yes, because at the handover it is five seconds too late. Running a
        # model-authored command needs its own permission: see `trial_step`.
        if _confirm(run_module.trial_step(proposal), mode, repo):
            tried = run_module.proposed_gates(repo, proposal)
            found = run_module.trial_result_step(
                tried, run_module.already_passing(repo, tried)
            )
            session.emit(found)
            _render([found], mode)
        run_module.install_gates(
            repo,
            proposal,
            answered_yes=_confirm(run_module.gate_approval_step(proposal), mode, repo),
        )
    else:
        # No diff, and the THREE reasons for that are not the same news. Said
        # out loud rather than skipped: a step that vanishes looks like one
        # that failed, and the sentence that used to stand here was false on a
        # real run.
        nothing = run_module.nothing_to_install_step(proposal)
        session.emit(nothing)
        _render([nothing], mode)


def _drive(session: run_module.Session, mode: str, inside: Path, start: str | None) -> int:
    """THE ONE STEP SEQUENCE, with a starting point.

    `run` passes `start=None` and every phase is due. `resume` passes the
    phase the record names, and the phases before it are skipped — each was
    completed by the run that wrote the record (`run_module.PHASES` says why
    that holds), and re-running a completed phase was measured as a safe act
    before this verb existed. Two front doors, one implementation: nothing
    here is duplicated per verb, and the resume record is written HERE at
    each phase's start, so a phase added later inherits the checkpoint.
    """
    from wringer_board import interview

    repo = session.repo

    def due(phase: str) -> bool:
        return run_module.phase_is_due(start, phase)

    # Step 2 — the workspace, only when there is none. The three things DRIVE
    # may not invent are ASKED for: an endpoint is a network address, a model
    # is a bill, and a worker is a command. Ruling 5 forbids guessing any of
    # them, and asking is the one thing this verb is built to do.
    if due("setup"):
        run_module.checkpoint_phase(repo, "setup")
    if due("setup") and run_module.needs_workspace(repo):
        answers = {}
        for question in run_module.SETUP_QUESTIONS:
            said = _ask(question, mode, repo)
            if not said:
                raise run_module.Stop(
                    run_module.Step(
                        kind="stopped",
                        id="stopped:setup-unanswered",
                        text="Nothing was set up, because this needs an "
                        "answer that only you can give.",
                        question=question.text,
                    ),
                    exit_code=2,
                )
            answers[question.detail["key"]] = said
        run_module.generate_workspace(session, repo, answers)
        _render(session.steps[-1:], mode)

    # Step 2a — THE PREFLIGHT, and its position on this page is the fix.
    # Everything below this line can cost money or take an approval; the
    # coding agent is the one precondition that used to be checked after all
    # of it. A run that cannot possibly finish should not be able to start.
    #
    # The renderer is handed IN so the answer is SHOWN when it passes too
    # (Fable's ruling on Q1, 2026-08-26). The refusal was always visible; the
    # pass was not, and a precondition a person is told to check has to be
    # answered where they are standing.
    run_module.require_worker(
        repo, session, announce=lambda step: _render([step], mode)
    )

    # Step 3 — draft the spec from the prose, saying what it costs first.
    #
    # The renderer is handed IN rather than used on the way back, and that is
    # the whole of finding 2 of the full run, 2026-08-26: rendering after the
    # call showed the warning after the spend, and showed nothing at all when
    # the call failed — which is what happened. Either step it can emit is
    # rendered at the moment it is emitted: `drafting` when it is about to
    # spend, and `spec-reused` when it is not.
    if due("draft"):
        run_module.checkpoint_phase(repo, "draft")
        run_module.draft_the_spec(
            session, repo, inside, announce=lambda step: _render([step], mode)
        )

    # Step 4 — the interview. One question at a time, in the drafter's words.
    if due("interview"):
        run_module.checkpoint_phase(repo, "interview")
    for step in run_module.questions_to_ask(repo) if due("interview") else ():
        answer = _ask(step, mode, repo)
        if not answer:
            raise run_module.Stop(
                run_module.Step(
                    kind="stopped",
                    id="stopped:unanswered",
                    text="Nothing was built, because a question that only you "
                    "can answer is still unanswered.",
                    question=step.text,
                ),
                exit_code=1,
            )
        run_module.record_answer(repo, step.detail["question_id"], answer)

    # Step 4a — READ THE ANSWERS BACK, before anything is built from them.
    #
    # **Nothing echoed anything back at any point** was the field report's own
    # summary of the interview, and it is why a scattered answer survived all
    # the way into a plan. This is the cheapest place to catch it: the answers
    # are on disk, the plan has not been drafted from them yet, and a person
    # reading their own words next to the question they belong to will see a
    # mismatch instantly.
    #
    # It is NOT an approval and must never be treated as one — ruling 2:
    # answering and approving are different acts and one keystroke may never
    # do both. This asks whether the RECORD is right; step 6 asks whether the
    # PLAN is right, against a plan this has not produced yet.
    if due("read-back"):
        run_module.checkpoint_phase(repo, "read-back")
    recorded = run_module.answers_recorded_step(repo) if due("read-back") else None
    if recorded is not None:
        session.emit(recorded)
        _render([recorded], mode)
        # **The one question a resume does not re-ask, and the reason it is
        # the only one.** Ruling 2 says in this file's own words that this
        # confirm is NOT an approval — it asks whether the RECORD is right and
        # authorises nothing. The approval below is asked live on every run
        # whatever the resume record says, because a recorded yes answering a
        # later run's approval would be the file-driven authorisation ruling
        # 2a forbids. The skip is invalidated by the answers themselves: the
        # digest is over what the read-back rendered, so changing any answer
        # brings the question straight back.
        if run_module.answers_already_confirmed(repo):
            unchanged = run_module.answers_unchanged_step()
            session.emit(unchanged)
            _render([unchanged], mode)
        elif not _confirm(run_module.answers_confirm_step(), mode, repo):
            raise run_module.Stop(
                run_module.Step(
                    kind="stopped",
                    id="stopped:answers-wrong",
                    text="Nothing was built, and nothing in the project "
                    "changed. Your answers are recorded and you can change "
                    "any of them, then run this again.",
                    engine_words="wringer-board revise --id <the question> "
                    "--text \"<what you meant>\"",
                ),
                exit_code=0,
            )
        else:
            run_module.record_answers_confirmed(repo)

    # Step 5 — the plan, verbatim. Step 6 — the approval, asked by this
    # process, after this process rendered the plan.
    #
    # **Skipped by `resume` only once the phase after it began** — which
    # means `approve()` wrote the spec's own `approved: true` in the run that
    # left the record, and `_resume` has already compared the spec's bytes
    # to the ones that approval was given against. Nothing in the resume
    # record answers this question; a run killed AT it is asked it again.
    if due("approve"):
        run_module.checkpoint_phase(repo, "approve")
        plan = run_module.plan_step(repo)
        session.emit(plan)
        _render([plan], mode)

        run_module.approve(
            repo, answered_yes=_confirm(run_module.approval_step(), mode, repo)
        )

        remaining = interview.unanswered(repo)
        if remaining:
            raise run_module.Stop(
                run_module.Step(
                    kind="stopped",
                    id="stopped:still-unanswered",
                    text="Nothing was built: "
                    + ", ".join(q.id for q in remaining)
                    + " is still unanswered.",
                )
            )

        approved = run_module.Step(
            kind="show",
            id="approved",
            text="Approved. The plan is recorded and the build can start.",
        )
        session.emit(approved)
        _render([approved], mode)
        # The bytes this approval was given against, recorded with the
        # phase that follows it. `resume` refuses to reuse the approval if
        # they move (P0.2's staleness law).
        run_module.record_approved_spec(repo)

    # **The board is re-rendered at each phase boundary, not only at the end.**
    # A run takes minutes and the page is the person's only window into it; a
    # board written once, last, is a page not worth opening while the thing it
    # describes is happening. Rendering is idempotent and reads bytes already
    # on disk, so an extra pass costs a file write and no engine work.
    run_module.render_board(repo)

    # Step 7 — the proposed gates, as a diff, INSTALLED only on a yes (§3a).
    # The diff is rendered by this process before the question is asked, for
    # the same reason the plan is: the interlock is that a person SAW it.
    if due("gates"):
        run_module.checkpoint_phase(repo, "gates")
        _gates(session, mode)

    # Step 7b — what shows a requirement only a person can judge (0.6.7,
    # runs 4 and 4B): asked here, once, before anything is built, so the pen
    # has something to run instead of only `--without-display` to offer.
    shows: dict[str, str] = {}
    if due("show"):
        run_module.checkpoint_phase(repo, "show")
        for step in run_module.show_questions(repo):
            session.emit(step)
            shows[str(step.detail["criterion_id"])] = _ask(step, mode, repo)
        for step in run_module.record_shows(repo, shows):
            session.emit(step)
            _render([step], mode)

    # The second phase boundary: the gates are settled, so the board can now
    # say which requirements have a check bound to them.
    run_module.render_board(repo)

    # Step 8 — the loop, with the worker the project declares.
    #
    # **The record advances past the build only when the loop CONVERGED.**
    # A build that stopped — run 4B's refused worker turn — is the phase a
    # resume must redo, and a record that had already moved on to the
    # handover would send the resume to a refusal about evidence the build
    # never produced.
    if due("build"):
        run_module.checkpoint_phase(repo, "build")
        built = run_module.build_steps(repo)
        for step in built:
            session.emit(step)
            _render([step], mode)
        if built[-1].detail.get("status") == "converged":
            run_module.checkpoint_phase(repo, "deliver")

    # Steps 9 and 10 — the board is rendered BEFORE the handover is offered,
    # because ruling 2a's second authorisation is given against it. A refusal
    # still renders the board: the page is how a person finds out why.
    try:
        run_module.delivery_plan(repo)
    except run_module.Stop:
        session.emit(run_module.board_step(run_module.render_board(repo)))
        _render(session.steps[-1:], mode)
        raise

    board = run_module.board_step(run_module.render_board(repo))
    session.emit(board)
    _render([board], mode)

    sent = run_module.deliver(
        repo, answered_yes=_confirm(run_module.delivery_step(), mode, repo)
    )

    # **Cleared only here.** A run that STOPPED keeps its record, because a
    # stop is exactly when somebody comes back — and the next run's first
    # sentence should say where they had got to. A finished run has nothing to
    # resume to.
    run_module.clear_resume(repo)

    final = run_module.final_step(
        repo, run_module.render_board(repo), delivery=sent
    )
    session.emit(final)
    _render([final], mode)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
