"""Parallel independent attempts — SPEC_ATTEMPTS_V0.md.

`bench.attempts` makes N independent attempts per contender; `bench.parallel`
runs them concurrently. Every worker here is a real shell command in a real
worktree, and the nondeterministic one really is nondeterministic: it counts its
own invocations in a file outside every worktree and behaves differently on each,
so "the attempts disagreed" is observed rather than staged.

**What this file must never accidentally assert.** There is no ranking here and
no way to derive one. `insufficient` is a valid and expected verdict, and a test
that treated the absence of a winner as a gap would be arguing for the defect
ruling 6 exists to refuse.
"""

from __future__ import annotations

import json
from pathlib import Path

from conftest import flat
from test_bench import events, manifest, only_bench, setup

from wringer import bench, cli, config, loop

REPEATED = """\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
bench:
  contender_wall_clock: 300
  attempts: 3
  contenders:
    - id: fixer
      worker: "sh ./fix.sh"
"""


def flaky_config(counter: Path, *, parallel: int = 1) -> str:
    """One contender whose worker converges on some attempts and not others.

    The counter lives OUTSIDE every worktree, which is what makes the attempts
    share nothing but the thing being measured.
    """
    return (
        "version: 1\n"
        "gates:\n"
        '  - id: test\n    run: "grep -q FIXED calc.py"\n'
        "bench:\n"
        "  contender_wall_clock: 300\n"
        "  attempts: 3\n"
        f"  parallel: {parallel}\n"
        "  contenders:\n"
        "    - id: coin\n"
        f'      worker: "n=$(cat {counter} 2>/dev/null || echo 0); '
        f'n=$((n+1)); printf %s $n > {counter}; '
        'if [ $((n % 2)) -eq 1 ]; then echo FIXED > calc.py; fi"\n'
    )


def rows(directory: Path) -> list[dict]:
    return manifest(directory)["contenders"]


# --- the compatibility boundary ---------------------------------------------


def test_a_bench_that_declared_no_attempts_writes_what_it_always_wrote(
    repo, git_run, monkeypatch, capsys
):
    """**The promise everything else rests on**, asserted on the record rather
    than on the config: no `attempts`, no `parallel`, no `attempt` on any row,
    and the worktree directories keep the names a reader was pointed at."""
    setup(repo, git_run)
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    capsys.readouterr()
    recorded = manifest(only_bench(repo))

    assert "attempts" not in recorded
    assert "parallel" not in recorded
    assert not any("attempt" in row for row in recorded["contenders"])
    assert [row["contender"] for row in recorded["contenders"]] == [
        "fixer", "idler",
    ]
    # the worktrees are named for the contender alone, exactly as before.
    # Matched as the `-a<N>` SUFFIX and not as a substring: a bench id carries a
    # random hex suffix that can itself begin with `a`, which this assertion
    # tripped over first.
    import re

    trees = sorted(p.name for p in (repo / ".wringer" / "worktrees").iterdir())
    assert not [name for name in trees if re.search(r"-a\d+$", name)], trees
    # and neither limit that only applies to repeats is printed
    assert bench.ATTEMPT_LIMIT not in recorded["limits"]
    assert bench.PARALLEL_LIMIT not in recorded["limits"]


# --- N independent attempts -------------------------------------------------


def test_every_attempt_gets_its_own_worktree_ledger_and_row(
    repo, git_run, monkeypatch, capsys
):
    """Independent by construction rather than by discipline: two attempts
    sharing a tree would be one attempt with a race in it, and nothing
    downstream could tell."""
    setup(repo, git_run, config=REPEATED)
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    capsys.readouterr()
    found = only_bench(repo)

    recorded = rows(found)
    assert [row["attempt"] for row in recorded] == [1, 2, 3]
    assert {row["contender"] for row in recorded} == {"fixer"}
    assert manifest(found)["attempts"] == 3

    # one worktree per attempt, named for it
    trees = sorted(p.name for p in (repo / ".wringer" / "worktrees").iterdir())
    for number in (1, 2, 3):
        assert any(name.endswith(f"fixer-a{number}") for name in trees), trees

    # one loop bundle per attempt, each its own ledger — no two rows may name
    # the same one, which is what "independent ledgers" means when checked
    refs = [row["loop_ref"] for row in recorded]
    assert len(set(refs)) == 3, refs


def test_attempts_run_from_the_same_commit_under_the_same_ceiling(
    repo, git_run, monkeypatch, capsys
):
    """Same starting SHA and same ceilings — the two properties that make
    attempts of one contender comparable with each other at all."""
    setup(repo, git_run, config=REPEATED)
    monkeypatch.chdir(repo)
    handed: list[int | None] = []
    real = loop.run

    def record(root, cfg, *args, **kw):
        handed.append(kw.get("wall_clock"))
        return real(root, cfg, *args, **kw)

    monkeypatch.setattr(loop, "run", record)

    cli.main(["bench"])
    capsys.readouterr()

    assert handed == [300, 300, 300]
    baseline = manifest(only_bench(repo))["baseline"]["sha"]
    assert baseline  # and every worktree was checked against it before any ran


def test_a_single_contender_is_legal_with_repeats_and_refused_without(
    repo, git_run, monkeypatch, capsys
):
    """A comparison of one is `wring run`. Three attempts at one requirement is
    a different measurement, and the refusal says which."""
    one = REPEATED.replace("  attempts: 3\n", "")
    setup(repo, git_run, config=one)
    monkeypatch.chdir(repo)

    assert cli.main(["bench"]) == cli.EXIT_CONFIG
    printed = capsys.readouterr()
    assert "needs two or more" in printed.err
    assert "repeated independent attempts" in printed.err


# --- what repeats actually buy ----------------------------------------------


def test_attempts_that_disagree_are_reported_as_the_agents_own_nondeterminism(
    repo, git_run, monkeypatch, capsys, tmp_path
):
    """**The finding repeats exist to surface.**

    Same tree, same commit, same ceiling, and the attempts reach different
    outcomes. Nothing in the inputs explains it, so it is the agent — the same
    finding a flaky gate is one level down. A single run would have reported one
    of these outcomes as though it were the answer.
    """
    setup(repo, git_run, config=flaky_config(tmp_path / "n"))
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    capsys.readouterr()
    found = only_bench(repo)

    outcomes = {row["outcome"] for row in rows(found)}
    assert len(outcomes) > 1, f"the flaky worker was not flaky: {outcomes}"

    verdict, sentence = bench.agreement(
        tuple(
            bench.Row(
                contender=row["contender"], agent_id=None,
                outcome=row["outcome"], reason=row["reason"],
                iterations=row["iterations"],
                wall_clock_ms=row["wall_clock_ms"],
                loop_ref=row["loop_ref"], head_moved=row["head_moved"],
                attempt=row["attempt"],
            )
            for row in rows(found)
        )
    )
    assert verdict == "inconsistent"
    assert "nondeterminism" in sentence

    text = (found / bench.SUMMARY_FILENAME).read_text(encoding="utf-8")
    assert "## Across attempts — **inconsistent**" in text
    assert "would have reported one of those outcomes as though it were" in text


def test_attempts_that_agree_still_do_not_rank_anything(
    repo, git_run, monkeypatch, capsys
):
    """`consistent` says the agent was consistent. It says nothing about which
    contender is better, and the sentence says so out loud — a verdict a reader
    could mistake for a score would be ruling 6 undone by a summary line."""
    setup(repo, git_run, config=REPEATED)
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    capsys.readouterr()
    text = (only_bench(repo) / bench.SUMMARY_FILENAME).read_text(encoding="utf-8")

    assert "## Across attempts — **consistent**" in text
    assert "insufficient to rank" in text


def test_insufficient_is_the_default_and_is_not_a_shortfall():
    """One attempt each cannot disagree with anything, and saying so is the
    honest answer rather than a gap to be closed."""
    verdict, sentence = bench.agreement(())
    assert verdict == "insufficient"
    assert "expected answer and not a shortfall" in sentence


def test_no_artifact_gains_a_field_that_orders_attempts(
    repo, git_run, monkeypatch, capsys, tmp_path
):
    """Ruling 6, re-checked for the new shape. Repeats add rows; they must not
    add a rank, a score, a winner or a sort."""
    setup(repo, git_run, config=flaky_config(tmp_path / "n"))
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    capsys.readouterr()
    found = only_bench(repo)

    recorded = manifest(found)

    # Asserted on the KEYS, never on the prose. The limits legitimately contain
    # the word "rank" because they deny one — a text search would forbid the
    # sentence that does the refusing, which is the mistake this assertion made
    # first.
    keys = set(recorded) | {
        key for row in recorded["contenders"] for key in row
    }
    for forbidden in ("winner", "rank", "ranking", "score", "best", "position",
                      "order", "place"):
        assert forbidden not in keys, forbidden
    # and the published schema declares no such field either, so one cannot be
    # added without a version somebody has to argue for
    schema = json.loads(
        (Path(__file__).resolve().parent.parent / "schema"
         / "bench-manifest-v2.schema.json").read_text(encoding="utf-8")
    )
    declared = set(schema["properties"]) | set(
        schema["properties"]["contenders"]["items"]["properties"]
    )
    assert not {"winner", "rank", "score", "best"} & declared

    # rows stay in DECLARED order: contender by contender, attempt by attempt
    assert [row["attempt"] for row in recorded["contenders"]] == [1, 2, 3]


def test_the_attempt_limit_travels_with_the_numbers(
    repo, git_run, monkeypatch, capsys
):
    """Pinned by content, and present only when repeats happened — a limit about
    attempts printed on a single-attempt bench is a sentence a reader learns to
    skip, and the limits are the part they must not skip."""
    setup(repo, git_run, config=REPEATED)
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    capsys.readouterr()
    found = only_bench(repo)

    assert bench.ATTEMPT_LIMIT in manifest(found)["limits"]
    assert "not evidence that either attempt is the better implementation" in (
        bench.ATTEMPT_LIMIT
    )
    text = (found / bench.SUMMARY_FILENAME).read_text(encoding="utf-8")
    assert bench.ATTEMPT_LIMIT in text


# --- parallelism ------------------------------------------------------------


def test_parallel_attempts_all_run_and_the_rows_stay_in_declared_order(
    repo, git_run, monkeypatch, capsys, tmp_path
):
    """Determinism first: a bench whose artifact changed shape depending on
    which agent finished first would be an artifact nobody could diff."""
    counter = tmp_path / "n"
    setup(repo, git_run, config=flaky_config(counter, parallel=3))
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    capsys.readouterr()
    found = only_bench(repo)

    # NOT asserted on the counter. It is the one thing these attempts share —
    # deliberately, because a shared counter is how the worker is made
    # nondeterministic — so it races, and under parallelism it can land below
    # the number of invocations. That is the fixture behaving as designed, and
    # an assertion on it would be a flaky test about flakiness.
    #
    # What shows every attempt ran is its own evidence: a row and a loop bundle
    # each, which nothing shared can lose.
    recorded = rows(found)
    assert [row["attempt"] for row in recorded] == [1, 2, 3]
    assert len({row["loop_ref"] for row in recorded}) == 3
    for row in recorded:
        assert (repo / row["loop_ref"]).is_dir(), row["loop_ref"]
    assert manifest(found)["parallel"] == 3


def test_a_parallel_bench_says_its_wall_clock_is_contended(
    repo, git_run, monkeypatch, capsys, tmp_path
):
    """**The column is spent, and the artifact says so.** Serial is measurement
    hygiene; buying elapsed time costs the one column a reader would most
    naturally compare, and leaving them to compare it anyway would be the
    misleading number this repo exists to refuse."""
    setup(repo, git_run, config=flaky_config(tmp_path / "n", parallel=3))
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    capsys.readouterr()
    found = only_bench(repo)

    assert bench.PARALLEL_LIMIT in manifest(found)["limits"]
    text = (found / bench.SUMMARY_FILENAME).read_text(encoding="utf-8")
    assert "contended" in text
    assert "may not be compared on it" in bench.PARALLEL_LIMIT


def test_the_ledger_is_written_by_one_thread_and_its_chain_holds(
    repo, git_run, monkeypatch, capsys, tmp_path
):
    """**The reason events are not emitted from the workers.**

    `Bundle.event` reads the ledger's last line to compute `prev_hash` and then
    appends. Two threads interleaving there would break the chain that is the
    bundle's whole tamper-evidence — silently, and in a way `wring audit` would
    later report as tampering on an honest run. So the chain is re-walked here
    over a bench that really ran three attempts at once.
    """
    setup(repo, git_run, config=flaky_config(tmp_path / "n", parallel=3))
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    capsys.readouterr()
    found = only_bench(repo)

    from wringer import attest

    # raises `Refused` on the first broken link
    attest.check_chain(found / bench.EVENTS_FILENAME, "bench")

    finished = [e for e in events(found) if e["type"] == "contender.finished"]
    assert [e["attempt"] for e in finished] == [1, 2, 3]


def test_parallel_attempts_share_no_mutable_state(
    repo, git_run, monkeypatch, capsys, tmp_path
):
    """Each attempt gets its own worktree, its own loop bundle and its own
    `Config`. Asserted as the absence of collision: three loop directories,
    three worktrees, and three distinct trees written into."""
    setup(repo, git_run, config=flaky_config(tmp_path / "n", parallel=3))
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    capsys.readouterr()

    recorded = rows(only_bench(repo))
    assert len({row["loop_ref"] for row in recorded}) == 3
    trees = [p for p in (repo / ".wringer" / "worktrees").iterdir() if p.is_dir()]
    benched = [p for p in trees if "coin-a" in p.name]
    assert len(benched) == 3, [p.name for p in benched]
    for tree in benched:
        assert (tree / loop.LOOPS_DIRNAME).is_dir(), tree


def test_serial_is_the_default_and_never_touches_a_pool(
    repo, git_run, monkeypatch, capsys
):
    """Not an optimisation: it is what makes a bench that declared no
    parallelism behave exactly as it did, interrupt handling included."""
    setup(repo, git_run, config=REPEATED)
    monkeypatch.chdir(repo)

    import concurrent.futures

    def refuse(*_a, **_kw):  # pragma: no cover - must never be reached
        raise AssertionError("a serial bench built a thread pool")

    monkeypatch.setattr(concurrent.futures, "ThreadPoolExecutor", refuse)

    cli.main(["bench"])
    capsys.readouterr()
    assert len(rows(only_bench(repo))) == 3


# --- the config surface ----------------------------------------------------


def test_attempts_and_parallel_default_to_one():
    parsed = config.parse(
        {
            "version": 1,
            "gates": [{"id": "u", "run": "true"}],
            "bench": {
                "contender_wall_clock": 60,
                "contenders": [
                    {"id": "a", "worker": "true"},
                    {"id": "b", "worker": "true"},
                ],
            },
        }
    )
    assert (parsed.bench.attempts, parsed.bench.parallel) == (1, 1)


def test_attempts_are_capped_because_every_one_is_a_real_agent_run():
    import pytest

    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "u", "run": "true"}],
                "bench": {
                    "contender_wall_clock": 60,
                    "attempts": config.MAX_BENCH_ATTEMPTS + 1,
                    "contenders": [
                        {"id": "a", "worker": "true"},
                        {"id": "b", "worker": "true"},
                    ],
                },
            }
        )
    assert "a typo here is money" in str(caught.value)


def test_the_two_bench_version_tables_agree():
    """`health` reads bench bundles and cannot import `bench` — the cycle runs
    through `verify` and `accept`. So the versions are a literal on the reader's
    side, pinned here rather than hoped for."""
    from wringer import health

    assert set(health.BENCH_SCHEMAS) == set(bench.SCHEMA_VERSIONS)


def test_a_v1_bench_bundle_is_still_read_by_health(tmp_path: Path):
    """The bump must not orphan a bundle already on disk — SPEC_ENV_V0's finding
    D3, which this release has now met twice."""
    from wringer import health

    directory = tmp_path / ".wringer" / "benches" / "20260801-120000-aaaa"
    directory.mkdir(parents=True)
    (directory / "manifest.json").write_text(
        json.dumps({
            "schema_version": "wringer.bench.v1",
            "bench_id": "20260801-120000-aaaa",
            "started_at": "2026-08-01T12:00:00+01:00",
            "baseline": {"sha": "a" * 40, "run_dir": "x", "failing_gates": ["t"]},
            "contender_wall_clock": 300,
            "contenders": [],
            "limits": ["x"],
        }),
        encoding="utf-8",
    )

    coverage = health.discover(tmp_path)

    assert [b.kind for b in coverage.read] == ["bench"], (
        f"a v1 bench bundle became invisible: {[s.reason for s in coverage.skipped]}"
    )


def test_the_console_names_each_attempt_and_prints_the_verdict(
    repo, git_run, monkeypatch, capsys, tmp_path
):
    """**The finding has to reach the terminal, not only the file.**

    Three console lines reading `coin` with no way to tell them apart is a
    console a reader cannot use, and `inconsistent` only in a summary they have
    not opened is a finding that arrives too late to act on. Both were true of
    the first version of this feature, found by reading the real output.
    """
    setup(repo, git_run, config=flaky_config(tmp_path / "n", parallel=3))
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    out = capsys.readouterr().out

    assert "coin #1" in out
    assert "coin #2" in out
    assert "coin #3" in out
    assert "! across attempts: inconsistent" in out
    assert "nondeterminism" in flat(out)
    # and the limits that only apply to this shape reach the terminal too
    assert "may not be compared on it" in flat(out)


def test_json_carries_the_verdict_and_the_extra_limits(
    repo, git_run, monkeypatch, capsys, tmp_path
):
    """`--json` is what an agent reads, and an agent is the reader most likely
    to treat three rows as three data points to average."""
    setup(repo, git_run, config=flaky_config(tmp_path / "n", parallel=3))
    monkeypatch.chdir(repo)

    cli.main(["bench", "--json"])
    emitted = json.loads(capsys.readouterr().out)

    assert emitted["across_attempts"] == "inconsistent"
    assert bench.ATTEMPT_LIMIT in emitted["limits"]
    assert bench.PARALLEL_LIMIT in emitted["limits"]
    assert [row["attempt"] for row in emitted["contenders"]] == [1, 2, 3]


def test_a_single_attempt_bench_prints_no_verdict_and_no_extra_limits(
    repo, git_run, monkeypatch, capsys
):
    """A verdict about attempts on a bench that made one each is a line a reader
    learns to skip — and the limits are the part they must not skip."""
    setup(repo, git_run)
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    out = capsys.readouterr().out

    assert "across attempts" not in out
    assert bench.ATTEMPT_LIMIT not in out
    assert " #1" not in out


def test_no_artifact_says_one_run_per_contender_when_there_were_three(
    repo, git_run, monkeypatch, capsys
):
    """**A stale claim beside its own correction is the drift this repo hunts.**

    `LIMITS[0]` says "One run per contender", which is false the moment
    `bench.attempts` is more than one — and it was being printed directly above
    the new limit that contradicted it. Found by reading the real console output,
    not by a test. The sentence is REPLACED rather than accompanied.
    """
    setup(repo, git_run, config=REPEATED)
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    out = capsys.readouterr().out
    found = only_bench(repo)
    recorded = manifest(found)
    text = (found / bench.SUMMARY_FILENAME).read_text(encoding="utf-8")

    # Flattened before matching: the console wraps to 78 columns, so a phrase
    # legitimately straddles a line break there — `conftest.flat` is what this
    # repo has for it, and asserting on the formatter's line breaks would test
    # the formatter.
    # The limits JOINED rather than `json.dumps`'d: dumps escapes the em dash
    # to \u2014, so a substring match against it fails on a string that is
    # actually there — a test failing on JSON escaping rather than on content.
    for where in (flat(out), flat(text), flat(" ".join(recorded["limits"]))):
        assert flat(bench.SINGLE_RUN_LIMIT) not in where
        assert flat(bench.REPEATED_RUNS_LIMIT) in where


def test_a_single_attempt_bench_keeps_the_sentence_it_always_printed(
    repo, git_run, monkeypatch, capsys
):
    """The substitution is conditional. A bench that made one run each says so,
    exactly as it always did."""
    setup(repo, git_run)
    monkeypatch.chdir(repo)

    cli.main(["bench"])
    out = capsys.readouterr().out

    assert flat(bench.SINGLE_RUN_LIMIT) in flat(out)
    assert flat(bench.REPEATED_RUNS_LIMIT) not in flat(out)
    assert manifest(only_bench(repo))["limits"][0] == bench.SINGLE_RUN_LIMIT
