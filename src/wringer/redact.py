"""Keep secrets out of the evidence.

A bundle captures whatever a gate printed, so a tool that echoes
`$GITHUB_TOKEN` on failure would otherwise write a live credential to disk —
and `.wringer/` is one `git add -f` away from being public.

Redaction happens **before** the write, never as a cleanup pass: the raw
value must not reach the file at all (docs/specs/SPEC_VERIFY_V0.md §Config design,
rule 5). That is why gate output is captured through a pipe rather than
handed straight to a file descriptor.

What counts as a secret: the *value* of any environment variable whose
*name* matches a redaction pattern. Defaults are `*TOKEN*`, `*SECRET*` and
`*KEY*`; a repo's `.wringer.yaml` can add more, but cannot remove the defaults —
losing token protection should never be one line of config away.

**Three tiers, one `scrub`, applied on every write path** (0.7.4, run 4B):

1. the declared VALUES, whole, longest first — the tier that has been here
   since 0.1;
2. every measured credential SHAPE from `agents.py`'s rows, whether or not
   such a value was declared. Run 4B (2026-09-01) measured why: a vendor
   rejecting a dead key echoed `sk-proj-`, a run of `*` and the key's last
   four characters into the worker log, and the redactor owned none of
   those bytes because none of them was the declared value;
3. any run of `MIN_SECRET_LENGTH` or more characters equal to a PREFIX or a
   SUFFIX of a declared value — the masked echo above minus its shape, a
   key a worker wrapped across two lines, the head of a key a tool
   truncated. An interior run is not covered, and SECURITY.md says so.

Six, for the same reason the floor on a whole value is six: a five-character
head of a key is `sk-pr`, and scrubbing that scrubs prose. The number is one
constant so the two floors cannot drift apart.
"""

from __future__ import annotations

import fnmatch
import json
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass

DEFAULT_ENV_PATTERNS = ("*TOKEN*", "*SECRET*", "*KEY*")
PLACEHOLDER = "[REDACTED]"

# Values shorter than this are left alone. A two-character "secret" would
# match half the log and destroy the evidence it was meant to protect —
# and real credentials are not two characters long.
MIN_SECRET_LENGTH = 6

#: The shortest prefix or suffix of a declared value the third tier scrubs.
#: The SAME number as the floor on a whole value, on purpose: a value too
#: short to be a secret yields no fragment rule at all, and a fragment
#: shorter than this is a word (`sk-pr`, `ghp_a`) rather than a key.
FRAGMENT_MIN_LENGTH = MIN_SECRET_LENGTH


@dataclass(frozen=True)
class Redactor:
    """The secret values to erase, longest first — and the shapes to erase."""

    secrets: tuple[str, ...] = ()
    #: Compiled credential shapes (tier 2). Empty on a bare `Redactor()`,
    #: which is the "nothing declared" object tests build on purpose;
    #: `from_config` fills it from `agents.key_shapes()`, the only place a
    #: vendor's key shape may be spelled.
    shapes: tuple[re.Pattern[str], ...] = ()

    @classmethod
    def from_config(
        cls,
        evidence: Mapping[str, object] | None = None,
        environ: Mapping[str, str] | None = None,
        extra_names: tuple[str, ...] = (),
    ) -> Redactor:
        """Build the redactor for a run.

        `extra_names` are exact variable names to protect regardless of the
        patterns — `judge.api_key_env` names one, and folding its value in
        here is what stops a credential reaching a request body or a bundle
        even if something echoes it.
        """
        patterns = [pattern.upper() for pattern in _configured_patterns(evidence)]
        patterns += [name.upper() for name in extra_names]
        env = os.environ if environ is None else environ

        values = {
            value
            for name, value in env.items()
            if len(value) >= MIN_SECRET_LENGTH
            and any(fnmatch.fnmatchcase(name.upper(), p) for p in patterns)
        }
        # **Every JSON-ENCODED form too** (D8, 2026-08-29). The redactor
        # matches raw bytes, and Wringer itself JSON-encodes values before
        # they reach a log — `acp.py` writes `json.dumps(update)` into the
        # turn's updates. `json.dumps` escapes `"`, `\\` and every
        # non-ASCII character, so a secret containing any of them never
        # matched the pattern at all: the scrub ran, found nothing, and the
        # credential went into the bundle intact. The encoding is one Wringer
        # applies, not one the gate chose, so this is ours to undo.
        encoded = {
            json.dumps(value)[1:-1] for value in values
        }
        values |= {form for form in encoded if len(form) >= MIN_SECRET_LENGTH}
        # Longest first: if one secret contains another, replacing the short
        # one first would leave a recognisable tail of the long one behind.
        return cls(
            tuple(sorted(values, key=len, reverse=True)),
            shapes=known_shapes(),
        )

    def scrub(self, text: str) -> str:
        # Tier 1: the whole values. Tier 2 before tier 3, because a masked
        # echo is one token to the shape and two fragments to the third
        # tier — scrubbing its head first would leave a shape the regex no
        # longer recognises, with the key's tail still on it.
        for secret in self.secrets:
            text = text.replace(secret, PLACEHOLDER)
        for shape in self.shapes:
            text = shape.sub(PLACEHOLDER, text)
        for secret in self.secrets:
            text = _scrub_fragments(text, secret)
        return text

    def scrub_bytes(self, data: bytes) -> bytes:
        # ONE implementation, so a log written as bytes gets every tier the
        # text path has. `surrogateescape` both ways is lossless for bytes
        # that are not UTF-8, and a log carrying nothing to scrub comes
        # back byte-identical — a test proves it.
        text = data.decode("utf-8", "surrogateescape")
        return self.scrub(text).encode("utf-8", "surrogateescape")


def known_shapes() -> tuple[re.Pattern[str], ...]:
    """Tier 2's patterns, compiled from the vendor table and nowhere else.

    Imported lazily: `agents.py` imports `config.py`, and this module is
    imported by everything that writes, so a top-level import here would be
    a cycle waiting for the next reader.
    """
    from wringer import agents

    return tuple(re.compile(shape) for shape in agents.key_shapes())


def _scrub_fragments(text: str, secret: str) -> str:
    """Tier 3: every run of `FRAGMENT_MIN_LENGTH`+ characters that is a
    prefix or a suffix of `secret`, replaced with the placeholder.

    Greedy: a hit on the six-character head is extended as far as the text
    keeps matching the value, so `sk-proj-` and `sk-proj-Ab` are each one
    placeholder rather than a placeholder with a tail. The whole value was
    replaced by tier 1 before this runs, so the longest fragment left is
    one character short of it.
    """
    if len(secret) < FRAGMENT_MIN_LENGTH:
        return text
    text = _scrub_prefixes(text, secret)
    return _scrub_suffixes(text, secret)


def _scrub_prefixes(text: str, secret: str) -> str:
    head = secret[:FRAGMENT_MIN_LENGTH]
    out: list[str] = []
    cursor = 0
    while True:
        hit = text.find(head, cursor)
        if hit < 0:
            break
        length = FRAGMENT_MIN_LENGTH
        while (
            length < len(secret)
            and text.startswith(secret[: length + 1], hit)
        ):
            length += 1
        out.append(text[cursor:hit])
        out.append(PLACEHOLDER)
        cursor = hit + length
    out.append(text[cursor:])
    return "".join(out)


def _scrub_suffixes(text: str, secret: str) -> str:
    tail = secret[-FRAGMENT_MIN_LENGTH:]
    out: list[str] = []
    cursor = 0
    while True:
        hit = text.find(tail, cursor)
        if hit < 0:
            break
        start = hit
        length = FRAGMENT_MIN_LENGTH
        # Extend LEFT while the text keeps matching the value's tail, and
        # never back past the last thing already emitted.
        while (
            length < len(secret)
            and start > cursor
            and text[start - 1] == secret[-(length + 1)]
        ):
            start -= 1
            length += 1
        out.append(text[cursor:start])
        out.append(PLACEHOLDER)
        cursor = hit + FRAGMENT_MIN_LENGTH
    out.append(text[cursor:])
    return "".join(out)


def _configured_patterns(evidence: Mapping[str, object] | None) -> list[str]:
    """Defaults plus whatever the repo added — never fewer than the defaults."""
    patterns = list(DEFAULT_ENV_PATTERNS)
    if not evidence:
        return patterns
    redact = evidence.get("redact")
    if not isinstance(redact, Mapping):
        return patterns
    extra = redact.get("env")
    if isinstance(extra, list):
        patterns.extend(str(pattern) for pattern in extra)
    return patterns
