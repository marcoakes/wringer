# Design-led work, without losing the evidence

Keep your coding app. Give it your request, the target repository and an approved
design. Wringer binds that reference to the plan, supplies it to the contained
agents, and shows reference versus actual output on the same PM decision page.
You can ask for a correction, say Yes to the actual result, and separately Send.

This is an engineering preview. Live Figma authentication and a real PM/designer
blind journey are separate measurements, not implied by tests or API support.
There is no Figma canvas editing, arbitrary design plugin marketplace, hosted
preview or automatic “pixel perfect” verdict.

## One-time preparation by the local assistant/operator

Use the normal [assistant setup](../../ASSISTANT_START.md) and a bounded contained
profile matching your existing repo. The design owner must permit the captured
design bytes to travel with the source repository and its handover. This is
separate from permission to build or publish. Do not expose private customer
designs in a public repo. The importer cannot detect confidential pixels.

### Figma or another approved MCP design service

The importer executes a finite explicit read recipe. It does not spend on a model
or let a model select additional tools. Example `figma-read.json`:

```json
{
  "provider": "figma",
  "endpoint": "https://mcp.figma.com/mcp",
  "title": "Reports approved design",
  "source": {"label": "Reports desktop and mobile board", "fileKey": "YOUR_FILE_KEY", "nodeId": "YOUR_NODE_ID"},
  "recipe": [
    {"tool": "get_design_context", "arguments": {"fileKey": "YOUR_FILE_KEY", "nodeId": "YOUR_NODE_ID"}},
    {"tool": "get_screenshot", "arguments": {"fileKey": "YOUR_FILE_KEY", "nodeId": "YOUR_NODE_ID", "enableBase64Response": true}},
    {"tool": "get_variable_defs", "arguments": {"fileKey": "YOUR_FILE_KEY", "nodeId": "YOUR_NODE_ID"}}
  ],
  "componentRules": ["Reuse ui/components.ts and ui/tokens.css; do not replace them."],
  "limits": {"maxCalls": 3, "timeoutMs": 30000, "maxResponseBytes": 8388608}
}
```

The exact tool names/arguments must match those offered by the authorized service;
unknown or write tools refuse. An approved eligible Figma MCP client and token
are prerequisites, not something Wringer can grant. Use the authorized account
flow, never paste a token into the chat or recipe. The explicitly named token
variable is the only credential read by this import; it is not passed to workers.
No login or Keychain entry is created or replaced.

`enableBase64Response: true` explicitly requests the inline PNG form; a returned
URL is not followed. See Figma's [current screenshot tool documentation](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/#get_screenshot).

```sh
wring design import --repo TARGET_REPO --recipe figma-read.json --output design/snapshot.json --token-env FIGMA_MCP_TOKEN --allow-repository-storage
wring design inspect --repo TARGET_REPO --snapshot design/snapshot.json
```

One Figma recipe is scoped to one exact file and node. For a combined desktop and
mobile reference, select their containing design frame and inspect what was
actually returned. Inline PNGs are assigned `reference-1`, `reference-2`, etc.;
the tool output, not the example, determines the available ids. Remote asset
links, SVG, image downloads, unsupported PNG metadata and absent access refuse
with a stated reason. Context without a returned PNG cannot satisfy visual review.

For another system, use `provider: "generic-mcp"` with its approved public HTTPS
endpoint and a fixed recipe of advertised read-only tools. Read-only annotations
are claims by that service, not proof of its internal behaviour. Redirects, local
IP endpoints and private-network destinations are refused. No imported text can
expand Wringer's authority. A source version is “capture-only” unless a version
was actually reported or explicitly supplied by the operator.

### Owned reference, with no Figma account

Use this only when the design owner supplied the PNGs/context. It is explicitly
an `owned-reference` import, never evidence that Figma MCP worked. Put the PNGs
beside an input JSON file such as:

```json
{
  "title": "Reports design",
  "source": {"label": "Designer-owned approved export"},
  "context": "Calm Reports workspace. Desktop cards; one column on a phone. Clear search, status, empty reset and report detail.",
  "componentRules": ["Reuse ui/components.ts and ui/tokens.css."],
  "assets": [
    {"id": "desktop", "title": "Desktop", "path": "desktop.png"},
    {"id": "mobile", "title": "Mobile", "path": "mobile.png"}
  ]
}
```

```sh
wring design reference --repo TARGET_REPO --input design-input/owned.json --output design/snapshot.json --allow-repository-storage
```

Inputs must be static PNGs: at most 4 MiB each, 4096 pixels per axis, eight million
pixels per image, eight images and 8 MiB total reference-image bytes. The full
snapshot is bounded to 16 MiB. Import never overwrites an existing snapshot.
Without repository-storage permission, select an existing operator-owned private
folder (0700) outside **every Git working tree** for `--output`; a private import
under source control is refused before any service request. This private snapshot
cannot be bound or delivered. Permission to store design bytes in the repository
must be deliberate; moving a private file does not grant it.

### Bind the design and the way it will be shown

Commit the intended source plus `design/snapshot.json` in the target repo using
normal Git. Do not commit a private import. Wringer does not commit on import or
silently include uncommitted design edits. Prepare a new operator profile instead
of mutating a running approval. The output profile must be in an **existing,
operator-owned private folder (0700) outside every Git working tree**, even when
the snapshot has repository-storage permission.

Choose an absolute operator folder before binding. If creating a new one, replace
this illustrative absolute path with your chosen location under an existing
parent; do not change the permissions of an unrelated directory:

```sh
mkdir -m 700 /absolute/private-design-profiles
```

Use an existing matching profile as input and a new filename as output. Relative
design-command paths resolve from `TARGET_REPO`, not the shell's current folder;
use absolute paths for these operator profiles. A bare `--output NEW_PROFILE.json`
would point inside the source repo and is refused.

The existing profile must have a required human requirement with a `show`
command. For the [Reports starter](../../examples/reports-design/README.md), name
it `design-review`, use `bun checks/show.ts`, and declare `.evidence` as a writable
output directory. Protect `checks/`, `ui/`, `data/` and the design snapshot; only
`src/` is worker-writable. Its functional check is `bun checks/acceptance.ts`.

Use [reviews.json](../../examples/reports-design/reviews.json) for an owned import
with `desktop`/`mobile` ids. For MCP, replace those reference ids with the actual
ids reported by `design inspect`. A single combined reference can be compared
with two captures. The captured dimensions must match their declarations.

```sh
wring design bind --repo TARGET_REPO --plan /absolute/private-design-profiles/existing-profile.yaml --snapshot design/snapshot.json --reviews reviews.json --output /absolute/private-design-profiles/reports-design.json
```

This creates an unapproved design-aware plan: v3 input stays v3, preserving its
strict checks, loop policy and pinned playbook; older input becomes v2. It retains
the existing scope, checks and session/time budget and binds the exact committed
design. Use that profile in
the existing assistant setup. `inspect_setup` then supplies a design-aware
proposal template. The assistant preserves the design field when proposing the
person's original request. A different design requires a new profile/approval;
it is not an ordinary correction under the earlier Yes.

## What happens during the job

The CLI orchestrates. ACP opens separate contained agent sessions. Each receives
a controller-owned, read-only `wringer-design` MCP service exposing
`get_design_context`, `list_design_assets` and `get_design_asset`. It serves the
approved snapshot, not a live mutable account. Worker and judge get separate
instances. No Figma token, host MCP configuration or host home is mounted.

The verifier runs the declared show command inside the sandbox. Only declared
PNG outputs are exported after the process has stopped and source identity is
checked. Missing, invalid, wrongly sized or stale evidence refuses review.
The page loads and decodes the exact reference and output bytes before enabling
Yes. A changed candidate needs new display evidence and a new human decision.

The screenshots are not an interactive app. Functional/keyboard/empty-state
checks are separate evidence; full accessibility and aesthetic quality are not
inferred from them. The human requirement remains human. The handover carries
the snapshot and images and its existing audit command verifies their bytes
against the source-bound receipt. Offline audit does not rerun Figma or certify
design quality.

## Browser runtime prerequisite

The base agent image has no browser. The optional
[browser image recipe](../../runtime/Containerfile.design) extends an inspected,
digest-pinned Wringer image with Playwright 1.63.0/Chromium. Build it using your
existing platform's image-build procedure and supply `WRINGER_BASE_IMAGE` as the
actual inspected digest. Pin the resulting image in the new profile. Its build
inventory is retained; neither this recipe nor a host browser test proves it was
built or ran inside Apple container/gVisor on your machine. Do not silently fall
back to a host browser when the contained image is absent.

[Blind-test protocol](../DESIGN_BLIND_TEST.md) · [Implementation plan](../DESIGN_WORKFLOW_PLAN.md)
