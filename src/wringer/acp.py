"""Speak the Agent Client Protocol to a worker (SPEC_ACP_V0.md).

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
from dataclasses import dataclass, field
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


class AcpError(Exception):
    """The agent could not be spoken to. Recorded as a failed worker turn —
    never as a verdict about the code."""


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
                    # The METHOD is carried, not just the message. Without
                    # it a rejection reads only `Invalid params`, and
                    # diagnosing the first real-agent failure meant reading
                    # someone else's schema to work out which call it was
                    # (docs/first-contact.md). The agent names what is
                    # wrong; only Wringer knows what it asked.
                    said = found["error"].get("message", "agent error")
                    raise AcpError(f"{method} was refused: {said}")
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
        raise AcpError(
            f"the agent did not reply to {method} before the turn's deadline"
        )

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
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": os.environ.get("HOME", ""),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
    }
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
        message, connection, root, turn, contained
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

        session = connection.send_request(
            "session/new",
            # `mcpServers` is REQUIRED by the protocol — not optional, and not
            # defaultable by the agent. Omitting it made every real agent
            # refuse the session with `Invalid params` naming this field,
            # which is the whole reason no ACP turn had ever run
            # (docs/first-contact.md). Empty because Wringer connects the
            # agent to no MCP servers: the tools an agent needs are the gates
            # the repo already declared, which is SPEC_ACP_V0's v0 position
            # and the same reason `terminal` is absent from
            # CLIENT_CAPABILITIES. A future MCP story fills this list; it
            # never removes it.
            # **The cwd is the SECOND translation site** (SPEC_CONTAIN_V0 §11
            # A-3), and the shell path does not have it: that path's problem
            # was a brief file path substituted into a command string, and this
            # one is a protocol field. Under a containment the repository is at
            # /workspace, so a host path here opens a session rooted at a
            # directory that does not exist inside the boundary.
            {
                "cwd": containment.WORKSPACE if contained else str(root),
                "mcpServers": [],
            },
        )
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
) -> None:
    """Serve one agent-to-client message.

    `contained` is carried down to `_inside` and nowhere else: a contained
    agent names container paths, and the translation happens at the one place
    that resolves them (SPEC_CONTAIN_V0 §11 A-4).
    """
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
        turn.updates.append(f"[{kind}] {json.dumps(update)[:400]}")
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
        tool = json.dumps(params.get("toolCall") or params.get("tool") or {})[:200]
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
