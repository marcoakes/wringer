"""One delivery, one story (0.6.2) — run 3, F13/F14/F15, P0.5–P0.6.

The acceptance bar for this slice is the run-3 report's own words: *"the
stale-board contradiction must be unconstructable."* The delivered
certificate said 1 of 7 proved and the human judgement MET; the delivered
board — copied from a root file — said none proved, judgement pending, and
rendered an old run. These tests replay that shape and drive the real
commands, the house rule.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

# The delivery fixtures live in test_deliver; imported rather than copied so
# the two files cannot drift about what a deliverable repo is. Importing a
# pytest fixture binds it into this module's collection, the house pattern.
from test_deliver import (  # noqa: F401
    CONFIG,
    accepting_repo,
    delivery_repo,
    verified,
)

from wringer import certificate, cli, deliver


def _delivered(repo: Path) -> Path:
    entries = sorted((repo / ".wringer" / "deliveries").iterdir())
    assert entries, "no delivery directory"
    return entries[0]


# --- F13: the stale-board contradiction is unconstructable ------------------


def test_A_STALE_ROOT_BOARD_CANNOT_REACH_THE_DELIVERY(
    delivery_repo, monkeypatch, capsys
):
    """Run 3's F13, replayed: a root `board.html` naming an OLD run sits on
    disk at deliver time. The delivered page must name the DELIVERED run —
    the root page is not consulted at all — and the root file is untouched."""
    accepting_repo(delivery_repo, bound=False)
    stale = (
        "<html><body>this page renders run "
        "<code>19990101-000000-dead</code> — the newest record in the "
        "repository</body></html>"
    )
    # BEFORE the verify, so the tree the run snapshots already carries it —
    # exactly run 3's shape: the stale page had been sitting there since an
    # earlier round.
    (delivery_repo / "board.html").write_text(stale, encoding="utf-8")
    verified(delivery_repo, monkeypatch, capsys)

    assert cli.main(["deliver"]) == cli.EXIT_OK
    capsys.readouterr()

    written = _delivered(delivery_repo)
    page = (written / certificate.BOARD_FILENAME).read_text(encoding="utf-8")
    run_id = json.loads(
        (written / "manifest.json").read_text(encoding="utf-8")
    )["run_dir"].rsplit("/", 1)[-1]
    assert run_id in page, "the delivered page does not name the delivered run"
    assert "19990101-000000-dead" not in page, (
        "the stale root page's run leaked into the delivery — F13 again"
    )
    assert "the record its caller selected" in page, (
        "the page does not say a caller selected its run, so a reader would "
        "believe the recency sentence"
    )
    assert (delivery_repo / "board.html").read_text(encoding="utf-8") == stale, (
        "the delivery rewrote the operator's own root page"
    )


def test_the_delivered_board_meta_matches_the_certificate(
    delivery_repo, monkeypatch, capsys
):
    """P2.3's self-test, as a guard: the portable page's machine-readable
    meta and certificate.json agree about the run and the counts."""
    accepting_repo(delivery_repo, bound=False)
    verified(delivery_repo, monkeypatch, capsys)
    assert cli.main(["deliver"]) == cli.EXIT_OK
    capsys.readouterr()

    written = _delivered(delivery_repo)
    page = (written / certificate.BOARD_FILENAME).read_text(encoding="utf-8")
    meta = deliver._board_meta(page)
    assert meta is not None, "the delivered page carries no boardmeta block"
    record = json.loads(
        (written / certificate.RECORD_FILENAME).read_text(encoding="utf-8")
    )
    assert meta["run_id"] == record["run"]["id"]
    assert meta["counts"] == record["acceptance"]["counts"]
    assert meta["selected"] is True


def test_a_board_that_would_tell_a_second_story_REFUSES_the_delivery(
    delivery_repo, monkeypatch, capsys
):
    """`delivery_surface_mismatch`'s taken path, through `wring deliver`.

    The render is forced to describe a different run — the exact F13 shape,
    reconstructed at the only place it could still arise (a broken or
    tampered renderer) — and the delivery refuses with the named reason,
    exit 3, a refusal record, and nothing created."""
    accepting_repo(delivery_repo, bound=False)
    verified(delivery_repo, monkeypatch, capsys)

    real = deliver._board_rendered

    def lying(root, run_dir):
        name, page = real(root, run_dir)
        assert page is not None, "the fixture could not render a page at all"
        return name, page.replace(run_dir.name, "19990101-000000-dead")

    monkeypatch.setattr(deliver, "_board_rendered", lying)

    assert cli.main(["deliver"]) == cli.EXIT_REFUSED
    said = capsys.readouterr().err
    assert "more than one story" in said
    assert "19990101-000000-dead" in said
    assert not (delivery_repo / ".wringer" / "deliveries").exists(), (
        "a refused delivery left a delivery directory behind"
    )
    refusals = sorted((delivery_repo / ".wringer" / "refusals").iterdir())
    record = json.loads(
        (refusals[-1] / "refusal.json").read_text(encoding="utf-8")
    )
    assert record["reason"] == "delivery_surface_mismatch"


def test_a_delivery_with_NO_board_is_not_a_mismatch(
    delivery_repo, monkeypatch, capsys
):
    """Absence is stated, never punished: a machine where the board surface
    cannot render still delivers, and mr.md says the page is missing."""
    accepting_repo(delivery_repo, bound=False)
    verified(delivery_repo, monkeypatch, capsys)
    monkeypatch.setattr(
        deliver, "_board_rendered", lambda root, run_dir: (None, None)
    )

    assert cli.main(["deliver"]) == cli.EXIT_OK
    capsys.readouterr()

    written = _delivered(delivery_repo)
    assert not (written / certificate.BOARD_FILENAME).exists()
    mr = (written / deliver.MR_FILENAME).read_text(encoding="utf-8")
    assert "could not be rendered" in mr


# --- F14: summary.md travels ------------------------------------------------


def test_the_summary_TRAVELS_and_is_digested_and_the_promise_is_true(
    delivery_repo, monkeypatch, capsys
):
    accepting_repo(delivery_repo, bound=False)
    verified(delivery_repo, monkeypatch, capsys)
    assert cli.main(["deliver"]) == cli.EXIT_OK
    capsys.readouterr()

    written = _delivered(delivery_repo)
    travelled = written / "summary.md"
    assert travelled.is_file(), (
        "mr.md promises a summary and the delivery does not carry one — F14"
    )
    digests = json.loads(
        (written / "digests.json").read_text(encoding="utf-8")
    )
    assert "summary.md" in digests["files"], "the travelling summary is undigested"
    mr = (written / deliver.MR_FILENAME).read_text(encoding="utf-8")
    assert "travels in this directory" in mr


# --- F15: the red receipt travels and the clean clone can check it ----------


def _proved_repo(delivery_repo, monkeypatch, capsys):
    """A repo with one PROVED criterion: a bound gate that genuinely
    discriminates, recorded red first, then green — the red-first receipt
    the certificate will cite and the delivery must carry."""
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
    # Committed, so the clean clone the audit runs in carries the spec and
    # the config — run 3's real shape, where both were in the delivered
    # branch and only the RUN had stayed behind.
    subprocess.run(["git", "add", "-A"], cwd=delivery_repo, check=True)
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@e.invalid",
         "-c", "commit.gpgsign=false", "commit", "-qm", "spec and gate"],
        cwd=delivery_repo, check=True,
    )
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    (delivery_repo / "flag.txt").write_text("FIXED\n", encoding="utf-8")
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()


def test_the_RED_RECEIPT_travels_and_a_clean_clone_checks_every_PROVED_claim(
    delivery_repo, monkeypatch, capsys, tmp_path
):
    """The acceptance bar from the report, verbatim: *"A clean clone audits
    every PROVED claim, including the red receipt, with no unavailable
    claims."* Run 3's audit said `run … did not travel with this document,
    so nothing here can look` — this clone carries the receipt and looks."""
    _proved_repo(delivery_repo, monkeypatch, capsys)
    assert cli.main(["deliver"]) == cli.EXIT_OK
    capsys.readouterr()

    written = _delivered(delivery_repo)
    record = json.loads(
        (written / certificate.RECORD_FILENAME).read_text(encoding="utf-8")
    )
    cited = [
        row for row in record["requirements"]
        if isinstance(row.get("receipt"), dict)
    ]
    assert cited, "the fixture proved nothing, so this test checks nothing"
    packs = written / "receipts"
    assert packs.is_dir(), "no receipts travelled — F15"

    # The clean clone: the repository's committed state, plus the delivery
    # directory handed over beside it — exactly run 3's audit shape.
    clone = tmp_path / "clean-clone"
    subprocess.run(
        ["git", "clone", "-q", str(delivery_repo), str(clone)], check=True
    )
    handed = tmp_path / "handed-over"
    shutil.copytree(written, handed)

    monkeypatch.chdir(clone)
    assert cli.main(
        ["audit", str(handed / certificate.RECORD_FILENAME)]
    ) == cli.EXIT_OK
    said = capsys.readouterr().out
    assert "could NOT be checked" not in said, (
        "the clean clone still has unavailable claims:\n" + said
    )
    assert "from the receipt this delivery carries" in said


def _handed_over(delivery_repo, monkeypatch, capsys, tmp_path):
    _proved_repo(delivery_repo, monkeypatch, capsys)
    assert cli.main(["deliver"]) == cli.EXIT_OK
    capsys.readouterr()
    handed = tmp_path / "handed-over"
    shutil.copytree(_delivered(delivery_repo), handed)
    clone = tmp_path / "clean-clone"
    subprocess.run(
        ["git", "clone", "-q", str(delivery_repo), str(clone)], check=True
    )
    return handed, clone


def test_a_receipt_file_ALTERED_after_packing_is_BROKEN(
    delivery_repo, monkeypatch, capsys, tmp_path
):
    """The DIGEST check's own vector, and only its: a gate result edited,
    the ledger untouched — so nothing but the digest row can notice. Its
    red-watch neuters the digest comparison alone and this must go red."""
    handed, clone = _handed_over(delivery_repo, monkeypatch, capsys, tmp_path)
    pack = next((handed / "receipts").iterdir())
    result = next(pack.glob("gates/*/result.json"))
    edited = result.read_text(encoding="utf-8").replace(
        '"status"', '"status_"', 1
    )
    result.write_text(edited, encoding="utf-8")

    monkeypatch.chdir(clone)
    assert cli.main(
        ["audit", str(handed / certificate.RECORD_FILENAME)]
    ) == cli.EXIT_GATE_FAILED
    said = capsys.readouterr().out
    assert "does not match the digest" in said


def test_a_receipt_LEDGER_whose_chain_does_not_link_is_BROKEN(
    delivery_repo, monkeypatch, capsys, tmp_path
):
    """The CHAIN walk's own vector, and only its: a ledger line altered AND
    the pack's digest row updated to match the new bytes — the shape a
    tamperer who knows about digests.json would leave. Only the prev_hash
    walk can notice. Its red-watch neuters the chain walk alone."""
    handed, clone = _handed_over(delivery_repo, monkeypatch, capsys, tmp_path)
    import hashlib

    pack = next((handed / "receipts").iterdir())
    ledger = pack / "evidence.jsonl"
    lines = ledger.read_text(encoding="utf-8").splitlines()
    event = json.loads(lines[1])
    event["ts"] = "1999-01-01T00:00:00.000+00:00"
    lines[1] = json.dumps(event, separators=(", ", ": "))
    rewritten = "\n".join(lines) + "\n"
    ledger.write_text(rewritten, encoding="utf-8")
    digests_path = pack / "digests.json"
    digests = json.loads(digests_path.read_text(encoding="utf-8"))
    digests["files"]["evidence.jsonl"] = hashlib.sha256(
        rewritten.encode("utf-8")
    ).hexdigest()
    digests_path.write_text(
        json.dumps(digests, indent=2) + "\n", encoding="utf-8"
    )

    monkeypatch.chdir(clone)
    assert cli.main(
        ["audit", str(handed / certificate.RECORD_FILENAME)]
    ) == cli.EXIT_GATE_FAILED
    said = capsys.readouterr().out
    assert "does not link" in said


def test_a_packed_receipt_can_NEVER_earn_an_acceptance_tick(
    delivery_repo, monkeypatch, capsys
):
    """The corpus's lesson, kept: a travelled copy decides nothing. The
    constructed bundle says committed=True, and `qualifying` refuses it."""
    from wringer import health

    bundle = health.Bundle(
        directory=Path("."),
        receipt="x",
        kind="run",
        run_id="x",
        started_at="",
        bench_sourced=False,
        source="delivery-receipts",
        committed=True,
    )
    assert bundle.qualifying is False


# --- the board's new doors ---------------------------------------------------


def test_wringer_board_render_run_selects_the_record(
    delivery_repo, monkeypatch, capsys
):
    from wringer_board.__main__ import main as board_main

    accepting_repo(delivery_repo, bound=False)
    verified(delivery_repo, monkeypatch, capsys)
    runs = sorted((delivery_repo / ".wringer" / "runs").iterdir())
    first = runs[0]
    # a second, newer run — recency would pick this one
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    out = delivery_repo / "selected.html"
    assert board_main(
        ["render", str(delivery_repo), "--run", str(first), "-o", str(out)]
    ) == 0
    capsys.readouterr()
    page = out.read_text(encoding="utf-8")
    assert first.name in page
    assert "the record its caller selected" in page
    assert "the newest record in the repository" not in page


def test_the_recency_page_still_says_newest(delivery_repo, monkeypatch, capsys):
    from wringer_board.__main__ import main as board_main

    accepting_repo(delivery_repo, bound=False)
    verified(delivery_repo, monkeypatch, capsys)
    out = delivery_repo / "newest.html"
    assert board_main(["render", str(delivery_repo), "-o", str(out)]) == 0
    capsys.readouterr()
    assert "the newest record in the repository" in out.read_text(
        encoding="utf-8"
    )


# --- ruling 12: the banner ---------------------------------------------------


def test_MOVED_authority_documents_render_OUT_OF_DATE_across_the_board(
    delivery_repo, monkeypatch, capsys
):
    """The spec's marker retires only because this exists. A loop is run so
    `briefed.json` records the authorising documents; the spec is then
    reworded; the board renders OUT OF DATE naming the moved document."""
    from wringer_board import read as read_module
    from wringer_board import render as render_module

    accepting_repo(delivery_repo, bound=False)
    (delivery_repo / ".wringer.yaml").write_text(
        (delivery_repo / ".wringer.yaml").read_text(encoding="utf-8")
        + 'run:\n  worker: ": {brief}; true"\n  max_iterations: 1\n',
        encoding="utf-8",
    )
    monkeypatch.chdir(delivery_repo)
    assert cli.main(["run"]) in (cli.EXIT_OK, cli.EXIT_GATE_FAILED)
    capsys.readouterr()
    loops = sorted((delivery_repo / ".wringer" / "loops").iterdir())
    assert (loops[-1] / "briefed.json").is_file(), (
        "the loop recorded no briefed.json, so this guard would be vacuous"
    )

    spec_path = delivery_repo / "wringer.spec.yaml"
    spec_path.write_text(
        spec_path.read_text(encoding="utf-8") + "# reworded after the loop\n",
        encoding="utf-8",
    )

    board = read_module.read(delivery_repo)
    assert board.staleness_moved, "the comparison saw nothing move"
    page = render_module.render(board)
    assert "OUT OF DATE" in page
    assert "wringer.spec.yaml" in page


def test_NO_briefed_record_means_SILENCE_about_staleness(
    delivery_repo, monkeypatch, capsys
):
    from wringer_board import read as read_module
    from wringer_board import render as render_module

    accepting_repo(delivery_repo, bound=False)
    verified(delivery_repo, monkeypatch, capsys)

    board = read_module.read(delivery_repo)
    assert board.staleness_moved is None
    assert "OUT OF DATE" not in render_module.render(board)
