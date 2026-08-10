"""One question, asked of the whole program: can a credential reach an artifact?

Every other redaction test in this suite is **per-path** — written by whoever
built that path, covering that path. That is exactly how two leaks shipped:

- `acp.py` handed the agent's stderr a raw file handle and wrote its session
  updates unscrubbed. Found 2026-08-06 while building `wring start`.
- `vacuity.py` ran the pre-change gates through `gates.run` with no redactor
  at all, so `--prove`'s logs got no scrubbing — not even the built-in
  `*TOKEN*`/`*SECRET*`/`*KEY*` defaults. Found the same day.

Both were new write paths into a bundle, and both needed somebody to remember
to test them. Twice nobody did. `AGENTS.md` already states the invariant —
*"If you add a file to the bundle, add it through the `Bundle`, or you have
quietly opted out of the one guarantee SECURITY.md makes"* — and nothing
enforced it.

This file enforces it, and it does so in the one way that survives future
carelessness: it does not enumerate write paths. It plants credentials in the
environment, drives the commands that produce artifacts, then walks **every
file under `.wringer/`** and asserts the values are in none of them. A write
path added next year is covered the day it is added, by nobody's diligence.

**It covers only the commands it DRIVES**, and that is the one place a new
bundle can still slip past. `wring graph` shipped a whole bundle family —
`.wringer/graphs/`, a staged intent file, a decision file, node references —
and none of it was swept until a `graph` run was added to the list below. Add
a command that writes artifacts, add it here in the same commit.

Two secrets, deliberately:

- `WRINGER_TEST_API_KEY` matches the redactor's default `*KEY*` pattern, so it
  is protected however the config is read.
- `WRINGER_TEST_CREDENTIAL` matches **none** of the defaults. The only thing
  that can save it is `config.declared_secret_names` reaching the redactor
  that write path used. It is the canary for the whole `env_passthrough`
  promise.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

from wringer import attest, cli

AGENT = Path(__file__).resolve().parent / "fake_acp_agent.py"

# Long enough to clear `redact.MIN_SECRET_LENGTH`, and obviously fake: a
# fixture credential that could be mistaken for a real one is a hazard in a
# repo whose product is evidence.
PLAIN_NAME = "WRINGER_TEST_CREDENTIAL"
PLAIN_VALUE = "notarealcredential-sweep-0f41c9d2ab73"
KEYED_NAME = "WRINGER_TEST_API_KEY"
KEYED_VALUE = "sk-ant-notarealkey-sweep-77b3e0a4"

RUBRIC = """\
schema_version: wringer.rubric.v1
title: Acceptance criteria
criteria:
  - id: it-works
    title: The change does what it says
    guidance: Say whether it does.
    required: true
"""


def config_body() -> str:
    """A repo that opted into everything that writes an artifact."""
    return f"""\
version: 1
gates:
  - id: leak
    run: "echo ${PLAIN_NAME} ${KEYED_NAME}"
  # Leaks AND is change-sensitive: the echo always runs, the grep decides the
  # exit. That makes it fail on the pre-change tree with the credentials in
  # its log, which is the one input that drives `vacuity._cite` — the
  # function that lifts a line of gate output INTO `vacuity.json`. Without a
  # gate of this shape the sweep never exercises that path.
  - id: fixed
    run: "echo ${PLAIN_NAME} ${KEYED_NAME} && grep -q FIXED calc.py"

run:
  worker:
    acp:
      command: {json.dumps(sys.executable)}
      args: [{json.dumps(str(AGENT))}, "leak"]
      env_passthrough: [{PLAIN_NAME}, {KEYED_NAME}]
  max_iterations: 3
  worker_timeout: 30

judge:
  endpoint: http://127.0.0.1:11434/v1/chat/completions
  model: a-model
  rubric: rubric.yaml
  api_key_env: {KEYED_NAME}

deliver:
  branch: "wringer/{{run}}"
  remote: origin
"""


# The headline flow, so the sweep drives every graph write path there is:
# an intent node staging a file (`notes.py`, which holds both credentials in
# cleartext), a human node parking, a loop node running the same leaking
# worker, a router, and a deliver node planning a real delivery.
GRAPH = """\
version: 1
id: sweep
inputs:
  brief: notes.py
budgets:
  wall_clock: 900
nodes:
  read-brief:
    kind: intent
    input: inputs.brief
    writes:
      brief: state.brief
    then: approve
  approve:
    kind: human
    prompt: "Approve the sweep."
    then: build
  build:
    kind: loop
    budgets:
      max_iterations: 3
    writes:
      status: state.build-status
    then: route
  route:
    kind: router
    routes:
      - when: "state.build-status == 'converged'"
        to: ship
    default: fail
  ship:
    kind: deliver
    then: done
"""


def artifacts(repo: Path) -> list[Path]:
    return [path for path in (repo / ".wringer").rglob("*") if path.is_file()]


def mentions(repo: Path, needle: str) -> list[str]:
    hits = []
    for path in artifacts(repo):
        try:
            body = path.read_text(encoding="utf-8", errors="replace")
        except OSError:  # pragma: no cover - nothing here is unreadable
            continue
        if needle in body:
            hits.append(path.relative_to(repo).as_posix())
    return hits


@pytest.fixture
def leaky_repo(repo: Path, git_run, tmp_path_factory, monkeypatch) -> Path:
    monkeypatch.setenv(PLAIN_NAME, PLAIN_VALUE)
    monkeypatch.setenv(KEYED_NAME, KEYED_VALUE)
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / "rubric.yaml").write_text(RUBRIC, encoding="utf-8")
    (repo / ".wringer.yaml").write_text(config_body(), encoding="utf-8")
    (repo / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    (repo / "notes.py").write_text("TOKEN = 'placeholder'\n", encoding="utf-8")
    git_run(repo, "add", "-A")
    git_run(repo, "commit", "-qm", "a repo that leaks from every seam")

    # An agent pasting a credential into a SOURCE FILE, which is the second
    # way a secret gets into evidence and the one an environment-only test
    # cannot see. It is an uncommitted change, so it is in every diff every
    # command captures from here on.
    (repo / "notes.py").write_text(
        f"TOKEN = {PLAIN_VALUE!r}\nKEY = {KEYED_VALUE!r}\n", encoding="utf-8"
    )

    # A real `origin`, on disk. `wring deliver` refuses when the remote's
    # default branch cannot be resolved — one of its five refusals — so
    # without this the delivery bundle is never written and the sweep would
    # silently stop covering that write path.
    origin = tmp_path_factory.mktemp("origin") / "bare.git"
    git_run(repo, "init", "--bare", "-b", "main", "-q", str(origin))
    git_run(repo, "remote", "add", "origin", str(origin))
    git_run(repo, "push", "-q", "origin", "main")
    git_run(repo, "remote", "set-head", "origin", "-a")

    monkeypatch.chdir(repo)
    return repo


def test_no_command_writes_a_credential_into_any_artifact(
    leaky_repo: Path, capsys
):
    """The sweep. Every command that produces an artifact runs against a repo
    whose gate echoes two credentials and whose agent echoes them back, and
    then every file is read.

    Deliberately NOT a list of write paths to check — that is the shape that
    failed twice. It is a list of commands to RUN, and an assertion over
    whatever they leave behind.
    """
    repo = leaky_repo

    # The loop: gates fail, the ACP agent leaks and fixes, gates pass. Covers
    # the loop bundle, its worker logs, its ledger, and every verify bundle
    # nested underneath it.
    assert cli.main(["run"]) == cli.EXIT_OK
    # Attested BEFORE the judge runs: `attest` refuses to stand over a dry-run
    # verdict, because a `judged_by` clause about a judgment nobody made would
    # be theatre. The order here is the program's rules, not a preference.
    assert cli.main(["attest"]) == cli.EXIT_OK
    assert cli.main(["judge"]) == cli.EXIT_OK          # dry run: no socket
    assert cli.main(["deliver"]) == cli.EXIT_OK        # dry run: no git write
    # Last, because a vacuity verdict is one more thing `attest` may refuse:
    # the pre-change gate logs are the path that had no redactor at all.
    cli.main(["verify", "--prove"])
    capsys.readouterr()

    assert artifacts(repo), "no artifacts were produced, so nothing was tested"

    leaked = {
        PLAIN_NAME: mentions(repo, PLAIN_VALUE),
        KEYED_NAME: mentions(repo, KEYED_VALUE),
    }
    assert leaked == {PLAIN_NAME: [], KEYED_NAME: []}, (
        "a credential reached an artifact. Whatever wrote those files did not "
        "go through the Bundle's redactor — AGENTS.md: add it through the "
        f"Bundle or you have quietly opted out of SECURITY.md's guarantee.\n"
        f"{json.dumps(leaked, indent=2)}"
    )


def test_no_graph_run_writes_a_credential_into_any_artifact(
    leaky_repo: Path, capsys
):
    """The same question, asked of the bundle family P7 added.

    A graph run writes a ledger, a resolved graph, a state snapshot, a
    manifest, a summary, digests, a staged intent file, a prompt, a decision
    file and two node references — and it drives a loop and a delivery, each
    writing bundles of their own. None of that was swept until this test
    existed, which is the same gap that let two leaks ship: a new write path
    nobody remembered to cover.

    The intent node is the sharpest canary here. It copies `notes.py` — which
    holds both credentials in cleartext — into evidence, and the only thing
    standing between that file and the bundle is the redactor the node was
    handed.
    """
    repo = leaky_repo

    (repo / "graph.yaml").write_text(GRAPH, encoding="utf-8")

    # Parks at the human node: exit 5, a person must act.
    assert cli.main(["graph", "run", "graph.yaml"]) == cli.EXIT_NEEDS_HUMAN
    graphs = sorted((repo / ".wringer" / "graphs").iterdir())
    assert len(graphs) == 1, graphs
    (graphs[0] / "nodes" / "approve" / "decision.yaml").write_text(
        'approved: true\ncomments: ""\nstate_updates: {}\n', encoding="utf-8"
    )
    # No `--send`: the deliver node plans, writes the patch, and touches git
    # not at all. The patch is the point — it carries `notes.py`.
    assert cli.main(["graph", "resume", str(graphs[0])]) == cli.EXIT_OK
    capsys.readouterr()

    assert artifacts(repo), "no artifacts were produced, so nothing was tested"
    # Which write paths this actually reached, stated rather than assumed: a
    # sweep is only as good as the files it swept, and "the command exited 0"
    # does not say a delivery was planned or a brief was staged.
    reached = {path.relative_to(repo).as_posix() for path in artifacts(repo)}
    for expected in (".wringer/graphs/", ".wringer/deliveries/", ".wringer/loops/"):
        assert any(path.startswith(expected) for path in reached), (
            f"the graph run wrote nothing under {expected}, so the sweep did "
            f"not cover it: {sorted(reached)[:10]}"
        )
    assert any(path.endswith("/brief.md") for path in reached), (
        "the intent node staged nothing, so the file holding the credentials "
        "never reached the bundle"
    )

    leaked = {
        PLAIN_NAME: mentions(repo, PLAIN_VALUE),
        KEYED_NAME: mentions(repo, KEYED_VALUE),
    }
    assert leaked == {PLAIN_NAME: [], KEYED_NAME: []}, (
        "a credential reached an artifact of a graph run. Whatever wrote those "
        "files did not go through the graph Bundle's redactor.\n"
        f"{json.dumps(leaked, indent=2)}"
    )

    # The guard on the guard, for the graph's own directory specifically: if
    # nothing under `.wringer/graphs/` was scrubbed, the secret never reached
    # the graph's machinery and the assertion above passed over an empty tree.
    scrubbed = [
        path for path in mentions(repo, "[REDACTED]")
        if path.startswith(".wringer/graphs/")
    ]
    assert scrubbed, (
        "nothing in the graph bundle was scrubbed at all, so the sweep above "
        "proved nothing about it"
    )


def test_the_sweep_would_notice_a_leak(leaky_repo: Path, capsys):
    """The guard on the guard.

    A sweep that passes because nothing was ever written, or because the
    secret never reached the machinery, is a sweep that proves nothing — and
    this repo has thrown away two tests that passed against broken code. So:
    the scrubbing must be visibly happening, and the values must really be in
    the environment the gates and the agent inherit.
    """
    repo = leaky_repo

    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()

    assert mentions(repo, "[REDACTED]"), (
        "nothing in the evidence was scrubbed at all — either the gate never "
        "echoed the credentials or the bundle recorded nothing, and the sweep "
        "above would pass over an empty tree"
    )


# The bench section, appended to the leaky config: TWO contenders, each
# declaring a DIFFERENT credential. That asymmetry is the whole point. A
# redactor built from the `run:` worker's names, or from the first
# contender's, protects one value and hands the other to an artifact — and
# `wring bench` is the one command that deliberately runs more than one agent,
# so it is the one place that mistake is invisible until a bundle is read.
#
# The ORDER of the two is load-bearing, and it was wrong first time round.
# `WRINGER_TEST_API_KEY` matches the redactor's built-in `*KEY*` name pattern,
# so its value is scrubbed whether or not anything declared it — put that one
# second and the test passes against a `declared_secret_names` that drops
# every contender after the first, which is a tautology wearing a leak test's
# clothes. `WRINGER_TEST_CREDENTIAL` matches no pattern, so it is protected
# ONLY by being declared. It goes last, where a truncated list loses it.
BENCH_SECTION = f"""
bench:
  contender_wall_clock: 120
  contenders:
    - id: alpha
      worker:
        acp:
          command: {json.dumps(sys.executable)}
          args: [{json.dumps(str(AGENT))}, "leak"]
          env_passthrough: [{KEYED_NAME}]
    - id: beta
      worker:
        acp:
          command: {json.dumps(sys.executable)}
          args: [{json.dumps(str(AGENT))}, "leak"]
          env_passthrough: [{PLAIN_NAME}]
"""


def test_no_bench_writes_a_credential_into_any_artifact(leaky_repo: Path, capsys):
    """The same question, asked of the bundle family P6 added — and the sweep
    DRIVES the bench rather than checking a list of its write paths, because
    a list is the shape that failed twice.

    A bench writes its own ledger, manifest, summary and digests, and it also
    writes a baseline verify bundle and one whole loop bundle per contender,
    each inside a kept worktree. Every one of those is under `.wringer/`, and
    every one is read here.

    The two contenders declare DIFFERENT credentials on purpose: a redactor
    that folded in only the first contender's names would scrub `alpha`'s
    value and write `beta`'s in cleartext, and the bundle would look clean to
    anyone grepping for one secret.
    """
    repo = leaky_repo
    (repo / ".wringer.yaml").write_text(
        config_body() + BENCH_SECTION, encoding="utf-8"
    )

    # The gates are red at HEAD (`calc.py` is BROKEN), which is what a bench
    # requires — and both leaking gates run in every worktree, so the
    # credentials reach gate logs on the baseline and on every contender.
    assert cli.main(["bench"]) == cli.EXIT_OK
    capsys.readouterr()

    assert artifacts(repo), "no artifacts were produced, so nothing was tested"
    reached = {path.relative_to(repo).as_posix() for path in artifacts(repo)}
    # Which write paths this actually reached, stated rather than assumed.
    for expected in (".wringer/benches/", ".wringer/worktrees/"):
        assert any(path.startswith(expected) for path in reached), (
            f"the bench wrote nothing under {expected}, so the sweep did not "
            f"cover it: {sorted(reached)[:10]}"
        )
    assert any("/loops/" in path for path in reached), (
        "no contender loop bundle was written inside a worktree, so the sweep "
        "covered the bench's own files and none of the evidence they point at"
    )

    leaked = {
        PLAIN_NAME: mentions(repo, PLAIN_VALUE),
        KEYED_NAME: mentions(repo, KEYED_VALUE),
    }
    assert leaked == {PLAIN_NAME: [], KEYED_NAME: []}, (
        "a credential reached a bench artifact. Every contender's declared "
        "names must reach the bench redactor through "
        "`config.declared_secret_names` — a redactor built from fewer of them "
        "protects almost everything.\n" + json.dumps(leaked, indent=2)
    )


# --- the bundles that are COMMITTED --------------------------------------
#
# Every sweep above drives commands against a scratch repo and throws the
# tree away with the tmpdir. `.wringer.example/` is different in the one way
# that matters: it is in git, so a credential that reaches it is published,
# and stays published in the history after it is deleted.
#
# It held one v0.1.0 verify bundle for a fortnight. M3's evidence landed
# beside it on 2026-08-10 — a graph run, its loop, both of that loop's verify
# runs, and the delivery that shipped it — which is four more bundle families
# in the one directory a stranger actually downloads.
#
# Nothing is planted here, so this asks the other half of the question: does
# anything in the published evidence have the SHAPE of a credential? The
# sweep above proves the redactor ran; this proves nobody committed a bundle
# it never saw.

EXAMPLE_DIR = Path(__file__).resolve().parent.parent / ".wringer.example"

# Prefixes and framings that identify a credential without knowing its value.
# Deliberately conservative: a false positive here blocks a commit for a
# human to look at, which is the correct cost, and a shape not on this list
# is caught by nothing — so it stays a list that grows.
CREDENTIAL_SHAPES = (
    ("anthropic or openai key", re.compile(r"\bsk-[A-Za-z0-9_-]{16,}")),
    ("github token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}")),
    ("github fine-grained token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}")),
    ("gitlab token", re.compile(r"\bglpat-[A-Za-z0-9_-]{16,}")),
    ("aws access key id", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}")),
    ("private key block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("credentials inside a url", re.compile(r"\bhttps?://[^/\s:@]+:[^/\s@]+@")),
)


def committed_bundles() -> list[Path]:
    """Every bundle directory under `.wringer.example/`, by its manifest."""
    if not EXAMPLE_DIR.is_dir():  # pragma: no cover - repo-only fixture
        pytest.skip(".wringer.example is not part of the distribution")
    return sorted(path.parent for path in EXAMPLE_DIR.rglob("manifest.json"))


def committed_files() -> list[Path]:
    if not EXAMPLE_DIR.is_dir():  # pragma: no cover - repo-only fixture
        pytest.skip(".wringer.example is not part of the distribution")
    return sorted(path for path in EXAMPLE_DIR.rglob("*") if path.is_file())


def shapes_in(text: str) -> list[str]:
    return [name for name, pattern in CREDENTIAL_SHAPES if pattern.search(text)]


def test_no_committed_bundle_carries_anything_credential_shaped():
    """The published half of the sweep."""
    found: dict[str, list[str]] = {}
    for path in committed_files():
        hits = shapes_in(path.read_text(encoding="utf-8", errors="replace"))
        if hits:
            found[path.relative_to(EXAMPLE_DIR.parent).as_posix()] = hits

    assert not found, (
        "a committed bundle holds something shaped like a credential. This "
        "directory is in git, so it is published and stays published:\n"
        f"{json.dumps(found, indent=2)}"
    )


def test_the_committed_sweep_covers_every_bundle_family():
    """The guard on the guard, and the one that would have caught the graph
    gap: the sweep above passes trivially over a directory that lost its
    contents, or that never held the family somebody forgot to copy."""
    families = {
        path.relative_to(EXAMPLE_DIR).parts[0]
        for path in committed_files()
        if len(path.relative_to(EXAMPLE_DIR).parts) > 1
    }
    assert families == {"runs", "loops", "graphs", "deliveries"}, families
    # and the walk really reaches files, not just directories
    assert len(committed_files()) > 40, len(committed_files())


@pytest.mark.parametrize(
    "planted",
    [
        "sk-ant-notarealkey-sweep-77b3e0a4f1",
        "ghp_notarealtokenvalue000000000000000",
        "AKIANOTAREALKEYID123",
        "-----BEGIN RSA PRIVATE KEY-----",
        "https://someone:hunter2@example.invalid/x.git",
    ],
)
def test_the_shape_scanner_would_notice_one(planted):
    """A scanner that matches nothing passes every sweep. Each shape is
    exercised against a value it must catch, so a broken pattern fails here
    rather than going quiet in the test above."""
    assert shapes_in(f"some evidence text {planted} and more") != []


def test_every_committed_bundle_still_hashes_to_what_it_claims():
    """Committed evidence nobody re-checks is a claim, not a receipt.

    `attest.check_digests` is the shipped verifier — the same one that
    refuses to stand over a bundle whose files moved — rather than a
    lookalike written here. The v0.1.0 bundle predates `digests.json` and is
    named as the exception it already is in `test_attest.py`.
    """
    checked = 0
    for bundle in committed_bundles():
        if not (bundle / "digests.json").is_file():
            assert bundle.name == "20260730-231645-a57c", (
                f"{bundle} has no digests.json and is not the pre-0.2 bundle"
            )
            continue
        _, count = attest.check_digests(bundle, "committed")
        assert count > 0
        checked += 1
    assert checked >= 4, f"only {checked} committed bundles carry digests"


def test_every_committed_bundle_file_is_actually_committed():
    """`.wringer.example/` is only evidence if git carries all of it.

    M3's graph has a node called `build`, and the repo's unanchored Python
    `build/` ignore matched `nodes/build/` at any depth — so
    `nodes/build/loop.ref.json` sat on the copying machine's disk, complete
    against its own digests, and was absent from every clone. The suite was
    green locally and red on three CI runners, and the bundle refused itself
    with "is missing … which its own digests.json records".

    Nothing else here can see that: every other assertion in this file reads
    the working tree, which is exactly the thing that was right.
    """
    import subprocess

    root = EXAMPLE_DIR.parent
    if not (root / ".git").exists():  # pragma: no cover - repo-only fixture
        pytest.skip("not a git checkout")

    listed = subprocess.run(
        ["git", "ls-files", "-z", "--", EXAMPLE_DIR.name],
        cwd=root, capture_output=True, text=True, check=True,
    )
    tracked = {name for name in listed.stdout.split("\0") if name}
    on_disk = {
        path.relative_to(root).as_posix() for path in committed_files()
    }
    assert on_disk, "the committed evidence directory is empty"

    untracked = sorted(on_disk - tracked)
    assert not untracked, (
        "these files are in .wringer.example/ on this machine and in no "
        f"clone — check .gitignore: {untracked}"
    )
