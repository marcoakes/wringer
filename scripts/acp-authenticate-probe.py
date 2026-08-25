#!/usr/bin/env python3
"""What does the ACP auth handshake ACTUALLY do? Measured, before it is built.

Fable's R2 (`~/Claude/WRINGER_LEVELUP_RULINGS_2026-08-22.md`) rules that
Wringer's ACP client should implement the protocol's auth handshake: declare
the capability at `initialize`, read `authMethods`, and drive `authenticate`
with the operator's declared credential. **Spec-first, because it touches the
consent boundary** — and measurement-first before that, because four rounds of
the hunt died to mechanisms that looked right when read.

The questions this answers, none of which cost a paid turn:

  A1  What does each agent advertise in `authMethods` at `initialize`?
  A2  Does the advertised set depend on what the CLIENT declares? (If it does,
      "the agent offers no methods" is a fact about our request, not the agent.)
  A3  What does `authenticate` do with a method id the agent never offered?
      That error shape is what a real implementation has to survive.
  A4  What does `authenticate` do with a REAL offered id?
  A5  Does `session/new` behave differently after `authenticate`?

Run it against whatever is on PATH:

    python3 scripts/acp-authenticate-probe.py claude-agent-acp "dcode --acp"

**It never sends `session/prompt`.** Everything here is free.
"""

from __future__ import annotations

import json
import queue
import shlex
import subprocess
import sys
import threading
import time

PROTOCOL_VERSION = 1

#: The three shapes worth asking the same agent about. If `authMethods` moves
#: between them, the set is a function of the REQUEST and every claim of the
#: form "this agent offers no methods" needs the request beside it.
CAPABILITY_SHAPES = {
    "fs-only (what Wringer sends today)": {
        "fs": {"readTextFile": True, "writeTextFile": True}
    },
    "nothing at all": {},
    "fs + terminal": {
        "fs": {"readTextFile": True, "writeTextFile": True},
        "terminal": True,
    },
}


def exchange(command: str, requests, timeout: float = 20.0) -> dict:
    """Send a sequence of requests to one agent and return every reply."""
    try:
        proc = subprocess.Popen(
            shlex.split(command), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, bufsize=1,
        )
    except (OSError, ValueError) as exc:
        return {"_spawn_failed": f"{type(exc).__name__}: {exc}"}

    errs: list[str] = []
    drain = threading.Thread(target=lambda: errs.extend(proc.stderr), daemon=True)
    drain.start()

    # **A READER THREAD, because `readline()` has no deadline.** The first
    # version of this script checked the clock BETWEEN reads and then called
    # `proc.stdout.readline()`, which blocks forever on an agent that opens
    # its pipes and says nothing. Measured: it wedged for fourteen minutes on
    # `kimi-code acp` against a twenty-second ceiling. That is the exact defect
    # `tests/test_timeout_never_grants.py` exists to refuse — nothing waits
    # without a deadline — in the instrument written to measure the surface
    # that rule is about. `acp.py`'s own `Connection` already reads on a
    # thread for the same reason; this is that, minimally.
    inbox: queue.Queue = queue.Queue()

    def pump() -> None:
        try:
            for raw in proc.stdout:
                inbox.put(raw)
        except (OSError, ValueError):
            pass
        inbox.put(None)

    threading.Thread(target=pump, daemon=True).start()
    replies: dict = {}
    counter = 0

    def send(method, params):
        nonlocal counter
        counter += 1
        rid = counter
        try:
            proc.stdin.write(json.dumps(
                {"jsonrpc": "2.0", "id": rid, "method": method, "params": params}
            ) + "\n")
            proc.stdin.flush()
        except (BrokenPipeError, OSError, ValueError):
            return {"_died": method, "_exit": proc.poll()}
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return {"_timeout": method, "_exit": proc.poll()}
            try:
                line = inbox.get(timeout=min(remaining, 1.0))
            except queue.Empty:
                continue
            if line is None:
                return {"_died": method, "_exit": proc.poll()}
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if message.get("id") == rid:
                return message
            if "method" in message and "id" in message:
                try:
                    proc.stdin.write(json.dumps({
                        "jsonrpc": "2.0", "id": message["id"],
                        "error": {"code": -32601,
                                  "message": "probe implements nothing"},
                    }) + "\n")
                    proc.stdin.flush()
                except (BrokenPipeError, OSError, ValueError):
                    return {"_died": method, "_exit": proc.poll()}
        return {"_timeout": method}

    try:
        for label, method, params in requests(send):
            replies[label] = send(method, params) if method else params
    finally:
        try:
            proc.stdin.close()
        except OSError:
            pass
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:  # pragma: no cover
            proc.kill()
        drain.join(timeout=5)
    replies["_stderr"] = "".join(errs)[-400:]
    return replies


FS_ONLY_LABEL = "fs-only (what Wringer sends today)"
FS_ONLY = CAPABILITY_SHAPES[FS_ONLY_LABEL]


def initialize(capabilities):
    return ("initialize", {
        "protocolVersion": PROTOCOL_VERSION,
        "clientCapabilities": capabilities,
        "clientInfo": {"name": "wringer-authenticate-probe", "version": "0"},
    })


def measure(command: str) -> None:
    print("=" * 74)
    print(f"AGENT: {command}")
    print("=" * 74)

    # ---- A1 + A2: does the advertised set depend on the request? ----
    advertised = {}
    for label, capabilities in CAPABILITY_SHAPES.items():
        def once(send, capabilities=capabilities):
            yield ("init", *initialize(capabilities))
        got = exchange(command, once)
        if "_spawn_failed" in got:
            print(f"  spawn failed: {got['_spawn_failed']}")
            return
        result = (got.get("init") or {}).get("result") or {}
        methods = result.get("authMethods")
        advertised[label] = methods
        present = "authMethods" in result
        print(f"  A1 [{label}]")
        print(f"       present in the reply : {present}")
        print(f"       value                : {json.dumps(methods)}")

    distinct = {json.dumps(v, sort_keys=True) for v in advertised.values()}
    print(f"  A2 the advertised set is the SAME across all three requests: "
          f"{len(distinct) == 1}")
    if len(distinct) != 1:
        print("     *** it depends on the CLIENT's declaration — any claim that "
              "this agent 'offers no methods' must name the request ***")

    offered = advertised[FS_ONLY_LABEL] or []

    # ---- A3: authenticate with an id the agent never offered ----
    def bogus(send):
        yield ("init", *initialize(FS_ONLY))
        yield ("auth", "authenticate",
               {"methodId": "wringer-probe-not-a-real-method"})
        yield ("session", "session/new", {"cwd": "/tmp", "mcpServers": []})
    got = exchange(command, bogus)
    auth = got.get("auth") or {}
    print("  A3 authenticate with an id that was never offered:")
    print(f"       error   : {json.dumps(auth.get('error'))[:300]}")
    print(f"       result  : {json.dumps(auth.get('result'))[:200]}")
    print(f"       died?   : {auth.get('_died')} exit={auth.get('_exit')}")
    survived = "session" in got and not got["session"].get("_died")
    print(f"  A3 the agent SURVIVED a rejected authenticate: {survived}")

    # ---- A4/A5: a real offered id ----
    if offered:
        real = offered[0].get("id")
        print(f"  A4 authenticate with the agent's OWN first method id: {real!r}")

        def genuine(send):
            yield ("init", *initialize(FS_ONLY))
            yield ("auth", "authenticate", {"methodId": real})
            yield ("session", "session/new", {"cwd": "/tmp", "mcpServers": []})
        got = exchange(command, genuine, timeout=45.0)
        auth = got.get("auth") or {}
        print(f"       error   : {json.dumps(auth.get('error'))[:400]}")
        print(f"       result  : {json.dumps(auth.get('result'))[:200]}")
        session = got.get("session") or {}
        print(f"  A5 session/new after authenticate: "
              f"error={json.dumps(session.get('error'))[:200]}")
    else:
        print("  A4 SKIPPED — this agent advertises no method to drive.")
        print("  A5 SKIPPED — nothing to authenticate with.")
    if got.get("_stderr"):
        print(f"  stderr tail: {got['_stderr'][-200:]!r}")
    print()


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    for command in argv:
        measure(command)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
