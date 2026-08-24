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

    known = agents.by_command(worker.command)
    if known is None or not known.auth_probe:
        named = known.id if known is not None else worker.command
        return WorkerAuth(
            UNKNOWN,
            f"no way to ask {named!r} whether it is logged in is known here",
        )

    if shutil.which(worker.command) is None:
        # `loop.missing_agent` owns this and says it far better. Two checks
        # failing over one absent binary tells a reader nothing the first did
        # not.
        return WorkerAuth(UNKNOWN, f"{worker.command!r} is not on PATH")

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
    """What to print instead of spending. The two routes, and the limit.

    Both routes are the person's act. Wringer never installs an agent and it
    does not log one in either — and the second is the stronger rule of the
    two, because a login is somebody's account.
    """
    command = getattr(worker, "command", "the coding agent")
    known = agents.by_command(command)
    key = known.key_env if known is not None else "the agent's API key variable"
    return (
        f"{found.detail}, so the build step would fail after the drafting "
        f"call had already been paid for.\n\n"
        f"Two ways to give it a credential, both yours to choose:\n"
        f"  - log the agent in once: {command} --cli auth login\n"
        f"  - or declare {key} under 'run.worker.acp.env_passthrough' in "
        f"{config.CONFIG_FILENAME}, which spends against that key on every "
        f"worker turn\n\n"
        f"This check reads what the agent says about itself and cannot tell "
        f"whether a credential still works: a revoked key and a lapsed "
        f"subscription both report being logged in. Nothing has been created."
    )
