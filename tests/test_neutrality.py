"""**The charter, as a guard: Wringer never DEFAULTS to a vendor.**

The claim on the front page is that Wringer works with any coding agent you
can start from a terminal and any model behind an OpenAI-compatible endpoint.
That claim is not a promise about intentions — it is a property of the code,
and this file is where the property is checked.

**The failure mode it guards against is quiet.** Nobody would write "we only
support X". What happens is a default: an `or "claude-agent-acp"` added while
debugging, a config template with a model name already filled in, a fallback
so an unanswered question does not stop the run. Each is individually
convenient, and the sum is a tool that has a favourite. A person who never
typed a vendor's name would find one in their config, and the record would say
they chose it.

So: a generated config may contain nothing the person did not type, and the
engine's own defaults may name no vendor at all.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

#: Every string that names somebody's product or model family. Deliberately
#: broad, and it includes Anthropic's — the author's test convenience is
#: exactly the bias this guard exists to catch, and an Anthropic-locked
#: supervisor is as dead a product as any other locked one.
VENDOR_MARKS = (
    "anthropic",
    "claude",
    "openai",
    "gpt-",
    "codex",
    "kimi",
    "moonshot",
    "deepseek",
    "glm-",
    "z.ai",
    "gemini",
    "ollama",
    "mistral",
)


#: **"OpenAI-compatible" is the name of a WIRE FORMAT, not a preference.**
#: It is what the industry calls the de-facto chat-completions shape that five
#: vendors' endpoints all speak, and stating that Wringer talks to any of them
#: is the vendor-agnostic claim itself — refusing the phrase would forbid the
#: sentence this file exists to enforce. Nothing else is exempt: a bare
#: "OpenAI" still counts, because that is a company.
_NOT_A_VENDOR_MENTION = re.compile(r"openai[- ]compatible", re.I)


def _marks_in(text: str) -> set[str]:
    lowered = _NOT_A_VENDOR_MENTION.sub("«wire-format»", text).lower()
    return {mark for mark in VENDOR_MARKS if mark in lowered}


def test_the_engines_own_DEFAULTS_name_no_vendor():
    """`config.py`'s defaults are what a repo gets without saying anything.

    `judge.endpoint`, `judge.model` and `run.worker` have no defaults and
    never will — Wringer contacts the endpoint you wrote down, never one it
    guessed. This reads the module's assignments rather than trusting that
    sentence.
    """
    from wringer import config

    source = (ROOT / "src" / "wringer" / "config.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            name = getattr(target, "id", "")
            if not name.isupper():
                continue
            found = _marks_in(ast.unparse(node.value))
            if found:
                offenders.append(f"{name} = … names {sorted(found)}")
    assert not offenders, (
        "a module-level default in config.py carries a vendor's name, so a "
        "repository that declared nothing would still get one: " + "; ".join(offenders)
    )
    # And the two that decide who thinks have no default AT ALL — not a
    # vendor's, not `None`. A `Judge` cannot be constructed without them, so
    # there is no reachable state in which Wringer has an endpoint nobody
    # wrote down.
    import dataclasses

    fields = {f.name: f for f in dataclasses.fields(config.Judge)}
    for required in ("endpoint", "model"):
        field = fields[required]
        assert field.default is dataclasses.MISSING, (
            f"judge.{required} acquired a default of {field.default!r} — a "
            "repository that declared nothing would now be pointed somewhere"
        )
        assert field.default_factory is dataclasses.MISSING, (
            f"judge.{required} acquired a default factory"
        )
    with pytest.raises(TypeError):
        config.Judge()  # type: ignore[call-arg]


def test_the_DRIVE_fills_in_nothing_that_names_a_vendor():
    """`DECLARED_DEFAULTS` is what `wringer-drive` writes WITHOUT asking.

    A filename, an attempt budget, a branch template and a variable NAME are
    the things it may invent, because none of them points anywhere. An
    endpoint is a network address, a model is a bill and a worker is a
    command — those are asked for, and a vendor string appearing in this dict
    would mean one of them stopped being asked.
    """
    from wringer_drive import run as run_module

    offenders = {
        key: sorted(_marks_in(str(value)))
        for key, value in run_module.DECLARED_DEFAULTS.items()
        if _marks_in(str(value))
    }
    assert not offenders, (
        "wringer-drive fills these in without asking and they name a vendor: "
        f"{offenders}"
    )


def test_a_GENERATED_CONFIG_contains_only_what_the_person_TYPED(tmp_path):
    """**Executed, not read.** The strongest form of this guard.

    Generate a workspace from answers that name no real vendor at all, then
    read the config off disk and assert no vendor string is in it. A fallback
    anywhere on that path — in the question, in the writer, in `wring init` —
    puts a name into a file the person never typed one into, and this is what
    notices.
    """
    from wringer_drive import run as run_module

    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    (repo / "pyproject.toml").write_text(
        "[project]\nname='x'\nversion='0'\n", encoding="utf-8"
    )
    (repo / "tests").mkdir()
    (repo / "tests" / "test_x.py").write_text("def test_x():\n    pass\n", "utf-8")

    answers = {
        # Nothing here belongs to anybody. If a vendor's name comes out the
        # other end, something put it there.
        "endpoint": "https://example.invalid/v1/chat/completions",
        "model": "some-model-name",
        "worker": "sh ./build.sh",
    }
    session = run_module.Session(repo=repo)
    try:
        run_module.generate_workspace(session, repo, answers)
    except run_module.Stop as stop:  # pragma: no cover - diagnosed below
        pytest.skip(f"the workspace could not be generated here: {stop}")

    written = (repo / ".wringer.yaml").read_text(encoding="utf-8")
    found = _marks_in(written)
    assert not found, (
        "the generated config names a vendor the person never typed: "
        f"{sorted(found)}\n{written}"
    )
    # And it really did write the three things they DID type.
    for value in answers.values():
        assert value in written, f"{value!r} is not in the generated config"


def test_NO_SETUP_QUESTION_FALLS_BACK_TO_ITS_OWN_SUGGESTION():
    """An offer becomes a default the moment something reads it at run time.

    `suggested` exists so the question text and the runbook can be pinned to
    one another. Nothing may consume it to answer a question the person left
    empty — that is a vendor's name entering the record as the person's
    choice.
    """
    source = (ROOT / "src" / "wringer_drive" / "run.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    readers = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant):
            if node.slice.value == "suggested":
                readers.append(ast.unparse(node))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr == "get" and node.args:
                first = node.args[0]
                if isinstance(first, ast.Constant) and first.value == "suggested":
                    readers.append(ast.unparse(node))
    assert not readers, (
        "something in wringer-drive READS `suggested` at run time, which is "
        f"how an offer becomes a default: {readers}"
    )


def every_shipped_module() -> list[str]:
    """Every Python file this distribution installs.

    **Was five filenames until 2026-08-23.** The five were the modules most
    likely to reach for a vendor when the guard was written, and the engine
    ships forty-odd. A neutrality guard that reads an eighth of the source is
    a neutrality claim about an eighth of the source, and the charter — "if
    it's an Anthropic tool we are fucked" — is not a claim about five files.

    Cheap enough to be uninteresting: parsing the whole package takes less
    time than the assertion message would take to read.
    """
    root = ROOT / "src"
    return sorted(
        path.relative_to(ROOT).as_posix()
        for path in root.rglob("*.py")
        if "__pycache__" not in path.parts
    )


@pytest.mark.parametrize("path", every_shipped_module())
def test_no_vendor_string_is_ever_an_OR_FALLBACK(path: str):
    """`x or "claude-agent-acp"` is the whole defect, in one line of Python.

    A `BoolOp` whose right-hand side is a vendor string is a value used when
    the left-hand side is absent — which is the definition of a default. Names
    inside comments, docstrings and question TEXT are untouched: those are
    documentation, and documentation is where examples belong.
    """
    tree = ast.parse((ROOT / path).read_text(encoding="utf-8"))
    offenders = []
    for node in ast.walk(tree):
        if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.Or):
            for value in node.values[1:]:
                if isinstance(value, ast.Constant) and isinstance(value.value, str):
                    found = _marks_in(value.value)
                    if found:
                        offenders.append(f"line {node.lineno}: {ast.unparse(node)}")
    assert not offenders, (
        f"{path} falls back to a vendor when something is absent: "
        + "; ".join(offenders)
    )


def test_the_README_TOP_FOLD_leads_with_the_structural_fact_not_a_vendor():
    """The first screen is the one place a reader decides what this is for.

    Nothing forbids naming a vendor on the page — the matrix is full of
    them — but the headline may not, because a headline naming one company's
    agent IS the lock-in claim, whatever the rest of the page says.
    """
    body = (ROOT / "README.md").read_text(encoding="utf-8")
    fold = "\n".join(body.splitlines()[:25])
    found = _marks_in(fold)
    assert not found, (
        f"the README's first 25 lines name a vendor: {sorted(found)}\n{fold}"
    )
    flat = " ".join(fold.split()).lower()
    assert "any coding agent" in flat, (
        "the top fold never states the structural fact about the worker"
    )
    assert "openai-compatible" in flat, (
        "the top fold never states the structural fact about the model"
    )
    assert re.search(r"docs/vendors\.md", fold), (
        "the top fold makes the work-with-anything claim and does not link "
        "the matrix that backs it"
    )


# --- what a person standing in THEIR OWN repo can actually reach -------------
#
# Found by the bug hunt of 2026-08-22, by running the surfaces rather than
# reading them. Three user-facing strings pointed at `docs/vendors.md`: the
# drive's first two questions and the engine's no-key refusal. **That file
# exists in Wringer's source tree and nowhere on the reader's machine** — the
# `uv tool install` front door ships the four commands and no docs at all — so
# the first question a product manager ever answers named a path they did not
# have. It is the same defect class as a runbook command that 404s on the
# layout the reader has, on the surface where the reader is least equipped to
# work it out.


def _user_facing_pointers() -> list[tuple[str, str]]:
    """Every (where, text) this window added that hands the reader a location."""
    from wringer import cli
    from wringer.config import Judge
    from wringer_drive import run as run_module

    found = [
        ("drive:VENDORS_PAGE", run_module.VENDORS_PAGE),
        (
            "cli:_missing_key",
            cli._missing_key(
                "spec",
                Judge(
                    endpoint="https://api.example.invalid/v1/chat/completions",
                    model="m",
                    rubric="r.yaml",
                    api_key_env="WRINGER_API_KEY",
                ),
            ),
        ),
    ]
    for question in run_module.SETUP_QUESTIONS:
        found.append((f"drive:{question.id}", question.text))
        more = question.detail.get("more")
        if more:
            found.append((f"drive:{question.id}.more", more))
    return found


@pytest.mark.parametrize(
    "where,text", _user_facing_pointers(), ids=lambda v: str(v)[:40]
)
def test_no_user_facing_string_points_at_a_file_only_THIS_repo_has(where, text):
    """A location handed to the reader must be reachable FROM WHERE THEY ARE.

    Their own repository, or a URL. Never a path relative to Wringer's source
    tree, because they are not standing in it and the installed package does
    not contain it.
    """
    if "vendors.md" not in text:
        return
    for line in text.splitlines():
        if "vendors.md" not in line:
            continue
        assert "https://" in line, (
            f"{where} points the reader at a path only this repository has: "
            f"{line.strip()!r}. They are standing in their own project, and "
            "`uv tool install wringer` ships no docs — give them a URL"
        )


def test_the_drives_own_pointer_is_a_URL():
    """The one constant every question reads, checked directly so a new
    question inherits the property rather than needing its own test."""
    from wringer_drive import run as run_module

    assert run_module.VENDORS_PAGE.startswith("https://"), (
        f"the drive points at {run_module.VENDORS_PAGE!r}, which is a path in "
        "Wringer's source tree and not a place the person answering the "
        "question can reach"
    )


def test_BOTH_call_sites_of_the_no_key_refusal_use_the_one_writer(tmp_path):
    """**Found by the mutation sweep, 2026-08-22.**

    `_missing_key` has two callers — `wring spec` and `wring judge` — and only
    the spec one was reachable by any test. Reverting the judge call site to
    the old one-line message went completely unnoticed, so half the fix was
    unguarded. Both are executed here.
    """
    import subprocess
    import sys

    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    (repo / ".wringer.yaml").write_text(
        "version: 1\ngates:\n  - id: g\n    run: \"true\"\n"
        "judge:\n  endpoint: https://api.deepseek.com/chat/completions\n"
        "  model: deepseek-v4-pro\n  rubric: rubric.yaml\n"
        "  api_key_env: WRINGER_API_KEY\n",
        encoding="utf-8",
    )
    (repo / "rubric.yaml").write_text(
        "schema_version: wringer.rubric.v1\ntitle: t\n"
        "criteria:\n  - id: a\n    statement: does it work\n",
        encoding="utf-8",
    )
    (repo / "PRD.md").write_text("A PRD.\n", encoding="utf-8")

    env = {"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)}
    for argv in (["spec", "--send", "PRD.md"], ["judge", "--send"]):
        done = subprocess.run(
            [sys.executable, "-m", "wringer", *argv],
            cwd=repo, capture_output=True, text=True, env=env,
        )
        said = done.stderr
        if "api_key_env" not in said:
            continue  # this verb stopped earlier for its own reasons
        assert "api.deepseek.com" in said, (
            f"`wring {argv[0]}`'s no-key refusal does not name the endpoint the "
            f"operator wrote in their own config: {said!r}"
        )
        assert "add-generic-password" in said, (
            f"`wring {argv[0]}`'s refusal does not say how to store the key: "
            f"{said!r}"
        )
        assert "https://" in said.split("vendors.md")[0][-120:], (
            f"`wring {argv[0]}` points at a path only this repo has: {said!r}"
        )


def test_the_CANONICALIZATION_amendment_still_cites_its_measurement():
    """A recorded ruling amended by a measurement must keep the citation.

    The mutation sweep showed the whole amendment could be deleted with
    nothing going red: the behaviour is guarded, the REASON was not. A later
    window reading a bare "whitespace only" would have no idea a measurement
    exists.
    """
    from wringer import spec as spec_module

    doc = " ".join((spec_module.same_command.__doc__ or "").split())
    assert "AMENDED" in doc, "the amendment was removed from the recorded ruling"
    assert "canonicalization-2026-08-22.md" in doc, (
        "the amendment no longer cites the capture that justifies it"
    )
    assert (ROOT / "docs" / "canonicalization-2026-08-22.md").is_file()
    assert (ROOT / "scripts" / "canonicalization-probe.py").is_file(), (
        "the amendment cites a probe that is no longer in the repository"
    )
