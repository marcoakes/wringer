# Start here if you are a coding agent

Install with [INSTALL](../INSTALL.md). Name your client in every command:
`claude-code`, `codex`, `cursor`, `gemini-cli`, `generic`, `kimi`, `vscode` or
`windsurf`. None is a default, and no provider or model is chosen for you.

**Verification:** your client makes the change and Wringer runs the
repository's checks. **Delegation:** Wringer gives a bounded job to a worker and
an independent judge. The quickest delegation is
[trusted-local](native/TRUSTED_LOCAL.md): your own Claude Code or Codex login,
on this computer, with nothing contained.

```sh
wring setup --repo /absolute/project --client CLIENT --mode delegation \
  --runtime trusted-local --worker-adapter claude-agent-acp --judge-adapter claude-agent-acp \
  --source local --dependencies none --writable src --remote origin --base main --dry-run --json
```

`--writable` names what the worker may change; repeat it for each path.
`--remote` and `--base` name where a finished job can be sent; without them the
work can be accepted but not sent. For verification only, use
`--mode verification`. Show the person what setup proposes and apply it only with
their agreement (`--apply --expected IDENTITY --actor NAME --cooperative-local`).
Setup approves no work.

**A new requirement needs a check that fails today.** The worker cannot change
checks, and a check that already passes stops the approved job before any worker
turn. So add the failing test and commit it first. A job pins the commit it is
created on. Then:

```sh
wring job new --workspace WORKSPACE_ID --intent 'The original request' --json
wring connect --workspace WORKSPACE_ID --client CLIENT --scope project --dry-run --json
wring job open --workspace WORKSPACE_ID
```

Repeat connect with `--apply --expected IDENTITY` for `claude-code` or `codex`;
other clients print their documented recipe for you to add. `wring job open`
starts the owner your client connects to and opens the person's private page;
connecting starts nothing. Reload the client.

## The loop

1. `wringer.inspect_setup`, then build the request from the person's own words:
   `wringer.validate_proposal`. Take the revision of the job `wring job new`
   returned from `wringer.get_status` and record the request on that job with
   `wringer.revise_proposal`. (`wringer.propose` adds a second job beside it.)
2. Give the person the decision link the tools return, once, exactly as
   returned. Approval happens on that page, not in chat. A browser that has not
   been unlocked shows a locked page: they run
   `wring job open --workspace WORKSPACE_ID --job JOB_ID` on this computer.
3. Once approved, `wringer.start` with the revision `wringer.get_status` reports.
   Wait with `wringer.wait_for_update` (at most 25 seconds a call).
4. When the result is ready, send the person to the same page to review it.
   After they accept it, `wringer.prepare_handover`; Send stays their decision.

There are no approval, verdict or Send tools. Never write a decision for the
person, edit `wringer.judgements.yaml`, or replace their keys. A refusal is an
answer: read its reason and its next step. More: [USING_WRINGER](../USING_WRINGER.md).

A stopped owner needs [explicit recovery](MIGRATION.md); reconnect to the same
workspace rather than proposing an uncertain job again.

## Limits

Each recipe is a connection, not a measured journey; see
[compatibility](ASSISTANT_COMPATIBILITY.md). Trusted-local runs with your
permissions. Contained work needs [operator setup](START_OPERATOR.md) and the
[bounded feature example](../examples/adoption/contained-feature/README.md).
