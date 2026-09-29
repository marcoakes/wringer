# Restoration execution record

Started 29 September 2026 from `69f0f304153560861a7f0ecf671eb564f7dae082`
(`1.0.0-alpha.23`). The user authorised implementing and publishing the complete
plan, with routine implementation decisions handled autonomously. Earlier
no-model-call/no-fleet constraints remain; fixture work makes no efficacy claim.

| Phase | State | Release / evidence |
| --- | --- | --- |
| 1. Loops and portable evidence | alpha.24 implemented; release qualification underway | Local core and 26 reversion checks passed; browser suite/remote CI/publication pending |
| 2. Improvement workflow | Pending phase 1 release | — |
| 3. Serial graphs | Pending | — |
| 4. Parallel branches/integration | Pending | — |
| 5. Gate/workflow improvement | Pending | — |
| 6. Tournament/prosecutor | Pending | — |
| 7. Temporal durability | Pending | — |
| 8. Platform interfaces | Pending | — |
| 9. Comparative qualification | Pending; live and independent observations need their actual prerequisites | — |

## Phase 1 measurements

- The original job page already had a collapsed engineering history. Its public
  workspace CLI/MCP routes lacked direct loop inspection.
- Initial loop tests: 19 passed, 3 failed on the missing reader/tool. After the
  shared reader and surfaces: 49 passed across workflow, protocol and page tests.
- The first page test used an undeclared test import and failed to load. That is
  retained as a measurement error, not red-first behavior evidence. The corrected
  test then failed on the unsupported new page record, before implementation.
- The first export measurement exceeded the default five-second test limit.
  A bounded diagnostic run reached the missing delivery-ID assertion after
  19.54 seconds. The export test now has a 120-second whole-test limit for its
  multiple complete source/copy/negative audits; final duration is still pending.
- Local logs are retained under `build/restoration/phase-1/`. Release evidence
  will record final checks, individual revert-red-watch results, CI jobs and hashes.
- All 26 isolated revert-red-watch cases caught the intended behavior change;
  every individual restoration and the final control passed. See the
  [result record](evidence/phase-1/reversions.json),
  [control](evidence/phase-1/isolated-control.log) and
  [restored control](evidence/phase-1/restored-green.log). The mutation script
  records each exact source edit and targeted command.
- Packaged local rehearsals passed five loop histories and four export/reader
  checks with zero provider calls. These are deterministic engineering fixtures,
  not live containment or human acceptance measurements.
- An explicit failed-role probe exposed a private controller path in the stop
  display. Its red-first case failed; display-only scrubbing fixed it, and its
  own isolated reversion caught the leak again before passing after restoration.
- The first full check observed 1,188 pass, one Linux-only skip and one failure:
  an older construction fixture mutated a plan while retaining its old digests.
  Recompiling that fixture preserves the new reader's strict validation; all 12
  affected PM tests then passed. The following full native check passed 1,189
  tests, skipped the Linux-only DAC probe, and failed none. All 25 local core
  stages passed; see the [local validation record](evidence/phase-1/local-validation.json)
  for the exact coverage and late-change qualification limit.
- A subsequent real workspace probe found that a question-only request could
  display its template as a compiled job plan. CLI and MCP now require the job's
  actual plan; the six route tests passed and both individual fallback reversions
  were detected. Before execution, the actual plan remains inspectable with
  unknown measurements rather than invented zero usage.
- The first design-browser rehearsal failed its old collapsed-history assertion.
  The new contract requires history open by default, with the same available
  human decision. The updated full browser group is being observed.

The local core run started before the final job-plan route correction. Final
commit-level CI, release/tag jobs and public artifact verification must pass
before phase 2. Local measurements alone never make this phase released.

Historical failures are preserved. This file must not be promoted to completed
until each phase's actual implementation and release gates have been observed.
