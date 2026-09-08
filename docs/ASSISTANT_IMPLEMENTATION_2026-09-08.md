# Assistant-led Wringer — alpha.5 implementation and evidence

Date: 2026-09-08. Implementation authorized by Marc Oakes, on the existing main
line. Base: `b02a55dbdab352811b5fa0998a3b9468a3b6d0a1` (alpha.4).

## Outcome

The assistant entry point is implemented as a **cooperative-local engineering
preview**, not a protected production launch. The coding app can submit an
inert proposal, start an exactly approved job, inspect progress/evidence,
request a bounded correction, cancel work and prepare a selected handover.
The original [alpha.3 blind FAIL](PM_BLIND_REPORT_2026-09-08.md) is unchanged.

Start at [ASSISTANT_START.md](../ASSISTANT_START.md). The PM's request, assumptions,
questions, requirements and execution ceilings appear in the private operator
console. The established PM workspace remains the place for source-bound display,
human observation and a separate publication decision.

This does **not** complete every launch gate in the
[implementation plan](PM_ASSISTANT_ENTRY_PLAN.md). An unrestricted same-user
coding app is not isolated from its operator; protected mode refuses rather
than presenting a token or checkbox as an OS security boundary. A real
independent PM journey and a protected outsider installation remain unmeasured.

## What changed

| Surface | Implemented behavior |
| --- | --- |
| `wringer-assistant` | One source-built executable: initialize, start/serve, status, connect, MCP, stop, recover, reconcile and revoke |
| MCP adapter | Ten bounded tools; strict JSON/schema/lifecycle validation; supported protocol versions `2025-11-25` and `2025-06-18`; no model loop |
| Application service | Opaque workspace/job handles; pinned source/runtime/profile; inert exact-word proposals; separate fixed execution approval; current revision/candidate checks |
| Durable owner | Persist-before-ack requests; duplicate request observation; independent process; cancellation; dead-owner recovery; no automatic replay of claimed effects |
| Reconciliation | Operator-only observation of a validated terminal domain outcome; original uncertainty and reservations retained; no user-asserted success or new model call |
| PM decisions | Separate operator bearer, plain-language next step, explicit execution approval, existing human pen and handover workflow; no assistant approval/publication tool |
| Shared facts | Assistant and board requirements use one application projector; passing checks, independent review, human acceptance and delivered state remain separate |
| Usage | Coding-app usage unknown to Wringer; managed session/time ceilings preserved across correction and restart; absent billing remains unknown; strict-cash requests refuse |
| Connection | Read-only Codex configuration diagnosis and an exact per-server recipe; optional automatic approval limited to the ten restricted tools; no global permission changes |
| Starting pages | Assistant proposition at the top of README and PM guide; preserved original banner and contribution credits; installation, recovery and limitations linked together |

MCP is the outer interface. ACP still carries work to separate agent runtimes.
The Bun CLI remains the control plane; workers and judges retain the existing
contained execution path. No second harness, Python fallback or direct model API
loop was introduced.

## Verification record

The complete local validation at `2026-09-08T15:24:55.258Z` passed **all 13 stages**:
**523 tests passed, one Linux-only test skipped, zero failed**, with 4,635
assertions. The assistant-specific subset separately passed 95 tests with 1,411
assertions; it overlaps the full suite and is not added to its count. The stages
also passed standalone builds, compiled command contracts, the contained
distribution fixture, local delivery/audit fixture and compiled assistant
connection lifecycle. The [portable record](evidence/assistant-entry-2026-09-08.json)
contains exact stage timings and log digests. Raw local logs are retained, not
presented as publicly available merely because their digests are carried.

After correcting documentation packaging, a second validation at
`2026-09-08T15:37:48.007Z` passed the expanded assistant/documentation subset:
**101 tests, 1,451 assertions, no failures**, plus the standalone build,
standalone contract, compiled contained contract and compiled assistant
lifecycle. Its six new packaging tests are distinct from the earlier full suite;
the remaining 95 overlap. TypeScript also passed after this change.

The built reference bundle carries **63 files and 185 resolvable local links**.
Ten historical private/local evidence links are explicitly marked as omitted,
not silently copied. `DOCS.md` explains where source-build commands run, and
`DOCUMENTATION.json` carries file digests and named omissions. Earlier flattened
guide locations remain redirects to the maintained source-relative pages.

Local fixtures do not establish live provider, containment or genuine
human-presence claims. Remote CI measures the eventual pushed commit separately.

### First remote checkpoint and build-order regression

Commit `a26fdcc21cae1f71cf9af0f6e115828aa809009f` was pushed to main with Codex
authorship. Its [first remote run](https://github.com/marcoakes/wringer/actions/runs/34246330391)
passed the full Linux and macOS validation jobs but **failed the separate
GitHub Action job**. The failure is retained, not labelled a clean release.

The Action builds before checking. Documentation carried referenced source
tests under `dist/packages`, and `bun test packages` interpreted its argument as
a path-substring filter. It discovered those incomplete reference copies too:
528 passes, two skips, ten failures (including nine missing-module errors).
The original validation order had checked before building, so it missed this.

The correction explicitly targets `./packages`, makes executable source
references inert text copies, and checks with a built distribution already
present. Dedicated regressions preserve the failing discovery control and
verify the exact package root, reference-link mapping and safe migration of
previously generated copies. Follow-up results are separate from the failed
first run.

Corrective local validation at `2026-09-08T16:56:04.139Z` passed the build-first
distribution, **105 focused tests with 1,529 assertions**, and the compiled
assistant lifecycle. The 63-file, 185-link documentation bundle still resolves.
Old executable reference copies were removed only when the prior generated
manifest and exact file hashes matched; their source originals remain intact.
The correction does not skip failing package tests or turn the first CI run
green retrospectively. Its exact pushed commit must receive its own remote
checks.

- First full validation: **515 passed, 1 skipped, 5 failed**. All five failures
  were new console fixtures passing macOS's symlinked temporary-directory alias
  into a deliberately non-symlink controller boundary. The fixtures now use
  the measured real directory; the product's symlink refusal was retained.
- Subsequent focused validation: assistant checks, standalone build, compiled
  assistant help and compiled assistant lifecycle all passed. The compiled
  fixture measured independent owner startup, MCP disconnect/reconnect, duplicate
  startup, unapproved-start refusal, separate operator access, explicit restart,
  unchanged proposal/usage and revocation. It made **zero paid calls**, approved
  **zero jobs**, and used a fixture MCP client—not Codex as a real PM front end.
- A hostile-working-directory control reproduced automatic Bun preload and
  dotenv loading. The source launcher now explicitly disables those paths,
  macros and automatic installation; the compiled build disables configuration
  and dotenv autoloading. The regression tests both the control and hardened path.
- Real contained-journal integration tests use explicitly synthetic role/source/
  verifier observations. They exercise human hold, correction with the original
  aggregate ceiling, a single provider-rejection reservation, exact planner
  questions/notes and evidence-derived versus refused reconciliation.

Additional adversarial review corrected false shutdown completion, expired
approval wording, corrupt lifecycle-marker interpretation and missing ancestor
directory synchronization. Read failures refuse; they do not become an invented
start, cancellation, approval or successful build.

Local housekeeping also found four retired Python packages in the existing
build folder (`wringer-0.1.0` and `wringer-0.2.0`, each wheel and source archive).
They were moved to the private `.wringer/retired-python-dist-20260908` archive
with unchanged SHA-256 digests. Nothing was deleted; they remain recoverable
and are no longer mixed with this Bun build. They are not public evidence.

## What remains open

1. **Protected delegation:** separately enforced controller identity and a
   demonstrated human-confirmation boundary. Same-user file permissions and
   secret links alone do not meet this gate.
2. **Outsider setup:** a real pinned contained profile/runtime still needs an
   operator. This is not a no-technical-setup claim.
3. **Real client PM evaluation:** exact client/version, genuine PM decisions,
   live contained work, correction, handover and literal fresh-clone audit under
   the [new frozen protocol](PM_ASSISTANT_BLIND_TEST.md). A fixture is not that run.
4. **Live credentials and platforms:** no provider keys were changed or tested
   through paid prompts in this implementation window. Existing live platform
   gates remain independent of protocol and manifest tests.
5. **Public launch:** no package/tag/image release, external GitHub About/topics
   change or named-client support announcement was made. Marketing on the repo
   describes the preview and places limitations beside its entry point.

Strict-money mode is deliberately unavailable, not a launch promise. Sleep and
reboot consume time/expiry but no automatic OS login service is installed. The
actual account owner/administrator remains outside the tamper-resistance claim.

## Costs and authority

Wringer-managed live model calls during these fixtures: **0**. The coding app
used to implement the change has separate account usage; its bill was not
measured here and is not reported as free. Test-worker and test-human inputs are
labelled synthetic. No real human verdict, live-agent convergence or protected
mode acceptance is manufactured from them.

Official OpenAI documentation informed the Codex-only connection recipe and its
per-server tool permissions. This is configuration guidance, not client
compatibility evidence. See the
[official MCP connection documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
and the [compatibility ledger](ASSISTANT_COMPATIBILITY.md).
