"""Guards on the documents and scripts that are meant to be run literally.

`SETUP.md` is not prose about how installation might go — it is a runbook an
agent is instructed to follow verbatim, one command at a time. A wrong
command in it is a defect of the same class as a wrong line of code, and it
is one that no unit test, review or type checker ever catches: the only thing
that finds it is a human or an agent running the runbook on a real machine.

Two field runs have now done exactly that (`docs/field-report-2026-08-04` in
history, `docs/field-report-2026-08-05.md` in the repo), and both reported
the same shape of finding: *a step whose gate had never been executed*. These
tests are the cheap half of the answer. They cannot prove a command works —
that needs the machine, and `docs/MANUAL_CHECKS.md` records those — but they
can prove a command that was measured to be wrong never comes back.

The field reports themselves are excluded from every guard here. They are
preserved verbatim as primary evidence, and their transcripts of the broken
commands are the whole point of keeping them.
"""

from __future__ import annotations

import datetime
import os
import re
from pathlib import Path

import pytest


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def require_checkout(*needed: str) -> None:
    """Skip when a repo-only artifact is absent.

    The sdist ships the package and its suite, not the repository's scripts,
    workflows or runbooks. Guards over those are meaningful in a checkout and
    meaningless in a tarball, and failing there would tell a packager their
    download is broken when it is not.
    """
    for relative in needed:
        if not (repo_root() / relative).exists():
            pytest.skip(f"{relative} is not part of the distribution")


RUNBOOKS = ("SETUP.md", "QUICKSTART.md", "README.md")


def runbook_text(name: str) -> str | None:
    path = repo_root() / name
    return path.read_text(encoding="utf-8") if path.is_file() else None


def code_blocks(text: str) -> list[str]:
    """Every fenced block, whatever its language tag."""
    return re.findall(r"```[^\n]*\n(.*?)```", text, re.DOTALL)


def bash_blocks(text: str) -> list[str]:
    """Only the ```bash blocks — the lines a reader is told to type.

    These runbooks use the tag deliberately: a ```bash fence is an
    instruction, and an untagged fence is a transcript of what happened when
    someone ran one. The distinction matters to these guards, because
    documenting a command that fails means *showing* it failing, and a guard
    that cannot tell the two apart forbids explaining the bug it enforces.
    """
    return re.findall(r"```bash\s*\n(.*?)```", text, re.DOTALL)


# --- AC-01: `container images` is not a subcommand ------------------------
#
# Apple `container` 1.2.0 names it `image`, singular (alias `i`). The plural
# fails two different ways, and the second is the dangerous one:
#
#   container images pull …   → Error: Plugin 'container-images' not found.
#                               exit 64, and the error sends the reader
#                               hunting for a missing plugin — wrong diagnosis
#   container images list | grep wringer
#                             → exit 1, NO output and NO error, because the
#                               error went to stderr and the pipe ate the
#                               difference between "not pulled" and "wrong
#                               command"
#
# That silence is why this needs a test rather than a careful proofreader: an
# agent following the runbook cannot tell the two apart, and the runbook's own
# stop condition ("stop if output does not match") never fires.


@pytest.mark.parametrize("name", RUNBOOKS)
def test_no_runbook_tells_you_to_run_container_images(name: str):
    """The plural, in a block a reader is meant to type. Prose may still
    *name* it — the corrected runbook warns about it on purpose, and a
    warning that cannot spell the wrong command is not a warning."""
    text = runbook_text(name)
    if text is None:
        pytest.skip(f"{name} is not in this repo")
    offenders = [
        line.strip()
        for block in code_blocks(text)
        for line in block.splitlines()
        if "container images" in line
    ]
    assert not offenders, (
        f"{name} tells a reader to run `container images`, which is not a "
        "subcommand — Apple `container` spells it `image`, singular. "
        f"Offending lines: {offenders}"
    )


@pytest.mark.parametrize("name", RUNBOOKS)
def test_no_runbook_spells_the_two_measured_failures_anywhere(name: str):
    """The two exact forms a field run watched fail, in prose or in code.
    There is no context in which either is the right thing to write down."""
    text = runbook_text(name)
    if text is None:
        pytest.skip(f"{name} is not in this repo")
    for wrong in ("container images pull", "container images list"):
        assert wrong not in text, (
            f"{name} contains `{wrong}`, measured to fail on Apple "
            "`container` 1.2.0 (field report 2026-08-05, AC-01). The "
            "subcommand is `image`, singular."
        )


# --- R2-02: `ls -la` cannot show the thing it was sent to look at ---------
#
# SETUP.md told the reader to check for a stripped Docker.app stub with
# `ls -la`. On the machine that has the stub, that is precisely the command
# the stub defeats:
#
#   $ ls -la /Applications/Docker.app  →  ls: Permission denied
#   $ ls -ld /Applications/Docker.app  →  d---------  2 root  admin  64 ...
#
# A diagnostic that fails in exactly the case it diagnoses is worse than no
# diagnostic: the reader concludes something is wrong with their permissions
# rather than reading the answer, which is right there under -d.


@pytest.mark.parametrize("name", RUNBOOKS)
def test_no_runbook_inspects_docker_app_with_ls_la(name: str):
    text = runbook_text(name)
    if text is None:
        pytest.skip(f"{name} is not in this repo")
    # Any `ls` at all on that path, then judged on its flags — rather than
    # matching the literal `-la`, which `ls -l -a` and `ls -al` both escape.
    # `-d` is what makes the listing work; an `a` is what makes it fail.
    offenders = []
    for block in bash_blocks(text):
        for line in block.splitlines():
            match = re.search(
                r"\bls\s+((?:-\S+\s+)*)/Applications/Docker\.app", line
            )
            if match is None:
                continue
            flags = match.group(1)
            if "a" in flags or "d" not in flags:
                offenders.append(line.strip())
    assert not offenders, (
        f"{name} inspects the Docker.app stub with a listing its own stripped "
        "permissions defeat (field report 2026-08-05, R2-02). Only `ls -ld` "
        f"can show it. Offending lines: {offenders}"
    )


@pytest.mark.parametrize("name", RUNBOOKS)
def test_a_runbook_that_mentions_the_docker_stub_shows_how_to_see_it(name: str):
    """The positive half. Forbidding `ls -la` is only half a fix if the
    replacement quietly disappears in a later edit."""
    text = runbook_text(name)
    if text is None or "/Applications/Docker.app" not in text:
        pytest.skip(f"{name} does not discuss the Docker.app stub")
    assert "ls -ld /Applications/Docker.app" in text, (
        f"{name} discusses the Docker.app stub but never shows `ls -ld "
        "/Applications/Docker.app`, the only listing the stub's stripped "
        "permissions do not defeat."
    )


# --- R2-05: no script may be addressed to one developer's machine ---------
#
# Five scripts in scripts/ defaulted their scratch tree to
# /private/tmp/claude-501/-Users-marc-Claude/… — a sandbox path named after
# one machine and one user — and three of them point `rm -rf` or `find
# -delete` at it. On any other machine that either fails or, worse, deletes
# something that happens to be there.
#
# This is the cheapest possible test against the most embarrassing possible
# regression, and it is permanent: the next hardcoded sandbox path cannot
# reach main.

# The sandbox this repo is developed in, in both spellings it appears as.
_DEVELOPER_PATHS = (
    re.compile(r"claude-50[0-9]"),
    re.compile(r"-Users-[A-Za-z0-9]+-"),
    re.compile(r"/Users/(?!you\b)[A-Za-z0-9._-]+/"),
)


def script_files() -> list[Path]:
    """Every script, not just the shell ones — scripts/ holds Python too, and
    a hardcoded path is no less hardcoded for being in a .py file."""
    scripts = repo_root() / "scripts"
    return sorted([*scripts.glob("*.sh"), *scripts.glob("*.py")])


def test_scripts_exist_to_be_guarded():
    """A guard over an empty glob passes and means nothing.

    Skipped rather than failed when scripts/ is absent entirely: the sdist
    does not ship the repository's shell scripts, and a packager running the
    packed suite must not fail over a developer tool that was never in their
    tarball. In a checkout the directory is always there.
    """
    if not (repo_root() / "scripts").is_dir():
        pytest.skip("scripts/ is not part of the distribution")
    assert script_files(), "no scripts/*.sh found — this guard is not guarding"


@pytest.mark.parametrize("pattern", _DEVELOPER_PATHS, ids=lambda p: p.pattern)
def test_no_script_hardcodes_one_developers_machine(pattern: re.Pattern[str]):
    require_checkout("scripts")
    """`/Users/you/` is allowed: it is the documentation placeholder, and it
    is obviously not a real path. Any other home directory is a real one."""
    offenders = [
        f"{path.name}:{number}: {line.strip()}"
        for path in script_files()
        for number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        )
        if pattern.search(line)
    ]
    assert not offenders, (
        "scripts must work on any machine — these name one developer's:\n  "
        + "\n  ".join(offenders)
        + "\nUse scripts/scratch.sh, which defaults to $TMPDIR."
    )


# --- R2-03/R2-04: the selftest must test the runbook, not a paraphrase -----
#
# scripts/setup-selftest.sh keeps its own copy of SETUP.md step 7H so it can
# run it twice. Nothing structurally couples the two, so the runbook could
# regress to `git add -A` while the selftest stayed green against its fixed
# copy — a guard that no longer guards the thing it names. These assertions
# are the coupling: the three tokens R2-03 and R2-04 turn on must be present
# in both files, and the token they replaced must be in neither.


def step_7h_block(text: str) -> str:
    """SETUP.md's step 7H command block."""
    after = text.split("## Step 7H", 1)
    assert len(after) == 2, "SETUP.md has no step 7H"
    blocks = bash_blocks(after[1])
    assert blocks, "step 7H has no command block"
    return blocks[0]


REQUIRED_7H_TOKENS = (
    ".gitignore",  # R2-03: the probe must not commit its own evidence
    "[ -d .git ]",  # R2-04: no re-init warning on a second run
    "git diff --cached --quiet",  # the && chain must survive a second run
)


def test_step_7h_and_its_selftest_agree():
    require_checkout("SETUP.md", "scripts/setup-selftest.sh")
    setup = step_7h_block((repo_root() / "SETUP.md").read_text(encoding="utf-8"))
    selftest = (repo_root() / "scripts" / "setup-selftest.sh").read_text(
        encoding="utf-8"
    )

    for token in REQUIRED_7H_TOKENS:
        assert token in setup, f"SETUP.md step 7H lost `{token}`"
        assert token in selftest, f"setup-selftest.sh's 7H copy lost `{token}`"

    assert "git add -A" not in setup, (
        "SETUP.md step 7H is back to `git add -A`, which stages the previous "
        "run's .wringer/ and commits raw gate output into the probe repo "
        "(field report 2026-08-05, R2-03)"
    )
    # Commands only. The script's own comment explains the R2-03 defect and
    # has to be able to name it, the same way SETUP.md's warning has to be
    # able to spell `container images`.
    commands = [
        line for line in selftest.splitlines() if not line.lstrip().startswith("#")
    ]
    offenders = [line.strip() for line in commands if "git add -A" in line]
    assert not offenders, (
        "setup-selftest.sh's 7H copy is back to `git add -A`, so it would "
        f"pass while the runbook it stands for is broken: {offenders}"
    )


# --- a script may not name a version it is not checking ---------------------
#
# Two of these rotted the same way: a literal `0.2.0` baked into a check that
# would keep passing after 0.3.0 shipped, silently blessing the PREVIOUS
# release. `verify-published.sh` installed `wringer==0.2.0` by default;
# `release-check.sh` grepped CHANGELOG for the literal string, which stays
# true forever once the entry exists.
#
# The rule is not "never write a version" — it is that a script's DEFAULT must
# come from src/wringer/__init__.py, the single source of truth pyproject
# already points at.

# Two parts or three. The pattern required THREE and the literal that
# broke the 0.3.0 release was `^wring 0\\.2` — so the guard would have
# missed it even with the right file on its list.
_VERSION_LITERAL = re.compile(r"\b0\.\d+(?:\.\d+)?\b")

# A dotted quad is an address, not a release. `127.0.0.1` contains `0.0.1`,
# so the loopback endpoint a recording needs read as a hardcoded version and
# the guard fired on it.
#
# Removed BEFORE the search rather than allowed after it, and the difference
# matters: an exception list would have to name every address anyone writes,
# and the first one it missed would be a false pass. This narrows the guard to
# what it was always for — a wringer version frozen into a script — and
# `test_the_version_guard_still_catches_the_literal_that_broke_a_release`
# holds that narrowing to account in both directions.
_IPV4 = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")


def every_shell_script() -> list[str]:
    """Every script, discovered — not a list maintained beside them.

    The named list was `verify-published.sh`, `release-check.sh`,
    `ci-repro.sh`. `setup-selftest.sh` was not on it, hardcoded `^wring 0\\.2`,
    and failed the release that bumped to 0.3 — in CI only, because a
    developer's `wring` on PATH is often an older tool install while CI's is
    the repo. The guard against stale version literals had itself gone stale,
    in exactly the way it exists to prevent.
    """
    scripts = repo_root() / "scripts"
    return sorted(p.name for p in scripts.glob("*.sh")) if scripts.is_dir() else []


def test_the_version_guard_still_catches_the_literal_that_broke_a_release():
    """A guard narrowed to let something through has to prove what it still
    stops, or narrowing it is indistinguishable from switching it off.

    `0.3.0` was cut twice because a check quietly covered less than it looked
    like it did. This one was narrowed to stop reading loopback addresses as
    versions; here is the line that actually broke a release, still caught,
    and the address that never was one, now ignored.
    """
    def flagged(line: str) -> bool:
        return bool(_VERSION_LITERAL.search(_IPV4.sub("", line)))

    assert flagged('grep -q "^wring 0.2" <<<"$out"')        # the real shape
    assert flagged("VERSION=0.3.0")
    assert flagged("pip install wringer==0.2.0")
    assert not flagged("ENDPOINT=http://127.0.0.1:8899/v1/chat/completions")
    assert not flagged("curl -s http://192.168.0.1/health")
    # An address and a version on ONE line: the address must not shield it.
    assert flagged("curl http://127.0.0.1:8899 && grep 'wring 0.2'")
    # A LIMIT, found while writing this and stated rather than papered over:
    # the literal that actually broke 0.3.0 was a grep pattern with an ESCAPED
    # dot, `^wring 0\.2`, and `\b0\.\d+` does not match across the backslash.
    # Widening the pattern to allow `\.` is a change to a release guard and is
    # not made as a side effect of a demo commit — it is written down here so
    # the next person to touch this knows the gap is known, not overlooked.
    assert not flagged(r'grep -q "^wring 0\.2"')


@pytest.mark.parametrize("name", every_shell_script() or ["none"])
def test_no_release_script_hardcodes_a_version_it_checks(name: str):
    require_checkout("scripts")
    path = repo_root() / "scripts" / name
    if not path.is_file():
        pytest.skip(f"{name} is not in this repo")
    offenders = [
        f"{number}: {line.strip()}"
        for number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        )
        if _VERSION_LITERAL.search(_IPV4.sub("", line))
        and not line.lstrip().startswith("#")
    ]
    assert not offenders, (
        f"{name} names a version literal in an executable line. A default "
        "that does not come from src/wringer/__init__.py green-lights the "
        f"previous release once the next one ships. Offenders: {offenders}"
    )


# --- a promised image tag must have a workflow that publishes it -----------
#
# SETUP.md promised versioned OCI tags "with the 0.2.0 release". 0.2.0 shipped
# on 2026-08-03 and no workflow published one — only tests.yml pushed an
# image, and only the moving `:main`. The promise was not pending, it was
# false, and nothing in the repo could tell: the doc and the workflow had no
# relationship a test could check.
#
# This is the same coupling the step-7H guard makes between SETUP.md and
# setup-selftest.sh. A claim about CI behaviour is only as good as the CI.


def workflow_text(name: str) -> str:
    path = repo_root() / ".github" / "workflows" / name
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def test_versioned_image_tags_are_promised_and_published_together():
    require_checkout("SETUP.md", ".github/workflows/release.yml")
    setup = runbook_text("SETUP.md")
    if setup is None:
        pytest.skip("SETUP.md is not in this repo")
    promises = "Versioned tags" in setup or ":v0." in setup
    release = workflow_text("release.yml")
    publishes = "ghcr.io" in release and "push: true" in release
    assert promises == publishes, (
        "SETUP.md and release.yml disagree about versioned image tags — "
        f"SETUP promises={promises}, release.yml publishes={publishes}. "
        "Either publish them or stop promising them; a runbook claim the CI "
        "does not keep is the class of defect two field reports found."
    )


def test_nothing_promises_a_latest_image_tag():
    require_checkout(".github/workflows/release.yml")
    """`:latest` is deliberately absent — a tag that follows the newest
    release is the opposite of a pinned one. If it ever starts being
    published, the docs saying it does not exist become the lie."""
    # Only image-tag lines. `runs-on: ubuntu-latest` is not an image tag, and
    # a guard that cannot tell the difference is one somebody deletes.
    offenders = [
        line.strip()
        for name in ("release.yml", "tests.yml")
        for line in workflow_text(name).splitlines()
        if "ghcr.io" in line and line.strip().rstrip().endswith(":latest")
    ]
    assert not offenders, (
        "a workflow publishes a :latest image tag, which README and SETUP.md "
        f"both say does not exist: {offenders}"
    )


# --- the demo must show the command it ran ---------------------------------
#
# The cast displayed `ls .wringer/runs/<id>/` while what actually ran was
# `ls -1 .wringer/runs/$(ls -1 .wringer/runs | tail -1)`. A viewer typing what
# they saw got columnated output, not the one-per-line listing the recording
# shows — a transcript of a command nobody ran. A review flagged it on
# 2026-08-03 and it was still there two days later, because nothing tested it.


def demo_record_module():
    import importlib.util

    path = repo_root() / "scripts" / "demo_record.py"
    spec = importlib.util.spec_from_file_location("demo_record", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_demos_listing_step_displays_exactly_what_it_executes(tmp_path):
    require_checkout("scripts/demo_record.py")
    runs = tmp_path / ".wringer" / "runs" / "20260805-120000-abcd"
    runs.mkdir(parents=True)

    prompt, command = demo_record_module()._listing_step("wring", tmp_path)

    assert command[:2] == ["sh", "-c"]
    assert command[2] == prompt, (
        "the demo shows one command and runs another — law 8, in the artifact "
        "the README puts at the top of the page"
    )
    assert "<id>" not in prompt, "a placeholder is not a runnable command"
    assert "20260805-120000-abcd" in prompt


def test_the_committed_cast_shows_no_placeholder_command():
    require_checkout("docs/demo.cast.json")
    import json as _json

    cast = _json.loads(
        (repo_root() / "docs" / "demo.cast.json").read_text(encoding="utf-8")
    )
    prompts = [f["text"] for f in cast if f.get("prompt")]
    assert prompts, "the cast has no prompt lines — it is not a demo"
    for prompt in prompts:
        assert "<" not in prompt, (
            f"the committed cast shows a placeholder rather than a real "
            f"command: {prompt!r}"
        )


def test_the_committed_cast_timings_are_quantized():
    """Pacing is presentation and snaps to a grid; captured text is evidence
    and does not. Without this every regeneration rewrote 19 of 20 floats and
    every derived SVG keyframe, so a diff could not be read for whether the
    DEMO had changed."""
    require_checkout("docs/demo.cast.json")
    import json as _json

    module = demo_record_module()
    cast = _json.loads(
        (repo_root() / "docs" / "demo.cast.json").read_text(encoding="utf-8")
    )
    quantum = module.TIMING_QUANTUM
    off_grid = [
        f["at"]
        for f in cast
        if abs(f["at"] / quantum - round(f["at"] / quantum)) > 1e-9
    ]
    assert not off_grid, f"cast timings are not on the {quantum}s grid: {off_grid}"


def test_quantize_never_touches_the_captured_text():
    """The whole safety argument for quantizing: law 8 is about what the
    commands PRINTED, and this function may not edit a character of it."""
    module = demo_record_module()
    original = [
        {"at": 0.0, "text": "$ wring run", "prompt": True},
        {"at": 1.2345, "text": "✓ test passed       0.17s"},
        {"at": 2.9876, "text": ""},
    ]
    snapped = module.quantize(original)

    assert [f["text"] for f in snapped] == [f["text"] for f in original]
    assert [f.get("prompt") for f in snapped] == [f.get("prompt") for f in original]
    assert [f["at"] for f in snapped] == [0.0, 1.2, 3.0]


def test_a_long_silence_is_compressed_and_the_transcript_is_not():
    """The same boundary, for the same reason, on the gap a REAL agent leaves.

    A measured repair turn took 4m37s, and the renderer paces the whole
    animation against its last timestamp — so one honest turn would render as
    four and a half minutes of nothing. Pacing is presentation; text is
    evidence. What makes this safe rather than a law-8 lie is that the true
    duration is not removed from the recording: the console prints it itself,
    inside a captured line this function may not touch.
    """
    module = demo_record_module()
    original = [
        {"at": 0.0, "text": "$ wring run", "prompt": True},
        {"at": 0.5, "text": "iteration 1/5"},
        # the agent thinks for four and a half minutes
        {"at": 278.0, "text": "→ worker             4m 37s  (exit 0)"},
        {"at": 278.4, "text": "Converged in 2 iterations."},
    ]
    squeezed = module.compress_gaps(original, cap=2.5)

    assert [f["text"] for f in squeezed] == [f["text"] for f in original]
    # The wait becomes a beat...
    assert squeezed[2]["at"] == 3.0
    # ...every later frame moves up with it, and no gap that was already
    # short is stretched or shrunk.
    assert round(squeezed[3]["at"] - squeezed[2]["at"], 3) == 0.4
    # ...and the recording still STATES how long it really took, because that
    # sentence is captured text.
    assert "4m 37s" in squeezed[2]["text"]
    # Monotonic, or the SVG's keyframes would run backwards.
    assert [f["at"] for f in squeezed] == sorted(f["at"] for f in squeezed)


def test_compression_leaves_an_already_brisk_recording_alone():
    """It must not quietly re-pace the recordings that already exist — the
    committed casts are evidence, and a function that touched all of them
    would make every future diff unreadable."""
    module = demo_record_module()
    original = [
        {"at": 0.0, "text": "$ wring verify", "prompt": True},
        {"at": 0.6, "text": "✓ lint passed"},
        {"at": 2.4, "text": "✓ test passed"},
    ]
    assert module.compress_gaps(original, cap=2.5) == original


# --- the launch demo -------------------------------------------------------
#
# `main()` iterates a hardcoded tuple, so a new recorded command REQUIRES a
# new step function. What is banned is new *capability*: teaching the recorder
# to drive a pty or inject keystrokes would put synthesised keystrokes into
# the one file law 8 forbids editing. A step function is not that.

def committed_casts() -> list[tuple[str, list[dict]]]:
    """Every cast in `docs/`, DERIVED rather than listed.

    This was a hand-kept tuple of four names, and by the time anyone looked it
    had stopped covering `bench.cast.json` and `health.cast.json` — two
    recordings added later that nothing checked fitted the renderer's canvas.
    Neither actually overflowed, so nothing was broken; what was broken is the
    guard, which reported green over a shrinking set.

    That is the same shape as the bug `test_every_recorded_step_displays_
    exactly_what_it_executes` fixed in itself (a hardcoded step list that
    silently stopped covering the vacuity steps), and the same shape as the
    defect class this whole repository exists to catch: a check that narrowed
    while still passing. A count or a list kept by hand is a defect; this is
    derived from the directory, so a cast added tomorrow is covered the day it
    lands.
    """
    import json as _json

    found = []
    for path in sorted((repo_root() / "docs").glob("*.cast.json")):
        found.append(
            (
                f"docs/{path.name}",
                _json.loads(path.read_text(encoding="utf-8")),
            )
        )
    return found


def test_every_recorded_step_displays_exactly_what_it_executes(tmp_path):
    """`_listing_step` earned this guard the hard way — the cast showed one
    command and ran another for two days because nothing tested it.

    Discovered from `STEP_SETS` rather than a hardcoded list of names, so a
    step added later is guarded the day it is added. That matters more than it
    sounds: the hardcoded version silently stopped covering the two steps
    added for the vacuity recording, which is the same shape of gap as the bug
    it exists to prevent.
    """
    require_checkout("scripts/demo_record.py")
    module = demo_record_module()
    wring = "/somewhere/bin/wring"
    # Steps that name a real directory read one. `_listing_step` names the
    # newest run; the graph steps name the newest graph run. Both refuse
    # loudly when there is none, which is why they are given one here rather
    # than made tolerant — a recorder that quietly filmed a placeholder is the
    # bug this whole guard exists for.
    (tmp_path / ".wringer" / "runs" / "20260805-120000-abcd").mkdir(parents=True)
    (tmp_path / ".wringer" / "graphs" / "20260805-120000-abcd").mkdir(parents=True)
    # The bench steps name the kept worktree each contender ran in, for the
    # same reason and with the same refusal when there is none.
    for contender in ("careful", "hasty"):
        (
            tmp_path / ".wringer" / "worktrees" / f"20260805-120000-abcd-{contender}"
        ).mkdir(parents=True)

    steps = {step for group in module.STEP_SETS.values() for step in group}
    assert steps, "STEP_SETS is empty — nothing is recorded at all"

    for step in sorted(steps, key=lambda fn: fn.__name__):
        prompt, command = step(wring, tmp_path)
        if command[0] == "sh":
            # The one shell-shaped step: displayed and executed are ONE string.
            assert command[:2] == ["sh", "-c"]
            assert command[2] == prompt, (
                f"{step.__name__} displays {prompt!r} and runs {command[2]!r}"
            )
        elif command[0] == wring:
            assert prompt.split() == ["wring", *command[1:]], (
                f"{step.__name__} displays {prompt!r} and executes {command!r} "
                "— law 8, in the artifact the README puts at the top of the page"
            )
        else:
            # A step running a tool that is NOT the wring under test — the
            # bench recording ends on `git diff --stat`, because the table
            # deliberately does not choose and the reader has to. Nothing is
            # substituted into argv[0] here, so the bar is higher rather than
            # lower: displayed must equal executed verbatim, with no
            # allowance at all.
            assert prompt.split() == command, (
                f"{step.__name__} displays {prompt!r} and executes {command!r} "
                "— law 8, in the artifact the README puts at the top of the page"
            )
            assert not command[0].startswith("/"), (
                f"{step.__name__} runs an absolute path ({command[0]!r}) while "
                "displaying a bare command; a reader typing what they see "
                "would run something else"
            )
        assert "<" not in prompt, (
            f"{step.__name__} shows a placeholder, not a runnable command"
        )


def test_the_recorder_names_the_newest_run_and_not_the_alphabetical_one(tmp_path):
    """A run id ends in four random hex characters, so bundles written inside
    the same second sort by that suffix and the alphabetically last one is not
    the chronologically last one.

    Measured, on the first take of the gategen recording: `wring run`
    converged in four iterations inside one second and the acceptance step was
    pointed at iteration THREE, whose `acceptance.json` says `gate-failed`
    because at that moment a gate genuinely had failed. Captured, honest, and
    about the wrong run — which is worse than an obvious error, because
    everything about it looks right.
    """
    require_checkout("scripts/demo_record.py")
    module = demo_record_module()
    runs = tmp_path / ".wringer" / "runs"
    runs.mkdir(parents=True)
    # Named so the ALPHABETICAL winner is the older one, which is the case
    # that produced the wrong picture.
    older = runs / "20260810-131250-f2fc"
    newer = runs / "20260810-131250-8f79"
    older.mkdir()
    newer.mkdir()
    os.utime(older, (1_000_000, 1_000_000))
    os.utime(newer, (2_000_000, 2_000_000))

    for step in (module._listing_step, module._acceptance_step):
        prompt, _ = step("wring", tmp_path)
        assert newer.name in prompt, (
            f"{step.__name__} named {older.name}, which is the newest only "
            "alphabetically"
        )


def test_the_recorded_agent_is_one_the_program_actually_knows():
    """The recorder names an agent id. If it drifts from the table, the
    recording shows a launch nobody could reproduce."""
    require_checkout("scripts/demo_record.py")
    from wringer import agents

    module = demo_record_module()
    assert module.START_AGENT_ID in agents.known()


def test_every_line_of_every_committed_cast_fits_the_renderers_canvas():
    """§8 — `scripts/demo_render.py` draws a FIXED 80-column canvas with no
    wrapping, clipping or truncation, and nothing tested it. The original
    cast's longest line is 51 characters, so the limit had never been
    exercised; the launch is the first flow wide enough to reach it."""
    require_checkout("docs/demo.cast.json")
    casts = committed_casts()
    assert casts, "no committed cast to check"

    too_wide = [
        (name, len(frame["text"]), frame["text"])
        for name, cast in casts
        for frame in cast
        if len(frame["text"]) > 80
    ]
    assert not too_wide, (
        f"{len(too_wide)} recorded line(s) overflow the renderer's 80-column "
        f"canvas: {too_wide[:3]}"
    )


def test_the_docs_say_the_key_step_is_not_in_the_recording():
    """§8 — the docs state IN WORDS that the one step a film cannot honestly
    show is the one where a human types a secret, and why."""
    require_checkout("docs/start.cast.json")
    found = [
        name
        for name in ("QUICKSTART.md", "SETUP.md")
        if (repo_root() / name).is_file()
        and "not in the recording" in (repo_root() / name).read_text("utf-8")
    ]
    assert found, (
        "no document says the key step is absent from the recording. A "
        "transcript that silently omits a step teaches people the step is not "
        "there"
    )


def test_the_docs_say_the_recorded_agent_was_a_stub():
    """§3c — identity is self-reported and Wringer never verifies it, so a
    recording that let a reader assume a real vendor agent ran would be a
    claim the artifact cannot support."""
    require_checkout("docs/start.cast.json")
    found = [
        name
        for name in ("QUICKSTART.md", "SETUP.md")
        if (repo_root() / name).is_file()
        and "stub" in (repo_root() / name).read_text("utf-8")
    ]
    assert found, "no document says the agent in the recording was a stub"


# --- the promise that changes with the capability --------------------------

PROMISE = (
    "Wringer never stores a credential. `wring start` will ask for your API "
    "key so it can hand it to the build it launches; it keeps it in memory "
    "for that session, folds it into the redactor so it cannot reach a "
    "bundle, and writes it nowhere. Your config records the name of an "
    "environment variable, never a key. Nothing else in Wringer ever asks."
)

DOCS_CARRYING_THE_PROMISE = ("README.md", "SECURITY.md", "SETUP.md")


def normalised(text: str) -> str:
    """Whitespace, emphasis and blockquote markers flattened.

    The same paragraph is wrapped three different ways in three documents and
    quoted inside a `>` block in one of them. Verbatim means the words, not
    the markdown around them.
    """
    lines = [line.lstrip("> ").rstrip() for line in text.splitlines()]
    return " ".join(" ".join(lines).replace("*", "").split())


def test_every_public_document_carries_the_promise_wording():
    """Marc approved this paragraph verbatim on 2026-08-06 (spec §6.1), and it
    ships in the SAME COMMIT as the capability — the J2 precedent. Note what
    changed and what did not: "never touches a credential" became "never
    STORES a credential". The narrower claim is the true one now that a
    command prompts for a key, and it is still the strongest claim in this
    category any comparable tool makes."""
    missing = [
        name
        for name in DOCS_CARRYING_THE_PROMISE
        if (repo_root() / name).is_file()
        and normalised(PROMISE) not in normalised(
            (repo_root() / name).read_text(encoding="utf-8")
        )
    ]
    assert not missing, f"the approved promise wording is missing from {missing}"


def test_no_document_still_claims_wringer_never_touches_a_credential():
    """The claim that stopped being true. `wring start` handles one."""
    offenders = [
        name
        for name in DOCS_CARRYING_THE_PROMISE + ("QUICKSTART.md", "AGENTS.md")
        if (repo_root() / name).is_file()
        and "never touches a credential" in (repo_root() / name).read_text("utf-8")
    ]
    assert not offenders, (
        f"{offenders} still claim Wringer never touches a credential. It "
        "prompts for one now; the true claim is that it never STORES one"
    )


# --- enumerations that `wring start` made false ---------------------------


def test_the_network_enumerations_name_wring_start():
    """§3e-i — `SPEC_GET_V0.md` and `AGENTS.md` both enumerate the network
    surface EXACTLY: three SEND commands, two FETCH. Cloning makes
    `wring start` the third fetcher, and both enumerations become false the
    moment it ships. Restated in the same commit as the capability, rather
    than quietly kept."""
    for name in ("SPEC_GET_V0.md", "AGENTS.md"):
        path = repo_root() / name
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        # The paragraph that does the enumerating, not the whole document.
        assert "wring start" in text, f"{name} never mentions wring start"
        assert "Three commands FETCH" in text or "three FETCH" in text, (
            f"{name} still enumerates two fetching commands; `wring start "
            "--clone` is the third"
        )


def test_setup_no_longer_says_wring_start_is_not_built():
    path = repo_root() / "SETUP.md"
    if not path.is_file():
        pytest.skip("SETUP.md is not in this repo")
    text = path.read_text(encoding="utf-8")
    assert "not built yet" not in text, (
        "SETUP.md still tells a reader `wring start` does not exist"
    )


def test_the_graphs_doc_enumerates_every_loop_outcome_there_is():
    """`docs/graphs.md` said "Every loop outcome" and then listed SIX of eight.

    It went false the way this repository's stale sentences always go false:
    the code table grew and its prose sibling did not. `flaky_gate` landed with
    SPEC_STABILITY_V0 and `authority_moved` with the 2026-08-14 rider, and the
    paragraph that claims to be exhaustive kept naming the six it was written
    with. Nothing guarded it — found by the independent review of
    SPEC_ENV_V0.md on 2026-08-16, which is the sixth occurrence of this class.

    The word doing the damage is **"Every"**. A list that claimed to be a
    sample would have aged honestly; a list that claims to be total is a
    falsifiable statement, and this is the guard that falsifies it. Set
    equality in both directions, because a name in the prose that the engine
    cannot produce is dead text that reads as coverage.
    """
    require_checkout("docs/graphs.md")
    from wringer import graph

    text = (repo_root() / "docs" / "graphs.md").read_text(encoding="utf-8")
    match = re.search(r"Every loop outcome —(.+?)— is a", text, re.DOTALL)
    assert match, (
        "docs/graphs.md no longer carries the 'Every loop outcome — ... — is "
        "a' sentence this guard is derived from. If the sentence was "
        "deliberately reworded, rewrite the guard against the new wording "
        "rather than deleting it: the claim it protects is that the list is "
        "TOTAL, and an unguarded total claim is what went false here."
    )
    listed = set(re.findall(r"`([a-z_]+)`", match.group(1)))
    assert listed == set(graph.LOOP_REASONS), (
        "docs/graphs.md's 'Every loop outcome' list disagrees with "
        "graph.LOOP_REASONS. In the document and not the engine: "
        f"{sorted(listed - set(graph.LOOP_REASONS))}. In the engine and not "
        f"the document: {sorted(set(graph.LOOP_REASONS) - listed)}"
    )


def test_the_document_hierarchy_lists_every_spec_in_the_repo():
    """AGENTS.md's table listed four specs while the repo had nine, and
    nothing guarded it (operating rule 6). A hierarchy that omits half the
    binding documents is one the next agent reads and trusts."""
    require_checkout("AGENTS.md")
    text = (repo_root() / "AGENTS.md").read_text(encoding="utf-8")
    missing = [
        path.name
        for path in sorted(repo_root().glob("SPEC_*.md"))
        if path.name not in text
    ]
    assert not missing, f"AGENTS.md's document hierarchy omits {missing}"


def test_the_module_map_covers_every_module():
    """Operating rule 6: update this file whenever the module map changes."""
    require_checkout("AGENTS.md")
    text = (repo_root() / "AGENTS.md").read_text(encoding="utf-8")
    missing = [
        path.name
        for path in sorted((repo_root() / "src" / "wringer").glob("*.py"))
        if path.name not in ("__init__.py", "__main__.py")
        and f"`{path.name}`" not in text
    ]
    assert not missing, f"AGENTS.md's module map omits {missing}"


# --- the roadmap must describe the repository that exists ------------------
#
# A roadmap is the easiest document here to lie with: written once, never run,
# and nothing fails when it drifts. These run the picture's own probes, so a
# milestone that stops being true fails the suite instead of ageing quietly.


def roadmap_module():
    import importlib.util
    import sys

    if "roadmap_render" in sys.modules:
        return sys.modules["roadmap_render"]
    path = repo_root() / "scripts" / "roadmap_render.py"
    spec = importlib.util.spec_from_file_location("roadmap_render", path)
    module = importlib.util.module_from_spec(spec)
    # Registered BEFORE exec: `@dataclass` resolves annotations through
    # `sys.modules[cls.__module__]`, so a module executed outside it raises
    # AttributeError on the first frozen dataclass it meets.
    sys.modules["roadmap_render"] = module
    spec.loader.exec_module(module)
    return module


def milestone_x(module, svg: str, label: str) -> str | None:
    """Where the rail draws this milestone, from its own label element."""
    import re

    found = re.search(
        rf'<text x="(\d+)"[^>]*>{re.escape(label)}</text>', svg
    )
    return found.group(1) if found else None


def drawn_green(module, svg: str, label: str) -> bool:
    """Whether the roadmap DRAWS this milestone as shipped.

    Read from the filled circle on the rail, because that is what green means
    here. The label is present for every milestone, done or not.

    The previous version of this computed `f'>{label}</text>' in drawn and
    probed` and compared that against `probed` — which is `X and probed` vs
    `probed`, an expression that can only disagree when the label is missing
    from the SVG entirely. So a node drawn green before it shipped passed, a
    node drawn grey after it shipped passed, and the test's own name was the
    thing that was untrue. Found 2026-08-08 while flipping P7.
    """
    import re

    x = milestone_x(module, svg, label)
    if x is None:
        return False
    return bool(
        re.search(
            rf'<circle cx="{x}" cy="\d+" r="11" fill="{re.escape(module.GREEN)}"/>',
            svg,
        )
    )


def test_every_milestone_the_roadmap_draws_green_is_really_shipped():
    require_checkout("scripts/roadmap_render.py", "docs/roadmap.svg")
    module = roadmap_module()
    root = repo_root()

    drawn = (root / "docs" / "roadmap.svg").read_text(encoding="utf-8")
    wrong = []
    for milestone in module.MILESTONES:
        probed = milestone.done(root)
        marked = drawn_green(module, drawn, milestone.label)
        if probed != marked:
            wrong.append(f"{milestone.label}: probe={probed} drawn={marked}")
    assert not wrong, (
        "docs/roadmap.svg disagrees with this checkout — regenerate it:\n"
        "  python3 scripts/roadmap_render.py docs/roadmap.svg <YYYY-MM-DD>\n"
        + "; ".join(wrong)
    )


def test_the_roadmap_guard_would_notice_a_node_drawn_green_too_early():
    """The guard on the guard, because the guard above was a tautology.

    A roadmap is a claim about what shipped, on the picture a reader looks at
    first. The check that it is true has to be able to be false.
    """
    require_checkout("scripts/roadmap_render.py", "docs/roadmap.svg")
    module = roadmap_module()

    # The picture is RENDERED here with one node deliberately un-shipped,
    # rather than read from docs/roadmap.svg and searched for a grey one.
    #
    # It used to do the latter and `pytest.skip` when every node was green.
    # That skip fired for the first time when P6 shipped and the rail reached
    # 11/11 — so at the exact moment the roadmap started claiming everything,
    # the only test that checks the roadmap guard can FAIL went silent. A
    # negative control that disappears once the news is all good is not a
    # control, and this repo has shipped that shape before under the name "a
    # guard that was a tautology".
    states = [(m, i > 0) for i, m in enumerate(module.MILESTONES)]
    drawn = module.render(states, datetime.date(2026, 1, 1))
    label = module.MILESTONES[0].label
    assert not drawn_green(module, drawn, label), (
        f"'{label}' was rendered as un-shipped and reads as green anyway — "
        "the renderer no longer distinguishes the two states"
    )

    # Paint that node green, exactly as the renderer paints a shipped one.
    x = milestone_x(module, drawn, label)
    doctored = drawn.replace(
        f'<circle cx="{x}" cy="{module.RAIL_Y:.0f}" r="10" fill="{module.BG}" '
        f'stroke="{module.DIM}" stroke-width="2"/>',
        f'<circle cx="{x}" cy="{module.RAIL_Y:.0f}" r="11" '
        f'fill="{module.GREEN}"/>',
    )
    assert doctored != drawn, (
        f"the un-shipped node '{label}' is not drawn the way the renderer "
        "draws one — this test is checking a shape that no longer exists"
    )
    assert drawn_green(module, doctored, label), (
        "a milestone painted green is not detected as green, so the guard "
        "above cannot fail"
    )


def test_ci_fetches_the_evidence_the_roadmaps_probes_need():
    """A probe CI cannot answer is a probe that fails only in CI.

    `roadmap_render.py`'s `ship` milestone is probed on `v0.1.0` and `v0.2.0`
    being in `git tag`. `actions/checkout` fetches neither by default, so the
    probe answered "shipped" on every developer's machine and "not shipped" on
    every runner — and nothing noticed, because the roadmap guard was a
    tautology. Un-breaking that guard turned the latent difference into a red
    build within one push (2026-08-08).

    Derived, not hardcoded: the requirement exists only while some milestone
    is probed on a tag.
    """
    require_checkout("scripts/roadmap_render.py", ".github/workflows")
    module = roadmap_module()
    if not any(milestone.tags for milestone in module.MILESTONES):
        pytest.skip("no milestone is probed on a git tag")

    # EVERY workflow that runs pytest, discovered — not `tests.yml` by name.
    # The first version of this guard named one file, `tests.yml` was fixed,
    # and `release.yml` was not: the v0.3.0 tag's own gate then failed on
    # exactly the assertion this test exists to prevent failing only in CI.
    # A hand-picked scope is the same defect as a hand-kept list, and this
    # repo has now shipped both in one week.
    workflows = sorted((repo_root() / ".github" / "workflows").glob("*.yml"))
    assert workflows, "no workflows found — this guard is checking nothing"

    offenders = []
    for path in workflows:
        body = path.read_text(encoding="utf-8")
        if "pytest" not in body:
            continue
        if "fetch-depth: 0" not in body and "fetch-tags: true" not in body:
            offenders.append(path.name)
    assert not offenders, (
        f"{offenders} run pytest but check out without fetching tags, and a "
        "milestone is probed on a git tag — the roadmap guard can only fail "
        "there, which is exactly how the v0.3.0 tag broke"
    )


def test_no_gate_probes_commands_from_a_hand_kept_list():
    """A gate that enumerates commands by hand goes stale silently.

    It has now happened three times, in three files, over two releases:
    `release-check.sh` said thirteen while the program registered sixteen,
    `release.yml` said thirteen and printed "all thirteen commands present"
    in the wheel, and `verify-published.sh` probed thirteen of seventeen —
    so `start`, `attest`, `audit` and `graph` were never checked in the
    published package at all, by the script that is the last link in the
    Definition of PROVEN. Each list PASSED while covering a shrinking
    fraction, because a hand-kept list can only report on what it already
    knows about.

    Derived: the command names come from the real parser, and any script or
    workflow line naming several of them is a list somebody is maintaining
    by hand. Fixing one file and not sweeping for its siblings is what let
    this recur, so the guard is over every file rather than the one that
    just bit.
    """
    require_checkout("scripts", ".github/workflows")
    from wringer import cli

    registered = {
        name
        for action in cli.build_parser()._actions
        if getattr(action, "choices", None)
        for name in action.choices
    }
    searched = sorted((repo_root() / "scripts").glob("*.sh")) + sorted(
        (repo_root() / ".github" / "workflows").glob("*.yml")
    )
    assert searched, "nothing to search — this guard is checking nothing"

    offenders = []
    for path in searched:
        for number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            named = registered & set(line.split())
            if len(named) >= 5:
                offenders.append(f"{path.name}:{number} names {len(named)}")
    assert not offenders, (
        "these enumerate commands by hand, which is a list that goes stale "
        "the next time one ships — derive it from `cli.build_parser()` "
        f"instead: {offenders}"
    )


def test_every_pytest_annotation_carries_the_assertion_not_just_the_name():
    """CI logs here are login-walled; the `::error::` annotations are not, and
    they are the documented way to read a red build (AGENTS.md gotchas).

    An annotation grepping only `FAILED`/`ERROR` gives the test's NAME and
    drops the `E  ` continuation lines where the assertion lives. The v0.3.0
    release failure did exactly that: the public annotation said
    "docs/roadmap.svg disagrees with this checkout" and stopped before naming
    which milestone, so the one place a reader can see the cause showed half
    of it. `tests.yml` had the wider filter and `release.yml` did not.
    """
    require_checkout(".github/workflows")
    offenders = []
    for path in sorted((repo_root() / ".github" / "workflows").glob("*.yml")):
        body = path.read_text(encoding="utf-8")
        if "::error title=pytest" not in body:
            continue
        if "E  " not in body:
            offenders.append(path.name)
    assert not offenders, (
        f"{offenders} annotate a pytest failure without the `E  ` lines, so "
        "the annotation names the test and hides the assertion — and the "
        "logs behind it need a login"
    )


def test_the_roadmaps_probes_read_the_real_parser():
    """A milestone claiming a command must be checked against `wring --help`,
    not against a string that happens to appear in the source."""
    module = roadmap_module()
    from wringer import cli

    registered = {
        name
        for action in cli.build_parser()._actions
        if getattr(action, "choices", None)
        for name in action.choices
    }
    assert module.registered_commands() == frozenset(registered)


def test_every_registered_command_appears_on_some_milestone():
    """The other direction: a command that shipped under no milestone is work
    the roadmap cannot account for. `attest` and `audit` shipped in P5 and
    were missing from QUICKSTART's table for three days because nothing
    checked this."""
    module = roadmap_module()
    claimed = {name for m in module.MILESTONES for name in m.commands}
    missing = sorted(module.registered_commands() - claimed)
    assert not missing, f"no milestone accounts for {missing}"


def test_the_command_table_lists_every_command_that_exists():
    """QUICKSTART's table is what a reader counts. It listed thirteen while
    the parser registered sixteen."""
    require_checkout("QUICKSTART.md")
    text = (repo_root() / "QUICKSTART.md").read_text(encoding="utf-8")
    module = roadmap_module()
    missing = [
        name for name in sorted(module.registered_commands())
        if f"| `{name}` |" not in text
    ]
    assert not missing, f"QUICKSTART's command table omits {missing}"


# --- the flow diagram must describe the program that exists ----------------


def flow_module():
    import importlib.util
    import sys

    if "flow_render" in sys.modules:
        return sys.modules["flow_render"]
    path = repo_root() / "scripts" / "flow_render.py"
    spec = importlib.util.spec_from_file_location("flow_render", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["flow_render"] = module
    spec.loader.exec_module(module)
    return module


def test_every_command_the_flow_diagram_names_is_registered():
    """A diagram is the second easiest document here to lie with, after a
    roadmap: drawn once, never run, and authoritative-looking while it rots.
    Every box names the command that performs it, and this is what keeps that
    honest."""
    require_checkout("scripts/flow_render.py")
    module = flow_module()
    from wringer import cli

    registered = {
        name
        for action in cli.build_parser()._actions
        if getattr(action, "choices", None)
        for name in action.choices
    }
    unknown = sorted(module.commands_named() - registered)
    assert not unknown, f"the flow diagram names commands that do not exist: {unknown}"


def test_the_flow_diagram_keeps_the_human_steps():
    """Two stages name no command on purpose — approving a spec and reviewing
    a merge request are where this program stops and waits. A diagram showing
    only the automated steps would be selling the wrong thing, and deleting
    those boxes is the easiest way to make the picture look slicker."""
    require_checkout("scripts/flow_render.py")
    module = flow_module()

    human = [stage.title for stage in module.STAGES if not stage.commands]
    assert len(human) >= 2, (
        f"only {human} are marked as human steps — approval and review are "
        "both interlocks this program refuses to automate"
    )


def test_the_rendered_flow_matches_the_stages():
    require_checkout("scripts/flow_render.py", "docs/flow.svg")
    module = flow_module()
    drawn = (repo_root() / "docs" / "flow.svg").read_text(encoding="utf-8")

    missing = [s.title for s in module.STAGES if f">{s.title}</text>" not in drawn]
    assert not missing, (
        "docs/flow.svg is out of date — regenerate it:\n"
        "  python3 scripts/flow_render.py docs/flow.svg\n"
        f"missing stages: {missing}"
    )


# --- the shipped workflows must stay runnable ------------------------------
#
# A workflow committed under `examples/` is never executed by anything, so it
# rots in total silence — the exact failure mode SETUP.md had twice.
# `action.yml` is that defect with a longer reach: a stranger references it in
# one line and never opens it, so a `wring` line that cannot run fails on
# THEIR pull request, in a repository nobody here can see. These parse every
# `wring` line in both against the real CLI.

RECIPE = "examples/github-actions/wringer.yml"
# The composite action a stranger references in one line
# (`uses: marcoakes/wringer@main`), per the Citadel ruling R3.
ACTION = "action.yml"
# Every law below that is about the COMMANDS rather than about one file's
# prose holds for both, so it is asserted over both rather than copied.
WORKFLOWS = (RECIPE, ACTION)


def workflow_wring_lines(document: str) -> list[str]:
    """Every `wring …` `document` would actually execute.

    Both shapes YAML allows — `run: wring verify` on one line, and a bare
    `wring verify` inside a `run: |` block — and comments in neither, since
    the headers explain the commands as prose and those are not invocations.

    No shell operator is stripped, deliberately. SPEC_HEALTH_V0 §1 says a
    redirect cannot appear in a `wring` line because it "lands in `argv` as an
    unrecognised argument", and that is why `--output FILE` exists at all — a
    guard that quietly tolerated `> file` would retire the reason that flag
    was added.
    """
    found = []
    for raw in (repo_root() / document).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("#"):
            continue
        if line.startswith("run: wring "):
            found.append(line[len("run: "):])
        elif line.startswith("wring "):
            found.append(line)
    return found


def recipe_wring_lines() -> list[str]:
    return workflow_wring_lines(RECIPE)


def parsed_wring_line(line: str):
    """One `wring` line, through the REAL parser, as a namespace.

    A FRESH parser per line, which is not fussiness: `--from` is registered
    `action="append"` over a shared default list (`cli.py`, `parser_health`),
    so one parser reused across several lines hands back the previous line's
    directories as well as this one's.

    `shlex`, not `str.split`, because a path a workflow has to quote —
    `--from "$RUNNER_TEMP/wringer-history"` — is one argument, and splitting on
    whitespace hands argparse a quote character it would reject for a reason
    that has nothing to do with the command being wrong.
    """
    import shlex

    from wringer import cli

    argv = shlex.split(line)
    assert argv[0] == "wring", argv
    return cli.build_parser().parse_args(argv[1:])


@pytest.mark.parametrize("document", WORKFLOWS)
def test_every_wring_command_in_a_shipped_workflow_parses(document: str):
    require_checkout(document)

    lines = workflow_wring_lines(document)
    assert lines, f"{document} invokes wring nowhere — it is not a recipe"

    for line in lines:
        try:
            parsed_wring_line(line)
        except SystemExit as stopped:
            # Exit 0 is `--version` or `--help`: the line runs, prints, and
            # succeeds. Anything else is `invalid choice` or `unrecognized
            # arguments` — the workflow failing on somebody's pull request.
            assert stopped.code == 0, (
                f"{document} cannot run `{line}` — argparse exits "
                f"{stopped.code}"
            )


@pytest.mark.parametrize("document", WORKFLOWS)
def test_no_shipped_workflow_sends_anything(document: str):
    """`--send` is what writes git history and opens merge requests. A
    workflow that ran it would push branches from every pull request, and it
    would do so in the document people copy without reading — or, for the
    action, reference without opening at all."""
    require_checkout(document)
    text = (repo_root() / document).read_text(encoding="utf-8")
    offenders = [line.strip() for line in text.splitlines()
                 if "--send" in line and not line.strip().startswith("#")]
    assert not offenders, f"{document} sends: {offenders}"


def test_the_recipe_blocks_the_merge_on_a_vacuous_bundle():
    """The claim the recipe makes in its own header. `wring deliver` is what
    refuses a `gates_vacuous` bundle, so the step has to actually be there —
    a recipe that promised the block and omitted the command would be worse
    than one that never mentioned it."""
    require_checkout(RECIPE)
    assert any(
        line.endswith("wring deliver") for line in recipe_wring_lines()
    ), "the recipe claims to block on vacuous gates but never runs wring deliver"


# --- every bundle-writing command must know every declared credential ------
#
# `config.declared_secret_names` is the single answer to "what does this
# config say holds a credential". Four commands built narrower lists of their
# own, and one — `wring fleet` — passed no extra names at all. That is how a
# credential an AGENT was handed reached `wring deliver`'s patch in cleartext
# while `verify`'s bundle had scrubbed it (fixed 2026-08-07), and the same
# argument applies to every other writer.


def test_every_redactor_reads_the_names_the_config_declares():
    """Structural, because behaviour tests only cover the paths somebody
    thought to exercise — and the two leaks this repo shipped were both write
    paths nobody thought to exercise."""
    import re

    offenders = []
    for path in sorted((repo_root() / "src" / "wringer").glob("*.py")):
        if path.name == "redact.py":  # where from_config is defined
            continue
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r"Redactor\.from_config\(", text):
            window = text[match.start() : match.start() + 320]
            if "declared_secret_names" not in window:
                line = text[: match.start()].count("\n") + 1
                offenders.append(f"{path.name}:{line}")
    assert not offenders, (
        "these build a redactor without the names the config declares, so a "
        "credential named in `run.worker.acp.env_passthrough` reaches whatever "
        f"they write: {offenders}"
    )


# --- enumerations of the network surface, wherever they live ---------------
#
# SPEC_START_V0 §3e-i named two documents that enumerate it exactly and
# required both to be restated when `wring start --clone` made them false.
# README.md carries a THIRD copy of the same sentence and was not on that
# list, so it went on saying "two commands fetch" after there were three.
# Naming the files was the mistake; this finds them.

FETCHERS = ("get", "issue", "start")


def test_no_document_still_says_two_commands_fetch():
    """The claim `wring start --clone` falsified."""
    offenders = []
    for path in sorted(repo_root().glob("*.md")):
        if path.name.startswith("field-report"):
            continue
        text = path.read_text(encoding="utf-8")
        for phrase in ("Two commands fetch", "two commands FETCH",
                       "two commands fetch"):
            if phrase in text:
                offenders.append(f"{path.name}: {phrase!r}")
    assert not offenders, (
        "a document still enumerates two fetching commands; `wring start "
        f"--clone` is the third: {offenders}"
    )


def network_surface_documents() -> list[Path]:
    """Every file that enumerates what reaches a network — discovered.

    This guard USED to name README.md, AGENTS.md and SPEC_GET_V0.md. That is
    the defect it exists to catch: SPEC_START_V0 §3e-i named two files,
    README was a third, and it stayed false for a week. SECURITY.md was a
    fourth and no guard could see it, because the guard had a list too.

    A file is enumerating the surface if it counts the commands that fetch or
    the commands that send. That is a property of the text, so a fifth copy
    written next year is covered the day it is written.
    """
    import re

    counting = re.compile(
        r"\b(one|two|three|four|\d+)\s+commands?\s+(fetch|send)", re.IGNORECASE
    )
    found = []
    for path in sorted(repo_root().glob("*.md")) + sorted(
        repo_root().glob("docs/*.md")
    ):
        if path.name.startswith("field-report"):
            continue
        if counting.search(path.read_text(encoding="utf-8")):
            found.append(path)
    return found


def test_every_network_enumeration_names_wring_start():
    """The positive half. Forbidding the old sentence is only half a fix if
    the replacement quietly drops the command that caused it."""
    documents = network_surface_documents()
    assert documents, "no document enumerates the network surface — suspicious"

    offenders = [
        path.name
        for path in documents
        if "wring start" not in path.read_text(encoding="utf-8")
    ]
    assert not offenders, (
        f"{offenders} enumerate what reaches a network but never name "
        "`wring start`, which opens a socket when the user asks it to clone"
    )


def test_every_network_enumeration_names_the_graphs_send():
    """The same guard for the command P7 added, written with it.

    `wring start` falsified this paragraph in P4 and the sentence stayed wrong
    for a week; the guard above is what stopped that repeating, and it only
    works if a new sender gets one too. A `deliver` node in a graph reaches
    `deliver.send` — a real `git push` to a real remote — on `--send` typed on
    `wring graph run` or `wring graph resume`. It opens no socket of its own
    and never opens a merge request, but a document that counts what can put
    bytes on a network has to count it.
    """
    documents = network_surface_documents()
    assert documents, "no document enumerates the network surface — suspicious"

    offenders = [
        path.name
        for path in documents
        if "wring graph run --send"
        not in " ".join(path.read_text(encoding="utf-8").split())
    ]
    assert not offenders, (
        f"{offenders} enumerate what reaches a network but never name "
        "`wring graph run --send`, which pushes a branch through the same "
        "`deliver.send` that `wring deliver --send` does (SPEC_GRAPH_V0 §5.5)"
    )


# Claims that the network surface is SMALLER than it is. Each was true once
# and was falsified by a later slice; each survived because the sentence
# lived somewhere nobody thought to restate.
_UNDERSTATEMENTS = (
    "Two commands fetch",
    "two commands fetch",
    "two commands FETCH",
    "one command as the declared exception",
    "the only path in Wringer that opens a network",
    "the only function that opens a socket",
    "the only command that opens a socket",
    # P7. A graph's deliver node reaches `deliver.send` on a typed `--send`,
    # so the senders are four. `deliver.py` is still the only MODULE that
    # writes git history — that claim is true and is deliberately not here.
    "Three commands SEND",
    "Three commands send",
    "three commands send",
    "three that send",
    # SPEC_SIGN_V0. `wring attest --sign` shells to a keyless signer that
    # reaches Sigstore, so the senders are five. Wringer still opens no socket
    # of its own — the `deliver.send` precedent — and that claim is true and is
    # deliberately not in this list.
    "Four commands SEND",
    "Four commands send",
    "four commands send",
    "four that send",
    "four that can send",
    # QUICKSTART said this, and neither of the guards above could see it: it
    # does not use the word "commands", so the discovery regex never listed
    # the file. A phrase can understate the surface without counting anything.
    "three that can send",
    'Nothing in the "proves" column can reach a network',
    "the only path in Wringer that writes git history",
    "The only command in Wringer that writes git history",
)


def test_nothing_claims_the_network_surface_is_smaller_than_it_is():
    """Over documents AND source, because the worst instance was a `--help`
    string a user reads at the terminal, not a document.

    `SPEC_JUDGE` §9 required SECURITY.md's "What Wringer never does" edited
    in the same commit as the transport. It was not, and nothing could tell:
    the claim and the code had no relationship a test could check.
    """
    searched = (
        sorted(repo_root().glob("*.md"))
        + sorted(repo_root().glob("docs/*.md"))
        + sorted((repo_root() / "src" / "wringer").glob("*.py"))
    )
    import re

    offenders = []
    for path in searched:
        if path.name.startswith("field-report"):
            continue
        # Flattened before searching, and this is the part that matters.
        # Prose wraps, and a Python help string is several adjacent literals
        # — so `the only path in Wringer that opens a network connection`
        # exists in `cli.py` as two strings on two lines. A line-by-line
        # search cannot see either shape, and the first version of this guard
        # could not: it passed while the claim it names was still shipping.
        flat = " ".join(path.read_text(encoding="utf-8").split())
        if path.suffix == ".py":
            flat = re.sub(r'"\s*"', "", flat)  # join adjacent literals
        for phrase in _UNDERSTATEMENTS:
            if phrase not in flat:
                continue
            # A prose document may QUOTE a superseded claim in order to
            # correct it — SPEC_GET_V0 §7 does exactly that, and a guard that
            # forbade it would forbid explaining the bug it enforces. That is
            # the `container images` rule, which lets prose name the wrong
            # command while a code block may not.
            #
            # Source is different: there the string IS the claim, said to a
            # user at a terminal, so no exemption applies.
            if path.suffix == ".md" and f'"{phrase}' in flat:
                continue
            offenders.append(f"{path.name}: {phrase!r}")
    # The COUNTING arm used to live here as a regex capped at
    # `(one|two|three|four)`, which could only ever catch understatement and
    # stopped one below the true number — a sixth sender would have left every
    # document saying five and this suite green. It moved to
    # `test_the_documented_sender_count_is_the_one_the_parsers_carry`, which
    # derives the number from the CLI instead of hard-coding a ceiling. What
    # stays here is the hand-kept list of phrasings that name no number at all.

    assert not offenders, (
        "these understate the network surface. FIVE commands SEND behind a "
        "flag somebody typed (judge, spec, deliver, graph run/resume reaching "
        "deliver.send, and attest --sign reaching a keyless signer) and three "
        f"FETCH (get, issue, start --clone) — SPEC_GET_V0 §7: {offenders}"
    )


# --- counts a reader counts -----------------------------------------------

NUMBER_WORDS = {
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20,
}

# Deliberately a SEPARATE mapping. `NUMBER_WORDS` is consulted by the
# release-count guards, which scan for "<word> commands" across the runbooks;
# widening it to the small numbers made "Three commands fetch" in README read
# as an unversioned command count. The sender surface is small and needs the
# small words, so it gets its own table rather than a shared one that changes
# what a neighbouring guard sees.
SENDER_NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}


def sender_command_names() -> set[str]:
    """The commands that can reach a network on a flag somebody typed.

    Derived from the parsers, never from a list here: a command is a sender
    when `--send` or `--sign` is registered anywhere in its subtree, so
    `wring graph run --send` and `wring graph resume --send` both make `graph`
    one sender rather than two — the count the documentation states is a count
    of COMMANDS.
    """
    import argparse

    from wringer import cli

    def subcommands(parser: argparse.ArgumentParser) -> dict:
        for action in parser._actions:
            if isinstance(action, argparse._SubParsersAction):
                return action.choices
        return {}

    def carries_flag(parser: argparse.ArgumentParser) -> bool:
        for action in parser._actions:
            if {"--send", "--sign"} & set(action.option_strings):
                return True
        return any(carries_flag(child) for child in subcommands(parser).values())

    return {
        name
        for name, sub in subcommands(cli.build_parser()).items()
        if carries_flag(sub)
    }


def test_the_documented_sender_count_is_the_one_the_parsers_carry():
    """A sixth sender must break this suite, and until now it would not have.

    The guard this replaces checked a hand-kept list of phrasings plus a regex
    banning `(one|two|three|four) ... sends`. That catches UNDERSTATEMENT only,
    and it stops one short of the true number — so adding a sixth sender would
    have left every document saying five and every test green. The direction
    that matters was the one it could not fail in.

    The number now comes from the CLI: which top-level commands register
    `--send` or `--sign` anywhere in their subtree. Every count a document
    states is compared with that, in both directions and with no ceiling.
    """
    derived = sender_command_names()
    assert derived, "no command registers --send or --sign; the parser walk broke"

    words = "|".join(SENDER_NUMBER_WORDS)
    stated = re.compile(
        rf"\b({words})\s+(?:commands?|that)\s+(?:can\s+)?sends?\b", re.IGNORECASE
    )
    searched = (
        sorted(repo_root().glob("*.md"))
        + sorted(repo_root().glob("docs/*.md"))
        + sorted((repo_root() / "src" / "wringer").glob("*.py"))
    )
    offenders, seen = [], 0
    for path in searched:
        if path.name.startswith("field-report"):
            continue
        flat = " ".join(path.read_text(encoding="utf-8").split())
        if path.suffix == ".py":
            flat = re.sub(r'"\s*"', "", flat)
        for hit in stated.finditer(flat):
            # A document may QUOTE a superseded count in order to correct it —
            # SPEC_SIGN_V0 §9 does exactly that with "four commands SEND". The
            # `container images` rule: prose may name the old claim, source may
            # not, because in source the string IS what a user is told.
            if path.suffix == ".md" and f'"{hit.group(0)}' in flat:
                continue
            seen += 1
            if SENDER_NUMBER_WORDS[hit.group(1).lower()] != len(derived):
                offenders.append(f"{path.name}: {hit.group(0)!r}")

    assert seen, (
        "no document states a sender count in a form this guard can read. It "
        "was written because the documented number and the parsers had no "
        "relationship a test could check; a guard that reads nothing has the "
        "same problem"
    )
    assert not offenders, (
        f"the parsers register {len(derived)} commands that can reach a "
        f"network on a typed flag ({', '.join(sorted(derived))}), and these "
        f"documents state a different number: {offenders}"
    )


def registered_command_count() -> int:
    from wringer import cli

    return len(
        [
            name
            for action in cli.build_parser()._actions
            if getattr(action, "choices", None)
            for name in action.choices
        ]
    )


def commands_at_tag(version: str) -> int | None:
    """How many top-level commands a PUBLISHED release registered, or None.

    None means this checkout cannot answer — no git, no tag, no `cli.py` at
    it — and the caller skips rather than guessing. An sdist has no history
    and must not fail here; a wrong answer would be worse than no answer,
    which is the same rule `require_checkout` follows one level up.

    Read off the tagged source by counting `subparsers.add_parser(` rather
    than by importing it: an old `cli.py` is not importable against today's
    modules, and exec'ing a historical file to count its parsers is a much
    larger thing to do than reading it.
    """
    import re as _re
    import subprocess

    for tag in (f"v{version}", version):
        try:
            done = subprocess.run(
                ["git", "show", f"{tag}:src/wringer/cli.py"],
                cwd=repo_root(),
                capture_output=True,
                text=True,
                timeout=30,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        if done.returncode == 0 and done.stdout:
            return len(
                _re.findall(r"\bsubparsers\.add_parser\(", done.stdout)
            )
    return None


def test_the_command_table_heading_counts_the_commands_that_exist():
    """QUICKSTART's heading is where a reader counts, and it said thirteen
    while the parser registered sixteen for three days.

    Only the heading, deliberately. Prose elsewhere says "0.2.0, thirteen
    commands" and that is a true statement about a PUBLISHED release, not a
    claim about this tree — pinning it to the parser would make a fact go
    stale every time main grows a command.
    """
    require_checkout("QUICKSTART.md")
    import re

    text = (repo_root() / "QUICKSTART.md").read_text(encoding="utf-8")
    match = re.search(r"^## The ([a-z]+) commands$", text, re.MULTILINE)
    assert match, "QUICKSTART has no '## The N commands' heading to check"

    claimed = NUMBER_WORDS.get(match.group(1))
    assert claimed is not None, f"unrecognised number word: {match.group(1)!r}"
    assert claimed == registered_command_count(), (
        f"QUICKSTART's heading says {match.group(1)} commands; the parser "
        f"registers {registered_command_count()}"
    )


def test_a_count_tied_to_a_release_says_which_release():
    """The other half. "thirteen commands" is only safe while it sits beside
    the version it describes — on its own it becomes a claim about this tree,
    and a wrong one.

    AGENTS.md joined the list on 2026-08-10, having said "Eighteen commands
    are registered" while the parser registered nineteen. That sentence names
    no release, so it was a claim about this tree and it was wrong — and it
    is the first paragraph every agent working here reads, which is the one
    place a stale number costs the most.
    """
    import re

    for name in ("README.md", "QUICKSTART.md", "AGENTS.md"):
        path = repo_root() / name
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            # Case-insensitive, because a count that opens a sentence is
            # capitalised and the lowercase pattern walked straight past
            # AGENTS.md's "Nineteen commands are registered" — a guard that
            # reads the file and can never fail is worse than no guard.
            match = re.search(r"\b([A-Za-z]+) commands\b", line)
            if not match:
                continue
            claimed = NUMBER_WORDS.get(match.group(1).lower())
            if claimed is None:
                continue
            version = re.search(r"\d+\.\d+\.\d+", line)

            # **A line that names a release is checked against THAT release,
            # first, and regardless of what this tree registers.**
            #
            # Until 2026-08-15 this guard did the opposite: it skipped any
            # line whose count matched the CURRENT parser, then merely
            # required a version string on the rest. Both halves leaked.
            # `0.3.0, nineteen commands` sailed through because the tree
            # happens to register nineteen — a false claim about a published
            # release, invisible precisely while the tree agreed with it —
            # and `0.4.0, seventeen commands` would sail through for ever
            # because naming *a* version was the whole test. Watched to fail
            # both ways before this sentence was written.
            #
            # Ruled on in passing, and it is why this guard exists in this
            # shape: WRINGER_PHASE2's rider 1 asked for README's "seventeen"
            # to become "nineteen". **It is not stale.** v0.3.0's `cli.py`
            # registers exactly seventeen subparsers, so the sentence is TRUE
            # of the release it names, and rewriting it would have put a false
            # claim about a published release into the README — the
            # overstatement half of the defect class SECURITY.md's signing row
            # just cost this repository. The rider's purpose was that the
            # count be guarded; this is that, derived.
            if version is not None:
                shipped = commands_at_tag(version.group(0))
                if shipped is None:
                    continue    # not a tag this checkout has; nothing to check
                assert claimed == shipped, (
                    f"{name} says '{match.group(1)} commands' for "
                    f"{version.group(0)}, which registered {shipped}: "
                    f"{line.strip()!r}"
                )
                continue

            assert claimed == registered_command_count(), (
                f"{name} claims '{match.group(1)} commands' without naming the "
                f"release it belongs to, so it is a claim about THIS tree, "
                f"and the parser registers {registered_command_count()}: "
                f"{line.strip()!r}"
            )


def health_lines(document: str) -> list[str]:
    return [
        line
        for line in workflow_wring_lines(document)
        if line.split()[1:2] == ["health"]
    ]


def one_spelling(text: str) -> str:
    """`${{ runner.temp }}` and `$RUNNER_TEMP` are one directory in two
    dialects — the expression's and the shell's — and a workflow needs both,
    because `with:` has no shell and `run:` has no expression it should be
    trusting. A guard that cannot see they are the same cannot check the join
    between the step that RESTORES the history and the step that READS it,
    which is precisely the join whose failure is silent: point them at
    different paths and everything still runs, every gate just reads
    `untested` for ever.
    """
    return text.replace("${{ runner.temp }}", "$RUNNER_TEMP")


def cache_steps(document: str) -> list[dict]:
    """Every `actions/cache` step, whatever shape of YAML it lives in.

    A workflow's `jobs.*.steps` and a composite action's `runs.steps` are
    different trees; this walks for the step rather than for the path to it,
    so neither shape needs naming here.
    """
    import yaml

    loaded = yaml.safe_load((repo_root() / document).read_text(encoding="utf-8"))
    found: list[dict] = []

    def walk(node) -> None:
        if isinstance(node, dict):
            uses = node.get("uses")
            if isinstance(uses, str) and uses.startswith("actions/cache"):
                found.append(node)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(loaded)
    return found


@pytest.mark.parametrize("document", WORKFLOWS)
def test_the_health_step_reads_a_history_the_same_file_restores_and_saves(
    document: str,
):
    """The spec's first draft said only "run `wring health --json` after
    verify", and that step is INERT: `.wringer/` is gitignored, a fresh
    checkout holds exactly the one bundle `wring verify` just wrote, and one
    run is below the history floor — so every gate on every pull request would
    render `untested`, for ever, in the venue the whole feature is sold on.

    The old DONE box ("the step parses against the real CLI, sends nothing")
    passes against precisely that inert step. This one pins the parts that
    make it work, and pins them against `action.yml` too, where the reader is
    a stranger who referenced one line and will never open the file:

    1. `wring health` is run, and it reads a `--from` directory — read off the
       REAL parser, so `--from` being spelled differently one day reaches this
       guard through argparse rather than past it.
    2. Something restores that directory AND something saves it. Restore-only
       is the quiet version of the same defect: the job reads the same empty
       history every time and the table never fills in.
    3. The directory health reads is the directory the cache step names. Two
       spellings of one path is a join that fails silently.
    4. The file says `untested` somewhere a reader will meet it.
    """
    require_checkout(document)
    text = (repo_root() / document).read_text(encoding="utf-8")

    lines = health_lines(document)
    assert lines, f"{document} never runs wring health"
    read_from: list[str] = []
    for line in lines:
        directories = parsed_wring_line(line).from_dirs
        assert directories, (
            f"the health step reads no restored history, so it can only ever "
            f"print `untested`: {line!r}"
        )
        read_from.extend(directories)

    steps = cache_steps(document)
    assert steps, (
        f"{document} carries nothing across runs, so --from names an empty "
        "directory and the step is inert by another route"
    )
    restores = [
        step for step in steps
        if not step["uses"].startswith("actions/cache/save")
    ]
    saves = [
        step for step in steps
        if not step["uses"].startswith("actions/cache/restore")
    ]
    assert restores, f"{document} saves a history it never reads back"
    assert saves, (
        f"{document} restores a history that nothing ever writes, so every "
        "run reads the same empty directory and every gate stays `untested`"
    )

    def paths_of(group: list[dict]) -> set[str]:
        return {
            one_spelling(str(step.get("with", {}).get("path", "")))
            for step in group
        }

    # BOTH ends, separately. Checking that some cache step somewhere names the
    # directory passes a file that restores from one path and saves to
    # another, which is the same silent nothing with an extra step in it.
    for directory in read_from:
        wanted = one_spelling(directory)
        assert any(wanted in path for path in paths_of(restores)), (
            f"{document} reads history from {directory!r} and restores "
            f"{sorted(paths_of(restores))} — the reader and the restore are "
            "different directories, and a run cannot show you that"
        )
        assert any(wanted in path for path in paths_of(saves)), (
            f"{document} reads history from {directory!r} and saves "
            f"{sorted(paths_of(saves))} — this run's evidence never reaches "
            "the next one, so the history stops growing where nobody looks"
        )

    # The reader is told what a first run looks like, in the file they copy
    # without reading.
    assert "untested" in text, (
        f"{document} never says that a run with no restored history reads "
        "`untested` — which is the first thing every adopter will see"
    )


@pytest.mark.parametrize("document", WORKFLOWS)
def test_what_the_health_step_writes_is_something_the_workflow_reads(
    document: str,
):
    """`--output FILE` exists because a redirect cannot appear in a `wring`
    line (SPEC_HEALTH_V0 §1), and the file it names is only useful if
    something later reads it. A typo'd path is silent: `wring health` still
    runs, still exits 0, and the summary just never gets the table.
    """
    require_checkout(document)
    text = one_spelling((repo_root() / document).read_text(encoding="utf-8"))
    for line in health_lines(document):
        written = parsed_wring_line(line).output
        if written is None:
            continue
        assert text.count(one_spelling(written)) >= 2, (
            f"{document} writes the vitality report to {written!r} and "
            "nothing else in the file names that path, so the report is "
            "written and never read"
        )


@pytest.mark.parametrize("document", WORKFLOWS)
def test_no_shipped_workflow_asks_wringer_to_reach_a_network(document: str):
    """The health step reads a directory somebody else populated. It is the
    workflow that carries evidence between runs, never Wringer — so no `wring`
    line in either file may name a fetch, a send, or a URL."""
    require_checkout(document)
    for line in workflow_wring_lines(document):
        for forbidden in ("--send", "http://", "https://", "--clone"):
            assert forbidden not in line, (
                f"{forbidden} in a {document} wring line: {line}"
            )


@pytest.mark.parametrize("document", WORKFLOWS)
def test_both_shipped_workflows_render_to_the_step_summary(document: str):
    """SPEC_HEALTH_V0 §6: the vitality table renders into the job's step
    summary, "where a reviewer reads it beside the gates". A run that writes
    the report into a file nobody opens is the same inert step in a later
    disguise."""
    require_checkout(document)
    text = (repo_root() / document).read_text(encoding="utf-8")
    assert "GITHUB_STEP_SUMMARY" in text, (
        f"{document} never writes to $GITHUB_STEP_SUMMARY, so whatever it "
        "learned stays in a log nobody opens"
    )


def test_the_action_renders_the_acceptance_artifact_and_decides_nothing():
    """Citadel ruling R3: "the health + acceptance step-summary render inside
    it". Health has a command that renders itself; acceptance does not — the
    artifact is `acceptance.json`, written into the bundle by `wring verify`
    only when an approved `wringer.spec.yaml` declares criteria — so the
    action reads that file.

    What it must not do is form an opinion. The refusal has exactly one venue,
    `wring deliver`, which exits 1 on a bundle whose required, bound criteria
    the record does not evidence. A second decider in YAML would be free to
    drift from the first, and the limits it renders would be a paraphrase
    nobody re-checked — so the artifact's own `limits` travel with the rows.
    """
    require_checkout(ACTION)
    text = (repo_root() / ACTION).read_text(encoding="utf-8")
    # Outside a comment: a file that only MENTIONS the artifact renders
    # nothing, and mentioning it is exactly what a stale action would do.
    running = [
        line for line in text.splitlines() if not line.strip().startswith("#")
    ]
    assert any("acceptance.json" in line for line in running), (
        "action.yml renders no acceptance rows, so a repository that declared "
        "criteria learns nothing about them from the run that could have "
        "answered"
    )
    assert '"limits"' in text, (
        "the acceptance render drops the artifact's own limits — the four "
        "sentences that say what `evidenced` does NOT mean travel with the "
        "numbers or they are not travelling at all"
    )


def test_the_action_says_a_first_run_reads_thin_in_a_comment_and_on_the_page():
    """R3 again, literally: the action "must carry its cache/restore step and
    say in its own comments that a first run reads thin — or the first
    stranger concludes it is broken."

    Both venues, because they are read by different people. The comment is for
    whoever opens the file; the rendered line is for the stranger who never
    will, and who is looking at a job summary where every gate says
    `untested`.
    """
    require_checkout(ACTION)
    lines = (repo_root() / ACTION).read_text(encoding="utf-8").splitlines()
    said = [line for line in lines if "untested" in line]
    assert [line for line in said if line.strip().startswith("#")], (
        "action.yml never explains `untested` in its own comments"
    )
    assert [line for line in said if not line.strip().startswith("#")], (
        "action.yml explains the cold start only in a comment, and the "
        "stranger who referenced it in one line reads the job summary instead"
    )


def test_the_readme_leads_with_the_thesis_and_not_a_deferred_runtime():
    """M3's job definition, and afterwards the re-lead's regression guard.

    The next act's direction (2026-08-09) re-aims the launch: the green-decays
    thesis and neutrality move to the FRONT of the README, because they are
    the argument everything else serves — and a thesis in paragraph four is a
    thesis nobody reads. Three claims, each of which was false when this test
    was written:

    1. The lead carries the thesis: green is suspect, and trust in a passing
       check decays.
    2. The lead carries neutrality: the party holding the receipts has no
       stake in what they say.
    3. The intro no longer promises a durable runtime "tomorrow" — Temporal
       was deferred with a named trigger, not a phase, and a README that
       promises it is a roadmap wearing a landing page.

    Plus the vitality demo, drawn where the claim is made rather than only in
    docs/: a reader should SEE a gate die under green runs from the README.
    """
    require_checkout("README.md")
    text = (repo_root() / "README.md").read_text(encoding="utf-8")
    lead = "\n".join(text.splitlines()[:45])

    assert "green is suspect" in lead, (
        "the README's lead does not carry the thesis — 'code is cheap and "
        "green is suspect' is the sentence the whole next act is built on"
    )
    assert "no stake in what they say" in lead, (
        "the README's lead does not carry neutrality — the one asset no "
        "vendor can copy is buried below the fold again"
    )
    assert "(Temporal first) tomorrow" not in text, (
        "the README still promises a deferred runtime: Temporal is a "
        "tripwire (first external user needing cross-machine durability), "
        "not a phase, and the intro should not promise it"
    )
    assert "docs/health.svg" in text, (
        "the vitality demo is not drawn in the README — the decay recording "
        "is the launch's strongest artifact and it lives only in docs/"
    )


def test_the_goal_is_stated_where_every_window_actually_looks():
    """The anti-drift guard, and it exists because the drift already happened.

    The north star was written and APPROVED on 2026-07-31 — a PM writes what
    they want built, points it at a repo, and the harness builds it. It lived
    in a planning folder outside the repo. Four spec cycles then shipped
    (vacuity, bench, health, acceptance); every one made Wringer better at
    REFUSING, none at BUILDING, and no cycle said it was narrowing, because
    every window opened a spec, found a well-formed backlog and executed it.

    Machinery follows what is written down — this repository's entire thesis —
    so the goal now lives in the two files a window reads first, and this test
    is what keeps it there. A refusal is not the product; it is the reason the
    product's output can be trusted.
    """
    import re

    for name in ("AGENTS.md", "README.md"):
        require_checkout(name)
        # Whitespace-normalised: this prose is hard-wrapped, so "working
        # software" is not a contiguous string in the file. Asserting on the
        # raw text passes only by accident of where a line happens to break.
        # The FIRST 45 lines, not anywhere in the file. "Where every window
        # actually looks" has to mean the top, or this guard passes on a
        # mention buried under four hundred lines of feature prose — which is
        # how the goal was lost the first time. The first version of this test
        # checked the whole file and did not redden when the statement was
        # removed from the top.
        head = "\n".join(
            (repo_root() / name).read_text("utf-8").splitlines()[:45]
        )
        text = re.sub(r"\s+", " ", head)
        # The STATEMENT, not a word from prose discussing it. Two earlier
        # versions of this assertion passed against paragraphs that merely
        # mentioned "working software" while the goal itself had been deleted
        # from the top — a guard that could not fail, which is the thing this
        # repository exists to catch, appearing inside the guard meant to stop
        # the goal being lost. Both halves are required.
        for phrase in ("advanced spec", "working software at enterprise"):
            assert phrase in text, (
                f"{name}'s first 45 lines do not state the goal ({phrase!r} "
                "missing). A window that reads this file will inherit whatever "
                "the newest spec happens to be about, which is exactly how the "
                "goal was lost for four cycles."
            )

    agents = (repo_root() / "AGENTS.md").read_text(encoding="utf-8")
    assert "ships one slice" not in agents, (
        "AGENTS.md still frames this as a single-command evidence compiler. "
        "That framing is what every window inherited while the goal drifted."
    )


def test_the_roadmap_tracks_the_goal_and_not_only_the_features():
    """The rail measured features and could read 12/12 while the factory was
    untouched — which is exactly what happened for four spec cycles.

    Every milestone on it named a command or a doc: verify, loop+fleet,
    spec/plan, issue→MR, attest, bench, graphs, health. All real, all
    shipped, and none of them answers "how close is a PM's spec to becoming
    working software". A picture that can be entirely green while the goal
    has not moved is a measurement of the wrong axis, drawn where a reader
    looks first.

    The F-nodes are the factory blockers from WRINGER_FACTORY.md §3, and they
    are probed on shipped EVIDENCE — a docs artifact — the way P6, P7 and P8
    are, never on registration. F1's evidence is the fix's own test, because
    a graph budget that no longer charges a person for thinking is a
    behaviour, not a file."""
    import sys

    sys.path.insert(0, str(repo_root() / "scripts"))
    import roadmap_render

    labels = [m.label for m in roadmap_render.MILESTONES]
    factory = [label for label in labels if label.startswith("F")]
    assert len(factory) >= 5, (
        f"the roadmap tracks no factory blockers: {labels}. It can read all "
        "green while a PM's spec is no closer to working software."
    )

    # Derived, not hand-kept: every F-node the plan names must be on the rail.
    plan = Path.home() / "Claude" / "WRINGER_FACTORY.md"
    if plan.is_file():
        import re

        named = set(re.findall(r"\*\*(F\d)\b", plan.read_text(encoding="utf-8")))
        missing = sorted(named - set(factory))
        assert not missing, f"WRINGER_FACTORY.md names {missing}, the rail does not"


# --- the two documents that must agree about the de-scope -----------------
#
# Third occurrence of one defect class. A claim is corrected; a sibling
# document that says the same thing in different words is not; and the repo
# ships two answers to one question. It cost SECURITY.md's signing row, then
# `backend.LIMITS_V1`, and then — on 2026-08-16 — `docs/witness-programme.md`
# said "the de-scope has NOT fired" while README.md carried the retreat box
# that fired it, forty lines above a paragraph saying the re-test had not
# happened. All three were caught by a person reading, which is the part that
# does not scale.

BUG_FIX_CLAIM = "reproduction witness"

STALE_DE_SCOPE_STATUS = re.compile(
    r"de-scope\s+(?:has\s+)?not\s+fired"
    r"|not\s+(?:yet\s+)?happened\s+is\s+the\s+live\s+re-test"
    r"|(?:live\s+)?re-test\s+(?:has\s+)?not\s+(?:yet\s+)?(?:happened|run|ran)"
    r"|not\s+(?:yet\s+)?been\s+re-tested",
    re.IGNORECASE,
)


def own_voice(text: str) -> str:
    """A document's own claims, with quoted material removed.

    The retreat box quotes the claim it withdraws; the programme document
    keeps its superseded status paragraph under a `>` so a reader can see
    what it used to say. Both are a document REPORTING a claim rather than
    making one, and a guard that cannot tell the two apart would force these
    documents to delete their own history in order to stay green — which is
    the opposite of the discipline it is here to enforce. Same rule the
    sender-count guard already applies to quoted counts.
    """
    return "\n".join(
        line for line in text.splitlines() if not line.lstrip().startswith(">")
    )


def de_scope_fired(readme: str) -> bool:
    """Whether the bug-fix de-scope has fired, read off the MECHANIC.

    `WRINGER_RULING_2026-08-15` Q1 mechanic 3 defines the de-scope as exactly
    one edit — R2's bug-fix sentence comes out of the README — so the question
    is answerable from the README's own voice and needs no sentence that could
    itself go stale. That is deliberate: every stale sentence this class has
    produced was prose ABOUT the answer, so a guard reading prose about the
    answer would have gone stale with them.
    """
    return BUG_FIX_CLAIM not in own_voice(readme)


def de_scope_firing_commit() -> tuple[str, str] | None:
    """`(sha, parent_sha)` where `de_scope_fired` first became true.

    Derived from history rather than pinned to a commit somebody typed, and
    the walk doubles as this guard's negative control: the parent classifies
    as NOT fired on real committed bytes, so the classifier is watched saying
    both things about the same repository rather than trusted to be able to.

    None when this checkout cannot answer — no git, no history, a shallow
    clone — and the caller skips rather than guessing, which is the rule
    `commands_at_tag` follows one level up.
    """
    import subprocess

    def readme_at(rev: str) -> str | None:
        try:
            done = subprocess.run(
                ["git", "show", f"{rev}:README.md"],
                cwd=repo_root(),
                capture_output=True,
                text=True,
                timeout=30,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        return done.stdout if done.returncode == 0 else None

    try:
        listed = subprocess.run(
            ["git", "log", "--format=%H", "--", "README.md"],
            cwd=repo_root(),
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if listed.returncode != 0 or not listed.stdout.strip():
        return None

    # Newest first, so the transition is found in a handful of reads.
    for sha in listed.stdout.split():
        here = readme_at(sha)
        before = readme_at(f"{sha}^")
        if here is None:
            return None
        if before is None:      # the root commit; nothing before it to compare
            return None
        if de_scope_fired(here) and not de_scope_fired(before):
            return sha, f"{sha}^"
    return None


def test_the_readme_and_the_witness_programme_agree_about_the_de_scope():
    """The sibling-status guard, and it is derived on the half that matters.

    What it buys, stated honestly so nobody mistakes it for more: the fired /
    not-fired FACT is derived from the mechanic and is not hand-copied from
    anything. The sibling check is a family of negations rather than a proof —
    it catches the shapes this failure has actually taken, and a sufficiently
    inventive rewording would slip past it. That is the most a prose status
    admits, and it is strictly more than the nothing that was guarding it
    while two documents disagreed in print.
    """
    require_checkout("README.md", "docs/witness-programme.md")
    root = repo_root()
    readme = (root / "README.md").read_text(encoding="utf-8")
    programme = (root / "docs" / "witness-programme.md").read_text("utf-8")

    fired = de_scope_fired(readme)

    for name, text in (
        ("README.md", readme),
        ("docs/witness-programme.md", programme),
    ):
        stale = STALE_DE_SCOPE_STATUS.search(" ".join(own_voice(text).split()))
        if fired:
            assert stale is None, (
                f"the de-scope HAS fired — R2's bug-fix sentence is out of "
                f"README.md's own voice — and {name} still says it has not, "
                f"in its own voice: {stale.group(0)!r}. This is the third time "
                f"a correction has landed in one document and not its sibling."
            )
        else:
            assert stale is not None, (
                f"README.md still claims the bug-fix witness, so the de-scope "
                f"has NOT fired, and {name} says nothing to that effect. A "
                f"status document that goes silent is how the last one went "
                f"stale."
            )

    if not fired:
        return

    found = de_scope_firing_commit()
    if found is None:
        pytest.skip("this checkout cannot resolve the firing commit from git")
    sha, parent = found

    # The negative control, on committed bytes rather than a fixture: the
    # classifier must say NOT-fired about the parent of the commit it says
    # fired it. A guard that can only ever return one answer is the shape
    # this repository keeps catching in other people's tests.
    assert not de_scope_fired(
        __import__("subprocess").run(
            ["git", "show", f"{parent}:README.md"],
            cwd=root, capture_output=True, text=True,
        ).stdout
    ), f"{parent} classifies as fired too, so the classifier cannot fail"

    assert sha[:7] in programme, (
        f"the de-scope fired at {sha[:7]} and docs/witness-programme.md — the "
        f"document whose whole purpose is that a future window can execute "
        f"and audit the retreat without the ruling files — does not name that "
        f"commit. The sha is derived from history here, not typed, so this "
        f"fails when the retreat moves and the schedule does not follow it."
    )
