# Bounded contained feature: inclusive ranges

This is a complete operator recipe with inert source, acceptance and proposal.
It has no recorded live model result. It needs an independently measured Apple
Container or gVisor runtime, explicit worker/judge models, usable credential
references, finite provider allowance and a person to review/Send.

Create a clean scratch Git repository with `src/range.mjs` copied from
[range.mjs.txt](range.mjs.txt), and the exact words in [request.md](request.md).
Commit it explicitly using a scratch-local identity and disabled signing/hooks.
Do not run a managed role locally while containment is unavailable.

1. Follow [operator provisioning](../../../docs/START_OPERATOR.md), retaining the
   provisioning ID and successful readiness ID. Review service start/downloads
   separately. `runtime catalogue` names pinned recipe inputs.
2. Preview new protected checks as inert data:
   `wring setup --repo /absolute/range-repo --prepare-acceptance /absolute/acceptance.json.txt --dry-run --json`
   using [acceptance.json.txt](acceptance.json.txt). Repeat with `--apply
   --expected IDENTITY --actor NAME` after review. This keeps a private prepared
   source child commit and returns an acceptance ID. It runs no test/model.
3. Preview setup with all choices explicit (replace uppercase selections):

```sh
wring setup --repo /absolute/range-repo --client codex --mode delegation --provision PROVISION_ID --readiness READINESS_ID --acceptance ACCEPTANCE_ID --worker-provider openai --worker-model SELECTED_WORKER_MODEL --judge-provider openai --judge-model SELECTED_JUDGE_MODEL --source local --dependencies none --network deny --writable src --dry-run --json
```

The provider is a deliberate example selection, not a default. Providers may
require reviewed allowlisted egress instead of deny. Choose measured addresses
and ports via `--network allowlist --egress CIDR@PORT --dns IPV4`; do not broaden
silently when denied. Repeat the exact choices with `--apply --expected IDENTITY
--actor NAME --cooperative-local` after reviewing the profile and source.

4. Prepare a job with the verbatim request, open its page and connect the scoped
   client using [START_AGENT](../../../docs/START_AGENT.md). Ask the assistant to
   validate [proposal.json.txt](proposal.json.txt), repair field errors, then
   revise that pending job using its returned IDs/revision. The profile supplies
   protected runtime/source/check commands; the proposal authors only mutable
   acceptance/scope/ceilings. No profile JSON or digest needs manual editing.
5. Inspect the red baseline/assertion evidence. Approve the finite job, observe
   worker/judge/check results, and inspect the actual display. Request correction
   if needed; accept only the displayed source. Decline Send once to observe that
   preparation persists, then authorize the exact intended branch separately.
   Audit from a fresh clone using the returned command. Start a second job against
   the later source with fresh authority.

Expected refusals: missing runtime/readiness/model selection; unreadable source;
check replacement; worker writes to protected acceptance; larger budgets; failed
or missing display; exhausted authority; stale Send. Keep each as evidence.
A source-only/uncertain push is not completed handover. The local no-model
measurement composes this proposal and executes its assertions in a scratch repo;
it makes no containment/provider claim. [Sanitized sample](sample.json).
