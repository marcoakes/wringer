"""Where a gate runs — SPEC_EXEC_V0.md.

**Read the split in this file before adding to it.** There is no container
runtime on the machine this was written on, so nothing here observes a
container. What it does observe is the ARGV Wringer builds, exhaustively —
which is a fact about Wringer and says nothing about what a runtime does with
it. The second half of that claim is `docs/MANUAL_CHECKS.md` sequence G, it is
unrun, and no test in this file may be written as though it were run.

The local backend IS observed end to end, because it is today's behaviour.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wringer import backend, cli, config, evidence, gates


def settings(**extra) -> config.Execution:
    raw = {
        "version": 1,
        "gates": [{"id": "unit", "run": "true"}],
        "execution": {
            "backend": "container",
            "image": "ghcr.io/marcoakes/wringer:main",
            **extra,
        },
    }
    return config.parse(raw).execution


def argv(cwd: Path, workdir: Path, **extra) -> list[str]:
    engine = backend.Container(settings=settings(**extra))
    return engine.argv(config.Gate(id="unit", run="pytest -q"), cwd, workdir)


# --- the local backend, observed ---------------------------------------------


def test_local_spawns_exactly_what_every_run_spawned_before_backends_existed():
    """`shell=True` with the command string. Not a compatibility shim — it is
    the documented contract, because a tool that ran your commands somewhere
    other than where you pointed it would be lying about what it verified."""
    spawn = backend.Local().spawn(
        config.Gate(id="unit", run="pytest -q && ruff check ."),
        Path("/repo"),
        Path("/repo/.wringer/runs/x/gates/001_unit"),
    )

    assert spawn.args == "pytest -q && ruff check ."
    assert spawn.shell is True


def test_local_records_trusted_local_and_never_says_sandboxed():
    """The word is the point of the whole module.

    A reader who is not told where a gate ran assumes the safer answer, and the
    assumption is wrong in the dangerous direction — so the machine-readable
    field says the unflattering thing, and no VALUE it can hold may read as
    isolation. Asserted against the schema's whole enum rather than against
    this one instance: a future third backend inheriting a flattering word is
    the failure this guards, and it would not be written here.
    """
    identity = backend.Local().identity()
    assert identity == {"backend": "local", "execution_mode": "trusted_local"}

    published = json.loads(
        (
            Path(__file__).resolve().parent.parent
            / "schema"
            / "execution.schema.json"
        ).read_text(encoding="utf-8")
    )
    for value in published["properties"]["execution_mode"]["enum"]:
        for forbidden in ("sandbox", "isolat", "secure", "safe", "protect"):
            assert forbidden not in value.lower(), f"{value} reads as {forbidden}"


def test_local_needs_no_preflight_and_cleans_nothing_up(tmp_path: Path):
    assert backend.Local().preflight() is None
    assert backend.Local().cleanup(tmp_path) is None


def test_a_config_with_no_execution_section_is_the_local_backend():
    """Absence is not a default chosen here; it is the contract every run had
    before this module existed."""
    cfg = config.parse({"version": 1, "gates": [{"id": "u", "run": "true"}]})

    assert cfg.execution is None
    assert backend.for_config(cfg.execution).name == backend.LOCAL


# --- the container argv, pinned flag by flag --------------------------------
#
# Every one of SPEC_EXEC_V0 §4's required properties is a flag, and each gets
# its own test naming the property rather than the flag. A test called
# "the argv contains --network none" would survive the flag being moved
# somewhere it does nothing.


def test_the_repository_is_mounted_explicitly_and_nowhere_else(tmp_path: Path):
    built = argv(tmp_path, tmp_path / "logs")

    assert "--volume" in built
    mount = built[built.index("--volume") + 1]
    assert mount == f"{tmp_path.resolve()}:/workspace"
    # exactly one mount: a second would be a path nobody declared
    assert built.count("--volume") == 1
    assert built[built.index("--workdir") + 1] == "/workspace"


def test_the_network_is_off_unless_the_repository_asked_for_it(tmp_path: Path):
    """Off by DEFAULT. An opt-in that had to be typed to be switched on is the
    only kind that means anything."""
    off = argv(tmp_path, tmp_path / "logs")
    assert ["--network", "none"] == off[
        off.index("--network") : off.index("--network") + 2
    ]

    on = argv(tmp_path, tmp_path / "logs", network=True)
    assert "--network" not in on


def test_the_environment_is_an_allowlist_of_names_and_never_values(tmp_path: Path):
    """`--env NAME`, never `--env NAME=VALUE`.

    The runtime reads the value from Wringer's own environment, so the value
    never enters an argv — and an argv is readable by anyone who can run `ps`.
    A credential handed to a gate must not be world-readable, and the two forms
    differ by exactly that.
    """
    built = argv(tmp_path, tmp_path / "logs", env=["CI", "LANG"])

    passed = [built[i + 1] for i, a in enumerate(built) if a == "--env"]
    assert passed == ["CI", "LANG"]
    assert not any("=" in a for a in passed)


def test_nothing_is_inherited_that_was_not_named(tmp_path: Path):
    """The SSH / cloud / forge credential requirement, stated as the property
    that delivers it rather than as a list of variables to filter.

    There is no filter and there is no denylist. An allowlist means host
    credentials are absent by CONSTRUCTION — a variable Wringer has never heard
    of is withheld for the same reason `AWS_SECRET_ACCESS_KEY` is, and a
    denylist would have to be updated every time a vendor invented a variable.
    """
    built = argv(tmp_path, tmp_path / "logs")

    assert "--env" not in built
    for leak in ("--env-file", "--volumes-from", "--privileged", "--pid"):
        assert leak not in built, leak
    # and no mount but the repository's, so ~/.ssh and a docker socket are not
    # reachable through a path Wringer named
    assert [a for a in built if a == "--volume"] == ["--volume"]


def test_the_container_is_named_by_a_cidfile_inside_the_gates_own_logs(
    tmp_path: Path,
):
    """So a timeout can kill what it started, with no naming scheme to collide.

    The log directory is already unique per attempt, which makes the id unique
    by construction — and the file is evidence a reader can follow to the
    container that produced these logs.
    """
    logs = tmp_path / ".wringer" / "runs" / "r" / "gates" / "001_unit"
    built = argv(tmp_path, logs)

    assert built[built.index("--cidfile") + 1] == str(logs / "container.cid")


def test_the_image_entrypoint_is_replaced_by_a_shell(tmp_path: Path):
    """The image's ENTRYPOINT is `wring`; a gate is a shell command, not wring's
    argv. `sh -c` is also the closest match to what `shell=True` gives locally,
    which is what makes one gate command mean the same thing in both
    backends."""
    built = argv(tmp_path, tmp_path / "logs")

    assert built[built.index("--entrypoint") + 1] == "/bin/sh"
    assert built[-3:] == ["ghcr.io/marcoakes/wringer:main", "-c", "pytest -q"]


def test_the_container_is_removed_when_it_exits(tmp_path: Path):
    """Without `--rm`, a verifier running nine gates leaves nine dead
    containers per run."""
    assert "--rm" in argv(tmp_path, tmp_path / "logs")


def test_the_user_is_the_images_own_unless_the_repository_declared_one(
    tmp_path: Path,
):
    """Offered rather than applied: the published image declares uid 1000 and
    its author wrote down why, so overriding that silently would contradict an
    image this repo does not own at run time."""
    assert "--user" not in argv(tmp_path, tmp_path / "logs")

    built = argv(tmp_path, tmp_path / "logs", user="501:20")
    assert built[built.index("--user") + 1] == "501:20"


@pytest.mark.parametrize("runtime", sorted(backend.RUNTIMES))
def test_every_declarable_runtime_gets_the_same_command_line(
    tmp_path: Path, runtime: str
):
    """One argv builder for all three, because docker, podman and nerdctl are
    deliberately-compatible CLIs — three dialects would be three things to
    drift."""
    built = argv(tmp_path, tmp_path / "logs", runtime=runtime)

    assert built[0] == runtime
    assert built[1] == "run"


def test_the_argv_carries_no_shell_and_is_a_list(tmp_path: Path):
    """`shell=False` for the container, or the whole command line would be
    re-parsed by a shell that has never seen these paths."""
    engine = backend.Container(settings=settings())
    spawn = engine.spawn(
        config.Gate(id="unit", run="pytest -q"), tmp_path, tmp_path / "logs"
    )

    assert spawn.shell is False
    assert isinstance(spawn.args, list)


def test_a_repository_path_containing_a_colon_is_refused(tmp_path: Path):
    """`-v` splits on ':', so this path would mount something nobody named —
    silently. Legal on macOS and Linux, so it is checked rather than assumed
    away."""
    weird = tmp_path / "weird:name"
    weird.mkdir()

    with pytest.raises(backend.BackendError) as caught:
        argv(weird, weird / "logs")
    assert "mount separator" in str(caught.value)


# --- the config surface -----------------------------------------------------


def test_the_two_runtime_tables_agree():
    """`config` refuses runtimes and `backend` builds command lines for them.
    Two literals, one truth: a runtime the parser accepts and the builder
    cannot spell would crash at the first gate."""
    assert set(config._KNOWN_RUNTIMES) == set(backend.RUNTIMES)
    assert config._USER_PATTERN.pattern == backend.USER_PATTERN.pattern


def test_an_image_is_required_and_never_defaulted():
    """The `judge.endpoint` rule. A moving tag Wringer chose would put "ran in
    a container" in the evidence with nobody having decided which container."""
    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "u", "run": "true"}],
                "execution": {"backend": "container"},
            }
        )
    message = str(caught.value)
    assert "requires 'execution.image'" in message
    assert "never one it guessed" in message


def test_apple_container_is_refused_by_name_with_the_reason():
    """The one a macOS reader reaches for first, so it gets a sentence rather
    than a bare "unknown". Its flags have not been verified against this argv,
    and a silently-ignored `--network none` would record `network: false` over
    a live network."""
    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "u", "run": "true"}],
                "execution": {
                    "backend": "container",
                    "image": "img",
                    "runtime": "container",
                },
            }
        )
    message = str(caught.value)
    assert "network: false' over a live network" in message
    assert "Run the image by hand" in message


def test_local_may_not_carry_a_container_key():
    """The most dangerous thing this section could be allowed to say, and the
    cheapest to refuse: a config that names an image while running gates on
    this machine reads as isolated when it is not."""
    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "u", "run": "true"}],
                "execution": {"backend": "local", "image": "img"},
            }
        )
    assert "reads as isolated when it is not" in str(caught.value)


@pytest.mark.parametrize("value", ["root", "-0", "0:0:0", "", "1000:"])
def test_the_user_must_be_digits_because_it_reaches_argv_positionally(value: str):
    """The `deliver.remote` lesson: a value beginning with '-' is read as an
    option, so a flag would be assemblable at runtime from a config value."""
    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "u", "run": "true"}],
                "execution": {
                    "backend": "container", "image": "img", "user": value
                },
            }
        )
    assert "'execution.user'" in str(caught.value)


def test_an_image_may_not_begin_with_a_dash():
    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "u", "run": "true"}],
                "execution": {"backend": "container", "image": "--privileged"},
            }
        )
    assert "may not begin with '-'" in str(caught.value)


def test_env_must_be_names_not_a_mapping_of_values():
    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "u", "run": "true"}],
                "execution": {
                    "backend": "container", "image": "img",
                    "env": {"TOKEN": "hunter2"},
                },
            }
        )
    assert "NAMES" in str(caught.value)


def test_an_unknown_execution_key_is_an_error():
    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "u", "run": "true"}],
                "execution": {
                    "backend": "container", "image": "img", "privileged": True
                },
            }
        )
    assert "unknown keys under 'execution': privileged" in str(caught.value)


def test_a_worktree_fleet_cannot_be_combined_with_a_container(tmp_path: Path):
    """A worktree's `.git` is a FILE pointing into the main repository, and the
    container mounts one directory — every gate that touches git would fail on
    a broken repository rather than on the code. Refused where the two keys
    meet, so no gate has to fail to discover it."""
    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "u", "run": "true"}],
                "execution": {"backend": "container", "image": "img"},
                "fleet": {"deadline": 60, "worktree": True},
            }
        )
    assert ".git is a file" in str(caught.value)


# --- preflight and the refusal ----------------------------------------------


def test_a_missing_runtime_refuses_before_any_gate_runs(
    repo, write_config, monkeypatch, capsys
):
    """Exit 2, the same class as an invalid `.wringer.yaml` — because that is
    what it is: the file names an environment this machine is not.

    Discovered on gate 1 of 9 it has already cost the run; discovered here it
    costs a sentence. And no bundle is written, because a bundle that proves
    nothing is worse than none.
    """
    write_config(
        repo,
        "version: 1\ngates:\n  - id: unit\n    run: 'true'\n"
        "execution:\n  backend: container\n  image: img\n"
        "  runtime: podman\n",
    )
    monkeypatch.chdir(repo)
    monkeypatch.setattr(backend.shutil, "which", lambda _name: None)

    assert cli.main(["verify"]) == cli.EXIT_CONFIG
    printed = capsys.readouterr()

    assert "needs podman on PATH" in printed.err + printed.out
    assert not (repo / evidence.RUNS_DIRNAME).exists(), (
        "a backend refusal wrote a bundle that proves nothing"
    )


def test_preflight_passes_when_the_runtime_is_there(monkeypatch):
    monkeypatch.setattr(backend.shutil, "which", lambda name: f"/usr/bin/{name}")
    assert backend.Container(settings=settings()).preflight() is None


# --- cleanup ----------------------------------------------------------------


def test_cleanup_kills_the_container_the_cidfile_names(tmp_path: Path, monkeypatch):
    """`gates.py` kills the process GROUP, which reaches the runtime client and
    not the container it asked for. Without this a "killed" gate carries on
    working against the mounted tree, which is the timeout not being enforced
    at all."""
    (tmp_path / "container.cid").write_text("abc123\n", encoding="utf-8")
    seen: list[list[str]] = []
    monkeypatch.setattr(
        backend.subprocess, "run", lambda args, **kw: seen.append(args)
    )

    backend.Container(settings=settings()).cleanup(tmp_path)

    assert seen == [["docker", "rm", "--force", "abc123"]]


def test_cleanup_is_silent_when_there_is_nothing_to_kill(tmp_path: Path):
    """Total by construction. This runs on the way out of an already-failed
    gate, and an exception would replace the gate's real verdict with a cleanup
    error."""
    engine = backend.Container(settings=settings())
    assert engine.cleanup(tmp_path) is None  # no cidfile at all

    (tmp_path / "container.cid").write_text("", encoding="utf-8")
    assert engine.cleanup(tmp_path) is None  # empty cidfile


def test_cleanup_survives_a_runtime_that_explodes(tmp_path: Path, monkeypatch):
    (tmp_path / "container.cid").write_text("abc123", encoding="utf-8")

    def boom(*_a, **_kw):
        raise OSError("no such binary")

    monkeypatch.setattr(backend.subprocess, "run", boom)
    assert backend.Container(settings=settings()).cleanup(tmp_path) is None


def test_a_timeout_reaches_the_backends_cleanup(tmp_path: Path, monkeypatch):
    """Wired, not merely present. The cleanup call has to happen on the
    timeout path in `gates.run`, and a backend method nothing calls is a
    container nothing kills."""
    calls: list[Path] = []

    class Recording(backend.Local):
        def cleanup(self, workdir: Path) -> None:
            calls.append(workdir)

    logs = tmp_path / "logs"
    logs.mkdir()
    gates.run(
        config.Gate(id="slow", run="sleep 30", timeout=1),
        cwd=tmp_path,
        stdout_path=logs / "stdout.log",
        stderr_path=logs / "stderr.log",
        backend=Recording(),
    )

    assert calls == [logs]


# --- the record -------------------------------------------------------------


def test_every_run_records_where_its_gates_ran(
    repo, write_config, monkeypatch, capsys
):
    """**Unconditional, unlike every other sibling in the bundle.**

    A reader who is not told where a command ran supplies an answer, and the
    answer they supply is the flattering one. So a bundle nobody configured
    says `trusted_local` out loud — which is most bundles.
    """
    write_config(repo, "version: 1\ngates:\n  - id: unit\n    run: 'true'\n")
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()
    run_dir = sorted((repo / evidence.RUNS_DIRNAME).iterdir())[-1]
    recorded = json.loads(
        (run_dir / evidence.EXECUTION_FILENAME).read_text(encoding="utf-8")
    )

    assert recorded["schema_version"] == "wringer.execution.v1"
    assert recorded["backend"] == "local"
    assert recorded["execution_mode"] == "trusted_local"
    assert recorded["gates"] == ["unit"]
    assert recorded["worker_execution"] is None  # no `run:` section declared


def test_the_worker_is_recorded_separately_and_is_never_contained(
    repo, write_config, monkeypatch, capsys
):
    """The gap, stated at full volume in the one artifact a stranger reads.

    The published image ships no coding agent, so an agent worker cannot run
    inside it — a single `execution_mode` covering both would be the one field
    in this file capable of lying, and it would lie in the direction of
    claiming more.
    """
    write_config(
        repo,
        "version: 1\ngates:\n  - id: unit\n    run: 'true'\n"
        'run:\n  worker: "true"\n',
    )
    monkeypatch.chdir(repo)

    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()
    run_dir = sorted((repo / evidence.RUNS_DIRNAME).iterdir())[-1]
    recorded = json.loads(
        (run_dir / evidence.EXECUTION_FILENAME).read_text(encoding="utf-8")
    )

    assert recorded["worker_execution"] == "trusted_local"


def test_the_limits_say_the_container_claim_is_unmeasured():
    """Pinned by CONTENT, not by non-emptiness — the narrowing lesson applied
    to this record's own output. An execution record is exactly the artifact a
    reader inflates into a security claim."""
    joined = " ".join(backend.LIMITS)

    assert "sequence G" in joined
    assert "unrun" in joined
    assert "is not a sandbox" in joined
    assert "read-write by design" in joined
    assert "not contained" in joined


def test_the_summary_says_where_the_gates_ran(
    repo, write_config, monkeypatch, capsys
):
    """On every run, in the document a person actually opens."""
    write_config(repo, "version: 1\ngates:\n  - id: unit\n    run: 'true'\n")
    monkeypatch.chdir(repo)
    cli.main(["verify"])
    capsys.readouterr()

    run_dir = sorted((repo / evidence.RUNS_DIRNAME).iterdir())[-1]
    text = (run_dir / evidence.SUMMARY_FILENAME).read_text(encoding="utf-8")

    assert "## Where these gates ran" in text
    assert "trusted_local" in text
    assert "not a sandbox" in text


def test_the_console_is_silent_about_a_local_run(
    repo, write_config, monkeypatch, capsys
):
    """The bundle outlives the terminal and gets handed to strangers; the
    console would be telling the person who just typed the command in their own
    shell that it ran in their own shell. That is the nag SPEC_VACUITY_V0 §7
    refuses, applied here."""
    write_config(repo, "version: 1\ngates:\n  - id: unit\n    run: 'true'\n")
    monkeypatch.chdir(repo)
    cli.main(["verify"])

    assert "Gates ran in a container" not in capsys.readouterr().out


def test_the_container_identity_records_the_resolved_runtime_path(monkeypatch):
    """Two machines with `runtime: docker` can be running very different
    things, and a bundle that says only "docker" cannot tell them apart."""
    monkeypatch.setattr(backend.shutil, "which", lambda name: f"/opt/{name}")
    identity = backend.Container(
        settings=settings(network=True, env=["CI"], user="501:20")
    ).identity()

    assert identity == {
        "backend": "container",
        "execution_mode": "container",
        "runtime": "docker",
        "runtime_path": "/opt/docker",
        "image": "ghcr.io/marcoakes/wringer:main",
        "mount": "/workspace",
        "network": True,
        "env_allowlist": ["CI"],
        "user": "501:20",
    }


# --- the prove-pass collision -----------------------------------------------


def test_proving_under_a_container_is_inconclusive_and_never_proven(
    repo, write_config, monkeypatch, capsys, git_run
):
    """`inconclusive` is exactly the published verdict for "the measurement
    could not be made honestly".

    The pre-change tree is a git WORKTREE, whose `.git` is a file pointing into
    the main repository. Mounted alone it is a broken repository, so every
    pre-change gate fails on that rather than on the change — and
    SPEC_VACUITY_V0 §1's comparison table reads a pre-change failure as PROOF.
    A false `proven` on every run is worse than no measurement.
    """
    from wringer import vacuity

    (repo / "calc.py").write_text("FIXED\n", encoding="utf-8")
    write_config(
        repo,
        "version: 1\ngates:\n  - id: test\n    run: \"grep -q FIXED calc.py\"\n"
        "execution:\n  backend: container\n  image: img\n",
    )
    monkeypatch.chdir(repo)
    monkeypatch.setattr(backend.shutil, "which", lambda name: f"/usr/bin/{name}")
    # The gate never actually runs a container: the prove pass is refused
    # before any of that, which is the point — the refusal is a config-shaped
    # fact and needs no runtime to reach.
    monkeypatch.setattr(
        gates, "run", lambda gate, **kw: _passed(gate, kw["stdout_path"])
    )

    assert cli.main(["verify", "--prove"]) == cli.EXIT_OK
    printed = capsys.readouterr()
    run_dir = sorted((repo / evidence.RUNS_DIRNAME).iterdir())[-1]
    recorded = json.loads(
        (run_dir / vacuity.VACUITY_FILENAME).read_text(encoding="utf-8")
    )

    assert recorded["verdict"] == "inconclusive"
    assert ".git is a file" in recorded["reason"]
    assert "Nothing was proven either way" in recorded["reason"]
    # and it is not silently dropped — the console says so
    assert "inconclusive" in printed.out or "proven either way" in printed.out


def _passed(gate: config.Gate, stdout_path: Path) -> gates.GateResult:
    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    stdout_path.write_bytes(b"")
    stderr = stdout_path.parent / "stderr.log"
    stderr.write_bytes(b"")
    return gates.GateResult(
        gate=gate,
        exit_code=0,
        duration_ms=1,
        timed_out=False,
        stdout_path=stdout_path,
        stderr_path=stderr,
    )


def test_a_command_that_cannot_start_reads_as_127_in_both_backends(
    tmp_path: Path,
):
    """**The two backends must fail the same way, and without this they do not.**

    `shell=True` hands a missing command to a shell, which reports 127 and
    raises nothing. `shell=False` with an argv raises FileNotFoundError straight
    out of the verifier — so a runtime that vanished between preflight and this
    gate would abandon a half-written bundle with a traceback instead of a
    verdict. Found by reverting the preflight guard and reading what actually
    happened.

    127 rather than 1, because `health.genuine_failure` singles that number out
    as "nothing ran, so nothing discriminated" — and a gate that never started
    must never read as evidence that the gate CAN fail.
    """
    logs = tmp_path / "logs"
    logs.mkdir()

    class Missing(backend.Local):
        def spawn(self, gate, cwd, workdir):
            return backend.Spawn(
                args=["definitely-not-a-program-on-this-machine"], shell=False
            )

    result = gates.run(
        config.Gate(id="unit", run="whatever"),
        cwd=tmp_path,
        stdout_path=logs / "stdout.log",
        stderr_path=logs / "stderr.log",
        backend=Missing(),
    )

    assert result.exit_code == gates.COMMAND_NOT_FOUND
    assert result.status == "failed"
    assert not result.timed_out
    # and the bundle says WHICH program, because "exit 127" with an empty log is
    # a reader's dead end
    stderr = (logs / "stderr.log").read_text(encoding="utf-8")
    assert "could not be started" in stderr
    assert "definitely-not-a-program-on-this-machine" in stderr


def test_health_and_gates_agree_on_the_number_that_means_nothing_ran():
    """A reader and a writer disagreeing about this would count a run that
    discriminated nothing as one that did."""
    from wringer import health

    assert health.COMMAND_NOT_FOUND == gates.COMMAND_NOT_FOUND == 127
