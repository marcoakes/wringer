#!/usr/bin/env python3
"""Does Wringer's ONE socket reach a vendor's OpenAI-compatible endpoint?

The BRAIN lane of `docs/vendors.md`: the model that drafts a spec and judges a
rubric. Wringer talks to it through exactly one function — `judge.send`, a
chat-completions POST with a Bearer header — so "the brain runs on any
OpenAI-compatible endpoint" is a structural fact about this repository rather
than a claim about any vendor. This script measures it per vendor.

**It is designed to be run with NO real credential.** Pass a dummy key and the
vendor answers with an authentication refusal; that refusal is the
measurement. It proves three things at once — the endpoint accepts the request
shape Wringer posts, the Authorization header crossed the wire, and the only
missing thing is a key. It cannot prove a real key would be accepted, and this
script never claims that: `docs/vendors.md` records such a row as
BLOCKED-ON-CREDENTIAL, not as working.

    python3 scripts/vendor-brain-probe.py                       # every row
    python3 scripts/vendor-brain-probe.py deepseek glm          # some rows
    WRINGER_PROBE_KEY=... python3 scripts/vendor-brain-probe.py deepseek

With a REAL key in `WRINGER_PROBE_KEY` the same script sends one minimal turn
and reports whether it was answered. Keys are never printed: only the vendor's
own reply is, and the vendors mask the key in their refusals themselves.

Endpoints and model names below come from each vendor's CURRENT official
documentation, read on the date in `docs/vendors.md`, never from recall. A
model name nobody could verify from official docs does not get printed.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from wringer import judge  # noqa: E402

#: Alphabetical, like the matrix — no vendor is listed above any other.
VENDORS: dict[str, tuple[str, str]] = {
    "anthropic": ("https://api.anthropic.com/v1/chat/completions", "claude-opus-5"),
    "deepseek": ("https://api.deepseek.com/chat/completions", "deepseek-v4-pro"),
    "glm": ("https://api.z.ai/api/paas/v4/chat/completions", "glm-5.3"),
    "moonshot": ("https://api.moonshot.ai/v1/chat/completions", "kimi-k3"),
    "openai": ("https://api.openai.com/v1/chat/completions", "gpt-5.2"),
}

DUMMY = "sk-dummy-not-a-real-key"
TURN = {
    "messages": [{"role": "user", "content": "Reply with the single word ok."}],
    "max_tokens": 8,
}


def probe(name: str, endpoint: str, model: str, key: str) -> dict:
    found = {"vendor": name, "endpoint": endpoint, "model": model}
    found["credential"] = "real" if key is not DUMMY else "dummy"
    try:
        reply = judge.send(dict(TURN, model=model), endpoint, timeout=60, api_key=key)
    except judge.TransportFailed as exc:
        found["reached"] = False
        found["transport"] = str(exc)
        body = getattr(getattr(exc, "__cause__", None), "read", None)
        if body is not None:
            try:
                found["vendor_said"] = body().decode("utf-8", "replace")[:400]
            except OSError:  # pragma: no cover - the socket is already closed
                pass
        # An auth refusal IS the measurement: the shape and the header
        # crossed, and nothing but the credential is absent.
        found["auth_refusal"] = any(
            mark in str(exc) for mark in ("401", "403", "Unauthorized", "Forbidden")
        )
        return found
    found["reached"] = True
    found["auth_refusal"] = False
    text = (
        (reply.get("choices") or [{}])[0].get("message", {}).get("content")
        if isinstance(reply, dict)
        else None
    )
    found["answered"] = bool(text)
    found["reply_text"] = (text or "")[:200]
    return found


def main(argv: list[str]) -> int:
    wanted = [a for a in argv if not a.startswith("-")] or list(VENDORS)
    unknown = [w for w in wanted if w not in VENDORS]
    if unknown:
        print(f"no such vendor row: {', '.join(unknown)}", file=sys.stderr)
        print(f"known: {', '.join(VENDORS)}", file=sys.stderr)
        return 2
    key = os.environ.get("WRINGER_PROBE_KEY") or DUMMY
    for name in wanted:
        endpoint, model = VENDORS[name]
        found = probe(name, endpoint, model, key)
        print("=" * 70)
        for field in (
            "vendor", "endpoint", "model", "credential", "reached",
            "auth_refusal", "answered", "reply_text", "transport", "vendor_said",
        ):
            if field in found:
                print(f"{field:14} {json.dumps(found[field])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
