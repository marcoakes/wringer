# Alpha.7 — blind test 2 repair record

Date: 2026-09-08. Author: Codex. Scope: repair the measured review, reconnect,
handover-history and setup failures; do not expand into a new product surface.

The [alpha.6 blind result](PM_BLIND_REPORT_2026-09-08_2.md) remains **FAIL** and
its salvage **INCOMPLETE**. The original evidence, working keys and test
controller were not altered. No live model call is authorized or needed by
these engineering checks.

## Changes

- The person's decision is first, with explicit unselected Yes/No choices,
  their own name and note, and the actual successfully shown result alongside.
  A missing, failed, empty or stale display cannot support acceptance.
- Console → review is one action. Reload/reopen uses an in-memory server session
  via an HttpOnly cookie; explicit lock invalidates it. The session is bounded
  and cannot renew job approval. These remain cooperative-local surfaces, not
  protection against another program running as the same OS user.
- Handover scans the exact candidate's reachable history incrementally, including
  deleted historical content. It no longer buffers the entire history in a
  generic command result or walks unrelated/private delivery refs. Secret
  detection, finite resource limits and refusal remain enforced.
- Delivery failures point to the same retained run's status. An uncertain send
  is never permission to replay publication.
- Setup diagnoses an existing controller directory's ownership and 0700 mode
  consistently with initialization, without changing its permissions.
- The long-key interactive-system-prompt recipe is withdrawn. No working key
  was re-entered, replaced, printed or sent to a provider during this repair.

## Measurement design

`bun run validate` now runs pinned Chromium against the real local console and
PM workspace. The browser actually fills/submits approval, selects No, supplies
an original fixture note, waits for correction, selects Yes, prepares the same
handover again and separately confirms send. It checks console/review reload,
failed-show refusal, empty/stale decision reset, desktop/mobile layout and
logout. It does not inject a value through a fake form.

Source commits, journals, command identities, the local bare origin, delivery
bundle and fresh-clone audit are real. Worker/judge responses, verification
observations and display contents remain explicitly synthetic. Every browser
decision is labelled **SCRIPTED TEST FIXTURE**, not a human verdict. The carried
breakage command is executed without its fixture runtime and must report
**inconclusive**, not pass. Exact observed results follow below.

The large-history regression carries over 64 MiB of inflated, historical source
which is absent from the current tree. Separate tests exercise secrets across
stream boundaries, deleted secrets, unrelated refs, malformed/truncated output,
strict size/count/time limits and cancellation. These tests do not assert that
arbitrary history is safe, or that secret heuristics detect every secret.

## Observed local validation

Full macOS validation completed 2026-09-08, 21:09 UTC. Retained local record:
`.wringer/native-validation-2026-09-08T21-00-54-472Z/`.

- All **16 validation stages passed**: frozen dependency links, build, native
  confirmation build and non-enrolling capability probe, assistant checks,
  complete native checks, historical portable corpus, compiled contracts,
  local delivery, public entrypoints, owner lifecycle and browser rehearsal.
- Native suite: **604 passed, 0 failed, 1 skipped**, 6,189 assertions across
  64 files. The skip is Linux-specific filesystem enforcement, not a hidden
  browser skip or a macOS containment claim.
- Browser rehearsal: **37 checks passed** in 103,739 ms. Fresh-clone carried
  audit exited 0. Separate literal breakage command exited 3 as expected and
  recorded **inconclusive: fixture runtime unavailable**.
- Browser artifact record:
  `assistant-launch-rehearsal-1856167f-9243-407a-80f8-1cc0fb1e48e6`.
  Script SHA-256 `154050913484196728511f41e9268203dac4329126b7a44975a31c95247b67dd`;
  browser helper `b76d07831d7e4f0efd955f063bb31ee309ff1f4310e7260ed13b0c5375f319b6`;
  compiled audit binary `312c86f3ec18a1ff8889fa57b86fcc01df10a8689931da975a6b46fb8585548c`.
  It identifies a **modified worktree based on alpha.6**, not a clean frozen
  release. CI must independently identify the published repair commit.
- The large-history test passed interruption after bundle copy, retry,
  deterministic repeat preparation, send to a local bare origin, and every
  audit claim from a fresh clone. It used two 40 MiB deleted historical files.
- Zero provider calls or credential-store reads in the rehearsals. Four role
  sessions and all personal decisions in the browser fixture are synthetic;
  both billing lanes stay unknown. Desktop/mobile screenshots were inspected.

Earlier development attempts are retained separately: the managed sandbox
refused loopback binding; an intermediate test-only TypeScript declaration
failed validation and was corrected before this complete pass. They are not
the frozen live test and have not been erased or described as successes.

## Remaining release gates

**The same full-history blind profile is not ready to rerun unchanged.** A
read-only scan of the actual Wringer history at
`fbb8bb0abdbd191a7aaf7cd56673b560f45e9af9` got beyond the buffer-overflow defect
and refused `source-secret`. A bounded diagnostic located the first match in
object 966, blob `5f66304907a31935789980882f9bff04f944496a`,
`docs/bench-vendors-2026-08-22.md:151`. It is an explicitly dummy/not-real key in
an old authentication probe, **not evidence here of a live leaked credential**.
The old scanner's policy also matched it; the 64 MiB overflow had masked this
next stop. No credential value was printed by this diagnostic.

The placeholder is in the tip and its ancestry. Editing the current document
would not remove it from the exact history carried for audit. This repair does
not rewrite historical evidence, silently ignore credential-shaped content or
add an agent-controlled exemption. Resolving known dummy fixtures requires a
separately designed, explicitly authorized exception policy bound to exact
source and recorded reason, or a transparently different clean-source test
condition. Neither can be hidden inside a claimed pass of the original profile.

The next live PM test must independently demonstrate the repaired experience
and reach actual handover, fresh-clone audit and a measured breakage test. This
pass cannot establish independent outsider installation, protected-mode human
presence, a new execution image, provider billing, Sigstore identity, live
gVisor containment, or reliable convergence on arbitrary work. No such claim
is added to the front door.
