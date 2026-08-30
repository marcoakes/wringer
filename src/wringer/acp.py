"""Speak the Agent Client Protocol to a worker (docs/specs/SPEC_ACP_V0.md).

**Wringer is an ACP client. It is never the agent.** That distinction is the
neutrality position in one sentence: Wringer supervises, somebody else's
agent writes the code, and swapping which agent becomes a config line rather
than a rewrite.

The wire is JSON-RPC 2.0 over the child's stdin/stdout, newline-delimited.
Method names are the protocol's, verified against its published schema:
`initialize`, `session/new`, `session/prompt`, and the agent-to-client
`session/update`, `fs/read_text_file`, `fs/write_text_file`,
`session/request_permission`.

One session per iteration. A fresh context each lap is what keeps the loop's
evidence honest — a long-lived conversation drifts, and then the ledger
describes something other than what was tried.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from wringer import containment, gates
from wringer.redact import Redactor

PROTOCOL_VERSION = 1

# What Wringer, as a client, offers the agent. Terminal is deliberately
# absent in v0: an agent that wants to run commands can do it through the
# gates a repo already declared, which is the part that gets verified.
CLIENT_CAPABILITIES = {"fs": {"readTextFile": True, "writeTextFile": True}}

# A ceiling on a CONTROL-PLANE request — `initialize` and `session/new` — and
# on any request made without a turn deadline at all. The handshake either
# answers promptly or is broken, so a client-side ceiling there is a real
# diagnostic.
#
# It is deliberately NOT applied to `session/prompt`. That is the turn, and
# SPEC_ACP_V0 §3 makes `worker_timeout` the deadline a turn is killed against
# — the number the repo wrote down is the number that binds. Applying this cap
# to the prompt made a 900s default silently mean 120s for every repo, and the
# ledger then recorded `timed_out` about an agent that was still working, which
# reads as the agent being slow rather than Wringer being impatient.
REQUEST_TIMEOUT_SECONDS = 120

# A ceiling on one message reaching the agent. Writing to a pipe blocks when
# the buffer fills and the far end has stopped reading, and that block is
# armed BEFORE any of the turn's deadlines exist — so without this, an agent
# that hangs without draining stdin wedges the supervisor indefinitely.
# Short, because a healthy agent drains its input immediately.
WRITE_TIMEOUT_SECONDS = 30

# How long to keep reading a stopped agent's stderr before giving up on
# it. `gates._drain`'s number and `gates._drain`'s reason.
DRAIN_TIMEOUT_SECONDS = 5


# How much of one `data` value is rendered into a refusal's words before the
# rest is dropped WITH A NOTE. The whole point of this rendering is that the
# operator sees what the agent said, so the number is set far above any real
# remedy — the org-managed refusal that motivated it is ~430 characters — and
# exists only for the bad-day case: an agent that puts a log file in its error
# payload would otherwise write it into `loop.jsonl` as one line.
#
# **A cut is announced, never silent.** That is the whole complaint this fix
# answers (`docs/field-report-2026-08-25.md`): a surface that quietly shows
# less than it was given teaches the reader nothing about what is missing.
MAX_ERROR_DATA_CHARS = 20_000


def refusal_words(
    method: str, error: dict[str, Any], skip: tuple[str, ...] = ()
) -> str:
    """Everything the agent said about a refusal — code, message AND data.

    **The one place a JSON-RPC error becomes words**, so every surface that
    renders an `AcpError` — the console, `loop.jsonl`, `worker-diagnosis.json`,
    the bundle's log, `wring doctor`'s worker-auth line, the drive's `stopped`
    step — carries the same text. There is no second renderer to drift.

    Field report 2026-08-25, finding 1: this used to be
    `f"{method} was refused: {said}"` and nothing else, and it cost a product
    manager an entire session. Their agent sent `-32603 Internal error` — the
    generic code, which says nothing on its own — with the remedy in
    `data.details`, in plain English, naming the exact command to run. The
    message alone was rendered; the remedy was dropped at four surfaces at
    once. Wringer knew the answer and did not say it.

    `skip` names data keys the CALLER is about to render better itself:
    `data.authMethods` is a refusal's auth ladder, and `authentication_wanted`
    prints each method's own name, description and command. Skipping it there
    keeps the same fact from arriving twice in two shapes — and every OTHER
    key still travels, because an agent that refuses for auth may also say
    something about the machine it is running on.

    Nothing here interprets. The code is printed as the number it is, the
    message as the agent wrote it, each data value verbatim, and the reader
    decides what it means — the same law the hint tier lives under
    (`diagnose.py`: route on facts, hint on text, claim on neither).
    """
    said = error.get("message") or "agent error"
    code = error.get("code")
    # The METHOD is carried for the reason `_await` recorded: a rejection that
    # reads only `Invalid params` sent the first reader to someone else's
    # schema to work out which of three calls it was.
    head = f"{method} was refused: {said}"
    if code is not None:
        head += f" (code {code})"
    return "".join([head, *_data_words(error.get("data"), skip)])


def _data_words(data: Any, skip: tuple[str, ...] = ()) -> list[str]:
    """The `data` member of a JSON-RPC error, rendered for a person.

    A string value is printed as the agent wrote it — NOT re-wrapped, NOT
    re-indented, NOT JSON-escaped — because a remedy that says
    `Remove the credential and run: claude auth login` is only useful if the
    reader can copy the line. Anything else is JSON, which is what it was.
    """
    if data is None or data == {} or data == []:
        return []
    if isinstance(data, dict):
        return [
            _one_value(f"data.{key}", value)
            for key, value in data.items()
            if key not in skip
        ]
    return [_one_value("data", data)]


def _one_value(label: str, value: Any) -> str:
    text = value if isinstance(value, str) else json.dumps(
        value, ensure_ascii=False, sort_keys=True
    )
    if len(text) > MAX_ERROR_DATA_CHARS:
        dropped = len(text) - MAX_ERROR_DATA_CHARS
        text = text[:MAX_ERROR_DATA_CHARS] + (
            f"\n[wringer: {dropped} further characters of `{label}` not shown]"
        )
    return f"\n\nThe agent also sent `{label}`:\n{text}"


class AcpError(Exception):
    """The agent could not be spoken to. Recorded as a failed worker turn —
    never as a verdict about the code.

    **Carries the LEDGER as far as it got** (`turn`), and None when the failure
    happened before there was one. A turn that died at `session/prompt` has
    still written down whether it touched a file, and `diagnose.py` needs that
    FACT to tell "the agent was refused before it did anything" from "the agent
    worked and then fell over" — F6's law: route on facts, hint on text. Before
    this the exception carried its message and nothing else, so the caller had
    to guess, and guessing is what the hint tier is forbidden to do.
    """

    turn: Turn | None = None
    #: Whether the turn ran out of time, as a FACT rather than as a substring.
    #:
    #: The loop used to read this off the message — `"deadline" in str(exc)` —
    #: which was true of exactly one raise site and no others. That worked
    #: only while Wringer wrote every word of the message. It now carries the
    #: agent's own `data` verbatim (`refusal_words`), so an agent whose
    #: remedy happened to contain the word "deadline" would have had its
    #: refusal recorded as a timeout — and `diagnose_failed_turn` returns
    #: nothing for a timeout, so the operator would lose the diagnosis
    #: entirely. Route on facts, hint on text: this is the fact.
    timed_out: bool = False
    #: The agent's own JSON-RPC error object, when the failure was one.
    #: Carried for the same reason `turn` is: `diagnose.py`'s law is route on
    #: FACTS, hint on text — and "was this refusal about authentication?" has a
    #: fact behind it (`data.authMethods`) that a message string does not.
    error: dict[str, Any] | None = None


@dataclass(frozen=True)
class Usage:
    """What the agent said it spent — **its claim, never our measurement.**

    ACP agents MAY send this as a `usage_update` session notification. The
    token counts are required and non-null in the protocol; the cost is
    optional and carries the agent's own currency, which is why nothing here
    converts, sums across currencies, or prices anything: a table of vendor
    prices would be a third module holding vendor strings, and wrong the week
    after it was written.

    `used` is CUMULATIVE within a session, so a later update supersedes an
    earlier one rather than adding to it.
    """

    used: int
    size: int
    cost_amount: float | None = None
    cost_currency: str | None = None

    def as_json(self) -> dict[str, Any]:
        recorded: dict[str, Any] = {"used": self.used, "size": self.size}
        if self.cost_amount is not None and self.cost_currency:
            recorded["cost"] = {
                "amount": self.cost_amount,
                "currency": self.cost_currency,
            }
        return recorded


@dataclass
class Turn:
    """What one session produced, for the ledger."""

    stop_reason: str = "unknown"
    timed_out: bool = False
    agent_name: str = ""
    agent_version: str = ""
    protocol_version: int = 0
    updates: list[str] = field(default_factory=list)
    permissions: list[dict[str, Any]] = field(default_factory=list)
    files_written: list[str] = field(default_factory=list)
    refusals: list[str] = field(default_factory=list)
    #: What the agent said about its own authentication at `initialize`, as it
    #: said it (docs/specs/SPEC_ACPAUTH_V0.md). Empty is the honest default and
    #: means the agent advertised none — MEASURED to be a fact about the agent
    #: rather than about our request (`docs/acp-auth-2026-08-24.md`, A2).
    auth_methods: list[dict[str, Any]] = field(default_factory=list)
    # None until an agent reports, and None is meaningful: absent means
    # unreported, and must never be rendered as zero downstream.
    usage: Usage | None = None


class Connection:
    """A JSON-RPC peer on a subprocess's stdio.

    Reading happens on a thread because the exchange is bidirectional: while
    Wringer waits for a `session/prompt` response, the agent is sending
    notifications and making its own requests, and a naive read loop would
    deadlock the moment both sides spoke at once.
    """

    def __init__(self, proc: subprocess.Popen, deadline: float | None = None) -> None:
        self._proc = proc
        # Absolute monotonic time the whole turn must end by.
        self._deadline = deadline
        self._next_id = 0
        self._responses: dict[int, dict] = {}
        self._lock = threading.Lock()
        self._inbound: list[dict] = []
        self._done = threading.Event()
        self._reader = threading.Thread(target=self._read_forever, daemon=True)
        self._reader.start()

    def _read_forever(self) -> None:
        stream = self._proc.stdout
        if stream is None:  # pragma: no cover - always piped by the caller
            return
        try:
            for raw in stream:
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    # A line we cannot parse is the agent's problem, not a
                    # reason to abandon the turn: keep reading and let the
                    # timeout rule.
                    continue
                with self._lock:
                    if "id" in message and (
                        "result" in message or "error" in message
                    ):
                        self._responses[message["id"]] = message
                    else:
                        self._inbound.append(message)
        except (OSError, ValueError):
            # The turn ended and `_close_streams` took the pipe back while
            # this thread was still in `read`. That is the ordinary shutdown
            # race, not a fault — and an unhandled exception in a daemon
            # thread prints a traceback onto the console this tool works to
            # keep clean.
            pass
        self._done.set()

    def send_request(
        self, method: str, params: dict, *, capped: bool = True
    ) -> dict:
        """Send one request and wait for its answer.

        `capped` is the control-plane default: a handshake call gets
        `REQUEST_TIMEOUT_SECONDS` as well as the turn's deadline. The prompt
        turn passes `capped=False`, because the only clock that may end a turn
        is the one the repo declared.
        """
        with self._lock:
            self._next_id += 1
            request_id = self._next_id
        self._write(
            {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        )
        return self._await(request_id, method, capped=capped)

    def respond(self, request_id: Any, result: dict) -> None:
        self._write({"jsonrpc": "2.0", "id": request_id, "result": result})

    def respond_error(self, request_id: Any, message: str) -> None:
        self._write(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32000, "message": message},
            }
        )

    def _write(self, message: dict) -> None:
        """Send one message, and **never block past the turn's deadline**.

        A pipe write blocks when the buffer fills and the far end has stopped
        reading. That is not hypothetical: an agent that hangs without draining
        stdin used to wedge Wringer here *forever*, because both `worker_timeout`
        and `wall_clock` are only armed once this returns. The supervisor built
        to honour an eight-hour incident could be held open by the exact shape
        that caused it.

        So the write happens on a daemon thread and is waited on with the same
        deadline everything else obeys. If it does not finish, the caller kills
        the process group and the blocked thread dies with the pipe.
        """
        stream = self._proc.stdin
        if stream is None:  # pragma: no cover
            raise AcpError("the agent has no stdin")

        payload = (json.dumps(message) + "\n").encode("utf-8")
        failure: list[Exception] = []

        def push() -> None:
            try:
                stream.write(payload)
                stream.flush()
            except (BrokenPipeError, OSError, ValueError) as exc:
                failure.append(exc)

        budget = WRITE_TIMEOUT_SECONDS
        if self._deadline is not None:
            budget = min(budget, max(0.0, self._deadline - time.monotonic()))

        writer = threading.Thread(target=push, daemon=True)
        writer.start()
        writer.join(budget)
        if writer.is_alive():
            raise AcpError(
                "the agent stopped reading its input, so the message could not "
                f"be sent within {budget:.0f}s — abandoning the turn"
            )
        if failure:
            raise AcpError(f"the agent stopped listening: {failure[0]}")

    def _await(self, request_id: int, method: str = "a request",
               capped: bool = True) -> dict:
        """Wait for one response, serving the agent's own requests meanwhile.

        A capped request is bounded by whichever comes first: this request's
        own ceiling, or the turn's deadline. An UNCAPPED one is bounded by the
        turn's deadline alone — `worker_timeout` is the repo's instruction, and
        it must not be quietly outlived by a client-side default in either
        direction: not exceeded, and not undercut.

        Every path still ends. A request made with no turn deadline at all
        keeps the ceiling whether or not it asked for one, because an
        unbounded wait is the one thing invariant 3 forbids.
        """
        deadline = self._deadline
        if capped or deadline is None:
            ceiling = time.monotonic() + REQUEST_TIMEOUT_SECONDS
            deadline = ceiling if deadline is None else min(ceiling, deadline)
        while time.monotonic() < deadline:
            with self._lock:
                found = self._responses.pop(request_id, None)
                pending = self._inbound[:]
                self._inbound.clear()
            for message in pending:
                self._serve(message)
            if found is not None:
                if "error" in found:
                    # **The WHOLE error becomes the words** — code, message
                    # and data — through the one renderer, because this is
                    # the only place a refusal is turned into a sentence and
                    # everything downstream reads `str(exc)`. Rendering the
                    # message alone here is what threw away a working remedy
                    # at four surfaces at once (`refusal_words`).
                    refused = AcpError(refusal_words(method, found["error"]))
                    refused.error = found["error"]
                    raise refused
                return found.get("result", {})
            if self._done.is_set() and self._proc.poll() is not None:
                # ONE LAST DRAIN before giving up, and it is load-bearing.
                # The reader sets `_done` only at EOF, so by now everything
                # the agent said is in `_inbound` — but it can have arrived
                # AFTER this iteration's pop, in which case raising here
                # discards precisely the last thing it said before it died.
                # That is the highest-value line in a failed turn, and losing
                # it is a race that shows up on a loaded machine and never on
                # a fast one.
                self.drain()
                raise AcpError(
                    f"the agent exited before replying to {method}"
                )
            time.sleep(0.01)
        # Same reason on the deadline path: an agent that ran out of time
        # usually said why first.
        self.drain()
        expired = AcpError(
            f"the agent did not reply to {method} before the turn's deadline"
        )
        # The FACT the loop routes on. The sentence above still says it in
        # words for the reader; nothing reads those words to decide.
        expired.timed_out = True
        raise expired

    # Set by the session so inbound requests can be served with context.
    handler: Any = None

    def _serve(self, message: dict) -> None:
        if self.handler is not None:
            self.handler(message)

    def drain(self) -> None:
        """Serve whatever arrived after the turn's response."""
        with self._lock:
            pending = self._inbound[:]
            self._inbound.clear()
        for message in pending:
            self._serve(message)


def _inside(root: Path, candidate: str, contained: bool = False) -> Path | None:
    """Resolve a path the agent named, or None if it escapes the repo.

    Wringer is not obliged to help an agent write outside the tree it was
    pointed at, and a symlink is not an argument.

    **`contained` translates before it resolves, and the order is the whole
    safety argument** (SPEC_CONTAIN_V0 §11 A-4). A contained agent sees the
    repository at /workspace, so every path it names is a container path;
    untranslated, `/workspace/x` resolves outside the host root and is refused,
    which fails closed in the right direction and the wrong answer. Translation
    runs FIRST and the resolve is then byte for byte the one it always was — so
    a `..`, a symlink, or a path that was never under /workspace still escapes
    to exactly the refusal it did before. Nothing here widens what an agent may
    reach; it stops the boundary from lying to the agent about where the tree
    is.
    """
    if contained:
        candidate = containment.inbound(candidate, root)
    try:
        resolved = (root / candidate).resolve()
        return resolved if resolved.is_relative_to(root.resolve()) else None
    except (OSError, ValueError):
        return None


def worker_env(
    env_passthrough: tuple[str, ...], containment_settings: Any = None
) -> dict[str, str]:
    """Exactly the environment a worker turn is handed.

    Extracted from `run_turn` on 2026-08-22 so that a PREFLIGHT can *predict*
    the worker's environment rather than reconstruct it. A check that asks
    "will the agent be able to authenticate?" is only worth running if it asks
    in the environment the agent will actually get; a second copy of these
    names and this loop would answer about an environment nothing runs in, and
    would drift the first time either changed.

    Four names and no more, plus whatever the operator declared crosses. The
    smallness is the point: a worker inherits nothing it was not given.

    **`USER` is the fourth, and it was the gate-blocker** — field report
    2026-08-26, finding 1. On a Mac pinned by managed settings to an
    organisation login the credential lives in the macOS Keychain, and the
    agent needs `USER` to resolve its own Keychain item. Bisected on that
    machine one variable at a time: `PATH`/`HOME`/`LANG` gave
    `loggedIn: false`; the same three plus `USER` gave `loggedIn: true,
    authMethod: claude.ai`. Nothing else moved it. So a logged-in agent
    reported logged out, the drive stopped on a FALSE RED, and the one route
    an org-pinned machine has was the one route that could not work.

    It belongs in the base set rather than in somebody's `env_passthrough`
    because it is **identity, not a credential**: it names who is running, it
    opens nothing on its own, and `HOME` — which has always crossed — already
    points at that same person's files. A name every operator on the affected
    class of machine would have to declare by hand, to fix a failure whose
    message points the other way, is a default in the wrong place.

    Nobody upstream hit it because the unmanaged route declares a key
    explicitly and no Keychain read ever happens. The Keychain read only
    matters on the login-only route, which is exactly the route that class of
    machine is forced onto — the machine was the variable again.
    """
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": os.environ.get("HOME", ""),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
    }
    # Absent rather than empty when this process has none. `USER` is unset in
    # some CI containers and in a bare `env -i`; handing a worker `USER=""`
    # would be Wringer asserting an identity nobody has, and a Keychain lookup
    # on an empty user is a different failure from a lookup nobody could make.
    if os.environ.get("USER"):
        env["USER"] = os.environ["USER"]
    crossing = env_passthrough
    if containment_settings is not None:
        # Both declared allowlists apply, and the union is ruled rather than
        # assumed (SPEC_CONTAIN_V0 §11 A-6). Wringer's own environment is what
        # the runtime CLIENT reads `--env NAME` values out of, so a name the
        # boundary declares has to be present here too or it would pass
        # nothing — an intersection arrived at by accident, which is exactly
        # the silently-inert key refusal 11 exists to prevent.
        crossing = containment.env_names(containment_settings, env_passthrough)
    for name in crossing:
        if name in os.environ:
            env[name] = os.environ[name]
    return env


def run_turn(
    command: str,
    args: tuple[str, ...],
    env_passthrough: tuple[str, ...],
    brief: str,
    root: Path,
    timeout: int,
    stdout_path: Path,
    stderr_path: Path,
    on_spawn: Callable[[int], None] | None = None,
    redactor: Redactor | None = None,
    containment_settings: Any = None,
    established: Any = None,
    workdir: Path | None = None,
) -> tuple[Turn, int]:
    """Hold one ACP session and return what it did, plus the exit status.

    **Under a containment the agent runs inside the boundary** rather than on
    this machine (SPEC_CONTAIN_V0 §11). The session is the same session — one
    stdio JSON-RPC exchange — and three things change, each ruled rather than
    incidental: the process spawned is the runtime carrying the agent argv with
    `--interactive` so stdin survives; the session's `cwd` is the mount rather
    than a host path that does not exist inside it; and paths the agent names
    come back translated, because it sees the repository at /workspace.

    The agent runs in its own process group, so the loop's existing kill and
    drain behaviour applies unchanged — an ACP worker is a worker.

    `on_spawn` gets the agent's pid the instant it exists, which is how the
    loop records a group to reap. It matches `gates.run`'s callback of the
    same name deliberately: the two worker forms must be supervisable through
    the same mechanism, or "an ACP worker is a worker" is only a comment.

    **Both log paths are scrubbed before the write**, the way `gates.py` has
    always done it. They were not: the child was handed a raw file handle for
    its stderr, and `turn.updates` were joined and written untouched. An agent
    that echoed a credential — and an agent is given one, by name, through
    `env_passthrough` — put it straight into a bundle. That is why stderr
    travels through a pipe here rather than into the file directly; redaction
    has to happen before the bytes land, never as a cleanup pass.
    """
    redactor = redactor or Redactor()
    env = worker_env(env_passthrough, containment_settings)

    contained = containment_settings is not None and established is not None
    if contained:
        if workdir is None:  # pragma: no cover - the loop always passes one
            raise AcpError(
                "a contained ACP session needs a working directory for its "
                "cidfile, and none was given. Refusing rather than starting a "
                "container nothing can reap"
            )
        # The runtime carries the agent argv UNSPLIT — `--entrypoint` names the
        # binary, everything after the image is its arguments — so nothing
        # re-splits a quoted argument the way a shell would. `--env NAME` for
        # each passed-through name is built in `session_argv`; the values stay
        # in Wringer's own environment and are read by the runtime, never
        # written into an argv anyone can see with `ps`.
        spawn = containment.session_argv(
            containment_settings, established, command, args, root, workdir,
            env_passthrough,
        )
        # The runtime CLIENT is what Popen holds; its cwd is irrelevant to the
        # agent, which gets `--workdir /workspace` inside the boundary.
        spawn_cwd = root
    else:
        spawn = [command, *args]
        spawn_cwd = root

    try:
        proc = subprocess.Popen(
            spawn,
            cwd=spawn_cwd,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            # A PIPE, not `stderr_path.open("wb")`. The file handle meant the
            # agent's stderr reached the disk unscrubbed — and leaked the
            # handle besides.
            stderr=subprocess.PIPE,
            start_new_session=os.name == "posix",
        )
    except OSError as exc:
        raise AcpError(
            f"could not start the ACP agent {command!r}: {exc}. Wringer never "
            "installs an agent — install the one you declared"
        ) from exc

    # Drained continuously on its own thread: a stderr pipe nobody reads fills
    # its buffer and blocks the agent, which would look exactly like a hang.
    stderr_chunks: list[bytes] = []
    stderr_pump = threading.Thread(
        target=_pump, args=(proc.stderr, stderr_chunks), daemon=True
    )
    stderr_pump.start()

    if on_spawn is not None:
        # Before the handshake, not after it: an agent that hangs during
        # `initialize` is precisely the one somebody will SIGKILL the loop
        # over, and reporting the pid only once the session was healthy would
        # miss every case worth reaping.
        on_spawn(proc.pid)

    turn = Turn()
    connection = Connection(proc, deadline=time.monotonic() + timeout)
    connection.handler = lambda message: _handle(
        message, connection, root, turn, contained, redactor
    )

    try:
        info = connection.send_request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "clientCapabilities": CLIENT_CAPABILITIES,
                "clientInfo": {"name": "wringer", "version": _version()},
            },
        )
        turn.protocol_version = int(info.get("protocolVersion", 0) or 0)
        agent = info.get("agentInfo") or {}
        turn.agent_name = str(agent.get("name", ""))
        turn.agent_version = str(agent.get("version", ""))
        # **Read, recorded, and NOT acted on here** (SPEC_ACPAUTH_V0 §3). What
        # the agent offers only matters if the session is then refused, and
        # `authenticate` proves nothing on its own — measured on two vendors.
        # So this is kept for the refusal to speak with, and nothing else.
        offered = info.get("authMethods")
        turn.auth_methods = list(offered) if isinstance(offered, list) else []

        # **The one place the handshake pays for itself** (SPEC_ACPAUTH_V0 §3).
        # A refused session is where an operator meets the auth wall, and until
        # now it read `session/new was refused: Authentication required` and
        # nothing else. `authentication_wanted` reads what the agent already
        # told us at `initialize` and says it in the agent's own words.
        #
        # **Note what is NOT done here: `authenticate` is not called.** Measured
        # on two vendors (`docs/acp-auth-2026-08-24.md`): `kimi-code acp`
        # accepts its own advertised method id and stays unauthenticated, and
        # `dcode --acp` returns success for a method it never offered. A client
        # that called it and believed the answer would report an authenticated
        # worker and fail at the paid turn — the false green this repository
        # refuses everywhere else. The evidence is the session opening, and it
        # did not.
        try:
            session = connection.send_request(
                "session/new",
                # `mcpServers` is REQUIRED by the protocol — not optional, and
                # not defaultable by the agent. Omitting it made every real
                # agent refuse the session with `Invalid params` naming this
                # field, which is the whole reason no ACP turn had ever run
                # (docs/first-contact.md). Empty because Wringer connects the
                # agent to no MCP servers: the tools an agent needs are the
                # gates the repo already declared, which is SPEC_ACP_V0's v0
                # position and the same reason `terminal` is absent from
                # CLIENT_CAPABILITIES. A future MCP story fills this list; it
                # never removes it.
                # **The cwd is the SECOND translation site** (SPEC_CONTAIN_V0
                # §11 A-3), and the shell path does not have it: that path's
                # problem was a brief file path substituted into a command
                # string, and this one is a protocol field. Under a
                # containment the repository is at /workspace, so a host path
                # here opens a session rooted at a directory that does not
                # exist inside the boundary.
                {
                    "cwd": containment.WORKSPACE if contained else str(root),
                    "mcpServers": [],
                },
            )
        except AcpError as refused:
            # **Routed on a FACT, never on the message** (`diagnose.py`'s law).
            # Not every refused session is an auth wall — a missing protocol
            # field is `Invalid params` and has nothing to do with signing in,
            # and the first version of this branch printed "it advertised no
            # way to authenticate" over exactly that. The fact is the agent's
            # own error data: Kimi's refusal carries `authMethods` inside it
            # (`docs/acp-auth-2026-08-24.md`, A5), which is the agent saying in
            # its own reply that this is about authentication.
            #
            # **Stated limit:** an agent that refuses for auth WITHOUT that
            # data gets the refusal it always got. That is no worse than
            # before, and inventing the diagnosis from the message text is the
            # hint-tier guessing this repository forbids in the router.
            offered = ((refused.error or {}).get("data") or {}).get("authMethods")
            if not isinstance(offered, list):
                raise
            wanted = AcpError(
                authentication_wanted(
                    replace(turn, auth_methods=richest(turn.auth_methods, offered)),
                    # **The ladder is skipped and NOTHING ELSE IS.** The
                    # methods are about to be rendered properly below — each
                    # with its own name, description and command — so passing
                    # them through here as JSON as well would say one thing
                    # twice in two shapes. Any other key the agent put in
                    # `data` still travels: an agent can refuse for auth AND
                    # say something about the machine in the same breath, and
                    # dropping that half is this fix's own defect one layer up.
                    refusal_words(
                        "session/new", refused.error or {}, skip=("authMethods",)
                    ),
                )
            )
            wanted.error = refused.error
            raise wanted from refused
        session_id = session.get("sessionId")
        if not session_id:
            raise AcpError("the agent opened no session")

        result = connection.send_request(
            "session/prompt",
            {
                "sessionId": session_id,
                "prompt": [{"type": "text", "text": brief}],
            },
            # THE turn. Bounded by `worker_timeout` and nothing else — a
            # repair turn on a real agent has no reason to fit inside a
            # client-side handshake ceiling, and cutting it there would make
            # the ledger blame the agent for Wringer's number.
            capped=False,
        )
        # Recorded, never acted on — exactly as a shell worker's exit code is.
        turn.stop_reason = str(result.get("stopReason", "unknown"))
        connection.drain()
    except AcpError as exc:
        # **The ledger travels with the failure.** A refused `session/prompt`
        # — the shape a coding agent that has never been logged in has, and
        # the one a product manager hit on 2026-08-21 — leaves a turn that
        # wrote no file and raised no refusal. Without this the caller sees a
        # message and no facts, so it cannot tell that ending from an agent
        # that worked for a minute and then crashed, and `diagnose.py` may
        # only route on facts.
        exc.turn = turn
        raise
    finally:
        _stop(proc, timeout)
        # Bounded, for `gates._drain`'s reason: the agent is dead by now, but
        # anything it spawned and left running still holds the inherited pipe
        # open, and a supervisor that waits for that never returns.
        stderr_pump.join(DRAIN_TIMEOUT_SECONDS)
        _write_log(
            stdout_path, ("\n".join(turn.updates) + "\n").encode(), redactor
        )
        _write_log(stderr_path, b"".join(stderr_chunks), redactor)
        _close_streams(proc)

    return turn, proc.returncode if proc.returncode is not None else 0


def _close_streams(proc: subprocess.Popen) -> None:
    """Give back every descriptor this turn opened.

    Measured: without this, ONE TURN LEAKS THREE — stdin, stdout and stderr.
    `_stop` closes stdin only when it has to kill the process, so an agent
    that exited cleanly, which is the common case, leaked all three.

    A `wring fleet` drives hundreds of turns inside one process. At three
    descriptors each that reaches the open-file limit well inside a long run,
    and it surfaces somewhere else entirely as `too many open files` — a
    supervisor brought down by its own bookkeeping, which is the class of
    failure this module exists to not have.

    Closed AFTER the drain, so nothing is taken away from a reader still
    working, and tolerantly: a stream a thread is mid-read on is exactly the
    case, and a traceback printed from a daemon thread would land on the
    console this project works to keep clean.
    """
    for stream in (proc.stdin, proc.stdout, proc.stderr):
        if stream is None:
            continue
        try:
            stream.close()
        except (OSError, ValueError):  # pragma: no cover - already gone
            pass


def _pump(stream: Any, sink: list[bytes]) -> None:
    """Read a stream to EOF, keeping every byte for the caller to scrub."""
    if stream is None:  # pragma: no cover - always piped by the caller
        return
    try:
        for raw in stream:
            sink.append(raw)
    except (OSError, ValueError):  # pragma: no cover - the pipe died with it
        pass


def _write_log(path: Path, data: bytes, redactor: Redactor) -> None:
    """Scrub, bound, write — `gates._write_logs`'s order, and its reason.

    Truncation must never be what saves a secret, so the limit applies to the
    already-redacted text.
    """
    bounded, _ = gates.truncate(redactor.scrub_bytes(data), gates.MAX_LOG_BYTES)
    path.write_bytes(bounded)


def _usage(update: dict) -> Usage | None:
    """Read a `usage_update`, or return None and lose nothing.

    Total by construction: an agent that sends a malformed update has told us
    nothing usable, and "nothing usable" is the same answer as "said nothing"
    — an absent figure. Inventing a zero from a broken message would be worse
    than the silence it replaces, and the raw update is still in `updates`
    either way, so no evidence is lost by declining to parse it.
    """
    used, size = update.get("used"), update.get("size")
    if not isinstance(used, int) or isinstance(used, bool):
        return None
    if not isinstance(size, int) or isinstance(size, bool):
        return None

    amount = currency = None
    cost = update.get("cost")
    if isinstance(cost, dict):
        raw, unit = cost.get("amount"), cost.get("currency")
        if isinstance(raw, int | float) and not isinstance(raw, bool):
            if isinstance(unit, str) and unit.strip():
                amount, currency = float(raw), unit.strip()
    return Usage(used=used, size=size, cost_amount=amount, cost_currency=currency)


def _handle(
    message: dict,
    connection: Connection,
    root: Path,
    turn: Turn,
    contained: bool = False,
    redactor: Redactor | None = None,
) -> None:
    """Serve one agent-to-client message.

    `contained` is carried down to `_inside` and nowhere else: a contained
    agent names container paths, and the translation happens at the one place
    that resolves them (SPEC_CONTAIN_V0 §11 A-4).

    **`redactor` is here because this function TRUNCATES** (D8, 2026-08-29).
    `_write_log` states the rule — "Truncation must never be what saves a
    secret" — and scrubs before it cuts. These two sites did the opposite:
    each update was cut to 400 characters at append time and the scrub
    happened later, at the join. SECURITY.md says an agent IS handed a
    credential by name through `env_passthrough`, so an agent echoing it in
    a chunk that straddles offset 400 wrote the head of that token into
    `stdout.log`. Probed with a 48-character secret: `sk-live-AAAAAAAAAAAAAA`
    survived the scrub. `session/request_permission` cuts at 200, which is
    tighter and likelier.
    """
    scrub = (redactor or Redactor()).scrub
    method = message.get("method", "")
    params = message.get("params") or {}
    request_id = message.get("id")

    if method == "session/update":
        update = params.get("update") or {}
        kind = update.get("sessionUpdate") or update.get("type") or "update"
        # Parsed into a field, not just logged. Every `session/update` has
        # always landed here and been flattened into the truncated line
        # below — including `usage_update`, which is the only place the
        # protocol carries what a turn cost. The line stays (it is the
        # transcript), and the numbers now also survive as data.
        if kind == "usage_update":
            reported = _usage(update)
            if reported is not None:
                # Cumulative within a session: a later report supersedes an
                # earlier one. Adding them would double-count the agent's own
                # running total.
                turn.usage = reported
        turn.updates.append(f"[{kind}] {scrub(json.dumps(update))[:400]}")
        return

    if method == "fs/read_text_file":
        path = _inside(root, str(params.get("path", "")), contained)
        if path is None or not path.is_file():
            connection.respond_error(request_id, "no such file inside the repository")
            turn.refusals.append(str(params.get("path", "")))
            return
        connection.respond(
            request_id, {"content": path.read_text(encoding="utf-8", errors="replace")}
        )
        return

    if method == "fs/write_text_file":
        named = str(params.get("path", ""))
        path = _inside(root, named, contained)
        if path is None:
            # The refusal is the interesting event: an agent trying to write
            # outside the repo is worth a line in the evidence.
            connection.respond_error(request_id, "refused: path escapes the repository")
            turn.refusals.append(named)
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(str(params.get("content", "")), encoding="utf-8")
        turn.files_written.append(named)
        connection.respond(request_id, {})
        return

    if method == "session/request_permission":
        # Auto-approved in v0, and recorded. A consent prompt nobody is
        # sitting at is not a safety control; the container and the
        # supervision invariants are. The ledger is what makes this
        # auditable rather than invisible.
        tool = scrub(
            json.dumps(params.get("toolCall") or params.get("tool") or {})
        )[:200]
        turn.permissions.append({"tool": tool, "outcome": "auto_approved"})
        options = params.get("options") or []
        chosen = next(
            (o.get("optionId") for o in options if o.get("kind") == "allow_always"),
            None,
        ) or next((o.get("optionId") for o in options), "allow")
        connection.respond(
            request_id, {"outcome": {"outcome": "selected", "optionId": chosen}}
        )
        return

    if request_id is not None:
        connection.respond_error(request_id, f"unsupported method {method!r}")


#: `_meta` keys that carry a COMMAND for the client to run. Wringer shows
#: them and never runs them (SPEC_ACPAUTH_V0 §4): a login is somebody's
#: account, and the block is arbitrary argv supplied by the agent — an
#: untrusted party — to be executed on the operator's machine.
_RUNNABLE_META = ("terminal-auth", "terminal", "command")


def runnable_block(method: dict[str, Any]) -> dict[str, Any]:
    """The command block an auth method carries, in either shape it comes in.

    **Two shapes, both measured on the SAME agent in one exchange**
    (`docs/acp-auth-2026-08-24.md`): `kimi-code acp` nests it under
    `_meta.terminal-auth` at `initialize`, and FLATTENS it onto the method
    itself — `type`, `args`, `env` — inside the `session/new` refusal. Reading
    only the nested shape silently loses the flattened one, which is how a
    guard goes quiet.
    """
    meta = method.get("_meta")
    if isinstance(meta, dict):
        for key in _RUNNABLE_META:
            block = meta.get(key)
            if isinstance(block, dict):
                return block
    if method.get("type") == "terminal" or "args" in method:
        return method
    return {}


def interactive(method: dict[str, Any]) -> bool:
    """Whether this auth method needs a PERSON (derivation A1).

    Derived from the shape rather than from a vendor's name: a method carrying
    a command is one somebody runs at a keyboard. A hand-kept list of vendor
    ids would be the roster-of-special-cases this whole slice exists to avoid.
    """
    return bool(runnable_block(method))


def richest(advertised: list[dict], refused: list[dict]) -> list[dict]:
    """The fuller description of each method the refusal names.

    **Measured: the two lists are not the same list.** `kimi-code acp` sends
    `_meta.terminal-auth` with a `command` at `initialize`, and the copy inside
    its `session/new` refusal is flattened AND has no `command` at all. So the
    refusal says WHICH methods are wanted and the handshake says what running
    one would take — and an operator needs both. Matched by `id`; a method the
    refusal names and the handshake never did is used as it arrived.
    """
    by_id = {m.get("id"): m for m in advertised if isinstance(m, dict)}
    out = []
    for method in refused:
        if not isinstance(method, dict):
            continue
        earlier = by_id.get(method.get("id"))
        if earlier and runnable_block(earlier).get("command"):
            out.append({**method, **earlier})
        else:
            out.append(method)
    return out or advertised


def authentication_wanted(turn: Turn, said: str) -> str:
    """What to tell the operator when the agent refuses to open a session.

    **The whole product value of the handshake is this function**, and it is
    the agent's own words rather than Wringer's: `name` and `description` come
    verbatim from `authMethods` (derivation A3). Before this, a refused session
    read `session/new was refused: Authentication required` and the operator
    had to go and find out what that agent wanted.

    **It never offers to run anything.** Where a method carries a command, the
    command is PRINTED for the person to run — see `_RUNNABLE_META`.
    """
    lines = [f"the agent refused to open a session: {said}"]
    if not turn.auth_methods:
        lines.append(
            "\nIt advertised no way to authenticate, so there is nothing here "
            "to drive. Check that agent's own documentation for how it expects "
            "to be signed in."
        )
        return "\n".join(lines)

    lines.append("\nThe agent says it accepts:")
    for method in turn.auth_methods:
        name = str(method.get("name") or method.get("id") or "(unnamed)")
        lines.append(f"  - {name}")
        description = str(method.get("description") or "").strip()
        if description:
            lines.append(f"      {description}")
        block = runnable_block(method)
        argv = " ".join(
            [str(block.get("command", ""))] +
            [str(a) for a in (block.get("args") or [])]
        ).strip()
        if argv:
            lines.append(f"      run this yourself, once: {argv}")
    lines.append(
        "\nWringer does not run any of these for you. Signing an agent in is "
        "your act on your account, and the command above came from the agent "
        "rather than from Wringer."
    )
    return "\n".join(lines)


def _stop(proc: subprocess.Popen, timeout: int) -> None:
    import signal

    if proc.poll() is not None:
        return
    try:
        if proc.stdin is not None:
            proc.stdin.close()
    except OSError:
        pass
    try:
        proc.wait(timeout=min(5, timeout))
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError, AttributeError):
        proc.kill()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:  # pragma: no cover
        pass


def _version() -> str:
    from wringer import __version__

    return __version__
