"""Falsify the COMMITTED change (0.6.3) — run 3, F16, P1.4; acceptance 10.

The measurement this file exists for, from the review of record: immediately
after delivery, `wring verify --falsify` said *"the working tree has no
changes, so there is no change to break on purpose"*, and the table was
obtained only by cloning main and re-applying the delivery diff uncommitted,
by hand. Acceptance test 10: *"`wring verify --falsify --delivery <id>`
produces the table after the branch has been committed and pushed."*
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from test_deliver import (  # noqa: F401
    CONFIG,
    accepting_repo,
    delivery_repo,
    fake_forge,
    verified,
)

from wringer import cli, deliver

MR_REPLY = {"number": 7, "html_url": "https://github.com/owner/name/pull/7"}


def _shipped(delivery_repo, monkeypatch, capsys) -> str:
    """A real red-first delivery, SENT — committed and pushed, tree clean."""
    accepting_repo(delivery_repo, bound=False)
    (delivery_repo / ".wringer.yaml").write_text(
        CONFIG.replace(
            '  - id: check\n    run: "true"\n',
            '  - id: check\n    run: "grep -q FIXED flag.txt"\n'
            "    proves: csv-downloads\n",
        ),
        encoding="utf-8",
    )
    monkeypatch.chdir(delivery_repo)
    (delivery_repo / "flag.txt").write_text("BROKEN\n", encoding="utf-8")
    subprocess.run(["git", "add", "-A"], cwd=delivery_repo, check=True)
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@e.invalid",
         "-c", "commit.gpgsign=false", "commit", "-qm", "base"],
        cwd=delivery_repo, check=True,
    )
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    (delivery_repo / "flag.txt").write_text("FIXED\n", encoding="utf-8")
    # A MUTABLE line in the shipped diff: `.txt` is a prose suffix the
    # mutation table skips by design, so a flag-file-only change measures
    # nothing — the fixture's first draft found that out.
    (delivery_repo / "calc.py").write_text(
        "def add(a, b):\n    return a + b\n\n\n"
        "def is_even(n):\n    return n % 2 == 0\n",
        encoding="utf-8",
    )
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()
    fake_forge(monkeypatch, reply=MR_REPLY)
    assert cli.main(["deliver", "--send"]) == cli.EXIT_OK
    said = capsys.readouterr().out
    delivery_id = sorted(
        (delivery_repo / ".wringer" / "deliveries").iterdir()
    )[0].name
    assert f"--delivery {delivery_id}" in said, (
        "the delivery did not print the exact falsify command — F16's fix "
        "includes the workflow saying it"
    )
    # The delivered branch is committed; put the tree back on it CLEAN, the
    # exact after-delivery state run 3 stood in.
    subprocess.run(
        ["git", "checkout", "-q", "."], cwd=delivery_repo, check=True
    )
    return delivery_id


def _runs(repo: Path) -> set[Path]:
    root = repo / ".wringer" / "runs"
    return set(root.iterdir()) if root.is_dir() else set()


def _falsification_of(new_runs: set[Path]) -> dict:
    """The record of the ONE run an invocation just wrote.

    By set difference, never by name sort: run ids tie to the second with a
    random suffix, so `sorted()[-1]` picks a coin-flip run when two land in
    one second — measured as a flaky failure of this very file's first
    draft.
    """
    assert len(new_runs) == 1, f"expected one new run, got {sorted(new_runs)}"
    (run_dir,) = new_runs
    return json.loads(
        (run_dir / "falsification.json").read_text(encoding="utf-8")
    )


def test_ACCEPTANCE_TEN_the_table_after_the_branch_is_committed_and_pushed(
    delivery_repo, monkeypatch, capsys
):
    delivery_id = _shipped(delivery_repo, monkeypatch, capsys)

    before = _runs(delivery_repo)
    assert cli.main(
        ["verify", "--falsify", "--delivery", delivery_id]
    ) == cli.EXIT_OK
    said = capsys.readouterr().out

    recorded = _falsification_of(_runs(delivery_repo) - before)
    assert recorded["verdict"] == "measured", recorded.get("reason")
    assert recorded["counts"]["attempted"] >= 1, (
        "the committed range offered nothing to mutate, so this measures "
        "nothing"
    )
    assert "committed range" in recorded["reason"]
    assert "committed range" in said, (
        "the console does not say WHICH change the numbers are about"
    )
    # commands.txt carries the same command with the placeholder.
    commands = (
        delivery_repo / ".wringer" / "deliveries" / delivery_id
        / deliver.COMMANDS_FILENAME
    ).read_text(encoding="utf-8")
    assert "wring verify --falsify --delivery <id>" in commands


def test_BASE_ref_measures_the_branch_against_its_merge_base(
    delivery_repo, monkeypatch, capsys
):
    _shipped(delivery_repo, monkeypatch, capsys)
    # Stand on the delivered branch: HEAD carries the change, main is base.
    branches = subprocess.run(
        ["git", "branch", "--list", "wringer/*", "--format=%(refname:short)"],
        cwd=delivery_repo, capture_output=True, text=True, check=True,
    ).stdout.split()
    assert branches, "the delivery created no branch"
    subprocess.run(
        ["git", "checkout", "-q", branches[0]], cwd=delivery_repo, check=True
    )

    before = _runs(delivery_repo)
    assert cli.main(["verify", "--falsify", "--base", "main"]) == cli.EXIT_OK
    capsys.readouterr()

    recorded = _falsification_of(_runs(delivery_repo) - before)
    assert recorded["verdict"] == "measured"
    assert recorded["counts"]["attempted"] >= 1


def test_the_bound_gates_come_from_the_RANGE_own_config(
    delivery_repo, monkeypatch, capsys
):
    """The tree being falsified declares its own law. The live config drops
    the binding AFTER delivery; the committed range still measures, because
    the range's config still binds."""
    delivery_id = _shipped(delivery_repo, monkeypatch, capsys)
    (delivery_repo / ".wringer.yaml").write_text(CONFIG, encoding="utf-8")

    before = _runs(delivery_repo)
    assert cli.main(
        ["verify", "--falsify", "--delivery", delivery_id]
    ) == cli.EXIT_OK
    capsys.readouterr()

    recorded = _falsification_of(_runs(delivery_repo) - before)
    assert recorded["verdict"] == "measured", (
        "the live config's unbinding blinded the committed range — the "
        "range's own declaration must decide"
    )
    assert recorded["gates"] == ["check"], (
        "an empty gate roster is trivially clean, so 'measured' alone cannot "
        "tell the range's own law from no law at all — the record must name "
        "the gate the RANGE binds, proving it actually ran"
    )


def test_the_range_is_measured_at_ITS_head_not_the_live_one(
    delivery_repo, monkeypatch, capsys
):
    """Run 3's posture, one commit later: the tree moves on after delivery.
    The scratch copy must detach at the range's own head — detached at the
    live HEAD it no longer carries the delivered lines, every planned
    mutation quietly fails to apply, and zero attempts get dressed up as a
    measurement."""
    delivery_id = _shipped(delivery_repo, monkeypatch, capsys)
    branches = subprocess.run(
        ["git", "branch", "--list", "wringer/*", "--format=%(refname:short)"],
        cwd=delivery_repo, capture_output=True, text=True, check=True,
    ).stdout.split()
    assert branches, "the delivery created no branch"
    subprocess.run(
        ["git", "checkout", "-q", branches[0]], cwd=delivery_repo, check=True
    )
    # Post-delivery drift: the delivered mutable line is gone from HEAD,
    # while the gates still pass live.
    (delivery_repo / "calc.py").write_text(
        "def add(a, b):\n    return a + b\n", encoding="utf-8"
    )
    subprocess.run(["git", "add", "-A"], cwd=delivery_repo, check=True)
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@e.invalid",
         "-c", "commit.gpgsign=false", "commit", "-qm", "drift"],
        cwd=delivery_repo, check=True,
    )

    before = _runs(delivery_repo)
    assert cli.main(
        ["verify", "--falsify", "--delivery", delivery_id]
    ) == cli.EXIT_OK
    capsys.readouterr()

    recorded = _falsification_of(_runs(delivery_repo) - before)
    assert recorded["verdict"] == "measured", recorded.get("reason")
    assert recorded["counts"]["attempted"] >= 1, (
        "zero attempts against a committed range that carries a mutable "
        "line: the scratch copy was not detached at the range's head"
    )


def test_the_range_flags_without_falsify_choose_nothing_and_say_so(
    delivery_repo, monkeypatch, capsys
):
    accepting_repo(delivery_repo, bound=False)
    verified(delivery_repo, monkeypatch, capsys)
    assert cli.main(["verify", "--delivery", "whatever"]) == cli.EXIT_CONFIG
    assert "only choose what" in capsys.readouterr().err


def test_naming_both_ranges_is_refused(delivery_repo, monkeypatch, capsys):
    accepting_repo(delivery_repo, bound=False)
    verified(delivery_repo, monkeypatch, capsys)
    assert cli.main(
        ["verify", "--falsify", "--delivery", "x", "--base", "main"]
    ) == cli.EXIT_CONFIG
    assert "pick one" in capsys.readouterr().err


def test_an_unknown_delivery_id_says_where_it_looked(
    delivery_repo, monkeypatch, capsys
):
    accepting_repo(delivery_repo, bound=False)
    verified(delivery_repo, monkeypatch, capsys)
    assert cli.main(
        ["verify", "--falsify", "--delivery", "20990101-000000-dead"]
    ) == cli.EXIT_CONFIG
    assert "no readable delivery record" in capsys.readouterr().err


def test_a_DRY_RUN_delivery_has_no_committed_change_and_says_so(
    delivery_repo, monkeypatch, capsys
):
    accepting_repo(delivery_repo, bound=False)
    verified(delivery_repo, monkeypatch, capsys)
    assert cli.main(["deliver"]) == cli.EXIT_OK
    capsys.readouterr()
    dry = sorted((delivery_repo / ".wringer" / "deliveries").iterdir())[0].name

    assert cli.main(
        ["verify", "--falsify", "--delivery", dry]
    ) == cli.EXIT_CONFIG
    assert "dry run ships nothing" in capsys.readouterr().err


def test_RULING_3_HOLDS_the_range_flags_change_no_outcome(
    delivery_repo, monkeypatch, capsys
):
    """The standing guard's claim, extended to the new flags: exit code,
    status and acceptance rows identical with and without the range
    falsification."""
    delivery_id = _shipped(delivery_repo, monkeypatch, capsys)

    before = _runs(delivery_repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()
    (plain_dir,) = _runs(delivery_repo) - before
    plain = json.loads((plain_dir / "acceptance.json").read_text("utf-8"))

    before = _runs(delivery_repo)
    assert cli.main(
        ["verify", "--falsify", "--delivery", delivery_id]
    ) == cli.EXIT_OK
    capsys.readouterr()
    (ranged_dir,) = _runs(delivery_repo) - before
    ranged = json.loads((ranged_dir / "acceptance.json").read_text("utf-8"))

    assert plain["counts"] == ranged["counts"]
    assert [r.get("state") for r in plain["criteria"]] == [
        r.get("state") for r in ranged["criteria"]
    ]
