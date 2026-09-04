"""`scripts/release.py` — the version ceiling, applied to every page or none.

**The body count this exists for, all on the record.** The ceiling is eleven
edits across eight files, done by hand with `sed` until 2026-09-04:

- a repointing `sed` wrote the citation `AGENTS.md:-4`, invisible to every
  citation guard because the pattern requires digits (0.8.4);
- a supported-versions row named a version that was never tagged, and
  CONTRIBUTING claimed "all on PyPI" while listing two that were not — wrong
  since 0.8.7 and unnoticed until 0.9.0.

One defect twice: an edit applied to some pages and not others, with nothing
checking the set was complete.

These guards run the planner against THE REAL PAGES, copied into a temporary
tree. That is deliberate: a page that changes shape enough to break an anchor
must break this suite rather than being quietly skipped at release time.
"""

from __future__ import annotations

import importlib.util
import re
import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "release.py"

pytestmark = pytest.mark.skipif(
    not SCRIPT.is_file(), reason="scripts/ is not part of the distribution"
)

CEILING = (
    "src/wringer/__init__.py",
    "README.md",
    "SETUP.md",
    "QUICKSTART.md",
    "AGENTS.md",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "CHANGELOG.md",
)


def _release_module():
    spec = importlib.util.spec_from_file_location("release_script", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def tree(tmp_path: Path) -> Path:
    """A copy of this repository's real ceiling pages."""
    for name in CEILING:
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)
    return tmp_path


ENTRY = "## 9.9.9 — 2026-01-01\n\nA test entry.\n"


def test_EVERY_CEILING_PAGE_carries_the_new_version(tree):
    """The whole point: one call, every page, no page left behind."""
    release = _release_module()
    old = release.current_version(tree)
    planned = release.plan(tree, "9.9.9", "Ninety-nine", ENTRY)

    assert {p.relative_to(tree).as_posix() for p in planned} == set(CEILING), (
        "the planner touched a different set of pages than the ceiling"
    )
    for path, body in planned.items():
        if path.name == "CHANGELOG.md":
            continue
        assert "9.9.9" in body, f"{path.name} does not carry the new version"
    assert '__version__ = "9.9.9"' in planned[tree / "src/wringer/__init__.py"]
    assert old not in planned[tree / "QUICKSTART.md"], (
        "a prose page still names the old version"
    )


def test_NOTHING_IS_WRITTEN_when_one_anchor_is_missing(tree):
    """**Fail closed, and closed means the tree is untouched.**

    A ceiling applied to some pages and not others is a tree that looks
    released and is not — the exact state 0.9.0 had to be untangled out of.
    So the planner locates every anchor before it returns anything, and the
    caller writes only after that.
    """
    release = _release_module()
    before = {name: (tree / name).read_text(encoding="utf-8") for name in CEILING}

    security = tree / "SECURITY.md"
    old = release.current_version(tree)
    security.write_text(
        security.read_text(encoding="utf-8").replace(
            f"| `{old}` (PyPI, current) | ✅ |", "| `nothing` | ✅ |"
        ),
        encoding="utf-8",
    )
    before["SECURITY.md"] = security.read_text(encoding="utf-8")

    with pytest.raises(release.Refused) as refusal:
        release.plan(tree, "9.9.9", "Ninety-nine", ENTRY)
    assert "SECURITY.md" in str(refusal.value)

    for name in CEILING:
        assert (tree / name).read_text(encoding="utf-8") == before[name], (
            f"{name} was modified despite the release refusing — a "
            "half-applied ceiling is worse than none"
        )


def test_AN_AMBIGUOUS_ANCHOR_is_refused_rather_than_replaced_twice(tree):
    """An anchor that matches twice would edit something that is not the
    ceiling. The refusal says how many times it matched, because "not found"
    and "found everywhere" need different fixes."""
    release = _release_module()
    old = release.current_version(tree)
    security = tree / "SECURITY.md"
    body = security.read_text(encoding="utf-8")
    security.write_text(
        body.replace(
            f"young software (`{old}`)",
            f"young software (`{old}`) young software (`{old}`)",
            1,
        ),
        encoding="utf-8",
    )

    with pytest.raises(release.Refused) as refusal:
        release.plan(tree, "9.9.9", "Ninety-nine", ENTRY)
    assert "appears 2 times" in str(refusal.value)


def test_A_PAGE_THAT_STOPPED_CARRYING_THE_CLAIM_is_a_refusal_not_a_no_op(tree):
    """**A page that no longer mentions the released version is the defect
    this script exists to catch, not a page to skip.**

    Replacing "every mention of the old version" is a no-op on a page with no
    mentions, and a no-op is silent. That silence is how a ceiling page drifts
    out of the set without anybody noticing — which is the 0.8.7 defect
    exactly.
    """
    release = _release_module()
    old = release.current_version(tree)
    quickstart = tree / "QUICKSTART.md"
    quickstart.write_text(
        quickstart.read_text(encoding="utf-8").replace(old, "some other text"),
        encoding="utf-8",
    )

    with pytest.raises(release.Refused) as refusal:
        release.plan(tree, "9.9.9", "Ninety-nine", ENTRY)
    assert "QUICKSTART.md" in str(refusal.value)
    assert "stopped carrying" in str(refusal.value)


def test_SECURITY_demotes_the_old_current_row_rather_than_dropping_it(tree):
    """The table's whole question is whether a version is covered, so the
    version that was current yesterday must become an upgrade row, not
    vanish."""
    release = _release_module()
    old = release.current_version(tree)
    planned = release.plan(tree, "9.9.9", "Ninety-nine", ENTRY)
    table = planned[tree / "SECURITY.md"]

    assert "| `9.9.9` (PyPI, current) | ✅ |" in table
    assert f"| `{old}` (PyPI) | upgrade — `pip install -U wringer` |" in table
    assert f"| `{old}` (PyPI, current) | ✅ |" not in table, (
        "two versions are both marked current"
    )


def test_CONTRIBUTING_gains_the_tag_and_the_count_and_the_current_marker(tree):
    """Three edits in one sentence, and a guard in `test_docs.py` holds the
    count against the list and the list against the CHANGELOG. Getting one of
    the three and not the others is a red bar at the worst moment."""
    release = _release_module()
    old = release.current_version(tree)
    planned = release.plan(tree, "9.9.9", "Ninety-nine", ENTRY)
    body = planned[tree / "CONTRIBUTING.md"]

    assert "**Ninety-nine releases have shipped**" in body
    assert f"`v{old}` and `v9.9.9`" in body
    assert "with `v9.9.9` the current one" in body
    assert f"with `v{old}` the current one" not in body


def test_THE_TAG_LIST_KEEPS_ITS_SEPARATORS_when_a_release_is_appended(tree):
    """**Found by running this for real on 0.9.2.** Appending to the list by
    replacing "and `v<old>`" swallowed the separator the tag BEFORE it needed,
    and produced ``…`v0.9.0` `v0.9.1` and `v0.9.2`…`` — two tags with nothing
    between them.

    The count guard in `test_docs.py` cannot see this: it collects versions
    with a regex and a missing comma is still two versions. So the shape is
    checked here, on the join between the last three, which is the only place
    an append can damage.
    """
    release = _release_module()
    old = release.current_version(tree)
    planned = release.plan(tree, "9.9.9", "Ninety-nine", ENTRY)
    body = planned[tree / "CONTRIBUTING.md"]

    opening = body.split("Since `0.4.0`")[0]
    assert opening.count("`v") > 10, "the tag list is not being read"

    # The defect exactly: two tags with nothing but whitespace between them.
    # Not "every tag is followed by a comma" — `v0.1.0` is legitimately
    # followed by a date clause, and the first draft of this guard failed on
    # that, reporting correct prose as damage.
    # `\s*`, not `\s+`: the anchor that ate the separator ate the SPACE with
    # it, so the two tags end up with nothing at all between them — and a
    # guard requiring whitespace missed exactly that. Found by red-watch.
    touching = re.findall(
        r"`v\d+\.\d+\.\d+`\s*`v\d+\.\d+\.\d+`", opening
    )
    assert not touching, (
        f"CONTRIBUTING's tag list has adjacent tags with no separator: "
        f"{touching} — an append ate the one that was there"
    )
    assert f"`v{old}` and `v9.9.9`" in opening
    assert opening.rstrip().endswith("the current one.") or (
        "`v9.9.9` the current one" in opening
    )


def test_THE_CHANGELOG_ENTRY_goes_ABOVE_the_previous_release(tree):
    release = _release_module()
    old = release.current_version(tree)
    planned = release.plan(tree, "9.9.9", "Ninety-nine", ENTRY)
    body = planned[tree / "CHANGELOG.md"]

    assert body.index("## 9.9.9 — ") < body.index(f"## {old} — "), (
        "the new entry landed below the release it supersedes"
    )
    assert body.count("## 9.9.9 — ") == 1


def test_RE_RELEASING_THE_SAME_VERSION_is_refused(tree):
    """Running it twice would append a second tag to CONTRIBUTING's list and
    a second CHANGELOG entry, and the second run's diff would look plausible."""
    release = _release_module()
    old = release.current_version(tree)
    with pytest.raises(release.Refused) as refusal:
        release.plan(tree, old, "Ninety-nine", ENTRY)
    assert "already says" in str(refusal.value)
