"""The gate-artifact slot — SPEC_BOARD_V0 §10, slice S4.

Two things this file exists to hold, and they pull in opposite directions:

- a gate CAN now leave a picture for a person to look at, which is what
  PM_ARC §3.4's *"the criterion shows itself"* needed and had nowhere to put;
- **and nothing about that is redacted if it is binary**, which is why it is
  opt-in per gate, why the limit is written into the record itself, and why an
  over-cap file is omitted and named rather than truncated.

The compatibility boundary is ABSENCE, so most of these tests are about a
bundle that looks exactly as it did before this feature existed.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wringer import artifacts, config, gates
from wringer.redact import Redactor

SCHEMA_DIR = Path(artifacts.__file__).parents[2] / "schema"

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
)


def gate(artifacts_setting=None, gid="shot"):
    return config.Gate(id=gid, run="true", artifacts=artifacts_setting)


# --- absence is the compatibility boundary ---------------------------------


def test_a_gate_that_never_opted_in_gets_no_directory_and_no_env_var(tmp_path):
    """Byte-identical to before this feature existed, which is the promise."""
    assert artifacts.prepare(tmp_path, gate()) is None
    assert not (tmp_path / artifacts.DIRNAME).exists()
    env = artifacts.environment(None, base={"PATH": "/usr/bin"})
    assert artifacts.ENV_VAR not in env
    assert artifacts.collect(tmp_path, gate()) is None
    assert not (tmp_path / artifacts.FILENAME).exists()


def test_artifacts_false_behaves_exactly_like_never_mentioning_it(tmp_path):
    """There is no third state. `artifacts: false` must be indistinguishable
    from a gate that never heard of the feature."""
    parsed = config.parse_gate(
        {"id": "g", "run": "true", "artifacts": False}, 0, ".wringer.yaml",
        allow_proves=True,
    )
    assert parsed.artifacts is None
    assert artifacts.prepare(tmp_path, parsed) is None


def test_an_opted_in_gate_that_writes_nothing_leaves_no_record(tmp_path):
    """Opting in is permission, not a promise that something was produced. A
    record saying "zero artifacts" would be a claim where absence is the fact."""
    settings = config.Artifacts()
    artifacts.prepare(tmp_path, gate(settings))
    assert artifacts.collect(tmp_path, gate(settings)) is None
    assert not (tmp_path / artifacts.FILENAME).exists()


def test_the_gate_is_handed_the_directory_by_environment_variable(tmp_path):
    settings = config.Artifacts()
    directory = artifacts.prepare(tmp_path, gate(settings))
    assert directory == tmp_path / artifacts.DIRNAME
    assert directory.is_dir()
    env = artifacts.environment(directory, base={"PATH": "/usr/bin"})
    assert env[artifacts.ENV_VAR] == str(directory)
    assert env["PATH"] == "/usr/bin", "the rest of the environment survives"


# --- what is recorded, and what is not -------------------------------------


def test_it_records_a_name_a_size_a_digest_and_a_type_and_nothing_else(tmp_path):
    """**No caption, no label, no meaning.** The harness does not get to say
    what a picture shows, and the schema is closed so it cannot start."""
    import hashlib

    settings = config.Artifacts()
    directory = artifacts.prepare(tmp_path, gate(settings))
    (directory / "before.png").write_bytes(PNG)

    path = artifacts.collect(tmp_path, gate(settings))
    record = json.loads(path.read_text(encoding="utf-8"))

    assert record["schema_version"] == artifacts.SCHEMA_VERSION
    assert record["gate"] == "shot"
    row = record["artifacts"][0]
    assert set(row) == {"name", "bytes", "sha256", "media_type", "redacted"}
    assert row["name"] == "before.png"
    assert row["bytes"] == len(PNG)
    assert row["sha256"] == hashlib.sha256(PNG).hexdigest()
    assert row["media_type"] == "image/png"
    assert row["redacted"] is False


def test_a_binary_is_never_marked_redacted_even_with_a_redactor(tmp_path):
    """**The load-bearing refusal of the whole slice**, and the obvious reason
    for it is the wrong one. `redact.py` HAS a `scrub_bytes` and could be
    pointed at a PNG. It is not, because substring replacement changes length,
    so scrubbing inside a compressed format produces a CORRUPT file that still
    reads as evidence — the same defect ruling 25 refuses about truncation. A
    row claiming `redacted: true` here would be the format lying about the one
    thing a reader needs to know."""
    settings = config.Artifacts()
    directory = artifacts.prepare(tmp_path, gate(settings))
    (directory / "shot.png").write_bytes(PNG)

    record = json.loads(
        artifacts.collect(
            tmp_path, gate(settings), Redactor(secrets=("hunter2",))
        ).read_text(encoding="utf-8")
    )
    assert record["artifacts"][0]["redacted"] is False
    # And the bytes are EXACTLY what the gate wrote. A length-changing
    # substring pass over a compressed format would corrupt it.
    assert (directory / "shot.png").read_bytes() == PNG


def test_a_text_artifact_IS_scrubbed_like_any_other_captured_text(tmp_path):
    settings = config.Artifacts()
    directory = artifacts.prepare(tmp_path, gate(settings))
    (directory / "notes.txt").write_text("token=hunter2 rest", encoding="utf-8")

    redactor = Redactor(secrets=("hunter2",))
    record = json.loads(
        artifacts.collect(tmp_path, gate(settings), redactor).read_text("utf-8")
    )
    row = record["artifacts"][0]
    assert row["redacted"] is True
    on_disk = (directory / "notes.txt").read_text(encoding="utf-8")
    assert "hunter2" not in on_disk
    assert row["bytes"] == len(on_disk.encode("utf-8"))


def test_bytes_that_lie_about_being_text_are_trusted_over_the_extension(tmp_path):
    """A `.txt` holding undecodable bytes is not redactable, and the row must
    not claim it was. Trust the bytes."""
    settings = config.Artifacts()
    directory = artifacts.prepare(tmp_path, gate(settings))
    (directory / "claims.txt").write_bytes(b"\xff\xfe\x00binary")

    record = json.loads(
        artifacts.collect(tmp_path, gate(settings), Redactor()).read_text("utf-8")
    )
    assert record["artifacts"][0]["redacted"] is False


def test_the_limits_travel_with_the_record(tmp_path):
    """The `acceptance.json` precedent: what it does not say lives beside the
    numbers, not in a spec nobody opened."""
    settings = config.Artifacts()
    directory = artifacts.prepare(tmp_path, gate(settings))
    (directory / "a.png").write_bytes(PNG)
    record = json.loads(
        artifacts.collect(tmp_path, gate(settings)).read_text("utf-8")
    )
    joined = "\n".join(record["limits"])
    assert "does not caption, label or interpret" in joined
    assert "is NOT redacted and cannot be" in joined
    assert "never truncated" in joined


# --- omitted and named, never truncated ------------------------------------


def test_an_over_cap_artifact_is_omitted_and_NAMED_never_truncated(tmp_path):
    """A truncated PNG is a corrupt PNG that still reads as evidence.
    `stdout_truncated` works only because text survives truncation."""
    settings = config.Artifacts(max_bytes=10, total_bytes=1000)
    directory = artifacts.prepare(tmp_path, gate(settings))
    (directory / "big.png").write_bytes(PNG)

    record = json.loads(
        artifacts.collect(tmp_path, gate(settings)).read_text("utf-8")
    )
    assert record["artifacts"] == []
    assert record["omitted"] == [
        {"name": "big.png", "reason": "too_large", "bytes": len(PNG)}
    ]
    # And the file itself is untouched — not shortened, not deleted.
    assert (directory / "big.png").read_bytes() == PNG


def test_the_total_cap_omits_and_names_the_overflow(tmp_path):
    settings = config.Artifacts(max_bytes=1000, total_bytes=len(PNG) + 1)
    directory = artifacts.prepare(tmp_path, gate(settings))
    (directory / "a.png").write_bytes(PNG)
    (directory / "b.png").write_bytes(PNG)

    record = json.loads(
        artifacts.collect(tmp_path, gate(settings)).read_text("utf-8")
    )
    assert [r["name"] for r in record["artifacts"]] == ["a.png"]
    assert record["omitted"] == [
        {"name": "b.png", "reason": "total_exceeded", "bytes": len(PNG)}
    ]


def test_the_total_cap_decision_is_deterministic_not_filesystem_ordered(tmp_path):
    """Two runs over the same files must produce byte-identical records. A cap
    that omitted a different file each run would make the bundle
    unreproducible, which is the one thing it may not be."""
    settings = config.Artifacts(max_bytes=1000, total_bytes=len(PNG) + 1)
    first = tmp_path / "one"
    second = tmp_path / "two"
    for root in (first, second):
        directory = artifacts.prepare(root, gate(settings))
        for name in ("z.png", "a.png", "m.png"):
            (directory / name).write_bytes(PNG)
    a = artifacts.collect(first, gate(settings)).read_bytes()
    b = artifacts.collect(second, gate(settings)).read_bytes()
    assert a == b
    assert json.loads(a)["artifacts"][0]["name"] == "a.png"


def test_an_unknown_extension_is_omitted_and_named(tmp_path):
    """A CLOSED allow-list: 'whatever the extension says' is how an unexpected
    type reaches a renderer."""
    settings = config.Artifacts()
    directory = artifacts.prepare(tmp_path, gate(settings))
    (directory / "thing.exe").write_bytes(b"MZ")

    record = json.loads(
        artifacts.collect(tmp_path, gate(settings)).read_text("utf-8")
    )
    assert record["artifacts"] == []
    assert record["omitted"] == [{"name": "thing.exe", "reason": "unknown_type"}]


def test_every_omission_reason_is_in_the_closed_tuple_and_the_schema():
    """Both directions. A reason the code can emit and the schema rejects
    writes records nothing validates; one the schema declares and the code
    cannot produce is dead text reading as coverage."""
    schema = json.loads(
        (SCHEMA_DIR / "gate-artifacts.schema.json").read_text(encoding="utf-8")
    )
    declared = set(
        schema["properties"]["omitted"]["items"]["properties"]["reason"]["enum"]
    )
    assert declared == set(artifacts.OMISSION_REASONS)


# --- the record validates, and the version costs nothing -------------------


def test_the_record_validates_against_its_own_schema(tmp_path):
    jsonschema = pytest.importorskip("jsonschema")
    settings = config.Artifacts(max_bytes=10, total_bytes=1000)
    directory = artifacts.prepare(tmp_path, gate(settings))
    (directory / "small.txt").write_text("fine", encoding="utf-8")
    (directory / "big.png").write_bytes(PNG)
    (directory / "odd.exe").write_bytes(b"MZ")

    record = json.loads(
        artifacts.collect(tmp_path, gate(settings), Redactor()).read_text("utf-8")
    )
    schema = json.loads(
        (SCHEMA_DIR / "gate-artifacts.schema.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(record, schema)
    assert len(record["artifacts"]) == 1
    assert len(record["omitted"]) == 2


def test_no_frozen_schema_gained_a_field():
    """**§11 acceptance criterion 5.** S4 adds exactly one schema file and no
    field on any frozen one — `result.json` gains nothing and means nothing
    new, which is the whole reason this is a sibling."""
    result_schema = json.loads(
        (SCHEMA_DIR / "gate-result.schema.json").read_text(encoding="utf-8")
    )
    assert result_schema["additionalProperties"] is False
    assert "artifacts" not in result_schema["properties"]
    assert len(result_schema["properties"]) == 9


def test_the_config_key_is_off_by_default_and_not_a_top_level_key():
    """Opt-in per gate, and nowhere else. A top-level switch would let a
    repository turn on unredactable capture for every gate at once."""
    plain = config.parse_gate(
        {"id": "g", "run": "true"}, 0, ".wringer.yaml", allow_proves=True
    )
    assert plain.artifacts is None
    assert "artifacts" not in config._TOP_LEVEL_KEYS
    assert "artifacts" in config._CONFIG_GATE_KEYS
    # And NOT in the drafter's set: `spec.schema.json` is frozen and closed, so
    # a drafted gate carrying it would fail its own published schema.
    assert "artifacts" not in config._GATE_KEYS


@pytest.mark.parametrize(
    "raw,match",
    [
        ({"max_bytes": 0}, "positive integer"),
        ({"max_bytes": "big"}, "positive integer"),
        ({"nope": 1}, "unknown keys"),
        ({"max_bytes": 100, "total_bytes": 10}, "could never bind"),
    ],
)
def test_a_malformed_artifacts_stanza_is_refused(raw, match):
    with pytest.raises(config.ConfigError, match=match):
        config.parse_gate(
            {"id": "g", "run": "true", "artifacts": raw}, 0, ".wringer.yaml",
            allow_proves=True,
        )


# --- end to end, through the real gate runner ------------------------------


def test_a_real_gate_writes_a_real_artifact(tmp_path):
    """Through `gates.run`, with a shell command that uses the environment
    variable — which is the whole interface a repository sees."""
    workdir = tmp_path / "gates" / "001_shot"
    workdir.mkdir(parents=True)
    declared = config.Gate(
        id="shot",
        run=f'printf "hello" > "${artifacts.ENV_VAR}/note.txt"',
        artifacts=config.Artifacts(),
    )
    result = gates.run(
        declared, tmp_path, workdir / "stdout.log", workdir / "stderr.log"
    )
    assert result.exit_code == 0

    record = json.loads((workdir / artifacts.FILENAME).read_text("utf-8"))
    assert [r["name"] for r in record["artifacts"]] == ["note.txt"]
    assert (workdir / artifacts.DIRNAME / "note.txt").read_text() == "hello"


def test_a_gate_without_the_key_sees_no_env_var_at_all(tmp_path):
    """The negative half, end to end: the variable is not merely empty."""
    workdir = tmp_path / "gates" / "001_plain"
    workdir.mkdir(parents=True)
    declared = config.Gate(
        id="plain", run=f'test -z "${artifacts.ENV_VAR}"'
    )
    result = gates.run(
        declared, tmp_path, workdir / "stdout.log", workdir / "stderr.log"
    )
    assert result.exit_code == 0, "the gate saw an artifacts directory"
    assert not (workdir / artifacts.FILENAME).exists()


def test_the_count_is_a_count_and_the_mr_body_never_carries_a_payload():
    """**Standing constraint.** The MR body may say '3 artifacts in the
    bundle' and may never carry one, link one, or embed one."""
    import ast

    source = Path(artifacts.__file__).parent / "deliver.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            assert "data:image" not in node.value
            assert artifacts.DIRNAME + "/" not in node.value
