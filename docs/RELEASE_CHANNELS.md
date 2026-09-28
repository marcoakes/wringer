# Release channel procedures

These are maintainer actions, separately authorized from implementation. Account
setup, tag creation, CI dispatch, draft staging and public promotion are distinct.
Only a clean committed source identity is eligible for release publication.
Do not move an existing tag or replace published version bytes.

## Native candidate and draft

Inspect actual remote releases/tags and package version before choosing an unused
prerelease. Commit only with current task authority, then rerun required checks
on that exact source. Create its exact tag only when authorized. Dispatch
`.github/workflows/release.yml` for that existing tag. It runs native macOS arm64
and Linux x64 validation, extracted/installer/npm measurements, native Brew on
macOS and the Linux DAC adversary. Its draft job depends on all required jobs.
Observe every job to a green conclusion; an old CI run cannot qualify new bytes.

Local measurement commands (no publication):

```sh
bun run build
bun scripts/release.ts package
bun scripts/extracted-distribution.ts build/release/wringer-VERSION-PLATFORM.tar.gz build/measure/extracted
bun scripts/installer-distribution.ts build/release build/measure/installer
bun scripts/release-channels.ts build/release build/channels @wringer-fixture --fixture
bun scripts/channel-distribution.ts build/channels build/measure/npm
bun scripts/release-claims.ts build/release build/measure PLATFORM VERSION
```

Use fresh output directories. The build manifest binds content/source identity;
the release inventory includes lockfile and runtime build inputs with explicit
limits. CI uses [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).
An attestation is build provenance, not correctness or human review.

`bun scripts/draft-release.ts ARTIFACT_DIRECTORY vVERSION` is an offline plan.
Its separately selected `--apply` stages only a draft for an existing matching
remote tag. It verifies both native archives, sidecars, claims, source and any
already-uploaded asset; differing bytes refuse instead of clobbering. Promotion
is an operator action. After promotion, download from a fresh directory and rerun
installation checks before declaring that public channel measured.

## npm, Homebrew and registry

1. Operator selects an actual owned scope and completes login outside Wringer.
   `bun scripts/channel-namespace.ts @SCOPE NEW_PROOF.json` performs read-only
   account/org membership checks against registry.npmjs.org. A missing package
   name is not proof of ownership. The observation expires after 24 hours.
2. Generate exact packages with `bun scripts/release-channels.ts ARTIFACTS
   NEW_CHANNELS @SCOPE --namespace-proof PROOF.json`. This creates one thin
   launcher plus only the supplied native packages, a checksum formula and
   schema-validated `server.json`. Fixture packages remain private.
3. `bun scripts/npm-publication.ts prepare CHANNELS NEW_TARBALLS` packs offline,
   validates actual contents and records exact SHA-512 identities. The
   `npm-packages.yml` workflow has a preparation-only default and an independently
   protected publication job. Configure each package's trusted publisher first.
   [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) requires
   supported hosted CI, Node >=22.14, npm >=11.5.1 and account-side workflow
   configuration. Account bootstrap or staged/direct publishing choices remain
   operator decisions; the script refuses unexpected registry outcomes.
4. After explicit publication authority, `bun scripts/npm-publication.ts publish
   NEW_TARBALLS/PUBLICATION.json` checks existing version integrity before each
   publish and observes it afterward. It never overwrites a version. Re-run an
   uncertain operation with the identical plan; do not change bytes behind it.
5. Publish the generated formula to the operator-selected tap after reviewing
   real install/test evidence. `brew-distribution.ts` is an explicit disposable
   macOS CI measurement, not permission to install into an operator's Homebrew.
6. Inspect generated `server.json` against the vendored official schema, replace
   no package names manually, and use the official
   [MCP registry publication procedure](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/github-actions.mdx)
   for `io.github.marcoakes/wringer`. Establish ownership/login separately. Publish
   only after the exact npm package exists and its no-download STDIO invocation
   works. The listing is a local setup-dependent bridge, never a hosted server.

## Runtime images

`runtime-images.yml` builds Linux arm64/x64 on native runners using an isolated
pinned context. Default is artifact-only. The `runtime-images` environment gates
optional GHCR publication. `scripts/runtime-image-artifact.ts` records OCI image,
OS/package inventory and no-model probes; `runtime-image-publish.ts` refuses
conflicting remote identities and retains observed immutable registry digests.

An image build is not Apple/gVisor isolation evidence. Provision and independently
measure each runtime with `wring runtime measure`. Record provider acceptance only
after explicitly allowed finite model work. Do not substitute Docker host workers.
