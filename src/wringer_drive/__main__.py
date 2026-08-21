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
from pathlib import Path

try:
    import termios
except ImportError:  # pragma: no cover — non-POSIX; the drain degrades below
    termios = None

from wringer_drive import run as run_module
from wringer_drive.steps import emit_json


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
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    repo = Path(args.repo).resolve()
    session = run_module.Session(repo=repo)

    try:
        return _run(session, args)
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


def _drain_stale_stdin() -> None:
    """Discard whatever is already waiting on stdin, BEFORE a question renders.

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
        return
    try:
        if os.isatty(fd):
            # Typed-ahead lines live in the terminal driver, not the pipe.
            if termios is not None:
                termios.tcflush(fd, termios.TCIFLUSH)
            return
        while True:
            ready, _, _ = select.select([fd], [], [], 0)
            if not ready or os.read(fd, 4096) == b"":
                return
    except OSError:  # pragma: no cover — an unselectable stdin drains nothing
        return


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


def _ask(step, mode: str) -> str:
    """Put one step in front of whoever is there, and take their answer.

    In `json` mode the driver — an agent — has already been handed the step and
    replies on stdin. In `text` mode a person types it. **Same step, same
    text**; only the transport differs. Anything on stdin from BEFORE the step
    rendered is stale and is drained unread — leftover text must never answer
    a question, least of all a `confirm`.
    """
    _drain_stale_stdin()
    _render([step], mode)
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


def _run(session: run_module.Session, args) -> int:
    from wringer_board import interview

    mode = args.emit
    repo = session.repo

    # Step 0 — bring the PRD inside, and say so.
    inside = run_module.bring_prd_inside(session, Path(args.prd).resolve())
    _render(session.steps[-1:], mode)

    # Step 2 — the workspace, only when there is none. The three things DRIVE
    # may not invent are ASKED for: an endpoint is a network address, a model
    # is a bill, and a worker is a command. Ruling 5 forbids guessing any of
    # them, and asking is the one thing this verb is built to do.
    if run_module.needs_workspace(repo):
        answers = {}
        for question in run_module.SETUP_QUESTIONS:
            said = _ask(question, mode)
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
    run_module.require_worker(repo)

    # Step 3 — draft the spec from the prose, saying what it costs first.
    run_module.draft_the_spec(session, repo, inside)
    if session.steps[-1].id == "drafting":
        _render(session.steps[-1:], mode)

    # Step 4 — the interview. One question at a time, in the drafter's words.
    for step in run_module.questions_to_ask(repo):
        answer = _ask(step, mode)
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

    # Step 5 — the plan, verbatim. Step 6 — the approval, asked by this
    # process, after this process rendered the plan.
    plan = run_module.plan_step(repo)
    session.emit(plan)
    _render([plan], mode)

    confirm = run_module.approval_step()
    said = _ask(confirm, mode).lower()
    run_module.approve(repo, answered_yes=said in ("y", "yes"))

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

    # **The board is re-rendered at each phase boundary, not only at the end.**
    # A run takes minutes and the page is the person's only window into it; a
    # board written once, last, is a page not worth opening while the thing it
    # describes is happening. Rendering is idempotent and reads bytes already
    # on disk, so an extra pass costs a file write and no engine work.
    run_module.render_board(repo)

    # Step 7 — the proposed gates, as a diff, INSTALLED only on a yes (§3a).
    # The diff is rendered by this process before the question is asked, for
    # the same reason the plan is: the interlock is that a person SAW it.
    proposal = run_module.gate_proposal(repo)
    diff = run_module.gate_diff_step(proposal)
    if diff is not None:
        session.emit(diff)
        _render([diff], mode)
        # Step 7a — a check that already passes today is named HERE, before the
        # yes, because at the handover it is five seconds too late. Running a
        # model-authored command needs its own permission: see `trial_step`.
        said = _ask(run_module.trial_step(proposal), mode).lower()
        if said in ("y", "yes"):
            tried = run_module.proposed_gates(repo, proposal)
            found = run_module.trial_result_step(
                tried, run_module.already_passing(repo, tried)
            )
            session.emit(found)
            _render([found], mode)
        said = _ask(run_module.gate_approval_step(proposal), mode).lower()
        run_module.install_gates(repo, proposal, answered_yes=said in ("y", "yes"))
    else:
        # No diff, and the THREE reasons for that are not the same news. Said
        # out loud rather than skipped: a step that vanishes looks like one
        # that failed, and the sentence that used to stand here was false on a
        # real run.
        nothing = run_module.nothing_to_install_step(proposal)
        session.emit(nothing)
        _render([nothing], mode)

    # The second phase boundary: the gates are settled, so the board can now
    # say which requirements have a check bound to them.
    run_module.render_board(repo)

    # Step 8 — the loop, with the worker the project declares.
    for step in run_module.build_steps(repo):
        session.emit(step)
        _render([step], mode)

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

    said = _ask(run_module.delivery_step(), mode).lower()
    run_module.deliver(repo, answered_yes=said in ("y", "yes"))

    final = run_module.final_step(repo, run_module.render_board(repo))
    session.emit(final)
    _render([final], mode)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
