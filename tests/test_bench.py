"""`wring bench` — the spine (SPEC_BENCH_V0.md §1, §3a, §3b).

The command runs the same repair job through every declared worker, one at a
time, under identical conditions, and writes one comparison bundle. Every
assertion here defends one of the four things that make the rows comparable:

- **a red baseline**, because a benchmark of repair needs something to repair;
- **one common tree**, checked rather than assumed — a commit landing between
  worktree creations is refused rather than silently benched;
- **identical ceilings**, asserted on what `loop.run` is HANDED;
- **isolation that survives**, so the second bench on a repo cannot delete the
  first one's evidence.
"""

from __future__ import annotations

import json
from pathlib import Path

from conftest import flat

from wringer import bench, cli, loop

CONFIG = """\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
bench:
  contender_wall_clock: 300
  contenders:
    - id: fixer
      worker: "sh ./fix.sh"
    - id: idler
      worker: "true"
"""


def setup(repo: Path, git_run, *, config: str = CONFIG) -> None:
    """A repo whose gate is RED at HEAD — the shape a bench requires."""
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / "fix.sh").write_text("echo FIXED > calc.py\n", encoding="utf-8")
    (repo / ".wringer.yaml").write_text(config, encoding="utf-8")
    (repo / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    git_run(repo, "add", "-A")
    git_run(repo, "commit", "-qm", "a calculator with a planted bug")


def only_bench(repo: Path) -> Path:
    found = sorted((repo / bench.BENCHES_DIRNAME).iterdir())
    assert len(found) == 1, found
    return found[0]


def events(directory: Path) -> list[dict]:
    text = (directory / bench.EVENTS_FILENAME).read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def manifest(directory: Path) -> dict:
    return json.loads(
        (directory / bench.MANIFEST_FILENAME).read_text(encoding="utf-8")
    )


# --- the spine --------------------------------------------------------------


def test_a_bench_runs_every_contender_and_records_each_outcome(
    repo, git_run, monkeypatch, capsys
):
    """The whole point, with real workers really running against real gates:
    one converges, one does nothing, and both are RESULTS."""
    setup(repo, git_run)
    monkeypatch.chdir(repo)

    assert cli.main(["bench"]) == cli.EXIT_OK
    capsys.readouterr()

    directory = only_bench(repo)
    finished = {
        e["contender"]: e
        for e in events(directory)
        if e["type"] == "contender.finished"
    }
    assert set(finished) == {"fixer", "idler"}
    assert finished["fixer"]["outcome"] == "converged"
    assert finished["idler"]["outcome"] != "converged"
    # Each row references its own loop bundle, by path, never nested.
    for row in finished.values():
        assert (repo / row["loop_ref"]).is_dir()
        assert not (directory / "loops").exists()


def test_a_failure_to_converge_is_a_result_not_a_bench_failure(
    repo, git_run, monkeypatch, capsys
):
    """`wring run` exits 1 when the loop does not converge; bench does not
    follow it. Bench OBSERVES, so the observation completing is its success —
    a measuring instrument that exited non-zero after successfully measuring a
    failure would be reporting its own health with the patient's chart."""
    setup(repo, git_run)
    monkeypatch.chdir(repo)

    # Both contenders do nothing at all; nothing converges.
    (repo / ".wringer.yaml").write_text(
        CONFIG.replace('worker: "sh ./fix.sh"', 'worker: "true"'), encoding="utf-8"
    )
    assert cli.main(["bench"]) == cli.EXIT_OK
    capsys.readouterr()

    outcomes = {
        e["contender"]: e["outcome"]
        for e in events(only_bench(repo))
        if e["type"] == "contender.finished"
    }
    assert outcomes and all(o != "converged" for o in outcomes.values())


def test_the_baseline_must_be_red(repo, git_run, monkeypatch, capsys):
    """A green tree has nothing to repair, so N agents would each "converge"
    in zero iterations against work that was already done. Exit 1, the remedy
    named, and NO bench bundle."""
    setup(repo, git_run)
    (repo / "calc.py").write_text("FIXED\n", encoding="utf-8")
    git_run(repo, "commit", "-qam", "already fixed")
    monkeypatch.chdir(repo)

    code = cli.main(["bench"])
    printed = capsys.readouterr()

    assert code == cli.EXIT_GATE_FAILED
    said = flat(printed.out) + " " + flat(printed.err)
    assert "failing test" in said or "nothing to" in said, said
    assert not (repo / bench.BENCHES_DIRNAME).exists()


def test_the_green_baseline_refusal_names_its_evidence(
    repo, git_run, monkeypatch, capsys
):
    """It writes no BENCH bundle, but the baseline verify really ran and its
    bundle is the evidence of why there was nothing to measure. A refusal that
    threw that away would be asking the reader to take its word."""
    setup(repo, git_run)
    (repo / "calc.py").write_text("FIXED\n", encoding="utf-8")
    git_run(repo, "commit", "-qam", "already fixed")
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    # ONE readouterr: the first call drains the buffer, so calling it twice
    # and concatenating gives you the second half of nothing.
    printed = capsys.readouterr()
    said = flat(printed.out + " " + printed.err)
    named = [word for word in said.split() if ".wringer/" in word]
    assert named, f"the refusal names no path: {said}"


# --- identical conditions ---------------------------------------------------


def test_every_contender_is_handed_the_same_ceiling(
    repo, git_run, monkeypatch, capsys
):
    """Asserted on what `loop.run` is HANDED, not on a number in a file — the
    graph clamp test's method, because a ceiling computed and then not passed
    is not a ceiling. And it is the SAME number for every contender, never a
    remainder: a contender squeezed by its predecessor's overrun would be
    measured under conditions its predecessor set."""
    setup(repo, git_run)
    monkeypatch.chdir(repo)

    seen: list[dict] = []
    real = loop.run

    def spy(*args, **kwargs):
        seen.append(dict(kwargs))
        return real(*args, **kwargs)

    monkeypatch.setattr(loop, "run", spy)
    cli.main(["bench"])
    capsys.readouterr()

    assert len(seen) == 2, seen
    assert {call["wall_clock"] for call in seen} == {300}


def test_a_contender_runs_in_its_own_worktree(repo, git_run, monkeypatch, capsys):
    """Contenders editing one tree would each start from the last one's
    wreckage, and the repo under test would end up holding whichever agent
    went last."""
    setup(repo, git_run)
    monkeypatch.chdir(repo)
    cli.main(["bench"])
    capsys.readouterr()

    # The repo's own tree is untouched: the converging contender fixed its
    # OWN checkout, not this one.
    assert (repo / "calc.py").read_text(encoding="utf-8") == "BROKEN\n"


def test_a_second_bench_does_not_delete_the_first_ones_evidence(
    repo, git_run, monkeypatch, capsys
):
    """`make_worktree` force-removes a colliding path, and contender ids are
    stable across runs — so a bare-id worktree name would make the SECOND
    bench on a repo silently destroy the first one's loop bundles, and with
    them every by-path reference its bundle recorded. Bench-scoped names are
    what stop that, and the ordinary case is the one that would have broken."""
    setup(repo, git_run)
    monkeypatch.chdir(repo)

    assert cli.main(["bench"]) == cli.EXIT_OK
    capsys.readouterr()
    first = sorted((repo / bench.BENCHES_DIRNAME).iterdir())[0]
    referenced = [
        repo / e["loop_ref"]
        for e in events(first)
        if e["type"] == "contender.finished"
    ]
    assert referenced

    assert cli.main(["bench"]) == cli.EXIT_OK
    capsys.readouterr()

    for path in referenced:
        assert path.is_dir(), f"the second bench deleted {path}"
        assert (path / loop.MANIFEST_FILENAME).is_file()


def test_worktrees_are_kept_because_the_evidence_lives_in_them(
    repo, git_run, monkeypatch, capsys
):
    """Loop bundles live INSIDE the contender worktrees and are referenced by
    path. A bench that tidied its worktrees away would be a bench that deleted
    its own evidence."""
    setup(repo, git_run)
    monkeypatch.chdir(repo)
    cli.main(["bench"])
    capsys.readouterr()

    for event in events(only_bench(repo)):
        if event["type"] == "contender.finished":
            assert (repo / event["loop_ref"]).is_dir()


# --- one common tree, checked ----------------------------------------------


def test_the_baseline_sha_is_recorded_and_every_row_refers_to_it(
    repo, git_run, monkeypatch, capsys
):
    setup(repo, git_run)
    monkeypatch.chdir(repo)
    head = git_run(repo, "rev-parse", "HEAD")
    cli.main(["bench"])
    capsys.readouterr()

    started = next(e for e in events(only_bench(repo)) if e["type"] == "bench.started")
    assert started["sha"] == head
    assert manifest(only_bench(repo))["baseline"]["sha"] == head


def test_a_commit_landing_mid_creation_is_refused_naming_both_shas(
    repo, git_run, monkeypatch, capsys
):
    """Comparability is CHECKED, never assumed. `make_worktree` detaches at
    HEAD *at call time*, so a commit landing between two creations puts
    contender 2 on a different tree than contender 1 — silently, because the
    worktree add succeeds either way."""
    setup(repo, git_run)
    monkeypatch.chdir(repo)

    from wringer import fleet

    real = fleet.make_worktree
    made: list[Path] = []

    def moving(root: Path, task_id: str):
        path = real(root, task_id)
        made.append(path)
        if len(made) == 1:  # a commit lands after the first worktree exists
            (root / "drift.txt").write_text("moved\n", encoding="utf-8")
            git_run(root, "add", "-A")
            git_run(root, "commit", "-qm", "a commit mid-bench")
        return path

    monkeypatch.setattr(bench.fleet, "make_worktree", moving)
    code = cli.main(["bench"])
    printed = capsys.readouterr()

    assert code == cli.EXIT_CONFIG
    said = flat(printed.out) + " " + flat(printed.err)
    assert said.count("sha") or "baseline" in said, said


# --- setup, and the bare-worktree trap -------------------------------------


def test_prove_setup_runs_in_every_worktree(repo, git_run, monkeypatch, capsys):
    """A worktree carries TRACKED FILES ONLY. In any repo whose dependencies
    are gitignored, every gate fails there on a missing environment and the
    loop briefs an agent to fight a venv — the trap P5 nearly shipped. The
    key already exists for exactly this."""
    marker = "setup-ran"
    config = CONFIG.replace(
        "bench:",
        f'run:\n  worker: "true"\n  prove_setup: "touch {marker}"\nbench:',
    )
    setup(repo, git_run, config=config)
    monkeypatch.chdir(repo)
    cli.main(["bench"])
    capsys.readouterr()

    trees = sorted((repo / ".wringer" / "worktrees").iterdir())
    assert trees, "no worktrees were made at all"
    for tree in trees:
        assert (tree / marker).exists(), f"setup did not run in {tree}"


def test_a_failing_setup_is_an_environment_answer_not_a_brief(
    repo, git_run, monkeypatch, capsys
):
    """Exit 2 before any loop starts. A failing setup means the worktree
    cannot host a fair run; briefing an agent about it would be measuring the
    environment and calling it the agent."""
    config = CONFIG.replace(
        "bench:", 'run:\n  worker: "true"\n  prove_setup: "false"\nbench:'
    )
    setup(repo, git_run, config=config)
    monkeypatch.chdir(repo)

    started: list[str] = []
    monkeypatch.setattr(
        loop, "run", lambda *a, **k: started.append("ran") or (_ for _ in ()).throw(
            AssertionError("a loop started after the setup failed")
        )
    )
    code = cli.main(["bench"])
    printed = capsys.readouterr()

    assert code == cli.EXIT_CONFIG
    assert not started
    assert "setup" in flat(printed.out) + flat(printed.err)


# --- preflight --------------------------------------------------------------


def test_an_absent_agent_binary_is_refused_before_any_worktree_exists(
    repo, git_run, monkeypatch, capsys
):
    """Wringer never installs an agent: it names the absent one and prints the
    install command. Refused at PREFLIGHT so the refusal costs nothing and
    leaves nothing behind — and because an absent binary discovered mid-bench
    would be a partial comparison presented as a whole one."""
    config = CONFIG.replace(
        '    - id: fixer\n      worker: "sh ./fix.sh"\n',
        "    - id: missing\n      worker:\n        acp:\n"
        "          command: definitely-not-an-agent-binary\n",
    )
    setup(repo, git_run, config=config)
    monkeypatch.chdir(repo)

    code = cli.main(["bench"])
    printed = capsys.readouterr()

    assert code == cli.EXIT_CONFIG
    said = flat(printed.out) + " " + flat(printed.err)
    assert "definitely-not-an-agent-binary" in said, said
    assert not (repo / ".wringer" / "worktrees").exists()
    assert not (repo / bench.BENCHES_DIRNAME).exists()


def test_a_shell_worker_has_no_preflight(repo, git_run, monkeypatch, capsys):
    """There is nothing to resolve: a shell string is the shell's business,
    and a worker that fails at runtime is that contender's recorded outcome
    rather than a bench abort."""
    config = CONFIG.replace(
        'worker: "sh ./fix.sh"', 'worker: "definitely-not-a-command"'
    )
    setup(repo, git_run, config=config)
    monkeypatch.chdir(repo)

    assert cli.main(["bench"]) == cli.EXIT_OK
    capsys.readouterr()
    outcomes = {
        e["contender"]: e["outcome"]
        for e in events(only_bench(repo))
        if e["type"] == "contender.finished"
    }
    assert len(outcomes) == 2, outcomes


# --- the bundle -------------------------------------------------------------


def test_the_bundle_obeys_the_house_rules(repo, git_run, monkeypatch, capsys):
    setup(repo, git_run)
    monkeypatch.chdir(repo)
    cli.main(["bench"])
    capsys.readouterr()

    directory = only_bench(repo)
    from wringer import attest, evidence

    # The same chain checker `wring audit` uses — the function, not a
    # lookalike, so the guarantee is the same guarantee.
    attest.check_chain(directory / bench.EVENTS_FILENAME, "bench")

    digests = json.loads(
        (directory / evidence.DIGESTS_FILENAME).read_text(encoding="utf-8")
    )
    for name in (bench.EVENTS_FILENAME, bench.MANIFEST_FILENAME,
                 bench.SUMMARY_FILENAME):
        assert name in digests["files"], f"{name} is not covered by digests"

    assert manifest(directory)["schema_version"] == bench.SCHEMA_VERSION


def test_the_judge_line_names_a_verify_bundle_not_a_loop(
    repo, git_run, monkeypatch, capsys
):
    """A next-action that cannot be taken is not a next action.

    The first cut printed `wring judge <loop_dir>`, and `judge` reads a VERIFY
    bundle — its manifest and its gate results. The tests all passed; running
    the command for real is what caught it, which is why this one derives the
    check from the artifact rather than from the string: the path the summary
    offers must be a directory whose manifest is an evidence bundle.
    """
    setup(repo, git_run)
    monkeypatch.chdir(repo)
    cli.main(["bench"])
    capsys.readouterr()

    directory = only_bench(repo)
    offered = [
        line.strip().split(" ", 2)[2]
        for line in (directory / bench.SUMMARY_FILENAME)
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip().startswith("wring judge ")
    ]
    assert offered, "the summary offers no judge line at all"
    for path in offered:
        manifest_path = repo / path / "manifest.json"
        assert manifest_path.is_file(), f"{path} is not a bundle at all"
        recorded = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert recorded["schema_version"] == "wringer.evidence.v1", (
            f"the judge line names {path}, whose manifest is "
            f"{recorded['schema_version']} — judge reads a verify bundle"
        )


def test_the_contender_setup_writes_its_logs_through_the_redactor(
    repo, git_run, monkeypatch, capsys
):
    """`run.prove_setup` runs in every worktree, and its logs land on disk.

    This repo has shipped this exact defect before: `vacuity.prove` ran the
    pre-change gates through `gates.run` with NO redactor, so `--prove`'s logs
    got neither the config's patterns nor `env_passthrough` nor even the
    built-in `*TOKEN*`/`*SECRET*`/`*KEY*` defaults — the one set of bundle
    files written outside the guarantee SECURITY.md makes. A setup command is
    a shell command inheriting the whole environment, so it can echo a
    credential just as easily.
    """
    secret = "notarealcredential-setup-11ffa300"
    monkeypatch.setenv("BENCH_SETUP_CREDENTIAL", secret)
    config = CONFIG.replace(
        "bench:",
        'run:\n  worker: "true"\n'
        '  prove_setup: "echo $BENCH_SETUP_CREDENTIAL"\nbench:',
    ).replace(
        "  contenders:",
        "  contenders:",
    )
    setup(repo, git_run, config=config)
    # Declared so the redactor knows the name — the canary for the whole
    # env_passthrough promise, since this one matches no default pattern.
    (repo / ".wringer.yaml").write_text(
        config.replace(
            'run:\n  worker: "true"',
            "run:\n  worker:\n    acp:\n      command: unused\n"
            "      env_passthrough: [BENCH_SETUP_CREDENTIAL]",
        ),
        encoding="utf-8",
    )
    git_run(repo, "commit", "-qam", "declare the credential")
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    capsys.readouterr()

    leaked = []
    for tree in (repo / ".wringer" / "worktrees").iterdir():
        for path in tree.rglob("prove_setup.*.log"):
            if secret in path.read_text(encoding="utf-8", errors="replace"):
                leaked.append(str(path))
    assert not leaked, f"the setup's logs were written unscrubbed: {leaked}"


def test_a_credential_never_reaches_a_bench_artifact(
    repo, git_run, monkeypatch, capsys
):
    """The bundle owns a redactor built from `declared_secret_names`, which
    now walks every contender — a bench runs N workers and each may be handed
    its own."""
    secret = "notarealcredential-bench-4c2f80ab"
    monkeypatch.setenv("BENCH_ONE_CREDENTIAL", secret)
    config = CONFIG.replace(
        '    - id: fixer\n      worker: "sh ./fix.sh"\n',
        '    - id: leaky\n      worker: "echo $BENCH_ONE_CREDENTIAL > /dev/null; '
        'sh ./fix.sh"\n',
    ).replace(
        "bench:",
        'run:\n  worker:\n    acp:\n      command: unused\n'
        "      env_passthrough: [BENCH_ONE_CREDENTIAL]\nbench:",
    )
    setup(repo, git_run, config=config)
    monkeypatch.chdir(repo)
    cli.main(["bench"])
    capsys.readouterr()

    for path in (repo / bench.BENCHES_DIRNAME).rglob("*"):
        if path.is_file():
            body = path.read_text(encoding="utf-8", errors="replace")
            assert secret not in body, f"the credential reached {path}"


# --- exit codes -------------------------------------------------------------


def test_bench_never_returns_the_parked_code(repo, git_run, monkeypatch, capsys):
    """5 is a claim — nothing was decided; a person must act. Nothing in a
    bench waits on a person."""
    setup(repo, git_run)
    monkeypatch.chdir(repo)
    assert cli.main(["bench"]) != cli.EXIT_NEEDS_HUMAN
    capsys.readouterr()


def test_bench_refuses_outside_a_repo(repo, git_run, monkeypatch, capsys, tmp_path):
    outside = tmp_path / "not-a-repo"
    outside.mkdir()
    monkeypatch.chdir(outside)
    assert cli.main(["bench"]) == cli.EXIT_CONFIG
    capsys.readouterr()


def test_a_repo_without_a_bench_section_says_what_to_add(
    repo, git_run, monkeypatch, capsys
):
    setup(repo, git_run, config='version: 1\ngates:\n  - id: t\n    run: "true"\n')
    monkeypatch.chdir(repo)

    assert cli.main(["bench"]) == cli.EXIT_CONFIG
    said = flat(capsys.readouterr().err)
    assert "bench:" in said, said


# --- the ledger tells, and the report refuses to crown (B3) -----------------
#
# Ruling 6 is the spec's centre: bench MEASURES and does not crown. Two things
# have to hold for that to be true of the artifact and not just the prose —
# the claims travel with the numbers, and nothing anywhere is sorted by how
# well a contender did. Both are pinned here by content, because a `limits`
# array checked for non-emptiness and an order checked on an already-ordered
# fixture are exactly the narrowing shapes this repo keeps finding.

# `idler` FIRST and `fixer` SECOND, deliberately. The later contender wins on
# every measurable a sort could reach for — it converges, it iterates less, it
# finishes sooner — so any ordering by outcome, iterations or wall clock
# floats it up and reddens the order test. A fixture in declared-equals-best
# order would pass against a sort and prove nothing.
ORDER_CONFIG = """\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
bench:
  contender_wall_clock: 300
  contenders:
    - id: idler
      worker: "true"
    - id: fixer
      worker: "sh ./fix.sh"
"""


def test_the_three_limits_travel_with_the_numbers(repo, git_run, monkeypatch, capsys):
    """Pinned BY CONTENT, in all three places a reader meets the rows.

    A test asserting `limits` is non-empty passes against a single entry
    reading "none" — the release probe that printed "all thirteen present"
    while covering thirteen of seventeen is the same shape, and it shipped."""
    setup(repo, git_run)
    monkeypatch.chdir(repo)

    assert cli.main(["bench", "--json"]) == cli.EXIT_OK
    emitted = json.loads(capsys.readouterr().out)

    directory = only_bench(repo)
    summary = (directory / bench.SUMMARY_FILENAME).read_text(encoding="utf-8")
    recorded = manifest(directory)

    assert len(bench.LIMITS) == 3, bench.LIMITS
    for limit in bench.LIMITS:
        assert limit in recorded["limits"], f"manifest drops: {limit}"
        assert limit in emitted["limits"], f"--json drops: {limit}"
        assert flat(limit) in flat(summary), f"summary drops: {limit}"

    # The one the whole ruling turns on: a green gate is not an honest fix.
    assert any("honest" in limit for limit in recorded["limits"]), recorded["limits"]


def test_a_later_contender_that_converges_faster_does_not_float_up(
    repo, git_run, monkeypatch, capsys
):
    """Declared order everywhere, and a test a sort would fail.

    There is no winner column because the one fact that would justify one —
    was the fix honest — is precisely what this machinery cannot establish.
    An ordering IS a ranking; it would be the crown put back on by the
    renderer after the spec refused to award it."""
    setup(repo, git_run, config=ORDER_CONFIG)
    monkeypatch.chdir(repo)

    assert cli.main(["bench", "--json"]) == cli.EXIT_OK
    emitted = json.loads(capsys.readouterr().out)

    declared = ["idler", "fixer"]
    assert [row["contender"] for row in emitted["contenders"]] == declared

    directory = only_bench(repo)
    assert [row["contender"] for row in manifest(directory)["contenders"]] == declared

    # And in the human table, where a reader's eye actually ranks.
    summary = (directory / bench.SUMMARY_FILENAME).read_text(encoding="utf-8")
    assert summary.index("`idler`") < summary.index("`fixer`"), summary

    # The fixture is only load-bearing if the later one really did better.
    outcomes = {row["contender"]: row["outcome"] for row in emitted["contenders"]}
    assert outcomes["fixer"] == "converged", outcomes
    assert outcomes["idler"] != "converged", outcomes


def test_the_summary_prints_the_cleanup_lines_and_runs_none_of_them(
    repo, git_run, monkeypatch, capsys
):
    """Every worktree a referenced bundle lives in is KEPT — the loop bundles
    are inside them, and a bench that deleted them would be a bench that
    deleted its evidence. So the summary prints the reclaim lines and never
    runs one: the disk is the reader's to reclaim, after they have read it."""
    setup(repo, git_run)
    monkeypatch.chdir(repo)

    assert cli.main(["bench"]) == cli.EXIT_OK
    capsys.readouterr()

    summary = (only_bench(repo) / bench.SUMMARY_FILENAME).read_text(encoding="utf-8")
    assert "git worktree remove" in summary, summary

    # Printed, never run: every worktree the bench made is still there, and
    # every row's loop bundle is still inside one.
    kept = sorted((repo / ".wringer" / "worktrees").iterdir())
    assert kept, "the bench removed its own evidence"
    for line in summary.splitlines():
        if "git worktree remove" in line:
            named = line.split("git worktree remove", 1)[1].strip().strip("`")
            assert (repo / named).exists(), f"named a path that is gone: {named}"


def test_the_green_baseline_refusal_prints_the_cleanup_for_its_one_worktree(
    repo, git_run, monkeypatch, capsys
):
    """The refusal keeps a worktree too — the baseline verify's bundle is the
    evidence of WHY there was nothing to measure. Keeping it silently would
    leave a directory the reader never asked for and cannot find."""
    setup(repo, git_run)
    (repo / "calc.py").write_text("FIXED\n", encoding="utf-8")
    git_run(repo, "commit", "-qam", "already fixed")
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    printed = capsys.readouterr()
    said = flat(printed.out + " " + printed.err)
    assert "git worktree remove" in said, said


# --- reported by the agent, never invented by Wringer -----------------------

USAGE_CONFIG = """\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
bench:
  contender_wall_clock: 300
  contenders:
    - id: reporter
      worker:
        acp:
          command: {command}
          args: [{agent}, "usage"]
    - id: silent
      worker: "sh ./fix.sh"
"""


def test_what_the_agent_reported_reaches_the_row_and_the_json(
    repo, git_run, monkeypatch, capsys
):
    """Two kinds of number with different authority, kept distinct.

    Wall clock and iterations are Wringer's measurements. Tokens and cost are
    the AGENT'S OWN CLAIM, recorded verbatim and marked unverified — there is
    no price table here, because pricing would be a third module of vendor
    strings that is wrong the week after it is written."""
    import sys

    agent = Path(__file__).resolve().parent / "fake_acp_agent.py"
    setup(
        repo,
        git_run,
        config=USAGE_CONFIG.format(
            command=json.dumps(sys.executable), agent=json.dumps(str(agent))
        ),
    )
    monkeypatch.chdir(repo)

    assert cli.main(["bench", "--json"]) == cli.EXIT_OK
    emitted = json.loads(capsys.readouterr().out)
    rows = {row["contender"]: row for row in emitted["contenders"]}

    reported = rows["reporter"].get("usage")
    assert reported, f"the agent's own report never reached the row: {rows}"
    # The LAST report of a session wins: `used` is cumulative, not additive.
    assert reported["used"] == 1234, reported
    assert reported["cost"]["currency"] == "USD", reported


def test_a_contender_that_reported_nothing_renders_absent_and_never_zero(
    repo, git_run, monkeypatch, capsys
):
    """A shell worker reports no usage, and 0 would be a number Wringer made
    up about somebody else's spending. Absent is absent all the way to the
    screen — the honest-absence grammar, and the one this repo has broken
    before by rendering an unknown as a confident zero."""
    import sys

    agent = Path(__file__).resolve().parent / "fake_acp_agent.py"
    setup(
        repo,
        git_run,
        config=USAGE_CONFIG.format(
            command=json.dumps(sys.executable), agent=json.dumps(str(agent))
        ),
    )
    monkeypatch.chdir(repo)

    assert cli.main(["bench", "--json"]) == cli.EXIT_OK
    emitted = json.loads(capsys.readouterr().out)
    rows = {row["contender"]: row for row in emitted["contenders"]}

    assert "usage" not in rows["silent"], rows["silent"]

    # And in the human table: an em dash, never a 0.
    summary = (only_bench(repo) / bench.SUMMARY_FILENAME).read_text(encoding="utf-8")
    line = [ln for ln in summary.splitlines() if "`silent`" in ln]
    assert line, summary
    cells = [cell.strip() for cell in line[0].split("|")]
    assert "0" not in cells, f"an unreported number rendered as zero: {line[0]}"
    assert "—" in line[0], line[0]
