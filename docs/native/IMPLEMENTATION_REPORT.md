# Native Wringer rewrite — implementation and verification report

> Historical snapshot of the first `1.0.0-alpha.1` rewrite, before the root-workspace replacement and mandatory isolated ACP execution path. Installation commands, local paths, runtime claims and preserved-source statements below describe that earlier state, not current setup. Start with the repository's current README or the shipped [guide](README.md).

Date: 6 September 2026. Version: `1.0.0-alpha.1`.

## Outcome

Wringer now has an independent Bun/TypeScript runtime, not a wrapper around the
Python implementation. It includes the verification engine, bounded coding loop,
drafting and PM journey, review board and pen, portable delivery/audit/falsification,
graph and fleet orchestration, benchmark, historical health and command surfaces.
The standalone executable embeds the unchanged frozen schemas and runs without
Python or an installed Bun runtime. Declared checks and workers still need their
own tools.

This is an implemented and locally tested **native prerelease**, not a claim of
production readiness, complete legacy-policy parity, or a passed clean-machine
live-model test. The original Python source and 63 frozen schema files are
unchanged. The published package, installed `wring`, saved login and Keychain
items have not been replaced. No public release or remote forge publication was
performed. Test deliveries push only to newly created local bare origins.

## What changed in the experience

The PM can authorize routine actions and budgets once, then resume the same
journey without approving every routine decision. Paid drafting sections are
cached separately. A validation repair reuses valid sections; an unknown spend
outcome is never silently retried. Source quotes, paragraph dispositions,
requirement identities and approvals are checked before work proceeds.
Worker turns are reserved before execution and charged across plan revisions;
an unknown outcome consumes the reservation rather than granting a fresh budget.

A passing check does not mean every requirement is proved. Human judgement stays
separate, uses a successful display receipt, and preserves the person's exact
note. A failed or missing display refuses to record by default. The explicit
independent-inspection route carries the display failure beside the note.

Delivery uses an isolated index, preserving the operator's checkout and staging
area. The code commit and evidence commit are separate, explicitly named facts.
The bundle carries its passing run and red receipts. Audit and falsification do
not need the original workstation or its historic `.wringer` directory.

## Run 5B findings addressed

| Original finding | Native response and test boundary |
| --- | --- |
| F1: first refusal supplied no command | Stops carry a repository-correct next command. Invalid human-shaping assumptions receive validator feedback and bounded, section-only repair. |
| F2: one promised drafting call became three | Preflight records the three named sections and the maximum additional calls/repairs. Usage is separate from a guessed monetary price. |
| F3: readiness overwritten on resume | Journey readiness is appended as sequenced, hash-linked events; prior observations remain. |
| F4: redraft printed the wrong PRD path | The original source is preserved; saved settings and that source path are reused on resume. |
| F5: reply reuse became a permanent dead end | Valid cached sections survive repairs; failed sections receive feedback within a persistent call ceiling. Uncertain sends refuse replay. |
| F6: overrule/answer state disagreed with approval | Answers and overrulings invalidate exact task/approval digests; regenerated required questions are checked again. External edits are not overwritten. |
| F7: decisions re-asked after promised reuse | Recorded routine decisions and repository-scoped authority are reused. Human-only decisions remain explicit. |
| F8: causal worker error hidden in stdout | Diagnosis retains both actual stdout and stderr. Missing CLI/auth, timeout, cancellation and no-progress are distinct recorded outcomes. |
| F9: final human HOLD lacked a command | The integrated path reaches HOLD and prints the criterion-specific pen route. Successful checks with pending acceptance no longer strand the drive as a failed build. |
| F10: one check stood in for most requirements | Draft validation demands source disposition and a check binding for each required machine-checkable requirement. It does **not** prove that model-generated wording/checks fully capture the user's meaning. |

Additional adversarial fixes include strict duplicate/tag rejection, refusing
malformed evidence, binary-aware source freshness, check-mutation detection,
preserving existing gate policies, refusing missing-target resume before work,
dead-process lock recovery, and redacting returned model content before it can
become a persisted plan. A source document containing a detected credential is
refused before copying; it is not silently rewritten.

## Unattended operation

The supplied standalone `ts/dist/wringer-headless` program uses the installed
Codex CLI's supported never-ask policy **with workspace sandboxing retained**.
It sends the task through stdin, keeps private redacted event/error/report files,
enforces a wall-clock ceiling and terminates the whole process group on timeout
or interruption. Blocked operations and missing final reports return failure.

Seven fake-executable tests cover that behavior, including existing-Keychain
retrieval's exact read-only command. They do not contact Codex or a real Keychain.
The launcher never logs in, changes global settings, stores another key or uses a
sandbox-bypass flag. Existing authentication is reused; optional macOS Keychain
retrieval passes the existing key through the child's environment only.

This does not change this desktop task's host-managed permissions. “Never ask”
means an operation outside the allowed envelope fails, not that it gains access.
Dependencies/network/Keychain permissions must be provisioned once for the
intended environment. macOS may still require access to an existing Keychain item.
Routine Wringer authority does not invent human review or authorize publication.
See [the operating guide](HEADLESS.md) for the exact commands.

## Validation record

The full native suite passed **169 tests, 990 assertions**, with zero failures,
including real local subprocesses, HTTP fixtures, Git worktrees and local-origin
delivery. An additional portable-corpus run passed 41 tests against committed,
Python-written example records. Static TypeScript checking and all 63 generated
contracts passed. A binary-only installation away from the checkout passed red
and green verification, receipt reading, board rendering, doctor and both aliases.

The retained acceptance fixture completed the following chain:

`red → deterministic worker → green → HUMAN HOLD → labelled fixture judgement → verify → dry delivery → explicit local push → fresh clone → audit → falsify → doctor`

Audit and falsification were also executed **literally as printed by `mr.md`**,
using the compiled binary from the root of the fresh clone. Audit checked nine
claims: zero failed and zero uncheckable. Falsification measured two changed-line
mutations: one caught and one survived. A survivor is a finding about the checks,
not a defect verdict or a quality score.

The final fixture makes three local mock drafting calls and one deterministic local
worker turn. It reads no real credentials and makes **zero paid provider calls**.
The fixture's human note is explicitly attributed to “Deterministic test operator”,
not Marc; it is a test input, not a real person's endorsement. The final complete
fixture took 5.885 seconds. This timing is not a performance comparison or a live
model convergence measurement. Codex account usage for constructing this rewrite
was not measured and is not included in that zero-provider-call statement.

The Python reference suite collected **4,138 tests**. Its first serial attempt
hit the explicit ten-minute limit at 92%; that is recorded as a timeout, not a
pass. The complete four-partition run finished with 3,977 passed, 158 skipped and
three failed documentation guards. Those failures were caused by this rewrite's
docs: moving the original README thesis below its guarded opening, moving the
stated product goal below its guarded opening, and listing graph kinds without
naming their deriving symbol. They were fixed without weakening any test. The
entire documentation module then passed: **685 passed, 157 skipped**. Combined
with the completed unaffected partitions, the final covered result is **3,980
passed, 158 skipped**, with no unresolved reference-test failure. This aggregate
is not presented as one uninterrupted all-green invocation.

The final native batch (static checks, tests, corpus, build, binary installation,
journey, entry points and corrected documentation) completed successfully. The
standalone headless program was then added to the distribution and checked away
from its source tree; its seven fake-executable tests passed again. There was no
live model call in those checks.

## Retained evidence and handoff

- [Native validation stages and timings](/Users/marc/Claude/wringer/.wringer/native-validation-2026-09-06T20-29-53-885Z/result.json) — every stage's stdout and stderr are retained alongside this record.
- [Complete Python partition inventory/results](/Users/marc/Claude/wringer/.wringer/native-reference-5f69836d-84df-4b25-8967-987d19500a3e/result.json) and [corrected full documentation regression](/Users/marc/Claude/wringer/.wringer/native-validation-2026-09-06T20-29-53-885Z/legacy-documentation.stdout.log).
- [Final complete journey transcript](/Users/marc/Claude/wringer/.wringer/native-demo-20260906-203049-cf4aa33e/transcript.md) and [machine-readable outcome](/Users/marc/Claude/wringer/.wringer/native-demo-20260906-203049-cf4aa33e/result.json).
- [Delivered board](/Users/marc/Claude/wringer/.wringer/native-demo-20260906-203049-cf4aa33e/work/.wringer/deliveries/20260906-203052498-c3097c44/board.html), [certificate](/Users/marc/Claude/wringer/.wringer/native-demo-20260906-203049-cf4aa33e/work/.wringer/deliveries/20260906-203052498-c3097c44/certificate.json), [summary](/Users/marc/Claude/wringer/.wringer/native-demo-20260906-203049-cf4aa33e/work/.wringer/deliveries/20260906-203052498-c3097c44/summary.md) and [MR document](/Users/marc/Claude/wringer/.wringer/native-demo-20260906-203049-cf4aa33e/work/.wringer/deliveries/20260906-203052498-c3097c44/mr.md).
- [Binary-only distribution check, including standalone headless](/Users/marc/Claude/wringer/.wringer/native-distribution-c472da3b-67fa-474f-8ab1-69ca21b4273b/result.json).
- Native source: `/Users/marc/Claude/wringer/ts/`. Built programs: `/Users/marc/Claude/wringer/ts/dist/`. Changes remain in the working tree; no main-repository commit or publication was made.

The final fixture names run `20260906-203051-520fbef6` and delivery
`20260906-203052498-c3097c44`. Its verification base is
`63323f0d32644d6d0662a99a59d729af4e5dc7b0`; its delivered source commit is
`c14a26fbd58b97a5b015cf0bb98295346d15a800`. Every view explains why those are
different from the later evidence-publication commit. The final board carries
three recorded drafting calls and 180 fixture-reported tokens with no request
identity mismatch; no provider dollar price is invented. The worker reservation
settled to one actual turn out of three authorized.

All failed intermediate native validations remain in `.wringer/native-validation-*`.
They include fixture setup mistakes, a compiled-alias bug, and the adversarial
issues repaired during development; they are not erased or reclassified as blind
test passes. Per-stage wall times are measured. A precise whole-session work/cost
total, including time waiting for host approvals, was not measured.

## Release boundaries and unsupported policy

- No fresh-machine or live Anthropic/Codex convergence result is claimed. The
  original Run 5B blind verdict remains FAIL; this rewrite does not retroactively
  change it. Credential-state tests use controlled probes, not the live account
  matrix. Live provider pricing, rejection and rate-limit behavior remain unmeasured.
- Source/requirement disposition is structural coverage, not proof of semantic
  completeness. Check-file identity covers named files, not all transitive imports.
- Container execution/cleanup protocols are exercised with stubs. Actual container
  isolation and allow-list enforcement have not been independently measured here.
  Trusted local execution is not described as containment.
- Legacy ACP adapters, automatic forge MR creation, required signatures,
  `evidence.include`, legacy workspace routing, fleet scope/fallback policy and
  automatic fleet-worktree merging are not a claimed native parity result.
  Declared unsupported safety/execution policy refuses instead of silently
  downgrading. Delivery writes `mr.md` and can push a new branch; it does not claim
  to have opened a hosted pull/merge request.
- Source/delivery digests detect alteration, not a malicious owner rewriting all
  content and seals. Human identity and clocks are recorded, not authenticated.
  Display/tree binding is enforced when recording. Verification invalidates stored
  judgements when criterion wording changes, not on every later implementation edit;
  that limitation must not be mistaken for continuing review of changed software.
- Display artifacts are opt-in locally. The portable bundle explicitly omits
  display-artifact payloads while carrying the original inventory/seals and an
  omission record; it does not secretly publish arbitrary binary material.
- Board structure, escaping, shared wording and responsive CSS are tested. This
  run does not claim a completed human visual inspection of every viewport/theme.
- Dead-owner locks recover when absence is established. A malformed lock, reused
  PID or interrupted recovery guard fails closed for inspection.
- Native CI is configured for macOS and Linux, but no remote CI run has been
  triggered or claimed by this local implementation session. Windows process-group
  supervision is explicitly unsupported.

The next release decision should come from a new, declared live acceptance row
using the native distribution—not from its language, test count or a “SOTA” label.
