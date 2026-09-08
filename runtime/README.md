# Contained image and live safety smoke gate

This directory is **source for an image**, not a published artifact. A local
Apple image was built on 7 September 2026; its observed identity and local-only
alias workflow are recorded below. A build is not a passed containment test.
The Dockerfile at the repository root is unrelated; use this Containerfile with
the repository root as build context.

## Measured upstream pins (7 September 2026)

| Component | Selected pin | Primary metadata |
| --- | --- | --- |
| Bun | 1.4.2 | [Bun releases](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2) |
| Codex ACP | `@agentclientprotocol/codex-acp@1.10.0` | [Versioned release manifest](https://raw.githubusercontent.com/agentclientprotocol/codex-acp/v1.10.0/package.json) |
| Codex CLI | `@openai/codex@0.153.4` | [Published package metadata](https://registry.npmjs.org/@openai/codex/0.153.4) |
| Claude ACP | `@agentclientprotocol/claude-agent-acp@0.65.0` | [Versioned release manifest](https://raw.githubusercontent.com/agentclientprotocol/claude-agent-acp/v0.65.0/package.json) |
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk@0.3.220` | Exact dependency in the Claude ACP release manifest above |

The Codex adapter declares Codex `^0.153.3`; the selected compatible CLI is
overridden to one exact version. Claude's adapter requires Node 22 or newer.
Both adapters now publish under `@agentclientprotocol`; the older Zed package
names are not the selected runtime. The OpenAI CLI is a dependency of the ACP
adapter, not a separate host execution route. [Official Codex CLI documentation](https://learn.chatgpt.com/docs/codex/cli).

## Build prerequisites and unresolved pins

An operator must first resolve and inspect official `oven/bun:1.4.2` and
`node:24-bookworm-slim` multi-platform images, then supply their **actual full
digests** as `BUN_BASE_IMAGE` and `NODE_BASE_IMAGE`. There are intentionally no
default digests. Bun is copied from its pinned stage into the pinned Node 24
Debian runtime. The build does not assume the distribution's apt repository
provides a recent enough Node for the ACP adapters.
Do not substitute a plausible hash or an image tag without a digest.

For a provisioned OCI builder, select `runtime/Containerfile`, repository-root
build context, `BUN_BASE_IMAGE=docker.io/oven/bun@sha256:<observed-bun-index-digest>`
and `NODE_BASE_IMAGE=docker.io/library/node@sha256:<observed-node-index-digest>`.
Do not run that placeholder as written. Build tooling and registry publication
are operator provisioning, not actions the smoke script performs.

The build verifies Bun's version, installs the Linux system tools, requires
Node 24, pins the four direct agent dependencies, suppresses dependency
lifecycle scripts, and records `bun.lock`, OS package inventory, Node/Bun
versions and both exact base references under `/opt/wringer-agents`.
Transitive npm and apt package versions are **resolved by that build**, not
claimed reproducible from this source alone. Review and retain that inventory.
Capture the resulting image's actual registry or local OCI digest and use that
full reference in the plan and smoke profile. Image construction and inventory
do not establish provider authentication or a successful live agent journey.

The image contains git, setpriv, timeout, pkill, pgrep, iptables/ip6tables, Bun
and Node. The controller starts as root inside the boundary; runtime code drops
agent/check processes to Linux uid/gid 1000 with no capabilities. Provider
credentials are not baked into the image. The no-model fixtures are separate
from both real adapters and reject every `session/prompt` request.

## Apple 1.3.1: use a locally built image by its observed digest

Appending a digest to a local build tag does not automatically register that
reference in Apple's local image store. The 7 September measurement first tried
the digest-qualified reference below and unexpectedly reached Docker Hub,
which refused it. Apple's pinned [image lookup implementation](https://github.com/apple/container/blob/1.3.1/Sources/Services/ContainerAPIService/Client/ClientImage.swift#L202)
matches stored reference names or build annotations, and falls back to pulling
when lookup fails; it does not find every local image merely by its digest.

The supported [image tag command](https://github.com/apple/container/blob/1.3.1/docs/command-reference.md#container-image-tag)
can register a local digest-qualified alias without registry publication. The
first local build (`fd8ced35…`) omitted the promised lockfile and was retired.
The corrected build requires the lockfile during construction. After reclaiming
disk space, it successfully unpacked and started; a real temporary container
confirmed all four pinned dependencies and the 29,672-byte lockfile with SHA-256
`a9c138d316fcee0de88b347de34bdb4fae89f9d6d6e91d4a70f1190d64b7a7e2`.
Its observed **index digest** is
`sha256:c52d11fbdaabf4011c36a99c410e9aa5520215645a439ccc1e73a55d3cbbe474`.
The following commands succeeded for this corrected image:

```sh
container image inspect wringer-agents:alpha3-arm64-r2
container image tag wringer-agents:alpha3-arm64-r2 wringer-agents:alpha3-arm64-r2@sha256:c52d11fbdaabf4011c36a99c410e9aa5520215645a439ccc1e73a55d3cbbe474
container image inspect wringer-agents:alpha3-arm64-r2@sha256:c52d11fbdaabf4011c36a99c410e9aa5520215645a439ccc1e73a55d3cbbe474
```

These are the recorded image's identifiers, not portable installation commands:
another machine must build or load its own image and inspect its own result.
For a new build, first inspect the source tag, obtain its actual index digest,
register the corresponding digest-qualified alias, and inspect that alias.
Require the returned descriptor digest to equal the observed source digest;
the alias's text alone is not proof. Use the verified full reference in the
plan and smoke profile, then verify the created instance's image identity before
credentials cross. Do not run a mutable tag with credentials as a workaround.
Keep the image local unless publication is separately authorized. The alias
operation itself proves neither a successful container start nor containment;
retain the later smoke report as a separate measurement.

## Run the real-platform smoke test

### macOS: let the test own its temporary positive control

After provisioning Apple container and verifying the digest-qualified local
image reference above, use the local helper from the repository root:

```sh
bun scripts/runtime-smoke-local.ts --image EXACT_DIGEST_REF --address LOCAL_IPV4 --output smoke-evidence-NEW
```

Replace `EXACT_DIGEST_REF` with the **verified** full image reference and
`LOCAL_IPV4` with a non-loopback IPv4 address currently assigned to this Mac.
Choose the actual interface reachable from the container VM, not an Internet
service, another computer, `0.0.0.0` or `127.0.0.1`. For example, inspect the
active interface in macOS Network settings; the helper checks the address
against the operating system's current interface inventory. It refuses an
unassigned address and refuses an existing output before opening its listener.

The helper binds only that address, lets the OS choose an ephemeral TCP port,
and immediately closes each accepted connection without reading, writing or
echoing application data. It owns the listener until the smoke finishes, fails
or is interrupted, then closes it in cleanup. There is no separately launched
listener whose short lifetime can expire while a managed approval is pending.
The source command exposes no provider, credential or arbitrary service option.

It derives an Apple profile with **1 CPU, 512 MiB, deny networking, no credential
environment variables and a 600-second measurement ceiling**. The existing
smoke performs its one-destination allowlisted positive control and denied
comparison, then its bounded cleanup. Cleanup may extend beyond the measurement
ceiling. The actual chosen address and port are retained in `profile.json` and
printed on completion; `report.json` remains the real smoke's report, not a
wrapper-generated verdict. A Mac firewall or unreachable interface can make the
network comparison inconclusive; do not change that to a pass or select someone
else's listener. The local helper does not provision/publish the image, start the
Apple service, call a model, test provider authentication or perform a PM run.

### Explicit profiles and nonlocal backends

Create a JSON profile with fields `runtime`, `networkProbe` and optional
`timeoutMs` (30–600 seconds; default 180). `runtime` is the same strict policy
object accepted by a contained plan: a real digest-pinned built image, positive
CPU/memory limits, selected ready Apple or gVisor/Kubernetes backend,
`network: {"policy":"deny"}`, and **no env or Secret references**.

`networkProbe` must be `{"address":"<operator-owned IPv4>","port":<TCP port>}`.
Provision a reachable listener you control. The script performs only TCP
handshakes, with no application payload. It creates an additional verifier with
that exact `/32` and port allowlisted as the positive control; failure to reach
it makes the deny comparison inconclusive, never a pass. Loopback and multicast
targets are refused. Do not select a model service or someone else's listener.

From the repository root, after filling the profile and provisioning the backend:

```sh
bun scripts/runtime-smoke.ts --profile runtime-smoke.local.json --output smoke-evidence-NEW
```

Output must be a new directory. It carries the profile, fresh local Git fixture
and bare origin, bundle, per-stage observations and `report.json`. No global Git
identity or forge account is used. SIGINT/SIGTERM cancel execution; cleanup has
its own bounded attempt and is checked against a successful platform listing.
Interrupted/failed measurements stay in the output directory. Exit codes: 0 is
the bounded smoke pass, 1 is a safety-probe failure, 2 is inconclusive/unavailable.

Measured stages are scoped writes, protected acceptance/Git metadata write and
rename denials, fresh peer storage and source, a host sentinel, resource
admission/readback plus guest counters, one network deny/control comparison,
no-model ACP initialize/session creation, cancellation, and cleanup. Guest
resource data is not a stress/OOM test. Private-storage checks are not a full
peer-network or escape test. No provider authentication, model convergence,
usage, or end-to-end blind verdict is inferred. Real provider rehearsal and the
full PM blind journey remain separate gates.

Unit/protocol tests run without containers or provider keys:

```sh
bun test ./packages/runtime/test/runtime-smoke.test.ts
bun test ./packages/runtime/test/runtime-smoke-local.test.ts
```

The local-helper unit suite uses synthetic interface/listener observations; it
opens no socket and makes no live containment claim. Run the helper itself on
the actual platform to obtain that separate measurement.
