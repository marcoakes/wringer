"""The pen fails CLOSED (0.6.1) — run 3, F11/F12, and P0.4's ruling.

The measurement this whole file rests on, from the run-3 review of record:

> When the show command produced `/bin/sh: python: command not found`,
> `wringer-board judge --verdict met` still recorded `met`. This breaks the
> judgement pen's integrity: the product can record that a person saw and
> approved something it failed to display.

Every test drives the REAL pen — `wringer_board.__main__.main` or
`judge.record` — in a real scratch repo, the house rule.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import pytest
import yaml

from wringer_board import judge as judge_module
from wringer_board.__main__ import main

SPEC = """\
schema_version: wringer.spec.v1
approved: true
title: Arcade
intent: Players pick up where they left off.
open_questions: []
criteria:
  - id: heading-reads-as-mine
    title: The heading reads as mine
    guidance: Decide whether it sounds like your product.
    required: true
    human: true
gates: []
tasks:
  - id: build
    brief: briefs/build.md
    dir: .
    objective: Build it.
"""

CONFIG_NO_SHOW = 'version: 1\ngates:\n  - id: t\n    run: "true"\n'


def config_showing(command: str) -> str:
    return CONFIG_NO_SHOW + f"show:\n  heading-reads-as-mine: {json.dumps(command)}\n"


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "A Person"], cwd=root, check=True)
    subprocess.run(
        ["git", "config", "user.email", "p@example.invalid"], cwd=root, check=True
    )
    (root / "wringer.spec.yaml").write_text(SPEC, encoding="utf-8")
    subprocess.run(["git", "add", "-A"], cwd=root, check=True)
    subprocess.run(
        ["git", "-c", "commit.gpgsign=false", "commit", "-qm", "base"],
        cwd=root, check=True,
    )
    return root


def written(repo: Path) -> dict:
    return yaml.safe_load(
        (repo / judge_module.JUDGEMENTS_FILENAME).read_text(encoding="utf-8")
    )


# --- acceptance test 5: missing `show:` refuses judgement -------------------


def test_a_MISSING_show_REFUSES_the_verdict_and_writes_nothing(repo, capsys):
    (repo / ".wringer.yaml").write_text(CONFIG_NO_SHOW, encoding="utf-8")

    code = main(["judge", str(repo), "--id", "heading-reads-as-mine",
                 "--verdict", "met", "--note", "Looks right."])

    assert code == 2
    said = capsys.readouterr()
    assert "NOTHING IS BEING SHOWN TO YOU" in said.out
    assert "nothing vouches for what you saw" in said.err
    assert not (repo / judge_module.JUDGEMENTS_FILENAME).exists(), (
        "the pen recorded a verdict nobody was shown anything for — F12, "
        "the exact shape run 3 measured"
    )


# --- acceptance test 6: failing `show:` refuses and records no verdict ------


def test_a_FAILING_show_REFUSES_and_records_no_verdict(repo, capsys):
    """F12's taken path: the command run 3 met, replayed — a command that
    cannot run. The failure is printed AS a failure, and nothing is written."""
    (repo / ".wringer.yaml").write_text(
        config_showing("definitely-not-a-command-9c1e"), encoding="utf-8"
    )

    code = main(["judge", str(repo), "--id", "heading-reads-as-mine",
                 "--verdict", "met", "--note", "Looks right."])

    assert code == 2
    said = capsys.readouterr()
    assert "FAILED" in said.out, "the failure rendered under an honest header"
    assert "not found" in said.out
    assert not (repo / judge_module.JUDGEMENTS_FILENAME).exists()


def test_an_exit_ONE_show_is_a_failed_show_too(repo, capsys):
    """The exit code is part of the answer — `check=False` used to fold a
    failing command's stderr into the shown text with nothing said."""
    (repo / ".wringer.yaml").write_text(
        config_showing("echo half-a-render; exit 1"), encoding="utf-8"
    )

    code = main(["judge", str(repo), "--id", "heading-reads-as-mine",
                 "--verdict", "met"])

    assert code == 2
    assert "exit 1" in capsys.readouterr().out
    assert not (repo / judge_module.JUDGEMENTS_FILENAME).exists()


def test_a_show_the_CONFIG_CANNOT_BE_READ_for_is_not_called_UNDECLARED(
    repo, capsys
):
    """**Bug review 0.7, 2026-09-02 (display-and-redaction).** `shown()`
    swallowed every exception from `config.load` as MISSING, so a
    `.wringer.yaml` that DECLARES a `show:` for this requirement but cannot
    be parsed had the pen tell the person *"this repository declares no way
    to render what this requirement is about"* — and point them at adding
    a `show:` line to a file that already has one. Refusing is right; the
    stated reason was false. The pen still refuses, and now carries the
    parser's own words."""
    (repo / ".wringer.yaml").write_text(
        CONFIG_NO_SHOW + "show:\n  - not-a-mapping\n", encoding="utf-8"
    )

    code = main(["judge", str(repo), "--id", "heading-reads-as-mine",
                 "--verdict", "met", "--note", "Looks right."])

    assert code == 2
    said = capsys.readouterr()
    assert "NOTHING IS BEING SHOWN TO YOU" not in said.out, said.out
    assert "declares no" not in said.out + said.err, said.out + said.err
    assert "must be a mapping" in said.out, said.out
    assert not (repo / judge_module.JUDGEMENTS_FILENAME).exists()


def test_a_show_that_TIMES_OUT_refuses(repo, monkeypatch):
    monkeypatch.setattr(judge_module, "SHOW_TIMEOUT", 1)
    (repo / ".wringer.yaml").write_text(
        config_showing("sleep 30"), encoding="utf-8"
    )

    display = judge_module.shown(repo, "heading-reads-as-mine")
    assert display.state == judge_module.FAILED

    with pytest.raises(judge_module.PenRefused) as caught:
        judge_module.record(
            repo, "heading-reads-as-mine", "met",
            read_the_criterion=True, display=display,
        )
    assert caught.value.reason == "show_failed"
    assert not (repo / judge_module.JUDGEMENTS_FILENAME).exists()


def test_declaring_exit_one_EXPECTED_is_the_operators_own_act(repo, capsys):
    """The worked example's shape: a pipeline that exits 1 when it REPORTS
    failures — reporting failures being the thing displayed. The `|| [ $?
    -eq 1 ]` tail is the operator declaring that outcome expected; a genuine
    display failure still exits non-zero and still refuses."""
    (repo / ".wringer.yaml").write_text(
        config_showing('sh -c "echo the two failures; exit 1" || [ $? -eq 1 ]'),
        encoding="utf-8",
    )

    assert main(["judge", str(repo), "--id", "heading-reads-as-mine",
                 "--verdict", "met", "--note", "Clear."]) == 0
    assert "the two failures" in capsys.readouterr().out


# --- acceptance test 7: a successful show BINDS the display -----------------


def test_a_SUCCESSFUL_show_binds_digest_command_exit_and_tree(repo):
    (repo / ".wringer.yaml").write_text(
        config_showing("echo the heading, rendered"), encoding="utf-8"
    )

    assert main(["judge", str(repo), "--id", "heading-reads-as-mine",
                 "--verdict", "met", "--note", "Sounds like us."]) == 0

    record = written(repo)
    assert record["schema_version"] == "wringer.judgement.v2"
    entry = record["judgements"][0]
    display = entry["display"]
    assert display["command"] == "echo the heading, rendered"
    assert display["exit"] == 0
    assert display["output_digest"] == hashlib.sha256(
        b"the heading, rendered"
    ).hexdigest(), "the digest is of the exact text the person was shown"
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True,
    ).stdout.strip()
    assert display["head_sha"] == head
    assert "judged_without_display" not in entry


def test_the_verdict_is_refused_when_the_TREE_MOVED_between_show_and_record(
    repo,
):
    (repo / ".wringer.yaml").write_text(
        config_showing("echo the heading"), encoding="utf-8"
    )
    display = judge_module.shown(repo, "heading-reads-as-mine")
    assert display.state == judge_module.SHOWN

    (repo / "moved.txt").write_text("x\n", encoding="utf-8")
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(
        ["git", "-c", "commit.gpgsign=false", "-c", "user.email=p@e.invalid",
         "commit", "-qm", "moved"],
        cwd=repo, check=True,
    )

    with pytest.raises(judge_module.PenRefused) as caught:
        judge_module.record(
            repo, "heading-reads-as-mine", "met",
            read_the_criterion=True, display=display,
        )
    assert caught.value.reason == "show_failed"
    assert "tree moved" in str(caught.value)


# --- the one honest escape --------------------------------------------------


def test_WITHOUT_DISPLAY_records_the_fact_and_the_failure_verbatim(
    repo, capsys
):
    """The person's authority is preserved — explicitly, never silently. The
    record carries that they judged unshown, and what the show surface said."""
    (repo / ".wringer.yaml").write_text(
        config_showing("definitely-not-a-command-9c1e"), encoding="utf-8"
    )

    assert main(["judge", str(repo), "--id", "heading-reads-as-mine",
                 "--verdict", "met", "--note", "I ran it by hand.",
                 "--without-display"]) == 0

    entry = written(repo)["judgements"][0]
    assert entry["judged_without_display"] is True
    assert "not found" in entry["show_failure"], (
        "the show failure travels verbatim into the judgement"
    )
    assert "display" not in entry


def test_WITHOUT_DISPLAY_on_a_missing_show_says_nothing_was_declared(repo):
    (repo / ".wringer.yaml").write_text(CONFIG_NO_SHOW, encoding="utf-8")

    assert main(["judge", str(repo), "--id", "heading-reads-as-mine",
                 "--verdict", "not_met", "--note", "It reads generic.",
                 "--without-display"]) == 0

    entry = written(repo)["judgements"][0]
    assert entry["judged_without_display"] is True
    assert "no `show:` is declared" in entry["show_failure"]


# --- the record travels into the run bundle and its surfaces ----------------


def test_the_run_bundle_captures_the_judgement_record_and_the_cert_renders_it(
    repo, capsys, monkeypatch
):
    """End to end: judge --without-display, verify, deliver — and the fact
    renders wherever the note renders (certificate face and mr.md), from the
    RECORD, never a live re-read."""
    accept = pytest.importorskip("wringer.accept")
    from wringer import cli as engine_cli

    (repo / ".wringer.yaml").write_text(
        CONFIG_NO_SHOW
        + 'deliver:\n  branch: "wringer/{run}"\n',
        encoding="utf-8",
    )
    assert main(["judge", str(repo), "--id", "heading-reads-as-mine",
                 "--verdict", "met", "--note", "I looked at it on my screen.",
                 "--without-display"]) == 0

    monkeypatch.chdir(repo)
    assert engine_cli.main(["verify"]) == engine_cli.EXIT_OK
    capsys.readouterr()

    runs = sorted((repo / ".wringer" / "runs").iterdir())
    record = accept.read_judgement_record(runs[-1])
    assert record is not None, "the run bundle captured no judgement record"
    assert record["source_schema_version"] == "wringer.judgement.v2"
    assert record["entries"][0]["judged_without_display"] is True
    # The REAL written sibling against its published schema — the roundtrip
    # guard's EXCLUDED reason names this validation.
    jsonschema = pytest.importorskip("jsonschema")
    jsonschema.validate(
        json.loads(
            (runs[-1] / accept.JUDGEMENT_RECORD_FILENAME).read_text("utf-8")
        ),
        json.loads(
            (Path(__file__).resolve().parents[2] / "schema"
             / "judgement-record.schema.json").read_text("utf-8")
        ),
    )

    from wringer import certificate

    built = certificate.build(
        repo, runs[-1], title="t", branch="b", base="main", head_sha=None,
        files_changed=0, spec_sha256=None, run_relative=runs[-1].name,
    )
    assert built is not None
    face = certificate.render(built, judgement_record=record)
    assert "Judged WITHOUT DISPLAY" in face
    assert "I looked at it on my screen." in face
    assert "no `show:` is declared" in face, (
        "the show surface's own words render where the note renders"
    )


def test_a_run_with_no_judgements_writes_NO_record(repo, capsys, monkeypatch):
    accept = pytest.importorskip("wringer.accept")
    from wringer import cli as engine_cli

    (repo / ".wringer.yaml").write_text(CONFIG_NO_SHOW, encoding="utf-8")
    monkeypatch.chdir(repo)
    assert engine_cli.main(["verify"]) == engine_cli.EXIT_OK
    capsys.readouterr()

    runs = sorted((repo / ".wringer" / "runs").iterdir())
    assert not (runs[-1] / accept.JUDGEMENT_RECORD_FILENAME).exists(), (
        "absent is absent — an empty record is a claim the question was asked"
    )


def test_the_board_card_says_JUDGED_WITHOUT_DISPLAY(repo, capsys, monkeypatch):
    from wringer import cli as engine_cli
    from wringer_board import cards, read

    (repo / ".wringer.yaml").write_text(CONFIG_NO_SHOW, encoding="utf-8")
    assert main(["judge", str(repo), "--id", "heading-reads-as-mine",
                 "--verdict", "met", "--note", "Fine by me.",
                 "--without-display"]) == 0
    monkeypatch.chdir(repo)
    assert engine_cli.main(["verify"]) == engine_cli.EXIT_OK
    capsys.readouterr()

    board = read.read(repo)
    criterion = next(c for c in board.criteria if c.id == "heading-reads-as-mine")
    assert criterion.judged_without_display is True
    card = cards.card_for(board, criterion)
    assert "WITHOUT the product showing them" in (card.question or "")


# --- a v1 file keeps working -------------------------------------------------


def test_a_v1_judgements_file_is_still_read_and_the_next_write_is_v2(repo):
    accept = pytest.importorskip("wringer.accept")
    spec = pytest.importorskip("wringer.spec")

    criterion = next(
        c for c in spec.load(repo / "wringer.spec.yaml").criteria
        if c.id == "heading-reads-as-mine"
    )
    digest = accept.criterion_digest(criterion)
    (repo / judge_module.JUDGEMENTS_FILENAME).write_text(
        "schema_version: wringer.judgement.v1\n"
        "judgements:\n"
        '  - criterion: "heading-reads-as-mine"\n'
        "    verdict: met\n"
        '    by: "Old Hand"\n'
        '    at: "2026-08-28T10:00:00+00:00"\n'
        f"    criterion_digest: {digest}\n",
        encoding="utf-8",
    )
    assert accept.read_judgements(repo)["heading-reads-as-mine"]["by"] == "Old Hand"

    (repo / ".wringer.yaml").write_text(
        config_showing("echo shown"), encoding="utf-8"
    )
    assert main(["judge", str(repo), "--id", "heading-reads-as-mine",
                 "--verdict", "not_met", "--note", "Changed my mind."]) == 0
    record = written(repo)
    assert record["schema_version"] == "wringer.judgement.v2"
    assert len(record["judgements"]) == 1
