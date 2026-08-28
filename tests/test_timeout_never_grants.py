"""**A timeout may never resolve as consent, and never as green.**

Taken from LangChain's deepagents hook protocol, whose one adoptable rule is
stated exactly this way (`~/Claude/WRINGER_DEEPAGENTS_DOSSIER_2026-08-23.md`
§3.4): *exit 2 blocks, JSON stdout carries the decision, and a TIMEOUT NEVER
GRANTS*. Wringer already believed it — `judge.py:356-357` says "a transport
failure is not a verdict", `GateResult.passed` reads `not timed_out`,
`worker_auth.read` returns `UNKNOWN` on a probe that will not finish. What it
did not have is anything that would go red if a future edit defaulted one of
them the other way, which is the shape every one of these decisions has: a
single `or True`, a swallowed `except`, an `exit_code == 0` that forgot the
second clause.

**Two halves, and the second is the one that keeps working.**

1. Each waiting surface is DRIVEN into its timeout and the outcome asserted.
2. The SET of waiting surfaces is DERIVED from the source, so a new ceiling
   added anywhere in `src/` fails this file until somebody says which kind it
   is. A hand-kept list of "the places we wait" is the guard this repository
   has watched go stale twice (`verify.py:477-479`, `evidence.py:436-455`).

A ceiling is one of exactly two kinds, and telling them apart is a judgement
no name carries — which is why the classification is written down and only its
COMPLETENESS is derived.
"""

from __future__ import annotations

import re
import time
from pathlib import Path

import pytest

from wringer import config, gates, judge, worker_auth

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"

#: Expiry here could be mistaken for an answer: somebody or something was
#: asked, and the silence must not be read as a yes or as a pass.
WAITS_ON_AN_ANSWER = {
    "acquire.CLONE_TIMEOUT_SECONDS",
    "acp.REQUEST_TIMEOUT_SECONDS",
    "acp.WRITE_TIMEOUT_SECONDS",
    "attest._GIT_TIMEOUT_SECONDS",
    "certificate._GIT_TIMEOUT_SECONDS",
    "config.DEFAULT_FORGE_TIMEOUT_SECONDS",
    "config.DEFAULT_JUDGE_TIMEOUT_SECONDS",
    "config.DEFAULT_TIMEOUT_SECONDS",
    "config.DEFAULT_WORKER_TIMEOUT_SECONDS",
    "containment.PROBE_TIMEOUT_SECONDS",
    "deliver.GIT_TIMEOUT_SECONDS",
    "git.GIT_TIMEOUT_SECONDS",
    "vacuity.SETUP_TIMEOUT_SECONDS",
    "judge.SHOW_TIMEOUT",
    "witness.TIMEOUT_SECONDS",
    "worker_auth.TIMEOUT",
    "worker_auth.HANDSHAKE_TIMEOUT",
}

#: The answer is already in and this only bounds the tidying-up. Expiry here
#: cannot grant anything, because nothing is being asked — the process has
#: already been killed, or the verdict already written.
REAPS_AFTER_A_DECISION = {
    "acp.DRAIN_TIMEOUT_SECONDS",
    "backend.CLEANUP_TIMEOUT_SECONDS",
    "containment.CLEANUP_TIMEOUT_SECONDS",
    "gates.DRAIN_TIMEOUT_SECONDS",
    "gates.KILL_GRACE_SECONDS",
}

#: Column 0 only, so this reads MODULE-level bindings and nothing inside a
#: class or a function. The name filter is applied afterwards rather than
#: inside the pattern: `TIMEOUT = 90.0` is a ceiling and a pattern that
#: demanded a prefix before the word silently skipped it, which the first run
#: of this guard caught.
CEILING = re.compile(r"^(_?[A-Z][A-Z0-9_]*)\s*[:=]", re.M)
CEILING_WORDS = ("TIMEOUT", "GRACE")


def declared_ceilings() -> set[str]:
    """Every module-level wait ceiling in the shipped source, `mod.NAME`.

    Module level only, and on purpose: a ceiling passed as an argument is
    somebody else's decision arriving, and a ceiling written down at the top
    of a module is this program deciding how long it is prepared to wait. The
    second kind is what this file is about.
    """
    found = set()
    for path in sorted(SRC.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        for name in CEILING.findall(path.read_text(encoding="utf-8")):
            if any(word in name for word in CEILING_WORDS):
                found.add(f"{path.stem}.{name}")
    return found


def test_EVERY_DECLARED_WAIT_IS_CLASSIFIED_AS_ONE_KIND_OR_THE_OTHER():
    """**The derivation, and the only part of this file that survives a
    rewrite of everything below it.**

    A new ceiling is a new place this program stops waiting, and the question
    "could its expiry be read as an answer?" has to be asked once, by a
    person, at the moment it is added. Nothing in a constant's name answers it
    — `containment.PROBE_TIMEOUT_SECONDS` and `containment.CLEANUP_TIMEOUT_
    SECONDS` sit four lines apart and fall on opposite sides. So the guard
    does not try to classify; it refuses to let one arrive unclassified.
    """
    classified = WAITS_ON_AN_ANSWER | REAPS_AFTER_A_DECISION
    found = declared_ceilings()

    unclassified = found - classified
    assert not unclassified, (
        "these wait ceilings are new since this guard was written and nobody "
        "has said whether their expiry could be read as an answer: "
        f"{sorted(unclassified)}. Add each to WAITS_ON_AN_ANSWER (and give it "
        "a test below that drives it into the timeout) or to "
        "REAPS_AFTER_A_DECISION with the reason it cannot grant anything."
    )
    vanished = classified - found
    assert not vanished, (
        f"these ceilings are classified here and no longer exist: "
        f"{sorted(vanished)}. A classification for a wait nobody takes is the "
        "hand-kept list going stale, one move earlier than usual"
    )
    assert not (WAITS_ON_AN_ANSWER & REAPS_AFTER_A_DECISION), (
        "a ceiling is in both sets, so one of the two answers is unread"
    )


# ---------------------------------------------------------------------------
# Driven, not read. Each of these puts a real surface into its own timeout.
# ---------------------------------------------------------------------------


def test_A_GATE_THAT_TIMES_OUT_IS_NEVER_PASSED_however_it_exits(tmp_path):
    """**The clause that would be dropped is `and not self.timed_out`.**

    A killed process group's exit code is not a promise: a shell that traps
    its own termination can exit 0 after being told to stop, and a gate whose
    verdict came from the exit code alone would then record a pass for work
    that was cut short. So the fixture exits 0 ON PURPOSE after trapping the
    signal — the exact shape that makes `exit_code == 0` alone a lie.
    """
    gate = config.Gate(id="slow", run="trap 'exit 0' TERM; sleep 30", timeout=1)

    result = gates.run(
        gate, tmp_path, tmp_path / "out.log", tmp_path / "err.log"
    )

    assert result.timed_out, "the gate was not actually driven into its ceiling"
    assert not result.passed, (
        f"a gate that ran out of time reports passed with exit "
        f"{result.exit_code} — a timeout became a green"
    )
    assert result.status == "failed"


def test_A_JUDGE_THAT_NEVER_ANSWERS_RAISES_RATHER_THAN_RETURNING_A_VERDICT(
    monkeypatch,
):
    """An endpoint that accepts the connection and then says nothing is the
    worst shape available: there is no error to report and no reply to parse.
    `send` must raise, so the caller reaches `needs_human` — and must never
    return a body that `parse_response` would then read as `pass`."""
    import urllib.request

    class NeverAnswers:
        def open(self, *args, **kwargs):
            # **Sleeps, then raises something `exchange()` CATCHES.** The first
            # version raised `AssertionError` to mark the line unreachable, and
            # it is reachable — thirty seconds after the test returned, on the
            # daemon thread `judge.send` left running. pytest reported it as an
            # unhandled thread exception and the gate grew a warning, which is
            # this test dirtying the console it was written to keep honest.
            time.sleep(30)
            raise OSError("the probe's endpoint never answered")

    monkeypatch.setattr(
        urllib.request, "build_opener", lambda *a, **k: NeverAnswers()
    )

    with pytest.raises(judge.TransportFailed) as raised:
        judge.send({"messages": []}, "https://example.invalid/v1", 1, None)

    assert "did not finish" in str(raised.value)


def test_AN_UNREACHABLE_JUDGE_BECOMES_NEEDS_HUMAN_AND_NEVER_A_PASS():
    """The other end of the same property, at the seam that consumes it.

    `TransportFailed` is caught in `cli.py` and turned into a verdict; the one
    thing it may never be turned into is `PASS`. Asserted against the module's
    own vocabulary rather than a string, so a renamed verdict takes this with
    it.
    """
    assert judge.NEEDS_HUMAN != judge.PASS
    body = (SRC / "wringer" / "cli.py").read_text(encoding="utf-8")
    assert "except judge.TransportFailed" in body, (
        "nothing catches a transport failure any more"
    )
    for after in body.split("except judge.TransportFailed")[1:]:
        window = after[:600]
        assert "judge.PASS" not in window, (
            "a transport failure is being turned into a pass: "
            f"{window.splitlines()[:12]}"
        )


def test_AN_AGENT_THAT_WILL_NOT_ANSWER_ITS_AUTH_PROBE_IS_NEVER_LOGGED_IN(
    tmp_path, monkeypatch
):
    """`UNKNOWN`, which is the honest answer, and specifically NOT `LOGGED_IN`.

    The distinction matters because `UNKNOWN` deliberately does not block
    (`will_fail` is False by design — refusing on an unmeasured agent would
    gate the run on Wringer's knowledge of a vendor). So the property here is
    not "it refuses"; it is that a silence never becomes the affirmative
    answer the paid turn is allowed to rely on.
    """
    from wringer import agents

    slow = tmp_path / "claude-agent-acp"
    slow.write_text("#!/bin/sh\nsleep 30\n", encoding="utf-8")
    slow.chmod(0o755)
    monkeypatch.setenv("PATH", f"{tmp_path}:{monkeypatch.__class__ and ''}"
                       + __import__("os").environ["PATH"])
    monkeypatch.setattr(worker_auth, "TIMEOUT", 1.0)

    entry = agents.find("claude-code")
    found = worker_auth.read(agents.worker(entry))

    assert found.state == worker_auth.UNKNOWN, (
        f"a probe that never answered was read as {found.state!r}"
    )
    assert found.state != worker_auth.LOGGED_IN
    assert "did not finish" in found.detail


def test_AN_AGENT_THAT_NEVER_ANSWERS_THE_HANDSHAKE_IS_NOT_LOGGED_OUT(monkeypatch):
    """**The free rung's ceiling, and its expiry runs the OTHER way.**

    Everywhere else in this file a timeout must not become a green. Here it
    must not become a RED: this rung can stop a run, so an agent that simply
    never answers must read `UNKNOWN` and let the run proceed. Refusing on
    silence would make the preflight a gate on the agent's speed, and the
    module's own law is that only a definite no earns a stop.
    """
    import sys as _sys
    from pathlib import Path as _Path

    from wringer import config, worker_auth

    monkeypatch.setattr(worker_auth, "HANDSHAKE_TIMEOUT", 2)
    fake = _Path(__file__).resolve().parent / "fake_acp_agent.py"

    found = worker_auth.read(
        config.AcpWorker(
            command=_sys.executable, args=(str(fake), "mute"), env_passthrough=()
        )
    )

    assert found.state == worker_auth.UNKNOWN, (
        f"an agent that answered nothing was read as {found.state!r} — a "
        "silence became a verdict"
    )
    assert not found.will_fail, "a handshake that timed out stopped a run"


def test_A_CONFIRM_WITH_NOBODY_BEHIND_IT_STOPS_AND_DOES_NOT_PROCEED():
    """The consent surface's own version of the rule.

    `wringer-drive` reads one line for every `confirm`. A closed stream, and
    an unreadable one, both end the run rather than taking a decision — and
    the exit code is the refusal's, never the success path's.
    """
    import io
    import sys

    from wringer_drive import __main__ as drive
    from wringer_drive.steps import CONFIRM, Step

    step = Step(kind=CONFIRM, id="t", text="", question="yes or no?")

    original = sys.stdin
    try:
        sys.stdin = io.StringIO("")
        with pytest.raises(drive.run_module.Stop) as closed:
            drive._confirm(step, "text")
        sys.stdin = io.StringIO("~~~\n" * 20)
        with pytest.raises(drive.run_module.Stop) as garbage:
            drive._confirm(step, "text")
    finally:
        sys.stdin = original

    assert closed.value.exit_code == 2
    assert garbage.value.exit_code == 2
    assert "nobody" in closed.value.step.id
    assert "unreadable" in garbage.value.step.id


def test_A_WORKER_TURN_THAT_NEVER_REPLIES_IS_NOT_A_TURN_THAT_HAPPENED(tmp_path):
    """The ACP client's request ceiling, driven against an agent that opens
    its pipes and then goes quiet. `run_turn` must raise rather than return a
    `Turn` the loop would then read as a lap the worker completed."""
    from wringer import acp

    agent = tmp_path / "mute-agent"
    agent.write_text("#!/bin/sh\nsleep 30\n", encoding="utf-8")
    agent.chmod(0o755)

    with pytest.raises(acp.AcpError) as raised:
        acp.run_turn(
            command=str(agent),
            args=(),
            env_passthrough=(),
            brief="do nothing",
            root=tmp_path,
            timeout=1,
            stdout_path=tmp_path / "agent.out",
            stderr_path=tmp_path / "agent.err",
        )

    # **Named, not just raised.** The first version asserted only that SOME
    # `AcpError` came back, and the mutation that made the deadline path
    # return a finished-looking turn left it green — a later guard caught the
    # mute agent for a different reason and the test could not tell the two
    # apart. It is the DEADLINE this file is about, so the deadline is what is
    # asserted.
    assert "deadline" in str(raised.value), (
        f"the turn failed for some other reason than running out of time: "
        f"{raised.value}"
    )


def test_A_PROVE_SETUP_THAT_RUNS_OUT_OF_TIME_IS_NOT_ok(tmp_path, monkeypatch):
    """`run.prove_setup` builds the environment the sensitivity lap runs in,
    so a setup that never finished means the lap that follows proves nothing
    about the change. Its `ok` comes from `GateResult.passed`, which is the
    same clause guarded above — this drives the second caller of it.

    **The first version of this test read the source instead of running it,
    and was VACUOUS**: it looked for a `TimeoutExpired` handler within 1500
    characters of the ceiling's name and there is none, because the ceiling is
    handed to `gates.run` and the handling lives there. The loop body never
    executed and the test passed on an empty search. Recorded rather than
    quietly replaced, because a guard that searches for something absent is
    the shape that keeps recurring here.
    """
    from wringer import vacuity

    monkeypatch.setattr(vacuity, "SETUP_TIMEOUT_SECONDS", 1)
    cfg = config.Config(
        version=1,
        gates=(),
        run=config.Run(
            worker="true", prove_setup="trap 'exit 0' TERM; sleep 30"
        ),
    )
    logs = tmp_path / "logs"
    logs.mkdir()

    setup = vacuity._run_setup(cfg, tmp_path, logs, None)

    assert setup is not None, "the fixture declared no prove_setup"
    assert setup["ok"] is False, (
        "a setup that ran out of time reported ok — the lap that follows it "
        "would then be described as having had an environment"
    )


def test_no_waiting_surface_defaults_its_answer_when_the_wait_expires():
    """**The mutation this whole file exists to catch, stated once.**

    Every assertion above is one site. This is the sentence they share: there
    is no `except TimeoutExpired` anywhere in `src/` whose body returns True,
    or a pass, or an approval. Read structurally — an `except` handler that
    returns a bare `True` is the one-line edit that turns any of the surfaces
    above into a grant, and it looks harmless in a diff.
    """
    offenders = []
    for path in sorted(SRC.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        lines = path.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            if "except" not in line or "Timeout" not in line:
                continue
            for follower in lines[index + 1 : index + 6]:
                stripped = follower.strip()
                if stripped.startswith(("except", "def ", "class ")):
                    break
                if re.fullmatch(r"return True|return \"pass\"|return 0", stripped):
                    offenders.append(f"{path.name}:{index + 1 + 1} -> {stripped}")
    assert not offenders, (
        "a wait that expired is being answered affirmatively: " f"{offenders}"
    )


def test_A_SHOW_COMMAND_THAT_HANGS_IS_NEVER_READ_AS_NOTHING_TO_SHOW(
    tmp_path, monkeypatch
):
    """**The two silences must not look alike.**

    `wringer_board.judge.shown` returns None to mean *this repository declares
    no way to render this requirement*, and the command that prints that says
    so in capitals — a person is being asked to judge something nobody can
    show them. A `show:` command that hangs must NOT collapse into that same
    None: a declared-and-broken renderer would then be indistinguishable from
    a renderer nobody wrote, and the loudest sentence on the surface would be
    pointing at the wrong repair.

    Expiry here grants nothing either way. The person still types the verdict.
    What it must not do is lie about which of the two silences this is.
    """
    from wringer_board import judge as board_judge

    repo = tmp_path / "project"
    repo.mkdir()
    (repo / "wringer.spec.yaml").write_text(
        "schema_version: wringer.spec.v1\napproved: true\ntitle: T\n"
        "intent: i\nopen_questions: []\ncriteria:\n"
        "  - id: slow\n    title: Slow\n    required: true\n    human: true\n"
        "gates: []\ntasks: []\n",
        encoding="utf-8",
    )
    (repo / ".wringer.yaml").write_text(
        "version: 1\ngates:\n  - id: t\n    run: 'true'\n"
        "show:\n  slow: sleep 30\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(board_judge, "SHOW_TIMEOUT", 1)

    text, command = board_judge.shown(repo, "slow")

    assert text is not None, (
        "a `show:` command that ran out of time came back as 'nothing is "
        "declared' — a broken renderer became an unwritten one"
    )
    assert command == "sleep 30"
    assert "could not be run" in text


def test_A_GIT_THAT_HANGS_NEVER_CONFIRMS_A_COMMIT_A_CERTIFICATE_NAMES(
    tmp_path, monkeypatch
):
    """**The certificate's offline check, driven into its own ceiling.**

    `wring audit certificate.json` asks git one question: is the commit this
    document names an object in the clone in front of me? A git that never
    answers must not be read as "yes" — a certificate naming a fabricated
    commit would then verify on any machine slow enough — and it must not be
    read as "no" either, because a hung subprocess says nothing about the
    document.

    It reports `not-checkable-here`, which is the third outcome existing for
    exactly this: a claim nobody could check is neither a pass nor a failure.
    """
    import subprocess

    from wringer import certificate

    def never_answers(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="git", timeout=1)

    monkeypatch.setattr(subprocess, "run", never_answers)

    payload = {
        "schema_version": certificate.SCHEMA_VERSION,
        "written_at": "2026-08-28T00:00:00+00:00",
        "change": {"title": "t", "branch": "b", "base": "main",
                   "commit": "f" * 40, "files_changed": 1},
        "run": {"id": "r", "bundle": "b"},
        "spec": {"sha256": None},
        "acceptance": {"schema_version": "wringer.acceptance.v3", "counts": {}},
        "requirements": [],
        "limits": ["one", "two", "three", "four"],
    }
    report = certificate.check(payload, tmp_path)
    commit = next(c for c in report.claims if "commit" in c.what)

    assert commit.outcome == certificate.NOT_HERE, commit
    assert commit.outcome != certificate.HOLDS, (
        "a git that never answered has confirmed a commit nobody looked for"
    )
