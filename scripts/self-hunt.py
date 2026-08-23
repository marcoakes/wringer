"""THE HUNT, RUN BY HAND ON THIS WINDOW'S OWN CHANGE.

The product feature is blocked on a ruling. Its QUESTION is not: for each part
of what I built, does my own evidence notice if it goes away?

Two halves, because this diff has two kinds of unit:

  A. THE DOC CORRECTIONS. Revert each one alone; the guard written with it
     must go red. (revert-the-fix, the standing law)
  B. THE DERIVATIONS. Mutate each derived scope back to the HAND LIST it
     replaced. If nothing goes red, that derivation is unevidenced — it
     could silently narrow tomorrow and the suite would not care. This is
     exactly the QUICKSTART defect aimed at my own work.

The evidence set is the guards this change touched, not the whole suite —
the same scoping decision SPEC_HUNT_V0 §2 makes, for the same reason.
"""

import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
PY = REPO / ".venv/bin/python"

EVIDENCE_SET = [
    "tests/test_docs.py",
    "tests/test_doctor.py",
    "tests/test_neutrality.py",
    "tests/test_security_isolation_ledger.py",
    "tests/drive",
    "tests/board",
]


def lap(label):
    """Run the evidence set in the repo as it currently stands."""
    done = subprocess.run(
        [str(PY), "-m", "pytest", "-q", "-x", "--no-header", *EVIDENCE_SET],
        cwd=REPO, capture_output=True, text=True,
    )
    red = done.returncode != 0
    first = ""
    for line in done.stdout.splitlines():
        if line.startswith("FAILED"):
            first = line.split(" - ")[0].replace("FAILED ", "")
            break
    return red, first


# --- B: the derivations, mutated back to the hand lists they replaced -------
#
# Each entry: (label, file, old_text, new_text). The mutation makes the
# derivation silently narrow — the defect this whole window was about.
MUTANTS = [
    (
        "reader_facing_pages: stop descending into docs/",
        "tests/core_helpers.py",
        'for path in sorted(base.rglob("*.md")):',
        'for path in sorted(base.glob("*.md")):',
    ),
    (
        "runbooks(): back to the old three",
        "tests/test_docs.py",
        "    return reader_facing_pages(captures=False)\n\n\ndef runbook_names",
        (
            "    return [repo_root() / n for n in ('SETUP.md', 'QUICKSTART.md', "
            "'README.md')]\n\n\ndef runbook_names"
        ),
    ),
    (
        "guarded_prose(): back to the old seven",
        "tests/test_docs.py",
        (
            "    root = repo_root()\n    return [\n        name\n        for name in "
            "(\n            path.relative_to(root).as_posix()\n            for path "
            "in reader_facing_pages(captures=False)\n        )\n        if not "
            "name.startswith(_RECORDS)\n    ]"
        ),
        (
            "    return ['README.md', 'AGENTS.md', 'SECURITY.md', 'QUICKSTART.md', "
            "'SETUP.md', 'THREAT_MODEL.md', 'CONTRIBUTING.md']"
        ),
    ),
    (
        "watched_documents(): back to the old four",
        "tests/test_security_isolation_ledger.py",
        (
            "    root = repo_root()\n    return [\n        name\n        for name in "
            "(\n            path.relative_to(root).as_posix()\n            for path "
            "in reader_facing_pages(captures=False)\n        )\n        if not "
            "name.startswith(_RECORDS)\n    ]"
        ),
        "    return ['SECURITY.md', 'README.md', 'SETUP.md', 'docs/MANUAL_CHECKS.md']",
    ),
    (
        "pm_pages(): back to the old five",
        "tests/drive/test_drive_docs.py",
        (
            "    return [\n        path.relative_to(ROOT).as_posix()\n        for "
            "path in reader_facing_pages(captures=False, root=ROOT)\n    ]"
        ),
        (
            "    return ['START-HERE.md', 'AGENTS.md', 'docs/ENDINGS.md', "
            "'docs/WRITING-A-REQUIREMENT.md', 'examples/README.md']"
        ),
    ),
    (
        "docs_with_doctor_output(): back to the old three",
        "tests/test_doctor.py",
        (
            "    return [\n        path\n        for path in "
            "reader_facing_pages(captures=False)\n        if "
            "cited_check_names(path.read_text(encoding=\"utf-8\"))\n    ]"
        ),
        (
            "    return [repo_root() / n for n in ('SETUP.md', 'QUICKSTART.md', "
            "'README.md')]"
        ),
    ),
    (
        "every_shipped_module(): back to the old five",
        "tests/test_neutrality.py",
        (
            "    root = ROOT / \"src\"\n    return sorted(\n        "
            "path.relative_to(ROOT).as_posix()\n        for path in "
            "root.rglob(\"*.py\")\n        if \"__pycache__\" not in path.parts\n    "
            ")"
        ),
        (
            "    return ['src/wringer/config.py', 'src/wringer/gates.py', "
            "'src/wringer/loop.py', 'src/wringer/acp.py', 'src/wringer_drive/run.py']"
        ),
    ),
    (
        "v3_fixtures(): back to the old two",
        "tests/board/test_acceptance_v3.py",
        (
            "    return sorted(path.name for path in "
            'directory.glob("acceptance-v3-*.json"))'
        ),
        "    return ['acceptance-v3-causes.json', 'acceptance-v3-human.json']",
    ),
    (
        "is_capture(): the banner rule swallows everything",
        "tests/core_helpers.py",
        "    if _CAPTURE_NAME.search(relative.as_posix()):\n        return True",
        "    if True:\n        return True",
    ),
    (
        "declares_itself_preserved(): never fires",
        "tests/core_helpers.py",
        "    return any(_PRESERVED_BANNER.search(line) for line in head)",
        "    return False",
    ),
    (
        "the runbook 'warn' escape hatch opens to anything",
        "tests/test_docs.py",
        "            assert _NAMES_IT_TO_WARN.search(window), (",
        "            assert True or _NAMES_IT_TO_WARN.search(window), (",
    ),
    (
        "credential guard: 400-char window becomes the whole file",
        "tests/test_docs.py",
        "                text[max(0, found.start() - 400): found.end() + 400].split()",
        "                text.split()",
    ),
]

# --- A: the doc corrections, reverted one at a time ------------------------
DOC_FIXES = [
    "docs/attest-and-audit.md",
    "docs/specs/SPEC_PROVENANCE_V0.md",
    "docs/deployment.md",
    "docs/graphs.md",
    "INSTALL.md",
    "docs/pm-loop.md",
    "AGENTS.md",
    "EVIDENCE.md",
    "docs/specs/SPEC_EXEC_V0.md",
]

BASE = "302eb35"


def main():
    red, _ = lap("baseline")
    if red:
        print("BASELINE IS RED — nothing below can be trusted. Stop.")
        return 2
    print("baseline: green\n")

    print("=== A. the doc corrections: revert each alone ===")
    a_unnoticed = []
    for path in DOC_FIXES:
        full = REPO / path
        keep = full.read_bytes()
        old = subprocess.run(["git", "show", f"{BASE}:{path}"], cwd=REPO,
                             capture_output=True)
        if old.returncode != 0:
            print(f"  {path}: NEW FILE at base — no correction to revert")
            continue
        full.write_bytes(old.stdout)
        red, who = lap(path)
        full.write_bytes(keep)
        state = "EVIDENCED" if red else "UNNOTICED"
        if not red:
            a_unnoticed.append(path)
        print(f"  {state:10} {path}" + (f"  <- {who}" if red else ""))

    print("\n=== B. the derivations: mutate each back to its hand list ===")
    b_unnoticed = []
    for label, path, old, new in MUTANTS:
        full = REPO / path
        text = full.read_text()
        if old not in text:
            print(f"  !! MUTANT DID NOT APPLY: {label} ({path})")
            b_unnoticed.append(f"{label} [mutant did not apply]")
            continue
        full.write_text(text.replace(old, new, 1))
        red, who = lap(label)
        full.write_text(text)
        state = "EVIDENCED" if red else "UNNOTICED"
        if not red:
            b_unnoticed.append(label)
        print(f"  {state:10} {label}" + (f"  <- {who}" if red else ""))

    print("\n=== the count line ===")
    total = len(DOC_FIXES) + len(MUTANTS)
    unnoticed = len(a_unnoticed) + len(b_unnoticed)
    print(f"{total - unnoticed} of {total} parts of this change are evidenced")
    if a_unnoticed or b_unnoticed:
        print("\nUNNOTICED:")
        for x in a_unnoticed + b_unnoticed:
            print(f"  - {x}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
