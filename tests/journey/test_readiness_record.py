"""`readiness.json` — each credential lane in ONE word, before anything is
spent (0.9.9, SOTA item 5).

Run 5 (2026-09-05) confirmed the readiness card's prose was honest about a
key displacing a stored login. This makes the classification a typed fact:
derived from `WorkerAuth`'s own fields and doctor's own check, written
beside the journey, quoted by the card, read back by `wring explain`. So
"Ready" can never mean "a variable was found and we hope it works".

The record is driven through the real verb, and the word matrix is driven
over the ENGINE'S OWN returns — a real executable answers under the vendor's
name and `worker_auth` composes the state, because a `WorkerAuth` assembled
by hand can hold a combination no lane ever emits.
"""

from __future__ import annotations

import json
import stat
import sys
from pathlib import Path

import jsonschema
import pytest
from test_printed_commands import Ctx, drive_json, drive_project, prd

from wringer import agents, config, doctor, evidence, worker_auth
from wringer_drive import journey
from wringer_drive import run as run_module

SCHEMA = json.loads(
    (Path(__file__).resolve().parent.parent.parent / "schema" / "readiness.schema.json")
    .read_text(encoding="utf-8")
)


@pytest.fixture
def ctx(request, tmp_path, monkeypatch, capsys) -> Ctx:
    return Ctx(
        request=request, tmp_path=tmp_path, monkeypatch=monkeypatch, capsys=capsys
    )


def _driven(ctx: Ctx) -> tuple[Path, dict, list[dict]]:
    project = drive_project(ctx, gate="false", worker=": {brief}; exit 1")
    code, steps = drive_json(
        ["run", str(prd(ctx)), "--repo", str(project)],
        "The ones on screen.\nyes\nyes\n",
    )
    ctx.state["project"] = project
    journeys = sorted(journey.journeys_root(project).iterdir())
    assert len(journeys) == 1
    record = journeys[0] / evidence.READINESS_FILENAME
    assert record.is_file(), "the drive spent before it wrote what it knew"
    return journeys[0], json.loads(record.read_text(encoding="utf-8")), steps


def test_a_DRIVE_writes_the_record_and_the_card_QUOTES_it(ctx):
    _, record, steps = _driven(ctx)
    jsonschema.validate(record, SCHEMA)
    assert record["drafting"]["word"] in run_module.LANE_WORDS
    assert record["worker"]["word"] in run_module.LANE_WORDS

    card = next(s for s in steps if s["id"] == "readiness")
    # The card is a heading and bullets; the two lanes are its FIRST two
    # bullets, each the record's own word and the record's own detail — one
    # derivation, quoted, so the card and the record cannot disagree.
    bullets = [line for line in card["text"].splitlines() if line.startswith("- ")]
    assert bullets[0].startswith(
        f"- Drafting credential: {record['drafting']['word']} — "
    ), bullets[:2]
    assert bullets[1].startswith(
        f"- Builder credential: {record['worker']['word']} — "
    ), bullets[:2]
    assert record["drafting"]["detail"] in card["text"]
    assert record["worker"]["detail"] in card["text"]
    # The record was written BEFORE the plan step, on the journey the card
    # belongs to — the whole point is "before anything is spent". This
    # fixture ships a plan, so the drive's step is `spec-reused`; a paid
    # draft would be `drafting`. Either way the record comes first.
    ids = [s["id"] for s in steps]
    plan_step = next(
        i for i, one in enumerate(ids) if one in ("drafting", "spec-reused")
    )
    assert ids.index("readiness") < plan_step, ids


def test_a_SHELL_worker_with_no_login_surface_is_NOT_APPLICABLE_not_unavailable(ctx):
    """`:` is a shell command with no login surface on the roster — the
    engine's own words. Calling that `unavailable` would be a false sentence
    about a command that needs no credential; the engine's own word is kept."""
    _, record, _ = _driven(ctx)
    assert record["worker"]["word"] == run_module.NOT_APPLICABLE
    assert record["worker"]["key_env"] is None


# --- the word matrix, over the engine's own returns ------------------------
#
# **A fixture the engine could not have produced is worse than no guard.**
# This was a parametrised list of `WorkerAuth(...)` values built by hand: four
# of its five rows were combinations `worker_auth` never returns (`key_env` is
# only ever composed on the shell lane, and there it always arrives with
# UNKNOWN), and the one shape the ACP lane really does return for a crossing
# key — `loggedIn: true, authMethod: api_key`, captured in this repository on
# 2026-08-22 and named in doctor's own fix text as an answer that arrives
# while every session is refused — had no row at all and was worded
# `verified`. These rows stand a real executable up under the vendor's name
# and let the engine compose the answer.


def fake_vendor(directory: Path, name: str, body: str) -> Path:
    executable = directory / name
    executable.write_text(f"#!{sys.executable}\n{body}\n", encoding="utf-8")
    executable.chmod(executable.stat().st_mode | stat.S_IEXEC | stat.S_IXOTH)
    return executable


@pytest.fixture
def only_on_path(tmp_path, monkeypatch):
    binaries = tmp_path / "bin"
    binaries.mkdir()
    monkeypatch.setenv("PATH", str(binaries))
    return binaries


ACP = agents.find("claude-code")
SHELL = agents.SHELL_VENDORS[0]


@pytest.mark.parametrize(
    "answer,word,why",
    [
        (
            {"loggedIn": True},
            run_module.VERIFIED,
            "the vendor's own free answer, with nothing displacing it",
        ),
        # **The org-pinned Mac's shape.** The declared key crosses into the
        # probe's environment and the vendor says the key is what
        # authenticated it. A present key is not a valid one.
        (
            {"loggedIn": True, "authMethod": "api_key"},
            run_module.DECLARED_UNVERIFIED,
            "a login the vendor says it made WITH a key",
        ),
        (
            {"loggedIn": False},
            run_module.UNAVAILABLE,
            "the vendor's own definite no",
        ),
        (
            {"nothing": "in the shape this check reads"},
            run_module.UNMEASURED,
            "an answer nobody could read",
        ),
    ],
)
def test_the_ACP_lane_word_over_the_vendors_own_answer(
    answer, word, why, only_on_path, monkeypatch
):
    fake_vendor(
        only_on_path, ACP.command, f"import json\nprint(json.dumps({answer!r}))"
    )
    auth = worker_auth.read(config.AcpWorker(command=ACP.command))
    assert run_module.worker_lane_word(auth) == word, f"{why}: {auth}"


@pytest.mark.parametrize(
    "code,key,word",
    [
        (0, False, run_module.VERIFIED),
        # Run 4B's trap, and the reason presence is worse than absence.
        (0, True, run_module.DISPLACED),
        (1, True, run_module.DECLARED_UNVERIFIED),
        (1, False, run_module.UNAVAILABLE),
    ],
)
def test_the_SHELL_lane_word_over_the_vendors_own_exit_code(
    code, key, word, only_on_path, monkeypatch
):
    fake_vendor(
        only_on_path, SHELL.command, f"print('measured'); raise SystemExit({code})"
    )
    monkeypatch.setenv(SHELL.key_env, "a-value") if key else monkeypatch.delenv(
        SHELL.key_env, raising=False
    )
    auth = worker_auth.read(f"{SHELL.command} build")
    assert run_module.worker_lane_word(auth) == word, auth


def test_a_vendor_that_is_not_on_PATH_is_UNMEASURED_not_a_refusal(only_on_path):
    """Nobody could ask. `unavailable` would be the vendor's own no, and
    `declared-unverified` would claim a variable is set."""
    auth = worker_auth.read(f"{SHELL.command} build")
    assert auth.state == worker_auth.UNKNOWN
    assert run_module.worker_lane_word(auth) == run_module.UNMEASURED


def test_a_SHELL_command_with_no_login_surface_is_not_applicable(only_on_path):
    auth = worker_auth.read(": {brief}")
    assert auth.state == worker_auth.NOT_APPLICABLE
    assert run_module.worker_lane_word(auth) == run_module.NOT_APPLICABLE


def test_every_word_the_matrix_can_reach_is_in_the_SCHEMA():
    allowed = set(SCHEMA["properties"]["worker"]["properties"]["word"]["enum"])
    assert set(run_module.LANE_WORDS) == allowed


def test_the_DRAFTING_lane_is_NEVER_verified():
    """Wringer never probes the drafting endpoint for free, so the most it
    can honestly say about a set variable is that it is set."""
    ok = doctor.Check(
        "drafting key", doctor.OK, "set: WRINGER_API_KEY (value not shown)"
    )
    warn = doctor.Check("drafting key", doctor.WARN, "no drafting key set")
    assert run_module.drafting_lane_word(ok) == run_module.DECLARED_UNVERIFIED
    assert run_module.drafting_lane_word(warn) == run_module.UNAVAILABLE
    assert run_module.VERIFIED not in {
        run_module.drafting_lane_word(ok), run_module.drafting_lane_word(warn)
    }


def test_explain_READS_the_readiness_record_back(ctx, capsys):
    from wringer import cli

    journey_dir, record, _ = _driven(ctx)
    ctx.monkeypatch.chdir(ctx.state["project"])
    assert cli.main(["explain", str(journey_dir)]) == cli.EXIT_OK
    out = capsys.readouterr().out
    assert (
        f"drafting credential: {record['drafting']['word']}; "
        f"builder credential: {record['worker']['word']}"
    ) in out


def test_an_UNREADABLE_config_is_not_recorded_as_no_builder_declared(
    ctx, tmp_path, monkeypatch
):
    """Law 6, on the record: say what was found. This left the lane at its
    default — `not-applicable`, "no builder is declared yet" — which is a
    claim about a worker nothing had read, and `wring explain` read it back
    for the life of the journey."""
    from wringer import config as config_module

    project = tmp_path / "unreadable"
    project.mkdir()
    (project / config_module.CONFIG_FILENAME).write_text(
        "version: 1\nrun:\n  worker: [not, a, command, line]\n", encoding="utf-8"
    )
    lanes = run_module.readiness_words(project)
    assert lanes["worker"]["word"] == run_module.UNMEASURED, lanes
    assert config_module.CONFIG_FILENAME in str(lanes["worker"]["detail"])
    assert "no builder is declared yet" not in str(lanes["worker"]["detail"])


def test_a_probe_that_RAISES_is_not_recorded_as_no_builder_declared(
    ctx, tmp_path, monkeypatch
):
    from wringer import config as config_module

    project = tmp_path / "raises"
    project.mkdir()
    (project / config_module.CONFIG_FILENAME).write_text(
        "version: 1\ngates:\n  - id: check\n    run: \"true\"\n"
        'run:\n  worker: ": {brief}"\n',
        encoding="utf-8",
    )

    def explode(*args, **kwargs):
        raise RuntimeError("the probe fell over")

    monkeypatch.setattr(worker_auth, "read", explode)
    lanes = run_module.readiness_words(project)
    assert lanes["worker"]["word"] == run_module.UNMEASURED, lanes
    assert "the probe fell over" in str(lanes["worker"]["detail"])


def test_the_CARD_asks_the_builder_ONCE(ctx, monkeypatch):
    """One derivation quoted everywhere. The card ran doctor twice and read
    the worker's credential a third time on one page: three sentences about
    one fact, and the record quoting one of them."""
    from wringer import doctor as doctor_module

    runs = {"doctor": 0}
    real = doctor_module.run_checks

    def counted(repo, *args, **kwargs):
        runs["doctor"] += 1
        return real(repo, *args, **kwargs)

    monkeypatch.setattr(doctor_module, "run_checks", counted)
    _driven(ctx)
    assert runs["doctor"] == 1, (
        f"doctor ran {runs['doctor']} times for one readiness card"
    )


def test_explain_FAILS_CLOSED_on_a_readiness_record_it_cannot_read(ctx, capsys):
    """A record with this version and no lanes used to raise a traceback; a
    record it could not read at all said nothing, and a reader could not tell
    that from no record."""
    from wringer import cli

    journey_dir, _, _ = _driven(ctx)
    ctx.monkeypatch.chdir(ctx.state["project"])
    record = journey_dir / evidence.READINESS_FILENAME

    record.write_text(
        json.dumps({"schema_version": evidence.READINESS_SCHEMA_VERSION}),
        encoding="utf-8",
    )
    assert cli.main(["explain", str(journey_dir)]) == cli.EXIT_OK
    assert "names no credential lane" in capsys.readouterr().out

    record.write_text("{not json", encoding="utf-8")
    assert cli.main(["explain", str(journey_dir)]) == cli.EXIT_OK
    said = capsys.readouterr().out
    assert evidence.READINESS_FILENAME in said
    assert "could not be read" in said


def _project_declaring(tmp_path, name: str, judge_extra: str = ""):
    from wringer import config as config_module

    project = tmp_path / name
    project.mkdir()
    (project / config_module.CONFIG_FILENAME).write_text(
        "version: 1\ngates:\n  - id: check\n    run: \"true\"\n"
        "judge:\n  endpoint: http://127.0.0.1:1/v1/chat/completions\n"
        "  model: cheap-model\n  rubric: wringer.rubric.yaml\n"
        + judge_extra
        + 'run:\n  worker: ": {brief}"\n',
        encoding="utf-8",
    )
    return project


def test_RUN_5B_the_card_counts_the_drafting_calls_the_CONFIG_will_make(tmp_path):
    """**Run 5B, 2026-09-06, F2.** The card said "Paid steps ahead: one
    drafting call" while the config the drive itself writes turns sectioned
    drafting on, and three requests went out. A card whose whole purpose is
    to say what a run will spend before it spends it may not undercount the
    unit that is billed.

    The flag here is the one `generate_workspace` writes — asserted below,
    so this cannot pass over a shape the drive never produces."""
    assert run_module.DECLARED_DEFAULTS["draft_in_sections"] is True
    project = _project_declaring(
        tmp_path, "sectioned", "  draft_in_sections: true\n"
    )
    card = run_module.readiness_step(project)
    assert "3 drafting calls (requirements, decisions, tasks)" in card.text, card.text
    assert "one drafting call" not in card.text


def test_RUN_5B_the_card_says_ONE_call_when_the_config_asks_for_one(tmp_path):
    """The other half, so the count is derived rather than swapped for a new
    literal: a project whose judge does not draft in sections is told one."""
    card = run_module.readiness_step(_project_declaring(tmp_path, "single"))
    assert "Paid steps ahead: one drafting call" in card.text, card.text


def test_RUN_5B_the_FIRST_reading_is_never_overwritten_and_every_one_is_kept(ctx):
    """**Run 5B, 2026-09-06, F3.** `resume` continues the same journey and
    re-enters the draft phase, and `write_readiness` overwrote its record.
    The card shown before the first paid draft said `declared-unverified` on
    a key-only machine; a stored login reappeared; the journey's record was
    rewritten to `displaced`. The later reading was true, and it went over
    the only copy of what the person was shown BEFORE they spent — which is
    what that file is for, in its own schema's words.

    Both are facts, so both are kept.
    """
    import jsonschema

    journey_dir, first, _ = _driven(ctx)
    record = journey_dir / evidence.READINESS_FILENAME
    history = journey_dir / evidence.READINESS_HISTORY_FILENAME
    assert history.is_file(), "no history was written beside the record"

    lanes = {
        "drafting": {"word": run_module.UNAVAILABLE, "detail": "the key went away"},
        "worker": {"word": run_module.DISPLACED, "detail": "a login came back"},
    }
    run_module.write_readiness(
        ctx.state["project"], journey_dir.name, lanes
    )

    kept = json.loads(record.read_text(encoding="utf-8"))
    assert kept == first, (
        "the record of what was known before the first spend was overwritten"
    )

    readings = [
        json.loads(line)
        for line in history.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert len(readings) == 2, readings
    for one in readings:
        jsonschema.validate(one, SCHEMA)
    assert readings[0] == first
    assert readings[-1]["worker"]["word"] == run_module.DISPLACED


def test_RUN_5B_explain_says_BOTH_what_was_shown_and_what_changed(ctx, capsys):
    """One surface, both facts: the reading before the spend, and any later
    reading that said something different. A reading that says the same
    thing is not repeated back as news."""
    from wringer import cli

    journey_dir, first, _ = _driven(ctx)
    ctx.monkeypatch.chdir(ctx.state["project"])

    # A second reading that agrees adds nothing to say.
    run_module.write_readiness(
        ctx.state["project"],
        journey_dir.name,
        {
            "drafting": dict(first["drafting"]),
            "worker": dict(first["worker"]),
        },
    )
    assert cli.main(["explain", str(journey_dir)]) == cli.EXIT_OK
    assert "Later," not in capsys.readouterr().out

    # One that disagrees is said, beside the first rather than over it.
    run_module.write_readiness(
        ctx.state["project"],
        journey_dir.name,
        {
            "drafting": {"word": run_module.UNAVAILABLE, "detail": "gone"},
            "worker": {"word": run_module.DISPLACED, "detail": "a login came back"},
        },
    )
    assert cli.main(["explain", str(journey_dir)]) == cli.EXIT_OK
    said = capsys.readouterr().out
    assert (
        f"Before anything was spent — drafting credential: "
        f"{first['drafting']['word']}"
    ) in said, said
    assert "Later," in said and run_module.DISPLACED in said


def test_RUN_5B_an_unreadable_history_line_is_COUNTED_not_dropped(ctx, capsys):
    """Law 7: a line this version cannot read is named, never skipped in
    silence."""
    from wringer import cli

    journey_dir, _, _ = _driven(ctx)
    history = journey_dir / evidence.READINESS_HISTORY_FILENAME
    with history.open("a", encoding="utf-8") as handle:
        handle.write("{not json\n")
        handle.write(json.dumps({"schema_version": "wringer.readiness.v0"}) + "\n")

    ctx.monkeypatch.chdir(ctx.state["project"])
    assert cli.main(["explain", str(journey_dir)]) == cli.EXIT_OK
    said = capsys.readouterr().out
    assert evidence.READINESS_HISTORY_FILENAME in said
    assert "2 line(s) could not be read" in said, said
