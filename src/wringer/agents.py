"""The ACP agents `wring start` knows how to name — and **the only place in
`src/` a coding-agent vendor string appears**.

AGENTS.md rule 5, and `forge.py`'s precedent exactly: that module holds every
forge vendor string so `cli.py` can say "the forge" and never "GitHub". This
module is its sibling, so the wizard can say "the agent" and never a product
name. Swapping which agents Wringer offers is then a table edit rather than a
grep, and `tests/test_start.py` fails if a name escapes.

**Nothing here runs.** The install command is *data the human is shown*, never
an argv — docs/specs/SPEC_START_V0.md §3c-i, confirmed by Marc on 2026-08-06,
against two
documents that said `wring start` would install with consent. Three reasons,
the first decisive: the program already promises the opposite in shipped
strings a user can read — `cli.py`, `loop.py` and `bench.py` all say "Wringer
never installs an agent" in a message an operator sees. (**Corrected
2026-08-23**, by `tests/test_spec_citations.py` rather than by a reader: this
paragraph used to cite `config.py`'s "Wringer never bundles or installs one"
and `acp.py`'s promise, and **neither string is in the tree any more**. The
promise is live at the three sites named; the pointer had rotted, and a
second-hand quote is how a claim outlives its evidence.) Falsifying live error
messages to save one paste is the wrong trade. This module deliberately
imports nothing that can start a process, so the guarantee is structural
rather than a promise not to; a test asserts that.

**On the values below.** `command` is the binary detection looks for on
`PATH`; `package` is what installs it; `key_env` is the variable that agent
expects its credential in. They are pinned, in one table, for the reason rule 5
exists: an agent that changes its invocation makes this a one-line diff. The
`claude-code` entry's binary is the one `docs/specs/SPEC_ACP_V0.md`'s own config example
already names.

`args` is empty for both entries and that is a deliberate refusal, not an
omission. Wringer runs the agent you wrote down, never one it guessed, and a
launch that wrote a flag the agent did not want would produce a `.wringer.yaml`
that parses and does not work — the worst failure shape this wizard has. The
stanza is printed before it is written, so an agent needing a flag is one the
human adds to a file they have already been shown.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass

from wringer import config


@dataclass(frozen=True)
class Agent:
    """One agent Wringer can propose as an ACP worker."""

    id: str
    command: str
    package: str
    key_env: str
    args: tuple[str, ...] = ()
    #: The argv suffix that asks THIS agent whether it is logged in, or `()`
    #: when nobody has verified that it has such a surface. Data, like every
    #: other field here — `worker_auth.py` is what runs it, and this module
    #: still starts no process.
    #:
    #: Empty is the honest default and must stay the default. An agent whose
    #: auth surface has not been measured reports "unknown", which costs a
    #: reader one sentence; a guessed argv run against someone's agent could
    #: do anything, and a guess that happened to exit 0 would report a green
    #: nobody checked.
    auth_probe: tuple[str, ...] = ()

    @property
    def install(self) -> str:
        """The exact command a human runs to get this agent.

        Printed, never executed. Running someone's package manager is a
        larger, less reversible power than anything else in this slice, and
        `SETUP.md` already makes installing a runtime a stop condition for the
        agent doing setup — it would be strange for the tool to take a power
        its own runbook denies.
        """
        return f"npm install -g {self.package}"


# Two entries, both of which speak ACP natively or through a published bridge.
# The list is short on purpose: an agent Wringer names is one it is claiming
# can be detected and driven, and a table padded with unverified entries would
# be a guess wearing a mapping layer.
#
# **This table drifts, and nothing here can catch it.** On 2026-08-11 the first
# person ever to install one of these found the `claude-code` entry naming a
# package npm had deprecated and renamed: the current package installs
# successfully and `located()` then reports "not installed" about an agent that
# is installed. No test could have caught it — asking npm whether a package is
# deprecated is a network call in an offline-by-construction suite — so the
# check is a dated row in `docs/MANUAL_CHECKS.md` (sequence F) rather than a
# guard that would make the suite phone a registry.
AGENTS: tuple[Agent, ...] = (
    Agent(
        # The id is the vendor-neutral handle config speaks and it does NOT
        # move when the vendor renames a package — `agent: claude-code` in a
        # bench contender or a `--agent` flag is unaffected by the line below.
        # That is the whole reason ids and binaries are separate fields.
        id="claude-code",
        command="claude-agent-acp",
        package="@agentclientprotocol/claude-agent-acp",
        key_env="ANTHROPIC_API_KEY",
        # `--cli` forwards every remaining argument to the Claude Code CLI the
        # adapter wraps (`dist/index.js` spawns `claudeCliPath()` with them),
        # and that CLI answers `auth status` as JSON without a network call or
        # a turn. Verified on macOS against 0.70.0 / CLI 2.1.232 on
        # 2026-08-22, in all three states: signed out, `HOME` emptied, and
        # `ANTHROPIC_API_KEY` present.
        auth_probe=("--cli", "auth", "status"),
    ),
    Agent(
        id="gemini",
        command="gemini",
        package="@google/gemini-cli",
        key_env="GEMINI_API_KEY",
        args=("--experimental-acp",),
        # Deliberately empty: nobody here has run this agent's auth surface,
        # and inventing one is how the last auth sentence in this repository
        # came to be false.
    ),
)


def known() -> tuple[str, ...]:
    """Every id `--agent` accepts, in the order they are offered."""
    return tuple(agent.id for agent in AGENTS)


def find(agent_id: str) -> Agent | None:
    return next((agent for agent in AGENTS if agent.id == agent_id), None)


def by_command(command: str) -> Agent | None:
    """The entry that declares this binary, or None.

    `run.worker.acp.command` is a command a human wrote down, not an id, so
    the only honest way to offer an install line for it is to ask whether any
    agent in the table names exactly that binary. Anything else — matching on
    a substring, guessing a package from a filename — would be this module
    inventing a vendor string instead of holding one.
    """
    return next((agent for agent in AGENTS if agent.command == command), None)


def located(agent: Agent) -> str | None:
    """Where this agent's binary is, or None.

    `shutil.which` and nothing cleverer (§3c). Present on `PATH` = offered;
    absent = named, with its install command printed. Wringer does not look in
    a package manager's cache, ask a registry, or run the binary to see if it
    answers — every one of those is a guess or a network call, and this step
    is neither.
    """
    return shutil.which(agent.command)


def survey() -> list[tuple[Agent, str | None]]:
    """Every agent and where it is, for the step that shows the human both."""
    return [(agent, located(agent)) for agent in AGENTS]


def worker(agent: Agent) -> config.AcpWorker:
    """The stanza `wring start` proposes for this agent.

    `command`, `args` and `env_passthrough` — the only three keys that exist
    under `run.worker.acp` (`config.py`'s `_ACP_KEYS`). `env_passthrough`
    carries the NAME of the variable holding the credential and never its
    value; `config.py` refuses a value there, and this is the caller that
    makes that refusal load-bearing rather than decorative.
    """
    return config.AcpWorker(
        command=agent.command,
        args=agent.args,
        env_passthrough=(agent.key_env,),
    )
