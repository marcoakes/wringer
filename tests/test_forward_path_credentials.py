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


#: The whole of what a worker inherits without being told to. Four names,
#: each of which somebody had to argue for: `PATH` to find its own binaries,
#: `HOME` and `USER` to find the person's own configuration and Keychain,
#: `LANG` so its output is not mojibake. `USER` joined on 2026-08-26 — field
#: report finding 1, where its absence made a logged-in agent report logged
#: out on every org-pinned Mac.
BASE_NAMES = {"PATH", "HOME", "LANG", "USER"}


def test_A_WORKER_IS_HANDED_FOUR_NAMES_AND_NOTHING_IT_WAS_NOT_GIVEN(
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

    **The base set grew by one on 2026-08-26 and this is where that is
    measured**, out of a real child rather than out of the function's return
    value. `USER` is identity: it names who is running and opens nothing.
    """
    monkeypatch.setenv("SOME_TEAM_API_KEY", CANARY)
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", CANARY)
    monkeypatch.setenv("USER", "someone")

    injected = set(_child_environment_with(tmp_path, {}))
    got = _child_environment(tmp_path, ())

    forwarded = set(got) - injected
    assert forwarded == BASE_NAMES, (
        f"a worker was handed a base environment that is not the four names "
        f"it is given: {sorted(forwarded ^ BASE_NAMES)}"
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
    "certificate.py": "two read-only git questions — `rev-parse --git-dir` "
    "and `cat-file -e` — asked on Wringer's own behalf while checking a "
    "certificate against a clone, the same shape as attest.py's git reads",
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


def test_NO_SURFACE_STILL_DESCRIBES_THE_OLD_BASE_ENVIRONMENT():
    """**The one-fact-three-documents disease, aimed at this fact.**

    `USER` joined the base set on 2026-08-26 and `worker_env` is where that
    fact is MADE — but three other places had written the old set out in
    prose: `SECURITY.md`'s "what IS bounded" section, `worker_auth.py`'s module
    docstring, and a test's own explanation of why it exists. Each was true
    when written. None was derived, so the fix would have landed on one and
    left the rest making a false promise about what a worker is handed —
    which is precisely the 2026-08-22 shape whose second reader quoted the
    stale face four days later.

    So: anywhere in `src/` or in a reader-facing page that names `PATH`,
    `HOME` and `LANG` close together is describing this environment, and has
    to name every other member of the base set too. Captures are excluded by
    `is_capture` — a dated record is supposed to say what was true on its
    date, and the field report that DIAGNOSED this necessarily describes the
    three-name version.
    """
    import re

    from core_helpers import is_capture, reader_facing_pages, repo_root

    root = repo_root()
    anchors = ("PATH", "HOME", "LANG")
    #: Wide enough to span a wrapped sentence and a small table, narrow enough
    #: that three unrelated mentions on one page do not collide.
    WINDOW = 260

    surfaces = [path for path in sorted(SRC.rglob("*.py"))
                if "__pycache__" not in path.parts]
    surfaces += [
        path for path in reader_facing_pages(captures=False)
        if not is_capture(path.relative_to(root), path)
    ]

    stale = []
    for path in surfaces:
        text = path.read_text(encoding="utf-8")
        for found in re.finditer(r"\bPATH\b", text):
            window = text[found.start(): found.start() + WINDOW]
            if not all(re.search(rf"\b{name}\b", window) for name in anchors):
                continue
            missing = [
                name for name in sorted(BASE_NAMES - set(anchors))
                if not re.search(rf"\b{name}\b", window)
            ]
            if missing:
                stale.append(
                    f"{path.relative_to(root)}: names {anchors} and not "
                    f"{missing} — …{' '.join(window.split())[:160]}…"
                )

    assert not stale, (
        "these surfaces describe the environment a worker is handed and are "
        "missing a name that now crosses:\n"
        + "\n".join(f"  {row}" for row in stale)
        + f"\n\nThe base set is {sorted(BASE_NAMES)}, made in "
        "`acp.worker_env`. A page that lists three of four is telling a "
        "reader something about their credentials that is no longer true."
    )


def test_THE_ONE_MODULE_THAT_BUILDS_AN_ENVIRONMENT_STILL_BUILDS_IT():
    """The classification above is only worth having if `acp.py` really does
    build rather than inherit. Read from the function, and driven by the two
    tests at the top of this file.

    **The window is the function's CODE, and neither half of that is an
    accident.** This used to read the 2000 characters after
    `def worker_env(` — a hand-kept number, which went stale the moment the
    docstring grew and made the guard fail over a comment rather than over
    its subject. And a window that includes the docstring can be satisfied by
    PROSE: a paragraph mentioning `"PATH"` would keep this green over a
    function that had stopped passing it. So the docstring is stripped and
    what is left is the code that runs.
    """
    import ast
    import inspect
    import textwrap

    node = ast.parse(textwrap.dedent(inspect.getsource(acp.worker_env))).body[0]
    body = node.body[1:] if ast.get_docstring(node) is not None else node.body
    window = "\n".join(ast.unparse(statement) for statement in body)
    assert "os.environ.copy()" not in window, (
        "the worker environment is inherited now, not built — the guarantee "
        "at the top of this file has gone"
    )
    missing = [name for name in sorted(BASE_NAMES) if f"'{name}'" not in window]
    assert not missing, (
        f"{missing} are in the base set this file measures out of a real "
        "child, and `worker_env` no longer names them — so the two halves of "
        "this claim have drifted"
    )
    assert "PATH" in acp.worker_env(())
