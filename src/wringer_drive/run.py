"""The verb: prose in, a board out — SPEC_DRIVE_V0 §2.

It composes the nineteen commands and invents no capability. Where a command
has `--json` it is a subprocess; where one does not, the package is imported as
a library and the permitted symbols are named in §3 ruling 1 rather than
reached for freely.

**What this file will not do**, because the whole point is that easy is not
unguarded:

- never auto-approve. There is no `--yes`, and the plan is rendered by DRIVE
  itself before the answer is taken. Ruling 2.
- never resolve a refusal. It renders them, in the board's words, and stops.
  Ruling 3.
- never write a judgement. A `human:` criterion is a person's, and nothing in
  any of the three packages writes one.
- never treat the approval at step 6 as authorising the delivery at step 9.
  Two acts, two answers. Ruling 2a.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path

from wringer_drive.steps import ASK, CONFIRM, DONE, SHOW, STOPPED, Step

DRIVE_DIRNAME = Path(".wringer") / "drive"
PRD_FILENAME = "prd.md"

# --- the resume record (SPEC_DRIVE_V0 ruling 7, §8's condition discharged) --
#
# Built 2026-08-24.
#
# **§8 answered "the session record earns nothing" in 2026-08-17, and this is
# the demonstration it asked for.** The condition was written as the builder's
# to answer — *"demonstrated rather than assumed, or ruling 7 is deleted"* —
# and the demonstration is a MEASUREMENT, not an argument. Two real runs of
# this verb, the first killed at the approval:
#
#     run 1  prd-copied . question:which-columns . answers-recorded .
#            answers-ok . plan . approve . stopped:nobody-there
#     run 2  prd-copied . answers-recorded . answers-ok . stopped
#
# The resumed run does not land on the approval. It lands one step EARLIER,
# on the read-back the person already confirmed, and nothing anywhere says
# where they had got to. Re-asking a question somebody has answered is how a
# person learns to type `yes` without reading it, and the question after this
# one is the approval — so the training happens directly in front of the
# interlock. Nothing the chain already writes records this: the loop bundle
# and the spec know what was APPROVED, and neither knows what was CONFIRMED
# or where a run stopped.
#
# LangChain's `interrupt()` is the shape (`~/Claude/WRINGER_DEEPAGENTS_
# DOSSIER_2026-08-23.md` section 3.2): checkpoint the state BEFORE asking, so
# the process may die and the resume replays to the same question.
#
# **It resumes TO a question and never PAST one.** The approval is asked live
# on every run, whatever this file says — a recorded yes answering a later
# run's approval would be the file-driven authorisation ruling 2a forbids.
# What the record removes is the re-asking of `answers-ok`, which ruling 2
# states in the code is NOT an approval and authorises nothing, and it is
# removed only while the answers are byte-identical to the ones that were
# confirmed. Change any answer and the question comes back.
RESUME_FILENAME = "resume.json"

#: `wringer-drive`'s own, in its own directory. It spends no version of any
#: engine schema and adds no field to a frozen one (ruling 7).
RESUME_SCHEMA = "wringer.driveresume.v1"

# The engine verbs this package drives, and the refusal FAMILIES each can put
# in front of an operator. Declared here and checked against the source by
# `test_the_reachable_refusal_families_are_derived_from_what_DRIVE_DRIVES`, so
# a step added later either widens this set or fails.
#
# **Families, not values** (finding 10): `refusals.MAPPING` is keyed on
# `(family, value)` pairs deliberately, and 19 of its 45 pairs come from
# `attest`, `audit`, `health` and `fleet` — none of which appears in §2. A test
# over "every value" would demand sentences for stops this verb cannot reach.
ENGINE_VERBS: dict[str, tuple[str, ...]] = {
    # Neither `init` nor `spec` carries a NAMED refusal value: both stop with
    # stderr prose and an exit code, which is ruling 3's branch 3.
    "init": (),
    "spec": (),
    "plan": (),
    "run": ("loop-ending",),
    "deliver": ("delivery-refusal",),
    # `wringer-board render` reads what the others wrote and refuses nothing.
    # Declared with an empty tuple rather than omitted, because the check is
    # that every verb DRIVEN is accounted for — silence would read as "not
    # driven", which is the state this exists to catch.
    "render": (),
}


class Stop(Exception):
    """The run stopped. Carries the step that says why, in the PM's language.

    Not called `Refused`: in this programme a `Refused` is the ENGINE's word
    with its own exit codes, and a surface inventing a second one with the same
    name is how two vocabularies start.
    """

    def __init__(self, step: Step, exit_code: int = 1) -> None:
        super().__init__(step.text)
        self.step = step
        self.exit_code = exit_code


@dataclass
class Session:
    """One run, and what it has emitted so far."""

    repo: Path
    steps: list[Step] = field(default_factory=list)

    def emit(self, step: Step) -> Step:
        self.steps.append(step)
        return step


# --- the three branches a stop can take (ruling 3) --------------------------


def stop_for(family: str, value: str, engine_words: str = "") -> Step:
    """A stop the board has a sentence for, or honestly does not.

    **Three branches, and the third is the one the drafted spec forgot**: a CLI
    refusal that carries no named value at all — `wring spec`'s "no `judge:`
    section", every `InterviewError` — is stderr prose with an exit code, and
    "unmapped" presupposes a key.
    """
    from wringer_board import refusals

    if not value:
        # Branch 3: no named value. The engine's own words, said to be its own.
        return Step(
            kind=STOPPED,
            id="stopped",
            text="This stopped, and here is exactly what the tool said.",
            engine_words=engine_words or "(the tool printed nothing)",
        )

    saying = refusals.say(family, value)
    if saying is None:
        # Branch 2: named, and this surface has no sentence for it. Ruling 17 —
        # a PM seeing an ugly string files a bug report; a PM seeing nothing
        # has been lied to.
        return Step(
            kind=STOPPED,
            id=f"stopped:{value}",
            text=f"This stopped for a reason this page has no wording for yet: {value}",
            engine_words=engine_words or None,
        )
    # Branch 1: mapped. The board's sentence and its unblocking question,
    # verbatim — this package writes neither.
    return Step(
        kind=STOPPED,
        id=f"stopped:{value}",
        text=saying.sentence,
        question=saying.question,
        engine_words=engine_words or None,
    )


# --- step 0: bring the PRD inside -------------------------------------------


def bring_prd_inside(session: Session, prd: Path) -> Path:
    """Copy the PRD into the repository, and say so.

    **Finding 16.** `spec.read_prd` refuses a PRD that resolves outside the
    repository, so a PM's obvious first move — pointing at `~/Desktop/PRD.md`
    — is refused today. Copying it is the smallest honest fix, and it is
    announced rather than done quietly: a verb that silently moves a person's
    files is a verb they cannot predict.
    """
    if not prd.is_file():
        raise Stop(
            Step(
                kind=STOPPED,
                id="stopped:no-prd",
                text=f"There is no file at {prd}. Point this at the document "
                "describing what you want built.",
            ),
            exit_code=2,
        )
    if not (session.repo / ".git").exists():
        raise Stop(
            Step(
                kind=STOPPED,
                id="stopped:not-a-repo",
                text=f"{session.repo} is not a git repository, and Wringer "
                "works on repositories. Ask an engineer to set one up, or "
                "point this at a project that already is one.",
            ),
            exit_code=2,
        )

    inside = session.repo / DRIVE_DIRNAME / PRD_FILENAME
    try:
        inside.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(prd, inside)
    except OSError as exc:
        # **This one STOPS, and the contrast with `_write_resume` is the
        # point.** The resume record is a convenience and fails quietly; this
        # copy is load-bearing — step 1 reads the file it makes — so a failure
        # here must end the run with a sentence rather than continue, and must
        # not end it with a traceback either.
        #
        # Found by hunting, 2026-08-24, in both shapes a real machine produces:
        # a stray FILE where `.wringer/drive` should be (`FileExistsError`),
        # and a directory the operator cannot write (`PermissionError`, which
        # is what a wrong-owner checkout or a full disk looks like). Both
        # printed a Python traceback at a product manager, from the first step
        # of the verb whose whole job is that they never see one.
        raise Stop(
            Step(
                kind=STOPPED,
                id="stopped:prd-not-copyable",
                text="I could not put your document inside the project, so "
                "nothing has been read and nothing was created. The tool only "
                f"reads files inside the repository, and "
                f"{DRIVE_DIRNAME / PRD_FILENAME} is where it needs to go.",
                engine_words=str(exc),
            ),
            exit_code=2,
        ) from exc
    session.emit(
        Step(
            kind=SHOW,
            id="prd-copied",
            text=f"I copied your document into the project, at "
            f"{inside.relative_to(session.repo)}, because the tool only reads "
            "files inside it. Your original is untouched.",
        )
    )
    return inside


# --- steps 2 and 3: the workspace, then the draft ---------------------------

# What DRIVE may fill in for itself, because none of it points anywhere or
# names a command: a filename, an attempt budget, a branch template. The three
# it may NOT invent are asked for — an endpoint is a network address, a model
# is a bill, and a worker is a command, and ruling 5's whole point is that a
# generated config which invented a command nobody wrote would be a gate whose
# green means nothing.
DECLARED_DEFAULTS = {
    "rubric": "wringer.rubric.yaml",
    "max_iterations": 2,
    "branch": "wringer/{run}",
    # The NAME of the variable holding the key, never a key
    # and never a value. DRIVE cannot read the environment at
    # all — `test_there_is_no_flag_that_answers_the_approval`
    # forbids it structurally — so this names where the
    # ENGINE should look and nothing more.
    "api_key_env": "WRINGER_API_KEY",
    # The engine's own default is 1024, which TRUNCATES the
    # reply for any real PRD — measured, twice, against a
    # live endpoint before this number was written down.
    # A truncated draft is not a smaller draft: `wring spec`
    # refuses the whole reply and writes nothing.
    "max_output_tokens": 8000,
    # The engine's own default is 120 seconds, and a real
    # PRD's drafting call does not reliably fit in it —
    # measured on 2026-08-19, three drives of one document
    # took 47s, 50s and 56s, and a fourth was still going at
    # 120s and was cut off. The operator then loses the whole
    # call, having paid for it, to a message about seconds.
    #
    # This is a CEILING on waiting, not a promise of speed.
    # Nothing here makes drafting slower; it stops a slow one
    # being thrown away.
    "timeout": 600,
}

# Each question OFFERS its documented example value in the question text —
# asking with no suggestion was field-run finding 8 — and the person still
# answers: an empty answer stops the run, never falls back to a suggestion.
# The values are the ones AGENTS.md documents, and a guard holds the two
# to the same strings.
#
# **`suggested` is a LIST, and it became one to keep the charter true.** It
# held exactly one value per question, which was fine while one vendor's agent
# was the only one anybody had measured and quietly wrong the moment three
# were: a single offered command reads as THE command, and a tool whose whole
# claim is that it works with anything must not present one vendor's binary as
# the shape of the answer. The list is uniform — one entry where there is one
# documented value — so an agent reading `detail` never meets two shapes.
#
# **Offers, never fallbacks.** Nothing in this module reads `suggested` at
# run time; it exists so the question text and the runbook can be held to the
# same strings by a guard, and so nobody has to invent a value. An unanswered
# question stops the run. `test_drive_docs.py` pins both halves, and
# `test_no_vendor_is_ever_a_default` pins that no vendor string reaches a
# generated config the person did not type.
#
# The endpoint and the model carry ONE offer each on purpose: they must MATCH
# — `glm-5.3` at Anthropic's URL is a 404, not a choice — so the question
# points at the matrix rather than inviting a mix-and-match. The worker
# question carries three, because a worker command stands on its own.
# **A URL, and NOT a repo-relative path — found by the bug hunt, 2026-08-22.**
#
# These questions are answered by a person standing in THEIR OWN repository,
# which is the whole point of the tool. `docs/vendors.md` exists in Wringer's
# source tree and nowhere on their machine — the `uv tool install` front door
# ships no docs at all. So the first question a product manager ever answers
# was pointing at a file they do not have, which is precisely the defect class
# `test_the_runbook_names_the_example_PRD_where_the_example_puts_it` exists
# for, on the one surface where the reader is least able to work it out.
VENDORS_PAGE = "https://github.com/marcoakes/wringer/blob/main/docs/vendors.md"

SETUP_QUESTIONS = (
    Step(
        kind=ASK,
        id="setup:endpoint",
        text="Which model endpoint should read your document and draft the "
        "plan? Any endpoint that speaks the OpenAI chat-completions shape "
        "works. Paste the URL your team uses — for the worked example "
        "it is https://api.anthropic.com/v1/chat/completions, and the "
        "measured alternatives are listed at "
        f"{VENDORS_PAGE}. Your "
        "API key will be sent to whatever URL you enter here.",
        detail={
            "key": "endpoint",
            "suggested": ["https://api.anthropic.com/v1/chat/completions"],
            "more": VENDORS_PAGE,
        },
    ),
    Step(
        kind=ASK,
        id="setup:model",
        text="Which model should it use? (a name, like the one on your "
        "team's API page — the worked example uses claude-opus-5. It has "
        "to be a model the endpoint above serves; the pairs that were "
        f"measured are at {VENDORS_PAGE})",
        detail={
            "key": "model",
            "suggested": ["claude-opus-5"],
            "more": VENDORS_PAGE,
        },
    ),
    Step(
        kind=ASK,
        id="setup:worker",
        text="Which coding agent should do the building? Give the command "
        "that starts it — any agent you can start from a terminal will "
        "do. Four that were measured: acp: claude-agent-acp, "
        "acp: dcode --acp, acp: kimi acp, and codex exec --json -.",
        detail={
            "key": "worker",
            "suggested": [
                "acp: claude-agent-acp",
                "acp: dcode --acp",
                "acp: kimi acp",
                "codex exec --json -",
            ],
            "more": VENDORS_PAGE,
        },
    ),
)


def _worker_block(answer: str) -> str:
    """The `run.worker` the operator described, in whichever of its two forms.

    The engine has exactly two: a shell string ("run this and see what
    changed") and an `acp:` mapping ("hold a session with an agent that speaks
    a standard"). An operator whose agent speaks ACP says so with an `acp:`
    prefix; anything else is the command, quoted and otherwise untouched.

    **Neither form is invented and neither is defaulted to.** This writes down
    what the person said, which is the difference between generating a config
    and guessing one.
    """
    if not answer.lower().startswith("acp:"):
        return f'  worker: "{answer}"\n'
    words = answer[len("acp:") :].strip().split()
    block = "  worker:\n    acp:\n" + f'      command: "{words[0]}"\n'
    if words[1:]:
        block += "      args: [" + ", ".join(f'"{w}"' for w in words[1:]) + "]\n"
    return block


def needs_workspace(repo: Path) -> bool:
    """Absence, not staleness (§9 question 3).

    A `.wringer.yaml` somebody wrote is theirs. A verb that decided another
    person's config was out of date and rewrote it would be the vibe tooling
    this project answers.
    """
    from wringer import config

    return not (repo / config.CONFIG_FILENAME).is_file()


def generate_workspace(session: Session, repo: Path, answers: dict) -> None:
    """`wring init`, then the three sections it does not write (§3a).

    `wring init` is a SUBPROCESS and not an import: `cmd_init` reads
    `Path.cwd()` and takes no target, so driving it in-process would need a
    global `chdir` — unsafe in a verb that later runs this repository's gates
    (finding 19). `detect` is imported only to read the FACT of which branch
    fired, which is prose on stdout and so cannot be read any other way.
    """
    from wringer import config, detect

    done = run_command(repo, [engine("wring"), "init"])
    if done.returncode != 0:
        raise Stop(
            stop_for("", "", engine_words=(done.stderr or "").strip()), done.returncode
        )

    # Ruling 5, with the mechanism NAMED rather than wished for: `wring init`
    # never stops — on empty detection it writes a placeholder gate `run:
    # "true"` so that `wring init && wring verify` exits 0 in a repo nobody
    # has configured. `is_untouched_template` is what recognises that state.
    # **`is_untouched_template` takes the CONFIG's gates, not the detector's
    # candidates**, and `Detection` has no `.gates` at all — assumed here once
    # and corrected against the real object. The detector says what it found
    # on disk; only the written config says what will actually run.
    found = detect.detect(repo)
    written = config.load(repo / config.CONFIG_FILENAME)
    if detect.is_untouched_template(written.gates):
        raise Stop(
            Step(
                kind=STOPPED,
                id="stopped:nothing-runnable",
                text="Nothing was built. This project has no tests or checks "
                "that could prove the work was done, and inventing one would "
                "prove nothing. Ask an engineer to add a test command.",
            ),
            exit_code=2,
        )

    path = repo / config.CONFIG_FILENAME
    path.write_text(
        path.read_text(encoding="utf-8")
        + "\n"
        + "judge:\n"
        + f"  endpoint: {answers['endpoint']}\n"
        + f"  model: {answers['model']}\n"
        + f"  rubric: {DECLARED_DEFAULTS['rubric']}\n"
        + f"  api_key_env: {DECLARED_DEFAULTS['api_key_env']}\n"
        + f"  max_output_tokens: {DECLARED_DEFAULTS['max_output_tokens']}\n"
        + f"  timeout: {DECLARED_DEFAULTS['timeout']}\n"
        + "\n"
        + "run:\n"
        + _worker_block(answers["worker"])
        + f"  max_iterations: {DECLARED_DEFAULTS['max_iterations']}\n"
        + "\n"
        + "deliver:\n"
        + f'  branch: "{DECLARED_DEFAULTS["branch"]}"\n',
        encoding="utf-8",
    )
    session.emit(
        Step(
            kind=SHOW,
            id="workspace",
            text=f"I set the project up to run its own checks: "
            f"{', '.join(g.id for g in written.gates)}. Nothing was invented "
            f"— these come from {', '.join(found.sources) or 'this project'}, "
            "which already declares them.\n\n"
            "Reading your document costs money, so the model endpoint needs a "
            f"key. The project will look for it in {DECLARED_DEFAULTS['api_key_env']}, "
            "which has to be set in the environment before the next step. "
            "Wringer never stores a key and this tool never reads one.",
            detail={"api_key_env": DECLARED_DEFAULTS["api_key_env"]},
        )
    )


def require_worker(repo: Path) -> None:
    """**The coding agent must EXIST before anything is paid for.**

    Field report 2026-08-21, finding 6, and it is the whole shape of the
    defect rather than one bad message: a product manager answered the
    interview, spent TWO paid API calls, gave THREE approvals and installed a
    gate — and only then learned that the agent named in the example was not
    on their machine. The error they finally got is good. It arrived after
    everything it could have saved.

    Nothing here is new capability. `loop.missing_agent` is the preflight
    `wring run` already does, imported rather than re-implemented so the two
    front doors cannot disagree about whether an agent is present — the same
    argument SPEC_DRIVE_V0 ruling 1 makes for every other import, and a second
    copy of a PATH check is exactly the drift that ruling exists to stop. It
    is called EARLIER here, which is the entire fix.

    **A missing or unreadable config is not this function's refusal.** It says
    nothing and lets the engine speak in its own words at the first call: a
    surface that invented a config error would be guessing at a file it is not
    the authority on.
    """
    from wringer import config, loop

    path = repo / config.CONFIG_FILENAME
    if not path.is_file():
        return
    try:
        settings = config.load(path)
    except config.ConfigError:
        return
    if settings.run is None:
        return
    message = loop.missing_agent(settings.run)
    if message is not None:
        raise Stop(
            Step(
                kind=STOPPED,
                id="stopped:no-worker",
                text="Nothing was built and nothing has been spent. The coding "
                "agent this project is set up to use is not installed on this "
                "machine, and it is the thing that would do the building — so "
                "this stops here, before the step that costs money.",
                engine_words=message,
            ),
            exit_code=2,
        )
    # **And the next question along, which cost two field runs.**
    #
    # An agent can be installed and never logged in, and on 2026-08-21 and
    # 2026-08-22 that is exactly what happened: both product managers got
    # through the interview, paid for drafting, and met `Authentication
    # required` at the build step. The PATH check above was green for both of
    # them. Imported from the engine for `require_worker`'s own reason — two
    # front doors may not disagree about whether a run can start.
    message = loop.unauthenticated_agent(settings.run)
    if message is not None:
        raise Stop(
            Step(
                kind=STOPPED,
                id="stopped:worker-signed-out",
                text="Nothing was built and nothing has been spent. The coding "
                "agent is installed, but it says it is not logged in — and it "
                "is the thing that would do the building. Giving it a "
                "credential is your decision, so this stops here and shows "
                "you both ways, before the step that costs money.",
                engine_words=message,
            ),
            exit_code=2,
        )


def draft_the_spec(
    session: Session, repo: Path, prd: Path, announce: object = None
) -> None:
    """`wring spec --send`, and the cost is said BEFORE the call.

    Ruling 2a: step 3's `--send` is authorised by the operator having run the
    verb and been told a paid call is about to happen. That sentence is here,
    before the subprocess, because after it the money is already spent.

    **`announce` is what makes that true, and it was missing.** Measured in
    the full run of 2026-08-26: emitting a step and SHOWING one are different
    acts. `Session.emit` only appends to a list; the caller rendered the list's
    last entry after this function returned — so on the run that mattered, the
    drafting call was made, the endpoint was paid, the engine refused, this
    function raised, and the sentence warning that money was about to move was
    never printed at all. Every test of it passed, because every test asked
    `session.steps` rather than asking what the operator saw.

    So the renderer is handed IN and called here, on the line before the
    subprocess. `None` keeps the library shape for a caller that only wants the
    steps.
    """
    from wringer import spec

    if (repo / spec.SPEC_FILENAME).is_file():
        # **Reusing a spec is a fact about this run, and it used to be
        # silent.** Field report 2026-08-25, finding 6: a drive that found an
        # approved spec already in the project rendered a plan with no
        # decisions block and no outcomes, and the operator had no way to know
        # they were looking at a re-render rather than at what a drafter had
        # just produced. Nothing here decides anything differently; it says
        # which files this plan is about to be built from, before it is.
        from wringer_board import interview

        sidecar = repo / interview.DECISIONS_FILENAME
        said = (
            f"Using the {spec.SPEC_FILENAME} already in this project rather "
            "than drafting a new one, so nothing is sent and nothing is spent."
        )
        if not sidecar.is_file():
            said += (
                f" {interview.DECISIONS_FILENAME} is not beside it, so the "
                "plan below cannot show what was decided without asking you, "
                "or the plain-language outcome of each task."
            )
        reused = session.emit(Step(kind=SHOW, id="spec-reused", text=said))
        if announce is not None:
            announce(reused)
        return
    drafting = session.emit(
        Step(
            kind=SHOW,
            id="drafting",
            text="Reading your document and drafting a plan from it. This "
            "sends the document to the model endpoint the project declares, "
            "which usually costs a small amount.",
        )
    )
    if announce is not None:
        # BEFORE the subprocess. After it, the money has already moved and the
        # sentence is a report rather than a warning.
        announce(drafting)
    done = run_command(
        repo,
        [engine("wring"), "spec", str(prd.relative_to(repo)), "--send", "--json"],
    )
    if done.returncode != 0:
        raise Stop(
            stop_for("", "", engine_words=(done.stderr or "").strip()), done.returncode
        )


# --- step 4: the interview --------------------------------------------------


def questions_to_ask(repo: Path) -> list[Step]:
    """One ASK per unanswered required question, in the spec's own words.

    The text is the drafter's question verbatim. This package does not rewrite
    a question to sound friendlier: the drafter asked it because it could not
    answer it, and softening it is how a PM answers a different question from
    the one that was asked.
    """
    from wringer_board import interview

    return [
        Step(
            kind=ASK,
            id=f"question:{q.id}",
            text=q.question,
            detail={"question_id": q.id},
        )
        for q in interview.unanswered(repo)
    ]


def record_answer(repo: Path, question_id: str, text: str) -> None:
    """Write one answer, through the board's own writer.

    Never a second implementation: `interview.answer` is what a person's hand
    edit is byte-compared against, and a copy here would be a second thing to
    keep in step.
    """
    from wringer_board import interview

    try:
        interview.answer(repo, question_id, text)
    except interview.InterviewError as exc:
        raise Stop(stop_for("", "", engine_words=str(exc)), exc.exit_code) from exc


# --- step 4a: read the answers back -----------------------------------------


def answers_recorded_step(repo: Path) -> Step | None:
    """Every recorded answer, beside the question it answers, or None.

    **The field report's own summary of the interview was that nothing echoed
    anything back at any point** — which is how one pasted block put line 1
    under question 6 truncated, line 2 under question 7, and the remainder
    into the approval prompt, where it declined the run. A plan was then built
    partly from answers belonging to other questions and presented as what
    would be built.

    Reading it back costs nothing and is checked against the FILE rather than
    against what this process believes it wrote: the whole failure was a
    divergence between the two, so a summary built from an in-memory copy of
    the answers would agree with itself and still be wrong.

    None when there is nothing to read back — no questions, or a spec that
    cannot be read. A step saying "here are your zero answers" is noise.
    """
    from wringer_board import interview

    try:
        questions = interview.questions(repo)
    except interview.InterviewError:
        return None
    answered = [q for q in questions if (q.answer or "").strip()]
    if not answered:
        return None
    lines = []
    for question in answered:
        lines.append(f"  {question.id}")
        lines.append(f"    you were asked: {question.question}")
        lines.append(f"    you answered:   {question.answer.strip()}")
    return Step(
        kind=SHOW,
        id="answers-recorded",
        text="These are your answers, exactly as they are recorded:\n\n"
        + "\n".join(lines),
        detail={"answers": {q.id: q.answer for q in answered}},
    )


def resume_path(repo: Path) -> Path:
    return repo / DRIVE_DIRNAME / RESUME_FILENAME


def read_resume(repo: Path) -> dict:
    """What the last run left behind, or `{}`.

    Unreadable is the same as absent, deliberately. This file makes a resumed
    run gentler; it can never make one proceed, so a corrupted one must cost
    a person nothing more than the question they were going to be asked
    anyway.
    """
    try:
        found = json.loads(resume_path(repo).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(found, dict) or found.get("schema") != RESUME_SCHEMA:
        return {}
    return found


def _write_resume(repo: Path, **fields: object) -> None:
    """Update the record, or give up quietly.

    **A write that fails may not cost somebody their run**, and this is the one
    place in this package where silence is the right answer. Everywhere else a
    swallowed failure hides something a person needed — a drained answer, a
    refusal, a skipped question. Here the entire effect of failing is *"the
    next run will not know where this one stopped"*, which is precisely the
    behaviour that shipped before this record existed. The record makes a
    resumed run gentler; it can never make one proceed, and it must never be
    the reason one dies.

    **Found by hunting, 2026-08-24, and it was a real regression.**
    `checkpoint` runs before EVERY ask, so an unwritable `.wringer/drive` — a
    full disk, a wrong-owner checkout, a stray file where the directory goes —
    turned every question in the run into a `PermissionError` traceback in
    front of a product manager. Measured in both shapes.
    """
    try:
        record = read_resume(repo)
        record["schema"] = RESUME_SCHEMA
        record.update(fields)
        path = resume_path(repo)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    except OSError:
        return


def checkpoint(repo: Path, step_id: str) -> None:
    """Record the question about to be put in front of the person.

    **Before it renders, not after it is answered** — that ordering is the
    whole mechanism. A record written after the answer knows about questions
    that were answered and nothing about the one the process died on, which
    is the only one a resume needs.
    """
    _write_resume(repo, last_question=str(step_id))


def clear_resume(repo: Path) -> None:
    """Only on a finished run. A stop LEAVES it, because a stop is exactly
    when somebody will come back."""
    try:
        resume_path(repo).unlink()
    except OSError:
        pass


def answers_digest(repo: Path) -> str | None:
    """A digest of every recorded answer, or None when there are none.

    Over the answers the READ-BACK renders, so what is digested is what the
    person was shown. Digesting the spec file instead would invalidate a
    confirmation whenever anything else in it moved, and digesting an
    in-memory copy would agree with itself — which is the divergence the
    read-back exists to catch.
    """
    import hashlib

    step = answers_recorded_step(repo)
    if step is None:
        return None
    answers = step.detail.get("answers") or {}
    canonical = json.dumps(answers, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def answers_already_confirmed(repo: Path) -> bool:
    """Whether THESE answers, unchanged, were confirmed by an earlier run."""
    digest = answers_digest(repo)
    if digest is None:
        return False
    return read_resume(repo).get("answers_confirmed_sha256") == digest


def record_answers_confirmed(repo: Path) -> None:
    _write_resume(repo, answers_confirmed_sha256=answers_digest(repo))


def resumed_step(repo: Path) -> Step | None:
    """Where the last run stopped, said out loud, or None on a first run."""
    last = read_resume(repo).get("last_question")
    if not last:
        return None
    return Step(
        kind=SHOW,
        id="resuming",
        text="This project has been driven before. The last run stopped at "
        f"'{last}', and nothing before that is being done again — your "
        "answers and the plan are already recorded. Anything that needs your "
        "permission is still asked, every time.",
        detail={"last_question": last},
    )


def answers_unchanged_step() -> Step:
    """Said instead of re-asking, so the skip is never silent.

    A question that quietly stops being asked is indistinguishable from one
    that was answered for you.
    """
    return Step(
        kind=SHOW,
        id="answers-already-confirmed",
        text="You confirmed these answers on an earlier run and none of them "
        "has changed, so they are not being read back for a second yes. "
        "Change any answer and this question comes back.",
    )


def answers_confirm_step() -> Step:
    """**Not an approval, and it must never be mistaken for one** (ruling 2).

    This asks whether the RECORD is right. Step 6 asks whether the PLAN is
    right, against a plan that does not exist yet. Answering and approving are
    different acts and one keystroke may never do both — so this deliberately
    does not mention building, and a yes here authorises nothing but reading
    on.
    """
    return Step(
        kind=CONFIRM,
        id="answers-ok",
        text="Nothing has been built and nothing has been decided yet.",
        question="Are those your answers, against the right questions? "
        "Type yes or no.",
        refusing_means="nothing is built and nothing changes. Your answers "
        "stay recorded and you can change any of them before trying again.",
    )


# --- steps 5 and 6: the plan, then the approval -----------------------------


def plan_step(repo: Path) -> Step:
    """The plain-language plan, verbatim from the board."""
    from wringer_board import interview

    try:
        text = interview.plan(repo)
    except interview.InterviewError as exc:
        raise Stop(stop_for("", "", engine_words=str(exc)), exc.exit_code) from exc
    return Step(kind=SHOW, id="plan", text=text)


def approval_step() -> Step:
    """The one question the whole interlock rests on.

    **DRIVE renders the plan and takes the answer ITSELF** (ruling 2). It does
    not subprocess `wringer-board approve`: that verb takes the CALLER's word
    that a plan was shown, so a subprocess with a captured stdout would print
    the plan into a pipe and nobody would have read anything. Composition would
    launder the interlock SPEC_BOARD §5 ruling 20 exists to protect.
    """
    return Step(
        kind=CONFIRM,
        id="approve",
        text="That is what will be built, and how each piece will be proved.",
        question="Is that what you meant? Nothing is built until you say yes. "
        "Type yes or no.",
        refusing_means="nothing is built, nothing is changed, and the plan "
        "stays where you can edit the requirements and try again.",
    )


def approve(repo: Path, *, answered_yes: bool) -> None:
    """Write `approved: true` — only on a yes, only after the plan was shown."""
    from wringer_board import interview

    if not answered_yes:
        raise Stop(
            Step(
                kind=STOPPED,
                id="stopped:not-approved",
                text="Nothing was built, because you did not approve the plan. "
                "Nothing in the project changed.",
            ),
            exit_code=0,
        )
    try:
        interview.approve(repo, read_the_plan=True)
    except interview.InterviewError as exc:
        if exc.exit_code == 0:
            return  # already approved; not an error
        raise Stop(stop_for("", "", engine_words=str(exc)), exc.exit_code) from exc


# --- step 9's second authorisation (ruling 2a) ------------------------------


def delivery_step() -> Step:
    """**A SECOND authorisation, and approving the plan did not give it.**

    Steps 3 and 9 need `--send`, which is the typed flag that lets Wringer
    contact a model or write git history — and SPEC_GRAPH ruling 5's reason is
    that *a file is not a typed flag*. A verb that passed `--send` on the
    strength of a yes given at step 6 would be a file-driven authorisation
    wearing a flag.
    """
    return Step(
        kind=CONFIRM,
        id="deliver",
        text="The work is finished and the evidence is on the board.",
        question="Shall I hand this over — create the branch and open the "
        "merge request? Type yes or no.",
        refusing_means="nothing is sent anywhere. The work and its evidence "
        "stay on this machine and you can hand it over later.",
    )


def engine(verb: str) -> str:
    """The `wring` this process should drive.

    **Beside `sys.executable` first, PATH second.** A DRIVE installed in a
    virtualenv is driving the engine installed in that same virtualenv; taking
    PATH's `wring` would silently drive a DIFFERENT install, which is the
    stale-`wring` defect this programme has already shipped once.
    """
    beside = Path(sys.executable).parent / verb
    return str(beside) if beside.is_file() else verb


def run_command(
    repo: Path, argv: list[str], env: dict | None = None
) -> subprocess.CompletedProcess:
    """One engine command, as a subprocess. Never `--send` unless told."""
    return subprocess.run(
        argv, cwd=repo, capture_output=True, text=True, check=False, env=env
    )


def run_relaying(repo: Path, argv: list[str]) -> subprocess.CompletedProcess:
    """THE LOOP INVOCATION ONLY (R4): the engine's heartbeat, relayed live.

    Every other engine call is over in moments and `run_command`'s captured
    pipes are fine. The loop runs for minutes, and capturing its stderr meant
    the operator saw nothing between "Building now" and the ending — a
    working build indistinguishable from a hung one, for as long as the
    worker's timeout. The engine's stderr lines are relayed to DRIVE's stderr
    AS THEY ARRIVE, verbatim: the engine's bytes, never a progress sentence
    of DRIVE's own. They are collected as well, so the error path still
    carries the engine's words. stdout is collected whole — it is the one
    JSON object the contract promises, untouched in both emit modes.
    """
    proc = subprocess.Popen(
        argv,
        cwd=repo,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    relayed: list[str] = []

    def pump() -> None:
        for line in proc.stderr:
            sys.stderr.write(line)
            sys.stderr.flush()
            relayed.append(line)

    pumping = threading.Thread(target=pump, daemon=True)
    pumping.start()
    out = proc.stdout.read()
    code = proc.wait()
    pumping.join(timeout=10)
    return subprocess.CompletedProcess(argv, code, stdout=out, stderr="".join(relayed))


def _json_or_stop(done: subprocess.CompletedProcess, *, allow: tuple[int, ...]) -> dict:
    """The one JSON object a `--json` verb printed, or a stop carrying its words.

    `allow` is the exit codes whose stdout is still meant to be read — a loop
    that ends red exits non-zero and has said something worth rendering, and
    treating that as a crash would throw the engine's own account away.
    """
    if done.returncode not in allow:
        raise Stop(
            stop_for("", "", engine_words=(done.stderr or done.stdout).strip()),
            done.returncode or 1,
        )
    line = (done.stdout or "").strip().splitlines()
    try:
        return json.loads(line[-1]) if line else {}
    except json.JSONDecodeError:
        # It exited as expected and printed something that is not the object
        # this asked for. That is the engine's words, verbatim — never a
        # sentence written here about what it might have meant.
        raise Stop(
            stop_for("", "", engine_words=(done.stdout or "").strip()),
            done.returncode or 1,
        ) from None


# --- step 7: install the approved gates (SPEC_DRIVE_V0 §3a) ------------------


def gate_proposal(repo: Path) -> dict:
    """What `wring plan` would like `.wringer.yaml` to have, as its own JSON.

    Read through `--json` rather than the prose report, because ruling 1
    forbids re-implementing an engine format and the report is a format.
    """
    return _json_or_stop(
        run_command(repo, [engine("wring"), "plan", "--json"]), allow=(0,)
    )


def nothing_to_install_step(proposal: dict) -> Step:
    """Why there is no diff — and there are THREE reasons, not one.

    **Found by driving a real PRD on 2026-08-19.** This branch used to say one
    sentence: *"The checks that will prove this work are already part of the
    project, so there is nothing to add."* On that run the drafter had
    proposed no binding at all — every criterion was unbound and nothing
    checked any of them — and a product manager who had just read
    "NOTHING CHECKS THIS YET" nine times in the plan was told the opposite,
    by this package, in its own words. That is not a missing sentence; it is a
    false one.

    The three cases are told apart from `wring plan`'s own JSON, never from
    the prose:

    - nothing proposed at all — `gates_proposed` and `gates_already_declared`
      both empty;
    - every proposal already declared — the case the old sentence described,
      and the only one it was true of;
    - proposals that could not be expressed as an edit to this file. The
      engine returns no diff when appending would risk a second `gates:` key,
      and it prints them in words instead. Saying "nothing to add" there would
      silently drop real checks.
    """
    fresh = tuple(proposal.get("gates_proposed") or ())
    already = tuple(proposal.get("gates_already_declared") or ())
    if fresh:
        return Step(
            kind=SHOW,
            id="gates-not-installable",
            text="Checks were proposed for this work — "
            + ", ".join(fresh)
            + " — but they could not be written into the project's settings "
            "automatically, so they have not been added. An engineer has to "
            "put them in by hand.",
            detail={"gates": list(fresh)},
        )
    if already:
        return Step(
            kind=SHOW,
            id="gates-already-installed",
            text="The checks that will prove this work — "
            + ", ".join(already)
            + " — are already part of the project, so there is nothing to add.",
            detail={"gates": list(already)},
        )
    return Step(
        kind=SHOW,
        id="gates-none-proposed",
        text="No checks were proposed for this work, so there is nothing to "
        "add. The plan above says which requirements that leaves with nothing "
        "checking them.",
    )


def gate_diff_step(proposal: dict) -> Step | None:
    """The diff itself, verbatim, or None when there is nothing to install.

    **None is not "nothing happened"** — it is one of the three cases
    `nothing_to_install_step` tells apart, and the caller says which rather
    than asking a person to approve an empty change. A yes to nothing is not
    consent.
    """
    diff = proposal.get("gate_diff") or ""
    if not diff.strip():
        return None
    return Step(
        kind=SHOW,
        id="gate-diff",
        text="Before anything is built, this adds the checks that will prove "
        "the work. This is the exact change to the project's settings:",
        engine_words=diff,
        detail={"gates": list(proposal.get("gates_proposed") or ())},
    )


# --- step 7a: a check that already passes, said BEFORE the person answers ---


def trial_step(proposal: dict) -> Step:
    """Permission to RUN the proposed checks, asked before running them.

    **The prompt this was built from said to run them without asking. That
    would have widened what this package may do, and the widening is not
    small.** A proposed `run:` string was written by a model. `.wringer.yaml`
    is the only file that puts a command in Wringer's mouth, and the only way
    into it is a person applying a diff — so executing that command *before*
    the person has approved anything would run unapproved, model-authored
    shell on their machine, and would still have run it if they then said no.

    Asking costs one keystroke and gives up nothing: the answer arrives at the
    same moment either way. So this is a separate question, and its text says
    what the trial buys.
    """
    names = ", ".join(proposal.get("gates_proposed") or ()) or "no new checks"
    return Step(
        kind=CONFIRM,
        id="try-gates",
        text=f"Those checks have not been run yet: {names}.",
        question="Shall I try them against the project as it stands, before "
        "you decide? A check that already passes cannot show the difference "
        "this work makes. Type yes or no.",
        refusing_means="they are not run, and you decide whether to add them "
        "without knowing whether any of them already passes.",
    )


def proposed_gates(repo: Path, proposal: dict) -> tuple:
    """The gates the diff would add, as the ENGINE's own parser reads them.

    **The diff is applied to a COPY, in a temporary directory, and read back
    with `config.load`.** Not parsed here: the diff is an engine format and
    ruling 1 forbids re-implementing one. Not applied to the real file: the
    person has not approved anything yet, and a verb that edited their config
    to answer its own question would have already done the thing it is asking
    about.

    Empty on any failure — an unapplyable diff, a config the loader refuses.
    The caller says so out loud rather than treating silence as "all clear",
    because a trial that quietly did not happen is worse than no trial.
    """
    import tempfile

    from wringer import config, spec

    diff = proposal.get("gate_diff") or ""
    fresh = set(proposal.get("gates_proposed") or ())
    source = repo / config.CONFIG_FILENAME
    if not diff.strip() or not fresh or not source.is_file():
        return ()
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / config.CONFIG_FILENAME
        copy.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
        # **The spec travels with it.** `config.load` refuses a config whose
        # gates bind to criteria with no `wringer.spec.yaml` beside them —
        # correctly, and it is the whole point of a binding — so a copy of
        # only the config would be refused for a reason that is an artifact of
        # copying. Found by running this, not by reading it.
        beside = repo / spec.SPEC_FILENAME
        if beside.is_file():
            (Path(tmp) / spec.SPEC_FILENAME).write_text(
                beside.read_text(encoding="utf-8"), encoding="utf-8"
            )
        done = subprocess.run(
            ["git", "apply", "--whitespace=nowarn", "-"],
            cwd=tmp,
            input=diff,
            capture_output=True,
            text=True,
            check=False,
        )
        if done.returncode != 0:
            return ()
        try:
            loaded = config.load(copy)
        except config.ConfigError:
            return ()
    return tuple(gate for gate in loaded.gates if gate.id in fresh)


def already_passing(repo: Path, gates: tuple) -> tuple[str, ...]:
    """Which of those checks passes against the tree as it stands.

    Run only after a yes. A check that times out or cannot start is NOT
    counted as passing: the claim being made is "this passed today", and the
    honest answer to an unknown is not a claim.
    """
    green = []
    for gate in gates:
        try:
            done = subprocess.run(
                gate.run,
                shell=True,
                cwd=repo,
                capture_output=True,
                text=True,
                check=False,
                timeout=gate.timeout,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if done.returncode == 0:
            green.append(gate.id)
    return tuple(green)


def trial_result_step(tried: tuple, green: tuple[str, ...]) -> Step:
    """What the trial found, with the meaning in the board's words.

    DRIVE says which checks ran and which passed — those are measurements, and
    naming a check is something this package already does. What a green one
    MEANS is a sentence about a gate, so it comes from
    `refusals.say(GATE_AT_INSTALL, ...)` verbatim, like every other.
    """
    from wringer_board import refusals

    if not tried:
        return Step(
            kind=SHOW,
            id="gates-not-tried",
            text="Those checks could not be run here, so nothing is known "
            "about whether any of them already passes.",
        )
    ran = ", ".join(gate.id for gate in tried)
    if not green:
        return Step(
            kind=SHOW,
            id="gates-tried",
            text=f"I ran them against the project as it stands: {ran}. None "
            "of them passes today.",
            detail={"tried": [gate.id for gate in tried], "already_passing": []},
        )
    saying = refusals.say(refusals.GATE_AT_INSTALL, "born-green")
    return Step(
        kind=SHOW,
        id="gates-tried",
        text=f"I ran them against the project as it stands: {ran}. "
        + ", ".join(green)
        + " — "
        + saying.sentence,
        question=saying.question,
        detail={"tried": [gate.id for gate in tried], "already_passing": list(green)},
    )


def gate_approval_step(proposal: dict) -> Step:
    """The second interlock §3a rests on, asked after the diff was rendered."""
    names = ", ".join(proposal.get("gates_proposed") or ()) or "no new checks"
    return Step(
        kind=CONFIRM,
        id="install-gates",
        text=f"That change adds: {names}.",
        question="Shall I add those checks to the project? Type yes or no.",
        refusing_means="the project's settings are left exactly as they are, "
        "and nothing is built.",
    )


def install_gates(repo: Path, proposal: dict, *, answered_yes: bool) -> bool:
    """Apply the rendered diff, and only it. §3a's four conditions.

    **`git apply`, not a writer of this package's own.** The diff `wring plan`
    printed IS the hand edit — `spec.gate_diff`'s own docstring says the `a/`
    and `b/` prefixes are there so `git apply` accepts it as-is. Applying it
    moves exactly the bytes the person read; a YAML round-trip here would
    reformat the file, drop every comment, and make byte-equality a fiction.

    Returns whether anything was installed.
    """
    diff = proposal.get("gate_diff") or ""
    if not diff.strip():
        return False
    if not answered_yes:
        raise Stop(
            Step(
                kind=STOPPED,
                id="stopped:gates-declined",
                text="Nothing was built, because the checks that would prove "
                "the work were not added. Nothing in the project changed.",
            ),
            exit_code=0,
        )
    done = subprocess.run(
        ["git", "apply", "--whitespace=nowarn", "-"],
        cwd=repo,
        input=diff,
        capture_output=True,
        text=True,
        check=False,
    )
    if done.returncode != 0:
        raise Stop(
            stop_for("", "", engine_words=(done.stderr or "").strip()), done.returncode
        )
    return True


# --- step 8: the build loop -------------------------------------------------


def build_steps(repo: Path) -> list[Step]:
    """Run the loop, and say how it ended in the board's words.

    **Progress reaches the operator as steps, never as a bar** (§4): a
    percentage nothing measures is a number this package would be inventing,
    and inventing numbers is the whole thing it exists not to do.

    The ending is rendered through `refusals.say(LOOP_ENDING, ...)`, so an
    `environment` stop is a card like any other. F6's tiers are the ENGINE's
    to decide and this never widens one: it renders the reason it was given.
    """
    started = Step(
        kind=SHOW,
        id="building",
        text="Building now. This runs your project's own checks, hands each "
        "failure to your coding agent, and runs them again — for as many "
        "attempts as the project allows.",
    )
    outcome = _json_or_stop(
        run_relaying(repo, [engine("wring"), "run", "--json"]), allow=(0, 1)
    )
    reason = str(outcome.get("reason") or "")
    from wringer_board import refusals

    ending = stop_for(refusals.LOOP_ENDING, reason)
    # R1: `no_progress` cannot say whether the worker tried and failed or
    # never engaged at all. When the engine diagnosed the latter, its own
    # sentence rides along as `engine_words` — the board's mapped sentence
    # for the ending stays byte-identical, and this package still writes
    # nothing of its own.
    return [
        started,
        Step(
            kind=SHOW if outcome.get("status") == "converged" else STOPPED,
            id=f"build:{reason or 'unknown'}",
            text=ending.text,
            question=ending.question,
            engine_words=_worker_words(outcome) or ending.engine_words,
            detail={
                "iterations": outcome.get("iterations"),
                "loop": outcome.get("loop_dir"),
            },
        ),
    ]


def _worker_words(outcome: dict) -> str | None:
    """The engine's own account of a worker turn that did nothing, verbatim.

    Read off `wring run --json`'s `worker_diagnosis` — the same object the
    `worker-diagnosis.json` sibling carries, so the console, the record and
    this surface cannot disagree. Every string here is the ENGINE's; nothing
    is composed, and the remedy names the operator's channel without naming
    a variable, because the engine's does.
    """
    found = outcome.get("worker_diagnosis")
    if not isinstance(found, dict):
        return None
    said = [str(found.get(key) or "").strip() for key in ("description", "remedy")]
    return ". ".join(part for part in said if part) or None


def latest_refusal_step(repo: Path, engine_words: str) -> Step:
    """The engine's refusal, in the board's words — ruling 3's three branches.

    The record is the ONLY place the "which no" lives: `wring deliver` exits
    with a code and prints prose, and 23 different refusals share that code.
    `deliver.record_refusal` writes the name; `read.latest_refusal` finds it;
    `refusals.say` is the one place a sentence for it may come from.

    **A missing or unreadable record is branch 3, not a guess.** If the record
    cannot be read there is no named value, and inventing one from the prose
    would be this package deciding what the engine meant.
    """
    from wringer_board import read, refusals

    record = read.latest_refusal(repo)
    if record is None:
        return stop_for("", "", engine_words=engine_words)
    try:
        payload = json.loads(record.read_text(encoding="utf-8"))
        reason = str(payload["reason"])
    except (OSError, ValueError, KeyError):
        return stop_for("", "", engine_words=engine_words)
    return stop_for(refusals.DELIVERY_REFUSAL, reason, engine_words=engine_words)


def delivery_plan(repo: Path) -> dict:
    """What delivery WOULD do, without `--send`. Ruling 2a's first half.

    A refusal here is the common ending, not the exceptional one: the engine
    refuses a handover it cannot evidence, and that refusal is the product
    working. It is rendered, never resolved.
    """
    done = run_command(repo, [engine("wring"), "deliver", "--json"])
    if done.returncode != 0:
        raise Stop(
            latest_refusal_step(repo, (done.stderr or done.stdout).strip()),
            done.returncode,
        )
    return _json_or_stop(done, allow=(0,))


def deliver(repo: Path, *, answered_yes: bool) -> dict:
    """`--send`, and ONLY on a second yes given against the rendered board.

    Ruling 2a: the approval at step 6 was about what would be BUILT. This is
    about writing git history and opening a merge request, which is a
    different act about a different thing, and one yes may not cover both.
    """
    if not answered_yes:
        raise Stop(
            Step(
                kind=STOPPED,
                id="stopped:not-delivered",
                text="Nothing was sent anywhere. The work and its evidence "
                "stay on this machine, and you can hand it over later.",
            ),
            exit_code=0,
        )
    done = run_command(repo, [engine("wring"), "deliver", "--send", "--json"])
    if done.returncode != 0:
        raise Stop(
            latest_refusal_step(repo, (done.stderr or done.stdout).strip()),
            done.returncode,
        )
    return _json_or_stop(done, allow=(0,))


# --- step 10: the board -----------------------------------------------------


BOARD_FILENAME = "board.html"


def _keep_the_board_out_of_git(repo: Path) -> None:
    """Ignore the page this verb writes, for `wring init`'s exact reason.

    **The whole chain stops here otherwise, and it was measured stopping.**
    2026-08-26, driving a project whose `.gitignore` had no line for this
    file: the board is rendered BEFORE the loop, so every verify records it in
    `untracked.json`; it is rendered again after the loop, because showing the
    result is what it is for; and `wring deliver` then refuses —

        board.html is not what 20260826-085344-3cb5 verified — its contents,
        its file mode or its symlink target has changed

    — which is a correct refusal about a file that is not the operator's work
    and never was. The handover cannot complete, and no message anywhere says
    why a page Wringer wrote is holding it up. The shipped example only
    escapes because its `.gitignore` was written with this line in it, and no
    repository a product manager starts from has one.

    `wring init` already keeps `.wringer/` out of git and prints that it did,
    for the same reason in the same words: what Wringer writes is not the
    project's. This is that rule applied to the one file it writes outside
    that directory. It cannot live in `wring init` — the engine may not
    import this package, and the name belongs to this one — and it is here
    rather than in `generate_workspace` so that a project set up before this
    existed is also carried, rather than only a new one.

    Idempotent, and it never rewrites a line somebody else put there.

    **Two things it will not do, both found by hunting it on the day it was
    written.** It writes nothing into a directory with no git in it —
    `wring init` calls that litter and refuses for the same reason. And it
    leaves a repository alone where somebody has written `!board.html`: git is
    last-match-wins, so appending after a negation silently overrules an
    operator who deliberately chose to track this file. If they did, the
    delivery refusal downstream is a true statement about their own choice,
    and overriding them to avoid it would be the worse act.
    """
    from wringer import git

    if not git.is_repo(repo):
        return
    gitignore = repo / ".gitignore"
    try:
        existing = gitignore.read_text(encoding="utf-8") if gitignore.is_file() else ""
        tokens = existing.split()
        if BOARD_FILENAME in tokens or f"!{BOARD_FILENAME}" in tokens:
            return
        separator = "" if existing.endswith("\n") or not existing else "\n"
        gitignore.write_text(
            f"{existing}{separator}\n# Wringer's own page, not your project's\n"
            f"{BOARD_FILENAME}\n",
            encoding="utf-8",
        )
    except OSError:
        # A repo whose `.gitignore` cannot be written is not a reason to stop
        # the run; the delivery refusal downstream says its own piece.
        return


def render_board(repo: Path) -> Path:
    """One page a person can read. The last thing the verb does, win or lose."""
    _keep_the_board_out_of_git(repo)
    done = run_command(
        repo,
        [engine("wringer-board"), "render", str(repo), "-o", BOARD_FILENAME],
    )
    if done.returncode != 0:
        raise Stop(
            stop_for("", "", engine_words=(done.stderr or "").strip()), done.returncode
        )
    return repo / BOARD_FILENAME


def board_step(board_path: Path) -> Step:
    return Step(
        kind=SHOW,
        id="board",
        text=f"The page showing what is done, what is proved, and what still "
        f"needs you is at {board_path.name}.",
        detail={"board": str(board_path)},
    )


def final_step(repo: Path, board_path: Path) -> Step:
    return Step(
        kind=DONE,
        id="done",
        text=f"Open {board_path} to see what is done, what is proved, and "
        "what still needs you.",
        detail={"board": str(board_path)},
    )
