#!/usr/bin/env python3
"""Build the corpus: real repositories, pinned, with gates Wringer can run.

**The manifest is the corpus.** `corpus.yaml` is the committed artifact — every
task, its repository, its base commit, the gate that repository already had, and
what upstream added afterwards. This script turns that into trees on one
machine; it decides nothing. `CORPUS.md` §4 requires the task list to be
committed before the first paid run, and `corpus.yaml` is that list.

What this produces is deliberately NOT committed: clones carry absolute paths,
venvs carry a machine's interpreter, and a generated task file names both. The
reviewable artifacts — the manifest, the held-out tests, the upstream statements
— are all in git.

    python3 benchmark/corpus/build.py            # everything
    python3 benchmark/corpus/build.py --only X   # one task
    python3 benchmark/corpus/build.py --check    # verify without rebuilding

## The two venvs, which are not one venv twice

Each repository gets a **gate** venv and a **score** venv with identical
contents. The gate venv is named in `.wringer.yaml`, so an agent can reach it;
the score venv is named only in the held-out command, which no arm ever sees.

That is not fastidiousness. Both arms run agents with a shell in a tree, and a
single shared venv is shared mutable state between the thing being measured and
the thing doing the measuring: an agent that ran `pip install -U pytest`, or
broke a dependency while flailing, would change the result of the scoring run
that judges it. Two venvs means the worst an arm can do is break its own gates,
which is a real outcome the harness already knows how to record.

Both are made read-only after creation, which is a second lock on the same door
rather than the only one.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "corpus.yaml"
# Everything built lands here, outside the repository: a corpus of real clones
# is gigabytes and none of it is reviewable.
WORK = Path(
    os.environ.get("WRINGER_CORPUS_WORK", Path.home() / ".cache" / "wringer-corpus")
)


def run(
    args: list[str], cwd: Path | None = None, check: bool = True
) -> subprocess.CompletedProcess:
    done = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if check and done.returncode != 0:
        raise SystemExit(
            f"FAILED: {' '.join(args)}\n"
            f"  exit {done.returncode}\n  {done.stderr.strip()[:2000]}"
        )
    return done


def unlock(path: Path) -> None:
    """Make a tree writable again, so a rebuild is not a permissions puzzle."""
    if not path.exists():
        return
    for parent, dirs, names in os.walk(path):
        for name in dirs + names:
            target = Path(parent) / name
            try:
                target.chmod(target.stat().st_mode | stat.S_IWUSR)
            except OSError:  # pragma: no cover - a symlink to nowhere
                pass


def lock(path: Path) -> None:
    """Read-only, so an arm's agent cannot quietly change the environment its
    own score is measured in."""
    for parent, dirs, names in os.walk(path):
        for name in dirs + names:
            target = Path(parent) / name
            try:
                mode = target.stat().st_mode
                target.chmod(mode & ~stat.S_IWUSR & ~stat.S_IWGRP & ~stat.S_IWOTH)
            except OSError:  # pragma: no cover
                pass


def mirror_of(url: str, key: str) -> Path:
    """One mirror per repository, cloned once and reused by every task on it.

    Five tasks on `pypa/packaging` should not be five clones of the internet.
    """
    mirrors = WORK / "mirrors"
    mirrors.mkdir(parents=True, exist_ok=True)
    path = mirrors / f"{key}.git"
    if path.is_dir():
        run(["git", "--git-dir", str(path), "fetch", "--quiet", "--all"], check=False)
    else:
        print(f"  mirroring {url}")
        run(["git", "clone", "--quiet", "--mirror", url, str(path)])
    return path


def make_venv(key: str, kind: str, deps: list[str], python: str) -> Path:
    """A venv for one repository and one purpose. Rebuilt only when absent."""
    path = WORK / "venvs" / f"{key}-{kind}"
    marker = path / ".wringer-corpus-deps.json"
    want = sorted(deps)
    if marker.is_file():
        try:
            if json.loads(marker.read_text(encoding="utf-8")) == want:
                return path
        except (OSError, ValueError):
            pass
    unlock(path)
    shutil.rmtree(path, ignore_errors=True)
    print(f"  venv {key}-{kind}: {', '.join(want) or 'pytest only'}")
    run([python, "-m", "venv", str(path)])
    pip = [str(path / "bin" / "python"), "-m", "pip", "install", "--quiet"]
    run(pip + ["--upgrade", "pip"], check=False)
    # **The repository itself is deliberately NOT installed.** The working tree
    # has to win on sys.path, or checking out a different commit changes nothing
    # and every measurement in this corpus is meaningless.
    # A PINNED pytest in `test_deps` wins. click and packaging both set
    # `filterwarnings = ["error"]`, and pytest 9 warns during collection, which
    # those repos turn into a collection failure — so an unpinned pytest added
    # beside a pinned one would silently reinstate the bug it was pinned for.
    run(pip + ([] if any(d.startswith("pytest") for d in want) else ["pytest"]) + want)
    marker.write_text(json.dumps(want), encoding="utf-8")
    return path


def build_task(
    task: dict, python: str, scripted: bool = False, oracle: bool = False
) -> Path:
    """One task: a pinned tree, a config Wringer can read, a reachable origin."""
    task_id = task["id"]
    key = task["repo_key"]
    print(f"[{task_id}]")

    mirror = mirror_of(task["repo_url"], key)
    tree = WORK / "repos" / task_id
    unlock(tree)
    shutil.rmtree(tree, ignore_errors=True)
    tree.parent.mkdir(parents=True, exist_ok=True)
    run(["git", "clone", "--quiet", "--no-checkout", str(mirror), str(tree)])

    base = task["base_sha"]
    # A BRANCH at the base commit, not a detached head: `wring deliver` needs a
    # base branch it can name, and the demo repo learned the same lesson.
    run(["git", "checkout", "--quiet", "-B", "main", base], cwd=tree)

    # A GIT IDENTITY IN THE CLONE'S OWN CONFIG, not just on the commit this
    # script makes. Wringer commits as you and refuses to invent an author, so
    # without this `wring deliver` exits 2 on a precondition and the harness
    # records VOID — which the scripted rehearsal caught on the first real
    # corpus task, before a paid run had spent anything on an arm B that could
    # never have reached a verdict.
    for key_, value in (
        ("user.name", "wringer-corpus"),
        ("user.email", "corpus@example.invalid"),
        ("commit.gpgsign", "false"),
    ):
        run(["git", "config", key_, value], cwd=tree)

    gate_venv = make_venv(key, "gate", task.get("test_deps") or [], python)
    score_venv = make_venv(key, "score", task.get("test_deps") or [], python)
    gate_python = gate_venv / "bin" / "python"

    env_prefix = ""
    if task.get("pythonpath"):
        # A src/ layout: the tree must win on sys.path, and it only does if the
        # command says so.
        env_prefix = f"PYTHONPATH={task['pythonpath']} "
    gate_command = f"{env_prefix}{gate_python} -m {task['gate']}"

    # A SCRIPTED worker rehearses the whole path for nothing: prepare_tree on a
    # real clone, check_isolation against a real history, the repo's own suite
    # as a gate, the held-out copy-forward and the scoring run. Everything
    # except the model. Anything that breaks here would otherwise break after
    # the money was spent.
    # THE ORACLE: a worker that applies upstream's own fix and nothing else.
    #
    # It answers the question the scripted rehearsal cannot — **is this task
    # winnable at all?** A task whose held-out tests cannot be made to pass
    # through this harness would score every arm a refusal, silently, and a
    # corpus full of those would read as Wringer being cautious when it was
    # really the corpus being broken. Running it costs nothing and it is the
    # "revert the fix and watch the test fail" discipline pointed at the corpus
    # itself: red with no worker, green with upstream's diff, and if either half
    # does not hold the task does not go in.
    oracle_command = "git checkout {sha} -- {paths}".format(
        sha=task["fix_sha"], paths=" ".join(task["source_files"])
    )
    worker: Any = (
        oracle_command
        if oracle
        else "false"
        if scripted
        else {
            "acp": {
                "command": "claude-agent-acp",
                "env_passthrough": ["ANTHROPIC_API_KEY"],
            }
        }
    )
    config = {
        "version": 1,
        # The repository's OWN suite, as its maintainers run it. This is the
        # thing CORPUS.md §3 is about: where it does not cover the issue is
        # exactly where Wringer can lose.
        "gates": [{"id": "test", "run": gate_command}],
        "run": {
            "worker": worker,
            "max_iterations": task.get("max_iterations", 3),
            "worker_timeout": task.get("worker_timeout", 900),
        },
        "deliver": {"remote": "origin", "base": "main"},
    }
    (tree / ".wringer.yaml").write_text(
        yaml.safe_dump(config, sort_keys=False), encoding="utf-8"
    )
    gitignore = tree / ".gitignore"
    existing = gitignore.read_text(encoding="utf-8") if gitignore.is_file() else ""
    for line in (".wringer/", "__pycache__/"):
        if line not in existing:
            existing += ("" if existing.endswith("\n") or not existing else "\n") + line + "\n"
    gitignore.write_text(existing, encoding="utf-8")

    # RUN THE GATE ONCE, HERE, FOR TWO REASONS.
    #
    # First it asserts CORPUS.md §1.3 — the repository's own suite must pass at
    # the base commit — rather than trusting a miner's report of it.
    #
    # Second, and this is the one that was found by running it: some suites
    # WRITE FILES into the tree. pyparsing's railroad-diagram tests leave five
    # .html files behind. Those are the suite's output, not anybody's change,
    # but `wring deliver` sees a tree that moved since the run that verified it
    # and refuses — on every pyparsing task, whatever the agent did, which would
    # have scored Wringer a refusal it never earned on the evidence. Whatever
    # the suite leaves behind is added to .gitignore and NAMED here, because a
    # silent .gitignore entry is a way to hide a change.
    print("  running the repo's own suite at base...")
    gate_check = run(["sh", "-c", gate_command], cwd=tree, check=False)
    if gate_check.returncode != 0:
        tail = (gate_check.stdout or gate_check.stderr or "").strip().splitlines()[-6:]
        raise SystemExit(
            f"  the repo's own suite is NOT green at base {base[:9]} — "
            f"CORPUS.md §1.3 excludes this task.\n    "
            + "\n    ".join(tail)
        )
    print("  suite green at base")

    dirt = run(
        ["git", "status", "--porcelain", "--untracked-files=all"], cwd=tree
    ).stdout.splitlines()
    left = sorted(
        line[3:] for line in dirt
        if line.startswith("?? ") and not line[3:].startswith(".wringer")
    )
    if left:
        print(f"  the suite left {len(left)} file(s) behind; ignoring them: "
              f"{', '.join(left[:6])}{' ...' if len(left) > 6 else ''}")
        existing = gitignore.read_text(encoding="utf-8")
        for name in left:
            existing += f"{name}\n"
        gitignore.write_text(existing, encoding="utf-8")
        for name in left:
            (tree / name).unlink(missing_ok=True)

    run(["git", "add", ".wringer.yaml", ".gitignore"], cwd=tree)
    run(
        ["git", "-c", "user.name=wringer-corpus",
         "-c", "user.email=corpus@example.invalid",
         "commit", "--quiet", "-m", "declare the repo's own suite as a gate"],
        cwd=tree,
    )

    # A reachable origin, or `wring deliver` exits 3 on a precondition and the
    # harness records VOID — precision bought by an accident of the machine.
    origin = WORK / "origins" / f"{task_id}.git"
    unlock(origin)
    shutil.rmtree(origin, ignore_errors=True)
    origin.parent.mkdir(parents=True, exist_ok=True)
    run(["git", "init", "--quiet", "--bare", "-b", "main", str(origin)])
    # The clone already has an `origin` — the mirror it came from. That one
    # points at a read-only bare repo full of upstream's history, so `wring
    # deliver` would be aiming at the wrong place; replace it rather than adding
    # a second remote nobody chose.
    run(["git", "remote", "remove", "origin"], cwd=tree, check=False)
    run(["git", "remote", "add", "origin", str(origin)], cwd=tree)
    run(["git", "push", "--quiet", "origin", "main"], cwd=tree)
    run(["git", "remote", "set-head", "origin", "-a"], cwd=tree, check=False)

    held_dir = HERE / "held_out" / task_id
    statement = (HERE / "statements" / f"{task_id}.md").read_text(encoding="utf-8")
    score_python = score_venv / "bin" / "python"
    held_run = task["held_out"]["run"].replace("{python}", str(score_python))
    if task.get("pythonpath"):
        held_run = f"PYTHONPATH={task['pythonpath']} {held_run}"

    written = HERE / "tasks" / f"{task_id}.yaml"
    written.parent.mkdir(parents=True, exist_ok=True)
    written.write_text(
        yaml.safe_dump(
            {
                "id": task_id,
                "repo": str(tree),
                "statement": statement,
                "held_out": {
                    "files": [
                        {"src": str(held_dir / entry["src"]), "dest": entry["dest"]}
                        for entry in task["held_out"]["files"]
                    ],
                    "tests": task["held_out"]["tests"],
                    "run": held_run,
                },
                **(
                    {}
                    if scripted
                    else {
                        "agent": {
                            "command": "claude-agent-acp",
                            "env_passthrough": ["ANTHROPIC_API_KEY"],
                            "keychain": {
                                "service": "anthropic",
                                "account": "wringer",
                                "env": "ANTHROPIC_API_KEY",
                            },
                        }
                    }
                ),
                # The scripted attempt, used when the task names no agent.
                # In an oracle build this is upstream's own fix, so BOTH arms
                # attempt the task the same way a real agent would and the
                # rehearsal exercises the arm that will actually be paid for.
                "worker": oracle_command if oracle else "false",
                "budget": {
                    "wall_clock": task.get("wall_clock", 1800),
                    "max_iterations": task.get("max_iterations", 3),
                },
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    lock(gate_venv)
    lock(score_venv)
    print(f"  built {tree}")
    print(f"  task  {written}")
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", action="append", default=[])
    parser.add_argument(
        "--python", default=sys.executable,
        help="interpreter the corpus venvs are built from",
    )
    parser.add_argument(
        "--scripted", action="store_true",
        help="build with a worker that spends nothing, to rehearse the path",
    )
    parser.add_argument(
        "--oracle", action="store_true",
        help="build with a worker that applies upstream's fix — proves the "
             "task is winnable, and costs nothing",
    )
    args = parser.parse_args(argv)

    if not MANIFEST.is_file():
        print(f"no manifest at {MANIFEST}", file=sys.stderr)
        return 2
    manifest = yaml.safe_load(MANIFEST.read_text(encoding="utf-8")) or {}
    tasks = manifest.get("tasks") or []
    if args.only:
        tasks = [t for t in tasks if t["id"] in args.only]
        if not tasks:
            print(f"no task matching {args.only}", file=sys.stderr)
            return 2

    WORK.mkdir(parents=True, exist_ok=True)
    built = [
        build_task(task, args.python, args.scripted or args.oracle, args.oracle)
        for task in tasks
    ]
    if args.scripted or args.oracle:
        print("\n*** SCRIPTED BUILD — no arm will reach a model, and no row "
              "from it is evidence about any agent ***")
    if args.oracle:
        print("*** ORACLE: the worker applies upstream's own fix. Both arms "
              "MUST score true_confidence, or the task is broken ***")
    print(f"\n{len(built)} task(s) built under {WORK}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
