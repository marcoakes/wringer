"""The ACP worker seam (docs/specs/SPEC_ACP_V0.md).

Every test drives a real subprocess speaking real JSON-RPC over stdio —
`tests/fake_acp_agent.py`, not a mock of Wringer's own client. Mocking the
wire would test the author's idea of the protocol; running it tests the
protocol. No network, no API key, no vendor binary.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import fake_acp_agent
import pytest

from wringer import acp, agents, cli, config, containment, diagnose, loop

AGENT = Path(__file__).resolve().parent / "fake_acp_agent.py"


def acp_config(
    behaviour: str, timeout: int = 30, delay: float | None = None, **extra: str
) -> str:
    passthrough = extra.get("env_passthrough", "")
    tail = "" if delay is None else f", {json.dumps(str(delay))}"
    return f"""\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
run:
  worker:
    acp:
      command: {json.dumps(sys.executable)}
      args: [{json.dumps(str(AGENT))}, {json.dumps(behaviour)}{tail}]
{passthrough}
  max_iterations: 3
  worker_timeout: {timeout}
"""


def setup(repo: Path, behaviour: str, **kwargs) -> None:
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / ".wringer.yaml").write_text(acp_config(behaviour, **kwargs), "utf-8")


def only_loop(repo: Path) -> Path:
    found = sorted((repo / loop.LOOPS_DIRNAME).iterdir())
    assert len(found) == 1, found
    return found[0]


def events(repo: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in (only_loop(repo) / loop.EVENTS_FILENAME)
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]


def result(repo: Path) -> dict:
    return json.loads(
        (only_loop(repo) / loop.MANIFEST_FILENAME).read_text(encoding="utf-8")
    )["result"]


# --- the seam works end to end -------------------------------------------


def test_an_acp_agent_drives_the_loop_to_convergence(repo, monkeypatch, capsys):
    """The headline: the agent fixes the code through fs/write_text_file and
    the loop converges, with no shell command anywhere."""
    setup(repo, "fix")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()

    assert (repo / "calc.py").read_text(encoding="utf-8") == "FIXED\n"
    outcome = result(repo)
    assert outcome["status"] == "converged"
    assert outcome["iterations"] == 2

    started = next(e for e in events(repo) if e["type"] == "worker.started")
    finished = next(e for e in events(repo) if e["type"] == "worker.finished")
    assert started["worker_kind"] == "acp"
    assert finished["agent_name"] == "fake-acp-agent"
    assert finished["protocol_version"] == 1
    # recorded, and provably not acted on — see the next test
    assert finished["stop_reason"] == "end_turn"


def test_the_loop_cannot_tell_which_worker_form_ran(repo, monkeypatch, capsys):
    """The supervision invariants must not know about ACP. An idle ACP agent
    trips `no_progress` exactly as an idle shell worker does."""
    setup(repo, "idle")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    assert result(repo)["reason"] == "no_progress"


def test_a_turn_that_changed_nothing_and_said_nothing_IS_DIAGNOSED(
    repo, monkeypatch, capsys
):
    """**R1 (2026-08-18): the field run's fifteen silent minutes.**

    A PM's Claude Code could not authenticate. The deprecated adapter answered
    the prompt with a bare `result` and no content — to a client, a turn that
    succeeded and changed nothing — so the loop recorded an empty success,
    stopped on `no_progress`, and blamed a worker for a condition no worker
    could affect. Nothing anywhere said "it never engaged".

    The facts were all in the ledger the whole time: no `files_written`, no
    `refusals`, a clean `stop_reason`. Detection keys on those and NEVER on
    message text — F6's law, and the deprecated adapter's empty success is
    precisely why text cannot be trusted here.

    `no_progress` still stands (R2: no new reason value, the frozen enums do
    not move). Only legibility changes, and it reaches the RECORD.
    """
    setup(repo, "idle")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    assert result(repo)["reason"] == "no_progress", "the reason enum moved"

    written = only_loop(repo) / loop.WORKER_DIAGNOSIS_FILENAME
    assert written.is_file(), (
        "a worker that finished having changed nothing left no diagnosis — "
        "the operator gets `no_progress` and no way to tell 'it tried and "
        "failed' from 'it never engaged'"
    )
    payload = json.loads(written.read_text(encoding="utf-8"))
    assert payload["schema_version"] == loop.WORKER_DIAGNOSIS_SCHEMA_VERSION
    assert payload["face"] == diagnose.FACE_TURN_CHANGED_NOTHING
    assert payload["stop_reason"] == "end_turn"      # it claimed success
    assert payload["files_written"] == 0
    assert payload["refusals"] == 0

    said = payload["description"] + " " + payload["remedy"]
    assert "authenticate" in said, "the likeliest cause is never named"
    # Ruled 2026-08-19, after the verification drive fired this hint on a
    # turn whose cause was NEITHER of the two it named: the agent
    # authenticated, thought for 1m49s, and returned nothing it could write.
    # A hint that names two causes and omits the measured third is a guess
    # presented as a survey.
    assert "produced nothing" in said, (
        "the third measured cause — the agent engaged and produced nothing "
        "usable — is never named"
    )
    assert "env_passthrough" in said, (
        "the remedy never points at the operator's channel"
    )
    # **The remedy is a POINTER, not a list.** Wringer does not know which of
    # a person's secrets a worker needs and must not guess: naming one here
    # would push a credential across a boundary that exists to be crossed
    # deliberately (R1 refuses option (a) for exactly this).
    for variable in ("ANTHROPIC_API_KEY", "CLAUDE_", "OPENAI_", "_TOKEN"):
        assert variable not in said, (
            f"the remedy names {variable!r} — Wringer would be choosing which "
            "of a person's secrets cross into a worker"
        )


def test_a_REFUSED_turn_names_authentication_to_the_operator(
    repo, monkeypatch, capsys
):
    """**The ending that had no shape at all** — field report 2026-08-21 #11.

    A coding agent that has never been logged in answers `session/prompt` with
    an error. Before this, `loop.py`'s `except acp.AcpError` branch returned
    early and wrote no diagnosis of any kind — `diagnose_turn` returns None
    when `errored`, and its own docstring named "a refused session" as a
    distinct ending while covering none of it. So the operator got
    `no_progress` and the sentence "an engineer has to look at why it is
    stuck", and the one actionable fact — `Authentication required` — was in a
    log file under a timestamped directory nobody told them about. The word
    "authentication" appeared nowhere a person would look.

    The silence was STRUCTURAL, not a missing sentence: there was no shape for
    this ending, so there was nothing for the console, the record or the drive
    to carry.

    The loop's own reason does not move — `no_progress` stands, R2 — because
    this is legibility, not routing.
    """
    setup(repo, "unauth")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    written = only_loop(repo) / loop.WORKER_DIAGNOSIS_FILENAME
    assert written.is_file(), (
        "an agent that REFUSED the turn left no diagnosis — the operator is "
        "told an attempt changed nothing, which is not what happened"
    )
    payload = json.loads(written.read_text(encoding="utf-8"))
    assert payload["face"] == diagnose.FACE_TURN_REFUSED
    assert payload["schema_version"] == loop.WORKER_DIAGNOSIS_SCHEMA_VERSION

    said = payload["description"] + " " + payload["remedy"]
    assert "logged in" in said or "authenticat" in said, (
        "the PM-facing sentence never names authentication — the exact "
        "complaint the field report made about this ending"
    )
    # The agent's OWN words, carried rather than summarised. This is the line
    # that told a real operator what had happened, and it was reachable only
    # by knowing which log to open.
    assert "Authentication required" in payload.get("engine_words", ""), (
        "the agent's own account of the refusal is not carried"
    )

    # **Absent, not invented.** A refused turn never reached `stopReason`, and
    # writing "unknown" there would be a fact made up about a conversation
    # that did not happen. v2 exists to allow this absence.
    assert "stop_reason" not in payload, (
        "a stop reason was recorded for a turn that never reported one"
    )
    # The ledger DID survive this failure, so the counts are read rather than
    # guessed — the agent was refused before it touched anything.
    assert payload["files_written"] == 0
    assert payload["refusals"] == 0

    # The remedy points at the agent's own login and the log, and still never
    # names a credential variable — `turn_changed_nothing`'s rule, unchanged.
    for variable in ("ANTHROPIC_API_KEY", "WRINGER_API_KEY", "CLAUDE_", "_TOKEN"):
        assert variable not in said, (
            f"the remedy names {variable!r} — Wringer would be choosing which "
            "of a person's secrets cross into a worker"
        )


def test_the_printed_ending_QUOTES_the_agent_not_an_EMPTY_pair(
    repo, monkeypatch, capsys
):
    """**Found by running a refused turn, 2026-08-22.**

    The console printed, literally:

        (it reported `` and wrote no file)

    Empty backticks, in this repository's single commonest failure. The
    printer read `stop_reason`, and the test directly above this one asserts
    that a refused turn has NO stop reason — it errored before one existed.
    The agent's words were on the diagnosis the whole time, in `engine_words`,
    which is the field that exists to carry them.

    A promise of a quotation, delivered as silence, reads as a bug in Wringer
    at the moment the operator most needs to believe what it says.
    """
    setup(repo, "unauth")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    printed = capsys.readouterr().out

    assert "``" not in printed, (
        "the ending quotes an empty string back at the operator"
    )
    assert "Authentication required" in printed, (
        "the agent's own words are on the diagnosis and never reach the "
        "console, so the one actionable fact still needs a log file"
    )


def test_the_remedy_points_at_a_log_that_actually_HAS_the_words(
    repo, monkeypatch, capsys
):
    """The remedy sent people to a file that is EMPTY on this path.

    It said *"the agent's own last words are in `worker.stderr.log`"*. Run a
    real refused turn and that file is zero bytes: the message Wringer writes
    — `[wringer: ACP turn failed] session/prompt was refused: …` — goes to the
    STDOUT log. So the remedy for the commonest failure in this repository
    named the one log guaranteed not to contain the answer.

    Derived from the files the loop actually wrote, not from the string, so a
    remedy naming a log that stops existing fails here too.
    """
    setup(repo, "unauth")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    written = only_loop(repo) / loop.WORKER_DIAGNOSIS_FILENAME
    remedy = json.loads(written.read_text(encoding="utf-8"))["remedy"]

    carrying = [
        log.name
        for log in sorted((only_loop(repo)).rglob("worker.std*.log"))
        if "Authentication required" in log.read_text(encoding="utf-8")
    ]
    assert carrying, "no worker log carried the refusal at all"
    assert any(name in remedy for name in carrying), (
        f"the remedy names no log that contains the words it promises. The "
        f"refusal is in {carrying}, and the remedy says: {remedy}"
    )


def test_a_CONVERGED_loop_never_says_the_agent_changed_nothing(
    repo, monkeypatch, capsys
):
    """**Measured on the first real build this product drove to completion.**

    2026-08-22, the arcade example on the author's Mac: the loop converged, a
    red acceptance check went green, the agent wrote five files — and the
    ending printed *"the agent finished its turn without changing a file or
    reporting an error; this usually means it could not authenticate"*. The
    product succeeded and then told the operator it had failed.

    The counter was not lying. `files_written` counts writes that crossed
    Wringer's own `fs/write_text_file` channel, and a real coding agent holds
    the filesystem itself and never asks. `ownhands` is that agent: it fixes
    the file directly, so the ledger honestly reads zero while the disk
    changes underneath.

    What was wrong is the INFERENCE. Convergence settles it — the gates went
    green, so something was built, whoever wrote it and however — and a hint
    contradicted by the loop's own verdict is not a hint.
    """
    setup(repo, "ownhands")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    printed = capsys.readouterr().out

    assert "Converged" in printed, (
        "the fixture no longer converges, so this guard is checking nothing"
    )
    written = only_loop(repo) / loop.WORKER_DIAGNOSIS_FILENAME
    if written.is_file():
        # The record may still carry the face — it is a true statement about
        # Wringer's own channel. The CONSOLE is what may not contradict the
        # ending printed two lines above it.
        assert json.loads(written.read_text(encoding="utf-8"))["files_written"] == 0
    assert "without changing a file" not in printed, (
        "the loop converged and the console still told the operator the agent "
        "changed nothing"
    )
    assert "could not authenticate" not in printed, (
        "a converged run offers authentication as an explanation for its own "
        "success"
    )


def test_the_quote_prefers_the_STOP_REASON_over_carried_telemetry(
    repo, monkeypatch, capsys
):
    """Which of the two fields is quoted, settled by the same real run.

    A refused turn has no stop reason and its words are in `engine_words`, so
    that field has to be reachable. But on a turn that FINISHED, `engine_words`
    held the adapter's `usage_update` notification — a raw JSON blob of token
    counts and cost — and quoting it would print that at a person instead of
    `end_turn`.

    So the precedence is stop reason first. `usageidle` is the shape that can
    show it: a turn that really did spend and really did produce nothing, so
    the diagnosis IS emitted and its `engine_words` carry telemetry. (`usage`
    cannot — it writes a file, so no diagnosis is produced at all and a guard
    written against it asserts about a line nobody printed.)
    """
    setup(repo, "usageidle")
    monkeypatch.chdir(repo)

    cli.main(["run"])
    printed = capsys.readouterr().out

    written = only_loop(repo) / loop.WORKER_DIAGNOSIS_FILENAME
    assert written.is_file(), "no diagnosis, so this guard would check nothing"
    carried = json.loads(written.read_text(encoding="utf-8"))["engine_words"]
    assert "usage_update" in carried, (
        "the fixture no longer puts telemetry in engine_words, so the choice "
        "between the two fields is not being exercised"
    )

    assert "without changing a file" in printed, "the diagnosis did not print"
    assert "sessionUpdate" not in printed and "usage_update" not in printed, (
        "a raw telemetry notification was quoted back at the operator"
    )
    assert "`end_turn`" in printed, "the turn's own stop reason was not quoted"


def test_a_refused_turn_is_not_confused_with_a_turn_that_finished(
    repo, monkeypatch, capsys
):
    """The other direction, and the reason the pair exists.

    Two faces that both fire on "nothing happened" would be one face with two
    names. `idle` finishes cleanly having done nothing; `unauth` never
    finishes. They must land on different faces, or the distinction the whole
    slice exists to draw is decorative.
    """
    setup(repo, "idle")
    monkeypatch.chdir(repo)
    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    payload = json.loads(
        (only_loop(repo) / loop.WORKER_DIAGNOSIS_FILENAME).read_text("utf-8")
    )
    assert payload["face"] == diagnose.FACE_TURN_CHANGED_NOTHING, (
        "a turn that finished cleanly was reported as refused"
    )
    # It finished, so it HAS a stop reason — the field the refused face omits.
    assert payload["stop_reason"] == "end_turn"


def test_a_worker_that_DID_change_a_file_is_not_diagnosed_as_absent(
    repo, monkeypatch, capsys
):
    """The other direction, and the reason the pair exists: a detector that
    fired on every ending would satisfy the test above while describing every
    run in the world. This agent writes the file and the loop converges —
    there is nothing to diagnose and no file may appear."""
    setup(repo, "fix")
    monkeypatch.chdir(repo)

    cli.main(["run"])
    capsys.readouterr()

    assert not (only_loop(repo) / loop.WORKER_DIAGNOSIS_FILENAME).exists(), (
        "a worker that really did the work was reported as never having "
        "engaged"
    )


def test_a_stop_reason_changes_no_decision(repo, monkeypatch, capsys):
    """`stopReason` is the ACP analogue of an exit code: recorded, never
    obeyed. The agent says end_turn having fixed nothing, and the evidence
    still decides."""
    setup(repo, "idle")
    monkeypatch.chdir(repo)

    cli.main(["run"])
    capsys.readouterr()

    finished = next(e for e in events(repo) if e["type"] == "worker.finished")
    assert finished["stop_reason"] == "end_turn"      # it claimed success
    assert result(repo)["status"] == "stopped"        # the gates disagreed


# --- the file seam is bounded --------------------------------------------


def test_a_write_outside_the_repo_is_refused(repo, monkeypatch, capsys):
    """Wringer is not obliged to help an agent write outside the tree it was
    pointed at, and a `..` is not an argument."""
    setup(repo, "escape")
    monkeypatch.chdir(repo)

    cli.main(["run"])
    capsys.readouterr()

    assert not (repo.parent / "escaped.txt").exists()
    finished = next(e for e in events(repo) if e["type"] == "worker.finished")
    assert finished["refused_paths"] >= 1


def test_a_permission_request_is_auto_approved_and_recorded(
    repo, monkeypatch, capsys
):
    """Auto-approval is the v0 ruling — a consent prompt nobody is sitting at
    is not a safety control. The ledger is what keeps it auditable."""
    setup(repo, "permission")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()

    granted = [e for e in events(repo) if e["type"] == "worker.permission"]
    assert len(granted) == 1
    assert granted[0]["outcome"] == "auto_approved"
    assert "write calc.py" in granted[0]["tool"]


# --- failures map onto things the loop already knows ----------------------


def test_an_agent_that_crashes_is_a_failed_turn_not_a_crash(
    repo, monkeypatch, capsys
):
    setup(repo, "crash")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    finished = next(e for e in events(repo) if e["type"] == "worker.finished")
    assert finished["worker_kind"] == "acp"
    assert "acp_error" in finished
    # the loop still reached a normal ending rather than exploding
    assert result(repo)["status"] == "stopped"


def test_a_hanging_agent_cannot_hang_the_loop(repo, monkeypatch, capsys):
    """Every wait has a deadline — invariant 3, and the reason the whole
    supervision spec exists."""
    setup(repo, "hang", timeout=2)
    monkeypatch.chdir(repo)

    started = time.monotonic()
    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    elapsed = time.monotonic() - started
    capsys.readouterr()

    # worker_timeout is 2s. A client-side default must not outlive the number
    # the repo wrote down — this once took 120s because it did.
    assert elapsed < 30, f"the loop hung for {elapsed:.0f}s past a 2s timeout"
    assert result(repo)["status"] == "stopped"
    finished = next(e for e in events(repo) if e["type"] == "worker.finished")
    assert finished.get("timed_out") is True


def test_a_prompt_turn_is_bounded_by_worker_timeout_and_not_by_the_client(
    repo, monkeypatch, capsys
):
    """The turn's deadline is the number the repo wrote down — SPEC_ACP_V0 §3.

    Wringer's own per-request ceiling used to apply to `session/prompt` as
    well as to the handshake, so a repo asking for `worker_timeout: 900` got
    120 and the ledger recorded `timed_out` about an agent that was still
    working. Measured before this fix: nothing in 1210 tests failed, because
    every test agent answers instantly.

    The ceiling is shrunk here rather than the agent slowed to two minutes —
    the same trick `worker_timeout: 2` plays two tests up. It is the constant
    under test, so patching it IS the test: with the cap cut to 2s and the
    turn given 30, an agent that thinks for 3s must still converge.
    """
    setup(repo, "slow", timeout=30, delay=3.0)
    monkeypatch.chdir(repo)
    monkeypatch.setattr(acp, "REQUEST_TIMEOUT_SECONDS", 2)

    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()

    assert (repo / "calc.py").read_text(encoding="utf-8") == "FIXED\n"
    finished = next(e for e in events(repo) if e["type"] == "worker.finished")
    assert finished.get("timed_out") is not True
    assert "acp_error" not in finished, finished.get("acp_error")
    # The handshake keeps its ceiling: it is a control-plane call, and an
    # `initialize` that does not answer promptly is broken rather than busy.
    assert acp.REQUEST_TIMEOUT_SECONDS == 2


def test_the_handshake_still_has_a_ceiling_of_its_own(repo, monkeypatch, capsys):
    """Uncapping the prompt must not uncap everything.

    `initialize` keeps `REQUEST_TIMEOUT_SECONDS`, so an agent that never
    completes the handshake fails fast instead of holding a ten-minute
    `worker_timeout` open — which is what "the cap is for control-plane
    calls" has to mean if it means anything.
    """
    setup(repo, "mute", timeout=600)
    monkeypatch.chdir(repo)
    monkeypatch.setattr(acp, "REQUEST_TIMEOUT_SECONDS", 2)

    started = time.monotonic()
    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    elapsed = time.monotonic() - started
    capsys.readouterr()

    assert elapsed < 120, f"the handshake held the turn for {elapsed:.0f}s"
    finished = next(e for e in events(repo) if e["type"] == "worker.finished")
    assert "acp_error" in finished


def test_a_missing_agent_binary_is_refused_before_the_loop_starts(
    repo, monkeypatch, capsys
):
    """SPEC_ACP_V0 §3, first row: *binary missing → exit 2 before the loop
    starts*.

    It did not. The loop ran, failed to spawn anything, and printed
    `→ worker (exit 1)` twice before stopping on `no_progress` — an absent
    binary reported as the worker's fault, and a bundle written about a run
    that never had an agent. `bench.py` refused correctly the whole time, so
    the same missing agent meant two different things depending on which
    command found it.
    """
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / ".wringer.yaml").write_text(
        """\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
run:
  worker:
    acp:
      command: definitely-not-installed-anywhere
  max_iterations: 2
""",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_CONFIG
    said = capsys.readouterr().err
    assert "definitely-not-installed-anywhere" in said
    assert "never installs an agent" in said
    # Nothing created: no bundle claiming a run that never had an agent.
    assert not (repo / loop.LOOPS_DIRNAME).exists()


def test_a_missing_agent_offers_the_install_line_the_table_holds(
    repo, monkeypatch, capsys
):
    """A binary the registry knows gets its install command; one it does not
    gets no guess. `agents.py` is the only place a package name may live."""
    known = agents.find("claude-code")
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / ".wringer.yaml").write_text(
        f"""\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
run:
  worker:
    acp:
      command: {known.command}
  max_iterations: 2
""",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)
    # Narrowly: this machine may well have the real agent installed, and
    # blanking `which` outright would take `git` with it.
    real = shutil.which
    monkeypatch.setattr(
        loop.shutil,
        "which",
        lambda command, *a, **kw: None
        if command == known.command
        else real(command, *a, **kw),
    )

    assert cli.main(["run"]) == cli.EXIT_CONFIG
    said = capsys.readouterr().err
    assert known.install in said
    assert known.package in said


def test_the_registry_names_the_package_that_is_actually_published():
    """A pinned vendor table, checked for the one thing a test can check.

    Not that the package exists — that is a network call this suite refuses to
    make, and the freshness check is `docs/MANUAL_CHECKS.md` sequence F. What
    is checkable is that the entry's own two halves agree with what was
    installed on 2026-08-11: the renamed package and the renamed binary, which
    are not derivable from each other and drifted apart as a pair.
    """
    entry = agents.find("claude-code")
    assert entry.command == "claude-agent-acp"
    assert entry.package == "@agentclientprotocol/claude-agent-acp"
    # The id is the handle config speaks and must survive a rename.
    assert agents.by_command("claude-agent-acp") is entry


# --- the client speaks the protocol, and the double checks that it does ----


def test_a_new_session_carries_every_field_the_protocol_requires(
    repo, monkeypatch, capsys
):
    """`session/new` needs `mcpServers`, and Wringer used to omit it.

    Measured on 2026-08-11 against `claude-agent-acp` 0.66.0: the real agent
    refused every session with `Invalid params` naming this exact field, so no
    ACP turn had ever run in this program's life — while 1210 tests passed,
    because the fake agent answered without reading the request.

    There is no separate assertion to make here. The double now refuses a
    malformed request the way the real agent does, so **every test in this
    file is the guard**: delete `mcpServers` from `acp.py` and the whole ACP
    suite goes red. This test exists to say that in one place, and to pin the
    field by name so a future edit cannot quietly drop it again.
    """
    setup(repo, "fix")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()

    finished = next(e for e in events(repo) if e["type"] == "worker.finished")
    assert finished["agent_name"] == "fake-acp-agent"
    assert "acp_error" not in finished
    assert "mcpServers" in fake_acp_agent.REQUIRED["session/new"]


def test_the_fake_agent_refuses_what_a_real_agent_refuses(repo):
    """The double's own rules, pinned — 2a's whole point.

    A test double more permissive than the thing it stands in for does not
    test a client, it launders it. The required-field table is transcribed
    from the published schema by hand (a suite that reads a vendored copy goes
    stale silently; one that fetches it phones a registry), so the
    transcription is what a test can check.
    """
    assert fake_acp_agent.missing_fields("session/new", {"cwd": "."}) == [
        "mcpServers"
    ]
    assert fake_acp_agent.missing_fields(
        "session/new", {"cwd": ".", "mcpServers": []}
    ) == []
    assert fake_acp_agent.missing_fields("initialize", {}) == ["protocolVersion"]
    assert fake_acp_agent.missing_fields("session/prompt", {"prompt": []}) == [
        "sessionId"
    ]
    # A method the table says nothing about is not this fixture's business.
    assert fake_acp_agent.missing_fields("session/update", {}) == []


def test_a_refused_session_is_a_failed_turn_and_not_a_crash(
    repo, monkeypatch, capsys
):
    """And when the client DOES get it wrong, the shape is the one measured.

    The real agent's refusal is a JSON-RPC error, which `_await` raises as an
    `AcpError` and the loop records as a failed worker turn — never a verdict
    about the code. This drives that path deliberately, by asking the agent
    for a session the protocol does not allow.
    """
    setup(repo, "fix")
    monkeypatch.chdir(repo)
    # The pre-fix client, reproduced exactly: `cwd` and nothing else.
    original = acp.Connection.send_request

    def without_mcp_servers(self, method, params, **kwargs):
        if method == "session/new":
            params = {"cwd": params["cwd"]}
        return original(self, method, params, **kwargs)

    monkeypatch.setattr(acp.Connection, "send_request", without_mcp_servers)

    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    finished = next(e for e in events(repo) if e["type"] == "worker.finished")
    # The METHOD is named, not just the agent's complaint. Diagnosing the
    # first real-agent refusal meant reading someone else's schema to work
    # out which of three calls `Invalid params` referred to; the agent says
    # what is wrong and only Wringer knows what it asked.
    assert finished["acp_error"] == "session/new was refused: Invalid params"
    assert result(repo)["status"] == "stopped"
    assert (repo / "calc.py").read_text(encoding="utf-8") == "BROKEN\n"


def test_a_garbage_line_does_not_derail_the_session(repo, monkeypatch, capsys):
    """Agents print things. A line that is not JSON-RPC is noise, not a
    reason to abandon the turn."""
    setup(repo, "garbage")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()

    assert result(repo)["status"] == "converged"


# --- the environment an agent gets ---------------------------------------


def test_the_agent_gets_a_minimal_environment(repo, monkeypatch, capsys):
    """Anything not named in `env_passthrough` is WITHHELD from the agent.

    This test used to be vacuous, and it guarded a security property while
    being so. It set a secret variable, ran the loop, and then asserted that
    an unrelated freshly-parsed config had an empty `env_passthrough` — an
    assertion with no connection to the run. Measured 2026-08-11: replacing
    `acp.run_turn`'s allowlist with `dict(os.environ)`, so the agent was
    handed every credential on the machine, left it PASSING.

    So the agent now reports the variable NAMES it was given and the test
    reads them. Names rather than values, deliberately: the question is which
    variables crossed the boundary, and printing their contents would write
    the credentials under test into a log.
    """
    monkeypatch.setenv("WRINGER_TEST_SECRET_VAR", "should-not-be-visible")
    monkeypatch.setenv("WRINGER_TEST_CREDENTIAL", "named-so-allowed")
    setup(
        repo,
        "env",
        env_passthrough="      env_passthrough: [WRINGER_TEST_CREDENTIAL]\n",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()

    log = (
        only_loop(repo) / loop.ITERATIONS_DIRNAME / "001" / "worker.stdout.log"
    ).read_text(encoding="utf-8")
    reported = next(
        line for line in log.splitlines() if "env: " in line
    ).split("env: ", 1)[1]
    seen = set(reported.replace('"}', "").split())

    # The claim, tested at last.
    assert "WRINGER_TEST_SECRET_VAR" not in seen, (
        "the agent was handed a variable no config named"
    )
    # And the other half, or the test would also pass on an empty environment.
    assert "WRINGER_TEST_CREDENTIAL" in seen, (
        "a NAMED passthrough did not reach the agent"
    )
    # What every process needs to run at all, and nothing more.
    assert {"PATH", "HOME"} <= seen
    assert "AWS_SECRET_ACCESS_KEY" not in seen and "GITHUB_TOKEN" not in seen


def test_a_shell_worker_inherits_the_whole_environment_by_design(
    repo, monkeypatch, capsys
):
    """The other half of the boundary, asserted so nobody mistakes it.

    `.wringer.yaml` is arbitrary code by design (SECURITY.md), so a SHELL
    worker runs with the operator's environment exactly as any Makefile
    target would. That is not a hole and it is not something the ACP
    allowlist implies has been closed — the two worker forms have genuinely
    different boundaries, and a reader who saw only the test above would
    reasonably assume otherwise.

    Written as a test rather than a comment because a boundary nobody
    exercises is a boundary nobody notices moving.
    """
    monkeypatch.setenv("WRINGER_TEST_SECRET_VAR", "visible-to-a-shell-worker")
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / ".wringer.yaml").write_text(
        """\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
run:
  worker: "printenv WRINGER_TEST_SECRET_VAR > seen.txt; echo FIXED > calc.py"
  max_iterations: 3
""",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()

    assert (repo / "seen.txt").read_text(encoding="utf-8").strip() == (
        "visible-to-a-shell-worker"
    ), "a shell worker's inheritance is by design; if this changed, say so"


# --- config ---------------------------------------------------------------


def test_the_shell_form_still_works_untouched():
    cfg = config.parse(
        {
            "version": 1,
            "gates": [{"id": "t", "run": "true"}],
            "run": {"worker": "claude -p '{brief}'"},
        }
    )
    assert cfg.run.worker == "claude -p '{brief}'"
    assert isinstance(cfg.run.worker, str)


def test_the_acp_form_parses():
    cfg = config.parse(
        {
            "version": 1,
            "gates": [{"id": "t", "run": "true"}],
            "run": {
                "worker": {
                    "acp": {
                        "command": "claude-agent-acp",
                        "args": ["--stdio"],
                        "env_passthrough": ["ANTHROPIC_API_KEY"],
                    }
                }
            },
        }
    )
    worker = cfg.run.worker
    assert isinstance(worker, config.AcpWorker)
    assert worker.command == "claude-agent-acp"
    assert worker.args == ("--stdio",)
    assert worker.env_passthrough == ("ANTHROPIC_API_KEY",)


@pytest.mark.parametrize(
    "worker, match",
    [
        ({}, "exactly one key"),
        ({"acp": {}, "shell": "x"}, "exactly one key"),
        ({"acp": {"command": ""}}, "acp.command"),
        ({"acp": {"command": "x", "args": "not-a-list"}}, "acp.args"),
        ({"acp": {"command": "x", "env_passthrough": [""]}}, "env_passthrough"),
        ({"acp": {"command": "x", "nonsense": 1}}, "unknown keys"),
        (5, "must be a shell command string"),
        (None, "must be a shell command string"),
    ],
)
def test_invalid_worker_forms_raise(worker, match):
    with pytest.raises(config.ConfigError, match=match):
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "t", "run": "true"}],
                "run": {"worker": worker},
            }
        )


def test_env_passthrough_names_variables_never_values():
    """The message has to teach the rule, because a config file is exactly
    where somebody would paste a key."""
    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "t", "run": "true"}],
                "run": {"worker": {"acp": {"command": "x", "env_passthrough": [5]}}},
            }
        )

    assert "NAMES" in str(caught.value)
    assert "credential" in str(caught.value)


def test_a_write_to_an_agent_that_stopped_reading_cannot_block_forever():
    """The eight-hour incident's shape, in the seam built to honour it.

    A pipe write blocks once the buffer fills and the far end stops reading.
    That block is armed BEFORE `worker_timeout` and `wall_clock` exist —
    both are only consulted after the write returns — so an agent that hangs
    without draining stdin used to hold Wringer open indefinitely: no
    deadline, no breaker, no ledger growth, nothing to reap.

    Tested at the write itself rather than through the loop, because a
    realistic prompt fits in the buffer and never blocks: an end-to-end test
    passes just as happily against the broken implementation, which is how
    this nearly shipped twice.

    Without the fix this HANGS rather than fails. The elapsed-time assertion
    is what makes the difference visible.
    """
    import subprocess
    import time

    from wringer import acp

    # nothing ever reads this process's stdin
    proc = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(120)"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    try:
        started = time.monotonic()
        connection = acp.Connection(proc, deadline=started + 3)
        # comfortably past any pipe buffer (64 KB on Linux, 16 KB on some BSDs)
        with pytest.raises(acp.AcpError) as raised:
            connection.send_request("session/prompt", {"blob": "x" * 500_000})
        elapsed = time.monotonic() - started

        assert "stopped reading" in str(raised.value)
        assert elapsed < 30, (
            f"the write took {elapsed:.1f}s — it is not bounded by the turn's "
            "deadline"
        )
    finally:
        proc.kill()
        proc.wait(timeout=10)


def test_a_healthy_agent_is_not_slowed_by_the_write_ceiling(repo, monkeypatch,
                                                            capsys):
    """The bound must not cost anything when the agent behaves."""
    setup(repo, "fix")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK

    capsys.readouterr()
    assert (repo / "calc.py").read_text(encoding="utf-8").strip() == "FIXED"


# --- a secret in the agent's output must not reach the bundle --------------
#
# `acp.py` handed the child a RAW stderr handle and wrote its session updates
# with no scrub, unlike the shell path (`gates.py:167-180`, which captures
# through a pipe precisely so redaction can happen BEFORE the write). Those
# logs land in a bundle, so until this was fixed a key passed to an agent
# could reach one — which made docs/specs/SPEC_START_V0.md §8's "no bundle" box
# unmeetable. Both tests plant a real secret in real agent output and grep.


def wringer_tree(repo: Path) -> list[Path]:
    return [p for p in (repo / ".wringer").rglob("*") if p.is_file()]


def mentions(repo: Path, needle: str) -> list[str]:
    hits = []
    for path in wringer_tree(repo):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:  # pragma: no cover - nothing here is unreadable
            continue
        if needle in text:
            hits.append(path.relative_to(repo).as_posix())
    return hits


def test_a_secret_the_agent_echoes_never_reaches_the_bundle(
    repo, monkeypatch, capsys
):
    """The acp.py scrub, isolated. The variable's NAME matches the redactor's
    default `*KEY*` pattern, so the redactor knows the value however
    `env_passthrough` is handled — the only thing that can leak it is an
    unscrubbed write path."""
    secret = "sk-ant-notarealkey-4a7f2c9e1b6d8035"
    monkeypatch.setenv("WRINGER_TEST_API_KEY", secret)
    setup(
        repo,
        "leak",
        env_passthrough="      env_passthrough: [WRINGER_TEST_API_KEY]\n",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()

    assert wringer_tree(repo), "the loop wrote no bundle to grep"
    assert mentions(repo, secret) == [], (
        "the agent's own output carried a live credential into the evidence"
    )
    # The scrub happened rather than the leak simply not being written: the
    # placeholder is there in its place.
    assert mentions(repo, "[REDACTED]"), "nothing was scrubbed at all"


def test_an_env_passthrough_value_is_redacted_even_with_an_unremarkable_name(
    repo, monkeypatch, capsys
):
    """`config.py:190-192` promises every named passthrough variable's value is
    folded into the redactor, and no code did it — `loop.run` built the
    redactor with no `extra_names`. So a passthrough variable was only
    protected if its NAME happened to match `*TOKEN*`/`*SECRET*`/`*KEY*`.
    `WRINGER_TEST_CREDENTIAL` matches none of them, which is the whole point.
    """
    secret = "notarealcredential-9f3e11c4a7028dd6"
    monkeypatch.setenv("WRINGER_TEST_CREDENTIAL", secret)
    setup(
        repo,
        "leak",
        env_passthrough="      env_passthrough: [WRINGER_TEST_CREDENTIAL]\n",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()

    assert mentions(repo, secret) == [], (
        "a declared passthrough variable's value reached the evidence — the "
        "promise in config.py's own comment was not kept"
    )


def test_a_failed_turn_keeps_what_the_agent_said_before_it_died(
    repo, monkeypatch, capsys
):
    """SPEC_ACP_V0 §2 promises session updates reach
    `iterations/NNN/worker.stdout.log` "so an ACP worker leaves the same shape
    of evidence a shell worker does". It did not, on the one path where the
    evidence matters most.

    `run_turn`'s `finally` writes the updates; the AcpError then reaches
    `loop._run_acp_worker`, whose handler wrote the failure note to the SAME
    path with `write_text` — destroying them. A shell worker that crashes
    keeps its stdout; this one lost the last thing the agent said before it
    went. Pre-existing since the ACP seam shipped.
    """
    setup(repo, "loudcrash")
    monkeypatch.chdir(repo)

    cli.main(["run"])
    capsys.readouterr()

    logs = sorted((repo / loop.LOOPS_DIRNAME).rglob("worker.stdout.log"))
    assert logs, "no worker log was written at all"
    body = logs[0].read_text(encoding="utf-8")

    assert "ACP turn failed" in body, "the failure itself must still be recorded"
    assert "THE LAST THING THE AGENT SAID" in body, (
        "the agent's own output was overwritten by the failure note — the "
        "bundle lost the only diagnostic the turn produced"
    )


# --- the stderr pipe: the questions a review would ask ---------------------
#
# `run_turn` used to hand the child a raw file handle for stderr. It is a PIPE
# now, drained by a daemon thread, because redaction has to happen before the
# write. A pipe nobody drains fills its buffer and blocks the writer — so the
# change traded a leak for a possible HANG, in the seam built around an
# eight-hour unsupervised hang. These are that trade, measured.


def open_fds() -> int:
    """How many descriptors this process holds. /dev/fd on macOS and Linux."""
    return len(os.listdir("/dev/fd"))


def test_a_turn_gives_back_every_descriptor_it_opened(
    repo, tmp_path_factory, monkeypatch
):
    """`_stop` closes the child's stdin only when it has to KILL the process,
    so an agent that exited cleanly — the common case — left stdin, stdout and
    stderr all open. A `wring fleet` drives hundreds of turns inside one
    process, and running out of file handles surfaces somewhere else entirely
    as `too many open files`.

    Asserted on the mechanism rather than on a descriptor count, deliberately.
    Counting was tried first and thrown away: CPython's refcounting reclaims
    most of these on its own, so the measurement moved with GC timing and the
    test passed with the fix REVERTED. Measured directly, 12 turns grew the
    count by 3 without this and by 0 with it — real, but not something to
    assert a number about.

    This fails if the call is removed (the spy never runs) and fails if the
    function is gutted (the streams are still open when it does).
    """
    from wringer import acp

    real = acp._close_streams
    observed: list[list[bool]] = []

    def spy(proc):
        real(proc)
        observed.append(
            [s is None or s.closed for s in (proc.stdin, proc.stdout, proc.stderr)]
        )

    monkeypatch.setattr(acp, "_close_streams", spy)
    logs = tmp_path_factory.mktemp("onelog")

    acp.run_turn(
        command=sys.executable,
        args=(str(AGENT), "idle"),
        env_passthrough=(),
        brief="do nothing",
        root=repo,
        timeout=20,
        stdout_path=logs / "out",
        stderr_path=logs / "err",
    )

    assert observed, "the turn ended without handing its descriptors back"
    assert all(all(flags) for flags in observed), (
        f"a stream was still open when the turn ended: {observed}"
    )


def test_a_noisy_agent_does_not_wedge_the_turn(repo, monkeypatch, capsys):
    """200 KB of stderr, against a pipe buffer that holds 64. If the pump
    thread were not draining, the agent would block on write and the turn
    would hang until the worker timeout — a supervisor stalled by output,
    which is the one failure this module exists to not have."""
    setup(repo, "noisy", timeout=25)
    monkeypatch.chdir(repo)

    started = time.monotonic()
    assert cli.main(["run"]) == cli.EXIT_OK
    elapsed = time.monotonic() - started
    capsys.readouterr()

    assert elapsed < 20, (
        f"the turn took {elapsed:.0f}s — the agent was blocked writing to a "
        "pipe nobody was reading"
    )
    log = next((only_loop(repo)).rglob("worker.stderr.log"))
    assert log.stat().st_size > 0, "the flood was captured nowhere"


def test_the_last_bytes_an_agent_wrote_are_captured(repo, monkeypatch, capsys):
    """The agent writes and exits in the same breath, so those bytes are in
    flight while the client is already stopping the process. Losing them is
    losing exactly the line that says why it went."""
    setup(repo, "lastword")
    monkeypatch.chdir(repo)

    cli.main(["run"])
    capsys.readouterr()

    log = next((only_loop(repo)).rglob("worker.stderr.log"))
    assert "THE LAST BYTES BEFORE THE EXIT" in log.read_text(encoding="utf-8")


def test_the_last_message_is_served_even_when_it_lands_as_the_agent_exits():
    """The race that turned CI red while every local run stayed green.

    `_read_forever` sets `_done` at EOF, so by then everything the agent said
    is in `_inbound`. But `_await` pops `_inbound` at the TOP of its loop and
    checks for the exit at the BOTTOM — so a line that arrives between those
    two points is still sitting in the queue when the exit check fires, and
    raising there discards it. On a fast machine the pop almost always wins.
    On a loaded CI runner it does not.

    What is discarded is precisely the last thing an agent said before it
    died, which is the highest-value line in a failed turn.

    Driven directly rather than through a subprocess, because a race that
    reproduces one run in ten is not a test — this forces the exact
    interleaving every time.
    """
    import threading

    from wringer import acp

    class ExitedProc:
        returncode = 0
        stdin = stdout = stderr = None

        def poll(self):
            return 0

    connection = acp.Connection.__new__(acp.Connection)
    connection._proc = ExitedProc()
    connection._deadline = time.monotonic() + 5
    connection._next_id = 1
    connection._responses = {}
    connection._lock = threading.Lock()
    connection._inbound = []
    connection._done = threading.Event()

    served: list[dict] = []
    connection.handler = served.append

    def arrive_between_the_pop_and_the_check():
        if not connection._inbound and not served:
            connection._inbound.append(
                {"method": "session/update", "params": {"text": "LAST WORDS"}}
            )
        return True

    connection._done.is_set = arrive_between_the_pop_and_the_check

    with pytest.raises(acp.AcpError, match="exited before replying"):
        connection._await(1)

    assert served, (
        "the agent's last message was dropped because it arrived while the "
        "client was deciding the agent had gone"
    )


# --- §11: the contained session ---------------------------------------------


def fake_established():
    """An `Established` with no holder — the `--network none` shape, which is
    the one that needs no runtime to reason about."""
    return containment.Established(
        runtime_path="/bin/podman", holder_cid=None, resolved=(),
    )


def contained_settings():
    parsed = config.parse(
        {
            "version": 1,
            "gates": [{"id": "unit", "run": "true"}],
            "run": {
                "worker": {"acp": {"command": "some-agent"}},
                "containment": {
                    "runtime": "podman",
                    "image": "example/agent:tag",
                    "egress": {"policy": "none"},
                },
            },
        }
    )
    assert parsed.run is not None and parsed.run.containment is not None
    return parsed.run.containment


def run_contained(tmp_path, monkeypatch, behaviour, **kwargs):
    """Drive a REAL ACP session that believes it is contained.

    `session_argv` is replaced by one that runs the agent directly, and that
    substitution is the whole point rather than a shortcut: it removes the
    container and leaves every other consequence of containment in place — the
    translated cwd and the translated inbound paths — so these tests measure
    the protocol behaviour on a machine with no runtime. What the argv itself
    contains is asserted exhaustively in `test_containment.py`, where it is a
    pure function.
    """
    captured: dict = {}
    # Bound BEFORE the patch: calling through the module name afterwards would
    # reach the replacement and recurse.
    real_session_argv = containment.session_argv

    def fake_session_argv(settings, established, command, args, root, workdir,
                          passthrough=()):
        captured["argv"] = real_session_argv(
            settings, established, command, args, root, workdir, passthrough
        )
        return [command, *args]

    monkeypatch.setattr(acp.containment, "session_argv", fake_session_argv)

    turn, code = acp.run_turn(
        command=sys.executable,
        args=(str(AGENT), behaviour),
        env_passthrough=(),
        brief="fix it",
        root=tmp_path,
        timeout=30,
        stdout_path=tmp_path / "out.log",
        stderr_path=tmp_path / "err.log",
        containment_settings=contained_settings(),
        established=fake_established(),
        workdir=tmp_path,
        **kwargs,
    )
    return turn, code, captured


def test_a_contained_session_is_rooted_at_the_mount_not_a_host_path(
    tmp_path, monkeypatch
):
    """**The second translation site** (SPEC_CONTAIN_V0 §11 A-3), asserted over
    the wire rather than in a dict.

    `session/new` carries an absolute path, and inside the container the host
    path does not exist — so an untranslated cwd opens a session rooted at a
    directory that is not there. The agent reports back what it was actually
    sent, which is the only way to tell a translated field from a translated
    intention.
    """
    turn, _, _ = run_contained(tmp_path, monkeypatch, "cwd")
    said = " ".join(turn.updates)

    assert f"CWD {containment.WORKSPACE}" in said, said
    assert str(tmp_path) not in said, (
        "the agent was handed a host path it cannot open from inside the mount"
    )


def test_an_uncontained_session_is_still_rooted_at_the_real_tree(
    tmp_path, monkeypatch
):
    """The other direction, and it is the one that keeps this from being a
    regression for every repository that declares no containment: with no
    containment the cwd is the tree, byte for byte as before."""
    turn, _ = acp.run_turn(
        command=sys.executable,
        args=(str(AGENT), "cwd"),
        env_passthrough=(),
        brief="fix it",
        root=tmp_path,
        timeout=30,
        stdout_path=tmp_path / "out.log",
        stderr_path=tmp_path / "err.log",
    )
    said = " ".join(turn.updates)
    assert f"CWD {tmp_path}" in said, said
    assert containment.WORKSPACE not in said


def test_a_contained_agent_may_name_the_path_it_can_see(tmp_path, monkeypatch):
    """**Inbound translation** (§11 A-4). The agent sees /workspace, so that is
    what it names — and untranslated the write is refused, which fails closed
    in the right direction and the wrong answer."""
    (tmp_path / "calc.py").write_text("BROKEN\n", encoding="utf-8")

    turn, _, _ = run_contained(tmp_path, monkeypatch, "containedwrite")

    assert (tmp_path / "calc.py").read_text(encoding="utf-8") == "FIXED\n"
    assert turn.refusals == [], turn.refusals
    assert "contained write refused: False" in " ".join(turn.updates)


def test_containment_never_widens_what_an_agent_may_reach(tmp_path, monkeypatch):
    """Translation runs BEFORE the resolve, so confinement is byte for byte
    what it was. An escape is still an escape — asserted under containment
    specifically, because that is the configuration where a translation bug
    would hand the agent the whole filesystem."""
    (tmp_path / "calc.py").write_text("BROKEN\n", encoding="utf-8")

    turn, _, _ = run_contained(tmp_path, monkeypatch, "escape")

    assert turn.refusals, "a contained agent escaped the repository"
    assert not (tmp_path.parent / "escaped.txt").exists()


def test_the_contained_spawn_is_the_runtime_and_keeps_stdin(
    tmp_path, monkeypatch
):
    """The argv the session would really have spawned, captured on the way
    past: the runtime, the mount, and `--interactive` so the JSON-RPC session
    survives its first write."""
    _, _, captured = run_contained(tmp_path, monkeypatch, "cwd")
    argv = captured["argv"]

    assert argv[0] == "podman" and argv[1] == "run"
    assert "--interactive" in argv
    assert "--tty" not in argv
    assert "--workdir" in argv and containment.WORKSPACE in argv
    assert argv[-2:] == [str(AGENT), "cwd"]


# ---------------------------------------------------------------------------
# SPEC_ACPAUTH_V0 — the auth handshake, driven over the wire.
#
# The fixture is `tests/fake_acp_agent.py kimiauth`, whose `initialize` reply
# is copied verbatim from `kimi-code acp` (`docs/acp-auth-2026-08-24.md`),
# `_meta.terminal-auth` block included. Asserting on it is asserting on a
# shape a real agent produced.
# ---------------------------------------------------------------------------


def test_A_REFUSED_SESSION_SAYS_WHAT_THE_AGENT_ACCEPTS(tmp_path):
    """**The whole product value of the handshake, driven end to end.**

    Before this, a refused session read `session/new was refused:
    Authentication required` and the operator went and found out what that
    agent wanted. Now the agent's own words arrive with the refusal.
    """
    stdout, stderr = tmp_path / "o.log", tmp_path / "e.log"

    with pytest.raises(acp.AcpError) as raised:
        acp.run_turn(
            command=sys.executable,
            args=(str(AGENT), "kimiauth"),
            env_passthrough=(),
            brief="do the thing",
            root=tmp_path,
            timeout=30,
            stdout_path=stdout,
            stderr_path=stderr,
        )

    said = str(raised.value)
    assert "Authentication required" in said, said
    assert "Login with Kimi account" in said, (
        f"the refusal does not name the method the agent advertised: {said}"
    )
    assert "kimi login" in said, (
        "the agent's own instruction did not reach the operator"
    )
    assert "run this yourself, once: /usr/bin/false login" in said, (
        "the command the agent supplied is not shown for the person to run. "
        "The double sends the command ONLY in the `initialize` reply — its "
        "refusal copy is flattened and command-less, exactly as `kimi-code "
        "acp` measured — so this line arriving proves the client MERGED the "
        "two lists rather than rendering the refusal's thinner one"
    )
    assert "does not run any of these for you" in said


def test_WRINGER_NEVER_RUNS_THE_COMMAND_THE_AGENT_SUPPLIED(tmp_path, monkeypatch):
    """**The consent boundary, and the reason this spec was written first.**

    `_meta.terminal-auth` hands the CLIENT a `command` and `args`. Running
    them would be arbitrary argv, chosen by an untrusted party, executed on the
    operator's machine — and it would be Wringer logging somebody into their
    own account, which `worker_auth.refusal` already forbids in print.

    Driven rather than read: every process spawn in the module is recorded,
    and the agent's command must not be among them.
    """
    spawned: list = []
    real = subprocess.Popen

    def watched(argv, *args, **kwargs):
        spawned.append(argv)
        return real(argv, *args, **kwargs)

    monkeypatch.setattr(subprocess, "Popen", watched)

    with pytest.raises(acp.AcpError):
        acp.run_turn(
            command=sys.executable,
            args=(str(AGENT), "kimiauth"),
            env_passthrough=(),
            brief="do the thing",
            root=tmp_path,
            timeout=30,
            stdout_path=tmp_path / "o.log",
            stderr_path=tmp_path / "e.log",
        )

    flat = " ".join(" ".join(map(str, argv)) for argv in spawned)
    assert "/usr/bin/false" not in flat, (
        f"Wringer ran the command the AGENT supplied: {spawned}"
    )
    assert spawned, "nothing was spawned at all, so this proves nothing"


def test_AN_AGENT_OFFERING_NOTHING_GETS_AN_HONEST_SENTENCE():
    """Two of three measured agents advertise no method. The refusal must not
    pretend there is something to do."""
    said = acp.authentication_wanted(acp.Turn(), "refused: nope")
    assert "advertised no way to authenticate" in said
    assert "run this yourself" not in said


def test_INTERACTIVE_IS_DERIVED_FROM_THE_SHAPE_NOT_A_VENDOR_NAME():
    """Derivation A1. A hand-kept list of vendor ids would be the
    roster-of-special-cases this slice exists to avoid — so the test uses ids
    and names no real agent has."""
    assert acp.interactive({"id": "x", "_meta": {"terminal-auth": {"command": "c"}}})
    assert acp.interactive({"id": "x", "_meta": {"command": {"command": "c"}}})
    assert not acp.interactive({"id": "x"})
    assert not acp.interactive({"id": "x", "_meta": {"docs": "https://e.invalid"}})
    assert not acp.interactive({"id": "x", "_meta": "not-a-dict"})


def test_THE_HANDSHAKE_RECORDS_WHAT_WAS_OFFERED_AND_CLAIMS_NOTHING_MORE(tmp_path):
    """**Ruling 2, structurally.** `authenticate` is never called, because a
    successful one proves nothing — measured on two vendors. So there is no
    field anywhere saying the worker is authenticated, and there must not be
    one: the evidence is the session opening, and when it does not open the
    turn fails."""
    body = Path(acp.__file__).read_text(encoding="utf-8")
    assert '"authenticate"' not in body, (
        "acp.py now calls `authenticate`. SPEC_ACPAUTH_V0 §3 forbids trusting "
        "its answer, and nothing in the census offers a method worth calling "
        "it for — if that changed, the spec changes first"
    )
    for inventing in ("authenticated = True", '"authenticated"'):
        assert inventing not in body, (
            f"acp.py records {inventing!r} — a claim only the next call can "
            "support"
        )


def test_THE_TWO_METHOD_LISTS_ARE_NOT_THE_SAME_LIST():
    """**Measured on ONE agent in ONE exchange, and it changed the design.**

    `kimi-code acp` sends `_meta.terminal-auth` with a `command` at
    `initialize`, and the copy inside its `session/new` refusal is FLATTENED
    (`type`, `args`, `env` on the method itself) and carries no `command` at
    all. So the refusal says WHICH method is wanted and the handshake says what
    running it would take — and an operator needs both. Rendering from the
    refusal alone loses the command; rendering from the handshake alone would
    show methods the refusal never asked for.
    """
    advertised = [{
        "id": "login", "name": "Login with Kimi account",
        "_meta": {"terminal-auth": {"command": "/bin/kimi-code",
                                    "args": ["login"]}},
    }]
    # The refusal's shape, verbatim from the measurement: no `_meta`, no
    # `command`, and the block flattened onto the method.
    refused = [{
        "id": "login", "name": "Login with Kimi account",
        "type": "terminal", "args": ["login"], "env": {},
    }]

    merged = acp.richest(advertised, refused)

    assert len(merged) == 1
    assert acp.runnable_block(merged[0]).get("command") == "/bin/kimi-code", (
        "the command the handshake carried was lost when the refusal's thinner "
        "copy replaced it"
    )
    said = acp.authentication_wanted(
        acp.Turn(auth_methods=merged), "refused: Authentication required"
    )
    assert "run this yourself, once: /bin/kimi-code login" in said


def test_THE_FLATTENED_SHAPE_IS_RECOGNISED_ON_ITS_OWN():
    """An agent that only ever sends the flattened form must still be read.
    The first version of `interactive()` looked only under `_meta`, which
    would have gone quiet on exactly the reply Kimi's refusal carries."""
    flattened = {"id": "login", "type": "terminal", "args": ["login"]}
    assert acp.interactive(flattened)
    assert acp.runnable_block(flattened)["args"] == ["login"]
    assert not acp.interactive({"id": "api-key", "name": "Paste a key"})


def test_A_METHOD_THE_HANDSHAKE_NEVER_MENTIONED_IS_STILL_SHOWN():
    """`richest` merges; it does not filter. An agent that names a method only
    in its refusal must not be silently dropped — that would be Wringer
    deciding which of the agent's answers the operator may see."""
    merged = acp.richest([], [{"id": "sso", "name": "Company SSO"}])
    assert [m["id"] for m in merged] == ["sso"]
