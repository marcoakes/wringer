# PM blind task: stop wasting work after an import fails

This is a dependency-free Bun target for the next **pre-provisioned machine,
fresh run** evaluation. It is preparation material, not a passed blind test.
The harness never supplies a human verdict or a synthetic provider result here.

The application processes a small graph of named data steps. Literal inputs,
uppercase transforms and joins produce useful outputs; an explicit failing
import demonstrates its missing behaviour. Today it still attempts every step
after a prerequisite fails. The requested change is in [PRD.md](PRD.md).

## Source boundary and starting facts

The task is a subdirectory of the real Wringer Git repository, not a new or
unpublished Git origin. All commands below run from the **repository root**.
Select an exact published commit containing this directory before the blind
phase. The controller obtains that source through the normal public URL, carries
Git objects in a bundle, and the runtime clones it inside its boundary.

Only `examples/pm-blind-task/src/` is worker-writable. The proposed acceptance
mapping, PRD, README, checks, test data, planning template and display are
precommitted inputs. Changes elsewhere must refuse. Do not ask the worker to
rewrite tests, install the harness, edit its policy, or change the example data.

`src/pipeline.ts` owns graph validation and execution. `src/report.ts` formats the
result. `src/cli.ts` reads a pipeline JSON file and returns 0 for success, 1 for a
completed unsuccessful pipeline and 2 for invalid input. Existing public result
fields and the optional attempt hook are exercised by the protected checks.

The task requires only the measured Bun toolchain already in the approved image.
No package installation, additional account, global Git configuration or network
access is needed **by this example's commands**. Real ACP model work still needs
its separately approved provider credentials, egress and spending authority.

## Measure the committed starting point

These are operator preparation checks on trusted source, not proof of live
containment. Do not run them against a later candidate and call that the baseline.

```sh
bun examples/pm-blind-task/checks/baseline.check.ts
bun examples/pm-blind-task/checks/skip-downstream.check.ts
bun examples/pm-blind-task/display.ts
```

The first command must report **6/6 passed, exit 0**. The second must report
**0/6 passed, exit 1**: each protected check fails because the future feature is
absent. The display returns 0 because it successfully renders two deliberately
unsuccessful pipelines; it is not a claim that their behaviour is acceptable.
Capture an unexpected result before proceeding. No model convergence or PM
acceptance is inferred from these preparation measurements.

Acceptance checks deliberately end in `.check.ts`, not `.test.ts`. They are
explicit commands and are not added to the harness's green `bun test packages`
suite. Each can be run separately with `direct`, `transitive`, `branches`,
`attribution`, `multiple` or `summary` as its argument. Every check must be red
before the worker starts; a missing tool, syntax error or unavailable container
is not an acceptable red receipt.

[acceptance.json](acceptance.json) is an inspectable, source-owned suggested
mapping of four check criteria and one human criterion to the original words.
It defines six independently recorded acceptance commands. The baseline also
guards successful output, ordering, independent failure handling and invalid
graphs. This mapping is task input, not an execution approval; a planner/PM still
must review whether it captures the request.

## Prepare the next run through the product front door

Follow [installation](../../INSTALL.md), [setup](../../SETUP.md), and the
[operator start gate](../../docs/PM_BLIND_TEST.md). This is a source-checkout
example; no published starter package or automatic runtime provisioning is
claimed. Put the selected compiled `dist/` build on the current shell's PATH.

Create one new handover folder **outside** the repository. Copy `PRD.md` and
`planning.yaml` from this directory into it as `PRD.md` and `TEMPLATE.yaml`.
Fill the real published Git commit, built image digest, approved network policy,
measured adapter/model settings, operator, expiry and spending ceilings before
admitting the blind observer. Do not change the pinned example files. The
template explicitly chooses a Codex worker and separate Claude planner/judge;
it does not establish their effective models or provider authentication.

The existing macOS Keychain items are reused automatically for the declared
`CODEX_API_KEY` and `ANTHROPIC_API_KEY` names. Do not add them again. The
[credential guide](../../docs/native/HEADLESS.md#reuse-the-credentials-you-already-have)
names both services and the optional retrieval commands; values never belong
in the PRD, YAML, captures or chat.

From the new handover folder, after explicit planning-spend approval:

```sh
wringer-drive propose TEMPLATE.yaml --intent PRD.md --actor 'OPERATOR' --expires 'FUTURE_ISO_EXPIRY' --state planning-state --output proposed-plan.json
wringer-drive plan proposed-plan.json
wringer-drive doctor --plan proposed-plan.json --probe-agents
wringer-drive authority proposed-plan.json --actor 'OPERATOR' --expires 'FUTURE_ISO_EXPIRY' --output execution-authority.json
wringer-drive run proposed-plan.json --authority execution-authority.json --state run-state
```

Replace the uppercase actor/expiry placeholders with the predeclared values.
`propose` may spend on the planner; it is not a free preflight. The proposed plan
must retain the exact writable scope, protected inputs, six red-first commands,
green regression command and real text display. If it omits a requirement or
asks a genuine question, stop and record that. Do not silently patch the output
and count it as a clean blind pass. A reviewed execution plan can instead be
supplied before the test if planning is explicitly outside its declared scope.

Once the run has a durable record, open the PM surface in a second terminal
from the same handover folder:

```sh
wringer-drive board --state run-state
```

Keep its private URL out of captures. The genuine observer uses **Show the
recorded result** for `readable-report`, reads both actual reports and decides
whether the original imports to fix are clear. No text in this example answers
that criterion for them. If they request a revision, preserve the same bounded
journey and review the changed candidate again.

## Local delivery without a forge account

Source retrieval uses the real public HTTPS repository. Delivery can use a new
local bare mirror, prepared by the operator before the blind phase. From the
handover folder:

```sh
git clone --bare https://github.com/marcoakes/wringer.git delivery-origin.git
git --git-dir delivery-origin.git rev-parse --verify 'PUBLISHED_BASELINE_COMMIT^{commit}'
```

Use the actual selected commit, not the placeholder; stop if it is absent. Record
the exact absolute path of this new bare mirror in `START.md` as the delivery
destination. Do not point publication back at Wringer's public upstream. The
review branch is a newly chosen nondefault name, and the target branch is the
mirror's measured default branch. This publishes only to a disposable local
repository and cannot establish that hosted MR creation works.

At review-ready, prepare the delivery in the board, inspect its destination,
branch, evidence and the observer's original note, then make the separate send
decision. Follow the delivery's printed fresh-clone audit and falsification
commands from the clone root. Missing runtime is inconclusive falsification,
not a pass. The whole [blind protocol](../../docs/PM_BLIND_TEST.md) governs the
verdict, first hand repair, salvage labelling and retained evidence.
