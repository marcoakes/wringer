#!/usr/bin/env python3
"""A minimal ACP agent that really calls a model, for the PM-mode capture.

Not a mock and not Wringer's client: a separate process exchanging real
JSON-RPC over stdio with `wringer.acp`, whose `session/prompt` turn sends the
brief to a real endpoint and writes the reply back through the client's own
`fs/write_text_file`. Its wire is the one `tests/fake_acp_agent.py` proved
against the engine; only the turn is different.

It is NOT a vendor agent and this repository has never driven one. The capture
says so by name — nothing here licenses a claim about Gemini CLI, Goose or
Kimi, none of which is installed on this runtime.

The key arrives through the environment the client chose to pass through, so
what this agent can see is `run.worker.acp.env_passthrough`'s decision and not
this file's.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request


def _argv(index: int, default: str) -> str:
    return sys.argv[index] if len(sys.argv) > index else default


# argv over the environment, so nothing has to be passed through a boundary
# for this agent to work: `run.worker.acp.env_passthrough` withholds
# everything it does not name, and an agent that needs a variable named there
# makes the operator widen what crosses it.
ENDPOINT = _argv(1, os.environ.get("ACP_AGENT_ENDPOINT", ""))
MODEL = _argv(2, os.environ.get("ACP_AGENT_MODEL", "claude-sonnet-4-6"))
_KEYFILE = _argv(3, "")
API_KEY = (
    open(_KEYFILE).read().strip() if _KEYFILE and os.path.isfile(_KEYFILE)
    else os.environ.get("ACP_AGENT_KEY", "")
)

INVALID_PARAMS = -32602
REQUIRED = {
    "session/new": ("cwd",),
    "session/prompt": ("sessionId", "prompt"),
}

SYSTEM = (
    "You repair a repository so its failing check passes. You are given the "
    "brief and the check's output. Reply with ONLY a JSON object, no prose "
    "and no code fence:\n"
    '{"files": [{"path": "<repo-relative path>", "content": "<entire new '
    'file contents>"}]}\n'
    "Write whole files, never diffs. Change the smallest number of files "
    "that makes the check pass. Never edit a test file."
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
    if not isinstance(params, dict):
        return list(REQUIRED.get(method, ()))
    return [name for name in REQUIRED.get(method, ()) if name not in params]


def request(request_id: int, method: str, params: dict) -> dict:
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


def prompt_text(prompt) -> str:
    """The brief, however the client chose to shape it.

    Handled as a shape rather than a schema on purpose: this agent asserts
    nothing about the client's block format, so a change there costs a worse
    prompt rather than a crash mid-turn.
    """
    if isinstance(prompt, str):
        return prompt
    parts = []
    for block in prompt if isinstance(prompt, list) else []:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict):
            text = block.get("text") or block.get("content")
            if isinstance(text, str):
                parts.append(text)
    return "\n".join(parts)


SKIP = (".git", ".wringer", "__pycache__", ".venv", "venv", "briefs",
        "node_modules",
        # Vendored third-party sources the worker is not asked to change,
        # and which would crowd out the code it IS asked to change.
        "games")

# **Not just Python.** This read `.py`, `.md` and `.txt` only, so against a
# JavaScript repository it sent the model no source whatsoever — the model
# then returned nothing usable and the loop stopped with `no_progress`
# having changed not one byte. Found by driving a JS project, not by reading.
READABLE = (".py", ".md", ".txt", ".js", ".mjs", ".cjs", ".ts",
            ".html", ".css", ".json", ".yaml", ".yml")


def repo_context(root: str) -> str:
    """The repository's own text, so the model repairs what is there.

    Without this the agent writes plausible code against an imagined file and
    the loop refuses to converge — which is the loop working, and a waste of a
    turn. Reading is the agent's job: `fs/write_text_file` is a write channel
    and inventing the current contents is not a substitute for knowing them.
    """
    import pathlib

    parts = []
    base = pathlib.Path(root)
    for path in sorted(base.rglob("*")):
        if not path.is_file() or path.suffix not in READABLE:
            continue
        if any(skip in path.parts for skip in SKIP):
            continue
        try:
            body = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if len(body) > 20_000:
            continue
        parts.append(f"--- {path.relative_to(base)} ---\n{body}")
    return "\n\n".join(parts)


def ask_the_model(brief: str) -> list[dict]:
    # **No `temperature`.** Every current-generation Anthropic model refuses
    # it outright (HTTP 400, "`temperature` is deprecated for this model"),
    # which is the same defect the engine's own drafter carried until
    # 2026-08-18. This agent is not the engine, and the fix is the same shape.
    body = json.dumps({
        "model": MODEL,
        "max_tokens": 8000,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": brief},
        ],
    }).encode()
    call = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {API_KEY}",
        },
    )
    with urllib.request.urlopen(call, timeout=180) as answer:
        payload = json.load(answer)
    content = payload["choices"][0]["message"]["content"]
    start, end = content.find("{"), content.rfind("}")
    # **THREE ways this used to say "no files" without saying anything.**
    #
    # A worker that returns an empty list is indistinguishable, to everything
    # downstream, from a worker that looked and found nothing to change — and
    # `no_progress` is exactly that sentence. This harness produced the
    # measurements the PM-plan work rests on while carrying the same silent-
    # emptiness class that work spent a window removing from the engine. A
    # tool used to check for silence must not be silent itself.
    if start < 0 or end < 0:
        print(
            "acp_model_agent: the reply contained no JSON object at all, so "
            "no files were parsed. This is NOT the model declining to change "
            f"anything — it is a reply this harness could not read. First 200 "
            f"characters: {content.strip()[:200]!r}",
            file=sys.stderr,
        )
        return []
    parsed = json.loads(content[start:end + 1])
    if "files" not in parsed:
        print(
            "acp_model_agent: the reply was JSON but carried no `files` key, "
            f"so nothing was written. Keys it did carry: {sorted(parsed)}",
            file=sys.stderr,
        )
        return []
    files = parsed.get("files") or []
    if not files:
        print(
            "acp_model_agent: the reply carried an EMPTY `files` list — the "
            "model was asked to change something and returned nothing. That "
            "is a real answer, and it is being said out loud rather than "
            "reaching the loop as an unexplained no-op turn.",
            file=sys.stderr,
        )
    usable = [f for f in files if isinstance(f, dict) and f.get("path")]
    if len(usable) != len(files):
        print(
            f"acp_model_agent: {len(files) - len(usable)} of {len(files)} "
            "entries had no `path` and were dropped — named here rather than "
            "vanishing into a shorter list.",
            file=sys.stderr,
        )
    return usable


def main() -> int:
    session_id = "session-1"
    outbound = 1000
    # Bound BEFORE the loop: a `session/prompt` that arrives without a
    # preceding `session/new` would otherwise raise NameError mid-turn, and a
    # turn that dies that way is indistinguishable to the loop from one that
    # chose to change nothing.
    cwd = os.getcwd()

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

        absent = missing_fields(method, message.get("params") or {})
        if absent and request_id is not None:
            refuse(request_id, absent)
            continue

        if method == "initialize":
            reply(request_id, {
                "protocolVersion": 1,
                "agentCapabilities": {},
                "agentInfo": {"name": "acp-model-agent", "version": "0.0.1"},
            })
        elif method == "session/new":
            # The cwd the CLIENT named, not one this process assumed: under a
            # containment it is the mount, and a path guessed here would not
            # exist inside the boundary.
            cwd = (message.get("params") or {}).get("cwd") or os.getcwd()
            reply(request_id, {"sessionId": session_id})
        elif method == "session/prompt":
            params = message.get("params") or {}
            brief = prompt_text(params.get("prompt"))
            brief = f"{brief}\n\nThe repository as it stands:\n{repo_context(cwd)}"
            notify(session_id, f"asking {MODEL} to repair this")
            try:
                files = ask_the_model(brief)
            except Exception as exc:                       # noqa: BLE001
                # The turn's failure is the agent's to REPORT, never to hide:
                # a turn that dies silently looks to the loop exactly like one
                # that changed nothing on purpose.
                notify(session_id, f"the endpoint could not be used: {exc}")
                reply(request_id, {"stopReason": "end_turn"})
                continue

            for entry in files:
                outbound += 1
                notify(session_id, f"writing {entry['path']}")
                request(outbound, "fs/write_text_file", {
                    "sessionId": session_id,
                    "path": entry["path"],
                    "content": entry.get("content", ""),
                })
            reply(request_id, {"stopReason": "end_turn"})
        elif request_id is not None:
            reply(request_id, {})

    return 0


if __name__ == "__main__":
    sys.exit(main())
