"""`wringer-board judge` — a person answers a `human:` criterion.

**This module is the ONLY place in any of the three packages that writes
`wringer.judgements.yaml`**, and the guard in `tests/board/test_judge.py`
asserts exactly that. It lives in its own file for that reason: it keeps
`interview.py`'s "this surface writes the spec and nothing else" invariant
byte-intact, and gives the file-name check one place to point at.

## Why this exists, and why it is not a loosening

The law it moves is real and it is not being weakened: **no AUTOMATION may
ever answer a criterion a human was asked to answer.** A `human: true`
criterion exists precisely because a model asked anyway would be guessing. The
engine's own guard — `test_no_flag_no_env_var_and_no_command_can_write_a
_judgement` — scans `src/wringer/` and is untouched by this. The ENGINE still
writes no judgement, and neither does `wringer-drive`.

What moves is WHOSE HAND holds the pen, and where. Until 2026-08-21 the only
way to answer a `human:` criterion was to create `wringer.judgements.yaml`
yourself, guess its schema, and hand-write YAML — including the sha256 digest
that pins a judgement to the criterion's wording. A product manager hit that
on the critical path of a delivery and could not proceed
(`docs/field-report-2026-08-21.md`, finding 13).

That friction was aimed at the wrong party. It never stopped an agent: an
agent can write YAML perfectly, and computing a sha256 is the easiest thing in
this file for a machine and the hardest for a person. It stopped only the
human whose judgement the file exists to record. A guard that is trivial for
the party you distrust and prohibitive for the party you are serving is not a
guard; it is a tax.

`approve` — a LARGER consent act, covering everything that will be built —
has been a board verb since S3, with the discipline that makes it safe: it
prints what is being consented to before it writes, and there is no flag that
skips the printing. This verb takes that discipline exactly.

## The discipline, restated so it cannot be eroded piecemeal

- The criterion's EXACT wording is printed before anything is written. There
  is no flag that skips it. Same rule as `approve`, same reason.
- ONE criterion per invocation. No bulk mode, no `--all`, no file of answers.
  A verdict given in a batch is a verdict nobody gave individually.
- The verdict is TYPED, as the literal word `met` or `not_met`. There is no
  `--met` flag and no `--yes`: a switch is something you can hit by accident.
- Nothing here decides anything. It records what a person said, digests the
  criterion so a later re-wording makes the answer stale, and stops.
- The digest comes from the ENGINE's own `accept.criterion_digest`. A second
  implementation of a canonical form is how two files disagree about whether
  an answer is stale.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from wringer_board.interview import InterviewError, _load, _read, _write

# The one file this module writes, and the only executable mention of it in
# any of the three packages.
JUDGEMENTS_FILENAME = "wringer.judgements.yaml"
JUDGEMENT_SCHEMA_VERSION = "wringer.judgement.v1"

# Closed, and typed out in full by whoever answers. `wringer.judgement.v1`
# has no third value on purpose: a judgement that can hedge is one nothing
# downstream can act on.
VERDICTS = ("met", "not_met")


def _criteria(repo: Path) -> list[dict]:
    data = _load(repo)
    found = data.get("criteria")
    if not isinstance(found, list):
        return []
    return [entry for entry in found if isinstance(entry, dict)]


def find(repo: Path, criterion_id: str) -> dict:
    """The one criterion this verb is about, or a refusal naming the choices.

    **Only a `human: true` criterion may be judged.** A machine criterion has
    a gate, and a person overriding a gate by hand is the whole failure mode
    the evidence chain exists to prevent — it would let anybody mark a red
    check green by typing a sentence.
    """
    criteria = _criteria(repo)
    found = next(
        (c for c in criteria if str(c.get("id", "")) == criterion_id), None
    )
    if found is None:
        names = ", ".join(sorted({str(c.get("id", "")) for c in criteria}))
        raise InterviewError(
            f"no criterion {criterion_id!r} in this repository. "
            f"Known: {names or 'none'}"
        )
    if not found.get("human"):
        raise InterviewError(
            f"{criterion_id!r} is not a criterion a person answers — it is "
            "proved by a check, and nothing here may mark a check met by "
            "hand. Only criteria marked `human: true` can be judged"
        )
    return found


def wording(criterion: dict) -> str:
    """Exactly what the person is answering, printed before they answer it."""
    lines = [
        f"  {criterion.get('id', '')}",
        f"    {str(criterion.get('title', '')).strip()}",
    ]
    guidance = str(criterion.get("guidance", "") or "").strip()
    if guidance:
        lines += ["", f"    How to tell: {guidance}"]
    return "\n".join(lines)


def _default_by(repo: Path) -> str:
    """A name for the record, from git, or nothing.

    **Recorded, never verified**, and the schema says so — this is not an
    identity system and nothing downstream may read it as one. Read from git
    because a person who has to invent a name for a form is a person being
    asked a question they already answered when they configured the
    repository.
    """
    try:
        done = subprocess.run(
            ["git", "config", "user.name"],
            cwd=repo,
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):  # pragma: no cover
        return ""
    return done.stdout.strip() if done.returncode == 0 else ""


def _existing(path: Path) -> list[dict]:
    """Whatever is already recorded, or nothing.

    **An unreadable file REFUSES here**, and that is the opposite of the
    engine's rule for the same file on purpose. `accept.read_judgements`
    treats a broken file as absent because it runs inside `wring verify` and a
    malformed sibling must not take down a verification. This is a WRITER: if
    it cannot read what is there, writing would silently destroy somebody
    else's recorded answers.
    """
    if not path.is_file():
        return []
    import yaml

    try:
        data = yaml.safe_load(_read(path))
    except Exception as exc:  # noqa: BLE001
        raise InterviewError(
            f"{JUDGEMENTS_FILENAME} could not be read: {exc}. It holds answers "
            "somebody already gave, so nothing will be written over it until "
            "it parses — fix it, or move it aside"
        ) from exc
    if data is None:
        return []
    if not isinstance(data, dict):
        raise InterviewError(f"{JUDGEMENTS_FILENAME} is not a mapping")
    version = data.get("schema_version")
    if version != JUDGEMENT_SCHEMA_VERSION:
        raise InterviewError(
            f"{JUDGEMENTS_FILENAME} says 'schema_version: {version!r}' and this "
            f"surface writes {JUDGEMENT_SCHEMA_VERSION}. It will not guess"
        )
    entries = data.get("judgements")
    if entries is None:
        return []
    if not isinstance(entries, list):
        raise InterviewError(f"{JUDGEMENTS_FILENAME}: 'judgements' is not a list")
    return [entry for entry in entries if isinstance(entry, dict)]


def _render(entries: list[dict]) -> str:
    """The file, written the way a person would write it by hand.

    Rendered rather than `yaml.safe_dump`ed for the reason every other writer
    in this package renders: a dump reflows the document and drops the
    comments, and this file is a person's record.
    """
    import json

    lines = [
        "# Answers to the requirements only a person can judge.",
        "#",
        "# Written by `wringer-board judge`, which prints the requirement",
        "# before it writes anything. Nothing else in Wringer writes this file:",
        "# no flag, no environment variable, and no coding agent.",
        "#",
        "# `criterion_digest` pins each answer to the WORDING it answered. If a",
        "# requirement is later reworded, its answer goes stale and is refused",
        "# again — because somebody answered a different question.",
        f"schema_version: {JUDGEMENT_SCHEMA_VERSION}",
        "judgements:",
    ]
    for entry in entries:
        lines.append(f"  - criterion: {json.dumps(entry['criterion'])}")
        lines.append(f"    verdict: {entry['verdict']}")
        lines.append(f"    by: {json.dumps(entry['by'])}")
        lines.append(f"    at: {json.dumps(entry['at'])}")
        lines.append(f"    criterion_digest: {entry['criterion_digest']}")
        if entry.get("note"):
            lines.append(f"    note: {json.dumps(entry['note'])}")
    return "\n".join(lines) + "\n"


def record(
    repo: Path,
    criterion_id: str,
    verdict: str,
    *,
    by: str = "",
    note: str = "",
    read_the_criterion: bool,
    now: str = "",
) -> Path:
    """Write one person's answer to one criterion.

    `read_the_criterion` is `approve`'s `read_the_plan`, and it carries the
    same meaning and the same limitation: it is the CALLER's assertion that
    the wording was put in front of the person, and the CLI is what makes it
    true by printing first. A caller that lies here is a caller that could
    have written the file itself.
    """
    if not read_the_criterion:
        raise InterviewError(
            "a judgement may only be recorded after the requirement it answers "
            "has been shown. Nothing was written"
        )
    if verdict not in VERDICTS:
        raise InterviewError(
            f"a verdict is {' or '.join(VERDICTS)}, typed out — got "
            f"{verdict!r}. There is no third value: a judgement that can hedge "
            "is one nothing downstream can act on"
        )
    criterion = find(repo, criterion_id)

    author = by.strip() or _default_by(repo)
    if not author:
        raise InterviewError(
            "this needs a name for the record, and git has none configured "
            "here. Pass --by. It is recorded and never verified — Wringer "
            "does not check who you are"
        )

    # **The ENGINE's own digest.** A second canonical form here is how two
    # files come to disagree about whether an answer is stale.
    from wringer import accept, spec

    parsed = spec.Criterion(
        id=str(criterion.get("id", "")),
        title=str(criterion.get("title", "")),
        guidance=str(criterion.get("guidance", "") or ""),
        required=bool(criterion.get("required", True)),
        human=True,
    )
    digest = accept.criterion_digest(parsed)

    if not now:
        from datetime import UTC, datetime

        now = datetime.now(UTC).replace(microsecond=0).isoformat()

    path = repo / JUDGEMENTS_FILENAME
    entries = [
        entry for entry in _existing(path)
        if str(entry.get("criterion", "")) != criterion_id
    ]
    entries.append(
        {
            "criterion": criterion_id,
            "verdict": verdict,
            "by": author,
            "at": now,
            "criterion_digest": digest,
            **({"note": note.strip()} if note.strip() else {}),
        }
    )
    _write(path, _render(entries))
    return path


def unanswered(repo: Path) -> list[dict[str, Any]]:
    """Every `human:` criterion with no answer recorded against its wording.

    Used to tell a person what is still waiting. A criterion whose answer was
    given against DIFFERENT wording counts as unanswered here, because that is
    what the engine will say too — somebody answered a different question.
    """
    from wringer import accept, spec

    path = repo / JUDGEMENTS_FILENAME
    try:
        recorded = {
            str(e.get("criterion", "")): e for e in _existing(path)
        }
    except InterviewError:
        recorded = {}
    waiting = []
    for criterion in _criteria(repo):
        if not criterion.get("human"):
            continue
        entry = recorded.get(str(criterion.get("id", "")))
        parsed = spec.Criterion(
            id=str(criterion.get("id", "")),
            title=str(criterion.get("title", "")),
            guidance=str(criterion.get("guidance", "") or ""),
            required=bool(criterion.get("required", True)),
            human=True,
        )
        if entry is None or entry.get("criterion_digest") != accept.criterion_digest(
            parsed
        ):
            waiting.append(criterion)
    return waiting
