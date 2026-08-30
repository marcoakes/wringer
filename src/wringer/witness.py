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
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "wringer.witness.v1"

# **Where the bytes of record live — OUTSIDE every repository root** (P4-3,
# ruled 2026-08-15). This moved, and it moved because of something measured
# rather than something imagined.
#
# The bytes used to live at `<root>/.wringer/witness/`. W4 put them there by a
# correct piece of reasoning — the pre-change worktree carries TRACKED files
# only, so an untracked witness in the working tree would be absent there and
# would "fail" for file-not-found, a false `proven` wearing the amendment's
# badge — and committing them instead is refused by law 6. But `.wringer/` is
# inside the repository, and the repository is the thing an agent is pointed at.
#
# On the FIRST real corpus task an agent opened `.wringer/witness/…py` and
# rewrote it: it replaced `pytest.warns(None)`, removed in pytest 8, with a
# `catch_warnings` block. A helpful, competent edit by an agent tidying a file
# it found in its own tree. The pin caught it and the run VOIDed by name, which
# is W4 working perfectly — and unusable, because §5's void rule invalidates a
# whole pass at three such rows and an agent that tidies what it can see will
# do it on most tasks.
#
# The first repair shadowed the path with an anonymous volume inside the
# worker's container. That closed it for a CONTAINED worker and left it wide
# open for an uncontained one on the host — including arm B's primary turn,
# which is the turn that does the work. A store outside every repository root
# satisfies W4's original reasoning BETTER than `.wringer/` did and closes both
# cases at once, so the mount is gone and this is the whole of the fix.
#
# **The honest residual, stated here rather than discovered later** (it is the
# sentence the removed mount's comment used to carry): an UNCONTAINED worker on
# the host can still reach this store if it goes looking for it — the path is
# derivable, and nothing about a filesystem path is a boundary. What this buys
# is that the store is not in the tree the agent was handed, so no agent reaches
# it by tidying up. The pin remains tamper-EVIDENCE; containment remains the
# boundary. Packaging is explicitly free under the 2026-08-14 ruling §6, which
# is the licence this layout is chosen under.
STORE_ENV = "WRINGER_WITNESS_STORE"

# A criterion id that may safely be interpolated into a filename. Anything with
# a separator, or a bare `.`/`..`, is refused rather than rewritten.
_SAFE_ID = re.compile(r"(?!\.+$)[A-Za-z0-9._-]+")


def store_dir(root: Path) -> Path:
    """Where this repository's witness bytes live, outside this repository.

    Deterministic in the repository's resolved path, so the same repository
    always resolves to the same store and two checkouts of the same project
    never share one. The directory NAME carries the repository's basename for a
    human reading `ls`, and a digest of the full path for uniqueness — two
    repositories called `wringer` in different directories are different stores.

    `WRINGER_WITNESS_STORE` overrides the base, which is what the suite uses so
    that no test writes into a developer's real state directory.

    **"Outside" is ENFORCED here, not assumed** — the independent review found
    it was neither. `HOME`, `XDG_STATE_HOME` or the override pointing at the
    repository root all resolved the store back INSIDE the tree, and
    `HOME=<repo>` is an ordinary container and CI shape rather than an exotic
    one. Inside the tree the bytes are back where an agent tidies them, back
    inside the container mount the shadow no longer covers, and untracked —
    so `loop.fingerprint` hashes them and `git status` shows them.
    P4-3 removed the mount *on the strength of* this property, so the property
    has to hold rather than be hoped for, and a refusal is the only honest
    answer: silently relocating would put the bytes somewhere the operator did
    not choose, and carrying on would ship the failure the move was made to fix.
    """
    override = os.environ.get(STORE_ENV)
    if override:
        base = Path(override)
    else:
        base = Path(
            os.environ.get("XDG_STATE_HOME") or Path.home() / ".local" / "state"
        ) / "wringer" / "witness"
    resolved = root.resolve()
    key = f"{resolved.name or 'repo'}-{digest(str(resolved).encode('utf-8'))[:16]}"
    store = base / key
    inside = store.resolve() if store.exists() else _resolve_unborn(store)
    if inside == resolved or resolved in inside.parents:
        raise WitnessError(
            f"the witness store would be {inside}, which is INSIDE the "
            f"repository at {resolved}. The bytes of record must live outside "
            "every repository root: inside one they are in the tree an agent "
            "was handed, they are reachable through the worker's mount, and "
            "they make the working tree dirty. Set "
            f"{STORE_ENV} to a directory outside this repository — or unset "
            "the HOME/XDG_STATE_HOME that put it here"
        )
    return store


def _resolve_unborn(path: Path) -> Path:
    """`Path.resolve()` for a path that does not exist yet, symlinks and all.

    `resolve()` on a missing path is already non-strict, but its PARENTS may be
    symlinks that exist — a `~` pointing into the repository is the case that
    matters — and only resolving what exists answers that.
    """
    existing = path
    while not existing.exists() and existing != existing.parent:
        existing = existing.parent
    return existing.resolve() / path.relative_to(existing) if existing != path else (
        existing.resolve()
    )


# Where a witness is materialised inside the tree under test. One fixed
# relative path, so the pin can cover it: pinning bytes alone would let a
# worker rewrite the command to `true` while the file stayed byte-identical.
#
# **Moved under `.wringer/` by P4-3**, from a top-level `.wringer-witness/`.
# `.wringer/` is already gitignored and its stem is already outside anything
# `created_stems` reads, so a SIGKILL between `materialise` and `clean` now
# leaves nothing that `git status` shows and nothing `wring deliver` can trip
# over — which closes §6d item 8 as a consequence of this move rather than as a
# separate patch. The window itself is unchanged and is narrow by construction:
# a witness is materialised, run, and removed inside one `try/finally`, between
# worker turns and never during one.
MATERIAL_DIRNAME = ".wringer/witness"

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
#
# **`--color=no`, and it is load-bearing rather than tidy.** The independent
# review measured the consequence of its absence: `execute` hands the child
# `{**os.environ, ...}`, so a `FORCE_COLOR=1` or `PY_COLORS=1` in the
# environment — which many CI images set by default — makes pytest wrap its
# progress line in ANSI, and an ANSI-prefixed line matches neither the
# progress-line pattern nor the error-line pattern below. The citation then
# falls back to the coloured progress bar, which is §6d item 1 reopened by one
# environment variable: `\x1b[31mF\x1b[0m…[100%]`, measured. The flag is the fix
# at the source; `_STRIP_ANSI` below is the belt to its braces, because the
# environment is not the only way colour can arrive.
RUNNER = (
    sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "--color=no"
)

# **Which interpreter the witness runs under, when it is not Wringer's own.**
#
# `execute`'s docstring says the witness runs WHERE THE GATES RUN, and that is
# right — a check needs the project's dependencies. On an ordinary repository
# `sys.executable` IS where the gates run, because you install Wringer beside
# the project it verifies, so nothing here changes for anybody.
#
# It is not true of the corpus, and the P4-7 gate measured that too. Each corpus
# repository's gate is `PYTHONPATH=src <its own venv>/bin/python -m pytest …`,
# and Wringer runs from Wringer's venv. So the witness could not import
# `marshmallow` at all: exit 2, `collection_error`, DISCARDED — every criterion
# uncovered for a reason that has nothing to do with the criterion, which is
# the same defect the review's fourth HIGH closed one layer down.
#
# **Named rather than derived.** The gate is a shell string; picking an
# interpreter out of it means parsing a command line, which is exactly the
# classification `vacuity.py:39-44` refuses by name. So the operator states it,
# the way `run.prove_setup` is stated, and Wringer does not guess. Absent — the
# ordinary case — this is `sys.executable` and nothing has moved.
RUNNER_PYTHON_ENV = "WRINGER_WITNESS_PYTHON"


def runner(contained: bool = False) -> tuple[str, ...]:
    """The runner argv, host or contained.

    A function rather than a constant because `RUNNER_PYTHON_ENV` is read at
    call time: the pin covers the COMMAND as well as the bytes, so an
    interpreter that changed between pinning and execution VOIDs the run — and
    that is the correct outcome, not something to paper over by caching.
    """
    if contained:
        return CONTAINED_RUNNER
    interpreter = os.environ.get(RUNNER_PYTHON_ENV) or sys.executable
    return (interpreter, *RUNNER[1:])

# The same runner as seen from INSIDE a container. `sys.executable` is a host
# path and is absent from the image, so it is resolved on `PATH` there instead.
# The image must therefore carry python and pytest; a repository that declares
# a containment and no pytest gets a witness that cannot run, and gets told so
# by `WITNESS_UNRUNNABLE` rather than having its criteria quietly reported
# uncovered.
CONTAINED_RUNNER = (
    "python3", "-m", "pytest", "-q", "-p", "no:cacheprovider", "--color=no"
)

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
        """**The runner's own observation, not its exit code.**

        `exit_code == 0` is "nothing objected", which pytest also reports for
        a run where every test was skipped, deselected, or never collected —
        so a witness that never executed was converted and its criterion read
        evidenced. `classify` decides `green` from a mark the probe writes off
        a passing call-phase report, so this reads one fact from one place.
        """
        return self.outcome == GREEN


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
        """The witness's filename, refusing any criterion id that is a PATH.

        **The id is interpolated into two write paths and one delete**, and the
        first draft only replaced `-`. A criterion called `../../../pwned`
        therefore wrote outside the store, materialised outside the tree, and
        `clean()` would then remove outside the tree — which is precisely what
        `materialise`'s own comment warns about: *the write landing somewhere
        nobody named makes the cleanup delete something nobody named*.

        Refused rather than slugified. Ids come from a human-approved spec, so
        this is robustness rather than attack surface — and a silent rewrite
        would break the join between this file and `acceptance.json`, which is
        keyed on the id. A loud refusal costs a person one edit.
        """
        if not _SAFE_ID.fullmatch(self.criterion):
            raise WitnessError(
                f"the criterion id {self.criterion!r} cannot name a witness "
                "file: it must be letters, digits, '-', '_' or '.', and may "
                "not be '.' or '..'. The id is interpolated into the path the "
                "bytes are written to, the path they are materialised at, and "
                "the path the cleanup removes — so an id that is a path makes "
                "all three land somewhere nobody named"
            )
        return f"test_witness_{self.criterion.replace('-', '_')}.py"

    @property
    def command(self) -> str:
        return " ".join((*runner(), f"{MATERIAL_DIRNAME}/{self.filename}"))

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
    """Write the bytes of record into this repository's store, outside it."""
    directory = store_dir(root)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / witness.filename
    path.write_text(witness.source, encoding="utf-8")
    return path


def load(root: Path) -> list[Witness]:
    """Every stored witness, by criterion.

    Absence is absence: a repository with no witness lane returns an empty
    list and every downstream behaviour is byte for byte what it was.
    """
    directory = store_dir(root)
    record_path = directory / WITNESS_FILENAME
    if not record_path.is_file():
        return []
    try:
        recorded = json.loads(record_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise WitnessError(
            f"the witness record at {directory}/{WITNESS_FILENAME} "
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
        # **Fail CLOSED on an absent digest** (§6d item 7, closed by P4-5.7).
        # The first draft read `if expected and expected != actual`, so a
        # record with no `authored.sha256` — or an empty one — skipped the
        # comparison silently and the witness was trusted anyway. That is the
        # one direction this check must never fail in: deleting a field is
        # strictly easier than forging a digest, so a fail-open check is a
        # check an editor turns off by removing it. A record whose digest
        # cannot be verified is not a weaker record, it is no record.
        if not expected:
            raise WitnessError(
                f"the witness for `{criterion}` carries no authored digest, so "
                "the bytes on disk cannot be compared to the bytes its author "
                "produced. This VOIDs the run: an unverifiable record is not a "
                "weaker record, it is no record — and a check that skips itself "
                "when a field is missing is a check anyone can switch off by "
                "deleting the field"
            )
        if expected != actual:
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

# **The sentinel a passing call-phase report writes.** Deliberately not a
# valid Python identifier, so it can never collide with an exception class
# name in the same file and `_raised` can drop it by shape rather than by a
# hand-kept exclusion list.
OBSERVED_PASS = "+passed"

PROBE_SOURCE = '''\
"""Written by Wringer. Records what the runner OBSERVED, not what it exited.

Two facts, both off the report object, both things the runner states about its
own run: the exception CLASS of a failing witness (not the message), and that
a witness actually ran and passed.
"""
import pathlib

import pytest


def _record(text):
    path = pathlib.Path(__file__).parent / "OUTCOME_FILENAME"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(text + "\\n")


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if call.excinfo is not None and report.when in ("setup", "call"):
        _record(call.excinfo.type.__name__)
    elif report.when == "call" and report.passed:
        _record("OBSERVED_PASS")
'''.replace("OUTCOME_FILENAME", OUTCOME_FILENAME).replace(
    "OBSERVED_PASS", OBSERVED_PASS
)

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
    # **Every component, not just the leaf.** The materialisation path became
    # nested when P4-3 moved it under `.wringer/`, and a leaf-only check on a
    # nested path is a check with a hole in it: a symlink planted at `.wringer`
    # redirects the write exactly as one planted at `.wringer/witness` would,
    # and `mkdir(parents=True)` would follow it without complaint. The whole
    # reason W4 rules this rather than leaving it to the implementation is that
    # the write landing somewhere nobody named makes the cleanup delete
    # something nobody named either.
    walked = tree
    for part in (*Path(MATERIAL_DIRNAME).parts, witness.filename):
        walked = walked / part
        if walked.is_symlink():
            raise WitnessError(
                f"a symlink is planted at the witness materialisation path "
                f"({walked.relative_to(tree)}, under {MATERIAL_DIRNAME}). "
                "Wringer will not follow it: the write would land somewhere "
                "nobody named. This VOIDs the run"
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

    **Where a witness runs, and the claim corrected 2026-08-15.** An earlier
    draft of this docstring said that under a declared containment the witness
    runs inside that boundary. **The `verify` path does not do that, and it
    should not.** `run.containment` governs the WORKER — the untrusted party
    that writes code. A witness is a CHECK, and a check has to run where the
    project's dependencies are: in a bare worker image every witness would fail
    on a missing import, which is a `collection_error`, which discards it — the
    lane inert again, in a new costume. So the witness runs where the GATES
    run, which is the separation `execution:` versus `run.containment` already
    draws, and R-1 and W9 are why that separation exists.

    The contained path below is real and is used by callers that pass an
    established containment; `verify` passes none. **The honest limit, and it
    is a real one: a witness is model-authored Python, and running it on the
    host is code execution this lane introduces.** It is pinned and it is
    Wringer's own artifact rather than the worker's, which is the whole of what
    bounds it today.
    """
    # **Is the runner actually there?** Asked before anything is classified,
    # because the failure mode it closes was measured on a real corpus task and
    # is silent: `python3 -m pytest` with no pytest installed prints
    # `No module named pytest` and exits **1** — not 127, which the containment
    # branch below already catches. Exit 1 with no exception class recorded is
    # `classify`'s definition of a genuine ASSERTION, so the witness came back
    # `proved_red: assertion`, `verdict: proven`, `covered: true` — for a check
    # that had never run at all.
    #
    # A false proved-red is strictly worse than an uncovered criterion: an
    # uncovered criterion goes to a human, and this one inflates §5.1's coverage
    # number with checks that cannot execute.
    #
    # The probe is structural in exactly the sense W8 requires — `--version`
    # exits 0 if and only if the runner can import itself, which is a fact the
    # runner states about its own installation. No message is read.
    contained = containment_settings is not None and established is not None
    chosen = runner(contained)
    unrunnable = _runner_missing(chosen, tree, env, containment_settings, established)
    if unrunnable is not None:
        raise WitnessError(
            f"the witness for `{witness.criterion}` cannot run: {unrunnable}. "
            "Wringer will not report a criterion covered, or uncovered, for a "
            "reason that is not about the criterion — a check that never "
            "executed is not evidence in either direction"
        )

    path = materialise(tree, witness)
    relative = str(path.relative_to(tree))
    try:
        argv: list[str] = [*chosen, relative]
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
        reported = _reported(tree)
        return Execution(
            exit_code=done.returncode,
            outcome=classify(
                done.returncode,
                frozenset(n for n in reported if n != OBSERVED_PASS),
                OBSERVED_PASS in reported,
            ),
            first_line=_first_meaningful_line(log, witness),
            log=log,
        )
    finally:
        clean(tree)


def _runner_missing(
    runner: tuple[str, ...],
    tree: Path,
    env: dict[str, str] | None,
    containment_settings: Any = None,
    established: Any = None,
) -> str | None:
    """Why this runner cannot run, or None. Structural, never a message read.

    `-m pytest --version` collects nothing, imports no test, touches no tree,
    and exits 0 if and only if the interpreter can import pytest. That is the
    same KIND of fact the exit code of a real run is, which is the only kind W8
    permits a decision to rest on.
    """
    argv: list[str] = [*runner, "--version"]
    if containment_settings is not None and established is not None:
        from wringer import containment as containment_module

        argv = containment_module.argv(
            containment_settings, established,
            " ".join([*CONTAINED_RUNNER, "--version"]), tree, tree,
        )
    try:
        done = subprocess.run(
            argv,
            cwd=tree,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
            env={**os.environ, **RUNNER_ENV, **(env or {})},
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return f"the runner {runner[0]!r} could not be started ({exc})"
    if done.returncode != 0:
        where = (
            f"inside the containment (image "
            f"{getattr(containment_settings, 'image', '?')!r})"
            if containment_settings is not None and established is not None
            else f"at {runner[0]}"
        )
        return (
            f"pytest is not importable {where} — `{' '.join(runner)} --version` "
            f"exited {done.returncode}. Install pytest there, or point the "
            "witness lane at an interpreter that has it"
        )
    return None


def _reported(tree: Path) -> frozenset[str]:
    """Everything the probe recorded, verbatim — classes and the pass mark."""
    path = tree / MATERIAL_DIRNAME / OUTCOME_FILENAME
    try:
        return frozenset(path.read_text(encoding="utf-8").split())
    except OSError:
        return frozenset()


def _raised(tree: Path) -> frozenset[str]:
    """The exception classes the runner reported, as it reported them."""
    return frozenset(
        name for name in _reported(tree) if name != OBSERVED_PASS
    )


def classify(
    exit_code: int,
    raised: frozenset[str] = frozenset(),
    observed_pass: bool = True,
) -> str:
    """W8's structural discriminator, in all three of its halves.

    `assertion` ONLY when the runner collected the check, ran it, and it failed
    on something other than not finding what it was written against.

    The exit code answers the first half: 2 is a module-level import or syntax
    error, 5 is nothing collected, 1 is a test that ran and failed. The
    exception class answers the second: a test that imports inside its own body
    collects fine and fails at exit 1, which the exit code alone cannot tell
    from a real assertion — and that failure has exactly the property W8
    refuses, turning green the moment any file of that name exists with any
    content.

    **The third is the one exit 0 cannot answer at all: did anything RUN?**
    pytest exits 0 for a run in which every test was skipped, deselected or
    never collected, so `exit_code == 0` was reading "nothing objected" as
    "the criterion is satisfied". The pin covers the witness's BYTES, its
    command and its path; it does not — and cannot — cover the pytest
    CONFIGURATION, which the worker owns and rewrites freely. A root
    `conftest.py` with an autouse fixture calling `pytest.skip`, or an
    `addopts` carrying `-k`/`-m`, converts every witness in the repository
    and every criterion reads evidenced by a check that never executed.
    Nothing voided; nothing was discarded; the record simply said `passed`.

    So green is now an OBSERVATION the runner made — the probe writes a mark
    from the report object on a passing call phase — and not an inference
    from an exit code. Everything unrecognised is `collection_error` and is
    **not a proved red**: an outcome nobody anticipated claims less rather
    than more, and that is where a silent zero now lands.
    """
    if exit_code == 0:
        return GREEN if observed_pass else COLLECTION_ERROR
    if exit_code == EXIT_FAILED:
        return COLLECTION_ERROR if (raised & LOAD_FAILURES) else ASSERTION
    return COLLECTION_ERROR


# **ANSI, stripped before anything is matched.** `--color=no` is on the runner
# and this is the second line of defence, because a pattern that only holds when
# the environment is clean is a pattern that holds until somebody sets
# `FORCE_COLOR=1` in CI — which is exactly how the progress bar came back in the
# measurement that produced this constant.
_STRIP_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

# pytest's per-test progress line: outcome characters, optionally followed by
# a `[ 50%]` counter. `F  [100%]` is what `-q` prints first, and it was what the
# citation and the brief both carried until 2026-08-15 — the review's finding 6.
_PROGRESS_LINE = re.compile(r"^[.FEsxXpuw]+\s*(\[\s*\d+%\])?$")

# pytest's section separators: `____ test_it ____`, `---- Captured ----`. They
# carry the TEST'S OWN NAME and no failure at all, and they are what the
# citation fell back to for two very ordinary witness shapes —
# `pytest.fail(msg, pytrace=False)` and a strict `xfail`, neither of which emits
# an `E` line. Same defect class as the progress bar: a mandatory citation that
# is always present and never says anything.
_SEPARATOR_LINE = re.compile(r"^[_=~-]{3,}.*[_=~-]{3,}$|^[_=~-]{3,}$")

# pytest marks the failure's own line with a leading `E`. That line IS the
# failure — `E   assert 1 == 2`, `E   AssertionError: ...` — which is what W5
# means by the worker receiving the failure OUTPUT.
_ERROR_LINE = re.compile(r"^E\s+(.*)$")

# `-q`'s short-summary line: `FAILED path::test - the message`. The message
# after the dash is a real failure statement and is the best fallback when no
# `E` line exists; everything before it is the PATH, which W5 forbids handing
# over, so only the tail is ever taken.
_SHORT_SUMMARY = re.compile(r"^(?:FAILED|ERROR)\s+\S+\s+-\s+(.*)$")


def _first_meaningful_line(log: str, witness: Witness | None = None) -> str:
    """The line that says what FAILED — never the progress bar (P4-5.1).

    **Closing the review's finding 6.** This returned pytest's progress bar,
    `F  [100%]`, because that is genuinely the first non-`=` line `-q` prints.
    So the mandatory `proved_red.first_line` citation and the brief's witness
    line both said `F [100%]` — W5's *"carries the failure"* half delivering a
    character and a percentage. A worker briefed with that has been told a
    check failed and nothing whatsoever about how.

    This is CITATION text, not classification. W8's discriminator still comes
    from the exit code and the exception class off the runner's report object;
    nothing here decides anything, and `vacuity.py:39-44`'s refusal to
    auto-classify by reading failure prose is untouched. This only chooses
    which line of the runner's own output to quote.

    **W5's other half is enforced here too**: the citation may not carry the
    witness's source, path or command. pytest's short-summary line is
    `FAILED .wringer/witness/test_witness_x.py::test_it - assert ...`, which
    names the path — so the path is scrubbed out of whatever line is chosen,
    rather than the choice being trusted to avoid it. A worker that learns the
    materialisation path can go and read the check.
    """
    chosen = ""
    summary = ""
    for raw in log.splitlines():
        # ANSI first, before ANY pattern is applied. A coloured progress bar
        # matches none of them and was therefore chosen as the citation.
        stripped = _STRIP_ANSI.sub("", raw).strip()
        if (
            not stripped
            or _PROGRESS_LINE.match(stripped)
            or _SEPARATOR_LINE.match(stripped)
        ):
            continue
        error = _ERROR_LINE.match(stripped)
        if error is not None and error.group(1).strip():
            return _without_the_witness(error.group(1).strip(), witness)[:200]
        short = _SHORT_SUMMARY.match(stripped)
        if short is not None and short.group(1).strip():
            # Held, never returned early: it is printed AFTER the body, and
            # **pytest TRUNCATES it** — `Failed: the total was ...` where the
            # body carries `Failed: the total was 5, expected 6`. Measured
            # while writing the test for finding 10, which is why this ranks
            # below an ordinary body line rather than above it.
            summary = summary or short.group(1).strip()
        elif not chosen:
            # The first ordinary line of the failure block. For the shapes that
            # print no `E` line at all — `pytest.fail(..., pytrace=False)`, a
            # strict xfail — this IS the failure, in full.
            chosen = stripped
    return _without_the_witness(chosen or summary, witness)[:200]


def _without_the_witness(line: str, witness: Witness | None) -> str:
    """Scrub the path and filename W5 forbids handing over."""
    for secret in (
        f"{MATERIAL_DIRNAME}/{witness.filename}" if witness else "",
        witness.filename if witness else "",
        MATERIAL_DIRNAME,
    ):
        if secret:
            line = line.replace(secret, "the witness")
    return line.strip()


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
    path = store_dir(root) / witness.filename
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
    """Write the store's `witness.json` — `wringer.witness.v1`."""
    directory = store_dir(root)
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
    outstanding = [w for w in witnesses if unconverted(w)]
    if not outstanding:
        return []
    lines = [
        "",
        "## What is not yet demonstrated",
        "",
        "Wringer holds a check for each criterion below. Each one is failing "
        "on the tree as it stands right now. Make it pass by satisfying the "
        "criterion — the check itself is not yours to edit, and it is not in "
        "this tree.",
        "",
    ]
    for item in outstanding:
        # **The CURRENT failure, not the pre-change one** (P4-1). The loop now
        # continues while a witness is red, so a worker on lap 3 needs to know
        # what the check says on lap 3's tree; the born-red line is a fact
        # about a tree three turns ago. `proved_red` is the fallback for the
        # first brief of a run where the witness has not been executed against
        # the working tree yet.
        latest = item.executed or item.proved_red
        first = latest.first_line if latest is not None else ""
        lines.append(f"- `{item.criterion}` — {first}")
    return lines


def unconverted(item: Witness) -> bool:
    """Whether this witness is usable and still RED on the tree as it stands.

    **The predicate the repair loop turns on** (P4-1). A usable witness that has
    not been executed yet counts as unconverted: it was proved red on the
    pre-change tree and nothing since has shown otherwise, so treating "not yet
    measured" as converted would be the fail-open direction on the one check
    that carries information about the change.
    """
    if not item.usable:
        return False
    return item.executed is None or not item.executed.passed


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
    "A witness is model-authored code and it runs where the GATES run, not "
    "inside the worker's containment — a check needs the project's "
    "dependencies, and in a bare worker image every witness would fail on a "
    "missing import and be discarded. Running it is code execution this lane "
    "introduces; the pin bounds what runs, not what it may do.",
)
