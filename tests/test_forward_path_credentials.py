"""**Nothing this process holds may travel onward except by declaration.**

Codex's answer to this is a scrub — `NON_INHERITABLE_ENV_VARS`, stripped
before a child starts (`~/Claude/WRINGER_CODEX_DOSSIER_2026-08-22.md` §5.11).
Wringer's is stronger by construction: a worker turn is handed an environment
BUILT rather than inherited, so the question is not which names to remove but
which were declared. That is only a stronger property while something checks
it, and nothing did.

Three forward paths, and each is walked here by RUNNING it:

- **the worker spawn** — the environment a real child actually receives, read
  out of the child rather than out of `worker_env`'s return value, because
  the second measures the function and the first measures the boundary;
- **the judge call** — the outbound request, captured whole: which headers
  carry what, and whether anything from this process's environment reached
  the body or the URL;
- **the containment env** — `--env NAME`, never `NAME=VALUE`, because an argv
  is readable by anyone who can run `ps`.

Plus the derivation that keeps it working: every place in `src/` that starts a
process is classified, so a NEW spawn cannot arrive without somebody saying
what environment it hands on.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from wringer import acp

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"

#: A value no real environment holds, so finding it anywhere downstream is
#: unambiguous rather than a coincidence.
CANARY = "wringer-forward-path-canary-0e78e64"


def _agent_that_dumps_its_environment(tmp_path: Path) -> Path:
    """A 'worker' whose only job is to report what it was handed.

    Not a fake and not a patch: a real executable, spawned the real way, whose
    stdout is the environment the boundary produced. `worker_env` returning
    the right dict and the child RECEIVING it are two claims, and only the
    second one is the property.
    """
    agent = tmp_path / "dump-env"
    agent.write_text(
        f"#!{sys.executable}\n"
        "import json, os, sys\n"
        "sys.stderr.write(json.dumps(dict(os.environ)))\n"
        "sys.stderr.flush()\n",
        encoding="utf-8",
    )
    agent.chmod(0o755)
    return agent


def _child_environment_with(tmp_path: Path, env: dict) -> dict:
    import subprocess

    agent = _agent_that_dumps_its_environment(tmp_path)
    done = subprocess.run(
        [str(agent)], capture_output=True, text=True, env=env, timeout=30
    )
    return json.loads(done.stderr)


def _child_environment(tmp_path: Path, passthrough: tuple[str, ...]) -> dict:
    return _child_environment_with(tmp_path, acp.worker_env(passthrough))


def test_A_WORKER_IS_HANDED_THREE_NAMES_AND_NOTHING_IT_WAS_NOT_GIVEN(
    tmp_path, monkeypatch
):
    """Read out of the child. Every other secret-shaped name this process
    holds stays here.

    **The platform adds names of its own and that is measured, not assumed.**
    On macOS a child receives `__CF_USER_TEXT_ENCODING` whatever it was
    handed, so the first version of this test failed against the OS rather
    than against Wringer. The control run — spawn the same program with an
    EMPTY environment — is what separates "the platform put this here" from
    "Wringer forwarded this", and only the second is a defect.
    """
    monkeypatch.setenv("SOME_TEAM_API_KEY", CANARY)
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", CANARY)

    injected = set(_child_environment_with(tmp_path, {}))
    got = _child_environment(tmp_path, ())

    forwarded = set(got) - injected
    assert forwarded == {"PATH", "HOME", "LANG"}, (
        f"a worker was handed more than the three names it is given: "
        f"{sorted(forwarded - {'PATH', 'HOME', 'LANG'})}"
    )
    assert CANARY not in json.dumps(got), (
        "a credential this process holds reached the worker's environment"
    )


def test_A_DECLARED_PASSTHROUGH_CROSSES_AND_ITS_NEIGHBOURS_DO_NOT(
    tmp_path, monkeypatch
):
    """The declared act, and the exactness of it: naming one variable carries
    that variable and does not carry the one beside it."""
    monkeypatch.setenv("DECLARED_KEY", CANARY)
    monkeypatch.setenv("UNDECLARED_KEY", CANARY)

    got = _child_environment(tmp_path, ("DECLARED_KEY",))

    assert got.get("DECLARED_KEY") == CANARY, "the declared act carried nothing"
    assert "UNDECLARED_KEY" not in got, (
        "declaring one variable carried another one with it"
    )


def test_THE_JUDGE_CALL_CARRIES_THE_KEY_IN_A_HEADER_AND_NOWHERE_ELSE(
    monkeypatch,
):
    """**The whole outbound request, captured and read.**

    A credential in a URL lands in proxy logs and in anything that records a
    request line; a credential in the body lands in whatever the endpoint
    stores. The Authorization header is the one place it is supposed to be,
    and this asserts the other two are clean rather than assuming it.
    """
    import urllib.request

    from wringer import judge

    seen = {}

    class Capturing:
        def open(self, request, timeout=None):
            seen["url"] = request.full_url
            seen["headers"] = dict(request.headers)
            seen["body"] = request.data.decode("utf-8")

            class Reply:
                def __enter__(self_inner):
                    return self_inner

                def __exit__(self_inner, *exc):
                    return False

                def read(self_inner):
                    return b'{"choices": []}'

            return Reply()

    monkeypatch.setattr(urllib.request, "build_opener", lambda *a, **k: Capturing())
    monkeypatch.setenv("SOMETHING_ELSE", CANARY)

    judge.send({"model": "m", "messages": []}, "https://example.invalid/v1", 5, CANARY)

    assert CANARY not in seen["url"], "the credential is in the URL"
    assert CANARY not in seen["body"], "the credential is in the request body"
    carrying = [
        name for name, value in seen["headers"].items() if CANARY in str(value)
    ]
    assert carrying == ["Authorization"], (
        f"the credential travels in {carrying} rather than only the "
        "Authorization header"
    )
    # And nothing ELSE from this process's environment came along.
    allowed = {"Content-type", "Content-Type", "Authorization"}
    assert seen["headers"].keys() <= allowed, (
        f"the request grew headers nobody declared: {sorted(seen['headers'])}"
    )


def test_A_CONTAINED_GATES_ENVIRONMENT_CROSSES_BY_NAME_NEVER_BY_VALUE():
    """`--env NAME` and never `--env NAME=VALUE`. An argv is readable by
    anyone who can run `ps`, so the two forms differ by exactly the secret."""
    from wringer import backend, config

    settings = config.Execution(
        backend="container",
        image="example/image:1",
        runtime="podman",
        network=False,
        env=("DECLARED_KEY",),
        user=None,
    )
    engine = backend.Container(settings)
    gate = config.Gate(id="g", run="true")

    spawn = engine.spawn(gate, Path("/repo"), Path("/repo/.wringer/x"))
    args = list(spawn.args)

    assert "--env" in args, "the declared environment does not cross at all"
    for index, token in enumerate(args):
        if token == "--env":
            assert "=" not in args[index + 1], (
                f"a credential is being passed by VALUE in an argv: "
                f"{args[index + 1]!r}"
            )


# ---------------------------------------------------------------------------
# The derivation: no new spawn without a decision about its environment.
# ---------------------------------------------------------------------------

SPAWN = re.compile(r"subprocess\.(?:Popen|run|call|check_output)\(")

#: Modules that start a process and hand it an environment they BUILT.
BUILDS_ITS_CHILDS_ENVIRONMENT = {"acp.py"}

#: Modules whose children inherit this process's environment, each with the
#: reason that is lawful. Inheriting is not a bug here — it is the documented
#: behaviour of a SHELL worker and of every tool Wringer runs on its own
#: behalf — but it is a decision, and an undecided one is what this guards.
INHERITS_AND_WHY = {
    "acquire.py": "git clone, run by Wringer, needs the operator's git config "
    "and credential helper — the whole point of the verb",
    "attest.py": "git reads, on Wringer's own behalf",
    "backend.py": "the runtime CLIENT; what reaches the CONTAINER is the "
    "`--env NAME` allowlist checked above, not this",
    "cli.py": "Wringer running its own tooling",
    "containment.py": "the runtime client, same as backend.py",
    "deliver.py": "git, run by Wringer to write history the operator asked "
    "for; the forge token travels in a header, never an argv",
    "doctor.py": "reads versions of tools on this machine",
    "fleet.py": "child `wring run` processes — the same program, not a worker",
    "gates.py": "a gate is the repository's own command and a SHELL worker "
    "rides this path; docs/vendors.md says so in print",
    "git.py": "git reads, on Wringer's own behalf",
    "sign.py": "the signing tool, which needs the operator's key material",
    "spec.py": "Wringer's own tooling",
    "witness.py": "the witness runner — Wringer's own manufactured check",
    "worker_auth.py": "asks in `acp.worker_env`, which is the built one",
    "run.py": "wringer-drive driving `wring`, which is this program",
    "judge.py": "wringer-board driving `wring judge`, which is this program",
}


def spawning_modules() -> set[str]:
    found = set()
    for path in sorted(SRC.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        if SPAWN.search(path.read_text(encoding="utf-8")):
            found.add(path.name)
    return found


def test_EVERY_MODULE_THAT_STARTS_A_PROCESS_HAS_SAID_WHAT_IT_HANDS_ON():
    """**The derivation, and the only durable part of this file.**

    Every assertion above is one path. This refuses a fourth to appear without
    anybody deciding what it forwards — which is how a credential ends up
    somewhere nobody meant, every time.
    """
    classified = BUILDS_ITS_CHILDS_ENVIRONMENT | set(INHERITS_AND_WHY)
    found = spawning_modules()

    undecided = found - classified
    assert not undecided, (
        f"these modules start a process and nobody has said what environment "
        f"it gets: {sorted(undecided)}. Either build the child's environment "
        "(the `acp.worker_env` shape) or record here why inheriting is "
        "lawful for it."
    )
    gone = classified - found
    assert not gone, (
        f"these modules are classified here and start nothing any more: "
        f"{sorted(gone)}"
    )


def test_THE_ONE_MODULE_THAT_BUILDS_AN_ENVIRONMENT_STILL_BUILDS_IT():
    """The classification above is only worth having if `acp.py` really does
    build rather than inherit. Read from the function, and driven by the two
    tests at the top of this file."""
    body = (SRC / "wringer" / "acp.py").read_text(encoding="utf-8")
    start = body.index("def worker_env(")
    window = body[start : start + 2000]
    assert "os.environ.copy()" not in window, (
        "the worker environment is inherited now, not built — the guarantee "
        "at the top of this file has gone"
    )
    assert '"PATH"' in window and '"HOME"' in window and '"LANG"' in window
    assert "PATH" in acp.worker_env(())
