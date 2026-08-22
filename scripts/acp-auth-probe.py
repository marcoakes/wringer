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
    proc = subprocess.Popen(
        [command],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    errs: list[str] = []
    threading.Thread(target=lambda: errs.extend(proc.stderr), daemon=True).start()

    found: dict = {"agent": command}
    counter = [0]

    def request(method: str, params: dict, wait: float | None = None) -> dict:
        counter[0] += 1
        rid = counter[0]
        proc.stdin.write(
            json.dumps(
                {"jsonrpc": "2.0", "id": rid, "method": method, "params": params}
            )
            + "\n"
        )
        proc.stdin.flush()
        limit = timeout if wait is None else wait
        deadline = time.monotonic() + limit
        while time.monotonic() < deadline:
            line = proc.stdout.readline()
            if not line:
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
                proc.stdin.write(json.dumps(declined) + "\n")
                proc.stdin.flush()
        return {"_transport": f"no reply to {method} within {limit}s"}

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

        session = request("session/new", {"cwd": "/tmp", "mcpServers": []})
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
        for key in keys:
            print(f"{key:22} {json.dumps(found.get(key))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
