# Inspect the engineering loop

A delegation job contains a durable worker → checks → judge → repair journey.
The job page now opens its loop history by default, beneath the current decision.
It shows recorded candidates, failed/passed outcomes, stop/warning explanations,
reserved sessions, uncertain work and bounded check-output excerpts.

```sh
wring job loop --job JOB_ID --json
```

For a contained journey started directly from a plan, the same reader is available
as `wringer-drive loop --state CONTROLLER_DIRECTORY --json`.

Use the ID returned by `wring job new` or `wring job list`. `--app-dir DIRECTORY`
selects an existing application directory. A verification-only job has a separate
check history; this command does not relabel it as contained delegation.
Connected delegation clients have the equivalent read-only
`wringer.inspect_loop({jobId})` tool. No approval or running owner is needed for
the local CLI reader. Authentication still applies to MCP reads.

A request that still has questions and no compiled plan has no loop to inspect.
Complete its proposal first; the workspace profile is never shown as if it were
that job's approved plan.

The shared [inspection contract](../../schema/loop-inspection-v1.schema.json)
contains the exact plan and journal identities, candidate, decisions, current
repair packet and reserved allowances. Before a journey starts, measured budget
and candidate are `null`, not fabricated zero-cost success. Uncertain reservations
remain charged. The snapshot excludes active elapsed-time sampling so repeated
reads of unchanged records remain stable. Use job status for current activity.

An exact unsuccessful candidate repeat stops automatic repair under comparable
conditions. Repeated outcomes on changed candidates warn. A warning does not
prove a plateau, and neither policy permits delivering unmet requirements.
See [measured loops](MEASURED_LOOPS.md) for the existing plan contract.

Inspection excludes raw prompts, worker narratives and private provider traces.
Check excerpts are bounded and redacted; their omissions remain visible. They
may still contain business-sensitive project data. Inspect an export before
sharing it. The view is not an approval, a retry or a substitute for an
[offline delivery audit](../../examples/evidence/README.md).

The stop diagnostic is a display projection: controller paths and known private
path patterns are scrubbed. Immutable decision and repair bodies retain their
original identities for audit. Unknown secrets are not guaranteed absent.
