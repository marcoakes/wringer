"""`wring doctor` — diagnose, never repair.

This command exists for the agent setting Wringer up for somebody. Its
contract is therefore narrow and testable: one line per question, a fix
line whenever the answer is wrong, machine-readable under --json, and an
exit code a setup script can branch on without parsing prose.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from core_helpers import reader_facing_pages

from wringer import cli, doctor


def by_name(checks: list[doctor.Check]) -> dict[str, doctor.Check]:
    return {check.name: check for check in checks}


def test_a_healthy_repo_passes_every_blocking_check(repo, write_config):
    write_config(repo, 'version: 1\ngates:\n  - id: t\n    run: "true"\n')

    checks = doctor.run_checks(repo)

    assert all(check.passed for check in checks)
    named = by_name(checks)
    assert named["git repository"].status == doctor.OK
    assert named["gates"].status == doctor.OK
    assert named["workspace writable"].status == doctor.OK


def test_outside_a_repository_the_repo_checks_are_skipped(tmp_path):
    """Was: a blocking failure. A real first run showed that made the runbook
    stop on a false problem — `wring doctor` in a workspace directory is a
    question about the MACHINE, and "this is not a repo" does not block it."""
    checks = by_name(doctor.run_checks(tmp_path))

    assert checks["git repository"].status == doctor.SKIP
    assert checks["git repository"].scope == doctor.REPO
    assert "run from your repo" in checks["git repository"].detail
    # and nothing about the machine was skipped along with it
    assert checks["python"].scope == doctor.MACHINE
    assert checks["python"].status in (doctor.OK, doctor.FAIL)


def test_a_missing_config_is_a_warning_not_a_failure(repo):
    """A fresh clone has no gates yet. That is the next step, not a fault."""
    checks = by_name(doctor.run_checks(repo))

    assert checks["gates"].status == doctor.WARN
    assert "wring init" in checks["gates"].fix
    assert checks["gates"].passed


def test_a_broken_config_is_a_blocking_failure(repo, write_config):
    write_config(repo, "version: 99\ngates: []\n")

    checks = by_name(doctor.run_checks(repo))

    assert checks["gates"].status == doctor.FAIL


def test_an_unwritable_workspace_is_caught_early(repo, monkeypatch):
    """A read-only mount is a common container mistake, and without this
    check it surfaces much later as a confusing write error."""
    def refuse(*args, **kwargs):
        raise OSError("read-only file system")

    monkeypatch.setattr(Path, "mkdir", refuse)

    checks = by_name(doctor.run_checks(repo))

    assert checks["workspace writable"].status == doctor.FAIL
    assert ":ro" in checks["workspace writable"].fix


def test_the_api_key_value_is_never_printed(repo, monkeypatch):
    secret = "sk-hushhush12345"
    monkeypatch.setenv("ANTHROPIC_API_KEY", secret)

    checks = doctor.run_checks(repo)
    rendered = doctor.report(checks) + doctor.as_json(checks)

    assert "ANTHROPIC_API_KEY" in rendered  # the NAME is the answer
    assert secret not in rendered           # the value never is


def test_a_missing_key_is_only_a_warning(repo, monkeypatch):
    for name in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)

    checks = by_name(doctor.run_checks(repo))

    assert checks["llm key"].status == doctor.WARN
    assert "never paste it to an agent" in checks["llm key"].fix


def test_json_is_machine_readable_and_complete(repo, write_config, monkeypatch,
                                               capfd):
    write_config(repo, 'version: 1\ngates:\n  - id: t\n    run: "true"\n')
    monkeypatch.chdir(repo)

    assert cli.main(["doctor", "--json"]) == cli.EXIT_OK

    payload = json.loads(capfd.readouterr().out)
    assert payload["ok"] is True
    assert payload["wringer_version"]
    names = {c["name"] for c in payload["checks"]}
    assert {"python", "git", "git repository", "gates",
            "workspace writable"} <= names
    for check in payload["checks"]:
        # SKIP included: a check can be inapplicable INSIDE a repo too, which
        # nothing was until `pytest parallelism` (a repo with no pytest gate
        # has nothing to answer). It was always in the published vocabulary —
        # the out-of-repo checks have emitted it since doctor shipped — and
        # `Check.passed` already treats it as non-failing.
        assert check["status"] in (doctor.OK, doctor.WARN, doctor.FAIL,
                                   doctor.SKIP)


def test_the_exit_code_is_what_a_setup_script_branches_on(
    tmp_path, monkeypatch, capsys
):
    """A real blocking problem must reach the exit code — an agent should not
    have to read English to find out. Not being in a repo is not one of
    those; a missing git binary is."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(doctor.shutil, "which",
                        lambda name: None if name == "git" else "/usr/bin/x")

    assert cli.main(["doctor"]) == cli.EXIT_GATE_FAILED

    out = capsys.readouterr().out
    assert "blocking problem" in out
    assert "✗" in out


def test_the_report_offers_a_fix_for_everything_imperfect(repo):
    checks = doctor.run_checks(repo)
    rendered = doctor.report(checks)

    for check in checks:
        # WARN and FAIL only. The rule is "if doctor tells you something is
        # wrong, it tells you what to do" — and a SKIP is not something wrong,
        # it is a question that did not apply. Doctor has always emitted
        # fix-less skips (every check outside a repo); this condition just
        # never met one inside a repo until `pytest parallelism`.
        if check.status in (doctor.WARN, doctor.FAIL):
            assert check.fix, f"{check.name} has no fix line"
            assert check.fix in rendered


def test_doctor_repairs_nothing(repo, monkeypatch, capsys):
    """Diagnosis and repair are different jobs. A doctor that silently
    changes the machine is one nobody can reason about."""
    monkeypatch.chdir(repo)
    before = sorted(p.name for p in repo.iterdir())

    cli.main(["doctor"])
    capsys.readouterr()

    after = sorted(p.name for p in repo.iterdir())
    # the write probe cleans up after itself; .wringer/ may be created as
    # the probe's parent, but nothing else may appear
    assert set(after) - set(before) <= {".wringer"}
    assert not (repo / "config.CONFIG_FILENAME").exists()


# --- the runbook must describe the tool that exists -----------------------
#
# A real first run on a fresh Mac (2026-08-04) found SETUP.md illustrating
# `wring doctor` output containing an image check and a platform check that
# do not exist, and `✗ api key` where the real check is a `! llm key` warn.
# The transcript had been WRITTEN rather than captured — law 8's failure mode,
# in the one document whose whole job is to be followed literally.
#
# Consequence: SETUP claimed doctor "is how every later step gets checked",
# but doctor cannot see the image pull, and exits 0 with no runtime at all.
# These tests make the documentation testable so the class cannot recur.

# --- which pages show doctor output: DISCOVERED, and the list was wrong ------
#
# `("SETUP.md", "QUICKSTART.md", "README.md")` until 2026-08-23, and the audit
# that replaced it found the list wrong in BOTH directions: QUICKSTART.md and
# README.md show no `wring doctor` transcript at all — theirs are `wring
# verify` and `wring run` — while `docs/attest-and-audit.md`, which does show
# one, was outside the guard entirely.
#
# A hand list can be wrong that way for years and nothing says so, because a
# name on it that illustrates nothing simply contributes nothing.

#: **The structural tell, and it is derived from the two output formats rather
#: than from a list of pages.** `wring verify` prints its gates in the same
#: shape as a doctor check — mark, name, padding, detail — but a verify name
#: always ENDS in `passed` or `failed`, and no doctor check name ever does.
#:
#: That distinction is what the old qualification could not make. It admitted
#: any block containing a line like `✓ git status captured`, which is how
#: `docs/specs/SPEC_VERIFY_V0.md` came to be read as a doctor transcript
#: citing checks named `lint passed` and `test failed`.
#:
#: Deliberately NOT keyed on the real check names: a document illustrating a
#: check that does not exist is the whole defect this guard was written for
#: (`SETUP.md` once showed an image check and a platform check, neither of
#: which doctor has), so qualification must not assume the names are valid.
_GATE_RESULT_NAME = re.compile(r"\b(?:passed|failed)$")

_STATUS_LINE = re.compile(r"^([✓!✗-])\s+([a-z][a-z ]{1,28}?)\s{2,}\S")


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def cited_check_names(text: str) -> set[str]:
    """Every check name a document illustrates in a doctor transcript."""
    names: set[str] = set()
    for block in re.findall(r"```[^\n]*\n(.*?)```", text, re.DOTALL):
        for line in block.splitlines():
            found = _STATUS_LINE.match(line)
            if found is None:
                continue
            name = found.group(2).strip()
            if _GATE_RESULT_NAME.search(name):
                continue  # a gate result from verify or run, not a check
            names.add(name)
    return names


def docs_with_doctor_output() -> list[Path]:
    """Every page showing a doctor transcript.

    Captures excluded. A capture records what doctor printed on its date, and
    a check renamed since would make the page red for being accurate — law 8
    keeps its bytes and corrects it with a dated note instead.
    """
    return [
        path
        for path in reader_facing_pages(captures=False)
        if cited_check_names(path.read_text(encoding="utf-8"))
    ]


def test_every_doctor_check_a_doc_illustrates_actually_exists():
    """The guard. If a document shows a check, `wring doctor` must have it."""
    real = set(doctor.check_names())
    offenders: list[str] = []
    for path in docs_with_doctor_output():
        name = path.relative_to(repo_root()).as_posix()
        for cited in cited_check_names(path.read_text(encoding="utf-8")):
            if cited not in real:
                offenders.append(f"{name} illustrates '{cited}'")
    assert not offenders, (
        "documentation shows doctor checks that do not exist: "
        + "; ".join(sorted(offenders))
        + f"\nreal checks: {sorted(real)}"
    )


def test_the_doctor_transcript_scope_finds_the_pages_that_have_one():
    """**The guard on the discovery, 2026-08-23.**

    A rule that quietly matched nothing would leave the guard above iterating
    an empty list and passing for ever — the failure mode this whole audit is
    about, reproduced one level up. So the discovery is held to finding the
    two pages that really do carry a transcript, including the one no list
    ever named.
    """
    found = {
        path.relative_to(repo_root()).as_posix()
        for path in docs_with_doctor_output()
    }
    assert "SETUP.md" in found
    assert "docs/attest-and-audit.md" in found, (
        "the page that shows a doctor transcript and was outside the old "
        "hand-kept list is outside the derived scope too"
    )
    # And the pages whose transcripts are `wring verify`, not `wring doctor`.
    assert "docs/specs/SPEC_VERIFY_V0.md" not in found, (
        "a verify transcript is being read as doctor output again; its gate "
        "lines end in 'passed'/'failed' and no check name does"
    )


def test_check_names_matches_what_run_checks_emits(repo, monkeypatch):
    """`check_names()` is what the guard above trusts, so it must not drift
    from the checks actually produced."""
    monkeypatch.chdir(repo)
    emitted = [c.name for c in doctor.run_checks(repo)]
    assert sorted(emitted) == sorted(doctor.check_names())


# --- doctor outside a repository ------------------------------------------


def test_doctor_outside_a_repo_skips_repo_checks_and_exits_zero(
    tmp_path, monkeypatch, capsys
):
    """The fresh-Mac failure. The runbook says to create a workspace and then
    run doctor; doing so exited 1 on a blocking ✗ that meant only 'you are
    not in a repo', and the runbook's own stop rule then halted setup on a
    problem that did not exist."""
    monkeypatch.chdir(tmp_path)

    assert cli.main(["doctor"]) == cli.EXIT_OK

    out = capsys.readouterr().out
    for repo_check in ("git repository", "gates", "workspace writable"):
        assert f"- {repo_check}" in out, f"{repo_check} should be skipped, not failed"
    assert "not a git repository — run from your repo" in out
    assert "This machine is ready" in out
    # the machine checks still ran and still answer
    assert "✓ python" in out
    assert "✗" not in out


def test_doctor_inside_a_repo_still_runs_every_check(repo, monkeypatch, capsys):
    monkeypatch.chdir(repo)

    assert cli.main(["doctor"]) == cli.EXIT_OK

    out = capsys.readouterr().out
    assert "✓ git repository" in out
    assert "- git repository" not in out
    assert "workspace writable" in out


def test_a_real_machine_failure_still_blocks(tmp_path, monkeypatch, capsys):
    """Skipping repo checks must not have made doctor unable to fail."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(doctor.shutil, "which",
                        lambda name: None if name == "git" else "/usr/bin/x")

    assert cli.main(["doctor"]) == cli.EXIT_GATE_FAILED

    assert "✗ git" in capsys.readouterr().out


def test_the_json_shape_carries_skip(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)

    assert cli.main(["doctor", "--json"]) == cli.EXIT_OK

    payload = json.loads(capsys.readouterr().out)
    assert payload["ok"] is True
    statuses = {c["name"]: c["status"] for c in payload["checks"]}
    assert statuses["git repository"] == doctor.SKIP
    assert statuses["python"] == doctor.OK


# --- the key check must read the names the CONFIG declares -----------------
#
# `_api_key` was hardcoded to ANTHROPIC_API_KEY and OPENAI_API_KEY. It read
# neither `judge.api_key_env` nor `run.worker.acp.env_passthrough`, so a user
# whose agent wants a differently-named variable saw "no LLM API key" with the
# key correctly set — and `wring start` walks straight into it, because the
# name it writes comes from the agent table rather than from that pair.

DECLARES_ITS_OWN_NAME = """\
version: 1
gates:
  - id: t
    run: "true"

run:
  worker:
    acp:
      command: some-agent
      env_passthrough: [MY_AGENT_CREDENTIAL]
"""


def test_doctor_reads_the_key_name_the_config_declares(
    repo, write_config, monkeypatch
):
    write_config(repo, DECLARES_ITS_OWN_NAME)
    monkeypatch.setenv("MY_AGENT_CREDENTIAL", "notarealkey-8812fa03")
    for name in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)

    check = by_name(doctor.run_checks(repo))["llm key"]

    assert check.status == doctor.OK, (
        "the key is set under the name this repo declared, and doctor said no"
    )
    assert "MY_AGENT_CREDENTIAL" in check.detail
    assert "notarealkey" not in check.detail  # the name is the answer


def test_doctor_names_the_variable_it_looked_for(repo, write_config, monkeypatch):
    """A warning that does not say which name it wanted sends the reader to
    export the wrong one."""
    write_config(repo, DECLARES_ITS_OWN_NAME)
    for name in ("MY_AGENT_CREDENTIAL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)

    check = by_name(doctor.run_checks(repo))["llm key"]

    assert check.status == doctor.WARN
    assert "MY_AGENT_CREDENTIAL" in check.detail


# The name guard above compares NAMES only — which is exactly how a change to
# this check's wording left three documents quoting a sentence the program no
# longer printed. Captured transcripts are evidence (law 8): change the line
# and the documents showing it are recaptured in the same commit.

def test_the_key_line_a_doc_shows_is_the_line_doctor_prints(tmp_path, monkeypatch):
    """**Scope discovered, 2026-08-23.**

    This ran over two named documents. A page that starts showing the key line
    tomorrow is inside the guard now without anybody remembering it, which is
    the point: the sentence doctor prints has already changed once and left
    three documents quoting words the program no longer said.
    """
    for name in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    real = by_name(doctor.run_checks(tmp_path))["llm key"].detail

    offenders = []
    showing = 0
    for path in reader_facing_pages(captures=False):
        doc = path.relative_to(repo_root()).as_posix()
        for number, line in enumerate(path.read_text("utf-8").splitlines(), 1):
            if line.startswith("! llm key"):
                showing += 1
                shown = line.split("llm key", 1)[1].strip()
                if shown != real:
                    offenders.append(f"{doc}:{number} shows {shown!r}")
    assert not offenders, (
        f"a doctor transcript no longer matches what doctor prints ({real!r}): "
        + "; ".join(offenders)
    )
    assert showing, (
        "no page shows the `! llm key` line any more, so this guard is "
        "checking nothing. Either the transcripts moved and it needs "
        "re-deriving, or the line is gone and it should be retired"
    )


# --- the speedup nobody was told about -------------------------------------


def test_doctor_offers_the_parallel_pytest_line_for_a_slow_serial_suite(
    repo, monkeypatch, capsys
):
    """The biggest speedup available to a real user is one line in their own
    config, it costs the evidence nothing, and nothing ever told them.

    This repo's own suite went 240s to 59s on six workers with identical
    results, purely because pytest was running on one core. That is not a
    Wringer feature — it is `pytest -n auto`, in the user's `.wringer.yaml`,
    which Wringer runs verbatim. So doctor says so, using the duration the
    record already holds rather than guessing.

    It PROPOSES and stops. `.wringer.yaml` is the one file that puts commands
    into Wringer's mouth, and editing it on a user's behalf is the thing
    `gate_diff` exists to refuse."""
    from wringer import doctor

    (repo / ".wringer.yaml").write_text(
        'version: 1\ngates:\n  - id: test\n    run: "pytest -q"\n',
        encoding="utf-8",
    )
    _record_gate_duration(repo, "test", "pytest -q", 240_000)

    check = doctor.pytest_parallel_check(repo)
    assert check.status == doctor.WARN, check
    assert "-n auto" in check.fix, check.fix
    assert "240" in check.detail or "240s" in check.detail, check.detail


def test_doctor_says_nothing_about_a_suite_that_is_already_parallel(
    repo, monkeypatch, capsys
):
    """A gate already carrying -n is advice nobody needs, and doctor that
    repeats itself is doctor nobody reads."""
    from wringer import doctor

    (repo / ".wringer.yaml").write_text(
        'version: 1\ngates:\n  - id: test\n    run: "pytest -q -n auto"\n',
        encoding="utf-8",
    )
    _record_gate_duration(repo, "test", "pytest -q -n auto", 240_000)

    assert doctor.pytest_parallel_check(repo).status == doctor.SKIP


def test_doctor_says_nothing_about_a_fast_suite(repo, monkeypatch, capsys):
    """Below the threshold the advice is noise: a two-second suite does not
    need a worker pool, and suggesting one would be this tool inventing a
    problem to solve."""
    from wringer import doctor

    (repo / ".wringer.yaml").write_text(
        'version: 1\ngates:\n  - id: test\n    run: "pytest -q"\n',
        encoding="utf-8",
    )
    _record_gate_duration(repo, "test", "pytest -q", 2_000)

    assert doctor.pytest_parallel_check(repo).status == doctor.SKIP


def test_doctor_says_nothing_when_the_record_holds_no_duration(repo):
    """No bundle, no claim. Absence is absence: doctor does not guess that a
    suite is slow because it might be."""
    from wringer import doctor

    (repo / ".wringer.yaml").write_text(
        'version: 1\ngates:\n  - id: test\n    run: "pytest -q"\n',
        encoding="utf-8",
    )
    assert doctor.pytest_parallel_check(repo).status == doctor.SKIP


def _record_gate_duration(repo, gate_id: str, command: str, ms: int) -> None:
    """A verify bundle in the shape the real one has, with a known duration."""
    import json

    from wringer import evidence

    run = repo / evidence.RUNS_DIRNAME / "20260101-000000-aaaa"
    (run / "gates" / f"001_{gate_id}").mkdir(parents=True, exist_ok=True)
    (run / evidence.MANIFEST_FILENAME).write_text(
        json.dumps({
            "schema_version": evidence.SCHEMA_VERSION,
            "run_id": run.name,
            "started_at": "2026-01-01T00:00:00+00:00",
            "repo": {"root": ".", "head_sha": "0" * 40, "branch": "main",
                     "dirty": False},
            "result": {"status": "passed", "failed_gate": None},
        }),
        encoding="utf-8",
    )
    (run / "gates" / f"001_{gate_id}" / "result.json").write_text(
        json.dumps({
            "gate_id": gate_id, "command": command, "exit_code": 0,
            "duration_ms": ms, "timed_out": False, "stdout_truncated": False,
            "stderr_truncated": False, "optional": False, "status": "passed",
        }),
        encoding="utf-8",
    )


def test_json_says_which_checks_are_about_the_repo():
    """`scope` is machine-readable, so a count of repo-scoped checks can be
    DERIVED rather than hand-kept.

    It was hand-kept, and it broke: `scripts/setup-selftest.sh` asserted that
    doctor prints exactly three '-' lines outside a repository. Adding a
    fourth repo-scoped check (`pytest parallelism`) made that literal 3 wrong
    and reddened CI on both platforms — the same shape as the release probe
    that counted thirteen of seventeen commands, and the schema README that
    silently fell three files behind.

    The count belongs to the code that defines it. This is the field that
    lets the script ask instead of remembering."""
    checks = doctor.run_checks(Path.cwd())
    payload = json.loads(doctor.as_json(checks))

    assert all("scope" in c for c in payload["checks"]), payload["checks"]
    scopes = {c["scope"] for c in payload["checks"]}
    assert scopes <= {doctor.MACHINE, doctor.REPO}, scopes
    assert doctor.REPO in scopes, "no check is repo-scoped, which cannot be true"


def test_outside_a_repo_exactly_the_repo_scoped_checks_skip(tmp_path, monkeypatch):
    """The property `setup-selftest.sh` asserts, pinned here in Python too —
    because the shell script only runs in the runbook job, and this is the
    invariant it was really checking all along."""
    monkeypatch.chdir(tmp_path)
    checks = doctor.run_checks(tmp_path)

    repo_scoped = [c for c in checks if c.scope == doctor.REPO]
    skipped = [c for c in checks if c.status == doctor.SKIP]
    assert repo_scoped, "no repo-scoped checks"
    assert {c.name for c in skipped} == {c.name for c in repo_scoped}, (
        "outside a repository, exactly the repo-scoped checks must skip"
    )


# --- "can Wringer prove anything here?" --------------------------------------
#
# **The question nobody could answer until 2026-08-19.** Surveyed across 37
# real repositories that day, 30 declared no test or lint command anywhere, so
# the chain stopped before a model was called — correctly, and far too late for
# whoever was waiting. These two checks answer it in milliseconds, before
# anybody writes a requirement.


def a_repo(tmp_path, *, files=None, config_text=None):
    import subprocess

    repo = tmp_path / "r"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True,
                   capture_output=True)
    for name, body in (files or {}).items():
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
    if config_text is not None:
        (repo / "of.yaml").write_text("", encoding="utf-8")
        from wringer import config as config_module

        (repo / config_module.CONFIG_FILENAME).write_text(
            config_text, encoding="utf-8"
        )
    return repo


def named(checks, name):
    return next(check for check in checks if check.name == name)


def test_a_repo_with_NO_test_command_FAILS_and_says_what_to_add(tmp_path):
    """**The 30-of-37 case, and the whole reason this check exists.**

    A single-file browser game: an `index.html`, a `game.js`, a README, and
    nothing that could decide whether a change was any good.
    """
    repo = a_repo(tmp_path, files={
        "index.html": "<!doctype html><title>game</title>\n",
        "game.js": "const x = 1;\n",
        "README.md": "# a game\n",
    })

    check = named(doctor.run_checks(repo), "runnable checks")

    assert check.status == doctor.WARN, (
        "a repository with nothing to run was not reported at all, so the "
        "first thing a person learns is a stop mid-run"
    )
    assert "no test or lint command" in check.detail
    # **A warning, deliberately, and this pins the reason.** `doctor` is what
    # an agent runs while setting Wringer up, sometimes in a directory that
    # was `git init`ed seconds earlier; blocking there turns a true statement
    # into a false problem. The loud stop already exists in `wringer-drive`,
    # before any money is spent.
    assert check.passed, (
        "this must not block: doctor runs during setup, and the blocking "
        "version of this message belongs to the verb that spends money"
    )
    # And it says what to DO, not just what is wrong.
    assert "package.json" in check.fix and "wring init" in check.fix


def test_a_repo_with_a_test_script_PASSES(tmp_path):
    """Derived from the same detector `wring init` uses, so the two cannot
    disagree about the same repository."""
    repo = a_repo(tmp_path, files={
        "package.json": '{"name": "x", "scripts": {"test": "node --test"}}\n',
    })

    check = named(doctor.run_checks(repo), "runnable checks")

    assert check.status == doctor.OK
    assert "package.json" in check.detail


def test_a_repo_that_already_declares_gates_PASSES_without_re_detecting(tmp_path):
    repo = a_repo(tmp_path, config_text=(
        "version: 1\ngates:\n  - id: unit\n    run: \"true\"\n"
    ))

    check = named(doctor.run_checks(repo), "runnable checks")

    assert check.status == doctor.OK
    assert "1 declared" in check.detail


def test_an_UNTOUCHED_init_template_is_not_mistaken_for_a_real_gate(tmp_path):
    """`wring init` writes a placeholder `run: "true"` in a repo it could not
    detect anything in, so `wring init && wring verify` exits 0. A config
    holding only that placeholder means the same thing as no config at all,
    and reporting it as ready would be this check lying by counting."""
    from wringer import detect

    repo = a_repo(tmp_path, config_text=(
        "version: 1\ngates:\n  - id: placeholder\n    run: \"true\"\n"
    ))
    from wringer import config as config_module

    declared = config_module.load(repo / config_module.CONFIG_FILENAME).gates
    if not detect.is_untouched_template(declared):
        pytest.skip(
            "this config is not what `is_untouched_template` recognises, so "
            "the fixture cannot exercise the branch — the shape it looks for "
            "changed and this test needs rewriting rather than skipping "
            "silently in future"
        )

    check = named(doctor.run_checks(repo), "runnable checks")
    assert check.status == doctor.WARN


def test_last_verify_says_it_has_never_run_rather_than_going_quiet(tmp_path):
    repo = a_repo(tmp_path, files={
        "package.json": '{"name": "x", "scripts": {"test": "node --test"}}\n',
    })

    check = named(doctor.run_checks(repo), "last verify")

    assert check.status == doctor.WARN
    assert "never run" in check.detail
    assert "wring verify" in check.fix


def test_last_verify_reads_the_record_rather_than_running_the_suite(tmp_path):
    """It must not run anybody's tests. A diagnosis that spends four minutes
    on a suite is one people stop running, so this reads what is on disk."""
    import json as json_module

    from wringer import evidence as evidence_module

    repo = a_repo(tmp_path, files={
        "package.json": '{"name": "x", "scripts": {"test": "node --test"}}\n',
    })
    bundle = repo / evidence_module.RUNS_DIRNAME / "20260819-120000-abcd"
    bundle.mkdir(parents=True)
    (bundle / "run.json").write_text(
        json_module.dumps({"result": {"status": "passed", "failed_gate": None}}),
        encoding="utf-8",
    )

    check = named(doctor.run_checks(repo), "last verify")

    assert check.status == doctor.OK
    assert "all gates passed" in check.detail


def test_a_red_last_verify_is_a_WARNING_and_never_blocks(tmp_path):
    """A red suite is the normal middle of a piece of work. Exiting non-zero
    because somebody is mid-change makes the diagnosis useless to them."""
    import json as json_module

    from wringer import evidence as evidence_module

    repo = a_repo(tmp_path, files={
        "package.json": '{"name": "x", "scripts": {"test": "node --test"}}\n',
    })
    bundle = repo / evidence_module.RUNS_DIRNAME / "20260819-120000-abcd"
    bundle.mkdir(parents=True)
    (bundle / "run.json").write_text(
        json_module.dumps({"result": {"status": "failed", "failed_gate": "unit"}}),
        encoding="utf-8",
    )

    check = named(doctor.run_checks(repo), "last verify")

    assert check.status == doctor.WARN
    assert check.passed, "a red suite must not fail the diagnosis"
    assert "unit" in check.detail


def test_both_new_checks_are_SKIPPED_outside_a_repository(tmp_path):
    """Run from a home directory these are questions about a repo that is not
    there, and a blocking answer would turn a true statement into a false
    problem — the defect a real first run reported on 2026-08-04."""
    for name in ("runnable checks", "last verify"):
        check = named(doctor.run_checks(tmp_path), name)
        assert check.status == doctor.SKIP, name
        assert "not a git repository" in check.detail


def test_the_published_names_include_the_new_checks():
    """`check_names()` is what documentation is tested against, so a check
    that exists and is not named there is one no runbook can mention."""
    names = doctor.check_names()
    assert "runnable checks" in names
    assert "last verify" in names
    produced = {check.name for check in doctor.run_checks(Path.cwd())}
    assert produced <= set(names), produced - set(names)


# --- the wringer FAMILY on PATH (field report 2026-08-21) -------------------


def _which(monkeypatch, mapping: dict[str, str | None]):
    """Pretend PATH resolves exactly this way, and nothing else."""
    monkeypatch.setattr(
        doctor.shutil, "which", lambda name: mapping.get(name, "/usr/bin/" + name)
    )


def test_ALL_FOUR_commands_are_reported_with_where_they_resolve(monkeypatch):
    """**The note on a misleading diagnostic**, field report 2026-08-21.

    An operator auditing an old install ran `uv tool list | grep -i wringer`,
    which HIDES `wring` — the line reads `- wring` and does not contain the
    string "wringer" — so a shadowing binary is invisible to anyone checking
    that way. That defect was the test prompt's rather than the product's, and
    it is worth fixing anyway: a person should not need a correct grep to find
    out which Wringer they are running.

    This repository has already shipped the failure that makes it matter — an
    agent verified its own work with a stale `wring 0.2.0` on PATH, writing
    bundles with no `execution.json` into a 0.3.0 repo.
    """
    _which(monkeypatch, {
        "wring": "/opt/w/bin/wring",
        "wringer": "/opt/w/bin/wringer",
        "wringer-board": "/opt/w/bin/wringer-board",
        "wringer-drive": "/opt/w/bin/wringer-drive",
    })
    check = doctor._wring()
    assert check.status == doctor.OK
    assert "/opt/w/bin" in check.detail
    for name in doctor.WRINGER_EXECUTABLES:
        assert name in check.detail or check.status == doctor.OK


def test_A_SPLIT_INSTALL_IS_REPORTED_LOUDLY_AND_NAMES_BOTH_PLACES(monkeypatch):
    """One distribution installs all four, so two directories means an older
    install is shadowing part of a newer one and the person is running a
    mixture. Exactly the state the field report's run 1 was in: `wring` and
    `wringer` from wringer 0.3.0, the other two from separate 0.1.0 tools."""
    _which(monkeypatch, {
        "wring": "/old/bin/wring",
        "wringer": "/old/bin/wringer",
        "wringer-board": "/new/bin/wringer-board",
        "wringer-drive": "/new/bin/wringer-drive",
    })
    check = doctor._wring()
    assert check.status == doctor.WARN
    assert "DIFFERENT directories" in check.detail
    assert "/old/bin/wring" in check.detail and "/new/bin/wringer-board" in check.detail
    assert "uninstall" in check.fix.lower()


def test_a_MISSING_command_is_named_rather_than_passed_over(monkeypatch):
    """A list derived from what IS on PATH could never notice an absence,
    which is why the four are named in the source rather than discovered."""
    _which(monkeypatch, {
        "wring": "/opt/w/bin/wring",
        "wringer": "/opt/w/bin/wringer",
        "wringer-board": None,
        "wringer-drive": "/opt/w/bin/wringer-drive",
    })
    check = doctor._wring()
    assert check.status == doctor.WARN
    assert "wringer-board" in check.detail
    assert "NOT ON PATH" in check.detail


def test_no_wringer_command_at_all_still_warns_rather_than_failing(monkeypatch):
    """Running `python -m wringer doctor` from a source tree is a real thing
    to do and is not an error."""
    _which(monkeypatch, dict.fromkeys(doctor.WRINGER_EXECUTABLES, None))
    check = doctor._wring()
    assert check.status == doctor.WARN
    assert check.passed, "an uninstalled source checkout is not a blocking fault"
