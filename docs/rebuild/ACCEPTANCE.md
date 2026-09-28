# Adoption acceptance map

Candidate: 1.0.0-alpha.20, based on 7f4cc542fd1149c00a3be0ee8949c895b95ef0c3
with uncommitted implementation changes. Final machine report binds the exact
archive/binary/content digests and validation records under `build/rebuild-candidate/`.
This map names executable procedures, not a blanket pass declaration.

The integrated `bun run validate` includes contract/type/corpus checks, compiled
commands, local delivery, all existing PM rehearsals, the adoption examples,
both-mode compiled STDIO reconnect and verification/delegation browser joins.
`release.yml` additionally gates draft staging on both native targets, archive/
installer/npm/Brew measurements and the required Linux DAC job. No remote CI run
was started or claimed by local checks.

| ID | Requirement | Executable checks | Evidence classification / limit |
| --- | --- | --- | --- |
| T01 | Extracted archive and aliases | [extracted-distribution.ts](../../scripts/extracted-distribution.ts) | native artifact; exact observations in accompanying candidate report |
| T02 | Protocol-only STDIO and import safety | [import-safe.test.ts](../../packages/cli/test/import-safe.test.ts), [stdio.test.ts](../../packages/mcp/test/stdio.test.ts), [adoption-connections.ts](../../scripts/adoption-connections.ts) | deterministic + compiled STDIO |
| T03 | Owned install/change/removal and hostile archives | [installer.test.ts](../../packages/cli/test/installer.test.ts), [bootstrap.test.ts](../../packages/cli/test/bootstrap.test.ts), [installer-distribution.ts](../../scripts/installer-distribution.ts) | filesystem fixtures + native archive |
| T04 | No-provider verification setup and real checks | [verification-job.test.ts](../../packages/application/test/verification-job.test.ts), [verification-owner.test.ts](../../packages/cli/test/verification-owner.test.ts), [rebuild-examples.ts](../../scripts/rebuild-examples.ts) | actual local checks; no live coding client |
| T05 | Placeholder/empty/stale/partial evidence | [assertions.test.ts](../../packages/engine/test/assertions.test.ts), [assertion-adapter.test.ts](../../packages/runtime/test/assertion-adapter.test.ts) | real Node reports and adversarial fixtures |
| T06 | Exact source/check identity and stale delivery | [strict.test.ts](../../packages/engine/test/strict.test.ts), [verification-job.test.ts](../../packages/application/test/verification-job.test.ts), [delivery.test.ts](../../packages/delivery/test/delivery.test.ts) | real scratch Git/checks |
| T07 | Mutable proposal composition and ceilings | [proposal-composition.test.ts](../../packages/application/test/proposal-composition.test.ts) | deterministic pinned-profile composition |
| T08 | Read-only validation/setup grants no authority | [delegation-recovery.test.ts](../../packages/application/test/delegation-recovery.test.ts), [delegation-owner.test.ts](../../packages/cli/test/delegation-owner.test.ts) | filesystem/protocol observations |
| T09 | Questions/supersession/original words | [proposal-revision.test.ts](../../packages/application/test/proposal-revision.test.ts), [adoption-connections.ts](../../scripts/adoption-connections.ts) | contract + real browser join |
| T10 | Guided contained preparation; no fallback | [runtime-provisioning.test.ts](../../packages/application/test/runtime-provisioning.test.ts), [delegation-profile.test.ts](../../packages/application/test/delegation-profile.test.ts), [gvisor-provisioning.test.ts](../../packages/application/test/gvisor-provisioning.test.ts) | fixtures passed; live provisioning unavailable |
| T11 | Runtime filesystem/network/credential separation | [filesystem.test.ts](../../packages/runtime/test/filesystem.test.ts), [runtime-smoke.ts](../../scripts/runtime-smoke.ts), [runtime-smoke-local.ts](../../scripts/runtime-smoke-local.ts), [linux-dac.yml](../../.github/workflows/linux-dac.yml) | live Apple/gVisor and native Linux DAC unavailable here; no containment claim |
| T12 | Nonblocking STDIO wait/cancel/overload | [stdio-progress.test.ts](../../packages/mcp/test/stdio-progress.test.ts) | actual child STDIO protocol fixture |
| T13 | Saturated fresh observations and concurrent schemas | [assistant.test.ts](../../packages/application/test/assistant.test.ts), [reader-concurrency.test.ts](../../packages/records/test/reader-concurrency.test.ts) | controlled concurrency fixtures |
| T14 | Approve/review/correct/accept/separate Send | [rebuild-m5-browser.ts](../../scripts/rebuild-m5-browser.ts), [guided-pm-rehearsal.ts](../../scripts/guided-pm-rehearsal.ts) | real Chromium/Git, scripted decisions; synthetic delegated roles |
| T15 | Failed/missing visual output cannot accept | [verification-owner.test.ts](../../packages/cli/test/verification-owner.test.ts), [job-render.test.ts](../../packages/board/test/job-render.test.ts), [guided-pm-rehearsal.ts](../../scripts/guided-pm-rehearsal.ts) | real browser image failures plus source/display guards |
| T16 | Reload/expiry/tabs/owner/client reconnect | [workspace-recovery.test.ts](../../packages/cli/test/workspace-recovery.test.ts), [delegation-owner.test.ts](../../packages/cli/test/delegation-owner.test.ts), [adoption-connections.ts](../../scripts/adoption-connections.ts) | real killed-owner/loopback/STDIO; named-client reconnect unmeasured |
| T17 | Lost requests and uncertain effects | [verification-job.test.ts](../../packages/application/test/verification-job.test.ts), [assistant-runner.test.ts](../../packages/application/test/assistant-runner.test.ts), [verification-owner.test.ts](../../packages/cli/test/verification-owner.test.ts) | real local lost-check/Send recovery; provider uncertainty fixtures |
| T18 | New source/second job without inherited authority | [verification-job.test.ts](../../packages/application/test/verification-job.test.ts), [delegation-profile.test.ts](../../packages/application/test/delegation-profile.test.ts) | actual Git and retained lineage fixtures |
| T19 | Frozen corpus and new readers/writers | [contract.test.ts](../../packages/records/test/contract.test.ts), [adoption-records.test.ts](../../packages/application/test/adoption-records.test.ts), [delegation-contract.test.ts](../../packages/mcp/test/delegation-contract.test.ts), [verification-contract.test.ts](../../packages/mcp/test/verification-contract.test.ts) | historical bytes retained, sibling schemas generated |
| T20 | Upgrade/migration interruption/rollback | [installer.test.ts](../../packages/cli/test/installer.test.ts), [maintenance.test.ts](../../packages/application/test/maintenance.test.ts), [migration-distribution.ts](../../scripts/migration-distribution.ts) | actual archived-binary upgrade/uninstall and incompatible rollback refusal; interruption fixtures |
| T21 | Claude/Codex config preserves unrelated entries | [client-adapters.test.ts](../../packages/cli/test/client-adapters.test.ts), [rebuild-client-measure.ts](../../scripts/rebuild-client-measure.ts) | scoped fixtures; actual Codex parser; Claude unavailable |
| T22 | Untrusted text cannot gain authority | [verification-contract.test.ts](../../packages/mcp/test/verification-contract.test.ts), [delegation-contract.test.ts](../../packages/mcp/test/delegation-contract.test.ts), [assistant.test.ts](../../packages/application/test/assistant.test.ts) | strict tool allowlists/refusals; no model judgment claim |
| T23 | Redaction and unknown cost | [diagnostics.test.ts](../../packages/application/test/diagnostics.test.ts), [assistant-transport.test.ts](../../packages/cli/test/assistant-transport.test.ts), [filesystem.test.ts](../../packages/runtime/test/filesystem.test.ts) | synthetic secret/error/record fixtures; final artifact inspection separate |
| T24 | Action real statuses/partial/prove/PR permissions | [action.test.ts](../../packages/cli/test/action.test.ts), [action.mjs](../../packaging/action.mjs), [action.yml](../../action.yml) | real scratch Git checks + injected report failures |
| T25 | Fresh-clone audit and damaged evidence | [contained.test.ts](../../packages/delivery/test/contained.test.ts), [adversarial.test.ts](../../packages/delivery/test/adversarial.test.ts), [rebuild-m5-browser.ts](../../scripts/rebuild-m5-browser.ts), [guided-pm-rehearsal.ts](../../scripts/guided-pm-rehearsal.ts) | real local bare origin/audit; no hosted publication |
| T26 | Shipped README/skill/examples/CLI agree | [distribution-docs.test.ts](../../packages/cli/test/distribution-docs.test.ts), [cli-reference.ts](../../scripts/cli-reference.ts), [rebuild-examples.ts](../../scripts/rebuild-examples.ts), [channel-distribution.ts](../../scripts/channel-distribution.ts) | documentation closure + actual commands; independent newcomer unmeasured |

Isolated reversion records live in `docs/rebuild/evidence/*/reversions.json`. Each
requires an initial green control, a failing behavioral assertion for each
mutation, and restored green tests. Security/authority guards were tested without
mutating this checkout. Old failed logs are retained beside corrected results.

Required live procedures: [LIVE_ACCEPTANCE](LIVE_ACCEPTANCE.md). Required external
conditions: [EXTERNAL_ACTIONS](EXTERNAL_ACTIONS.md). Neither the presence of a
procedure nor a synthetic driver passes a real platform/client/person gate.
