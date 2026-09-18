# Reports recovery and automated engineering test — 2026-09-18

This checkpoint separates the stopped live Reports attempt from the automated
engineering measurements. Historical reservations, failed captures and timeouts
remain recorded. An interrupted worker's own passing checks did not produce an
accepted candidate, and this work does not supply Marc's visual verdict or Send.

## Repairs

Worker change capture now handles ignored output directories without passing
them to `git add` as explicit ignored pathspecs. It stages tracked replacements
before enumerating exact NUL-delimited source paths. Protected mutations remain
visible for controller rejection. Regression coverage includes additions,
deletions, literal filenames, directory-to-file/symlink replacements, ignored
outputs and out-of-scope changes.

The supported Claude ACP adapter identifies MCP calls as `other`, and its normal
permission request omits the tool name supplied in the preceding update. Design
reads now bind to the opened session's original tool-call identity and an exact
controller-installed tool name. Each design service has a fresh random namespace.
Only the existing read permission can authorize these three read-only tools;
duplicate, conflicting, completed, replayed and pre-session identities refuse.
Other tools and judge writes retain their existing restrictions.

New worker requests carry the approved time limit and recorded reservation and
timeout counts. They advise finishing required changes/checks and ending promptly.
Ordinary observation does not replay work; historical request bytes remain
immutable. These prompt changes do not enlarge a grant or prove live convergence.

## Reproduction and review

Run `bun run check`, `bun run build` and `bun run validate` using the declared
toolchain. The original-input [Reports rehearsal](native/REPORTS_REHEARSAL.md)
adds real contained role execution and browser verification to the existing
scripted operator journey. It preserves supplied requirements, component/data
bytes, original protected checks and both design PNGs. Its finite correction is
predetermined test input; every approval, verdict and local Send is visibly
attributed to the scripted fixture.

Supplementary checks cover every report's metadata and summary, case-insensitive
trimmed search, combined filters, reset, keyboard navigation, focus restoration,
back-state preservation, desktop columns and 320/390px phone layouts. The original
checks remain unchanged. The fixture source implementation is copied by a
deterministic ACP adapter inside the actual worker container; there are no model
calls or provider credentials in this test.

The fresh-clone review must check both the carried delivery audit and the checkout
identity: exact evidence HEAD, its sole code parent, source tree, and additions
restricted to that delivery's evidence directory. A valid embedded bundle alone
does not establish that the surrounding checkout is the reviewed source.

## Measurement boundaries

The local full suite passed 908 tests with 10,195 assertions; one Linux-only DAC
test was skipped on macOS. Generated records, strict TypeScript and distribution
build passed. Subsequent fixture changes have their own focused and browser
measurements; the initial full-suite count is not silently expanded to include
later tests. Detailed final results are recorded in the accompanying evidence.

All 13 selected distribution/portable validation stages and all seven browser
rehearsal stages passed. The additional clone-lineage and Reports scenario tests
passed 20 tests with 86 assertions. The original-input contained Reports run
passed 53 journey checks; its browser interaction took 282,412 ms, with four
scripted role sessions, zero provider calls and a successful literal fresh-clone
audit. Both the unchanged ten-assertion acceptance check and supplementary
five-assertion audit passed for each candidate. See the
[sanitized measurement record](evidence/reports-recovery-2026-09-18.json) for
exact source, candidate, evidence and script identities and retained failures.

The first Reports scenario stopped before execution because the outer coding
sandbox could not open its local console listener. That failed attempt is retained.
A second attempt reached real capture, passing checks and the visual hold, then
exposed a harness assertion that mistook collapsed screenshot notes for missing
output. The assertion now checks recorded note text and the source-bound display;
the successful rerun retained the original protected acceptance commands.
No target code is moved to host execution to work around containment failures.
The test's cooperative-local controller is not a demonstrated separate protected
controller identity. No live-model improvement, independent PM acceptance,
hosted publication, OS recovery or production Reports delivery is established by
scripted success. No broader live execution grant was silently created.
