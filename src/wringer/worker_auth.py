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
environment — it gets `PATH`, `HOME`, `LANG`, `USER`, and whatever
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
#: The fourth state, added by the 0.6.0 worker contract: the question does
#: not apply as far as anything here has measured. A shell worker built from
#: a command no roster row covers has no login surface Wringer knows how to
#: ask — which is a different fact from a vendor whose probe could not
#: answer (`UNKNOWN`), and collapsing them is how a silence came to read as
#: a tick (run 3, F10).
NOT_APPLICABLE = "not_applicable"

#: How each state renders on the run path — the typed vocabulary the 0.6.0
#: contract names. One table, because the drive, `wring run` and `wring
#: doctor` may never disagree about what a state is called. "verified" means
#: exactly what `LOGGED_IN` means — the agent's own word was obtained and
#: says yes — and every sentence beside it still carries the ceiling: a
#: verified login is not a promise the credential still works.
STATE_WORDS = {
    LOGGED_IN: "verified",
    LOGGED_OUT: "rejected",
    UNKNOWN: "unknown",
    NOT_APPLICABLE: "not applicable",
}


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

    @property
    def word(self) -> str:
        """The state's rendered name — `STATE_WORDS`, with a belt for a state
        the table has not met, which is better shown raw than crashed on."""
        return STATE_WORDS.get(self.state, self.state)


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


def _name_the_bare_form(worker: config.AcpWorker, found: WorkerAuth) -> WorkerAuth:
    """Say when a shorter spelling of this command would have answered better.

    **The roster matches EXACTLY and keeps doing so.** `agents.by_command`
    refuses to match a substring or guess a package from a filename, and its
    docstring is right that anything else would be this module inventing a
    vendor string rather than holding one. A command declared as an absolute
    path, or wrapped, is therefore not on the roster whatever its filename is:
    the CLI probe that answers this question exactly never runs, and the
    weaker handshake rung reports `unknown`. (No agent is named in this
    sentence — AGENTS.md rule 5, and a guard in `tests/test_start.py` caught
    the first draft of it naming one.)

    What was wrong was the SILENCE around that. The reader was told a question
    could not be answered and not that a better answer was available for the
    price of a shorter string. So this appends the remedy — and only when the
    basename really is a roster entry, which makes it a second lookup in the
    same table rather than a guess about an unknown binary.

    Only ever on an `UNKNOWN`. A definite answer needs no apology, and a
    `LOGGED_OUT` from the handshake is the agent's own word for it.
    """
    if found.state != UNKNOWN:
        return found
    from pathlib import PurePath

    bare = PurePath(worker.command).name
    if bare == worker.command or agents.by_command(bare) is None:
        return found
    return WorkerAuth(
        found.state,
        f"{found.detail} — and {worker.command!r} is not in the roster, so "
        f"the agent's own `auth status` was never asked. If this is "
        f"{bare!r}, declare it by the bare name and that question becomes "
        f"free and exact",
        found.method,
    )


def command_word(worker: object) -> str | None:
    """The basename of a worker's binary, whichever form declared it.

    None when it cannot be told — an unparseable shell string, say. Used only
    to look a vendor up in the roster; never to run anything the operator did
    not write down.
    """
    from pathlib import PurePath

    if isinstance(worker, config.AcpWorker):
        return PurePath(worker.command).name
    if isinstance(worker, config.ExecWorker):
        return PurePath(worker.argv[0]).name
    if isinstance(worker, str):
        import shlex

        try:
            words = shlex.split(worker)
        except ValueError:
            return None
        return PurePath(words[0]).name if words else None
    return None


def read(
    worker: object,
    containment_settings: object = None,
    declared_secret_names: tuple[str, ...] = (),
) -> WorkerAuth:
    """`_read`, with the detail SCRUBBED before anything can render it.

    `declared_secret_names` is `config.declared_secret_names(cfg)` from any
    caller holding a Config — the fuller set the redactor law wants folded
    in. This function deliberately takes a worker rather than a Config, so
    the names travel as a parameter; the worker's own `env_passthrough` is
    always folded in besides, because that is the declared share a worker
    can echo even when a caller passes nothing.

    The detail can embed text an AGENT supplied — the handshake rung folds a
    `session/new` refusal's own words in, and an agent has echoed a live
    credential into exactly that surface (the `leakrefusal` fixture is that
    measurement). Until 0.6.0 the unknown-state details were rendered by
    nobody, so the hazard had no surface; the typed state is rendered on the
    run path now, so the scrub happens HERE, once, where the sentence is
    made — protecting doctor, the console line, the drive step and the
    refusal message alike. The redactor is built from the default env-name
    patterns plus every name the worker declares to cross.
    """
    found = _read(worker, containment_settings)
    from wringer import redact

    scrub = redact.Redactor.from_config(
        extra_names=tuple(declared_secret_names)
        + tuple(getattr(worker, "env_passthrough", ()) or ())
    ).scrub
    cleaned = scrub(found.detail)
    if cleaned == found.detail:
        return found
    return WorkerAuth(found.state, cleaned, found.method)


def _read(worker: object, containment_settings: object = None) -> WorkerAuth:
    """The declared worker's credential state, typed, for EVERY worker form.

    Every path that cannot produce a trustworthy answer returns `UNKNOWN` with
    the reason in `detail`, because the alternative — inferring "logged out"
    from a timeout, a missing binary, or an agent this repository has never
    measured — is exactly the reasoning that produced a false sentence about
    this adapter on 2026-08-22.

    **A shell worker no longer arrives as a bare UNKNOWN** (run 3, F10: on
    the path a run actually takes, that None-shaped answer was rendered by
    nobody, and silence read as a tick). Where the vendor has a measured
    login probe on the roster (`agents.SHELL_VENDORS`), it is asked — in the
    environment a shell worker actually gets, which is this process's own,
    inherited whole (`docs/vendors.md` says so in print) — and the answer is
    composed with the one other fact this preflight owns: whether the
    vendor's key variable is set. The key DISPLACES the login at the turn
    (measured on the ACP lane 2026-08-27, re-measured on codex in run 3), so
    a set key makes the EFFECTIVE credential the key, and its validity is
    exactly as unknowable as before: presence is not validity.
    """
    if not isinstance(worker, config.AcpWorker):
        if containment_settings is not None:
            return WorkerAuth(
                UNKNOWN,
                "the worker runs inside a containment, and this check can "
                "only ask the vendor's binary on this machine",
            )
        return _shell_lane(worker)

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
        return _name_the_bare_form(worker, _handshake_rung(worker))

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


def _shell_lane(worker: object) -> WorkerAuth:
    """The typed state for a shell or `exec:` worker.

    Two facts, composed and never blended: what the vendor's own probe says
    about the STORED login, and whether the vendor's key variable is set in
    the environment the worker will inherit. The composition rules are the
    measured precedence — the key displaces the login — so the state answers
    the only question that matters before spend: is the EFFECTIVE credential
    known-good, known-bad, or unknowable from here?

    - no roster row       → NOT_APPLICABLE. Nothing measured exists to ask.
    - probe yes, no key   → LOGGED_IN, the vendor's own word, ceiling stated.
    - probe yes, key set  → UNKNOWN, the displacement NAMED: the login works
                            and will not be used. Presence is not validity —
                            and here it is worse than absence, because a dead
                            key fails a turn the login would have served.
    - probe no,  key set  → UNKNOWN: the key is the only lane, and only the
                            turn can say whether it works.
    - probe no,  no key   → LOGGED_OUT — the vendor's own definite no, with
                            no other credential in sight. The one composition
                            that refuses.
    """
    import os

    word = command_word(worker)
    if word is None:
        return WorkerAuth(
            UNKNOWN, "the worker command could not be read as a command line"
        )
    vendor = agents.shell_vendor_by_command(word)
    if vendor is None:
        return WorkerAuth(
            NOT_APPLICABLE,
            f"{word!r} is a shell command with no login surface on the "
            "roster — the worker authenticates on its own account, and this "
            "check has nothing measured to ask it",
        )
    if shutil.which(vendor.command) is None:
        return WorkerAuth(
            UNKNOWN, f"{vendor.command!r} is not on PATH, so it cannot be asked"
        )

    key_set = bool(os.environ.get(vendor.key_env))
    try:
        proc = subprocess.run(
            [vendor.command, *vendor.login_probe],
            capture_output=True, text=True, timeout=TIMEOUT,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return WorkerAuth(
            UNKNOWN, f"asking {vendor.command!r} did not finish: {exc}"
        )

    answer = (proc.stdout or proc.stderr).strip().splitlines()
    said = answer[0].strip() if answer else ""
    if proc.returncode == 0:
        if key_set:
            return WorkerAuth(
                UNKNOWN,
                f"{vendor.key_env} is set and takes precedence over the "
                f"stored login ({vendor.command} says: {said or 'logged in'})."
                f" The key is what this run will spend against, and presence "
                f"is not validity — a dead key here fails a turn the login "
                f"would have served. Unset it to spend on the login",
            )
        return WorkerAuth(
            LOGGED_IN,
            f"{vendor.command} says: {said or 'logged in'} — the vendor's "
            "own word, not a promise the credential still works",
        )
    if key_set:
        return WorkerAuth(
            UNKNOWN,
            f"the only credential is {vendor.key_env} ({vendor.command} "
            f"says: {said or 'not logged in'}); whether the key works, only "
            "the turn can say — presence is not validity",
        )
    return WorkerAuth(
        LOGGED_OUT,
        f"{vendor.command} says: {said or 'not logged in'}, and "
        f"{vendor.key_env} is not set — there is no credential for this "
        "worker to spend against",
    )


def _routes(worker: object) -> tuple[str, str, str | None]:
    """`(command, key variable, policy file or None)` — the whole decision.

    **One decision, two renderings.** `wring doctor` prints a one-line fix and
    the drive's stop prints a paragraph; what they may never do is disagree
    about which routes this machine HAS. They did, for the length of one
    commit: the stop learned that a pinned machine has only the login route
    and doctor's line went on offering the key route bare — the same defect
    field report 2026-08-26 finding 1 records, surviving on the surface the
    fix did not touch. Fixes land where the fact is made, and this is it.
    """
    command = getattr(worker, "command", "the coding agent")
    known = agents.by_command(command)
    key = known.key_env if known is not None else "the agent's API key variable"
    return command, key, agents.managed_policy_file()


def _shell_vendor(worker: object):
    """The roster row for a non-ACP worker, or None."""
    if isinstance(worker, config.AcpWorker):
        return None
    word = command_word(worker)
    return agents.shell_vendor_by_command(word) if word else None


def remedy(worker: object) -> str:
    """The one-line form, for `wring doctor`'s `fix`.

    Says the same thing `refusal` says at length, from the same branch, and
    never more than the machine can honestly offer.
    """
    vendor = _shell_vendor(worker)
    if vendor is not None:
        return (
            f"Log the vendor's CLI in ({vendor.login_command}), or export "
            f"{vendor.key_env} — which then takes precedence over any stored "
            "login on every turn. Neither proves the credential still works"
        )
    command, key, policy = _routes(worker)
    if policy is not None:
        return (
            f"Log the agent in: {command} --cli auth login. This machine has "
            f"a coding-agent policy file at {policy} — if it pins the builder "
            f"to an organisation login, {key} under "
            f"'run.worker.acp.env_passthrough' is REFUSED here, so remove one "
            f"if it is declared. A login does not prove the credential still "
            f"works"
        )
    return (
        f"Log the agent in ({command} --cli auth login), or declare {key} "
        "under 'run.worker.acp.env_passthrough' — 'wring run' will refuse "
        "until one of those is true. Neither proves the credential still works"
    )


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
    vendor = _shell_vendor(worker)
    if vendor is not None:
        return (
            f"{found.detail}, so the build step would fail after the "
            f"drafting call had already been paid for.\n\n"
            f"Two ways to give it a credential, both yours to choose:\n"
            f"  - log the vendor's CLI in once: {vendor.login_command}\n"
            f"  - or export {vendor.key_env}, which then takes precedence "
            f"over any stored login on every worker turn\n\n"
            f"This check reads what the vendor's own status command says and "
            f"cannot tell whether a credential still works: a revoked key "
            f"and a lapsed subscription both die at the turn. Nothing has "
            f"been created."
        )
    command, key, policy = _routes(worker)
    limit = (
        "This check reads what the agent says about itself and cannot tell "
        "whether a credential still works: a revoked key and a lapsed "
        "subscription both report being logged in. Nothing has been created."
    )
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
    import os

    crossing = [
        name
        for name in getattr(worker, "env_passthrough", ())
        if os.environ.get(name)
    ]
    if crossing:
        # **The displacement, named** (run 3, F7 — the ACP law of 2026-08-27
        # re-measured on a second vendor): a set key is already crossing into
        # the worker's environment, and the measured precedence is that the
        # key DISPLACES any login. An agent refusing with that key present is
        # therefore most plainly refusing the KEY — so offering "declare the
        # key" as the remedy here would send the operator to re-do the thing
        # being rejected.
        named = ", ".join(crossing)
        return (
            f"{found.detail}, so the build step would fail after the "
            f"drafting call had already been paid for.\n\n"
            f"{named} is set and declared under "
            f"'run.worker.acp.env_passthrough', so it crosses into the "
            f"worker's environment — and a key there takes precedence over "
            f"any login the agent holds (measured; presence is not "
            f"validity). If that key is dead, it is the thing being "
            f"refused, and it makes this machine fail where the login alone "
            f"would have worked. Unset or replace it, or log the agent in "
            f"and remove the declaration: {command} --cli auth login\n\n"
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
