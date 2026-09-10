# Keep your AI coding app. Put the work through Wringer.

Your assistant helps you describe the work and follow progress. Wringer owns
the bounded run, checks and evidence. One private job page carries the proposal,
progress, actual result, your review and a separate Send decision. You do not
need to assemble those steps from different dashboards.

New v3 profiles also show the approved approach and check history on that page.
Workers receive bounded failure details, and exact repeats of unsuccessful work
stop before another automatic attempt. Optional comparisons can test an approach
for **future** jobs under a separate allowance; they cannot approve themselves or
change your current work. See [measured repair loops](docs/native/MEASURED_LOOPS.md).

Building from a design? Paste the desktop and mobile Figma frame links and name
the existing component library. In a design-ready workspace, the private PM page
offers Connect Figma → private preview → permission to keep the references →
attach for new work. The assistant then uses the approved import handle for its
new proposal; earlier approvals do not transfer. [Figma connection setup and its
live prerequisites](docs/native/FIGMA_CONNECT.md). [Other design inputs](docs/native/DESIGN.md)
still work. The same job page shows reference versus actual desktop/mobile output
before your design decision. Tokens never belong in this conversation.

**This is an engineering preview, not a protected delegation product.** It
requires an operator to select a real contained execution profile once and
explicitly choose cooperative-local mode. A coding app with the same computer
permissions can bypass that cooperative arrangement outside the MCP tools.
Protected mode refuses. No named app has yet completed an independently
observed PM journey through this entry point. Read the short
[compatibility record](docs/ASSISTANT_COMPATIBILITY.md) before evaluating it.

## For the PM

Ask your operator to complete the setup below. Keep your existing coding app,
keys and account settings. Connecting the app does not share its subscription
with contained workers or make their work free.

Then give your connected assistant the repository and this request:

> Use Wringer for this request and repository. Show me the proposed work,
> assumptions and session/time limits before starting. Keep routine work inside
> what I approve. Bring me back for a real result to inspect, any changed scope
> and a separate handover decision. Do not record human judgements for me.

Your assistant can propose work, read status and evidence, request a correction,
and ask for eligible continuation. It cannot use the MCP contract to approve a
plan, increase limits, submit a human verdict or publish a change. The private
job page keeps these human decisions together. In this preview the page relies
on cooperation, not authenticated human
presence: do not treat a recorded name as proof of who clicked.

Expect these decisions, not permission for every engineering step:

1. **Approve the work:** exact request, requirements, source, scope and finite
   session/time limits. Missing facts and assumptions stay visible. Enter your
   name once; approved work then starts without another routine Start click.
2. **Review or correct:** Wringer opens the declared result on the same page.
   Inspect it, then choose **Yes, this is right** or **Request correction**.
   A comment is optional for Yes: the click is recorded as a decision, never
   turned into words you did not write. A correction needs your own description.
   Failed, missing or old displays cannot authorize a decision. A changed result
   needs a fresh review.
3. **Send:** Wringer prepares the accepted result without publishing it. Inspect
   the destination and review branch selected during setup, then separately
   choose **Send**. You do not re-enter that destination. Sending is not merging
   or deploying.

For a design-aware plan, the result includes actual PNGs from the declared
contained browser capture, compared with the approved reference. Other plans
retain their declared text display. Neither is an embedded interactive app.
The displayed content must genuinely support your judgement. Wringer does not
invent a report, infer design quality from passing checks, or claim a URL was
inspected just because it was printed.

After sending, the same page shows the recorded handover and copyable
fresh-clone audit instructions. A public review-request link is shown only if
one was actually created; it is not a hosted audit service. Never share the
private operator link as the reviewer's handover.

### Getting your attention

Use the job page's notification button to opt into browser notifications.
They work only while that page is open and the browser permits them; they do
not wake a closed coding app or a sleeping machine. The message contains no
project details or private control link.

A connected assistant can use `wringer.wait_for_update` to wait for a meaningful
change for up to 25 seconds per call (zero is an immediate check). This is a
bounded read-only MCP tool, not an MCP push notification or an always-on chat
service. Neither page refresh nor waiting calls a development model. The
assistant's own calls may still consume its coding-app account usage.

When Wringer stops, ask what happened and what is currently allowed. Refreshing
or reconnecting does not renew approval or buy a new attempt. An uncertain
attempt remains uncertain until explicitly reconciled. Unsupported strict cash
caps refuse; the preview enforces session/time limits, not a maximum invoice.

## One-time operator setup

Use a trusted Wringer source checkout and follow [INSTALL.md](INSTALL.md) to
build `dist/`. Keep that directory together. This is the single source-build
route; no package install, marketplace plugin or hosted service is implied.

Choose an absolute controller directory outside the target repository and a
real contained plan as the workspace profile. [SETUP.md](SETUP.md) describes
the pinned source, required tools, role separation, declared credentials and
finite limits. The example plan contains placeholders: it is not a provisioned
runtime. This profile preparation is still a technical operator step, and is a
remaining gap in an unassisted outsider installation.

From the built Wringer checkout, inspect the interface:

```sh
./dist/wringer-assistant --help
```

Before initialization, inspect the selected profile without starting an owner,
reading password values or making a provider request:

```sh
./dist/wringer-assistant setup --root ABS_CONTROLLER --plan ABS_PLAN --cooperative-local
```

Replace those placeholders with your absolute paths. The result distinguishes
observed prerequisites from things still unmeasured; **inspection complete is
not ready to spend**. Add `--check-keychain` only to check existing vendor entry
metadata. It does not retrieve a password, validate a key or replace an entry.

If you already have a matching, measured profile and want to pin it to the
selected checkout, your assistant can prepare the new file without editing its
hashes by hand:

```sh
./dist/wringer-assistant prepare --from-plan ABS_EXISTING_PROFILE --repo ABS_REPO --image DIGEST_QUALIFIED_IMAGE --output ABS_NEW_PROFILE --root ABS_CONTROLLER
```

The output's parent directory must exist. The source checkout must be clean;
the image must be its explicitly inspected digest-qualified reference. This
preserves the chosen requirements, checks, roles, network policy and finite
limits, while measuring the local source commit. Use `--source-url` only for a
separately selected HTTPS/SSH source. Remote possession of the commit and image
availability are still unmeasured. Existing different files are never overwritten.
Repository-defined Git content filters and submodules cause refusal before
host-side status can run filters or inspect nested repositories; use a separately
reviewed inert profile and contained source verification for those repositories.

If the repository has no remote — a fresh local repository with its own bare
`origin.git` and no forge account — prepare a local-only source instead:

```sh
./dist/wringer-assistant prepare --from-plan ABS_EXISTING_PROFILE --repo ABS_REPO --image DIGEST_QUALIFIED_IMAGE --output ABS_NEW_PROFILE --root ABS_CONTROLLER --local
```

`--local` needs a version 3 profile. It names the source by the single root
commit of its history and writes two files beside the new profile: its Git
bundle (`.source.bundle`) and a record of what was bundled (`.source.json`).
Keep the three files together. `setup` and `init` verify them, and `init` keeps
the verified bundle in the controller, so the checkout is not needed afterwards.
A history with more than one root refuses; name the remote with `--source-url`.
From there the job is approved, built, reviewed and sent to your local bare
origin like any other; its records name the local-only source throughout.

This prepares a selected profile, not an unassisted vendor wizard or a new
spending grant. Initial runtime/policy selection remains an operator task.

Select the handover destination **before initialization** if this evaluation
will include delivery. Save a JSON file with these fields, replacing this
illustrative remote and branches with the actual operator-approved choices:

```json
{
  "remote": "/ABSOLUTE/PATH/TO/EXISTING/origin.git",
  "sourceBranch": "wringer/pm-evaluation-01",
  "targetBranch": "main"
}
```

The remote must be your existing local bare repository or a credential-free
HTTPS/SSH repository URL. Choose a new, distinct review branch: it cannot be
`main`, `master` or the target branch. Recording this destination does not push
anything, grant publication or create a hosted review request. The person will
confirm the exact prepared change before sending. Omit `--destination` only for
a deliberately non-delivery evaluation; the assistant cannot fill it in later.

In the following commands, replace `ABS_CONTROLLER`, `ABS_PLAN` and
`ABS_DESTINATION_JSON` with your chosen absolute paths. They are not literal
directory names to copy unchanged.

```sh
./dist/wringer-assistant init --root ABS_CONTROLLER --plan ABS_PLAN --destination ABS_DESTINATION_JSON --cooperative-local
./dist/wringer-assistant start --root ABS_CONTROLLER --cooperative-local
./dist/wringer-assistant status --root ABS_CONTROLLER
./dist/wringer-assistant connect --root ABS_CONTROLLER --client codex
```

Initialization registers the selected profile; starting launches the local
execution owner. Neither is permission to run a paid planner by default.
This root keeps one pinned source/profile and destination choice. It does not
automatically advance to later repository commits or invent fresh delivery
branches for subsequent jobs. Reinitializing with different choices refuses
and preserves its evidence. Treat a later source/destination as a separate
operator setup decision, never a workaround for the original job's spent grant.
Existing worker credentials are resolved through the declared runtime at
execution, not returned to the assistant. See
[credential reuse](docs/native/HEADLESS.md#reuse-the-credentials-you-already-have).
Do not put provider keys in connection arguments, client configuration or chat.

The connection command prints instructions for the named Wringer entry; it
does not rewrite the client's configuration or lower its approval settings.
Inspect any existing entry before applying those instructions. Keep the
operator console link private and out of the assistant's conversation. Give
the client only its restricted connection, never the full review-workspace
URL. A successful connection is not a passed PM task.

Starting prints the private operator console link. If the person needs it again,
the operator can explicitly request it with
`./dist/wringer-assistant status --root ABS_CONTROLLER --operator`.
Ordinary status does not expose that link. This distinction restricts the
interface; it does not prevent another program under the same OS account from
invoking the operator route.

Codex is the first documented candidate because its official instructions
describe local STDIO servers. The generated connection uses that mechanism;
Wringer's complete client/version measurement remains open. See the
[official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
Claude Code and Kimi are not interchangeable evidence for that route.

### Fewer routine prompts, without unlimited permission

The printed Codex recipe includes an optional setting to allow routine calls
for **only the named, restricted Wringer server**, with its explicit tool list.
An operator may review and apply that per-server setting once. It does not
change global shell/browser permissions, grant new execution budgets or supply
human review/publication decisions. Client or organization policy may still
require permission. Wringer does not bypass it. The official
[MCP tool-approval settings](https://learn.chatgpt.com/docs/extend/mcp?surface=cli#other-configuration-options)
describe that client control; its presence is not a measured PM compatibility
claim.

## Reconnect, stop and disconnect

The execution owner is separate from the MCP conversation. Use the same
controller and connection when reopening a chat; read status before requesting
more work. Do not initialize a new root to get around an exhausted job.

```sh
./dist/wringer-assistant status --root ABS_CONTROLLER
./dist/wringer-assistant stop --root ABS_CONTROLLER
```

Stopping the owner is not a refund or proof that a remote request never ran.
If an owner died unexpectedly, retain the stop and read the status. Only when
the product identifies dead ownership and you acknowledge unknown outcomes:

```sh
./dist/wringer-assistant recover --root ABS_CONTROLLER --acknowledge-uncertain
```

Recovery does not replay paid work or reset limits. Restarting the owner is a
separate action; approval expiry and elapsed time include downtime. This
preview does not install an automatic login/reboot service and cannot work
while the machine is asleep.

Dead-owner recovery and reconciling an operation are separate. If status gives
an uncertain job/operation, use those actual IDs after inspecting the retained
evidence—not invented replacements for these placeholders:

```sh
./dist/wringer-assistant reconcile --root ABS_CONTROLLER --job JOB_ID --operation OPERATION_ID --acknowledge-uncertain
```

This checks whether retained domain evidence settles the existing operation.
It cannot accept your assertion of success or make another model call. If an
effect is still unknown, reconciliation refuses and keeps its reservation.

To disable the assistant connection while preserving its evidence:

```sh
./dist/wringer-assistant revoke --root ABS_CONTROLLER
```

Revocation requests owner shutdown, then invalidates assistant connections.
Read whether shutdown was confirmed: active remote effects may still remain,
and accepted pending jobs are retained. Remove only the named Wringer client
entry using the disconnection command printed by `connect`; do not delete
controller state as a way to disconnect.

An expired or revoked connection is not automatically renewed by restarting.
If the operator deliberately wants to reconnect after inspecting retained work,
start the owner and explicitly renew only the scoped connection:

```sh
./dist/wringer-assistant start --root ABS_CONTROLLER --cooperative-local
./dist/wringer-assistant connect --root ABS_CONTROLLER --client codex --renew
```

This does not renew execution approval or reset a budget. Starting the owner
may dispatch a previously accepted pending operation only under its still-valid
original approval. If that is not intended, do not restart it merely to inspect
evidence; ordinary status remains available without a running owner.

For an upgrade, stop dispatch, inspect pending/uncertain work, retain the
controller directory, build the intended checkout, and inspect the newly
printed connection instructions. Do not overwrite a different MCP entry or
silently migrate an in-flight job to a new plan. An unsupported stored version
must be diagnosed rather than erased.

These commands print the relevant maintenance steps without performing them:

```sh
./dist/wringer-assistant upgrade --root ABS_CONTROLLER
./dist/wringer-assistant uninstall --root ABS_CONTROLLER
```

They do not remove keys, client settings, executables or evidence. A missing
controller is an error, not permission to create or erase one.

## What to record in a test

Record the exact build, client/version, machine condition, profile, setup steps,
genuine human decisions and every stop. Coding-app usage may be unavailable to
Wringer; worker/judge billing may also be unknown. Record both lanes separately.

Use the [assistant PM test protocol](docs/PM_ASSISTANT_BLIND_TEST.md). A protocol
fixture, CLI demonstration or builder-operated run is useful engineering
evidence—not a stranger's successful PM test. The original
[alpha.3 blind FAIL](docs/PM_BLIND_REPORT_2026-09-08.md) remains unchanged.
The [alpha.6 launch checkpoint](docs/ASSISTANT_LAUNCH_CHECKPOINT_2026-09-08.md)
records the scripted rehearsal, measured prerequisites and still-open gates.
The [guided PM experience checkpoint](docs/PM_GUIDED_EXPERIENCE_2026-09-08.md)
records the newer single-page flow under its own validation status. The
[second blind FAIL](docs/PM_BLIND_REPORT_2026-09-08_2.md) is also preserved:
UI repairs do not by themselves prove that its historical handover blocker is
resolved or that a real PM has completed the repaired journey.
