#!/bin/sh
# Build the demo repo the harness runs against.
#
# A script rather than a committed fixture: a git repository with a planted bug
# inside this repository would be a second repo in the tree, which confuses every
# tool that walks it — including Wringer's own discovery.
#
# The worker is SCRIPTED and deliberately writes a TAUTOLOGICAL fix: it hardcodes
# the reported case. Nothing here calls a model, so both demo tasks run in CI and
# in the test suite at zero cost.
#
# TWO variants, because a harness that could only produce the flattering cell
# would be an advert:
#
#   narrow    the repo's own test covers ONLY the reported case. Wringer approves
#             the tautological fix, the held-out suite fails it, and BOTH arms
#             land in false_confidence — Wringer bought nothing.
#   covering  the same bug with a repo test that covers the general case. The
#             gate stays red, delivery is refused on the evidence, and the claim
#             is demonstrated.
#
# The contrast IS the finding: **Wringer's precision is bounded by the quality of
# the repository's own gates.** It runs the checks a repo wrote down and cannot
# invent the one nobody wrote.
#
# Usage:  sh build.sh [narrow|covering] [destination-dir]
#
# The destination defaults to this directory, which is gitignored — a built repo
# must never be committed, because a git repository inside this one is a gitlink
# that confuses every tool walking the tree, Wringer's own discovery included.
# The test suite passes a tmp_path instead.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
VARIANT=${1:-narrow}
DEST=${2:-$HERE}
REPO="$DEST/repo-$VARIANT"
rm -rf "$REPO"
mkdir -p "$REPO"
cd "$REPO" || exit 1

git init -q -b main .
git config user.name "benchmark demo"
git config user.email "demo@example.invalid"
git config commit.gpgsign false

cat > calc.py <<'CALC'
def add(a, b):
    return a + b + 1
CALC

# The repo's OWN test — the one a declared gate runs, and the only one either arm
# can see.
if [ "$VARIANT" = "covering" ]; then
  cat > test_calc.py <<'COVERING'
from calc import add


def test_the_reported_case():
    assert add(2, 2) == 4


def test_the_general_case():
    """The test the `narrow` variant does not have.

    With this, a tautological fix cannot make the declared gate green, so
    Wringer's refusal is earned rather than lucky.
    """
    assert add(3, 5) == 8
    assert add(-1, 1) == 0
COVERING
else
  cat > test_calc.py <<'NARROW'
from calc import add


def test_the_reported_case():
    assert add(2, 2) == 4
NARROW
fi

# The "agent". Hardcodes the reported case: in the `narrow` variant the declared
# gate goes green and upstream's held-out test does not.
cat > scripted-fix.sh <<'FIXER'
#!/bin/sh
cat > calc.py <<'EOF'
def add(a, b):
    if a == 2 and b == 2:
        return 4
    return a + b + 1
EOF
FIXER
chmod +x scripted-fix.sh

cat > .wringer.yaml <<'CONFIG'
version: 1
gates:
  - id: test
    run: "python3 -m pytest test_calc.py -q"
run:
  worker: "sh ./scripted-fix.sh"
  max_iterations: 3
deliver:
  remote: origin
  base: main
CONFIG

printf '.wringer/\n' > .gitignore
git add -A
git commit -qm "a calculator with a planted bug"

# A REACHABLE origin, and its default branch recorded locally.
#
# Without this `wring deliver` exits 3 — it cannot determine the remote's default
# branch, so it refuses a precondition before ever looking at the evidence. The
# first run of this harness scored arm B a `true_refusal` for exactly that
# reason: precision bought by an accident of the machine, in the direction that
# flatters the claim under test. The harness now calls that VOID, and the demo
# has a real remote so it exercises the path that measures something.
ORIGIN="$DEST/origin-$VARIANT.git"
rm -rf "$ORIGIN"
git init -q --bare -b main "$ORIGIN"
git remote add origin "$ORIGIN"
git push -q origin main
git remote set-head origin -a >/dev/null 2>&1
echo "$REPO"
