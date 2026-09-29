Wringer 1.0.0-alpha.25 brings measured improvement into ordinary jobs. From the
same job page, inspect a predicted change, its fixed comparison, all retained
outcomes and the conditions under which its evidence applies.

Connect a task family with `wring experiment connect --job JOB_ID --task-family
FAMILY`. Wringer allocates owned private comparison storage; controller and
registry paths no longer need to be assembled by hand. Use `wring job
improvements --job JOB_ID --json`, the optional job-page card or read-only
`wringer.inspect_improvements({jobId})` to inspect the same facts.

Register the comparison before trials. `wring experiment proposal --job JOB_ID
--experiment ID --json` exports its immutable prediction and pinned plans as a
reviewable artifact. The page shows the proposed playbook's source path and
digest, finite research limits, missing trials, failures and unknown cost.
Testing needs a separate finite allowance. Adoption and undo remain explicit
operator decisions for future work only; MCP cannot grant either.

Typed future proposals now inherit selections only when source, runtime, model
selection, environment and checks match the exact adopted comparison. An
unevaluated registration cannot borrow benefit from another source by reusing
a playbook digest. Existing proposals, approvals and same-key proposal/revision
replays retain their original selection, including concurrent requests and
unavailable future research state.

The new sibling record is `wringer.job-improvements.v1`; previous published
schemas retain their bytes and meaning. The phase has 36 isolated reversion
checks, a packaged job/comparison walkthrough and a real Chromium walkthrough
covering job switching, delayed replies, expiry, mobile layout and locking.
All research observations in these rehearsals are explicitly labelled fixtures.
They cannot qualify adoption and do not establish live benefit, a performance
percentage or independent human usability. No background spending is enabled.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. The required release jobs verify
those archives and their installer/package routes before staging publication.
GitHub publication does not itself publish an npm package, Homebrew tap or MCP
registry listing. The documented cooperative-local operator boundary remains.

[Ordinary-job guide](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.25/docs/native/JOB_IMPROVEMENTS.md)
· [Capabilities and limits](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.25/docs/CAPABILITIES.md)
· [Previous release: loops and portable evidence](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.24)

Contained graph execution, bounded branches, broader improvement proposals,
tournaments, Temporal and A2A remain subsequent phases in the restoration plan.
