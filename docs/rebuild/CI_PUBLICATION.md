# Publication qualification — 28 September 2026

Marc authorized completion and publication on the repository. The operator
repaired GitHub login. Source commit `11fed6e9eb84cab332f8ee4843d909ed7a8e8ad9`
was pushed; no release tag or public archive was created at this checkpoint.

The [first push CI](https://github.com/marcoakes/wringer/actions/runs/36426691038)
failed. Both native suites reported 29 failing tests, and both rehearsal jobs
failed at adoption connections after their seven earlier stages passed. The
Action failed its tests gate. All traced to the metadata preflight refusing a
configured Git filter even when no repository path selected that driver. The
[actual Linux permission adversary](https://github.com/marcoakes/wringer/actions/runs/36426690639)
passed. These failures remain retained and are not represented as green.

An isolated inherited-filter regression reproduced the refusal before repair
(4 passing safety cases, 1 failing unused-driver case). Inspection now resolves
NUL-delimited filter attributes for tracked and untracked paths before status or
diff. Unused drivers are permitted; active worktree, index-fallback and global
attributes still refuse before any filter runs. No runner configuration was
removed and no source-inspection boundary was disabled.

Local qualification after repair: 24 application checks and 11 owner/Send checks
passed; typecheck passed. Five isolated reversions were caught, with passing
controls and restored checks in [the guard record](evidence/ci-filter-guards/reversions.json).
The rebuilt compiled connection rehearsal and actual verification browser journey
both passed with an inherited unused filter configured for the entire process.
The original red, targeted green, browser and CI logs remain in local `build/`;
GitHub retains the original native logs and artifacts.

Next release gate: push this repair and observe every job green, then tag the
exact source, dispatch native release qualification and inspect every job before
promotion. Passing local checks do not satisfy that remote gate.

## Second push and deterministic shutdown repair

Commit `f9e7cbe8a71a90b92cb11ff4466b63d224699572` passed the Action, both browser
rehearsals, Linux native validation and the Linux permission adversary. The
[second CI run](https://github.com/marcoakes/wringer/actions/runs/36432542662)
reported1168 passing tests/2 explicit skips on Linux. macOS reported1167 passing
tests/2 skips/1 failure: a periodic owner tick could finish its read after owner
shutdown and record the shutdown refusal as a transient job failure. Later reads
then incorrectly marked unchanged reviewable work as blocked.

A held observation now reproduces that race without relying on timer scheduling.
It failed before repair. A stopped owner now returns from convenience work after
its observation; durable command failures and uncertain sends remain authoritative.
A separate barrier test confirms that a concurrent genuine observation error
cannot alter a read already in flight, but is visible on the next read and clears
after a fresh successful tick. All19 affected checks and typecheck pass. All three
[isolated reversions](evidence/ci-owner-guards/reversions.json) were caught with
passing controls and restored checks, including removal of the shutdown guard.
No failed remote job was retried into a claimed pass; the repaired source must
receive its own complete green push run before any release tag is created.

## Green source and first tagged release attempt

Commit `7e1dd64783b68aaec1e2348ebb44fc5e82eb7184` passed
[all five main CI jobs](https://github.com/marcoakes/wringer/actions/runs/36435263992)
and the [Linux permission adversary](https://github.com/marcoakes/wringer/actions/runs/36435264038).
Both native suites reported1169 passing tests,2 explicit skips and zero failures;
all23 macOS/21 Linux core stages and both rehearsal jobs passed.

Only then was `v1.0.0-alpha.20` created. Its
[release workflow](https://github.com/marcoakes/wringer/actions/runs/36438547130)
passed both native rehearsals and the permission adversary, but both builds
failed in assistant-check before packaging. Unlike ordinary push CI, the
attestation jobs receive an OIDC token-request URL. The redactor expanded that
URL into generic scheme fragments and falsely classified ordinary repository
URLs as credentials. No draft or native release asset was created.

Two synthetic-environment tests reproduced the defect before repair. Full URL
and bearer values, meaningful URL prefixes, and credential suffixes still redact;
only the transport scheme is excluded from generated secret fragments. Three
[isolated reversions](evidence/ci-oidc-guards/reversions.json) were caught with
passing control and restored checks. The original tag is immutable. The corrected
candidate uses `1.0.0-alpha.21` and must pass its own full push and release jobs.

The affected assistant-check stage passed145 tests under synthetic OIDC metadata
after repair. The first synthetic bearer ended in the ordinary word `credential`,
which the existing fragment policy correctly redacted and invalidated a fixture
receipt; that failed measurement is retained. Repeating with a synthetic opaque
signature passed. Typecheck, the regenerated CLI reference and frozen offline
lockfile installation also passed. No real OIDC token was copied or inspected.

The first alpha21 push (`15e01fb3b54ac137e683d4da469eb2f9c3bf9081`) exposed a
missed generated artifact: the shared redactor had changed, but its bundled
contained assertion adapter had not been regenerated. GitHub recorded test runs
[36441508855](https://github.com/marcoakes/wringer/actions/runs/36441508855) and
[36441512821](https://github.com/marcoakes/wringer/actions/runs/36441512821);
all ten test jobs stopped at that build gate and both corresponding permission
jobs passed. The generated bundle is now current. Its compiled build, exact CLI
reference and three affected runtime/redactor tests passed. An
[isolated artifact reversion](evidence/ci-oidc-guards/generated-adapter.json)
passed its control, caught the old bundle, and passed again after restoration.
