#!/usr/bin/env python3
"""Is an ACP agent's AUTHENTICATION state readable BEFORE the paid turn?

`docs/MANUAL_CHECKS.md` sequence L. Not a test, and it cannot be one: it needs
a real vendor binary, which the suite is offline-by-construction without.

**Why the question matters.** The drive now preflights that the coding agent
is on PATH before it spends anything (S1). The obvious next question is
whether it can also preflight that the agent is LOGGED IN — because on
2026-08-21 a product manager reached the build step with an agent that was
installed and unauthenticated, and lost the run there.

**What this measures.** The handshake, and only the handshake: `initialize`
and `session/new`. It never sends `session/prompt`, which is the turn that
costs money. Run it twice — once as yourself, once with `HOME` pointed at an
empty directory so the agent cannot find its credentials — and compare.

    python3 scripts/acp-auth-probe.py claude-agent-acp
    HOME=$(mktemp -d) python3 scripts/acp-auth-probe.py claude-agent-acp

An agent whose ACP mode is a subcommand or a flag is quoted as one argument:

    python3 scripts/acp-auth-probe.py "kimi-code acp"

If the two differ, auth is checkable for free and the drive should check it.
If they are identical, it is not, and the honest fix is the one shipped:
refuse LATER, but say the right thing when you do (`diagnose.FACE_TURN_REFUSED`).

Pointing `HOME` at an empty directory is non-destructive — it logs nothing out
and touches no credential store. Do NOT use the agent's own logout to make the
unauthenticated case; that ends a real session somebody has to restore.

**`--prompt`: the one question the handshake cannot answer.** The handshake
above proved only that `initialize` and `session/new` hide auth. It said
nothing about whether the *turn* succeeds, and until 2026-08-22 nobody had
ever run one: three field runs inferred the wall's name without measuring it.
`--prompt` sends ONE minimal turn ("Reply with the single word ok") after the
handshake and reports, verbatim, whether it was answered or refused.

    python3 scripts/acp-auth-probe.py --prompt claude-agent-acp

It is OPT-IN because it is the paid call. Without the flag this script's
behaviour is exactly what it always was, and it still stops one step short.
Credentials are never read or printed here — set them in the environment of
the run you want to measure (`ANTHROPIC_API_KEY=... python3 …`) and the child
inherits them like any other subprocess.
"""

from __future__ import annotations

import json
import shlex
import subprocess
import sys
import threading
import time

PROTOCOL_VERSION = 1
CLIENT_CAPABILITIES = {"fs": {"readTextFile": True, "writeTextFile": True}}

#: The turn is deliberately the cheapest one that still proves the route works:
#: no tools, no files, one word back.
PROBE_PROMPT = "Reply with the single word ok. Do not use tools."

#: A turn can take far longer than a handshake — a cold model, a queue, a
#: retry. Refusals come back fast; this ceiling is for the answers.
PROMPT_TIMEOUT = 180.0


def probe(command: str, timeout: float = 25.0, send_prompt: bool = False) -> dict:
    # **Split, so an agent whose ACP mode is a SUBCOMMAND can be measured.**
    # `claude-agent-acp` is its own binary; Kimi's ACP server is `kimi acp`,
    # and Zed's convention is a flag. A bare `[command]` could only ever probe
    # the first shape, and the roster needs all of them. `shlex.split` leaves
    # every single-word invocation byte-identical to what it always was, so
    # the captures already in `docs/` reproduce unchanged.
    proc = subprocess.Popen(
        shlex.split(command),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    errs: list[str] = []
    drain = threading.Thread(target=lambda: errs.extend(proc.stderr), daemon=True)
    drain.start()

    found: dict = {"agent": command}
    counter = [0]

    def send(payload: dict) -> bool:
        """Write one JSON-RPC line, or report that there is nobody to write to.

        **The probe's own defect, found 2026-08-23 by pointing it at a new
        agent.** `dcode --acp` with no credential exits 1 *before* the
        handshake, so `initialize` went into a pipe with no reader and
        `session/new` raised `BrokenPipeError` out of `probe()` — a traceback
        where the answer should have been. An instrument that crashes when the
        thing it measures is broken reports nothing about the most interesting
        case it has: an agent that refuses at startup is exactly the free
        preflight rung worth knowing about.
        """
        try:
            proc.stdin.write(json.dumps(payload) + "\n")
            proc.stdin.flush()
        except (BrokenPipeError, OSError, ValueError):
            return False
        return True

    def request(method: str, params: dict, wait: float | None = None) -> dict:
        counter[0] += 1
        rid = counter[0]
        if not send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params}):
            return {"_died": method}
        limit = timeout if wait is None else wait
        deadline = time.monotonic() + limit
        while time.monotonic() < deadline:
            line = proc.stdout.readline()
            if not line:
                # A closed stdout means either "this agent went away" or "it
                # is still there and said nothing". Only `poll()` can tell
                # them apart, and they are different findings.
                if proc.poll() is not None:
                    return {"_died": method}
                return {"_transport": "the agent stopped listening"}
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if message.get("id") == rid:
                return message
            if "method" in message and "id" in message:
                # The agent is asking US something (a permission, a file read).
                # This probe does no work, so decline rather than leave the
                # agent waiting on a reply that never comes — an unanswered
                # request wedges the turn and would read as a timeout.
                declined = {
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "error": {
                        "code": -32601,
                        "message": "the auth probe implements no client methods",
                    },
                }
                if not send(declined):
                    return {"_died": method}
        return {"_transport": f"no reply to {method} within {limit}s"}

    def died(answer: dict) -> bool:
        """Record an agent that is no longer there, once, with its own words.

        The exit code and the sentence on stderr ARE the measurement in this
        case — `dcode`'s refusal names the three variables it would have
        accepted — so the report says which step it died at and stops rather
        than asking three more questions of a dead process.
        """
        if "_died" not in answer:
            return False
        found["agent_died_at"] = answer["_died"]
        found["agent_exit_code"] = proc.poll()
        return True

    try:
        info = request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "clientCapabilities": CLIENT_CAPABILITIES,
                "clientInfo": {"name": "wringer-probe", "version": "0"},
            },
        )
        result = info.get("result") or {}
        found["authMethods_present"] = "authMethods" in result
        found["authMethods"] = result.get("authMethods")
        found["agentInfo"] = result.get("agentInfo")

        session = {} if died(info) else request(
            "session/new", {"cwd": "/tmp", "mcpServers": []}
        )
        died(session)
        found["session_new_is_error"] = "error" in session
        found["session_new_error"] = session.get("error")
        found["session_new_opened"] = "sessionId" in (session.get("result") or {})

        session_id = (session.get("result") or {}).get("sessionId")
        if send_prompt and session_id:
            turn = request(
                "session/prompt",
                {
                    "sessionId": session_id,
                    "prompt": [{"type": "text", "text": PROBE_PROMPT}],
                },
                wait=PROMPT_TIMEOUT,
            )
            found["prompt_sent"] = True
            found["prompt_is_error"] = "error" in turn
            found["prompt_error"] = turn.get("error")
            found["prompt_result"] = turn.get("result")
            found["prompt_transport"] = turn.get("_transport")
            found["prompt_answered"] = (
                turn.get("result") or {}
            ).get("stopReason") == "end_turn"
        elif send_prompt:
            found["prompt_sent"] = False
            found["prompt_answered"] = False
    finally:
        # Without `--prompt` there is NO `session/prompt`: that is the paid
        # call, and by default the discipline of this probe is that it stops
        # one step short of it. `--prompt` is the operator saying, once and
        # explicitly, that this particular question is worth a turn.
        try:
            proc.stdin.close()
        except OSError:
            pass
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:  # pragma: no cover
            proc.kill()
        # **Join the drain before reading it.** An agent that dies at startup
        # writes its whole reason and exits in a few milliseconds, and the
        # reader thread had not necessarily appended it yet — so the one run
        # where `stderr_tail` matters most was the one where it could come
        # back empty.
        drain.join(timeout=5)
    stderr = "".join(errs)
    found["stderr_tail"] = stderr[-500:]
    # The adapter announces the route it actually took on stderr. Under
    # `--prompt` that line is the answer to "which credential served this
    # turn", and the 500-character tail above routinely scrolls past it.
    found["stderr_apiType_lines"] = [
        line.strip() for line in stderr.splitlines() if "apiType" in line
    ]
    return found


HANDSHAKE_KEYS = (
    "agent",
    "authMethods_present",
    "authMethods",
    "session_new_opened",
    "session_new_is_error",
    "session_new_error",
    "stderr_tail",
)

#: Printed only when the agent is no longer there. The pair IS the finding:
#: which step it died at, and what exit code it left. Its own sentence arrives
#: in `stderr_tail`, which is already printed.
DEATH_KEYS = ("agent_died_at", "agent_exit_code")

#: Printed only under `--prompt`, so that the default output stays exactly the
#: bytes every earlier capture of this script recorded.
PROMPT_KEYS = (
    "prompt_sent",
    "prompt_answered",
    "prompt_is_error",
    "prompt_error",
    "prompt_transport",
    "prompt_result",
    "stderr_apiType_lines",
)


def main(argv: list[str]) -> int:
    send_prompt = "--prompt" in argv
    agents = [arg for arg in argv if arg != "--prompt"]
    if not agents:
        print(__doc__)
        return 2
    for agent in agents:
        found = probe(agent, send_prompt=send_prompt)
        print("=" * 70)
        keys = HANDSHAKE_KEYS + (PROMPT_KEYS if send_prompt else ())
        # Appended, never interleaved, and only when there is a death to
        # report — so a healthy agent's output is byte-identical to what every
        # capture already in `docs/` recorded.
        if found.get("agent_died_at"):
            keys = keys + DEATH_KEYS
        for key in keys:
            print(f"{key:22} {json.dumps(found.get(key))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
