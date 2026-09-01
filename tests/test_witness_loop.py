"""**The repair loop engages while a pinned witness is red** — SPEC_GATEGEN §6,
P4-1, ruled 2026-08-15.

This file exists because the lane it guards was, until this ruling, unable to
satisfy the one clause the whole programme is scored on.

`WRINGER_RULING_2026-08-14` §5.3 requires that *at least one row shows the
repair loop running ≥1 worker turn with a red witness converting to green* —
"the loop ran zero turns in 26 attempts last time; the loop existing in the
data is part of the claim". And `loop.py`'s continuation predicate was
`final.passed`, gates only. `benchmark/CORPUS.md` §3 selects tasks whose
declared gates do NOT cover the issue, so on every corpus task the gates are
GREEN at base, so every loop converged at iteration 1 having briefed nobody.
**§5.3 was structurally unsatisfiable as built** — the measured
zero-worker-turns result rebuilt one layer up, and it would have consumed the
single authorised pass measuring nothing.

The two drives below are the proof P4-1 requires before any money is spent.
Neither uses an LLM: the witness is written by hand exactly where an author
would have put it, which is the same reduction `test_run.py` makes for workers.

    drive 1  vacuous gate green + witness red
             -> the loop runs >=1 REAL worker turn
             -> the witness converts
             -> deliver says yes

    drive 2  the same scenario, worker tampers with the witness mid-loop
             -> VOID, exit 3, refused BY NAME

Drive 2 is the half that keeps drive 1 honest. A loop that engages on a red
witness hands a worker more turns in which to find and edit the check, so the
mechanism that makes engagement safe — the pin, re-checked against the bytes on
disk immediately before every execution — has to be driven in the same
configuration rather than trusted from its unit tests.
"""

from __future__ import annotations

import json
from pathlib import Path

from wringer import cli, loop, witness

# A DECLARED gate that is green at base and stays green whatever the worker
# does. This is the corpus's shape in one line: the repository's own checks do
# not cover the criterion, so they carry zero information about the change.
VACUOUS_GATE = """\
version: 1
gates:
  - id: suite
    run: "true"
run:
  worker: {worker}
  max_iterations: {max_iterations}
deliver:
  branch: "wringer/{{run}}"
  remote: origin
"""

SPEC = """\
schema_version: wringer.spec.v1
approved: true
title: Totals must add up
intent: |
  The `total()` helper returns the sum of its arguments.
open_questions: []
criteria:
  - id: totals
    title: total() returns the sum of its arguments
    required: true
    human: false
tasks:
  - id: totals
    brief: briefs/totals.md
    objective: make total() add its arguments up
"""

# The witness: red on the pre-change tree because `total` returns 0, green once
# a worker makes it add. Assertion-failing, so W8 accepts it as a proved red.
WITNESS = """\
import calc


def test_total_adds_up():
    assert calc.total(2, 4) == 6
"""

BROKEN = "def total(*values):\n    return 0\n"
FIXED = "def total(*values):\n    return sum(values)\n"


def write_repo(repo: Path, worker: str, max_iterations: int = 3) -> None:
    # The worker contract (0.6.0): see test_staleness.write_config.
    if "{brief}" not in worker:
        worker = ": {brief}; " + worker
    (repo / ".wringer.yaml").write_text(
        VACUOUS_GATE.format(
            worker=json.dumps(worker), max_iterations=max_iterations
        ),
        encoding="utf-8",
    )
    (repo / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    (repo / "briefs").mkdir(exist_ok=True)
    (repo / "briefs" / "totals.md").write_text(
        "Make `total()` return the sum of its arguments.\n", encoding="utf-8"
    )
    (repo / "calc.py").write_text(BROKEN, encoding="utf-8")

    # **Asserted, not assumed.** `accept.read_spec` is total by construction: a
    # spec it cannot parse is treated as one that is not there, silently, so a
    # typo in this fixture would send every test in this file down
    # `_unconverted`'s no-acceptance fallback — where the loop still engages,
    # so they would all pass while measuring the wrong branch. That happened
    # while this file was being written; `tasks: []` is a parse error, and the
    # only symptom was a delivery that said yes.
    from wringer import accept

    approved = accept.read_spec(repo)
    assert approved is not None, (
        "the spec fixture is not APPROVED or does not parse, so no acceptance "
        "verdict is written and these tests measure the fallback path"
    )


def author_the_witness(repo: Path) -> witness.Witness:
    """Put a witness in the store exactly as `wring spec --send --witness` does.

    By hand rather than by an LLM call, and the substitution is honest: W2's
    load-bearing property is that the check pre-dates the work, not that a
    model wrote it. What the author produces is bytes; these are bytes, in the
    same store, recorded through the same `witness.record`, and everything
    downstream — proving, pinning, execution, comparison — is the shipped path.
    """
    item = witness.Witness(criterion="totals", source=WITNESS)
    witness.store(repo, item)
    witness.record(
        repo,
        [item],
        model="hand-authored (test)",
        base_sha="0" * 40,
        tree_dirty=False,
        isolation={"tree": "pre-change", "history": "truncated"},
        prompt_digests={
            "criterion:totals": "c" * 64,
            "prompt:totals": "p" * 64,
        },
    )
    return item


def only_loop(repo: Path) -> Path:
    loops = sorted((repo / loop.LOOPS_DIRNAME).iterdir())
    assert len(loops) == 1, loops
    return loops[0]


def events(loop_dir: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in (loop_dir / loop.EVENTS_FILENAME)
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]


def commit_everything(repo: Path, git_run) -> None:
    git_run(repo, "add", "-A")
    git_run(repo, "commit", "-q", "-m", "base")


def with_remote(repo: Path, git_run) -> None:
    """Give the repo a real bare `origin` with a resolvable default branch.

    `wring deliver` refuses without one, by name — *"the remote's default
    branch could not be determined, so Wringer cannot be sure it is avoiding
    it"* — and that refusal is correct and has nothing to do with the witness.
    Drive 1 has to reach the criterion's verdict, so the unrelated refusal is
    cleared rather than asserted around. Nothing is pushed anywhere real: the
    remote is a bare repository in the same tmp dir, and `deliver` runs without
    `--send`, so no git history is written at all.
    """
    bare = repo.parent / f"{repo.name}.git"
    git_run(repo.parent, "init", "-q", "--bare", "-b", "main", str(bare))
    git_run(repo, "remote", "add", "origin", str(bare))
    git_run(repo, "push", "-q", "origin", "main")
    git_run(repo, "remote", "set-head", "origin", "-a")


# --- DRIVE 1 ----------------------------------------------------------------


def test_a_red_witness_over_a_GREEN_GATE_makes_the_loop_run_a_worker_turn(
    repo, git_run, monkeypatch, capsys
):
    """**§5.3's enabler, driven end to end.**

    Every declared gate passes at base and keeps passing. The only thing in the
    run that carries information about the change is the witness, and it is
    red. Before P4-1 this loop reported `converged` at iteration 1 with zero
    worker turns; the criterion then refused at delivery, so Wringer's answer to
    "this is not done" was to refuse without ever having asked for a repair.

    The worker here is one shell line that writes the fix — a stand-in for an
    agent, exactly as everywhere else in this suite. What is being measured is
    that it was CALLED AT ALL, and that the check the loop was holding open for
    went green as a result.
    """
    write_repo(repo, worker=f"printf '%b' {json.dumps(FIXED)} > calc.py")
    commit_everything(repo, git_run)
    with_remote(repo, git_run)
    monkeypatch.chdir(repo)
    item = author_the_witness(repo)
    assert item.sha256, "the witness was not stored"

    code = cli.main(["run"])

    loop_dir = only_loop(repo)
    recorded = events(loop_dir)
    turns = [e for e in recorded if e["type"] == "worker.started"]

    assert turns, (
        "the loop briefed NOBODY. Every declared gate was green and the "
        "witness was red, which is every corpus task — this is the "
        "zero-worker-turns result that made §5.3 unsatisfiable as built"
    )
    assert code == 0, capsys.readouterr().out

    finished = [e for e in recorded if e["type"] == "loop.finished"]
    assert finished[-1]["reason"] == "converged", finished[-1]

    # The witness CONVERTED — red before the turn, green after it. Read off the
    # lane's own sibling artifact rather than recomputed here.
    record = json.loads(
        (loop_dir / witness.WITNESS_FILENAME).read_text(encoding="utf-8")
    )
    row = record["witnesses"][0]
    assert row["proved_red"]["verdict"] == witness.PROVEN
    assert row["executed"]["result"] == "passed", row["executed"]

    # And the criterion it proves is evidenced, so delivery has nothing to
    # refuse. This is the whole chain: green vacuous gate, red witness, worker
    # turn, conversion, delivery eligible.
    code = cli.main(["deliver"])
    captured = capsys.readouterr()
    assert code == 0, captured.out + captured.err


def test_a_failing_prove_setup_discards_the_witness_and_cites_why(
    repo, git_run, monkeypatch, capsys
):
    """**The control `vacuity` has had since 2026-08-11, in the lane that
    needed it most.**

    Born red is established in a scratch worktree, which carries TRACKED FILES
    ONLY — so in any repo whose dependencies are gitignored the project is not
    installed there, and W10 tells the author to exercise the very interface
    that then fails for a reason which is not the tree. `classify` reads such
    a failure as a genuine ASSERTION, so the witness is "proved red" in the
    scratch tree, passes in the full working tree for reasons that have
    nothing to do with the change, and the criterion collects a receipt that
    means nothing. SPEC_GATEGEN W8 already called `run.prove_setup` "a hard
    precondition for the witness lane only"; nothing ran it and nothing
    required it.

    A FAILING setup is not proof, and every row says so in the record rather
    than the run proceeding on a born-red nobody can trust. (An ABSENT
    `prove_setup` is disclosed, never refused — the 2026-08-11 ruling — which
    is why every other test in this file still runs without declaring one.)
    """
    write_repo(repo, worker="true", max_iterations=1)
    config_path = repo / ".wringer.yaml"
    written = config_path.read_text(encoding="utf-8")
    anchor = "  max_iterations: 1\n"
    assert anchor in written, written   # the fixture, asserted not assumed
    config_path.write_text(
        written.replace(anchor, '  prove_setup: "exit 3"\n' + anchor),
        encoding="utf-8",
    )
    from wringer import config as config_module

    parsed = config_module.load(config_path)
    assert parsed.run is not None and parsed.run.prove_setup == "exit 3", parsed
    commit_everything(repo, git_run)
    monkeypatch.chdir(repo)
    author_the_witness(repo)

    cli.main(["run"])
    capsys.readouterr()

    record = json.loads(
        (only_loop(repo) / witness.WITNESS_FILENAME).read_text(encoding="utf-8")
    )
    row = record["witnesses"][0]
    assert row.get("proved_red") is None, (
        "a born-red was claimed in a worktree whose setup command failed"
    )
    assert "prove_setup" in (row.get("discarded") or ""), row
    assert "exit 3" in row["discarded"] or "3" in row["discarded"], row


def test_the_worker_is_briefed_with_the_witness_failure_and_not_its_source(
    repo, git_run, monkeypatch
):
    """W5, on the brief the loop actually wrote in drive 1's configuration.

    Asserted on the file the worker was handed rather than on `brief_section`'s
    return value, because the thing W5 constrains is what crossed the boundary.
    """
    write_repo(repo, worker="true", max_iterations=2)
    commit_everything(repo, git_run)
    monkeypatch.chdir(repo)
    item = author_the_witness(repo)

    cli.main(["run"])

    briefs = sorted((only_loop(repo)).glob("**/brief*.md"))
    assert briefs, "the loop wrote no brief, so no worker was briefed"
    text = briefs[0].read_text(encoding="utf-8")

    assert "totals" in text
    # `assert 0 == 6` — pytest's INTROSPECTED failure, which is what the runner
    # reports rather than what the witness says. Note what the worker gets and
    # what it does not: the observed value and the expected one, and no clue
    # which call produced them. That is W5's line exactly.
    assert "assert 0 == 6" in text, (
        "the brief does not carry the failure, which is W5's other half"
    )
    assert "calc.total(2, 4)" not in text, "the brief echoed the witness's call"
    assert witness.MATERIAL_DIRNAME not in text, "the brief leaked the path"
    assert item.filename not in text, "the brief leaked the filename"
    assert "-m pytest" not in text, "the brief leaked the command"
    assert "def test_total_adds_up" not in text, "the brief leaked the source"


def test_a_witness_that_never_converts_ends_through_the_stops_that_EXIST(
    repo, git_run, monkeypatch, capsys
):
    """**P4-1's binding constraint: no new stop, and never a loop forever.**

    The worker changes nothing, so the tree fingerprint is identical and
    `no_progress` fires — the same stop a worker that ignores a failing gate
    trips, reached through the same code. Then the criterion refuses at
    delivery, which is W10's companion clause made concrete: a witness that
    never goes green surfaces through the existing refusal machinery.
    """
    # The worker writes something IRRELEVANT once and then nothing. Two
    # properties are needed and neither is incidental: the tree has to move at
    # least once or `wring deliver` refuses for having nothing to deliver
    # (which would be a refusal with no criterion in it), and it has to stop
    # moving or `no_progress` never fires.
    write_repo(repo, worker="touch notes.txt", max_iterations=5)
    commit_everything(repo, git_run)
    # **The remote is set up even though this run must be refused**, and that
    # is the point. Without one `wring deliver` refuses about the remote's
    # default branch, which would make this test pass without the witness
    # having anything to do with it — a green for the wrong reason, in a file
    # written to catch exactly that.
    with_remote(repo, git_run)
    monkeypatch.chdir(repo)
    author_the_witness(repo)

    code = cli.main(["run"])

    recorded = events(only_loop(repo))
    finished = [e for e in recorded if e["type"] == "loop.finished"][-1]
    # **Derived from the console's own map, not hand-listed here.** The claim
    # is "an EXISTING stop", so the set has to come from somewhere that would
    # notice a new one being added — and `cli._LOOP_ENDINGS` is already pinned
    # against `loop.py` by `test_run.py`. A hand-kept copy in this file would
    # be a third list to keep in step, which is how the console fell behind the
    # loop by two reasons once already.
    existing = set(cli._LOOP_ENDINGS) - {"converged", "interrupted"}
    assert finished["reason"] in existing, (
        f"the loop invented a stop reason for the witness path: "
        f"{finished['reason']!r}. P4-1 adds no new stop — a witness that never "
        "converts has to end through the machinery that already exists"
    )
    assert finished["iterations"] < 5, (
        "the loop ran to its ceiling rather than stopping early — anti-thrash "
        "does not cover the witness path, so a red witness buys a worker every "
        "turn in the budget no matter what it does"
    )
    assert code != 0
    capsys.readouterr()

    assert cli.main(["deliver"]) != 0, (
        "a criterion whose witness never converted was delivered"
    )
    captured = capsys.readouterr()
    refusal = " ".join((captured.out + captured.err).split())
    assert "totals" in refusal, (
        f"delivery refused, but not by the criterion's name: {refusal}"
    )
    # And the DECLARED gate was green throughout, so this refusal exists only
    # because a manufactured check said so. That is the whole thesis in one
    # assertion: `wring deliver` said yes to 26 of 26 rows on gates like these.
    assert "suite" not in refusal, (
        "the refusal cites the declared gate, which passed on every lap"
    )


def test_a_worker_going_in_circles_on_a_witness_trips_the_BREAKER(
    repo, git_run, monkeypatch
):
    """The other anti-thrash stop, on the witness path.

    The worker edits a file that has nothing to do with the criterion, so the
    tree MOVES every lap — `no_progress` cannot fire — and the witness comes
    back with the identical failure. Before P4-1's signature change
    `failure_signature` returned None whenever `failed_gate` was None, which is
    every lap of this scenario: the breaker would have been blind and the loop
    would have run to its ceiling every time.
    """
    write_repo(
        repo,
        worker="date +%s%N >> scratch.txt",
        max_iterations=6,
    )
    commit_everything(repo, git_run)
    monkeypatch.chdir(repo)
    author_the_witness(repo)

    cli.main(["run"])

    finished = [
        e for e in events(only_loop(repo)) if e["type"] == "loop.finished"
    ][-1]
    assert finished["reason"] == "oscillating", finished
    assert finished["iterations"] < 6, finished


def test_a_repository_with_no_witness_lane_still_converges_and_briefs_nobody(
    repo, git_run, monkeypatch
):
    """Absence is absence. P4-1 changed the continuation predicate for EVERY
    loop in the world, so the case where nothing was added has to be pinned.

    **Renamed** — it used to be called `..._is_byte_for_byte_unmoved` and
    compared no bytes at all (review finding 14). The property is real and it is
    now pinned by the test below, which compares the signature against a
    reimplementation of the pre-P4-1 algorithm. This one pins the behaviour a
    user sees: converged, and nobody briefed.
    """
    write_repo(repo, worker="true", max_iterations=2)
    (repo / "wringer.spec.yaml").unlink()
    commit_everything(repo, git_run)
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == 0

    recorded = events(only_loop(repo))
    assert [e for e in recorded if e["type"] == "loop.finished"][-1][
        "reason"
    ] == "converged"
    assert not [e for e in recorded if e["type"] == "worker.started"], (
        "a repository with no witness lane ran a worker turn it never used to"
    )


def test_without_a_lane_the_signature_is_the_one_that_shipped_before_P4_1():
    """**The bytes, actually compared** (review finding 14).

    `failure_signature` grew a second source of parts. For a repository with no
    witness lane the hash must be the SAME HASH it was before — not merely
    "still a hash" — or every resumed loop in the world would trip its own
    breaker against signatures recorded by an older version.

    The pre-change algorithm is reimplemented here rather than imported,
    deliberately: importing the shipped one would compare it to itself, which is
    how the pin became a tautology the last time this repository trusted a
    comparison it had not written out.
    """
    import hashlib
    import types

    class _FakeResult:
        def __init__(self, gate_id, exit_code, out, err):
            self.gate = types.SimpleNamespace(id=gate_id)
            self.exit_code = exit_code
            self.stdout_path = out
            self.stderr_path = err

    class _MissingPath:
        def read_text(self, **kwargs):
            raise OSError("absent")

    failing = _FakeResult("unit", 1, _MissingPath(), _MissingPath())
    outcome = types.SimpleNamespace(
        failed_gate="unit", results=[failing], acceptance=None,
    )

    # The algorithm as it stood before P4-1, written out.
    parts = ["unit", "1", loop._normalize(""), loop._normalize("")]
    expected = hashlib.sha256("\0".join(parts).encode("utf-8")).hexdigest()

    for witnesses in (None, []):
        assert loop.failure_signature(outcome, witnesses) == expected, (
            "the signature moved for a repository with no witness lane"
        )

    # And a run with nothing failing still returns None, which is what the
    # breaker and the ledger both key on.
    green = types.SimpleNamespace(failed_gate=None, results=[], acceptance=None)
    assert loop.failure_signature(green, None) is None
    assert loop.failure_signature(green, []) is None


# --- DRIVE 2 ----------------------------------------------------------------


def test_a_worker_that_tampers_with_the_witness_MID_LOOP_voids_by_name(
    repo, git_run, monkeypatch, capsys
):
    """**Drive 2, and it is what makes drive 1 safe to ship.**

    Engaging the loop on a red witness hands a worker more turns in which to
    find the check and "fix" it — which is not hypothetical: on the first real
    corpus task an agent opened Wringer's witness and rewrote it, helpfully and
    fatally. P4-3 moved the bytes outside the repository so no agent reaches
    them by tidying its own tree, and that is a repair, not a boundary: a
    worker on the host can still walk to a path it derives.

    So the pin is what carries this, re-checked against the bytes ON DISK
    immediately before every execution. The worker below does exactly what the
    corpus agent did, and the run must VOID — not fail a gate, not refuse a
    delivery: **no run at all**, exit 3, naming the witness and both digests.
    """
    store = witness.store_dir(repo)
    # The replacement body, built OUTSIDE the f-string. A backslash inside an
    # f-string expression is legal from 3.12 (PEP 701) and a SyntaxError on
    # 3.11 — which this project's `requires-python`, its badge and its CI
    # matrix all still claim to support. The file could not even be COLLECTED
    # there, so the whole suite was red on 3.11 and the local `ci-repro.sh`
    # never saw it because it runs on this machine's 3.12.
    body = json.dumps("def test_total_adds_up():\n    assert True\n")
    tamper = (
        f"printf '%b' {body} "
        f"> {store / 'test_witness_totals.py'}"
    )
    write_repo(repo, worker=tamper, max_iterations=3)
    commit_everything(repo, git_run)
    monkeypatch.chdir(repo)
    author_the_witness(repo)

    code = cli.main(["run"])

    assert code == 3, (
        f"a mid-loop witness rewrite exited {code}. A pin mismatch is not a "
        "failing gate and not a refused delivery — it is the absence of a run, "
        "which is exit 3"
    )
    captured = capsys.readouterr()
    message = " ".join((captured.out + captured.err).split())
    assert "totals" in message, message
    assert "not the one that was pinned" in message, message
    assert "VOID" in message, message

    # The tamper really did land — otherwise this test would pass for the
    # wrong reason, which is precisely how the pin was a tautology for a day.
    on_disk = (store / "test_witness_totals.py").read_text(encoding="utf-8")
    assert "assert True" in on_disk, "the worker never managed to tamper"


def test_the_pin_is_rechecked_on_EVERY_lap_not_only_the_first(
    repo, git_run, monkeypatch
):
    """The tamper above happens after lap 1's execution, so a pin checked once
    before the first worker turn would never see it.

    Driven rather than reasoned about: this is the exact defect the independent
    review measured — `check_pin` comparing an in-memory object's digest back
    against itself, passing while the file on disk had changed.
    """
    store = witness.store_dir(repo)
    # Lap 1: a REAL partial fix, so the witness comes back with a different
    # failure and the breaker does not fire. Lap 2: the tamper. Getting to a
    # second worker turn is the whole point — a pin checked once, before the
    # first turn, would be blind to everything after it.
    worker = (
        "if [ -f .lap ]; then "
        f"printf '%b' 'def test_total_adds_up():\\n    assert True\\n' "
        f"> {store / 'test_witness_totals.py'}; "
        "else printf '%b' 'def total(*values):\\n    return 1\\n' > calc.py; "
        "touch .lap; fi"
    )
    write_repo(repo, worker=worker, max_iterations=4)
    commit_everything(repo, git_run)
    monkeypatch.chdir(repo)
    author_the_witness(repo)

    assert cli.main(["run"]) == 3

    recorded = events(only_loop(repo))
    turns = [e for e in recorded if e["type"] == "worker.started"]
    assert len(turns) >= 2, (
        f"the run VOIDed before a second lap ({len(turns)} turns), so this "
        "measured the first-lap check rather than the re-check"
    )


def test_only_a_REQUIRED_criterion_can_hold_the_loop_open(
    repo, git_run, monkeypatch
):
    """An optional criterion is a statement, not a gate.

    `accept.Row.refuses` already says only a required criterion may stop a
    delivery. Spending worker turns — real money, on a real agent — to satisfy
    one the spec explicitly declined to require would be this loop inventing a
    requirement nobody wrote, which is W10's defect one level up.
    """
    write_repo(repo, worker="touch notes.txt", max_iterations=3)
    # `totals` becomes OPTIONAL and keeps its red witness. A second criterion
    # has to be required, because a rubric with none is refused outright —
    # *"a verdict could never be anything but 'pass'"* — and it deliberately
    # has no witness, so nothing else can hold the loop open and what is
    # measured here is only the optional one.
    (repo / "wringer.spec.yaml").write_text(
        SPEC.replace(
            "  - id: totals\n"
            "    title: total() returns the sum of its arguments\n"
            "    required: true\n"
            "    human: false\n",
            "  - id: totals\n"
            "    title: total() returns the sum of its arguments\n"
            "    required: false\n"
            "    human: false\n"
            "  - id: notes\n"
            "    title: the change is described\n"
            "    required: true\n"
            "    human: true\n",
        ),
        encoding="utf-8",
    )
    from wringer import accept

    approved = accept.read_spec(repo)
    assert approved is not None, "the rewritten spec does not parse"
    assert {c.id: c.required for c in approved.criteria} == {
        "totals": False, "notes": True
    }
    commit_everything(repo, git_run)
    monkeypatch.chdir(repo)
    author_the_witness(repo)

    assert cli.main(["run"]) == 0

    recorded = events(only_loop(repo))
    assert [e for e in recorded if e["type"] == "loop.finished"][-1][
        "reason"
    ] == "converged"
    assert not [e for e in recorded if e["type"] == "worker.started"], (
        "an OPTIONAL criterion's red witness bought worker turns. The spec "
        "said this one need not be satisfied; the loop overruled it"
    )


# --- W6: the record is published, frozen, and validated against what runs ----


def _validator():
    import jsonschema

    schema = json.loads(
        (
            Path(__file__).resolve().parent.parent
            / "schema" / "witness.schema.json"
        ).read_text(encoding="utf-8")
    )
    return jsonschema.Draft202012Validator(schema)


def test_a_REAL_witness_record_validates_against_its_published_schema(
    repo, git_run, monkeypatch
):
    """**W6's debt, paid** (§6d item 6, closed by P4-5.6).

    `witness.json` was written and versioned from the day the lane landed and
    was absent from `schema/` — a published format nobody promised to keep,
    which `test_the_freeze_covers_every_published_schema` calls worse than not
    publishing one at all.

    Validated against a record a REAL run wrote, not a fixture: a schema
    checked only against a hand-built example describes the example.
    """
    write_repo(repo, worker=f"printf '%b' {json.dumps(FIXED)} > calc.py")
    commit_everything(repo, git_run)
    monkeypatch.chdir(repo)
    author_the_witness(repo)
    cli.main(["run"])

    recorded = json.loads(
        (only_loop(repo) / witness.WITNESS_FILENAME).read_text(encoding="utf-8")
    )
    errors = [
        f"{e.json_path}: {e.message}" for e in _validator().iter_errors(recorded)
    ]
    assert not errors, "\n".join(errors)
    assert recorded["schema_version"] == witness.SCHEMA_VERSION

    # Both interesting sub-objects really were exercised, or this proves less
    # than it looks: a converted witness has BOTH a proved_red and an executed.
    row = recorded["witnesses"][0]
    assert row["proved_red"] is not None and row["executed"] is not None


def test_a_DISCARDED_witness_record_also_validates(repo, git_run, monkeypatch):
    """The other shape, and the one a fixture would forget: `executed` is null,
    `discarded` carries a sentence, and the criterion went to a human. A schema
    that only admits the happy row is a schema that fails on the honest one."""
    write_repo(repo, worker="true", max_iterations=1)
    commit_everything(repo, git_run)
    monkeypatch.chdir(repo)
    # Born GREEN on the pre-change tree, so it is discarded and evidences
    # nothing — which is the outcome that routes a criterion to a person.
    item = witness.Witness(
        criterion="totals",
        source="def test_total_adds_up():\n    assert True\n",
    )
    witness.store(repo, item)
    witness.record(
        repo, [item], model="hand-authored (test)", base_sha="0" * 40,
        tree_dirty=False, isolation={"tree": "pre-change"},
        prompt_digests={"criterion:totals": "c" * 64, "prompt:totals": "p" * 64},
    )

    cli.main(["run"])

    recorded = json.loads(
        (only_loop(repo) / witness.WITNESS_FILENAME).read_text(encoding="utf-8")
    )
    errors = [
        f"{e.json_path}: {e.message}" for e in _validator().iter_errors(recorded)
    ]
    assert not errors, "\n".join(errors)
    row = recorded["witnesses"][0]
    assert row["executed"] is None
    assert row["discarded"], "a discarded witness must say why, or it is a gap"


def test_the_schema_declares_every_outcome_the_code_can_produce():
    """A schema branch nothing can produce is a claim without a gate; an
    outcome the schema does not admit is a bundle that fails its own format."""
    import jsonschema  # noqa: F401  (import guarded here, not at module level)

    schema = json.loads(
        (
            Path(__file__).resolve().parent.parent
            / "schema" / "witness.schema.json"
        ).read_text(encoding="utf-8")
    )
    row = schema["properties"]["witnesses"]["items"]["properties"]
    declared = set(row["proved_red"]["properties"]["outcome"]["enum"])
    assert declared == {witness.ASSERTION, witness.COLLECTION_ERROR, witness.GREEN}

    verdicts = set(row["proved_red"]["properties"]["verdict"]["enum"])
    assert verdicts == {witness.PROVEN, witness.NOT_ESTABLISHED}


def test_an_EXTRA_key_in_the_store_record_cannot_break_the_bundles_schema(
    repo, git_run, monkeypatch
):
    """**MEDIUM finding 5, folded.**

    `witness.load` sets `record` verbatim from the store's own `witness.json`,
    and `_write_witness_record` splatted it into a bundle row that
    `witness.schema.json` closes with `additionalProperties: false`. One extra
    key in the store therefore produced a bundle failing its own published,
    frozen schema — which is HIGH finding 2 of the PREVIOUS review ("every
    bundle carrying this lane wrote a ledger that failed its own published
    schema") arriving one file over. The schema being frozen now is exactly
    what makes a future store field trigger it.

    The row is built from NAMED fields, so the store may grow and the bundle
    stays inside its contract.
    """
    write_repo(repo, worker="true", max_iterations=1)
    commit_everything(repo, git_run)
    monkeypatch.chdir(repo)
    author_the_witness(repo)

    # A store record from a hypothetical LATER version of the lane.
    record_path = witness.store_dir(repo) / witness.WITNESS_FILENAME
    stored = json.loads(record_path.read_text(encoding="utf-8"))
    stored["witnesses"][0]["notes"] = "a field a future version added"
    record_path.write_text(json.dumps(stored, indent=2), encoding="utf-8")

    cli.main(["run"])

    recorded = json.loads(
        (only_loop(repo) / witness.WITNESS_FILENAME).read_text(encoding="utf-8")
    )
    errors = [
        f"{e.json_path}: {e.message}" for e in _validator().iter_errors(recorded)
    ]
    assert not errors, (
        "an extra key in the STORE produced a bundle that fails its own "
        "published, frozen schema:\n" + "\n".join(errors)
    )
    assert "notes" not in recorded["witnesses"][0]
