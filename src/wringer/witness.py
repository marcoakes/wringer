"""The witness — Wringer's own manufactured evidence (SPEC_GATEGEN_V0 §6).

**Evidence is manufactured, not found.** The 2026-08-13 corpus run measured
this program's operating assumption and disproved it: on 13 real bug fixes the
repository's declared gates returned `gates_vacuous` 13 times out of 13, and
`wring deliver` said yes on 26 of 26 supervised rows including every wrong
change. The declared gates carried **zero information about the change** —
constant yes without `--prove`, constant no with it. A binding channel, a human
diff and a red run are worth nothing when there is nothing red to catch.

So a check is evidence about a change only if it was demonstrated able to fail
in that change's absence, with respect to the criterion it proves. Where the
repository has no such check, Wringer authors one.

**What a witness is, and is not** (W1). A witness is Wringer's check, not the
repository's: it is never proposed into `.wringer.yaml`, never installed by a
human, and never committed. It lives under `.wringer/` and Wringer owns, pins
and executes it. A gate in `.wringer.yaml` is the repository's claim; this is
Wringer's manufactured evidence, and collapsing the two vocabularies would
collapse two different trust stories.

**The three properties that make it worth anything:**

1. **Temporal independence.** Authoring happens at `wring spec --send
   --witness`, before any work exists. A check authored before the work cannot
   have been written to flatter the work.
2. **The pin.** The bytes, the command and the materialisation path are all
   digest-pinned before the first worker turn. At every execution the bytes
   about to run are hashed and compared. **A mismatch VOIDs the run** — not a
   failing gate, no run at all — because a check the worker could edit is a
   check that says nothing.
3. **Born red for the RIGHT REASON** (W8). A witness that fails because the
   runner could not LOAD it is discarded exactly as a born-green one is. A
   model that has never seen the source will write a check importing a
   plausible-sounding symbol; that check is red for `ModuleNotFoundError`, gets
   pinned, and turns green the moment the worker creates any file of that name
   with any content. `accept.py` records that this already happened once —
   *"four criteria came back `evidenced` on the strength of an import error."*

**What it does NOT license, and this ceiling binds every artifact**
(`WRINGER_RULING_2026-08-15` Q1): *a witness proves the stated criterion could
fail and was made to pass; it does not certify agreement with an unstated
intended fix, and where the criterion under-describes the intent, the witness
inherits that gap.* Nothing anywhere may claim the witness "catches wrong
fixes." A manufactured fail-to-pass check is necessary and demonstrably not
sufficient — UTBoost found 345 erroneous patches passing curated tests.

**The pin is tamper-EVIDENT, not tamper-proof** (W4). The worker runs on the
host unless a containment is declared, and `evidence.py` says in its own words
that the hash chain *"is tamper-evidence, not tamper-proofing — anyone who can
write the file can rewrite the whole chain."* It becomes a boundary only under
SPEC_CONTAIN_V0's containment.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from wringer import evidence as evidence_module

SCHEMA_VERSION = "wringer.witness.v1"

# Where the bytes of record live. Under `.wringer/`, which is gitignored, and
# that is derived rather than chosen (W4): the pre-change worktree carries
# TRACKED files only, so an untracked witness in the working tree would be
# absent there and would "fail" for file-not-found — a false `proven` wearing
# this amendment's badge. Committing it instead is refused by law 6. So the
# bytes live here and are MATERIALISED into whichever tree is executing.
WITNESS_DIRNAME = Path(".wringer") / "witness"

# Where a witness is materialised inside the tree under test. One fixed
# relative path, so the pin can cover it: pinning bytes alone would let a
# worker rewrite the command to `true` while the file stayed byte-identical.
MATERIAL_DIRNAME = ".wringer-witness"

WITNESS_FILENAME = "witness.json"

# The runner, and it is pytest because pytest reports the one distinction W8
# turns on **structurally**, from its own exit code, rather than by reading a
# failure message — which `vacuity.py:39-44` refuses by name.
#
# Measured on this machine 2026-08-15 rather than assumed:
#
#     an assertion that fails      -> 1
#     an import error              -> 2
#     a syntax error               -> 2
#     nothing collected            -> 5
#     everything passes            -> 0
#
# So "the runner ran it and it failed" and "the runner never ran this" are
# different exit codes, which is a fact the runner reports rather than a guess
# about whether a message *looks* environmental.
RUNNER = (sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider")

# The same runner as seen from INSIDE a container. `sys.executable` is a host
# path and is absent from the image, so it is resolved on `PATH` there instead.
# The image must therefore carry python and pytest; a repository that declares
# a containment and no pytest gets a witness that cannot run, and gets told so
# by `WITNESS_UNRUNNABLE` rather than having its criteria quietly reported
# uncovered.
CONTAINED_RUNNER = ("python3", "-m", "pytest", "-q", "-p", "no:cacheprovider")

# Exit 127 is the shell saying the command does not exist. Under a containment
# that means the image carries no python or no pytest, which is a CONFIGURATION
# fault and not a witness defect — and reporting it as "the runner could not
# collect it" is how the lane silently produced nothing while claiming to run
# inside the boundary.
EXIT_NO_COMMAND = 127

EXIT_FAILED = 1
EXIT_INTERRUPTED = 2
EXIT_NO_TESTS = 5

# **The witness must leave the tree exactly as it found it**, and without this
# it does not. Running pytest in the repository root writes `__pycache__` beside
# every module it imports, which makes the working tree dirty — and `wring
# deliver` then refuses with *"the working tree has moved since … verified it"*,
# naming a `.pyc` file. Measured, not anticipated: it appeared the first time
# the lane reached a real delivery.
#
# That failure would have been invisible and expensive in the corpus re-test —
# every row blocked at delivery for a reason that has nothing to do with the
# row. `-p no:cacheprovider` already suppresses pytest's own cache; this
# suppresses the interpreter's.
RUNNER_ENV = {"PYTHONDONTWRITEBYTECODE": "1"}

# `proved_red.outcome` — W8's structural discriminator.
ASSERTION = "assertion"
COLLECTION_ERROR = "collection_error"
GREEN = "green"

# `proved_red.verdict`.
PROVEN = "proven"
NOT_ESTABLISHED = "not_established"

# How long one witness execution may take. A witness is one small file; a
# witness that hangs is a witness defect, and a supervisor that waits forever
# on it is the failure mode this repository exists to not have.
TIMEOUT_SECONDS = 300


class WitnessError(Exception):
    """The witness lane cannot proceed honestly (CLI exit code 3, VOID).

    Deliberately not `EXIT_GATE_FAILED`: a pin mismatch is not evidence ABOUT
    the change, it is the absence of a run. And not `EXIT_CONFIG`, which would
    blame a configuration that is fine.
    """


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass(frozen=True)
class Authored:
    """One witness as the author produced it, before anything trusts it."""

    criterion: str
    source: str
    model: str
    base_sha: str
    tree_dirty: bool
    criterion_sha256: str
    prompt_sha256: str
    isolation: dict[str, Any]

    @property
    def sha256(self) -> str:
        return digest(self.source.encode("utf-8"))

    def as_json(self) -> dict[str, Any]:
        return {
            "id": f"w-{self.criterion}",
            "proves": self.criterion,
            "authored": {
                "by": {"model": self.model},
                "base_sha": self.base_sha,
                "tree_dirty": self.tree_dirty,
                "criterion_sha256": self.criterion_sha256,
                # Digests, never the text: the prompt carries the PRD, and a
                # bundle handed to a stranger must not become the channel that
                # publishes it.
                "prompt_sha256": self.prompt_sha256,
                "isolation": self.isolation,
                "sha256": self.sha256,
            },
        }


@dataclass(frozen=True)
class Execution:
    """One run of a witness against one tree."""

    exit_code: int
    outcome: str
    first_line: str
    log: str

    @property
    def passed(self) -> bool:
        return self.exit_code == 0


@dataclass
class Witness:
    """A witness through its whole life: authored, pinned, proved, executed."""

    criterion: str
    source: str
    record: dict[str, Any] = field(default_factory=dict)
    proved_red: Execution | None = None
    executed: Execution | None = None
    discarded: str | None = None

    @property
    def sha256(self) -> str:
        return digest(self.source.encode("utf-8"))

    @property
    def filename(self) -> str:
        return f"test_witness_{self.criterion.replace('-', '_')}.py"

    @property
    def command(self) -> str:
        return " ".join((*RUNNER, f"{MATERIAL_DIRNAME}/{self.filename}"))

    @property
    def usable(self) -> bool:
        """Whether this witness may evidence anything.

        A witness is usable only when it was proved RED for the right reason.
        Everything else — born green, a collection error, an author that
        failed — leaves the criterion UNCOVERED, which routes to a human. That
        is the honest outcome and it is deliberately not a failure.
        """
        return self.discarded is None and self.proved_red is not None and (
            self.proved_red.outcome == ASSERTION
        )


# --- authoring (W2) ---------------------------------------------------------

# The instruction the author is given. **W10 is in here and it is the whole
# reason this text is a constant rather than an f-string built at the call
# site**: a witness may not pick WHERE a fix lives. When a criterion states a
# symptom without a location, the witness must observe that symptom at the
# interface the criterion names and must not pin an implementation locus the
# criterion does not state.
#
# Measured, not theorised: issue #2703 describes a symptom at the SHELL — a
# completion value containing a colon is mangled — and never says where the
# escaping belongs. Upstream escaped in `format_completion`; a salvaged agent
# change escaped in the generated zsh script. The authored witness happened to
# test `format_completion`, stayed red on the agent's change, and was scored as
# the calibration's single catch. That is a coin landing the right way up, not
# prevention, and under W10 the honest score for that stop condition is 0.
#
# A witness that pins a locus the criterion does not state has silently added a
# requirement the PM never wrote and then evidences THAT. It manufactures false
# refusals against every correct fix that lands somewhere else, and its
# occasional catch cannot be distinguished from luck by anyone reading the
# bundle.
AUTHOR_INSTRUCTION = """\
You are writing ONE pytest file that will be used as a reproduction witness \
for a single acceptance criterion.

The rules, in order of importance:

1. The test must FAIL on the current code and PASS once the criterion is \
satisfied. It is evidence that the criterion could fail; a test that passes \
today proves nothing and will be discarded.
2. The test must FAIL BY ASSERTION, not by failing to find what it imports. A \
test whose failure is ImportError, ModuleNotFoundError or NameError is \
DISCARDED, wherever it happens — at import time or inside the test body — \
because such a test turns green the moment any file or symbol of that name \
exists, with any content, and would evidence nothing. Assert on BEHAVIOUR that \
already has somewhere to live. If the criterion is about code that does not \
exist at all yet, say so by writing the smallest test you can that still fails \
on an assertion about observable behaviour rather than on a missing name.
3. Observe the criterion's symptom at the INTERFACE THE CRITERION NAMES. If \
the criterion describes behaviour at a command line, a shell completion, an \
HTTP response or a public function, exercise THAT. **Do not choose where the \
fix should live.** If the criterion does not say which module or function is \
responsible, your test must not decide it either — a test pinned to a location \
the criterion never stated silently adds a requirement nobody wrote, and it \
will refuse correct fixes that land elsewhere.
4. Test only what the criterion states. Not adjacent behaviour, not what you \
would also want, not style.
5. One file, standard library plus pytest only, no network, no fixtures from \
files you cannot see. It must run from the repository root.

Return ONLY the Python source of the file. No prose, no explanation, no \
markdown fences.
"""


def render_request(
    criterion_title: str,
    criterion_id: str,
    model: str,
    max_output_tokens: int,
    tree_summary: str,
) -> dict[str, Any]:
    """The authoring call — one criterion, one witness.

    The author is given the criterion and a summary of the pre-change tree, and
    **never** upstream's fix, the held-out tests, or the worker's session
    (W2's isolation clause). Under a containment it additionally runs behind
    `establish(party="author")`, isolated identically to the worker.
    """
    return {
        "model": model,
        "max_tokens": max_output_tokens,
        "messages": [
            {
                "role": "user",
                "content": (
                    f"{AUTHOR_INSTRUCTION}\n"
                    f"The criterion (id `{criterion_id}`):\n\n"
                    f"{criterion_title}\n\n"
                    f"The repository, as it stands before any work:\n\n"
                    f"{tree_summary}\n"
                ),
            }
        ],
    }


def parse_response(body: Any) -> str:
    """The witness source out of a reply, or raise.

    Fences are stripped because models add them despite being told not to, and
    refusing a witness over a decoration would spend a real authoring call to
    punish formatting.
    """
    text = None
    if isinstance(body, dict):
        choices = body.get("choices")
        if isinstance(choices, list) and choices:
            message = choices[0].get("message") or {}
            text = message.get("content")
        if text is None:
            content = body.get("content")
            if isinstance(content, list) and content:
                text = content[0].get("text")
    if not isinstance(text, str) or not text.strip():
        raise WitnessError("the author returned no witness source")

    source = text.strip()
    if source.startswith("```"):
        lines = source.splitlines()
        lines = lines[1:]
        while lines and lines[-1].strip().startswith("```"):
            lines.pop()
        source = "\n".join(lines).strip()
    if not source:
        raise WitnessError("the author returned only a code fence")
    return source + "\n"


# --- packaging, pinning and execution (W4) ----------------------------------


def store(root: Path, witness: Witness) -> Path:
    """Write the bytes of record under `.wringer/witness/`."""
    directory = root / WITNESS_DIRNAME
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / witness.filename
    path.write_text(witness.source, encoding="utf-8")
    return path


def load(root: Path) -> list[Witness]:
    """Every stored witness, by criterion.

    Absence is absence: a repository with no witness lane returns an empty
    list and every downstream behaviour is byte for byte what it was.
    """
    directory = root / WITNESS_DIRNAME
    record_path = directory / WITNESS_FILENAME
    if not record_path.is_file():
        return []
    try:
        recorded = json.loads(record_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise WitnessError(
            f"the witness record at {WITNESS_DIRNAME}/{WITNESS_FILENAME} "
            f"could not be read ({exc}), so no witness can be trusted. This "
            "VOIDs the run rather than proceeding without one"
        ) from exc

    found = []
    for row in recorded.get("witnesses", []):
        criterion = row.get("proves")
        source_path = directory / row.get("path", "")
        if not source_path.is_file():
            raise WitnessError(
                f"the witness for `{criterion}` is recorded but its bytes are "
                f"missing at {row.get('path')}. A witness that cannot be read "
                "cannot be checked against its digest, so this VOIDs the run"
            )
        source = source_path.read_text(encoding="utf-8")
        # **The authored digest, re-checked.** `wring spec` has no hash-chained
        # ledger, so the window between authoring and pinning is unprotected
        # and is declared as a limit. This is what closes it as far as it can
        # be closed: the bytes must still be the bytes the author recorded.
        expected = (row.get("authored") or {}).get("sha256")
        actual = digest(source.encode("utf-8"))
        if expected and expected != actual:
            raise WitnessError(
                f"the witness for `{criterion}` does not match the digest its "
                f"author recorded ({actual[:12]} != {expected[:12]}). Someone "
                "edited it between authoring and pinning. This VOIDs the run — "
                "it is not a failing gate, it is no run at all"
            )
        found.append(Witness(criterion=criterion, source=source, record=row))
    return found


# A conftest materialised beside the witness, whose only job is to write down
# the EXCEPTION CLASS of a failing test, taken off the runner's own report
# object.
#
# **This closes a hole the first draft of the authoring instruction opened.**
# W8 discards a witness whose pre-change failure is the runner failing to LOAD
# it, and derives that from pytest's exit code: a module-level import error is
# exit 2, an assertion failure is exit 1. But an import that happens INSIDE the
# test body collects fine and fails at exit 1 — indistinguishable from an
# assertion by exit code alone, and carrying exactly the defect W8 exists to
# refuse: it turns green the moment any file of that name exists with any
# content. The first draft's instruction actually told the author to move
# imports into the body, which converted every discarded witness into an
# accepted one.
#
# The class name is a fact the runner reports about its own run, in the same
# sense the exit code is. It is NOT reading the failure message and guessing
# whether it looks environmental — the auto-classification `vacuity.py:39-44`
# refuses by name. Wringer's own bytes, not the author's, so the pin is
# unaffected.
PROBE_FILENAME = "conftest.py"
OUTCOME_FILENAME = "outcome.txt"

PROBE_SOURCE = '''\
"""Written by Wringer. Records the exception CLASS of a failing witness.

Not the message — the class, off the report object, which is a fact the runner
states about its own run.
"""
import pathlib

import pytest


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if call.excinfo is not None and report.when in ("setup", "call"):
        path = pathlib.Path(__file__).parent / "OUTCOME_FILENAME"
        with path.open("a", encoding="utf-8") as handle:
            handle.write(call.excinfo.type.__name__ + "\\n")
'''.replace("OUTCOME_FILENAME", OUTCOME_FILENAME)

# The exception classes that mean "the check could not find the thing it was
# written against" rather than "the thing behaved wrongly".
#
# **`FileNotFoundError` was missing and the independent review measured the
# consequence.** W10 directs the author to exercise the INTERFACE the criterion
# names — a CLI, a shell completion, an HTTP endpoint — and on a pre-change
# tree a witness that shells out to a tool which does not exist yet raises
# exactly this. That failure has W8's defining property verbatim: it turns
# green the moment any binary or file of that name exists, with any content.
# So the rule W10 mandates was steering authors straight into the hole W8
# exists to close, and three class names were not enough to catch it.
#
# `AttributeError` is still deliberately absent: a missing attribute is
# frequently a real behavioural failure, and a guard that claims more than it
# can tell is the defect this lane exists to refuse. The asymmetry is
# deliberate — discarding a witness costs a criterion its coverage and sends it
# to a human, which is the safe direction; accepting a bad one manufactures
# evidence, which is not.
LOAD_FAILURES = frozenset(
    {
        "ImportError",
        "ModuleNotFoundError",
        "NameError",
        "FileNotFoundError",
        "NotADirectoryError",
    }
)


def materialise(tree: Path, witness: Witness) -> Path:
    """Put the witness where the runner will find it, or raise.

    **Ruled rather than left to the implementation** (W4). Left unspecified, a
    symlink planted at this path makes the write land somewhere else and the
    cleanup delete something else.
    """
    directory = tree / MATERIAL_DIRNAME
    path = directory / witness.filename
    if directory.is_symlink() or path.is_symlink():
        raise WitnessError(
            f"a symlink is planted at the witness materialisation path "
            f"({MATERIAL_DIRNAME}). Wringer will not follow it: the write "
            "would land somewhere nobody named. This VOIDs the run"
        )
    if path.exists():
        raise WitnessError(
            f"something already exists at {MATERIAL_DIRNAME}/"
            f"{witness.filename}. Wringer will not overwrite it, because the "
            "bytes it then executed would not be the bytes it pinned"
        )
    try:
        directory.mkdir(parents=True, exist_ok=True)
        path.write_text(witness.source, encoding="utf-8")
        (directory / PROBE_FILENAME).write_text(PROBE_SOURCE, encoding="utf-8")
    except OSError as exc:
        raise WitnessError(
            f"the witness for `{witness.criterion}` could not be written to "
            f"{MATERIAL_DIRNAME} ({exc}), so it cannot be executed. This VOIDs "
            "the run rather than reporting a result nothing produced"
        ) from exc
    return path


def clean(tree: Path) -> None:
    """Remove a materialised witness. Total by construction.

    This runs on the way out of an execution that may already have failed, and
    an exception here would replace the real outcome with a cleanup error —
    the discipline `backend.Container.cleanup` sets.

    **`rmtree`, and the first draft's per-entry `unlink` was a real bug found
    by driving this rather than by reading it.** The runner writes a
    `__pycache__` directory beside the witness; `unlink` on a directory raises
    `IsADirectoryError`, which the tolerant `except OSError` then swallowed —
    so the whole directory survived, and the NEXT run refused to overwrite it.
    A cleanup that fails silently and a materialisation that refuses to
    overwrite combine into a lane that works exactly once.
    """
    shutil.rmtree(tree / MATERIAL_DIRNAME, ignore_errors=True)


def execute(
    tree: Path,
    witness: Witness,
    env: dict[str, str] | None = None,
    containment_settings: Any = None,
    established: Any = None,
) -> Execution:
    """Run one witness against one tree and classify the outcome STRUCTURALLY.

    The classification comes from the runner's own exit code, never from
    reading the failure text. `vacuity.py:39-44` refuses auto-classification by
    name — *"a verdict that shows its working is the product"* — and this is
    the line the document already drew: establish it from structure, not by
    guessing whether a message looks environmental. Distinguishing "the runner
    never ran this" from "the runner ran it and it failed" is a fact the runner
    reports.

    **A witness is model-authored Python, and executing it is code execution
    this lane introduces.** Where a containment is declared it runs INSIDE that
    boundary, on the same mechanism and the same holder as the worker. Saying
    so here rather than in a limit: a lane that manufactures a check and then
    runs it unbounded on the developer's machine would have added a risk while
    closing one, and the boundary already exists.
    """
    path = materialise(tree, witness)
    relative = str(path.relative_to(tree))
    try:
        argv: list[str] = [*RUNNER, relative]
        cwd = tree
        if containment_settings is not None and established is not None:
            from wringer import containment as containment_module

            # **`sys.executable` is a HOST path and it does not exist inside
            # the image.** The first draft passed `RUNNER` straight through, so
            # the container ran `/host/path/to/python -m pytest …`, the shell
            # exited 127, and `classify` read that as `collection_error` — so
            # under a declared containment EVERY witness was silently
            # discarded and every criterion reported uncovered, while the
            # module docstring claimed the lane ran inside the boundary. The
            # review measured it. That is the configuration the re-test needs,
            # which made it the worst place for the lane to be inert.
            argv = containment_module.argv(
                containment_settings,
                established,
                " ".join([*CONTAINED_RUNNER, relative]),
                tree,
                tree / MATERIAL_DIRNAME,
            )
        try:
            done = subprocess.run(
                argv,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=TIMEOUT_SECONDS,
                env={**os.environ, **RUNNER_ENV, **(env or {})},
            )
        except subprocess.TimeoutExpired:
            return Execution(
                exit_code=124,
                outcome=COLLECTION_ERROR,
                first_line="the witness did not finish",
                log="",
            )
        except OSError as exc:
            return Execution(
                exit_code=127,
                outcome=COLLECTION_ERROR,
                first_line=f"the witness runner could not start: {exc}",
                log="",
            )
        log = (done.stdout or "") + (done.stderr or "")
        if (
            containment_settings is not None
            and done.returncode == EXIT_NO_COMMAND
        ):
            # Loud, not silent. A witness "discarded" because the image has no
            # pytest is a criterion reported uncovered for a reason that has
            # nothing to do with the criterion, and the reader would never
            # learn which.
            raise WitnessError(
                f"the witness for `{witness.criterion}` could not run inside "
                f"the containment: `{CONTAINED_RUNNER[0]}` or pytest is not in "
                f"the image {containment_settings.image!r}. Add them to the "
                "image, or drop 'run.containment' — Wringer will not report a "
                "criterion uncovered for a reason that is not about the "
                "criterion"
            )
        raised = _raised(tree)
        return Execution(
            exit_code=done.returncode,
            outcome=classify(done.returncode, raised),
            first_line=_first_meaningful_line(log),
            log=log,
        )
    finally:
        clean(tree)


def _raised(tree: Path) -> frozenset[str]:
    """The exception classes the runner reported, as it reported them."""
    path = tree / MATERIAL_DIRNAME / OUTCOME_FILENAME
    try:
        return frozenset(path.read_text(encoding="utf-8").split())
    except OSError:
        return frozenset()


def classify(exit_code: int, raised: frozenset[str] = frozenset()) -> str:
    """W8's structural discriminator, in both of its halves.

    `assertion` ONLY when the runner collected the check, ran it, and it failed
    on something other than not finding what it was written against.

    The exit code answers the first half: 2 is a module-level import or syntax
    error, 5 is nothing collected, 1 is a test that ran and failed. The
    exception class answers the second: a test that imports inside its own body
    collects fine and fails at exit 1, which the exit code alone cannot tell
    from a real assertion — and that failure has exactly the property W8
    refuses, turning green the moment any file of that name exists with any
    content.

    Everything unrecognised is `collection_error` and is **not a proved red**:
    an outcome nobody anticipated claims less rather than more.
    """
    if exit_code == 0:
        return GREEN
    if exit_code == EXIT_FAILED:
        return COLLECTION_ERROR if (raised & LOAD_FAILURES) else ASSERTION
    return COLLECTION_ERROR


def _first_meaningful_line(log: str) -> str:
    for line in log.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("="):
            return stripped[:200]
    return ""


def prove_red(
    tree: Path,
    witness: Witness,
    containment_settings: Any = None,
    established: Any = None,
) -> Execution:
    """Establish the born red on a PRE-CHANGE tree, and record why it failed.

    Born red is established on a HEAD worktree rather than on the working tree
    (W8). The first draft of the spec said the working tree *is* the pre-change
    tree because the worker has not run, and then said the HEAD worktree at
    proving time is the same tree — which agree only when the tree is clean,
    and nothing enforces that. Using the same mechanism makes the identity true
    by construction.
    """
    result = execute(
        tree, witness,
        containment_settings=containment_settings, established=established,
    )
    witness.proved_red = result
    if result.outcome == GREEN:
        witness.discarded = (
            "born green on the pre-change tree, so it demonstrates nothing "
            "about the change"
        )
    elif result.outcome == COLLECTION_ERROR:
        # **The hole this closes.** A model that has never seen the source
        # writes a check importing a plausible-sounding symbol; it is red for
        # ModuleNotFoundError, gets pinned, and turns green the moment the
        # worker creates any file of that name with any content.
        witness.discarded = (
            f"the runner could not collect it (exit {result.exit_code}), so "
            "its red says nothing about the criterion — a witness red for a "
            "load failure turns green the moment any file of that name exists"
        )
    return result


def pin(witness: Witness, run_id: str) -> dict[str, Any]:
    """The pin, over all three things a forgery would move.

    **Bytes, command AND materialisation path.** Pinning bytes alone would let
    a worker rewrite the command to `true` while the file stayed byte-identical
    — the forgery this ruling rejects, one field over.
    """
    return {
        "sha256": witness.sha256,
        "run": run_id,
        "path": f"{MATERIAL_DIRNAME}/{witness.filename}",
        "command": witness.command,
    }


def on_disk_sha256(root: Path, witness: Witness) -> str | None:
    """Hash the bytes that are actually on disk right now, or None.

    **This function exists because the first draft's pin was a tautology, and
    the independent review measured it.** `pin()` built its digest from the
    in-memory `Witness`, and `check_pin()` compared that same object's digest
    back against it — the same field of the same object, so the comparison
    could not fail. The source was read from disk exactly once, before the
    first worker turn, and every later "re-check" re-checked a value against
    itself. A worker that rewrote `.wringer/witness/*.py` mid-loop passed:

        pinned sha:      9065b312e262
        on-disk sha now: e0d5bd480a37
        check_pin: PASSED

    The whole claim of W4 is that the bytes which ran are the bytes that were
    pinned. That is a claim about a FILE, so it has to be answered by reading
    the file.
    """
    path = root / WITNESS_DIRNAME / witness.filename
    try:
        return digest(path.read_bytes())
    except OSError:
        return None


def check_pin(
    witness: Witness, pinned: dict[str, Any], root: Path | None = None
) -> None:
    """Compare what is about to run against what was pinned, or VOID.

    Called before EVERY execution, including on `wring resume` — a resumed loop
    that neither pins nor re-verifies would execute an unpinned witness (W7.7).

    `root` is what makes this a real comparison rather than a tautology: with
    it, the bytes on disk are re-hashed and compared to the pin. Without it
    only the in-memory object is checked, which is the degenerate case and is
    why the parameter has no default at the call sites that matter.
    """
    if root is not None:
        actual = on_disk_sha256(root, witness)
        if actual is None:
            raise WitnessError(
                f"the witness for `{witness.criterion}` is no longer readable "
                "on disk, so the bytes about to run cannot be compared to the "
                "pin. This VOIDs the run"
            )
        if actual != pinned.get("sha256"):
            raise WitnessError(
                f"the witness for `{witness.criterion}` on disk is not the one "
                f"that was pinned ({actual[:12]} != "
                f"{str(pinned.get('sha256'))[:12]}). Something rewrote it after "
                "it was pinned. This VOIDs the run: it is not a failing gate, "
                "it is no run at all, because a check the worker could edit is "
                "a check that says nothing"
            )
    if witness.sha256 != pinned.get("sha256"):
        raise WitnessError(
            f"the witness for `{witness.criterion}` is not the one that was "
            f"pinned ({witness.sha256[:12]} != "
            f"{str(pinned.get('sha256'))[:12]}). This VOIDs the run: it is not "
            "a failing gate, it is no run at all, because a check the worker "
            "could edit is a check that says nothing"
        )
    if witness.command != pinned.get("command"):
        raise WitnessError(
            f"the witness for `{witness.criterion}` would run a different "
            "command than the one pinned. Pinning the bytes alone would let a "
            "command become `true` while the file stayed byte-identical. This "
            "VOIDs the run"
        )
    if f"{MATERIAL_DIRNAME}/{witness.filename}" != pinned.get("path"):
        raise WitnessError(
            f"the witness for `{witness.criterion}` would be materialised "
            "somewhere other than the pinned path. This VOIDs the run"
        )


def record(
    root: Path,
    witnesses: list[Witness],
    model: str,
    base_sha: str,
    tree_dirty: bool,
    isolation: dict[str, Any],
    prompt_digests: dict[str, str],
) -> Path:
    """Write `.wringer/witness/witness.json` — `wringer.witness.v1`."""
    directory = root / WITNESS_DIRNAME
    directory.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": SCHEMA_VERSION,
        "witnesses": [
            {
                "id": f"w-{w.criterion}",
                "proves": w.criterion,
                "path": w.filename,
                "authored": {
                    "by": {"model": model},
                    "base_sha": base_sha,
                    "tree_dirty": tree_dirty,
                    "criterion_sha256": prompt_digests.get(
                        f"criterion:{w.criterion}", ""
                    ),
                    "prompt_sha256": prompt_digests.get(
                        f"prompt:{w.criterion}", ""
                    ),
                    "isolation": isolation,
                    "sha256": w.sha256,
                },
            }
            for w in witnesses
        ],
        "limits": list(LIMITS),
    }
    path = directory / WITNESS_FILENAME
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def brief_section(witnesses: list[Witness]) -> list[str]:
    """What the worker is told — the failure OUTPUT, never the source (W5).

    Name-only, on the precedent human criteria set: they appear in the brief by
    id ALONE, with guidance withheld, and `tests/test_run.py:591` asserts the
    title-bearing line is absent.

    **The honest limit: this is a rule about what Wringer hands over, not a
    sandbox.** A worker with a shell can read `.wringer/`, and disclosure is
    not benign here — the witness is the only check carrying information about
    the change, so a worker that reads it can special-case exactly it and
    produce red-to-green on a change that is still wrong. That is the corpus's
    headline finding relocated from `.git` to `.wringer/`, and it becomes a
    boundary only under containment.
    """
    usable = [w for w in witnesses if w.usable]
    if not usable:
        return []
    lines = [
        "",
        "## What is not yet demonstrated",
        "",
        "Wringer holds a check for each criterion below. Each one fails "
        "today. Make it pass by satisfying the criterion — the check itself "
        "is not yours to edit, and it is not in this tree.",
        "",
    ]
    for witness in usable:
        first = witness.proved_red.first_line if witness.proved_red else ""
        lines.append(f"- `{witness.criterion}` — {first}")
    return lines


# What this artifact does NOT claim, travelling with it rather than living in a
# spec nobody opened — the pattern `health.LIMITS` and `accept.LIMITS` set.
LIMITS = (
    "A witness proves the stated criterion could fail and was made to pass. "
    "It does not certify agreement with an unstated intended fix, and where "
    "the criterion under-describes the intent the witness inherits that gap. "
    "Nothing here catches a change that satisfies the criterion and is still "
    "wrong.",
    "A manufactured fail-to-pass check is necessary and demonstrably not "
    "sufficient. UTBoost found 345 erroneous patches passing curated tests; "
    "PVBench found over 40% of patches failing the developer's own PoC tests. "
    "The witness raises the floor and does not make a delivery safe.",
    "A witness evidences ONE criterion and says nothing about the rest of the "
    "change.",
    "The author is a model, and a model can write a check that fails for the "
    "wrong reason. The loudest case — red because the runner could not load "
    "it — is refused structurally. A witness that collects, fails, and tests "
    "something adjacent to the criterion is not.",
    "The pin is tamper-EVIDENT, not tamper-proof. A worker on the host can "
    "read .wringer/ and rewrite a hash chain from genesis; the pin becomes a "
    "boundary only under run.containment.",
)
