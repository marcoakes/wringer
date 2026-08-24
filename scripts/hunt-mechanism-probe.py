"""THE HUNT'S THIRD MECHANISM, EXECUTED BEFORE IT WAS SPECIFIED.

Two mechanisms died to measurement in this window — `git apply` of a whole
candidate (one binary file and no tree can be built at all) and "a copy carries
the environment" (an editable install's `.pth` is absolute, so the copy's own
interpreter imports the ORIGINAL source). This script measures the third one,
the mechanism H1–H6 constrain, on a candidate carrying every change kind and in
both environment shapes.

Run it with no arguments. It builds its own fixtures under $TMPDIR, needs `uv`
and `git`, and exits non-zero if any measurement fails.

    python3 scripts/hunt-mechanism-probe.py

The capture it produced is `docs/hunt-mechanism-2026-08-23.md`, third
measurement. Kept in the tree because a receipt nobody can re-run is a claim
rather than a measurement — the same reason `scripts/self-hunt.py` is kept.

What it answers:

  R1  Does `git clone --local` carry the ENVIRONMENT? (It does not, which is
      why H1 restores `run.prove_setup` — without it this mechanism reproduces
      round 2's failure exactly.)
  R2  Does `run.prove_setup` inside the copy CLOSE the bypass, and does the
      control lap spare the environment it just built?
  R3  Which overlay is faithful to the candidate's own git VIEW? Three are
      measured; two fail in opposite directions, and the column that decides
      it is `git ls-files`, because checks take their SCOPE from it.
  R4  Does every unit kind revert alone and restore exactly?
  R5  Does H3's restoration check fire on contamination and ignore gitignored
      noise?
  R6  Does H1's eligibility rule read the environment bypass, both directions?

**Extended 2026-08-23, round 4, for the region that returned NOT SOUND.** R1–R6
measure the mechanism and the round-3 review agreed the mechanism holds. What
it killed was the LIFECYCLE BETWEEN LAPS — the one region nothing here
exercised, which is exactly why it survived to a third round. R7–R9 measure
Fable's four rulings:

  R7  R-H1: after a contaminating check, does a rebuild FROM THE PREPARED
      SNAPSHOT restore the tree AND the environment — so the next unit's
      checks import the COPY? **And the red-watch that makes the question
      worth asking: point the rebuild at the bare clone instead, which is what
      Ruling 11 said, and watch this probe catch it.**
  R8  R-H2: does a closing baseline lap catch a check whose verdict is coupled
      to the laps before it — and, measured rather than assumed, **which
      couplings does it NOT catch?** A canary's ceiling is part of the canary.
  R9  R-H4: a partially staged (`MM`) file cannot be reproduced by the
      overlay. Does the faithfulness precondition fire before any check runs?
"""

from __future__ import annotations

import hashlib
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

RESULTS: list[tuple[str, bool, str]] = []


def sh(cmd, cwd=None, check=False, env=None):
    proc = subprocess.run(
        cmd, cwd=cwd, shell=isinstance(cmd, str), capture_output=True,
        text=True, env=env,
    )
    if check and proc.returncode != 0:
        raise SystemExit(f"FAILED: {cmd}\n{proc.stdout}\n{proc.stderr}")
    return proc


def record(question: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((question, ok, detail))
    mark = "PASS" if ok else "**FAIL**"
    print(f"  {mark}  {question}" + (f"  -- {detail}" if detail else ""))


def digest(path: pathlib.Path) -> str:
    """Mode and content, because a mode-only change is a change."""
    if path.is_symlink():
        return "link:" + hashlib.sha256(os.readlink(path).encode()).hexdigest()[:16]
    mode = "755" if os.access(path, os.X_OK) else "644"
    return mode + ":" + hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def tree_content(root: pathlib.Path) -> dict[str, str]:
    """Every path git considers, gitignored files and `.git` excluded."""
    listing = sh("git ls-files --cached --others --exclude-standard", cwd=root).stdout
    found = {}
    for rel in filter(None, (line.strip() for line in listing.split("\n"))):
        path = root / rel
        if path.exists() or path.is_symlink():
            found[rel] = digest(path)
    return found


def build_candidate(where: pathlib.Path, pythonpath_line: str = "") -> pathlib.Path:
    """A candidate carrying every change kind, and a staged/unstaged mixture.

    HEAD is committed RED — `f()` returns 1 and the committed test asserts 2 —
    so a faithful pre-change tree FAILS and a bypassed one passes. That is what
    makes the eligibility measurement in R6 mean anything.
    """
    if where.exists():
        shutil.rmtree(where)
    (where / "src" / "pkg").mkdir(parents=True)
    (where / "tests").mkdir(parents=True)
    (where / "pyproject.toml").write_text(
        '[build-system]\nrequires = ["setuptools>=68"]\n'
        'build-backend = "setuptools.build_meta"\n\n[project]\nname = "pkg"\n'
        'version = "0.0.1"\n\n[tool.setuptools.packages.find]\nwhere = ["src"]\n\n'
        f"[tool.pytest.ini_options]\n{pythonpath_line}\n"
    )
    (where / ".gitignore").write_text(
        ".venv/\n.wringer/\n__pycache__/\n*.egg-info/\ncoverage.out\n"
    )
    (where / "src" / "pkg" / "__init__.py").write_text("")
    (where / "src" / "pkg" / "core.py").write_text("def f():\n    return 1\n")
    (where / "tests" / "test_f.py").write_text(
        "from pkg.core import f\n\n\ndef test_f():\n    assert f() == 2\n"
    )
    (where / "many.txt").write_text("\n".join(f"line {i}" for i in range(1, 41)) + "\n")
    (where / "gone.txt").write_text("deleted by the candidate\n")
    (where / "renamed_from.txt").write_text("renamed by the candidate\n")
    (where / "mode.sh").write_text("#!/bin/sh\necho hello\n")
    (where / "blob.bin").write_bytes(bytes(range(256)) * 8)
    (where / "staged_edit.txt").write_text("staged edit: before\n")
    sh("git init -q", cwd=where, check=True)
    sh("git add -A", cwd=where, check=True)
    sh("git -c user.email=probe@local -c user.name=probe commit -q -m HEAD",
       cwd=where, check=True)
    sh("uv venv --python 3.12 .venv", cwd=where, check=True)
    sh("uv pip install -q -e . pytest", cwd=where,
       env=dict(os.environ, VIRTUAL_ENV=str(where / ".venv")), check=True)

    # ---- THE CANDIDATE, uncommitted ----
    (where / "src" / "pkg" / "core.py").write_text("def f():\n    return 2\n")
    lines = (where / "many.txt").read_text().split("\n")
    lines[2], lines[35] = "line 3 CHANGED", "line 36 CHANGED"
    (where / "many.txt").write_text("\n".join(lines))
    (where / "gone.txt").unlink()
    sh("git mv renamed_from.txt renamed_to.txt", cwd=where, check=True)
    (where / "staged_edit.txt").write_text("staged edit: after\n")
    sh("git add staged_edit.txt", cwd=where, check=True)
    os.chmod(where / "mode.sh", 0o755)
    (where / "blob.bin").write_bytes(bytes(range(255, -1, -1)) * 8)
    (where / "new_module.py").write_text("VALUE = 1\n")
    (where / "dead_untracked.txt").write_text("nothing reads this\n")
    return where


def manifest(cand: pathlib.Path):
    """The overlay manifest: tracked changes, the STAGED subset, untracked files."""
    rows = [
        tuple(line.split("\t"))
        for line in sh("git diff HEAD --name-status -M", cwd=cand,
                       check=True).stdout.split("\n")
        if line.strip()
    ]
    staged = [
        tuple(line.split("\t"))
        for line in sh("git diff --cached --name-status -M HEAD",
                       cwd=cand).stdout.split("\n")
        if line.strip()
    ]
    untracked = [
        path.strip()
        for path in sh("git ls-files --others --exclude-standard",
                       cwd=cand).stdout.split("\n")
        if path.strip() and not path.startswith(".wringer/")
    ]
    return rows, staged, untracked


def apply_overlay(cand, copy, rows, staged, untracked, replay_index: bool) -> None:
    """Reproduce the candidate in the copy. No `git apply` anywhere — that is
    what killed mechanism A on the first binary file."""
    for row in rows:
        code = row[0]
        if code.startswith("R"):
            (copy / row[1]).unlink(missing_ok=True)
            (copy / row[2]).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(cand / row[2], copy / row[2])
        elif code == "D":
            (copy / row[1]).unlink(missing_ok=True)
        else:
            (copy / row[1]).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(cand / row[1], copy / row[1])
    for path in untracked:
        (copy / path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(cand / path, copy / path)
    if not replay_index:
        return
    # Option C: replay EXACTLY the candidate's staged set, so the copy's
    # `git ls-files` — and therefore every check's SCOPE — matches.
    for row in staged:
        code = row[0]
        if code.startswith("R"):
            sh(f"git rm --cached -q -- {row[1]!r}", cwd=copy)
            sh(f"git add -- {row[2]!r}", cwd=copy)
        elif code == "D":
            sh(f"git rm --cached -q -- {row[1]!r}", cwd=copy)
        else:
            sh(f"git add -- {row[1]!r}", cwd=copy)


def control_lap(copy: pathlib.Path) -> None:
    """H1's whole-change revert, in the copy, using only the copy's own git.

    `git clean -fd` and never `-fdx`: gitignored files are spared, so the
    environment `run.prove_setup` built survives into every unit lap.
    """
    sh("git read-tree --reset -u HEAD", cwd=copy, check=True)
    sh("git clean -fdq", cwd=copy, check=True)


def single_hunk_patch(patch: str, path: str, at: str) -> str:
    """One file header plus exactly one `@@` block — valid in both directions,
    which "every hunk except this one" is not."""
    for block in patch.split("diff --git "):
        if not block.strip():
            continue
        lines = ("diff --git " + block).split("\n")
        if f" b/{path}" not in lines[0]:
            continue
        header, hunks, current = [], [], None
        for line in lines:
            if line.startswith("@@"):
                if current is not None:
                    hunks.append(current)
                current = [line]
            elif current is not None:
                current.append(line)
            else:
                header.append(line)
        if current is not None:
            hunks.append(current)
        for hunk in hunks:
            if hunk[0] == at:
                return "\n".join(header + hunk).rstrip("\n") + "\n"
    raise SystemExit(f"could not isolate hunk {path} {at}")


def revert_no_hunk_unit(copy: pathlib.Path, path: str, rows) -> None:
    """H4's file-level revert, from the copy's OWN history."""
    row = next(
        (r for r in rows if (r[2] if r[0].startswith("R") else r[1]) == path), None
    )
    if row is not None and row[0].startswith("R"):
        old, new = row[1], row[2]
        (copy / new).unlink(missing_ok=True)
        blob = subprocess.run(["git", "show", f"HEAD:{old}"], cwd=copy,
                              capture_output=True)
        (copy / old).write_bytes(blob.stdout)
        return
    blob = subprocess.run(["git", "show", f"HEAD:{path}"], cwd=copy,
                          capture_output=True)
    if blob.returncode != 0:
        (copy / path).unlink(missing_ok=True)
        return
    (copy / path).write_bytes(blob.stdout)
    entry = subprocess.run(
        ["git", "ls-tree", "HEAD", "--", path], cwd=copy, capture_output=True, text=True
    ).stdout.split()
    if entry:
        os.chmod(copy / path, 0o755 if entry[0] == "100755" else 0o644)


def enumerate_units(cand: pathlib.Path, untracked):
    """Units from the CANDIDATE, never re-derived in the copy."""
    patch = sh("git diff HEAD -M", cwd=cand, check=True).stdout
    hunk_units, no_hunk = [], []
    current = None
    for line in patch.split("\n"):
        if line.startswith("diff --git "):
            current = line.split(" b/")[-1]
            no_hunk.append(current)
        elif line.startswith("@@") and current is not None:
            if current in no_hunk:
                no_hunk.remove(current)
            hunk_units.append((current, line))
    return patch, hunk_units, no_hunk, list(untracked)


def measure_r1_r2(scratch: pathlib.Path) -> None:
    print("=" * 72)
    print("R1 -- does `git clone --local` carry the ENVIRONMENT?")
    print("=" * 72)
    cand = build_candidate(scratch / "cand")
    rows, staged, untracked = manifest(cand)
    copy = scratch / "copy"
    sh(f"git clone --local -q {cand} {copy}", check=True)
    record("R1 the clone does NOT carry .venv (the worktree problem returns)",
           not (copy / ".venv").exists())
    record("R1 the clone DOES carry a self-contained gitdir", (copy / ".git").is_dir())
    apply_overlay(cand, copy, rows, staged, untracked, replay_index=True)

    operator_bin = cand / ".venv" / "bin"
    operator_env = dict(os.environ, PATH=f"{operator_bin}:{os.environ['PATH']}")
    bare = sh("pytest -q", cwd=copy, env=operator_env)
    where = sh('python -c "import pkg.core;print(pkg.core.__file__)"',
               cwd=copy, env=operator_env)
    print(f"    bare `pytest -q` in the clone: exit {bare.returncode}")
    print(f"    `import pkg` resolves to: {where.stdout.strip()}")
    record("R1 without setup, the clone's checks read the OPERATOR's source",
           str(cand) in where.stdout and str(copy) not in where.stdout)

    print("=" * 72)
    print("R2 -- does `run.prove_setup` in the copy CLOSE the bypass?")
    print("=" * 72)
    setup = sh("uv venv --python 3.12 .venv && uv pip install -q -e . pytest",
               cwd=copy, env=dict(os.environ, VIRTUAL_ENV=str(copy / ".venv")))
    print(f"    setup exit {setup.returncode}")
    copy_bin = copy / ".venv" / "bin"
    copy_env = dict(os.environ, PATH=f"{copy_bin}:{os.environ['PATH']}",
                    VIRTUAL_ENV=str(copy / ".venv"))
    now = sh('python -c "import pkg.core;print(pkg.core.__file__)"',
             cwd=copy, env=copy_env)
    print(f"    `import pkg` now resolves to: {now.stdout.strip()}")
    record("R2 after prove_setup the copy's checks read the COPY",
           str(copy) in now.stdout)
    baseline = sh("pytest -q", cwd=copy, env=copy_env)
    control_lap(copy)
    control = sh("pytest -q", cwd=copy, env=copy_env)
    print(f"    baseline lap: {'GREEN' if baseline.returncode == 0 else 'RED'}"
          f"   control lap: {'GREEN' if control.returncode == 0 else 'RED'}")
    record("R2 with a real environment the control lap DISCRIMINATES",
           baseline.returncode == 0 and control.returncode != 0)
    record("R2 `git clean -fd` SPARES the ignored .venv it just built",
           (copy / ".venv" / "bin").exists())


def measure_r3(scratch: pathlib.Path) -> None:
    print("=" * 72)
    print("R3 -- which overlay is faithful to the candidate's own git VIEW?")
    print("=" * 72)
    cand = scratch / "cand"
    rows, staged, untracked = manifest(cand)
    want_status = sh("git status --porcelain", cwd=cand).stdout
    want_lsfiles = sh("git ls-files", cwd=cand).stdout

    options = (("A", False, False), ("B", False, True), ("C", True, False))
    for option, replay, stage_all in options:
        print(f"  --- option {option} ---")
        copy = scratch / f"opt{option}"
        sh(f"git clone --local -q {cand} {copy}", check=True)
        apply_overlay(cand, copy, rows, staged, untracked, replay_index=replay)
        if stage_all:
            sh("git add -A", cwd=copy, check=True)
        (copy / ".venv" / "bin").mkdir(parents=True, exist_ok=True)
        (copy / ".venv" / "bin" / "marker").write_text("env\n")

        # A and B are measured to be UNFAITHFUL, and that is the finding rather
        # than a failure of the probe: each diverges from the candidate's git
        # view in a DIFFERENT direction, and the `git ls-files` row is the one
        # that decides it, because checks take their SCOPE from it.
        status = sh("git status --porcelain", cwd=copy).stdout
        listing = sh("git ls-files", cwd=copy).stdout
        faithful_status = status == want_status
        faithful_scope = listing == want_lsfiles
        drift = sorted(set(listing.split()) ^ set(want_lsfiles.split()))
        if option == "C":
            record("C: the copy's `git status --porcelain` == the candidate's",
                   faithful_status)
            record("C: the copy's `git ls-files` == the candidate's  (check SCOPE)",
                   faithful_scope)
        else:
            record(f"{option}: is UNFAITHFUL to the candidate's `git status`"
                   " (expected)", not faithful_status)
            record(f"{option}: is UNFAITHFUL to the candidate's `git ls-files`"
                   " (expected)", not faithful_scope,
                   "scope drift: " + repr(drift[:4]))

        snapshot = (status, tree_content(copy))
        control_lap(copy)
        at_head = sh("git status --porcelain", cwd=copy).stdout.strip()
        record(f"{option}: the control lap leaves the copy clean AT HEAD",
               at_head == "")
        record(f"{option}: the control lap spares the ignored .venv",
               (copy / ".venv" / "bin" / "marker").exists())
        apply_overlay(cand, copy, rows, staged, untracked, replay_index=replay)
        if stage_all:
            sh("git add -A", cwd=copy, check=True)
        restored = (sh("git status --porcelain", cwd=copy).stdout, tree_content(copy))
        record(f"{option}: the overlay restores exactly after the control lap",
               restored == snapshot)


def measure_r4_r5(scratch: pathlib.Path) -> None:
    print("=" * 72)
    print("R4 -- per-unit revert and restore, every unit kind")
    print("=" * 72)
    cand = scratch / "cand"
    rows, staged, untracked = manifest(cand)
    copy = scratch / "optC"
    snapshot = tree_content(copy)
    patch, hunk_units, no_hunk, untracked_units = enumerate_units(cand, untracked)
    total = len(hunk_units) + len(no_hunk) + len(untracked_units)
    print(f"  units: {len(hunk_units)} hunk, {len(no_hunk)} no-hunk, "
          f"{len(untracked_units)} untracked = M {total}")

    for path, at in hunk_units:
        one = single_hunk_patch(patch, path, at)
        back = subprocess.run(["git", "apply", "-R", "-"], cwd=copy, input=one,
                              capture_output=True, text=True)
        forward = subprocess.run(["git", "apply", "-"], cwd=copy, input=one,
                                 capture_output=True, text=True)
        record(f"R4 hunk revert+restore {path} {at[:22]}",
               back.returncode == 0 and forward.returncode == 0
               and tree_content(copy) == snapshot,
               back.stderr.strip()[:80] or forward.stderr.strip()[:80])

    for path in no_hunk:
        revert_no_hunk_unit(copy, path, rows)
        changed = tree_content(copy) != snapshot
        apply_overlay(cand, copy, rows, staged, untracked, replay_index=True)
        record(f"R4 no-hunk file-level revert+restore {path}",
               changed and tree_content(copy) == snapshot,
               "" if changed else "the revert changed nothing")

    for path in untracked_units:
        (copy / path).unlink()
        gone = not (copy / path).exists()
        shutil.copy2(cand / path, copy / path)
        record(f"R4 untracked delete+re-place {path}",
               gone and tree_content(copy) == snapshot)

    print("=" * 72)
    print("R5 -- H3's restoration check: ignores noise, FIRES on contamination")
    print("=" * 72)
    porcelain = sh("git status --porcelain", cwd=copy).stdout
    (copy / "coverage.out").write_text("noise\n")
    (copy / "src" / "pkg" / "__pycache__").mkdir(exist_ok=True)
    (copy / "src" / "pkg" / "__pycache__" / "x.pyc").write_bytes(b"\x00")
    record("R5 gitignored noise does NOT fire the restoration check",
           sh("git status --porcelain", cwd=copy).stdout == porcelain
           and tree_content(copy) == snapshot)
    (copy / "many.txt").write_text("a check rewrote a tracked file\n")
    record("R5 a tracked-file write FIRES the restoration check",
           tree_content(copy) != snapshot)
    apply_overlay(cand, copy, rows, staged, untracked, replay_index=True)
    (copy / "left_behind.txt").write_text("a check left this\n")
    record("R5 an unignored new file FIRES the restoration check",
           sh("git status --porcelain", cwd=copy).stdout != porcelain)
    (copy / "left_behind.txt").unlink()


def measure_r6(scratch: pathlib.Path) -> None:
    print("=" * 72)
    print("R6 -- H1's eligibility rule under the environment bypass")
    print("=" * 72)
    shapes = (("bypassed", ""), ("genuine", 'pythonpath = ["src"]'))
    for shape, pythonpath_line in shapes:
        cand = build_candidate(scratch / f"r6-{shape}", pythonpath_line)
        rows, staged, untracked = manifest(cand)
        copy = scratch / f"r6-{shape}-copy"
        sh(f"git clone --local -q {cand} {copy}", check=True)
        apply_overlay(cand, copy, rows, staged, untracked, replay_index=True)
        # The operator's interpreter, which is what a repo declaring no
        # `prove_setup` gets: the clone carries no environment of its own.
        env = dict(os.environ, PATH=f"{cand / '.venv' / 'bin'}:{os.environ['PATH']}")
        baseline = sh("pytest -q", cwd=copy, env=env)
        control_lap(copy)

        # **The control lap is run TWICE, warm and cold, and the difference is
        # R-H2 measured in this probe's own fixture.**
        #
        # `git clean -fd` spares gitignored files by design (Ruling 7a), so the
        # baseline lap's `__pycache__` survives into the control lap. CPython
        # invalidates a `.pyc` on `(mtime, size)` at ONE-SECOND resolution, so
        # when a lap is fast enough the control lap executes the BASELINE's
        # compiled test module and reports the baseline's colour. That made
        # this probe itself flaky before the two laps were separated — a
        # measurement instrument taking its answer from the measurement before
        # it, which for a measurement tool is the worse property, not the
        # lesser one.
        #
        # The assertion is on the COLD lap, because that is the answer H1's
        # eligibility rule is about. The warm one is reported, because it is
        # the evidence R-H2 rests on.
        warm = sh("pytest -q", cwd=copy, env=env)
        survivors = sorted(
            str(p.relative_to(copy))
            for p in copy.rglob("__pycache__")
            if ".venv" not in p.parts
        )
        for cache in copy.rglob("__pycache__"):
            if ".venv" not in cache.parts:
                shutil.rmtree(cache, ignore_errors=True)
        shutil.rmtree(copy / ".pytest_cache", ignore_errors=True)
        control = sh("pytest -q", cwd=copy, env=env)
        eligible = control.returncode != 0
        base_colour = "GREEN" if baseline.returncode == 0 else "RED"
        ctrl_colour = "GREEN" if control.returncode == 0 else "RED"
        warm_colour = "GREEN" if warm.returncode == 0 else "RED"
        print(f"  [{shape}] baseline lap: {base_colour}"
              f"   control lap (cold): {ctrl_colour}"
              f"   control lap (warm): {warm_colour}")
        print(f"  [{shape}] caches `git clean -fd` spared: {survivors}")
        if warm.returncode != control.returncode:
            print(f"  [{shape}] *** R-H2: the warm control lap disagreed with "
                  "the cold one — the lap took its colour from the lap before "
                  "it")
        print(f"  [{shape}] H1 verdict: "
              + ("usable (>=1 check eligible)" if eligible
                 else "INCONCLUSIVE (no check discriminates)"))
        if shape == "bypassed":
            record("R6 bypassed copy -> control GREEN -> INCONCLUSIVE, never a"
                   " clean page", baseline.returncode == 0 and not eligible)
        else:
            record("R6 genuine copy -> control RED -> the check is ELIGIBLE",
                   baseline.returncode == 0 and eligible)


def imports_from(copy: pathlib.Path, env: dict) -> str:
    """Where this tree's interpreter resolves `pkg` to. The whole lifecycle
    question is one string comparison, and round 3 died on nobody making it."""
    return sh('python -c "import pkg.core;print(pkg.core.__file__)"',
              cwd=copy, env=env).stdout.strip()


def prepare_copy(cand: pathlib.Path, copy: pathlib.Path, manifest_rows) -> dict:
    """Clone, overlay, and run `prove_setup` once. Returns the copy's env."""
    rows, staged, untracked = manifest_rows
    sh(f"git clone --local -q {cand} {copy}", check=True)
    apply_overlay(cand, copy, rows, staged, untracked, replay_index=True)
    sh("uv venv --python 3.12 .venv && uv pip install -q -e . pytest",
       cwd=copy, env=dict(os.environ, VIRTUAL_ENV=str(copy / ".venv")))
    return dict(os.environ, PATH=f"{copy / '.venv' / 'bin'}:{os.environ['PATH']}",
                VIRTUAL_ENV=str(copy / ".venv"))


def measure_r7(scratch: pathlib.Path) -> None:
    """R-H1 — the rebuild source is the PREPARED SNAPSHOT, never the bare clone.

    **This is the exact shape that returned NOT SOUND in round 3.** Ruling 11
    rebuilt the working copy from the pristine clone of §2 step 1; R1 above
    measured that a clone carries no environment; so every unit after the first
    contamination ran checks that imported the OPERATOR's tree, with no state
    anywhere saying so. A page of `unnoticed` rows, an intact `evidenced`
    count, and nothing wrong on the face of it.

    Both rebuild sources are measured here, in one run, on one fixture. The
    second is not a control for form's sake: a probe that only measures the
    fixed behaviour cannot tell "the fix works" from "this probe cannot see the
    defect", and that distinction is the whole reason this file exists.
    """
    print("=" * 72)
    print("R7 -- R-H1: contaminate, rebuild, and see WHICH TREE the next lap "
          "imports")
    print("=" * 72)
    cand = build_candidate(scratch / "r7-cand")
    rows_all = manifest(cand)
    copy = scratch / "r7-work"
    env = prepare_copy(cand, copy, rows_all)

    print(f"  after prove_setup, the copy imports: {imports_from(copy, env)}")
    record("R7 the prepared copy imports the COPY",
           str(copy) in imports_from(copy, env))

    # THE SNAPSHOT (R-H1). Taken after prove_setup, of the whole prepared
    # copy — tree AND environment — so a rebuild restores both in one act.
    snapshot = scratch / "r7-snapshot"
    shutil.copytree(copy, snapshot, symlinks=True)
    record("R7 the snapshot carries the environment the clone did not",
           (snapshot / ".venv" / "bin").is_dir())

    # A check contaminates the copy: it rewrites a TRACKED file, which is
    # Ruling 11's own trigger.
    (copy / "many.txt").write_text("a check rewrote this\n")
    dirty = sh("git status --porcelain", cwd=copy).stdout
    record("R7 the contamination is visible to the restoration check",
           "many.txt" in dirty)

    # ---- arm 1: the snapshot restored to a DIFFERENT path ----
    #
    # **This is what a plain reading of R-H1 gives, and it does not work.**
    # An editable install's `.pth` is ABSOLUTE — the fact that killed round 2 —
    # so a snapshot of a prepared copy carries a pointer to the path it was
    # prepared AT. Restore it anywhere else and its interpreter still imports
    # the old location. Measured rather than reasoned, because "a snapshot
    # carries the environment" is the same shape of sentence as round 2's "a
    # copy carries the environment", and that one was false.
    elsewhere = scratch / "r7-rebuilt-elsewhere"
    shutil.copytree(snapshot, elsewhere, symlinks=True)
    elsewhere_env = dict(
        os.environ,
        PATH=f"{elsewhere / '.venv' / 'bin'}:{cand / '.venv' / 'bin'}:"
             f"{os.environ['PATH']}",
    )
    resolved = imports_from(elsewhere, elsewhere_env)
    print("  rebuilt from the SNAPSHOT, at a DIFFERENT path:")
    print(f"      .venv present: {(elsewhere / '.venv' / 'bin').is_dir()}")
    print(f"      imports:       {resolved}")
    record("R7 a snapshot restored ELSEWHERE still imports the path it was "
           "prepared at -- the .pth is absolute, so R-H1 needs the same-path "
           "constraint", str(elsewhere) not in resolved, f"imports={resolved}")

    # ---- arm 2: the snapshot restored IN PLACE, at the working copy's path --
    #
    # The rebuild the sweep actually performs: delete the contaminated working
    # copy and put the snapshot back where it was. Same absolute path, so the
    # `.pth` written by `prove_setup` is still correct.
    shutil.rmtree(copy)
    shutil.copytree(snapshot, copy, symlinks=True)
    resolved = imports_from(copy, env)
    # The contamination was a rewrite of `many.txt`, which the OVERLAY also
    # modifies — so its presence in `git status` proves nothing either way.
    # What proves it is the bytes.
    restored = (copy / "many.txt").read_text() == (cand / "many.txt").read_text()
    print("  rebuilt from the SNAPSHOT, IN PLACE at the copy's own path:")
    print(f"      .venv present: {(copy / '.venv' / 'bin').is_dir()}")
    print(f"      imports:       {resolved}")
    print(f"      the contaminated file matches the candidate again: {restored}")
    record("R7 rebuilt from the SNAPSHOT IN PLACE: the next lap imports the "
           "COPY, and the contamination is gone",
           (copy / ".venv" / "bin").is_dir() and str(copy) in resolved
           and restored,
           f"imports={resolved} restored={restored}")

    # ---- arm 3: the bare clone, which is what Ruling 11 said ----
    #
    # **The red-watch, inside the probe.** Ruling 11's rebuild source has to be
    # observably wrong here, or R-H1 amended nothing and this measurement is
    # decoration.
    bare = scratch / "r7-bare"
    sh(f"git clone --local -q {cand} {bare}", check=True)
    bare_env = dict(
        os.environ,
        PATH=f"{bare / '.venv' / 'bin'}:{cand / '.venv' / 'bin'}:"
             f"{os.environ['PATH']}",
    )
    has_venv = (bare / ".venv" / "bin").is_dir()
    resolved = imports_from(bare, bare_env)
    print("  rebuilt from the BARE CLONE (Ruling 11, un-amended):")
    print(f"      .venv present: {has_venv}")
    print(f"      imports:       {resolved}")
    record("R7 rebuilt from the BARE CLONE: the next lap imports the "
           "OPERATOR's tree -- the round-3 killer, caught",
           not has_venv and str(cand) in resolved,
           f"venv={has_venv} imports={resolved}")


def _counting_check(where: pathlib.Path) -> None:
    """A check that CACHES ITS VERDICT across laps, in a gitignored file.

    R-H2's fixture. Rulings 7a and 11 spare gitignored files on purpose — 7a so
    the environment survives, 11 so noise does not fire restoration — and
    together they guarantee that anything a check writes to an ignored path
    carries into the next lap. This is the smallest honest instance: a check
    that remembers how many times it has run.
    """
    (where / "check.sh").write_text(
        "#!/bin/sh\n"
        "# A check whose answer depends on the laps before it.\n"
        'n=$(cat .lapcount 2>/dev/null || echo 0)\n'
        'n=$((n + 1))\n'
        'echo "$n" > .lapcount\n'
        '[ "$n" -lt 2 ] || exit 1\n'
    )
    os.chmod(where / "check.sh", 0o755)


def measure_r8(scratch: pathlib.Path) -> None:
    """R-H2 — lap independence is an assumption, so the sweep MEASURES it.

    The protection Fable ruled: re-run the BASELINE lap at the sweep's end, and
    if the closing baseline disagrees with the opening one, report
    `inconclusive-lap-coupling` rather than any unit state.

    **And its ceiling, measured in the same run.** A canary that fires on the
    coupling you thought of, while a page of `unnoticed` rows survives the
    coupling you did not, is worse than no canary — it is a clean page with a
    tick on it. So the second fixture couples a UNIT lap without moving the
    baseline's colour, and this probe records that the canary stays silent.
    That number goes in the spec as what R-H2 buys, and nothing more.
    """
    print("=" * 72)
    print("R8 -- R-H2: the closing baseline lap, and what it does NOT catch")
    print("=" * 72)

    coupled = scratch / "r8-coupled"
    coupled.mkdir(parents=True)
    sh("git init -q", cwd=coupled, check=True)
    (coupled / ".gitignore").write_text(".lapcount\n")
    _counting_check(coupled)
    sh("git add -A", cwd=coupled, check=True)
    sh("git -c user.email=p@l -c user.name=p commit -q -m HEAD", cwd=coupled,
       check=True)

    opening = sh("./check.sh", cwd=coupled).returncode
    # Two unit laps, each with the whole-change revert between them — Ruling
    # 7a's `clean -fd`, which spares the ignored cache by design.
    for _ in range(2):
        control_lap(coupled)
        sh("./check.sh", cwd=coupled)
    control_lap(coupled)
    closing = sh("./check.sh", cwd=coupled).returncode
    print(f"  opening baseline: {'GREEN' if opening == 0 else 'RED'}"
          f"   closing baseline: {'GREEN' if closing == 0 else 'RED'}")
    print(f"  the cache `git clean -fd` spared: "
          f"{(coupled / '.lapcount').read_text().strip()} laps counted")
    record("R8 the closing baseline DISAGREES, so the canary fires "
           "(inconclusive-lap-coupling)", opening != closing,
           f"opening={opening} closing={closing}")

    # ---- the ceiling: coupling that never moves the baseline's colour ----
    silent = scratch / "r8-silent"
    silent.mkdir(parents=True)
    sh("git init -q", cwd=silent, check=True)
    (silent / ".gitignore").write_text(".seen\n")
    (silent / "subject.txt").write_text("original\n")
    # A check that answers from a cache once it has one. On an untouched tree
    # it is GREEN every time — so both baselines agree — and on a REVERTED
    # tree it is still green, because it never looks again. That is a false
    # `unnoticed`, and the canary has nothing to compare.
    (silent / "check.sh").write_text(
        "#!/bin/sh\n"
        'if [ -f .seen ]; then exit 0; fi\n'
        'grep -q original subject.txt || exit 1\n'
        'echo cached > .seen\n'
    )
    os.chmod(silent / "check.sh", 0o755)
    sh("git add -A", cwd=silent, check=True)
    sh("git -c user.email=p@l -c user.name=p commit -q -m HEAD", cwd=silent,
       check=True)

    opening = sh("./check.sh", cwd=silent).returncode
    (silent / "subject.txt").write_text("the unit reverted this\n")
    unit = sh("./check.sh", cwd=silent).returncode
    control_lap(silent)
    closing = sh("./check.sh", cwd=silent).returncode
    print(f"  [ceiling] opening {opening} unit {unit} closing {closing}")
    record("R8 CEILING: a cache that never re-reads gives a false green in the "
           "unit lap AND agreeing baselines -- the canary cannot see it",
           opening == 0 and unit == 0 and closing == 0,
           f"opening={opening} unit={unit} closing={closing}")


def measure_r9(scratch: pathlib.Path) -> None:
    """R-H4 — a partially staged (`MM`) file makes the sweep inconclusive.

    `git add` stages WORKTREE content, so a candidate built with `git add -p` —
    stage this hunk, keep working — cannot be reproduced by an overlay that
    replays the staged set: the copy's staged blob holds the worktree bytes.
    The direction is safe and the round-3 review measured it; what was missing
    is the shape in this fixture, which is why the probe never saw it.
    """
    print("=" * 72)
    print("R9 -- R-H4: a partially staged file, and the precondition that "
          "catches it")
    print("=" * 72)
    cand = scratch / "r9-cand"
    cand.mkdir(parents=True)
    sh("git init -q", cwd=cand, check=True)
    (cand / "a.txt").write_text("one\ntwo\nthree\n")
    sh("git add -A", cwd=cand, check=True)
    sh("git -c user.email=p@l -c user.name=p commit -q -m HEAD", cwd=cand,
       check=True)
    (cand / "a.txt").write_text("one STAGED\ntwo\nthree\n")
    sh("git add a.txt", cwd=cand, check=True)
    (cand / "a.txt").write_text("one STAGED\ntwo\nthree WORKTREE\n")

    want = sh("git status --porcelain", cwd=cand).stdout
    print(f"  the candidate's own view: {want.strip()!r}")
    record("R9 the fixture really is partially staged", want.strip().startswith("MM"))

    copy = scratch / "r9-copy"
    rows, staged, untracked = manifest(cand)
    sh(f"git clone --local -q {cand} {copy}", check=True)
    apply_overlay(cand, copy, rows, staged, untracked, replay_index=True)
    got = sh("git status --porcelain", cwd=copy).stdout
    print(f"  the copy's view:          {got.strip()!r}")
    print(f"  candidate staged blob: "
          f"{sh('git show :a.txt', cwd=cand).stdout!r}")
    print(f"  copy staged blob:      "
          f"{sh('git show :a.txt', cwd=copy).stdout!r}")
    record("R9 the overlay CANNOT reproduce MM -- the staged blobs differ",
           sh("git show :a.txt", cwd=cand).stdout
           != sh("git show :a.txt", cwd=copy).stdout)
    record("R9 the faithfulness precondition FIRES before any check runs "
           "(inconclusive-staging)", want != got,
           f"candidate={want.strip()!r} copy={got.strip()!r}")


def main() -> int:
    if shutil.which("uv") is None:
        print("this probe needs `uv` on PATH")
        return 2
    root = pathlib.Path(tempfile.mkdtemp(prefix="hunt-mechanism-"))
    print(f"fixtures under {root}\n")
    try:
        measure_r1_r2(root)
        measure_r3(root)
        measure_r4_r5(root)
        measure_r6(root)
        measure_r7(root)
        measure_r8(root)
        measure_r9(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print()
    print("=" * 72)
    failed = [question for question, ok, _ in RESULTS if not ok]
    print(f"RESULT: {len(RESULTS) - len(failed)}/{len(RESULTS)} measurements passed")
    for question, ok, detail in RESULTS:
        if not ok:
            print("  FAILED:", question, "--", detail)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
