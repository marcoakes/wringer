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
    "forge", "deliver", "bench", "execution", "provenance",
}
_PROVENANCE_KEYS = {"require_signature", "signer", "expect_identity"}
_EXECUTION_KEYS = {"backend", "image", "runtime", "network", "env", "user"}
# Container runtimes whose command line is the Docker CLI's. Declared here as
# well as in `backend.py` for the same reason every other vendor string is
# behind one mapping — but the parser needs it before a backend object exists,
# and `backend` imports `config`, so the direction of that dependency decides
# which file holds the literal. `test_backend.py` pins the two together.
_KNOWN_RUNTIMES = {"docker", "podman", "nerdctl"}
# Signing tools, declared here for the same reason `_KNOWN_RUNTIMES` is: the
# parser needs the set before a `sign` object exists, and `sign` imports nothing
# from here only because it holds no config type. `test_sign.py` pins the two
# tables together.
_KNOWN_SIGNERS = {"cosign", "gh"}
# `execution.user` reaches argv positionally; see `backend.USER_PATTERN`.
_USER_PATTERN = re.compile(r"\d+(?::\d+)?")
_BENCH_KEYS = {"contender_wall_clock", "contenders", "attempts", "parallel"}
# The most attempts and the most concurrency a bench may declare. Ceilings
# rather than tastes: attempts multiply agent spend LINEARLY and every one of
# them is a real model call, so a typo in a config file is a bill. Not
# configurable, for the reason `health.MIN_HISTORY` is not.
MAX_BENCH_ATTEMPTS = 10
MAX_BENCH_PARALLEL = 8
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
#
# `stability` is here for the second of those reasons alone: it is a run
# parameter like `timeout` and a drafter proposing one would be harmless, but
# `spec.schema.json` is frozen with `additionalProperties: false`, so a
# drafted gate carrying it would render a `wringer.spec.yaml` that fails its
# own published schema.
# `artifacts` is here and NOT in `_GATE_KEYS` for the same reason `stability`
# is: `spec.schema.json` is frozen with `additionalProperties: false`, so a
# DRAFTED gate carrying it would render a `wringer.spec.yaml` that fails its
# own published schema. It is a run parameter a human declares in the config
# file, not something a drafter proposes.
_CONFIG_GATE_KEYS = _GATE_KEYS | {
    "proves", "stability", "concurrent", "artifacts",
}
_ARTIFACTS_KEYS = {"max_bytes", "total_bytes"}
_STABILITY_KEYS = {"attempts", "require_consistent"}

# The most attempts one gate may declare. A ceiling rather than a taste:
# attempts multiply a gate's wall clock, and a repo that needs 50 draws to
# decide whether its test suite is deterministic has a different problem than
# this feature solves. Deliberately not configurable — see `MIN_HISTORY` in
# health.py for the same reasoning about knobs.
MAX_STABILITY_ATTEMPTS = 10
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
    # SPEC_CONTAIN_V0 ruling 1. Worker containment lives HERE and never under
    # `execution:`, and that is not a naming preference: `vacuity.prove`
    # returns INCONCLUSIVE unconditionally when `execution.backend` is
    # `container` (vacuity.py:161-187), so containment expressed through that
    # key would make every witness in Phase 3's committed pass `inconclusive`
    # and the money would measure nothing. This key is what W9 ruled.
    "containment",
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

# SPEC_CONTAIN_V0 §3. Closed, like every other section here: a typo in a
# containment declaration must not silently change what "contained" means.
_CONTAINMENT_KEYS = {"runtime", "image", "requires", "env", "user", "egress"}
_EGRESS_KEYS = {"policy", "hosts", "ports", "broker_image"}
# Two values, and a third is a spec change rather than a config addition.
# There is no `all` and no way to spell "unrestricted": a worker that wants
# the open network declares no containment and the record says `trusted_local`
# out loud. Flags tighten and never loosen, and so do sections.
EGRESS_NONE = "none"
EGRESS_ALLOWLIST = "allowlist"
_EGRESS_POLICIES = (EGRESS_NONE, EGRESS_ALLOWLIST)
DEFAULT_EGRESS_PORTS = (443,)

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
class Stability:
    """A gate's `stability:` policy — SPEC_STABILITY_V0.md §2.

    `attempts` is how many times the gate runs in one verification. Every
    attempt is recorded; the classification comes from the observations and
    from nothing else.

    `require_consistent` defaults to **true**, and the default is the whole
    safety story. `attempts: 3` on its own must not mean "retry until green":
    that is the defect this feature exists to catch, and a key whose absence
    installed it would be a trap. Opting out is legal, explicit, recorded in
    the bundle, and refused outright on a gate that carries `proves:`.
    """

    attempts: int
    require_consistent: bool = True


@dataclass(frozen=True)
class Provenance:
    """The `provenance:` section — SPEC_SIGN_V0.md §5.

    Absent means every attestation this repo writes is unsigned, which is what
    every attestation written before this section existed already was, and which
    `wring audit` reports as `signature_missing` — the ordinary case, not a
    failure.

    `require_signature` is a **delivery** policy: it says changes leave this
    repository only from an environment that can sign the record. It is checked
    where delivery happens rather than where attestation does, because an
    attestation is written after a delivery and a policy that could only refuse
    afterwards would refuse nothing.
    """

    require_signature: bool = False
    signer: str = "cosign"
    # WHO to expect, so a verified signature can be held to a workload. Absent
    # means `identity_unknown` forever — never `trusted`, which would let
    # "signed by somebody" read as "signed by the right somebody".
    expect_identity: str | None = None


@dataclass(frozen=True)
class Execution:
    """The `execution:` section — WHERE a gate's command runs.

    Absent means `local`, which is what every run did before this section
    existed: `shell=True` in the repo root with the whole environment
    inherited. That is not a default chosen for convenience — it is the
    documented contract, because a tool that ran your commands somewhere other
    than where you pointed it would be lying about what it verified.

    `image` has **no default and never will**, the same rule as
    `judge.endpoint`. Wringer runs the image you wrote down, never one it
    guessed: a moving tag Wringer picked would put "ran in a container" in the
    evidence with nobody having decided which container.

    `network` defaults to **false**. An opt-in that had to be typed to be
    switched ON is the only kind that means anything.
    """

    backend: str
    image: str | None = None
    runtime: str = "docker"
    network: bool = False
    # NAMES of variables the container may see, never values — the same rule
    # `run.worker.acp.env_passthrough` follows, and for the same reason.
    # Everything not named is withheld, so a container gets a stated
    # environment rather than the operator's whole shell.
    env: tuple[str, ...] = ()
    # `uid` or `uid:gid`, or None for the image's own declared user. Offered
    # rather than applied: the published image declares uid 1000 and its author
    # wrote down why, so overriding that silently would contradict an image
    # this repo does not own at run time. A Linux bind mount owned by another
    # uid is what needs it; `wring doctor` prints the value.
    user: str | None = None


@dataclass(frozen=True)
class Gate:
    id: str
    run: str
    timeout: int = DEFAULT_TIMEOUT_SECONDS
    optional: bool = False
    # The criterion this gate evidences (SPEC_ACCEPT_V0 §1). None is every
    # gate that exists today: absence is the opt-in boundary, not a default.
    proves: str | None = None
    # How many times this gate runs, and whether a mixture is tolerated
    # (SPEC_STABILITY_V0). None is every gate that exists today — one attempt,
    # no `attempts/` directory, no `stability.json`, a byte-identical bundle.
    stability: Stability | None = None
    # Whether this gate may run BESIDE its concurrent neighbours
    # (SPEC_PERF_V0 §2). False is every gate that shipped, and the default is
    # not caution for its own sake: two gates share one working tree, and
    # Wringer cannot know whether they interfere. Only the repository knows,
    # so only the repository may say.
    concurrent: bool = False
    # Whether this gate may leave files behind for a person to look at
    # (SPEC_BOARD_V0 §10, S4). **None is every gate that shipped, and OFF is
    # the default**: turning this on is a repository declaring that this gate's
    # output is shareable, because — see `Artifacts` — nothing redacts a
    # binary.
    artifacts: Artifacts | None = None


# Conservative on purpose. A screenshot is tens of kilobytes; these are room
# for a handful of them and not room for a video.
DEFAULT_ARTIFACT_MAX_BYTES = 2 * 1024 * 1024
DEFAULT_ARTIFACT_TOTAL_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class Artifacts:
    """`gates[].artifacts` — this gate may leave files for a person to see.

    **Opt-in per gate, off by default, and the reason is redaction.**
    `redact.py` erases the VALUES of environment variables whose NAMES match
    `*TOKEN*`, `*SECRET*`, `*KEY*` and whatever the repo adds, by substring
    replacement, before the write. **That is a text operation and it cannot
    touch a binary.** A screenshot can carry a token rendered on a page, a
    customer's name in a fixture, or an API key in a URL bar, and no pattern in
    `.wringer.yaml` will remove any of it.

    So turning this on is a repository DECLARING that this gate's output is
    shareable. It is not a default anyone can drift into.

    Both caps are declared and both have conservative defaults. An over-cap
    artifact is OMITTED AND NAMED, never silently truncated: a truncated PNG is
    a corrupt PNG that reads as evidence, and `stdout_truncated` works only
    because text survives truncation.
    """

    max_bytes: int = DEFAULT_ARTIFACT_MAX_BYTES
    total_bytes: int = DEFAULT_ARTIFACT_TOTAL_BYTES


@dataclass(frozen=True)
class Egress:
    """`run.containment.egress` — what the contained worker may reach.

    A closed vocabulary, and each value names the mechanism that enforces it
    (SPEC_CONTAIN_V0 ruling 5):

    - `none` gets `--network none`, which the runtime enforces and which
      `docs/MANUAL_CHECKS.md` sequence G measured prevented on three runtimes,
      DNS *and* a raw IP.
    - `allowlist` gets a netns holder: a separate container that owns the
      network namespace, holds `NET_ADMIN`, and arms an address allowlist the
      worker — which joins that namespace **without** `NET_ADMIN` — cannot
      disarm. The boundary is deliberately not inside the thing it bounds.

    `ports` exists because a self-hosted or proxied model endpoint on another
    port would otherwise fail closed with no named reason, which is the
    opposite of what the refusals are for.
    """

    policy: str
    hosts: tuple[str, ...] = ()
    ports: tuple[int, ...] = DEFAULT_EGRESS_PORTS
    broker_image: str | None = None


@dataclass(frozen=True)
class Containment:
    """`run.containment` — WHERE THE WORKER RUNS (SPEC_CONTAIN_V0).

    `execution:` answers where GATES run and says at full volume that it
    contains gates and not the worker (SPEC_EXEC_V0 §5). This is the other
    half, and it is a separate key by ruling rather than by taste — W9.

    `image` has **no default and never will**, the `judge.endpoint` rule.
    Wringer ships no coding agent, from any vendor, deliberately: the
    published image's own Dockerfile says so, and that comment is the reason
    SPEC_EXEC_V0 gave for leaving the worker uncontained in the first place.
    So the repository names an image carrying the agent it chose, `requires:`
    is how it states what that image must hold, and `containment.preflight`
    is how Wringer checks rather than assumes.

    **Declaring is not establishing.** A declaration that cannot be honoured
    refuses and never degrades to `trusted_local` — that refusal is what
    converts this config section into evidence, because a record stating
    repository policy is worth reading only if a repository unable to honour
    its policy produces no bundle at all.
    """

    runtime: str
    image: str
    egress: Egress
    requires: tuple[str, ...] = ()
    # NAMES of variables the worker may see, never values — the rule
    # `execution.env` and `run.worker.acp.env_passthrough` both follow. An
    # argv is readable by anyone who can run `ps`, so the value is read from
    # Wringer's own environment and never written into a command line.
    env: tuple[str, ...] = ()
    user: str | None = None


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
    # SPEC_CONTAIN_V0. None is every repository that shipped, and absence is
    # the contract rather than a default chosen here: a repo that declares
    # nothing gets exactly today's behaviour, byte for byte, and its bundle
    # still says `trusted_local` out loud.
    containment: Containment | None = None


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
    # How many independent attempts each contender makes (SPEC_ATTEMPTS_V0).
    # 1 is what every bench did before, and it is also bench's own first stated
    # limit: "One run per contender. Agents are stochastic; a difference within
    # noise is noise." Repeats are what let a reader see the noise instead of
    # being warned about it.
    attempts: int = 1
    # How many attempts run at once. 1 is serial, which is what shipped, and
    # serial is measurement hygiene rather than a missing feature — so raising
    # this trades a comparable wall clock for elapsed time, and the artifact
    # says so rather than leaving the reader to compare contended numbers.
    parallel: int = 1


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
    # Where gates run (SPEC_EXEC_V0.md). None means `local`, which is what
    # every run did before this section existed — and the bundle still says so
    # out loud, because a reader who is not told assumes the safer answer.
    execution: Execution | None = None
    # Signing policy (SPEC_SIGN_V0.md). None means unsigned, which every
    # attestation written before this section was — and which `wring audit`
    # reports as `signature_missing`, the ordinary case rather than a failure.
    provenance: Provenance | None = None


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
        run=_parse_run(raw.get("run"), source, fleet_raw=raw.get("fleet")),
        judge=_parse_judge(raw.get("judge"), source),
        fleet=_parse_fleet(raw.get("fleet"), source),
        forge=_parse_forge(raw.get("forge"), source),
        deliver=_parse_deliver(raw.get("deliver"), source),
        workspace=workspace.strip() if workspace else None,
        bench=_parse_bench(raw.get("bench"), source),
        execution=_parse_execution(raw.get("execution"), raw.get("fleet"), source),
        provenance=_parse_provenance(raw.get("provenance"), source),
    )


def _parse_provenance(raw: Any, source: str) -> Provenance | None:
    """The `provenance:` section, or None when the repo has not opted in."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ConfigError(f"{source}: 'provenance' must be a mapping")
    unknown = sorted(set(raw) - _PROVENANCE_KEYS)
    if unknown:
        raise ConfigError(
            f"{source}: unknown keys under 'provenance': {', '.join(unknown)}"
        )

    require = raw.get("require_signature", False)
    if not isinstance(require, bool):
        raise ConfigError(
            f"{source}: 'provenance.require_signature' must be a boolean"
        )

    signer = raw.get("signer", "cosign")
    if signer not in _KNOWN_SIGNERS:
        raise ConfigError(
            f"{source}: 'provenance.signer' must be one of "
            f"{', '.join(sorted(_KNOWN_SIGNERS))} (got {signer!r}). Wringer "
            "signs nothing itself — it shells to the signer you already have, "
            "so this names a program rather than a scheme"
        )

    identity = raw.get("expect_identity")
    if identity is not None and (
        not isinstance(identity, str) or not identity.strip()
    ):
        raise ConfigError(
            f"{source}: 'provenance.expect_identity' must be a non-empty "
            "string — the signer identity a verified signature has to match, "
            "e.g. a workflow URL"
        )

    return Provenance(
        require_signature=require,
        signer=signer,
        expect_identity=identity.strip() if identity else None,
    )


def _parse_execution(raw: Any, fleet_raw: Any, source: str) -> Execution | None:
    """The `execution:` section, or None when the repo has not opted in."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ConfigError(f"{source}: 'execution' must be a mapping")
    unknown = sorted(set(raw) - _EXECUTION_KEYS)
    if unknown:
        raise ConfigError(
            f"{source}: unknown keys under 'execution': {', '.join(unknown)}"
        )

    backend = raw.get("backend")
    if backend not in ("local", "container"):
        raise ConfigError(
            f"{source}: 'execution.backend' must be 'local' or 'container' "
            f"(got {backend!r})"
        )

    image = raw.get("image")
    runtime = raw.get("runtime", "docker")
    if not isinstance(runtime, str) or runtime not in _KNOWN_RUNTIMES:
        # Apple's `container` is refused BY NAME here rather than lumped in
        # with a typo, because it is the one a macOS reader will reach for
        # first and the reason is worth a sentence. See SPEC_EXEC_V0 ruling 4:
        # its flag surface has not been verified against the argv Wringer
        # builds, and a silently-ignored `--network none` would write
        # `network: false` into the evidence while the network was up.
        extra = ""
        if runtime == "container":
            extra = (
                " — Apple's 'container' is deliberately not among them: its "
                "flags have not been verified against the command line "
                "Wringer builds, and a silently-ignored '--network none' "
                "would record 'network: false' over a live network. Run the "
                "image by hand under it if you like; Wringer will not "
                "generate its argv"
            )
        raise ConfigError(
            f"{source}: 'execution.runtime' must be one of "
            f"{', '.join(sorted(_KNOWN_RUNTIMES))} (got {runtime!r}){extra}"
        )

    network = raw.get("network", False)
    if not isinstance(network, bool):
        raise ConfigError(f"{source}: 'execution.network' must be a boolean")

    env = raw.get("env", [])
    if not isinstance(env, list) or not all(
        isinstance(name, str) and name.strip() for name in env
    ):
        raise ConfigError(
            f"{source}: 'execution.env' must be a list of environment-variable "
            "NAMES (values are read from the environment, never written here)"
        )

    user = raw.get("user")
    if user is not None:
        if not isinstance(user, str) or not _USER_PATTERN.fullmatch(user):
            raise ConfigError(
                f"{source}: 'execution.user' must be 'uid' or 'uid:gid', "
                f"digits only (got {user!r}) — it reaches the runtime as a "
                "positional argument, so anything else could be read as a flag"
            )

    if backend == "local":
        # Every other key describes a container. Accepting them beside
        # `local` would leave a config that reads as isolated and is not —
        # the single most dangerous thing this section could be allowed to
        # say, and the cheapest to refuse.
        stated = sorted(set(raw) - {"backend"})
        if stated:
            raise ConfigError(
                f"{source}: 'execution.backend: local' cannot carry "
                f"{', '.join(stated)} — those describe a container, and a "
                "config that mentions an image while running gates on this "
                "machine reads as isolated when it is not"
            )
        return Execution(backend="local")

    if not isinstance(image, str) or not image.strip():
        raise ConfigError(
            f"{source}: 'execution.backend: container' requires "
            "'execution.image' — there is no default and there will not be "
            "one. Wringer runs the image you wrote down, never one it guessed, "
            "the same rule 'judge.endpoint' follows. The published image is "
            "ghcr.io/marcoakes/wringer:main"
        )
    if image.strip().startswith("-"):
        raise ConfigError(
            f"{source}: 'execution.image' may not begin with '-' — it reaches "
            "the runtime as a positional argument and would be read as a flag"
        )

    # A worktree's `.git` is a FILE pointing into the main repository's
    # `.git/worktrees/`, and the container mounts one directory. Mount a
    # worktree alone and every gate that touches git fails on a broken
    # repository rather than on the code — which for the pre-change pass reads
    # as PROOF (SPEC_VACUITY_V0 §1's table). Refused where the two keys meet,
    # so no gate has to fail to discover it. `--prove` is the same collision
    # arriving by flag: `vacuity` records `inconclusive` for it, which is
    # already the published verdict for "the measurement could not be made
    # honestly".
    if isinstance(fleet_raw, dict) and fleet_raw.get("worktree") is True:
        raise ConfigError(
            f"{source}: 'fleet.worktree: true' cannot be combined with "
            "'execution.backend: container'. A worktree's .git is a file "
            "pointing into the main repository, and the container mounts one "
            "directory — every gate that touches git would fail on a broken "
            "repository rather than on the code. Pick one"
        )

    return Execution(
        backend="container",
        image=image.strip(),
        runtime=runtime,
        network=network,
        env=tuple(name.strip() for name in env),
        user=user,
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

    attempts = raw.get("attempts", 1)
    if not _is_int(attempts) or attempts < 1:
        raise ConfigError(
            f"{source}: 'bench.attempts' must be an integer of at least 1 "
            f"(got {attempts!r})"
        )
    if attempts > MAX_BENCH_ATTEMPTS:
        raise ConfigError(
            f"{source}: 'bench.attempts' must be at most "
            f"{MAX_BENCH_ATTEMPTS} (got {attempts}) — every attempt is a real "
            "agent run, so this multiplies the bill linearly and a typo here "
            "is money"
        )

    parallel = raw.get("parallel", 1)
    if not _is_int(parallel) or parallel < 1:
        raise ConfigError(
            f"{source}: 'bench.parallel' must be an integer of at least 1 "
            f"(got {parallel!r})"
        )
    if parallel > MAX_BENCH_PARALLEL:
        raise ConfigError(
            f"{source}: 'bench.parallel' must be at most "
            f"{MAX_BENCH_PARALLEL} (got {parallel})"
        )

    if len(contenders) < 2 and attempts < 2:
        raise ConfigError(
            f"{source}: 'bench.contenders' needs two or more — a comparison "
            "of one is 'wring run', which is the command for it. One "
            "contender with 'bench.attempts: 2' or more is legal and is a "
            "different measurement: repeated independent attempts at the same "
            "requirement, which is how an agent's own nondeterminism becomes "
            "visible"
        )

    return Bench(
        contender_wall_clock=ceiling,
        contenders=tuple(contenders),
        attempts=attempts,
        parallel=parallel,
    )


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


def _parse_run(raw: Any, source: str, fleet_raw: Any = None) -> Run | None:
    """The `run:` section, or None when the repo has not opted into the loop."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ConfigError(f"{source}: 'run' must be a mapping")

    unknown = sorted(set(raw) - _RUN_KEYS)
    if unknown:
        raise ConfigError(f"{source}: unknown keys under 'run': {', '.join(unknown)}")

    worker = _parse_worker(raw.get("worker"), source)
    containment = _parse_containment(raw.get("containment"), source)

    # **Refusal 8, config half.** The same collision `execution.backend:
    # container` already refuses one section over, arriving through the other
    # key: a detached worktree's `.git` is a FILE pointing into the main
    # repository's `.git/worktrees/`, and a container mounts one directory, so
    # a worktree mounted alone is a broken repository for a worker exactly as
    # it is for a gate. Refused where the two keys meet, so no turn has to
    # fail to discover it.
    #
    # The runtime half is in `bench.py`: `_for_contender` carries `run:`
    # through to every contender and every contender runs in a detached
    # worktree, so a refusal keyed on `fleet.worktree` alone is blind to it.
    if containment is not None and (
        isinstance(fleet_raw, dict) and fleet_raw.get("worktree") is True
    ):
        raise ConfigError(
            f"{source}: 'fleet.worktree: true' cannot be combined with "
            "'run.containment'. A worktree's .git is a file pointing into the "
            "main repository, and the container mounts one directory — the "
            "worker would open a broken repository rather than your code. "
            "Pick one"
        )

    return Run(
        worker=worker,
        containment=containment,
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


def _parse_containment(raw: Any, source: str) -> Containment | None:
    """`run.containment`, or None when the repo has not opted in.

    Every refusal here is STATIC in SPEC_CONTAIN_V0 ruling 3's sense: it costs
    no process and no packet, so `wring verify` performs it too and a broken
    declaration is found in CI rather than an hour into a corpus pass. The
    refusals that need a running container live in `containment.py`.
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ConfigError(f"{source}: 'run.containment' must be a mapping")
    unknown = sorted(set(raw) - _CONTAINMENT_KEYS)
    if unknown:
        raise ConfigError(
            f"{source}: unknown keys under 'run.containment': "
            f"{', '.join(unknown)}"
        )

    # **Refusal 10 was here, and on 2026-08-15 it became a capability**
    # (SPEC_CONTAIN_V0 §11, ruled by R-C). It refused `run.containment` beside
    # an ACP worker, because an ACP worker is a stdio JSON-RPC session
    # `acp.run_turn` holds open rather than a command spawned into a container,
    # and running it uncontained under a config claiming containment is the
    # exact defect this section exists to refuse.
    #
    # The refusal named its own second branch — *"Phase 3 must read this: the
    # re-test's worker is a shell worker, or Phase 3 builds the ACP path"* —
    # and Phase 3 built the ACP path, because the escape hatch does not
    # survive contact with what the re-test measures: the corpus tasks are
    # real upstream bug fixes and a shell script does not fix them.
    #
    # The session now crosses the boundary with its stdio attached
    # (`containment.session_argv`), its cwd translated to the mount, and the
    # agent's own binary required of the image. **Every other refusal in §3
    # still fires**, and this is deliberately not a general loosening: what
    # changed is that one combination is now implemented rather than refused.
    runtime = raw.get("runtime", "docker")
    if not isinstance(runtime, str) or runtime not in _KNOWN_RUNTIMES:
        extra = ""
        if runtime == "container":
            extra = (
                " — Apple's 'container' is deliberately not among them, for "
                "the reason SPEC_EXEC_V0 ruling 4 gives: its flags have not "
                "been verified against the command line Wringer builds"
            )
        raise ConfigError(
            f"{source}: 'run.containment.runtime' must be one of "
            f"{', '.join(sorted(_KNOWN_RUNTIMES))} (got {runtime!r}){extra}"
        )

    image = raw.get("image")
    if not isinstance(image, str) or not image.strip():
        raise ConfigError(
            f"{source}: 'run.containment' requires 'image' — there is no "
            "default and there will not be one, the same rule "
            "'judge.endpoint' and 'execution.image' follow. Wringer ships no "
            "coding agent from any vendor, so the image that runs your worker "
            "is one you name and one that carries it"
        )
    if image.strip().startswith("-"):
        raise ConfigError(
            f"{source}: 'run.containment.image' may not begin with '-' — it "
            "reaches the runtime positionally and would be read as a flag"
        )

    requires = raw.get("requires", [])
    if not isinstance(requires, list) or not all(
        isinstance(name, str) and name.strip() for name in requires
    ):
        raise ConfigError(
            f"{source}: 'run.containment.requires' must be a list of binary "
            "NAMES the image must carry — the worker's own command is the "
            "one that matters, and Wringer refuses rather than discovering it "
            "missing on the first turn"
        )

    env = raw.get("env", [])
    if not isinstance(env, list) or not all(
        isinstance(name, str) and name.strip() for name in env
    ):
        raise ConfigError(
            f"{source}: 'run.containment.env' must be a list of "
            "environment-variable NAMES (values are read from the environment "
            "at spawn time, never written here and never into an argv)"
        )

    user = raw.get("user")
    if user is not None:
        if not isinstance(user, str) or not _USER_PATTERN.fullmatch(user):
            raise ConfigError(
                f"{source}: 'run.containment.user' must be 'uid' or "
                f"'uid:gid', digits only (got {user!r}) — it reaches the "
                "runtime as a positional argument, so anything else could be "
                "read as a flag"
            )

    return Containment(
        runtime=runtime,
        image=image.strip(),
        egress=_parse_egress(raw.get("egress"), source),
        requires=tuple(requires),
        env=tuple(env),
        user=user,
    )


def _parse_egress(raw: Any, source: str) -> Egress:
    """`run.containment.egress`. Required: there is no default policy.

    A default would have to be one of "open" or "closed", and both are wrong
    to choose on somebody's behalf — open makes containment a word rather
    than a boundary, closed silently breaks every worker that needs a model
    API. So the repository says which.
    """
    if raw is None:
        raise ConfigError(
            f"{source}: 'run.containment' requires an 'egress' section with a "
            f"'policy' of {' or '.join(_EGRESS_POLICIES)}. There is no "
            "default: 'none' would silently break a worker that needs a model "
            "API, and anything opener would make 'contained' a word rather "
            "than a boundary"
        )
    if not isinstance(raw, dict):
        raise ConfigError(
            f"{source}: 'run.containment.egress' must be a mapping"
        )
    unknown = sorted(set(raw) - _EGRESS_KEYS)
    if unknown:
        raise ConfigError(
            f"{source}: unknown keys under 'run.containment.egress': "
            f"{', '.join(unknown)}"
        )

    policy = raw.get("policy")
    if policy not in _EGRESS_POLICIES:
        raise ConfigError(
            f"{source}: 'run.containment.egress.policy' must be "
            f"{' or '.join(_EGRESS_POLICIES)} (got {policy!r}). There is no "
            "'all' and no way to spell unrestricted — a worker that wants the "
            "open network declares no containment, and its bundle says "
            "trusted_local out loud"
        )

    hosts = raw.get("hosts", [])
    if not isinstance(hosts, list) or not all(
        isinstance(name, str) and name.strip() for name in hosts
    ):
        raise ConfigError(
            f"{source}: 'run.containment.egress.hosts' must be a list of "
            "hostnames"
        )

    ports_raw = raw.get("ports", list(DEFAULT_EGRESS_PORTS))
    if not isinstance(ports_raw, list) or not ports_raw or not all(
        isinstance(port, int) and not isinstance(port, bool) and 0 < port < 65536
        for port in ports_raw
    ):
        raise ConfigError(
            f"{source}: 'run.containment.egress.ports' must be a non-empty "
            "list of port numbers"
        )

    broker_image = raw.get("broker_image")
    if broker_image is not None and (
        not isinstance(broker_image, str) or not broker_image.strip()
    ):
        raise ConfigError(
            f"{source}: 'run.containment.egress.broker_image' must be an "
            "image name"
        )

    if policy == EGRESS_NONE:
        # **Refusal 11.** These keys are KNOWN, so the closed key set above
        # lets them through — and a declaration reading "these hosts are
        # reachable" beside `--network none` is exactly the silent
        # meaning-change closed key sets exist to prevent. Named rather than
        # ignored, because ignoring it is how a reader comes to believe a
        # policy the mechanism never had.
        stated = sorted(set(raw) - {"policy"})
        if stated:
            raise ConfigError(
                f"{source}: 'run.containment.egress.policy: none' cannot "
                f"carry {', '.join(stated)} — 'none' is '--network none' and "
                "reaches nothing, so a declaration naming hosts beside it "
                "reads as a permission that does not exist"
            )
        return Egress(policy=EGRESS_NONE)

    # **Refusal 5.** An allowlist is enforced by a netns holder, and the
    # holder is a container started from an image that carries `iptables`.
    # Wringer names no image it was not given, here as everywhere.
    if not hosts:
        raise ConfigError(
            f"{source}: 'run.containment.egress.policy: allowlist' needs at "
            "least one host under 'hosts' — an allowlist of nothing is "
            "'none' spelled at greater length"
        )
    if broker_image is None:
        raise ConfigError(
            f"{source}: 'run.containment.egress.policy: allowlist' requires "
            "'broker_image'. The allowlist is armed inside a separate "
            "container that owns the network namespace and holds NET_ADMIN — "
            "the worker joins that namespace without it, which is what stops "
            "the worker disarming its own boundary — and that container needs "
            "an image carrying 'iptables'. Wringer has no default image here "
            "for the same reason it has none anywhere"
        )
    return Egress(
        policy=EGRESS_ALLOWLIST,
        hosts=tuple(hosts),
        ports=tuple(ports_raw),
        broker_image=broker_image.strip(),
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

    concurrent = raw.get("concurrent", False)
    if not isinstance(concurrent, bool):
        raise ConfigError(f"{where} ('{gate_id}'): 'concurrent' must be a boolean")

    stability = _parse_stability(raw.get("stability"), where, gate_id)
    if (
        stability is not None
        and not stability.require_consistent
        and proves is not None
    ):
        # A tolerated flaky gate reads `passed` while its own record says the
        # result was a coin flip, and `proves:` would turn that coin flip into
        # acceptance evidence for a criterion. Worse, it would satisfy the
        # hard half of `evidenced` for free: SPEC_ACCEPT_V0 §3 wants a gate
        # that has demonstrably FAILED, and a nondeterministic gate
        # manufactures that receipt without telling satisfied from
        # unsatisfied. Refused where the two keys meet, so no acceptance code
        # has to defend against it.
        raise ConfigError(
            f"{where} ('{gate_id}'): a gate that carries 'proves: {proves}' may "
            "not also set 'require_consistent: false'. Tolerating a mixture "
            "would let nondeterminism manufacture the failure that "
            "'evidenced' rests on — fix the gate, or drop the binding"
        )

    return Gate(
        id=gate_id,
        run=run,
        timeout=timeout,
        optional=optional,
        proves=proves,
        stability=stability,
        concurrent=concurrent,
        artifacts=_parse_artifacts(raw.get("artifacts"), where, gate_id),
    )


def _parse_artifacts(raw: Any, where: str, gate_id: str) -> Artifacts | None:
    """`artifacts:` on a gate — absent, `true`, or a mapping of caps.

    Absent is every gate that shipped and stays the default for ever, because
    nothing redacts a binary and opting in is a repository saying this gate's
    output is shareable.
    """
    if raw is None:
        return None
    if raw is True:
        return Artifacts()
    if raw is False:
        # Explicit off. Recorded as absence, which is what off means here —
        # there is no third state, and a gate with `artifacts: false` must
        # behave exactly like one that never mentioned it.
        return None
    if not isinstance(raw, dict):
        raise ConfigError(
            f"{where} ('{gate_id}'): 'artifacts' must be true, false, or a "
            "mapping of caps"
        )
    unknown = sorted(set(raw) - _ARTIFACTS_KEYS)
    if unknown:
        raise ConfigError(
            f"{where} ('{gate_id}'): unknown keys under 'artifacts': "
            f"{', '.join(unknown)}"
        )
    caps = {}
    for key, default in (
        ("max_bytes", DEFAULT_ARTIFACT_MAX_BYTES),
        ("total_bytes", DEFAULT_ARTIFACT_TOTAL_BYTES),
    ):
        value = raw.get(key, default)
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            raise ConfigError(
                f"{where} ('{gate_id}'): 'artifacts.{key}' must be a positive "
                "integer number of bytes"
            )
        caps[key] = value
    if caps["max_bytes"] > caps["total_bytes"]:
        raise ConfigError(
            f"{where} ('{gate_id}'): 'artifacts.max_bytes' "
            f"({caps['max_bytes']}) exceeds 'artifacts.total_bytes' "
            f"({caps['total_bytes']}), so the per-artifact cap could never "
            "bind. One of the two is not what you meant"
        )
    return Artifacts(**caps)


def _parse_stability(raw: Any, where: str, gate_id: str) -> Stability | None:
    """The `stability:` block, or None when the gate declared none.

    Absence is not `attempts: 1`. It is the whole pre-stability behaviour:
    one attempt, and no stability record anywhere in the bundle.
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ConfigError(f"{where} ('{gate_id}'): 'stability' must be a mapping")
    unknown = sorted(set(raw) - _STABILITY_KEYS)
    if unknown:
        raise ConfigError(
            f"{where} ('{gate_id}'): unknown stability keys: {', '.join(unknown)}"
        )
    if "attempts" not in raw:
        raise ConfigError(
            f"{where} ('{gate_id}'): 'stability' must declare 'attempts' — "
            "there is no default, because a number Wringer picked is a number "
            "nobody agreed to spend"
        )
    attempts = raw["attempts"]
    if not _is_int(attempts) or attempts < 1:
        raise ConfigError(
            f"{where} ('{gate_id}'): 'stability.attempts' must be an integer "
            f"of at least 1 (got {attempts!r})"
        )
    if attempts > MAX_STABILITY_ATTEMPTS:
        raise ConfigError(
            f"{where} ('{gate_id}'): 'stability.attempts' must be at most "
            f"{MAX_STABILITY_ATTEMPTS} (got {attempts}) — attempts multiply "
            "this gate's wall clock, and a gate needing more draws than that "
            "is a gate to fix rather than to measure"
        )
    consistent = raw.get("require_consistent", True)
    if not isinstance(consistent, bool):
        raise ConfigError(
            f"{where} ('{gate_id}'): 'stability.require_consistent' must be "
            "a boolean"
        )
    return Stability(attempts=attempts, require_consistent=consistent)


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)
