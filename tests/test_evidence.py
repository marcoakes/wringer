"""Run ids and the evidence writer."""

from __future__ import annotations

import json
import os
import re
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest

from wringer import evidence
from wringer.git import RepoState

RUN_ID = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{4}$")

NOW = datetime(2026, 7, 30, 8, 6, 1, 123456, tzinfo=timezone(timedelta(hours=1)))


def stamp(path: Path, when: datetime) -> None:
    """Give a run directory a real mtime.

    Pass an AWARE datetime. Run ids are UTC and every ordering source is
    reduced to epoch seconds, so a naive datetime here would silently mean
    "local" and make these tests pass or fail depending on the machine's
    timezone — which is the exact bug (AC-03) they exist to pin down.
    """
    assert when.tzinfo is not None, "stamp() needs an aware datetime"
    epoch = when.timestamp()
    os.utime(path, (epoch, epoch))


def test_run_id_has_the_spec_shape():
    run_id = evidence.new_run_id(NOW)
    assert RUN_ID.match(run_id), run_id
    # 08:06:01+01:00 is 07:06:01 UTC, and the id is stamped in UTC — see the
    # timezone-invariance test below for why.
    assert run_id.startswith("20260730-070601-")


def test_run_ids_are_the_same_wherever_the_clock_is_set():
    """The AC-03 assertion, verbatim from the field report.

    A container has no reason to share its host's timezone; this project's
    own image resolves to Etc/UTC. On 2026-08-05 a container run that
    happened twenty minutes AFTER a host run of the same repository got an id
    sorting forty minutes BEFORE it, because both were stamped in local time:

        host       20260805-102717-3470   started_at +01:00   (10:27 wall)
        container  20260805-094741-56d0   started_at +00:00   (10:47 wall)

    `run_id` is the directory name, so anything ordering runs lexically
    disagreed with `ls -t`. The id must name one instant, not one instant as
    seen from wherever the process happened to be standing.
    """
    instant = datetime(2026, 8, 5, 9, 47, 41, tzinfo=UTC)

    in_bst = evidence.new_run_id(instant.astimezone(timezone(timedelta(hours=1))))
    in_utc = evidence.new_run_id(instant.astimezone(UTC))
    in_tokyo = evidence.new_run_id(instant.astimezone(timezone(timedelta(hours=9))))

    stamps = {run_id.rsplit("-", 1)[0] for run_id in (in_bst, in_utc, in_tokyo)}
    assert stamps == {"20260805-094741"}


def test_run_ids_differ_within_the_same_second():
    ids = {evidence.new_run_id(NOW) for _ in range(50)}
    assert len(ids) > 1


def test_create_makes_a_fresh_directory(tmp_path: Path):
    bundle = evidence.Bundle.create(tmp_path / ".wringer" / "runs", now=NOW)
    assert bundle.directory.is_dir()
    assert bundle.directory.name == bundle.run_id
    assert bundle.directory.parent == tmp_path / ".wringer" / "runs"
    assert not any(bundle.directory.iterdir())  # nothing written yet


def test_create_regenerates_the_id_on_collision(tmp_path: Path, monkeypatch):
    suffixes = iter(["beef", "beef", "cafe"])
    monkeypatch.setattr(evidence.secrets, "token_hex", lambda _: next(suffixes))

    first = evidence.Bundle.create(tmp_path, now=NOW)
    second = evidence.Bundle.create(tmp_path, now=NOW)

    assert first.run_id.endswith("-beef")
    assert second.run_id.endswith("-cafe")
    assert first.directory != second.directory


def test_create_gives_up_rather_than_reusing_a_directory(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(evidence.secrets, "token_hex", lambda _: "beef")
    evidence.Bundle.create(tmp_path, now=NOW)

    with pytest.raises(evidence.EvidenceError):
        evidence.Bundle.create(tmp_path, now=NOW)


def test_latest_run_is_the_newest_not_the_alphabetically_last(tmp_path: Path):
    """Two runs in the same second are ordered by a random suffix, not a
    counter — so the id alone can call an older run the latest one. That is
    exactly what a verify-fix-verify loop produces."""
    runs = tmp_path / "runs"
    runs.mkdir()
    earlier = runs / "20260730-201936-ffff"  # lexically last, chronologically first
    later = runs / "20260730-201936-0000"
    earlier.mkdir()
    later.mkdir()
    os.utime(earlier, (1, 1))
    os.utime(later, (2, 2))

    assert evidence.latest_run(runs) == later


def test_latest_run_prefers_a_newer_second_over_mtime(tmp_path: Path):
    runs = tmp_path / "runs"
    runs.mkdir()
    older_second = runs / "20260730-201936-ffff"
    newer_second = runs / "20260730-201937-0000"
    older_second.mkdir()
    newer_second.mkdir()
    os.utime(older_second, (9, 9))  # a misleading mtime must not win
    os.utime(newer_second, (2, 2))

    assert evidence.latest_run(runs) == newer_second


def test_latest_run_is_not_hijacked_by_a_manual_name(tmp_path: Path):
    """`--output` lets a caller name a directory anything, and QUICKSTART
    teaches exactly that. Compared as text, "manual-001" outranks every real
    run id forever ("m" > "2"), so `wring explain` would keep diagnosing it
    however many newer runs landed."""
    runs = tmp_path / "runs"
    runs.mkdir()
    manual = runs / "manual-001"
    later = runs / "20260730-201936-0000"
    manual.mkdir()
    later.mkdir()
    # the manual run happened first, six seconds before the real one
    stamp(manual, datetime(2026, 7, 30, 20, 19, 30, tzinfo=UTC))
    stamp(later, datetime(2026, 7, 30, 20, 19, 36, tzinfo=UTC))

    assert evidence.latest_run(runs) == later


def test_latest_run_still_picks_a_manual_run_when_it_is_the_newest(tmp_path: Path):
    """A directory whose name is not a run id is dated by its mtime — which
    means it can win, it just cannot win by spelling."""
    runs = tmp_path / "runs"
    runs.mkdir()
    earlier = runs / "20260730-201936-0000"
    manual = runs / "manual-001"
    earlier.mkdir()
    manual.mkdir()
    stamp(earlier, datetime(2026, 7, 30, 20, 19, 36, tzinfo=UTC))
    stamp(manual, datetime(2026, 7, 30, 20, 19, 40, tzinfo=UTC))

    assert evidence.latest_run(runs) == manual


def test_latest_run_believes_the_manifest_over_the_directory_name(
    tmp_path: Path,
):
    """Belt and braces for AC-03. Stamping ids in UTC is the fix; not
    ordering on the id at all is what makes the fix unnecessary next time.

    Here the names say one thing and the runs' own records say the opposite —
    which is exactly the shape of a directory holding one bundle written
    before the UTC change and one written after. `started_at` carries an
    offset, so it can be believed; a name cannot.
    """
    runs = tmp_path / "runs"
    runs.mkdir()
    looks_newer = runs / "20260805-102717-3470"  # name sorts last
    really_newer = runs / "20260805-094741-56d0"  # ran 20 minutes later
    for directory, started in (
        (looks_newer, "2026-08-05T10:27:17+01:00"),  # 09:27 UTC
        (really_newer, "2026-08-05T09:47:41+00:00"),  # 09:47 UTC
    ):
        directory.mkdir()
        (directory / evidence.MANIFEST_FILENAME).write_text(
            json.dumps({"started_at": started}), encoding="utf-8"
        )
    # mtimes deliberately agree with the names, not the truth, so only the
    # manifest can get this right.
    os.utime(really_newer, (1, 1))
    os.utime(looks_newer, (2, 2))

    assert evidence.latest_run(runs) == really_newer


def test_a_run_with_no_record_is_still_dated_in_utc(tmp_path: Path):
    """The case the first attempt at this got wrong, in both directions.

    A directory with no record falls back to the timestamp in its id. Ids are
    UTC, so the fallback must read UTC — the first version kept the old local
    parse "to preserve behaviour" and thereby misdated every record-less
    directory by the host's offset. East of UTC that hides a newer run;
    west of UTC an abandoned one outranks its successors.

    Not a corner case. A loop KILLED mid-flight never reaches
    `loop.write_manifest`, and killed loops are the only thing `wring resume`
    exists for.
    """
    runs = tmp_path / "runs"
    runs.mkdir()
    # 09:47:41 UTC — no manifest, so the id is all there is.
    crashed = runs / "20260805-094741-56d0"
    crashed.mkdir()
    os.utime(crashed, (1, 1))  # a useless mtime, like a killed process leaves

    # A complete run one minute later, by its own record.
    finished = runs / "20260805-094841-0000"
    finished.mkdir()
    (finished / evidence.MANIFEST_FILENAME).write_text(
        json.dumps({"started_at": "2026-08-05T10:48:41+01:00"}), encoding="utf-8"
    )
    os.utime(finished, (2, 2))

    assert evidence.latest_run(runs) == finished

    # And the other way round: the record-less one really is newer.
    later_crash = runs / "20260805-095000-abcd"
    later_crash.mkdir()
    os.utime(later_crash, (3, 3))
    assert evidence.latest_run(runs) == later_crash


def test_latest_run_reads_a_judge_verdicts_own_record(tmp_path: Path):
    """`wring judge` writes `verdict.json`, not `manifest.json`, and `wring
    deliver` orders those directories with this same function. Looking only
    for a manifest meant every verdict fell through to the id — 100% of the
    time, for a whole command."""
    verdicts = tmp_path / "verdicts"
    verdicts.mkdir()
    looks_newer = verdicts / "20260805-102717-3470"
    really_newer = verdicts / "20260805-094741-56d0"
    for directory, started in (
        (looks_newer, "2026-08-05T10:27:17+01:00"),  # 09:27 UTC
        (really_newer, "2026-08-05T09:47:41+00:00"),  # 09:47 UTC
    ):
        directory.mkdir()
        (directory / "verdict.json").write_text(
            json.dumps({"started_at": started}), encoding="utf-8"
        )
    os.utime(really_newer, (1, 1))
    os.utime(looks_newer, (2, 2))

    assert evidence.latest_run(verdicts) == really_newer


def test_latest_run_survives_a_manifest_it_cannot_read(tmp_path: Path):
    """An ordering key must be total. A bundle too damaged to parse still
    has an mtime, and refusing to list runs because one is corrupt would be
    the wrong trade for `wring explain`."""
    runs = tmp_path / "runs"
    runs.mkdir()
    broken = runs / "20260805-094741-56d0"
    broken.mkdir()
    (broken / evidence.MANIFEST_FILENAME).write_text("{not json", encoding="utf-8")

    assert evidence.latest_run(runs) == broken


def test_latest_run_with_no_runs_is_none(tmp_path: Path):
    assert evidence.latest_run(tmp_path / "nothing-here") is None


def test_at_clears_what_the_previous_run_left(tmp_path: Path):
    """One directory describes one run. A stale `result.json` is read
    straight back by `wring explain`, which is how a bundle ends up calling
    a gate passed on the same screen its summary calls it skipped."""
    directory = tmp_path / "manual-001"
    first = evidence.Bundle.at(directory, now=NOW)
    first.event("run.started", run_id=first.run_id)
    for filename in (
        evidence.MANIFEST_FILENAME,
        evidence.SUMMARY_FILENAME,
        evidence.DIFF_FILENAME,
        evidence.STATUS_FILENAME,
    ):
        (directory / filename).write_text("last run's", encoding="utf-8")
    stale = first.gate_dir(2, "test")
    (stale / evidence.RESULT_FILENAME).write_text('{"status": "passed"}', "utf-8")
    mine = directory / "notes.txt"
    mine.write_text("the caller's own file", encoding="utf-8")

    evidence.Bundle.at(directory, now=NOW)

    assert not (directory / evidence.EVIDENCE_FILENAME).exists()
    assert not (directory / evidence.MANIFEST_FILENAME).exists()
    assert not (directory / evidence.SUMMARY_FILENAME).exists()
    assert not (directory / evidence.DIFF_FILENAME).exists()
    assert not (directory / evidence.STATUS_FILENAME).exists()
    assert not stale.exists()
    # the directory belongs to the caller: only Wringer's artifacts go
    assert mine.read_text(encoding="utf-8") == "the caller's own file"


def test_the_ledger_is_a_chain_not_a_list(tmp_path: Path):
    """Each line carries the hash of the whole line before it, so the order
    is cryptographically fixed rather than merely written down."""
    import hashlib

    bundle = evidence.Bundle.create(tmp_path, now=NOW)
    for n in range(4):
        bundle.event("gate.finished", gate_id=f"g{n}", exit_code=0, duration_ms=n)

    lines = (
        (bundle.directory / evidence.EVIDENCE_FILENAME)
        .read_bytes()
        .splitlines()
    )
    events = [json.loads(line) for line in lines]

    assert events[0]["prev_hash"] == evidence.GENESIS_HASH
    for previous, event in zip(lines, events[1:], strict=False):
        assert event["prev_hash"] == hashlib.sha256(previous).hexdigest()


def test_an_edited_ledger_breaks_its_chain(tmp_path: Path):
    """The whole point: a silent edit stops being silent. This is what
    `wring audit` will one day check — the field is written now because
    adding it later would cost a version bump on every bundle in the world.
    """
    import hashlib

    bundle = evidence.Bundle.create(tmp_path, now=NOW)
    bundle.event("gate.finished", gate_id="honest", exit_code=1, duration_ms=1)
    bundle.event("run.finished", status="failed", failed_gate="honest")

    ledger = bundle.directory / evidence.EVIDENCE_FILENAME
    lines = ledger.read_bytes().splitlines()
    # someone rewrites history: the failure becomes a pass
    lines[0] = lines[0].replace(b'"exit_code": 1', b'"exit_code": 0')
    ledger.write_bytes(b"\n".join(lines) + b"\n")

    events = [json.loads(line) for line in ledger.read_bytes().splitlines()]
    recomputed = hashlib.sha256(ledger.read_bytes().splitlines()[0]).hexdigest()

    assert events[1]["prev_hash"] != recomputed, "the tamper went undetected"


def test_the_chain_head_of_an_absent_ledger_is_genesis(tmp_path: Path):
    assert evidence.chain_head(tmp_path / "nothing.jsonl") == evidence.GENESIS_HASH


def test_gate_dir_is_named_for_the_declared_position(tmp_path: Path):
    bundle = evidence.Bundle.create(tmp_path, now=NOW)

    third = bundle.gate_dir(3, "test")

    assert third.is_dir()
    # NNN follows the config, not the run — a --gate run keeps its number
    assert third.relative_to(bundle.directory).as_posix() == "gates/003_test"
    assert bundle.relative(third / "stdout.log") == "gates/003_test/stdout.log"


def test_events_append_one_json_object_per_line(tmp_path: Path):
    bundle = evidence.Bundle.create(tmp_path, now=NOW)
    bundle.event("run.started", run_id=bundle.run_id, sha=None)
    bundle.event("gate.finished", gate_id="test", exit_code=1, duration_ms=9231)

    lines = (
        (bundle.directory / evidence.EVIDENCE_FILENAME)
        .read_text(encoding="utf-8")
        .splitlines()
    )
    recorded = [json.loads(line) for line in lines]
    stamps = [event.pop("ts") for event in recorded]
    chain = [event.pop("prev_hash") for event in recorded]
    assert recorded == [
        {"type": "run.started", "run_id": bundle.run_id, "sha": None},
        {
            "type": "gate.finished",
            "gate_id": "test",
            "exit_code": 1,
            "duration_ms": 9231,
        },
    ]
    # the chain links each line to the one before it: the first is genesis,
    # and each later link is the sha256 of the previous whole line
    assert chain[0] == evidence.GENESIS_HASH
    assert len(set(chain)) == len(chain)
    # every event is placeable in time, and in order
    parsed = [datetime.fromisoformat(stamp) for stamp in stamps]
    assert all(stamp.tzinfo is not None for stamp in parsed)
    assert parsed == sorted(parsed)


def test_events_scrub_secrets_inside_lists(tmp_path: Path):
    """Redaction covers the bundle, so it cannot hold for some files in it
    and not others: a path whose *name* carried a secret was reaching
    evidence.jsonl intact while status.txt beside it said [REDACTED]."""
    from wringer.redact import Redactor

    bundle = evidence.Bundle.create(
        tmp_path, now=NOW, redactor=Redactor(("hushhush12345",))
    )

    bundle.event(
        "git.status",
        dirty=True,
        changed_files=["src/hushhush12345.py"],
        untracked=["hushhush12345.txt"],
    )

    written = (bundle.directory / evidence.EVIDENCE_FILENAME).read_text("utf-8")
    assert "hushhush12345" not in written
    recorded = json.loads(written)
    assert recorded["changed_files"] == ["src/[REDACTED].py"]
    assert recorded["untracked"] == ["[REDACTED].txt"]
    assert recorded["dirty"] is True  # non-strings pass through untouched


def test_gate_result_json_is_exactly_the_contract(tmp_path: Path):
    from wringer.config import Gate
    from wringer.gates import GateResult

    bundle = evidence.Bundle.create(tmp_path, now=NOW)
    gate = Gate(id="test", run="make test", timeout=300)
    gate_dir = bundle.gate_dir(2, gate.id)
    result = GateResult(
        gate=gate,
        exit_code=1,
        duration_ms=9231,
        timed_out=False,
        stdout_path=gate_dir / "stdout.log",
        stderr_path=gate_dir / "stderr.log",
    )

    written = bundle.write_gate_result(gate_dir, result)

    assert written == gate_dir / "result.json"
    assert json.loads(written.read_text(encoding="utf-8")) == {
        "gate_id": "test",
        "command": "make test",
        "exit_code": 1,
        "duration_ms": 9231,
        "timed_out": False,
        "stdout_truncated": False,
        "stderr_truncated": False,
        "optional": False,
        "status": "failed",
    }


def test_manifest_matches_the_spec_shape(tmp_path: Path):
    bundle = evidence.Bundle.create(tmp_path, now=NOW)
    state = RepoState(
        root=tmp_path, head_sha="abc123", branch="main", dirty=True
    )
    bundle.write_manifest(state=state, status="failed", failed_gate="test")

    manifest = json.loads(
        (bundle.directory / evidence.MANIFEST_FILENAME).read_text(encoding="utf-8")
    )
    assert manifest == {
        "schema_version": "wringer.evidence.v1",
        "run_id": bundle.run_id,
        # local time with offset, seconds precision
        "started_at": "2026-07-30T08:06:01+01:00",
        "repo": {
            "root": ".",
            "head_sha": "abc123",
            "branch": "main",
            "dirty": True,
        },
        "result": {"status": "failed", "failed_gate": "test"},
    }


def test_reusing_an_output_directory_removes_the_previous_digests(tmp_path: Path):
    """`digests.json` must not outlive the run it describes.

    Every other stale artifact is overwritten by the next run, so the damage
    is bounded. This one is different in kind: it is the bundle's own
    tamper-evidence record, a sha256 of every other file. A survivor
    describes files that are gone and misdescribes the ones that replaced
    them — so it fails against the very bundle it sits in.

    The window is real even though `write_digests()` rebuilds the file at the
    end of a run: a run that is killed, crashes, or loses power AFTER
    `_clear_previous` and BEFORE `write_digests` leaves the previous run's
    digests beside this run's partial files. `wring audit` (P5) reads exactly
    that file to say "and none of it has been altered since", so a survivor
    makes it cry tampering on an honest bundle — the worst possible failure
    for a tool whose product is trust.

    Asserted against the clearing itself rather than through a full verify,
    because a full verify always reaches `write_digests` and would pass with
    or without the fix. (It did: the first version of this test guarded
    nothing.)
    """
    directory = tmp_path / "fixed"
    directory.mkdir()
    stale = directory / evidence.DIGESTS_FILENAME
    stale.write_text('{"files": {"gates/001_gone/stdout.log": "deadbeef"}}', "utf-8")
    (directory / evidence.MANIFEST_FILENAME).write_text("{}", encoding="utf-8")

    evidence.Bundle.at(directory, now=NOW)

    assert not stale.exists(), (
        "last run's digests.json survived into this run's bundle — a "
        "tamper-evidence record that fails against its own contents"
    )


def test_reusing_an_output_directory_removes_the_conditional_siblings(
    tmp_path: Path,
):
    """`vacuity.json`, its logs and `acceptance.json` must not outlive the run.

    Sharper than the stale `result.json` `_clear_previous` was written for,
    because these two are written CONDITIONALLY. A gate result is overwritten
    by the next run of the same gate; a vacuity verdict is written only when
    the run proves, and an acceptance artifact only when an approved spec
    declares criteria. So a reused `--output` whose second run drops the
    condition keeps the FIRST run's verdict beside a bundle that never made
    it — and a surviving `sensitive: true` row is one of the two receipts that
    evidence an acceptance criterion (SPEC_ACCEPT_V0 §3).

    Asserted against the clearing itself for the same reason the digests test
    is: a run that reaches the writers overwrites them either way, so a full
    verify would pass with or without the fix.
    """
    directory = tmp_path / "fixed"
    directory.mkdir()
    (directory / evidence.MANIFEST_FILENAME).write_text("{}", encoding="utf-8")
    verdict = directory / evidence.VACUITY_FILENAME
    verdict.write_text(
        '{"verdict": "proven", "gates": [{"gate_id": "gone", "sensitive": true}]}',
        encoding="utf-8",
    )
    logs = directory / evidence.VACUITY_DIRNAME / "001_gone"
    logs.mkdir(parents=True)
    (logs / "stdout.log").write_text("pre-change output\n", encoding="utf-8")
    accepted = directory / evidence.ACCEPTANCE_FILENAME
    accepted.write_text('{"criteria": [{"id": "c1", "state": "evidenced"}]}', "utf-8")

    evidence.Bundle.at(directory, now=NOW)

    survivors = [
        path.name
        for path in (verdict, accepted, directory / evidence.VACUITY_DIRNAME)
        if path.exists()
    ]
    assert not survivors, (
        f"last run's {survivors} survived into this run's bundle — a verdict "
        "about a run that never happened, and one of them can evidence an "
        "acceptance criterion"
    )


def bundle_filename_constants() -> dict[str, str]:
    """Every `*_FILENAME` the evidence module names, DISCOVERED not typed.

    The scope of the two tests above is hand-picked — `digests.json` in one,
    `vacuity.json` and `acceptance.json` in the other — and so is the tuple
    they guard: `_clear_previous` clears twelve filenames written out by hand.
    Nothing coupled the two, so a thirteenth bundle file could be added, its
    writer shipped, and the clearing forgotten, with this file green the whole
    way. That is the QUICKSTART class (`docs/hunt-2026-08-23.md`): a hand-kept
    list nobody notices going stale.
    """
    return {
        name: value
        for name in dir(evidence)
        if name.endswith("_FILENAME")
        and isinstance(value := getattr(evidence, name), str)
        and name not in NOT_BUNDLE_FILES
    }


#: Names this module owns that are NOT bundle files — excluded from the
#: clearing guard above WITH A REASON, and the exclusion is proven by
#: `test_no_excluded_name_is_ever_written_into_a_bundle` below rather than
#: taken on trust. The engine owns the name so the board can read the file
#: without importing the drive (the layer seam); the drive owns the writing.
NOT_BUNDLE_FILES = {
    "STOP_FILENAME": "the drive's stop record, written beside the journey "
    "record under .wringer/journeys/<id>/ and never into a run bundle (0.9.6, "
    "SOTA item 3)",
    "JOURNEY_FILENAME": "the drive's journey record, written under "
    ".wringer/journeys/<id>/ and never into a run bundle (0.8.0, P1.14)",
    "USAGE_FILENAME": "what the agent said it spent, written by "
    "loop.Bundle.write_usage into a LOOP bundle under .wringer/loops/<id>/ "
    "and never into a run bundle. The name lives here so the board can read "
    "the record without importing wringer.loop, which the layer seam names "
    "as the archetypal violation (0.9.3)",
}


def test_every_excluded_name_says_WHY_it_is_not_a_bundle_file():
    """An exclusion with no reason is a hole with a comment on it."""
    for name, reason in NOT_BUNDLE_FILES.items():
        assert hasattr(evidence, name), f"{name} is excluded and does not exist"
        assert len(reason) > 30, f"{name} is excluded with no real reason"


def test_no_excluded_name_is_ever_written_into_a_bundle(repo, monkeypatch):
    """The exclusion, MEASURED against a REAL run rather than a planted one.

    A name excluded from the clearing guard must genuinely never appear in a
    bundle — otherwise the exclusion is exactly the hole that guard exists to
    catch, wearing a reason. So this drives `wring verify` (which writes a
    real bundle: manifest, ledger, digests, gate results) and the drive's own
    journey writer, then reads what landed where.
    """
    from wringer import cli, config
    from wringer_drive import journey

    (repo / config.CONFIG_FILENAME).write_text(
        'version: 1\ngates:\n  - id: t\n    run: "true"\n', encoding="utf-8"
    )
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK

    journey_id = journey.begin(repo)
    journey.enter(repo, journey_id, "build")
    journey.close(repo, journey_id, "converged")

    landed = {
        path.name
        for path in (repo / evidence.JOURNEYS_DIRNAME).rglob("*")
        if path.is_file()
    }
    assert evidence.JOURNEY_FILENAME in landed, (
        "the writer this exclusion is about wrote nothing, so the exclusion "
        "proves nothing"
    )
    in_bundles = {
        path.name
        for path in (repo / evidence.RUNS_DIRNAME).rglob("*")
        if path.is_file()
    }
    assert evidence.MANIFEST_FILENAME in in_bundles, (
        "no real bundle was written, so this test could not see an excluded "
        "name in one"
    )
    for name in NOT_BUNDLE_FILES:
        assert getattr(evidence, name) not in in_bundles, (
            f"{name} IS written into a bundle — it may not be excluded from "
            "the clearing guard"
        )

def test_every_bundle_filename_the_module_names_is_cleared_from_a_reused_output(
    tmp_path: Path,
):
    """No bundle file may survive into a run that did not write it.

    DERIVED from the module's own constants, so a new bundle file is in this
    test's scope the moment it is named — which is the property the twelve-name
    tuple in `_clear_previous` does not have.

    Every name is planted AT THE ROOT and required to be gone, and the survivor
    set is asserted to be exactly `{result.json}` rather than merely empty.
    Both halves of that equality do work:

    - a new bundle file whose author forgets the tuple joins the survivors and
      the set stops matching — the defect this guard exists for;
    - `result.json` is the one legitimate survivor, because it is only ever
      written under `gates/NNN_<id>/`, which `_clear_previous` removes wholesale
      as a directory. Pinning it rather than skipping it means that if it is
      ever added to the tuple, or ever starts being written at the root, this
      test goes red and asks the author to say which.

    **The first version of this test was VACUOUS and the red-watch caught it.**
    It planted each name at the root AND inside `gates/`, and passed a name if
    either copy was cleared. `gates/` is removed as a whole directory on every
    run, so the second branch was true for every name always — dropping
    `EXECUTION_FILENAME` from the tuple left the suite green. That is the
    "passed for the wrong reason" class this repository reverts each fix to
    check for, and it is recorded here because the shape is easy to rebuild.
    """
    names = bundle_filename_constants()
    survivors = {}
    for attribute, filename in sorted(names.items()):
        directory = tmp_path / attribute
        directory.mkdir()
        root_copy = directory / filename
        root_copy.write_text("last run's bytes\n", encoding="utf-8")

        evidence.Bundle.at(directory, now=NOW)

        if root_copy.exists():
            survivors[attribute] = filename

    assert survivors == {"RESULT_FILENAME": evidence.RESULT_FILENAME}, (
        "the bundle files surviving a reused --output directory are no longer "
        f"exactly the one expected: {survivors}\n"
        "A file here that is not `result.json` survives into a run that never "
        "wrote it, so the previous run's copy sits beside a bundle that never "
        "made it — add it to `_clear_previous` in evidence.py. If "
        "`result.json` has stopped surviving, this guard's reason is stale: "
        "it is absent from the tuple only because it is written under "
        f"`{evidence.GATES_DIRNAME}/`, which is cleared as a directory."
    )

    # The reason above, asserted rather than trusted: a `result.json` written
    # where it really lives IS cleared, so the survivor above is an artefact of
    # planting it somewhere nothing writes it.
    nested = tmp_path / "nested" / evidence.GATES_DIRNAME / "001_gone"
    nested.mkdir(parents=True)
    real = nested / evidence.RESULT_FILENAME
    real.write_text("last run's gate result\n", encoding="utf-8")
    evidence.Bundle.at(tmp_path / "nested", now=NOW)
    assert not real.exists(), (
        "a previous run's gate `result.json` survived, so the reason "
        "`RESULT_FILENAME` is absent from `_clear_previous` no longer holds"
    )


def test_the_cleared_scope_is_wider_than_the_names_the_two_tests_above_pick(
    tmp_path: Path,
):
    """The derivation is USED, and this is the guard that says so.

    Standing law from the self-hunt: nine scopes were derived and only four
    had a test asserting the derived scope is wider than the hand list it
    replaced — and reverting the other five to their tuples reddened nothing
    at all. So a derivation ships with a guard that it is used, or it is
    decoration that a later window can quietly narrow with the suite green.

    Here the hand list is the three filenames the two tests above name between
    them. If `bundle_filename_constants()` ever collapses to those — a rename
    of the `*_FILENAME` convention, a refactor that moves the constants — this
    goes red instead of silently guarding three files and claiming to guard
    every one.
    """
    derived = set(bundle_filename_constants().values())
    picked_by_hand = {
        evidence.DIGESTS_FILENAME,
        evidence.VACUITY_FILENAME,
        evidence.ACCEPTANCE_FILENAME,
    }

    assert picked_by_hand < derived, (
        "the derived bundle-filename scope no longer covers more than the "
        "three names the hand-picked tests above check, so it has stopped "
        f"deriving anything: derived={sorted(derived)}"
    )
    assert len(derived) >= len(picked_by_hand) + 9, (
        "the derived scope shrank — it found "
        f"{len(derived)} bundle filenames and the module defined thirteen "
        "when this guard was written. A constant renamed out of the "
        "`*_FILENAME` convention leaves its file unguarded and this test is "
        f"the only thing that says so: {sorted(derived)}"
    )
