"""The two-socket claim, enforced.

*"Every socket lives in `judge.send` or `forge.request`"* is one of this
program's headline claims: SECURITY.md makes it, AGENTS.md makes it, SPEC_GET
§7 makes it, and SPEC_SIGN restates it to say a subprocess reaching a network
does not move it. **Until this file, no test checked it at all** —
`grep -rn build_opener tests/` returned nothing.

Two defects in the customary phrasing, both found by SPEC_GATEGEN §6's
independent review, and a third found while fixing them:

1. **`grep -rn build_opener src/` returns FIVE, not two.** Three of the five
   are docstrings naming the grep, so the published claim was false on its own
   terms — a reader who ran the command got a different answer.
2. **A grep for one function narrows the moment somebody uses a different
   one.** `urlopen`, `http.client.HTTPSConnection` and
   `socket.create_connection` all open a socket and none of them contains the
   string `build_opener`.
3. **The obvious repair does not work either.** Greping the fully-qualified
   `urllib.request.build_opener` was tried in the same commit as this file and
   survived about a minute: correcting the three docstrings to say the
   qualified form made THAT grep return five too. **A grep count over a string
   is unstable under documenting the string**, whatever the string is.

So this guard does not grep. It parses every module, resolves each call
through that module's own imports, and asserts which FUNCTION every network
call sits in — and no document promises a grep count any more.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def require_checkout(*needed: str) -> None:
    """Skip when a repo-only artifact is absent — `test_docs.py`'s rule.

    The sdist ships the package and its suite, not the repository. A guard
    over `src/` is meaningful in a checkout and meaningless in a tarball.
    """
    for relative in needed:
        if not (repo_root() / relative).exists():
            pytest.skip(f"{relative} is not part of the distribution")

# The exception, stated as data. Both are module-level functions, both are
# reached only behind a flag a human typed, and both refuse to follow a
# redirect. Adding a third is a SPEC change (SPEC_GET_V0 §7), which means
# editing this set in the same commit — that cost is the point.
ALLOWED = {("forge.py", "request"), ("judge.py", "send")}

# Dotted call targets that open, or hand back an object that opens, a network
# connection. Resolved through each module's own imports, so `from
# urllib.request import urlopen` and `import urllib.request` both land here.
NETWORK_CALLS = frozenset({
    "urllib.request.build_opener",
    "urllib.request.urlopen",
    "urllib.request.urlretrieve",
    "urllib.request.OpenerDirector",
    "http.client.HTTPConnection",
    "http.client.HTTPSConnection",
    "socket.socket",
    "socket.create_connection",
    "socket.getaddrinfo",
    "ssl.create_default_context",
})

# Any call into one of these packages is a network call; naming functions
# inside them would be a list that goes stale on their next release. None of
# them is a dependency of this program, which is itself the claim.
NETWORK_PACKAGES = frozenset({"requests", "httpx", "urllib3", "aiohttp", "websockets"})


def _modules() -> list[Path]:
    require_checkout("src/wringer")
    return sorted((repo_root() / "src" / "wringer").glob("*.py"))


def _aliases(tree: ast.Module) -> dict[str, str]:
    """Local name -> dotted module path, from this module's own imports."""
    out: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                # `import urllib.request` binds `urllib`; `... as ur` binds `ur`.
                out[alias.asname or alias.name.split(".")[0]] = (
                    alias.name if alias.asname else alias.name.split(".")[0]
                )
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            for alias in node.names:
                out[alias.asname or alias.name] = f"{node.module}.{alias.name}"
    return out


def _dotted(node: ast.AST) -> str | None:
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if not isinstance(node, ast.Name):
        return None
    parts.append(node.id)
    return ".".join(reversed(parts))


def _resolve(dotted: str, aliases: dict[str, str]) -> str:
    head, _, rest = dotted.partition(".")
    target = aliases.get(head)
    if target is None:
        return dotted
    return f"{target}.{rest}" if rest else target


def _is_network(resolved: str) -> bool:
    return (
        resolved in NETWORK_CALLS
        or resolved.split(".")[0] in NETWORK_PACKAGES
    )


def _owner(node: ast.AST) -> str:
    """The OUTERMOST enclosing function, or `<module>`.

    Outermost, not nearest: the claim is about which published function owns
    the socket, and a helper nested inside `judge.send` is still `judge.send`.
    """
    chain = []
    current = node
    while current is not None:
        if isinstance(current, (ast.FunctionDef, ast.AsyncFunctionDef)):
            chain.append(current.name)
        current = getattr(current, "parent", None)
    return chain[-1] if chain else "<module>"


def network_call_sites() -> list[tuple[str, str, int, str]]:
    """(module filename, owning function, line, resolved call) for every call
    in `src/wringer/` that opens a network connection."""
    found: list[tuple[str, str, int, str]] = []
    for path in _modules():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            for child in ast.iter_child_nodes(node):
                child.parent = node  # type: ignore[attr-defined]
        aliases = _aliases(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            dotted = _dotted(node.func)
            if dotted is None:
                continue
            resolved = _resolve(dotted, aliases)
            if _is_network(resolved):
                found.append((path.name, _owner(node), node.lineno, resolved))
    return found


def test_every_socket_lives_in_judge_send_or_forge_request():
    """The property SECURITY.md publishes, checked against the code.

    This is the test whose absence SPEC_GATEGEN §6's review found: the claim
    was in four documents and in three docstrings, and nothing anywhere would
    have gone red if a third module had opened a socket.
    """
    sites = network_call_sites()
    owners = {(module, owner) for module, owner, _, _ in sites}

    unexpected = sorted(
        f"{module}:{line} in {owner}() calls {call}"
        for module, owner, line, call in sites
        if (module, owner) not in ALLOWED
    )
    assert not unexpected, (
        "a network call outside the two functions SECURITY.md names. Every "
        "socket in Wringer lives in `judge.send` or `forge.request`; adding a "
        f"third is a SPEC_GET_V0 §7 change, not an implementation detail: "
        f"{unexpected}"
    )
    missing = sorted(f"{m}.{o}" for m, o in ALLOWED - owners)
    assert not missing, (
        "the two socket openers are named in SECURITY.md, AGENTS.md and "
        "SPEC_GET_V0 §7 but this run found no network call in them — either "
        f"the transport moved or this guard stopped being able to see it: {missing}"
    )


def test_there_are_exactly_two_network_call_sites():
    """Not two FUNCTIONS — two CALLS.

    The sibling above would still pass if `judge.send` grew a second, quieter
    connection beside the first. The published claim is that the whole program
    reaches a network from two places, so the count is pinned too.
    """
    sites = network_call_sites()
    assert len(sites) == 2, (
        "Wringer opens a socket in exactly two places. This run found "
        f"{len(sites)}: {sites}"
    )


def test_no_document_promises_a_grep_count_for_the_socket_claim():
    """The claim cannot be a grep, in EITHER spelling, and here is why.

    For months the docs said *"`grep -rn build_opener src/` returns exactly
    two"*. It returns five: three of the hits are the docstrings making the
    claim. The obvious repair — grep the fully-qualified call instead — was
    tried in this very commit and lasted about a minute, because writing
    `urllib.request.build_opener` into the corrected docstrings made THAT grep
    return five as well.

    **A grep count over a string is unstable under documenting the string.**
    So no document promises one. The property is enforced by parsing, above,
    and the docs name that test instead of a command.

    SPEC_GATEGEN_V0 §6 is exempt: it records the wrong claim as the review
    finding it was, and a guard that forbade explaining the defect would
    forbid the correction.
    """
    require_checkout("src/wringer")
    import re

    searched = (
        sorted(repo_root().glob("*.md"))
        + sorted((repo_root() / "src" / "wringer").glob("*.py"))
    )
    promises = re.compile(r"grep[^\n]{0,60}build_opener")
    offenders = []
    for path in searched:
        if path.name == "docs/specs/SPEC_GATEGEN_V0.md":
            continue  # §6 carries the finding; correcting it is the point
        flat = " ".join(path.read_text(encoding="utf-8").split())
        if path.suffix == ".py":
            flat = re.sub(r'"\s*"', "", flat)
        if promises.search(flat):
            offenders.append(path.name)
    assert not offenders, (
        "these promise a grep count for the two-socket claim. Every spelling "
        "of that grep counts its own documentation, so the number is wrong as "
        "soon as it is written down. Name "
        f"`tests/test_network_surface.py` instead: {offenders}"
    )
