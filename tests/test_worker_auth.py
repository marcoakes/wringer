"""The free question, asked before the money: is the coding agent logged in?

Two product managers reached the build step with an agent that was installed
and had never been logged in, and both had already paid for drafting. The ACP
handshake cannot see that — `docs/MANUAL_CHECKS.md` sequence L, and it is
true. The agent's own command line can, and nothing had looked.

These tests stand up a real executable named after the real agent and put it
on `PATH`, rather than patching `subprocess`. What is under test is whether
Wringer runs the right argv, in the right environment, and believes the right
amount of what comes back — and a patched `subprocess.run` would answer none
of those.
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import sys
from pathlib import Path

import pytest

from wringer import agents, config, loop, worker_auth

# The one agent whose auth surface has actually been measured. Read from the
# table rather than typed, so an entry that moves takes these tests with it.
CLAUDE = agents.find("claude-code")

# Both captured at import, because `on_path` below makes `PATH` a single
# directory containing one fake agent — which is the point of it, and which
# leaves the tests no way to find a real `git` afterwards. `wring doctor` runs
# `git` itself, so the one test that goes through doctor puts the real `PATH`
# back underneath the fake directory rather than replacing it.
GIT = shutil.which("git")
SYSTEM_PATH = os.environ.get("PATH", "")


def fake_agent(directory: Path, body: str, name: str = CLAUDE.command) -> Path:
    """An executable of the real agent's name that prints what we tell it."""
    path = directory / name
    path.write_text(f"#!{sys.executable}\n{body}\n", encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return path


def answering(payload: dict) -> str:
    return f"import json\nprint(json.dumps({payload!r}))"


def acp_worker(**kwargs) -> config.AcpWorker:
    return config.AcpWorker(command=CLAUDE.command, **kwargs)


@pytest.fixture
def on_path(tmp_path, monkeypatch):
    """A directory that is the whole of `PATH` for the duration."""
    binaries = tmp_path / "bin"
    binaries.mkdir()
    monkeypatch.setenv("PATH", str(binaries))
    return binaries


# --- what it believes ------------------------------------------------------


def test_a_signed_out_agent_is_the_one_answer_that_REFUSES(on_path):
    fake_agent(on_path, answering({"loggedIn": False, "authMethod": "none"}))

    found = worker_auth.read(acp_worker())

    assert found.state == worker_auth.LOGGED_OUT
    assert found.will_fail


def test_a_signed_in_agent_passes_and_its_METHOD_is_reported(on_path):
    fake_agent(
        on_path,
        answering({"loggedIn": True, "authMethod": "api_key"}),
    )

    found = worker_auth.read(acp_worker())

    assert found.state == worker_auth.LOGGED_IN
    assert not found.will_fail
    assert found.method == "api_key"


def test_the_probe_asks_the_agents_OWN_argv_not_an_invented_one(on_path):
    """`auth_probe` is data in `agents.py`, and this is what runs it.

    An agent that gets an argv Wringer guessed could do anything at all. The
    fake records what it was actually asked so the assertion is about the
    real call rather than about the table being read.
    """
    record = on_path / "asked.json"
    fake_agent(
        on_path,
        "import json, sys\n"
        f"open({str(record)!r}, 'w').write(json.dumps(sys.argv[1:]))\n"
        "print(json.dumps({'loggedIn': True}))",
    )

    worker_auth.read(acp_worker())

    assert json.loads(record.read_text()) == list(CLAUDE.auth_probe)


# --- every way of not knowing, none of which may refuse --------------------


def test_an_agent_nobody_here_has_MEASURED_is_unknown_and_does_not_refuse():
    """`gemini` has no `auth_probe`, on purpose. Inventing one is how the last
    auth sentence in this repository came to be false."""
    gemini = agents.find("gemini")
    assert gemini.auth_probe == (), (
        "an agent gained an auth probe. If its surface was really measured, "
        "say where — this assertion is the record that it was not guessed"
    )

    found = worker_auth.read(config.AcpWorker(command=gemini.command))

    assert found.state == worker_auth.UNKNOWN
    assert not found.will_fail


def test_an_agent_not_on_PATH_is_unknown_because_another_check_owns_it(on_path):
    found = worker_auth.read(acp_worker())

    assert found.state == worker_auth.UNKNOWN
    assert "PATH" in found.detail
    assert not found.will_fail


def test_a_CONTAINED_worker_is_unknown_because_we_would_ask_the_wrong_copy(
    on_path,
):
    """The agent inside the boundary is not the one on this machine, and a
    credential store is exactly what a boundary keeps out. Answering here
    would be confident about a program that never runs."""
    fake_agent(on_path, answering({"loggedIn": True}))

    found = worker_auth.read(acp_worker(), containment_settings=object())

    assert found.state == worker_auth.UNKNOWN
    assert "containment" in found.detail
    assert not found.will_fail


@pytest.mark.parametrize(
    "body",
    [
        "print('not json at all')",
        "print('[]')",
        "print(__import__('json').dumps({'authMethod': 'none'}))",
        "import sys; sys.exit(3)",
    ],
    ids=["not-json", "wrong-type", "no-loggedIn-key", "exits-nonzero"],
)
def test_an_answer_this_check_cannot_READ_is_unknown_never_a_refusal(
    on_path, body
):
    """A vendor that changes its output shape must not start refusing runs.

    This is the failure mode the whole module is shaped around: on 2026-08-22
    this repository concluded "it does not work" from evidence that did not
    say so, and shipped it. An unreadable answer means unknown.
    """
    fake_agent(on_path, body)

    found = worker_auth.read(acp_worker())

    assert found.state == worker_auth.UNKNOWN
    assert not found.will_fail


def test_a_shell_worker_is_not_asked_at_all():
    found = worker_auth.read("make build")

    assert found.state == worker_auth.UNKNOWN
    assert not found.will_fail


# --- the environment it asks in --------------------------------------------


def test_the_question_is_asked_in_the_WORKERS_environment_not_WRINGERS(
    on_path, monkeypatch
):
    """The defect this prevents is a green nobody can use.

    A worker gets `PATH`, `HOME`, `LANG` and whatever `env_passthrough`
    declares — nothing else. If the check asked in Wringer's own environment,
    a key set in this shell and NOT declared across would make a signed-out
    worker report as signed in, and the run would fail at the turn with the
    preflight's blessing.
    """
    monkeypatch.setenv(CLAUDE.key_env, "sk-not-declared-across")
    fake_agent(
        on_path,
        "import json, os\n"
        f"print(json.dumps({{'loggedIn': {CLAUDE.key_env!r} in os.environ}}))",
    )

    undeclared = worker_auth.read(acp_worker())
    declared = worker_auth.read(acp_worker(env_passthrough=(CLAUDE.key_env,)))

    assert undeclared.state == worker_auth.LOGGED_OUT, (
        "a variable Wringer can see but the worker was never given made the "
        "preflight green"
    )
    assert declared.state == worker_auth.LOGGED_IN


def test_the_environment_is_the_one_the_TURN_builds_not_a_second_copy():
    """Derived, so the two cannot drift apart.

    `acp.run_turn` and this check must agree about what a worker is handed.
    They agree by calling one function; this asserts that is still how, rather
    than asserting the three names again in a third place.
    """
    import inspect

    from wringer import acp

    source = inspect.getsource(acp.run_turn)
    assert "worker_env(" in source, (
        "run_turn no longer builds its environment through acp.worker_env, so "
        "the preflight is now predicting an environment nothing runs in"
    )
    assert "worker_env(" in inspect.getsource(worker_auth.read)


# --- what the person is told -----------------------------------------------


def test_the_refusal_names_BOTH_routes_and_says_what_the_key_one_costs():
    worker = acp_worker()
    message = worker_auth.refusal(
        worker, worker_auth.WorkerAuth(worker_auth.LOGGED_OUT, "signed out")
    )

    assert "auth login" in message, "the refusal does not name the login route"
    assert CLAUDE.key_env in message, "the refusal does not name the key route"
    assert "spends against that key" in message, (
        "the key route is offered without saying every worker turn bills to "
        "it — an unstated cost is how the last two versions of this advice "
        "went wrong"
    )
    assert "Nothing has been created" in message


def test_the_refusal_states_the_limit_of_what_it_CHECKED():
    """Presence is not validity, and a check sold as proof is worse than none."""
    worker = acp_worker()
    message = worker_auth.refusal(
        worker, worker_auth.WorkerAuth(worker_auth.LOGGED_OUT, "signed out")
    )

    assert "revoked" in message and "lapsed" in message


# --- and that it actually stops a run --------------------------------------


def test_the_loop_REFUSES_a_signed_out_agent_before_it_starts(on_path):
    fake_agent(on_path, answering({"loggedIn": False}))
    settings = config.Run(worker=acp_worker())

    message = loop.unauthenticated_agent(settings)

    assert message is not None
    assert "auth login" in message


def test_the_loop_starts_normally_for_every_UNKNOWN(on_path):
    """Wringer's ignorance of a vendor may not cost anybody a run."""
    fake_agent(on_path, "print('who knows')")
    settings = config.Run(worker=acp_worker())

    assert loop.unauthenticated_agent(settings) is None


def test_the_loop_asks_nothing_of_a_shell_worker():
    assert loop.unauthenticated_agent(config.Run(worker="make build")) is None


def test_both_front_doors_ask_the_SAME_question(on_path):
    """`wring run` and the drive must not disagree about whether a run can
    start — SPEC_DRIVE_V0 ruling 1, and the reason `require_worker` imports
    `missing_agent` rather than re-implementing a PATH check."""
    import inspect

    from wringer_drive import run as drive_run

    source = inspect.getsource(drive_run.require_worker)
    assert "loop.unauthenticated_agent" in source, (
        "the drive stopped asking the engine's question and now either asks "
        "its own or asks none"
    )


def test_doctor_reports_it_where_a_person_looks_FIRST(tmp_path, on_path, monkeypatch):
    import subprocess

    from wringer import doctor

    assert "worker auth" in doctor.check_names()

    # A real repository, because this check is repo-scoped: it reads
    # `.wringer.yaml`, exactly like `gates` and `runnable checks` do — and a
    # real `PATH` underneath the fake agent, because doctor shells out to git.
    # The fake still wins: it is first.
    subprocess.run([GIT, "init", "-q"], cwd=tmp_path, check=True)
    monkeypatch.setenv("PATH", f"{on_path}{os.pathsep}{SYSTEM_PATH}")
    fake_agent(on_path, answering({"loggedIn": False}))
    (tmp_path / config.CONFIG_FILENAME).write_text(
        "version: 1\n"
        "gates:\n"
        "  - id: t\n"
        '    run: "true"\n'
        "run:\n"
        f"  worker:\n    acp:\n      command: {CLAUDE.command}\n",
        encoding="utf-8",
    )

    found = next(
        check for check in doctor.run_checks(tmp_path) if check.name == "worker auth"
    )

    assert found.status == doctor.WARN, (
        "doctor either missed a signed-out agent or made it blocking. It "
        "warns: its exit code gates setup scripts, and a signed-out agent is "
        "a true problem for `wring run` and for nothing else here"
    )
    assert found.passed, "a warning must not change doctor's exit code"


def test_doctor_says_which_checks_it_SKIPPED_outside_a_repository(tmp_path):
    """Skipped, and still LISTED. `wring doctor` in a directory that is not a
    repository answers about the machine, and a check that silently vanishes
    is how `check_names` and `run_checks` drift apart."""
    from wringer import doctor

    names = [check.name for check in doctor.run_checks(tmp_path)]

    assert "worker auth" in names, (
        "doctor's own name list promises this check and running it produced "
        "no row for it — the list and the run have drifted"
    )


def test_the_environment_carries_nothing_it_was_not_given(monkeypatch):
    """`acp.worker_env` itself, since the preflight now depends on it."""
    from wringer import acp

    monkeypatch.setenv("A_SECRET", "value")
    monkeypatch.setenv("DECLARED", "value")

    env = acp.worker_env(("DECLARED",))

    assert set(env) == {"PATH", "HOME", "LANG", "DECLARED"}
    assert "A_SECRET" not in env
    assert os.environ["A_SECRET"] == "value", "the real environment was mutated"


# ---------------------------------------------------------------------------
# The preflight ladder's own instrument.
#
# `scripts/acp-auth-probe.py` is how a NEW agent's auth surface gets measured
# — it is what produced the kimi and dcode rungs — so it is the one script in
# this repository whose robustness is a property of the roster rather than of
# a convenience. It is not shipped in the wheel and cannot be imported by
# name, so it is loaded from the source tree the same way `test_docs.py`
# loads `roadmap_render`.
# ---------------------------------------------------------------------------


def _auth_probe_module():
    import importlib.util

    path = Path(__file__).resolve().parents[1] / "scripts" / "acp-auth-probe.py"
    spec = importlib.util.spec_from_file_location("acp_auth_probe", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_THE_PROBE_REPORTS_AN_AGENT_THAT_DIED_INSTEAD_OF_CRASHING():
    """**Measured 2026-08-23 against `dcode --acp` with no credential; fixed
    2026-08-24.**

    The agent exits 1 before any protocol exchange, so `initialize` went into
    a pipe with no reader and the probe raised `BrokenPipeError` out of
    `probe()` — a traceback where the measurement should have been. The
    instrument crashed on the most interesting case it has: an agent that
    refuses at startup is a FREE preflight rung, and the reason it refused is
    on its stderr.

    The fixture is a command that exits immediately, which is what a
    credential-less agent looks like from here. Reverting the fix makes this
    an ERROR rather than a failure, which is the point — an exception is not
    a verdict.
    """
    probe = _auth_probe_module()

    found = probe.probe(
        "sh -c 'echo Error: No credentials configured >&2; exit 1'",
        timeout=5.0,
    )

    assert found["agent_died_at"] in ("initialize", "session/new"), (
        f"the probe did not record where the agent went: {found!r}"
    )
    assert found["agent_exit_code"] == 1, (
        "the exit code is half the finding and the report drops it: "
        f"{found.get('agent_exit_code')!r}"
    )
    assert "No credentials configured" in found["stderr_tail"], (
        "the agent's OWN sentence names the fix, and this run threw it away "
        f"— stderr_tail was {found['stderr_tail']!r}. The drain thread is not "
        "joined before the tail is read"
    )


def test_A_HEALTHY_AGENTS_REPORT_DOES_NOT_GROW_THE_DEATH_LINES():
    """Every capture in `docs/` was printed by this script, and Law 8 keeps
    them. The death keys are appended only when there is a death, so an agent
    that answers prints exactly the bytes it printed before."""
    probe = _auth_probe_module()

    assert "agent_died_at" not in probe.HANDSHAKE_KEYS
    assert "agent_died_at" not in probe.PROMPT_KEYS
    assert probe.DEATH_KEYS == ("agent_died_at", "agent_exit_code")


def test_THE_PROBE_REPORTS_A_BINARY_THAT_IS_NOT_THERE():
    """**The probe's most likely failure, and it used to be a traceback.**

    Found by hunting on 2026-08-24, one fix after the `BrokenPipeError` one
    and in the same class. This script exists to measure agents nobody has
    measured yet — so "you typed the name wrong" and "you have not installed
    it" are the first two things that happen to it, and both raised
    `FileNotFoundError` out of `probe()` instead of answering.
    """
    probe = _auth_probe_module()

    found = probe.probe("definitely-not-a-real-binary-xyz", timeout=3.0)

    assert found["agent_died_at"] == "spawn", (
        f"an agent that never started was not reported as such: {found!r}"
    )
    assert found["agent_exit_code"] is None, (
        "a process that never existed cannot have an exit code, and reporting "
        "one would be inventing a fact"
    )
    assert "FileNotFoundError" in found["stderr_tail"], (
        "the report does not carry the operating system's own words, so "
        f"nobody can tell a typo from a missing install: {found['stderr_tail']!r}"
    )
