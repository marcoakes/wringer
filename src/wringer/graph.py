"""The graph of loops — the document and its validator (SPEC_GRAPH_V0.md).

A graph composes primitives Wringer already has. It adds **sequencing and
stopping, never power**: a node names a capability, and the capability does
what it has always done, with the same refusals, the same evidence, the same
laws. The one-sentence test for anything added here is *would this widen what
Wringer can execute, contact, or write?* — and the answer must be no.

Two rules in this file carry that, and both are rulings rather than taste:

- **Ruling 1 — a graph names capabilities, never commands.** There is no
  `command:` key, and a key that looks like one is a hard error naming
  `.wringer.yaml` as the only file that may put a command in Wringer's
  mouth. The base plan this grew from allowed `command: "wring run --json"`
  on a node, which is arbitrary shell execution wearing a node costume — in
  the same document that forbade arbitrary Python in edges.
- **Ruling 2 — state routes; only bundles gate.** Nothing here reads state
  as evidence. A router compares strings to decide where to go next; whether
  a change may be delivered is re-asked of the bundle, by the delivery code,
  every time.

Validation is strict in the house style — unknown keys are errors, because a
typo must not quietly change what a graph does. This module executes nothing.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from wringer import evidence
from wringer.redact import Redactor

SCHEMA_VERSION = "wringer.graph.v1"

GRAPHS_DIRNAME = Path(".wringer") / "graphs"
EVENTS_FILENAME = "graph.jsonl"
MANIFEST_FILENAME = "manifest.json"
RESOLVED_FILENAME = "graph.resolved.json"
STATE_FILENAME = "state.json"
SUMMARY_FILENAME = "summary.md"
NODES_DIRNAME = "nodes"

# What a graph run can end as. `parked` is the one that is neither a
# success nor a failure — a person has to act, which is the same claim
# `wring judge` makes with exit 5 (SPEC_GRAPH_V0 §5.3).
STATUSES = ("done", "failed", "parked", "interrupted")

# Every way `loop.run` can end. A router compares against these, so they
# are the loop's own vocabulary rather than a second list that drifts —
# and `LOOP_REASONS` exists so a test can assert the two agree.
LOOP_REASONS = frozenset(
    {
        "converged",
        "max_iterations",
        "no_progress",
        "oscillating",
        "budget_exhausted",
        "interrupted",
    }
)

# The node kinds v0 has. Each names a capability that already exists; adding
# one means wrapping something Wringer already does, never inventing it.
KINDS = ("intent", "human", "loop", "router", "deliver")

# Where a route may point besides a node. `done` and `fail` are outcomes, not
# nodes, so a graph never needs a terminal node whose only job is to stop.
SINKS = ("done", "fail")

# Ids name directories in the bundle, so they are slugs — `gate id` rules.
ID_PATTERN = re.compile(r"[a-z0-9][a-z0-9-]*")
MAX_ID_LENGTH = 64

_TOP_LEVEL_KEYS = {"version", "id", "inputs", "state", "budgets", "nodes"}
_BUDGET_KEYS = {"wall_clock", "max_iterations"}
_KIND_KEYS = {
    "intent": {"kind", "input", "then", "writes"},
    "human": {"kind", "prompt", "then"},
    "loop": {"kind", "budgets", "writes", "then"},
    "router": {"kind", "routes", "default"},
    "deliver": {"kind", "then"},
}

# Keys that would let a graph file put a command into Wringer's mouth.
# Refused by NAME rather than by what they contain, because the danger is the
# capability, not the string: `argv: [...]` is no safer than `command: "..."`.
_COMMAND_LIKE = ("command", "run", "shell", "argv", "exec", "script", "cmd")

# The one key a graph file may not carry, refused by name and with the reason
# (ruling 5). `--send` is typed on the invocation and authorises the deliver
# node THAT invocation reaches, once — a file that could declare it would be a
# file that had typed a flag, which is the whole thing the amended law 6
# forbids. Lumping it in with ordinary unknown keys would answer "no" without
# saying where the flag does go.
_SEND_KEY = "send"
_SEND_REFUSAL = (
    "'send:' is not a key a file may carry. `--send` is typed on the "
    "invocation — `wring graph run … --send` or `wring graph resume … "
    "--send` — and authorises the deliver node that invocation reaches, "
    "once. A file is not a typed flag (SPEC_GRAPH_V0 ruling 5)"
)

# The three comparison forms, parsed by grammar. There is deliberately no
# expression engine and no `eval`: a graph file is a document a stranger may
# hand you, and the only thing it may do is choose between named nodes.
_EQUALITY = re.compile(
    r"^state\.(?P<path>[a-z0-9][a-z0-9-]*)\s*(?P<op>==|!=)\s*'(?P<value>[^']*)'$"
)
_MEMBERSHIP = re.compile(
    r"^state\.(?P<path>[a-z0-9][a-z0-9-]*)\s+in\s+\[(?P<values>[^\]]*)\]$"
)
_QUOTED = re.compile(r"'([^']*)'")

_FORMS = (
    "state.<name> == 'value'",
    "state.<name> != 'value'",
    "state.<name> in ['a', 'b']",
)


class GraphError(Exception):
    """An invalid graph file (CLI exit code 2)."""


@dataclass(frozen=True)
class Route:
    """One router branch: a parsed comparison and where it goes."""

    to: str
    path: str
    op: str  # "==", "!=", "in"
    values: tuple[str, ...]
    source: str  # the `when:` text, for messages and rendering

    def matches(self, state: dict[str, str]) -> bool:
        """Missing state matches nothing — never a crash, never a guess."""
        if self.path not in state:
            return False
        actual = state[self.path]
        if self.op == "==":
            return actual == self.values[0]
        if self.op == "!=":
            return actual != self.values[0]
        return actual in self.values


@dataclass(frozen=True)
class Budgets:
    """A node's ceilings. Clamped to the graph's remainder before use —
    supervision invariant 8: budgets nest and are hard."""

    wall_clock: int | None = None
    max_iterations: int | None = None


@dataclass(frozen=True)
class Node:
    id: str
    kind: str
    then: str | None = None
    # intent
    input: str | None = None
    # human
    prompt: str | None = None
    # loop
    budgets: Budgets = field(default_factory=Budgets)
    # loop / intent — {name: state path}, the only way a node writes state
    writes: tuple[tuple[str, str], ...] = ()
    # router
    routes: tuple[Route, ...] = ()
    default: str | None = None

    @property
    def targets(self) -> tuple[str, ...]:
        """Every node or sink this one can hand control to."""
        if self.kind == "router":
            return tuple(route.to for route in self.routes) + (
                (self.default,) if self.default else ()
            )
        return (self.then,) if self.then else ()

    @property
    def state_written(self) -> tuple[str, ...]:
        return tuple(path for _, path in self.writes)

    @property
    def state_read(self) -> tuple[str, ...]:
        return tuple(route.path for route in self.routes)


@dataclass(frozen=True)
class Graph:
    id: str
    wall_clock: int
    nodes: tuple[Node, ...]
    start: str
    inputs: dict[str, str] = field(default_factory=dict)
    state: dict[str, str] = field(default_factory=dict)

    def node(self, node_id: str) -> Node:
        for node in self.nodes:
            if node.id == node_id:
                return node
        raise GraphError(f"no node '{node_id}' in this graph")

    def as_dict(self) -> dict[str, Any]:
        """The resolved graph, for `graph.resolved.json`.

        Written into the bundle so `render`, `status` and `explain` describe
        what RAN rather than what the file on disk says today — the same
        reason a run bundle records the gates it used.
        """
        return {
            "schema_version": SCHEMA_VERSION,
            "id": self.id,
            "start": self.start,
            "wall_clock": self.wall_clock,
            "inputs": dict(self.inputs),
            "state": dict(self.state),
            "nodes": [
                {
                    "id": node.id,
                    "kind": node.kind,
                    **({"then": node.then} if node.then else {}),
                    **({"input": node.input} if node.input else {}),
                    **({"prompt": node.prompt} if node.prompt else {}),
                    **(
                        {"writes": {name: path for name, path in node.writes}}
                        if node.writes
                        else {}
                    ),
                    **(
                        {
                            "routes": [
                                {"when": route.source, "to": route.to}
                                for route in node.routes
                            ],
                            "default": node.default,
                        }
                        if node.kind == "router"
                        else {}
                    ),
                    **(
                        {
                            "budgets": {
                                key: value
                                for key, value in (
                                    ("wall_clock", node.budgets.wall_clock),
                                    ("max_iterations", node.budgets.max_iterations),
                                )
                                if value is not None
                            }
                        }
                        if node.budgets != Budgets()
                        else {}
                    ),
                }
                for node in self.nodes
            ],
        }


def load(path: Path) -> Graph:
    if not path.is_file():
        raise GraphError(f"no graph file at {path}")
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise GraphError(f"{path} could not be read: {exc}") from exc
    return parse(text, source=path.name)


def parse(text: str, source: str = "graph.yaml") -> Graph:
    """Parse and fully validate. Every problem is reported, not just the
    first — fixing a graph one error per run is a guessing game."""
    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise GraphError(f"{source} is not valid YAML: {exc}") from exc

    problems: list[str] = []
    graph = _build(raw, source, problems)
    if problems:
        raise GraphError(_render_problems(source, problems))
    assert graph is not None
    return graph


def _render_problems(source: str, problems: list[str]) -> str:
    if len(problems) == 1:
        return f"{source}: {problems[0]}"
    listed = "\n".join(f"  - {problem}" for problem in problems)
    return f"{source}: {len(problems)} problems\n{listed}"


def _build(raw: Any, source: str, problems: list[str]) -> Graph | None:
    if not isinstance(raw, dict):
        problems.append("top level must be a mapping")
        return None

    if _SEND_KEY in raw:
        problems.append(f"the graph {_SEND_REFUSAL}")

    unknown = sorted(set(raw) - _TOP_LEVEL_KEYS - {_SEND_KEY})
    if unknown:
        problems.append(f"unknown top-level keys: {', '.join(unknown)}")

    if raw.get("version") != 1:
        problems.append(f"'version: 1' is required (got {raw.get('version')!r})")

    graph_id = raw.get("id")
    if not isinstance(graph_id, str) or not _is_slug(graph_id):
        problems.append(
            f"'id' must be a slug — lowercase letters, digits and '-' "
            f"(got {graph_id!r}); it names directories in the bundle"
        )
        graph_id = "invalid"

    budgets = raw.get("budgets")
    wall_clock = None
    if not isinstance(budgets, dict) or budgets.get("wall_clock") is None:
        problems.append(
            "'budgets.wall_clock' is required — a graph without a wall clock "
            "is exactly the thing that runs all night (supervision "
            "invariant 3: every wait has a deadline)"
        )
    else:
        wall_clock = _positive_int(budgets.get("wall_clock"), "budgets.wall_clock",
                                   problems)

    inputs = _string_map(raw.get("inputs"), "inputs", problems)
    state = _string_map(raw.get("state"), "state", problems)

    raw_nodes = raw.get("nodes")
    if not isinstance(raw_nodes, dict) or not raw_nodes:
        problems.append("'nodes' must be a non-empty mapping")
        return None

    nodes = tuple(
        node
        for node_id, body in raw_nodes.items()
        if (node := _node(node_id, body, problems)) is not None
    )
    if not nodes:
        return None

    start = _check_structure(nodes, state, problems)

    if problems:
        return None
    return Graph(
        id=graph_id,
        wall_clock=wall_clock or 0,
        nodes=nodes,
        start=start or nodes[0].id,
        inputs=inputs,
        state=state,
    )


def _node(node_id: Any, body: Any, problems: list[str]) -> Node | None:
    if not isinstance(node_id, str) or not _is_slug(node_id):
        problems.append(f"node id {node_id!r} must be a slug")
        return None
    where = f"node '{node_id}'"
    if not isinstance(body, dict):
        problems.append(f"{where} must be a mapping")
        return None

    # Ruling 1, checked before anything else: the danger is the capability,
    # so it is refused by key NAME rather than by inspecting a value.
    for key in sorted(set(body) & set(_COMMAND_LIKE)):
        problems.append(
            f"{where} carries '{key}:'. A graph names capabilities, never "
            "commands — there is no key here that puts a command into "
            "Wringer's mouth, and the only file that may is .wringer.yaml, "
            "whose gates are already reviewed as code (SPEC_GRAPH_V0 "
            "ruling 1)"
        )
    if _SEND_KEY in body:
        problems.append(f"{where} {_SEND_REFUSAL}")

    kind = body.get("kind")
    if kind not in KINDS:
        problems.append(
            f"{where} has unknown kind {kind!r} — the kinds are: "
            f"{', '.join(KINDS)}"
        )
        return None

    unknown = sorted(set(body) - _KIND_KEYS[kind] - set(_COMMAND_LIKE) - {_SEND_KEY})
    if unknown:
        problems.append(
            f"{where} ({kind}): unknown keys: {', '.join(unknown)}"
        )

    then = body.get("then")
    if then is not None and not isinstance(then, str):
        problems.append(f"{where}: 'then' must name a node or a sink")
        then = None

    if kind == "human" and not _non_empty(body.get("prompt")):
        problems.append(
            f"{where}: a human node needs a 'prompt' — it is what the person "
            "who finds the graph parked is being asked"
        )
    if kind == "intent" and not _non_empty(body.get("input")):
        problems.append(f"{where}: an intent node needs an 'input'")

    routes, default = (), None
    if kind == "router":
        routes, default = _router(body, where, problems)

    return Node(
        id=node_id,
        kind=kind,
        then=then,
        input=body.get("input") if isinstance(body.get("input"), str) else None,
        prompt=body.get("prompt") if isinstance(body.get("prompt"), str) else None,
        budgets=_budgets(body.get("budgets"), where, problems),
        writes=_writes(body.get("writes"), where, problems),
        routes=routes,
        default=default,
    )


def _router(
    body: dict, where: str, problems: list[str]
) -> tuple[tuple[Route, ...], str | None]:
    default = body.get("default")
    if not _non_empty(default):
        problems.append(
            f"{where}: a router needs a 'default' — a graph that can reach a "
            "router and match nothing has nowhere to go"
        )
        default = None

    raw_routes = body.get("routes")
    if not isinstance(raw_routes, list) or not raw_routes:
        problems.append(f"{where}: 'routes' must be a non-empty list")
        return (), default

    routes = []
    for index, entry in enumerate(raw_routes):
        if not isinstance(entry, dict) or set(entry) - {"when", "to"}:
            problems.append(f"{where}: routes[{index}] takes 'when' and 'to'")
            continue
        if not _non_empty(entry.get("to")):
            problems.append(f"{where}: routes[{index}] needs a 'to'")
            continue
        parsed = _expression(entry.get("when"), f"{where}: routes[{index}]", problems)
        if parsed is not None:
            path, op, values = parsed
            routes.append(
                Route(
                    to=entry["to"],
                    path=path,
                    op=op,
                    values=values,
                    source=str(entry.get("when")),
                )
            )
    return tuple(routes), default


def _expression(
    when: Any, where: str, problems: list[str]
) -> tuple[str, str, tuple[str, ...]] | None:
    """Parse one comparison, by grammar.

    Deliberately three forms and no more. A graph file may arrive from
    anywhere, and the widest thing it is allowed to do is choose between
    nodes its author named — so there is nothing here to evaluate, and
    nothing an attacker can reach.
    """
    if not isinstance(when, str):
        problems.append(f"{where}: 'when' must be a string")
        return None

    text = when.strip()
    if (match := _EQUALITY.match(text)) is not None:
        return match["path"], match["op"], (match["value"],)
    if (match := _MEMBERSHIP.match(text)) is not None:
        values = tuple(_QUOTED.findall(match["values"]))
        if not values:
            problems.append(f"{where}: the list in {text!r} has no quoted values")
            return None
        return match["path"], "in", values

    problems.append(
        f"{where}: {text!r} is not one of the three forms a router "
        f"understands — {', '.join(_FORMS)}. There is deliberately no "
        "expression engine here"
    )
    return None


def _budgets(raw: Any, where: str, problems: list[str]) -> Budgets:
    if raw is None:
        return Budgets()
    if not isinstance(raw, dict):
        problems.append(f"{where}: 'budgets' must be a mapping")
        return Budgets()
    unknown = sorted(set(raw) - _BUDGET_KEYS)
    if unknown:
        problems.append(f"{where}: unknown budget keys: {', '.join(unknown)}")
    return Budgets(
        wall_clock=(
            _positive_int(raw["wall_clock"], f"{where}: wall_clock", problems)
            if raw.get("wall_clock") is not None
            else None
        ),
        max_iterations=(
            _positive_int(raw["max_iterations"], f"{where}: max_iterations", problems)
            if raw.get("max_iterations") is not None
            else None
        ),
    )


def _writes(raw: Any, where: str, problems: list[str]) -> tuple[tuple[str, str], ...]:
    if raw is None:
        return ()
    if not isinstance(raw, dict):
        problems.append(f"{where}: 'writes' must be a mapping of name to state path")
        return ()
    written = []
    for name, path in raw.items():
        if not isinstance(path, str) or not path.startswith("state."):
            problems.append(
                f"{where}: writes.{name} must name a state path like "
                f"'state.build-status' (got {path!r})"
            )
            continue
        written.append((str(name), path[len("state."):]))
    return tuple(written)


def _check_structure(
    nodes: tuple[Node, ...], state: dict[str, str], problems: list[str]
) -> str | None:
    """Reachability, the single start, the DAG rule, and dataflow."""
    known = {node.id for node in nodes}
    targeted: set[str] = set()

    for node in nodes:
        for target in node.targets:
            if target in SINKS:
                continue
            if target not in known:
                problems.append(
                    f"node '{node.id}' points at '{target}', which is not a "
                    f"node and is not a sink ({' or '.join(SINKS)})"
                )
                continue
            targeted.add(target)

    starts = [node.id for node in nodes if node.id not in targeted]
    if len(starts) > 1:
        problems.append(
            f"{len(starts)} nodes are unreachable — nothing points at "
            f"{', '.join(sorted(starts)[1:])}. A graph has exactly one start "
            f"node, and here that would be '{sorted(starts)[0]}'"
        )
    elif not starts:
        problems.append("every node is targeted, so there is no start node")

    _check_acyclic(nodes, problems)
    _check_dataflow(nodes, state, starts[0] if starts else None, problems)
    return starts[0] if len(starts) == 1 else None


def _check_acyclic(nodes: tuple[Node, ...], problems: list[str]) -> None:
    """v0 is a DAG. The loop node IS the cycle, and it is bounded four ways
    (iterations, worker timeout, wall clock, the plateau breaker); a cycle
    between ordinary nodes has no bound at all."""
    edges = {node.id: [t for t in node.targets if t not in SINKS] for node in nodes}
    colour: dict[str, int] = {}

    def visit(node_id: str, trail: list[str]) -> None:
        colour[node_id] = 1  # grey: on the stack
        for target in edges.get(node_id, []):
            if colour.get(target) == 1:
                cycle = " → ".join(trail[trail.index(target):] + [target])
                problems.append(
                    f"a cycle: {cycle}. v0 graphs are acyclic — the loop node "
                    "is the only cycle, and it is bounded; a cycle between "
                    "ordinary nodes is not"
                )
                return
            if colour.get(target) is None:
                visit(target, trail + [target])
        colour[node_id] = 2  # black: finished

    for node in nodes:
        if colour.get(node.id) is None:
            visit(node.id, [node.id])


def _check_dataflow(
    nodes: tuple[Node, ...],
    state: dict[str, str],
    start: str | None,
    problems: list[str],
) -> None:
    """Every state path a router reads must be written before it runs.

    The authoring error nothing else catches: a router comparing a value
    nobody sets can only ever fall through to `default`, so the graph looks
    correct and quietly does one thing forever. Checked by walking forward
    from the start and accumulating what has been written — a writer placed
    AFTER the reader does not count, which is the half a naive
    "is it written anywhere" check would miss.
    """
    if start is None:
        return
    by_id = {node.id: node for node in nodes}
    reachable_with: dict[str, set[str]] = {}

    def walk(node_id: str, available: set[str], trail: tuple[str, ...]) -> None:
        if node_id in SINKS or node_id not in by_id or node_id in trail:
            return
        node = by_id[node_id]
        seen_before = reachable_with.get(node_id)
        if seen_before is not None and available >= seen_before:
            return
        reachable_with[node_id] = (
            available if seen_before is None else available & seen_before
        )
        for path in node.state_read:
            if path not in reachable_with[node_id]:
                problems.append(
                    f"node '{node.id}' routes on 'state.{path}', which "
                    f"nothing writes before it runs. Declare it in the "
                    f"graph's 'state:' block, or have an upstream node write "
                    f"it with 'writes:'"
                )
        onward = reachable_with[node_id] | set(node.state_written)
        for target in node.targets:
            walk(target, onward, trail + (node_id,))

    walk(start, set(state), ())


def _string_map(raw: Any, where: str, problems: list[str]) -> dict[str, str]:
    """Strings only in v0 — a router compares strings, so storing anything
    else would be storing something no route can read."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        problems.append(f"'{where}' must be a mapping")
        return {}
    out = {}
    for key, value in raw.items():
        if not isinstance(value, str):
            problems.append(
                f"{where}.{key} must be a string — v0 state is strings, "
                f"because that is what a router can compare (got {value!r})"
            )
            continue
        out[str(key)] = value
    return out


def _positive_int(value: Any, where: str, problems: list[str]) -> int | None:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        problems.append(f"'{where}' must be an integer of at least 1 (got {value!r})")
        return None
    return value


def _non_empty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _is_slug(value: str) -> bool:
    return bool(ID_PATTERN.fullmatch(value)) and len(value) <= MAX_ID_LENGTH


def render_mermaid(graph: Graph) -> str:
    """A Mermaid flowchart, derived from the graph — never hand-maintained.

    Four hand-maintained lists went stale in one release this month. A
    diagram is the easiest of all to let rot, so this one is generated from
    the same object the executor walks.
    """
    lines = ["flowchart TD"]
    for node in graph.nodes:
        lines.append(f'  {node.id}["{node.id}<br/><i>{node.kind}</i>"]')
    for node in graph.nodes:
        if node.kind == "router":
            for route in node.routes:
                lines.append(f"  {node.id} -->|{route.source}| {route.to}")
            if node.default:
                lines.append(f"  {node.id} -->|default| {node.default}")
        elif node.then:
            lines.append(f"  {node.id} --> {node.then}")
    return "\n".join(lines) + "\n"


# --- the run bundle --------------------------------------------------------


@dataclass(frozen=True)
class Bundle:
    """A graph run's evidence — `.wringer/graphs/<id>/`.

    Loop and delivery bundles are referenced by path, never nested: one run,
    one bundle, one place. Like every other bundle here it OWNS the redactor,
    so a write path cannot skip scrubbing by the author forgetting — the
    failure mode that produced two leaks this month.
    """

    directory: Path
    graph_run_id: str
    started_at: datetime
    redactor: Redactor = Redactor()

    @classmethod
    def create(
        cls,
        graphs_root: Path,
        now: datetime | None = None,
        redactor: Redactor | None = None,
    ) -> Bundle:
        started_at = now if now is not None else datetime.now().astimezone()
        try:
            graphs_root.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise GraphError(f"cannot create {graphs_root}: {exc}") from exc

        for _ in range(64):
            graph_run_id = evidence.new_run_id(started_at)
            directory = graphs_root / graph_run_id
            try:
                directory.mkdir(exist_ok=False)
            except FileExistsError:
                continue  # same second, fresh suffix
            except OSError as exc:
                raise GraphError(f"cannot create {directory}: {exc}") from exc
            return cls(
                directory=directory,
                graph_run_id=graph_run_id,
                started_at=started_at,
                redactor=redactor or Redactor(),
            )
        raise GraphError(f"could not allocate a graph directory under {graphs_root}")

    @classmethod
    def at(cls, directory: Path, redactor: Redactor | None = None) -> Bundle:
        """Reopen an existing run — what `resume`, `status` and `explain` use.

        `started_at` comes from the manifest when there is one; a run killed
        before its first manifest still reopens, because the ledger is what
        resume actually reads.
        """
        if not directory.is_dir():
            raise GraphError(f"no graph run at {directory}")
        started = datetime.now().astimezone()
        manifest = directory / MANIFEST_FILENAME
        if manifest.is_file():
            try:
                recorded = json.loads(manifest.read_text(encoding="utf-8"))
                started = datetime.fromisoformat(recorded["started_at"])
            except (ValueError, KeyError, OSError):
                pass
        return cls(
            directory=directory,
            graph_run_id=directory.name,
            started_at=started,
            redactor=redactor or Redactor(),
        )

    def node_dir(self, node_id: str) -> Path:
        directory = self.directory / NODES_DIRNAME / node_id
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def event(self, event_type: str, **fields: Any) -> None:
        """Append one chained, scrubbed line. The ledger is the truth."""
        scrubbed = evidence.deep_scrub(self.redactor, fields)
        path = self.directory / EVENTS_FILENAME
        line = json.dumps(
            {
                "type": event_type,
                "ts": evidence.timestamp(),
                "prev_hash": evidence.chain_head(path),
                **scrubbed,
            }
        )
        with path.open("a", encoding="utf-8") as stream:
            stream.write(line + "\n")

    def read_events(self) -> list[dict[str, Any]]:
        path = self.directory / EVENTS_FILENAME
        if not path.is_file():
            return []
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def write_resolved(self, graph: Graph) -> Path:
        """The graph AS EXECUTED.

        `render`, `status` and `explain` read this rather than the file on
        disk, so they describe the run rather than whatever the author has
        edited since — the same reason a run bundle records its own gates.
        """
        path = self.directory / RESOLVED_FILENAME
        path.write_text(
            json.dumps(graph.as_dict(), indent=2) + "\n", encoding="utf-8"
        )
        return path

    def write_state(self, state: dict[str, str]) -> Path:
        """A convenience snapshot. **Never read back as authority** — resume
        reconstructs from the ledger, so a doctored file changes nothing."""
        path = self.directory / STATE_FILENAME
        path.write_text(
            json.dumps(dict(sorted(state.items())), indent=2) + "\n",
            encoding="utf-8",
        )
        return path

    def write_manifest(
        self,
        status: str,
        reason: str,
        current: str | None,
        graph_id: str,
        completed: tuple[str, ...] = (),
    ) -> Path:
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "graph_run_id": self.graph_run_id,
            "graph_id": graph_id,
            "started_at": self.started_at.replace(microsecond=0).isoformat(),
            "result": {
                "status": status,
                "reason": reason,
                "current_node": current,
                "completed": list(completed),
            },
        }
        path = self.directory / MANIFEST_FILENAME
        path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        return path

    def write_summary(self, text: str) -> Path:
        path = self.directory / SUMMARY_FILENAME
        path.write_text(self.redactor.scrub(text), encoding="utf-8")
        return path

    def write_digests(self) -> Path:
        """Hash every file in this bundle. **Written last**, so the digest
        covers the manifest and the summary rather than sitting beside them."""
        return evidence.digest_directory(self.directory)


# --- executing a graph -----------------------------------------------------
#
# The executor holds NO state that is not on disk (supervision invariant 7).
# Where a run has got to, and what its routing state is, are both replayed
# from `graph.jsonl` — which is why `resume` is built here with the first two
# node kinds rather than bolted on afterwards: "what has the ledger already
# recorded, and what runs next" IS the state machine, and a straight-line
# runner has nowhere to put that answer.


DECISION_FILENAME = "decision.yaml"
PROMPT_FILENAME = "prompt.md"
LOOP_REF_FILENAME = "loop.ref.json"
DELIVER_REF_FILENAME = "deliver.ref.json"


@dataclass(frozen=True)
class Outcome:
    """What one graph run did. `cli.py` turns this into an exit code.

    `exit_code` is normally None and the status decides. A delivery refusal is
    the exception: `deliver.Refused` carries its own code because "there is
    nothing to deliver" (1) and "this tree is unsafe" (3) are different
    answers, and collapsing them into one graph failure throws away the half
    that says whether the user can do anything about it.
    """

    status: str
    reason: str
    current: str | None
    completed: tuple[str, ...]
    state: dict[str, str]
    directory: Path
    exit_code: int | None = None
    notes: tuple[str, ...] = ()


@dataclass
class Invocation:
    """What the human typed on THIS invocation, and what to tell them after.

    `--send` lives here and nowhere else — not in the graph file, not in a
    decision file, not in the ledger. The amended law 6 says git history moves
    only on a flag a human typed, and ruling 5 narrows that to the deliver
    node THIS invocation reaches, once: a parked graph has ended the
    invocation it parked in, so resuming means retyping. Keeping the
    authorisation in memory is what makes that true rather than promised — an
    authorisation written to disk is a file that has typed a flag.
    """

    send: bool = False
    spent_by: str | None = None
    notes: list[str] = field(default_factory=list)
    # The console the caller wants a loop node to write to — `cmd_run`'s own
    # reporters, passed straight through to `loop.run`. §3c: same callbacks,
    # so a graph run LOOKS LIKE the `wring run` users already know. Empty
    # means silent, which is what `--json` and the tests want.
    loop_console: dict[str, Any] = field(default_factory=dict)

    def authorise(self, node_id: str) -> bool:
        """Spend the typed flag, once. A second deliver node in the same run
        gets a dry run and says so."""
        if not self.send or self.spent_by is not None:
            return False
        self.spent_by = node_id
        return True


@dataclass(frozen=True)
class Replay:
    """Where a run had got to, reconstructed from the ledger alone.

    Never from `state.json` — that file is a convenience snapshot, and if it
    were authority then the cheapest file in the bundle would decide what
    happens next.
    """

    completed: tuple[str, ...]
    state: dict[str, str]
    parked_at: str | None
    finished: bool

    @classmethod
    def of(cls, events: list[dict[str, Any]]) -> Replay:
        completed: list[str] = []
        state: dict[str, str] = {}
        parked_at = None
        finished = False
        for event in events:
            kind = event.get("type")
            if kind == "graph.started":
                state = dict(event.get("state") or {})
            elif kind == "node.finished":
                node_id = event.get("node_id")
                if isinstance(node_id, str) and node_id not in completed:
                    completed.append(node_id)
                parked_at = None
            elif kind == "node.parked":
                parked_at = event.get("node_id")
            elif kind == "state.updated":
                path, value = event.get("path"), event.get("value")
                if isinstance(path, str) and isinstance(value, str):
                    state[path] = value
            elif kind == "graph.finished":
                finished = True
        return cls(tuple(completed), state, parked_at, finished)


class Parked(Exception):
    """A node needs a person. Not a failure — the graph is waiting."""

    def __init__(self, node_id: str, reason: str) -> None:
        super().__init__(reason)
        self.node_id = node_id
        self.reason = reason


class NodeFailed(Exception):
    """A node could not do its job. The graph stops, having said why."""

    exit_code: int | None = None

    def __init__(self, node_id: str, reason: str) -> None:
        super().__init__(reason)
        self.node_id = node_id
        self.reason = reason


class NodeRefused(NodeFailed):
    """A shipped refusal said no, and said it with its own exit code.

    A subclass rather than a flattening: every caller that handles a failed
    node still handles this one, and the code that distinguishes "nothing to
    deliver" from "this tree is unsafe" survives the trip up through the
    graph. `deliver.Refused` is the only thing that raises it today.
    """

    def __init__(self, node_id: str, reason: str, exit_code: int) -> None:
        super().__init__(node_id, reason)
        self.exit_code = exit_code


def run(
    root: Path,
    document: Graph,
    bundle: Bundle,
    resuming: Replay | None = None,
    on_node: Any = None,
    send: bool = False,
    loop_console: dict[str, Any] | None = None,
) -> Outcome:
    """Walk the graph until it is done, failed, or waiting for a person.

    `resuming` carries what the ledger said; a fresh run passes None. Nodes
    already in `completed` are never re-run — re-running an intent node would
    restage its input, and re-running a loop node would spend a worker's time
    a second time on work that was already done.

    `send` is the flag the human typed on this invocation and nothing else:
    it is never read from the graph file, the decision file or the ledger, and
    it dies with the process (ruling 5).
    """
    replay = resuming or Replay((), dict(document.state), None, False)
    state = dict(replay.state)
    completed = list(replay.completed)
    invocation = Invocation(send=send, loop_console=dict(loop_console or {}))

    if resuming is None:
        bundle.event("graph.started", graph_id=document.id, state=dict(state))
    else:
        bundle.event("graph.resumed", graph_id=document.id, completed=list(completed))

    current: str | None = replay.parked_at or _next_after(document, completed)

    while current is not None and current not in SINKS:
        node = document.node(current)

        if node.id in completed:
            current = _advance(node, state, bundle)
            continue

        if on_node is not None:
            on_node(node)
        bundle.event("node.started", node_id=node.id, kind=node.kind)
        try:
            written, extras = _execute(
                root, node, document, bundle, state, invocation
            )
        except Parked as parked:
            # One event per PARK, not per glance: resuming an unapproved
            # decision file must not fill the ledger with identical lines.
            if replay.parked_at != node.id:
                bundle.event("node.parked", node_id=node.id, reason=parked.reason)
            _finish(bundle, document, "parked", parked.reason, node.id, completed,
                    state, invocation)
            return Outcome("parked", parked.reason, node.id, tuple(completed), state,
                           bundle.directory, notes=tuple(invocation.notes))
        except NodeFailed as failed:
            # `reason` only. The exit code travels in memory to the CLI: it is
            # this invocation's answer, not a fact about the run, and the
            # ledger's schema is a published format rather than a scratchpad.
            bundle.event("node.failed", node_id=node.id, reason=failed.reason)
            _finish(bundle, document, "failed", failed.reason, node.id, completed,
                    state, invocation)
            return Outcome("failed", failed.reason, node.id, tuple(completed), state,
                           bundle.directory, exit_code=failed.exit_code,
                           notes=tuple(invocation.notes))

        for path, value in written.items():
            state[path] = value
            bundle.event("state.updated", node_id=node.id, path=path, value=value)

        # A node's own status wins over the generic one: a loop node
        # finishing `converged` or `no_progress` says more than "completed",
        # and it is what a reader of the ledger wants.
        bundle.event(
            "node.finished", node_id=node.id, **{"status": "completed", **extras}
        )
        completed.append(node.id)
        current = _advance(node, state, bundle)

    status = "done" if current == "done" else "failed"
    reason = "every node completed" if status == "done" else "a route led to fail"
    _finish(bundle, document, status, reason, None, completed, state, invocation)
    return Outcome(status, reason, None, tuple(completed), state, bundle.directory,
                   notes=tuple(invocation.notes))


def _advance(node: Node, state: dict[str, str], bundle: Bundle) -> str | None:
    """Where control goes next. A router chooses; everything else has one
    `then`, and a node with neither is a graph that stops."""
    if node.kind != "router":
        return node.then
    for route in node.routes:
        if route.matches(state):
            bundle.event(
                "route.selected", node_id=node.id, to=route.to, when=route.source
            )
            return route.to
    bundle.event("route.selected", node_id=node.id, to=node.default, when="default")
    return node.default


def _next_after(document: Graph, completed: list[str]) -> str | None:
    """The node to run when resuming a graph that was not parked.

    Walks from the start through what is already done, so the answer comes
    from the graph's shape and the ledger rather than from a cursor somebody
    would have to keep in sync.
    """
    if not completed:
        return document.start
    current: str | None = document.start
    seen: set[str] = set()
    while current is not None and current not in SINKS and current not in seen:
        seen.add(current)
        if current not in completed:
            return current
        node = document.node(current)
        if node.kind == "router":
            # A router is cheap and pure: re-deciding it on resume is
            # correct, because state is replayed too.
            return current
        current = node.then
    return current


def _finish(
    bundle: Bundle,
    document: Graph,
    status: str,
    reason: str,
    current: str | None,
    completed: list[str],
    state: dict[str, str],
    invocation: Invocation,
) -> None:
    """Close out a run — and `graph.finished` ONLY when it really is over.

    A parked graph is not finished; it is waiting. Writing the event anyway
    made `Replay.finished` true, so `wring graph resume` refused to continue
    the exact runs resume exists for. The loop has the same shape and the
    same reason: a loop with no `loop.finished` is precisely the one
    `wring resume` will pick up.
    """
    if status in ("done", "failed"):
        bundle.event("graph.finished", status=status, reason=reason)
    bundle.write_state(state)
    bundle.write_manifest(
        status=status,
        reason=reason,
        current=current,
        graph_id=document.id,
        completed=tuple(completed),
    )
    bundle.write_summary(
        _summary(document, status, reason, current, completed, invocation)
    )
    bundle.write_digests()  # LAST, so it covers the manifest and the summary


def _summary(
    document: Graph,
    status: str,
    reason: str,
    current: str | None,
    completed: list[str],
    invocation: Invocation,
) -> str:
    lines = [
        f"# wring graph — {document.id}",
        "",
        f"- status: **{status}** — {reason}",
    ]
    if current:
        lines.append(f"- waiting at: `{current}`")
    lines += ["", "| node | kind | state |", "|---|---|---|"]
    for node in document.nodes:
        mark = "done" if node.id in completed else (
            "waiting" if node.id == current else "not reached"
        )
        lines.append(f"| `{node.id}` | {node.kind} | {mark} |")
    if invocation.notes:
        # The summary says what to type next, because a dry run that ends
        # without one is a dead end (SPEC_GRAPH_V0 §3e).
        lines += ["", "## Next"] + [f"{note}" for note in invocation.notes]
    return "\n".join(lines) + "\n"


# --- the node kinds --------------------------------------------------------


def _execute(
    root: Path,
    node: Node,
    document: Graph,
    bundle: Bundle,
    state: dict[str, str],
    invocation: Invocation,
) -> tuple[dict[str, str], dict[str, Any]]:
    """Run one node. Returns (state writes, extra fields for `node.finished`).

    A node never writes `node.finished` itself. `run` owns the ledger, so
    exactly one event is emitted per node — an append-only log that records a
    node finishing twice is a log that disagrees with itself, and `Replay`
    reads these to decide what must not be re-run.
    """
    if node.kind == "intent":
        return _run_intent(root, node, document, bundle), {}
    if node.kind == "human":
        return _run_human(node, bundle, state), {}
    if node.kind == "router":
        return {}, {}
    if node.kind == "loop":
        return _run_loop(root, node, document, bundle, invocation)
    if node.kind == "deliver":
        return _run_deliver(root, node, document, bundle, invocation)
    raise NodeFailed(node.id, f"the '{node.kind}' node kind is not built yet")


def _run_intent(
    root: Path, node: Node, document: Graph, bundle: Bundle
) -> dict[str, str]:
    """Stage the input into the bundle, scrubbed on the way in.

    The same scrub-at-the-read `wring issue` does, so the file in evidence,
    anything built from it later and the wire all carry the same text.
    """
    reference = node.input or ""
    name = reference.split(".", 1)[1] if reference.startswith("inputs.") else reference
    source = document.inputs.get(name, name)
    path = (root / source).resolve()

    if not path.is_file():
        raise NodeFailed(node.id, f"there is no file at {source}")
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise NodeFailed(node.id, f"{source} could not be read: {exc}") from exc

    staged = bundle.node_dir(node.id) / "brief.md"
    staged.write_text(bundle.redactor.scrub(text), encoding="utf-8")
    return {
        path_: staged.relative_to(bundle.directory).as_posix()
        for _, path_ in node.writes
    }


def _run_human(node: Node, bundle: Bundle, state: dict[str, str]) -> dict[str, str]:
    """The `approved: false` interlock, again and on purpose.

    SPEC_INTENT §3's three rules hold verbatim: the constant is written as a
    constant, nothing but a person editing the file may flip it, and the file
    is re-read from disk every time. There is deliberately no flag.
    """
    directory = bundle.node_dir(node.id)
    decision = directory / DECISION_FILENAME

    if not decision.is_file():
        (directory / PROMPT_FILENAME).write_text(
            f"# {node.id}\n\n{node.prompt}\n\n"
            f"Set `approved: true` in `{DECISION_FILENAME}` beside this file, "
            "then resume the graph.\n",
            encoding="utf-8",
        )
        decision.write_text(
            "# Edit this file by hand. Nothing else can approve it — no flag,\n"
            "# no environment variable, no model reply.\n"
            "approved: false\n"
            'comments: ""\n'
            "state_updates: {}\n",
            encoding="utf-8",
        )
        raise Parked(node.id, "a person must approve this node")

    try:
        answered = yaml.safe_load(decision.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise NodeFailed(
            node.id, f"{DECISION_FILENAME} is not valid YAML: {exc}"
        ) from exc
    if not isinstance(answered, dict):
        raise NodeFailed(node.id, f"{DECISION_FILENAME} must be a mapping")

    # The most plausible place for someone to try writing the flag down: it is
    # edited by hand, beside a prompt, by the person who would type it. It is
    # still a file (ruling 5), and saying so is better than ignoring it —
    # silently ignoring an authorisation somebody believed they had granted is
    # how a dry run gets mistaken for a delivery.
    if _SEND_KEY in answered:
        raise NodeFailed(
            node.id, f"a decision file {_SEND_REFUSAL}"
        )

    if answered.get("approved") is not True:
        raise Parked(node.id, "a person must approve this node")

    updates = answered.get("state_updates") or {}
    if not isinstance(updates, dict):
        raise NodeFailed(node.id, "'state_updates' must be a mapping")
    written = {}
    for key, value in updates.items():
        if not isinstance(value, str):
            raise NodeFailed(
                node.id,
                f"state_updates.{key} must be a string — v0 state is strings, "
                "because that is what a router can compare",
            )
        written[str(key)] = value
    return written


def resolved(bundle: Bundle) -> Graph:
    """Rebuild the graph a run actually executed.

    From `graph.resolved.json` rather than from the author's file, so a run
    resumes as the thing it started as — editing the YAML mid-run changes the
    next run, never this one.
    """
    path = bundle.directory / RESOLVED_FILENAME
    if not path.is_file():
        raise GraphError(
            f"{bundle.directory.name} has no {RESOLVED_FILENAME} — it is not a "
            "graph run, or it died before recording what it was running"
        )
    try:
        recorded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise GraphError(f"{RESOLVED_FILENAME} could not be read: {exc}") from exc

    nodes = []
    for entry in recorded.get("nodes", []):
        routes = tuple(
            Route(
                to=route["to"],
                **dict(
                    zip(
                        ("path", "op", "values"),
                        _reparse(route["when"]),
                        strict=True,
                    )
                ),
                source=route["when"],
            )
            for route in entry.get("routes", [])
        )
        budgets = entry.get("budgets") or {}
        nodes.append(
            Node(
                id=entry["id"],
                kind=entry["kind"],
                then=entry.get("then"),
                input=entry.get("input"),
                prompt=entry.get("prompt"),
                budgets=Budgets(
                    wall_clock=budgets.get("wall_clock"),
                    max_iterations=budgets.get("max_iterations"),
                ),
                writes=tuple(
                    (name, path_) for name, path_ in (entry.get("writes") or {}).items()
                ),
                routes=routes,
                default=entry.get("default"),
            )
        )
    return Graph(
        id=recorded["id"],
        wall_clock=recorded.get("wall_clock", 0),
        nodes=tuple(nodes),
        start=recorded["start"],
        inputs=recorded.get("inputs", {}),
        state=recorded.get("state", {}),
    )


# What a node has or has not done, for the one-screen report. Single words,
# because a status screen is read in a column.
DONE, WAITING, PENDING = "done", "waiting", "not reached"


@dataclass(frozen=True)
class Progress:
    """Where a run got to — for `status` and `explain`.

    Derived from `graph.jsonl` and `graph.resolved.json`, and from nothing
    else. Not `state.json`, not `manifest.json`: those are conveniences, and a
    reporter that trusted them would be describing the two cheapest files in
    the bundle rather than what happened. Not the author's YAML either — that
    file describes the NEXT run.
    """

    graph_id: str
    run_id: str
    status: str  # one of STATUSES
    reason: str
    current: str | None
    completed: tuple[str, ...]
    state: dict[str, str]
    marks: tuple[tuple[str, str, str], ...]  # (node id, kind, mark)
    stopped_at: str | None  # the node the reason is ABOUT, sink routes included
    dry_runs: tuple[tuple[str, str], ...]  # (deliver node id, its run bundle)


def progress(bundle: Bundle, document: Graph) -> Progress:
    """Replay a run into the answer both reporting verbs need."""
    events = bundle.read_events()
    replay = Replay.of(events)

    finished = _last(events, "graph.finished")
    failed = _last(events, "node.failed")
    parked = _last(events, "node.parked")

    if finished is not None:
        status = str(finished.get("status") or "failed")
        if status not in STATUSES:
            # The ledger is a file, and a file can be edited. A status this
            # program does not have a meaning for is read as the safe one.
            status = "failed"
        reason = str(finished.get("reason") or "")
        current = None
    elif replay.parked_at is not None:
        status = "parked"
        reason = str((parked or {}).get("reason") or "a person must act")
        current = replay.parked_at
    else:
        # Neither an ending nor a park: the ledger simply stops, which is the
        # shape `kill -9` leaves. Calling that "parked" would send somebody to
        # edit a decision file nobody is waiting on.
        status = "interrupted"
        current = _next_after(document, list(replay.completed))
        reason = (
            f"the ledger stops after '{replay.completed[-1]}' — the run was "
            "killed or is still going"
            if replay.completed
            else "the ledger records no finished node"
        )

    stopped_at = current
    if status == "failed":
        routed = [
            event
            for event in events
            if event.get("type") == "route.selected" and event.get("to") == "fail"
        ]
        # A node that failed says more than a router that fell through, and a
        # router that fell through says more than "a route led to fail".
        stopped_at = (
            str(failed.get("node_id"))
            if failed is not None
            else (str(routed[-1].get("node_id")) if routed else None)
        )
        if failed is not None:
            reason = str(failed.get("reason") or reason)
        elif routed:
            matched = str(routed[-1].get("when") or "default")
            reason = f"'{routed[-1].get('node_id')}' routed to fail on {matched}"

    kinds = {node.id: node.kind for node in document.nodes}
    marks = tuple(
        (
            node.id,
            node.kind,
            DONE
            if node.id in replay.completed
            else (WAITING if node.id == current else PENDING),
        )
        for node in document.nodes
    )

    dry_runs = []
    for event in events:
        if (
            event.get("type") == "node.finished"
            and kinds.get(event.get("node_id")) == "deliver"
            and event.get("status") == "dry_run"
        ):
            dry_runs.append(
                (str(event["node_id"]), _delivered_from(bundle, str(event["node_id"])))
            )

    return Progress(
        graph_id=document.id,
        run_id=bundle.graph_run_id,
        status=status,
        reason=reason,
        current=current,
        completed=replay.completed,
        state=replay.state,
        marks=marks,
        stopped_at=stopped_at,
        dry_runs=tuple(dry_runs),
    )


def _last(events: list[dict[str, Any]], event_type: str) -> dict[str, Any] | None:
    found = [event for event in events if event.get("type") == event_type]
    return found[-1] if found else None


def _delivered_from(bundle: Bundle, node_id: str) -> str:
    """The run bundle a dry-run deliver node planned against, so `explain` can
    name the command that would finish the job."""
    path = bundle.directory / NODES_DIRNAME / node_id / DELIVER_REF_FILENAME
    try:
        return str(json.loads(path.read_text(encoding="utf-8"))["run_dir"])
    except (OSError, ValueError, KeyError, TypeError):
        return ""


def _reparse(when: str) -> tuple[str, str, tuple[str, ...]]:
    """A route expression from a resolved graph, back into its parts.

    It passed validation once, on the way in — but it is re-parsed rather
    than trusted, because the file has been on disk in the meantime and this
    is the one place a resumed run could be handed something new.
    """
    problems: list[str] = []
    parsed = _expression(when, "resolved route", problems)
    if parsed is None:
        raise GraphError(f"{RESOLVED_FILENAME} carries an unparseable route: {when!r}")
    return parsed


def _elapsed(started_at: datetime) -> float:
    """Seconds a graph run has been going. Its own function so a test can
    stand where a long run would be without waiting for one."""
    return (datetime.now().astimezone() - started_at).total_seconds()


def _remaining(document: Graph, bundle: Bundle) -> int:
    """The graph's budget, minus what it has spent."""
    return int(document.wall_clock - _elapsed(bundle.started_at))


def _run_loop(
    root: Path,
    node: Node,
    document: Graph,
    bundle: Bundle,
    invocation: Invocation,
) -> tuple[dict[str, str], dict[str, Any]]:
    """Run the repair loop this node names — `loop.run`, in process.

    **Not a subprocess.** `verify.py` exists because shelling out to yourself
    means parsing your own output, and in process is the only way the loop's
    supervision machinery — pgid files, reaping, the breaker, `wants_prove` —
    comes along intact. The graph adds sequencing, never a second loop.

    **Budgets nest and are hard** (supervision invariant 8). Whatever the node
    asked for is clamped to the graph's REMAINING budget before the loop
    starts, and handed to `loop.run` as its own parameters — so enforcement is
    the loop's existing enforcement rather than a second timer to keep honest.

    Every outcome is a routing fact. The node completes whatever the loop
    decided, writes the reason into state, and the router says what it means:
    a graph that treated `no_progress` as a crash could not express "escalate
    to a human".
    """
    from wringer import config as config_module
    from wringer import loop as loop_module

    left = _remaining(document, bundle)
    if left <= 0:
        bundle.event(
            "budget.exhausted",
            node_id=node.id,
            budget="graph.wall_clock",
            detail=f"{document.wall_clock}s spent before this node started",
        )
        raise NodeFailed(
            node.id,
            f"the graph's {document.wall_clock}s budget was spent before this "
            "node started, so the loop was never run",
        )

    try:
        cfg = config_module.load(root / config_module.CONFIG_FILENAME)
    except config_module.ConfigError as exc:
        raise NodeFailed(node.id, str(exc)) from exc
    if cfg.run is None:
        raise NodeFailed(
            node.id,
            f"no 'run:' section in {config_module.CONFIG_FILENAME} — a loop "
            "node runs the worker YOUR repo declared, and there is no default",
        )

    wall_clock = min(node.budgets.wall_clock or left, left)
    try:
        outcome = loop_module.run(
            root,
            cfg,
            max_iterations=node.budgets.max_iterations,
            wall_clock=wall_clock,
            # §3c: the SAME callbacks `cmd_run` wires, so a graph run looks
            # like the `wring run` users already know. Passing none of them
            # made a graph run the worker and the gates in total silence.
            **invocation.loop_console,
        )
    except evidence.EvidenceError as exc:
        raise NodeFailed(node.id, str(exc)) from exc

    # Referenced, never nested: one run, one bundle, one place.
    reference = _relative_to(outcome.directory, root)
    (bundle.node_dir(node.id) / LOOP_REF_FILENAME).write_text(
        json.dumps(
            {
                "loop_dir": reference,
                "status": outcome.status,
                "reason": outcome.reason,
                "iterations": outcome.iterations,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return {path: outcome.reason for _, path in node.writes}, {
        "status": outcome.status,
        "reason": outcome.reason,
        "ref": reference,
    }


def _relative_to(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def _delivered_run(root: Path, node: Node, document: Graph, bundle: Bundle) -> Path:
    """Which run bundle a deliver node ships. **Decided, never guessed.**

    The loop node's: `nodes/<loop>/loop.ref.json` names the loop bundle, and
    that loop's manifest names the `final_run` its last verification wrote.
    That bundle is the evidence THIS graph produced, and it is the one whose
    gates the graph's own router read.

    Deliberately **not** `evidence.latest_run`. The newest directory under
    `.wringer/runs/` is whatever was written last — including a `wring verify`
    somebody typed by hand while the graph was parked, or a run from a
    different piece of work entirely. Shipping it would attach this graph's
    approval to a run this graph never saw, which is the mistake
    `check_verified_tree` refuses one layer down. So a graph with no completed
    loop node fails here rather than reaching for whatever is nearest.

    The last loop node to finish wins, read from the ledger rather than from
    the graph's shape: the ledger is what actually happened, and after a
    router a graph's shape has more than one answer.
    """
    kinds = {other.id: other.kind for other in document.nodes}
    loops = [
        event["node_id"]
        for event in bundle.read_events()
        if event.get("type") == "node.finished"
        and kinds.get(event.get("node_id")) == "loop"
    ]
    if not loops:
        raise NodeFailed(
            node.id,
            "no loop node has finished in this run, so there is no verified "
            "bundle for this graph to deliver. A deliver node ships the run "
            "the graph's own loop node recorded — never whatever happens to "
            "be the newest directory under .wringer/runs/, which is a "
            "different piece of work as easily as this one",
        )

    reference = bundle.directory / NODES_DIRNAME / loops[-1] / LOOP_REF_FILENAME
    try:
        recorded = json.loads(reference.read_text(encoding="utf-8"))
        loop_dir = root / str(recorded["loop_dir"])
        manifest = json.loads(
            (loop_dir / "manifest.json").read_text(encoding="utf-8")
        )
        final_run = manifest["result"]["final_run"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise NodeFailed(
            node.id,
            f"the '{loops[-1]}' loop node's own evidence could not be read "
            f"({exc}), so there is nothing to deliver from it",
        ) from exc

    if not final_run:
        raise NodeFailed(
            node.id,
            f"the '{loops[-1]}' loop node never completed a verification, so "
            "it recorded no run bundle. There is no evidence to deliver",
        )
    run_dir = root / str(final_run)
    if not run_dir.is_dir():
        raise NodeFailed(
            node.id, f"the loop's final run bundle is gone: {final_run}"
        )
    return run_dir


def _run_deliver(
    root: Path,
    node: Node,
    document: Graph,
    bundle: Bundle,
    invocation: Invocation,
) -> tuple[dict[str, str], dict[str, Any]]:
    """Deliver, through the real machinery and all of its refusals.

    `deliver.plan` then `deliver.send`, exactly as `cmd_deliver` calls them —
    ruling 4: the graph engine contains no delivery logic, so the five
    conditions that buy the power to write git history are the shipped ones
    rather than a second copy that could drift out of agreement with them.

    **Ruling 2 is what this function is for.** A router may have arrived here
    on a `build-status` a human typed by hand into a decision file. Nothing
    above asks whether that was true; `deliver.plan` re-reads the bundle and
    refuses a run whose gates failed, whose tree has moved, or whose own
    gates proved nothing. A graph that lied in state delivers nothing.

    Two details that are not style. The redactor is the graph's, because
    `deliver.plan` compares the bundle's SCRUBBED `diff.patch` against a
    freshly computed diff and scrubs it with whatever it was handed — a
    narrower redactor here makes the two disagree and refuses a tree that
    never moved, permanently. And `deliver.Refused` keeps its own exit code
    on the way out, because 1 and 3 are different answers.
    """
    from wringer import config as config_module
    from wringer import deliver as deliver_module

    run_dir = _delivered_run(root, node, document, bundle)

    try:
        cfg = config_module.load(root / config_module.CONFIG_FILENAME)
    except config_module.ConfigError as exc:
        raise NodeFailed(node.id, str(exc)) from exc
    if cfg.deliver is None:
        raise NodeFailed(
            node.id,
            f"no 'deliver:' section in {config_module.CONFIG_FILENAME} — its "
            "absence is what makes writing git history unreachable, and a "
            "graph does not add the power. Add one:\n\n"
            "  deliver:\n"
            '    branch: "wringer/{run}"\n'
            "    remote: origin",
        )

    try:
        planned = deliver_module.plan(
            root, cfg, run_dir, run_dir.name, redactor=bundle.redactor
        )
    except deliver_module.Refused as exc:
        raise NodeRefused(node.id, str(exc), exc.exit_code) from exc
    except deliver_module.DeliverError as exc:
        raise NodeFailed(node.id, str(exc)) from exc

    try:
        delivery = deliver_module.Bundle.create(
            root / deliver_module.DELIVERIES_DIRNAME, redactor=bundle.redactor
        )
    except deliver_module.DeliverError as exc:
        raise NodeFailed(node.id, str(exc)) from exc

    # Written before anything runs, as `wring deliver` does: what would happen
    # is auditable rather than asserted, and `--send` is this same path
    # continuing one step further.
    delivery.write_plan(planned)

    live = invocation.authorise(node.id)
    mode = "live" if live else "dry_run"
    delivered: dict[str, Any] = {
        "branch": None,
        "commit": None,
        "pushed": False,
        # A graph node never opens a merge request. `deliver.plan`/`send` are
        # the two functions §3e names, and the forge is a socket this program
        # opens rather than git in a subprocess — widening that is a spec
        # change, not a slice.
        "merge_request": None,
    }
    if live:
        try:
            delivered.update(deliver_module.send(root, delivery, planned))
        except deliver_module.DeliverError as exc:
            delivery.event("delivery.failed", why=str(exc))
            delivery.write_manifest(mode, planned, delivered)
            # A failed delivery is still a bundle somebody may audit, and one
            # without digests is one `wring audit` has to refuse.
            delivery.write_digests()
            raise NodeFailed(node.id, str(exc)) from exc

    delivery.write_manifest(mode, planned, delivered)
    delivery.write_digests()  # LAST, so it covers the manifest

    reference = _relative_to(delivery.directory, root)
    (bundle.node_dir(node.id) / DELIVER_REF_FILENAME).write_text(
        json.dumps(
            {
                "delivery_dir": reference,
                "mode": mode,
                "run_dir": _relative_to(run_dir, root),
                "branch": planned.branch,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    if not live:
        invocation.notes += [
            f"Delivery from '{node.id}' was a dry run — git was not touched. "
            f"The patch, message, branch and MR body are in {reference}/.",
            "Read them, then deliver that run:",
            f"  wring deliver {_relative_to(run_dir, root)} --send",
            "Or run the graph again with --send on the invocation, which "
            "authorises the deliver node that run reaches, once.",
        ]

    return {}, {
        "status": mode,
        "ref": reference,
        "detail": planned.branch,
    }
