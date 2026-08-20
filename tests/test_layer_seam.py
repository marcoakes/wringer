"""The board is a LAYER, and collapsing the packages did not dissolve it.

`wringer_board` shipped as its own distribution until 2026-08-20. It was
merged into this one because four packages — two of them never published —
read as sprawl, and because `pip install wringer-drive` was unresolvable for
months as a direct consequence: the drive declared `wringer-board` as a
dependency and nothing by that name existed on the index.

**What the merge must not cost is the seam.** SPEC_BOARD_V0 calls the board
"a SEPARATE LAYER consuming bundles and the CLI as its API", and that is real
discipline: it is why the board cannot quietly start depending on engine
internals and drift into a second implementation of them.

That discipline was never held up by the package boundary. It was held up by
the board importing almost nothing, and by its tests running without the
engine present. This file is what holds it up now, explicitly, so that the
thing the boundary was standing in for survives losing the boundary.
"""

from __future__ import annotations

import ast
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"
BOARD = SRC / "wringer_board"

# The board may read what the engine PUBLISHES — its schemas, its bundles, its
# CLI — and exactly two things from its code: `spec`, whose loader defines the
# file both surfaces edit, and `accept`, whose symbols the refusal mapping is
# cross-checked against. Everything else is an internal.
PERMITTED = {"wringer.spec", "wringer.accept", "wringer"}


def _engine_imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(a.name for a in node.names if a.name.split(".")[0] ==
                "wringer")
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module.split(".")[0] != "wringer":
                continue
            # `from wringer import spec` names the module in `names`.
            if module == "wringer":
                found.update(f"wringer.{a.name}" for a in node.names)
            else:
                found.add(module)
    return found


def test_the_board_never_imports_an_engine_INTERNAL():
    """**The seam, now that the package boundary is gone.**

    A violation here is not a style point. The board's whole claim is that it
    renders what the engine recorded and re-describes nothing; a module that
    reaches into `wringer.loop` or `wringer.deliver` has started reimplementing
    the thing it is supposed to be reporting on, and the two will drift.
    """
    offenders: dict[str, set[str]] = {}
    for path in sorted(BOARD.rglob("*.py")):
        bad = _engine_imports(path) - PERMITTED
        if bad:
            offenders[path.name] = bad
    assert not offenders, (
        f"the board reached into engine internals: {offenders}. It consumes "
        "bundles and the CLI as its API — anything else is the layer "
        "dissolving, which is what the package split used to prevent and what "
        "this test prevents now"
    )


def test_the_board_still_runs_without_the_engine_IMPORTED():
    """Its own tests `importorskip` the engine on purpose, so the board can be
    exercised against bundles alone. Merging the distributions must not make
    the engine a hard import at module load, or that property is gone and
    nobody would notice until someone tried to use the board by itself.
    """
    import subprocess
    import sys

    # A subprocess with `wringer` poisoned: importing the board must still work.
    probe = (
        "import sys;"
        "sys.modules['wringer'] = None;"
        "import importlib;"
        "importlib.import_module('wringer_board.render');"
        "importlib.import_module('wringer_board.cards');"
        "print('ok')"
    )
    done = subprocess.run(
        [sys.executable, "-c", probe], capture_output=True, text=True, check=False
    )
    assert done.returncode == 0 and "ok" in done.stdout, (
        "the board no longer imports without the engine available:\n"
        f"{done.stderr[-800:]}"
    )


def test_the_permitted_list_is_not_silently_widened():
    """A guard whose allowlist anyone can extend is a guard that documents a
    violation rather than refusing one. Two entries, both with a reason in the
    comment above them; a third needs a person to argue for it here.
    """
    assert PERMITTED == {"wringer.spec", "wringer.accept", "wringer"}, (
        "the permitted-import set changed. That is allowed, but it is the "
        "seam widening and it should be argued for in the comment above, not "
        "slipped in beside a feature"
    )
