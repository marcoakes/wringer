"""What a failing gate's output LOOKS like — one detector, and never a verdict.

SPEC_ENV_V0 (F6), as amended 2026-08-17. The whole module exists to keep one
boundary, restated from that spec's ruling 1 because it is the only thing
standing between this file and the cleverness the project refuses:

    **A classification may ROUTE, and may never CLAIM.**

Everything here feeds routing records — the loop's stop reason, `diagnosis.json`,
a fleet row's free-string reason, brief text, console text. **None of it may
enter or influence a verdict**: not acceptance's receipts, not vacuity, not
health. `health.genuine_failure` keeps discounting exit 127 from its own reading
of the exit code, never from anything written here.

**Two tiers, and the difference between them is the whole design.**

- The **fact tier** (`stops_the_loop`) is a shell fact and is deliberately
  small. It routes.
- The **hint tier** (`face_of`) is a guess read out of text. It is labelled a
  guess wherever it is shown, and it routes NOTHING.

The dossier's sharp edge is why the split exists at all: a broken environment
and a genuine bad import are the same words at the same exit code, and
SPEC_GATEGEN ruling 4 already refused the language-specific tell as "a guard
that sometimes lies".

**One detector, two callers.** `wring start`'s console hint and the loop both
land here. `tests/test_env.py` reddens if a second detector appears, because
the shipped classifier having lived behind exactly one door — `wring start` —
while the loop re-guessed for itself is the shape F6 was written after.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from wringer import config, gates

# The three faces the shipped classifier already knew, named so a record can
# carry the name instead of the prose. `not_executable` is new here: it was in
# SPEC_ENV's ruling 2 from the start and had no code.
#
# **They carry a `FACE_` prefix for a reason a guard found.** The first draft
# called the first one `COMMAND_NOT_FOUND`, which collides with
# `gates.COMMAND_NOT_FOUND` — and the two are not the same KIND of thing: one
# is the string `"command_not_found"`, the other is the integer `127`. Anyone
# importing the wrong one gets a silent type confusion rather than an error.
# `test_command_not_found_has_one_definition_site` reddened on it.
FACE_COMMAND_NOT_FOUND = "command_not_found"
FACE_MISSING_MODULE = "missing_module"
FACE_NOT_EXECUTABLE = "not_executable"

FACES = (FACE_COMMAND_NOT_FOUND, FACE_MISSING_MODULE, FACE_NOT_EXECUTABLE)

# What a POSIX shell reports when it found the file and could not execute it.
# Its sibling 127 has ONE definition site, `gates.COMMAND_NOT_FOUND`, and is
# imported rather than repeated — see
# `test_command_not_found_has_one_definition_site`.
NOT_EXECUTABLE_EXIT = 126

# One sentence per face, addressed to a person. Kept beside the detector so a
# new face cannot be added without one, and phrased as a possibility because
# that is what it is.
DESCRIPTIONS = {
    FACE_COMMAND_NOT_FOUND: "ran a command that is not on PATH",
    FACE_MISSING_MODULE: (
        "needs a package that is not installed in the environment"
    ),
    FACE_NOT_EXECUTABLE: "found the command but could not execute it",
}


# --- the worker's own turn, which is a different subject entirely -----------
#
# **R1 (2026-08-18), and it is deliberately NOT a fourth `face` above.** The
# faces are read off a failing GATE's output and land in `diagnosis.json`,
# whose `face` is a closed enum in a published, frozen schema — and whose
# `gate` and `evidence` fields have no honest value for a fact that came from
# the worker's ledger rather than from any gate's log. So this is its own
# shape in its own sibling file, on the `usage.json` / `vacuity.json` /
# `diagnosis.json` precedent: law 7, a new file is always allowed.
FACE_TURN_CHANGED_NOTHING = "turn_changed_nothing"

# **The second worker face, added 2026-08-21 after the field run that needed
# it.** A turn REFUSED — the agent answered `session/prompt` with an error
# instead of a turn — used to produce no diagnosis at all: `diagnose_turn`
# returns None when `errored`, so the loop stopped on `no_progress` and the
# operator was told "an attempt changed nothing at all… an engineer has to
# look at why it is stuck". The one actionable fact, `Authentication
# required`, was in a log file under a timestamped directory, and the word
# "authentication" appeared nowhere a person would look.
#
# The silence was STRUCTURAL, not a missing sentence: there was no shape for
# this ending, so there was nothing for the console, the record or the drive
# to carry. `docs/field-report-2026-08-21.md` finding 11.
FACE_TURN_REFUSED = "turn_refused"

WORKER_FACES = (FACE_TURN_CHANGED_NOTHING, FACE_TURN_REFUSED)

# The third clause was added by ruling on 2026-08-19, the day the hint first
# fired on a real turn: the agent had authenticated, thought for 1m49s, and
# returned nothing it could write — a cause the first wording did not name.
# A hint that names two causes and omits the measured third is a guess
# presented as a survey.
WORKER_DESCRIPTIONS = {
    FACE_TURN_CHANGED_NOTHING: (
        "the agent finished its turn without changing a file or reporting an "
        "error; this usually means it could not authenticate, could not see "
        "the work, or produced nothing it could use"
    ),
    # **It names AUTHENTICATION, and it names it as a possibility.** The hint
    # tier may read text but may not claim, so this does not say the agent was
    # unauthenticated — the agent's own words ride along in `engine_words` and
    # a reader can see them. What it must not do is what the old ending did,
    # which is leave the most likely cause unsaid because saying it would be a
    # guess. A hint that omits the measured cause is not caution, it is a
    # survey with the answer removed.
    FACE_TURN_REFUSED: (
        "the agent refused the turn or its session failed, so nothing was "
        "built; the most common cause is that the coding agent is not "
        "logged in — it authenticates on its own account, separately from "
        "Wringer, and Wringer's API key is not its credential and never "
        "reaches it"
    ),
}

# **A POINTER, never a list.** `env_passthrough` exists so that a secret
# crossing into a worker is a declared act by the person who owns it — R1
# refuses naming credential variables by default for exactly that reason, and
# a remedy that named one would be Wringer choosing which of somebody's
# secrets cross a boundary it built on purpose. It also would not have fixed
# the measured failure. So the operator is pointed at their channel and left
# to decide what goes through it.
WORKER_REMEDIES = {
    FACE_TURN_CHANGED_NOTHING: (
        "what a worker is given is declared by the operator, in "
        "`run.worker.acp.env_passthrough`; nothing else crosses that boundary"
    ),
    # **Corrected 2026-08-22 by running it.** Two things here were wrong.
    #
    # It sent the reader to `worker.stderr.log` for "the agent's own last
    # words". In a real refused turn that file is EMPTY: the message —
    # `[wringer: ACP turn failed] session/prompt was refused: Authentication
    # required` — is written to the STDOUT log. The remedy for this
    # repository's commonest failure pointed at a zero-byte file.
    #
    # And the comment that stood here said setting a credential variable
    # "would not have fixed the measured failure: the stock adapter reports
    # `apiType=native` and reads no key at all". That was reasoned from source
    # and is false — `round3b-artifacts/S0-FINDING.md` has the turn that
    # succeeded on exactly that. It still does not NAME a variable, for
    # `FACE_TURN_CHANGED_NOTHING`'s reason one entry up, but it no longer
    # tells the reader the route does not exist.
    FACE_TURN_REFUSED: (
        "check whether the agent is logged in — `wring doctor` answers that "
        "for free and `wring run` now refuses before it spends anything, so "
        "reaching this means the credential was accepted and then failed, or "
        "the agent is one whose login this cannot read; the agent's own last "
        "words are in `worker.stdout.log` and `worker.stderr.log`, under this "
        "loop's `iterations/` directory"
    ),
}


@dataclass(frozen=True)
class WorkerDiagnosis:
    """Why a worker's turn may have produced nothing, from the turn's FACTS.

    **Never from message text** (F6's law: route on facts, hint on text, claim
    on neither). The deprecated ACP adapter answers an unauthenticated prompt
    with a bare `result` and no content — a turn that, read as text, succeeded
    and said nothing. The ledger is the only honest witness: no files written,
    no refusals raised, a clean stop reason.

    Hint tier. It changes no routing — the loop stops on `no_progress` either
    way (R2) — and nothing that reads this may reach a verdict.
    """

    face: str
    # **Absent, not invented, when the turn never reported one.** A refused
    # turn never reached `stopReason`, and writing `"none"` or `"unknown"`
    # there would be a fact this module made up about a conversation that did
    # not happen. `wringer.workerdiagnosis.v2` makes the three ledger fields
    # optional for exactly this ending; v1 required them because the only face
    # it knew was one that always had them.
    stop_reason: str = ""
    files_written: int | None = None
    refusals: int | None = None
    # What the agent said for itself, if anything, carried BESIDE the
    # description rather than parsed into one.
    engine_words: str = ""

    @property
    def description(self) -> str:
        return WORKER_DESCRIPTIONS[self.face]

    @property
    def remedy(self) -> str:
        return WORKER_REMEDIES[self.face]

    def as_json(self) -> dict[str, Any]:
        recorded: dict[str, Any] = {
            "face": self.face,
            "description": self.description,
            "remedy": self.remedy,
        }
        # Each present only when it was READ, never defaulted into the record.
        # A reader that finds no `files_written` knows nobody counted; a
        # reader that finds `0` knows somebody counted and the answer was
        # none, and those are different states.
        if self.stop_reason:
            recorded["stop_reason"] = self.stop_reason
        if self.files_written is not None:
            recorded["files_written"] = self.files_written
        if self.refusals is not None:
            recorded["refusals"] = self.refusals
        if self.engine_words:
            recorded["engine_words"] = self.engine_words
        return recorded


def diagnose_turn(
    *,
    stop_reason: str,
    files_written: int,
    refusals: int,
    errored: bool,
    engine_words: str = "",
) -> WorkerDiagnosis | None:
    """A turn that ended cleanly having done nothing, or None.

    Every argument is a FACT from the `acp.Turn` ledger. `errored` covers the
    turn that never completed at all — a crash, a timeout, a refused session —
    which is a different ending with its own evidence and is not this.
    """
    if errored or files_written or refusals:
        return None
    if not stop_reason or stop_reason == "unknown":
        # An unreported stop reason is not a clean finish; it is a turn
        # nobody can say ended properly, and guessing is what this tier is
        # forbidden to do.
        return None
    return WorkerDiagnosis(
        face=FACE_TURN_CHANGED_NOTHING,
        stop_reason=stop_reason,
        files_written=files_written,
        refusals=refusals,
        engine_words=engine_words,
    )


def diagnose_failed_turn(
    *,
    timed_out: bool,
    files_written: int | None = None,
    refusals: int | None = None,
    engine_words: str = "",
) -> WorkerDiagnosis | None:
    """A turn that ended in an ERROR instead of ending at all, or None.

    The sibling of `diagnose_turn`, and the two are exclusive by construction:
    that one describes a turn that finished cleanly having done nothing, this
    one a turn that never finished. Together they close the hole R1 left open —
    its own docstring named "a refused session" as a distinct ending and then
    returned None for it, so the loop's most common real failure was the one
    ending with no shape at all.

    **Routed on facts.** Two of them, and neither is text:

    1. NOT a timeout. A deadline is its own ending with its own evidence, and
       `wringer.loop.v2` already carries it; calling it a refusal would be this
       module relabelling somebody else's finding.
    2. Nothing landed. A turn that wrote a file or was refused a write DID
       something before it fell over, and blaming its ending on the agent's
       credentials would be a guess about a turn that demonstrably ran. When
       the ledger did not survive the failure both are None — unknown, and
       recorded as absent rather than assumed to be zero.

    `engine_words` is the agent's own message and is the HINT tier: it is
    carried, shown and never read. Nothing above branches on it.
    """
    if timed_out:
        return None
    if files_written or refusals:
        return None
    return WorkerDiagnosis(
        face=FACE_TURN_REFUSED,
        files_written=files_written,
        refusals=refusals,
        engine_words=engine_words,
    )


@dataclass(frozen=True)
class Diagnosis:
    """A guess about WHY a gate failed, with the line it was guessed from.

    `evidence` comes from `gates.cite` — the one evidence-line extractor — so
    the diagnosis quotes exactly what a vacuity row would quote about the same
    gate. Two records citing one gate differently would be worse than either.
    """

    face: str
    gate: str
    evidence: str

    @property
    def description(self) -> str:
        return DESCRIPTIONS[self.face]

    def as_json(self) -> dict[str, str]:
        return {"face": self.face, "gate": self.gate, "evidence": self.evidence}


def face_of(result: gates.GateResult) -> str | None:
    """Which face this failure wears, or None.

    **The hint tier.** Generous on purpose: it may look at text, because
    nothing it returns decides anything. A wrong guess here costs a misleading
    sentence in a brief; the fact tier is where a wrong answer costs a repair.

    Order matters only for the overlap: a `python3 -m pytest` with no pytest is
    exit 1 with `No module named pytest`, while a bare `pytest` with no pytest
    is exit 127 with `command not found` — same cause, same fix, different
    text, and a real launch on the maintainer's Mac hit the second one. Exit
    codes are checked before text because they are the stronger signal.
    """
    if result.timed_out:
        # A timeout is not an environment face. SPEC_ENV: "Timeouts are
        # untouched everywhere." A gate that ran for its whole budget ran.
        return None
    if result.exit_code == gates.COMMAND_NOT_FOUND:
        return FACE_COMMAND_NOT_FOUND
    if result.exit_code == NOT_EXECUTABLE_EXIT:
        return FACE_NOT_EXECUTABLE
    text = "\n".join(gates.informative_lines(result.stderr_path))
    text += "\n" + "\n".join(gates.informative_lines(result.stdout_path))
    if "command not found" in text:
        return FACE_COMMAND_NOT_FOUND
    if "No module named" in text:
        return FACE_MISSING_MODULE
    if "Permission denied" in text:
        return FACE_NOT_EXECUTABLE
    return None


def diagnose(result: gates.GateResult) -> Diagnosis | None:
    """The face plus the line it was read from, or None when nothing matched."""
    face = face_of(result)
    if face is None:
        return None
    return Diagnosis(face=face, gate=result.gate.id, evidence=gates.cite(result))


def first_command_word(run: str) -> str:
    """The first token that is not a `VAR=value` prefix.

    Shell resolution semantics, not a text guess: `FOO=1 BAR=2 pytest -q`
    resolves `pytest`, and that is what decides whether PATH was consulted.
    """
    for token in run.split():
        name, sep, _ = token.partition("=")
        if sep and name and not name[0].isdigit() and name.replace("_", "").isalnum():
            continue  # an assignment prefix, not the command
        return token
    return ""


def path_resolved(run: str) -> bool:
    """Whether the shell would consult PATH for this gate's command.

    A `/` anywhere in the first word means the shell goes straight to a path
    and never consults PATH. **This is the leg that keeps the factory's own
    arming pattern alive** (SPEC_ENV finding D1): a gate of `./bin/tool
    --selftest`, red because the deliverable does not exist yet, is gategen's
    armed-red gate, and a worker creating `./bin/tool` is the exact repair the
    loop exists for.
    """
    word = first_command_word(run)
    return bool(word) and "/" not in word


def stops_the_loop(
    result: gates.GateResult, *, pre_worker: bool
) -> bool:
    """**The fact tier.** Whether this failure stops the loop with no worker.

    All FOUR legs must hold. Each is a fact, and each is here because without
    it the stop would refuse a repair the loop exists to deliver:

    1. `pre_worker` — no worker has acted in this loop's whole life. After a
       worker has edited the tree a 127 is plausibly worker-caused (a broken
       shebang on a tracked script) and worker-revertable. A resumed life
       re-observes a tree a worker may have touched, so it never qualifies.
    2. exit 127 exactly — the shell itself is the witness that nothing ran, and
       `health.genuine_failure` has already ruled such a lap is not evidence. A
       loop that briefs workers on laps its own evidence chain discounts is
       burning money generating non-evidence.
    3. PATH-resolved — see `path_resolved`. D1.
    4. **no `proves:` binding — added by the 2026-08-17 amendment.** A gate
       bound to a criterion is a gategen gate, and a born-red gategen gate is
       SUPPOSED to be red before anyone builds: the criterion is unmet, so a
       correct gate must fail. Stopping it as "environment" refuses the whole
       red-first seam. This is a config fact, not a text guess, and it closes
       D1's residual — leg 3 alone still wrongly stopped a born-red gate that
       invoked its deliverable by a PATH-resolved name rather than by path.

    **Nothing about the OUTPUT TEXT appears in this function.** That is the
    point. The residual it cannot see — an inner file missing behind an on-PATH
    interpreter, `bash scripts/check.sh` with the script absent — stops as
    environment, and that is correct under house rules: gate scripts are
    human-installed (gategen rulings 2 and 4), so their absence is an install
    defect, and the diagnosis line makes it legible.
    """
    if not pre_worker:
        return False
    if result.timed_out or result.exit_code != gates.COMMAND_NOT_FOUND:
        return False
    if not path_resolved(result.gate.run):
        return False
    return not _is_bound(result.gate)


def _is_bound(gate: config.Gate) -> bool:
    """Whether this gate carries a `proves:` binding. Leg 4."""
    return bool(gate.proves)
