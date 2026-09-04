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
# CLI — and exactly three things from its code, each admitted for the same
# reason: it is the definition of something the board must render VERBATIM
# rather than re-derive.
#
#   `spec`    — its loader defines the file both surfaces edit.
#   `accept`  — its symbols are what the refusal mapping is cross-checked
#               against.
#   `checks`  — added 2026-08-22 with the changed-since-bound note. The board
#               must show the engine's sentence word for word (SPEC_BOARD
#               ruling 1) and must not own a second implementation of the
#               comparison behind it. A board that re-derived "did this check
#               change?" for itself is precisely the drift this seam exists to
#               stop: two surfaces answering one question differently.
#
# Everything else is an internal. The test for admitting a fourth is the same
# one that admitted these: is the board rendering the engine's own words, or
# reaching for a mechanism it should be asking the engine for?
# **The fourth, admitted 2026-08-28, and it passed that same test.** The board
# asks `wringer.config` for one thing: the `show:` command a person declared
# for a criterion they are about to judge. That is a DECLARATION in the
# person's own file — the same class of thing `wringer.spec` holds — and the
# board renders its output verbatim without interpreting it. The alternative
# was a second YAML parser inside the board, which is the drift this test
# exists to prevent, arriving by the door marked "avoiding an import".
# **The fifth, admitted 2026-08-28, and it passed the same test.** The board
# renders the coverage number, and `wringer.coverage` is the module that
# WORDS it — one renderer, quoted verbatim by the bundle summary, the merge
# request, the certificate and this page. A copy of "N of M requirements
# carry a check that can prove them" living inside this package is precisely
# the two-surfaces-one-fact drift the seam exists to stop, and it would be
# the same defect that `accept.disclosure` was created to fix. The import is
# inside a function and its failure is caught, so a board with no engine
# present still loads and simply has no coverage sentences.
# **The sixth, admitted 2026-08-28, and it passed the same test.**
# `wringer.diagnosis.v1` is `additionalProperties: false` and frozen, so a
# record carries the FACE a failure wore and not the sentence for it. The
# board must render that sentence verbatim — it is the engine's guess about
# whether a red belongs to the environment or to the work — and the only
# alternative was a face-to-English table living in this package, which is
# exactly the two-implementations drift the seam prevents, arriving through
# the door marked "avoiding an import". The import is inside a function and
# its failure is caught.
# **The seventh, admitted 2026-08-30, and it passed the same test.** "Which
# run is the latest" is a DEFINITION, and there were two of them: this package
# ordered by `st_mtime` and `wringer.evidence` orders by the manifest's
# recorded `started_at`. A run that starts at 09:00 and takes two hours
# finishes after one that starts at 11:00 and takes a minute, so the engine
# answered `…-110000` and the board answered `…-090000` — and any `cp -r` or
# CI artifact restore rewrites mtimes wholesale. `read.latest_refusal`, ninety
# lines below the site, already refuses mtime IN THOSE WORDS.
#
# So the board asks the engine rather than keeping a second definition, which
# is the whole of what this seam is for. The import is inside a function and
# its failure is caught, so a board with no engine present still loads and
# falls back to the ordering it had.
PERMITTED = {
    "wringer.fleet",
    "wringer.outcome",
    "wringer.spec",
    "wringer.evidence",
    "wringer.accept",
    "wringer.checks",
    "wringer.config",
    "wringer.coverage",
    "wringer.diagnose",
    "wringer.staleness",
    "wringer",
}


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
    violation rather than refusing one. Three entries, each with a reason in
    the comment above them; a fourth needs a person to argue for it here.

    **Widened once, 2026-08-22, and the argument is this.** `wringer.checks`
    joined for the same reason `accept` is on the list: it DEFINES words the
    board must render verbatim. The changed-since-bound note is the engine's
    sentence, and the comparison behind it — "is this the check that went
    red?" — must have exactly one implementation. A board that answered that
    question for itself could disagree with `wring verify` about it, which is
    the two-surfaces-one-fact drift the seam exists to prevent. The import is
    guarded so the board still loads with no engine present, which is the
    property `test_the_board_imports_without_the_engine` holds.

    **Widened again, 2026-08-28, and the argument is this.** `wringer.config`
    joined for the reason `spec` is on the list: it holds DECLARATIONS a
    person wrote, and the board needs exactly one of them — the `show:`
    command for a criterion somebody is about to judge. The board runs it and
    prints the output verbatim; it interprets nothing and decides nothing.

    The finding behind it is that a person was asked to judge the wording of
    a summary that appeared in no surface Wringer had. The alternative to this
    import was a second YAML parser living inside the board, which is the
    two-implementations drift this seam exists to prevent, arriving through
    the door marked "avoiding an import". The import is inside the function
    and its failure is caught, so a board with no engine present still loads
    and simply has nothing to show — which it then says.
    """
    assert PERMITTED == {
        # Admitted 2026-09-04 (P1.10): the pen shows a person the thing they
        # are judging, and BEFORE/AFTER needs the same command run at the
        # commit the work started from. The worktree machinery is the
        # engine's — `wring audit --delivery` and the committed-range
        # falsification already use it — and a second copy inside the board
        # would be a second answer to "how do I read a tree at a commit
        # without touching the operator's checkout". Guarded like every other
        # admitted import: inside the function, failure caught, and a base
        # that cannot be read renders as absence rather than a claim.
        "wringer.fleet",
        # Admitted 2026-09-04, paying the debt 0.8.3 recorded in its own
        # release notes: the board shipped the six PM states two releases
        # before `certificate.md`, `summary.md` and `mr.md` got them from
        # `wringer.outcome`, so for two releases one vocabulary had two
        # spellings on four surfaces. The board asks the engine for the
        # WORDS and the ORDER; the per-segment truth values stay here,
        # because this page reads a `Board` and the engine reads a
        # repository. Guarded like every other admitted import: the import
        # is inside the function, its failure is caught, and a board with no
        # engine prints the labels it shipped with rather than a claim.
        "wringer.outcome",
        "wringer.spec",
        "wringer.accept",
        "wringer.checks",
        "wringer.config",
        "wringer.coverage",
        "wringer.diagnose",
        # Admitted 2026-08-30: "which run is the latest" is a DEFINITION, and
        # there were two of them — `st_mtime` here, the manifest's recorded
        # `started_at` in the engine — answering differently whenever two runs
        # overlap or a checkout rewrites mtimes. The board asks rather than
        # keeping a second one, which is what this seam is for.
        "wringer.evidence",
        # Admitted 2026-09-01, for SPEC_BOARD ruling 12 (0.6.2): the board
        # recomputes board-level staleness, and the ruling's own words are
        # why this is an import — "the filenames are never hand-copied
        # silently: the surface imports the tuple". The comparison
        # (`staleness.moved`), the capture, and `AUTHORITY_DOCUMENTS` are
        # the ENGINE's one implementation; a board that kept its own list
        # or its own hash walk could disagree with `wring deliver` about
        # whether the authorising documents moved — the exact
        # two-surfaces-one-fact drift this seam exists to prevent. Guarded
        # like every other admitted import: no engine, no claim, silence.
        "wringer.staleness",
        "wringer",
    }, (
        "the permitted-import set changed. That is allowed, but it is the "
        "seam widening and it should be argued for in the comment above, not "
        "slipped in beside a feature"
    )


def test_the_board_reads_a_USAGE_RECORD_only_through_the_ENGINES_reader():
    """**0.9.0's defect, made mechanical.**

    The board parsed `usage.json` itself and looked for `prompt_tokens` /
    `completion_tokens` / `total_tokens` at its top level. `wringer.usage.v1`
    carries none of them, so the worker lane could never match a real record —
    and the page said *"the builder reported nothing this run"* over records
    saying 44,863 tokens and 0.729392 USD. Two guards stood over that lane and
    both passed, because both wrote a `usage.json` shape no engine writes.

    A second reader of a frozen record is the seam dissolving in the exact way
    this file exists to prevent, and it is invisible to a test whose fixture
    was written by the same hand as the reader. So the FILENAME is the guard:
    the board may not name that record at all. It quotes
    `evidence.read_usage`, or it does not read it.
    """
    named = {}
    for path in sorted(BOARD.rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        # Comments explaining the history are not a second reader.
        code = "\n".join(
            line for line in text.splitlines() if not line.lstrip().startswith("#")
        )
        if "usage.json" in code:
            named[path.name] = "usage.json"
    assert not named, (
        f"the board names the usage record directly: {named}. "
        "`wringer.usage.v1` is frozen and has ONE reader — "
        "`evidence.read_usage`. A second parse of it is how the worker "
        "lane came to be structurally dead for a whole release."
    )
