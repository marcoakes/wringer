# Quickstart

Start with [installation](INSTALL.md). These commands use the compiled `dist/` build on your current shell's `PATH`.

**Want your coding app to handle the mechanics?** Use
[the assistant entry point](ASSISTANT_START.md) after installation. It is an
explicit cooperative-local engineering preview with separate human decisions
and visible security/compatibility limits. Its single private job page carries
approval, progress, actual result, review and a separate Send decision; showing
and handover preparation do not require extra routine clicks. The commands
below remain the direct operator route over the same application services,
not steps a PM must reproduce after opening that page.

## See the product without spending on a model

From the Wringer source checkout root:

```sh
bun run demo
```

The developer fixture records checks and delivery artifacts using deterministic fixture data and a local origin. Any human observation is explicitly a fixture observation. It must not be described as your approval, a full ACP journey, a clean-machine live-agent run, or proof that Apple Container or gVisor prevents an escape.

Read the paths it prints. The board shows the next useful step; the transcript retains the stops and the actual commands used.

## Prepare a real repository

Read [SETUP.md](SETUP.md) and the repository's proposed commands before executing them. Running a check is running code. The production journey requires isolated ACP roles, a pinned repository revision, an explicit acceptance contract, and a declared execution policy; a legacy local shell is not an isolation substitute.

Prepare the execution plan described in [SETUP.md](SETUP.md), then compile it without spending:

```sh
wringer-drive plan PLAN.yaml
```

`PLAN.yaml` is the operator-authored plan path. The [source template](packages/plan/examples/contained.yaml), also shipped at `dist/docs/examples/contained.yaml`, is compile-only: replace its repository, image, tool, agent and policy placeholders. It is not a live provider-capable runtime.

Review the canonical plan and exact digest. Then grant bounded authority and run:

```sh
wringer-drive authority PLAN.yaml --actor 'YOUR NAME' --expires 'EXPIRY_IN_ISO_8601' --output AUTHORITY.json
wringer-drive run PLAN.yaml --authority AUTHORITY.json --state CONTROLLER_STATE
```

Choose a real operator name and future expiry; the uppercase paths are yours to choose. Keep controller state outside the target repository clone. [HEADLESS.md](docs/native/HEADLESS.md) explains the limits and reuse of existing credentials. No historical HTTP recipe or host-worker flag is part of this path.

## Review the evidence

Use the same controller directory, not the isolated target clone:

```sh
wringer-drive status --state CONTROLLER_STATE
wringer-drive board --state CONTROLLER_STATE
```

Status validates the authoritative journal before showing the recorded state and
next action. The board prints a private localhost URL; open it and keep the
server running. It shows the outcome, requirements, check evidence, your decision,
usage and next permitted action. A disconnected or stale view cannot approve an
old candidate. The token in that URL grants local control: do not share it.
Use `--output NEW_FILE.html` for a read-only snapshot instead.

The board's display is the declared command's **text output**, not an embedded
web application. Choose a display that actually supports the human criterion;
printing a URL is not evidence that someone inspected that application.

For a requirement reserved for a person, use the exact human criterion ID from your plan and the recorded stop:

```sh
wringer-drive show --state CONTROLLER_STATE --criterion HUMAN_CRITERION_ID
```

The declared display runs in the contained candidate. A successful display prints a real receipt ID and the recording command. The person supplies their own observation and verdict:

```sh
wringer-drive review --state CONTROLLER_STATE --criterion HUMAN_CRITERION_ID --display DISPLAY_UUID --verdict met --by 'YOUR NAME' --note 'YOUR OWN OBSERVATION'
```

Replace the placeholders; use `not_met` for an objection. A PM agent cannot invent a person's verdict. A failed or absent display refuses recording; the contained pen has no independent-inspection bypass. Skip these commands when the plan has no human criterion.

After the observation, or after resolving another recorded stop, resume the same bounded journey:

```sh
wringer-drive resume --state CONTROLLER_STATE
wringer-drive status --state CONTROLLER_STATE
```

## Deliver and check from elsewhere

Only when status is review-ready and the operator wants a delivery, choose the actual Git remote, new review branch and target branch. These are placeholders, not configured destinations:

```sh
wringer-drive deliver --state CONTROLLER_STATE --remote REMOTE_URL_OR_BARE_PATH --source-branch NEW_REVIEW_BRANCH --target-branch TARGET_BRANCH
wringer-drive deliver --state CONTROLLER_STATE --remote REMOTE_URL_OR_BARE_PATH --source-branch NEW_REVIEW_BRANCH --target-branch TARGET_BRANCH --send
```

The preview does not push. `--send` is a separate publication decision; it does not merge or deploy. To request a hosted pull/merge request too, provide the same explicit `--forge-config FORGE.json` on preview and send. The declaration is `{kind, endpoint, repo, token_env}`; it names a credential variable, never its value. Git push and hosted-review publication have separate recorded outcomes.

Clone the chosen remote into a fresh directory, check out the delivered review branch, and follow its `mr.md` from the clone root. The actual command has this shape, with the real bundle path printed in the delivery:

```sh
wringer-drive audit --bundle .wringer/deliveries/REAL_DELIVERY_ID
```

The audit checks carried records offline; the original controller and provider account are not needed. It is not a fresh execution of acceptance checks or a live-isolation test.

From the same fresh clone root, run the falsification command printed by `mr.md`:

```sh
wringer-drive falsify --bundle .wringer/deliveries/REAL_DELIVERY_ID
```

Unlike audit, this runs checks in the declared contained verifier, which must be
provisioned on this machine or cluster. It calls no coding/judging agent. The
default ceiling is 24 attempted mutations and 60 seconds; `--max-attempts` and
`--wall-seconds` set explicit bounds, and `--output` selects the record directory.
The table records the committed base-to-candidate range, exact commit and
caught/survived/unavailable results for supported lexical mutations. Missing
runtime, failed controls or unavailable checks are inconclusive, not successful
falsification. This is not a complete mutation analysis or a correctness proof.
The standalone `wring verify --falsify --delivery` command reads a different format.

## Optional standalone repository tools

The older verification record format remains supported separately: `wring init`, `wring verify`, `wringer-board render`, `wringer-board judge`, `wring deliver` and `wring doctor`. These do not read or resume the contained state above. Checks and displays on this route are explicit trusted-local host execution. `init` writes the first `.wringer.yaml` and refuses an existing configuration. Choose this separate workflow deliberately, using its command help; do not switch to it as a recovery step for an isolated journey.

## If the run stops

Preserve the command, exit status, whole stop and named evidence path. Follow the printed recovery route. Resume should reuse recorded work and its original ceilings; an uncertain request is not silently sent again. Replacing a key, weakening isolation, editing an approval, or claiming a human saw something is not routine recovery.

See [unattended operation](docs/native/HEADLESS.md) for one-time authority and [security](SECURITY.md) for execution boundaries.

## Optional planning from your PRD

If your bounded template declares an ACP planner and a nonzero planning budget,
delegate the acceptance proposal before granting execution authority:

Start from the [planning template](packages/plan/examples/planning.yaml), also
shipped at `dist/docs/examples/planning.yaml`. It is compile-only: fill its real
repository, image, role, network and budget choices first. The execution template
does not declare a planner and cannot be used unchanged for this command.

```sh
wringer-drive propose TEMPLATE.yaml --intent PRD.md --actor 'YOUR NAME' --expires 'EXPIRY_IN_ISO_8601' --state PLANNING_STATE --output PROPOSED_PLAN.json
```

This explicit command authorizes planning only and may spend on that agent.
The planner can propose acceptance or ask a genuine product question; it cannot
expand the fixed repository, scope, runtime or budget. Review the proposed plan
before following its printed authority command. Check-authoring that requires
new protected source files is not silently performed by the controller.
