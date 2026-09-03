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
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from wringer_board.interview import InterviewError, _load, _read, _write

# The one file this module writes, and the only executable mention of it in
# any of the three packages.
JUDGEMENTS_FILENAME = "wringer.judgements.yaml"
# v2 since 0.6.1 — the pen failing closed (run 3, F11/F12): a successful
# show is BOUND to the judgement (command, exit, output digest, tree), and
# the explicit judged-without-display acknowledgement travels with the show's
# failure verbatim. v1 is published, frozen, and still READ (the tuple below);
# only the write moved.
JUDGEMENT_SCHEMA_VERSION = "wringer.judgement.v2"
JUDGEMENT_SCHEMA_VERSIONS = (JUDGEMENT_SCHEMA_VERSION, "wringer.judgement.v1")

# Closed, and typed out in full by whoever answers. `wringer.judgement.v1`
# has no third value on purpose: a judgement that can hedge is one nothing
# downstream can act on.
VERDICTS = ("met", "not_met")

# Every refusal THE PEN can produce, under a name a machine can read — the
# D0 discipline, third family (delivery's and the run preflight's rule,
# generalised on 2026-08-30): CLOSED and PUBLIC, the constructor requires
# the name, `tests/conftest.py`'s session hook asserts
# constructed-equals-declared, and each name is driven through the command
# that owes it by a taken-path test.
PEN_REFUSAL_REASONS = (
    # The declared display could not vouch for what the person saw — the
    # `show:` is absent, its command exited non-zero or timed out, or the
    # tree moved between showing and recording. Run 3 measured the open
    # pen's cost (F12): `/bin/sh: python: command not found`, and `met` was
    # recorded anyway — the product said a person saw and approved a thing
    # it failed to display.
    "show_failed",
)


class PenRefused(InterviewError):
    """The pen said no. Carries WHICH no, structurally.

    `reason` — one of `PEN_REFUSAL_REASONS` — is required for
    `deliver.Refused`'s reason: a test can be forgotten, a constructor
    cannot.
    """

    def __init__(self, message: str, *, reason: str) -> None:
        super().__init__(message)
        self.reason = reason


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


SHOW_TIMEOUT = 120

# The three states a show attempt can end in. A closed vocabulary, because
# `record` routes on it: `shown` is the only state a verdict may be recorded
# against without the explicit acknowledgement.
SHOWN = "shown"
MISSING = "missing"
FAILED = "failed"


def _tree_identity(repo: Path) -> tuple[str, bool | None]:
    """`(head_sha, dirty)` — the tree a display rendered against.

    Best-effort and never fatal: outside a git repository, or with git
    unanswerable, the identity is recorded as unknown (`""`, `None`) rather
    than invented. Read here, at the pen, because the judgement's whole new
    claim is "this display was of THIS tree" — and a claim nobody captured
    at the moment of display cannot be reconstructed later.
    """
    try:
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo, capture_output=True, text=True, timeout=5,
        )
        if head.returncode != 0:
            return "", None
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=repo, capture_output=True, text=True, timeout=10,
        )
        dirty = bool(status.stdout.strip()) if status.returncode == 0 else None
        return head.stdout.strip(), dirty
    except (OSError, subprocess.SubprocessError):
        return "", None


@dataclass(frozen=True)
class ShowResult:
    """One attempt to put the thing itself in front of the person.

    `state` is `SHOWN` only when the command ran AND exited 0 — run 3's F12
    measured why the exit matters: `/bin/sh: python: command not found` was
    rendered under the ordinary header and a `met` was recorded against it.
    `text` always carries what there is to carry — the display, the failure
    output, or `""` for a missing declaration — so the caller can SAY what
    happened whichever state it is.
    """

    state: str
    command: str = ""
    exit_code: int | None = None
    text: str = ""
    #: sha256 of `text`, set only when `state == SHOWN` — the digest the
    #: judgement binds.
    output_digest: str = ""
    at: str = ""
    head_sha: str = ""
    dirty: bool | None = None


def shown(repo: Path, criterion_id: str) -> ShowResult:
    """What the person is being asked to look at, typed (0.6.1).

    **The finding this exists for, 2026-08-28.** A person was asked to judge
    *"a reader can tell at a glance which one thing to fix"* — a requirement
    about the wording of a summary — and the summary appeared NOWHERE. Not in
    this command, which printed the requirement and stopped. Not on the board,
    which had zero occurrences of it. Not in the run bundle, whose only copy
    was a string literal inside a test's source in `diff.patch`. The one place
    it had ever existed was a gate log from the run where the check was still
    failing — visible only while the thing was broken — and the requirement's
    own guidance says the person judges it *without opening the logs*.

    The judgement was possible only because a coding agent pasted the output
    into a chat window unprompted. That is not a product behaviour.

    Returns a `ShowResult`. `MISSING` when the repository declares no
    `show:` for this criterion, and the caller must SAY SO rather than print
    the question as if nothing were missing; `FAILED` when the command could
    not run, timed out, or exited non-zero — the display's own exit is part
    of the answer since 0.6.1, because run 3 recorded a `met` against
    `/bin/sh: python: command not found` (F12).

    **Run at judging time, in the repository, not read from a bundle.** A
    person judging wording should see what the wording is now, not what it was
    when some earlier run happened to capture it.
    """
    from datetime import UTC, datetime

    now = datetime.now(UTC).replace(microsecond=0).isoformat()
    from wringer import config as config_module

    settings = repo / config_module.CONFIG_FILENAME
    if not settings.is_file():  # a repo with no config shows nothing, and says so
        return ShowResult(state=MISSING, at=now)
    try:
        cfg = config_module.load(settings)
    except Exception as exc:
        # **Unreadable is not undeclared** (bug review 0.7, 2026-09-02). A
        # file that cannot be parsed may well declare a `show:` for this
        # very requirement; calling it MISSING told the person to add a
        # line to a file that already had one. The pen refuses either way,
        # and carries the parser's own words instead of a false reason.
        return ShowResult(
            state=FAILED,
            text=(
                f"[{config_module.CONFIG_FILENAME} could not be read, so no "
                f"`show:` it declares can run: {exc}]"
            ),
            at=now,
        )
    command = cfg.show.get(criterion_id)
    if not command:
        return ShowResult(state=MISSING, at=now)
    head_sha, dirty = _tree_identity(repo)
    try:
        done = subprocess.run(
            command,
            shell=True,
            cwd=repo,
            capture_output=True,
            text=True,
            check=False,
            timeout=SHOW_TIMEOUT,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return ShowResult(
            state=FAILED,
            command=command,
            text=f"[the command for this requirement could not be run: {exc}]",
            at=now,
            head_sha=head_sha,
            dirty=dirty,
        )
    text = (done.stdout or "") + (done.stderr or "")
    # **Newlines only.** A plain `.strip()` eats the FIRST line's indentation
    # and leaves every other line's alone, so a summary whose whole point is
    # that its columns line up arrives with its first row shifted left. The
    # person is judging this text's shape; the surface does not get to change
    # it on the way past.
    text = text.strip("\n") or "[the command produced no output]"
    if done.returncode != 0:
        return ShowResult(
            state=FAILED,
            command=command,
            exit_code=done.returncode,
            text=text,
            at=now,
            head_sha=head_sha,
            dirty=dirty,
        )
    import hashlib

    return ShowResult(
        state=SHOWN,
        command=command,
        exit_code=0,
        text=text,
        output_digest=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        at=now,
        head_sha=head_sha,
        dirty=dirty,
    )


def standing_objection(repo: Path, criterion_id: str) -> dict[str, Any] | None:
    """The `not_met` a person already recorded against this requirement.

    A criterion re-offered because somebody said no reads identically to one
    nobody has ever looked at, unless the listing says which it is — and the
    two ask for completely different things. One asks a person to form a
    judgement; the other asks them whether the objection they already made has
    been answered. Printing their own words back is what tells them apart.
    """
    try:
        entries = _existing(repo / JUDGEMENTS_FILENAME)
    except InterviewError:
        return None
    for entry in entries:
        if str(entry.get("criterion", "")) != criterion_id:
            continue
        if str(entry.get("verdict", "")) == "not_met":
            return entry
    return None


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
    if version not in JUDGEMENT_SCHEMA_VERSIONS:
        raise InterviewError(
            f"{JUDGEMENTS_FILENAME} says 'schema_version: {version!r}' and this "
            f"surface reads {' or '.join(JUDGEMENT_SCHEMA_VERSIONS)}. It will "
            "not guess"
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
        # The v2 facts (0.6.1). A v1 entry carries none and renders exactly
        # as it always did — the file's version says v2, and the schema makes
        # every one of these optional for precisely that migration.
        display = entry.get("display")
        if isinstance(display, dict):
            lines.append("    display:")
            lines.append(f"      command: {json.dumps(display['command'])}")
            lines.append(f"      exit: {display['exit']}")
            lines.append(f"      output_digest: {display['output_digest']}")
            lines.append(f"      at: {json.dumps(display['at'])}")
            if display.get("head_sha"):
                lines.append(f"      head_sha: {display['head_sha']}")
            if display.get("dirty") is not None:
                lines.append(
                    f"      dirty: {'true' if display['dirty'] else 'false'}"
                )
        if entry.get("judged_without_display"):
            lines.append("    judged_without_display: true")
        if entry.get("show_failure"):
            lines.append(f"    show_failure: {json.dumps(entry['show_failure'])}")
    return "\n".join(lines) + "\n"


def record(
    repo: Path,
    criterion_id: str,
    verdict: str,
    *,
    by: str = "",
    note: str = "",
    read_the_criterion: bool,
    display: ShowResult | None = None,
    without_display: bool = False,
    now: str = "",
) -> Path:
    """Write one person's answer to one criterion — against a display, or
    with the explicit acknowledgement that there was none.

    `read_the_criterion` is `approve`'s `read_the_plan`, and it carries the
    same meaning and the same limitation: it is the CALLER's assertion that
    the wording was put in front of the person, and the CLI is what makes it
    true by printing first. A caller that lies here is a caller that could
    have written the file itself.

    **The pen fails CLOSED since 0.6.1** (run 3, F12: a `met` was recorded
    against `/bin/sh: python: command not found`). A verdict needs a fresh
    SUCCESSFUL display — `display.state == SHOWN`, rendered against the tree
    as it still is — or `without_display=True`, the one honest escape: the
    person judged on their own sight of it, explicitly, and the record says
    so with the show's failure carried verbatim. Never silently.
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
    if not without_display:
        if display is None or display.state != SHOWN:
            said = (display.text if display is not None else "").strip()
            happened = {
                None: "no display was attempted",
                MISSING: "this repository declares no `show:` for it",
                FAILED: (
                    "the declared show command failed"
                    + (
                        f" (exit {display.exit_code})"
                        if display is not None and display.exit_code is not None
                        else ""
                    )
                ),
            }[None if display is None else display.state]
            raise PenRefused(
                f"nothing vouches for what you saw: {happened}. A verdict "
                "recorded against a display that did not happen is the "
                "product saying a person saw and approved something it "
                "failed to show them — measured, run 3.\n\n"
                + (f"What the show surface said:\n{said}\n\n" if said else "")
                + "Fix the `show:` command in .wringer.yaml, or — if you "
                "judged this on your own sight of it — say so explicitly "
                "with --without-display, and the record will carry that "
                "fact beside your verdict. Nothing was written",
                reason="show_failed",
            )
        moved_head, _moved_dirty = _tree_identity(repo)
        if display.head_sha and moved_head and display.head_sha != moved_head:
            raise PenRefused(
                f"the tree moved between showing and recording — the display "
                f"rendered {display.head_sha[:12]} and the repository is now "
                f"at {moved_head[:12]}, so the thing you saw is not the "
                "thing this verdict would be recorded against. Show it "
                "again. Nothing was written",
                reason="show_failed",
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
    answered: dict[str, Any] = {
        "criterion": criterion_id,
        "verdict": verdict,
        "by": author,
        "at": now,
        "criterion_digest": digest,
        **({"note": note.strip()} if note.strip() else {}),
    }
    if without_display:
        answered["judged_without_display"] = True
        failure = (display.text if display is not None else "").strip("\n")
        if display is not None and display.state == MISSING:
            failure = (
                "no `show:` is declared for this requirement — nothing was "
                "displayed"
            )
        if failure:
            answered["show_failure"] = failure
    else:
        answered["display"] = {
            "command": display.command,
            "exit": display.exit_code if display.exit_code is not None else 0,
            "output_digest": display.output_digest,
            "at": display.at,
            **({"head_sha": display.head_sha} if display.head_sha else {}),
            **({"dirty": display.dirty} if display.dirty is not None else {}),
        }
    entries.append(answered)
    _write(path, _render(entries))
    return path


def unanswered(repo: Path) -> list[dict[str, Any]]:
    """Every `human:` criterion still waiting on a person.

    Used to tell a person what is still waiting. A criterion whose answer was
    given against DIFFERENT wording counts as waiting here, because that is
    what the engine will say too — somebody answered a different question.

    **A `not_met` is an open objection, not a settled answer** — field report
    2026-08-28, and it closed the loop this whole product is built to open.
    A person judged a requirement not met. An engineer fixed exactly what they
    complained about. The person ran `wringer-board judge` to look again and
    was told *"nothing is waiting on your judgement in this repository"* —
    while the engine went on refusing the delivery on that same verdict, and
    went on refusing it forever, because the one verb that moves the pen would
    not offer the question again.

    The escape hatch was real and useless: `--id` still records over a prior
    verdict, so anyone who already knew the identifier could re-judge. This
    listing exists precisely so that *"a person who does not know the ids
    should not have to read a YAML file to find them"*, and it was refusing to
    name the one id that mattered.

    **Only `met` settles a criterion.** Every other state — no answer, a stale
    answer, or a standing `not_met` — is a person's turn.
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
        if (
            entry is None
            or entry.get("criterion_digest") != accept.criterion_digest(parsed)
            or str(entry.get("verdict", "")) != "met"
        ):
            waiting.append(criterion)
    return waiting
