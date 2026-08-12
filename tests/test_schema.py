"""The published schemas must describe what the code actually writes.

`schema/` is a contract other tools target, so the failure that matters is
drift: someone adds a field to an event and the schema quietly stops being
true. These tests run real verifications and check every object the run
produced against the schema that claims to describe it — no JSON Schema
engine, and so no dependency, because the only rule being enforced is
"declared properties and what got written are the same set".
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from wringer import cli, evidence, gates, loop, spec

SCHEMA_DIR = Path(__file__).resolve().parent.parent / "schema"

FAILING = """\
version: 1
gates:
  - id: noisy
    run: "yes wringer | head -c 1200000; exit 0"
  - id: broken
    run: "echo boom >&2; exit 3"
  - id: never
    run: "echo unreached"
"""

TWO_GATES = """\
version: 1
gates:
  - id: quick
    run: "true"
  - id: slow
    run: "true"
"""


def load(name: str) -> dict:
    return json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))


def check(obj: dict, schema: dict, where: str) -> None:
    """Every key written is declared, and every declared requirement is met."""
    allowed = set(schema["properties"])
    written = set(obj)
    assert written <= allowed, f"{where}: undeclared keys {sorted(written - allowed)}"
    missing = set(schema.get("required", ())) - written
    assert not missing, f"{where}: missing required {sorted(missing)}"


def branch(event_type: str, schema: str = "evidence-event.schema.json") -> dict:
    """The event-schema branch describing one `type`."""
    for option in load(schema)["oneOf"]:
        if option["properties"]["type"]["const"] == event_type:
            return option
    raise AssertionError(f"no schema branch for {event_type!r} in {schema}")


def only_bundle(root: Path) -> Path:
    runs = sorted((root / evidence.RUNS_DIRNAME).iterdir())
    assert len(runs) == 1, runs
    return runs[0]


def test_the_schemas_are_valid_json_and_agree_on_the_version():
    manifest = load("manifest.schema.json")
    assert manifest["properties"]["schema_version"]["const"] == evidence.SCHEMA_VERSION
    for name in (
        "manifest.schema.json",
        "gate-result.schema.json",
        "evidence-event.schema.json",
    ):
        schema = load(name)
        assert schema["$schema"].startswith("https://json-schema.org/")
        assert schema["title"]


def test_a_failing_run_matches_the_published_schemas(
    repo, write_config, monkeypatch, capsys
):
    """Covers the shapes only a failure produces: `log` and `truncated` on
    gate.finished, `failed_gate` on run.finished, and `untracked` on
    git.status."""
    write_config(repo, FAILING)
    (repo / "loose-file.txt").write_text("untracked\n", encoding="utf-8")
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    bundle = only_bundle(repo)

    check(
        json.loads((bundle / evidence.MANIFEST_FILENAME).read_text(encoding="utf-8")),
        load("manifest.schema.json"),
        "manifest.json",
    )

    seen = set()
    for line in (bundle / evidence.EVIDENCE_FILENAME).read_text("utf-8").splitlines():
        event = json.loads(line)
        check(event, branch(event["type"]), f"event {event['type']}")
        seen.add(event["type"])
    assert seen == {
        "run.started",
        "git.status",
        "gate.started",
        "gate.finished",
        "run.finished",
    }

    for result in sorted((bundle / evidence.GATES_DIRNAME).glob("*/result.json")):
        check(
            json.loads(result.read_text(encoding="utf-8")),
            load("gate-result.schema.json"),
            result.parent.name,
        )

    # the optional keys really were exercised, or this test proves less than
    # it looks like it does
    events = [
        json.loads(line)
        for line in (bundle / evidence.EVIDENCE_FILENAME)
        .read_text("utf-8")
        .splitlines()
    ]
    finished = [e for e in events if e["type"] == "gate.finished"]
    assert any(e.get("truncated") for e in finished)
    assert any("log" in e for e in finished)
    assert any("untracked" in e for e in events if e["type"] == "git.status")
    assert any("failed_gate" in e for e in events if e["type"] == "run.finished")


def test_a_loop_matches_the_published_loop_schemas(repo, monkeypatch, capsys):
    """Two loops, so every event type and both optional keys are exercised:
    one that converges, one whose worker overruns its timeout."""
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / ".wringer.yaml").write_text(
        """\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
run:
  worker: "echo FIXED > calc.py"
  max_iterations: 3
""",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)
    assert cli.main(["run"]) == cli.EXIT_OK

    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / ".wringer.yaml").write_text(
        """\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
run:
  worker: "sleep 30"
  max_iterations: 2
  worker_timeout: 1
""",
        encoding="utf-8",
    )
    assert cli.main(["run"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    seen: set[str] = set()
    optional: set[str] = set()
    loops = sorted((repo / loop.LOOPS_DIRNAME).iterdir())
    assert len(loops) == 2

    for loop_dir in loops:
        check(
            json.loads((loop_dir / loop.MANIFEST_FILENAME).read_text("utf-8")),
            load("loop-manifest-v2.schema.json"),
            f"{loop_dir.name}/manifest.json",
        )
        for line in (loop_dir / loop.EVENTS_FILENAME).read_text("utf-8").splitlines():
            event = json.loads(line)
            check(
                event,
                branch(event["type"], "loop-event-v2.schema.json"),
                f"{loop_dir.name} event {event['type']}",
            )
            seen.add(event["type"])
            optional |= {k for k in ("failed_gate", "timed_out") if k in event}

    assert seen == {
        "loop.started",
        "iteration.started",
        "verify.finished",
        "worker.started",
        "worker.finished",
        "loop.finished",
    }
    # the keys that appear only in the case they describe really appeared
    assert optional == {"failed_gate", "timed_out"}


def test_an_interrupted_run_matches_the_published_schemas(
    repo, write_config, monkeypatch, capsys
):
    write_config(repo, TWO_GATES)
    monkeypatch.chdir(repo)

    real = gates.run
    calls = []

    def stop_on_the_second(*args, **kwargs):
        calls.append(None)
        if len(calls) == 2:
            raise KeyboardInterrupt
        return real(*args, **kwargs)

    monkeypatch.setattr(gates, "run", stop_on_the_second)

    assert cli.main(["verify"]) == cli.EXIT_INTERRUPTED
    capsys.readouterr()
    bundle = only_bundle(repo)

    manifest = json.loads(
        (bundle / evidence.MANIFEST_FILENAME).read_text(encoding="utf-8")
    )
    check(manifest, load("manifest.schema.json"), "manifest.json")
    assert manifest["result"]["status"] == "interrupted"

    for line in (bundle / evidence.EVIDENCE_FILENAME).read_text("utf-8").splitlines():
        event = json.loads(line)
        check(event, branch(event["type"]), f"event {event['type']}")


# --- the real engine, now that jsonschema is a dev dependency ---
#
# The dependency-free checks above catch DRIFT: a key the code writes that
# the schema does not declare. They cannot catch a schema that is itself
# malformed, or a value that violates a pattern or enum. This does — and it
# runs in CI, which is the point of adding the dependency.


def validators():
    from jsonschema import Draft202012Validator

    built = {}
    for path in SCHEMA_DIR.glob("*.schema.json"):
        schema = json.loads(path.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)  # the schema itself is legal
        built[path.name] = Draft202012Validator(schema)
    return built


def test_every_published_schema_is_a_legal_json_schema():
    built = validators()

    assert len(built) >= 5, sorted(built)


def test_a_real_bundle_validates_against_the_real_engine(
    repo, write_config, monkeypatch, capsys
):
    """End to end with a genuine draft-2020-12 validator: every event, the
    manifest, and every gate result from an actual failing run."""
    built = validators()
    write_config(repo, FAILING)
    (repo / "loose.txt").write_text("untracked\n", encoding="utf-8")
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    bundle = only_bundle(repo)

    errors: list[str] = []

    def collect(validator_name: str, instance: object, where: str) -> None:
        for error in built[validator_name].iter_errors(instance):
            errors.append(f"{where}: {error.json_path} {error.message}")

    collect(
        "manifest.schema.json",
        json.loads((bundle / evidence.MANIFEST_FILENAME).read_text("utf-8")),
        "manifest.json",
    )
    for line in (bundle / evidence.EVIDENCE_FILENAME).read_text("utf-8").splitlines():
        event = json.loads(line)
        collect("evidence-event.schema.json", event, f"event {event['type']}")
    for result in sorted((bundle / evidence.GATES_DIRNAME).glob("*/result.json")):
        collect(
            "gate-result.schema.json",
            json.loads(result.read_text("utf-8")),
            result.parent.name,
        )

    assert not errors, "\n".join(errors)


def test_a_real_loop_bundle_validates_against_the_real_engine(
    repo, monkeypatch, capsys
):
    built = validators()
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    (repo / ".wringer.yaml").write_text(
        """\
version: 1
gates:
  - id: test
    run: "grep -q FIXED calc.py"
run:
  worker: "echo FIXED > calc.py"
  max_iterations: 3
""",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)
    assert cli.main(["run"]) == cli.EXIT_OK
    capsys.readouterr()
    loop_dir = sorted((repo / loop.LOOPS_DIRNAME).iterdir())[0]

    errors: list[str] = []
    for error in built["loop-manifest-v2.schema.json"].iter_errors(
        json.loads((loop_dir / loop.MANIFEST_FILENAME).read_text("utf-8"))
    ):
        errors.append(f"loop manifest: {error.message}")
    for line in (loop_dir / loop.EVENTS_FILENAME).read_text("utf-8").splitlines():
        event = json.loads(line)
        for error in built["loop-event-v2.schema.json"].iter_errors(event):
            errors.append(f"{event['type']}: {error.message}")

    assert not errors, "\n".join(errors)


# --- the spec and the rubric (SPEC_INTENT_V0.md) ---
#
# These two are not evidence — they are source, committed and hand-edited —
# but the same rule applies: a published schema that stops describing what the
# code writes is worse than no schema, because someone targeted it.

SPEC_CONFIG = """\
version: 1
gates:
  - id: check
    run: "true"
judge:
  endpoint: http://127.0.0.1:11434/v1/chat/completions
  model: cheap-model
  rubric: wringer.rubric.yaml
"""


def draft_and_plan(repo: Path, monkeypatch) -> None:
    """Run the real commands: `wring spec --send` then `wring plan`."""
    from test_spec import DRAFT, PRD, reply

    from wringer import judge

    (repo / "PRD.md").write_text(PRD, encoding="utf-8")
    (repo / ".wringer.yaml").write_text(SPEC_CONFIG, encoding="utf-8")
    monkeypatch.chdir(repo)
    monkeypatch.setattr(
        judge, "send", lambda *args, **kwargs: reply(DRAFT)
    )
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    # approval is a file edit, here as everywhere
    path = repo / spec.SPEC_FILENAME
    path.write_text(
        path.read_text(encoding="utf-8").replace("approved: false", "approved: true"),
        encoding="utf-8",
    )
    path.write_text(
        path.read_text(encoding="utf-8").replace(
            "answer: ''", "answer: ISO-8601.", 1
        ),
        encoding="utf-8",
    )
    assert cli.main(["plan"]) == cli.EXIT_OK


def test_a_drafted_spec_and_its_rubric_match_the_published_schemas(
    repo, monkeypatch, capsys
):
    import yaml

    draft_and_plan(repo, monkeypatch)
    capsys.readouterr()

    check(
        yaml.safe_load((repo / spec.SPEC_FILENAME).read_text(encoding="utf-8")),
        load("spec.schema.json"),
        spec.SPEC_FILENAME,
    )
    check(
        yaml.safe_load((repo / spec.RUBRIC_FILENAME).read_text(encoding="utf-8")),
        load("rubric.schema.json"),
        spec.RUBRIC_FILENAME,
    )


def test_a_real_spec_validates_against_the_real_engine(repo, monkeypatch, capsys):
    import yaml

    built = validators()
    draft_and_plan(repo, monkeypatch)
    capsys.readouterr()

    errors: list[str] = []
    for name, filename in (
        ("spec.schema.json", spec.SPEC_FILENAME),
        ("rubric.schema.json", spec.RUBRIC_FILENAME),
    ):
        document = yaml.safe_load((repo / filename).read_text(encoding="utf-8"))
        for error in built[name].iter_errors(document):
            errors.append(f"{filename}: {error.json_path} {error.message}")

    assert not errors, "\n".join(errors)
    # the drafted spec really exercised the optional blocks, or this test
    # proves less than it looks like it does
    document = yaml.safe_load((repo / spec.SPEC_FILENAME).read_text("utf-8"))
    assert document["open_questions"] and document["gates"]
    assert any(c["human"] for c in document["criteria"])


def test_the_two_schemas_describe_one_criterion(monkeypatch):
    """The spec's criteria block IS a rubric's. Inlined in both files so
    neither needs a network fetch to resolve, so a test has to hold them
    together."""
    in_rubric = load("rubric.schema.json")["properties"]["criteria"]["items"]
    in_spec = load("spec.schema.json")["properties"]["criteria"]["items"]

    assert in_rubric == in_spec


# --- delivery and acquisition (SPEC_GET_V0.md) ---
#
# The delivery manifest is the only bundle in Wringer that describes writes to
# git. It exists because the amended law 6 buys that power with receipts, so a
# schema that quietly stopped describing it would matter more here than
# anywhere else in the program.


def deliver_for_real(repo, monkeypatch, tag):
    """Run a real verify + `wring deliver --send` against a file:// remote."""
    from test_deliver import CONFIG, MR_REPLY, fake_forge, git

    upstream = repo.parent / f"{repo.name}-{tag}.git"
    git(repo, "init", "--bare", "-b", "main", str(upstream))
    git(repo, "remote", "add", "origin", f"file://{upstream}")
    (repo / ".wringer.yaml").write_text(CONFIG, encoding="utf-8")
    (repo / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    git(repo, "add", "-A")
    git(repo, "commit", "-m", "config")
    git(repo, "push", "-u", "origin", "main")
    (repo / "feature.py").write_text("x = 1\n", encoding="utf-8")

    monkeypatch.chdir(repo)
    monkeypatch.setenv("FORGE_TOKEN", "t1234567")
    assert cli.main(["verify"]) == cli.EXIT_OK
    fake_forge(monkeypatch, reply=MR_REPLY)
    assert cli.main(["deliver", "--send"]) == cli.EXIT_OK
    return upstream


def test_a_real_delivery_and_acquisition_match_the_published_schemas(
    repo, monkeypatch, capsys
):
    from wringer import acquire, deliver

    upstream = deliver_for_real(repo, monkeypatch, "schema")
    assert cli.main(["get", f"file://{upstream}", "--into", "clone"]) == cli.EXIT_OK
    capsys.readouterr()

    built = validators()
    errors: list[str] = []

    written = sorted((repo / deliver.DELIVERIES_DIRNAME).iterdir())[0]
    manifest = json.loads(
        (written / deliver.MANIFEST_FILENAME).read_text(encoding="utf-8")
    )
    check(manifest, load("delivery-manifest.schema.json"), "delivery manifest")
    for error in built["delivery-manifest.schema.json"].iter_errors(manifest):
        errors.append(f"delivery: {error.json_path} {error.message}")
    # the live branch really was exercised, or this test proves less than it
    # looks like it does
    assert manifest["mode"] == "live" and manifest["result"]["pushed"] is True
    assert manifest["result"]["merge_request"]["number"] == 7

    acquired = sorted((repo / acquire.ACQUIRED_DIRNAME).glob("*/manifest.json"))[0]
    record = json.loads(acquired.read_text(encoding="utf-8"))
    check(record, load("acquired-manifest.schema.json"), "acquired manifest")
    for error in built["acquired-manifest.schema.json"].iter_errors(record):
        errors.append(f"acquired: {error.json_path} {error.message}")

    assert not errors, "\n".join(errors)


def test_a_dry_run_delivery_also_matches_the_schema(repo, monkeypatch, capsys):
    """The dry run's manifest has nulls where the live one has values — the
    branch that was planned but not created, most of all."""
    from test_deliver import CONFIG, git

    from wringer import deliver

    upstream = repo.parent / f"{repo.name}-dry.git"
    git(repo, "init", "--bare", "-b", "main", str(upstream))
    git(repo, "remote", "add", "origin", f"file://{upstream}")
    (repo / ".wringer.yaml").write_text(CONFIG, encoding="utf-8")
    (repo / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    git(repo, "add", "-A")
    git(repo, "commit", "-m", "config")
    git(repo, "push", "-u", "origin", "main")
    (repo / "feature.py").write_text("x = 1\n", encoding="utf-8")
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    assert cli.main(["deliver"]) == cli.EXIT_OK
    capsys.readouterr()

    written = sorted((repo / deliver.DELIVERIES_DIRNAME).iterdir())[0]
    manifest = json.loads(
        (written / deliver.MANIFEST_FILENAME).read_text(encoding="utf-8")
    )
    check(manifest, load("delivery-manifest.schema.json"), "dry delivery")
    for error in validators()["delivery-manifest.schema.json"].iter_errors(
        manifest
    ):
        raise AssertionError(f"dry delivery: {error.json_path} {error.message}")
    assert manifest["mode"] == "dry_run"
    assert manifest["result"] == {
        "branch": None, "commit": None, "pushed": False, "merge_request": None
    }
    # ...but the branch it WOULD create is named, because a dry run that said
    # nothing was planned would be reporting the wrong thing
    assert manifest["branch"].startswith("wringer/")


def test_every_delivery_event_carries_the_chain(repo, monkeypatch, capsys):
    """The ledger is the receipt half of law 6's amendment, so its shape gets
    checked the way every other ledger's does."""
    from wringer import deliver

    deliver_for_real(repo, monkeypatch, "chain")
    capsys.readouterr()

    written = sorted((repo / deliver.DELIVERIES_DIRNAME).iterdir())[0]
    events = [
        json.loads(line)
        for line in (written / deliver.EVENTS_FILENAME)
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert events, "a live delivery wrote no ledger"
    for event in events:
        assert {"type", "ts", "prev_hash"} <= set(event), event
    # planned before done, for every pair — condition 5
    kinds = [e["type"] for e in events]
    for planned, done in (
        ("branch.planned", "branch.created"),
        ("commit.planned", "commit.written"),
        ("push.planned", "push.done"),
        ("mr.planned", "mr.opened"),
    ):
        assert kinds.index(planned) < kinds.index(done), (planned, done)


# --- the committed demo bundle (WRINGER_RELEASE_PLAN.md R1) --------------
#
# `.wringer.example/` is the receipt the README points at as the answer to
# "how do I know?". It was produced by v0.1.0, before `prev_hash` existed.
#
# P0 added `prev_hash` to every event AND made it `required` in the published
# schema, with the version string still `wringer.evidence.v1`. Two
# incompatible formats then claimed one version, and the repo's own showcase
# bundle failed the schema the repo publishes. Nobody noticed because every
# other schema test validates a bundle produced by the current code.
#
# The fix was not a version bump: it was to stop requiring, in v1, a field
# that v1 never had. These tests are what would have caught it.

EXAMPLE_DIR = Path(__file__).resolve().parent.parent / ".wringer.example" / "runs"


def example_bundle() -> Path:
    found = sorted(p for p in EXAMPLE_DIR.iterdir() if p.is_dir())
    assert found, f"no committed demo bundle under {EXAMPLE_DIR}"
    return found[0]


def test_the_committed_demo_bundle_matches_the_published_schemas():
    """The repo's own receipt must validate against the repo's own schemas.

    If this fails, either the bundle is stale or a released schema grew a
    requirement it cannot have. Both are the same bug: a version string that
    stopped meaning one thing.
    """
    bundle = example_bundle()

    check(
        json.loads((bundle / evidence.MANIFEST_FILENAME).read_text("utf-8")),
        load("manifest.schema.json"),
        "example manifest.json",
    )
    for line in (bundle / evidence.EVIDENCE_FILENAME).read_text("utf-8").splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        check(event, branch(event["type"]), f"example event {event['type']}")
    for result in sorted((bundle / evidence.GATES_DIRNAME).glob("*/result.json")):
        check(
            json.loads(result.read_text("utf-8")),
            load("gate-result.schema.json"),
            f"example {result.parent.name}",
        )


def test_the_committed_demo_bundle_validates_against_the_real_engine():
    built = validators()
    bundle = example_bundle()
    errors: list[str] = []

    for error in built["manifest.schema.json"].iter_errors(
        json.loads((bundle / evidence.MANIFEST_FILENAME).read_text("utf-8"))
    ):
        errors.append(f"manifest: {error.json_path} {error.message}")
    for line in (bundle / evidence.EVIDENCE_FILENAME).read_text("utf-8").splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        for error in built["evidence-event.schema.json"].iter_errors(event):
            errors.append(f"{event['type']}: {error.json_path} {error.message}")

    assert not errors, "\n".join(errors)


def test_a_pre_chain_bundle_is_still_a_valid_v1_bundle():
    """The point of R1, stated as a property rather than a file.

    `wringer.evidence.v1` shipped without `prev_hash`. A reader of v1 must
    accept a v1 bundle. Wringer still WRITES the chain — tamper-evidence is
    unaffected going forward — and `wring attest` may one day refuse to
    attest a bundle that has none. That is an honest refusal; calling the
    bundle schema-invalid was not.
    """
    built = validators()
    event = {
        "type": "run.started",
        "ts": "2026-07-30T23:16:45.123+01:00",
        "run_id": "20260730-231645-a57c",
        "wringer_version": "0.1.0",
        "repo": "wringer",
        "sha": "a" * 40,
    }
    assert "prev_hash" not in event
    assert not list(built["evidence-event.schema.json"].iter_errors(event))

    # and the chained form is equally valid — both are v1
    chained = dict(event, prev_hash="b" * 64)
    assert not list(built["evidence-event.schema.json"].iter_errors(chained))


# --- wringer.loop.v2 (SPEC_STABILITY_V0 §4, mechanics from SPEC_ENV_V0 §3) ---


def test_a_v1_loop_bundle_is_still_valid_and_is_still_read(tmp_path: Path):
    """**The bump must not orphan a single bundle already on disk.**

    SPEC_ENV_V0 §3 names this as finding D3 for the version bump it chartered:
    `health._KINDS` is keyed off `loop.SCHEMA_VERSION`, so moving the constant
    without widening the map makes health forget every v1 loop — wordlessly,
    which is the exact failure mode health exists to catch. Asserted through
    the DERIVED reader rather than by inspecting the map, and against the v1
    schema too, so "v1 is still published and still frozen" is a property here
    rather than a sentence in a description.
    """
    from wringer import health

    built = validators()
    manifest = {
        "schema_version": "wringer.loop.v1",
        "loop_id": "20260801-120000-aaaa",
        "started_at": "2026-08-01T12:00:00+01:00",
        "repo": {"root": ".", "head_sha": "a" * 40, "branch": "main", "dirty": False},
        "config": {"worker": "agent fix", "max_iterations": 3},
        "result": {
            "status": "stopped",
            "reason": "oscillating",
            "iterations": 3,
            "final_run": ".wringer/runs/20260801-120000-bbbb",
        },
    }
    assert not list(built["loop-manifest.schema.json"].iter_errors(manifest))

    # ... and the derived reader still calls it a loop
    bundle = tmp_path / ".wringer" / "loops" / manifest["loop_id"]
    bundle.mkdir(parents=True)
    (bundle / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    coverage = health.discover(tmp_path)

    assert [b.kind for b in coverage.read] == ["loop"], (
        "a v1 loop bundle became invisible to health — the naive version bump, "
        f"skipped as: {[s.reason for s in coverage.skipped]}"
    )


def test_the_open_reason_is_what_lets_a_new_stop_reason_cost_no_version():
    """v2's `reason` is a string, not an enum, and that is the design.

    Closed, every future stop reason costs a bundle-format version — F6's
    `environment` would have needed v3 — and version churn on the format is
    what a frozen schema exists to prevent rather than cause. The fleet's own
    `reason` has always been a plain string for the same reason.
    """
    built = validators()
    for reason in ("flaky_gate", "environment", "some_reason_nobody_has_had_yet"):
        event = {
            "type": "loop.finished",
            "ts": "2026-08-12T09:00:00+01:00",
            "prev_hash": "0" * 64,
            "status": "stopped",
            "reason": reason,
            "iterations": 1,
        }
        assert not list(built["loop-event-v2.schema.json"].iter_errors(event)), reason
    # and v1 still refuses every one of them, which is what "frozen" means
    assert list(
        built["loop-event.schema.json"].iter_errors(
            {
                "type": "loop.finished",
                "ts": "2026-08-12T09:00:00+01:00",
                "prev_hash": "0" * 64,
                "status": "stopped",
                "reason": "flaky_gate",
                "iterations": 1,
            }
        )
    )


def test_the_loop_reason_the_code_emits_is_the_reason_the_schema_documents():
    """The drift guard the open string moves out of the schema.

    An open `reason` cannot catch a typo, so the guard is that every value
    `loop._REASONS` knows is named in v2's description and matched by
    `graph.LOOP_REASONS`. A router comparing against a reason the loop never
    emits is a route that silently never fires.
    """
    from wringer import graph
    from wringer import loop as loop_module

    described = load("loop-manifest-v2.schema.json")["properties"]["result"][
        "properties"
    ]["reason"]["description"]
    for reason in loop_module._REASONS:
        assert f"`{reason}`" in described, reason
        assert reason in graph.LOOP_REASONS, reason


# --- per-file digests (WRINGER_RELEASE_PLAN.md R3) -----------------------
#
# The `prev_hash` chain makes the LEDGER tamper-evident and says nothing about
# the rest of the bundle. `wring attest` (P5) cannot claim "proven by gates G,
# and none of it has been altered since" without a digest per file — and every
# bundle written before this existed is one that can never be attested. It
# lands now because `wringer.evidence.v1` is frozen and this is a SIBLING
# file, so it costs nothing today and a version bump later.


def digests_of(bundle: Path) -> dict:
    return json.loads((bundle / evidence.DIGESTS_FILENAME).read_text("utf-8"))


def all_match(bundle: Path, recorded: dict) -> bool:
    import hashlib

    for name, expected in recorded["files"].items():
        actual = hashlib.sha256((bundle / name).read_bytes()).hexdigest()
        if actual != expected:
            return False
    return True


def test_a_bundle_records_a_digest_for_every_file_it_wrote(
    repo, write_config, monkeypatch, capsys
):
    write_config(repo, TWO_GATES)
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()
    bundle = only_bundle(repo)

    recorded = digests_of(bundle)
    check(recorded, load("digests.schema.json"), "digests.json")
    assert recorded["algorithm"] == "sha256"

    # every file in the bundle except digests.json itself
    on_disk = {
        p.relative_to(bundle).as_posix()
        for p in bundle.rglob("*")
        if p.is_file() and p.name != evidence.DIGESTS_FILENAME
    }
    assert set(recorded["files"]) == on_disk
    assert all_match(bundle, recorded)


def test_editing_any_bundle_file_is_detectable(
    repo, write_config, monkeypatch, capsys
):
    """The whole point. Tamper-EVIDENCE, not tamper-proofing: anyone who can
    write the bundle can rewrite digests.json too. What this removes is the
    SILENT edit."""
    write_config(repo, TWO_GATES)
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()
    bundle = only_bundle(repo)
    recorded = digests_of(bundle)
    assert all_match(bundle, recorded)

    doctored = bundle / evidence.GATES_DIRNAME / "001_quick" / "stdout.log"
    doctored.write_text("this is not what the gate printed\n", encoding="utf-8")

    assert not all_match(bundle, recorded)


def test_the_digest_file_covers_the_manifest_and_the_summary():
    """It is written LAST for exactly this reason — a digest set that omitted
    the manifest would leave the run's own index unprotected."""
    # asserted structurally against a real bundle in the test above; here we
    # pin the requirement so a reordering breaks a named test
    import inspect

    from wringer import verify as verify_module

    source = inspect.getsource(verify_module.run)
    assert source.index("write_manifest") < source.index("write_digests")
    assert source.index("summary.write") < source.index("write_digests")
    # untracked.json too, for the same reason: the bundle's tamper-evidence
    # has to cover the tree's untracked bytes, not sit beside them.
    assert source.index("write_untracked") < source.index("write_digests")


def test_a_real_bundle_digest_file_validates_against_the_real_engine(
    repo, write_config, monkeypatch, capsys
):
    built = validators()
    write_config(repo, FAILING)
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()

    recorded = digests_of(only_bundle(repo))
    errors = [
        f"{e.json_path} {e.message}"
        for e in built["digests.schema.json"].iter_errors(recorded)
    ]
    assert not errors, "\n".join(errors)


# --- law 7: a frozen schema stays frozen -----------------------------------
#
# The drift tests above compare each schema against what the code WRITES, so
# they pass whenever code and schema move together — which is exactly law 7's
# failure mode, not a guard against it. Nine schema versions froze at v0.2.0.
# A byte change to any of them without a new `schema_version` silently breaks
# every reader of every bundle already on disk.
#
# `schema/frozen.json` records the sha256 of each schema as it SHIPPED,
# captured from `git show v0.2.0:schema/…` rather than from the working tree.
# This test is the freeze. Both P5 specs' DONE lists require it, because
# `wring attest` is a promise about bundles whose format cannot have moved
# underneath it.
#
# Deliberately hash-based rather than git-based: it works in a shallow clone,
# in a packaged sdist, and anywhere the tag is not fetched — a guard that
# skips in CI is not a guard.

FROZEN = SCHEMA_DIR / "frozen.json"


def frozen_manifest() -> dict:
    return json.loads(FROZEN.read_text(encoding="utf-8"))


def sha256_of(path: Path) -> str:
    import hashlib

    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_the_freeze_covers_every_published_schema():
    """Every `*.schema.json` in schema/ is frozen — no exceptions, no
    opt-in. A published schema outside the freeze is a format nobody
    promised to keep, which is worse than not publishing it."""
    recorded = set(frozen_manifest()["schemas"])
    published = {path.name for path in SCHEMA_DIR.glob("*.schema.json")}
    assert recorded == published, (
        f"published but not frozen: {sorted(published - recorded)}; "
        f"frozen but not published: {sorted(recorded - published)}"
    )


def test_no_schema_frozen_at_v0_2_0_has_changed_a_byte():
    recorded = frozen_manifest()["schemas"]
    offenders = []
    for name, expected in sorted(recorded.items()):
        path = SCHEMA_DIR / name
        if not path.is_file():
            offenders.append(f"{name}: DELETED — a frozen schema may not vanish")
            continue
        actual = sha256_of(path)
        if actual != expected:
            offenders.append(f"{name}: {expected[:12]} -> {actual[:12]}")

    assert not offenders, (
        "these schemas froze at v0.2.0 and have changed (law 7):\n  "
        + "\n  ".join(offenders)
        + "\n\nEvery bundle already on disk was written against them, and "
        "`wring attest` is a promise about exactly those bundles. If the "
        "change is genuinely needed, it is a NEW schema version with a new "
        "`schema_version` id and a new file — not an edit to this one. "
        "Adding a new schema/*.schema.json is always allowed; only these ten "
        "are frozen."
    )


def test_a_new_schema_may_be_added_without_touching_the_freeze():
    """The freeze must not block P5. `wringer.attestation.v1` and
    `wringer.vacuity.v1` are new files, and new files are additive."""
    recorded = set(frozen_manifest()["schemas"])
    present = {path.name for path in SCHEMA_DIR.glob("*.schema.json")}
    assert recorded <= present, f"missing frozen schemas: {recorded - present}"


# --- wringer.untracked.v2 ---------------------------------------------------
#
# v1 recorded a bare sha256 of what `open("rb")` returned, which follows a
# symlink: it described what the gates could READ rather than what git would
# COMMIT. v2 records git's identity for the path — `"<mode>:<sha256>"` — and
# v1 stays published, frozen, and readable. These check both.


def test_the_untracked_digest_file_matches_its_schema(
    repo, write_config, monkeypatch, capsys
):
    write_config(repo, TWO_GATES)
    (repo / "loose.txt").write_text("untracked content\n", encoding="utf-8")
    nested = repo / "newdir"
    nested.mkdir()
    (nested / "inner.txt").write_text("also untracked\n", encoding="utf-8")
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    bundle = only_bundle(repo)
    recorded = json.loads(
        (bundle / evidence.UNTRACKED_FILENAME).read_text(encoding="utf-8")
    )
    check(recorded, load("untracked-v2.schema.json"), "untracked.json")
    assert recorded["schema_version"] == "wringer.untracked.v2"
    assert recorded["algorithm"] == "sha256"

    # per FILE, not per directory — the whole point of the -uall fix
    assert "loose.txt" in recorded["files"]
    assert "newdir/inner.txt" in recorded["files"]
    assert "newdir/" not in recorded["files"]
    # mode and digest, in one string, for every entry
    assert all(
        value.split(":")[0] in ("100644", "100755", "120000")
        and len(value.split(":")[1]) == 64
        for value in recorded["files"].values()
    ), recorded["files"]


def test_a_v1_untracked_document_still_validates_against_v1(monkeypatch):
    """The freeze is only worth something if the retired version keeps
    working. A reader holding a bundle written before 2026-08-06 must not
    have to care that v2 exists."""
    built = validators()
    document = {
        "schema_version": "wringer.untracked.v1",
        "algorithm": "sha256",
        "files": {"notes.txt": "a" * 64, "gone.txt": "unreadable"},
    }

    errors = [
        f"{e.json_path} {e.message}"
        for e in built["untracked.schema.json"].iter_errors(document)
    ]
    assert not errors, "\n".join(errors)
    # and the two versions do not accept each other's values
    assert list(built["untracked-v2.schema.json"].iter_errors(document))


def test_the_two_untracked_versions_are_separate_published_files():
    """v1 was edited in place at first, which would have silently
    reinterpreted every digest in every bundle already written."""
    recorded = frozen_manifest()["schemas"]
    assert "untracked.schema.json" in recorded
    assert "untracked-v2.schema.json" in recorded
    assert (
        load("untracked.schema.json")["properties"]["schema_version"]["const"]
        == "wringer.untracked.v1"
    )
    assert (
        load("untracked-v2.schema.json")["properties"]["schema_version"]["const"]
        == "wringer.untracked.v2"
    )


def test_a_tree_with_nothing_untracked_writes_no_untracked_file(
    repo, write_config, monkeypatch, capsys
):
    """An empty sibling would be a claim about a tree state that never
    existed. Absence is the honest record."""
    write_config(repo, TWO_GATES)
    # commit the config, so the only untracked thing left is `.wringer/`
    # itself — which is deliberately never digested
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True,
                   capture_output=True)
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@e.invalid",
         "-c", "commit.gpgsign=false", "commit", "-qm", "config"],
        cwd=repo, check=True, capture_output=True,
    )
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    assert not (only_bundle(repo) / evidence.UNTRACKED_FILENAME).exists()


def test_a_real_untracked_file_validates_against_the_real_engine(
    repo, write_config, monkeypatch, capsys
):
    built = validators()
    write_config(repo, TWO_GATES)
    (repo / "loose.txt").write_text("x\n", encoding="utf-8")
    (repo / "run.sh").write_text("#!/bin/sh\n", encoding="utf-8")
    (repo / "run.sh").chmod(0o755)
    (repo / "link").symlink_to("loose.txt")
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    recorded = json.loads(
        (only_bundle(repo) / evidence.UNTRACKED_FILENAME).read_text(encoding="utf-8")
    )
    errors = [
        f"{e.json_path} {e.message}"
        for e in built["untracked-v2.schema.json"].iter_errors(recorded)
    ]
    assert not errors, "\n".join(errors)
    # all three modes exercised against the real engine, not just 100644
    assert {v.split(":")[0] for v in recorded["files"].values()} == {
        "100644", "100755", "120000"
    }, recorded["files"]


# --- wringer.fleet.v1 and wringer.judge.v1 ---------------------------------
#
# Both were declared frozen at v0.2.0 in schema/README with no schema FILE, so
# the freeze was unverifiable — a promise about a format nobody had written
# down. These publish them, and the freeze guard now covers them like the rest.
#
# Modelled on what 0.2.0 WRITES, warts included. `task.finished` carries three
# disjoint key sets under one `type`; the schema has three branches rather
# than a tidied-up single one, because law 7 freezes the format that shipped,
# not the format that would have been neater.


def fleet_branch(event: dict) -> dict:
    """The one fleet-event branch that describes this event.

    `branch()` above matches on the `type` const alone, which cannot work
    here: three branches share `task.finished`. This picks by the whole key
    set and asserts the match is unambiguous — an event matching two branches
    would mean the schema cannot tell two shapes apart, which is worse than
    no schema.
    """
    written = set(event)
    matches = [
        option
        for option in load("fleet-event.schema.json")["oneOf"]
        if option["properties"]["type"]["const"] == event["type"]
        and set(option.get("required", ())) <= written
        and written <= set(option["properties"])
    ]
    assert len(matches) == 1, (
        f"{event['type']} with keys {sorted(written)} matched "
        f"{len(matches)} schema branches; exactly one must describe it"
    )
    return matches[0]


def fleet_bundle(root: Path) -> Path:
    from wringer import fleet

    found = sorted((root / fleet.FLEETS_DIRNAME).iterdir())
    assert len(found) == 1, found
    return found[0]


def run_a_mixed_fleet(repo: Path, monkeypatch, capsys) -> Path:
    """A fleet producing succeeded, failed and parked in one bundle."""
    from test_fleet import FALLBACK_CONFIG, make_task

    good = make_task(repo, "good", "sh -c 'printf FIXED > work.txt'")
    bad = make_task(repo, "bad", "sh -c 'exit 1'")
    (repo / ".wringer.yaml").write_text(FALLBACK_CONFIG, encoding="utf-8")
    (repo / "tasks.jsonl").write_text(
        json.dumps(good) + "\n" + json.dumps(bad) + "\n", encoding="utf-8"
    )
    monkeypatch.chdir(repo)
    cli.main(["fleet", "tasks.jsonl"])
    capsys.readouterr()
    return fleet_bundle(repo)


def test_a_real_fleet_bundle_matches_its_schemas(repo, monkeypatch, capsys):
    from wringer import fleet

    bundle = run_a_mixed_fleet(repo, monkeypatch, capsys)

    recorded = json.loads(
        (bundle / fleet.MANIFEST_FILENAME).read_text(encoding="utf-8")
    )
    check(recorded, load("fleet-manifest.schema.json"), "fleet manifest.json")
    assert recorded["schema_version"] == "wringer.fleet.v1"

    seen = set()
    for line in (bundle / fleet.EVENTS_FILENAME).read_text("utf-8").splitlines():
        event = json.loads(line)
        check(event, fleet_branch(event), f"fleet event {event['type']}")
        seen.add(event["type"])
    assert {"fleet.started", "task.started", "fleet.finished"} <= seen, seen


def test_a_real_fleet_bundle_validates_against_the_real_engine(
    repo, monkeypatch, capsys
):
    from wringer import fleet

    built = validators()
    bundle = run_a_mixed_fleet(repo, monkeypatch, capsys)

    errors = [
        f"manifest {e.json_path} {e.message}"
        for e in built["fleet-manifest.schema.json"].iter_errors(
            json.loads((bundle / fleet.MANIFEST_FILENAME).read_text("utf-8"))
        )
    ]
    for line in (bundle / fleet.EVENTS_FILENAME).read_text("utf-8").splitlines():
        event = json.loads(line)
        errors += [
            f"{event['type']} {e.json_path} {e.message}"
            for e in built["fleet-event.schema.json"].iter_errors(event)
        ]
    assert not errors, "\n".join(errors)


def test_every_fleet_event_shape_the_schema_declares_is_produced_somewhere():
    """The suite's own standard: a declared shape no fixture produces is a
    branch validated against nothing. `task.finished` has three, and two of
    them had no test until this slice."""
    declared = {
        option["title"] for option in load("fleet-event.schema.json")["oneOf"]
    }
    fleet_tests = (
        Path(__file__).resolve().parent / "test_fleet.py"
    ).read_text(encoding="utf-8")
    for needed in ("fallback", "exhausted"):
        assert needed in fleet_tests, (
            f"no fixture produces the {needed!r} shape, so its schema branch "
            "is checked against nothing"
        )
    assert len(declared) == 10, sorted(declared)


def test_a_real_judge_verdict_matches_its_schemas(repo, monkeypatch, capsys):
    """Dry run: `verdict` is null and `criteria` is empty, which are the two
    values a reader is most likely to misread. Null is not `needs_human` —
    one means nothing was judged, the other means a person must finish it."""
    from test_judge import setup_repo

    from wringer import judge

    setup_repo(repo)
    monkeypatch.chdir(repo)
    cli.main(["verify"])
    cli.main(["judge"])
    capsys.readouterr()

    found = sorted((repo / judge.VERDICTS_DIRNAME).iterdir())
    assert len(found) == 1, found

    recorded = json.loads(
        (found[0] / judge.VERDICT_FILENAME).read_text(encoding="utf-8")
    )
    check(recorded, load("judge-verdict.schema.json"), "verdict.json")
    assert recorded["schema_version"] == "wringer.judge.v1"
    assert recorded["mode"] == "dry_run"
    assert recorded["verdict"] is None
    assert recorded["criteria"] == []

    request = json.loads(
        (found[0] / judge.REQUEST_FILENAME).read_text(encoding="utf-8")
    )
    check(request, load("judge-request.schema.json"), "request.json")

    built = validators()
    errors = [
        f"verdict {e.json_path} {e.message}"
        for e in built["judge-verdict.schema.json"].iter_errors(recorded)
    ] + [
        f"request {e.json_path} {e.message}"
        for e in built["judge-request.schema.json"].iter_errors(request)
    ]
    assert not errors, "\n".join(errors)


def test_response_json_is_deliberately_unschematised():
    """A schema for an arbitrary endpoint body could only be permissive
    enough to guarantee nothing, and this project does not publish vacuous
    guarantees. schema/README says so; this stops one appearing quietly."""
    assert not (SCHEMA_DIR / "judge-response.schema.json").exists()
    readme = (SCHEMA_DIR / "README.md").read_text(encoding="utf-8")
    assert "response.json" in readme, (
        "the absence of a response.json schema is a decision, and a decision "
        "nobody wrote down is indistinguishable from an oversight"
    )


# --- wringer.attestation.v1 ------------------------------------------------


def _attested(repo: Path, monkeypatch, capsys) -> dict:
    """A real attestation over a real verified change, with a delivery so the
    optional clauses are exercised rather than declared and never written."""
    from test_attest import CONFIG, git

    upstream = repo.parent / f"{repo.name}-schema-attest.git"
    git(repo, "init", "--bare", "-b", "main", str(upstream))
    git(repo, "remote", "add", "origin", f"file://{upstream}")
    (repo / ".wringer.yaml").write_text(CONFIG, encoding="utf-8")
    (repo / ".gitignore").write_text(".wringer/\n", encoding="utf-8")
    git(repo, "add", "-A")
    git(repo, "commit", "-m", "config")
    git(repo, "push", "-u", "origin", "main")
    (repo / "feature.py").write_text("def added():\n    return 1\n", "utf-8")
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    assert cli.main(["deliver"]) == cli.EXIT_OK
    assert cli.main(["attest"]) == cli.EXIT_OK
    capsys.readouterr()

    from wringer import attest

    written = sorted((repo / attest.ATTESTATIONS_DIRNAME).iterdir())[0]
    return json.loads(
        (written / attest.ATTESTATION_FILENAME).read_text(encoding="utf-8")
    )


def test_a_real_attestation_matches_its_schema(repo, monkeypatch, capsys):
    payload = _attested(repo, monkeypatch, capsys)
    schema = load("attestation.schema.json")

    check(payload, schema, "attestation.json")
    assert payload["schema_version"] == "wringer.attestation.v1"
    # the nested objects too — drift hides in them, not at the top level
    for name in ("change", "proven_by", "delivered_as"):
        check(payload[name], schema["properties"][name], f"attestation {name}")
    check(
        payload["change"]["commit_signature"],
        schema["properties"]["change"]["properties"]["commit_signature"],
        "attestation commit_signature",
    )
    for ref in payload["bundles"]:
        check(ref, schema["properties"]["bundles"]["items"], "attestation bundle")


def test_a_real_attestation_validates_against_the_real_engine(
    repo, monkeypatch, capsys
):
    built = validators()
    payload = _attested(repo, monkeypatch, capsys)

    errors = [
        f"{e.json_path} {e.message}"
        for e in built["attestation.schema.json"].iter_errors(payload)
    ]
    assert not errors, "\n".join(errors)


def test_the_attestation_schema_declares_the_clauses_that_may_be_absent():
    """"The clauses it lacks inputs for are absent, not invented." A schema
    that made them required would force the invention."""
    schema = load("attestation.schema.json")
    required = set(schema["required"])

    for optional in ("authorized_by", "judged_by", "delivered_as"):
        assert optional in schema["properties"], optional
        assert optional not in required, f"{optional} must be allowed to be absent"
    assert {"schema_version", "limits", "signature", "proven_by", "bundles"} <= (
        required
    )
    # v0 is unsigned, and the schema says so rather than leaving a seat
    assert schema["properties"]["signature"] == {
        "description": schema["properties"]["signature"]["description"],
        "type": "null",
    }


# --- wringer.vacuity.v1 ----------------------------------------------------


def _proved(repo: Path, monkeypatch, capsys, config_body: str) -> dict:
    from test_vacuity import git

    from wringer import vacuity

    (repo / "README.md").write_text("a project\n", encoding="utf-8")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "initial")
    (repo / "calc.py").write_text("FIXED\n", encoding="utf-8")
    (repo / ".wringer.yaml").write_text(config_body, encoding="utf-8")
    monkeypatch.chdir(repo)
    assert cli.main(["verify", "--prove"]) == cli.EXIT_OK
    capsys.readouterr()

    run_dir = sorted((repo / evidence.RUNS_DIRNAME).iterdir())[-1]
    return json.loads(
        (run_dir / vacuity.VACUITY_FILENAME).read_text(encoding="utf-8")
    )


def test_a_real_vacuity_verdict_matches_its_schema(repo, monkeypatch, capsys):
    """Both halves exercised: a `sensitive` row with its citation, and the
    `setup` object, which is null on every run that declares no setup."""
    recorded = _proved(
        repo, monkeypatch, capsys,
        'version: 1\ngates:\n  - id: test\n    run: "grep -q FIXED calc.py"\n'
        'run:\n  worker: "true"\n  prove_setup: "true"\n',
    )
    schema = load("vacuity.schema.json")

    check(recorded, schema, "vacuity.json")
    assert recorded["schema_version"] == "wringer.vacuity.v1"
    check(recorded["setup"], schema["properties"]["setup"], "vacuity setup")
    for row in recorded["gates"]:
        check(row, schema["properties"]["gates"]["items"], "vacuity gate row")
    # the optional keys really were exercised, or this proves less than it looks
    assert any(row["sensitive"] for row in recorded["gates"])
    assert any(row["cites"] for row in recorded["gates"])


def test_a_real_vacuity_verdict_validates_against_the_real_engine(
    repo, monkeypatch, capsys
):
    built = validators()
    recorded = _proved(
        repo, monkeypatch, capsys,
        'version: 1\ngates:\n  - id: test\n    run: "grep -q FIXED calc.py"\n',
    )

    errors = [
        f"{e.json_path} {e.message}"
        for e in built["vacuity.schema.json"].iter_errors(recorded)
    ]
    assert not errors, "\n".join(errors)
    assert recorded["setup"] is None  # the no-setup shape, also legal


def test_every_vacuity_verdict_the_schema_declares_is_reachable():
    """A schema branch nothing can produce is a claim without a gate."""
    from wringer import vacuity

    declared = set(load("vacuity.schema.json")["properties"]["verdict"]["enum"])
    produced = {
        vacuity.PROVEN, vacuity.GATES_VACUOUS, vacuity.NOT_APPLICABLE,
        vacuity.INCONCLUSIVE,
    }
    assert declared == produced, declared ^ produced


# --- wringer.bench.v1 -------------------------------------------------------
#
# Published in the same commit as the code that writes them, drift-tested
# against a REAL bench rather than a hand-built fixture, and frozen. The
# format carries no ordering field of any kind: ruling 6 is a property of the
# schema, not only of the renderer, so a future sort has nowhere to record
# itself.


def run_a_real_bench(repo: Path, git_run, monkeypatch, capsys) -> Path:
    from test_bench import ORDER_CONFIG, only_bench, setup

    setup(repo, git_run, config=ORDER_CONFIG)
    monkeypatch.chdir(repo)
    assert cli.main(["bench"]) == 0
    capsys.readouterr()
    return only_bench(repo)


def test_a_real_bench_bundle_matches_its_schemas(repo, git_run, monkeypatch, capsys):
    from wringer import bench

    bundle = run_a_real_bench(repo, git_run, monkeypatch, capsys)

    recorded = json.loads(
        (bundle / bench.MANIFEST_FILENAME).read_text(encoding="utf-8")
    )
    check(recorded, load("bench-manifest-v2.schema.json"), "bench manifest.json")
    assert recorded["schema_version"] == "wringer.bench.v2"
    # One attempt each — the default — so the row keys are exactly the ones v1
    # published, and `attempt` / `attempts` / `parallel` are absent. That
    # absence is the compatibility claim, not an omission.
    assert "attempts" not in recorded
    assert "parallel" not in recorded
    assert not any("attempt" in row for row in recorded["contenders"])

    # The rows are objects with their own declared shape; `check` is shallow,
    # so the item schema is applied to each row by hand.
    row_schema = load("bench-manifest-v2.schema.json")["properties"]["contenders"][
        "items"
    ]
    for row in recorded["contenders"]:
        check(row, row_schema, f"contender row {row['contender']}")

    seen = set()
    for line in (bundle / bench.EVENTS_FILENAME).read_text("utf-8").splitlines():
        event = json.loads(line)
        check(
            event,
            branch(event["type"], "bench-event-v2.schema.json"),
            f"bench event {event['type']}",
        )
        seen.add(event["type"])
    assert seen == {
        "bench.started",
        "baseline.verified",
        "contender.started",
        "contender.finished",
        "bench.finished",
    }, seen


def test_a_real_bench_bundle_validates_against_the_real_engine(
    repo, git_run, monkeypatch, capsys
):
    from wringer import bench

    built = validators()
    bundle = run_a_real_bench(repo, git_run, monkeypatch, capsys)

    errors = [
        f"manifest {e.json_path} {e.message}"
        for e in built["bench-manifest-v2.schema.json"].iter_errors(
            json.loads((bundle / bench.MANIFEST_FILENAME).read_text("utf-8"))
        )
    ]
    for line in (bundle / bench.EVENTS_FILENAME).read_text("utf-8").splitlines():
        event = json.loads(line)
        errors += [
            f"{event['type']} {e.json_path} {e.message}"
            for e in built["bench-event-v2.schema.json"].iter_errors(event)
        ]
    assert not errors, "\n".join(errors)


def test_every_bench_event_shape_the_schema_declares_is_produced():
    """A declared branch no fixture produces is a branch validated against
    nothing — this suite's own standard, and the reason `contender.skipped`
    is NOT in the schema: SPEC_BENCH_V0 §4 lists it, and `bench.py` emits it
    nowhere, so declaring it would publish a shape with no producer and no
    test."""
    declared = {
        option["title"] for option in load("bench-event-v2.schema.json")["oneOf"]
    }
    assert declared == {
        "bench.started",
        "baseline.verified",
        "contender.started",
        "contender.finished",
        "bench.finished",
    }, sorted(declared)

    source = (
        Path(__file__).resolve().parent.parent / "src" / "wringer" / "bench.py"
    ).read_text(encoding="utf-8")
    for name in declared:
        assert f'"{name}"' in source, f"{name} is declared but written nowhere"
    assert "contender.skipped" not in source, (
        "bench.py grew a contender.skipped event; the schema must declare it "
        "and a fixture must produce it, or neither"
    )


def test_no_bench_schema_carries_a_field_that_could_order_contenders():
    """Ruling 6 as a property of the FORMAT, not of the renderer.

    A rank, score or position field would be the crown put back on by the
    schema after the spec refused to award it — and an auto-ranked bench
    systematically rewards reward-hacking, because rewriting a failing test
    into a tautology converges faster than an honest fix."""
    banned = ("rank", "score", "winner", "position", "place", "fastest", "best")
    for name in ("bench-event-v2.schema.json", "bench-manifest-v2.schema.json"):
        text = json.dumps(load(name))
        # Property NAMES only: the descriptions say "no winner" on purpose.
        found = [
            word
            for word in banned
            if f'"{word}":' in text or f'"{word}s":' in text
        ]
        assert not found, f"{name} declares an ordering field: {found}"


def test_the_schema_readme_lists_every_published_schema():
    """A hand-kept list beside a directory that grows is a list that falls
    behind, and this one had: `usage`, `graph-event` and `graph-manifest`
    shipped without a row, so the index a reader targets the format from was
    describing a smaller repo than the one they had. Derived, so it cannot
    happen again — the same lesson as the release probe that counted thirteen
    of seventeen commands while printing "all thirteen present"."""
    readme = (SCHEMA_DIR / "README.md").read_text(encoding="utf-8")
    published = sorted(path.name for path in SCHEMA_DIR.glob("*.schema.json"))
    missing = [name for name in published if f"[`{name}`]({name})" not in readme]
    assert not missing, (
        f"schema/README.md has no row for: {missing}. Published formats other "
        "tools target must be findable from the index, or the index is a "
        "narrower claim than the directory."
    )


# --- wringer.health.v1 ------------------------------------------------------
#
# A DERIVED VIEW, not a bundle — so unlike every schema above it describes
# something that is never written under `.wringer/`. It is published and
# frozen anyway, and for a sharper reason: the shipped GitHub Action step and
# strangers' scripts parse this, and an unschema'd shape consumed by
# automation is a format nobody promised to keep.


def test_a_real_health_report_matches_its_schema(repo, monkeypatch, capsys):
    from test_health import declared, plant, repo_with

    from wringer import health

    repo_with(repo)
    plant(repo, 12)
    monkeypatch.chdir(repo)

    coverage = health.discover(repo)
    report = health.as_json(coverage, health.assess(coverage, declared()))

    schema = load("health-report.schema.json")
    check(report, schema, "health report")
    assert report["schema_version"] == "wringer.health.v1"

    check(report["coverage"], schema["properties"]["coverage"], "coverage")
    gate_schema = schema["$defs"]["gate"]
    assert report["gates"], "the fixture produced no gate rows to check"
    for gate in report["gates"] + report["retired"]:
        check(gate, gate_schema, f"gate {gate['gate_id']}")
        check(gate["drift"], gate_schema["properties"]["drift"], "drift")


def test_a_real_health_report_validates_against_the_real_engine(
    repo, monkeypatch, capsys
):
    from test_health import declared, plant, repo_with

    from wringer import health

    repo_with(repo)
    plant(repo, 12)
    monkeypatch.chdir(repo)

    coverage = health.discover(repo)
    report = health.as_json(coverage, health.assess(coverage, declared()))

    errors = [
        f"{e.json_path} {e.message}"
        for e in validators()["health-report.schema.json"].iter_errors(report)
    ]
    assert not errors, "\n".join(errors)


def test_every_health_verdict_the_schema_declares_is_reachable():
    """A declared enum value nothing can produce is a branch validated against
    nothing. All four are reachable, and `retired` is the one added because a
    pair-scoped window FREEZES for a deleted gate and would read `alive`
    forever."""
    from wringer import health

    declared_verdicts = set(
        load("health-report.schema.json")["$defs"]["gate"]["properties"][
            "verdict"
        ]["enum"]
    )
    assert declared_verdicts == {
        health.ALIVE, health.ZOMBIE, health.UNTESTED, health.RETIRED
    }, sorted(declared_verdicts)


def test_the_health_schema_demands_all_four_limits():
    """`minItems` is the schema's half of the content pinning. A `limits`
    array checked only for existence passes against one entry reading
    "none"."""
    schema = load("health-report.schema.json")
    assert schema["properties"]["limits"]["minItems"] == 4


# --- wringer.acceptance.v1 --------------------------------------------------
#
# Published in the same commit as the code that writes it, drift-tested
# against a REAL verify run rather than a hand-built fixture, and frozen.


def run_with_acceptance(repo: Path, monkeypatch, capsys) -> Path:
    from test_accept import bound_config, write_spec

    write_spec(repo)
    (repo / "calc.py").write_text("BROKEN\n", encoding="utf-8")
    bound_config(repo, command="grep -q FIXED calc.py")
    monkeypatch.chdir(repo)
    cli.main(["verify"])                       # red — recorded
    (repo / "calc.py").write_text("FIXED\n", encoding="utf-8")
    cli.main(["verify"])                       # green — evidenced
    capsys.readouterr()
    found = evidence.latest_run(repo / evidence.RUNS_DIRNAME)
    assert found is not None
    return found


def test_a_real_acceptance_artifact_matches_its_schema(repo, monkeypatch, capsys):
    from wringer import accept

    run = run_with_acceptance(repo, monkeypatch, capsys)
    recorded = json.loads(
        (run / accept.ACCEPTANCE_FILENAME).read_text(encoding="utf-8")
    )
    schema = load("acceptance.schema.json")
    check(recorded, schema, "acceptance.json")
    assert recorded["schema_version"] == "wringer.acceptance.v1"

    row_schema = schema["properties"]["criteria"]["items"]
    for row in recorded["criteria"]:
        check(row, row_schema, f"criterion {row['criterion']}")
    check(recorded["counts"], schema["properties"]["counts"], "counts")

    # The fixture is only load-bearing if it exercised the evidenced path.
    assert recorded["counts"]["evidenced"] == 1, recorded


def test_a_real_acceptance_artifact_validates_against_the_real_engine(
    repo, monkeypatch, capsys
):
    from wringer import accept

    built = validators()
    run = run_with_acceptance(repo, monkeypatch, capsys)
    errors = [
        f"{e.json_path} {e.message}"
        for e in built["acceptance.schema.json"].iter_errors(
            json.loads((run / accept.ACCEPTANCE_FILENAME).read_text("utf-8"))
        )
    ]
    assert not errors, "\n".join(errors)


def test_every_acceptance_state_the_schema_declares_is_produced_somewhere():
    """A declared value no fixture produces is a value validated against
    nothing — this suite's own standard, applied to the state enum."""
    from wringer import accept

    declared = set(
        load("acceptance.schema.json")["properties"]["criteria"]["items"][
            "properties"
        ]["state"]["enum"]
    )
    assert declared == set(accept.STATES), sorted(declared)

    tests = (
        Path(__file__).resolve().parent / "test_accept.py"
    ).read_text(encoding="utf-8")
    for state in declared:
        assert f'accept.{state.upper().replace("-", "_")}' in tests, (
            f"the schema declares state {state!r} and no test produces it"
        )


# --- wringer.gatespec.v1 ----------------------------------------------------
#
# SOURCE, not evidence — like the rubric, and for the same reason: it sits in
# the repository rather than under `.wringer/`. Published and frozen anyway,
# because a stranger's tooling may write one (an offline repo writes it by
# hand, ruling 5) and a format nobody promised to keep is not a format.


def test_a_drafted_gate_sidecar_matches_its_schema(repo, monkeypatch, capsys):
    """The real file the real command writes, against the published schema —
    not a hand-built lookalike."""
    from wringer import config as config_module
    from wringer import spec as spec_module

    gates = (
        config_module.Gate(
            id="acc-header", run="pytest -q acceptance/test_header.py",
            timeout=300, proves="header-matches-columns",
        ),
        config_module.Gate(
            id="acc-rows", run="pytest -q acceptance/test_rows.py",
            proves="every-row-exported",
        ),
    )
    path = repo / spec_module.GATESPEC_FILENAME
    path.write_text(spec_module.render_gatespec(gates), encoding="utf-8")

    import yaml

    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    check(document, load("gatespec.schema.json"), "wringer.gates.yaml")

    built = validators()["gatespec.schema.json"]
    errors = [
        f"{e.json_path} {e.message}" for e in built.iter_errors(document)
    ]
    assert not errors, "\n".join(errors)


def test_what_the_sidecar_renderer_writes_round_trips_through_its_reader():
    """The renderer and the parser are the drift pair here — a file the
    command writes and its own loader rejects is the shape that shipped
    twice in this repo's history."""
    import yaml

    from wringer import config as config_module
    from wringer import spec as spec_module
    from wringer.rubric import Criterion

    gates = (
        config_module.Gate(
            id="acc-header", run='pytest -q "a b.py"', proves="c-one"
        ),
        config_module.Gate(
            id="acc-rows", run="pytest -q", timeout=45, proves="c-two"
        ),
    )
    text = spec_module.render_gatespec(gates)
    criteria = (
        Criterion(id="c-one", title="One"),
        Criterion(id="c-two", title="Two"),
    )
    back = spec_module.parse_gatespec(
        yaml.safe_load(text), spec_module.GATESPEC_FILENAME, criteria
    )

    assert [g.id for g in back] == ["acc-header", "acc-rows"]
    assert [g.run for g in back] == ['pytest -q "a b.py"', "pytest -q"]
    assert [g.timeout for g in back] == [
        config_module.DEFAULT_TIMEOUT_SECONDS, 45
    ]
    assert [g.proves for g in back] == ["c-one", "c-two"]


# --- wringer.stability.v1 (SPEC_STABILITY_V0.md) -----------------------------


def _flaked(repo: Path, monkeypatch, capsys, tmp_path: Path) -> dict:
    """A real run of a real gate that really alternates, and its record."""
    from wringer import stability

    counter = tmp_path / "counter"
    # `steady` FIRST, because a required failure stops the run: with the
    # flaky gate ahead of it the second row would never be written, and this
    # test would be checking the schema against one classification.
    (repo / ".wringer.yaml").write_text(
        "version: 1\ngates:\n"
        "  - id: steady\n    run: 'true'\n"
        "    stability:\n      attempts: 2\n"
        "  - id: coin\n"
        f'    run: "n=$(cat {counter} 2>/dev/null || echo 0); n=$((n+1)); '
        f'printf %s $n > {counter}; [ $((n % 2)) -eq 1 ]"\n'
        "    stability:\n      attempts: 3\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_GATE_FAILED
    capsys.readouterr()
    run_dir = sorted((repo / evidence.RUNS_DIRNAME).iterdir())[-1]
    return json.loads(
        (run_dir / stability.STABILITY_FILENAME).read_text(encoding="utf-8")
    )


def test_a_real_stability_record_matches_its_schema(
    repo, monkeypatch, capsys, tmp_path
):
    recorded = _flaked(repo, monkeypatch, capsys, tmp_path)
    schema = load("stability.schema.json")
    row_schema = schema["properties"]["gates"]["items"]

    check(recorded, schema, "stability.json")
    assert recorded["schema_version"] == "wringer.stability.v1"
    for row in recorded["gates"]:
        check(row, row_schema, f"stability row {row['gate_id']}")
        for attempt in row["attempts"]:
            check(
                attempt,
                row_schema["properties"]["attempts"]["items"],
                f"attempt {attempt['attempt']}",
            )
    # both classifications really were exercised, or this test proves less than
    # it looks like it does — a schema that only ever sees `flaky` has never
    # been checked against the shape a passing gate writes
    assert {row["classification"] for row in recorded["gates"]} == {
        "flaky",
        "stable_pass",
    }


def test_a_real_stability_record_validates_against_the_real_engine(
    repo, monkeypatch, capsys, tmp_path
):
    built = validators()
    recorded = _flaked(repo, monkeypatch, capsys, tmp_path)

    errors = [
        f"{e.json_path} {e.message}"
        for e in built["stability.schema.json"].iter_errors(recorded)
    ]
    assert not errors, "\n".join(errors)


def test_every_classification_the_schema_declares_is_reachable():
    """A schema value no code can produce is a promise nobody keeps."""
    from wringer import stability

    declared = set(
        load("stability.schema.json")["properties"]["gates"]["items"]["properties"][
            "classification"
        ]["enum"]
    )
    assert declared == set(stability.CLASSIFICATIONS)


def test_every_routing_word_the_schema_declares_is_reachable():
    from wringer import stability

    declared = set(
        load("stability.schema.json")["properties"]["gates"]["items"]["properties"][
            "routing"
        ]["enum"]
    )
    assert declared == {
        stability.REPAIR,
        stability.NO_REPAIR,
        stability.NOTHING_TO_REPAIR,
    }
