"""**An undeclared thing is refused or asked. It is never waved through.**

The inversion named by the deepagents teardown
(`~/Claude/WRINGER_DEEPAGENTS_DOSSIER_2026-08-23.md` §3.5): their
`interrupt_on` map lists the tools that need a human, and **a tool absent
from the map is AUTO-APPROVED**. The default is permission. That is a
defensible choice for a harness whose job is to act; it is the exact opposite
of the choice a supervision layer has to make, because the interesting tool is
always the one nobody thought to list.

Wringer's equivalents already fall the other way. Nothing asserted it. Each
test here drives a real surface with something it has never heard of and
checks which way the absence falls — and where Wringer's answer IS "allow"
(the ACP permission request, auto-approved in v0 by ruling), the property
asserted is the one that makes it honest rather than invisible: it is
RECORDED. deepagents' auto-approve leaves no trace at all, and that, not the
approval, is the part that could never be adopted here.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from wringer import acp, config, judge
from wringer.rubric import Criterion, Rubric

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "wringer"


class Recording:
    """A `Connection` that keeps what was said instead of writing a pipe."""

    def __init__(self) -> None:
        self.results: list[tuple] = []
        self.errors: list[tuple] = []

    def respond(self, request_id, result) -> None:
        self.results.append((request_id, result))

    def respond_error(self, request_id, message) -> None:
        self.errors.append((request_id, message))


def handled_methods() -> set[str]:
    """Every agent-to-client method `_handle` names, read from the source.

    Derived so the probe below cannot go stale in the one direction that
    matters: a method added to the dispatch and forgotten here would make the
    "unknown method" fixture accidentally hit a real branch, and the test
    would then be measuring a supported call.
    """
    body = (SRC / "acp.py").read_text(encoding="utf-8")
    start = body.index("def _handle(")
    return set(re.findall(r'method == "([^"]+)"', body[start:]))


def test_AN_ACP_METHOD_NOBODY_IMPLEMENTED_IS_REFUSED_NOT_ANSWERED(tmp_path):
    """**The inversion, at the surface an agent actually reaches.**

    An agent asking for something this client does not implement gets an
    error. The failure mode being refused is the friendly one: answering
    `{}` to an unknown request tells the agent its call succeeded, and an
    agent told that a thing worked will build on it.
    """
    seen = handled_methods()
    assert seen, "nothing dispatches on a method name any more"
    invented = "session/do_whatever_you_like"
    assert invented not in seen

    connection = Recording()
    turn = acp.Turn()

    acp._handle(
        {"jsonrpc": "2.0", "id": 7, "method": invented, "params": {}},
        connection,
        tmp_path,
        turn,
    )

    assert not connection.results, (
        f"an unimplemented method was answered as a success: {connection.results}"
    )
    assert connection.errors, "an unimplemented method got no answer at all"
    assert "unsupported" in connection.errors[0][1]


def test_A_WRITE_THAT_ESCAPES_THE_REPOSITORY_IS_REFUSED_AND_LEAVES_NOTHING(
    tmp_path,
):
    """Path containment, driven with the shape that would land the file
    outside the tree. The refusal must also be RECORDED — an agent trying to
    write where it may not is the interesting event, not a no-op."""
    repo = tmp_path / "repo"
    repo.mkdir()
    outside = tmp_path / "outside.txt"

    connection = Recording()
    turn = acp.Turn()

    acp._handle(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "fs/write_text_file",
            "params": {"path": "../outside.txt", "content": "written"},
        },
        connection,
        repo,
        turn,
    )

    assert not outside.exists(), "the agent wrote outside the repository"
    assert connection.errors, "the escape was allowed"
    assert "refused" in connection.errors[0][1]
    assert turn.refusals, "an attempt to escape the tree left no trace"
    assert not turn.files_written


def test_AN_AUTO_APPROVED_PERMISSION_IS_ALWAYS_RECORDED(tmp_path):
    """**Wringer's one auto-approve, and the property that makes it lawful.**

    `session/request_permission` is answered `allow` in v0 by ruling: a consent
    prompt nobody is sitting at is not a safety control, and the container and
    the gates are. The part that must never move is the ledger line. An
    approval that leaves no record is deepagents' shape exactly, and it is the
    half of their design this repository cannot copy.
    """
    connection = Recording()
    turn = acp.Turn()

    acp._handle(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "session/request_permission",
            "params": {
                "toolCall": {"name": "rm", "args": ["-rf", "/"]},
                "options": [{"optionId": "yes", "kind": "allow_always"}],
            },
        },
        connection,
        tmp_path,
        turn,
    )

    assert connection.results, "the agent was left waiting on a permission"
    assert turn.permissions, (
        "a tool call was approved and nothing recorded that it happened — "
        "which is an approval nobody can audit"
    )
    assert turn.permissions[0]["outcome"] == "auto_approved"
    assert "rm" in turn.permissions[0]["tool"], (
        "the record does not say WHAT was approved, so it is a count rather "
        "than evidence"
    )


def key_sets() -> dict[str, int]:
    """Every closed key set `config.py` declares, and where it is declared."""
    body = (SRC / "config.py").read_text(encoding="utf-8").splitlines()
    found = {}
    for number, line in enumerate(body, 1):
        match = re.match(r"^(_[A-Z][A-Z0-9_]*_KEYS)\s*[:=]", line)
        if match:
            found[match.group(1)] = number
    return found


def test_EVERY_CLOSED_KEY_SET_HAS_A_REFUSAL_BEHIND_IT():
    """**Derived: a section may not gain a key set and no refusal.**

    A closed set of keys is only a closed set if something rejects what is not
    in it. `config.py` refuses unknown keys everywhere today; the failure this
    guards is a NEW section arriving with its allowed keys written down and
    the `raise ConfigError(... unknown keys ...)` forgotten, which reads as
    validation and silently ignores typos — and a typo'd key in a consent or
    containment stanza is a control the operator believes they set.

    **The first version of this guard counted refusals and compared the count
    to a number, and the red-watch walked through it**: deleting the `run`
    section's `raise` left more than ten refusals standing, so the count still
    passed. Counting is not deriving. Each `set(raw) - _X_KEYS` is now
    followed to its own `raise`, so the refusal that goes missing is the one
    that fails.
    """
    lines = (SRC / "config.py").read_text(encoding="utf-8").splitlines()
    body = "\n".join(lines)
    declared = key_sets()
    assert declared, "config.py declares no key sets at all any more"

    unused = [
        name
        for name in declared
        # Composed sets (`_CONFIG_GATE_KEYS = _GATE_KEYS | {...}`) are checked
        # through the set that consumes them, so a set referenced by another
        # set is accounted for by its consumer.
        if body.count(name) < 2
    ]
    assert not unused, (
        f"these key sets are declared and never consulted: {unused}. A closed "
        "set nothing checks against is documentation wearing a constant"
    )

    #: Each difference against a closed set is a place something was found
    #: that nobody declared. Within a few lines of it there must be a refusal
    #: — the whole point of computing the difference.
    computed = [
        (number, line)
        for number, line in enumerate(lines, 1)
        if re.search(r"set\([^)]*\)\s*-\s*\(?_[A-Z][A-Z0-9_]*_KEYS", line)
    ]
    assert len(computed) >= len(declared) - 2, (
        f"{len(declared)} key sets are declared and only {len(computed)} "
        "differences are computed against one — a section is not checking "
        "what it was handed"
    )
    silent = []
    for number, line in computed:
        # **Read by INDENTATION, and the two cheaper versions both walked
        # through the mutation.** A fixed window called the `bench` section a
        # silent drop, because it puts a dozen lines of explanation between
        # the difference and the refusal. Widening it to the next definition
        # then went green with the `run` section's refusal DELETED, because
        # that function raises about several other things further down. So
        # the block that follows `if unknown:` is what is read, and the
        # refusal inside it has to name `unknown` — an error about something
        # else is not this error.
        indent = len(line) - len(line.lstrip())
        block: list[str] = []
        seen_if = False
        for follower in lines[number:]:
            if not follower.strip():
                continue
            here = len(follower) - len(follower.lstrip())
            if not seen_if:
                seen_if = here == indent and re.match(
                    r"if\s+unknown\b", follower.strip()
                )
                if not seen_if:
                    break
                continue
            if here <= indent:
                break
            block.append(follower)
        joined = "\n".join(block)
        if not seen_if or "raise ConfigError" not in joined or "unknown" not in joined:
            silent.append(f"config.py:{number} {line.strip()}")
    assert not silent, (
        "these sections work out which keys nobody declared and then do "
        f"nothing about it: {silent}. An unknown key that is computed and "
        "dropped is a typo the operator will never be told about"
    )


def test_A_KEY_NOBODY_DECLARED_IS_REFUSED_RATHER_THAN_IGNORED(tmp_path):
    """Driven, at the stanza where being wrong costs the most: the worker's
    credential passthrough. A typo here is an operator believing they declared
    a key that never crosses the boundary."""
    (tmp_path / ".wringer.yaml").write_text(
        "version: 1\n"
        "gates:\n"
        "  - id: t\n"
        "    run: 'true'\n"
        "run:\n"
        "  worker:\n"
        "    acp:\n"
        "      command: agent\n"
        "      env_pasthrough: [ANTHROPIC_API_KEY]\n",
        encoding="utf-8",
    )

    with pytest.raises(config.ConfigError) as raised:
        config.load(tmp_path / config.CONFIG_FILENAME)

    assert "env_pasthrough" in str(raised.value), (
        "the typo was accepted, so the key the operator meant to declare "
        f"never crosses to the worker and nothing said so: {raised.value}"
    )


def test_A_JUDGE_REPLY_NOBODY_CAN_READ_IS_NEEDS_HUMAN_AND_NEVER_A_PASS():
    """"The evidence says no" and "nothing competent looked at the evidence"
    are different claims, and the second may never be reported as either of
    the first two."""
    rubric = Rubric(
        title="t",
        criteria=(Criterion(id="c1", title="it works", required=True),),
        path="wringer.rubric.yaml",
        sha256="0" * 64,
    )

    for body in (None, {}, {"choices": []}, {"choices": [{"message": {}}]}):
        found = judge.parse_response(body, rubric)
        assert found.verdict == judge.NEEDS_HUMAN, (
            f"an unreadable reply {body!r} became {found.verdict!r}"
        )


def test_A_CRITERION_THE_MODEL_DID_NOT_SCORE_IS_NOT_SCORED():
    """The absence shape, one level in: the reply parses, and simply says
    nothing about a criterion. `met` must stay None. A default of True here
    would be the model's silence reading as approval — the same inversion as
    the tool nobody listed."""
    rubric = Rubric(
        title="t",
        criteria=(
            Criterion(id="asked", title="a", required=True),
            Criterion(id="ignored", title="b", required=True),
        ),
        path="wringer.rubric.yaml",
        sha256="0" * 64,
    )
    body = {
        "choices": [
            {
                "message": {
                    "content": json.dumps(
                        {"criteria": [{"id": "asked", "met": True, "reason": "ok"}]}
                    )
                }
            }
        ]
    }

    found = judge.parse_response(body, rubric)

    rows = {row["id"]: row for row in found.criteria}
    assert rows["ignored"]["met"] is None, (
        f"a criterion the judge never mentioned came back "
        f"{rows['ignored']['met']!r}"
    )
    assert found.verdict != judge.PASS, (
        "a required criterion nobody scored still produced a pass"
    )
