"""Where the WORKER runs — docs/specs/SPEC_CONTAIN_V0.md, checked against the tree.

Two halves, and the split matters as much here as it does in the module.

The **argv and the parse** are pure functions of config and paths, so every
flag and every static refusal is asserted on a machine with no container
runtime at all. That is deliberate and it is the same property
`test_backend.py` relies on: it is the half of this feature that can be proven
anywhere.

The **canaries** are the other half and they are NOT here. Whether a runtime
delivers the argv is a different claim, measured per platform, per runtime and
per image by `scripts/sequence-i.sh` and recorded in `docs/MANUAL_CHECKS.md`.
Nothing in this file upgrades a word in SECURITY.md, and a test asserting that
a container is isolated would be exactly the defect this repository exists to
catch.
"""

from __future__ import annotations

import ast
import json
import os
import shlex
from pathlib import Path

import pytest

from wringer import backend, cli, config, containment


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def declaration(**overrides) -> dict:
    """The smallest containment a repo can write, plus overrides."""
    body = {
        "runtime": "podman",
        "image": "example/agent:tag",
        "egress": {"policy": "none"},
    }
    body.update(overrides)
    return body


def parse(containment_body: object, **run_extra) -> config.Config:
    run = {"worker": "agent --brief {brief}", **run_extra}
    if containment_body is not None:
        run["containment"] = containment_body
    return config.parse(
        {"version": 1, "gates": [{"id": "unit", "run": "true"}], "run": run}
    )


def settings(**overrides) -> config.Containment:
    parsed = parse(declaration(**overrides))
    assert parsed.run is not None and parsed.run.containment is not None
    return parsed.run.containment


# --- S1: the declaration ----------------------------------------------------


@pytest.mark.parametrize(
    "host",
    [
        "x; iptables -P OUTPUT ACCEPT; :",
        "$(touch /tmp/pwned)",
        "a b",
        "`id`",
        "host|nc 10.0.0.1 1",
    ],
)
def test_an_egress_host_that_is_not_a_hostname_is_REFUSED(host):
    """**The boundary must not be disarmed by the thing that arms it.**

    `egress.hosts` entries are interpolated into an `sh -c` script that runs
    inside the broker — the container started with `--cap-add NET_ADMIN
    --cap-add NET_RAW`. Before this, `hosts: ["api.example.com", "x; iptables
    -P OUTPUT ACCEPT; :"]` parsed and `_arm` built

        for host in api.example.com x; iptables -P OUTPUT ACCEPT; :; do

    so every `iptables` call that followed was swallowed — while
    `declared_record` went on writing `egress.policy: allowlist` and the host
    list into `worker_execution`, a record asserting a policy the mechanism
    did not have. Found independently by two reviewers.

    This parser is careful about every value that reaches an ARGV and had no
    discipline at all about values reaching a shell script it assembles
    itself.
    """
    with pytest.raises(config.ConfigError, match="hostname"):
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "t", "run": "true"}],
                "run": {
                    "worker": "agent",
                    "containment": {
                        "image": "img",
                        "egress": {"policy": "allowlist", "hosts": [host]},
                    },
                },
            }
        )


@pytest.mark.parametrize(
    "name", ["git; rm -rf /", "$(id)", "a b", "-rf"]
)
def test_a_required_binary_that_is_not_a_name_is_REFUSED(name):
    """`run.containment.requires` reaches `command -v {name}` in the same kind
    of assembled script, and that path is reachable from plain `wring verify`
    rather than only from `wring run`."""
    with pytest.raises(config.ConfigError, match="NAMES"):
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "t", "run": "true"}],
                "run": {
                    "worker": "agent",
                    "containment": {"image": "img", "requires": [name]},
                },
            }
        )


def test_ordinary_hosts_and_binaries_still_parse():
    """The other half of the boundary: the allowlist must still admit what a
    real repository declares."""
    parsed = config.parse(
        {
            "version": 1,
            "gates": [{"id": "t", "run": "true"}],
            "run": {
                "worker": "agent",
                "containment": {
                    "image": "img",
                    "requires": ["git", "node", "python3.12", "g++"],
                    "egress": {
                        "policy": "allowlist",
                        "broker_image": "alpine:3",
                        "hosts": [
                            "api.anthropic.com", "registry.npmjs.org",
                            "localhost", "a-b.example.co.uk",
                        ],
                    },
                },
            },
        }
    )
    assert parsed.run is not None and parsed.run.containment is not None
    assert parsed.run.containment.egress is not None


def test_the_armed_script_quotes_every_host_it_interpolates():
    """The second layer, asserted on the script actually built.

    A parser is not a good place for a security property to live ALONE: it is
    one edit from being widened, and the value's destination is a shell inside
    the one container that can change the firewall.
    """
    # Built from a Containment constructed DIRECTLY, bypassing the parser:
    # the whole point of a second layer is that it holds on the day the first
    # one is widened, so testing it through the validator would test nothing.
    egress = config.Egress(
        policy="allowlist",
        hosts=("api.example.com", "x; iptables -P OUTPUT ACCEPT; :"),
        ports=(443,),
    )
    settings = config.Containment(
        runtime="docker", image="img", egress=egress
    )
    script = containment._arm_script(settings)

    loop = next(
        line for line in script.splitlines() if line.startswith("for host in")
    )
    # The question is not whether the characters appear — it is whether the
    # shell would read them as commands. Tokenised the way `sh` reads it, the
    # hostile value is ONE word and `iptables` is not a command in this line.
    words = shlex.split(loop.removeprefix("for host in").removesuffix("; do"))
    assert words == [
        "api.example.com", "x; iptables -P OUTPUT ACCEPT; :"
    ], words


def test_a_repo_that_declares_nothing_is_unchanged():
    """Absence is the contract, not a default chosen here. A repository that
    never heard of this section gets exactly today's behaviour."""
    parsed = parse(None)
    assert parsed.run is not None
    assert parsed.run.containment is None
    assert containment.preflight(None, repo_root()) is None


def test_the_execution_section_gained_no_key():
    """**R-1, and the cheapest check that catches its violation.**

    Worker containment must not be expressed through `execution.backend`
    (SPEC_GATEGEN_V0 §6 W9): `vacuity.prove` returns INCONCLUSIVE
    unconditionally for that value, so containment carried there would have
    made every witness in Phase 3's committed re-test `inconclusive` and the
    money would have measured nothing. Asserted BY VALUE, because a test that
    merely counted the keys would survive one being swapped.
    """
    assert config._EXECUTION_KEYS == {
        "backend", "image", "runtime", "network", "env", "user"
    }
    assert "containment" in config._RUN_KEYS


def test_the_vacuity_collision_still_reads_the_execution_section_only():
    """The other half of R-1, read off the source rather than reasoned about.

    `vacuity.prove`'s container guard must key on `cfg.execution` and never on
    `cfg.run`, or declaring containment starts changing vacuity verdicts —
    which is the whole failure W9 named.
    """
    source = (repo_root() / "src" / "wringer" / "vacuity.py").read_text(
        encoding="utf-8"
    )
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Attribute):
            continue
        if node.attr != "containment":
            continue
        pytest.fail(
            "vacuity.py now reads a `containment` attribute. The prove pass "
            "is untouched BY CONSTRUCTION and that is the property W9 bought"
        )
    assert 'cfg.execution.backend == "container"' in source


def test_unknown_keys_are_errors_in_both_sections():
    with pytest.raises(config.ConfigError) as caught:
        parse(declaration(sandbox=True))
    assert "unknown keys under 'run.containment'" in str(caught.value)

    with pytest.raises(config.ConfigError) as caught:
        parse(declaration(egress={"policy": "none", "allow": ["x"]}))
    assert "unknown keys under 'run.containment.egress'" in str(caught.value)


def test_the_image_has_no_default_and_never_will():
    """The `judge.endpoint` rule. Wringer ships no coding agent from any
    vendor, so the image that runs a worker is one a human named."""
    with pytest.raises(config.ConfigError) as caught:
        parse({"runtime": "podman", "egress": {"policy": "none"}})
    message = str(caught.value)
    assert "requires 'image'" in message
    assert "no default" in message


def test_an_image_that_could_be_read_as_a_flag_is_refused():
    with pytest.raises(config.ConfigError) as caught:
        parse(declaration(image="--privileged"))
    assert "read as a flag" in str(caught.value)


def test_there_is_no_default_egress_policy():
    """Both possible defaults are wrong to pick on somebody's behalf: open
    makes `contained` a word rather than a boundary, closed silently breaks
    every worker that needs a model API."""
    with pytest.raises(config.ConfigError) as caught:
        parse({"runtime": "podman", "image": "example/agent:tag"})
    assert "requires an 'egress' section" in str(caught.value)


def test_there_is_no_way_to_spell_unrestricted():
    """A flag tightens and never loosens, and so does this section. A worker
    that wants the open network declares no containment at all."""
    for attempt in ("all", "any", True, "true", "open"):
        with pytest.raises(config.ConfigError) as caught:
            parse(declaration(egress={"policy": attempt}))
        assert "must be none or allowlist" in str(caught.value)


def test_refusal_5_an_allowlist_without_a_broker_image_is_refused():
    with pytest.raises(config.ConfigError) as caught:
        parse(
            declaration(
                egress={"policy": "allowlist", "hosts": ["api.example.com"]}
            )
        )
    message = str(caught.value)
    assert "requires 'broker_image'" in message
    assert "iptables" in message


def test_refusal_5_an_allowlist_of_nothing_is_none_spelled_longer():
    with pytest.raises(config.ConfigError) as caught:
        parse(
            declaration(
                egress={"policy": "allowlist", "broker_image": "example/b:1"}
            )
        )
    assert "at least one host" in str(caught.value)


def test_refusal_11_hosts_under_policy_none_are_refused_by_name():
    """The keys are KNOWN, so the closed key set lets them through — and a
    declaration reading "these hosts are reachable" beside `--network none` is
    exactly the silent meaning-change closed key sets exist to prevent."""
    with pytest.raises(config.ConfigError) as caught:
        parse(
            declaration(
                egress={"policy": "none", "hosts": ["api.example.com"]}
            )
        )
    message = str(caught.value)
    assert "cannot carry hosts" in message
    assert "reads as a permission that does not exist" in message


def test_refusal_10_became_a_capability_and_an_acp_worker_now_parses():
    """**Refusal 10 named its own second branch, and this is it.**

    It refused `run.containment` beside an ACP worker and said *"Phase 3 must
    read this: the re-test's worker is a shell worker, or Phase 3 builds the
    ACP path."* Phase 3 built the ACP path, because the escape hatch does not
    survive contact with what the re-test measures — the corpus tasks are real
    upstream bug fixes and a shell script does not fix them
    (SPEC_CONTAIN_V0 §11, ruled by R-C).

    The combination is now IMPLEMENTED rather than refused. This is not a
    general loosening, and the test below is the half that proves it: every
    other refusal in §3 still fires.
    """
    cfg = config.parse(
        {
            "version": 1,
            "gates": [{"id": "unit", "run": "true"}],
            "run": {
                "worker": {"acp": {"command": "some-agent"}},
                "containment": declaration(),
            },
        }
    )
    assert cfg.run is not None
    assert cfg.run.containment is not None
    assert isinstance(cfg.run.worker, config.AcpWorker)


def test_the_other_refusals_still_fire_beside_an_acp_worker():
    """**The half that keeps §11 from reading as a general loosening.**

    One combination became implementable. Nothing else did, and a reviewer's
    fair question about an amendment that removes a refusal is whether the
    neighbours went with it. Refusals 8, 9 and 11 are checked here **against an
    ACP worker specifically**, because that is the configuration whose refusal
    was lifted and therefore the one where a mistake would hide.
    """
    acp_worker = {"acp": {"command": "some-agent"}}

    # Refusal 8 — a worktree-based fleet.
    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "unit", "run": "true"}],
                "fleet": {"worktree": True},
                "run": {"worker": acp_worker, "containment": declaration()},
            }
        )
    assert "worktree" in str(caught.value)

    # Refusal 11 — allowlist keys that would be inert under `policy: none`.
    inert = declaration()
    inert["egress"] = {"policy": "none", "hosts": ["api.anthropic.com"]}
    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "unit", "run": "true"}],
                "run": {"worker": acp_worker, "containment": inert},
            }
        )
    assert "policy: none" in str(caught.value) or "none" in str(caught.value)

    # And the closed key set still refuses a typo, which is what stops a
    # containment declaration meaning something other than it reads.
    typo = declaration()
    typo["imag"] = "example/image:tag"
    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "unit", "run": "true"}],
                "run": {"worker": acp_worker, "containment": typo},
            }
        )
    assert "imag" in str(caught.value)


def test_refusal_8_a_worktree_fleet_and_containment_are_refused_where_they_meet():
    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "unit", "run": "true"}],
                "run": {
                    "worker": "agent",
                    "containment": declaration(),
                },
                "fleet": {"worktree": True},
            }
        )
    assert "cannot be combined with 'run.containment'" in str(caught.value)


def test_refusal_8_bench_refuses_containment_it_would_otherwise_inherit():
    """`bench._for_contender` carries `run:` into every contender and every
    contender runs in a detached worktree, so a refusal keyed on
    `fleet.worktree` is structurally blind to bench — it never reads that key.
    Asserted on the source, because building a whole bench here would measure
    the fixture rather than the refusal.
    """
    source = (repo_root() / "src" / "wringer" / "bench.py").read_text(
        encoding="utf-8"
    )
    assert "cfg.run.containment is not None" in source
    assert "cannot be used with 'wring bench'" in source


def test_the_env_allowlist_is_names_and_the_user_cannot_be_a_flag():
    parsed = settings(env=["ANTHROPIC_API_KEY"])
    assert parsed.env == ("ANTHROPIC_API_KEY",)

    with pytest.raises(config.ConfigError):
        parse(declaration(env=["NAME=value"], user="--privileged"))
    with pytest.raises(config.ConfigError) as caught:
        parse(declaration(user="--privileged"))
    assert "digits only" in str(caught.value)


def test_ports_default_to_443_and_are_declarable():
    """The key exists because a self-hosted or proxied model endpoint on
    another port would otherwise fail closed with no named reason, which is
    the opposite of what every other refusal here does."""
    allowlist = settings(
        egress={
            "policy": "allowlist",
            "hosts": ["api.example.com"],
            "broker_image": "example/broker:1",
        }
    )
    assert allowlist.egress.ports == (443,)

    custom = settings(
        egress={
            "policy": "allowlist",
            "hosts": ["api.example.com"],
            "ports": [8443],
            "broker_image": "example/broker:1",
        }
    )
    assert custom.egress.ports == (8443,)


# --- S2: the static refusals ------------------------------------------------


def test_refusal_9_a_repository_path_with_a_colon_is_refused(tmp_path: Path):
    """`-v` splits on ':', so such a path would mount something nobody named,
    silently and in the dangerous direction."""
    weird = tmp_path / "weird:name"
    weird.mkdir()
    refusal = containment.preflight(settings(), weird)
    assert refusal is not None
    assert "mount separator" in refusal


def test_refusal_1_a_missing_runtime_names_the_binary_and_the_way_out(
    tmp_path: Path, monkeypatch
):
    monkeypatch.setattr(containment.shutil, "which", lambda _: None)
    refusal = containment.preflight(settings(), tmp_path)
    assert refusal is not None
    assert "needs podman on PATH" in refusal
    assert "drop the 'run.containment' section" in refusal


def test_refusal_3_a_missing_image_prints_the_pull_and_does_not_fetch(
    tmp_path: Path, monkeypatch
):
    """**Wringer does not pull.** `podman run` would fetch it for us, and that
    is the problem: nothing leaves this machine without a flag you typed, and
    an implicit pull is a fetch nobody typed."""
    monkeypatch.setattr(containment.shutil, "which", lambda _: "/bin/podman")
    monkeypatch.setattr(containment, "_image_exists", lambda *_: False)
    refusal = containment.preflight(settings(), tmp_path)
    assert refusal is not None
    assert "podman pull example/agent:tag" in refusal
    assert "fetch nobody typed" in refusal


def test_refusal_4_an_image_without_the_worker_binary_is_refused(
    tmp_path: Path, monkeypatch
):
    """R-3's named case: Wringer never bundles an agent, so an image that
    cannot run the declared worker is a declaration that cannot be honoured —
    and discovering that on the first turn is discovering it too late."""
    monkeypatch.setattr(containment.shutil, "which", lambda _: "/bin/podman")
    monkeypatch.setattr(containment, "_image_exists", lambda *_: True)
    monkeypatch.setattr(
        containment,
        "_missing_binaries",
        lambda _b, image, required: ["my-agent"] if required else [],
    )
    refusal = containment.preflight(settings(requires=["my-agent"]), tmp_path)
    assert refusal is not None
    assert "does not carry my-agent" in refusal
    assert "ships no coding agent" in refusal


def test_refusal_6_a_broker_image_without_iptables_is_refused(
    tmp_path: Path, monkeypatch
):
    monkeypatch.setattr(containment.shutil, "which", lambda _: "/bin/podman")
    monkeypatch.setattr(containment, "_image_exists", lambda *_: True)
    monkeypatch.setattr(
        containment,
        "_missing_binaries",
        lambda _b, image, required: (
            ["iptables"] if "broker" in image else []
        ),
    )
    refusal = containment.preflight(
        settings(
            egress={
                "policy": "allowlist",
                "hosts": ["api.example.com"],
                "broker_image": "example/broker:1",
            }
        ),
        tmp_path,
    )
    assert refusal is not None
    assert "does not carry iptables" in refusal
    assert "there is no boundary" in refusal


def test_the_static_preflight_starts_no_container_and_resolves_no_name(
    tmp_path: Path, monkeypatch
):
    """**Why the refusals split** (ruling 3). Arming an allowlist means
    starting a holder and issuing a DNS query, and SECURITY.md promises
    `wring verify` makes no outbound connection — so the checks `wring verify`
    performs must be the ones that cost no packet.
    """
    spawned: list[list[str]] = []

    def record(argv, *a, **kw):
        spawned.append(list(argv))
        raise OSError("no runtime here")

    monkeypatch.setattr(containment.shutil, "which", lambda _: "/bin/podman")
    monkeypatch.setattr(containment.subprocess, "run", record)
    containment.preflight(
        settings(
            egress={
                "policy": "allowlist",
                "hosts": ["api.example.com"],
                "broker_image": "example/broker:1",
            }
        ),
        tmp_path,
    )
    for argv in spawned:
        assert "--detach" not in argv, (
            "the static preflight started a long-lived container; only "
            "`establish` may do that, and only where a worker is about to run"
        )
        assert "exec" not in argv[:2], (
            "the static preflight ran something inside a holder, which is "
            "where name resolution happens"
        )
        if argv[1] == "run":
            assert "--network" in argv and "none" in argv, (
                "every probe the static preflight runs is `--network none`, "
                "so the probe itself can reach nothing"
            )


# --- the worker argv, pinned property by property ---------------------------


def build(tmp_path: Path, holder: str | None = None, **overrides) -> list[str]:
    established = containment.Established(
        runtime_path="/bin/podman",
        holder_cid=holder,
        resolved=("10.0.0.1",),
        # The loop's own directory, NOT the per-turn one. The holder is
        # established once for the whole loop and writes its hosts file there;
        # recomputing this path from the iteration directory is the bug the
        # first canary run found, and it is why the path is carried rather
        # than derived.
        hosts_path=(tmp_path / "hosts") if holder else None,
    )
    return containment.argv(
        settings(**overrides),
        established,
        "agent --brief /workspace/.wringer/runs/x/brief.md",
        tmp_path,
        tmp_path / "iter",
    )


def test_the_repository_is_mounted_and_is_the_only_mount_without_an_allowlist(
    tmp_path: Path,
):
    """The repository, and NOTHING else.

    **This went back to one mount on 2026-08-15 and that is the P4-3 repair.**
    For one day there was a second: an anonymous volume shadowing
    `/workspace/.wringer/witness` so a contained agent could not read or edit
    the witness it would otherwise find in its own tree. It worked, and it was
    the wrong shape — it protected the witness from a contained worker while
    arm B's PRIMARY turn, the one that does the work, ran on the host where no
    mount of this container's reaches.

    The bytes now live outside every repository root, so there is nothing here
    to shadow and the mount is gone. A second mount would now be a boundary
    over a path that holds nothing, which reads as protection and is not.
    """
    built = build(tmp_path)
    volumes = [
        built[i + 1] for i, arg in enumerate(built) if arg == "--volume"
    ]
    assert volumes == [f"{tmp_path.resolve()}:/workspace"], (
        "the worker's mounts changed. Without an allowlist the repository is "
        "the only one. A second mount is a second reachable path and needs its "
        "own reason — the witness shadow was one and it is gone, because the "
        "bytes left the repository entirely"
    )
    assert built[built.index("--workdir") + 1] == "/workspace"


def test_without_an_allowlist_the_worker_gets_no_network_at_all(
    tmp_path: Path,
):
    built = build(tmp_path)
    assert built[built.index("--network") + 1] == "none"


def test_with_an_allowlist_the_worker_joins_the_holder_and_gets_no_net_admin(
    tmp_path: Path,
):
    """**The one property that makes this a boundary rather than a request.**

    The worker shares the holder's network namespace, so the rules apply to
    it; it is handed no NET_ADMIN, so it cannot remove them. The boundary is
    not inside the thing being bounded.
    """
    built = build(
        tmp_path,
        holder="deadbeef",
        egress={
            "policy": "allowlist",
            "hosts": ["api.example.com"],
            "broker_image": "example/broker:1",
        },
    )
    assert built[built.index("--network") + 1] == "container:deadbeef"
    assert "--cap-add" not in built, (
        "the worker was handed a capability. NET_ADMIN in the namespace it "
        "shares would let it disarm its own allowlist"
    )
    assert "--privileged" not in built


def test_with_an_allowlist_the_hosts_file_is_mounted_read_only(
    tmp_path: Path,
):
    """`--add-host` is not the mechanism and that is measured, not preferred:
    podman refuses extra host entries on a container joined to another
    container's network namespace. The mounted file is what works."""
    built = build(
        tmp_path,
        holder="deadbeef",
        egress={
            "policy": "allowlist",
            "hosts": ["api.example.com"],
            "broker_image": "example/broker:1",
        },
    )
    mounts = [built[i + 1] for i, a in enumerate(built) if a == "--volume"]
    assert any(m.endswith(":/etc/hosts:ro") for m in mounts), mounts
    assert "--add-host" not in built


def test_the_worker_environment_is_an_allowlist_of_names_and_never_values(
    tmp_path: Path,
):
    """**A distinct test from the gate-side one, deliberately.**
    `test_backend.py`'s version asserts this for the CONTAINER BACKEND's argv
    and would stay green with `--env NAME=VALUE` in the worker's. R-2's row in
    SPEC_CONTAIN §1 says so rather than citing the gate test, because a
    mapping row that cites somebody else's guard is a failed row.
    """
    built = build(tmp_path, env=["ANTHROPIC_API_KEY", "CI"])
    passed = [built[i + 1] for i, a in enumerate(built) if a == "--env"]
    assert passed == ["ANTHROPIC_API_KEY", "CI"]
    assert not any("=" in name for name in passed)


def test_the_worker_command_is_the_last_thing_in_the_argv(tmp_path: Path):
    built = build(tmp_path)
    assert built[-3:] == [
        "example/agent:tag",
        "-c",
        "agent --brief /workspace/.wringer/runs/x/brief.md",
    ]


def test_a_cidfile_is_written_so_a_timeout_can_reach_the_container(
    tmp_path: Path,
):
    """`gates.py` kills the process GROUP, which reaches the runtime client
    and not the container it asked for. Without this the worker would carry on
    against the mounted tree with nothing attached to its streams — the
    timeout not being enforced at all."""
    built = build(tmp_path)
    assert built[built.index("--cidfile") + 1].endswith("worker.cid")


# --- path translation -------------------------------------------------------


def test_a_host_absolute_brief_path_is_translated_into_the_mount(
    tmp_path: Path,
):
    """**Without this every documented worker command fails on its first
    line.** `bundle.write_brief` returns an absolute HOST path and the
    documented worker form is `claude -p "$(cat {brief})"`; inside a container
    with the repo at /workspace that file does not exist, so the worker's
    first act is to read a brief that is not there. That looks like an agent
    failure and is a mount problem — F3 in a new costume.
    """
    brief = tmp_path / ".wringer" / "runs" / "x" / "brief.md"
    command = f'agent -p "$(cat {brief})"'

    translated = containment.translate(command, tmp_path)

    assert str(tmp_path.resolve()) not in translated
    assert "/workspace/.wringer/runs/x/brief.md" in translated


def test_a_path_outside_the_repository_is_left_exactly_as_written(
    tmp_path: Path,
):
    """It is genuinely unreachable, and a worker failing loudly on it beats
    Wringer inventing a location for it."""
    command = "agent --config /etc/agent.toml"
    assert containment.translate(command, tmp_path) == command


def test_no_host_absolute_path_survives_substitution_under_containment(
    tmp_path: Path,
):
    built = containment.argv(
        settings(),
        containment.Established(
            runtime_path="/bin/podman", holder_cid=None, resolved=()
        ),
        containment.translate(
            f'agent -p "$(cat {tmp_path / "brief.md"})"', tmp_path
        ),
        tmp_path,
        tmp_path / "iter",
    )
    command = built[-1]
    assert str(tmp_path.resolve()) not in command
    assert command.count("/workspace") == 1


# --- R-4 and R-4a: the record -----------------------------------------------


def test_a_run_that_declares_no_containment_writes_v1(tmp_path: Path):
    """Zero compatibility cost for every repository in the world, which is all
    of them. The v1 payload is what it was before this feature existed."""
    written = backend.write(
        tmp_path, backend.Local(), ["unit"], worker=True
    )
    record = json.loads(written.read_text(encoding="utf-8"))

    assert record["schema_version"] == "wringer.execution.v1"
    assert record["worker_execution"] == "trusted_local"
    assert record["limits"] == list(backend.LIMITS_V1)


def test_declaring_containment_moves_the_record_to_v2(tmp_path: Path):
    written = backend.write(
        tmp_path, backend.Local(), ["unit"], worker=True,
        containment=settings(env=["ANTHROPIC_API_KEY"]),
    )
    record = json.loads(written.read_text(encoding="utf-8"))

    assert record["schema_version"] == "wringer.execution.v2"
    declared = record["worker_execution"]["declared"]
    assert declared["mode"] == "contained"
    assert declared["image"] == "example/agent:tag"
    assert declared["env_allowlist"] == ["ANTHROPIC_API_KEY"]
    assert declared["egress"] == {"policy": "none"}


def test_the_worker_execution_subtree_never_says_trusted_local(
    tmp_path: Path,
):
    """**Asserted on the field, not on the file**, and the difference is a
    correction the review forced. `execution_mode: trusted_local` is
    legitimately present in a v2 record whenever the gates ran locally — that
    is ruling 7 — so a file-wide substring test could never pass. The field
    to read is `worker_execution`.
    """
    written = backend.write(
        tmp_path, backend.Local(), ["unit"], worker=True,
        containment=settings(),
    )
    record = json.loads(written.read_text(encoding="utf-8"))

    assert record["execution_mode"] == "trusted_local"
    assert "trusted_local" not in json.dumps(record["worker_execution"])


def test_a_lap_that_started_no_holder_writes_no_established_block(
    tmp_path: Path,
):
    """**R-4a.** `wring verify`, `wring start` and a loop's own verify laps all
    write this record without standing anything up. A placeholder here would
    be the record claiming a containment that did not happen, which is the one
    failure this spec is answerable to. Absence is the honest reading."""
    written = backend.write(
        tmp_path, backend.Local(), ["unit"], worker=True,
        containment=settings(), established=None,
    )
    record = json.loads(written.read_text(encoding="utf-8"))

    assert "declared" in record["worker_execution"]
    assert "established" not in record["worker_execution"]


def test_an_established_lap_records_the_addresses_the_allowlist_admitted(
    tmp_path: Path,
):
    """A reader who wants to know what the worker could reach reads this array
    rather than trusting a hostname."""
    written = backend.write(
        tmp_path, backend.Local(), ["unit"], worker=True,
        containment=settings(
            egress={
                "policy": "allowlist",
                "hosts": ["api.example.com"],
                "broker_image": "example/broker:1",
            }
        ),
        established=containment.Established(
            runtime_path="/bin/podman",
            holder_cid="deadbeef",
            resolved=("10.0.0.1", "10.0.0.2"),
        ),
    )
    record = json.loads(written.read_text(encoding="utf-8"))
    established = record["worker_execution"]["established"]

    assert established["runtime_path"] == "/bin/podman"
    assert established["mount"] == "/workspace"
    assert established["egress"]["resolved"] == ["10.0.0.1", "10.0.0.2"]


def test_the_v2_limits_do_not_carry_v1s_denial_of_this_records_own_claim():
    """**The most dangerous thing the independent review found.**

    `LIMITS` is one module-level tuple stamped into every record, and its
    fourth row says *"run.worker is not contained … worker_execution says so
    separately, and it always says trusted_local."* Shipped inside a v2
    record, that is a denial of the claim the record was written to make — a
    green artifact carrying somebody else's caveat, in the one field this
    repository invented so a record could state what it does not claim.
    """
    joined_v1 = " ".join(backend.LIMITS_V1)
    joined_v2 = " ".join(backend.LIMITS_V2)

    assert "not contained" in joined_v1, (
        "v1's row is frozen and must stay — every v1 record is still true"
    )
    assert "run.worker is not contained" not in joined_v2
    assert "it always says trusted_local" not in joined_v2
    assert "does not make a delivery trustworthy" in joined_v2
    assert "ADDRESS allowlist" in joined_v2


def test_the_v2_record_validates_against_its_published_schema(tmp_path: Path):
    jsonschema = pytest.importorskip("jsonschema")

    written = backend.write(
        tmp_path, backend.Local(), ["unit"], worker=True,
        containment=settings(
            user="1000:1000",
            env=["ANTHROPIC_API_KEY"],
            egress={
                "policy": "allowlist",
                "hosts": ["api.example.com"],
                "ports": [443],
                "broker_image": "example/broker:1",
            },
        ),
        established=containment.Established(
            runtime_path="/bin/podman",
            holder_cid="deadbeef",
            resolved=("10.0.0.1",),
        ),
    )
    schema = json.loads(
        (repo_root() / "schema" / "execution-v2.schema.json").read_text(
            encoding="utf-8"
        )
    )
    jsonschema.validate(
        json.loads(written.read_text(encoding="utf-8")), schema
    )


# --- R-2, R-3, R-6: structural guards ---------------------------------------


def containment_tree() -> ast.Module:
    return ast.parse(
        (repo_root() / "src" / "wringer" / "containment.py").read_text(
            encoding="utf-8"
        )
    )


def test_the_broker_grew_no_framework():
    """**R-2, structural, because a prose non-goal cannot catch a framework.**

    Cordis §12.4 is adopted as the ruling adopted it: the minimal mechanism
    Phase 2 needs, and nothing beside it. No effect/inverse framework, no
    plugin machinery, no lifecycle vocabulary, no `requires:`/`provides:`
    coeffect surface.
    """
    forbidden = (
        "effect", "inverse", "plugin", "lifecycle", "coeffect",
        "hot_swap", "registry", "middleware",
    )
    tree = containment_tree()
    names = [
        node.name
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.ClassDef))
    ]
    for name in names:
        for word in forbidden:
            assert word not in name.lower(), (
                f"containment.py exports {name!r}, which reads as framework "
                "machinery. The broker is two capabilities and no vocabulary "
                "for a third"
            )
    assert config._CONTAINMENT_KEYS == {
        "runtime", "image", "requires", "env", "user", "egress"
    }
    assert config._EGRESS_KEYS == {"policy", "hosts", "ports", "broker_image"}


def test_the_broker_takes_a_party_and_hardcodes_none():
    """**R-6.** The 2026-08-14 ruling §5 requires the witness author be
    isolated identically to the worker in Phase 3, so the surface takes a
    party from the start — and the author path is NOT built here. Both halves
    are asserted: hardcoding is a rewrite Phase 3 would pay for, and building
    the author path now is scope creep."""
    tree = containment_tree()
    establish = next(
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "establish"
    )
    assert "party" in [arg.arg for arg in establish.args.args]

    # Over the CODE, not the prose. A grep of the whole file would fail on the
    # docstring that explains why the author path is Phase 3's — a guard that
    # cannot distinguish a mechanism from a sentence about a mechanism is the
    # failure mode one layer up, and this file is full of sentences.
    for node in ast.walk(containment_tree()):
        names: list[str] = []
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            names.append(node.name)
        elif isinstance(node, ast.Name):
            names.append(node.id)
        elif isinstance(node, ast.Attribute):
            names.append(node.attr)
        elif isinstance(node, ast.arg):
            names.append(node.arg)
        for name in names:
            # **`author` still, `witness` no longer.** R-6 forbade both to stop
            # Phase 2 creeping into Phase 3's work. Phase 3 arrived, and the
            # witness needs exactly one thing from this module: the directory
            # its bytes live in, so the worker container can be given an empty
            # one in its place. That is a BOUNDARY, which is this module's
            # whole job, and it is imported as a value so the path it shadows
            # cannot drift from the path `witness.py` writes to.
            #
            # The author path is still Phase 3's and still unbuilt here, so
            # that half of the guard stands unchanged.
            assert "author" not in name.lower(), (
                f"containment.py has an identifier {name!r}. The party "
                "parameter is the whole of the concession; the author path is "
                "not this module's to wire"
            )
        for name in names:
            # **R-6 is WHOLE again**, and it was not for one day. The shadow
            # mount needed `WITNESS_DIRNAME`, so this guard carried an
            # exception for it. P4-3 moved the witness bytes outside every
            # repository root, the mount went with them, and the exception is
            # gone: this module knows nothing about the witness lane again.
            # Containment is a boundary, the witness is a check, and a module
            # that knows both is where the two vocabularies collapse.
            assert "witness" not in name.lower(), (
                f"containment.py has a witness identifier {name!r}. It needs "
                "none: the bytes live outside every repository root, so there "
                "is no path here to shadow and no reason for this module to "
                "know the lane exists"
            )
    assert "witness" not in config._CONTAINMENT_KEYS
    assert "author" not in config._CONTAINMENT_KEYS


def test_establish_never_returns_a_falsy_answer():
    """**R-3's core.** A `None` return is the silent fallback to uncontained
    that ruling 3 forbids, and it would be invisible at the call site."""
    tree = containment_tree()
    establish = next(
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "establish"
    )
    for node in ast.walk(establish):
        if isinstance(node, ast.Return):
            assert node.value is not None, "establish has a bare return"
            assert not (
                isinstance(node.value, ast.Constant) and not node.value.value
            ), "establish returns a falsy constant, which is the fallback"


def test_no_route_reaches_a_worker_turn_with_containment_declared_and_unestablished():
    """**The guard that catches R-3's whole class**, and it enumerates the
    spawn sites from the AST rather than assuming there is one — because the
    first draft of the spec assumed one and there are two.

    `loop._run_worker` goes through `gates.run`; `acp.run_turn` calls
    `subprocess.Popen` itself and touches no backend. The second is why
    refusal 10 exists: it is refused at parse rather than left running
    uncontained under a config that claims containment.
    """
    loop_source = (repo_root() / "src" / "wringer" / "loop.py").read_text(
        encoding="utf-8"
    )
    # The shell path takes the containment and the established handle, and the
    # spawn is the runtime argv rather than the worker command.
    assert "containment_settings=worker_containment" in loop_source
    assert "established=established" in loop_source
    assert "containment.argv(" in loop_source
    # There is no `except` that swallows an establish failure and carries on.
    # Asserted on the CALL rather than on a dump containing the word: the try
    # that wraps the worker turn legitimately mentions both `containment` and
    # `established`, and a guard that cannot tell a call from a keyword
    # argument fires on correct code — which is how a guard gets deleted.
    tree = ast.parse(loop_source)
    establish_calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "establish"
    ]
    assert establish_calls, "loop.py never establishes a containment"
    for guarded in (node for node in ast.walk(tree) if isinstance(node, ast.Try)):
        inside = {
            id(node) for stmt in guarded.body for node in ast.walk(stmt)
        }
        for call in establish_calls:
            assert id(call) not in inside, (
                "loop.py wraps `containment.establish` in a try. There is no "
                "recovery from a containment that could not be stood up — "
                "carrying on is the silent fallback ruling 3 forbids"
            )
    # **And the ACP path is CONTAINED rather than refused** (SPEC_CONTAIN_V0
    # §11). Until 2026-08-15 this guard was satisfied by one path being
    # contained and the other being refused at parse; the refusal is gone, so
    # the second path has to carry the boundary itself or this whole guard
    # would pass while an agent ran uncontained under a config claiming
    # containment — R-3's named defect class, arriving through the door the
    # amendment opened.
    acp_source = (repo_root() / "src" / "wringer" / "acp.py").read_text(
        encoding="utf-8"
    )
    acp_tree = ast.parse(acp_source)

    # Every `subprocess.Popen` in acp.py spawns whatever `spawn` names, and
    # `spawn` is the runtime argv whenever a containment was established.
    # Asserted from the AST so a second Popen added later cannot slip past by
    # not matching a grep.
    popens = [
        node
        for node in ast.walk(acp_tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "Popen"
    ]
    assert popens, "acp.py no longer spawns anything; this guard is stale"
    assert len(popens) == 1, (
        f"acp.py has {len(popens)} `subprocess.Popen` call sites. Each one is "
        "a worker spawn, and this guard proves the boundary for exactly one — "
        "the assumption that there was a single spawn path is what let the "
        "ACP worker run uncontained in the first place"
    )
    for node in ast.walk(popens[0]):
        if isinstance(node, ast.Name) and node.id == "spawn":
            break
    else:  # pragma: no cover - the assertion below reports it
        raise AssertionError(
            "acp.py's Popen no longer spawns `spawn`, which is the name that "
            "holds the runtime argv under a containment. A literal "
            "`[command, *args]` here runs the agent on this machine"
        )
    assert "containment.session_argv(" in acp_source, (
        "acp.py never builds a contained session argv, so a declared "
        "containment would not reach the agent"
    )
    # The session's cwd is translated, and the fs/ boundary knows it is
    # contained — the two sites §11 A-3 and A-4 name.
    assert "containment.WORKSPACE if contained" in acp_source
    assert "containment.inbound(" in (
        repo_root() / "src" / "wringer" / "acp.py"
    ).read_text(encoding="utf-8")

    # And the loop hands the ACP path the same containment it hands the shell
    # path. A boundary built but never passed is the same as no boundary.
    acp_call = next(
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "_run_acp_worker"
    )
    passed = {kw.arg for kw in acp_call.keywords}
    assert {"containment_settings", "established"} <= passed, (
        "loop.py calls `_run_acp_worker` without the containment it "
        f"established; it passes {sorted(passed)}"
    )


def test_both_spawn_shapes_derive_from_one_boundary_builder():
    """**The structural answer to "there are two spawn paths"**
    (SPEC_CONTAIN_V0 §11 A-1).

    The review's fifth HIGH was that a guard assuming one spawn path passes
    while the second runs uncontained. Two containment implementations would
    have the same disease one layer down: a flag added to one and forgotten on
    the other, with nothing to notice. So both tails derive from `_base`, and
    this test fails if a boundary flag reaches one and not the other.
    """
    tree = containment_tree()
    for name in ("argv", "session_argv"):
        function = next(
            node for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == name
        )
        calls = [
            node.func.id
            for node in ast.walk(function)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        ]
        assert "_base" in calls, (
            f"containment.{name} does not build on `_base`, so the boundary is "
            "built twice and the two copies will drift"
        )

    # And the boundary flags really are all in the base rather than duplicated
    # into a tail, which is the way this would rot without anyone noticing.
    declared = settings()
    established = containment.Established(
        runtime_path="/bin/podman", holder_cid=None, resolved=(),
    )
    root, workdir = Path("/repo"), Path("/work")
    shell = containment.argv(declared, established, "true", root, workdir)
    session = containment.session_argv(
        declared, established, "some-agent", ("--stdio",), root, workdir
    )

    for flag in ("--rm", "--cidfile", "--volume", "--workdir", "--network"):
        assert flag in shell, flag
        assert flag in session, (
            f"the ACP spawn is missing {flag}, which the shell spawn has. "
            "Every boundary flag belongs to `_base` and reaches both"
        )
    assert shell[: shell.index("--entrypoint")] == (
        session[: session.index("--interactive")]
    ), (
        "the two spawn shapes disagree before their tails, so the boundary is "
        "not the same boundary"
    )


def test_the_worker_mode_word_is_named_apart_from_the_gate_one():
    """`backend.CONTAINED` holds the string "container" and is the GATE
    vocabulary. Two constants one letter apart with different meanings is a
    trap for a grep and for a bundle reader, so they are named apart."""
    assert backend.CONTAINED == "container"
    assert containment.WORKER_CONTAINED == "contained"
    assert backend.CONTAINED != containment.WORKER_CONTAINED


def test_the_holder_is_reaped_by_cidfile_and_never_by_process_group():
    """A container has no host process group, and on macOS it lives inside the
    runtime's Linux VM — so `loop.worker_pgids`, which signals host process
    groups, cannot reach one. An orphaned holder with an armed allowlist and
    nobody to remove it is what the wrong mechanism would leave behind."""
    tree = containment_tree()

    # The removal argv, read off the syntax tree.
    argvs = [
        [
            element.value
            for element in node.elts
            if isinstance(element, ast.Constant)
            and isinstance(element.value, str)
        ]
        for node in ast.walk(tree)
        if isinstance(node, (ast.List, ast.Tuple))
    ]
    assert any(
        "rm" in argv and "--force" in argv for argv in argvs
    ), "containment.py builds no `rm --force` argv, so nothing reaps a holder"

    # And no process-group mechanism anywhere in the CODE. The comment that
    # explains why a pgid is the wrong mechanism must not redden this — a
    # guard that cannot tell a mechanism from a sentence about a mechanism is
    # the failure mode one layer up.
    for node in ast.walk(tree):
        name = None
        if isinstance(node, ast.Attribute):
            name = node.attr
        elif isinstance(node, ast.Name):
            name = node.id
        if name is None:
            continue
        assert "killpg" not in name and "getpgid" not in name, (
            f"containment.py calls {name!r}. A container has no host process "
            "group — on macOS it lives inside the runtime's VM — so a signal "
            "reaches nothing and the holder survives with its allowlist armed"
        )
    assert containment.HOLDER_CIDFILE.endswith(".cid")
    assert containment.WORKER_CIDFILE.endswith(".cid")


# --- §11: the contained ACP session -----------------------------------------


def session(**overrides):
    declared = settings(**overrides)
    established = containment.Established(
        runtime_path="/bin/podman", holder_cid=None, resolved=(),
    )
    return containment.session_argv(
        declared, established, "some-agent", ("acp", "--stdio"),
        Path("/repo"), Path("/work"),
    )


def test_the_session_keeps_stdin_attached_and_never_asks_for_a_tty():
    """**Both halves are ruled** (SPEC_CONTAIN_V0 §11 A-2).

    Without `-i` a `run --rm` closes the child's stdin at once and the JSON-RPC
    session dies on its first write — presenting as an agent that hangs during
    `initialize`, which `acp.py` already names as the case somebody SIGKILLs
    the loop over. So the missing flag would read as an agent defect.

    `--tty` is forbidden rather than merely unused: a tty line-buffers, echoes
    what is written to it and rewrites newlines, and ACP frames messages as
    newline-delimited JSON on a raw pipe. That corruption reads as a protocol
    bug in the agent rather than as a flag Wringer chose.
    """
    argv = session()
    assert "--interactive" in argv
    for forbidden in ("--tty", "-t"):
        assert forbidden not in argv, (
            f"the ACP spawn asks for {forbidden}; a tty corrupts JSON-RPC "
            "framing in a way that looks like the agent's fault"
        )
    # And it is a `run` flag, so it must precede the image or the runtime reads
    # it as an argument to the agent.
    assert argv.index("--interactive") < argv.index("example/agent:tag")


def test_the_agent_argv_survives_unsplit():
    """`--entrypoint` names the binary and everything after the image is its
    arguments, so nothing re-splits a quoted argument the way a shell would.
    The shell path needs `shlex.join` for exactly the reason this path does
    not."""
    argv = session()
    assert argv[-3:] == ["example/agent:tag", "acp", "--stdio"]
    assert argv[argv.index("--entrypoint") + 1] == "some-agent"
    assert "/bin/sh" not in argv, (
        "the ACP spawn goes through a shell, which would re-split the agent's "
        "own arguments"
    )


def test_both_declared_allowlists_cross_the_boundary():
    """**The union, ruled** (§11 A-6). An ACP worker has two allowlists: the
    boundary's `run.containment.env` and the agent's own
    `run.worker.acp.env_passthrough`. Each name in either was typed into
    `.wringer.yaml` by a human, which is the whole property an
    allowlist-by-name protects.

    The intersection was the other candidate and it is worse: it makes a
    declared key silently inert — refusal 11's named defect class arriving
    through the back door — and presents as an agent mysteriously receiving no
    credential.
    """
    declared = settings(env=["BOUNDARY_NAME"])
    established = containment.Established(
        runtime_path="/bin/podman", holder_cid=None, resolved=(),
    )
    argv = containment.session_argv(
        declared, established, "some-agent", (), Path("/repo"), Path("/work"),
        ("AGENT_NAME", "BOUNDARY_NAME"),
    )
    passed = [argv[i + 1] for i, a in enumerate(argv) if a == "--env"]
    assert passed == ["BOUNDARY_NAME", "AGENT_NAME"], passed
    # Never `--env NAME=VALUE`: an argv is readable by anyone who can run `ps`.
    for name in passed:
        assert "=" not in name


def test_an_inbound_path_is_translated_before_it_is_resolved():
    """**The ordering is the safety argument** (§11 A-4).

    Translation runs BEFORE `_inside` resolves, so confinement is byte for
    byte what it was: a `..`, a symlink, or a path that was never under
    /workspace still escapes to exactly the refusal it did before. This widens
    nothing; it stops the boundary from lying to the agent about where the
    tree is.
    """
    root = Path("/repo")
    assert containment.inbound("/workspace/src/x.py", root) == "/repo/src/x.py"
    assert containment.inbound("/workspace", root) == "/repo"
    # Not under the mount: left exactly as written, so it is refused by the
    # same resolve that always refused it.
    assert containment.inbound("/etc/passwd", root) == "/etc/passwd"
    assert containment.inbound("relative/x.py", root) == "relative/x.py"
    # A near-miss prefix is NOT the mount and must not be rewritten into the
    # tree — the classic prefix bug, which would hand the agent a path it
    # never named.
    assert containment.inbound("/workspacex/x", root) == "/workspacex/x"


def test_the_boundary_carries_no_witness_shadow_because_the_bytes_left(
    tmp_path: Path,
):
    """**The mount is GONE, and its absence is the repair** (P4-3).

    The story, because a deleted mount that nobody explains reads as a
    regression. On the first corpus task driven through the new lane, the agent
    OPENED Wringer's witness and rewrote it: it replaced `pytest.warns(None)`,
    removed in pytest 8, with a `catch_warnings` block. Helpful, and fatal — the
    pin caught it and VOIDed the run, which is W4 working exactly as designed,
    and a lane that VOIDs every time an agent tidies up measures nothing.

    The first repair was an anonymous volume at `/workspace/.wringer/witness`,
    which gave a contained worker an empty directory there. Measured, and real.
    It was also only half the surface: `benchmark/harness.py`'s arm B runs the
    agent's PRIMARY turn — the one that does the work, holds the shell and has
    the network — and that turn ran on the host, where this container's mounts
    reach nothing.

    So the bytes moved out of every repository root instead. Now they are absent
    from the mount for the same reason they are absent from the tree, for a
    contained worker and an uncontained one alike, and the mount that shadowed
    them would be a boundary over an empty path — dead code that reads as
    protection.
    """
    declared = settings()
    established = containment.Established(
        runtime_path="/bin/podman", holder_cid=None, resolved=(),
    )
    for built in (
        containment.argv(
            declared, established, "true", tmp_path, tmp_path / "work"
        ),
        containment.session_argv(
            declared, established, "agent", (), tmp_path, tmp_path / "work"
        ),
    ):
        volumes = [
            built[i + 1] for i, arg in enumerate(built) if arg == "--volume"
        ]
        assert volumes == [f"{tmp_path.resolve()}:{containment.WORKSPACE}"], (
            "a witness shadow mount is back. The bytes live outside every "
            "repository root now, so this would shadow an empty path — and a "
            "boundary over nothing reads as protection while providing none"
        )

    # And the store really is outside the tree that gets mounted, which is the
    # fact the deletion above rests on. Asserted here rather than trusted,
    # because if this ever became false the missing mount WOULD be a regression.
    from wringer import witness as witness_module

    store = witness_module.store_dir(tmp_path).resolve()
    assert not str(store).startswith(str(tmp_path.resolve()) + os.sep), (
        f"the witness store {store} is inside the repository {tmp_path}, which "
        "is the mount. Removing the shadow mount is only safe while this holds"
    )


# --- A-5: the derived `worker_requires` (§6d item 4, closed by P4-5.4) -------


def test_an_ACP_workers_own_binary_is_added_to_the_required_set(monkeypatch):
    """**A-5, which had no test at all** — deleting the derivation reddened
    nothing, which the independent review found and §6d carried as open.

    `requires:` is how a repository states what its image must hold. For an ACP
    worker Wringer KNOWS the binary — it is `run.worker.acp.command` — so
    refusal 4 no longer depends on the repository writing the same name in two
    places and remembering to keep them in step.

    Asserted on the set `preflight` hands the probe rather than on a refusal
    string, because the claim is about what gets CHECKED. A guard on the message
    would still pass if the derived name were checked and then dropped.
    """
    asked: list[tuple[str, ...]] = []

    def spy(binary, image, required):
        asked.append(required)
        return []

    monkeypatch.setattr(containment, "_missing_binaries", spy)
    monkeypatch.setattr(containment, "_image_exists", lambda binary, image: True)
    monkeypatch.setattr(containment.shutil, "which", lambda name: f"/bin/{name}")

    declared = settings()
    containment.preflight(declared, Path("/repo"), ("the-agent-binary",))

    assert asked, "preflight never probed the image at all"
    assert "the-agent-binary" in asked[0], (
        f"the ACP worker's own command is not in the required set {asked[0]}. "
        "An image without the agent then refuses on the first turn — after a "
        "verify lap, a brief and a spawn — instead of at `wring verify` time"
    )


def test_the_derived_and_declared_requirements_UNION_without_duplicating(
    monkeypatch,
):
    """Both lists reach the probe, in order, and a name in both is asked once.

    The union rather than either alone: `requires:` may name things Wringer
    cannot know (a compiler, a system library), and the agent binary is
    something the repository should not have to repeat.
    """
    asked: list[tuple[str, ...]] = []
    monkeypatch.setattr(
        containment, "_missing_binaries",
        lambda binary, image, required: asked.append(required) or [],
    )
    monkeypatch.setattr(containment, "_image_exists", lambda binary, image: True)
    monkeypatch.setattr(containment.shutil, "which", lambda name: f"/bin/{name}")

    declared = settings(requires=["git", "the-agent-binary"])
    containment.preflight(declared, Path("/repo"), ("the-agent-binary",))

    assert asked[0] == ("git", "the-agent-binary"), asked[0]


def test_a_SHELL_worker_derives_nothing_because_nothing_is_known(monkeypatch):
    """The other direction, and it is why this is `worker_requires` rather than
    a general "add the worker command".

    A shell worker is an arbitrary command line the repository wrote down —
    `sh -c "..."` — and there is no binary in it Wringer can name without
    parsing a shell string, which is the classification SPEC_VACUITY §4b
    refuses in its own domain. So nothing is derived and `requires:` is the
    whole of the check, which is what it always was.
    """
    from wringer import config as config_module

    source = (Path(__file__).resolve().parent.parent
              / "src" / "wringer" / "verify.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    assigns = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.If)
        and "AcpWorker" in ast.dump(node.test)
    ]
    assert assigns, (
        "verify.py no longer guards the derivation on the worker being an ACP "
        "worker. A shell worker's command is a shell string, and naming a "
        "binary out of it means parsing one"
    )
    assert hasattr(config_module, "AcpWorker")


def test_verify_REFUSES_when_the_containment_preflight_does(
    repo, monkeypatch, capsys
):
    """**`preflight` runs on every verify and returned non-None in no test.**

    Its five refusals — no runtime on PATH, the image not present locally,
    the image cannot run the declared ACP agent, the broker without
    `iptables`, a `:` in the repository path — are unit-tested against
    `preflight` directly and never through the command that is supposed to
    STOP on them. Deleting the two lines that turn its answer into a refusal
    left the whole suite green and turned every containment refusal into a
    warning nobody sees.
    """
    (repo / ".wringer.yaml").write_text(
        "version: 1\ngates:\n  - id: t\n    run: \"true\"\n"
        "run:\n"
        "  worker:\n"
        "    acp:\n"
        "      command: some-agent\n"
        "  containment:\n"
        "    runtime: docker\n"
        "    image: example/img:1\n"
        "    egress:\n"
        "      policy: none\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)
    # No runtime on PATH — refusal 1, and the one a reader is likeliest to
    # meet. `which` is what `preflight` asks.
    monkeypatch.setattr(containment.shutil, "which", lambda name: None)

    code = cli.main(["verify"])
    said = capsys.readouterr()

    assert code != cli.EXIT_OK, said.out + said.err
    assert "docker" in (said.out + said.err), said.out + said.err

