# Improve the approach used by future jobs

Wringer keeps a failed attempt as evidence you can use again. A proposed worker
playbook must make a prediction, face a fixed comparison, and qualify before you
select it for future work. Installing or inspecting this feature spends nothing.

The ordinary job page now has **Optional · improve future work**. CLI and MCP
read the same job-bound projection. The page shows the prediction, every retained
trial, missing trials, unknown cost, the proposed playbook's path and digest,
and the exact conditions under which the evidence applies.

## Start from an existing delegation job

```sh
wring experiment connect --job JOB_ID --task-family reports
wring job improvements --job JOB_ID --json
wring experiment patterns --job JOB_ID --task-family reports --json
```

The first command creates private research and adoption storage in your owned
application directory. No private controller identifiers or registry paths are
needed. One repository/task family is selected immutably per workspace. New jobs
inherit that connection. Other already-prepared contexts can be connected
explicitly with the same command; their plans and approvals remain unchanged.
Use the same `--app-dir` override on every command if you selected a custom one.
Research storage must remain outside Git and production controllers.

Patterns require an actual retained journey. A question-only job has no observed
failure to learn from. Only structured development observations enter the pattern
report; it excludes raw conversations, credentials and research holdout feedback.
A recurring failure is an observation, not a causal explanation.

## Register a prediction and inspect its proposed approach

Prepare a comparison using the existing
[experiment contract](EXPERIMENTS.md) and
[compiled-plan example](../../examples/improvements/prepare-comparison.ts).
The two arms must differ only in the worker playbook. Review the exact source
file named by the candidate playbook digest. The model that proposes a change
cannot consume held-out answers or change the evaluator to approve itself.

```sh
wring experiment register --job JOB_ID --experiment reports --input comparison.json
wring experiment proposal --job JOB_ID --experiment reports --json
wring experiment evaluate --job JOB_ID --experiment reports --json
```

`proposal` returns the immutable preregistration: prediction, both pinned plans,
task splits, finite limits and stopping rule. Redirect its JSON to retain a
reviewable artifact. `evaluate` is offline. Failed, missing and unknown outcomes
stay visible; a green subset cannot replace the denominator.

## Test, adopt or undo explicitly

The job page's **Test this improvement** action displays the separate allowance
and requires an expiry. The existing CLI offers the same finite collection:

```sh
wring experiment grant --job JOB_ID --experiment reports --actor 'YOUR NAME' \
  --expires FUTURE_ISO_TIME --output grant.json
wring experiment collect --job JOB_ID --experiment reports --grant grant.json --yes
wring experiment evaluate --job JOB_ID --experiment reports --json
```

Collection may make paid calls. Session/time limits are not a hard money cap.
Opening the page, registering a proposal or reading its result never starts it.
The collector reserves the comparison before dispatch and does not silently
replay uncertain work after restart. Its private research ending cannot Send
production work or supply production acceptance.

The page offers **Use for future work** only for qualifying retained evidence.
Both page and CLI enforce evidence and selection revisions. Use the existing
`promote` flags with `--job JOB_ID --experiment reports`; use `rollback` with
`--job JOB_ID`. The human-facing decision is an operator act under the documented
cooperative-local boundary, not proof of physical human presence.

Future typed proposals inherit a selection only when source, runtime, models,
environment and checks match. Changing the source can require a new comparison.
Previously retained proposals, approval hashes and same-key replays keep their
original approach. Undo changes the future selection; it does not rewrite history.

MCP exposes only `wringer.inspect_improvements({jobId})`. It cannot collect,
adopt, approve or Send. The public record is
[`wringer.job-improvements.v1`](../../schema/job-improvements-v1.schema.json).

## What has been measured

The phase-2 packaged walkthrough uses ordinary job handles and the actual
collector with a labelled failure fixture. It preserves both planned slots and
refuses adoption. A Chromium walkthrough exercises real authenticated routes,
job switching, an expired allowance, a mobile viewport and locking. Synthetic
unit fixtures separately exercise successful selection/undo and future-only
composition. These are mechanism checks, not live product benefit.

See the [execution record](../restoration/STATUS.md) for qualification and release
status. No live comparison or independent human assessment was performed in
this restoration phase. There is no measured improvement percentage to advertise.
