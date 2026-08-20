"""`wringer-board render <repo> -o board.html`.

**Not a `wring` subcommand, and never will be.** SPEC_BOARD_V0 §8 non-goal 5:
the core is at its 19-command ceiling and this is a separate layer consuming
the engine through what it already emits. B2.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

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

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command in ("plan", "answer", "revise", "approve"):
        return _interview(args)

    repo = Path(args.repo).resolve()
    out = Path(args.out)

    try:
        board = read_module.read(
            repo,
            health_report=Path(args.health_report) if args.health_report else None,
            audit_report=Path(args.audit_report) if args.audit_report else None,
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
            path = interview.answer(repo, args.id, args.text)
            print(f"wringer-board: answered {args.id!r} in {path.name}")
            still = interview.unanswered(repo)
            if still:
                names = ", ".join(q.id for q in still)
                print(f"wringer-board: still unanswered: {names}")
            return 0
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


if __name__ == "__main__":  # pragma: no cover - the entry point
    raise SystemExit(main())
