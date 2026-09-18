# Original Reports inputs: automated engineering rehearsal

This explicit integration scenario exercises Wringer with the original Reports
request, complete chat intent, local data, component library, protected checks and
both supplied reference PNGs. It creates a new isolated scratch repository and
controller. It never resumes, approves or publishes an existing Reports job.

The source author is a **SCRIPTED TEST FIXTURE**. A deterministic Node ACP adapter
copies two predetermined implementations inside actual worker containers. Each
worker also writes ignored `.evidence` output, so Wringer's production change
capture must export the source and exclude that output. A separate contained
scripted judge supplies predetermined findings. These are real ACP and containment
measurements, with no model inference or provider call.

The actual original acceptance and screenshot commands execute only inside the
declared credential-free browser image. A separately protected supplementary audit
checks all report metadata and summaries, keyboard focus, filter combinations,
three-column desktop layout and 320/390px phone widths. It does not replace or edit
the original checks. The browser operates the real approval,
correction, review and separate Send forms with the explicit actor
`SCRIPTED TEST FIXTURE (not an independent person)`. Its correction is predetermined
and never attributed to Marc. Neither its Yes nor its Send authorizes a real job.
The controller uses cooperative-local fixture state; this does not measure a
protected controller or human-confirmation OS boundary.

Prerequisites are macOS with the Apple Container service running, the exact
digest-pinned browser image already available, the declared Bun toolchain, the
repository's pinned Playwright Chromium, and a current `bun run build`. The image
must contain the original Reports check dependencies: Bun 1.4.2, Playwright 1.63.0
under `/opt/wringer-design`, and Chromium. There is no host target-code fallback.

```sh
bun scripts/reports-workspace-rehearsal.ts \
  --source /absolute/path/to/original-reports-repository \
  --intent /absolute/path/to/proposal-request.json \
  --image registry/browser-image@sha256:EXACT_IMAGE_DIGEST
```

`--intent` reads only the JSON record's `intent` string. It must preserve the exact
`REQUEST.md` followed by the user's chat words. Other proposal fields, controller
identifiers and authority are not copied. Input files are read-only, individually
bounded, hashed and copied from an explicit allowlist. Desktop 1280×900 and mobile
390×844 PNG bytes must match the pinned snapshot. Missing inputs, mismatched PNGs
and changes to the copied inputs refuse the scenario. The retained hashes freeze
the supplied bytes; they do not independently authenticate those bytes against a
previously pinned original source manifest.

The run has a 15-minute wall limit, four scripted role sessions (two worker and two
judge), no planner, no forwarded credentials and denied runtime networking. The
original baseline must fail the protected assertions; both candidate versions must
pass them. The scripted correction changes the result count from “6 reports” to
“6 of 6 reports”, resulting in fresh desktop and mobile captures. The correction
tests source binding and review invalidation; it is not a visual-quality judgment.

Successful output is retained under a unique
`.wringer/assistant-launch-rehearsal-*` directory. `result.json`, `guided-result.json`
and `transcript.json` identify fixture limits, measured checks, role runtime IDs and
the fresh-clone audit result. Browser screenshots show the actual desktop/mobile
captures beside the unchanged references. The new private `origin.git` receives
only the fixture review branch. The literal copied handover commands clone that
origin into `guided-audit-parent/reviewed-change` and run the carried audit there;
the test also proves that a failed clone cannot accidentally audit an older folder.
Separate Git checks bind that clone's HEAD to the recorded evidence commit, its
single parent and source tree to the audited candidate, and all evidence-commit
changes to additions under the exact delivery directory. The checkout must have
no tracked, untracked or ignored changes.
The fresh clone carries `rehearsal/fixture.json`, exact original intent and input
hashes, protected scripted adapter/source variants, and the regular delivery bundle.
Do not share private connection files or raw controller logs.

This proves a deterministic engineering path on the measured machine. It does not
prove live model convergence, independent human acceptance, real coding-client
behavior, hosted forge publication, or OS kill/reboot/sleep recovery. The carried
breakage command is retained but not run within this scenario's finite envelope.
Failures remain retained and are not reclassified as passes.

CI runs the loader and protocol unit tests without Apple Container or paid agents:

```sh
bun test packages/cli/test/reports-workspace-rehearsal.test.ts
```

The explicit contained scenario is not part of default CI. Existing synthetic
`--design --local` rehearsals remain available for faster product-form coverage;
their results continue to disclose that runtime observations are simulated.
