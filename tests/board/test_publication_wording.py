"""Guards on what this repository says about its own publication status.

**Why this file exists at all, and why it lives HERE rather than in the core.**

`wringer/docs/MANUAL_CHECKS.md:723-744` records this exact failure being
diagnosed once already: a sentence said *"the board has no remote, publication
is blocked"*, which was true of a local clone and false of the repository. The
correction landed in the core and **never reached this repository**, where the
same class of sentence stood until 2026-08-18 — so the defect is not a wrong
sentence, it is a fix that stopped at a repository boundary.

The structural answer is the one `test_install_prompt.py` already established:
**a cross-repository guard lives in the DEPENDENT repository and reaches
back**. This package imports `wringer`; the core does not import this package.
So this repository can check both sides and the core can only check one, which
is why both guards below are here.

Neither guard keeps a list of facts. The first reads `git remote get-url
origin` — this repository's real remote, from git, not from a fixture — and the
second reads the core's README on disk. A hand-kept list of what is published
is drift with extra steps, which is the thing being guarded against.

**What is deliberately NOT checked: PyPI.** Tests here send nothing over the
network. `wringer-board` genuinely is not on PyPI (404, checked 2026-08-18 by
hand and recorded in the finish report), and the README's PyPI clause is the
one clause of that sentence that was always true.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest


def repo_root() -> Path:
    """**One level further up since the packages collapsed (2026-08-20).**

    These tests lived in a separate `wringer-board` repository whose root was
    two levels above them. They now sit at `tests/board/` inside the engine's
    own repository, so the root is three. This is exactly the kind of quiet
    breakage a move leaves behind, and it surfaced as a `FileNotFoundError`
    rather than as a wrong answer only because the guard reads real files.
    """
    return Path(__file__).resolve().parent.parent.parent


def own_voice(text: str) -> str:
    """A document's own claims, with quoted material removed.

    Byte-for-byte the rule the core's `tests/test_docs.py:2251` applies, and
    re-stated rather than imported because the core's test module is not part
    of its installed package. A `>` line is a document REPORTING a claim (this
    README quotes what its own install line will become once published), and a
    guard that cannot tell reporting from claiming would force a document to
    delete its own history to stay green.
    """
    return "\n".join(
        line for line in text.splitlines() if not line.lstrip().startswith(">")
    )


# Documents in this repository that a reader lands on. Not `tests/`, and not
# `docs/captures/*.html` — those are committed renders, and a render is
# evidence rather than a claim.
PUBLIC_PROSE = (
    "README.md",
    "docs/index.md",
    "docs/captures/README.md",
)


# Sentence shapes that assert THIS REPOSITORY, or the page it serves, is not
# published. Each one was live in the tree on 2026-08-18 or is the obvious way
# a future edit would re-introduce the claim.
#
# **Scoped away from PyPI on purpose.** "There is no PyPI release" is true and
# must stay sayable; "this repository is not public" is false and must not.
DENIES_PUBLICATION = (
    re.compile(r"\bnot published yet\b", re.I),
    re.compile(r"\bnot yet published\b", re.I),
    re.compile(r"\bbefore (?:it|this) is published\b", re.I),
    re.compile(r"\bbefore publication\b", re.I),
    re.compile(r"\bthis repository is not public\b", re.I),
    re.compile(r"\bthe repository is not public\b", re.I),
    re.compile(r"\bis not public\b", re.I),
    re.compile(r"\bwhen it is published\b", re.I),
    re.compile(r"\bonce it is published\b", re.I),
    re.compile(r"\bpublication is blocked\b", re.I),
    re.compile(r"\bhas no remote\b", re.I),
)


def flattened(text: str) -> str:
    """Whitespace and emphasis markers flattened; blockquotes KEPT as-is.

    The core's `tests/test_docs.py:785` rule, minus its blockquote stripping —
    callers here decide separately whether quoted material counts, and folding
    the two would make `own_voice` unable to do its job.

    **This exists because its absence was a live defect in this very file.**
    The first draft of the anchor search below read the core's README
    line-by-line, and the core wraps `It is **not on / PyPI**` across two
    lines, so the PyPI half of the cross-repo guard matched nothing and could
    not fail. A mutation on 2026-08-18 — a real `pip install wringer-board`
    put into the README's runnable block — passed, which is how it was found.
    """
    return " ".join(text.replace("*", "").split())


def denials(text: str) -> list[str]:
    """Every own-voice claim that this repository is unpublished.

    **Paragraph-wise, not line-wise, and that is not a detail.** The first
    draft of this guard scanned lines and silently missed
    `docs/captures/README.md`, whose sentence wraps as *"…before it is /
    published anywhere"* — the guard would have gone green over a
    contradiction it was written to find, which is the exact
    guard-goes-quiet shape this file exists to refuse.
    """
    found = []
    for block in re.split(r"\n\s*\n", own_voice(text)):
        flat = flattened(block)
        for pattern in DENIES_PUBLICATION:
            hit = pattern.search(flat)
            if hit:
                window = flat[max(0, hit.start() - 60) : hit.end() + 60]
                found.append(f"{pattern.pattern} :: …{window}…")
    return found


def origin_url() -> str | None:
    """This repository's real remote, or None when it cannot be read.

    None on an sdist install (no `.git`), on a checkout with no remote, and
    where git is absent. The caller SKIPS rather than failing: a guard that
    errors where the fact is unavailable teaches people to delete guards.
    """
    if not (repo_root() / ".git").exists():
        return None
    try:
        done = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=repo_root(),
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return None
    return done.stdout.strip() or None


def test_the_readme_does_not_deny_this_repositorys_own_remote():
    """**Red on the real defect, 2026-08-18.**

    `README.md:23-25` said *"Not published yet … this repository is not
    public"* while `git remote get-url origin` answered
    `https://github.com/marcoakes/wringer-board.git` and the Pages URL served
    HTTP 200. The fact is read from git, in this repository, at test time —
    the one place it cannot go stale.

    Scans every document in `PUBLIC_PROSE`, because the same false sentence
    stood in `docs/captures/README.md` too, which is how this class travels.
    """
    remote = origin_url()
    if remote is None:
        pytest.skip(
            "no readable `origin` for this checkout (sdist, or a clone with "
            "no remote), so there is no fact to check the prose against"
        )

    offending = {}
    for relative in PUBLIC_PROSE:
        path = repo_root() / relative
        if not path.is_file():
            continue
        hits = denials(path.read_text(encoding="utf-8"))
        if hits:
            offending[relative] = hits

    assert not offending, (
        f"this repository has a remote — {remote} — and these documents say "
        f"in their own voice that it is unpublished:\n"
        + "\n".join(
            f"  {name}: {hit}"
            for name, hits in sorted(offending.items())
            for hit in hits
        )
        + "\n\nA PyPI clause is not this: `wringer-board` really is not on "
        "PyPI, and saying so stays permitted."
    )


def core_readme() -> str:
    """The CORE repository's README, found through the engine it ships.

    The same reach-back `test_install_prompt.py` uses, and skipped with a
    named reason when the core is not beside this checkout — the core cannot
    perform this check itself, so a silent skip would leave nobody doing it.
    """
    wringer = pytest.importorskip(
        "wringer.accept",
        reason="the core is not importable, so its README cannot be located. "
        "Nothing else checks that these two repositories agree about this "
        "repository's publication status, and this is that gap being named",
    )
    path = Path(wringer.__file__).resolve().parents[2] / "README.md"
    if not path.is_file():
        pytest.skip(f"the core is importable but {path} is absent")
    return path.read_text(encoding="utf-8")


# What the core CLAIMS about this repository, read off its prose rather than
# copied into a constant. `README.md:479-481` is the sentence.
#
# Both are searched against `flattened()` text, never raw lines: the core wraps
# `It is **not on / PyPI**` across two lines, and a line-wise search for it
# silently matches nothing.
CORE_SAYS_PUBLISHED = re.compile(
    r"(source and a live page are both public|is public and live)", re.I
)
CORE_SAYS_NOT_ON_PYPI = re.compile(r"\bnot on PyPI\b", re.I)


def install_instructions(text: str) -> list[str]:
    """Lines inside ```bash fences — the ones a reader is told to type.

    The core's `bash_blocks()` distinction, and it is what makes the PyPI half
    of this guard mechanical: prose may SAY that the install line becomes
    `pip install wringer-board` once there is a release, because that is a
    statement about the future. A ```bash fence is an instruction for today,
    and today it would fail.
    """
    lines = []
    for block in re.findall(r"```bash\s*\n(.*?)```", text, re.DOTALL):
        lines.extend(line.strip() for line in block.splitlines() if line.strip())
    return lines


PYPI_INSTALL = re.compile(r"^\s*(?:pip|uv pip|pipx)\s+install\s+wringer-board\b", re.I)


def test_publication_wording_agrees_with_the_core_readme():
    """**Red on the real defect, 2026-08-18.**

    The core's README said the board's source and live page *"are both
    public"* while this repository's README said *"this repository is not
    public"*. Two documents, one fact, opposite answers — and the reader
    reaching this repository got the false one.

    Both sides are read at test time. If the core's sentence is ever
    rewritten, this guard fails loudly on its anchor rather than passing
    while checking nothing.
    """
    core = flattened(own_voice(core_readme()))
    core_published = CORE_SAYS_PUBLISHED.search(core) is not None
    core_no_pypi = CORE_SAYS_NOT_ON_PYPI.search(core) is not None

    assert core_published or core_no_pypi, (
        "neither anchor sentence was found in the core's README, so this "
        "guard would pass while checking nothing. The core's publication "
        "wording moved — re-derive both patterns against `README.md:479-482` "
        "rather than deleting this assertion"
    )

    readme = (repo_root() / "README.md").read_text(encoding="utf-8")

    if core_published:
        hits = denials(readme)
        assert not hits, (
            "the core's README says this repository's source and live page "
            "are both public; this repository's README contradicts it:\n"
            + "\n".join(f"  {hit}" for hit in hits)
        )

    if core_no_pypi:
        told_to_run = [
            line for line in install_instructions(readme) if PYPI_INSTALL.match(line)
        ]
        assert not told_to_run, (
            "the core's README says `wringer-board` is not on PyPI; this "
            "README's runnable block tells a reader to run "
            f"{told_to_run}, which would fail for them today"
        )
