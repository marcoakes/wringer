"""Load and validate `.wringer.yaml`.

The config surface is deliberately tiny (SPEC_VERIFY_V0.md §Config
design). Validation is strict: unknown keys are errors, because a typo
in a gate definition must not silently change what "verified" means.
"""

from __future__ import annotations

import re
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

CONFIG_FILENAME = ".wringer.yaml"
DEFAULT_TIMEOUT_SECONDS = 120

# `wring run` defaults (SPEC_RUN_V0.md §Config). Three laps is enough to show
# whether a worker is converging without spending an afternoon proving it is
# not; fifteen minutes is a generous single turn for a coding agent.
DEFAULT_MAX_ITERATIONS = 3
DEFAULT_WORKER_TIMEOUT_SECONDS = 900

# What a worker command may ask Wringer to substitute. Anything else in
# braces is a typo, and a typo that reached the shell would be a command
# nobody wrote.
WORKER_PLACEHOLDERS = ("brief", "evidence_dir", "iteration")

# `{name}` not preceded by `$`, so `${SHELL_VAR}` is the shell's business and
# passes through untouched.
_PLACEHOLDER_PATTERN = re.compile(r"(?<!\$)\{([a-z_]+)\}")

# A gate id becomes a directory name in the bundle (`gates/NNN_<id>/`), so it
# is a slug rather than free text: no path separators, no spaces, no unicode
# lookalikes. A config typo must never write outside the run directory.
GATE_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*")
MAX_GATE_ID_LENGTH = 64

_TOP_LEVEL_KEYS = {
    "version", "gates", "evidence", "run", "judge", "fleet", "workspace",
    "forge", "deliver", "bench",
}
_BENCH_KEYS = {"contender_wall_clock", "contenders"}
# A contender varies the WORKER and nothing else (SPEC_BENCH_V0 §3). Every
# other key an author might reach for — a budget, a gate list, a directory —
# is refused, because identical conditions are what make two rows comparable.
_CONTENDER_KEYS = {"id", "agent", "worker"}

# Keys refused with a reason rather than a bare "unknown key", because these
# are the ones a thoughtful author would expect to work. Ceilings first: a
# per-contender budget is the flags-only-tighten rule broken inside a file.
_CONTENDER_CEILINGS = ("wall_clock", "max_iterations", "worker_timeout", "prove")
_FORGE_KEYS = {"kind", "endpoint", "repo", "token_env", "timeout"}
_DELIVER_KEYS = {"branch", "base", "remote", "issues_dir"}

# What a branch template may ask Wringer to substitute (SPEC_GET_V0.md §6).
BRANCH_PLACEHOLDERS = ("task", "run")

# The forges `forge.py` maps. A vendor string never appears outside that
# module (AGENTS.md rule 5), so this list is also the whole vendor surface.
FORGE_KINDS = ("github", "gitlab")

DEFAULT_FORGE_TIMEOUT_SECONDS = 30
DEFAULT_BRANCH_TEMPLATE = "wringer/{run}"
DEFAULT_REMOTE = "origin"
DEFAULT_ISSUES_DIR = "issues"

# `owner/name`, the shape both mapped forges use. It becomes a URL path, so
# it is a slug pair rather than free text — a repo of `../../x` would be a
# path traversal against someone else's API.
# Every segment must START with a letter or digit, which is what makes `..`
# impossible: `forge.repo` is interpolated into a path on someone else's API,
# and `owner/../../admin` would fetch from a repository this config never
# declared. GitLab percent-encodes the whole string and would have been safe;
# GitHub does not, and "we are safe on one of the two forges" is not a rule.
REPO_PATTERN = re.compile(
    r"[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)+"
)

# `deliver.remote` and `deliver.base` are passed to git as POSITIONAL
# arguments, so a value beginning with '-' is read as an option. A remote of
# `--force` would make a force push assemblable at runtime with the word
# appearing nowhere in the source — which is SPEC_GET_V0.md §1's third
# condition, broken without breaking the grep that checks it. A remote of
# `--receive-pack=...` is worse. They are slugs, checked here, before the
# value can reach an argv.
REF_NAME_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/-]*")
_GATE_KEYS = {"id", "run", "timeout", "optional", "required"}
# `.wringer.yaml` ONLY. `parse_gate` is deliberately shared — `wring spec`
# runs proposed gates through it so Wringer can never propose a gate its own
# loader would reject — so putting `proves` in the set above would legalise it
# on a DRAFTED spec too, handing the drafter the binding channel
# SPEC_ACCEPT_V0 ruling 2 says it does not have, and putting this parser at
# odds with `spec.schema.json`'s `additionalProperties: false` over the same
# bytes. The binding is a human's act in the config file, and the key set is
# where that is enforced rather than merely asserted.
_CONFIG_GATE_KEYS = _GATE_KEYS | {"proves"}
_EVIDENCE_KEYS = {"include", "redact"}
_REDACT_KEYS = {"env"}
_RUN_KEYS = {
    "worker", "max_iterations", "worker_timeout", "wall_clock",
    # SPEC_VACUITY_V0 §3a. `prove` lives HERE and not on a flag because the
    # audited party does not get to choose whether the audit runs: `wring run`
    # increasingly gets invoked by the agent itself, or by a script the agent
    # wrote. `.wringer.yaml` is committed and reviewed like code, and what
    # counts as *proven* for a repository belongs there.
    "prove", "prove_setup",
    # There is deliberately NO ceiling key here (ruling 3). Every answer to
    # "what happens when you hit it" is worse than the cost: skipping
    # re-introduces the vacuity the feature exists to catch, refusing is a
    # worse-timed block, warning does nothing. `vacuity.json` records
    # `worktree_ms` and `prove_ms` so a repo decides with numbers instead.
}
_FLEET_KEYS = {
    "concurrency",
    "deadline",
    "progress_window",
    "retries",
    "on_exhausted",
    "join",
    "child",
    "worker_fallbacks",
    "worktree",
    "scope",
}
_CHILD_KEYS = {"max_iterations", "worker_timeout", "wall_clock"}
_ACP_KEYS = {"command", "args", "env_passthrough"}

_JUDGE_KEYS = {
    "endpoint",
    "model",
    "rubric",
    "api_key_env",
    "timeout",
    "max_output_tokens",
}

# `wring judge` defaults (SPEC_JUDGE_V0.md §3). endpoint, model and rubric
# have no defaults and never will: Wringer contacts the endpoint you wrote
# down, never one it guessed.
DEFAULT_JUDGE_TIMEOUT_SECONDS = 120
DEFAULT_MAX_OUTPUT_TOKENS = 1024

# Hosts a cleartext endpoint may name. Anywhere else must be https, because
# a rubric and a diff are not things to put on the wire in the clear.
_LOOPBACK = {"localhost", "127.0.0.1", "::1", "[::1]"}


class ConfigError(Exception):
    """Invalid, missing, or unreadable configuration (CLI exit code 2)."""


@dataclass(frozen=True)
class Gate:
    id: str
    run: str
    timeout: int = DEFAULT_TIMEOUT_SECONDS
    optional: bool = False
    # The criterion this gate evidences (SPEC_ACCEPT_V0 §1). None is every
    # gate that exists today: absence is the opt-in boundary, not a default.
    proves: str | None = None


@dataclass(frozen=True)
class Run:
    """The `run:` section — what `wring run` drives (SPEC_RUN_V0.md).

    `worker` has no default and never will. Wringer runs the command a repo
    wrote down; inventing one would be the same sin as inventing a gate.
    """

    # Either a shell command (the original form, supported forever) or an
    # AcpWorker. Both run under the same supervision invariants; the loop
    # does not know or care which it got, and that is deliberate.
    worker: str | AcpWorker
    max_iterations: int = DEFAULT_MAX_ITERATIONS
    worker_timeout: int = DEFAULT_WORKER_TIMEOUT_SECONDS
    # Optional, no default: the loop is already structurally bounded by
    # iterations x worker_timeout, so a wall clock is a second opinion the
    # repo asks for rather than one Wringer imposes.
    wall_clock: int | None = None
    # SPEC_VACUITY_V0 §3a — the repo's declaration that a green tick here has
    # to be one that could have been red. **A flag may only tighten this.**
    # `--prove` turns it on for one run; there is no `--no-prove` and no
    # environment variable, so nothing can turn off what the repo declared.
    # Same shape as `approved: false` in SPEC_INTENT_V0, and matching it
    # deliberately: *flags may tighten, never loosen* is then one rule people
    # learn once rather than a per-feature surprise.
    prove: bool = False
    # Run in the scratch worktree before the pre-change gates — `uv sync
    # --frozen`, `npm ci`. Optional, and repos with committed dependencies
    # leave it unset and lose nothing. Without it, a project whose deps are
    # gitignored fails every pre-change gate on a missing environment, and
    # §1's comparison table reads that as PROOF. See vacuity.py's docstring.
    prove_setup: str | None = None


@dataclass(frozen=True)
class AcpWorker:
    """`run.worker.acp` — an agent spoken to over the Agent Client Protocol.

    The second worker form. A shell string says "run this and see what
    changed"; this says "hold a session with an agent that speaks a
    standard". Wringer is the ACP *client* and never the agent — that
    distinction is the whole neutrality position (SPEC_ACP_V0.md).
    """

    command: str
    args: tuple[str, ...] = ()
    # NAMES of variables to pass through, never values. Everything not named
    # is withheld: an agent gets a minimal environment, not the operator's
    # whole shell. Each named variable's value is folded into the redactor.
    env_passthrough: tuple[str, ...] = ()


@dataclass(frozen=True)
class Judge:
    """The `judge:` section — what `wring judge` may contact (SPEC_JUDGE_V0).

    `endpoint`, `model` and `rubric` have no defaults and never will. A repo
    with no `judge:` section leaves no reachable code path in the program
    that opens a socket, which is the whole network story in one rule.
    """

    endpoint: str
    model: str
    rubric: str
    api_key_env: str | None = None
    timeout: int = DEFAULT_JUDGE_TIMEOUT_SECONDS
    max_output_tokens: int = DEFAULT_MAX_OUTPUT_TOKENS


@dataclass(frozen=True)
class ScopeEntry:
    """One row of `fleet.scope`: a task, and the criteria it proves.

    CRITERIA ids, never gate ids (SPEC_SCOPE_V0 ruling 1). The human writes
    the vocabulary the spec was approved in, and the gate is reached through
    the `proves:` binding they already installed — one join, declared twice
    nowhere.
    """

    task: str
    criteria: tuple[str, ...]


@dataclass(frozen=True)
class Fleet:
    """The `fleet:` section (SPEC_SUPERVISION_V0.md §S3).

    `deadline` is required and has no default: an unbounded fleet is the
    thing this whole slice exists to make impossible.
    """

    deadline: int
    concurrency: int = 4
    progress_window: int = 1200
    retries: int = 1
    on_exhausted: str = "park"
    join: str = "all"
    child_max_iterations: int | None = None
    # Invariant 8: budgets nest. A child's ceilings come from the fleet
    # that spawned it, and the fleet's own deadline is not a substitute —
    # it kills the supervisor, not the worker burning the budget.
    child_worker_timeout: int | None = None
    child_wall_clock: int | None = None
    worker_fallbacks: tuple[str, ...] = ()
    # Off by default. When on, the fleet gives each task its own git
    # worktree so parallel children cannot fight over one working tree.
    # This is the ONLY git write Wringer ever makes, and it is metadata:
    # add and remove. No commit, no branch move, no push — that law holds.
    worktree: bool = False
    # Which criteria each task proves (SPEC_SCOPE_V0). None when undeclared,
    # and undeclared is every fleet that shipped before this: no resolution,
    # no dispatch change, no new behaviour. Only the SHAPE is checked here —
    # the ruling-5 refusals need the task file and the spec, so they fire at
    # `wring fleet` start where both are in hand.
    scope: tuple[ScopeEntry, ...] | None = None


@dataclass(frozen=True)
class Forge:
    """The `forge:` section — the issue tracker and MR host (SPEC_GET_V0 §6).

    `kind`, `endpoint` and `repo` have no defaults and never will, for the
    judge's reason: a repo that has not opted in leaves no reachable code path
    to a forge at all.
    """

    kind: str
    endpoint: str
    repo: str
    token_env: str | None = None
    timeout: int = DEFAULT_FORGE_TIMEOUT_SECONDS


@dataclass(frozen=True)
class Deliver:
    """The `deliver:` section — how a verified change becomes a branch.

    Every field has a safe default *except the ones that name someone else's
    infrastructure*, which live in `forge:`. `base` is None by default and is
    then resolved from the remote: Wringer guessing a default branch is
    exactly the mistake §1 forbids.
    """

    branch: str = DEFAULT_BRANCH_TEMPLATE
    base: str | None = None
    remote: str = DEFAULT_REMOTE
    issues_dir: str = DEFAULT_ISSUES_DIR


@dataclass(frozen=True)
class Contender:
    """One worker in a bench, and the whole of what may vary between rows.

    `agent_id` is recorded when the contender was declared as sugar — the id
    an author wrote, kept so the report can say which agent a row is, while
    the COMMAND behind it stays in `agents.py` where every vendor string
    lives.
    """

    id: str
    worker: str | AcpWorker
    agent_id: str | None = None


@dataclass(frozen=True)
class Bench:
    """The `bench:` section (SPEC_BENCH_V0.md §3).

    `contender_wall_clock` is required and has no default: it is the SAME
    ceiling handed to every contender's loop, and a bench whose contenders
    ran under different budgets would be producing numbers that cannot be
    compared — which is the only thing this command exists to do.

    There is deliberately no `max_iterations` here. `run.max_iterations`, or
    its shipped default, already binds every contender equally; a bench-level
    one could only restate it or loosen it, and `loop.run` treats that
    parameter as an override rather than a clamp, so "tightens" would have
    been a word the machinery does not implement.
    """

    contender_wall_clock: int
    contenders: tuple[Contender, ...]


@dataclass(frozen=True)
class Config:
    version: int
    gates: tuple[Gate, ...]
    # The `evidence:` section (include lists, redaction patterns) is
    # parsed for shape only until the Day-3/Day-4 bolts consume it.
    evidence: dict[str, Any] = field(default_factory=dict)
    # None when the repo has not opted into the loop. `wring verify` neither
    # needs nor reads this; `wring run` refuses without it.
    run: Run | None = None
    # None when the repo has not opted into the judge. Its absence is what
    # makes a network call unreachable rather than merely unlikely.
    judge: Judge | None = None
    # None when the repo has not opted into fleets.
    fleet: Fleet | None = None
    # None when the repo has not opted into a forge. Its absence is what makes
    # `wring issue` and the MR half of `wring deliver` unreachable.
    forge: Forge | None = None
    # None when the repo has not opted into delivery. Its absence is what
    # makes writing git history unreachable (SPEC_GET_V0.md §1).
    deliver: Deliver | None = None
    # Where `wring get` clones. No default: Wringer does not choose where to
    # put someone's code.
    workspace: str | None = None
    # None when the repo has not opted into benching. Its absence is what
    # makes `wring bench` unreachable (SPEC_BENCH_V0.md §3).
    bench: Bench | None = None


def load(path: Path) -> Config:
    if not path.is_file():
        raise ConfigError(
            f"no {path.name} in {path.parent} — run 'wring init' to create one"
        )
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ConfigError(f"{path.name} is not valid YAML: {exc}") from exc
    cfg = parse(raw, source=path.name)
    _check_bindings(cfg, path.parent)
    return cfg


SPEC_FILENAME = "wringer.spec.yaml"


def _check_bindings(cfg: Config, root: Path) -> None:
    """Every `proves:` names a criterion that exists and may be evidenced.

    Checked at LOAD, not at verify: a binding to nothing is a claim about
    nothing, and the failure a reader can act on is "this id is not in your
    spec" rather than an artifact that silently records a debt nobody can
    explain. Deliberately not a schema concern — `wringer.spec.v1` is frozen
    and the join lives entirely on the config side.
    """
    bound = [gate for gate in cfg.gates if gate.proves]
    if not bound:
        return

    spec_path = root / SPEC_FILENAME
    if not spec_path.is_file():
        named = ", ".join(f"'{gate.id}' -> {gate.proves}" for gate in bound)
        raise ConfigError(
            f"{CONFIG_FILENAME} binds gates to criteria ({named}) but there is "
            f"no {SPEC_FILENAME} in {root} to bind them to. Write the spec "
            "first, or drop the 'proves:' keys"
        )

    from wringer import spec as spec_module

    criteria = {c.id: c for c in spec_module.load(spec_path).criteria}
    check_bindings(bound, criteria, CONFIG_FILENAME)


def check_bindings(
    gates: Any, criteria: dict[str, Any], where: str = CONFIG_FILENAME
) -> None:
    """The three rules that join a gate to the criterion it evidences.

    **One function, two callers, on purpose** (SPEC_GATEGEN_V0 ruling 6). The
    config loader checks `.wringer.yaml` AFTER a human applied a diff;
    `wring plan` checks `wringer.gates.yaml` BEFORE anyone has. Those are
    different files at different moments and they must not be different rules
    — a second copy under another name is exactly how the drafter would come
    to propose something the loader then refuses, which is the failure this
    whole seam exists to prevent.

    `where` names the file the GATES came from, so a sidecar failure says
    which of the two documents to go and fix. The criteria always come from
    `wringer.spec.yaml`, which is why that name is a constant below.
    """
    seen: dict[str, str] = {}
    for gate in gates:
        if not gate.proves:
            continue
        criterion = criteria.get(gate.proves)
        if criterion is None:
            known = ", ".join(sorted(criteria)) or "none"
            raise ConfigError(
                f"{where}: gate '{gate.id}' proves '{gate.proves}', which is "
                f"not a criterion in {SPEC_FILENAME}. Declared there: {known}"
            )
        if criterion.human:
            raise ConfigError(
                f"{where}: gate '{gate.id}' proves '{gate.proves}', which "
                f"{SPEC_FILENAME} marks 'human: true'. A command claiming to "
                "evidence judgement is a category error — human criteria are "
                "answered by people, and nothing here may score them"
            )
        if gate.proves in seen:
            raise ConfigError(
                f"{where}: gates '{seen[gate.proves]}' and '{gate.id}' both "
                f"prove '{gate.proves}'. One criterion, one gate: a second is "
                "a second claim to keep honest, and the artifact has one slot "
                "per criterion"
            )
        seen[gate.proves] = gate.id


def parse(raw: Any, source: str = CONFIG_FILENAME) -> Config:
    if not isinstance(raw, dict):
        raise ConfigError(f"{source}: top level must be a mapping")

    unknown = sorted(set(raw) - _TOP_LEVEL_KEYS)
    if unknown:
        raise ConfigError(f"{source}: unknown top-level keys: {', '.join(unknown)}")

    version = raw.get("version")
    if not _is_int(version) or version != 1:
        raise ConfigError(f"{source}: 'version: 1' is required (got {version!r})")

    gates_raw = raw.get("gates")
    if not isinstance(gates_raw, list) or not gates_raw:
        raise ConfigError(f"{source}: 'gates' must be a non-empty list")
    gates = tuple(
        parse_gate(entry, index, source, allow_proves=True)
        for index, entry in enumerate(gates_raw)
    )

    seen: set[str] = set()
    for gate in gates:
        if gate.id in seen:
            raise ConfigError(f"{source}: duplicate gate id '{gate.id}'")
        seen.add(gate.id)

    evidence = raw.get("evidence")
    if evidence is None:
        evidence = {}
    if not isinstance(evidence, dict):
        raise ConfigError(f"{source}: 'evidence' must be a mapping")
    _validate_evidence(evidence, source)

    workspace = raw.get("workspace")
    if workspace is not None and (
        not isinstance(workspace, str) or not workspace.strip()
    ):
        raise ConfigError(f"{source}: 'workspace' must be a non-empty string")

    return Config(
        version=version,
        gates=gates,
        evidence=evidence,
        run=_parse_run(raw.get("run"), source),
        judge=_parse_judge(raw.get("judge"), source),
        fleet=_parse_fleet(raw.get("fleet"), source),
        forge=_parse_forge(raw.get("forge"), source),
        deliver=_parse_deliver(raw.get("deliver"), source),
        workspace=workspace.strip() if workspace else None,
        bench=_parse_bench(raw.get("bench"), source),
    )


def _parse_bench(raw: Any, source: str) -> Bench | None:
    """The `bench:` section, or None when the repo has not opted in."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ConfigError(f"{source}: 'bench' must be a mapping")

    unknown = sorted(set(raw) - _BENCH_KEYS)
    if unknown:
        extra = ""
        if "max_iterations" in unknown:
            # Named rather than lumped in, because it is the key an author
            # would most reasonably expect: `run.max_iterations` already binds
            # every contender equally, and a bench-level one could only
            # restate or loosen it.
            extra = (
                " — 'run.max_iterations' already binds every contender "
                "equally, and a bench-level one could only loosen it"
            )
        raise ConfigError(
            f"{source}: unknown keys under 'bench': {', '.join(unknown)}{extra}"
        )

    if raw.get("contender_wall_clock") is None:
        raise ConfigError(
            f"{source}: 'bench.contender_wall_clock' is required — it is the "
            "same hard ceiling every contender's loop is handed, and a bench "
            "whose contenders ran under different budgets produces numbers "
            "that cannot be compared"
        )
    ceiling = _positive_int(raw, "contender_wall_clock", 1, source, section="bench")

    declared = raw.get("contenders")
    if not isinstance(declared, list):
        raise ConfigError(
            f"{source}: 'bench.contenders' must be a list of two or more"
        )

    contenders: list[Contender] = []
    seen: set[str] = set()
    for index, entry in enumerate(declared):
        contender = _parse_contender(entry, index, source)
        if contender.id in seen:
            raise ConfigError(
                f"{source}: two contenders share the id '{contender.id}' — "
                "an id names a directory and a row, so it has to be unique"
            )
        seen.add(contender.id)
        contenders.append(contender)

    if len(contenders) < 2:
        raise ConfigError(
            f"{source}: 'bench.contenders' needs two or more — a comparison "
            "of one is 'wring run', which is the command for it"
        )

    return Bench(contender_wall_clock=ceiling, contenders=tuple(contenders))


def _parse_contender(raw: Any, index: int, source: str) -> Contender:
    """One contender: an id, and exactly one way of naming its worker."""
    where = f"bench.contenders[{index}]"
    if not isinstance(raw, dict):
        raise ConfigError(f"{source}: '{where}' must be a mapping")

    for ceiling in _CONTENDER_CEILINGS:
        if ceiling in raw:
            raise ConfigError(
                f"{source}: '{where}.{ceiling}' is not a contender key. A "
                "contender varies the worker and nothing else — every row "
                "runs under identical conditions, or the rows cannot be "
                "compared, and a per-contender ceiling would loosen a budget "
                "from inside a file"
            )

    unknown = sorted(set(raw) - _CONTENDER_KEYS)
    if unknown:
        raise ConfigError(
            f"{source}: unknown keys under '{where}': {', '.join(unknown)}"
        )

    contender_id = raw.get("id")
    if not isinstance(contender_id, str) or not contender_id.strip():
        raise ConfigError(f"{source}: '{where}.id' must be a non-empty string")
    contender_id = contender_id.strip()
    if not GATE_ID_PATTERN.fullmatch(contender_id) or len(contender_id) > 64:
        raise ConfigError(
            f"{source}: '{where}.id' must be a slug — '{contender_id}' is "
            "not, and an id names a directory under .wringer/worktrees/"
        )

    named, declared = raw.get("agent"), raw.get("worker")
    if named is not None and declared is not None:
        raise ConfigError(
            f"{source}: '{where}' declares both 'agent' and 'worker' — "
            "'agent' IS a worker, named from the shipped table, so pick one"
        )
    if named is None and declared is None:
        raise ConfigError(
            f"{source}: '{where}' needs an 'agent' or a 'worker' — there is "
            "no default worker here, for the reason 'run.worker' has none"
        )

    if named is not None:
        return Contender(
            id=contender_id, worker=_agent_worker(named, where, source),
            agent_id=str(named).strip(),
        )
    return Contender(
        id=contender_id,
        worker=_parse_worker(declared, source, section=f"{where}.worker"),
    )


def _agent_worker(named: Any, where: str, source: str) -> AcpWorker:
    """Expand an agent id into the mapping the shipped table declares.

    Imported inside the function on purpose: `agents.py` imports THIS module
    for `AcpWorker`, so a module-level import here would be a cycle. The
    house precedent is `deliver.py`'s `_spec_module()`.

    The id is all a config may say. The command, its args and the variable
    its credential lives in come from `agents.py`, which is one of the two
    modules allowed to hold a vendor string (AGENTS.md rule 5) — so this
    sugar adds a name, never a new place a command can come from.
    """
    from wringer import agents

    if not isinstance(named, str) or not named.strip():
        raise ConfigError(f"{source}: '{where}.agent' must be a non-empty string")
    found = agents.find(named.strip())
    if found is None:
        raise ConfigError(
            f"{source}: '{where}.agent' names '{named}', which is not an "
            f"agent this version knows — the ids are: {', '.join(agents.known())}"
        )
    return agents.worker(found)


def _parse_forge(raw: Any, source: str) -> Forge | None:
    """The `forge:` section, or None when the repo has not opted in."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ConfigError(f"{source}: 'forge' must be a mapping")

    unknown = sorted(set(raw) - _FORGE_KEYS)
    if unknown:
        raise ConfigError(f"{source}: unknown keys under 'forge': {', '.join(unknown)}")

    for key in ("kind", "endpoint", "repo"):
        value = raw.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ConfigError(
                f"{source}: 'forge.{key}' must be a non-empty string — there "
                "is no default, because Wringer contacts the forge you wrote "
                "down and never one it guessed"
            )

    kind = raw["kind"].strip()
    if kind not in FORGE_KINDS:
        raise ConfigError(
            f"{source}: 'forge.kind' must be one of {', '.join(FORGE_KINDS)} "
            f"(got {kind!r})"
        )

    endpoint = raw["endpoint"].strip()
    _validate_endpoint(endpoint, source, "forge.endpoint")

    repo = raw["repo"].strip()
    if not REPO_PATTERN.fullmatch(repo):
        raise ConfigError(
            f"{source}: 'forge.repo' must be 'owner/name' (got {repo!r}) — it "
            "becomes a path in someone else's API, so it is a slug pair rather "
            "than free text"
        )

    token_env = raw.get("token_env")
    if token_env is not None and (
        not isinstance(token_env, str) or not token_env.strip()
    ):
        raise ConfigError(
            f"{source}: 'forge.token_env' must be the NAME of an environment "
            "variable, not a token — Wringer will not read a credential out of "
            "a config file"
        )

    return Forge(
        kind=kind,
        endpoint=endpoint,
        repo=repo,
        token_env=token_env,
        timeout=_positive_int(
            raw, "timeout", DEFAULT_FORGE_TIMEOUT_SECONDS, source, section="forge"
        ),
    )


def _parse_deliver(raw: Any, source: str) -> Deliver | None:
    """The `deliver:` section, or None when the repo has not opted in.

    Its absence is what makes writing git history unreachable: the amended
    law 6 is a flag a human types *and* a section a repo wrote down.
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ConfigError(f"{source}: 'deliver' must be a mapping")

    unknown = sorted(set(raw) - _DELIVER_KEYS)
    if unknown:
        raise ConfigError(
            f"{source}: unknown keys under 'deliver': {', '.join(unknown)}"
        )

    branch = raw.get("branch", DEFAULT_BRANCH_TEMPLATE)
    if not isinstance(branch, str) or not branch.strip():
        raise ConfigError(f"{source}: 'deliver.branch' must be a non-empty string")
    unknown_names = sorted(
        set(_PLACEHOLDER_PATTERN.findall(branch)) - set(BRANCH_PLACEHOLDERS)
    )
    if unknown_names:
        raise ConfigError(
            f"{source}: 'deliver.branch' uses unknown placeholder(s) "
            f"{', '.join('{' + n + '}' for n in unknown_names)} — available: "
            f"{', '.join('{' + p + '}' for p in BRANCH_PLACEHOLDERS)}"
        )

    for key in ("base", "remote", "issues_dir"):
        value = raw.get(key)
        if value is not None and (not isinstance(value, str) or not value.strip()):
            raise ConfigError(f"{source}: 'deliver.{key}' must be a non-empty string")

    # Both reach git as positional arguments, so neither may look like one of
    # git's own options. See REF_NAME_PATTERN.
    for key in ("base", "remote"):
        value = raw.get(key)
        if value is not None and not REF_NAME_PATTERN.fullmatch(value.strip()):
            raise ConfigError(
                f"{source}: 'deliver.{key}' must be a plain name — letters, "
                f"digits, '.', '_', '-' and '/', starting with a letter or "
                f"digit (got {value.strip()!r}). It is passed to git as an "
                "argument, and a value that begins with '-' is read as an "
                "option rather than a name"
            )

    issues_dir = (raw.get("issues_dir") or DEFAULT_ISSUES_DIR).strip()
    if Path(issues_dir).is_absolute() or ".." in Path(issues_dir).parts:
        raise ConfigError(
            f"{source}: 'deliver.issues_dir' must be a path inside the "
            f"repository (got {issues_dir!r}) — Wringer writes files there"
        )

    return Deliver(
        branch=branch.strip(),
        base=(raw["base"].strip() if raw.get("base") else None),
        remote=(raw.get("remote") or DEFAULT_REMOTE).strip(),
        issues_dir=issues_dir,
    )


def _parse_scope(raw: Any, source: str) -> tuple[ScopeEntry, ...] | None:
    """The SHAPE of `fleet.scope`, and nothing about its meaning.

    Whether the ids exist, resolve to gates, or cover the task file are
    ruling 5's refusals, and they need two documents this function has never
    seen — the task file and `wringer.spec.yaml`. They fire in
    `fleet.resolve_scope`, at `wring fleet` start, before any child spawns.
    Splitting it the other way would put half the family in a message that
    says "config error" and half in one that says "fleet error" for defects
    a reader makes in the same three lines of YAML.

    Declaration ORDER is preserved, because every refusal below quotes it
    back to the human who wrote it.
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ConfigError(
            f"{source}: 'fleet.scope' must be a mapping of task id to the "
            "criteria it proves"
        )

    entries: list[ScopeEntry] = []
    for task, criteria in raw.items():
        if not isinstance(task, str) or not task.strip():
            raise ConfigError(
                f"{source}: 'fleet.scope' keys must be task ids (got {task!r})"
            )
        if not isinstance(criteria, list) or not all(
            isinstance(c, str) and c.strip() for c in criteria
        ):
            raise ConfigError(
                f"{source}: 'fleet.scope.{task}' must be a list of criterion "
                f"ids from {SPEC_FILENAME} (got {criteria!r})"
            )
        entries.append(ScopeEntry(task=task, criteria=tuple(criteria)))
    return tuple(entries)


def _parse_fleet(raw: Any, source: str) -> Fleet | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ConfigError(f"{source}: 'fleet' must be a mapping")

    unknown = sorted(set(raw) - _FLEET_KEYS)
    if unknown:
        raise ConfigError(f"{source}: unknown keys under 'fleet': {', '.join(unknown)}")

    if raw.get("deadline") is None:
        raise ConfigError(
            f"{source}: 'fleet.deadline' is required — a fleet without a "
            "wall clock is exactly the thing that runs all night"
        )

    on_exhausted = raw.get("on_exhausted", "park")
    if on_exhausted not in ("park", "fail"):
        raise ConfigError(
            f"{source}: 'fleet.on_exhausted' must be 'park' or 'fail' "
            f"(got {on_exhausted!r})"
        )

    join = raw.get("join", "all")
    if not isinstance(join, str) or not _valid_join(join):
        raise ConfigError(
            f"{source}: 'fleet.join' must be 'all', 'first_pass', or "
            f"'quorum:<0-1>' (got {join!r})"
        )

    fallbacks = raw.get("worker_fallbacks", [])
    if not isinstance(fallbacks, list) or not all(
        isinstance(f, str) and f.strip() for f in fallbacks
    ):
        raise ConfigError(
            f"{source}: 'fleet.worker_fallbacks' must be a list of non-empty "
            "strings — a declared ladder, never one improvised at runtime"
        )

    child = raw.get("child", {})
    if not isinstance(child, dict):
        raise ConfigError(f"{source}: 'fleet.child' must be a mapping")
    unknown = sorted(set(child) - _CHILD_KEYS)
    if unknown:
        raise ConfigError(
            f"{source}: unknown keys under 'fleet.child': {', '.join(unknown)}"
        )

    retries = raw.get("retries", 1)
    if not _is_int(retries) or retries < 0:
        raise ConfigError(
            f"{source}: 'fleet.retries' must be an integer of at least 0 "
            f"(got {retries!r})"
        )

    worktree = raw.get("worktree", False)
    if not isinstance(worktree, bool):
        raise ConfigError(f"{source}: 'fleet.worktree' must be a boolean")

    return Fleet(
        worktree=worktree,
        scope=_parse_scope(raw.get("scope"), source),
        deadline=_positive_int(raw, "deadline", 1, source, section="fleet"),
        concurrency=_positive_int(raw, "concurrency", 4, source, section="fleet"),
        progress_window=_positive_int(
            raw, "progress_window", 1200, source, section="fleet"
        ),
        retries=retries,
        on_exhausted=on_exhausted,
        join=join,
        child_max_iterations=(
            None
            if child.get("max_iterations") is None
            else _positive_int(
                child, "max_iterations", 1, source, section="fleet.child"
            )
        ),
        child_worker_timeout=(
            None
            if child.get("worker_timeout") is None
            else _positive_int(
                child, "worker_timeout", 1, source, section="fleet.child"
            )
        ),
        child_wall_clock=(
            None
            if child.get("wall_clock") is None
            else _positive_int(child, "wall_clock", 1, source, section="fleet.child")
        ),
        worker_fallbacks=tuple(fallbacks),
    )


def _valid_join(join: str) -> bool:
    if join in ("all", "first_pass"):
        return True
    if join.startswith("quorum:"):
        try:
            fraction = float(join.split(":", 1)[1])
        except ValueError:
            return False
        return 0 < fraction <= 1
    return False


def _parse_judge(raw: Any, source: str) -> Judge | None:
    """The `judge:` section, or None when the repo has not opted in."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ConfigError(f"{source}: 'judge' must be a mapping")

    unknown = sorted(set(raw) - _JUDGE_KEYS)
    if unknown:
        raise ConfigError(f"{source}: unknown keys under 'judge': {', '.join(unknown)}")

    for key in ("endpoint", "model", "rubric"):
        value = raw.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ConfigError(
                f"{source}: 'judge.{key}' must be a non-empty string — there is "
                "no default, because Wringer contacts the endpoint you wrote "
                "down and never one it guessed"
            )

    endpoint = raw["endpoint"].strip()
    _validate_endpoint(endpoint, source)

    api_key_env = raw.get("api_key_env")
    if api_key_env is not None and (
        not isinstance(api_key_env, str) or not api_key_env.strip()
    ):
        raise ConfigError(
            f"{source}: 'judge.api_key_env' must be the NAME of an environment "
            "variable, not a key — Wringer will not read a credential out of a "
            "config file"
        )

    return Judge(
        endpoint=endpoint,
        model=raw["model"].strip(),
        rubric=raw["rubric"].strip(),
        api_key_env=api_key_env,
        timeout=_positive_int(raw, "timeout", DEFAULT_JUDGE_TIMEOUT_SECONDS, source,
                              section="judge"),
        max_output_tokens=_positive_int(
            raw, "max_output_tokens", DEFAULT_MAX_OUTPUT_TOKENS, source,
            section="judge",
        ),
    )


def _validate_endpoint(endpoint: str, source: str, key: str = "judge.endpoint") -> None:
    """Checked at parse time, so an unsafe endpoint can never reach a socket.

    https anywhere; http only to loopback. No userinfo, because credentials
    do not travel in URLs — and this URL is recorded in the bundle. No query
    string, for the same reason.

    Shared by `judge.endpoint` and `forge.endpoint`: one set of safety rules
    for every socket in the program, which is the point of having two.
    """
    parsed = urllib.parse.urlsplit(endpoint)

    if parsed.scheme not in ("http", "https"):
        raise ConfigError(
            f"{source}: '{key}' must be http:// or https:// "
            f"(got {parsed.scheme or 'no scheme'!r})"
        )
    if not parsed.hostname:
        raise ConfigError(f"{source}: '{key}' has no host")
    if parsed.username or parsed.password:
        raise ConfigError(
            f"{source}: '{key}' must not carry credentials — the "
            "endpoint is recorded in the evidence. Use an env-var name"
        )
    if parsed.query:
        raise ConfigError(
            f"{source}: '{key}' must not carry a query string — it is "
            "recorded in the evidence"
        )
    if parsed.scheme == "http" and parsed.hostname not in _LOOPBACK:
        raise ConfigError(
            f"{source}: '{key}' may only use plain http:// to "
            f"loopback (got host {parsed.hostname!r}) — a rubric and a diff "
            "are not things to send in the clear"
        )


def _parse_run(raw: Any, source: str) -> Run | None:
    """The `run:` section, or None when the repo has not opted into the loop."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ConfigError(f"{source}: 'run' must be a mapping")

    unknown = sorted(set(raw) - _RUN_KEYS)
    if unknown:
        raise ConfigError(f"{source}: unknown keys under 'run': {', '.join(unknown)}")

    worker = _parse_worker(raw.get("worker"), source)

    return Run(
        worker=worker,
        max_iterations=_positive_int(
            raw, "max_iterations", DEFAULT_MAX_ITERATIONS, source
        ),
        worker_timeout=_positive_int(
            raw, "worker_timeout", DEFAULT_WORKER_TIMEOUT_SECONDS, source
        ),
        wall_clock=(
            None
            if raw.get("wall_clock") is None
            else _positive_int(raw, "wall_clock", 1, source)
        ),
        prove=_bool(raw, "prove", False, source, section="run"),
        prove_setup=_optional_command(raw, "prove_setup", source, section="run"),
    )


def _bool(
    raw: dict, key: str, default: bool, source: str, section: str
) -> bool:
    value = raw.get(key, default)
    if not isinstance(value, bool):
        raise ConfigError(
            f"{source}: '{section}.{key}' must be true or false, not "
            f"{type(value).__name__}"
        )
    return value


def _optional_command(
    raw: dict, key: str, source: str, section: str
) -> str | None:
    value = raw.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(
            f"{source}: '{section}.{key}' must be a non-empty string"
        )
    return value


def _parse_worker(
    raw: Any, source: str, section: str = "run.worker"
) -> str | AcpWorker:
    """A shell string, or an `acp:` mapping. Never both, never neither.

    `section` names the key in messages. It defaults to `run.worker`, which is
    every existing caller, and a bench contender passes its own path so a
    refusal points at the line the author actually wrote.
    """
    if isinstance(raw, str):
        if not raw.strip():
            raise ConfigError(f"{source}: '{section}' must be a non-empty string")
        unknown = sorted(
            set(_PLACEHOLDER_PATTERN.findall(raw)) - set(WORKER_PLACEHOLDERS)
        )
        if unknown:
            raise ConfigError(
                f"{source}: '{section}' uses unknown placeholder(s) "
                f"{', '.join('{' + name + '}' for name in unknown)} — "
                f"available: {', '.join('{' + p + '}' for p in WORKER_PLACEHOLDERS)}"
            )
        return raw

    if isinstance(raw, dict):
        extra = sorted(set(raw) - {"acp"})
        if extra or "acp" not in raw:
            raise ConfigError(
                f"{source}: '{section}' as a mapping takes exactly one key, "
                f"'acp' (got {sorted(raw) or 'nothing'})"
            )
        return _parse_acp(raw["acp"], source, section=f"{section}.acp")

    raise ConfigError(
        f"{source}: '{section}' must be a shell command string, or a mapping "
        "with an 'acp' key. There is no default: Wringer runs the worker you "
        "wrote down, never one it guessed"
    )


def _parse_acp(
    raw: Any, source: str, section: str = "run.worker.acp"
) -> AcpWorker:
    if not isinstance(raw, dict):
        raise ConfigError(f"{source}: '{section}' must be a mapping")

    unknown = sorted(set(raw) - _ACP_KEYS)
    if unknown:
        raise ConfigError(
            f"{source}: unknown keys under '{section}': {', '.join(unknown)}"
        )

    command = raw.get("command")
    if not isinstance(command, str) or not command.strip():
        raise ConfigError(
            f"{source}: '{section}.command' must be a non-empty string — "
            "the agent binary that speaks ACP. Wringer never bundles or "
            "installs one"
        )

    args = raw.get("args", [])
    if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
        raise ConfigError(f"{source}: '{section}.args' must be a list of strings")

    names = raw.get("env_passthrough", [])
    if not isinstance(names, list) or not all(
        isinstance(n, str) and n.strip() for n in names
    ):
        raise ConfigError(
            f"{source}: '{section}.env_passthrough' must be a list of "
            "environment variable NAMES — never values; Wringer will not read "
            "a credential out of a config file"
        )

    return AcpWorker(
        command=command.strip(),
        args=tuple(args),
        env_passthrough=tuple(names),
    )


def _positive_int(
    raw: dict, key: str, default: int, source: str, section: str = "run"
) -> int:
    value = raw.get(key, default)
    if not _is_int(value) or value < 1:
        raise ConfigError(
            f"{source}: '{section}.{key}' must be an integer of at least 1 "
            f"(got {value!r})"
        )
    return value


def declared_secret_names(cfg: Config) -> tuple[str, ...]:
    """Every environment variable NAME this config says holds a credential.

    One place, because there are now four of them — `judge.api_key_env`,
    `forge.token_env` and every name under `run.worker.acp.env_passthrough` —
    and a caller that folds three of the four into its redactor protects
    almost everything.

    `AcpWorker`'s own docstring has always said "each named variable's value is
    is folded into the redactor", and this module's comment on
    `env_passthrough` says it too. **Nothing did it.** `loop.run` built its
    redactor from `evidence:` alone, so a passthrough variable was redacted
    only if its name happened to match `*TOKEN*`, `*SECRET*` or `*KEY*` — a
    variable called anything else was handed to an agent and then written to
    the bundle verbatim if the agent echoed it. This function is what makes
    the promise true; `verify.run` and `loop.run` are its callers.

    Order is stable and duplicates are dropped: the result reaches
    `Redactor.from_config`, which turns names into values.
    """
    names: list[str] = []
    if cfg.judge is not None and cfg.judge.api_key_env:
        names.append(cfg.judge.api_key_env)
    if cfg.forge is not None and cfg.forge.token_env:
        names.append(cfg.forge.token_env)
    if cfg.run is not None and isinstance(cfg.run.worker, AcpWorker):
        names.extend(cfg.run.worker.env_passthrough)
    # Every contender's names too. A bench runs N agents, each handed its own
    # credential by name, and a redactor built from only the `run:` worker's
    # would leave every other contender's unprotected in the one command that
    # deliberately runs more than one agent.
    if cfg.bench is not None:
        for contender in cfg.bench.contenders:
            if isinstance(contender.worker, AcpWorker):
                names.extend(contender.worker.env_passthrough)
    return tuple(dict.fromkeys(names))


def substitute(command: str, **values: Any) -> str:
    """Fill a worker command's placeholders.

    Only the declared names, and only `{name}` — `${VAR}` is the shell's, and
    an unknown placeholder was already rejected at parse time.
    """

    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        return str(values[name]) if name in values else match.group(0)

    return _PLACEHOLDER_PATTERN.sub(replace, command)


def _validate_evidence(evidence: dict[str, Any], source: str) -> None:
    """Shape-check the `evidence:` section.

    `redact` is consumed now (Day 4), so a typo in it must be an error rather
    than silently switching redaction off — the one failure mode where a
    quiet default is dangerous. `include` is not consumed yet, but its shape
    is still checked: "unknown keys are errors" and "a malformed known key is
    fine" cannot both be the rule.
    """
    unknown = sorted(set(evidence) - _EVIDENCE_KEYS)
    if unknown:
        raise ConfigError(
            f"{source}: unknown keys under 'evidence': {', '.join(unknown)}"
        )

    include = evidence.get("include")
    if include is not None and (
        not isinstance(include, list)
        or not all(isinstance(item, str) and item for item in include)
    ):
        raise ConfigError(
            f"{source}: 'evidence.include' must be a list of non-empty "
            "strings, e.g. 'git.diff' — v0.1 captures what it can regardless, "
            "but a typo here must not look like valid configuration"
        )

    redact = evidence.get("redact")
    if redact is None:
        return
    if not isinstance(redact, dict):
        raise ConfigError(f"{source}: 'evidence.redact' must be a mapping")

    unknown = sorted(set(redact) - _REDACT_KEYS)
    if unknown:
        raise ConfigError(
            f"{source}: unknown keys under 'evidence.redact': {', '.join(unknown)}"
        )

    patterns = redact.get("env")
    if patterns is None:
        return
    if not isinstance(patterns, list) or not all(
        isinstance(pattern, str) and pattern for pattern in patterns
    ):
        raise ConfigError(
            f"{source}: 'evidence.redact.env' must be a list of non-empty "
            "environment-variable name patterns, e.g. '*TOKEN*'"
        )


def parse_gate(
    raw: Any, index: int, source: str, *, allow_proves: bool = False
) -> Gate:
    """Validate one gate definition.

    Public because `wring spec` proposes gates: a gate a drafter suggests goes
    through exactly the parser `.wringer.yaml` would use, so Wringer can never
    propose a gate its own config loader would reject.
    """
    where = f"{source}: gates[{index}]"
    if not isinstance(raw, dict):
        raise ConfigError(f"{where} must be a mapping")

    unknown = sorted(set(raw) - (_CONFIG_GATE_KEYS if allow_proves else _GATE_KEYS))
    if unknown:
        raise ConfigError(f"{where}: unknown keys: {', '.join(unknown)}")

    gate_id = raw.get("id")
    if not isinstance(gate_id, str) or not gate_id:
        raise ConfigError(f"{where}: 'id' must be a non-empty string")
    if len(gate_id) > MAX_GATE_ID_LENGTH:
        raise ConfigError(
            f"{where} ('{gate_id}'): 'id' must be at most "
            f"{MAX_GATE_ID_LENGTH} characters"
        )
    if not GATE_ID_PATTERN.fullmatch(gate_id):
        raise ConfigError(
            f"{where} ('{gate_id}'): 'id' must start with a letter or digit and "
            "use only letters, digits, '-' and '_' — it becomes a directory "
            "name in the evidence bundle"
        )

    run = raw.get("run")
    if not isinstance(run, str) or not run.strip():
        raise ConfigError(f"{where} ('{gate_id}'): 'run' must be a non-empty string")

    timeout = raw.get("timeout", DEFAULT_TIMEOUT_SECONDS)
    if not _is_int(timeout) or timeout <= 0:
        raise ConfigError(
            f"{where} ('{gate_id}'): 'timeout' must be a positive integer "
            f"of seconds (got {timeout!r})"
        )

    # The spec spells this both ways (`optional: true` in the init
    # template, `required: true` in the config section). Canonical field
    # is `optional`; `required` is accepted as its negation.
    if "optional" in raw and "required" in raw:
        raise ConfigError(
            f"{where} ('{gate_id}'): use either 'optional' or 'required', not both"
        )
    if "optional" in raw:
        optional = raw["optional"]
        if not isinstance(optional, bool):
            raise ConfigError(f"{where} ('{gate_id}'): 'optional' must be a boolean")
    elif "required" in raw:
        required = raw["required"]
        if not isinstance(required, bool):
            raise ConfigError(f"{where} ('{gate_id}'): 'required' must be a boolean")
        optional = not required
    else:
        optional = False

    proves = raw.get("proves")
    if proves is not None:
        if not isinstance(proves, str) or not proves.strip():
            raise ConfigError(
                f"{where} ('{gate_id}'): 'proves' must be a non-empty string — "
                "the id of a criterion in wringer.spec.yaml"
            )
        if optional:
            raise ConfigError(
                f"{where} ('{gate_id}'): an optional gate may not carry "
                f"'proves: {proves}'. Evidence that cannot stop a run is a "
                "promise without enforcement, and 'wring verify --prove' never "
                "proves optional gates, so the remedy for an unevidenced "
                "criterion could never fire for this one"
            )

    return Gate(
        id=gate_id, run=run, timeout=timeout, optional=optional, proves=proves
    )


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)
