# Adoption rebuild status

Started 26 September 2026 against `7f4cc542fd1149c00a3be0ee8949c895b95ef0c3`
(`1.0.0-alpha.19`), clean `main`. Requirements: Marc's supplied **Wringer
rebuild.md**, dated 26 September 2026, M0–M11 and T01–T26.

Marc subsequently selected one continuous run, without milestone pauses.
Automated engineering review is labelled as such; it is not a recorded human
judgment. No fleets or model calls. On 28 September Marc requested completion and
publication on this repository, authorizing commit, push, native CI, tagging and
GitHub prerelease publication. The refreshed GitHub login was verified. Accounts,
keys, provider spending and privileged services retain their separate boundaries.

Publication update: all six push jobs passed at7e1dd64783b68aaec1e2348ebb44fc5e82eb7184.
The subsequent alpha20 release builds exposed an OIDC redaction defect before
packaging; its tag stays unchanged and no draft was created. The repaired release
candidate is alpha21. [Publication qualification](CI_PUBLICATION.md) retains each
failed run, its deterministic reproduction, guarded repair and later observations.

| Milestone | Implemented result | Engineering evidence / boundary |
| --- | --- | --- |
| M0 | Bounded nonblocking STDIO, single writer, fresh saturated observation | Seven isolated faults caught; contract/concurrency checks pass |
| M1 | One native executable, aliases, import-safe modules, exact manifest | Compiled routes and protocol checks pass; final archive report accompanies candidate |
| M2 | Verification setup/jobs, finite source/check-bound grants, review and separate Send | Real local check/Git/owner fixtures; canonical MCP requests and default CLI creation repaired during integration |
| M3 | Pinned provisioning, runtime inventory/readiness, role/model selection, protected acceptance preparation | Deterministic fixtures and no-fallback guards pass; real Apple/gVisor execution unavailable without external prerequisites |
| M4 | Typed mutable proposals, questions, supersession, versioned protocol and content-bound paging | Composition, source/destination/authority and recovery contracts pass |
| M5 | Shared mode-labelled review page, correction, Stop, fresh displays, separate Send and optional notifications | Chromium verification and six PM rehearsals pass; synthetic roles/decisions are not live human acceptance |
| M6 | Dead ownership, uncertain outcomes, lost Send, private diagnostics, bounded history/storage and migration | Killed-owner, OS-lock and real local Git recovery fixtures pass; archive migration retains unapproved work; uncertainty never replays automatically |
| M7 | Shared skill, scoped Claude/Codex configuration transactions, explicit tool selection, compiled STDIO probe | Actual Codex config parser and both-mode compiled reconnect measured; Claude/live named-client journeys remain unavailable |
| M8 | Owned installer, archive verifier, npm/Brew/Action/registry and native image/draft workflows | Installer/Action/channel/image/publication guard fixtures pass; final artifact reports bind exact native archive; no public channel claim |
| M9 | Current guides, generated CLI reference, support/templates, three examples, historical/reference inventory | Documentation closure passes; 18 real example observations include default CLI job creation; advanced legacy guidance retained |
| M10 | T01–T26 map and integrated acceptance procedures | Full suite1162 pass/1 explicit Linux skip/0fail; compiled core and all rehearsals pass; final repairs get affected checks |
| M11 | Alpha21 source and release preparation, notes, metadata and exact packaging/claim procedures | Earlier alpha20 local archive measurements remain in `build/rebuild-candidate/REPORT.json`; exact native CI and GitHub publication proceed separately |

The final accompanying [implementation report](IMPLEMENTATION_REPORT.md) separates
source implementation, available-host engineering, live acceptance and publication.
The machine report under `build/rebuild-candidate/` is authoritative for exact final
artifact identity and result coverage; its absence/failure is not a pass.

Retained integrated failures: the first suite found10 issues, mainly restored
advanced-guide assertions and the redundant MCP job ID; the second suite passed
but the local-source route found a missing legacy guide command. Packaging then
caught the optional native helper being added after manifest sealing. An actual
archive migration found default CLI job creation included undefined fields. All
have red/green records and behavior fixes; code guards were reverted only in
isolated checkouts. Native helper output now lives outside the release directory.

## External prerequisites

| Item | State | Prepared next action |
| --- | --- | --- |
| macOS arm64 | CLI/verification fixtures measured; Apple CLI 1.3.1 installed but service stopped and not registered | Prepare reviewed provisioning transaction before any service start |
| Linux x64 / gVisor | Not measured in this run | Retain executable CI/platform procedures; do not claim live support |
| Claude Code / Codex | Claude absent; Codex CLI0.153.4 accepted scoped config; no named-client live journey measured | Compiled both-mode probes pass; external client installation/login/live allowance separate |
| Provider use | No model calls authorized | Deterministic engineering procedures implemented; live test needs finite allowance |
| Human acceptance | Automated review authorized; no personal decision fabricated | Present actual candidate for any real human decision |
| Package namespaces / registries | Ownership unverified | Prepare packages locally; verify ownership before publication |
| GitHub prerelease | Publication authorized on2026-09-28; login repaired; alpha20 source passed push CI but release builds failed before packaging | Keep alpha20 tag unchanged; qualify alpha21 through full push/release CI, then publish and independently fetch exact bytes |

Engineering implementation, available-host validation, live acceptance, and public
release remain separate axes. Local checks are not CI. At this pre-push checkpoint,
no remote job is represented as green. The release workflow and attached claims
record the subsequent exact source/artifact qualification; the local report
remains a dated observation of its dirty-source archive.
