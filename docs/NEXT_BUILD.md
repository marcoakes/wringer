# The next build — declare it once, then read one page

This is the route alpha.15 to alpha.19 exist to make possible. It is written from
what a second application actually needed, and every sentence below names a
Wringer verb or a `.wringer.yaml` key rather than a script you would have to write.

**It is a route, not a result.** No application has been built through it yet. The
measurement sheet at the end is what to collect on the first one — and those are
measurements to collect, not improvements already achieved.

## 1. Declare what your checks need

`wring doctor` used to answer with rows about the repository, the configuration and
the Bun runtime. Give it the prerequisites and it measures them instead:

```yaml
requires:
  - kind: browser                # launches the pinned engine and opens about:blank
  - kind: native_database        # one identity query against the URL named below
    url_env: DATABASE_URL        # a variable NAME, never a URL
  - kind: filesystem             # write, fsync and read back in the workspace and .wringer/
  - kind: container_service      # asks the Apple client for its service status
```

Each row answers on one ladder — **installed → executable → capability measured**,
with **unavailable** and **not measured** as the two honest ends — and carries the
measurement it rests on and one bounded next step. An installed browser that cannot
launch is `executable`, not ready. A portable database does not satisfy
`native_database`. A cloud placeholder that does not read back is `unavailable`. A
stopped container service is a row with `container system start` as its next step;
nothing is started for you.

Run it before you spend anything:

```sh
wring doctor
```

Exit 1 is a measured shortfall. Exit 0 with `unmeasured` means a declared
prerequisite was never measured, which is not the same as ready.

## 2. Declare the prelude, the services and the phases

```yaml
setup:                                  # ordered, bounded, project-owned. Never retried.
  - id: migrate
    run: node node_modules/prisma/build/index.js migrate deploy
  - id: seed
    run: node --import tsx scripts/seed.ts
services:                               # started once, for the first phase that needs them
  - id: worker
    run: node --import tsx src/worker/index.ts     # no URL of its own: recorded as not measured
  - id: app
    run: node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
    readiness: { url: 'http://127.0.0.1:3000/api/health', body_path: worker.status, equals: healthy, timeout: 60 }
phases:                                 # once declared, these ARE the running order
  - id: static
    gates: [lint, typecheck, build]
  - id: live
    needs: [worker, app]
    gates: [domain, persistence, browser]
teardown:
  - id: stop-fixtures
    run: node scripts/teardown.mjs
```

`env:` on a step or service maps a variable name to **another variable's name**,
never a literal — a literal there would put a credential in the repository, and it
is refused.

**Exit codes are the part to wire into CI:**

```
0  every required gate in every phase passed
1  a gate ran and failed
2  a setup step failed, or a service never answered its declared readiness
4  cancelled
```

Exit 2 is not a product result: no gate was asked a question.
`orchestration.json` names the step or service, what its URL last answered and how
long it waited. Nothing under `setup:` or `services:` is retried. Teardown always
runs — after a failed gate, after exit 2, after a cancellation — and only the
process groups this run started are ever signalled.

## 3. Declare what each gate really is, and what it evidences

```yaml
gates:
  - id: persistence
    run: npx vitest run --reporter=json
    timeout: 240
    proves: [SW-01, SW-03]              # several gates may prove one criterion
    inputs: [tests/**, vitest.config.ts, package-lock.json]
    evidence: { kind: assertions, adapter: vitest }
  - id: browser
    run: npx playwright test --reporter=json
    timeout: 300
    proves: [SW-01, SW-02]
    evidence: { kind: assertions, adapter: playwright }
  - id: smoke
    run: node scripts/smoke.mjs
    corroborates: [SW-01]               # support that can never override a failure
```

- **`evidence:`** reads the runner's own report, so **zero executed assertions
  cannot pass** whatever the command exited, a report contradicting the exit code
  is refused, and a browser that never launched is classified `environment` from
  the launch probe rather than from a log line. Adapters: `vitest`, `playwright`,
  `node-test` (declare `--test-reporter=tap`; Node's default on a pipe is `spec`).
- **`inputs:`** folds the tests a runner discovers, its config and the lockfile
  into the check's identity, so changing an indirectly loaded test invalidates
  comparability instead of passing as the same check.
- **Layered `proves:`** means *all required*: every binding gate must pass and each
  needs its own recorded earlier failure. `corroborates:` is recorded and never
  decides.

## 4. Run it, in whatever phases your machine can manage

```sh
wring verify --strict                        # the whole declared order
wring verify --gate lint --gate typecheck    # or one subset at a time
```

A subset stays exit 0 and reports `passed` **for its selection**, and says in one
sentence what it did not cover:

```
Incomplete: 7 required checks were not run (domain, persistence, browser, …).
```

`--strict` (automatic when `CI=true`) compares the source before and after the
gates. A gate that modifies tracked source **cannot leave an exact-source claim**:
the run fails with every gate green. Ignored build output stays permitted.

## 5. Combine the phases and read one page

```sh
wring audit --set .wringer/runs/FIRST --set .wringer/runs/SECOND --set .wringer/runs/THIRD \
  --live-check smoke --supersedes docs/earlier-decision.md
```

Exit 0 means every required declared gate has exactly one **passed** execution
across the set. Exit 1 means it does not, and the receipt separates the gaps from
the failures. Exit 2 is a refusal naming the offending bundle: two revisions, two
configurations, two definitions of one check, a damaged bundle, or two outcomes for
one gate.

It writes `.wringer/sets/<id>/set.json` and `.wringer/sets/<id>/HANDOFF.md` — the
one locator to publish. The handoff separates the tested commit from the evidence
commit, lists complete and incomplete checks with the bundle that decided each,
states which gates you declared as live integration checks and what they do not
establish, keeps agent review apart from owner judgment (`none recorded` where no
person recorded one), names the repository, preview and artifact locators, and dates
a *superseded* line for every earlier decision file you name.

```sh
cat .wringer/sets/*/HANDOFF.md
```

## The measurement sheet

Collect these on the first application built this way. The Zen report asked for
exactly these five and said to treat them as measurements, not achievements.

| Measure | How to take it | ZenJev, September 2026 |
|---|---|---|
| Setup interventions before a working verification environment | Count each manual repair between the first `wring doctor` and the first green phase, including every one the doctor did not name | Days lost to Apple Container permissions, PostgreSQL shared memory, Chromium startup and cloud-filesystem placeholders. No row caught any of them |
| Lines of custom coordination code | `wc -l` every script that exists only to sequence, supervise or aggregate verification | 117 (`scripts/ci-verify.mjs`) + the coordinating parts of a 104-line workflow |
| Time to an actionable failure | From starting a verification to holding a sentence that names the next step, for each of: a missing prerequisite, a failed gate, an unavailable service | Not measured |
| Incomplete-run misclassifications | Count the times a partial or hollow result was read, by a person or a script, as a complete verification | Four subset bundles each reporting `passed`; completeness assembled by hand |
| Handoff inconsistencies | Count statements in the delivered narrative that the evidence contradicts | Decision documents still described access as pending and publication as not performed after both had happened |

Also worth recording, because they are cheap and they were the expensive unknowns:
how long the declared prelude took against how long the gates took; how many
services needed a readiness answer the project had to invent; and whether any
`requires:` row was `not measured` at the moment somebody trusted the run.

## What this route does not claim

It does not claim that a passing set covers a requirement's meaning, that declared
`inputs:` cover everything a runner loads, that a measured capability describes the
machine that will run the checks if that is a different one, or that any of this
replaces a person's judgment. It does not claim ZenJev's numbers improved: they get
measured on the next build, against the column above.
