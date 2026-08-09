"""`proves:` — the link between a criterion and the gate that evidences it.

SPEC_ACCEPT_V0.md §1 and §3, slice A1. The whole feature in one key: nothing
in this program has ever said "criterion `csv-export-downloads` is proven by
gate `test-csv-export`", and everything the acceptance bridge claims rests on
that join existing and being validated.

The rejection list here is **derived from the spec's own table**, not
hand-kept — the lesson from a release probe that counted thirteen of
seventeen commands while printing "all thirteen present". A rejection added
to the spec without a test, or a test dropped while its row survives, goes
red on the derivation test at the bottom of this file.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from wringer import config

SPEC = Path(__file__).resolve().parent.parent / "SPEC_ACCEPT_V0.md"

SPEC_YAML = """\
schema_version: wringer.spec.v1
approved: true
title: CSV export
intent: The reports page can export what it shows.
tasks:
  - id: build-export
    brief: Build the export endpoint
    objective: The reports page exports a CSV of what it shows.
criteria:
  - id: csv-downloads
    title: The export downloads a CSV
    required: true
  - id: copy-reads-well
    title: The copy reads the way our users speak
    required: true
    human: true
  - id: nice-to-have
    title: A tooltip explains the column order
    required: false
"""


def write_spec(repo: Path, text: str = SPEC_YAML) -> None:
    (repo / "wringer.spec.yaml").write_text(text, encoding="utf-8")


def write_config(repo: Path, gates: str) -> None:
    (repo / ".wringer.yaml").write_text(
        f"version: 1\ngates:\n{gates}", encoding="utf-8"
    )


def load(repo: Path):
    return config.load(repo / config.CONFIG_FILENAME)


# --- the join, when it is honest -------------------------------------------


def test_a_gate_can_name_the_criterion_it_proves(repo, tmp_path):
    """The feature. One line of config, and for the first time a gate says
    what it is FOR rather than only what it runs."""
    write_spec(repo)
    write_config(
        repo,
        '  - id: test-csv\n    run: "pytest -q tests/test_csv.py"\n'
        "    proves: csv-downloads\n",
    )
    cfg = load(repo)
    assert cfg.gates[0].proves == "csv-downloads"


def test_a_gate_without_proves_is_every_gate_that_exists_today(repo):
    """The opt-in boundary at the config layer: absence stays absence, and a
    repo that never heard of acceptance parses exactly as before."""
    write_config(repo, '  - id: test\n    run: "pytest -q"\n')
    assert load(repo).gates[0].proves is None


# --- the rejections, one test per row of the spec's table ------------------


def test_proves_naming_an_unknown_criterion_is_refused(repo):
    """A binding to nothing is a claim about nothing — and it is the typo
    that would otherwise render as an unevidenced debt nobody can explain."""
    write_spec(repo)
    write_config(
        repo, '  - id: t\n    run: "true"\n    proves: csv-downlods\n'
    )
    with pytest.raises(config.ConfigError) as excinfo:
        load(repo)
    said = str(excinfo.value)
    assert "csv-downlods" in said and "csv-downloads" in said, said


def test_proves_with_no_spec_file_at_all_is_refused(repo):
    """Same claim, one level up: there is no document of criteria to join to,
    so the gate is asserting a link to a file that does not exist."""
    write_config(
        repo, '  - id: t\n    run: "true"\n    proves: csv-downloads\n'
    )
    with pytest.raises(config.ConfigError) as excinfo:
        load(repo)
    assert "wringer.spec.yaml" in str(excinfo.value), excinfo.value


def test_two_gates_proving_the_same_criterion_are_refused(repo):
    """One criterion, one gate in v0. A second gate is a second claim to keep
    honest, and the artifact has one slot per criterion — silently letting the
    last one win would make the evidence depend on config ordering."""
    write_spec(repo)
    write_config(
        repo,
        '  - id: a\n    run: "true"\n    proves: csv-downloads\n'
        '  - id: b\n    run: "true"\n    proves: csv-downloads\n',
    )
    with pytest.raises(config.ConfigError) as excinfo:
        load(repo)
    said = str(excinfo.value)
    assert "csv-downloads" in said and "a" in said and "b" in said, said


def test_proves_on_an_optional_gate_is_refused(repo):
    """Evidence that cannot stop a run is a promise without enforcement — and
    `--prove` never proves optional gates (SPEC_VACUITY §6, binding), so the
    one-run remedy printed beside an unevidenced binding could never fire for
    one. The spec's first draft forbade only the optional-gate/required-
    criterion pairing; its review caught that the permitted remainder was a
    binding whose remedy was impossible."""
    write_spec(repo)
    write_config(
        repo,
        '  - id: t\n    run: "true"\n    optional: true\n'
        "    proves: csv-downloads\n",
    )
    with pytest.raises(config.ConfigError) as excinfo:
        load(repo)
    said = str(excinfo.value)
    assert "optional" in said and "csv-downloads" in said, said


def test_proves_naming_a_human_criterion_is_refused(repo):
    """A command claiming to evidence judgement is a category error. The law
    that human criteria are never scored survives this feature only if the
    config layer refuses the binding outright."""
    write_spec(repo)
    write_config(
        repo, '  - id: t\n    run: "true"\n    proves: copy-reads-well\n'
    )
    with pytest.raises(config.ConfigError) as excinfo:
        load(repo)
    said = str(excinfo.value)
    assert "copy-reads-well" in said and "human" in said, said


# --- the list above is the spec's list, and this is what proves it ---------


def test_every_rejection_the_spec_declares_has_a_test_here():
    """Derived, never hand-kept.

    The spec's §3 rejection table is the normative list. This parses it out of
    the committed spec and requires a test in this file for every row — so a
    rejection added to the spec without machinery, or machinery quietly
    dropped while the spec still promises it, goes red here rather than in
    somebody's production repo.
    """
    text = SPEC.read_text(encoding="utf-8")
    rows = [
        line for line in text.splitlines()
        if line.startswith("| `proves:`") or line.startswith("| two gates")
    ]
    assert len(rows) == 5, (
        f"expected the spec's five rejection rows, parsed {len(rows)}: {rows}"
    )

    mine = (Path(__file__).read_text(encoding="utf-8"))
    tests = set(re.findall(r"^def (test_\w+)", mine, re.M))
    for needed in (
        "test_proves_naming_an_unknown_criterion_is_refused",
        "test_proves_with_no_spec_file_at_all_is_refused",
        "test_two_gates_proving_the_same_criterion_are_refused",
        "test_proves_on_an_optional_gate_is_refused",
        "test_proves_naming_a_human_criterion_is_refused",
    ):
        assert needed in tests, f"the spec declares a rejection with no test: {needed}"


def test_a_drafted_spec_may_not_carry_a_proves_key(repo):
    """Ruling 2's guarantee, enforced rather than asserted.

    `config.parse_gate` is deliberately SHARED: `wring spec` runs proposed
    gates through it so Wringer can never propose a gate its own loader would
    reject. So a single key set would have legalised `proves:` on a DRAFTED
    spec too — handing the model-written draft the binding channel ruling 2
    says it does not have, and putting this parser at odds with
    `spec.schema.json`'s `additionalProperties: false` over the same bytes.

    The review that found this called it a sentence with no enforcement
    channel. This is the channel.
    """
    entry = {"id": "t", "run": "true", "proves": "csv-downloads"}

    # The config side accepts it — that is the feature.
    assert config.parse_gate(entry, 0, ".wringer.yaml", allow_proves=True).proves

    # The spec side must not, and the message must name the key.
    with pytest.raises(config.ConfigError) as excinfo:
        config.parse_gate(entry, 0, "wringer.spec.yaml")
    assert "proves" in str(excinfo.value), excinfo.value
