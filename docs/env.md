# The environment stop, filmed — F6 / SPEC_ENV_V0, 2026-08-17

*Unedited console, captured on the maintainer's Mac by
`~/Claude/…/scratchpad/film_env.sh` at the commit that built F6. **The trap is
this machine's own**: the system `python3` at
`/Applications/Xcode.app/Contents/Developer/usr/bin/python3` has no `pytest`,
which is the condition the F6 dossier's scripts depend on and the one every
prior capture in this corpus avoided by selecting gates that could not hit it.
`docs/gategen.md` runs `python3 g_hdr.py`; SPEC_SCOPE's S4 mandates
stdlib-only gates by name. **Green-by-scenario-selection is the defect class
this project exists to catch, and this is the first capture in the corpus
where the chain meets a missing dependency.***

## What to look at, in order

1. **Tier 1 — the fact.** The gate is `pytest -q`: PATH-resolved, exit 127,
   before any worker acted. The loop stops with reason `environment` after
   **one** iteration. `ls WORKER-RAN.txt` → *No such file or directory*, and
   the `iterations/` directory **does not exist at all**. Nobody was briefed.
   That is the whole cycle: F6 measured a worker being handed a condition no
   tree edit can affect, and then blamed for it.

2. **`diagnosis.json` is a SIBLING, and the version was not spent.** The
   manifest still reads `wringer.loop.v2`. SPEC_ENV's ruling 3 asked for a
   `result.diagnosis` field and could not have it — `result` is
   `additionalProperties: false` in that frozen schema. Law 7: a new file is
   always allowed, a field on a frozen shape never is.

3. **Tier 2 — the hint, and the counterweight.** `python3 -m pytest` is the
   SAME cause with entirely different text: exit **1**, `No module named
   pytest`. It **still briefs a worker** and **still ends `no_progress`** —
   unchanged by this cycle, on purpose. Ruling 5 prices a false stop above a
   false continue: a false stop refuses a real repair, and that cost is
   unbounded. What changed is legibility. The record carries the face, and the
   brief says so **labelled a guess**, with exactly one imperative — stop and
   say why — and an explicit refusal to instruct an install.

4. **Tier 3 — repaired, and it converges.** Same repo, gate now naming a
   command this machine has. A worker is briefed, the gate goes green, the
   loop converges in two iterations. The stop is not a dead end; it is a
   different question being asked of a different person.

## What this does NOT show

- **The stop is four legs and only one of them is visible here.** A 127 after
  a worker acted, a gate invoking its deliverable by path (`./bin/tool`), and
  a gate carrying a `proves:` binding all continue. Those are in
  `tests/test_env.py`, one test per leg, both directions.
- **The fleet row is not filmed.** It is pinned end-to-end in
  `test_a_fleet_over_a_broken_environment_spends_no_retry_and_no_worker`,
  which exists because a mutation found the behaviour built and unguarded.
- **No claim is made that the guess is right.** `face` is a hint. It routes
  nothing, it never reaches acceptance, vacuity or health, and the schema's
  own description says so: *a routing diagnosis, never a verdict.*

---

```console

=== TIER 1 — THE FACT. A PATH-resolved command that is not there. ===

$ cat .wringer.yaml     # the gate is `pytest -q`; this machine has no pytest
$ wring run

iteration 1/3
✗ unit failed        0.0s

Stopped after 1 iteration — the first gate could not run at all, so no worker was briefed.
! `unit` ran a command that is not on PATH. That is a GUESS, read from the
  gate's own output: '/bin/sh: pytest: command not found'
  Nothing in the tree explains it, so no edit fixes it. Commands a person may
  run: `wring doctor`.
Loop evidence: .wringer/loops/20260817-090948-a399/
Last verification: .wringer/runs/20260817-090949-0735/
(exit 1)

$ ls WORKER-RAN.txt     # was a worker ever briefed?
ls: WORKER-RAN.txt: No such file or directory

$ cat .wringer/loops/20260817-090948-a399/diagnosis.json
{
  "schema_version": "wringer.diagnosis.v1",
  "face": "command_not_found",
  "gate": "unit",
  "evidence": "/bin/sh: pytest: command not found"
}

$ ls .wringer/loops/20260817-090948-a399/iterations/   # every brief this loop handed a worker
ls: .wringer/loops/20260817-090948-a399/iterations/: No such file or directory
(no iterations directory — nothing was briefed)

$ python3 -c "import json;print(json.load(open('.wringer/loops/20260817-090948-a399/manifest.json'))['schema_version'])"
wringer.loop.v2

=== TIER 2 — THE HINT. Same cause, different text, and it STILL briefs. ===

$ cat .wringer.yaml     # `python3 -m pytest` — exit 1, not 127
$ wring run

iteration 1/2
✗ unit failed        0.0s
→ worker             0.0s  (exit 0)

iteration 2/2
✗ unit failed        0.0s

Stopped after 2 iterations — the worker changed nothing, so the checks would say the same again.
! `unit` needs a package that is not installed in the environment. That is a
  GUESS, read from the gate's own output:
  '/Applications/Xcode.app/Contents/Developer/usr/bin/python3: No module
  named pytest'
  Nothing in the tree explains it, so no edit fixes it. Commands a person may
  run: `wring doctor`.
Loop evidence: .wringer/loops/20260817-090949-0314/
Last verification: .wringer/runs/20260817-090949-0e05/
(exit 1)

$ cat .wringer/loops/20260817-090949-0314/diagnosis.json
{
  "schema_version": "wringer.diagnosis.v1",
  "face": "missing_module",
  "gate": "unit",
  "evidence": "/Applications/Xcode.app/Contents/Developer/usr/bin/python3: No module named pytest"
}

$ sed -n '/This may not be a code problem/,/^## What to do/p' .wringer/loops/20260817-090949-0314/iterations/*/brief.md
## This may not be a code problem

**A guess, not a verdict.** `unit` needs a package that is not installed in the environment.
It was read from the gate's own output, on this line:

```
/Applications/Xcode.app/Contents/Developer/usr/bin/python3: No module named pytest
```

Nothing in this tree may explain that, and no edit here would fix
it. **If you conclude the fix is outside this tree, stop changing
files and say why.** Do not install anything and do not change the
environment: a gate that turns green because the environment moved
under it proves nothing, and no record would carry the reason.

## What to do

=== TIER 3 — THE ENVIRONMENT REPAIRED. The same repo converges. ===

$ # the gate now names a command this machine HAS. Nothing else changed.
$ wring run

iteration 1/3
✗ unit failed        0.0s
→ worker             0.0s  (exit 0)

iteration 2/3
✓ unit passed        0.0s

Converged in 2 iterations.
Loop evidence: .wringer/loops/20260817-090949-966c/
(exit 0)

$ ls WORKER-RAN.txt 2>&1   # and NOW a worker was briefed
001
```
