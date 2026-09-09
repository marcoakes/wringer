# Bring your Figma design into Wringer

Paste the desktop and mobile **frame or layer links**, not a file link. Both must
be from the same Figma file. Your coding app can prepare the request; the private
PM workspace handles connection and decisions. You do not copy tokens into chat
or ask an assistant to approve your design for you.

## The PM journey

1. Open **Bring a Figma design** in the existing private PM workspace.
2. Select **Connect Figma**, continue to Figma, authorise the read permission,
   return and finish connecting. If the service is unconfigured, stop and ask
   the workspace administrator to complete the deployment below.
3. Paste one desktop and optionally one mobile frame/layer link. The page shows
   the capture sizes this workspace expects. Prepare records links only.
4. Select **Preview these frames privately**. Wringer makes a bounded read and
   displays the actual exported PNGs. Failed or missing images disable retention.
5. If you have permission, enter your name and allow those exact bytes in the
   private repository and its handover. Then **Use these references for new work**.
   This creates a private source-bound profile, not a build or a remote push.
6. Ask your assistant to use that import for the new proposal. Review and approve
   the plan. The original source, earlier jobs and approvals are unchanged.
7. Review reference versus actual output on the job page. Request a correction
   or accept the displayed human requirement, then separately approve sending.
   Use the handover's own audit instructions in a fresh clone.

There are three different decisions: permission to retain a reference, approval
to spend on the plan, and acceptance of the actual result. Sending remains a
further explicit decision. None is inferred from the others.

## Once per workspace: the operator setup

Provision a [design-ready contained profile](DESIGN.md#bind-the-design-and-the-way-it-will-be-shown)
using the [Reports starter](../../examples/reports-design/README.md) or the real
target repository. It needs protected checks/components, an actual contained
`show` command and declared desktop/mobile PNG captures. The selected reference
count and dimensions must match these captures uniquely. Wringer cannot invent
a trustworthy renderer from a Figma URL. A placeholder owned-reference may seed
this profile, explicitly labelled as such; it is never presented as live Figma.

Set `WRINGER_FIGMA_BROKER_URL` in the operator process launching the assistant
workspace. It must be the HTTPS origin of the broker your administrator runs,
not an address supplied by a repository or assistant tool. No client secret
belongs on a PM machine. macOS stores the OAuth connection in Keychain; other
platforms use a user-private operator directory outside repositories. The latter
is permission-restricted storage, not an encrypted secret service.

The broker source and compiled executable ship with the product:

```sh
bun run figma:broker --help
./dist/wringer-figma-broker --help
```

Follow the [broker deployment guide](../../packages/figma-connect/README.md).
Register a real Figma OAuth app, choose its HTTPS callback, keep its app secret
server-side and deploy behind HTTPS with per-client rate limiting. This is a
single-instance engineering service: in-flight connections expire on restart.
No shared production broker, domain, TLS certificate or Figma app registration
is created by building this repository.

Figma documents registered-app credentials, callback URLs, permissions and app
publication in its [OAuth guide](https://developers.figma.com/docs/rest-api/oauth-apps/).
Private and public app eligibility differ; public distribution can require
Figma review. The requested scope is only
[`file_content:read`](https://developers.figma.com/docs/rest-api/scopes/).

## For the coding app

`wringer.inspect_design` returns safe setup/status. `wringer.prepare_design_import`
takes `workspaceId`, `idempotencyKey` and one or two `urls`. It does not fetch
designs or grant permission. `wringer.get_design_import` reads the returned
`importId`. Once the operator attaches it, supply that `designImportId` to
`wringer.inspect_setup`, then preserve its template and the same handle when
calling `wringer.propose`. A prepared/private/unattached import cannot be used.

No assistant tool can connect an account, approve retention, attach a reference,
approve execution, pass a human requirement or send work. The boundary remains
[cooperative-local](../../docs/ASSISTANT_SECURITY.md): an unrestricted app using
the same OS account is outside those tool restrictions, so physical human
presence is not cryptographically established.

## What the evidence actually proves

The connector reads selected nodes using the REST API, pins the reported file
version for PNG export and retains context, PNGs and hashes of bounded read
receipts. The new record says `figma-rest` / `figma-rest-read`, never official
Figma MCP. The [file API](https://developers.figma.com/docs/rest-api/file-endpoints/)
documents selected-node and rendered-image requests.

Workers and judges receive separate read-only MCP instances serving only the
approved snapshot. No live design credential enters their environment. Delivery
and offline audit bind the carried reference and reviewed output; they do not
contact Figma or prove ownership, current account access, design correctness or
that an unsigned receipt could not have been authored by its controller.

One or two nodes; static supported PNGs; 4 MiB per PNG, 8 MiB image aggregate,
16 MiB snapshot. Redirects and private-network destinations refuse. Only the
documented-in-code narrow render-host profile is accepted; Figma does not promise
that host profile forever. Unsupported exports stop rather than download from
an arbitrary URL. Rate limits do not silently retry. Disconnect removes local
credentials; revoke the app in Figma to revoke the remote grant.

The first parser accepts simple numeric frame/layer IDs. Instance-descendant
IDs, prototype links, whole-file links and historical-version link overrides
are not supported; choose the explicit containing reference frame instead.

## Verification and next blind test

`bun run figma:rehearse` uses owned images and injected API responses. It measures
the new record's PM/review/handover plumbing, not real Figma access. Keep that
label. See the [implementation plan](../FIGMA_API_IMPLEMENTATION_PLAN.md) and
[new API blind-test protocol](../FIGMA_API_BLIND_TEST.md). The older official-MCP
test remains a different lane; do not rewrite its stop as a REST success.
