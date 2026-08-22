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


@pytest.mark.parametrize(
    "path",
    [
        "src/wringer/config.py",
        "src/wringer/gates.py",
        "src/wringer/loop.py",
        "src/wringer/acp.py",
        "src/wringer_drive/run.py",
    ],
)
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
