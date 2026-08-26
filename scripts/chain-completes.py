"""Drive the WHOLE chain against an installed Wringer, and refuse if it stops.

**Why this exists.** Until 2026-08-26 no window had ever run the whole machine.
Run 3B stopped at the pen deliberately, F4-at-scale used shell-script workers on
one slice, run 5 died at the build. Every field report since has been a product
manager discovering whole-chain breakage that a ten-minute complete run would
have caught first. This is that ten-minute run, wired into the release bar, so
"the machine completes" is a thing checked on every release rather than a thing
discovered by whoever tries it next.

**What it proves, and what it deliberately does not.** It proves the CHAIN
completes: a document goes in, every interlock asks, the loop converges on a
red check going green, and a delivered branch lands on a remote with the work
in it. It does NOT prove a language model drafts a good spec or that a coding
agent can build anything — both of those cost money and neither is
deterministic, so both stay a manual run. The two paid seams are stood in for:

- the drafter, by a spec written through the ENGINE's own `spec.render`, so no
  hand-typed YAML is ever parsed by the thing that would have written it;
- the coding agent, by a shell worker — a script that makes the red check go
  green, which is exactly the shape `run.worker` supports for a non-ACP agent.

Nothing here reaches the network, and nothing here needs a key.

**It answers on stdin the way a person does**, one line after each question is
rendered, because `wringer-drive` drains anything that was already waiting: a
pre-piped `yes` is an approval nobody gave, and this script must not be able to
give one either. That is why it is a driver and not a heredoc.

    python3 chain-completes.py --bin <venv/bin> --work <scratch dir>

Prints one line per stage and exits non-zero at the first stage that does not
happen.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import threading
from pathlib import Path

# Every step the chain MUST put in front of the operator, in order. Named here
# rather than discovered, for `_wring`'s reason in doctor: a list derived from
# what happened could never notice something that stopped happening. If a step
# id changes, this fails and somebody decides whether the change was intended.
REQUIRED_STEPS = (
    "prd-copied",       # the document is brought inside
    "spec-reused",      # no drafting call — this run spends nothing
    "plan",             # what will be built, and how each piece is proved
    "approve",          # and nothing is built until a person says yes
    "gate-diff",        # the exact change to the project's settings
    "try-gates",        # ... offered against the project as it stands
    "gates-tried",      # ... and run, so a green-already check is visible
    "install-gates",
    "building",
    "board",
    "deliver",          # the second answer; the approval above did not buy it
    "done",
)

# What each question is answered with. A `confirm` this script cannot name is
# NOT answered `yes` by a fallback: an unknown gate would be approved by a
# script, which is the one thing the whole consent surface exists to prevent.
ANSWERS = {
    "approve": "yes",
    "try-gates": "yes",
    "install-gates": "yes",
    "deliver": "yes",
}


def shout(message: str) -> None:
    print(message, flush=True)


def build_fixture(work: Path, binaries: Path) -> Path:
    """A project with a red check, a worker that can turn it green, and a
    bare origin for the handover to land on."""
    project = work / "project"
    origin = work / "origin.git"
    project.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", "--bare", str(origin)], check=True)
    subprocess.run(["git", "init", "-q", "-b", "main", "."], cwd=project, check=True)
    for key, value in (
        ("user.email", "chain@example.invalid"),
        ("user.name", "chain check"),
        ("commit.gpgsign", "false"),
    ):
        subprocess.run(["git", "config", key, value], cwd=project, check=True)
    subprocess.run(
        ["git", "remote", "add", "origin", str(origin)], cwd=project, check=True
    )

    # The thing to be built: a function that does not exist yet, and a check
    # that says so. `check.sh` is the acceptance check the plan will bind to.
    (project / "calc.py").write_text("def add(a, b):\n    return a + b\n")
    (project / "check.sh").write_text(
        "#!/bin/sh\n# The acceptance check: subtraction must exist and work.\n"
        "grep -q 'def subtract' calc.py || exit 1\n"
        "python3 -c \"import calc; raise SystemExit(0 if calc.subtract(3,1)==2 "
        "else 1)\"\n"
    )
    (project / "check.sh").chmod(0o755)

    # The worker: a shell script standing in for the coding agent. It is
    # handed the brief path exactly as a real string worker is, and ignores it
    # — this check is about the chain, not about comprehension.
    (project / "worker.sh").write_text(
        "#!/bin/sh\n# Stands in for the coding agent. Makes the red check green.\n"
        "set -eu\n"
        "grep -q 'def subtract' calc.py && exit 0\n"
        "printf '\\n\\ndef subtract(a, b):\\n    return a - b\\n' >> calc.py\n"
    )
    (project / "worker.sh").chmod(0o755)

    (project / ".wringer.yaml").write_text(
        "version: 1\n"
        "gates:\n"
        "  - id: unit\n"
        '    run: "python3 -c \\"import calc; assert calc.add(1,2)==3\\""\n'
        "    timeout: 60\n"
        "\n"
        # `judge:` must be present — three steps of the chain refuse without
        # it — and is never called: every criterion here is proved by a gate.
        # The endpoint is a closed port on purpose, so a run that DID try to
        # send would fail loudly rather than quietly cost somebody money.
        "judge:\n"
        "  endpoint: http://127.0.0.1:1/v1/chat/completions\n"
        "  model: none\n"
        "  rubric: wringer.rubric.yaml\n"
        "\n"
        "run:\n"
        '  worker: "sh ./worker.sh {brief}"\n'
        "  max_iterations: 2\n"
        "\n"
        "deliver:\n"
        '  branch: "wringer/{run}"\n'
    )

    # The spec, written through the ENGINE's own renderer rather than typed by
    # hand. A fixture written on the same side of the seam as its reader has
    # cost this programme two live defects; this one cannot drift from the
    # parser, because the parser's own package produced it.
    #
    # Rendered by the INSTALLED interpreter, not this one: importing the
    # installed package into whatever `python3` happens to be on PATH picks up
    # a different Python entirely (measured here: macOS's 3.9, which cannot
    # even import `evidence`). The package under test writes its own fixture.
    authoring = (
        "from wringer import config, spec\n"
        "drafted = spec.Spec(\n"
        "    approved=False,\n"
        '    title="Subtraction",\n'
        '    intent="A caller can subtract two numbers.",\n'
        "    questions=(),\n"
        "    criteria=(spec.Criterion(\n"
        '        id="subtracts", title="It subtracts two numbers",'
        " required=True),),\n"
        "    gates=(),\n"
        '    tasks=(spec.Task(id="build", brief="briefs/build.md",\n'
        '        objective="Add a subtract function to calc.py."),),\n'
        '    path="wringer.spec.yaml",\n'
        ")\n"
        "open('wringer.spec.yaml','w').write(spec.render(drafted))\n"
        "open('wringer.gates.yaml','w').write(spec.render_gatespec(\n"
        "    [config.Gate(id='acceptance-subtracts', run='sh ./check.sh',\n"
        "                 proves='subtracts')]))\n"
    )
    subprocess.run(
        [str(binaries / "python"), "-c", authoring], cwd=project, check=True
    )
    (project / "PRD.md").write_text(
        "We need to be able to subtract two numbers, not only add them.\n"
    )
    subprocess.run(["git", "add", "-A"], cwd=project, check=True)
    subprocess.run(["git", "commit", "-qm", "base"], cwd=project, check=True)
    subprocess.run(["git", "push", "-q", "origin", "main"], cwd=project, check=True)
    return project


def _drive_source(binaries: Path) -> str:
    """The source of the module whose step ids this script names.

    **Asked of the interpreter, not guessed from the directory layout.** A
    `site-packages` derived from `<bin>/../lib` is right for a wheel and wrong
    for an editable install, where the package lives in a source tree behind a
    `.pth` and that directory holds no `wringer_drive` at all. Guessing would
    make this check report "no step emits X" about a perfectly good install —
    a confident false report of a broken chain, which is the shape this whole
    window kept finding.
    """
    found = subprocess.run(
        [str(binaries / "python"), "-c",
         "import wringer_drive.run as m; print(m.__file__)"],
        capture_output=True, text=True,
    )
    if found.returncode != 0 or not found.stdout.strip():
        raise SystemExit(
            f"chain: the installed package cannot import wringer_drive.run: "
            f"{found.stderr.strip()}"
        )
    return Path(found.stdout.strip()).read_text(encoding="utf-8")


def drive(
    project: Path, binaries: Path, transcript: Path, answers: dict | None = None
) -> tuple[int, list[dict]]:
    """Answer the chain the way a person does: one line, after the question."""
    answers = ANSWERS if answers is None else answers
    env = dict(os.environ, PATH=f"{binaries}:{os.environ.get('PATH', '')}")
    proc = subprocess.Popen(
        [str(binaries / "wringer-drive"), "run", "PRD.md", "--repo", ".",
         "--emit", "json"],
        cwd=project, env=env,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, bufsize=1,
    )
    log = transcript.open("w", encoding="utf-8", buffering=1)
    threading.Thread(
        target=lambda: [log.write("[stderr] " + line) for line in proc.stderr],
        daemon=True,
    ).start()

    seen: list[dict] = []
    for line in proc.stdout:
        if not line.strip():
            continue
        log.write(line)
        try:
            step = json.loads(line)
        except json.JSONDecodeError:
            continue
        seen.append(step)
        if step.get("kind") not in ("ask", "confirm"):
            continue
        answer = answers.get(step.get("id"))
        if answer is None:
            # An unnamed question is not answered. A script that said `yes` to
            # something nobody listed would be approving on a person's behalf.
            log.write(f"[chain] UNANSWERED question {step.get('id')!r}\n")
            proc.stdin.close()
            break
        log.write(f"[chain] {step['id']} <- {answer}\n")
        proc.stdin.write(answer + "\n")
        proc.stdin.flush()
    code = proc.wait()
    log.close()
    return code, seen


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bin", required=True, help="the installed venv's bin")
    parser.add_argument("--work", required=True, help="a scratch directory")
    args = parser.parse_args()
    binaries = Path(args.bin).resolve()
    work = Path(args.work).resolve()
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    # **The hand-kept list, checked against the thing it names.** Every id
    # above must be one the installed package can actually emit, or a rename
    # turns this check into a confident false report of a chain that stopped.
    # That failure class has been live in this repository before, in
    # `_clear_previous`, and it is cheap to close here.
    source = _drive_source(binaries)
    unknown = [
        step for step in REQUIRED_STEPS
        if f'id="{step}"' not in source and step != "done"
    ]
    if unknown:
        shout(f"  FAIL  no step in the installed package emits: {unknown}")
        return 1

    project = build_fixture(work, binaries)
    transcript = work / "transcript.jsonl"
    code, seen = drive(project, binaries, transcript)

    failures = []
    ids = [step.get("id") for step in seen]
    for wanted in REQUIRED_STEPS:
        if wanted in ids:
            shout(f"  ok    the chain reached {wanted}")
        else:
            shout(f"  FAIL  the chain never reached {wanted}")
            failures.append(wanted)

    # The red trial is the claim this project is built on, so it is checked
    # rather than assumed: the acceptance check must have been RED before the
    # work, or a green at the end proves nothing at all.
    tried = next((s for s in seen if s.get("id") == "gates-tried"), None)
    if tried and not tried.get("detail", {}).get("already_passing"):
        shout("  ok    the acceptance check was red before the work")
    else:
        shout("  FAIL  the acceptance check was not proved red first")
        failures.append("red-first")

    # And the handover actually landed, on the REMOTE, with the work in it.
    origin = work / "origin.git"
    branches = subprocess.run(
        ["git", "branch", "--list", "wringer/*"],
        cwd=origin, capture_output=True, text=True,
    ).stdout.split()
    if branches:
        shout(f"  ok    a delivered branch is on the remote: {branches[0]}")
        content = subprocess.run(
            ["git", "show", f"{branches[0]}:calc.py"],
            cwd=origin, capture_output=True, text=True,
        ).stdout
        if "def subtract" in content:
            shout("  ok    the delivered branch carries the work")
        else:
            shout("  FAIL  the delivered branch does not carry the work")
            failures.append("delivered-content")
    else:
        shout("  FAIL  no delivered branch reached the remote")
        failures.append("delivered-branch")

    shout(f"  drive exited {code}; transcript at {transcript}")

    # --- run 5's two death scenarios, which nothing checked either ----------
    #
    # Both were fixed at the renderer and parser level in 0.4.7 and neither had
    # been driven through the verb a person types until 2026-08-26. They are
    # here because they are free — no key, no worker turn, no model call — and
    # because this project has now lost two field runs to them.
    failures += _second_drive_reuses_the_spec(work, binaries)
    failures += _a_spec_without_its_sidecar_says_so(work, binaries)

    if failures:
        shout(f"chain: STOPPED at {', '.join(failures)}")
        return 1
    shout("chain: the machine completed, end to end")
    return 0


def _second_drive_reuses_the_spec(work: Path, binaries: Path) -> list[str]:
    """Re-driving a project that has already been driven.

    Run 5 met a re-drive that drafted again, unbound its own gate, and rendered
    a plan comparing a gate to itself. What must happen instead: the spec on
    disk is REUSED and said to be reused, nothing is spent, and a binding
    already installed is not proposed a second time.
    """
    shout("")
    shout("== the same project, driven again ==")
    _, seen = drive(
        work / "project", binaries, work / "transcript-again.jsonl"
    )
    ids = [step.get("id") for step in seen]
    failures = []
    for wanted in ("spec-reused", "plan"):
        if wanted in ids:
            shout(f"  ok    the second drive reached {wanted}")
        else:
            shout(f"  FAIL  the second drive never reached {wanted}")
            failures.append(f"again:{wanted}")
    reused = next((s for s in seen if s.get("id") == "spec-reused"), None)
    if reused and "nothing is spent" in reused.get("text", ""):
        shout("  ok    it says nothing was sent and nothing was spent")
    else:
        shout("  FAIL  a re-drive did not say it was reusing the spec")
        failures.append("again:not-said")
    if "gate-diff" in ids:
        shout("  FAIL  a gate already installed was proposed again")
        failures.append("again:gate-unbound")
    else:
        shout("  ok    the installed check was not proposed a second time")
    return failures


def _a_spec_without_its_sidecar_says_so(work: Path, binaries: Path) -> list[str]:
    """A spec carried into a project without `wringer.decisions.yaml`.

    The decisions a drafter took instead of asking live in a sidecar. Move the
    spec without it — a copy, a fresh clone, a colleague's branch — and the plan
    cannot show them. Run 5 met a plan that simply had no decisions block and
    said nothing about why, which reads exactly like a drafter that decided
    nothing. The absence has to be NAMED, in the step stream a person sees.
    """
    shout("")
    shout("== a spec carried across without its sidecar ==")
    second = work / "nosidecar"
    project = build_fixture(second, binaries)
    source = work / "project"
    for name in ("wringer.spec.yaml", "wringer.gates.yaml", "wringer.rubric.yaml"):
        if (source / name).is_file():
            (project / name).write_text(
                (source / name).read_text(encoding="utf-8"), encoding="utf-8"
            )
    (project / "wringer.decisions.yaml").unlink(missing_ok=True)
    subprocess.run(["git", "add", "-A"], cwd=project, check=True)
    subprocess.run(
        ["git", "commit", "-qm", "the spec, without its sidecar"],
        cwd=project, check=True,
    )

    # Declined at the approval: this scenario is about what the plan SAYS, and
    # building it again would spend a worker turn to learn nothing.
    _, seen = drive(
        project, binaries, work / "transcript-nosidecar.jsonl",
        answers={"approve": "no"},
    )

    # **Two surfaces, checked separately, and the first version of this check
    # did not.** It searched every step's text for the filename and passed with
    # the `spec-reused` sentence deleted, because the PLAN names the sidecar
    # too — a guard green for the wrong reason, caught by reverting the fix it
    # was meant to hold. They are different renderers and either can go silent
    # on its own.
    failures = []
    for step_id, what in (
        ("spec-reused", "the step stream says the sidecar is missing"),
        ("plan", "the plan says so where the decisions would have been"),
    ):
        step = next((s for s in seen if s.get("id") == step_id), None)
        if step and "wringer.decisions.yaml" in step.get("text", ""):
            shout(f"  ok    {what}")
        else:
            shout(f"  FAIL  {what} — it does not")
            failures.append(f"nosidecar:{step_id}")
    return failures


if __name__ == "__main__":
    raise SystemExit(main())
