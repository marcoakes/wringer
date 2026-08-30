"""**An instrument failure never wears a verdict's exit code** (T8).

The contract QUICKSTART states, and this file drives every clause of it that
was reachable only by crashing:

    0  every required gate passed
    1  a required gate failed
    2  config or ENVIRONMENT error
    3  refused
    4  interrupted
    5  needs a human (`wring judge` only)

`main` caught only `KeyboardInterrupt`, so any uncaught `OSError` — ENOSPC on
a `write_text`, EROFS, a file removed between `is_file()` and `open()`, EMFILE
under a wide fleet — reached Python's default handler: traceback, exit 1. In
this contract 1 means the gates failed or the delivery refused ON THE
EVIDENCE, so the instrument's own failure was reported as a verdict about the
change.

**This repository has already paid for the confusion once, in print.**
`docs/benchmark-first-run.md` records a `UnicodeDecodeError` giving "exit 1
with a traceback, indistinguishable from 'a gate failed' … so the harness
scored a refusal Wringer never made". Fixing that one decode did not fix the
class; this is the class.

The code is chosen from the contract that already exists — 2, "config or
environment error" — rather than invented. There is no sixth code.
"""

from __future__ import annotations

import pytest

from wringer import cli


def test_an_OSError_exits_2_and_not_1(monkeypatch, capsys):
    """The class, at the one place that can answer for all of it."""
    def explode(_args):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(cli, "cmd_doctor", explode)

    code = cli.main(["doctor"])

    assert code == cli.EXIT_CONFIG, code
    assert code != cli.EXIT_GATE_FAILED, (
        "an instrument failure was reported with the code that means "
        "A REQUIRED GATE FAILED"
    )
    assert "No space left on device" in capsys.readouterr().err


def test_a_forge_reply_whose_number_is_not_a_number_is_a_ForgeError():
    """`int(fields["number"])` took a value straight from the forge's reply,
    so `{"number": "abc"}` raised `ValueError` out of `fetch_issue` —
    `cmd_issue` catches only `ForgeError`, so it exited 1."""
    from wringer import config, forge

    settings = config.Forge(
        kind="github",
        endpoint="https://api.github.com",
        repo="owner/name",
        token_env="FORGE_TOKEN",
    )
    for bad in ("abc", "1.5", {}, []):
        # The reply is the FORGE's, so it is patched at the socket rather
        # than constructed past it.
        original = forge.request
        forge.request = lambda *a, _bad=bad, **k: {"title": "x", "number": _bad}
        try:
            with pytest.raises(forge.ForgeError, match="not a number"):
                forge.fetch_issue(settings, 1, None)
        finally:
            forge.request = original


def test_a_JSON_RPC_result_that_is_not_an_object_does_not_crash_the_run():
    """`result: null` is legal JSON-RPC, and every caller does `.get(...)` on
    what this returns — so a misbehaving AGENT crashed WRINGER rather than
    failing its turn."""
    from wringer import acp

    assert acp.result_of({"result": None}) == {}
    assert acp.result_of({"result": [1, 2]}) == {}
    assert acp.result_of({"result": "text"}) == {}
    assert acp.result_of({}) == {}
    assert acp.result_of({"result": {"a": 1}}) == {"a": 1}


def test_a_cyclic_graph_is_REPORTED_and_never_raises():
    """The reported crash does NOT reproduce, and the check is kept anyway.

    The review claimed `trail.index(target)` raises `ValueError` "on a class
    of cyclic graphs". It cannot as written: `trail` is threaded as
    `trail + [target]` from `visit(id, [id])`, so it holds the whole path from
    the root and every GREY node is on it by construction.

    Driven here rather than argued: a self-edge, a back-edge to the root, and
    a back-edge to a mid-path node. Each reports its cycle; none raises. The
    finding is recorded at the site as one that did not reproduce, and no
    defensive branch was added — unreachable code that reads as coverage is
    the defect this file keeps finding.
    """
    from wringer import graph

    def router(node_id: str, to: str) -> graph.Node:
        return graph.Node(
            id=node_id,
            kind="router",
            routes=(
                graph.Route(
                    to=to, path="x", op="==", values=("y",), source="x == y"
                ),
            ),
        )

    for shape in (
        (router("a", "a"),),                                  # self-edge
        (router("a", "b"), router("b", "a")),                  # back to root
        (router("a", "b"), router("b", "c"), router("c", "b")),  # mid-path
    ):
        problems: list[str] = []
        graph._check_acyclic(shape, problems)
        assert any("cycle" in one for one in problems), (shape, problems)
