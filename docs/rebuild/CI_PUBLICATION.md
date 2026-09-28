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
