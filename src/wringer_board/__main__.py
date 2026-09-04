"""`wringer-board render <repo> -o board.html`.

**Not a `wring` subcommand, and never will be.** SPEC_BOARD_V0 §8 non-goal 5:
the core is at its 19-command ceiling and this is a separate layer consuming
the engine through what it already emits. B2.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from wringer_board import judge as judge_module
from wringer_board import read as read_module
from wringer_board import render as render_module


def build_parser() -> argparse.ArgumentParser:
    """The parser, built separately so a release gate can ASK the
    package what verbs it has instead of keeping a list that drifts.
    The core's release workflow shipped a hardcoded list of thirteen
    commands and stayed at thirteen while four more shipped — a gate
    probing an ever-smaller fraction of the wheel while printing a
    number that was false for two releases.
    """
    parser = argparse.ArgumentParser(
        prog="wringer-board",
        description=(
            "Render a Wringer repository's requirements as one page a product "
            "manager can read without being taught anything first."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)
    rendered = sub.add_parser("render", help="write the board as one HTML file")
    rendered.add_argument("repo", nargs="?", default=".", help="the repository")
    rendered.add_argument(
        "-o", "--out", default="board.html", help="where to write the page"
    )
    # **Two artifacts the engine does not leave under `.wringer/`**, so the
    # only honest way to render them is to be handed the engine's own report.
    # Both optional, and absent means the page says nothing about them —
    # never that they were fine.
    rendered.add_argument(
        "--health-report",
        metavar="PATH",
        help="a health report the engine wrote: 'wring health --json --output "
        "PATH'. Without it the page says nothing about check health",
    )
    rendered.add_argument(
        "--run",
        metavar="DIR",
        help="render THIS verification record instead of the newest one — "
        "the door `wring deliver` uses so the delivered page and the "
        "delivered certificate describe one run. The page says which run it "
        "renders and that a caller selected it",
    )
    rendered.add_argument(
        "--audit-report",
        metavar="PATH",
        help="an audit report the engine wrote: 'wring audit --json ATTESTATION"
        " > PATH'. Without it the page says nothing about signature, "
        "identity or integrity",
    )

    # --- S3, the interview surface (SPEC_BOARD_V0 §5 ruling 20) ------------
    #
    # Three verbs, each writing exactly what a hand edit writes, into
    # `wringer.spec.yaml` and nothing else. **`approve` renders the plan before
    # it writes** — there is no flag that skips it, because the whole point of
    # the approval step is that a person read what is about to be built.
    planned = sub.add_parser(
        "plan",
        help="the plain-language plan: what will be built, and how "
        "each piece will be proved",
    )
    planned.add_argument("repo", nargs="?", default=".")

    answered = sub.add_parser(
        "answer", help="answer one of the spec's open questions, in the file"
    )
    answered.add_argument("repo", nargs="?", default=".")
    answered.add_argument("--id", required=True, help="the question's id")
    answered.add_argument("--text", required=True, help="the answer")

    revised = sub.add_parser(
        "revise",
        help="change an answer, or overrule a decision taken for you. Every "
        "revision withdraws your approval, so you see the plan again",
    )
    revised.add_argument("repo", nargs="?", default=".")
    revised.add_argument(
        "--id", required=True, help="the question's id, or an assumption's"
    )
    revised.add_argument("--text", required=True, help="what you want instead")

    approved = sub.add_parser(
        "approve",
        help="write `approved: true` after printing the plan. Approving and "
        "answering are never the same action",
    )
    approved.add_argument("repo", nargs="?", default=".")

    # **The person's pen, for the requirements only a person can judge.**
    # Until 2026-08-21 the only way to answer one was to create
    # `wringer.judgements.yaml` by hand, guess its schema, and compute a
    # sha256 — friction that never stopped an agent and stopped only the
    # human whose judgement the file records. Same discipline as `approve`:
    # the requirement is PRINTED before anything is written, one criterion per
    # invocation, and the verdict is typed out rather than switched on.
    judged = sub.add_parser(
        "judge",
        help="answer one requirement only a person can judge, after printing "
        "it. One at a time, and the verdict is typed out",
    )
    judged.add_argument("repo", nargs="?", default=".")
    judged.add_argument(
        "--id",
        help="the criterion's id. Omit to list the ones still waiting",
    )
    judged.add_argument(
        "--verdict",
        choices=judge_module.VERDICTS,
        help="`met` or `not_met`, typed out. There is deliberately no --met "
        "flag: a switch is something you can hit by accident",
    )
    judged.add_argument(
        "--note", default="", help="why, in your own words. Recorded verbatim"
    )
    judged.add_argument(
        "--by",
        default="",
        help="a name for the record. Defaults to your git user.name. "
        "Recorded, never verified — this is not an identity system",
    )
    judged.add_argument(
        "--without-display",
        action="store_true",
        help="record the verdict even though nothing could be displayed — "
        "your explicit statement that you judged this on your own sight of "
        "it. The record carries that fact, and the show failure verbatim, "
        "beside your verdict. Never the default: a missing or failing "
        "`show:` otherwise refuses to record",
    )

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command in ("plan", "answer", "revise", "approve", "judge"):
        return _interview(args)

    repo = Path(args.repo).resolve()
    out = Path(args.out)

    try:
        selected = Path(args.run) if getattr(args, "run", None) else None
        if selected is not None and not selected.is_dir():
            print(
                f"wringer-board: no run record at {selected} — nothing to "
                "render from",
                file=sys.stderr,
            )
            return 2
        board = read_module.read(
            repo,
            health_report=Path(args.health_report) if args.health_report else None,
            audit_report=Path(args.audit_report) if args.audit_report else None,
            run_dir=selected,
        )
    except read_module.UnknownVersion as exc:
        # **Ruling 6, and the exit code says it too.** A version this board does
        # not know renders a banner and ZERO CARDS — never a partial page — and
        # exits non-zero so a script cannot mistake it for a render.
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(render_module.render_unknown_version(exc), encoding="utf-8")
        print(f"wringer-board: {exc}", file=sys.stderr)
        print(f"wringer-board: wrote a refusal to {out}", file=sys.stderr)
        return 2

    render_module.write(board, out)
    print(f"wringer-board: {out}")
    return 0


def _interview(args) -> int:
    from wringer_board import interview

    repo = Path(args.repo).resolve()
    try:
        if args.command == "plan":
            print(interview.plan(repo), end="")
            return 0
        if args.command == "revise":
            path = interview.revise(repo, args.id, args.text)
            print(
                f"{path.name}: updated, and your approval was withdrawn — "
                "read the plan again before approving it.",
            )
            return 0
        if args.command == "answer":
            # Resolved here too, only so the print can say what was recorded
            # when a number was typed: `answer` resolves on its own, and a
            # resolved text resolves to itself.
            recorded = interview.resolve_answer(repo, args.id, args.text)
            path = interview.answer(repo, args.id, recorded)
            print(f"wringer-board: answered {args.id!r} in {path.name}")
            if recorded != args.text:
                print(f"wringer-board: recorded, in the choice's own words: {recorded}")
            still = interview.unanswered(repo)
            if still:
                names = ", ".join(q.id for q in still)
                print(f"wringer-board: still unanswered: {names}")
            return 0
        if args.command == "judge":
            return _judge(args, repo)
        # approve. **The plan is PRINTED, and that is what earns the write.**
        print(interview.plan(repo), end="")
        print("-" * 60)
        path = interview.approve(repo, read_the_plan=True)
        print(f"wringer-board: wrote `approved: true` into {path.name}")
        print(
            "wringer-board: nothing else changed. Answering a question and "
            "approving a spec are never the same action."
        )
        return 0
    except interview.InterviewError as exc:
        print(f"wringer-board: {exc}", file=sys.stderr)
        return exc.exit_code


def _judge(args, repo: Path) -> int:
    """One requirement, printed, then answered. Never the other order.

    With no `--id` this LISTS what is waiting and writes nothing — a person
    who does not know the ids should not have to read a YAML file to find
    them, which is the whole complaint this verb answers.
    """
    if not args.id:
        waiting = judge_module.unanswered(repo)
        if not waiting:
            print(
                "wringer-board: nothing is waiting on your judgement in this "
                "repository."
            )
            return 0
        print("These requirements are waiting for a person to judge them:\n")
        for criterion in waiting:
            print(judge_module.wording(criterion))
            # **A requirement you already rejected is not a blank question.**
            # Field report 2026-08-28: a `not_met` used to remove a criterion
            # from this list entirely, which meant a fix could never be
            # re-judged through the listing. It is back on the list now, and
            # a reader meeting it needs to know it is THEIR objection they are
            # being asked about, in the words they wrote it in.
            standing = judge_module.standing_objection(repo, criterion.get("id", ""))
            if standing is not None:
                print(
                    f"\n    You said this was NOT met on {standing.get('at', '')}."
                    "\n    Your words: "
                    f"{str(standing.get('note') or '(no note recorded)').strip()}"
                    "\n    Has that been answered?"
                )
            print()
        print(
            "Answer one with:\n"
            "  wringer-board judge --id <the id> --verdict met|not_met "
            '--note "why"'
        )
        return 0

    criterion = judge_module.find(repo, args.id)
    # **PRINTED FIRST, and there is no flag that skips this.** `approve`'s
    # rule, for `approve`'s reason: the whole value of a human judgement is
    # that a person read the thing they are answering.
    print("You are answering this requirement:\n")
    print(judge_module.wording(criterion))
    print()

    # **AND THE THING ITSELF.** Field report 2026-08-28: this command printed
    # the requirement and stopped, so a person was asked to judge the wording
    # of a summary that appeared nowhere in any surface Wringer has. They
    # could answer only because an agent pasted it into a chat window.
    #
    # When the repository declares nothing to show, that is said out loud
    # rather than passed over. Asking somebody to judge what you will not show
    # them is the defect; asking them while pretending nothing is missing is
    # the same defect with the evidence removed.
    display = judge_module.shown(repo, str(criterion.get("id", "")))
    if display.state == judge_module.MISSING:
        print(
            "NOTHING IS BEING SHOWN TO YOU FOR THIS ONE.\n"
            "  This repository declares no way to render what this requirement "
            "is about,\n"
            "  so you are being asked to judge something you cannot see. An "
            "engineer can fix\n"
            "  that by adding a command under `show:` in .wringer.yaml, keyed "
            f"by `{criterion.get('id', '')}`.\n"
            "  Recording a verdict is REFUSED until one exists — or pass\n"
            "  --without-display to record that you judged it on your own "
            "sight of it.\n"
        )
    elif display.state == judge_module.FAILED:
        # **Said as the failure it is** — run 3's F12 rendered a failed
        # command's output under the ordinary header, and a `met` was
        # recorded against it.
        exit_note = (
            f"exit {display.exit_code}"
            if display.exit_code is not None
            else "it could not be run"
        )
        print(
            f"THE COMMAND FOR THIS REQUIREMENT FAILED ({exit_note}) — "
            f"`{display.command}`.\n"
            "  What it printed is below, but it does NOT vouch for what you "
            "are judging,\n"
            "  and recording a verdict is REFUSED until the command "
            "succeeds — or you pass\n"
            "  --without-display to record that you judged this on your own "
            "sight of it.\n"
        )
        for line in display.text.splitlines():
            print(f"  | {line}")
        print()
    else:
        # **BEFORE, then AFTER** (P1.10, 0.8.9). Marc: the board should show
        # the old summary beside the new one, "far more useful to a PM than
        # file counts". The same declared command, run at the commit this
        # work started from, so the person is comparing rather than
        # remembering. A base that cannot be read is stated as absence and
        # the AFTER still stands on its own.
        base = judge_module.base_ref(repo)
        before = (
            judge_module.shown_before(repo, str(criterion.get("id", "")), base)
            if base
            else None
        )
        if before is not None and before.state == judge_module.SHOWN:
            print(f"BEFORE — the same command at `{base[:12]}`:\n")
            for line in before.text.splitlines():
                print(f"  | {line}")
            print()
            print(f"AFTER — from `{display.command}`:\n")
        elif before is not None:
            print(f"BEFORE — {before.text}\n")
            print(f"AFTER — from `{display.command}`:\n")
        else:
            print(f"This is what you are judging — from `{display.command}`:\n")
        for line in display.text.splitlines():
            print(f"  | {line}")
        print()

    if not args.verdict:
        print(
            "Nothing was written. Say what you found, in your own words:\n"
            f'  wringer-board judge --id {args.id} --verdict met --note "…"\n'
            f'  wringer-board judge --id {args.id} --verdict not_met '
            '--note "…"',
            file=sys.stderr,
        )
        return 2

    path = judge_module.record(
        repo,
        args.id,
        args.verdict,
        by=args.by,
        note=args.note,
        read_the_criterion=True,
        display=display,
        without_display=bool(getattr(args, "without_display", False)),
    )
    print("-" * 60)
    print(f"wringer-board: recorded {args.verdict!r} for {args.id!r} in {path.name}")
    print(
        "wringer-board: this is your answer, recorded against the wording "
        "above. If that wording later changes, the answer goes stale and you "
        "will be asked again."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - the entry point
    raise SystemExit(main())
