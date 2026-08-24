"""**Refuse-completion-without-evidence, running inside a competitor's loop.**

`scripts/wring-verify-stop-hook.py` is a Stop hook: Claude Code and LangChain's
`dcode` both read exit 2 from one as "do not let the agent finish", and hand
the hook's stderr back to the model as the reason. The recipe and its
measurement are `docs/supervise-their-harness.md`.

**This file drives the script, and the properties it holds are the two that
make it a supervisor rather than a log line.**

1. Exit 2 and nothing else. Both harnesses read exactly that code as a block;
   exit 1 is "the hook is broken", which is a diagnostic and does not stop
   anything. A hook that returns 1 where it meant 2 is invisible.
2. It fails CLOSED. Missing binary, missing config, unreadable verdict, a
   verifier that ran out of time — every one blocks, because "I could not
   check" and "it is fine" are different answers and only one of them may end
   a turn. This is the one property a future edit would soften first, because
   softening it makes the hook feel better to use.

The page's stanzas are held to the script by derivation, so a doc that tells
somebody to run a flag the script does not have fails here rather than in
their terminal.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / "scripts" / "wring-verify-stop-hook.py"
RECIPE = ROOT / "docs" / "supervise-their-harness.md"

#: What the harnesses read. Not a preference — `dcode`'s own
#: `ExitCodePolicy.CONTINUE_LOOP` fires on this value and on no other.
BLOCK = 2


def run_hook(*args: str, repo: Path | None = None) -> subprocess.CompletedProcess:
    argv = [sys.executable, str(HOOK), *args]
    if repo is not None:
        argv += ["--repo", str(repo)]
    return subprocess.run(
        argv,
        input=json.dumps({"hook_event_name": "Stop"}),
        capture_output=True,
        text=True,
        timeout=120,
    )


def _fake_wring(tmp_path: Path, stdout: str, code: int = 0) -> Path:
    binary = tmp_path / "wring-fake"
    binary.write_text(
        "#!/bin/sh\n"
        f"cat <<'JSON'\n{stdout}\nJSON\n"
        f"exit {code}\n",
        encoding="utf-8",
    )
    binary.chmod(0o755)
    return binary


def _project(tmp_path: Path) -> Path:
    repo = tmp_path / "project"
    repo.mkdir()
    (repo / ".wringer.yaml").write_text(
        'version: 1\ngates:\n  - id: unit\n    run: "true"\n', encoding="utf-8"
    )
    return repo


def test_A_FAILING_CHECK_BLOCKS_THE_AGENT_AND_NAMES_WHAT_SAID_NO(tmp_path):
    """The wire, and the sentence that rides it. The model reads stderr, so a
    block that does not name the check is a block the agent cannot act on."""
    repo = _project(tmp_path)
    wring = _fake_wring(
        tmp_path,
        '{"status": "failed", "failed_gate": "acceptance-recently-played", '
        '"evidence_dir": ".wringer/runs/x"}',
    )

    done = run_hook("--wring", str(wring), repo=repo)

    assert done.returncode == BLOCK, (
        f"the hook exited {done.returncode}; only 2 blocks, and every other "
        "non-zero code is read as a broken hook that stops nothing"
    )
    assert "acceptance-recently-played" in done.stderr
    assert ".wringer/runs/x" in done.stderr, (
        "the block does not say where the evidence is, so nobody can check it"
    )


def test_A_PASSING_CHECK_SAYS_NOTHING_AND_GETS_OUT_OF_THE_WAY(tmp_path):
    """A supervisor that is noisy when it has nothing to say gets uninstalled."""
    repo = _project(tmp_path)
    wring = _fake_wring(tmp_path, '{"status": "passed", "failed_gate": null}')

    done = run_hook("--wring", str(wring), repo=repo)

    assert done.returncode == 0
    assert done.stderr.strip() == ""


@pytest.mark.parametrize(
    "shape",
    [
        "no-config",
        "no-binary",
        "unreadable-verdict",
        "verifier-crashed",
    ],
)
def test_EVERY_WAY_OF_NOT_KNOWING_BLOCKS(tmp_path, shape):
    """**The property that would be softened first.**

    Each of these is a state where the hook has no green to report, and every
    one of them must block. The tempting edit — "well, it could not run, so
    let the agent through" — turns the whole recipe into a comment: a
    supervisor that stands aside whenever it is inconvenienced supervises
    nothing, and the states below are exactly the ones a repository ends up in
    when somebody is working around it.
    """
    if shape == "no-config":
        repo = tmp_path / "bare"
        repo.mkdir()
        done = run_hook("--wring", "true", repo=repo)
        assert ".wringer.yaml" in done.stderr
    elif shape == "no-binary":
        done = run_hook(
            "--wring", "wring-that-is-not-installed", repo=_project(tmp_path)
        )
        assert "not on PATH" in done.stderr
    elif shape == "unreadable-verdict":
        wring = _fake_wring(tmp_path, "this is not json", code=3)
        done = run_hook("--wring", str(wring), repo=_project(tmp_path))
        assert "no verdict" in done.stderr
    else:
        wring = tmp_path / "wring-crash"
        wring.write_text("#!/bin/sh\nexit 9\n", encoding="utf-8")
        wring.chmod(0o755)
        done = run_hook("--wring", str(wring), repo=_project(tmp_path))

    assert done.returncode == BLOCK, (
        f"{shape}: the hook exited {done.returncode} — an agent finished on a "
        "change nothing checked, which is the one outcome this script exists "
        "to make impossible"
    )
    assert "BLOCKED" in done.stderr


def test_THE_HOOK_RUNS_THE_REPOSITORYS_OWN_CHECKS_AND_NOT_ITS_OWN_IDEA(tmp_path):
    """It shells to `wring verify` and reads the verdict. It never decides for
    itself what "done" means — which is the difference between this and the
    grader the deepagents teardown found (`docs/enforced-vs-instructed.md`)."""
    body = HOOK.read_text(encoding="utf-8")
    assert '"verify", "--json"' in body, (
        "the hook no longer runs the repository's own verifier"
    )
    for inventing in ("pytest", "npm test", "make ", "git diff"):
        assert inventing not in body, (
            f"the hook has started deciding what to run ({inventing!r}) "
            "instead of asking the repository"
        )


def test_THE_RECIPE_PAGE_TELLS_PEOPLE_TO_RUN_THE_SCRIPT_THAT_EXISTS():
    """**Derived: a stanza that names a flag the script does not have is a
    page that wastes somebody's afternoon.**"""
    page = RECIPE.read_text(encoding="utf-8")
    assert HOOK.name in page, "the page does not name the script at all"

    used = set(re.findall(r"(--[a-z-]+)", page))
    accepted = set(re.findall(r'"(--[a-z-]+)"', HOOK.read_text(encoding="utf-8")))
    # Flags belonging to the harnesses, not to this script.
    theirs = {"--trust-project-hooks", "--json", "-n", "-q"}
    unknown = {flag for flag in used if flag.startswith("--")} - accepted - theirs
    assert not unknown, (
        f"the recipe tells people to pass {sorted(unknown)} and "
        f"{HOOK.name} accepts {sorted(accepted)}"
    )


def test_THE_RECIPE_CLAIMS_ONLY_THE_HALF_SOMEBODY_RAN():
    """One harness was measured and one was not, and the page has to keep
    saying which. The Claude Code stanza is the obvious translation of a
    measured recipe and this repository does not print obvious translations as
    measurements."""
    page = RECIPE.read_text(encoding="utf-8")
    claude = page.split("### Claude Code")[1]
    assert "Not measured here" in claude, (
        "the page presents the unmeasured stanza without saying so"
    )
    assert "deepagents-code 0.1.59" in page, (
        "the page does not say which version of the harness was measured"
    )
    assert "cap" in page and "8" in page, (
        "the page does not state the continuation cap, which is the ceiling "
        "on what this recipe can promise"
    )
