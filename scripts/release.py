#!/usr/bin/env python3
"""Apply a release's version ceiling — every page at once, or none of them.

    scripts/release.py <version> <count-word> <changelog-entry-file>

**Why this is a script and not a habit.** The ceiling is eleven edits across
eight files, and until 2026-09-04 it was done by hand with `sed` every time.
Two things that cost, both on the record:

- a repointing `sed` wrote the citation `AGENTS.md:-4`, which every citation
  guard ignored because the pattern requires digits (0.8.4);
- a release went out with a supported-versions row for a version that was
  never tagged, and the page had claimed "all on PyPI" while naming two that
  were not — since 0.8.7, unnoticed until 0.9.0.

Both are the same defect: an edit applied to some pages and not others, with
nothing checking the set was complete.

**Fail closed, and closed means NOTHING IS WRITTEN.** Every anchor is located
first, in every file. One missing or ambiguous anchor and the whole release
refuses, naming what it could not find. A half-applied ceiling is worse than
none: it is a tree that looks released and is not, which is exactly the state
0.9.0 had to be untangled out of.

It does not commit, tag, push, or run the bar. Those are `scripts/ship.sh`
and the runbook, and keeping them apart is deliberate: this is the only part
that is pure text and can be tested.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Spelled counts, the same words `tests/test_docs.py` checks CONTRIBUTING's
#: sentence against. Passed in rather than derived, so a release states the
#: number it believes and the guard disagrees loudly when it is wrong.
VERSION_RE = re.compile(r'__version__ = "(\d+\.\d+\.\d+)"')


class Refused(Exception):
    """An anchor was missing or ambiguous. Nothing has been written."""


def _one(text: str, needle: str, where: str) -> None:
    found = text.count(needle)
    if found == 0:
        raise Refused(f"{where}: could not find {needle!r}")
    if found > 1:
        raise Refused(
            f"{where}: {needle!r} appears {found} times, so replacing it "
            "would change more than the release ceiling"
        )


def current_version(root: Path) -> str:
    found = VERSION_RE.search(
        (root / "src" / "wringer" / "__init__.py").read_text(encoding="utf-8")
    )
    if not found:
        raise Refused("src/wringer/__init__.py has no __version__ literal")
    return found.group(1)


def plan(root: Path, version: str, count_word: str, entry: str) -> dict[Path, str]:
    """Every file's NEW text, or raise. Writes nothing.

    Returning the whole mapping is what makes "all or none" true rather than
    intended: the caller writes only after every edit has been computed.
    """
    old = current_version(root)
    if old == version:
        raise Refused(f"the tree already says {version}; nothing to bump")

    planned: dict[Path, str] = {}

    # 1. The version literal — the fact every other page quotes.
    init = root / "src" / "wringer" / "__init__.py"
    text = init.read_text(encoding="utf-8")
    _one(text, f'__version__ = "{old}"', "src/wringer/__init__.py")
    planned[init] = text.replace(f'__version__ = "{old}"', f'__version__ = "{version}"')

    # 2. The prose pages, where every mention of the old version is a claim
    #    about what is released. A page that does not mention it at all is a
    #    page that has stopped carrying the claim — which is itself a finding,
    #    so it refuses rather than passing quietly.
    for name in ("README.md", "SETUP.md", "QUICKSTART.md", "AGENTS.md"):
        page = root / name
        body = page.read_text(encoding="utf-8")
        if old not in body:
            raise Refused(
                f"{name} does not mention {old} at all — it has stopped "
                "carrying the released-version claim this ceiling maintains"
            )
        planned[page] = body.replace(old, version)

    # 3. SECURITY.md: the sentence, and the supported-versions table, where
    #    the new release becomes current and the old one becomes an upgrade
    #    row. The table is tag-derived by a guard, so a row for a version
    #    that never ships is caught — this only has to get the shape right.
    security = root / "SECURITY.md"
    body = security.read_text(encoding="utf-8")
    sentence = f"young software (`{old}`)"
    current_row = f"| `{old}` (PyPI, current) | ✅ |"
    _one(body, sentence, "SECURITY.md")
    _one(body, current_row, "SECURITY.md")
    body = body.replace(sentence, f"young software (`{version}`)")
    body = body.replace(
        current_row,
        f"| `{version}` (PyPI, current) | ✅ |\n"
        f"| `{old}` (PyPI) | upgrade — `pip install -U wringer` |",
    )
    planned[security] = body

    # 4. CONTRIBUTING.md: the spelled count, the tag list, and which one is
    #    current. The list is held to the CHANGELOG's own entries by a guard,
    #    so appending here and prepending the entry below are two halves of
    #    one edit — which is precisely why they happen in one script.
    contributing = root / "CONTRIBUTING.md"
    body = contributing.read_text(encoding="utf-8")
    # **The SPACE and the "and" are part of the anchor, and the replacement
    # puts a comma back — found by running this for real on 0.9.2, which
    # produced "`v0.9.0` `v0.9.1` and `v0.9.2`".** Replacing just
    # "and `v<old>`" drops the separator the previous tag needed, and the
    # count guard cannot see it: it collects versions by regex, and a missing
    # comma is still two versions.
    tail = f" and `v{old}`"
    said = re.search(r"\*\*([\w-]+) releases have shipped\*\*", body)
    if not said:
        raise Refused(
            "CONTRIBUTING.md: the sentence carrying the count has been reworded"
        )
    _one(body, tail, "CONTRIBUTING.md")
    _one(body, f"with `v{old}` the current one", "CONTRIBUTING.md")
    body = body.replace(
        f"**{said.group(1)} releases have shipped**",
        f"**{count_word} releases have shipped**",
    )
    body = body.replace(tail, f", `v{old}` and `v{version}`")
    body = body.replace(
        f"with `v{old}` the current one", f"with `v{version}` the current one"
    )
    planned[contributing] = body

    # 5. The CHANGELOG entry, prepended above the previous release's heading.
    changelog = root / "CHANGELOG.md"
    body = changelog.read_text(encoding="utf-8")
    heading = re.search(r"^## \d+\.\d+\.\d+ — ", body, re.M)
    if not heading:
        raise Refused("CHANGELOG.md has no release heading to prepend above")
    if f"\n## {version} — " in body:
        raise Refused(f"CHANGELOG.md already carries an entry for {version}")
    entry = entry.rstrip("\n") + "\n\n"
    planned[changelog] = body[: heading.start()] + entry + body[heading.start() :]

    return planned


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        print(
            "usage: scripts/release.py <version> <count-word> <entry-file>",
            file=sys.stderr,
        )
        return 2
    version, count_word, entry_file = argv[1], argv[2], Path(argv[3])
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        print(f"release: {version!r} is not a version", file=sys.stderr)
        return 2
    try:
        entry = entry_file.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"release: cannot read {entry_file}: {exc}", file=sys.stderr)
        return 2

    try:
        planned = plan(ROOT, version, count_word, entry)
    except Refused as exc:
        print(f"release: REFUSED, and nothing was written.\n  {exc}", file=sys.stderr)
        print(
            "\n  Fix the page it names and run this again. A ceiling applied "
            "to some\n  pages and not others is a tree that looks released "
            "and is not.",
            file=sys.stderr,
        )
        return 1

    for path, body in planned.items():
        path.write_text(body, encoding="utf-8")
    print(f"release: {len(planned)} files carry {version}")
    for path in sorted(planned):
        print(f"  {path.relative_to(ROOT)}")
    print("\nNext:")
    print("  ./scripts/gate.sh          # the bar, ~10 minutes")
    print("  git add -A && git commit   # subject must name " + version)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
