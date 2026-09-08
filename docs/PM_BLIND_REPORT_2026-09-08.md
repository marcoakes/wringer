# PM blind test, September 8: FAIL, followed by a separate repair window

## Frozen result — alpha.3

**Blind verdict: FAIL at planning. This verdict is not changed by later fixes.**

Build: `1.0.0-alpha.3`, Bun `1.4.2`, source
`2f08ca6b4927a70e96d6c36af82ad1b02b2dafb8`.
Condition: a pre-provisioned machine and a fresh run, **not a clean-machine test**.
Observer: Claude in Claude Code, acting as PM observer and disclosing involvement
in building the product. This is weaker independence than a stranger's test.
Every actual human verdict came from Marc in chat.

The observer's full command/exit/time capture remains in the original frozen
run's `capture/blind-log.md` and `capture/01` through `capture/32` files. Those
private machine paths are not presented as portable public evidence. This page
preserves the supplied findings and distinguishes them from the subsequent
executable fixture measurements. No private provider log or credential is bundled.

### Blind phase, 08:15–08:25 UTC

Start gates passed. One planning prompt took 2 minutes 43 seconds to return a
complete, unapproved proposal wrapped in prose and a JSON fence. The reply
contained seven requirements, seven checks, seven protected paths and five real
questions. Wringer rejected the whole text as JSON. Its printed stopped retry
exceeded the grant; its next interrupted retry reparsed the same reply; those
routes formed a loop. Planning `status` could not explain the state. No hand
repair occurred before the blind verdict. Nothing after planning was reached.

### Salvage, separately labelled, ending 09:11 UTC

Four hand repairs were explicitly recorded by the observer:

1. Extract the planner's JSON fence. The resulting contract validated; the
   execution planner's prose-wrapped omissions review was then rejected too.
2. Remove that planner. The next journey correctly stopped before a worker:
   six checks were red and a regression incorrectly bound as new acceptance
   already passed. The stop did not identify the passing check or its receipt.
3. Unbind the regression from new acceptance. The Codex worker reported an
   OpenAI HTTP 401/`invalid_api_key` on four turns. Wringer treated each completed
   transport as work, captured unchanged source and bought another attempt until
   the worker allowance was gone (113 seconds). The observer independently
   reported that the stored OpenAI credential was invalid. That environmental
   fact does not excuse the controller's four-attempt retry behaviour.
4. Switch the worker to Claude ACP. One worker turn made real edits, with 17
   observed tool calls in 3 minutes 4 seconds. Independent verification passed
   six of six checks, with the regression green. Both judge replies were
   prose-wrapped JSON and were discarded. The third judge attempt was not used.

At that judge stop, the CLI ran a display and invited a verdict while the board
said display was not applicable. Marc supplied `not_met`, by `marc`, with the
exact note **“the pipeline did not work”**. Recording refused because the
journey had not reached its human hold. The note was solicited but never became
an accepted judgement record; it must not be reinterpreted as a pass. The demo's
intentional-failure explanation appeared after its reports and confused the
reviewer. Delivery preview refused correctly and the mirror was unchanged.

Revision, delivery send, fresh-clone audit and falsification were **not reached**.
Doctor correctly named the recorded journey's last verification.

### Counts, costs and limits

| Phase/journey | ACP prompts | Observed outcome |
| --- | ---: | --- |
| Blind planning | 1 | Rejected wrapped reply |
| Salvage journey 1 | 1 | Rejected execution-planner reply |
| Salvage journey 2 | 0 | Correct born-green refusal |
| Salvage journey 3 | 4 | Four worker authentication failures |
| Salvage journey 4 | 3 | Worker and two rejected judge replies |
| Total | 9 | Five reported model-served turns |

Billed cost was **unknown on every surface**, not zero. The actual models were
not recorded. Adapter context occupancy is not billed token usage. Planning
session duration was 2 minutes 33 seconds of its 300-second allowance; the
complete blind-plus-salvage wall clock was 56 minutes. The supplied report
records four human decisions and one hold.

The observer measured red-first receipts, read-only credential-free verification,
runtime provenance matching the start sheet, cleanup after stops, preserved
retry ceilings and truthful refusal of incomplete delivery. These are useful
observations, not a passed end-to-end PM experience.

An obsolete Python-era `wringer-drive` was invoked once by an observer PATH slip.
That is a disclosed environment issue, not a product-routed blind failure. The
old executable has not been deleted or silently substituted during this repair.

## Repair window — alpha.4 source checkpoint

The changes below address the existing Bun product. They do not implement the
[proposed assistant entry point](PM_ASSISTANT_ENTRY_PLAN.md), add a host fallback,
change credentials or retroactively repair the frozen test.

| Finding | Repair and regression evidence |
| --- | --- |
| F1: valid wrapped replies discarded | Shared strict-first, first-JSON-fence, first-balanced-object extraction; selected JSON is never syntax-repaired. Role validation remains separate. Parsing method, selected range and hashes are retained. The exact original planning reply produces all five questions. |
| F2/F3: impossible retries | Stop routes account for remaining role, total, verification and time allowances. A spent grant points to a read-only fresh-grant preview. An interrupted retry requires a genuinely unresolved current attempt. Existing reservations are never reset. |
| F4: questions lost | Planning status/questions and the planning board derive the full note and questions from retained reply evidence. Answers require a revised intent and explicit separate grant; no answer or human approval is invented. |
| F5: repeated rejected/no-change workers | A structured runtime authentication report stops before capture; a narrow provider-error text fallback on unchanged source also stops. Unchanged source stops before candidate verification/automatic redispatch. Diagnostic/result evidence survives. Absent ACP tool updates remain unknown, not proof of zero tool use. |
| S1/S4/S5/S6/S8/S9: board ambiguity | Name the current stage; separate checks passed from review pending; distinguish not tried from not met; use explicit accessible action labels and explain unavailable continuation. Keep original stop evidence under the plain-language explanation. |
| S7: unlocatable born-green receipt | Name the already-passing check IDs and retained evidence path, and explain the distinction between existing regression and new acceptance. |
| S10/S12: mismatched human pen | Shared eligibility for board/CLI show/review; a judge-stopped fixture cannot start a display or invite a verdict. Recheck eligibility after display, including expiry. |
| S13: intentional failures explained too late | In the maintained example, move the existing explanation before both reports. The original frozen task and Marc's negative note are untouched. The next test must disclose if it adopts this example-source change. |

Regression sources:

- [Exact planning reply and extraction tests](../packages/workflow/test/json-reply.test.ts).
- [Planning history and recovery](../packages/workflow/test/proposal-recovery.test.ts)
  and [CLI grant recovery](../packages/cli/test/planning-recovery.test.ts).
- [Worker diagnostics](../packages/workflow/test/worker-outcome.test.ts) and
  [whole-journey integration](../packages/workflow/test/contained.test.ts).
- [Shared PM guards](../packages/application/test/pm-blind-regressions.test.ts)
  and [board rendering](../packages/board/test/pm-blind-render.test.ts), including
  [read-only planning questions](../packages/board/test/pm-planning.test.ts).
- [Separate execution grants](../packages/cli/test/new-grant.test.ts).
- [Display explanation before reports](../packages/cli/test/display-preface.test.ts).

The original planning reply is 10,698 bytes, SHA-256
`3c34cd8be5d36d6be7387d07f565e454a513933151ee4f6c21849164e3402dc6`.
The fixture documents its transport newline and checks the original byte
identity. Local read-only replay of all four retained Codex results classified
them as reported authentication rejection, despite `completed/end_turn`.
This replay did not contact OpenAI, check a key, start a container or change
the old run. Runtime reports remain observations, not independent credential
attestations.

### Repair verification

The new whole-journey regressions were first observed failing (0 passed, 5
failed), then passing (5 passed, 31 assertions). The initial shared-PM regressions
likewise reproduced five failures before their fixes. Subsequent full validation
and remote CI results are recorded below when observed; no live acceptance pass
is inferred from these fixtures.

Local validation: **PASS**, 2026-09-08. All ten validation stages passed,
including strict TypeScript, frozen record compatibility, standalone build,
compiled contained CLI, local delivery and version checks. The main suite had
**427 passed, 1 skipped, 0 failed**, with 3,215 assertions. The skipped test is
the real Linux DAC check on this Mac, not a waived product failure. The compiled
binary reports `Wringer native 1.0.0-alpha.4 (Bun 1.4.2)`.

The initial sandboxed suite had 29 local-listener failures (`EADDRINUSE` on
ephemeral port 0). Those same suites passed with permission to bind localhost;
the final full validation also passed with that permission. One validation
launcher attempt failed because Bun was absent from its inherited PATH; the
absolute-runtime validation entry point then ran successfully. Neither failure
was hidden by changing product or acceptance code.

See the [portable repair-validation record](evidence/pm-blind-fixes-2026-09-08.json).
GitHub CI for the pushed source checkpoint is a separate measurement, reported
at handoff; local success is not labelled remote success. No provider prompt
was sent in this repair window. No release tag, registry publication or
deployment is authorized by this source checkpoint.

## Next blind run: still a separate measurement

1. Freeze the repaired executable, source SHA, starting pages, task and image
   only after local validation and observed remote CI. Retain alpha.3 unchanged.
2. Use the same PRD, task mirror, worker/judge choices and execution ceilings.
   Set `max_planner_turns: 2` as requested. Record the actual resulting source,
   image and authority identities; distinguish any pre-test example change.
3. A valid Codex credential supplied by Marc is a **remaining prerequisite**.
   Reuse existing stored credentials; do not repeatedly replace them, silently
   switch providers, or spend on a known rejected key. No new key check was run
   in this repair window. The observer's credential finding is not claimed fresh.
4. Use [the blind protocol](PM_BLIND_TEST.md); keep “pre-provisioned machine,
   fresh run”, never relabel it a clean-machine test. Prefer an independent PM.
5. No edits during the blind phase. Stop its verdict at the first hand repair.
   If salvage is chosen, label it and record every repair separately.
6. Measure the previously unreached human correction, handover, fresh-clone
   audit and falsification. Preserve negative human notes exactly. Record role
   counts, wall time and unknown costs. Publish the outcome even if it fails.

The next test has **not run**. Alpha.4 fixture success is not evidence that Codex
converges, the actual model can be identified, or the complete PM loop succeeds.
