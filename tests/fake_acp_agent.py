#!/usr/bin/env python3
"""A minimal agent that really speaks ACP, for the test suite.

Not a mock of Wringer's client — a separate process exchanging real
JSON-RPC over stdio, so the tests exercise the wire rather than the author's
idea of the wire. No network, no API key, no vendor binary: CI can run this
anywhere, which is the whole reason it exists.

Behaviour is chosen by argv so one file covers every case the loop needs:

    fix        write the file that makes the gate pass, via fs/write_text_file
    escape     try to write outside the repo (must be refused)
    ownhands   fix the file with its OWN filesystem access, never through
               `fs/write_text_file` — what a real coding agent does, and
               the shape that converges a loop while Wringer's own ledger
               reads `files_written: 0`
    permission ask for permission, then fix
    idle       do nothing and stop cleanly
    unauth     answer the handshake, open a session, then REFUSE the prompt
               with `Authentication required` — the shape a coding agent that
               has never been logged in really has, captured verbatim from a
               product manager's machine on 2026-08-21. The handshake
               succeeding is the whole point: it is what makes this
               undetectable before the turn
    kimiauth   advertise ONE auth method at `initialize`, carrying a
               `_meta.terminal-auth` command, then REFUSE `session/new` with
               `Authentication required` — the Kimi-class shape, copied
               verbatim from `docs/acp-auth-2026-08-24.md`. The refusal is at
               the SESSION rather than at the prompt, which is what makes this
               a free preflight and `unauth` an expensive one
    plainrefusal
               refuse `session/new` for a NON-auth reason, with no
               `authMethods` in the error — the shape the preflight must not
               mistake for a logged-out agent
    leakrefusal
               refuse `session/new` with a passed-through credential inside
               `error.data` — the shape that makes carrying `data` verbatim a
               security question and not only a legibility one. An agent is
               handed a secret by name; nothing stops it handing the value
               back in an error, and that error now reaches a console as well
               as a bundle
    managed    refuse `session/new` with `-32603 Internal error` and the whole
               remedy inside `error.data.details` — the org-managed Mac's
               shape, reconstructed from the capture in
               `docs/field-report-2026-08-25.md` finding 1. The message alone
               says nothing; everything a person can act on is in the data,
               which is what made this the most expensive line in the report
    crash      exit mid-turn, before answering the prompt
    loudcrash  say something, THEN exit mid-turn — the shape where the
               agent's last words are the whole diagnostic value
    hang       accept the prompt and never answer
    env        report the NAMES of every variable it can see, then fix — the
               only way a test can assert what the agent was and was not given
    mute       read stdin and never answer ANYTHING, including `initialize` —
               a handshake that does not complete, which is what the
               control-plane ceiling exists for
    slow       think for argv[2] seconds, THEN fix — a turn that is working,
               just not quickly. The shape a real repair turn has, and the one
               a client-side per-request ceiling used to cut off
    deaf       answer session/new, then never read stdin again (pipe fills)
    garbage    emit a line that is not JSON, then behave
    noisy      flood stderr with far more than a pipe buffer holds, then
               fix. With stderr on a PIPE, nothing draining it means the
               agent blocks on write and the turn wedges.
    lastword   write to stderr and exit IMMEDIATELY — the bytes are in
               flight while the client is already stopping the process.
    leak       print a passed-through credential to stderr AND into a
               session/update, then fix. The shape §8 asks for: a secret
               planted in agent output, so a test can grep the bundle.
    usage      report token counts and a cost via usage_update — TWICE, so
               the cumulative-within-a-session rule has something to bite
               on — then fix.
    usageleak  report usage AND put a credential in the same notification,
               so the sibling file's own scrubbing is exercised rather than
               assumed.
    usageidle  report usage and then change NOTHING — a turn that really did
               spend money and really did produce no file. The only shape in
               which a `turn_changed_nothing` diagnosis carries telemetry in
               `engine_words`, which is what decides whether that field or
               the stop reason is the one quoted to a person.
    leakidle   say, in its LAST update, what a vendor says about a rejected
               key — the credential whole, the credential masked to its
               first three and last four characters, and a vendor-shaped
               token that was never declared — then change NOTHING. The
               shape run 4B measured (2026-09-01): those words become the
               diagnosis's `engine_words`, and `wring run --json` prints the
               diagnosis to a console no file scrub can reach.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import time


def _argv(index: int, default: str) -> str:
    """This file is BOTH a subprocess and an import.

    Its normal life is a spawned agent reading argv. But `REQUIRED` below is
    the double's contract and `tests/test_acp.py` asserts on it directly, so
    the module is also imported into the runner — where argv carries pytest's
    own flags, and a bare `float(sys.argv[2])` failed at import on `-q`.
    """
    return sys.argv[index] if len(sys.argv) > index else default


BEHAVIOUR = _argv(1, "fix")
# How long `slow` thinks before answering the prompt. On argv rather than in
# the environment because an ACP agent is given only what `env_passthrough`
# names, which is the behaviour under test elsewhere in this file.
try:
    DELAY_SECONDS = float(_argv(2, "0"))
except ValueError:
    DELAY_SECONDS = 0.0

# The variables `leak` will echo if they reached it. One matches the
# redactor's default `*KEY*` pattern and one deliberately matches none of
# them, so the two tests can tell the acp.py scrub apart from the
# env_passthrough folding.
LEAKABLE = ("WRINGER_TEST_API_KEY", "WRINGER_TEST_CREDENTIAL")


# What the protocol REQUIRES on each request, transcribed by hand from the
# published schema's `required` arrays (`@agentclientprotocol/sdk`,
# `schema/schema.json`). Transcribed rather than loaded: a test suite that
# reads a vendored copy of someone else's file is a suite whose fixtures go
# stale silently, and one that fetches it is a suite that phones a registry.
#
# **This table is here because its absence shipped a defect.** This agent used
# to answer `session/new` without looking at the request at all, so Wringer
# omitted `mcpServers` — required — and 1210 tests passed over a seam that had
# never once worked against a real agent, which refused every session with
# `Invalid params` naming exactly this field. A double more permissive than
# the thing it stands in for does not test a client; it launders it.
REQUIRED = {
    "initialize": ("protocolVersion",),
    "session/new": ("cwd", "mcpServers"),
    "session/prompt": ("sessionId", "prompt"),
}

# JSON-RPC's own code for invalid params, and the real agent's shape for
# saying which field is missing — copied from what `claude-agent-acp` 0.66.0
# actually returned, so a test asserting on this is asserting on the wire.
INVALID_PARAMS = -32602

# Verbatim from `kimi-code acp`, measured 2026-08-24 and captured in
# `docs/acp-auth-2026-08-24.md`, including the `_meta` block that hands the
# CLIENT a command to run. Wringer shows it and never runs it, so the command
# here is `/usr/bin/false`: if anything ever DID run it, the test that watches
# every spawn would see it by name.
#
# **TWO definitions, because the real agent sends TWO SHAPES.** Measured on
# `kimi-code acp` in one exchange: `initialize` nests the block under
# `_meta.terminal-auth` WITH a `command`, and the copy inside the `session/new`
# refusal is FLATTENED onto the method and has no `command` at all. A double
# that sent the rich shape in both places would let a client that ignores the
# handshake copy pass — and the first version of this file did exactly that,
# which a mutation caught.
AUTH_METHODS = [{
    "id": "login",
    "name": "Login with Kimi account",
    "description": "Run `kimi login` command in the terminal, then follow the "
                   "instructions to finish login.",
    "_meta": {"terminal-auth": {
        "command": "/usr/bin/false",
        "args": ["login"],
        "label": "Fake Login",
        "env": {},
        "type": "terminal",
    }},
}]

#: The refusal's copy, verbatim from the same measurement: flattened, and with
#: NO `command`. So the refusal says WHICH method is wanted and the handshake
#: says what running it would take.
REFUSAL_METHODS = [{
    "id": "login",
    "name": "Login with Kimi account",
    "description": AUTH_METHODS[0]["description"],
    "type": "terminal",
    "args": ["login"],
    "env": {},
}]


# JSON-RPC's own catch-all. It carries NO information: every agent that falls
# over anywhere sends this code, which is exactly why a client that renders the
# message alone renders nothing.
INTERNAL_ERROR = -32603

#: **The org-managed Mac's refusal, reconstructed from the field capture** —
#: `docs/field-report-2026-08-25.md` finding 1, which quotes the wire. The
#: string is the report's `data.details` with its `\n` escapes decoded, and it
#: is reconstructed rather than re-measured: the machine that produced it is
#: not this one, and no test may depend on a Mac being org-pinned.
#:
#: Every actionable word is in here and none of it is in `message`. That is the
#: property the guards are about: a surface showing `Internal error` alone has
#: shown the operator nothing, and it cost a whole session to find that out.
MANAGED_DETAILS = (
    "Claude Code process exited with code 1. stderr: This machine's managed "
    "settings require a first-party login, but an Anthropic-issued credential "
    "(ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or apiKeyHelper) is configured. "
    "A non-OAuth Anthropic credential cannot satisfy the org pin.\n\n"
    "Remove the credential and run: claude auth login\n\n"
    "If this is a third-party desktop session: forceLoginOrgUUID targets "
    "first-party OAuth and should be removed from managed-settings.json."
)


def send(message: dict) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def reply(request_id, result: dict) -> None:
    send({"jsonrpc": "2.0", "id": request_id, "result": result})


def refuse(request_id, missing: list[str]) -> None:
    send({
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {
            "code": INVALID_PARAMS,
            "message": "Invalid params",
            "data": {
                "_errors": [],
                **{name: {"_errors": ["Required value is missing"]}
                   for name in missing},
            },
        },
    })


def missing_fields(method: str, params: dict) -> list[str]:
    """Which required fields this request left out, in schema order."""
    if not isinstance(params, dict):
        return list(REQUIRED.get(method, ()))
    return [name for name in REQUIRED.get(method, ()) if name not in params]


def request(request_id: int, method: str, params: dict) -> dict:
    """Ask the client something and wait for its answer, ignoring anything
    else that arrives meanwhile."""
    send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        message = json.loads(line)
        if message.get("id") == request_id and (
            "result" in message or "error" in message
        ):
            return message
    return {}


def notify(session_id: str, text: str) -> None:
    send({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": {"sessionUpdate": "agent_message_chunk", "text": text},
        },
    })


def report(session_id: str, text: str) -> None:
    """One plain `session/update`, for an agent reporting a fact about its own
    session back to a test."""
    send({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": {"sessionUpdate": "agent_message_chunk", "text": text},
        },
    })


def usage(session_id: str, used: int, size: int, cost: dict | None = None,
          note: str | None = None) -> None:
    """A real `usage_update`, the shape the protocol defines: token counts on
    the update itself, an optional cost carrying the agent's own currency."""
    update = {"sessionUpdate": "usage_update", "used": used, "size": size}
    if cost is not None:
        update["cost"] = cost
    if note is not None:
        update["note"] = note
    send({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {"sessionId": session_id, "update": update},
    })


def main() -> int:
    if BEHAVIOUR == "garbage":
        sys.stdout.write("this is not json at all\n")
        sys.stdout.flush()

    session_id = "session-1"
    outbound = 1000

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            message = json.loads(raw)
        except json.JSONDecodeError:
            continue

        method = message.get("method")
        request_id = message.get("id")

        if BEHAVIOUR == "mute":
            # Answer nothing, but keep reading — so the client's stdin close
            # is still an EOF this process exits on, and the test measures the
            # ceiling rather than the kill that follows it.
            continue

        # BEFORE any behaviour branch: a malformed request is refused whatever
        # this agent was told to pretend to be, because a real one would.
        absent = missing_fields(method, message.get("params") or {})
        if absent and request_id is not None:
            refuse(request_id, absent)
            continue

        if method == "initialize":
            answer = {
                "protocolVersion": 1,
                "agentCapabilities": {},
                "agentInfo": {"name": "fake-acp-agent", "version": "0.0.1"},
            }
            if BEHAVIOUR == "kimiauth":
                answer["authMethods"] = AUTH_METHODS
            reply(request_id, answer)
        elif method == "session/new":
            if BEHAVIOUR == "crash":
                return 3
            if BEHAVIOUR == "plainrefusal":
                # A session refused for a reason that is NOT authentication,
                # and with no `authMethods` anywhere in it. The preflight
                # routes on that fact, so this must NOT stop a run — a
                # protocol error is not a logged-out agent.
                send({
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": INVALID_PARAMS,
                              "message": "cwd is not a directory"},
                })
                return 0
            if BEHAVIOUR == "leakrefusal":
                # The credential comes from the environment the client built,
                # so this leaks only what actually crossed the boundary —
                # a double that invented a secret would prove nothing about
                # the passthrough.
                said = " ".join(
                    f"{name}={os.environ[name]}"
                    for name in LEAKABLE if os.environ.get(name)
                )
                send({
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {
                        "code": INTERNAL_ERROR,
                        "message": "Internal error",
                        "data": {"details": f"could not start: {said}"},
                    },
                })
                return 0
            if BEHAVIOUR == "managed":
                # **The refusal whose whole value is in `data`.** Nothing here
                # is guessed: the code, the message and the details are the
                # field capture. A double that put the remedy in `message`
                # would test a wire no agent sends and would pass with the
                # rendering fix reverted.
                send({
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {
                        "code": INTERNAL_ERROR,
                        "message": "Internal error",
                        "data": {"details": MANAGED_DETAILS},
                    },
                })
                return 0
            if BEHAVIOUR == "kimiauth":
                # **`data.authMethods` is on the refusal, and that is the whole
                # point.** Measured on `kimi-code acp`: the error object itself
                # carries the methods, which is the agent saying in its own
                # reply that this refusal is about authentication. Wringer
                # routes on that fact rather than on the message text, so a
                # double that omitted it would be testing a different wire —
                # and the first version of this mode did omit it, which the
                # guard caught.
                send({
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {
                        "code": -32000,
                        "message": "Authentication required",
                        "data": {"authMethods": REFUSAL_METHODS},
                    },
                })
                return 0
            if BEHAVIOUR == "cwd":
                # Report the working directory the CLIENT named, over the
                # wire, so a test can assert what Wringer actually sent rather
                # than what a dict in the client's own process said. Under a
                # containment this must be the mount, not a host path that
                # does not exist inside the boundary.
                params = message.get("params") or {}
                report(session_id, f"CWD {params.get('cwd')}")
            reply(request_id, {"sessionId": session_id})
            if BEHAVIOUR == "deaf":
                # Answer, then stop reading stdin FOREVER. The client's next
                # write fills the pipe buffer and blocks — and that block is
                # armed before any of the turn's deadlines exist, so without a
                # bounded write nothing ever fires. The eight-hour incident's
                # shape, in the seam built to honour its lessons.
                time.sleep(3600)
                return 0
        elif method == "session/prompt":
            if BEHAVIOUR == "unauth":
                # **The handshake already succeeded.** `initialize` and
                # `session/new` both answered normally, which is not this
                # double being lenient — it is measured behaviour: on
                # 2026-08-21 both an authenticated and an unauthenticated
                # `claude-agent-acp` answered them identically, `authMethods`
                # empty in both. The refusal only exists at the turn, which is
                # the call that costs money, and that is why no preflight can
                # catch this one.
                send({
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32000, "message": "Authentication required"},
                })
                return 0
            if BEHAVIOUR == "hang":
                # accept, then never answer: the client's request timeout and
                # the loop's worker_timeout are what must save us
                while True:
                    line = sys.stdin.readline()
                    if not line:
                        return 0
            notify(session_id, f"working ({BEHAVIOUR})")

            if BEHAVIOUR == "env":
                # NAMES only, never values. The point is which variables
                # crossed the boundary; printing their contents would put the
                # very credentials under test into a log.
                notify(session_id, "env: " + " ".join(sorted(os.environ)))

            if BEHAVIOUR == "slow":
                # Working, not hung: the client is holding an open prompt
                # request the whole time, which is exactly the wait a real
                # repair turn produces.
                time.sleep(DELAY_SECONDS)

            if BEHAVIOUR == "loudcrash":
                notify(session_id, "THE LAST THING THE AGENT SAID")
                sys.stdout.flush()
                return 3

            if BEHAVIOUR == "noisy":
                # 200 KB, well past the 64 KB a pipe buffer holds.
                for n in range(2000):
                    sys.stderr.write(f"noise line {n:05d} " + "x" * 90 + "\n")
                sys.stderr.flush()

            if BEHAVIOUR == "lastword":
                sys.stderr.write("THE LAST BYTES BEFORE THE EXIT\n")
                sys.stderr.flush()
                return 0

            if BEHAVIOUR == "leak":
                # Both paths acp.py writes: the child's own stderr, which
                # used to be a raw file handle, and a session/update, whose
                # text used to be joined and written unscrubbed.
                for name in LEAKABLE:
                    value = os.environ.get(name)
                    if value:
                        sys.stderr.write(f"stderr says {name}={value}\n")
                        sys.stderr.flush()
                        notify(session_id, f"update says {name}={value}")


            if BEHAVIOUR == "leakidle":
                value = os.environ.get("WRINGER_TEST_CREDENTIAL", "")
                masked = f"{value[:3]}\u2026{value[-4:]}" if value else ""
                notify(
                    session_id,
                    "Incorrect API key provided: " + masked
                    + f" (whole: {value}) and a key nobody declared: "
                    + "sk-proj-NEVERDECLARED0000111122223333",
                )

            if BEHAVIOUR in ("usage", "usageleak", "usageidle"):
                # A credential inside the SAME notification for `usageleak`,
                # so the sibling file's scrubbing is exercised rather than
                # assumed — the numbers cannot carry a secret, but an agent
                # controls every other field on the update.
                note = None
                if BEHAVIOUR == "usageleak":
                    value = os.environ.get("WRINGER_TEST_CREDENTIAL")
                    if value:
                        note = f"spent while holding {value}"
                # Twice, smaller then larger, in ONE session: `used` is
                # cumulative, so the later figure supersedes rather than adds.
                usage(session_id, 900, 200000, {"amount": 0.03, "currency": "USD"},
                      note)
                usage(session_id, 1234, 200000,
                      {"amount": 0.0412, "currency": "USD"}, note)

            if BEHAVIOUR == "permission":
                outbound += 1
                request(outbound, "session/request_permission", {
                    "sessionId": session_id,
                    "toolCall": {"title": "write calc.py", "kind": "edit"},
                    "options": [
                        {"optionId": "yes", "name": "Allow", "kind": "allow_once"},
                        {"optionId": "no", "name": "Deny", "kind": "reject_once"},
                    ],
                })

            if BEHAVIOUR == "containedwrite":
                # A path as the agent SEES it from inside the boundary. It
                # resolves only if Wringer translated /workspace back to the
                # host tree before resolving — and if it did not, the write is
                # refused and the gate stays red, which is the failure this
                # behaviour exists to make visible.
                outbound += 1
                answer = request(outbound, "fs/write_text_file", {
                    "sessionId": session_id,
                    "path": "/workspace/calc.py",
                    "content": "FIXED\n",
                })
                report(session_id, f"contained write refused: {'error' in answer}")
            elif BEHAVIOUR in ("fix", "permission", "garbage", "leak", "noisy",
                               "slow", "env", "usage", "usageleak", "cwd"):
                outbound += 1
                request(outbound, "fs/write_text_file", {
                    "sessionId": session_id,
                    "path": "calc.py",
                    "content": "FIXED\n",
                })
            elif BEHAVIOUR == "ownhands":
                # **Writes the file ITSELF, never through the client.** This
                # is what a real coding agent does — it holds the filesystem
                # and has no reason to ask Wringer for it — and until
                # 2026-08-22 nothing in this suite covered it. The shape
                # matters because Wringer's ledger can only count what crosses
                # its own `fs/` channel, so this turn converges the loop with
                # `files_written: 0`, and every inference drawn from that
                # counter is wrong about it.
                pathlib.Path("calc.py").write_text("FIXED\n", encoding="utf-8")
            elif BEHAVIOUR == "escape":
                outbound += 1
                answer = request(outbound, "fs/write_text_file", {
                    "sessionId": session_id,
                    "path": "../escaped.txt",
                    "content": "should never be written\n",
                })
                notify(session_id, f"refused: {'error' in answer}")

            reply(request_id, {"stopReason": "end_turn"})
            return 0
        elif request_id is not None:
            reply(request_id, {})

    return 0


if __name__ == "__main__":
    sys.exit(main())
