"""SECURITY.md's authority table, checked against the program it describes.

**Why this exists.** The table under *"Who may do what — the authority model"*
is the densest set of security claims this repository makes, and until
2026-08-15 it was hand-kept prose with no relationship to the code that a test
could check. It drifted, and it drifted in the direction nobody watches for:
the `sign an attestation` row said the capability was **not offered**, that
attestations were unsigned **by ruling**, and that `attestation.json.sig` was
**reserved and unused** — while `sign.py` had been writing that file since
2026-08-12, `SPEC_SIGN_V0.md` had reopened the ruling, and SECURITY.md's own
*"What Wringer never does"* section, ninety lines below, correctly listed
`wring attest --sign` among the five commands that send. One document,
contradicting itself, for three days.

That is the second time this class has been paid for here. The first was the
sender count, where the guard could only catch **understatement** — so a sixth
sender would have left every document saying five and every test green. The
lesson, and this file's shape: **a guard that can only fail in one direction is
half a guard.**

**What this enforces.**

- Every row in the table maps to a registered, executable probe.
- A row whose class is `not offered` gets a probe that demonstrates
  **absence** — the entrypoint, flag or function does not exist, or refuses.
- Every other row gets a probe that demonstrates **presence** — the stated
  enforcement is there and does what the row says.
- The direction is derived from the row's own class cell, so flipping the cell
  is never enough on its own: the registered probe must change too, and it must
  then still pass against the code.
- **A row with no probe FAILS.** New rows cannot ship unguarded. A row that is
  genuinely unprobeable takes an entry in `EXEMPT` with a reason string, which
  is loud, dated and reviewable — never a silent skip. `EXEMPT` is empty today.
- A probe registered for a row that no longer exists fails too, so deleting a
  row cannot leave a lie in this file.

**The honest limit, stated here rather than discovered later.** The row→probe
map is written by hand, once, and no test can prove that a probe is the *right*
probe for its row — a lazy probe that asserts something adjacent to its row's
claim will pass. What the completeness forcing buys is that **gaps in the map
are loud**: a new row, a deleted row, or a row whose class was flipped all fail
the suite rather than ageing quietly. That is the most a prose table admits,
and it is strictly more than what produced this class twice.
"""

from __future__ import annotations

import ast
import os
import re
import stat
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

import pytest

TABLE_HEADING = "## Who may do what — the authority model"

# The env a keyless signer reads to find an ambient CI identity. Injected
# rather than set, so the probe describes a CI machine without being one.
CI_ENV = {
    "ACTIONS_ID_TOKEN_REQUEST_URL": "https://example.invalid/token",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "opaque",
}

ABSENCE = "absent"
PRESENCE = "present"


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


# --- reading the table ------------------------------------------------------


@dataclass(frozen=True)
class TableRow:
    """One row of SECURITY.md's authority table, as the document states it."""

    authority: str      # normalised — the key into PROBES
    holder: str
    enforcement: str
    klass: str          # normalised class cell
    raw: str


def _normalise(cell: str) -> str:
    """Markdown emphasis and code ticks are presentation, not content."""
    text = cell.replace("**", "").replace("`", "")
    return re.sub(r"\s+", " ", text).strip().lower()


def read_table() -> tuple[TableRow, ...]:
    """Parse the authority table out of SECURITY.md.

    Deliberately strict: if the heading moves or the table stops being a table,
    this raises rather than silently finding zero rows. A guard that reads
    nothing has the same problem as no guard.
    """
    text = (repo_root() / "SECURITY.md").read_text(encoding="utf-8")
    start = text.find(TABLE_HEADING)
    assert start != -1, (
        f"SECURITY.md no longer contains {TABLE_HEADING!r}. If the section was "
        "renamed, rename it here too; if it was deleted, this whole file goes "
        "with it, deliberately and in the same commit"
    )
    rows: list[TableRow] = []
    seen_header = False
    for line in text[start:].splitlines()[1:]:
        stripped = line.strip()
        if not stripped.startswith("|"):
            if rows:
                break          # the table ended
            continue           # prose between the heading and the table
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if len(cells) != 4:
            continue
        if not seen_header:
            seen_header = True
            continue           # `| authority | who holds it | ... |`
        if set("".join(cells)) <= set("-: "):
            continue           # the `|---|---|` separator
        rows.append(
            TableRow(
                authority=_normalise(cells[0]),
                holder=_normalise(cells[1]),
                enforcement=_normalise(cells[2]),
                klass=_normalise(cells[3]),
                raw=stripped,
            )
        )
    assert rows, "the authority table parsed to zero rows — the parser broke"
    return tuple(rows)


def direction_of(klass: str) -> str:
    """What a row's class cell obliges its probe to demonstrate.

    `not offered` is the only claim of absence the table can make, and it is
    the direction that went wrong: a capability quietly gaining an entrypoint
    while the table still says nobody has it. Everything else — `prevented`,
    `detected`, `derived`, `by design`, `offered` — asserts that something IS
    there, and its probe must show it.
    """
    return ABSENCE if klass.startswith("not offered") else PRESENCE


# --- scratch machinery the probes need --------------------------------------


_ISOLATED = [
    "-c", "user.name=wringer test",
    "-c", "user.email=wringer@example.invalid",
    "-c", "commit.gpgsign=false",
]


def scratch_repo(where: Path) -> Path:
    """A git repo with one commit — the same shape as `conftest.repo`."""
    where.mkdir(parents=True, exist_ok=True)
    for args in (
        ["init", "-q", "-b", "main"],
        ["config", "user.name", "wringer test"],
        ["config", "user.email", "wringer@example.invalid"],
        ["config", "commit.gpgsign", "false"],
        ["commit", "-q", "--allow-empty", "-m", "initial commit"],
    ):
        subprocess.run(
            ["git", *_ISOLATED, *args], cwd=where, check=True, capture_output=True
        )
    return where


class in_directory:
    """`monkeypatch.chdir` is unavailable inside a probe; this is the same."""

    def __init__(self, target: Path) -> None:
        self.target = target

    def __enter__(self) -> None:
        self.previous = Path.cwd()
        os.chdir(self.target)

    def __exit__(self, *exc: object) -> None:
        os.chdir(self.previous)


class on_path:
    """Prepend a directory to PATH for the duration of a probe."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def __enter__(self) -> None:
        self.previous = os.environ.get("PATH", "")
        os.environ["PATH"] = f"{self.directory}{os.pathsep}{self.previous}"

    def __exit__(self, *exc: object) -> None:
        os.environ["PATH"] = self.previous


def module_sources() -> dict[str, ast.Module]:
    """Every shipped module, parsed. The technique `test_network_surface.py`
    uses: a property asserted over the syntax tree cannot be satisfied by
    editing the sentence that claims it."""
    return {
        path.name: ast.parse(path.read_text(encoding="utf-8"))
        for path in sorted((repo_root() / "src" / "wringer").glob("*.py"))
    }


def argv_literals(tree: ast.Module) -> list[tuple[str, ...]]:
    """Every list or tuple literal, as its string elements.

    That is how this program builds an argv — `_git(root, ["push", ...])` — so
    it is where a git verb shows up when a module starts issuing one. Kept as
    separate argvs rather than one flat set, because "no force PUSH" is a claim
    about one argv and not about the whole file: `git worktree remove --force`
    and `container rm --force` are both legitimate and neither is a push.
    """
    argvs: list[tuple[str, ...]] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.List, ast.Tuple)):
            argvs.append(
                tuple(
                    element.value
                    for element in node.elts
                    if isinstance(element, ast.Constant)
                    and isinstance(element.value, str)
                )
            )
    return argvs


def argv_words(tree: ast.Module) -> set[str]:
    """Every string appearing in any argv-shaped literal in a module."""
    return {word for argv in argv_literals(tree) for word in argv}


def subcommands(parser) -> dict:
    import argparse

    for action in parser._actions:
        if isinstance(action, argparse._SubParsersAction):
            return action.choices
    return {}


def flags_of(*command_path: str) -> set[str]:
    """Every option string registered on `wring <command_path>`."""
    from wringer import cli

    parser = cli.build_parser()
    for name in command_path:
        children = subcommands(parser)
        assert name in children, f"`wring {' '.join(command_path)}` is not registered"
        parser = children[name]
    flags: set[str] = set()
    for action in parser._actions:
        flags.update(action.option_strings)
    return flags


def every_registered_flag() -> set[str]:
    """Every option string anywhere in the parser tree."""
    from wringer import cli

    def walk(parser) -> set[str]:
        found: set[str] = set()
        for action in parser._actions:
            found.update(action.option_strings)
        for child in subcommands(parser).values():
            found |= walk(child)
        return found

    return walk(cli.build_parser())


# --- the probes -------------------------------------------------------------


@dataclass(frozen=True)
class Probe:
    """One row's executable demonstration, and what it demonstrates.

    `demonstrates` is checked against the direction the row's own class cell
    obliges — that is the both-directions forcing, and it is why flipping a
    class cell alone cannot make this file green.
    """

    demonstrates: str
    run: Callable[[Path], None]
    covers: str


def probe_produce_a_change(tmp_path: Path) -> None:
    from wringer import config

    parsed = config.parse(
        {
            "version": 1,
            "gates": [{"id": "unit", "run": "true"}],
            "run": {"worker": "my-agent --do-the-work"},
        }
    )
    assert parsed.run.worker == "my-agent --do-the-work", (
        "the worker command is carried through verbatim — Wringer runs the "
        "agent the repository named, and holds no worker of its own"
    )
    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {"version": 1, "gates": [{"id": "unit", "run": "true"}], "run": {}}
        )
    assert "no default" in str(caught.value), (
        "a `run:` section with no worker must be refused. A default worker "
        "would be Wringer producing the change, which is what this row denies"
    )


def probe_approve_a_specification(tmp_path: Path) -> None:
    import json

    from wringer import spec

    def reply(drafted: dict) -> dict:
        return {"choices": [{"message": {"content": json.dumps(drafted)}}]}

    honest = {
        "title": "Add CSV export",
        "open_questions": [],
        "criteria": [
            {
                "id": "export-works",
                "title": "The export produces a CSV",
                "required": True,
                "human": False,
            }
        ],
        "tasks": [
            {
                "id": "csv",
                "brief": "briefs/csv.md",
                "dir": ".",
                "objective": "Write the export endpoint.",
            }
        ],
    }

    drafted = spec.parse_response(reply(honest), "a PRD")
    assert drafted.spec.approved is False, (
        "`approved` is written as a constant, never read from the reply"
    )

    with pytest.raises(spec.SpecError) as caught:
        spec.parse_response(reply({**honest, "approved": True}), "a PRD")
    message = str(caught.value)
    assert "approved" in message and "nothing was written" in message, (
        "a reply carrying `approved` must be refused whole, and loudly — a "
        "silent discard teaches nobody that the interlock was reached for"
    )

    assert "--yes" not in every_registered_flag(), (
        "there is no `--yes` anywhere in the program, and the row says so"
    )


def probe_answer_an_open_question(tmp_path: Path) -> None:
    import json

    from wringer import spec

    drafted = {
        "title": "Add CSV export",
        "open_questions": [
            {
                "id": "date-format",
                "question": "Which date format?",
                "required": True,
                "answer": "ISO-8601, obviously.",
            }
        ],
        "criteria": [
            {
                "id": "export-works",
                "title": "The export produces a CSV",
                "required": True,
                "human": False,
            }
        ],
        "tasks": [
            {
                "id": "csv",
                "brief": "briefs/csv.md",
                "dir": ".",
                "objective": "Write the export endpoint.",
            }
        ],
    }
    with pytest.raises(spec.SpecError) as caught:
        spec.parse_response(
            {"choices": [{"message": {"content": json.dumps(drafted)}}]}, "a PRD"
        )
    message = str(caught.value)
    assert "answered its own open question" in message, message
    assert "Nothing was written" in message, (
        "the whole reply is refused, not the offending field stripped"
    )


def probe_install_a_gate(tmp_path: Path) -> None:
    """`wring plan` proposes and stops. Run it, and read the config afterwards.

    Executed rather than reasoned about: the claim is about what the program
    does to a file on disk, so the probe puts a file on disk and looks at it.
    """
    from wringer import cli, config, spec

    root = scratch_repo(tmp_path / "plan-probe")
    declared = "version: 1\ngates:\n  - id: check\n    run: 'true'\n"
    (root / config.CONFIG_FILENAME).write_text(declared, encoding="utf-8")
    (root / spec.SPEC_FILENAME).write_text(
        "schema_version: wringer.spec.v1\n"
        "approved: true\n"
        "title: Add CSV export\n"
        "intent: |2\n  Our reports page needs a CSV export.\n"
        "open_questions: []\n"
        "criteria:\n"
        "  - id: export-button-exists\n"
        "    title: A CSV export button appears\n"
        "    required: true\n"
        "    human: false\n"
        "gates:\n"
        "  - id: test\n"
        "    run: pytest -q\n"
        "tasks:\n"
        "  - id: csv-export\n"
        "    brief: briefs/csv-export.md\n"
        "    dir: .\n"
        "    objective: Add the export endpoint.\n",
        encoding="utf-8",
    )
    before = (root / config.CONFIG_FILENAME).read_bytes()
    with in_directory(root):
        assert cli.main(["plan"]) == cli.EXIT_OK
    after = (root / config.CONFIG_FILENAME).read_bytes()
    assert after == before, (
        "`wring plan` proposed a gate and then WROTE it. The row says a human "
        "installs a gate by applying a diff, and nothing in the program applies "
        "it"
    )
    assert "pytest -q" not in after.decode("utf-8"), (
        "the proposed gate reached .wringer.yaml by some other route"
    )


def probe_call_a_criterion_evidenced(tmp_path: Path) -> None:
    """The state is computed from the record. Feed it two records, get two
    answers, and neither is settable by anyone."""
    from wringer import accept

    criterion = SimpleNamespace(
        id="export-works", title="The export produces a CSV",
        required=True, human=False,
    )
    gate = SimpleNamespace(id="test", run="pytest -q", proves="export-works")
    passing = SimpleNamespace(gate=gate, passed=True)

    born_green = accept._assess_one(
        criterion, {"export-works": gate}, {"test": passing},
        {}, frozenset(), lambda text: text,
    )
    assert born_green.state == accept.UNEVIDENCED, (
        "a gate that passes with nothing in the record showing it can fail "
        "must not reach `evidenced` — that is the whole of this row"
    )

    with_receipt = accept._assess_one(
        criterion, {"export-works": gate}, {"test": passing},
        {("test", "pytest -q"): accept.Receipt(kind="failure", bundle="b")},
        frozenset(), lambda text: text,
    )
    assert with_receipt.state == accept.EVIDENCED
    assert with_receipt.receipt is not None, (
        "`evidenced` always carries the receipt it was derived from"
    )

    failing = SimpleNamespace(gate=gate, passed=False)
    assert accept._assess_one(
        criterion, {"export-works": gate}, {"test": failing},
        {("test", "pytest -q"): accept.Receipt(kind="failure", bundle="b")},
        frozenset(), lambda text: text,
    ).state == accept.GATE_FAILED, (
        "a receipt does not survive the gate failing now — both halves are "
        "required, in this run"
    )


def probe_authorise_delivery(tmp_path: Path) -> None:
    from wringer import graph

    with pytest.raises(graph.GraphError) as caught:
        graph.parse(
            "send: true\n"
            "nodes:\n"
            "  - id: ship\n"
            "    capability: deliver\n",
            "a-graph-that-typed-a-flag.yaml",
        )
    assert "not a key a file may carry" in str(caught.value), (
        "a graph file declaring `send:` must be a NAMED error — refusing it as "
        "an unknown key would answer 'no' without saying where the flag goes"
    )

    assert "--send" in flags_of("deliver"), (
        "`--send` must be typed on the invocation, so it must be registered "
        "there"
    )
    for path in (("graph", "run"), ("graph", "resume")):
        assert "--send" in flags_of(*path), (
            f"`wring {' '.join(path)}` reaches a deliver node and must carry "
            "its own typed flag"
        )


def probe_write_git_history(tmp_path: Path) -> None:
    """Derived from the syntax trees, in both directions.

    What this demonstrates: the modules that put a history-writing git verb
    into an argv are exactly `{deliver.py}`, `--force` in any spelling appears
    in no argv anywhere, and `--send` is registered so nothing writes without
    somebody typing it. What it does NOT demonstrate is each of the five
    refusals firing — those have their own tests in `tests/test_deliver.py`,
    and duplicating them here would be a second hand-kept list.
    """
    writes_history = {
        "commit", "push", "branch", "switch", "checkout",
        "tag", "reset", "merge", "rebase", "cherry-pick", "am",
    }
    culprits = {
        name: sorted(writes_history & argv_words(tree))
        for name, tree in module_sources().items()
        if writes_history & argv_words(tree)
    }
    assert set(culprits) == {"deliver.py"}, (
        "the row says git history is written by `deliver.py`, and only there. "
        f"These modules build an argv containing one: {culprits}"
    )

    force_flags = {"--force", "-f", "--force-with-lease"}
    forced_pushes = {
        name: [argv for argv in argv_literals(tree)
               if "push" in argv
               and (force_flags & set(argv)
                    or any(word.startswith("+") for word in argv))]
        for name, tree in module_sources().items()
    }
    assert not any(forced_pushes.values()), (
        "no force push, anywhere, in any spelling — and one appeared: "
        f"{ {k: v for k, v in forced_pushes.items() if v} }"
    )
    # `--force-with-lease` and a `+refs/` refspec are push-only spellings, so
    # they have no legitimate home anywhere in the program. `--force` alone
    # does — `git worktree remove --force`, `container rm --force` — which is
    # why the check above is per-argv rather than per-file.
    push_only = {
        name: sorted(
            word for word in argv_words(tree)
            if word == "--force-with-lease" or word.startswith("+refs/")
        )
        for name, tree in module_sources().items()
    }
    assert not any(push_only.values()), (
        f"{ {k: v for k, v in push_only.items() if v} }"
    )

    assert "--send" in flags_of("deliver")


def probe_rewrite_evidence(tmp_path: Path) -> None:
    """The one row that must demonstrate BOTH directions in its own body.

    Prevention is claimed ABSENT, so the probe shows a bundle's files are
    writable. Detection is claimed PRESENT, so the probe rewrites one and shows
    the record catching it. Either half going the other way is a wrong row.
    """
    from wringer import attest, cli, config, evidence

    root = scratch_repo(tmp_path / "evidence-probe")
    (root / config.CONFIG_FILENAME).write_text(
        "version: 1\ngates:\n  - id: unit\n    run: 'true'\n", encoding="utf-8"
    )
    with in_directory(root):
        assert cli.main(["verify"]) == cli.EXIT_OK

    runs = sorted((root / ".wringer" / "runs").iterdir())
    assert runs, "the verify produced no bundle, so this probe measured nothing"
    bundle = runs[-1]

    covered = [
        path for path in sorted(bundle.rglob("*"))
        if path.is_file() and path.name != evidence.DIGESTS_FILENAME
    ]
    assert covered, "the bundle is empty"

    # Direction one: prevention is ABSENT, and the row says so in bold.
    assert all(os.access(path, os.W_OK) for path in covered), (
        "the row claims a worker CAN rewrite evidence on disk and that nothing "
        "stops it. If the bundle became read-only, this row is now an "
        "understatement — say so in SECURITY.md before changing this probe"
    )

    # Direction two: detection is PRESENT.
    attest.check_digests(bundle, "verify")     # clean, before anything moves

    target = next(path for path in covered if path.suffix in {".txt", ".log", ""})
    target.write_bytes(target.read_bytes() + b"\n# quietly appended\n")
    with pytest.raises(attest.Refused) as caught:
        attest.check_digests(bundle, "verify")
    assert target.name in str(caught.value), (
        "a rewritten file must be NAMED by the check — `findable` is the whole "
        "of what this row promises in place of prevention"
    )


def probe_sign_an_attestation(tmp_path: Path) -> None:
    """Offered, CI only, keyless — and exercised against a stub, which the row
    says out loud and this probe demonstrates rather than asserts."""
    from wringer import sign

    assert "--sign" in flags_of("attest"), (
        "the capability is offered through `wring attest --sign`"
    )
    assert "--verify-signature" in flags_of("audit")

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    stub = bin_dir / "cosign"
    stub.write_text('#!/bin/sh\necho "SIGNATURE" > "$4"\n', encoding="utf-8")
    stub.chmod(stub.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    payload = tmp_path / "attestation.json"
    payload.write_text('{"schema_version": "wringer.attestation.v1"}\n',
                       encoding="utf-8")
    signature = tmp_path / "attestation.json.sig"

    with on_path(bin_dir):
        # Off CI there is no ambient identity, and the refusal says where to go.
        refusal = sign.can_sign_here("cosign", env={})
        assert refusal is not None and "Sign in CI" in refusal, refusal

        # In CI it signs, and the sibling file is what appears.
        assert sign.sign(payload, signature, "cosign", env=dict(CI_ENV)) == "cosign"

    assert signature.is_file(), (
        "`attestation.json.sig` is written beside the attestation — it is no "
        "longer reserved and unused, and the row must not say that it is"
    )
    assert signature.name == f"{payload.name}.sig", (
        "a signature is a SIBLING file, never a field inside the payload"
    )

    # `signature_missing` is the ordinary local case and is not a failure.
    ordinary = sign.assess(payload, tmp_path / "nothing-here.sig")
    assert ordinary.signature == sign.SIGNATURE_MISSING
    assert not ordinary.signed
    assert "ordinary case" in ordinary.reason

    # Wringer holds no key: it shells out, and the argv names the tool.
    argv = sign.sign_argv("cosign", payload, signature)
    assert argv[0] == "cosign", argv

    # The caveat in the row, demonstrated: nothing in CI runs the real signer.
    workflows = repo_root() / ".github" / "workflows"
    if workflows.is_dir():
        for path in sorted(workflows.glob("*.yml")):
            body = path.read_text(encoding="utf-8")
            assert "attest --sign" not in body, (
                f"{path.name} runs the real signer. The row says this path has "
                "been exercised only against a stub — if that stopped being "
                "true, the row is now an understatement and Sequence H in "
                "docs/MANUAL_CHECKS.md wants a coverage row"
            )


PROBES: dict[str, Probe] = {
    "produce a change": Probe(
        PRESENCE, probe_produce_a_change,
        "the worker command is the repository's, carried verbatim, with no "
        "default",
    ),
    "approve a specification": Probe(
        PRESENCE, probe_approve_a_specification,
        "`approved` is a constant; a reply carrying it is refused whole; no "
        "`--yes` exists",
    ),
    "answer an open question": Probe(
        PRESENCE, probe_answer_an_open_question,
        "a reply that answers its own open question is refused whole",
    ),
    "install a gate or a criterion binding": Probe(
        PRESENCE, probe_install_a_gate,
        "`wring plan` is RUN; `.wringer.yaml` is byte-identical afterwards",
    ),
    "call a criterion evidenced": Probe(
        PRESENCE, probe_call_a_criterion_evidenced,
        "the state is derived from the record — same gate, three records, "
        "three answers",
    ),
    "authorise delivery": Probe(
        PRESENCE, probe_authorise_delivery,
        "a graph file declaring `send:` is a named error; `--send` is "
        "registered where it is typed",
    ),
    "write git history": Probe(
        PRESENCE, probe_write_git_history,
        "history-writing git verbs appear in `deliver.py` and nowhere else; "
        "no force push anywhere",
    ),
    "rewrite evidence already on disk": Probe(
        PRESENCE, probe_rewrite_evidence,
        "prevention absent (the bundle is writable) AND detection present (a "
        "rewritten file is named)",
    ),
    "sign an attestation": Probe(
        PRESENCE, probe_sign_an_attestation,
        "`--sign` is registered, refuses off-CI, writes the sibling `.sig` "
        "through a stub cosign, and no workflow runs the real signer",
    ),
}

# A row that is genuinely unprobeable goes here, with a reason a reader can
# argue with. Empty on purpose: every row in the table today is probeable, and
# the first entry added should be harder to justify than writing the probe.
EXEMPT: dict[str, str] = {}


# --- the guard --------------------------------------------------------------


def test_every_row_in_the_authority_table_has_a_probe():
    """**Completeness forcing: a new row cannot ship unguarded.**

    This is the half that makes the rest worth anything. A guard over the rows
    somebody remembered to register is a guard over a hand-kept list, which is
    the failure mode being fixed.
    """
    missing = [
        row.authority
        for row in read_table()
        if row.authority not in PROBES and row.authority not in EXEMPT
    ]
    assert not missing, (
        "SECURITY.md's authority table has rows with no registered probe: "
        f"{missing}. Every row states a security property; write a probe that "
        "demonstrates it in the direction the row's class claims, or add an "
        "EXEMPT entry with a reason somebody can argue with"
    )


def test_no_probe_survives_the_row_it_was_written_for():
    """A probe for a row that no longer exists is a lie with a test around it."""
    rows = {row.authority for row in read_table()}
    orphans = sorted((set(PROBES) | set(EXEMPT)) - rows)
    assert not orphans, (
        f"these probes are registered for rows SECURITY.md no longer has: "
        f"{orphans}. Delete the probe in the commit that deletes the row"
    )


def test_each_probe_demonstrates_the_direction_its_row_claims():
    """**The both-directions forcing, and the reason this file is not the
    sender-count guard's mistake again.**

    A probe's direction is not declared independently of the table — it is
    checked against the row's own class cell. So marking a live capability
    `not offered` fails here unless somebody also swaps in an absence probe,
    which then has to pass against code that offers it. Both spellings of the
    lie cost the same.
    """
    wrong = [
        f"{row.authority!r}: the row's class is {row.klass!r} which requires a "
        f"{direction_of(row.klass)} probe, but the registered one demonstrates "
        f"{PROBES[row.authority].demonstrates}"
        for row in read_table()
        if row.authority in PROBES
        and PROBES[row.authority].demonstrates != direction_of(row.klass)
    ]
    assert not wrong, wrong


def test_an_exemption_names_a_reason_and_a_row_that_exists():
    """Exemptions are loud or they are not exemptions."""
    rows = {row.authority for row in read_table()}
    for authority, reason in EXEMPT.items():
        assert authority in rows, (
            f"EXEMPT names {authority!r}, which is not a row in the table"
        )
        assert authority not in PROBES, (
            f"{authority!r} is both exempt and probed — pick one"
        )
        assert len(reason.split()) >= 8, (
            f"the exemption for {authority!r} needs a reason a reader can "
            f"argue with, not {reason!r}"
        )


@pytest.mark.parametrize("authority", sorted(PROBES))
def test_the_row_says_what_the_program_does(authority: str, tmp_path):
    """Every registered probe, executed against the tree it describes."""
    row = next(
        (row for row in read_table() if row.authority == authority), None
    )
    assert row is not None, f"{authority!r} is no longer a row (see the orphan test)"
    PROBES[authority].run(tmp_path)


def test_the_signing_row_carries_its_own_caveat():
    """The correction that produced this file, pinned in the row itself.

    Not "somewhere in SECURITY.md": a security reader takes the cell and leaves,
    and a caveat two hundred lines away is the green-artifact-stripped-of-its-
    caveats failure in a new costume. This is the one row-content assertion in
    the file, and it is here because this exact cell was wrong on three counts
    at once for three days.
    """
    row = next(
        (row for row in read_table() if row.authority == "sign an attestation"),
        None,
    )
    assert row is not None, "the signing row was deleted rather than corrected"
    assert "stub" in row.enforcement, (
        "the stub-only caveat must be IN the row: the signer path has never "
        "run against live Sigstore, and a reader of this cell must be told so "
        "in the cell"
    )
    assert "ci" in row.klass, (
        "signing is offered in CI only, and the class cell must say which"
    )
    assert "unsigned by ruling" not in row.enforcement, (
        "that ruling was reopened by SPEC_SIGN_V0.md"
    )
    assert "reserved and unused" not in row.enforcement, (
        "`sign.py` has written attestation.json.sig since 2026-08-12"
    )
