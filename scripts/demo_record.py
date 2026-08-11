"""Record a real terminal session as a cast of (elapsed, line) pairs.

There is no asciinema on the maintainer's Mac, and the alternative — writing
an SVG that *depicts* what Wringer would print — is exactly the thing this
repository exists to refuse. So this runs the real commands, through a real
pty, and records what actually came back and when.

The cast is committed beside the SVG it renders, so anyone can check the
picture against the transcript, and `scripts/demo.sh` regenerates both.
"""

from __future__ import annotations

import json
import os
import pty
import select
import subprocess
import sys
import time
from pathlib import Path

# The grid the cast's timeline snaps to, in seconds.
#
# Pacing is presentation; captured OUTPUT is evidence. Quantizing `at` never
# touches a single character of `text`, so law 8 is untouched — what the
# commands printed is exactly what they printed. What it removes is the
# churn: every regeneration used to rewrite 19 of 20 float timings and every
# derived SVG keyframe, so a diff could not be read for whether the DEMO had
# changed. A tenth of a second is below the threshold anyone perceives in a
# terminal recording and above the jitter of a loaded machine.
#
# It does not make regeneration byte-identical, and is not meant to: the run
# id and the `0.1s` gate durations live inside captured text and stay real.
# Regeneration is a deliberate act, done when the flow changes.
TIMING_QUANTUM = 0.1

# The longest gap between two frames that survives into a cast, in seconds.
#
# Needed the moment a REAL agent went into a recording. A repair turn took
# 4m37s (docs/first-contact.md), and the renderer paces the whole animation
# against its last timestamp — so one honest turn would have produced a
# five-minute SVG that is four and a half minutes of nothing. Nobody watches
# that, and a demo nobody watches demonstrates nothing.
#
# **Pacing is presentation; text is captured.** That is this project's
# standing rule and the reason `TIMING_QUANTUM` is allowed to exist at all.
# Compression obeys the same boundary: not one byte of what the terminal said
# is altered, and the real duration is not lost — it is INSIDE the captured
# text, because the console prints `→ worker  4m 37s` itself. The recording
# shows the wait as a beat and the transcript states its true length, which
# is the honest way round. Reversing it — a real five-minute pause with the
# duration edited out — is the one this must never become.
#
# Measured against the eight casts already committed: seven have no gap over
# 2.5s at all, so this changes nothing about them. `health.cast.json` has one
# 8.4s pause and will re-pace to 2.5s the next time it is regenerated — which
# is a deliberate act, done when the flow changes, and within the same rule.
MAX_GAP_SECONDS = 2.5


# The agent `wring start` is told to use in the recording. A real id from
# Wringer's own table — `tests/test_docs.py` asserts that — but the binary
# behind it during the recording is a STUB that `scripts/demo.sh` puts on
# PATH. That is the only route that films the agent step without installing a
# vendor binary or handling a credential, and the documentation says so in
# words beside the picture. The launch never runs it: the gates pass on the
# first try, so there is nothing for a repair loop to do.
START_AGENT_ID = "claude-code"


def _argv_step(wring: str, *args: str) -> tuple[str, list[str]]:
    """A step whose displayed command IS its argv.

    Displayed and executed differ in exactly one thing — argv[0] is the
    absolute path to the `wring` being recorded — and `tests/test_docs.py`
    checks that is the only difference. `_listing_step` earned that guard the
    hard way: the cast showed one command and ran another for two days.
    """
    return " ".join(("wring", *args)), [wring, *args]


def _run_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    return _argv_step(wring, "run")


def _start_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """The guided launch, non-interactively.

    **The recorded run is the non-interactive surface, and that is measured
    rather than chosen** (SPEC_START_V0.md §3b-i). This recorder cannot film
    an interactive session: `getpass` reads `/dev/tty` rather than stdin and
    would block on the operator's real terminal; child stdin is DEVNULL; and
    capture is line-oriented, so a prompt printed without a trailing newline
    is glued onto whatever line comes next — a plausible-looking line no
    command ever printed, which is worse for law 8 than an absence.

    It is also the documented happy path: the north-star flow has an agent
    running setup and launching `wring start` at the end, and an agent passes
    flags.

    The key step is deliberately off-camera. The recorded run has the variable
    already set, `wring start` says so on the terminal, and the docs say in
    words that the one step a film cannot honestly show is the one where a
    human types a secret.
    """
    return _argv_step(wring, "start", "--accept-gates", "--agent", START_AGENT_ID)


def _prove_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """The catch.

    `wring run` has just converged: gates green, worker done, a confident
    ending. This re-runs those same gates against the PRE-CHANGE tree in a
    scratch worktree. A gate that passes on both proved nothing about the
    change — and that is the verdict this recording exists to show.
    """
    return _argv_step(wring, "verify", "--prove")


def _deliver_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """The consequence. A `gates_vacuous` bundle is refused, exit 1.

    Recorded last because a refusal is only meaningful once the reader has
    watched the thing it is refusing look fine.
    """
    return _argv_step(wring, "deliver")


def _bench_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """Two workers, one job, one comparison — and no winner.

    The two contenders are shell scripts, not agents: the recording needs no
    vendor binary and no credential, and it is reproducible by anyone. What
    they DO is the point. One fixes the function; the other rewrites the
    failing assertion into a tautology. Both converge, and every measured
    column says they did equally well — which is exactly why there is no
    winner column, and why the limits print underneath the numbers rather
    than in a spec nobody opened.
    """
    return _argv_step(wring, "bench")


def _verify_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """The genuine failure, on camera. This is the beat the whole recording
    rests on: the gate demonstrably CAN fail, witnessed once, with a receipt."""
    return _argv_step(wring, "verify")


def _health_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    return _argv_step(wring, "health")


# Twenty-five, because the window is twenty-five. After this many green runs
# the failure recorded at the top of the recording is no longer inside it, and
# the history floor of ten is comfortably cleared — so the verdict flips from
# `alive` to `zombie` on the evidence rather than on a countdown. Displayed and
# executed as ONE string, the `_listing_step` shape: the loop really runs, the
# runs are real, and nothing about time is faked.
BULK = "for i in $(seq 25); do wring verify >/dev/null; done; echo 25 green runs"


def _bulk_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    return BULK, ["sh", "-c", BULK]


def _bench_worktree(scratch: Path, contender: str) -> str:
    """The kept worktree for one contender, named literally.

    A glob would have been shorter and wrong: the displayed command is the
    command a reader types, and `*-hasty` resolves only while exactly one
    bench exists in that tree. `_listing_step` learned this the hard way —
    the cast showed one command and ran another for two days — so the id the
    bench just allocated is read back and written out in full.
    """
    worktrees = scratch / ".wringer" / "worktrees"
    names = sorted(
        p.name for p in worktrees.iterdir()
        if p.is_dir() and p.name.endswith(f"-{contender}")
    ) if worktrees.is_dir() else []
    if not names:
        raise SystemExit(
            f"demo_record: no kept worktree for {contender!r} — the bench "
            "either never ran it or removed its evidence"
        )
    return f".wringer/worktrees/{names[-1]}"


def _diff_step(contender: str):
    """The reader ranks, with the diffs in front of them.

    The table refuses to choose, so the recording shows the reader doing what
    the printed limits tell them to do. `--stat` is the whole story in one
    line each: one contender changed `calc.py`, the other changed
    `test_calc.py`. Every measured column said they did equally well.

    The pager is handled in the ENVIRONMENT (`GIT_PAGER=cat` in `main`), not
    with a `--no-pager` flag in the command. `record()` runs every step under
    a PTY so the console looks like a console — which means git sees a
    terminal and starts `less`, and with stdin at DEVNULL that hangs forever.
    Putting `--no-pager` on screen would have fixed it too, at the cost of
    eight columns and of showing the reader a flag they do not need: at a
    real terminal a pager is what you want. The env var sits beside `COLUMNS`
    and `PATH`, which are already presentation rather than argv.
    """

    def step(wring: str, scratch: Path) -> tuple[str, list[str]]:
        tree = _bench_worktree(scratch, contender)
        shown = f"git -C {tree} diff --stat HEAD"
        return shown, shown.split()

    return step


def _newest(directory: Path, missing: str) -> str:
    """The most recently written subdirectory — by mtime, not by name.

    Sorting the NAMES looks right and is not. A run id is
    `<date>-<time>-<four random hex>`, so several bundles written inside the
    same second sort by their random suffix and the last one alphabetically
    is not the last one chronologically.

    The gategen recording caught it on the first take: `wring run` converged
    in four iterations, all inside one second, and the acceptance step was
    pointed at iteration three — whose artifact reads `gate-failed`, because
    at that moment one gate genuinely had. The picture would have shown the
    chain failing at the exact step it had just completed, with a real file
    behind it. That is the worst kind of wrong: captured, honest, and about
    the wrong run.
    """
    names = (
        sorted(directory.iterdir(), key=lambda p: (p.stat().st_mtime, p.name))
        if directory.is_dir()
        else []
    )
    names = [p.name for p in names if p.is_dir()]
    if not names:
        raise SystemExit(f"demo_record: {missing}")
    return names[-1]


def _listing_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """The receipts listing — displayed and executed as ONE string.

    They used to differ. The cast displayed `ls .wringer/runs/<id>/` while
    what actually ran was
    `ls -1 .wringer/runs/$(ls -1 .wringer/runs | tail -1)`. A viewer who typed
    what they saw got columnated output, not the one-per-line listing the
    recording shows — a transcript of a command nobody ran, which is the
    law-8 failure this project keeps finding in itself. A review flagged it on
    2026-08-03 and it was still there two days later, because nothing tested
    it. `tests/test_docs.py` does now.

    Called AFTER `wring run`, so the run id it names is the one that run just
    created — which is what makes the displayed command literal and runnable
    rather than a placeholder.
    """
    newest = _newest(
        scratch / ".wringer" / "runs",
        "no run directory to list — `wring run` wrote none, so there are no "
        "receipts to show",
    )
    listing = f"ls -1 .wringer/runs/{newest}/"
    return listing, ["sh", "-c", listing]


def _plan_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """The drafter proposes. `wring plan` renders the sidecar's gates through
    the human diff — WITH the `proves:` line that binds each one to the
    criterion it evidences — and stops. Nothing is installed here."""
    return _argv_step(wring, "plan")


# The install, filmed rather than done off-camera — `_approve_step`'s shape,
# and for `_approve_step`'s reason: this is the step a flag deliberately
# cannot do, so the only honest way to show it is to show something outside
# Wringer doing it. Displayed and executed as ONE string; no pty driving.
#
# What it proves and what it does not: Wringer printed a diff and stopped, and
# a separate act applied it. It does NOT prove a person read the diff, and a
# recording cannot — `docs/gategen.md` says so in words beside the picture.
# `gate_diff` writes `a/`/`b/` prefixes precisely so the diff it prints is one
# `git apply` accepts, which is what makes this a single typeable line.
INSTALL = "wring plan --json | python3 patch.py | git apply && cat .wringer.yaml"


def _install_gates_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    return INSTALL, ["sh", "-c", INSTALL]


def _acceptance_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """The artifact, read out of the bundle the green run just wrote.

    `head`, and the number is not arbitrary: 24 lines is the counts block plus
    the first criterion entire, which is the one place `evidenced` appears
    beside the RED bundle it cites. A `grep` for the states would fit too and
    would show the verdict without the receipt — and the receipt is the whole
    claim, since a green tick with nothing behind it is what this program
    exists to refuse.

    Called AFTER `wring run`, so the run it names is that loop's final,
    passing one — see `_newest` for why that is an mtime question and not an
    alphabetical one, and for the wrong picture the first take produced.
    """
    newest = _newest(
        scratch / ".wringer" / "runs",
        "no run directory to read acceptance from — the loop wrote no bundle, "
        "so there is no artifact to show",
    )
    shown = f"head -24 .wringer/runs/{newest}/acceptance.json"
    return shown, ["sh", "-c", shown]


def _spec_send_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """The drafter, against a REAL model — the only step in any recording here
    that opens a socket to one.

    Everything else in `scripts/demo.sh` runs offline against stubs and shell
    one-liners, deliberately. This one cannot: the whole point of the
    recording it belongs to is that a real model stands at both ends of the
    goal sentence. `demo.sh` refuses to film it without an endpoint and an
    agent, rather than quietly substituting a fixture.
    """
    return _argv_step(wring, "spec", "PRD.md", "--send")


def _born_green_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """What the harness said about the model's own gate proposals.

    The console reports the run as green — every gate passed. The judgement
    that matters is in `summary.md`, and it is the opposite: those gates prove
    nothing, because a gate written for a feature that does not exist has one
    honest colour and it is not green. This step is the recording's argument.

    `sed -n` over the section heading rather than a `grep` for the warning
    text: the heading is the document's own structure, and quoting the whole
    section shows how many criteria are affected rather than one line that
    might be the only one.
    """
    newest = _newest(
        scratch / ".wringer" / "runs",
        "no run directory to read the born-green warnings from",
    )
    shown = (
        f"sed -n '/never been red/,$p' .wringer/runs/{newest}/summary.md"
    )
    return shown, ["sh", "-c", shown]


# The human's correction, filmed rather than done off-camera — `INSTALL`'s
# shape and `INSTALL`'s reason. The drafter named the repository's existing
# test command for all three criteria; a person replaces each with the
# acceptance check that is actually red until the feature exists.
#
# It is a script in the scenario, like `patch.py`, because a `sed -i` one-liner
# differs between GNU and BSD and the displayed command must be the command
# that ran. What this proves and what it does not: something outside Wringer
# edited the config, and Wringer then ran what the file said. It does NOT
# prove a person read the diff — no recording can, and the page beside it says
# so.
REBIND = "python3 rebind.py && grep -A1 'bind-' .wringer.yaml"


def _rebind_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    return REBIND, ["sh", "-c", REBIND]


# The PM approves and answers, filmed — `_approve_step`'s shape and reason.
# `wring spec` writes `approved: false`; there is no `--yes`, so the only
# honest way to show this is to show something outside Wringer editing the
# file the interlock reads.
DECIDE = "python3 decide.py && grep -m1 approved wringer.spec.yaml"


def _decide_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    return DECIDE, ["sh", "-c", DECIDE]


def _plan_refused_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """`wring plan` BEFORE the human has approved — the interlock refusing.

    Filmed on purpose. Every other recording starts from a spec somebody had
    already approved, so the refusal that makes the approval mean anything has
    never been on camera. It exits non-zero and the recorder captures that the
    same as any other output.
    """
    return _argv_step(wring, "plan")


def _deliver_send_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """The end of the chain, for real: branch, commit, push.

    `--send` rather than the dry run, and the difference matters for what this
    recording claims. A dry run also runs the acceptance refusal, so exit 0
    there would genuinely prove acceptance did not block delivery — but its
    own first line reads "nothing was written to git", and this is the one
    document whose entire job is to show the chain COMPLETING. The remote is a
    bare `origin` on local disk: a real push, no network, no credential, and
    no forge declared, so no merge request is opened and the command says so.
    """
    return _argv_step(wring, "deliver", "--send")


def _fleet_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """Many tasks, one tree, each child scoped to the gates its task proves.

    `tasks.jsonl` is the file `wring plan` wrote two steps earlier, so the
    name is literal rather than a placeholder. The children's own consoles go
    to DEVNULL — a supervisor that interleaved four children's output would
    be unreadable — which is why the step after this one reads their loop
    summaries back off disk.
    """
    return _argv_step(wring, "fleet", "tasks.jsonl")


# What each scoped child actually did, read back out of the bundles it wrote.
#
# This is the beat the whole recording rests on, and it cannot come from the
# fleet's console: the fleet prints counts, and counts cannot show that
# `csv`'s laps only ever failed on `g-hdr` and `g-rows` while `fmt`'s only
# ever failed on `g-cents`. That is scoping demonstrated by BEHAVIOUR rather
# than by a declaration, and it is also the multi-gate task arming its two
# gates one red lap at a time.
#
# A glob, for `_approve_step`'s reason: the scratch tree holds exactly these
# loops, so it expands to exactly these files, and it is a line a reader can
# type verbatim. Written out, the two run ids would push the line past the
# renderer's fixed 80-column canvas.
CHILD_LAPS = "cat .wringer/loops/*/summary.md"


def _child_laps_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    return CHILD_LAPS, ["sh", "-c", CHILD_LAPS]


def _graph_run_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """The graph, up to the interlock. Exits 5 — parked, a person must act."""
    return _argv_step(wring, "graph", "run", "graph.yaml")


def _newest_graph(scratch: Path) -> str:
    return _newest(
        scratch / ".wringer" / "graphs",
        "no graph run to resume — `wring graph run` wrote none, so there is "
        "nothing parked",
    )


def _approve_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """The hand edit, filmed rather than done off-camera.

    This is the step the whole recording exists for: **a person changes a file
    and nothing else can**. The interlock has no flag, so the only honest way
    to film it is to film someone writing the file — and that is a shell
    command, displayed and executed as one string, exactly as `_listing_step`
    is. No pty driving and no keystroke injection: the recorder gains no
    capability it did not have.

    The path is a glob, and that is deliberate rather than a placeholder. The
    scratch tree holds exactly one graph run, so it expands to exactly one
    file, and it is a command a reader can type verbatim. Written out, the run
    id makes the line 85 columns — past the renderer's fixed 80-column canvas,
    which `tests/test_docs.py` enforces. The literal path is on screen anyway:
    `wring graph run` printed it one step earlier, which is where a reader
    following along gets it.

    `tee` rather than `>` because POSIX `sh` does **not** pathname-expand a
    redirection target: `> .wringer/graphs/*/…` tries to create a file with a
    literal `*` in its path and fails. The first recording caught it — the
    cast held `No such file or directory`, and the resume that followed was
    still parked. A command word IS expanded, so `tee` takes the glob, and it
    echoes the line it wrote, which shows the reader the whole content of the
    decision the graph was waiting on.
    """
    edit = "echo 'approved: true' | tee .wringer/graphs/*/nodes/ok/decision.yaml"
    return edit, ["sh", "-c", edit]


def _graph_resume_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """Approved, so the loop runs, the router reads what it found, and the
    graph reaches `done`. The run id is the real one the first step created."""
    return _argv_step(
        wring, "graph", "resume", f".wringer/graphs/{_newest_graph(scratch)}"
    )


def _graph_status_step(wring: str, scratch: Path) -> tuple[str, list[str]]:
    """One screen, read back out of the ledger after the fact."""
    return _argv_step(
        wring, "graph", "status", f".wringer/graphs/{_newest_graph(scratch)}"
    )


def compress_gaps(cast: list[dict], cap: float = MAX_GAP_SECONDS) -> list[dict]:
    """Shorten any silence longer than `cap`, and change no text.

    Applied BEFORE `quantize`, so the grid is the last word on timings.

    The shift is cumulative: once a gap is shortened every later frame moves
    up by the same amount, which is what keeps the sequence monotonic and the
    remaining gaps exactly as recorded. Only the waiting is compressed —
    never the pace at which a command's own output arrives, because that
    pace is part of what the recording shows.
    """
    if not cast:
        return cast

    out = [dict(cast[0])]
    shift = 0.0
    for previous, frame in zip(cast[:-1], cast[1:], strict=True):
        gap = frame["at"] - previous["at"]
        if gap > cap:
            shift += gap - cap
        out.append({**frame, "at": round(frame["at"] - shift, 3)})
    return out


def quantize(cast: list[dict], quantum: float = TIMING_QUANTUM) -> list[dict]:
    """Snap every `at` to the grid, leaving `text` untouched.

    Monotonic by construction: rounding is order-preserving, so a frame never
    lands before the one it followed.
    """
    return [
        {**frame, "at": round(round(frame["at"] / quantum) * quantum, 3)}
        for frame in cast
    ]


def record(command: list[str], cwd: Path, env: dict[str, str]) -> list[dict]:
    """Run `command` under a pty and timestamp every line it prints."""
    primary, secondary = pty.openpty()
    started = time.monotonic()
    proc = subprocess.Popen(
        command,
        cwd=cwd,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=secondary,
        stderr=secondary,
        close_fds=True,
    )
    os.close(secondary)

    frames: list[dict] = []
    buffer = b""
    while True:
        ready, _, _ = select.select([primary], [], [], 0.1)
        if ready:
            try:
                chunk = os.read(primary, 65536)
            except OSError:
                chunk = b""
            if not chunk:
                break
            buffer += chunk
            while b"\n" in buffer:
                raw, buffer = buffer.split(b"\n", 1)
                frames.append(
                    {
                        "at": round(time.monotonic() - started, 3),
                        "text": raw.decode("utf-8", errors="replace").rstrip("\r"),
                    }
                )
        elif proc.poll() is not None:
            break

    if buffer.strip():
        frames.append(
            {
                "at": round(time.monotonic() - started, 3),
                "text": buffer.decode("utf-8", errors="replace").rstrip("\r"),
            }
        )
    os.close(primary)
    proc.wait(timeout=30)
    return frames


# Which commands each recording films. `main()` iterates one of these, so a
# new recorded command needs an entry — that is the expected shape, and it is
# not new *capability*: no pty driving and no keystroke injection, which is
# what would put synthesised input into a file law 8 forbids editing.
STEP_SETS = {
    "run": (_run_step, _listing_step),
    "start": (_start_step,),
    # The agent lies, Wringer catches it: converge, prove, refuse.
    "vacuous": (_run_step, _prove_step, _deliver_step),
    # Same job, both workers, one table — then both diffs, because the table
    # deliberately does not choose and the reader has to.
    "bench": (_bench_step, _diff_step("careful"), _diff_step("hasty")),
    # A gate demonstrably alive, an agent that "fixes" by neutering it, then
    # enough green runs that the window holds no discrimination — and the
    # gate reads `zombie` while every individual run is a real, passing,
    # auditable bundle. Every dashboard on earth shows green ticks here.
    "health": (
        _verify_step,
        _health_step,
        _run_step,
        _bulk_step,
        _health_step,
    ),
    # Run → park → a person edits a file → resume → done. The interlock is
    # the only thing on screen that a flag cannot move.
    "graph": (
        _graph_run_step,
        _approve_step,
        _graph_resume_step,
        _graph_status_step,
    ),
    # A criterion becomes a gate, and the gate is RED before anyone builds.
    # The only recording here that films the chain building something: plan
    # proposes and stops, something outside Wringer installs, verify records
    # the red, the loop's own iterations turn each gate green one at a time,
    # acceptance reads `evidenced` citing the red bundle, and delivery lands.
    "gategen": (
        _plan_step,
        _install_gates_step,
        _verify_step,
        _run_step,
        _acceptance_step,
        _deliver_send_step,
    ),
    # The same chain, at SCALE: one approved spec, two tasks, a fleet, one
    # delivery. `gategen` drove a single task through `wring run`; this drives
    # many through `wring fleet` with `fleet.scope`, which is the half of F4
    # that had never been run on anything real.
    #
    # One task owns TWO gates on purpose (SPEC_SCOPE_V0 review finding 11,
    # HIGH): `wring verify` still stops at the first required failure, so a
    # capture built from one-gate tasks would go green while demonstrating
    # strictly less than the DONE box claims — a check that narrowed while
    # still passing, which is the defect class this program exists to catch.
    # The whole goal sentence, with a real model at BOTH ends — the drafter
    # and the worker. Ten steps because the arc has ten, and the middle four
    # are the ones no previous recording could show: the harness rejecting a
    # model's own gate proposals, a person correcting them, the gate going
    # honestly red, and a real agent closing every criterion in one turn.
    #
    # This is the only step set that needs a credential and a network, which
    # is why `demo.sh` gates it and why it is filmed once rather than
    # regenerated (docs/first-contact.md).
    "firstcontact": (
        _spec_send_step,
        _plan_refused_step,
        _decide_step,
        _plan_step,
        _install_gates_step,
        _verify_step,
        _born_green_step,
        _rebind_step,
        _verify_step,
        _run_step,
        _acceptance_step,
        _deliver_send_step,
    ),
    "fleetscale": (
        _plan_step,
        _install_gates_step,
        _verify_step,
        _fleet_step,
        _child_laps_step,
        _verify_step,
        _acceptance_step,
        _deliver_send_step,
    ),
}


def main() -> int:
    scratch = Path(sys.argv[1])
    out = Path(sys.argv[2])
    wring = sys.argv[3]
    steps = STEP_SETS[sys.argv[4] if len(sys.argv) > 4 else "run"]

    env = dict(os.environ)
    env["PATH"] = f"{Path(wring).parent}:{env['PATH']}"
    # Deterministic width so the SVG's line lengths are the real ones.
    env["COLUMNS"] = "78"
    # Every step runs under a PTY, so any git step would see a terminal and
    # start its pager — which blocks forever against a DEVNULL stdin. This is
    # presentation, exactly like COLUMNS: argv stays what a reader would type,
    # and displayed-equals-executed still holds.
    env["GIT_PAGER"] = "cat"

    # Deliberately NOT `wring verify` first. Its failure dump is twenty lines
    # of pytest arriving in one burst — true, but a wall rather than a demo,
    # and the README already carries that transcript as a static block. The
    # loop is the thing that paces: fail, hand to the worker, pass, converge.
    # Then the receipts, because "it converged" is a claim and the bundle is
    # the evidence.
    #
    # Built lazily, one step at a time: the second command names the run id
    # the FIRST command creates, so the list cannot be computed up front.
    cast: list[dict] = []
    offset = 0.0
    for step in steps:
        prompt, command = step(wring, scratch)
        if cast:  # a blank line before each new prompt, as a shell leaves
            cast.append({"at": round(offset, 3), "text": ""})
            offset += 0.05
        cast.append({"at": round(offset, 3), "text": f"$ {prompt}", "prompt": True})
        offset += 0.6
        frames = record(command, scratch, env)
        for frame in frames:
            cast.append({"at": round(offset + frame["at"], 3), "text": frame["text"]})
        offset += (frames[-1]["at"] if frames else 0.0) + 1.4

    cast = quantize(compress_gaps(cast))
    out.write_text(json.dumps(cast, indent=1) + "\n", encoding="utf-8")
    print(f"recorded {len(cast)} lines over {cast[-1]['at']:.1f}s -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
