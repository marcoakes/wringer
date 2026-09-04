"""`wring verify --falsify` — docs/specs/SPEC_FALSIFY_V0.md. Model-free.

**Every green in this program was red first — and red-first is a claim about
ONE failure that was recorded.** It says nothing about whether the check would
notice a DIFFERENT way of breaking the same code. So: break the change on
purpose, mechanically, and see whether the checks notice.

**v0 is MODEL-FREE by ruling.** No LLM, no network, no rival agent. The
mutations come from a fixed, ordered table and are applied by string
substitution to lines the change itself touched. The rival-agent attack is a
later field run and is out of scope here deliberately.

**A SURVIVOR is a finding about the CHECKS, never a verdict on the work**
(ruling 1). It says: *these checks could not tell the difference between the
code as delivered and the code with this line broken.* Nothing here says the
change is wrong, and no surface may phrase it that way.

**The ceiling, which is the whole of what this buys** (ruling 2): surviving
mechanical mutation is necessary and demonstrably not sufficient. A check that
catches every mutation in the table can still miss everything the table does
not contain, and the table contains almost nothing compared with the ways real
code goes wrong.

**It refuses nothing** (ruling 3). No exit code changes, no acceptance row
moves, no delivery is held. Whether a survivor should ever refuse is a named
future ruling that wants this v0's field evidence first.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from wringer import config, evidence, gates
from wringer.redact import Redactor

SCHEMA_VERSION = "wringer.falsification.v1"
FALSIFICATION_FILENAME = "falsification.json"
FALSIFY_DIRNAME = "falsify"

#: How many mutants a run will attempt before it stops and SAYS it stopped.
#: A whole gate suite runs per mutant, so unbounded means a machine tied up
#: for an afternoon. Reaching it is reported, never hidden — a silent
#: truncation reads as "we tried everything".
DEFAULT_MAX_ATTEMPTS = 24

#: The wall-clock ceiling, for the same reason and with the same disclosure.
DEFAULT_BUDGET_SECONDS = 600

#: **The table. Ordered, closed, and deterministic** — two runs of one commit
#: attempt the same mutations in the same order, or a survivor is not a fact
#: anybody can go and reproduce.
#:
#: Textual substitution, and it is named as such on every surface: these are
#: applied to a line of source without parsing it. That buys language
#: independence — the same table works on Python, Go, TypeScript and shell —
#: and it costs precision, which `LIMITS` states out loud.
#:
#: Each pair is `(what, what it becomes)`. The FIRST pair that matches a line
#: makes that line's attempt, so a line is mutated once and no pair can
#: undo another's edit.
#: **The THREE-character equality operators come first, and a probe is why.**
#: `!==` contains `!=` and `===` contains `==`, so with the two-character
#: pairs first, `if (a !== b)` became `if (a !!= b)` — a SYNTAX ERROR rather
#: than a mutation. Every check catches a syntax error, so it lands in the
#: caught column: the direction this lane must never fail in, and the fourth
#: time this slice has failed in it. Longest operator first is the rule.
MUTATIONS: tuple[tuple[str, str], ...] = (
    ("===", "!=="),
    ("!==", "==="),
    ("==", "!="),
    ("!=", "=="),
    (" and ", " or "),
    (" or ", " and "),
    ("<=", "<"),
    (">=", ">"),
    (" not ", " "),
    ("True", "False"),
    ("False", "True"),
    # `(" += ", " -= ")` was here and was DEAD: `+=` matches first, so it
    # could never fire. A table entry that cannot be reached reads as
    # coverage and is not, which is the vacuity class this project keeps
    # finding in its own guards — this time in a data table rather than a
    # predicate.
    ("+=", "-="),
    ("-=", "+="),
)

#: The characters an operator is made of. Used to tell a WHOLE operator from
#: a slice of a longer run of the same punctuation.
_OPERATOR_CHARS = set("=!<>+-")


def _whole_operator(text: str, was: str) -> int:
    """Where `was` occurs as a whole operator in `text`, or -1.

    **Found by pointing the table at this repository's own diff.** A pytest
    banner — `=================== FAILURES ===================` — contains
    `===`, so the equality rule fired on the first three characters and
    produced `!==================================`. That is not a mutation, it
    is a syntax error, and a syntax error is caught by everything: the caught
    column inflates and the checks look better than they are. Markdown rules,
    table separators and ASCII art all have the same shape.

    So an operator only matches when the characters either side of it are not
    themselves operator characters. `a >= b` matches; `====` does not; and
    `!=` inside `!==` is rejected here as well as being out-ranked by the
    ordering above — two mechanisms for one rule, because this one has now
    cost four fixes in the same direction.

    Word substitutions like `" and "` are unaffected: their neighbours are
    letters and spaces, never operator characters.
    """
    if not set(was) <= _OPERATOR_CHARS:
        return text.find(was)
    start = 0
    while True:
        at = text.find(was, start)
        if at < 0:
            return -1
        before = text[at - 1] if at else ""
        after = text[at + len(was)] if at + len(was) < len(text) else ""
        if before not in _OPERATOR_CHARS and after not in _OPERATOR_CHARS:
            return at
        start = at + 1


#: Lines this will not touch, because a mutation inside prose is a mutant that
#: changes no behaviour and would be recorded as a survivor — a finding about
#: nothing, which erodes the trust the real findings need. Prefix match after
#: stripping; deliberately crude, and declared as crude in `LIMITS`.
_COMMENT_PREFIXES = ("#", "//", "--", "*", "/*", "<!--", '"""', "'''")

#: **Files this never mutates, and both halves were found by running it.**
#:
#: The first field run — run 2's real delivered change — mutated a markdown
#: brief, a YAML spec, and the judgements file, and reported all three as
#: survivors. Every one of those is a true statement and none is a finding: a
#: conjunction inside a sentence of prose changes no behaviour, so nothing
#: could have caught it.
#:
#: Worse, they CROWD OUT the real ones. With the ceiling spreading attempts
#: across files, twelve of twenty-four attempts went to prose and the two
#: mutations the checks actually caught were never reached — the measurement
#: got less informative as the sampling got fairer.
#:
#: Two rules, both precise enough to state:
#:
#: 1. **Prose is not code.** A mutation in a document is not a thing a check
#:    could notice.
#: 2. **Wringer's own declaration files are not the work.** Mutating the spec
#:    and asking whether the checks noticed is a category error — and
#:    mutating `.wringer.yaml` would change what the checks ARE, which
#:    invalidates the whole measurement rather than informing it.
#: **Matched by SHAPE rather than by a list of names**, and a guard is why.
#: `test_plan.py` refuses any module but `spec.py` and `cli.py` to name the
#: gate sidecar — a gate that RUNS must come from the file a person edited —
#: and a hand-kept list here would have named it. The shape is also the more
#: durable rule: a declaration file this project adds later is excluded the
#: day it arrives rather than the day somebody remembers.
_PROSE_SUFFIXES = (".md", ".markdown", ".rst", ".txt", ".adoc")
_DECLARATION_SUFFIXES = (".yaml", ".yml")


def _mutable(path: str) -> bool:
    name = Path(path).name
    if name.lower().endswith(_PROSE_SUFFIXES):
        return False
    if name == "tasks.jsonl":
        return False
    return not (
        name.startswith((".wringer", "wringer."))
        and name.lower().endswith(_DECLARATION_SUFFIXES)
    )


#: What this measurement does NOT say, travelling with the numbers.
LIMITS = (
    "A surviving mutation is a finding about the CHECKS, not about the "
    "change. It says these checks could not tell the difference between the "
    "code as delivered and the code with that line broken. It does not say "
    "the change is wrong or that the requirement is unmet.",
    "Surviving mechanical mutation is necessary and demonstrably NOT "
    "sufficient. The mutations come from a fixed table; checks that catch "
    "every one of them can still miss everything the table does not contain, "
    "and it contains almost nothing next to the ways real code goes wrong. "
    "This is never a score.",
    "The mutations are textual and nothing here parses the code. A "
    "substitution inside a string literal changes no behaviour and would be "
    "recorded as a survivor, and comment lines are skipped by a crude prefix "
    "match that does not know every language's syntax.",
    "Only lines this change ADDED or CHANGED are attempted. A check's "
    "coverage of code the change never touched is a real question and is not "
    "this measurement.",
    "Documents and this repository's own declaration files are never "
    "mutated: a conjunction inside a sentence of prose changes no behaviour, "
    "and altering the spec or the gate list would change what the checks ARE "
    "rather than test them.",
    "A mutation in a file the bound checks never execute — a test file, a "
    "fixture, a script — survives because nothing ran it, which says only "
    "that. Every row names its file so a reader can tell that case from a "
    "mutation of code the checks were supposed to be watching.",
)

INCONCLUSIVE = "inconclusive"
MEASURED = "measured"
NOT_APPLICABLE = "not-applicable"


@dataclass(frozen=True)
class Attempt:
    """One mutant, and what the bound gates made of it."""

    path: str
    line: int
    was: str
    became: str
    mutation: str
    caught_by: tuple[str, ...] = ()
    survived: bool = False

    def as_json(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "line": self.line,
            "was": self.was,
            "became": self.became,
            "mutation": self.mutation,
            "caught_by": list(self.caught_by),
            "survived": self.survived,
        }


@dataclass(frozen=True)
class Result:
    """What a falsification pass found, or why it could not look."""

    verdict: str
    reason: str = ""
    attempts: tuple[Attempt, ...] = ()
    truncated: str = ""
    gates_used: tuple[str, ...] = ()
    duration_ms: int = 0
    limits: tuple[str, ...] = field(default=LIMITS)

    @property
    def survivors(self) -> tuple[Attempt, ...]:
        return tuple(one for one in self.attempts if one.survived)

    @property
    def caught(self) -> int:
        return sum(1 for one in self.attempts if not one.survived)

    def as_json(self) -> dict[str, Any]:
        recorded: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "verdict": self.verdict,
            "reason": self.reason,
            "counts": {
                "attempted": len(self.attempts),
                "caught": self.caught,
                "survived": len(self.survivors),
            },
            "gates": list(self.gates_used),
            "attempts": [one.as_json() for one in self.attempts],
            "duration_ms": self.duration_ms,
            "limits": list(self.limits),
        }
        # Present only when a ceiling was actually reached. A key saying
        # "nothing was truncated" on every clean run is the caveat-over-a-
        # clean-record shape this project keeps refusing.
        if self.truncated:
            recorded["truncated"] = self.truncated
        return recorded


def not_applicable(reason: str) -> Result:
    return Result(verdict=NOT_APPLICABLE, reason=reason)


def inconclusive(reason: str) -> Result:
    return Result(verdict=INCONCLUSIVE, reason=reason)


# --- planning the attempts -------------------------------------------------


def changed_lines(patch: str) -> list[tuple[str, int, str]]:
    """`(path, line number, text)` for every line this diff ADDED or CHANGED.

    Read from a unified diff rather than by comparing files, because the diff
    is what says which lines the change is answerable for — a whole-file
    comparison would offer every line of a new file and every line of a moved
    one.

    Deterministic: the walk follows the diff's own order, and the diff's order
    is git's.
    """
    found: list[tuple[str, int, str]] = []
    path: str | None = None
    number = 0
    for line in patch.splitlines():
        if line.startswith("+++ "):
            target = line[4:].strip()
            path = None if target == "/dev/null" else target[2:] if target[
                :2
            ] in ("a/", "b/") else target
            continue
        if line.startswith("@@"):
            # `@@ -a,b +c,d @@` — `c` is where the new file's hunk starts.
            try:
                number = int(line.split("+", 1)[1].split(",")[0].split(" ")[0])
            except (IndexError, ValueError):
                number = 0
            continue
        if path is None or not number:
            continue
        if line.startswith("+") and not line.startswith("+++"):
            found.append((path, number, line[1:]))
            number += 1
        elif line.startswith(" "):
            number += 1
    return found


def _diff_path(target: str) -> str | None:
    """One side of a `--- `/`+++ ` header, as a repo-relative path or None."""
    if target == "/dev/null":
        return None
    return target[2:] if target[:2] in ("a/", "b/") else target


def changed_paths(patch: str) -> tuple[list[str], list[str]]:
    """`(present, absent)` — what the delivered tree HAS, and what it does not.

    **The reconstruction needs both halves and only ever had one.** The scratch
    copy is a worktree detached at HEAD, so it starts as the tree BEFORE the
    change; the delivered files are copied over it. That set used to come from
    `changed_lines`, which by construction records ADDED lines only — so a
    delivery that DELETED a file, or that only removed lines from one, left
    HEAD's version of it sitting in the scratch copy.

    Two consequences, both in the direction this lane must never fail in. The
    control run then passes against a hybrid tree that is not the change. And
    an obsolete test the delivery removed is still there to catch mutants, so
    every mutant it catches is recorded as caught by a check that no longer
    exists — caught-count inflation, which is the whole number this lane
    reports.

    A rename appears as `--- a/old` / `+++ b/new`, so `old` is absent too.
    """
    present: list[str] = []
    absent: list[str] = []
    old: str | None = None
    for line in patch.splitlines():
        if line.startswith("--- "):
            old = _diff_path(line[4:].strip())
            continue
        if line.startswith("+++ "):
            new = _diff_path(line[4:].strip())
            if new is None:
                if old is not None:
                    absent.append(old)
            else:
                present.append(new)
                if old is not None and old != new:
                    absent.append(old)
            old = None
    kept = set(present)
    return sorted(kept), sorted(set(absent) - kept)


def _is_comment(text: str) -> bool:
    stripped = text.strip()
    return not stripped or stripped.startswith(_COMMENT_PREFIXES)


def plan(
    patch: str, limit: int = DEFAULT_MAX_ATTEMPTS
) -> tuple[list[Attempt], str]:
    """The attempts this run would make, and what it had to leave out.

    One attempt per line at most: the FIRST mutation in the table that matches
    is the one applied, so no pair can undo another's edit and a line cannot
    be counted twice.

    Returns `(attempts, what was truncated)`. The second half is never empty
    silently — reaching a ceiling is a fact a reader needs, because a
    truncated run and an exhaustive one look identical from the numbers.
    """
    by_file: dict[str, list[Attempt]] = {}
    total = 0
    for path, number, text in changed_lines(patch):
        if _is_comment(text) or not _mutable(path):
            continue
        for was, becomes in MUTATIONS:
            at = _whole_operator(text, was)
            if at < 0:
                continue
            total += 1
            by_file.setdefault(path, []).append(
                Attempt(
                    path=path,
                    line=number,
                    was=text.rstrip("\n"),
                    became=(
                        text[:at] + becomes + text[at + len(was):]
                    ).rstrip("\n"),
                    mutation=f"{was!r} -> {becomes!r}",
                )
            )
            break

    # **Round-robin across files, so a ceiling samples the whole change.**
    # The first version took the diff in order, and the first field run showed
    # what that costs: the ceiling was reached inside the first two files and
    # the last two were never attempted at all. The `truncated` sentence was
    # true and a reader would still have drawn a conclusion about a change
    # half of which was never touched.
    #
    # Deterministic: the file order is sorted and each file's attempts keep
    # their diff order, so two runs of one commit attempt the same mutations
    # in the same order.
    planned: list[Attempt] = []
    order = sorted(by_file)
    depth = 0
    while len(planned) < limit and any(len(by_file[p]) > depth for p in order):
        for path in order:
            if len(planned) >= limit:
                break
            if len(by_file[path]) > depth:
                planned.append(by_file[path][depth])
        depth += 1

    if total > len(planned):
        return planned, (
            f"{total - len(planned)} further mutation(s) were possible and "
            f"were not attempted: this run's ceiling is {limit}. The numbers "
            "below are about what was attempted, not about everything that "
            "could have been"
        )
    return planned, ""


# --- running them ----------------------------------------------------------


def _bound(cfg: config.Config) -> list[config.Gate]:
    """The gates answerable for a requirement. A gate binding nothing has no
    opinion about whether a mutant broke anything anyone asked for."""
    return [gate for gate in cfg.gates if getattr(gate, "proves", None)]


def _run_gates(
    where: Path, bound: list[config.Gate], logs: Path, label: str,
    redactor: Redactor,
) -> tuple[bool, list[str]]:
    """Run the bound gates in the scratch copy. Returns (all passed, failures)."""
    failed: list[str] = []
    for index, gate in enumerate(bound, start=1):
        directory = logs / f"{label}_{index:03d}_{gate.id}"
        directory.mkdir(parents=True, exist_ok=True)
        result = gates.run(
            gate,
            where,
            directory / "stdout.log",
            directory / "stderr.log",
            redactor=redactor,
        )
        if not result.passed:
            failed.append(gate.id)
    return not failed, failed


def falsify(
    root: Path,
    cfg: config.Config,
    bundle_dir: Path,
    patch: str,
    redactor: Redactor | None = None,
    limit: int = DEFAULT_MAX_ATTEMPTS,
    budget_seconds: int = DEFAULT_BUDGET_SECONDS,
    worktree_ref: str | None = None,
) -> Result:
    """Break this change mechanically and see whether the bound gates notice.

    **Never the person's tree** (ruling 6). Every mutant is written into a
    detached scratch worktree and nowhere else; the working tree is not
    touched, not stashed and not reverted.

    **`worktree_ref` is the committed-range mode** (0.6.3, run 3 F16): the
    scratch tree is detached AT the range's own head, so it already IS the
    delivered code — no reconstruction copy from the live tree, which by
    then describes some other moment (that copy is exactly why run 3 had to
    rebuild the delivery as an uncommitted patch to get a table at all).
    The BOUND gates come from the worktree's own config in this mode: the
    tree being falsified declares its own law, and the live config may have
    moved since.
    """
    from wringer import fleet

    redactor = redactor or Redactor()
    bound = _bound(cfg)
    # In committed-range mode the binding question is answered by the
    # WORKTREE's own config below — the live one may have moved since the
    # range was cut, in either direction.
    if not bound and worktree_ref is None:
        return not_applicable(
            "no gate in this repository names a requirement it proves, so "
            "there is nothing whose blindness could be measured"
        )
    planned, truncated = plan(patch, limit=limit)
    if not planned:
        return not_applicable(
            "nothing in this change offered a mutation this version knows how "
            "to make. Only lines the change added or altered are attempted, "
            "comment lines are skipped, and the substitutions come from a "
            "fixed table"
        )

    logs = bundle_dir / FALSIFY_DIRNAME
    logs.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()

    worktree = fleet.make_worktree(
        root, f"falsify-{bundle_dir.name}", ref=worktree_ref or "HEAD"
    )
    if worktree is None:
        return inconclusive(
            "a scratch copy could not be created"
            + (
                f" at {worktree_ref[:12]}"
                if worktree_ref
                else ""
            )
            + ", so nothing could be broken safely. Nothing was measured "
            "either way"
        )

    try:
        if worktree_ref is not None:
            # The committed range declares its own law: bound gates from the
            # WORKTREE's config, which is the config as delivered.
            try:
                cfg = config.load(worktree / config.CONFIG_FILENAME)
            except (config.ConfigError, OSError) as exc:
                return inconclusive(
                    "the range's own gate declaration could not be read "
                    f"({exc}), so which checks were bound at that commit "
                    "cannot be known. Nothing was measured either way"
                )
            bound = _bound(cfg)
            if not bound:
                return not_applicable(
                    "no gate in the range's own configuration names a "
                    "requirement it proves, so there is nothing whose "
                    "blindness could be measured"
                )
        # **The delivered code, reconstructed in the scratch copy.** The
        # worktree is detached at HEAD and carries tracked files only, so the
        # changed files are copied over it — that IS the tree the gates just
        # passed against, and it is what a mutant has to be a mutation OF.
        # **Every path the diff names, both halves.** `changed_lines` records
        # ADDED lines only, so the reconstruction used to leave HEAD's copy of
        # any deleted file — and of any file the change only removed lines
        # from — sitting in the scratch copy. Measured on a three-file diff:
        # a deleted file and a pure-deletion hunk both yielded
        # `touched: ['keep.py']`, so an obsolete test the delivery REMOVED was
        # still present to catch mutants, and every mutant it caught was
        # recorded as caught by a check that no longer exists.
        present, absent = changed_paths(patch)
        if worktree_ref is None:
            for relative in absent:
                gone = worktree / relative
                if gone.is_file() or gone.is_symlink():
                    gone.unlink()
        # Only files the delivery still HAS can carry a mutation.
        touched = sorted(
            set(present) & {path for path, _, _ in changed_lines(patch)}
        )
        originals: dict[str, str] = {}
        if worktree_ref is None:
            for relative in present:
                source = root / relative
                try:
                    originals[relative] = source.read_text(encoding="utf-8")
                except (OSError, UnicodeDecodeError):
                    continue
                target = worktree / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(originals[relative], encoding="utf-8")
        else:
            # The worktree at the range head already carries the delivered
            # bytes; the originals map — what `_apply` restores between
            # mutants — reads from THERE, never from the live tree.
            for relative in present:
                source = worktree / relative
                try:
                    originals[relative] = source.read_text(encoding="utf-8")
                except (OSError, UnicodeDecodeError):
                    continue
        # Every rewrite from here on goes through the clock — see `_Clock`.
        clock = _Clock([worktree / one for one in touched])

        # **The control, and without it the whole measurement is a lie**
        # (ruling 4). A detached worktree carries tracked files only, so in a
        # repository whose dependencies are gitignored EVERY gate fails there
        # — and every mutant would then be recorded as caught. A perfect score
        # produced by a broken environment is worse than no measurement.
        clean, failures = _run_gates(
            worktree, bound, logs, "control", redactor
        )
        if not clean:
            return inconclusive(
                "the bound checks do not pass in a scratch copy of this "
                f"change even before anything was broken ({', '.join(failures)}). "
                "A scratch copy carries tracked files only, so a repository "
                "whose dependencies are not committed fails there for that "
                "reason — and every mutation would then be recorded as caught. "
                "Nothing was measured either way",
            )

        done: list[Attempt] = []
        for index, attempt in enumerate(planned, start=1):
            if time.monotonic() - started > budget_seconds:
                truncated = (
                    f"{len(planned) - len(done)} planned mutation(s) were not "
                    f"attempted: this run's time budget of {budget_seconds}s "
                    "ran out. The numbers below are about what was attempted"
                )
                break
            target = worktree / attempt.path
            before = originals.get(attempt.path)
            if before is None:
                continue
            mutated = _apply(before, attempt)
            if mutated is None or mutated == before:
                # The line moved, or the substitution changed nothing. Not an
                # attempt, and recording it as a caught one would inflate the
                # numerator with work nobody did.
                continue
            clock.write(target, mutated)
            try:
                passed, failed_gates = _run_gates(
                    worktree, bound, logs, f"m{index:03d}", redactor
                )
            finally:
                clock.write(target, before)
            done.append(
                Attempt(
                    path=attempt.path,
                    line=attempt.line,
                    was=attempt.was,
                    became=attempt.became,
                    mutation=attempt.mutation,
                    caught_by=tuple(failed_gates),
                    survived=passed,
                )
            )
    finally:
        fleet.remove_worktree(root, worktree)

    return Result(
        verdict=MEASURED,
        # For the committed-range mode, WHICH change was measured — the open
        # `reason` string is the one field the frozen record has for it, and
        # the renderer says it beside the numbers. Empty for the working-tree
        # mode, exactly as every record before 0.6.3.
        reason=(
            f"measured over the committed range this invocation named, "
            f"at {worktree_ref[:12]}"
            if worktree_ref
            else ""
        ),
        attempts=tuple(done),
        truncated=truncated,
        gates_used=tuple(gate.id for gate in bound),
        duration_ms=int((time.monotonic() - started) * 1000),
    )


class _Clock:
    """Strictly increasing modification times for the files this rewrites.

    **The defect this exists for, measured 2026-08-28 on the very first real
    fixture, and it errs in the WORST direction.** Two mutants of one file —
    `'>=' -> '>'` on two different lines — are the same SIZE, and this lane
    rewrites the file several times a second. CPython validates a cached
    `.pyc` against the source's `(mtime truncated to seconds, size)`, so the
    second mutant was executed as the FIRST mutant's bytecode: a mutation
    nothing checks was recorded as CAUGHT.

    That inflates the caught count, which is the one direction this
    measurement must never fail in — it makes the checks look better than
    they are, and refusing exactly that is the whole point of the lane.

    Nothing here is Python-specific in principle: any build cache keyed on
    `(mtime, size)` serves a stale artifact when a file is rewritten inside
    the clock's granularity at the same length. Every write goes through here
    and gets a timestamp two seconds past the last one, so no two versions of
    a file can ever look identical to such a cache.

    It starts from the newest mtime already in the tree rather than from a
    fixed epoch: a source file stamped in the past would make a `make`-style
    build think its outputs were current, which is the same bug wearing the
    other hat.
    """

    def __init__(self, paths: list[Path]) -> None:
        newest = 0.0
        for path in paths:
            try:
                newest = max(newest, path.stat().st_mtime)
            except OSError:
                continue
        self._at = newest + 2

    def write(self, path: Path, text: str) -> None:
        import os

        path.write_text(text, encoding="utf-8")
        self._at += 2
        try:
            os.utime(path, (self._at, self._at))
        except OSError:  # pragma: no cover - a tree that forbids utime
            pass


def _apply(before: str, attempt: Attempt) -> str | None:
    """The mutated file, or None when the line is not where it was.

    Checked rather than assumed: a diff's line numbers are about the diff's
    idea of the file, and if the file on disk disagrees then mutating by line
    number would break a line nobody chose.
    """
    lines = before.splitlines(keepends=True)
    index = attempt.line - 1
    if not 0 <= index < len(lines):
        return None
    if lines[index].rstrip("\n") != attempt.was:
        return None
    ending = "\n" if lines[index].endswith("\n") else ""
    lines[index] = attempt.became + ending
    return "".join(lines)


# --- the record and the sentences ------------------------------------------


def write(directory: Path, result: Result, redactor: Any = None) -> Path:
    """Write `falsification.json`. A NEW file; nothing published moves."""
    payload = result.as_json()
    if redactor is not None:
        payload = evidence.deep_scrub(redactor, payload)
    path = directory / FALSIFICATION_FILENAME
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def read(run_dir: Path) -> dict[str, Any] | None:
    """The record a run wrote, or None. **Absent is absent** — a run without
    the flag measured nothing, which is not a score of zero."""
    try:
        loaded = json.loads(
            (run_dir / FALSIFICATION_FILENAME).read_text(encoding="utf-8")
        )
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    if not isinstance(loaded, dict):
        return None
    if loaded.get("schema_version") != SCHEMA_VERSION:
        return None
    return loaded


def _named(gates_used: Any) -> str:
    """The bound checks, for the sentence that names a survivor."""
    listed = [f"`{one}`" for one in (gates_used or [])]
    return ", ".join(listed) if listed else "nothing"


def lines(recorded: dict[str, Any] | None) -> list[str]:
    """The certificate's and the summary's sentences. One renderer.

    **Ruling 1 is in the wording, not in a footnote.** A survivor is a finding
    about the checks, and the sentence that names one says so before it names
    anything else.
    """
    if not recorded:
        return []
    verdict = recorded.get("verdict")
    reason = str(recorded.get("reason") or "")
    if verdict == NOT_APPLICABLE:
        return [f"Nothing was broken on purpose in this change: {reason}."]
    if verdict == INCONCLUSIVE:
        return [
            "**This change could not be broken on purpose, so nothing was "
            f"measured about its checks.** {reason}."
        ]
    counts = recorded.get("counts") or {}
    attempted = int(counts.get("attempted", 0))
    survived = int(counts.get("survived", 0))
    if not attempted:
        return []
    said = []
    if reason:
        # The committed-range mode says WHICH change the numbers are about;
        # the working-tree mode carries no reason and adds no line.
        said.append(f"_{reason}._")
    if survived:
        said.append(
            f"**{survived} of {attempted} deliberate breakages of this change "
            f"went UNNOTICED.** Every bound check still passed. That is a "
            f"finding about the checks — they could not tell the difference "
            f"between the code as delivered and the code with that line "
            f"broken — and not a finding about the change."
        )
        # **BY FILE, most-unnoticed first (P2.16, 0.9.4).** This was one flat
        # bullet per survivor, and run 2's delivery had 23 of 24 survive: a
        # 23-line list in which every line looks like every other, which is a
        # loud fact rendered as something a PM scrolls past.
        #
        # The partition is arithmetic over `path` and `survived`, both of
        # which every attempt already records. **Nothing here says which
        # check SHOULD have caught a mutant** — no record maps a line to a
        # gate, every bound gate runs against every mutant, and a sentence
        # naming the responsible check would be invented. The ordering is
        # described as what it is, a count, and never as "weakest": that
        # would be a judgement the numbers do not license.
        by_file: dict[str, list[dict]] = {}
        attempted_per_file: dict[str, int] = {}
        for attempt in recorded.get("attempts") or []:
            path = str(attempt.get("path"))
            attempted_per_file[path] = attempted_per_file.get(path, 0) + 1
            if attempt.get("survived"):
                by_file.setdefault(path, []).append(attempt)

        said.append(
            "Where they went unnoticed, by file, most first — a count, not a "
            "ranking, and it does not say which check should have caught them:"
        )
        for path in sorted(by_file, key=lambda p: (-len(by_file[p]), p)):
            survivors = by_file[path]
            said.append(
                f"  - `{path}` — {len(survivors)} of "
                f"{attempted_per_file[path]} unnoticed"
            )
            for attempt in survivors:
                said.append(
                    f"      - line {attempt.get('line')}: "
                    f"{attempt.get('mutation')}, and "
                    f"{_named(recorded.get('gates'))} stayed green: "
                    f"`{attempt.get('became')}`"
                )
    else:
        said.append(
            f"**{attempted} deliberate breakages of this change were "
            f"attempted, and every one was caught.**"
        )
    if recorded.get("truncated"):
        said.append(str(recorded["truncated"]) + ".")
    said += list(recorded.get("limits") or [])
    return said
