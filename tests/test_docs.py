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
from core_helpers import declares_itself_preserved, reader_facing_pages


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


# --- the runbooks, DISCOVERED rather than listed -----------------------------
#
# This was `("SETUP.md", "QUICKSTART.md", "README.md")` until 2026-08-23 — the
# three pages that were runbooks on the day somebody typed the tuple. The
# repository has grown `INSTALL.md`, `START-HERE.md`, `docs/drive/START-HERE.md`
# and a dozen `docs/*.md` pages with shell blocks in them since, and every one
# of them was outside four guards whose names begin "no runbook".
#
# That is the QUICKSTART defect exactly: a guard covering less than its name
# claims, passing green, for as long as nobody thinks to re-read the list.
# Scope is discovered now, so a page added tomorrow inherits these guards
# instead of needing somebody to remember it.
#
# **Captures excluded, and they are the reason these guards exist.**
# `docs/field-report-2026-08-05.md` is the run that MEASURED both broken
# commands. Its transcripts of them are primary evidence and are preserved
# verbatim; holding it to today's rules would delete the finding.
def runbooks() -> list[Path]:
    """Every page a reader follows instructions from."""
    return reader_facing_pages(captures=False)


def runbook_names() -> list[str]:
    return [path.relative_to(repo_root()).as_posix() for path in runbooks()]


def runbook_text(name: str) -> str | None:
    path = repo_root() / name
    return path.read_text(encoding="utf-8") if path.is_file() else None


def test_the_discovered_scope_is_wider_than_the_list_it_replaced():
    """**The guard on the audit itself, 2026-08-23.**

    A derivation that quietly returns three pages is the hand list with extra
    steps, and it would pass every guard downstream of it while covering
    exactly what the tuple did. So the discovery is checked for the property
    that made it worth doing: it finds runbooks nobody listed.

    `INSTALL.md` is named because it is the specific page the old tuple
    missed — planting `container images pull` in it reddens all four runbook
    guards now and reddened none of them before.

    The capture exclusion is asserted in the same breath, because a
    derivation that swallowed `docs/field-report-2026-08-05.md` would demand
    the deletion of the measurement these guards exist to preserve.
    """
    require_checkout("INSTALL.md", "QUICKSTART.md", "SETUP.md")
    found = set(runbook_names())

    assert {"INSTALL.md", "QUICKSTART.md", "README.md", "SETUP.md"} <= found
    assert len(found) > 4, (
        f"the runbook scope discovered only {sorted(found)}; a derivation "
        "this narrow is a hand-kept list that costs more to read"
    )
    assert "docs/field-report-2026-08-05.md" not in found, (
        "the field report is a capture — its transcripts of the two broken "
        "commands are the evidence these guards were written from"
    )


def test_the_prose_scope_is_wider_than_the_seven_names_it_replaced():
    """**Found by sweeping this window's own change, 2026-08-23.**

    `guarded_prose()` replaced a tuple of seven filenames. Reverting it to
    that tuple — the exact defect this window exists to remove — reddened
    NOTHING: the derivation was itself unevidenced, and a later window could
    have narrowed it back with the suite green the whole way.

    Nine scopes were derived in this window and only four had a guard like
    this one. That ratio is the finding, and it is why the four missing ones
    were written before it shipped.
    """
    require_checkout("README.md", "docs/graphs.md")
    scope = set(guarded_prose())
    assert {"README.md", "AGENTS.md", "SECURITY.md"} <= scope
    assert "docs/graphs.md" in scope, (
        "the prose guards have stopped reading docs/, which is where most of "
        "this project's prose lives — and where four unguarded totality "
        "claims were found the day this scope was derived"
    )
    assert len(scope) > 20, (
        f"the prose scope discovered only {len(scope)} pages; the tuple it "
        "replaced had seven, and a derivation that narrow is that tuple with "
        "extra steps"
    )
    # The records rule still bites, or the exclusion has quietly stopped
    # excluding and every spec is about to be held to today's facts.
    assert not any(name.startswith("docs/specs/") for name in scope)
    assert "CHANGELOG.md" not in scope


def test_the_runbook_warning_escape_hatch_cannot_open_to_anything():
    """The discrimination that lets a page SPELL the broken command.

    Sweeping this window's change showed the escape hatch was unpinned:
    replacing the whole predicate with `True` reddened nothing, so a later
    window could widen it to "any mention anywhere" and the guard would keep
    reporting green while permitting exactly what it forbids.

    Asked of the predicate directly, because a page-level test can only show
    that today's pages pass.
    """
    warns = (
        "SETUP.md said `container images pull`, which does not exist (AC-01)",
        "`container images list` was measured to fail on Apple container 1.2.0",
        "the subcommand is `image`, singular",
    )
    for sentence in warns:
        assert _NAMES_IT_TO_WARN.search(sentence), sentence

    bare = (
        "Run `container images pull ghcr.io/marcoakes/wringer:main` to begin.",
        "Then check the image is present.",
        "This step needs a container runtime on the machine.",
    )
    for sentence in bare:
        assert not _NAMES_IT_TO_WARN.search(sentence), (
            f"{sentence!r} would license spelling a command measured to fail, "
            "with nothing around it telling the reader so"
        )


def test_a_correction_far_from_the_stale_claim_does_not_license_it():
    """The credential guard's window, pinned at the predicate.

    The sweep showed that widening the 400-character window to the whole file
    reddened nothing — so the guard could quietly become "this page mentions
    the new wording somewhere", which any page discussing the change would
    satisfy while still asserting the old claim in its own voice.
    """
    near = (
        "the promise that it never touches a credential. "
        "Dated correction: it never stores a credential."
    )
    far = (
        "it never touches a credential." + (" filler." * 200)
        + " elsewhere the page says it never stores a credential."
    )
    stale = re.compile(r"never\s+touches\s+a\s+credential", re.I)

    def permitted(text: str) -> bool:
        found = stale.search(text)
        window = " ".join(
            text[max(0, found.start() - 400): found.end() + 400].split()
        ).lower()
        return _CORRECTED_PROMISE in window

    assert permitted(near)
    assert not permitted(far), (
        "a correction 2000 characters away licensed the stale claim beside "
        "it; the window is what makes this a correction rather than a page "
        "that happens to contain both sentences"
    )


def test_the_preserved_banner_exempts_a_draft_and_NOT_the_front_door():
    """**The guard on the most dangerous rule this audit added.**

    A page whose opening says it is kept stale on purpose is a record, and
    `docs/show-hn-draft.md` is one: it states that editing its numbers to say
    `0.3.0` would assert a check nobody had run. That is the correct reason
    and the exemption is right.

    The danger is the same sentence appearing somewhere else. `AGENTS.md:83`
    and `docs/factory-dry-run.md:236` both contain the words while describing
    some OTHER page's staleness, and a rule keyed on them appearing anywhere
    would have quietly exempted the front door from every guard in this file
    — turning one audit fix into a much larger hole than the one it closed.

    So the words must be in the OPENING, and that is what this pins.
    """
    require_checkout("AGENTS.md", "docs/show-hn-draft.md", "docs/factory-dry-run.md")
    root = repo_root()

    assert declares_itself_preserved(root / "docs/show-hn-draft.md")
    for live in ("AGENTS.md", "docs/factory-dry-run.md", "README.md"):
        assert not declares_itself_preserved(root / live), (
            f"{live} is being read as a preserved record, which would take it "
            "out of every guard here. The banner must be in the OPENING"
        )

    covered = {
        path.relative_to(root).as_posix()
        for path in reader_facing_pages(captures=False)
    }
    assert "AGENTS.md" in covered and "README.md" in covered
    assert "docs/show-hn-draft.md" not in covered


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


@pytest.mark.parametrize("name", runbook_names())
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


#: A page NAMING the broken command in order to warn about it is doing the
#: right thing — "a warning that cannot spell the wrong command is not a
#: warning", which is the sibling guard's own ruling. The discrimination is
#: what the sentence DOES, not which file it is in: routing on facts rather
#: than on a name is how the rest of this repository decides these.
_NAMES_IT_TO_WARN = re.compile(
    r"does not exist|is not a subcommand|not a subcommand|measured to fail|"
    r"never appearing|which is wrong|the broken form|failed \(AC-|"
    r"corrected the command|singular",
    re.I,
)


@pytest.mark.parametrize("name", runbook_names())
def test_no_runbook_spells_the_two_measured_failures_anywhere(name: str):
    """The two exact forms a field run watched fail, in prose or in code.

    **The scope widened on 2026-08-23 and the rule had to get sharper.**
    "There is no context in which either is the right thing to write down"
    was true of the three pages this guard used to run over, and false of the
    corpus: `docs/MANUAL_CHECKS.md:56` spells `container images pull` in order
    to record that `SETUP.md` once said it and that it does not exist. That is
    the sentence doing its job.

    So the check is no longer "does this string appear" but "does it appear
    with nothing around it saying it is wrong" — which is the rule the
    original was reaching for, enforced by keeping pages off a list.
    """
    text = runbook_text(name)
    if text is None:
        pytest.skip(f"{name} is not in this repo")
    for wrong in ("container images pull", "container images list"):
        for found in re.finditer(re.escape(wrong), text):
            window = " ".join(
                text[max(0, found.start() - 300): found.end() + 300].split()
            )
            assert _NAMES_IT_TO_WARN.search(window), (
                f"{name} contains `{wrong}` with nothing around it saying so, "
                "and it was measured to fail on Apple `container` 1.2.0 "
                "(field report 2026-08-05, AC-01). The subcommand is `image`, "
                "singular. To NAME the broken form, say in the same breath "
                "that it does not exist."
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


@pytest.mark.parametrize("name", runbook_names())
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


@pytest.mark.parametrize("name", runbook_names())
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
    show is the one where a human types a secret, and why.

    **A hand list, and it is the right shape here (audit, 2026-08-23).** This
    asks whether SOMEBODY says it, not whether every page does — `assert
    found`, not `assert not offenders`. Discovery cannot help: widening the
    search only makes a positive easier to satisfy, so it would weaken the
    guard rather than strengthen it. The two names are where the sentence is
    expected to live, and if one is renamed this goes red asking about it,
    which is the safe direction.
    """
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
    claim the artifact cannot support.

    Hand list for the same reason as the guard above: this is an existence
    check, and a wider scope makes an existence check easier to pass.
    """
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

# **A HAND LIST ON PURPOSE, and the reason is the direction of the check.**
#
# Which documents must CARRY the promise verbatim is an editorial decision — a
# repository cannot discover that a page it has never seen was supposed to
# recite a paragraph. Discovery answers the opposite question (which pages
# state something false), and that half IS derived, in
# `test_no_document_still_claims_wringer_never_touches_a_credential`.
#
# What the audit DID change here: the guard below filtered each name through
# `is_file()`, so a renamed page dropped out of its own check without a word.
# It now says so — `require_checkout` skips with a reason instead, which is the
# difference between a list that is deliberate and a list that is stale.
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
    require_checkout(*DOCS_CARRYING_THE_PROMISE)
    missing = [
        name
        for name in DOCS_CARRYING_THE_PROMISE
        if normalised(PROMISE)
        not in normalised((repo_root() / name).read_text(encoding="utf-8"))
    ]
    assert not missing, f"the approved promise wording is missing from {missing}"


#: The corrected wording. A page that names BOTH forms is recording the change
#: — `SPEC_START_V0.md` §6.1 does exactly that, and the record is the reason
#: anybody can check the claim narrowed honestly rather than quietly.
_CORRECTED_PROMISE = "never stores a credential"


def test_no_document_still_claims_wringer_never_touches_a_credential():
    """The claim that stopped being true. `wring start` handles one.

    **Scope DISCOVERED, not listed — and the widening found two live pages.**
    This guard ran over five hand-named documents until 2026-08-23. Pointed at
    the whole corpus it immediately found `docs/attest-and-audit.md` and
    `SPEC_PROVENANCE_V0.md` ruling 1 still citing *"never touches a
    credential"* as the product's most distinctive promise — the first
    corrected in place, the second by dated note, because a spec preserves the
    reasoning it was decided on.

    A page may still QUOTE the old wording when it names the new one in the
    same breath: that is a record of the correction, and deleting it would
    hide that the claim ever narrowed.
    """
    # **Whitespace-tolerant in BOTH directions, and both halves cost a red.**
    # This prose is hard-wrapped, so neither the stale claim nor the correction
    # beside it is a contiguous string in the file: the dated note added to
    # `SPEC_PROVENANCE_V0.md` breaks across a line between "STORES a" and
    # "credential". A guard matching literals would have demanded a correction
    # and then been unable to see it.
    stale = re.compile(r"never\s+touches\s+a\s+credential", re.I)
    offenders = []
    for path in reader_facing_pages():
        text = path.read_text(encoding="utf-8")
        for found in stale.finditer(text):
            window = " ".join(
                text[max(0, found.start() - 400): found.end() + 400].split()
            ).lower()
            if _CORRECTED_PROMISE in window:
                continue
            line = text[: found.start()].count("\n") + 1
            offenders.append(f"{path.relative_to(repo_root()).as_posix()}:{line}")
    assert not offenders, (
        f"{offenders} still claim Wringer never touches a credential. It "
        "prompts for one now; the true claim is that it never STORES one. "
        "A page recording the correction must name both forms together"
    )


# --- enumerations that `wring start` made false ---------------------------


def test_the_network_enumerations_name_wring_start():
    """§3e-i — `docs/specs/SPEC_GET_V0.md` and `AGENTS.md` both enumerate the network
    surface EXACTLY: three SEND commands, two FETCH. Cloning makes
    `wring start` the third fetcher, and both enumerations become false the
    moment it ships. Restated in the same commit as the capability, rather
    than quietly kept.

    **A hand list, named on purpose (audit, 2026-08-23).** These two documents
    enumerate the network surface EXACTLY, and this guard asserts the CONTENT
    of that enumeration in each — it cannot be pointed at a page that does not
    make the claim, because the assertion would then demand a sentence the
    page never intended to carry. The general half is elsewhere and IS
    derived: `tests/test_network_surface.py` reads the real senders, so a
    third fetcher cannot ship unnoticed even if a third page enumerates them.
    """
    for name in ("docs/specs/SPEC_GET_V0.md", "AGENTS.md"):
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
    docs/specs/SPEC_ENV_V0.md on 2026-08-16, which is the sixth occurrence of
    this class.

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
    binding documents is one the next agent reads and trusts.

    **The specs moved to `docs/specs/` on 2026-08-19 and this guard went
    VACUOUS**: it globbed `SPEC_*.md` in the repository root, found nothing,
    computed an empty `missing`, and passed. A guard that keeps passing after
    its subject moves is worse than no guard, because it reads as coverage.

    So it now asserts it FOUND some — the shape this repository keeps having
    to relearn, most recently four times in one day.
    """
    require_checkout("AGENTS.md")
    text = (repo_root() / "AGENTS.md").read_text(encoding="utf-8")
    specs = sorted((repo_root() / "docs" / "specs").glob("SPEC_*.md"))
    assert len(specs) > 10, (
        f"only {len(specs)} spec documents found under docs/specs/ — this "
        "guard would pass while checking almost nothing. Did they move again?"
    )
    # **Scoped to the TABLE, and it went vacuous a second way without it**
    # (2026-08-30). Searching the whole file meant a mention anywhere
    # satisfied it — and the module map at the bottom names every spec — so
    # `SPEC_CERTIFICATE_V0`, `SPEC_COVERAGE_V0` and `SPEC_FALSIFY_V0`, the
    # contracts defining 0.5.0/0.5.1/0.5.2, were absent from the hierarchy
    # for three releases with this guard green. Its own docstring already
    # records going vacuous once when the specs moved directory.
    start = text.index("### Document hierarchy")
    table = text[start:]
    end = table.find("\n## ")
    table = table[:end] if end != -1 else table
    assert table.count("|") > 40, (
        "the hierarchy table was not found where this guard looks for it"
    )
    missing = [path.name for path in specs if path.name not in table]
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


# --- the redaction ceiling, stated where a reader will meet it -------------
#
# 0.7.4, run 4B (2026-09-01). SECURITY.md said redaction "knows about values
# that are in the environment of the run" — true, and after the two tiers
# below the whole value it would have been an UNDERSTATEMENT that hid the
# tiers' own limits (a five-character head survives; an interior run
# survives; an unmeasured vendor's echo survives). A page that undersells
# a boundary is as stale as one that oversells it (SECURITY.md's own dated
# note of 2026-08-15 says so about containment), and the overclaim is one
# careless edit away: "all secrets".


def test_SECURITY_states_the_redaction_tiers_WITH_their_ceiling():
    """The two tiers, the floor, the interior-run limit, the vendor table as
    the shapes' only home, and the run that measured why — each named, and
    no sentence claiming all secrets. Reverting the paragraph alone is red."""
    require_checkout("SECURITY.md")
    text = normalised((repo_root() / "SECURITY.md").read_text(encoding="utf-8"))
    for needle in (
        "prefix or suffix of a declared value",
        "six or more characters",
        "every measured credential shape",
        "src/wringer/agents.py",
        "INTERIOR run",
        "run 4B",
    ):
        assert needle in text, f"SECURITY.md no longer states: {needle!r}"
    overclaims = re.findall(
        r"\b(?:scrubs|redacts|removes|catches|erases)\s+(?:all|every)\s+secrets?\b",
        text,
        re.IGNORECASE,
    )
    assert not overclaims, f"SECURITY.md claims more than the tiers do: {overclaims}"


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

    This guard USED to name README.md, AGENTS.md and docs/specs/SPEC_GET_V0.md. That is
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
                re.findall(r"\bsubparsers\.add_parser\(", done.stdout)
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

    for name in guarded_prose():
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

    **The two names are the CLAIM, not a scope (audit, 2026-08-23).** "Where
    every window actually looks" means these two files and nothing else;
    discovering more pages and requiring the goal in all of them would be a
    different, sillier guard. `require_checkout` makes a rename a stated skip
    rather than a silent pass.
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

    **Two documents by name, and that IS the subject (audit, 2026-08-23).**
    This guard is a relationship between one page's status sentence and
    another's, not a rule applied to a scope. Discovering a third page would
    not give it a third thing to compare — it would give it nothing.
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


# --- INSTALL.md: the prompt a PM's own agent executes ----------------------

INSTALL = "INSTALL.md"


def install_prompt_lines() -> list[str]:
    """Every command inside INSTALL.md's fenced prompt block.

    The prompt is what a stranger pastes into an agent without reading it
    closely, so a `wring` line that argparse would reject is a stranger's
    install failing at the one step they cannot debug. Parsed with the REAL
    parser, exactly as the shipped workflows are.
    """
    text = (repo_root() / INSTALL).read_text(encoding="utf-8")
    inside = False
    found = []
    for line in text.splitlines():
        if line.startswith("```"):
            inside = line.strip() == "```text"
            continue
        if not inside:
            continue
        stripped = line.strip()
        if stripped.startswith("wring ") or stripped.startswith("wringer-board "):
            found.append(stripped.split("#")[0].strip())
    return found


def test_every_wring_line_in_the_install_prompt_parses():
    """**The core's half of the recipe guard, split by dependency direction.**

    This repository can parse its own `wring` lines and cannot import
    `wringer_board`, so it checks the `wring` ones here and the board's suite
    checks the `wringer-board` ones. Neither guard silently covers less than it
    looks: this one asserts it found some, and skips the board's lines WITH A
    NAMED REASON rather than passing over them quietly.
    """
    lines = [row for row in install_prompt_lines() if row.startswith("wring ")]
    assert lines, f"{INSTALL}'s prompt invokes `wring` nowhere"
    for line in lines:
        try:
            parsed_wring_line(line)
        except SystemExit as stopped:
            assert stopped.code == 0, f"{INSTALL} cannot run `{line}`"


def test_the_board_lines_are_checked_by_the_BOARD_and_this_says_so():
    """The other half is not missing; it is somewhere else, on purpose.

    `wringer-board` is a separate package this repository does not depend on,
    so a guard here would have to shell out or guess. `wringer-board`'s
    `tests/test_install_prompt.py` reads this same file and parses them with
    its own real parser. This test exists so the split is STATED rather than
    looking like an omission.
    """
    board_lines = [
        row for row in install_prompt_lines()
        if row.startswith("wringer-board ")
    ]
    assert board_lines, f"{INSTALL}'s prompt invokes `wringer-board` nowhere"
    pytest.importorskip(
        "wringer_board",
        reason="wringer-board is a separate package and is not a dependency of "
        "this one; its own suite parses these lines with its own parser. This "
        "skip is the split being stated, not a gap",
    )


def test_the_install_prompt_never_asks_for_a_credential():
    """**M-2's boundary, guarded.** The prompt tells an agent to install two
    tools. It must never ask a person for a key, and must never put one on a
    command line — the only credential act anywhere in the flow is the
    OS-prompted masked step, which is outside the prompt block on purpose."""
    text = (repo_root() / INSTALL).read_text(encoding="utf-8")
    block = text.split("```text", 1)[1].split("```", 1)[0]
    lowered = block.lower()
    for forbidden in ("api_key", "api key=", "-w ", "export anthropic", "sk-"):
        assert forbidden not in lowered, forbidden
    # And the masked step, which IS shipped, never carries a value.
    assert "add-generic-password -U -s <vendor>-api-key -a wringer -w\n" in text, (
        "the documented command lost its -U — without it a second run "
        "discards the key the person just typed and keeps the old one "
        "(field report 2026-08-21, finding 2, reproduced in an isolated "
        "keychain: exit 45, old value retained)"
    )
    assert "-w sk-" not in text
    assert "-w $" not in text


def test_the_install_prompt_forbids_sudo_and_sending():
    block = (repo_root() / INSTALL).read_text(encoding="utf-8")
    assert "Do not use sudo" in block
    assert "Do not run `wring deliver --send`" in block


# --- H-3: totality claims must be guarded, or exempted with a reason -------


# A totality word next to a backticked, enumerated list. SCOPED to that shape
# on purpose (Fable ruling H-3): the grep needs something mechanical to key on,
# and a list offered as a sample is not what goes stale — a list offered as
# EXHAUSTIVE is.
_TOTALITY = re.compile(
    r"\b(every|all|both|the (two|three|four|five|six|seven|eight|nine|ten))\b",
    re.I,
)
# Two or more backticked items separated by commas / "and" / "or" — an
# enumeration, not a single name mentioned in passing.
_ENUMERATION = re.compile(r"`[^`]+`(\s*(,|and|or|·|/)\s*`[^`]+`)+")

# Prose this repository ships to a reader. Not `tests/`: a test that enumerates
# is a guard, which is the thing being asked for rather than the thing at risk.
#
# **DISCOVERED since 2026-08-23.** This was a tuple of seven files, and the
# comment above it already described a RULE — "prose this repository ships to
# a reader", "not `tests/`" — which is a rule a directory walk can apply. The
# seven were simply the pages somebody remembered. `docs/` was outside all of
# it, and `docs/` is where most of this project's prose lives.
#: **RECORDS, which enumerate by their nature.** A page whose job is to record
#: is not restated when the code changes — it is amended by dated note, and
#: this repository has ruled that twice. `docs/specs/` holds binding contracts
#: (`SPEC_EXEC_V0` enumerating the conditional siblings is the contract, not a
#: product claim); `CHANGELOG.md` is dated history, where every entry is true
#: of its own release for ever.
#:
#: Stated as a rule and applied by path convention, so a spec written next
#: month inherits the exclusion without anybody adding it to a list. That is
#: the same reasoning as the derivation itself, pointed the other way.
#:
#: The two named pages are the same kind of thing without the path to prove
#: it, so each carries its reason here rather than being quietly absent:
#:
#:   docs/MANUAL_CHECKS.md         a running log of runs on real machines.
#:                                 "Both probes now use tools the image has"
#:                                 is a note about one measurement on one day,
#:                                 not a promise about the product.
#:   docs/ARCHITECTURE-NORTHSTAR.md  a design a future version aims at.
#:                                 "Every `loop` and `agent_step` declares:"
#:                                 describes a shape nothing ships yet, so
#:                                 there is no symbol for it to cite.
_RECORDS = (
    "docs/specs/",
    "CHANGELOG.md",
    "docs/MANUAL_CHECKS.md",
    "docs/ARCHITECTURE-NORTHSTAR.md",
)

#: A sentence that dates ITSELF is history, and history may enumerate a list
#: that has since changed. Deliberately narrower than the release-ceiling
#: guard's `_DATED`: no bare "before" or "until", because those are ordinary
#: prose outside a sentence about versions.
_HISTORY_SENTENCE = re.compile(
    r"dated note|used to|no longer|superseded|was the ruling|at the time|"
    r"originally|shipped later",
    re.I,
)


def guarded_prose() -> list[str]:
    """Every page whose claims are held to what is true today.

    Captures excluded: a capture asserts what was true on its date, which is
    the one kind of stale sentence this repository keeps on purpose.
    """
    root = repo_root()
    return [
        name
        for name in (
            path.relative_to(root).as_posix()
            for path in reader_facing_pages(captures=False)
        )
        if not name.startswith(_RECORDS)
    ]

# **Per-item exemptions, each with a REASON STRING.** The house shape, and the
# same one `test_sign.py` and the board's mapping use. An exemption with no
# reason is a silenced guard; an exemption with one is a decision somebody can
# argue with later.
#
# Keyed on a distinctive substring of the sentence.
# **EMPTY, and that is the result rather than the starting point.** The ruling
# expected this list to be needed and it was not: all three sentences the guard
# found were real totality claims that could be, and now are, derived — two
# name `tests/test_network_surface.py` and one names a test written for it.
# An exemption is available and none is currently justified.
_TOTALITY_EXEMPTIONS: dict[str, str] = {}


# **ADJACENCY is what makes this mechanical rather than a vibe.** The ruling
# scopes the guard to a totality word *adjacent to* a backticked enumeration,
# and without a distance the grep matches any paragraph that happens to contain
# both — twenty table cells and a sentence about sockets three clauses away.
# Sixty characters is the window: "every loop outcome — `a`, `b`, `c`" fits,
# and two unrelated clauses in one sentence do not.
_ADJACENT_CHARS = 60


def _totality_sentences(text: str) -> list[str]:
    """Sentences carrying a totality word ADJACENT to a backticked list.

    Markdown table rows are excluded, and that is a real limit rather than
    convenience: a `|`-delimited row is several independent cells on one line,
    so "adjacent" means nothing across it. Table claims are guarded the way
    they always have been — by the derived checks their own cells name.
    """
    found = []
    for raw in re.split(r"(?<=[.!?])\s+|\n\n", text):
        line = " ".join(raw.split())
        if not line or line.startswith(("```", "|--", "$ ")) or " | " in line:
            continue
        for word in _TOTALITY.finditer(line):
            for listed in _ENUMERATION.finditer(line):
                gap = listed.start() - word.end()
                if 0 <= gap <= _ADJACENT_CHARS:
                    found.append(line)
                    break
            else:
                continue
            break
    return found


def test_every_totality_claim_over_a_backticked_list_is_guarded_or_exempt():
    """**H-3 — the programme's own defect class, answered by its own method.**

    Seven confirmed stale totality claims so far, and THREE of the seven were
    found by an agent sent to look at something else. Every catch has been
    luck-shaped. `docs/graphs.md` said "Every loop outcome —" and named six of
    eight; `docs/specs/SPEC_BOARD_V0.md` said "the two integrity values are in no
    collection" for three days after the collection landed.

    So: a totality word ("every", "all", "both", "the four") sitting next to a
    backticked ENUMERATION, in prose this repository ships, must either name a
    derived check in the same breath or carry a per-value exemption with a
    reason string. Noisy is acceptable — the ruling says so — and **weakening
    the claim to dodge guarding it is refused permanently**: a list offered as
    a sample ages honestly and says less, and the totality claims are the ones
    a reader can act on.

    What this deliberately does NOT cover, stated so the coverage is not
    overread: prose without backticks, a backticked list with no totality word,
    and anything under `tests/` (a test that enumerates IS a guard). This
    catches the mechanical shape, not the idea.
    """
    unguarded = []
    for name in guarded_prose():
        path = repo_root() / name
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        # **The PARAGRAPH, not the sentence**, for the naming check. SECURITY.md
        # names `tests/test_network_surface.py` in the sentence AFTER the claim,
        # which is perfectly good prose and was a false positive in the first
        # draft of this guard. Detection stays sentence-level, because that is
        # where adjacency means something.
        paragraphs = text.split("\n\n")
        for sentence in _totality_sentences(text):
            if any(key in sentence for key in _TOTALITY_EXEMPTIONS):
                continue
            head = sentence[:60]
            near = next(
                (
                    " ".join(block.split())
                    for block in paragraphs
                    if head in " ".join(block.split())
                ),
                sentence,
            )
            # Prose that NAMES its own guard is guarded, and saying so is what
            # makes the claim checkable by a reader too.
            #
            # **A BARE TEST NAME COUNTS — 2026-08-23.** The scope widened to
            # the corpus and the first thing it reported was
            # `docs/brief-quality.md`, which names its two guards as
            # `test_a_subdirectory_of_the_specs_repo_still_sees_the_spec` and
            # a sibling. That is a more useful citation than a filename and
            # the pattern could not see it, so the guard was about to demand a
            # citation the page already carried.
            if re.search(r"tests?/test_\w+\.py|`\w+\.[A-Z_]{3,}`|`test_\w+`", near):
                continue
            # A sentence that dates itself is history, and history is allowed
            # to enumerate a list that has since changed — the same rule the
            # release-ceiling guard applies, and for the same reason.
            #
            # **NOT `_DATED`, and the reason is worth keeping.** Reusing the
            # release-ceiling guard's history pattern here looked like reuse
            # and was a hole: it matches the bare words "before" and "until",
            # so `INSTALL.md`'s *"…is erased from captured output BEFORE
            # anything is written to disk"* read as a dated note and the
            # claim went unguarded. The words that carry a date in a version
            # sentence are ordinary prose in every other sentence, and an
            # exemption that wide is a silently narrowed guard — which is the
            # defect this whole audit is about.
            if _HISTORY_SENTENCE.search(sentence):
                continue
            unguarded.append(f"{name}: {sentence[:140]}")

    assert not unguarded, (
        "these sentences claim to be exhaustive over a backticked list and "
        "name neither a derived check nor an exemption:\n  "
        + "\n  ".join(unguarded)
        + "\n\nEither name the symbol or test the claim is derived from, or "
        "add a per-item exemption to `_TOTALITY_EXEMPTIONS` WITH A REASON. "
        "Do not reword the claim to be vaguer — H-3 refuses that permanently."
    )


def test_every_exemption_names_a_sentence_that_still_exists():
    """The other direction. An exemption for a sentence nobody ships any more
    is dead text that reads as coverage — which is the defect one level up."""
    prose = "\n".join(
        (repo_root() / name).read_text(encoding="utf-8")
        for name in guarded_prose()
        if (repo_root() / name).is_file()
    )
    dead = [key for key in _TOTALITY_EXEMPTIONS if key not in prose]
    assert not dead, f"exemptions for sentences that no longer exist: {dead}"


def test_every_exemption_carries_a_reason():
    for key, reason in _TOTALITY_EXEMPTIONS.items():
        assert reason and len(reason) > 20, key


def test_every_command_the_readme_lists_as_shipping_is_registered():
    """The derived half of H-3's README hit.

    That sentence is a totality claim over a backticked list of command names,
    and until this test existed it was guarded by nobody: a renamed or removed
    subcommand would have left the README advertising it indefinitely. Now the
    sentence names this test and this test reads the real parser.
    """
    import re

    text = (repo_root() / "README.md").read_text(encoding="utf-8")
    line = next(
        row for row in text.splitlines() if "All of that ships today:" in row
    )
    claimed = set(re.findall(r"`([a-z-]+)`", line))
    assert claimed, line
    registered = set(_registered_commands())
    missing = sorted(claimed - registered)
    assert not missing, (
        f"README.md says these ship and the parser does not register them: "
        f"{missing}"
    )


def _registered_commands() -> list[str]:
    from wringer import cli

    parser = cli.build_parser()
    for action in parser._actions:
        if getattr(action, "choices", None) and hasattr(action.choices, "keys"):
            return list(action.choices)
    raise AssertionError("no subparsers found on the real parser")


def test_a_document_that_names_two_command_counts_explains_the_gap():
    """**The drift a reader meets, which per-line truth does not prevent.**

    `test_a_count_tied_to_a_release_says_which_release` checks each count
    against its own referent, so QUICKSTART.md could say "0.3.0, all seventeen
    commands" near the top and "## The nineteen commands" further down with
    both lines TRUE and the page still misleading: somebody who follows the
    install line and then reads the table finds two of them missing.

    So a document carrying counts for BOTH the released package and this tree
    must say so. Derived: the two numbers come from the tag and the parser, and
    the required explanation is keyed on the words, not on a hard-coded pair.
    """
    import re

    for name in guarded_prose():
        path = repo_root() / name
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        counts = set()
        for line in text.splitlines():
            match = re.search(r"\b([A-Za-z]+) commands\b", line)
            if not match:
                continue
            claimed = NUMBER_WORDS.get(match.group(1).lower())
            if claimed is not None:
                counts.add(claimed)
        if len(counts) < 2:
            continue
        assert registered_command_count() in counts, (
            f"{name} carries several command counts and none is this tree's"
        )
        # **DERIVED: it must NAME at least one command the release lacks.**
        #
        # The first version of this looked for a phrase ("behind this
        # repository", "in the released") and a mutation walked straight
        # through it, because one of the alternatives still appeared in a
        # heading that said nothing useful. A guard keyed on prose is a guard
        # keyed on whatever the prose happens to contain.
        #
        # The difference between the two counts IS a set of command names, and
        # a document that has not named one of them has not told the reader
        # what they will be missing.
        missing = _commands_added_since_the_release()
        if not missing:
            continue
        flat = " ".join(text.split())
        named = [c for c in missing if f"`{c}`" in flat]
        assert named, (
            f"{name} states {sorted(counts)} commands in one document and "
            f"never names which ones the released package lacks: "
            f"{sorted(missing)}. A reader who installs the release and then "
            f"reads the larger table finds commands missing and no "
            f"explanation. Name at least one, in backticks, where the install "
            f"line is."
        )


def _commands_added_since_the_release() -> set[str]:
    """Commands this tree registers that the newest released tag did not.

    Read from `cli.py` at the tag with `ast`, so it is the parser's own
    structure rather than a hand-kept list or a grep over prose.
    """
    import ast
    import subprocess

    def names(source: str) -> set[str]:
        found = set()
        for node in ast.walk(ast.parse(source)):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "add_parser"
                and node.args
                and isinstance(node.args[0], ast.Constant)
            ):
                found.add(node.args[0].value)
        return found

    tags = subprocess.run(
        ["git", "tag", "--list", "v*", "--sort=-v:refname"],
        capture_output=True, text=True, cwd=repo_root(),
    ).stdout.split()
    if not tags:
        return set()
    released = subprocess.run(
        ["git", "show", f"{tags[0]}:src/wringer/cli.py"],
        capture_output=True, text=True, cwd=repo_root(),
    )
    if released.returncode != 0:
        return set()
    current = (repo_root() / "src" / "wringer" / "cli.py").read_text(encoding="utf-8")
    return names(current) - names(released.stdout)


def test_every_python_version_the_package_CLAIMS_can_parse_this_package():
    """**A classifier is a published claim, and this one was false.**

    `pyproject.toml` declares `Programming Language :: Python :: 3.11` and
    `requires-python = ">=3.11"`, the README badge says 3.11+, and the CI
    matrix tests it. And on 2026-08-17 `tests/test_witness_loop.py` held a
    backslash inside an f-string expression — legal from 3.12 (PEP 701), a
    **SyntaxError** on 3.11 — so the suite could not even be COLLECTED there.
    CI had been red on that job, and `scripts/ci-repro.sh` never saw it because
    it runs on whatever Python this machine has.

    **This guard compiles with a REAL 3.11 interpreter, and the first version
    of it did not.** That version used `ast.parse(..., feature_version=(3, 11))`,
    which looks exactly right and does not work: `feature_version` gates a
    short list of grammar changes and PEP 701's f-string handling is in the
    TOKENIZER, so it accepted the defect happily. It was caught by watching it
    fail on the genuine pre-fix line and seeing it pass — a guard that claimed
    coverage it did not have, which is the defect class one level up.

    If no such interpreter can be found the test SKIPS WITH A NAMED REASON
    rather than passing, because a guard that goes quiet is how the last
    several stale claims here survived.
    """
    import re
    import shutil
    import subprocess
    import sys

    text = (repo_root() / "pyproject.toml").read_text(encoding="utf-8")
    claimed = sorted(
        tuple(int(part) for part in version.split("."))
        for version in re.findall(
            r"Programming Language :: Python :: (\d+\.\d+)", text
        )
    )
    assert claimed, "the package claims no specific Python version at all"
    oldest = f"{claimed[0][0]}.{claimed[0][1]}"

    if tuple(sys.version_info[:2]) == claimed[0]:
        interpreter = sys.executable          # we ARE the oldest claim
    else:
        interpreter = shutil.which(f"python{oldest}")
    if interpreter is None and shutil.which("uv"):
        found = subprocess.run(
            ["uv", "python", "find", oldest], capture_output=True, text=True
        )
        if found.returncode == 0 and found.stdout.strip():
            interpreter = found.stdout.strip()
    if interpreter is None:
        pytest.skip(
            f"no Python {oldest} interpreter on this machine, and this package "
            f"CLAIMS {oldest} in its classifiers. The claim is therefore "
            f"unchecked here — install it (`uv python install {oldest}`) or "
            f"read the CI matrix, which does test it"
        )

    files = []
    for path in sorted(repo_root().glob("**/*.py")):
        rel = path.relative_to(repo_root()).as_posix()
        if rel.startswith((".venv/", "build/", "dist/")):
            continue
        if subprocess.run(
            ["git", "check-ignore", "-q", rel], cwd=repo_root()
        ).returncode == 0:
            continue
        files.append(rel)
    assert files, "no python files found to check"

    # **`compile()` on the source, not `py_compile`.** The first attempt used
    # `py_compile.compile(..., cfile='/dev/null')`, which raises
    # `FileExistsError` — *"/dev/null is a non-regular file"* — before it ever
    # looks at the syntax. That is not a `PyCompileError`, so the helper script
    # died, produced no stdout, and this guard read the empty output as "no
    # offenders" and went GREEN over the real defect. A guard that crashes and
    # reads as passing is worse than no guard, and only the watch found it.
    #
    # It reports every file rather than stopping at the first, so one run names
    # them all, and it prints nothing on success so an empty stdout genuinely
    # means clean.
    result = subprocess.run(
        [interpreter, "-c",
         "import sys\n"
         "bad = []\n"
         "for name in sys.argv[1:]:\n"
         "    with open(name, encoding='utf-8') as handle:\n"
         "        source = handle.read()\n"
         "    try:\n"
         "        compile(source, name, 'exec')\n"
         "    except SyntaxError as exc:\n"
         "        bad.append('%s:%s: %s' % (name, exc.lineno, exc.msg))\n"
         "sys.stdout.write('\\n'.join(bad))\n",
         *files],
        capture_output=True, text=True, cwd=repo_root(),
    )
    # A helper that DIED is not a clean run, and must never read as one.
    assert result.returncode == 0, (
        f"the {oldest} syntax check itself failed to run, so this guard "
        f"proved nothing:\n{result.stderr.strip()[:800]}"
    )
    offenders = [line for line in result.stdout.splitlines() if line.strip()]
    assert not offenders, (
        f"pyproject.toml claims Python {oldest} and these do not compile on "
        f"it:\n  " + "\n  ".join(offenders)
        + "\n\nA classifier is a published claim. Either fix the syntax or "
        "stop claiming the version."
    )


# --- the blanket containment claim, either direction ------------------------
#
# **`own_voice()` cannot see a markdown ADMONITION, and the README's most
# safety-critical sentence lives in one.** `README.md:192` is
# `> ⚠️ **.wringer.yaml is code.** … Gates are not sandboxed in v0.1`, and
# `own_voice` drops every line starting with `>`, so that callout — the
# document speaking in its loudest voice — reads to every existing guard as
# quoted material somebody else said. That is a live blind spot in a helper
# seven guards share, found on 2026-08-18 while writing this one, and it is
# recorded here rather than fixed in place: widening `own_voice` would change
# what those seven guards see, which is a separate decision.

_CALLOUT_OPENER = re.compile(r"^>\s*(?:\*\*|[⚠🚨❗ℹ✅❌🔴🟢])")


def claimed_voice(text: str) -> str:
    """`own_voice()`, plus admonition callouts, which ARE the document's voice.

    A `>` block whose first line opens with an emoji or bold marker is a
    markdown admonition — a warning box — and the document is making that
    claim, not reporting somebody else's. A `>` block that opens with ordinary
    prose is a quotation, and quoted is not claimed: the retreat box quotes the
    claim it withdraws and the programme document keeps its superseded status
    paragraph, and neither may be forced to delete its own history to stay
    green.
    """
    kept: list[str] = []
    in_quote = False
    keeping = False
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith(">"):
            if not in_quote:
                in_quote = True
                keeping = bool(_CALLOUT_OPENER.match(stripped))
            if keeping:
                # **The `>` comes OFF, and leaving it on made a guard inert.**
                #
                # Found 2026-08-22 by simulating a release. Every callout wraps
                # its sentences, so a kept line carried its marker into the
                # flattened text and README's own version claim reached the
                # patterns as:
                #
                #     `0.4.0` is the released > version
                #
                # No pattern can match across that, so
                # `test_a_document_naming_the_released_version_names_the_newest_tag`
                # matched NOTHING on the one document it was written for. It
                # passed in both directions of a deliberately wrong version,
                # which is worse than not existing — the CHANGELOG announced
                # README's version claims as derived on the strength of it.
                inner = stripped.lstrip(">").lstrip()
                # **A QUOTATION NESTED INSIDE AN ADMONITION IS STILL A
                # QUOTATION — found 2026-08-23 by widening the scope.**
                #
                # `lstrip(">")` takes one marker off, so `> > text` arrived as
                # `> text`: a marker survived into the claimed voice, which is
                # the very defect the comment above records, one level down.
                # `docs/specs/SPEC_BOARD_V0.md:443` was the page that showed
                # it, and it was never on the eight-document list.
                #
                # Dropping is right rather than stripping harder. The nested
                # block there is an amendment QUOTING the false sentence it
                # exists to withdraw ("no collection and no schema enum
                # exists"). Stripping the marker would have promoted that
                # sentence into the document's own voice and handed every
                # prose guard a claim the page is explicitly disavowing.
                if inner.startswith(">"):
                    continue
                kept.append(inner)
            continue
        in_quote = False
        keeping = False
        kept.append(line)
    return "\n".join(kept)


# A containment claim is BLANKET when its subject is a whole class — gates,
# workers, everything — rather than a named execution mode. Both directions
# are forbidden: "not sandboxed" undersells work that was expensive to earn
# and "fully sandboxed" oversells what eight scripted probes can show. The
# honest form names the mode and links the measurement.
#
# **Deliberately absent, and this is the discrimination that matters:**
# `SECURITY.md:123` — *"Local execution is `trusted_local`. It is not a
# sandbox, and this document will not call it one"* — is SCOPED to a named
# mode, is true, and is load-bearing. A guard that forbade it would delete the
# most honest sentence on the page.
_BLANKET_CONTAINMENT = (
    # Undersell.
    r"\bgates\s+are\s+not\s+sandboxed\b",
    r"\bnot\s+sandboxed\s+in\s+v\d",
    r"\bnothing\s+(?:here\s+)?is\s+sandboxed\b",
    r"\bwringer\s+is\s+not\s+sandboxed\b",
    r"\bno(?:ne)?\s+of\s+this\s+is\s+(?:sandboxed|contained)\b",
    # Oversell.
    r"\bfully\s+sandboxed\b",
    r"\bproperly\s+sandboxed\b",
    r"\bsandboxed\s+by\s+default\b",
    r"\bcompletely\s+(?:sandboxed|contained|isolated)\b",
    r"\bgates\s+are\s+sandboxed\b",
    r"\bworkers?\s+are\s+sandboxed\b",
    r"\b(?:everything|every\s+gate|every\s+worker)\s+(?:is|are)\s+"
    r"(?:sandboxed|contained|isolated)\b",
)

# Same exemption shape the totality guard uses: keyed on a distinctive
# substring, valued with a REASON somebody can argue with. Empty, and that is
# the result rather than the starting point.
_BLANKET_EXEMPTIONS: dict[str, str] = {}


@pytest.mark.parametrize("document", guarded_prose())
def test_no_public_document_makes_a_blanket_containment_claim(document):
    """**Ruling 5 — no unmeasured containment claim — as a check.**

    `README.md:192` said *"Gates are not sandboxed in v0.1"* until
    2026-08-18. By then the container path had been adversarially attacked
    three ways and the contained worker twice more, with a `--privileged`
    control; the blunt sentence UNDERSOLD it. The honest replacement is not a
    better adjective — it is the mode named and the measurement linked, with
    `unmeasured` where nothing was measured.

    Both directions are checked, because the next window's temptation is the
    opposite one: `SECURITY.md`'s own canaries already stop "proven secure",
    and this stops the softer overclaim reaching a README first.
    """
    require_checkout(document)
    text = claimed_voice((repo_root() / document).read_text(encoding="utf-8"))
    flat = " ".join(text.replace("*", "").split())

    offending = []
    for pattern in _BLANKET_CONTAINMENT:
        for found in re.finditer(pattern, flat, re.IGNORECASE):
            window = flat[max(0, found.start() - 90): found.end() + 90]
            if any(key in window for key in _BLANKET_EXEMPTIONS):
                continue
            offending.append(f"{pattern} :: …{window}…")

    assert not offending, (
        f"{document} makes a blanket containment claim. Name the execution "
        f"mode and link the measurement — `SECURITY.md`'s tables, including "
        f"the rows that say `unmeasured`:\n"
        + "\n".join(f"  {hit}" for hit in offending)
    )


def test_the_blanket_guard_can_see_a_markdown_callout():
    """**The reason `claimed_voice` exists, pinned so it cannot regress.**

    Watched both ways on fixtures, because the real defect is fixed by the
    same commit that adds this: a warning box is the document's own voice and
    must be scanned; an ordinary quotation is somebody else's and must not.
    """
    callout = "> ⚠️ **Careful.** Gates are not sandboxed in v0.1; see SECURITY.md\n"
    assert "not sandboxed" in claimed_voice(callout)
    assert "not sandboxed" not in own_voice(callout)

    quotation = "> The README used to say gates are not sandboxed in v0.1.\n"
    assert "not sandboxed" not in claimed_voice(quotation)

    # And the real callout on disk is reachable, so this is not a fixture
    # proving something about a string nobody ships.
    readme = (repo_root() / "README.md").read_text(encoding="utf-8")
    assert ".wringer.yaml` is code" in claimed_voice(readme), (
        "the README's ⚠️ callout is no longer visible to the blanket guard; "
        "if the callout marker changed, re-derive `_CALLOUT_OPENER`"
    )


# --- the released version, against the newest tag ---------------------------


def newest_release_tag() -> str | None:
    """The newest `vX.Y.Z` tag, or None when this checkout cannot answer.

    Same rule `commands_at_tag` follows: no git, no tags, a shallow clone —
    the caller skips rather than guessing, because a wrong answer is worse
    than no answer. Tags only; **PyPI is deliberately not consulted.** These
    tests send nothing over the network, and a guard that needed a network
    call would be a guard that fails in the one environment (CI, offline)
    where it matters most.
    """
    import subprocess

    try:
        done = subprocess.run(
            ["git", "tag", "--list", "v[0-9]*", "--sort=-v:refname"],
            cwd=repo_root(),
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return None
    tags = [line.strip() for line in done.stdout.splitlines() if line.strip()]
    return tags[0].lstrip("v") if tags else None


def release_tags() -> set[str] | None:
    """Every `vX.Y.Z` tag, without the `v`, or None when git cannot answer.

    The same rule `newest_release_tag` follows and for the same reason: no
    git, no tags, a shallow clone — the caller skips rather than guessing.
    """
    import subprocess

    try:
        done = subprocess.run(
            ["git", "tag", "--list", "v[0-9]*"],
            cwd=repo_root(),
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return None
    found = {
        line.strip().lstrip("v") for line in done.stdout.splitlines()
        if line.strip()
    }
    return found or None


def mid_bump() -> bool:
    """Whether this tree is BETWEEN releases rather than standing on one.

    **Found by cutting `0.4.9`, and it is a contradiction two guards shipped
    into each other.** The tag-derived guards below hold every front page to
    `git tag`, and say so in their own docstrings: *"a page naming a version
    NEWER than any tag is claiming a release that does not exist … the reason
    `0.4.1` is staged in this repository without touching the version
    literal."* Then, on 2026-08-26, `eab4cc7` added a sibling that holds the
    same pages to `wringer.__version__` in the bump commit — because the
    original is one beat too late, and by the time it speaks the tag is
    already public.

    Both are right, and between them the bump commit could not be green in
    either direction: name the old version and the sibling refuses, name the
    new one and the original does.

    So each is live in exactly one state and neither is ever off:

    - **standing on a release** (`__version__` IS the newest tag) — the
      tag-derived guards are the live check and the sibling skips;
    - **mid-bump** (`__version__` is ahead) — the sibling is the live check
      and the tag-derived ones defer to it.

    The cost is named rather than hidden: between the bump commit and the
    tag, `main`'s front pages advertise a version PyPI does not yet serve.
    That is the trade `eab4cc7` chose — a tag is public for ever and a
    minutes-long window on `main` is not — and this makes it a decision
    instead of a red suite.
    """
    from wringer import __version__

    newest = newest_release_tag()
    return newest is not None and newest != __version__


# "0.3.0 is the released version"; "the current release is 0.3.0"; and the
# pre-release framing that outlives its own release — "building toward v0.1.0".
_RELEASED_VERSION_CLAIMS = (
    re.compile(
        r"`?v?(\d+\.\d+\.\d+)`?\s+is\s+the\s+(?:current\s+)?released\s+version",
        re.I,
    ),
    re.compile(r"the\s+(?:current\s+)?release\s+is\s+`?v?(\d+\.\d+\.\d+)`?", re.I),
    re.compile(r"`?v?(\d+\.\d+\.\d+)`?\s*\(PyPI,\s*current\)", re.I),
    re.compile(r"building\s+toward\s+`?v?(\d+\.\d+\.\d+)`?", re.I),
)

_VERSION_PROSE = guarded_prose()


@pytest.mark.parametrize("document", _VERSION_PROSE)
def test_a_document_naming_the_released_version_names_the_newest_tag(document):
    """**Red on the real defect, 2026-08-18.**

    `CONTRIBUTING.md:3-5` said Wringer was *"building toward `v0.1.0` on
    September 30, 2026"* on a project with three tags, three PyPI releases,
    and a `ROADMAP.md` line recording that `v0.1.0` shipped on July 31. A
    pre-release document on a post-release project is the first thing a
    contributor reads.

    Derived from `git tag`, never from a constant, and never from PyPI —
    these tests send nothing. Where the tags cannot be read the guard skips
    with a reason rather than guessing.

    **Deliberately narrow.** A sentence naming an OLD version as history —
    "`0.1.0` shipped on July 31", "upgrade from `0.2.0`" — is true and is not
    matched: only the four shapes that claim a version IS the current one.
    The seventeen-vs-nineteen callout is untouched by any of them, and
    `tests/test_docs.py`'s ruling on it stands.
    """
    require_checkout(document)
    newest = newest_release_tag()
    if newest is None:
        pytest.skip(
            "this checkout cannot read its own tags (no git, or a shallow "
            "clone), so there is no released version to check the prose "
            "against"
        )
    if mid_bump():
        pytest.skip(
            "this tree is mid-bump, so the pages are supposed to name the "
            "version being released and its sibling below is the live check"
        )

    text = claimed_voice((repo_root() / document).read_text(encoding="utf-8"))
    flat = " ".join(text.replace("*", "").split())

    wrong = []
    for pattern in _RELEASED_VERSION_CLAIMS:
        for found in pattern.finditer(flat):
            if found.group(1) != newest:
                window = flat[max(0, found.start() - 80): found.end() + 80]
                wrong.append(f"{found.group(0)!r} :: …{window}…")

    assert not wrong, (
        f"{document} names a released version that is not the newest tag "
        f"(`v{newest}`):\n" + "\n".join(f"  {hit}" for hit in wrong)
        + "\n\nA released version is derivable; a document claiming a "
        "different one is stale, not cautious."
    )


# --- a default is a fact, and a document that states a stale one lies -------


def every_markdown() -> list[Path]:
    """Every document in the repository, wherever it lives."""
    root = repo_root()
    return sorted(
        path
        for path in list(root.glob("*.md")) + list((root / "docs").glob("*.md"))
        if path.is_file()
    )


_CLAIMS_A_DEFAULT = re.compile(
    r"max_output_tokens[^.\n]{0,80}?default[^.\n]{0,30}?(\d{3,6})"
    r"|default[^.\n]{0,40}?max_output_tokens[^.\n]{0,40}?(\d{3,6})"
    r"|max_output_tokens[^.\n]{0,40}?defaults? to[^.\n]{0,30}?\*{0,2}(\d{3,6})",
)


def test_no_document_states_a_max_output_tokens_default_that_is_no_longer_true():
    """**Derived from the constant, not from a list kept beside it.**

    `judge.max_output_tokens` was raised from 1024 to 8000 on 2026-08-19
    because 1024 truncates the draft for any real PRD — `wring spec` then
    refuses the whole reply and writes nothing. Four documents stated the old
    number as current, and two of them were captures whose whole value is that
    they are not edited.

    So the rule is not "never say 1024". It is: a document may state an old
    default only if it also names the one in force, which is what a dated
    correction beside the original does. That keeps a capture readable as
    evidence and stops a reader taking its number as current.
    """
    from wringer import config

    current = str(config.DEFAULT_MAX_OUTPUT_TOKENS)
    stale: list[str] = []
    for path in every_markdown():
        text = path.read_text(encoding="utf-8")
        claimed = {
            number
            for match in _CLAIMS_A_DEFAULT.finditer(text)
            for number in match.groups()
            if number
        }
        if claimed - {current} and current not in text:
            stale.append(
                f"{path.name} states default(s) {sorted(claimed)} and never "
                f"names the one in force ({current})"
            )
    assert not stale, "\n".join(stale)


def test_the_default_guard_would_notice_a_number_that_went_stale():
    """The guard on the guard. A pattern that matches nothing is worse than no
    pattern, and two guards written on 2026-08-18 were green while matching
    nothing — found by mutation, not by reading."""
    for sentence in (
        "`judge.max_output_tokens` still defaults to **1024**, which truncates",
        "max_output_tokens: 1024       # optional, default 1024, integer >= 1",
        "The `max_output_tokens` default is 1024. The run set it to 16000",
    ):
        assert _CLAIMS_A_DEFAULT.search(sentence), sentence
        found = {
            number
            for match in _CLAIMS_A_DEFAULT.finditer(sentence)
            for number in match.groups()
            if number
        }
        assert "1024" in found, (sentence, found)


# --- the README may not name a component that does not exist ----------------


def test_the_readme_names_no_module_or_package_that_does_not_exist():
    """**The front page carried five false claims about the product, and the
    product's whole pitch is that it refuses what it cannot evidence.**

    Found 2026-08-19. `README.md` drew a five-layer architecture whose L2
    HARNESS layer — the layer that IS this tool — named four components:
    `wringer-ir`, `wringer-engine`, `wringer-loops`, `wringer-verify`. None of
    them existed as a repository, a package, or a module. Beside them the same
    section claimed "OpenTelemetry GenAI traces", a "per-loop cost ledger",
    a "Graph IR", and "a conformance suite proves each mapping". Grepping
    `src/` found none of the four.

    Aspiration belongs in the build plan, which exists and is five thousand
    words long. A description of the product belongs in the README only when
    it is true of the product.

    This checks the narrow, mechanical half: a `wringer-<name>` token in the
    README must correspond to something on disk. It cannot catch a false
    claim written in prose — `test_the_readme_claims_no_capability_the_code_
    lacks` below covers the named features — and neither guard replaces
    reading. Both exist because nothing was checking this at all.
    """
    text = (repo_root() / "README.md").read_text(encoding="utf-8")
    known = {"wringer", "wringer-board", "wringer-drive"}
    # A filename is not a component. `wringer-vs-langgraph.md` and
    # `docs/ARCHITECTURE-NORTHSTAR.md` are documents in this repository, and
    # the first version of this guard reported both as missing packages —
    # a guard whose own false positives would train a reader to ignore it.
    prose = re.sub(r"\bwringer-[a-z0-9-]+\.md\b", "", text)
    named = set(re.findall(r"\bwringer-([a-z][a-z0-9-]*)\b", prose))
    missing = []
    for name in sorted(named):
        full = f"wringer-{name}"
        if full in known:
            continue
        # A sibling repository, an extra, or a module — any of those is real.
        if (repo_root().parent / full).is_dir():
            continue
        if (repo_root() / "src" / full.replace("-", "_")).is_dir():
            continue
        missing.append(full)
    assert not missing, (
        f"README names components that do not exist: {missing}. The front "
        "page of a tool that refuses what it cannot evidence may not describe "
        "parts of itself that are not there"
    )


def test_the_readme_claims_no_capability_the_code_lacks():
    """The prose half, for the named features that were false.

    Each entry is a phrase the README used and the token that would have to
    appear in `src/` for it to be true. Derived per-run rather than pinned, so
    a capability that genuinely arrives makes the claim permissible instead of
    needing this guard edited.
    """
    text = (repo_root() / "README.md").read_text(encoding="utf-8")
    sources = " ".join(
        path.read_text(encoding="utf-8", errors="ignore")
        for path in (repo_root() / "src" / "wringer").glob("*.py")
    )
    claims = {
        "OpenTelemetry": "opentelemetry",
        "cost ledger": "cost_ledger",
        "Graph IR": "graph_ir",
        "conformance suite": "conformance",
    }
    broken = [
        phrase
        for phrase, token in claims.items()
        if phrase.lower() in text.lower() and token not in sources.lower()
    ]
    assert not broken, (
        f"README claims capabilities the code does not have: {broken}. Either "
        "build them, or say them in the build plan where aspiration belongs"
    )


# --- what this page says about the RELEASE, derived from the release --------
#
# **The truth-travels guard.** Field report 2026-08-22 findings 1 and 2 are one
# defect wearing three hats: eleven commits that never left the author's
# machine, run 2's report that never left with them, and a front page still
# advertising `0.3.0` two days after `0.4.0` was published. In every case the
# truth existed on exactly one machine and nothing made it travel.
#
# The version half cannot be fixed by remembering to edit the README, because
# that is precisely what was not done. It is derived from the tags instead.


def published_versions() -> list[str]:
    """Every `vX.Y.Z` tag this checkout can see, oldest first."""
    import subprocess

    done = subprocess.run(
        ["git", "tag", "--list", "v[0-9]*"],
        cwd=repo_root(),
        capture_output=True,
        text=True,
        check=False,
    )
    if done.returncode != 0:
        return []
    found = []
    for line in done.stdout.split():
        stripped = line.lstrip("v")
        parts = stripped.split(".")
        if len(parts) == 3 and all(p.isdigit() for p in parts):
            found.append((tuple(int(p) for p in parts), stripped))
    return [version for _, version in sorted(found)]


def test_the_front_page_advertises_the_version_that_IS_PUBLISHED():
    """**Field report 2026-08-22 finding 2.**

    `README.md` opened with *"`pip install wringer` — 0.3.0, seventeen
    commands, out now"* and carried a dated caveat insisting the release was
    behind the repository and a reader should install from source. `0.4.0` had
    been on PyPI for two days. A product manager read the page, followed it,
    and the source install then errored (finding 3).

    Nothing tied that sentence to the tag, so nothing could notice. This is
    that tie. It fails in BOTH directions on purpose: a page naming a version
    older than the latest tag is stale, and a page naming a version NEWER than
    any tag is claiming a release that does not exist — which is the failure a
    release checklist causes when it bumps the page before pushing the tag,
    and the reason `0.4.1` is staged in this repository without touching the
    version literal.
    """
    versions = published_versions()
    if not versions:
        pytest.skip(
            "this checkout has no version tags — CI fetches them with "
            "fetch-depth: 0, and without them this guard would pass while "
            "checking nothing"
        )
    from wringer import __version__

    # **See `mid_bump` — and this guard SWITCHES rather than skips.** Its
    # parametrised neighbours have a sibling that checks the same pages
    # against `__version__` during a bump; this headline has none, and the
    # first draft of this change let it skip, at which point the README could
    # advertise `9.9.9` and the whole suite stayed green. Found by red-watching
    # the skip instead of trusting it.
    latest = __version__ if mid_bump() else versions[-1]

    readme = (repo_root() / "README.md").read_text(encoding="utf-8")
    line = next(
        (
            row
            for row in readme.splitlines()
            if "out now" in row and "install wringer" in row
        ),
        None,
    )
    assert line is not None, (
        "README no longer carries the '... install wringer — <version>, "
        "<n> commands, out now' headline this guard reads. If it moved, "
        "re-derive the guard against wherever the page now states its "
        "version — do not delete it"
    )
    assert latest in line, (
        f"README's headline says {line.strip()!r}, and the version it should "
        f"name is {latest} — "
        + (
            "this tree is mid-bump, so the headline names the version being "
            "released, which is `wringer.__version__`"
            if mid_bump()
            else "the latest published tag. Either the release was cut and "
            "this page was not updated, or this page names a version that "
            "has not shipped"
        )
    )


#: A sentence counting the executables this distribution installs. "Both entry
#: points" was true of two and became false the day two more shipped.
_COUNTS_ENTRY_POINTS = re.compile(
    r"\b(both|all\s+\w+|two|three|four|five)\s+entry\s+points?\b", re.I
)


def test_a_page_counting_the_entry_points_counts_them_ALL():
    """**Found 2026-08-23 by widening the totality guard's scope.**

    `docs/deployment.md` said *"Both entry points are installed: `wring` and
    `wringer`"*. Two was right until 0.4.0 merged the board and the drive into
    this distribution, and `[project.scripts]` has declared four ever since. A
    reader who installs and is told there are two goes looking for the other
    two somewhere else — which is the same failure as the QUICKSTART page
    telling people to install from source.

    Derived from packaging, so the next entry point that ships reddens this
    rather than waiting for somebody to re-read the page.
    """
    import tomllib

    require_checkout("pyproject.toml")
    shipped = set(
        tomllib.loads((repo_root() / "pyproject.toml").read_text(encoding="utf-8"))
        .get("project", {})
        .get("scripts", {})
    )
    assert shipped, (
        "pyproject declares no console scripts, so this guard is checking "
        "nothing — the packaging moved and this needs re-deriving"
    )

    wrong = []
    for path in reader_facing_pages(captures=False):
        text = path.read_text(encoding="utf-8")
        for found in _COUNTS_ENTRY_POINTS.finditer(text):
            window = text[found.start(): found.end() + 240]
            named = {name for name in shipped if f"`{name}`" in window}
            if named and named != shipped:
                line = text[: found.start()].count("\n") + 1
                wrong.append(
                    f"{path.relative_to(repo_root()).as_posix()}:{line} says "
                    f"{found.group(0)!r} and names {sorted(named)}"
                )
    assert not wrong, (
        f"this distribution installs {sorted(shipped)}; these pages count the "
        "entry points and enumerate a different set: " + "; ".join(wrong)
    )


def test_no_page_calls_a_SHIPPED_COMMAND_a_separate_unpublished_package():
    """**Field report 2026-08-22 finding 2, second half — and the reason the
    version clause alone is not enough.**

    `README.md:478` said `wringer-board` was *"not on PyPI, so `pip install
    wringer-board` would not work today; install it from source"*. Since
    `0.4.0` the board ships INSIDE the `wringer` distribution: the wheel
    installs a `wringer-board` executable. The sentence was false about the
    packaging, not about the version, so a guard reading only the version
    number would have sailed straight past it — as one did.

    Derived from `pyproject.toml`'s own `[project.scripts]`, so a command that
    is genuinely split back out into its own package stops being covered here
    automatically rather than needing this test remembered.
    """
    import tomllib

    pyproject = tomllib.loads(
        (repo_root() / "pyproject.toml").read_text(encoding="utf-8")
    )
    shipped = set(pyproject.get("project", {}).get("scripts", {}))
    assert shipped, (
        "pyproject declares no console scripts, so this guard is checking "
        "nothing — the packaging moved and this needs re-deriving"
    )

    for name in guarded_prose():
        path = repo_root() / name
        if not path.is_file():
            continue
        flat = " ".join(own_voice(path.read_text(encoding="utf-8")).split())
        for sentence in re.split(r"(?<=[.!?])\s+", flat):
            if "not on PyPI" not in sentence and "would not work" not in sentence:
                continue
            named = sorted(c for c in shipped if c in sentence)
            assert not named, (
                f"{name} says {sentence.strip()[:180]!r} — but "
                f"{', '.join(named)} ship in this distribution's own "
                f"[project.scripts], so installing it is exactly what works"
            )


def test_the_release_recipe_NAMES_every_document_the_version_guard_checks():
    """**The deadlock, and the list that has to move with the tag.**

    Simulated in a clone on 2026-08-22. The recipe said *"push `main` green,
    then bump the literal, then tag"*, and there is no ordering of those three
    that is green throughout: prose ahead of the tag claims a release that
    does not exist, and a tag ahead of the prose leaves the page stale. The
    only green path is one commit carrying both, tagged locally, gated with
    the tag present, then pushed as one act.

    The simulation also found a second document — `SECURITY.md` names the
    released version too, and a recipe that says "bump README" leaves `main`
    red on the release commit itself.

    So this is DERIVED, not a list kept beside one. It asks which documents
    actually carry a released-version claim right now, and fails if the recipe
    does not name each of them. A document that starts naming the version, or
    stops, takes this with it.
    """
    require_checkout("CHANGELOG.md")
    # **Scoped to the recipe, not to the file.** Searching the whole CHANGELOG
    # made this pass with `README.md` deleted from the ordering, because every
    # past release mentions it somewhere — a guard reading a document instead
    # of the paragraph it is about. Caught by mutating the recipe and watching
    # nothing go red.
    changelog = (repo_root() / "CHANGELOG.md").read_text(encoding="utf-8")
    # Anchored on the heading's full form, not a bare prefix. `index("##
    # 0.4.1")` bound to `## 0.4.10` the day that release was cut, so this
    # guard silently started reading the NEWEST entry as "the recipe" and
    # went red on a release commit that had done nothing wrong — the same
    # substring-anchoring defect class the 2026-08-27 followability
    # amendment records, in the guard that polices the recipe.
    start = changelog.index("## 0.4.1 —")
    end = changelog.index("\n## ", start + 1)
    recipe = changelog[start:end]

    naming = []
    for document in _VERSION_PROSE:
        path = repo_root() / document
        if not path.is_file():
            continue
        flat = " ".join(claimed_voice(path.read_text(encoding="utf-8"))
                        .replace("*", "").split())
        if any(pattern.search(flat) for pattern in _RELEASED_VERSION_CLAIMS):
            naming.append(document)

    assert naming, (
        "no document claims a released version, so either the patterns have "
        "stopped matching — which is exactly the defect found on 2026-08-22, "
        "when a `>` marker inside a callout broke every one of them — or the "
        "claims are genuinely gone and this guard should be retired"
    )
    missing = [document for document in naming if document not in recipe]
    assert not missing, (
        f"CHANGELOG's release recipe does not name {missing}, and those "
        "documents name the released version. A release commit that leaves "
        "them behind is red on itself"
    )


def every_page_claimed_voice_runs_on() -> list[str]:
    """The WIDEST corpus, because this is a property of the HELPER.

    **Its own scope, and that is the correction — 2026-08-23.** This guard
    borrowed `_VERSION_PROSE`, so when the prose guards stopped covering
    `docs/specs/` — rightly, a contract is a record — this one silently
    stopped covering the only page that had ever caught it. Reverting the
    nested-quote fix produced no red at all.

    `claimed_voice` is a helper any guard may point at any page, so what it
    does to real bytes is checked over every page there is: specs and dated
    captures included, since a leaking marker narrows whatever reads them.
    """
    root = repo_root()
    return [path.relative_to(root).as_posix() for path in reader_facing_pages()]


@pytest.mark.parametrize("document", every_page_claimed_voice_runs_on())
def test_claimed_voice_leaves_NO_quote_MARKER_inside_a_sentence(document):
    """The defect class behind the inert guard, caught at its own level.

    Every callout in this repository wraps its sentences, so a `>` kept on a
    line becomes a token in the middle of the flattened text:

        `0.4.0` is the released > version

    No pattern written for English can match across that, and the pattern that
    could not match was the one deriving README's released version. It passed
    in both directions of a deliberately wrong version for as long as it
    existed.

    The version guard alone cannot catch this on itself — blind it to README
    and `SECURITY.md` still matches, so it stays green while checking half of
    what it claims. This asks the question one level down instead: after
    flattening, no standalone `>` may survive, because a marker inside a
    sentence silently narrows every guard downstream of this helper, not just
    that one.

    **Asked at the LINE, not at the flattened string — 2026-08-23.** This
    searched the flattened text for `" > "`, which is the SHAPE the defect
    takes and not the defect. Widening the scope from eight pages to the
    corpus made the difference matter immediately: `docs/witness-programme.md`
    says *"but > 4 uncovered is a coverage loss"*, and a greater-than sign in
    a sentence about arithmetic is not a markdown marker. Three more pages
    said the same kind of thing.

    A quote marker is a `>` that OPENED A LINE, so that is what is checked.
    The property is strictly stronger than the old one — it also catches a
    marker that flattening would not have surrounded with spaces — and it
    cannot mistake prose about numbers for broken markdown.
    """
    require_checkout(document)
    path = repo_root() / document
    # Fenced blocks are dropped first: a shell redirect (`… > calc.py`) opens
    # no quote. `SETUP.md`'s one-line setup command is exactly that, and it is
    # correct.
    surviving, fenced = [], False
    for number, line in enumerate(
        claimed_voice(path.read_text(encoding="utf-8")).splitlines(), 1
    ):
        if line.lstrip().startswith("```"):
            fenced = not fenced
            continue
        if not fenced and line.lstrip().startswith(">"):
            surviving.append(f"line {number}: {line.strip()[:80]}")

    assert not surviving, (
        f"{document}: a markdown quote marker survives into the text the "
        "prose guards match against, so any claim wrapping across that line "
        "is unmatchable and every pattern reading it is silently narrowed:\n  "
        + "\n  ".join(surviving)
    )


# --- the packages merged, and the prose has to know it ----------------------
#
# Found 2026-08-22 by a reader, not by a test, which is the part worth fixing.
# `README.md` carried a paragraph headed *"Its true status, so nobody has to
# guess"* that opened **"It is a separate package, `wringer-board`"** and said
# four lines later that there is no separate package to fetch. Both sentences
# shipped together from 0.4.0. Meanwhile three front doors — README-PM.md
# twice, INSTALL.md once — sent readers to `github.com/marcoakes/wringer-drive`
# and `.../wringer-board` for the pages a product manager starts from.
#
# **Those repositories still answer 200.** They are tombstones: their own
# descriptions say the code moved. So a reader following those links does not
# get an error, they get a copy of the page that stopped being updated in
# August — the same failure as the stale paste-block URL, which is worse than a
# 404 because nothing looks wrong.

#: The distributions that merged into `wringer` in 0.4.0. A GitHub link to one
#: of these is a link to a tombstone.
MERGED_AWAY = ("wringer-board", "wringer-drive")

#: Captures. A transcript records what a command DID on a date; rewriting one
#: to match today destroys the evidence it exists to be. These carry dated
#: notes instead, and `test_a_superseded_capture_says_so` holds them to it.
#
# **A HAND LIST ON PURPOSE, and now carrying its reasons — 2026-08-23.**
#
# The audit that derived the scope of every other document guard in this file
# leaves this one listed, because an EXEMPTION is not a scope: it is a
# decision about a particular page that somebody has to argue for. Discovery
# cannot produce it, and a rule that generated exemptions automatically would
# be a rule that silences guards automatically.
#
# What the audit did change is that it was a bare tuple. The house shape
# everywhere else — `_TOTALITY_EXEMPTIONS`, `_BLANKET_EXEMPTIONS`,
# `test_sign.py`'s map — is a REASON STRING per item, because an exemption
# with no reason is a silenced guard and an exemption with one is a decision
# somebody can argue with later. Two names in a tuple were neither.
CAPTURES_EXEMPT: dict[str, str] = {
    "docs/install-2026-08-17.md": (
        "a transcript of an install performed on 2026-08-17, when the board "
        "and the drive were separate distributions. Its links point where "
        "they pointed that day, which is what makes it evidence"
    ),
    "docs/MANUAL_CHECKS.md": (
        "the running ledger of checks executed on real machines. Its rows "
        "cite the repositories those runs were performed against, and "
        "repointing them would rewrite what was measured"
    ),
}


def test_every_capture_exemption_names_a_page_that_exists_and_a_reason():
    """An exemption for a page nobody ships is dead text that reads as a
    decision, and a reason nobody wrote is an exemption nobody can argue
    with. Both are how a silenced guard looks from the outside."""
    for name, reason in CAPTURES_EXEMPT.items():
        require_checkout(name)
        assert (repo_root() / name).is_file(), name
        assert len(reason) > 40, f"{name}'s exemption has no argued reason"


def _pages_a_reader_follows() -> list[Path]:
    root = repo_root()
    return [
        path
        for path in root.rglob("*.md")
        if ".wringer" not in path.parts
        and "coldread" not in path.parts
        and "node_modules" not in path.parts
        and path.relative_to(root).as_posix() not in CAPTURES_EXEMPT
    ]


def test_NO_PAGE_SENDS_A_READER_TO_A_MERGED_AWAY_REPOSITORY():
    """A link to a tombstone is worse than a broken link.

    `github.com/marcoakes/wringer-drive` answers **200** and serves the page
    it had in August. A reader following it is not told anything is wrong;
    they simply read a stale document. Every page a reader follows must point
    into THIS repository, where the file actually lives now.
    """
    import re

    offenders = []
    for path in _pages_a_reader_follows():
        body = path.read_text(encoding="utf-8")
        for gone in MERGED_AWAY:
            for match in re.finditer(rf"github\.com/marcoakes/{gone}[/\w.-]*", body):
                line = body[: match.start()].count("\n") + 1
                offenders.append(
                    f"{path.relative_to(repo_root())}:{line} → {match.group(0)}"
                )
    assert not offenders, (
        "these pages link a repository whose code moved into this one. It "
        "answers 200 and serves a stale copy, so the reader is never told: "
        + "; ".join(offenders)
    )


def test_NO_PAGE_CALLS_A_MERGED_PACKAGE_SEPARATE_IN_THE_PRESENT_TENSE():
    """The self-contradiction, as a property.

    `wringer-board` and `wringer-drive` are commands of one distribution since
    0.4.0. A page may describe the LAYER as separate — that is the seam
    `test_layer_seam.py` enforces and it is true — but it may not call the
    PACKAGE separate, because a reader acts on that by trying to install it.
    """
    import re

    offenders = []
    # "a separate package" / "separate packages" / "its own package", present
    # tense, within a sentence that also names one of the merged commands.
    pattern = re.compile(
        r"[^.\n]*\b(?:is|are|ships? as)\s+(?:a\s+)?separate\s+packages?\b[^.\n]*\.",
        re.I,
    )
    for path in _pages_a_reader_follows():
        body = path.read_text(encoding="utf-8")
        for match in pattern.finditer(body):
            sentence = " ".join(match.group(0).split())
            if not any(gone in sentence for gone in MERGED_AWAY):
                continue
            # A sentence explicitly dated to the past is history, not a claim.
            past = r"used to|until|before 0\.4\.0|shipped as|was\b"
            if re.search(past, sentence, re.I):
                continue
            line = body[: match.start()].count("\n") + 1
            offenders.append(f"{path.relative_to(repo_root())}:{line} → {sentence}")
    assert not offenders, (
        "these sentences call a merged distribution a separate package, and a "
        "reader acts on that by trying to install something that is not on the "
        "index: " + "; ".join(offenders)
    )


def test_a_superseded_capture_SAYS_SO_rather_than_being_rewritten():
    """The two exemptions above are exemptions, not blind spots.

    A capture keeps its bytes — that is what makes it evidence — so the rule
    for one whose layout is superseded is a DATED NOTE saying not to follow it.
    A capture that is exempt from the link guard and carries no such note is a
    page quietly instructing a reader to clone a tombstone.
    """
    for name in CAPTURES_EXEMPT:
        body = (repo_root() / name).read_text(encoding="utf-8")
        if not any(gone in body for gone in MERGED_AWAY):
            continue
        flat = " ".join(body.split()).lower()
        assert "superseded" in flat, (
            f"{name} still names a merged-away repository and never says the "
            "layout is superseded, so a reader may follow it"
        )


# --- every link a reader can click ------------------------------------------
#
# Found 2026-08-22 by resolving them all: **62 relative links in this
# repository pointed at nothing.** Forty-four were the package merge — specs
# moved into `docs/specs/` and every `../SPEC_X.md` beside them kept pointing
# at the root. Six were captures the merge simply lost, recovered from the
# tombstone repository that still had them.
#
# Nobody clicks a link in a document they wrote, so nothing noticed. It is the
# same failure as the stale paste-block URL and the tombstone front doors: a
# page confidently sending a reader somewhere that is not there.


def _link_targets(body: str):
    """Relative markdown links, with FENCED BLOCKS REMOVED.

    A fence is a transcript or a rendering, not the page's own links. This
    repository's `QUICKSTART.md` quotes the `summary.md` Wringer generates,
    whose `[diff.patch](diff.patch)` is correct relative to a BUNDLE and
    nonsense relative to the page. A first version of this guard called those
    six broken and would have had them "fixed" into wrongness.
    """
    import re

    outside = re.sub(r"```.*?```", "", body, flags=re.S)
    outside = re.sub(r"^ {4,}\S.*$", "", outside, flags=re.M)
    for match in re.finditer(
        r"\[[^\]]*\]\((?!https?://|mailto:|#)([^)#]+)(?:#[^)]*)?\)", outside
    ):
        yield match.group(1).strip(), outside[: match.start()].count("\n") + 1


def test_EVERY_RELATIVE_LINK_IN_EVERY_PAGE_RESOLVES():
    """A link that goes nowhere is a claim the repository cannot keep.

    Committed evidence is exempt — `.wringer.example/` and the cold-read
    captures are bundles and transcripts, and their internal paths are
    relative to where they were WRITTEN, not to this tree.

    **`run2-2026-08-28/` joined that list 2026-08-28** for exactly the stated
    reason and no other: it holds a verbatim copy of a run bundle's
    `summary.md`, whose `[diff.patch](diff.patch)` is correct relative to the
    BUNDLE and nonsense relative to this tree. Editing those links to resolve
    here would be editing a capture, which Law 8 forbids and which would also
    make the capture wrong about the file it is a copy of. The directory's own
    `README.md` is prose and is NOT exempt — it is discovered by the
    `*.md` walk like any other page, because its links are its own.
    """
    root = repo_root()
    skip = {".wringer", ".wringer.example", "node_modules", ".venv", "build",
            "dist", "coldread", ".git", ".pytest_cache"}
    # Named files rather than the whole directory, so the README beside them
    # stays under the guard.
    evidence_copies = {
        "docs/run2-2026-08-28/summary-2026-08-28.md",
        "docs/run2-2026-08-28/mr-2026-08-28.md",
    }
    broken = []
    checked = 0
    for page in sorted(root.rglob("*.md")):
        if any(part in skip for part in page.relative_to(root).parts):
            continue
        if page.relative_to(root).as_posix() in evidence_copies:
            continue
        for target, line in _link_targets(page.read_text(encoding="utf-8")):
            checked += 1
            if not (page.parent / target).resolve().exists():
                broken.append(f"{page.relative_to(root)}:{line} → {target}")
    assert checked > 300, f"the scanner found only {checked} links — it broke"
    assert not broken, (
        f"{len(broken)} of {checked} relative links point at nothing. Nobody "
        "clicks a link in a document they wrote, which is why this is a test "
        "and not a habit: " + "; ".join(broken[:12])
    )


# --- a CEILING claim below the newest tag ------------------------------------
#
# `test_a_document_naming_the_released_version_names_the_newest_tag` is
# parameterised over a HARDCODED list of documents, and its own docstring says
# it deliberately leaves the seventeen-vs-nineteen callout alone. Both
# decisions were right when made and both went wrong the moment 0.4.0 shipped:
# QUICKSTART.md told readers the release was `0.3.0` with seventeen commands
# and that they should **install from source instead**, and it said so for
# weeks because it was not on the list.
#
# This is the derived half. Not "does this page name the newest version" — a
# page need not name any — but the narrower, checkable thing: **no page may
# assert a CEILING or a CURRENCY below the newest tag.** Scope is every
# reader-facing page, discovered rather than listed.

_CEILING_CLAIMS = (
    re.compile(r"tags?\s+stops?\s+at\s+`?v?(\d+\.\d+\.\d+)`?", re.I),
    re.compile(r"`?v?(\d+\.\d+\.\d+)`?\s+the\s+current\s+one", re.I),
    re.compile(r"installs?\s+`?v?(\d+\.\d+\.\d+)`?\s+from\s+PyPI", re.I),
    re.compile(
        r"that\s+is\s+\*{0,2}`?v?(\d+\.\d+\.\d+)`?\*{0,2},\s+all\s+\w+\s+commands",
        re.I,
    ),
    re.compile(r"`?v?(\d+\.\d+\.\d+)`?\s+does\s+not\s+ship", re.I),
)

#: A sentence that dates itself is history, and history is allowed to name an
#: old ceiling — that is what a record IS.
_DATED = re.compile(
    r"dated note|used to|at the time|no longer|was the ruling|"
    r"shipped later|originally|superseded|before |until ",
    re.I,
)


def test_NO_PAGE_ASSERTS_A_RELEASE_CEILING_BELOW_THE_NEWEST_TAG():
    """Derived scope, so a new page inherits the guard rather than needing one.

    A ceiling claim is objectively checkable against `git tag`: "tags stop at
    `v0.3.0`" is either true or it is not. A page may still RECORD an old
    ceiling — the programme notes that ruled 0.4.0 out do exactly that — as
    long as the sentence dates itself.

    **Mid-bump, the ceiling is the version being RELEASED** — `mid_bump()`'s
    switch, joined 2026-08-27 after this guard rejected the `v0.4.10` tag in
    CI. QUICKSTART's "That is 0.4.9, all nineteen commands" and SETUP's
    "installs 0.4.9 from PyPI" are ceiling claims that match none of
    `_RELEASED_VERSION_CLAIMS`' shapes, so no sibling held them to
    `__version__` at the bump commit: the local gate was green with the
    stale pages in it, and the first thing to say so was the tag-verify —
    one CI cycle and a moved tag later than this test can say it.
    """
    newest = newest_release_tag()
    if newest is None:
        pytest.skip("this checkout cannot read its own tags")
    if mid_bump():
        from wringer import __version__

        newest = __version__
    newest_parts = tuple(int(n) for n in newest.lstrip("v").split("."))

    root = repo_root()
    skip = {".wringer", ".wringer.example", "node_modules", ".venv", "build",
            "dist", "coldread", ".git", ".pytest_cache", "benchmark"}
    capture = re.compile(r"field-re(port|sponse)|install-2026|-2026-\d\d-\d\d\.md")

    stale = []
    for page in sorted(root.rglob("*.md")):
        rel = page.relative_to(root)
        if any(part in skip for part in rel.parts) or capture.search(str(rel)):
            continue
        body = re.sub(r"```.*?```", "", page.read_text(encoding="utf-8"), flags=re.S)
        for pattern in _CEILING_CLAIMS:
            for match in pattern.finditer(body):
                claimed = tuple(int(n) for n in match.group(1).split("."))
                if claimed >= newest_parts:
                    continue
                # **A WINDOW, not a sentence.** Splitting on "." is wrong
                # here for the obvious reason nobody sees until it bites: a
                # version number contains periods, so the "sentence" around
                # `0.4.0` truncated mid-number and the dated note beside it
                # was never in scope. The guard reported a doc as stale that
                # had already been annotated — its own defect, not the page's.
                lo = max(0, match.start() - 240)
                hi = min(len(body), match.end() + 240)
                sentence = " ".join(body[lo:hi].split())
                if _DATED.search(sentence):
                    continue
                line = body[: match.start()].count("\n") + 1
                stale.append(f"{rel}:{line} → {sentence[:100]}")
    assert not stale, (
        f"the newest tag is {newest}, and these pages assert a release ceiling "
        "below it. A reader acts on a ceiling — by installing the wrong thing, "
        "or by not installing at all: " + "; ".join(stale)
    )


def test_THE_RELEASE_BAR_RUNS_THE_WHOLE_CHAIN():
    """**The structural half of the full run, 2026-08-26.**

    Until that day no release had ever run the whole machine, and every field
    report since had been somebody discovering whole-chain breakage that a
    ten-minute complete run would have caught first. The window that finally
    ran it end to end found the handover held up by Wringer's own board page —
    a stop no unit could see, because every unit passed.

    Fixing that one defect changes nothing structurally. Running the chain on
    every release does. This is what keeps it wired: the bar must invoke the
    check, and the check must exist.
    """
    root = repo_root()
    chain = root / "scripts" / "chain-completes.py"
    assert chain.is_file(), (
        "the chain-completes check is gone, so 'the machine completes' is "
        "again nobody's job until a person tries it"
    )
    bar = (root / "scripts" / "release-check.sh").read_text(encoding="utf-8")
    assert "chain-completes.py" in bar, (
        "the release bar no longer drives the whole chain — a release can "
        "again ship a machine that stops halfway with every test green"
    )
    body = chain.read_text(encoding="utf-8")
    assert "--send" not in body, (
        "the chain check spends money; it stands in for the paid seams and "
        "must stay runnable on any machine with no key"
    )


def test_the_release_count_in_CONTRIBUTING_matches_the_releases_it_lists():
    """**A hand-kept count, found stale on 2026-08-26**: the sentence said
    "Ten releases have shipped" and listed eleven, and had been wrong through
    at least one release before anybody read it.

    Derived from three places that cannot drift apart quietly: the versions
    the sentence itself names, the CHANGELOG's own entries, and
    `wringer.__version__`. The count is spelled in words, so the words are
    what is checked.
    """
    import re

    from wringer import __version__

    words = {
        8: "Eight", 9: "Nine", 10: "Ten", 11: "Eleven", 12: "Twelve",
        13: "Thirteen", 14: "Fourteen", 15: "Fifteen", 16: "Sixteen",
        17: "Seventeen", 18: "Eighteen", 19: "Nineteen", 20: "Twenty",
        21: "Twenty-one", 22: "Twenty-two", 23: "Twenty-three",
        24: "Twenty-four", 25: "Twenty-five", 26: "Twenty-six",
        27: "Twenty-seven", 28: "Twenty-eight", 29: "Twenty-nine",
        30: "Thirty",
        31: "Thirty-one",
        32: "Thirty-two",
        33: "Thirty-three",
        34: "Thirty-four",
        35: "Thirty-five",
        36: "Thirty-six",
        37: "Thirty-seven",
        38: "Thirty-eight",
        39: "Thirty-nine",
        40: "Forty",
        41: "Forty-one",
        42: "Forty-two",
        43: "Forty-three",
        44: "Forty-four",
        45: "Forty-five",
    }
    root = repo_root()
    contributing = (root / "CONTRIBUTING.md").read_text(encoding="utf-8")
    opening = contributing.split("Since `0.4.0`")[0]
    listed = re.findall(r"`v(\d+\.\d+\.\d+)`", opening)
    named = sorted(set(listed))

    # `[\w-]` and not `\w`: the count is spelled in words, and past twenty
    # those words are hyphenated. On `\w+` the search returned None and the
    # guard failed with "the sentence has been reworded" — reporting a stale
    # PATTERN as a stale document.
    said = re.search(r"\*\*([\w-]+) releases have shipped\*\*", opening)
    assert said, "the sentence that carries the count has been reworded"
    assert words.get(len(named)) == said.group(1), (
        f"CONTRIBUTING says {said.group(1)!r} releases and names "
        f"{len(named)}: {named}"
    )

    changelog = (root / "CHANGELOG.md").read_text(encoding="utf-8")
    released = set(re.findall(r"^## (\d+\.\d+\.\d+) — ", changelog, re.M))
    assert set(named) == released, (
        "CONTRIBUTING and the CHANGELOG disagree about which releases exist: "
        f"only in CONTRIBUTING {sorted(set(named) - released)}, only in the "
        f"CHANGELOG {sorted(released - set(named))}"
    )
    assert f"`v{__version__}` the current one" in opening, (
        f"CONTRIBUTING does not call {__version__} the current release"
    )


@pytest.mark.parametrize("document", _VERSION_PROSE)
def test_a_document_naming_the_released_version_names_THE_VERSION_IN_THE_SOURCE(
    document,
):
    """**The same claim, checked one step earlier — and this is the gap that
    cost a release run on 2026-08-26.**

    Its sibling above derives from `git tag`, which is exactly right and one
    beat too late: before the tag exists there is nothing for it to be wrong
    about, so a version bump can be committed, pushed and CI-green with every
    front page still naming the previous release. The tag is then pushed, four
    guards go red at once, and the release workflow refuses — correctly, and
    after the tag is already public.

    `wringer.__version__` moves in the bump commit itself. Checking against it
    puts the same guard in front of the person doing the bump, on their own
    machine, before anything is tagged.

    Skipped when the source version is already released — then the sibling
    above is the live check and this one has nothing to add.
    """
    require_checkout(document)
    from wringer import __version__

    if newest_release_tag() == __version__:
        pytest.skip("the source version is the newest tag; the sibling checks it")

    text = claimed_voice((repo_root() / document).read_text(encoding="utf-8"))
    flat = " ".join(text.replace("*", "").split())

    wrong = []
    for pattern in _RELEASED_VERSION_CLAIMS:
        for match in pattern.finditer(flat):
            if match.group(1) != __version__:
                wrong.append(match.group(0))
    assert not wrong, (
        f"{document} calls {wrong} the released version, but this working tree "
        f"is {__version__}. Update the pages in the bump commit — after the tag "
        "is pushed this is the release workflow's problem instead of yours."
    )


# --- the class that shipped four times ------------------------------------


#: Extensions that make a backticked string a claim about a FILE. A path with
#: no extension is almost always a bundle directory (`gates/`, `attempts/`),
#: which is runtime layout rather than a repository citation.
_PATH_EXTENSIONS = (
    ".md", ".py", ".yaml", ".yml", ".json", ".sh", ".txt", ".toml",
    ".html", ".svg", ".jsonl",
)

#: Characters that mean the string is a TEMPLATE, not a path: `<id>`,
#: `{1..4}`, `{cards,read}`, a glob, a shell variable.
_NOT_A_PATH = set("<>{}*?|$ ")

#: First segments that name a RUNTIME tree rather than this repository —
#: written by a run, absent from a checkout, and correctly so.
_RUNTIME_ROOTS = {
    ".wringer", "gates", "attempts", "iterations", "fs", "scratch", "arcade",
}


def _reader_facing_pages() -> list[Path]:
    """The pages a stranger reads, DERIVED rather than listed.

    Every `*.md` at the repository root plus the drive's own front pages.
    `CHANGELOG.md` is excluded because it is history: it records what a page
    said on the day, and correcting a quotation there would be editing the
    record.

    Captured field reports and the specs are out for the same reason — they
    quote runbooks verbatim, and several of those quotations are *supposed*
    to still be wrong.
    """
    root = repo_root()
    pages = sorted(
        set(root.glob("*.md")) | set((root / "docs" / "drive").glob("*.md"))
    )
    return [page for page in pages if page.name != "CHANGELOG.md"]


def _cited_paths(page: Path) -> list[str]:
    """Every backticked string on `page` that claims to be a file in here."""
    import re

    found = []
    text = page.read_text(encoding="utf-8", errors="replace")
    for match in re.finditer(r"`([^`\n]+)`", text):
        cited = match.group(1).strip().rstrip(".,;:)")
        if any(character in cited for character in _NOT_A_PATH):
            continue
        if "://" in cited or cited.startswith(("~", "/", "http")):
            continue
        if "/" not in cited or not cited.endswith(_PATH_EXTENSIONS):
            continue
        first = cited.split("/", 1)[0]
        if first in _RUNTIME_ROOTS:
            continue
        # `../x` addresses the READER's own layout — the worked example's PRD
        # sits one level above their project — and this repository cannot
        # check that. A citation of a file in here is written from the root,
        # which is what is checked below.
        if first == "..":
            continue
        found.append(cited)
    return found


def test_every_cited_repo_path_resolves_from_its_own_page():
    """**The class that has now shipped four times, through three guards that
    each shared its confusion.**

    A page in `docs/drive/` said `wringer-drive/docs/pm-mode-2026-08-17.md`
    and three other pages copied it. There is no `wringer-drive/` directory —
    the packages merged into one on 2026-08-20 — and the file is at
    `docs/drive/docs/pm-mode-2026-08-17.md`. In SECURITY.md those two
    citations are the EVIDENCE column for the "not contained" rows, so a
    reader auditing the security claims could not reach the capture.

    `docs/drive/AGENTS.md:210` documents the identical prefix being found and
    fixed on 2026-08-26 — and it survived on four other pages, because the
    guards that existed resolved paths against ONE root each and the errors
    cancelled.

    So every cited path is resolved **from the repository root**, which is
    this house's citation convention on every page that has one.

    **The carrier asked for own-directory resolution as well, and that branch
    is deliberately NOT here.** It was written, and then measured: no citation
    on any reader-facing page needs it — the drive's own pages cite
    `docs/drive/examples/…` from the root like everything else — and a
    second accepted root can only ever EXCUSE a citation, never catch one. So
    it would have been an unexercised branch that made the guard more
    permissive while reading as coverage, which is the exact disease this
    guard was commissioned to end. Reported to Fable rather than added
    silently.

    Measured RED on the shipped text before the fix: five, in EVIDENCE.md,
    README.md, README-PM.md and SECURITY.md twice. Seventy-two paths were
    swept to find them, so this is not a guard that passes by looking at
    nothing.
    """
    require_checkout("README.md", "docs/drive/README.md")
    root = repo_root()
    swept = 0
    broken: list[str] = []
    for page in _reader_facing_pages():
        for cited in _cited_paths(page):
            swept += 1
            if not (root / cited).exists():
                broken.append(
                    f"{page.relative_to(root)} cites `{cited}` — no such file"
                )

    assert swept > 40, (
        f"only {swept} cited paths found across "
        f"{len(_reader_facing_pages())} pages — this guard would pass while "
        "checking almost nothing. Did the pages move, or the predicate rot?"
    )
    assert not broken, "citations that resolve to nothing:\n  " + "\n  ".join(
        broken
    )


def test_SECURITYs_supported_versions_table_names_every_release():
    """**Hand-kept, and it had already skipped two.**

    `0.4.5` and `0.4.11` are real tags with CHANGELOG entries and both
    shipped to PyPI, and neither had a row — on the one page where "is my
    version covered" is the whole question. Sixteen releases were listed
    where eighteen had shipped, and nothing noticed, because the table was
    maintained by hand and guarded by nothing.

    Derived from `git tag`, the same pattern the release-count guard in
    CONTRIBUTING already uses, so a release cannot skip it again.

    **Mid-bump defers**, exactly as the other tag-derived guards do: between
    the bump commit and the tag, the table names the version being released
    and no tag exists for it yet. Its sibling below is the live check then.
    """
    require_checkout("SECURITY.md")
    tagged = release_tags()
    if tagged is None:
        pytest.skip("this checkout has no tags, so the table cannot be derived")

    text = (repo_root() / "SECURITY.md").read_text(encoding="utf-8")
    start = text.index("## Supported versions")
    table = text[start:]
    end = table.find("\n## ")
    table = table[:end] if end != -1 else table

    listed = set(re.findall(r"^\| `(\d+\.\d+\.\d+)`", table, re.M))
    assert len(listed) > 10, (
        f"only {len(listed)} versions found in SECURITY.md's table — this "
        "guard would pass while checking almost nothing"
    )

    from wringer import __version__

    # Mid-bump: the version being released is in the table and not yet a tag.
    expected = tagged | ({__version__} if mid_bump() else set())
    missing = sorted(expected - listed)
    stray = sorted(listed - expected)
    assert not missing, (
        f"SECURITY.md's supported-versions table omits {missing} — releases "
        "that shipped, on the page whose whole question is whether a version "
        "is covered"
    )
    assert not stray, (
        f"SECURITY.md's table names {stray}, which no tag matches — a row "
        "for a release that does not exist"
    )


def _tests_defined_in_the_suite() -> set[str]:
    """Every `test_*` this suite defines, by name.

    Parsed from the files rather than collected through pytest: a collection
    run inside a test is slow and can pass for reasons of its own, and the
    question here is only whether a NAME exists to be run.
    """
    found: set[str] = set()
    for path in (repo_root() / "tests").rglob("*.py"):
        text = path.read_text(encoding="utf-8", errors="replace")
        found.update(re.findall(r"^\s*def (test_\w+)", text, re.M))
    return found


def test_every_test_a_spec_cites_actually_exists():
    """**A spec citing a test that does not exist is a claim guarded by
    nothing, dressed as a claim guarded by something.**

    The specs name a `test_*` beside a ruling to say "this is how a reviewer
    catches a violation". Thirty of those names resolved to nothing. The
    sharpest was SPEC_BOARD B1, whose row says *"Structural, because a page
    test cannot catch a server"* — and neither
    `test_the_surface_ships_no_server` nor `test_the_page_makes_no_request`
    existed, so the row's ONLY check was the sentence claiming there was one.

    Two more were dead because of a correct change: D0 deleted the two
    lexical refusal guards on 2026-08-30 and their citations stayed. A
    citation is part of the ruling it sits in, and it moves with the code.

    **A dead citation is corrected to the test that really covers the claim,
    or the claim is struck and marked UNGUARDED with a date.** It is never
    re-pointed at a weaker test that happens to exist — that is the vacuity
    disease in citation form, and it is worse than the hole, because it
    closes the hole in the reader's mind and not on disk.

    A struck citation is written without backticks on purpose, so the record
    of what was intended survives while this guard stops asserting it.
    """
    require_checkout("docs/specs")
    defined = _tests_defined_in_the_suite()
    assert len(defined) > 1000, (
        f"only {len(defined)} tests found — this guard would pass while "
        "checking almost nothing"
    )

    cited: dict[str, set[str]] = {}
    for spec in sorted((repo_root() / "docs" / "specs").glob("*.md")):
        text = spec.read_text(encoding="utf-8", errors="replace")
        for name in re.findall(r"`(test_\w+)`", text):
            cited.setdefault(name, set()).add(spec.name)

    assert len(cited) > 40, (
        f"only {len(cited)} test citations found across the specs — did the "
        "citation style change, or the specs move?"
    )

    dead = sorted(
        f"{name} (cited by {', '.join(sorted(where))})"
        for name, where in cited.items()
        if name not in defined
    )
    assert not dead, (
        "specs cite tests that do not exist — each is a ruling whose stated "
        "guard is a sentence:\n  " + "\n  ".join(dead)
    )


def test_no_printed_pointer_names_a_page_the_INSTALLED_package_lacks():
    """**Run 4's blind blocker, 2026-09-01.** `wring start`'s door label said
    "docs/vendors.md holds the measured commands" — a repo-relative path.
    `uv tool install wringer` ships four commands and no docs directory, so
    the neutral front door's only vendor pointer was dead on the exact
    artifact a clean operator holds, and the blind phase ended there.

    The property "resolves for an installed user" reduces to "is a full
    URL": every `docs/` reference inside a string literal in the shipped
    packages must be part of the one canonical URL base. Comments are
    exempt — they ship to nobody.
    """
    import ast as ast_module

    base = "github.com/marcoakes/wringer/blob/main/docs/"
    offenders = []
    for package in ("wringer", "wringer_board", "wringer_drive"):
        for path in sorted((repo_root() / "src" / package).glob("*.py")):
            tree = ast_module.parse(path.read_text(encoding="utf-8"))
            # Docstrings ship to nobody: they are never printed, rendered,
            # or written into an artifact, so a spec citation there is for a
            # source reader who has the repository by definition.
            docstrings = set()
            for scope in ast_module.walk(tree):
                if isinstance(
                    scope,
                    (
                        ast_module.Module,
                        ast_module.FunctionDef,
                        ast_module.AsyncFunctionDef,
                        ast_module.ClassDef,
                    ),
                ) and scope.body:
                    first = scope.body[0]
                    if isinstance(first, ast_module.Expr) and isinstance(
                        first.value, ast_module.Constant
                    ):
                        docstrings.add(id(first.value))
            for node in ast_module.walk(tree):
                if id(node) in docstrings:
                    continue
                if not (
                    isinstance(node, ast_module.Constant)
                    and isinstance(node.value, str)
                    and "docs/" in node.value
                ):
                    continue
                text = node.value
                bad = [
                    index
                    for index in range(len(text))
                    if text.startswith("docs/", index)
                    and not text[:index].endswith(
                        "github.com/marcoakes/wringer/blob/main/"
                    )
                ]
                if bad:
                    offenders.append(f"{path.name}:{node.lineno} {text[:90]!r}")
    assert not offenders, (
        "these strings point an installed user at pages the package does "
        "not ship — use the full URL (…" + base + "<page>):\n  "
        + "\n  ".join(offenders)
    )


def test_the_CONSENT_CONTRACT_is_written_where_deliver_is_specified():
    """**Ruled 2026-09-01, after run 4B.** Two runs expected a second yes from
    bare `wring deliver --send` and reported its absence as a defect; the
    CLI was right and the guidance promised the wrong surface. The contract
    is pinned on the spec that owns `deliver` and on the drive's runbook,
    in the ruling's own words, so no page can drift back to promising a
    re-ask from an imperative flag."""
    sentence = "typing the flag is consent and it does not ask again"

    def flat(path):
        return " ".join(path.read_text(encoding="utf-8").split())

    spec_page = flat(repo_root() / "docs" / "specs" / "SPEC_GET_V0.md")
    assert sentence in spec_page, "SPEC_GET_V0.md lost the consent contract"
    assert "asks the informed second yes" in spec_page
    runbook = flat(repo_root() / "docs" / "drive" / "AGENTS.md")
    assert sentence in runbook, "the drive runbook lost the consent contract"
    assert "The second yes is the DRIVE's" in runbook


def test_the_DISPLAY_PROPOSAL_ruling_is_written_where_show_is_specified():
    """**P0.3, 2026-09-02.** `show:` was ruled into `.wringer.yaml` and out
    of the spec because a model-drafted value RUNS. The proposal keeps that
    ruling — the sidecar proposes, the person applies — and the spec that
    owns plan-time visibility has to say so in the same breath as MR2, or the
    next reader infers that a proposed display is installed by the plan."""

    def flat(path):
        return " ".join(path.read_text(encoding="utf-8").split())

    page = flat(repo_root() / "docs" / "specs" / "SPEC_COVERAGE_V0.md")
    assert "Ruling MR3" in page, "SPEC_COVERAGE_V0.md lost the display-proposal ruling"
    assert "proposed, never installed" in page
    assert "the same yes" in page
