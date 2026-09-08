# Assistant launch checkpoint — 2026-09-08

Status: **engineering checkpoint, not a finished protected launch**.
This records work after alpha.5. The original alpha.3 blind FAIL is unchanged.
No scripted decision below is a real PM's approval or observation.

## What changed

- Setup diagnoses the selected profile, source build, runtime tools, environment
  names and connection. Optional Keychain metadata inspection does not print or
  retrieve password values. It does not claim that a present key is valid.
- `prepare` derives a new immutable profile from an existing selected profile,
  a measured clean Git source and an explicitly supplied image digest. It keeps
  requirements, role choices, scope, network policy and ceilings. It does not
  invent an agent, open network access or approve the job.
- Named Codex connection checks reject conflicting environment, transports,
  disabled tools and unsafe paths. Upgrade/uninstall output is explicitly an
  instructions-only plan, preserving evidence and unrelated client settings.
- Assistant status now reads the same audited publication facts as the board.
  A pushed branch is not an open hosted request, merge or deployment. Unknown
  publication is shown as unknown. A publication from another candidate is not
  silently attached to the current source.
- Fresh preparation/publication is refused after the candidate was sent or its
  publication is uncertain. Both admission and dispatch enforce the check;
  disabling a button alone is not enforcement. Identical retained requests
  remain readable without replay.
- Standalone passing checks no longer claim that no verification record exists
  when requirements have not yet been assessed.

See [the starting page](../ASSISTANT_START.md) for the actual onboarding commands.
The profile preparer is not yet an unassisted vendor-selection wizard or a
demonstrated outsider installation.

## Complete scripted rehearsal

Run from the checked-out repository, after building:

```sh
bun run assistant:rehearse
```

The [rehearsal](../scripts/assistant-launch-rehearsal.ts) exercises the real
MCP/application/controller/portable-delivery path with **synthetic role replies,
check results, display receipts and scripted operator decisions**. It makes no
provider calls. It creates its own temporary Git repositories and local bare
origin with repo-local identity, not a forge account or global Git changes.

It checks denied unapproved start, retained original words, explicit refusal,
correction, original reservation limits, owner replacement and reconciliation,
no duplicate correction, source-bound negative and positive fixture reviews,
separate send, matching public projections and the literal fresh-clone audit.
The literal extra-breakage command also runs; absent real containment is recorded
as unavailable/inconclusive, not a successful mutation challenge.

Each execution retains `result.json`, its sanitized transcript, assistant/board
views and a fresh-clone delivery. The record identifies the script and compiled
audit binary by hash and says whether the checkout was modified. A development
rehearsal is not presented as a frozen release candidate.

The first complete development execution passed 28 checks in 55.248 seconds.
Subsequent regression assertions also check refusal of fresh handover and both
disabled PM publication actions. Final validation and exact commit/remote CI
are recorded in the evidence section below, not inferred from that earlier run.

## Live prerequisites measured without model calls

An explicit diagnostic reuses existing credentials in memory and performs one
fixed metadata request per vendor. No request prompt, response body, key value
or provider error text is retained. No redirects or automatic retries occur.

```sh
bun scripts/provider-readiness.ts all
```

Observed outside the coding sandbox on 2026-09-08:

| Measurement | Result | What this does not prove |
| --- | --- | --- |
| OpenAI metadata authentication, existing `openai-api-key` Keychain entry | HTTP **401**, credential rejected | No Codex-worker live run can be claimed from this credential |
| Anthropic metadata authentication, existing `anthropic-api-key` entry | HTTP **200**, metadata authenticated | Available credit, selected-model permission or successful ACP work |
| Apple Container system service | Running, API server **1.3.1** | Isolation from the outer coding app; the current runtime belongs to the operator account |
| Native biometric capability probe | No biometric enrollment for this session, OS error **-7**, as defined by the installed Apple SDK | No successful signature or human-presence boundary was established |

The sandboxed credential probe first reported entries unavailable. Retrying
outside that sandbox established the results above; unavailable local access
was not misreported as a missing or invalid stored key. Keys and logins were not
changed. Two metadata requests, **zero model invocations**. Outer coding-app
usage and provider account balances remain unknown.

The diagnostic follows the official [OpenAI model-list endpoint](https://developers.openai.com/api/reference/resources/models/methods/list)
and [Anthropic model-list endpoint](https://platform.claude.com/docs/en/api/models/list).
Metadata access is narrower than a live agent authentication/convergence test.
The [sanitized prerequisite record](evidence/assistant-launch-prerequisites-2026-09-08.json)
preserves those observations and their limits without private account paths.

## Security work: primitives, not activation

New [deployment inspection](../packages/application/src/protected-deployment.ts)
describes fixed protected paths, separate non-login controller identity, pinned
executable bytes, private credentials/runtime storage and preserved evidence.
It rejects same-user identities, writable ancestors, symlinks, ambiguous ACLs,
missing measurements and recomputed hashes over altered policy. It **does not
install accounts or a daemon**, and supplies no fictional protected service
command. Its readiness result remains false.

New [decision-confirmation primitives](../packages/application/src/protected-confirmation.ts)
bind the exact controller/job/action/revision/candidate/original request, expire
within two minutes, verify two P-256 signatures and atomically claim a decision
before its guarded effect. A failed or lost response never replays a claim.
Tests use software keys and cannot establish hardware or human presence.

A small [native macOS adapter](../runtime/macos/Confirmation.swift) builds
separately from the Bun harness:

```sh
bun scripts/build-confirmation.ts
./dist/native/wringer-confirm probe
```

This is an OS-specific signing/display adapter, not another harness runtime.
Bun still runs orchestration; ACP carries work to the agent runtimes, which
execute it. The local build is
ad-hoc signed with hardened runtime for compilation/probe checks only. It is not
a Developer ID release, notarized distribution or installed controller.

Enrollment/signing refuse from the source-build location. Their guarded path
requires a root-owned exact-binary signing policy, publisher/application identity,
Keychain access-group entitlements and the protected controller public-key pin.
The designed key is generated in Secure Enclave with current-biometric-set and
private-key-use access control; there is no software-key or password fallback.
The native display does not itself originate the PM's observation: integration
must still collect and preserve the person's words and validate the domain state.

The design uses Apple's [Secure Enclave key guidance](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave)
and [LocalAuthentication guidance](https://developer.apple.com/documentation/localauthentication/logging-a-user-into-your-app-with-face-id-or-touch-id).
A locally printed enrollment JSON is not portable hardware attestation. Actual
enrollment provenance, signing identity, operating-system installation and
adversarial measurements are still required.

## Remaining launch work — not disguised as just user permission

1. **Protected service integration and deployment remain unfinished engineering.**
   Wire authenticated decisions into execution approval, source-bound human
   review and publication; provide an installed controller under a separate
   identity; prove restart/revocation/update. The current preview must not be
   installed under another username and relabelled protected.
2. **Credential/runtime isolation needs a real installation.** Moving only a copy
   of a key while the unrestricted app can read the original does not close the
   alternate-controller spending route. The current operator-owned Container
   service is not an isolated protected controller runtime. No keys, service
   identities, global permissions or biometric enrollments were changed here.
3. **The requested Codex-worker credential is rejected.** A valid authorized
   credential and finite live-test allowance are needed for that lane. A working
   Anthropic metadata response is not permission to substitute a different
   provider and call it the same test.
4. **Actual named-client/live-agent proof remains open.** A protocol fixture does
   not prove that the real coding app makes the complete journey or that workers
   converge. Freeze the candidate only after protected setup and rehearsal pass.
5. **An independent PM must make the real decisions.** A builder agent cannot
   supply an outsider's experience, biometric presence or original observation.
   Preserve first hand repair as FAIL; label any later salvage separately.
6. **Public launch remains gated.** Tags, packages, promotional claims and
   production deployment are not created merely because an engineering checkpoint
   passes tests. More clients, gVisor claims, strict cash guarantees and live
   Sigstore remain separately measured workstreams.

## Evidence

The [portable local record](evidence/assistant-launch-local-validation-2026-09-08.json)
contains the complete stage results and the 31-check rehearsal result, with no
private controller capability or machine-specific source path.

| Measurement | Observed result |
| --- | --- |
| Full macOS distribution validation | All **16 stages passed**, including native helper build/probe, compiled lifecycle, delivery and rehearsal |
| Full package test suite within that run | **576 passed, 1 skipped, 0 failed**, 5,059 assertions; the skip is the Linux-only DAC test |
| Final setup/CLI/distribution-documentation/discovery regression run | **32 passed, 0 failed**, 260 assertions |
| TypeScript check and final compiled distribution rebuild | Both passed |
| Complete scripted rehearsal | **31 checks passed**, 64.152 seconds, zero provider calls and zero credential reads |
| Literal audit from the rehearsal's fresh clone | Exit **0** |
| Literal extra-breakage measurement | **Inconclusive: real runtime unavailable**, not a pass |

The broad validation used a modified checkout based on `3aea7b7`. The final
focused tests cover subsequent maintenance-read-only, content-filter and
submodule-refusal corrections; do not attribute those final bytes to the earlier
broad run. Remote CI is the exact-commit verification after publication.

Retained unsuccessful validation attempts are part of the record. The first
sandboxed attempt had seven listener/lifecycle failures. An outside-sandbox
attempt then exposed one deployment-test expectation left at ten paths after
the signing-policy path made eleven. Its assertion was corrected, and the
subsequent complete run passed. Earlier rehearsal-development failures also
remain in local captures; none is relabelled an independent blind-test finding.

Publication and exact-commit remote CI: **pending at this commit's preparation**.
Their observed identities and outcomes will be appended after the push. These
local results do not establish a complete launch or successful independent run.
