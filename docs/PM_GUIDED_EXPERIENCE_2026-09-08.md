# Guided PM experience — engineering checkpoint

Started: 2026-09-08; completed measurements continued 2026-09-09.

Target: 1.0.0-alpha.8.
Status: alpha.8 implementation with passing local engineering measurements.
Independent PM and live-provider completion remain unmeasured.

This records the next implementation after [blind test 2](PM_BLIND_REPORT_2026-09-08_2.md)
and its [alpha.7 repairs](PM_BLIND2_REPAIR_2026-09-08.md). Neither historical
FAIL becomes a PASS. A scripted builder-operated browser journey is engineering
evidence, not an independent PM's verdict or a live-provider success claim.

## The PM flow

The entry point remains [ASSISTANT_START.md](../ASSISTANT_START.md). After the
one-time operator setup, the PM describes work in a connected coding app and
uses one private job page for its decisions:

1. Read the original request, requirements, unanswered questions, assumptions,
   pinned source, scope and finite session/time limits. Enter a name once and
   explicitly approve this work. Approval starts eligible work automatically.
2. Follow progress on the same page. Wringer runs the declared display and shows
   its actual recorded text output when a human requirement needs judgement.
3. Inspect that result and choose **Yes, this is right**, or **Request correction**
   with an actual description of what should change. Yes does not require an
   invented note: the explicit decision and an optional authored comment are
   separate facts. A changed candidate requires a fresh decision.
4. After acceptance, eligible handover preparation happens without another
   routine click. Inspect the already selected remote and review branch, then
   separately choose **Send this reviewed change**. No automatic publication.
5. Read the recorded handover and copy its fresh-clone audit instructions. Show
   a public review-request link only when publication actually recorded one.

The direct operator CLI and legacy workspace remain available. Their explicit
show/preparation commands are not extra steps in the new guided page.

## Implemented safeguards and limits

- Each decision binds the current semantic revision, candidate and exact set
  of successfully displayed required human requirements. Failed, missing, stale
  or empty displays do not enable acceptance. Dynamic report content is plain
  text, never trusted agent HTML.
- The controller schedules only eligible start, declared showing and preparation
  under existing authority. Refreshing, reconnecting and correction do not
  renew approval, reset usage or authorize sending. Uncertain work is not
  automatically retried. Eligible recorded failed local steps offer a bounded,
  explicit retry rather than a general replay button.
- Browser access uses a finite local cookie session. The initial private
  capability is removed from the visible URL and not placed in browser storage.
  Lock hides the page and ends that browser session; it does not cancel the
  job or erase its evidence. A late response cannot unlock the page.
- Notification is opt-in browser functionality while the page remains open.
  Messages contain no project content or private capability. This is not native
  coding-app push, an always-on notification service or a wake-from-sleep claim.
- `wringer.wait_for_update` offers read-only waits of 0–25 seconds for a
  meaningful event. It is a bounded MCP tool, not an MCP protocol notification.
  It does not call a development model; the assistant still uses its own
  account for the surrounding conversation.
- Coding-app and managed-development billing are distinct. Missing usage is
  unknown, not zero. Session/time ceilings are not an invoice ceiling;
  unsupported strict cash guarantees still refuse.

## What this does not establish

Cooperative-local remains explicit. Another unrestricted program under the
same OS account can bypass the narrow assistant tool boundary. Entering a name
does not prove human presence. Protected service identity and human enrollment
are still unavailable; protected mode refuses.

A real contained profile, pinned source and destination still require operator
setup. This is not an unassisted outsider installation, automatic selection of
every future branch, or evidence that every named coding app works. Runtime,
provider and platform claims retain their separate measurements in the
[compatibility record](ASSISTANT_COMPATIBILITY.md).

The display is recorded command output, not a live embedded application. A
public review-request link is not a hosted audit service. Sending does not mean
merged or deployed, and showing audit instructions does not establish a passed
audit. A fresh-clone audit must actually run against its carried bundle.

Source inspection can still refuse handover. This checkpoint does not globally
approve historical credential-shaped findings, remove them from the source, or
claim the original blocked handover succeeded. Any supported exception needs
its own narrow, recorded, candidate-bound operator decision; it cannot be
inferred from a PM accepting the result.

The new operator `wringer-drive source-review --state DIRECTORY` route inventories
exact object/matching-byte digests without printing the matching values. A review
requires a candidate-bound inventory, each selected finding ID, recorded actor
kind and an individual reason in a private directory outside the target source
and controller. Finite batches are explicit lists, not approve-all or path
exclusions. Configured controller secret values and fragments remain
non-overridable. The carried exception receipt is checked again from the bundle;
removing its declaration does not make the underlying source findings disappear.
Identity and harmlessness remain operator assertions, not cryptographic proof.

A read-only scan of the original pinned `fbb8bb0abdbd191a7aaf7cd56673b560f45e9af9`
history measured 7,763 objects / 147,382,614 inflated bytes, with 325 exact
findings and 31 distinct matching-byte digests. **None were approved.** This is
not a finding of 325 live secrets, nor a classification of every match as dummy.
The safe inventory digest was
`0e6adbaa91661208679a0904de111c12be759d53c79cfaec5919fd9863adad30`.
That inventory is not transferable to a different candidate commit.

## Failures found while building this checkpoint

- A sandboxed browser launch could not bind loopback; the same local test was
  rerun with the host's explicit execution permission. No product workaround.
- The first guided browser run stopped because a correction only recorded No
  and required another submit. Correction now waits for that exact No and its
  command ownership to finish, then dispatches the original note once within
  the retained allowance. A concurrent source change refuses follow-on work.
- Adversarial tests found shutdown admission races, a JavaScript caller that
  could select a non-routine owner operation, and a non-string wait cursor.
  Each now refuses, with regression tests.
- Reopening an uncertain Send initially offered Send again. The exact retained
  send command now produces a non-retryable stop instead.
- Protocol-list tests still expected ten tools after the read-only wait tool
  was added; both were corrected to eleven. The wait's client/server deadlines
  were also aligned with its declared 25-second maximum.
- The portable exception audit now derives disclosure requirements from the
  carried source even if the sender removes the declaration and consistently
  regenerates all dependent views and digests. The adversarial omission test
  passed (1 test / 23 assertions, 40.41 seconds).

Failed local captures remain distinct from later passes. No credential repair,
history rewrite, provider API call or change to the frozen blind runs was made.

The first pushed checkpoint, `015897576d6f33e363178a219cda929dabfdd121`,
encountered a Linux CI test-ordering failure in
[run 34320104555](https://github.com/marcoakes/wringer/actions/runs/34320104555).
The reconciliation test saw the immutable terminal outcome before the runner's
`finally` had cleared its active operation. Production correctly refused to
reconcile that still-active operation. The follow-up changes only the tests:
they wait for both the retained outcome and recorded inactive state. No
production guard was removed, and the failed CI record remains available.
Both reconciliation tests then passed 20 repetitions each: 40 passes,
200 assertions, no failures.

## Validation and publication ledger

Local validation record: `native-validation-2026-09-09T05-58-05-388Z`.
All 17 stages exited 0 without a timeout. It includes the legacy browser
journey (103.655 seconds) and guided journey (99.518 seconds), compiled
distribution contracts, local delivery, and portability checks. The full
package suite recorded 644 passed / 1 platform-specific skip / 0 failed,
7,708 assertions across 70 files. Subsequent source-disclosure and transport
hardening have separate focused measurements below; these counts are not
silently increased to include later checks.

The guided record `assistant-launch-rehearsal-1390b287-04a0-46ec-9774-950b7b187646`
passed 21 assertions, with 96.364 seconds of scripted browser interaction.
Its four PM decision submissions were approve, correction, decision and send.
It also submitted an intentionally invented display ID and observed an HTTP
409 without a recorded Yes. Four synthetic role sessions, zero provider calls,
zero credential reads; this is not a live model runtime benchmark.

That fixture delivered `contained-e28f6ef3c23945679c6a2e2e`, code commit
`35f0b9974dba01ee674f8762db568cdfdad551d7`, evidence commit
`c4630641f1f5bed7f239ae829f955234365f88d7` to its own local bare origin.
The audit as printed exited 0 from a fresh clone. Certificate, board and
documents agreed on the real decision attribution and null comment. The
printed extra breakage test exited 3 and explicitly reported unavailable
fixture runtime, not a fabricated pass. Browser scripts reported no errors;
390-pixel mobile layout had no horizontal overflow.

Exact script and compiled-audit hashes, commands, outcomes, original scripted
notes and screenshots are retained in the fixture records. CI uploads the
sanitized transcript, result, guided result and screenshots for each platform;
it does not upload private controller connections or browser traces.

| Measurement | Current record |
| --- | --- |
| Focused model/renderer and controller tests | Board: 63 tests / 547 assertions; correction, cancellation, shutdown and uncertain-send regressions pass |
| Actual Chromium guided approval → result → correction → Yes → Send journey | Pass, 21 checks; scripted engineering proof only |
| Optional decision/comment contract and old-record compatibility | Additive human-decision/v3 delivery contracts; domain-to-delivery audit and legacy journey pass |
| Fresh-clone delivery audit and source-inspection behavior | Both carried audit paths pass; exception-omission adversarial test: 1 pass / 23 assertions |
| Full repository validation and distribution build | 17/17 stages pass; final transport rerun: 111 tests / 1,611 assertions, including a real 17-second wait |
| Implementation and remote provenance | Source identity comes from this change's Git commit and its attached GitHub Actions checks; local results alone do not claim remote success |
| Independent PM on the frozen guided build | Not run / not claimed |
| Complete live-provider journey through the guided page | Not run / not claimed |
| Protected assistant boundary and human-presence enrollment | Unavailable / not claimed |

Reproduce with `bun scripts/validate.ts`. The focused connection rerun was
`bun scripts/validate.ts assistant-check`, record
`native-validation-2026-09-09T06-34-01-892Z` (exit 0, 28.627 seconds).
The new delivery-schema hash is frozen alongside the historical versions.

Final compiled rebuild and guided rerun:
`native-validation-2026-09-09T06-36-41-323Z`, both stages exit 0.
The guided stage took 100.650 seconds (97.630 seconds of scripted browser
interaction), again passed 21 checks, and audited a fresh clone successfully.
Fixture `assistant-launch-rehearsal-e1f89c10-ce59-4262-b28d-d30f9267a2d8`:
delivery `contained-a85c07bc98d0f3f3013d38ad`, code commit
`638c9669475d37a10eb508fce10103a263b0f4ad`, evidence commit
`b8cec72b9bd48277b2c50e3be2254ea55695b466`.
Compiled audit SHA256:
`621e4fd4fd73490ba6312376814330f73e5aeff2c66d482006b61eb531972b48`.
Final desktop and mobile screenshots were visually inspected. The release
workflow now installs the same pinned test browser before validation; no
release workflow was dispatched and no public release is claimed.

Do not publish controller connections, private page links,
cookies, credential values or raw browser traces. The next PM test starts from
the frozen build and [assistant test protocol](PM_ASSISTANT_BLIND_TEST.md), not
from this builder's expected outcome.
