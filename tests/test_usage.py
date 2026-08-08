"""The usage an ACP agent was already reporting, and Wringer was discarding.

ACP agents MAY send a `usage_update` session notification carrying token
counts and, optionally, the agent's own cost with a currency. Those
notifications have reached `acp.py` on every run since the seam shipped, and
every one of them was flattened into a truncated 400-character log line and
lost — `Turn` had no member for it, so nothing downstream could read what the
agent had said about what it spent.

Two rules shape where the numbers may land, and both are refusals:

- **`worker.finished` is `additionalProperties: false` in the PUBLISHED
  `wringer.loop.v1` event schema, and that schema is frozen.** A new field
  there would invalidate every loop bundle written afterwards against the
  format its own manifest claims. So usage rides a SIBLING file,
  `usage.json` — the `vacuity.json` move exactly, and law 7's whole point.
- **What the agent reports is the agent's CLAIM, not Wringer's measurement.**
  It is recorded verbatim, marked unverified, and an agent that reports
  nothing produces an absent file — never a zero, which would be a number
  Wringer made up (SPEC_BENCH_V0 §3c).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from wringer import acp, cli, evidence, loop

AGENT = Path(__file__).resolve().parent / "fake_acp_agent.py"

CONFIG = """\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
run:
  worker:
    acp:
      command: {command}
      args: [{agent}, "{behaviour}"]
  max_iterations: 2
  worker_timeout: 30
"""


def setup(repo: Path, behaviour: str) -> None:
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / ".wringer.yaml").write_text(
        CONFIG.format(
            command=json.dumps(sys.executable),
            agent=json.dumps(str(AGENT)),
            behaviour=behaviour,
        ),
        encoding="utf-8",
    )


def only_loop(repo: Path) -> Path:
    found = sorted((repo / loop.LOOPS_DIRNAME).iterdir())
    assert len(found) == 1, found
    return found[0]


def events(directory: Path) -> list[dict]:
    text = (directory / loop.EVENTS_FILENAME).read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


# --- the wire ---------------------------------------------------------------


def test_a_usage_update_is_parsed_off_the_wire(repo, monkeypatch, capsys):
    """Through a real subprocess speaking real JSON-RPC, like every other ACP
    test here — the point is the wire, not the author's idea of it."""
    setup(repo, "usage")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()

    recorded = json.loads(
        (only_loop(repo) / loop.USAGE_FILENAME).read_text(encoding="utf-8")
    )
    assert recorded["schema_version"] == loop.USAGE_SCHEMA_VERSION
    assert recorded["rows"], recorded
    first = recorded["rows"][0]
    assert first["used"] == 1234
    assert first["size"] == 200000
    assert first["cost"] == {"amount": 0.0412, "currency": "USD"}


def test_the_last_report_of_a_session_wins(repo, monkeypatch, capsys):
    """`used` is cumulative within a session, so two updates in one turn are
    one row carrying the later figure — summing them would double-count the
    agent's own running total."""
    setup(repo, "usage")
    monkeypatch.chdir(repo)
    cli.main(["run"])
    capsys.readouterr()

    recorded = json.loads(
        (only_loop(repo) / loop.USAGE_FILENAME).read_text(encoding="utf-8")
    )
    # The fake agent sends a small update and then a larger one in the same
    # session. One row per iteration, carrying the last figure.
    assert len(recorded["rows"]) == 1, recorded["rows"]
    assert recorded["rows"][0]["used"] == 1234


def test_totals_add_across_iterations_not_within_one(repo, monkeypatch, capsys):
    """Across sessions the figures are independent, so they add."""
    rows = [
        {"iteration": 1, "used": 10, "size": 100, "cost": {"amount": 1.5,
                                                           "currency": "USD"}},
        {"iteration": 2, "used": 25, "size": 100, "cost": {"amount": 2.0,
                                                           "currency": "USD"}},
    ]
    totals = loop.usage_totals(rows)
    assert totals["used"] == 35
    assert totals["cost"] == {"amount": 3.5, "currency": "USD"}


def test_mixed_currencies_produce_no_cost_total(repo):
    """Adding USD to EUR would invent a number. The tokens still add; the
    money does not, and its absence is the honest answer."""
    rows = [
        {"iteration": 1, "used": 10, "cost": {"amount": 1.0, "currency": "USD"}},
        {"iteration": 2, "used": 10, "cost": {"amount": 1.0, "currency": "EUR"}},
    ]
    totals = loop.usage_totals(rows)
    assert totals["used"] == 20
    assert "cost" not in totals, totals


def test_an_agent_that_reports_nothing_writes_no_usage_file(
    repo, monkeypatch, capsys
):
    """Absent means unreported. A zeroed file would be Wringer asserting a
    number the agent never gave it — the same reason an attestation omits a
    clause rather than inventing one."""
    setup(repo, "fix")
    monkeypatch.chdir(repo)

    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()

    directory = only_loop(repo)
    assert not (directory / loop.USAGE_FILENAME).exists()
    body = (directory / loop.EVENTS_FILENAME).read_text(encoding="utf-8")
    assert '"used"' not in body
    assert '"0"' not in body


# --- law 7: the frozen event schema must not grow a field -------------------


def test_usage_never_reaches_the_frozen_worker_finished_event(
    repo, monkeypatch, capsys
):
    """`worker.finished` is `additionalProperties: false` in the published
    `wringer.loop.v1`. A usage field there would make every new loop bundle
    invalid against the format its own manifest names — which is exactly what
    law 7 forbids, and exactly what the P6 dossier suggested before the spec
    caught it."""
    setup(repo, "usage")
    monkeypatch.chdir(repo)
    cli.main(["run"])
    capsys.readouterr()

    finished = [e for e in events(only_loop(repo)) if e["type"] == "worker.finished"]
    assert finished, "no worker.finished event at all"
    for event in finished:
        for forbidden in ("usage", "used", "size", "cost", "tokens"):
            assert forbidden not in event, (
                f"worker.finished grew a {forbidden!r} field — the published "
                f"schema forbids it: {event}"
            )


def test_a_loop_bundle_with_usage_still_matches_the_published_schemas(
    repo, monkeypatch, capsys
):
    """The guard that makes the rule above mechanical rather than remembered:
    validate a REAL bundle written by a usage-reporting agent against the
    frozen schemas."""
    import pytest

    jsonschema = pytest.importorskip("jsonschema")

    setup(repo, "usage")
    monkeypatch.chdir(repo)
    cli.main(["run"])
    capsys.readouterr()

    schema_dir = Path(__file__).resolve().parent.parent / "schema"
    if not schema_dir.is_dir():
        pytest.skip("schema/ is not part of the distribution")

    directory = only_loop(repo)
    event_schema = json.loads(
        (schema_dir / "loop-event.schema.json").read_text(encoding="utf-8")
    )
    for event in events(directory):
        jsonschema.validate(event, event_schema)

    usage_schema = json.loads(
        (schema_dir / "usage.schema.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(
        json.loads((directory / loop.USAGE_FILENAME).read_text(encoding="utf-8")),
        usage_schema,
    )


def test_the_usage_schema_is_published_and_frozen():
    """A published schema outside the freeze is a format nobody promised to
    keep."""
    import pytest

    schema_dir = Path(__file__).resolve().parent.parent / "schema"
    if not schema_dir.is_dir():
        pytest.skip("schema/ is not part of the distribution")

    frozen = json.loads((schema_dir / "frozen.json").read_text(encoding="utf-8"))
    assert (schema_dir / "usage.schema.json").is_file()
    assert "usage.schema.json" in frozen["schemas"]


def test_usage_is_covered_by_the_bundles_digests(repo, monkeypatch, capsys):
    """`digests.json` is written last and covers everything, or the file it
    missed is the one nobody can prove was not edited."""
    setup(repo, "usage")
    monkeypatch.chdir(repo)
    cli.main(["run"])
    capsys.readouterr()

    directory = only_loop(repo)
    digests = json.loads(
        (directory / evidence.DIGESTS_FILENAME).read_text(encoding="utf-8")
    )
    assert loop.USAGE_FILENAME in digests["files"]


def test_the_usage_parser_is_a_whitelist_not_a_passthrough(
    repo, monkeypatch, capsys
):
    """The agent controls every field on the notification, so the parser
    copies only the four it understands and drops the rest.

    This test previously asserted that the redactor scrubbed a credential out
    of the file — and it passed with the scrub REMOVED, because the credential
    was never in the file to begin with. It was true, but not for its stated
    reason, and a test that cannot fail when the property it names breaks is
    the narrowing shape this repo keeps finding. The real protection is the
    whitelist, so the whitelist is what is pinned: the agent's free-text field
    must be absent from `usage.json` entirely. The redactor stays as defence
    in depth, and the no-credential assertion stays because it is cheap.
    """
    secret = "notarealcredential-in-usage-8f2c11a0"
    monkeypatch.setenv("WRINGER_TEST_CREDENTIAL", secret)
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / ".wringer.yaml").write_text(
        CONFIG.format(
            command=json.dumps(sys.executable),
            agent=json.dumps(str(AGENT)),
            behaviour="usageleak",
        ).replace(
            "      args:",
            "      env_passthrough: [WRINGER_TEST_CREDENTIAL]\n      args:",
        ),
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)
    cli.main(["run"])
    capsys.readouterr()

    directory = only_loop(repo)
    for path in directory.rglob("*"):
        if path.is_file():
            assert secret not in path.read_text(encoding="utf-8", errors="replace"), (
                f"the credential reached {path}"
            )

    # The property that actually holds the line: the agent put a `note` on
    # its usage_update, and no field it invented reaches the file.
    body = (directory / loop.USAGE_FILENAME).read_text(encoding="utf-8")
    assert "note" not in body, (
        f"an agent-supplied field rode into usage.json — the parser must copy "
        f"only what it understands:\n{body}"
    )
    recorded = json.loads(body)
    assert set(recorded["rows"][0]) <= {"iteration", "used", "size", "cost"}


def test_a_turn_with_no_usage_leaves_the_member_absent():
    """The unit-level shape: `Turn.usage` is None until an agent says
    otherwise, so "absent" is representable and is the default."""
    assert acp.Turn().usage is None
