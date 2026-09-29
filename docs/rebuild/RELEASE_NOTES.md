Wringer 1.0.0-alpha.24 makes its engineering loops and portable evidence visible
from ordinary jobs. Coding agents produce changes; Wringer coordinates bounded
repair, protected checks, independent judge sessions and source-bound review.

Use `wring job loop --job JOB_ID --json` or the read-only `wringer.inspect_loop`
MCP tool to inspect the same validated observations shown on the job page. The
history is open by default and includes candidate identities, every recorded
loop decision, repair excerpts, reserved/remaining allowances and uncertain
attempts. Runtime diagnostic paths are scrubbed from the public view.

Use `wring bundle export --bundle DELIVERY --output NEW_DIRECTORY` to carry an
audited contained delivery with a discovery envelope, summary and independent
Node-only reader. `node NEW_DIRECTORY/read-bundle.mjs NEW_DIRECTORY` checks byte
integrity; `wring bundle inspect --bundle NEW_DIRECTORY` also validates the
carried semantics. Export preserves existing record versions and refuses changed
evidence, source substitution, symlinks and overwriting an existing directory.

This phase establishes visibility and portability. It does not claim better
model performance, live convergence, authenticated human presence or a fresh
execution of exported checks. Fixture histories cover success, repair failure,
repeat stop, outcome warning and interrupted resume. Individual reverted fixes
and guards must fail their targeted tests and pass again after restoration.

The repository now explains the complete restoration sequence and publishes a
capability ledger separating implemented features, fixture evidence, live
qualification and comparative benefit. Contained graphs, broader improvement
proposals, tournaments, Temporal and A2A are subsequent releases; this release
does not claim those mechanisms are complete.

Native macOS arm64 and Linux x64 archives retain checksums, inventories,
provenance and exact-artifact claim reports. The release workflow checks the
actual archives, installer and local package fixtures before staging publication.
GitHub publication does not activate an npm namespace, Homebrew tap or registry
listing. The cooperative-local human review and provisioned-container limits
described in the security documentation remain in force.

Previous adoption release notes are preserved in
[the alpha.23 record](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.24/docs/rebuild/RELEASE_NOTES_ALPHA_23.md).
