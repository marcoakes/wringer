"""What a gate leaves for a person to LOOK at — SPEC_BOARD_V0 §10, slice S4.

`schema/gate-result.schema.json` is closed over exactly nine fields with
`additionalProperties: false`, so a gate leaves `stdout.log`, `stderr.log`,
`result.json` and nothing else. PM_ARC §3.4's *"the criterion shows itself"* had
nowhere to live.

**A NEW sibling file, never a relabel of the closed v1** (ruling 24, law 7).
`result.json` gains no field and changes no meaning. Artifacts are declared in
`gates/NNN_<id>/artifacts.json`, schema `wringer.gate-artifacts.v1`, on the
pattern this repository has already used twice for exactly this reason:
`digests.json` beside a frozen `wringer.evidence.v1` and `briefed.json` beside a
frozen `wringer.loop.v2`. **The ABSENCE of the file is the compatibility
boundary** — every bundle written before it existed, and every gate that leaves
no artifact, reads exactly as it does today.

**What is recorded: filename, byte size, sha256, media type. No caption, no
label, no meaning.** The harness does not get to say what a picture shows.

**A BINARY ARTIFACT IS NOT REDACTED, and the reason is worth stating exactly
because the obvious version of it is wrong.**

`redact.py` does have a `scrub_bytes`, so it *could* be pointed at a PNG. It is
not, for two reasons and the first is the decisive one:

1. **Substring replacement changes length.** `PLACEHOLDER` is not the same size
   as the secret it replaces, so scrubbing inside a compressed or
   length-prefixed format produces a **corrupt file that still reads as
   evidence** — which is precisely the defect ruling 25 refuses about
   truncation, arrived at from the other direction. Corrupting a screenshot to
   protect it is not protecting it.
2. **Even a perfect substring pass would not help.** It removes byte-identical
   copies of values it already knows. A screenshot can carry a token *rendered
   on a page as pixels*, a customer's name in a fixture, an API key in a URL
   bar — none of which is a literal copy of an environment variable's value,
   and no pattern in `.wringer.yaml` will remove any of it.

So the honest position is: text artifacts go through the same scrub as any
other captured text; binaries are recorded unredacted and every row says which
kind it is. Three consequences, ruled rather than hoped:

1. The limit is stated where a reader will meet it — in the schema
   description, in the config key's docstring, and in every artifact row's
   `redacted` field.
2. Artifacts are **opt-in per gate**. Turning them on is a repo declaring that
   this gate's output is shareable.
3. Artifacts **never leave the machine by default**: not in the MR body, not in
   an attestation payload, not in anything `wring deliver --send` transmits.
   They live in the bundle, which is already one `git add -f` away from being
   public and is documented as such.

**Digest coverage costs nothing.** `evidence.digest_directory` walks every file
in a bundle and `attest.check_digests` catches added, missing AND altered files,
so these and `artifacts.json` are covered by the existing writer and `wring
audit` verifies them unchanged.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from wringer import evidence
from wringer.redact import Redactor

SCHEMA_VERSION = "wringer.gate-artifacts.v1"
FILENAME = "artifacts.json"
DIRNAME = "artifacts"

# **The environment variable a gate is handed**, on the `WRINGER_TASK_ID`
# precedent: the harness creates the directory and tells the gate where it is,
# rather than the gate guessing a path or the harness scraping the tree.
ENV_VAR = "WRINGER_ARTIFACTS_DIR"

# A CLOSED allow-list, extension to media type. Closed because "whatever the
# extension says" is how a `.html` with a script tag becomes something a board
# renders, and because the second column has to state whether the thing can be
# redacted at all.
#
# `redactable` is not a nicety: it is the one bit a reader needs to know which
# of two very different things they are holding. Text artifacts go through the
# same scrub as any captured text; binaries are recorded exactly as the gate
# wrote them, for the two reasons in the module docstring.
MEDIA_TYPES: dict[str, tuple[str, bool]] = {
    ".png": ("image/png", False),
    ".jpg": ("image/jpeg", False),
    ".jpeg": ("image/jpeg", False),
    ".gif": ("image/gif", False),
    ".webp": ("image/webp", False),
    ".svg": ("image/svg+xml", True),
    ".pdf": ("application/pdf", False),
    ".txt": ("text/plain", True),
    ".log": ("text/plain", True),
    ".md": ("text/markdown", True),
    ".json": ("application/json", True),
    ".csv": ("text/csv", True),
    ".html": ("text/html", True),
}

# Why an artifact was left out. A CLOSED set, so a surface can route on it.
OMITTED_TOO_LARGE = "too_large"
OMITTED_TOTAL_EXCEEDED = "total_exceeded"
OMITTED_UNKNOWN_TYPE = "unknown_type"
OMITTED_UNREADABLE = "unreadable"

OMISSION_REASONS = (
    OMITTED_TOO_LARGE,
    OMITTED_TOTAL_EXCEEDED,
    OMITTED_UNKNOWN_TYPE,
    OMITTED_UNREADABLE,
)


@dataclass(frozen=True)
class Artifact:
    name: str
    bytes: int
    sha256: str
    media_type: str
    redacted: bool

    def as_json(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "bytes": self.bytes,
            "sha256": self.sha256,
            "media_type": self.media_type,
            "redacted": self.redacted,
        }


@dataclass(frozen=True)
class Omission:
    name: str
    reason: str
    bytes: int | None = None

    def as_json(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"name": self.name, "reason": self.reason}
        if self.bytes is not None:
            payload["bytes"] = self.bytes
        return payload


def prepare(workdir: Path, gate) -> Path | None:
    """Make the directory a gate writes into, or None when it is not opted in.

    A gate that never declared `artifacts:` gets no directory and no
    environment variable, so its behaviour is byte-identical to before this
    feature existed.
    """
    if getattr(gate, "artifacts", None) is None:
        return None
    directory = workdir / DIRNAME
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def environment(directory: Path | None, base: dict[str, str] | None = None):
    """The gate's environment, with `WRINGER_ARTIFACTS_DIR` when opted in."""
    env = dict(base if base is not None else os.environ)
    if directory is not None:
        env[ENV_VAR] = str(directory)
    return env


def collect(
    workdir: Path, gate, redactor: Redactor | None = None
) -> Path | None:
    """Read what the gate left, write `artifacts.json`, return its path.

    Returns None — and writes nothing — when the gate did not opt in or left
    nothing behind. **Absence is the compatibility boundary**, so a run that
    produced no artifact must be indistinguishable from one that could not.

    **Over-cap and unknown-type files are OMITTED AND NAMED, never silently
    truncated.** A truncated PNG is a corrupt PNG that reads as evidence;
    `stdout_truncated` works only because text survives truncation. The
    omission is recorded with its reason, so absence is stated rather than
    invisible.

    Deliberately NOT called "refused": in this codebase `Refused` is a hard
    stop with an exit code, and an omission is not one.
    """
    settings = getattr(gate, "artifacts", None)
    if settings is None:
        return None
    directory = workdir / DIRNAME
    if not directory.is_dir():
        return None

    found: list[Artifact] = []
    omitted: list[Omission] = []
    running_total = 0

    # Sorted, so two runs over the same files produce byte-identical records
    # and the total-cap decisions are deterministic rather than filesystem-
    # order-dependent. A cap that omits a different file each run would make
    # the record unreproducible, which is the one thing a bundle may not be.
    for path in sorted(directory.rglob("*")):
        if not path.is_file():
            continue
        name = path.relative_to(directory).as_posix()
        media = MEDIA_TYPES.get(path.suffix.lower())
        if media is None:
            omitted.append(Omission(name, OMITTED_UNKNOWN_TYPE))
            continue
        media_type, redactable = media
        try:
            size = path.stat().st_size
            data = path.read_bytes()
        except OSError:
            omitted.append(Omission(name, OMITTED_UNREADABLE))
            continue
        if size > settings.max_bytes:
            omitted.append(Omission(name, OMITTED_TOO_LARGE, size))
            continue
        if running_total + size > settings.total_bytes:
            omitted.append(Omission(name, OMITTED_TOTAL_EXCEEDED, size))
            continue

        # A TEXT artifact is scrubbed like any other captured text. A binary
        # is left exactly as the gate wrote it — see the module docstring: a
        # length-changing substring pass over a compressed format yields a
        # corrupt file that still reads as evidence, and that is worse than an
        # unredacted one, which at least announces itself in its row.
        if redactable and redactor is not None:
            try:
                scrubbed = redactor.scrub(data.decode("utf-8")).encode("utf-8")
            except UnicodeDecodeError:
                # An extension said text and the bytes disagree. Trust the
                # bytes: it is not redactable, and the row must not claim it
                # was.
                scrubbed, redactable = data, False
            else:
                if scrubbed != data:
                    path.write_bytes(scrubbed)
                data = scrubbed
                size = len(data)

        running_total += size
        found.append(
            Artifact(
                name=name,
                bytes=size,
                sha256=hashlib.sha256(data).hexdigest(),
                media_type=media_type,
                redacted=bool(redactable and redactor is not None),
            )
        )

    if not found and not omitted:
        return None

    payload = {
        "schema_version": SCHEMA_VERSION,
        "gate": gate.id,
        "artifacts": [item.as_json() for item in found],
        "omitted": [item.as_json() for item in omitted],
        "limits": [
            "Nothing here is a claim about what an artifact SHOWS. The harness "
            "records a name, a size, a digest and a media type; it does not "
            "caption, label or interpret.",
            "A binary artifact is NOT redacted and cannot be. A screenshot can "
            "carry a token rendered on a page, a customer's name, or an API "
            "key in a URL bar, and no pattern in .wringer.yaml removes any of "
            "it. Each row says which it is.",
            "An omitted artifact was left out and named, never truncated. A "
            "truncated image is a corrupt image that still reads as evidence.",
        ],
    }
    # **Through the one writer that scrubs by construction** (D8). This wrote
    # the payload raw: `collect` scrubs artifact CONTENTS and never touched
    # `name`, and `workdir` is the bundle's own `gates/NNN_<id>/` — so a gate
    # writing `"$WRINGER_ARTIFACTS_DIR/report-$GITHUB_TOKEN.txt"` put a live
    # token into the evidence bundle, in a row that says `redacted: true`.
    # Probed with a `Redactor(secrets=(secret,))`: the name came back intact.
    # This is the class `evidence.deep_scrub` was added for — "a file whose
    # NAME carries a secret was reaching evidence.jsonl intact" — reappearing
    # in a newer module.
    return evidence.write_record(
        workdir / FILENAME, payload, redactor, ensure_ascii=False
    )


def read(workdir: Path) -> dict[str, Any] | None:
    """The record, or None. Total by construction, like every other reader."""
    path = workdir / FILENAME
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def count(bundle_dir: Path) -> int:
    """How many artifacts a whole bundle holds. For the MR body's COUNT.

    **A count, and never a payload.** The MR body may say *"3 artifacts in the
    bundle"* and may never carry one, link one, or embed one — standing
    constraint, and the reason is that nothing here is redacted.
    """
    gates = bundle_dir / "gates"
    if not gates.is_dir():
        return 0
    total = 0
    for directory in sorted(gates.iterdir()):
        record = read(directory)
        if record:
            total += len(record.get("artifacts") or [])
    return total
