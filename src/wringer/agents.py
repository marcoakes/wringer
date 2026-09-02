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
2026-08-24**, by `tests/test_spec_citations.py` rather than by a reader: this
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
    #: Which door this agent comes through. Everything in this table speaks
    #: ACP — that is what the wizard can detect and drive — and the label
    #: says so out loud, because run 3's operator read this list as "the
    #: agents Wringer supports" when it is only the agents THIS door offers.
    #: A shell-route worker is a plain command string under `run.worker` in
    #: `.wringer.yaml`; `docs/vendors.md` holds the measured commands.
    route: str = "acp"
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
    #: A regex for the SHAPE of this vendor's credential, or `""` when
    #: nobody has measured one. `redact.py`'s second tier scrubs every
    #: non-empty shape from every write path whether or not such a value
    #: was declared — run 4B (2026-09-01) measured why: the vendor's own
    #: `401` echoed the key's first eight characters, a run of `*`, and its
    #: last four, and the redactor owned none of those bytes because none
    #: of them was the declared value. Data, like every other field here;
    #: the matching happens in `redact.py`, which imports the shapes from
    #: this table and holds no vendor string of its own (AGENTS.md rule 5).
    #:
    #: Empty is the honest default. A shape nobody has seen is a guess, and
    #: a guessed shape either scrubs ordinary words or misses the echo.
    key_shape: str = ""

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
        # The prefix this vendor's keys carry — the form the suite has
        # planted as this vendor's since 2026-08-22 (`tests/test_acp.py`,
        # `tests/test_no_secret_in_any_bundle.py`) and the one the author's
        # own key had on the auth-probe arm of that day. What this vendor
        # ECHOES on a rejected key has NOT been measured — the org-pinned
        # refusal of 2026-08-27 named no key at all — so the shape covers
        # the key and any echo that keeps its prefix, and claims nothing
        # about an echo that does not.
        key_shape=r"(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_*.\u2026-]{4,}",
    ),
    Agent(
        id="gemini",
        command="gemini",
        package="@google/gemini-cli",
        key_env="GEMINI_API_KEY",
        args=("--experimental-acp",),
        # Deliberately empty: nobody here has run this agent's auth surface,
        # and inventing one is how the last auth sentence in this repository
        # came to be false. `key_shape` is empty for the same reason: nobody
        # here has seen one of this vendor's keys or its echo of one.
    ),
)


@dataclass(frozen=True)
class ShellVendor:
    """One SHELL-worker vendor whose credential surfaces have been measured.

    The sibling of `Agent` for the other worker form. An `Agent` row is an
    ACP binary Wringer holds a session with; this is a vendor whose CLI a
    repo declares as a shell or `exec:` worker — and the only reason a row
    exists is that somebody ran the binary and wrote down what it said.
    `worker_auth.py` is what runs `login_probe`; this module still starts no
    process.

    `login_probe` answers for the STORED login lane only, and that limit is
    measured, not assumed: with the key variable exported and no stored
    login, the probe below still answers "Not logged in" — it cannot see an
    environment key at all. Which credential actually spends is decided by
    the vendor at the turn, where the key DISPLACES the login (run 3, F7 —
    the same precedence the ACP lane measured on 2026-08-27). So a probe
    answer plus the key variable's presence is the WHOLE of what a preflight
    can honestly say, and `worker_auth.read` composes exactly those two
    facts.
    """

    id: str
    #: The binary's basename, matched against a declared worker's first word.
    command: str
    #: The env variable whose presence displaces the stored login at the turn.
    key_env: str
    #: Argv suffix asking the binary about its stored login. Free, offline,
    #: instant — all three measured before the row was written.
    login_probe: tuple[str, ...]
    #: Argv suffix that starts the vendor's own login flow. Printed, never
    #: executed — a login is somebody's account. Read off the CLI's own help.
    login_verb: tuple[str, ...] = ()
    #: The shape of this vendor's credential AND of what the vendor echoes
    #: when it rejects one — `Agent.key_shape`'s twin, read by `redact.py`'s
    #: second tier. Measured or empty, never guessed.
    key_shape: str = ""

    @property
    def login_command(self) -> str:
        """The whole line a person types to log this vendor in."""
        return " ".join((self.command, *self.login_verb))


# One row, because one vendor's login surface has been measured. Codex:
# `codex login status` on codex-cli 0.149.0, macOS, 2026-08-31 — exit 0 with
# "Logged in using ChatGPT" on stdout when a stored login exists, exit 1 with
# "Not logged in" when none does, identical with and without CODEX_API_KEY
# exported (the probe cannot see the key), no network traffic, instant.
# `codex doctor` was measured and DISQUALIFIED as a probe the same day: it
# reports its auth row as satisfied on the mere PRESENCE of an env key —
# presence read as validity, the exact disease — and it opens sockets.
SHELL_VENDORS: tuple[ShellVendor, ...] = (
    ShellVendor(
        id="codex",
        command="codex",
        key_env="CODEX_API_KEY",
        login_probe=("login", "status"),
        login_verb=("login",),
        # **What it echoes on a rejected key, measured twice.** Run 3
        # (2026-08-31, codex-cli 0.149.0) and run 4B (2026-09-01, 45 lines
        # of one worker log): `401 Unauthorized: Incorrect API key provided:
        # sk-proj-` + a run of `*` + the key's LAST FOUR characters + `.`.
        # The first eight characters and the last four are the vendor's
        # own bytes of somebody's key. The shape below matches the key
        # itself (`sk-`, then token characters) and that echo (the same
        # prefix, then any mix of token characters, `*`, `.` and `…`), so
        # a log carrying either is scrubbed whether or not the key was
        # declared. `sk-` followed by fewer than four characters is left
        # alone: that is the word, not the key.
        key_shape=r"(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_*.\u2026-]{4,}",
    ),
)


def key_shapes() -> tuple[str, ...]:
    """Every measured credential shape, in table order, duplicates dropped.

    The ONLY door through which vendor knowledge reaches `redact.py`: it
    compiles what this returns and applies it to every write path. Empty
    rows contribute nothing, so a vendor nobody has measured costs no
    false scrub.
    """
    found: list[str] = []
    for row in (*AGENTS, *SHELL_VENDORS):
        if row.key_shape and row.key_shape not in found:
            found.append(row.key_shape)
    return tuple(found)


def shell_vendor_by_command(basename: str) -> ShellVendor | None:
    """The vendor row for a worker command's first word, or None.

    Exact match on the basename, `by_command`'s rule: guessing a vendor from
    a wrapper script's filename would be this module inventing a vendor
    string rather than holding one.
    """
    for vendor in SHELL_VENDORS:
        if vendor.command == basename:
            return vendor
    return None


#: Where an IT department's coding-agent policy file lives, per platform.
#:
#: **One vendor, because one vendor is what has been measured.** Field report
#: 2026-08-25 was run on a Mac pinned by managed settings to a first-party
#: login, and the paths below are that vendor's documented locations. Other
#: agents on the roster may have equivalents; nobody here has looked, and
#: naming a path nobody has checked would be the same guess that put a
#: deprecated package name on a front page for a week. The check that reads
#: this says out loud that absence proves nothing.
#:
#: Here rather than in `doctor.py` because AGENTS.md rule 5 makes this file
#: the only place a coding-agent vendor string may appear — the derived guard
#: in `tests/test_start.py` caught the first version of this constant sitting
#: in `doctor.py`, and was right to.
#:
#: **A path, never a read.** Nothing in this repository opens one of these
#: files: it is somebody's employer's configuration, and the only fact worth
#: having about it is whether it exists.
MANAGED_SETTINGS_PATHS: tuple[str, ...] = (
    "/Library/Application Support/ClaudeCode/managed-settings.json",
    "/etc/claude-code/managed-settings.json",
    r"C:\ProgramData\ClaudeCode\managed-settings.json",
)


def managed_policy_file(paths: tuple[str, ...] | None = None) -> str | None:
    """The coding-agent policy file on this machine, or None. **A stat.**

    Nothing here opens it — see the constant above. What this answers is
    whether one of the documented paths EXISTS, and the honest reading of a
    None is "not at any path this build knows", never "this machine is
    unmanaged".

    **Two callers now, so one function** — `wring doctor`'s `managed settings`
    line and the signed-out refusal, which needs it to stop offering the key
    route on the class of machine where the key IS the failure. A second copy
    of this loop is how the last three surfaces describing one fact came to
    disagree; the import here rather than a `Path` at module scope keeps this
    module's "imports nothing that can start a process" guarantee intact.

    `paths` exists so a caller can hand in the tuple it is holding —
    `doctor.MANAGED_SETTINGS_PATHS` is the same tuple under a name that tests
    substitute for a directory they control. Defaulting to the constant means
    the answer is the same either way.
    """
    from pathlib import Path

    for path in MANAGED_SETTINGS_PATHS if paths is None else paths:
        if Path(path).is_file():
            return path
    return None


#: Binaries that WERE an ACP adapter and are not the one to install now.
#: The value is the command that replaced it.
#:
#: **One place, so the documents and the config check cannot disagree.** The
#: rename was recorded in `docs/MANUAL_CHECKS.md` sequence F on 2026-08-11 and
#: copied into a front page anyway a week later, and a product manager
#: installed the deprecated adapter on that instruction. The deprecated one
#: answers an unauthenticated turn with an empty *result*, which a client
#: cannot tell from a turn that did nothing — so the failure presents as a
#: hang. The document guard derives its stale string from here rather than
#: keeping its own copy, and `misconfigured_string_worker` reads the same
#: mapping.
#:
#: Not in `AGENTS`, deliberately: this is not an agent Wringer offers, drives
#: or claims to have measured. It is a name a person may already have typed.
SUPERSEDED_COMMANDS: dict[str, str] = {
    "claude-code-acp": "claude-agent-acp",
}


def acp_adapter_command(command: str) -> str | None:
    """The current adapter binary this command names, or None.

    Answers for both the roster and the superseded names, and the answer is
    the command a person should be running. A command Wringer has never heard
    of returns None — this is a lookup in two tables, never a guess from a
    filename.
    """
    known_agent = by_command(command)
    if known_agent is not None:
        return known_agent.command
    return SUPERSEDED_COMMANDS.get(command)


def misconfigured_string_worker(worker: object) -> tuple[str, str] | None:
    """A `worker:` STRING that names an ACP adapter, as (typed, current).

    **Field report 2026-08-25, finding 5.** A project carried
    `run.worker: "claude-code-acp"`. A string worker is a shell command
    (`config._parse_worker`), so the adapter was never spoken to over ACP at
    all, `env_passthrough` could not even be expressed on that shape, and the
    only symptom was a turn that changed nothing — which points nowhere near
    the cause. Nothing said a word.

    Returns None for every other worker, including a correctly-configured ACP
    mapping and an ordinary shell command, because a string worker is a
    supported and common thing to write. The narrow case this names is a
    string whose FIRST WORD is a binary Wringer knows speaks ACP: nobody
    writes that by accident meaning a shell script.
    """
    if not isinstance(worker, str) or not worker.strip():
        return None
    # The first word only. `run.worker: "claude-agent-acp --flag"` is the same
    # mistake with an argument on it; a command that merely mentions the name
    # in an argument is not.
    typed = worker.split()[0]
    current = acp_adapter_command(typed)
    return None if current is None else (typed, current)


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
