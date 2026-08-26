"""Is the coding agent logged in? Asked for free, before anything is spent.

**Why this module exists.** On 2026-08-21 and again on 2026-08-22 a product
manager reached the build step with a coding agent that was installed and had
never been logged in. Both runs paid for drafting first and discovered the
wall afterwards. `loop.missing_agent` already refuses when the binary is not
on `PATH`; this is the next question along, and until now nothing asked it.

**Why it can be asked at all.** `docs/MANUAL_CHECKS.md` sequence L proved that
the ACP handshake cannot see auth: `initialize` advertises `authMethods` based
on client capabilities and a CLI flag, never on login state, so every probe
below `session/prompt` returns the same bytes signed in or signed out. That
finding stands and it is about ACP. It says nothing about the agent's OWN
command line, which is not ACP — and that is the surface this reads.

**The preflight ladder, and its third measured rung (recorded 2026-08-24).** Agents do
not all hide their credential state in the same place, and the census now has
three shapes, each measured on a real binary rather than reasoned from a
protocol:

- **startup-refusal** — `docs/dcode-capture-2026-08-23.md`. Free and instant:
  the process exits 1 before any protocol exchange, naming on stderr the
  variables it would have taken.
- **`session/new`-refusal** — `docs/bench-vendors-2026-08-22.md`. Free: the
  handshake opens, and the session request is the refusal.
- **prompt-only** — `docs/auth-probe-2026-08-22.md`. The paid turn and
  nothing below it: every step under `session/prompt` returns the same bytes
  signed in or signed out, which is what sequence L measured.

**No agent is named here, deliberately** — AGENTS.md rule 5 keeps every
coding-agent string in `agents.py`, and the captures above carry the names.

**The ladder is a fact about the census, not a mechanism this module has.**
What runs below is the agent's OWN command line (`agents.Agent.auth_probe`),
a fourth surface again and the only one wired. An agent on the roster with no
`auth_probe` reports `UNKNOWN` and refuses nothing — the honest default.
Turning the startup rung into a check would mean spawning the agent and
reading an exit code and a sentence, which is a different mechanism from
parsing `loggedIn`, and inventing it here from one binary's behaviour is how
the last false auth sentence in this repository got written. It is named, not
built.

**What it is not.** Presence is not validity. A revoked key and a lapsed
subscription both answer `loggedIn: true` and both die at the turn. This
module can turn a wasted run into a refusal; it cannot promise a turn will
succeed, and every message it produces says so.

**Why the environment matters.** A worker does not inherit Wringer's
environment — it gets `PATH`, `HOME`, `LANG`, and whatever
`run.worker.acp.env_passthrough` declares. So the question is asked in
`acp.worker_env`, the same function `acp.run_turn` builds the real turn's
environment with. Asking in Wringer's own environment instead would report on
a process that never runs: a key visible here and not declared across would
read as a green the worker cannot use.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass

from wringer import acp, agents, config

#: Generous, because the first call of the Claude adapter's wrapped CLI
#: extracts a bundled binary before it answers. Slow-and-free still beats
#: fast-and-paid, and the ceiling only bites when something is wrong.
TIMEOUT = 90.0

LOGGED_IN = "logged_in"
LOGGED_OUT = "logged_out"
UNKNOWN = "unknown"


@dataclass(frozen=True)
class WorkerAuth:
    """What the agent said about itself, and how much of it to believe."""

    state: str
    detail: str
    #: How the agent says it is authenticated (`api_key`, a subscription, …).
    #: Only ever set alongside `LOGGED_IN`, and only ever reported, never
    #: acted on.
    method: str = ""

    @property
    def will_fail(self) -> bool:
        """Only a definite NO blocks. `UNKNOWN` never does.

        An agent whose auth surface nobody has measured must not be refused
        for that: this check would then be a gate on Wringer's knowledge of a
        vendor rather than on the run. `LOGGED_OUT` is the one answer that
        earns a stop, and it is the agent's own word for it.
        """
        return self.state == LOGGED_OUT


#: The free handshake's own ceiling. Measured at 1.4-2.8s across three agents
#: (`docs/acp-auth-2026-08-24.md`), so this is generous by an order of
#: magnitude — and an expiry here is UNKNOWN, never a refusal, so being
#: generous costs a slow run seconds and costs a wrong answer nothing.
HANDSHAKE_TIMEOUT = 30


def _handshake_rung(worker: config.AcpWorker) -> WorkerAuth:
    """R2.2's free rung: does the agent refuse the SESSION?

    **The whole of this function's authority is one fact**: the agent's own
    `session/new` error carrying `authMethods`. That is the agent saying, in
    its own reply, that it will not work until somebody signs it in — and
    `docs/specs/SPEC_ACPAUTH_V0.md` §3 is why nothing weaker counts.

    Everything else is `UNKNOWN`, including a session that OPENS: measured,
    the agent measured in `docs/auth-probe-2026-08-22.md` opens one whether or
    not it is signed in, so an opened session is not evidence of anything and
    must never read as `LOGGED_IN`.

    **The spawn is `acp`'s, not a second one.** A separate implementation of
    the wire here would be a second thing to keep in step with the client that
    does the real turn, and the first divergence would be a preflight
    answering about a handshake nothing performs.
    """
    import subprocess as _subprocess

    env = acp.worker_env(worker.env_passthrough)
    try:
        proc = _subprocess.Popen(
            [worker.command, *worker.args],
            env=env,
            stdin=_subprocess.PIPE,
            stdout=_subprocess.PIPE,
            stderr=_subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError as exc:
        return WorkerAuth(UNKNOWN, f"{worker.command!r} did not start: {exc}")

    import time as _time

    try:
        connection = acp.Connection(
            proc, deadline=_time.monotonic() + HANDSHAKE_TIMEOUT
        )
        connection.send_request(
            "initialize",
            {
                "protocolVersion": acp.PROTOCOL_VERSION,
                "clientCapabilities": acp.CLIENT_CAPABILITIES,
                "clientInfo": {"name": "wringer-preflight", "version": ""},
            },
        )
        connection.send_request(
            "session/new", {"cwd": ".", "mcpServers": []}
        )
    except acp.AcpError as refused:
        offered = ((refused.error or {}).get("data") or {}).get("authMethods")
        if isinstance(offered, list) and offered:
            return WorkerAuth(
                LOGGED_OUT,
                f"{worker.command} refused to open a session: {refused}",
            )
        # A refusal that names no method is a refusal about something else —
        # a malformed request, a bad cwd, an agent that fell over. Routing on
        # the message text instead would be the hint-tier guessing
        # `diagnose.py` forbids.
        return WorkerAuth(
            UNKNOWN, f"{worker.command!r} could not be asked: {refused}"
        )
    except Exception as exc:  # noqa: BLE001 - a preflight may never raise
        return WorkerAuth(UNKNOWN, f"{worker.command!r} could not be asked: {exc}")
    finally:
        acp._stop(proc, HANDSHAKE_TIMEOUT)

    # A session opened. That is NOT evidence of authentication — measured.
    return WorkerAuth(
        UNKNOWN,
        f"{worker.command} opened a session, which does not say whether it "
        "is signed in",
    )


def read(worker: object, containment_settings: object = None) -> WorkerAuth:
    """Ask the declared ACP worker whether it is logged in.

    Every path that cannot produce a trustworthy answer returns `UNKNOWN` with
    the reason in `detail`, because the alternative — inferring "logged out"
    from a timeout, a missing binary, or an agent this repository has never
    measured — is exactly the reasoning that produced a false sentence about
    this adapter on 2026-08-22.
    """
    if not isinstance(worker, config.AcpWorker):
        return WorkerAuth(UNKNOWN, "the worker is not an ACP agent")

    if containment_settings is not None:
        # Under a containment the agent runs INSIDE the boundary, on an image
        # this process cannot interrogate. Asking the copy on this machine
        # would answer confidently about a program that is not the one the
        # turn will use — and a credential store is precisely the kind of
        # thing a boundary is built to keep out.
        return WorkerAuth(
            UNKNOWN,
            "the worker runs inside a containment, and this check can only "
            "ask the agent on this machine",
        )

    if shutil.which(worker.command) is None:
        # `loop.missing_agent` owns this and says it far better. Two checks
        # failing over one absent binary tells a reader nothing the first did
        # not. Hoisted above the rungs below, because BOTH of them would
        # otherwise spawn a binary that is not there.
        return WorkerAuth(UNKNOWN, f"{worker.command!r} is not on PATH")

    known = agents.by_command(worker.command)
    if known is None or not known.auth_probe:
        # **The SECOND rung, and the one that makes R2.2's ladder pay.**
        # Before this, an agent with no known CLI probe returned UNKNOWN and
        # the run went on to spend. But some agents refuse the SESSION — auth
        # visible two calls below the paid turn, for free — and that is a
        # definite answer nobody was asking for. Measured on `kimi-code acp`:
        # `session/new` refuses with `Authentication required` carrying its
        # `authMethods`, in 1.4 seconds.
        #
        # It is tried SECOND, not first, because the agent's own command line
        # is the more authoritative surface where it exists: the agent in
        # `docs/auth-probe-2026-08-22.md` opens a session whether or not it is
        # signed in (measured), so the handshake would report UNKNOWN about an
        # agent whose own command line answers exactly. AGENTS.md rule 5 keeps
        # the name in `agents.py`; the capture carries it.
        return _handshake_rung(worker)

    env = acp.worker_env(worker.env_passthrough)
    try:
        proc = subprocess.run(
            [worker.command, *known.auth_probe],
            capture_output=True, text=True, timeout=TIMEOUT, env=env,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return WorkerAuth(UNKNOWN, f"asking {worker.command!r} did not finish: {exc}")

    try:
        answer = json.loads(proc.stdout)
    except (json.JSONDecodeError, TypeError):
        return WorkerAuth(
            UNKNOWN,
            f"{worker.command!r} did not answer in the shape this check reads",
        )
    if not isinstance(answer, dict) or "loggedIn" not in answer:
        return WorkerAuth(
            UNKNOWN,
            f"{worker.command!r} did not answer in the shape this check reads",
        )

    if answer.get("loggedIn") is True:
        method = str(answer.get("authMethod") or "")
        return WorkerAuth(LOGGED_IN, f"{worker.command} is logged in", method)
    return WorkerAuth(LOGGED_OUT, f"{worker.command} reports it is not logged in")


def refusal(worker: object, found: WorkerAuth) -> str:
    """What to print instead of spending. The routes THIS MACHINE has, and the
    limit.

    Both routes are the person's act. Wringer never installs an agent and it
    does not log one in either — and the second is the stronger rule of the
    two, because a login is somebody's account.

    **It is machine-aware, and that is field report 2026-08-26 finding 1's
    second consequence — the one that made things worse.** This message used
    to offer both routes unconditionally. On an org-pinned Mac the operator
    had already done the login, so the only apparently-untried route was the
    key — and on that class of machine the key IS the refusal: with it in the
    worker's environment `session/new` is rejected, without it the session
    opens. The stop sent a person to do the exact thing every other page in
    this repository warns them off, at the moment they were most likely to
    act on it.

    So on a machine carrying a coding-agent policy file the key route is not
    offered as a bullet beside the login one. It is still NAMED, because a
    reader who has already declared one needs to be told to remove it — what
    it stops being is an option.

    **The question is a `stat`, asked through `agents.py`**, which is where
    `wring doctor`'s `managed settings` line asks it too. Nothing opens the
    file: presence is the whole of the fact, and the sentence says "if it
    pins" rather than claiming to know. Absence takes the other branch, where
    both routes are offered exactly as before — because absence is one path
    checked, never proof that a machine is unmanaged.
    """
    command = getattr(worker, "command", "the coding agent")
    known = agents.by_command(command)
    key = known.key_env if known is not None else "the agent's API key variable"
    limit = (
        "This check reads what the agent says about itself and cannot tell "
        "whether a credential still works: a revoked key and a lapsed "
        "subscription both report being logged in. Nothing has been created."
    )
    policy = agents.managed_policy_file()
    if policy is not None:
        return (
            f"{found.detail}, so the build step would fail after the drafting "
            f"call had already been paid for.\n\n"
            f"This machine has a coding-agent policy file at {policy}. If it "
            f"pins the builder to an organisation login — which is what such "
            f"a file usually does — then there is ONE route here, and it is "
            f"not the key:\n"
            f"  - log the agent in once: {command} --cli auth login\n\n"
            f"Declaring {key} under 'run.worker.acp.env_passthrough' is "
            f"REFUSED on a pinned machine: with the key in the worker's "
            f"environment the agent's session request is rejected, and "
            f"without it the session opens. If one is already declared "
            f"in {config.CONFIG_FILENAME}, REMOVE it — that is the fix, not "
            f"the remedy.\n\n"
            f"{limit}"
        )
    return (
        f"{found.detail}, so the build step would fail after the drafting "
        f"call had already been paid for.\n\n"
        f"Two ways to give it a credential, both yours to choose:\n"
        f"  - log the agent in once: {command} --cli auth login\n"
        f"  - or declare {key} under 'run.worker.acp.env_passthrough' in "
        f"{config.CONFIG_FILENAME}, which spends against that key on every "
        f"worker turn\n\n"
        f"{limit}"
    )
