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
"""

from __future__ import annotations

import json
import subprocess
import sys
import threading
import time

PROTOCOL_VERSION = 1
CLIENT_CAPABILITIES = {"fs": {"readTextFile": True, "writeTextFile": True}}


def probe(command: str, timeout: float = 25.0) -> dict:
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

    def request(method: str, params: dict) -> dict:
        counter[0] += 1
        rid = counter[0]
        proc.stdin.write(
            json.dumps(
                {"jsonrpc": "2.0", "id": rid, "method": method, "params": params}
            )
            + "\n"
        )
        proc.stdin.flush()
        deadline = time.monotonic() + timeout
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
        return {"_transport": f"no reply to {method} within {timeout}s"}

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
    finally:
        # NO `session/prompt`. That is the paid call, and the entire discipline
        # of this probe is that it stops one step short of it.
        try:
            proc.stdin.close()
        except OSError:
            pass
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:  # pragma: no cover
            proc.kill()
    found["stderr_tail"] = "".join(errs)[-500:]
    return found


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    for agent in argv:
        found = probe(agent)
        print("=" * 70)
        for key in (
            "agent",
            "authMethods_present",
            "authMethods",
            "session_new_opened",
            "session_new_is_error",
            "session_new_error",
            "stderr_tail",
        ):
            print(f"{key:22} {json.dumps(found.get(key))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
