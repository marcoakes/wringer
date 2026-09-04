"""**Every `file:line` a spec cites is checked against the tree.**

Owed by the hunt's round-3 review, which found four drifted citations in one
document — and the two rounds before it found more. The class is the hand-kept
one this repository keeps re-learning: a spec quotes a line number, the line
moves, and the document goes on citing evidence for a claim the evidence no
longer makes. Nothing looked. A reader who follows a citation and lands on a
closing `\"\"\"` stops trusting the document, and they are right to.

Three checks, in increasing strength, and the third is the one that caught the
real drifts:

1. **The file exists** — resolved through the roots this repository puts
   source in, because specs cite `verify.py` and `test_schema.py` as often as
   full paths.
2. **The range is inside the file.** A citation past the end is a file that
   shrank under a document.
3. **The QUOTE lands in the RANGE.** Where a spec cites a line and then quotes
   what is there — the `*"..."*` form this repository writes in — the quoted
   words have to be within the lines named. All four of round 3's drifts were
   off-by-a-few, which only this check can see: `AGENTS.md:545-548` for a
   sentence that runs 548-550, `verify.py:753` for a law named at 751,
   `git.py:176-179` for a sentence at 175-178.

Plus the fourth thing that round found: a section reference to a `§5.4` that
does not exist.

**Deliberately scoped to `docs/specs/`.** Specs are the binding documents and
the ones a reviewer follows citation by citation. Widening this to every
markdown file in the repository is a bigger, noisier job and would have to
come with a plan for the captures, which are frozen by Law 8 and SHOULD go
stale against a later tree.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPECS = sorted((ROOT / "docs" / "specs").glob("*.md"))

#: Where this repository keeps things a spec might cite by bare name.
SEARCH_ROOTS = ("", "src/wringer/", "src/wringer_board/", "src/wringer_drive/",
                "tests/", "tests/drive/", "tests/board/", "docs/",
                "docs/specs/", "scripts/", "schema/", "examples/", "m3/")

CITATION = re.compile(
    r"`([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:py|md|json|yaml|yml|sh|js|toml)):"
    r"(\d+)(?:-(\d+))?`"
)

#: The quote form the specs use, immediately after a citation: a colon or an
#: em dash, then italic double quotes. Anything looser matches prose that is
#: about the citation rather than from it.
QUOTED = re.compile(r"^[\s:—-]*\*\"(.+?)\"\*", re.S)


#: Paths that never were this repository's. A spec may cite a vendor's
#: bundled adapter or a plan file that lives in the operator's own directory;
#: neither is checkable from here and neither is drift. They are reported by
#: name so the set stays small and visible rather than growing quietly.
def resolve(name: str) -> tuple[Path | None, bool]:
    """Where a cited path actually is, and whether the spec's own path found it.

    The second half is the point. A citation that resolves only when you go
    looking for its BASENAME is a path that moved — which is precisely what
    happened when four packages became one and every `wringer-board/...`
    citation in the specs stopped being a path anybody could follow. The file
    is still there, the reader is not.
    """
    for base in SEARCH_ROOTS:
        candidate = ROOT / (base + name)
        if candidate.is_file():
            return candidate, True
    hits = [
        path
        for path in ROOT.rglob(Path(name).name)
        if not {".git", "build", ".venv", "__pycache__"} & set(path.parts)
    ]
    return (hits[0], False) if len(hits) == 1 else (None, False)


def citations():
    for spec in SPECS:
        body = spec.read_text(encoding="utf-8")
        for found in CITATION.finditer(body):
            name = found.group(1)
            start = int(found.group(2))
            end = int(found.group(3) or found.group(2))
            yield spec, body, found, name, start, end


@pytest.mark.parametrize("spec", SPECS, ids=lambda p: p.name)
def test_NO_CITATION_NAMES_A_PATH_THE_FILE_HAS_MOVED_FROM(spec: Path):
    """**The drift the package merge left behind, and nobody looked.**

    A citation whose path is wrong but whose basename is unique still points a
    reader at nothing. Six of them were sitting in two binding specs when this
    guard was first run, every one a `wringer-board/...` path from before the
    four packages became one.
    """
    body = spec.read_text(encoding="utf-8")
    moved = []
    for found in CITATION.finditer(body):
        target, exact = resolve(found.group(1))
        if target is not None and not exact:
            moved.append(f"{found.group(0)} — it is at {target}")
    assert not moved, (
        f"{spec.name} cites paths the files have moved from:\n  "
        + "\n  ".join(sorted(set(moved)))
    )


def test_THE_CITATIONS_THIS_GUARD_CANNOT_CHECK_ARE_NAMED_AND_FEW():
    """**Stated rather than skipped.**

    A spec may cite something that is not this repository's — a vendor's
    bundled adapter, a plan file in the operator's own directory. Nothing here
    can check those, and pretending otherwise would make this guard lie. So
    they are counted: the set is small and visible, and a spec that started
    citing a dozen unverifiable things would fail here rather than quietly
    dilute the check.
    """
    outside = []
    for spec in SPECS:
        for found in CITATION.finditer(spec.read_text(encoding="utf-8")):
            if resolve(found.group(1))[0] is None:
                outside.append(f"{spec.name}: {found.group(0)}")
    assert len(outside) <= 6, (
        "specs now cite more unverifiable paths than this guard was written "
        f"against, which dilutes every check in this file: {sorted(outside)}"
    )


@pytest.mark.parametrize("spec", SPECS, ids=lambda p: p.name)
def test_EVERY_CITED_RANGE_IS_INSIDE_THE_FILE(spec: Path):
    body = spec.read_text(encoding="utf-8")
    past = []
    for found in CITATION.finditer(body):
        target, _exact = resolve(found.group(1))
        if target is None:
            continue  # the check above owns this
        end = int(found.group(3) or found.group(2))
        length = len(target.read_text(encoding="utf-8").splitlines())
        if end > length:
            past.append(f"{found.group(0)} — {found.group(1)} has {length} lines")
    assert not past, (
        f"{spec.name} cites past the end of a file: {past}. The file shrank "
        "underneath the document."
    )


def _normalise(text: str) -> str:
    """Words and nothing else.

    Punctuation is where this check goes wrong in BOTH directions: a spec
    quoting a sentence that ends in a full stop where the source has a comma,
    a source wrapping a phrase across a comment marker, backticks around an
    identifier on one side and not the other. The first version of this guard
    failed on three correct citations for exactly those reasons, which would
    have made it noise somebody turned off.
    """
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", text.lower())).strip()


@pytest.mark.parametrize("spec", SPECS, ids=lambda p: p.name)
def test_A_QUOTE_BESIDE_A_CITATION_IS_INSIDE_THE_LINES_IT_CITES(spec: Path):
    """**The check that catches an off-by-a-few, which is every real drift.**

    Existence and in-range both pass for a citation pointing three lines away
    from the sentence it quotes. Only reading the cited lines catches that,
    and reading them is what a reviewer does by hand, four times, every round.
    """
    body = spec.read_text(encoding="utf-8")
    drifted = []
    for found in CITATION.finditer(body):
        target, _exact = resolve(found.group(1))
        if target is None:
            continue
        quote = QUOTED.match(body[found.end() : found.end() + 400])
        if quote is None:
            continue
        # Ellipses mean the spec elided part of the source; only the first run
        # is contiguous in the file.
        wanted = _normalise(
            re.split(r"\s*(?:…|\.\.\.)\s*", quote.group(1))[0]
        )
        # **The FIRST eight words, not the whole quote.** The property is
        # "the citation points at where this text begins" — a quote that runs
        # past the cited range is a citation a reader can still follow, and
        # demanding the whole run made this guard fail on correct citations
        # whose quote simply continued onto the next line.
        words = wanted.split()[:8]
        if len(words) < 5:
            continue
        wanted = " ".join(words)
        start = int(found.group(2))
        end = int(found.group(3) or found.group(2))
        lines = target.read_text(encoding="utf-8").splitlines()
        cited = _normalise(" ".join(lines[start - 1 : end]))
        if wanted not in cited:
            drifted.append(
                f"{found.group(0)} quotes {quote.group(1)[:60]!r} and lines "
                f"{start}-{end} do not contain it"
            )
    assert not drifted, (
        f"{spec.name} has citations whose quote is not in the lines named:\n  "
        + "\n  ".join(drifted)
    )


# ---------------------------------------------------------------------------
# **The fourth drift round 3 found is NOT covered here, and that is a decision.**
#
# It was `§5.4`, cited twice, in a document whose §5 has no subsections. A
# check for it was written and DELETED, because it fired on three correct
# usages for every real one: `SPEC_BOARD_V0` cites `PM_ARC §3.2` — another
# document's section — and `SPEC_CONTAIN_V0`'s `§7.1` means item 1 of §7's
# numbered list, which has no heading and never will. Separating those from a
# dangling reference needs to know which document a `§` belongs to, and
# nothing in the text says.
#
# A guard that fires on correct usage is a guard somebody turns off, which is
# worse than no guard. Recorded as uncovered rather than shipped as noise.
# ---------------------------------------------------------------------------


#: A reference that LOOKS like a citation but carries no readable line
#: number. `AGENTS.md:-4` is the measured shape: a repointing script wrote it
#: on 2026-09-04 and every guard in this file passed, because `CITATION`
#: requires digits and simply did not match — so a broken pointer was
#: invisible rather than caught. A citation nobody can follow is the failure
#: this whole file exists to prevent, and silence is the worst way to have it.
#: Deliberately NARROW. Three forms are readable and this repository uses
#: all three on purpose: a line or range (`accept.py:146-150`), a
#: comma-separated list (`sign.py:81,87`), a pytest node id
#: (`test_docs.py::test_name`) and a SYMBOL (`deliver.py:_verdict`, which
#: survives an edit above it). What is caught is a colon followed by none of
#: those — the measured shape is `AGENTS.md:-4`, written by a repointing
#: script on 2026-09-04 and invisible to every other guard in this file.
MALFORMED = re.compile(
    r"`([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:py|md|json|yaml|yml|sh|js|toml)):"
    r"(?![:\d]|[A-Za-z_])([^`\n]*)`"
)


@pytest.mark.parametrize("spec", SPECS, ids=lambda p: p.name)
def test_NO_CITATION_IS_MALFORMED_AND_THEREFORE_UNCHECKED(spec: Path):
    """A citation the checker cannot parse must fail, not vanish."""
    broken = [
        f"`{name}:{rest}`"
        for name, rest in MALFORMED.findall(spec.read_text(encoding="utf-8"))
    ]
    assert not broken, (
        f"{spec.name} carries citation-shaped references with no readable "
        f"line number, so every other guard here skipped them: {broken}"
    )
